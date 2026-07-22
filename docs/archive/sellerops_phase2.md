# SellerOps AI — Phase 2: File Upload Connector + First Real Data Loop

Implements the first write path: operators upload CSV/XLSX exports; the backend
parses, normalizes, dedups, persists, and records a sync job; the existing
dashboard/inbox/orders pages then render the new DB data.

**Manual file upload is NOT the long-term core product experience.** It is an
initial demo/validation path, a fallback connector, and a backup for when
automatic collection is unavailable. The intended product is: the operator logs
in once, connects seller-center channels, sets a sync schedule, and SellerOps
then collects reviews/inquiries/orders/sales automatically — the operator should
not have to visit each seller center or repeatedly upload files. See
**Long-term collection strategy** below.

Still NOT in scope: real Coupang/Naver APIs, OpenAI, RAG, notifications, report
generation, the Python bridge.

## Long-term collection strategy

> **⚠️ 대체됨 (2026-07-07).** 아래 5단계 사다리(특히 "browser automation = last resort")는
> `docs/multi-channel-connector-roadmap.md` §5의 교정된 전략으로 대체되었다: 리뷰·문의처럼
> 공식 API가 없는 데이터에서는 판매자 승인 브라우저/에이전트 자동화·공식 export 자동화가
> 정당한 1차 경로이며, manual upload는 임시 브리지다. 아래 원문은 시점 기록으로만 보존한다.

The product goal is automatic, scheduled collection per channel. File upload is
deliberately the lowest-priority connector — present from Phase 2 because it is
the only one we can ship without per-channel integration work, but it is a
fallback, not the destination. Connectors are prioritized as follows:

1. **Official API connector** — first priority. OAuth / API key / token where
   available; scheduled sync; sync cursor; retry + rate-limit handling.
2. **Official export/report connector** — second priority. Use seller-center
   export/report mechanisms where legally and technically available; automatic
   download or scheduled report ingestion if supported.
3. **Email/report attachment connector** — parse seller-center alert/report
   emails or their attachments where available.
4. **Manual file upload connector** — fallback and demo path. The connector
   shipped in this phase. Not the primary intended workflow.
5. **Browser automation connector** — last resort only. Requires explicit
   customer consent and must be treated as risky and brittle: do not store
   plaintext passwords, and account for 2FA, CAPTCHA, account lock, ToS, and
   UI-change risk. Documented here for completeness; not to be built casually.

> **Browser automation is last-resort only.** It is brittle and risky and must
> never be the default integration path. Prefer 1–3; reach for 5 only when no
> safer connector is possible and the customer has explicitly consented.

Neither the API connectors (1–3) nor browser automation (5) are implemented in
this phase. The connector/adapter seam (`ChannelConnector` + the reusable
`IngestionService` + `Canonical*` records) exists so these higher-priority
connectors can be added later without rewriting ingestion or dedup.

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

Ready-to-use sample files live in `docs/sample_uploads/` (`review_sample.csv`,
`inquiry_sample.csv`, `order_summary_sample.csv`) and the same content is offered
via the **샘플 CSV 다운로드** button on the upload page. The review sample
exercises external-id dedup + content-hash dedup (re-upload → all skipped,
status SUCCESS); the inquiry sample includes a duplicate and one invalid (empty
body) row to demonstrate a PARTIAL result.

## Smoke (verified)
End-to-end HTTP smoke against local PostgreSQL (Flyway V1+V2 applied, seeder
run): login → upload REVIEW (success 3 / skip 2) → re-upload (skip 5, **SUCCESS**)
→ upload INQUIRY (**PARTIAL** 2/1/1, error on file row 5) → inbox shows the new
inquiries → upload ORDER_SUMMARY (success 3) → dashboard/orders reflect the data
(채널별 매출 비중 includes 파일 업로드 채널) → `/api/sync-jobs` lists all runs.

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
