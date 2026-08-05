# Coupang Live-Run Approval Harness v1

> **Status:** implementation record for the *approval harness* that a real Coupang first-connection +
> order-routine read-only proof needs. **No live Coupang call is part of this unit** — the harness is
> offline-built and offline-tested; the live proof is a separate, operator-present step under a fresh
> single-use grant.
>
> Canonical live-run rules: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md).
> This doc records the Coupang-specific *implementation* of that contract; it does not restate the rule.

## Why this unit exists (the pivot)

The requested unit was a *live* Coupang first-connection + order-routine proof. A repository audit at
`main @ 9a1f371` found two facts that made the requested flow non-executable as written:

1. **No Coupang live-run interlock.** The contract's enforcement machinery
   (`hasLiveRunApproval`, `preflight.sh`, `approval-manifest.ts`) is entirely NAVER/ESM collector-side.
   The Coupang connector is backend Spring code: once the feature flag is on and a credential is stored,
   `POST /test-connection` or `/sync` calls `api-gateway.coupang.com` **immediately** — nothing in code
   stood between the trigger and the socket.
2. **No Coupang bootstrap/preflight/manifest tooling** (`tools/coupang-*` did not exist). The requested
   "bootstrap → preflight → Approval Manifest → approval" flow assumed a NAVER-shaped harness Coupang
   never had.

Building that harness is a **code change before live evidence**, which the live-proof directive forbids.
The product owner resolved the contradiction by electing to **build the approval harness first**, treating
it as safety infrastructure (a sanctioned exception to the code-freeze). This unit is that harness. The
connector's product logic (the ordersheets sweep, the credential/order-access probes, the cursor) is
**untouched** — only the safety interlock and the tooling were added.

## Part A — the backend live-call interlock (code)

Because Coupang's live path is backend-side HTTP (not a collector CLI), the interlock sits at the single
backend HTTP choke point every Coupang request flows through: `CoupangOrdersClient.signedGet`.

- **`CoupangLiveCallGuard`** (`backend/.../connector/coupang/`): `ensureLiveCallAllowed(baseUrl, liveApprovalId)`.
  - A base URL whose host is **loopback / `localhost` / `*.test` / `*.local` / `*.localhost`** is treated as
    **offline** and never requires approval — so the offline unit suite and stubs are unaffected.
  - **Any other host** (the real gateway, or a typo'd/unexpected host) requires a **non-blank** approval id.
    A blank id, or an un-parseable/host-less base URL, **fails closed**.
- **`CoupangLiveApprovalRequiredException`** extends `RuntimeException` (deliberately **not**
  `IllegalStateException`): the credential/order-access probes convert an `IllegalStateException` transport
  failure into an inconclusive `UNAVAILABLE`, and a missing approval must never be softened into
  "inconclusive" — it propagates as a hard, visible failure everywhere (fetch and both probes).
- **Wiring.** `sellerops.connector.coupang.live-approval-id` (`SELLEROPS_CONNECTOR_COUPANG_LIVE_APPROVAL_ID`,
  **default empty**) is injected into `CoupangOrdersClient`. Default config ⇒ a real-gateway call fails
  closed. An operator-approved run arms the id via `tools/coupang-local/run-backend-local.sh`.

**Default runtime is unchanged.** The connector beans still exist only behind
`sellerops.connector.coupang.enabled=true` (default off → COUPANG is the mock). The interlock only ever
engages when the flag is on *and* a real host is called.

### Binding proof via the setup endpoint

`GET /api/connect/coupang/setup` now also returns a **sanitized** `liveApproval`:
`{ connectorEnabled, approvalArmed, approvalIdPrefix }`. The prefix is the first 12 chars of the armed id
(an environment-binding token, never a credential — like the walkthrough run id). This lets a live proof's
preflight prove the **running backend is armed with this run's approval id** — the binding a green
`/health` cannot give. `approvalArmed` is true only when the connector is enabled *and* a non-blank id is
configured.

## Part B — the tooling (`tools/coupang-local/`)

Mirrors `tools/naver-local/` but adapted for the backend-HTTP path (no browser, no credential in any script):

| Script | Does | Never does |
|---|---|---|
| `bootstrap.sh` | mints `runId` (`cp-…`) + `approvalId` (`apr-…`), writes the shared run env | no server, no call, no credential |
| `run-backend-local.sh` | boots a disposable backend (`:18091`, DB `:55432/coupang_proof`), Coupang flag on, scheduler off, **real gateway** base-url, interlock **armed** with the run's approval id; vault key from Keychain; refuses `:5432/sellerops` | no Coupang call, no test, no sync, no credential write |
| `preflight.sh` | read-only checks + the **armed-binding proof** (running backend reports this run's approval-id prefix via `/setup`) + a sanitized **Approval Manifest** + advertised-IP surface + IP-registration reminder | no Coupang call, no credential; prints no manifest if any check fails |

### The Approval Manifest

`mode: WRITE` per contract §7 — credential entry + connection test + first sync is a WRITE-class step (it
writes a credential, an account, and sync state to **our** system). **Every Coupang marketplace call in the
run is a read-only GET** — credential probe (`returnShippingCenters` v4), order-access probe + collection
(`ordersheets` v5). No order-status / shipping / product / inventory mutation. `maxActions: credential=1,
test=1, sync=1, re-sync=1`.

## Honest bounds

- **No live proof was performed in this unit.** Offline build + test only.
- **The harness cannot verify the backend's real OS egress IP.** It surfaces the *advertised* IP for the
  operator to eyeball-match and reminds them to confirm the actual outbound IP is registered in Coupang; an
  unregistered IP ⇒ `403 "Not allowed IP"` at the first probe. (The NAVER egress lesson, applied to Coupang.)
- **The interlock is a backstop, not a substitute for the operator grant.** Once armed, the backend *can*
  call Coupang the moment the operator deliberately enters a credential and triggers test/sync; nothing live
  happens before that. The manifest + preflight + `Seated and ready.` remain the human approval.
- **The guard's "real host requires approval" is fail-closed by default:** any non-loopback/non-test host —
  not just `coupang.com` — requires an armed id, so a misconfigured base-url cannot silently open a live path.

## Verification

- Backend: `CoupangLiveCallGuardTest` (offline exemption, real-host fail-closed, armed-allowed, un-parseable
  fail-closed, case-insensitivity), a connector-level fail-closed test (unarmed real host ⇒ zero HTTP on both
  `fetch` and `verifyConnection`), and `CoupangSetupControllerTest` readiness cases. Full backend suite green.
- Frontend: untouched (the readiness field is an ops/preflight concern, not user UX).
- Tooling: `bash -n` clean; no script makes a marketplace call.

## What remains (next unit, separate grant)

The actual **Coupang Main Live First-Connection + Order Routine Proof** — run under this harness: bootstrap →
armed backend → preflight PASS → displayed manifest → operator `Seated and ready.` → credential entry →
`returnShippingCenters` probe → `ordersheets` order-access probe → first `ORDER_SUMMARY` sync → status-sweep
+ `nextToken` paging evidence → idempotent re-sync (dup 0) → `connection_status = CONNECTED` → sanitized
proof record → disposable teardown. That is operator-present and needs its own fresh single-use approval.
