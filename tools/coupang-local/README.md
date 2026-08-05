# tools/coupang-local — Coupang first-connection + order-routine LIVE-proof harness

This is the **approval harness** for a real, read-only Coupang order-collection proof. It closes the two
gaps a raw flag-on backend leaves open:

1. **A backend live-call interlock** (`CoupangLiveCallGuard`) so a live call to the real Coupang gateway
   **fails closed** unless an operator-minted approval id is armed. Unlike NAVER/ESM (whose approval gate
   lives in the collector CLI), Coupang calls the marketplace directly from the backend, so the interlock
   sits at the backend HTTP choke point.
2. **bootstrap → run-backend → preflight** tooling that mints the approval id, arms the backend, and prints
   a **sanitized Approval Manifest** the operator approves in one line — bound to *this* backend/run.

Canonical rules: [`docs/sellerops_live_approval_contract.md`](../../docs/sellerops_live_approval_contract.md).
This harness prepares and displays a manifest; **it never authorizes itself**. The live proof is a separate,
operator-present step taken only after preflight PASSes and the operator answers `Seated and ready.`

## Safety invariants

- **No Coupang call in any script here.** bootstrap/run-backend/preflight make zero marketplace calls. The
  first (and only read-only) Coupang calls happen when the *operator* enters a credential and triggers the
  connect-test / sync in the frontend, after approval.
- **All Coupang marketplace calls are read-only GETs** (credential probe, order-access probe, ordersheets
  sweep). No order-status / shipping / product / inventory write. `mode: WRITE` in the manifest refers to the
  credential + account + sync state written to *our* system (contract §7), not any marketplace mutation.
- **The real credential is entered only in the frontend masked form** — never in a script, env, log, or git.
- **Disposable DB only** (`:55432`, never the real sellerops `:5432`); the scripts refuse a `:5432/sellerops` URL.
- **Fail closed / armed-binding proof.** Default config has no approval id → any real-gateway call throws
  `CoupangLiveApprovalRequiredException`. run-backend arms *this run's* id; preflight proves the running
  backend reports that id's prefix via `/api/connect/coupang/setup` before anything live happens.

## Prerequisites (operator-side; the harness cannot verify these)

- A real Coupang **WING self-developed Open API** credential: **Vendor ID / Access Key / Secret Key**.
- The backend's **real outbound public IP registered** in the Coupang app's calling-IP allowlist. In a local
  run this is your machine's ISP egress IP. An unregistered IP ⇒ `403 "Not allowed IP"` at the first probe.
  The harness surfaces the *advertised* IP for eyeball-matching but **cannot read the real OS egress IP** —
  you must confirm the registration yourself.

## Run order

```bash
# 0. one-time: Keychain vault key + disposable DB (see .env.example)

# 1. mint the run id + approval id (no server, no call)
tools/coupang-local/bootstrap.sh

# 2. boot the disposable backend — Coupang flag on, scheduler off, real gateway, interlock ARMED
tools/coupang-local/run-backend-local.sh
#    (optionally first: export SELLEROPS_CONNECTOR_COUPANG_ADVERTISED_EGRESS_IPS="<the IP you registered>")

# 3. start the frontend pointed at this backend (same-origin /api proxy; leave VITE_API_BASE_URL unset)
SELLEROPS_BACKEND_ORIGIN=http://127.0.0.1:18091 npm --prefix frontend run dev

# 4. preflight: read-only checks + armed-binding proof + the sanitized Approval Manifest (NO Coupang call)
tools/coupang-local/preflight.sh
```

On **PREFLIGHT PASS**, the operator opens `http://localhost:5173/connect/coupang`, and — if the displayed
manifest is correct — grants with the single line **`Seated and ready.`** Only then do they enter the
credential and trigger the connect-test → first sync → idempotent re-sync.

## What preflight proves (and cannot)

| Proves | Cannot prove |
|---|---|
| Backend up, Coupang connector **enabled**, interlock **armed** with *this run's* approval id | The backend's **real OS egress IP** is registered in Coupang (operator confirms) |
| Disposable DB, scheduler off, git unchanged since bootstrap, **pristine** baseline (all zero) | That the credential the operator will type is valid (the live test answers that) |
| The operator's grant will bind to the exact prepared backend/run | Order-API access (the live order-access probe answers that) |

## Re-bootstrap = new approval

Re-running `bootstrap.sh` mints a **new** approval id; the old one is dead and any prior grant is `REVOKED`.
A code / branch / run / scope change after preflight also `REVOKED`s the approval — re-bootstrap and re-run.
