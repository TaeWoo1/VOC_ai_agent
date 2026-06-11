# SellerOps AI — Phase 2: File Upload Connector + First Real Data Loop

Implements the first write path: operators upload CSV/XLSX exports; the backend
parses, normalizes, dedups, persists, and records a sync job; the existing
dashboard/inbox/orders pages then render the new DB data.

Still NOT in scope: real Coupang/Naver APIs, OpenAI, RAG, notifications, report
generation, the Python bridge.

## Architecture (connector/adapter + reusable ingestion)
```
POST /api/uploads (channelId, uploadType, file)
  → FileUploadConnector (adapter: file source)
       → FileParser           CSV (Commons CSV) / XLSX (Apache POI) → ParsedTable
       → RowMapper(type)       canonical records + per-row errors
       → IngestionService      resolve product · dedup · persist        (REUSABLE core)
       → SyncJob recorded      status + total/success/skipped/failed + error
  → IngestResult
```
`IngestionService` + the `Canonical*` records are source-agnostic, so a future
`CoupangConnector`/`NaverConnector` reuses ingestion + dedup instead of writing a
one-off import. `ChannelConnector` marks the connector family.

## Upload types & formats (KO/EN header aliases accepted)
**REVIEW** — `상품명,평점,내용,작성일,리뷰id` (body required; rating/date/id optional)
**INQUIRY** — `상품명,작성자,문의내용,상태,작성일,문의id` (상태: 미답변→UNANSWERED, 답변완료→ANSWERED)
**ORDER_SUMMARY** — `날짜,주문수,매출액` (date required; commas/원 stripped)

## Duplicate prevention
Per row: `external_id` when present → key `(org, channel, external_id)`; else
`content_hash = sha256(channel + product + date + nfc/lowercased/collapsed body)`
→ key `(org, channel, content_hash)`. Order summaries upsert by
`(org, channel, date)`. Enforced by a repository pre-check (to count skips) plus
unique indexes (V2 migration) as a race/idempotency backstop. Re-uploading the
same file ⇒ 0 new rows.

## DB (Flyway `V2__file_ingest.sql`, additive — V1 untouched)
`reviews`/`inquiries` += `external_id`, `content_hash` (+ partial unique indexes);
`order_daily_summaries` unique `(org, channel, summary_date)`; `products` unique
`(org, sku)`; `sync_jobs` += `upload_type, total_rows, success_rows,
skipped_rows, failed_rows, error_message`.

## Frontend
Channels page → 파일 업로드 button routes to `/upload?channelId=…`. The upload
page: channel select · 리뷰/문의/주문·매출 segmented · file picker · 업로드 →
result panel (전체/저장/중복/실패 + sample row errors) → 대시보드에서 확인하기.
Uploads call the live backend (no mock fallback for a mutating action).

## Tests
- Pure unit (offline): `ContentHashTest`, `RowMapperTest`, `FileParserTest`.
- Persistence slice (H2, PostgreSQL mode, Flyway off): `IngestionServiceTest` —
  dedup by external id, dedup by content hash, product resolve-once, order upsert.
- Testcontainers-Postgres (real Flyway SQL) is deferred — needs Docker.
