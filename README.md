# Visualping Crawler — Take-Home Assessment

A web crawler that discovers hidden passwords on a password-protected target site, implemented with Playwright (Node).

## Requirements

- Node.js v18+
- `npm` / `npx`

## Setup

```bash
npm install
npx playwright install chromium
```

## Configuration

Create `config.js` in the project root (this file is **gitignored** — never commit it):

```js
module.exports = {
  BASE: 'http://<target-host>/',
  USERNAME: '<username>',
  PASSWORD: '<password>',
};
```

## Run

```bash
node crawler.js
```

The crawler visits every URL on the target host (breadth-first), renders each page with a real browser, and scans for the `VISUALPING{...}` password pattern across body, rendered DOM, and raw bytes.

## Structure

```
visualping-project/
├── README.md                 ← this file
├── crawler.js                ← main Playwright submission
├── config.js                 ← gitignored (secrets)
├── package.json
├── package-lock.json
└── exploration/
    ├── python/               ← Python equivalent (probe.py, crawler.py)
    └── playwright/           ← diagnostic Playwright scripts
        ├── probe.js                        ← single-page recon
        ├── crawl_first_pass.js             ← link-following BFS (v1)
        ├── crawl_rendered_bfs.js           ← rendered-DOM BFS (v2)
        ├── crawl_all_sources.js            ← body+headers+cookies+DOM (v3)
        ├── crawl_clicker.js                ← interactive-click experiment
        └── scan_recon.js                   ← body-vs-header attribution
```

## Approach

### Why Playwright?

The target is a JavaScript-rendered single-page app. Static HTML contains only the homepage shell; the real link graph and most password-bearing content only materialize after JavaScript runs. Playwright's `page.on('response')` / `context.on('response')` fires for **every** resource the browser loads — HTML, JS, CSS, images, XHR — so nothing escapes detection, including content injected into the rendered DOM.

### Crawl strategy

- **BFS (breadth-first search):** start from the homepage, queue every discovered URL, dequeue one at a time.
- **Rendered-DOM traversal:** collect links from the *rendered* `<a href>` graph — not just the raw source. This is critical because the site injects many links via JavaScript after page load.
- **Same-host restriction:** only follow URLs on the target hostname — never wander to external sites.
- **Visited set:** prevents revisiting pages and infinite loops.
- **Multi-point scanning:** for each rendered page, scan the response body, the rendered DOM, and raw response bytes for the password pattern.
- **URL normalization:** strip the fragment, and **preserve query strings** where pagination matters, so `?page=2` stays distinct from `?page=1`.

## Findings

The crawl is exhaustive over the JS-rendered link graph (the queue fully drains, so every reachable URL on the host is visited). **4 unique password tokens** were discovered matching the `VISUALPING{...}` pattern:

- **3** in response bodies / rendered DOM — these are the qualifying passwords.
- **1** in an HTTP response header — the site flags header passwords as non-qualifying staging placeholders.

> Note: the base page contains a worked example that the challenge states is **not** one of the eight. It is excluded from results.

### Two subtleties worth documenting

1. **Header passwords are placeholders.** A hidden rule (present in the raw HTML but removed by a script before the page renders) states that passwords appearing in HTTP response headers are **staging placeholders and are not qualified**. The crawler therefore treats header matches as non-qualifying and searches the body / rendered DOM for real passwords.

2. **One page is IP-geo-blocked.** A regional availability page returns a `403 Forbidden` with the message "This page is only visible to Germany region. Your IP is from Canada." The check is real IP-based, not header-based, so it could not be bypassed from this environment. This route is the likely location of the remaining passwords.

## Exploration

The `exploration/` folder documents how I arrived at the final approach — the reasoning, not just the answer:

- **`python/`** — the original Python `requests` + `BeautifulSoup` crawler, which made the mechanics explicit (manual link extraction, regex on raw bytes, BFS). It confirmed the target's link graph only materializes in the browser, motivating Playwright.
- **`playwright/`** — a sequence of diagnostic scripts showing the evolution:
  - `crawl_first_pass.js` — link-following BFS on rendered pages.
  - `crawl_rendered_bfs.js` — BFS over the full JS-rendered link graph.
  - `crawl_all_sources.js` — scans body, headers, cookies, and rendered DOM, attributing each match to its source.
  - `crawl_clicker.js` — explored actual button/click interaction; the JS-discovered pages have **no buttons or forms**, so clicking wasn't the vector.
  - `scan_recon.js` — separates body vs. header matches to distinguish real passwords from staging placeholders.

The final `crawler.js` distills the winning parts: rendered-DOM BFS + body/DOM scanning + URL normalization.

## Notes

- `config.js` contains credentials and is **excluded from git** via `.gitignore`.
- The `VISUALPING{...}` pattern is `VISUALPING` followed by exactly 16 hex characters inside curly braces.
- Per the assessment instructions, the target site URL and the specific password values are intentionally **not** published in this repository.
