# ESM+ Live Capture — Checklist

Living status for the four independent targets and the shared foundation. Gate definitions
and pass criteria: [`live-capture-plan.md`](./live-capture-plan.md).

For every **completed** item record: date · commit · command/tool · sanitized evidence
location · pass criteria · next single action. Do not mark record capture complete until a
bounded capture has actually read records.

Legend: `[x]` done · `[~]` partial/in-progress · `[ ]` not started.

## Shared foundation

- `[x]` **Session / reconnect foundation (G0) — PASSED 2026-07-07 (isolated worktree
  `ops/esm-live-g0`, main `ab55501` + uncommitted A+B slice).**
  - Verified `LOGGED_IN` via the established orchestration with **same-process** re-verification
    (no cold restart): LIVE_BOOT → settle `NEEDS_USER_ACTION` / `MANUAL_LOGIN` /
    `COMPLETE_MANUAL_LOGIN` → operator completed ESM_PLUS login in the open browser → per-connection
    human-completed sentinel → one fresh inspection against `ESM_SESSION_PROBE_URL` →
    `HUMAN_COMPLETED_REVERIFY localAgentState=READY`. Clean shutdown, no writes, sentinel consumed once.
  - command/tool: `local-agent --connections <.connections/esm.json>
    --i-understand-this-launches-local-agent-chrome` (progressive-reconnect); loginMode `ESM_PLUS`
    (verified login-form mode, not from the capture marketplace).
  - The two-disconnect root cause (below) was resolved by the A+B slice: (A) `inspectSession()` now
    classifies the seller-center `ESM_SESSION_PROBE_URL` (login page can never yield `LOGGED_IN`);
    (B) a production `humanCompleted` trigger wired into `local-agent` via a per-connection sentinel.
  - Next single action: **profile-alignment check before G3** — verify whether the capture CLI can be
    pointed at `local-agent`'s resolved `esm-agent-<hash>` profile (deferred; not solved in this slice).
    Do not proceed to G2/G3 without approval.
  - Historical context (dedicated profile / prior blocker):
  - Gap: these diagnostic launches bypassed the established reconnect orchestration
    (`progressive-reconnect*`); the durable path is promoted in skill `esm-session-reconnect`.
  - **G0 run 2026-07-07 (main `ab55501`, isolated worktree `ops/esm-live-g0`): RAN via the
    established orchestration; NOT a pass — assisted reconnect (human login) required.**
    - prerequisites resolved: `ESM_AUTH_SURFACE_URL=https://signin.esmplus.com/login`
      (public ESM+ master/manager login surface), `loginMode=ESM_PLUS`. **loginMode is the
      verified login-form mode for this connection — NOT inferred from the GMARKET capture
      target** (marketplace selection is a separate post-login concern).
    - command/tool: `npx tsx src/cli/local-agent.ts --connections <ignored .connections/esm.json>
      --i-understand-this-launches-local-agent-chrome` (progressive-reconnect via the
      Connector Orchestrator). Descriptor validated by a no-approval dry run:
      `mode:DRY_RUN, channels:["ESM"], rejectedEntryIndexes:[], missingConfig:[]`.
    - sanitized G0 result: `outcome=NEEDS_USER_ACTION`, `authStatus=RECONNECT_REQUIRED`,
      `reconnectPath=ASSISTED_CREDENTIAL_SELECTION`, `pendingUserAction=SELECT_SAVED_CREDENTIAL`.
    - reuse vs assisted: **assisted** — the isolated worktree has a fresh dedicated profile
      (no `.profile/esm` reuse; note `local-agent` uses its own `esm-agent-<hash>` profile,
      distinct from the classify/capture CLIs' `.profile/esm`), so optimistic reuse found no
      session and the established assisted flow reached the login gate. No CAPTCHA/2FA
      encountered; no credentials auto-typed (`autoSubmitConsent:false`).
    - pass criteria (verified logged-in seller-center) **not met.** Human completed the
      ESM_PLUS login in the open browser; the agent was stopped cleanly (session persisted to
      the profile) and re-run. The re-run STILL settled `RECONNECT_REQUIRED`
      (`pendingUserAction=ENTER_MISSING_USERNAME`) — optimistic reuse did NOT report
      `LOGGED_IN`.
  - **G0 BLOCKER — precise root cause (2026-07-07 implementation-history audit):** two
    disconnects in the *existing* progressive-reconnect stack, not a config gap and not
    fundamentally cold-restart:
    - **(1) The logged-in probe classifies the LOGIN page.** `inspectSession()` re-navigates
      to `ESM_AUTH_SURFACE_URL` (`…/login`) and classifies it
      (`progressive-reconnect-chrome.ts:185-187`). `esmUrlCategory` matches the login route
      first, so category is `"login"`, never `"seller-center"`; `classifySessionVerdict`
      requires `isSellerCenterUrl` for `LOGGED_IN` (`session-verdict.ts:79-81`). ⇒ `LOGGED_IN`
      is **structurally unreachable** on the auth surface (a false-*negative*, not a false
      positive) — an active session is invisible to the reconnect probe.
    - **(2) The existing in-session re-verification is never triggered.** The reducer already
      has `HUMAN_COMPLETED → BEGIN_INSPECTION` and the runtime keeps the same page open
      (`progressive-reconnect.ts:314-320`, `-runtime.ts:156-161`); `humanCompleted()` exists
      on runtime/service/startup — but has **no production caller** (only tests). The CLI boots,
      settles once, and idles; nothing re-inspects after the human logs in.
    - Secondary: `local-agent` uses profile `.profile/esm-agent-<sha256(connectionId)>`,
      distinct from capture's `.profile/esm`, and both are **worktree-relative** — so the
      isolated worktree began with no session and reconnect/capture never share one.
    - The autofill *submit* rung (`ZERO_TOUCH_AUTOFILL`) is code-reachable but disabled here by
      `autoSubmitConsent:false` and has **never been live-verified**.
  - Next single action: **operator approval of the smallest slice** (see HOLD) — reuse the
    already-tested `humanCompleted()` re-inspection by (a) adding a production trigger, and
    (b) pointing the logged-in probe at a session-gated seller-center URL (not `/login`). Do
    not proceed to G2/G3; do not build a new login diagnostic.

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
