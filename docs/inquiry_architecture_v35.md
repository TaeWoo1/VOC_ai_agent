# Inquiry Architecture v3.5 — Customer Goal Interpreter + Deterministic Resolution Loop

**2026-09-20 · actual model call 0 · marketplace 0 · DB write 0 · migration 0 · production Case 변경 0 · push/PR 0**

This package does not tune the Resolution Planner and does not run the 67 cases. It converts what five planner
experiments measured into an architecture, and checks offline whether the smaller contract holds.

Baseline `0a7f921a`. Every number below is measured in this worktree at this commit or read from a stored run.

---

## 0. The Resolution Planner: EXPERIMENTAL / NOT_ADOPTED_FOR_PRODUCTION

Nothing is deleted. `ResolutionPlan`, `ResolutionPlanParser`, `ResolutionPlanValidator` and
`ResolutionPlannerPrompt` keep their code, their prompt versions v1–v5, their scenario fixtures and every recorded
run. They are **comparison and replay assets**: WP-1 through WP-3.2 are scored against them, and a superseded artefact
an evidence row points at has to stay readable.

**The status is now in the code, not only here.** Each of the four types carries a `NOT_ADOPTED_FOR_PRODUCTION`
banner, and `LegacyPlannerStatusTest` fails the build if a banner goes missing or a production class starts calling
the planner.

### Why not adopted — stated precisely

Not because separating authorities failed. **KNOWLEDGE / ENTITY_STATE / PROCEDURE / SELLER was right**, is unchanged,
and the new contract is built on it. The failure was **scope**: one model call was asked to decide what the customer
means *and* to compose the entire future workflow that would satisfy it — atomic needs, authority sequence, entity
fields, customer inputs, search scope, a future procedure, and a closing authority.

Five differently-shaped defects turned out to be one defect in five coats:

| observed | what it actually was |
|---|---|
| read more entity fields than the question needed | the model deciding a resolver's sufficiency |
| asked for more customer input than the answer depended on | the model deciding a resolver's prerequisites |
| added a procedure the customer never requested | the model planning a future the customer had not asked for |
| appended a seller like insurance | the model planning a fallback |
| fixed a search scope before looking | the model deciding a retrieval decision ahead of retrieval |

Every one of them is the same sentence: **the model was asked what happens after the thing that has not happened
yet.** WP-3.2 tried to close the last one with an explicit instruction; it was measured on byte-identical inputs
under v4 and v5 and the behaviour was unchanged — the sentence redistributed reach rather than reducing it.

### KEEP · REPLACE · REMOVE FROM LLM RESPONSIBILITY

**KEEP (all carried forward unchanged, all still in use):** Capability Registry · the authority vocabulary ·
provenance and scope model · capability gap semantics · `EntityStateResolver` · v2/v3 evidence assets · eval-store
append-only observations · strict schema infrastructure · capture/replay/fingerprint · simulation fixtures ·
Claim Guard · Teach / reusable Knowledge · Human Approval and execution safety.

**REPLACE:** the full Resolution Planner as the runtime abstraction → `CustomerGoal` + `ResolutionPolicy`.

**REMOVE FROM LLM RESPONSIBILITY:** exact entity fields · customer input selection · future procedure planning ·
capability availability fallback · closing authority sequence · operational handoff planning.

### The migration is smaller than it looks

Audited at this commit: **the Resolution Planner has zero production callers.** The only `main/` file that names it
is `InquiryDecisionGenerator`, whose `resolutionPlan(...)` seam is package-private and reached only from `src/test`.
So "DEFAULT OFF" is already true in the strongest available sense — there is no production path to switch off — and
`LegacyPlannerStatusTest.noProductionCaller` keeps it that way.

---

## 1–3. The Customer Goal Interpreter contract

The new LLM component interprets **the outcome this customer asked this message to produce**, and stops.

```
goal := { id, explicitRequest, requestedOutcome, subject, basis, explicitConstraints[] }
```

### `requested_outcome` — four values, measured rather than assumed

| value | means | first resolver |
|---|---|---|
| `INFORMATION` | a fact true independently of this customer's order | Knowledge |
| `STATE_READ` | the current state of one bound entity | Entity State |
| `DECISION` | a judgment: may this be allowed, will you make an exception, what do you recommend | Knowledge |
| `ACTION` | external state change, and that change is the outcome wanted now | Procedure |

Nothing here names shipping, exchange, refund, restock, a size or a colour. These are **speech acts**, and they
survive a deployment that sells something else. §4 is the check that four is the right number.

### `subject_reference` — registry-bound, not a free string

`Referent` = `CURRENT_LISTING · SELLER_CATALOGUE · CURRENT_ORDER · ORGANIZATION · UNRESOLVED`. The first four are
**not a new vocabulary**: each is the scope a capability of this deployment is already about, and
`ResolutionPolicyInvariantTest.referentsAndCapabilitiesCorrespond` fails the build if a referent has no capability or
a capability has no referent.

`UNRESOLVED` is what keeps that honest — a customer may name a thing this deployment cannot identify, and saying so
is a resolution outcome, not a parse failure. One real row exercises it (`R:f403e606 n2`, which names another listing
by name).

**Extension is a registration, not an edit.** `ReferentRegistry` owns which referents exist and which capabilities
can be about each; a deployment selling appointments registers its own. What does not change is the contract above
it.

### `basis` — the field that makes "invented goal" measurable

`STATED` or `DIRECTLY_IMPLIED`. **There is no third value, and that is the design.** A message whose outcome is
neither stated nor directly implied produces **no goal**; absence is the third state and it is observable as a count
of zero. A `basis = UNSTATED` would be a goal the interpreter invented while labelling it invented.

### What a goal may never carry — a shape, not a rule

There is no field for required entity fields, customer inputs to ask, a capability sequence, a procedure, a fallback,
a handoff, a closing authority, availability, an execution effect, or a future possible action. They are **absent**
rather than validated against: a rule can be satisfied on the wire and still be wrong in spirit; a record with no slot
for a procedure cannot carry one. `GoalScenarioTest.whatAGoalCannotCarry` pins the component list, and the wire mirror
refuses each retired slot **by name** (`GOAL_PLAN`), so a plan cannot arrive wearing a goal's name as extra keys.

### "Current request only"

> "기한이 지났는데 교환 승인해주실 수 있나요?" → **one** `DECISION`. No `ACTION`.
> "기한이 지났는데 가능하면 승인하고 교환 처리까지 해주세요." → **two goals**: `DECISION` + `ACTION`.

Fixtures `G06` and `G07`. They share a subject, a domain and a registry; what differs is the customer's sentence.
The compound form needed **no new structure** — a message that asks two things carries two goals, which the contract
already allows and the frozen gold already contains four examples of.

---

## 4. The 72 frozen goals, remapped offline

`contracts/inquiry-customer-goal/v1` · canonical rows in `eval-store:inquiry-customer-goal/v1` · **model call 0**.

> **Superseded by v2 (§21).** Classes A, B and C were adjudicated by the product owner on 2026-09-20. v1 stays
> frozen and readable — it is the version this contract was designed against, and §4 below is the state at design
> time. The adjudicated counts, the five legacy-gold conflicts and the DECISION prerequisite audit are in **§21**.
Labelled by a designer reading the 67 recorded messages beside the frozen goals. A model may not produce these
labels: a model labelling the set a Goal Interpreter will be scored against is the set measuring itself.

### The check that makes this more than a restatement

`build.py` asserts the new vocabulary is **consistent with the frozen `closing_authority`**, reading the dispatch
table backwards: `INFORMATION→KNOWLEDGE`, `STATE_READ→ENTITY_STATE`, `ACTION→PROCEDURE`,
`DECISION→KNOWLEDGE or SELLER`. A row labelled `INFORMATION` that closes on `PROCEDURE` fails the build.

**All 60 settled rows satisfy it. 60/60, zero violations.**

### Distribution

| | |
|---|---|
| goals · cases | **72 · 67** |
| settled | **60** |
| pending adjudication | **12** |
| **unmappable** | **0** |
| **needing a fifth enum value** | **0** |

| requested_outcome | settled | closes on (frozen gold) |
|---|---|---|
| `INFORMATION` | 51 | KNOWLEDGE 51 |
| `STATE_READ` | 3 | ENTITY_STATE 3 |
| `DECISION` | 4 | **SELLER 3 · KNOWLEDGE 1** |
| `ACTION` | 2 | PROCEDURE 2 |

The `DECISION` row is §10 visible in the data: same outcome kind, different resolver, decided by observation. Three
restock questions reach the seller; one bulk-discount question is decided by a written policy.

| referent | n | | basis | n | | goals per case | n |
|---|---|---|---|---|---|---|---|
| `CURRENT_LISTING` | 46 | | `STATED` | 59 | | 1 | 63 |
| `CURRENT_ORDER` | 11 | | `DIRECTLY_IMPLIED` | 1 | | 2 | 3 |
| `SELLER_CATALOGUE` | 9 | | | | | 3 | 1 |
| `ORGANIZATION` | 5 | | | | | | |
| `UNRESOLVED` | 1 | | | | | | |

Explicit constraints: **29 of 60** settled goals carry at least one (1→19 · 2→7 · 3→2 · 4→1). Counts are committed;
the customer's words stay in the capture.

### The finding that matters

**5 of the 7 `PROCEDURE`-closing goals in the entire frozen gold are adjudication rows.** The DECISION/ACTION
boundary the planner kept crossing is a boundary *this corpus never pinned down either* — which is why no amount of
prompt tuning closed it. The label was never stable enough to tune against.

### Adjudication table — 12 rows, 6 classes. None guessed at.

| class | n | shape | candidates | what it decides |
|---|---|---|---|---|
| **A** outcome not named | 4 | customer describes a situation (wrong item, damage, a wish to receive sooner) and names no outcome; the gold assigns one by inference | `ACTION/DIRECTLY_IMPLIED` · **no goal emitted** | whether a situation report may become a goal. If not, four gold goals disappear. |
| **B** capability question about an action | 4 | "can you / can I …?" about something that would change state | `INFORMATION` · `DECISION` · `ACTION` | **the C6 boundary in the real corpus.** The gold reads three as KNOWLEDGE and one (address change) as PROCEDURE — the same surface form on both sides. |
| **C** imperative with no executor | 1 | "issue a tax invoice", for which this registry declares no procedure | `ACTION` · `INFORMATION` | whether outcome is read from the customer or from what the deployment can do. §12 says the former (→ `ACTION` → CAPABILITY_GAP); the gold took the latter. |
| **D** request for future notification | 1 | "send me every tracking number" | `STATE_READ` · `ACTION` | whether "tell me X later" is a state read or a request to act. |
| **E** opinion / comparison | 1 | which of two seller products is better | `INFORMATION` · `DECISION` | whether a recommendation is a fact or a judgment. Also the only `UNRESOLVED` referent. |
| **F** alternative conditional actions | 1 | "send the nozzle; if not possible, refund" | one `ACTION` · two with a stated preference order | **the one candidate field this mapping surfaced.** `CustomerGoal` cannot currently express a customer-stated alternative. |

Rows by id are in `labels.py` (eval store).

### Rows the brief named

| row | result |
|---|---|
| `C6` (fixture `G06`) | `DECISION` / `CURRENT_ORDER`. One goal, no `ACTION`, procedure unreachable by construction. |
| `4181864b` | **class A.** "배송을 빨리 받고싶습니다" names no outcome; the gold's `ORDER_STATE` goal is inferred. |
| `8989a9d0` | **class B.** Gold closes on KNOWLEDGE (is a mixed pair purchasable); surface form is a request. |
| `ae51c7f8` | settled `INFORMATION` / `CURRENT_LISTING` / 0 constraints. The `OPTION` input is the **resolver's** (fixture `G08`). |
| `T6c` | settled `INFORMATION` / `CURRENT_LISTING` / 0 constraints. Asks about every variant, so **no input is needed** — the contrast with `ae51c7f8` on the same product is exactly why the interpreter must not choose inputs. |
| `dae8554d n2` | settled `INFORMATION` / `CURRENT_LISTING` / 2 constraints. |
| `f81ad84a` | **class D.** The gold also over-reads `ORDER_TRACKING`, which §8 now makes non-fatal. |
| `f403e606 n2` | **class E**, and the only `UNRESOLVED` referent. |

### Honest limits of this mapping

- **The corpus is 85% `INFORMATION`** (51 of 60). `STATE_READ` has 3 settled rows and `ACTION` has 2. Layer-A
  accuracy computed here says almost nothing about those two, and a targeted synthetic set carries that weight.
- The mapping is **1:1 by construction**, which is itself the claim being tested: the smaller contract loses no goal
  the plan representation held. It does not prove the *reverse* — that no goal should have been split differently.
- These labels are DEV/CALIBRATION. They are not a holdout and can never become one.

---

## 5. Deterministic Resolution Policy

`ResolutionPolicy.next(goal, observed)` — a **pure function** returning exactly one next step or a terminal state.
It cannot return a sequence because there is no shape that holds one: `Dispatch` is sealed to `Run | Settle`, and
`ResolutionPolicyInvariantTest.oneStepAtATime` asserts `Run` carries no collection.

Checked against the registry rather than hard-coded:

- **Only an `ACTION` may reach a procedure.** Asserted exhaustively over every outcome × every referent, and killed
  by mutation.
- **A `DECISION` asks Knowledge first** and reaches the seller **only from an observed absence**.
- **No semantic substitution.** Asserted over every `GapReason` × every outcome: a resolver that could not run
  settles at `CAPABILITY_GAP` carrying the registry's reason, unchanged.

The distinction that makes the seller a capability and not a router:

| | |
|---|---|
| resolver **ran and found nothing** | `NEEDS_SELLER` — a new judgment is genuinely required |
| resolver **could not run** | `CAPABILITY_GAP` — we do not know whether a policy exists, and claiming a judgment is needed would assert that one does not |

---

## 6. The resolution loop

```
INTERPRETED → RESOLVER_SELECTED → RESOLVING → (RESOLVER_SELECTED | SETTLED)
```

**No new terminal states were created.** The brief offered seven; the audit found six already declared and in use in
`ResolutionState` (`RESOLVED`, `RESOLVED_CONDITIONAL`, `NEEDS_CUSTOMER_INPUT`, `NEEDS_SELLER`, `CAPABILITY_GAP`,
`FAILED`), and the seventh — "the system can go acquire this" — already expressible as `GapReason.ACQUIRABLE`.

**`ACTION_REQUIRES_APPROVAL` was deliberately not created.** It has no producer: every procedure in this registry is
`DECLARED_NO_EXECUTOR`, so an action goal terminates at `CAPABILITY_GAP / NOT_EXECUTABLE` and cannot reach an
approval. When an executor exists, approval belongs to the execution lane that already owns it. A state nothing can
produce is a state nobody can test.

**The only chaining there is** runs backwards from a plan: a resolver may name a prerequisite *after running*
(`ResolverOutcome.needs`). A procedure that needs the order read says so from inside the procedure definition; nobody
predicted it (fixture `G12`). Asking the same capability twice settles at `FAILED` rather than spinning.

---

## 7. Customer input ownership

The resolver decides what to ask — and this was **already half-built**: `Resolution.ask` has been the resolver's
since the authority layer was written, and `EntityStateResolver` already returns `NEEDS_CUSTOMER_INPUT` with
`OPTION` when a listing has more than one option. What was wrong was that the *planner also* emitted
`customer_inputs`, creating a second truth that nothing reconciled.

**Why P07's over-asking (`OPTION`/`SIZE`/`MODEL`/`MEASUREMENT`/`USE_CONTEXT`) shrinks under this structure:** the
planner was asked, before any retrieval, which values the answer would depend on — a question that can only be
answered by imagining the answer, and imagining generously is the safe-looking error. The Knowledge Resolver is
asked afterwards, holding the retrieved evidence, and its question is narrower: *of the values this customer did not
give, which one does the evidence I actually found still turn on?* `ae51c7f8` and `T6c` are the same product and the
same registry, and they need different inputs — a fact only visible after retrieval.

The PII prohibition is unchanged and still structural: `Resolution` refuses an `IDENTITY` input in `ask` in its
compact constructor.

---

## 8. Entity field ownership — both regressions, one rule

No component upstream names a field, so WP-3.2's open choice is settled by the architecture: the resolver decides.
`EntityStateRequirement` is what stops that becoming permissive.

**A requirement is a list of dimensions; a dimension is satisfied by any one of its fields; a goal is answerable when
every required dimension is satisfied. Optional fields are recorded when readable and never fatal.**

| entity | required | optional | evidence |
|---|---|---|---|
| `ENTITY.ORDER` | fulfilment | payment · cancellation · tracking | 11 of 11 order steps in the frozen gold read fulfilment |
| `ENTITY.LISTING` | sale status *(option **or** listing)* | — | 3 of 3 listing steps read option sale status |

| | P01 / C4 | R:7a8136b2 |
|---|---|---|
| all-or-nothing *(shipped)* | **fails** — over-read is fatal | passes |
| field-level | passes | **fails** — a spare readable field hides the missing one |
| **required dimensions** | **passes** | **passes** |

`EntityStateRequirementTest` asserts all three rows, including that no single field other than fulfilment satisfies
the order requirement — so "any readable field resolves it" stays refused.

**Honestly unobserved:** no goal in the 72 requires payment or cancellation state *as its answer*. A customer asking
"was my payment cancelled?" needs a second required dimension, and this package does not invent one from zero
examples.

---

## 9. Procedure boundary

A procedure is considered **only when the goal is `ACTION`**. Checked against the 72 before being fixed: every
`PROCEDURE`-closing gold row is either a settled `ACTION` (2) or an adjudication row about whether it is one (5) —
**no row contradicts the rule**, and none supports an exception to it.

The procedure definition owns its required entity state, required customer input, policy checks, external effect,
approval requirement and executor availability. The interpreter plans none of it.

- `C6` → `DECISION` → the procedure registry is **never consulted** (`G06`, asserted as `forbidden_dispatch`).
- explicit cancellation / change → `ACTION` → procedure path (`G04`, `G12`).

**This is the structural version of what an instruction could not do.** WP-3.2 added the sentence and measured it
twice; here there is no path through `ResolutionPolicy` from a non-`ACTION` goal to a procedure.

---

## 10. Knowledge / Decision

A `DECISION` is not automatically a seller question.

> "반품 기간이 7일인가요?" → `INFORMATION`, answered by policy knowledge.
> "기간이 지났는데 이번 건도 받아줄 수 있나요?" → `DECISION` → knowledge first; if an explicit policy decides the
> exception, it resolves there; otherwise a seller judgment.

The seller means **"a new seller judgment is genuinely required"**, never "nothing else worked". Fixture `G10` shows
the interpreter emitting no seller at all and the loop reaching one from an observed absence.

Past Answer is unchanged: **precedent only**, not factual authority until promoted to seller-confirmed Knowledge.

---

## 11. Knowledge semantic sufficiency

The universal CoverageJudge is **not** revived. What stays is a narrow judgment inside the Knowledge Resolver:

- **in:** one explicit `CustomerGoal` · the knowledge in that scope · the customer's explicit constraints
- **out:** resolved answer/evidence · missing customer variable · missing knowledge · ambiguous evidence

Order state, procedures, seller fallback and past-answer reuse are **not** given to this judge.

`ae51c7f8` / `T6c` / `dae8554d` remain open semantic edges at this narrower scope and are retained as Layer-B
component-eval targets. **No judge call was made in this package.**

---

## 12. Capability Registry — role restated

The registry is documented as **"what a resolver can actually do"**, not "a menu the planner chooses from". It owns
resolver/capability availability, supported referent and entity types, source authority, executor existence,
read/write/effect metadata, required permissions and approval requirements.

**The LLM never changes the customer's meaning because of availability.** A missing capability is `CAPABILITY_GAP`;
substitution to another authority is refused structurally and by mutation.

Adjudication class **C** is where the frozen gold does not yet meet this rule: "세금계산서 발행해 주세요" is labelled
`POLICY`/`KNOWLEDGE` because the registry has no tax-invoice procedure — the label was taken from what the system
could do. Reported, not silently re-labelled.

---

## 13. Eval v3 — three layers

**Layer A — Goal Interpreter** (`tools/inquiry-need-eval/customer-goals.mjs`, implemented):
explicit goal recall · **invented goal rate** · outcome accuracy · referent accuracy · constraint fidelity ·
goal-count and multi-goal accuracy.

**The headline is invented goal rate**, and the test that justifies it is worth stating: on a `C6`-shaped case, a
prediction that is perfect *plus one extra goal* scores **recall 1.0 and outcome accuracy 1.0** — the plan-era
metrics cannot see the defect that ended the planner. Invented-goal rate reports 0.5.

Two scoring rules, both mutation-covered:
- a row still under adjudication is **not scored for correctness** (that would measure the adjudication) — but a
  prediction made on it **still counts toward the invented denominator**, because an extra goal is wrong whatever the
  right answer turns out to be;
- assignment matches on **referent first**, outcome only as a tie-break, so outcome accuracy does not measure itself.

**Layer B — Resolver:** knowledge resolution correctness · entity minimum-state correctness · clarification
precision/recall · capability-gap correctness · seller-judgment correctness · procedure selection.

**Layer C — E2E simulation:** message → interpreter → loop → mock Knowledge/Entity/Procedure → outcome. Headline:
Wrong Automation · Safe Resolution · Correct Handoff · Seller Touch · Repeat Seller Ask after Teach.

---

## 14. The 67 DEV cases — new role

They are **no longer a prompt-tuning benchmark.** In this package they were used with **model call 0**, to design
and check the schema.

Operating plan against overfitting:
1. synthetic targeted set first (`contracts/inquiry-goal/v1/synthetic`, 12 rows);
2. then the 67 DEV cases **at most once**, as a diagnostic;
3. final judgment on a **new holdout** and then pilot shadow.

The 12 adjudication rows must be decided **before** any DEV diagnostic, or the diagnostic measures an unstable label.

---

## 15. Migration — no big bang

| phase | does | model calls | KEEP | DEPRECATE | REMOVE LATER |
|---|---|---|---|---|---|
| **A** *(this package)* | CustomerGoal contract · vocabulary · referent registry · policy · loop · 72-goal mapping · scorer · fixtures | **0** | planner code, prompts, runs, fixtures | planner as runtime abstraction | — |
| **B** *(this package)* | deterministic policy + state machine, tests, mutations | **0** | all authority assets | — | — |
| **C** | Goal Interpreter shadow: ≤8-call smoke → at most one DEV diagnostic | smoke then diagnostic | planner for replay comparison | — | — |
| **D** | Knowledge/Entity resolver integration + mock E2E simulation | mocked | — | planner fixtures once Layer B has its own | — |
| **E** | new holdout | yes | — | — | — |
| **F** | pilot shadow / approval flow | yes | — | — | planner runtime code, once no evidence row needs it |

**Phases A and B are complete in this commit.** Every new production path is default-off in the strongest sense
available: none of it is wired into a request path, and no interpreter exists yet to call it.

---

## 16. Small models — not yet

Not applied. Future candidates: `requested_outcome` classification and referent selection. Conditions: the taxonomy
is stable (**the 12 adjudication rows are a direct blocker**), enough labelled real inquiries exist, and shadow
accuracy against a frontier model is measured. Goal decomposition and constraint extraction stay on a frontier model.

---

## 17. What was built

| | |
|---|---|
| **A** CustomerGoal domain contract | `backend/.../inquiry/goal/CustomerGoal.java` |
| **B** goal vocabulary | `RequestedOutcome` · `RequestBasis` · `Referent` · `contracts/inquiry-authority/v1/vocabulary.json` §`customer_goal` |
| **C** referent registry contract | `ReferentRegistry.java` |
| **D** deterministic ResolutionPolicy | `ResolutionPolicy.java` |
| **E** outcome / state machine | `ResolverOutcome.java` · `GoalResolution.java` |
| **F** 72-goal mapping + scorer | `contracts/inquiry-customer-goal/v1/` · `tools/inquiry-need-eval/customer-goals.mjs` |
| **G** synthetic fixtures | `contracts/inquiry-goal/v1/synthetic/goal-scenarios.jsonl` (12) |
| **H** legacy status | banners in 4 planner types · `LegacyPlannerStatusTest` · vocabulary `planner_status` |
| — | §8 `EntityStateRequirement.java` |

**The actual Goal Interpreter LLM implementation is deliberately not built.** The contract is verified offline
first, and building a prompt before the 12 adjudication rows are decided would bake an unsettled label into it.

---

## 18. Synthetic fixtures — 12 rows

Read by **both** the Java scenario test and the tools mirror, so the two cannot drift.

| id | shape | asserts |
|---|---|---|
| G01 | product material | INFORMATION |
| G02 | is it in the catalogue | INFORMATION + `SELLER_CATALOGUE` |
| G03 | where is my order | STATE_READ |
| G04 | cancel it | ACTION → procedure |
| G05 | **is cancelling possible** | DECISION · **procedure forbidden** |
| G06 | **exception exchange approval (C6)** | DECISION · **procedure forbidden** |
| G07 | approve **and** do it | two goals, DECISION + ACTION |
| G08 | variant compatibility | resolver names the customer input |
| G09 | **unavailable connector** | goal unchanged · `CAPABILITY_GAP` · seller forbidden |
| G10 | **missing policy** | DECISION → knowledge absent → seller |
| G11 | unidentifiable referent | `UNRESOLVED` → gap, no resolver run |
| G12 | procedure needing an order read | the one legal chaining |

`forbidden_dispatch` is asserted as strongly as the expectation.

---

## 19. External architectures — what the boundary looks like elsewhere

Researched 2026-09-20 from official documentation. **Confidence is not uniform and is marked**: the OpenAI guide was
read directly from its published PDF (page numbers below); the other four came through a page-summarising fetch, so
their short quotes should be spot-checked at the URL before being reproduced elsewhere.

| source | LLM decides | human/config declares | pre-plan or step-at-a-time |
|---|---|---|---|
| **Channel Talk ALF v2** (KO docs) | response text, value extraction inside Agent stages | 지식 / 규칙 / **태스크**: trigger, stage graph, branch conditions, Code and Function stages, **Agent approval** node | **not stated in any official page** — do not cite either way |
| **Intercom Fin** | whether to start a Procedure ("based on what the customer says"), argument inference | procedure body, branching, `@`-placed data-connector calls, Task entry criteria | **step-at-a-time, explicit**: each step "must fully complete" before the next; "No parallel processing" |
| **Ada** | per turn: ask / answer from knowledge / call an Action / initiate a Playbook / hand off | Playbook steps (`SEND/SET/ASK/RUN/IF-ELSE/GO TO`), and by default a tool is usable **only inside** a Process or Playbook | turn-by-turn **outside** a Playbook; sequential and declared **inside** one |
| **Anthropic**, *Building effective agents* | in "agents", the loop | in "workflows", the code path | "gain 'ground truth' from the environment at each step" |
| **OpenAI**, *A practical guide to building agents* | tool selection within a run | routines, tool set, guardrails incl. deterministic rules-based ones | "a loop that lets agents operate until an exit condition is reached" (p.14) |

**The question asked: does anyone let an LLM plan the whole resolution up front?**

**No official source describes an LLM producing a complete multi-step resolution plan before acting.** The three
products draw the same line in the same place — **the LLM owns *entry*, the human owns *body*** — and in all three
the declared procedure *is* the plan, written before the conversation started. Both engineering guides describe the
agent loop as observe-then-decide and scope dynamic orchestration to where a declared path is impossible: Anthropic
places agents at "open-ended problems where it's difficult or impossible to predict the required number of steps";
OpenAI says "Otherwise, a deterministic solution may suffice" (p.6).

A consistent secondary pattern: **all three products pull authority back from the model at the write edge** — Ada
gates tools inside Processes by default, Intercom leaves the model only argument inference at an author-placed call,
Channel Talk's Code/Function/Approval stages are model-free by node type.

**What this does not establish, stated plainly:**
- **Absence of evidence.** No vendor says "we do not pre-plan"; help-center docs describe an *authoring surface*, not
  an internal architecture. Any of them could run a planner the docs do not expose.
- OpenAI's "declarative vs non-declarative graphs" (p.20) is about the **developer's** authoring artefact, not an
  LLM-generated plan. It would be a misreading to cite it for the planner question.
- Ada's Playbook **trigger/selection criteria** and Intercom's **knowledge-vs-Procedure arbitration rule** are
  undocumented on the pages read.
- Channel Talk's English and Korean docs describe **different product generations**; Ada's vocabulary is
  mid-migration ("Actions" → "API tools"; Processes legacy relative to Playbooks). Date any citation.
- **No source addresses the question actually behind this decision:** what should happen when intent is recognised
  and no declared procedure matches. Nobody publishes a fallback-to-planner policy either way.

**How it was used:** as evidence that the LLM/deterministic boundary this package draws is the one the field
converges on, not as a design to copy. No product's vocabulary or flow was imported.

---

## Tests

| | at `0a7f921a` | now |
|---|---|---|
| backend | 4,504 / 0 failures | **4,533 / 0 failures** (54 skipped) |
| tools | 106 / 0 | **109 / 0** |
| mutations | 22 / 22 caught | **27 / 27 caught** |

New: `GoalScenarioTest` (15) · `ResolutionPolicyInvariantTest` (6) · `EntityStateRequirementTest` (5) ·
`LegacyPlannerStatusTest` (3) · `customer-goals.test.mjs` (7) · 5 new mutations.

**No existing test was weakened.** One fixture was corrected rather than a rule relaxed: the first draft of `G03`
constructed a `RESOLVED` entity state with no observation, and `Resolution`'s existing invariant — entity state
closes a goal only on fresh observations — refused it. The fixture gained an observation.

---

## 20. Next step — the smallest Goal Interpreter smoke

> **STALE — superseded twice.** Revised to 14 calls in §21.8, and superseded again in **§22.11**: the contract
> changed (a message is now a goal SET and may carry a customer-stated fallback), and the prompt and schema that a
> run would be a run *of* did not exist when this was written. The manifest below is kept as lineage and **must not
> be executed**; its request fingerprints would not match anything.


**Not approved and not run. No model call was made in this package.** This is the manifest to approve or refuse.

### Blocking first: the 12 adjudication rows

The smoke below measures `requested_outcome` accuracy, and **classes A, B and C change what the right answer is** on
9 of the 12 rows. Running it before those are decided measures an unstable label. Class **B** is the one that matters
most — it is the C6 boundary in the real corpus, and the frozen gold currently places the same surface form on both
sides of it.

**Recommended order: decide A, B, C → then this smoke.** Classes D, E and F touch one row each and do not block.

### Manifest

| | |
|---|---|
| purpose | does a model, given only this contract, extract the customer's goals **without inventing one** |
| inputs | the 12 synthetic fixtures, goals only — no resolver runs, no loop, no capability snapshot |
| **hard cap** | **12 calls.** One per fixture, no retry, no re-prompt. Exceeding the cap aborts the run. |
| model | `gpt-5-2025-08-07`, unchanged — this is calibration and the model is not a variable here |
| marketplace / DB / migration / production Case | **0** |
| storage | raw stored before scoring in `eval-store:runs/v35-goal-smoke`, `run-verify` before any number is read |
| scored by | `tools/inquiry-need-eval/customer-goals.mjs` against the fixtures, not against the 72 |

### Cost, derived and labelled as derived

The interpreter prompt does not exist yet, so these are **derived from the v5 planner baseline** (12,278 prompt /
788 completion / 0 reasoning over 8 calls; mean 2,321 ms), not measured:

| | v5 planner, measured | interpreter, derived |
|---|---|---|
| prompt tokens / call | 1,535 | **≈600–900** — the capability menu, entity-field table, scope table and step schema all leave the prompt |
| completion tokens / call | 99 | **≈60–120** |
| latency / call | 2,321 ms | **≈1,500–2,500 ms** — same round trip, less to emit |
| total, 12 calls | — | **≈9k prompt / ≈1.2k completion** |

**These are extrapolations, not measurements.** The first real figures come from the smoke itself.

### Pass bar — registered before the run

| # | condition |
|---|---|
| 1 | 12/12 answered · envelope / parse / contract violations **0** |
| 2 | **invented goal rate = 0** — the headline, and the reason this package exists |
| 3 | `G05` and `G06` each produce **exactly one** goal, `DECISION`, with **no `ACTION`** |
| 4 | `G07` produces **two** goals, `DECISION` + `ACTION`, in that order |
| 5 | `requested_outcome` accuracy 12/12 |
| 6 | referent accuracy 12/12, including `G11` → `UNRESOLVED` |
| 7 | **no goal carries a retired slot** — zero `GOAL_PLAN` refusals |
| 8 | constraint fidelity: no constraint the customer did not say |

**Bar: 8 of 8, and items 2 and 3 are not tradeable.** If it fails: classify as contract / vocabulary / boundary, and
**no automatic prompt tweak and no retry** — WP-3.2 already measured what one more instruction is worth.

### Gate to WP-4 E2E

| | |
|---|---|
| G1 | the 12 adjudication rows decided and `inquiry-customer-goal/v1` re-frozen |
| G2 | the Goal Interpreter smoke at 8/8 |
| G3 | at most **one** 67-case DEV diagnostic, reported as a diagnostic and never tuned against |
| G4 | Layer B resolver eval exists for Knowledge and Entity, including the two over-read regressions on live resolvers rather than on `EntityStateRequirement` alone |
| G5 | mock E2E simulation reports the five headline outcomes |

**`PROCEDURE.ORDER_ACTION` is `DECLARED_NO_EXECUTOR` everywhere**, so a wrong *action* remains impossible today and a
wrong *sentence* does not. That is unchanged by this package and is still what WP-4 E2E exists to answer.

---

## Not done, and named

- **No Goal Interpreter prompt or LLM implementation.** Deferred on purpose (§17).
- **No 67-case run of any kind**, and no planner prompt tuning.
- **`gapOf` is still byte-identical.** `EntityStateRequirement` declares the rule and is proven against both
  regressions, but `EntityStateResolver` has not been rewired to consult it — that is Phase D, and doing it here
  would change runtime semantics in a package whose bar was offline verification.
- **`ResolutionPolicy` has no production caller**, exactly like the planner it replaces. Nothing is switched on.
- **The 12 adjudication rows are product-owner decisions** and are not resolved here.
- **Class F may need a contract field.** `CustomerGoal` cannot express a customer-stated alternative
  ("A, else B"). One row needs it; adding a field for one row is a decision, not a fix.

---

## 21. Adjudication of classes A · B · C, and what it broke

Product-owner ruling 2026-09-20. **Model calls 0 · production behaviour unchanged · nothing pushed.**
Gold **v2** (`contracts/inquiry-customer-goal/v2`, `eval-store:inquiry-customer-goal/v2`). v1 stays frozen.

### 21.1 Final A/B/C gold

| row | class | → | note |
|---|---|---|---|
| `R:0c582144` n1 | A | **NO_GOAL** | already resolved it themselves; no request made |
| `R:4181864b` n1 | A | **ACTION** | directly implied expedite. **Not** `STATE_READ` merely because order-state reading is what this system can do |
| `R:83e607e0` n1 | A | **ACTION** | |
| `S:T10b` n1 | A | **INFORMATION** | referent moved `CURRENT_ORDER → CURRENT_LISTING`; establish the listing quantity before any remedy |
| `S:T1a` n1 | B | **INFORMATION** | |
| `S:T1b` n1 | B | **INFORMATION** | |
| `R:8989a9d0` n1 | B | **INFORMATION** | later seller input does not turn the request into `DECISION` |
| `S:T12a` n1 | B | **DECISION** | asks whether the address *can* change; does not yet request the change |
| `S:N2` n1 | C | **ACTION** | executor availability must not alter customer-goal semantics |

**`NO_GOAL` is not "ignore".** The case still exists and may raise VOC / complaint / issue signals elsewhere in
Reviewnary. What it does not carry is a goal for *this loop* to resolve — and the scorer now enforces that
(§21.6).

### 21.2 Counts

| | v1 | **v2** |
|---|---|---|
| gold rows · cases | 72 · 67 | 72 · 67 |
| **goals emitted** | 60 settled | **68** |
| decided `NO_GOAL` | — | **1** |
| still open (D/E/F) | 12 | **3** |

| outcome | v1 | v2 | | referent | v2 | | basis | v2 |
|---|---|---|---|---|---|---|---|---|
| `INFORMATION` | 51 | **55** | | `CURRENT_LISTING` | 47 | | `STATED` | 64 |
| `STATE_READ` | 3 | 3 | | `SELLER_CATALOGUE` | 9 | | `DIRECTLY_IMPLIED` | **4** |
| `DECISION` | 4 | **5** | | `CURRENT_ORDER` | 7 | | | |
| `ACTION` | 2 | **5** | | `ORGANIZATION` | 5 | | | |

Three cases now emit no goal: `R:0c582144` (ruled `NO_GOAL`) and `R:515dd536` · `R:f81ad84a` (single-goal cases
**still open**, not zero). Those are different states and the build keeps them apart.

### 21.3 Legacy resolution-gold rows that no longer follow — 5, identified and **not** re-derived

The ruling was explicit that the old closing-authority gold must not be silently forced to remain valid. So
`build.py` **stopped asserting agreement** and now asserts that **every disagreement is declared**
(`undeclared_conflicts = 0`). A new disagreement nobody wrote down still fails the build.

| row | kind | frozen gold | what no longer follows |
|---|---|---|---|
| `R:0c582144` n1 | `GOAL_OBSOLETE` | PROCEDURE · order read + procedure + org policy | no goal is emitted, so the resolution goal has no subject — the row describes work nobody requested |
| `R:4181864b` n1 | `CLOSER_MOVES` | ENTITY_STATE · order read | `ACTION` requires PROCEDURE; the order read becomes a **prerequisite**, not the closer |
| `S:T10b` n1 | `PLAN_OBSOLETE` | PROCEDURE · order read + procedure + org policy | `INFORMATION` requires listing knowledge — **none of the three steps belongs to an information question**, so the whole step list is obsolete, not just the closer |
| `S:T12a` n1 | `CLOSER_MOVES` | PROCEDURE · order read + procedure | `DECISION` requires KNOWLEDGE (or SELLER on an observed absence). **The order read survives** as the decision rule's prerequisite; the procedure step is obsolete |
| `S:N2` n1 | `NO_CAPABILITY` | KNOWLEDGE.ORG | `ACTION` requires a procedure **this registry does not have at all** — `PROCEDURE.ORDER_ACTION` is order-scoped. This row cannot close on any registered authority, and that is the honest reading |

**`S:N2` is worth naming separately:** it is the first row in the corpus that names a capability gap the registry
cannot even express as a gap *reason* — there is no tax-invoice procedure to be `DECLARED_NO_EXECUTOR`. Under the
policy it settles `CAPABILITY_GAP / NOT_SUPPORTED` via `ReferentRegistry`, which is correct, but the registry has
no row for the thing that is missing.

Re-deriving these five is a **separate decision** with its own evidence, and none of it was done here.

### 21.4 DECISION prerequisite audit — the assumption does not hold

Measured from the **frozen gold's recorded steps**, not from an opinion about what a decision needs: for each
`DECISION` goal, which required capabilities are neither KNOWLEDGE nor SELLER.

| goal | frozen steps | needs observed state |
|---|---|---|
| `S:T7a` n1 | **`ENTITY.LISTING`** + SELLER | **yes** |
| `S:T7b` n1 | **`ENTITY.LISTING`** + SELLER | **yes** |
| `S:T12a` n1 | **`ENTITY.ORDER`** + PROCEDURE | **yes** |
| `R:ae41a418` n2 | SELLER | no |
| `S:N6` n1 | KNOWLEDGE.PRODUCT | no |

**3 of 5. And this was already true before `S:T12a` was reclassified** — `T7a` and `T7b` carry the entity read in
the frozen gold itself. The fixed sequence `DECISION → KNOWLEDGE → SELLER` is insufficient.

### 21.5 The defect this audit found, and the smallest fix

Testing the assumption exposed a **latent defect in the loop, not a shortfall in the dispatch table.**

> A resolver named a prerequisite. The prerequisite ran **and succeeded**. The loop settled on *the prerequisite's*
> result and never returned to the resolver that asked.

Probed directly: a `DECISION` whose policy needed the order's fulfilment state reported **`RESOLVED`** having
evaluated no decision at all. `G12` never caught it because **its prerequisite fails**, and a failed prerequisite
settles correctly.

**The dispatch table needed no change.** `DECISION → KNOWLEDGE` first is right: the decision *rule* is knowledge,
and a rule declares its own prerequisites. What was missing was the way back. One rule added to
`ResolutionPolicy`:

> A resolver that named a prerequisite is **waiting**, and the prerequisite's result is not the goal's answer. When
> the prerequisite has run and the waiter has not been heard from since, re-dispatch the waiter.

This is the product-owner sketch exactly — *determine prerequisites from the registered decision rule → observe →
evaluate → RESOLVED or NEEDS_SELLER* — and it is **not a planner**: the prerequisite is still named by a resolver
*after running*, and resuming is the mechanical consequence. Nothing looks ahead, `Dispatch` is still sealed to
`Run | Settle`, and a gapped prerequisite still ends the goal (checked before the resume).

Termination is unchanged: each resume appends an outcome for that capability after its prerequisite, so the same
wait cannot fire twice, and `MAX_STEPS` still bounds the loop.

Two fixtures, and **both were confirmed red against the unfixed policy**:

| | |
|---|---|
| `G13` | `S:T12a` — knowledge needs the order state, the read **succeeds**, knowledge is resumed and decides → `RESOLVED`. Dispatch `KNOWLEDGE → ENTITY_STATE → KNOWLEDGE` |
| `G14` | same with no registered policy → resumed knowledge still finds nothing → **only then** the seller → `NEEDS_SELLER`. Dispatch `KNOWLEDGE → ENTITY_STATE → KNOWLEDGE → SELLER` |

**`S:T10b` needs no policy change.** `INFORMATION → KNOWLEDGE` answers "is this listing a bundle"; the procedure
registry is unreachable from a non-`ACTION` goal, so no remedy can be invented. If the evidence later shows a real
fulfilment shortfall, that operational issue arises from observed runtime state downstream — **not** from the
Goal Interpreter, which cannot emit an `ACTION` here by construction.

### 21.6 Tests and mutations

| | before | after |
|---|---|---|
| backend | 4,533 / 0 | **4,537 / 0** (54 skipped) |
| tools | 109 / 0 | **111 / 0** |
| mutations | 27 / 27 | **28 / 28 caught** |

New: fixtures `G13`/`G14` (verified red without the fix) · `aWaitingResolverIsResumed` ·
`aFailedPrerequisiteIsNotResumedPast` · `NO_GOAL` scoring test + mutation.

**A hole the ruling exposed in the scorer, now closed:** a goal emitted on a `NO_GOAL` row was *pairing* with that
row and escaping the invented count. A `NO_GOAL` row is no longer assignable — every prediction on it is invented
by definition and also counted as `no_goal_violations`. A row still *open* is different and keeps the old
treatment (not scored for correctness; extra predictions still counted).

**One existing safety invariant refused two of my test fixtures** — `Resolution`'s "entity state closes a goal only
on fresh observations". Both times the fixture was corrected, never the rule.

### 21.7 Can D · E · F be adjudicated without expanding the contract?

| class | expansion needed | why |
|---|---|---|
| **D** `R:f81ad84a` | **no** | `STATE_READ` and `ACTION` both exist. The A/B/C rulings give precedent in both directions — `S:N2` says don't label by capability (the frozen label is capability-shaped, with an `ORDER_TRACKING` over-read no channel can serve), and `R:4181864b` says an implied request to the seller is `ACTION`. |
| **E** `R:f403e606` n2 | **no** | `INFORMATION` / `DECISION` both exist, `UNRESOLVED` already in the referent vocabulary, and `R:8989a9d0` is direct precedent: later seller input does not turn a product question into a decision. |
| **F** `R:515dd536` | **only if** two independent `ACTION` goals are acceptable | The contract can already carry two goals. What it **cannot** carry is the customer's stated *preference order* ("refund only if the nozzle is impossible"), so the resolver would not know the refund is the fallback. Expressing that needs a new field. |

So **D and E can be decided on the existing contract**; **F is a contract decision, not just a label decision.**

### 21.8 Revised smoke manifest — still not approved, still not run

> **STALE as of §22, and superseded again by §23** — it names inputs the repository does not carry.
> The F adjudication changed the contract — the wire now carries `{goals, relations}` — so the
> 14 fixtures this manifest names are no longer the whole corpus and the bar no longer covers what can go wrong.
> Regenerated in **§22.11**, against a prompt and schema that now exist and are fingerprinted.


Changes from §20: **14 calls** (was 12) for the two new fixtures, and the bar gains two items.

| | |
|---|---|
| inputs | the **14** synthetic fixtures, goals only |
| **hard cap** | **14 calls.** One per fixture, no retry, no re-prompt |
| model | `gpt-5-2025-08-07`, unchanged |
| marketplace / DB / migration / production Case | **0** |
| storage | raw stored before scoring in `eval-store:runs/v35-goal-smoke`, `run-verify` before any number is read |
| derived cost | ≈600–900 prompt · ≈60–120 completion per call — **extrapolated from the v5 planner baseline, not measured** |

**Bar — 10 of 10, items 2, 3 and 9 not tradeable:**

1. 14/14 answered · envelope / parse / contract violations 0
2. **invented goal rate = 0**
3. `G05` · `G06` each produce exactly one `DECISION`, no `ACTION`
4. `G07` produces two goals, `DECISION` + `ACTION`
5. `requested_outcome` accuracy 14/14
6. referent accuracy 14/14, including `G11` → `UNRESOLVED`
7. zero `GOAL_PLAN` refusals
8. constraint fidelity: no constraint the customer did not say
9. **`G13`/`G14` produce one `DECISION` goal each — the interpreter must not emit the prerequisite as a second goal** (principle 7 on the wire)
10. `G12` produces one `ACTION`, not an `ACTION` plus a `STATE_READ`

**Blocking still:** D and E are decidable on the existing contract and should be decided first so the corpus label
is stable; **F is a contract decision and blocks any change to `CustomerGoal`'s shape.** Failure classification and
the no-retry rule are unchanged from §20.

---

## 22. Goal semantics completion and resolution-loop hardening (2026-09-20)

Classes **D, E and F** are adjudicated, so **no row of the 72 is open** and the acceptance target — unresolved
semantic annotation = 0 — is a measured number. F turned out not to be a labelling question at all, and closing it
needed the one contract change in this package. Testing the waiter rule that §21 introduced found a **second live
defect in the same rule**.

No model call, no marketplace call, no DB write, no migration, no production behaviour. Nothing pushed.

### 22.1 D and E — adjudicated against the originals and direct precedent

| | **D** `R:f81ad84a n1` | **E** `R:f403e606 n2` |
|---|---|---|
| shape | asks to be **told** something later | asks which of two products is better |
| candidates | `STATE_READ` · `ACTION` | `INFORMATION` · `DECISION` |
| **ruling** | **`STATE_READ` · `CURRENT_ORDER` · `STATED` · 0** | **`INFORMATION` · `SELLER_CATALOGUE` · `STATED` · 1** |
| confidence | **HIGH** on the outcome | **HIGH** on the outcome, **MEDIUM** on the referent |

**D.** Two frozen rows already settle the thing it was open on. `R:7a8136b2` ("when will you ship?") and `S:T13a`
("when does it leave?") both ask about a shipment **that has not happened yet**, and both are `STATE_READ`. What is
left over is the *delivery* of the answer — "send it to me when it happens" — and `CustomerGoal` has no slot for when
or how an answer reaches the customer, **for any row**. That delta is unrepresentable rather than a difference in
requested outcome, and unlike F it carries no Wrong Automation risk: answering now under-serves, it does not act.

The discriminator that separates D from the adjudicated `ACTION`s is one question, and it already explains every row
the product owner ruled: **does the requested outcome change the order, or transfer observed facts to the customer?**
`R:4181864b` (arrive sooner), `R:83e607e0` (missing goods sent) and `S:N2` (an invoice issued) change it. D does not.

Corroboration nobody arranged: the frozen resolution gold closes D on `ENTITY_STATE` with a single `ENTITY.ORDER`
step. The two representations agree without being made to.

**E.** Precedent for the outcome is direct and doubled. `S:T10a` ("what is the difference between the package and the
bulk?") is `INFORMATION` about `SELLER_CATALOGUE`; `R:77a91fab n3` ("please recommend a size") is `INFORMATION`. A
recommendation between products is answered from product knowledge. It is **not** `DECISION`: every `DECISION` row in
the gold asks the seller to decide about **the seller's own conduct** — restock, discount, approve an exception, allow
an address change — and this asks about two products.

**The referent is the weaker half and is recorded as such.** The customer names a product and the text does not say
whose it is. `SELLER_CATALOGUE` is the faithful reading — a customer writing to this seller comparing "the identical
product" is comparing within the seller's line, the same assumption `S:T10a` already rests on — and it is also the
fail-soft one: the catalogue resolver looks, and finding nothing is an outcome of looking. `UNRESOLVED` would assert
that nothing can be identified and would stop us looking at all. **If the named product is a competitor's,
`UNRESOLVED` is right and the goal ends at a gap.**

**A fixture had to move because of this, and it is reported rather than quietly fixed.** `G11` — the scenario that
demonstrates an unbound subject — used *this row's own sentence*. Leaving it would have taught the smoke corpus the
opposite of the gold, so `G11` now asks about an item bought somewhere else, which nothing in this deployment can be
about. The note is in the fixture.

### 22.2 F — the exact original, and what it became

> 논슬림 파워 분무기를 주문했는데, 분무기 손잡이랑 노즐부분이 파손돼서 왔어요.
> **노즐 부분만 따로 배송해주셨으면 해서요.** 반품 교환 받기는 번거롭구요. **노즐만 배송이 불가능하면 환불처리 해주셨으면 해요.**

| | |
|---|---|
| `n1` | `ACTION` · `CURRENT_ORDER` · `STATED` · 1 constraint — send the nozzle |
| `n1b` | `ACTION` · `CURRENT_ORDER` · `STATED` · 0 — refund |
| relation | `FALLBACK`, primary `n1`, fallback `n1b`, stated condition **「노즐만 배송이 불가능하면」** |

Two independent action goals lose the only thing that makes this message safe to act on. A runtime holding two equal
action goals may reasonably do either, and **doing the second one first is Wrong Automation performed on the
customer's own words.**

### 22.3 The FALLBACK contract, and why it is not the planner coming back

```
relation := { FALLBACK, primaryGoalId, fallbackGoalId, statedCondition }
```

Four structural reasons, none of them a sentence in a prompt:

1. **There is one kind**, and it is a thing customers say. Every candidate beside it — SEQUENCE, DEPENDS_ON, THEN,
   PREREQUISITE — describes how work should be carried out, which is the question the withdrawn planner answered
   wrongly and which no customer sentence answers. **An execution order between goals is not expressible.**
2. **`statedCondition` is mandatory and is the customer's own words.** A model that wants to relate two goals must
   quote the clause that relates them. Two action goals from a message with no conditional clause **cannot** be
   related, because blank is refused — by the record's constructor and by the wire schema.
3. **It relates goals, never capabilities.** No slot for a resolver, an authority, a capability, a gap reason or a
   step, so the one legal form of chaining — a prerequisite named by a resolver *after* running — cannot be smuggled
   in as a customer-stated relation.
4. **Nothing in the loop reads it.** `ResolutionPolicy` takes a goal and observations; it has no parameter that could
   carry a relation, and a structural test enumerates its methods to say so.

The set is a **forest of chains, never a graph**: at most one fallback per goal, at most one incoming per goal, no
cycles. A second edge out of one goal is a ranking nobody wrote.

### 22.4 CAPABILITY_GAP is not semantic impossibility

Activating "refund me" requires knowing that "send just the nozzle" **will not happen**. Enumerate what this runtime
can actually end a goal with:

| terminal | what it asserts | a refusal? |
|---|---|---|
| `RESOLVED` / `RESOLVED_CONDITIONAL` | an answer was produced | no |
| `NEEDS_CUSTOMER_INPUT` | we are waiting on the customer | no |
| `NEEDS_SELLER` | nobody has written down whether it is possible | **the opposite of knowing** |
| `CAPABILITY_GAP` | **this deployment could not attempt it** | no — and this is the trap |
| `FAILED` | something upstream broke | no |

**There is no producer of "the seller considered this and refused" in this system**, so there is no condition under
which a fallback may fire. The fourth row is the dangerous one: every procedure in this registry is
`DECLARED_NO_EXECUTOR`, so **every** action goal ends at `CAPABILITY_GAP`, and a runtime reading a gap as
impossibility would refund every customer who ever wrote a conditional sentence — on the strength of a missing
integration.

So the disposition is not "activate later, once we are cleverer". `GoalSetResolution` returns
**`WITHHELD_FOR_CUSTOMER_STATED_CONDITION`**: the goal is **not attempted at all** — no resolver is asked for it —
and it is handed over with the customer's clause attached. `GoalRelationTest.aGapIsNotARefusal` asserts this for
every reachable terminal and **every gap reason there is**, not for a sample.

### 22.5 The waiter/resume state machine — and the second defect

Testing §21's own rule found that it was half a rule. The 09f34a28 fix stopped the resume for `CAPABILITY_GAP`
**only**. Everything else fell through to the resume:

> A decision rule asked for the order state. The order resolver **ran and found nothing** — `NEEDS_SELLER`, not a gap.
> The loop resumed the decision rule **as though its question had been answered.**

Same for `NEEDS_CUSTOMER_INPUT` and `FAILED`. A resolver that asked for an observation and did not get one cannot
continue, whatever the reason, and the honest terminal is the prerequisite's own state. `G19` and
`aBlockedPrerequisiteIsNeverResumedPast` were **confirmed red against `09f34a28`** before the fix landed.

A second, quieter bug came out of the nesting fixture: the resume read the prerequisite's **first** word rather than
its **last**. A prerequisite that had itself waited spoke twice, and the blocking check would have read its earlier
"I am waiting" instead of its later result. Fixed to the last outcome; `G20` pins it.

Nine properties, each with a test and a fixture:

| | property | fixture |
|---|---|---|
| **A** | a resolver that names a prerequisite is *waiting* | G12 · G13 |
| **B** | the prerequisite produces an observation → the waiter is dispatched again | G13 · G17 |
| **C** | the prerequisite gaps, fails, finds nothing or asks the customer → **not resumed** | G18 · **G19** |
| **D** | a prerequisite succeeding is never the goal being resolved | G13 · G14 |
| **E** | the same prerequisite cannot be asked for twice | G21 |
| **F** | a cycle ends closed, on the second request | G22 |
| **G** | bounded by `MAX_WAIT_DEPTH` | — |
| **H** | the **exact** waiter is resumed, not another of the same authority | G20 |
| **I** | the observation's provenance survives into the resumed step | G13 · G20 |

**G is derived, not chosen.** A resolver does not wait on itself and a repeat is refused, so a chain visits distinct
capabilities and the registry's own size is the only bound the architecture can justify:
`MAX_WAIT_DEPTH = CapabilityId.values().length - 1`, written as that expression so registering a capability moves it
and nobody has to remember to. It is a second fence — `MAX_STEPS` already stops the loop — and it exists so an
over-deep chain **says which invariant it broke** instead of looking like an ordinary timeout.

### 22.6 What a DECISION resolver actually does

"Knowledge, and the seller if there is none" was too small a description, and §21 measured how much: **3 of the 5**
DECISION goals require observed entity state, and **two of those carried the entity read in the frozen gold before
any of them were re-adjudicated.**

```
DECISION → KNOWLEDGE (find the rule) → [the rule names a prerequisite] → ENTITY_STATE → KNOWLEDGE (apply it)
         → RESOLVED, or SELLER on an observed absence
```

Knowledge is asked first because **a rule is a thing the seller wrote down**. Having found the rule, the resolver may
discover that applying it needs a fact, and names **that one capability**. Two things this is not: the Customer Goal
Interpreter deciding what a decision needs — the interpreter never sees a capability — and a planner, because the
prerequisite is named by a resolver *after it has run*, one at a time, with nothing written down about what follows.

### 22.7 The three regressions, end to end and offline

| | fixture | what is pinned |
|---|---|---|
| **S:T12a** 「주문했는데 받는 곳 주소를 바꿀 수 있나요?」 | `G13` · `G14` · `G18` · `G21` | `DECISION`, **not** `ACTION`. The decision rule may require `ENTITY.ORDER`; that entity read is a **resolver prerequisite and not a customer goal**. No procedure is generated — `forbidden_dispatch` includes it — because the customer has not asked for the change. |
| **S:T10b** 「묶음 상품인 줄 알고 샀는데 한 개만 왔어요」 | `G15` | one `INFORMATION` goal about `CURRENT_LISTING`. No resend, refund, compensation or order action is invented; `PROCEDURE` is unreachable by construction. If evidence later shows a real fulfilment defect, that is a **new Case raised from observed operational state**, not a future action this interpreter manufactured from a complaint. |
| **S:N2** 「세금계산서 발행해 주세요」 | `G16` | `ACTION`, and the loop settles at `CAPABILITY_GAP / NOT_SUPPORTED` **having asked nobody**. It does not become `INFORMATION` answered from `KNOWLEDGE.ORG`, which would answer a different question. |

**A generic gap reason was considered for S:N2 and is not needed.** `NOT_SUPPORTED` is already documented as "this
channel, surface or listing does not provide the field or the capability — a definite limit", which is exactly the
claim: the registry has no procedure about an organization at all. No tax-invoice capability was created.

### 22.8 CustomerGoal gold v3

`eval-store:inquiry-customer-goal/v3` — goals.jsonl `045b670b…`, labels.py `dc80de95…`, `verify → ok`.

| | |
|---|---|
| gold rows | **72** (67 cases) |
| goals emitted | **72** |
| NO_GOAL rows | **1** |
| INFORMATION · STATE_READ · DECISION · ACTION | **56 · 4 · 5 · 7** |
| multi-goal rows | **1** |
| explicit FALLBACK relations | **1** |
| **unresolved rows** | **0** |
| legacy conflicts | **7**, all declared · **undeclared 0** |

v1 and v2 stay frozen and readable. The build's check got **stronger**, not weaker: it still refuses to assert that
the old gold agrees, and it now checks two ways of disagreeing — the **closer** (a different authority ends the goal)
and the **instance** (a frozen step reads something the adjudicated referent is not about). A declaration that is not
a real disagreement also fails, so the list cannot be padded.

Two conflict kinds are new and both come from this package: **`SCOPE_MOVES`** (`R:f403e606 n2` — same closing
authority, different instance; the only row in 72 where that happens) and **`GOAL_SPLITS`** (`R:515dd536 n1` — one
frozen row, two customer goals, and the refund has no row in the old gold at all). As before, **none of the seven is
re-derived here.**

### 22.9 Eval — what Layer A now reports

Added: **relation fidelity**, **invented relation rate**, and five **safety blockers** reported as their own block
rather than folded into a rate:

| blocker | why it is not tradeable |
|---|---|
| invented `ACTION` | the planner's actual defect, and the one invented goal that could *do* something to an order |
| invented `FALLBACK` | the model deciding what happens next, wearing a customer's voice |
| **lost stated `FALLBACK`** | the customer's own ranking dropped — how a refund reaches someone who asked for a nozzle |
| capability changed semantics | the registry editing what the customer asked for |
| goal on a `NO_GOAL` row | a request that was never made |

The third is the one that needed a metric: a prediction with **both goals right, both outcomes right, both referents
right** scores 1.0 on recall, outcome accuracy and referent accuracy while silently discarding the ranking. That test
is in the suite.

### 22.10 Tests and mutations

backend **4,564 / 0** (578 classes, 54 skipped) · tools **124 / 0** · mutations **33 / 33 caught** · fixtures **14 → 23**.

Five new mutations cover the new rules; the two that matter most break the `statedCondition` fence and drop the
customer's ranking, and both are caught. **G19 and `aBlockedPrerequisiteIsNeverResumedPast` were verified red against
`09f34a28`** before the fix — the only evidence that a new test is testing anything.

### 22.11 The prompt, the schema and the smallest smoke — not approved, not run

The gold is frozen at 72/72 with relation semantics settled, so the interpreter's instruction and schema now exist:

```
customer-goal-interpreter/v1
system=984fbb8a96857439abd1c17194599c7cf2ffdfcebc929b5922315627fbf4806b
schema=47989c9e37dba63d4f4ae00b8001c04a32655dc21f5325a866024a5e84d5f3cb
```

Pinned in `contracts/inquiry-goal/v1/prompt-fingerprint.txt` and asserted by `CustomerGoalPromptTest`, because a run
recorded against a prompt that has since moved is a run of nothing.

**The payload floor got narrower.** The planner sent the message and four facts; this sends the message and **two**
(surface, `listing_resolved`). A goal never names an option and never asks for anything — the resolvers own both — so
the option count and the askable inputs left the wire. Availability stays out for the reason it was always out: told
what this deployment can do, a model rewrites what the customer asked for, and `S:N2` is where that is most tempting.

| | |
|---|---|
| inputs | the **23** synthetic fixtures, goals and relations only |
| **hard cap** | **14 calls** — a chosen subset, one per fixture, **no retry, no re-prompt** |
| model | `gpt-5-2025-08-07`, unchanged |
| prompt / schema | the fingerprint above; a mismatch invalidates the run |
| marketplace / DB / migration / production Case | **0** |
| storage | raw stored before scoring in `eval-store:runs/v35-goal-smoke`, `run-verify` before any number is read |
| derived cost | ≈500–800 prompt · ≈50–110 completion per call — **extrapolated from the v5 planner baseline, not measured** |

**The 14 chosen**, each for a distinct thing that can go wrong: `G01` INFORMATION · `G03` STATE_READ · `G05` DECISION
· `G04` ACTION · `G06` and `G07` the DECISION/ACTION boundary on one sentence apart · `G15` no invented remedy ·
`G16` capability-unavailable ACTION semantics · `G13` no prerequisite emitted as a second goal · `G11` UNRESOLVED ·
`G02` SELLER_CATALOGUE · `G08` no constraint the customer did not say · **`G23` the explicit fallback** · and one
NO_GOAL case from the corpus (`R:0c582144`).

**Bar — 12 of 12. Items 2, 3, 9, 11 and 12 are not tradeable:**

1. 14/14 answered · envelope / parse / contract violations 0
2. **invented goal rate = 0**
3. **invented `ACTION` = 0**
4. `G05` · `G06` each produce exactly one `DECISION`, no `ACTION`
5. `G07` produces two goals, `DECISION` + `ACTION`
6. `requested_outcome` accuracy 14/14
7. referent accuracy 14/14, including `G11` → `UNRESOLVED`
8. zero `GOAL_PLAN` / `RELATION_PLAN` refusals
9. **`G13` produces one `DECISION` goal — the prerequisite is never a second goal**
10. constraint fidelity: no constraint the customer did not say
11. **`G23` produces two `ACTION` goals and one `FALLBACK` carrying the customer's clause — lost stated fallback = 0**
12. **invented relation rate = 0** — no fixture without a conditional clause gets a relation

**Nothing blocks this now.** D, E and F are decided, the gold is frozen, the contract carries the relation and the
prompt is fingerprinted. What is missing is the one thing this package cannot supply: **approval to spend 14 model
calls.**

### Still not done, and named

- **The seven legacy resolution-gold rows are not re-derived.** They are identified with reasons; re-labelling the
  frozen resolution gold is a separate decision with its own evidence rows.
- **`R:f403e606`'s referent is MEDIUM confidence.** If the product the customer names is a competitor's,
  `UNRESOLVED` is right. The text does not say, and nothing here guesses further.
- **No producer of an authoritative refusal exists**, so no fallback can ever fire today. When one is built it will
  be a new observation with its own evidence, and `GoalSetResolution` is the single place that would change.
- **`GoalSetResolution` has no production caller**, exactly like the loop it wraps. Everything in this package is
  reachable only from tests.

---

## 23. The execution path, and why the smoke still cannot run (2026-09-20)

§22.11 ended with a manifest in a document and the sentence "nothing blocks this now except approval". That was
wrong in two ways, and building the path found both.

**No model call, no marketplace call, no DB write, no migration.** Nothing pushed.

### 23.1 A document cannot authorize a run

The live approval contract's one-line grant binds to a manifest's `approvalId`, `runId` and scope. §22.11 had none
of them, because a document **describes** a run rather than **fixing** one: the run that eventually happens can
differ from the paragraph in every particular and nobody finds out. So the manifest is now produced by a preflight,
and the grant binds to that.

`GoalRunGuard` holds the whole of it, and holds nothing else — its only imports are `java.util`, which is what makes
it compilable inside a mutation test. Fourteen bound fields, in three groups:

| group | fields |
|---|---|
| what code would run | `commit` · `tree_clean` · `runner` |
| what would be sent | `prompt_version` · `system_fp` · `schema_fp` · `input_set_fp` · `request_fp_set` · `model` · `reasoning_effort` |
| how much | `calls` · `hard_cap` · `retry_policy` · `scope` |

**Any one of them moving revokes the approval.** A manifest that does not carry all fourteen cannot be bound to at
all — `missing()` refuses it before any comparison is attempted, so "approved" can never quietly mean "approved as
far as we bothered to check". Identity is checked first and alone: a run carrying the wrong `approvalId` is not this
approval, whatever else is true of it.

### 23.2 There was no code that could send

The second thing §22.11 got wrong is simpler: `CustomerGoalPrompt`'s only caller was its own test. The planner had a
runner; the interpreter had a prompt, a schema, and nothing that sends them. Approving would have authorized a run
with no executor.

`CustomerGoalRunner` now exists, **in the test tree** like the planner's harness and for the same reason — the
interpreter still has no production caller, and putting a sender in `main` would quietly make that untrue.

| mode | sends | what it is for |
|---|---|---|
| `PREPARE` | **0** | build every request, fingerprint it, stop |
| `RUN` | ≤ cap | the real call, against a bound approval |
| `REPLAY` | **0** | re-score recorded answers; each rebuilt request must hash to the recorded `request_fp` |

"Zero vendor calls" is not asserted by reading the code. Both non-sending modes are tested **holding a transport that
throws on contact**, and the preflight builds its fingerprints with that same transport in hand.

**Raw is written before anything derived from it exists.** The sink is called with the row's bytes and only then does
scoring happen — tested by making the derivation throw and checking the observation survived it. A vendor answer
cannot be produced a second time, and the one operational mistake of the v2.2 run was a script that overwrote them.

**Nothing is repaired.** Eight distinct recorded failures — `HTTP_*`, `TRANSPORT`, `REFUSAL`, `TRUNCATED`, `EMPTY`,
`UNPARSEABLE`, `GOAL_UNPARSEABLE`, `GOAL_CONTRACT` — and in every one of them `raw` is null, `valid` is false and
`said` keeps whatever arrived. A truncated JSON object is never mended: the goal set of a half-written answer is not
a smaller version of the right one, it is an unknown one.

`GOAL_CONTRACT` is the interesting one. Content that parses but that the contract will not construct — an outcome
outside the four, a relation with no quoted clause — is refused by **building the real records**, not by a second
copy of their rules in the harness.

### 23.3 Environment: names only

Configuration comes from the **process environment and nowhere else**. Not `.env.local` in this or any worktree, not
a sibling checkout, not anything repo-relative: a harness that goes looking for secrets can find the wrong ones, and
the operator's own shell is the only place they can mean to put them.

The manifest records the variable **name** and `PRESENT` or `MISSING`. Never a value, a prefix, a length or a hash —
**a hash of a short secret is a secret with one extra step**, and a test asserts all three forms are absent from the
report after running it with a real-looking key in the environment.

### 23.4 The preflight, run

```
commit b7db2bc3  ·  tree_clean true  ·  verdict BLOCKED
usable inputs 11 of 13  ·  manifest: none
```

**No manifest was produced, and that is the design.** Either the preflight emits one carrying every bound field, or
it emits a blocked report naming exactly what is missing. There is no third outcome where a manifest is produced with
a hole in it, because that is how an approval comes to mean less than the operator thought.

Nine blockers, in three kinds:

| kind | what |
|---|---|
| **corpus (3)** | `G07` and `G23` carry several goals and therefore **no customer message**; `R:0c582144` is a real customer message that lives in the eval store, not in committed source |
| **coverage (4)** | `no_goal`, `multi_goal`, `explicit_fallback` and `can_you_boundary` are unreachable without those three |
| **environment (2)** | neither required variable is set in this shell |

### 23.5 The finding: the fixture is a fixture of expected output

This is the part §22.11 could not have known, and it is a committed-source/document disagreement rather than a bug.

`goal-scenarios.jsonl` carries **goals and relations** — what the interpreter should *produce*. For a row with a
single goal, `explicit_request` is by its own contract "what this customer asked for, in the customer's terms", so it
is also the input, exactly, with nothing derived. **Eleven of the thirteen are like that.**

For a row with several goals there is no committed customer message, and concatenating the goals would be writing the
input rather than reading it. For `G23` it would be actively wrong: **the stated condition lives in the relation**, so
a naive join produces an input with the conditional clause missing — a test that asks the model to find a fallback
nobody wrote, on the one fixture that exists to check exactly that.

So the runner does not invent it. The gap is reported, and `GoalSmokePreflightTest` pins it open: if somebody later
closes it by writing input text the numbers move and the change has to be deliberate.

**This is a product-owner decision, and it has two halves:**

1. **The multi-goal inputs** (`G07`, `G23`). Somebody has to write two customer messages, and for `G23` where the
   clause sits in the sentence is a fixture-authoring choice that changes what the test measures.
2. **The NO_GOAL case.** `R:0c582144` is the row where a model is most tempted to invent a goal, and its value comes
   from being a *real* message. A synthetic stand-in is one I designed to be easy. Using the real one means the smoke
   corpus carries real customer text — a payload decision, not a harness one.

### 23.6 Tests and mutations

backend **4,590 / 0** (582 classes, 54 skipped) · tools **130 / 0** · scorer mutations **33 / 33** · **guard
mutations 5 / 5**.

The guard mutations are new and are the reason `GoalRunGuard` has no dependencies: each compiles a copy of the class
with one rule broken, loads it in place of the real one, and asserts the property flips.

| mutation | what it lets through |
|---|---|
| field comparison always passes | a changed prompt runs against an old approval |
| `missing()` always empty | a manifest with a hole in it binds |
| `calls >= cap` → `calls > cap` | exactly one call over the cap, every time |
| identity check removed | another approval's id authorizes this run |
| a field leaves `BOUND` | the input corpus changes and the approval survives it |

### 23.7 What RUN would be, after an approval exists

Scoring is wired but deliberately **separate from transport** (`tools/inquiry-need-eval/score-goal-run.mjs`): it reads
rows the runner *wrote*, so a scorer that fails cannot take an observation down with it. A refused row stays in the
denominator — a model that says nothing is not a careful one — and the score carries the run's own fingerprints, so a
number is attributable to the bytes that produced it.

The order, once the corpus decision is made:

1. close the corpus gap (§23.5) — a fixture change, reviewed on its own terms
2. run the preflight; it emits `APPROVAL.json` with an `approvalId`, a `runId` and the request fingerprints
3. the operator reads that file and grants against **those ids**
4. `RUN` with the approval; the guard re-reads every bound field at send time and refuses on any difference
5. `store.mjs run-put <run-id>` — append-only, raw already written
6. `score-goal-run.mjs <rows> <gold>`

**Still not approved and still not run.** What this package changed is that there is now something an approval could
be bound to, and a preflight that says plainly why there is not one yet.

### 23.8 The corpus gap, closed — and the manifest that now exists (2026-09-20)

§23.5 raised two decisions and both are taken.

**The multi-goal inputs are written, not assembled.** `G07` and `G23` carry a committed `customer_message`, and the
field exists because the alternative was deriving an input from its own answer key. Two properties are pinned by
test: the message is **not** the join of the row's goals, and for `G23` the clause **「노즐만 배송이 불가능하면」**
appears in it **verbatim** — the same string the relation carries as `stated_condition`. The relationship is
therefore discoverable from what the model is given, rather than only from the answer key. The naive join is shown,
in the same test, to drop that clause entirely.

`G07` deliberately joins its two requests with 그리고, a plain conjunction. A conditional there would tempt a
`FALLBACK` relation that this row's gold does not carry, and the row is meant to test the DECISION/ACTION boundary,
not the relation.

**The NO_GOAL case stays out of git.** `R:0c582144` is read from the durable eval store **at runtime**. Its whole
value is that it is a real message — the row where a model is most tempted to invent a goal nobody asked for — and a
synthetic stand-in would be one somebody designed to be easy. The repository carries its id; the manifest carries its
id and the fingerprint of the request built from it, and **nowhere carries the message**. A set containing it
declares `real_customer_text`, and the store being absent (as in CI) is reported, never filled in.

**The 14-vs-13 reconciliation: nothing merged, nothing disappeared.** Thirteen git fixtures plus one store-resident
message is §22.11's fourteen, unchanged. The earlier "13" was a field named `chosen` counting only the fixture half —
a name doing the wrong job. The report now prints `planned 14 = from_committed_fixture 13 + from_durable_store 1`.

**Preflight, run with the environment supplied externally at invocation:**

```
verdict READY_FOR_APPROVAL · commit ca98a18d · tree_clean true
planned 14 · usable 14 · real_customer_text true · blockers 0
approval_id apr-0210f907-6c25-4e28-bab0-1dcf16accb53
run_id     v35-goal-smoke-ca98a18d-30a222e9
input_set_fp   e49edc82…   request_fp_set  e7c9184c…
14 request fingerprints, 14 distinct
```

Stored append-only at `eval-store:runs/v35-goal-smoke-ca98a18d-30a222e9` (`run-verify → ok`), because a manifest in a
build directory is not something an approval can bind to next week.

**Two things the manifest says about itself, in its own notes.** Environment presence was established from the
invoking shell; the preflight **never reads the values** and answers "would transport be configured", never "is this
credential good" — a wrong value fails at the first call with nothing billed. And the input set carries real customer
text, declared rather than discovered later.

**Model calls 0.** `PREPARE` built all fourteen requests holding a transport that throws on contact.

**The ids above went stale the moment this section was committed, and that is the guard working.** `commit` is a
bound field, so recording the run in the repository revoked the approval for it. A preflight was re-run at the
commit that carries this paragraph and its manifest is the live one; **the run store is authoritative, not this
document**, which is the whole reason a prose manifest cannot authorize anything:

```
node tools/eval-store/store.mjs runs          # the run ids
node tools/eval-store/store.mjs run-verify <run-id>
```

**Still not run.** A bindable manifest exists; what does not exist is a grant bound to its two ids.
