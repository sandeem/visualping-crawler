const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// The worked example is NOT one of the 8 — exclude it.
const EXAMPLE = 'VISUALPING{0000deadbeef0000}';
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 800;          // bound the crawl; queue drains naturally
const MAX_PAGER_DEPTH = 10;    // don't chase pagination forever

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch (e) { return url; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    httpCredentials: { username: USERNAME, password: PASSWORD }
  });

  const visited = new Set();
  const queue = [BASE];
  // Track every unique password with ALL its sources.
  const found = new Map();   // password -> Set of "source@url"

  function report(match, url, source) {
    if (match === EXAMPLE) return;
    if (!found.has(match)) found.set(match, new Set());
    const key = source + '@' + url;
    if (!found.get(match).has(key)) {
      found.get(match).add(key);
      console.log(`[${source.toUpperCase()}] ${match}  (${url})`);
    }
  }

  // Capture from BODY + HEADERS + COOKIES for every response.
  context.on('response', async (response) => {
    const url = response.url();
    // Headers
    const headerStr = JSON.stringify(response.headers());
    (headerStr.match(PATTERN) || []).forEach(m => report(m, url, 'header'));
    // Body
    let body = '';
    try { body = await response.text(); } catch (e) {}
    (body.match(PATTERN) || []).forEach(m => report(m, url, 'body'));
    // Cookies (context-level)
    const cookies = await context.cookies();
    cookies.forEach(c => {
      const val = c.value || '';
      (val.match(PATTERN) || []).forEach(m => report(m, url + ' (cookie ' + c.name + ')', 'cookie'));
    });
  });

  const page = await context.newPage();

  while (queue.length > 0 && visited.size < MAX_URLS) {
    const url = normalizeUrl(queue.shift());
    if (visited.has(url)) continue;
    visited.add(url);

    if (visited.size % 50 === 0) {
      console.log(`... visited ${visited.size} / ${MAX_URLS} (queue: ${queue.length})`);
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== new URL(BASE).hostname) continue;
    } catch (e) { continue; }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForTimeout(300);

      // Search rendered DOM for JS-injected passwords.
      const dom = await page.content();
      (dom.match(PATTERN) || []).forEach(m => report(m, url, 'rendered DOM'));

      // Collect rendered links (the JS-materialized graph).
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      );
      links.forEach(l => {
        // Skip unbounded pagination to avoid loops.
        if (/[?&]page=(\d{3,})/.test(l)) return;
        let norm = null;
        try { norm = normalizeUrl(l); } catch (e) {}
        if (norm && !visited.has(norm)) queue.push(norm);
      });
    } catch (e) { /* skip bad URL */ }
  }

  console.log('\n===== FINAL (all-sources) =====');
  console.log('Visited: ' + visited.size + ' URLs');
  console.log('Total unique passwords found: ' + found.size);
  found.forEach((sources, m) => console.log(`  ${m}`));
  console.log('\nSources per password:');
  found.forEach((sources, m) => {
    console.log(`  ${m}:`);
    sources.forEach(s => console.log(`      ${s}`));
  });

  await browser.close();
})();
