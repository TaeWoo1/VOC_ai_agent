-- Customer memory retrieval index — the one table behind "무엇을 전에 물어봤고, 그때 뭐라고 답했나"
-- and behind repeated-inquiry detection.
--
-- WHY THIS EXISTS. Until now the repository had no retrieval over past inquiries, past answers, or the
-- reviews related to them: `docs/demo_baseline_recovery_audit_2026-08-21.md` §2.4 found zero embeddings,
-- zero vector stores, zero similarity search — a deliberate absence, fenced by product scope. Scope lock
-- v1.12 (2026-08-21, Operator Graph v1) opens exactly this much of it: retrieval as CONTEXT for the
-- Operator and for an inquiry reply draft. Not a search page, not a new customer-facing surface.
--
-- WHAT IS AND ISN'T STORED. **No customer text.** Every column here is either an id, a date, a boolean,
-- or a value from a CLOSED VOCABULARY the product already displays:
--   * `topic` is an `item_analyses.category` value (배송/교환/제품정보/설치/가격/품질/색상/사이즈/기타 —
--     the vocabulary V5 already documents), copied from the analysis row that the same ingest follow-up
--     just wrote. Nothing new is classified here.
--   * `signature_key` is a `review_issues.signature_key`-shaped "aspect|problem" pair from the existing
--     `IssueSignatureExtractor` port. `IssueSignature`'s own javadoc explains why that key is readable
--     rather than hashed and why it carries no unit text: "extraction is where customer text stops".
-- The body of an inquiry or a review is NOT copied here, and the past ANSWER is not copied either — an
-- answer is re-resolved at read time from `inquiry_reply_drafts` through the existing masking path, the
-- same way 대표 고객 표현 is re-derived rather than duplicated (V31's rule).
--
-- WHY NO VECTOR EXTENSION. Retrieval v1 is deterministic and lexical over the two closed vocabularies
-- above. `IssueSignature` already made this argument for the issue memory — an indexed lookup, "no
-- vector extension, no external call" — and the same argument holds here with an extra edge: an
-- embedding index would mean shipping customer bodies to a vendor in bulk, which is a data-minimization
-- decision this repository makes explicitly and separately (scope lock v1.12 leaves it closed). The
-- retriever is a port, so a different implementation arrives without touching this table.
--
-- ============================================================================================
-- VERSION NUMBERING
-- This file is V47 — the next free version above everything on main (max is V46,
-- V46__service_readiness). Flyway `out-of-order` is NOT enabled, so a version at or below main's max
-- would fail boot on an already-migrated database.
-- ============================================================================================

create table customer_memory_entries (
    id            uuid         primary key,
    org_id        uuid         not null references organizations (id),
    -- INQUIRY | REVIEW — which store `source_id` points into.
    entry_kind    varchar(16)  not null,
    -- inquiries(id) or reviews(id). Deliberately NOT a FK: this index is best-effort follow-on state
    -- and must never be able to block or cascade a change to the collection tables it describes.
    source_id     uuid         not null,
    channel_id    uuid,
    -- products(id) when the source row carried one. NULL is meaningful and is reported as
    -- "unlinked" rather than folded away — see AttentionCoverage / IssueEvidenceSummaryView.
    product_id    uuid,
    -- item_analyses.category (closed vocabulary). NULL when no analysis row exists for the source.
    topic         varchar(32),
    -- "aspect|problem" from IssueSignatureExtractor (closed vocabulary). NULL when no signature matched.
    signature_key varchar(96),
    -- Severity that the problem vocabulary fixes for `signature_key`. NULL when no signature matched.
    severity      varchar(16),
    -- The source row's own date (inquiry/review received date), in UTC calendar days.
    occurred_on   date         not null,
    -- INQUIRY only: whether the inquiry is already answered. Reviews store false.
    answered      boolean      not null default false,
    created_at    timestamptz  not null,
    updated_at    timestamptz  not null
);

-- One entry per source row. Also the idempotency guarantee: re-indexing an already-indexed ingest
-- (a replayed upload, a re-run sync) updates in place rather than duplicating, so an entry can never
-- inflate a repeated-inquiry count.
create unique index uq_customer_memory_entries_source
    on customer_memory_entries (org_id, entry_kind, source_id);

-- The retrieval path: match by signature, then by topic, newest first.
create index ix_customer_memory_entries_signature
    on customer_memory_entries (org_id, signature_key, occurred_on);
create index ix_customer_memory_entries_topic
    on customer_memory_entries (org_id, topic, occurred_on);
-- The product-scoped read behind ProductOps.
create index ix_customer_memory_entries_product
    on customer_memory_entries (org_id, product_id);
