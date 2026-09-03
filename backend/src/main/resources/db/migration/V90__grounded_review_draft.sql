-- Grounded Review Drafting v1 (2026-09-03)
--
-- A review reply draft can now be written from the seller's own knowledge instead of a template, and
-- the two facts that makes true have to be storable: WHO wrote this version, and WHAT it was written
-- from. Both mirror the inquiry lane's columns exactly (`inquiry_reply_draft.author_kind` /
-- `inquiry_draft_evidence`), because the seller is asking the same question on both screens — 「이 문장
-- 어디서 나온 거예요?」 — and two shapes for one question is how two screens start disagreeing.
--
-- Nullable and unbackfilled on purpose. Every version written before this migration was typed or
-- copied by a person through a screen that had no model behind it; stamping them MODEL or SELLER now
-- would be a claim about drafts nobody recorded an author for. NULL means "written before reviewnary
-- recorded this", and the screen says nothing rather than guessing.

ALTER TABLE review_reply_draft
    ADD COLUMN author_kind      VARCHAR(20),
    ADD COLUMN model_version    VARCHAR(200),
    ADD COLUMN knowledge_state  VARCHAR(20),
    ADD COLUMN answer_basis     VARCHAR(24),
    ADD COLUMN product_id       UUID;

-- One row per passage that was actually put in front of the drafter, in the order it was shown.
-- Append-only beside the append-only draft: a version's evidence is what that version was written
-- from, and a later regeneration writes a new version with its own rows rather than editing these.
--
-- No passage TEXT. The excerpt a seller reads under 「왜 이렇게 썼어요?」 is re-read from the source
-- document at display time (`DraftEvidenceSnippets`), so the customer-facing corpus keeps exactly one
-- copy of every sentence and a deleted document leaves a citation without an excerpt rather than a
-- quote of something that no longer exists.
CREATE TABLE review_draft_evidence (
    id            UUID PRIMARY KEY,
    org_id        UUID        NOT NULL,
    review_id     UUID        NOT NULL,
    draft_version INTEGER     NOT NULL,
    ordinal       INTEGER     NOT NULL,
    kind          VARCHAR(40) NOT NULL,
    source_id     UUID,
    chunk_id      UUID,
    title         VARCHAR(300),
    locator       VARCHAR(200),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_review_draft_evidence_version
    ON review_draft_evidence (org_id, review_id, draft_version, ordinal);
