# Pilot Host Provisioning v1 — PREPARE

2026-08-27 · deployment only · **no cloud resource created**. Product/UI development is stopped; this
package prepares the minimum runtime for the first 3–5 external sellers up to the line where a billable
resource would be created, and stops there (§16).

## 1. Current deployment audit (re-derived from HEAD, not from memory)

| Item | State at HEAD |
|---|---|
| `docker-compose.yml` | 4 services: `postgres:16-alpine` (named volume `sellerops_pgdata`, healthcheck), `backend` (health gate on `/health`), `agent-runtime` (production mode, spring run store, `depends_on backend healthy`), `frontend` (nginx:alpine serving the Vite build). **Every service publishes a host port: 5432 · 8080 · 8787 · 5173.** No `restart` policy on any service. |
| `backend/Dockerfile` | multi-stage Gradle → `eclipse-temurin:17-jre`, `java -jar`, **no heap setting** (JVM default = ¼ of container RAM). |
| `frontend/Dockerfile` + `nginx.conf` | build args incl. `VITE_AGENT_RUNTIME_URL` (Pilot Runtime Foundation §11); nginx serves the SPA with security headers; **no proxy, no TLS** — the SPA calls same-origin `/api/*` (`apiClient.ts` `BASE_URL=""`, dev proxy in `vite.config.ts`) and `${VITE_AGENT_RUNTIME_URL}/api/agent-runs` for the runtime. |
| `agent-runtime/Dockerfile` | node:20-slim + tsx, `/health` (liveness) and `/ready` (backend reachability), image `HEALTHCHECK`. Holds no credential. |
| PostgreSQL | container, named volume; `docker compose down` (no `-v`) keeps it. **No backup seam anywhere in the repo** (`pg_dump` appears in no script or doc). |
| Reverse proxy | none at the edge. The only nginx is the frontend's static server. `infra/compose/docker-compose.local.yml` is the legacy VOC prototype stack (Redis/Qdrant) — not this product. |
| Health | backend `GET /health` → `{"status":"UP"}` (public, `SecurityConfig` permits `/health` and `/actuator/health`; actuator itself is not on the classpath); runtime `/health`, `/ready`; postgres `pg_isready`. |
| Env contract | `.env.example` names only (Pilot Runtime Foundation §3); `PilotConfigValidator` refuses boot when a connector is ON without vault key / NAVER advertised IP / Cafe24 app credentials / non-loopback HTTPS redirect URI. Demo fixture default OFF. |
| Cafe24 callback | **`GET /api/connect/cafe24/callback`** on the backend (`Cafe24ConnectController`, `@RequestMapping("/api/connect/cafe24")`), then a browser redirect to `SELLEROPS_CONNECTOR_CAFE24_RESULT_URL` (frontend route `/connect/cafe24/result`). `tools/cafe24-callback` is a dev receiver on a different path that exchanges nothing — not the product callback. |
| NAVER egress | backend calls NAVER on the JVM's default socket — no proxy, no pinning; the egress IP **is the host's public IPv4**. `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS` is what the connect screen tells sellers to register and must equal that address. |
| Deploy docs/scripts | `docs/pilot_runtime_foundation_v1.md` §10 (minimum topology, operator steps) · §12 (runbook); `docs/sellerops_local_to_pilot_connectivity_decision.md` (EC2/Lightsail + fixed IP, callback host fixed, tunnel is not canonical); `tools/dev/local-stack.sh` is a dev-only launcher. **No deploy script, no host bootstrap, no smoke test.** |
| AWS | no `aws` CLI on the operator machine and no credentials file ⇒ **existing AWS resources could not be audited from here**. If an account/resources exist, the product owner states it and the audit is a read-only `describe-*` pass next turn. |

## 2. Proposed pilot topology

One EC2 instance · one Elastic IP · one DNS A record · one compose stack (`docker-compose.yml` +
`deploy/pilot/docker-compose.pilot.yml`) · one edge (Caddy) · Postgres container on a named volume on
the instance's EBS root volume. No load balancer, no RDS, no registry, no CI/CD.

```
internet ──443/80──▶ edge (Caddy, TLS)
                      ├─ /api/*, /health ───────▶ backend:8080  (Spring; Cafe24 callback lands here)
                      ├─ /agent-runtime/* ──────▶ agent-runtime:8787 (prefix stripped)
                      └─ /* ────────────────────▶ frontend:80   (nginx, SPA)
                                                  backend ──▶ postgres:5432 (compose network only)
                                                  backend ──▶ NAVER / Coupang / Cafe24 APIs  (egress = Elastic IP)
```

**Same-origin is the smallest change** — audited: the SPA already calls `/api/*` relative; the runtime
URL is a build arg; setting it to `https://PILOT_PUBLIC_HOST/agent-runtime` makes `csp.ts` derive the
site's own origin (no extra `connect-src`), the runtime's CORS list becomes irrelevant, and the
backend's `SELLEROPS_CORS_ORIGIN` is set to the same origin for completeness. **Zero frontend/backend/
runtime code change.**

## 3. Host sizing

Measured/known assumptions: Spring Boot backend with Flyway + JPA + connectors (idle heap ~400–600 MB,
image build's Gradle stage peaks >2 GB), Postgres 16 (small DB; `shared_buffers` capped at 256 MB in the
overlay), agent-runtime (Node, <200 MB), frontend nginx (<20 MB), Caddy (<50 MB), connector workloads are
HTTP polling at a 60-minute cadence per account — I/O, not CPU.

**Recommendation: `t3.medium` (2 vCPU, 4 GB) with a 2 GB swapfile and a 30 GB gp3 root volume**, x86_64
so the existing images build as-is. Not `t3.small`: 2 GB with a 1 GB JVM heap + Postgres + a Gradle
build on the same box is the memory-pressure instability §3 forbids. Not `m`-class: 3–5 sellers at an
hourly poll do not need sustained CPU; burstable at `medium` has headroom (unlimited-mode off to keep
cost bounded). The JVM heap is pinned explicitly (`-Xmx1024m`, SerialGC) in the overlay so the backend
cannot grow into Postgres. No price is stated here; the class and the reason are the deliverable.

## 4. Public / private port map

| Port | Where | Exposure |
|---|---|---|
| 443 | edge | public (TLS) |
| 80 | edge | public (ACME HTTP-01 + redirect to 443) |
| 22 | host | **not world-open**: prefer SSM Session Manager (no inbound rule) or a security-group rule limited to the operator's current IP |
| 5432 / 8080 / 8787 / 5173(80) | containers | compose network only — the overlay `!reset`s the root file's published ports; `smoke.sh` asserts none is listening on the host |

## 5. Reverse proxy / TLS

Reused seam: the frontend's nginx stays exactly what it is (static SPA server). For the **edge**, an
nginx+certbot pairing needs a certbot sidecar, a shared cert volume, a renewal timer and a reload hook —
four moving parts; Caddy is one container, one 30-line `Caddyfile`, automatic issuance and renewal, and
HTTP→HTTPS redirect built in. That is the "clearly smaller" case §5 names, so `deploy/pilot/Caddyfile`
is the edge. Certificates persist in the `sellerops_caddy_data` volume across redeploys.

## 6. Cafe24 callback — exact plan

- Production callback = **`https://PILOT_PUBLIC_HOST/api/connect/cafe24/callback`** — the existing backend
  route, reached through the edge's `/api/*` handle. No new application, no new route.
- The overlay derives `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI` and `_RESULT_URL` from `PILOT_PUBLIC_HOST`;
  `PilotConfigValidator` still refuses a boot with Cafe24 ON and a non-HTTPS/loopback URI.
- **Operator external step:** register that exact URI (byte-identical) in the Cafe24 Developers app used
  for the pilot. Whether that is the same app the Demo Org is connected with is a product-owner call
  (`docs/disconnected_channel_onboarding_v1.md` §14: a second OAuth grant on the same (app, mall) is
  vendor behaviour this repo cannot prove). **The Demo Org's working OAuth token is not re-authenticated
  or invalidated by anything in this package**, and callback proof will use a pilot seller's mall, not
  the demo connection.

## 7. NAVER fixed egress plan

The Elastic IP is the instance's public IPv4 and — with the default VPC / no NAT gateway — its outbound
address; containers use the host's default route, so backend egress == Elastic IP. `deploy/pilot/
egress-check.sh` proves it after deploy: host outbound and a container on the compose network both hit
`checkip.amazonaws.com` and must agree, and must be listed in `SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS`
before `SELLEROPS_CONNECTOR_NAVER_ENABLED=true` (deploy.sh enforces the name being set; the check
enforces the value). Re-run after reboot and after redeploy (§2.3 of the connectivity decision).
**Registering the IP in a NAVER application is an operator external step; nothing here touches a NAVER
app, and the existing dev IP is not assumed removed.**

## 8. Domain requirement

Product-owner input: one DNS name (`PILOT_PUBLIC_HOST`). Required records: **A `PILOT_PUBLIC_HOST` →
Elastic IP** (TTL 300). No wildcard, no CNAME chain needed, no AAAA (egress contract is IPv4). If the zone
is on Route 53 that hosted zone is a billable resource (§20). Callback shape once decided:
`https://PILOT_PUBLIC_HOST/api/connect/cafe24/callback`. No domain was invented anywhere; `pilot.invalid`
appears only as a placeholder in the local `compose config` render.

## 9. Secrets

`/etc/sellerops/pilot.env` (0600, root or deploy user; `host-bootstrap.sh` creates it empty) holds DB
password, JWT secret, vault master key, Cafe24 app secret; compose reads it via `--env-file`. It is not
under the repo, `.gitignore` also refuses `deploy/pilot/pilot.env` copies. Images bake no secret (build
args are the public host and vendor keys only; the backend image is the jar; the runtime image is source).
**Frontend needs no secret — P0 check passed** (`VITE_*` are public host/vendor ids). `deploy.sh` prints
names, never values, and refuses the repository's placeholder JWT.

## 10. DB persistence

`sellerops_pgdata` named volume on the instance root EBS volume. `docker compose down` / `up` / image
rebuild / host reboot keep it; only `down -v` or `docker volume rm` deletes it, and neither appears in any
script here. Container deletion ≠ DB deletion.

## 11. Backup / restore

`deploy/pilot/backup.sh` — daily `pg_dump -Fc` via cron (`/etc/cron.d/sellerops-backup`, **03:17 KST**
— the cron file pins `CRON_TZ`/`TZ` to `Asia/Seoul`; the HOST's zone is not set by this repository and
is UTC on this image, so the schedule names its own zone rather than inheriting one) into
`/var/backups/sellerops` (0700), 14-day retention. The dump holds sealed credentials and seller data, **no
env secret** — the vault master key lives only in `pilot.env`, which is the operator's to keep alongside
(a restore with a different key opens nothing, by design). Off-host copy (S3) is billable and deferred
(§20). `deploy/pilot/restore.sh <dump>` stops writers, recreates the schema, `pg_restore`s, restarts,
and asks for a typed `RESTORE`. Both paths are to be exercised once on the host before the first seller.

## 12. Startup / restart

`docker compose … up -d` (in `deploy.sh`) starts the five services; `restart: unless-stopped` on all,
Docker enabled by `systemctl` ⇒ a host reboot restores the stack without an operator. Backend health ==
validator green (a refused boot never becomes healthy); the runtime waits on it; the edge on all three.

## 13. Deployment procedure (`deploy/pilot/deploy.sh`)

1 `git pull --ff-only` → 2 env validation (file mode 0600, required names, placeholder JWT refused,
demo seed must be false, connector-on ⇒ vault key present) → 3 `compose build --pull` → 4 `up -d`
(Flyway migrates on boot) → 5 wait for backend healthy (≤300 s, prints last log lines on refusal) →
6 `smoke.sh`. Re-runnable.

## 14. Smoke test plan (`deploy/pilot/smoke.sh`, no credential, no WRITE)

HTTPS frontend 200 · HTTP→HTTPS · backend `/health` UP via edge · runtime `/health` + `/ready` · demo
entry OFF (`/api/auth/demo/config`) · Cafe24 callback route reachable through the edge (not 404/502) ·
anonymous API refused · raw ports not listening on the host · pg volume present · restart policy on all
five · backend healthy (validator) · `egress-check.sh`. Manual browser steps listed at the end: signup →
disconnected home → deterministic command → free-text READ-only run. Steps needing a real marketplace
credential are **not** in the smoke test; they belong to §15.

## 15. First seller manifest (reusable; values never in the repo)

| # | Step | Green when |
|---|---|---|
| 1 | Signup (`/signup`) | org with 0 accounts/inquiries/reviews; demo entry absent from login |
| 2 | Chosen channel connection (PRIMARY Cafe24; NAVER needs its IP registered; Coupang keys + IP) | account `CONNECTED`; Cafe24 callback returned through the edge |
| 3 | Initial acquisition | completion card numbers from the terminal run |
| 4 | Recurring acquisition | `sync_schedules` rows appear on the next reconcile tick (`CONNECTED_SELLERS`, no env edit) |
| 5 | Source summary | 「가져왔습니다 / 없습니다 / 아직 확인하지 못했습니다」 |
| 6 | Home briefing | arithmetic sentence, model 0 |
| 7 | Deterministic Agent command | object, run 0 |
| 8 | Optional free-text investigation | planner 1, tools READ only, marketplace 0 |
| 9 | Inquiry draft | one of the three answer states |
| 10 | Knowledge gap (if hit) | 「답변 기준 추가」 → regenerate |
| 11 | Human Approval | approval bound to the draft fingerprint |
| 12 | Supported-channel execution | **separate explicit WRITE approval** (`docs/sellerops_live_approval_contract.md`); `SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED` stays false until then |

## 16. Files changed

`deploy/pilot/docker-compose.pilot.yml` · `Caddyfile` · `pilot.env.example` · `host-bootstrap.sh` ·
`deploy.sh` · `smoke.sh` · `egress-check.sh` · `backup.sh` · `restore.sh` · `.gitignore` (+1 line) ·
this document · CLAUDE.md pointer · `docs/pilot_runtime_foundation_v1.md` §10 pointer.
Product code: **0 files.**

## 17. Tests

No product test changes (nothing in `backend/`, `frontend/`, `agent-runtime/`, `collector/`). Verified:
`bash -n` on all six scripts; `docker compose -f docker-compose.yml -f deploy/pilot/docker-compose.pilot.yml
config` renders with only the edge publishing 80/443, `restart: unless-stopped` ×5, derived URLs correct.
A full stack boot on this laptop was not run (it would rebuild all images; the root compose lifecycle is
already proven in Pilot Runtime Foundation §11) — the first real `deploy.sh` run is on the host.

## 18. Security floor (§15 of the request)

DB / backend / runtime raw ports public **0** (overlay + smoke assertion) · secrets in images **0** ·
demo account default **0** (`SEED_ENABLED=false` enforced by deploy.sh) · HTTPS with auto-renewal ·
org-isolation tests unchanged (no product code touched) · restart policy ✓ · persistent volume ✓ ·
backup/restore path ✓ · SSH not world-open (SSM or operator-IP rule; a provisioning-time decision).

## 19. Product-owner inputs needed

1. **AWS account / region** (ap-northeast-2 Seoul is the natural choice for Korean marketplace latency) and whether any resources already exist there to audit.
2. **`PILOT_PUBLIC_HOST`** — the DNS name, and where its zone lives (Route 53 or an external registrar).
3. **`PILOT_ACME_EMAIL`** — certificate contact.
4. **Cafe24 app** for the pilot: the Demo Org's app or a new one (the redirect URI must be registered in whichever is chosen).
5. **NAVER**: confirmation that the Elastic IP may be added to the pilot application's API 호출 IP list (operator step; existing dev IP untouched).
6. **SSH posture**: SSM (recommended) vs operator-IP-restricted 22.
7. **Off-host backup**: defer, or add an S3 bucket (billable).

## 20. Billable resources waiting for approval (none created)

EC2 `t3.medium` (+30 GB gp3) · Elastic IP (free while attached to a running instance, billed when idle) ·
Route 53 hosted zone if used · optional S3 bucket for off-host dumps. Nothing else. On approval of
region + domain, the next turn provisions manually (console or CLI) following §2–§4, runs
`host-bootstrap.sh` → fills `pilot.env` → `deploy.sh`, and records the egress/callback proofs.
