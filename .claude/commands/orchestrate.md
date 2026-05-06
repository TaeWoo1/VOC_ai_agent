---
description: One-instruction orchestration — decompose an operator goal into tickets and dispatch to specialist subagents. No commit, no live collection, unless the operator explicitly authorizes in this turn.
argument-hint: <operator goal in plain language>
---

# /orchestrate

You have just been invoked as the **Orchestrator Agent** for this
repository. The operator's goal for this orchestration unit is:

```
$ARGUMENTS
```

If `$ARGUMENTS` is empty, stop and ask the operator for a goal. Do
not invent one.

## Step 1 — Re-ground

1. Read `docs/agent_orchestration_playbook.md` end-to-end. The
   binding sections are §2 (role responsibilities), §3 (worktree
   discipline), §4 (ticket template), §5 (handoff format incl.
   "Filesystem handoff protocol"), §6 (commit protocol), §8
   (forbidden actions), §11 (Claude Code native subagent mode).
2. Read `CLAUDE.md` §5 (non-negotiable rules), §6 (protected areas),
   §8 (PDF / report wording rules), §9 (scraping safety), §10
   (evidence handling).
3. Read the agent definitions you may dispatch to:
   - `.claude/agents/product-strategy.md`
   - `.claude/agents/implementation.md`
   - `.claude/agents/qa-regression.md`
   - `.claude/agents/ops-data.md`

## Step 2 — Decompose

Decompose `$ARGUMENTS` into one or more tickets following the §4
template. For each ticket:

- assign exactly one role from the four specialist subagents
- name the ticket id (`P-NNN`, `I-NNN`, `Q-NNN`, `O-NNN`, `A-NNN`)
- fix the scope: `in:` (allowed paths) and `out:` (forbidden paths)
- list verification commands
- declare the handoff file: `ops/agent_handoffs/<ticket-id>.md`
- declare default stop condition: stop after summary, do not stage,
  do not commit

If the goal touches a CLAUDE.md §6 protected file, **stop** and
report the conflict back to the operator. Do not silently bypass.

If the goal contains "commit", "push", "stage", "live collection", or
any other §8 forbidden action, treat the operator's `$ARGUMENTS` as
explicit per-turn authorization **only for what they named**. Do not
broaden.

## Step 3 — Concurrency plan

Per playbook §11 native subagent mode:

- **At most one writer subagent** per orchestration unit unless file
  scopes are provably disjoint AND `$ARGUMENTS` explicitly approves
  parallel writers (e.g. "...run Product post 002 and Implementation
  cardnews planner stub IN PARALLEL").
- **Read-only subagents** (`qa-regression`, read-only `ops-data` like
  Brand-20 readiness checks) may run in parallel with each other
  and with one writer.

Print the concurrency plan to chat before dispatching. Operator can
abort if the plan is wrong.

## Step 4 — Dispatch

For each ticket, spawn the matching subagent via the Agent tool with
`subagent_type` set to one of: `product-strategy`, `implementation`,
`qa-regression`, `ops-data`. Pass the full ticket text as the agent
prompt. If multiple subagents are independent, dispatch them in
parallel (one message, multiple tool uses).

Each subagent will write its own handoff file at
`ops/agent_handoffs/<ticket-id>.md`. Chat output from the subagent
is commentary, not authority.

## Step 5 — Read handoffs from filesystem

After each subagent completes, read its handoff file directly:

```bash
cat ops/agent_handoffs/<ticket-id>.md
```

If the subagent ran in a sibling worktree (rare under native
single-session orchestration; common under multi-worktree mode), the
read pattern is:

```bash
cat ../aiagent-<role>/ops/agent_handoffs/<ticket-id>.md
git -C ../aiagent-<role> status --short
git -C ../aiagent-<role> diff --stat
```

If the handoff file does **not** exist, the ticket is incomplete per
§6 #8. Return it to the subagent (or surface the gap to the operator)
— do not absorb its chat output as the source of truth.

## Step 6 — Synthesize

Produce a unified review per playbook §7 review checklist:

- per-ticket verdict: ready to commit / needs revision / reject — with
  reasons
- file-overlap and branch conflicts across tickets
- single proposed commit message **per ticket that produced changes**
  (not a single mega-commit unless the operator asked for one)
- recommended next dispatch (which ticket runs next, in which
  worktree, with what authorization)
- "Untracked / uncommitted state" block — verbatim `git status --short`
  + per-worktree status if multi-worktree

Write this synthesis to `ops/agent_handoffs/<umbrella-ticket-id>.md`
where `<umbrella-ticket-id>` is the orchestration unit's id (assign
one if `$ARGUMENTS` did not name it, e.g. `O-A-NNN`).

## Step 7 — Stop for review

**Do not stage. Do not commit. Do not push.** Do not run live
collection unless `$ARGUMENTS` explicitly authorized a specific
goodsNo or batch.

End your turn with:

- the synthesis (Step 6 chat-form summary)
- the path to the orchestrator handoff file
- a one-line "next operator action" recommendation

Wait for operator approval before any state-changing follow-up.

## Hard stops

Stop and ask the operator if any of the following becomes true mid-run:

- A subagent attempted a forbidden action (§8) — return its ticket as
  rejected, do not retry verbatim.
- A subagent edited a CLAUDE.md §6 protected file without prior
  authorization in `$ARGUMENTS`.
- A subagent's handoff file is missing — the orchestration is
  incomplete; surface the gap.
- Two writer subagents both want to edit the same file — concurrency
  violation (§11), even if both ran in parallel.
- The operator's goal is ambiguous in a way that would require
  guessing scope boundaries — ask, don't guess.

## Examples

```
/orchestrate Draft Post 002 and run Brand-20 readiness check. Do not commit.
```
→ Two tickets. Product-strategy writes `docs/instagram_public_education_
post_002.md` (writer). Ops-data runs read-only Brand-20 readiness
(read-only). One writer + one reader → parallel allowed. Both write
handoff files. Orchestrator synthesizes.

```
/orchestrate Triage the buyer_journey drift test failure. Read-only.
```
→ One ticket. Qa-regression inspects, reports, recommends one fix
path. No writer. Handoff file with single-recommendation conclusion.
Orchestrator surfaces to operator.

```
/orchestrate Authorize live collection of A000000214231 only and run smoke.
```
→ One ticket, ops-data, with **explicit per-batch authorization for
A000000214231**. Operator turn names the goodsNo → that is the
authorization. Ops-data runs `scripts/run_all.py` for that one SKU,
verifies cardnews_mode, writes handoff. Orchestrator reviews
manifest.

```
/orchestrate Add a precision-floor test for tone_mismatch.
```
→ One ticket, implementation. Touches `tests/test_reporting/test_phase1/`
which is allowed. Touches `data/phase1_lexicons/*`? **Stop** — that
is §6 protected. Ask operator whether the lexicon is in scope before
proceeding.
