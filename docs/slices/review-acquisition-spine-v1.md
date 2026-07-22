# Slice — Review Acquisition Spine v1

> **Status:** IMPLEMENTED, offline. **Consumes no gate, promotes no capability.**
> Capability truth stays `docs/multi-channel-connector-roadmap.md` §4.1; workstream status stays
> `docs/workstreams/review_operations_mvp.md`. This document describes what was built and what it
> does — and does not — establish.

- **Workstream:** Review Operations (the wedge — `docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** ACQUIRE (artifact validation) → NORMALIZE → UNDERSTAND/PRIORITIZE (visibility)
- **Date:** 2026-07-22
- **Live contact:** none. No browser, no marketplace, no credentials, no backend deployment.

---

## 1. Why

Every segment of review acquisition already existed. **Nothing joined them, and one segment could
not be joined at all.**

- The engine loop (prepare → observe → verify → detect → validate) was proven, and the ingest
  handoff to `/api/uploads` existed — but the handoff was wired **only** on the live NAVER CLI path
  (`buildLiveRunDeps`). The synthetic path ended in a dummy `{ processed }`.
- The synthetic artifact was **not a workbook**. `fixture.ts`'s payload carried the ZIP magic and
  the literal text `[Content_Types].xml`, which is exactly what the quarantine sniff looks for — so
  it validated clean and no parser on earth could read it. A green fixture run could prove detection
  and validation and **nothing downstream**.
- The backend proved upload → canonical review → dedup → attention (`ExportToAttentionChainTest`)
  against a workbook it built in its own JVM. Nothing established that the artifact the **collector**
  handles is the artifact the **backend** ingests.
- After a completed run the operator saw step progress and a sentence claiming the reviews had been
  "정리·분석까지" finished — with no count behind it, because the ingest outcome is reduced to
  `{ ok, processed }` at the handoff and persisted nowhere.

## 2. What was built

### 2.1 The joint — one committed artifact (`contracts/review-export/naver/v1/`)

A real, POI-generated, NAVER-shaped review export (6 rows, ratings `1·2·3·4·5·5`, `yyyy.MM.dd.`
dates, 10-digit `리뷰글번호`, two unmapped sentinel columns), plus `expected-rows.json` — the rows,
counts, window, and per-row `review-id-fingerprint/v1` values that **both** ports assert against.
`fileSha256` is pinned and checked on both sides before anything is read.

A committed binary rather than an OOXML writer: a writer would be a second implementation of a
format we only read, and it would let the fixture drift per run. Provenance and rebuild instructions
are in the contract's own `SPEC.md`.

### 2.2 The collector half

`collector/test/action-window/review-acquisition-spine.test.ts` (16 tests) pins, over the committed
bytes: the sha256; that an **independent** parser (the dependency-free `esm-review-xlsx-reader`,
which shares no code with the sniff) reads it; the exact rows and unmapped sentinels; a clean
quarantine verdict with an empty directory afterwards; `sanitizeBackendIngest` for both the first
ingest and the all-duplicate re-ingest; the neutral upload naming; and cross-port id fingerprints.

`fixture.ts` gained an optional `reviewExportBase64` so the `naver-review-export-xlsx` surface can
serve the **real** committed bytes; `browser-driver.ts` forwards it and gained an injected
`ingestFn` — the same `AwIngestUploadFn` seam the live driver takes, so a synthetic run can hand its
validated bytes to a real upload. Both are opt-in; absent them, every existing behaviour is
byte-identical.

### 2.3 The backend half

`backend/src/test/java/com/sellerops/ingest/ReviewAcquisitionSpineTest.java` (8 tests) ingests **the
same file** through the real `FileUploadConnector` as `SELLER_CENTER_EXPORT`: the declared counts,
`external_id` = `리뷰글번호`, the unmapped sentinels never reaching a stored field, cross-port
fingerprint parity, the attention signals an operator sees, the drill-down (name resolves, SKU never
rides along), the idempotent re-ingest, and the **NAVER-only source scope** — the same export
uploaded against a CAFE24 channel reaches the store yet must not surface through the ingested-review
source, because the registry is first-wins and double-counting would make an operator's numbers
depend on bean order.

### 2.4 The visible number

`reviewsNeedingAttention()` (`frontend/src/lib/attention.ts`) sums the **HIGH/MEDIUM, REVIEW-sourced,
non-spike** signals from the attention endpoint the FE already calls — no new endpoint, no new
field, no client-side taxonomy. `AttentionSignalList` renders **"현재 확인이 필요한 리뷰 N건"**, and
only on a successful, non-zero read: a `0건` line on a dead or empty read would be reassurance the
data does not support. `CompletedResult`'s completion claim was replaced with what the run actually
proves, plus a pointer to the surface that holds the number.

## 3. What this establishes — and what it does not

**Establishes (offline):** the collector and the backend handle the same bytes; a real workbook
survives quarantine validation *and* parses; the canonical mapping, identity, dedup, and attention
visibility hold over that artifact end to end; the id fingerprint agrees across the TS and Java
ports on the spine's own data; the synthetic path now has a real ingest seam.

**Does NOT establish:**

- **Nothing about NAVER.** No live run happened. The fixture is synthetic; the header labels are
  schema aliases, not captured content.
- **No capability moves.** §4.1 is untouched; `운영 지원` stays file-upload-only.
- **Not an end-to-end synthetic run against a live backend.** The two halves meet at the committed
  artifact, not at a running server. The collector asserts the *sanitization* of a backend result;
  the backend asserts the *ingest* of the same bytes. A single process driving fixture → HTTP →
  attention is not part of this slice.
- **Not a distinct-review count.** The visible number is a sum of signal counts. For today's signals
  the survivors partition rows by rating and cannot overlap, but that is a property of the current
  taxonomy, not a guarantee — the copy must not be strengthened into a distinctness claim.

## 4. Finding recorded (reported, not resolved)

> **Quarantine `valid: true` does not imply ingestible.** The D-021 sniff checks ZIP magic plus the
> `[Content_Types].xml` entry name in the head; a payload can satisfy both and not be a workbook —
> the pre-spine fixture payload did exactly that, and the test suite now pins both directions.

The sniff's semantics are the ratified posture and are **deliberately unchanged here**. What changed
is that the synthetic path can now carry bytes that pass both checks, and that the gap between them
is pinned rather than assumed. Whether validation should gain a parse-level check is a product-owner
call, not a test's.

## 5. Fences honored

No live marketplace run and no G6 requested; no CAPTCHA/2FA/auth path; no automatic export,
download, or submit; no seller-facing capability claim; nothing read from or written to
`runtime-holders/`; no `.env`, profile, or download path touched. Every byte committed is synthetic.

## 6. Related

- Contract: `contracts/review-export/naver/v1/SPEC.md`
- Workstream status: `docs/workstreams/review_operations_mvp.md`
- Capability truth: `docs/multi-channel-connector-roadmap.md` §4.1
- Action Window runtime status: `docs/action-window-runtime/HANDOFF.md`
- Identity contract: `contracts/review-id-fingerprint/v1/SPEC.md`
