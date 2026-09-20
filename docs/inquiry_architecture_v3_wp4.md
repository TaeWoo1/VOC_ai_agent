# Inquiry Architecture v3 — WP-4: Planner Final Validation & Freeze Gate

> **Status: smoke PASSED · 67×1 shadow RUN · freeze gate FAILED · planner NOT frozen.**
> 70 planner model calls total (3 + 67), both approved and capped. Marketplace 0 · DB writes 0 ·
> external writes 0 · migrations 0. Production is still v3 OFF.
> **The Resolution Planner is not frozen, and WP-4 E2E is not proposed.** The gate found a contract
> defect that the smoke could not see: §6.

This package does not try to make the planner better. It asks one question — *do the authority semantics
WP-2 measured survive the WP-3 contract?* — and, if the answer is yes, freezes the Resolution Planner
architecture so WP-4 E2E can start against something that stops moving.

Predecessors: [WP-1/2](inquiry_architecture_v3_wp2.md) · [WP-3](inquiry_architecture_v3_wp3.md).

---

## 1. Immutable baseline

Everything below was derived at `66384bb5` in the `decision-workspace` worktree, with **zero model calls**.

### 1.1 How the request fingerprints were obtained without calling anything

`ResolutionPlannerRunner` records five fingerprints on every row — system, vendor schema, input (the user
turn), request (the whole body) and the registry snapshot — and it records them *before* it knows whether a
call happened. So running the harness in `PLAN_MODE=oracle` against an **empty gold file** builds the exact
request the model door would send, fingerprints it, and lands on `failure: NO_ORACLE_PLAN` having reached no
transport at all. That is the whole measurement: no new code, no new tool, and the fingerprints are the same
bytes the live run will report.

### 1.2 Pinned values

| what | value |
|---|---|
| commit | `66384bb5` (`feat/review-decision-workspace-v1`) |
| prompt | `resolution-planner/v3` |
| model · effort · format | `gpt-5-2025-08-07` · `minimal` · strict `json_schema` |
| **system prompt** | `938af14fc8a37948152be9f93db71a2a640866a2bdf3718d5941c38a1633c82b` |
| **vendor schema** | `c0419e7144c715030c0aafa00b99dc0f7c9736c4392e9ec8481ef64eb0ed51ac` |
| capability vocabulary | `63fad3167936846517e0c3e5fbfadc10aca7710e3e8d698a1f6afe7049a911f7` |
| planner scenarios v2 | `e60cb3ea648b990a2919c115c9d6ded79723c633f3ccb35f24eb66a5fb5a79fb` |
| gold `inquiry-resolution-plan/v3.2` | `ff20922e3f05307e6ca6cbfe8aa94737029a93e453e6a8398a6a4476f4ed0bb9` — 67 cases, 72 goals, `verify → ok` |
| WP-2 shadow `70786fe4` | `runs/wp2-shadow`, `run-verify → ok` |
| WP-2 smoke | `runs/wp2-smoke-2`, `run-verify → ok` |
| WP-3 derived replay | `runs/wp3-offline`, `run-verify → ok` |
| this baseline | `runs/wp4-baseline`, `run-verify → ok` (append-only, new run id) |

**The vendor schema hash is snapshot-independent.** P01 (Cafe24, order-bound, exact lookup) and P07 (NAVER
public Q&A, stored-only, 5 variants) have different `registry_fp` and the *same* `schema_fp`: the `anyOf`
branch set is generated from the capability declarations, not from what this situation can do. What the
situation can do stays where it was — in the user turn and in `StepAvailability`.

### 1.3 The comparison is controlled

The smoke inputs regenerate byte-identical to the ones the WP-2 smoke consumed
(`57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f`), and against that recorded run:

| fingerprint | WP-2 (`resolution-planner/v2`) → WP-4 baseline (`v3`) |
|---|---|
| `input_fp` (all three) | **SAME** |
| `registry_fp` (all three) | **SAME** |
| `system_fp` | changed |
| `schema_fp` | changed |
| `request_fp` (all three) | changed |

WP-3 claimed `ResolutionPlannerPrompt.user()` was left byte-identical so the payload floor would not move.
That claim is now checked against a recorded run rather than asserted: **the question and the registry facts
are the same bytes; only the instruction and the schema moved.** Any difference the smoke finds is
attributable to the contract, not to what the model was asked about.

### 1.4 One correctness fix, found while pinning

`tools/inquiry-need-eval/smoke-inputs.mjs` was still reading
`contracts/inquiry-planner/**v1**/synthetic/planner-scenarios.jsonl` — the file WP-3 retired — while the
harness integrity test had moved to v2. It produced the right rows today only because the three `smoke: true`
rows happen to be identical in both files, so the defect was latent: the next edit to a smoke scenario would
have been silently ignored by the generator that feeds the live run. Pointed at v2; output verified
byte-identical, so the pinned input hash above is unaffected.

---

## 2. §5 re-verification — effect is out of planner evaluation

The brief asks for this boundary to be re-checked in the docs *and* in the tests before the gate runs. It
holds in four independent places:

| where | what is pinned |
|---|---|
| wire | `ResolutionPlanParser` returns `PLAN_SHAPE` for any step carrying `effect` or `depends_on` (`ResolutionPlannerContractTest.parser`) |
| vendor schema | no `anyOf` branch declares `effect` — asserted per capability (`shapePerCapability`) |
| instruction | `system` contains no `effect=`, no `BOUNDED_WORKFLOW`, no `EXTERNAL_STATE_CHANGE`, no `depends_on` |
| registry | every capability's `effect` agrees between `CapabilityId.effect()` and the vocabulary file; `BOUNDED_WORKFLOW` producers = 0 (`AuthorityVocabularyContractTest.effectIsTheRegistrys`) |

And in the scorer that WP-4 will use: **`tools/inquiry-need-eval/goals.mjs` contains the word `effect`
zero times.** There is no effect term to remove from the metric, because the split-tolerant scorer never had
one. `contract.mjs` mentions effect only to *refuse* it on the wire and to count it when projecting WP-2
shapes forward; `plan.mjs` still validates effect because it is the frozen WP-2 baseline scorer reading v3.1
gold, and it is not used to score this gate.

Green at baseline: backend `inquiry.authority` + `inquiry.resolution` + harness integrity — pass;
`tools/inquiry-need-eval` — 62 tests, 0 failures (eval 9, goals 21, judge 12, mutations 12, plan 8).

---

## 3. Approval manifest — smoke, 3 planner calls  *(approved in-turn, consumed)*

```
APPROVAL MANIFEST — Inquiry v3 planner smoke under resolution-planner/v3
  purpose           does the vendor accept the per-capability anyOf schema, and do the three
                    authority decisions WP-2 measured survive the WP-3 contract
  scope             3 planner calls, synthetic fixtures only
  inputs            P01 · P03 · P07 from contracts/inquiry-planner/v2/synthetic/planner-scenarios.jsonl
                    (smoke: true), regenerated to a path outside the repository
  inputs sha256     57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f  (pinned;
                    PLAN_INPUTS_SHA256 makes the harness refuse a moved capture)
  commit            0af96549   (execution pin; the baseline in §1 was derived at 66384bb5 and
                    all five fingerprints were re-derived unchanged at 0af96549)
  prompt            resolution-planner/v3   system_fp 938af14f…  schema_fp c0419e71…
  model             gpt-5-2025-08-07
  reasoning_effort  minimal
  output format     strict json_schema
  mode              PLAN_MODE=model, PLAN_REPEATS=1, PLAN_MAX_CALLS=3   (hard cap; the harness
                    throws on the 4th send and refuses model mode without the key and the cap)
  marketplace calls 0
  DB writes         0
  external writes   0
  production Cases  0
  real customer text 0        (every question is a committed synthetic fixture)
  judge / draft     0 calls
  retrieval         0
  output            eval-store:runs/wp3-smoke/ — new run id, append-only; raw answers stored and
                    marked irreproducible BEFORE anything is scored
  expected spend    ≈3k input / ≈0.5k output tokens
  revoked by        any code, branch, model, prompt, schema or input change
```

Run command:

```bash
# 1. inputs, generated from the committed fixture into a path outside the repository
node tools/inquiry-need-eval/smoke-inputs.mjs > "$WORK/smoke-inputs.jsonl"

# 2. three calls, capped, with the capture pinned
RUN_RESOLUTION_PLANNER_CAL=true PLAN_MODE=model PLAN_MAX_CALLS=3 PLAN_REPEATS=1 PLAN_RUN_ID=wp3-smoke \
PLAN_INPUTS="$WORK/smoke-inputs.jsonl" PLAN_OUT="$WORK/wp3-smoke.jsonl" \
PLAN_INPUTS_SHA256=57f49beb5f4b519eacb90db5707a169573ba280e7d78ffa258537f7a1e2b7c8f \
SELLEROPS_INQUIRY_DECISION_API_KEY=… ./gradlew test --tests '*ResolutionPlannerCalibrationIT'

# 3. raw answers into the store BEFORE they are scored
node tools/eval-store/store.mjs run-put wp3-smoke "$WORK" --irreproducible --note "planner smoke, resolution-planner/v3, apr-…"
```

### 3.1 Pass bar, registered before the run

Taken from the fixture's own plans, not decided afterwards:

| | P01 — read-only order status | P03 — address change | P07 — variant-dependent fact |
|---|---|---|---|
| registry | Cafe24, order-bound, `EXACT_ALLOWED` | Cafe24, order-bound, `EXACT_ALLOWED` | NAVER public Q&A, `STORED_ONLY`, 5 variants |
| closing authority | `ENTITY.ORDER` | `PROCEDURE.ORDER_ACTION` | `KNOWLEDGE.PRODUCT` |
| preceding step | — | `ENTITY.ORDER` as `PRECONDITION` | — |
| must **not** contain | any `PROCEDURE` step | — | a `SELLER` closer |
| customer inputs | none | none | `OPTION` (the answer varies by variant) |
| availability recorded | `null` | `null`, then `NOT_EXECUTABLE` | `null` |

Pass = all of: **3/3 answered · 0 envelope failures · 0 parse failures · 0 contract violations ·
3/3 authority sets equal to the row above · 0 forbidden identity inputs.**

On the last one, a precision worth stating now rather than claiming later: identity inputs
(`ORDER_NUMBER`/`PHONE`/`ADDRESS`/`EMAIL`/`NAME`) are **not members of the schema's `customer_inputs`
enum at all** — `ResolutionPlannerPrompt.askableInputs` admits only `PRODUCT_CONTEXT` values. So a zero here
is a structural property of the request under strict mode, and the run's job is to confirm the vendor honours
the enum, not to discover whether the model behaves. `ResolutionPlanValidator.IDENTITY_INPUT` still exists
behind it, because the domain refuses identity independently of whatever the schema happens to allow.

`NOT_EXECUTABLE` on P03's procedure is the expected answer and not a failure: there is no procedure executor
in v3.0, the plan says what the need *requires*, and the validator records the gap without the plan adjusting
itself around it.

### 3.2 If the smoke fails

No 67-case manifest is presented, and no second model call is made without a new approval. The failure is
reported classified as exactly one of: **contract** (the shape the parser or validator refused) ·
**schema** (the vendor rejected or mis-filled the `anyOf`) · **prompt** (the instruction no longer says
something the model needs) · **semantic** (the authority choice itself changed). Only the first two are
candidates for touching the planner architecture.

---

## 4. Smoke result — `wp3-smoke`, commit `0af96549` (consumed)

3 calls / cap 3. Raw answers stored before anything was scored: `eval-store:runs/wp3-smoke/`, marked
irreproducible, `run-verify → ok`. 4,396 input / 227 output tokens, **0 reasoning tokens**, 2.1–2.9 s each.

### 4.1 The registered bar

| | P01 order status | P03 address change | P07 variant fact |
|---|---|---|---|
| answered · envelope · parse | yes · ok · ok | yes · ok · ok | yes · ok · ok |
| contract violations | **0** | **0** | **0** |
| closing authority | `ENTITY.ORDER` ✔ | `PROCEDURE.ORDER_ACTION` ✔ | `KNOWLEDGE.PRODUCT` ✔ |
| preceding step | — ✔ (no procedure) | `ENTITY.ORDER` PRECONDITION ✔ | — ✔ (no seller closer) |
| forbidden identity inputs | 0 ✔ | 0 ✔ | 0 ✔ |

**PASS on all six registered conditions.** The vendor accepts the per-capability `anyOf` schema, fills it
in strict mode with `finish=stop`, and the three authority decisions WP-2 measured survive the WP-3 contract
unchanged. The v2→v3 shape rewrite cost nothing in authority semantics on these three.

### 4.2 What the plans show that the bar did not name

Two things, both reported rather than quietly passed.

**(a) P01's answerable order question became a capability gap — and the smoke proves the cause by itself.**
The model closed P01 with `ENTITY.ORDER` reading `["ORDER_FULFILLMENT", "ORDER_TRACKING"]`. The gold asks
for `ORDER_FULFILLMENT` alone. `ORDER_TRACKING` is not supported on this channel, and
`ResolutionPlanValidator.gapOf` ends with an **all-or-nothing clause** — *if any named field is unavailable,
the whole step is `NOT_SUPPORTED`* — so P01's availability came back `NOT_SUPPORTED` where the fixture
expects `null`.

The proof needs no extra run: **P01 and P03 have the same `registry_fp` (`df43f26e…`)** — same channel, same
snapshot, same capability, same order binding. P03's `ENTITY.ORDER` step names only `ORDER_FULFILLMENT` and
its gap is `null`. The single difference between a readable step and an unreadable one is the extra field.

This is exactly the mechanism WP-3 named and measured (`ORDER_TRACKING` added 42 times in 201 calls where
the gold did not ask) and then recorded as *"mechanism real, **zero** resolvable goals flipped in this set,
kept as a mechanism to watch."* **In this smoke it flipped one** — and it flipped the most basic read-only
order question there is. The mechanism is no longer hypothetical.

Two things compound here and they are not the same defect:

* the planner **over-reads** — it names a field the need does not require;
* the availability contract **cannot express partial readability** — `StepAvailability` already carries
  `unavailableFields`, which holds the precise truth (`[ORDER_TRACKING]`), but `gapOf` collapses it to a
  single verdict about the whole step, and `ResolutionPlannerRunner.row` does not even serialise
  `unavailableFields`, so a reader of a recorded row cannot tell a fully-blocked step from an over-read one.

Consequence if it generalises: an answerable question is reported as a gap, which in WP-4 E2E terms is a
**handoff that did not need to happen** — safe, but wasteful, and it would inflate the "unresolved required
goal" figure that freeze-gate item 5 is about.

**It is deliberately not fixed before the shadow.** Fixing a contract on n=1 is the trap this programme
keeps avoiding, and the frequency is the thing worth knowing. It costs nothing to defer, because the
correction can be applied afterwards **without calling the model again**: `PLAN_MODE=replay` re-reads the
recorded raw answers with the *current* parser and validator and refuses any row whose rebuilt user turn does
not hash to the recorded `input_fp`. So the 67 raw answers can be re-scored under a revised availability rule
for free, and provably about the same requests.

**(b) P07 asked four customer inputs; the gold asks one.** The model asked
`SIZE, MODEL, MEASUREMENT, USE_CONTEXT`; gold v3.2 says `OPTION`. So on this row required-input *token*
recall is 0/1 and the over-ask is 4 — the same shape WP-3 measured across 201 calls (required recall 1–2 of
5, unnecessary 87–98). Per the brief this is a **product UX issue for the tuning backlog, not a safety
blocker**, and the planner prompt is not being tuned here. One honest qualification: the asked set is not
empty and `SIZE`/`MODEL`/`MEASUREMENT` plausibly discriminate the same five variants that `OPTION` names, so
part of this figure may be a gold-token choice rather than a planner error — a category-C (scorer/gold)
candidate that the 67-case run is the right instrument to size.

---

## 5. Final planner shadow — `wp4-shadow`, 67 × 1 (consumed)

Approved in-turn, pinned to `0af96549`, **executed at `6cb71f47`**: the delta between them is one markdown
file, and before running, all five request fingerprints were re-derived at HEAD and compared — **15/15
identical** — so the bytes sent are the approved bytes by construction. 67 calls / cap 70. Inputs: the
frozen WP-2 capture (`5850421b…`), read in place so no second copy of customer text was made. Raw stored
before scoring: `runs/wp4-shadow`, irreproducible, `run-verify → ok`. 99,202 in / 14,534 out, mean 3.0 s.

Scored with the split-tolerant scorer against frozen gold v3.2. The comparison column is **WP-2 rep 1
projected into v3 shapes and scored with the same scorer** (`runs/wp3-offline`) — the only like-for-like
baseline that exists.

### 5.1 Before / after

| | WP-2 rep 1 (v2, projected) | WP-4 (v3, actual) | |
|---|---|---|---|
| goal coverage | 72/72 · **1.000** | 63/72 · **0.875** | ▼ |
| required authority recall | **1.000** | **0.875** | ▼ |
| **wrong authority substitution** | **0** | **5** | ▼ |
| uncovered goals | 0 | 9 (4 no plan + 5 wrong authority) | ▼ |
| ORDER required-authority miss | 0 | **0** | = |
| forbidden identity input | 0 | **0** | = |
| `procedure_for_read` | 3 | **1** | ▲ |
| unnecessary authority goals | 22 | **9** | ▲ |
| needs with >1 closing authority | **23** | **0** | ▲ |
| needs where SELLER closes | 21 | **9** | ▲ |
| goals split | 26 | 22 | ≈ |
| planner-only extra needs | 7 | 4 | ▲ |
| entity exact / over-read | 6 / 8 | 2 / 7 | ▼ |
| inputs exact / over / under | 28 / 44 / 4 | 25 / 43 / 3 | ≈ |
| required input recall | 1 of 5 | 2 of 5 | ▲ |
| unnecessary inputs | 98 | 88 | ▲ |
| invalid rows | 8/67 (11.9%) | **8/67 (11.9%)** | = |
| envelope failures | **0** | **4 (TRUNCATED)** | ▼ |
| violations | 13, all shape-class | 5, all relational | ▲ |

**WP-3's structural claims are confirmed.** Every violation class the new shapes were built to make
inexpressible is gone: `FIELDS_ON_NON_ENTITY` 15→0, `FIELD_OF_OTHER_CAPABILITY` 15→0, `SCOPE_MISMATCH`
4→0, `BAD_DEPENDENCY` 1→0. What remains is relational and no schema could have prevented it:
`NO_CLOSING_STEP` 2, `PRECONDITION_AFTER_CLOSER` 1, `PROCEDURE_WITHOUT_ORDER_PRECONDITION` 1,
`DUPLICATE_STEP` 1, over 4 rows. Multi-closer needs went **23 → 0**: the new rule is obeyed without
exception.

**And the invalid rate did not move.** 11.9% before, 11.9% after — the composition changed completely and
the total did not, because two new failure modes arrived to replace the ones that were removed.

### 5.2 The finding: the contract chose the closer by position

Three cases (`R:8989a9d0`, `S:T1a`, `S:T1b`) close a gold-KNOWLEDGE goal with `SELLER`. The before/after is
the whole story:

```
R:8989a9d0   WP-2:  KNOWLEDGE.CATALOGUE(CLOSES) + SELLER(CLOSES)
             WP-4:  KNOWLEDGE.CATALOGUE(PRECONDITION) + SELLER(CLOSES)
```

The model did not learn a new opinion. It **kept the same two steps in the same order** and, told that
exactly one authority may close and that preconditions come first, demoted the first step and let the
second close. That plan is fully contract-valid — it is, precisely, the shape WP-3's own instruction
offers as the *legitimate* multi-authority plan ("확인한 뒤 판매자의 예외 판단이 필요하면 앞 권한을
PRECONDITION으로 적고 SELLER가 닫습니다"). The escape clause became the default: needs carrying a
**KNOWLEDGE precondition went 0 → 18**, and total PRECONDITION roles 13 → 33.

The mechanism is measured, not inferred. **In WP-2, across all 201 calls, every single time SELLER closed
alongside another authority — 49 of 49, 100% — SELLER was the last step written.** The model has a stable
habit of appending SELLER last. Under v2 that was cosmetic, because every step could close and the right
authority was among the closers. WP-3's two rules — *exactly one closer* and *preconditions precede their
closer* — together make **the last-written step the closer**. A positional habit became a semantic decision.

So the contract says *how many* authorities may close and *in what order* steps appear, and never says
*which* authority should close. The model answered that question with position, and its position habit is
SELLER-last.

**This also corrects a WP-2/WP-3 headline.** The recall of 1.000 was read off plans that named the right
authority *and* SELLER as co-closers — 16 such needs in rep 1 alone — and WP-3's own seller analysis had
already classified all 31 distinct seller-closer pairs as **invalid fallbacks, 0 legitimate**. The scorer
credited those goals because the right authority appeared among the closers. It was never wrong to do so
on the data it had; but it means **1.000 was partly the ambiguity, not the competence.** Forced to name one
closer, the planner named the wrong one five times. The defect did not arrive with v3; v3 stopped
concealing it, and made it countable.

### 5.3 The second finding: four answers ran past the ceiling

`R:0c582144`, `R:83e607e0`, `R:9b8cc5a5`, `S:T12a` all hit exactly 1,600 output tokens and came back
`finish=length` → `TRUNCATED`. **The cap is 1,600 in v2 and v3 alike — it did not change.** The same four
questions, asked three times each under v2, produced 153–347 output tokens and `finish=stop` every time;
the largest answer in all 201 WP-2 calls was 647. Whatever these four did, they did not do it before.

**The cause is not observable from this run, and that is a harness defect worth naming:**
`InquiryDecisionGenerator` returns `new Envelope(null, finish, "TRUNCATED")` — the partial content, which
is the only evidence of *what* the model was emitting when it ran out, is discarded. Four rows say a limit
was hit and none of them can say why.

### 5.4 Availability: the over-read mechanism, measured

The §4.2(a) smoke finding generalises. `entity_over_read` 7 of 10 compared, and the over-read fields are
`ORDER_TRACKING` 6, `ORDER_PAYMENT` 3, `ORDER_CANCELLATION` 3, `LISTING_SALE_STATUS` 1. With `gapOf`'s
all-or-nothing clause, each unsupported field marks its whole step a gap even when the field the need
actually requires is available. This one **can** be re-measured for free: `PLAN_MODE=replay` re-reads the
67 recorded answers with the current validator and refuses any row whose rebuilt user turn does not hash
to the recorded `input_fp`, so a revised availability rule can be scored against these same plans with
zero model calls.

### 5.5 Customer input

Non-blocking by the brief, reported as a component metric: exact 25 / over 43 / under 3 of 68 goals
compared; required-input recall **2 of 5**; unnecessary inputs 88; **forbidden identity inputs 0**.
Over-ask by type: `MODEL` 19, `MEASUREMENT` 18, `SIZE` 17, `USE_CONTEXT` 17, `QUANTITY` 13, `OPTION` 4.
All 3 under-asks are the same token, `OPTION` — the one the gold uses for variant discrimination, while
the planner reaches for `SIZE`/`MODEL`/`MEASUREMENT` instead. Whether that is a planner error or a
gold-token choice is a category-C question and is **not** treated here as under-asking that costs a
resolution.

---

## 6. Freeze gate — **NOT PASSED. The planner is not frozen.**

| # | condition | result |
|---|---|---|
| 1 | wrong authority substitution = 0 | **FAIL — 5** |
| 2 | ORDER required-authority miss = 0 | PASS — 0 |
| 3 | `procedure_for_read` = 0 | **FAIL — 1** (`R:4181864b`) |
| 4 | forbidden identity input = 0 | PASS — 0 |
| 5 | unresolved required goal = 0 | **FAIL — 9** |
| 6 | contract / schema failure = 0 | **FAIL — 8/67 (11.9%), WP-2's rate reproduced** |
| 7 | WP-2 authority semantics hold under v3 | **FAIL — recall 1.000 → 0.875** |

Two of seven hold. Item 6 alone is disqualifying by the brief's own wording — *"기존 shadow의 20/201
invalid 수준이 재현되면 freeze하지 않는다"* — and 11.9% is exactly that level.

### 6.1 Classification

**A — schema/contract design.** The primary defect. The closing contract specifies a *count* and an
*order* but not a *choice*, so the closer is decided by position, and the planner's position habit is
SELLER-last (49/49). Also A: the four truncations, unexplained because the harness discards truncated
content; and `gapOf`'s all-or-nothing availability verdict.

**B — authority semantic error.** The SELLER-over-KNOWLEDGE preference is real and WP-3 had already judged
every instance of it invalid. But it is **downstream of A** in this run: the plans show the same steps in
the same order as v2, with only the roles reassigned. Fixing B by prompt-tuning before fixing A would tune
against an artifact.

**C — scorer/gold.** 12 capability mismatches, 7 of them `KNOWLEDGE.CATALOGUE` expected vs
`KNOWLEDGE.PRODUCT` planned — the same authority, so authority recall is unaffected — plus the `OPTION`
token question in §5.5. Eval-side; not a planner change.

**D — customer-input UX.** §5.5. Backlog, as instructed.

**E — stochastic one-off.** **Not invoked.** 49/49 is not chance, and nothing here is attributed to
variance without evidence. No repeat run is requested on that basis.

### 6.2 What is not proposed

**WP-4 E2E is not proposed.** It would run a resolver against a planner that hands an answerable knowledge
question to the seller in 5 of 72 goals, and the headline it is built to report — Wrong Automation, Safe
Resolution, Correct Handoff — would measure this defect rather than the resolver.

**A 67 × 3 re-run is not proposed**, per the brief. **The prompt is not micro-tuned**, per the brief: the
defect is in what the contract leaves unsaid, not in how a sentence is phrased.

### 6.3 Proposed next package — WP-3.1: closing-authority selection

Smallest change that addresses A, stated as a contract question rather than a prompt edit: **the contract
must say which authority closes, not only how many.** The candidate rule — *the authority that can
actually produce the answer closes; `SELLER` closes only when a new seller judgment is itself the answer* —
is already the architecture's stated semantics (`ResolutionPlan.Seller`: "This is an authority, not a
fallback"); it is simply not expressible or checkable today, since a `SELLER`-closed need with a
`KNOWLEDGE` precondition is indistinguishable, in shape, from the legitimate policy-then-exception plan.

Three sub-questions, in order:

1. can the distinction be made **structural** (a seller step declaring what judgment it makes, so
   "fallback" has no valid shape), or must it stay a validator rule?
2. the four truncations: retain truncated content in the harness first — it is one field — then look,
   because the cause is currently unobservable.
3. the availability rule: re-score by replay, **zero model calls**, and decide whether a step whose
   required fields are available should be reported as a gap.

Only (2) and (3) can be answered without a new model call; (1) changes the request and needs its own
manifest.
