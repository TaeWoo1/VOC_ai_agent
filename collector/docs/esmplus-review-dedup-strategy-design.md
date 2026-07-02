# ESM Plus — REVIEW ingestion dedup strategy (offline design)

> **Design only. Nothing here is built, run, or confirmed.** No live browser, no
> click/download/upload, no API, no DB/status write, no scheduler/`manualSync`, no row or
> cell reading, no raw-header logging. This pass reasons **only** from the sanitized
> category-level shape captured by the Gate 4 / Gate 4b runs (see
> [`esmplus-review-export-discovery.md`](./esmplus-review-export-discovery.md)). **REVIEW
> stays `NEEDS_DISCOVERY`; dedup stays `NEEDS_VERIFICATION`; nothing is CONFIRMED.**

## 0. Inputs this design is allowed to use

Only the sanitized observations already on record — never row values, never raw headers:

- populated export confirmed (`rowCountBucket: few`), layout **stable** vs. the empty export;
- `sheetCount: 1`, `columnCount: 14`, `headerCount: 14`;
- header **category tally**: reviewText ×3, orderOrBuyerRisk ×3, product ×2, reviewDate ×2,
  replyStatus ×1, rating ×1, unknown ×2;
- `reviewIdCandidate: false`, `candidateDedupFields: []`;
- `risks`: `pii-like-header-present`, `no-dedup-key-candidate`;
- `schemaMappingConfirmed: false`, `dedupKeyConfirmed: false`.

These are **category signals**, not a schema mapping. This document proposes **candidates**;
it confirms nothing.

## 1. Why a single stable review ID cannot be assumed

- **No `reviewIdCandidate` was detected** in the populated export's header shape, and
  `candidateDedupFields` came back **empty** — on real rows, not just the empty-result shape.
- The export layout was **identical** between the empty and populated runs (same column
  count, same header hashes, same categories): the absence of an ID-like header is a
  **property of the export layout**, not an artifact of an empty filter.
- Therefore the ingestion design **must not** assume a single natural primary key (no
  per-review marketplace ID column to rely on).
- **Caveat — strong signal, not final proof.** Header categorisation is heuristic: an
  ID-bearing column could be miscategorised as `unknown` (there are 2), or an ID could live
  inside a composite cell only visible at the row level. Until a separately-approved
  row-shape dry-run (§5) inspects minimal cells, "no stable ID" stays a **working
  assumption**, and dedup stays `NEEDS_VERIFICATION`.

**Consequence:** plan for a **composite** dedup key, with graceful fallback levels (§4).

## 2. Candidate composite dedup keys (category-level only)

Every component below is a **category**, normalised then hashed where sensitive — never a
raw value. Notation: `H(x)` = normalized + salted hash (per [§3](#3-privacy-rules));
`norm(x)` = non-sensitive normalisation (e.g. a coarse bucket or an enum token).

Candidate components, by stability/sensitivity:

| component | derived from | form in key | notes |
|---|---|---|---|
| **channel** | constant for this connector | `norm` enum (`ESM`) | non-sensitive; cheap partition |
| **store/account fingerprint** | existing sanitized `boundStoreFingerprintHash` + `fingerprintSourceCategory` | already a hash | reuse the connector identity; never raw store id |
| **reviewDate component** | `reviewDate`-category header | `H(norm(date))` | see date rule in §3; timezone-less ⇒ `unknown`, weakens the key |
| **product component** | `product`-category header(s) | `H(norm(product))` | 2 product-category columns — pick the stabler one at verification; until then treat as one logical component |
| **rating component** | `rating`-category header | `norm(rating)` (small enum 1–5) | low entropy; only meaningful *with* other components |
| **reviewText component** | `reviewText`-category header(s) | `H(norm(text))` | **hash only, never store raw text**; normalise (trim/collapse) before hashing to resist trivial reformatting |
| **replyStatus component** | `replyStatus`-category header | `norm(status)` enum | **mutable over time** — see warning below |
| order/buyer-risk component | `orderOrBuyerRisk`-category headers (×3) | `H(...)` *only if privacy-safe* | **default: excluded** — see §3; opt-in, hashed, never required |

**replyStatus is mutable — do not let it define identity.** A seller answering a review
flips reply-status, so a key that includes raw `replyStatus` would treat the same review as
two distinct rows across exports. replyStatus may be **stored as an attribute** and used for
attention/state, but should be **excluded from the identity key** (or only used in a
*non-identity* change-detection channel).

### Proposed key tiers (which components compose each)

- **Preferred composite key (§4 L1):**
  `H( channel · storeFingerprint · norm(reviewDate) · H(product) · norm(rating) · H(reviewText) )`
  — identity from *what the review is* (when, on what product, what score, what it says),
  independent of mutable reply-status and of any buyer/order field.
- **Fallback composite key (§4 L2):** drop the `reviewText` hash when the text column is
  empty/unreliable on a given row; lean on `channel · store · date · product · rating`.
- **Weak heuristic key (§4 L3):** `channel · store · date · product` only — high collision
  risk (a product can receive several reviews on one day at the same rating).

## 3. Privacy rules (binding)

> These rules apply the **discovery no-raw** policy (Policy A) of
> [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md). Note the policy's
> separation: the *dedup key/index* never stores raw values (here), whereas the *future
> product* MAY store raw review text under consent/access-control/retention (Policy B) —
> the two are decoupled because the key is built from hashes, not raw text.

- **Never store raw review text** as part of a dedup key (or anywhere in the key/index).
  Only a **normalized salted hash** of the text may be used.
- **Never store raw buyer / order / contact fields.** The 3 `orderOrBuyerRisk` columns are
  PII-like (`pii-like-header-present`); by default they are **not used in the key at all**.
  If verification later shows they are *required* to disambiguate true duplicates, they may
  be admitted **only** as `H(normalized)` salted hashes, **never raw**, and **never logged**.
- **Salted hashes for all sensitive components** — reuse the established storage-probe salt
  pattern; the salt is never emitted. Hashing must be normalisation-first (trim, collapse
  whitespace, case-fold where safe) so cosmetic differences don't split a review.
- **No raw value logging, ever** — design, tests, and any future dry-run emit
  **hashes / buckets / categories / booleans only**. No raw header text, no cell text.
- **Buyer/order fields are never required.** The key must remain computable from
  non-PII-derived components (channel, store fingerprint, date, product, rating, text-hash)
  so a privacy-minimal ingest path is always viable.
- **Date handling follows the recency chain.** A `reviewDate` component feeds the internal
  `writtenAt → eventTimeMs` path **internally only**; the dedup key stores `H(norm(date))`,
  not a raw timestamp or elapsed duration. **Timezone-less date strings remain `unknown`**
  (no KST assumption) and therefore **weaken** the key — handled by the fallback tiers, not
  by guessing an offset.

## 4. Candidate dedup levels

| level | key | when used | collision risk |
|---|---|---|---|
| **L1 — preferred** | channel · store · `norm(date)` · `H(product)` · `norm(rating)` · `H(reviewText)` | text present & date resolvable | **low** — text hash is the high-entropy discriminator |
| **L2 — fallback** | channel · store · `norm(date)` · `H(product)` · `norm(rating)` | text empty/unreliable but date+product resolvable | **medium** — same product+date+rating can recur |
| **L3 — weak heuristic** | channel · store · `norm(date)` · `H(product)` | date resolvable, little else | **high** — flag, don't auto-merge |
| **collision-risk warning** | — | any time two distinct rows map to one key, or a row falls to L3 | emit a sanitized `dedup-collision-risk` marker (counts/buckets only) |
| **manual review / duplicate cluster** | — | L3 collisions or ambiguous near-duplicates | route to a **duplicate-cluster** holding state for operator review; **never silently drop or merge** |

**Rules across levels:**
- Always compute the **highest tier the row supports**; record which tier produced the key
  (as a category, e.g. `dedupTier: L1|L2|L3`), so downgrade is observable.
- **Never auto-merge on L3.** A weak-key match is a *candidate* duplicate → cluster for
  review, not a confirmed dup.
- A **collision** (two genuinely different reviews → same key) must surface as a sanitized
  warning, never as a silent overwrite.

> **Implementation status (2026-07-02, partial).** The backend now ships a **versioned,
> channel-gated** key: GMARKET/ESM+ REVIEW rows fold `rating` into the single production
> `content_hash` (recorded as `reviews.dedup_key_version = 2`), while NAVER/other channels stay
> on the prior formula (v1, rating excluded). This realizes the **rating component** above for
> ESM+ within the existing single-key regime. **L2/L3 tiering, `dedupTier`, collision-risk
> markers, and the duplicate-cluster holding state remain design-only** (not implemented). The
> production store namespace is `(org_id, channel_id)`, not a separate `storeFingerprint`
> column. See `esmplus-review-db-ingest-design.md` §15. Dedup stays `NEEDS_VERIFICATION`;
> `dedupKeyConfirmed:false`; nothing CONFIRMED.

## 5. Verification plan (separately approved; dedup stays NEEDS_VERIFICATION)

1. **Row-shape / parse dry-run** — a future, **separately-approved** supervised run that
   reads **minimal cells only** (just enough to test which components are populated and
   stable), still **observe-and-discard**, emitting **only hashes / buckets / categories** —
   never raw cell values. This resolves the §1 caveat (is there really no ID? are the 2
   `unknown` columns ID-like?) and which of the 2 product / 2 reviewText / 2 reviewDate
   columns is the stabler representative. **Analyser design:**
   [`esmplus-review-row-shape-design.md`](./esmplus-review-row-shape-design.md) (Gate 5).
2. **Component-stability check** — across the dry-run, confirm (via hashes only) that the
   chosen components are present and non-empty often enough to support L1/L2.
3. **Overlap-duplicate check** — capture **two exports with overlapping date ranges** and
   confirm the **same review yields the same key in both** (true-dup detection) while
   distinct reviews stay distinct (no false-merge). Compare **key hashes / counts only**.
4. **Repeatability gate** — dedup is promoted off `NEEDS_VERIFICATION` **only after repeated
   overlap validation passes** (stable across multiple overlapping exports, incl. one where a
   review's `replyStatus` changed between exports — the key must **not** move). See the
   concrete pass/fail protocol below.
5. Until then, every artifact records `dedupKeyConfirmed: false`, `schemaMappingConfirmed:
   false`.

### 5.4 Repeatability gate — concrete pass/fail protocol

The gate is an **empirical** claim about ESM's *real* export behavior. **Synthetic data can
harden the code's properties but can never prove real-export repeatability** — so the gate is
staged by evidence class, and only future live evidence can move `dedupKeyConfirmed`.

- **R1 (offline, no live action) — what `dedupKeyConfirmed` *should* mean, and the code-property
  half locked with synthetic tests.** `dedupKeyConfirmed: true` will assert, on **real** ESM+
  data, that the production key (v2, single-tier L1) is a **stable, correct identity**:
  *(a)* repeatable — same real review → same key across **repeated** overlapping exports;
  *(b)* no false-merge — distinct reviews never collide; *(c)* stable under mutable change — a
  `replyStatus` change does **not** move the key; *(d)* tenant/store isolated — identical content
  in two `(org_id, channel_id)` namespaces stays distinct; *(e)* known false-splits characterized
  and accepted (an **edited body** or a **SKU change** reads as a new review — a documented
  single-tier limitation, not a silent defect). Backend synthetic tests now lock (b)-(e) as code
  properties. **Two findings recorded:** a **display-name rename with a stable SKU does NOT split**
  (product identity in the production key is the SKU-keyed `productId`, so renames are tolerated —
  only a SKU change splits); date strings **canonicalize to UTC start-of-day** across common
  formats (no KST assumption), so format drift alone does not split. R1 **confirms nothing** — it
  is necessary-but-not-sufficient.
- **R2 (future, separately approved, live) — the confirming evidence.** A supervised capture of
  **≥ 2 repeated** overlapping real exports **beyond** the 5B in-sample pass (separate
  sessions/windows, incl. one **non-adjacent / larger** window), each `matchRate: ALL`,
  `falseMerge: ZERO` at **L1**; **≥ 1 `replyStatus`-changed** overlap (key unchanged both sides);
  **≥ 1 multi-store / two-tenant** case (identical content stays distinct); a **sample larger than
  `few`** on at least one pass. All compared **offline, hashes/counts only**, real files
  **quarantined then deleted** (Policy A holds; fail closed on any raw-leak risk). No upload, no
  DB/status/capability write during the gate.
- **R3 (future, separately approved) — promotion.** Passing R2 is **not** auto-promotion; a
  **separate explicit decision** then moves `dedupKeyConfirmed` (and decides any capability seed).

**Status (2026-07-01):** step 1 (row-shape dry-run) and step 3's **first in-sample overlap
pass** are done — a live two-export overlap validation (Gate 5 Slice 5B) captured two
overlapping same-store exports and the offline comparator reported `comparable: true`,
`matchRate: ALL` with `falseMerge: ZERO` at **L1/L2/L3**, `replyStatusExcludedFromIdentity:
true`, `risks: []`, on a small (`few`-row) sampled overlap. Sanitized result:
[`esmplus-review-export-discovery.md` → *Gate 5 Slice 5B result*](./esmplus-review-export-discovery.md).
This **strengthens** the composite-key direction but confirms nothing: step 4 (the
**repeatability gate** — repeated overlapping exports incl. a `replyStatus`-changed case, a
larger sample, and a **multi-store fingerprinted** run; the 5B run **waived** the store
fingerprint) is **still open**, so dedup stays `NEEDS_VERIFICATION`.

**Status (2026-07-02):** the gate's **R1 offline stage** is done — the pass/fail protocol above
is written and the backend now carries **synthetic** hardening tests locking the code-property
half (store-namespace isolation, `replyStatus`/PII exclusion from identity, null-rating
stability, edited-body / SKU-change false-split characterization, date-format canonicalization).
The confirming **R2 live stage** (repeated overlapping real exports, incl. a `replyStatus`-changed
and a multi-store case, offline-compared under quarantine) is **not run** and needs explicit
per-run live approval; **R3 promotion** is a further separate decision. dedup stays
`NEEDS_VERIFICATION`; `dedupKeyConfirmed: false`; nothing CONFIRMED. See
[`esmplus-review-db-ingest-design.md`](./esmplus-review-db-ingest-design.md) §16.

**Status (2026-07-02, R2 offline-compared):** the gate's **R2 live stage** has now been run as
a **strong partial**. Three supervised single captures (A/B/C) of repeated overlapping real
exports (`capture-esm-review --emit-composite-key`, one approved click + one download each,
magic-validated then deleted) were compared **offline** under quarantine (`compare-esm-overlap`):
**captureCount 3, pairCount 3**. **A·B** (same wider 1-year window) is the **primary repeatability
evidence** — `comparable: true`, `matchRate: all/all/all`, `falseMerge: zero/zero/zero`; **B·C /
A·C** (C a **narrower 6-month subset**) matched cleanly as **subset / window-scale** evidence, not
full-population equality. All pairs: `slotProvenanceMatch: true`, `excludedCategoriesMatch: true`,
`replyStatusExcludedFromIdentity: true`, `risks: []`, `rawCellLeak: false`, `uploaded: false`,
`dbWritten: false`. **Limitations:** no `replyStatus`-changed overlap was observed (the exclusion
is **structural**, not an observed mutable-state-change pass); sample scale stays small (`few`);
`instrumentKeyNotProductionHash: true` (the salted instrument key, not the production
`content_hash`); `multiStoreLiveCaptured: false` (multi-store isolation covered only by the R1
synthetic `(org_id, channel_id)` test). This is **R2 strong-partial evidence, not a full R2 pass**;
**R3 promotion is deferred**. dedup stays `NEEDS_VERIFICATION`; `dedupKeyConfirmed: false`; nothing
CONFIRMED. See [`esmplus-review-db-ingest-design.md`](./esmplus-review-db-ingest-design.md) §17.

> **DB-ingest design (docs-only):** how this working key becomes durable, idempotent review
> records — by **evolving the existing backend** ingest, not this design's concern — is specified in
> [`esmplus-review-db-ingest-design.md`](./esmplus-review-db-ingest-design.md) (Slice 6). It confirms
> nothing; dedup stays `NEEDS_VERIFICATION` until the §5.4 repeatability gate passes.

## 6. Non-goals (hard)

- **No DB ingest**, no upload, no production dedup, no persisted index.
- **No CONFIRMED capability** — REVIEW stays `NEEDS_DISCOVERY`.
- **No scheduler / `manualSync`**, no live browser, no API call.
- **No schema mapping confirmation** and **no dedup-key confirmation** from this design —
  these are *candidates* pending §5.
- No raw row/cell/header value is read, stored, or logged anywhere in this design.

## Unresolved risks (carried forward)

- **ID could be hiding in an `unknown` column** (2 present) or inside a composite cell — only
  the §5 row-shape dry-run can rule this in/out; until then "no stable ID" is an assumption.
- **Low-entropy collisions** at L2/L3 (same product+date+rating) — mitigated by the text-hash
  at L1, but rows with empty text fall back and may need cluster review.
- **Date ambiguity** — timezone-less `reviewDate` strings stay `unknown` and weaken the key;
  no KST assumption is permitted, so such rows lean on product/text components.
- **Text normalisation drift** — if ESM reformats review text between exports, a naive text
  hash could split a true duplicate; normalisation rules (trim/collapse/case-fold) need
  validation in §5.
- **PII pressure** — the 3 `orderOrBuyerRisk` columns remain a standing exclusion; admitting
  any of them later requires an explicit privacy review, never a raw value.
