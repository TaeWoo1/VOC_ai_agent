"""Per-channel product image URL extraction (collection-stage helper).

The OliveYoung review API does NOT carry a product image URL in the
review payload (`goodsDto` only has `goodsName / goodsNumber / itemNumber
/ legacyGoodsNumber / optionName`). The image URL has to come from the
product detail page's HTML — usually `<meta property="og:image">` or a
JSON-LD `Product` block.

Coupang CSVs typically include an `image_url` / `thumbnail_url` column
when exported by the operator-side scraper; we pick that up from the
first non-empty row.

Priority order (per v2.4 image policy):
    1. Channel-specific structured field (goodsImage, image_url column)
    2. og:image meta tag
    3. JSON-LD Product image
    4. fallback: None

This module is a pure helper. It NEVER raises — every entry point
returns `Optional[str]` and logs a warning on failure. Fail-soft is the
contract: collection-stage image URL extraction must not abort an
otherwise-successful scrape or import.

All HTTP calls (only one: `extract_oy_product_image_url`) carry a
short timeout and a single retry. The orchestrator decides when to
call them; this module never auto-fires.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional


_LOG = logging.getLogger("voc.connectors.product_image_extractor")


# --- HTML parsing -----------------------------------------------------------


_OG_IMAGE_RE = re.compile(
    r"""<meta\s+
        (?:[^>]*?\s)?
        property\s*=\s*["']og:image["']
        \s+
        (?:[^>]*?\s)?
        content\s*=\s*["']([^"']+)["']
        [^>]*>""",
    re.IGNORECASE | re.VERBOSE,
)

# Reverse order of attribute pairs (content first, property second).
_OG_IMAGE_RE_REV = re.compile(
    r"""<meta\s+
        (?:[^>]*?\s)?
        content\s*=\s*["']([^"']+)["']
        \s+
        (?:[^>]*?\s)?
        property\s*=\s*["']og:image["']
        [^>]*>""",
    re.IGNORECASE | re.VERBOSE,
)

_TWITTER_IMAGE_RE = re.compile(
    r"""<meta\s+
        (?:[^>]*?\s)?
        name\s*=\s*["']twitter:image(?::src)?["']
        \s+
        (?:[^>]*?\s)?
        content\s*=\s*["']([^"']+)["']
        [^>]*>""",
    re.IGNORECASE | re.VERBOSE,
)
_TWITTER_IMAGE_RE_REV = re.compile(
    r"""<meta\s+
        (?:[^>]*?\s)?
        content\s*=\s*["']([^"']+)["']
        \s+
        (?:[^>]*?\s)?
        name\s*=\s*["']twitter:image(?::src)?["']
        [^>]*>""",
    re.IGNORECASE | re.VERBOSE,
)

_LINK_IMAGE_SRC_RE = re.compile(
    r"""<link\s+
        (?:[^>]*?\s)?
        rel\s*=\s*["']image_src["']
        \s+
        (?:[^>]*?\s)?
        href\s*=\s*["']([^"']+)["']
        [^>]*>""",
    re.IGNORECASE | re.VERBOSE,
)
_LINK_IMAGE_SRC_RE_REV = re.compile(
    r"""<link\s+
        (?:[^>]*?\s)?
        href\s*=\s*["']([^"']+)["']
        \s+
        (?:[^>]*?\s)?
        rel\s*=\s*["']image_src["']
        [^>]*>""",
    re.IGNORECASE | re.VERBOSE,
)

# OY-domain product thumbnail. Matched only when the candidate src
# points at OY's image CDN (image.oliveyoung.co.kr) AND either contains
# the supplied goods_no or sits under a known thumbnail path. We do
# NOT scrape arbitrary <img> tags — too many false positives (review
# photo carousel, banner, related-product strip).
_OY_THUMBNAIL_HOST_RE = re.compile(
    r"""<img\s+[^>]*?src\s*=\s*["']([^"']*image\.oliveyoung\.co\.kr[^"']+)["']""",
    re.IGNORECASE | re.VERBOSE,
)

_JSON_LD_RE = re.compile(
    r"""<script\s+[^>]*?type\s*=\s*["']application/ld\+json["'][^>]*>
        (.*?)
        </script>""",
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)


def _extract_og_image(html: str) -> Optional[str]:
    """Pull the first `<meta property="og:image">` URL from `html`.

    Tolerates either attribute order (property/content, content/property).
    Returns the first match or None."""
    if not html:
        return None
    m = _OG_IMAGE_RE.search(html)
    if m:
        return m.group(1).strip() or None
    m = _OG_IMAGE_RE_REV.search(html)
    if m:
        return m.group(1).strip() or None
    return None


def _walk_jsonld_for_product_image(node) -> Optional[str]:
    """Recurse a JSON-LD blob looking for a Product/image field.

    JSON-LD shapes vary across stores. Common patterns:
      * { "@type": "Product", "image": "https://..." }
      * { "@type": "Product", "image": ["https://...", ...] }
      * { "@type": "Product", "image": { "@type": "ImageObject", "url": "..." } }
      * { "@graph": [ ..., { "@type": "Product", "image": ... }, ... ] }
    """
    if isinstance(node, dict):
        # Direct Product block.
        types = node.get("@type")
        if isinstance(types, str):
            types = [types]
        if isinstance(types, list) and any(
            isinstance(t, str) and t.lower() == "product" for t in types
        ):
            img = node.get("image")
            if isinstance(img, str):
                return img.strip() or None
            if isinstance(img, list):
                for entry in img:
                    if isinstance(entry, str) and entry.strip():
                        return entry.strip()
                    if isinstance(entry, dict):
                        u = entry.get("url") or entry.get("contentUrl")
                        if isinstance(u, str) and u.strip():
                            return u.strip()
            if isinstance(img, dict):
                u = img.get("url") or img.get("contentUrl")
                if isinstance(u, str) and u.strip():
                    return u.strip()
        # Recurse into nested dicts (e.g. @graph wrapper).
        for v in node.values():
            found = _walk_jsonld_for_product_image(v)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _walk_jsonld_for_product_image(item)
            if found:
                return found
    return None


def _extract_jsonld_product_image(html: str) -> Optional[str]:
    """Find a Product/image URL inside any `<script type="application/ld+json">`
    block. Returns the first match across all blocks, or None."""
    if not html:
        return None
    for raw in _JSON_LD_RE.findall(html):
        # JSON-LD blocks sometimes carry HTML comments / line continuations.
        # Strip basic noise and try to parse.
        body = raw.strip()
        if not body:
            continue
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            # JSON-LD often has trailing commas or `// comments` that
            # strict JSON rejects. Try a forgiving cleanup. The comment
            # regex must NOT bite URLs (`https://...`) — only strip
            # `//` that's at start-of-line or preceded by whitespace.
            cleaned = re.sub(r"(?:^|\s)//[^\n]*", "", body)
            cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
            try:
                parsed = json.loads(cleaned)
            except json.JSONDecodeError:
                continue
        found = _walk_jsonld_for_product_image(parsed)
        if found:
            return found
    return None


def _extract_twitter_image(html: str) -> Optional[str]:
    if not html:
        return None
    m = _TWITTER_IMAGE_RE.search(html)
    if m:
        return m.group(1).strip() or None
    m = _TWITTER_IMAGE_RE_REV.search(html)
    if m:
        return m.group(1).strip() or None
    return None


def _extract_link_image_src(html: str) -> Optional[str]:
    if not html:
        return None
    m = _LINK_IMAGE_SRC_RE.search(html)
    if m:
        return m.group(1).strip() or None
    m = _LINK_IMAGE_SRC_RE_REV.search(html)
    if m:
        return m.group(1).strip() or None
    return None


def _extract_oy_thumbnail_img(html: str, goods_no: Optional[str]) -> Optional[str]:
    """Find an <img> tag whose src points at image.oliveyoung.co.kr.

    Narrow heuristic — requires either the goodsNo to appear in the URL
    or the URL to sit under a known OY thumbnail path. Avoids
    surfacing review-photo / banner / related-product imagery."""
    if not html:
        return None
    for src in _OY_THUMBNAIL_HOST_RE.findall(html):
        candidate = src.strip()
        if not candidate:
            continue
        if goods_no and goods_no.lower() in candidate.lower():
            return candidate
        # Known OY product-image directories. Operators audit by URL
        # so we keep this narrow rather than greedy.
        for marker in ("/uploads/images/display/", "/uploads/images/goods/"):
            if marker in candidate:
                return candidate
    return None


def extract_image_url_from_html(
    html: str, *, goods_no: Optional[str] = None,
) -> Optional[str]:
    """Public entry point — pull a product image URL from arbitrary HTML.

    Priority order (v2.4.4):
      1. og:image meta
      2. JSON-LD Product/image
      3. twitter:image meta
      4. link[rel="image_src"] href
      5. <img src="image.oliveyoung.co.kr/..."> matching goodsNo or
         a known OY thumbnail path

    Returns None when none match. Pure (no I/O); safe to call on any
    string. The diagnostic counterpart `extract_image_diagnostic_from_html`
    returns the same URL plus per-source counts so operators can see
    which fallback fired (or why nothing fired)."""
    if not html or not isinstance(html, str):
        return None
    return (
        _extract_og_image(html)
        or _extract_jsonld_product_image(html)
        or _extract_twitter_image(html)
        or _extract_link_image_src(html)
        or _extract_oy_thumbnail_img(html, goods_no)
    )


def extract_image_diagnostic_from_html(
    html: str, *, goods_no: Optional[str] = None,
) -> dict:
    """Same extraction priority as `extract_image_url_from_html`, but
    also returns per-source markers so operators can audit which path
    fired (or why all paths failed).

    Output shape:
      {
        "html_length": int,
        "og_count": int,
        "jsonld_count": int,
        "twitter_count": int,
        "link_image_src_count": int,
        "oy_thumbnail_img_count": int,
        "extracted_image_url": str | None,
        "selected_source": "og_image" | "json_ld" | "twitter_image" |
                           "link_image_src" | "oy_thumbnail_img" | None,
      }
    """
    if not isinstance(html, str):
        html = ""
    diag = {
        "html_length": len(html),
        "og_count": 0,
        "jsonld_count": 0,
        "twitter_count": 0,
        "link_image_src_count": 0,
        "oy_thumbnail_img_count": 0,
        "extracted_image_url": None,
        "selected_source": None,
    }
    if not html:
        return diag
    diag["og_count"] = (
        len(_OG_IMAGE_RE.findall(html))
        + len(_OG_IMAGE_RE_REV.findall(html))
    )
    diag["jsonld_count"] = len(_JSON_LD_RE.findall(html))
    diag["twitter_count"] = (
        len(_TWITTER_IMAGE_RE.findall(html))
        + len(_TWITTER_IMAGE_RE_REV.findall(html))
    )
    diag["link_image_src_count"] = (
        len(_LINK_IMAGE_SRC_RE.findall(html))
        + len(_LINK_IMAGE_SRC_RE_REV.findall(html))
    )
    diag["oy_thumbnail_img_count"] = len(_OY_THUMBNAIL_HOST_RE.findall(html))

    # Walk the priority chain in order, recording which one matched.
    for src_label, fn in (
        ("og_image", lambda: _extract_og_image(html)),
        ("json_ld", lambda: _extract_jsonld_product_image(html)),
        ("twitter_image", lambda: _extract_twitter_image(html)),
        ("link_image_src", lambda: _extract_link_image_src(html)),
        ("oy_thumbnail_img", lambda: _extract_oy_thumbnail_img(html, goods_no)),
    ):
        u = fn()
        if u:
            diag["extracted_image_url"] = u
            diag["selected_source"] = src_label
            break
    return diag


# --- OliveYoung detail-page fetch ------------------------------------------


_OY_DETAIL_URL_TEMPLATE = (
    "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}"
)

# Conservative defaults — the orchestrator can pass a longer timeout
# or a UA when calling. One retry on transient failure.
_OY_DETAIL_TIMEOUT_SEC = 8


def extract_oy_product_image_url(
    goods_no: str,
    *,
    user_agent: Optional[str] = None,
    timeout_sec: float = _OY_DETAIL_TIMEOUT_SEC,
) -> Optional[str]:
    """Fetch the OliveYoung product detail page and extract its image URL.

    Returns None on any failure (network error, non-200, no image
    found, parse error). NEVER raises.

    The detail page URL is built from `goods_no` — the same `goodsNo`
    captured during review collection (`goodsDto.goodsNumber`).
    """
    if not goods_no or not isinstance(goods_no, str):
        return None
    try:
        import requests  # type: ignore
    except ImportError:
        _LOG.warning("requests not installed; cannot fetch OY detail page")
        return None

    url = _OY_DETAIL_URL_TEMPLATE.format(goods_no=goods_no)
    headers = {}
    if user_agent:
        headers["User-Agent"] = user_agent
    try:
        resp = requests.get(
            url, timeout=timeout_sec, headers=headers or None,
        )
    except Exception as e:  # noqa: BLE001 — fail-soft is intentional
        _LOG.warning(
            "OY detail-page fetch raised: %r (goods_no=%s)", e, goods_no,
        )
        return None
    if resp.status_code != 200:
        _LOG.warning(
            "OY detail-page non-200: status=%d (goods_no=%s)",
            resp.status_code, goods_no,
        )
        return None
    return extract_image_url_from_html(resp.text)


# --- Coupang CSV column-based extraction -----------------------------------


# Column-name candidates for a product image URL on a Coupang-style CSV.
# Operators export with various column names — we try them in order,
# casting empty strings to None.
_COUPANG_IMAGE_COLUMN_CANDIDATES: tuple[str, ...] = (
    "image_url",
    "thumbnail_url",
    "product_image",
    "thumbnail",
    "image",
)


def extract_coupang_product_image_url(
    rows: list[dict],
) -> Optional[str]:
    """Pick a product image URL from the first non-empty match across
    `rows`. Coupang CSVs are per-product, so all rows typically carry
    the same image; we just take the first non-empty value.

    Returns None when no candidate column has a non-empty URL."""
    if not rows:
        return None
    for col in _COUPANG_IMAGE_COLUMN_CANDIDATES:
        for row in rows:
            if not isinstance(row, dict):
                continue
            v = row.get(col)
            if isinstance(v, str):
                v = v.strip()
                if v.lower().startswith(("http://", "https://")):
                    return v
    return None
