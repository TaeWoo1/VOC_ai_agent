# Slice index

> **What this is.** One line per slice contract under `docs/slices/`. A slice document is the drift guard
> for one unit of work: what was in scope, what was deliberately not, and the UX decision behind it.
> They are **not** capability truth (`docs/multi-channel-connector-roadmap.md` §4.1) and **not** IA
> (`docs/product_assembly_ia_v1.md`); on conflict those win — a slice is priority 6 in `CLAUDE.md`.

> **Why this index exists.** R5 found slice contracts that nothing in the repository linked to. An
> unreferenced document is one nobody can find and everybody re-derives; the same failure mode cost us a
> live-proven capability (`docs/channel_integration_completeness_audit_v1.md` §5).

| Slice | What it contracts | Status as written |
|---|---|---|
| [`action-window-v1.md`](action-window-v1.md) | Slice Contract — Action Window V1 (기본 production 리뷰 수집 모드) | DRAFT — 제품 오너 리뷰 대기(2026-07-08) |
| [`attention-coverage-false-calm-v1.md`](attention-coverage-false-calm-v1.md) | Slice — Attention Coverage / False-Calm Guard v1 | IMPLEMENTED, offline |
| [`aw-carrier-discriminator-v1.md`](aw-carrier-discriminator-v1.md) | Slice — Action Window Carrier Discriminator v1 | IMPLEMENTED, offline |
| [`browser-projection-v0.md`](browser-projection-v0.md) | Slice Contract — Browser Projection V0 (Guided-Connection 인프라 G2) | IMPLEMENTED & COMMITTED (채널-중립 V0, `a0e4f6f`), 마켓 미승인·비-기본 렌더러, produc |
| [`carrier-refusal-diagnostics-v1.md`](carrier-refusal-diagnostics-v1.md) | Slice — Carrier Refusal Diagnostics v1 | IMPLEMENTED, offline |
| [`import-outcome-history-v1.md`](import-outcome-history-v1.md) | Slice — Import Outcome & History v1 | IMPLEMENTED, offline |
| [`llm-triage-classifier-v1.md`](llm-triage-classifier-v1.md) | LLM Triage Classifier v1 | design, then build |
| [`local-agent-bridge.md`](local-agent-bridge.md) | Slice Contract — Local Agent Bridge (Guided-Connection 인프라 G1) | APPROVED FOR IMPLEMENTATION — 2026-07-08 (제품 오너 결정 반영, §0) |
| [`my-reply-work-worklist-v1.md`](my-reply-work-worklist-v1.md) | Slice — 내 답변 작업 (My Reply Work) Worklist v1 | IMPLEMENTED, offline |
| [`naver-element-calibration-snippet.md`](naver-element-calibration-snippet.md) | NAVER Element-Anchor Calibration — value-scoped DevTools snippet | — |
| [`naver-guided-connection.md`](naver-guided-connection.md) | Slice Contract — NAVER Guided Connection (Guided-Connection G3) | RATIFIED (v1, 2026-07-19) — 오프라인 구현 착수: G3-A + G3-B |
| [`naver-per-order-acquisition-foundation-v1.md`](naver-per-order-acquisition-foundation-v1.md) | NAVER Per-Order Acquisition Foundation v1 | Offline-complete |
| [`operations-review-worklist-v1.md`](operations-review-worklist-v1.md) | Slice — Operations Review Worklist v1 | IMPLEMENTED, offline |
| [`product-context-diagnosis-groundwork.md`](product-context-diagnosis-groundwork.md) | Product Context Diagnosis — groundwork, not a build | investigation only |
| [`production-triage-feedback-draft-v1.md`](production-triage-feedback-draft-v1.md) | Production triage feedback — design draft | draft, nothing built |
| [`reply-frame-adapter-v1.md`](reply-frame-adapter-v1.md) | Slice — Reply Frame Adapter & Runtime Disposal v1 | IMPLEMENTED, offline |
| [`reply-handoff-honesty-v1.md`](reply-handoff-honesty-v1.md) | Slice — Reply Handoff Honesty v1 | IMPLEMENTED, offline |
| [`reply-report-safety-v1.md`](reply-report-safety-v1.md) | Slice — Reply Report Safety v1 | IMPLEMENTED, offline |
| [`reply-runtime-injection-v1.md`](reply-runtime-injection-v1.md) | Slice — Reply Runtime Injection v1 | IMPLEMENTED, offline |
| [`reply-work-dismissal-v1.md`](reply-work-dismissal-v1.md) | Slice — 작업에서 제외 (Reply-Work Dismissal) v1 | IMPLEMENTED, offline |
| [`reply-work-exit-clarity-v1.md`](reply-work-exit-clarity-v1.md) | Slice — 내 답변 작업 Exit Clarity v1 (frontend-only) | IMPLEMENTED, offline |
| [`reply-work-recovery-v1.md`](reply-work-recovery-v1.md) | Slice — Dismissed Reply-Work Recovery v1 (제외한 작업 + 복원) | IMPLEMENTED, offline |
| [`reported-replies-leave-the-queue-v1.md`](reported-replies-leave-the-queue-v1.md) | Slice — Reported Replies Leave the Queue v1 | IMPLEMENTED, offline |
| [`review-acquisition-spine-v1.md`](review-acquisition-spine-v1.md) | Slice — Review Acquisition Spine v1 | IMPLEMENTED, offline — |
| [`review-analysis-eval-reanalysis-foundation-v1.md`](review-analysis-eval-reanalysis-foundation-v1.md) | Slice — Review Analysis Evaluation & Reanalysis Foundation v1 | IMPLEMENTED, offline |
| [`review-classification-queue-v1.md`](review-classification-queue-v1.md) | Slice — Classification-Aware Review Queue v1 | IMPLEMENTED, offline |
| [`review-eval-corpus-lineage-v1.md`](review-eval-corpus-lineage-v1.md) | Corpus lineage — what is actually in the `review-eval/naver/v2` frame, and where review media goes | investigation only |
| [`review-reply-state-v1.md`](review-reply-state-v1.md) | Slice — Review Reply-State Preservation v1 | IMPLEMENTED, offline |
| [`review-response-completion-v1.md`](review-response-completion-v1.md) | Program Contract — Review Response Completion v1 (가이드형 NAVER Action Window 답변 제출) | IN PROGRESS, UNCOMMITTED, OFFLINE |
| [`review-response-preparation-v1.md`](review-response-preparation-v1.md) | Slice Contract — Review Response Preparation v1 (Attention 표면 · 백엔드) | BACKEND IMPLEMENTED & VERIFIED, UNCOMMITTED — FE 미착수 |
| [`review-triage-v1.md`](review-triage-v1.md) | Slice — Review Triage v1 | IMPLEMENTED, offline + local product proof |

Retired in R5: `product-shell.md` — it declared itself superseded by `docs/product_assembly_ia_v1.md`,
which owns the product shell IA.
