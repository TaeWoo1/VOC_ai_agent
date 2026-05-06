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
#
# v2.0 narrative — see `cardnews_long_layout.py` for the page order.
_TEMPLATE_BY_TYPE: dict[str, str] = {
    "cover": "cover.html.j2",
    "one_liner": "one_liner.html.j2",
    "loved": "loved.html.j2",
    "positive_spotlight": "positive_spotlight.html.j2",
    "divides": "divides.html.j2",
    "why_divides": "why_divides.html.j2",
    "caution_spotlight": "caution_spotlight.html.j2",
    "insight_spotlight": "insight_spotlight.html.j2",
    "signature": "signature.html.j2",
    "checkpoint": "checkpoint.html.j2",
    "fit": "fit.html.j2",
    "consider": "consider.html.j2",
    "summary": "summary.html.j2",
    "cta": "cta.html.j2",
}


# ---------------------------------------------------------------------------
# Image resolution (fallback chain)
# ---------------------------------------------------------------------------


@dataclass
class ResolvedImage:
    """The image descriptor written into the layout's cover page.

    `usage` controls how the cover template uses the image:
      * `cover_full_bleed` — image fills the cover (or, when
        `local_path is None`, the gradient fallback is rendered).
      * `cover_cutout`     — v2.4. Floating product cutout in the
        bottom-right; text overlays are unaffected. Falls back to
        `cover_full_bleed` automatically when local_path is None.
    """
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
    usage="cover_full_bleed",
)


def _resolve_local_path(
    *, raw_path: str, candidate_roots: list[Path],
) -> Path | None:
    """Resolve a layout-supplied local_path to an existing file.

    `raw_path` may be absolute or relative (e.g.
    `assets/product_image.jpg`). When relative, it's tried against
    each candidate root in order; the first existing file wins.

    Typical candidate roots, in priority order:
      1. The run-package root (`outputs/content_packages/<run>/`) —
         where the collection-stage fetcher writes assets.
      2. The cardnews out_dir (`<run>/cardnews/<lang>/`) — for
         operator-staged ad-hoc images.
      3. Process cwd — last resort for one-off testing.
    """
    if not raw_path:
        return None
    p = Path(raw_path).expanduser()
    if p.is_absolute():
        resolved = p.resolve()
        if resolved.exists() and resolved.is_file():
            return resolved
        return None
    for root in candidate_roots:
        if root is None:
            continue
        candidate = (Path(root) / p).resolve()
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _resolve_product_image(
    *,
    cli_path: str | None,
    cli_url: str | None,
    report_local_path: str | None,
    report_url: str | None,
    report_local_root: list[Path] | None,
    work_dir: Path,
    layout_usage: str | None,
    allow_live_fetch: bool = False,
) -> ResolvedImage:
    """Walk the fallback chain. Image fetch failures degrade silently
    to the next step — they never raise out of this function.

    v2.4.1 priority order (default `allow_live_fetch=False`):
      1. CLI override path (operator-supplied local file)
      2. analysis_report local_path (pre-fetched at collection time)
      3. gradient fallback (no image)

    With `allow_live_fetch=True` (operator opt-in via
    `--allow-live-image-fetch`), the chain extends to:
      3a. CLI URL (operator-supplied URL)
      3b. analysis_report URL (last-resort live fetch)
      4.  gradient fallback

    Default-off live fetching reflects the v2.4 image policy:
    publication renders should run offline against pre-fetched assets
    so the carousel is reproducible and CDN outages don't break it.
    Live fetches stay available for ad-hoc developer runs.
    """
    usage = layout_usage or "cover_cutout"
    if cli_path:
        p = Path(cli_path).expanduser().resolve()
        if p.exists() and p.is_file():
            return ResolvedImage(
                source="cli_path",
                url=None,
                local_path=str(p),
                usage=usage,
            )
        _LOG.warning(
            "cli product image path missing: %s — falling through", p
        )

    # v2.4 — analysis_report local_path is the canonical "pre-fetched"
    # case. When set, prefer it over any URL fetch so the renderer
    # stays offline.
    if report_local_path:
        resolved = _resolve_local_path(
            raw_path=report_local_path,
            candidate_roots=report_local_root or [],
        )
        if resolved is not None:
            return ResolvedImage(
                source="analysis_report_local",
                url=None,
                local_path=str(resolved),
                usage=usage,
            )
        _LOG.warning(
            "analysis_report.product.image_local_path missing on disk: "
            "%s (tried roots %s) — falling through to URL fetch",
            report_local_path, report_local_root,
        )

    if allow_live_fetch:
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
                    usage=usage,
                )
            _LOG.warning(
                "image fetch failed for %s url=%s — falling through",
                source_label, candidate_url,
            )
    elif cli_url or report_url:
        _LOG.info(
            "live image fetch is disabled (default); URL %s will not be "
            "fetched. Pass --allow-live-image-fetch to enable.",
            cli_url or report_url,
        )
    # All chain steps exhausted — emit the gradient fallback. Force
    # `cover_full_bleed` usage on this path so the cover template
    # collapses to the (still-valid) text-only treatment.
    return ResolvedImage(
        source="fallback_gradient",
        url=None,
        local_path=None,
        usage="cover_full_bleed",
    )


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
    analysis_report_path: Path | None = None,
    allow_live_image_fetch: bool = False,
) -> dict:
    """Render every page in `layout` to a PNG under `out_dir/pages/`.

    Returns a manifest dict (also written to `out_dir/manifest.json`)
    summarizing the run.

    Calls `validate_cardnews_safety(layout)` before any HTML render.
    Raises `CardnewsSafetyError` on violation; nothing is written.

    `analysis_report_path` is an optional hint for resolving the
    run-package root when a relative `image_local_path` was recorded
    in the analysis_report (collection-stage fetch always writes a
    run-relative path). When supplied AND the report sits in the
    canonical layout (`.../<run>/shared/analysis_report.json`), the
    `<run>/` dir is added to the renderer's image-resolution candidate
    roots ahead of out_dir.parent.parent — so cardnews rendered into a
    different out_dir (e.g. `/tmp/...`) still finds the pre-fetched
    image.
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
    layout_product_image = layout.get("product_image") or {}
    report_url = layout_product_image.get("url")
    report_local_path = layout_product_image.get("local_path")
    layout_usage = layout_product_image.get("usage")
    # The `local_path` written into the layout may be relative to the
    # run-package root (where collection-stage assets/ lives) OR to
    # the cardnews out_dir. Try the run-package root first, then
    # out_dir, then cwd. The canonical run-package layout is
    # `<run>/shared/analysis_report.json` + `<run>/assets/<image>` +
    # `<run>/cardnews/<lang>/`, so out_dir.parent.parent is the run
    # root in the canonical case.
    candidate_roots: list[Path] = []
    # Highest priority: derived run-package root from the report path
    # (when supplied AND in the canonical `<run>/shared/...` layout).
    if analysis_report_path is not None:
        ap = Path(analysis_report_path).resolve()
        # `<run>/shared/analysis_report.json` → run = ap.parent.parent
        if ap.name == "analysis_report.json" and ap.parent.name == "shared":
            run_root = ap.parent.parent
            if run_root.exists():
                candidate_roots.append(run_root)
    # out_dir.parent.parent is the run root in the canonical case
    # where out_dir = `<run>/cardnews/<lang>/`.
    if out_dir.name and out_dir.parent.name and out_dir.parent.parent.exists():
        candidate_roots.append(out_dir.parent.parent)
    candidate_roots.append(out_dir)
    candidate_roots.append(Path.cwd())
    # De-duplicate while preserving order so the priority chain stays
    # stable.
    seen: set[Path] = set()
    deduped_roots: list[Path] = []
    for r in candidate_roots:
        rr = r.resolve()
        if rr in seen:
            continue
        seen.add(rr)
        deduped_roots.append(rr)
    candidate_roots = deduped_roots
    resolved = _resolve_product_image(
        cli_path=product_image_path,
        cli_url=product_image_url,
        report_local_path=report_local_path,
        report_url=report_url,
        report_local_root=candidate_roots,
        work_dir=work_dir,
        layout_usage=layout_usage,
        allow_live_fetch=allow_live_image_fetch,
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
        # Audit trail back to the editorial planner output. Lets a
        # future re-render confirm "same plan in, same pages out."
        "content_plan_sha256": layout.get("content_plan_sha256"),
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


def _default_out_dir_for_report(report_path: Path, *, lang: str = "ko") -> Path | None:
    """Derive `outputs/content_packages/<run>/cardnews/<lang>/` when the
    analysis_report sits in the canonical run-package layout. Returns
    None when the path doesn't match — the CLI then requires explicit
    `--out-dir`. Match shape:
        .../outputs/content_packages/<run_dir>/shared/analysis_report.json
    becomes:
        .../outputs/content_packages/<run_dir>/cardnews/<lang>/
    """
    p = report_path.resolve()
    parts = p.parts
    try:
        i = parts.index("content_packages")
    except ValueError:
        return None
    if len(parts) < i + 4:
        return None
    if parts[i + 2] != "shared" or parts[i + 3] != "analysis_report.json":
        return None
    run_root = Path(*parts[: i + 2])
    return run_root / "cardnews" / lang


def _main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="Render an Instagram cardnews carousel from a v3.0 "
                    "analysis_report.json (or a pre-built layout.json). "
                    "Default output is "
                    "outputs/content_packages/<run>/cardnews/<lang>/ when "
                    "the report sits in the canonical run-package layout."
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
        "--content-plan",
        type=Path,
        default=None,
        help="Path to a precomputed content_plan.json (e.g. an LLM-mode "
             "plan saved out of band). Only used when --analysis-report "
             "is set; ignored with --layout.",
    )
    parser.add_argument(
        "--lang",
        type=str,
        default="ko",
        help="Language subdir under cardnews/ when deriving the default "
             "out-dir (default: ko).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Output directory for pages/, manifest.json, layout.json, "
             "and (when built here) content_plan.json. Defaults to "
             "outputs/content_packages/<run>/cardnews/<lang>/ when the "
             "report sits in the canonical run-package layout. "
             "Required when no run-package layout can be inferred.",
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
        help=(
            "URL to a product image (cover page). Only used when "
            "--allow-live-image-fetch is also passed; otherwise the URL "
            "is recorded in logs but never fetched."
        ),
    )
    parser.add_argument(
        "--allow-live-image-fetch",
        action="store_true",
        help=(
            "Allow live HTTP fetches of product image URLs at render time. "
            "OFF by default — publication renders should run offline "
            "against pre-fetched assets in <run>/assets/. Enable only "
            "for ad-hoc developer runs."
        ),
    )
    args = parser.parse_args(argv)

    out_dir = args.out_dir
    if out_dir is None:
        if args.analysis_report:
            out_dir = _default_out_dir_for_report(args.analysis_report, lang=args.lang)
        if out_dir is None:
            parser.error(
                "--out-dir is required (could not derive a default; "
                "the report path is not under outputs/content_packages/"
                "<run>/shared/analysis_report.json)"
            )
    out_dir = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    saved_plan_path: Path | None = None
    if args.analysis_report:
        report = json.loads(args.analysis_report.read_text(encoding="utf-8"))
        if args.content_plan:
            content_plan = json.loads(
                args.content_plan.read_text(encoding="utf-8")
            )
        else:
            from src.voc.content.editorial_planner import build_content_plan
            content_plan = build_content_plan(report, mode="mock")
        # Persist the plan alongside layout/manifest so the run dir is
        # self-contained — operators can re-render from this dir alone.
        saved_plan_path = out_dir / "content_plan.json"
        saved_plan_path.write_text(
            json.dumps(content_plan, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        layout = build_long_cardnews_layout(report, content_plan=content_plan)
    else:
        layout = json.loads(args.layout.read_text(encoding="utf-8"))

    try:
        manifest = render_cardnews(
            layout,
            out_dir,
            product_image_path=args.product_image_path,
            product_image_url=args.product_image_url,
            analysis_report_path=args.analysis_report,
            allow_live_image_fetch=args.allow_live_image_fetch,
        )
    except CardnewsSafetyError as e:
        print(f"safety contract violated:\n{e}", flush=True)
        return 2

    extra = f" (content_plan={saved_plan_path})" if saved_plan_path else ""
    print(
        f"rendered {manifest['page_count']} pages → {out_dir} "
        f"(image_source={manifest['product_image_source']}){extra}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
