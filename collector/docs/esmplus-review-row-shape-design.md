# ESM Plus — REVIEW minimal row-shape analyser (Gate 5 offline design)

> **Design only — no code in this slice.** Type sketches below are *proposed shapes*
> to make the design precise for the later implementation slice; no module is created
> or run here. Obeys [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md)
> Policy A (discovery no-raw) in full. **REVIEW stays `NEEDS_DISCOVERY`; dedup stays
> `NEEDS_VERIFICATION`; nothing CONFIRMED.**
>
> Companion to: [`esmplus-review-export-discovery.md`](./esmplus-review-export-discovery.md)
> (Gate ladder), [`esmplus-review-dedup-strategy-design.md`](./esmplus-review-dedup-strategy-design.md)
> (the composite-key candidates this analyser evaluates). This is **slice 2** of the
> approved Gate 5 plan; slice 3 implements it offline with synthetic fixtures.

## Purpose

Gate 4/4b read **header shape only** and could not pick representative columns or test the
"no stable ID" assumption. Gate 5 reads the **first N data rows** and reduces each cell to
**sanitized signals** (presence / value-class / salted hash / per-column distinctness) so
the dedup candidates (L1/L2/L3) can be evaluated from real row behaviour — **without** ever
emitting a raw value. This is the analyser that the slice-4 live dry-run plugs into the
existing `saveAndInspectDownload<R>` `inspectFn` seam.

## Module shape (reuse first; one new sibling module)

- **Extend** `src/esm/esm-review-xlsx-reader.ts` — additive first-N-row read (header path
  byte-for-byte unchanged). Reuse `readZipEntries`, `parseSharedStrings`,
  `columnLetterToNumber`, `decodeXml`; generalise the existing header-cell resolution to
  data cells.
- **New** `src/esm/esm-review-row-shape.ts` — the **pure** sanitiser, sibling to
  `esm-review-schema-shape.ts` (which stays untouched). Reuse `categorizeHeader`,
  `HEADER_CATEGORIES`, `rowCountBucket`, and the salted-hash algorithm currently in
  `headerHash` (generalise it to a shared `saltedHash(salt, raw)` — same normalise-first,
  16-hex, non-reversible recipe).
- **Raw in / sanitized out** contract is identical to the schema-shape module: raw cells
  arrive as INPUT ONLY, live in local scope, and are reduced immediately — never copied
  into output. `JSON.stringify` of any result is leak-free by construction.

## Reader extension (column-aligned, additive)

`scanSheetXml` today returns only `firstRowCells`. Add an opt-in cap:

```ts
// proposed — additive; maxDataRows omitted/0 ⇒ today's header-only behaviour
scanSheetXml(sheetXml: string, maxDataRows?: number): {
  rowCount: number;
  dimensionColumns: number | null;
  firstRowCells: Cell[];        // header row (unchanged)
  dataRows?: Cell[][];          // first ≤ maxDataRows data rows, when requested
}
```

**Column alignment (new requirement):** the header row is dense, but xlsx **omits empty
data cells**, so data rows must be placed by their cell reference. Parse each `<c r="C2">`
ref → `columnLetterToNumber` → a fixed-length `Array<string|null>` of `columnCount`, where
`null` = absent/empty in that column. (Headers can keep the existing positional resolve.)
The reader hands the analyser raw, column-aligned cells; it never classifies or hashes.

```ts
// proposed reader → analyser handoff (raw, INPUT-ONLY; never emitted)
interface RawRowSample {
  cells: ReadonlyArray<string | null>;   // length == columnCount, column-aligned
}
interface WorkbookRowSample extends WorkbookShape {     // WorkbookShape reused as-is
  sampleRows: readonly RawRowSample[];   // first N populated data rows, RAW
}
```

## Sample size N

- **N = 3** (default), capped small (hard ceiling, e.g. ≤ 5). Rationale: dedup
  discrimination is a *shape* question — 2–3 rows reveal populated/empty and
  same/distinct without needing volume, and a small N minimises PII exposure even in
  local scope. Only **populated** data rows count toward N (skip fully-blank rows).
- N is an **open decision** revisited in slice 3 if 3 rows prove too few to read
  distinctness; kept configurable, default 3.

## Per-cell value classification (pure, coarse)

```ts
type CellValueClass =
  | "empty"
  | "numeric-small"   // short integer (e.g. rating, small code)
  | "numeric-long"    // long all-digit run (order-no / id-like)
  | "date-like"       // YYYY[-./]MM[-./]DD, optional time
  | "id-like"         // compact alphanumeric token, no spaces, digits+letters
  | "text-short"      // letters/hangul, short
  | "text-long";      // long free text (review body)
classifyCellValue(raw: string | null): CellValueClass;   // null/blank ⇒ "empty"
```

- Classification is **coarse and value-blind in output** — only the *class label* leaves
  the module, never the value. Thresholds (short/long boundaries) are tuned in slice 3
  against synthetic fixtures.
- `enum-like` is **not** a per-cell class — it is derived at the **column** level
  (low distinctness + short class), see below.

## Per-column aggregation (sanitized output)

For each column, over the N sampled rows:

```ts
interface SanitizedColumnRowShape {
  headerHash: string;                 // reuse saltedHash(salt, header)
  category: HeaderCategory;           // reuse categorizeHeader
  populated: "none" | "some" | "all"; // populated cells across the N rows
  valueClass: CellValueClass | "mixed";   // dominant class, or "mixed"
  distinctness: "all-same" | "some-distinct" | "all-distinct" | "n/a";
  enumLike: boolean;                  // low distinctness + short/numeric-small class
  // per-cell salted hashes, for cross-row/cross-export equality reasoning.
  // OMITTED for orderOrBuyerRiskCandidate columns (Policy A) — see below.
  valueHashes?: readonly string[];
}
```

- **`distinctness`** (computed internally from per-cell salted hashes) is the core
  dedup-discriminator: `all-distinct` ⇒ high entropy (good key component);
  `all-same` ⇒ low entropy (collision risk). It is a **bucket**, never a count.
- **PII columns (`orderOrBuyerRiskCandidate`)**: emit `populated` + `valueClass` only —
  **no `valueHashes`** (Policy A default). Whether even a `distinctness` **bucket** is
  emitted for PII columns is an **open decision** (default: omit; revisit only under a
  privacy review). Internal hashing for non-PII distinctness stays in local scope.
- **Date columns** follow the recency chain: a `date-like` cell's component is
  `saltedHash(norm(date))` internally; timezone-less ⇒ treated as `unknown` (no KST
  assumption); raw timestamps / elapsed durations never emitted.

## Dedup-candidate evaluation (derived, still NEEDS_VERIFICATION)

The analyser folds the per-column signals into a sanitized verdict on the dedup tiers
(it **evaluates feasibility**, it does **not** confirm a key):

```ts
interface DedupFeasibility {
  l1Feasible: boolean;  // date + product + rating + reviewText all populated & discriminating
  l2Feasible: boolean;  // date + product + rating populated & discriminating (text droppable)
  l3Only: boolean;      // only channel·store·date·product reachable ⇒ collision-risk
  idColumnSuspected: boolean;  // an unknown/id-like column is all-distinct & compact
  notes: readonly string[];    // sanitized tokens, e.g. "reviewText-empty-on-some-rows",
                               // "rating-all-same", "unknown-col-id-like-all-distinct"
}
```

- **`idColumnSuspected`** directly answers the open Gate-4 question: if one of the 2
  `unknown` columns is `id-like` **and** `all-distinct`, a single natural key may exist and
  the composite emphasis relaxes (feeds back into the dedup design). Still a *suspicion*,
  not a confirmation.
- **replyStatus** is reported as a column (likely `enum-like`, low distinctness) but is
  **excluded** from every tier — identity must not depend on a mutable attribute.

## Honest markers (deliberately different from schema-shape)

Schema-shape emits `rowsParsed: false`. Gate 5 **does** minimally parse rows, so its output
must say so honestly while still proving no leak / no confirmation:

```ts
{
  rawCellLeak: false,            // no raw cell value emitted (asserted by source-guard + tests)
  minimalRowsInspected: true,    // honest: cells WERE read (unlike schema-shape)
  sampledRowBucket: RowCountBucket,  // how many rows sampled (≤ N), bucketed
  uploaded: false,
  schemaMappingConfirmed: false,
  dedupKeyConfirmed: false,
}
```

## Composition with the capture harness (slice 4, not this slice)

- A new opt-in flag `--probe-row-shape` (separate from `--inspect-schema-shape`) selects a
  row-shape `inspectFn` via the **existing** `saveAndInspectDownload<R>` seam — no change to
  the save module (its generic `R` already supports it).
- The row-shape inspector has the workbook in hand, so it returns a **combined**
  `{ schemaShape, rowShape }` (schema-shape is a strict subset of what it already reads).
- All Gate 3/4 invariants carry over unchanged: exactly one click, one download wait,
  inspect-before-delete, **delete in `finally`**, observe-and-discard, no
  upload/DB/status/scheduler/manualSync, human-only auth.

## Invariants & source-guard (for slice 3)

- The analyser imports only `node:crypto` (hashing) + types; the reader stays
  **dependency-free** (`node:fs`, `node:zlib` only) — `package.json` / lock unchanged.
- **No** import of upload / status / scheduler / manualSync / playwright / backend modules
  (mirror the existing `module purity` source-guard tests in the schema-shape/derive tests).
- Output type carries **no** raw-string field; raw cells exist only as function inputs and
  local variables.

## Test plan (executed in slice 3)

Per the approved plan §8 — synthetic fixtures with safe FAKE values (incl. fake PII-like
columns mirroring the 14-col layout); assert no PII-like value ever appears in output,
hashes emitted instead of raw values, only row-count **buckets** present, exact rows never
printed; determinism (same fixture+salt ⇒ same hashes; different salt ⇒ different);
`valueClass` / `distinctness` / `enumLike` correct on crafted all-same / all-distinct /
empty / date-like / id-like rows; source-guard (no forbidden imports, no live browser).

## Open decisions (carried to slice 3)

- **N** (default 3) — raise only if 3 rows can't reveal distinctness.
- **PII distinctness** — whether `orderOrBuyerRiskCandidate` columns get a `distinctness`
  bucket (default: omit; privacy-review-gated).
- **`valueClass` thresholds** — short/long boundaries tuned against fixtures.
- **`enum-like` rule** — exact distinctness/length cutoff.

## Status

Design only. No code, no live work, no capability change. **REVIEW remains
`NEEDS_DISCOVERY`; dedup remains `NEEDS_VERIFICATION`; nothing is CONFIRMED.** Slice 3
(offline implementation + synthetic tests) and slice 4 (live dry-run) are each separately
approved.
