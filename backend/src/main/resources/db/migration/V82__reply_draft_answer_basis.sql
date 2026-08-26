-- Agent Command Center v1 §2 — the answer state survives a reload.
--
-- GROUNDED / NEEDS_CLARIFICATION / NO_ANSWER_BASIS were computed on every generate and then lost:
-- reopening the inquiry showed the draft with no statement of what it was, so a reply that ASKS the
-- customer for their 규격 read as an answer that had come out short. The Home briefing needs the same
-- fact, and re-deriving it would mean re-running retrieval on every screen that mentions the row.
--
-- ONE column, nullable, no backfill. A draft written before this migration does not carry the state
-- and must not claim one — a value written by a migration cannot later be told apart from one that
-- was observed. Null means "not recorded", and every reader says nothing rather than guessing.
--
-- The append-only contract is untouched: this is stamped when a version is written and never updated.
alter table inquiry_reply_draft
    add column answer_basis varchar(24);

comment on column inquiry_reply_draft.answer_basis is
    'AnswerBasisState at the moment this version was written; null on versions predating 2026-08-27.';
