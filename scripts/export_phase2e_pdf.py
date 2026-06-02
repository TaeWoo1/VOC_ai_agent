"""Convert Phase 2E markdown reports → PDF via reportlab.platypus.

MVP-level renderer. Parses minimal markdown:
  - `# X`   → Title
  - `## X`  → Section header
  - `### X` → Subsection
  - `- X`   → Bullet
  - blank   → Spacer
  - other   → Paragraph (preserves inline `code`, **bold**, > blockquote
              as plain text — no styling overkill)

Tables and complex inline formatting are preserved as raw text in a
mono/normal paragraph; we don't render markdown tables as PDF tables.

Usage:
  PYTHONPATH=. python3 scripts/export_phase2e_pdf.py
  PYTHONPATH=. python3 scripts/export_phase2e_pdf.py --pattern docs/phase2e_report_3CE_pipeline.md

NO pipeline operations, NO LLM calls. Pure formatting.
"""
from __future__ import annotations
import argparse
import glob
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PATTERN = str(REPO / "docs/phase2e_report_*_pipeline.md")

# Register Korean CJK font (built into reportlab's CID set; no font file needed)
_KOREAN_FONT = "HYSMyeongJo-Medium"
pdfmetrics.registerFont(UnicodeCIDFont(_KOREAN_FONT))


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

def _build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleK", parent=base["Title"],
            fontName=_KOREAN_FONT, fontSize=20, leading=26, spaceAfter=14,
        ),
        "h2": ParagraphStyle(
            "H2K", parent=base["Heading2"],
            fontName=_KOREAN_FONT, fontSize=14, leading=18,
            spaceBefore=12, spaceAfter=8, textColor=base["Heading2"].textColor,
        ),
        "h3": ParagraphStyle(
            "H3K", parent=base["Heading3"],
            fontName=_KOREAN_FONT, fontSize=12, leading=16,
            spaceBefore=8, spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "BodyK", parent=base["BodyText"],
            fontName=_KOREAN_FONT, fontSize=10, leading=14,
            spaceAfter=4,
        ),
        "bullet": ParagraphStyle(
            "BulletK", parent=base["BodyText"],
            fontName=_KOREAN_FONT, fontSize=10, leading=14,
            leftIndent=16, bulletIndent=4, spaceAfter=2,
        ),
        "table_text": ParagraphStyle(
            "TableTextK", parent=base["BodyText"],
            fontName=_KOREAN_FONT, fontSize=8, leading=10,
            spaceAfter=2,
        ),
    }


# ---------------------------------------------------------------------------
# Minimal markdown → flowable conversion
# ---------------------------------------------------------------------------

_MARKDOWN_INLINE_BOLD = re.compile(r"\*\*([^*]+?)\*\*")
_MARKDOWN_INLINE_CODE = re.compile(r"`([^`]+?)`")
_HTML_ESCAPE = re.compile(r"[<>&]")


def _escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _inline_format(text: str) -> str:
    """Convert minimal markdown inline syntax to reportlab markup.

    Keep it simple — bold via <b>, inline `code` rendered as plain text
    (reportlab's CID Korean font doesn't have a guaranteed monospace
    sibling; safer to drop the visual code styling at MVP level).
    """
    s = _escape_html(text)
    s = _MARKDOWN_INLINE_BOLD.sub(r"<b>\1</b>", s)
    s = _MARKDOWN_INLINE_CODE.sub(r"\1", s)  # strip backticks; render as plain
    return s


def _is_table_line(line: str) -> bool:
    s = line.strip()
    return s.startswith("|") and s.endswith("|")


def _is_table_separator(line: str) -> bool:
    s = line.strip()
    if not _is_table_line(s):
        return False
    inside = s.strip("|")
    return all(re.fullmatch(r":?-+:?", c.strip().replace(" ", "")) for c in inside.split("|"))


def parse_markdown(md: str, styles: dict[str, ParagraphStyle]) -> list:
    """Walk through markdown lines, build a list of platypus flowables."""
    flowables: list = []
    lines = md.splitlines()
    i = 0
    in_code_fence = False
    while i < len(lines):
        line = lines[i]

        # Code fences — skip the fence markers; treat content as body
        if line.strip().startswith("```"):
            in_code_fence = not in_code_fence
            i += 1
            continue

        if not line.strip():
            flowables.append(Spacer(1, 4))
            i += 1
            continue

        if line.strip() == "---":
            # Horizontal rule = small spacer
            flowables.append(Spacer(1, 8))
            i += 1
            continue

        # Tables — collect contiguous table lines and render as plain text
        if _is_table_line(line):
            table_lines = []
            while i < len(lines) and _is_table_line(lines[i]):
                if not _is_table_separator(lines[i]):
                    table_lines.append(lines[i])
                i += 1
            if table_lines:
                table_text = "<br/>".join(_inline_format(t) for t in table_lines)
                flowables.append(Paragraph(table_text, styles["table_text"]))
                flowables.append(Spacer(1, 6))
            continue

        # Headings
        if line.startswith("# "):
            txt = _inline_format(line[2:].strip())
            flowables.append(Paragraph(txt, styles["title"]))
        elif line.startswith("## "):
            txt = _inline_format(line[3:].strip())
            flowables.append(Paragraph(txt, styles["h2"]))
        elif line.startswith("### "):
            txt = _inline_format(line[4:].strip())
            flowables.append(Paragraph(txt, styles["h3"]))
        elif line.startswith("- "):
            txt = _inline_format(line[2:].strip())
            flowables.append(Paragraph("• " + txt, styles["bullet"]))
        elif line.startswith("> "):
            # Blockquote → italicized body
            txt = _inline_format(line[2:].strip())
            flowables.append(Paragraph("<i>" + txt + "</i>", styles["body"]))
        else:
            txt = _inline_format(line)
            flowables.append(Paragraph(txt, styles["body"]))

        i += 1

    return flowables


# ---------------------------------------------------------------------------
# Document builder
# ---------------------------------------------------------------------------


def render_pdf(md_path: Path, pdf_path: Path) -> None:
    md = md_path.read_text(encoding="utf-8")
    styles = _build_styles()
    flowables = parse_markdown(md, styles)

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=md_path.stem,
        author="Phase 2E pipeline",
    )
    doc.build(flowables)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pattern", default=DEFAULT_PATTERN,
                    help="glob for input markdown files")
    ap.add_argument("--out-dir", default=str(REPO / "docs"))
    args = ap.parse_args()

    matches = sorted(glob.glob(args.pattern))
    if not matches:
        print(f"no markdown files found at pattern: {args.pattern}", file=sys.stderr)
        sys.exit(1)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(exist_ok=True)

    print(f"Converting {len(matches)} markdown report(s) → PDF")
    for md_str in matches:
        md_path = Path(md_str)
        pdf_path = out_dir / (md_path.stem + ".pdf")
        try:
            render_pdf(md_path, pdf_path)
            size_kb = pdf_path.stat().st_size / 1024
            print(f"  ✓ {md_path.name} → {pdf_path.name} ({size_kb:.1f} KB)")
        except Exception as e:
            print(f"  ✗ {md_path.name} — error: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
