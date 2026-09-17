-- Knowledge & Intelligence Closure v1.
--
-- 1. seller_guidance — what the seller said to remember when they corrected a draft or a recommendation
--    ("다음에도 참고"). It is the seller's own sentence plus the topic signature of the question it was about
--    (never the customer's question itself), scoped to one product or the whole company. It is context a later
--    investigation or draft may be shown; it is never a policy and nothing here rewrites a rule.
--
-- 2. proactive_case.knowledge_used — which company knowledge an investigation was shown and cited, as entry
--    references and labels (JSON). No knowledge text: the text stays in the row that owns it and is re-read.

create table if not exists seller_guidance (
    id                  uuid          primary key,
    org_id              uuid          not null references organizations (id),
    product_id          uuid          references products (id),
    scope               varchar(16)   not null check (scope in ('ORG', 'PRODUCT')),
    kind                varchar(32)   not null check (kind in ('DRAFT_CORRECTION', 'DECISION_CORRECTION')),
    subject_kind        varchar(16)   not null check (subject_kind in ('INQUIRY', 'REVIEW')),
    origin_case_id      uuid,
    corrected_action    varchar(32),
    topic_signature     varchar(400)  not null,
    guidance            text          not null,
    normalized          text          not null,
    active              boolean       not null default true,
    author_user_id      uuid,
    author_name         varchar(120),
    data_origin         varchar(16)   not null default 'REAL',
    created_at          timestamptz   not null,
    updated_at          timestamptz   not null,
    constraint ck_seller_guidance_scope_shape
        check ((scope = 'PRODUCT' and product_id is not null) or (scope = 'ORG' and product_id is null))
);

create index if not exists idx_seller_guidance_org on seller_guidance (org_id, active, created_at desc);

alter table proactive_case add column if not exists knowledge_used text;
