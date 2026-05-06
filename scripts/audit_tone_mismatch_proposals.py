"""Prototype: LLM-audit proposal generator for tone_mismatch.

Two modes, both operating on the same 12-row sanity batch:

  --dry-run (default): compose per-row prompts and write
      ``dry_run_<ts>.json``. No LLM call.
  --live: make one LLM call per row (12 total, not batched), validate
      each response, write ``proposals_<ts>.json`` with raw output +
      parsed JSON + per-row validation_status.

Scope (intentionally narrow):
    - tone_mismatch only
    - 12 rows only (see eval_data/phase1/tone_mismatch_audit/batch_v1.json)
    - one LLM call per row; no batched prompts
    - one retry maximum on JSON-parse failure

Explicit non-goals (mirrors docs/phase2_tone_mismatch_rubric.md 부록 A.6):
    - Does not edit golden labels or lexicons.
    - Does not modify the detection pipeline.
    - Does not auto-merge proposals into golden.
    - Does not run on the full corpus.
    - Does not train or call any ML model.

Usage:
    PYTHONPATH=. python3 scripts/audit_tone_mismatch_proposals.py               # dry-run
    PYTHONPATH=. python3 scripts/audit_tone_mismatch_proposals.py --live \\
        [--model gpt-4o-mini]

``--live`` requires ``OPENAI_API_KEY`` in the environment. The script
fails fast with a clear error if the key is missing — never writes a
partial output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BATCH = REPO_ROOT / "eval_data" / "phase1" / "tone_mismatch_audit" / "batch_v1.json"
DEFAULT_RUBRIC = REPO_ROOT / "docs" / "phase2_tone_mismatch_rubric.md"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "eval_data" / "phase1" / "tone_mismatch_audit"
DEFAULT_GOLDEN = REPO_ROOT / "eval_data" / "phase1" / "phase1_signals_golden.json"
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))

PROMPT_VERSION = "tone_mismatch_v4"
DEFAULT_LIVE_MODEL = "gpt-4o-mini"
VALID_BUCKETS = frozenset({
    "FN_anchor", "TP_anchor",
    "control_positive_fit", "control_pigment_only",
    "control_shade_only", "control_self_tone_no_mismatch",
})
VALID_TONE_VERDICTS = frozenset({"yes", "no", "borderline_yes", "ambiguous"})
REQUIRED_OUTPUT_FIELDS = frozenset({
    "review_id", "tone_mismatch", "rationale_ko",
    "gate_trace", "ambiguity_axis", "adjacent_class_flag",
})
REQUIRED_GATES = ("q1_self_tone", "q2_mismatch", "q3_framing")

# Rule 9 (v4): gate verdicts that imply "no positive evidence to cite".
# For these, confidence must be "absent" and evidence_phrase must be null.
NO_EVIDENCE_VERDICTS: dict[str, frozenset[str]] = {
    "q1_self_tone": frozenset({"no"}),
    "q2_mismatch":  frozenset({"no", "n/a"}),
    "q3_framing":   frozenset({"n/a"}),
}


def _load_dotenv_if_available() -> None:
    """Auto-load ``REPO_ROOT/.env`` if python-dotenv is installed and
    the file exists. Silent no-op otherwise.

    ``override=False`` means any variable already present in the shell
    environment keeps its value — shell wins over ``.env``. This lines
    up with the typical developer expectation: temporary shell exports
    for a single session shouldn't be silently overwritten by whatever
    was in the project's ``.env`` last week.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    env_path = REPO_ROOT / ".env"
    if env_path.is_file():
        load_dotenv(env_path, override=False)


def extract_rubric_sections(markdown: str) -> str:
    """Slice §1 through §9 out of the rubric, excluding appendices.

    Start marker: first line matching ``^## 1\\.`` (§1 first section)
    End marker:   first line matching ``^## 부록`` (appendix start)

    Raises ``ValueError`` if either marker is not found.
    """
    lines = markdown.splitlines()
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if start_idx is None and re.match(r"^## 1\.", line):
            start_idx = i
        elif start_idx is not None and re.match(r"^## 부록", line):
            end_idx = i
            break
    if start_idx is None:
        raise ValueError("Rubric §1 section marker not found (expected '## 1.')")
    if end_idx is None:
        raise ValueError("Rubric appendix start marker not found (expected '## 부록')")
    body = "\n".join(lines[start_idx:end_idx]).strip()
    if not body:
        raise ValueError("Extracted rubric body is empty")
    return body


OUTPUT_SCHEMA_TEXT = """{
  "review_id": "...",
  "tone_mismatch": "yes" | "no" | "borderline_yes" | "ambiguous",
  "rationale_ko": "...",
  "gate_trace": {
    "q1_self_tone": {"verdict":"yes|no","confidence":"high|low|absent","evidence_phrase":"..."},
    "q2_mismatch":  {"verdict":"yes|no|n/a","confidence":"high|low|absent","evidence_phrase":"..."},
    "q3_framing":   {"verdict":"concern|workaround|resolution|ambiguous|n/a","confidence":"high|low|absent","evidence_phrase":"..."}
  },
  "ambiguity_axis": "text_underspecified|gate_conflict|domain_inherent|null",
  "adjacent_class_flag": "pigment_complaint|shade_mismatch|generic_negative|null"
}"""

SYSTEM_PROMPT_TEMPLATE = """You are an audit assistant for a Korean cosmetics-review classification system.
You will classify whether a single review expresses `tone_mismatch` per the rubric below.

STRICT RULES:
1. Apply the §2 체크리스트 gates in order. Stop ONLY at a verdict of NO.
   A `yes/low-confidence` verdict is still `yes` — do NOT collapse
   low-confidence evidence into NO. Low confidence on a `yes` verdict
   is the §9 signal for `borderline_yes`, not for NO.
2. Use the four-value output from §9 (yes / borderline_yes / ambiguous / no).
3. For every `gate_trace` entry with confidence != "absent", `evidence_phrase`
   MUST be a literal substring of the review body — no paraphrase, no
   reformatting, no added or removed characters.
4. If §9's borderline_yes conditions are not met, choose among
   {yes, no, ambiguous}. Do not invent a fifth value.
5. `rationale_ko` MUST be Korean, ≤2 sentences, and cite §2 체크 numbers.
6. Output MUST be strict JSON matching the schema exactly. No prose
   wrapper, no markdown code fence, no commentary.
7. Output `borderline_yes` when ALL THREE conditions hold:
   (a) Q1 verdict=yes AND confidence=high
   (b) at least one of Q2/Q3 has verdict=yes with confidence=low
   (c) no gate contradicts (no verdict=no on any gate)
   If any of (a)(b)(c) fails, `borderline_yes` does NOT apply — fall
   back to yes / no / ambiguous per §9.
8. Always emit every schema field, even when empty. Never omit a field
   from the JSON output. Use `null` for optional fields
   (`ambiguity_axis`, `adjacent_class_flag`, or any `evidence_phrase`
   when that gate's confidence=absent).
9. When a gate's `verdict` is `no` (for Q1 or Q2) or `n/a` (for Q2 or
   Q3), that gate has no positive evidence to cite. In that case:
   (a) set `confidence` to `"absent"`, and
   (b) set `evidence_phrase` to `null` (JSON null, not a string).
   Do NOT use semantic placeholders such as `"없음"`, `"해당 없음"`,
   `"..."`, or an empty string `""`. A NO or n/a verdict means the text
   did not provide evidence for YES — therefore there is no phrase to
   cite, and `evidence_phrase` must be `null`.

=== RUBRIC (§1–§9, Korean — authoritative) ===

@@RUBRIC_BODY@@

=== OUTPUT JSON SCHEMA ===

@@OUTPUT_SCHEMA@@
"""


def compose_system_prompt(rubric_body: str) -> str:
    # Sentinel-replace instead of str.format() — the rubric body and the
    # rules block both contain literal `{...}` that would collide with
    # .format()'s field-parsing.
    return (
        SYSTEM_PROMPT_TEMPLATE
        .replace("@@RUBRIC_BODY@@", rubric_body)
        .replace("@@OUTPUT_SCHEMA@@", OUTPUT_SCHEMA_TEXT)
    )


def compose_user_payload(*, review_id: str, text: str,
                         rating: float | None) -> dict:
    """Build the JSON payload sent to the LLM as the user message.

    Intentionally does NOT include `existing_concerns` — exposing prior
    golden labels to the LLM leaks the answer (the target class's
    presence/absence in that list effectively pre-classifies the row).
    Adjacent-class guidance lives in rubric §5 instead.

    `existing_concerns` is still recorded at the per-row record level
    (outside this payload) for human-reviewer context.
    """
    return {
        "review_id": review_id,
        "text": text,
        "rating": rating,
    }


def load_fixture(path: Path) -> list[dict]:
    if not path.is_file():
        raise FileNotFoundError(f"batch fixture missing at {path}")
    batch = json.loads(path.read_text(encoding="utf-8"))
    rows = batch.get("rows", [])
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"fixture at {path} has no 'rows' list")
    seen_ids: set[str] = set()
    for r in rows:
        rid = r.get("review_id")
        bucket = r.get("bucket")
        if not isinstance(rid, str) or not rid:
            raise ValueError(f"fixture row missing review_id: {r}")
        if rid in seen_ids:
            raise ValueError(f"duplicate review_id in fixture: {rid}")
        seen_ids.add(rid)
        if bucket not in VALID_BUCKETS:
            raise ValueError(
                f"invalid bucket '{bucket}' for {rid}; "
                f"must be one of {sorted(VALID_BUCKETS)}"
            )
    return rows


def call_llm(
    *, system_prompt: str, user_payload: dict, model: str, api_key: str,
) -> tuple[str, Exception | None]:
    """One LLM call. Returns (raw_text, error).

    On API error, returns (``""``, exception). Caller decides retry.
    Lazy-imports ``openai`` so dry-run mode (and tests that don't touch
    the live path) don't require the SDK to be present at import time.
    """
    from openai import OpenAI  # lazy: dry-run / tests don't need the SDK

    client = OpenAI(api_key=api_key)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",
                 "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        return (resp.choices[0].message.content or ""), None
    except Exception as e:   # noqa: BLE001 — caller distinguishes
        return "", e


def validate_proposal(
    *, raw: str, text: str,
) -> tuple[dict | None, str, list[str]]:
    """Parse + validate one LLM response against schema and evidence rules.

    Returns ``(parsed_or_None, status, issues)``. ``status`` is one of:

      - ``"valid"``
      - ``"invalid_json"``       — JSON parse failure (caller may retry once)
      - ``"invalid_schema"``     — missing required fields / wrong types
      - ``"invalid_value"``      — tone_mismatch value out of range
      - ``"evidence_hallucination"`` — evidence_phrase not a substring of text

    Issues are human-readable strings for audit logging. Never raises.
    """
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, "invalid_json", [f"JSON parse error: {e}"]

    if not isinstance(parsed, dict):
        return None, "invalid_json", ["top-level JSON is not an object"]

    missing = REQUIRED_OUTPUT_FIELDS - set(parsed.keys())
    if missing:
        return parsed, "invalid_schema", [f"missing fields: {sorted(missing)}"]

    tm = parsed.get("tone_mismatch")
    if tm not in VALID_TONE_VERDICTS:
        return parsed, "invalid_value", [f"invalid tone_mismatch value: {tm!r}"]

    gate_trace = parsed.get("gate_trace")
    if not isinstance(gate_trace, dict):
        return parsed, "invalid_schema", ["gate_trace not a JSON object"]
    gate_missing = [g for g in REQUIRED_GATES if g not in gate_trace]
    if gate_missing:
        return parsed, "invalid_schema", [f"gate_trace missing: {gate_missing}"]

    # Evidence checks — combine Rule 9 (no-evidence contract) with the
    # substring check. Both surface under `evidence_hallucination` since
    # both concern evidence_phrase correctness.
    issues: list[str] = []
    for gate_name in REQUIRED_GATES:
        gate = gate_trace[gate_name]
        if not isinstance(gate, dict):
            issues.append(f"{gate_name} not a JSON object")
            continue
        verdict = gate.get("verdict")
        confidence = gate.get("confidence")
        evidence = gate.get("evidence_phrase")

        # Rule 9 (v4): verdicts implying "no positive evidence" must use
        # confidence=absent + evidence_phrase=null. No placeholders.
        no_ev_verdicts = NO_EVIDENCE_VERDICTS.get(gate_name, frozenset())
        if verdict in no_ev_verdicts:
            if confidence != "absent":
                issues.append(
                    f"{gate_name}: verdict={verdict!r} requires confidence='absent' "
                    f"(got {confidence!r}) — Rule 9 v4"
                )
            if evidence is not None:
                preview = (evidence[:60] + "…") if isinstance(evidence, str) and len(evidence) > 60 else evidence
                issues.append(
                    f"{gate_name}: verdict={verdict!r} requires evidence_phrase=null "
                    f"(got {preview!r}) — Rule 9 v4"
                )
            # Don't also run substring check on this gate
            continue

        # Substring check — only when gate claims it cited text
        if confidence not in (None, "absent") and evidence:
            if evidence not in text:
                preview = evidence[:80] + ("…" if len(evidence) > 80 else "")
                issues.append(
                    f"{gate_name}: evidence_phrase not a substring of text "
                    f"(confidence={confidence}, phrase={preview!r})"
                )

    if issues:
        return parsed, "evidence_hallucination", issues

    return parsed, "valid", []


def build_live_records(
    *,
    fixture_rows: list[dict],
    rows_by_id: dict[str, dict],
    golden_labels: dict,
    rubric_sha256: str,
    system_prompt: str,
    model: str,
    api_key: str,
    progress_stream=None,
) -> list[dict]:
    """Per-row live LLM audit. One call each, retry-once on invalid_json.

    Returns per-row records with raw_output, parsed, validation_status,
    issues. Never raises on model errors — captures them as records.
    """
    records: list[dict] = []
    for i, meta in enumerate(fixture_rows, 1):
        rid = meta["review_id"]
        bucket = meta["bucket"]
        db_row = rows_by_id[rid]
        text = db_row.get("text") or ""
        rating = db_row.get("rating_raw")
        payload = compose_user_payload(review_id=rid, text=text, rating=rating)
        existing_concerns_meta = golden_labels.get(rid, {}).get("concerns", [])

        if progress_stream:
            progress_stream.write(f"[{i:2d}/{len(fixture_rows)}] calling LLM for {rid} ({bucket})\n")
            progress_stream.flush()

        raw, err = call_llm(
            system_prompt=system_prompt, user_payload=payload,
            model=model, api_key=api_key,
        )
        retries = 0
        if err is not None:
            # One retry on API failure
            raw, err = call_llm(
                system_prompt=system_prompt, user_payload=payload,
                model=model, api_key=api_key,
            )
            retries = 1
            if err is not None:
                records.append({
                    "review_id": rid,
                    "bucket": bucket,
                    "rating": rating,
                    "text": text,
                    "existing_concerns_human_context_only": existing_concerns_meta,
                    "prompt_version": PROMPT_VERSION,
                    "rubric_sha256": rubric_sha256,
                    "raw_output": "",
                    "parsed": None,
                    "validation_status": "api_error",
                    "issues": [f"API error after retry: {err!r}"],
                    "retries": retries,
                })
                continue

        parsed, status, issues = validate_proposal(raw=raw, text=text)

        # One retry on JSON parse failure ONLY (per spec: no more than one retry)
        if status == "invalid_json" and retries == 0:
            raw2, err2 = call_llm(
                system_prompt=system_prompt, user_payload=payload,
                model=model, api_key=api_key,
            )
            retries = 1
            if err2 is None:
                parsed2, status2, issues2 = validate_proposal(raw=raw2, text=text)
                raw, parsed, status, issues = raw2, parsed2, status2, issues2

        records.append({
            "review_id": rid,
            "bucket": bucket,
            "rating": rating,
            "text": text,
            "existing_concerns_human_context_only": existing_concerns_meta,
            "prompt_version": PROMPT_VERSION,
            "rubric_sha256": rubric_sha256,
            "raw_output": raw,
            "parsed": parsed,
            "validation_status": status,
            "issues": issues,
            "retries": retries,
        })
    return records


def build_dry_run_records(
    *,
    fixture_rows: list[dict],
    rows_by_id: dict[str, dict],
    golden_labels: dict,
    rubric_sha256: str,
) -> list[dict]:
    out: list[dict] = []
    for meta in fixture_rows:
        rid = meta["review_id"]
        bucket = meta["bucket"]
        db_row = rows_by_id[rid]
        golden_entry = golden_labels.get(rid, {})
        payload = compose_user_payload(
            review_id=rid,
            text=db_row.get("text") or "",
            rating=db_row.get("rating_raw"),
        )
        # `existing_concerns` is kept at the row-record level for the
        # human reviewer (context during audit), but DELIBERATELY
        # excluded from `user_input_payload` — the payload is what the
        # LLM sees, and including existing concerns leaks the answer.
        existing_concerns_meta = golden_entry.get("concerns", [])
        out.append({
            "review_id": rid,
            "bucket": bucket,
            "rating": payload["rating"],
            "text": payload["text"],
            "existing_concerns_human_context_only": existing_concerns_meta,
            "prompt_version": PROMPT_VERSION,
            "rubric_sha256": rubric_sha256,
            "user_input_payload": payload,
        })
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Tone-mismatch LLM audit prototype (dry-run / live).",
    )
    p.add_argument("--batch", type=Path, default=DEFAULT_BATCH,
                   help=f"batch fixture (default: {DEFAULT_BATCH})")
    p.add_argument("--rubric", type=Path, default=DEFAULT_RUBRIC,
                   help=f"rubric markdown (default: {DEFAULT_RUBRIC})")
    p.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN,
                   help="golden labels JSON for existing_concerns context")
    p.add_argument("--db", type=str, default=DEFAULT_DB,
                   help=f"phase1 DB path (default: {DEFAULT_DB})")
    p.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR,
                   help=f"output directory (default: {DEFAULT_OUTPUT_DIR})")
    p.add_argument("--live", action="store_true",
                   help="call the LLM for each row (requires OPENAI_API_KEY)")
    p.add_argument("--model", type=str, default=DEFAULT_LIVE_MODEL,
                   help=f"model id for --live mode (default: {DEFAULT_LIVE_MODEL})")
    args = p.parse_args(argv if argv is not None else sys.argv[1:])

    # Auto-load .env from the repo root. Shell env takes precedence
    # (override=False). No-op if python-dotenv or .env is absent.
    _load_dotenv_if_available()

    # Pre-flight env check for --live: fail loudly BEFORE any work
    if args.live:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            sys.stderr.write(
                "ERROR: --live mode requires OPENAI_API_KEY in the environment "
                "or in a repo-root .env file. No partial output written.\n"
            )
            return 2
    else:
        api_key = None

    # Load fixture
    try:
        fixture_rows = load_fixture(args.batch)
    except (FileNotFoundError, ValueError) as e:
        sys.stderr.write(f"ERROR: fixture load failed: {e}\n")
        return 2

    # Load rubric
    if not args.rubric.is_file():
        sys.stderr.write(f"ERROR: rubric missing at {args.rubric}\n")
        return 2
    rubric_full = args.rubric.read_text(encoding="utf-8")
    try:
        rubric_body = extract_rubric_sections(rubric_full)
    except ValueError as e:
        sys.stderr.write(f"ERROR: rubric extraction failed: {e}\n")
        return 2
    rubric_sha256 = hashlib.sha256(rubric_body.encode("utf-8")).hexdigest()

    # Load golden (context for existing_concerns)
    if args.golden.is_file():
        golden = json.loads(args.golden.read_text(encoding="utf-8"))
    else:
        golden = {"labels": {}}
    golden_labels = golden.get("labels", {})

    # Load review text from DB
    db_path = Path(args.db)
    if not db_path.is_file():
        sys.stderr.write(f"ERROR: DB not found at {db_path}\n")
        return 2
    db = init_db(str(db_path))
    try:
        repo = Phase1ReviewRepository(db)
        all_rows = repo.query()
    finally:
        db.close()
    rows_by_id = {str(r["review_id"]): r for r in all_rows}

    # Validate every fixture id exists in DB
    fixture_ids = [m["review_id"] for m in fixture_rows]
    missing = [rid for rid in fixture_ids if rid not in rows_by_id]
    if missing:
        sys.stderr.write(
            f"ERROR: {len(missing)} fixture review_ids missing from DB: {missing}\n"
        )
        return 2

    # Compose system prompt once; build per-row records (mode-dependent)
    system_prompt = compose_system_prompt(rubric_body)

    def _repo_relative(p: Path) -> str:
        try:
            return str(p.resolve().relative_to(REPO_ROOT))
        except ValueError:
            return str(p)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    if args.live:
        # Live mode: call LLM once per row, validate, emit proposals file
        live_rows = build_live_records(
            fixture_rows=fixture_rows,
            rows_by_id=rows_by_id,
            golden_labels=golden_labels,
            rubric_sha256=rubric_sha256,
            system_prompt=system_prompt,
            model=args.model,
            api_key=api_key,   # type: ignore[arg-type]
            progress_stream=sys.stderr,
        )
        out_path = args.output_dir / f"proposals_{ts}.json"
        status_counts: dict[str, int] = {}
        for r in live_rows:
            status_counts[r["validation_status"]] = status_counts.get(
                r["validation_status"], 0) + 1
        artifact = {
            "run_metadata": {
                "timestamp_utc": ts,
                "mode": "live",
                "model_id": args.model,
                "prompt_version": PROMPT_VERSION,
                "rubric_sha256": rubric_sha256,
                "rubric_body_chars": len(rubric_body),
                "batch_file": _repo_relative(args.batch),
                "rubric_file": _repo_relative(args.rubric),
                "db_path": str(db_path),
                "n_rows": len(live_rows),
                "validation_status_counts": status_counts,
                "system_prompt": system_prompt,
            },
            "rows": live_rows,
        }
    else:
        # Dry-run mode: compose only; no LLM
        dry_rows = build_dry_run_records(
            fixture_rows=fixture_rows,
            rows_by_id=rows_by_id,
            golden_labels=golden_labels,
            rubric_sha256=rubric_sha256,
        )
        out_path = args.output_dir / f"dry_run_{ts}.json"
        artifact = {
            "run_metadata": {
                "timestamp_utc": ts,
                "mode": "dry_run",
                "prompt_version": PROMPT_VERSION,
                "rubric_sha256": rubric_sha256,
                "rubric_body_chars": len(rubric_body),
                "batch_file": _repo_relative(args.batch),
                "rubric_file": _repo_relative(args.rubric),
                "db_path": str(db_path),
                "n_rows": len(dry_rows),
                "system_prompt": system_prompt,
            },
            "rows": dry_rows,
        }

    out_path.write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = {
        "output_path": str(out_path),
        "mode": artifact["run_metadata"]["mode"],
        "n_rows": artifact["run_metadata"]["n_rows"],
        "rubric_sha256_short": rubric_sha256[:16],
        "prompt_version": PROMPT_VERSION,
        "bucket_counts": {
            b: sum(1 for r in artifact["rows"] if r["bucket"] == b)
            for b in VALID_BUCKETS
            if any(r["bucket"] == b for r in artifact["rows"])
        },
    }
    if args.live:
        summary["model_id"] = args.model
        summary["validation_status_counts"] = \
            artifact["run_metadata"]["validation_status_counts"]
    sys.stderr.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
