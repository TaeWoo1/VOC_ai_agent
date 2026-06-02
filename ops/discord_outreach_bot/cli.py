#!/usr/bin/env python3
"""Discord outreach operator bot — v0.1 CLI.

Read-only operator surface over the outreach_packet workflow. Run from the
repo root or anywhere; the repo root is auto-detected.

  python3 ops/discord_outreach_bot/cli.py list_targets
  python3 ops/discord_outreach_bot/cli.py show_status snature_aqua_squalane_cream_v1
  python3 ops/discord_outreach_bot/cli.py next_action snature_aqua_squalane_cream_v1
  python3 ops/discord_outreach_bot/cli.py build_prompt snature_aqua_squalane_cream_v1
  python3 ops/discord_outreach_bot/cli.py build_prompt <slug> --stage corpus_review
  python3 ops/discord_outreach_bot/cli.py followups [--today 2026-05-31]
  python3 ops/discord_outreach_bot/cli.py validate_packet <slug>

This tool NEVER writes packet files, NEVER sends email, NEVER runs collection,
and NEVER commits. It only reads JSON/Markdown and prints to stdout.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path

# Standalone ops tool: make the package dir importable regardless of CWD.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import followups as _followups          # noqa: E402
import prompt_builder as _pb            # noqa: E402
import status_reader as _sr             # noqa: E402

# State ordering + the file each milestone requires (cumulative).
_STATE_ORDER = [
    "CANDIDATE_SELECTED", "ICP_CHECKED", "COLLECTION_READY", "CORPUS_READY",
    "ANGLE_CANDIDATE", "ANGLE_APPROVED", "PACKET_DRAFTED", "COPY_QA_PASSED",
    "PDF_READY", "RECIPIENT_CONFIRMED", "READY_TO_SCHEDULE", "SCHEDULED", "SENT",
    "FOLLOW_UP_DUE", "CLOSED",
]
# state at/after which a file is required -> the file(s)
_REQUIRED_AT = {
    "PACKET_DRAFTED": list(_sr.PACKET_FILES),
    "PDF_READY": ["*.pdf"],
    "READY_TO_SCHEDULE": ["send_log.md"],
}


def _ordinal(state: str) -> int:
    return _STATE_ORDER.index(state) if state in _STATE_ORDER else -1


def _resolve(slug: str, targets_dir):
    t = _sr.get_target(slug, targets_dir)
    if t is None:
        print(f"ERROR: no packet matching '{slug}' under "
              f"{targets_dir or _sr.default_targets_dir()}", file=sys.stderr)
        raise SystemExit(2)
    return t


# --- commands ----------------------------------------------------------------
def cmd_list_targets(args, targets_dir) -> None:
    targets = _sr.discover_targets(targets_dir)
    if not targets:
        print(f"No targets found under {targets_dir or _sr.default_targets_dir()}")
        return
    print(f"{len(targets)} outreach target(s):\n")
    for t in targets:
        src = "status.json" if t.has_status_json else (
            "send_log.md" if t.send_log_text else "files-only")
        gate = _pb.step_for(t.state).gate
        print(f"  {gate} {t.state:<20} {t.brand}  ({t.slug})  [{src}]")


def cmd_show_status(args, targets_dir) -> None:
    t = _resolve(args.slug, targets_dir)
    step = _pb.step_for(t.state)
    print(f"# {t.brand}  ({t.slug})")
    print(f"  goodsNo:        {t.goods_no}")
    if t.product_name:
        print(f"  product:        {t.product_name}")
    print(f"  state:          {step.gate} {t.state}")
    if t.corpus_unique is not None:
        print(f"  corpus unique:  {t.corpus_unique}")
    if t.approved_angle:
        angle = t.approved_angle
        angle_str = angle.get("id") or angle.get("title") if isinstance(angle, dict) else angle
        print(f"  approved angle: {angle_str}")
    if t.recipient:
        print(f"  recipient:      {t.recipient}")
    if t.scheduled_or_sent:
        print(f"  scheduled/sent: {t.scheduled_or_sent}")
    if t.follow_up_due:
        print(f"  follow-up due:  {t.follow_up_due}")
    print(f"  response:       {t.response if t.response else '(none yet)'}")
    if not t.has_status_json:
        print("  note:           legacy packet — no status.json (state read from send_log.md)")
    print(f"\n  next: {_pb.next_action_line(t.state)}")


def cmd_next_action(args, targets_dir) -> None:
    t = _resolve(args.slug, targets_dir)
    step = _pb.step_for(t.state)
    print(f"{t.brand} ({t.slug}) is at {step.gate} {t.state}")
    print(f"next: {_pb.next_action_line(t.state)}")
    print(f"\n{step.instruction}")
    if step.gate == _pb.RED and step.command:
        print(f"\n⛔ {step.command} needs operator approval: {step.gate_note}")


def cmd_build_prompt(args, targets_dir) -> None:
    t = _resolve(args.slug, targets_dir)
    print(_pb.build_prompt(t, stage=args.stage))


def cmd_new_candidate(args, targets_dir) -> None:
    # Read-only entry point for the NEXT target: emits a candidate_check prompt
    # from CLI args without creating any folder/status.json.
    print(_pb.build_new_candidate_prompt(
        brand=args.brand, product=args.product,
        goods_no=args.goods_no, slug=args.slug))


def cmd_followups(args, targets_dir) -> None:
    today = _dt.date.fromisoformat(args.today) if args.today else _dt.date.today()
    rows = _followups.collect_followups(today, targets_dir)
    print(_followups.format_followups(rows, today))


def cmd_validate_packet(args, targets_dir) -> None:
    t = _resolve(args.slug, targets_dir)
    ord_state = _ordinal(t.state)
    print(f"# validate {t.brand} ({t.slug}) at state {t.state}\n")
    problems = 0
    if not t.has_status_json:
        print("  ⚠ status.json missing (legacy packet) — state inferred from send_log.md")
    for req_state, files in _REQUIRED_AT.items():
        if ord_state >= _ordinal(req_state):
            for f in files:
                ok = (f in t.present_files) or (
                    f.startswith("*.") and bool(list(t.path.glob(f))))
                mark = "OK " if ok else "MISSING"
                if not ok:
                    problems += 1
                print(f"  [{mark}] {f}  (required at >= {req_state})")
    if ord_state < _ordinal("PACKET_DRAFTED"):
        print("  (no packet files required yet at this state)")
    print()
    print("RESULT: " + ("OK — all files required for this state are present"
                        if problems == 0 else
                        f"{problems} file(s) MISSING for this state"))
    raise SystemExit(1 if problems else 0)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="outreach-bot",
        description="Read-only operator surface over the outreach_packet workflow (v0.1).",
    )
    p.add_argument("--targets-dir", default=None,
                   help="override the packets dir (default: outputs/outreach/new_targets)")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("list_targets", help="show all outreach targets and states")

    sp = sub.add_parser("show_status", help="compact state summary for one target")
    sp.add_argument("slug")

    sp = sub.add_parser("next_action", help="recommended next move for one target")
    sp.add_argument("slug")

    sp = sub.add_parser("build_prompt", help="generate the next Claude prompt")
    sp.add_argument("slug")
    sp.add_argument("--stage", default=None,
                    help="explicit stage/command (e.g. corpus_review); default = inferred")

    sp = sub.add_parser("new_candidate",
                        help="emit a candidate_check prompt for a NEW target (creates no files)")
    sp.add_argument("--brand", required=True)
    sp.add_argument("--product", required=True)
    sp.add_argument("--goods-no", required=True, dest="goods_no")
    sp.add_argument("--slug", default=None, help="optional proposed slug")

    sp = sub.add_parser("followups", help="list scheduled/sent targets with follow-up due dates")
    sp.add_argument("--today", default=None, help="override today (YYYY-MM-DD)")

    sp = sub.add_parser("validate_packet", help="check required files exist for the current state")
    sp.add_argument("slug")

    return p


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    targets_dir = Path(args.targets_dir) if args.targets_dir else None
    dispatch = {
        "list_targets": cmd_list_targets,
        "show_status": cmd_show_status,
        "next_action": cmd_next_action,
        "build_prompt": cmd_build_prompt,
        "new_candidate": cmd_new_candidate,
        "followups": cmd_followups,
        "validate_packet": cmd_validate_packet,
    }
    dispatch[args.command](args, targets_dir)


if __name__ == "__main__":
    main()
