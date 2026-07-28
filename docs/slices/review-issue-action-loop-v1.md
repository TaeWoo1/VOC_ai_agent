# Slice Contract — Review Issue Triage → Guided Reply Action Loop v1

> Status: **OFFLINE IMPLEMENTATION in progress.** Connects the shipped **Review Issue Memory**
> (candidate signals + evidence reviews) to the shipped **reply preparation → approval → guided
> submission → operator-reported outcome** chain, as one operator flow that starts on
> `/issues`. Reuse-first: **no new work-item / OperationRun / workflow engine**, **no LLM**, **no
> marketplace write**. One narrow migration (V32, issue feedback for offline eval). Live NAVER
> Guided Reply proof is out of scope and gate-locked.
>
> Upstream contracts this obeys (does not re-decide): `docs/product-scope-v1.md` §1.6·§1.7·§5·§9
> (v1.6 lock), `docs/slices/review-response-preparation-v1.md`,
> `docs/slices/review-response-completion-v1.md`, `contracts/review-issue/v1/THRESHOLDS.md` (DRAFT),
> `contracts/action-window/v2/` (ratified; **untouched**), the honesty boundary in
> `docs/workstreams/review_operations_mvp.md`.

## Goal

From a **Review Issue candidate** the operator reviews the evidence, picks **one exact unanswered
review**, prepares and **approves** a reply draft, hands the approved draft + exact review identity
to the **existing** Guided Reply session, and the reported result flows back into review reply-state
and (best-effort) the Issue Memory — all without SellerOps ever posting, and without ever claiming a
reply is verified/complete on a channel that offers no read-back.

## What already exists (reused verbatim — NOT rebuilt)

- **Issue candidates + evidence**: `com.sellerops.reviewissue.*` (V31) — `review_issues`,
  `review_issue_evidence` (opinion-unit grain), `review_issue_unknown_units`; DRAFT thresholds
  carried as `extractorKind`/`extractorVersion` provenance; masked evidence quotes
  (`ReviewIssueQueryService.detail`).
- **Draft → approval**: `review_reply_draft` (versioned, append-only) + `review_reply_approval`
  (`APPROVED`⇄`WITHDRAWN`) + `review_reply_approval_audit`; rule-based provider (`ai` reserved,
  **boot-fails** — no LLM); server-computed capabilities; approval **freezes** the head version.
- **Guided submission + outcome**: single-use `submissionRef` bound to the approved head
  (`ReviewReplyService.startSubmissionRun`), the `collector/.../reply-submission/` session
  (observe-only, source-guarded, composer-time **identity** re-check), `review_reply_outcome`
  (operatorOutcome + `verification`, single-use binding, `(org,commandId)` idempotency).
- **Consistency guards** (all pre-existing 409s): channel-answered at start; single-use binding;
  command-id idempotency; binding-drift. Answered-review exclusion from the needs-a-look bands and
  the to-do (`ReviewRepository`).
- **After-ingest refresh seam**: `ReviewIssueRefreshService.refresh(orgId, referenceDate, max)`,
  invoked best-effort by `ReviewIssueImportRefreshListener` (AFTER_COMMIT, REQUIRES_NEW).

## The 8-state machine — a projection, not a new table

The requested minimum states are a **pure projection** over existing durable rows (triage
disposition · draft head · approval · channel `reply_state` · outcome), computed server-side and
exposed as `ReviewReplyPrepView.actionLoopState` so the FE renders it rather than re-deriving it:

| State | Derivation |
|---|---|
| `REVIEW_REQUIRED` | disposition `RESPONSE_NEEDED`, no saved draft yet |
| `DRAFT` | `RESPONSE_NEEDED`, a draft head exists, not approved |
| `APPROVED` | approval `APPROVED`, no outcome recorded, channel not answered |
| `GUIDED_SESSION_STARTED` | (transient/client) a `submissionRef` minted, no outcome yet — recovered after restart by re-deriving from the durable `APPROVED` + absence of outcome |
| `SUBMITTED_VERIFIED` | outcome `verification == VERIFIED` — **reserved, structurally unreachable for NAVER** (no read-back oracle; `VERIFICATION_STATES = ["UNVERIFIED"]`). The **only** state that is "완료". |
| `UNVERIFIED` | outcome `operatorOutcome == OPERATOR_REPORTED_SUBMITTED`, `verification == UNVERIFIED` — NAVER's real terminal. Leaves the queue + triggers a best-effort Issue-Memory refresh, **never** shown as 완료 (badge 답변함으로 기록·확인 안 함). |
| `ABORTED` | outcome `operatorOutcome == SUBMISSION_ABORTED` — no reply-state change, no refresh. |
| `STALE` | approval `APPROVED` **and** the review is now channel-`ANSWERED` — the approved reply is stale; the guided run is withheld (the existing start-run 409). A minted ref whose binding drifted is the existing binding-drift 409. |

**Honesty fence (product-owner confirmed this session).** `SUBMITTED_VERIFIED` is defined but
unreachable for NAVER; the live guided reply terminal is `UNVERIFIED`. A reported (UNVERIFIED) reply
DOES update reply-state, leave the queue, and attempt the Issue-Memory refresh — consistent with the
shipped `reported-replies-leave-the-queue-v1` behavior — but is NEVER labelled 완료/발송/전송/등록.
`STALE` is impossible to reach by "draft body changed after approval" because approval freezes the
head; the only post-approval invalidation is channel-answered (or the already-guarded binding drift).

## What this slice ADDS (minimal)

1. **Issue → review bridge** — `GET /api/review-issues/{issueId}/reply-candidates`
   (`ReviewIssueReplyCandidatesView`). For each evidence review (deduped): `actionRef`
   (`VocItemRef.forReview`), rating, KST review date, product display name, masked quote,
   `channelReplyState`, `reportedSubmitted`, `selectable` (= not channel-answered AND not
   reported-submitted), and the resolved `accountId` — org+channel-scoped
   (`SellerAccountRepository.findByOrgIdAndChannelId`), `accountAmbiguous=true` and no accountId when
   `countByOrgIdAndChannelId > 1` (**fail closed**, never auto-pick). Issues are org-global; this is
   the only place the org-global issue view meets the account-scoped reply stack.
2. **`actionLoopState`** on `ReviewReplyPrepView` (server-computed projection above), so STALE/answered
   is first-class and the FE can refuse execution honestly.
3. **After-reply Issue-Memory refresh** — a dependency-inverted `IssueMemoryRefreshPort` (declared in
   the reply package, implemented in `reviewissue`) invoked by `ReviewReplyService` **after** a
   reported-submitted outcome commits, in its own transaction, failure caught → returns a boolean.
   `ReviewReplyOutcomeResponse.issueMemoryRefreshed` surfaces it so the UI shows "분석 갱신됨" vs
   "분석은 아직 갱신되지 않았습니다" and never misreads a stale view as "변화 없음". ABORTED does not
   refresh.
4. **Issue feedback (offline eval)** — `POST /api/review-issues/{issueId}/feedback`
   `{commandId, kind ∈ USEFUL|NOT_RELEVANT|LATER}` → append-only `review_issue_feedback` (V32),
   idempotent on `(org_id, command_id)`. **No effect** on lifecycle, queue, or judgement — it is
   offline evaluation data only (같은 이유로 `review-eval` seed와 병렬).

### Why V32 is necessary (migration justification, per the standing rule)

Issue-level operator feedback (유용함/관련없음/나중에) has **no home** in existing models: draft /
approval / outcome are *reply*-scoped (keyed by review, not issue); issue lifecycle events
(`review_issue_state_events`) record **system/operator lifecycle transitions** (OBSERVING→NEEDS_REVIEW
etc.) with a closed reason vocabulary, not free operator eval sentiment, and overloading them would
corrupt the lifecycle audit. A narrow append-only table is the minimal representable addition and
carries no customer text, id, or body — only `(org, issue, kind, actor, command)`.

## Explicit exclusions (non-goals)

- No marketplace write/post/submit; no auto-draft, auto-approve, auto-submit; no LLM.
- No live NAVER, no connector flag, no IP-dependent API test, no Windows install, no other channel.
- No change to `contracts/action-window/v2/`, the guided reply collector engine/driver, the reply
  runtime, or the ratified reply honesty terminal. No new dashboard; the entry lives on `/issues`.
- No new state column/table for the 8-state machine (it is a projection). No new generic work-item /
  OperationRun / workflow engine.
- No change to issue thresholds, lifecycle transitions, the needs-a-look queue definition, or
  attention counts/severity/ranking.
- No PR #369 / PR #370 dependency, edit, or merge.

## Offline E2E (13 scenarios)

1 ingest → issue memory · 2 issue evidence surfaced · 3 answered review excluded from candidates ·
4 review select → draft → approve · 5 guided synthetic session start (mint) · 6 reported (UNVERIFIED)
→ reply-state exclusion + issue refresh fires · 7 ABORTED → no state change, no refresh · 8 UNVERIFIED
never recorded as 완료 (verification stays UNVERIFIED; SUBMITTED_VERIFIED unreachable) · 9 answered
after approval → STALE + start-run 409 · 10 concurrent approve / concurrent submit → exactly one ·
11 issue-refresh failure → outcome preserved + `issueMemoryRefreshed=false` · 12 org/account/review
identity mixing refused · 13 restart → approval + derived state recovered, re-mint allowed.

## Independent review (required)

Evidence never mixes another account's reviews · approved draft cannot be tampered after approval
(freeze) · Guided Reply receives the exact review + approved draft · reply success never overstated
(UNVERIFIED ≠ 완료) · existing duplicate-reply defenses not bypassed · DRAFT thresholds never
presented as a confirmed problem.

## Verification (offline)

```bash
cd backend && ./gradlew test
cd frontend && npm ci && npm run typecheck && npm test && npm run build
cd collector && npm ci && npm run typecheck && npm test    # reply/session suites stay green (unchanged)
npx tsc -p contracts/tsconfig.json
git diff --check
```
