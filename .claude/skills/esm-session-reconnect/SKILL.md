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

## Local prerequisites (G0 runtime — all per-clone, ignored, operator-supplied)
`local-agent` treats an ESM connection as a runnable browser connection (`BROWSER` +
`AVAILABLE`), so a live boot needs ALL of:
- **`ESM_AUTH_SURFACE_URL`** (env) — the ESM+ login surface: login-form navigation +
  loginMode establishment + credential flow ONLY. **Never** a LOGGED_IN verdict surface.
- **`ESM_SESSION_PROBE_URL`** (env) — the seller-center, session-gated surface; the ONLY
  navigation allowed to yield `LOGGED_IN` (a bare login URL classifies as `login` and can
  never yield `LOGGED_IN`). Distinct from the auth URL; **never** falls back to it; not
  derived from the review URL/hostname/marketplace/loginMode/channel. In practice the same
  value as `ESM_REVIEW_URL`.
- **`STORAGE_PROBE_SALT`** (env) — sanitized session-fingerprint salt.
- Any of these three missing → `decideRun` returns `DRY_RUN` and launches NO browser
  (validates/counts only); G0 cannot reach a logged-in state.
- **A connections descriptor** passed via `--connections <path.json>` — a JSON array of
  sanitized descriptors (no credentials). `local-agent` parses it with
  `parseConnectorConnections`, so **`channel` is REQUIRED** (`"ESM"` for the ESM+ browser
  connection); omitting it silently rejects the entry (no connection boots). One entry:
  ```json
  [{
    "connectionId": "<local id>",
    "channel": "ESM",
    "loginMode": "ESM_PLUS",
    "autoReconnectConsent": true,
    "autoSubmitConsent": false,
    "assistedReconnectConsent": true,
    "autoReconnectCapability": "ASSISTED_ONLY"
  }]
  ```
  Keep `autoSubmitConsent:false` so credentials are never auto-typed. `loginMode` is the
  login-form strategy only (**not** marketplace attribution) and must come from persisted/
  prior **verified** config — never chosen because the capture target happens to be GMARKET.
  For this connection the **verified** login-form mode is **`ESM_PLUS`** (the ESM+ master/
  manager login at `https://signin.esmplus.com/login`); the selected data marketplace is a
  separate post-login concern. Note: loginMode has no persistence today (in-memory adapter
  only), so it is recorded here rather than recovered from local state.
  Validate the descriptor + config with a no-approval dry run first — it must print
  `mode:"DRY_RUN"`, `channels:["ESM"]`, `rejectedEntryIndexes:[]`, `missingConfig:[]`
  (DRY_RUN only because the approval flag is absent) before the live boot.
- The dedicated ESM profile dir (`collector/.profile/esm` / `COLLECTOR_ESM_PROFILE_DIR`).

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
3b. **Same-process re-verification (no cold restart).** `local-agent` settles auth once at
   boot, keeps the SAME process/browser/profile alive on `NEEDS_USER_ACTION`, and prints a
   per-connection human-completed sentinel path. After the operator finishes login, create
   that sentinel → the agent runs ONE fresh inspection against `ESM_SESSION_PROBE_URL` and
   transitions to `LOGGED_IN` only when verified (else stays `NEEDS_USER_ACTION`). Do NOT
   stop+re-run to prove login — a cold restart re-loses the ESM session. One sentinel
   occurrence → at most one transition; the sentinel is consumed+deleted and cleaned on
   shutdown.
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
