"""One-shot CLI: scrape Coupang product reviews for a given search query.

Ports the core scraper from ``coupang/test.ipynb`` (Cell 0 only — cable-analysis
cells are deliberately excluded). Writes a CSV matching
``CoupangCSVConnector``'s expected column contract plus an optional JSONL for
debugging.

Usage:
    PYTHONPATH=. python3 scripts/scrape_coupang_reviews.py \\
        [--query "리퀴드 블러쉬"] \\
        [--top-products 5] \\
        [--max-reviews 300] \\
        [--output-csv coupang/coupang_blush_reviews.csv] \\
        [--output-jsonl coupang/coupang_blush_products.jsonl] \\
        [--headful] [--debug-dir debug_dumps] \\
        [--product-url URL] [--chrome-major N]

Environment / deps:
    Requires the [scraping] optional extra:
        python3.13 -m pip install -e '.[scraping]'
    (Adds selenium + undetected-chromedriver. Chrome must be installed.)

    **Python 3.13 recommended.** ``undetected-chromedriver`` 3.5.5 (the latest
    as of 2026-04) imports ``distutils.version`` which was removed in
    Python 3.12+. On 3.14 the import fails at startup. The rest of this repo
    runs fine on 3.14 — the constraint applies to this scraper only. Invoke
    with the 3.13 binary explicitly, e.g.
        /opt/homebrew/opt/python@3.13/bin/python3.13 scripts/scrape_coupang_reviews.py ...

Key difference from the notebook: the CSV's ``product_index`` column holds the
STABLE Coupang internal product ID extracted from ``/vp/products/<ID>``, not
a 1-based run-local position. This keeps product_external_id persistent across
re-scrapes so ``data/phase1_product_labels.json`` curation survives reruns.

Nothing in this script touches Phase 1 reporting contracts. It's a one-shot
data-collection tool; downstream ingest / report code is unchanged.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import random
import re
import sys
import time
from dataclasses import asdict, dataclass
from hashlib import sha1
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import quote_plus

# ---------------------------------------------------------------------------
# Gated imports — [scraping] extra
# ---------------------------------------------------------------------------

try:
    import undetected_chromedriver as uc
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait
except ImportError as e:  # pragma: no cover
    sys.stderr.write(
        "scrape_coupang_reviews.py requires the [scraping] extra.\n"
        "Install with: pip install -e '.[scraping]'\n"
        f"(Missing module: {e.name})\n"
    )
    sys.exit(2)


logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = REPO_ROOT / "coupang" / "coupang_blush_reviews.csv"
DEFAULT_JSONL = REPO_ROOT / "coupang" / "coupang_blush_products.jsonl"
DEFAULT_DEBUG_DIR = REPO_ROOT / "debug_dumps"

# Coupang search URL template. `listSize=72` asks for 72 results per page.
SEARCH_URL_TEMPLATE = (
    "https://www.coupang.com/np/search"
    "?component=&q={query}&channel=user&listSize=72"
)


# ---------------------------------------------------------------------------
# Config + data models
# ---------------------------------------------------------------------------


@dataclass
class Config:
    search_url: str
    top_n_products: Optional[int]
    max_reviews: Optional[int]
    out_csv: Path
    out_jsonl: Optional[Path]
    headless: bool
    debug_dir: Path

    # Per-SKU mode: when non-empty, skip search entirely and scrape these
    # product URLs directly. Aligns the Coupang flow with OliveYoung's
    # single-item browser ingest.
    product_urls: list[str] = None  # type: ignore[assignment]

    # When set, pass `version_main=<int>` to uc.Chrome so the bundled
    # chromedriver is downloaded for that Chrome major version. Use this
    # when the local Chrome binary is one major behind/ahead of the
    # version the installed undetected_chromedriver release expects.
    # `None` (default) preserves prior behavior — uc.Chrome auto-detects.
    chrome_major: Optional[int] = None

    # Fixed tunables ported from notebook; not exposed as CLI flags to keep
    # the knob surface narrow.
    search_scroll_rounds: int = 6
    search_scroll_px: int = 1100
    wait_timeout: int = 30
    early_stop_no_new_text_pages: int = 5
    early_stop_max_pages: int = 200


@dataclass
class Review:
    author: str
    date: str
    stars: int
    title: str
    content: str


@dataclass
class ProductInfo:
    """A Coupang product at scrape time.

    ``stable_id`` is the integer-string extracted from ``/vp/products/<ID>``.
    This value is what lands in the CSV's ``product_index`` column and then
    in ``phase1_reviews.product_external_id`` at ingest time.
    """

    stable_id: str
    product_url: str
    product_title: str
    product_price: str
    product_rating_summary: str
    product_reviewcount_summary: str


# ---------------------------------------------------------------------------
# URL helpers — the one meaningful deviation from the notebook
# ---------------------------------------------------------------------------


_PRODUCT_ID_RE = re.compile(r"/vp/products/(\d+)")


def extract_stable_product_id(url: str) -> Optional[str]:
    """Return the Coupang product ID from a product URL, or None.

    Path-anchored; ignores query strings. The ID is numeric in all Coupang
    URLs observed to date; we preserve it as a string so the value flows
    through the pipeline without int coercion (matching how
    ``CoupangCSVConnector`` reads the ``product_index`` CSV column).
    """
    if not url:
        return None
    m = _PRODUCT_ID_RE.search(url)
    return m.group(1) if m else None


def normalize_product_url(url: str) -> Optional[Tuple[str, str]]:
    """Return ``(normalized_url, stable_id)`` or None when extraction fails.

    Normalization strips tracking params by reconstructing from the ID alone,
    which is enough for Coupang's product-detail routing.
    """
    sid = extract_stable_product_id(url)
    if not sid:
        return None
    return (f"https://www.coupang.com/vp/products/{sid}", sid)


# ---------------------------------------------------------------------------
# Misc utilities (ported)
# ---------------------------------------------------------------------------


def human_sleep(a: float = 0.6, b: float = 1.3) -> None:
    time.sleep(random.uniform(a, b))


def safe_text(el) -> str:
    try:
        return (el.text or "").strip()
    except Exception:
        return ""


def scroll_by(driver, px: int) -> None:
    driver.execute_script(f"window.scrollBy(0, {px});")


def scroll_into_view(driver, el) -> bool:
    try:
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        return True
    except Exception:
        return False


def short_hash(s: str) -> str:
    return sha1(s.encode("utf-8", errors="ignore")).hexdigest()[:16]


def dump_debug(driver, cfg: Config, tag: str) -> None:
    """Save screenshot + page source to debug_dir on error. Best-effort only."""
    cfg.debug_dir.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    safe_tag = re.sub(r"[^a-zA-Z0-9._-]+", "_", tag)[:80]
    png = cfg.debug_dir / f"{ts}_{safe_tag}.png"
    html = cfg.debug_dir / f"{ts}_{safe_tag}.html"
    try:
        driver.save_screenshot(str(png))
    except Exception:
        pass
    try:
        html.write_text(driver.page_source, encoding="utf-8")
    except Exception:
        pass
    logger.info("[DEBUG DUMP] saved: %s / %s", png, html)


# ---------------------------------------------------------------------------
# JSON-LD parsing
# ---------------------------------------------------------------------------


def parse_product_jsonld(page_source: str) -> Optional[dict]:
    scripts = re.findall(
        r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
        page_source,
        flags=re.DOTALL | re.IGNORECASE,
    )
    for raw in scripts:
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        candidates = data if isinstance(data, list) else [data]
        for obj in candidates:
            if not isinstance(obj, dict):
                continue
            if obj.get("@type") == "Product":
                agg = obj.get("aggregateRating") or {}
                offers = obj.get("offers") or {}
                if isinstance(offers, list) and offers:
                    offers = offers[0]
                return {
                    "name": obj.get("name"),
                    "ratingValue": agg.get("ratingValue") if isinstance(agg, dict) else None,
                    "ratingCount": agg.get("ratingCount") if isinstance(agg, dict) else None,
                    "reviewCount": agg.get("reviewCount") if isinstance(agg, dict) else None,
                    "price": offers.get("price") if isinstance(offers, dict) else None,
                }
    return None


# ---------------------------------------------------------------------------
# Search: collect + dedupe product URLs
# ---------------------------------------------------------------------------


def collect_product_links(
    driver, wait: WebDriverWait, cfg: Config,
) -> list[Tuple[str, str]]:
    """Scroll the search page and return ``[(normalized_url, stable_id), ...]``.

    Deduplication is by stable_id (so duplicate search-tile URLs for the same
    product collapse to one entry), preserving first-seen order.

    Warm-up step: a direct ``GET /np/search`` hits Coupang's Akamai bot layer
    and returns 403 even with undetected_chromedriver. Visiting the homepage
    first lets the fingerprint cookies settle, after which the search URL
    loads normally. Confirmed empirically 2026-04.
    """
    logger.info("홈페이지 워밍업: https://www.coupang.com/")
    driver.get("https://www.coupang.com/")
    human_sleep(3.0, 4.5)

    logger.info("검색 페이지 접속 + 상품 링크 수집: %s", cfg.search_url)
    driver.get(cfg.search_url)
    human_sleep(1.0, 1.8)

    wait.until(EC.presence_of_element_located(
        (By.CSS_SELECTOR, "a[href*='/vp/products/']")
    ))
    for _ in range(cfg.search_scroll_rounds):
        scroll_by(driver, cfg.search_scroll_px)
        human_sleep(0.5, 1.0)

    anchors = driver.find_elements(By.CSS_SELECTOR, "a[href*='/vp/products/']")
    pairs: list[Tuple[str, str]] = []
    seen: set[str] = set()
    for a in anchors:
        href = a.get_attribute("href")
        if not href:
            continue
        if "coupang.com" not in href:
            href = "https://www.coupang.com" + href
        norm = normalize_product_url(href)
        if not norm:
            continue
        url, sid = norm
        if sid in seen:
            continue
        seen.add(sid)
        pairs.append((url, sid))

    logger.info("수집 결과: %d개 상품 (stable_id 기준 dedupe)", len(pairs))
    return pairs


# ---------------------------------------------------------------------------
# Product-page parsing (ported)
# ---------------------------------------------------------------------------


def get_title(driver, jsonld: Optional[dict] = None) -> str:
    if jsonld and jsonld.get("name"):
        return str(jsonld["name"]).strip()
    try:
        og = driver.find_element(
            By.CSS_SELECTOR, "meta[property='og:title']",
        ).get_attribute("content")
        if og:
            return og.strip()
    except Exception:
        pass
    return (driver.title or "").strip() or "상품명 확인 실패"


def get_price(driver, jsonld: Optional[dict] = None) -> str:
    for css in (
        ".price-amount.final-price-amount",
        ".final-price-amount",
        "span.total-price > strong",
        "span.total-price strong",
        ".prod-sale-price",
    ):
        try:
            t = driver.find_element(By.CSS_SELECTOR, css).text.strip()
            if t:
                return t
        except Exception:
            pass
    if jsonld and jsonld.get("price") is not None:
        return str(jsonld["price"])
    return "가격 정보 없음"


def get_rating_reviewcount_summary(jsonld: Optional[dict] = None) -> Tuple[str, str]:
    if jsonld:
        rv = jsonld.get("ratingValue")
        rc = jsonld.get("ratingCount") or jsonld.get("reviewCount")
        if rv is not None and rc is not None:
            return str(rv), str(rc)
    return "0", "0"


# ---------------------------------------------------------------------------
# Review tab + article parsing (ported)
# ---------------------------------------------------------------------------


def go_to_review_section(driver, wait: WebDriverWait) -> None:
    for _ in range(3):
        scroll_by(driver, 900)
        human_sleep(0.35, 0.75)
    try:
        driver.execute_script("location.hash = 'btfTab';")
    except Exception:
        pass
    human_sleep(0.6, 1.0)
    scroll_by(driver, 1200)
    human_sleep(0.6, 1.0)

    for xp in (
        "//*[self::a or self::button][contains(., '상품평')]",
        "//*[self::a or self::button][contains(., '리뷰')]",
    ):
        try:
            tab = driver.find_element(By.XPATH, xp)
            scroll_into_view(driver, tab)
            human_sleep(0.2, 0.5)
            tab.click()
            human_sleep(0.8, 1.4)
            break
        except Exception:
            continue

    wait.until(EC.presence_of_element_located((
        By.XPATH, "//article[contains(@class,'twc-') or contains(@class,'review')]"
    )))


def find_review_articles(driver):
    for xp in (
        "//article[contains(@class,'twc-pt-') and contains(@class,'twc-border-b')]",
        "//article[contains(@class,'twc-') and contains(@class,'border')]",
        "//article[contains(@class,'review')]",
        "//article",
    ):
        els = driver.find_elements(By.XPATH, xp)
        if els:
            return els
    return []


def parse_review_article(article) -> Optional[Review]:
    # Content — reject reviews with <5 non-whitespace chars.
    content = ""
    try:
        el = article.find_element(
            By.CSS_SELECTOR,
            "div.twc-text-bluegray-900.twc-break-all span.twc-bg-white",
        )
        content = safe_text(el)
    except Exception:
        try:
            el = article.find_element(
                By.CSS_SELECTOR, "div.twc-text-bluegray-900.twc-break-all"
            )
            content = safe_text(el)
        except Exception:
            content = ""
    content = (content or "").strip()
    if len(re.sub(r"\s+", "", content)) < 5:
        return None

    # Stars
    try:
        stars = len(article.find_elements(By.CSS_SELECTOR, "i.twc-bg-full-star"))
    except Exception:
        stars = 0

    # Author
    author = ""
    for css in (
        "span[data-member-id].twc-font-bold",
        "span.twc-font-bold",
    ):
        try:
            author = safe_text(article.find_element(By.CSS_SELECTOR, css))
            if author:
                break
        except Exception:
            continue

    # Date — Coupang renders YYYY.MM.DD or YYYY.MM
    date = ""
    try:
        for d in article.find_elements(By.CSS_SELECTOR, "div.twc-text-bluegray-700"):
            t = safe_text(d)
            if re.match(r"^\d{4}\.\d{2}(\.\d{2})?$", t):
                date = t
                break
    except Exception:
        pass

    # Title (may be empty)
    title = ""
    try:
        title = safe_text(article.find_element(
            By.CSS_SELECTOR, "div.twc-font-bold.twc-text-bluegray-900"
        ))
    except Exception:
        title = ""

    return Review(author=author, date=date, stars=stars, title=title, content=content)


# ---------------------------------------------------------------------------
# Pagination (ported)
# ---------------------------------------------------------------------------


def get_review_root(driver):
    for xp in (
        "//*[contains(., '상품평')]/ancestor::*[self::section or self::div][1]",
        "//div[contains(@class,'sdp-review')]",
        "//section[contains(@class,'sdp-review')]",
        "//div[@id='btfTab']/following::*[self::div or self::section][1]",
    ):
        try:
            el = driver.find_element(By.XPATH, xp)
            if el:
                return el
        except Exception:
            continue
    return None


def get_pagination_container(driver):
    root = get_review_root(driver)
    scope = root if root is not None else driver
    candidates = scope.find_elements(
        By.CSS_SELECTOR, "div[data-page][data-start][data-end]"
    )
    if candidates:
        return candidates[-1]
    try:
        btns = scope.find_elements(By.CSS_SELECTOR, "button")
        if btns:
            return btns[-1].find_element(By.XPATH, "./ancestor::div[1]")
    except Exception:
        pass
    return None


def get_group_range(container) -> Tuple[Optional[int], Optional[int]]:
    try:
        return int(container.get_attribute("data-start")), int(container.get_attribute("data-end"))
    except Exception:
        return None, None


def get_first_review_signature(driver) -> str:
    arts = find_review_articles(driver)
    if not arts:
        return ""
    r = parse_review_article(arts[0])
    if not r:
        return safe_text(arts[0])[:200]
    return short_hash(f"{r.author}|{r.date}|{r.stars}|{r.title}|{r.content[:120]}")


def click_element_robust(driver, el) -> bool:
    try:
        el.click()
        return True
    except Exception:
        pass
    try:
        ActionChains(driver).move_to_element(el).pause(0.1).click(el).perform()
        return True
    except Exception:
        pass
    try:
        driver.execute_script("arguments[0].click();", el)
        return True
    except Exception:
        return False


def click_page_number(driver, wait: WebDriverWait, page_num: int) -> bool:
    container = get_pagination_container(driver)
    if not container:
        return False
    before = get_first_review_signature(driver)
    try:
        btn = container.find_element(
            By.XPATH, f".//button[.//span[normalize-space()='{page_num}']]"
        )
    except Exception:
        return False
    scroll_into_view(driver, btn)
    human_sleep(0.15, 0.4)
    if not click_element_robust(driver, btn):
        return False
    try:
        wait.until(lambda d: get_first_review_signature(d) not in (before, ""))
    except TimeoutException:
        pass
    human_sleep(0.4, 0.9)
    return True


def find_right_arrow_button(container):
    btns = container.find_elements(By.CSS_SELECTOR, "button")
    for b in reversed(btns):
        try:
            if b.find_elements(By.CSS_SELECTOR, "span"):
                continue
            svgs = b.find_elements(By.CSS_SELECTOR, "svg")
            if not svgs:
                continue
            svg_cls = svgs[0].get_attribute("class") or ""
            if "twc-rotate-[180deg]" in svg_cls:
                continue
            return b
        except Exception:
            continue
    return None


def get_page_numbers_signature(container) -> str:
    try:
        nums: list[int] = []
        for s in container.find_elements(By.CSS_SELECTOR, "button span"):
            t = safe_text(s)
            if t.isdigit():
                nums.append(int(t))
        if not nums:
            return ""
        return f"{min(nums)}-{max(nums)}-{len(nums)}"
    except Exception:
        return ""


def click_next_group_arrow(driver, wait: WebDriverWait, retry: int = 8) -> bool:
    for _ in range(retry):
        container = get_pagination_container(driver)
        if not container:
            return False
        before_range = get_group_range(container)
        before_sig = get_page_numbers_signature(container)
        arrow = find_right_arrow_button(container)
        if not arrow or arrow.get_attribute("disabled") is not None:
            return False
        scroll_into_view(driver, arrow)
        human_sleep(0.15, 0.4)
        if not click_element_robust(driver, arrow):
            scroll_by(driver, 350)
            human_sleep(0.3, 0.7)
            continue

        def changed(d):
            c = get_pagination_container(d)
            if not c:
                return True
            return (get_group_range(c) != before_range
                    or get_page_numbers_signature(c) != before_sig)

        try:
            wait.until(changed)
            return True
        except TimeoutException:
            scroll_by(driver, 500)
            human_sleep(0.4, 0.8)
    return False


def collect_all_reviews(
    driver, wait: WebDriverWait, cfg: Config,
) -> list[Review]:
    go_to_review_section(driver, wait)

    seen: set[str] = set()
    out: list[Review] = []
    visited_groups: set[Tuple[int, int]] = set()
    no_new_text_pages = 0
    pages_processed = 0

    while True:
        container = get_pagination_container(driver)
        if not container:
            return out

        start, end = get_group_range(container)
        if start is None or end is None:
            nums: list[int] = []
            try:
                for s in container.find_elements(By.CSS_SELECTOR, "button span"):
                    t = safe_text(s)
                    if t.isdigit():
                        nums.append(int(t))
            except Exception:
                nums = []
            if not nums:
                return out
            start, end = min(nums), max(nums)

        group_key = (start, end)
        if group_key in visited_groups:
            return out
        visited_groups.add(group_key)

        for p in range(start, end + 1):
            if pages_processed >= cfg.early_stop_max_pages:
                logger.info("[EARLY STOP] max pages reached: %d",
                            cfg.early_stop_max_pages)
                return out
            click_page_number(driver, wait, p)
            pages_processed += 1

            new_this_page = 0
            for a in find_review_articles(driver):
                r = parse_review_article(a)
                if not r:
                    continue
                key = (
                    f"{r.author}|{r.date}|{r.stars}|"
                    f"{short_hash((r.title + ' ' + r.content)[:2000])}"
                )
                if key in seen:
                    continue
                seen.add(key)
                out.append(r)
                new_this_page += 1
                if cfg.max_reviews is not None and len(out) >= cfg.max_reviews:
                    return out

            if new_this_page == 0:
                no_new_text_pages += 1
                logger.info("[EARLY STOP] page %d: 0 new text reviews (%d/%d)",
                            p, no_new_text_pages, cfg.early_stop_no_new_text_pages)
                if no_new_text_pages >= cfg.early_stop_no_new_text_pages:
                    logger.info("[EARLY STOP] no-new-text threshold hit")
                    return out
            else:
                no_new_text_pages = 0

        if not click_next_group_arrow(driver, wait, retry=8):
            return out


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------


CSV_FIELDNAMES = [
    "product_index",
    "product_url",
    "product_title",
    "product_price",
    "product_rating_summary",
    "product_reviewcount_summary",
    "review_index",
    "review_author",
    "review_date",
    "review_stars",
    "review_title",
    "review_content",
]


def reset_output_files(csv_path: Path, jsonl_path: Optional[Path]) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.write_text("", encoding="utf-8")
    if jsonl_path is not None:
        jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        jsonl_path.write_text("", encoding="utf-8")


def append_reviews_csv(path: Path, rows: list[dict]) -> None:
    file_exists = path.exists() and path.stat().st_size > 0
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def append_jsonl(path: Path, record: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Product page orchestration
# ---------------------------------------------------------------------------


def parse_product_page(driver, stable_id: str) -> ProductInfo:
    jsonld = parse_product_jsonld(driver.page_source)
    title = get_title(driver, jsonld=jsonld)
    price = get_price(driver, jsonld=jsonld)
    rating_summary, review_count_summary = get_rating_reviewcount_summary(jsonld=jsonld)
    return ProductInfo(
        stable_id=stable_id,
        product_url=driver.current_url,
        product_title=title,
        product_price=price,
        product_rating_summary=rating_summary,
        product_reviewcount_summary=review_count_summary,
    )


def product_to_csv_rows(product: ProductInfo, reviews: list[Review]) -> list[dict]:
    """Build CSV rows. ``product_index`` carries the stable Coupang ID."""
    rows = []
    for r_idx, r in enumerate(reviews, start=1):
        rows.append({
            "product_index": product.stable_id,
            "product_url": product.product_url,
            "product_title": product.product_title,
            "product_price": product.product_price,
            "product_rating_summary": product.product_rating_summary,
            "product_reviewcount_summary": product.product_reviewcount_summary,
            "review_index": r_idx,
            "review_author": r.author,
            "review_date": r.date,
            "review_stars": r.stars,
            "review_title": r.title,
            "review_content": r.content,
        })
    return rows


def product_to_jsonl_record(product: ProductInfo, reviews: list[Review]) -> dict:
    """Build the debug JSONL record.

    Includes ``product_id`` alongside ``product_index`` for clarity when a
    human inspects the file — both hold the same stable Coupang ID.
    """
    return {
        "product_id": product.stable_id,
        "product_index": product.stable_id,
        "product_url": product.product_url,
        "product_title": product.product_title,
        "product_price": product.product_price,
        "product_rating_summary": product.product_rating_summary,
        "product_reviewcount_summary": product.product_reviewcount_summary,
        "reviews": [asdict(r) for r in reviews],
    }


# ---------------------------------------------------------------------------
# Driver lifecycle
# ---------------------------------------------------------------------------


def get_driver(cfg: Config):
    options = uc.ChromeOptions()
    if cfg.headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    chrome_kwargs: dict = {"options": options, "use_subprocess": True}
    if cfg.chrome_major is not None:
        # Pin the chromedriver download to the local Chrome major version.
        # Required when the installed undetected_chromedriver release ships a
        # driver for a different Chrome major than the one available locally.
        chrome_kwargs["version_main"] = cfg.chrome_major
    driver = uc.Chrome(**chrome_kwargs)
    try:
        driver.maximize_window()
    except Exception:
        pass
    return driver


def run(cfg: Config) -> int:
    reset_output_files(cfg.out_csv, cfg.out_jsonl)
    driver = None
    exit_code = 0
    try:
        driver = get_driver(cfg)
        wait = WebDriverWait(driver, cfg.wait_timeout)

        if cfg.product_urls:
            pairs = []
            for raw in cfg.product_urls:
                norm = normalize_product_url(raw)
                if not norm:
                    logger.error("invalid Coupang product URL (no stable id): %s", raw)
                    continue
                pairs.append(norm)
            if not pairs:
                logger.error("no valid product URLs in --product-url inputs")
                return 2
            # Warm-up: run the full search warm-up (homepage → search URL →
            # scroll) to seed Akamai cookies, then discard search results and
            # use the caller-supplied product URLs. Homepage alone is not
            # enough — /vp/products/... via cold GET closes the window
            # (confirmed 2026-04).
            logger.info("per-SKU mode: running search warm-up then scraping %d URL(s)", len(pairs))
            try:
                _ = collect_product_links(driver, wait, cfg)
            except Exception as e:
                logger.warning("search warm-up error (continuing anyway): %s", e)
        else:
            try:
                pairs = collect_product_links(driver, wait, cfg)
            except Exception as e:
                logger.error("검색 페이지 수집 실패: %s", e)
                dump_debug(driver, cfg, "search_page_fail")
                raise
        targets = pairs[: cfg.top_n_products] if cfg.top_n_products else pairs
        logger.info("상위 %d개 상품을 처리합니다.", len(targets))

        total_rows = 0
        for i, (url, sid) in enumerate(targets, start=1):
            logger.info("[%d/%d] %s (id=%s)", i, len(targets), url, sid)
            try:
                driver.get(url)
                human_sleep(1.8, 3.0)
                product = parse_product_page(driver, sid)

                try:
                    reviews = collect_all_reviews(driver, wait, cfg)
                except Exception as e:
                    logger.error("[%d] 리뷰 수집 실패: %s", i, e)
                    dump_debug(driver, cfg, f"reviews_fail_{sid}")
                    reviews = []

                if cfg.out_jsonl is not None:
                    append_jsonl(cfg.out_jsonl, product_to_jsonl_record(product, reviews))

                rows = product_to_csv_rows(product, reviews)
                if rows:
                    append_reviews_csv(cfg.out_csv, rows)
                total_rows += len(rows)

                logger.info(
                    "상품명: %s · 가격: %s · 요약 %s★ (%s) · 수집 %d건",
                    product.product_title, product.product_price,
                    product.product_rating_summary,
                    product.product_reviewcount_summary,
                    len(reviews),
                )
                human_sleep(0.8, 1.6)
            except KeyboardInterrupt:
                logger.warning("Ctrl-C detected; 지금까지 수집된 데이터는 파일에 저장됨")
                exit_code = 130
                break
            except Exception as e:
                logger.error("[%d] 상품 처리 중 오류: %s", i, e)
                dump_debug(driver, cfg, f"product_fail_{sid}")
                continue

        logger.info("완료: CSV %s (%d rows), JSONL %s",
                    cfg.out_csv, total_rows, cfg.out_jsonl)
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
    return exit_code


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scrape Coupang product reviews.")
    p.add_argument("--query", default="리퀴드 블러쉬",
                   help="Korean search term (default: '리퀴드 블러쉬').")
    p.add_argument("--top-products", dest="top_products", type=int, default=5,
                   help="Number of products to scrape from search results (default: 5).")
    p.add_argument("--max-reviews", dest="max_reviews", type=int, default=300,
                   help="Per-product review cap (default: 300).")
    p.add_argument("--output-csv", dest="output_csv", type=Path, default=DEFAULT_CSV,
                   help=f"CSV output path (default: {DEFAULT_CSV}).")
    p.add_argument("--output-jsonl", dest="output_jsonl", type=str,
                   default=str(DEFAULT_JSONL),
                   help=f"JSONL output path; pass empty string to skip (default: {DEFAULT_JSONL}).")
    p.add_argument("--debug-dir", dest="debug_dir", type=Path, default=DEFAULT_DEBUG_DIR,
                   help=f"Where to dump screenshots + HTML on error (default: {DEFAULT_DEBUG_DIR}).")
    p.add_argument("--headful", action="store_true",
                   help="Show the Chromium window (debug only).")
    p.add_argument("--search-url-override", dest="search_url_override",
                   default=None,
                   help="Use this exact search URL instead of building one from --query.")
    p.add_argument("--product-url", dest="product_urls", action="append",
                   default=None,
                   help="Scrape this Coupang product URL directly, bypassing "
                        "search. Repeatable. When provided, --query / "
                        "--top-products / --search-url-override are ignored.")
    p.add_argument("--chrome-major", dest="chrome_major", type=int, default=None,
                   help="Pin the bundled chromedriver to this Chrome major "
                        "version (e.g., 147). Use when the installed "
                        "undetected_chromedriver release ships a driver for a "
                        "different Chrome major than the one available locally. "
                        "Default None → uc.Chrome auto-detects.")
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    search_url = args.search_url_override or SEARCH_URL_TEMPLATE.format(
        query=quote_plus(args.query)
    )
    jsonl_path = Path(args.output_jsonl) if args.output_jsonl else None

    cfg = Config(
        search_url=search_url,
        top_n_products=args.top_products,
        max_reviews=args.max_reviews,
        out_csv=args.output_csv,
        out_jsonl=jsonl_path,
        headless=not args.headful,
        debug_dir=args.debug_dir,
        product_urls=args.product_urls or [],
        chrome_major=args.chrome_major,
    )
    if cfg.product_urls:
        logger.info("config: per-SKU mode urls=%s max_reviews=%d csv=%s jsonl=%s headless=%s",
                    cfg.product_urls, cfg.max_reviews,
                    cfg.out_csv, cfg.out_jsonl, cfg.headless)
    else:
        logger.info("config: query=%r top=%d max_reviews=%d csv=%s jsonl=%s headless=%s",
                    args.query, cfg.top_n_products, cfg.max_reviews,
                    cfg.out_csv, cfg.out_jsonl, cfg.headless)

    return run(cfg)


if __name__ == "__main__":
    sys.exit(main())
