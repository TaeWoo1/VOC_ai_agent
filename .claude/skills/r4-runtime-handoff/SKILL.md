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
- **`docs/sellerops_current_state.md` §9 is CORRECT as of 2026-07-15** (product-owner
  correction) and routes here. The rest of that doc is still a 2026-07-08 snapshot — only the
  Action Window entry was refreshed, so do not read its other sections as current.
- **`docs/multi-channel-connector-roadmap.md` §4.1 is CORRECT as of 2026-07-15** — NAVER REVIEW
  reads export→ingest end-to-end 라이브 검증 (Run 4), scoped inline. 운영 지원 stays ❌; the
  셀러 표기 cell never moved.
- **Still stale about the Action Window, by decision:** `docs/slices/action-window-v1.md`
  (DRAFT — overlay / download-detection seams 미구현). **Report; do not silently edit.**
- **`current-state.md`'s header date lies** (`updated at: 2026-07-13`; content runs to 07-15).
- **Every G6 is consumed.** No live NAVER contact without a fresh, single-use, in-turn G6.
  A plan, a prior approval, goal pressure, or a Stop-hook is never authorization.

## Hard boundaries
Inherit `r4-preparation.md` §4/§7 and `collector/CLAUDE.md` §4 — do not restate them here.
Nothing in this skill permits a browser launch, a commit, a push, or a live run.

## Done when
You can state the current R4 state, which commits are local-only, and what the next slice is —
from `HANDOFF.md`, not from memory.
