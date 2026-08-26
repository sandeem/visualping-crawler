const { chromium } = require('playwright');
const { BASE, USERNAME, PASSWORD } = require('./config.js');

// The worked example is NOT one of the 8 — exclude it.
const EXAMPLE = 'VISUALPING{0000deadbeef0000}';
const PATTERN = /VISUALPING\{[0-9a-fA-F]{16}\}/g;
const MAX_URLS = 500;        // clicker visits fewer pages but interacts deeply
const MAX_CLICKS_PER_PAGE = 30; // don't click forever on one page

// Keep query strings so pagination (?page=N) stays distinct.
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

  // 1) Search every raw response body — catches API/JS/static content.
  context.on('response', async (response) => {
    let body = '';
    try { body = await response.text(); } catch (e) {}
    (body.match(PATTERN) || []).forEach(m => report(m, response.url(), 'response'));
  });

  const page = await context.newPage();

  // Search rendered DOM + visible text of the current page.
  async function scanRendered(url, source) {
    const dom = await page.content();
    (dom.match(PATTERN) || []).forEach(m => report(m, url, source));
    const txt = await page.evaluate(() => document.body ? document.body.innerText : '');
    (txt.match(PATTERN) || []).forEach(m => report(m, url, source));
  }

  // Enqueue all linkable targets (href/src/action/data-*).
  async function collectLinkTargets() {
    return page.evaluate(() => {
      const items = new Set();
      document.querySelectorAll('a[href], script[src], link[href], img[src], iframe[src], source[src], form[action]').forEach(el => {
        const v = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('action');
        if (v) items.add(v);
      });
      document.querySelectorAll('[data-href], [data-url]').forEach(el => {
        const v = el.getAttribute('data-href') || el.getAttribute('data-url');
        if (v) items.add(v);
      });
      return Array.from(items);
    });
  }

  // Enqueue URLs embedded in onclick handlers.
  async function collectOnclickTargets() {
    return page.evaluate(() => {
      const items = new Set();
      document.querySelectorAll('[onclick]').forEach(el => {
        const oc = el.getAttribute('onclick');
        if (!oc) return;
        const m = oc.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (m) items.add(m[1]);
        const m2 = oc.match(/['"](\/[^'"]*)['"]/); // any absolute-ish path
        if (m2) items.add(m2[1]);
      });
      return Array.from(items);
    });
  }

  async function processUrl(url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(600);
    await scanRendered(url, 'rendered DOM');

    // Enqueue link + onclick targets.
    const links = await collectLinkTargets();
    links.forEach(l => {
      const abs = new URL(l, url).toString();
      const norm = normalizeUrl(abs);
      if (!visited.has(norm)) queue.push(norm);
    });
    const onclickTargets = await collectOnclickTargets();
    onclickTargets.forEach(l => {
      const abs = new URL(l, url).toString();
      const norm = normalizeUrl(abs);
      if (!visited.has(norm)) queue.push(norm);
    });

    // 2) Actually CLICK interactive elements and watch for new content.
    const clickable = await page.evaluate(() => {
      const selectors = [
        'button', 'a[href]', 'input[type="submit"]', 'input[type="button"]',
        '[role="button"]', '.pager a', '.next', '[data-page]', '[onclick]'
      ];
      const out = [];
      document.querySelectorAll(selectors.join(',')).forEach(el => {
        const text = (el.textContent || '').trim();
        const id = el.id || '';
        const cls = el.className || '';
        const href = el.getAttribute('href') || '';
        out.push({ text: text.slice(0, 60), id, cls: String(cls).slice(0, 40), href, tag: el.tagName });
      });
      return out;
    });

    // Click each element (bounded). Reset to base URL after each click so we
    // don't lose position, but watch all network traffic AND rendered DOM.
    let clicksDone = 0;
    for (const c of clickable) {
      if (clicksDone >= MAX_CLICKS_PER_PAGE) break;
      try {
        // Re-goto the target URL so selector is valid.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForTimeout(200);

        // Build a selector for this element.
        let sel = null;
        if (c.id) sel = '#' + c.id;
        else if (c.href) sel = `a[href="${c.href}"]`;
        else if (c.cls) sel = `.${c.cls.split(/\s+/).map(s => s.replace(/[^\w-]/g, '')).filter(Boolean).join('.')}`;
        else sel = c.tag;
        if (!sel) continue;

        // Try generic click first.
        await page.click(sel, { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(400);

        // 3) After clicking, search the NEW rendered DOM + any new responses.
        await scanRendered(page.url(), 'after-click');
        clicksDone++;
      } catch (e) { /* element may no longer exist — skip */ }
    }

    // Pagination "Next" chain: click repeatedly, scanning each page.
    for (let i = 0; i < 20; i++) {
      const nextHref = await page.evaluate(() => {
        const next = Array.from(document.querySelectorAll('.pager a, a[href*="page="]'))
          .find(a => /next/i.test(a.textContent || ''));
        return next ? next.getAttribute('href') : null;
      });
      if (!nextHref) break;
      const nextUrl = new URL(nextHref, url).toString();
      try {
        await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForTimeout(400);
        await scanRendered(nextUrl, 'pager');
      } catch (e) { break; }
    }
  }

  // Main BFS with page reuse (fast) + click-interaction.
  while (queue.length > 0 && visited.size < MAX_URLS) {
    const url = normalizeUrl(queue.shift());
    if (visited.has(url)) continue;
    visited.add(url);

    if (visited.size % 10 === 0) {
      console.log(`... visited ${visited.size} / ${MAX_URLS} (queue: ${queue.length})`);
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== new URL(BASE).hostname) continue;
    } catch (e) { continue; }

    try {
      await processUrl(url);
    } catch (e) { /* skip bad URL */ }
  }

  console.log('\n===== FINAL (interactive-clicker) =====');
  console.log('Visited: ' + visited.size + ' URLs');
  console.log('Total unique passwords found: ' + found.size);
  found.forEach((info, m) => console.log(`  ${m}  (${info.source}, ${info.url})`));

  await browser.close();
})();
