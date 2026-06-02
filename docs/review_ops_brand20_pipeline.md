# review_ops Brand-20 Pilot Pipeline

End-to-end orchestration plan for running 20 brand SKUs through the existing
collection / analysis / reporting stack and bundling them into a single
review_ops pilot package.

This document is an **orchestration spec**, not new analysis logic. Every
stage below is already implemented; this doc just chains them in a
reproducible order.

## 1. Stage flow

```
seed CSV (configs/review_ops_brand20_seed.example.csv)
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 1 · Collection                                                 │
│   scripts/run_oy_collection_batch.py per source_url                  │
│   → outputs/<run_dir>/  (raw fetched, persisted to voc_data.db)      │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 2 · Base VOC analysis (Phase 2E)                               │
│   scripts/run_phase2e_pipeline.py per run_dir                        │
│   → outputs/<run_dir>/shared/analysis_report.json                    │
│   → outputs/<run_dir>/shared/collection_summary.json                 │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 3 · Seller PDF report (existing)                               │
│   scripts/generate_phase2e_pdf_v2.py (render_seller_business_report_v3) │
│   → outputs/<run_dir>/seller_report/seller_report_ko.pdf             │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 4 · Consumer cardnews (existing)                               │
│   cardnews/render.py via existing planner pipeline                   │
│   → outputs/<run_dir>/buyer_content/ko/buyer_journey_cardnews.json   │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 5 · review_ops companion report (this work)                    │
│   scripts/run_review_ops_batch.py --newest-per-product               │
│   → outputs/<run_dir>/shared/review_ops_analysis.json                │
│   → outputs/<run_dir>/review_ops/review_ops_report.html              │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 6 · Package index                                              │
│   scripts/build_review_ops_package_index.py                          │
│   → outputs/review_ops_brand20_<DATE>/index.html                     │
│     (indexes all 20 run_dirs with relative links to all artifacts)   │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 7 · QA scoring (manual + script-derived)                       │
│   - Structural QA: artifact completeness (ready/partial/missing)     │
│   - Content QA: 1–5 readiness rubric (manual reviewer pass)          │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Run directory structure (per SKU, after all stages)

```
outputs/<run_dir>/
├── manifest.json
├── shared/
│   ├── analysis_report.json              ← Stage 2 (base, required)
│   ├── collection_summary.json           ← Stage 2
│   └── review_ops_analysis.json          ← Stage 5
├── seller_report/
│   └── seller_report_ko.pdf              ← Stage 3
├── buyer_content/
│   └── ko/
│       └── buyer_journey_cardnews.json   ← Stage 4
└── review_ops/
    └── review_ops_report.html            ← Stage 5
```

## 3. Artifact expectations

### Base artifacts (existing pipeline)
- `shared/analysis_report.json` — canonical Phase 2E output. **Required**.
  Other stages depend on it.
- `seller_report/seller_report_ko.pdf` — Stage 3 output. May be missing if
  the seller PDF run failed; index marks "not found" but still publishes.
- `buyer_content/ko/buyer_journey_cardnews.json` — Stage 4 output. May be
  missing for older runs (pre-cardnews adapter); index marks "not found".

### review_ops artifacts (this work)
- `shared/review_ops_analysis.json` — Pydantic-validated v1 schema.
  Read by index for brand/metrics; falls back to `analysis_report.json`
  when missing.
- `review_ops/review_ops_report.html` — operator-facing HTML, single file
  with no external dependencies.

## 4. QA scoring

### Structural QA (script-derived, in package index)
- **ready**: all 5 artifacts present (analysis_report + seller PDF +
  cardnews JSON + review_ops HTML + review_ops JSON)
- **partial**: analysis_report present + at least one downstream missing
- **missing**: analysis_report itself missing (run_dir excluded from
  pilot or excluded from the index with a status note)

### Content QA (manual reviewer rubric, 1-5)
- **5** = send-as-is to friendly pilot
- **4** = send after 5-minute manual edit
- **3** = useful internally, not customer-facing yet
- **2** = needs another quality pass
- **1** = broken / do not use

The `note` column on the package index is a free-text reviewer field
backed by manual reading of the HTML.

## 5. Failure handling

- **Stage 1-4 failure for an individual SKU**: skip that SKU in the
  index with a "missing" status row (and a short error reason if
  available from manifest).
- **Stage 5 (review_ops) failure**: index still emits the row using
  whatever base artifacts exist; review_ops columns show "not generated".
  review_ops_batch CLI is fail-closed per-run, so a single SKU failure
  does not break the batch.
- **Pre-v2 adapter run_dirs** (no `display_product_name`): include with
  a note. `--require-display-name` filter at index step is a future
  small flag that would auto-exclude these.

## 6. In scope for this orchestration pass

- Seed CSV format + 7 example rows + 13 placeholder slots.
- Pipeline stage flow doc (this file).
- Package index build script (read-only, no side effects on run_dirs).
- QA status taxonomy for the index.

## 7. Out of scope (intentionally deferred)

- Wiring stages 1-4 into a single end-to-end CLI. Today each stage has
  its own script; the operator runs them in order. Combining into a
  single `run_brand20_full_pipeline.py` is a future task.
- Automated content QA scoring (1-5 rubric). Manual review remains the
  source of truth until we have a sample of 20-30 reports.
- Crawling product detail pages for landing-copy comparison. Section 6
  of the review_ops report still produces "candidate copy" — comparison
  with the brand's actual detail page is operator work.
- New analysis logic, schema changes, or additional clusters/profiles.

## 8. Operator runbook (per-pilot)

```bash
# 1) Prepare the seed.
cp configs/review_ops_brand20_seed.example.csv configs/brand20_run.csv
# (fill in 13 more rows in brand20_run.csv)

# 2) Stages 1-4: run per SKU using existing scripts. (Out of scope here.)
#    Each SKU produces an outputs/<run_dir>/ with shared/analysis_report.json.

# 3) Stage 5: generate review_ops for all run_dirs in one batch.
PYTHONPATH=. python3 scripts/run_review_ops_batch.py \
  --outputs-dir outputs \
  --newest-per-product \
  --db-path voc_data.db

# 4) Stage 6: build the package index.
PYTHONPATH=. python3 scripts/build_review_ops_package_index.py \
  --package-dir outputs/review_ops_brand20_$(date +%Y%m%d) \
  --runs-file configs/brand20_run_dirs.txt
# (or: --run-dir outputs/A --run-dir outputs/B ...)

# 5) Open the index for QA pass.
open outputs/review_ops_brand20_$(date +%Y%m%d)/index.html
```

## 9. Full collection policy (added 2026-05-05)

Existing run_dirs in `outputs/` (e.g. `image_smoke_v247`, `batch_oy_top8_real_*`,
`one_product_*`) were sampled or partial collections used to validate the
review_ops report structure and UX. **They are not the final corpus for
Brand-20 reports.** Several runs have review counts well below the planning
document's expected counts, which would understate cluster strength,
asset_counts, and stale band evidence in operator-facing reports.

### Policy
- **Final report inputs MUST be sourced from the `source_url`/`goodsNo` listed
  in `configs/review_ops_brand20_seed.csv` and the execution queue at
  `configs/review_ops_brand20_collection_queue.csv`.**
- Collection MUST attempt **full** review fetch per SKU (capped only by
  the connector's safety limits and OY rate limits, never by an arbitrary
  sample size).
- After collection, `collected_review_count` MUST be compared against
  `expected_review_count` in the queue. Recommended QA gate:
  - `collected ≥ expected × 0.5` → green; proceed to base + review_ops report
  - `expected × 0.2 ≤ collected < expected × 0.5` → yellow; produce report
    but flag in operator note (small-corpus caveat)
  - `collected < expected × 0.2` → red; **do not send to external pilot**;
    investigate connector/page issues before retry
- External pilot reports MUST be held until the green threshold is met
  for that SKU.

### Reuse rules for existing run_dirs
- ✅ **Allowed for**: structural QA (template rendering, safety validator
  passes, Section 2-9 layout, hedge-wording contracts, profile-aware OEM).
- ✅ **Allowed for**: a SKU only when the existing run's
  `collected_review_count` already meets the green threshold above
  (e.g. `image_smoke_v247` with 3,170 reviews against メディヒル expected ~3,170+
  is acceptable for that SKU; most other existing runs are not).
- ❌ **Not allowed for**: external pilot delivery for a SKU whose existing
  run is below the green threshold. Re-collect.

### Operator action sequence (Brand-20)
1. Resolve all blockers in `collection_queue.csv` (`goods_no_required` →
   confirm OY goodsNo; `url_check_required` → verify page validity).
2. Run full collection for all `ready_for_full_collection` rows in
   priority order (P0 first, then P1, then P2).
3. After collection, compare `collected_review_count` per SKU against the
   queue's `expected_review_count`; classify green/yellow/red per the
   QA gate above.
4. Run Stage 2 (Phase 2E), Stage 3 (seller PDF), Stage 4 (cardnews),
   Stage 5 (review_ops) per SKU that passed the gate.
5. Build the package index per `Section 6` and proceed to manual QA.

## 10. Artifact roles and delivery experience (added 2026-05-05)

A single Brand-20 run produces 5 artifact families. Without a clear
mental model, operators (and external pilots) confuse "which file do
I open and why." This section names each artifact, describes its
intent, and prescribes which audience sees what.

### 10.1 Artifact taxonomy

| Family | Files | Role | Audience | Status |
|---|---|---|---|---|
| **Base report** | `shared/analysis_report.json` · `seller_report/seller_report_ko.pdf` | "What happened in the reviews" — Phase 2E canonical analysis + the operator-decision PDF. Ground truth for everything downstream. | Brand decision-makers (founder / lead PM) | Required per SKU |
| **Consumer cardnews source** *(internal source data)* | `buyer_content/ko/buyer_journey_cardnews.json` | Cardnews narrative payload — input to the cardnews renderer. Machine-readable JSON; **internal only**. Never sent to consumers or to brands as the artifact itself. | Internal pipeline (cardnews renderer) | Optional per SKU |
| **Consumer cardnews images** *(consumer-facing assets)* | `outputs/content_packages/<package>/cardnews/ko/pages/*.png` (also `.jpg` if present) | Instagram-ready rendered cards. **Consumer-facing**: intended for the brand's social channels. Today these live in a parallel `content_packages/` tree, not under each SKU's `outputs/<run_dir>/`. May be absent for SKUs where the cardnews render step has not run. | General consumers (via brand's social posting); brand marketing team reviews before posting | Optional / when rendered |
| **Operator Workspace** *(companion artifact)* | `shared/review_ops_analysis.json` · `review_ops/review_ops_report.html` | "What to do next" — operator-action layer over the base report: usable quotes / stale revisits / risk groups / FAQ candidates / CS draft / OEM questions / consumer-safe signals. Does not replace the base report; consumes it. | Brand operator (CS / merchandising / OEM ops) | Optional but is the focus of this work |
| **Package index** | `outputs/<package>/index.html` | Read-only navigation grid linking all artifacts for all SKUs in one batch. Internal QA tool, not a customer-facing report. | Internal reviewer (us) | Required per pilot batch |

### 10.2 Terminology (use these in operator/external comms)

- **Base report** → seller PDF + analysis_report.json. Always say "base report".
- **Companion artifact** → review_ops HTML/JSON. Position it as a *companion* to the base report, never as a competing report. The HTML's own footer already states this ("이 리포트는 기존 VOC 분석 산출물에 이어 같은 run 데이터를 운영 액션 관점으로 재가공한 보조 리포트입니다.").
- **Operator Workspace** → the section experience inside the review_ops HTML (Sections 5/6/7/8 — landing copy / CS draft / OEM questions / counts). Avoid calling it "another report."
- **Consumer cardnews source** → `buyer_journey_cardnews.json`. Internal source data, never the deliverable. The word "source" matters: it's input to a renderer, not a finished asset.
- **Consumer cardnews images** → rendered `*.png` under `outputs/content_packages/<pkg>/cardnews/ko/pages/`. These ARE consumer-facing assets — share-able to general consumers via the brand's Instagram/social channels (after brand marketing review). Audience is consumers, NOT sellers/BMs.
- **Package index** → the internal navigation grid only. Never send the index URL to an external pilot.

### 10.3 Delivery recommendation by audience

| Audience | What to share | Why |
|---|---|---|
| **Internal QA reviewer (us)** | `outputs/<package>/index.html` (package index) — should link the JSON cardnews source AND the rendered cardnews PNGs when present | Single page, all artifact families per SKU one click away. Use during the manual QA pass before any external delivery. |
| **Friendly pilot brand** (1-3 brands we know) | `review_ops_report.html` + a link/PDF copy of `seller_report_ko.pdf` + (optional) 1-2 rendered `cardnews/ko/pages/*.png` previews when relevant to the conversation | Companion artifact carries the operator-action surface; base PDF anchors them to the canonical analysis; cardnews images are an optional "we can also produce consumer content" preview, NOT the lead. Never attach the raw cardnews JSON. Keep the package index out of this — they shouldn't navigate other brands' reports. |
| **Cold outreach** (brands we don't know yet) | 3-line summary + **one** `review_ops_report.html` sample + **at most 1-2** rendered cardnews PNGs as illustrative consumer-content examples | Lowest-friction format. Sample HTML carries the value prop; cardnews images are optional visual sugar. Don't lead with seller PDF (too dense). **Never attach `buyer_journey_cardnews.json`** — raw JSON is internal source data and confuses the message. |
| **Future customer workspace** (post-pilot, v2+) | Unified web dashboard | See §10.5. v1 keeps artifacts separate for safety; v2 unifies. |

### 10.4 What NOT to do (anti-patterns)

- ❌ Do not send the package index to external brands — it exposes other brands' artifacts side-by-side.
- ❌ Do not send `analysis_report.json` raw to brands — it's machine-readable; the seller PDF is the human-readable rendering of the same data.
- ❌ Do not send `buyer_journey_cardnews.json` (raw JSON) externally — it's internal source data. If consumer content is part of the conversation, share rendered `cardnews/ko/pages/*.png` images instead, or describe the JSON as "consumer cardnews source we can render on request" without attaching the file.
- ❌ Do not describe cardnews as a seller-facing or operator-facing artifact. Cardnews (both source JSON and rendered images) is **consumer-facing** — its audience is the brand's social-channel followers via the brand's marketing team. Mixing it with operator/BM language confuses the value prop.
- ❌ Do not mix consumer-cardnews messaging with Operator-Workspace risk/OEM claims in the same artifact or the same email. The cardnews carries hedged consumer-safe wording (no defect/no clickbait); the Operator Workspace carries operator-only risk grouping and OEM confirmation questions. They serve different audiences and must not bleed across.
- ❌ Do not call the review_ops HTML "the report" in operator comms — it's the *companion artifact* / *Operator Workspace*. The base report is the seller PDF.

### 10.4.1 When rendered cardnews images are absent

For SKUs whose cardnews render step has not run, `outputs/content_packages/<pkg>/cardnews/ko/pages/` may not exist. In that case:
- The package index should still **link the `buyer_journey_cardnews.json` source** (for internal audit only — the link is for QA reviewers, not external sharing).
- The "Cardnews images" cell should display **"cardnews images not found"** alongside the JSON link, signaling that the consumer-content asset is missing.
- The QA reviewer can decide whether to (a) trigger the cardnews render step before delivery, or (b) deliver the review_ops + base report without consumer-content samples this round.

### 10.5 Future consolidation (v2 deferred)

- v1 deliberately keeps artifact families separate to (a) preserve the existing Phase 2E / cardnews / seller PDF surfaces unchanged, (b) let operators iterate on review_ops without coupling to upstream changes, and (c) keep audit trails decoupled (each artifact is a separate file with its own provenance).
- v2 (post-Brand-20 pilot, after operator feedback) should consolidate into:
  - A **unified web dashboard** per brand: header / summary / base-report embedded view / Operator Workspace / consumer content preview, all behind a single URL.
  - A **single delivery URL** to share externally (instead of HTML attachments).
  - Optional: per-brand authenticated workspace where the brand can react to Operator Workspace items (mark "used", "edited", "discard") and we capture that as feedback.
- Until v2: the package index is the closest thing to a unified view, but for internal use only.

### 10.6 TODOs (small follow-ups for the package index)

- **Detect and link rendered cardnews images.** Today `scripts/build_review_ops_package_index.py` only checks `outputs/<run_dir>/buyer_content/ko/buyer_journey_cardnews.json`. It should additionally probe `outputs/content_packages/<pkg>/cardnews/ko/pages/*.png` (or whatever the conventional render location is per run) and surface a column like `cardnews PNG (N pages)` linking either a thumbnail grid or the directory. When images are absent, render the "cardnews images not found" message alongside the JSON link, per §10.4.1.
- **Per-brand pre-flight gate before external delivery.** A small validator that, given a SKU's run_dir, returns whether the artifact bundle is acceptable for the chosen audience (internal QA / friendly pilot / cold outreach) per the matrix in §10.3. Today this is operator memory — codifying it into a check would prevent accidental raw-JSON sends.

## 11. Public review metadata and detail-page snapshot policy (added 2026-05-05)

### 11.1 public_review_count vs collected_review_count

`expected_review_count` in the seed/queue/validation CSVs is the **public total review count** as displayed on the OliveYoung product detail page at the moment the operator verified it. It is not the count this pipeline analyzes.

What the pipeline actually analyzes is `collected_review_count` — the deduplicated row count returned by the multi-sort scraper after `INSERT OR IGNORE` against `voc_data.db`. The two numbers are **structurally different** because OliveYoung exposes only a practical per-sort window (typically the most-recent N pages, not the full historical archive). For SKUs with five-figure or six-figure public review totals, the gap is large and expected.

This is fine. Phase 2E aggregation, recommendation phrasing, and the seller PDF do not assume `collected_review_count == public_review_count`. The `corpus.confidence_level` and `corpus.signal_stability` fields in `analysis_report.json` are the existing levers for communicating coverage.

### 11.2 Display policy in operator-facing artifacts

Both numbers must surface, distinctly labelled, in any operator-facing surface that mentions review counts. **Do not** present `collected_review_count` as if it were the brand's total review base — operators will read it as a coverage failure when it is in fact a per-sort window outcome.

Suggested labels:

- `공개 리뷰 수 (Olive Young)` — `public_review_count`. Cite the verified date.
- `분석에 사용된 리뷰 수` — `collected_review_count`. Note "정렬별 캡 합계 후 dedup".
- `coverage_ratio` — `collected / public`. Treat as a context number, **not** a quality gate; for high-traffic SKUs this will be small by design.

The seller PDF cover and the review_ops report header are the two places this disclosure must land. The cardnews surface intentionally avoids both numbers (consumer audience).

### 11.3 Why the green/yellow/red collection-coverage gate (§9) does not apply directly

The `coverage ≥ 50% / 20–50% / <20%` gate in §9 was written assuming `expected ≈ public` for low-volume SKUs. With the verified Brand-20 list (min 791, max 101,090, mean ~19,241), most SKUs land in the "<20% coverage by raw ratio" band purely because of OY's per-sort window, not because of pipeline failure.

Until the gate is rewritten to be sort-window-aware (`collected_per_sort` vs. `cap_per_sort`, not `collected` vs. `public`), treat the existing gate as a **per-sort completion check**, not a per-SKU coverage signal. The §9 thresholds remain useful for catching anti-bot or auth-wall failures within a single sort.

#### 11.3.1 Per-sort acceptance threshold (added 2026-05-05, post TIRTIR smoke)

Empirical observation from the TIRTIR `run-002` smoke (post-login CDP session): 5/5 success is rare. 3/5 with `DATETIME_DESC` populated and at least one signal sort populated produced a fully usable analysis (664 reviews merged, all 8 contract artifacts written, review_ops db_status=ok).

Adopt this as the **per-SKU continue threshold** for the Brand-20 pilot:

- `DATETIME_DESC` (primary) **must** succeed. Without it there is no time-axis backbone.
- At least one of `{RATING_ASC, RATING_DESC, USEFUL_SCORE_DESC, RECOMMENDED_DESC}` **must** succeed. Without any signal sort the negative-tail surface is structurally underrepresented.
- **3/5 sorts succeeded ⇒ proceed with analysis.** Log the missing sorts in `collection_summary.json` and append to `retry_queue.json`. Do **not** treat as a blocking failure.
- **2/5 with primary missing ⇒ block.** Halt before Stage 1 and surface the diagnostic.
- **2/5 with primary present but no signal sort ⇒ proceed with caveat.** Mark `corpus.signal_stability` as `low` (Phase 2E aggregator already does this on its own evidence count). Operator should review before external delivery.
- **0/5 or auth_wall on primary ⇒ block.** Same diagnostics + login-session reset path as today.

Soft sort failures (`blocked_or_empty_state` with `is_sort_control_failure=true`) are the expected mode for less-popular sort tabs on lower-traffic SKUs — they are **not** anti-bot signals. The `sorts_blocked_or_anti_bot` field in `collection_summary.json` is the authoritative anti-bot indicator; a soft sort failure that does NOT appear in that list is recoverable later via `retry_queue_drain.py` and should not gate this pass.

### 11.4 Detail-page snapshot — required for future gap analysis

Several follow-on use cases (detail-page recommendation diffs, missing-claim detection, OEM question grounding) require comparing review evidence to **what the detail page actually claims today**. That requires capturing, per SKU, at least:

- product detail page HTML snapshot (or a canonicalized text extract)
- public total review count
- average rating
- rating distribution (5★/4★/3★/2★/1★)
- option/variant list
- collected review count broken down by sort

This is **not implemented yet**. Until it is, operator-facing recommendations in §6 of the review_ops report stay strictly **review-based candidate** — they describe what the review corpus suggests checking, not what the detail page is missing or claiming. Detail-page-grounded recommendations (e.g. "the detail page claims X but reviews say Y") are out of scope until the snapshot capture lands.

### 11.5 Schema impact (deferred)

When detail-page capture is implemented, the natural attach points are:

- `shared/detail_page_snapshot.json` — raw HTML + canonicalized text + extracted metadata (review count, rating dist, options) at a captured timestamp.
- `analysis_report.json::corpus` — additive `public_review_count`, `average_rating`, `rating_distribution`, `collected_per_sort` (object keyed by sort_type).
- `review_ops_analysis.json::metrics` — additive mirrors of the above so the operator HTML does not need to re-read the snapshot.

No schema change is made in this pass. The seed/queue/validation CSVs carry `public_review_count` (as `expected_review_count`) and `verified_by_user_current_oy_page` provenance only. Section 6 of the review_ops report **remains "review-based candidate"** wording until snapshot comparison is wired up.

## 12. Public Instagram cardnews strategy (added 2026-05-05)

### 12.1 Channel role

Instagram is **not** a publication channel for brand-specific review analysis. It is a recurring demonstration channel for *how* review/VOC signals translate into brand actions — independent of any one brand. Cardnews on this surface should make a viewer think "this is how someone reads reviews well," not "this is what's wrong with brand X."

The unit of value on Instagram is the **method**, not the verdict. A viewer who never opens a brand's product page should still get something usable from a single carousel.

### 12.2 What NOT to publish on public Instagram

- A brand or SKU named in conjunction with a negative review summary, even when the source quote is verbatim and public.
- Raw review-count claims framed as a brand quality signal ("X브랜드는 부정 리뷰가 N건 있어요").
- Side-by-side "this brand vs. that brand" comparisons derived from VOC.
- Cluster labels from `review_ops_analysis.json` that retain the brand context (e.g. "OO 쿠션의 펌프 누수").
- Operator-facing material from `review_ops_report.html` — that surface assumes the operator already represents the brand and has internal context the public does not.
- Verbatim review quotes attributable to a specific SKU, even when sanitized — quotes are seldom plausibly anonymous when paired with a category and a tone.
- Calls-to-action that imply we are willing to expose brand weaknesses publicly. This poisons all future brand outreach.

### 12.3 Positioning statement options

Candidate one-liners for the channel header / pinned post / about section. All are deliberately first-person-plural and method-oriented:

- **"리뷰 분석이 아니라, 리뷰를 액션으로 번역합니다."**
- **"브랜드의 리뷰를 평가하지 않습니다. 리뷰가 알려주는 다음 행동을 보여줍니다."**
- **"VOC가 보고서로 끝나지 않게."**
- (English variant for cross-posting) **"We don't grade brands by reviews. We translate reviews into the next move."**

The recurring frame is *translation*, not judgment. "분석/평가/지적" → out. "번역/해석/다음 행동/내부 점검 포인트" → in.

### 12.4 Content principles

1. **Method-first, brand-anonymous by default.** Brand naming requires a separate explicit approval gate; absence of approval is "do not name."
2. **Signal → action mapping is the unit of post.** A post that ends at "이런 부정 리뷰가 있어요" is incomplete; "그래서 내부에서 무엇을 확인할 후보가 됩니다" is the close.
3. **Hedge endings remain.** The same `{후보, 가능성, 검토, 권장, 확인}` contract that governs the seller PDF and review_ops applies here.
4. **Reconstructed examples are preferred over real quotes.** A composite/illustrative review is safer, more legible, and more reusable across categories than any one verbatim quote.
5. **No medical/efficacy claims.** Same `PLANNER_MEDICAL_BANNED_KO` list that gates the existing cardnews safety_validator.
6. **Educational tone, not consultative tone.** "검토해보세요" not "이렇게 하셔야 합니다."
7. **Make the implicit explicit.** When a frame is taken from a real run, declare "실제 리뷰 흐름을 토대로 재구성한 사례입니다" so the viewer doesn't infer attribution.

### 12.5 Five content categories

These are the seed categories for public Instagram. Each is brand-anonymous by default; brand naming, if ever, must be a separate per-post decision.

| # | Category (KO) | One-liner | Source material |
|---|---|---|---|
| 1 | **리뷰 해석 노트** | 한 종류의 리뷰가 실제로 무엇을 말하고 있는지 풀어 읽기 | review_ops asset taxonomy (usable / stale / risk / insight), generic patterns |
| 2 | **리뷰 → 내부 질문** | "이 리뷰를 받았다면 OEM/PM에게 어떤 질문을 해야 하는가" | review_ops `oem_questions` template (anonymized) |
| 3 | **상세페이지 보완 신호** | 리뷰가 반복적으로 짚는 지점은 종종 상세페이지가 비어 있는 자리 | review_ops `landing_copy` candidates + future detail-page snapshot diffs |
| 4 | **VOC 리포트 구성법** | "리뷰가 모이면 어떤 보고서가 나올 수 있는가"의 메타-콘텐츠 | seller PDF / review_ops report 구조 자체를 교재화 |
| 5 | **익명 / 재구성 케이스** | 실제 리뷰 흐름에서 패턴만 추출, 브랜드/SKU 노출 없이 한 사이클을 보여주는 case-study | 여러 SKU의 패턴을 합성하거나 충분히 추상화 |

Each post should explicitly carry one of these category tags in the visible footer or caption so viewers can self-select. This also protects against drift — when no category fits, the post probably belongs to private cardnews instead.

### 12.6 Safe vs risky language — concrete examples

| ⚠ Risky (do NOT publish) | ✅ Safe (rephrase to this) |
|---|---|
| "OO브랜드 쿠션은 두께감이 두껍다는 부정 리뷰가 N건 있어요" | "쿠션 카테고리에서 '두꺼움'이 반복되는 리뷰는, 보통 두 가지 다른 사용 상황을 합쳐서 부르는 신호입니다 — 하나는 ◯◯, 하나는 △△. 어느 쪽인지를 가르는 후속 질문 후보를 정리해봤어요." |
| "리뷰 N건 분석 결과 X브랜드의 가장 큰 약점은 ..." | "어떤 한 카테고리에서 가장 자주 등장하는 부정 신호 3종을 골라, 각각이 실제로 어떤 내부 점검 후보로 번역되는지 보여드려요." |
| "VOC 분석 보고서를 무료로 받아보세요. OO브랜드 사례 포함." | "리뷰가 모였을 때 어떤 형태의 내부 회람 자료가 가능한지, 익명 케이스 한 편을 풀어두었습니다." |
| (verbatim quote) "...진짜 두껍고 답답해요" | "두꺼움/답답함을 지적하는 톤은 종종 ◯◯ 사용 컨텍스트의 신호입니다." |
| "재구매율이 떨어질 수 있어요" (브랜드 지목 시) | "이런 패턴이 누적되면 재구매 의사 결정에 영향이 이어질 가능성이 있어, 내부에서 점검해볼 후보가 됩니다." (브랜드 지목 없음) |

### 12.7 Audience separation matrix

Three distinct audiences, three distinct artifact families, three distinct publication rules. **No artifact may cross audiences without an explicit re-author step.**

| Audience | Surface | Brand naming | Verbatim quotes | review_id exposure | Tone | Goal |
|---|---|---|---|---|---|---|
| **Public Instagram** | `public_instagram_cardnews` (NEW, spec only) | ❌ default no | ❌ no | ❌ no | educational, method-first | recurring credibility, method demo |
| **Private brand pilot/demo** | `private_brand_cardnews` (≈ today's `buyer_journey_cardnews`) | ✅ per per-engagement opt-in | ⚠ sanitized only, hedge-ended | ❌ no (audit only) | narrative, brand-specific | sample what a deliverable can look like |
| **Operator (review_ops)** | `review_ops_report.html` + `review_ops_analysis.json` | ✅ yes (operator already represents the brand) | ✅ yes | ✅ yes (`audit.evidence_review_id_truncated`) | candidate-framed, hypothesis-form | give the operator surfaces to act on |

The cardnews safety validator (`cardnews/safety_validator.py`) currently enforces the operator/buyer split via `PUBLIC_TEXT_FIELDS` and `BANNED_FRAMINGS_KO`. A new validator profile is needed for the public Instagram surface (stricter — no brand names, no verbatim quotes, no SKU-specific risk language) and is described in §12.9.

### 12.8 Generator split — recommended target structure

Today: one buyer-content path produces `buyer_content/ko/buyer_journey_cardnews.json` plus the rendered PNG carousel. The output is brand-specific by construction (it reads `analysis_report.json::product`).

Target:

```
src/voc/content/
  cardnews_buyer_journey.py             # existing — feeds private_brand_cardnews
  cardnews_public_instagram.py          # NEW (spec only, this PR) — generic frames
  cardnews_safety_validator_public.py   # NEW — stricter ruleset for §12.7 row 1

cardnews/render.py                      # accepts a `--mode` flag in v2:
                                        #   private_brand | public_instagram
                                        # selects template family + validator
```

`public_instagram_cardnews` MUST NOT depend on a single `analysis_report.json`. Its inputs are:

- One of the five categories from §12.5
- A category-appropriate generic frame (skin/lip/sun/cleansing/cushion archetype, not a specific SKU)
- Optional: a *composited* signal pulled from the union of N completed runs, sufficiently abstracted that no single SKU is recoverable

Run-dir output convention (provisional):

```
outputs/public_instagram/<YYYY-MM-DD>_<post-slug>/
  spec.json                     # category, principle, archetype, source policy
  layout.json                   # template-driven layout
  pages/01_*.png … N_*.png      # rendered carousel
  manifest.json
```

Decoupled from per-SKU `outputs/<run_dir>/`. The Brand-20 pilot run dirs are **inputs to the abstraction**, not the storage location.

### 12.9 Implementation recommendation — spec first, code later

**Do not implement the split in this pass.** The risks of premature implementation are well-defined:

- The current `cardnews_buyer_journey.py` is calibrated against per-SKU `analysis_report.json`. Forking it before the public spec exists invites silent drift between the two paths.
- The safety validator already encodes the operator-vs-buyer split. Adding a third profile without a written contract risks "third profile works mostly like buyer" → which collapses back to brand-specific output.
- Template proliferation. Today's templates assume per-SKU specifics (cover product image, attribute counts). A public template family needs its own design pass.

**Step 1 (this PR-equivalent block, already done):** capture the strategy above.

**Step 2 (next ticket):** write `docs/public_instagram_cardnews_spec.md` covering, at minimum:

- Output schema for `public_instagram_cardnews.json` (no `product`, no `corpus`, no review_ids; carries `category`, `archetype`, `composited_from_run_ids` audit, `principles_applied`).
- Slide-template inventory for each of the five categories in §12.5 (e.g. "리뷰 → 내부 질문" needs a question-answer frame, not a quote-spotlight frame).
- Stricter safety contract: extends `BANNED_FRAMINGS_KO` with brand-name detection, SKU-pattern detection (`A0\d{12}`), verbatim-quote detection (long string overlap with any review in the source DB).
- Composition rules: when a public post reuses signals from real runs, what minimum `N runs` and what abstraction transforms are required.
- Approval workflow: who signs off that a given carousel is public-safe. (For now: the human operator. Later: a validator pass + human sign-off.)

**Step 3 (later ticket):** implement `cardnews_public_instagram.py` + the new validator + a minimal template set for one category from §12.5.

**Until step 3 lands**, the existing `buyer_content/ko/buyer_journey_cardnews.json` path **remains the private/demo deliverable** and **must not be reposted to public Instagram as-is**. The current cardnews PNG outputs from `run_all.py` are private-mode by default — there is no existing path that would accidentally publish them publicly, so no immediate code change is required to enforce the new boundary.
