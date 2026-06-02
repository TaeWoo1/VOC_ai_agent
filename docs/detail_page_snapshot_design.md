# `detail_page_snapshot` design (read + plan only)

**Ticket**: C-001 (design only). Implementation lands in C-002.
**Status**: proposal.
**Author role**: implementation agent.
**Date**: 2026-05-07.

This document defines the per-run **product detail page (PDP) snapshot**
artifact that captures the OliveYoung product detail page state at the
moment of collection. It is consumed by (a) the seller PDF v3, (b) the
review_ops package index, and (c) downstream re-render / audit tooling.

This file is design-only. **No code is changed by C-001.** C-002
implements the schema, the writer, the manifest wiring, the renderer
fallback, and the test suite enumerated in §10.

---

## 1. Purpose & scope

### What problem the snapshot solves

Today, the seller report and the review_ops package index claim three
storefront-truth numbers — `public_review_count`, `average_rating`, and
the implied `rating_distribution` — but the pipeline only ever holds
those numbers **as derived from the rows we managed to scrape**. Three
gaps follow:

1. **Public-vs-collected mismatch is invisible.** A run can ship with
   `n_reviews_total=441` while the OliveYoung PDP itself displays a
   public review count of 6,912 (Needly Daily Toner Pad case in
   `outputs/2026-05-05_needly-daily-toner-pad_run-001/`). Operators
   need both numbers, side-by-side, to reason about the report's
   coverage.
2. **Brand / product / option metadata is reconstructed downstream.**
   `brand_name` is currently `null` in `review_ops_analysis.json`
   because nothing on the collection side lifts it from the PDP DOM
   into a structured slot. Each consumer (PDF cover, cardnews cover,
   review_ops index) reaches for slightly different fields and
   silently degrades.
3. **No durable evidence of "what the page looked like at capture
   time."** When a brand operator audits the report 3 months later
   and the PDP has changed (price, option set, review count), there
   is no in-run snapshot to anchor the discussion.

The snapshot fixes all three by writing one JSON file per run that
records the PDP state observed by the connector during the warm
session, plus the capture method and provenance.

### What this is NOT trying to solve

- Not a full HTML archive. The snapshot stores **structured fields**,
  not raw HTML. Anti-bot risk and storage cost rule out keeping the
  full DOM at rest.
- Not a longitudinal store. Cross-run trend (price drift, review-count
  growth) is computed by the **already-existing** `phase2e_snapshots`
  module under `data/phase2e_snapshots/`. C-002 does not duplicate that
  layer; it produces a **per-run** capture only. A future ticket can
  index detail snapshots across runs if needed.
- Not a Coupang capability. The Coupang path is CSV-only
  (`src/voc/connectors/coupang_csv.py:1` "no live Coupang scraper
  exists in this codebase"). Snapshot is OY-only for C-002.
- Not a substitute for `EvidenceUnit`. Per CLAUDE.md §10, evidence
  spans must remain `parent_review.text[char_start:char_end]`.
  Snapshot fields never become evidence quotes.

---

## 2. Current state (grounded findings)

### 2.1 What the manifest already reserves

Manifest schema is `1.2`
(`src/voc/content/manifest.py:51` `MANIFEST_SCHEMA_VERSION = "1.2"`).
The `provenance` block already contains a `snapshot` slot, currently
filled with a Phase A scaffold value:

```json
"provenance": {
  "corpus_provenance": { "status": "skipped", "path": null, ... },
  "snapshot":         { "status": "skipped", "path": null, "notes": "Phase A scaffold: snapshot not registered yet" },
  "comparability":    { "status": "skipped", "path": null, ... }
}
```

Source: `src/voc/content/manifest.py:292-297` iterates the three keys
verbatim. Every run dir under `outputs/2026-05-*/` carries this
slot — concrete examples:
`outputs/2026-05-05_needly-daily-toner-pad_run-001/manifest.json:117-122`
and `outputs/2026-05-05_espoir-bevelvet-cushion_run-001/manifest.json:110-115`.

C-002 wires the writer so this slot transitions from `skipped` to
`ok` (or `failed`) without touching the schema name.

### 2.2 What the connector already captures during the warm session

`src/voc/connectors/oliveyoung_browser_api.py` already pulls the
following PDP fields *in passing* during the initial `page.goto`,
**before** the review-tab click. They are surfaced via getters on
the `_PlaywrightReviewSession`:

- **og:image** → `get_observed_product_image_url()` →
  `last_run_summary.product_image_url`
  (lines 1939–1958 — "v2.4.3 product-image-URL capture (additive)").
- **PDP page_url at capture time** →
  `product_image_capture_page_url` (line 1983).
- **html_length** → `product_image_capture_html_length` (line 1984).
- **og / jsonld / twitter / link image / oy-thumbnail counts** —
  the diagnostic record (lines 1985–1993) used to debug image-URL
  capture.
- **breadcrumb** → `get_observed_breadcrumb()` →
  `raw_metadata.oy_breadcrumb_ko` / `oy_category_path` /
  `oy_category_leaf_ko` / `oy_breadcrumb_source`
  (lines 2041–2067).
- **total review count** → `get_observed_total_review_count()` →
  `last_run_summary.total_review_count_available` (lines 1921–1937).
  This is **the very field** that the PDF surfaces as the
  public-vs-collected denominator
  (`scripts/generate_phase2e_pdf_v2.py:2336` reads
  `provenance.total_review_count_available`).

So the **harvest layer already exists**. C-002 is mostly plumbing —
collect what the connector already sees, plus three additions
(brand, product display name from the PDP, average rating from the
PDP), and write it to one well-known place.

### 2.3 What the analysis layer carries

`analysis_report.json` v3.0 (per `from_phase2e.py:875` adapter) keeps
the following product-side fields that overlap with — but are not the
same as — what a snapshot would carry:

- `product.source_url`, `product.image_url`, `product.image_source`,
  `product.raw_product_name`, `product.display_product_name`,
  `product.offer_context`, `product.promo_context`,
  `product.report_title`, `product.selected_profile_id`,
  `product.suppressed_attributes`.
- `corpus.n_reviews_analyzed`, `corpus.n_reviews_total` — these are
  **collected counts**, not the PDP-displayed public count.

The split is intentional: analysis_report owns the *analysed corpus*,
the snapshot owns the *page-as-displayed*. Both can disagree, and
that disagreement is the operator-relevant information.

### 2.4 What the review_ops index already reads

`scripts/build_review_ops_package_index.py:202-227` reads:

- `product.brand_name`, `product.header_title`,
  `product.display_product_name`, `product.name_ko`,
  `product.raw_product_name`, `product.selected_profile_id` from
  `review_ops_analysis.json` then `analysis_report.json`.
- `metrics.total_reviews`, `metrics.average_rating` from
  `review_ops_analysis.json` (computed from collected reviews, not
  the PDP).

`brand_name` is currently always `null` in
`review_ops_analysis.json` (verified at
`outputs/2026-05-05_needly-daily-toner-pad_run-001/shared/review_ops_analysis.json:11`).
There is no DOM scrape for brand today.

### 2.5 What `republish_run.py` and `inspect_run_quality.py` consume

- `republish_run.py:144` reads `analysis_report.product` /
  `analysis_report.corpus`; line 346 patches `manifest.collection.*`.
  It does NOT read `manifest.provenance.snapshot` today.
- `inspect_run_quality.py:106-128` reads `manifest.product` first,
  then `analysis_report.product`, with a one-line drift warning when
  they disagree on `selected_profile_id`. No snapshot consumption.

Neither script crashes on a missing snapshot today (they don't look
for it), so adding the snapshot is a **strictly additive** change.

---

## 3. Schema

### 3.1 File location & manifest slot

- Path inside the run dir:
  `shared/provenance/detail_page_snapshot.json`
- Manifest slot: `provenance.snapshot` (existing key, status flips
  from `"skipped"` → `"ok"` or `"failed"`).
- Schema version: `detail_page_snapshot.v1`. Future bumps namespaced
  under the same prefix.
- Encoding: UTF-8, NFC-normalized for Korean strings (matches
  `CanonicalReview` content fingerprinting per CLAUDE.md §10).

### 3.2 Top-level shape

```jsonc
{
  "schema_version": "detail_page_snapshot.v1",
  "captured_at": "2026-05-06T02:06:16Z",
  "capture_method": "oliveyoung_browser_api_warm_session",
  "capture_status": "ok",        // ok | partial | failed
  "channel": "oliveyoung",
  "source_url": "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000225053",
  "goods_no": "A000000225053",
  "page_url_at_capture": "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000225053",
  "html_length": 71548,

  "product_name": {
    "raw":     "[1위 패드] 니들리 데일리 토너 패드 80매 + 20매 OY단독",
    "display": "니들리 데일리 토너 패드",
    "source":  "og_title"        // og_title | jsonld | dom_h1 | derived
  },
  "brand_name": {
    "value":  "needly",
    "source": "jsonld_brand"     // jsonld_brand | dom_breadcrumb | dom_anchor | null
  },
  "category_path": ["뷰티", "스킨케어", "패드"],

  "public_review_count":  6912,
  "average_rating":       4.78,
  "rating_distribution": {
    "1": 0.012,   // share, sums to ≤ 1.0 within float tolerance; null if absent
    "2": 0.005,
    "3": 0.014,
    "4": 0.058,
    "5": 0.911,
    "source": "dom_rating_summary"
  },

  "options": [
    {"label": "80매 + 20매 OY단독", "is_default": true, "raw_index": 0},
    {"label": "200매 기획",          "is_default": false, "raw_index": 1}
  ],

  "image": {
    "url":         "https://image.oliveyoung.co.kr/cfimages/.../A00000022505304ko.jpg?l=ko",
    "selected_source": "og_image",
    "local_path":  "assets/A000000225053.jpg",
    "og_count":       1,
    "jsonld_count":   0,
    "twitter_count":  1,
    "link_image_src_count":  0,
    "oy_thumbnail_img_count": 4
  },

  "limitations": [
    "rating_distribution: dom_rating_summary not present in observed HTML; fields null"
  ],

  "browser_provenance": {
    "user_agent":              "Mozilla/5.0 (Macintosh; ...) Chrome/120.0.0.0 Safari/537.36",
    "connected_via_cdp":       true,
    "session_class":           "_PlaywrightReviewSession",
    "session_id":              4482656176,
    "requested_cdp_endpoint":  "http://127.0.0.1:9222",
    "received_cdp_endpoint":   "http://127.0.0.1:9222"
  }
}
```

### 3.3 Field-by-field commentary, provenance, and edge cases

#### `schema_version` (required, string)
Frozen literal `"detail_page_snapshot.v1"`. Future minor changes
within v1 are additive (new optional fields). A breaking change
bumps to v2.

#### `captured_at` (required, ISO-8601 UTC string)
Wall-clock UTC at the moment the warm session finished its initial
`page.goto`. Format: `YYYY-MM-DDTHH:MM:SSZ` (no fractional seconds,
matches the `manifest.run_started_at` format at
`outputs/2026-05-05_needly-daily-toner-pad_run-001/manifest.json:4`).
Used by review_ops to compute "freshness" (snapshot age vs report
read time).

#### `capture_method` (required, string enum)
One of:
- `"oliveyoung_browser_api_warm_session"` — the only legal value in
  C-002. Future channels add literals (`"coupang_pdp_html"`, etc.).
- `"manual"` — operator-supplied (NOT in C-002 scope).

#### `capture_status` (required, string enum)
- `"ok"` — every required PDP field above was captured.
- `"partial"` — some required fields are null (e.g. PDP loaded but
  rating distribution DOM was absent). The keys present are still
  honored; missing ones are `null`. This is the dominant real-world
  case — see §5.
- `"failed"` — connector exception or anti-bot block; the manifest
  slot is `"failed"` and the renderer falls through.

When `capture_status == "failed"`, the snapshot file may still be
written with only `schema_version`, `captured_at`, `capture_method`,
`capture_status`, `source_url`, and `limitations` populated (the
rest `null`). This keeps the audit trail honest without leaking
half-fabricated data.

#### `channel` (required, string)
Always `"oliveyoung"` in C-002. Reserved for future expansion.

#### `source_url` (required, string)
The OliveYoung PDP URL passed to `--product-url`. Verbatim, no
normalization. Type: HTTPS URL string.

#### `goods_no` (required, string)
The OliveYoung product code, e.g. `"A000000225053"`. Extracted from
`source_url` via the same parse the existing pipeline uses
(`run_phase2e_pipeline.py` already derives `goods_no` for manifest
naming). The snapshot writer must NOT re-derive a different value;
on mismatch, `capture_status` becomes `"failed"`.

Edge case: a CSV-only run (Coupang) would write a snapshot with
`channel="coupang"`, `goods_no=null`, `capture_method="csv_replay"`
— but **C-002 deliberately skips writing a snapshot for non-OY
channels** (see §9 out-of-scope).

#### `page_url_at_capture` (optional, string | null)
The `window.location.href` Playwright observed when the diagnostic
ran. Often equal to `source_url`, but differs after redirects
(legacy `goodsNo` paths sometimes 302 to a current ID). Source:
`product_image_capture_diagnostic.page_url` already produced by
the connector (line 1983).

#### `html_length` (optional, integer | null)
`len(page.content())` snapshot, in characters. Already captured at
`product_image_capture_diagnostic.html_length` (line 1984). Useful
for "did the page load fully?" sanity (a normal OY PDP is ~70k–90k
chars; <10k is suspicious).

#### `product_name` (required, object)
Three fields:
- `raw` — the og:title or `<h1>` text, untrimmed of promo brackets.
  E.g. `"[1위 패드] 니들리 데일리 토너 패드 80매 + 20매 OY단독"`.
- `display` — the same text after running through
  `src.voc.content.product_name_normalizer.normalize_product_name()`
  (CLAUDE.md §6 protected; the snapshot writer **imports and calls**,
  it does **not** re-implement). The result is the cleaned headline,
  e.g. `"니들리 데일리 토너 패드"`.
- `source` — one of `"og_title"`, `"jsonld"`, `"dom_h1"`, `"derived"`.
  Records which channel produced `raw`.

Edge case: og:title and `<h1>` disagree → prefer og:title (matches
how the connector already prefers og:image), record `source="og_title"`.

#### `brand_name` (optional, object | null)
Two fields:
- `value` — string, e.g. `"needly"` or `"NEEDLY"`. NOT lowercased; we
  preserve casing.
- `source` — `"jsonld_brand"` (preferred), `"dom_breadcrumb"`,
  `"dom_anchor"` (the brand link element on the PDP), or `null` when
  not found.

When no source yields a value, the whole `brand_name` object is
`null` (not `{"value": null, "source": null}`). Rationale: keeps the
JSON small and forces consumer code to do an explicit `is None`
check.

#### `category_path` (optional, array of strings | null)
The breadcrumb as a path, e.g. `["뷰티", "스킨케어", "패드"]`. The
connector **already** captures this via
`get_observed_breadcrumb()`; the snapshot writer reads from the
existing `oy_category_path` raw_metadata field (line 2062). When the
breadcrumb scan failed silently, this is `null`.

Edge case: legacy single-string form `"뷰티 > 스킨케어 > 패드"` is
re-split via `parse_breadcrumb_text()` (already exported at line 703)
before being stored. Storage form is **always the list**.

#### `public_review_count` (optional, integer | null)
The PDP's displayed total review count, e.g. `6912`. Source:
already-captured `last_run_summary.total_review_count_available`
(line 1933). Distinct from `analysis_report.corpus.n_reviews_total`
(which is `441` for the same run because RATING_ASC failed). The
discrepancy is a **report-relevant signal**, not a bug.

Edge case: PDP shows "6,912개" — strip commas + suffix, parse to
`int`. On parse failure, `null` and add an entry to `limitations`.

#### `average_rating` (optional, float | null)
The PDP's displayed average rating, e.g. `4.78`. Range `[0.0, 5.0]`,
two decimal places preserved. Source: PDP rating-summary block
(currently NOT captured by the connector; C-002 adds the
`get_observed_average_rating()` getter on the session).

Edge case: PDP shows "4.8" → store as `4.80` (preserve precision the
PDP actually shows; never round up). On parse failure, `null` +
limitations entry.

#### `rating_distribution` (optional, object | null)
Five share floats keyed by `"1"`–`"5"`, plus a `source` string. The
shares are the per-star *fractions* the PDP reports (some PDPs show
counts; the writer divides by `public_review_count` to get shares).
Sum of shares is `≤ 1.0` within `1e-3` float tolerance.

When the PDP doesn't expose the distribution (the most common case
in current OY DOM), the **whole object is `null`** and a limitations
entry is added. Per-key fallbacks (e.g. `"1": null, "2": 0.005, ...`)
are forbidden — rating distribution is all-or-nothing to keep
downstream renderers simple.

`source`: `"dom_rating_summary"` is the only value in C-002.

#### `options` (optional, array | null)
The product-option / variant list as it appears in the PDP option
selector. Each entry:
- `label` (string) — verbatim option text, e.g.
  `"80매 + 20매 OY단독"`.
- `is_default` (bool) — whether this is the option pre-selected when
  the PDP loads.
- `raw_index` (integer) — 0-indexed position in the option dropdown,
  for stability when labels collide.

Empty array `[]` means "PDP loaded but had no option selector"
(rare). `null` means "did not attempt to capture options"
(C-002 default — option capture is **stretch goal**, see §9).

#### `image` (optional, object | null)
Mirrors what `last_run_summary.product_image_*` already records.
Required keys when present: `url`, `selected_source`. The five `*_count`
keys come from the existing image-capture diagnostic and are useful
for debugging "why did og_image win over jsonld?". `local_path` is
the run-relative path under `assets/` set by the orchestrator's
image-fetch step (already populated in
`outputs/2026-05-05_needly-daily-toner-pad_run-001/shared/product_metadata.json:7`).

#### `captured_at` invariant
Format MUST match the regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.
No fractional seconds, no offset other than `Z`. Test
`test_captured_at_iso_8601_utc_z_invariant` enforces this (§10).

#### `capture_method` (read above; included for the 11-field
matrix in question 4)
Always one of the literals enumerated above. Test asserts the
literal set is closed.

#### `limitations` (required, array of strings)
Operator-readable, not machine-parsed. Empty array is legal when
`capture_status == "ok"`. Examples:
- `"rating_distribution: dom_rating_summary not present in observed HTML; fields null"`
- `"average_rating: parse failed for displayed text '4.8 / 5.0' — stored null"`
- `"brand_name: jsonld_brand absent and dom_anchor not detected"`
- `"options: capture not implemented in C-002"`

Korean strings are acceptable; encoding NFC-normalized.

#### `browser_provenance` (optional, object | null)
Mirrors the already-captured CDP/UA telemetry from
`product_image_capture_diagnostic` (lines 1996–2004). When the
connector ran without diagnostic capture (e.g. a unit-test fake
session), this is `null`.

### 3.4 Field-provenance matrix (operator's question 3)

| Field | Provenance |
|---|---|
| `schema_version` | constant in writer |
| `captured_at` | wall-clock UTC at end of warm session's `page.goto` |
| `capture_method` | constant per writer |
| `capture_status` | derived from completeness of captured fields |
| `channel` | derived from connector (`"oliveyoung"` in C-002) |
| `source_url` | CLI input (`--product-url`) |
| `goods_no` | parsed from `source_url`; cross-checked against connector `goodsNo` |
| `page_url_at_capture` | connector — `product_image_capture_diagnostic.page_url` |
| `html_length` | connector — `product_image_capture_diagnostic.html_length` |
| `product_name.raw` | connector — og:title (new getter) |
| `product_name.display` | post-hoc — `product_name_normalizer.normalize_product_name(raw)["display_product_name"]` |
| `product_name.source` | connector — selection log |
| `brand_name.value` | connector — JSON-LD `brand` field or breadcrumb (new getter) |
| `brand_name.source` | connector — selection log |
| `category_path` | connector — `oy_category_path` raw_metadata (existing) |
| `public_review_count` | connector — `total_review_count_available` (existing) |
| `average_rating` | connector — DOM rating summary (new getter) |
| `rating_distribution` | connector — DOM rating summary (new getter) |
| `options` | connector — option selector DOM scan (stretch; default `null`) |
| `image.*` | connector — `last_run_summary.product_image_*` (existing) |
| `limitations` | derived during writer post-pass |
| `browser_provenance.*` | connector — `product_image_capture_diagnostic` (existing) |

---

## 4. Production point

### 4.1 Where in the pipeline

The snapshot is produced by **the seller pipeline (`run_phase2e_pipeline.py`)**
during the same warm Playwright session that already runs collection.
The order:

```
run_all.py
  └─ run_phase2e_pipeline.py
       ├─ build_manifest(...)                 [unchanged]
       ├─ run_scraper(manifest)               [unchanged: hits OY]
       │      └─ oliveyoung_browser_api.fetch_reviews()
       │           └─ session.open()          [warm goto — captures PDP fields]
       │
       │   *** NEW (C-002): ***
       │   build_detail_page_snapshot(
       │       session=session,
       │       source_url=url,
       │       goods_no=goods_no,
       │   )  →  shared/provenance/detail_page_snapshot.json
       │   manifest_records['snapshot'] = ArtifactRecord(status="ok"|"partial"|"failed", ...)
       │
       ├─ aggregate_product(...)              [unchanged]
       ├─ adapter productreportdata_to_analysis_report(...)
       └─ render_seller_business_report_v3(...)
```

The snapshot writer is invoked **inside the same connector run** so it
re-uses the already-loaded PDP HTML. No second `page.goto` — that
would double the anti-bot risk for zero benefit.

### 4.2 ASCII diagram

```
                              warm Playwright session
                              ┌────────────────────────────────────┐
URL ──► run_all ──► phase2e ─► open()  ─► PDP loaded                │
                              │   │                                 │
                              │   ├── og:image ──┐                  │
                              │   ├── og:title ──┤                  │
                              │   ├── jsonld ────┤                  │
                              │   ├── breadcrumb─┤                  │
                              │   ├── total cnt ─┤   (existing)     │
                              │   ├── rating sum─┤   (NEW C-002)    │
                              │   └── option list┘   (stretch)      │
                              │            │                        │
                              │   click review tab                  │
                              │   collect rows ...                  │
                              └────────────┬───────────────────────┘
                                           │
                                           ▼
                            build_detail_page_snapshot()  (new)
                                           │
                                           ▼
                            shared/provenance/detail_page_snapshot.json
                                           │
                                           ▼
                            manifest.provenance.snapshot.status = "ok"
                                           │
                                           ▼
                            v3 PDF cover  +  review_ops index  read it
```

### 4.3 Why not a separate `goto` after collection?

OliveYoung's anti-bot stack escalates on repeated PDP hits within a
short window (CLAUDE.md §9 "Anti-bot signals must escalate, not
retry"). The warm session already has the HTML in memory; we collect
the fields opportunistically, never with a second navigation.

---

## 5. Failure modes & isolation

CLAUDE.md memory item "Collection failures isolated" is binding:
non-essential asset fetches must fail-soft into a fallback; never
block report generation.

The snapshot writer must obey the same rule. Concretely:

| Failure mode | What the writer does | Pipeline impact |
|---|---|---|
| Connector raises during PDP load (anti-bot, network) | Writer catches `Exception`; emits `capture_status="failed"` JSON with empty fields + `limitations=["pdp_load_failed: <repr>"]` | None. Manifest slot becomes `"failed"`, analysis + PDF + cardnews all proceed. |
| og:title absent | `product_name.raw=null`, source=`"derived"`, fall back to `analysis_report.product.raw_product_name` semantics in the renderer | None. Snapshot still `partial` or `ok`. |
| Rating-summary DOM absent | `average_rating=null`, `rating_distribution=null`, append limitation | `partial`; renderer shows the analysis-side derived rating. |
| total_review_count_available is None | `public_review_count=null`, append limitation | `partial`; renderer shows only the collected count. |
| Snapshot **writer itself** raises | Caught at the phase2e level; manifest slot stays `"skipped"`; warning printed; pipeline continues | None. Test required (§10). |

**Hard rule**: under no failure mode does the writer raise upward. The
phase2e runner wraps the call in `try/except Exception` and logs.
This mirrors how `cardnews PNG render` and `review_ops companion`
are already handled in `run_all.py:855-897`.

---

## 6. Manifest integration

### 6.1 Slot

Existing slot, no schema bump required:

```json
"provenance": {
  "snapshot": {
    "status": "ok" | "partial" | "failed" | "skipped",
    "path":   "shared/provenance/detail_page_snapshot.json" | null,
    "sha256": "<hex>" | null,
    "bytes":  12345 | null,
    "notes":  "<short reason when not ok>"
  }
}
```

`status` widening from `{"ok","failed","skipped"}` to add `"partial"`
is **already supported** by `ArtifactRecord` (it accepts any string
via `to_dict()`); but to keep the existing
`_ALLOWED_STATUSES = ("ok","failed","skipped")` validator
(`src/voc/content/manifest.py:54`) honest we map `"partial"` to
`status="ok"` + a `notes` string `"capture_status=partial: ..."`.
This avoids a manifest schema bump.

Decision summary: **do not bump `MANIFEST_SCHEMA_VERSION` for C-002**.
The status set is unchanged; the snapshot's *internal* `capture_status`
field is where partial/ok/failed lives.

### 6.2 Path safety

`shared/provenance/detail_page_snapshot.json` matches the
`PROVENANCE_SUBDIR = "shared/provenance"` constant
(`src/voc/content/paths.py:45`) and the manifest's
`is_safe_relative_path` validator. No changes needed there.

---

## 7. Seller report integration

### 7.1 Sections that gain authority

The v3 PDF renderer
(`scripts/generate_phase2e_pdf_v2.py:render_seller_business_report_v3`,
line 6513) gains authority on three surfaces when the snapshot is
present:

#### Cover (`_br3_section_cover`, line 4031)
- **`display_product_name`** — TODAY reads
  `analysis_report.product.display_product_name` (line 4052).
  WHEN snapshot present: prefer `snapshot.product_name.display`;
  fall back to analysis_report. The two should agree, but the
  snapshot is the storefront truth.
- **`offer_context`** — unchanged; still adapter-derived.

#### Executive summary header / Key Metrics strip
- **Public review count line** — currently constructed from
  `provenance.total_review_count_available` only when the connector
  surfaced it (line 2336). WITH snapshot: read
  `snapshot.public_review_count` first, surface as
  `"공개 리뷰 {N:,}건 중 {analyzed:,}건 분석"`.
  WITHOUT snapshot: existing fallback (no public count, only
  collected count).

#### Methodology & Limitations (`_br3_section_methodology`)
- New paragraph: "캡처 시점 상품 페이지 정보" — lists
  `captured_at`, `public_review_count`, `average_rating`,
  `rating_distribution` (when present), and the `limitations` array.
  When the snapshot is absent, the paragraph is omitted entirely
  (no "snapshot: skipped" warning leaks to operators — it's an
  internal concern).

### 7.2 Fallback when snapshot is absent

Every consumer must do an explicit two-step:

1. Try `snapshot.<field>`. Snapshot may be missing entirely
   (`manifest.provenance.snapshot.status == "skipped"` or
   `"failed"`). When missing, the file does not exist on disk.
2. Fall back to the analysis-derived value (the existing path).

The renderer NEVER raises on missing snapshot. Test
`test_v3_renderer_runs_without_snapshot_present` (§10) enforces this.

### 7.3 Cardnews integration

Cardnews already reads `analysis_report.product` and
`analysis_report.corpus`. The snapshot is **not consumed by cardnews
in C-002** — cardnews is consumer-facing and the public-vs-collected
distinction is internal-operator-only. C-003+ may revisit.

---

## 8. Review_ops package index integration

### 8.1 Current shape

`scripts/build_review_ops_package_index.py` (lines 46–66, 197–250)
builds a `RunSummary` per run with: brand, product_name, profile_id,
total_reviews, average_rating, period, artifact paths, qa_status.
Output: `index.html`.

Today the index reads `metrics.average_rating` from
`review_ops_analysis.json` (which is computed from collected rows,
not the PDP). `brand_name` is `null` in every existing run because
nothing sets it.

### 8.2 Proposed shape after C-002

The index reader gains a snapshot-aware fallback chain:

```
brand_name        := snapshot.brand_name.value  ?? review_ops.product.brand_name
product_name      := snapshot.product_name.display  ?? review_ops.product.header_title  ?? analysis.product.display_product_name
public_reviews    := snapshot.public_review_count    (NEW column; nullable)
collected_reviews := analysis.corpus.n_reviews_total (existing total_reviews column)
storefront_rating := snapshot.average_rating         (NEW column; nullable)
collected_rating  := review_ops.metrics.average_rating (existing avg_rating column, possibly renamed in UI)
captured_at       := snapshot.captured_at            (NEW column → "freshness")
```

Index "freshness" semantic: if `captured_at` is older than the run's
`run_started_at` by more than 24h, surface a warning chip. (In
practice they are the same minute, but cross-run rebuilds may
re-use old snapshots.)

### 8.3 Backward compatibility

Pre-C-002 runs have no snapshot. The index reader must treat all
snapshot-derived columns as **optional** and render `"—"` when
missing. No batch re-render is required.

---

## 9. C-002 implementation contract

### 9.1 Proposed file list (paths + one-line purpose)

| Path | Purpose |
|---|---|
| `src/voc/reporting/phase2e/detail_page_snapshot.py` | New module. Pure builder: takes a connector session + URL + goods_no, returns a dict matching the schema. No I/O. |
| `src/voc/connectors/oliveyoung_browser_api.py` | Add 2–3 new getters: `get_observed_product_name_raw()`, `get_observed_brand_name()`, `get_observed_average_rating()` + optional `get_observed_rating_distribution()`. **Touches a file the agent role normally restricts** — wire-only, no detector / aggregator change. |
| `scripts/run_phase2e_pipeline.py` | Wire the writer call after `run_scraper(manifest)`, fail-soft try/except, manifest slot update. |
| `src/voc/content/manifest.py` | Add `snapshot_record` kwarg to `build_phase_a_manifest` (additive; unused kwarg defaults to None). No schema bump. |
| `scripts/generate_phase2e_pdf_v2.py` | Renderer fallback chain: prefer snapshot fields when present. Two-line edits in `_br3_section_cover`, the key-metrics strip, and methodology. |
| `scripts/build_review_ops_package_index.py` | Add snapshot fallback chain in `_summarize_run_dir`; add 2–3 columns to the HTML template. |
| `scripts/inspect_run_quality.py` | Read the snapshot when present; surface `capture_status`, drift between `goods_no` and `analysis_report.product.source_url`. |
| `tests/test_reporting/test_phase2e/test_detail_page_snapshot.py` | New file. Test cases per §10. |
| `tests/test_content/test_manifest_provenance_snapshot.py` | New file. Manifest slot regression test. |

### 9.2 Out of scope for C-002 (operator's question 8)

The first implementation deliberately does **not** do the following.
Each is a candidate for a follow-up ticket.

1. **Backfill snapshots into historical runs.** Pre-C-002 runs stay
   without a snapshot file. Renderer fallback handles that.
2. **Coupang detail-page capture.** Coupang is CSV-only today; no
   live PDP fetch path exists. A `coupang_pdp_html` capture method is
   reserved in the schema enum but not wired.
3. **Multi-language detail pages.** OliveYoung serves a single page
   per `goodsNo`; the `?l=ko` parameter is the only language we
   capture. Future: `?l=en` capture lands as additional records.
4. **Archival to S3 / external store.** The snapshot lives only in
   the run-package directory.
5. **Cross-run snapshot index.** A future CLI may walk
   `outputs/*/shared/provenance/detail_page_snapshot.json` to build
   a longitudinal time-series of public_review_count drift, but
   C-002 does not produce such an index.
6. **Option-selector DOM capture.** `options` field defaults to
   `null` in C-002. The schema reserves the shape for C-003+.
7. **Full HTML archive.** The snapshot stores structured fields, not
   raw HTML. Anti-bot risk + storage cost.
8. **Rating distribution share alternatives.** Some PDPs expose
   counts (`5★ 6,234건`); C-002 divides by `public_review_count`. If
   counts and distribution disagree, `rating_distribution=null` +
   limitations entry (no half-fabrication).
9. **Cross-run trend chart on the PDF.** The methodology section
   gains a static "captured_at" line; cross-run delta visualization
   is reserved for a later ticket.
10. **Cardnews snapshot consumption.** Buyer-facing surfaces stay on
    the analysis-derived numbers; the public-vs-collected gap is an
    operator concern, not a buyer concern.

---

## 10. Test plan

All tests listed below are **new**. Each names the file (already
listed in §9.1), the test name, and the behaviour it covers.

### 10.1 Schema & writer tests (in `test_detail_page_snapshot.py`)

1. **`test_snapshot_schema_v1_top_level_keys_locked`**
   Asserts the exact set of top-level keys the writer emits matches
   the §3.2 list. Locks the contract against silent drift.
   **Fixture**: a fake session that returns canned values for every
   getter.

2. **`test_capture_status_ok_when_all_required_fields_present`**
   With every getter returning a value, writer emits
   `capture_status="ok"` and `limitations=[]`.
   **Fixture**: full-coverage fake session.

3. **`test_capture_status_partial_when_rating_distribution_missing`**
   Getter for `rating_distribution` returns None →
   `capture_status="partial"`, `rating_distribution=null`,
   `limitations` contains the rating distribution string.
   **Fixture**: fake session with rating-distribution getter raising
   `AttributeError` (mirrors a session class without that method).

4. **`test_writer_never_raises_on_session_exception`**
   Every getter raises `RuntimeError("anti-bot")` →
   `build_detail_page_snapshot` returns a dict with
   `capture_status="failed"`, `limitations=[<repr of raise>]`. The
   call **does not propagate**.
   **Fixture**: fake session whose getters all raise.

5. **`test_captured_at_iso_8601_utc_z_invariant`**
   The emitted `captured_at` matches
   `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`. No fractional seconds,
   no offset other than `Z`.
   **Fixture**: monkeypatched `datetime.now(timezone.utc)`.

6. **`test_goods_no_consistency_between_snapshot_and_url`**
   `source_url` carrying `goodsNo=A000000225053` produces
   `goods_no="A000000225053"`. A mismatched explicit `goods_no` arg
   triggers `capture_status="failed"` with a limitation entry. No
   exception.
   **Fixture**: parameterized URL/goods_no pairs.

### 10.2 Pipeline integration (in `test_detail_page_snapshot.py`)

7. **`test_pipeline_writes_snapshot_to_provenance_subdir`**
   End-to-end with `--stub-llm` and a fake connector: file lands at
   `<run>/shared/provenance/detail_page_snapshot.json` and manifest
   `provenance.snapshot.status == "ok"`, `path` matches.
   **Fixture**: in-process phase2e invocation against a temp
   `--out-pdf` and stubbed `run_scraper`.

8. **`test_pipeline_continues_when_snapshot_writer_raises`**
   Patch `build_detail_page_snapshot` to raise. Pipeline still
   exits 0; manifest `provenance.snapshot.status == "skipped"`;
   PDF and analysis_report still written.
   **Fixture**: monkeypatched writer.

### 10.3 Renderer fallback (in `test_pdf_pass*.py` family)

9. **`test_v3_renderer_runs_without_snapshot_present`**
   `render_seller_business_report_v3` produces a PDF when the
   snapshot file does not exist. Cover shows the analysis-derived
   `display_product_name`. No KeyError, no FileNotFoundError.
   **Fixture**: existing fixture run dir with snapshot file deleted.

10. **`test_v3_renderer_prefers_snapshot_display_name_when_present`**
    With a snapshot whose `product_name.display="니들리 데일리 토너 패드"`
    and an analysis_report whose
    `product.display_product_name="needly_daily_toner_pad"`, the
    cover renders the snapshot-side name.
    **Fixture**: synthetic snapshot + synthetic analysis_report.

### 10.4 Manifest regression (in `test_manifest_provenance_snapshot.py`)

11. **`test_manifest_schema_version_unchanged_after_snapshot_landing`**
    `MANIFEST_SCHEMA_VERSION == "1.2"` still holds after C-002.
    Locks the no-schema-bump decision (§6).

12. **`test_provenance_snapshot_slot_validates_clean_when_partial`**
    A manifest where `provenance.snapshot.status="ok"` and the
    snapshot file's internal `capture_status="partial"` validates
    clean — the manifest validator does not look inside the
    snapshot file.

(Test count: 12. The operator asked for at least 6, with five
specific cases — every requested case is covered: shape (1, 2);
CDP failure (4, 8); partial capture (3); timestamp (5); goods_no
consistency (6); renderer fallback (9, 10).)

---

## 11. Risks (ranked by blast radius)

1. **CDP authentication / Chrome 147 incompatibility** —
   `oy_chrome_debug.py` already rejects Chrome 147 under
   `playwright_chromium`. The snapshot writer rides the same warm
   session; if the session never loads the PDP, snapshot is
   `failed` but pipeline survives.
   *Mitigation*: writer never raises; existing preflight handles
   the user-facing error.

2. **PDP DOM shape change (rating-summary block)** —
   OliveYoung occasionally re-styles the rating widget. The
   `get_observed_average_rating()` getter must use a tolerant
   selector chain (multiple CSS paths + a JSON-LD fallback).
   *Mitigation*: every parse-fail emits a limitations entry, never
   a stack trace; an integration test on a fixed HTML fixture
   guards the canonical case.

3. **Anti-bot escalation from over-aggressive DOM scraping** —
   Per CLAUDE.md §9, scraping changes must escalate, not retry.
   The snapshot adds NO new `goto`; it reads from the already-loaded
   page. But a poorly-written getter that does
   `page.eval('await fetch(...)')` could leak a network call.
   *Mitigation*: code review must reject any getter that issues a
   network request; only DOM/HTML-attribute reads are allowed.

4. **`product_name_normalizer` regression** — calling
   `normalize_product_name` from a new code path could expose a
   latent bug not caught by existing tests.
   *Mitigation*: snapshot writer treats `display` as best-effort;
   on normalizer exception, store `raw` and add a limitation.

5. **Manifest size growth** — the snapshot file is small (<5 KB
   typical) but the index builder reads N snapshots when building a
   batch index. For a 20-product batch, that is 100 KB total.
   Negligible, but noted.

---

## 12. Open questions

1. **Should the snapshot include the PDP's "지금 구매하기" / price
   field?** The PDP shows the active sales price at capture time,
   which is operator-relevant for "did the run capture happen during
   a promo?" reasoning. **Open for operator decision in C-002 dispatch.**
   Default in this design: NO — pricing introduces compliance
   considerations (consumer-facing pricing claims) we don't want to
   carry in the seller report without an explicit policy decision.

2. **Should `brand_name` be normalized (uppercased / casefold) for
   stable joins?** The review_ops index would benefit from a
   canonical form. Default in this design: NO — preserve the PDP
   casing; downstream joins do their own normalization.

3. **What does the writer do when a *legacy `goodsNo`* 302-redirects
   to a new ID?** `page_url_at_capture` will differ from
   `source_url`. The current design preserves both verbatim and
   does NOT flip the `goods_no` field. Operator confirmation
   needed: is "snapshot pinned to the legacy ID, but page-url
   shows the redirected ID" the correct shape, or should
   `goods_no` follow the redirect?

4. **Are we ever going to emit a snapshot for a `--skip-scrape`
   re-render?** A re-render run does not load the PDP. Default in
   this design: NO — `--skip-scrape` runs leave
   `provenance.snapshot.status="skipped"` with notes
   `"--skip-scrape; snapshot not refreshed"`. The previous run's
   snapshot remains on disk under the *previous* run dir.

---

## Appendix A — Imports section (illustrative)

Per CLAUDE.md §11 #9, all imports are absolute. The C-002 writer
module uses:

```python
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from src.voc.content.paths import PROVENANCE_SUBDIR
from src.voc.content.product_name_normalizer import normalize_product_name
from src.voc.content.manifest import ArtifactRecord, compute_sha256
```

No imports from `phase2e/{stage1,stage2,aggregate}.py`. No imports
from `phase1/signals.py`. The writer is a leaf module.
