-- Helper Device Authentication v1 (2026-09-05).
-- A reviewnary 도우미 that a seller linked to their account from a browser session. The helper holds an
-- opaque token; this table holds ONLY its SHA-256. A row is the seller's standing grant to one installed
-- helper, revocable from 설정 › 연결된 기기; the helper's password file (helper.env SELLEROPS_PASSWORD)
-- is what this replaces.
create table helper_devices (
    id             uuid primary key,
    org_id         uuid not null references organizations (id),
    user_id        uuid not null references users (id),
    token_hash     varchar(64) not null unique,
    device_name    varchar(80) not null,
    helper_version varchar(40),
    created_at     timestamptz not null,
    updated_at     timestamptz not null,
    last_used_at   timestamptz,
    expires_at     timestamptz not null,
    revoked_at     timestamptz
);
create index ix_helper_devices_org on helper_devices (org_id, created_at desc);
