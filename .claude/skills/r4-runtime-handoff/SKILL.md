---
name: r4-runtime-handoff
description: Orient a cold session on the SellerOps R4 Action Window NAVER Runtime — current state, live-run history, gates, and what is committed vs local-only. Read BEFORE any R4 / Action Window / NAVER runtime work, and before trusting any doc that describes Action Window status. Routes to the canonical docs; grants no live action.
---

# R4 Action Window Runtime — handoff orientation

Purpose: reach an accurate picture of this workstream **before** planning or touching it.
This skill authorizes nothing — it is a map, not a gate.

Canonical entry point: [`docs/action-window-runtime/HANDOFF.md`](../../../docs/action-window-runtime/HANDOFF.md).
Read it first; everything below is only what that file cannot protect you from.

## Read order
1. `docs/action-window-runtime/HANDOFF.md` — state, live-run results, git state, next slice.
2. `current-state.md` — living detail. **Read the `UPDATE` segments, not the `updated at:` header.**
3. `r4-evidence-pack.md` — §8-N dated evidence. §8-17 is Run 4.
4. `r4-preparation.md` — normative: §3 gates G1–G6, §4 safety boundary, §7 abort criteria.

## Tripwires (verified 2026-07-15 — a cold session gets these wrong)
- **`docs/sellerops_current_state.md` is WRONG about the Action Window.** It is the root
  `CLAUDE.md` reading order's designated handoff doc but predates Run 1 (last touched
  2026-07-08) and asserts `Action Window는 계약만(미구현)` / `구현 없음`. **Run 4 proved the
  NAVER export path end-to-end on the real surface on 2026-07-15** (§8-17). For Action Window
  status, `docs/action-window-runtime/` wins. Report the conflict; do not silently edit that
  canonical doc — correcting it is a product-owner decision.
- **`current-state.md`'s header date lies** (`updated at: 2026-07-13`; content runs to 07-15).
- **Every G6 is consumed.** No live NAVER contact without a fresh, single-use, in-turn G6.
  A plan, a prior approval, goal pressure, or a Stop-hook is never authorization.

## Hard boundaries
Inherit `r4-preparation.md` §4/§7 and `collector/CLAUDE.md` §4 — do not restate them here.
Nothing in this skill permits a browser launch, a commit, a push, or a live run.

## Done when
You can state the current R4 state, which commits are local-only, and what the next slice is —
from `HANDOFF.md`, not from memory or from `docs/sellerops_current_state.md`.
