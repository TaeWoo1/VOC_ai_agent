"""Export one cardnews-review row to the Google Sheet workspace.

Reads three artifacts from a run directory:
  - shared/analysis_report.json
  - manifest.json
  - the polished cardnews copy (default:
    `outputs/figma_packages/<package>/figma_cardnews_copy_ko.json`,
    falling back to the deterministic skeleton at
    `<run_dir>/buyer_content/ko/instagram_cardnews.json`)

Builds one row via `src.voc.figma_pipeline.sheet_row.build_cardnews_row`
and either:
  - appends it to a CSV (`--csv-out`, default
    `outputs/figma_packages/cardnews_review_workspace/cardnews_review_sheet.csv`);
  - upserts to a real Google Sheet (`--sheet-id ...`, requires
    gspread + a service-account credentials file). Idempotent on
    `run_id` — the row is REPLACED if the run_id already exists,
    APPENDED otherwise. The reviewer's manual edits to
    `copy_status`, `design_status`, `figma_file_url`,
    `png_folder`, `reviewer_notes` are preserved by default
    (set `--overwrite-status` to wipe them).

CLI:
    PYTHONPATH=. python3 scripts/export_cardnews_to_sheet.py \\
        --run-dir outputs/2026-04-30_product-83743e299623_run-010 \\
        --figma-package outputs/figma_packages/mediheal_pad_instagram_v1

    # Custom CSV path:
    PYTHONPATH=. python3 scripts/export_cardnews_to_sheet.py \\
        --run-dir <...> \\
        --csv-out /tmp/sheet.csv

    # Real Google Sheet (gspread):
    PYTHONPATH=. python3 scripts/export_cardnews_to_sheet.py \\
        --run-dir <...> \\
        --sheet-id 1AbC… --tab "Cardnews Review" \\
        --google-credentials ~/.config/gcp/service-account.json
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.figma_pipeline.sheet_row import (  # noqa: E402
    KNOWN_COPY_STATUSES,
    KNOWN_DESIGN_STATUSES,
    SHEET_COLUMNS,
    build_cardnews_row,
)


# ---------------------------------------------------------------------------
# Source-artifact resolution
# ---------------------------------------------------------------------------


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve_run_id(run_dir: Path, manifest: dict, override: str | None) -> str:
    """Operator-visible run identifier. Prefers explicit override,
    then `manifest.run_dir`, then the directory name itself."""
    if override and override.strip():
        return override.strip()
    rd = manifest.get("run_dir") if isinstance(manifest, dict) else None
    if isinstance(rd, str) and rd.strip():
        return rd.strip()
    return run_dir.name


def _resolve_cardnews_copy(
    run_dir: Path,
    figma_package: Path | None,
) -> tuple[dict, str]:
    """Return (cardnews_copy_dict, source_label).

    Polished Figma package wins when available — that's the
    human-edited buyer-facing copy, the whole reason this Sheet
    exists. Falls back to the deterministic skeleton at
    `<run_dir>/buyer_content/ko/instagram_cardnews.json` when no
    Figma package is supplied.
    """
    def _rel(p: Path) -> str:
        try:
            return str(p.resolve().relative_to(REPO))
        except ValueError:
            return str(p.resolve())

    if figma_package:
        polished = figma_package / "figma_cardnews_copy_ko.json"
        if polished.is_file():
            return _read_json(polished), _rel(polished)
    skeleton = run_dir / "buyer_content" / "ko" / "instagram_cardnews.json"
    if skeleton.is_file():
        return _read_json(skeleton), _rel(skeleton)
    raise FileNotFoundError(
        f"No cardnews copy found. Looked at: "
        f"{(figma_package / 'figma_cardnews_copy_ko.json') if figma_package else None}, "
        f"{skeleton}"
    )


# ---------------------------------------------------------------------------
# CSV backend
# ---------------------------------------------------------------------------


def _csv_load(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return [dict(r) for r in reader]


def _csv_save(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(SHEET_COLUMNS))
        writer.writeheader()
        for r in rows:
            # Defensive: drop unknown columns, fill missing as "".
            writer.writerow({c: str(r.get(c, "")) for c in SHEET_COLUMNS})


def csv_upsert(
    csv_path: Path,
    new_row: dict,
    *,
    overwrite_status: bool = False,
    preserved_keys: tuple[str, ...] = (
        "copy_status",
        "design_status",
        "figma_file_url",
        "png_folder",
        "reviewer_notes",
    ),
) -> tuple[str, list[dict]]:
    """Idempotent upsert on `run_id`. Returns (action, all_rows).

    - "appended" — run_id was not present; row added.
    - "replaced" — run_id existed; auto-fields were refreshed but
                   the operator's manual edits (status, URLs, notes)
                   are preserved unless `overwrite_status=True`.
    """
    rows = _csv_load(csv_path)
    rid = new_row.get("run_id") or ""
    idx_existing: int | None = None
    for i, r in enumerate(rows):
        if r.get("run_id") == rid:
            idx_existing = i
            break

    if idx_existing is None:
        rows.append({c: new_row.get(c, "") for c in SHEET_COLUMNS})
        action = "appended"
    else:
        merged = dict(new_row)
        if not overwrite_status:
            existing = rows[idx_existing]
            for k in preserved_keys:
                v = existing.get(k)
                if isinstance(v, str) and v.strip():
                    merged[k] = v
        rows[idx_existing] = {c: merged.get(c, "") for c in SHEET_COLUMNS}
        action = "replaced"

    _csv_save(csv_path, rows)
    return action, rows


# ---------------------------------------------------------------------------
# gspread backend (optional — best-effort import)
# ---------------------------------------------------------------------------


def gspread_upsert(
    *,
    sheet_id: str,
    tab: str,
    credentials_path: Path,
    new_row: dict,
    overwrite_status: bool = False,
) -> str:
    """Real Google Sheet upsert. Requires:
        pip install gspread google-auth

    Mirrors the CSV semantics: idempotent on run_id, preserves
    operator-edited status fields by default."""
    try:
        import gspread  # type: ignore
        from google.oauth2.service_account import Credentials  # type: ignore
    except ImportError as e:
        raise SystemExit(
            "gspread / google-auth not installed. Either:\n"
            "  pip install gspread google-auth\n"
            "or use the default CSV backend by omitting --sheet-id."
        ) from e

    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = Credentials.from_service_account_file(
        str(credentials_path), scopes=scopes,
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(sheet_id)
    try:
        ws = sh.worksheet(tab)
    except gspread.WorksheetNotFound:  # type: ignore[attr-defined]
        ws = sh.add_worksheet(title=tab, rows="1000", cols=str(len(SHEET_COLUMNS)))
        ws.append_row(list(SHEET_COLUMNS), value_input_option="RAW")

    # Read existing rows; find run_id match.
    all_values = ws.get_all_values()
    if not all_values:
        ws.append_row(list(SHEET_COLUMNS), value_input_option="RAW")
        all_values = [list(SHEET_COLUMNS)]
    header = all_values[0]
    rid_col = header.index("run_id") if "run_id" in header else 1
    target_row_index: int | None = None
    for r_idx, r in enumerate(all_values[1:], start=2):
        if len(r) > rid_col and r[rid_col] == new_row.get("run_id"):
            target_row_index = r_idx
            break

    new_values = [str(new_row.get(c, "")) for c in SHEET_COLUMNS]
    if target_row_index is None:
        ws.append_row(new_values, value_input_option="RAW")
        return "appended"
    # Preserve operator-edited fields by default.
    if not overwrite_status:
        existing_row = all_values[target_row_index - 1]
        for c in (
            "copy_status", "design_status",
            "figma_file_url", "png_folder", "reviewer_notes",
        ):
            try:
                col_idx = header.index(c)
            except ValueError:
                continue
            if col_idx < len(existing_row):
                ev = existing_row[col_idx]
                if ev and ev.strip():
                    new_values[SHEET_COLUMNS.index(c)] = ev
    end_col_letter = chr(ord("A") + len(SHEET_COLUMNS) - 1)
    ws.update(
        range_name=f"A{target_row_index}:{end_col_letter}{target_row_index}",
        values=[new_values],
        value_input_option="RAW",
    )
    return "replaced"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


DEFAULT_CSV_OUT = (
    REPO / "outputs" / "figma_packages" / "cardnews_review_workspace"
    / "cardnews_review_sheet.csv"
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="export_cardnews_to_sheet",
        description=(
            "Append/upsert one cardnews-review row to a CSV (default) or "
            "to a real Google Sheet (with --sheet-id)."
        ),
    )
    p.add_argument(
        "--run-dir", required=True, type=Path,
        help="Pipeline run directory containing manifest.json + "
             "shared/analysis_report.json.",
    )
    p.add_argument(
        "--figma-package", type=Path, default=None,
        help="Path to a figma_packages/<name>/ directory containing "
             "figma_cardnews_copy_ko.json (the polished buyer-facing "
             "copy). When omitted, falls back to the deterministic "
             "skeleton inside --run-dir.",
    )
    p.add_argument(
        "--run-id", default=None,
        help="Override run_id. Default: manifest.run_dir or the run "
             "directory name.",
    )
    p.add_argument(
        "--copy-status", default="copy_pending", choices=list(KNOWN_COPY_STATUSES),
        help="Initial copy_status for a NEW row. Existing rows keep "
             "their operator-edited value unless --overwrite-status "
             "is set.",
    )
    p.add_argument(
        "--design-status", default="design_pending",
        choices=list(KNOWN_DESIGN_STATUSES),
        help="Initial design_status for a NEW row.",
    )
    p.add_argument(
        "--overwrite-status", action="store_true",
        help="Wipe operator-edited status / URL / notes fields when "
             "the row already exists. Default off — manual edits "
             "survive a re-export.",
    )
    p.add_argument(
        "--csv-out", type=Path, default=DEFAULT_CSV_OUT,
        help=f"CSV file to upsert into. Default: {DEFAULT_CSV_OUT.relative_to(REPO)}",
    )
    p.add_argument(
        "--sheet-id", default=None,
        help="Google Sheet ID. When set, upserts to the live Sheet "
             "instead of the CSV. Requires --google-credentials and "
             "the gspread + google-auth packages.",
    )
    p.add_argument("--tab", default="Cardnews Review",
                   help="Sheet tab/worksheet name.")
    p.add_argument(
        "--google-credentials", type=Path, default=None,
        help="Service-account JSON path. Only used with --sheet-id.",
    )
    p.add_argument(
        "--figma-file-url", default="",
        help="Optional Figma file URL to record on this row.",
    )
    p.add_argument(
        "--png-folder", default="",
        help="Optional path/URL to the exported-PNG folder.",
    )
    p.add_argument(
        "--reviewer-notes", default="",
        help="Optional free-form notes seeded on this row.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    run_dir: Path = args.run_dir.resolve()
    if not run_dir.is_dir():
        raise SystemExit(f"--run-dir does not exist: {run_dir}")
    ar_path = run_dir / "shared" / "analysis_report.json"
    if not ar_path.is_file():
        raise SystemExit(f"missing: {ar_path}")
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"missing: {manifest_path}")

    analysis_report = _read_json(ar_path)
    manifest = _read_json(manifest_path)
    cardnews_copy, copy_source = _resolve_cardnews_copy(
        run_dir, args.figma_package,
    )

    run_id = _resolve_run_id(run_dir, manifest, args.run_id)

    row = build_cardnews_row(
        analysis_report=analysis_report,
        cardnews_copy=cardnews_copy,
        manifest=manifest,
        run_id=run_id,
        copy_status=args.copy_status,
        design_status=args.design_status,
        figma_file_url=args.figma_file_url,
        png_folder=args.png_folder,
        reviewer_notes=args.reviewer_notes,
    )

    print(f"[export] run_id        = {run_id}")
    print(f"[export] product       = {row['product_name']}")
    print(f"[export] goods_no      = {row['goods_no']}")
    print(f"[export] category      = {row['category']}")
    print(f"[export] profile_id    = {row['profile_id']}")
    print(f"[export] review_count  = {row['review_count']}")
    print(f"[export] copy source   = {copy_source}")

    if args.sheet_id:
        if args.google_credentials is None:
            raise SystemExit(
                "--sheet-id requires --google-credentials <path-to-sa.json>"
            )
        action = gspread_upsert(
            sheet_id=args.sheet_id, tab=args.tab,
            credentials_path=args.google_credentials.resolve(),
            new_row=row,
            overwrite_status=args.overwrite_status,
        )
        print(f"[export] gspread upsert → {action} (tab={args.tab!r})")
    else:
        action, _all = csv_upsert(
            args.csv_out.resolve(),
            row,
            overwrite_status=args.overwrite_status,
        )
        print(f"[export] CSV upsert → {action} ({args.csv_out.resolve()})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
