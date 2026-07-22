# `review-export/naver/v1` — the shared NAVER-shaped review-export golden fixture

One **committed, structurally valid `.xlsx`** that the collector and the backend load from the *same
path* and assert against the *same* `expected-rows.json`. It is the joint of the Review Acquisition
Spine: the bytes the collector quarantine-validates are byte-identical to the bytes the backend
ingests, so the two halves can no longer agree in theory and diverge in fact.

| File | Role |
|---|---|
| `naver-review-export-v1.xlsx` | the artifact — **the authority**; a real OOXML workbook |
| `expected-rows.json` | what both sides assert: rows, unmapped columns, ingest counts, id fingerprints |
| `SPEC.md` | this file |

`fileSha256` in `expected-rows.json` pins the artifact. Both ports assert it before reading, so a
re-encoded or regenerated workbook fails loudly instead of silently changing what "the spine proved".

## Why a committed binary and not a writer

An OOXML writer in the collector would be a second implementation of a format we only ever need to
*read*, and it would let the fixture drift per-run. A single committed file cannot drift, and it is
the only form in which "the collector and the backend saw the same bytes" is literally true.

**Provenance.** Generated once with Apache POI 5.3.0 (`XSSFWorkbook`, sheet `Sheet0`) — the same
library `FileParser` uses to read it — from the exact header and row values recorded in
`expected-rows.json`. The generator was a throwaway and is deliberately **not** in the repo: the
file is the artifact, and this SPEC plus `expected-rows.json` is a complete description for
rebuilding it by any means (POI, openpyxl, a spreadsheet application) should that ever be needed.
Rebuilding changes `fileSha256`; that is a deliberate, visible event, not a silent one.

## What is synthetic, and what is not

- **Every cell value is synthetic.** No marketplace content, no real store, product, account,
  reviewer, order, or review body. The bodies are invented Korean sentences about invented products.
- **The header labels are real NAVER seller-center column labels** (`리뷰글번호`, `구매자평점`,
  `리뷰상세내용`, …). They are a **schema alias**, not captured platform content — the same labels
  already ground `ReviewRowMapper`, `RowMapperTest`, `FileParserTest` and
  `ExportToAttentionChainTest`. This fixture adds no new alias.
- **Two deliberately unmapped columns** (`상품주문번호`, `등록자`) carry loud sentinels
  (`ORDER-MUST-NOT-PERSIST`, `REVIEWER-MUST-NOT-PERSIST`). A real export carries sensitive columns
  with no canonical slot; the sentinels let a test prove they never reach a canonical field or an
  operator-facing surface.

## The rows

Six rows, ratings `1 · 2 · 3 · 4 · 5 · 5`, dates `2026.05.05.`–`2026.05.10.` in the NAVER
`yyyy.MM.dd.` date-only form, all inside the `2026-05-01 … 2026-05-31` window. Three products across
three SKUs, so product resolution is exercised without any row being unique-by-accident.

`리뷰글번호` values are 10-digit, matching the real column's shape
(`contracts/review-id-fingerprint/v1/SPEC.md`), and land untransformed in `reviews.external_id` —
which is what makes a re-ingest of this same file an all-duplicate, idempotent `SUCCESS`.

`reviewIdFingerprint` is `review-id-fingerprint/v1` of each `channelReviewId`. Both ports recompute
it from the fixture and compare to this file, so the spine carries a live cross-port parity check on
its own data rather than only on the contract's abstract vectors.

## What this fixture does NOT establish

- **It is not live evidence.** It proves nothing about NAVER. It is an offline golden artifact; it
  consumes no gate and promotes no capability. Capability truth stays
  `docs/multi-channel-connector-roadmap.md` §4.1.
- **It is not a rendering of a real export's full column set.** It carries the columns the canonical
  mapping consumes plus two unmapped sentinels — not every column NAVER emits.
- **Structural validity is not ingestibility, and this fixture is the reason we can say so.** The
  quarantine sniff (`sniffXlsxReadable`) checks ZIP magic plus the `[Content_Types].xml` entry name
  in the head; a payload can satisfy both and still not be a workbook. This file satisfies the sniff
  **and** parses. `collector/test/action-window/review-acquisition-spine.test.ts` pins both
  directions.

## Consumers

| Port | File |
|---|---|
| Collector | `collector/test/action-window/review-acquisition-spine.test.ts` via the loader `collector/test/support/review-export-fixture.ts` (test scope on purpose — `src/action-window/**` gains no filesystem reader, and quarantine stays the only module there that touches `node:fs`) |
| Backend | `backend/src/test/java/com/sellerops/ingest/ReviewAcquisitionSpineTest.java` |

Slice: `docs/slices/review-acquisition-spine-v1.md`.
