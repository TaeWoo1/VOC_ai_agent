-- Inquiry Decision v2.1 — how far a past answer may travel, as a declared fact on the answer itself.
--
-- The coverage judge was asked, on every inquiry, to guess from an answer's text whether it was general or about one
-- order / one conversation, and the first real-model run showed it guessing wrong (an order's 「발송했습니다」 offered as
-- another customer's prefill). Whether an answer was about THIS order is known when it is written; it is stored here and
-- the runtime reads it. REUSABLE crosses Cases; ORDER_ONLY only to a Case about the same order (compared through the two
-- inquiries' own order bindings — this table still holds no order reference); CASE_ONLY only its own Case; UNKNOWN never
-- crosses.
--
-- NO BACKFILL. Every existing row is UNKNOWN: inferring REUSABLE from the text is the exact guess this column replaces,
-- and the safe reading of 「nobody said」 is 「do not reuse」. declared_by / declared_at record who said otherwise.
alter table answer_memory add column if not exists reuse_scope varchar(16) not null default 'UNKNOWN';
alter table answer_memory add column if not exists reuse_scope_declared_by uuid;
alter table answer_memory add column if not exists reuse_scope_declared_at timestamptz;

alter table answer_memory drop constraint if exists ck_answer_memory_reuse_scope;
alter table answer_memory add constraint ck_answer_memory_reuse_scope
    check (reuse_scope in ('REUSABLE', 'ORDER_ONLY', 'CASE_ONLY', 'UNKNOWN'));

-- A declaration has an author and a moment, or it is the default and has neither.
alter table answer_memory drop constraint if exists ck_answer_memory_reuse_scope_declared;
alter table answer_memory add constraint ck_answer_memory_reuse_scope_declared
    check ((reuse_scope_declared_by is null) = (reuse_scope_declared_at is null));
