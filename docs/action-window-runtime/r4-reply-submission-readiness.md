# Reply Submission Live Readiness v1 — build-readiness record

> **Offline build-out of the live-run prerequisites for a guided NAVER reply submission.** This record
> states what was BUILT and VERIFIED offline; it affirms **no gate** and authorizes **no live run**. A
> live reply run remains gate-locked (D-032): a fresh scope-matched G3 + single-use G6 in the
> dispatching turn. See [`r4-reply-submission-live-kickoff.md`](r4-reply-submission-live-kickoff.md).

## Why

Review Response **Completion v1** ended the guided flow at a **local/mock** handoff — it never
dispatched an Action Window run to the local agent. The live reply-run kickoff checklist surfaced that
a live guided run was not merely un-gated, it was **un-built**. This program builds those prerequisites
**offline**, so a future live run has something real to gate. It touches **collector + frontend + docs
only** — the backend needs no change (`awRunRef` is opaque, so a real `run_<hex>` runId records
unchanged), and the audited v1 export runtime + `.operation-runs/` store are byte-for-byte untouched.

## Deliverables (all MET offline)

| # | Deliverable | Evidence |
|---|---|---|
| 1 | **Real-browser synthetic rung** (top G4 rung for reply) | `replyComposerFixtureHtml` (synthetic composer DOM) + `reply-browser.test.ts` (real headless Chromium, `RUN_INTEGRATION=1`): driver tags its own target read-only, TEST-only submit click observed, no canary leak. |
| 2 | **Shared dispatch service + thin CLI & Bridge adapters** | `reply-submission/reply-dispatch.ts` (mint `run_<hex>` + assemble over v2), `bridge/reply-submission-endpoint.ts` (v2 opaque carrier), `agent-bridge` reply assembly (`AgentReplySubmissionConfig`), `local-agent` `--dev-action-window-reply`, gated CLI `cli/run-reply-submission-live-naver.ts` (reply-specific approval flag, refuses the export flag). |
| 3 | **FE → agent v2 handoff + real runId** | Frontend program (isolated v2-typed `startReplySubmission` bridge path; runtime-terminal-sourced outcome + runId; unspent-`submissionRef` reuse; LAN-safe command ids). |
| 4 | **Live-seam privacy proofs** | `reply-guard.test.ts` extended to the dispatch service, Bridge endpoint, and CLI (no submit/type/click, no downstream import); canary sweep over the real-browser rung. |

## Safety posture (unchanged invariants)

- **No live NAVER at any phase; no G2–G6 consumed.** `NaverReplySubmitProbeDriver` runs only over the
  synthetic-DOM fixture (real browser, fake page). The gated CLI's reply approval flag is **never
  affirmed** in this program.
- **The Runtime never types or submits.** Read-only annotate + observe only; enforced by the extended
  source guard across the whole new live-seam surface.
- **관찰 ≠ 완료 / no `COMPLETED`.** Terminal is `OPERATOR_REPORTED` + `verification=UNVERIFIED`.
- **Double-post guard, made concrete.** Single-use `submissionRef`; the isolated `.reply-runs` store
  restart-recovers to **PARKED** — an interrupted run is never resumed or re-driven.
- **v1 export untouched.** The reply path is a side-by-side v2 stack (own engine/session/endpoint/store
  namespace); the Bridge server's single carrier slot was generalized to an interface so it hosts
  EITHER endpoint, and the two are mutually exclusive at assembly.

## Note (bug caught by the real-browser rung)

The real-DOM ambiguous case exposed that the reply engine's `onLocated` checked the missing-signature
condition before the `count > 1` condition, mislabeling genuine ambiguity as `TARGET_NOT_FOUND` (the
prior unit test masked it with an unrealistic `{count:2, sig}` input). Reordered so `count > 1` →
`TARGET_AMBIGUOUS` first. Both paths fail closed; only the blocker label was wrong. All existing tests
stay green.

## Verification (offline)

```
cd collector && npm run typecheck && npm test                                  # v1 + v2 + reply + adapters
cd collector && RUN_INTEGRATION=1 npx vitest run test/action-window/reply-submission/reply-browser.test.ts
```

## Still gate-locked (unchanged)

A live reply run needs, in its dispatching turn: G2 (write-consent), G3 (`reply submission` scope +
pause lift), G4 (ladder green from the proof), G5, G6 (filled template), P6/P12 — none affirmed here.
