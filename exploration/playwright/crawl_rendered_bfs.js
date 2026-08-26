const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// The worked example is NOT one of the 8 — exclude it.
const EXAMPLE = 'VISUALPING{0000deadbeef0000}';
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 3000;

// Keep query strings (they may matter); only strip hash.
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
  const found = new Map();  // password -> { url, source }

  function report(match, url, source) {
    if (match === EXAMPLE) return;
    if (!found.has(match)) {
      found.set(match, { url, source });
      console.log(`[${source.toUpperCase()}] ${match}  (${url})`);
    }
  }

  // Search every raw response body (static+cached files).
  context.on('response', async (response) => {
    let body = '';
    try { body = await response.text(); } catch (e) {}
    (body.match(PATTERN) || []).forEach(m => report(m, response.url(), 'response'));
  });

  const page = await context.newPage();

  while (queue.length > 0 && visited.size < MAX_URLS) {
    const url = normalizeUrl(queue.shift());
    if (visited.has(url)) continue;
    visited.add(url);

    if (visited.size % 25 === 0) {
      console.log(`... visited ${visited.size} / ${MAX_URLS} (queue: ${queue.length})`);
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== new URL(BASE).hostname) continue;
    } catch (e) { continue; }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForTimeout(300);

      // Search RENDERED DOM (catches JS-injected passwords).
      const dom = await page.content();
      (dom.match(PATTERN) || []).forEach(m => report(m, url, 'rendered DOM'));
      const txt = await page.evaluate(() => document.body ? document.body.innerText : '');
      (txt.match(PATTERN) || []).forEach(m => report(m, url, 'rendered text'));

      // Collect ALL rendered <a href> links — the JS-materialized graph.
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      );
      links.forEach(l => {
        let norm = null;
        try { norm = normalizeUrl(l); } catch (e) {}
        if (norm && !visited.has(norm)) queue.push(norm);
      });
    } catch (e) { /* skip bad URL */ }
  }

  console.log('\n===== FINAL (rendered BFS) =====');
  console.log('Visited: ' + visited.size + ' URLs');
  console.log('Total unique passwords found: ' + found.size);
  found.forEach((info, m) => console.log(`  ${m}  (${info.source}, ${info.url})`));

  await browser.close();
})();
