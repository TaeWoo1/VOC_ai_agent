-- Phase: per-item analysis foundation — rule-based (AI-ready) analysis of inbox
-- items (inquiries + reviews). Additive only; IF NOT EXISTS keeps re-runs safe.
-- Polymorphic (source_type, source_id) references either an inquiry or a review;
-- one analysis row per source item per org (idempotent skip-if-exists).
create table if not exists item_analyses (
    id uuid primary key,
    org_id uuid not null,
    source_type varchar(20) not null,          -- INQUIRY | REVIEW
    source_id uuid not null,
    summary varchar(200) not null,             -- PII-safe templated phrase (never raw body)
    category varchar(40) not null,             -- 배송/교환/제품정보/설치/가격/품질/색상/사이즈/기타
    sentiment varchar(20) not null,            -- POSITIVE | NEUTRAL | NEGATIVE
    urgency varchar(20) not null,              -- LOW | NORMAL | HIGH
    recommended_action varchar(40) not null,   -- 답변 필요 / 확인 필요 / 상세페이지 개선 후보 / FAQ 후보
    analyzer_kind varchar(20) not null,        -- RULE_BASED (honest method marker)
    analyzer_name varchar(60) not null,        -- e.g. rule-based
    analyzer_version varchar(40) not null,     -- e.g. rules-v1
    model_name varchar(80),                    -- reserved for a future AI provider; null here
    prompt_version varchar(40),                -- reserved for a future AI provider; null here
    source_content_hash varchar(64),           -- snapshot hash; reserved for future re-analysis-on-change
    created_at timestamptz not null,
    updated_at timestamptz not null
);

create unique index if not exists uq_item_analyses_source
    on item_analyses (org_id, source_type, source_id);
create index if not exists ix_item_analyses_org
    on item_analyses (org_id);
