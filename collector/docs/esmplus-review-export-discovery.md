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
triggering it. **Status: IMPLEMENTED + RAN ONCE (sanitized).** The classifier
(`src/cli/classify-esm-review.ts` + pure `src/esm/esm-review-probe.ts`) ran once
under human-attended login and corroborated the surface; one visibility ambiguity
remains open (see "Gate 2 result" below). REVIEW stays `NEEDS_DISCOVERY`.

### Gate 3 — supervised approved-index single capture
Only after Gate 2 confirms the layout. Reuse the NAVER **supervised
approved-index** pattern: locate the review-usage/consent prompt (if any),
operator passes an explicit `--approved-index`, and **exactly one**
human-approved click fires a download — observe-and-discard via the
format-agnostic `review-download-save.ts` (OOXML/ZIP magic sniff, no cell
parsing, delete-after-validate). No auto-repeat, no upload yet. **Status:
`NEEDS_DISCOVERY`. Depends on Gates 1–2.**

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

**Refinement applied this slice (no live run):** the classifier now (a) waits on a
**bounded DOM-stability poll** (element-count stable across N samples) in addition
to `networkidle`, and (b) decides candidate visibility with a **robust cross-check**
(`offsetParent` OR client-rects OR non-zero box, AND not `display:none` /
`visibility:hidden`, AND not `disabled` / `aria-disabled`) folded by the pure
`esm-export-visibility.ts`, surfacing a new `actionableExportCandidateCount`. A
**re-run to confirm whether the ambiguity resolves is a separately-approved Gate-2
step** — still `NEEDS_DISCOVERY`, nothing CONFIRMED.

## Standing constraints for this track

- No ESM+ review collection is implemented yet. Exactly **one human-attended,
  read-only no-click classifier run** has occurred (Gate 2 above); **no click, no
  download, and no upload have ever happened**, and no upload path is enabled.
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
