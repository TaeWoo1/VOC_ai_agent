# Slice — Reported Replies Leave the Queue v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` are untouched. **No migration** — the tables already carried
> everything the rule needs. Collector untouched.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACT → PRIORITIZE (the loop closing on itself)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why — the loop never closed

Continuing the journey audit past the navigation fix
(`docs/slices/operations-review-worklist-v1.md`), the next break was the closing step: **ACT
happened, and the queue did not notice.**

The queue's exclusion is `reply_state <> ANSWERED`, and `reply_state` is written **only** by ingest
from the channel's `답글여부`. Recording a guided reply writes `review_reply_outcome` —
`operator_outcome = OPERATOR_REPORTED_SUBMITTED`, `verification = UNVERIFIED`, the Action Window
`aw_run_ref`, and a fingerprint of exactly what was approved — and **never touched `reply_state`**.
`IngestedReviewVocItemSource` knew nothing about outcomes at all.

So a seller worked through ten reviews, posted each through the guided flow, recorded
"제출했다고 기록" — and the headline still read **10건**, with the same ten rows still on top. It
cleared only at the next export, a manual Action Window run they had to perform themselves.

⚠ **This is not the caveat already in the workstream.** That one is about a reply posted *on the
channel*, outside SellerOps — genuinely unknowable until the next import. This was different:
**SellerOps guided the reply itself**, held a fingerprinted, run-referenced record, and ignored it.

The detail level was already honest — `ReviewReplyPrepView.outcome` (v1.6) survives a reload, so the
panel said 답변함으로 기록. The break was that the record stopped at the panel: the seller was told in
one place that the work was done and in another that it still needed doing.

## 2. The rule

**A SUBMITTED outcome exists for the review's CURRENT approved version.**

- **Version-scoped**, because outcomes carry `recorded_version` precisely to describe one approved
  version rather than a review. An operator who edits and re-approves after posting has text that was
  never posted, and the review returns to the count on its own.
- **Existence, not recency** — a deliberate divergence from the panel's
  `findTopBy…OrderByCreatedAtDesc`. That read describes *where the current attempt stands*; the queue
  asks *whether a post was ever reported for the reply that stands*, and a later abort does not
  un-post an earlier reported post.
- **`SUBMISSION_ABORTED` never qualifies.** It means "I did not post it" — a normal ending — and such
  a review stays fully in the queue, counted and unmarked.
- **Requires a standing APPROVAL.** An outcome with no approved version describes a reply that is not
  the one on the record.

Stated once as `ReviewRepository.REPORTED_SUBMISSION_PREDICATE` and shared by the count and the
ordering; `ReviewReplyOutcomeRepository.findReviewIdsWithReportedSubmission` is the same rule where
the per-page marker is resolved. A test asserts all three agree on one seed.

## 3. What the seller sees

| | behaviour |
|---|---|
| **count** | excluded — "현재 확인이 필요한 리뷰 N건" shrinks as work is reported |
| **list** | **still listed** — the report is UNVERIFIED, so a mistaken one must stay visible and correctable |
| **order** | **sunk below every actionable row**, worst-first preserved within each group |
| **badge** | 답변함으로 기록 · 확인 안 함 |

⚠ **Count and list now differ by design**, which this codebase normally treats as a defect. It is
survivable only because there was already precedent and a place to say so: the two low/mid-rating
cards share a type and drill to a union larger than either, and `AttentionSignalDrilldown` already
carried the sentence explaining it. That sentence now covers the reported case too.

**The badge is outlined where the channel's chips are filled.** A first draft used the same
`bg-good/10 text-good` as the channel's 답변 완료 chip — and a test written to assert they were
distinguishable caught it. An unverified self-report has not earned the weight of the marketplace's
own statement, so it sits near that green without wearing it, and the copy says 기록 and 확인 안 함,
never 완료.

## 4. Verification

| | before | after |
|---|---|---|
| backend | 1490 (2 skipped) | **1500** (2 skipped) |
| frontend | 733 | **739** |
| collector | 4843 / 95 skipped | unchanged, untouched |

Both typechecks clean.

**Every rule falsified, each caught:**

| revert | test that failed |
|---|---|
| count no longer excludes | `aReportedReplyLeavesTheCOUNT_butStaysInTheLIST_marked` + 1 |
| reported rows no longer sink | `reportedRowsSINK_belowEveryRowThatStillNeedsDoing` + 2 |
| marker ignores the outcome kind | `anABORTED_reportChangesNothing` |
| marker ignores the approved version | `aReportAgainstAnOLD_versionDoesNotCoverAReApprovedReply` |
| marker unscoped by org | `anotherOrgsReportNeverCoversThisOrgsReview` + 3 |
| badge claims 답변 완료 | `says RECORDED and UNCONFIRMED` + 3 |

**Contract check passed:** `contracts/review-export/naver/v1/expected-rows.json` seeds no outcomes, so
its `expectedAttention` is byte-unchanged — had it moved, the predicate would be firing where it
should not.

Because `application-test.properties` disables Flyway and runs H2, the new JPQL — including the
`ReviewReplyOutcome`×`ReviewReplyApproval` correlated exists and the `CASE` in `ORDER BY` — was
**also run against a disposable PostgreSQL 15 database**, with the presence of `reviews`,
`review_reply_outcome` and `review_reply_approval` afterwards proving it had not silently fallen back
to H2. Database dropped; the dev DB was never touched.

**Index support verified rather than assumed.** The correlated exists hits
`idx_review_reply_outcome_review (review_id, created_at)` and
`uq_review_reply_approval_review (review_id)` — the latter unique, so the approval side is at most
1:1. Two index lookups per row, on tables that already had them: no new index, and none proposed
speculatively.

⚠ One implementation trap worth recording: **Java text blocks strip trailing spaces**, so
`"… and not " + PREDICATE` compiled to `and notexists` and Hibernate rejected it at context load. The
separator has to be a line terminator, not a space.

## 5. Recorded, not fixed

- A reply posted **on the channel**, outside SellerOps, stays invisible until the next import. This
  slice narrows the gap to replies SellerOps itself guided; it does not close it.
- **False calm on a multi-account channel** — unchanged and still invisible to the client.
- The reported rows still occupy the drill-down's pages, so a seller with a long completed backlog
  pages through their own finished work to reach the end of the list. A "hide reported" facet would
  fit the existing category-facet machinery if that becomes a real complaint.
- The high-rating complaint remains undetected; `rules-v2` is **not** started.
- **Run 7 stays deferred** until the approved network/IP environment returns. No gate consumed, no
  live contact.
