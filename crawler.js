const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// Secret shape we hunt for. The /g flag makes .match() return every occurrence.
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 600; // safety cap — stop after this many unique URLs

(async () => {
  const browser = await chromium.launch({ headless: true });
  // Context isolates cookies/storage; httpCredentials auto-applies Basic Auth
  // to every request, so we don't have to construct the header ourselves.
  const context = await browser.newContext({
    httpCredentials: { username: USERNAME, password: PASSWORD },
  });

  const visited = new Set();
  const queue = [BASE];
  const foundPasswords = new Set(); // de-dupe — report each password once

  // Listen for responses across all pages in this context.
  // Attaching to `context` (not a single page) means the listener covers every
  // tab we open in the BFS loop below.
  context.on('response', async (response) => {
    let body = '';
    try {
      body = await response.text();
    } catch (e) {
      // Binary file — not text-readable, ignore.
    }

    // Search body + headers together; headers can carry secrets too.
    const allText = body + JSON.stringify(response.headers());
    const matches = allText.match(PATTERN);
    if (matches) {
      matches.forEach((m) => {
        if (!foundPasswords.has(m)) {
          foundPasswords.add(m);
          console.log(`✅ FOUND: ${m}  (in ${response.url()})`);
        }
      });
    }
  });

  // Breadth-first traversal: shift() removes the oldest item, so we fully
  // cover a page's direct children before descending deeper.
  while (queue.length > 0) {
    const url = queue.shift();
    // Skip anything already seen — prevents re-fetching and cycles.
    if (visited.has(url)) continue;
    visited.add(url);

    // Safety cap — stop the crawl once we've visited the limit.
    if (visited.size >= MAX_URLS) {
      console.log(`\n⚠️ Hit MAX_URLS (${MAX_URLS}) — stopping.`);
      break;
    }

    // Stay on the target host — don't crawl out to other domains.
    try {
      const host = new URL(url).hostname;
      const baseHost = new URL(BASE).hostname;
      if (host !== baseHost) continue;
    } catch (e) {
      continue; // malformed URL — ignore it
    }

    console.log(`Visiting: ${url}`);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

      // Collect links from the page DOM.
      // page.evaluate() runs inside the browser, where the browser resolves
      // relative hrefs to absolute URLs automatically.
      const links = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll('a[href], script[src], link[href], img[src]')
        );
        return nodes.map((el) => el.href || el.src).filter(Boolean);
      });

      links.forEach((link) => {
        if (!visited.has(link)) queue.push(link);
      });

      await page.close(); // free the tab — BFS can open many
    } catch (e) {
      console.log(`  Error on ${url}: ${e.message}`);
    }
  }

  console.log(`\nVisited: ${visited.size} URLs`);
  console.log(`Found ${foundPasswords.size} passwords:`);
  foundPasswords.forEach((p) => console.log(' ', p));

  await browser.close();
})();