# Gated live reply-run kickoff checklist — NAVER guided reply submission

> **STATUS: NOT AUTHORIZED · CONSUMES NO GATE.** Filling this in grants nothing. A live reply run
> happens only when the §3 gates below are **freshly affirmed in the dispatching turn** (D-032). The
> §1 build prerequisites are now **MET offline** (Reply Submission Live Readiness v1); this checklist
> is the pre-dispatch runbook, not an approval. Home: linked from
> [`r4-gate-record.md`](r4-gate-record.md) §G6.

## 0. The one rule

`관찰 ≠ 완료`, and for a reply there is no verifier at all. SellerOps **never types into the composer
and never clicks submit** — the seller composes, pastes, and submits. A reply POST is **not
idempotent**; the sharpest risk of the whole capability is a **double-post**.

## 1. Build prerequisites — MET offline (Reply Submission Live Readiness v1)

- [x] **Real-browser synthetic rung** — `NaverReplySubmitProbeDriver` proven over real Chromium against
  a synthetic reply-composer DOM (`replyComposerFixtureHtml`), fully automated/headless
  (`collector/test/action-window/reply-submission/reply-browser.test.ts`, `RUN_INTEGRATION=1`). The
  driver tags its own target read-only; the TEST clicks the synthetic submit — the driver never does.
  "Live is never the first execution."
- [x] **Shared dispatch service + thin adapters** — `reply-submission/reply-dispatch.ts` mints the run
  identity (`run_<hex>`) and assembles the engine/session over the v2 transport; the Bridge adapter
  (`bridge/reply-submission-endpoint.ts` + agent-bridge assembly + `local-agent` `--dev-action-window-reply`)
  and the gated CLI (`cli/run-reply-submission-live-naver.ts`) share it. Default boot injects the
  synthetic driver — no browser, no live NAVER.
- [x] **FE → agent v2 handoff + real runId** — the FE dispatches a real `START_RUN(REPLY_SUBMISSION,
  submissionRef)` and records the runtime-terminal-sourced `run_<hex>` runId (frontend program).
- [x] **`.reply-runs` store + restart PARK** — a gitignored isolated store; restart recovery marks any
  interrupted run PARKED and **never** resumes/re-drives the submit (double-post guard).
- [x] **Live-seam privacy proofs** — source-guard + canary sweep over the driver, dispatch service,
  Bridge endpoint, and CLI (`reply-guard.test.ts`, `reply-browser.test.ts`): no submit/type/click, no
  downstream/ingest import, no reply text/selector/URL/page content on the wire or in persistence.

## 2. Governance already ratified (docs; grant nothing)

- Scope: product-scope **v1.6** (§9 narrow guided/human-performed/observe-only exception).
- Write boundary: R4 **§4.1** + ADR §4 mutating-action amendment.
- Decision **D-032**: sixth G3 scope `reply submission` + the reply-submission **G6 template**
  ([`r4-gate-record.md`](r4-gate-record.md) §G6).
- Contract: `contracts/action-window/v2/` (protocol 2); backend V20 outcome (append-only, UNVERIFIED).

## 3. Gates to AFFIRM FRESH in the dispatching turn — all ☐, per-run, non-substitutable

- [ ] **G2 · seller consent EXTENDED to the §4.1 write boundary** — the seller composes/pastes/submits;
  SellerOps highlights read-only and observes. The recorded export G2 (a read) does not cover a write.
- [ ] **G3 · environment + §9-3 NAVER live-work pause lift, `scope = reply submission`** (the sixth
  scope, D-032 — never substitutes for a read scope). Includes the Bridge-paired box answered per run.
- [ ] **G4 · synthetic ladder green, ratified from the proof** — cite §1's real-browser rung run on
  this run's own record (inheritance is not affirmation).
- [ ] **G5 · policy track re-checked** — a submit can raise a copyright/usage consent dialog; confirm
  no platform grant is implied and the §7 dialog rule is understood.
- [ ] **G6 · fill the reply-submission template** ([`r4-gate-record.md`](r4-gate-record.md) §G6):
  `run scope: reply submission`; `max live window`; double-post precond; write boundary; §7 abort;
  G2/G3/G5 state.
- [ ] **P6 / P12** — supervised-pilot gate sign-off and per-run PO approval — ☐ by construction.

## 4. Operator (human) safety acknowledgments — §4.1

- [ ] I compose/paste the approved reply and **click submit myself**. SellerOps does not.
- [ ] SellerOps highlights the composer read-only and **observes** — it never types, never submits,
  never reads/persists the reply text.
- [ ] The run **cannot report `COMPLETED`** — no read-back oracle. It ends `OPERATOR_REPORTED` with
  `verification=UNVERIFIED`; SellerOps does not confirm the reply landed.
- [ ] A `submissionRef` is **single-use**. If interrupted after the submit barrier, the run **parks**
  and never re-drives a submit; a retry uses a **fresh** `submissionRef` and re-confirms the approved head.

## 5. Abort criteria (§7, mutating)

Ambiguous / missing / drifted composer → fail closed, **zero clicks** (the runtime reports
`TARGET_AMBIGUOUS` / `TARGET_NOT_FOUND`, never a guess). **Any unexpected dialog** (incl. copyright/
usage consent) — *uncertain whether a dialog is the expected one ⇒ it is not ⇒ abort, zero further
action.* Withdrawn consent or an anti-abuse challenge → operator abort, recorded as
`SUBMISSION_ABORTED` (an outcome, not a fault).

## 6. What "success" means (honest)

A live run's best possible outcome is a **recorded operator report**
(`OPERATOR_REPORTED_SUBMITTED · UNVERIFIED`) — an audit fact about what the operator did, **never** a
claim that NAVER accepted the reply. The guaranteed non-mutating state is simply *don't submit* →
`SUBMISSION_ABORTED · UNVERIFIED`.

---

**This checklist authorizes nothing.** A live reply run needs the §3 gates filled in its dispatching
turn (D-032); none is granted here.
