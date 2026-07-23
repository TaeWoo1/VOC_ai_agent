# Slice — Classification-Aware Review Queue v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.** §4.1 and
> `docs/channel_capability_ledger.md` are untouched — this changes what an operator *sees* and in
> what *order*, not what a channel supports.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** UNDERSTAND / PRIORITIZE
- **Date:** 2026-07-23 · **Live contact:** none

---

## 1. Why

The review-ops queue and the Inbox each decided "what needs attention" independently, and they did
not touch. The queue's rule lives in `IngestedReviewVocItemSource.snapshot()`:

> `rating ∈ 1–3` **AND** `reply_state ≠ ANSWERED` **AND** `received_at ∈ window`

Meanwhile `RuleBasedInboxItemAnalyzer` has been writing `category`/`sentiment`/`urgency`/
`recommendedAction` into `item_analyses` for every newly-inserted review
(`FileUploadConnector.triggerAnalysis:170`) — and only the Inbox read it.

Within the queue, the rows were also **ordered by arrival date alone**, so a 3★ from this morning
outranked a 1★ from yesterday. An operator working top-down met their least urgent review first.

## 2. The finding that scoped this slice

Before joining the two, we checked what the stored analysis would actually contribute for a REVIEW:

```
negative  = rating <= 2                                    (IngestionService:122)
sentiment = negative||rating<=2 ? NEGATIVE : rating>=4 ? POSITIVE : NEUTRAL
urgency   = NEGATIVE ? HIGH : LOW
```

**`sentiment` and `urgency` are pure functions of `rating`.** Joining them into the queue would add
exactly zero information over the rating band already there. The only body-derived field is
**`category`**; `recommendedAction` is `f(rating, category)`.

So the case the workstream log implied — a 5★ review reading "배송이 너무 늦었어요" — **cannot be
detected by the stored analysis at all** (it comes out `category=배송, sentiment=POSITIVE,
urgency=LOW`). Requeueing on classification is not a join: it needs the analyzer to gain body
polarity, a `rules-v2`, and a re-analysis path that does not exist today (`analyzeForSources` is
skip-if-exists; `backfillMissing` only fills *missing* rows).

**This slice therefore does not redefine "needs a look".** N keeps its exact meaning and provenance,
and `contracts/review-export/naver/v1/expected-rows.json`'s `expectedAttention` is unchanged. The
queue becomes a *worklist*: worst-first, each row saying what it is about, filterable by that.

Product-owner decisions taken for this slice: definition **A** (context + order only), **severity
first then newest**, and an unanalyzed row **shown with no chip**.

## 3. What was built

**A worklist order.** `ReviewRepository.findUnansweredInWindowByChannelFiltered` now orders
`rating asc, receivedAt desc, id desc`. Applied to this query **only** — the arrival lenses stay
chronological, because a record of what came in is chronological by definition. The ordering is safe
here specifically because the lens is only driven with `minRating >= 1`, which excludes null
ratings: `rating asc` would otherwise sort nulls FIRST on H2 and LAST on PostgreSQL, making the top
of an operator's worklist depend on which database they were running.

**A canonical vocabulary.** `ItemAnalysisCategories` holds the nine labels `V5__item_analysis.sql`
already documents as a column comment, and `RuleBasedInboxItemAnalyzer` now derives its detection
list from it. A category the analyzer can emit but a filter cannot name would be unreachable on
every faceted surface, and the failure would be silent — `ItemAnalysisCategoriesTest` turns it into
a build failure instead.

**The row's category.** `IngestedReviewVocItemSource.categoriesFor` batch-loads it per page — one
org-scoped `IN` query hitting `uq_item_analyses_source`, the same shape as `dispositionsFor` and
`preparedFor`. The `orgId` filter is load-bearing rather than tidy: `item_analyses.source_id` is a
bare polymorphic reference with no FK, so a same-id row from another org would otherwise colour a
review it does not describe.

**A facet, with counts that are honest about their own scope.** `GET …/attention/items` takes an
optional `category`. The list is server-paginated at 10, so facet options are built from
server-computed counts over the whole window, never from the rendered page. V23 adds
`ix_item_analyses_category (org_id, source_type, category)`.

## 4. The two things that were easy to get wrong

**Two totals, and they are not interchangeable.** `total` narrows with an active facet — it is what
the pager pages through. `unfilteredTotal` ignores it and is the denominator the breakdown is
comparable to. They are equal only when no facet is applied, which is exactly why a test written
against `total` would pass and be wrong the moment an operator clicks a facet. The invariant

> `sum(categoryCounts) + unclassifiedCount == unfilteredTotal`

is asserted **with a facet active**, and `unfilteredTotal` comes from an **independent** query
rather than being derived from the counts — deriving it would make the invariant true by
construction and the test vacuous.

**기타 is not "unclassified".** `기타` is a stored **verdict** — the analyzer looked and nothing
matched. Unclassified is a **coverage gap**: no `item_analyses` row exists at all, because analysis
runs on newly-inserted ids only and swallows its own failures. Collapsing them would report a system
failure as a finding about the seller's reviews. They are separate buckets, separate counts, and
separate filter values (`기타` vs the reserved ASCII sentinel `unclassified`, which can never collide
with a Korean category and is never stored).

Two consequences follow, both deliberate:

- **A row with no analysis stays fully in the queue**, with no chip — no placeholder, and never
  borrowed 기타. Fail open: the missing analysis says nothing about the review, and hiding those rows
  would silently shrink a backlog in exactly the case where the system already failed once.
- **An unrecognised `category` is a 400, not an empty page.** An empty page would read as
  "확인이 필요한 리뷰 중 그런 건 없습니다" — a claim about the seller's reviews — when the truth is that
  the request named something that is not a category. Same posture as `parseType`, which has always
  refused an unknown signal type.

## 5. Verification

| | before | after |
|---|---|---|
| backend | 1433 (1 skipped) | **1456** (1 skipped) |
| frontend | 691 | **710** |
| collector | 4843 / 95 skipped | unchanged |

Both typechecks clean (`tsc --noEmit` for frontend and collector — vitest does not typecheck).

**Every new rule was falsified before being trusted** — seven reverts, each caught:

| revert | test that failed |
|---|---|
| ordering back to `receivedAt desc` | `theWorstReviewIsFirstEvenWhenItIsTheOldest` |
| `categoriesFor` unscoped by org | `aCrossOrgAnalysisNeverColoursAReview` |
| hide rows with no analysis (fail closed) | `anUnanalyzedRowIsStillFullyInTheQueue` |
| unknown category → empty page | `anUnrecognisedCategoryIsRejectedRatherThanRenderedAsAnEmptyResult` |
| `categoryChip` falls back to 기타 | `renders NOTHING when no analysis exists` (+ the card test) |
| facet built from the rendered page | `builds the facet from the SERVER's window counts` |
| drop the page reset on facet change | `resets to the first page when the facet changes` |

**Migration verified on real PostgreSQL 15**, not just H2: V23 applied to a disposable database
(`sellerops_v23_check`), history contiguous **1–23**, `ix_item_analyses_category` present with the
expected definition. Because `application-test.properties` disables Flyway and runs H2, the new
JPQL — including the `Review`×`ItemAnalysis` group-by and the `rating asc` ordering — was **also**
executed against a real PostgreSQL 15 database and passed there, with the table's existence
afterwards proving the run was not silently falling back to H2. Both disposable databases dropped;
the dev database was never touched.

## 6. What the independent review caught

Four defects, all fixed before commit:

1. **The drill-down header over-claimed once a facet existed.** It read
   "낮은 평점(1~3점) 리뷰 **전체를** 보여줍니다" — true before this slice, false the moment the list
   could be filtered. Reworded to state the list's SCOPE ("…리뷰가 이 목록의 대상입니다"), which still
   explains why the total can exceed the card's count without claiming nothing is filtered.
2. **The WARN log echoed an unrecognised category value.** A value reaching that branch is by
   definition one no writer we control produced, so "it is derived metadata, never customer text"
   was an assumption about unknown code rather than a fact. The value is no longer logged; the
   count is the whole diagnostic.
3. **A non-canonical stored category silently broke the reconciliation identity** — it is omitted
   from `categoryCounts` (offering it would advertise a facet the API answers with a 400) while
   `unfilteredTotal` still counts it. Rather than assume the case away, the deviation is now
   documented on the DTO and pinned by a test that also asserts the ROW is never hidden.
4. **An active filter could outlive its options.** The drill-down survives a window change, so a
   category chosen over one window can have no rows in the next — leaving an empty list whose only
   cause was a filter with no visible control. An active filter now always renders, at 0 if need be.

## 7. Recorded, not fixed

- **The high-rating complaint is still invisible.** A 5★ "배송이 늦었어요" cannot be detected by
  `rules-v1`. The next slice needs a polarity-aware analyzer, a re-analysis path (today
  `analyzeForSources` is skip-if-exists and `backfillMissing` only fills missing rows), and a `[PO]`
  decision on the complaint vocabulary.
- **Three competing definitions of "needs attention" remain unreconciled**: this queue
  (rating + reply state), `inboxView.isLowOrNegativeReview` (`status === "NEGATIVE" || rating <= 2`,
  recomputed client-side), and the analyzer's own `urgency`.
- **Analysis coverage is best-effort.** `triggerAnalysis` swallows failures and only newly-inserted
  ids are analyzed; `POST /api/item-analysis/backfill` stays manual. The `분류 전` facet makes the
  gap *visible* — it does not close it.
- **Carried forward, still open:** API-collected reviews are invisible to import history, and
  `CollectControlService.listRuns` filters after fetching, so `ChannelDetail` excludes every import.
