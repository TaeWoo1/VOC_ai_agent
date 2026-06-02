"""Local read-only data server for the Figma cardnews plugin.

Architecture (one process, one CSV file, no auth):

    Figma plugin  ──HTTP──►  this server  ──reads──►  cardnews_review_sheet.csv
                                                       (or live Google Sheet)

Endpoints:
  GET /health
      → { "ok": true, "csv_path": "...", "csv_exists": true, "row_count": N }

  GET /cardnews/latest-approved
      → the most recent row (by `date`) with copy_status="copy_approved"
        AND design_status not in {"publish_ready","rejected"}.
        404 when no such row exists.

  GET /cardnews/{run_id}
      → the row with that exact run_id.
        404 when not found.

Each successful response is a single JSON object shaped:

    {
      "schema_version": "1.0",
      "row": {
        "date": "...",
        "run_id": "...",
        ...all 27 sheet columns...
      },
      "slides": [
        { "slide_no": 1, "title": "...", "body": "...",
          "bullets": ["..."], "subtitle": "...", "footer_note": "..." },
        ... × 7
      ],
      "served_at_utc": "..."
    }

`slides[]` is derived from the card_NN_title / card_NN_body columns —
the body string is split back into subtitle / bullets / footer_note
so the Figma plugin can place each piece into a named layer without
re-parsing the CSV format.

CORS: allow-all so the Figma plugin (which runs in a sandboxed
iframe) can `fetch()` from `http://localhost:7777`.

Usage:

    PYTHONPATH=. python3 scripts/serve_figma_cardnews.py \\
        [--csv-path PATH] \\
        [--port 7777] \\
        [--host 127.0.0.1]

The server is stdlib-only — no Flask, no FastAPI dependency. Reads
the CSV on every request (fine for a one-operator workspace; CSV
is small, mtime-based caching can be added later).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.figma_pipeline.sheet_row import (  # noqa: E402
    COPY_STATUS_APPROVED,
    DESIGN_STATUS_PUBLISH_READY,
    DESIGN_STATUS_REJECTED,
    SHEET_COLUMNS,
)


SCHEMA_VERSION = "1.0"
DEFAULT_CSV_PATH = (
    REPO / "outputs" / "figma_packages" / "cardnews_review_workspace"
    / "cardnews_review_sheet.csv"
)
DEFAULT_PORT = 7777
DEFAULT_HOST = "127.0.0.1"


# ---------------------------------------------------------------------------
# CSV adapter
# ---------------------------------------------------------------------------


def _load_csv(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8", newline="") as f:
        return [dict(r) for r in csv.DictReader(f)]


def _split_body(body: str | None) -> dict:
    """Inverse of `format_card_body`. Returns
    `{subtitle, bullets, footer_note}`. Defensive — if the body
    doesn't follow the canonical format, return the raw body in
    `subtitle` and an empty bullets list."""
    if not body:
        return {"subtitle": "", "bullets": [], "footer_note": ""}
    lines = body.split("\n")
    subtitle: str = ""
    bullets: list[str] = []
    footer: str = ""
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("※"):
            footer = stripped[1:].strip()
        elif stripped[:1] in ("•", "✓", "—", "·", "◦", "*", "-"):
            bullets.append(stripped[1:].strip())
        else:
            # Subtitle is the first non-marker line. Everything else
            # without a marker is appended to bullets defensively.
            if not subtitle:
                subtitle = stripped
            else:
                bullets.append(stripped)
    return {"subtitle": subtitle, "bullets": bullets, "footer_note": footer}


def _row_to_response(row: dict) -> dict:
    """Build the JSON shape the Figma plugin expects."""
    slides: list[dict] = []
    for i in range(1, 8):
        title = row.get(f"card{i:02d}_title", "")
        body = row.get(f"card{i:02d}_body", "")
        body_parts = _split_body(body)
        slides.append({
            "slide_no": i,
            "title": title,
            "body_raw": body,
            "subtitle": body_parts["subtitle"],
            "bullets": body_parts["bullets"],
            "footer_note": body_parts["footer_note"],
        })
    # Strip card_NN_* from the row dict — they're already in slides[].
    flat_row = {
        c: row.get(c, "")
        for c in SHEET_COLUMNS
        if not c.startswith("card") or c in ("category", "")
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "row": flat_row,
        "slides": slides,
        "served_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def find_latest_approved(rows: list[dict]) -> dict | None:
    """Return the most recent row eligible for Figma generation.

    Eligibility rules:
      - copy_status == "copy_approved"
      - design_status NOT in {"publish_ready", "rejected"}

    "publish_ready" rows are intentionally excluded — once a
    cardnews has been published, the operator probably doesn't
    want it re-cloned into Figma. They can explicitly request it
    via `/cardnews/{run_id}` if needed.

    Sort by `date` desc, then by `run_id` desc as a stable
    tie-breaker for same-day runs.
    """
    eligible = [
        r for r in rows
        if r.get("copy_status") == COPY_STATUS_APPROVED
        and r.get("design_status") not in (
            DESIGN_STATUS_PUBLISH_READY, DESIGN_STATUS_REJECTED,
        )
    ]
    if not eligible:
        return None
    eligible.sort(
        key=lambda r: (r.get("date", ""), r.get("run_id", "")),
        reverse=True,
    )
    return eligible[0]


def find_by_run_id(rows: list[dict], run_id: str) -> dict | None:
    if not run_id:
        return None
    for r in rows:
        if r.get("run_id") == run_id:
            return r
    return None


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    server_csv_path: Path = DEFAULT_CSV_PATH  # set by `make_server`

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        # Quieter than the default access log; one line per request
        # to stderr.
        sys.stderr.write(
            f"[serve] {self.address_string()} - "
            f"{fmt % args}\n"
        )

    def _write(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Accept",
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 — stdlib API
        # Preflight for CORS — Figma plugin's `fetch()` will send one.
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Accept",
        )
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        path = urlparse(self.path).path
        rows = _load_csv(self.server_csv_path)

        if path == "/health":
            self._write(200, {
                "ok": True,
                "csv_path": str(self.server_csv_path),
                "csv_exists": self.server_csv_path.is_file(),
                "row_count": len(rows),
                "schema_version": SCHEMA_VERSION,
            })
            return

        if path == "/cardnews/latest-approved":
            row = find_latest_approved(rows)
            if row is None:
                self._write(404, {
                    "ok": False,
                    "error": "no_approved_row",
                    "detail": (
                        "No row found with copy_status='copy_approved' "
                        "and design_status NOT IN "
                        "{'publish_ready','rejected'}"
                    ),
                })
                return
            self._write(200, _row_to_response(row))
            return

        if path.startswith("/cardnews/"):
            run_id = unquote(path[len("/cardnews/"):])
            row = find_by_run_id(rows, run_id)
            if row is None:
                self._write(404, {
                    "ok": False,
                    "error": "run_id_not_found",
                    "run_id": run_id,
                })
                return
            self._write(200, _row_to_response(row))
            return

        self._write(404, {
            "ok": False, "error": "unknown_path", "path": path,
        })


# ---------------------------------------------------------------------------
# Public factory (for tests)
# ---------------------------------------------------------------------------


def make_server(
    *, csv_path: Path, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT,
) -> ThreadingHTTPServer:
    """Construct the server bound to `csv_path` without serve_forever."""
    handler_cls = type(
        "_BoundHandler", (_Handler,), {"server_csv_path": csv_path},
    )
    return ThreadingHTTPServer((host, port), handler_cls)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="serve_figma_cardnews",
        description=(
            "Local HTTP server providing approved cardnews data to a "
            "Figma plugin. Reads from a CSV produced by "
            "scripts/export_cardnews_to_sheet.py."
        ),
    )
    p.add_argument(
        "--csv-path", type=Path, default=DEFAULT_CSV_PATH,
        help=f"CSV to serve. Default: {DEFAULT_CSV_PATH.relative_to(REPO)}",
    )
    p.add_argument(
        "--host", default=DEFAULT_HOST,
        help=f"Bind host. Default: {DEFAULT_HOST}.",
    )
    p.add_argument(
        "--port", type=int, default=DEFAULT_PORT,
        help=f"Bind port. Default: {DEFAULT_PORT}.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    csv_path: Path = args.csv_path.resolve()
    print(f"[serve] csv_path = {csv_path}")
    print(f"[serve] csv_exists = {csv_path.is_file()}")
    print(f"[serve] listening on http://{args.host}:{args.port}")
    print(f"[serve] endpoints:")
    print(f"          GET /health")
    print(f"          GET /cardnews/latest-approved")
    print(f"          GET /cardnews/<run_id>")
    print(f"[serve] Ctrl+C to stop.")
    server = make_server(
        csv_path=csv_path, host=args.host, port=args.port,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopping.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
