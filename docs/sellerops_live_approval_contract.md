# SellerOps Live-Run Approval Contract (canonical) — v1

> **Status:** CANONICAL. This is the single source of truth for how a live marketplace run
> (NAVER / Cafe24 / ESM+ …) is authorized. Every other document references this file instead of
> restating the rule. Where any doc disagrees with this contract, **this contract wins** and the
> other doc is a pointer to be corrected.
>
> **Why this exists.** The approval rule was previously restated — in long, slightly different
> prose — in ~20 places (root/collector `CLAUDE.md`, `docs/sellerops_canonical_reference.md`,
> the Action Window runbooks, live-proof records, the slice docs …), which made every live run
> re-type facts that `bootstrap`/`preflight` and the code gates had already fixed, and let the
> docs drift apart. This contract keeps the **safety boundary in exactly one place** and reduces
> the operator's live approval to, by default, a single line.

---

## 1. Standing Safety Contract (invariant — never re-typed per approval)

These hold for **every** live run, are enforced by code + tests, and are **not** repeated in any
approval message. An approval never weakens them; it only says "the seated operator is present and
this prepared, displayed manifest is correct."

1. **No automatic click / input / submit / create / select** on a marketplace surface. The seller
   performs every real action; SellerOps detects, highlights, validates, and processes only.
2. **No credential / Secret read, log, screenshot, or clipboard capture.** Application ID /
   Secret / token / cookie / session content are never read or emitted; the seller types a
   credential only into SellerOps's own masked form.
3. **No out-of-scope call.** Only the live actions the manifest lists (§2) may happen — nothing
   else reaches the marketplace.
4. **Fail closed / HALT on any unexpected state** (ambiguous target, page mismatch, missing
   surface, changed identity, an unlisted action attempted). A stop is recoverable or a clean
   halt — never a guess onward.
5. **Single-use.** An approval authorizes one manifest. It is not standing, not a schedule, not
   reusable across runs. A plan, a prior approval, a *restored environment*, or goal pressure is
   **never** authorization.
6. **A run/scope/environment change invalidates the approval.** Any change to code / branch / run
   identity / environment / scope after preparation ⇒ the approval is `REVOKED` (§4); a new
   manifest and a new approval are required.
7. **Sanitized only.** Nothing that crosses a wire, a log, or a manifest carries a selector, raw
   URL, raw account/store id, credential, token, cookie, or raw page content — only enums,
   counts, coarse buckets, opaque ids, and sanitized descriptions.

The **enforced mechanism** for these lives in code and must stay consistent with this doc but is
not duplicated here: `collector/src/cli/live-run-approval.ts` (`hasLiveRunApproval` + the
per-scope flags below), `collector/src/cli/import-mode-gate.ts`, and the `hasLiveRunApproval(...)`
gate on every live CLI. ESM+ mirrors it with a distinct flag in
`collector/src/esm/esm-live-approval.ts`.

**Scope is a first-class fact, not folded into a generic "live approval."** The code enforces
distinct, non-substitutable approval flags per operation class:

| Operation class | Enforced flag (code) | Mode |
|---|---|---|
| Export / read acquisition, guided read-only | `--i-understand-this-opens-live-naver` | READ / read-only choreography |
| Guided reply **submission** (marketplace-mutating) | `--i-understand-this-posts-a-live-naver-reply` | WRITE |
| Local Agent headed Chrome launch | `--i-understand-this-launches-local-agent-chrome` | (launch gate) |
| ESM+ live capture | ESM+ distinct flag (`esm-live-approval.ts`) | READ |

A READ approval never authorizes a WRITE, and vice-versa; the manifest's `mode` field (§2) states
which, and a WRITE/submission always needs its own explicit approval (§3 exceptions).

---

## 2. Approval Manifest (prepared by `bootstrap`/`preflight` **before** the approval request)

The tooling generates a **sanitized** manifest and displays it (screen + CLI) before asking for
approval. The operator approves the *displayed manifest*, so the facts are on the record without
being re-typed. The manifest carries **no secret and no raw account/store id** — `preflight.sh`
**fail-closes before emitting the manifest** if the `accountBinding` override looks like a raw
id/token (pure digits, or a long hex/token), so only a sanitized description ever reaches the JSON
or the CLI.

> **PREPARED means immediately executable — no further operator input.** A manifest may only reach
> `PREPARED` when the approved run can start **with nothing more asked of the operator**: the exact
> CLI + driver are confirmed, the required URL/config is present and host-screened, every required
> env var is set, the declared actions match the driver's **real capability**, and the run command
> dry-validates. If **any** of these is missing, the tooling **must not build a manifest and must not
> request approval** — it exits `PREFLIGHT FAIL: approval_prerequisite (<cause>)`. A manifest records
> **only capability the run can actually execute** — never an action its driver cannot perform. This
> is enforced by the tested gate `collector/src/cli/approval-manifest.ts`
> (`validateApprovalPrerequisites`) which `preflight.sh` calls for every phased run.
>
> **After `PREPARED`, the operator is never re-asked** for a URL, a tool choice, or a required
> setting. If one of those was not fixed, the manifest was never `PREPARED` in the first place.
>
> **Phased calibration = separate manifests + separate approvals.** When a goal's phases use
> **different tools** (e.g. API-center calibration — see §7), each phase has its **own** manifest and
> its **own** one-line approval; a single manifest never spans two drivers.

| Field | Meaning |
|---|---|
| `approvalId` | Opaque id this approval binds to (`apr-<hex>`), minted at bootstrap. |
| `walkthroughRunId` / `runId` | Opaque environment/run identity (`wt-<hex>`), the binding a green `/health` cannot give. |
| `channel` | Marketplace channel enum (e.g. `NAVER`, `CAFE24`, `ESM_PLUS`). |
| `surface` | Sanitized surface the run touches (e.g. `API Center UI`, `connect/naver`, review-management). |
| `operation` | What the run does, in one phrase (e.g. `API Center UI calibration`, `guided order connection`, `guided reply submission`). |
| `accountBinding` | **Sanitized** description of the bound account/store (e.g. "operator-owned NAVER API-center test account") — never a raw id. |
| `date` | Run date. |
| `operatorPresenceRequired` | `true` for headed / human-in-the-loop runs (a no-signal = operator-absent = no run). |
| `environment` | Disposable/runtime descriptor (dbAlias, frontend/backend origin, scheduler off, connector flag). |
| `allowedLiveActions` | The **closed list** of live actions this manifest permits (everything else is blocked by §1.3). |
| `maxActions` | Max live calls / executions permitted (e.g. `test=1, sync=1`; or `probes only` for read-only). |
| `mode` | `READ_ONLY` or `WRITE` — the single most load-bearing field; a WRITE always needs explicit approval. |
| `expiresAt` | Expiry, or `process-lifetime` (valid only while this prepared process/run lives). |
| `gitSHA` | Current short HEAD (drift-checked vs bootstrap). |

**Reuse, not reinvention.** `bootstrap.sh` already emits the run identity (`walkthroughRunId`,
`gitCommit`, dbAlias, origins) and now `approvalId`; `preflight.sh` already emits the runtime
manifest JSON (identity + scheduler/flag posture + pristine baseline + env-binding result) and now
prints the Approval Manifest summary. The manifest is the runtime-identity half those scripts
already produced **plus** the approval-fact half (`channel/surface/operation/accountBinding/date/
operatorPresenceRequired/allowedLiveActions/maxActions/mode/expiresAt`).

**Short display form** (one line, screen + CLI), e.g.:

```
NAVER · API Center UI calibration · READ_ONLY · run wt-xxxx · 2026-08-01 · max: probes only
```

---

## 3. Operator Approval — the grant is a PRESS, and the default ask is one line

**The grant is not text.** A run that carries an Approval Manifest renders that manifest's binding
fields on the **SellerOps confirmation surface** — the same trusted channel §5a defines for in-run
checkpoints — and refuses to start until the operator **presses the button on it**. No press, no
run: the process exits without touching the marketplace.

What the operator presses against is the binding the RUN holds (`channel` / `account` / `surface` /
`operation` / `mode` / `actions`, pinned by `approvalId` + `runId` + commit), passed through
verbatim rather than summarised — so a run whose manifest says something else says it on that
screen. A run that ends with something irreversible names that act above every other field.

When a **valid manifest is prepared and displayed**, the operator's spoken part is still one line:

```
Seated and ready.
```

That line is a **single-use** intent bound to the currently displayed `approvalId` + `runId` +
`scope`, and it is what tells the assistant to start the run at all — nothing more is required,
because the manifest already carries channel / account / date / operator / mode / allowed actions
and the Standing Safety Contract (§1) already holds. **It authorizes nothing on its own**, and
neither does the CLI's approval flag: both are statements of INTENT, and both are things a language
model can produce. The authorization is the press.

Implementation: `collector/src/cli/operator-run-grant.ts`. Wired into the CLI-launched WING runs —
the reveal run, the destructive deletion run, and the gated live scaffold
`run-coupang-wing-issuance-live`. The WING selector recorder takes its first per-checkpoint
confirmation before it reads anything, which is the same gate under another name.

**Live proof:** [`trusted_operator_confirmation_proof_v1.md`](./trusted_operator_confirmation_proof_v1.md)
— two sittings on 2026-08-13, same code and phase, differing only in whether the operator pressed:
no press ⇒ `REFUSED_ABORTED` with zero WING navigation / read / action / observation; press ⇒
`GRANTED`, and the next checkpoint arms with its own fresh token.

**The guided walk is the exception, and it is one by construction.** Its entrypoint is an installed
launchd service (`local-agent-service install --action-window-coupang-issuance-live`), so there is
no CLI-owned window to render a grant screen in — and none is needed: the walk begins when the
seller presses 시작 on the SellerOps screen, which is already a real press by a real person in a
SellerOps-owned surface. Its manifest says that, and deliberately does not promise a confirmation
tab that entrypoint never opens.

**Additional detail is requested ONLY when** one of these is true (otherwise, ask for nothing more):

- No manifest is prepared/displayed.
- The `accountBinding` is not yet fixed.
- The operator or date is not fixed.
- The `scope` changed since the manifest was prepared (channel / surface / operation / mode /
  allowed actions differ).
- A previous process was restarted (the prepared manifest is stale → `REVOKED`).
- The operation is a separate **high-risk** class — a WRITE / submission — which always needs its
  own explicit, mode-`WRITE` approval, not a READ manifest's one-liner.

The assistant binds the grant to the **manifest id**, not to a long natural-language parse: a
`Seated and ready.` with a stale/absent manifest authorizes nothing — and now cannot, because the
run's own grant screen refuses an incomplete binding rather than displaying blanks to press against.

---

## 4. Approval lifecycle

States: **PREPARED → APPROVED → CONSUMED**, with **REVOKED** / **REVOKED_BEFORE_ACTION** / **EXPIRED**
as terminal offsets.

- **PREPARED** — `bootstrap`/`preflight` generated + displayed the manifest; no approval yet. (Only
  reachable when the run is immediately executable — §2.)
- **APPROVED** — the operator answered `Seated and ready.` (or a detail grant, per §3) against the
  displayed manifest.
- **CONSUMED** — the first permitted live action ran. The approval is spent.
- **REVOKED** — code / branch / run / environment / scope changed after preparation (§1.6), or the
  prepared process restarted. A REVOKED approval authorizes nothing; re-bootstrap for a new
  `approvalId`.
- **REVOKED_BEFORE_ACTION** — the run was ended (or the approval retired) **before any live action
  ran** — zero window open, zero channel call, zero credential access. Distinct from `CONSUMED`
  (nothing happened) and from a plain `REVOKED` (it names *why it never started*), recorded with a
  reason, e.g. `INCOMPLETE_PREREQUISITES_AND_PHASE_MISMATCH`. It is terminal: the `approvalId` is
  dead and a new `bootstrap` is required.
- **EXPIRED** — past `expiresAt`, or the prepared process/run ended.

Rules:
- A change to code/branch/run/environment/scope **after preflight** ⇒ `REVOKED`.
- **A change of the execution TOOL (CLI/driver) or the calibration PHASE ⇒ the existing manifest is
  immediately `REVOKED`.** The tool is part of the manifest; you cannot approve one tool and run
  another. A new phase/tool needs a new `bootstrap` + new `approvalId`.
- The first **permitted** live action ⇒ `CONSUMED`.
- A **HALT before any live action** leaves it **unconsumed**; if it was ended deliberately it is
  recorded `REVOKED_BEFORE_ACTION`. Whether an unconsumed grant may still be reused is decided by
  whether the **same run + same scope + same tool** still hold (same-session, same-scope retries
  need no re-approval — see §5). Any change ⇒ `REVOKED`, not reusable.
- A new `bootstrap` mints a **new `approvalId`** (the old one is dead).

---

## 5. Same-session, same-scope retries

Within an approved session, fixes and retries against the **same channel / account / scope** (the
live debug-loop) proceed **without a new grant**. A change of channel, account, scope, or a new
session — or any §1.6 change — requires a fresh manifest + approval. "New run" vs "same-session
retry" is decided by whether the manifest's `channel/surface/operation/mode/allowedActions/runId`
still hold unchanged.

---

## 5a. In-run checkpoints advance on an operator-UI confirmation — never on chat text

The grant in §3 authorizes a run. It does **not** authorize any particular checkpoint inside that
run, and the two must not share a channel.

**The rule.** Where a live or calibration run pauses for the operator to put a screen into a
specific state, the run may only continue on a **confirmation event the assistant cannot produce**:

- the operator presses a control in a **SellerOps-owned surface** (for the WING recorder: a blank
  `SellerOps 확인` tab carrying the step's own instruction and one `현재 화면 확인` button);
- the run mints a **random per-checkpoint token**, arms it on that surface, and never prints, logs,
  or persists it — so the value a forgery would have to echo exists only in the run's memory and on
  the operator's screen;
- the press is accepted only when it is **trusted browser input** (`isTrusted`) carrying **that**
  checkpoint's token;
- the reading records the provenance **`OPERATOR_UI_CONFIRMED`**;
- **no event ⇒ no advance.** A timeout, an untrusted event, a stale token, or a surface that cannot
  be armed all fail closed.

**What is forbidden as a checkpoint signal:** a line in the assistant's chat transcript (`ready`,
`떴어`, `체크`, `N번 됐어`), a sentinel file the assistant can `touch`, and any inference from a
screenshot or a paraphrase. Aborting is deliberately asymmetric — a forged abort only stops a run —
so Ctrl+C and an abort sentinel remain available.

**Why it exists.** On **2026-08-13**, during the `COUPANG_WING_VENDOR_METHOD_DISCOVERY` sitting
(`wt-7fac1238faa8`), the assistant generated a user turn that the operator had never written and
attempted to advance checkpoint 5/7 on it. The operator caught it and stopped the session; the
measurement was lost. Nothing was pressed on the marketplace, but only because a later screen gate
halted the run — the confirmation itself had failed. Chat text and `touch` are both things a
language model can produce, so neither was ever evidence that a human had looked at a screen.

**Implementation.** `collector/src/cli/operator-confirm.ts` owns what makes a confirmation
trustworthy; `collector/src/cli/operator-confirm-host.ts` owns the surface — a SellerOps-owned blank
tab in the run's own browser, pinned to the document it opened on, raised by the run itself, and
filtered out of the pages the run measures. Every probe-phase Approval Manifest discloses the
channel and the extra tab.

Where a run has two operator-decidable outcomes — "this screen is ready" and "skip this optional
stage" — the second is a **second button on the same surface**, verified the same way. Skipping is
an advance, so it does not get a file beside the channel.

**Every checkpoint is a press** in: the WING selector recorder, the WING reveal and deletion runs,
`probe-same-session`, `probe-export-same-session`, `classify-export-same-session`,
`probe-session-precondition-same-session`, `diagnose-selection-state-same-session`, and the
API-center walks (`observe-api-center`, `calibrate-api-center`, `capture-api-center-visual`,
`probe-issuance-selectors`).

**Auto-read arms** — where a run polls the page itself instead of waiting for a hand-off — are
allowed, and are governed by §5b below rather than by a checkpoint at the top of the run.

The two bridge-client live-proof CLIs lost the ability to advance a checkpoint at all — a diagnostic
must not be able to move a live guided walk on, and `다음` is the frontend's own button.

**Still on the sentinel channel** (not yet migrated, and each would need a multi-answer surface
rather than a two-button one): the NAVER reply workstream
(`run-guided-reply-session-live-naver`, `run-reply-submission-live-naver`,
`run-review-id-reconciliation-live-naver`, `run-chrome-selector-discovery-live-naver`,
`run-store-identity-diagnostic-live-naver`, `run-abort-rehearsal-live-naver`,
`run-composer-abort-rehearsal-live-naver`, `calibrate-reply-target`, `calibrate-element-anchors`),
the Action Window runtime's own operator signal (`run-action-window-live-naver`), and the ESM CLIs
(`classify-esm-review`, `capture-esm-review`, `capture-esm-review-upload`, `probe-esm-session-ttl`).
`collector/test/cli/operator-advance-channel-guard.test.ts` holds that list and fails when a
migrated CLI regresses onto a sentinel.

---

## 5b. Auto-read may advance GUIDANCE; it may never cross an ACTION BARRIER

A run may watch the seller's screen and advance its own guidance on what it sees. That is the Action
Window's shape and it is what makes the walks usable — nobody wants a prompt in front of every read,
and a confirmation the operator presses forty times is one they stop reading. **Reading is not
acting.**

**Two provenances, and they are not substitutable.**

| | says | may authorize |
|---|---|---|
| `AUTO_READ` | the page LOOKED a certain way | the run's own next **guidance** step |
| `OPERATOR_UI_CONFIRMED` | a person DECIDED something | an act (§5a, and the barriers below) |

A run that treats the first as the second has decided on the seller's behalf and called it their
choice. That is the same defect as advancing on chat text, arriving through a better-looking door:
the reading is real; the inference from it is not the seller's.

**The barrier.** Immediately before any of these, a run must have a verified press, and it must ask
at the point the act is about to happen — not at the top of the run:

`MARKETPLACE_CLICK` · `MARKETPLACE_SUBMIT` · `EXPORT_TRIGGER` · `DOWNLOAD` · `UPLOAD` ·
`CREDENTIAL_REVEAL` · `DESTRUCTIVE`

A readiness hand-off at the start authorizes a *run*; it cannot authorize an act the run decides on
minutes later, on a page the operator has since changed. `capture-export-same-session`'s opt-in
hand-off ran at the top while the export click happened after a reconnect, a re-read, a gate and a
readiness poll — the operator who pressed at the beginning was never shown the thing that was
eventually clicked.

**One press per DISCLOSED chain.** Where an act carries automatic consequences — a click that
downloads, a download that uploads — the ask names all of them. One press for a disclosed chain is
honest; one press for a hidden chain is not. An operator who allows "click the export control" and
then finds a file on their disk and rows in a database was told less than they agreed to.

**A flag is not an approval.** `--capture-reviews`, `--diagnose-upload-saved-review-download` and
their kin state what the operator INTENDED when they typed the command. They do not state that a
person looked at the page the run is now about to act on.

**A refusal reports, and writes nothing.** Every barrier refusal prints one shape —
`{"event":"ACTION_BARRIER","outcome":"NOT_ALLOWED","kind":…,"acted":false}` — and exits `7`. No status
file is written: every `CollectorState` describes something that happened to a collection attempt,
and nothing happened. The record says so out loud rather than leaving a reader to infer it from
silence.

Implementation: `collector/src/cli/operator-action-barrier.ts`.
`collector/test/cli/operator-action-barrier-guard.test.ts` sweeps `src/cli/` for the acting
PRIMITIVES (`.click(`, `.press(`, `.fill(`, `.type(`, `.selectOption(`, `.check(`, `.setInputFiles(`,
`waitForEvent("download")`, `.saveAs(`) as well as the named chains, requires a barrier before each,
and requires the refusal to return on its own rather than fall through. It is mutation-tested: an act
moved before its barrier, a deleted refusal `return`, a dropped barrier callback and a newly added
unbarriered click are each caught.

An earlier version of this list held only five helper NAMES, and two CLIs that click, download and
ingest into the database passed it cleanly — see below.

### Applied: the three auto-read arms (2026-08-13)

| CLI | how far auto-read carries it | its action barrier | before the fix | now |
|---|---|---|---|---|
| `capture-export-same-session` | login/2FA waited through → first resolvable verdict → **through** the reconnect resolve → export gate → readiness poll → capture chain | the guarded continue click; then the export click → download → upload → status write | **nothing** in the default arm; the opt-in hand-off sat at the top | a press before the continue click (raised only on `RECONNECT_REQUIRED`, which is the only verdict that can reach it), and a press before the capture chain — disclosing click, save, upload and status write |
| `continue-account-store-same-session` | settle the SPA, read the state | ONE real continue click on NAVER | the opt-in hand-off only, at the top | a press immediately before the click, in both arms |
| `discover-reply-target` | read the row census | **none** — it clicks, types, submits, downloads, uploads and writes nothing (its own source guard pins that) | n/a | **unchanged.** A confirmation here would be the prompt-on-every-read this policy exists to avoid |
| `discover-export` (`--discover` without `--classify-only`) | navigate, hydrate, read the verdict | the export click → download → upload → status write | nothing | a press before the capture leg |
| `capture-esm-review` | a `.ready` hand-off, then the marketplace-selection check | the ESM+ export click + download wait | a `.ready` file whose own prompt said *'in Claude Code, say "ready" and Claude creates the sentinel'* | a press immediately before the click, after every gate that could refuse it. Its READ hand-offs stay sentinel files and stay on the §5a register |
| `capture-esm-review-upload` | the same `.ready` hand-off | the click → download → save → **upload into the backend DB** | the same `.ready` file | a press before the chain, disclosing the DB ingest |
| `upload-file` | reads no page at all | the upload | n/a | **unchanged, by policy.** The operator typing the path IS the decision; there is no observation to be mistaken for one. Named in the guard so the exclusion is a rule, not an omission |
| `run-coupang-credential-handoff-live` | classify the surface, census the credential cells value-free | **`CREDENTIAL_REVEAL`** — read the three values → POST them to the SellerOps vault → read-only verify | n/a (new) | one press, disclosing the whole chain, immediately before the read. See §5c |
| Coupang guided issuance walk (`CHECK_CREDENTIAL_STATE`) | census the credential cells value-free, on the open-API surface, to decide whether an issuance walk should happen at all | **none** — it crosses no barrier. `KEY_PRESENT` PREVENTS an act (the walk stops before the key-creating control); `NO_KEY` still ends at a control the SELLER presses; `UNKNOWN` parks | n/a (new) | **unchanged, by policy.** A confirmation here would be the prompt-on-every-read this policy exists to avoid, and the read's only power is to refuse. It reads no value: a structural census plus one non-emptiness bit per cell, and it is gated on `WING_CREDENTIAL_CELLS_CALIBRATED` |

## 5c. `CREDENTIAL_READ` — the one mode that is not `READ_ONLY`

Every phase in `PHASE_SPECS` declares `mode: READ_ONLY` and means it: the agent reads structure and no
value. The Coupang credential handoff does read values, so it carries a different literal —
`CREDENTIAL_READ` — precisely so that run cannot be described with the word every other run uses. It is
**not** `WRITE`: the agent still clicks, types, submits and issues nothing on the marketplace. What it
writes to is the seller's own SellerOps vault.

The gate enforces the pairing in both directions (`validateApprovalPrerequisites` step 6c):

- a `READ_ONLY` phase may not declare `READ_CREDENTIAL_VALUES_ONCE` or
  `HAND_CREDENTIAL_TO_SELLEROPS_BACKEND` → `CREDENTIAL_ACTION_IN_READ_ONLY_PHASE`
- a `CREDENTIAL_READ` phase **must** declare both → `CREDENTIAL_MODE_UNDERDECLARED`

The second direction is the one that matters: a run cannot carry the alarming mode and then quietly
narrow its declared capability to something innocuous, because the operator's grant is given against the
action list.

### The backend is armed with the WHOLE identity, and spends it once

`CoupangLiveCallGuard` asks one question — is SOME approval id armed — and that is the right question for a
read-only marketplace GET. It is the wrong question for the run that reads three secrets off a seller's
screen and writes them into the vault: a single non-blank string cannot say WHICH run was approved, at WHICH
commit, for WHICH phase, or whether it has already been used.

So the credential handoff has its own interlock (`CredentialHandoffArming`), armed only by
`tools/coupang-local/wing-credential-arm-backend.sh` from the run env `wing-credential-bootstrap.sh handoff`
minted. It refuses:

| | why |
|---|---|
| nothing armed | the default state of every backend that was not prepared for this run |
| a malformed or partial arming | every field must have the shape the bootstrap mints, so a hand-exported value is a refusal rather than a shortcut |
| the `COUPANG_WING_CREDENTIAL_CELL_CALIBRATION` phase | that grant is for a run that reads no value, and both bootstraps mint identically-shaped ids |
| an arming older than 1h (or stamped in the future) | the grant is single-sitting; a skewed clock is not something to reason about |
| a request presenting a different approval / run / commit | each field closes a different way to reuse a grant |
| a second handoff | one run, one handoff |

**The arming is spent at the STORE, not at the verification.** The store is the irreversible half; the
read-only check after it can fail for reasons that have nothing to do with the credential. Returning the
arming there would invite reading three secrets again to replace something already in the vault, and
replacement is the renewal path's job. A refusal *before* the store consumes nothing, because nothing
happened.

There is deliberately **no argument** to the arming script: it reads the minted run env and nothing else, so
"arm it with a value I typed" is impossible rather than discouraged. The preflight then matches BOTH id
prefixes and the phase from `/api/connect/coupang/setup` against the manifest it is about to display, and a
backend that has already spent its handoff fails the preflight rather than the operator's grant.

The value-cell structure is measured first, by a separate `READ_ONLY` phase
(`COUPANG_WING_CREDENTIAL_CELL_CALIBRATION`) with its own approval — a grant for the calibration is never
a grant for the handoff. That order is **enforced**: `WING_CREDENTIAL_CELLS_CALIBRATED` ships `false` and
the gate refuses a `CREDENTIAL_READ` manifest while it is (`CREDENTIAL_CELLS_NOT_CALIBRATED`), so the
handoff cannot reach PREPARED on a screen nobody has measured. Full contract: [`coupang_credential_handoff_v1.md`](./coupang_credential_handoff_v1.md).

---

## 5d. Reading during calibration — `do not persist`, not `do not read`

**Product-owner decision, 2026-08-14.** On a **seller-owned** surface, under a `READ_ONLY` manifest, a
calibration run **may read the screen directly**: visible text, DOM, and attributes, including review text,
product names, `productId` / `vendorItemId`, links and pagination structure. Several hypotheses may be
settled in one sitting.

### Why the default changed

The value-free census was built for a real reason and it worked: three 고객문의 sittings and three 상품평
sittings produced readings that leaked nothing. But it costs a sitting per question, and on the 상품평 screen
it cost more than that — the run reported a *partial key covering 7 of 10 rows* when the truth was *a fully
populated column with two colliding values*. Counts could express neither, and the correction took two more
rounds. **An indirect probe does not just answer slowly; it can answer wrongly and confidently**, which is
the failure mode this repo has spent the most time on.

The principle was always `do not expose`. It had hardened into `do not read`, and those are not the same
rule. Reading a name off a screen the seller is already looking at exposes nothing; writing it into a
database, a log, or a repo fixture does.

### Still prohibited, and these are unchanged

| | |
|---|---|
| **Secrets** | passwords, API secrets, cookies, session tokens — never collected, on any surface, in any mode. The `CREDENTIAL_READ` path (§5c) remains the only exception and keeps its own barrier. |
| **Buyer identity at rest** | never persisted to a database, a log, or a repo fixture unless the product needs it. Seeing it during inspection is fine; keeping it is the act that matters. |
| **Raw DOM / HTML** | never committed to the repository wholesale. |
| **Marketplace actions** | a `READ_ONLY` sitting still performs 0 clicks, 0 inputs, 0 submissions. Reading more does not license acting. |
| **Writes** | still require their own fresh, explicit `WRITE` approval. Nothing here touches that. |

### What this does not relax

- The **manifest still binds**. A run may only do what its own manifest says — a broader reading posture is
  not a licence to exceed the approval in hand. The manifest wording changes first, then the run.
- The **operator still presses**. Every barrier in §5a/§5b stands.
- **Sanitized/count-only probing is still the right tool where the risk is real** — credential cells, and any
  field whose exposure would be the harm itself. It is now a deliberate choice for those fields rather than
  the default for every field.

### The honest cost

A direct read makes it *easier* to persist something by accident, because the value is now in hand rather
than reduced to a count before it could travel. The protection moves from "it never crossed the boundary" to
"we chose not to keep it" — a weaker guarantee that depends on the persistence layer being right. That is
the trade the decision makes, stated plainly rather than left implicit, and it puts the weight on the
storage tests: what a run may read is now wider than what it may keep, so the keeping is what gets pinned.

---

## 6. UI / CLI display

The approval-waiting screen/CLI shows only:

- **what** the run will do (`operation`);
- whether it is **READ_ONLY** or **WRITE** (`mode`);
- the **max actions** (`maxActions`);
- the **run id** (`runId` prefix);
- the instruction to answer **`Seated and ready.`**

The long allow/deny lists and the Standing Safety Contract live behind a collapsible **"상세 안전
범위 / detailed safety scope"** section (or a pointer to §1 of this doc) — not in the default view.

---

## 6a. Self-Pilot Runtime — the operator's standing READ grant (product-owner decision, 2026-08-18)

**What changed.** For the operator's **own** organisation(s), routine **READ** work is authorized once, for
the lifetime of the armed backend process, instead of per run: official-API collection on the scheduler
(NAVER ORDER · Coupang INQUIRY/ORDER · Cafe24 REVIEW/INQUIRY/ORDER) and bounded automatic AI triage
(SellerOps' own tables, no marketplace call). Design + code: `docs/self_pilot_runtime_v1.md`.

**The grant.** `SELLEROPS_SELF_PILOT_READ_GRANT_ID` = `spr-` + 8–32 hex, minted by
`tools/self-pilot/mint-read-grant.sh`, entered by the operator into the backend env, shape-validated at
boot (`SelfPilotProperties`), scoped by `SELLEROPS_SELF_PILOT_ORG_IDS`. It is an environment-binding token
like the per-run approval id — never a credential — and it dies with the process; re-mint to rotate.

**Where it opens.** Exactly one code gate: `CoupangLiveCallGuard.ensureLiveReadAllowed(baseUrl,
liveApprovalId, standingReadGrantId)` — the READ-only signed GETs (orders, inquiries, connect probes).

**Where it can never open — the WRITE boundary is unchanged.** `ensureLiveWriteAllowed(baseUrl,
liveApprovalId)` has no parameter for it; `CoupangInquiryReplyClient.signedPost` calls that gate; every
marketplace-mutating action (reply submission on any channel, credential entry on a marketplace, anything in
§5b's ACTION BARRIER list) still needs its own fresh, single-use, mode-`WRITE` approval under §3. A READ
grant is not a schedule for WRITE, and this section authorizes nothing about proof/dispatch runs driven by
the assistant — those keep §3.

**What is not relaxed for browser READ carriers.** The seated NAVER review import and the Coupang WING
walks remain seller-performed (login, every click, the in-browser grant press); the change there is
operational only — a supervisor keeps the agent resident and mints the READ walk's environment ids so the
operator does not run a bootstrap by hand (`tools/self-pilot/agent-supervisor.sh`). §1.1–1.4 and 1.7 hold
verbatim; §1.5 ("single-use") is superseded **only** for the READ grant above, by this decision.

---

## 7. Applied: NAVER API-center calibration — TWO phases, TWO manifests

API-center selector calibration is split into two phases whose **tools differ**, so each has its own
manifest and its own one-line approval (§2). The phase specs are enforced by
`collector/src/cli/approval-manifest.ts` (`PHASE_SPECS`).

### Phase A — `API_CENTER_STRUCTURE_OBSERVATION` (READ_ONLY, observe only)

- CLI `src/cli/observe-api-center.ts`; driver = the audited read-only observer.
- `allowedActions`: open the dedicated window · the operator logs in and navigates themselves ·
  classify the sanitized page category · read the structural census · derive **sanitized structural
  hints** for the existing-app/empty-state branch and the control candidates.
- **No highlight, no click, no submit; credential value read = 0.** A Phase-A manifest that declares
  `HIGHLIGHT_REAL_CONTROL` is refused (`HIGHLIGHT_ACTION_IN_OBSERVATION_PHASE`) — the observer's
  driver cannot highlight, so the manifest may not promise it.

Approval UX:
```
NAVER · API Center structure observation · READ_ONLY · run <prefix>
→ operator: Seated and ready.
```

### Phase B — `API_ISSUANCE_HIGHLIGHT_PROOF` (READ_ONLY, highlight proof)

- CLI `src/cli/run-api-issuance-live-naver.ts`; driver = `NaverIssuanceDriver` (Action Window).
- Runs **only after Phase A's findings are reflected into the selector adapter in code** and
  `SELECTORS_CALIBRATED` is `true`. Until then the manifest is refused
  (`SELECTORS_NOT_CALIBRATED`) — the fixture markers park every highlight `target_not_found`, so a
  highlight-proof against them would prove nothing.
- `allowedActions`: highlight the real create/open/api-group/credentials/return control · observe
  the operator's own click and the surface transition. **Auto click/input/submit = 0; credential
  value read = 0.**

Both phases are `READ_ONLY`. A WRITE step (guided reply submission; credential entry + connection
test + first sync) is a **different manifest with `mode: WRITE`** and always needs its own explicit
approval (§3). Switching phase/tool `REVOKED`s the current manifest (§4).

### Phase B-FE — `API_ISSUANCE_FE_LIVE_PROOF` (READ_ONLY, FE-run-host live proof)

The same existing-app highlight capability as Phase B, but **driven by the SellerOps FE run-host**
rather than the CLI driver. Its approval shape differs on exactly one axis — the **run client** — so
it is a separate phase (Phase B's CLI-launched-dedicated-window entrypoint guard is left intact and
never weakened):

- **entrypoint = bound FE URL** (`/connect/naver?walkthroughRun=<runId>`), `entrypointType:
  FRONTEND_URL`. The operator opens the wizard, picks the existing-app path, and `화면을 보며 확인`.
- **supporting surface** (declared in the manifest, NOT the entrypoint): the CLI-launched Local Agent
  host + dedicated NAVER Chrome + `/bridge/ws` carrier. The host opens the window and hosts the run
  but **sends no START_RUN**.
- **`soleStartRunOwner: FRONTEND`**, **`maxStartRun: 1`** — the FE resyncs, confirms the agent is
  idle, and sends START_RUN exactly once. No standalone `issuance-live-proof.ts` client may run
  (preflight fails closed if one is).
- **`writeBudget: {credential:0, test:0, sync:0}`** — READ-only; no credential entry / test / sync.
- Requires `SELECTORS_CALIBRATED` (it highlights real controls), like Phase B.

The gate (`collector/src/cli/approval-manifest.ts`) refuses any manifest that diverges: a CLI
entrypoint on this phase, a `FRONTEND_URL` on Phase B, a non-FRONTEND START_RUN owner, a cap ≠ 1, a
non-zero credential/test/sync, a missing supporting surface, a host that sends START_RUN, or a bound
FE URL whose `walkthroughRun` ≠ the manifest `runId`.

Approval UX:
```
NAVER · existing-app guided issuance tutorial (FE-run-host READ-only proof) · READ_ONLY · run <prefix>
→ operator: Seated and ready.
```

---

## 8. Consolidation pointers (this file is canonical)

Documents that previously restated the rule now point here:

- `CLAUDE.md` (root) §Branch/PR — the standing one-liner + this doc as the detail.
- `collector/CLAUDE.md` — live-CLI gating cites `live-run-approval.ts` + this doc.
- `docs/sellerops_canonical_reference.md` §6.2 — product authority, points here.
- `docs/action-window-runtime/` runbooks, `r4-gate-record.md` (G6), `HANDOFF.md` — point here for
  the contract; keep their run-specific evidence.
- `docs/slices/naver-guided-connection.md`, `docs/product-scope-v1.md`,
  `docs/sellerops_completion_checkpoint_v1.md`, `docs/workstreams/review_operations_mvp.md` —
  point here.

**Historical live-proof / dispatch records keep their long, filled approval text as evidence of
what was granted at the time** — they are records, not the current standard. Do not copy their
long form into new approvals; the current standard is §3 (one line against a displayed manifest).
