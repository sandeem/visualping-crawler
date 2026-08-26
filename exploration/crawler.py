import requests
import re
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
from config import BASE, AUTH

# Captures the target secret format; reused across body, headers, and raw bytes.
PATTERN = re.compile(r"VISUALPING\{[0-9a-fA-F]{16}\}")

# Hard cap so a query-string explosion can never make the crawl run forever.
# Bump this (1000, 2000, ...) to crawl deeper — more pages = more passwords.
MAX_URLS = 1000


def same_host(url):
    """Only follow links that stay on the target host."""
    # Compare host:port only, so http/https and path differences don't matter.
    return urlparse(url).netloc == urlparse(BASE).netloc


def normalize_url(url):
    """Strip query string and fragment so ?v=6 and ?utm_source=... are the
    same resource — otherwise each variant inflates the queue and we never
    reach the pages that actually contain passwords."""
    parsed = urlparse(url)
    return parsed._replace(query="", fragment="").geturl()


def get_all_urls(html, base_url):
    soup = BeautifulSoup(html, "html.parser")
    urls = set()
    tags = [("a", "href"), ("script", "src"), ("link", "href"),
            ("img", "src"), ("iframe", "src"), ("source", "src"),
            ("form", "action")]
    for tag_name, attr in tags:
        for tag in soup.find_all(tag_name):
            value = tag.get(attr)
            if value:
                urls.add(urljoin(base_url, value))
    return urls


def crawl():
    visited = set()
    queue = [BASE]
    found_passwords = set()

    # Breadth-first traversal: pop the oldest item, so we fully cover the
    # homepage's direct children before descending deeper.
    while queue:
        url = queue.pop(0)
        # Normalize before dedup so query-string variants count as the same page.
        url = normalize_url(url)
        # Skip anything already seen — prevents re-fetching and cycles.
        if url in visited:
            continue
        visited.add(url)
        print(f"Fetching: {url}")

        # Bounded crawl: stop once we've fetched enough URLs, so a query-string
        # explosion can never make this run forever.
        if len(visited) >= MAX_URLS:
            print(f"\nReached the {MAX_URLS}-URL cap — stopping the crawl.")
            break

        try:
            resp = requests.get(url, auth=AUTH, timeout=10)
        except Exception as e:
            # A single failed URL shouldn't abort the whole crawl.
            print(f"  ERROR: {e}")
            continue

        # Search body, headers, and raw bytes
        found_passwords.update(PATTERN.findall(resp.text))
        found_passwords.update(PATTERN.findall(str(resp.headers)))
        found_passwords.update(
            PATTERN.findall(resp.content.decode("utf-8", errors="ignore"))
        )

        # Only parse HTML/CSS/JS for more links
        content_type = resp.headers.get("Content-Type", "")
        if ("text/html" in content_type or "text/css" in content_type
                or "javascript" in content_type):
            for link in get_all_urls(resp.text, url):
                # Normalize before checking the visited set, so a link like
                # /page?ref=related is treated as the same page as /page.
                link = normalize_url(link)
                if same_host(link) and link not in visited:
                    queue.append(link)

    print(f"\nVisited {len(visited)} URLs")
    print(f"Passwords found ({len(found_passwords)}):")
    for p in found_passwords:
        print(" ", p)


if __name__ == "__main__":
    crawl()