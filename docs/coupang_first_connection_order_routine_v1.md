# Coupang First-Connection + Order Routine v1

> Capability + official-basis record for the first Coupang vertical slice: first connection →
> order acquisition (initial + routine) → normalization → Operations display. **Offline slice**
> (no live Coupang call this unit). Sanitized: no secret, key, vendor id, IP, order, or PII appears here.

## What shipped (backend, behind `sellerops.connector.coupang.enabled`)

- **Real `CoupangApiConnector`** — advertises `ORDER_SUMMARY` (`CONFIRMED`); `REVIEW`/`INQUIRY`/
  `PRODUCT`/`SALES` unsupported (REVIEW has no official Coupang API — surfaced as an
  `unsupportedScope`). Implements `ConnectionVerifier`.
- **`CoupangOrdersClient`** — the official v5 `ordersheets` "PO list, paging by day" flow: a
  full-window sweep of every required `status`, following `nextToken` to the end, mapped to
  `CanonicalOrder` (per shipment box) + `CanonicalOrderSummary` (per KST day).
- **`CoupangOrdersCursor`** — a rolling KST date window (initial backfill → routine overlap →
  scheduler-gap recovery), clamped to Coupang's official **31-day** cap.
- **`CoupangSigner`** (pre-existing) — the CEA HMAC-SHA256 signature, officially verified.
- **`CoupangRateLimitedException`** — 429 → rate-limited page, cursor unchanged.
- **Setup contract** — `GET /api/connect/coupang/setup` → `{advertisedEgressIps}` (the deployment
  egress IP to allowlist; empty ⇒ "not yet advertised", never fabricated).
- **Two-signal lifecycle** — `CoupangConnectionLifecycle`: test → PREPARING, first collected sync →
  CONNECTED (neither alone connects); rejection → RECONNECT_REQUIRED. Wired into `testConnection`
  and `SyncRunExecutor` alongside NAVER's, each guarded to its own channel.
- **Reused, not re-implemented** (channel-agnostic): `SyncRunGate` (single-flight + stale-run
  recovery), `SyncRunExecutor`/`SyncScheduler` (initial + routine), `ChannelOrderIngestionService`
  (idempotent dedup by `shipmentBoxId`), `CredentialVault` (AES-GCM envelope), `OrderService` /
  `/api/orders/summary` + the FE order display (channel-generic).
- **No collector work** — Coupang order sync is backend-only; the collector keeps COUPANG `SKIPPED`.
- **No migration** — reuses `channel_orders` (V32); Flyway top unchanged (V36).

## What shipped (frontend)

- **`GET /api/connect/coupang/setup` consumption** — `apiClient.getCoupangSetup()` + `CoupangSetupView`
  (mirrors the NAVER setup contract).
- **`ConnectCoupang` page (`/connect/coupang`)** — reached from the channel list when a Coupang channel
  has no account (`connect-coupang` intent). Shows the official **prerequisites** (issue the WING Open
  API key = access/secret/vendor; confirm order-API access; register the deployment calling IP via the
  reused `AdvertisedCallIpPanel`), then hosts credential entry + the connection test (reusing
  `SecureCredentialForm` → `createApiChannelAccount` → `storeCredential` → `testConnection`).
- **Honest by construction** — a page load is 0-write (the account is created lazily only on an explicit
  submit); the secret flows straight to the Vault, never into storage/logs/events; the advertised IP is
  never fabricated (empty ⇒ "not yet advertised"); a passing test verifies the credential but does **not**
  claim a completed connection (the first collected order sync completes the two-signal path).
- **Order display** — already channel-generic (`/api/orders/summary`); Coupang orders surface with no FE
  order-display work once ingested.

## Official API basis (developers.coupang.com — no endpoint/error guessed)

| Concern | Official fact | Source |
|---|---|---|
| Auth | CEA `HmacSHA256`; message = `signed-date + method + path + query`; `signed-date` = `yyMMdd'T'HHmmss'Z'` (UTC, ≤5 min); `X-Requested-By: {vendorId}` | Creating HMAC Signature |
| Orders | `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`; `createdAtFrom/To` KST dates ≤31d; **`status` required** (ACCEPT/INSTRUCT/DEPARTURE/DELIVERING/FINAL_DELIVERY/NONE_TRACKING); `maxPerPage`≤50; `nextToken` paging | PO list query (paging by day) |
| Amount | `orderItems[].orderPrice` = `salesPrice`×`shippingCount` ("price to be paid") | "salesPrice/orderPrice/discountPrice" article |
| Identity | `shipmentBoxId` = per-bundle line (dedup id); `orderId` = order grouping | Single PO query |
| IP | `403 "[FORBIDDEN] Not allowed IP…"`; register calling IP (≤30-min propagation) | 403 Not allowed IP |
| Rate limit | `429` when >5 calls/s per vendorId; recover in minutes (no Retry-After documented) | Rate-limit policy |

## Credential vs order-access separation (completion criterion)

Coupang has no OAuth token step, so the split uses two distinct signed calls:
- **Credential/environment check** — a low-privilege `returnShippingCenters` GET. `200`→OK, `401`→
  INVALID_CREDENTIAL, `403 "Not allowed IP"`→CALL_ENVIRONMENT_MISMATCH, other 403→inconclusive
  (proceed), `429`→temporary, 5xx/net→unavailable.
- **Order-access probe** — a read-only `ordersheets` GET over a narrow window. `200`→CONFIRMED,
  `403 IP`→CALL_IP_DENIED, other `403`→hedged ORDER_ACCESS_DENIED (never guessed into a code),
  `429`/5xx/other→inconclusive (never blocks a proven credential).

Because 401 (bad signature) and the fixed "Not allowed IP" 403 are distinct, a bad credential is
never misreported as an IP problem or vice versa — the misdiagnosis lesson from NAVER.

## Honest bounds (documented, not silent)

- **Offline only** — no live Coupang call this unit. A read-only live proof needs a real credential
  + the deployment egress IP registered in the seller's Coupang app, under a separate fresh approval.
- **Routine window** — status changes for orders older than the routine look-back are not re-swept
  (documented bound, not a gap); the daily summary for any swept day is complete.
- **Cancel/return** — Coupang's separate Return API is out of v1 scope.
- **Account-scoped guided-capability screen** — the NAVER-style per-account capability *wizard* view
  (`/api/seller-accounts/{id}/connection-capability`) is NAVER-only; a Coupang analog is a documented
  follow-up. The `ConnectCoupang` page delivers the first-connection prerequisites + credential + test;
  the connector `capabilities()` + setup + channel capability overview deliver "connector capability".
- **Amount** — `orderPrice` (gross "price to be paid"); `discountPrice`/claim-net refinement deferred.

## Verification

- Backend `compileJava` + `compileTestJava` clean; Coupang connector + wiring tests green
  (`CoupangApiConnectorTest`, `CoupangSignerTest`, `CoupangConnectorConfigurationTest`,
  `CollectControlService*`, `SyncRunExecutor*`, `CollectControlServiceNaverVerifierTest`).
- Supplementary tests: `CoupangOrdersCursorTest`, `CoupangSetupControllerTest`,
  `CoupangRateLimitedExceptionTest`, `CoupangConnectionLifecycleTest`.
- **Full backend suite green** (`--no-daemon`).
- **Frontend**: typecheck clean, full suite green (**1726** tests), `vite build` OK. New FE tests:
  `channelConnection` (COUPANG→`connect-coupang` intent) + `ConnectCoupang` page (prerequisites +
  advertised-IP present/absent, lazy create→store→test success, safe failure message).
