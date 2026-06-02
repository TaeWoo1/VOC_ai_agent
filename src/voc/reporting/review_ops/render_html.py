from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .schema import ReviewOpsAnalysis

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
TEMPLATE_NAME = "review_ops_report.html.j2"


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
        keep_trailing_newline=True,
    )


def render(report: ReviewOpsAnalysis) -> str:
    env = _env()
    tpl = env.get_template(TEMPLATE_NAME)
    return tpl.render(report=report)


def render_to_file(report: ReviewOpsAnalysis, output_dir: Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    html = render(report)
    out_path = output_dir / "review_ops_report.html"
    out_path.write_text(html, encoding="utf-8")
    return out_path
