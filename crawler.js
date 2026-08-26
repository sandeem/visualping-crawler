const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// The worked example on the base page is NOT one of the eight — exclude it.
const EXAMPLE = 'VISUALPING{0000deadbeef0000}';
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 1000; // safety cap — stop after this many unique URLs

// Strip only the fragment. KEEP query strings so pagination (?page=N)
// stays distinct — collapsing them would hide whole page ranges.
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch (e) {
    return url;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    httpCredentials: { username: USERNAME, password: PASSWORD }
  });

  const visited = new Set();
  const queue = [BASE];
  const foundPasswords = new Set();

  // --- Set up the response listener on the context level ---
  // It fires for ALL resources the browser loads. We scan the BODY only —
  // passwords in HTTP response headers are staging placeholders and do not
  // qualify (a hidden site rule).
  context.on('response', async (response) => {
    let body = '';
    try { body = await response.text(); } catch (e) {}

    const matches = body.match(PATTERN);
    if (matches) {
      matches.forEach(m => {
        if (m === EXAMPLE) return; // skip the worked example
        if (!foundPasswords.has(m)) {
          foundPasswords.add(m);
          console.log(`✅ FOUND: ${m}  (in ${response.url()})`);
        }
      });
    }
  });

  // --- Reuse a single page for speed (the old per-URL page creation was
  // --- why the crawl timed out). ---
  const page = await context.newPage();

  // --- BFS over the RENDERED link graph ---
  // The target is a JS-rendered SPA; many links only appear in the DOM after
  // the page loads. We collect <a href> from the rendered page each iteration.
  while (queue.length > 0 && visited.size < MAX_URLS) {
    const url = normalizeUrl(queue.shift());
    if (visited.has(url)) continue;
    visited.add(url);

    if (visited.size % 25 === 0) {
      console.log(`... visited ${visited.size} URLs (queue: ${queue.length})`);
    }

    // Only visit URLs on the same host
    try {
      const parsedUrl = new URL(url);
      const parsedBase = new URL(BASE);
      if (parsedUrl.hostname !== parsedBase.hostname) continue;
    } catch (e) {
      continue; // skip invalid URLs
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // 1. Search the RENDERED DOM too (catches JS-injected passwords).
      const dom = await page.content();
      const domMatches = dom.match(PATTERN);
      if (domMatches) {
        domMatches.forEach(m => {
          if (m === EXAMPLE) return;
          if (!foundPasswords.has(m)) {
            foundPasswords.add(m);
            console.log(`✅ FOUND: ${m}  (in rendered DOM of ${url})`);
          }
        });
      }

      // 2. Collect the rendered link graph and enqueue new URLs.
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      );
      links.forEach(link => {
        const normalized = normalizeUrl(link);
        if (!visited.has(normalized)) queue.push(normalized);
      });
    } catch (e) {
      // timeout or bad page — skip
    }
  }

  console.log(`\nVisited: ${visited.size} URLs`);
  console.log(`Found ${foundPasswords.size} passwords (excluding the worked example):`);
  foundPasswords.forEach(p => console.log(' ', p));

  await browser.close();
})();
