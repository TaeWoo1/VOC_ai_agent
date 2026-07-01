# ESM Plus — REVIEW DB-ingest design (working-key ingest; evolve the existing backend)

> **Docs-only design (Slice 6).** No code, no migration, no live/DB/upload action is part of this
> slice. It specifies how ESM+ REVIEW exports become durable, idempotent review records by **evolving
> the existing SellerOps backend ingest** toward the Gate-5-validated composite key — it does **not**
> implement it. Every component below is a **category / hash / bucket / boolean**; no raw review value
> appears here (Policy A). **REVIEW stays `NEEDS_DISCOVERY`; dedup stays `NEEDS_VERIFICATION`;
> `dedupKeyConfirmed:false`; `schemaMappingConfirmed:false`; nothing is CONFIRMED.**

Layers on: [`esmplus-review-dedup-strategy-design.md`](./esmplus-review-dedup-strategy-design.md) (key
tiers + privacy rules), [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md) (Policy A
discovery vs Policy B product storage), and the Gate 5 evidence in
[`esmplus-review-export-discovery.md`](./esmplus-review-export-discovery.md) (Slice 4b/5A/5B).

---

## 0. What already exists (the ingest is not greenfield)

The collector does **no** dedup: it POSTs the xlsx bytes to `POST /api/uploads`
(`collector/src/upload.ts` → `uploadReviewFile`, `uploadType: "REVIEW"`). **All dedup already happens
server-side** in the Java 17 / Spring Boot / JPA / PostgreSQL / Flyway backend under `/backend`:

- **`reviews` table** (`db/migration/V1__init.sql`): `id, org_id, channel_id, product_id, rating, body,
  is_negative, received_at, …`.
- **Dedup columns** (`V2__file_ingest.sql`): `external_id`, `content_hash`, with unique constraints
  `uq_reviews_external (org_id, channel_id, external_id)` and `uq_reviews_hash (org_id, channel_id,
  content_hash)`.
- **`ingest/IngestionService.ingestReviews`**: per row the dedup token is `ext:<external_id>` when a
  stable id is present, else `hash:<content_hash>`, where `ContentHash.of(channelId, productId,
  datePart(received_at), body)` = full SHA-256 hex over NFC-normalized, lowercased, whitespace-collapsed,
  `"|"`-joined parts. An in-batch `seen` set plus a DB existence check skip duplicates; re-upload is
  idempotent. A passing `RUN_INTEGRATION` test (`collector/test/upload.test.ts`) already asserts
  idempotent re-upload dedup + an item-analysis delta only for genuinely new rows.
- **`ingest/map/ReviewRowMapper`**: header aliases are **NAVER-oriented** (a `리뷰글번호`-style column maps
  to `external_id`).
- **Capability**: `channel_capabilities.verification_status` (`V3__scheduled_collection.sql`), vocabulary
  `CONFIRMED / NEEDS_VERIFICATION / UNSUPPORTED`. There is **no** ESM+ REVIEW file-upload capability row,
  and `NEEDS_DISCOVERY` is a collector-doc label, not a backend value.

**Consequence for ESM+:** ESM+ REVIEW exports carry **no stable review-id** (established Gate 4b/Slice 4B),
so `external_id` is null and dedup falls entirely to `content_hash`. Two things follow: the mapper needs
ESM+ aliases, and the `content_hash` definition should evolve toward the validated composite key.

---

## 1. Objective

Turn ESM+ REVIEW exports into **durable, idempotent** `reviews` rows in the existing backend, keyed by the
Gate-5-validated **composite** strategy. Raw review `body` is stored **only** under Policy B (product
storage, gated). Buyer/order/contact-like fields are **minimized** — never in the identity key, never
stored raw by default. **REVIEW is not marked CONFIRMED by this design.**

---

## 2. Status framing — a *working-key* ingest design, not confirmed dedup

**Evidence supporting the key** (all sanitized, in the Gate 5 record): no stable review-id
(`idColumnSuspected:false`, `reviewIdCandidate:false`); on two overlapping live exports, same-review →
same-key at **L1/L2/L3** with `matchRate: ALL` and `falseMerge: ZERO` in-sample; replyStatus and
PII/order/buyer/contact categories excluded from identity.

**What remains open** (the dedup design's §5.4 *repeatability gate* — not closed here):
- larger-sample repeatability (the 5B overlap was a `few`-row sample);
- a **replyStatus-changed** overlap case (identity must not move when only the reply changes);
- **multi-store namespace** validation — 5B **waived** the store fingerprint (`storeFingerprintApplied:
  false`); in the backend the namespace is structural (`(org_id, channel_id)` scope), still to be exercised
  with two tenants;
- **edited reviews** (does a seller-editable body split a true duplicate?);
- **larger / non-adjacent** export windows.

Until that gate passes, every ingest artifact records `dedupKeyConfirmed:false`,
`schemaMappingConfirmed:false`, and the capability stays `NEEDS_VERIFICATION`.

---

## 3. The gap this design closes

| Concern | Backend today | Validated (Gate 5) target |
|---|---|---|
| ESM+ ingestibility | NAVER header aliases only; ESM+ has no `external_id` | add ESM+ aliases; ESM+ dedups via `content_hash` |
| Dedup key | `content_hash = SHA256(channel·product·date·body)` — **no rating**, single tier | tiered **L1** (+rating+text), **L2** (drop text), **L3** (date+product, weak) |
| Tier visibility | none | record `dedup_tier` (L1/L2/L3) per row |
| Mutable attrs | duplicates **skipped**; reply status not stored | store `reply_status` as a **non-identity** attribute, update on match |
| Collisions | hash match assumed = true dup, silently skipped | detect same-key / different-content → **duplicate-cluster**; never silent-merge |
| Store namespace | `(org_id, channel_id)` scopes every unique constraint | this **is** the store namespace — resolves the 5B fingerprint waiver structurally |
| Capability | no ESM+ REVIEW/file-upload row | seed one at `NEEDS_VERIFICATION`; never `CONFIRMED` here |
| Hash convention | full SHA-256, unsalted, server-side | **keep the backend regime** (server-authoritative); the collector's salted 16-hex was a *validation* artifact, not the production key |

---

## 4. Proposed DB model (additive, backward-compatible evolution)

**Reuse the `reviews` table and its two unique constraints — do not fork a new table.** ESM+ reviews are
`reviews` rows scoped by `(org_id, channel_id)` like every other channel.

**Added columns (a later ESM+-first Flyway migration, e.g. `V8__…`):**

| column | purpose | identity? |
|---|---|---|
| `dedup_tier` (enum-ish varchar: `L1`/`L2`/`L3`) | which tier produced the key — makes downgrade observable | no (metadata) |
| `dedup_key_version` (int) | which `content_hash` formula produced the value — lets the formula evolve **without invalidating existing NAVER hashes** | no (metadata) |
| `reply_status` (varchar, null) | seller reply/answer state — **mutable**, updated on match | **no** — excluded from identity |
| `content_context_hash` (varchar, null) | full-content fingerprint (all present identity components) — detects a same-key/different-content collision; mirrors the collector `context` hash | no (collision signal) |
| `ingest_state` (enum-ish: `INGESTED`/`DUP_SKIPPED`/`CLUSTER_REVIEW`) | records how a row resolved — never a silent drop | no |

**Not added:** separate per-component hash columns as *identity* — `content_hash` stays the single composite
key; date/product/rating/text are **inputs** to it, not stored columns. (A per-component breakdown may be a
debugging aside, never the identity.)

**Ingest run / audit:** reuse the existing sync-job + `IngestResult`
(`syncJobId, totalRows, successRows, skippedRows, failedRows, sampleErrors`). The new `CLUSTER_REVIEW` state
plus a small holding surface handle L3 / collision rows for operator review — never a silent drop or merge.

**PII minimization:** the three `orderOrBuyerRisk` (buyer / order / contact) columns are **excluded at the
mapper** — never mapped into identity and never stored raw by default.

---

## 5. Composite key strategy (server-side, evolving `ContentHash`)

Notation from the dedup design: `H(x)` = normalized + hashed (server SHA-256 regime); `norm(x)` = a
non-sensitive normalization (enum/bucket). `storeScope` = the existing `(org_id, channel_id)` unique-key
prefix — **this is where "storeFingerprint" lives in production** (no separate fingerprint column).

- **L1 — preferred:** `channel · storeScope · norm(reviewDate) · H(product) · norm(rating) · H(reviewText)`
  — the substantive change vs today is adding **rating**; identity is *what the review is*, independent of
  mutable reply-status and of any buyer/order field.
- **L2 — fallback:** drop `H(reviewText)` when the text column is empty/unreliable on a row.
- **L3 — weak:** `channel · storeScope · norm(reviewDate) · H(product)` only — high collision risk;
  **never auto-merge**, route to a duplicate-cluster.

Rules:
- Compute the **highest tier the row supports**; record `dedup_tier` so a downgrade is observable.
- **replyStatus excluded** from identity (mutable); **order/buyer/contact excluded**; **`unknown` columns
  excluded** unless future evidence changes that.
- **Date canonicalization** before hashing (separators / zero-pad; a timezone-less date stays `unknown` and
  **weakens** the key → handled by the fallback tiers, never by guessing an offset — the recency-chain rule).
  The collector's `normalizeReviewDate` (`collector/src/esm/esm-review-composite-key.ts`) is the reference
  spec for this normalization; the backend implements the same rules in its own SHA-256 regime.
- **Keep the backend hash regime** (full SHA-256, unsalted, server-side). The collector's salted 16-hex
  composite hashes were a **validation** instrument (cross-export comparability), **not** the production key.

---

## 6. Ingest behavior (evolving `IngestionService.ingestReviews`)

Per row: **parse → normalize → compute the highest supported tier → resolve:**

- **L1 available:** upsert by L1.
- **L2 fallback:** use L2 **with a collision guard** (compare `content_context_hash` — a match on the key but
  a mismatch on full content is a collision, not a duplicate).
- **L3 only:** treat as a **weak candidate → duplicate-cluster / manual review**; **never auto-merge**.
- **On a dedup match:** do **not** overwrite stable identity fields; **update mutable attributes separately**
  (`reply_status`, `is_negative`, enrichment). *(Today the backend simply skips a matched row; this design
  adds the mutable-attribute update-on-match.)*
- **Idempotency preserved:** identical identity ⇒ no new row. The existing `RUN_INTEGRATION` idempotency
  test remains the guard, extended with an ESM+ synthetic fixture.

Optionally retain `reply_status` history; v1 recommends **latest-only** + `updated_at` (history deferred
unless the product needs it).

---

## 7. Raw-data policy (Policy B, explicitly separate from discovery Policy A)

Per [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md):

- **Policy A (discovery / logging / output)** — no raw values anywhere — is **not relaxed**. It still governs
  all logs, docs, terminal output, LLM output, and test snapshots for this ingest work.
- **Policy B (product storage)** governs `reviews.body`. Raw review text may be stored **only** under all
  four premises: (1) tenant **consent**; (2) tenant-scoped **access control** (raw body readable only by the
  authorized tenant); (3) a defined **retention window + deletion path**; (4) clear **product value**
  (operators need to read the review). Storing under Policy B does **not** relax Policy A.
- **Buyer / order / contact fields** are minimized, redacted, or hashed by default, and **never required**
  for the key — a privacy-minimal ingest (channel · store · date · product · rating · text-hash) is always
  computable without them.

These retention / access-control conditions are **design premises stated here, not implemented in this
slice.**

---

## 8. Error & collision handling (every case → a sanitized outcome, never silent)

| situation | handling |
|---|---|
| key missing (all identity components empty) | row error / skip, with a sanitized reason; counted in `failedRows`/`skippedRows` |
| multiple rows → same **L1** (in-batch or vs DB) with differing content | **collision** marker → `CLUSTER_REVIEW`; never overwrite |
| **L2** collision (same key, different `content_context_hash`) | collision marker → `CLUSTER_REVIEW` |
| **L3** only | weak candidate → `CLUSTER_REVIEW`; **never auto-merge** |
| schema drift (ESM+ headers change) | mapper-miss → halt-and-report; do not force a mapping |
| parser failure | row-level failure, counted; never a raw dump |
| raw-leak risk | **fail closed** (Policy A) — stop before emitting |
| upload-side delete/quarantine failure | surfaced (not silent) — as in the capture harness |
| duplicate-cluster creation | explicit `CLUSTER_REVIEW` state + operator surface |

All counts are **buckets / counts only**; no raw row/cell value in any error.

---

## 9. Capability / status model

Four **distinct** axes — do not collapse them:

1. **Export-capture capability** — Gate 3/4: a supervised capture reaches and downloads the export. *Proven.*
2. **Schema-mapping confidence** — `schemaMappingConfirmed:false` (the mapper is candidate categories).
3. **Dedup confidence** — `dedupKeyConfirmed:false`; the §2 repeatability gate is open.
4. **DB-ingest readiness** — this design (a plan, not a shipped path).

**Vocabulary reconciliation:** the collector's `NEEDS_DISCOVERY / NEEDS_VERIFICATION / CONFIRMED` are
doc-labels; the backend's `channel_capabilities.verification_status` is `CONFIRMED / NEEDS_VERIFICATION /
UNSUPPORTED`. Recommendation:

- Seed an ESM+ **REVIEW / file-upload** capability at **`NEEDS_VERIFICATION`** (ingestible, dedup not yet
  production-verified). Map the collector's `NEEDS_DISCOVERY` → the honest backend `NEEDS_VERIFICATION` for
  this capability.
- **Do not add a new status enum** — the backend vocabulary is sufficient.
- **Do not move to `CONFIRMED` in this slice.** Promotion is gated on the §2 repeatability evidence — a
  separate decision.

---

## 10. Implementation slices (named here; none executed by this design)

1. **Slice 6 — this docs-only design.** (Done when this doc merges.)
2. **ESM+ parser → normalized-row spec** — the mapper alias set + normalization rules, synthetic-fixture
   tested (collector-side spec or a backend `ReviewRowMapper` change).
3. **Backend: ESM+ header aliases in `ReviewRowMapper`** + a synthetic ESM+ ingest test — the **smallest**
   backend slice; makes ESM+ ingestible via the *current* `content_hash` with **zero** change to NAVER.
4. **Backend: tiered / versioned `ContentHash`** — add `rating`, `dedup_tier`, `dedup_key_version`, behind
   the version so NAVER data is untouched; synthetic tests.
5. **Backend: `reply_status` mutable-attribute update-on-match** — idempotency + mutable-field tests.
6. **Backend: collision → duplicate-cluster** state + operator surface — collision tests.
7. **Dry-run ingest** (parse + dedup decision, **no DB write**) behind a flag; then **DB write behind an
   explicit flag**; **live ingest only after approval** and after the §2 repeatability gate.

*(Slices 2–7 touch the Java backend / migrations — a different lane from the collector track; each needs
its own backend-scoped approval and review.)*

---

## 11. Test plan (acceptance for the later code slices)

- **Idempotent re-import** — extend the existing `RUN_INTEGRATION` test with an ESM+ synthetic fixture;
  re-upload → no new rows, dedup skips, no item-analysis delta for duplicates.
- **Same-review duplicate import** → skipped.
- **Changed `reply_status`** between imports → mutable field updated, **identity key unchanged**, no new row.
- **L1 collision guard** and **L2 fallback collision guard** → collision → `CLUSTER_REVIEW`, never overwrite.
- **PII minimization** — order/buyer/contact never in the key, never stored raw.
- **Raw review-text storage gated** — body stored only under the Policy B premises.
- **No raw leak in logs / snapshots** (Policy A) — hashes/buckets/categories/booleans only.
- **No `upload` / `status` / `scheduler` / `manualSync` imports** in any pure module added.
- **Multi-tenant isolation** — two orgs with identical review content must not collide (exercises the
  `(org_id, channel_id)` namespace that replaces the waived store fingerprint).

---

## 12. Risks / open decisions

- **`content_hash` formula change invalidates existing hashes.** Adding `rating` changes every hash — a naive
  change would break NAVER dedup and require a backfill. **Mitigation:** `dedup_key_version` + apply the new
  formula **ESM+-channel-first**; NAVER stays on v1 until a deliberate, separately-approved backfill.
- **Backend is a different lane.** Java + Flyway work sits outside the collector track's established scope;
  those slices need backend-scoped approval and review. This design touches no backend code.
- **`storeFingerprint` vs `(org_id, channel_id)`.** The design asserts the org+channel scope **is** the
  production store namespace, so the 5B fingerprint waiver is acceptable — but multi-tenant isolation is an
  **open verification item** (the multi-tenant test above), not a settled fact.
- **Two product tracks must not be conflated.** `src/voc/phase1_reviews` (Python; Coupang / OliveYoung
  bait-report) is a **different** system from the SellerOps Java `reviews` table — this design targets the
  **latter** only.
- **`reply_status` history** — latest-only (recommended v1) vs a change-log; history deferred unless the
  product needs it.

---

## 13. Non-goals (hard)

- **No DB ingest is performed** by this slice; **no** migration, no backend code, no collector code change.
- **No live browser / capture / upload / API / DB / status / capability write / scheduler / manualSync.**
- **No schema-mapping confirmation** and **no dedup-key confirmation** — both stay candidates pending the
  §2 repeatability gate.
- **No raw row/cell/header/product/review/date/buyer/order/contact value** is read, stored, or logged by this
  design.

**Status:** REVIEW remains `NEEDS_DISCOVERY`; dedup remains `NEEDS_VERIFICATION`; the ESM+ REVIEW ingest
capability recommendation is `NEEDS_VERIFICATION`; **nothing is CONFIRMED.**

---

## 14. Milestone status — ESM+ REVIEW backend ingest validation (executed 2026-07-01)

This records the outcome of the **ESM+ REVIEW backend ingest validation** milestone, which executed the
smallest backend slice named in §10.3 (ESM+ header aliases + a synthetic ESM+ ingest test) and its
service/connector-level extensions. **It changes no production behavior, no migration, no `ContentHash`,
no dedup formula, no `FileParser`, and no channel-aware mapping.** All validation used
**synthetic ESM+ export-shaped data**; **no real ESM+ cell values** were used (only header labels from the
prior live capture, already committed under the narrow schema-alias source exception); **no live
upload / DB / status / capability / scheduler / manualSync action occurred** — the DB is in-memory H2 in
tests only.

**What was executed:**

- **Grounded aliases (Slice 3, merged).** `ReviewRowMapper` now carries the real ESM+ REVIEW mapped-field
  headers; `RowMapperTest`'s coverage-gap canary was flipped to the real grounded headers. Body / sku /
  receipt-date gained grounded aliases; product and rating already matched existing generic aliases;
  `externalId` stays ungrounded (no ESM+ review-id column → `content_hash`-only dedup); replyStatus,
  order/buyer/contact-risk, and `unknown` categories remain excluded from identity.
- **Service-level ingest test — `EsmReviewIngestFlowTest`** (`backend/.../ingest/`, local, uncommitted).
  A synthetic ESM+ `.xlsx` through the **real** `FileParser → ReviewRowMapper → IngestionService` chain on
  H2: mapped fields persist; `externalId` null; `content_hash` set; excluded synthetic columns never leak;
  identical re-ingest skips via the existing `content_hash` behavior.
- **Connector-level ingest test — `FileUploadConnectorReviewIngestFlowTest`** (`backend/.../connector/`,
  local, uncommitted). The same synthetic `.xlsx` through the **real `FileUploadConnector.ingest`**
  entrypoint: the `IngestResult` reports `status = SUCCESS`, correct row tallies, and a recorded
  `syncJobId`; an all-duplicate re-upload is an idempotent `SUCCESS` that inserts nothing.

**What this establishes (and only this):** *unit-level grounded schema mapping verified*; *backend
ingest-path mapping verified*; *connector-level ingest orchestration verified*; *synthetic ESM+ REVIEW
xlsx validation passed*. Duplicate re-upload currently skips through the **existing** `content_hash`
behavior — observed on the synthetic fixture, **not** a production dedup guarantee.

**Test results (at close):** backend `./gradlew test` green — the two new `@DataJpaTest` files add 4 tests
(all pass); full suite green with zero failures/errors. Collector regression unchanged and green
(`typecheck` clean; unit tests pass). No package/lock change.

**Explicitly NOT promoted / NOT done:** `content_hash` v2 and `dedup_key_version` are **not** implemented
(deferred to §10.4, a separate later milestone); the §2 repeatability gate stays open. **REVIEW remains
`NEEDS_DISCOVERY`; `schemaMappingConfirmed:false` (no promotion gate accepted); dedup remains
`NEEDS_VERIFICATION`; `dedupKeyConfirmed:false`; the capability stays `NEEDS_VERIFICATION`; nothing is
CONFIRMED.**

---

## 15. Milestone status — `content_hash` v2 / `dedup_key_version` (executed 2026-07-02)

Supersedes §14's "not implemented" note for the versioned key: the **versioned, channel-gated** part of
§10.4 is now implemented (the **tiered** part — L2/L3, `dedup_tier`, collision-cluster — is **not**; see
below). This is a **production dedup-key change**, scoped to REVIEW and to the ESM+ (**GMARKET**) channel.
No live action, no real data — synthetic H2 tests only.

**What was implemented (backend):**

- **`reviews.dedup_key_version`** column added via **`V8__review_dedup_key_version.sql`** (additive
  `add column if not exists … integer not null default 1`). **Existing rows default to version 1** — no
  backfill was performed.
- **NAVER and every non-GMARKET REVIEW row stays on v1** — the v1 formula
  (`channel · product · date · body`) is unchanged **byte-for-byte**.
- **GMARKET/ESM+ REVIEW rows use v2**, which **includes `rating`** in the review content-hash input path
  (identity = *what the review is*; reduces false-merge of distinct same-body reviews). ESM+ carries no
  stable review-id, so it always dedups on this hash.
- The versioning lives in a new pure `ingest/ReviewDedupKey` helper + a `ChannelRepository` lookup in
  `IngestionService.ingestReviews` (resolved once per batch). **`ContentHash.of` remains untouched**
  because it is shared with inquiries and Cafe24 community — so **inquiry and community dedup behavior is
  unchanged**. The existing **unique `content_hash` constraint/index is unchanged** (the hash string
  already encodes the formula's inputs; each channel is single-version).

**Explicitly NOT in this milestone (still deferred):** no `dedup_tier`; no **L2/L3 tiering**; no
**collision→duplicate-cluster** logic; no **`reply_status` update-on-match**; no **capability/status seed**;
no NAVER re-key/backfill. (Doc §10.4 partial; §10.5/§10.6 untouched.)

**Implementation deviation (recorded):** the new `ChannelRepository` constructor dependency on
`IngestionService` required updating **10 existing test files**, not the initially estimated 3 — all were
**mechanical** test-constructor updates (append the autowired `ChannelRepository` arg); no assertion or
behavior change.

**Test results (at close):** two new suites — `ReviewDedupKeyTest` (pure) and
`ReviewDedupKeyVersionIngestTest` (`@DataJpaTest`: GMARKET v2 keeps differing-rating rows distinct;
non-GMARKET stays v1 and dedups them; `dedup_key_version` stamped 2 vs 1). Full backend `./gradlew test`
green (0 failures/errors); every existing dedup test stayed green (proof the gate is non-disruptive).
Collector regression unchanged and green. Entity↔DDL parity (`Review.dedupKeyVersion` ↔ V8 column)
checked by hand — no migration test exists.

**Status:** ships the **designed** v2 key; **does not confirm** the dedup strategy. **REVIEW remains
`NEEDS_DISCOVERY`; `schemaMappingConfirmed:false`; dedup remains `NEEDS_VERIFICATION`;
`dedupKeyConfirmed:false`; capability/status unchanged (`NEEDS_VERIFICATION`, unseeded); nothing is
CONFIRMED.** No live/browser/upload/API/real-DB/status/capability/scheduler/manualSync occurred.
