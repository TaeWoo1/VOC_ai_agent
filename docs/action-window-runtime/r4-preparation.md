# R4 Preparation — First Supervised Real-Channel Action Window Pilot

**Status:** ACTIVE (preparation — planning and readiness only; **no live-channel code, no live
marketplace contact, in this slice**).
**Owner:** Runtime execution (this directory). Canonical intent is referenced, never redefined:
[`../product-scope-v1.md`](../product-scope-v1.md) §1.4–§1.5,
[`../slices/action-window-v1.md`](../slices/action-window-v1.md) §2/§6–§8/§14–§18,
[`../multi-channel-connector-roadmap.md`](../multi-channel-connector-roadmap.md) §4.1/§5,
[`../channel-capability-registration-matrix.md`](../channel-capability-registration-matrix.md),
[`../sellerops_local_agent_runtime_adr.md`](../sellerops_local_agent_runtime_adr.md) §4.
On conflict, the documentation precedence in [`README.md`](README.md) §5 wins.

**What R4 is:** one supervised, seller-consented, **user-direct** Action Window pilot on ONE real
channel — the operator/seller performs the real platform selection and export click; the Runtime
prepares, highlights, observes, detects completion, and continues downstream. **What R4 is not:**
formal platform integration, unattended automation, provider privileges, scheduled browser
operation, or any SellerOps-generated platform click.

---

## 1. R4 readiness checklist

Gate R4 work top-to-bottom; an unchecked box above blocks everything below it.

| # | Readiness item | Status | Evidence |
|---|---|---|---|
| P1 | R0 contract merged | ✅ | PR #212/#214 — `contracts/action-window/v1/` |
| P2 | R1 synthetic engine verified (incl. headed human-click QA) | ✅ | PR #213/#216, checklist #2–#11 |
| P3 | R2A/R2B FE↔Runtime integration merged (loopback + real Bridge WS) | ✅ | PR #217/#218, checklist #12/#12b |
| P4 | R3 Operation Run persistence merged (restart/resume/terminal protection) | ✅ | PR #219 merge `7292217`, checklist #13 |
| P5 | First channel selected per §2 criteria | ✅ | **NAVER SmartStore review export** — G1 ratified 2026-07-09, [`decisions.md`](decisions.md) D-021 |
| P6 | Supervised-pilot internal gate signed (§3) for the selected channel | ☐ | G1–G5 ✅ (D-021/D-024, [`r4-gate-record.md`](r4-gate-record.md); G3 confirmed 2026-07-12 for the read-only probe path); read-only §8-4 probe complete under a **consumed** one-run G6; **the export-pilot per-run G6 is still open** — gate not fully signed until that approval. **Sign-off requirements itemized in the export-pilot pre-dispatch runbook** ([`r4-gate-record.md`](r4-gate-record.md)) — signed only in the dispatching turn |
| P7 | Live-action safety boundary (§4) acknowledged by the operating seller (consent recorded) | ✅ | **self-consent recorded** for `NAVER_DEV_SELLER_SELF_01` (operator's own dev account) acknowledging §4 verbatim — [`r4-gate-record.md`](r4-gate-record.md) §G2, [`decisions.md`](decisions.md) D-024 |
| P8 | Platform-policy/provider-inquiry checklist (§5) — parallel track OPENED and logged | ✅ | §5 state logged — NAVER seller-owned export needs no platform grant; no platform marked "approved" — [`r4-gate-record.md`](r4-gate-record.md) §G5, [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-5 |
| P9 | Technical adapter readiness (§6) green on synthetic fixtures for the selected channel | ✅ | all §6 items green on NAVER fixtures (session/surface probe, target locator, download detection, artifact validation, ingestion handoff, operation-run persistence, overlay+observation, **Bridge/FE loop over the real WS from boot**, privacy sweep — PRs #221/#222/#224/#225/#227 + D-023); **the seated `AW_HEADED` operator run PASSED (2026-07-11, real human click)**; **the live driver core (`NaverLiveProbeDriver`) is now MERGED (PR #242, `cf509a5`)** — its NAVER-specific seams are proven hermetically + over a real browser on a **synthetic DOM** (`naver-surface`/`naver-live-driver`/`naver-live-browser` tests). **Green here means synthetic-fixture / synthetic-browser only — no live NAVER has ever run, and the live driver is not yet wired into a session/Bridge/persistence loop.** — [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-2/§8-3 |
| P10 | Rollback/abort criteria (§7) reviewed; abort path tested on fixtures | ✅ | every fail-closed exit + a NAVER operator-abort (`CANCEL_RUN`) drill, all recovering per §7 — [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-6 |
| P11 | Pre-live evidence pack (§8) assembled | ✅ | [`r4-evidence-pack.md`](r4-evidence-pack.md) (2026-07-11) — §8 items 1–7; read-only §8-4 probe result recorded 2026-07-12 (`ready:true`/`LOGGED_IN`); **live export still gated by a fresh per-run G6** (G2/G3/G5 recorded 2026-07-12) |
| P12 | **Per-run product-owner approval in the dispatching turn** of the live run | ☐ | standing rule — never standing authorization; one read-only-probe G6 was **consumed 2026-07-12** (§8-4), an **export pilot needs a new per-run approval** under §4 |

---

## 2. First-channel selection criteria

**The first real channel is not automatically ESM+** (product-owner ruling, 2026-07-09; consistent
with D-016 "strongest candidate, not an irreversible choice"). Final selection must satisfy, in
order of weight:

1. **First pilot company's actual channel usage** — the pilot channel must be one the pilot seller
   actually operates with real volume.
2. **Official seller-center export path** — a platform-provided export mechanism exists and has
   been observed (not assumed).
3. **Clear user-direct action** — one visible, enabled platform control the seller clicks directly
   (no hidden or chained actions needed).
4. **Compatibility with the current ingestion pipeline** — the exported artifact validates and
   ingests through the existing `/api/uploads` → `IngestionService` path with no new backend
   capability.
5. **Shortest repeatable end-to-end path** — session → surface → export → detect → ingest with the
   fewest unverified links, repeatable across restarts.

### Current evidence scoring (repository evidence as of 2026-07-09; truth source: roadmap §4.1)

| Criterion | NAVER review export | ESM+ (Gmarket/Auction) review export | Cafe24 review/inquiry | Coupang / 11번가 / SSG review |
|---|---|---|---|---|
| 1. Pilot company usage | **UNKNOWN — PO input** | **UNKNOWN — PO input** | UNKNOWN | UNKNOWN |
| 2. Official export path | ✅ live-confirmed sync download (visible+enabled Excel control; capture→save 2026-06-22) | ⚠ candidate — surface (market tab) observed 2026-07-07; export control **not yet observed** | ❌ no export path evidence (board API partial; article capture unimplemented) | ❌ unverified / no official review API (Coupang confirmed absent; SSG has no review channel) |
| 3. User-direct action | ✅ confirmed single control | ⚠ expected, unverified; Gmarket/Auction attribution must stay separated | — | — |
| 4. Ingestion compatibility | ✅ xlsx validation + diagnostic upload path built; **automatic upload bridge unverified** | ⚠ structural only (no artifact ever captured) | ⚠ different (API, not export) | ❌ |
| 5. Shortest repeatable E2E | ⚠ one full same-session live chain proven (2026-06-20); **cold-restart reconnect unresolved**; NAVER live work currently paused pending a stable environment | ⚠ session/profile/signature groundwork done; assisted reconnect is the reliable limit; cold restart requires re-login; no capture yet | ❌ | ❌ |

### Recommendation (evidence-conditional — not a selection)

On the repository's verified technical evidence alone, **NAVER seller-center review export
currently leads on criteria 2–5**: it is the only channel with a live-confirmed export control, a
real captured-and-saved artifact, and a proven (once, same-session) end-to-end chain into
ingestion. **ESM+ review export is the strong second** — its runtime seams (dedicated profile,
assisted reconnect, candidate signature) are the most developed, but its export surface has never
been observed and Gmarket/Auction attribution is unresolved.

**Criterion 1 is decisive and unresolved.** If the pilot seller's real operation is
Gmarket/Auction-centric, ESM+ overtakes despite the technical gap; if NAVER-centric, NAVER wins
outright. **Final selection is a product-owner decision** (see Unresolved PO decisions, §9) and
must also weigh the NAVER live-work pause (stable-environment precondition) against ESM+'s
unverified export surface. This document deliberately selects nothing.

> **Resolved (2026-07-09):** the product owner ratified **NAVER SmartStore review export** as the
> first pilot channel — G1, recorded as [`decisions.md`](decisions.md) **D-021**. §2 above is
> retained as the selection-rationale record; ESM+ and Coupang remain later candidates.
> Fixture-only adapter work may start; live NAVER contact stays blocked by §3 G2–G6, the NAVER
> live-work pause (§9 item 3), and per-run product-owner approval.

---

## 3. Supervised-pilot internal gate

All of the following, recorded in this directory, before the first live run:

- **G1 — Channel ratified.** PO names the channel + dataType (review export) against §2, in
  writing (decision entry in [`decisions.md`](decisions.md)). — **✅ RATIFIED 2026-07-09:
  NAVER SmartStore review export (D-021).** Fixture-only adapter code is unblocked by this
  entry; G2–G6 remain open and gate any live run.
- **G2 — Seller consent.** The pilot seller consented to: their own account, their own screen,
  their own clicks; SellerOps observes/verifies only. Consent text references §4 verbatim. — **✅
  RECORDED 2026-07-12: self-consent for `NAVER_DEV_SELLER_SELF_01`** (the operator's own dev account;
  seller = operator), first authorized live run scoped to the read-only session-precondition probe —
  [`r4-gate-record.md`](r4-gate-record.md) §G2, [`decisions.md`](decisions.md) D-024.
- **G3 — Environment.** Stable operator environment (network/IP/location stable — the condition
  that paused NAVER live work); dedicated Chrome profile for the connection; paired Bridge;
  Operation Run persistence enabled.
- **G4 — Synthetic ladder green.** §6 adapter readiness fully green on synthetic fixtures FIRST —
  live is never the first execution of any code path (slice §14-11: live action is not required
  for implementation verification).
- **G5 — Policy track open.** §5 checklist opened and logged for the selected channel (parallel
  track; see boundary in §5 for what it does and does not gate). — **✅ LOGGED 2026-07-12: none
  required** for the NAVER seller-owned export pilot per §5; no platform marked "approved" —
  [`r4-gate-record.md`](r4-gate-record.md) §G5.
- **G6 — Per-run approval.** Explicit product-owner approval in the dispatching turn of the live
  run, naming: channel, seller account owner, date, operator, and the §7 abort criteria. Goal
  pressure, prior approvals, or standing plans are never authorization.

## 4. Live-action safety boundary

Binding for every R4 run (inherits ADR §4 and slice §7/§17; violations are abort conditions):

**The seller (human) always:** logs in; completes 2FA/CAPTCHA/account lock challenges; selects
account/store; selects marketplace (Gmarket vs Auction stays user-selected and separately
attributed); selects period/scope; **clicks the real export/download control**; judges anything
legally or semantically uncertain.

**SellerOps (Runtime) only:** prepares/validates the session precondition; opens/foregrounds the
dedicated real-Chrome window on the seller's own account; locates and **highlights** the one real
control (versioned salted signature — never a raw selector); **observes** the user's action;
verifies the expected transition (verification is the sole completion authority); **detects**
download start/completion read-only; validates the artifact; continues downstream through the
existing ingestion path; persists the audited Operation Run.

**SellerOps never:** types credentials; bypasses or automates login/2FA/CAPTCHA; auto-selects
account/store/marketplace; clicks the export control; expands one user request into a hidden
click sequence; runs unattended or scheduled browser operation; proceeds on ambiguity (0/many/
drifted targets fail closed with zero clicks); emits or persists selectors, URLs, page content,
credentials, cookies, tokens, or local paths (contract `findProhibitedFields` enforced on the
wire and in the persisted store).

## 5. Platform-policy / provider-inquiry checklist (parallel track)

**Product-owner ruling (2026-07-09, recorded as D-019):** official platform clarification and
provider registration run **in parallel** with pilot preparation. They are **required before**
claiming formal integration, unattended automation, provider privileges, scheduled browser
operation, or any SellerOps-generated platform click. They are **not an indefinite blocker** for
a supervised, seller-consented, user-direct pilot inside the §4 boundary.

Per selected channel, open and log (owner: product owner as 개인사업자; tracked here, executed
outside the repo):

- ☐ Identify the platform's seller-tool / provider / API-partner program and its registration
  prerequisites (business registration number, service description).
- ☐ Submit the policy question in writing: is a seller-controlled overlay + read-only download
  detection on the seller's own session compatible with the platform ToS? Record the question
  verbatim and the response verbatim (sanitized).
- ☐ Record the platform's official position on third-party tools assisting (not automating)
  seller-center export.
- ☐ Coupang-specific: resolve the possible one-seller-tool-at-a-time constraint before any
  Coupang pilot.
- ☐ ESM+-specific: provider onboarding/permission model inquiry (after business registration).
- ☑ NAVER-specific: none required for the seller-owned export pilot; Solution Market remains a
  long-term option, not a prerequisite. **Logged 2026-07-12** ([`r4-gate-record.md`](r4-gate-record.md)
  §G5, D-024) — this is the G5/P8 evidence; it authorizes no live action.
- ☐ Never mark any platform "승인됨/approved" without the actual recorded grant (matrix §3 rule).

## 6. Technical adapter readiness checklist (per selected channel)

Everything below green on **synthetic fixtures** before G4 sign-off; each item maps to an existing
verified seam — the adapter is composition, not new invention:

> **Scope of every ☑ below:** green on **synthetic fixtures** and/or a **real browser over a synthetic
> DOM** — **never on live NAVER**. A checked box certifies the seam is built and proven offline/synthetic;
> it does not assert any live-channel run. Live contact stays gated by §3 G6 and §1 P6/P12.

- ☑ **Session precondition probe** — reach/verify a valid seller-center session in the dedicated
  connection profile (reuse: connection profile resolver, assisted reconnect; honest states:
  READY vs RECONNECT_REQUIRED — never inherit READY across a restart). *(Green on the NAVER fixture
  — §8-2; the live driver's `prepareSurface` over the §8-4 session seam is proven hermetically —
  PR #242 `naver-live-driver.test.ts`.)*
- ☑ **Surface probe** — confirm the export surface read-only (reuse: frame-aware export probe
  patterns); unknown layout → fail closed (`UNSUPPORTED_STATE`). *(Green on the NAVER fixture — §8-2;
  the live driver's readiness gate (empty/ambiguous → `UNSUPPORTED_STATE`) is proven hermetically —
  PR #242. **Render-timing gap STILL OPEN — the settle fix did NOT close it live (walked back 2026-07-14).**
  The Run-1 `UNSUPPORTED_STATE` false-positive-empty was hypothesised as a render-timing miss; a bounded
  read-only settle (`settleExportSurface`, PR #250, §8-12) was added so `prepareSurface` waits for rows to
  render before deciding, and it is green offline. **But live Run 2 (§8-13, observe-only) reproduced Run 1's
  `UNSUPPORTED_STATE` at `prepareSurface` — the settle is refuted as the fix.** Leading (unproven) cause: the
  gate checks empty-state markers **before** counting rows, and the settle trusts a marker as a halt, so a
  hidden empty phrase halts regardless of rendered rows (§8-13). The settle stays a valid offline robustness
  primitive; the live gap is **not** closed. Next: a read-only probe of the live `evaluateExportTargetReadiness`
  **decision/reason** before any gate change (§6 evidence-not-speculation).)*
- ☑ **Target locator** — exactly one export control found and signature-bound (reuse: candidate
  signature); 0/many/drift → `TARGET_NOT_FOUND`/`TARGET_AMBIGUOUS`/`UI_DRIFT`, zero clicks. *(Green on
  the NAVER fixture — §8-2; the live driver's `locate` (0/1/many/drift) + real-DOM in-page binding are
  proven hermetically + over a real browser on a synthetic DOM — PR #242 `naver-live-browser.test.ts`.)*
- ☑ **Overlay + observation** — highlight never intercepts the click; the user's real click is
  observed, not simulated (R1/R2 verified components, re-fixtured for the channel). *(Green on the
  NAVER fixture: `naver-browser.test.ts` drives a NAVER-shaped review-export surface — automated
  headless + an `AW_HEADED` operator proof PASSED 2026-07-11 (§8-3); D-023.)*
- ☑ **Download detection (read-only)** — detect fired/completed download without triggering
  (reuse: export-target readiness + controlled download save; 0-rows vs failure distinguished).
  *(Green on the NAVER fixture — §8-2; a real browser download via the live driver is detected
  read-only over a synthetic DOM — PR #242 `naver-live-browser.test.ts`.)*
- ☑ **Artifact validation** — extension + magic sniff before any ingestion handoff; partial
  artifacts never ingested. *(Posture ratified in D-021: a controlled TEMPORARY quarantine save
  is allowed for validation only — extension check + OOXML/ZIP magic sniff, then DELETE; no
  filename, path, URL, or file content crosses the wire, the persisted store, or logs. Green on the
  NAVER fixture — §8-2; the live driver's quarantine-validate + bad-magic fail-closed are proven over
  a real browser on a synthetic DOM — PR #242.)*
- ☑ **Ingestion handoff** — existing `/api/uploads` → `IngestionService` only; dedup verified with
  unique synthetic data (re-uploading existing fixtures dedups to empty — use fresh synthetic
  rows to prove the positive path). *(Green on the NAVER fixture / injected upload — §8-2; the live
  driver's injected ingest (opaque ref, no filename) is proven over a real browser on a synthetic DOM
  — PR #242.)*
- ☑ **Operation Run persistence** — the pilot run records every verified transition; interruption
  parks at PAUSED; resume re-drives read-only (R3 verified; re-run against the channel fixture).
  *(Green on the NAVER **fixture** driver — §8-2 `naver-session-integration`. The **live driver** is now
  wired into a persistent session via the gated entrypoint's `assembleLiveRun`, **proven** by a
  synthetic-browser integration test asserting a persisted TERMINAL run + fail-closed FAILED persistence
  (§8-9, automated cases PASSED 2026-07-12 + headed real-human-click case PASSED 2026-07-13) —
  **loopback channel, not the Bridge WS; no live NAVER**.)*
- ☑ **Bridge/FE loop** — start → checkpoint → user click → recheck → completed over the real
  Bridge WS with the channel fixture (R2B verified; re-run with channel `channelCode`). *(Green for
  NAVER: the fixture driver is hosted from the local-agent boot via `createAgentBridge` and drives the
  full loop to COMPLETED over the real Bridge WS with `channelCode:"naver"`, incl. an agent
  cold-restart resume-through-downstream — `naver-bridge-transport.test.ts`, `RUN_INTEGRATION` 3/3;
  D-023. **This ☑ is the fixture driver over the real WS; the live driver is not yet Bridge-wired.**)*
- ☑ **Privacy sweep** — `findProhibitedFields` empty across wire + store for the channel fixture;
  no channel-specific leakage (marketplace names are sanitized enums/codes only). *(Green on the
  NAVER fixture — §8-2/§8-7; the live driver adds needle scans + `findProhibitedFields == []` + a
  module source guard (no click / no legacy capture / no upload import), hermetic + synthetic browser
  — PR #242.)*

## 7. Rollback / abort criteria

**In-run abort (automatic, fail-closed — already structural):** ambiguous/missing/drifted target;
unexpected post-state; session invalid; artifact validation failure. Result: blocker code, zero
clicks, manual progress remains available, run persisted FAILED (resumable per R3).

**In-run abort (operator, immediate):** seller withdraws consent; any prompt/dialog the seller
does not recognize; any sign of platform anti-abuse challenge (CAPTCHA storm, lockout warning) —
the human completes or walks away, the Runtime never retries around it; any observation of data
on screen the seller did not expect to share.

**Slice-level rollback:** the pilot leaves no platform-side state (read-only observation + a
seller-initiated export the platform already offers). Rollback = delete the local artifact if not
yet ingested; if ingested, the existing dedup-safe ingestion makes re-runs non-destructive; the
Operation Run audit trail is retained (never rewritten). If the platform responds negatively on
policy (§5), the channel drops to FILE_IMPORT/manual immediately — capability tables updated the
same day, no "coming soon" claims.

**Hard-stop triggers for the whole R4 program:** any platform's written objection; any credential
or private-content leakage found in logs/store/wire (also a P0 bug); any evidence the Runtime
performed a platform click.

## 8. Evidence required before any live run

Assembled as a dated evidence pack in this directory (sanitized; enums/booleans/counts only):

1. The §3 gate record — channel ratification, seller consent, environment, per-run approval turn.
2. Synthetic-ladder results for every §6 item (test names + pass counts + commit SHA).
3. The channel fixture demonstrating the full loop headed with a REAL human click (R1/R2A
   precedent: automated + headed operator proof).
4. Session-precondition live probe result (read-only; separately approved) — the only permitted
   pre-pilot live contact, and only if the gate requires it. — **✅ completed 2026-07-12** ([`r4-evidence-pack.md`](r4-evidence-pack.md) §8-4; consumed one-run G6).
5. Policy-track log state (§5) for the channel: question sent, response pending/received.
6. The abort drill: one fixture run deliberately driven into each fail-closed exit, plus one
   operator-abort, all recovering per §7.
7. Privacy sweep outputs (wire + persisted store scans) for the channel fixture.

**Evidence to record _after_ an export run** is defined as the sanitized post-run checklist in the
export-pilot pre-dispatch runbook ([`r4-gate-record.md`](r4-gate-record.md) §5), captured into
[`r4-evidence-pack.md`](r4-evidence-pack.md) §8-8 (reserved; not yet run).

## 9. Unresolved product-owner decisions (blocking, in order)

1. **Pilot seller/company and its actual channel mix** — ✅ **RESOLVED**: the channel half in D-021,
   and the **pilot seller identity 2026-07-12 in D-024** — the operator's own dev account, recorded
   as the sanitized label `NAVER_DEV_SELLER_SELF_01` (G2 self-consent, [`r4-gate-record.md`](r4-gate-record.md)).
2. **Channel ratification (G1)** — ✅ **RESOLVED 2026-07-09: NAVER SmartStore review export**
   ([`decisions.md`](decisions.md) D-021).
3. **NAVER-specific:** lift or keep the live-work pause (stable-environment precondition) — now
   the **active live-blocking decision** (fixture-only adapter work is unaffected).
4. **ESM+-specific:** approve the constrained read-only export-surface observation (Gate-style,
   one-off) needed to close its §2 criterion-2 gap if ESM+ is selected.
5. **Backend mirroring of Operation Runs** (carried from D-018 — not blocking the pilot).

## 10. Related

- **Supervised-pilot gate record (§3) → [`r4-gate-record.md`](r4-gate-record.md)** (living; G1–G5 ✅; G6 per-run — read-only-probe instance consumed 2026-07-12; export pilot needs a fresh per-run G6)
- **Pre-live evidence pack (§8) → [`r4-evidence-pack.md`](r4-evidence-pack.md)** (assembled 2026-07-11)
- Slice sequencing → [`implementation-plan.md`](implementation-plan.md) (R4 section)
- Durable decisions → [`decisions.md`](decisions.md) (D-016, D-018, D-019, D-020, D-021, D-022, D-023, D-024)
- Current slice state → [`current-state.md`](current-state.md)
