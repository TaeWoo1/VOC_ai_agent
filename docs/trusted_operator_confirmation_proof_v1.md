# Trusted Operator Confirmation v1 — live proof record

Two live sittings on **2026-08-13**, on the operator's own Coupang WING account, under the
`COUPANG_WING_ISSUANCE_FORM_REVEAL` phase (`READ_ONLY` for the agent). They exist to answer one
question about the run-level grant: **does a live run start without a human press, or not.**

Same code, same procedure, same phase, two approvals. The only difference between them is whether a
person pressed a button.

Canonical contract: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md)
§3 (the grant) and §5a (in-run checkpoints).

---

## Sitting 1 — NEGATIVE: the grant was never given

| | |
|---|---|
| approval | `apr-d3e92322c761` |
| run | `wt-f9ee08a06924` |
| commit | `0209d6eb` |
| operator action | **none** — the `[현재 화면 확인]` button on the RUN GRANT screen was deliberately not pressed |
| ended by | abort sentinel, after the run had held the grant screen for ~6 minutes |

**Result: `REFUSED_ABORTED`, exit `7`.**

Everything the run logged, in full:

```
07:52:45  profile.launch {"headless":false,"channel":"bundled","followWindow":false}
07:58:44  aw_coupang_reveal_run_grant {"outcome":"REFUSED_ABORTED"}
```

| claim | evidence |
|---|---|
| WING navigation = 0 | `runRevealWalk` was never reached; this CLI has no `.goto` at all — navigation is the operator's |
| WING read = 0 | `classifyInitialSurface` / `probeIssueMatch` / `observeRevealOutcome` never ran |
| marketplace action = 0 | the 발급 control was never located, never highlighted, never pressed |
| sanitized observation = 0 | stdout empty — the record is emitted only on `OBSERVED` |
| grant confirmation | **none.** No `OPERATOR_UI_CONFIRMED` anywhere in the run |

---

## Sitting 2 — POSITIVE: the grant was given, by hand

| | |
|---|---|
| approval | `apr-1c33fb13a287` (fresh bootstrap; sitting 1's approval was dead) |
| run | `wt-08f52f602513` |
| commit | `79ed783d` |
| operator action | **the operator pressed `[이 실행 승인]` on the RUN GRANT screen themselves** |
| ended by | abort sentinel, immediately after the next checkpoint armed — **deliberately, as the test's design** |

**Result: run grant `GRANTED`; checkpoint `WING REVEAL 1/2` armed; the sitting was then stopped.**

Everything the run logged, in full:

```
08:34:06  profile.launch {"headless":false,"channel":"bundled","followWindow":false}
08:49:10  aw_coupang_reveal_run_grant {"outcome":"GRANTED"}
08:50:11  aw_coupang_reveal_operator_confirm
          {"checkpoint":"WING REVEAL 1/2","signal":"abort","provenance":"none"}
```

**The fifteen minutes between `profile.launch` and `GRANTED` are the measurement.** The browser was
open and the run was waiting the whole time; nothing the assistant could write, touch or create moved
it. What moved it was a press.

Immediately after the grant, the surface re-armed as `WING REVEAL 1/2` — a **fresh checkpoint with a
fresh token**, and the button back to `현재 화면 확인` (the run-grant button is labelled `이 실행 승인`,
because approving a run and confirming a screen are different questions).

> **⚠ On the exit code.** This sitting also exited `7`, and that is **not** a grant refusal. The grant
> was `GRANTED`; the `7` comes from the operator abort taken one minute later, at the checkpoint, on
> purpose. The two sittings are told apart by their logs, not by their exit codes:
> `outcome: REFUSED_ABORTED` (grant refused) vs `outcome: GRANTED` followed by
> `checkpoint: "WING REVEAL 1/2", signal: "abort"` (granted, then stopped).

| claim | evidence |
|---|---|
| WING 발급 press | **0** — the run never reached the highlight step |
| WING read | 0 — aborted before `classifyInitialSurface` |
| highlight | 0 — `"Aborted or timed out before the checkpoint. Nothing was highlighted."` |
| marketplace action | 0 |
| checkpoint 1/2 confirmed | **no** — `provenance: "none"`. Only the run GRANT was confirmed |

---

## What the pair establishes, and what it does not

**Establishes:** a live run under this phase does not begin on a chat line, a terminal flag, or a
file. It begins on a verified press, and it refuses without one. The next checkpoint after a grant
arms with its own token, so a grant is not a standing permission for what follows.

**Does not establish:** anything about the 발급 press itself, the highlight, or the observation —
neither sitting reached them, deliberately. And neither sitting says anything about the CLIs whose
default arm has no operator checkpoint at all (see the contract §5a), or about the runs still on the
sentinel channel.

---

## Copy corrected between the two sittings

Sitting 1 surfaced a real defect: the grant screen rendered
`account: operator-owned Coupang WING test account` while the Approval Manifest above it rendered the
two-account sentence. One field, two copies of it, drifted. The value now comes from
`WING_DEFAULT_ACCOUNT_BINDING` in the contract module that both the manifest CLI and the grant screen
import, and a regression pins that they agree.

The rest of the rework, verified on sitting 2's live screen: the title carries the mode and nothing
else (a `READ_ONLY` run is not stamped "되돌릴 수 없음"; the specific risk is a ⚠ line); what SellerOps
will **not** do is a required field; the "what advances this" sentence appears exactly once; and the
ids stay in full but sit last.
