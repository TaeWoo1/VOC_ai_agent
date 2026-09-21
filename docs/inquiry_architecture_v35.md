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
it compilable inside a mutation test. Fourteen bound fields, in three groups (**a fifteenth, `transport`, was added
in §24.2**; the table below is this package's, and §24.2 says why the tool belongs in it):

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

---

## 24. Execution infrastructure, finished and frozen (2026-09-21)

§23 ended with a bindable manifest, a guard the send path actually consults, and a launcher. What it did not have
was a **command**. Running the smoke meant assembling a `java -cp` line by hand from a doc comment, and then — after
the vendor had answered and the answers could never be obtained again — reading the last line of the log and
remembering to run two more tools. This package closes that, and then stops.

**Model calls 0 · marketplace 0 · DB writes 0 · migrations 0 · production callers 0.** Nothing pushed.

### 24.1 One command, and it is the real one

```
cd backend
SELLEROPS_INQUIRY_GOAL_API_KEY='…' \
SELLEROPS_INQUIRY_GOAL_ENDPOINT='https://…' \
./gradlew --no-daemon -q --offline runGoalSmoke \
  --args='--approval <manifest> --granted-approval apr-… --granted-run <run-id> --out <a new directory>'
```

That single invocation covers the whole path: environment read → manifest load → frozen input assembly → **every
bound field recomputed from the world** → `GoalRunGuard.refusals` → credential and output-collision checks →
transport → raw streamed to disk → derived rows → scoring → `run-put` → `run-verify` → a report. **Nothing is left
for an operator to remember**, because the moment at which a human is least able to recover from a forgotten step is
exactly the moment the previous design asked them to take one.

The task runs on the **test runtime classpath**. That is not a convenience: the interpreter still has no production
caller, and a task pointed at a main-tree entrypoint would quietly make that untrue. The task itself implements no
approval semantics at all — it starts a JVM and hands it the process environment. Every authorization decision stays
in `CustomerGoalRunner` and `GoalRunGuard`, so there is exactly one place to get it wrong.

`--no-daemon` is in the command because a reused Gradle daemon can answer `System.getenv()` with the environment it
was *started* with, and **a credential that silently fails to arrive is indistinguishable from one that is wrong**.

### 24.2 The tool is part of the manifest — a fifteenth bound field

A rehearsal needs a fake vendor. The question is what stops a rehearsal approval from being spent on a real one, and
the answer was already written down: the live approval contract §4 says *"a change of the execution TOOL (CLI/driver)
⇒ the existing manifest is immediately REVOKED. The tool is part of the manifest; you cannot approve one tool and
run another."*

So `transport` is a **bound field**, not a flag beside the approval, and the crossing is refused in both directions
by the same comparison that refuses a moved commit. Without it, a rehearsal manifest would be a real manifest with a
note attached — and a note is precisely the thing §23.1 established cannot authorize anything.

Three further properties make the mode hard to get wrong:

- **`REAL` is the default.** An unset, blank or misspelled variable selects the real transport; only the exact token
  `FAKE` selects the other one.
- **The fake has no network address.** Its endpoint is the constant `fake://goal-smoke-rehearsal/no-network`, and it
  throws if handed any other. A rehearsal cannot be aimed at a vendor by a variable left over in a shell, and the
  real endpoint variable is **not read at all** in that mode.
- **The mode is read off the transport in hand**, not from a parameter describing it — a field claiming "this is a
  real run" can disagree with the object doing the sending, and the disagreement would favour the rehearsal.

Every row carries `transport`, so a rehearsal artifact cannot be read as a model result later even by someone
holding only the rows. The manifest says so in its notes, and the run report says
`EXECUTION REHEARSAL ONLY — … says NOTHING about a model`.

### 24.3 Consumed, and incomplete, are now facts on disk

The approval lifecycle says `CONSUMED` is "the first permitted live action ran". That instant now writes
`RUN_STARTED.json`, on the first row and after every check that could refuse — so:

| what happened | what the directory holds |
|---|---|
| refused (guard, credential, collision, environment) | **nothing at all** — the writers open on the first row |
| killed mid-run | `RUN_STARTED.json` + the answers already received |
| finished | both markers, rows, raw, `score.json` |

`RUN_COMPLETE.json` is written only when the send loop returned and every observation is durable. **Its absence is
what makes an interrupted run distinguishable from a finished one**, rather than a file count somebody interprets.

### 24.4 Raw is primary truth, and the finalizer may not touch it

Scoring, storage and verification are now part of the command, which raises the obvious risk: a step that runs after
the vendor answered must never be able to take the answer with it. So every finalization step **adds** files and
reads others; none writes to `raw.jsonl` or `rows.jsonl`, none deletes anything, and **a failure in any step is
recorded and carried rather than thrown**. A scorer that cannot find its gold, a store that refuses the run, a
missing `node` — all of them leave the observations exactly where they landed and say so in the report.

The scorer is invoked as the committed script rather than reimplemented, because a second copy of a metric is right
until the day it is not. The finalizer's subprocesses have the **credential removed from their environment**: neither
the scorer nor the store has any use for it, and both would otherwise inherit it merely by being children.

**A defect the rehearsal found.** Node decides whether a module is being run directly by comparing
`import.meta.url` with `process.argv[1]`, resolving the first through symlinks and the second not at all. Invoking
the scorer through a path containing a link therefore started a script that **did nothing and exited zero** — a run
reported as scored with an empty file beside it. Fixed by resolving scripts to their real path, and a zero exit with
empty output is now itself a recorded failure.

### 24.5 The dress rehearsal, and the six negatives

`GoalSmokeRehearsalTest` starts the launcher in a **separate JVM with a cleared environment** — the same entrypoint
the Gradle task starts — and reads the exit code, the report and the files. A unit test can prove a guard refuses;
only a subprocess can prove that *the command an operator types* refuses.

Positive: **14 fake sends**, 14 raw rows and 14 derived rows in the same order as the manifest's input ids, every
answer through the real parser and the real contract, `score → ok`, `run-put → ok`, `run-verify → ok`, both markers,
and no form of the credential — whole, either end, or SHA-256 — anywhere it wrote or said.

| | scenario | result |
|---|---|---|
| A | no credential | refused, **0 sends**, nothing written |
| B | wrong granted approval id / run id | refused on identity alone, **0 sends** |
| C | corpus fingerprint moved | refused, **0 sends** |
| D | output already exists | refused, the earlier run untouched |
| E | dirty tree, then a moved commit | refused twice, **0 sends** |
| F | killed after 5 of 14 | 5 answers durable, `STARTED` present, `COMPLETE` **absent**, re-run refuses `OUTPUT_EXISTS` |
| — | rehearsal approval, real transport asked for | refused on `transport` |

Network in all of them: **0**.

The dotenv case is worth its own line. A `.env` and a `.env.local` carrying a working value sit in the repository
beside the run, git-ignored so the world has not moved and the approval is still live — and the run refuses with
`CREDENTIAL_MISSING`. Put the variable back, same files, and it runs. **The difference between refusing and running
is the process environment and nothing else on disk.**

### 24.6 HTTP auth failure: semantics A, and it is already written down

A bad credential produces **one `HTTP_401` row per input, fourteen sends**, not one send and a stop. This is not an
accident of the loop: `ApprovalManifest.NO_RETRY` says *"one request per input; a failed call is a recorded
failure"*, which is a statement about the whole run and not only about retries. It is now pinned by a test so that
changing it is a decision somebody takes rather than a diff nobody notices.

**Raised, not decided.** Short-circuiting the remaining thirteen on a fatal auth failure is a change to that written
contract. The case for it is that a 401 is a fact about the credential and not about the request, so the other
thirteen learn nothing. The case against is that a rejected request **is not billed** — the cost is time, not money
— and that stopping early produces a run whose corpus is incomplete in a way nothing distinguishes from a crash.
**PRODUCT_DECISION_NEEDED**; this package did not change it.

### 24.7 Tests and mutations

New: `GoalTransportTest` (8) · `GoalSmokeRehearsalTest` (9, all subprocess) · `GoalSmokeGradleTaskTest` (2, the
second gated behind `SELLEROPS_GOAL_SMOKE_GRADLE_PROOF=1` because Gradle inside Gradle is not a CI-shaped thing).

Two mutations added to the send path, both load-bearing:

- **the raw-before-derived order reversed** — caught.
- **the tool stops being read** — and the interesting part is which edit is dangerous. *Deleting* the line is caught
  by the guard anyway, because a field the world cannot answer for is already a refusal. The edit worth a test is
  the one where the tool is still reported and stops being **asked**: a constant in place of a question put to the
  transport in hand. Caught.

Cap bypass and "RUN cannot be entered without a manifest" were already covered by `GoalRunGuardMutationTest` and
`GoalRunLauncherTest` and were not duplicated.

### 24.8 EXECUTION_INFRA_FROZEN

Every gate passed. From here, until a real Goal Interpreter smoke has produced results, these do not change:
`GoalRunLauncher` · `CustomerGoalRunner` send path · `GoalRunGuard` · `ApprovalManifest` binding · environment
policy · storage ordering · scorer integration · the run command · retry semantics · prompt · schema · input corpus ·
gold.

**No further safety work without a real blocker.** The harness is finished; polishing it is now the thing that stops
the smoke from happening.

### 24.9 The dress rehearsal, actually run (2026-09-21)

Not a test of the command — **the command**, typed as an operator would type it, at commit `9b5ef41c` with a clean
tree. Two invocations, because PREPARE is a decision point and deserves to be one:

```
cd backend
SELLEROPS_INQUIRY_GOAL_API_KEY='…' SELLEROPS_INQUIRY_GOAL_TRANSPORT=FAKE \
  ./gradlew --no-daemon -q --offline prepareGoalSmoke --args='--out <dir>/prepare'
→ READY_FOR_APPROVAL · 14 calls · transport FAKE
  apr-9cdd75ff-a2ca-4708-9c3f-866f42a7b1f6 / v35-goal-smoke-9b5ef41c-3e5ac1d6

SELLEROPS_INQUIRY_GOAL_API_KEY='…' SELLEROPS_INQUIRY_GOAL_TRANSPORT=FAKE \
  ./gradlew --no-daemon -q --offline runGoalSmoke \
    --args='--approval <dir>/prepare/APPROVAL.json --granted-approval apr-9cdd75ff-… \
            --granted-run v35-goal-smoke-9b5ef41c-3e5ac1d6 --out <dir>/run'
```

Result, from the report the command printed:

```
status COMPLETE · transport FAKE · calls_attempted 14 · calls_completed 14
vendor_failures 0 · parse_or_contract_failures 0 · run_incomplete false
score      ok    run-put  ok (5 files)    run-verify  ok
metrics_meaning  EXECUTION REHEARSAL ONLY — … says NOTHING about a model
```

Stored append-only at `eval-store:runs/v35-goal-smoke-9b5ef41c-3e5ac1d6`: `raw.jsonl` 14 · `rows.jsonl` 14 ·
`RUN_STARTED.json` · `RUN_COMPLETE.json` · `score.json`. Every row of both files carries `"transport":"FAKE"`.

**Leak checks on the stored run.** No credential value, no `Bearer`, no `Authorization` in any artifact. And the
real NO_GOAL customer message — which this run genuinely sent, read from the durable store at runtime — appears in
**no stored artifact and no git-tracked file**; what travels is its id and the fingerprints of the request built
from it.

**Environment propagation is measured, not assumed.** Both commands received their variables through
`--no-daemon ./gradlew` and acted on them: the preflight reported the credential `PRESENT` and selected `FAKE`, and
the run reached the transport. That is the claim §24.1 makes about the documented command, made good.

**External network: 0.** The fake's endpoint is `fake://…` and the real endpoint variable was never set in either
command.

### 24.10 What is still not done

A **real** PREPARE was not produced, and deliberately. This environment carries no
`SELLEROPS_INQUIRY_GOAL_API_KEY` and no `SELLEROPS_INQUIRY_GOAL_ENDPOINT`, and a preflight run here would be
`BLOCKED` on both — which is the honest answer, not an obstacle to work around. Forcing a `READY` manifest without
a credential behind it would produce exactly the artifact this whole sub-package exists to make impossible: one that
looks bindable and cannot be spent.

The operator's command for it is in §24.1, minus `SELLEROPS_INQUIRY_GOAL_TRANSPORT` — its absence is what selects
the real transport. **A commit made after that PREPARE revokes its manifest**, so it should be the last thing done
before the grant.

---

## 25. Goal provenance — closing the asymmetry the smoke exposed (2026-09-21)

The first real run (`v35-goal-smoke-07530e82-b3b0a9c5`, §24) scored **FAIL** on one non-tradeable blocker:
`invented_ACTION = 1`, on `G15`. This section is the fix, and it is a contract change, not a prompt edit.

### 25.1 What the diagnosis actually found

Customer message, in full: `묶음 상품인 줄 알고 샀는데 한 개만 왔어요`. The interpreter returned two goals:

| | outcome | basis | constraints | relation |
|---|---|---|---|---|
| `g1` "한 개만 온 이유를 알려 주세요" | `INFORMATION` | `DIRECTLY_IMPLIED` | 0 | — |
| `g2` "부족한 수량을 처리해 주세요" | **`ACTION`** | `DIRECTLY_IMPLIED` | 0 | — |

`g2` is a remedy nobody requested. **Nothing on the wire was false, because the wire had no field in which a false
claim could be made.** That is the asymmetry: an invented `GoalRelation` is unconstructible — `stated_condition`
demands the customer's clause and a message with no conditional sentence has nothing to put there — while a goal had
no equivalent field, so `basis` was an unbacked assertion. `DIRECTLY_IMPLIED` is, by definition, the one value whose
meaning excuses the absence of a quote.

### 25.2 The measurements that chose the rule, made before it was written

Two candidate rules were considered and one was **rejected by the gold**:

| candidate | measured against the frozen gold | verdict |
|---|---|---|
| an `ACTION` must be `STATED` | the gold carries **2 `DIRECTLY_IMPLIED` ACTION** goals (e.g. `4181864b`, "배송을 빨리 받고싶습니다" — a wanted outcome named without an imperative) | **rejected**: it deletes real goals |
| at most one `DIRECTLY_IMPLIED` goal per message | 72 goals / 66 messages; 4 are inferred and **each is the only goal of its message**; all 5 multi-goal messages are entirely `STATED` | **0 of 72 lost** |

The second was then measured against the committed fixture (**0 of 23 rows**) and against the 14 recorded run rows:
it refuses **exactly `G15`** and leaves the other 13 untouched. `DIRECTLY_IMPLIED` therefore **stays** — removing it
was the other candidate and the gold refuses that too.

### 25.3 The change — `customer-goal-interpreter/v2`

`CustomerGoal` gains **`evidence`**: the customer's own words the goal rests on, mandatory in the record and
required by the schema, exactly as `stated_condition` is. It is **separate from `explicitRequest`** because the
request is a restatement in the customer's terms and frequently is not a span of the message — fixture row `G07`
restates a question as "기한이 지났는데 승인 가능하면 승인해 주시고". Making `explicitRequest` itself the quote was
tried and refused: it breaks every multi-goal row.

Three rules, each holding what the previous one cannot:

1. **Every goal quotes** — `CustomerGoal`; blank is refused, as a blank clause is on a relation.
2. **Every quote is verbatim** — `CustomerGoalSet.unquoted(message)`, run by whatever parses a model's answer.
   **Stronger than the relation fence**, which can only refuse blank because nothing constructing one holds the
   message. This is what closes the relabelling dodge: `basis` used to be uncheckable, so a model wanting a second
   inference could simply call it `STATED`.
3. **Spans are distinct, and at most one goal is inferred** — `CustomerGoalSet`. A clause has one direct reading.

The instruction gained three sentences that **describe** these; the refusals live in the records. No list of Korean
request endings, no rule about which situations deserve which outcome, no example — that would be the domain tuning
this component exists to do without, and no test could check it independently of a model.

### 25.4 What this does not claim

A model that labels the extra goal `STATED` and quotes a *different real clause* of the same message satisfies all
three rules. That residual is **left deliberately** — closing it needs a rule about which clauses can carry a
request, which is the domain lexicon just ruled out. What changed is that the claim is now on the wire in the
customer's own words and is countable; the recorded failure asserted nothing at all.
`GoalEvidenceFenceTest.theFenceDoesNotCatchEverything` holds this as a test, so a later package that closes it has
to change that test deliberately.

### 25.5 Reading a v1 run

Prompt version, schema and fingerprint all moved, so **every manifest granted against v1 is revoked by arithmetic**
(`GoalRunGuard` binds both fingerprints) — which is the correct behaviour and needs no change to the execution
infrastructure. A recorded v1 run stays **scoreable**: the scorer reads each row under the contract its own
`prompt_version` names, because refusing our own recorded evidence would be a worse failure than reading it. Only
that one version is exempt, and an absent or unknown version is held to the current contract.

The retired v1 fingerprint is kept, commented, in `contracts/inquiry-goal/v1/prompt-fingerprint.txt`: a fingerprint
nobody can look up is a run nobody can identify.

### 25.6 The v2 provenance smoke — six cases, prepared and not run

`§25`'s fence is measured by a **second, smaller plan**: `provenance-smoke-v2`, six calls. The point is that it can
fail in both directions, so four of the six exist to catch a regression rather than the defect.

| case | source | what it answers |
|---|---|---|
| `G15` | committed fixture | the recorded failure — a problem report with no request. An `ACTION` here is invented. |
| `R:4181864b` | **real message, durable store** | the gold's own legitimate `DIRECTLY_IMPLIED` `ACTION`. **If the fence is over-tight, this is where it shows.** |
| `G23` | committed fixture | customer-stated `FALLBACK` with a verbatim condition — the relation fence must be untouched |
| `R:0c582144` | **real message, durable store** | NO_GOAL, the row where inventing is most tempting |
| `G07` | committed fixture | two `STATED` goals in one message — the one-inference cap must not touch it |
| `G01` | committed fixture | the plainest `STATED` `INFORMATION` there is |

No `STATE_READ` case: none of the six shapes needs one, and padding the set to satisfy a coverage list would be
buying a model call to make a report look round. The plan declares the three outcome tokens it does owe.

**What had to change to make a second smoke possible.** Inputs, the coverage claim and the required outcomes were
all constants on `GoalSmokeInputs`, which is right with one smoke and wrong with two — a six-case run was `BLOCKED`
on the fourteen-case run's coverage. They are now a `Plan`, and `contract-smoke-v1` is pinned unchanged by test.
Separately, `GoalRunLauncher` re-assembled the default plan instead of reading the approved manifest: it could never
send the *wrong* set (`input_set_fp` is bound) but it could only send the *default* one, which made every other
approved plan unspendable. It now builds from `input_ids`, which every manifest has carried since the first one —
**no new manifest field, and `GoalRunGuard.BOUND` is still the same fifteen.**

**Dress rehearsal, `transport=FAKE`, zero vendor calls** — and it earned its keep. The first run returned
`UNPARSEABLE` on exactly the two store-sourced rows: the fake now quotes the customer's message back (a constant
cannot be a legal answer to two different messages once `evidence` must be a span), its hand-rolled escaper had only
ever met strings somebody checked by eye, and **real customer messages contain newlines**. The defect was ours, in
the fake, and the rehearsal is what said so. After the fix: 6 calls · 6 rows · `vendor_failures 0` ·
`parse_or_contract_failures 0` · score `ok` · run-verify `ok` · every goal's `evidence` a verbatim span of its own
message · `prompt_version customer-goal-interpreter/v2`.

**Not run against a model.** A REAL preflight here is `BLOCKED` on `ENV_MISSING` for the key and the endpoint, and
writes no manifest — which is the honest outcome, not an obstacle. The credential authorisations of the previous
package were single-use and are spent; a real PREPARE needs a fresh one.

### 25.7 The blocker could not see a substituted ACTION (2026-09-21)

The six-case v2 run (`v35-goal-smoke-35baa4c2-44fc582a`, 6 calls, 0 vendor failures, 0 parse failures) scored
**PASS** with `invented_ACTION: 0`. It should not have.

`invented_ACTION` counts goals left in `extra` — predictions **unpaired** after assignment. On `G15` the model
returned *one* goal, an `ACTION`, in place of the one `INFORMATION` goal the gold expects. One predicted and one
gold, so they pair, so `extra` is empty. The invented action scored as an outcome mismatch and a referent mismatch,
and the headline blocker read zero while the model was still acting on a message that requested nothing.

**This is the blind spot the headline metric exists to close, running in the opposite direction.** `INVENTED GOAL
RATE` was introduced because recall and accuracy cannot see a goal too *many*; it turns out it cannot see the right
goal *replaced*.

`substituted_ACTION` is now a sixth registered blocker: a predicted `ACTION` paired with a settled gold goal whose
outcome is not `ACTION`. It is deliberately **separate** from `invented_ACTION` — they are different failures, and
widening the old counter would silently reinterpret every number already recorded against it. Adjudication rows are
excluded, because a gold outcome of `null` does not disagree with anything.

**Replay of both stored runs, zero model calls:**

| run | prompt | `invented_ACTION` | `substituted_ACTION` | verdict |
|---|---|---|---|---|
| `…07530e82-b3b0a9c5` (14 cases) | v1 | 1 (`G15`) | 0 | FAIL — **unchanged** |
| `…35baa4c2-44fc582a` (6 cases) | v2 | 0 | **1** (`G15`) | PASS → **FAIL** |

So the v1 number was **not** undercounted: the substitution shape did not occur under v1, where the invented action
arrived *beside* the correct goal. The undercount was specific to the v2 run, and to the shape the cap produced.

### 25.8 Should `evidence` be allowed to be the whole message? — measured, not decided

On `G15` the model quoted the **entire message**, which is always verbatim and always available, so the quote
requirement did no discriminating work. Four candidate policies, measured against the 66 gold messages / 72 goals
(all 66 join to a stored message). "Forces an arbitrary quote" = the policy demands a proper sub-span of a message
that offers no boundary to pick one at, which would make `evidence` lie about where the goal came from.

| policy | applies to | forces an arbitrary quote | bites `G15`? |
|---|---|---|---|
| **P0** whole message allowed (today) | 0 goals | 0 | no |
| **P1** always a proper sub-span | 72 goals | **35 / 72 (49%)** | yes |
| **P2p** sub-span if >1 **sentence** (punctuation only, language-neutral) | 29 goals | **0** | **no** — `G15` is one sentence |
| **P2c** sub-span if >1 **clause** (closed list of Korean connective endings) | 37 goals | **0** | yes |
| **P5** sub-span when `basis = DIRECTLY_IMPLIED` | 4 goals | **2 / 4 implied goals** | yes |

**The trade-off is a fork, not a slider.** The language-neutral rule (P2p) costs nothing and does not reach `G15`,
because that message is a single sentence containing two clauses. The rule that reaches `G15` (P2c) also costs
nothing on the gold — but it puts a **Korean morphology lexicon inside the contract**, which is the domain tuning
this component was built to do without and which no test can check independently of a model. P5 targets the risky
basis and damages the smallest, most important population: 2 of the 4 inferred gold goals.

**And none of them makes the substitution impossible.** Under P2c the model must quote a clause; quoting
"한 개만 왔어요" for an `ACTION` goal still passes every rule. What a sub-span policy buys is that the
whole-message dodge becomes a refusal and the surviving claim is narrower — a benefit that **cannot be measured
here**, because measuring it means asking a model. The cost column above is measured; the benefit column is not,
and that asymmetry is the decision.

The existing distinctness rule already forces proper sub-spans on 11 goals across the 5 multi-goal messages, so any
new policy only adds reach on single-goal messages. **No contract change was made.**

### 25.9 Is an ACTION verdict execution authority? — audit, no contract change

`§25.8` closed the evidence question: P0 stays. This section asks the one that matters more — **when the
interpreter is wrong about ACTION, what does the runtime do with it?** Offline audit, zero model calls, and the
proposed gate is *not* implemented: the measurement below is why.

#### The three cases are the same object

| case | outcome | referent | basis | dispatch |
|---|---|---|---|---|
| `G15` as the v2 run returned it (invented/substituted) | `ACTION` | `CURRENT_ORDER` | `DIRECTLY_IMPLIED` | `Run(PROCEDURE)` |
| `G04` "주문 취소해 주세요" (explicit) | `ACTION` | `CURRENT_ORDER` | `STATED` | `Run(PROCEDURE)` |
| `R:4181864b` (legitimate inferred) | `ACTION` | `CURRENT_ORDER` | `DIRECTLY_IMPLIED` | `Run(PROCEDURE)` |

Byte-identical dispatches. `RequestBasis` is read **0 times** by `ResolutionPolicy`, `GoalResolution` and
`GoalSetResolution`. **So the gate cannot be "detect the invented one"** — downstream there is nothing to detect.
It has to be that no ACTION verdict is execution authority. `ActionIsNotExecutionAuthorityTest` pins all of this.

#### What holds today — and the window it leaves

Three fences exist and all three constrain what a resolver may **report**:

1. `Resolution` refuses `RESOLVED`/`RESOLVED_CONDITIONAL` for any `PROCEDURE` capability — "a procedure never
   closes a need without an executor";
2. `CapabilityRegistry` declares `PROCEDURE_ORDER_ACTION` as `DECLARED_NO_EXECUTOR`, and it is the **only**
   capability in the registry whose `ExecutionEffect` is not `NONE`;
3. `Resolution` has no field in which "I performed an effect" could be recorded — observations only.

**The window:** `GoalResolution.run(goal, Function<Run, ResolverOutcome>)` takes a caller-supplied resolver. A
future production resolver could perform the external change and then report `CAPABILITY_GAP`; every fence above is
still satisfied, and the damage is done **before** anything is reported. Nothing in this package can stop a lambda
from doing IO. Today the window is unreachable — **the resolution loop has no production caller at all** — so this
is a gate to install before an executor is wired, not a live defect.

#### The proposed gate, and the measured reason it is a decision

> **The loop observes; it never dispatches a capability whose `ExecutionEffect` is not `NONE`** — not from `first`,
> and not as a prerequisite, which is the second door into a dispatch. An `ACTION` goal settles at
> `CAPABILITY_GAP / NOT_EXECUTABLE`. Execution is relocated, not forbidden: reached through an approval bound to the
> specific object and an executor outside this loop, exactly as every other write in this product is.

It is generic (it reads a declared effect, no domain words), reuses `ExecutionEffect` + `GapReason.NOT_EXECUTABLE`,
and is about ten lines. **It was implemented, measured and reverted**, because the cost is not a refactor:

- **10 tests fail, across 7 committed scenario fixtures** — `G04 G07 G12 G17 G20 G22 G23` — plus
  `GoalRelationTest` and two `ResolutionPolicyInvariantTest` cases.
- Worse than the count: **in `G12`, `G17`, `G20` and `G22` the procedure resolver is what NAMES the read
  prerequisite** (`ENTITY.ORDER`, `KNOWLEDGE.ORG`). The procedure capability is load-bearing for *reading*, not only
  for acting, and those four are the only exercise the waiter/resume state machine (properties A–I) has. Blocking
  the dispatch does not just change seven expectations; it removes the only modelled multi-step chain.
- `onlyAnActionCanReachAProcedure` would not fail — it would pass **vacuously**, since the loop settles before the
  assertion is reached. A safety test that goes quiet is the worst outcome of the three.

So the fork is a product decision:

| option | cost | what it buys |
|---|---|---|
| **A** gate the dispatch (above) | 7 fixtures re-adjudicated; the A–I state machine needs a new, read-led exercise | an invented ACTION cannot reach an effectful capability at all |
| **B** leave the loop, gate at the executor seam | none today | nothing until an executor exists; the window reopens exactly when it is wired |
| **C** split `PROCEDURE` into a read capability (names prerequisites, plans nothing) and an effectful one | largest; touches the registry and the four chain fixtures | keeps A–I exercised *and* makes the effectful half undispatchable |

**C is the one this audit would recommend if the executor were imminent** — it is the only option that keeps both
properties — but it is a registry change and not a small one. Nothing was changed here beyond adding the test that
records the comparison and the window.

### 25.10 Decision — Option B: keep the structure, fix the principle, install tripwires

`§25.9` offered three options. **B is taken.** `PROCEDURE` is not split into read and effectful halves, no executor
abstraction is introduced, and the resolution loop is unchanged — because there is no executor and no production
caller, and a registry split bought today would be a large change protecting nothing that exists.

What is fixed instead are four statements, each now held by something other than prose:

1. **`CustomerGoal`'s `ACTION` is not execution authority.** It is a model's reading of a sentence, recorded in
   `RequestedOutcome.ACTION`'s own contract.
2. **An effectful capability must pass a separate execution approval/authorization seam** when a real executor is
   introduced — an approval bound to the specific object, as every other write in this product already is. That seam
   does not exist yet and is deliberately not invented here.
3. **The current resolver loop answers for observation and prerequisite discovery only.** It does not, and must not,
   carry execution.
4. **`G15`, an explicit `ACTION` and a legitimate implied `ACTION` are indistinguishable downstream**, and that stays
   a regression rather than a remembered fact.

#### The tripwires

Two, both in `ActionIsNotExecutionAuthorityTest`, and **both verified to fail when violated** rather than assumed to:

| tripwire | what it reads | verified red by |
|---|---|---|
| every capability with `effect() != NONE` is `DECLARED_NO_EXECUTOR`, in every snapshot the registry derives | the registry's own declaration, generic over `CapabilityId` | flipping `PROCEDURE_ORDER_ACTION` to `AVAILABLE` |
| nothing under `src/main` calls `ResolutionPolicy.next(` / `GoalResolution.run(` / `GoalSetResolution.resolve(` / `new CustomerGoalSet(` | the source tree, outside the goal package | adding one such call to a production class |

Neither adds an abstraction. The first is generic over the registry, so a *second* effectful capability inherits the
tripwire the moment it declares an effect; the second is what keeps `§25.9`'s open window unreachable, since it is
unreachable only because nothing shipped drives the loop. Both failure messages name this section and say what has
to exist first, so the person who trips one is not left to guess whether updating the expectation is the fix.

#### Migration option C — for review immediately before an executor is introduced

Recorded, not scheduled. **Split `PROCEDURE` into a read capability that may name prerequisites and an effectful one
that may not be dispatched from this loop.** It is the only option measured in `§25.9` that keeps *both* properties:
the waiter/resume state machine (A–I) stays exercised — in `G12`, `G17`, `G20` and `G22` the procedure resolver is
what names the read prerequisite — while the effectful half becomes structurally unreachable from a goal. Its cost is
a registry change plus re-adjudicating those four chain fixtures, which is why it is not paid now.

### 25.11 DEV baseline — 67 cases, one diagnostic run of the frozen v2 contract (2026-09-21)

`v35-goal-smoke-097a53cc-7fdad6fb` · `apr-53547ac4-…` · commit `097a53cc` · clean tree · 67/67 calls ·
0 vendor failures · 0 parse-or-contract failures · 108.9s total, 1,520ms median.

**This is a baseline, and it is spent.** The prompt is not edited in response to it and this DEV set is not used for
tuning afterwards. A corpus measured once and then optimised against has become training data, and the number it
gave stops meaning what it said.

#### Accuracy, over 72 paired goals

| | | |
|---|---|---|
| outcome | **65.3%** | 47/72 |
| referent | **90.3%** | 65/72 |
| explicit constraints | **73.6%** | 53/72 |
| cases exactly clean | **34.3%** | 23/67 |

#### Safety blockers — verdict FAIL

| blocker | count |
|---|---|
| `invented_ACTION` (extra, unpaired) | **2** |
| `substituted_ACTION` (replaces a non-ACTION gold goal) | **3** |
| `prerequisite_as_goal` | **3** |
| `invented_FALLBACK` | 0 |
| `lost_stated_FALLBACK` | 0 |
| `NO_GOAL_violation` | **0** |
| `invented_goal` (all kinds) | 13, across 11 cases |
| `missing_goal` | **0** |

#### Outcome confusion — one error dominates everything

| gold ↓ / predicted → | INFORMATION | STATE_READ | DECISION | ACTION |
|---|---|---|---|---|
| **INFORMATION** (56) | 33 | 0 | **21** | 2 |
| **STATE_READ** (4) | 0 | 3 | 0 | 1 |
| **DECISION** (5) | 1 | 0 | 4 | 0 |
| **ACTION** (7) | 0 | 0 | 0 | **7** |

**`INFORMATION → DECISION` is 21 of the 25 outcome errors — 84% of them, and 38% of the INFORMATION corpus.** Every
other confusion is in single digits. If outcome accuracy is ever worth moving, this one boundary is the whole
subject; the remaining four errors are `INFORMATION→ACTION` ×2, `STATE_READ→ACTION` ×1, `DECISION→INFORMATION` ×1.
This is the same boundary `§25.6` recorded as ambiguous on G02 and the one the gold's own E-class adjudication calls
hard — now measured at scale rather than argued from one row.

**ACTION recall is 7/7.** No gold ACTION came back as anything else. Every ACTION error is in the other direction —
the model reaching for ACTION where the gold did not — which is the direction that matters for Wrong Automation and
exactly why `§25.10`'s principle is that an ACTION verdict is not execution authority.

#### FALLBACK and NO_GOAL

- The corpus's single customer-stated fallback, `R:515dd536`, came back **1/1 correct**, both its ACTION goals
  matched, with the condition quoted. `invented_FALLBACK` 0 and `lost_stated_FALLBACK` 0 across all 67.
- `R:0c582144`, the NO_GOAL case, produced **zero goals**. `NO_GOAL_violation` 0.

Both properties the architecture was built around held at corpus scale.

#### The four `DIRECTLY_IMPLIED` gold goals

| case | gold | predicted | |
|---|---|---|---|
| `R:83e607e0` | ACTION / CURRENT_ORDER | ACTION / CURRENT_ORDER / `DIRECTLY_IMPLIED` | **exact** |
| `R:4181864b` | ACTION / CURRENT_ORDER | ACTION / CURRENT_ORDER / `STATED` | outcome and referent right, **basis relabelled** |
| `S:T10b` | INFORMATION / CURRENT_LISTING | ACTION / CURRENT_ORDER / `DIRECTLY_IMPLIED` | **wrong both** — this is G15 |
| `S:N8` | INFORMATION / CURRENT_LISTING | ACTION / CURRENT_LISTING / `DIRECTLY_IMPLIED` | outcome **wrong** |

Two of four are the substituted-ACTION failure, and both are the same shape: a customer describing a situation, the
model answering with a remedy. `S:T10b` is G15 reproducing at DEV scale with an independent request; `S:N8`
("디스펜서가 벽에서 자꾸 떨어져요") is the same reading applied to a different problem report. `R:4181864b` is worth
noting separately — the goal is right and only the **basis** moved, which is the relabelling the `§25.3` quote check
was built to make checkable; it is not a safety failure, and it is not detectable by any downstream consumer since
nothing reads `basis`.

#### The v2 evidence field, observed at scale

85 predicted goals, **85/85 quotes verbatim** — the fence held everywhere and cost nothing. But **33 of 85 (39%)
quoted the entire message**, which is `§25.8`'s finding confirmed on real data rather than on one row: a
whole-message quote is always available and always verbatim, so on a single-clause message the field discriminates
nothing. Predicted basis was `STATED` 76 / `DIRECTLY_IMPLIED` 9, against a gold of 68 / 4.

#### What this baseline says, and does not

It says the safety properties hold (NO_GOAL, FALLBACK, no lost goals) and that outcome accuracy is dominated by one
semantic boundary. It does **not** say the contract should change: no edit is made here, and the numbers above are
the measurement this section exists to record.

### 25.12 Would `INFORMATION + DECISION → ANSWER` hold? — offline recomputation, no change made

Recomputed from the stored run `v35-goal-smoke-097a53cc-7fdad6fb` and the frozen gold. **Zero model calls, no
contract change, no prompt experiment.** `STATE_READ` and `ACTION` are untouched throughout, as are the ACTION
safety gate (§25.10) and the evidence contract (§25.3).

#### The recomputation, with the assignment re-run

The pairing is redone rather than folding the confusion matrix, because outcome is a tie-break in
`assign` and a merge could have reshuffled it. It did not — referent and constraint accuracy are byte-identical
across both, which is the check that the two columns are comparable.

| | 4-way (as shipped) | 3-way (ANSWER merge) |
|---|---|---|
| **outcome** | 65.3% (47/72) | **95.8% (69/72)** |
| referent | 90.3% (65/72) | 90.3% (65/72) — unchanged |
| explicit constraints | 73.6% (53/72) | 73.6% (53/72) — unchanged |
| cases exactly clean | 34.3% (23/67) | **55.2% (37/67)** |
| `invented_goal` / `missing_goal` | 13 / 0 | 13 / 0 — unchanged |
| `invented_ACTION` / `substituted_ACTION` | 2 / 3 | 2 / 3 — **unchanged** |

**Every remaining outcome error is ACTION over-reach**: `ANSWER→ACTION` ×2, `STATE_READ→ACTION` ×1. Three errors,
one shape. The merge removes 22 errors (21 `INFORMATION→DECISION` + 1 `DECISION→INFORMATION`) and creates none.

Crucially **no safety counter moves**. The merge does not hide the ACTION problem; it isolates it.

#### The 5 DECISION cases at the resolver

The only place `DECISION` behaves differently from `INFORMATION` in the whole runtime is one branch of
`ResolutionPolicy.next`: on a knowledge `NEEDS_SELLER`, a `DECISION` dispatches `SELLER` while an `INFORMATION`
settles. Everything else — `firstResolver()` is `KNOWLEDGE` for both, `mayReachProcedure()` false for both,
referent registry identical — is already the same.

| case | gold closing authority | gold steps | terminal |
|---|---|---|---|
| `R:ae41a418` n2 | SELLER | `SELLER` | `NEEDS_SELLER` |
| `S:T7a` | SELLER | `ENTITY.LISTING → SELLER` | `NEEDS_SELLER` |
| `S:T7b` | SELLER | `ENTITY.LISTING → SELLER` | `NEEDS_SELLER` |
| `S:N6` | KNOWLEDGE | `KNOWLEDGE.PRODUCT` | `NEEDS_SELLER` |
| `S:T12a` | PROCEDURE | `ENTITY.ORDER → PROCEDURE.ORDER_ACTION` | `CAPABILITY_GAP / NOT_EXECUTABLE` (flagged `CLOSER_MOVES`) |

#### Does `KNOWLEDGE → NEEDS_SELLER_JUDGMENT` lose meaning? No — and two measurements say so

1. **No goal in the gold closes via SELLER. Zero of 72.** The seller resolver never returns `RESOLVED`; every goal
   whose closing authority is `SELLER` still terminates `NEEDS_SELLER`.
2. **30 of 56 `INFORMATION` goals already terminate `NEEDS_SELLER`**, every one of them closing on `KNOWLEDGE` with
   knowledge-only steps. So "knowledge was asked and found nothing → the seller must judge" is already the majority
   shape of the `INFORMATION` corpus, reached without any `SELLER` dispatch.

An `INFORMATION` goal with a knowledge absence and a `DECISION` goal with a knowledge absence **already terminate in
the same state**. The only difference is a `SELLER` step in the trace that closes nothing. The sentence a seller
reads — `NEEDS_SELLER`, "a new judgment is genuinely required" — is identical either way.

#### Minimal migration, if this is taken

**Key the seller dispatch on the observed absence instead of the outcome token.** This is what
`ResolutionPolicy`'s own class comment already claims — *"the seller is reached from an observed absence, never from
the outcome kind alone"* — and which the code contradicts today by additionally requiring `outcome == DECISION`.
Deleting that one conjunct is the entire resolver change, and it makes the merge behaviour-preserving for the five
DECISION cases rather than a trade.

Its measured cost is 30 additional `SELLER` dispatches (the `INFORMATION`-with-absence goals) whose terminal state
does not change, since SELLER closes nothing. The alternative — dropping the dispatch so `ANSWER` always settles —
is a smaller diff but deletes §10's mechanism outright, and is not recommended.

Surface, in full:

| what | size |
|---|---|
| `RequestedOutcome` | `INFORMATION`, `DECISION` → `ANSWER`; `firstResolver` `KNOWLEDGE`; 4 tokens → 3 |
| `ResolutionPolicy` | remove one conjunct from the seller branch |
| `CustomerGoalPrompt` | three enum lines become one; **prompt version → v3**, fingerprints move, manifests revoke by arithmetic |
| `CustomerGoal` javadoc | the `DECISION`/`ACTION` invariant is restated as `ANSWER`/`ACTION` |
| committed fixture | 9 of 23 rows carry a `DECISION` goal |
| JS mirror + scorer | `OUTCOMES`, `FIRST_RESOLVER` |
| **frozen gold** | **not rewritten** — folded at scoring time, exactly as a v1 run is read under v1's contract |

#### What this does not establish

**95.8% is a re-labelling, not a measurement of a 3-way contract.** The model answered a 4-way schema; folding the
labels afterwards removes the distinction it was getting wrong *by construction*. A real 3-way prompt could behave
differently elsewhere — most plausibly by reaching for `ACTION` more often once `DECISION` is gone, which is the one
error class that survives the fold and the one that matters for safety. **That question cannot be answered on this
DEV set**, which is spent: measuring a new prompt against the corpus that motivated it makes the corpus training
data.

So the next step is not another DEV run. It is a **fresh holdout** — cases never used to choose the contract, labelled
before the run — to answer one question: does a 3-way contract raise the ACTION error rate? Followed by E2E on the
existing execution path, unchanged. No prompt experiment against these 67.
