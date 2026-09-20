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
