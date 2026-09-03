-- Knowledge Retrieval Quality v1 (2026-09-03): the vector cache behind semantic retrieval.
--
-- CONTENT-ADDRESSED, and that is the whole lifecycle design. A row is «the vector of THIS text for
-- THIS organisation», not a projection of a chunk row — so a passage the seller edits gets a new
-- hash and a new vector, and the old one simply stops being asked for. There is nothing to
-- invalidate, nothing to cascade, and no way to serve a vector of text that no longer exists.
-- Retiring a document is already handled a layer up: a retired source never enters the candidate
-- list, so its vectors are never looked up.
--
-- Scoped to the organisation on purpose. The same sentence in two companies gets two rows: a cache
-- shared across orgs is a cross-tenant object, and this table would be the wrong place to invent one.
--
-- No pgvector: this Postgres does not have the extension, and it would earn nothing here. Retrieval
-- is always bounded to one product's library, one company's policies or one company's answer memory
-- — measured at 4, 6 and 26 rows on the reference deployment — and an approximate index over tens of
-- vectors adds operational surface and non-determinism to a linear scan that costs microseconds.
CREATE TABLE knowledge_embedding (
    id             UUID PRIMARY KEY,
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    content_sha256 CHAR(64) NOT NULL,
    model          VARCHAR(80) NOT NULL,
    dimensions     INT NOT NULL,
    vector         BYTEA NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The identity: one vector per (organisation, model, dimensions, text). The model and the dimensions
-- are part of it because vectors from different models are not comparable, so a deployment that
-- changes either starts a new cache rather than mixing two spaces in one search.
CREATE UNIQUE INDEX uq_knowledge_embedding
    ON knowledge_embedding (org_id, model, dimensions, content_sha256);
