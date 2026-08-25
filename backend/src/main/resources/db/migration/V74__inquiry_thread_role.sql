-- Cafe24 Thread Semantics Recovery v1 (2026-08-25)
--
-- On a Cafe24 board an ANSWER is itself an ARTICLE, hanging off the question by
-- parent_article_no — confirmed by an approved bounded READ proof (verdict
-- STANDARD_BOARD_REPLY_ARTICLE, docs/inquiry_answer_execution_v1.md). The connector had
-- always been receiving that field and discarding it, so a reply article was stored as an
-- independent customer inquiry and entered the seller's 미답변 queue.
--
-- Two nullable columns, no backfill. NULL means "the source published no thread structure,
-- or we have not re-read this row since the projection existed" — which is exactly the state
-- of every historical row and must not be confused with "the source said ROOT". Reclassifying
-- the historical rows needs a bounded source re-read under its own approval; nothing here
-- guesses a role from article-number adjacency.
alter table inquiries add column if not exists thread_role varchar(16);
alter table inquiries add column if not exists thread_parent_external_id varchar(200);

comment on column inquiries.thread_role is
  'SourceThreadRole (ROOT/REPLY) as declared by the source''s own structure; null = not classified.';
comment on column inquiries.thread_parent_external_id is
  'Parent row''s external_id in the same source identifier space; set only on a REPLY.';

-- The queue and every count read (org, operational_state) already; the reclassification and the
-- thread lookups read (org, thread_parent_external_id).
create index if not exists idx_inquiries_thread_parent
    on inquiries (org_id, thread_parent_external_id)
    where thread_parent_external_id is not null;
