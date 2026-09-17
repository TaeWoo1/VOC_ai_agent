-- Scheduled Aside v1: the one job a backend may hand to an installed helper to run with nobody watching.
--
-- Everything that makes an unattended browser job safe is a column or a constraint here, not a convention in
-- code that a later caller could forget:
--
--   org + device binding   a job belongs to one organisation AND one device row; neither is taken from the
--                          request, both are derived from the token the auth filter already validated
--   recipe allowlist       `recipe` is checked against the single published v1 recipe — a job naming anything
--                          else cannot be stored, so an unknown recipe is impossible rather than unhandled
--   single use             `status` leaves QUEUED exactly once (CLAIMED), and a claimed job never returns to it
--   idempotent job id      (device_id, client_job_id) is unique: a retried hand-out re-finds its job instead of
--                          creating a second one
--   short lease / TTL      `expires_at` bounds how long a job may wait, `lease_until` how long a claim holds
--   one active job/device  a partial unique index — at most one QUEUED-or-CLAIMED job per device, in the schema
--
-- What is deliberately absent: any column naming a URL, a prompt, a script or a credential. The recipe id IS
-- the instruction; the helper resolves it to its own loopback surface and refuses anything else locally. A job
-- row therefore cannot carry a marketplace target, because it cannot carry a target at all.

create table scheduled_aside_job (
    id             uuid        primary key,
    org_id         uuid        not null references organizations (id) on delete cascade,
    device_id      uuid        not null references helper_devices (id) on delete cascade,
    run_id         uuid        references responsibility_run (id) on delete set null,
    -- The caller's own id for this hand-out. Makes a retry idempotent without the caller inventing a job.
    client_job_id  varchar(64) not null,
    recipe         varchar(64) not null,
    status         varchar(16) not null,
    lease_until    timestamptz,
    expires_at     timestamptz not null,
    claimed_at     timestamptz,
    settled_at     timestamptz,
    -- A closed outcome token the helper reported. Never free text, never page content.
    outcome        varchar(32),
    observed_count integer,
    -- SHA-256 of the owned surface's own item refs, sorted. Lets a later run say «nothing changed» or «exactly
    -- this changed» without storing what was on the page: a digest of synthetic ids we ourselves published.
    content_digest varchar(64),
    created_at     timestamptz not null,
    updated_at     timestamptz not null,
    constraint uq_scheduled_aside_job_client unique (device_id, client_job_id),
    constraint chk_scheduled_aside_job_recipe
        check (recipe in ('CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1')),
    constraint chk_scheduled_aside_job_status
        check (status in ('QUEUED', 'CLAIMED', 'SETTLED', 'EXPIRED')),
    -- A job that was never claimed has no claim time, and a settled one has both.
    constraint chk_scheduled_aside_job_claimed
        check (status <> 'CLAIMED' or (claimed_at is not null and lease_until is not null)),
    constraint chk_scheduled_aside_job_settled
        check (status <> 'SETTLED' or (settled_at is not null and outcome is not null)),
    -- The same rule the observation schema states: a job that reported nothing carries no count.
    constraint chk_scheduled_aside_job_count
        check (outcome = 'OBSERVED' or observed_count is null),
    -- And nothing that failed to read the surface may describe what was on it.
    constraint chk_scheduled_aside_job_digest
        check (outcome = 'OBSERVED' or content_digest is null)
);

-- One active job per device, enforced where it cannot be forgotten. A helper is a single-threaded thing on
-- someone's desk; two live jobs for it is either a bug or an attempt to queue work on a stranger's machine.
create unique index uq_scheduled_aside_job_active
    on scheduled_aside_job (device_id)
    where status in ('QUEUED', 'CLAIMED');

create index idx_scheduled_aside_job_org on scheduled_aside_job (org_id, created_at desc);

comment on table scheduled_aside_job is
    'Scheduled Aside v1: one single-use, leased, recipe-allowlisted job handed to one installed helper. Carries no URL, prompt, script or credential — the recipe id is the whole instruction.';
comment on column scheduled_aside_job.recipe is
    'The published recipe. Constrained to the single v1 value: an unknown recipe cannot be stored.';
comment on column scheduled_aside_job.observed_count is
    'Items the owned surface printed. Null unless the outcome is OBSERVED — «did not report» carries no number.';
