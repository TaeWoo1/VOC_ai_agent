# Coupang Credential Expiry + Guided Renewal v1

> **Status:** Implemented (cross-stack), **offline-synthetic-verified**. No live WING; **no database
> migration** (audit: [`coupang_credential_expiry_audit_v1.md`](./coupang_credential_expiry_audit_v1.md)).
> Branch `feat/coupang-credential-expiry-guided-renewal-v1`.

SellerOps now recognizes the Coupang WING Open API key's validity period, warns before expiry, and guides
the seller through a WING renewal that safely replaces the credential — keeping the account, collected
orders, and cursors intact.

## No migration

Every data need is met by existing columns + computed state (see the audit): `connector_credentials`
`token_expires_at` (exact expiry; `null` = unknown, **never an estimate**) + `last_rotated_at`, the
`vault.store` atomic upsert, `connector_alerts` (`type` + `acknowledged_at` + existing one-unacked-per-type
dedup), and computed D-30/D-14/D-7/D-1/expired states. **No schema change.**

## Backend

- **Pure expiry status** (`CoupangCredentialExpiryStatus.compute(expiresAt, now, authFailing)`): states
  `UNKNOWN | OK | WARN_30 | WARN_14 | WARN_7 | WARN_1 | DATE_PASSED | EXPIRED`, with `daysRemaining` +
  `renewRecommended` (from WARN_14). **`EXPIRED` requires the date to have passed AND an auth failure**;
  date-passed with auth still OK is the softer `DATE_PASSED`; a 401/auth failure *alone* is never "expired".
  `now` is a parameter (no wall-clock inside). Exposed as `ConnectionStatusView.credentialExpiry`.
- **Expiry alerts** on the existing `ConnectorAlertService` (reusing dedup + idempotent ack):
  `COUPANG_CREDENTIAL_EXPIRING` (warn, when `renewRecommended`) and `COUPANG_CREDENTIAL_EXPIRED` (critical).
  Evaluated on the connection-status read path (no scheduler); escalation is shown by the status, not a new
  alert per bucket.
- **Atomic renewal replacement with rollback** — `POST /api/seller-accounts/{id}/credentials/replace`:
  capture the old credential in memory → `vault.store` the new secrets + new `tokenExpiresAt` (atomic
  upsert) → verify (connection test + ordersheets access) → **SUCCESS** keeps `channel_orders` /
  `sync_cursors` / the account untouched and resumes a system-paused schedule; **FAILURE** restores the
  captured old credential so the existing one is **never destroyed**. Returns a safe result only (no secret,
  no provider body).
- **Operator-confirm expiry** — `POST /api/seller-accounts/{id}/credentials/expiry` (+ `vault.setTokenExpiresAt`):
  updates ONLY the stored expiry (no secret material, no re-encryption; the credential intake rejects
  secret-less updates by design, so this is a dedicated path). Never an estimate; `null` clears it. Org-scoped,
  fails closed.

## Collector (offline/synthetic)

- **Safe `유효기간` allowlist reader** (`wing-validity-reader.ts`): reads **only** the date adjacent to the
  fixed `유효기간` label; the output is structurally `YYYY-MM-DD` or `null`, so a key / hex / base64 token can
  never leave the page, and a key/vendor row is never inspected. A source-guard forbids any key label/value
  read, and a behavioral test feeds key-shaped tokens (all → `null`). `WING_SAFE_READ_ALLOWLIST` documents
  that the `유효기간` date is the ONLY value ever read.
- **Renewal walkthrough** (`coupang-renewal/*`, mirroring the issuance runtime): a 5-step linear walk — reach
  the open-API page → check `유효기간` → **`재발급` human checkpoint** (highlight only, arm no observer, agent
  never clicks 재발급, advance on operator 다음) → copy the new keys (highlight region, read no value) →
  return. Recoverable parks; the 16-hex targetRef gate + sanitization hold. Copy keys
  `actionWindow.coupangRenewal.{run,reachOpenApi,checkExpiry,reissueCheckpoint,copyKeys,return}` (match the FE).
  The live driver's new WING labels (`유효기간`/`재발급`) are `LIVE_DOM_CALIBRATION_PENDING`; the live driver/CLI
  are gated + never run.

## Frontend

- **Expiry display** on the completion screen (`CoupangExpiryPanel`): the date + day-count, or — when
  `UNKNOWN` — an **operator-confirm date input** wired to the dedicated expiry endpoint (stored exactly, never
  estimated). From `WARN_14` (`renewRecommended`) a **"WING에서 API 키 갱신하기"** CTA.
- **Operational surfaces**: channel list + Operations show "만료 예정·조치 필요" for `WARN_*`/`DATE_PASSED`/
  `EXPIRED`; the two new alert types render + ack in Alerts.
- **Guided renewal** (`ConnectCoupangRenewal` → `CoupangRenewalFlow`): the renewal walkthrough (agent-hosted,
  reusing the shared Action Window surfaces — controls only from `allowedCommands`, RECHECK = intent only) →
  a masked **replace** screen (`SecureCredentialForm` → the replace endpoint) → done, keeping the existing
  account/orders. Agent-unavailable → a manual renewal text path (`classifyAgentEnv`/`AgentEnvNotice` + the
  renewal-worded checklist). Secrets flow form → endpoint only.

## Safety

No auto re-issue / delete / reset of a key; the Secret Key value is never read (DOM/clipboard/log) on any
stack; on replacement failure the old credential is kept (rollback); **no live WING write/renewal this unit**
(synthetic fixtures + offline E2E only); secret-access source-guards on the collector reader + renewal
runtime; **no migration**; the shared contract is unchanged.

## Verification

- Backend: `test` BUILD SUCCESSFUL across `collect`/`credential`/`connector`; pure expiry rules + alert
  dedup/ack + replace SUCCESS/rollback + `setTokenExpiresAt` (secrets untouched, fail-closed) covered.
- Collector: `tsc` + full suite **6975** green (+ renewal + validity-reader + source-guards).
- Frontend: `tsc` + full suite **1868** green (expiry states → labels, operator-confirm, channel-list/CTA,
  guided-renewal flow, manual fallback, alert ack, axe a11y).
- No migration; contract untouched; NAVER + existing Coupang issuance behavior preserved.

## Deferred (future units)

Live WING renewal (calibrating the `유효기간`/`재발급` selectors + a live guided renewal proof) — the live
driver/CLI are gated scaffolds, never run here.
