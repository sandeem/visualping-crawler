# Visualping Crawler — Take-Home Assessment

A web crawler that discovers all hidden passwords on a password-protected target site, implemented with Playwright (Node).

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

The crawler visits every URL on the target host (breadth-first), scans the body, headers, and raw bytes of each response for the `VISUALPING{...}` password pattern, and prints all matches at the end.

## Structure

```
visualping-project/
├── README.md            ← this file
├── crawler.js           ← main Playwright submission
├── probe.js             ← single-page recon script
├── config.js            ← gitignored (secrets)
├── package.json
└── exploration/         ← Python equivalent (probe.py, crawler.py)
```

## Approach

### Why Playwright?

The target is a JavaScript-rendered single-page app. Python `requests` can fetch the HTML, but the browser fetches many resources you'd have to extract by hand (CSS, JS, images, iframes). Playwright's `page.on('response')` / `context.on('response')` event fires for **every** resource the browser loads — so you capture all of them automatically, including dynamically-loaded content.

### Crawl strategy

- **BFS (breadth-first search):** start from the homepage, queue every discovered URL, dequeue one at a time.
- **Same-host restriction:** only follow URLs on the target hostname — never wander to external sites.
- **Visited set:** prevents revisiting pages and infinite loops.
- **Multi-point scanning:** for each response, search the body text, the response headers, and the raw bytes (catches passwords embedded in images/CSS/JS).

### How I know the crawl is complete

1. **Same-host + BFS + visited set** means every reachable URL on the host is visited exactly once.
2. I cross-check `visited` against the browser's **Network tab** (DevTools) — if the browser fetched any resource my crawler didn't, I'm missing a URL source.
3. Every response is scanned for the password pattern in **body, headers, and raw bytes** — so no resource type escapes detection.

## Python exploration (in `exploration/`)

Before settling on Playwright, I built the same crawler in Python using `requests` + `BeautifulSoup`. That approach made the mechanics explicit — manual link extraction, regex on raw bytes, BFS traversal — and confirmed the Playwright path was the right choice for this JS-heavy target. The Python files are kept as a reference of the exploration.

## Notes

- `config.js` contains credentials and is **excluded from git** via `.gitignore`.
- The `VISUALPING{...}` pattern is `VISUALPING` followed by exactly 16 hex characters inside curly braces.
