---
name: esm-session-reconnect
description: Reach a valid authenticated ESM+ (Gmarket/Auction) browser session via the established dedicated-profile + assisted-reconnect orchestration, with correct loginMode, human-only auth, and sanitized success checks. Use BEFORE any ESM live discovery/capture as the G0 foundation. Never captures data; never bypasses CAPTCHA/2FA.
---

# ESM session / reconnect (G0 foundation)

Purpose: get to a valid authenticated ESM+ session **before** any discovery or capture,
using the project's established orchestration — not a one-off tool. This is gate **G0** in
[`docs/esm/live-capture-plan.md`](../../../docs/esm/live-capture-plan.md).

## Established code (use this, do not reinvent)
- Dedicated profile: `collector/.profile/esm` (env `COLLECTOR_ESM_PROFILE_DIR`); launched
  headed via `launchPersistentBrowser` (`collector/src/profile.ts`) — path-guarded to the
  collector tree.
- Reconnect policy + runtime: `collector/src/agent/progressive-reconnect.ts`,
  `progressive-reconnect-runtime.ts`, `progressive-reconnect-chrome.ts`.
- Same-session reconnect pre-step: `collector/src/naver/reconnect-resolve.ts`
  (`resolveReconnectIfNeeded`).
- loginMode model: `LoginMode = ESM_PLUS | GMARKET | AUCTION`
  (`collector/src/agent/local-agent-state.ts`); form strategy `ESM_PLUS→DIRECT`, else
  `DOCUMENT_START_BOOTSTRAP`.

## Procedure
1. **Optimistic session reuse.** Open the dedicated profile and check the session verdict
   first — a warm profile often stays logged in (observed across restarts). If logged-in on
   the seller-center host, G0 passes with no auth action.
2. **Correct loginMode establishment.** If login is needed, establish the connection's
   `loginMode` (per-connection metadata, not a global constant) so the right login form is
   used. `loginMode` is only the login path — never marketplace attribution (see D4).
3. **Assisted fallback only.** On `RECONNECT_REQUIRED`, use the assisted reconnect flow
   (human completes the continue-card / account step). Reconnect capability is
   `ASSISTED_ONLY` — a human must re-authenticate; do not claim unattended reconnect.
4. **CAPTCHA/2FA stop conditions.** Any challenge (`captcha`, `otp`, `2단계`, login form)
   halts to manual. Never bypass, never type credentials, never automate the challenge.
5. **Sanitized success check.** Confirm readiness from booleans/category enums only
   (session verdict, seller-center URL category, logout/menu affordance). Never read or
   print account/store/seller identity, cookies, tokens, or page content.

## Hard boundaries
- No data capture, no export, no upload, no DB write, no `LAST_SUCCESS`/status write in G0.
- Cold restart may require re-login; treat cold-restart persistence as unproven (record it
  as a gap, do not assert it).
- One live run = one explicit per-run approval. Never on a schedule or standing auth.

## Done when
Session verdict is logged-in on the ESM+ seller-center host, reached through the established
orchestration, with zero data read. Hand off to `supervised-candidate-index-probe` for G1.
