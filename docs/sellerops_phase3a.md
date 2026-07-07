# SellerOps AI — Phase 3A: Automatic Collection Strategy & Connector Feasibility

> **⚠️ 시점 기록 — 후속 검증으로 대체됨.** 본 문서의 채널별 추정(❓ 플래그)은 Phase 3D의
> 공식 문서 검증(`docs/sellerops_phase3d_completion_summary.md`)과
> `docs/multi-channel-connector-roadmap.md` §4.1 현행표로 대체되었다. 현행 판단에 이 문서를
> 인용하지 말 것.

**Mode:** Planning / research only. This document is the deliverable. No code,
no connectors, no browser automation, no credential storage. Nothing committed
until approved.

> **Verification status.** No official developer docs were fetched while writing
> this. Every platform-specific claim carries a confidence flag:
> **✓** = high confidence from general knowledge · **❓** = needs official
> verification before it can be relied on. The capability matrix's final column
> lists what must be confirmed per channel. Do not treat ❓ rows as commitments.

> **Frontend reference direction:** seller-center information architecture
> (Coupang / Naver Commerce) + ReactVibe UI block references. See
> `docs/sellerops_ui_reference.md`.

---

## 1. Product collection principle

SellerOps AI is **not** a manual CSV upload tool. The product is:

> The operator logs in **once**, connects each seller-center channel, sets a
> sync schedule, and SellerOps then **automatically** collects reviews,
> inquiries, orders, and sales from every channel — on a recurring cadence,
> incrementally, without the operator re-visiting any seller center or
> re-uploading files.

Manual file upload is, and remains, only three things:

1. a **demo / validation** path (ship value before integrations exist),
2. a **fallback** connector (channels with no automatable option), and
3. a **backup** when automatic collection is temporarily unavailable
   (credential expiry, platform outage, rate-limit lockout).

Connector selection is governed by a fixed priority order — automatic-first,
with manual and browser automation as the bottom two rungs:

| # | Connector class | Posture |
|---|---|---|
| 1 | **Official API** | First choice. Stable, sanctioned, incremental. |
| 2 | **Official export/report** | When no API: scheduled report/export download. |
| 3 | **Email / attachment** | Parse platform alert/report emails or attachments. |
| 4 | **Manual file upload** | Fallback + demo. Already shipped (Phase 2). |
| 5 | **Browser automation** | Last resort only. Risky, brittle, consent-gated. |

**Design consequence:** every channel resolves to the *highest-priority connector
that is actually available for it*. The UI must never present manual upload (4)
or automation (5) as a channel's "final" integration when (1)–(3) are reachable.

**Strategic risk to flag now:** the downstream value of SellerOps (the
review-analysis engine) depends on **review** availability. Orders/sales are
well-served by marketplace APIs; **reviews and inquiries are the least certain
data types across the big marketplaces.** Confirming review/inquiry access on
Coupang and Naver is the single highest-leverage verification item in this phase.

---

## 2. Channel capability matrix

Legend — Data types: **I**=inquiries, **R**=reviews, **O**=orders, **S**=sales,
**P**=products. Connector class numbers refer to §1. "Best avail." = the
highest-priority connector believed reachable today.

| Channel | Likely auth | Best avail. connector | I | R | O | S | P | Sync method | Difficulty | Risk | MVP priority | Must verify from official docs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Coupang** | HMAC (Access/Secret key, signed requests) ❓ | 1 Official API ✓ | ❓ | ❓ | ✓ | ✓ | ✓ | API polling w/ date-range cursor | Medium | Low | **P0** | Does the vendor Open API expose reviews (상품평) & customer inquiries (CS/문의)? Order & settlement endpoints, auth scheme, rate limits. |
| **Naver SmartStore** | OAuth2 client creds + signed token (Commerce API Center) ❓ | 1 Official API ✓ | ✓❓ | ❓ | ✓ | ✓ | ✓ | API polling w/ timestamp cursor | Medium | Low | **P0** | Commerce API scope for 문의/톡톡 inquiries; review API existence; settlement/정산 endpoints; signature algorithm. |
| **Cafe24** | OAuth2 (Developers REST API) ✓ | 1 Official API ✓ | ✓❓ | ❓ | ✓ | ✓ | ✓ | API polling / webhooks | Medium | Low | **P1** | Board/1:1 inquiry endpoints; reviews depend on installed review app; scopes; per-mall app install model. |
| **11st** | API key (셀러오피스 OpenAPI) ❓ | 1 Official API ❓ | ❓ | ❓ | ✓❓ | ❓ | ✓❓ | API polling | Medium | Low–Med | **P1** | Whether OpenAPI is open to all sellers; order/claim endpoints; review/inquiry coverage; auth. |
| **Imweb (아임웹)** | OAuth / API key (API v2) ❓ | 1 Official API ❓ | ❓ | ❓ | ✓❓ | ❓ | ✓❓ | API polling | Medium | Low–Med | **P2** | API v2 availability per plan; order/product scopes; review/inquiry access. |
| **MakeShop (메이크샵)** | API key / DB-open service ❓ | 1 or 2 ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | API or scheduled export | Med–High | Med | **P2** | Whether an open API exists vs. export-only; auth; data scopes. |
| **Gmarket / Auction** | ESM admin login; Open API restricted ❓ | 2 Export (ESM) / 5 automation ❓ | ❓ | ❓ | ✓❓ | ❓ | ✓❓ | ESM Excel export → ingest | High | Med | **P3** | Whether ESM/eBay Korea offers any sanctioned API or scheduled export; export formats. |
| **LotteOn** | Seller admin login ❓ | 2 Export / 5 automation ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | Export or automation | High | Med–High | **P3** | API/partner-integration availability; export options. |
| **SSG.COM** | Vendor/EDI or admin ❓ | 2 Export / partner EDI ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | EDI / export | High | Med–High | **P3** | Whether integration is partner-EDI only (large vendors) vs. self-serve export. |
| **오늘의집 (Ohou)** | Seller-center login ❓ | 2 Export / 5 automation ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | Export or automation | High | Med–High | **P3** (review-rich, but feasibility low) | Any seller API/export; review export feasibility (high product value if available). |
| **KakaoTalk Store (톡스토어)** | Kakao for Business / partner ❓ | 1 or 2 ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | API or export | High | Med | **P3** | Whether a seller-facing API exists; auth; data scopes. |
| **Self mall / 기타** | n/a (heterogeneous) | 3 Email / 4 Upload | — | — | — | — | — | Email parse or manual upload | Low | Low | **P2** (email), **done** (upload) | Per-customer; no single integration. |
| **File upload channel** | None | 4 Manual upload ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Operator-initiated upload | — | Low | **Done (Phase 2)** | n/a |

**Reading of the matrix:**
- **Clear API path, big volume → P0/P1:** Coupang, Naver, Cafe24, 11st.
- **Self-mall builders with probable APIs → P2:** Imweb, MakeShop; plus email
  connector for generic self-malls.
- **Restricted / unclear → P3 (export or, last resort, automation):**
  Gmarket/Auction, LotteOn, SSG, 오늘의집, KakaoTalk Store.
- **Reviews are ❓ almost everywhere** — the most important thing to verify, because
  the analysis engine consumes them.

---

## 3. Recommended MVP connector order

Weighted by: market volume × API quality × data-type coverage (esp. reviews)
× implementation risk.

1. **File upload** — *already shipped.* Universal fallback; keep as the safety net.
2. **Coupang Official API** — largest channel; orders/sales/products near-certain
   via API. *Gate: verify review/inquiry endpoints first* — if absent, scope the
   Coupang connector to O/S/P and source reviews elsewhere.
3. **Naver SmartStore Commerce API** — second-largest; strong order/settlement
   coverage and probable inquiry coverage. *Gate: verify review API.*
4. **Cafe24 API** — best-documented self-mall API; rounds out the self-mall segment.
5. **11st Open API** — completes the top marketplace tier.

Everything below the line is **post-MVP**: export connectors (Gmarket/Auction,
LotteOn, SSG via Excel/report), an email/attachment connector for generic
self-malls, and — only if a specific high-value customer demands a channel with
no sanctioned path — a tightly-scoped, consent-gated browser-automation connector
under the §7 policy.

**MVP build principle:** prove the *scheduled-collection backbone* once, then add
connectors as thin adapters over it. The first real connector is the integration
test of the whole machine, not a one-off.

---

## 4. Backend architecture changes needed

The Phase 2 seam already gives us the reuse point: `ChannelConnector` +
source-agnostic `IngestionService` + `Canonical*` records. Phase 3 adds the
**scheduling, credential, and run-tracking machinery around** that seam — it does
not rewrite ingestion.

**New / evolved components (all unbuilt; described for design review):**

- **Connector contract evolution.** `ChannelConnector` gains:
  - a static **capability descriptor** (which data types via which connector
    class) so the UI and scheduler can gate behavior;
  - an **incremental `fetch(dataType, cursor) → (canonical batch, nextCursor)`**
    method so collection is resumable and idempotent (reuses Phase 2 dedup).
  - `FileUploadConnector` keeps its current operator-initiated shape; API
    connectors implement the incremental contract.
- **Connector registry** keyed by `(channelCode, connectorClass)`; resolves the
  highest-priority available connector for a seller account.
- **Credential vault service** — the only path that reads/writes
  `connector_credentials`; performs envelope encryption/decryption; never returns
  secrets to controllers (see §6).
- **Scheduler / poller** — for MVP, Spring `@Scheduled` ticking every N minutes:
  finds `sync_schedules` whose `next_run_at <= now` and `enabled`, claims them
  with a DB row-lock (`SELECT … FOR UPDATE SKIP LOCKED`) so multiple instances
  don't double-run, and enqueues a `sync_run`. Quartz/a real queue is a later
  upgrade, not MVP. *(Note: the paused Python `scheduler/queue/workers`
  scaffolding is a different stack and is not reused here.)*
- **Run executor** — in-process executor for MVP: per run, resolve connector →
  decrypt creds → `fetch(cursor)` loop → `IngestionService` persist → advance
  `sync_cursors` → record `sync_runs` outcome. Per-batch persistence (Phase 2
  rule) so a mid-stream failure doesn't lose earlier rows.
- **Rate-limit governor** — per-connector token bucket; honors `429` /
  `Retry-After`; escalating backoff (mirrors the Python repo's "anti-bot signals
  must escalate, not retry" discipline).
- **Retry/backoff controller** — failed runs schedule a bounded, exponentially
  backed-off retry; after a threshold, mark the connection degraded and raise a
  failure alert.
- **Connection-health tracker** — maintains `channel_connection_status`
  (last success, consecutive failures, state) driving the Channels-page health UI.
- **Manual-retry endpoint** — operator-triggered re-enqueue of a failed/partial run.

**API surface added (read + control only; no new collection logic exposed):**
- `POST /api/seller-accounts/{id}/credentials` (write-only secret intake)
- `GET/PUT /api/seller-accounts/{id}/schedule`
- `GET /api/seller-accounts/{id}/connection-status`
- `GET /api/sync-runs` (extends existing `/api/sync-jobs` view)
- `POST /api/sync-runs/{id}/retry`
- `GET /api/channels/{code}/capabilities`

---

## 5. DB schema proposal (Flyway `V3__scheduled_collection.sql`, additive)

All tables org-scoped (`org_id`), UUID PKs, `created_at`/`updated_at`, matching
the Phase 1/2 convention. `sync_cursors` and `sync_jobs` already exist (V1/V2) and
are **extended**, not replaced.

- **`connector_credentials`** — `id, org_id, seller_account_id (FK, unique),
  connector_class, auth_type (HMAC|OAUTH2|API_KEY|PASSWORD), encrypted_payload
  (bytea), encryption_key_id, nonce/iv, token_expires_at, refresh_token_enc,
  last_rotated_at, created_by`. **No plaintext column ever.** One row per seller
  account; payload is an encrypted JSON blob whose shape depends on `auth_type`.

- **`connector_capabilities`** — reference/seed data:
  `channel_code, connector_class, data_type (INQUIRY|REVIEW|ORDER|SALES|PRODUCT),
  supported (bool), verification_status (CONFIRMED|NEEDS_VERIFICATION|UNSUPPORTED),
  notes`. Seeded from §2 with most rows `NEEDS_VERIFICATION` so the UI tells the
  truth until docs are checked. Could be code-config instead of a table — decide
  at build time; a table lets ops flip flags without redeploy.

- **`sync_schedules`** — `id, org_id, seller_account_id, data_type, cadence
  (cron or interval), enabled, next_run_at, last_run_at, paused_reason`.
  One row per (seller account × data type) the operator turned on.

- **`sync_cursors`** *(extend existing)* — ensure
  `(org_id, seller_account_id, data_type, cursor_key)` uniqueness; columns
  `cursor_value, updated_at`. Stores e.g. last order timestamp / page token.

- **`sync_runs`** *(extend existing `sync_jobs`, or add a child table)* —
  `id, org_id, seller_account_id, data_type, trigger (SCHEDULED|MANUAL|UPLOAD|RETRY),
  status (PENDING|RUNNING|SUCCESS|PARTIAL|FAILED), attempt, total/success/skipped/
  failed_rows, error_message, started_at, finished_at, next_retry_at,
  rate_limited (bool)`. The Phase 2 `sync_jobs` becomes the upload-trigger special
  case of this model.

- **`channel_connection_status`** — `id, org_id, seller_account_id (unique),
  state (CONNECTED|DEGRADED|EXPIRED|DISCONNECTED|NEEDS_REAUTH), last_success_at,
  consecutive_failures, last_error, updated_at`.

- **`connector_alerts`** — `id, org_id, seller_account_id, sync_run_id, severity,
  type (AUTH_EXPIRED|REPEATED_FAILURE|RATE_LIMITED), message, acknowledged_at,
  created_at`. Backs "failure alerts"; surfaced on dashboard + 알림 설정 later.

Indexing: `sync_schedules(next_run_at) WHERE enabled` for the poller;
`sync_runs(seller_account_id, started_at DESC)` for history;
`connector_credentials(seller_account_id)` unique.

---

## 6. Security requirements for credentials

Non-negotiables for when credential storage is actually built (not this phase):

1. **No plaintext at rest, ever.** Envelope encryption: a per-record data key
   (AES-256-GCM) encrypts the payload; the data key is wrapped by a master key
   (KEK) held in a KMS in production, or an env-injected master key for
   local/MVP — **never** in source, never in the DB.
2. **Write-only intake.** Credential endpoints accept secrets but **never return
   them.** `GET` on a credential returns metadata only (auth type, masked tail,
   expiry, health) — never the secret.
3. **Decrypt only in the vault service**, only in-memory, only at the moment of a
   sync run. Controllers and the scheduler never see plaintext secrets.
4. **Prefer short-lived tokens.** Where OAuth2 is available, store the
   **refresh token encrypted** and mint access tokens on demand; minimize what
   long-lived material we hold.
5. **Never log secrets.** Redact in logs, errors, and run records. (Mirrors the
   repo-wide "do not expose/print API keys" rule.)
6. **Strict org isolation.** Every credential read is org-scoped from the JWT; no
   cross-tenant access path.
7. **Audit credential use** — who connected, when used, when rotated — in an
   append-only log.
8. **Rotation & revocation** — support re-entering/rotating creds and a hard
   "disconnect" that deletes the encrypted payload.
9. **Transport security** — TLS end to end; secrets only over HTTPS.
10. **Passwords are a special hazard.** Password-based auth (only relevant to
    browser automation, §7) is the worst case: we must hold a reusable secret.
    Prefer cookie/session reuse over storing a password; if a password must be
    stored, same envelope encryption + explicit consent record + the §7 policy.

---

## 7. Browser automation risk policy

Browser automation is **connector class 5 — last resort only.** It exists in the
plan for completeness; it is not built in MVP and must never be a default.

**Hard rules if it is ever enabled for a specific channel:**

- **Explicit, recorded customer consent** per channel before any automation runs,
  with the risks disclosed in plain Korean.
- **Treated as brittle and risky by default.** UI changes break it without
  warning; assume it will need maintenance.
- **No plaintext passwords.** Prefer reusing an authenticated session/cookie over
  re-login; if credentials must persist, envelope-encrypted per §6.
- **Account-safety hazards acknowledged in writing:** 2FA, CAPTCHA, account lock,
  IP/device flags, and **Terms-of-Service violation risk** — legal review per
  channel before enabling.
- **Human-paced, rate-limited, escalating backoff** on soft blocks — never
  hammer-retry (mirrors the Python repo's anti-bot escalation discipline).
- **Opt-in, with a kill-switch.** Off by default; one switch disables all
  automation globally.
- **Auditable & isolated.** Every automation session logged; runs isolated per
  customer; failures degrade the connection (don't silently retry forever).

If a sanctioned connector (1–3) is reachable for a channel, automation is
**not** an option for that channel — priority order is binding.

---

## 8. Next implementation slice after approval

Proposed **Phase 3B — scheduled-collection backbone (no real network, no real
creds).** Prove the machine before touching any platform:

- Flyway `V3` for the §5 tables (extend `sync_jobs`→`sync_runs`, extend
  `sync_cursors`; add `connector_credentials`, `sync_schedules`,
  `connector_capabilities`, `channel_connection_status`, `connector_alerts`).
- Connector contract evolution (capability descriptor + incremental
  `fetch(cursor)`), connector registry, credential vault service (encryption
  path real; exercised with a throwaway key locally).
- Spring `@Scheduled` poller + DB-claim + in-process run executor + retry/backoff
  + rate-limit governor + connection-health tracker.
- A **`MockApiConnector`** that simulates an incremental, paginated, occasionally-
  rate-limited API over seeded data — exercises scheduler → cursor → run → retry →
  dedup → dashboard end to end with **zero external calls and zero stored real
  secrets.**
- Control/read API surface from §4; schedule + connection-status + run-history UI
  (read-mostly; reuses the Phase 2 upload-history list shape).
- Tests: cursor advancement, idempotent re-run (dedup), retry/backoff, poller
  claim safety, credential encrypt/decrypt round-trip.

Then **Phase 3C — first real API connector** (Coupang or Naver), built only
**after** §2's verification items for that channel are confirmed against official
docs, behind a feature flag, against sandbox/test credentials.

**Explicitly NOT in 3B/3C:** AI/RAG, the Python bridge, browser automation,
notifications delivery, and storing any real production credentials before the
vault + consent flows are reviewed.

---

### Open verification checklist (carry into 3C kickoff)
- [ ] Coupang: review (상품평) + inquiry (CS) API existence; order/settlement
      endpoints; auth scheme; rate limits.
- [ ] Naver Commerce API: inquiry/톡톡 scope; review API; settlement endpoints;
      signature algorithm; app-registration model.
- [ ] Cafe24: board/1:1 inquiry endpoints; review-app dependency; OAuth scopes.
- [ ] 11st: is OpenAPI open to all sellers; order/claim/review/inquiry coverage.
- [ ] Reviews across all marketplaces — the engine's input — confirmed or not.
