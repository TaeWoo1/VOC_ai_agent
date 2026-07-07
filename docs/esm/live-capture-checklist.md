# ESM+ Live Capture — Checklist

Living status for the four independent targets and the shared foundation. Gate definitions
and pass criteria: [`live-capture-plan.md`](./live-capture-plan.md).

For every **completed** item record: date · commit · command/tool · sanitized evidence
location · pass criteria · next single action. Do not mark record capture complete until a
bounded capture has actually read records.

Legend: `[x]` done · `[~]` partial/in-progress · `[ ]` not started.

## Shared foundation

- `[~]` **Session / reconnect foundation (G0)**
  - The dedicated ESM profile (`collector/.profile/esm`) exists and retained a warm session
    across restarts during 2026-07-07 diagnostics.
  - Gap: these diagnostic launches bypassed the established reconnect orchestration
    (`progressive-reconnect*`); the durable path is promoted in skill `esm-session-reconnect`.
  - Next single action: run G0 through the established reconnect orchestration (not a one-off).

## Target 1 — GMARKET × REVIEW

- `[x]` **Selector discovery (G1)**
  - date: 2026-07-07 · commit: `ecc4786` (worktree; diagnostic later removed)
  - command/tool: supervised candidate-index probe (badge-by-index scan on the ESM+
    review-management surface)
  - evidence: sanitized scan JSON (ephemeral background-task output; not persisted)
  - pass criteria: a marketplace selector control identified by sanitized candidate
  - result: selector is a **tablist** — badge **index 0 = GMARKET**, index 1 = AUCTION
  - next single action: (done → G2)
- `[x]` **Selected-marketplace verification (G2)**
  - date: 2026-07-07 · commit: `ecc4786` · tool: supervised candidate-index probe
  - command: this run's GMARKET tab (badge index 0 in this run) **clicked exactly once**,
    then rescan + safe signals
  - evidence: sanitized CLICK verdict — `clickedMarker=[GMARKET,MARKET]`;
    clicked tab **became selected** (`clickedSelected=selected`); selected-label signal
    resolved to **GMARKET** (`selectedLabelSignal=GMARKET`); **URL and heading provided no
    marketplace attribution** (`urlParamSignal=NEITHER`, `headingSignal=NEITHER`)
  - zero-writes: **no record read, no export, no upload, no DB write, no status write**
  - pass criteria: visible tab state **plus** ≥1 additional safe signal indicate GMARKET →
    **met** (tab `selected` + selected-label `GMARKET`)
  - note: badge index 0 = GMARKET is a **this-run** fact, not a durable selector; every run
    re-discovers via the candidate-index probe
  - next single action: **G3 — bounded capture (≤5 records), presence-only** (not yet run)
- `[ ]` **Bounded capture (G3)** — NOT started (no review records have been read)
- `[ ]` **Stable identity (G4)**
- `[ ]` **Field mapping (G4)**
- `[ ]` **Deduplication (G5)**
- `[ ]` **Persistence (G6)**
- `[ ]` **Cold-restart rerun (G7)**
- `[ ]` **Production promotion (G8)**

## Target 2 — AUCTION × REVIEW

- `[~]` **Selector discovery (G1)** — the AUCTION tab was observed as badge **index 1** on
  the same tablist during Target-1 discovery, but was **not** clicked or verified.
  - next single action: verify AUCTION selection (G2) under separate approval — **do not
    start until GMARKET × REVIEW capture is proven**.
- `[ ]` Selected-marketplace verification (G2)
- `[ ]` Bounded capture (G3) · `[ ]` Stable identity (G4) · `[ ]` Field mapping (G4) ·
  `[ ]` Deduplication (G5) · `[ ]` Persistence (G6) · `[ ]` Cold-restart rerun (G7) ·
  `[ ]` Production promotion (G8)

## Target 3 — GMARKET × INQUIRY

- `[~]` **Selector discovery (G1)** — no live-browser capture path exists; a single Gate-1
  **visual** navigation confirmed the inquiry surface + controls (sanitized booleans only).
  API side is an offline seam.
  - next single action: constrained Gate-2 read-only probe (per
    `docs/sellerops_phase0_esm_inquiry_gate1_findings.md §3`) — separate approval.
- `[ ]` G2 · `[ ]` G3 · `[ ]` G4 identity · `[ ]` G4 mapping · `[ ]` G5 · `[ ]` G6 ·
  `[ ]` G7 · `[ ]` G8

## Target 4 — AUCTION × INQUIRY

- `[ ]` **Selector discovery (G1)** — nothing done; no visual nav, no code.
- `[ ]` G2 · `[ ]` G3 · `[ ]` G4 identity · `[ ]` G4 mapping · `[ ]` G5 · `[ ]` G6 ·
  `[ ]` G7 · `[ ]` G8

## Current single next action (whole track)

**Target 1 / G3 — bounded review capture (≤5 records, presence-only) for GMARKET × REVIEW**,
under explicit per-run approval, after G0 is re-established through the reconnect
orchestration.
