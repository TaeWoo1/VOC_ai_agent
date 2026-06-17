"""Pure HTML parsing + URL validation for the detail-snapshot spike.

No network, no browser, no OpenAI. Everything here runs offline against a
string of HTML, so it is fully unit-testable from a saved fixture. The browser
work (and the only place network happens) lives in :mod:`capture`.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

# --- URL validation ----------------------------------------------------------

# Only first-party Coupang product/detail pages are in scope. Search and
# category listings are explicitly rejected — this spike reads ONE product page
# an operator hands us, never a crawl surface.
_ALLOWED_HOST_SUFFIX = "coupang.com"
_PRODUCT_PATH_MARKERS = ("/vp/products/", "/vm/products/", "/products/")
_REJECT_PATH_MARKERS = ("/np/search", "/np/categories", "/search", "/categories")


def validate_coupang_product_url(url: str) -> tuple[bool, str]:
    """Return ``(is_valid, reason)`` for a candidate detail URL.

    Accepts only ``http(s)`` URLs whose host ends in ``coupang.com`` and whose
    path looks like a product/detail page. Search/category paths and any other
    host are rejected with a human-readable Korean reason.
    """
    if not isinstance(url, str) or not url.strip():
        return False, "URL이 비어 있습니다."
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        return False, "http/https URL만 허용됩니다."
    host = (parsed.netloc or "").split("@")[-1].split(":")[0].lower()
    if not (host == _ALLOWED_HOST_SUFFIX or host.endswith("." + _ALLOWED_HOST_SUFFIX)):
        return False, "쿠팡(coupang.com) 도메인의 URL만 허용됩니다."
    path = (parsed.path or "").lower()
    if any(marker in path for marker in _REJECT_PATH_MARKERS):
        return False, "검색/카테고리 페이지는 대상이 아닙니다. 상품 상세 URL을 입력하세요."
    if not any(marker in path for marker in _PRODUCT_PATH_MARKERS):
        return False, "상품 상세 페이지 URL(.../products/...)이 아닙니다."
    return True, "ok"


def is_valid_coupang_product_url(url: str) -> bool:
    """Boolean convenience wrapper over :func:`validate_coupang_product_url`."""
    return validate_coupang_product_url(url)[0]


# --- HTML extraction ---------------------------------------------------------

# Candidate containers for the long detail region, in priority order. The first
# one present wins; if none match we fall back to the whole <body>.
_DETAIL_SELECTORS = (
    "div.product-detail-content",
    "div.product-detail",
    "#productDetail",
    "div.subType-IMAGE",
    "div.vendor-item",
    "#detail",
)

# img-like attributes Coupang/CDNs use for lazy loading.
_IMG_URL_ATTRS = ("src", "data-src", "data-original", "data-img-src", "data-lazy")

_WS_RE = re.compile(r"\s+")


def _soup(html: str) -> BeautifulSoup:
    # Prefer lxml (installed) but degrade to the stdlib parser so the module
    # never hard-depends on a particular parser being present.
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:  # pragma: no cover - parser fallback
        return BeautifulSoup(html, "html.parser")


def _clean_text(node) -> str:
    for tag in node.find_all(("script", "style", "noscript")):
        tag.decompose()
    return _WS_RE.sub(" ", node.get_text(" ", strip=True)).strip()


def _image_urls(node, base_url: str | None) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for img in node.find_all("img"):
        raw = ""
        for attr in _IMG_URL_ATTRS:
            val = img.get(attr)
            if val:
                raw = val.strip()
                break
        if not raw and img.get("srcset"):
            # srcset = "url1 1x, url2 2x" — take the first candidate URL.
            raw = img["srcset"].split(",")[0].strip().split(" ")[0]
        if not raw or raw.startswith("data:"):
            continue
        if raw.startswith("//"):
            raw = "https:" + raw
        elif base_url and not raw.lower().startswith(("http://", "https://")):
            raw = urljoin(base_url, raw)
        if not raw.lower().startswith(("http://", "https://")):
            continue
        if raw not in seen:
            seen.add(raw)
            urls.append(raw)
    return urls


def _product_name_candidate(soup: BeautifulSoup, title: str) -> str:
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return og["content"].strip()
    for sel in ("h1.prod-buy-header__title", "h2.prod-buy-header__title", "h1", "h2"):
        el = soup.select_one(sel)
        if el:
            text = el.get_text(" ", strip=True)
            if text:
                return _WS_RE.sub(" ", text)
    return title


def extract_from_html(html: str, *, base_url: str | None = None) -> dict:
    """Parse a detail page's HTML into snapshot-ready fields.

    Returns ``title`` / ``product_name_candidate`` / ``visible_text`` /
    ``image_urls`` / ``image_source_region`` (``"detail"`` when a known detail
    container matched, else ``"page_fallback"``). Pure: no network, no I/O.
    """
    soup = _soup(html or "")
    title = ""
    if soup.title and soup.title.string:
        title = _WS_RE.sub(" ", soup.title.string).strip()

    region = None
    region_name = "page_fallback"
    for sel in _DETAIL_SELECTORS:
        region = soup.select_one(sel)
        if region is not None:
            region_name = "detail"
            break
    if region is None:
        region = soup.body or soup

    return {
        "title": title,
        "product_name_candidate": _product_name_candidate(soup, title),
        "visible_text": _clean_text(region),
        "image_urls": _image_urls(region, base_url),
        "image_source_region": region_name,
    }
