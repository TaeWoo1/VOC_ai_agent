-- Account-scoped Persistent Session Runtime (V1): the opaque account slot + durable session readiness.
--
-- WHY THIS TABLE EXISTS
-- The local-agent keeps a seller's marketplace login in a persistent browser profile so it survives an
-- agent restart. With more than one account on the same channel (e.g. two NAVER stores), those profiles
-- MUST NOT share cookies — account B's session must never leak into account A's window. The agent picks
-- the profile directory from a per-account key, but the Action Window wire refuses to transport identity
-- (contracts/action-window/v2 — a run carries only opaque refs, never a seller-account id). So the server
-- owns a STABLE, OPAQUE per-account slot and hands only that to the runtime; the agent hashes the slot
-- into a fixed profile directory. The raw seller_account_id never leaves the backend, and the slot is not
-- reversible to it, so nothing on the wire, in a log, or on the agent's filesystem path is an identity.
--
-- The slot is generated ONCE per account and reused forever (unlike review_import_launch.launch_ref, which
-- is per-run) — that stability is exactly what makes "same account -> same profile after a restart" true.
--
-- This table also carries DURABLE session readiness (login/2FA/expiry liveness), which previously lived
-- only in the agent's memory and was lost on restart. Persisting it here — reconciled with the sync-health
-- that channel_connection_status already owns — lets the existing connection-status projection report a
-- seller's session state without a new surface. (product-scope §1.7 carve-out extension, owner-approved
-- 2026-07-27: durable session-readiness persistence for the account-scoped runtime.)
--
-- Additive only (no drops). IF NOT EXISTS keeps re-runs / partial-applies safe, matching V27/V28.

create table if not exists account_session_slot (
    id                uuid         primary key,
    org_id            uuid         not null references organizations (id),
    -- One row per seller account: the slot is the account's identity ON THE RUNTIME SIDE.
    seller_account_id uuid         not null references seller_accounts (id),
    channel_id        uuid         not null references channels (id),
    -- The opaque, STABLE per-account key the runtime learns instead of the seller_account_id. Random,
    -- one-way (not reversible to the account), generated once and reused for the life of the account.
    account_slot      varchar(24)  not null,
    -- Durable session readiness, mirroring contracts/session-readiness/v1 SessionReadinessState. Never a
    -- guessed READY: an account whose session has never been observed sits at UNOBSERVED_EXTERNAL.
    readiness_state   varchar(32)  not null default 'UNOBSERVED_EXTERNAL',
    -- The probe moment that last wrote the state (AGENT_START | BEFORE_WORK | SESSION_FAILURE |
    -- MANUAL_RECHECK). Nullable: an unobserved row has had no probe yet.
    readiness_reason  varchar(24),
    last_observed_at  timestamptz,
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null
);

-- The slot is the credential-shaped key the runtime presents back, so it must be globally unambiguous.
create unique index if not exists uq_account_session_slot_slot
    on account_session_slot (account_slot);

-- Exactly one slot per seller account — the stability guarantee is a DB invariant, not a convention.
create unique index if not exists uq_account_session_slot_account
    on account_session_slot (seller_account_id);

create index if not exists idx_account_session_slot_org
    on account_session_slot (org_id);
