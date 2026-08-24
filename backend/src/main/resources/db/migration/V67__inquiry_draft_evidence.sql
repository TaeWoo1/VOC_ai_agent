-- What a generated reply draft was grounded in.
--
-- Inquiry Draft v1 answers a customer question from the seller's own product knowledge. A draft that
-- cites nothing and a draft that cites two passages look identical in inquiry_reply_draft, which
-- stores only the text — so "이 초안의 근거가 무엇인가" was answerable only by re-running the
-- retrieval and hoping it returned the same thing. These rows make it a fact instead of a
-- reconstruction: one row per passage that was actually put in front of the model, bound to the exact
-- draft version whose fingerprint the approval will later bind to.
--
-- Deleted with its draft (a draft version is append-only, so these are too: no row here is ever
-- updated). The evidence is keyed to (work_item_id, draft_version) rather than to a draft UUID
-- because that is the pair everything downstream — the approval, the publish, the audit — speaks in.
--
-- No customer content lands here: the columns are the seller's own document title, the source kind,
-- and the ids of the seller's own knowledge rows. The passage text is not copied; it lives in
-- product_knowledge_chunks and is reachable by chunk_id, so a later edit of the seller's knowledge
-- does not silently rewrite the record of what the draft was shown.
create table if not exists inquiry_draft_evidence (
    id             uuid primary key default gen_random_uuid(),
    org_id         uuid         not null,
    work_item_id   uuid         not null,
    draft_version  int          not null,
    ordinal        int          not null,
    kind           varchar(40)  not null,
    source_id      uuid,
    chunk_id       uuid,
    title          varchar(300),
    locator        varchar(200),
    created_at     timestamptz  not null default now()
);

create unique index if not exists uq_inquiry_draft_evidence_slot
    on inquiry_draft_evidence (work_item_id, draft_version, ordinal);

create index if not exists ix_inquiry_draft_evidence_draft
    on inquiry_draft_evidence (org_id, work_item_id, draft_version);

-- How the draft was authored, and what the retrieval could see.
--
-- A draft written by the model from two knowledge passages and a draft written by the deterministic
-- fallback because the capability was off are both just text in inquiry_reply_draft. The seller is
-- about to send one of them to a customer under their own name, so which one it is must survive on
-- the row. knowledge_state is the closed vocabulary of what the library could offer: NO_PRODUCT (the
-- inquiry does not resolve to a canonical product), NO_LIBRARY (it does, and nothing is written
-- there), NO_MATCH (documents exist, none answer this), GROUNDED (at least one passage was used).
alter table inquiry_reply_draft
    add column if not exists author_kind     varchar(24),
    add column if not exists model_version   varchar(120),
    add column if not exists knowledge_state varchar(24),
    add column if not exists product_id      uuid;
