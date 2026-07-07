---
name: supervised-candidate-index-probe
description: Locate an on-page control (e.g. a marketplace selector) under human supervision by visibly badging clickable candidates with index numbers, reporting sanitized metadata, then clicking EXACTLY ONE operator-approved index and rescanning to verify — no premature verdict, no data capture. Use for ESM/live selector discovery (gates G1–G2). Pairs with esm-session-reconnect (run that first).
---

# Supervised candidate-index probe (G1–G2)

Locate and verify an on-page control under human supervision, safely. Used to find and
verify the ESM+ review marketplace selector. Gates G1 (selector discovery) and G2
(selected-marketplace verification) in
[`docs/esm/live-capture-plan.md`](../../../docs/esm/live-capture-plan.md).

**Badge indices are per-run, never a durable selector.** A given run's approved index and
evidence belong in the checklist, not here. Never hardcode "GMARKET is index 0" (or any
index/selector) — the page can reorder or change. Every run re-discovers from scratch:
rescan → badge → present sanitized candidates → obtain explicit approval for *that run's*
index → click exactly one → rescan and verify the post-click state.

Prerequisite: a valid session via `esm-session-reconnect`. This probe reads only; it never
logs in and never captures records.

## Procedure
1. **Badge candidates visibly.** In the live page, stamp each clickable/selectable
   candidate (`button, a, [role=button|tab|option|menuitem|radio], input[type=radio],
   select, [role=combobox|listbox]`) with a `data-*-index` attribute AND draw a small
   fixed-position index badge on screen (pointer-events:none so it never intercepts a
   click), so the operator can map an index to a real on-screen control.
2. **Report sanitized candidate metadata only.** Per candidate emit: index, structural role
   (tag/role/type), matched marker categories (from a fixed vocabulary), a *safe* label
   echoed ONLY when it equals a fixed known token (else `[redacted]`), selected-state,
   visible, enabled, coarse context (header-nav/tablist/listbox/toolbar/other). Never a
   store/account name, review/inquiry text, raw label, or raw URL.
3. **Scan all pages + readable frames.** Tools open in popups/tabs; scan every page and
   every same-origin frame. Report per-frame diagnostics (URL category, read outcome) so a
   zero result is explainable, not silent. Skip cross-origin frames (count them).
4. **Handle hover menus.** If items are only visible on hover, park the mouse on the trigger
   (a `hover` step) and rescan WITHOUT moving the mouse, so the revealed items get badges.
5. **Explicit one-index approval.** Present the candidate list; take exactly one operator-
   approved index. **Never click without explicit approval.**
6. **Exactly one click.** Bind the single stamped element (assert count === 1) and click
   once (force only when the target is hover-hidden). No fallback second click.
7. **Post-click rescan + verify.** Rescan and read independent sanitized signals
   (selected-tab state + selected-label + URL site-param + heading). Verification passes
   only when the visible state PLUS ≥1 additional signal agree on the target.
8. **No premature verdict.** Do not assert success from a single signal or before the
   rescan. Report `NEITHER`/`BOTH`/`unknown` honestly.
9. **Quit + cleanup.** Support a quit command; on exit remove sentinel/command files and
   close the browser cleanly. A multi-step selection (open menu → click item) loops in the
   SAME session rather than relaunching (avoids re-login).

## Continuation across turns
Drive the probe with small command files (ready / rescan / hover / approve / quit) polled by
a backgrounded run, so a supervised, human-attended flow survives across turns.

## Serialization gotcha (must-follow)
Functions passed to Playwright `evaluate` must be **flat** — no inner named
functions/arrows. The tsx/esbuild `keepNames` transform injects `__name(...)` helper calls
into inner named functions; those calls are serialized into the page (where `__name` is
undefined) and throw a `ReferenceError`. Inline all helper logic. Verify by transpiling and
asserting no `__name(` appears inside the evaluated function body.

## Hard boundaries
- Read-only: no export, no record read, no upload, no DB write, no status write.
- Marketplace attribution only from a verified page signal (see `decisions.md` D7) — never
  from hostname, loginMode, or channel code.
- One live run = one explicit per-run approval; a human handles all auth.
