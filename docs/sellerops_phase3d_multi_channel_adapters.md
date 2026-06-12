# SellerOps AI — Phase 3D: Multi-Channel Connector Adapter Skeletons

**Mode:** Docs-first planning step (this document is the deliverable). No
connector code is implemented here. No real API calls, no guessed endpoint
paths / response schemas / pagination / amount fields, no browser automation,
no scraping, no frontend changes, no DB migrations (none are required for
skeletons; any capability-seed migration needs separate explicit approval), no
Python review-ops changes. Nothing is committed until separately approved.

Date: 2026-06-12. Planned at HEAD `d40e2d9`, branch `feature/review-ops-industrial`.

---

## 1. Why now, while Naver permission is pending

The Naver live smoke (runbook: `docs/sellerops_phase3c_live_smoke.md`) is
blocked on startup-side permissions (API Center registration / credential
issuance). The blocked work is the *live* verification only — the connector
architecture proven in Phase 3C (feature-flagged bean, channel-aware registry
via `PullConnector.dedicatedChannels()`, fail-closed `CredentialVault.open`
before any HTTP, fakeable HTTP boundary, offline tests) is reusable per
channel without any live call. Phase 3D uses the waiting time to:

1. Verify, from official sources, what each remaining company channel
   actually offers via API (this document, §2).
2. Prepare **disabled-by-default adapter skeletons** so that when any
   channel's credentials arrive, only the schema-confirmed fetch slice
   remains — the auth/registry/fail-closed scaffolding is already tested.

Skeletons expose **no collectable DataType**, so the scheduler and manual
sync can never reach an unimplemented fetch path (the Phase 3C Slice 1a
"safe state", proven by `CollectControlService.requireAutoCollectable`
rejecting empty capabilities). Flag off ⇒ bean absent ⇒ runtime
byte-identical to today.

## 2. Channel-by-channel official API status

Verified 2026-06-12 from official operator-run sources; anything not
confirmable from an official source is marked UNCONFIRMED. (Naver and the
prior Coupang findings: `docs/sellerops_phase3c.md` §3, V3 capability seed.)

### 2.1 Coupang WING Open API — READY_FOR_AUTH_SKELETON

- **Portal:** `https://developers.coupangcorp.com/` — publicly readable, no
  login. Re-verified this session; **no contradictions** with the Phase 3B/3C
  findings.
- **Auth (CONFIRMED):** per-request HMAC, official header form
  `Authorization: CEA algorithm=HmacSHA256, access-key={key},
  signed-date={yyMMddTHHmmssZ, GMT}, signature={sig}`; message =
  `datetime + method + path + query`; signature valid ≤5 minutes. Every call
  also sends `X-Requested-By: {vendorId}`. Fully offline-verifiable.
- **Credential shape (CONFIRMED):** `{access_key, secret_key, vendor_id}`,
  issued in WING → 판매자정보 → API Key 발급.
- **Data (CONFIRMED):** orders (발주서 list by minute/day, single by id),
  customer inquiries (product CS + contact-center query/reply), product
  APIs, settlement. **Reviews: confirmed absent** (portal-wide negative
  search; matches the V3 seed).
- **Rate limit (CONFIRMED):** throttling applies above ~5 calls/sec per
  vendorId, whole-API scope, 429, recovery minutes–tens of minutes.
- **Sandbox:** confirmed none ("별도의 테스트 환경이 제공되지 않으니").
- **Blockers:** verified business WING account; **IP allowlist (max 10 IPs,
  edits ≤10/week)**; initial key activation can take 24+ hours; **keys
  expire after 180 days** (re-issue window opens T-14d) — an ops/rotation
  concern to design for, not a code blocker.
- **3D-2 implementation re-verification (2026-06-12, official portal):**
  signature encoding is **lowercase hex** (the official Python sample's
  `hexdigest()` / C# `ToString("x2")`); the message is
  `signedDate + method + path + query` with no separators and **no `?`**;
  the gateway host is `https://api-gateway.coupang.com` (quoted verbatim in
  the official PO-list endpoint doc); the official test guide additionally
  requires an **`X-MARKET: KR`** header alongside `Authorization` and
  `X-Requested-By`. The 5-minute signature-validity figure from the earlier
  sweep was not restated in the HMAC article body — treat it as a live-smoke
  observation item, not a coded constant.

### 2.2 Cafe24 — READY_FOR_AUTH_SKELETON

- **Portal:** `https://developers.cafe24.com/` (Admin API reference public,
  KO/EN).
- **Auth (CONFIRMED):** OAuth 2.0 **authorization-code grant only** — no
  client-credentials. Per-mall endpoints
  `https://{mall_id}.cafe24api.com/api/v2/oauth/authorize|token`. The mall
  owner must approve the app's consent screen at install. ⇒ **The initial
  refresh token requires an interactive operator step**; the connector's
  token client is refresh-token-based, not mint-from-secret like Naver.
- **Credential shape (CONFIRMED):** `{client_id, client_secret, mall_id,
  redirect_uri}` + per-mall `access_token` (TTL 2h) and `refresh_token`
  (TTL 2 weeks, **single-use rotation** — using it invalidates the previous
  one, so the vault row must be updated on every refresh).
- **Data (CONFIRMED):** orders `GET /api/v2/admin/orders` (scope
  `mall.read_order`); products (`mall.read_product`); inquiries/reviews flow
  through the generic **boards** API (`mall.read_community`,
  `GET /admin/boards/{board_no}/articles`) — which `board_no` is the
  review/inquiry board is per-mall discovery, **UNCONFIRMED** as a fixed
  schema. The only channel in this set with any API-reachable review-like
  data.
- **Rate limit (CONFIRMED):** leaky bucket per mall — capacity 40, drains
  2/sec; `X-Api-Call-Limit` / `X-Cafe24-Call-Remain` headers; 429 when full;
  >10 req/sec per IP may be flagged abnormal.
- **Sandbox:** no true sandbox; official test path installs the app on a
  non-operating mall.
- **Blockers:** developer registration + app creation (self-service); mall
  owner consent at install; app-store 심사 for distributed apps (private
  long-term install policy UNCONFIRMED); refresh-token rotation discipline.
- **3D-3 implementation re-verification (2026-06-12, official sources):**
  client auth on the token endpoint is `Authorization: Basic
  base64(client_id:client_secret)` + `application/x-www-form-urlencoded`
  (verbatim official curl sample, indexed from the official token guide);
  refresh body is `grant_type=refresh_token&refresh_token={token}`; the
  response carries **`expires_at` as an ISO-8601 datetime (not
  `expires_in`)**, plus `refresh_token` / `refresh_token_expires_at` /
  `token_type: Bearer` (verbatim sample from the official Admin API docs);
  rotation re-confirmed ("You can not use the old refresh token after it has
  expired"). The official `expires_at` sample carries **no timezone offset**
  — zone interpretation is deliberately deferred (no client-side expiry
  caching; recorded as a live-smoke item). On 429 the official
  `X-Cafe24-Call-Remain` header carries seconds-until-resumption.

### 2.3 ESM (Gmarket + Auction) — NEEDS_ACCOUNT_PERMISSION

- **Portal:** `https://etapi.gmarket.com/` ("ESM Trading API", operated by
  주식회사 지마켓) — publicly readable; endpoints on `sa2.esmplus.com`.
- **One shared API family (CONFIRMED):** a single credential covers both
  marketplaces — JWT `HS256` signed with an issued secret key, header
  `kid = {ESM+ Master ID}`, payload `aud: "sa.esmplus.com"`, and an `ssi`
  claim carrying both seller IDs (`"A:{auction_id},G:{gmarket_id}"`).
  Official notices apply limits "per seller ID per token across both
  Gmarket and Auction". ⇒ **One ESM connector for both is the right shape.**
- **Credential shape (CONFIRMED):** `{master_id, secret_key,
  gmarket_seller_id, auction_seller_id}` + registered server IP + issuer
  domain.
- **Data (CONFIRMED):** orders (`POST /shipping/v1/Order/RequestOrders` and
  family), seller inquiries/Q&A (`/item/v1/communications/customer/
  bulletin-board`, 7-day query windows), products. **Reviews: not
  documented — likely absent.**
- **Rate limit (PARTIAL):** order inquiry **1 call / 5 s per seller ID per
  token** (official notice, 2025-04-23); other endpoints unpublished.
- **Sandbox:** UNCONFIRMED; guide implies operator-coordinated testing.
- **Blockers (why not READY):** key issuance is a **manual, discretionary
  email application** (`etapihelp@gmail.com`: scope, Master ID, service URL,
  recent 3-month revenue, timeline; "내부 사정으로 거절될 수 있음") +
  IP allowlisting. The auth scheme itself is public, so the skeleton is
  offline-buildable; live use is permission-gated.
- **3D-4 implementation re-verification (2026-06-12, official guide):** JWT
  header verbatim `{"alg":"HS256","typ":"JWT","kid":"{master id}"}`; payload
  claims `iss` (token issuer — "보통 클라이언트 도메인 주소 사용", i.e. the
  service domain registered at key issuance), `sub` = `"sell"` (fixed for
  the Sell API), `aud` = `"sa.esmplus.com"` (fixed), `iat` (long type,
  officially **"필수 정보 아님"** — optional; emitted as RFC 7519 epoch
  seconds, unit to re-confirm at live smoke), `ssi` =
  `"A:옥션판매자ID,G:지마켓판매자ID"`; signature
  `HS256(base64UrlEncode(header) + "." + base64UrlEncode(payload), secret
  key)`; sent as `Authorization: Bearer {token}`. No `exp`/`nbf` claims are
  documented. Because `iss` is tied to the key application, it is stored as
  a **credential secret (`issuer`)**, never in `application.yml`.

### 2.4 11st (11번가) — NEEDS_ACCOUNT_PERMISSION

- **Portal:** `https://openapi.11st.co.kr/` — actively operated (notices
  through 2026-04); service intro/operation guide public, **Seller API
  detail specs (orders/product/claims) behind seller login**.
- **Auth (CONFIRMED):** static API key in an `openapikey` HTTP header; no
  OAuth/HMAC. **Mandatory registered IP** — the key only works from
  registered IPs.
- **Credential shape (CONFIRMED):** single API key (no secret).
- **Data:** orders + products officially exist (catalog level); their
  request/response schemas are login-gated ⇒ **NEEDS_OFFICIAL_SCHEMA on top
  of account permission** for any fetch slice. The public general-API spec
  is XML (EUC-KR) — orders format UNCONFIRMED. **Reviews/Q&A — corrected at
  3D-5 re-verification (supersedes the 3D-1 "not listed" finding):** the
  official 상품 API catalog lists a 구매후기/Q&A retrieval+answer API
  verbatim ("상품 Q&A 목록과 구매후기를 조회하고 답변을 등록할 수 있습니다",
  `OpenApiServiceIntroduce.tmall?introduceType=PRODUCT`); its per-endpoint
  spec is seller-login-walled like the rest, so REVIEW stays uncollectable
  until a separately approved schema slice.
- **Rate limit / sandbox:** UNCONFIRMED (nothing public; re-verified at 3D-5
  across the usage guide, full FAQ, and notice board — no published limit).
- **Blockers:** seller membership before key issuance (portal →
  서비스신청·확인); IP allowlist; schema access requires the seller login.
- **Re-verified at 3D-5 implementation (2026-06-12, official portal pages
  only):** header is literally lowercase `openapikey`
  ("'openapikey:발급key값' 형태로 전송", OpenApiOperationGuide); single
  static 32-char key, no OAuth/HMAC/secret on any public page; registered
  IP mandatory and runtime-enforced ("IP주소 정보를 입력해야 셀러 API Key
  승인이 가능"; error "인증된 IP가 아닙니다"); the seller API host is
  **publicly printed in the official FAQ** —
  `http://api.11st.co.kr/rest/...` — so `api.11st.co.kr` is CONFIRMED (the
  example prints plain http; TLS on the host verified reachable the same
  day, scheme re-confirmation is a live-smoke item; never call with a
  credential over plaintext).

### 2.5 SSG.COM — NEEDS_ACCOUNT_PERMISSION

- **Portal:** `https://eapi.ssgadm.com/` — fully public per-endpoint docs
  (KO/EN, XML/JSON samples, ~130 endpoints).
- **Auth (CONFIRMED):** REST with a per-request header
  `Authorization: {업체 인증키}` — one static vendor auth key per company
  after an 입점 contract; **key creation is requested through the 담당 MD
  부서** (corrected at 3D-6 — supersedes the 3D-1 "self-issued in PO"
  reading; PO → API관리 → API계정정보 is the *management*/IP screen);
  activated via email link. **Registered access IP becomes mandatory per key
  by 2026-06-30** (official notice posted 2026-01-19; both 운영서버 and
  테스트서버 IPs must be set).
- **Credential shape (CONFIRMED):** `{auth_key}` (single static key; no
  separate vendor/company id in header, query, or body — vendor identity is
  implied by the key).
- **Data (CONFIRMED):** orders/shipping/claims/settlement families; products
  (legacy + v2 "online/item", legacy being phased out per notices); 상품Q&A
  **unanswered-only** retrieval ("조회기간의 미답변 상품Q&A에 대해서만
  리스트 조회가 가능") + answer API; CS 쪽지 APIs. **Reviews: confirmed
  absent** (zero review endpoints in the full catalog — re-verified at 3D-6
  across the complete live doc menu, KO and EN).
- **Rate limit (PARTIAL):** product-update API 50,000 calls/hour (official
  notice posted 2025-07-07, effective 2025-07-09); other endpoints
  unpublished.
- **Sandbox — corrected at 3D-6 (supersedes the 3D-1 "appears not to
  exist"):** a test environment **exists** officially ("SSG에서 제공하는
  테스트 환경에 접근할 수 있습니다", 인증키 발급안내) — its host, like
  production, is not publicly printed. Production API base host is not
  printed in the public docs (every endpoint example is a relative path,
  e.g. `/api/claim/v2/order/{orordNo}`) — confirm at key issuance; **never
  guess the host**.
- **Blockers:** 입점 (onboarding) contract — the open-market seller channel
  was closed per official notice, so entry is curated; one key per company;
  MD-department key request; IP registration.
- **Re-verified at 3D-6 implementation (2026-06-13, official eapi.ssgadm.com
  pages only):** every endpoint's request-header table carries exactly one
  auth row — `Authorization | string | Y | 업체 인증키` — with the official
  sample showing the raw key as the value (no Bearer/Basic prefix);
  `Accept`/`Content-Type` select `application/xml | application/json`.

### 2.6 Today's House (오늘의집 / OHOUSE) — PARTNER_ONLY_OR_BLOCKED

- **No public API surface exists:** no developer portal (all candidate
  domains 404), no public docs. The official help center confirms an
  OPEN-API exists but is **restricted to contracted 연동 솔루션 vendors
  only** ("연동된 솔루션에만 제공하도록 제한 설정") — exactly 9 approved
  solutions (사방넷, 샵링커, 샵플링, 셀릭, 셀메이트, 셀픽, 이지어드민,
  이지위너, 플레이오토); non-listed solutions were cut off 2023-05-15, and
  Bucketplace states **no plans to add more** ("이외 솔루션 연동 추가는 현재
  계획이 없습니다").
- Auth, credential shape, rate limits, sandbox: all UNCONFIRMED (nothing
  public). Reviews: no evidence of programmatic access even for approved
  solutions.
- **Decision (conservative, per instruction):** no connector skeleton, no
  fetch code, until partner approval / API access is confirmed in writing.
  Seller-side options today: Orora console (manual) → our **file-upload
  channel**, or an approved third-party solution.

### 2.7 Classification summary

| Channel | Code | Classification | Auth (official) | Skeleton slice |
|---|---|---|---|---|
| Coupang WING | `COUPANG` | READY_FOR_AUTH_SKELETON | HMAC (CEA, HmacSHA256) | 3D-2 |
| Cafe24 | `CAFE24` | READY_FOR_AUTH_SKELETON | OAuth2 authorization-code + rotating refresh | 3D-3 |
| Gmarket/Auction (ESM) | `GMARKET` | NEEDS_ACCOUNT_PERMISSION | JWT HS256 (kid=Master ID, ssi claim) | 3D-4 |
| 11st | `ELEVENST` | NEEDS_ACCOUNT_PERMISSION (+schema login-gated) | static `openapikey` header | 3D-5 |
| SSG.COM | `SSG` | NEEDS_ACCOUNT_PERMISSION | static `Authorization` vendor key | 3D-6 |
| Today's House | `OHOUSE` | PARTNER_ONLY_OR_BLOCKED | unknown (no public docs) | none — file upload only |

Cross-channel finding that matters to this product (corrected at 3D-5):
**one channel in this set has an official review-retrieval API — 11st**
(구매후기 조회+답변, catalog-confirmed, spec login-walled); Cafe24's generic
boards API remains the only other indirect, per-mall-discovered candidate.
Everywhere else the Phase 3C fallback order stands: official API → official
export → file upload; reviews stay capability-gated on every channel,
including ELEVENST, until an official schema is read and a fetch slice is
separately approved.

Note: the channel catalog (`MockDataSeeder.seedChannels`) models G마켓/옥션 as
the single code `GMARKET`. The ESM connector therefore declares
`dedicatedChannels() = {"GMARKET"}`; `dedicatedChannels()` is a set, so if a
separate `AUCTION` channel code is ever introduced (catalog change, separate
approval), the connector adds it without redesign.

## 3. Proposed adapter skeleton architecture

Each skeleton replicates the proven Naver Slice 1a shape — nothing more:

1. **Package** `com.sellerops.connector.<channel>` (`coupang`, `cafe24`,
   `esm`, `elevenst`, `ssg`).
2. **`<Channel>ApiConnector implements PullConnector`** — `kind()` =
   `<CHANNEL>_API` (ESM: `ESM_API`), `CONNECTOR_CLASS = "API"`,
   `dedicatedChannels()` = its channel code only.
3. **Feature-flagged configuration** (`@ConditionalOnProperty`, default
   false): flag off ⇒ bean absent ⇒ the channel keeps resolving to
   `MockApiConnector`; runtime byte-identical.
4. **Capabilities expose no collectable DataType** —
   `capabilities()` returns an empty supported set with a notes string
   explaining why (schema unverified / permission pending). This keeps
   `CollectControlService.requireAutoCollectable` rejecting schedule PUTs
   and the executor recording a config failure before any fetch. A DataType
   is flipped on only in a later, separately approved fetch slice with the
   official schema confirmed (the Naver 1a→1b pattern).
5. **Fail-closed fetch ordering** (identical to `NaverApiConnector.fetch`):
   channel/data-type gate → `CredentialVault.open` (org-scoped; missing
   row / missing master key throw here) → channel-specific secret-shape
   check (Korean message naming the missing key, never the value) → only
   then any HTTP. In skeleton state the gate itself rejects everything, so
   no HTTP is reachable at all.
6. **Auth client isolated and offline-testable** where the official scheme
   is already public:
   - Coupang: `CoupangSigner` — CEA HMAC-SHA256 over
     `datetime+method+path+query`, GMT `yyMMddTHHmmssZ`; deterministic with
     injected `Clock`; fully verifiable offline.
   - Cafe24: `Cafe24TokenClient` — refresh-token grant against the per-mall
     token URL; **must persist the rotated refresh token back through the
     vault** (single-use rotation) — this is the one new vault interaction
     pattern in 3D and gets designed in its slice.
   - ESM: `EsmJwtSigner` — HS256 JWT with `kid`/`aud`/`sub`/`iss`/`ssi`
     claims as officially documented; deterministic with injected `Clock`.
   - 11st / SSG: no signer — static header key; the auth client is just
     header assembly, validated by the fakeable HTTP boundary.
7. **Fakeable HTTP boundary per package** following `NaverHttpClient`
   (interface + JDK impl created only by the flag-gated configuration;
   masked `toString`, no secret material in any exception message). A
   throwing fake proves zero-HTTP paths exactly as `FakeNaverHttpClient`
   does.
8. **No scheduler changes, no ingestion changes, no migrations.** Channel
   rows already exist in the catalog; `connector_capabilities` rows are not
   needed for skeletons (they advertise nothing).

## 4. Feature flag naming convention

Following the Phase 3C precedent (`sellerops.connector.naver.*`):

| Key | Default |
|---|---|
| `sellerops.connector.coupang.enabled` | `false` |
| `sellerops.connector.cafe24.enabled` | `false` |
| `sellerops.connector.esm.enabled` | `false` |
| `sellerops.connector.elevenst.enabled` | `false` |
| `sellerops.connector.ssg.enabled` | `false` |

Each package also gets `…​.base-url` (overridable; for SSG the production
host is intentionally **left unset** until officially confirmed — startup
fails closed if the flag is on without a base-url) and, where officially
known, a rate-limit hint key (`coupang: 5 rps`, `cafe24: 2 rps / bucket 40`,
`esm order queries: 1 per 5 s`) reserved for pacing, mirroring
`sellerops.connector.naver.rate-limit-rps`. `sellerops.collect.scheduler-enabled`
stays `false` throughout.

## 5. Credential shape per channel (vault `secrets` map keys)

Secrets enter only via the existing credential intake API into the vault —
never env/config/repo. `auth_type` is the intake row's varchar; no migration
needed for new values.

| Channel | `auth_type` | `secrets` keys | Notes |
|---|---|---|---|
| COUPANG | `HMAC` | `access_key`, `secret_key`, `vendor_id` | 180-day key expiry → ops rotation duty; `vendor_id` also sent as `X-Requested-By` |
| CAFE24 | `OAUTH2` | `client_id`, `client_secret`, `mall_id`, `refresh_token` | initial `refresh_token` obtained via interactive mall-owner consent (operator step, out of connector scope); rotation must write back via vault |
| GMARKET (ESM) | `JWT_HS256` | `master_id`, `secret_key`, `gmarket_seller_id`, `auction_seller_id` | one credential, both marketplaces (`ssi` claim) |
| ELEVENST | `API_KEY` | `openapikey` | named after the official header verbatim (3D-5 decision); works only from registered IPs |
| SSG | `API_KEY` | `auth_key` | one key per company; registered IP mandatory by 2026-06-30 |

## 6. Capability policy per channel

- **Skeleton state (all of Phase 3D): empty supported set.** No DataType is
  collectable on any new connector until its official response schema is
  confirmed and its fetch slice separately approved. The mock continues to
  serve flag-off channels exactly as today.
- **First real DataType per channel (post-3D candidates, in evidence
  order):** ORDER_SUMMARY everywhere (orders are the best-documented family
  on every channel); INQUIRY is plausible on COUPANG (CS API confirmed),
  ESM (bulletin-board API confirmed), SSG (unanswered-only caveat), CAFE24
  (boards, per-mall discovery); REVIEW only on ELEVENST (구매후기 API
  catalog-confirmed at 3D-5, spec login-walled) — nowhere else.
- **`connector_capabilities` seed:** V3 seeds only COUPANG/NAVER. Updating
  the matrix for CAFE24/GMARKET/ELEVENST/SSG/OHOUSE to reflect §2 (so the
  UI tells the truth channel-wide) requires a **V5 migration — explicitly
  out of Phase 3D's default scope**; it is listed in Slice 3D-1 as a
  proposal that proceeds only with separate approval. Skeletons themselves
  need no seed rows.

## 7. Non-goals (all of Phase 3D)

- No real fetch logic, no live API calls, no endpoint/response-schema
  guessing, on any channel.
- No browser automation, no scraping (오늘의집 included — Orora is
  login-walled; the answer is file upload, not automation).
- No Naver connector changes (Phase 3C code is frozen pending its live
  smoke).
- No Today's House connector in any form until partner access is confirmed.
- No LOTTEON / KAKAO / MAKESHOP / IMWEB / CUSTOM work (not in this phase's
  channel list).
- No frontend changes; no scheduler changes; no DB migrations by default
  (V5 capability seed only with separate approval); no credential intake
  UI; no Python review-ops changes.
- No interactive OAuth consent implementation for Cafe24 (the skeleton
  consumes an operator-supplied refresh token; the consent/redirect flow is
  a later, separately scoped feature).

## 8. Implementation slices

Each slice: pre-checks (clean tree, HEAD confirm, frontend/Python untouched)
→ implement → `./gradlew test` → `./gradlew bootJar` → Codex rescue review →
fix MUST-FIX → hold for commit approval. One slice per approval.

- **Slice 3D-1 — this document + capability matrix refinement.** Commit this
  doc. Separately decide (explicit approval each): (a) whether to add the V5
  `connector_capabilities` seed for CAFE24/GMARKET/ELEVENST/SSG/OHOUSE from
  §2, (b) whether the channel catalog should ever split `GMARKET` into
  GMARKET+AUCTION (default: no).
- **Slice 3D-2 — Coupang auth skeleton** (first: P0 channel, fully public
  docs, offline-verifiable HMAC, capability seed already exists).
  `CoupangSigner` + connector + flag + registry/zero-HTTP/flag tests.
  **Implemented 2026-06-12 — auth skeleton only**: CEA signer offline-verified
  against the official recipe (incl. lowercase-hex encoding), feature-flagged
  connector dedicated to COUPANG with an **empty capability set**, fail-closed
  vault path (`access_key`/`secret_key`/`vendor_id` shape check), throwing-fake
  HTTP boundary, and an executor-level capability-gate test. Ordersheet/
  inquiry/product endpoint schemas, pagination, response parsing, and any
  live call remain deferred to later approved slices.
- **Slice 3D-3 — Cafe24 auth skeleton.** Refresh-token-based token client
  incl. the rotated-refresh-token write-back design through the vault;
  per-mall URL assembly from `mall_id`.
  **Implemented 2026-06-12 — refresh-token auth skeleton only**:
  feature-flagged connector dedicated to CAFE24 with an **empty capability
  set**; `Cafe24TokenClient` (per-mall token URL with mall_id hostname-shape
  validation, Basic client auth, refresh grant); **rotation write-back** via
  the new `CredentialVault.rotateSecrets` (payload-only re-encryption —
  class/type/creator/refresh-token slot preserved), persisted immediately
  after a successful refresh because the old token is single-use and already
  dead server-side; a failed refresh never writes back (test-locked). The
  initial authorization-code consent remains an operator/manual setup step —
  the refresh token enters through the credential intake API. **Storage
  invariant (review decision of record):** the vault `secrets` map is the
  single authoritative location for the Cafe24 refresh token; the row's
  separate refresh-token slot is neither read nor written by this connector —
  a dual-path reader was deliberately rejected because a post-rotation stale
  slot value could resurrect a dead token; a slot-only credential fails
  closed naming the missing key (test-locked). Order/product/board schemas,
  `expires_at` zone semantics, pagination, and any live call remain deferred
  to later approved slices.
- **Slice 3D-4 — ESM (Gmarket/Auction) skeleton.** `EsmJwtSigner` with the
  documented claims; one connector dedicated to `GMARKET`.
  **Implemented 2026-06-12 — ESM JWT auth skeleton only**: feature-flagged
  `EsmApiConnector` with an **empty capability set**; `EsmJwtSigner` builds
  the verbatim official header/payload (HS256, Master-ID `kid`, fixed
  `sub`/`aud`, site-prefixed `ssi`, optional `iat` as epoch seconds) with an
  independently recomputed signature in tests. **One shared connector for
  both marketplaces, dedicated to `GMARKET` only** — the channel catalog has
  no `AUCTION` code; the shared credential and `ssi` claim already carry
  both seller ids, so a future AUCTION channel (a catalog change needing its
  own approval) only adds a code to `dedicatedChannels()`. Credential shape:
  `master_id` / `secret_key` / `issuer` (the registered service domain —
  credential-scoped by decision) / `gmarket_seller_id` (required: the
  catalog channel is GMARKET) / `auction_seller_id` (optional, joins `ssi`
  when present). ESM auth is a self-signed JWT — no token endpoint — so the
  skeleton performs zero HTTP anywhere; the only published rate limit is an
  interval (1 order query / 5 s / seller id), recorded as
  `order-query-interval-seconds` rather than a misleading rps key.
  Order/inquiry/product schemas, pagination, and any live call remain
  deferred to later approved slices.
- **Slice 3D-5 — 11st skeleton.** Static-key header client; fetch stays
  fully gated (schemas are login-walled — NEEDS_OFFICIAL_SCHEMA recorded).
  **Implemented 2026-06-12 — static-key auth skeleton only**: feature-flagged
  `ElevenstApiConnector` dedicated to ELEVENST with an **empty capability
  set**; no signer and no token endpoint — the auth client is
  `authHeaders(openapikey)` assembling the official lowercase `openapikey`
  header verbatim (blank key fails closed, no echo). Credential shape:
  the single secret key `openapikey` (named after the official header —
  supersedes the earlier `api_key` placeholder in §5). Fail-closed vault
  path, throwing-fake HTTP boundary (GET, key header masked in test
  output), executor-level capability-gate test. `base-url` defaults to
  `https://api.11st.co.kr` (host publicly printed in the official FAQ;
  the official example prints plain http — TLS verified reachable, scheme
  re-confirmation is a live-smoke item); **no rate-limit config key on
  purpose** — 11st publishes none, so any rps figure would be invented.
  Re-verification reversed one 3D-1 finding: an official 구매후기/Q&A
  retrieval API exists at catalog level (§2.4 corrected; spec
  login-walled, so REVIEW stays uncollectable). Order/product/review/Q&A
  schemas, EUC-KR/XML response handling, pagination, IP registration, and
  any live call remain deferred to later approved slices — every
  per-endpoint spec requires seller-login access (NEEDS_ACCOUNT_PERMISSION
  stands).
- **Slice 3D-6 — SSG skeleton.** Static-key header client; **no base-url
  default** (host unconfirmed — flag-on without explicit base-url fails
  startup closed).
  **Implemented 2026-06-13 — static-key auth skeleton only**: feature-flagged
  `SsgApiConnector` dedicated to SSG with an **empty capability set**; no
  signer and no token endpoint — the auth client is `authHeaders(auth_key)`
  assembling the official raw-value `Authorization` header (no Bearer/Basic
  prefix; blank key fails closed, no echo). Credential shape: the single
  secret key `auth_key` (the official docs name the value only as the 업체
  인증키 carried in `Authorization`; no separate vendor id exists — confirmed
  absent from header/query/body across endpoint specs). **Base-url decision
  (as planned in §4):** no default value — the production host is not
  publicly printed (all official examples are relative paths), so flag-on
  without an explicit `sellerops.connector.ssg.base-url` fails startup
  closed with a message saying why, and a configured value must be https
  (the static key travels in `Authorization`; plaintext is refused at
  startup) — both rules test-locked. **No rate-limit config key**: the only
  published limit (product-update 50,000/hour, effective 2025-07-09)
  targets an API family this skeleton does not implement. Re-verification
  corrected two 3D-1 findings (§2.5 updated first per §10): key issuance is
  MD-department-requested, not PO-self-issued; an official test environment
  exists (host equally unprinted). Reviews re-confirmed absent. Fail-closed
  vault path, throwing-fake HTTP boundary (GET, Authorization masked in
  test output), executor-level capability-gate test.
  Order/shipping/claim/settlement/product/Q&A/쪽지 schemas, XML/JSON
  response handling, pagination, the MD key request, IP registration (운영
  + 테스트 servers, mandatory by 2026-06-30), host confirmation at key
  issuance, and any live call remain deferred to later approved slices.
- **Today's House:** no slice. Re-opens only on confirmed partner/API
  access; until then the channel stays file-upload-only.

Slices 3D-2/3D-3 are buildable to "auth client offline-verified" depth;
3D-4/5/6 are the same skeleton shape but their live use is acknowledged as
permission-gated (§2). If operator priorities change (e.g. ESM credentials
arrive first), slice order may be swapped at approval time — scope per slice
does not change.

## 9. Test policy (every skeleton slice, all offline)

- **Flag-off regression:** with the flag off (and by default), the channel
  resolves to `MockApiConnector` exactly as today — `ConnectorRegistry`
  test + `ApplicationContextRunner` bean-graph test proving the bean is
  absent.
- **Flag-on routing:** the dedicated connector wins **only** for its
  channel; every other channel (including NAVER vs. the new ones,
  pairwise when multiple flags are on) keeps its existing resolution.
  Bean-order independence re-asserted.
- **Fail-closed, zero HTTP:** missing credential row / closed vault /
  missing secret keys ⇒ throw before any HTTP, proven with a throwing fake
  HTTP boundary (the `FakeNaverHttpClient` pattern).
- **Capability honesty:** `capabilities()` empty set agrees with `fetch()`
  (every DataType throws `UnsupportedDataTypeException`); schedule PUT for
  the channel still rejects (`requireAutoCollectable` config-failure test
  at the executor level, as in Phase 3C Slice 1a).
- **Signer determinism** where a signer exists: Coupang CEA signature and
  ESM JWT are deterministic under a fixed `Clock` and verifiable offline
  (HMAC recomputation / JWT decode+verify); no secret material in any
  exception message or `toString`.
- **No-network guard:** no test touches a real base URL; production HTTP
  impls are created only inside flag-gated configurations.
- **Existing suites stay green:** full `./gradlew test` (147 at `d40e2d9`)
  plus `./gradlew bootJar` before any approval request.

## 10. Stop conditions

Stop and report (do not work around) if any of these occurs in a slice:

- An auth detail needed for a signer/token client is **not confirmable from
  an official source** (e.g. SSG production host, 11st order schema) — the
  skeleton ships without it fail-closed, or the slice stops; never guess.
- A skeleton turns out to require a DB migration or a scheduler/ingestion
  change after all — stop, report, get explicit approval first.
- Official docs contradict this document's §2 findings at implementation
  time — update §2 first (docs pass), then resume.
- Any test in the existing suite breaks in a way that suggests the locked
  Phase 3B/3C contracts (rate-limit semantics, registry fallback, vault
  fail-closed) are affected — stop; those contracts do not move in 3D.
- Anything would require a live API call to verify — live calls are out of
  scope for the entire phase and need separate operator authorization.

## 11. Exact prompt for the first implementation slice (after doc approval)

```
Start Phase 3D Slice 3D-2 implementation only: Coupang auth skeleton. Do not
start 3D-3 or any other slice.

Current HEAD: <hash after the phase3d doc commit>

Goal: disabled-by-default CoupangApiConnector skeleton — offline-verified CEA
HMAC signer, channel-aware registration for COUPANG, fail-closed credential
path, NO collectable DataType, zero live calls anywhere.

Do not implement: any real fetch/endpoint call, ordersheet parsing, any other
channel's skeleton, scheduler changes, ingestion changes, frontend changes,
DB migrations, credential intake UI, browser automation, scraping, Naver
connector changes, Python review-ops changes.

Before coding:
1. git status --short clean; confirm HEAD.
2. Re-read docs/sellerops_phase3d_multi_channel_adapters.md §2.1/§3–§6/§9,
   PullConnector, ConnectorRegistry, NaverApiConnector,
   NaverConnectorConfiguration, NaverHttpClient/FakeNaverHttpClient,
   CredentialVault.open.
3. Verify the CEA signature recipe against the official Coupang portal
   (developers.coupangcorp.com, "Creating HMAC Signature"): message =
   datetime + method + path + query, datetime GMT yyMMddTHHmmssZ,
   HmacSHA256, Authorization header form, X-Requested-By. If any element
   cannot be confirmed from the official page, stop and report — do not
   guess.

Implement only:
1. com.sellerops.connector.coupang: CoupangApiConnector implements
   PullConnector — KIND COUPANG_API, CONNECTOR_CLASS API,
   dedicatedChannels()={"COUPANG"}; capabilities() = empty supported set
   with an explanatory note; fetch(): channel/type gate (throws
   UnsupportedDataTypeException for everything) → vault.open → secret-shape
   check (access_key/secret_key/vendor_id; Korean message, no values) →
   schema-pending stop. No HTTP reachable.
2. CoupangSigner: CEA HMAC-SHA256 signature + Authorization header assembly,
   injected Clock, deterministic, no secret in messages/toString.
3. CoupangHttpClient interface + JDK impl (flag-gated bean only) +
   throwing/recording fake for tests, following the Naver pattern.
4. CoupangConnectorConfiguration behind
   sellerops.connector.coupang.enabled=false (default), plus base-url and
   rate-limit-rps(5) keys in application.yml (commented, env-overridable).

Tests (all offline): signer determinism + offline HMAC re-verification;
header assembly exact-form; flag-off bean absent + COUPANG→mock regression;
flag-on COUPANG→Coupang and all other channels (incl. NAVER flag-on
pairwise) unchanged; fail-closed zero-HTTP for missing credential / closed
vault / missing secret keys; capabilities-empty agrees with fetch();
schedule PUT for COUPANG still rejects (executor-level config-failure test).
Full ./gradlew test green; ./gradlew bootJar.

Verification: Codex rescue review; fix MUST-FIX (reject out-of-scope with
rationale); confirm frontend/Python/migrations untouched; do not commit
until I approve.

Output: 1. files added/changed 2. what was confirmed from official docs
3. test summary 4. flag-off regression proof 5. Codex result 6. confirmation
that no fetch path can reach HTTP. Do not start Slice 3D-3 yet.
```
