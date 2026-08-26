const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// The worked example is NOT one of the 8 — exclude it.
const EXAMPLE = 'VISUALPING{0000deadbeef0000}';
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 2000;

// Keep query strings (?) so pagination (?page=N) stays distinct.
// Only strip the hash fragment.
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
  const bodyFound = new Map();      // password -> url

  // Search body-only (headers are staging placeholders per hidden rule).
  context.on('response', async (response) => {
    let body = '';
    try { body = await response.text(); } catch (e) {}
    (body.match(PATTERN) || []).forEach(m => {
      if (m === EXAMPLE) return;
      if (!bodyFound.has(m)) {
        bodyFound.set(m, response.url());
        console.log('[BODY] ' + m + '  (' + response.url() + ')');
      }
    });
  });

  const page = await context.newPage();

  // Extract EVERYTHING clickable / linkable, not just <a> tags.
  async function extractTargets() {
    return page.evaluate(() => {
      const items = new Set();
      // href/src on standard tags
      document.querySelectorAll('a[href], script[src], link[href], img[src], iframe[src], source[src], form[action]').forEach(el => {
        const v = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('action');
        if (v) items.add(v);
      });
      // onclick handlers (JS nav)
      document.querySelectorAll('[onclick], [data-href], [data-url]').forEach(el => {
        const v = el.getAttribute('data-href') || el.getAttribute('data-url');
        if (v) items.add(v);
        // try to pull a URL out of onclick="location.href='...'"
        const oc = el.getAttribute('onclick');
        if (oc) {
          const m = oc.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
          if (m) items.add(m[1]);
        }
      });
      // buttons / submit that are likely pagination or reveal
      document.querySelectorAll('button[data-page], button[data-url], input[type="submit"]').forEach(el => {
        const v = el.getAttribute('data-page') || el.getAttribute('data-url');
        if (v) items.add(v);
      });
      return Array.from(items);
    });
  }

  while (queue.length > 0 && visited.size < MAX_URLS) {
    const url = normalizeUrl(queue.shift());
    if (visited.has(url)) continue;
    visited.add(url);

    if (visited.size % 25 === 0) {
      console.log('... visited ' + visited.size + ' / ' + MAX_URLS + ' (queue: ' + queue.length + ')');
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== new URL(BASE).hostname) continue;
    } catch (e) { continue; }

    try {
      // domcontentloaded + small delay (fast but lets JS run)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(800);

      // Collect targets
      const targets = await extractTargets();
      targets.forEach(t => {
        // Resolve relative URL against current page
        const abs = new URL(t, url).toString();
        const norm = normalizeUrl(abs);
        if (!visited.has(norm)) queue.push(norm);
      });

      // Track any URL pattern in rendered DOM text/attributes too (in case
      // it's built by JS but not in an href).
      const domStrings = await page.evaluate(() => document.documentElement.innerHTML);
      const urlRegex = /\/[a-zA-Z0-9_\-./]+/g;
      (domStrings.match(urlRegex) || []).forEach(u => {
        const abs = new URL(u, url).toString();
        const norm = normalizeUrl(abs);
        if (norm.startsWith(BASE)) {
          try {
            if (new URL(norm).hostname === new URL(BASE).hostname && !visited.has(norm)) queue.push(norm);
          } catch(e) {}
        }
      });

    } catch (e) { /* skip bad URL */ }
  }

  console.log('\n===== FINAL =====');
  console.log('Visited: ' + visited.size + ' URLs');
  console.log('BODY passwords found: ' + bodyFound.size);
  bodyFound.forEach((u, m) => console.log('  ' + m + '  (' + u + ')'));

  await browser.close();
})();
