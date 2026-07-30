-- Agent Runtime durable run state — the Spring-owned, sanitized checkpoint that lets the Agent
-- Runtime survive a process restart and stay correct under concurrent resume in a pilot deployment.
--
-- WHY THIS EXISTS. The Agent Runtime (agent-runtime/) is a stateless HTTP service: it holds no DB and
-- no channel credential, forwards the operator's JWT, and treats this backend as the system of record.
-- Until now its durable run store was a local FileRunStore — single-instance, unsafe behind more than
-- one replica, and with no concurrency control. This table moves that run state into the backend so it
-- is durable, org-isolated, and guarded by an explicit optimistic-lock version. The Agent Runtime
-- reaches it ONLY over the org-scoped REST surface (/api/agent-run-store) — never by touching this DB.
--
-- WHAT IS AND ISN'T STORED. Only a SANITIZED snapshot of a run: ids, phase, a coarse priority/category,
-- the step trail, and the sanitized outcome or the quote-free issue brief. NO raw inquiry/review title,
-- body, or draft text is ever stored here — the snapshot the runtime sends carries none (its RunSnapshot
-- types are the sanitized contract), and the write endpoint additionally rejects a snapshot that carries
-- a raw-content key (defence in depth). `snapshot` is a JSON document stored as text (this codebase does
-- not use jsonb; the column is opaque to the DB and only ever read/written whole by the runtime).
--
-- CONCURRENCY. `version` is an explicit optimistic-lock counter (there is no JPA @Version precedent in
-- this codebase; this is a hand-managed CAS, mirroring the "0 rows affected means someone else won"
-- idiom of ProductRepository.insertIfAbsent). A resume first CLAIMS the run by transitioning
-- AWAITING_APPROVAL → RESUMING (a real lock: it moves the row OUT of the claimable state, so a staggered
-- second resume that reads the post-claim row cannot re-claim). Only the claim winner then runs the
-- non-idempotent step (the review guided-session mint) and finalizes RESUMING → DONE. `claimed_at`
-- carries a lease: a RESUMING row whose claimer died can be re-claimed after the lease elapses, so a
-- crash never leaves a run permanently stuck.
--
-- ============================================================================================
-- VERSION NUMBERING
-- This file is V33 — the next free version above everything on main (max is V32,
-- V32__channel_orders). Flyway `out-of-order` is NOT enabled, so a version at or below main's max
-- would fail boot on an already-migrated database. NOTE: the unmerged branch
-- `feat/review-issue-action-loop` (PR #371) also records a V33 (renumbered from its earlier V32 after
-- #372 took V32 on main); whichever of the two merges second must renumber to V34+ (same forward-only
-- rule). This branch persists agent-run state; #371 persists review-issue feedback — no shared objects.
-- ============================================================================================

-- One row per (org, agent-run thread). The unique key is also the tenant-isolation guarantee: a run is
-- only ever visible/resumable within the org that created it, so a client-supplied threadId can never
-- collide or be read across orgs.
create table agent_runs (
    id          uuid         primary key,
    org_id      uuid         not null references organizations (id),
    -- The Agent Runtime thread id (a synthetic run id; filename-safe charset enforced at the edge).
    thread_id   varchar(200) not null,
    -- INQUIRY | REVIEW | ISSUE — which subgraph owns the run.
    domain      varchar(16)  not null,
    -- Lock state machine: AWAITING_APPROVAL -> RESUMING (claimed) -> DONE.
    status      varchar(24)  not null,
    -- Sanitized snapshot as a JSON document (see header). Never raw customer text.
    snapshot    text         not null,
    -- Optimistic-lock counter, bumped on every state transition (claim + finalize). Starts at 1.
    version     bigint       not null default 1,
    -- When the current RESUMING claim was taken; drives the crash-recovery lease. Null unless RESUMING.
    claimed_at  timestamptz,
    created_at  timestamptz  not null,
    updated_at  timestamptz  not null
);

create unique index uq_agent_runs_org_thread
    on agent_runs (org_id, thread_id);
create index idx_agent_runs_org_status
    on agent_runs (org_id, status);
