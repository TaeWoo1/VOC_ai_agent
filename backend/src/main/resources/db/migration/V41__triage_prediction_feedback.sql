-- The production feedback spine of docs/slices/llm-triage-classifier-v1.md §6.
--
-- Three tables rather than one, and the value is entirely in their being three. A single
-- "triage_result" row carrying the model's answer, the seller's edit and someone's opinion of the
-- edit would make the one question this spine exists to answer unanswerable: was the classifier
-- wrong, or does this seller simply want something else?
--
-- ── review_triage_predictions ────────────────────────────────────────────────────────────────
-- What the system said, and what produced it. IMMUTABLE by intent: there is no update path, and a
-- re-classification writes a NEW row. A prediction that could be edited in place would make
-- "was the model wrong, or did the model change" unanswerable six months later, which is the
-- question the whole record exists for.
--
-- classifier_version names all four of RUBRIC v2 §8.6's components together (vendor+model, prompt
-- version, schema version). prompt_hash is SHA-256 of the system prompt: the text lives in the
-- repository under a version, and copying it onto every row would be a large duplicate that could
-- still drift from the version string beside it. A hash cannot drift.
--
-- status carries §8.5's fail-closed states. There is deliberately NO default and no nullable tier
-- fallback: a failed classification stores OK=false with a null tier, never FYI. FYI means "nothing
-- here for the seller", so an outage that wrote it would be a silent dismissal indistinguishable
-- from a judgment.
--
-- What is NOT here: the review body, the prompt text, the raw model response, the API response
-- envelope, and any token count that could be inverted to a body length. failure_reason is a short
-- shape-of-the-error phrase this codebase writes ("http 401", "unknown tag") and never a vendor
-- message, because a vendor error body can quote the request and the request contains the review.
create table if not exists review_triage_predictions (
    id                    uuid primary key,
    org_id                uuid        not null,
    review_id             uuid        not null references reviews (id) on delete cascade,
    status                varchar(24) not null,
    tier                  varchar(24),
    reason_code           varchar(32),
    tags                  varchar(64),
    suggested_next_action varchar(32),
    classifier_version    varchar(160) not null,
    model_id              varchar(80)  not null,
    prompt_hash           varchar(64)  not null,
    failure_reason        varchar(120),
    predicted_at          timestamptz  not null,
    created_at            timestamptz  not null,
    updated_at            timestamptz  not null
);

create index if not exists idx_triage_prediction_review on review_triage_predictions (review_id, predicted_at desc);
create index if not exists idx_triage_prediction_version on review_triage_predictions (org_id, classifier_version);

-- ── review_triage_corrections ────────────────────────────────────────────────────────────────
-- What the seller changed it to. Scoped to the PREDICTION and not to the review, so a correction
-- always says which answer it corrected — a correction attached only to a review would be
-- uninterpretable the moment a second classifier version had run.
--
-- Closed vocabularies only, and NO free-text note. A note is customer-adjacent prose in a table an
-- evaluation harness reads, and every privacy guarantee in RUBRIC §5 rests on there being nowhere
-- for prose to land. The same reasoning already closed reason_code, tags and suggested_next_action.
create table if not exists review_triage_corrections (
    id                    uuid primary key,
    org_id                uuid        not null,
    prediction_id         uuid        not null references review_triage_predictions (id) on delete cascade,
    corrected_tier        varchar(24) not null,
    corrected_reason_code varchar(32),
    corrected_tags        varchar(64),
    corrected_at          timestamptz not null,
    created_at            timestamptz not null,
    updated_at            timestamptz not null
);

-- One live correction per prediction. A seller who changes their mind supersedes; the history is
-- the prediction rows, which are immutable.
create unique index if not exists uq_triage_correction_prediction on review_triage_corrections (prediction_id);

-- ── review_correction_dispositions ───────────────────────────────────────────────────────────────
-- The adjudicated reading of a correction, and the separation this unit is for.
--
-- CLASSIFIER_ERROR — the rubric says X, the classifier said Y, the seller said X.
-- SELLER_PREFERENCE — the rubric says X and this seller wants Y for their catalog.
--
-- ASSIGNED BY A HUMAN, never inferred, and the reason is that the correction row is byte-identical
-- in both cases: a 배송 지연 review one seller triages as urgent and another treats as noise
-- produces exactly the same correction. Only a person holding the rubric can say which happened.
-- Inferring it would let one seller's preference become the global classifier's definition of
-- accuracy, which is the failure this table exists to prevent.
--
-- decided_by is an operator id, not a name — an actor reference this schema already has elsewhere.
create table if not exists review_correction_dispositions (
    id             uuid primary key,
    org_id         uuid        not null,
    correction_id  uuid        not null references review_triage_corrections (id) on delete cascade,
    disposition    varchar(24) not null,
    decided_by     uuid,
    decided_at     timestamptz not null,
    -- Which frozen feedback snapshot this correction was folded into, or null while it is still
    -- loose. A snapshot is cut, numbered and never reopened: an evaluation set that changes under a
    -- metric makes the metric meaningless.
    snapshot_version varchar(40),
    created_at     timestamptz not null,
    updated_at     timestamptz not null
);

create unique index if not exists uq_correction_disposition on review_correction_dispositions (correction_id);
create index if not exists idx_correction_disposition_snapshot on review_correction_dispositions (org_id, disposition, snapshot_version);

comment on table review_triage_predictions is
    'Immutable: a re-classification inserts a new row. Never updated in place.';
comment on table review_correction_dispositions is
    'CLASSIFIER_ERROR feeds a frozen evaluation snapshot; SELLER_PREFERENCE never reaches the global gold set.';
