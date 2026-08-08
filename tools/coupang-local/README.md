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
cd collector && SELLEROPS_APPROVAL_PHASE=COUPANG_WING_SELECTOR_PROBE \
  SELLEROPS_WING_PROBE_TARGETS=delete SELLEROPS_WING_APPROVED_TARGETS=delete \
  npx tsx src/cli/probe-wing-issuance-selectors.ts -- --i-understand-this-opens-live-coupang-wing
```

### The same harness, two READ_ONLY phases

The bootstrap takes a phase. Both are read-only and both use the same CLI and dedicated window; they differ in
**which labels get counted**, which is why they are separate manifests and separate grants.

| `SELLEROPS_APPROVAL_PHASE` | measures | default scope |
|---|---|---|
| `COUPANG_WING_SELECTOR_PROBE` (default) | the SHIPPED fixed labels | `delete` |
| `COUPANG_WING_LABEL_RECON` | CANDIDATE label sets for the unresolved targets | `self_dev,vendor_info,call_ip` |

```bash
SELLEROPS_APPROVAL_PHASE=COUPANG_WING_LABEL_RECON tools/coupang-local/wing-probe-bootstrap.sh
```

Recon fails closed twice: the manifest gate refuses a scope containing a target with no candidate set
(`WING_RECON_TARGETS_MISMATCH` — so a manifest the run would reject is never displayed), and the recorder
refuses the same scope again before Chrome launches.

The **phase gets two variables, exactly like the scope**, and the live recorder refuses unless they agree:

| Variable | Means |
|---|---|
| `SELLEROPS_APPROVAL_PHASE` | the phase this run declares |
| `SELLEROPS_WING_APPROVED_PHASE` | the phase the displayed manifest said, bound by the preflight |

One variable is not enough in either direction: a phase left exported in the shell from an earlier session
would arm a candidate sweep under a manifest granted for the shipped labels, and a forgotten phase would
downgrade an approved sweep to a baseline probe while still printing a successful-looking record. The scope
gate cannot catch either — the target set is identical both times. A recon run records evidence only: it
promotes no candidate and changes no shipped selector.

The scope must travel with the run: a probe whose targets differ from the approved manifest is an
out-of-scope run (contract §1.3). **The live probe now enforces that itself** — it refuses before Chrome
launches unless both variables are set, non-empty, canonical, and equal:

| Variable | Means |
|---|---|
| `SELLEROPS_WING_PROBE_TARGETS` | what this run will measure |
| `SELLEROPS_WING_APPROVED_TARGETS` | what the displayed manifest said, bound by the preflight |

Two variables rather than one is the point: a single variable cannot detect a run that measures something
other than what was approved. On the live path an **unset** scope is a refusal, not "all six targets" — the
old default meant every way of *losing* the scope silently **widened** the run.

What that does and does not buy, stated precisely: a scope that was **dropped, forgotten, or never bound** is
refused, and so is one that **disagrees** with the approval binding. It does **not** prove the preflight was
used — a hand-typed pair of equal values passes, because neither variable is tied to the `approvalId`. The
gate closes accidental widening, not a determined operator, which is why the table above still lists "that the
operator will use the printed run command" as something the preflight cannot prove.

The manifest side is unchanged and still treats an absent request as the full fixed set — correct there,
because the manifest then *displays* all six for the operator to approve.

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
  the drift check at a clean decoy repository; `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n` could force
  `status.showUntrackedFiles=no`; and `GIT_CONFIG_PARAMETERS` could inject a `core.excludesFile` that hides a
  dirty tree even against a forced `-c status.showUntrackedFiles=normal`. All are stripped, the repository
  toplevel is asserted, and a `git status` that *fails* is refused rather than read as "clean". What remains
  is local repo state (`.git/info/exclude`, `--assume-unchanged`), which takes deliberate action, not an
  inherited variable.
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

---

## The WING key-DELETION harness — the destructive sibling

> **Internal diagnostics only — feature-frozen (2026-08-08 product-owner decision).** This harness exists to
> put an operator-owned test account into a real no-key state for live calibration. It is **not** a SellerOps
> onboarding feature: no seller-facing surface may reference it, it is never labelled a capability, and it
> gets no further feature work — regression protection only. Seller onboarding has four states (key 없음 /
> key 있음 / expiry·renewal / credential invalid) and deletion is not one of them. Rule:
> `docs/product-scope-v1.md` §7.19; fence:
> `collector/test/crossstack/deletion-tooling-not-product-surface.test.ts`.

`wing-deletion-bootstrap.sh` / `wing-deletion-preflight.sh` prepare a `COUPANG_WING_KEY_DELETION` run: the
seller reaches their already-issued open-API page, SellerOps highlights **only** the 삭제 control and rests at
an irreversible-warning checkpoint, and **the seller presses 삭제 themselves**. Nothing in this harness — and
nothing in the agent — ever deletes.

```bash
tools/coupang-local/wing-deletion-bootstrap.sh   # mint identity + PIN HEAD (refuses a dirty tree)
tools/coupang-local/wing-deletion-preflight.sh   # checks + destructive manifest + disclosure (no browser)
# on "Seated and ready.":
cd collector && npx tsx src/cli/run-coupang-wing-deletion-live.ts -- --i-understand-this-opens-live-coupang-wing
```

Both harnesses share `wing-harness-common.sh` (ambient-git stripping, identity/freshness, drift + clean-tree,
toolchain, profile, browser, manifest path). One copy, deliberately: the destructive path must not drift away
from hardening the read-only path already has.

### What it adds over the probe harness

| | Probe | Deletion |
|---|---|---|
| Identity TTL | 2h | **1h** — acting on a stale identity here costs an unrecoverable key |
| Bootstrap on a dirty tree | allowed (preflight refuses later) | **refused at bootstrap** |
| Per-run scope | operator-chosen probe targets | **none** — channel/account/surface/operation/budget are pinned in the phase spec |
| Manifest gate | phase + scope | + immutable destructive descriptor, `selectorsCalibrated`, `DESTRUCTIVE_SCOPE_MISMATCH` |
| Disclosure | scope line | **five-point irreversibility disclosure**, shown above the grant line |

### `gitSha` is verified, not just present

The approval gate only ever checked that `runId` / `approvalId` / `gitSha` were **present** and not
`"unknown"`. For a destructive run that is not enough: a leftover `.env` from a consumed approval reached
PREPARED carrying a SHA that did not describe the running code — `REVOKED` by contract §1.6.

`collector/src/cli/repo-identity.ts` closes that. It verifies, with the ambient git environment stripped, that
git is reading **this** repository (by realpath), that HEAD is **exactly** the pinned commit, and that the tree
is **clean** — refusing on any git command that fails rather than reading silence as "clean". It is called by
**both** the manifest display CLI and the destructive runtime CLI, so a hand-typed invocation that skips the
preflight script does not skip the check. The shell copies in the harness exist to give an actionable message
first; they are defense in depth, not the enforcement.

Two hardening details, both found by review demonstrating the bypass rather than arguing about it:

- **The git config files are PINNED to `/dev/null`, not merely unset.** Unsetting `GIT_CONFIG_GLOBAL` makes git
  fall back to `$XDG_CONFIG_HOME/git/config` → `$HOME/.gitconfig`, so a prepared `HOME` re-opens exactly the
  `core.excludesFile` hole that stripping `GIT_CONFIG_PARAMETERS` was meant to close — and
  `-c status.showUntrackedFiles=normal` does not counter it. Pinning closes it without unsetting `HOME`.
  Repo-local config still applies, and must: it is part of the checkout.
- **`--assume-unchanged` / `--skip-worktree` need no environment variable at all**, so stripping the git env
  never reached them: a modified tracked file simply stops appearing in `status --porcelain`. Both layers now
  also read `git ls-files -v` and refuse when any path is marked.

The preflight additionally refuses when `SELLEROPS_COLLECTOR_DIR` points outside this repository — otherwise
the drift check verifies one checkout while `approval-manifest-cli.ts` (which derives its own repo root from
its file location) builds the manifest from another, and the displayed provenance line would describe a tree
the gate never looked at.

### What the deletion preflight proves (and cannot)

| Proves | Cannot prove |
|---|---|
| Identity bootstrapped, bound, **fresh** (1h), and pinned to a commit | That the seller's account is in the already-issued state the 삭제 target needs |
| **The running code IS the pinned commit** — right repository, HEAD unmoved, tree clean, ambient git env stripped | Whether the WING page layout changed since calibration (the run's unique-match check answers that) |
| The phase is exactly `COUPANG_WING_KEY_DELETION`; no other phase is approvable here | That the operator can log in (human-only auth — no CAPTCHA/2FA is ever touched) |
| The destructive descriptor is the canonical contract, verified before it is displayed | That the operator will read the disclosure they are shown |
| The 삭제 selector is calibrated, and the manifest says so on the line the operator reads | — |
| channel / account / surface / operation / action budget are the pinned ones, not ambient env | — |

`wing-deletion-selfcheck.sh` regression-tests all of it hermetically — stale/unbound/malformed identity, wrong
phase (three of them), HEAD drift, dirty tree, the `GIT_DIR` hijack, both config-injection dirty-hides, ambient
scope override, the full disclosure text, the descriptor in the displayed manifest, the default temp path twice
over, and the bootstrap's own dirty-tree refusal. Cases needing a clean tree skip while the tree is dirty.

**This harness authorizes nothing.** It prepares and displays; the operator's single-use `Seated and ready.`
is a separate human step, and the 삭제 press is theirs.

---

## The WING issuance-form REVEAL harness

`wing-reveal-bootstrap.sh` → `wing-reveal-preflight.sh` → `run-coupang-wing-reveal-live.ts`, phase
`COUPANG_WING_ISSUANCE_FORM_REVEAL`. The third WING harness and the only one for an operator press that is
**not** destructive: SellerOps highlights the live-calibrated `발급` control and rests; the operator presses it;
SellerOps clears its overlay, takes one sanitized observation, and stops.

It exists as its own harness rather than a mode of the deletion one because the disclosure it owes is the
opposite shape. There, the risk is understating danger. Here it is **overstating safety** — so the descriptor
carries two claims that must never be collapsed into one:

```
createsKeyMaterial : false   ← the operation being approved is not the key-creating one
keyCreationRuledOut: false   ← and this run cannot PROVE none was created
```

The second is not pessimism: `wingIssuedStateFrom` returns `NO_DISCRIMINATING_SIGNAL` because every sanitized
signal is identical between a real issued page and a real no-key form. `verify_reveal_descriptor` (in
`wing-harness-common.sh`) refuses every softening of either, and refuses a descriptor re-pointed at
`COMPLETE_WING_KEY_ISSUANCE` or at the deletion action.

The preflight also shows the **Korean on-screen imperative verbatim** before the grant line, so nothing on the
WING page is a surprise: `coupang-wing-reveal-gate.test.ts` asserts each fragment is a substring of
`WING_REVEAL_CHECKPOINT_LABEL`, so the two copies cannot drift.

`wing-reveal-selfcheck.sh` regression-tests all of it hermetically — nothing is pressed and no key is issued.
Beyond the identity/phase/drift cases the other two harnesses cover, it exercises the descriptor against crafted
manifests (every safety-overstating softening, both re-points, the destructive shape, an absent descriptor), the
approved-phase binding, the full disclosure text, and a **no-leak** case proving a refusal carries no run-env
value, no ambient env value, and no full identity. Cases needing a clean tree skip while the tree is dirty.

**This harness authorizes nothing.** It prepares and displays; the operator's single-use `Seated and ready.`
is a separate human step, and the `발급` press is theirs. The final `확인` — the one that creates the key — has
no tooling and no phase in this repository.
