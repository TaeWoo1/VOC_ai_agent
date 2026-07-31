# tools/naver-local — NAVER guided-connection walkthrough scaffolding

Disposable local scaffolding for the **NAVER API order-connection** guided walkthrough. It boots a
throwaway backend and runs a fail-closed preflight — ending in a **real browser UI-login smoke** — so a
walkthrough never starts against a stale port, the real database, a running scheduler, a dirty baseline,
or a login that only *looks* reachable.

**The NAVER order connection needs NO Local Agent.** These scripts stand up the backend + frontend for
the browser walkthrough only. Nothing here calls the NAVER API, enters a credential, or runs a sync —
those are separate, operator-approved actions performed in the browser.

## Single-run contract (fixed for the whole walkthrough)

- **Frontend origin = `http://localhost:5173`** — the ONLY origin the backend CORS allows
  (`SELLEROPS_CORS_ORIGIN` default). `127.0.0.1:5173` is rejected (CORS 403) and must not be used.
- **Backend origin = `http://127.0.0.1:18090`** (fixed port).
- **Same-origin `/api` Vite proxy only.** `VITE_API_BASE_URL` must be UNSET in every dev env file
  (`.env`, `.env.local`, `.env.development`, `.env.development.local`).
- **No port changes mid-run.** The preflight does not auto-edit `.env.local`; a stale override FAILs the
  preflight and the human fixes it.

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
2. **Frontend** — same-origin `/api` proxy pinned to that backend. Leave `VITE_API_BASE_URL` UNSET, and
   open the app at **http://localhost:5173** (not 127.0.0.1):
   ```
   cd frontend
   SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:18090 npm run dev
   ```
3. **Preflight** — run BEFORE opening the browser; it must print `PREFLIGHT PASS`. It runs a real
   clean-context browser login as its final gate (needs Node + the Playwright chromium bundled in
   `collector/node_modules`):
   ```
   SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:18090 \
   SELLEROPS_FRONTEND_ORIGIN=http://localhost:5173 \
   SELLEROPS_COLLECT_SCHEDULER_ENABLED=false \
   SELLEROPS_CONNECTOR_NAVER_ENABLED=true \
   PGPORT=55432 PGDATABASE=naver_walkthrough \
   tools/naver-local/preflight.sh
   ```

## What preflight checks (all must PASS; browser login is the final gate)

0. Frontend origin is the approved `http://localhost:5173` (127.0.0.1 → FAIL).
1. Backend `/health` UP.
2. Frontend `/api` reachable through the dev proxy.
3. Single base URL — no absolute `VITE_API_BASE_URL` in any dev env file; proxy target == backend origin.
4. Disposable DB (never `:5432/sellerops`).
5. Collection scheduler OFF.
6. NAVER connector flag ON.
7. Pristine baseline — `connector_credentials`, `sync_jobs`, `channel_orders`, and NAVER seller accounts all 0.
8. **Browser UI login smoke (mandatory)** — `ui-login-smoke.mjs`: clean-context UI login on the approved
   origin → authenticated shell → NAVER card at `연결하기`, with **0 NAVER API calls** and 0 credential
   access. On failure the preflight exits `PREFLIGHT FAIL: browser_login`.

The preflight also writes a **sanitized runtime manifest** (`$SELLEROPS_MANIFEST_OUT`, default a temp
file): git commit, frontend/backend origins, disposable DB, scheduler, NAVER flag, baseline counts, and
the browser-login-smoke result. No secret/token/credential/NAVER value is recorded.

## Regression self-check

`preflight-selfcheck.sh` proves the gate fails closed on each wrong environment and passes only when
correct (requires the backend + frontend up, like a real preflight):

```
tools/naver-local/preflight-selfcheck.sh
```

Cases: `WRONG_HOST` / `STALE_OVERRIDE` / `WRONG_PROXY` / `BAD_LOGIN` (health green but UI login fails) → FAIL;
`NORMAL` → PASS with 0 NAVER calls.

## Operator vs server boundary

- **Server steps** (above): start backend, start frontend, run preflight (incl. the clean-context UI-login
  smoke — a throwaway browser context, not the operator's browser). No live NAVER contact.
- **Operator steps** (browser, after a fresh single-use approval): open **http://localhost:5173/connect/naver**,
  enter the real Application ID/Secret in the wizard's masked field, run the one connection test, run the
  one first `ORDER_SUMMARY` sync. The credential is typed only into the UI — never printed, never written
  to a file, never passed on a CLI.
