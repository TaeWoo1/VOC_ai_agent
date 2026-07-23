# Slice — Review Reply-State Preservation v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` are untouched — this changes what an operator *sees*, not what
> a channel *supports*.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** NORMALIZE → UNDERSTAND/PRIORITIZE → ACT (bounded)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why

The NAVER review export states whether the seller already answered each review (`답글여부` Y/N,
`답글등록일시`). The pipeline dropped both, structurally, at four layers: no alias in
`ReviewRowMapper`, no field on `CanonicalReview`, no column on `reviews`, and
`IngestedReviewVocItemSource` hardcoding `replyStatus: null` under a comment that read *"an export
carries no reply state"* — false for NAVER, and repeated verbatim in the frontend.

Measured on a real export (3,851 rows): **26 of the 79 low-rating reviews — 33% — were already
answered.** Two consequences, one of them outward-facing:

1. the operator's "확인이 필요한 리뷰" queue was inflated by a third;
2. the guided-reply flow could walk a seller to the reply box for a review they had already answered
   — a **duplicate public reply**, irreversible, on the wedge's core workflow.

## 2. What was built

**Carry it.** `V21__review_reply_state.sql` adds `reply_state varchar(16) not null default 'UNKNOWN'`
and `replied_at timestamptz` (additive, `IF NOT EXISTS`). `ReviewReplyState` (`PENDING · ANSWERED ·
UNKNOWN`) normalizes NAVER's `Y`/`N`; **anything unrecognized is UNKNOWN, never guessed as answered**,
and UNKNOWN still counts as needing a look — so no historical row silently drops out of a queue on the
day this ships. The names are a deliberate subset of `CommunityReplyStatus` so both sources land on the
same operator chip, pinned by test. `CanonicalReview` gains the two fields with a 7-arg convenience
constructor, so the 2 production and 17 test call sites that predate this slice are untouched.

**Keep it current.** Dedup *skips* duplicates, and the second export is exactly where reply state
changes — so `IngestionService` refreshes on a duplicate. Field-scoped: only `reply_state`/`replied_at`
are ever written; body, rating, date, product, external id and hashes are never touched, and the row
still counts as `skipped` (no contract or count change). **Monotonic**: an import may report a review
as answered, or resolve an unknown into pending; it may **never** un-answer one. A stale re-upload —
last month's export imported after this month's — would otherwise re-inflate the queue and re-arm
duplicate replies; the opposite failure (a deleted channel reply staying marked answered) costs one
missed prompt that remains visible. The rule holds **within** a file too: an export listing the same
`리뷰글번호` twice, `N` then `Y`, still lands ANSWERED.

**Stop inflating the queue.** The low-rating count *and* its drill-down exclude ANSWERED — one
predicate, stated once (`excludesAnswered`), so the "N건" card and its rows cannot disagree. Arrivals
(`NEW_REVIEW`, the spike baseline) keep counting every review: they report what came in, not what needs
doing. The DTO's `replyStatus` is populated, so the existing 답변 완료 / 미답변 / 상태 미상 chips light
up with no frontend change.

**No duplicate replies.** `canStartSubmissionRun` goes false for an ANSWERED review and
`startSubmissionRun` **409s server-side** — the capability object renders affordances, it does not
authorize. Saving, approving, withdrawing and copying stay open: the harm prevented is specifically the
guided double-post, not the operator's own record. `ReviewReplyPrepView.channelReplyState` (a closed
enum name; no reply text, no timestamp) lets the panel say *why*.

## 3. `관련리뷰상세내용` — assessed, and deliberately still dropped

On the real export it appears on 1,272 rows, all `한달사용` follow-ups. Where the link resolves in-file
(1,157 of 1,272), the related body's SHA-256 **equals the linked row's own body in 1,157/1,157 cases**
— a denormalized copy of a review that is itself ingested. The remaining 115 point outside the exported
range, where the original is not ingested either. **No distinct customer feedback is lost**, so no
schema change is warranted. `ReviewAcquisitionSpineTest` pins the consequence instead: the follow-up
row ingests as its own single review, and the copied parent body mints no second one.

`관련리뷰글번호` + `리뷰구분` carry follow-up *linkage* worth revisiting later — nothing is lost today.

## 4. What this does NOT establish

- **Nothing about NAVER.** No live run; every fixture is synthetic.
- **Not a claim that the queue is now correct** — it is correct *about what the export said at the last
  import*. A reply posted after the last import is invisible until the next one, by construction.
- **Not verification of a SellerOps-guided reply.** `reply_state` mirrors the channel; a guided reply
  stays `OPERATOR_REPORTED_SUBMITTED` + `UNVERIFIED`, because a public reply has no read-back oracle.
- **ESM+ is untouched.** Its export carries a `답변 상태` column, but the observed file was header-only,
  so its token vocabulary is unknown and **no alias was added** — a channel-support decision belongs in
  the capability table, not an alias list.

## 5. Independent review — what it caught

An adversarial review pass ran before commit and found real defects, all fixed:

| Finding | Fix |
|---|---|
| Frontend did not typecheck (`mocks.ts`, an a11y fixture missed the new required field) — vitest does not typecheck, so the suite was green | fields added; `tsc --noEmit` now clean |
| Demo mode still offered the guided run for an answered review (mock capability rule had 3 inputs, server had 4) | mock computes the same four-input rule |
| A within-file duplicate could discard an ANSWERED statement (the in-batch guard returned before the refresh) | refresh runs for in-batch duplicates too; pinned both directions |
| This contract's SPEC still said the pipeline drops reply state | corrected, with the mapped-header count |
| ESM+ aliases contradicted their own "not guessed" comment | aliases and unobserved Korean tokens removed |
| `replied_at` could become permanently unlearnable if the date arrived after the state | the date is filled whenever it is still missing |
| Ingest tests were vacuous — `@DataJpaTest`'s shared persistence context meant deleting the `save` would still pass | `flush()` + `clear()` before every read-back |
| `NEW_REVIEW`'s *list* was never drilled, so a leak of the exclusion into arrivals had no failing test | arrivals list asserted |

**Falsified before trusting:** making the refresh last-write-wins fails the two monotonic tests;
removing the exclusion from the drill-down alone fails four tests across two suites.

## 6. Tests

| Suite | Adds |
|---|---|
| `ReviewReplyStateTest` | vocabulary + the monotonic rule + the Cafe24-subset drift guard |
| `ReviewReplyStateIngestTest` | first import, refresh, stale re-upload, in-file duplicates both ways, late-arriving date, field-scope |
| `IngestedReviewReplyStateExclusionTest` | count *and* list for both bands, arrivals kept whole, UNKNOWN still counted |
| `ReviewReplyServiceTest` | 409 + capability withheld + UNKNOWN never blocks |
| `ReviewAcquisitionSpineTest` | reply state per row from the golden export; the follow-up-row lock |
| Frontend | the notice, its absence on UNKNOWN, and the contract's new number |

Backend **1418** (was 1370) · collector **4843/95** (unchanged) · frontend **668** (was 666) ·
all typechecks clean.

## 7. Open

- **The contract's declared numbers changed** — the golden export's 2★ row is answered, so
  `LOW_RATING_REVIEW HIGH` is 1 and `reviewsNeedingAttention` is 2. One edit to `expected-rows.json`,
  read by all three ports.
- **A decision record is owed** for the monotonic rule — it encodes a product judgement (a stale
  re-upload must never un-answer) that a future reader would otherwise re-litigate. Draft held for
  product-owner wording, as with D-037.
- **No live evidence.** Everything here rests on synthetic fixtures plus one measurement of a real
  export read offline. A bounded human-in-the-loop NAVER proof is the next step.
