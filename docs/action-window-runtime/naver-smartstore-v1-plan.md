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
  reconciliation. **RULED 2026-07-20 (PO):** v1 performs **no outbound reply write** — SellerOps guides /
  highlights / opens the composer, the **seller submits**; live reply submission is post-v1.

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
| B2 | **No live reply row selector** — `naver-reply-driver.ts` row methods are fail-closed (`{count:0}`/`false`), by design. **PARTIALLY LIFTED (LIVE 2026-07-20, single-use G6 consumed)** — a read-only no-click census captured the row structure (see the note below); **NOT fully lifted** — per-row rating/date value sub-selectors still need live calibration. The **offline**
half of that calibration is now built and wired **report-only** (candidate ladder → `ladderCalibration`,
2026-07-20, no live, no G6) — see the note below. ⛔ **That ladder is SUPERSEDED BEFORE ADOPTION (2026-07-20):**
its live pass returned a negative result and the stronger path is the operator-assisted calibration stack on
`feat/naver-guided-reply-session-v1`, **RULED 2026-07-20 (PO) as the guided-reply source of truth**; no
integration before the final v1 integration. | [REPO]→live → **RULED (PO)** | live reply | Container captured live; ladder dead-lettered here; row match now owned by the calibration stack on the other branch. |
| B3 | **Export `ARTIFACT_INVALID` finding** (§8-24) — **DOWNGRADED 2026-07-20 to a non-reproducing intermittent finding.** Run A″ + Run B both executed live in same-session sentinel mode; **Run B's artifact was VALID** (`fileFamily: ooxml_zip_like`, `xlsxReadable: true`), so the original failure **did not reproduce**. Cause remains **unexplained — not "fully explained."** **✅ ACCEPTED 2026-07-21 (PO): B3 is TRIAGED-and-ACCEPTED for v1 and does NOT block v1 completion** — a **known caveat**, closed to further live probing. Run B evidence: `fileFamily: ooxml_zip_like`, `xlsxReadable: true`, `savedExtensionCategory: xlsx`, artifact **deleted** after classification, **no upload / backend / status write**. | finding → **ACCEPTED (PO)** | export reliability | **CLOSED to further live probing — no more B3 live download probes.** Unproven date-range hypothesis recorded in the §8 note only; no detector/gate/D-025 work opened. ⚠ Run B was a **one-off supervised diagnostic exception**, NOT v1 product behavior — production export stays human-driven Action Window. |
| B4 | **Cold-restart reconnect persistence.** **HANDLED-OFFLINE 2026-07-19** (`18171b2`, `<this>`): the wizard now models `reconnect_required` first-class + recoverable, wires **live bridge session detection** (`bridgeSessionDetection`) as the readiness source with attestation as fallback, and makes detection outrank attestation. **Underlying auto-inherit-across-cold-launch stays OPEN by design** — the answer is re-login inside the dedicated window (Device Vault excluded). Multi-connection channel-ref disambiguation is a reported bridge-protocol gap (v1 = single connection). | HANDLED (offline) | readiness detection | Intra-session OK; cold launch → re-login in the dedicated window. |
| B5 | **Auto-relogin / Device Vault / autofill** MISSING. | scope | opt-in autofill | v1 = human re-login only; do not advertise autofill. |
| B6 | ~~**[CONFLICT/PO]** product-scope §7.2 excludes review-reply outbound; Runtime ADR §4 v1.6 + current-task decision include *guided* reply.~~ ~~**RULED 2026-07-19 (PO):** v1 completes at reply **offline-proven + backend-verified + read-only live discovery (B2 lifted)**.~~ **SUPERSEDED — RULED 2026-07-20 (PO): live guided reply SUBMISSION is NOT required for v1 completion.** The v1 bar is: source of truth = `feat/naver-guided-reply-session-v1`; **calibrated target discovery + row mapping + row identity + composer-open or abort-safe hand-off evidence**; **no final submit click on NAVER**. Live submission = **post-v1 gated follow-up** (separate PO approval + fresh G6). ⚠ Seller/user performs the final platform submission in v1; **automated reply submission is NOT v1-supported behavior**. | RESOLVED | — | Recorded also in §9. |
| B7 | Bridge pairing production-ready **macOS only**; Windows/Linux fail-closed. | platform | non-mac deploy | macOS pilot unaffected. |
| B8 | ~~Uncommitted backend fingerprint/hint/DTO + service changes not yet built/tested.~~ **RESOLVED 2026-07-19:** offline backend unit tests run (approved) — 90 pass; whole slice committed locally `12c93a8`. | RESOLVED | — | Local commit only; not integrated. |
| B9 | ~~FE guided-connection onboarding MISSING; contract DRAFT.~~ **RESOLVED-OFFLINE 2026-07-19:** contract RATIFIED (§0) + `ConnectNaver` wizard built & tested offline (G3-A/B), committed `f9d069c`. ~~**Live assisted walk (G3-C) still gated** (PO + G6).~~ **RULED 2026-07-21 (PO) — B9 is CLOSED for v1.** The ratified G3-A/B contract **is** the v1 bar: wizard + secure credential form → Vault → `test-connection` → `sync` → dashboard. API-center steps ①② ship **tutorial-guided with seller self-attestation**. **G3-C.1 and G3-C.2 are NOT v1 gating**; live API-center observation is **diagnostic / tool-calibration evidence only**. G3-C.2 live runs **did occur** in this workstream — sanitized **page-category** observation and `observe-api-center` classifier calibration **only** — and they do **NOT** prove first-time issuance completion, policy permission, credential extraction, or `test-connection`/`sync` success for a freshly issued app. | RESOLVED → **RULED (PO)** | — | ⚠ API-center = **guided tutorial support only**: no automatic issuance/linking, no click/type/submit there, and **SellerOps never reads Client ID/Secret from the page** — the seller creates/opens the app and copies the values manually. Assisted end-to-end walk against a **freshly issued** app = **POST-v1** (mutates Vault + local DB; separate PO approval + fresh G6). **No live run scheduled.** |

**B2 live census — 2026-07-20 (sanitized · read-only · no-click · single-use G6 consumed).**
`discover-reply-target --classify-only` over the live review-management list, with the offline **settle
hardening** in the loop:

- **`selectorKind` = 2 = `ul > li`** — review rows are list-items (not `[role=row]` / `article`).
- **18 candidate rows; 14 body-present** — ~4 non-review `li` (header/controls) are mixed in, so a bare
  `ul > li` overcounts; the real row selector needs a text-bearing/structure filter.
- **Settle hardening verified LIVE** — rows that render after `domcontentloaded` were captured: **no
  `ROW_CENSUS_SETTLE_TIMEOUT`, no `NO_ROW_CANDIDATES`**. The exact false-empty this slice fixed did not recur.
- **Still deferred (unchanged):** `RATING_VALUE_PARSE_DEFERRED` · `RECENCY_BUCKET_DERIVATION_DEFERRED` ·
  `FINGERPRINT_LIVE_EXTRACTION_DEFERRED`. The generic rating/date node heuristics matched **0 / 18**, so
  per-row value sub-selectors need NAVER-specific live calibration.
- Sanitized throughout — counts / booleans / opaque position sigs only; no raw review/author/product/date/
  URL/id. Nothing written (`.status/`, `downloads/`, `.reply-target/` all untouched).

**B2 is PARTIALLY LIFTED, not complete.** The fail-closed row-locate seam now has a live-grounded container
family + row-count order + opaque sigs, but a fingerprint/rating/date-matched selector still needs the
deferred value calibration (a separate future step — not designed or run here).

**B2 offline calibration wiring — 2026-07-20 (OFFLINE ONLY · no live · no G6 consumed).** The offline half
of the deferred value calibration is built and wired as **report-only** output. Uncommitted; local tree only.

- **New pure leaf** `collector/src/action-window/reply-submission/review-row-candidate-ladder.ts` — an
  ordered **candidate ladder** per value kind (rating / date / body) plus a fail-closed decision:
  `MATCHED` only on a unique, value-bearing node; otherwise `NOT_FOUND` / `AMBIGUOUS` / `PARSE_FAILED`.
  Row disambiguation classifies each `ul > li` candidate `REVIEW_ROW` / `UNCERTAIN_ROW` /
  `NON_REVIEW_ROW`, so the ~4 non-review list-items that inflated the live census are filtered out and a
  body-bearing row whose rating+date do not both resolve stays **UNCERTAIN**, never promoted.
- **Wired into** `collector/src/cli/discover-reply-target.ts` as a second READ-ONLY in-page pass, surfaced
  as a new `ladderCalibration` field on `DiscoverySummary`. Its purpose is to report **which structural
  hypothesis fires** on live markup instead of a bare "0 / 18 matched".
- **Report-only — it changes no decision.** It does **not** enrich `rating` / `recencyBucket` /
  `bodyFingerprint`, does **not** participate in expected-hint matching, and does **not** clear
  `RATING_VALUE_PARSE_DEFERRED` / `RECENCY_BUCKET_DERIVATION_DEFERRED` /
  `FINGERPRINT_LIVE_EXTRACTION_DEFERRED`. Unmatched and ambiguous stay deferred. Existing 3/4-arg callers
  are unchanged; a failed probe reports `LADDER_PROBE_UNAVAILABLE` rather than reading as clean.
- **Sanitized output only** — enum strings, coarse `none|one|few|many` buckets, small rung ordinals, and
  nulls. **No raw review text, date, rating value, author, product, review id, URL, DOM, class name,
  selector string, hash, path, or screenshot is emitted.** A defensive intake (`sanitizeLadderProbes`)
  drops anything that is not an ordinal / non-negative count / boolean, so no string can reach the report
  even from an unexpected page payload.
- **No platform contact.** No click, type, submit, upload, download, backend call, or `.status/` write —
  offline build and unit tests only.
- **Verified offline:** collector typecheck clean; full suite **3482 pass / 41 skip**; `git diff --check`
  clean; `package.json` / `package-lock.json` unchanged; nothing staged, nothing committed.

> ⚠ **The ladder has NOT seen live markup.** Every rung is an **unratified hypothesis** — none is a
> confirmed NAVER selector, and `calibrationState: "READY"` would mean only that the ladder resolved on
> the rows it was shown. **B2 is still NOT fully lifted.**
>
> **Next step:** a future **read-only, no-click live calibration pass** to observe which rungs fire, then
> human ratification of the winning rungs. It requires a **fresh single-use in-turn G3/G6**,
> seated-and-ready confirmation, and the §10 **product-boundary check** — it is product-path behavior and
> mutates nothing, but no standing authorization covers it. Rungs may be corrected **only** from observed
> sanitized findings, never speculatively tuned (collector `CLAUDE.md` §4.6).

**B2 sentinel-mode hardening — 2026-07-20 (OFFLINE ONLY · no live · no G6 consumed).** `discover-reply-target`
now supports the same-session hand-off the other live CLIs use, so the pending calibration pass cannot be
wasted on a cold or reconnect-required profile. Uncommitted; local tree only.

- **`--require-sentinel` (alias `--sentinel`, override `--no-sentinel`)** on `--discover --classify-only`.
  **Purpose: stop burning a single-use G6 on failure mode ①** — previously the CLI navigated and read
  immediately, so a cold / `RECONNECT_REQUIRED` profile produced an empty census and no evidence. This is
  the same correction §8 already recorded for B3 (`capture-export-same-session`), applied to discovery.
- **One context, one lifetime.** The operator logs in / clears 2FA / completes the Commerce reconnect and
  account-store selection / navigates to the **review-management list — in that same open window, leaving
  it open**. After they say ready the sentinel is touched; **only then** does the existing settle census +
  `ladderCalibration` read-only pass run, on the page **as they left it (no re-navigation)**.
- **Shared sentinel path** — `sentinelPathFor(cfg.statusFile)`, i.e. the same `.status/` continuation file
  the other same-session CLIs use. **Run only one same-session CLI at a time.**
- **Stale sentinel cleared BEFORE polling**, so a leftover file from an earlier run can never satisfy the
  gate and the census can never read a page the human has not finished preparing.
- **Timeout fails closed** (10 min budget, 750 ms poll, bounded by iteration count — no wall-clock read):
  the page is **never read**, no summary is emitted, exit code 4. The read is wrapped in a pure combinator
  so the census structurally cannot run before the gate resolves `ready`.
- **Cleanup** removes the sentinel **and** closes the context on every path, including timeout and error.
- **No click, type, submit, upload, download, backend call, or `.status/` write.** The sentinel file is the
  only filesystem touch and it is removed, not written.
- **Output shape unchanged and sanitized** — identical keys in both modes; sentinel mode adds no new
  output. Default (non-sentinel) behavior is unchanged, and `--discover` still hard-requires
  `--classify-only`. No expected-hint involvement.
- **Verified offline:** collector typecheck clean; full suite **3491 pass / 41 skip**; `git diff --check`
  clean; `package.json` / `package-lock.json` unchanged; nothing staged, nothing committed.

> **B2 remains PARTIALLY LIFTED, not complete.** This hardens the *dispatch*, not the finding — exactly as
> Run A″ did for B3. The ladder still has not seen live markup. The **read-only live calibration pass is
> still pending** and requires a **fresh single-use in-turn G3/G6**, seated-and-ready confirmation, and the
> §10 **product-boundary check**.

**B2 live calibration pass — 2026-07-20, EXECUTED (fresh G3/G6 CONSUMED). NEGATIVE RESULT.** Sentinel-mode
`discover-reply-target --discover --classify-only --require-sentinel`. The hand-off worked (page read as the
operator left it, exit 0); **zero clicks, zero typing, no download, no upload, no backend call, no `.status/`
write**; clean teardown, sentinel removed, quarantine empty, repo untouched.

- **Census:** `selectorKind: 2` (`ul > li`), **`reviewRowCandidateCount: 201`**, `bodyNodePresentCount: 83`,
  `ratingNodePresentCount: 1`, `dateNodePresentCount: 0`; no settle timeout, no `NO_ROW_CANDIDATES`.
- **`ladderCalibration`:** `reviewRowCountBucket: "none"` — **zero rows classified `REVIEW_ROW`**;
  `calibrationState: "UNCALIBRATED"`. `rating.firstMatchingRung: 2` (one row, plus one `PARSE_FAILED`),
  **`date.firstMatchingRung: null`**, `body.firstMatchingRung: 0` with "many" ambiguous. All three
  `*_NODE_UNRESOLVED` and `*_CANDIDATE_AMBIGUOUS` blockers raised. Deferred summary blockers unchanged.

**⇒ Retained ONLY as evidence that a bare `ul > li` container is far too coarse on the live surface**
(201 candidates / 83 body-bearing, vs 18 / 14 previously — the container is matching page chrome well beyond
review rows), and that the date-node hypotheses find nothing on this surface. **No rung is ratified.**

> ⚠ **B2 ladder work in THIS worktree is SUPERSEDED BEFORE ADOPTION as a product path (2026-07-20).**
> **Do not schedule further B2 ladder live runs here.** The ladder *guesses* structural rungs; the negative
> result above is the predicted failure mode of guess-first selector discovery, which collector
> `CLAUDE.md` §4.6 forbids as speculative tuning.
>
> **The stronger guided-reply path appears to live in a different workstream** —
> `sellerops-naver-live-review-match` / `feat/naver-guided-reply-session-v1` (merged PRs #311–#315) — which
> replaces guessing with **operator-assisted calibration**: `cli/calibrate-reply-target.ts` (the operator
> points at the real row and its body/date/rating/reply-control via inert numbered badges) →
> `reply-row-mapping-artifact.ts` (relative structural index-paths only, bound by schema version +
> structural page signature + short TTL, fail-closed on `PAGE_DRIFT`/`EXPIRED`) → `reply-row-inpage.ts`
> (extraction over the calibrated paths, sanitized in-page) → `review-id-locator.ts` (identity-keyed
> exactly-one-or-nothing row match) → `reply-cross-source.ts` (per-target live↔backend fingerprint equality).
>
> **This is a SOURCE-OF-TRUTH / WORKSTREAM RECONCILIATION issue, not a selector-tuning issue.** That branch
> is **not** an ancestor of `feat/naver-smartstore-v1`; this plan's §7/§8 carry **no** reference to it, so
> the B2 description here is accurate *for this branch* and stale *for the workstream*.
>
> ### ✅ RULED 2026-07-20 (PO): the NAVER v1 guided-reply source of truth is `sellerops-naver-live-review-match` / `feat/naver-guided-reply-session-v1`
>
> - **This worktree's B2 ladder / discover calibration is NOT the product path.** It is a **superseded
>   dead-letter experiment** — retained on disk for the evidence trail, not deleted, not built on, and
>   never presented as a v1 capability.
> - **Only the generally reusable `settleRowCensus` + `--require-sentinel` hardening is kept**, as possible
>   utility for any read-only discovery run.
> - **No further B2 ladder live runs in this worktree.**
> - **All future guided-reply work is based on the operator-assisted calibration stack:**
>   `calibrate-reply-target` → row-mapping artifact → `reply-row-inpage` → `review-id-locator` →
>   `reply-cross-source`.
>
> **No branch integration is performed now.** The phase rule forbids push / PR / merge / rebase / remote
> sync; the **single final NAVER v1 integration remains the only allowed integration point**. **B6 remains
> a separate PO ruling** and is unaffected by this one.

**Local-change classification (2026-07-20, uncommitted, this worktree):**

| Change | Classification |
|---|---|
| `settleRowCensus` hardening + `--require-sentinel` same-session mode in `discover-reply-target.ts` | **KEEP — possible reusable utility.** Both are general-purpose and independent of the ladder: the settle fix is live-verified, and the sentinel gate stops any read-only discovery run from burning a grant on a cold / reconnect-required profile. |
| `review-row-candidate-ladder.ts` + its test + the `ladderCalibration` wiring | **DEAD-LETTERED — superseded experiment**, unless the user later decides otherwise. Retained on disk for the evidence trail; **not deleted**, not to be built on, not to be presented as a v1 capability. |
| Parked concurrent reply-target files (`prepare-reply-target.ts`, `reply-target-bundle.ts`, their tests) | **UNTOUCHED — left parked.** |

**B3 Run A attempt — 2026-07-20, HALTED, no evidence (G3/G6-A CONSUMED).** `capture-export-same-session
--diagnose-export-click --diagnose-allow-empty-target --diagnose-review-usage-confirm-candidates`, dispatched
to surface the consent-modal candidate indices:

- **Result: `halted:true`, `gateState: RECONNECT_REQUIRED`, `wouldClick:false`** — session read
  `verdict: RECONNECT_REQUIRED` / `urlCategory: login` on the first check; the guarded reconnect pre-step
  fail-closed before the capture gate.
- **Zero export clicks · zero consent clicks · no download · no candidate indices.** No upload, no backend
  contact (`uploadFn` never constructed ⇒ no credential read), no `.status/` write, quarantine dir absent.
  Clean teardown, profile lock freed, repo untouched.
- **Confirms the cold-session/login prerequisite** (the B4 session-readiness caveat): a completed Commerce
  reconnect/store selection does **not** survive into a fresh context, so **B3 Run A must never be attempted
  from a cold profile.**

**B3 Run A′ attempt — 2026-07-20, HALTED, no evidence (fresh G3/G6-A′ CONSUMED).** Re-dispatched after a
separate login-only step. **Identical outcome:** `halted:true`, `gateState: RECONNECT_REQUIRED`,
`wouldClick:false`; `verdict: RECONNECT_REQUIRED` / `urlCategory: login` **on check 1** (~2 s after launch).
**Zero export clicks · zero consent clicks · no download · no save/classify · no upload / backend / `.status/`
write · clean teardown, profile lock freed · no candidate indices.** Not retried in place.

> ⚠ **CORRECTION — the login-only prerequisite recorded above is INVALID for this path; do not follow it.**
> Login-only in a **separate, then-closed** context cannot work: that context's session does **not** survive
> into the run's fresh context (the same B4 / cold-restart gap), so closing the window guarantees the failure
> it was meant to prevent. Two independent causes were confirmed:
> 1. **Separate-context login does not carry over** — login at 12:08 (context #1, closed) → Run A′ at 12:22
>    (context #2) read a login wall.
> 2. **Auto-read never yields a login window.** `RECONNECT_REQUIRED` is a *resolvable* start verdict, so the
>    poll stops at **check 1** and hands to the guarded continue, which fail-closes (it needs a configured
>    continue-card fingerprint). The banner's "login/2FA are waited through" covers `NOT_LOGGED_IN`/unknown,
>    **not** `RECONNECT_REQUIRED`. From a cold profile this halts in ~2 s regardless of operator presence.
>
> **Corrected B3 dispatch — `capture-export-same-session` MUST run in same-session sentinel mode from a cold
> profile** (`--require-sentinel`, alias `--sentinel`): the CLI opens the dedicated profile, prints a sentinel
> path, and **waits**. The operator logs in, clears 2FA/CAPTCHA, completes the Commerce reconnect / store
> selection, and navigates to the **review-management list — in that same open window, leaving it open**. The
> sentinel is then touched; **only then** does the CLI hydrate and read the verdict **in the same context**,
> and only on `LOGGED_IN` + all guards may it perform **one** guarded export-control click.
> **Do not use the auto-read Run A form from a cold profile again.** Run A stays **SUPERVISED_ACTION**
> (≤1 export click, 0 consent clicks); Run B remains a **separate** fresh-G6-B dispatch.

**B3 Run A″ — 2026-07-20, SUCCESS (fresh G3/G6-A″ CONSUMED). The corrected sentinel-mode dispatch works.**
Re-dispatched with `--require-sentinel --diagnose-export-click --diagnose-allow-empty-target
--diagnose-review-usage-confirm-candidates`. The operator logged in / reconnected / selected the store /
reached the review-management list **in the same open window**; the sentinel was touched only then.

- **Sentinel mode resolved the `RECONNECT_REQUIRED` halt.** Post-sentinel read: `verdict: LOGGED_IN`,
  `urlCategory: seller-center` — **not** `RECONNECT_REQUIRED`. The same-session handoff carried the login,
  so the guarded continue was never invoked (**0 continue clicks**). Confirms the correction above.
- **Gate:** `gateState: CONNECTED`, `supervisedExportLayout: SYNC_DOWNLOAD`, `supervisedExportActionable:
  true`, ready on supervised check 1.
- **One export-control click** (`clicked: true`, `clickedCount: 1`) → **`outcome:
  REVIEW_USAGE_CONFIRMATION`** (`modalCategory: review_usage_confirmation`; `downloadFired: false`,
  `asyncJobMarkerPresent: false`, `popupOpened: false`, `dialogType: none`).
- **Candidate scan (NO-CLICK):** `candidateScan: SCANNED`, `candidateCountBucket: few`,
  `candidateIndices: [0,1,2]` — index 0 `cancel`, index 1 `cancel`, **index 2 `affirmative`**; all three
  `visible: true, enabled: true`. **Exactly one affirmative: index 2** (consistent with the Milestone-E
  approved index, to be **re-validated live** before any Run B click).
- **Zero consent clicks · no download · no save/classify · no upload / backend / `.status/` write** —
  `approvedIndexDecision: SKIP_NO_INDEX`, `confirmDecision: SKIP_NO_FLAG`, `downloadSaveReason:
  NOT_REQUESTED`, `uploadReason: NOT_REQUESTED`, `collectorStatusWritten: false`. Clean teardown; sentinel
  removed; quarantine dir empty; profile lock freed. Sanitized enums/booleans/buckets/indices only.

**B3 remains UNRESOLVED.** Run A″ lifted the *dispatch* blocker (how to reach the consent modal), not the
finding itself: the `ARTIFACT_INVALID` cause still requires Run B's artifact classification (approved-index
consent click → download → save → `fileFamily` → delete-after-validate), under a **separate fresh G6-B**.

> **Side observation, recorded only — no scope expansion.** Run A″'s `preClick` reported
> `dateRangeRequired: true` with `selectedRangePresent: false`, the known **D-025** attribute-detector blind
> spot on this surface. It did **not** block the gate or the click. Recorded as evidence only; no detector
> change, no gate change, and no D-025 work is opened by B3.

**B3 Run B — 2026-07-20, EXECUTED (fresh G3/G6-B CONSUMED). Valid artifact; the failure did NOT reproduce.**
Same-session sentinel mode + `--diagnose-confirm-review-usage-index 2 --diagnose-save-review-download`
(no upload/status flags). Post-sentinel `verdict: LOGGED_IN` / `urlCategory: seller-center`, gate
`CONNECTED` / `SYNC_DOWNLOAD`. **Exactly two clicks**, both authorized: (1) the export control →
`REVIEW_USAGE_CONFIRMATION`; (2) approved index 2 → `confirmOutcome: DOWNLOAD`. Index 2 was
**re-validated live** before binding (`approvedIndexDecision: ATTEMPT` → `approvedIndexBind: BOUND`),
so a stale approval could not have clicked the wrong control.

- **Artifact classification:** `fileFamily: **ooxml_zip_like**`, `xlsxReadable: true`,
  `savedExtensionCategory: xlsx`, `fileSizeBucket: small`, `downloadSaveReason: SAVED`.
- **Artifact DELETED after classification** — `fileRetained: false`, `deleteFailed: false`,
  `retentionPolicy: delete-after-validate`; quarantine dir verified empty.
- **No upload · no backend call · no DB ingest · no `.status/` write · no `LAST_SUCCESS`** —
  `uploadRequested/upload: false`, `statusWritten: false`, `dbMutated: false`, `lastSuccessWritten: false`.
- Clean teardown; sanitized enums/booleans/buckets/hashes only.

**⇒ The original §8-24 `ARTIFACT_INVALID` did NOT reproduce.** This run produced a structurally valid
workbook — not HTML, not CSV, not partial, not empty.

> **B3 is DOWNGRADED to a non-reproducing intermittent finding. It is NOT fully explained — do not record
> it as such.** One valid capture does not identify the original cause; it only shows the mechanism can
> succeed. **No further B3 live download probes are to be run.**
>
> **Hypothesis, unproven, recorded only:** Run B observed `followUpModalCategory: "date_range_required"`
> after the consent click (the download fired and validated anyway), alongside the recurring
> `dateRangeRequired: true` / `selectedRangePresent: false` (D-025) in `preClick`. An export taken with no
> explicit range selected is a *plausible* line of inquiry for the original failure. **This run's artifact
> was valid, so nothing here proves it.** No detector, gate, or D-025 work is opened by B3.

> ⚠ **BOUNDARY — Run B was a ONE-OFF SUPERVISED DIAGNOSTIC EXCEPTION, not NAVER v1 product behavior.**
> The two clicks were taken under an explicit, single-use, in-turn operator grant for the sole purpose of
> obtaining an artifact to classify. **Production NAVER review export in v1 remains human-driven Action
> Window:** the seller/user clicks the export control and the review-usage consent **on NAVER themselves**;
> SellerOps only **detects, validates, and processes the resulting download**.
> **Do not implement, wire, or present automatic export / automatic consent / automatic download as
> supported v1 behavior**, and do not cite Run B as evidence that it is.

---

## 9. Completion criteria

**v1 is "complete" when** (B6 **RULED 2026-07-20** — the reply bar below is now settled, not provisional):

- **Onboarding+API — bar RULED 2026-07-21 (PO); see B9 in §8.** The 6-step NAVER guided-connection flow
  (§3) is walkable assisted, with order sync landing in the dashboard. The v1 bar is:
  1. the onboarding contract stands **RATIFIED for G3-A/B** (`docs/slices/naver-guided-connection.md` §0,
     2026-07-19) — that ratification **is** the v1 bar;
  2. the **`ConnectNaver` wizard** walks all six §16.10 steps offline-green against synthetic fixtures
     (built 2026-07-19, `f9d069c`);
  3. **steps ①②** ship **tutorial-guided with seller self-attestation** — **no live API-center DOM
     detection is required**;
  4. **steps ③④⑤⑥** run against the **real backend boundary** (Vault `credentials` → `test-connection` →
     `sync` → dashboard), with **0 rows distinguished from failure** and `completed` reachable **only**
     after registration + test + sync all succeed (slice §12 / §17.8 / §17.9);
  5. **Client Secret privacy invariants are test-enforced** (slice §11 / §17.4);
  6. **NOT required for v1:** G3-C.1 (detection replacing attestation), G3-C.2 (live API-center
     calibration), supervised non-secret autofill, and the §14 marketplace-policy clarification — all are
     **post-v1** follow-ups.

  ⚠ **Boundary.** API-center work is **guided tutorial support only**. The **seller manually creates/opens
  the NAVER app and manually copies Client ID / Secret into SellerOps**; **SellerOps never reads Client ID
  or Secret from the API-center page**; there is **no automatic API issuance and no automatic linking**,
  and no click/type/submit on the API center. An assisted **end-to-end walk against a real, freshly issued
  app** is **POST-v1** (it mutates the Vault and the local DB; separate PO approval + fresh single-use G6)
  and **must not be claimed as v1-verified**.

  *(Backend order path already LIVE-VERIFIED once, 2026-06-14 — but on an **already-configured** account,
  so it does not cover first-time issuance. The guided FE overlay is **built**, not outstanding.)*
- **Review export:** LIVE-VERIFIED end-to-end **[met, Run 4]**. B3 `ARTIFACT_INVALID` is **TRIAGED
  [met, 2026-07-20]** — probed under G6-A″/G6-B and **downgraded to a non-reproducing intermittent
  finding** (Run B's artifact was valid) and **ACCEPTED 2026-07-21 (PO)** as a **known, unexplained
  caveat that does NOT block v1 completion**, closed to further live probing. ⚠ "Verified" here means the **human-driven Action Window** path: the seller clicks export
  and consent on NAVER; SellerOps detects/validates/processes the download. Automatic export/consent/
  download is **not** v1 behavior.
- **Review reply — bar RULED 2026-07-20 (PO); see B6 in §8.** **Live guided reply SUBMISSION is NOT required
  for v1 completion.** The v1 guided-reply bar is:
  1. the guided-reply **source of truth** is `sellerops-naver-live-review-match` /
     `feat/naver-guided-reply-session-v1` (RULED 2026-07-20 — §8);
  2. **calibrated target discovery**, **row mapping**, **row identity**, and **composer-open or abort-safe
     hand-off evidence**;
  3. v1 does **NOT** require clicking the final reply **submit** on NAVER.

  ⚠ **Boundary.** SellerOps may **guide / highlight / open the composer** where that is already proven safe;
  the **seller/user remains responsible for the final platform submission in v1**. **Do not present
  automated reply submission as v1-supported behavior.** Actual live reply submission is a **post-v1 gated
  follow-up** requiring separate PO approval and a fresh single-use G6.

  *(Prior state, unchanged and still true: the reply preparation path is OFFLINE-PROVEN and committed,
  backend fingerprint/hint verified (B8). This branch's own read-only row discovery partially lifted B2 but
  its ladder is a superseded dead-letter — the bar above is met on the source-of-truth branch, not here.)*
- **Honesty:** every capability in UI/reports is tagged per Roadmap §4.1; nothing on the deferred list
  (§2) is shown as supported.

**Single remote git integration** happens **only at this completion point** (per the phase workflow rule).

---

## 10. Verification plan

> ### ⚠ Product-boundary check — MANDATORY before any NAVER live run in this plan
>
> Applies to **every** live item below, in addition to the fresh single-use in-turn G3/G6 and the
> seated-and-ready confirmation. Approval to run live is **not** approval to act like the product.
> The dispatch must explicitly answer, **before launch**:
>
> 1. Is this **product-path behavior** or a **one-off diagnostic exception**?
> 2. Will the tool **click export, consent, download, submit, upload, or otherwise mutate platform state**?
> 3. If yes — is that **supported v1 product behavior**?
> 4. If not — label the run a **diagnostic exception**, **state the human-driven product alternative**,
>    and obtain the user's **explicit approval of that exception in the grant**. A generic live grant
>    never covers it.
> 5. **Default production NAVER review export remains human-driven Action Window:** the user clicks
>    export / consent / download **on NAVER**; SellerOps only **detects, validates, and processes the
>    resulting download**.
> 6. **Do not implement, wire, or present automatic export / consent / download as NAVER v1 behavior.**
>
> **B3 Run B is not precedent for product behavior**, and **no further B3 live download probes** are to
> be run (§8).
>
> ### ✅ Onboarding / API-center live governance — RULED 2026-07-21 (PO)
>
> **No live onboarding item is scheduled for v1, and none is required.** Onboarding completes at the
> ratified **G3-A/B** bar (§9, §8-B9); **G3-C.1 and G3-C.2 are NOT v1 gating**.
>
> - **Live API-center observation** (`observe-api-center.ts`) is **diagnostic / tool-calibration evidence
>   only** — never a product path. The G3-C.2 live runs that occurred in this workstream covered
>   **sanitized page-category observation and classifier calibration only**, and prove **nothing** about
>   first-time issuance completion, marketplace-policy permission, credential extraction, or
>   `test-connection`/`sync` success for a freshly issued app.
> - ⚠ **API-center = guided tutorial support only.** **No automatic API issuance or linking**; **SellerOps
>   never reads Client ID / Secret from the page**; no click/type/submit/upload/backend/status mutation
>   during the tutorial. The seller creates/opens the app and copies the values manually.
> - Any further API-center live contact is a **diagnostic exception** needing a fresh, single-use, in-turn
>   **G3 + G6** named in the dispatching turn plus **seated-and-ready** — never a generic live grant.
> - The **assisted end-to-end walk against a real, freshly issued app** is **POST-v1**: it mutates the
>   **Vault and the local DB**, needs its own PO approval + fresh G6, and **must not be claimed as
>   v1-verified**.

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
   evidence to design the row selector (lifts B2). Sanitized output only. **EXECUTED 2026-07-20 (single-use
   G6 consumed) — B2 PARTIALLY LIFTED:** container `ul > li` (selectorKind 2), 18 candidate / 14 body-present
   rows, settle hardening verified live (no timeout / no false-empty); per-row rating/date/fingerprint value
   calibration remains deferred (§8). A value-calibration run is a separate future step. **Its OFFLINE half
   is now designed and wired report-only** (candidate ladder → `ladderCalibration`, 2026-07-20, no live);
   ~~the live pass itself is **not scheduled**~~ — **EXECUTED 2026-07-20 in `--require-sentinel` mode
   (fresh G3/G6 consumed): NEGATIVE RESULT** (201 `ul > li` candidates, 0 `REVIEW_ROW`, `UNCALIBRATED`).
   ⛔ **CLOSED to further B2 ladder live runs in this worktree — the ladder is superseded before adoption
   (§8).** **RULED 2026-07-20 (PO):** the guided-reply row-match answer belongs to the operator-assisted
   calibration stack on `feat/naver-guided-reply-session-v1`, now the **source of truth** for this track.
   No branch integration happens before the final v1 integration.
7. **Export `ARTIFACT_INVALID` classification probe** (B3) — ⚠ **SUPERVISED_ACTION, NOT read-only** (the
   earlier "non-mutating" wording was wrong): it must fire a **real export download** to have an artifact to
   classify. Split into **Run A** (≤1 guarded export click → consent-modal candidate indices; no consent
   click, no download) and **Run B** (approved-index consent click → download → save → `fileFamily` classify
   → delete). Each needs its **own** fresh single-use G6, and from a cold profile **both must run in
   same-session `--require-sentinel` mode** — the operator logs in / reconnects / selects store / reaches the
   review-management list **in the same open window**, then the sentinel is touched (see §8 note). **The
   auto-read form must not be used from a cold profile.** No upload/status/backend on either.
   ✅ **COMPLETE 2026-07-20 — no further B3 live runs.** Run A / Run A′ (auto-read) HALTED at
   `RECONNECT_REQUIRED` with 0 clicks; **Run A″** (sentinel) → 1 export click → `REVIEW_USAGE_CONFIRMATION`,
   candidates `[0,1,2]`, one affirmative = index 2; **Run B** (sentinel, approved index 2) → download →
   **`fileFamily: ooxml_zip_like`, `xlsxReadable: true`** → deleted. **The failure did not reproduce**;
   B3 is downgraded to a non-reproducing intermittent finding (§8) and is **closed to further live
   probing**. ⚠ Run B was a **one-off supervised diagnostic exception**, not v1 product behavior.
8. **Gated live guided reply submission** (B6) — ⛔ **POST-v1, NOT a v1 verification item (RULED 2026-07-20).**
   It is **not** required for v1 completion and must not be scheduled as part of it; it needs its own PO
   approval plus a fresh single-use G6. When it eventually runs: single-use `submissionRef`,
   parks on interruption, terminal `OPERATOR_REPORTED`/`UNVERIFIED`.

---

## Unresolved-point classification (CLAUDE.md assumption rule)

- **[REPO] repository-verifiable:** backend build/test of the uncommitted fingerprint/hint work (B8);
  NAVER API coverage beyond ORDER_SUMMARY (§1.5 — confirmed deferred/absent).
- **[EXT] external-research:** live-DOM ↔ stored-body fingerprint reconciliation (B1); NAVER review-row
  live DOM shape (B2 evidence) — **structural container captured live 2026-07-20 (`ul > li`); per-row
  rating/date value nodes still need calibration.**
- ~~**[PO]** which branch owns v1's guided-reply track.~~ **RULED 2026-07-20 (PO): the source of truth is
  `sellerops-naver-live-review-match` / `feat/naver-guided-reply-session-v1`** (operator-assisted
  calibration, merged PRs #311–#315). This worktree's ladder is a superseded dead-letter experiment; only
  the settle/sentinel hardening is kept as possible utility; no further B2 ladder live runs here; no branch
  integration before the final v1 integration (§8).
- ~~**[PO]** the v1 completion bar for live reply (B6).~~ **RULED 2026-07-20 (PO): live guided reply
  submission is NOT required for v1** — the bar is calibrated target discovery + row mapping + row identity
  + composer-open / abort-safe hand-off evidence, with **no final submit click on NAVER**; the seller
  performs the final platform submission, and live submission is a post-v1 gated follow-up (§8, §9).
- ~~**[PO]** ratifying the DRAFT onboarding contract before FE build (B9).~~ **RULED 2026-07-21 (PO): the
  onboarding contract is RATIFIED for G3-A/B, and that is the v1 bar** — the `ConnectNaver` wizard + the
  offline contract + the secure credential form → `test-connection` → `sync` path are **sufficient for
  v1**. API-center steps ①② are **tutorial-guided with seller self-attestation**; the seller manually
  creates/opens the NAVER app and manually copies Client ID/Secret into SellerOps; **SellerOps never reads
  Client ID/Secret from the API-center page**; **no automatic API issuance or linking**. **G3-C.1 and
  G3-C.2 are NOT v1 gating** — live API-center observation is **diagnostic / tool-calibration evidence
  only** (§8-B9, §9, §10). *(The "before FE build" framing was stale: the wizard was built offline
  2026-07-19, `f9d069c`.)*
- ~~**[PO]** whether to triage or accept the export B3 finding within v1.~~ **RULED 2026-07-21 (PO): B3 is
  ACCEPTED as TRIAGED for NAVER v1 and does NOT block v1 completion.** The original `ARTIFACT_INVALID` is
  **not fully explained**; the fresh Run B diagnostic produced a **valid** artifact (`fileFamily:
  ooxml_zip_like`, `xlsxReadable: true`, `savedExtensionCategory: xlsx`, artifact **deleted** after
  classification, **no upload / backend / status write**), so the original failure is
  **non-reproducing / intermittent**. **No further B3 live download probes.** It stands as a **known,
  accepted caveat**. ⚠ Run B was a **one-off supervised diagnostic exception, NOT v1 product behavior** —
  production review export remains **human-driven Action Window** (the seller clicks export and consent on
  NAVER; SellerOps detects, validates, and processes the resulting download), and automatic
  export/consent/download **must not be presented as v1-supported**.

> **✅ No `[PO]` item remains open for NAVER v1 completion** (guided-reply source of truth · B6 · B9 · B3
> all ruled). Remaining `[REPO]`/`[EXT]` entries above are **evidence notes, not v1 gates**.
- **[PO] POST-v1 — ruled 2026-07-21, not open for v1:** an assisted **end-to-end onboarding walk against a
  real, freshly issued NAVER app**. It would mutate the **Vault and the local DB** (credential store →
  `test-connection` → `sync`), needs **separate PO approval + a fresh single-use G6** when it eventually
  runs, and **must not be claimed as v1-verified**. *(The 2026-06-14 ORDER_SUMMARY live verification used
  an already-configured account and does not cover the first-time-issuance path.)*
