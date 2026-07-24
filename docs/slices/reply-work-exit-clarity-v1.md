# Slice — 내 답변 작업 Exit Clarity v1 (frontend-only)

> **Status:** IMPLEMENTED, offline. Frontend-only. The 내 답변 작업 worklist stops presenting a second,
> silently-misbehaving "take it off my list" control, and 작업에서 제외 now **asks before it acts** and
> **acknowledges after**. No backend, contract, Bridge, automation, or channel change.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT (the 내 답변 작업 worklist)
- **Date:** 2026-07-24 · **Live contact:** none

---

## 1. Why — the row had five unexplained exits, and the newest was a silent trapdoor

A UX audit of the review-reply loop (attention signal → triage → 내 답변 작업 → draft/manual handoff →
reported UNVERIFIED / 작업에서 제외 → re-entry) found the highest-impact remaining comprehension defect
on the 내 답변 작업 to-do row. Every row reused `VocItemCard` unchanged, so it rendered the **full
interactive 처리 상태 toggle** (대응 필요 / 지켜보기 / 조치 불필요) **beside** the new 작업에서 제외 link:

- The toggle read as a **second "remove from my list" control** — but moving a **drafted** row to
  지켜보기 does **not** remove it (the draft leg of the worklist predicate holds it), so the seller
  clicks 지켜보기, the row stays, and reasonably concludes the control is broken. This is the exact trap
  `reply-work-dismissal-v1.md §1` documents, now surfaced directly on the primary worklist.
- 작업에서 제외 removed committed work on a single click with **no confirmation and no feedback** — the
  row just vanished on the refetch — and there is **no separate dismissed-items view**.

## 2. What changed (frontend only)

**Read-only triage on the worklist.** `VocItemCard` gains a `triageMode: "edit" | "readonly"` prop
(default `"edit"`, so the arrival-signal drill-down is untouched). `MyReplyWork` passes `"readonly"`:
the row now **shows** the decision as a compact label (`triageDispositionLabel`, sourced from the same
`TRIAGE_OPTIONS` copy so the two can never drift), and offers **no** triage buttons. Editing the
disposition stays where the decision is actually made — the drill-down. The reply-preparation flow is
unchanged in both modes: a 대응 필요 row still opens 답변 준비 and its 초안 저장/승인/복사/handoff controls.

**작업에서 제외 asks first.** The link now opens an inline confirmation instead of writing on the click.
The confirmation states the four facts that keep dismissal honest: it leaves **only** the 내 답변 작업
list, the saved **draft and history survive**, nothing is **recorded as replied**, and there is **no
separate dismissed-items view** yet. 취소 backs out with nothing written; 제외하기 performs the existing
idempotent dismiss call (a fresh `commandId` per intent), unchanged.

**Success is acknowledged, not silent.** After a confirmed dismissal a surface-level `role="status"`
message says the review was set aside and the draft/record survive — shown before the refetch removes
the row, so the seller is told what happened rather than watching committed work disappear.

## 3. What is NOT in this slice

- **No undo.** The dismiss API records a dismissal; it does not, by itself, create a genuinely newer
  re-entry trigger, so no "undo" is claimed or added. Re-entry remains the backend's two existing
  triggers (a newer RESPONSE_NEEDED decision or a newer draft version), unchanged.
- **No dismissed-items view.** Rescuing a window-aged dismissal needs a backend read and is out of a
  frontend-only slice; the confirmation says the view does not exist rather than implying permanence.
- **No backend, contract, Bridge, automation, migration, or channel change.** The dismiss/triage/prep
  endpoints and the worklist predicate are all untouched.

## 4. Verification

| | before | after |
|---|---|---|
| frontend | 816 | **820** |
| backend | untouched | untouched |
| collector | untouched | untouched |

Frontend typecheck clean. New/updated tests in `MyReplyWork.test.tsx` (+5 net): the confirmation copy
states all four facts before any write; 취소 writes nothing and keeps the row; 제외하기 calls the dismiss
endpoint once (with an idempotency key), shows the success acknowledgement, and drops the row on
refetch with no completion word; the worklist offers **no** interactive triage control (only a
read-only label); and a 대응 필요 row still opens the 답변 준비 flow with 초안 저장 live.

**Falsified:** removing `triageMode="readonly"` from the to-do card fails the no-competing-triage test;
making the 작업에서 제외 click write immediately (no confirmation) fails the copy, cancellation, and
success tests.
