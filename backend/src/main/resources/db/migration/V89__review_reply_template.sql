-- Review Reply Template Settings v1 — one company's own wording for the review reply categories
-- reviewnary already had.
--
-- A row exists ONLY where an organization overrode a template. Absence is the normal state and it
-- means "answer exactly as reviewnary does today" (ReviewReplyTemplateKey.defaultBody()), so this
-- migration backfills nothing and creates nothing for existing companies. Restoring the default is a
-- DELETE, not a write of the default text — a stored copy of the shipped wording would silently stop
-- following it.
--
-- `template_key` is the category string the suggestion has always reported (`positive_reply`,
-- `quality_reply`, …). It is not a free-form key: the service refuses anything outside the closed
-- enum, the same way every other text-stored vocabulary in this schema is refused in code rather than
-- by a constraint that a new member would have to migrate.
--
-- Deliberately NOT here: a product_id, a seller_account_id, a condition expression, a priority
-- column, a template language. v1 is org-wide because no pilot has asked for less, and each of those
-- columns would be a promise to resolve a precedence order nobody has specified.
create table review_reply_template (
    id           uuid        primary key,
    org_id       uuid        not null references organizations (id),

    -- One of ReviewReplyTemplateKey.category(). Closed in code; see the note above.
    template_key text        not null,

    -- The seller's own wording for that category. Normalized and length-checked at write time by the
    -- same ReviewReplyValidation the reply draft uses — a template IS a reply body.
    body         text        not null,

    updated_by   uuid,
    created_at   timestamptz not null,
    updated_at   timestamptz not null
);

-- "A company has one wording per category" — a property of the table, not a rule in a service.
create unique index uq_review_reply_template_org_key
    on review_reply_template (org_id, template_key);

comment on table review_reply_template is
    'Org-level override of a review reply template. No row = reviewnary default (Review Reply Template Settings v1).';
