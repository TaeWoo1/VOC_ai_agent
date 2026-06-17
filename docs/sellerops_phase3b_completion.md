# SellerOps Phase 3B — Completion & Verification Report

Date: 2026-06-12. Branch `feature/review-ops-industrial`, verified at HEAD
`144a8b7`. Phase 3B built the **scheduled-collection backbone** on a
`MockApiConnector` — zero external calls, zero real credentials — covering the
full backend path (schedule → poller → claim → executor → ingestion → cursor →
health → control API). The frontend ships and typechecks, but its browser-level
behavior was not exercised in this verification (see §4).

> **Provenance.** Everything in §2 was observed in a **one-off manual
> verification session** on 2026-06-12: a disposable Dockerized Postgres 16 on
> a non-default port, created empty and destroyed afterwards. The session's
> numbers (row counts, byte sizes, claim splits) are records of that run — they
> are not reproducible from artifacts checked into the repo, and none of the
> Postgres-specific behavior is enforced by CI (tests run on H2). Treat §2 as
> evidence the design works on real Postgres as of this commit, not as a
> standing guarantee.

---

## 1. Delivered slices

| Slice | Commit | Contents |
|---|---|---|
| Plan doc | `665d883` | `docs/sellerops_phase3b.md` design plan |
| Doc refinement | `34da015` | Official-doc capability/auth/rate-limit corrections |
| 1 — Schema | `2cf3a62` | `V3__scheduled_collection.sql`, entities/repos, `SyncJob` additive fields |
| 2 — Connectors | `d8ce448` | `DataType`, `ConnectorCapabilities`, `PullConnector`, `ConnectorRegistry`, `MockApiConnector` |
| 3 — Executor | `47b8907` | `SyncRunExecutor`: fetch-loop → `IngestionService` → per-page cursor → run/health record |
| 4 — Scheduler | `b7edf96` | `SyncScheduleClaimer` (`FOR UPDATE SKIP LOCKED`), `SyncScheduleRunner` (backoff/escalation/alert rows), `SyncScheduler` (off by default) |
| 5 — Vault | `5328826` | `CredentialVault` AES-256-GCM envelope encryption, write-only intake, masked reads |
| 6 — Control API | `2dbf33c` | Schedule GET/PUT, manual sync, retry, connection-status, `/api/sync-runs` + filters, capabilities, credential intake/metadata; `V4` unique schedule index |
| 7 — Frontend | `144a8b7` | `/channels/:accountId` 자동 수집 관리 panel: health, schedule settings, 지금 수집하기, run history, capability gating |

## 2. What was verified (one-off session — see provenance note above)

On the disposable Postgres 16 (fresh DB, then destroyed):

- **Flyway V1→V4 applied cleanly** on real Postgres. All Phase 3B tables exist
  (`sync_schedules`, `connector_capabilities`, `channel_connection_status`,
  `connector_alerts`, `connector_credentials`); `sync_jobs` has the six
  additive columns; `sync_cursors` kept its additive shape (legacy
  `channel_id` nullable, new `seller_account_id`/`data_type`);
  `uq_sync_schedules_account_data_type` present; 10 capability rows seeded
  (Coupang/Naver, REVIEW = UNSUPPORTED).
- **`FOR UPDATE SKIP LOCKED` claim is concurrency-safe on real Postgres**:
  two concurrent sessions over 4 due schedules claimed 2 + 2 with zero
  overlap and no blocking; future and disabled rows ignored; claimed rows
  advanced provisionally.
- **The live poller ran a real scheduled collection**: with the scheduler
  enabled (5s poll), an operator `PUT /schedule` became a `trigger=SCHEDULED`
  run within one tick — 45 mock inquiries ingested, cursor `45`, health
  CONNECTED, `nextScheduledAt` ≈ +60m. Broken schedules (missing account)
  failed per-schedule without blocking the batch and without job rows.
- **Control API smoke** (seeded demo org): capabilities; schedule PUT
  (enabled-immediately semantics) and GET; REVIEW-on-Coupang PUT correctly
  rejected 400; manual sync (30 order summaries); `/api/sync-runs?sellerAccountId=`
  filter; connection-status.
- **Credential vault on real Postgres**: POST intake → GET returns metadata
  only (no plaintext/ciphertext/IV/refresh token in any response); at rest the
  payload is a 140-byte AES-256-GCM envelope containing no plaintext bytes.
- **Test suites** (same session, local machine): backend `./gradlew test`
  93 passed / 0 failed (the 93 `@Test` methods are checked in; the pass result
  is a session observation, not a CI record), `bootJar` successful; frontend
  `npm run build` (tsc + vite) clean.

## 3. What is mock-only

- **All collected data comes from `MockApiConnector`** — deterministic
  synthetic reviews/inquiries/order summaries. No marketplace is contacted.
- Rate-limit and failure behavior is simulated (opt-in deterministic throttle
  injection), not observed from a real API.
- `PRODUCT` / `SALES` data types are supported-but-empty in the mock; routing
  for them in `SyncRunExecutor` is deferred.

## 4. What is not yet real

- No real Coupang/Naver (or any) connector; no real credential is stored
  anywhere.
- No OAuth token refresh execution; no KMS — the vault master key is a local
  env-supplied throwaway (`SELLEROPS_VAULT_MASTER_KEY`).
- Alert rows are recorded only; no notification delivery (email/SMS/push).
- No durable queue/Quartz — in-process `@Scheduled` poller; crash between
  claim and run skips that occurrence until the provisional `next_run_at`
  (at-most-once per tick, by design).
- CRON cadence is explicitly deferred (claimed CRON schedules pause with a
  reason); cadence is INTERVAL-only, operator floor 15 minutes.
- Frontend browser-level smoke was **not run** (no browser automation by
  scope); UI behavior is covered indirectly by the API smoke + typecheck.
  Manual click-through recommended before any demo.

## 5. Known risks

1. **Live connector not implemented** — the entire value of 3B is plumbing;
   data realism arrives only with Phase 3C.
2. **Real-Postgres verification: passed once, manually** (this report,
   disposable DB) — CI still tests on H2, so Postgres behavior is not
   continuously verified and could regress silently. Testcontainers in CI
   remains a worthwhile follow-up.
3. **SKIP LOCKED verification: passed once, manually** at the SQL level with
   two concurrent sessions; no checked-in test exercises it, and a full
   multi-instance app-level soak was not run.
4. **Scheduler is off by default** (`sellerops.collect.scheduler-enabled=false`)
   — nothing collects until ops flips it; flipping it is a deliberate act.
5. **Credential vault uses a local master key only** — no KMS, no rotation
   tooling; acceptable for mock-era, must be revisited before real credentials.
6. **Coupang/Naver REVIEW data is unsupported via official APIs** (prior
   official-doc verification; seeded as UNSUPPORTED). Reviews stay
   capability-gated; the sanctioned fallback order is official API → official
   export → email/report attachment → manual file upload. Browser automation
   remains last resort only.
7. Alert dedup is best-effort across instances (exists-then-insert); a unique
   partial index can accompany the future alert read/ack API.

## 6. Recommended Phase 3C first step

**Naver Commerce API first.** Rationale: per the verified capability matrix it
has the broadest CONFIRMED coverage (`ORDER_SUMMARY`, `PRODUCT`, `SALES` vs
Coupang's `ORDER_SUMMARY`, `PRODUCT` — `DataType` enum values), a documented
OAuth2 client-credentials flow that exercises the vault
(token + expiry + refresh path) the way 3C needs anyway, and a published ~2 rps
token-bucket limit that maps directly onto the existing rate-limit handling.
Build it behind the capability gate as connector class `API`, feature-flagged,
starting with `ORDER_SUMMARY` (lowest-risk, already end-to-end through
ingestion), then PRODUCT/SALES, then INQUIRY once its NEEDS_VERIFICATION items
are confirmed. Coupang follows second with its HMAC scheme.
