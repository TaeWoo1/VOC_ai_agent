# Cafe24 Channel v1 — Completion Baseline

> **What this is.** A docs-only baseline declaring **Cafe24 pilot v1 (channel v1) complete** and fixing
> its capability matrix + proof levels at `origin/main` `97ad192` (2026-07-31). It **redefines nothing**
> — capability truth stays `docs/multi-channel-connector-roadmap.md` §4.1; this doc derives from §4.1,
> the per-capability live-proof docs, and the recovery baseline
> `docs/sellerops_completion_checkpoint_v1.md`.
>
> **v1 ≠ production-supported.** Every capability below is **supervised, single-account, disposable/
> local-backend** pilot evidence — never production, never unattended, never a seller-facing "지원".
> **운영 지원 (production-supported) remains file-upload-only.** Cafe24 v1 = *pilot-complete*.

## 1. Channel v1 definition (what "complete" means here)

A Cafe24 pilot v1 is complete when all of the following are demonstrated (pilot-level):

1. **Connect** — guided first-connection + OAuth credential lifecycle.
2. **Acquire** orders, inquiries, and reviews.
3. **Exact-window + dedup** — bounded acquisition with idempotent replay.
4. **Privacy** — secret/PII boundaries enforced fail-closed.
5. **Attention + Issue Memory** — acquired data reaches the operator surface and the issue pipeline.
6. **Agent draft/brief capability** — read-only draft/brief at a human checkpoint.
7. **Unsupported write shown honestly as deferred** — no reply/comment write claimed.

## 2. Capability matrix (pilot-level proof)

| Capability | Proof level | Evidence (PR → merge SHA) |
|---|---|---|
| First Connection Tutorial (read-only capability check + wizard) | **live-proven** | #383 → `b56bf1e` |
| OAuth credential decrypt + refresh rotation | **live-proven** | observed across #382 `14231a0` / #386 `87a176f` (rotation across runs) |
| ORDER_SUMMARY (API/OAuth) | **live-proven** | #374 → `7638f10` (C1/C2: token rotation + amount reconciliation + idempotent replay) |
| INQUIRY read — board 6, exact-window / read / privacy / status / replay | **live-proven** | #382 → `14231a0` (exact-window contract; `is_secret`; C→ANSWERED; secret boundary; idempotent replay) |
| REVIEW read — board 4, exact-window / read / replay / accounting | **live-proven** | #375 → `0ae0900` (read + 비밀글 fail-closed exclusion) · #386 → `87a176f` (idempotent replay + sanitized accounting + reply_status distribution) |
| Operator Attention/VOC exposure | **live-proven** | #386 `87a176f` (`NEW_REVIEW=1` via `Cafe24VocItemSource`) |
| Historical REVIEW promotion → review store | **real-source downstream-proven** | #387 → `97ad192` (bounded reconciler; `promoted=1`, no Cafe24 API) |
| Issue Memory extraction seam (Cafe24 review reaches extraction) | **real-source reached** | #387 `97ad192` (promoted review → extraction ran → opinion units FK-traceable) |
| Complaint review → `review_issue` + evidence | **synthetic-proven** | #387 `97ad192` (H2 tests; the real proof row was neutral → unknown-unit pen, 0 issues) |
| Existing `issue` LangGraph reused (no new graph) | **structural** | #387 `97ad192` (agent-runtime byte-unchanged; org-scoped `/api/review-issues/*`) |
| Inquiry answer draft (agent-runtime `INQUIRY_DRAFT`, no-send) | **synthetic-proven** | #384 → `026c113` (read-only draft → terminal human checkpoint) |

**Proof-level meanings:** *live-proven* = ≥1 supervised real Cafe24 run, sanitized evidence.
*real-source downstream-proven / reached* = exercised on real stored Cafe24 data with **no Cafe24 API
call** (downstream processing only). *synthetic-proven* = verified on synthetic/disposable fixtures.
*structural* = guaranteed by construction (e.g. zero diff to the reused component).

## 3. Deferred — v1.1 / non-blocking (explicitly NOT part of v1)

- Cafe24 **reply / comment write API** (spike + Guided Handoff backend preserved on branches only).
- **Guided Handoff frontend / runtime**.
- **Live complaint-issue creation** (a real Cafe24 review that carries a rule-based complaint → `review_issue`).
- **Live full `N`/`P`/`C` reply-status distribution** (only `UNKNOWN` live-observed on board 4 to date).
- **Live secret-review exclusion** (no 비밀글 present in the proof windows; exclusion is tests-only live).
- **Fresh board-4 insert re-observation** (the completion run was an idempotent skip of the pre-existing row).
- **CSV dual-ingest hard fence** (the CSV-upload vs API-sync double-count boundary is documented, not code-enforced).
- **Scheduled historical reconciliation** (reconciler runs on-demand / after a backfill, not on a schedule).

## 4. Honesty fences — what this baseline does NOT claim

- **No Cafe24 reply/comment write support** — SellerOps neither posts nor submits any Cafe24 reply.
- **Not all reply-status tokens are live-proven** — only `UNKNOWN` was live-observed; `N`/`P`/`C` are tests-only.
- **Real complaint-issue creation is not live-proven** — the real proof review was neutral (0 issues); the
  article→issue+evidence path is synthetic-proven.
- **No full automation without human checkpoints** — the agent draft/brief capabilities stop at a human
  checkpoint; no autonomous send/mutation.
- **Not production-supported / not seller-facing** — pilot-only, supervised, disposable backend.

## 5. Pointers

Recovery baseline `docs/sellerops_completion_checkpoint_v1.md` · capability truth
`docs/multi-channel-connector-roadmap.md` §4.1 · per-capability evidence:
`sellerops_cafe24_c2_order_summary_live_verification.md`,
`sellerops_cafe24_review_read_live_verification.md`,
`sellerops_cafe24_inquiry_read_live_proof.md`,
`sellerops_cafe24_first_connection_tutorial_live_proof.md`,
`sellerops_cafe24_review_acquisition_completion_live_proof.md`,
`sellerops_cafe24_review_issue_memory_bridge_downstream_proof.md`.
