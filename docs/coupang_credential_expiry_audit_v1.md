# Coupang Credential Expiry + Guided Renewal — Audit & Policy Basis v1

> The gating audit for the Coupang Credential Expiry + Guided Renewal feature. Establishes the policy
> context, audits the existing credential/account/alert model, and records the **migration decision**.
> Branch `feat/coupang-credential-expiry-guided-renewal-v1`. **Offline/synthetic only — no live WING.**

## 1. Policy basis (context)

Coupang WING Open API keys carry a **validity period ("유효기간")** — the operating assumption for this
feature is a **180-day** key lifetime, after which the key must be re-issued in WING. This figure is the
**context**, not the source of truth SellerOps stores: because a hardcoded "issued + 180 days" is only an
estimate, SellerOps stores the **exact expiry date read from WING's `유효기간` field (safe allowlist) or
confirmed by the operator** — never a computed estimate (see §4). The 180-day figure should be
re-verified against Coupang's official WING Open API documentation before any live reliance; SellerOps'
correctness does not depend on it, since it reads the real date.

## 2. Existing model audit

### Credential (`connector_credentials`, `CredentialVault`)
- **`token_expires_at` (`Instant`, nullable)** — already present; `CredentialVault.store(...)` accepts and
  persists it, and the intake path already forwards `request.tokenExpiresAt()`
  (`CollectControlService:320-321`). ⇒ the WING-read/operator-confirmed exact expiry can be stored today.
- **`last_rotated_at` (`Instant`)** — stamped on every `store(...)` upsert and `rotateSecrets(...)`. ⇒
  rotation/renewal timing is already tracked.
- **`vault.store(...)` is an atomic in-place upsert** (one row per account, single `save`). ⇒ credential
  replacement is atomic; rollback is an application-level capture-old → store-new → test → restore-on-fail
  (no schema needed).
- Masked reads (`CredentialMetadata`) already expose `tokenExpiresAt` + `lastRotatedAt` + `hasRefreshToken`
  — never a secret.

### Seller account (`SellerAccount`, `ChannelStatus`)
- `connectionStatus` is the two-signal lifecycle (`PENDING → PREPARING → CONNECTED`) plus
  `RECONNECT_REQUIRED` — the last already models "credential needs attention", which the expired/auth-failure
  case maps onto. Expiry-approaching states are **computed**, not stored.
- Connection health (`ConnectionStatusView`) carries `consecutiveFailures` + `lastError` — the auth-failure
  signal for the "expired" determination.

### Alerts (`connector_alerts`, `ConnectorAlertService`)
- Free-string **`type`** + **`acknowledged_at`**; the repository already enforces **"at most one
  unacknowledged alert of a type per seller account"** (dedup) with idempotent acknowledgement and
  open-first ordering. ⇒ expiry-warning alerts are new `type` values on the existing model.

### Scheduler
- Per-account schedule (`PUT .../schedule {enabled}`) — pause = disable, resume = enable (renewal step 11).

## 3. Migration decision — **NO MIGRATION REQUIRED**

Every data need is met by existing columns + computed state:

| need | mechanism | new schema? |
| --- | --- | --- |
| store exact expiry | `connector_credentials.token_expires_at` | no |
| unknown vs confirmed expiry | `null` = unknown; set = confirmed (never an estimate) | no |
| rotation/renewal timing | `connector_credentials.last_rotated_at` | no |
| atomic replacement + rollback | `vault.store` upsert + app-level restore-on-fail | no |
| D-30/D-14/D-7/D-1/expired | computed from `token_expires_at` vs now | no |
| "expired" = expiry passed AND auth failure | `token_expires_at` + `consecutiveFailures`/test result | no |
| expiry warning alerts | `connector_alerts.type` (new values) + existing dedup/ack | no |
| needs-attention account state | computed; `RECONNECT_REQUIRED` for auth failure | no |
| scheduler pause/resume | existing per-account schedule enable flag | no |

Because no migration is needed, per the standing rule (report + request separate approval *only if* a
migration is required) this feature proceeds without a schema-change approval. If implementation surfaces
an unavoidable schema need, work STOPS and this decision is revised with an impact + versioning plan for
separate approval.

## 4. Safe-read boundary (WING `유효기간`)

The guided connection/renewal may read **only** WING's `유효기간` label + its date via a **safe allowlist**
— a deliberate, narrow exception to the "read no values" rule. **Access Key / Secret Key / 업체코드 values
are still never read.** If the exact date cannot be read from WING, SellerOps stores **nothing** (no
estimate) and offers an **operator-confirmation** path for the date. Live WING reading is out of scope this
unit (synthetic fixtures + offline E2E only); the allowlist reader + its source-guard are built and tested
offline here.
