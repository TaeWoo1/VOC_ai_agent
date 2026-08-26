-- One row per (product, picture, extractor, model): "this image has been through the model".
--
-- WHY A TABLE AND NOT AN EXISTING SEAM. The alternative considered was an empty-bodied
-- product_knowledge_sources row. It fails for a reason that shows up on the seller's screen rather
-- than in the code: countByOrgIdAndProductId is what renders 「등록된 지식 N건」, so a receipt would
-- make the product page claim knowledge that does not exist — 26 of them per product. SyncCursor and
-- ChannelDataState are (account, dataType) collection cursors with nowhere to put an image identity.
-- A receipt is neither a knowledge document nor a collection cursor, and pretending otherwise costs
-- a lie on a screen.
--
-- IDENTITY IS DELIBERATELY NOT (org, sha256). That would be a cross-product cache: the same banner
-- appearing under a second product would be treated as already processed, and cross-product reuse is
-- explicitly deferred (product-owner, 2026-08-27). The same picture under a different product is a
-- different question, because the 규격 it will be associated against are that product's.
--
-- EXTRACTOR AND MODEL ARE PART OF THE IDENTITY. A new prompt or a new model is a different reading
-- of the same picture; keeping them in the key means an upgrade re-reads rather than inheriting an
-- older extractor's answer under the new one's name.
create table product_detail_image_receipt (
    id                uuid primary key,
    org_id            uuid        not null,
    product_id        uuid        not null,
    image_sha256      varchar(64) not null,
    extractor_version varchar(200) not null,
    model_version     varchar(120) not null,

    status            varchar(16) not null,
    outcome           varchar(32),

    queued_at         timestamptz not null,
    started_at        timestamptz,
    completed_at      timestamptz,

    -- The closed extraction, durably, so a crash between the model call and publication does not buy
    -- the same call twice AND does not lose what it bought. Only {"facts":[{specLabel,attribute,
    -- value}]} is ever written here — no raw OCR text, no model reasoning, no prose. It is evidence
    -- of what was read, never an authority to state it; authority is decided at finalization.
    extraction        jsonb,

    facts_accepted    integer     not null default 0,
    facts_refused     integer     not null default 0,

    created_at        timestamptz not null,
    updated_at        timestamptz not null
);

create unique index uq_image_receipt_identity
    on product_detail_image_receipt (org_id, product_id, image_sha256, extractor_version, model_version);

create index ix_image_receipt_product
    on product_detail_image_receipt (org_id, product_id);
