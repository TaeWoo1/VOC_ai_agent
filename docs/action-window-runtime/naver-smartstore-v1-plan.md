# NAVER SmartStore v1 — Working Plan (phase source of truth)

> **Purpose.** The single anti-drift anchor for the *NAVER SmartStore v1 completion phase*. It aggregates
> the confirmed decisions and the current repository state so a future session does not re-derive scope.
> **Created:** 2026-07-19 · **Worktree:** `BE/worktrees/sellerops-r4-runtime`.
>
> **Authority.** This is a *coordination* source of truth for **executing** this phase. It does **not**
> outrank the canonical product docs. Where it and a higher-priority source disagree, the canonical source
> wins and the conflict is flagged here with **[CONFLICT]**. Conflict priority (from root `CLAUDE.md`):
> ① current-task product-owner decisions → ② `product-scope-v1.md` → ③ `sellerops_frontend_spec.md` →
> ④ `sellerops_local_agent_runtime_adr.md` → ⑤ `multi-channel-connector-roadmap.md` §4.1 (capability
> truth) → ⑥ active slice → ⑦ implementation evidence → ⑧ historical records.
> **Capability truth stays in Roadmap §4.1; live-run status stays in this directory's records.** This plan
> mirrors neither — it points at them.

**State legend** (used throughout, never conflated — `honest_capability_wording`):

| Tag | Meaning |
|---|---|
| **LIVE-VERIFIED** | proven against the real NAVER surface, dated evidence in `r4-evidence-pack.md` |
| **OFFLINE-PROVEN** | proven by tests/fixtures only; no live NAVER contact |
| **IMPLEMENTED** | code exists and typechecks; not (yet) live-proven |
| **DEFERRED** | deliberately out of v1; direction only |
| **MISSING** | not built |
| **[CONFLICT]/[PO]/[EXT]/[REPO]** | open conflict / product-owner decision / external-research / repository-verifiable |

---

## 1. Confirmed product decisions

Sourced from the current-task product-owner statement (priority ①) reconciled with the canonical docs.

1. **SellerOps is a multi-channel seller-operations agent, not a browser-click bot.** NAVER is the first
   guided channel; the collector is one adapter behind a source-agnostic ingestion core.
2. **Runtime = real local Chrome + dedicated NAVER profile + CDP.** No embedded Chromium
   (Runtime ADR §2.1). macOS-first pilot.
3. **Default review flow = real local Chrome + Action Window tutorial overlay.** Cropped/projection UI is
   **excluded** from NAVER v1 (see §2). Overlay shows an operator-legible highlight label (LIVE-VERIFIED
   2026-07-18, §8-24 / PR #306).
4. **No seller-center screen pixels are uploaded to cloud.** Bridge events are sanitized
   (enum/boolean/coarse-bucket/16-hex only — Runtime ADR §3.4). Projection (which *would* stream pixels)
   is local-only and out of scope.
5. **Collection strategy per DataType (NAVER):**
   - **Orders** → official **NAVER Commerce API** (`NaverApiConnector`, ORDER_SUMMARY). LIVE-VERIFIED once
     (2026-06-14, Roadmap §4.1).
   - **Reviews** → **Action Window** (export for capture; guided **reply guidance** for response). There is
     **no official NAVER REVIEW API** (Roadmap §4.1, code comment). Manual upload is the interim fallback.
   - **Inquiries / products / store-metadata via official API** → **[REPO/CONFLICT]** the user's "official
     API first … where available" only resolves to ORDER_SUMMARY for NAVER in-repo today; NAVER API
     coverage for inquiries/products/store-metadata is **not established here** (§8-B_api). Do not promise
     it as v1.
6. **Dedicated Chrome profile for NAVER;** session persistence **on for the workday** (dedicated-profile
   persistence). Caveat in §8: persists *within a session*, not across a clean cold restart.
7. **Password storage/autofill = NO by default, opt-in only.** Repository-honest refinement: OS credential
   storage / auto-relogin (Device Vault) is **MISSING**, not merely off — v1 uses dedicated-profile session
   persistence + **human re-login**; autofill is not advertised (Runtime ADR §3.2/§4).
8. **CAPTCHA / 2FA / login / account-store selection are never bypassed or automated** — the seller
   performs login, confirmations, and every risky click (Runtime ADR §4 invariants; permanent).
9. **Reply submission is guided and zero-runtime-click.** The seller writes, pastes, and submits; the
   runtime **highlights the row/composer and observes only** — it never types and never clicks submit.
   `submissionRef` is single-use; on interruption the run **parks** and is not auto-re-driven. Terminal is
   **`OPERATOR_REPORTED` / `UNVERIFIED`**, never `COMPLETED` (Runtime ADR §4 v1.6; `reply-engine.ts`).
10. **No live NAVER without an explicit, single-use, in-turn G6 approval.** A plan, a prior approval, or
    goal pressure is never authorization (`r4-preparation.md` §3).

---

## 2. Excluded / deferred (v1 scope fence — do not start)

From current-task decision + Frontend Spec §16.11 + product-scope §6.1/§7.

- **Cropped/projection UI** — projection V0 code exists (`bridge/projection-*.ts`, commit `a0e4f6f`) but is
  **non-default, market-unapproved, local-only**. Excluded from v1; revisit only behind a policy gate.
- **Unattended / headless automatic collection** — supervised only; no scheduled unattended sync (Roadmap
  P4, separate kickoff). cold-context reconnect unresolved.
- **Auto-relogin · Device Vault · credential autofill** — MISSING; deferred.
- **Windows / cloud managed runtime** — macOS pilot only; bridge pairing fail-closes on non-macOS.
- **Auto app-issuance click · account/store-selection automation · auth bypass** — permanently excluded.
- **Multi-channel flow automation, auto product-matching, RBAC/billing/settlement/ads** — out of v1
  (product-scope §7).
- **Outbound writes beyond guided review reply** — inquiry answers, order-status changes are excluded.
  **[CONFLICT]** product-scope §7.2 lists *review reply* itself under excluded outbound; see §8-B6 for the
  reconciliation and the open PO decision on the live-reply completion bar.

---

## 3. NAVER onboarding flow (first-time user)

Authoritative completion criteria: **Frontend Spec §16.10, six steps**, assisted (product-owner observed).

1. Open the NAVER API-center flow from SellerOps (guide screen).
2. Guide the seller to **issue their own NAVER Commerce API application** (seller-owned app — *not* a future
   SellerOps solution-provider OAuth model; product-scope §6.1).
3. Register **Client ID / Secret** securely → backend **Vault** (`POST …/credentials`, AES-256-GCM).
4. **Connection test** passes (`test-connection`).
5. **First real order data** collected (NAVER ORDER_SUMMARY).
6. **Result shown** in SellerOps dashboard.

**State:** steps ③–⑥ exist as backend endpoints + one live ORDER_SUMMARY verification. The *guided*
wizard (①②③④⑤⑥ as one flow) is now **BUILT OFFLINE (G3-A/B)** — committed locally `f9d069c` on
`feat/naver-smartstore-v1`: a pure FE-owned guided-journey state machine
(`frontend/src/lib/guidedConnection/`) + the `ConnectNaver` wizard (`/connect/naver`, reached via a
`connect-naver` channel-card intent), reusing `useBridge` pairing + `api.storeCredential/testConnection/
manualSync`. The contract `docs/slices/naver-guided-connection.md` is now **RATIFIED (§0)** for G3-A/B.
The Client Secret never enters state/an event/localStorage (§11, test-enforced). **Live assisted walk
(real NAVER window, live session/DOM detection) is G3-C — gated** (PO sign-off + G6). Vendored API
reference: `docs/vendor/naver-commerce-api/`.

---

## 4. API connection flow (orders)

`credentials` (Vault store) → `test-connection` → manual `sync` → dashboard. Backend ingestion is
source-agnostic (`IngestionService.ingestOrderSummaries`, dedup + per-row tx + `SyncJob`).

- **Connector:** `backend/…/connector/naver/` — `NaverApiConnector` (`ORDER_SUMMARY` only),
  `NaverTokenClient` (OAuth2 `client_credentials`, `type=SELF`, `client_secret_sign` bcrypt signature),
  `NaverOrdersClient` (two-call flow: `last-changed-statuses` → `product-orders/query`). **Flag-gated:**
  all beans live behind `sellerops.connector.naver.enabled=true` — **default off → NAVER resolves to the
  mock connector.** The collector has only a stub `connector/api-connector.ts` (no NAVER API client).
- **NAVER ORDER_SUMMARY: LIVE-VERIFIED once** (2026-06-14, Roadmap §4.1 / `sellerops_phase3c_live_smoke`).
- **Inquiries/products** = deferred pending their own schema verification; **store-metadata/reviews** = no
  official API (connector header + Roadmap §4.1). Not v1 — see §1.5 / B_api.
- Every run (API-pull or collector export or manual upload) surfaces as one `SyncJob` row (single lifecycle).

---

## 5. Local Agent / session flow

- **Dedicated real Chrome + persistent profile** (`profile.ts`, `ProgressiveReconnectChromeBrowser`,
  `progressive-reconnect-chrome.ts`). `.profile/` is device-local, never staged.
- **Local agent lifecycle** (`cli/local-agent.ts` + `src/agent/*`): 11-state machine
  (`local-agent-state.ts`), SIGINT/SIGTERM idempotent shutdown, resident browser with WAITING/HUMAN
  handoff. Tray/installer/OS-autostart are **MISSING**; periodic catch-up is a not-yet-wired slice.
- **FE↔agent bridge/pairing** (`bridge/*`): fail-closed pairing; **macOS native approval presenter
  LIVE-VERIFIED** (2026-07-15, three human outcomes observed). Windows/Linux presenters **MISSING** →
  those hosts fail-closed reject pairing (honest, not a regression).
- **Session model:** dedicated-profile session preserved + **human re-login** on expiry/2FA/CAPTCHA. Auto
  re-login/Device Vault **MISSING**. `autoReconnectConsent` gating: no browser launch without consent.
- **Session persistence caveat [REPO]:** persists *within* a live session (incl. new tab); a **clean cold
  restart still requires re-login** (ESM decision D8; NAVER shares the gap). So "persistence for the
  workday" holds intra-session, not across a cold restart.

---

## 6. Review export Action Window flow

The only verified NAVER review-capture path. Driver: `cli/run-action-window-live-naver.ts`; read-only
discovery: `cli/discover-export.ts`.

Sequence: session/reconnect → readiness gate (empty-state-marker precedence fix, RESOLVED LIVE §8-14/16) →
**operator clicks** the highlighted export control (supervised, exactly-once) → **operator confirms** the
expected NAVER dialog (two-step human action, ~two windows) → download detected → **quarantine validation**
(OOXML/ZIP magic sniff, D-021) → `POST /api/uploads` ingest → local `.status/naver.json`.

**State: LIVE-VERIFIED end-to-end — Run 4 (2026-07-15, §8-17)**, 3-of-3, backend `SUCCESS 55/55/0/0`
(local dev backend, not production). Barrier `USER_ACTION_OBSERVED` LIVE-PROVEN (Run 5, §8-18); CLI
recovery loop LIVE-PROVEN (Run 6, §8-23).

**Open finding [B3]:** §8-24 (2026-07-18) — a real export download **FAILED D-021 quarantine
(`ARTIFACT_INVALID`)**, diverging from Run 4's clean OOXML; cause undetermined, artifact not inspectable. A
classification probe needs a fresh single-use G6.

---

## 7. Review reply Action Window flow

Guided, zero-runtime-click reply. Three CLIs, privacy-safe hint contract:

1. **`cli/discover-reply-target.ts`** — read-only, no-click row-structure discovery (counts/enums/booleans/
   opaque position sigs only). **COMMITTED** (PR #309). No live selector yet.
2. **`cli/prepare-reply-target.ts`** *(uncommitted)* — authenticated loopback backend call; backend derives
   **and validates** a privacy-safe `ReviewReplyTargetHintView` (`rating` 1–5, KST-date-only
   `recencyBucket`, one-way `bodyFingerprint`) **before** minting a single-use `submissionRef`; writes an
   owner-only 0600 one-shot bundle under `.reply-target/` bound to an explicit `asOfDate` (expires when KST
   date changes). Ids/refs never touch argv/stdout.
3. **`cli/run-reply-submission-live-naver.ts`** — guided mutating run: `LOCATE_ROW → HIGHLIGHT_ROW →
   WAIT_FOR_ROW_OPEN → composer submit barrier`, driven by the hint; the **seller submits**, runtime
   highlights+observes. Terminal `OPERATOR_REPORTED`/`UNVERIFIED`. `ABORT_REHEARSAL` mode makes the
   submitted terminal structurally unreachable (requires a hint).

**Shared fingerprint contract** *(uncommitted)*: `contracts/review-fingerprint/v1/{SPEC.md,golden-vectors.json}`
+ `common/ReviewBodyFingerprint.java` + `review-body-fingerprint.ts`, byte-identical across Java/TS,
proven by shared golden vectors — this **closes the former `FINGERPRINT_NORMALIZATION_SPEC_MISSING`
blocker for same-text parity**. `reviewRowLocateDecision` is reused by discovery and the live driver so
they cannot disagree.

**State: OFFLINE-PROVEN + committed locally** as `12c93a8` on `feat/naver-smartstore-v1` (collector
typecheck clean, full suite 3367 pass/41 skip; backend 90 pass — `ReviewBodyFingerprintTest` 28,
`ReviewRecencyBucketTest` 5, `ReviewReplyServiceTest` 57). Local commit only — **not integrated to main**.
**No live reply has ever run.** Live blockers: B1 (cross-source fingerprint), B2 (fail-closed row
selector). See §8.

---

## 8. Remaining blockers

| # | Blocker | Class | Gates | Note |
|---|---|---|---|---|
| B1 | **Cross-source fingerprint** — Java≡TS proven on the *same text*, but a live NAVER DOM row's rendered text is **not proven** to normalize to the backend's *stored* body (truncation, entity encoding, emoji, trailing UI). | [EXT] | live reply row-match | Explicit non-goal in the SPEC. |
| B2 | **No live reply row selector** — `naver-reply-driver.ts` row methods are fail-closed (`{count:0}`/`false`), by design, pending live DOM evidence. | [REPO]→live | live reply | Needs a read-only live discovery run (fresh G6) first. |
| B3 | **Export `ARTIFACT_INVALID` finding** (§8-24) — a real export download failed quarantine; cause undetermined. | finding | export reliability | Classification probe needs fresh G6. |
| B4 | **Cold-restart reconnect persistence.** **HANDLED-OFFLINE 2026-07-19** (`18171b2`, `<this>`): the wizard now models `reconnect_required` first-class + recoverable, wires **live bridge session detection** (`bridgeSessionDetection`) as the readiness source with attestation as fallback, and makes detection outrank attestation. **Underlying auto-inherit-across-cold-launch stays OPEN by design** — the answer is re-login inside the dedicated window (Device Vault excluded). Multi-connection channel-ref disambiguation is a reported bridge-protocol gap (v1 = single connection). | HANDLED (offline) | readiness detection | Intra-session OK; cold launch → re-login in the dedicated window. |
| B5 | **Auto-relogin / Device Vault / autofill** MISSING. | scope | opt-in autofill | v1 = human re-login only; do not advertise autofill. |
| B6 | ~~**[CONFLICT/PO]** product-scope §7.2 excludes review-reply outbound; Runtime ADR §4 v1.6 + current-task decision include *guided* reply.~~ **RULED 2026-07-19 (PO):** v1 completes at reply **offline-proven + backend-verified + read-only live discovery (B2 lifted)**; **live guided reply submission is a gated follow-up** (separate PO sign-off + fresh G6). | RESOLVED | — | Recorded also in §9. |
| B7 | Bridge pairing production-ready **macOS only**; Windows/Linux fail-closed. | platform | non-mac deploy | macOS pilot unaffected. |
| B8 | ~~Uncommitted backend fingerprint/hint/DTO + service changes not yet built/tested.~~ **RESOLVED 2026-07-19:** offline backend unit tests run (approved) — 90 pass; whole slice committed locally `12c93a8`. | RESOLVED | — | Local commit only; not integrated. |
| B9 | ~~FE guided-connection onboarding MISSING; contract DRAFT.~~ **RESOLVED-OFFLINE 2026-07-19:** contract RATIFIED (§0) + `ConnectNaver` wizard built & tested offline (G3-A/B), committed `f9d069c`. **Live assisted walk (G3-C) still gated** (PO + G6). | RESOLVED (offline) | — | Live DOM/session detection deferred to G3-C. |

---

## 9. Completion criteria

**v1 is "complete" when** (recommended bar, pending B6 PO ruling):

- **Onboarding+API:** the 6-step NAVER guided-connection flow (§3) is walkable assisted, with order sync
  landing in the dashboard. *(Backend order path already LIVE-VERIFIED once; the guided FE overlay is the
  remaining build.)*
- **Review export:** LIVE-VERIFIED end-to-end **[met, Run 4]**, with the B3 `ARTIFACT_INVALID` finding
  triaged (probe run, fresh G6) or explicitly accepted as a known caveat.
- **Review reply:** the guided reply *preparation* path (discovery + hint bundle + guided driver) is
  **OFFLINE-PROVEN and committed**, backend fingerprint/hint verified (B8), and a **read-only live row
  discovery** has produced the DOM evidence to lift B2. **Live guided reply submission is gated** to a
  separate, explicitly-authorized run (B6) — *not* a silent part of the v1 "done" line unless the PO rules
  otherwise.
- **Honesty:** every capability in UI/reports is tagged per Roadmap §4.1; nothing on the deferred list
  (§2) is shown as supported.

**Single remote git integration** happens **only at this completion point** (per the phase workflow rule).

---

## 10. Verification plan

Offline / non-live (run freely):

1. **Collector:** `cd collector && npm run typecheck && npm test` (full vitest). Standing green gate.
2. **Fingerprint cross-language parity:** collector `review-body-fingerprint.test.ts` +
   `contracts/review-fingerprint/v1/golden-vectors.json` reproduced by both sides.
3. **Backend:** build + unit test the reply/fingerprint module (`ReviewBodyFingerprintTest`,
   `ReviewRecencyBucketTest`, `ReviewReplyServiceTest`). **Gated** — Java/backend build is in the
   CLAUDE.md gated-surfaces set; run only with explicit approval. Until then B8 stays open.
4. **Offline reply-target e2e:** `reply-target-binding.e2e.test.ts`, `prepare-reply-target.test.ts`.
5. **`git diff --check`**; confirm `package.json`/`package-lock.json` unchanged; never stage `.env`,
   `.profile/`, `.status/`, `.reply-runs/`, `.reply-target/`, `downloads/`, `.claude-worktree-owner`.

Live (each requires a fresh, single-use, in-turn **G6**; **hold** — do not launch without it):

6. **Read-only live reply-target discovery run** (`discover-reply-target.ts`, `--classify-only`) → DOM
   evidence to design the row selector (lifts B2). Sanitized output only.
7. **Export `ARTIFACT_INVALID` classification probe** (B3), non-mutating.
8. **Gated live guided reply submission** (B6) — only after the PO ruling; single-use `submissionRef`,
   parks on interruption, terminal `OPERATOR_REPORTED`/`UNVERIFIED`.

---

## Unresolved-point classification (CLAUDE.md assumption rule)

- **[REPO] repository-verifiable:** backend build/test of the uncommitted fingerprint/hint work (B8);
  NAVER API coverage beyond ORDER_SUMMARY (§1.5 — confirmed deferred/absent).
- **[EXT] external-research:** live-DOM ↔ stored-body fingerprint reconciliation (B1); NAVER review-row
  live DOM shape (B2 evidence).
- **[PO] product-owner decision:** the v1 completion bar for live reply (B6); ratifying the DRAFT
  onboarding contract before FE build (B9); whether to triage or accept the export B3 finding within v1.
