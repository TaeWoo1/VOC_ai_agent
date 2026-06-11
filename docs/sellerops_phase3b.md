# SellerOps AI — Phase 3B: Scheduled Collection Backbone (MockApiConnector)

**Mode:** Design / planning. This document is the deliverable. No real channel
APIs, no browser automation, no real credentials, no OpenAI/RAG, no notification
delivery. Phase 3B **code** is a separate, later approval — this doc records the
design only.

> **Goal of Phase 3B:** prove the automatic-collection architecture end-to-end
> with **mock data and zero external calls** before touching any real platform:
> `sync schedule → @Scheduled poller → connector registry → MockApiConnector →
> Canonical* DTOs → IngestionService → sync cursor → sync run → dashboard/inbox/
> orders update.`
>
> **References:** automatic-collection strategy in `docs/sellerops_phase3a.md`
> (§8 proposed this slice); file-upload connector in `docs/sellerops_phase2.md`;
> frontend direction in `docs/sellerops_ui_reference.md`.

---

## Context

Phase 3A established the automatic-collection *strategy*: a 5-tier connector
priority (API > export > email > manual upload > browser automation), a
13-channel capability matrix with ✓/❓ verification flags, and a proposed next
slice — Phase 3B: prove the scheduled-collection backbone with a
`MockApiConnector` before any real integration. This document turns that into a
concrete, reviewable design.

The product principle is unchanged: SellerOps AI is **not** a manual CSV upload
tool. The core loop is *connect a channel once → set a sync schedule → SellerOps
collects reviews/inquiries/orders/sales/products automatically on cadence.* File
upload remains the manual fallback/demo path (Phase 2).

### Existing seam this builds on (verified in code)
- `connector/ChannelConnector.java` — today just `String kind()`. The connector family marker.
- `connector/FileUploadConnector.java` — push/operator-initiated; parses → maps → `IngestionService` → records a `SyncJob`. **Stays exactly as-is** (manual fallback).
- `ingest/IngestionService.java` — source-agnostic `ingestReviews/ingestInquiries/ingestOrderSummaries(orgId, channelId, List<Canonical*>) → IngestOutcome`; per-row tx, external-id + content-hash dedup, idempotent. **Reused unchanged.**
- `ingest/canonical/Canonical{Review,Inquiry,OrderSummary}.java` — the DTOs `MockApiConnector` emits. **Reused unchanged.**
- `sync/SyncJob.java` + `sync_jobs` table — existing run record (`org_id, channel_id, job_type, upload_type, status, started/finished_at, total/success/skipped/failed_rows, error_message`). **Extended additively**, not replaced.
- `selleraccount/SellerAccount.java` — `org_id, channel_id, alias, connection_status (ChannelStatus enum), last_synced_at, is_file_upload`. The scheduling/credential/health rows hang off `seller_account_id`.
- Migrations are additive-only (`V1__init.sql`, `V2__file_ingest.sql`, `if not exists`). Phase 3B adds `V3__scheduled_collection.sql` in the same style.

---

## 1. Current state

- **Shipped:** auth/JWT, 13-channel reference data + Channels page, dashboard/inbox/orders read endpoints over seeded data, Phase 2 file-upload connector (parse → dedup → persist → `SyncJob`), upload-history UI.
- **The reuse seam is in place** (above): `ChannelConnector`, source-agnostic `IngestionService`, `Canonical*` DTOs, `SyncJob`/`sync_jobs`.
- **Not built:** any scheduling, cursors-in-use, credential storage, connection-health tracking, retry/backoff, alerts, or any non-file connector. `sync_cursors` was named in the Phase 1 plan but is **not** in the current schema (V1/V2) — Phase 3B introduces it for real.
- **Constraints in force:** no real API calls, no real creds, no browser automation, no OpenAI/RAG, no notification *delivery*.

## 2. Phase 3B scope

**In:** connector contract evolution (capability descriptor + incremental `fetch`); connector registry; `MockApiConnector` (paginated, cursor-based, occasionally rate-limited/erroring, over seeded mock data, zero network); `sync_schedules`; `sync_cursors`; `@Scheduled` poller with DB-claim; in-process run executor reusing `IngestionService`; retry/backoff; rate-limit governor; `channel_connection_status` tracking; `connector_alerts` placeholder rows (recorded, **not delivered**); manual "지금 수집하기" trigger + manual retry; read APIs for schedule/status/run-history/capabilities; frontend connection panel, schedule settings, manual trigger, recent-sync history, last/next-sync display, and a clear 자동 수집 vs 파일 업로드 백업 distinction.

**Out (Phase 3C+):** real Coupang/Naver/any platform API; real credential intake/use; browser automation; OpenAI/RAG; notification *sending* (email/SMS/push); the Python analysis bridge.

**Credential vault decision:** build the `connector_credentials` table + a `CredentialVault` service with a *real* envelope-encryption round-trip exercised by a local throwaway master key (so the security path is proven and tested), but **`MockApiConnector` needs no credentials** and no real secrets are ever stored. This satisfies Phase 3A §6 without holding production material. (Alternative — design-only, no table — is weaker; we'd re-litigate encryption in 3C.)

**`sync_jobs` decision:** **extend** `sync_jobs` additively (add `seller_account_id`, `data_type`, `trigger`, `attempt`, `next_retry_at`, `rate_limited`) rather than add a parallel `sync_runs` table. The Phase 2 upload path keeps working (it just sets `trigger=UPLOAD`); the scheduled path sets `trigger=SCHEDULED|MANUAL|RETRY`. A `SyncRunView` is added alongside the existing `SyncJobView`. Keeps one run history, one repository, one UI list.

## 3. Backend design

New package `com.sellerops.collect` (scheduling/execution), plus additions to `connector/`, `sync/`, and a new `credential/`:

- **Connector contract evolution.**
  - `ChannelConnector` gains `default ConnectorCapabilities capabilities()` (which `DataType`s via which connector class) — `FileUploadConnector` overrides to declare all types via class-4/manual.
  - New `PullConnector extends ChannelConnector` with `FetchPage fetch(SellerAccountRef account, DataType type, SyncCursor cursor, int limit)` returning `(List<Canonical*> batch, String nextCursor, boolean hasMore)`. Push-style `FileUploadConnector` does **not** implement `PullConnector` and is untouched.
  - `DataType` enum: `REVIEW, INQUIRY, ORDER_SUMMARY` (mirrors `UploadType`; `PRODUCT`/`SALES` deferred — sales rides `ORDER_SUMMARY`).
- **`ConnectorRegistry`** — resolves the highest-priority available connector for a `(channelCode)`; in 3B it maps every non-file channel to `MockApiConnector` and the file channel to `FileUploadConnector`. Keyed so the 3C real connectors slot in.
- **`MockApiConnector implements PullConnector`** — deterministic, seeded generator that *behaves like a future real API*: returns pages of `Canonical*` records keyed off the cursor (e.g. an incrementing timestamp/offset), reports `hasMore`, occasionally returns a simulated `429`/rate-limit and a transient error (controlled by a fixed pseudo-random seed per account+type so tests are deterministic — **no `Math.random`**). Zero network, zero secrets.
- **`SyncRunExecutor`** (`collect/`) — per claimed schedule: resolve connector via registry → (vault decrypt is a no-op for mock) → loop `fetch(cursor, limit)` → route batch to `IngestionService.ingest{Reviews,Inquiries,OrderSummaries}` → advance `sync_cursors` after each successful page (per-page persistence, so a mid-stream failure keeps earlier rows) → on `hasMore=false` finish the run `SUCCESS/PARTIAL`; on rate-limit/error apply §8 policy and finish `FAILED`/schedule retry. Updates `SellerAccount.lastSyncedAt` and `channel_connection_status`.
- **`SyncScheduler`** (`collect/`) — `@Scheduled(fixedDelayString=…)` poller; see §7.
- **`RateLimitGovernor`** — per-connector token bucket; honors a `Retry-After`-style hint from the `FetchPage`/exception; drives backoff. Mirrors the Python repo's "anti-bot signals escalate, not retry" discipline.
- **`ConnectionHealthTracker`** — writes `channel_connection_status` (last success, consecutive failures, state CONNECTED/DEGRADED/EXPIRED/DISCONNECTED). After N consecutive failures → DEGRADED + a `connector_alerts` row.
- **`CredentialVault`** (`credential/`) — sole reader/writer of `connector_credentials`; AES-256-GCM envelope encryption, local master key from env (never in source/DB), write-only intake, decrypt only in-memory at run time, masked-metadata reads. Not exercised by mock runs; present + unit-tested for the round-trip.
- **`AlertService`** — records `connector_alerts` rows only (**no delivery** in 3B).

## 4. Frontend design

Reuses Phase 2 Tailwind components and the upload-history list shape; ReactVibe blocks per `docs/sellerops_ui_reference.md` are references, not installs.

- **Channel detail / connection panel** — on the Channels card (or a `/channels/:id` detail): connection state badge (자동 수집 연결됨 / 연결 안 됨 / 일시 중단), `DataBadge`s, last-synced + next-sync, and the priority-aware action. Reinforces *auto-collection is the goal, upload is backup*.
- **Sync schedule settings** — per (seller account × data type) enable toggle + cadence picker (e.g. 매시간 / 6시간 / 매일 + 시각). Writes `PUT …/schedule`.
- **"지금 수집하기" manual trigger** — button that `POST`s a manual run; shows a running→done toast; refreshes history. Distinct from the Upload page's file picker.
- **Recent sync history** — reuses the upload-history list, now showing `trigger` (자동/수동/재시도/업로드) + status + counts + time; reads the extended `/api/sync-runs`.
- **Last synced / next sync display** — on card and panel; "마지막 수집 N분 전 · 다음 수집 오후 3시".
- **Clear 자동 수집 vs 파일 업로드 백업 distinction** — the connection panel headlines 자동 수집; the file path is labeled a 백업 방식 (continuing the Phase 2.5 copy). Never present upload as the channel's final integration.
- **No new heavy motion** — subtle state-change transitions only, per the UI doc §5.

## 5. DB migration proposal — `V3__scheduled_collection.sql` (additive, `if not exists`)

All org-scoped, UUID PK, `created_at`/`updated_at`, matching V1/V2.

- **Extend `sync_jobs`:** `seller_account_id uuid`, `data_type varchar(40)`, `trigger varchar(20) not null default 'UPLOAD'`, `attempt int not null default 1`, `next_retry_at timestamptz`, `rate_limited boolean not null default false`. (Upload path keeps working via the default.)
- **`sync_cursors`** *(new — not in current schema):* `id, org_id, seller_account_id, data_type, cursor_key, cursor_value, updated_at`; unique `(org_id, seller_account_id, data_type, cursor_key)`.
- **`sync_schedules`:** `id, org_id, seller_account_id, data_type, cadence_kind (INTERVAL|CRON), interval_minutes, cron_expr, enabled bool, next_run_at, last_run_at, paused_reason`; index `(next_run_at) where enabled`.
- **`connector_capabilities`** *(seed/reference):* `channel_code, connector_class, data_type, supported bool, verification_status (CONFIRMED|NEEDS_VERIFICATION|UNSUPPORTED), notes`. Seeded from Phase 3A §2 — most rows `NEEDS_VERIFICATION` so the UI tells the truth.
- **`channel_connection_status`:** `id, org_id, seller_account_id (unique), state, last_success_at, consecutive_failures int, last_error, updated_at`.
- **`connector_alerts`:** `id, org_id, seller_account_id, sync_job_id, severity, type (AUTH_EXPIRED|REPEATED_FAILURE|RATE_LIMITED), message, acknowledged_at, created_at`.
- **`connector_credentials`:** `id, org_id, seller_account_id (unique), connector_class, auth_type (HMAC|OAUTH2|API_KEY|PASSWORD), encrypted_payload bytea, encryption_key_id, iv, token_expires_at, refresh_token_enc bytea, last_rotated_at, created_by`. **No plaintext column ever.**
- Indexes: `sync_jobs(seller_account_id, started_at desc)`, `sync_schedules(next_run_at) where enabled`, uniques on cursors/status/credentials.

## 6. API endpoint proposal (read + control only; no collection logic exposed)

- `GET /api/seller-accounts/{id}/schedule` · `PUT /api/seller-accounts/{id}/schedule` — read/set cadence + enabled per data type.
- `POST /api/seller-accounts/{id}/sync` — manual "지금 수집하기" (enqueues a `trigger=MANUAL` run).
- `GET /api/seller-accounts/{id}/connection-status` — health state, last/next sync, consecutive failures.
- `GET /api/sync-runs` — extends the existing `/api/sync-jobs` view with `trigger/data_type/attempt`; backs the history list.
- `POST /api/sync-runs/{id}/retry` — operator re-enqueue of a FAILED/PARTIAL run (`trigger=RETRY`).
- `GET /api/channels/{code}/capabilities` — from `connector_capabilities`; drives honest UI badges.
- `POST /api/seller-accounts/{id}/credentials` — **write-only** intake stub (vault-encrypted); returns masked metadata only. *Not required by `MockApiConnector`; included to prove the §6 security path.*

## 7. Scheduler behavior

- Spring `@Scheduled(fixedDelay)` tick every N seconds/minutes (config; e.g. 60s in dev).
- Each tick: `select … from sync_schedules where enabled and next_run_at <= now() for update skip locked` → claim a bounded batch; multi-instance-safe (no double-run).
- For each claimed schedule: execute a `SyncRunExecutor` run (in-process executor for MVP — Quartz/a durable queue is a later upgrade, explicitly not 3B). Compute `next_run_at` from cadence; set `last_run_at`.
- The paused Python `scheduler/queue/workers` scaffolding is a different stack and is **not** reused.

## 8. Retry/backoff behavior

- **Rate limit (simulated 429 / Retry-After):** governor pauses that connector's bucket; run finishes with `rate_limited=true`, status `PARTIAL` if some pages landed else `FAILED`; reschedule after the hinted delay. Never hammer-retry (mirrors anti-bot escalation discipline).
- **Transient error:** bounded exponential backoff (e.g. 1m → 5m → 25m, max attempts ~4); each retry is a new run row with incremented `attempt` and `trigger=RETRY`, `next_retry_at` set.
- **Exhausted retries:** mark `channel_connection_status` DEGRADED, raise a `REPEATED_FAILURE` `connector_alerts` row (recorded, not delivered). Operator can manual-retry via the endpoint.
- **Idempotency:** because `IngestionService` dedups (external-id/content-hash) and cursors only advance on a *persisted* page, a retried/overlapping run never double-writes.

## 9. Test plan

- **Unit:** `MockApiConnector` pagination + deterministic rate-limit/error injection; cursor advancement; `RateLimitGovernor` token bucket; backoff schedule; `CredentialVault` encrypt→decrypt round-trip + masked-read; capability resolution in `ConnectorRegistry`.
- **Persistence slice (H2, Postgres mode, like `IngestionServiceTest`):** a full mock run advances the cursor, persists canonical rows, and a re-run is idempotent (all-skipped, status SUCCESS); a mid-stream simulated failure keeps earlier pages and records `PARTIAL`.
- **Poller claim safety:** two concurrent ticks don't double-run the same schedule (`SKIP LOCKED`).
- **Retry path:** forced repeated failure → DEGRADED + `REPEATED_FAILURE` alert row; manual retry re-enqueues.
- **Web slice:** schedule GET/PUT, manual sync trigger, connection-status, `/sync-runs`, capabilities — auth-gated, org-scoped.
- **Regression:** Phase 2 upload path unaffected (`trigger=UPLOAD` default; existing upload + dedup tests still green).
- **Commands:** `cd backend && ./gradlew test`; frontend `npm run build`; Testcontainers-Postgres (real Flyway V3) deferred (needs Docker), as in Phase 2.

## 10. Implementation slices (each reviewable; for the *future* code phase)

1. **V3 migration + entities/repos** — extend `sync_jobs`; add `sync_cursors`, `sync_schedules`, `connector_capabilities` (+ seed), `channel_connection_status`, `connector_alerts`, `connector_credentials`. Boots; capabilities seeded.
2. **Connector contract + registry + `MockApiConnector`** — `PullConnector`, `DataType`, `ConnectorCapabilities`, registry; mock generator with deterministic injection. Unit-tested.
3. **Run executor + cursors + IngestionService reuse** — `SyncRunExecutor`, cursor advance, run-row lifecycle, health tracker. Persistence-slice tested (idempotent re-run).
4. **Scheduler + rate-limit + retry/backoff + alerts** — `@Scheduled` poller w/ claim, governor, backoff, `connector_alerts` rows. Claim-safety + retry tested.
5. **CredentialVault** — envelope encryption + write-only intake endpoint + masked reads. Round-trip tested. (Mock needs none.)
6. **Control/read API surface** — schedule, manual sync, connection-status, `/sync-runs`, capabilities, retry. Web-slice tested.
7. **Frontend** — connection panel, schedule settings, "지금 수집하기", recent-sync history, last/next-sync, 자동/백업 distinction. `npm run build`.

## 11. Deferred to Phase 3C (and beyond)

- **First real connector** (Coupang or Naver) — built only **after** the Phase 3A §2 verification items for that channel (review/inquiry/order/settlement endpoints, auth scheme, rate limits) are confirmed against official docs; behind a feature flag; against sandbox/test credentials.
- Real credential intake/rotation UX and KMS-backed master key (3B uses a local throwaway key).
- Quartz / durable queue (3B uses `@Scheduled` + in-process executor).
- Export/email connectors (classes 2–3); browser automation (class 5, consent-gated, Phase 3A §7 policy).
- Notification **delivery** (3B only records alert rows); OpenAI/RAG; the Python analysis bridge.
