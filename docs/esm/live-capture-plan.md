# ESM+ Live Capture — Plan

Canonical plan for **live-browser** capture from the ESM+ (Gmarket / Auction) seller
center. This is the authoritative scope/gate document; ad-hoc diagnostic notes are not.

Related: [`live-capture-checklist.md`](./live-capture-checklist.md) (per-item status),
[`decisions.md`](./decisions.md) (durable rulings). Prior discovery findings live in
`docs/sellerops_phase0_esm_*` and `collector/docs/esmplus-*`.

## 1. Scope — four independent targets

`captureKind` and `marketplace` are **independent axes**. There is no marketplace-unified
capture. Every target is discovered, verified, captured, and rerun **separately**:

| # | Target | Live-browser path today | Notes |
|---|---|---|---|
| 1 | **GMARKET × REVIEW** | exists (ESM+ review surface) | marketplace selected via an on-page tab (verified 2026-07-07) |
| 2 | **AUCTION × REVIEW** | same surface, other tab | selector identified, not yet verified/captured |
| 3 | **GMARKET × INQUIRY** | none (API seam only) | Gate-1 human-eye visual nav only; no browser capture code |
| 4 | **AUCTION × INQUIRY** | none | not addressed |

## 2. Core distinctions (never conflate)

- **Shared ESM+ shell vs selected marketplace.** ESM+ is one seller-center host serving
  both Gmarket and Auction. The host/URL/shell is *not* the selected marketplace. The
  selected marketplace is a **per-page control** (e.g. a G마켓/옥션 tab) and must be read
  from a verified page signal.
- **loginMode vs selected data marketplace.** The connection `loginMode`
  (`ESM_PLUS|GMARKET|AUCTION`) only chooses the login-form strategy. It is **not**
  marketplace attribution for captured data.
- **Backend channel code vs selected marketplace.** The ingest channel code (`GMARKET`,
  used for both Gmarket and Auction ESM+) is a storage label, **not** attribution.
- **Live capture vs Excel import.** Live browser capture (this plan) and the ESM inquiry
  **Excel import** are separate mechanisms. Excel import is a fallback/interim bridge and
  is out of scope here.
- **FILE_UPLOAD account vs browser/API connection.** A provisioned FILE_UPLOAD
  SellerAccount (for Excel import) is **never** evidence of a live browser/API connection
  and must never be used as proof of one.

## 3. Phase gates

Each target passes the gates in order; each gate needs its own explicit per-run approval.

| Gate | Name | Goal | Pass criteria | Fail / stop |
|---|---|---|---|---|
| **G0** | Session / reconnect foundation | Reach a valid authenticated ESM+ session via the established dedicated-profile + assisted-reconnect flow | Session verdict = logged-in on the seller-center host; no data read | Any CAPTCHA/2FA/login challenge → stop to manual; never bypass |
| **G1** | Selector discovery | Locate the marketplace selector on the target surface | The selector control is identified by a sanitized candidate (role/markers/context), badged by index | No selector found → widen (menus/tabs/dropdowns), never assume unified |
| **G2** | Selected-marketplace verification | Prove the intended marketplace is selected | Visible tab/selected state **plus** ≥1 additional safe signal (selected-label / URL param / heading) both indicate the target marketplace | Signals disagree or `NEITHER`/`BOTH` → do not proceed |
| **G3** | Bounded capture | Read ≤5 records, sanitized presence only | ≤5 records; sanitized presence metadata (count, marketplace, kind, id/status/timestamp/ref presence) captured; no upload/DB/status | Any read beyond bound, or any write → stop |
| **G4** | Stable identity + field mapping | Determine a stable source id and map fields | A stable per-record id is identified; field→canonical mapping drafted from observed shape | No stable id → mark `NEEDS_VERIFICATION`, do not fabricate |
| **G5** | Deduplication | Prove a dedup key across two overlapping captures | Two captures dedup deterministically on the chosen key | Key unstable → revise, do not persist |
| **G6** | Persistence | Persist via the supported ingestion path | Records persist through the real channel with correct marketplace attribution | Wrong/absent attribution → block |
| **G7** | Cold-restart rerun | Reproduce end-to-end after a clean restart | A cold-start run reaches capture (via assisted reconnect if needed) and reruns dedup-clean | Cold start needs unmodeled steps → record gap |
| **G8** | Production promotion | Promote the proven procedure to a skill/connector | End-to-end run **and** a successful rerun both green | Anything unproven stays a diagnostic |

### 3.1 Connection-owned Chrome profile (shared across reconnect + capture)

The G0 reconnect path (`local-agent`) and the review-capture path resolve their Chrome profile
through **one** shared resolver, so both address the **same** connection-owned profile directory
(attribution + fail-closed safety) — never copied, never migrated. Sharing the profile directory is
a safety/attribution improvement; it does **not** by itself hand a live session from one process to
another (see the tested-flow note below):

- **`connectionProfileDirFor(profileBaseDir, connectionId)`** (`agent/progressive-reconnect.ts`)
  is the single formula: `${profileBaseDir}/esm-agent-<sha256("local-agent-profile "+connectionId)[:24]>`.
  It reuses the existing `dedicatedProfileIdFor` leaf unchanged, so the on-disk G0 profile is
  preserved. `profileBaseDir` is the fixed in-tree `.profile` base (`cfg.profileBaseDir`; not
  env-overridable in this slice).
- Profile identity is a function of **`connectionId` only** — never marketplace, `loginMode`, or
  capture kind. Two connection ids → two profiles; the same id → the same profile across restarts
  and branches in a worktree.
- **Live capture is connection-explicit.** `capture-esm-review` requires `--connection-id <id>` and
  `--connections <path>`; it resolves the profile via `resolveCaptureConnectionProfile`, which fails
  closed on an invalid descriptor / unknown id / non-ESM channel / non-BROWSER strategy /
  non-runnable connection. There is **no implicit `.profile/esm` fallback** for a live ESM capture.
- **One profile, one process at a time.** The same connection profile must never be opened
  concurrently by `local-agent` and capture — stop the agent (clean shutdown closes its Chrome)
  before starting capture against the same id.
- **Shared profile directory ≠ shared live session in the tested flow (verified 2026-07-08).**
  Precise tested fact: **in the tested `local-agent` shutdown → separately launched capture flow, the
  authenticated session was not reusable, even though both launches used the same profile.** The review
  surface showed a login page. This is scoped to that one restart flow — **not** a general claim that
  ESM sessions universally never survive a browser restart, and **not** a defect in the resolver (the
  profile resolved exactly right).

- **The historically proven capture lifecycle (2026-06-30 → 2026-07-02) does not restart the browser.**
  `capture-esm-review` can own **one supervised browser lifecycle** in which the operator logs in and the
  approved capture/export runs **without closing that browser** — this is how the prior successful review
  captures fired (see `collector/docs/esmplus-review-export-discovery.md`). That flow used **no**
  local-agent and **no** session hand-off. So for supervised capture, the reliable path is the
  single-lifecycle, capture-owned, in-session-login flow — connection-explicit profile resolution from
  the resolver slice is an **additive safety improvement** layered on top of it, not a replacement.

- **Optional future architecture (not required, not implemented).** If *unattended* runs are ever
  pursued, one option is for capture to execute through a still-running `local-agent` browser/context
  (same-browser continuity) so a reconnect session is reused without a restart. This is **one option, not
  a requirement or the only solution**, and it is out of scope here: browser task ownership,
  serialization, per-run approval, and shutdown behavior would need their own reviewed slice. Do **not**
  reach for a second Chrome on the same profile, profile copying, or exposing raw cookies/credentials.

## 4. Explicit pass/fail summary

- **Selector verified** (G2) requires **two independent sanitized signals** agreeing on the
  marketplace. One signal is insufficient when a second is available.
- **No marketplace attribution** may be recorded **without a verified page signal** — never
  from hostname, `loginMode`, or backend channel code.
- **Capture** (G3) is capped at **5 records** and is **presence-only** until G6.
- **Promotion** (G8) requires a successful **rerun**, not a single run.

## 5. Safety & approval boundaries

- Live runs require the explicit per-run approval flag; a human performs all
  login / 2FA / CAPTCHA; the collector never types credentials and never bypasses auth.
- Sanitized outputs only: booleans, coarse buckets, fixed category enums, salted hashes —
  never review/inquiry text, store/account/seller/buyer identity, tokens, raw URLs/HTML,
  screenshots, raw timestamps, or elapsed durations.
- No `/api/uploads`, no DB write, no `LAST_SUCCESS`/status marker before the gate that
  explicitly authorizes it.
- Session/reconnect always goes through the **established** orchestration
  (`collector/src/agent/progressive-reconnect*`, `naver/reconnect-resolve`), not a one-off.
