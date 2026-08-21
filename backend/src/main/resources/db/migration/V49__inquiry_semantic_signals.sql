-- Semantic inquiry signatures — so "반복 문의" is a fact about customers and not about a keyword list.
--
-- WHY THIS EXISTS. Measured on the demo org 2026-08-21: the deterministic extractor produced
-- signatures for 0 of 3,220 real inquiries. `contracts/review-eval/naver/v1/RUBRIC.md` already
-- diagnosed why (surface-form rigidity, not vocabulary breadth) and `IssueSignatureExtractor` was
-- built as a PORT for exactly this successor. This migration adds only what the successor needs to be
-- cheap and honest; the aggregation, windows and read model are the ones V47 already has.
--
-- ============================================================================================
-- VERSION NUMBERING — V49, the next free version above V48 (this package's own first migration).
-- ============================================================================================
--
-- NO CUSTOMER TEXT. `inquiry_signature_cache` stores a HASH of the classified text and the closed-
-- vocabulary labels that came back. There is no body column and none can be added without changing
-- this file. The hash exists so a body is sent to a model AT MOST ONCE, ever — a re-run, a backfill
-- page replay, and a re-collection all hit the cache instead of re-exposing the same customer
-- sentence. That is a privacy control before it is a cost control.

-- Provenance on the index rows, so a SEMANTIC signature and a RULE_BASED one can coexist and be told
-- apart — the same reason review_issues carries extractor_kind/extractor_version (V31).
alter table customer_memory_entries add column if not exists extractor_kind varchar(24);
alter table customer_memory_entries add column if not exists extractor_version varchar(32);
create index if not exists idx_customer_memory_extractor
    on customer_memory_entries (org_id, entry_kind, extractor_kind);

create table if not exists inquiry_signature_cache (
    id                 uuid         primary key,
    org_id             uuid         not null references organizations (id),
    -- sha256 of the normalized (title + body) text. One-way; the text is not recoverable from it.
    content_hash       varchar(64)  not null,
    -- <category>:<askKind>, e.g. 제품정보:규격. Both halves are closed vocabularies that already
    -- appear on screen (ItemAnalysisCategories x InquiryAskKind). Null = the model declined or the
    -- answer was off-vocabulary, which is stored so we do not ask again for the same text.
    signature_key      varchar(96),
    topic              varchar(32),
    ask_kind           varchar(32),
    -- Null on a miss. NORMAL/HIGH/LOW — the ask kind's fixed severity, never a per-inquiry judgement.
    severity           varchar(16),
    extractor_kind     varchar(24)  not null,
    extractor_version  varchar(32)  not null,
    -- The model actually asked, so a re-measure can tell which rows a given model produced.
    provider_version   varchar(64),
    created_at         timestamptz  not null,
    updated_at         timestamptz  not null
);
-- One classification per (org, text). The org is in the key because the same sentence in two orgs is
-- two orgs' data and must never share a row.
create unique index if not exists uq_inquiry_signature_cache
    on inquiry_signature_cache (org_id, content_hash);
