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
   review's `replyStatus` changed between exports — the key must **not** move).
5. Until then, every artifact records `dedupKeyConfirmed: false`, `schemaMappingConfirmed:
   false`.

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
