-- A key id is a label a deployment picks; it is not proof of which key sealed a row.
--
-- The demo org proved the difference the expensive way: four credentials all carried
-- encryption_key_id = 'local-dev-1', a Keychain entry of exactly that name existed, and it was not
-- the key that sealed them. Because CredentialVault.open() never consulted the column at all, the
-- symptom was one opaque GCM failure — identical whether the key was absent, wrong, or the payload
-- damaged — and telling those apart took a full audit.
--
-- The fingerprint is a one-way HMAC-SHA256 of a fixed label under the master key, truncated and
-- base64url-encoded. It identifies a key and carries no part of it, so it is safe to store, log and
-- show. Comparing it to the fingerprint of the material a runtime holds answers "same key?" without
-- attempting decryption, which is what makes KEY_MISMATCH a proof rather than an inference.
--
-- Nullable and un-backfilled on purpose: computing it for an existing row requires the key that
-- sealed it, which is precisely what is in question. Rows stay unverifiable until they are next
-- written; this migration does not touch a single stored secret.
alter table connector_credentials
    add column if not exists encryption_key_fingerprint varchar(64);

comment on column connector_credentials.encryption_key_fingerprint is
    'Non-secret HMAC fingerprint of the master key that sealed this row. Null = sealed before V53.';
