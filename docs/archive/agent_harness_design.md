# Agent Harness Design (project-native)

> **What this is**: a durable architecture sketch for a lightweight,
> project-native agent harness layered *on top of* the existing
> `docs/agent_orchestration_playbook.md`. It names the patterns that
> have actually emerged from this repo's first week of orchestration
> work, identifies what is missing, and proposes a small number of
> codifiable skills + an "evolve" loop convention.
>
> **What this is NOT**: a runtime, a daemon, an autonomous swarm, or
> a wholesale port of any external "Harness" / "Ouroboros" framework.
> The playbook still owns the operating model; this document only
> *extends* it.
>
> **Status**: design-only (H-001). H-002 / H-003 will implement; see
> §9. Two new files only — this doc plus
> `ops/agent_handoffs/H-001.md`. Both stay untracked at write time.
>
> **Document version**: v0 (2026-05-07).

---

## 1. Purpose & non-goals

### What problem this harness solves *for this repo specifically*

We are a one-operator + five-specialist-hat operation (playbook §1.4)
pushing a Korean-first, single-product VOC pipeline that emits
calibration-sensitive PDFs and consumer-safety-gated cardnews.
The orchestration model (one Operator, five named agent roles, a
playbook of ticket templates and handoff protocols) is already
in place. What it does NOT yet have:

- A way to recognise that the same pattern (e.g. "read-only triage
  → recommend one fix path") has happened multiple times and
  deserves to be a reusable skill rather than a re-derivation each
  turn. The Q-001 read-only triage and the I-OY-RATING-SORTS
  read-only triage are the same shape with different content;
  today both required the operator to type the same constraint
  block.
- An explicit, named loop ("seed → execute → evaluate → closeout
  → evolve") that closes back into playbook / skill / agent
  definition updates. The playbook §10 board tracks tickets but
  does not track *learnings*.
- A 4-tier evaluation matrix (mechanical / semantic / policy /
  operator). Today the §7 review checklists mix all four implicitly.
- Codified treatment of "human-gated actions" beyond the §8
  forbidden-action list — e.g. cardnews public publishing, paid
  LLM quota, credentials.

The harness is the lightweight scaffold that names these patterns,
marks them codifiable (skills), and keeps the operator in the loop
for every state change. It does not introduce a new runtime; it is
markdown convention plus a small `.claude/skills/*.md` library.

### Non-goals

- **Not a daemon / autonomous service.** Every meaningful state
  change still passes through the operator turn (playbook §1.2,
  Appendix "No autonomous commits").
- **Not a wholesale Harness/Ouroboros adoption.** External
  frameworks are inspiration only; we adopt patterns selectively.
- **Not a replacement for the playbook.** The playbook is canonical
  for ticket templates (§4), handoff format (§5), commit protocol
  (§6), forbidden actions (§8), and concurrency rules (§11). The
  harness layers above and respects all of it.
- **Not a multi-tenant / SaaS extension.** The paused
  `scheduler/`, `queue/`, `workers/` scaffolding stays paused
  (CLAUDE.md §6 + playbook Appendix). The harness does not
  re-animate it.
- **Not auto-staging / auto-committing.** §6 commit protocol
  rules #1–#8 stay binding. Skills MUST NOT propose patterns that
  bypass operator approval.

---

## 2. Why not wholesale adopt external harnesses yet

The operator named "Harness" and "Ouroboros" as inspiration with
explicit reservations. Below are concrete frictions an off-the-shelf
adoption would create against *this* repo's invariants:

1. **Single-operator scale.** The playbook is shaped for 1
   operator + 5 specialist hats (§1.4). An off-the-shelf harness
   typically assumes a team of reviewers / QA / release captains
   and bakes that role split into its scheduler. We don't have
   the headcount to fill those slots, and synthesising fake roles
   creates accountability drift.
2. **Repo-on-disk source-of-truth invariant.** Per playbook §1.2:
   "Repo on disk = canonical state. If something is not in a file
   here, it doesn't exist for purposes of operations." External
   harnesses commonly hold state in an external store
   (queue, DB, kanban API). Adopting one introduces a parallel
   truth that conflicts with §1.2 and Appendix "No private
   knowledge outside git" — and forces every future audit to
   reconcile two stores.
3. **Buyer-facing artifact safety.** Per memory
   `feedback_consumer_safety_contract`, every cardnews / public
   PDF / caption MUST pass an explicit safety contract (banned
   framings, preferred framings, vocabulary swaps). The cardnews
   pipeline encodes this as a CLI-level lock
   (`cardnews/render.py`'s `cardnews_mode='private_demo'` is the
   only allowed value today; commit `a2b2ae6`). External
   harnesses cannot know this rule and would happily run a
   "publish" stage that breaks it.
4. **§6 protected calibration territory.** The Phase 2E detector
   (`stage1.py`), aggregate (`aggregate.py`), Phase 1 lexicons,
   golden data, IMPACTS_KO / RECOMMENDATIONS_KO / verdict
   templates, priority-scoring formula — all change only with
   explicit, scoped operator authorization. An external
   harness's "auto-improve based on eval feedback" loop would
   violate §6 by default.
5. **Single-writer DB constraint.** `voc_data.db` is single-writer
   (ops-data agent definition, role instruction #2). Any harness
   pattern that fan-outs Stage 1 collection across N parallel
   workers writes corrupt rows. The Brand-20 fan-out model
   surveyed in the O-001-smoke-trio chain runs SKUs sequentially
   for exactly this reason.
6. **Per-batch live collection authorization.** Per playbook
   §2.5 #1 + §8: live collection authorization is per-batch,
   never standing. The operator must name the goodsNo (or batch)
   in the dispatching turn. Standing schedules and
   "auto-rerun-on-failure" loops cannot honour that constraint;
   the O-001 emergency-stop flow (handoff lines 14-22) is the
   concrete precedent — a stream timed out mid-collection, the
   operator killed it, and the orchestrator wrote a forensic
   handoff to capture the half-state. Any harness that retries
   automatically would have collided with the operator's stop.

In short: the playbook is calibrated to the constraints of *this*
operation. Treat external harnesses as a vocabulary for naming
patterns, not as a runtime to install. We adopt the **Supervisor**,
**Producer-Reviewer**, **Pipeline**, **Fan-out/Fan-in**, and
**Expert Pool** *patterns* (§4 below), not the libraries.

---

## 3. Current agent system summary

### Five-role layout (playbook §1.4 + §2)

| # | Role | Type | Primary write surface |
|---|---|---|---|
| 1 | Founder / Operator | Human | Final authority. All commits, pushes, billing, brand promises. |
| 2 | Orchestrator | Claude session | `docs/agent_orchestration_playbook.md`, ticket-board edits, handoff synthesis |
| 3 | Product / Strategy | Claude session | `docs/instagram_*`, brand strategy, content drafts |
| 4 | Implementation | Claude session | `src/voc/**`, `cardnews/**`, `tests/**`, code modules in `scripts/**` |
| 5 | QA / Regression | Claude session | Read-mostly. Reports, no production code |
| 6 | Ops / Data | Claude session | `configs/`, `outputs/<run>/`, batch shell scripts |

Each role has an `.claude/agents/<role>.md` definition that mirrors
the playbook §2 boundaries. Native subagent dispatch
(`.claude/commands/orchestrate.md`) plus the multi-worktree mode
(playbook §3) coexist; the operator picks per task.

### §5 filesystem handoff protocol — the load-bearing invariant

Every sub-agent writes a handoff file to
`ops/agent_handoffs/<ticket-id>.md`. Chat output is commentary, not
authority. The orchestrator (or operator) reads the file +
`git status --short` + `git diff --stat` for canonical inspection.
Handoffs are untracked by default per §5 file hygiene. This
filesystem-as-truth pattern is what makes the orchestration unit
durable across sessions and across the multi-worktree / native-mode
boundary.

### §11 native subagent mode

Single-session, in-process delegation via Claude Code's subagent
mechanism. Concurrency rule: at most one writer per orchestration
unit unless scopes are provably disjoint AND the operator
explicitly approves. Read-only subagents may run in parallel.

### §10 ticket board

Lives in the playbook itself (not a separate doc). v1.0 starter
set holds A-001..A-003 (closed), P-001 (closed), O-001 (open),
C-001 (closed), Q-001 (closed), I-Q001-A (closed). Format follows
§4 ticket template; status moves through todo → in-progress →
review → done|blocked.

### Empirical orchestration shapes from this session

This is the load-bearing observation set. Every harness design
decision below grounds in one of these:

| Pattern | Real handoff filename | Shape |
|---|---|---|
| **Read-only triage → orchestrator synthesis → impl fix → orchestrator close** | `Q-001.md` → `O-A-Q001.md` → `I-Q001-A.md` → `O-A-IQ001A.md` | QA reads, recommends 1 path, presents trade-offs for 4 alternatives, ranks them. Orchestrator synthesises into a dispatch-ready ticket. Impl applies path verbatim, runs tests (12/12 + 1129/1129), proposes commit. Orchestrator confirms, drafts message, identifies the file-untracked git nuance. Operator stages explicitly. |
| **Design-only doc + orchestrator synthesis** | `C-001.md` → `O-A-C001.md` | Impl reads code (5+ source files end-to-end, 1+ run-package shape, manifest + analysis_report + collection_summary), produces `docs/<topic>_design.md` with file:line citations + risk-ranked list + 8-question matrix + recommended C-002 sequence. Orchestrator relays load-bearing findings + risk table + recommended next dispatch. Both files stay untracked. |
| **Live-collection batch with mid-flight emergency stop + resume** | `O-001-smoke-trio.md` (lines 1-217 audit + 224-515 resume) → `O-A-O001-resume.md` | Ops-data dispatched for live collection of 3 goodsNo. Stream timed out at product 1; operator stopped before retry. Orchestrator wrote forensic handoff (process IDs, log paths, run_dir state, DB integrity, manifest absence, retry_queue absence, per-product result table, risk table, fan-out readiness verdict). After manual operator login, resume turn collected products 2 + 3 with full pre-flight checks, sequential SKUs, post-run integrity check. Orchestrator surfaced a recurring soft-failure (RATING_ASC + RATING_DESC sort_control) and recommended a follow-up triage. |
| **Cross-artifact code triage (read-only)** | `I-OY-RATING-SORTS.md` → `O-A-IORS.md` | QA-style read-only investigation under an `I-` prefix (the operator's name does not change the role). Cross-category probe across 7 prior runs falsifying 3 of 4 hypotheses, 1 ranked-strongest with refinement, recent-commit scan, file:line citations into connector source + classifier. Output: single-recommendation fix path + proposed I-OY-RATING-SORTS-IMPL ticket scope with explicit scope-out (§6 protected files named). Orchestrator synthesised into operator-ready dispatch. |
| **Board closeout** | `aa8cb96 chore(agents): mark buyer journey triage done`, `149ab15 chore(agents): mark detail page snapshot design done` | One-liner playbook §10 board edit at a closed ticket — append `**status**: done`, `closed_by: <SHA>`, `closed_at: <date>`, and a `decision recorded:` paragraph. Pure docs commit, no code, no test gate. Routine. |

The harness must fit these shapes, not invent abstract ones.

---

## 4. Mapping to Harness patterns

The operator named five patterns. Below is which ones this repo
already implements implicitly, which deserve explicit promotion,
and the empirical example for each.

### 4.1 Supervisor

- **Intent**: one agent reads other agents' outputs, gates the
  next step, assembles the audit trail.
- **Already implicit?** Yes. The Orchestrator role IS the
  supervisor: playbook §2.1 + §7 review checklists + §11 concurrency
  rule. Every orchestration unit ends with an orchestrator handoff
  file (`O-A-<id>.md`) that aggregates per-subagent verdicts.
- **Adopt explicitly?** Already explicit. No change needed.
- **Empirical example**: `O-A-Q001.md` lines 49-52 — the
  orchestrator's per-ticket verdict table is the supervisor
  output. `O-A-IQ001A.md` line 71-93 — the orchestrator surfaces
  the "git nuance" (untracked-file commit framing) that the
  implementation agent did not catch on its own. That cross-check
  is the supervisor pattern earning its keep.

### 4.2 Producer-Reviewer

- **Intent**: one writer agent + one critic agent for high-stakes
  outputs. The critic does not implement; it validates and pushes
  back.
- **Already implicit?** Partially. Implementation + QA is a weak
  Producer-Reviewer pair when QA reviews an Implementation handoff
  (playbook §7 second checklist block). But QA is *post-hoc*, not
  in-the-loop on draft.
- **Adopt explicitly?** **Yes, for two specific surfaces**:
  1. **Cardnews safety** — the consumer-facing surface should
     have a producer-reviewer pair before any change to
     `cardnews/render.py`, `cardnews/safety_validator.py`, or any
     consumer-template wording. The reviewer is a thin product-
     strategy variant whose only job is to run the
     `feedback_consumer_safety_contract` banned-framings check.
     Today this is a doc that gets read; the producer-reviewer
     pattern would make it a separate dispatch step.
  2. **PDF wording (`IMPACTS_KO`, `RECOMMENDATIONS_KO`,
     verdict templates)** — these are §6 protected and
     stakeholder-visible (CLAUDE.md §8). When a phrase change is
     authorized, a producer-reviewer pair (implementation writes
     the phrase + paired test, product-strategy reviews against
     the consumer-safety contract and the hedged-candidate
     contract) is a more conservative shape than a single
     implementation pass.
- **When NOT to adopt**: routine code edits (test adds, fixture
  repoints, internal refactors). The single-writer pattern is
  fine; QA can review post-hoc when needed.
- **Empirical example**: there is **none yet** in this session's
  data. The pattern would have helped on a hypothetical
  cardnews-wording change but no such ticket has run. Flag this
  as speculative until we have at least 2 real instances.

### 4.3 Pipeline

- **Intent**: sequential stage handoffs. Stage N reads Stage N-1's
  output, produces its own, hands to Stage N+1.
- **Already implicit?** Yes, this is the dominant pattern in this
  repo. Multi-worktree mode (§3) is a Pipeline at the
  orchestration layer. The Q-001 → I-Q001-A flow IS a 2-stage
  pipeline. Phase 2E itself is a Pipeline at the data layer
  (Stage 1 collection → Stage 2 attribute polarity → Stage 3
  aggregation/scoring → Stage 4 reporting per CLAUDE.md §2).
- **Adopt explicitly?** Already explicit at the data layer.
  Worth promoting at the *orchestration* layer with a name:
  every QA-triage → impl-fix sequence is a "triage pipeline";
  every design-doc → impl pipeline is a "design pipeline". A
  skill (see §6) can codify the input/output contract for each.
- **Empirical example**: Q-001 → I-Q001-A. QA's `Q-001.md`
  §"Recommended follow-up implementation ticket" is the
  hand-off contract; impl reads it, applies Path A verbatim,
  reports back. Two stages, file-mediated, no chat dependency.

### 4.4 Fan-out / Fan-in

- **Intent**: split a task across N parallel workers, then merge
  results.
- **Already implicit?** Partially. The Brand-20 fan-out is the
  obvious case (20 SKUs × full pipeline = 20 ops batches), but
  it is **explicitly NOT parallel** at the writer layer
  (single-writer DB; ops-data role instruction #2). Each SKU
  runs sequentially; the "fan-out" is across operator dispatches
  over time, not within one orchestration unit.
- **Adopt explicitly?** Yes — **but only with the constraint
  encoded into the harness**. A `brand-20-fan-out` skill should:
  1. Iterate SKUs sequentially, never in parallel
  2. Pre-flight authentication + DB integrity between SKUs
  3. Hard-stop on any per-SKU failure before next; surface to
     operator
  4. Aggregate per-SKU manifests + cardnews tri-tuple
     verifications into a single fan-in summary
- **When NOT to adopt**: anything that touches `voc_data.db`
  in parallel, or any live collection without per-batch operator
  authorization (per-batch is the unit; the skill must NOT
  request omnibus authorization).
- **Empirical example**: O-001-smoke-trio resume (handoff lines
  255-261) is the closest thing to a working fan-out template.
  It iterated 2 of 3 authorized SKUs, with pre-flight + post-run
  integrity checks between them. The skill would name and
  generalise that loop for the remaining 17 Brand-20 SKUs. Note
  that O-001's pre-stop section (lines 1-217) shows the fan-in
  forensic-write-up half — when fan-out fails mid-flight, the
  fan-in becomes a forensic audit rather than a celebration.
- **Open caveat (see §10)**: Fan-out interaction with
  `cardnews_mode == private_demo` and the `publishable_to_public_channels`
  field path nuance (§3.1.1 verification spec change in
  schema-1.1) suggests the verification block in any fan-in
  needs to be schema-aware.

### 4.5 Expert Pool

- **Intent**: a router selects which specialist to dispatch
  based on the goal.
- **Already implicit?** Yes. The orchestrator's `/orchestrate`
  command routes to one of 4 specialists
  (`product-strategy`, `implementation`, `qa-regression`,
  `ops-data`). Routing decision is in playbook §2 + the agent
  definitions' `description` fields.
- **Adopt explicitly?** Already explicit. The question is **when
  a finer-grained "expert" warrants a new role definition vs.
  living as a skill**. Heuristic:
  - **New role** when the boundary is a permission boundary
    (different file allowlist, different forbidden list, different
    handoff fields). Example: today's 5 roles are 5 distinct
    permission boundaries.
  - **Skill** when the boundary is a recipe / pattern boundary
    inside an existing role's permissions. Example:
    `board-closeout` is an orchestrator-role skill, not a 6th
    role. `fixture-drift-triage` is a qa-regression-role skill,
    not a "FixtureDoctor" role.
- **When NOT to adopt**: do NOT create a new role for
  every recurring narrow task. Skill explosion across 5 roles
  is cheaper than role explosion (open question in §10).

---

## 5. Ouroboros-inspired loop

The operator named the loop: `seed → execute → evaluate → closeout
→ evolve`. Map each phase to existing playbook artifacts:

| Phase | Existing artifact | Where it lives | Status |
|---|---|---|---|
| **Seed** | §4 ticket template + operator dispatch turn | `docs/agent_orchestration_playbook.md` §4; operator's `/orchestrate <goal>` invocation | Explicit. The Q-001 spec in playbook §10 is a worked seed example. |
| **Execute** | Subagent dispatch + handoff write | `ops/agent_handoffs/<ticket-id>.md` per playbook §5 "Filesystem handoff protocol" | Explicit. Every subagent in this session followed it. |
| **Evaluate** | Orchestrator §7 review checklist + filesystem read | Playbook §7 + `ops/agent_handoffs/O-A-<id>.md` synthesis | Explicit. `O-A-Q001.md` lines 41-46 is a worked evaluation table. |
| **Closeout** | Operator commit + §10 board update + §13 summary template | Playbook §6 commit protocol + §10 board + CLAUDE.md §13 | Explicit. The `aa8cb96` and `149ab15` commits are worked closeouts (single-line `**status**: done` + `closed_by:` + `decision recorded:` paragraph in §10). |
| **Evolve** | **MISSING TODAY** | — | This is the gap. |

### What "evolve" means and what's missing

Q-001 produced a precedent for the read-only-triage-→-recommend-one-fix
pattern. I-OY-RATING-SORTS used the same pattern a few hours later
without the operator typing the constraint block again — but only
because the operator copied it from memory. There is no
**institutional** mechanism that recognised "this pattern recurs;
make it a skill". Same for `board-closeout` (two real instances
already), `smoke-collection-forensics` (one instance, but explicitly
named as worth codifying in O-A-O001-resume.md line 117-128).

### Concrete proposal for "evolve"

**Convention, not automation, for v1.** A monthly retrospective
operator turn (already named in playbook §12 "Monthly retrospective")
adds two new line items:

> - Re-read `ops/agent_handoffs/` files that closed in the last
>   month. For each pattern that appears ≥ 2 times with the same
>   shape (same scope-in/scope-out, same handoff structure, same
>   verification gates), open a `H-NNN` ticket to extract it as a
>   skill in `.claude/skills/<skill-name>.md`.
> - Re-read `.claude/skills/`. Any skill whose pattern has not
>   been invoked in 60 days is a candidate for retirement.
>   Don't delete on the first miss — flag for review at the next
>   retrospective.

This is intentionally **operator-only and convention-only**. The
alternative — agent-proposed skill extraction triggered by a grep
over `ops/agent_handoffs/` content — is left as an open question
in §10.

Why operator-only: skill extraction is a meta-design decision that
shapes future orchestrations. The risk of premature codification
(see §10 risk #1) is real with a 1-week sample. Letting a
sub-agent propose skills creates a feedback loop (agent extracts
pattern P; agent uses skill for P; pattern P now reflects the
skill, not the underlying need; the skill becomes
self-justifying). Operator-gated extraction breaks that loop.

Why convention-only: a hooks-enforced version
(`.claude/hooks/handoff-pattern-scanner.sh`) is feasible but adds
machinery we don't yet need. The 6 weekly + 1 monthly check
(playbook §12) is sufficient surveillance for now.

---

## 6. Candidate skills to extract

Skill spec format mirrors `.claude/skills/*.md` files (front-matter
YAML with `name:` + `description:`, then the body in markdown). The
five candidates below are sketches; H-002 / H-003 will write the
final files.

### 6.1 board-closeout

```yaml
name: Board Closeout
description: Update the agent ticket board (playbook §10) for a closed ticket — append status, closed_by SHA, closed_at, and a decision-recorded paragraph. Pure docs edit.
```

- **When to trigger**: a ticket has landed (commit SHA exists, or
  the ticket was design-only with a clear durable artifact). The
  operator is ready to mark it closed.
- **When to skip**: the ticket is still in-progress, or the
  closure decision is non-trivial (e.g. a partial-success outcome
  that needs the operator to pick the framing).
- **Allowed tools**: Read, Edit (on the playbook only).
- **Forbidden tools**: Bash (no commit/push/stage from skill;
  operator stages and commits the chore commit), Write (no new
  files; the playbook is the only edit target).
- **Allowed file scope**: `docs/agent_orchestration_playbook.md`
  §10 only.
- **Forbidden file scope**: anything outside the playbook §10
  block. No edits to other sections, no edits to handoff files,
  no edits to closed-ticket archives.
- **Required handoff structure**: 1-paragraph decision-recorded
  text matching the existing pattern (closed_by SHA, closed_at,
  decision summary in 2-3 sentences). Must cite the actual
  closing commit SHA OR mark as `<handoff-only>` for design
  tickets.
- **Example invocation**:
  ```
  /orchestrate Close ticket Q-001 in playbook §10. Closed by SHA
  7cea019. Decision: QA triage found fixture drift; impl applied
  Path A; producer not regressed.
  ```
- **Skill-worthy because**: two real instances already
  (`aa8cb96`, `149ab15`); routine; tight scope; mistakes are
  cheap (re-edit the §10 line). It is also the first skill that
  surfaces "evolve" — a closed pattern feeding back into the
  ticket-board state.

### 6.2 smoke-collection-forensics

```yaml
name: Smoke Collection Forensics
description: When a live-collection batch halts mid-flight (stream timeout, anti-bot escalation, session expiry), produce a forensic handoff that reconstructs state from filesystem-only evidence. No retry. No credential handling.
```

- **When to trigger**: a live-collection subprocess has been
  killed (by operator emergency-stop, by stream timeout, by
  anti-bot). The orchestrator (or operator directly) needs to
  audit half-state.
- **When to skip**: collection completed cleanly. Use
  `inspect_run_quality.py` and the regular ops handoff format
  instead.
- **Allowed tools**: Read, Bash (read-only: `pgrep`, `ls`, `cat`,
  `find`, `git status`).
- **Forbidden tools**: Edit, Write (except the handoff file),
  any Bash that mutates state (`rm`, `git`, `python scripts/run_*`,
  any browser automation).
- **Allowed file scope**: read everything; write only the
  handoff file at `ops/agent_handoffs/<ticket-id>.md`.
- **Forbidden file scope**: writes to `outputs/<run>/`,
  `voc_data.db`, `/tmp/o-*-*/`. Write only the handoff.
- **Required handoff structure** (matches O-001-smoke-trio
  lines 1-217 verbatim):
  1. Active / killed process IDs (`pgrep -fl ...` output)
  2. Last log file path (with size + timestamp)
  3. Last run_dir + which artifacts exist vs. don't
  4. `voc_data.db` integrity (size, mtime, journal/wal/shm
     presence, partial-write risk)
  5. `manifest.json` existence at run-dir root + analysis_status
  6. `retry_queue.json` existence
  7. Per-product result table (started, completed, status, next
     status)
  8. Per-sort forensics for the failing product (raw_records_seen,
     rows_inserted, anti_bot_or_blocked, auth_evidence)
  9. cardnews_mode verification (or N/A if cardnews stage never
     ran)
  10. Quality inspection (or marked NOT RUN if the inspector
      would emit a missing-file error)
  11. Risks / warnings table
  12. Fan-out readiness verdict
  13. Exact commands run (verbatim)
  14. `git status --short`, `git diff --stat`
- **Example invocation**:
  ```
  /orchestrate The Brand-20 smoke trio collection halted mid
  product 1 due to operator stop. Produce a forensic handoff at
  ops/agent_handoffs/O-001-smoke-trio.md per the
  smoke-collection-forensics skill. Do not retry. Do not
  re-login.
  ```
- **Skill-worthy because**: the audit shape is exactly the same
  for any halted live-collection regardless of cause (timeout,
  anti-bot, operator stop, session expiry). The 14-section
  template is reusable verbatim. Also: this skill ENCODES the
  "no retry, no credential handling, fail-soft on inspector"
  invariants explicitly so a future orchestration can't drift
  from them.

### 6.3 fixture-drift-triage

```yaml
name: Fixture Drift Triage
description: Read-only QA triage when a fixture-bound test fails. Resolve which of the four root-cause categories is correct (test stale / impl regressed / fixture drifted / expectation needs update) and recommend exactly one fix path with explicit blast radius for each alternative.
```

- **When to trigger**: a test that reads from a real run-package
  fixture (`outputs/<run>/...`) is failing, and it is not
  obvious whether the failure is producer regression or fixture
  rot.
- **When to skip**: the failing test is a §6-protected
  golden-data test or a phrase-locked test (in those, the
  expected behavior is calibrated and the fix path is
  preordained).
- **Allowed tools**: Read, Bash (read-only: `pytest <path> -q`,
  `grep`, `git log`).
- **Forbidden tools**: Edit, Write (except the handoff file),
  any state mutation.
- **Allowed file scope**: read all source, all tests, all
  fixtures; write only the handoff file. **No fixture
  regeneration.**
- **Forbidden file scope**: writes anywhere except the handoff.
- **Required handoff structure** (matches Q-001.md):
  1. Scope (what was inspected)
  2. Read-only verification commands run
  3. Results (pass/fail counts; failing test file:line; failing
     assertion verbatim; drift flags)
  4. **Conclusion: which interpretation is correct?** — name
     exactly one of (a) test stale, (b) impl regressed,
     (c) fixture drifted, (d) expectation needs update; provide
     evidence chain (deterministic, no judgement)
  5. **Blast radius of each fix path** — Path A through Path D,
     each with: file touched, other tests affected, downstream
     consumers affected, risk, why-recommended-or-not
  6. **Single-recommendation conclusion** — one path only, with
     specific change snippet
  7. **Recommended follow-up implementation ticket** — proposed
     ticket id, role, scope-in/scope-out, fix-path
     recommendation
  8. `git status --short`, `git diff --stat`
- **Example invocation**:
  ```
  /orchestrate Triage the buyer_journey drift test failure.
  Read-only. Use qa-regression subagent. Produce handoff at
  ops/agent_handoffs/Q-001.md per the fixture-drift-triage
  skill.
  ```
- **Skill-worthy because**: the Q-001 + I-OY-RATING-SORTS
  triages have the same shape with different content. The
  4-category framework, the 4-path-blast-radius table, and the
  single-recommendation discipline are reusable. The skill also
  ENCODES the "do not silently regenerate fixtures" and "do not
  edit production tests by default" rules from the qa-regression
  agent definition.

### 6.4 instagram-public-education-review

```yaml
name: Instagram Public Education Review
description: Apply the playbook §7 last-block policy consistency check + the consumer-safety contract banned-framings grep + the placeholder-leakage grep to a draft public-education post. Read-only review; recommend changes via the handoff.
```

- **When to trigger**: a `docs/instagram_public_education_post_*.md`
  draft is ready for safety review (after first draft, before
  publish-time gate). The review is not the publish gate; it is
  a pre-flight pass.
- **When to skip**: the doc has not yet been drafted, or the
  doc is not in the public_education series (e.g. brand
  strategy, DM script — those have different review surfaces).
- **Allowed tools**: Read, Bash (read-only: `grep -n` for
  banned framings + placeholders, `git log -1` for cited SHAs).
- **Forbidden tools**: Edit, Write (except the handoff). No
  draft revisions; surface findings, let the writer decide.
- **Allowed file scope**: read the draft + the cited policy
  SHAs (`108888e`, `648b728`, `6dc8a0f`, `7879a7d`, `bc17ed4`);
  write only the handoff.
- **Forbidden file scope**: writes anywhere. This is a critic
  pass; the writer (product-strategy) implements changes.
- **Required handoff structure**:
  1. Scope: which draft, which policy chain SHAs, which
     consumer-safety memory file (`feedback_consumer_safety_contract`)
  2. **Banned-framings grep** verbatim (each banned substring
     from the contract: `브랜드가 숨긴`, `당신이 모르는 진실`,
     `광고에 속지 마세요`, `진짜 실체`, `충격적인 반전`,
     `팩트 폭로`, `소비자들은 속고 있다`, `절대 사지 마세요`,
     `최악`, `독`, `부작용`, `무조건`, `인생템`, `미쳤어요`)
     with line numbers if found, "no matches" if not
  3. **Placeholder-leakage grep** — `@account`, `hello@xxx`,
     `[HOLD`
  4. **CTA wording match** vs. `648b728` lock
  5. **Front-matter SHA citations** — present, correct, in the
     same order as the predecessor doc?
  6. **14-row safety table** (per `6dc8a0f`) — does the doc's
     own §5 safety check pass?
  7. **Hedged-phrasing audit** — recommendation phrases end in
     {`후보`, `가능성`, `검토`, `권장`, `확인`}; no `필요`,
     `해야 함`, `원인은`, `개선 필요`
  8. Recommended changes (if any), with file:line and proposed
     phrase
  9. Verdict: ready for operator publish-gate, or needs
     revision
  10. `git status --short`, `git diff --stat`
- **Example invocation**:
  ```
  /orchestrate Review docs/instagram_public_education_post_002.md
  per the instagram-public-education-review skill. Use
  product-strategy subagent in read-only mode (no draft edits).
  Produce handoff at ops/agent_handoffs/PR-002.md.
  ```
- **Skill-worthy because**: the 14-row safety + banned-framings +
  placeholder-leakage + hedged-phrasing checks are mechanical
  greps. Codifying them as a skill (a) makes the check
  reproducible across post N+1, N+2, ..., (b) protects the
  consumer-safety contract from drift, (c) creates a producer-
  reviewer pair (§4.2) without inventing a new role.
  Caveat: speculative — only Post 001 has shipped; Post 002
  drafted but the review has not run as a discrete skill yet.
  Validate against Post 002 before extracting.

### 6.5 detail-page-snapshot-design

```yaml
name: Detail Page Snapshot Design
description: For C-001-shaped design-only tickets — read code end-to-end, produce a design doc with file:line citations, provenance matrix, risk-ranked list, and recommended implementation sequence. No code edits, no tests.
```

- **When to trigger**: an operator goal asks for a design
  document before implementation, with explicit "design-only"
  framing. The output is a `docs/<topic>_design.md` file plus a
  handoff.
- **When to skip**: the goal is implementation-ready (skip
  design, dispatch impl directly with the design already in a
  ticket spec). Or the design is trivial (1-line decision) —
  capture in the ticket-spec, no doc needed.
- **Allowed tools**: Read, Bash (read-only: file shape probes,
  `jq`, `grep`), Write (one new doc + the handoff).
- **Forbidden tools**: Edit (no patches to existing docs;
  design lands as a NEW file). No code edits, no test edits.
- **Allowed file scope**: write `docs/<topic>_design.md` +
  `ops/agent_handoffs/<ticket-id>.md`. Read everything.
- **Forbidden file scope**: edits to existing docs, edits to
  source/tests, edits to outputs/ artifacts. Especially: do not
  edit §6 protected files even if read access is needed for the
  design.
- **Required handoff structure** (matches C-001.md):
  1. Design-only declaration (no code/tests modified, no
     collection invoked, no staging/commit)
  2. Files written (the new design doc + the handoff)
  3. Read-only investigation log — every file read, with one-
     line note on what each file gave the design
  4. Decision summary (TL;DR — what the design DOES that the
     status quo doesn't)
  5. Proposed C-NNN+1 implementation file list (with one-line
     purpose per file)
  6. Risk assessment (top 5, ranked, with blast radius +
     mitigation hint)
  7. Recommended implementation sequence (ordered, with what
     lands first / second / ...)
  8. Test plan summary (count + categories + which operator
     questions each test covers)
  9. `git status --short`, `git diff --stat`
- **Example invocation**:
  ```
  /orchestrate Design C-001 detail_page_snapshot. Design-only.
  Use implementation subagent. Produce
  docs/detail_page_snapshot_design.md and
  ops/agent_handoffs/C-001.md per the
  detail-page-snapshot-design skill.
  ```
- **Skill-worthy because**: C-001 is the only instance so far,
  but the shape is reusable for any design-then-implement work
  (Phase B planner, future cardnews layout revisions, schema
  migrations). The skill encodes the "find the existing slot
  before proposing a schema bump" discipline (C-001 found
  `manifest.provenance.snapshot` already exists at schema 1.2,
  saving a schema bump). Caveat: with N=1, this is the most
  speculative of the five. H-003 should re-validate.

---

## 7. Human-gated actions

Every action in this list MUST remain operator-only. The harness
explicitly surfaces each gate; agents must NOT propose actions
that bypass them.

| # | Gate | Artifact / state change controlled | Existing enforcement | Harness-side surface |
|---|---|---|---|---|
| 1 | **commit** | git tree state | Playbook §6 #1 ("never commit on own initiative"); subagent definitions all carry "Never `git add`, `git commit`, `git push`, history-rewrite" | Orchestrator MUST print the proposed commit message and the staging set in the synthesis handoff; never run the commit itself |
| 2 | **push** | remote git state | Playbook §8 ("git push (any remote)") | Same as #1 — never run; surface the operator action only |
| 3 | **live collection** | OY API requests, OY rate-limit posture, anti-bot detection | Playbook §8 ("Live collection") + §2.5 #1 (per-batch, never standing); ops-data agent role instruction #1 ("Authorization is per-batch, never standing") | Orchestrator MUST verify the operator turn names the goodsNo (or batch) explicitly before dispatching ops-data; reject the dispatch if no goodsNo is named. The O-001 emergency-stop handoff (lines 14-22) is the canonical precedent — when the operator stopped, the harness did not retry, did not request credentials, did not narrow the cooldown |
| 4 | **credentials** | OY login session, Chrome CDP profile | O-001-smoke-trio dispatch language ("Do not retry login. Do not ask for or use credentials"); ops-data definition forbids credential handling | Orchestrator MUST refuse any subagent prompt that requests credentials; if a subagent requests them, return the ticket as rejected |
| 5 | **public publish** | Instagram cardnews → public account; cardnews_mode widening | `cardnews/render.py` CLI lock at `choices=['private_demo']` (commit `a2b2ae6`); memory `feedback_consumer_safety_contract` banned framings; playbook §6 #4 last block | Orchestrator MUST verify `cardnews_mode == "private_demo"` in any cardnews manifest produced by an ops-data run; flag the run as quality-failed if `private_demo` is missing OR `cardnews_mode_constraints.publishable_to_public_channels != false` |
| 6 | **external messages / paid LLM quota** | DM responses, paid LLM API spend beyond a single small smoke | Playbook §8 (last row "Running anything that touches paid LLM API quota beyond a single small smoke"); product-strategy + implementation definitions both carry quota constraints | Orchestrator MUST refuse any dispatch that implies a paid-LLM run beyond a smoke unless the operator turn explicitly authorizes; surface the smoke-vs-batch distinction in the dispatch synthesis |

**Harness contract**: at the top of every orchestrator handoff,
under a "Human-gated authorization status" header, list each gate
1-6 with one of {not-attempted, authorized-this-turn, deferred-to-operator}.
Today this is implicit ("Forbidden-action audit" sections in
existing handoffs); promoting it to a fixed header makes every
orchestration unit auditable in the same way.

---

## 8. Evaluation gates (mechanical / semantic / policy / operator)

Today the playbook §7 review checklists mix all four implicitly.
Splitting them into 4 named tiers makes failure modes explicit
and lets the harness ENCODE which tier each test belongs to.

### Tier 1 — Mechanical

- **Checks**: pytest exit code, ruff exit code, schema
  validation pass, `git diff --stat` is empty for read-only QA,
  `git status --porcelain` line count, manifest schema_version
  matches enum
- **Who runs**: the implementation or qa-regression subagent
  before handoff
- **Failure mode**: nonzero CLI exit; subagent must STOP and
  flag in handoff (per implementation agent definition: "If a
  test you did not introduce fails, stop before handoff. Decide:
  is this a real regression caused by your change → fix the
  code, or is the test stale / unrelated → flag in handoff")
- **Currently enforced?** Yes, via subagent role instructions.
  Worth promoting to a named tier so the orchestrator's review
  checklist explicitly tracks it.

### Tier 2 — Semantic

- **Checks**: does the change match the ticket's stated intent?
  E.g. Q-001's recommended Path A actually addresses the failing
  assertion, not a different bug. Does the implementation
  agent's commit message frame the change accurately (the
  O-A-IQ001A.md "git nuance" — calling it "repoint" when git
  shows `A` not `M` — was an orchestrator semantic catch).
- **Who runs**: the orchestrator's §7 review (per-ticket
  verdict); the operator on the final commit-or-revise turn
- **Failure mode**: the change does what its mechanical-tier
  passes claim, but it does not solve the operator's stated
  problem; or it solves a different problem and silently
  broadens scope (memory `feedback_plan_iteration_discipline`).
- **Currently enforced?** Partially. Orchestrator §7
  checklist implies semantic review ("Files changed are within
  ticket scope", "Next recommendation is a real next step, not
  vague") but does not name it as semantic. Worth surfacing.

### Tier 3 — Policy

- **Checks**: does the change conform to playbook §5 / §6 / §8 /
  §9 / §10 + CLAUDE.md §5 / §6 / §8 / §9 / §10 + memory
  consumer-safety + cardnews_mode? Specific items:
  - §6 protected files unedited (mechanical: `git diff
    --name-only | grep -E <protected pattern>` is the test;
    semantic: was the edit authorized in the dispatch turn?)
  - cardnews safety contract banned-framings absent
    (mechanical grep)
  - Hedged-candidate phrasing on PDF wording (mechanical phrase-
    lock tests in `tests/test_reporting/test_phase2e/`)
  - Korean grammar safety on attribute labels (no batchim/particle
    bug)
  - cardnews_mode == private_demo + schema_version == 1.1 +
    cardnews_mode_constraints.publishable_to_public_channels ==
    false (mechanical jq check)
  - Per-batch live-collection authorization in dispatch turn
    (semantic check by orchestrator before dispatching ops-data)
- **Who runs**: orchestrator on every handoff; qa-regression
  agent's "Verify §6 protected files were not edited" command
  (per qa-regression definition)
- **Failure mode**: a §6 protected file was edited without
  scoped authorization → hard reject. A cardnews_mode breach →
  hard stop. A banned framing on a buyer-facing surface → hard
  reject.
- **Currently enforced?** Mostly yes — the qa-regression
  command exists, the cardnews_mode jq verification ran in
  O-001-smoke-trio resume (handoff line 478), the protected-
  files grep is in the qa-regression definition. The harness
  contribution is to surface this as a named tier so its
  failure modes are not buried inside §7.

### Tier 4 — Operator

- **Checks**: final review and stage/commit decision; is the
  proposed commit message correctly worded, does the staging
  set respect "Stage only:" exclusions, does the operator agree
  with the orchestrator's verdict
- **Who runs**: the operator
- **Failure mode**: operator rejects → orchestration unit
  re-opens with the failing checks listed; subagent revises
  (per playbook §12 "Per-task handoff": "If rejected: operator
  returns the handoff with the failing checks listed; agent
  revises").
- **Currently enforced?** Yes — this is the existing model.
  Naming it as Tier 4 makes the gate explicit rather than
  implicit.

### Why split into 4 tiers

- Different tiers fail differently. A Tier 1 failure (test
  red) is a hard stop. A Tier 2 failure (semantic mismatch)
  is "discuss with operator". A Tier 3 failure (policy
  violation) is a hard reject + investigation. A Tier 4
  failure is "operator declined; revise".
- Different tiers run at different times. Tiers 1-3 can
  run inside the subagent or the orchestrator. Tier 4 only
  runs at the operator turn.
- Different tiers can be partially automated. Tier 1 is
  fully mechanical (pytest + ruff). Tier 3 is mostly
  mechanical (greps + jq) plus one semantic check (was the
  edit authorized?). Tiers 2 + 4 are not automatable.

The matrix below summarises:

| Tier | Mechanical? | Runs at | Failure mode |
|---|---|---|---|
| 1 Mechanical | Yes (pytest/ruff/jq/schema) | Subagent pre-handoff | Hard stop |
| 2 Semantic | No (orchestrator/operator judgment) | Orchestrator synthesis | "Discuss with operator" |
| 3 Policy | Mostly yes (greps + jq); one semantic | Subagent + orchestrator | Hard reject + investigate |
| 4 Operator | No (operator-only) | Operator turn | Re-open ticket; revise |

---

## 9. Suggested H-002 / H-003 implementation plan

H-001 is design-only. H-002 and H-003 will implement.

### H-002 — extract two skills (smallest valuable surface)

**Goal**: extract `board-closeout` and `fixture-drift-triage` as the
first two skills. Both have ≥ 2 real instances or 1 instance + tight
scope, and both encode patterns the operator already mentally
carries.

- **Scope-in**:
  - `.claude/skills/board-closeout.md` — new file
  - `.claude/skills/fixture-drift-triage.md` — new file
  - Optional: a 2-3 line cross-reference in
    `docs/agent_orchestration_playbook.md` §11 ("the
    `/orchestrate` command may invoke any skill in
    `.claude/skills/`") — but only if landing the skills alone
    is insufficient signal that they exist
- **Scope-out**:
  - All §6 protected files
  - All other `.claude/skills/*.md` files (the existing 9 stay
    as-is)
  - All `.claude/agents/*.md` files (role boundaries don't
    change in H-002)
  - Code under `src/`, tests, configs, outputs
  - The orchestrator agent definition (`orchestrator.md`) —
    skills are invoked by name in `/orchestrate` prompts; the
    orchestrator definition does not need editing
- **Test plan**:
  - Dry-run the `board-closeout` skill on a synthetic ticket
    (e.g. close H-001 itself in playbook §10). Verify the diff
    is exactly 1 ticket-block edit; no other §10 or non-§10
    content moves.
  - Dry-run the `fixture-drift-triage` skill on a synthetic
    failing test. Use a deliberately broken fixture (a copy of
    a run-package's `analysis_report.json` with a known field
    mutated) so we can verify the 4-category framework lands
    on the right category. Do NOT mutate any tracked fixture.
  - Both dry-runs run in-session; no real ticket closes; no
    real test fails.
- **Acceptance criteria**:
  - Both skills are valid markdown with proper front-matter
    (parses as YAML; `name` + `description` present)
  - Both skills pass a manual review against the existing 9
    skill files for stylistic consistency
  - Each skill has at least one example invocation block in
    the body
  - Both skills name their forbidden tools and forbidden file
    scopes explicitly
- **Risks** (ranked):
  1. Codifying the wrong abstraction. The Q-001 fixture-drift
     pattern was 1 instance; the skill might encode N=1 noise as
     a rule. **Mitigation**: write the skill against Q-001 + the
     hypothetical "what would the skill have done for the next
     drift?" question, and revise after the first real reuse.
  2. Skill discoverability. If the operator does not know to
     invoke a skill by name in `/orchestrate`, the skill is
     dead weight. **Mitigation**: add a 2-line cross-reference
     in the playbook §11, AND list the new skills in the
     handoff for H-002 itself so the operator sees them.
  3. Overlap with existing skills. `review-changes.md` and
     `debug-issue.md` already exist. **Mitigation**: read
     existing skills first; pick names that don't conflict;
     state in each new skill's body when to use it vs. an
     existing skill.
- **Estimated turn count**: 1 dispatch (implementation
  subagent), 1 orchestrator synthesis. Tight scope.

### H-003 — extract harder skills + the "evolve" loop convention

**Goal**: extract the three harder skills and codify the monthly
"evolve" retrospective.

- **Scope-in**:
  - `.claude/skills/smoke-collection-forensics.md` — new file
  - `.claude/skills/instagram-public-education-review.md` —
    new file
  - `.claude/skills/detail-page-snapshot-design.md` — new file
  - `docs/agent_orchestration_playbook.md` §12 ("Monthly
    retrospective") — add 2 line items for the evolve loop per
    §5 of this design
- **Scope-out**:
  - All §6 protected files
  - The 4-tier evaluation matrix (§8 of this design) is
    convention-only in H-003; do NOT add hooks-enforcement.
    Hooks-enforcement is its own future ticket if needed.
  - The "Human-gated authorization status" header at top of
    every orchestrator handoff (§7 of this design) — same:
    convention-only in H-003; promote to a hook later if
    needed.
- **Test plan**:
  - Dry-run `smoke-collection-forensics` against the existing
    O-001-smoke-trio.md content; confirm the skill structure
    matches the existing handoff section-for-section.
  - For `instagram-public-education-review`: validate against
    Post 002 (which has been drafted but not formally reviewed
    against this skill yet). The dry-run produces a critique
    handoff at `ops/agent_handoffs/PR-002.md`. If the skill
    surfaces a finding the writer / operator did not catch, the
    skill earned its place.
  - For `detail-page-snapshot-design`: validate against C-001
    in retrospect — would the skill have produced the same
    `docs/detail_page_snapshot_design.md` shape? Specifically,
    would it have caught the "manifest.provenance.snapshot
    slot already exists at schema 1.2" finding without the
    operator naming it? If yes, ship. If no, refine the skill's
    "find the existing slot first" discipline before shipping.
- **Acceptance criteria**:
  - All three skills validate against H-002's acceptance
    criteria (front-matter, example invocation, forbidden
    tools / forbidden file scope)
  - The §12 evolve-loop additions match the existing §12
    style (terse, action-oriented)
  - The dry-runs produce real handoffs that an operator agrees
    are usable as-is (sample size of 1 per skill; not
    statistically representative; flag in handoff)
- **Risks** (ranked):
  1. `smoke-collection-forensics` has only 1 real instance.
     Generalising from N=1 is the highest premature-codification
     risk in this design. **Mitigation**: ship the skill with
     a "drift after 2nd use" review tag in the body; the next
     halted live-collection that uses the skill produces a
     review of whether the 14-section template is right.
  2. `instagram-public-education-review` requires the brand
     policy SHA chain to stay valid. If the chain rotates
     (new strategy revision lands), the skill's grep targets
     drift. **Mitigation**: skill body cites the 6 SHAs with a
     "as of v0; refresh on every chain update" note. Also: the
     `/orchestrate` re-grounding step always re-reads the
     playbook + CLAUDE.md, which would surface a chain
     rotation.
  3. `detail-page-snapshot-design` has only 1 instance and
     might encode the C-001 idiosyncrasies as universal rules.
     **Mitigation**: write the skill body in terms of the
     pattern (read end-to-end, find the existing slot, propose
     additive change) rather than the C-001 specifics
     (manifest provenance, OY warm session, etc.). Defer the
     ship to the second design-only ticket so we have N=2.
  4. Adding the evolve-loop to §12 might clutter the monthly
     retrospective. **Mitigation**: 2 line items, terse.
     Re-evaluate at the first month-end where the loop fires.
- **Estimated turn count**: 2-3 dispatches (one implementation
  subagent for the 3 skill files, one product-strategy subagent
  for the §12 playbook edit, optionally one qa-regression
  subagent for the skill dry-runs). Larger than H-002 but still
  tight.

### Phasing rationale

H-002 ships the skills with the strongest precedent (board-closeout
N=2, fixture-drift-triage N=1 with tight scope) and the lowest
abstraction risk. H-003 ships the harder skills (forensics,
review, design) where premature codification is more likely. The
phasing intentionally creates a 1-week gap between H-002 and
H-003 so we can observe whether the H-002 skills are actually
used, before extracting more.

---

## 10. Risks / open questions

### Risks

1. **Premature codification** (highest). N for each pattern:
   board-closeout = 2, fixture-drift-triage = 1, smoke-collection-
   forensics = 1, instagram-public-education-review ≈ 0 (Post 001
   shipped without the skill formalised), detail-page-snapshot-
   design = 1. We have ~1 week of orchestration data. The
   abstractions might encode session-specific noise as rules.
   **Mitigation**: phase into H-002 (lower risk) and H-003
   (higher risk); review skill usage at each monthly
   retrospective; retire skills not invoked in 60 days.

2. **Skill explosion**. If we add 5 skills and then 5 more in 2
   months, the operator faces a routing problem (which skill
   applies?). The Expert Pool pattern (§4.5) already has 4
   subagent types; layering 10 skills on top creates a
   combinatorial dispatch decision. **Mitigation**: keep skills
   single-purpose with explicit "when to skip" guidance; the
   monthly retrospective retires unused ones; the playbook §12
   evolve-loop counts skills.

3. **Convention drift**. The playbook §5 filesystem handoff
   protocol was adopted in `daf8668` (A-002) and is consistently
   honored across 8 handoffs in this session. But conventions
   that aren't enforced by code can drift after months without a
   discipline reminder. **Mitigation**: the §12 weekly review
   already includes a §7-last-block policy consistency check;
   add a "handoff format spot-check on 1 random closed ticket"
   to that.

4. **Multi-worktree vs. native-subagent mode confusion**. The
   playbook §3 multi-worktree mode and §11 native subagent mode
   coexist. A skill written assuming native mode may not behave
   correctly when invoked from a multi-worktree worktree, and
   vice versa. **Mitigation**: every skill body must name
   which mode(s) it supports. Default: both (the skill is
   filesystem-mediated like everything else). Edge cases get
   called out explicitly.

5. **Subagent definition vs. skill drift**. If a skill's
   forbidden file scope grows tighter than the subagent's
   forbidden file scope, the operator sees a confusing
   "subagent says X is allowed, skill says X is forbidden"
   conflict. **Mitigation**: skills MUST be a SUBSET of their
   host subagent's permissions. The skill cannot widen
   permissions; it can only narrow them.

### Open questions

1. **Should the evolve loop be operator-only or can it be
   agent-proposed?** §5 of this design defaults to
   operator-only (convention-only at the monthly
   retrospective). The alternative is an agent-proposed
   pattern-extraction triggered by a grep over
   `ops/agent_handoffs/`. Operator-proposed avoids the
   self-justifying-skill feedback loop (see §5). Agent-proposed
   is faster but riskier. **Punt to H-003 retrospective.**

2. **Should the four-tier evaluation matrix become enforced via
   hooks?** §8 of this design splits the matrix; the existing
   `.claude/hooks/` directory could host a pre-handoff hook
   that runs Tier 1 + parts of Tier 3 mechanically. But hooks
   add machinery, and the existing convention-only enforcement
   has held across 8 session handoffs. **Recommend: stay
   convention-only for v1; promote to hooks if a real
   convention drift is observed.**

3. **How does the harness interact with multi-worktree mode vs.
   native subagent mode?** Risk #4 above. Current answer: both
   modes are filesystem-mediated, so skills work in either; an
   `.claude/skills/<name>.md` file is read-by-name in the
   `/orchestrate` prompt regardless of where the subagent runs.
   **But** the multi-worktree mode read pattern (`cat
   ../aiagent-<role>/ops/agent_handoffs/<ticket-id>.md`) is
   not symmetrical with native mode (`cat
   ops/agent_handoffs/<ticket-id>.md`). A skill that hardcodes
   the path style is wrong. **Convention**: skills MUST use
   relative paths; the `/orchestrate` re-grounding step
   resolves the worktree.

4. **Should the harness ever stage / commit skill files
   automatically?** No. Even skill files (which are pure
   conventions) go through operator commit (playbook §6 #1).
   This is the same rule applied to the playbook itself
   (Appendix "No autonomous commits"). The harness inherits
   that rule, no exceptions.

5. **Does the harness need a versioning convention?** The
   playbook is at v1.0 (header). This design doc is at v0.
   Skills are unversioned today. Open question: when a
   skill's body changes materially, is that a v-bump or a
   plain edit? **Recommend: edit + a `Last revised:` date in
   the skill body, no v-numbers, until the count of skills
   grows past ~5.**

---

## 11. Concrete example walkthrough — Q-001 through the harness

This is the "does the design fit reality" check. Walk Q-001
(buyer_journey drift triage) through every harness section to
verify the design covers the actual orchestration shape.

### Section walk

- **Operator goal** (verbatim from O-A-Q001.md lines 11-21): "Triage
  the buyer_journey drift test failure. Read-only."
- **§1 Purpose**: Q-001 is a routine pattern (read-only triage →
  recommend one fix path). The harness's purpose includes
  recognising this pattern as recurring (Q-001 + I-OY-RATING-
  SORTS = 2 instances).
- **§3 Current agent system summary**: Q-001 ran in §11 native
  subagent mode (single session, qa-regression subagent), per
  O-A-Q001.md line 6. No multi-worktree.
- **§4.1 Supervisor**: orchestrator dispatched 1 read-only
  subagent, read its handoff file, synthesised the verdict at
  `ops/agent_handoffs/O-A-Q001.md`. Worked.
- **§4.3 Pipeline (triage pipeline)**: Q-001 (qa) → O-A-Q001
  (orchestrator) → I-Q001-A (impl) → O-A-IQ001A (orchestrator
  close). 4-stage pipeline, file-mediated, no chat dependency.
  Worked.
- **§5 Ouroboros loop**:
  - Seed: §10 ticket Q-001 spec, with explicit "in/out" scope
    (lines 808-813).
  - Execute: qa-regression subagent ran read-only triage,
    wrote `ops/agent_handoffs/Q-001.md` (269 lines).
  - Evaluate: orchestrator §7 review, recorded at
    `ops/agent_handoffs/O-A-Q001.md` (118 lines).
  - Closeout: operator commit `7cea019` (test add); board
    update `aa8cb96` chore.
  - Evolve: **NOT YET** — Q-001's pattern (read-only triage →
    one fix path with 4-path blast-radius table) has not
    crystallised as the `fixture-drift-triage` skill yet.
    H-002 fills this gap.
- **§6.3 fixture-drift-triage skill**: would have shaped Q-001's
  handoff body verbatim. Operator's dispatch would shorten to
  the one-line example in the skill spec, instead of the full
  constraint block. Net savings: ~15 lines of dispatch prompt,
  and a guarantee that the 4-category framework + 4-path blast-
  radius table are present.
- **§7 Human-gated actions**:
  - Commit gate (#1): orchestrator drafted commit message at
    O-A-IQ001A.md lines 96-128; operator committed `7cea019`.
    Worked.
  - All other gates: not-attempted.
- **§8 Evaluation gates**:
  - Tier 1 Mechanical: `pytest tests/test_content/test_cardnews_buyer_journey.py -q` → 12 passed; broader `tests/test_content/` → 1129 passed. Pass.
  - Tier 2 Semantic: orchestrator caught the "git nuance" — the file was untracked, so the `M`-vs-`A` framing matters for commit-message subject. Pass.
  - Tier 3 Policy: §6 protected files unedited (`git diff
    --name-only` empty for tracked files; the only edit was
    `tests/test_content/test_cardnews_buyer_journey.py` which
    is not §6 protected). Pass.
  - Tier 4 Operator: operator approved the commit; commit
    landed as `7cea019`. Pass.
- **§10 Risk #1 (premature codification)**: with N=1 for
  fixture-drift-triage at the time, codifying the skill is
  speculative. The design defers to H-002 (acceptance criteria
  include dry-running on a synthetic ticket) to validate before
  the skill goes live.

### Findings from the walkthrough

The design fits Q-001's actual shape end-to-end. The two gaps
the harness fills are:

1. The "evolve" step (no skill exists yet to recognise Q-001's
   pattern as reusable; H-002 closes this).
2. The 4-tier evaluation matrix is implicit in Q-001's
   orchestration; promoting it to an explicit named tier (§8)
   makes Q-001's success replicable in future triages without
   relying on the orchestrator's tacit knowledge.

No section of the design was unused or didn't fit. No section
of Q-001 was unaddressed by the design.

---

## 12. Appendix — How this design differs from external Harness/Ouroboros

Honest comparison. The operator's "inspired by but not adopting
either wholesale" framing is the spine of this section.

### Adopt

1. **The vocabulary** — Supervisor, Producer-Reviewer, Pipeline,
   Fan-out/Fan-in, Expert Pool, seed → execute → evaluate →
   closeout → evolve. Naming patterns we already do is high-
   value, low-cost.
2. **The skill abstraction** — a small, named recipe with
   explicit allowed/forbidden tools and file scopes. Maps
   cleanly to `.claude/skills/*.md`.
3. **The "evolve" phase** — the explicit feedback that updates
   playbook / skills / agent definitions when the loop produces
   a new pattern. Today the playbook has no such phase; even
   convention-only adoption is an improvement.
4. **Producer-Reviewer for high-stakes outputs** — cardnews
   safety, PDF wording. We don't have a worked instance yet but
   the pattern is right for the shape.

### Reject

1. **External state stores** (queue, DB, kanban API). Conflicts
   with playbook §1.2 repo-on-disk truth invariant.
2. **Auto-commit / auto-stage defaults** that some external
   harnesses bake into the loop. Conflicts with playbook §6
   commit protocol rules #1-#8.
3. **Standing parallel-worker schedules** for fan-out. Conflicts
   with single-writer DB constraint and per-batch live-
   collection authorization rule.
4. **Auto-improvement loops that touch calibrated detector /
   aggregator / lexicon files**. Conflicts with CLAUDE.md §6
   protected areas; the playbook's protective discipline cannot
   survive an auto-tuning loop.
5. **Multi-tenant scaffolding** (queue/, workers/, scheduler/).
   Already paused per CLAUDE.md §6 + playbook Appendix; the
   harness inherits that pause.

### Under consideration

1. **Hooks-enforced Tier 1 + Tier 3 evaluation gates**. §10 open
   question #2. Convention-only for v1; promote if drift
   observed.
2. **Agent-proposed skill extraction** (vs. operator-only). §10
   open question #1. Operator-only for v1.
3. **Skill versioning** beyond a `Last revised:` date. §10 open
   question #5. Defer until skill count > 5.

The design is intentionally small. The playbook has done the
heavy lifting; the harness names what is already there, fills a
few specific gaps (the evolve loop, the 4-tier matrix, the
human-gated authorization status header), and proposes 5
candidate skills with explicit "when to skip" guidance. Nothing
in this design adds runtime, daemon, or auto-commit machinery.

---

**End of design.** H-002 / H-003 implementation tickets land at
operator discretion. This file is durable architecture reference;
the playbook remains canonical for ticket templates, handoff
protocols, commit protocols, and forbidden actions.
