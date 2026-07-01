# ESM Plus — REVIEW header-label capture protocol (offline design)

> **Design only — no code, no capture, no live work, no capability change in this
> slice.** This doc *specifies* a future, separately-approved header-label capture and
> the **narrow, scoped exception** it would need to today's no-raw-header rule. It does
> **not** grant that exception, run any capture, or edit the binding policy doc — adopting
> the exception is an explicit operator decision (see §3). **REVIEW stays
> `NEEDS_DISCOVERY`; dedup stays `NEEDS_VERIFICATION`; nothing is CONFIRMED.**
>
> Related: [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md) (Policy A /
> Policy B), [`esmplus-review-row-shape-design.md`](./esmplus-review-row-shape-design.md)
> (the reader/analyser seam this reuses),
> [`esmplus-review-dedup-strategy-design.md`](./esmplus-review-dedup-strategy-design.md)
> (§3 privacy rules), [`esmplus-review-export-discovery.md`](./esmplus-review-export-discovery.md)
> (Gate ladder + sanitized results).

## Why this doc exists

The backend `ReviewRowMapper` maps review columns by **header label alias**
(`HeaderAliases.pick`, one flat channel-agnostic list). Backend Slice 1 (merged) added
synthetic ESM+ mapper tests but **no production aliases**, because under the current no-raw
rule we have **never recorded the literal ESM+ REVIEW header strings** — only sanitized
*category tallies* (reviewText×3, product×2, reviewDate×2, rating×1, replyStatus×1,
orderOrBuyerRisk×3, unknown×2) over a stable 14-column layout. So `schemaMappingConfirmed`
stays `false` and the Slice 1 tests are **canaries** documenting the gap.

To ground the aliases in reality — not guesses — we need the **literal header label
strings**. This doc specifies the smallest, safest way to obtain exactly those, and nothing
more. It is step 1 (design) of the approved slice ladder; the live capture (step 2) and the
grounded-alias edit (step 3) are each separately approved.

## 1. What this capture would obtain (and only this)

- The **header row label strings** of a REVIEW export — the ~14 literal column headers.
- A per-header **Unicode normalization-form** signal (NFC vs NFD) — see §6.
- Nothing else. **No data rows. No cell values. No buyer/order/contact values. No exact
  row/column counts (buckets only, as today).**

Header labels are **schema metadata** — the names of columns — not buyer content and not
PII. That distinction is the whole basis for §3.

## 2. Reuse, don't build (module seam)

The Gate 5 row-shape reader already isolates the header row:

- **Reader:** `src/esm/esm-review-xlsx-reader.ts` → `scanSheetXml(sheetXml, maxDataRows?)`
  already returns `firstRowCells` (the header row) independently of `dataRows`. A header
  capture calls it with **`maxDataRows = 0`** ⇒ header row only, **no data cells ever read**.
- **Harness seam:** the existing `saveAndInspectDownload<R>` `inspectFn` seam (same one
  `--inspect-schema-shape` / `--probe-row-shape` use) hosts a header-label `inspectFn`
  behind a **new, separate opt-in flag** (proposed `--capture-review-headers`). No change to
  the save module.
- **All Gate 3/4 capture invariants carry over unchanged:** exactly one click, one download
  wait, inspect-before-delete, **delete in `finally`**, observe-and-discard, **no
  upload / DB / status / capability write, no scheduler / `manualSync`, human-only auth.**

The header labels are read into **local scope only**, emitted to the quarantine artifact
(§4), then the export is deleted in `finally`. The workbook is never retained.

## 3. The narrow exception this requires (ADOPTED as policy; capture still separately approved)

Policy A's **core** rule — *never emit raw row/cell values* (review text, product names,
buyer/order/contact values, ratings tied to a row, raw dates) — is **absolute and stays
fully intact**; this capture reads **zero** data cells, so it does not touch that core at
all.

What it *does* touch is the **extension** of "no raw" to **header text** (dedup design §3:
"No raw header text"; row-shape design emits headers only as salted `headerHash`). Recording
the literal header labels crosses that header-text extension. So this capture needs a
**narrow, explicit, one-time carve-out**, scoped as:

- **Applies to:** REVIEW **header label strings only**, written **only** to the confined
  local artifact of §4.
- **Does NOT relax:** the raw row/cell-value prohibition (still absolute), PII handling, the
  no-raw rule on **all normal surfaces** (logs, terminal, committed docs, git diffs, tests,
  chat) — those still get sanitized signals only (§5).
- **Adopted (2026-07-01):** this carve-out has since been **adopted** as a policy decision in
  [`esmplus-review-data-policy.md`](./esmplus-review-data-policy.md) → *"Policy A — narrow
  header-label carve-out"*. Adoption is a **policy decision only**: it still runs no capture,
  adds no `--capture-review-headers` flag, and writes no artifact — the offline code slice and
  the live run remain **separately approved** downstream steps.

Rationale for why this is acceptable to *propose*: header labels are low-sensitivity schema
metadata (column names, identical for every seller using the same export), captured once,
and confined to a gitignored local file an operator reviews — categorically different from
buyer review content, which remains untouchable.

## 4. Confinement, not sanitization (where labels go)

The labels **are** the payload, so they cannot be sanitized away — the mitigation is
**confinement**:

- Written **once** to a **gitignored, local, operator-reviewed** artifact:
  proposed `collector/findings/esm-review-header-labels.local.md` (the existing
  `findings/*.local.md` quarantine class — already gitignored for account-specific notes).
- **Never** copied into: logs / terminal stdout, committed docs, git diffs, test
  fixtures/snapshots, or chat/LLM output.
- **Retention/deletion:** the artifact is disposable — kept only long enough to author the
  grounded-alias edit (step 3), then deleted. It is never committed, never uploaded.

## 5. What surfaces on normal (sanitized) surfaces

Everything except the confined artifact stays Policy-A sanitized — only:

- header **count** (a small structural count / bucket, as today);
- per-header **category** (reuse `categorizeHeader` / `HEADER_CATEGORIES`);
- per-header **NFC/NFD normalization form** (§6) — a form enum, not the label;
- a boolean **`headerLabelsCaptured`** ("labels written to the local artifact");
- the honest markers from row-shape (`rawCellLeak: false`, `uploaded: false`,
  `schemaMappingConfirmed: false`, `dedupKeyConfirmed: false`).

A source-guard test (mirroring the row-shape / schema-shape module-purity tests) asserts the
sanitized output type carries **no** raw-string field and the module imports no
upload/status/scheduler/manualSync/backend path.

## 6. Why the NFC/NFD signal matters

The backend `FileParser.normalizeHeader` does **BOM-strip + trim + lowercase, but NO NFC
normalization**. Korean headers can arrive **NFD-decomposed**; an alias typed in source
(NFC) would then **fail to match** an otherwise-identical NFD runtime header. Capturing each
header's normalization **form** (an enum — never the label itself) tells the grounded-alias
slice which fix it needs:

- if ESM+ headers are **NFC** → aliases as-typed match; no `FileParser` change;
- if **NFD** → either add NFC normalization to `FileParser` (touches **all** channels — a
  larger, separately-scoped change) or store NFD-form aliases.

This is a Policy-A-safe signal (a form label, not content) and de-risks step 3 before any
mapper edit.

## 7. Follow-on grounded-alias slice (step 3 — named, NOT executed)

After a successful capture, a separate backend slice would:

- append the **BOM-stripped / trimmed / lowercased** ESM+ literals to the existing flat
  vararg alias lists in `ReviewRowMapper` (body / product / sku / rating / date / externalId)
  — no change to `HeaderAliases.pick`;
- **flip the Backend Slice 1 canary assertions** in `RowMapperTest` (the `null`/default
  expectations become mapped) — the intended signal that the gap closed;
- decide, with the capture in hand, the two open questions the flat channel-agnostic list
  raises: **flat vs. `channelCode`-threaded** aliases (cross-channel collision risk) and
  **NFC handling** per §6.

That slice is **not** part of this design and needs its own approval.

## 8. Non-goals (hard)

- **No capture is run** by this doc; no live browser, no click/download, no
  open-live-ESM.
- **No data-cell read**, ever — header row only (`maxDataRows = 0`).
- **No upload, no DB / status / capability write, no scheduler / `manualSync`.**
- **No mapper / migration / test / production-code change** in this slice — docs only.
- **No edit to the binding policy doc** — §3's carve-out is *proposed*, adoption is a
  separate operator decision.
- **No schema-mapping or dedup-key confirmation** follows from this doc.

## Status

Design only. **REVIEW remains `NEEDS_DISCOVERY`; dedup remains `NEEDS_VERIFICATION`;
`dedupKeyConfirmed: false`; `schemaMappingConfirmed: false`; nothing is CONFIRMED.** The live
header capture (step 2) and the grounded-alias edit (step 3) are each separately approved.
