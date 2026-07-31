# tools/naver-local — NAVER guided-connection walkthrough scaffolding

Disposable local scaffolding for the **NAVER API order-connection** guided walkthrough. It boots a
throwaway backend and runs a fail-closed preflight so a walkthrough never starts against a stale port,
the real database, a running scheduler, or a dirty baseline.

**The NAVER order connection needs NO Local Agent.** These scripts stand up the backend + frontend for
the browser walkthrough only. Nothing here calls the NAVER API, enters a credential, or runs a sync —
those are separate, operator-approved actions performed in the browser.

## One-time setup

Store the disposable vault master key in the macOS Keychain (never in the repo):

```
security add-generic-password -s sellerops-vault-master-key -a naver-walk-1 \
  -w "$(openssl rand -base64 32)"
```

Create a disposable Postgres database (e.g. on port 55432) named `naver_walkthrough`. Never point at the
real sellerops instance (`:5432/sellerops`).

## Server steps (operator runs these; Claude does not run live)

1. **Backend** (fixed port 18090, NAVER on, scheduler off, key from Keychain):
   ```
   tools/naver-local/run-backend-local.sh
   ```
2. **Frontend** — same-origin `/api` proxy pinned to that backend. Leave `VITE_API_BASE_URL` UNSET:
   ```
   cd frontend
   SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:18090 npm run dev
   ```
3. **Preflight** — run BEFORE opening the browser; it must print `PREFLIGHT PASS`:
   ```
   SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:18090 \
   SELLEROPS_COLLECT_SCHEDULER_ENABLED=false \
   SELLEROPS_CONNECTOR_NAVER_ENABLED=true \
   PGPORT=55432 PGDATABASE=naver_walkthrough \
   tools/naver-local/preflight.sh
   ```

## What preflight checks (all must PASS)

1. Backend `/health` UP.
2. Frontend `/api` reachable through the dev proxy.
3. Single base URL — no absolute `VITE_API_BASE_URL` diverging from the proxy; proxy target == backend origin.
4. Disposable DB (never `:5432/sellerops`).
5. Collection scheduler OFF.
6. NAVER connector flag ON.
7. Pristine baseline — `connector_credentials`, `sync_jobs`, `channel_orders`, and NAVER seller accounts all 0.

## Operator vs server boundary

- **Server steps** (above): start backend, start frontend, run preflight. No live NAVER contact.
- **Operator steps** (browser, after a fresh single-use approval): enter the real Application ID/Secret in
  the wizard's masked field, run the one connection test, run the one first `ORDER_SUMMARY` sync. The
  credential is typed only into the UI — never printed, never written to a file, never passed on a CLI.
