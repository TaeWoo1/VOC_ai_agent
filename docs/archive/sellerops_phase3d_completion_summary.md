# SellerOps Phase 3D — Completion Summary

Written at HEAD `2356a62`. Phase 3D is complete: all planned multi-channel
connector **auth skeleton** slices have landed. This document is the record of
what exists, what deliberately does not, and what comes next. Detailed
per-channel verification facts live in
`docs/sellerops_phase3d_multi_channel_adapters.md` (§2, per-slice records in
§8); the Naver live-smoke runbook is `docs/sellerops_phase3c_live_smoke.md`.

---

## 1. Executive summary

Phase 3D added disabled-by-default **auth skeletons** for five channels:
**Coupang, Cafe24, ESM (Gmarket/Auction), 11st, SSG**. Each skeleton proves
the full credential chain offline — feature-flagged bean wiring,
channel-dedicated registry routing, vault-backed fail-closed credential
access, an officially-verified auth client (signer / token client / header
assembly), and a fakeable HTTP boundary — while exposing an **empty
capability set**, so no scheduler or manual sync can reach an unimplemented
fetch path.

- **Naver** already has the only real collection path (ORDER_SUMMARY,
  Phase 3C); its code is frozen pending the live smoke.
- **Today's House (OHOUSE)** remains PARTNER_ONLY_OR_BLOCKED — no public
  API, OPEN-API restricted to 9 contracted solution vendors; file-upload
  only.
- All five new connectors are **off by default**; with flags off the bean
  graph is byte-identical to Phase 3C.
- **No new real collection path was opened in Phase 3D.** Zero live API
  calls were made; every verification was official-documentation reading
  plus offline tests.

Test suite: 147 tests at phase start (`d40e2d9`) → **263 at `2356a62`**,
all passing, every slice Codex-reviewed before commit.

## 2. Commits

| Hash | Slice | Commit |
|---|---|---|
| `9a2d842` | 3D-1 | docs(sellerops): add phase 3d multi-channel adapter plan |
| `6061f71` | 3D-2 | feat(sellerops): add coupang connector auth skeleton |
| `9488f71` | 3D-3 | feat(sellerops): add cafe24 connector auth skeleton |
| `237db74` | 3D-4 | feat(sellerops): add esm connector auth skeleton |
| `0deadd8` | 3D-5 | feat(sellerops): add 11st connector auth skeleton |
| `2356a62` | 3D-6 | feat(sellerops): add ssg connector auth skeleton |

## 3. Channel matrix

| Channel | Implementation status | Auth model | Capability status | Official API confidence | Remaining blocker | Recommended next action |
|---|---|---|---|---|---|---|
| Naver | **Real connector** (3C): ORDER_SUMMARY end-to-end, offline-tested | OAuth2 client-credentials, bcrypt-signed timestamp | ORDER_SUMMARY collectable (flag-gated) | High — public docs + fixtures; schema items pend live confirmation | Seller account / app registration / IP allowlist for the smoke | **Live smoke** per the 3C runbook |
| Coupang | Auth skeleton (3D-2): CEA HMAC signer offline-verified | HMAC (CEA, HmacSHA256, signed-date GMT) | Empty | High — fully public docs incl. signature recipe and host | 180-day key expiry + ≤10-IP allowlist are operator duties; order schema unread | **Order schema preflight** (docs are public) |
| Cafe24 | Auth skeleton (3D-3): refresh-token client + rotated-token vault write-back | OAuth2 refresh grant, single-use rotating refresh token | Empty | High — public dev docs; `expires_at` zone semantics deferred to live smoke | Initial refresh token needs interactive mall-owner consent (operator step) | Order/boards schema preflight after a test mall consents |
| ESM Gmarket/Auction | Auth skeleton (3D-4): HS256 JWT signer, byte-literal-tested | Self-signed JWT (kid=Master ID, `ssi` carries both seller ids) | Empty | Medium-high — JWT format verbatim-official; `iat` unit + order schema pend account access | ESM+ Master ID / key issuance (account permission); catalog has GMARKET only, no AUCTION code | Schema slice once ESM+ credentials arrive |
| 11st | Auth skeleton (3D-5): static `openapikey` header client | Single static key, `openapikey` header | Empty | Medium — auth + host publicly confirmed; **all endpoint specs seller-login-walled** | Seller membership + key + registered IP; spec access needs seller login | **Review/Q&A schema preflight** if seller login access arrives (only official review API in the set) |
| SSG | Auth skeleton (3D-6): raw `Authorization` key client, **no default base-url** (startup fails closed without explicit https value) | Single static 업체 인증키, raw header value | Empty | Medium-high — full public endpoint docs; production/test hosts not publicly printed | 입점 contract (curated entry), MD-department key request, IP registration (mandatory by 2026-06-30), host confirmation at issuance | Order/Q&A schema slice once key + host are issued |
| Today's House | None (deliberate) | Unknown — no public API | n/a | n/a — OPEN-API restricted to 9 approved solution vendors, no expansion planned | Partner/API access would need written confirmation | Stay file-upload only; re-open only on confirmed access |
| File upload | **Real path** (pre-existing) | n/a | Operator-initiated ingest | n/a | none | Remains the universal fallback, incl. all review data except a future 11st path |

## 4. Implemented vs. not implemented

**Implemented (Phase 3D):**

- Five auth skeletons (`connector/coupang`, `cafe24`, `esm`, `elevenst`,
  `ssg`), each: `PullConnector` impl dedicated to its channel, empty
  capabilities, fail-closed fetch ordering (gate → vault → shape check →
  schema-pending stop).
- Feature flags `sellerops.connector.{coupang,cafe24,esm,elevenst,ssg}
  .enabled`, all default false; SSG additionally requires an explicit https
  `base-url` at startup.
- Channel-aware registry routing proven flag-off/flag-on/pairwise up to all
  six real-connector flags at once.
- Fakeable single HTTP boundary per package; production JDK impls created
  only inside flag-gated configurations; auth-header masking in test fakes.
- Credential fail-closed paths through `CredentialVault.open` (missing row,
  closed vault, wrong shape, blank values — all before any HTTP).
- Auth clients where the scheme is non-trivial: `CoupangSigner` (CEA HMAC,
  independently recomputed in tests), `Cafe24TokenClient` (refresh grant,
  429 handling, mall_id hostname validation) **plus
  `CredentialVault.rotateSecrets`** (payload-only re-encryption for the
  single-use rotating refresh token; failed refresh never overwrites),
  `EsmJwtSigner` (verbatim official claims, byte-literal segment tests);
  11st/SSG use static header assembly with blank-key guards.
- 116 new tests (147 → 263) incl. one executor-level capability-gate test
  per channel; docs updated per slice with verification-dated records.

**Not implemented (deliberately):**

- Order fetch on any non-Naver channel; product fetch; inquiry/Q&A fetch;
  review fetch; sales/settlement fetch — on all channels.
- Pagination, response parsing, DTOs for any new channel.
- Capability enabling — no skeleton advertises any collectable DataType.
- Live API calls of any kind (including auth probes).
- Frontend collection UX beyond the existing controls.
- V5 `connector_capabilities` seed migration (separate approval).
- GMARKET/AUCTION catalog split; Today's House connector; Cafe24
  interactive consent flow.

## 5. Safety guarantees

1. **All new connectors disabled by default** — flag off ⇒ bean absent ⇒
   runtime byte-identical to Phase 3C.
2. **Empty capability set** ⇒ schedule PUTs are rejected
   (`requireAutoCollectable`) and manual sync records a config failure at
   the executor gate — proven per channel with throwing fakes: external
   HTTP is unreachable even with flags on.
3. **Credential fail-closed before HTTP**: missing credential row, missing
   vault master key, wrong-shape secrets, blank values — every path throws
   before the HTTP boundary; Korean messages name the missing key, never a
   value.
4. **No secrets in `application.yml`** — credentials enter only via the
   intake API into the AES-256-GCM vault, per seller account; nothing is
   logged or `toString`-ed in plaintext (test-locked masking).
5. **No live API calls were made** in implementation or tests; SSG/11st
   plaintext-scheme risks are additionally guarded (SSG: non-https
   base-url refuses startup).
6. **No browser automation, no scraping** anywhere.
7. **No Python review-ops changes; no DB migrations; no channel catalog
   changes** in any skeleton slice.

## 6. Important official findings (re-verified at implementation time)

- **Coupang:** CEA HMAC-SHA256 per-request signature (lowercase hex, GMT
  `yyMMddTHHmmssZ`); gateway `api-gateway.coupang.com`; ~5 rps/vendorId;
  **no review API**; CS-inquiry API exists; 180-day key expiry and ≤10-IP
  allowlist are standing operator duties; no sandbox — first live call is
  production.
- **Cafe24:** refresh-token grant with **single-use rotation** (handled:
  rotated token is written back through the vault immediately; the vault
  `secrets` map is the single authoritative storage); per-mall API host
  `https://{mall_id}.cafe24api.com`; leaky bucket 40 @ 2/sec with
  `X-Cafe24-Call-Remain`; generic **boards API** is the only indirect
  candidate for inquiry/review-like data (per-mall board discovery).
- **ESM:** one shared HS256 JWT credential serves both marketplaces — the
  `ssi` claim carries Auction and Gmarket seller ids together; our channel
  catalog models both as the single code `GMARKET` (no AUCTION code), so
  the connector dedicates to GMARKET; order queries limited to 1 call/5s
  per seller id.
- **11st:** static `openapikey` header (officially that exact lowercase
  name); mandatory registered IP; seller host `api.11st.co.kr` publicly
  printed; **the only channel in the set with an official catalog-level
  구매후기(review)/Q&A retrieval + answer API** — but every per-endpoint
  spec is seller-login-walled, so the schema is unread; no published rate
  limit.
- **SSG:** raw 업체 인증키 as the `Authorization` header value (no
  Bearer/Basic); full public endpoint docs but **production/test hosts are
  not publicly printed** (hence the no-default fail-closed base-url); an
  official **test environment exists**; key issuance via MD-department
  request after the 입점 contract; per-key access-IP registration
  mandatory by 2026-06-30; **reviews confirmed absent**; 상품Q&A retrieval
  is unanswered-only.
- **Today's House:** no public API; OPEN-API restricted to 9 contracted
  solution vendors with no expansion planned — direct seller access is
  not available.
- **Cross-channel:** reviews remain the hardest data family — only 11st
  offers an official (login-walled) path; everywhere else the fallback
  order stands: official API → official export → file upload.

## 7. Recommended next steps (ranked)

1. **Naver live smoke** — when seller credentials / app registration / IP
   allowlist are ready; runbook `docs/sellerops_phase3c_live_smoke.md`;
   requires separate explicit operator authorization. This converts the
   only real collection path from fixture-verified to live-verified.
2. **Coupang order schema preflight** — the only non-Naver channel whose
   endpoint docs are fully public; a docs-only slice can pin the
   ordersheet schema before any fetch code.
3. **11st review/Q&A schema preflight** — *if* seller login access becomes
   available; strategically valuable as the only official review path in
   the set.
4. **V5 `connector_capabilities` seed migration** — only after deciding
   what the UI should expose channel-wide; separate approval per the 3D
   plan.
5. **SSG / Cafe24 / ESM schema slices** — each gated on account/key access
   (SSG: 입점 + MD key + host; Cafe24: mall-owner consent for the initial
   refresh token; ESM: ESM+ Master ID issuance).

## 8. Operator-facing summary (비기술 요약)

주요 판매 채널(쿠팡, 카페24, G마켓/옥션, 11번가, SSG)의 **공식 API 연동
경로를 전부 공식 문서로 검증**하고, 각 채널의 인증 골격을 미리
구현해두었습니다. 모든 신규 커넥터는 기본적으로 꺼져 있고 실제 호출은 한
건도 하지 않았기 때문에 **운영 데이터에 대한 위험은 없습니다**. 판매자
계정·인증키가 먼저 준비되는 채널부터 바로 다음 단계(실제 주문 수집)를
시작할 수 있는 상태입니다. 리뷰 데이터는 여전히 대부분의 채널이 공식
API를 제공하지 않아 파일 업로드 방식이 기본이지만, **11번가는 공식
구매후기/Q&A 조회 API가 존재하는 유일한 채널**로 확인되어 — 판매자 로그인
권한만 확보되면 — 유망한 다음 후보입니다. 오늘의집은 승인된 솔루션
업체에만 API를 제공하므로 당분간 파일 업로드로만 지원합니다.
