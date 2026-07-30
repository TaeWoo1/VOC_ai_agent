# SellerOps Agent Runtime — Operator Pilot v1

Status: **complete** (pilot run + blocker fixes + re-run + gates + independent review). Draft PR; **not merged**.
Date: 2026-07-30. Base: `main` @ `0cf4a8e` (after #380). Branch: `feat/agent-runtime-operator-pilot-v1`.

## 1. Goal & non-goals

Exercise the three Agent Runtime intents (inquiry / review / issue) repeatedly against real product
boundaries to validate **product-fitness and operability** — not to add features. Fix only real
blockers found in-flight (phrasing / status display / error handling / intent routing / priority),
then re-run the identical scenarios.

Out of scope (and honored): no real LLM, no new subgraph, no channel API live calls, no external
reply send, no large UI redesign. No new NAVER/Cafe24/ESM channel calls were made.

## 2. Method & honest boundaries

- The pilot drove the **exact agent-runtime HTTP contract the frontend `/agent` page calls** —
  `POST /api/agent-runs` (startRun), `POST /api/agent-runs/{threadId}/resume`, `GET /api/agent-runs/{threadId}`,
  `GET /capabilities` — with the operator's real JWT, the same calls `frontend/src/lib/agentRuntime/agentClient.ts`
  issues. UX/phrasing was judged from the rendered copy in `frontend/src/pages/Agent.tsx`.
- **Boundary (stated plainly):** this was an HTTP-contract-driven operator session, not a human
  clicking a browser. Every request/response, latency, DB mutation, and log line is real; the
  browser rendering itself was read from the FE source, not screenshotted.
- **Disposable environment** (real dev DB `sellerops` untouched): a throwaway Postgres 15 cluster on
  a nonstandard port, DB `pilot_ops`; the real Spring backend booted against it with demo-content
  seeding; the Agent Runtime booted in **production + spring** run-store mode (durable,
  multiInstanceSafe, `backendReachable=true`). Torn down after the run.

## 3. Data

Baseline demo content is from `MockDataSeeder` (`sellerops.seed.demo-content=true`): 1 org, 13-channel
catalog, 2 seller accounts (Coupang CONNECTED, Naver CONNECTED), 6 products, 44 reviews, 16 inquiries
(6 UNANSWERED), 28 order-daily-summaries. The seeder alone leaves all three runtime read-paths EMPTY
(it writes inquiries/reviews directly, bypassing work-items / triage / issue extraction), so fixed
demo fixtures were added — as the pilot brief allows ("부족한 시나리오는 고정 demo fixture로 보완"):

| Domain | Fixture | Authentic vs fixture |
|---|---|---|
| Inquiry | 6 UNANSWERED inquiries attached to their channel account + one `OPEN` `inquiry_work_item` each (+ `WORK_ITEM_OPENED` audit), mirroring the atomic ingest writer | fixture (mirrors real writer shape) |
| Review | `review_triage RESPONSE_NEEDED` on all 22 NAVER reviews (reply-work is NAVER-only + requires a commitment) | fixture (commitment only; reviews are real seeded rows) |
| Issue | #1 접착 탈락 (NORMAL) from the **authentic** `POST /api/review-issues/extract` rule-based extractor; #2 파손 (HIGH, surging) + #3 색상 (LOW) inserted as labeled `PILOT_FIXTURE` issues for multi-issue prioritization | #1 authentic, #2/#3 fixture |

**Demo-data note (non-blocker):** the seeder's negative reviews are monotone (every negative review
shares one identical body), so the authentic extractor yields exactly ONE issue theme. The two
fixture issues exist only to make prioritization observable and are clearly labeled `PILOT_FIXTURE`.

## 4. Scenario results

All three scenarios were run pre-fix (discovery) and re-run post-fix on a pristine rebuild. Figures
below are the **post-fix pristine pass**.

### 4.1 Inquiry — "미답변 문의 처리해줘" — PASS
- reject×2 → `200 REJECTED`, phase stays `OPEN`, **no backend write** (item resurfaces), `externalSendAttempted=false`.
- approve×3 → `200 APPROVED`, phase `OPEN`→`ACTION_PENDING` (prepares a human action intent, not a send), `externalSendAttempted=false`.
- same-checkpoint **double-resume, sequential** → both `200 DONE`, outcome byte-identical (idempotent replay; deterministic commandId).
- same-checkpoint **double-resume, concurrent** → one `200`, one `409 RESUME_IN_PROGRESS` (exactly-once).
- **runtime restart during resume** → fresh process reconstructs the AWAITING checkpoint from the spring store (no `replyDraft` on reload — draft content is never persisted), resume→`DONE APPROVED`, trail `…→resumed_after_restart→recorded_approved`.
- **Exactly-once proof (DB):** 5 approve threads (3 + seq-winner + concurrent-winner) + 1 restart-thread → `APPROVAL_GRANTED` audit count matches the number of distinct approved threads; the concurrent loser and the sequential replay wrote nothing extra. Reviews/issues untouched. `inquiries.status` stays UNANSWERED (correct — nothing was posted to a channel).

### 4.2 Review — "답변 필요한 리뷰 준비해줘" — PASS (after fix R-1/R-2)
- reject×2 + approve×3 now select **5 DISTINCT reviews** (operator progresses through the worklist).
- draft version is **v1 on every run** ("동일 draft version 유지" — head-draft reuse, deterministic rule-based suggestion).
- approve → `200 APPROVED`, mints exactly one single-use guided-session ref (`submissionApprovedVersion=1`), `guidedSessionPrepared=true`, **`externalSendAttempted=false`**.
- **Stops at submission-run mint — no Action Window execution:** `review_reply_outcome` stayed empty and `reviews.reply_state` stayed `UNKNOWN` across the whole run.
- double-resume sequential → mint-once (2nd replays the same `submissionRef`); concurrent → one `200`, one `409 RESUME_IN_PROGRESS` (exactly-once).
- DB after: 5 approvals / 5 mints (one per distinct approved review) / **0 AW-execution outcomes**.

### 4.3 Issue memory — three goals — PASS
Goals: "최근 악화된 상품 문제 알려줘", "반복되는 고객 불만 보여줘", "지금 먼저 확인할 운영 이슈는 뭐야".
- **Intent routing:** all three route to the ISSUE domain.
- **Determinism:** with a fixed `referenceDate`, all three phrasings produce an IDENTICAL brief, and repeating a goal is byte-identical.
- **Mutation = 0:** issue-tables md5 fingerprint identical before/after (read-only path).
- **No raw-content leak:** distinctive review-body fragments appear in neither the brief nor the runtime logs; `safePreview`/`redactedBody` never logged.
- **Priority:** severity-first worst-first — HIGH 모서리 파손 > NORMAL 접착 탈락 > LOW 색상 불일치.

## 5. Measurements

| Metric | Inquiry | Review | Issue |
|---|---|---|---|
| request→first result (start→checkpoint / →brief) | 27–146ms | 40–109ms | 55–108ms (brief, no checkpoint) |
| approve/reject completion (resume) | 29–146ms | 19–109ms | n/a (no checkpoint) |
| success / retry | all decisions succeeded; retries only where intended (double-resume) | 5/5 distinct approvable reviews after fix | 6/6 runs identical |
| raw content exposure | none (draft len only; no title/body; no draft on reload) | none (metadata + fingerprint only; bodies transient) | none (closed-vocabulary brief) |
| backend mutation scope | inquiry work-item + audit only | review approval + draft + submission-ref only | **zero** |
| external send | 0 | 0 (and no AW execution) | 0 |

The 146ms figures are first-call cold starts (JIT + connection warm-up); warm calls sit ~20–70ms.

## 6. Blockers vs non-blockers

### Blockers (fixed)
- **R-1 — review sticky re-selection + opaque 409 (operability + error handling).** [primary] After a review
  reply is approved+minted it stays #1 in reply-work (it only leaves on the human POST, out of pilot
  scope), and the runtime's prioritizer returned `ranked[0]` ignoring `hasReplyPreparation`. So every
  later run re-selected the same already-approved review, the other committed reviews were
  unreachable, and re-approval returned a backend `409` shown to the operator as a bare
  "요청이 거부되었습니다 (409)". **Fix (agent-runtime, priority/selection):** `selectTopReview` now
  returns the oldest review with `hasReplyPreparation === false`; when every worklist row is already
  prepared it returns null and the prioritize node emits an honest "all prepared — post in 리뷰 운영"
  status. Because approval ⟹ `hasReplyPreparation=true`, this also covers human-approved reviews and
  eliminates every approve-path 409.
- **R-2 — conflict codes unexplained (error UX).** The runtime's own meaningful `RESUME_IN_PROGRESS`
  (and `RESUME_CONFLICT`) 409s had no case in the FE `explain()` and fell to the bare "(409)".
  **Fix (FE copy):** `explain()` now maps `RESUME_IN_PROGRESS` / `RESUME_CONFLICT` / `HTTP_409` to
  clear, actionable Korean messages.
- **I-1 — internal enum in operator copy (phrasing).** The inquiry checkpoint card rendered the raw
  `(RULE_BASED)` provenance token after "규칙 기반 초안입니다". **Fix (FE copy):** removed the token.

### Non-blockers (recorded, no code change)
- **ISS-1 (demo data):** all issues showed the same `dominantProductName`. Verified to be a
  deterministic tiebreak over genuinely-tied evidence (a different product won after reseed), not a
  bug — an artifact of monotone demo data. Real concentrated data would differ.
- **ISS-2 (documented design):** the three semantically-different issue asks yield the same
  severity-first brief; for "최근 악화된 상품 문제" the #1 result is not the trend-"증가 중" issue
  (that ranks #2 under a HIGH-severity issue). Correct per the documented worst-first design; a
  phrasing-sensitive (trend-first) brief would be a future enhancement, not a pilot fix.
- **R-3 (WAI):** review draft-version stability holds by construction (head-draft reuse).
- **LOW-1 (intended behavior, from the review):** a review whose agent-prepared draft was rejected
  gains `hasReplyPreparation=true`, so the agent will not re-offer it. It remains fully reachable on
  the manual 리뷰 운영 surface, so no work is stranded — it is simply no longer agent-driven.
- **LOW-3 (accepted, from the review):** the inquiry checkpoint copy is now the fixed string
  "규칙 기반 초안입니다", decoupled from `provenance.providerKind`. Accurate under the standing
  no-LLM invariant (drafts are structurally rule-based); revisit if an AI drafter is ever wired in.

## 7. Fixes changed set

`agent-runtime/src/prioritize/prioritizeReviews.ts` (selectTopReview), `agent-runtime/src/graph/reviewGraph.ts`
(honest empty-vs-all-prepared note), `agent-runtime/test/prioritize/prioritizeReviews.test.ts` (+2
regression tests), `frontend/src/pages/Agent.tsx` (explain() conflict codes + inquiry copy + the
review NONE status line from LOW-2). **No backend, no contract, no migration change.** After the fixes, all three scenarios were re-run identically on a
pristine rebuild (§4) and pass.

## 8. Gates

- backend `./gradlew test` — **1803 passed / 0 failed / 6 skipped** (backend untouched; run for completeness).
- agent-runtime `tsc --noEmit` clean + **128 tests** passed (+2 new; 23 skipped are gated integration).
- frontend `tsc --noEmit` clean + **1121 tests** passed.

## 9. Independent review

Independent product + architecture review over the fix diff: **PASS — HIGH = 0, MEDIUM = 0**. Verified
`hasReplyPreparation` semantics (approval ⟹ true, so approved reviews are skipped), termination and
null-safety of the selector, the empty-vs-all-prepared note logic, the three new FE error codes are
real and token-free, privacy (no raw content/PII/tokens added), and scope (agent-runtime selector +
FE copy only; inquiry/issue untouched; tests pin both directions). Three LOW items surfaced:
- **LOW-2 (folded):** the runtime's honest all-prepared note was not reaching the operator — the FE
  `OutcomeCard` collapsed every review NONE outcome to "처리할 항목 없음". Folded a status-display fix:
  a review NONE outcome now reads "새로 준비할 리뷰가 없습니다" with a pointer to 리뷰 운영.
- **LOW-1 / LOW-3 (recorded as intended/accepted, no code):** see §6.

## 10. Limitations

HTTP-contract-driven session (not a literal browser click); demo fixtures supplement missing data (2
of 3 issues are labeled fixtures; the authentic extractor yields one theme on monotone demo data);
the human POST step (Action Window execution) is deliberately out of scope, so no review ever reached
`hasReportedSubmission`. A future pass with richer, varied real review corpora would exercise issue
prioritization and the post-verification loop more fully.
