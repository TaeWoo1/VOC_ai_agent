# Corpus lineage — what is actually in the `review-eval/naver/v2` frame, and where review media goes

**Status:** investigation only. Nothing here changes the pre-committed sample, split, gates, or any
label. Two questions were asked and both are answered from source rows and code, not inference.

Companion to `contracts/review-eval/naver/v2/RUBRIC.md` and
`docs/slices/product-context-diagnosis-groundwork.md`.

---

## 1. The row the annotator asked about: `합성 리뷰 본문 2`, 5★

**It is a collector integration-test fixture, written into the dev database through the production
ingest path.** Not a real NAVER export row, not a worked example, not `MockDataSeeder`, not a
placeholder or a transformed row.

### The proof

The database row:

| field | value |
|---|---|
| `external_id` | `awfx-a33034d4-340f-40c8-958e-e05108d77422` |
| `rating` | 5 |
| `body` | `합성 리뷰 본문 2` |
| `media_count` | 0 |
| `received_at` | 2026-01-03 |
| `created_at` | 2026-07-11 16:38:04 |
| channel | `NAVER` |

The generator, `collector/test/upload.test.ts:456-465` — the integration test
*"ingest handoff: synthetic CSV inserts then dedups, sanitized to `{ ok, processed }`"*:

```ts
const rows = [0, 1, 2].map((n) => ({ id: `awfx-${randomUUID()}`, n }));
const header = "상품명,내용,별점,작성일,리뷰글번호";
const body = rows.map((r) => `합성상품,합성 리뷰 본문 ${r.n},5,2026-01-0${r.n + 1},${r.id}`).join("\n");
```

It POSTs that CSV to a **real local backend** with `sourceType = SELLER_CENTER_EXPORT`, through the
same `FileParser` → `ReviewRowMapper` → `IngestionService` path a real export takes. So the row is
indistinguishable from a real export row once stored: `reviews` records no provenance beyond
`external_id`.

The `awfx-` prefix appears nowhere else in the repository.

### Why there are fifteen of them

The test mints `randomUUID()` ids **deliberately**, so that the first upload inserts and the second
dedups — a real fixed id would already be in the dev DB and the insert half of the test would pass
vacuously. The cost is that **every run permanently adds three more rows**. Five runs are recorded:

```
2026-07-11 16:38   awfx-…  ×3
2026-07-20 15:27   awfx-…  ×3
2026-07-20 15:28   awfx-…  ×3
2026-07-21 12:59   awfx-…  ×3
2026-07-21 13:20   awfx-…  ×3
```

This is a test that mutates a shared dev database and cannot clean up after itself, by design.

### The other two synthetic families in the same frame

| prefix | rows | bodies | first seen |
|---|---|---|---|
| `awfx-…` | 15 | `합성 리뷰 본문 0/1/2`, all 5★ | 2026-07-11 |
| `SYN-20260622-f93ee8-000N` | 3 | `합성 리뷰 내용입니다`, `또 다른 합성 리뷰입니다`, `세 번째 합성 리뷰입니다` | 2026-06-22 |
| `COLLECTOR-SMOKE-20260617163802-N` | 5 | `… (합성 데이터)` | 2026-06-17 |

`SYN-` and `COLLECTOR-SMOKE-` have **no generator left in the repository** — `git log -S` across all
refs finds nothing. They are residue of scripts that were deleted or that only ever existed in a
runtime holder. Their lineage is therefore *not* provable from this repository; what is provable is
that they are not export rows (a real `리뷰글번호` is a 10-digit number,
`contracts/review-id-fingerprint/v1/SPEC.md`).

### How much of the frame this is

```
NAVER rows with external_id      3,858     ← the §4 sampling frame
  10-digit (real export shape)   3,835     99.40%
  synthetic                         23      0.60%
```

### How much of the 220 sample this is

**Four rows, 1.8%** — three times the frame rate, because two of the three low-rating strata are
censused (§4.2), so a synthetic short low-rated row cannot fail to be drawn.

| key | rating | stratum | split | overlap | body |
|---|---|---|---|---|---|
| 11 | 5★ | `HIGH_S` | DEV | no | `합성 리뷰 본문 2` |
| 163 | 1★ | `LOW_M` | **HOLDOUT** | **yes** | `배송 중 모서리가 깨져서 왔어요. (합성 데이터)` |
| 193 | 2★ | `LOW_S` | DEV | no | `또 다른 합성 리뷰입니다` |
| 213 | 2★ | `LOW_M` | DEV | no | `두께가 생각보다 얇아 아쉬웠습니다. (합성 데이터)` |

### The annotator found two of them unaided

Across all 220 rows the annotator used `UNCERTAIN` **exactly twice**, and both are on this list —
keys 11 and 193, the two rows whose bodies are contentless synthetic strings. Nobody told them the
corpus had fixtures in it. That is independent evidence both that the contamination is visible from
text alone and that `UNCERTAIN` is being used the way §3 intends.

Key 163 is a scored overlap row and both labelers called it `NEEDS_ATTENTION`, so it contributed an
agreement to κ. One row of thirty.

### What is NOT decided here

Whether to exclude these four. That is a product-owner decision with a real cost on each side:

- **Excluding them** changes the evaluation set after labels exist. §4's sample is pre-committed
  precisely so it cannot be edited once a result is in view, and "drop the rows the model finds
  confusing" is the failure mode that rule exists to prevent.
- **Keeping them** means four of 220 gold rows describe reviews no customer wrote, and the
  reweighted population estimate treats them as representing ~17 frame reviews each in the censused
  strata.

A third option exists and is probably the honest one: **keep the sample intact, label them, and
report every metric with a stated four-row sensitivity** — the same shape as the pilot's
primary/sensitivity pair. It requires no edit to anything pre-committed.

**Separately and not a decision at all:** `collector/test/upload.test.ts` writing unbounded rows into
a shared dev database is a defect regardless of what this unit does about the four rows.

---

## 2. Review media: it exists in the export, and dies at the mapper

The question was where media information disappears. It disappears in one place, and the answer is
different for the two channels.

### NAVER — the column exists and is silently dropped

The real seller-center export is 25 columns
(`contracts/review-export/naver/v1/expected-rows.json`, grounded on a read-only inspection of a real
export held outside this repository). **Column 5 is `포토/영상`.**

`ReviewRowMapper` (`backend/src/main/java/com/sellerops/ingest/map/ReviewRowMapper.java`) maps eight:

```
sku 상품번호 · product 상품명 · rating 구매자평점 · body 리뷰상세내용
receivedAt 리뷰등록일 · externalId 리뷰글번호 · replyState 답글여부 · repliedAt 답글등록일시
```

`포토/영상` is one of the fifteen unmapped columns. Unmapped columns are tolerated by design, and
only the three PII-class columns (`등록자`, `상품주문번호`, `유저정보 등록 항목`) carry
`MUST-NOT-PERSIST` sentinels. So `포토/영상` is not refused, not logged, not counted — it is simply
never read. The mapper then calls the 9-argument `CanonicalReview` constructor, which fills
`mediaCount = 0` as a literal.

**The drop is at `ReviewRowMapper`, and it is silent.** Everything downstream is faithful to a value
that was already zero.

### Coupang — the media path is complete, and has nothing in it

The WING acquisition path carries media end to end:

```
review-row-inpage.ts   mediaCountOf(cells, byRole)     counts inside the review body cell only
review-rows.ts         mediaCount on the canonical row
review-handoff-client  mediaCount in the handoff payload
AgentReviewHandoffRequest  @Min(0) @Max(50) int mediaCount
IngestionService:135   entity.setMediaCount(row.mediaCount())
reviews.media_count    V37__review_source_option_and_media.sql
ChannelReviews.tsx:319 사진·영상 {n} chip
```

V37 is explicit about what the count means and does not mean: *"counted inside the review body cell
only. The product thumbnail every row shows is not review media, and a row-wide count would have
reported that every review has a photo."*

So the schema, the transport, the validation and the UI all exist. What does not exist is data:

```
reviews.media_count > 0   →   0 rows, all channels
NAVER    3,880 rows   max(media_count) = 0
COUPANG     36 rows   max(media_count) = 0
GMARKET     11 rows   max(media_count) = 0
```

The 36 stored Coupang rows carried no media on the screens they were read from; the 3,858 NAVER rows
came through a mapper that never looked.

### Where media is absent in the calibration path

Media never had a chance to reach the labeling surface, and it would not have mattered if it had:

| stage | carries media? |
|---|---|
| real NAVER export file | **yes** — `포토/영상`, column 5 |
| `FileParser` → `ParsedTable` | yes — all 25 columns are parsed |
| `ReviewRowMapper` | **no — dropped here, silently** |
| `reviews.media_count` | 0 on every row |
| `draw-sample.mjs` SQL | selects `external_id, rating, body` only — media not queried |
| `rows.json` | not present |
| owner / annotator page | not present |
| gold label schema (§5) | no field for it, by contract |

**Consequence for this unit, stated plainly:** every label in this gold set was produced by a human
reading text and a star rating for a review that may have had photographs attached. A 5★ body of
`좋아요` beside three photographs of a damaged item is, in this corpus, indistinguishable from a 5★
body of `좋아요`. That is a ceiling on what any text-only classifier — rules, Claude, or GPT — can be
measured against here, and it belongs beside every recall number this unit reports.

### What is NOT being built

No multimodal feature, no media ingestion, no mapper change. The finding is recorded; whether to
alias `포토/영상` is a separate decision that belongs with the Product Context unit, because the same
export row also carries `상품번호` and `상품명` and it would be strange to open the mapper twice.
