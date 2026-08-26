import requests
import re
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from config import BASE, AUTH

PATTERN = re.compile(r"VISUALPING\{[0-9a-fA-F]{16}\}")


def get_all_urls(html, base_url):
    """Return every URL referenced in an HTML document."""
    soup = BeautifulSoup(html, "html.parser")
    urls = set()
    # (tag_name, url_attribute) pairs to scan
    tags = [
        ("a", "href"),
        ("script", "src"),
        ("link", "href"),
        ("img", "src"),
        ("iframe", "src"),
        ("source", "src"),
        ("form", "action"),
    ]
    for tag_name, attr in tags:
        for tag in soup.find_all(tag_name):
            value = tag.get(attr)
            if value:
                urls.add(urljoin(base_url, value))
    return urls


def main():
    resp = requests.get(BASE, auth=AUTH, timeout=10)
    print("STATUS:", resp.status_code)
    print("\n--- HEADERS ---")
    for key, value in resp.headers.items():
        print(f"  {key}: {value}")
    print("\n--- PASSWORDS IN BODY ---")
    print(PATTERN.findall(resp.text))
    print("\n--- PASSWORDS IN RAW BYTES ---")
    print(PATTERN.findall(resp.content.decode("utf-8", errors="ignore")))

    urls = get_all_urls(resp.text, BASE)
    print(f"\nFound {len(urls)} URLs on the homepage:")
    for u in sorted(urls):
        print(" ", u)


if __name__ == "__main__":
    main()