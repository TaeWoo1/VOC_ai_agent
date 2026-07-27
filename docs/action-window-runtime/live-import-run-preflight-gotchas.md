# Live initial-review-import run — preflight & gotchas

> Purpose: the trial-and-error from the first end-to-end live run of the supervisor-wired import path
> (2026-07-27, PR #365) so future live runs skip it. Grants nothing — a live run still needs a fresh,
> single-use, in-turn approval (root `CLAUDE.md`; `collector/CLAUDE.md` §4). Standing safety unchanged.
> Every step below is local/offline until the explicit launch; the seller performs all NAVER actions.

## The product-path chain (what talks to what)

```
disposable Postgres DB  ←  Backend :8080  ←(API, CORS)—  Frontend :FE (bridge mode)  —(bridge, origin policy)→  Collector agent :BRIDGE
                                                                    │ opens in →  headed Chrome (SellerOps tab + NAVER tab)
```
Four independently-configured surfaces (backend, frontend, bridge, browser). Most of the trial-and-error was
**port / origin mismatch** between them — pick the ports once and set every override consistently.

## Preflight checklist (all read-only / local; no marketplace contact)

1. **Postgres up** (`pg_isready`). Create a **name-guarded disposable DB** (`sellerops_<slug>_<ts>`); never
   touch the persistent `sellerops` DB. Teardown = `dropdb` after.
2. **Backend** on `:8080` against the disposable DB. It seeds org/user/NAVER via `MockDataSeeder` on an empty
   DB (demo `demo@sellerops.ai` / `demo1234`). **Do not use `/actuator/health`** — it is unmapped and returns
   500; probe readiness with a real call (`POST /api/auth/login`).
3. **Ticket** via the real API (no DB insert): login → `GET /api/seller-accounts` (NAVER id) →
   `POST /api/imports/reviews/plans/selected-range {sellerAccountId, startMonth}` →
   `POST /api/imports/reviews/plans/{planId}/launches/next-segment` → `launchRef`. Verify the collector's own
   `resolveScope` (`loadConfig` + `login` + `fetchLaunchScope`) returns `{kind:SEGMENT, channelCode:naver, …}`.
4. **Pick ports and set EVERY override** (below). Confirm the FE origin passes **both** backend CORS **and**
   the bridge origin policy with an `OPTIONS`/health curl carrying `Origin: <FE origin>` — expect 200, not 403.

## Gotchas (each cost a cycle on 2026-07-27)

1. **Contracts loaded as CommonJS → `export *` barrels break static named imports.** `tsx` boot crashed:
   `module '…/contracts/session-readiness/v1/index' does not provide an export named 'readinessObservation'`.
   Root cause: `contracts/` had no `package.json`, so its `.ts` loaded as CJS and `export *` became a dynamic
   re-export whose names a static `import { … }` can't see. **Fixed in-repo:** added `contracts/package.json`
   `{"type":"module"}` (PR #365). `action-window/v2` avoided it by listing explicit exports. Guard: if a barrel
   uses `export *`, it must resolve as ESM at runtime.
2. **Frontend `.env.local` points elsewhere.** It set `VITE_API_BASE_URL=http://127.0.0.1:18090` (a dead port
   from a prior setup) and `VITE_BRIDGE_URL=http://127.0.0.1:47615` (a stale agent) — so browser login silently
   failed (never reached `:8080`). Vite shell env **overrides** `.env.local`, so launch the FE with explicit
   `VITE_API_BASE_URL=http://localhost:8080 VITE_BRIDGE_URL=http://127.0.0.1:<BRIDGE>`. (`.env.example` is
   ignored by Vite; only `.env` / `.env.local` load.)
3. **Backend CORS is single-origin, default `:5173`.** A FE on any other port gets `403` on preflight → "login
   doesn't work". Set `SELLEROPS_CORS_ORIGIN=http://localhost:<FE>` on the backend. Keep `localhost` vs
   `127.0.0.1` consistent with the FE origin — they are different origins to CORS.
4. **Bridge origin policy is also default `:5173`.** Even after CORS, the bridge rejects pairing from another FE
   port. Set `BRIDGE_ALLOWED_ORIGINS="http://localhost:<FE> http://127.0.0.1:<FE>"` on the agent.
5. **A stale agent may already hold the default bridge `:47615`.** The new agent then logs
   `bridge … skipped … already_running` and the FE pairs with the wrong (old-code) agent. Check
   `lsof -iTCP:47615`; run the new agent on a fresh `BRIDGE_PORT` and point the FE's `VITE_BRIDGE_URL` at it.
   The agent uses a persistent Chrome profile (single lock) — kill your own prior agent before relaunching.
6. **Session-probe timing.** The run probes the NAVER session the instant it starts. If the seller has not
   finished NAVER login, the probe reads not-usable → `SESSION_FAILURE` (`EXPIRED`/`LOGIN_REQUIRED`). **Best
   practice:** the seller logs into NAVER **before** pressing start, so the first probe reads READY.
   **Recovery is now clean (FIXED in PR #365, live-verified 2026-07-27):** a recoverable session block parks at
   `SESSION_BLOCKED`, not terminal `FAILED`. The card/panel offers 다시 확인 (`REQUEST_STEP_RECHECK`); after the
   seller logs in, pressing it re-runs the session probe on the **same segment and ticket** (`READY`,
   `MANUAL_RECHECK`) and the run resumes — no ticket expire, no re-mint, no fresh run. Live-verified in a
   logged-out-first run: `SESSION_FAILURE` (park, `RUN_FAILED`=0) → a still-logged-out 다시 확인 re-parks safely →
   post-login 다시 확인 → `MANUAL_RECHECK` → `upload.segment.done {SUCCEEDED}`; ticket `CONSUMED` once. To exercise
   this deliberately, launch the agent on a **fresh in-tree profile** (e.g. `COLLECTOR_PROFILE_DIR=$(pwd)/.profile/naver-<slug>`)
   so NAVER starts logged out, and press 시작하기 before logging into NAVER.
   *Historical note (2026-07-27, before the fix):* the block was then terminal `FAILED` (no commands, ticket
   stuck OPEN), and recovery required a manual `POST /api/imports/reviews/launches/{ref}/expire` → FE re-mint →
   start again. That workaround is no longer needed.
7. **Launching the live agent is gated by the Claude Code classifier** (separate from the product approval).
   Expect a permission prompt on `npm run local-agent -- … --i-understand-this-opens-live-naver`; the operator
   allows it (or adds a Bash rule) once per session, or runs the command themselves.

## The launch command that worked (2026-07-27)

FE (bridge mode, overrides): `VITE_API_BASE_URL=http://localhost:8080 VITE_BRIDGE_URL=http://127.0.0.1:47620 npm run dev:bridge -- --port 5174`
Backend: `SELLEROPS_CORS_ORIGIN=http://localhost:5174 SPRING_DATASOURCE_URL=…/<disposable-db> ./gradlew bootRun`
Agent: `NAVER_REVIEW_URL=<from naver-surface-urls.md> SELLEROPS_APP_URL=http://localhost:5174 BRIDGE_PORT=47620 BRIDGE_ALLOWED_ORIGINS="http://localhost:5174 http://127.0.0.1:5174" npm run local-agent -- --action-window-initial-review-import --i-understand-this-opens-live-naver --dev-insecure-auto-approve`

Seller steps in the opened Chrome: log into SellerOps (demo creds) → 과거 리뷰 가져오기 → agent pairs (dev
auto-approve) → select NAVER account → **log into NAVER first** → press 이 기간으로 시작하기.

## Teardown

Drop the disposable DB (name-guarded — refuse `sellerops`/`sellerops_dev`); stop the agent, FE, backend; the
Chrome profile is gitignored (never stage `.profile/`, `.status/`, `.import-runs/`, downloads).
