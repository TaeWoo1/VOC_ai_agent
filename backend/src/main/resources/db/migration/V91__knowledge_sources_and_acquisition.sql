-- Knowledge Sources & Acquisition v1 (2026-09-03)
--
-- Three facts the seller's corpora could not hold, added to the corpora they belong to rather than to
-- a new subsystem beside them.
--
-- 1. WHERE a passage came from, when it came from a file. `authored_origin` already answers this for
--    product knowledge (typed / listing text / read from a picture); it gains one value for a document
--    the seller uploaded, and the ORG corpus gains the column it never had. `document_name` carries the
--    filename so a citation can say 「제품 사용설명서.pdf」 rather than only a title we derived from it.
--
-- 2. WHETHER a source still speaks for the company. A manual gets superseded; a policy is replaced. Until
--    now the only way to stop a document from grounding an answer was to delete it, which also deletes the
--    record of every draft that stood on it. `active` retires it instead: retrieval stops reading it and
--    the citations already written keep pointing at something that exists.
--
-- 3. What reviewnary has NOTICED but nobody has confirmed. A candidate is not knowledge — that is the
--    whole point of the table. It holds a sentence that repeats across the seller's own past answers, or
--    a gap a draft ran into, until a person says yes; accepting one WRITES a normal knowledge source and
--    records which source it became.
--
-- Backfill: every existing source is `active` (it is what the corpus has been answering from) and
-- `SELLER_ENTERED_KNOWLEDGE` on the ORG side (the only writer that has ever existed there is the
-- settings screen). Nothing is claimed about documents, because there were none.

ALTER TABLE product_knowledge_sources
    ADD COLUMN document_name VARCHAR(260),
    ADD COLUMN active        BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE org_knowledge_sources
    ADD COLUMN document_name   VARCHAR(260),
    ADD COLUMN active          BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN authored_origin VARCHAR(40) NOT NULL DEFAULT 'SELLER_ENTERED_KNOWLEDGE';

CREATE TABLE knowledge_candidate (
    id             UUID PRIMARY KEY,
    org_id         UUID         NOT NULL,
    -- PRODUCT | ORG. Which corpus this would become knowledge in.
    scope          VARCHAR(16)  NOT NULL,
    product_id     UUID,
    -- What the candidate is about, in the seller's own words — never a model's paraphrase.
    subject        VARCHAR(300) NOT NULL,
    -- The sentence itself: for a repeated answer, the seller's own sentence, verbatim.
    content        TEXT         NOT NULL,
    -- REPEATED_ANSWER | DRAFT_GAP. How reviewnary came to notice it.
    origin         VARCHAR(24)  NOT NULL,
    -- How many of the seller's own past answers carry this sentence (REPEATED_ANSWER), else 0.
    evidence_count INTEGER      NOT NULL DEFAULT 0,
    -- OPEN | ACCEPTED | DISMISSED. A candidate is never silently promoted.
    state          VARCHAR(16)  NOT NULL DEFAULT 'OPEN',
    -- The knowledge source an accepted candidate became. Null until then.
    source_id      UUID,
    -- The identity that makes a re-run idempotent: the same sentence in the same scope is one candidate.
    dedupe_key     VARCHAR(120) NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    decided_at     TIMESTAMPTZ,
    decided_by     VARCHAR(120)
);

-- One OPEN candidate per (org, scope, product, sentence). A dismissed one may be re-noticed later and
-- is deliberately NOT covered by the constraint: dismissing means "not now", not "never mention it".
CREATE UNIQUE INDEX uq_knowledge_candidate_open
    ON knowledge_candidate (org_id, dedupe_key)
    WHERE state = 'OPEN';

CREATE INDEX idx_knowledge_candidate_org_state ON knowledge_candidate (org_id, state, created_at DESC);
