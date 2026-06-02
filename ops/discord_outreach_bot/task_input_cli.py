#!/usr/bin/env python3
"""CLI to attach a structured candidate to a shortlist-pick task (M2→M3 bridge).

Thin wrapper over task_inputs.set_candidate. Records-only: it edits the task's
inputs + appends an orchestration event, and invalidates any stale approval. It
NEVER creates packet folders, NEVER mutates status.json/send_log.md, NEVER runs
the runner, NEVER sends/collects/renders/publishes, NEVER commits.

    python3 ops/discord_outreach_bot/task_input_cli.py set-candidate <task_id> \
        --candidate-json <path>
    # or convenience flags:
    python3 ops/discord_outreach_bot/task_input_cli.py set-candidate <task_id> \
        --slug acme_dew_cream_v1 --brand ACME --goods-no A000000111111 \
        --product-name "ACME 수분크림" [--product-url ...] [--note ...]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import orchestration_events as _oev   # noqa: E402
import task_inputs as _ti             # noqa: E402
import task_store as _store           # noqa: E402


def _candidate_from_args(args) -> dict[str, Any]:
    """Build the candidate dict from --candidate-json or the convenience flags."""
    if args.candidate_json:
        raw = Path(args.candidate_json).read_text(encoding="utf-8")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise _ti.CandidateInputError("malformed_candidate_json",
                                          f"--candidate-json is not valid JSON: {exc}")
        if not isinstance(data, dict):
            raise _ti.CandidateInputError("malformed_candidate_json",
                                          "--candidate-json must be a JSON object")
        return data
    cand: dict[str, Any] = {}
    for key, val in (("slug", args.slug), ("brand", args.brand),
                     ("goods_no", args.goods_no), ("product_name", args.product_name),
                     ("product_url", args.product_url), ("note", args.note)):
        if val is not None:
            cand[key] = val
    return cand


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="task-input-cli",
        description="Attach a structured candidate to a candidate_shortlist_pick task.")
    p.add_argument("--store", default=None)
    p.add_argument("--events", default=None)
    sub = p.add_subparsers(dest="command", required=True)
    sc = sub.add_parser("set-candidate")
    sc.add_argument("task_id")
    sc.add_argument("--candidate-json", default=None, dest="candidate_json")
    sc.add_argument("--slug", default=None)
    sc.add_argument("--brand", default=None)
    sc.add_argument("--goods-no", default=None, dest="goods_no")
    sc.add_argument("--product-name", default=None, dest="product_name")
    sc.add_argument("--product-url", default=None, dest="product_url")
    sc.add_argument("--note", default=None)
    args = p.parse_args(argv)

    store_path = Path(args.store) if args.store else _store.default_store_path()
    events_path = Path(args.events) if args.events else _oev.default_events_path()

    try:
        candidate = _candidate_from_args(args)
        out = _ti.set_candidate(args.task_id, candidate,
                                store_path=store_path, events_path=events_path)
    except _ti.CandidateInputError as exc:
        print(f"FAIL [{exc.reason}] {exc}", file=sys.stderr)
        return 1

    print(f"OK — candidate attached to `{out['task_id']}` (slug={out['candidate']['slug']}).")
    if out["approval_invalidated"]:
        print("⚠ prior approval cleared — task is back to needs_approval. "
              "Re-run /task_approve (or task_approve) on the candidate-bound proposal, "
              "then task_runner verify / dry-run.")
    else:
        print(f"status: {out['status']} (no prior approval to invalidate).")
    print("Records-only: no packet folder/file created, no execution.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


# expose for tests / programmatic use
candidate_from_args = _candidate_from_args
