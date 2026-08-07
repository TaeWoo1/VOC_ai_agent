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

---

## The WING selector probe — a second, browser-only harness

`wing-probe-bootstrap.sh` / `wing-probe-preflight.sh` prepare a **different** kind of run: the read-only
Coupang WING **selector probe** (`collector/src/cli/probe-wing-issuance-selectors.ts`), which opens the
seller's dedicated Chrome window and measures each target's fixed-label **match count** on the page the
seller navigated to themselves.

It shares nothing with the order-routine proof above: **no backend, no DB, no frontend, no credential, no
Coupang API call** — which is exactly why it needs its own bootstrap/preflight rather than the backend
armed-binding gate. The manifest is produced by the same tested source of truth as every calibration phase,
`collector/src/cli/approval-manifest-cli.ts`; these scripts only prove the prerequisites that gate cannot
see.

```bash
# 1. mint the run identity + fix the probe scope (default: the delete-selector calibration scope)
tools/coupang-local/wing-probe-bootstrap.sh
#    a different scope is a different approval:
#    SELLEROPS_WING_PROBE_TARGETS=issue,credentials tools/coupang-local/wing-probe-bootstrap.sh

# 2. preflight: local checks + the sanitized Approval Manifest (no browser, no Coupang call)
tools/coupang-local/wing-probe-preflight.sh

# 3. on PREFLIGHT PASS the operator reads the manifest and grants in one line: "Seated and ready."
#    then run the probe with the approved scope, exactly as the preflight prints it:
cd collector && SELLEROPS_WING_PROBE_TARGETS=delete \
  npx tsx src/cli/probe-wing-issuance-selectors.ts -- --i-understand-this-opens-live-coupang-wing
```

The scope must travel with the run: a probe whose targets differ from the approved manifest is an
out-of-scope run (contract §1.3), and because an **empty** `SELLEROPS_WING_PROBE_TARGETS` means *all six*
targets rather than none, every way of losing it **widens** the run. Two things stop that: the preflight
writes the **resolved** scope back into the run env (so sourcing it can only reproduce what was displayed),
and it prints the run command with the scope **inline**. Use the printed command.

### What the WING preflight proves (and cannot)

| Proves | Cannot prove |
|---|---|
| Run identity is bootstrapped, bound, and **fresh** (a run env older than 2h is refused, so a previous session's identity cannot re-authorize a new one) | That the seller's WING account is in the already-issued state the 삭제 target needs |
| The phase is the READ_ONLY selector probe, never the destructive deletion phase — checked before the manifest is requested, and again on the manifest itself | Whether the WING page layout changed since the last calibration (that is what the probe measures) |
| **No code drift**: HEAD equals the bootstrap commit **and** the working tree is clean, so the manifest's `gitSHA` names the code that will actually run | That the operator can log in (human-only auth — no CAPTCHA/2FA is ever touched) |
| The probe is immediately executable: collector deps installed, entrypoint present, dedicated profile inside the collector tree, a launchable browser | That the operator will use the printed run command rather than typing a different one |
| The manifest carries the exact per-run probe scope, and that scope is bound back into the run | — |

Two hardening details worth knowing, because both were live bypasses before review:

- **The git checks ignore the ambient git environment.** `GIT_DIR` / `GIT_WORK_TREE` could otherwise point
  the drift check at a clean decoy repository, and `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` could force
  `status.showUntrackedFiles=no` to hide a dirty tree. Both are stripped, the repository toplevel is asserted,
  and a `git status` that *fails* is refused rather than read as "clean".
- **The profile check refuses rather than reassures when it cannot see the truth.** It resolves symlinks
  (stricter than the purely lexical guard in `collector/src/profile.ts`), but the probe's documented
  invocation sources `collector/.env`, whose values this preflight must never read. So if `.env` sets
  `COLLECTOR_PROFILE_DIR` at all, the preflight **fails closed** instead of validating a path the run would
  not use. Only the key is looked for; no `.env` value is read, printed, or logged.

`wing-probe-selfcheck.sh` regression-tests all of the above **hermetically** (no browser, no backend, no
Coupang call): missing run env, unbound identity, stale identity, wrong phase, git drift, unknown probe
target, scope normalization and the empty-means-all widening, dirty tree, the `GIT_DIR` hijack, the
untracked-hiding config injection, and the PASS path — including the guard that a CLI-launched phase never
hands the operator a frontend URL, and that the approved scope is bound back into the run env. Cases needing
a clean tree are skipped while the tree is dirty (a dirty tree is refused by design); commit or stash first
to exercise them.

The probe measures counts only: **no highlight, no click, no input, no value read** (never Access Key /
Secret Key / 업체코드), no 발급 / 재발급 / 삭제, and it never navigates the window — the seller does.
