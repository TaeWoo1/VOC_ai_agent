-- Auth + Growth Instrumentation v1 (docs/auth_growth_instrumentation_v1.md §3).
-- Social identity is (provider, provider_subject); no auto-link by email; no user without an org.

-- A user who signed up with Google/NAVER has no password. Password login for such a row is refused
-- (same generic message as a wrong password).
alter table users alter column password_hash drop not null;

create table user_identities (
    id               uuid primary key,
    user_id          uuid         not null references users (id),
    provider         varchar(20)  not null,
    provider_subject varchar(255) not null,
    email            varchar(255),
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null,
    constraint uq_user_identities_provider_subject unique (provider, provider_subject)
);
create index idx_user_identities_user on user_identities (user_id);

-- One-time handoffs: SESSION (identity known → URL code → JWT), ONBOARDING (first-time identity → URL
-- code → body-only ONBOARDING_TOKEN), ONBOARDING_TOKEN (상호명 → org + user + identity in one transaction).
-- Only the SHA-256 of the code is stored; consumed_at makes each row single-use.
create table auth_handoffs (
    id               uuid primary key,
    code_hash        varchar(64)  not null unique,
    purpose          varchar(20)  not null,
    user_id          uuid references users (id),
    provider         varchar(20)  not null,
    provider_subject varchar(255) not null,
    email            varchar(255),
    display_name     varchar(120),
    expires_at       timestamptz  not null,
    consumed_at      timestamptz,
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null
);
create index idx_auth_handoffs_expires on auth_handoffs (expires_at);
