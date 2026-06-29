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
(`src/cli/classify-esm-review.ts` + pure `src/esm/esm-review-probe.ts` +
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
