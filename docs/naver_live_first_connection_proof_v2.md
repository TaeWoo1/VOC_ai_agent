# NAVER Main Live First-Connection Proof v2

> **Live-proof record.** Real NAVER seller account, disposable environment, approval-compliant.
> Sanitized: no secret, token, raw order id, account id, or PII appears here — order evidence is
> aggregate only. Internal `eventTimeMs` never surfaces.

- **Result:** first-connection **PASS** + initial order sync **PASS** + routine re-run idempotency **PASS**.
- **When / where:** 2026-08-05, `main @ 2c9ecac`.
- **Approval:** `apr-e8047603b675` (mode WRITE, `credential=1, test=1, sync=1`) — **CONSUMED**. Run `wt-0b5d4bb01d51`.
- **Environment:** disposable `naver_walkthrough@127.0.0.1:55432` (Flyway **V36**; never the real `:5432`), scheduler **OFF**, NAVER connector ON. Clean new-seller state (0 NAVER accounts, V36 unique slot free).

## Lifecycle (approval-compliant)

1. Fresh DB reset → `bootstrap.sh` @ `2c9ecac` (fresh run/approval id) → `run-backend-local` + `run-frontend-local` → seed NAVER account cleared.
2. `preflight.sh` **PASS** — env-binding matched (URL = frontend build = backend `/context` = `wt-0b5d4bb01d51`, git `2c9ecac`), **0 NAVER call, 0 DB write** on page load.
3. Inline **WRITE manifest DISPLAYED** → operator single-use grant **"Seated and ready — WRITE approved"**.
4. Operator-driven credential entry (masked form) → connection test → first sync. The observer read only the disposable DB + sanitized log; it made no NAVER call and read no credential.

## First-connection + initial sync — PASS

| Signal | Result |
|---|---|
| Account / credential | created lazily on submit (0→1 each) |
| Connection test | **SUCCESS** → two-signal `PREPARING → CONNECTED` |
| **GW status/code** | **2xx** — order-access **CONFIRMED** |
| First `ORDER_SUMMARY` sync | **SUCCESS**, MANUAL, **13/13 ok, 0 skip, 0 fail**, not rate-limited, ~171s |
| Orders persisted | **13**, all `PAID`, 13 distinct external ids / 1 `summary_date` |
| Cursor | `ORDER_SUMMARY primary` set (`windowFrom`/`windowTo`) |

**GW-code → diagnosis mapping (this run):** `200 → order access CONFIRMED → test SUCCESS → sync proceeded`. Because the operator's call-IP registration and order-API permission were correctly set, **none of the 4xx hedged paths (`IP_NOT_ALLOWED` / `PERMISSION_INSUFFICIENT` / `ORDER_ACCESS_DENIED`) were exercised** — they remain UNMEASURED live (a negative-case proof needs an account/IP deliberately missing the permission or IP registration).

## Routine re-run idempotency — PASS

Operator triggered a 2nd manual `ORDER_SUMMARY` run (ChannelWorkspace 수집 설정 → `POST /api/seller-accounts/{id}/sync`). Contract **§5** same-session, same-scope repeat — no new grant.

- 2nd sync started only after the 1st finished (fresh run, single-flight held), **SUCCESS**, 0/0/0/0 net rows over ~360s.
- **Order set stayed EXACTLY `orders=13`, `distinct_ext=13`, `distinct_days=1` throughout — ZERO duplicates.** Idempotent upsert confirmed live.

## Reconciliation (log / DB / UI)

Handshake `runMatched=true originMatched=true`; `connection_status=CONNECTED`, `last_synced_at` set; 2 `sync_jobs` both SUCCESS, 0 rate-limited; no backend ERROR/exception (only the boot default-password WARN). Operator-observed UI completion matches.

## Scope fences honored

No order-status change · no review/inquiry reply submission · no production AWS change · no secret committed · **no code change before live evidence** (code frozen; this doc + memory written only after).

## Deferred → next fix units

1. **4xx GW diagnosis paths** UNMEASURED live — negative-case proof (missing order permission / unregistered call IP). See `naver-order-connection-diagnostic-probe-v1`, `naver-api-egress-ip-readiness-audit-v1` (memory).
2. **Non-`PAID` order status transitions** UNMEASURED.
3. **Scheduled (scheduler-on) routine** still not live-proven.
4. **Environment teardown** — a Landing unit should terminate the disposable servers and record shutdown (grant already CONSUMED).
