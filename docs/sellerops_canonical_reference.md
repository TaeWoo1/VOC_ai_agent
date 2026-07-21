# SellerOps — Canonical Reference: Product, Strategy, State

> **This document is the canonical Product / Strategy / Current State reference for SellerOps.**
> It carries **identity, direction, honest state, authority, and standing fences**. It does not
> carry runtime status, capability tables, slice contracts, or execution plans — those live in
> their own homes and are linked, never mirrored.

---

## 0. Anchor & authority

**Anchored at `main` = `ca470e2056bf69a6fe899cca87fbdd408689fff1`**
(PR #317 NAVER SmartStore v1 · PR #318 ESM marketplace attribution · PR #319 Cafe24 callback dev receiver, all merged).

Every state claim in §3–§5 is true **as of that commit** and must be re-derived, never assumed, at a
later commit. A recorded SHA is a snapshot, not a fact — including this one.

### What this document is responsible for

1. **Product identity** — what SellerOps is and is not, stable across channels and phases (§1).
2. **Strategic direction** — the arc from v1 to long-term AX, as direction, not schedule (§2).
3. **Honest state ledger** — live-verified vs implemented vs documented vs ruled (§3–§5).
4. **Document authority** — which doc wins on what, and which are demoted (§9).
5. **Standing scope fences** — the fences that survive v1 completion (§6–§7).

### What this document explicitly does NOT try to solve

- **Not a runtime status board.** Action Window / R4 runtime status stays in
  `docs/action-window-runtime/`, which is status-of-record for runtime detail and **outranks any
  summary here**. This document links; it does not restate.
- **Not a capability table.** `docs/multi-channel-connector-roadmap.md` §4.1 remains the single
  capability truth. §5 below carries **pointers and posture**, never a duplicate table.
- **Not a slice contract or execution plan.** No completion criteria, no gate mechanics.
- **Not a doc-cleanup pass.** It does not edit, fix, or reconcile the stale documents it names.
  It **classifies** them (§9) and **registers** their drift (§10).
- **Not a rewrite of `CLAUDE.md`.** Conflicts in `CLAUDE.md` are recorded in §10 as findings for a
  later slice, deliberately not resolved here.
- **Not a decision-maker.** Unresolved points are classified `[REPO]` / `[EXT]` / `[PO]` and
  surfaced (§11), never resolved unilaterally.
- **Not a history.** Executed records stay frozen; later truth arrives as a forward-pointer,
  never as an edit.

### Relationship to `docs/sellerops_current_state.md`

**`docs/sellerops_current_state.md` is no longer the canonical Product / Strategy / Current State
authority. This document is.**

`sellerops_current_state.md` is left **untouched and unrebased by deliberate decision**. Its §1
baseline is 2026-07-08 with two stacked partial-update banners; its §10 "Active slice" names
*Review Response Completion v1* (2026-07-18) and predates PRs #316–#319; its §9 "Truth snapshot"
still reads that the Action Window is not implemented. Rebasing it would mean rewriting a living
handoff around a state it never observed.

**Its retirement or formal subordination is a separate, later doc-reconciliation slice** (§10).
Until that slice runs, treat `sellerops_current_state.md` as a **historical handoff record**:
readable for lineage, not citable for current state.

---

## 1. Product identity

> **SellerOps is an SME multi-channel commerce operations agent.**

It is **not**:

- a browser click-bot,
- a scraper,
- a connector console,
- a plain sales tool,
- an ERP / settlement product,
- an ad or marketing automation product,
- a general BI or analytics playground,
- a chatbot.

The **"unified seller center" is the surface. The operating loop is the engine.**

### 1.1 The operating loop

```
OBSERVE → ACQUIRE → NORMALIZE → UNDERSTAND → PRIORITIZE → ACT → ESCALATE → RESUME
```

(Canonical definition: `docs/product-scope-v1.md` §1.6.)

A **human checkpoint hands back a decision, never the whole workflow.** `ACT` is bounded in v1 —
preparation and guided execution only, no autonomous outbound write.

### 1.2 How agentic value is measured

> Agentic value is **not** measured by whether data acquisition is click-free.
> It is measured by the **total end-to-end operational work removed around human checkpoints.**

This is the single most load-bearing sentence in the product definition. A human clicking export on
the marketplace is **not** a failure of the agent — it is the correct, policy-safe shape of the
Action Window pattern. Removing the click is not the goal; removing the *operational burden around*
the click is.

### 1.3 Three identity corrections (live contradictions, corrected here)

| # | Correction | Superseded framing |
|---|---|---|
| 1 | Audience is **SME 제조사 / 브랜드 seller operations** (owner + online sales operator). | `docs/sellerops_product_roadmap.md` §1 "industrial / manufacturing e-commerce sellers, 40–50대 CEO" — retired as lineage. |
| 2 | **Settlement (정산) is out of scope.** Five data types only: 주문 · 문의 · 리뷰 · 상품 · 운영 리포트. | `docs/sellerops_ceo_connector_status_onepager.md` promises 정산 data. |
| 3 | The **Manufacturer Track** (VOC / market intelligence) is a long-term track, deliberately fenced from the Seller Track. | This is where the pre-SellerOps VOC lineage legitimately lands. Mixing it into Seller Track is the root cause of most identity drift. |

Canonical source for all three: `docs/product-scope-v1.md` §1.2 (identity), §1 (scope exclusions),
§3 (Manufacturer Track), §7-5 (no mixing with the Instagram/cardnews publishing track).

### 1.4 Autonomy modes

Assigned **per (channel × DataType × operation)** — never per marketplace, never per channel as a
whole (`docs/product-scope-v1.md` §1.4):

`AUTOMATIC_OPERATION` · `ACTION_WINDOW` · `FILE_IMPORT` · `INTEGRATION_PENDING`

**Default production review-acquisition mode = `ACTION_WINDOW`**
(`docs/multi-channel-connector-roadmap.md` §5.1). This is an approved default **design**; it is
realized today on NAVER only.

---

## 2. Strategy

**Seller operations → multi-channel operations → SME commerce / manufacturing operations AX.**

### Stage 1 — Seller operations (current)

Make one seller's day-to-day operations calm on the channels they actually sell on. Prove the
Action Window pattern end-to-end on a single channel. **This stage is complete for NAVER.**

### Stage 2 — Multi-channel operations (next)

Prove that the pattern **generalizes**: a second channel, then a third, each with its own
acquisition method (API > export > manual), all converging on one canonical model and one
observability model. The thesis under test is not "can we add channels" but "does the
Action Window pattern survive contact with a channel it was not designed against."

Direction detail: `docs/multi-channel-connector-roadmap.md` §2 (end goal), §5.2 (per-channel
connection decisions), §11 (connection modes AUTOMATED / GUIDED / ASSISTED / MANUAL, orthogonal to
acquisition method).

### Stage 3 — SME commerce / manufacturing operations AX

The long arc. The operating loop, once stable across channels, becomes the substrate for
operational transformation at SME manufacturers and brands — not a dashboard they check, but an
agent that carries operational work between human decisions.

Recorded direction, **implementation forbidden until execution modes and checkpoints are stable**:

- **`OperationRun` domain** — `OperationRun` · `OperationTask` · `HumanCheckpoint` ·
  `ExecutionMode` · `CapabilityPolicy` · `ResumeState` (`docs/product-scope-v1.md` §1.7; direction
  only, §7-18 forbids implementation).
- **Operation Run Engine** — step 8 of the development sequence
  (`docs/multi-channel-connector-roadmap.md` §6).
- **Manufacturer Track** — "how does my product appear in the market", same canonical model,
  view-layer divergence only (`docs/product-scope-v1.md` §3).
- **Runtime expansion** — Windows / company-PC deployment, cloud-managed runtime, Device Vault +
  auto re-login, Projected Direct Action (`docs/product-scope-v1.md` §6.1 future-scope column;
  `docs/sellerops_local_agent_runtime_adr.md` §2.2 / §3.5 / §6).
- **Registration paths** — sole-proprietor registration done; official seller-tool / API-partner
  registration runs in parallel. **NAVER 커머스 솔루션 마켓 is long-term and is NOT a prerequisite**
  for the first paid pilot (`docs/product-scope-v1.md` §1.3).

Each of these is an **independent axis**. None of them is advertised, and none of them gates
Stage 2.

---

## 3. Verified-state ledger (as of `ca470e2`)

### 3.1 The honesty ladder

The four-stage model is defined in `docs/multi-channel-connector-roadmap.md` 부록 A and is binding:

| Stage | Meaning | Evidence bar |
|---|---|---|
| **연결 가능** (connectable) | Seller can start the connection in-product | Credential template / connect flow exists |
| **구현됨** (implemented) | Collection code path exists, passes offline tests | No live run required |
| **라이브 검증** (live-verified) | ≥1 **supervised** real run succeeded, sanitized record | **Evidence doc link mandatory** |
| **운영 지원** (production-supported) | Product promises routine use: default-on, ops procedure, recovery path | — |

> **`live-verified` ≠ `production-supported`.**
> **Only `운영 지원` may be shown to a seller as "지원".**
> `라이브 검증` means a supervised pilot happened. `구현됨` / skeleton is not displayed at all.

**Production-supported today is file upload (all channels) and nothing else.**
(`docs/multi-channel-connector-roadmap.md` §4.1, L189–191.)

### 3.2 What merged in #317 / #318 / #319

**PR #317 — `feat/naver-smartstore-v1`** (merge `bc7d5d8`, 33 files, +4965/−22)

- *Product path*: NAVER guided API-onboarding wizard — `frontend/src/pages/ConnectNaver.tsx`,
  `frontend/src/components/guidedConnection/{GuidedConnectionWizard,SecureCredentialForm}.tsx`,
  `frontend/src/lib/guidedConnection/*` (state machine, bridge session readiness). Seller pastes
  Client ID / Secret manually.
- *Dev / diagnostic only*: `collector/src/cli/observe-api-center.ts` — read-only NAVER API-center
  **page-category** observer. Never logs in, issues, links, clicks, types, or submits, and
  **never reads Client ID or Secret**.
- *Product-adjacent runtime*: bounded row-census settle + same-session sentinel in
  `collector/src/cli/discover-reply-target.ts`; byte-derived file-family classification in
  `collector/src/naver/review-download-save.ts`.
- *Governance*: the `CLAUDE.md` phase anchor and the mandatory product-boundary check;
  `docs/action-window-runtime/naver-smartstore-v1-plan.md`; `naver-v1-integration-manifest.md`.

**PR #318 — `feat/esm-review-marketplace-attribution`** (merge `de91bb9`, 8 files, +826/−10)

- *Product path, fail-closed gate*: `collector/src/esm/esm-marketplace-verify.ts` —
  `classifySelectedMarketplace()` → `GMARKET | AUCTION | UNKNOWN | AMBIGUOUS`. Reads only
  `aria-selected/pressed/current/checked` plus a fixed label vocabulary; never arbitrary page text,
  never `loginMode`, host, channel code, or index.
- Four new gate stop codes in `esm-capture-gate.ts`; a distinct `esm-marketplace-ready.ready`
  sentinel.
- `--marketplace GMARKET|AUCTION` is now **required** (exit 7) before any export scan or click.
- *Read-only discovery*: `--observe-marketplace` mode, and `esm-marketplace-observe.ts`.

  > **Net effect: ESM review capture is now correctly BLOCKED rather than silently
  > mis-attributing.** That is the honest outcome and the intended one. The checklist records the
  > path as "not currently runnable, and must not be scheduled."

**PR #319 — `tools/cafe24-callback`** (merge `ca470e2`, 4 files, +193)

- *Dev-only tooling*: dependency-free Node HTTP receiver + Vercel handler. Reports `code` / `state`
  **presence booleans only** — no token exchange, no credential writes, no DB, no logging of values.
  Its own README declares it outside the product runtime.

### 3.3 State summary at `ca470e2`

| | |
|---|---|
| **Live-verified** | NAVER review export end-to-end (Run 4); NAVER `ORDER_SUMMARY` API (once, 2026-06-14); Cafe24 `ORDER_SUMMARY` E2E; Cafe24 board article backfill; file upload (all channels, E2E smoke); ESM session/reconnect (G0) |
| **Implemented, not live-verified** | NAVER guided onboarding wizard (offline-green on synthetic fixtures); NAVER reply preparation + guided reply session; ESM marketplace verification gate; Browser Projection V0 (unwired, State B) |
| **Documented / ruled only** | v1 completion rulings; onboarding "real backend boundary" clause; `OperationRun` direction |
| **Production-supported** | **File upload only.** |

---

## 4. What NAVER v1 proved — and did not prove

NAVER SmartStore v1 = one channel, four surfaces: (1) guided API onboarding (orders),
(2) review export (Action Window), (3) session readiness, (4) guided review reply.
Phase source of truth: `docs/action-window-runtime/naver-smartstore-v1-plan.md`.

### 4.1 Proved

All of the following are **human-driven / operator-supervised**, on the **dev seller
`NAVER_DEV_SELLER_SELF_01`**, against a **local dev backend (`localhost:8080`, never production)**.

- **Review export, end-to-end — Run 4 (2026-07-15).** Real human click → download →
  quarantine validation (OOXML sniff) → real `/api/uploads` ingest. Backend `SUCCESS 55/55/0/0`.
  Evidence: `docs/action-window-runtime/r4-evidence-pack.md` §8-17.
- **`USER_ACTION_OBSERVED` fires on a real human click** — Run 5 (2026-07-16), non-mutating.
- **CLI session-recovery loop, live-proven** — Run 6 (2026-07-17), zero clicks.
- **Overlay operator label, live-verified** — §8-24 (2026-07-18).
- **Review identity reconciliation** — the row carries `리뷰글번호`; identity keyed
  `(channel, sellerAccountId, channelReviewId)` (D-036).
- **Composer-open / abort-safe hand-off evidence** — D-033, D-034, D-035.
- **NAVER `ORDER_SUMMARY` API collection**, once, 2026-06-14.

> **The real proof is architectural: the Action Window pattern works.** A human clicks the
> platform; the agent detects, validates, and ingests the result. That generalizes as a **pattern**.
> It does **not** generalize as a selector, a timing, or a DOM contract.

### 4.2 Did NOT prove

- **No live reply was ever submitted.** §9(c) explicitly rules live submission **not required** for
  v1. The terminal state is `OPERATOR_REPORTED_SUBMITTED` / `SUBMISSION_ABORTED`, always paired with
  `UNVERIFIED`. **`COMPLETED` is not a valid value** (D-032). The runtime never fabricates a
  completion.
- **No production backend was ever touched.** Every run hit `localhost:8080`.
- **No first-time API issuance.** The 2026-06-14 order pull was on an **already-configured**
  account. The wizard is offline-green against **synthetic fixtures** only. An assisted end-to-end
  walk against a freshly issued app **must not be claimed as v1-verified**.
- **B2 — row selectors are unratified.** The live calibration pass returned a **negative result**
  (`calibrationState: UNCALIBRATED`); the candidate ladder was de-wired and dead-lettered.
- **B3 — the `ARTIFACT_INVALID` cause is unexplained.** Accepted 2026-07-21 as a *known, unexplained
  caveat* by product-owner ruling, **not by proof**. Run B was a **one-off supervised diagnostic
  exception and is explicitly not precedent for product behavior**; no further B3 live download
  probes.
- **B1 — cross-source fingerprint.** Java ≡ TS parity is proven on the *same text*; a live NAVER DOM
  row's rendered text is **not** proven to normalize to the backend's *stored* body. Explicit
  non-goal.
- **B4** — cold-restart session inheritance stays open by design; a clean cold restart still
  requires re-login.
- **B5** — auto-relogin / Device Vault / credential autofill are **missing**. Do not advertise
  autofill.
- **B7** — bridge pairing is production-ready on **macOS only**; Windows / Linux fail closed.
- **No unattended or scheduled collection. No seller-facing release.**

### 4.3 Epistemics worth preserving

Three findings from the v1 record that outlive the phase and should govern how future proof is
claimed:

> *"Milestone A shipped a capability and proved it against fake drivers — it did not prove anything
> about NAVER."*

> *"Green tests certified an impossible ordering."*

> *"A vacuous guard against a footgun is the footgun."*

A run that observes a human action proves **a human acted** — never that the platform accepted the
request. A `DOWNLOAD_TIMEOUT` is equally consistent with consent-declined, range-refused, and
click-no-op.

---

## 5. Channel pointers

**Capability truth is `docs/multi-channel-connector-roadmap.md` §4.1.** The table below carries
posture and pointers only, and is deliberately not a duplicate of it.

### NAVER SmartStore

- **Status:** v1 merged (#317). `ORDER_SUMMARY` live-verified once; `REVIEW` export live-verified
  end-to-end (Run 4); guided reply implemented, **never live-submitted**; guided onboarding wizard
  offline-proven only.
- **Production-supported:** none. Every capability sits behind supervised, gated use.
- **Read:** `docs/action-window-runtime/` (status-of-record; entry point `HANDOFF.md`),
  `naver-smartstore-v1-plan.md` (phase definition, §8 blocker ledger B1–B9),
  `decisions.md` (D-001…D-036, append-only).

### ESM+ (Gmarket / Auction)

- **Status:** marketplace attribution gate merged (#318) and **fail-closed**. Session / reconnect
  (G0) live-verified 2026-07-07, re-proven 2026-07-08.
- **Blocked:** the GMARKET REVIEW **selected-state contract is unknown**. A live run detected
  `UNKNOWN`; observation found **no `role=tablist`, no visible AUCTION tab, no ARIA/native selected
  state** — REVIEW uses a **dropdown**, not a tablist. Capture is **not currently runnable and must
  not be scheduled** until the contract is resolved *and* a fresh single-use in-turn approval is
  granted.
- **Read:** `docs/esm/live-capture-checklist.md` (binding bounded-capture protocol),
  `docs/esm/decisions.md` (D1–D10), `docs/esm/live-capture-plan.md`.

### Cafe24

- **Status:** `ORDER_SUMMARY` live-verified E2E (token rotation, amount reconciliation).
  `REVIEW` / `INQUIRY` are `CONFIRMED` in code (`backend/.../cafe24/Cafe24ApiConnector.java:133-135`),
  with board-article shape, bounded persistence, and production-runtime backfill each verified.
- **Dev-only:** all of `tools/cafe24-callback/` (#319) — outside the product runtime.
- **Excluded:** board 9 (1:1 맞춤상담, highest-PII — never requested). No comments, no urgent-inquiry,
  no community write, no automatic AI reply posting. `reply_status` maps only `N → PENDING`; the
  answered token stays `UNKNOWN` and is never guessed.
- **Scope note:** Cafe24 covers **the seller's own mall only** — never a proxy or hub for other
  markets (`multi-channel-connector-roadmap.md` §5.2).

### Coupang

- **Status:** authentication skeleton only. Nothing implemented, nothing live-verified.
- **Direction:** seller self-developed key issuance is possible; the dual seller-tool conflict risk
  is recorded. **No official review API exists** (confirmed). `INQUIRY` is a CS-API candidate.
- **Read:** `multi-channel-connector-roadmap.md` §5.2.

### Others

11번가 (holds the only official review API in the set — do not claim seller-issued keys work),
SSG (no review surface on the channel), 오늘의집 (MANUAL only). All `INTEGRATION_PENDING` until
partner access is verified. See §4.1 and §5.2.

---

## 6. Standing scope fences

### 6.1 Permanent — no gate opens these

- **No auto app-issuance click**, no account/store-selection automation, no auth bypass.
- **SellerOps never reads Client ID or Secret from the API-center page.** The observe tool reads a
  sanitized page category only.
- **No automatic export / consent / download as product behavior.** Default production NAVER review
  export stays **human-driven Action Window**: the seller clicks export / consent / download **on
  the marketplace**; SellerOps only detects, validates, and processes the resulting download
  (D-004, D-005).
- **No hidden chained platform clicks** (D-003). Manual progress always remains available (D-007).
- **Ambiguous, missing, or changed targets fail closed** (D-006).
- **SellerOps never types and never clicks submit on a reply.** Outcome and verification are always
  reported as a **pair**; `UNVERIFIED` alone is forbidden and **`COMPLETED` is not a valid value**
  (D-032).
- **Sanitized output only.** Never expose credentials, tokens, cookies, seller IDs, Master ID, API
  keys, JWTs, raw page content, screenshots, exported files, or personal data — in logs, reports,
  events, or frames. `eventTimeMs` is internal; only `recencyBucket` may surface. No raw timestamps
  or elapsed durations.
- **Honest capability display.** Only `운영 지원` may be shown to a seller as "지원".
  `라이브 검증` is pilot-only and must not be presented as a supported feature.

### 6.2 Gated deferrals — open only with an explicit, fresh grant

- **Every live marketplace run** requires a **fresh, single-use, in-turn G6 approval** naming
  channel / account / date / operator.
  > *A plan, a prior approval, or goal pressure is never authorization.*
  A generic live grant never covers a state-mutating action. Before any live dispatch, the
  **product-boundary check** must be answered: is this product-path behavior or a labeled diagnostic
  exception, and if the latter, what is the human-driven product alternative?
- **Live guided reply submission** — requires the 6th G3 scope (`reply submission`) plus a one-shot
  G6. Neither is granted.
- **Browser Projection against a real marketplace** — §20 gate: marketplace terms-permissibility
  clarification **and** customer-PC security review. Projection stays a **non-default renderer**,
  production-runtime **unwired (State B)**, and is **never a v1 dependency**.
- **Unattended / scheduled collection** — supervised only.
- **Auto-relogin, Device Vault, credential autofill** — deferred.
- **Windows / cloud managed runtime** — macOS pilot only.

### 6.3 Fences rewritten by v1 completion (not deleted)

Two fences were written for the v1 phase and are **superseded in wording, retained in substance**:

1. **"Coupang and Cafe24 — do not start."**
   → **Coupang and Cafe24 are the post-v1 channel targets.** Existing Cafe24
   `ORDER_SUMMARY` / `REVIEW` / `INQUIRY` code and the dev-only `tools/cafe24-callback` are
   **carve-outs**, and **none of them is production-supported**.
2. **"`sellerops-esm-live` is parked and frozen — do not merge or continue" (D-012).**
   → The **worktree protection stands permanently** (§7 — it is a runtime holder). The **work is
   merged** (#318), so D-012's status line is retired by forward-pointer, not by edit.

---

## 7. Runtime-holder rule

**Never develop in, clean, remove, or `git worktree remove` a runtime holder.**

These worktrees hold live browser profiles, `.env` files, connections, and run state that exist in
exactly one place on disk and are **not recoverable from git**:

- `BE/worktrees/sellerops-r4-runtime` (NAVER)
- `BE/worktrees/sellerops-naver-live-review-match` (NAVER)
- `BE/worktrees/sellerops-action-window-runtime-verification`
- `sellerops-esm-live` (ESM)

`git worktree remove` **silently discards ignored files**. Removing one destroys its runtime assets
with no warning and no recovery path. This rule survives v1, survives #318 having merged the ESM
work, and has no gate that opens it.

**Related standing rules:** stage exact files, never `git add .`. Never stage or delete `.env`,
`.profile/`, `.status/`, `.connections/`, `downloads/`, screenshots, raw HTML, exported marketplace
files, real NAVER/ESM/review data, or credentials. No force-push.

---

## 8. Post-v1 priorities

Direction and sequence. **No dates.** Each step requires its own approval.

1. **Declare v1 closed.** No document currently records the transition; the phase fences still read
   as if v1 is running. This is the precondition for everything below.
2. **Honest capability refresh** — §4.1 rows for NAVER reply-submission, ESM attribution, and
   Cafe24 REVIEW/INQUIRY. **`운영 지원` stays file-upload-only**; that must not quietly change as a
   side effect.
3. **Unblock ESM+ GMARKET REVIEW** — resolve the selected-state contract (dropdown, not tablist),
   *then* seek a fresh single-use grant.
4. **Second-channel Action Window calibration** — the real post-v1 thesis test: does the pattern
   survive a channel it was not designed against.
5. **Cafe24 as a first-class channel** — the code already carries `CONFIRMED` capabilities; the
   fence, not the implementation, is what lags.
6. **Guided reply live submission** — deliberately deferred out of v1. Requires the 6th G3 scope +
   one-shot G6, and must remain `OPERATOR_REPORTED` / `UNVERIFIED`.
7. **Coupang guided key issuance**, with provider / seller-tool registration inquiries in parallel.
8. **`OperationRun` engine** — only after execution modes and checkpoints are stable. Currently
   direction-only; implementation is forbidden.
9. **Long arc** — Windows / company-PC deployment, cloud-managed runtime, Device Vault and
   auto-relogin. Each an independent axis; none advertised; none gating Stage 2.

---

## 9. Document authority map

### 9.1 Conflict priority

When sources conflict, this order wins:

1. explicit product-owner decisions from the current task
2. `docs/product-scope-v1.md` — product scope contract, **scope lock v1.6**
3. `docs/sellerops_frontend_spec.md` — frontend source of truth
4. `docs/sellerops_local_agent_runtime_adr.md` — runtime boundary ADR
5. `docs/multi-channel-connector-roadmap.md` §4.1 — the living capability table
6. the active slice document (`docs/slices/*`)
7. current implementation evidence
8. historical roadmap and phase records

**This document sits alongside ranks 2–5 for identity, strategy, state honesty, and authority.** It
does not outrank `product-scope-v1.md` on scope, `frontend_spec` on frontend, the ADR on runtime
boundaries, or §4.1 on capability. Where it and they disagree on those domains, **they win and the
conflict is reported**, not silently resolved.

**Runtime detail is the one carve-out:** `docs/action-window-runtime/` is status-of-record for
Action Window / R4 runtime status and **wins over any status claim in this document or in any
router.**

### 9.2 Canonical (read these)

| Document | Owns |
|---|---|
| **this document** | Product identity, strategy, honest state, authority map, standing fences |
| `docs/product-scope-v1.md` (lock **v1.6**) | Product scope contract, operating loop, autonomy modes, registration decisions, Manufacturer Track |
| `docs/sellerops_frontend_spec.md` | Frontend IA, screens, journeys, frontstage/backstage |
| `docs/multi-channel-connector-roadmap.md` | Collection strategy; **§4.1 = capability truth**; §5.1, §5.2, §11 |
| `docs/sellerops_local_agent_runtime_adr.md` | Local-agent runtime boundary, projection direction |

### 9.3 Status-of-record (workstream homes — status lives here, never in a router)

| Workstream | Home | Entry point |
|---|---|---|
| Action Window / R4 NAVER Runtime | `docs/action-window-runtime/` | `HANDOFF.md` |
| Action Window frontend | `docs/workstreams/action-window-frontend/` | `progress.md` |
| ESM Plus live capture | `docs/esm/` | `live-capture-checklist.md` |

> **Router rule.** A router carries **paths, not state**. If a status change forces an edit to a
> routing table, that surface was carrying state that belongs in a workstream home. Paths rot
> rarely and break loudly; status rots constantly and silently.

### 9.4 Subordinate (own their domain; not identity or strategy authorities)

`docs/action-window-runtime/naver-smartstore-v1-plan.md` (self-declares it does not outrank the
canonical product docs) · `docs/channel-capability-registration-matrix.md` (derived view of §4.1) ·
`docs/slices/*` · `docs/workstreams/action-window-frontend/*`.

### 9.5 Frozen (append-only — never rewritten)

All `docs/action-window-runtime/r4-*` dispatch and run records ·
`docs/action-window-runtime/decisions.md` (D-001…D-036) · executed entries in `docs/esm/`.

> Later truth arrives as a **forward-pointer, never an edit**. D-031 deliberately preserves an
> incorrect `☑ Bridge paired` on record, because back-dating it would destroy the only trace of the
> mistake. The de-wired candidate ladder is **dead-lettered, not deleted**.

### 9.6 Stale — cite as superseded, do not fix here

`docs/sellerops_current_state.md` (see §0) · `docs/PROJECT.md` (describes a different product) ·
root `README.md` lede · `docs/sellerops_product_roadmap.md` (self-banners 2026-06-15) ·
`docs/sellerops_ceo_connector_status_onepager.md` (self-banners 2026-06-13) ·
`docs/sellerops_ui_reference.md` (already SUPERSEDED) · `docs/sellerops_phase{0,1,2,3a,3b,3c,3d}*.md`
(historical evidence).

### 9.7 Stale *by decision* — must be reported, never silently edited

`docs/slices/action-window-v1.md` (DRAFT; still describes overlay / download-detection seams as
미구현 — a product-owner decision, deliberately not taken) · `docs/multi-channel-connector-roadmap.md`
§4.1's date header · `docs/action-window-runtime/HANDOFF.md`'s own Git-state block (self-flagged:
re-derive from `git log`).

### 9.8 Legacy lineage — not product, do not delete

Pre-SellerOps VOC / OliveYoung / industrial-review-ops era. Retained for lineage; **not citable for
product state**. Note that several retain live code at repo root (`app_industrial_review_ops.py`,
`src/voc/`, `cardnews/`).

`docs/PROJECT.md` · `docs/instagram_voc_brand_strategy.md` ·
`docs/instagram_public_education_post_{001,002}.md` · `docs/instagram_voc_publishing_checklist.md` ·
`docs/instagram_voc_dm_response_script.md` · `docs/instagram_voc_dm_conversion_ledger.md` ·
`docs/public_instagram_cardnews_spec.md` · `docs/public_instagram_drafts/*` ·
`docs/review_ops_architecture.md` · `docs/review_ops_brand20_pipeline.md` ·
`docs/review_ops_brand20_manual_mapping_guide.md` · `docs/review_acquisition.md` ·
`docs/detail_page_snapshot_design.md` · `docs/agent_harness_design.md` (repo-process meta) ·
`docs/agent_orchestration_playbook.md` (repo-process meta).

---

## 10. Known drift register

**Registered, not resolved.** Each entry is a finding for a later doc-reconciliation slice. Nothing
in this section is fixed by this document.

| # | Location | Drift |
|---|---|---|
| D1 | root `CLAUDE.md`, "Current phase" | Freeze text — "No push / PR / merge / rebase / remote sync … until the single final v1 integration" and "the branch stays local". #317/#318/#319 are merged. |
| D2 | root `CLAUDE.md`, "Working directory" | Names `/Users/taewookang/Downloads/workspace/aiagent-sellerops` — **that directory does not exist**. |
| D3 | root `CLAUDE.md`, "Scope fence" | "Coupang and Cafe24 … Do not start them" — #319 merged Cafe24 tooling; Cafe24 REVIEW/INQUIRY are already `CONFIRMED` in code. Superseded by §6.3 here. |
| D4 | root `CLAUDE.md`, required reading order | Cites `product-scope-v1.md` as **v1.1**; the actual lock is **v1.6**. |
| D5 | `docs/sellerops_current_state.md` §1, §9, §10 | Baseline 2026-07-08 with two stacked partial-update banners; §10 predates #316–#319; §9 "Truth snapshot" still says the Action Window is not implemented. **Deliberately not rebased** (§0). |
| D6 | `docs/product-scope-v1.md` §1.5, §6.1, §7-15 | Still states Action Window is **미구현**, contradicting its own delegate (§4.1: NAVER live-verified, Run 4). |
| D7 | `docs/sellerops_frontend_spec.md` §18 | Same 미구현 claim for the Action Window review screen. Also cites product-scope as v1.2 in its appendix. |
| D8 | `docs/multi-channel-connector-roadmap.md` §4.1 | Header reads "그 외 행·열은 2026-07-07 기준"; rows not refreshed for #316–#318. Note: `HANDOFF.md` instructs that this staleness be **reported, not edited** from a runtime branch. |
| D9 | `docs/channel-capability-registration-matrix.md` | Dated 2026-07-08; **no row exists for the reply-submission (write) axis** despite scope lock v1.6. |
| D10 | `docs/esm/decisions.md` D2, `live-capture-plan.md` §1/§3-G2 | Still encode the **tablist** model (index 0 = GMARKET, 1 = AUCTION) that #318 disproved. |
| D11 | `collector/src/esm/esm-marketplace-verify.ts` | Ships `MARKETPLACE_VERIFICATION_METHOD = "selected-tab-label"` — a code-level name for a contract the same PR states is unknown. **Code-level drift, not doc-level.** |
| D12 | `docs/esm/live-capture-checklist.md` | G1/G2 marked `[x]` PASSED on a signal later shown to be non-discriminating; a "Next single action" line contradicts the "not currently runnable" blocker 60 lines below. |
| D13 | `docs/action-window-runtime/naver-v1-integration-manifest.md` §0 | "**PLAN-ONLY. Nothing here is executed.**" — it was executed (#317). Ahead/behind counts stale. |
| D14 | `docs/action-window-runtime/naver-smartstore-v1-plan.md` §8, §9, §10 | "No branch integration is performed now"; "single remote git integration happens only at this completion point" — now past. |
| D15 | `docs/action-window-runtime/HANDOFF.md` | Internal contradiction: "✅ No `[PO]` item remains open" vs a trailing "Next — two OPEN product-owner decisions from Run 5". Also: "§8-24 is now the last live contact" (false — 07-20 runs followed). |
| D16 | `docs/action-window-runtime/decisions.md` D-012 | "The parked ESM marketplace-attribution experiment is neither completed nor merged" — merged as #318. Retire by forward-pointer (append-only). |
| D17 | root `README.md` | Lede frames the product for a "manufacturing CEO" and says "Real channel APIs … are not implemented yet". Links `docs/PROJECT.md` as the architecture doc — a different product. |
| D18 | `tools/cafe24-callback/README.md` | Specifies `/cafe24/callback`; the product backend uses `/api/connect/cafe24/callback`. Cites "§P5"/"§P7" of a protocol document that **does not exist in the repo**. |
| D19 | `docs/sellerops_cafe24_review_inquiry_capture.md` | Header still says "PR A is the offline storage foundation only, no Cafe24 client, no live call" while its own body documents PR B–E and promotion to `CONFIRMED`. |
| D20 | `docs/sellerops_local_agent_runtime_adr.md` §7(1) vs §3.4 | `LocalAgentState` "12상태" vs the §3.4 correction to "11상태". |
| D21 | — | **~18 of 42 `docs/*.md` files are legacy lineage** with no quarantine marker (§9.8). |

### Sequencing note

Several of these are only *correct to fix* after §8-1 (declare v1 closed): D1, D3, D13, D14, D16.
Fixing them earlier asserts the closure without recording it.

---

## 11. Open decisions

Classified per the standing assumption rule. **None is resolved here.**

### `[REPO]` — repository-verifiable

| # | Question | What closes it |
|---|---|---|
| R1 | Cross-org dashboard aggregation API is absent | Implement or formally defer; blocks dashboard redesign |
| R2 | Non-Cafe24 seller-account creation API is absent | Blocks generalized channel connection |
| R3 | Is `MARKETPLACE_VERIFICATION_METHOD = "selected-tab-label"` accurate post-#318? (D11) | Read the shipped verifier against the observed dropdown contract |
| R4 | Does any live path still reference the de-wired candidate ladder? | Grep `collector/` — confirmed absent at `ca470e2`; re-verify before claiming |
| R5 | `LocalAgentState` — 11 or 12 states? (D20) | Read the enum |

### `[EXT]` — external research required

| # | Question | What closes it |
|---|---|---|
| E1 | **ESM+ GMARKET REVIEW selected-state contract** — the surface is a dropdown with no ARIA selected state | Contract discovery, then a fresh single-use grant. **Blocks all ESM review capture.** |
| E2 | **B1 cross-source fingerprint** — does live DOM row text normalize to the stored body? | Explicit non-goal today; would need live extraction |
| E3 | **B3 `ARTIFACT_INVALID` root cause** | Accepted as unexplained by PO ruling; **closed to further live probing** |
| E4 | Marketplace terms-permissibility for Browser Projection and for Action Window generally | Policy clarification track (runs in parallel; explicitly **not** an indefinite blocker for supervised pilots) |
| E5 | Coupang / 11번가 / ESM+ / SSG / 오늘의집 provider & partner registration paths | Registration inquiries post-사업자등록 |
| E6 | NAVER API coverage for inquiries, products, store metadata | Not established; **must not be promised as v1** |

### `[PO]` — product-owner decision required

| # | Question |
|---|---|
| P1 | **Formally declare NAVER v1 closed** — the precondition for §8 and for D1/D3/D13/D14/D16 |
| P2 | **Retire or subordinate `docs/sellerops_current_state.md`** — decided in principle (§0); the mechanism and slice are open |
| P3 | Which channel is the **second** Action Window calibration target: ESM+ (blocked on E1) or Cafe24 (code ahead of fence)? |
| P4 | Should a selected date range **gate** export, or stay observe-only? (D-025 leaves it explicitly non-gating and calls the gating question a PO call) |
| P5 | When does any capability move from **라이브 검증** to **운영 지원**, and what is the bar? Today the answer is "nothing has, except file upload" |
| P6 | Final mobile navigation composition; final naming for the unified customer-response screen |
| P7 | Legacy-lineage quarantine: move, mark, or leave the ~18 non-product docs (D21) |

---

*End of canonical reference. Anchored at `ca470e2`. Re-derive before citing at any later commit.*
