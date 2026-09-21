-- Customer Goal Interpretation v3 — what the interpreter read one customer message as.
--
-- ONE ROW PER (inquiry, exact message, contract). The identity is the point: re-reading the same sentence under the
-- same prompt cannot produce a second answer, so the runtime asks the vendor once and every later path — the next
-- responsibility run, a re-investigation, a seller opening the case — reads this row. A message the customer edited
-- has a different source_fingerprint and is therefore a different question; a new prompt version is a different
-- contract and gets its own row rather than overwriting what an earlier contract concluded.
--
-- WHAT IS STORED. The validated goal set exactly as the contract admitted it, which includes each goal's
-- explicit_request and its evidence quote — spans of the customer's own message. That is a second copy of some of
-- the customer's words, inside the same organisation's database, beside the inquiries row those words came from,
-- and it is deliberate: an interpretation that does not record what it interpreted cannot be reused, and re-asking
-- a vendor on every read is both the cost and the non-determinism this table exists to remove. Nothing here travels
-- anywhere the inquiry itself does not.
--
-- WHAT A REFUSAL MEANS. `outcome = REFUSED` records that the model answered and the answer did not satisfy the
-- contract — the same bytes will not satisfy it next time either, so the refusal is worth keeping and worth not
-- paying for twice. A transport failure, an exhausted budget and a capability that is off write NOTHING: nothing was
-- established, and a row saying otherwise would turn «we did not ask» into «there is no answer».
create table if not exists inquiry_goal_interpretation (
    id                  uuid          primary key,
    org_id              uuid          not null references organizations (id),
    inquiry_id          uuid          not null references inquiries (id),

    -- sha256 of the normalized message the interpreter actually read. The reuse key, and the invalidation: an edited
    -- message is a different question rather than a stale answer.
    source_fingerprint  varchar(64)   not null,

    -- The contract this reading is a reading OF, e.g. customer-goal-interpreter/v3. Never defaulted on read.
    prompt_version      varchar(64)   not null,
    model_version       varchar(120),

    outcome             varchar(16)   not null check (outcome in ('INTERPRETED', 'REFUSED')),

    -- The validated set as JSON: {"goals": [...], "relations": [...]}. Null exactly when REFUSED.
    goal_set            text,

    -- A closed token from CustomerGoalResponseParser when REFUSED. Null exactly when INTERPRETED.
    failure             varchar(32),

    created_at          timestamptz   not null,
    updated_at          timestamptz   not null
);

-- One reading per question per contract. This is what makes «ask once» a property of the schema rather than of
-- whoever remembered to look first.
create unique index if not exists uq_inquiry_goal_interpretation
    on inquiry_goal_interpretation (org_id, inquiry_id, source_fingerprint, prompt_version);

create index if not exists idx_inquiry_goal_interpretation_inquiry
    on inquiry_goal_interpretation (org_id, inquiry_id);

-- A reading has a set, or it has a reason it has none. Never both, never neither.
alter table inquiry_goal_interpretation drop constraint if exists ck_inquiry_goal_interpretation_shape;
alter table inquiry_goal_interpretation add constraint ck_inquiry_goal_interpretation_shape
    check ((outcome = 'INTERPRETED' and goal_set is not null and failure is null)
        or (outcome = 'REFUSED' and goal_set is null and failure is not null));
