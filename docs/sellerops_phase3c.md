# SellerOps AI — Phase 3C Planning & Preflight: First Real Official-API Connector

**Mode:** Docs-only planning step (this document is the deliverable). No
connector code is implemented here. No backend source, frontend, or Python
review-ops changes. No browser automation, no scraping, no external API calls
from application runtime, no DB migrations, no OpenAI/RAG, no notification
delivery. Nothing is committed until separately approved.

Date: 2026-06-12. Planned at HEAD `3b30108`, branch `feature/review-ops-industrial`.

---

## 1. Context: Phase 3B completed and verified

Phase 3B (verified at HEAD `3b30108`, report: `docs/sellerops_phase3b_completion.md`)
proved the scheduled-collection backbone end-to-end on `MockApiConnector`:
schedule → poller claim (`FOR UPDATE SKIP LOCKED`) → `SyncRunExecutor` →
ingestion → cursor → health → control API → frontend collection panel, plus a
working AES-256-GCM `CredentialVault` (write-only intake, masked reads,
`open()` not yet called by anything). Phase 3C replaces the mock with the
**first real official-API connector** behind a feature flag.

Preflight confirmed at planning time: clean tree, HEAD `3b30108`, no
frontend/backend/Python changes. Architecture re-read:

- `PullConnector.fetch(FetchRequest) → FetchPage`; `FetchPage.rateLimited(...)`
  carries `retryAfterSeconds` (`backend/src/main/java/com/sellerops/connector/`).
- `ConnectorRegistry.resolvePullConnector` currently returns the **first** pull
  connector bean (`ConnectorRegistry.java:44-50`) — must become channel-aware
  in Slice 1.
- `CredentialVault.open(orgId, sellerAccountId)` exists and is fail-closed.
- `SyncRunExecutor` routes only REVIEW/INQUIRY/ORDER_SUMMARY into ingestion —
  ORDER_SUMMARY is the only data type already end-to-end real.
- Capability seed (`V3__scheduled_collection.sql:114-131`) holds the verified
  Coupang/Naver matrix used below.

## 2. Connector recommendation

**Naver Commerce API first; Coupang WING Open API second (and live-smoke
fallback).**

## 3. Naver vs Coupang comparison

From the official-doc verification captured in `docs/sellerops_phase3b.md`
§3/§5 and the capability seed (no new browsing needed):

| Criterion | Naver Commerce API | Coupang WING Open API |
|---|---|---|
| Auth | OAuth2 client-credentials style: client id/secret → bcrypt-signed timestamp → short-lived access token | HMAC per-request signature (access key + secret key over method+path+timestamp, `X-Requested-By` vendorId) |
| Auth complexity | Token client + caching/expiry — **exercises the vault's full lifecycle** (`token_expires_at`, mint-on-demand) which 3C must prove anyway | Simpler per-request signing, no token lifecycle — proves less of the vault |
| Credential shape | `{client_id, client_secret}`, auth_type `OAUTH2` | `{access_key, secret_key, vendor_id}`, auth_type `HMAC` |
| Rate limit | ≈2 rps token bucket, `GNCP-GW-RateLimit-Remaining` header, 429 on exceed — maps directly onto `FetchPage.rateLimited` | ≈5 rps per vendorId, 429, recovery in minutes |
| First endpoint | `pay-order/seller` orders query — **CONFIRMED**; maps to `CanonicalOrderSummary` | Ordersheet query — CONFIRMED, but response→daily-summary mapping is less direct |
| DataType coverage (seed) | ORDER_SUMMARY/PRODUCT/SALES **CONFIRMED**; INQUIRY NEEDS_VERIFICATION; REVIEW UNSUPPORTED | ORDER_SUMMARY/PRODUCT CONFIRMED; SALES/INQUIRY NEEDS_VERIFICATION; REVIEW UNSUPPORTED |
| Dev setup friction | Commerce API Center app registration; **possible call-IP allowlist** | Seller WING account + key issuance; **no sandbox** — testing is against production |
| Sandbox | Unclear/unverified — assume none | Confirmed none |

**Why Naver first:** broadest CONFIRMED coverage, the auth model that exercises
the vault the way the rest of 3C needs, a published rate-limit shape that maps
1:1 onto the existing throttle signal, and a first endpoint (ORDER_SUMMARY)
already end-to-end through ingestion.

**Fallback condition:** Slice 1 is entirely offline-testable (fake HTTP), so
setup friction blocks only the *live smoke*, not the slice. If Naver app
registration or the IP allowlist blocks obtaining working credentials within
the verification window, switch the live-smoke target to **Coupang HMAC** (the
signer is fully verifiable offline, no token round-trip); Naver code stays
behind its flag with the smoke recorded as "blocked: <reason>" — never faked.

## 4. Manual setup blockers (operator preflight, outside the repo)

1. Naver Commerce API Center 가입 + application registration with a real seller
   account → client id/secret issuance path.
2. **Call-IP allowlist**: does token issuance/API access restrict caller IP;
   can a dev machine IP be registered?
3. Exact electronic-signature format (bcrypt over `client_id + "_" + timestamp`
   with `client_secret` as salt, base64) — verify against official docs before
   coding the signer.
4. Exact orders endpoint: request params, pagination shape, max queryable date
   range per call (commonly bounded, e.g. 24h windows).
5. Per-endpoint rate limits (the ≈2 rps figure is account-level).
6. Sandbox existence (assume none; live smoke needs a seller-owned account with
   throwaway credentials, separately authorized).

## 5. Phase 3C Slice 1 scope (implementation slice — separate approval)

New package `com.sellerops.connector.naver`, everything behind
`sellerops.connector.naver.enabled=false`:

1. **`NaverApiConnector implements PullConnector`** — serves channel `NAVER`
   only; Slice 1 capabilities advertise **ORDER_SUMMARY only**.
2. **`ConnectorRegistry` channel-aware resolution** — a connector that
   explicitly serves a channel wins over the mock for that channel; mock keeps
   serving all other channels; flag off ⇒ resolution unchanged (regression-tested).
3. **`NaverTokenClient` isolated + unit-tested** — signature generation
   (injected `Clock`), token exchange, in-memory cache until expiry−skew. HTTP
   behind an injectable interface; unit tests use fakes.
4. **Credential read through `CredentialVault.open` only**, at fetch time,
   in-memory only (first real caller of `open`). Missing credential / closed
   vault ⇒ fail-closed config failure, **zero outbound calls attempted**.
5. **One safe official endpoint only**: orders query → `CanonicalOrderSummary`,
   date-range cursor as the existing opaque `cursorValue`; 429/remaining-header
   ⇒ `FetchPage.rateLimited(...)` (existing backoff/alert machinery unchanged).
6. **No scheduler integration by default; no automatic polling by default** —
   see §9.

## 6. Explicit non-goals (Slice 1)

- PRODUCT/SALES fetch or routing; INQUIRY (only after NEEDS_VERIFICATION
  resolved); REVIEW (see §10).
- Coupang connector (Slice 2+ candidate).
- Credential intake UI; KMS; OAuth refresh beyond access-token minting.
- Scheduler changes; DB migrations (V3 columns + `OAUTH2` auth_type already fit).
- Frontend changes; browser automation; scraping; OpenAI/RAG; notification
  delivery.
- Live API smoke — requires separate explicit authorization with
  operator-supplied throwaway credentials.

## 7. Required env/config keys (names only — no real values in repo)

| Key | Default | Purpose |
|---|---|---|
| `sellerops.connector.naver.enabled` | `false` | Feature flag; bean absent when false |
| `sellerops.connector.naver.base-url` | official API host | Overridable to point tests at a fake/local server |
| `sellerops.connector.naver.rate-limit-rps` | `2` | Config-seeded limit (3B rule: never a global constant) |
| `SELLEROPS_VAULT_MASTER_KEY` | (existing, empty) | Vault master key — already wired |
| `sellerops.vault.key-id` | (existing, `local-dev-1`) | already wired |

Seller credentials (`client_id`/`client_secret`) are **not** env/config — they
enter through the existing credential intake API into the vault, per seller
account.

## 8. Offline test plan (no external call in any unit test)

- **Signer/token**: deterministic signature with fixed `Clock`; token cached
  until expiry−skew; expired token re-minted; malformed token response ⇒
  Korean-message failure containing no secret material.
- **Credential fail-closed**: no stored credential ⇒ config FAILED with the
  fake HTTP layer asserting **zero requests**; vault without master key ⇒ same.
- **Rate limit**: fake HTTP 429 (+ Retry-After/remaining header) ⇒
  `FetchPage.rateLimited` with `retryAfterSeconds`; cursor unchanged.
- **Unsupported data type**: REVIEW/INQUIRY/PRODUCT/SALES on NAVER ⇒
  `UnsupportedDataTypeException`; `capabilities()` agrees with `fetch()`.
- **FetchPage contract**: fixture JSON (official-doc example shape) ⇒
  `CanonicalOrderSummary` records, cursor advances, `hasMore` correct on last
  page — same contract the mock already satisfies.
- **Registry regression**: flag off ⇒ NAVER resolves to `MockApiConnector`
  exactly as today; flag on ⇒ NAVER→Naver connector, every other channel mock.
- **No-network guard**: HTTP client injected via interface; test wiring
  fake-only; no test touches the real base URL.

## 9. Feature-flag / default-off policy

- `sellerops.connector.naver.enabled=false` default — flag off ⇒ bean absent ⇒
  runtime behavior byte-identical to Phase 3B.
- `sellerops.collect.scheduler-enabled=false` stays the default — no automatic
  polling unless ops deliberately flips both flags.
- No external call is reachable in tests or in the default runtime
  configuration; the only paths to a real request are flag-on + (manual sync or
  scheduler-on), each a deliberate operator act.

## 10. Unsupported review API policy

REVIEW remains **UNSUPPORTED** on both Coupang and Naver per the verified
capability seed (Naver's maintainer statement 2024-08-30: no review API, none
planned near-term). Reviews stay capability-gated in the UI and rejected at the
schedule API. The sanctioned fallback order is unchanged: official API →
official export → email/report attachment → manual file upload; browser
automation remains last-resort-only and is not part of Phase 3C.

## 11. Exact implementation prompt for the next coding slice

```
Start Phase 3C Slice 1 implementation only. Do not start Slice 2.

Current HEAD: <hash after the phase3c planning doc commit>

Goal: First real connector skeleton — NaverApiConnector behind a feature flag,
with an isolated, unit-tested token/signature client and exactly one official
endpoint (ORDER_SUMMARY). All tests offline; no external call in any test or
default runtime path.

Do not implement: PRODUCT/SALES/INQUIRY/REVIEW fetch, Coupang, scheduler
changes, automatic polling defaults, credential intake UI, KMS/OAuth-refresh
beyond access-token minting, browser automation, scraping, OpenAI/RAG,
notification delivery, frontend changes, DB migrations.

Before coding:
1. git status --short clean; confirm HEAD.
2. Confirm frontend/ and Python tree untouched.
3. Re-read PullConnector, FetchRequest/FetchPage, ConnectorRegistry,
   MockApiConnector, CredentialVault.open, SyncRunExecutor, V3 capability seed,
   docs/sellerops_phase3c.md.
4. Confirm against official Naver Commerce API docs (official sources only):
   electronic-signature format, token endpoint, orders endpoint
   request/response shape, pagination, rate-limit headers. If a detail cannot
   be confirmed from official docs, stop and report it — do not guess.

Implement only:
1. com.sellerops.connector.naver: NaverApiConnector implements PullConnector,
   @ConditionalOnProperty sellerops.connector.naver.enabled, default false.
   Serves channel NAVER only; capabilities = ORDER_SUMMARY only; everything
   else throws UnsupportedDataTypeException.
2. NaverTokenClient: signature (injected Clock), token exchange, cache until
   expiry minus skew. HTTP behind an injectable interface; no static/global
   HTTP. Secrets never logged/toString'd (follow DecryptedCredential pattern).
3. Credential read strictly via CredentialVault.open at fetch time; missing
   credential or closed vault ⇒ fail-closed, zero outbound requests.
4. Orders query → CanonicalOrderSummary mapping; date-range cursor as opaque
   cursorValue; 429/remaining-header ⇒ FetchPage.rateLimited.
5. ConnectorRegistry: channel-aware resolution (real connector wins for its
   channel when its bean exists; mock serves the rest; flag off ⇒ unchanged).
6. Config keys: sellerops.connector.naver.enabled / base-url / rate-limit-rps.
   No real values anywhere in the repo.

Tests (all offline, fake HTTP):
- signature determinism, token caching/expiry/refresh
- credential missing + vault closed ⇒ fail-closed with zero HTTP requests
- 429 ⇒ FetchPage.rateLimited(retryAfterSeconds), cursor unchanged
- unsupported data types throw; capabilities() agrees with fetch()
- fixture JSON ⇒ CanonicalOrderSummary, cursor/hasMore contract
- registry: flag off ⇒ identical to today (regression); flag on ⇒ NAVER only

Verification:
1. cd backend && ./gradlew test — all pass.
2. ./gradlew bootJar.
3. Confirm frontend/ and Python tree untouched; no migrations added.
4. Confirm flag-off runtime behavior is byte-identical (registry regression).
5. Codex rescue review; fix MUST-FIX items.
6. Do not commit until I approve.
7. Live smoke against a real Naver account is NOT part of this slice — it
   requires separate explicit authorization with operator-supplied throwaway
   credentials. If setup is blocked (IP allowlist / registration), record
   "blocked: <reason>" — do not fake it; fallback target is Coupang HMAC.

Output: 1. files added/changed 2. test summary 3. flag-off regression proof
4. what was confirmed from official docs vs still unverified 5. Codex result
6. remaining Slice 2 candidates. Do not start Slice 2 yet.
```

---

## 12. Slice 1a / 1b split (recorded 2026-06-12, at Slice 1a implementation)

The Slice 1 preflight verified auth/token/rate-limit/endpoint-path details
against official sources (the Naver-operated `commerce-api-naver/commerce-api`
repository; the docs portal is not fetchable from the implementation
environment), but could **not** confirm the orders response schema. Slice 1 was
therefore split at the safely confirmed boundary:

**Slice 1a (implemented)** — auth/registry/rate-limit/fail-closed only:

- Feature-flagged `NaverApiConnector` bean (`sellerops.connector.naver.enabled`,
  default false — bean absent, NAVER keeps resolving to the mock).
- Channel-aware `ConnectorRegistry` via `PullConnector.dedicatedChannels()`.
- `NaverTokenClient` with the confirmed electronic signature
  (`bcrypt(client_id + "_" + timestamp_ms, salt = client_secret)` → Base64 →
  `client_secret_sign`), confirmed form fields
  (`client_id / timestamp / client_secret_sign / grant_type=client_credentials
  / type=SELF`), per-client token cache honoring the variable `expires_in`
  minus a 60s skew.
- `CredentialVault.open` as the only credential path, fail-closed **before any
  HTTP**.
- 429 → `FetchPage.rateLimited`; officially no `Retry-After` header exists
  (confirmed), so a conservative 1s hint is used and the scheduled runner's
  ≥1-minute clamp governs the actual wait.
- Runtime capabilities advertise **no collectable data type yet**, so no
  scheduler/manual path can reach the unimplemented orders call;
  `fetch(ORDER_SUMMARY)` stops with a clear schema-pending error after proving
  the credential → signature → token chain.

**Slice 1b (implemented — official two-call flow approved 2026-06-12)** — the
schema preflight confirmed, from the Naver-operated official repo (FAQ #9,
#2437, #1058, #587, #1875), that `last-changed-statuses` alone cannot produce a
truthful `salesAmount`: its confirmed per-item fields (`productOrderId`,
`orderId`, `productOrderStatus`, `lastChangedDate`, `lastChangedType`,
`paymentDate`) carry no amounts. The officially recommended collection pattern
is the two-call flow, which was approved in place of "one endpoint only":

1. `GET …/product-orders/last-changed-statuses` — ≤24h `lastChangedDate`
   windows, `lastChangedType=PAYED`, `data.more` (`moreFrom`/`moreSequence`)
   continuation.
2. `POST …/product-orders/query` — batched `productOrderIds` (configurable
   `order-detail-batch-size`, default 100, hard ceiling 300 because the
   official maximum is unconfirmed); amounts joined by product order id.

Mapping decisions of record:

- **`summaryDate`** = KST (`Asia/Seoul`) calendar date of `paymentDate`
  (`lastChangedDate` fallback).
- **`orderCount`** counts paid **product-order rows** (상품주문 단위). The
  upload parser's 주문수 is an operator-supplied column (no precedent), and
  distinct-`orderId` counting would require unbounded id sets in the cursor.
- **`salesAmount` = Σ `productOrder.initialPaymentAmount`** — the order-time,
  post-discount amount. **`totalPaymentAmount` must not be used** (deprecated;
  removal was announced for 2025). `remainPaymentAmount` (claim-adjusted net
  sales) is a deliberate later refinement.
- Emissions are **cumulative per date**, carried in the cursor's `dayTotals`,
  because `IngestionService.ingestOrderSummaries` upserts by (channel, date)
  and overwrites — successive overwrites converge to the true daily total.
- **Boundary re-delivery is deduplicated**: adjacent windows share their
  boundary instant (official gap-avoidance rule), so product orders stamped
  exactly on the boundary are carried in the cursor (`edgeIds` → `dedupeIds`)
  and skipped if the next window re-delivers them.
- **Stragglers beyond the 2-day emission horizon are skipped, not emitted** —
  their carried totals were pruned, and emitting would overwrite a final daily
  total with a partial recount. For `PAYED` events `lastChangedDate ≈
  paymentDate`, so this is a documented edge, not an expected data path.

Still no live smoke in this slice: all verification is offline with fake HTTP
and fixtures built from the confirmed field names. Live-smoke checklist:
the exact `more`-continuation recipe, the per-page maximum, the
`productOrderIds` per-request maximum, and `initialPaymentAmount` presence in
real responses (post-`totalPaymentAmount` removal).
