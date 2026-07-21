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
  - **Profile alignment — SHIPPED as an additive safety improvement (PR #207, feature commit `19e04c7`,
    merge `58ceb9f`, 2026-07-08).**
    The capture path and `local-agent` now resolve the SAME connection-owned profile via one shared
    resolver `connectionProfileDirFor(profileBaseDir, connectionId)` (see
    [`live-capture-plan.md` §3.1](./live-capture-plan.md)); capture is connection-explicit
    (`--connection-id` + `--connections`, fail-closed, no `.profile/esm` fallback). This is an **additive
    attribution/safety layer** — it does not change the proven capture lifecycle below.
    - **Deterministic identity equality PROVEN:** for `esm-live-g0`, `resolveCaptureConnectionProfile`
      and the local-agent resolver both yield leaf `esm-agent-53b946f1c770dddb0b83890d`
      (`identityEqual: true`).
    - **G0 assisted login → READY (2026-07-08, live, operator-supervised):** boot settled
      `NEEDS_USER_ACTION` / `RECONNECT_REQUIRED` / `MANUAL_LOGIN` (overnight expiry); operator completed
      the ESM_PLUS login in the open browser; one connection-specific human-completed sentinel →
      same-process re-inspection → `HUMAN_COMPLETED_REVERIFY localAgentState=READY`. No CAPTCHA/2FA
      bypass, no credentials typed. `local-agent` then stopped cleanly (Chrome released), no cold restart.
    - **Capture session-reuse — FAILED in the tested flow (KEY FINDING):** with `local-agent` fully
      stopped, launching `capture-esm-review --connection-id esm-live-g0 …` opened the **identical**
      profile (`esm-agent-53b946f1c770dddb0b83890d`, confirmed by the live process `--user-data-dir`) but
      the ESM review surface **presented a login page**. In the verified `local-agent` shutdown → separate
      capture launch flow, the authenticated ESM session was **not reusable after the browser restart,
      despite using the identical profile directory**. This is **not** a resolver defect (the profile
      resolved exactly right). Capture was stopped cleanly at the login screen — no sentinel created, no
      export click, no download, no read, no profile copy/alter. (Scope of the claim: this one tested
      shutdown → separate-launch flow — not a general assertion that ESM never persists a session across
      every browser restart.)
    - **Conclusion:** this finding is scoped to the `local-agent` shutdown → separate-launch restart flow
      and does **not** invalidate the proven capture-owned lifecycle. The reliable, historically proven
      path for supervised capture is a **single browser lifecycle owned by `capture-esm-review`** in which
      the operator logs in and the approved export runs without closing that browser — that flow used
      **no** local-agent and **no** session hand-off (see the 2026-06-30 → 2026-07-02 successes in
      [`collector/docs/esmplus-review-export-discovery.md`](../../collector/docs/esmplus-review-export-discovery.md)
      and [`…-db-ingest-design.md`](../../collector/docs/esmplus-review-db-ingest-design.md)). Same-browser
      continuity through `local-agent` is **one optional future architecture for unattended runs — not a
      requirement and not the only solution.**
    - **G2 re-verification — SKIPPED:** no authenticated review surface was reachable in this particular
      test (login shown because it was the restart flow, not the capture-owned flow); marketplace
      verification could not run without re-login. Still pending — reachable via the proven capture-owned
      flow.
    - verification: collector `typecheck` green; full suite **130 files, 2238 passed, 1 skipped**;
      `git diff --check` clean. Merged in PR #207.
  - Next single action: **run marketplace-verified capture via the proven capture-owned lifecycle** —
    `capture-esm-review --connection-id esm-live-g0 --connections <descriptor> --approved-index N`, operator
    logs in **in the capture window**, verify GMARKET selection (D1/D2/D7), then a bounded populated capture
    that carries marketplace attribution into the result. No same-browser hand-off is required.
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
  - next single action: **carry GMARKET attribution into a bounded capture result** (see G3)

> **Prior proven capture (discovery lineage, 2026-06-30 → 2026-07-02).** A live supervised review
> capture **was** performed successfully and repeatedly via `capture-esm-review` (capture-owned single
> browser lifecycle, operator login in-session, no local-agent, no browser restart): one approved-index
> click → **one valid 14-column `.xlsx` download** → **populated first-three-row shape signals** read →
> overlap captures (Export A/B) → **three repeatability captures A/B/C** → **observe-and-discard** (magic-byte
> validate, then delete). **No** backend ingest, **no** persistent status success. Evidence:
> [`collector/docs/esmplus-review-export-discovery.md`](../../collector/docs/esmplus-review-export-discovery.md),
> [`…-db-ingest-design.md`](../../collector/docs/esmplus-review-db-ingest-design.md). Terminology: those rows
> were **shape-read** (presence / value-class / salted hashes), **not** parsed into canonical ingestable
> review records — canonical ingestion is **not** complete.

- `[~]` **Bounded capture (G3)** — **populated capture proven on the discovery lineage** (download fired,
  populated rows shape-read, observe-and-discard). **Pending on this (marketplace-attributed) track:**
  carrying verified GMARKET/AUCTION attribution (D1/D2/D7) into the capture result. Not "no records read" —
  rows were shape-read; what is unstarted is *marketplace-verified* bounded capture.
  - **Marketplace-attribution attempt — BLOCKED on the selected-state contract (2026-07-08, branch
    `feat/esm-review-marketplace-attribution`, commit `baa12bc`).** A `--marketplace GMARKET|AUCTION` verifier
    was added (fails closed; never inferred), but a live GMARKET run detected `UNKNOWN` for a
    manually-selected GMARKET tab. A read-only A/B observation (GMARKET-selected vs AUCTION-selected, no
    export/click/row-read) then showed: `LOGGED_IN`; 34 marketplace-labelled matches in the top document
    (almost all hidden GNB/nav), **0** in the allowlisted vendor frame; the **only** visible short-label
    marketplace element is a **static `span.text` GMARKET** that is **identical in both snapshots** (no
    flip); **no** visible AUCTION tab, **no** `role=tablist`, **no** ARIA/native selected on any group.
    ⇒ the "two visible tabs, one aria-selected" model does **not** match this surface. **Blocker (needs
    resolution before the verifier can be correct):** the real GMARKET/AUCTION selection mechanism on the
    review-management surface is unknown — likely image/icon tabs (no text), a collapsed dropdown/menu
    (options hidden until opened), or **separate per-marketplace review pages** (no in-page toggle; a
    product/UX question). Marketplace-attributed capture is **NOT** complete; no verifier contract was
    guessed. Zero export/download/row-read/upload/DB/status; profile intact.
  - **Bounded-capture protocol for G3 — BINDING (reconciled from the preserved aiagent-sellerops planning
    notes).** When G3 is eventually approved, the run is bounded by these conditions, all of which must hold
    together; any one failing means the run does not start or stops:
    - **≤5 records.** The capture reads at most five review records. This is a hard cap, not a target.
    - **Presence-only evidence.** Records are evaluated for presence / value-class / salted hashes only —
      never raw review, customer, order, or seller content, and never reference codes, identity, amounts,
      raw timestamps, or elapsed durations.
    - **Explicit marketplace attribution, fail-closed.** The run carries an explicit `--marketplace
      GMARKET|AUCTION` intent and proceeds only on a verified page signal (D1/D2/D7). Attribution is never
      inferred from `loginMode`, hostname, backend channel code, connection id, or a historical badge index;
      `UNKNOWN`/`AMBIGUOUS` blocks the capture path.
    - **No automatic export / consent / download.** These remain operator-driven and are not product
      behavior on this track; any such step needs separate, explicit approval in the granting turn.
    - **Fresh per-run live approval.** A future live run requires a fresh, single-use G3/G6 approval issued
      in the same turn — a generic or prior live grant never covers it.
    - **Do not rebuild the removed one-off diagnostic.** Marketplace verification belongs to the established
      verifier seam, not to a re-created single-use probe.
  - **Historical blocker B-C — RESOLVED (commit `baa12bc`).** The 2026-07-07 pre-flight recorded that
    `capture-esm-review` badged export/consent controls only, with no marketplace selector, so the only code
    that had ever verified a selected marketplace was the one-off diagnostic that was later removed — meaning
    a capture could not be attributed to GMARKET through the established path. That gap is now closed by the
    committed verifier, observation probe, gate blockers, and marketplace-ready sentinel. What remains open is
    **not** the absence of a seam but the **unknown selected-state contract** described immediately above.
- `[~]` **Stable identity (G4)** — no obvious stable source review-id / dedup-key column was detected even
  on a populated export (discovery lineage); **source review-id verification still pending.**
- `[~]` **Field mapping (G4)** — schema-SHAPE explored (14-column shape, offline mapper aliases grounded);
  **canonical record mapping not finalized.**
- `[~]` **Deduplication (G5)** — composite-key overlap + repeatability exercised offline on shape signals;
  **marketplace-aware canonical dedup contract still pending.**
- `[ ]` **Persistence / backend ingestion (G6)** — no live ingest performed.
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

**Target 1 / G3 — marketplace-attributed bounded review capture (≤5 records, presence-only) for
GMARKET × REVIEW**, via the proven **capture-owned single browser lifecycle**
(`capture-esm-review --connection-id … --connections … --approved-index N`; operator logs in in the capture
window; no local-agent hand-off needed), under explicit per-run approval. The new work versus the
2026-06-30 → 07-02 discovery-lineage successes is carrying **verified GMARKET/AUCTION attribution**
(D1/D2/D7) into the capture result — not re-proving that a download fires.

**This is not currently runnable, and must not be scheduled.** It is gated on (a) resolving the unknown
selected-state contract recorded under G3, and (b) a fresh, single-use live approval issued in the same
turn. The full bounded-capture conditions — ≤5 records, presence-only evidence, fail-closed attribution,
no automatic export/consent/download — are binding and are recorded under G3.
