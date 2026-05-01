"""Cardnews HTML/CSS → 1080×1350 PNG renderer (Playwright).

Pure presentation layer. Takes a long-layout dict produced by
`src/voc/content/cardnews_long_layout.py`, runs the safety validator,
resolves the product image via the layered fallback chain, then
renders one PNG per page with Playwright (chromium-headless-shell at
deviceScaleFactor=2 → 2160×2700 actual pixels).

Image fallback chain
--------------------
1. CLI override `--product-image-path <local file>` (wins if exists)
2. CLI URL `--product-image-url <https://…>` — fetched once into a
   temp file, 5-second timeout + single retry, give up silently
3. `analysis_report.product.image_url` (currently always None until
   the OY connector phase lands; the pass-through still works)
4. CSS gradient fallback — `.cover--no-image` class on the cover

Image fetch failures NEVER raise out of the renderer — they fall
through silently to the next step in the chain.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.sync_api import sync_playwright

from cardnews.safety_validator import (
    CardnewsSafetyError,
    validate_cardnews_safety,
)
from src.voc.content.cardnews_long_layout import build_long_cardnews_layout


_THIS_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = _THIS_DIR / "templates"
STYLES_DIR = _THIS_DIR / "styles"
CSS_FILENAME = "cardnews.css"

PAGE_WIDTH = 1080
PAGE_HEIGHT = 1350
DEVICE_SCALE_FACTOR = 2

_LOG = logging.getLogger("cardnews.render")


# Per-page-type → template filename. Adding a new page type means
# adding a new template; failing fast here is intentional so a
# silent fallback never ships an unstyled page.
_TEMPLATE_BY_TYPE: dict[str, str] = {
    "cover": "cover.html.j2",
    "hook": "hook.html.j2",
    "method": "method.html.j2",
    "loved": "loved.html.j2",
    "divides": "divides.html.j2",
    "checkpoints": "checkpoints.html.j2",
    "caution_attr": "caution_attr.html.j2",
    "positive_attr": "positive_attr.html.j2",
    "audience": "audience.html.j2",
    "cta": "cta.html.j2",
}


# ---------------------------------------------------------------------------
# Image resolution (fallback chain)
# ---------------------------------------------------------------------------


@dataclass
class ResolvedImage:
    source: str
    url: str | None
    local_path: str | None
    usage: str = "cover_full_bleed"

    def to_layout(self) -> dict:
        return {
            "source": self.source,
            "url": self.url,
            "local_path": self.local_path,
            "usage": self.usage,
        }


_GRADIENT_FALLBACK = ResolvedImage(
    source="fallback_gradient",
    url=None,
    local_path=None,
)


def _resolve_product_image(
    *,
    cli_path: str | None,
    cli_url: str | None,
    report_url: str | None,
    work_dir: Path,
) -> ResolvedImage:
    """Walk the fallback chain. Image fetch failures degrade silently
    to the next step — they never raise out of this function."""
    if cli_path:
        p = Path(cli_path).expanduser().resolve()
        if p.exists() and p.is_file():
            return ResolvedImage(
                source="cli_path",
                url=None,
                local_path=str(p),
            )
        _LOG.warning(
            "cli product image path missing: %s — falling through", p
        )
    for source_label, candidate_url in (
        ("cli_url", cli_url),
        ("analysis_report", report_url),
    ):
        if not candidate_url:
            continue
        local = _try_fetch_image(candidate_url, work_dir)
        if local is not None:
            return ResolvedImage(
                source=source_label,
                url=candidate_url,
                local_path=str(local),
            )
        _LOG.warning(
            "image fetch failed for %s url=%s — falling through",
            source_label, candidate_url,
        )
    return _GRADIENT_FALLBACK


def _try_fetch_image(url: str, work_dir: Path) -> Path | None:
    """One-shot fetch + single retry. Never raises."""
    try:
        import requests  # type: ignore
    except ImportError:
        _LOG.warning("requests not installed; skipping URL image fetch")
        return None
    for attempt in (1, 2):
        try:
            r = requests.get(url, timeout=5)
            if r.status_code != 200:
                _LOG.warning(
                    "fetch attempt %d failed: status=%d url=%s",
                    attempt, r.status_code, url,
                )
                continue
            ext = ".jpg"
            ctype = (r.headers.get("Content-Type") or "").lower()
            if "png" in ctype:
                ext = ".png"
            elif "webp" in ctype:
                ext = ".webp"
            out_path = work_dir / f"product_image{ext}"
            out_path.write_bytes(r.content)
            return out_path
        except Exception as e:  # noqa: BLE001 — fail-soft is intentional
            _LOG.warning("fetch attempt %d raised: %r", attempt, e)
    return None


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _render_html(env: Environment, page: dict, total_pages: int, css_href: str) -> str:
    template_name = _TEMPLATE_BY_TYPE.get(page.get("type") or "")
    if not template_name:
        raise ValueError(
            f"no template registered for page type {page.get('type')!r}"
        )
    tpl = env.get_template(template_name)
    return tpl.render(
        page=page,
        total_pages=total_pages,
        css_href=css_href,
    )


def _safe_filename_token(s: str | None) -> str:
    if not s:
        return ""
    return "".join(ch if ch.isalnum() else "_" for ch in s)[:32]


def render_cardnews(
    layout: dict,
    out_dir: Path,
    *,
    product_image_path: str | None = None,
    product_image_url: str | None = None,
) -> dict:
    """Render every page in `layout` to a PNG under `out_dir/pages/`.

    Returns a manifest dict (also written to `out_dir/manifest.json`)
    summarizing the run.

    Calls `validate_cardnews_safety(layout)` before any HTML render.
    Raises `CardnewsSafetyError` on violation; nothing is written.
    """
    out_dir = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(exist_ok=True)
    work_dir = out_dir / "_work"
    work_dir.mkdir(exist_ok=True)

    # Stage CSS + (optionally) image into out_dir so file:// URLs from
    # the rendered HTML resolve cleanly. Playwright treats each
    # screenshot as an isolated page navigation.
    staged_css = out_dir / CSS_FILENAME
    shutil.copyfile(STYLES_DIR / CSS_FILENAME, staged_css)

    # Resolve the product image once. Update layout in place so the
    # cover template's local_path field reflects the resolved choice.
    report_url = (layout.get("product_image") or {}).get("url")
    resolved = _resolve_product_image(
        cli_path=product_image_path,
        cli_url=product_image_url,
        report_url=report_url,
        work_dir=work_dir,
    )
    layout["product_image"] = resolved.to_layout()
    for page in layout.get("pages") or []:
        if page.get("type") == "cover":
            page["product_image"] = resolved.to_layout()

    # Validate AFTER image resolution (image source affects layout dict
    # but not the validator-relevant strings; safe in either order).
    validate_cardnews_safety(layout)

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
        keep_trailing_newline=True,
    )

    pages = layout.get("pages") or []
    total_pages = len(pages)
    rendered: list[dict] = []

    css_href = CSS_FILENAME  # relative to the staged HTML

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            for page in pages:
                idx = page.get("index", 0)
                page_type = page.get("type", "unknown")
                token = _safe_filename_token(
                    page.get("attribute_key") or page.get("type")
                )
                base = f"{idx:02d}_{page_type}"
                if page.get("attribute_key"):
                    base = f"{idx:02d}_{page_type}_{token}"
                html_path = work_dir / f"{base}.html"
                png_path = pages_dir / f"{base}.png"

                html = _render_html(env, page, total_pages, css_href)
                html_path.write_text(html, encoding="utf-8")
                # Stage the CSS adjacent to the HTML so the relative href
                # resolves under file://. (Already staged at out_dir,
                # but work_dir is a sibling — copy once.)
                work_css = work_dir / CSS_FILENAME
                if not work_css.exists():
                    shutil.copyfile(STYLES_DIR / CSS_FILENAME, work_css)

                browser_ctx = browser.new_context(
                    viewport={"width": PAGE_WIDTH, "height": PAGE_HEIGHT},
                    device_scale_factor=DEVICE_SCALE_FACTOR,
                )
                pg = browser_ctx.new_page()
                pg.goto(html_path.as_uri(), wait_until="networkidle")
                pg.screenshot(
                    path=str(png_path),
                    full_page=False,
                    omit_background=False,
                )
                browser_ctx.close()
                rendered.append({
                    "index": idx,
                    "type": page_type,
                    "png": str(png_path.relative_to(out_dir)),
                })
        finally:
            browser.close()

    manifest = {
        "schema_version": "1.0",
        "generated_at": layout.get("generated_at"),
        "language": layout.get("language"),
        "page_count": total_pages,
        "analysis_report_sha256": layout.get("analysis_report_sha256"),
        "product": layout.get("product"),
        "product_image_source": resolved.source,
        "pages": rendered,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "layout.json").write_text(
        json.dumps(layout, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="Render an Instagram cardnews carousel from a v3.0 "
                    "analysis_report.json (or a pre-built layout.json)."
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--analysis-report",
        type=Path,
        help="Path to a v3.0 analysis_report.json — layout will be built.",
    )
    src.add_argument(
        "--layout",
        type=Path,
        help="Path to a pre-built layout.json — skips the layout build step.",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        type=Path,
        help="Output directory for pages/, manifest.json, layout.json",
    )
    parser.add_argument(
        "--product-image-path",
        type=str,
        default=None,
        help="Local path to a product image (cover page).",
    )
    parser.add_argument(
        "--product-image-url",
        type=str,
        default=None,
        help="URL to a product image (cover page). Fetched best-effort.",
    )
    args = parser.parse_args(argv)

    if args.analysis_report:
        report = json.loads(args.analysis_report.read_text(encoding="utf-8"))
        layout = build_long_cardnews_layout(report)
    else:
        layout = json.loads(args.layout.read_text(encoding="utf-8"))

    try:
        manifest = render_cardnews(
            layout,
            args.out_dir,
            product_image_path=args.product_image_path,
            product_image_url=args.product_image_url,
        )
    except CardnewsSafetyError as e:
        print(f"safety contract violated:\n{e}", flush=True)
        return 2

    print(
        f"rendered {manifest['page_count']} pages → "
        f"{Path(args.out_dir).resolve()} "
        f"(image_source={manifest['product_image_source']})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
