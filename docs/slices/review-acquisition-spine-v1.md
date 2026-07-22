# Slice — Review Acquisition Spine v1

> **Status:** IMPLEMENTED, offline — **the two named gaps are closed (2026-07-23); the spine is NOT
> declared fully closed.** One measured product gap remains open and is recorded in §7.
> **Consumes no gate, promotes no capability.**
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

---

## 5. Round 2 (2026-07-23) — the gaps closed, against real export evidence

A read-only inspection of real seller exports held **outside this repository** (never copied,
committed, or read by a test) reshaped both remaining gaps. Only schema, failure cases, and impact
measurements informed the work.

### 5.1 The fixture now has the real shape

The 8-column convenience subset tested a schema no seller produces. Both artifacts are regenerated at
the **real 25 columns in real order**, with `리뷰등록일` in the real **`yyyy.MM.dd. HH:mm:ss`** form
(20 chars). That matters concretely: `DateParse.localDate` handles it by splitting on the space and
stripping the trailing dot — a branch the date-only fixture never exercised, now asserted end to end
(`ReviewAcquisitionSpineTest#theRealExportsTimestampFormParsesAndLandsInTheOperatorsWindow`). A
second artifact, `naver-review-export-empty-v1.xlsx`, carries the same headers and zero rows.

The fixture also deliberately carries `답글여부`/`답글등록일시`, `리뷰구분`, and a
`관련리뷰글번호`/`관련리뷰상세내용` follow-up pair — state the pipeline currently drops (§7).

### 5.2 Parse-level validation, at the validate seam

`collector/src/action-window/artifact-parse.ts` walks the container via the extracted pure reader
(`collector/src/xlsx/workbook-shape-read.ts`, `node:zlib` only; `esm-review-xlsx-reader.ts` is now a
thin file-path delegate with its public API unchanged). Both drivers run it inside `validateArtifact`,
**after** the quarantine verdict.

**Why there and not at the ingest handoff.** A handoff refusal surfaces as `INGEST_FAILED`, whose
seller-facing copy is "저장 중 문제가 생겼어요 / 잠시 후 다시 시도해 주세요" — storage did not fail,
and retrying will not help. At the validate seam it surfaces as `ARTIFACT_INVALID` — "받은 파일을
확인할 수 없어요 / 다시 내려받아 주세요" — which is true and actionable. **This tightens the live
NAVER path**; see the decision record note in §8.

`dataRowPresent` is **observed and non-gating** (the D-025 observe-never-gate category): an empty
export is legitimate, and a real header-only export was observed in the wild.

### 5.3 Honest zero — and a conflict resolved by provenance, not by override

Driving the empty artifact revealed that `FileUploadConnector.finish()` marked **any** zero-row upload
as errored, so a valid empty export ingested as `FAILED`. That rule is deliberate and pinned
(`FileUploadConnectorTest#statusMappingMatchesLegacyResolveStatus`: "empty upload → error"), and it is
right for a **human** upload — a person who picks an empty file almost certainly picked the wrong one.

Rather than break that contract, the rule now distinguishes **provenance**: an empty
`SELLER_CENTER_EXPORT` (the Action Window hands over what the platform produced for the seller's
chosen range) is an honest zero → `SUCCESS` 0/0/0; an empty `MANUAL_UPLOAD` still fails; and an
`errorMessage` always wins, so "we could not read it" can never become "there was nothing in it".
Both directions are pinned by test. `RunOutcome.classify` already documented this intent ("including
an empty incremental pull is SUCCESS"); the connector had overridden it.

### 5.4 The end-to-end proof — actually run

`collector/test/action-window/review-spine-e2e.test.ts` (gated on `RUN_INTEGRATION=1` +
`SPINE_E2E_BASE_URL`) drives a synthetic Action Window run in real Chromium, over the fixture page
serving the **real committed bytes**, through the real quarantine and the real ingest handoff, into a
**running backend over HTTP**, then reads the attention API.

**Executed 2026-07-23 against a disposable backend** — a uniquely-named throwaway database
(`sellerops_spine_e2e_*`, created for the run and dropped after, with a name guard so the dev database
could not be the argument) on port 18080. **4/4 passed:**

| Case | Result |
|---|---|
| Real export → run `COMPLETED` 3-of-3, quarantine dir empty, every frame sanitized, attention API payload equals `expectedAttention` | PASS |
| Re-handing the same artifact | `{ok:true, processed:0}`, attention unchanged |
| Empty export | run `COMPLETED`, no blocker, ingest `SUCCESS` 0 rows, attention unchanged |
| Sniff-passing non-workbook | run `FAILED` / `ARTIFACT_INVALID`, nothing uploaded |

The dev database was never connected to; the throwaway was dropped and `sellerops` verified intact.

**No frontend code is imported by the collector.** The joint is `expectedAttention` in the contract:
the backend asserts its service produces those signals, this E2E asserts the live HTTP payload matches
them, and the frontend asserts its selector and render over the same declaration.

**Falsified before trusting** (*a vacuous guard against a footgun is the footgun*): forcing
`parseOk: true` fails 8 hermetic tests **and** the E2E's `ARTIFACT_INVALID` case; making
`dataRowPresent` gate fails 3 hermetic tests **and** the E2E's empty-export case.

---

## 6. Test deltas (attributed, no unexplained drift)

| Suite | Before | After | Attribution |
|---|---|---|---|
| collector | 4822 / 91 skipped | **4843 / 95** | +15 `artifact-parse`, +4 spine (timestamp form, reply state, near-miss headers, empty artifact), +2 live-driver (sniff-passing rejection, empty-but-valid); +4 skipped = the gated E2E |
| backend | 1366 | **1370** | +4 in `ReviewAcquisitionSpineTest` (timestamp form, empty export, manual-upload contrast, unreadable export) |
| frontend | 663 | **666** | +2 `attention.test.ts` (contract joint, non-vacuity), +1 `AttentionSignalList.test.tsx` (renders the declared number) |

---

## 7. Open — the spine is NOT fully closed

**`답글여부` / `답글등록일시` are dropped, and it changes what an operator sees.** The loss is
structural at four layers: no alias in `ReviewRowMapper` → no field on `CanonicalReview` → no column
on `reviews` → `IngestedReviewVocItemSource:383` hardcodes `null, // replyStatus — an export carries
no reply state`. **That comment is false for NAVER**, and the DTO field (`OperatorVocItem.replyStatus`)
already exists to carry the value.

Measured on a real export: **26 of the 79 low-rating reviews (33%) were already answered.** The
operator's "needs a look" queue is inflated by a third, and the guided-reply path can lead a seller to
post a **duplicate public reply** — an outward-facing mistake on the wedge's core workflow.

**Recommended follow-up slice — *Review reply-state ingest v1*:** aliases → `CanonicalReview` field →
`reviews.reply_state` + `replied_at` (Flyway V21) → populate `replyStatus` → correct the false comment
→ and a product decision on whether answered reviews are **excluded** from "needs a look" or **badged**.
The golden fixture already carries both states, so that slice inherits a fixture that proves the loss.

**Investigated and dismissed: `관련리뷰상세내용`.** On the real export it appears on 1,272 rows, all
`한달사용` follow-ups; where the link resolves in-file (1,157), its SHA-256 **equals the linked row's
own body in 1,157/1,157 cases**. It is a denormalized copy of a review that is itself ingested —
dropping the text loses no distinct customer feedback. `관련리뷰글번호` + `리뷰구분` carry follow-up
*linkage* worth revisiting later; nothing is lost today.

---

## 8. Governance

- **No live marketplace contact, no G6, no gate consumed.** The E2E is a synthetic page plus a
  disposable local backend, run under the in-turn approval the HANDOFF's forbidden list requires.
- **§4.1 and `channel_capability_ledger.md` untouched.** A disposable local backend is not marketplace
  live verification; `운영 지원` stays file-upload-only.
- **`decisions.md` — a record is owed, not yet appended.** Tightening `validateArtifact` changes
  behaviour on the **live NAVER** path, which the B3 record (an unexplained real-export
  `ARTIFACT_INVALID`, accepted by PO ruling) warns about. The entry is drafted and held for
  product-owner wording approval; `decisions.md` is append-only and PO-ratified.
- **Doc drift, reported not fixed:** `contracts/review-id-fingerprint/v1/SPEC.md` cites
  `docs/review_acquisition.md` §S and `docs/action-window-runtime/r4-review-id-trace.md`; neither
  exists in the active repo (the former survives only in the preserved runtime worktrees). Porting
  §S's schema and sensitivity analysis into the repo deserves a PO decision — it is the provenance the
  review-export contract rests on.

## 9. Related

- Contract: `contracts/review-export/naver/v1/SPEC.md`
- Workstream status: `docs/workstreams/review_operations_mvp.md`
- Capability truth: `docs/multi-channel-connector-roadmap.md` §4.1
- Action Window runtime status: `docs/action-window-runtime/HANDOFF.md`
- Identity contract: `contracts/review-id-fingerprint/v1/SPEC.md`
