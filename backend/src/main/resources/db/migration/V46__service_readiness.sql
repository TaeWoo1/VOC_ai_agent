-- Service Readiness v1 (docs/service_readiness_v1.md §3): password reset tokens + account consent record.

create table password_reset_tokens (
    id          uuid primary key,
    user_id     uuid not null references users(id) on delete cascade,
    token_hash  varchar(64) not null unique,
    expires_at  timestamptz not null,
    consumed_at timestamptz,
    created_at  timestamptz not null,
    updated_at  timestamptz not null
);
create index idx_password_reset_tokens_user on password_reset_tokens(user_id);
create index idx_password_reset_tokens_expires on password_reset_tokens(expires_at);

-- 필수 (이용약관·개인정보처리방침) 동의 시각 + 문서 버전, 선택 (마케팅 수신) 동의 시각. Existing rows: null =
-- consented before the record existed (re-consent is a launch decision, §7).
alter table users add column terms_accepted_at timestamptz;
alter table users add column terms_version varchar(40);
alter table users add column marketing_consent_at timestamptz;
