# `review-export/naver/v1` — the shared NAVER-shaped review-export golden fixtures

Two **committed, structurally valid `.xlsx`** artifacts that the collector and the backend load from
the *same* path and assert against the *same* `expected-rows.json`. They are the joint of the Review
Acquisition Spine: the bytes the collector quarantine-validates are byte-identical to the bytes the
backend ingests, so the two halves can no longer agree in theory and diverge in fact.

| File | Role |
|---|---|
| `naver-review-export-v1.xlsx` | the artifact — 25 real columns, 6 synthetic rows |
| `naver-review-export-empty-v1.xlsx` | the same 25 headers, **zero data rows** — the empty-export case |
| `expected-rows.json` | what every port asserts: headers, rows, ingest counts, attention signals, id fingerprints |
| `SPEC.md` | this file |

Both `fileSha256` values are pinned in `expected-rows.json` and checked before anything is read, so a
re-encoded or regenerated workbook fails loudly instead of silently changing what the spine proved.

## Why committed binaries and not a writer

An OOXML writer in the collector would be a second implementation of a format we only ever *read*,
and it would let the fixture drift per run. A committed file cannot drift, and it is the only form in
which "the collector and the backend saw the same bytes" is literally true.

**Provenance.** Generated once with Apache POI 5.3.0 (`XSSFWorkbook`, sheet `Sheet0`) — the same
library `FileParser` uses to read them — from the exact headers and values recorded in
`expected-rows.json`. The generator was a throwaway and is deliberately **not** in the repo: this SPEC
plus `expected-rows.json` is a complete description for rebuilding by any means. Rebuilding changes
`fileSha256`; that is a deliberate, visible event.

## Schema fidelity — why 25 columns

The header set and its order are the **real** NAVER seller-center review export
(리뷰 관리 → 엑셀다운), established by a read-only inspection of a real seller export held **outside
this repository** and corroborated by the §S sample-file analysis in `review_acquisition.md` (a
document that survives only in the preserved runtime worktrees — see the drift note below). An
earlier revision of this fixture carried an 8-column convenience subset; it tested a schema no seller
ever produces. Specifically, the real shape adds:

- **`리뷰등록일` is `yyyy.MM.dd. HH:mm:ss`** (20 chars), not a bare date. `DateParse.localDate`
  handles it — it splits on the space and strips the trailing dot — but a date-only fixture never
  exercised that branch. The fixture now does. Time-of-day is dropped (UTC start-of-day) by design.
- **17 columns with no canonical slot**, so unmapped-column tolerance is tested at real width rather
  than against two token extras.
- **Near-miss header names** — `관련리뷰상세내용` sits beside `리뷰상세내용`, and `관련리뷰글번호`
  beside `리뷰글번호`. `HeaderAliases.pick` is an exact-key lookup on normalized headers, so these
  cannot be mis-picked; the fixture keeps them present so that stays true by test.

**Everything in the cells is synthetic.** No marketplace content, no real store, product, account,
reviewer, order, or review body. The header labels are a schema alias — the same labels already
ground `ReviewRowMapper`, `RowMapperTest`, `FileParserTest` and `ExportToAttentionChainTest`.

## Sensitive columns

`등록자`, `상품주문번호`, and `유저정보 등록 항목` are the PII-class columns of a real export
(classified High/Medium in the §S analysis). Here they carry loud `MUST-NOT-PERSIST` sentinels so a
test can prove they never reach a canonical field or an operator-facing surface.

## The rows

Six rows, ratings `1 · 2 · 3 · 4 · 5 · 5` — deliberately **not** the real distribution (a real export
skews heavily 5★); the point is to exercise the attention bands, not to model volume. Three products
across three SKUs. `리뷰글번호` values are 10-digit, matching the real column's shape
(`contracts/review-id-fingerprint/v1/SPEC.md`), and land untransformed in `reviews.external_id`,
which is what makes a re-ingest of the same file an all-duplicate, idempotent `SUCCESS`.

The fixture also carries state the pipeline currently **drops**, on purpose:

- **`답글여부`** (`Y` on two rows, with `답글등록일시` set only there). A real export states whether
  the seller already answered; `CanonicalReview` has no field for it and
  `IngestedReviewVocItemSource` sends `replyStatus: null`. On the real export **33% of the low-rating
  queue was already answered**, so the operator's "needs a look" list is inflated and the guided-reply
  path can lead to a duplicate public reply. Carrying the column here means the follow-up slice
  inherits a fixture that already proves the loss.
- **`관련리뷰글번호` / `관련리뷰상세내용`** on the two `한달사용` rows, each holding a copy of the
  linked row's body — matching the real file, where the related body was byte-identical to the linked
  review's own body in 1,157 of 1,157 resolvable cases. Dropping that text loses nothing; the linkage
  itself is a later question.

## What these fixtures do NOT establish

- **Nothing about NAVER.** No live run. Offline golden artifacts; no gate consumed, no capability
  promoted. Capability truth stays `docs/multi-channel-connector-roadmap.md` §4.1.
- **Not a volume or distribution model.** Six rows, chosen ratings.
- **Structural validity is not ingestibility** — the quarantine sniff (`sniffXlsxReadable`) checks ZIP
  magic plus the `[Content_Types].xml` entry name; a payload can satisfy both and not be a workbook.
  `collector/src/action-window/artifact-parse.ts` is the parse-level answer, and
  `collector/test/action-window/artifact-parse.test.ts` pins both directions.

## Consumers

| Port | File |
|---|---|
| Collector | `collector/test/action-window/review-acquisition-spine.test.ts`, `artifact-parse.test.ts`, and the gated `review-spine-e2e.test.ts`, all via the loader `collector/test/support/review-export-fixture.ts` (test scope on purpose — `src/action-window/**` gains no filesystem reader) |
| Backend | `backend/src/test/java/com/sellerops/ingest/ReviewAcquisitionSpineTest.java` |
| Frontend | `frontend/src/lib/attention.test.ts` + `AttentionSignalList.test.tsx` assert `expectedAttention` — the number is verified per stack, with **no cross-stack imports** |

Slice: `docs/slices/review-acquisition-spine-v1.md`.

> **Drift note (reported, not fixed here):** `contracts/review-id-fingerprint/v1/SPEC.md` cites
> `docs/review_acquisition.md` §S and `docs/action-window-runtime/r4-review-id-trace.md`. Neither
> exists in the active repository — the former survives only in the preserved runtime worktrees.
> Porting §S's schema and sensitivity analysis into the repo deserves a product-owner decision; it is
> the provenance this contract rests on.
