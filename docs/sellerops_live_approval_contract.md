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

## 3. Operator Approval — the default is one line

When a **valid manifest is prepared and displayed**, the entire approval is exactly:

```
Seated and ready.
```

That one line is a **single-use** grant bound to the currently displayed `approvalId` + `runId` +
`scope` — nothing more is required, because the manifest already carries channel / account /
date / operator / mode / allowed actions and the Standing Safety Contract (§1) already holds.

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
`Seated and ready.` with a stale/absent manifest authorizes nothing.

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
