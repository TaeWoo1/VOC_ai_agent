# Cafe24 local backend bootstrap

Prepares and boots the local backend for the Cafe24 INQUIRY/REVIEW read proof
against the **disposable** `cafe24_phaseb` database, with the vault master key
and app secrets sourced from the macOS Keychain — never from the repository.

Its purpose is to make the run-time failure **"자격 증명 복호화에 실패했습니다"**
(a backend whose vault master key does not match the key that sealed the stored
credential) impossible to reach silently: the boot **fails closed** unless the
configured master key actually decrypts the stored credential.

## Files
- `check_credential_decryptable.py` — boolean-only pre-boot gate. Reads the
  master key from `SELLEROPS_VAULT_MASTER_KEY` and the credential envelope hex
  from stdin, prints `decryptable=true|false`, and exits non-zero when not
  decryptable. Never prints the key, the envelope, or any plaintext.
- `run-backend-local.sh` — loads secrets from Keychain, pins the disposable
  config, runs the gate, and only then boots. No Cafe24 API call, no `/backfill`,
  no credential write.
- `.env.example` — variable names and usage only.

## Keychain items to create (values never leave your machine)
| service | account | value |
|---|---|---|
| `sellerops-vault-master-key` | `local-dev-1` (the key-id) | base64-encoded 32-byte AES-256 master key |
| `sellerops-cafe24-db` | `sellerops` | disposable DB password (optional under local trust auth) |
| `sellerops-cafe24-oauth` | `client-id` | Cafe24 app client id |
| `sellerops-cafe24-oauth` | `client-secret` | Cafe24 app client secret |

The **account** for the master-key item is the credential's `encryption_key_id`
(currently `local-dev-1`); the run script asserts stored key-id == configured
key-id before the decryptability gate.

```sh
# example — populate the master key from the recovered local key file, ONLY after
# you have confirmed it is the correct key (decryptable=true):
security add-generic-password -s sellerops-vault-master-key -a local-dev-1 \
  -w "$(cat ~/.sellerops/vault_master_key)"

security add-generic-password -s sellerops-cafe24-oauth -a client-id     -w '<client-id>'
security add-generic-password -s sellerops-cafe24-oauth -a client-secret -w '<client-secret>'
```

## Run
```sh
bash tools/cafe24-local/run-backend-local.sh
```
On a master-key mismatch the script prints a fail-closed message and does **not**
boot. Aligning the key means either loading the correct existing key into the
Keychain item above, or — if the correct key cannot be recovered — re-running the
Cafe24 OAuth connect flow to re-store the credential under the current key
(never edit `encrypted_payload` by hand).

### Recovery when the correct key is unrecoverable (current state)
The only local key candidate (`~/.sellerops/vault_master_key`) was verified
**not** to decrypt the stored credential, and no Keychain item exists — so the
key that sealed the current credential is unrecoverable locally. Recover by
re-storing the credential via Cafe24 OAuth under a fresh, Keychain-managed key:

1. Generate a master key and store it in the Keychain (owner-only):
   ```sh
   security add-generic-password -s sellerops-vault-master-key -a local-dev-1 \
     -w "$(python3 -c 'import os,base64;print(base64.b64encode(os.urandom(32)).decode())')"
   ```
2. Boot once in re-key mode so the gate does not block on the stale credential:
   ```sh
   SELLEROPS_BOOTSTRAP_ALLOW_REKEY=true bash tools/cafe24-local/run-backend-local.sh
   ```
3. Run the Cafe24 OAuth connect flow for 전선몰딩 (operator-driven) to re-store the
   credential under the new key. This is a credential write and a channel action —
   it needs its own approval and is **out of scope** for the key-alignment prep.
4. Restart normally (gate ON) and confirm `decryptable=true`, then seek fresh
   live-backfill approval.

## Standalone decryptability check (no boot)
```sh
SELLEROPS_VAULT_MASTER_KEY="$(security find-generic-password -s sellerops-vault-master-key -a local-dev-1 -w)" \
PGHOST=127.0.0.1 PGPORT=55432 PGDATABASE=cafe24_phaseb PGUSER=sellerops \
sh -c 'psql -tAc "select encode(encrypted_payload,'"'"'hex'"'"') from connector_credentials limit 1;" \
  | tr -d "[:space:]" | python3 tools/cafe24-local/check_credential_decryptable.py'
```
Prints only `decryptable=true|false`.
