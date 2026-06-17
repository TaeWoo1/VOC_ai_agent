"""Workflow state machine + next-action inference + Claude prompt generation.

This is the anti-copy-paste core: given a target's current state, it knows
the next allowed `outreach:*` move, whether that move needs operator
approval, and it emits a ready-to-paste Claude prompt that already carries
the standing guardrails. The operator no longer hand-writes the next prompt.

All facts here mirror docs/ops/outreach_packet_runbook.md and
.claude/skills/outreach_packet.md. If those change, update GUARDRAILS and
STATE_MACHINE to match — this module does not parse them at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# --- gates -------------------------------------------------------------------
GREEN = "🟢"   # agent may proceed
RED = "🔴"     # NEED_OPERATOR_APPROVAL — hard stop before leaving the state


@dataclass(frozen=True)
class Step:
    state: str
    command: Optional[str]   # outreach:* move that LEAVES this state (None = terminal)
    gate: str
    gate_note: str
    instruction: str         # stage-specific work for the generated prompt


# Ordered 14-state happy path + terminal/exception states.
STATE_MACHINE: dict[str, Step] = {
    "CANDIDATE_SELECTED": Step(
        "CANDIDATE_SELECTED", "outreach:candidate_check", GREEN,
        "agent may proceed",
        "Verify the ICP band and exclusion lists (ops/new_outreach_item_candidates_v3.json, "
        "Brand-20 exclusions). Record size_tier. One SKU, not a list.",
    ),
    "ICP_CHECKED": Step(
        "ICP_CHECKED", "outreach:collect_plan", GREEN,
        "agent may proceed (plan only, no run)",
        "Write the collection plan: sorts (DATETIME_DESC primary), target N, "
        "sendable floor 500, INSERT OR IGNORE idempotency, sidecars preserved. "
        "Do NOT run collection in this state.",
    ),
    "COLLECTION_READY": Step(
        "COLLECTION_READY", "outreach:collect_execute", RED,
        "per-turn LIVE collection authorization required",
        "Run live OY collection ONLY if this turn explicitly authorizes it. First run the "
        "read-only pre-flight (HEAD clean, no competing process, CDP at 127.0.0.1:9222, "
        "target goodsNo tab open + logged-in, .env loaded). On a failed precondition, stop "
        "and print only failed_check + required_action. Treat cursor 429 as rate-limited "
        "(retry_after_cooldown 90min), NOT a DOM failure; no retry-hammer, no DOM recovery.",
    ),
    "CORPUS_READY": Step(
        "CORPUS_READY", "outreach:corpus_review", GREEN,
        "agent may proceed",
        "Summarize the corpus and surface 1-3 candidate angles, each with dual-pole evidence. "
        "Run the MANDATORY claim-risk gate: if the sub-4★ reservation pole is dominated by "
        "skin-reaction or efficacy claims -> HOLD/REJECT, do NOT draft.",
    ),
    "ANGLE_CANDIDATE": Step(
        "ANGLE_CANDIDATE", "outreach:angle_select", RED,
        "operator picks the angle",
        "Present the candidate angles with their dual-pole evidence and recommend one. "
        "STOP — the operator selects the angle; the agent only proposes.",
    ),
    "ANGLE_APPROVED": Step(
        "ANGLE_APPROVED", "outreach:draft_packet", GREEN,
        "agent may proceed",
        "Draft the 4 packet files (email_subject.txt, email_body.txt, bait_report.md, "
        "internal_notes.md) in locked founder-validation tone. Keep the name/contact "
        "placeholder in email_body.txt. 8-10 verbatim DB-substring appendix quotes, mixed poles.",
    ),
    "PACKET_DRAFTED": Step(
        "PACKET_DRAFTED", "outreach:copy_qa", GREEN,
        "agent may proceed (mechanical gate)",
        "Run copy QA: forbidden-word scan on the external 3 files, verbatim DB-substring check "
        "on every appendix quote, no representativeness/ratio, no platform-feature comparison, "
        "fixed data-scope wording, honest count.",
    ),
    "COPY_QA_PASSED": Step(
        "COPY_QA_PASSED", "outreach:render_pdf", RED,
        "PDF generation authorization required",
        "Render the 2-page PDF via scripts/render_outreach_bait_pdf.py ONLY if authorized this "
        "turn. Verify: 2 pages, 0 tofu glyphs, page 1 memo / page 2 appendix split.",
    ),
    "PDF_READY": Step(
        "PDF_READY", "outreach:prepare_send", RED,
        "web lookup + recipient confirmation + send boundary",
        "Find/confirm the official recipient (repo-first; web lookup only if authorized this "
        "turn). Populate send_log.md (recipient, channel, source, confidence). Run send-risk "
        "and final-human-check gates. The agent never sends.",
    ),
    "RECIPIENT_CONFIRMED": Step(
        "RECIPIENT_CONFIRMED", "outreach:prepare_send", RED,
        "continue prepare_send to READY_TO_SCHEDULE",
        "Finish populating send_log.md and run the risk gates to reach READY_TO_SCHEDULE.",
    ),
    "READY_TO_SCHEDULE": Step(
        "READY_TO_SCHEDULE", "outreach:mark_sent", GREEN,
        "record only — agent never sends",
        "Records-only: after the operator manually sends/schedules, update status.json + "
        "send_log.md with status (SCHEDULED/SENT), recipient, time, follow-up due. Do NOT "
        "send, do NOT edit email_body.txt or the PDF, do NOT commit.",
    ),
    "SCHEDULED": Step(
        "SCHEDULED", "outreach:follow_up", RED,
        "wait for reply; re-send / alt-channel needs new approval",
        "Wait for delivery and a reply through the follow-up due date. Only on no-reply by the "
        "due date, run outreach:follow_up (a re-send or alternate channel needs NEW approval). "
        "On a reply, go to outreach:closeout.",
    ),
    # SENT is a first-class post-send state: the operator has already sent (not
    # merely scheduled). It behaves like SCHEDULED for next-action purposes —
    # both wait for a reply and lead to outreach:follow_up (🔴).
    "SENT": Step(
        "SENT", "outreach:follow_up", RED,
        "wait for reply; follow-up / re-send / alt-channel needs operator approval",
        "The operator has already SENT the package. Wait for delivery and a reply through the "
        "follow-up due date. Only on no-reply by the due date, run outreach:follow_up (a re-send "
        "or alternate channel needs NEW operator approval). On a reply, go to outreach:closeout.",
    ),
    "FOLLOW_UP_DUE": Step(
        "FOLLOW_UP_DUE", "outreach:closeout", GREEN,
        "log outcome; re-send/alt-channel still needs approval",
        "Classify the response (substantive / acknowledgment / pass / silence) in send_log.md. "
        "Then outreach:closeout. Any re-send or alternate channel needs new operator approval.",
    ),
    # ---- terminal / exception states ----
    "CLOSED": Step("CLOSED", None, GREEN, "terminal", "Closed. Record outcome + one-line lesson; set next_action pointer."),
    "PARKED": Step("PARKED", None, RED, "parked — needs operator reactivation",
                   "Parked (e.g. claim-risk gate failed). Do NOT draft. Reactivate only if a "
                   "non-skin-reaction angle is later validated and the operator approves."),
    "HELD": Step("HELD", None, RED, "held — needs operator decision",
                 "Held (e.g. review count below the 500 sendable floor). Needs operator decision "
                 "to reopen collection or accept a floor exception."),
    "REJECTED": Step("REJECTED", None, RED, "rejected — terminal", "Rejected for this cycle."),
    "UNKNOWN": Step("UNKNOWN", None, RED, "state could not be determined",
                    "No status.json state found. Inspect the packet folder and set state first."),
    "STATUS_JSON_PARSE_ERROR": Step(
        "STATUS_JSON_PARSE_ERROR", None, RED, "status.json is corrupt",
        "status.json failed to parse. Fix the JSON before continuing."),
}

# command -> the state it operates FROM (for build_prompt <slug> <stage>).
# First occurrence wins: when a command is shared by more than one state
# (outreach:follow_up is reachable from both SCHEDULED and SENT), an explicit
# `--stage follow_up` resolves to the canonical happy-path state (SCHEDULED).
COMMAND_FROM_STATE: dict[str, str] = {}
for _state, _step in STATE_MACHINE.items():
    if _step.command:
        COMMAND_FROM_STATE.setdefault(_step.command.split(":", 1)[1], _state)

# Standing guardrails. Carried into EVERY generated prompt so the operator
# never has to restate them. Sourced from the skill + runbook §4.
FORBIDDEN_WORDS_EXTERNAL = (
    "문제, 개선 필요, 구조적, 양극화, VOC, 인사이트, 데이터 기반, 분석 결과, "
    "전체 리뷰 분석, 대표 표본, 효과 없음, 자극 유발, 피부 문제, 트러블, 두드러기, "
    "여드름, 빨개짐, 따가움, 간지러움"
)
SUBJECT_ALSO_BANS = "분석, 진단, 리포트"

GUARDRAILS = [
    "Manual send only — the agent NEVER sends email and NEVER auto-schedules; it only records an operator's manual send.",
    "No live OY collection without explicit per-turn authorization; run the read-only pre-flight first, then stop if not authorized.",
    "Claim-risk gate is mandatory at corpus_review: skin-reaction / efficacy reviews are excluded from evidence entirely; no medical/safety/efficacy claims, no product-blame.",
    f"Forbidden words in the external 3 files (subject/body/bait_report): {FORBIDDEN_WORDS_EXTERNAL}. Subject ALSO bans: {SUBJECT_ALSO_BANS}.",
    "Evidence appendix: 8-10 examples only, columns ★/시기/리뷰 표현/눈에 띈 이유, mixed poles, verbatim quotes = exact DB substrings (typos preserved); rough quotes summarized as '~취지의 표현 (요약)'.",
    "No representativeness / ratio / star-distribution claims externally. Fixed data-scope wording only.",
    "No platform-feature comparison in external copy (e.g. OY's own AI review summary) — that stays in internal_notes.md.",
    "Founder-validation tone (궁금한 지점 / 보였습니다 / 느꼈습니다); no consulting/AI/audit tone, no metric dumps.",
    "Do NOT modify protected code, and do NOT stage/commit/push unless explicitly told.",
]


def step_for(state: str) -> Step:
    return STATE_MACHINE.get(state, STATE_MACHINE["UNKNOWN"])


def next_action_line(state: str) -> str:
    """One-line recommended next action for a state."""
    step = step_for(state)
    if step.command is None:
        return f"{step.gate} {state}: {step.gate_note} — no automatic next move."
    return f"{step.command}  ({step.gate} {step.gate_note})"


def _angle_str(angle) -> str:
    if isinstance(angle, dict):
        bits = [str(angle.get("id") or "").strip(), str(angle.get("title") or "").strip()]
        return " — ".join(b for b in bits if b) or str(angle)
    return str(angle)


def _state_context(target, state: Optional[str] = None) -> list[str]:
    """Concrete, packet-specific lines so the prompt needs no hand-editing.

    Pulls real values from status.json (dates, recipient, approved angle,
    proposed collection command, etc.). All access is defensive — missing
    fields are simply omitted. `state` may be overridden to reflect an
    explicitly requested stage rather than the packet's current state.
    """
    state = state or target.state
    st = target.status or {}
    lines: list[str] = []

    if state == "COLLECTION_READY":
        plan = st.get("collection_plan", {}) if isinstance(st.get("collection_plan"), dict) else {}
        if plan.get("proposed_command"):
            lines.append("Proposed command (DO NOT run unless this turn authorizes live collection):\n"
                         f"    {plan['proposed_command']}")
        pf = plan.get("preflight_required")
        if isinstance(pf, list) and pf:
            lines.append("Read-only pre-flight MUST all pass first: " + "; ".join(map(str, pf)))
        lines.append("On a failed precondition, stop and print only failed_check + required_action.")

    elif state == "CORPUS_READY":
        if target.corpus_unique is not None:
            lines.append(f"Corpus: {target.corpus_unique} unique reviews (sendable floor = 500).")
        lines.append("Run the MANDATORY claim-risk gate before proposing angles: if the sub-4★ "
                     "reservation pole is skin-reaction/efficacy-dominated → HOLD/REJECT, do NOT draft.")

    elif state == "ANGLE_CANDIDATE":
        cands = st.get("angle_candidates")
        if isinstance(cands, dict):
            lines.append("Candidate angles on file: " + ", ".join(cands.keys()))
        rec = st.get("recommended_primary_angle")
        if isinstance(rec, dict) and rec.get("id"):
            lines.append(f"Agent-recommended primary: {rec['id']} (operator still picks — 🔴).")

    elif state == "ANGLE_APPROVED":
        if target.approved_angle:
            lines.append("Approved angle: " + _angle_str(target.approved_angle))
        if target.corpus_unique is not None:
            lines.append(f"External count must read {target.corpus_unique} honestly (never round up).")

    elif state == "PACKET_DRAFTED":
        lines.append("QA the 4 drafted files; keep the name/contact placeholder in email_body.txt "
                     "(operator fills it at send, not the agent).")

    elif state == "COPY_QA_PASSED":
        lines.append("Render command (run only if PDF generation is authorized this turn):\n"
                     f"    PYTHONPATH=. python3 scripts/render_outreach_bait_pdf.py "
                     f"outputs/outreach/new_targets/{target.slug}/")
        lines.append("Verify the output: 2 pages, 0 tofu glyphs, page 1 memo / page 2 appendix.")

    elif state == "PDF_READY":
        if target.approved_angle:
            lines.append("Approved angle (for recipient-fit reasoning): " + _angle_str(target.approved_angle))
        lines.append("Recipient research is repo-first; web lookup only if authorized this turn; "
                     "operator confirms the recipient. Record source + confidence in send_log.md.")

    elif state == "RECIPIENT_CONFIRMED":
        if target.recipient:
            lines.append(f"Proposed recipient: {target.recipient} (operator confirms before send).")

    elif state == "READY_TO_SCHEDULE":
        if target.recipient:
            lines.append(f"Recipient: {target.recipient}")
        lines.append("mark_sent is RECORDS-ONLY, after the operator manually sends/schedules. "
                     "The agent never sends, never edits email_body.txt or the PDF, never commits.")

    elif state in ("SCHEDULED", "SENT"):
        if target.scheduled_or_sent:
            lines.append(f"Scheduled/sent: {target.scheduled_or_sent}")
        if target.recipient:
            lines.append(f"Recipient: {target.recipient}")
        if target.follow_up_due:
            lines.append(f"Follow-up due: {target.follow_up_due}")
        lines.append(f"Response so far: {target.response if target.response else '(none recorded)'}")
        due = target.follow_up_due or "the follow-up due date"
        lines.append(f"Action rule: if NO reply by {due}, outreach:follow_up = draft a short, "
                     "lighter-touch nudge referencing the original memo (same guardrails); do NOT "
                     "re-attach the PDF or switch channel without NEW approval. If a reply arrived, "
                     "run outreach:closeout instead.")

    elif state == "FOLLOW_UP_DUE":
        if target.follow_up_due:
            lines.append(f"Follow-up was due {target.follow_up_due}.")
        lines.append("Classify the response (substantive / acknowledgment / pass / silence) in send_log.md.")

    return lines


def _terminal_reason(target) -> str:
    st = target.status or {}
    for key in ("parked", "held", "rejected"):
        blk = st.get(key)
        if isinstance(blk, dict) and blk.get("reason"):
            return str(blk["reason"])
    if st.get("state_note"):
        return str(st["state_note"])
    return step_for(target.state).instruction


def _terminal_prompt(target, step: Step) -> str:
    """A USEFUL prompt for a terminal/blocked packet.

    A parked/closed packet is not a dead end for the operator — the workflow
    continues with the *next* target. This drives that move instead of saying
    "nothing to do".
    """
    state = target.state
    reason = _terminal_reason(target)
    st = target.status or {}
    product_line = f"- Product: {target.product_name}\n" if target.product_name else ""

    if state in ("PARKED", "REJECTED"):
        recommend = (
            "## Recommended operator move\n"
            "Do NOT reopen or draft for this packet. The outreach experiment continues with the "
            "NEXT target:\n"
            "1. Name a new K-beauty SKU (brand + goodsNo) that is not on a pause/exclusion list.\n"
            "2. Start a fresh packet and run `outreach:candidate_check` (🟢) on it.\n"
        )
        cond = st.get("parked", {}).get("reactivation_condition") if isinstance(st.get("parked"), dict) else None
        if cond:
            recommend += f"\nReactivate THIS packet only if: {cond}\n"
    elif state == "HELD":
        recommend = (
            "## Recommended operator move\n"
            "Held below the sendable floor (or pending a decision). Do NOT draft. Operator decides:\n"
            "(a) reopen collection (🔴, per-turn live authorization) to clear the 500 floor, OR\n"
            "(b) approve a one-time, case-specific floor exception (record the rationale), OR\n"
            "(c) park and select the next target via `outreach:candidate_check` (🟢).\n"
        )
    elif state == "CLOSED":
        recommend = (
            "## Recommended operator move\n"
            "This packet is closed. Confirm outcome + one-line lesson are recorded, then select the "
            "next target and run `outreach:candidate_check` (🟢) on a fresh packet.\n"
        )
    else:  # UNKNOWN / STATUS_JSON_PARSE_ERROR
        recommend = (
            "## Recommended operator move\n"
            f"State is `{state}` — {step.gate_note}. Inspect the packet folder and establish a valid "
            "state before generating a workflow prompt.\n"
        )

    guardrails = "\n".join(f"- {g}" for g in GUARDRAILS)
    return f"""Use the outreach_packet workflow (.claude/skills/outreach_packet.md + docs/ops/outreach_packet_runbook.md).

## Target
- Brand: {target.brand}
- Slug: {target.slug}
{product_line}- goodsNo: {target.goods_no}
- Packet folder: outputs/outreach/new_targets/{target.slug}/
- Current state: {step.gate} {state} (terminal/blocked)

## Why this packet is {state}
{reason}

{recommend}
## Standing guardrails (always in force — do not restate, just obey)
{guardrails}
"""


def build_prompt(target, stage: Optional[str] = None) -> str:
    """Generate the next Claude prompt for `target`.

    `stage` may be an explicit command (with or without the `outreach:` prefix);
    if omitted, the next move is inferred from the current state.
    """
    state = target.state

    effective_state = state
    if stage:
        cmd = stage.split(":", 1)[1] if stage.startswith("outreach:") else stage
        from_state = COMMAND_FROM_STATE.get(cmd)
        if from_state is None:
            valid = ", ".join(sorted(COMMAND_FROM_STATE))
            return f"# ERROR: unknown stage '{stage}'.\n# Valid stages: {valid}"
        step = step_for(from_state)
        effective_state = from_state
        if from_state != state:
            note = (f"\n> NOTE: requested stage `{step.command}` operates from "
                    f"`{from_state}`, but this packet is at `{state}`. "
                    f"Confirm this is intentional before running.\n")
        else:
            note = ""
    else:
        step = step_for(state)
        note = ""
        if step.command is None:
            # Terminal/blocked: drive the operator's real next move, not a dead end.
            return _terminal_prompt(target, step)

    approval = ""
    if step.gate == RED:
        approval = ("\n## ⛔ Operator approval required\n"
                    f"This move ({step.command}) is a {RED} gate: {step.gate_note}. "
                    "Do not proceed past the gate without explicit authorization in the prompt.\n")

    ctx_lines = _state_context(target, effective_state)
    context = ("\n## State context (from this packet)\n"
               + "\n".join(f"- {c}" for c in ctx_lines) + "\n") if ctx_lines else ""

    guardrails = "\n".join(f"- {g}" for g in GUARDRAILS)
    product_line = f"- Product: {target.product_name}\n" if target.product_name else ""
    url_line = f"- Product URL: {target.product_url}\n" if target.product_url else ""

    return f"""Use the outreach_packet workflow (.claude/skills/outreach_packet.md + docs/ops/outreach_packet_runbook.md).
{note}
## Target
- Brand: {target.brand}
- Slug: {target.slug}
{product_line}- goodsNo: {target.goods_no}
{url_line}- Packet folder: outputs/outreach/new_targets/{target.slug}/
- Current state: {state}

## Move to run
{step.command}  ({step.gate} {step.gate_note})

{step.instruction}
{approval}{context}
## Standing guardrails (always in force — do not restate, just obey)
{guardrails}

## Output format
- verdict / current state + the one move just done
- files changed
- checks run (forbidden-word scan, verbatim check, gate results)
- risks / open decisions
- next allowed command (and whether it needs operator approval)
"""


def build_new_candidate_prompt(brand: str, product: str, goods_no: str,
                               slug: Optional[str] = None) -> str:
    """Read-only candidate_check prompt for a brand-new target.

    Creates NO files — this is the v0.1 entry point for the next target. The
    operator passes brand/product/goodsNo on the CLI; the prompt drives the
    first move (outreach:candidate_check) without scaffolding a packet folder.
    Folder/status.json creation is a v0.2 step, done only after the operator
    confirms the candidate is a GO.
    """
    step = step_for("CANDIDATE_SELECTED")
    slug_display = slug or "<operator chooses, e.g. brand_product_v1>"
    folder = f"outputs/outreach/new_targets/{slug or '<new-slug>'}/"
    guardrails = "\n".join(f"- {g}" for g in GUARDRAILS)

    return f"""Use the outreach_packet workflow (.claude/skills/outreach_packet.md + docs/ops/outreach_packet_runbook.md).

## New candidate (NO packet folder exists yet)
- Brand: {brand}
- Product: {product}
- goodsNo: {goods_no}
- Proposed slug: {slug_display}
- Proposed folder (NOT yet created): {folder}
- Current state: CANDIDATE_SELECTED (pre-folder)

## Move to run
{step.command}  ({step.gate} {step.gate_note})

{step.instruction}

## Read-only entry note
This prompt does NOT create any files. During candidate_check, verify the ICP
band + exclusion lists and report the verdict. Scaffold the packet folder /
status.json ONLY after the operator confirms the candidate is a GO (folder
creation is a v0.2 step, not part of this read-only entry).

## Standing guardrails (always in force — do not restate, just obey)
{guardrails}

## Output format
- verdict (GO / HOLD / exclude) + size_tier
- checks run (ICP band, exclusion/pause lists, OY review count if read-only verifiable)
- risks / open decisions
- next allowed command (and whether it needs operator approval)
"""
