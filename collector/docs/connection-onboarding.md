# SellerOps NAVER Connection Onboarding & Account Binding (design)

> **Design doc — no code in this pass.** This describes the proposed productized
> onboarding flow that sits *on top of* the milestone-1 collector mechanism
> (confirmed in `findings/milestone1.md`: sync `xlsx` export behind a single
> `확인` modal). It defines the connection model, the manual-account-selection
> requirement, profile/session isolation, the account-drift guard, and session
> expiry handling. Implementation is a later, separately approved step.

## Why this exists

Milestone-1 proved a single human-attended profile can reach the export area and
complete a sync download. To productize that, SellerOps needs a durable
**connection** abstraction: a named, status-tracked binding between a SellerOps
account and one NAVER commerce account/store, backed by an isolated browser
profile. The hardest correctness requirement is **not** capturing the export —
it is guaranteeing every future automated export runs against the *same* store the
user intended, and refusing to run when that is not provable.

## Core policy (non-negotiable)

- **Do not automate login.** A human always authenticates.
- **Do not automate 2FA / CAPTCHA.** A human always clears these.
- **Do not automate account/store selection.** If NAVER shows an account / store
  / commerce-ID picker, the **human selects the intended target**. The collector
  never clicks a selection affordance on the user's behalf.
- **Do not store NAVER passwords.** Credentials are entered in the browser only;
  the collector keeps only the resulting browser-profile session on local disk.
- **No sensitive logging.** Never log raw store name, account name, raw URL,
  raw HTML, screenshots, review text, customer data, or any PII. Logging stays
  metadata-only (coarse categories / booleans / hashes), consistent with
  `src/log.ts` and the sanitized probes in `src/naver/export-probe.ts`.

## Onboarding flow

The flow is human-driven; the collector verifies and binds, it never selects.

1. **Initiate.** User clicks **"네이버 스토어 연결"** in SellerOps.
2. **Pending connection.** SellerOps creates a pending `connectionId`
   (status `PENDING_USER_LOGIN`) and records a `userProvidedDisplayName` the user
   types (a label *they* choose — not scraped from NAVER).
3. **Isolated profile.** The collector opens an **isolated browser profile**
   dedicated to this `connectionId` (one profile dir per connection; see
   *Profile / session isolation*). No other connection shares it.
4. **Human login.** The user performs NAVER login, and any 2FA / CAPTCHA,
   **manually** in that browser. The collector waits; it types nothing.
5. **Manual account/store selection.** If NAVER presents an account / store /
   commerce-ID selection screen, the connection moves to
   `PENDING_ACCOUNT_SELECTION` and the **user manually selects** the intended
   target. The collector does **not** auto-click any selection button. It only
   observes whether a selection has resolved.
6. **Verify reachability.** The collector verifies it reached SmartStore Center
   and the review/export area (session check → `LOGGED_IN`, export-area probe
   recognizes the review/export layout). Verification is read-only and sanitized.
7. **Bind.** On successful verification the collector computes a **store
   fingerprint hash** for the currently-selected account/store (see *Binding
   model*) and binds it to the connection: status → `CONNECTED`, set
   `boundStoreFingerprintHash`, `lastVerifiedAt`. The bound profile is now the
   connection's identity for all future runs.
8. **Reuse.** Future runs reuse the same connection-bound profile — no fresh
   login as long as the session is valid.
9. **Expiry.** If the session later expires, status → `NEEDS_REAUTH`; the user
   re-authenticates manually in the same connection's profile. The binding
   (fingerprint hash) is preserved across re-auth.
10. **Drift guard.** If the currently-selected account/store fingerprint differs
    from `boundStoreFingerprintHash`, status → `ACCOUNT_MISMATCH` and **export is
    blocked** until the user re-selects the correct store (or explicitly rebinds).

## Connection binding model

A connection is the durable unit. Suggested fields:

| Field | Meaning |
|-------|---------|
| `connectionId` | Stable id for this SellerOps ↔ NAVER connection. |
| `platform` | Source platform enum (e.g. `naver_smartstore`). |
| `profileName` | Name of the isolated browser-profile dir bound to this connection (path stays inside the collector tree). |
| `connectionStatus` | One of the statuses below. |
| `boundStoreFingerprintHash` | Hash of the selected store/account identity captured at bind time. The drift guard compares against this. Never the raw identity. |
| `fingerprintSourceCategory` | Coarse category of *what* the fingerprint was derived from (e.g. `commerce-id` / `store-url-path` / `account-scope`) — a category label, **not** the raw value. |
| `userProvidedDisplayName` | Human-friendly label the **user** typed for this connection. Not scraped from NAVER. |
| `createdAt` | Connection creation timestamp. |
| `lastVerifiedAt` | Last successful session + reachability verification. |
| `lastExportAttemptAt` | Last time an export run was attempted. |
| `lastExportResult` | Sanitized result of the last export (e.g. `EXPORT_READY` / `EXPORT_FAILED` / outcome enum). |
| `reauthRequiredReason` | Coarse reason category when status is `NEEDS_REAUTH` (e.g. `session-expired` / `auth-challenge`) — category only. |

### Store fingerprint (privacy-preserving)

- The fingerprint is a **hash** (e.g. SHA-256) of a stable identity token for the
  selected store/account, derived from session-scoped signals (the commerce-id /
  store path category named by `fingerprintSourceCategory`).
- Only the **hash** and the **source category** are stored. The raw store name,
  raw URL, raw commerce id, and any PII are never persisted or logged.
- The hash exists solely to answer one question deterministically: *is the store
  selected right now the same one we bound?* It is not reversible to identity.

## Profile / session isolation

- **One isolated browser profile per `connectionId`.** Connections never share a
  profile, so one store's session can never bleed into another's runs.
- Profiles live **only** inside the collector tree (the existing path guard in
  `src/profile.ts` refuses any profile dir resolving outside it). The session
  lives only on local disk and is never serialized or transmitted.
- No NAVER password or server-side cookie is exported; only the local
  persistent-context profile dir holds the session, and it stays gitignored
  (`.profile/`).

## Account-drift guard (pre-export, every run)

Before every export, the collector runs an ordered guard. Any failing check
**blocks export** — the collector never "guesses" its way to a capture:

1. **Verify session.** Session check must be `LOGGED_IN`.
   - `LOGGED_OUT` → `NEEDS_REAUTH` (`reauthRequiredReason = session-expired`).
   - `AUTH_CHALLENGE` (2FA/CAPTCHA) → `NEEDS_REAUTH`
     (`reauthRequiredReason = auth-challenge`); human must act.
2. **Verify current account/store fingerprint.**
   - **Fingerprint missing / not resolvable → do NOT export.** Block; surface that
     the store could not be identified (no fabricated identity, no default store).
   - **Fingerprint differs from `boundStoreFingerprintHash` → `ACCOUNT_MISMATCH`,
     do NOT export.** Require the user to re-select the intended store or rebind.
   - Fingerprint matches → proceed.
3. **Verify review/export page reachable.**
   - Unreachable due to session loss → `NEEDS_REAUTH`.
   - Unreachable due to layout drift / classification failure / download failure
     → `EXPORT_FAILED` (with the existing collector outcome — e.g.
     `EXPORT_LAYOUT_CHANGED` / `DOWNLOAD_FAILED` — carried in `lastExportResult`).
4. **All checks pass → `EXPORT_READY`**, and the export may run (manual `확인`
   confirm semantics from milestone-1 apply; auto-confirm limited to `확인`).

The guiding rule: **identity must be positively proven before any export.** A
missing or mismatched fingerprint is a hard block, not a warning.

## Connection statuses

These are the connection-level statuses surfaced to the SellerOps user. They sit
above the collector's run-level `CollectorState` (`src/status.ts`); the mapping
notes show how a run outcome updates the connection.

| Status | Meaning | Typical source |
|--------|---------|----------------|
| `PENDING_USER_LOGIN` | Connection created; waiting for the human to log in. | onboarding step 2–4 |
| `PENDING_ACCOUNT_SELECTION` | NAVER showed an account/store picker; waiting for the **human** to select. | onboarding step 5 |
| `CONNECTED` | Logged in, store verified, fingerprint bound. | onboarding step 7 |
| `NEEDS_REAUTH` | Session expired or an auth challenge appeared; human must re-authenticate. | maps from `SESSION_EXPIRED` / `ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA` |
| `ACCOUNT_MISMATCH` | Selected store differs from the bound fingerprint; export blocked. | drift guard step 2 |
| `EXPORT_READY` | All pre-export checks passed; export may run. | drift guard step 4 |
| `EXPORT_FAILED` | Export attempted but layout/download failed (not an auth issue). | maps from `EXPORT_LAYOUT_CHANGED` / `DOWNLOAD_FAILED` / `EXPORT_ASYNC_JOB_DETECTED` |

### Status ↔ CollectorState mapping (proposed)

- `LOGGED_OUT` → `NEEDS_REAUTH` (`session-expired`)
- `AUTH_CHALLENGE` → `NEEDS_REAUTH` (`auth-challenge`)
- fingerprint missing / mismatch → `ACCOUNT_MISMATCH` (export not attempted)
- export `LAYOUT_UNRECOGNIZED` / `DOWNLOAD_FAILED` / `ASYNC_JOB_DETECTED`
  → `EXPORT_FAILED`
- export captured (synthetic-validated upload path, later milestone) → connection
  records `lastExportResult` and returns to `CONNECTED` / `EXPORT_READY`

## Local collector vs. future managed collector

- **Local collector (current direction).** The browser profile and session live
  on the **user's own machine**, inside the collector tree. The user
  authenticates locally; nothing leaves the device except, in a later milestone,
  the captured export file uploaded to SellerOps. This is the
  privacy-strongest path and the one milestone-1 validated.
- **Future managed collector (not in scope).** A hosted variant would run the
  browser profile server-side. That raises distinct problems deliberately **out
  of scope here**: secure custody of a live authenticated session, isolation
  between tenants' profiles, and a higher bar for NAVER ToS / anti-automation
  posture. The connection model above is intentionally transport-agnostic
  (`connectionId` + fingerprint binding hold in both), so a managed path could
  reuse it later — but it must not be built without its own dedicated design and
  approval.

## Implementation status

The pure, offline connection foundation for this model lives in
`src/connection/`: `types.ts` (platform / status / `CollectorConnection` /
fingerprint + reachability signal types), `connection.ts`
(`profileNameForConnection`, `createPendingConnection`,
`bindConnectionToFingerprint`, `markNeedsReauth`, `markAccountMismatch`, and the
one-way `fingerprintHash`), `guard.ts` (`evaluateExportGuard`, the pre-export
drift guard), `apply.ts` (`applyGuardDecision` / `recordExportAttempt`, folding a
guard decision onto a connection), and `record.ts` (`toConnectionRecord` /
`parseConnectionRecord` / `roundTripConnectionRecord`, JSON-safe serialization
with allow-list validation and sanitized error categories), `workflow.ts`
(`markPendingAccountSelection` / `completeManualAccountSelection` /
`prepareExportAttempt`, the human-driven onboarding + export pre-flight steps),
and `registry.ts` (`createConnectionRegistry` + `registryFromRecords`, a minimal
in-memory keyed store). Local persistence is introduced in `store.ts`
(`loadConnectionRegistryFromFile` / `saveConnectionRegistryToFile` with atomic
temp-then-rename writes and sanitized `ConnectionStoreError` categories) — the
ONLY module here that touches the filesystem; all others remain fs-free. The
store path (`.connections/connections.json`, default via
`defaultConnectionStorePath`) is gitignored; runtime records are local-only and
contain only connection records (fingerprint hash + source category + user
alias) — never raw NAVER identity. `status-bridge.ts`
(`connectionStatusToCollectorState` / `connectionStatusDetail` /
`connectionToStatusSnapshot`) maps a connection's status to the closest existing
run-level `CollectorState` and builds a sanitized `StatusRecord` payload (no
identity, hash, connectionId, or profile name; never `LAST_SUCCESS`) — purely, so
connection health can be surfaced without a browser; it does not write `.status/`.
Wiring this into the live CLI is a later, separately-approved step.

## Out of scope for this design pass

- No live wiring, schema migration, or CLI surface in this pass.
- No scheduler / recurring collection (still paused).
- No async-job download follow-through (export is confirmed sync).
- No real export ingestion — the upload/parse path is validated separately with a
  **synthetic** NAVER-shaped `.xlsx`, never the real captured file.
