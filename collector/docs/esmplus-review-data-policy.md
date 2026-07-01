# ESM Plus — REVIEW data policy: discovery no-raw vs. future product storage

> **Policy / design only. No code, no live work, no capability change.** This doc
> separates two things that have been conflated under "no raw": the **binding
> discovery/output no-raw rule** (in force now) and the **future product-storage
> policy** (design-level, gated by a privacy review). It does not enable, build, or
> authorize any raw-data storage. **REVIEW stays `NEEDS_DISCOVERY`; dedup stays
> `NEEDS_VERIFICATION`; nothing is CONFIRMED.**
>
> Related: [`esmplus-review-export-discovery.md`](./esmplus-review-export-discovery.md)
> (Gate ladder + results), [`esmplus-review-dedup-strategy-design.md`](./esmplus-review-dedup-strategy-design.md)
> (composite-key design). The dedup design's §3 privacy rules are an application of this
> policy.

## Why this doc exists

Gate 4/4b and the dedup design enforce a strict "no raw row/cell values anywhere" rule.
That rule is **correct for discovery**, but it has been read as if it also meant *the
product may never store raw review text*. Those are different questions:

- **Discovery** is about what leaves the collector into logs, terminal, docs, diffs,
  tests, and chat. There, raw values are never acceptable — they are uncontrolled
  surfaces.
- **Product storage** is about what the shipped product persists for operators, behind
  consent, access control, and retention. There, raw review text can be legitimate and
  valuable — but only under an explicit privacy review, which has not happened.

This doc draws that line so later slices (the Gate 5 minimal-parse analyser, any ingest
design) inherit an unambiguous contract.

## Policy A — Discovery / logging / output (BINDING NOW, absolute)

Applies to every discovery and diagnostic surface: collector logs, terminal/stdout,
docs, git diffs, test fixtures/snapshots, and any LLM/chat output.

- **Never** emit raw row/cell values — review text, product names, buyer/order/contact
  values, ratings tied to a row, raw dates, raw filenames, paths, URLs, frame URLs,
  hosts, origins, selectors, DOM, screenshots, or HTML.
- Emit **only** sanitized signals: booleans, coarse buckets, fixed category labels,
  exact structural counts (sheet/column/header counts are shape, not content), and
  **salted, non-reversible hashes**.
- The **exact row count** is never emitted — only a `rowCountBucket`.
- This rule is **non-negotiable and unaffected** by anything in Policy B. The Gate 5
  dry-run, its tests, and its output obey Policy A in full.

### Policy A — narrow header-label carve-out (adopted, one-time, header-labels-only)

To ground `ReviewRowMapper` aliases in the *real* ESM+ REVIEW header strings — which the
category-tally captures deliberately never recorded — a **single, narrowly scoped exception**
to Policy A's no-raw-**header** rule is **adopted** here for one future header-label capture.
It is defined by the header-capture protocol,
[`esmplus-review-header-capture-design.md`](./esmplus-review-header-capture-design.md), and
bounded exactly as:

- **Header labels only** — the REVIEW column header strings, and nothing else.
- **No data rows** (`maxDataRows = 0`), **no cell values**, **no buyer/order/contact values**.
- Literal labels are written **only** to the gitignored local artifact
  `collector/findings/esm-review-header-labels.local.md` (operator review only; never staged,
  never committed).
- Literal labels are **never** emitted to **logs, terminal summaries, committed docs, git
  diffs, tests, or chat/LLM output** — those surfaces still get sanitized signals only
  (count bucket, per-header category, per-header NFC/NFD form, a boolean).
- The raw **row/cell-value** prohibition above remains **absolute** and untouched — this
  carve-out narrows *only* the header-text extension of the no-raw rule, and only for header
  labels, which are schema metadata (column names), not buyer content or PII.

**Scope limits of adopting this here (this doc edit alone):** this is a **policy adoption
only**. It does **not** run any capture, does **not** add a `--capture-review-headers` flag,
does **not** write any local artifact, and does **not** grant any schema-mapping or dedup-key
confirmation. The offline capture code slice and the live capture run are each **separately
approved** downstream steps.

## Policy B — Future product storage (DESIGN-LEVEL, privacy-review-gated, NOT this track)

What the *shipped product* may eventually persist for operator value. **Nothing here is
enabled or implemented by the discovery track**; each item requires an explicit privacy
review before it is built.

- **Raw review text MAY be stored later** when ALL of these hold:
  1. **Consent** — the seller/tenant has consented to the product reading/storing their
     buyers' review content;
  2. **Access control** — raw text is readable only by the authorized tenant, behind
     tenant-scoped authz;
  3. **Retention policy** — a defined retention window and deletion path exist;
  4. **Clear product value** — operators need to read the review (that is the product).
- Storing raw review text under Policy B does **not** relax Policy A: discovery/logging
  output still never contains it.

## Field classification

| field category (from the sanitized header categories) | discovery output (Policy A) | future product storage (Policy B) |
|---|---|---|
| review text (`reviewTextCandidate`) | hash / class / bucket only | **MAY be stored raw** under consent + access control + retention + product value |
| product (`productCandidate`) | hash / class only | may be stored (product-level, not personal) under the same controls |
| reviewDate (`reviewDateCandidate`) | `H(norm(date))`, bucket; timezone-less ⇒ `unknown` | may be stored as a normalized timestamp; recency rules apply |
| rating (`ratingCandidate`) | coarse enum only | may be stored (low-sensitivity) |
| replyStatus (`replyStatusCandidate`) | enum only | may be stored as a **mutable attribute** — never an identity key |
| buyer / order / contact (`orderOrBuyerRiskCandidate`) | **presence + class only, no hash by default** | **stays minimized / redacted / hashed** unless a future explicit privacy review authorizes more; **never required** for the dedup key |
| unknown (`unknown`) | hash / class only | unclassified — no storage decision until categorised |

**Standing rule for buyer/order/contact-like fields:** minimized, redacted, or hashed by
default; raw storage requires a separate, explicit privacy review with a stronger,
stated reason. These fields are **never** required to compute identity (the dedup key
must remain computable without them — see the dedup design).

## Retention & access-control assumptions (design level only)

Stated so later ingest design has a target; none of this is built:

- Raw review text (if Policy B is ever exercised) lives behind **tenant-scoped access
  control** with a **defined retention window** and a deletion path.
- **Dedup indexes use hashes, not raw values** — so the dedup/identity layer needs **no
  raw PII** even if the product stores raw review text elsewhere. Identity and raw
  storage are decoupled: the key is a composite of hashes/enums (dedup design §2), while
  raw text (if stored) is a separate, access-controlled attribute.
- Date components follow the recency chain: internal normalized time only; sanitized
  surfaces expose buckets, never raw timestamps or elapsed durations; timezone-less
  values remain `unknown` (no KST assumption).

## Non-goals / status

- This doc **enables no capture, code, or capability** — no raw storage, no ingest, no
  upload, no DB, no `--capture-review-headers` flag, no local-artifact write, no capability
  change. It is a contract for later slices. Its **one** substantive change is *adopting* the
  narrow header-label carve-out above (a policy decision), which by itself still runs nothing.
- **No schema-mapping or dedup-key confirmation** follows from this doc.
- **REVIEW remains `NEEDS_DISCOVERY`; dedup remains `NEEDS_VERIFICATION`; nothing is
  CONFIRMED.**
- Exercising Policy B (raw review-text storage) is a **separate, privacy-reviewed,
  separately-approved** future workstream — not part of discovery or the Gate 5 dry-run.
