# Reviewnary Execution Strategy v1

**The one sentence.** Reviewnary is a SaaS whose value is the operational state it holds and the judgments it
makes on that state; **how a channel is reached is a replaceable layer beneath it**, and no part of the product
above that layer is allowed to know which implementation is carrying a given run.

This document fixes the product and business shape of that split. It is not an implementation plan: everything
it says is IMPLEMENTED is proven in the repository today, and everything it says is not is not.

| | |
|---|---|
| Core | **the product** — Commerce State · Attention · Knowledge · Decision · Issue History · Workspace |
| Execution | **replaceable** — Official API / Manual · BYO Execution · Managed Execution |
| BYO today | Coupang ASIDE, **operator-run incremental**, opt-in per machine |
| Managed Execution | **NOT IMPLEMENTED** — roadmap hypothesis, no code, no contract, no schedule |
| Unattended / scheduled BYO | **NOT APPROVED** |
| Production default | `LOCAL_HELPER`, unchanged |
| Core independent WTP | **the central business hypothesis, UNVALIDATED** |

---

## 1. Reviewnary Core — what the company actually owns

Six things, and none of them is a browser, a credential, or a click:

| | what it owns |
|---|---|
| **Commerce State** | the normalized truth of a seller's reviews, inquiries, orders, products and channel coverage — and, as importantly, what is NOT known (`ChannelDataState`, `ReviewCoverageSignal`) |
| **Attention** | which of thousands of rows needs a person today, and why (`ReviewTriageTier`, the inquiry work queue, proactive cases) |
| **Knowledge** | the seller's own answer basis, its scope and applicability, and what is missing (`GROUNDED` / `NEEDS_CLARIFICATION` / `NO_ANSWER_BASIS`) |
| **Decision** | drafting, approval boundaries, human checkpoints, the append-only record of what was approved and sent |
| **Issue History** | repeated problems, their evidence, and the improvement opportunities derived from them |
| **Workspace** | the chat-first, object-backed surface the seller operates all of it from |

Every one of these is true about the seller's business. None of them is true about a marketplace integration.
That distinction is the whole strategy: **an integration that stops working is an outage; Core is the asset.**

### 1.1 The test this claim has to pass

A feature belongs to Core if its behaviour does not change when the execution layer is swapped. Two live
observations from the ASIDE work stand as evidence that the boundary is real rather than asserted:

- the deterministic executor reached Review Core through the **existing** canonicalizer, handoff, dedup
  formula and ingestion spine, with **zero** changes to any of them;
- the coverage semantics (§2 of `coupang_aside_operator_run_lane_v1.md`) are a pure function of one existing
  run row — they read the run, not the runner.

---

## 2. Execution — three modes, one of which does not exist

Execution is how a channel is read or written. It is **not** part of Core's contract with the seller, and it is
deliberately plural.

### 2.1 Official API / Manual — the baseline

Where a channel publishes an API, the product uses it (Cafe24, NAVER Commerce, Coupang for what it exposes).
Where it does not, a person does the step and the product detects the result — the Action Window pattern. This
is the default posture and it is unchanged by anything below.

### 2.2 BYO Execution — implemented, opt-in

**"Bring your own execution":** the seller (or the operator on their behalf) runs a deterministic executor on a
machine they control, and Reviewnary uses it as one more provider behind the same seam.

- **Today this means exactly one thing: Coupang ASIDE, operator-run incremental.** A person presses 지금 동기화,
  one page of the WING 상품평 list is read, and it lands in the ordinary ingestion. Bounded, started by a
  person, zero marketplace writes.
- It is selected by explicit configuration on one machine (`REVIEWNARY_EXECUTION_PROVIDER=ASIDE`). Nothing in
  the product turns it on, and no seller-visible control offers it.
- **BYO is an optional power mode, not the usage premise.** A seller who never configures it gets the whole
  product; what they do not get is this one incremental lane on this one channel.
- **Pagination, backfill, scheduling and unattended operation are not in it** — see §4.

Canonical detail: `coupang_aside_operator_run_lane_v1.md` (the lane as a product), `aside_execution_provider_v1.md`
(the provider boundary), `coupang_aside_poc_hardening_v1.md` (what was measured).

### 2.3 Managed Execution — **NOT IMPLEMENTED**

The hypothesis is that Reviewnary could one day run the execution layer itself, so the seller configures
nothing. **It has no implementation, no contract, no schema, no schedule and no committed decision**, and this
document does not argue for it. It is recorded here so that "BYO is optional" does not read as "BYO is the
only future", and so that nobody builds toward it by accident.

Naming it costs nothing. Building it would require, at minimum, answers this repository does not have: where
execution runs, whose credentials it holds, what authorization a run carries when no person is present, and
what the failure of that layer does to a seller who never chose it.

---

## 3. The commercial hypothesis

**Reviewnary's price and value are validated on Core, independent of execution and inference.**

Concretely, the hypothesis under test is: *a seller who reaches Reviewnary through nothing but official APIs
and their own manual steps — no BYO executor, no unattended collection — still finds it worth paying for,
because what they are buying is the state, the attention and the judgments, not the plumbing.*

This is stated as a hypothesis because it is **UNVALIDATED**. Nothing in the repository measures willingness to
pay, and the pilot has not run. What the repository can say is that the product is *built* so the hypothesis is
testable: no Core capability requires BYO, and the default deployment has BYO off.

Two consequences follow immediately and are binding on implementation:

1. **BYO must never become a precondition for a Core capability.** The day a seller needs an executor to get
   an answer, the hypothesis can no longer be tested and the product has quietly become an automation tool.
2. **Execution quality is not a pricing axis in v1.** Faster or broader collection is not sold separately.

---

## 4. Standing prohibitions

These are not cautions; they are the shape of the product until a product-owner decision says otherwise.

| | |
|---|---|
| ASIDE as production default | **prohibited** — `LOCAL_HELPER` is the default and the fallback |
| Scheduled or unattended BYO execution | **NOT APPROVED** — every run is started by a person, for one run |
| Pagination / backlog automation in this lane | **not implemented**, and the driver seam has no verb for a page turn |
| Managed Execution | **NOT IMPLEMENTED** |
| Marketplace writes from any acquisition lane | **prohibited** |
| Private / hidden API, network reverse engineering | **prohibited** |
| NAVER through this lane | `DEFERRED_BY_ENVIRONMENT` |
| Cafe24 through this lane | unchanged — it has a working API and this lane is not for it |

---

## 5. What the seller sees, and what they do not

**Decision (M6): technical provider names do not appear on ordinary seller screens.**

`ASIDE`, `LOCAL_HELPER`, `SELLER_CENTER_READ` and the rest are facts about a deployment, not about the seller's
reviews. A seller reading 수집 이력 needs to know *what happened to their reviews* and *what to do next*; which
executable carried the read answers neither, and putting it there would make the replaceability in §2 leak into
the product surface it exists to protect.

**They must remain identifiable to whoever operates the machine.** Today that is:

- the helper's boot summary reports `reviewAcquisitionProvider`;
- every run logs `aw_coupang_review_acquisition_execution_provider` with the bound provider;
- the run row carries `method` (`SELLER_CENTER_READ`), which the API returns and the screen reads but never
  renders.

**Known limitation, recorded rather than papered over:** the run row does **not** persist which *executor*
carried it — only that it was a screen read. Distinguishing an ASIDE run from a seated `LOCAL_HELPER` run after
the fact requires the helper's log. Adding a column was considered and declined in M5/M6: it needs a migration
on a branch whose target baseline already carries `V99`, and no product question today depends on the answer.
When one does, that is a product-owner decision with a named cost.

---

## 6. A press that fails leaves a record

**Decision (M6): a 지금 동기화 that stores nothing writes a durable run row, on the same model as one that
succeeds.**

The gap it closes was named at the end of M5 and is small to describe and bad to live with: a read that failed
before storing — the marketplace asked for a login, the store on the screen was not this account's, the reading
program could not be reached — said so **in the Action Window while it was open**, and then the window closed
and the collection history was indistinguishable from a press that never happened. The seller was left with a
button that sometimes does nothing.

**Reusing the model, not extending it.** The row is an ordinary `sync_jobs` row: the same `method` and
`trigger` the successful handoff writes, `status=FAILED`, three zero counts, and the runtime's closed failure
word in `error_message` — where the successful path already records its own named ending. **No new table, no
new column, no migration, no new abstraction.**

Four rules give the row its meaning:

1. **It is written when the press ends, not when a page refuses.** A seller who is told the list is not up,
   brings it up and presses again has not had a failed sync. Recording the first refusal would leave that row
   in their history forever beside the successful one.
2. **A cancel is not a failure.** The engine drops the blocker on a deliberate 취소 and on a completed walk, so
   neither writes anything.
3. **The vocabulary is closed and server-checked.** Seven words this lane can produce; anything else is a 400
   that writes nothing. Storing an unrecognised string and letting a screen decide is how an internal token
   ends up rendered at a seller.
4. **One press, one line.**

The screen turns the word into a sentence that says what happened and what to do — never what carried the read.
An unmapped word renders nothing rather than rendering itself.

**The one failure this cannot record**: an unresolved binding. The account slot *is* what failed to resolve, so
there is no seller account whose history the row could belong to, and filing it against a guess would be worse
than the gap.

**A screen read is no longer offered a retry it cannot honour.** The history's 다시 시도 re-runs a *pull*; a
screen read is not one, and running it would send the connector at an API that does not carry these reviews and
report the result under the row the seller pressed. The server refuses it and the screen no longer offers it.
This was already reachable before this package, on the `PARTIAL` rows the lane writes by design.

---

## 7. Status, honestly

| claim | state |
|---|---|
| Core is independent of the execution layer | **IMPLEMENTED and structurally guarded** |
| BYO Execution exists | **IMPLEMENTED** — Coupang ASIDE, operator-run, opt-in, one page |
| BYO is optional | **IMPLEMENTED** — default deployment has it off; no Core capability requires it |
| Failed presses leave durable history | **IMPLEMENTED** (§6) |
| Managed Execution | **NOT IMPLEMENTED** |
| Unattended execution | **NOT APPROVED** |
| Core independent WTP | **UNVALIDATED** — the central business hypothesis, and the pilot is what tests it |
| Marketplace-sourced new ingest through the fixed stamp path | **OUTSTANDING NON-BLOCKING EVIDENCE** — `coupang_aside_operator_run_lane_v1.md` §6.1 |

**Marketplace cost of this package: 0.** No read, no click, no write, no download.
