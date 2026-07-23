# Slice — Review Analysis Evaluation & Reanalysis Foundation v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` are untouched. **No detector was built**, and no re-analysis
> has been run against real data.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** UNDERSTAND / PRIORITIZE (the machinery, not the judgement)
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why this is not `rules-v2`

`docs/slices/review-classification-queue-v1.md` recorded the next step as a polarity-aware
`rules-v2`: a 5★ review reading "배송이 너무 늦었어요" is invisible, because the analyzer's `sentiment`
and `urgency` are pure functions of `rating`.

**That step is blocked by evidence.** `aiagent/docs/phase2e_detector_design.md` (2026-04-27) measured
a flat-substring Korean polarity detector against 30 human-annotated samples:

> Sample recall **0/30**, attribute capture **0/121**, 12 of 12 attributes never captured.

The diagnosis is architectural — surface-form rigidity, not vocabulary breadth (`발색이 별로` never
matches `발색도 약하구요`) — and it warns the 0-false-positive result held *only* because the
vocabulary was too narrow to match anything, so naive expansion inverts the failure.
`RuleBasedInboxItemAnalyzer` is exactly that architecture: `body.contains(kw)` over flat lists.

⚠ **The transfer is bounded.** That corpus is cosmetics, 12 attributes × 6 polarities — harder than
"is this review complaining?" — and a different product. The *architecture* finding transfers; the
specific 0% does not. The conclusion is not "a detector is impossible" but **"we cannot tell whether
one works"**, and that is the blocker this slice removes.

## 2. What was built

**A versioned re-analysis path.** Every write path was skip-if-exists —
`analyzeForSources`, and `backfillMissing` which fills only *missing* rows — so a new analyzer would
have applied only to items imported after it shipped, leaving an org's corpus split across versions
with no way to converge. Now: `InboxItemAnalyzer.version()` (askable without analyzing anything),
a bounded org-scoped selection of rows at any *other* version, and
`reanalyzeOutdated` / `previewReanalysis` behind `POST /api/item-analysis/reanalyze`.

Org-scoped on **both** sides — the analysis row's org and the loaded source's org — because
`item_analyses.source_id` is a bare polymorphic reference with no FK, so one check is not enough.
Bounded by the existing `MAX_BACKFILL_LIMIT`, resumable via `remaining`, and idempotent. Rows that
can never be recomputed are excluded from both the selection and `remaining` and reported separately
as `unrecomputable` — see §6, where that turned out to be a blocker rather than a nicety. The loop
still tolerates a row it cannot recompute mid-batch rather than throwing, so one bad row can never
strand the rest at a stale version.

**Selection is `<>`, not "older than".** Versions are opaque strings. An ordering comparison would
make rolling back to a prior analyzer a silent no-op — the corpus would stay stuck on the version
being rolled back *from*, which is the one case where being stuck is most damaging.

**An evaluation seed and harness**, with the go/no-go bars committed in
`contracts/review-eval/naver/v1/RUBRIC.md` **before any candidate detector exists** — a threshold
agreed after seeing a result is not a threshold.

## 3. The three things that were easy to get wrong

**A dry run is not the default behaviour of a JPA read.** A loaded `ItemAnalysis` is a *managed*
entity: touching a setter marks it dirty and Hibernate flushes at commit, so "compute but don't
save" would have persisted everything. The dry-run path therefore never touches a setter — it diffs
`Result` against the row's getters — and `previewReanalysis` is a separate `readOnly` entry point
rather than a boolean, because Spring's proxying means an annotation on a privately-invoked helper
is silently ignored.

⚠ **And the second guard is not tested, which is worth stating rather than implying.** Falsification
showed removing `readOnly` alone breaks **no** test, and removing the setter guard breaks
`aDryRunWritesNothing` *even while `readOnly` is still declared* — because the test constructs the
service directly, so no proxy exists and `@Transactional` has no effect there at all. **The
no-setters rule is what is proven.** `readOnly` protects the deployed path only, and only if the
first guard regresses. The javadoc says exactly this.

**An unchanged verdict must still be stamped current.** A row that recomputes to precisely what is
stored still needs writing, because the version stamp is what makes it current — leaving it stale
keeps it selected forever, so a resumable batch reports progress on every call and finishes on none.

**Precision must be gated on an interval, not a point estimate.** At 20/20 the normal approximation
reports ±0 and would clear an 0.80 bar outright. The rubric gates on the **Wilson 95% lower bound**,
which is sane exactly where a detector under evaluation sits.

## 4. Rollback — why there is no snapshot table

`InboxItemAnalyzer` implementations are pure, and a **review's** analyzed inputs (`body`, `rating`,
`negative`) are immutable after ingest — dedup skips a re-import and `refreshReplyState` touches only
reply fields. A review verdict is therefore not stored history but a **reproducible function** of
(row, analyzer version): running the prior analyzer reproduces it exactly. A snapshot table would
store what can be recomputed and add a second thing to keep consistent.

⚠ **It is not a restore for inquiries, and the first draft of this slice claimed it was.**
`Inquiry.status` IS mutated after ingest — `EsmInquiryReconciler.reconcileAnswered` flips it to
`ANSWERED` — and the analyzer's inquiry branch reads it for both `urgency` and `recommendedAction`.
Re-running a prior analyzer over an inquiry answered since yields that analyzer's verdict on
*today's* inputs, which may differ from what was stored. That is the more useful outcome — the
stored verdict described a state that no longer holds — but it is a **recompute, not a restore**, and
saying otherwise would have promised a guarantee the data cannot keep.

⚠ **One prerequisite, recorded for whoever writes the next analyzer:** add it *alongside*
`RuleBasedInboxItemAnalyzer`, never by mutating it in place. Mutating turns rollback from a
configuration change into git archaeology. Not enforceable today (there is one analyzer); recorded
where the next author will read it.

**And it is a rollback of derived data only.** `item_analyses` holds no operator work — triage lives
in `review_triage`, replies in `review_reply_*`, and nothing FKs to `item_analyses.id`. That is
asserted, not assumed: `reanalysisNeverTouchesOperatorWork` recomputes an analysis and checks a
recorded triage decision survives byte-for-byte.

## 5. What the seed may contain

`labels.json` carries **only** a review-id fingerprint and a label — not the body, the raw
`리뷰글번호`, the rating, the date, the product, or any seller identity. The rating is excluded even
though the metrics need it, because the harness reads it from the local join at evaluation time.

⚠ **The fingerprint is leak-hygiene, not anonymity**, and `ReviewIdFingerprint`'s own javadoc says
so: a `리뷰글번호` is 10 digits — an enumerable space. That is acceptable because a label is an
operator judgment rather than customer content, and it is precisely why nothing else may sit
beside it.

**The file ships empty.** No labeling session has been run, and an empty seed is the honest state.
`EvalMetrics` refuses a verdict below the adequacy floor (≥ 200 labeled, ≥ 40 `NEEDS_LOOK`), so a
thin seed reports "cannot decide" rather than a number someone could quote.

## 6. What the independent review caught

**One blocker, and it was the operational instruction itself.** `remaining` counted every outdated
row, including ones that can never be recomputed — an analysis whose source review was deleted, or
which points at another org's row. So the documented procedure, *"re-call until `remaining == 0`"*,
**would never terminate** in the presence of a single orphan.

The sharper half surfaced on inspection rather than in a test: because such rows were also
*selectable* and the selection is ordered by `createdAt`, a handful of them sorting first would fill
every bounded batch forever while the recomputable rows were never reached — a loop that reports
progress on every call and finishes on none.

Fixed by excluding unrecomputable rows from **both** the selection and the termination count, via one
shared `RECOMPUTABLE_PREDICATE` so the two cannot disagree about what they mean. They are not
silently dropped: `ReanalysisResult.unrecomputable` reports them, because a corpus that is fully
re-analyzed *except* for a quiet permanent residue should be visible rather than inferred from a
number that stops moving. Deleting them is a separate question this slice does not answer.

Both halves falsified: restoring the count breaks three tests; restoring selectability breaks
`orphansCannotStarveRealWorkOutOfASmallBatch`.

**A second review pass found two more, both in areas the reviewer was asked to probe.**

*The happy-customer gate was vacuous.* `highRatingFalsePositiveRate` is `0/0 → 0.00` when a seed
contains no 4–5★ `NO_ACTION` reviews, so a detector cleared "we do not flag happy customers" on a
sample containing none — the one gate protecting the case a labeler is least likely to over-sample.
The adequacy floor now requires **≥ 30** such rows and refuses a verdict below it, consistent with
the rest of the design: refuse rather than pass vacuously.

*The rollback guarantee was overstated for inquiries* — see §4. Corrected in the javadoc, here, and
in D-038 rather than quietly narrowed.

*Also corrected:* `ReanalysisResult.skipped`'s javadoc still described orphans, which the
convergence fix had already removed from the selection.

## 7. Verification

| | before | after |
|---|---|---|
| backend | 1458 (1 skipped) | **1490** (2 skipped — the new gated IT) |
| frontend | 710 | unchanged, untouched |
| collector | 4843 / 95 skipped | unchanged, untouched |

**Every new rule falsified, each caught:**

| revert | test that failed |
|---|---|
| dry run touches a setter | `aDryRunWritesNothing` |
| source-side org check removed | `aCrossOrgSourceIsSkippedRatherThanRecomputed` |
| unchanged rows never stamped | `aRowWhoseVerdictIsUnchangedIsStillStampedCurrent` |
| `applyResult` drops a field | `aDryRunWritesNothing` + 3 others |
| `readOnly` removed | **nothing** — recorded above as an untested guard, not claimed as proven |
| orphans counted as pending work | `anOrphanedAnalysisIsSkippedNotThrown` + 2 others |
| orphans selectable again | `orphansCannotStarveRealWorkOutOfASmallBatch` |
| high-rating adequacy floor removed | `aSeedWithNoHappyCustomersCannotClearTheHappyCustomerGate` + 1 |

The re-analysis suite was **also run against a disposable PostgreSQL 15 database** (never the dev
DB), since `application-test.properties` disables Flyway and runs H2 — with the tables' existence
afterwards proving it had not silently fallen back. Database dropped after.

**No migration.** In-place update is why: `uq_item_analyses_source` already permits one row per
source. If the `analyzer_version` scan proves slow at real volume, the index goes in *then, with a
measurement* — not speculatively onto a table V23 just indexed.

## 8. Explicitly not done

- **No `rules-v2`**, no polarity lexicon, no clause-splitting. Building one before the harness exists
  is how the 0%-recall detector got built the first time.
- **No LLM adapter.** It would ship customer-authored bodies to an external provider — the first
  crossing of the "sanitized output only" fence, and `VocPreviewSanitizer` exists because those
  bodies carry PII. A product-owner privacy decision.
- **No re-analysis run against real data.** The endpoint exists and defaults to `dryRun=true`, so the
  call an operator gets by forgetting the parameter is the harmless one.
- **No labeling session.** Separate, gated, over real data, read-only.
- **No new attention signal, no change to the queue's membership rule.** `[ ] Reviews classified`
  stays unchecked.
- No gate consumed, no live contact. **Run 7 stays deferred.**
