const { chromium } = require('playwright');
// require() is Node's way of importing a library.
// We're importing just the "chromium" browser driver from playwright.

const { BASE, USERNAME, PASSWORD } = require('./config.js');
// BASE, USERNAME, PASSWORD come from config.js (your gitignored secrets file).

(async () => {
  // async/await: this whole script is asynchronous — meaning operations like
  // "open a browser" and "load a page" take time, and we wait for them.
  // The (async () => { ... })() pattern means "run this async function immediately."

  const browser = await chromium.launch({ headless: true });
  // Launch a Chromium browser.
  // headless: true means it runs invisibly — no visible window.
  // Set to false if you want to WATCH the browser open and navigate (useful for debugging).

  const context = await browser.newContext({
    httpCredentials: {
      username: USERNAME,
      password: PASSWORD
    }
  });
  // A "context" is like a browser profile — its own cookies, storage, credentials.
  // httpCredentials tells Playwright to send Basic Auth on every request automatically.
  // This replaces the auth=AUTH we used in Python.

  const page = await context.newPage();
  // A "page" is one browser tab.

  // --- Capture EVERY response the browser makes ---
  page.on('response', async (response) => {
    // This callback fires for EVERY resource the browser fetches:
    // the HTML, the CSS, the JS files, the images — everything.
    // This is the feature that makes Playwright so useful for this challenge.

    const url = response.url();
    const status = response.status();

    let body = '';
    try {
      body = await response.text();
      // .text() reads the response body as a string.
      // We wrap in try/catch because binary files (images) will throw an error here.
    } catch (e) {
      // Image or binary file — can't read as text. That's fine.
    }

    // Search for the password pattern
    const matches = body.match(/VISUALPING\{[0-9a-fA-F]{16}\}/g);
    // .match() with the /g flag finds ALL matches (g = global).
    // The regex is the same as Python's but without the r"" prefix.

    if (matches) {
      console.log(`✅ FOUND in ${url}:`);
      matches.forEach(m => console.log(`   ${m}`));
    }

    // Also search the response headers
    const headers = response.headers();
    // headers() returns an object of { headerName: value }
    const headerStr = JSON.stringify(headers);
    const headerMatches = headerStr.match(/VISUALPING\{[0-9a-fA-F]{16}\}/g);
    if (headerMatches) {
      console.log(`✅ FOUND IN HEADERS of ${url}:`);
      headerMatches.forEach(m => console.log(`   ${m}`));
    }
  });

  // --- Navigate to the page ---
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // goto() tells the browser to visit this URL.
  // waitUntil: 'networkidle' means "wait until no network requests have been
  // made for 500ms" — ensures JS-triggered requests complete before we move on.

  console.log('Page title:', await page.title());
  // page.title() returns the <title> tag of the current page.

  await browser.close();
  // Always close the browser when done — otherwise the process hangs.

})();