const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// The worked example is NOT one of the eight — exclude it from the report.
const EXAMPLE = 'VISUALPING{0000deadbeef0000}';
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 1000;

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
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
  const bodyMatches = new Map();   // url -> Set of passwords in BODY
  const headerMatches = new Map(); // url -> Set of passwords in HEADERS

  // Print a password the moment it's found, plus record where it came from.
  function record(locationMap, url, match, kind) {
    if (!locationMap.has(url)) locationMap.set(url, new Set());
    locationMap.get(url).add(match);
    console.log(`[${kind}] FOUND: ${match}  (${url})`);
  }

  context.on('response', async (response) => {
    let body = '';
    try { body = await response.text(); } catch (e) {}

    (body.match(PATTERN) || []).forEach(m => {
      if (m === EXAMPLE) return;
      record(bodyMatches, response.url(), m, 'BODY');
    });

    const headerStr = JSON.stringify(response.headers());
    (headerStr.match(PATTERN) || []).forEach(m => {
      if (m === EXAMPLE) return;
      record(headerMatches, response.url(), m, 'HEADER');
    });
  });

  // ONE reusable page — fast, no per-URL tab creation.
  const page = await context.newPage();

  while (queue.length > 0 && visited.size < MAX_URLS) {
    const url = normalizeUrl(queue.shift());
    if (visited.has(url)) continue;
    visited.add(url);

    // Progress counter every 20 URLs so we can see it's alive.
    if (visited.size % 20 === 0) {
      console.log(`... visited ${visited.size} / ${MAX_URLS} (queue: ${queue.length})`);
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== new URL(BASE).hostname) continue;
    } catch (e) { continue; }

    try {
      // Faster wait: domcontentloaded + short timeout instead of networkidle.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href], script[src], link[href], img[src], iframe[src], source[src], form[action]'))
          .map(el => el.href || el.src)
          .filter(Boolean);
      });
      links.forEach(link => {
        const norm = normalizeUrl(link);
        if (!visited.has(norm)) queue.push(norm);
      });
    } catch (e) { /* skip bad URL */ }
  }

  // Final summary
  const allBody = new Set();
  bodyMatches.forEach(set => set.forEach(m => allBody.add(m)));
  const allHeader = new Set();
  headerMatches.forEach(set => set.forEach(m => allHeader.add(m)));

  console.log('\n===== FINAL SUMMARY =====');
  console.log('Visited: ' + visited.size + ' URLs');
  console.log('Unique BODY passwords: ' + allBody.size);
  allBody.forEach(m => console.log('  BODY: ' + m));
  console.log('Unique HEADER passwords: ' + allHeader.size);
  allHeader.forEach(m => console.log('  HEADER: ' + m));
  console.log('Combined unique: ' + new Set([...allBody, ...allHeader]).size);

  await browser.close();
})();
