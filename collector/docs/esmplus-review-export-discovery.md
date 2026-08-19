# ESM Plus — REVIEW seller-center export discovery (offline)

> **Offline discovery note — no live anything.** No ESM credentials, seller IDs,
> Master ID, API key, or JWT exist or are modeled here. **No automated ESM+
> review collection is implemented. No live browser run has happened. No
> download has happened. No upload path is enabled.** This document defines the
> *intended* discovery ladder for the ESM+ REVIEW browser/export fallback track
> before any of it is built or run. Everything ESM-REVIEW-specific below is
> **`NEEDS_DISCOVERY` / `NEEDS_VERIFICATION`** — nothing is **CONFIRMED**.

## Why this track exists

The ESM+ **API path is blocked**: we do not have approved ESM Trading API
credentials / Secret Key / API permission, and seller-center login alone is not
enough for the API. There is also **no confirmed official ESM review API**. So
ESM+ **REVIEW** follows the **model-C browser/export fallback** track
(`esmplus-access-model.md` §5) — the same seller-center Excel-export approach
used for NAVER. ESM+ **INQUIRY / ORDER / CLAIM** stay on the deferred API-first
track and are **out of scope** here.

## NAVER is a safety template, not ESM knowledge

The NAVER collector (`collector/src/naver/`, `collector/src/cli/`) is the proven
pattern this track will mirror: persistent human-attended profile, per-run
approval flag, no-click read-only probes first, supervised single-capture,
delete-after-validate, sanitized-signals-only logging. We reuse that **safety
template and the channel-generic core** (`src/events/`, `src/review/`,
`review-download-save.ts`, `log.ts`, the `/api/uploads` pipeline).

We do **not** reuse NAVER's DOM/wording/URL knowledge as if it were ESM's. Every
ESM-specific marker (session signals, export-button wording, async-job markers,
consent-prompt wording, account/store-selection flow, review-management URL, the
xlsx column schema incl. the dedup key) is **unknown** until a human observes it
live in Gate 1. Treat all such markers as placeholders, exactly as
`collector/CLAUDE.md` §6 requires — never guess-tune them.

## Discovery ladder (Gates 0–4)

Each gate is a separately-approved slice. A gate may not start until the prior
gate's findings are recorded. No gate past Gate 0 runs without explicit per-run
operator approval in a stable environment.

### Gate 0 — docs posture *(this slice)*
Docs only. Reconcile `esmplus-feasibility.md` / `esmplus-access-model.md` and
define this ladder. No code, no browser, no live session, no click, no download,
no API call, no credentials, no DB write, no capability change. Output: this
document + the reconciled posture. **Status: in progress / this slice.**

### Gate 1 — human manual observation *(no code)*
A human logs into the ESM+ (Gmarket / Auction) seller center and **observes** the
review surface, recording **only sanitized findings** (booleans / categories /
coarse buckets — no raw URLs, HTML, screenshots, counts, or PII). No code runs,
nothing is clicked for capture, nothing is downloaded. The checklist below is the
deliverable. **Status: OBSERVED (sanitized).** A human-attended observation
confirmed a review-management surface on a `manage-feedback`-like route with an
엑셀/다운로드-like export control; sync-vs-async and the consent/account-store flow
stay `NEEDS_DISCOVERY`. (Corroborated no-click — see "Gate 2 result" below.)

### Gate 2 — no-click browser classification / probe
Port the NAVER **read-only** probes (`probe-export-same-session` /
`classify-export-same-session` equivalents): persistent profile + sentinel-file
continuation + an ESM approval flag (e.g. `--i-understand-this-opens-live-esm`),
emitting only sanitized booleans / bucketed counts / category enums. **Strict
no-click**: no `.click(`, no `waitForEvent("download")`, no `saveAs`, no upload,
no status write. Classifies sync-vs-async and locates the export UI without
triggering it. **Status: OBJECTIVE MET (sanitized).** The classifier
(`instruments/calibration/classify-esm-review.ts` + pure `src/esm/esm-review-probe.ts` +
`esm-export-visibility.ts` + `esm-frame-scan.ts`) ran **four** times under
human-attended login. Run #4 (with the ESM-family frame allowlist active) located
**one actionable export control** (`actionableScope: allowlisted-frame`) — Gate 2's
goal of locating an actionable, visible export control no-click is **met**. REVIEW
stays `NEEDS_DISCOVERY`. (See "Gate 2 result — fourth … run" below.)

### Gate 3 — supervised approved-index single capture
Reuse the NAVER **supervised approved-index** pattern, adapted to the cross-origin
allowlisted frame: locate the review-usage/consent prompt (if any), operator passes
an explicit `--approved-index`, and **exactly one** human-approved click fires a
download — observe-and-discard via the format-agnostic `review-download-save.ts`
(OOXML/ZIP magic sniff, no cell parsing, delete-after-validate). No auto-repeat, no
upload yet. **Status: JUSTIFIED TO DESIGN — DESIGNED, NOT STARTED.** Gate 2's
objective is met (run #4 located an actionable control in the `allowlisted-frame`
scope), so Gate 3 is justified; the full design is in **"Gate 3 design"** below. No
code, no live run, no click has happened. REVIEW stays `NEEDS_DISCOVERY`.

### Gate 4 — controlled upload *(only after schema is known)*
Only after the review xlsx/csv **column schema** — especially the **dedup key**
(NAVER's is `리뷰글번호`; ESM's is **unknown / `NEEDS_VERIFICATION`**) — is known
from Gates 1–3. Reuse `upload.ts` / `/api/uploads` with a new ESM review
channel / `uploadType`, validated against **synthetic** rows first (never a real
export). **Status: `NEEDS_DISCOVERY`. Depends on Gates 1–3 and a known schema.**

## Gate 1 manual-observation checklist

To be filled in by a human during Gate 1, recording **sanitized** answers only
(yes/no/unknown + coarse category — no raw URLs, screenshots, HTML, exact counts,
or PII). Every item starts **`NEEDS_DISCOVERY`**.

| # | Question | Record (sanitized) | Status |
|---|----------|--------------------|--------|
| 1 | Does a **review-management surface** exist in the ESM+ seller center? | yes / no / unknown | `NEEDS_DISCOVERY` |
| 2 | Does a **review export** exist on that surface? | yes / no / unknown | `NEEDS_DISCOVERY` |
| 3 | Is the export **sync** (immediate download) or **async** (job/queue)? | sync / async / unknown | `NEEDS_DISCOVERY` |
| 4 | **Export-button wording** (accessible label/text)? | category only (e.g. "엑셀/다운로드-like") — no raw capture | `NEEDS_DISCOVERY` |
| 5 | Is there a **consent / usage prompt** before download, and what is its wording? | present? yes/no; wording category only | `NEEDS_DISCOVERY` |
| 6 | Is there an **account / store-selection interstitial** (Commerce-style)? | yes / no / unknown | `NEEDS_DISCOVERY` |
| 7 | **Review-management URL** (host/route shape)? | category/shape only — no raw URL with identifiers | `NEEDS_DISCOVERY` |
| 8 | Does the downloaded **format** appear to be **xlsx / csv**? | xlsx / csv / other / unknown | `NEEDS_DISCOVERY` |
| 9 | Any visible **date / status / filter controls** on the review surface? | which categories present (date range / status / rating / etc.) | `NEEDS_DISCOVERY` |

(Gate 1 also implicitly surfaces the **xlsx column schema / dedup key**, but that
is verified concretely in Gate 3/4, not asserted from a glance — keep it
`NEEDS_VERIFICATION` until a real, schema-only inspection confirms it.)

## Gate 2 result — first live no-click run (sanitized)

One human-attended `classify-esm-review` run completed safely (no click, no
download, no upload, no API call, no DB/status write, no capability change).
**Sanitized findings only** (booleans / coarse buckets / categories):

| Signal | Value |
|--------|-------|
| `sessionVerdict` | `LOGGED_IN` |
| `urlCategory` | `seller-center` |
| `manageFeedbackRouteLike` / `reviewRouteLike` | `true` / `true` |
| `passwordFieldPresent` / `authChallengePresent` / `accountReconnectAffordancePresent` | `false` / `false` / `false` |
| `excelLike` / `downloadLike` | `true` / `true` |
| `exportLike` / `csvOrXlsxLike` | `false` / `false` |
| `asyncMarkerPresent` | `false` |
| `exportCandidateCount` | `few` |
| `enabledExportCandidateCount` | `few` |
| `visibleExportCandidateCount` | `none` |
| `hasActionableExportCandidate` | `false` |
| `exportLayoutHint` (coarse, non-authoritative) | `SYNC_LIKELY` |
| DOM-settle | hydration wait **timed out** |

**What Gate 2 corroborates:** a logged-in **seller-center** session on a
**`manage-feedback`-like** route exposing **엑셀/다운로드-like** export keywords with
**no async** download-center marker — consistent with Gate 1. The route and the
export-keyword surface are corroborated no-click.

**What Gate 2 does NOT establish — Gate 3 is not justified yet.** An **unresolved
visibility ambiguity** remains: export candidates were **enabled (`few`)** but
**zero registered as visible (`none`)**, so **`hasActionableExportCandidate` is
`false`**, and the **DOM hydration wait timed out** — i.e. the page may have been
read before it settled, and the old visibility test relied on `offsetParent` alone
(a false-negative for fixed/portaled controls). Until a genuinely **actionable,
visible** export control is confirmed no-click, **no supervised Gate-3 capture is
warranted.**

**Refinement applied (visibility slice, no live run):** the classifier (a) waits on a
**bounded DOM-stability poll** (element-count stable across N samples) in addition to
`networkidle`, and (b) decides candidate visibility with a **robust cross-check**
(`offsetParent` OR client-rects OR non-zero box, AND not `display:none` /
`visibility:hidden`, AND not `disabled` / `aria-disabled`) folded by the pure
`esm-export-visibility.ts`, surfacing `actionableExportCandidateCount`.

## Gate 2 result — second live no-click re-run (sanitized)

A second human-attended `classify-esm-review` run (after the visibility refinement)
completed safely — same no-click / no-download / no-upload / no-API / no-DB /
no-capability-change discipline. Sanitized findings only:

| Signal | Value | vs. run 1 |
|--------|-------|-----------|
| DOM-settle | `stable-no-networkidle` | was hydration **timeout** |
| `sessionVerdict` | `LOGGED_IN` | same |
| `manageFeedbackRouteLike` / `reviewRouteLike` | `true` / `true` | same |
| `excelLike` / `downloadLike` | `true` / `true` | same |
| `asyncMarkerPresent` | `false` | same |
| `iframeCount` / `frameUrlCategories` | `one` / `[seller-center]` | same |
| `exportCandidateCount` / `enabledExportCandidateCount` | `few` / `few` | same |
| `visibleExportCandidateCount` | `none` | same |
| `actionableExportCandidateCount` | `none` | (new field) |
| `hasActionableExportCandidate` | `false` | same |
| `exportLayoutHint` | `SYNC_LIKELY` | same |

**Hydration timeout is RULED OUT.** The bounded DOM-stability poll **settled**
(`stable-no-networkidle`) — the page was read after the SPA stopped mutating. The
visibility ambiguity nonetheless **persists** under the robust cross-check, so it is
**not** a timing artifact: the top-document keyword matches are genuinely not laid out.

**Actionable export control remains UNCONFIRMED. Gate 3 is still not justified.**

**New hypothesis — same-origin iframe scan gap.** There is exactly **one same-origin
(`seller-center`) iframe**, and the candidate scan inspected the **top document only**;
the actionable export control may live **inside that iframe**, unseen.

**Refinement applied (frame-aware slice, no live run):** the classifier now scans the
top document **plus each same-origin child frame** read-only (`esm-frame-scan.ts` +
`scanFramesForExport`), keeping the scopes **separate** and emitting only sanitized
buckets/categories — per-scope candidate buckets, `frameUrlCategories`, a
`skippedFrameCount` bucket (cross-origin / inaccessible frames are skipped, never
entered), an aggregate `hasActionableExportCandidate`, and `actionableScope`
(`top-document` / `same-origin-frame` / `none`). A **re-run to test the iframe
hypothesis is a separately-approved Gate-2 step** — still `NEEDS_DISCOVERY`, nothing
CONFIRMED.

## Gate 2 result — third live no-click re-run (frame-aware, sanitized)

A third human-attended run (with the frame-aware scan) completed safely — same
no-click discipline. Sanitized findings only:

| Signal | Value |
|--------|-------|
| DOM-settle | `stable-no-networkidle` |
| top-document candidates | total `few` / visible `none` / enabled `few` / actionable `none` |
| `frameCount` | `few` (top + 1 child) |
| child frame | category `seller-center`, `readResult: skipped-cross-origin`, candidates `null` |
| `skippedFrameCount` | `one` |
| aggregate `hasActionableExportCandidate` | `false` |
| `actionableScope` | `none` |

**Decisive finding — the review iframe is CROSS-ORIGIN.** The single child frame
categorizes as `seller-center` but resolves to a **different origin than the top
document** (same vendor, different subdomain), so the same-origin-only scan correctly
recorded it as `skipped-cross-origin` and **did not enter it**. The top-document
keyword matches stay enabled-but-not-actionable across all three runs — almost
certainly the outer-shell menu/decoy controls. So the actionable export control is
**most plausibly inside that cross-origin ESM-family iframe**, which is unscanned by
the same-origin policy. **Gate 3 remains BLOCKED** — no actionable control confirmed
in any scanned scope.

**Refinement applied (allowlist slice, no live run):** the frame scan now admits a
**cross-origin** child frame for a read-only scan **only** when its host is on an
explicit, operator-configured **ESM-family allowlist** (`frameHostAllowed` +
`ESM_FRAME_ORIGIN_ALLOWLIST`, hostnames such as `esmplus.com` matched by exact host or
dotted subdomain). It is **fail-closed**: an empty allowlist (default) reads **no**
cross-origin frame, exactly as before. Output adds a per-frame `allowlisted` boolean, an
`allowlistedFrameCount` bucket, an `actionableScope` value `allowlisted-frame`, and a
sanitized `allowlistConfigured` boolean — **raw hosts/origins are never logged or
emitted**, only the category + booleans/buckets. This crosses the same-origin line
**only** into operator-trusted first-party vendor origins, still strictly **no-click**.
A **re-run with the allowlist configured is a separately-approved Gate-2 step** — still
`NEEDS_DISCOVERY`, nothing CONFIRMED, Gate 3 still not justified.

## Gate 2 result — fourth live no-click re-run (allowlist active, sanitized)

A fourth human-attended run, with `ESM_FRAME_ORIGIN_ALLOWLIST` configured
(`allowlistConfigured: true`), completed safely — same no-click discipline.
Sanitized findings only:

| Signal | Value |
|--------|-------|
| `sessionVerdict` / `domSettle` | `LOGGED_IN` / `stable-no-networkidle` |
| `manageFeedbackRouteLike` | `true` |
| `asyncMarkerPresent` / `exportLayoutHint` | `false` / `SYNC_LIKELY` |
| top-document candidates | total `few` / visible `none` / enabled `few` / **actionable `none`** |
| `frameCount` / `skippedFrameCount` / `allowlistedFrameCount` | `few` / `none` / `one` |
| allowlisted frame | category `seller-center`, `readResult: read`, `allowlisted: true` |
| allowlisted frame candidates | total `one` / visible `one` / enabled `one` / **actionable `one`** |
| aggregate `hasActionableExportCandidate` | **`true`** |
| `actionableScope` | **`allowlisted-frame`** |

**The actionable export control is located in the `allowlisted-frame` scope.** The
cross-origin ESM-family vendor iframe — skipped in run #3 — was read read-only via the
allowlist, and inside it is **exactly one** actionable (visible AND enabled) export
control. **The top-document candidates are decoys** (`actionable: none` across all four
runs — outer-shell menu items, not the export button).

**Gate 2 objective is MET.** An actionable, visible export control was located
**no-click**. The visibility / scope ambiguity that blocked Gate 3 is resolved.

**Gate 3 is justified to DESIGN — but has NOT started** (no code, no live run, no click
in this slice). REVIEW remains `NEEDS_DISCOVERY`; locating a control is **not**
capability confirmation — the capture → schema → ingest path (Gates 3–4) is still ahead.

## Gate 3 design — supervised approved-index single capture (DESIGN ONLY)

> **Design posture, not execution.** Nothing below is built or run in this slice. The
> Gate-3 code slice and any Gate-3 live run are each **separately approved**. ESM+
> REVIEW stays `NEEDS_DISCOVERY`; nothing is CONFIRMED by this design.

**Shape.** Mirror the NAVER supervised approved-index precedent
(`review-usage-confirm.ts` + `export-click-diagnose.ts` + `review-download-save.ts`),
adapted to the **cross-origin allowlisted frame** that run #4 found. The operator runs a
gated CLI under the ESM approval flag, the human logs in and reaches the review surface,
the tool scans the **allowlisted frame** for export/consent candidates and prints
**sanitized indexed candidate metadata** (index + coarse category + visible/enabled
booleans — never raw text). The operator passes an explicit `--approved-index`; the tool
re-scans (single source of index numbering), validates the chosen candidate is still
present/visible/enabled **on this run**, and fires **exactly one** click bound to that
single element. The fired download is observed and discarded.

**Hard invariants (carried from NAVER, extended for ESM):**

- **Cross-origin allowlisted-frame aware** — the click targets the candidate inside the
  allowlisted vendor frame (run #4 scope); the frame is re-confirmed allowlisted +
  readable immediately before acting.
- **Exactly one human-approved candidate index**, **exactly one click**, bound to a
  single element (`count() === 1` guard). **No auto-repeat. No broad/loop selector
  clicking. No fallback clicking** of other candidates.
- **No credential typing; no CAPTCHA / 2FA bypass** — the human authenticates.
- **No DB write**, **no status / `LAST_SUCCESS` write**, **no scheduler / manualSync**.
- **No upload in Gate 3** unless separately approved (Gate 4).
- **Observe-and-discard.** Save the fired download to the gitignored quarantine, run
  **structural file validation only** (OOXML/ZIP magic sniff + extension category — the
  existing `review-download-save.ts`), then **delete-after-validate** in a `finally`.
- **No raw filename in logs** (salted-hash basename only). **No row parsing.** **No
  review text / product / customer / seller identifiers** logged or emitted — sanitized
  buckets / categories / booleans only.

**Gate 3 must handle (each a recorded sanitized outcome, several are stop conditions):**

- **Consent / usage prompt** appears before download → surface it as a sanitized
  candidate (category only); require an explicit approved index for it too; never
  auto-accept.
- **Sync vs async** — run #4 says `SYNC_LIKELY`, but treat **async / unknown** as a
  **stop condition**: if the click yields a job/queue affordance instead of a download,
  record `async-observed` and stop (no polling, no second action).
- **Download timeout** → record `download-timeout`, stop, no retry.
- **No download event** after the click → record `no-download-event`, stop (no retry, no
  second click).
- **Multiple candidates** at the approved index scope → refuse without clicking
  (`ambiguous-candidates`); the operator must re-approve a single index.
- **Candidate disappears / not actionable** on the confirming re-scan → refuse without
  clicking (`candidate-gone`).
- **Frame no longer allowlisted / readable** (origin changed, detached) → refuse without
  clicking (`frame-unavailable`).
- **Downloaded file not xlsx/csv** (magic sniff fails) → record `unrecognized-format`,
  delete, stop — never parse, never upload.
- **Any PII-bearing page/file risk** → the file is quarantined, never opened/parsed, and
  deleted after the structural sniff; no page content is logged.

**Gate 3 success (all must hold):**

1. exactly **one approved click fired**;
2. exactly **one file observed**;
3. the file **structurally validates** as xlsx/csv (magic sniff only);
4. the file is **deleted after validation**;
5. only a **sanitized capture summary** is emitted (booleans / buckets / categories);
6. **no upload**;
7. **no schema / dedup-key claims** are made.

**Gate 3 non-goals (explicitly out of scope):** not upload; not parse rows; not infer
column schema; not confirm the dedup key; not mark ESM+ REVIEW `CONFIRMED`; not enable
scheduled collection. Those belong to Gate 4 and a later product decision.

## Gate 3 result — supervised approved-index single capture (2026-06-30)

> One human-attended live run under explicit per-run approval. Observe-and-discard:
> exactly one approved click, one download, structural validation only, then delete.
> Sanitized summary only — booleans / categories / buckets / a salted-hash basename;
> no raw URL / frame URL / host / origin / DOM text / selector / filename / identifier.

**Gate 3 objective is MET.** A single supervised approved-index click yielded **one
structurally-valid `.xlsx` download**, which was **deleted after validation**.

| gate / observation | value |
|---|---|
| `sessionVerdict` | `LOGGED_IN` |
| `actionableScope` | `allowlisted-frame` (one read frame, candidate actionable `one`) |
| top-document candidates | actionable `none` (decoys) |
| `approvedIndex` | `0`, bound uniquely (`count() === 1`) |
| consent prompt | none |
| `clickedCount` | **1** (exactly one click) |
| `postClickOutcome` | `download-fired` (exactly one download observed) |
| `fileStructure` / `savedExtensionCategory` | `xlsx-valid` / `xlsx` |
| `xlsxReadable` | `true` (structural OOXML/ZIP magic sniff — no cell read) |
| `fileSizeBucket` | `small` |
| basename | `savedBasenameHash` only (no raw filename) |
| `workbookContentValidation` | `deferred` |
| `rawCellLeak` / `fileRetained` | `false` / `false` |
| `retentionPolicy` | `delete-after-validate` (quarantine folder empty after the run) |
| `uploaded` / `rowsParsed` / `schemaInferred` / `dedupKeyClaimed` | `false` / `false` / `false` / `false` |

**What this establishes:** the allowlisted-frame export control located in Gate 2
(run #4) does, on one supervised click, produce a single structurally-valid xlsx
download end-to-end. **No upload, no row parsing, no schema inference, and no dedup
claim occurred.**

**What this does NOT establish:** the file's **contents / schema** are unread, so this
**does not confirm ESM+ REVIEW capability**. Locating + capturing a file is not
ingestion. **REVIEW remains `NEEDS_DISCOVERY`; nothing is CONFIRMED.** Gate 4 (schema
discovery) is now justified to **design**.

## Gate 4 design — workbook schema discovery (DESIGN ONLY)

> **Design posture, not execution.** Nothing below is built or run. The Gate-4 code
> slice and any Gate-4 live/offline run are each **separately approved**. ESM+ REVIEW
> stays `NEEDS_DISCOVERY`; nothing is CONFIRMED by this design.

**Objective.** **Schema discovery only** — determine the workbook's *structure* (sheets,
header row, column shape) safely enough to plan a future normalizer, **without** reading
or logging any row content. This is the bridge between "a valid file exists" (Gate 3) and
a future ingest decision — it does **not** itself ingest.

**Hard invariants:**

- **Inspect workbook structure safely** — open the (quarantined) xlsx read-only to read
  sheet/column *shape*; **no row text is ever logged**; the file stays observe-and-discard
  (delete after inspection), exactly as Gate 3.
- **No customer / product / seller / review identifiers** in logs or output — ever.
- **Column headers** may be summarized **only** as sanitized categories or hashed /
  header-count metadata (e.g. "N columns; header row present; a date-like / rating-like /
  text-like column appears") — the **raw header strings are not emitted** unless explicitly
  approved in a later step.
- **Candidate-field identification, not mapping** — identify *candidate* columns for
  review id, date, rating, product, content, and reply/status, but **do not claim any
  field mapping until verified**. Every candidate is provisional / `NEEDS_VERIFICATION`.
- **Dedup key stays `NEEDS_VERIFICATION`** — Gate 4 does not confirm it.
- **No upload, no DB ingest, no status / scheduler / manualSync, no backend capability
  change.** **No `CONFIRMED` capability.**

**Gate 4 non-goals:** not ingest; not normalize for real; not confirm field mappings or
the dedup key; not mark ESM+ REVIEW `CONFIRMED`; not enable scheduled collection. Those
remain a later, separately-approved product decision.

## Gate 4 implementation — schema-shape inspector (built locally, NOT yet run on a real file)

> The Gate-4 design above is now **implemented offline**. It has **not** been executed
> against a real ESM+ export. Sanitized schema-shape only; no real-file run, no ingest.

**What exists locally (offline, dependency-free):**

- a **pure schema-shape summariser** — categorises + salt-hashes header strings, derives
  the row bucket, lists dedup candidates, and collects risk tokens;
- a **dependency-free xlsx reader** — opens the ZIP, inflates only the structural parts
  via Node's built-in `zlib`, and reads **sheet/row/column shape + the header row only**
  (it never reads a data-row cell); adds **no dependency** (`package.json`/lock unchanged);
- an **offline CLI** (`inspect-esm-review-xlsx`) that takes an **explicit local xlsx path**
  (`--xlsx <path>`) and prints the sanitized summary.

**Behaviour / invariants (enforced by tests):**

- **Offline-only** — launches no browser; no click / download / upload / API / DB / status
  write / scheduler / `manualSync`; no backend capability change.
- **Reads structure + the header row only** — never reads or emits a data-row cell value.
- **Raw headers are never printed** — header metadata is **hash + candidate category** only.
- **Risk-first categorisation** — buyer / order / contact / author-like headers are flagged
  as a sanitized risk (`pii-like-header-present`) and never emitted raw.
- **Candidate-only** — dedup-key candidates are candidates; `dedupKeyConfirmed: false` and
  `schemaMappingConfirmed: false` always. No field mapping is claimed.
- **No raw path / filename / identifier** is ever logged.
- Tests green: `typecheck` clean, `npm test` 1561 passed / 1 skipped, `git diff --check` clean.

**Not yet run on a real file — and why.** The Gate 3 capture is **observe-and-discard**, so
it **deleted** its downloaded xlsx after structural validation; no real ESM+ workbook is
retained on disk. A real Gate-4 schema-shape run therefore needs **either** a separately
approved **capture → inspect → delete** flow (capture a file, inspect its shape, delete it
in the same supervised run) **or** a quarantined test xlsx supplied for offline inspection.
Both are **separately approved** and **not started here**.

**Status unchanged.** The inspector's output is **sanitized schema-shape only**; no upload,
DB ingest, row parsing, schema confirmation, or dedup confirmation occurs. **REVIEW remains
`NEEDS_DISCOVERY`; nothing is CONFIRMED.** Gate 4 *real execution* is a separate, approved
step that has not been taken.

## Gate 4 capture→inspect→delete wiring — implemented locally, NOT yet live-run

> The "either a capture→inspect→delete flow **or** a quarantined test xlsx" choice noted
> above is now resolved on the code side: the **capture→inspect→delete** path is wired
> into the existing Gate 3 capture CLI as an **opt-in** flag. It is **implemented and
> green offline**, but has **not** been run live. The live run is intentionally deferred
> until the ESM+ IP/environment is stable for live testing.

**What was wired (offline, green):**

- `capture-esm-review` gained an **opt-in** `--inspect-schema-shape` flag. Without the
  flag, the existing Gate 3 path is **byte-for-byte preserved**.
- The shared save module's `saveAndInspectDownload<R>` now accepts a **generic pre-delete
  `inspectFn`** hook. It runs **only after** the structural xlsx validation passes, and
  **before** the delete-in-`finally`, surfacing an optional sanitized `inspection`.
- Under the flag, `inspectFn` is `summarizeSchemaShape(readWorkbookShape(path), salt)` —
  the same Gate-4 offline inspector — so the captured file's **schema shape** is read
  once, in-frame of the same supervised run, then the file is deleted.
- `deleteFailed: boolean` is now **observable** (the cleanup result is surfaced, not
  silently assumed); a failed cleanup stops with `delete-failed`, and a flagged-but-
  unreadable workbook stops with `schema-inspect-failed` (both fail-closed).
- The shared save module stays **parser-free and ESM-decoupled** (no xlsx parser, no
  `esm-review-*` import in it — the generic `R` keeps it decoupled).

**Invariants preserved (source-guarded by tests):**

- **Exactly one** click path and **one** download wait remain (Gate 3 unchanged).
- Sanitized output only — schema-shape booleans / buckets / hash+category header meta;
  no raw header, cell, path, filename, URL, or identifier.
- Honest non-goal markers held: `schemaMappingConfirmed: false`, `dedupKeyConfirmed: false`,
  `uploaded: false`, `rowsParsed: false`, `schemaInferred: false`, `dedupKeyClaimed: false`,
  `fileRetained: false`.
- No upload / DB / status write / scheduler / `manualSync` on the new path.
- Tests green: `typecheck` clean, `npm test` 1572 passed / 1 skipped, `git diff --check`
  clean; `package.json` / lock unchanged.

**Live run is deferred (by design).** ESM+ live work is paused while the current
IP/environment is not stable for live testing. The later live command will be:

```bash
npm run capture-esm-review -- --i-understand-this-opens-live-esm --approved-index 0 --inspect-schema-shape
```

That run **still requires separate explicit approval** (live browser, human login, one
click, one download, inspect-before-delete, observe-and-discard). It has **not** been
started here.

**Status unchanged.** The wiring is local code + tests only. **REVIEW remains
`NEEDS_DISCOVERY`; nothing is CONFIRMED.** *(Superseded by the live run below: the
`--inspect-schema-shape` path was executed live on 2026-06-30 — see the next section.
The capability status is unchanged regardless.)*

## Gate 4 result — first live capture→inspect→delete run (2026-06-30, schema-shape)

> One supervised, separately-approved live run on a stable IP/environment. Headed
> browser, human login/navigation, **one** click, **one** download, schema-shape
> inspected **before** the delete-in-`finally`, file deleted. Observe-and-discard;
> no ingest. **Read the caveat below before drawing any data conclusion.**

**Run outcome (sanitized):** `result: CAPTURED_VALID`, `stop: null`.

| signal | value |
|---|---|
| `sessionVerdict` | `LOGGED_IN` |
| `actionableScope` | `allowlisted-frame` (one allowlisted frame, top-document not actionable) |
| approved index | `0` — the single actionable export candidate; bound to exactly one element |
| `clickedCount` | `1` |
| `postClickOutcome` | `download-fired` |
| `fileStructure` / `savedExtensionCategory` | `xlsx-valid` / `xlsx` |
| `fileSizeBucket` | `small` |
| `schemaShapeInspected` | `true` |
| `deleteFailed` / `fileRetained` | `false` / `false` (`retentionPolicy: delete-after-validate`) |
| `rawCellLeak` | `false` |
| `uploaded` / `rowsParsed` / `schemaInferred` / `dedupKeyClaimed` | all `false` |

**Sanitized schema-shape (structure + header row only — no cell values):**

| field | value |
|---|---|
| `workbookReadable` | `true` |
| `sheetCount` / `selectedSheetIndex` | `1` / `0` |
| `rowCountBucket` | `one` *(see caveat — likely the header-only/empty-result shape)* |
| `columnCount` / `headerCount` | `14` / `14` |
| header category tally | reviewText ×3, orderOrBuyerRisk ×3, product ×2, reviewDate ×2, replyStatus ×1, rating ×1, unknown ×2 |
| `reviewIdCandidate` | `false` |
| `candidateDedupFields` | `[]` |
| `risks` | `pii-like-header-present`, `no-dedup-key-candidate` |
| `rawCellLeak` | `false` |
| `schemaMappingConfirmed` / `dedupKeyConfirmed` | `false` / `false` |

**⚠️ Operator caveat — this is an empty-result / header-only export.** The page/filter
was set to **today's reviews**, and **no reviews matched that filter**. The downloaded
xlsx therefore most likely represents an **empty-result (header-only) export**, not a
populated one. Consequently:

- **Do not** read `rowCountBucket: one` as "one review row" — it reflects the export's
  header/placeholder shape under an empty filter, not one populated review.
- **Do not** conclude a final dedup strategy from this run.
- The **`no-dedup-key-candidate`** finding is a **header-level signal from an empty-result
  export**, not a populated-data confirmation. A stable review-ID column could still
  appear (or be confirmable) once real rows are present.
- A **separately approved populated schema-shape run** is needed, with a date filter/range
  **known to contain at least one review**, before any dedup conclusion.

**What the run *did* establish (transport/structure only):** the export path works
end-to-end through the allowlisted vendor frame — one supervised click yields a
structurally valid 14-column `.xlsx`, and the offline schema-shape inspector reads its
header shape and deletes the file, all inside one supervised run. **What it did NOT
establish:** any populated-data shape, any field mapping, or any dedup key.

**Status unchanged.** No upload, no row parsing, no schema-mapping confirmation, no
dedup-key confirmation, no DB / status / `LAST_SUCCESS` / scheduler write. **REVIEW
remains `NEEDS_DISCOVERY`; nothing is CONFIRMED.**

### Next step — Gate 4b populated schema-shape run (separately approved) — DONE 2026-06-30

> **Executed 2026-06-30** under separate per-run approval — see the result section below.
> The plan it described is unchanged; this note is retained for context.

A single supervised capture→inspect→delete run against a **populated** export, to turn
the header-only signals above into a populated-data shape:

- the **operator manually sets a safe date range/filter known to contain at least one
  review** (volume kept minimal);
- **no raw review / customer / product / order values** are reported — sanitized
  booleans / buckets / hash+category header meta only;
- **one** capture→inspect→delete run (one click, one download, delete-after-validate);
- **header-only inspection is unchanged** — the inspector still reads sheet/row/column
  shape **plus the header row only**, never a data-row cell;
- **no upload / DB / status / scheduler / `manualSync`**;
- **dedup stays `NEEDS_VERIFICATION`** until separately verified on populated data;
- **REVIEW remains `NEEDS_DISCOVERY`; nothing CONFIRMED.**

This run requires its own explicit per-run approval (live browser, human login). It has
**not** been started here.

## Gate 4b result — first populated capture→inspect→delete run (2026-06-30, schema-shape)

> One supervised, separately-approved live run on a stable IP/environment. The operator
> **manually set a date range/filter known to contain at least one review**; headed
> browser, human login/navigation/filtering, **one** approved-index click, **one**
> download, schema-shape inspected **before** the delete-in-`finally`, file deleted.
> Observe-and-discard; **no row/cell values were read or reported**; no ingest.

**Run outcome (sanitized):** `result: CAPTURED_VALID`, `stop: null`.

| signal | value |
|---|---|
| `sessionVerdict` | `LOGGED_IN` |
| `actionableScope` | `allowlisted-frame` (one allowlisted frame; top-document not actionable) |
| approved index | `0` — the single actionable export candidate; bound to exactly one element |
| `clickedCount` | `1` |
| `postClickOutcome` | `download-fired` |
| `fileStructure` / `savedExtensionCategory` | `xlsx-valid` / `xlsx` |
| `fileSizeBucket` | `small` |
| `schemaShapeInspected` | `true` |
| `deleteFailed` / `fileRetained` | `false` / `false` (`retentionPolicy: delete-after-validate`) |
| `rawCellLeak` | `false` |
| `uploaded` / `rowsParsed` / `schemaInferred` / `dedupKeyClaimed` | all `false` |

`downloads/esm-diagnostic` was re-verified **empty** after the run (file deleted; sentinel
auto-removed). No DB / status / `LAST_SUCCESS` / scheduler / `manualSync` write occurred.

**Sanitized schema-shape (structure + header row only — no cell values):**

| field | value |
|---|---|
| `workbookReadable` | `true` |
| `sheetCount` / `selectedSheetIndex` | `1` / `0` |
| `rowCountBucket` | **`few`** *(populated — at least one review row present)* |
| `columnCount` / `headerCount` | `14` / `14` |
| header category tally | reviewText ×3, orderOrBuyerRisk ×3, product ×2, reviewDate ×2, replyStatus ×1, rating ×1, unknown ×2 |
| `categoryPresence` | reviewDate ✓, rating ✓, product ✓, reviewText ✓, replyStatus ✓, orderOrBuyerRisk ✓, unknown ✓ — **reviewIdCandidate: false** |
| `candidateDedupFields` | `[]` |
| `risks` | `pii-like-header-present`, `no-dedup-key-candidate` |
| `rawCellLeak` | `false` |
| `schemaMappingConfirmed` / `dedupKeyConfirmed` | `false` / `false` |

### Sanitized comparison — empty-result run vs. populated run

| sanitized field | empty-result run (today's-reviews, none matched) | **Gate 4b populated run** |
|---|---|---|
| `rowCountBucket` | `one` *(header-only/empty shape)* | **`few`** *(real rows present)* |
| `columnCount` / `headerCount` | `14` / `14` | `14` / `14` |
| header category tally | reviewText ×3 · orderOrBuyerRisk ×3 · product ×2 · reviewDate ×2 · replyStatus ×1 · rating ×1 · unknown ×2 | **identical** |
| header hashes (per column) | (14 hashes) | **identical** |
| `categoryPresence` | reviewId `false`; date/rating/product/text/replyStatus/orderOrBuyerRisk/unknown `true` | **identical** |
| `candidateDedupFields` | `[]` | `[]` |
| `risks` | `pii-like-header-present`, `no-dedup-key-candidate` | **identical** |

**The only material shape change was `rowCountBucket` `one` → `few`.** Column count, the
full header category tally, **every header hash**, `categoryPresence`, and `risks` are
**identical** across the two runs → the **export layout is stable** between an empty-result
and a populated export.

### Dedup implication (signal, NOT a confirmed strategy)

- **No obvious stable review-ID / dedup-key column was detected even on the populated
  export** — `reviewIdCandidate: false` and `candidateDedupFields: []` hold on real rows,
  not just the empty-result shape. This is a **stronger** signal than the empty run, but
  it is **still not** a final dedup strategy.
- **Implication for future ingest:** a single-column natural key is unlikely; ingest will
  **probably need a composite dedup strategy**.
- **Candidate components (sanitized, unconfirmed):** a composite key may be derivable from
  the **date / product / rating / review-text / reply-status**-derived header categories
  already observed — but **no row/cell values may be logged**, no field mapping is claimed,
  and **no dedup strategy is confirmed**. These are candidate categories only.
- **Dedup remains `NEEDS_VERIFICATION`.** Confirming any composite key requires a separate,
  offline strategy-design pass (below) — not a live run.

### Next step — offline dedup-strategy design — DONE 2026-06-30

> **Drafted 2026-06-30** as a linked design doc:
> [`esmplus-review-dedup-strategy-design.md`](./esmplus-review-dedup-strategy-design.md).
> Offline, category-level reasoning only; produces **candidate** composite keys (L1/L2/L3),
> privacy rules, and a verification plan. **Dedup stays `NEEDS_VERIFICATION`; nothing
> CONFIRMED.** The discovery-vs-product-storage data policy it relies on is in
> [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md) (Policy A = binding
> discovery no-raw; Policy B = future raw review-text storage under consent/retention).

- **Offline only** — reason about a composite dedup key from the **sanitized header-shape
  categories** already captured; **no live browser**, no new capture.
- **No upload / DB / status / scheduler / `manualSync`.**
- **No row/cell logging** — design works from category/shape signals, never values.
- Produces a **candidate** composite-key design; **dedup stays `NEEDS_VERIFICATION`** and
  **no capability is CONFIRMED** until separately verified.

**Status unchanged.** No upload, row parsing, schema-mapping confirmation, or dedup-key
confirmation occurred. **REVIEW remains `NEEDS_DISCOVERY`; nothing is CONFIRMED.**

### Next step — Gate 5 minimal row-shape analyser design — DONE 2026-06-30

> **Drafted 2026-06-30** as a linked design doc:
> [`esmplus-review-row-shape-design.md`](./esmplus-review-row-shape-design.md) (slice 2 of
> the approved Gate 5 plan). Designs the **minimal-row analyser** that reads the first N
> data rows and reduces each cell to sanitized signals (presence / value-class / salted
> hash / per-column distinctness) to evaluate the L1/L2/L3 dedup candidates and test the
> "no stable ID" assumption at the row level. Reuses the dependency-free xlsx reader
> (extended to first-N rows) and the schema-shape sanitiser primitives; a new pure
> `esm-review-row-shape.ts` sibling does the analysis.

- **Offline design only** — no code in this slice; slice 3 implements it with synthetic
  fixtures, slice 4 runs it live behind a new opt-in `--probe-row-shape` flag.
- **No upload / DB / status / scheduler / `manualSync`**, no live browser.
- **No raw row/cell values** in output — hashes / buckets / categories only (Policy A).
- **Dedup stays `NEEDS_VERIFICATION`; REVIEW stays `NEEDS_DISCOVERY`; nothing CONFIRMED.**

## Gate 5 result — first live row-shape probe run (2026-06-30, populated)

> One supervised, separately-approved live run on a stable IP/environment (slice 4B of
> the approved Gate 5 plan). The operator **manually set a date range/filter known to
> contain reviews**; headed browser, human login/navigation/filtering, **one** approved-
> index click, **one** download, then — before the delete-in-`finally` — both the Gate-4
> **schema-shape** and the Gate-5 **minimal row-shape** were inspected on the first **3**
> data rows (`--row-sample-rows=3`), and the file was deleted. Observe-and-discard;
> **no raw row/cell/header values were read or reported**; no ingest. This is the first
> time the dormant `--probe-row-shape` flag was exercised against a real populated export.

**Run outcome (sanitized):** `result: CAPTURED_VALID`, `stop: null`.

| signal | value |
|---|---|
| `sessionVerdict` | `LOGGED_IN` |
| `actionableScope` | `allowlisted-frame` (one allowlisted frame; top-document not actionable) |
| approved index | `0` — bound to exactly one element (`count() === 1`) |
| `clickedCount` | `1` |
| `postClickOutcome` | `download-fired` |
| `fileStructure` / `savedExtensionCategory` | `xlsx-valid` / `xlsx` |
| `fileSizeBucket` | `small` |
| `schemaShapeInspected` / `rowShapeProbed` / `minimalRowsInspected` | `true` / `true` / `true` |
| `deleteFailed` / `fileRetained` | `false` / `false` (`retentionPolicy: delete-after-validate`) |
| `rawCellLeak` | `false` |
| `uploaded` / `rowsParsed` / `schemaInferred` / `dedupKeyClaimed` | all `false` |

`downloads/esm-diagnostic` was re-verified **empty** after the run (file deleted; sentinel
auto-removed). No DB / status / `LAST_SUCCESS` / scheduler / `manualSync` write occurred.
The pre-existing `.status/naver.json` was **not** modified by this run.

**Schema-shape (this run):** `rowCountBucket: tens`, `columnCount/headerCount: 14`,
`reviewIdCandidate: false`, `candidateDedupFields: []`, `risks: pii-like-header-present,
no-dedup-key-candidate` — **identical column layout and header categories to the Gate 4 /
4b runs**, now on a larger (`tens`) populated set. Export layout remains stable.

**Sanitized minimal row-shape — 14 columns, `sampledRowBucket: few` (of `totalRowBucket:
tens`); per-column signals only, no cell values:**

| # | header category | `populated` | `valueClass` | `distinctness` | `enumLike` |
|---|---|---|---|---|---|
| 1 | replyStatusCandidate | all | text-short | all-same | yes |
| 2 | productCandidate | all | mixed | all-distinct | no |
| 3 | ratingCandidate | all | numeric-small | some-distinct | yes |
| 4 | reviewTextCandidate | all | text-short | all-distinct | no |
| 5 | reviewTextCandidate | none | empty | n/a | no |
| 6 | unknown | all | numeric-small | all-same | yes |
| 7 | productCandidate | all | numeric-long | all-distinct | no |
| 8 | orderOrBuyerRiskCandidate *(PII)* | all | numeric-long | all-distinct | no |
| 9 | orderOrBuyerRiskCandidate *(PII)* | all | text-short | all-distinct | no |
| 10 | orderOrBuyerRiskCandidate *(PII)* | all | id-like | all-same | no |
| 11 | unknown | all | date-like | all-distinct | no |
| 12 | reviewDateCandidate | all | date-like | all-distinct | no |
| 13 | reviewDateCandidate | none | empty | n/a | no |
| 14 | reviewTextCandidate | all | text-short | some-distinct | yes |

*(The three PII `orderOrBuyerRiskCandidate` columns emit **no value hashes** by design;
all other columns emit salted per-cell hashes only — never raw values. Hashes are omitted
from this doc.)*

**Analyser dedup feasibility (signal, NOT confirmation):** `l1Feasible: true`,
`l2Feasible: true`, `l3Only: false`, `idColumnSuspected: false`, `notes: []`.

### What this populated row-shape establishes (sanitized)

- **No latent stable review-ID surfaced on real rows.** `idColumnSuspected: false`, and
  `reviewIdCandidate: false` holds at the **row** level, not just the header/empty shape.
  The two `unknown` columns resolved to a **constant** `numeric-small` (col 6, all-same,
  enum-like) and a `date-like` value (col 11, all-distinct) — neither is a unique id key.
  The only `id-like` *valueClass* sits on a **PII** `orderOrBuyerRiskCandidate` column
  (col 10) and is **`all-same`** (not distinct), so it is **not** a usable per-review id.
  This **strengthens Gate 4b's no-stable-id finding with populated row-shape evidence** —
  the composite-key direction remains the working direction.
- **Candidate component signals (sanitized, unconfirmed) for a composite key:**
  - **product** — strong: two columns, one `mixed`/all-distinct (col 2) and one
    `numeric-long`/all-distinct (col 7, looks like a product code);
  - **date** — present: `reviewDateCandidate` `date-like`/all-distinct (col 12); a second
    date column (col 13) was empty;
  - **reviewText** — present: `reviewTextCandidate` `text-short`/all-distinct (col 4); two
    other text columns were empty (col 5) or `some-distinct` (col 14);
  - **rating** — present: `ratingCandidate` `numeric-small`/some-distinct/enum-like (col 3).
  These are **candidate categories with usable distinctness**, not a chosen key or a field
  mapping.

### What it does NOT establish

- **No cross-export uniqueness/stability** — a single export cannot prove a composite key
  is stable or collision-free across exports. That is the next slice (two-export overlap
  validation), not this run.
- **No field mapping, no schema confirmation, no dedup-key confirmation.**
  `schemaMappingConfirmed: false`, `dedupKeyConfirmed: false`, `dedupKeyClaimed: false`.

**Status unchanged.** No upload, row parsing into records, schema-mapping confirmation, or
dedup-key confirmation occurred. **REVIEW remains `NEEDS_DISCOVERY`; dedup remains
`NEEDS_VERIFICATION`; nothing is CONFIRMED.** The probe surfaced a plausible composite-
component set (product + date + reviewText + rating) with usable distinctness on real rows
and no single stable id — the precondition a future **two-export overlap validation** slice
needs, which is **separately approved and not started here**.

## Gate 5 Slice 5B result — live two-export overlap validation (2026-07-01)

> Two **separately-approved**, supervised live captures on a stable IP/environment, over
> operator-set **overlapping** REVIEW date/filter ranges (Export A = wider, Export B =
> overlapping subset), followed by the **offline** `compare-esm-overlap` comparator. Each
> capture: headed browser, human login/navigation/filtering, **one** approved-index click,
> **one** download, then — before the delete-in-`finally` — schema-shape + minimal row-shape +
> the Slice-5A **composite dedup keys** were emitted on the first **3** rows
> (`--row-sample-rows=3`), and the file was deleted. This is the first live use of the dormant
> `--emit-composite-key` flag. Observe-and-discard; **no raw row/cell/header values were read or
> reported**; no ingest. `STORAGE_PROBE_SALT` was byte-identical across A and B (the
> comparability precondition); `ESM_STORE_FINGERPRINT` was **explicitly waived**, so this
> validates **same-store** A/B overlap only — **not** multi-store production namespacing.

**Capture outcome (sanitized) — both `result: CAPTURED_VALID`, `stop: null`:**

| signal | Export A | Export B |
|---|---|---|
| `sessionVerdict` | `LOGGED_IN` | `LOGGED_IN` |
| approved index / `clicked` | `0` (bound `count() === 1`) / `1` | `0` (bound `count() === 1`) / `1` |
| `postClickOutcome` | `download-fired` | `download-fired` |
| `fileStructure` / `xlsxReadable` | `xlsx-valid` / `true` | `xlsx-valid` / `true` |
| `schemaShapeInspected` / `rowShapeProbed` / `compositeKeyEmitted` | `true` / `true` / `true` | `true` / `true` / `true` |
| identity slots (reviewDate, product, rating, reviewText) | all set | all set |
| `totalRowBucket` | `tens` | `few` |
| `storeFingerprintApplied` | `false` *(single-store waiver)* | `false` *(single-store waiver)* |
| `rawCellLeak` / `fileRetained` / `deleteFailed` | `false` / `false` / `false` | `false` / `false` / `false` |
| `uploaded` / `rowsParsed` / `schemaInferred` / `dedupKeyClaimed` | all `false` | all `false` |

Both composite-key sets excluded the same categories from identity —
`replyStatusCandidate`, `orderOrBuyerRiskCandidate` *(PII)*, `unknown` — with the four
identity slots (date / product / rating / reviewText) populated on every sampled row.
`downloads/esm-diagnostic` was re-verified **empty** after each run (files deleted, sentinels
auto-removed); the sanitized scratch JSONs were deleted after the compare. No DB / status /
`LAST_SUCCESS` / scheduler / `manualSync` write occurred; `git status` showed only untracked
`tools/`.

**Offline comparator verdict (sanitized; `compare-esm-overlap`):**

| field | value |
|---|---|
| `comparable` / `channelMatch` / `slotProvenanceMatch` / `excludedCategoriesMatch` | `true` / `true` / `true` / `true` |
| L1 (strong) — `overlap` / `matchRate` / `falseMerge` | `few` / `ALL` / `ZERO` |
| L2 (fallback) — `overlap` / `matchRate` / `falseMerge` | `few` / `ALL` / `ZERO` |
| L3 (weak) — `overlap` / `matchRate` / `falseMerge` | `few` / `ALL` / `ZERO` |
| `replyStatusExcludedFromIdentity` | `true` |
| `risks` | `[]` (none) |
| `dedupKeyConfirmed` / `schemaMappingConfirmed` | `false` / `false` |

### What this two-export overlap establishes (sanitized)

- **This strengthens the composite-key direction with real two-export overlap evidence.**
  **Same-review → same-key was observed at L1/L2/L3 within the sampled overlap** (`matchRate:
  ALL` at every level), and **no false-merge was observed in-sample** (`falseMerge: ZERO`,
  including the text-bearing L1). Provenance/exclusion/channel all matched with no `risks`.
- **replyStatus remained excluded from identity** (`replyStatusExcludedFromIdentity: true`), and
  **PII / order / buyer / contact-like categories remained excluded from identity** — the key
  is composed from date / product / rating / reviewText only.

### What it does NOT establish

- **Does not confirm the dedup key** (`dedupKeyConfirmed: false`) and **does not confirm schema
  mapping** (`schemaMappingConfirmed: false`).
- **Does not prove uniqueness at scale** — the sampled overlap is small (`few` rows per export);
  it bounds, not proves, collision behaviour on large populations, edited reviews, or
  non-adjacent windows.
- **Does not validate multi-store namespace behaviour** — the store fingerprint was waived
  (`storeFingerprintApplied: false`), so cross-store key separation is untested here.

**Status unchanged.** No upload, row parsing into records, schema-mapping confirmation, or
dedup-key confirmation occurred. **REVIEW remains `NEEDS_DISCOVERY`; dedup remains
`NEEDS_VERIFICATION`; nothing is CONFIRMED.** This satisfies a first in-sample pass of the
dedup design's **overlap-duplicate check**
([`esmplus-review-dedup-strategy-design.md`](./esmplus-review-dedup-strategy-design.md) §5.3);
the **repeatability gate** (§5.4 — repeated overlapping exports incl. a `replyStatus`-changed
case, larger sample, and a multi-store fingerprinted run) remains open.

## Keep-open session-TTL probe — result (2026-06-29, no-click)

> Local-only characterization, not a capability claim. One persistent context kept
> open across four no-click reads; never clicked, downloaded, uploaded, or wrote
> status. Sanitized rows persisted to the gitignored `.status/esm-session-ttl-probe.jsonl`.

A single logged-in ESM+ context with periodic no-click activity was read at **T0,
T+120m, T+190m, and T+240m**. Every checkpoint:

| signal | T0 / T+120m / T+190m / T+240m |
|---|---|
| `sessionVerdict` | **`LOGGED_IN`** at all four |
| `actionableScope` | `allowlisted-frame` at all four |
| `hasActionableExportCandidate` | `true` at all four |
| `allowlistedFrameCount` / `skippedFrameCount` | `one` / `none` |
| `exportLayoutHint` / `asyncMarkerPresent` | `SYNC_LIKELY` / `false` |
| `stop` | `null` (never expired) |

**What this shows:** a kept-open ESM+ browser context with light periodic no-click
reads stayed usable **past the documented ~3h boundary and through 4h** — the session
did not expire mid-window, and the export control stayed locatable throughout. This
supports the product hypothesis that a **keep-open connector worker on a ~2-hour
internal sync cadence is viable**.

**What this does NOT show (still open):**

- It does **not** prove repeated **download/capture** stability (no click ever fired).
- It does **not** prove **restart / cold-context** persistence (one continuous process;
  reopening the profile has separately been observed to often require re-login).
- It does **not** characterize an **idle** session (each checkpoint did light activity);
  absolute-vs-idle-timeout is not disambiguated by this single keep-open run.
- ESM+ REVIEW stays `NEEDS_DISCOVERY`; nothing is CONFIRMED.

## Product design note — separate sync cadence from report schedule

The TTL result motivates a clean split (design posture, not built):

- **Internal connector sync** — default **every ~2 hours**, for data freshness and to
  keep the authenticated session warm. This is the only thing tied to the browser export
  cadence.
- **User report / dashboard schedule** — a **user-chosen** reporting time, generated from
  the **latest successfully synced DB snapshot**. It is *decoupled* from the export
  cadence: the report reads stored data, it does not drive a live export.
- **Dashboard surface** — show `lastSyncedAt`, `nextSyncAt`, `syncStatus`, and
  `reconnectRequired` when applicable, so freshness and any reconnect need are visible
  without conflating "when my report runs" with "when the browser exports".

Hard line: the user-facing report time is **not** the same thing as the browser export
cadence. Conflating them would couple report delivery to live-session health.

## Next development direction — Gate 3 live capture validation (separately approved)

The TTL result clears the session-continuity question that motivated keeping a worker
open; the next unknown is whether a **single supervised capture** actually fires and
yields a structurally valid file. Scope when approved (already designed above):

- one supervised **approved-index** click; one download;
- **structural validation only** (magic sniff), **delete-after-validate**;
- **no upload**, **no row parsing**, **no schema / dedup claims**, **no CONFIRMED**
  capability.

Gate 3 live capture is **not** started here and requires its own explicit per-run
approval in a stable environment (user-owned test seller account).

## Standing constraints for this track

- No ESM+ review collection is implemented yet. **Four human-attended, read-only
  no-click classifier runs** have occurred (Gate 2 above); **no click, no download,
  and no upload have ever happened**, and no upload path is enabled. Gate 3 is
  **designed but not started** — no supervised click has occurred.
- Cross-origin frames are read **only** when on the operator-configured ESM-family
  allowlist (`ESM_FRAME_ORIGIN_ALLOWLIST`), which is **fail-closed** (empty → none) and
  reaches only trusted first-party vendor origins; raw hosts/origins are never emitted.
- Every live gate (1–4) requires explicit per-run operator approval in a stable
  environment; user-owned **test** seller account only.
- Human performs all login / 2FA / CAPTCHA; the collector never types
  credentials and never bypasses auth, exactly as `collector/CLAUDE.md` §4.
- Sanitized signals only — categories / booleans / coarse buckets; never raw
  content, identifiers, tokens, raw URLs / HTML / screenshots, exact counts, or
  raw timestamps.
- ESM+ REVIEW capability stays unchanged and **not CONFIRMED** through this whole
  ladder; this doc is design posture, not a capability claim.

## Out of scope (now)

ESM+ INQUIRY / ORDER / CLAIM (deferred API-first track) · live ESM API calls ·
credentials / seller IDs / Master ID / API key / JWT · browser automation ·
clicks · downloads · uploads · backend · DB · scheduler / manualSync ·
capability change · RUN_INTEGRATION. NAVER live work is separately **paused**.
