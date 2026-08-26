const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');
// BASE, USERNAME, PASSWORD come from config.js (your gitignored secrets file).

const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 1000; // safety cap — stop after this many unique URLs

// Strip query string and fragment so /page?ref=x and /page are the same.
// Without this, query-string variants inflate the queue and we burn the cap
// on duplicate content instead of reaching the pages with passwords.
function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    httpCredentials: { username: USERNAME, password: PASSWORD }
  });

  const visited = new Set();
  // Set in JavaScript works the same as Python's set — stores unique values only.

  const queue = [BASE];
  const foundPasswords = new Set();

  // --- Set up the response listener on the context level ---
  // This means it fires for ALL pages we open, not just one.
  context.on('response', async (response) => {
    let body = '';
    try { body = await response.text(); } catch (e) {}

    const allText = body + JSON.stringify(response.headers());
    const matches = allText.match(PATTERN);
    if (matches) {
      matches.forEach(m => {
        if (!foundPasswords.has(m)) {
          foundPasswords.add(m);
          console.log(`✅ FOUND: ${m}  (in ${response.url()})`);
        }
      });
    }
  });

  // --- BFS loop ---
  while (queue.length > 0) {
    const url = normalizeUrl(queue.shift());
    // .shift() removes and returns the first element — same as Python's pop(0).

    if (visited.has(url)) continue;
    visited.add(url);

    // Safety cap — stop the crawl once we've visited the limit.
    if (visited.size >= MAX_URLS) {
      console.log(`\n⚠️ Hit MAX_URLS (${MAX_URLS}) — stopping.`);
      break;
    }

    // Only visit URLs on the same host
    try {
      const parsedUrl = new URL(url);
      const parsedBase = new URL(BASE);
      if (parsedUrl.hostname !== parsedBase.hostname) continue;
      // URL is a built-in JavaScript class that parses URLs.
      // .hostname gives just the domain/IP part.
    } catch (e) {
      continue; // skip invalid URLs
    }

    console.log(`Visiting: ${url}`);

    try {
      const page = await context.newPage();
      // Open a new tab for each URL.

      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      // timeout: 15000 = give up after 15 seconds if the page doesn't load.

      // Find all links on this page and add to queue
      const links = await page.evaluate(() => {
        // page.evaluate() runs code INSIDE the browser — useful for reading the DOM.
        const anchors = Array.from(document.querySelectorAll('a[href], script[src], link[href], img[src], iframe[src], source[src], form[action]'));
        // querySelectorAll finds elements. 'a[href]' = <a> tags that have an href attribute.
        return anchors.map(el => el.href || el.src).filter(Boolean);
        // .href and .src return the FULL absolute URL (the browser resolves relative paths).
        // .filter(Boolean) removes empty/null values.
      });

      links.forEach(link => {
        const normalized = normalizeUrl(link);
        if (!visited.has(normalized)) queue.push(normalized);
      });

      await page.close();
      // Close the tab when done — keeps memory usage low.

    } catch (e) {
      console.log(`  Error on ${url}: ${e.message}`);
    }
  }

  console.log(`\nVisited: ${visited.size} URLs`);
  console.log(`Found ${foundPasswords.size} passwords:`);
  foundPasswords.forEach(p => console.log(' ', p));

  await browser.close();
})();