-- Phase: REVIEW content_hash v2 — record which dedup-key formula produced a row.
-- Additive only (no drops). IF NOT EXISTS keeps re-runs/partial-applies safe.
--
-- v1 (default) = SHA-256(channel|product|date|body); v2 also folds in rating and
-- is applied ESM+ (GMARKET) channel-first. Existing rows are v1 by the default, so
-- NAVER and every other channel keep their stored content_hash untouched (no backfill).
alter table reviews add column if not exists dedup_key_version integer not null default 1;
