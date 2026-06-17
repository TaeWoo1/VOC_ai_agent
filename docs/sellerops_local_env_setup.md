# SellerOps — Local Environment Setup (Live-Smoke Preparation)

Written at HEAD `027a2ca`. This document prepares the **local environment
structure only** — it does not authorize or perform any live API call.
Running the actual Naver live smoke requires separate explicit operator
authorization and follows `docs/sellerops_phase3c_live_smoke.md`.

---

## 1. File layout — where secrets live

| File | In git? | Purpose |
|---|---|---|
| `backend/.env.example` | tracked | Template with placeholders only — never real values |
| `backend/.env.local` | **git-ignored** | Your real local values. Create it by copying the template |
| root `.env` | git-ignored | Python review-ops app + docker-compose stack env — do **not** put Naver secrets here (docker compose auto-reads it) |
| root `.env.example` | tracked | Template for the docker-compose stack (DB/JWT/frontend) |

`.gitignore` ignores `.env` and `.env.local` **unanchored** (every directory
level), so `backend/.env.local` can never be staged by a normal `git add`.
Verify any time with:

```bash
git check-ignore -v backend/.env.local   # must print a .gitignore match
```

## 2. Create your real env file

```bash
cp backend/.env.example backend/.env.local
```

Then fill in `backend/.env.local`:

| Key | What to put there |
|---|---|
| `SPRING_DATASOURCE_URL/USERNAME/PASSWORD` | Local Postgres (defaults match the compose stack) |
| `SELLEROPS_JWT_SECRET` | Any long random string for local use |
| `SELLEROPS_VAULT_MASTER_KEY` | `openssl rand -base64 32` — local throwaway AES-256 key. Required before storing any credential; empty = vault fails closed |
| `SELLEROPS_COLLECT_SCHEDULER_ENABLED` | Keep `false` (manual sync only) |
| `SELLEROPS_CONNECTOR_NAVER_ENABLED` | Keep `false` until the authorized smoke session |
| `NAVER_COMMERCE_CLIENT_ID` / `NAVER_COMMERCE_CLIENT_SECRET` | The throwaway credentials issued in Naver Commerce API Center — **only when the smoke is actually scheduled**, not before |

Important: the backend **never reads the two `NAVER_COMMERCE_*` variables**.
They are shell-side staging only (see §6). The connector reads credentials
exclusively from the encrypted `CredentialVault`.

## 3. Load the env into your shell

Spring Boot does not read `.env` files natively. Load before starting:

```bash
set -a; source backend/.env.local; set +a
```

(`set -a` exports every variable the file defines; `set +a` turns that off
again.) This must happen in the same shell that starts the backend.

## 4. Start PostgreSQL

Either the compose service only:

```bash
docker compose up -d postgres
```

or a native local Postgres with a `sellerops` database matching the
`SPRING_DATASOURCE_*` values (`createdb sellerops` + matching user/password).

## 5. Start the backend and confirm it is running

```bash
set -a; source backend/.env.local; set +a
cd backend && ./gradlew bootRun
```

Confirm:

```bash
curl -s http://localhost:8080/health          # → {"status":"ok"} style response
# Seeded demo login (created on an empty DB by MockDataSeeder):
curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@sellerops.ai","password":"demo1234"}'
```

With all connector flags at their defaults this runtime is byte-identical to
the mock-only stack — no real channel can be reached.

## 6. Storing Naver credentials into the vault (later — placeholders only)

Credential flow, end to end:

```
backend/.env.local  →  operator's shell (curl)  →  POST /api/seller-accounts/{accountId}/credentials
                                                      │  (write-only intake; response = masked metadata)
                                                      ▼
                                            CredentialVault (AES-256-GCM, key = SELLEROPS_VAULT_MASTER_KEY)
                                                      │
                                                      ▼
                                  NaverApiConnector calls vault.open(...) at fetch time
```

When (and only when) the smoke session is authorized:

```bash
set -a; source backend/.env.local; set +a

# 1. JWT
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@sellerops.ai","password":"demo1234"}' | jq -r '.token')

# 2. Find the NAVER seller-account id
curl -s http://localhost:8080/api/seller-accounts -H "Authorization: Bearer $TOKEN"

# 3. Write-only intake — secrets come from the env, never typed inline
curl -s -X POST "http://localhost:8080/api/seller-accounts/<ACCOUNT_ID>/credentials" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"connectorClass\":\"API\",\"authType\":\"OAUTH2\",
       \"secrets\":{\"client_id\":\"$NAVER_COMMERCE_CLIENT_ID\",
                    \"client_secret\":\"$NAVER_COMMERCE_CLIENT_SECRET\"}}"
```

The response contains masked metadata only — secrets are never echoed back,
and there is no read-back API by design.

## 7. Triggering the live smoke (later — separate authorization required)

Follow `docs/sellerops_phase3c_live_smoke.md` end to end. In env terms:

1. Set `SELLEROPS_CONNECTOR_NAVER_ENABLED=true` in `backend/.env.local`,
   re-source, restart the backend (scheduler stays `false`).
2. One manual sync:
   `POST /api/seller-accounts/<ACCOUNT_ID>/sync` with
   `{"dataType":"ORDER_SUMMARY"}`.
3. Rollback per runbook §I: flag back to `false`, restart, rotate/revoke the
   throwaway credentials in Naver API Center, then **delete the
   `NAVER_COMMERCE_*` values from `backend/.env.local`**.

## 8. What must never be committed

- A filled-in `backend/.env.local`, root `.env`, or any file containing a
  real `client_id`/`client_secret`/vault master key/JWT secret.
- Secrets in code, fixtures, docs, commit messages, or terminal transcripts
  pasted into issues/chat.
- `.env.sellerops`, `review_*.xlsx`, or anything from the standing
  never-stage list.
- Only `*.example` templates with placeholders belong in git. Before every
  commit: `git status --short` + `git diff --cached` and check no secret
  value appears.
