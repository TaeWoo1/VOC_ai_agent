# Agent Orchestration Playbook

> **What this is**: a lightweight operating model for running this repo
> as a small AI-assisted company. It defines who does what, how
> handoffs are formatted, what is forbidden, and how the operator
> stays in control without doing every task by hand.
>
> **What this is NOT**: a multi-agent framework, a daemon, an
> autonomous swarm. Every meaningful state change still passes through
> the **operator**, the **repo**, and **git commits**. Agents are
> instruments; the repo is the source of truth.
>
> **Playbook version**: v1.0 (2026-05-06)

---

## 1. Operating model

### Roles (5 named)

| # | Role | Type | Active in repo as |
|---|---|---|---|
| 1 | **Founder / Operator** | Human (you) | Final authority. All commits, pushes, billing, brand promises. |
| 2 | **Orchestrator Agent** | Claude session | Triages tasks, dispatches to specialists, reviews handoffs, drafts commits for operator approval. Owns no domain. |
| 3 | **Product / Strategy Agent** | Claude session | Writes strategy docs, content manuscripts, editorial. Owns `docs/instagram_*`, posts, checklists. |
| 4 | **Implementation Agent** | Claude session | Writes code, refactors, adds tests. Owns `src/`, `cardnews/`, code under `scripts/`. |
| 5 | **QA / Regression Agent** | Claude session | Runs tests, reads diffs, reports drift. Read-mostly. Owns no source. |
| 6 | **Ops / Data Agent** | Claude session | Runs collection (when authorized), inspects runs, manages `configs/`, `data/`, `outputs/`. |

### Source of truth

- **Repo on disk** = canonical state. If something is not in a file
  here, it doesn't exist for purposes of operations.
- **Git commits** = audit log. Every meaningful decision lands as a
  commit (or a doc revision committed as a doc commit). The 6 policy
  source SHAs in §9 are the proof of this — anyone can replay how the
  brand reached its current state by reading commit history.
- **Operator session** = authority. Agents propose; the operator
  decides. No agent stages, commits, pushes, or runs collection
  without an explicit operator turn.

### Why this model

- **Small operation reality**: 1 operator, 5 specialist hats. We can't
  pretend to be a 50-person company. The operating model is shaped to
  match.
- **AI is leverage, not replacement**: each agent is a Claude session
  with a focused role and constrained scope. Their output is reviewed
  by the operator (and sometimes by a peer agent) before it changes
  anything material.
- **Repo-centric**: state is on disk + in git. No external task
  tracker is required for v1.0; ticket markdown lives in the same
  repo (see §10 board).

---

## 2. Agent roles and responsibilities

For each non-Operator role: what it owns, what it does NOT own, file
allowlist / blocklist, required output format.

### 2.1 Orchestrator Agent

- **Owns**: task dispatch decisions, handoff acceptance/rejection,
  draft commit message authoring, version-doc cross-references.
- **Does not own**: domain expertise. Does not write content drafts,
  code, or eval runs itself except for trivial coordinative edits
  (e.g. linking a new doc into MEMORY.md, ticket-board updates).
- **Allowed files**: `docs/agent_orchestration_playbook.md` (this
  doc), the `## 10. Initial agent board` section, `MEMORY.md`-style
  pointers if needed. Read access to everything.
- **Forbidden files/actions**: `src/voc/reporting/phase2e/{stage1,
  stage2,aggregate}.py`, `data/phase1_lexicons/*`, `eval_data/phase1/
  *` (CLAUDE.md §6 protected); does not push, does not run live
  collection.
- **Required output format** when accepting a handoff:
  ```
  Accepted: <ticket id> · <one-line summary>
  Files: <count> changed (link to commit message draft)
  Tests: <pass/fail summary>
  Risks: <none | <list>>
  Recommend operator commit as: <draft commit message>
  Next: <follow-up tickets to open, if any>
  ```

### 2.2 Product / Strategy Agent

- **Owns**: brand positioning, content pillars, post manuscripts,
  editorial guidance, publishing safety policy. Specifically:
  `docs/instagram_voc_brand_strategy.md`,
  `docs/instagram_public_education_post_*.md`,
  `docs/instagram_voc_publishing_checklist.md`,
  `docs/instagram_voc_dm_response_script.md`,
  `docs/instagram_voc_dm_conversion_ledger.md` (entries),
  future cardnews planner spec docs.
- **Does not own**: code under `src/`, `cardnews/`, `scripts/`. Does
  not modify `tests/`. Does not modify generated outputs in
  `outputs/`.
- **Allowed files**: `docs/instagram_*`, `docs/phase_b_public_
  education_planner_plan.md` (when written), other content/strategy
  docs.
- **Forbidden files/actions**: any code change, any test addition,
  any commit. May read code/tests to inform doc decisions; may not
  write code.
- **Required output format**: each doc edit lands as the doc itself
  + a structured patch summary:
  ```
  File: docs/<name>.md
  Sections changed: <list>
  Policy chain references: <SHAs cited>
  Word/line count delta: <approx>
  Compliance pre-check: <self-check matrix per the doc's safety rules>
  ```

### 2.3 Implementation Agent

- **Owns**: code, tests, schemas, CLI surfaces, the cardnews renderer,
  the safety validator, planners (when they land), connectors.
  Specifically: `src/voc/**`, `cardnews/**`, `tests/**`, code modules
  in `scripts/**`.
- **Does not own**: brand/content policy decisions, paid pricing,
  collection schedule, ops batch decisions.
- **Allowed files**: anything under `src/`, `cardnews/`, `scripts/`,
  `tests/`, `pyproject.toml`, `cardnews/OUTPUT_CONTRACT.md` and
  similar contract docs that travel with code.
- **Forbidden files/actions**:
  - CLAUDE.md §6 protected modules (`stage1.py`, `stage2.py`,
    `aggregate.py`, `phase1/signals.py`, `data/phase1_lexicons/*`,
    `eval_data/phase1/*` golden data) — these only change with an
    explicit, scoped operator request.
  - Live collection. Code that triggers scrape never runs from this
    role unless the operator opens a ticket asking for it.
  - Editing `outputs/<run>/*` artifacts. Generated outputs are
    re-derivable, never hand-edited.
- **Required output format**:
  ```
  Files modified: <list with line deltas>
  Tests added: <list>
  Tests run: <commands + pass/fail counts>
  Risks: <regressions considered, mitigations>
  Recommended commit message: <draft>
  ```

### 2.4 QA / Regression Agent

- **Owns**: test execution, regression analysis, drift detection,
  read-only inspector runs (`scripts/inspect_run_quality.py`).
  Produces reports, not code.
- **Does not own**: writing or modifying source modules. Does not
  modify production tests except to fix a clearly-incorrect assertion
  that the Implementation Agent has not yet touched (and even then,
  via a labelled QA ticket, not a fly-by edit).
- **Allowed files**: `outputs/` (read-only), test files (read-only by
  default; write only when fixing a tracked drift via a ticket), QA
  report markdown under `docs/qa/` (when needed; not yet present).
- **Forbidden files/actions**: any change to `src/`, `cardnews/`,
  `scripts/` source. Any commit. Any push.
- **Required output format**:
  ```
  Scope: <what was tested / inspected>
  Results: <pass/fail counts, regressions, drift flags>
  Surprises: <unexpected findings>
  Recommended ticket(s) for Implementation Agent: <list>
  Read-only verification commands run: <list>
  ```

### 2.5 Ops / Data Agent

- **Owns**: live collection runs (when authorized), Brand-20 batch
  preparation, configs in `configs/review_ops_brand20_*`, run-package
  inspection (`scripts/run_phase2e_pipeline.py`,
  `scripts/run_oy_collection_batch.py`,
  `scripts/republish_run.py`), data hygiene under `data/` (excluding
  protected lexicons).
- **Does not own**: code changes to connectors or reporting modules
  (those go to Implementation Agent). Does not write strategy or
  content. Does not modify `cardnews/` source.
- **Allowed files**: `configs/`, `outputs/<run>/` (write — these are
  generated artifacts), batch shell scripts that compose existing
  CLIs, ops-facing markdown under `docs/oliveyoung_*`,
  `docs/phase2_*`, `docs/phase3_*` (the operational notes backlog).
- **Forbidden files/actions**:
  - **Live collection without explicit operator authorization on a
    per-batch basis.** Even when authorized, must check
    `cardnews/safety_validator.py::validate_cardnews_mode` is in the
    code path so private_demo enforcement holds (per `a2b2ae6`).
  - Modifying `data/phase1_lexicons/*` (CLAUDE.md §6 protected).
  - Modifying `eval_data/phase1/{phase1_signals_golden,
    phase1_signal_map,baseline.md}` (CLAUDE.md §6 protected).
  - Hand-editing PNGs / PDFs under `outputs/<run>/`. If the artifact
    is wrong, fix the producing code via the Implementation Agent
    and re-render.
- **Required output format**:
  ```
  Action: <collection / inspection / config edit>
  Inputs: <CDP profile, brand, goodsNo, etc.>
  Outputs: <run_dir paths, manifest paths>
  Quality flags: <inspector findings, partial_success status>
  Authorization reference: <operator turn or ticket id that opened this>
  ```

---

## 3. Worktree / branch discipline

**One worktree per active specialist.** Multiple agents in the same
working directory will collide on file state. Git worktrees give each
agent its own checkout pointing at a different branch.

### Recommended worktree layout

```
~/Downloads/workspace/
  aiagent/                 ← main worktree (operator + Orchestrator)
                             checked out: main
  aiagent-product/         ← Product/Strategy Agent worktree
                             checked out: product/<topic-branch>
  aiagent-impl/            ← Implementation Agent worktree
                             checked out: impl/<topic-branch>
  aiagent-qa/              ← QA Agent worktree
                             checked out: qa/<topic-branch>
  aiagent-ops/             ← Ops/Data Agent worktree
                             checked out: ops/<topic-branch>
```

Create with:

```bash
# from the main worktree
git worktree add ../aiagent-product -b product/post_002
git worktree add ../aiagent-impl    -b impl/cardnews_phase_b_planner
git worktree add ../aiagent-qa      -b qa/buyer_journey_drift_triage
git worktree add ../aiagent-ops     -b ops/brand20_batch_run_005
```

Cleanup when a topic branch lands or is abandoned:

```bash
git worktree remove ../aiagent-<role>
git branch -D <branch>   # if abandoned; merged branches removed via PR review
```

### Branch naming convention

`<role-prefix>/<short-topic>` — lowercase, underscores or hyphens,
no spaces.

| Role prefix | Used by | Example |
|---|---|---|
| `product/` | Product/Strategy Agent | `product/post_002` |
| `impl/` | Implementation Agent | `impl/cardnews_phase_b_planner` |
| `qa/` | QA Agent | `qa/buyer_journey_drift_triage` |
| `ops/` | Ops Agent | `ops/brand20_batch_run_005` |
| `chore/` | Orchestrator (cross-cutting tidy) | `chore/agent_board_refresh` |

`main` is always the integration branch. Operator merges via fast-forward
or squash after handoff acceptance — agents never merge directly.

### Cross-worktree rules

- **Never run two agents in the same working directory.** File-state
  races silently corrupt diffs.
- **Never operate on `main` from a non-main worktree.** Specialists
  always live on their topic branch.
- **Pulling new `main` into a topic worktree** is a deliberate act
  via `git pull --rebase origin main` (or local equivalent), done by
  the agent at the start of a fresh task — never automatically.

---

## 4. Task ticket template

Every operator → agent dispatch lands as a ticket. Tickets live in
`§10 Initial agent board` (this doc) for the v1.0 starter set; later,
`docs/agent_board.md` if the volume grows.

```markdown
### <ticket-id> — <one-line summary>

- **role**: <Product | Implementation | QA | Ops | Operator>
- **status**: <todo | in-progress | review | done | blocked>
- **goal**: <one or two sentences of intent>
- **context**: <why now; upstream policy SHAs; related tickets>
- **scope**:
  - in: <files / paths the agent MAY touch>
  - out: <files / paths the agent MUST NOT touch>
- **requirements**:
  - <bullet list of concrete deliverables, in operator's words>
- **commands** (verification / test gates):
  - <pytest / grep / inspector commands the agent must run before handoff>
- **output**:
  - <markdown file written | code patch | report | yaml ledger row>
- **handoff file**: `ops/agent_handoffs/<ticket-id>.md` (required; see
  §5 "Filesystem handoff protocol")
- **stop conditions**:
  - <when to stop and ask vs when to continue>
  - default: stop after summary, do not stage, do not commit
```

Tickets are immutable once accepted (status moves through todo →
in-progress → review → done|blocked). Scope changes happen by closing
the current ticket and opening a new one — never silently broaden
scope mid-ticket.

---

## 5. Handoff format

Every agent → operator handoff carries the same payload, regardless
of role. This makes operator review fast and uniform.

```markdown
## Handoff — <ticket-id>

### Files changed
- <path:lineN> — <one-line change summary>
- <path:lineN> — <one-line change summary>
- (or: "no files changed; report only" for QA-only tickets)

### Tests run
- <command 1> → <N passed, M skipped, K failed>
- <command 2> → ...
- (or: "no tests in scope" for doc-only tickets)

### Risks
- <considered regression / known weakness / deferred item>
- (or: "none identified")

### Proposed commit message
```
<type>(<scope>): <subject line>

<body explaining what / why / what this is NOT>

<verification block>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Next recommendation
- <follow-up ticket(s) to open after operator approval>

### Untracked / uncommitted state
- Staged: <list or "none">
- Unstaged tracked changes: <list or "none">
- Untracked: <list or "none in scope; backlog items remain — see git status">
```

The "Untracked / uncommitted state" block is **mandatory**. The
operator must always know what is on disk that has not been committed.

### Filesystem handoff protocol

The chat-form payload above is **commentary**, not the handoff. The
orchestrator runs in the main worktree and cannot see other Claude
sessions; it can only see files. Therefore:

- **Chat output is not the source of truth.** Repo-on-disk is (per
  §1.2 "Source of truth"). A sub-agent that reports only in chat has
  not handed off.
- **Every sub-agent must write a handoff file** to
  `ops/agent_handoffs/<ticket-id>.md` inside its own worktree. Create
  the directory if missing:
  ```bash
  mkdir -p ops/agent_handoffs
  ```
- **The handoff file must include**, at minimum:
  - ticket id
  - role
  - worktree path (absolute, e.g. `/Users/<you>/Downloads/workspace/aiagent-product`)
  - branch (`git rev-parse --abbrev-ref HEAD`)
  - files changed
  - commands run
  - test results
  - risks
  - proposed commit message
  - next recommendation
  - `git status --short` output (verbatim)
  - `git diff --stat` output (verbatim)

  The fields above are a superset of the §5 chat payload — the
  on-disk handoff is what the orchestrator actually reads.

- **Orchestrator read pattern.** The orchestrator (or operator
  directly) reads the handoff file from the sibling worktree
  without entering it:
  ```bash
  cat ../aiagent-product/ops/agent_handoffs/P-001.md
  git -C ../aiagent-product status --short
  git -C ../aiagent-product diff --stat
  ```
  These three commands are the canonical inspection set: the file
  for narrative + metadata, `git status --short` for working-tree
  state, `git diff --stat` for change shape.

- **File hygiene.**
  - Handoff files are **untracked by default**. They are **not**
    staged unless the operator explicitly asks to commit them.
  - They may be deleted after the ticket is closed, or archived
    into `docs/agent_handoffs_archive/` if the contents are useful
    for future reference.
  - `ops/agent_handoffs/` is expected to appear under "Untracked"
    in the §5 chat-form "Untracked / uncommitted state" block;
    that is normal, not a leak.

---

## 6. Commit protocol

Hard rules for the commit step:

1. **Patch first, commit only after explicit operator approval.**
   Agents never commit on their own initiative. The handoff proposes
   a commit message; the operator either accepts (responds with
   "proceed to commit ..." or equivalent) or rejects/revises.
2. **Never `git add .` or `git add -A`.** Stage every file
   explicitly by path. The operator's "Stage only:" list in dispatch
   is binding.
3. **Never `git commit -a`.** Same reason — stages everything
   modified, not what was reviewed.
4. **No unrelated files.** If a stray edit appears in `git status`
   that is outside the ticket's scope, do not stage it. Flag it in
   the handoff under "Untracked / uncommitted state" and let the
   operator decide.
5. **Run the test gate before commit.** Every code change runs
   `pytest tests/<scoped path> -q` plus the broader regression
   (`pytest tests/ --ignore=<known-failing>`). Doc-only changes have
   no test gate but still run any documented grep / lint on the
   touched file.
6. **Verify exclusions.** Before committing, run a `git diff --cached
   --name-only | grep -E '<excluded patterns>'` and confirm zero
   matches. The pattern list is the union of the dispatch's "Do not
   stage" items and the standing backlog (probe scripts, buyer_journey
   test, docs backlog, figma_plugin, .mcp.json, misc data).
7. **Show `git log --oneline -1` and `git status --short` after the
   commit** so the operator can confirm the SHA and the residual
   working tree state in the same handoff.
8. **Handoff file is the completion gate.** A ticket is **not
   complete** unless `ops/agent_handoffs/<ticket-id>.md` exists in
   the agent's worktree and follows the §5 "Filesystem handoff
   protocol" payload. Chat-only reports are commentary, not
   handoffs. The orchestrator (or operator directly) reads the file
   via `cat ../aiagent-<role>/ops/agent_handoffs/<ticket-id>.md`
   before accepting the ticket. If the file is missing, the agent
   has not handed off — return the ticket with "no handoff file
   found" and let the agent re-emit on disk.

---

## 7. Review protocol

### Orchestrator review checklist (acceptance criteria for any handoff)

- [ ] Handoff follows §5 format (all 6 sections present).
- [ ] Files changed are within ticket scope.
- [ ] Tests run and pass (or fail flagged with mitigation).
- [ ] Proposed commit message names the ticket-id and the scope.
- [ ] No forbidden actions (§8) attempted.
- [ ] No protected files (CLAUDE.md §6, lexicons, golden data) edited
      without an explicit operator-scoped request.
- [ ] "Untracked / uncommitted state" block is present and accurate.
- [ ] Next recommendation is a real next step, not vague.

### QA review checklist (when QA agent reviews an Impl handoff)

- [ ] Test additions cover both happy path and at least one failure
      path.
- [ ] Existing test count unchanged or grown (no silent test
      deletion).
- [ ] CLAUDE.md §6 protected tests untouched (no edits to
      `tests/test_reporting/test_phase2e/test_pass5_acceptance.py`
      assertions, no edits to golden-data tests).
- [ ] Schema-version bumps paired with manifest contract updates.
- [ ] Regression run completed (`pytest tests/ --ignore=<known-failing>`).

### Generated artifact checks (for Ops/Data handoffs)

- [ ] Run-package layout matches `cardnews/OUTPUT_CONTRACT.md`.
- [ ] Manifest carries the expected `schema_version` (currently 1.1
      for cardnews render; 1.2/1.3 for run-root).
- [ ] `cardnews_mode` field present and equals `"private_demo"`
      (per `a2b2ae6`).
- [ ] Inspector run (`scripts/inspect_run_quality.py --run-dir <path>`)
      reports no quote-quality regressions.

### Policy / code consistency checks (Orchestrator periodic, weekly)

- [ ] Every committed `docs/instagram_*` doc cites its policy source
      SHAs in the front-matter.
- [ ] `safety_validator._ALLOWED_CARDNEWS_MODES_TODAY` matches the
      "Cardnews mode dispatch" table in `cardnews/OUTPUT_CONTRACT.md`.
- [ ] DM script (`7879a7d`) Template F has no `[HOLD]` (post in-place
      v1.0 patch) or any new `[HOLD]` accidentally introduced.
- [ ] `bc17ed4` ledger §7 active leads matches reality (no
      published-but-unlogged DMs).

---

## 8. Forbidden commands / actions

The following are **never** allowed for any agent without an
explicit, ticket-scoped operator authorization. Authorization
language must be unambiguous (e.g. "Proceed to push", "Authorize
live collection of A000000XXXXXX").

| Action | Why forbidden by default |
|---|---|
| `git add .` / `git add -A` | Stages everything modified, including unrelated edits. Violates §6 #2. |
| `git commit -a` | Same — stages everything modified. Violates §6 #3. |
| `git push` (any remote) | Push is an operator-only act. Pushing without operator turn skips the operator review gate. |
| `git reset --hard`, `git clean -fd` | Destructive; can erase uncommitted work. Operator-only and only with explicit per-instance authorization. |
| `git rebase` (interactive or not) on `main` | History rewriting; operator-only. |
| Live collection (`scripts/run_oy_collection_batch.py`, OY browser API connectors with real CDP attach) | Each batch is a compliance + UA + rate-limit problem. Per-batch authorization, not standing. |
| Editing `outputs/<run>/*` artifacts | Generated; never hand-edited. Fix producing code instead. |
| Editing CLAUDE.md §6 protected files (lexicons, golden data, phase2e detector/aggregate, eval baseline, IMPACTS_KO/RECOMMENDATIONS_KO/etc.) | Calibration drift cascades; explicit scoped request only. |
| `pip install <new package>` without ticket | Adds a runtime dependency invisible to operator review. Goes through a ticket that updates `pyproject.toml`. |
| Running anything that touches paid LLM API quota beyond a single small smoke | Cost discipline. Larger runs (eval, polish-mode batches) need explicit authorization. |

When in doubt: **stop and ask**. The friction of asking is always
smaller than the friction of an unwanted side effect.

---

## 9. Current project policy sources

These SHAs are the binding policy chain for the Instagram VOC brand
operations. Every Product, Implementation, and Ops decision that
touches the brand surface must reconcile against this chain.

| SHA | Title | Role |
|---|---|---|
| `108888e` | `docs/instagram_voc_brand_strategy.md` | Brand positioning + 3-mode taxonomy + locked v0.1 decisions. |
| `648b728` | `docs/instagram_public_education_post_001.md` | First manifesto manuscript + locked CTA wording (`source_post_id` seed). |
| `6dc8a0f` | `docs/instagram_voc_publishing_checklist.md` | 14-row safety gate + automation gating rule (§8.3) for any public post. |
| `a2b2ae6` | `feat(cardnews): cardnews_mode private_demo guard` | Code-side enforcement: every cardnews artifact carries `cardnews_mode` (default `private_demo`); manifest schema 1.0→1.1. |
| `7879a7d` | `docs/instagram_voc_dm_response_script.md` | Inbound DM funnel handler — 6 templates, 12-row pre-send checklist, locked CTA wording. |
| `bc17ed4` | `docs/instagram_voc_dm_conversion_ledger.md` | Lead → outcome tracking, weekly Friday review routine, bidirectional feedback loop into post manuscripts and policy. |

When this list changes (new strategy revision, Phase B planner
landing, etc.), update §9 in the same commit that lands the new SHA.

---

## 10. Initial agent board

Starter ticket set as of 2026-05-06. Format follows §4. Status starts
at `todo` until operator dispatches.

### A-001 — lock Template F pricing-language patch

- **role**: Operator (decision needed) → Product (execution)
- **status**: **done** (closed 2026-05-06)
- **closed_by**: `be54569 docs(instagram): lock Template F pricing language`
- **closed_at**: 2026-05-06
- **decision recorded**: v1.0 final without numeric price bands.
  Numeric bands explicitly deferred to a future v1.1 revision after
  first paid-conversion data stabilizes per `bc17ed4` §6 weekly
  review (per `7879a7d` Appendix A "v1.1 candidate — numeric price
  bands" item).
- **goal** *(historical)*: Decide whether v1.0 of `docs/instagram_voc_
  dm_response_script.md` Template F (currently no numeric prices) is
  the final shippable form, or whether to draft a v1.1 with a numeric
  price band.
- **context** *(historical)*: Template F was patched in-place during
  v1.0 to remove the `[HOLD: 견적 범위]` blocking placeholder. The
  current text defers numeric prices to a future v1.1 revision per
  Appendix A. Operator has not yet decided whether v1.1 is needed for
  first publish, or only after first paid conversions stabilize the
  bands.
- **scope**:
  - in: `docs/instagram_voc_dm_response_script.md` (Template F + Appendix A only, if v1.1 is decided)
  - out: any other doc, any code
- **requirements**:
  - Operator decision: "v1.0 final, ship as is" OR "draft v1.1 with
    numeric bands now". If the latter, also: numeric bands per
    package (sample / pilot / monthly).
- **commands**:
  - none (decision-only)
- **output**:
  - operator turn that picks one of the two options
- **stop conditions**:
  - decision made → close as `done`
  - decision deferred → keep as `blocked-on-operator-decision`

### A-002 — add filesystem handoff protocol

- **role**: Orchestrator Agent
- **status**: **done** (closed 2026-05-06)
- **closed_by**: `daf8668 chore(agents): add handoff protocol and Claude subagent setup`
- **closed_at**: 2026-05-06
- **decision recorded**: filesystem handoff protocol landed; chat-only
  reports are incomplete. The §5 "Filesystem handoff protocol"
  subsection requires every sub-agent to write
  `ops/agent_handoffs/<ticket-id>.md`; the §4 ticket template carries
  a `handoff file:` field; the §6 commit-protocol rule #8 makes a
  missing handoff file a hard incomplete signal.
- **goal** *(historical)*: Update §5 of this playbook so sub-agent
  outputs are not chat-only — every sub-agent must write a handoff
  file the orchestrator can read directly from sibling worktrees.
- **context** *(historical)*: P-001 and O-001 were running in
  separate worktrees and the orchestrator session in main could not
  see other Claude sessions without operator-pasted excerpts.
  Filesystem-mediated handoffs make repo-on-disk the single source
  of truth for cross-session work, in line with §1 "Source of truth".
- **scope**:
  - in: `docs/agent_orchestration_playbook.md`
  - out: code, tests, instagram docs, configs, generated artifacts,
    `.mcp.json`, `figma_plugin/`, probe scripts, buyer_journey test
- **output**:
  - new §5 subsection "Filesystem handoff protocol"
  - §4 ticket template carries a required `handoff file:` field
  - §6 commit-protocol rule #8: missing handoff = incomplete ticket
- **stop conditions**:
  - patch reviewed → committed in `daf8668` (bundled with A-003)

### A-003 — add Claude Code native subagent setup

- **role**: Orchestrator Agent
- **status**: **done** (closed 2026-05-06)
- **closed_by**: `daf8668 chore(agents): add handoff protocol and Claude subagent setup`
- **closed_at**: 2026-05-06
- **decision recorded**: Claude Code native subagent setup tracked;
  `/orchestrate` available. Five subagent definitions (`orchestrator`,
  `product-strategy`, `implementation`, `qa-regression`, `ops-data`)
  plus the `/orchestrate` slash command live under `.claude/agents/`
  and `.claude/commands/`. `.gitignore` was narrowed so the shared
  agent definitions and `/orchestrate` are version-controlled while
  local `.claude/settings*.json`, `.claude/skills/`, and the
  placeholder commands `close-ticket.md` / `review-handoffs.md`
  remain per-clone.
- **goal** *(historical)*: Add repo-local Claude Code subagent
  definitions and an `/orchestrate` slash command so the operator can
  give one instruction to an orchestrator that delegates to specialist
  subagents — the single-session counterpart to §3 multi-worktree mode.
- **context** *(historical)*: §3 multi-worktree mode is the right
  shape for heavy multi-turn work but adds friction for small,
  well-scoped goals. Claude Code's built-in subagent mechanism plus a
  custom slash command provides a parallel single-session option
  without replacing worktree discipline.
- **scope**:
  - in: `.claude/agents/{orchestrator,product-strategy,implementation,qa-regression,ops-data}.md`,
    `.claude/commands/orchestrate.md`,
    `docs/agent_orchestration_playbook.md` §11, `.gitignore` narrow
    exception block
  - out: code under `src/`/`cardnews/`/`scripts/`, tests, instagram
    docs, generated artifacts, other `.claude/` files (settings,
    skills, placeholder commands)
- **output**:
  - 5 subagent definitions + 1 slash command tracked under `.claude/`
  - new §11 "Claude Code native subagent mode" in playbook
  - prior §11 Maintenance cadence renumbered to §12
  - narrow `.gitignore` exception block keeping settings, skills, and
    placeholder commands per-clone
- **stop conditions**:
  - patch reviewed → committed in `daf8668` (bundled with A-002)

### P-001 — Post 002 manuscript draft

- **role**: Product / Strategy Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `0a3403e docs(instagram): draft public education post 002`
- **closed_at**: 2026-05-07
- **decision recorded**: Post 002 accepted as-is using the liberal
  citation pattern; `6dc8a0f` is honored operationally through the
  §5 14-row safety table rather than via a front-matter SHA citation,
  mirroring Post 001's pattern. Topic locked: "상세페이지에 없는
  정보는 리뷰에서 반복됩니다" (W2 sequence #9 from `108888e` §7).
  Card 2 영문 차용어 `surface` retained; dual-pillar (primary 상세
  페이지 개선 신호 / secondary 리뷰 → 내부 확인 질문) retained.
- **goal** *(historical)*: Draft `docs/instagram_public_education_post_002.md` —
  the second public_education manifesto-style post per the strategy
  doc's first 20-topic list (`108888e` §7).
- **context** *(historical)*: Post 001 is locked (`648b728`). The publishing
  checklist (`6dc8a0f`) and DM script (`7879a7d`) are ready. Post 002
  topic recommendation: pick from the W2 launch sequence in
  `108888e` §7 (currently #12 "부정 리뷰를 제품 문제로 단정하면 안
  되는 이유" or #9 "상세페이지에 없는 정보는 리뷰에서 반복된다").
- **scope**:
  - in: `docs/instagram_public_education_post_002.md` (new)
  - out: any code, any other doc
- **requirements**:
  - Same 7-section structure as `648b728` (Metadata + Carousel + Caption + Hashtag + Safety check + Notes for automation + Review ledger)
  - Pass `6dc8a0f` 14-row safety check on first draft
  - CTA wording exactly matches `648b728` lock
  - Reference `108888e` + `6dc8a0f` SHAs in front-matter
- **commands**:
  - grep for forbidden language per `6dc8a0f` §4
  - grep for placeholder leakage (`@account`, `hello@xxx`, `[HOLD`)
- **output**:
  - one new markdown file under `docs/`
- **stop conditions**:
  - draft complete → handoff per §5, await operator review
  - default: stop after summary, do not stage, do not commit

### O-001 — Brand-20 batch readiness check

- **role**: Ops / Data Agent
- **status**: todo
- **blocked_on**: `one-product live verification after fdd5793` —
  the I-OY-RATING-SORTS-IMPL code/test patch landed at
  `fdd5793 fix(connectors): widen OY sort-row probe and classify
  unreachable controls` (8 files: connector + dataclass + batch
  classifier + summary classifier + inspector + 3 test files; +1158/-6
  lines; 38 + 75 + 433 scoped + 3920 broad tests green). The
  remaining acceptance gate is a single one-product live re-collection
  on Tocobo (`A000000179126`) OR Anua (`A000000207901`) — both
  already known-good post-login SKUs from the O-001 resume. Pass
  condition is either:
  (a) RATING_ASC `max_cap_reached` with `raw>0, inserted>0` (rescue
      path succeeded — DOM probe widening recovered the rating tab); OR
  (b) `RATING_ASC: status=sort_control_unreachable,
      sort_control_failure_by_sort.RATING_ASC=true,
      anti_bot_or_blocked_by_sort.RATING_ASC=false` (rescue did not
      succeed but the diagnostic now distinguishes the cause cleanly,
      without conflating with anti-bot / auth failure).
  Either outcome unblocks Brand-20 fan-out for the remaining 17 SKUs
  (per `ops/agent_handoffs/O-A-O001-resume.md` Path A — the
  principled path). TIRTIR (`A000000214231`) remains off-limits
  until the operator dispatches a fresh ticket naming it
  specifically. See `ops/agent_handoffs/O-001-smoke-trio.md` and
  `ops/agent_handoffs/O-A-O001-resume.md` for the smoke results;
  `ops/agent_handoffs/I-OY-RATING-SORTS.md` and
  `ops/agent_handoffs/O-A-IORS.md` for the triage + recommended
  fix; and `ops/agent_handoffs/I-OY-RATING-SORTS-IMPL.md` +
  `ops/agent_handoffs/O-A-IORSI.md` for the implementation handoff
  + synthesis.
- **goal**: Confirm Brand-20 collection batch can run end-to-end
  against the current code (post-`a2b2ae6` cardnews_mode guard) without
  surprises. Read-only verification first; no live collection.
- **context**: Brand-20 seed CSVs were last revised at `4464c81`. The
  cardnews_mode guard (`a2b2ae6`) added a manifest field and a
  `validate_cardnews_mode` call; verify the existing pipeline path
  (`scripts/run_phase2e_pipeline.py` → `python -m cardnews.render`)
  passes the new guard with default `private_demo`.
- **scope**:
  - in: read-only inspection of `configs/review_ops_brand20_*.csv`,
    `scripts/run_phase2e_pipeline.py`,
    `scripts/run_oy_collection_batch.py`, recent run-package
    manifests under `outputs/`
  - out: any code change, any live collection
- **requirements**:
  - Confirm cardnews subprocess invocation in
    `run_phase2e_pipeline.py` does not pass `--cardnews-mode` (so
    default `private_demo` applies)
  - Spot-check one recent run-package's
    `cardnews/<lang>/manifest.json` for the new fields if any
    re-render has happened post-`a2b2ae6`
  - Confirm Brand-20 seed CSVs have valid `goods_no` column for all
    20 rows
- **commands**:
  - `grep -nE 'cardnews-mode' scripts/run_phase2e_pipeline.py`
  - `awk -F, '{print $1, $2, $3}' configs/review_ops_brand20_collection_queue.csv | head`
- **output**:
  - QA-style report markdown OR a one-page handoff per §5 with
    findings
- **stop conditions**:
  - findings ready → handoff
  - if any code change is needed to make the batch safe → open
    a follow-up `impl/` ticket, do not modify code in this ticket

### C-001 — `detail_page_snapshot` design (read + plan only)

- **role**: Implementation Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `5df35fc docs(design): add detail page snapshot design`
- **closed_at**: 2026-05-07
- **decision recorded**: C-001 completed as design-only. The durable
  design reference is `docs/detail_page_snapshot_design.md`. C-002
  should implement the writer/module first, then connector / pipeline
  / renderer / index integration in smaller follow-up tickets.
  Investigation grounded three load-bearing findings:
  (a) `manifest.provenance.snapshot` slot already exists at
  `schema_version="1.2"` (currently `status="skipped"`) — C-002 fills
  it with no schema bump; (b) the OY warm session connector already
  captures most of the harvest (og:image, page_url, html_length,
  breadcrumb, total_review_count_available, etc.), so C-002 adds only
  2-3 new getters; (c) the snapshot makes the public-vs-collected
  review-count gap a first-class structured field (e.g. needly run
  showed collected=441 vs storefront=6,912).
- **goal** *(historical)*: Produce a design document for capturing OliveYoung
  product detail page snapshots (HTML, breadcrumb, og:title) into a
  per-run audit artifact. **Design only, no code in this ticket.**
- **context** *(historical)*: Brand-20 row-order verification (`4464c81`) used a
  one-off CDP probe (`/tmp/brand20_probe_cdp.py`). Making this a
  durable per-run snapshot would let every Phase 2E run carry
  evidence of the product page state at collection time, supporting
  later disputes ("the page said X at run time").
- **scope**:
  - in: new file `docs/detail_page_snapshot_design.md`
  - out: any code change, any test addition (those land in a
    follow-up `C-002` after design is approved)
- **requirements**:
  - Where the snapshot lives in the run-package layout
  - What fields it carries (URL, og:title, breadcrumb, HTML SHA, fetch
    timestamp)
  - Authentication / CDP attachment behavior (reuse existing CDP
    profile vs. new launch)
  - Failure mode: snapshot fetch failure must NOT block the rest of
    the pipeline (per CLAUDE.md "Collection failures isolated"
    memory)
  - Manifest integration: where snapshot path is recorded
- **commands**:
  - none (design doc only)
- **output**:
  - one new markdown file under `docs/`
- **stop conditions**:
  - design ready → handoff for operator review
  - if design uncovers ambiguity → flag in handoff, do not guess

### Q-001 — `buyer_journey` drift read-only triage

- **role**: QA / Regression Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `7cea019 test(content): add buyer journey fixture regression test`
- **closed_at**: 2026-05-07
- **decision recorded**: QA triage found fixture drift; implementation
  applied Path A by repointing the degraded fixture to
  `shared/_pre_retry_snapshot/20260502T122159Z/analysis_report.json`.
  Producer (`src/voc/content/cardnews_buyer_journey.py`) was not
  regressed; root cause was a later live retry-recovery run that
  rewrote `shared/analysis_report.json` to the post-retry success
  state without re-pointing the test. Resolved via single-line
  fixture-path repoint in I-Q001-A → committed `7cea019`.
- **goal** *(historical)*: Investigate the assertion drift in
  `tests/test_content/test_cardnews_buyer_journey.py` (currently
  untracked; 1 known failing test against the regenerated run-003
  fixture). Decide whether to fix the test, regenerate the fixture,
  or open a `impl/` ticket to fix the producer code.
- **context** *(historical)*: This test was deferred from Group A and Group C
  commits. It hard-codes
  `sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"]` but the current
  run-003 fixture has 5/5 sorts succeeded → produces
  `confidence_axes.negative_signal_coverage.level == "complete"`
  instead of `"degraded"`. Either the test's assumption is stale,
  or the fixture needs to be a pre-recovery snapshot.
- **scope**:
  - in: read-only inspection of
    `tests/test_content/test_cardnews_buyer_journey.py`,
    `src/voc/content/cardnews_buyer_journey.py`, the run-003 fixture
    referenced by the test
  - out: any code change, any test edit, any commit
- **requirements**:
  - Identify which interpretation is correct (test or fixture or
    producer)
  - Recommend exactly one of: (a) edit the test, (b) regenerate the
    fixture, (c) edit `cardnews_buyer_journey.py`
  - Estimate the blast radius of the chosen fix (other tests
    affected, downstream consumers)
- **commands**:
  - `pytest tests/test_content/test_cardnews_buyer_journey.py -q`
  - `grep -n "sorts_failed\|negative_signal_coverage" src/voc/content/cardnews_buyer_journey.py tests/test_content/test_cardnews_buyer_journey.py`
- **output**:
  - QA-style report with a single-recommendation conclusion
- **stop conditions**:
  - recommendation ready → handoff
  - if more than one fix is reasonable → present the trade-offs,
    let operator pick

### I-Q001-A — repoint buyer_journey degraded fixture

- **role**: Implementation Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `7cea019 test(content): add buyer journey fixture regression test`
- **closed_at**: 2026-05-07
- **decision recorded**: One-file test addition; no production code
  change; assertions not relaxed. Path A from Q-001 applied verbatim:
  fixture path repointed from `shared/analysis_report.json` to
  `shared/_pre_retry_snapshot/20260502T122159Z/analysis_report.json`
  in `tests/test_content/test_cardnews_buyer_journey.py`. Test gates
  green pre-commit: 12/12 scoped, 1129/1129 broad
  (`tests/test_content/`). The test file was previously untracked
  (deferred from Group A and Group C commits); the commit lands it as
  `A` (added), not `M` (modified).
- **goal** *(historical)*: Apply Q-001 Path A by repointing the
  buyer_journey degraded fixture path to the pre-retry snapshot,
  without modifying production code or relaxing assertions.
- **context** *(historical)*: Q-001
  (`ops/agent_handoffs/Q-001.md`) identified fixture drift as the
  root cause and recommended Path A; orchestrator triage synthesis at
  `ops/agent_handoffs/O-A-Q001.md` confirmed the single fix path.
  Implementation handoff at `ops/agent_handoffs/I-Q001-A.md`;
  orchestrator implementation synthesis at
  `ops/agent_handoffs/O-A-IQ001A.md`. Handoff files remain untracked
  by design per playbook §5 file hygiene.
- **scope**:
  - in: `tests/test_content/test_cardnews_buyer_journey.py` (single
    file; one-line fixture-path repoint at L298-302)
  - out: `src/`, `cardnews/`, `scripts/`, `docs/`, `outputs/`,
    `configs/`, `.claude/`, `data/`, `eval_data/`, any other test,
    any production code
- **commands** (verification gates run pre-commit):
  - `PYTHONPATH=. pytest tests/test_content/test_cardnews_buyer_journey.py -q` → 12 passed
  - `PYTHONPATH=. pytest tests/test_content/ -q` → 1129 passed
  - `git diff --cached --name-only` → only the test file
- **output**:
  - one new tracked file
    (`tests/test_content/test_cardnews_buyer_journey.py`); commit
    `7cea019`
- **stop conditions**:
  - tests green + commit clean → handoff (achieved)

### H-001 — project-native harness architecture (design-only)

- **role**: Implementation Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `a1ddd99 docs(agents): add project-native harness design`
- **closed_at**: 2026-05-07
- **decision recorded**: H-001 completed as design-only. The durable
  design reference is `docs/agent_harness_design.md` (1,227 lines, 12
  sections + appendix). The project will **not** wholesale adopt
  external Harness/Ouroboros frameworks; instead, the existing
  orchestration playbook remains binding and H-002/H-003 extract
  repeated patterns from this session's handoff corpus into
  project-native skills + evaluation gates. Three load-bearing
  decisions: (a) the harness extends the playbook, never replaces it
  — playbook stays canonical for §4 ticket template, §5 handoff
  protocol, §6 commit protocol, §8 forbidden actions, §11
  concurrency; (b) a 4-tier evaluation matrix
  (mechanical / semantic / policy / operator) defines uniform
  pass/fail surfaces, with semantic + operator tiers staying
  judgment-based until ~more orchestration data accumulates; (c) the
  six human-gated actions (commit, push, live collection,
  credentials, public publish, external messages) remain
  operator-only with no relaxation path in this design.
- **goal** *(historical)*: Define a lightweight project-native
  harness for this repo, inspired by Harness (Supervisor /
  Producer-Reviewer / Pipeline / Fan-out-Fan-in / Expert-Pool
  patterns) and Ouroboros (seed → execute → evaluate → closeout →
  evolve loop) but not adopting either wholesale. Cover 8 named
  topics: why-not-wholesale, current-system-summary, mapping to 5
  Harness patterns, Ouroboros loop, 5 candidate skills, 6
  human-gated actions, 4-tier evaluation gates, H-002/H-003
  implementation plan.
- **context** *(historical)*: This session produced a rich corpus of
  real orchestrations (Q-001 read-only triage → I-Q001-A fix; C-001
  design-only doc; O-001-smoke-trio with mid-flight emergency stop
  + resume; I-OY-RATING-SORTS read-only code triage). Each pattern
  has repeated enough that codifying it as a skill is now warranted.
  H-001 names the patterns; H-002/H-003 will implement them.
- **scope**:
  - in: `docs/agent_harness_design.md` (new); `ops/agent_handoffs/H-001.md`
    (new, untracked)
  - out: any code change, any test addition, any edits to existing
    docs (playbook, OUTPUT_CONTRACT, instagram_*); live collection;
    staging; committing
- **commands**:
  - none (design doc only)
- **output**:
  - `docs/agent_harness_design.md` committed at `a1ddd99`; H-001 handoff
    at `ops/agent_handoffs/H-001.md` (untracked); orchestrator synthesis
    at `ops/agent_handoffs/O-A-H001.md` (untracked)
- **stop conditions**:
  - design ready + handoff written → close
  - implementation deferred to H-002 / H-003

### H-002 — extract first project-native harness skills

- **role**: Implementation Agent
- **status**: todo
- **goal**: Create the first two low-risk reusable skill files
  recommended by H-001 §6 + §9:
  - `board-closeout` (§10 board-edit pattern)
  - `fixture-drift-triage` (read-only QA pattern producing one fix
    path)
- **context**: These two patterns have already repeated in
  A-001/A-002/A-003/P-001/Q-001/I-Q001-A/C-001/H-001 closeouts and
  the Q-001 triage. H-001 §9 recommends extracting them first
  because they are low-risk (no live collection, no public publish,
  no credentials), non-destructive (read-only QA + markdown-only
  board edits), and easy to validate by dry-running on a synthetic
  ticket in-session.
- **scope**:
  - in: `.claude/skills/board-closeout/SKILL.md` (new)
  - in: `.claude/skills/fixture-drift-triage/SKILL.md` (new)
  - optional: `docs/agent_orchestration_playbook.md` cross-references
    if the skill file format requires it
  - out: code under `src/`, `cardnews/`, `scripts/`, `tests/`; live
    collection; public publish; credentials; generated outputs under
    `outputs/`; any other `.claude/` file; CLAUDE.md §6 protected
    files
- **requirements**:
  - Match the format of any existing `.claude/skills/*.md` files
    (read for format reference; do NOT edit them)
  - Each skill spec must include: name, description, when-to-trigger,
    when-to-skip, allowed/forbidden tools, allowed/forbidden file
    scope, required handoff structure, example invocation
  - Acceptance: each skill, when invoked, produces a structured
    handoff matching the freehand precedent (`aa8cb96` / `149ab15`
    for board-closeout; `Q-001.md` for fixture-drift-triage)
- **commands**:
  - in-session dry run on a synthetic ticket (no real ticket close,
    no real test fail)
- **output**:
  - 2 new files under `.claude/skills/`
- **stop conditions**:
  - skills written → handoff
  - no stage; no commit until operator review
  - if the skill format conflicts with any existing `.claude/skills/`
    file, flag and ask

### H-003 — extract advanced harness skills and evolve loop

- **role**: Orchestrator Agent / Implementation Agent
- **status**: todo
- **goal**: After H-002 patterns have been exercised at least once
  in real tasks, extract the harder three skills + add the
  evolve-loop convention to the playbook:
  - `smoke-collection-forensics` (orchestrator emergency-stop write-up
    pattern; precedent `O-001-smoke-trio.md` lines 1-217)
  - `instagram-public-education-review` (14-row safety check + locked
    CTA + policy-chain SHA citations; precedent playbook §7 last block)
  - `detail-page-snapshot-design` (read-code + write-design with
    file:line provenance + risk list + test plan; precedent C-001 →
    `docs/detail_page_snapshot_design.md` and H-001 →
    `docs/agent_harness_design.md`)
  - optional: playbook `## 12. Maintenance cadence` amendment that
    promotes "evolve" from convention to weekly review item
    (per H-001 §5)
- **context**: H-003 should wait until H-002's two skills have been
  used in at least one real orchestration. The harder three skills
  involve more cross-cutting concerns (live-collection forbidden
  actions for forensics, brand policy chain + Korean editorial for
  instagram-review, code-grounding ability for detail-page-snapshot).
  Premature codification risks encoding patterns from too small a
  sample (H-001 §10 risk list).
- **scope**:
  - in: `.claude/skills/` (new files only — `smoke-collection-forensics/`,
    `instagram-public-education-review/`, `detail-page-snapshot-design/`)
  - optional: `docs/agent_orchestration_playbook.md` §12 amendment
  - optional: `docs/agent_harness_design.md` follow-up note (e.g. v1
    revision after seeing H-002 in use)
  - out: live collection; credentials; public publish; code under
    `src/` / `cardnews/` / `scripts/` / `tests/` unless explicitly
    scoped in a re-dispatch; CLAUDE.md §6 protected files
- **requirements**:
  - H-002 skills must have been invoked at least once in a real
    orchestration before H-003 starts
  - Each skill spec carries the same fields required for H-002
  - Evolve-loop amendment (if included) is a small targeted edit to
    playbook §12, not a rewrite
- **commands**:
  - none until skill drafts exist; then in-session dry run per skill
- **output**:
  - up to 3 new skill files under `.claude/skills/`
  - optional: small playbook §12 patch
  - optional: harness design v1 follow-up note
- **stop conditions**:
  - plan or patch only after H-002 has been used at least once
  - operator approval required before starting

### I-OY-RATING-SORTS — RATING_* `sort_control_failure` read-only triage

- **role**: QA / Regression Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `handoff-only` — read-only triage produced no tracked
  commit; the design + recommendation live in the handoff files
- **closed_at**: 2026-05-07
- **handoff**:
  - `ops/agent_handoffs/I-OY-RATING-SORTS.md` (402 lines, 14 sections,
    qa-regression triage)
  - `ops/agent_handoffs/O-A-IORS.md` (orchestrator synthesis)
- **decision recorded**: Read-only triage found that RATING_ASC /
  RATING_DESC failure is **not** primarily login/session expiry, **not**
  sun-care category-specific, and **not** pipeline expectation
  mismatch. Cross-category probe falsified the category hypothesis
  (espoir 2026-05-05 succeeded all 5 sorts; needly 2026-05-05 failed
  RATING_* the same way). The strongest hypothesis is DOM render
  variability on the rating-axis sort tabs (labels not always
  inline-rendered at hunt time). The connector has only one commit in
  tree (`47d7631`); the change vector is OY-side, not ours. Recommended
  single fix path: **DOM probe widening + a distinct
  `sort_control_unreachable` terminal status** so rating-sort control
  reachability is not conflated with `blocked_or_empty_state` real
  blocked/empty result states. Three alternatives rejected with
  reasoning: selector substring update (would risk clicking `랭킹`
  nav), category-specific branch (falsified by cross-category probe),
  status-rename-only (half a fix; doesn't recover data).
- **goal** *(historical)*: Investigate why RATING_ASC and RATING_DESC
  produce `sort_control_failure` across TIRTIR, Tocobo, and Anua O-001
  smoke runs. Determine whether selector drift, login/session artifact,
  category-specific DOM behavior, or pipeline expectation mismatch.
  Produce one recommended fix path. Read-only — no code edits, no
  tests run, no live collection.
- **context** *(historical)*: O-001 smoke/resume revealed all 3 OY
  sun-care SKUs touched today failed RATING_ASC + RATING_DESC with the
  same `blocked_or_empty_state` signature, despite primary corpus
  DATETIME_DESC + USEFUL_SCORE_DESC + RECOMMENDED_DESC succeeding on
  the same logged-in session.
- **scope**:
  - in: read-only inspection of
    `src/voc/connectors/oliveyoung_browser_api.py`,
    `src/voc/app/collection_summary.py`, the O-001 handoff chain, the
    Tocobo + Anua + TIRTIR run-package collection_summary.json files,
    cross-category older run dirs, `/tmp/phase2e_pipeline_*.json` step
    manifests
  - out: any code edit, any test edit, any commit, any live collection
- **commands**:
  - `git log --oneline -30 -- src/voc/connectors/oliveyoung_browser_api.py`
  - `grep -nE 'RATING_ASC|RATING_DESC|sort_tab|sort_control|sort_button|sortType' src/voc/connectors/oliveyoung_browser_api.py`
- **output**:
  - QA-style report with single-recommendation conclusion (handoff +
    orchestrator synthesis)
- **stop conditions**:
  - recommendation ready → handoff (achieved)

### I-OY-RATING-SORTS-IMPL — DOM probe widening + `sort_control_unreachable` status

- **role**: Implementation Agent
- **status**: **done** (closed 2026-05-07)
- **closed_by**: `fdd5793 fix(connectors): widen OY sort-row probe and classify unreachable controls`
- **closed_at**: 2026-05-07
- **decision recorded**: Implementation added DOM probe widening
  (new `_widen_sort_row_probe` method on `_PlaywrightReviewSession`
  with idempotent scroll-into-view + at-most-one disclosure click,
  scoped to the sort container, exact-text match against the
  curated `SORT_DISCLOSURE_AFFORDANCE_LABELS_KO = ("정렬", "더보기",
  "전체보기", "필터", "정렬 기준")` allow-list — substring matching
  was deliberately rejected because `랭킹` contains `랭`), the new
  `sort_control_unreachable` terminal status, and full classifier /
  summary / inspector routing across:
  `src/voc/app/connector_run_summary.py` (new `sort_control_unreachable: bool = False` field);
  `src/voc/app/collection_batch.py` (added to `ALL_STATUSES`;
  `classify_status` precedence ahead of the conflated
  `false_empty_state_detected → blocked_or_empty_state` branch —
  HTTP 403/429 still wins);
  `src/voc/app/collection_summary.py` (new status in
  `EXPLICIT_FAILURE_STATUSES`; `_is_blocked_entry` short-circuits
  to False so `anti_bot_or_blocked_by_sort` stays False);
  `scripts/inspect_run_quality.py` (dedicated Korean warning
  `정렬 컨트롤 도달 실패 — UI 변경 가능성, 재수집 또는 셀렉터
  점검 필요`, particle-free verb form for grammar safety across
  sort names). Tests: 8 new connector tests in
  `tests/test_connectors/test_oliveyoung_sort_control_unreachable.py`
  + 5 new classifier tests in
  `tests/test_app/test_collection_summary.py` + 3 new batch-classifier
  tests in `tests/test_app/test_collection_batch.py`. Gates: 38 + 75
  + 433 scoped, 3920 + 1 skipped broad — all green. **No live
  collection was run** in this ticket per scope. **Acceptance now
  requires one-product live verification** on Tocobo
  (`A000000179126`) or Anua (`A000000207901`) — tracked under O-001's
  updated `blocked_on` annotation as a separate ops dispatch.
  Scope nuance: 3 files outside the literal allowed list
  (`connector_run_summary.py`, `collection_batch.py`,
  `tests/test_app/test_collection_batch.py`) were added as necessary
  plumbing for the new status's data-flow and test coverage —
  operator approved option A (accept broader scope as natural
  implementation surface) before the commit. See
  `ops/agent_handoffs/I-OY-RATING-SORTS-IMPL.md` (10-section §5
  handoff) and `ops/agent_handoffs/O-A-IORSI.md` (orchestrator
  synthesis with scope-nuance audit).
- **goal** *(historical)*: Implement the rating-sort control fix recommended by
  I-OY-RATING-SORTS: widen the DOM probe before
  `_click_sort_button_robust`; add a new terminal status
  `sort_control_unreachable` distinct from `blocked_or_empty_state`;
  route the new status through `collection_summary.py` and
  `inspect_run_quality.py`; add unit tests covering reachable,
  unreachable, and summary-classification behavior.
- **context** *(historical)*: O-001 smoke/resume found repeated RATING_ASC /
  RATING_DESC failures across Tocobo and Anua after login was restored;
  prior forensic data also showed the same signature on TIRTIR's
  pre-login run (different failure mode — auth-walled, not
  sort-control — but related symptom). Brand-20 fan-out to the
  remaining 17 SKUs and the deferred TIRTIR retry should wait on this
  fix, OR proceed only under an explicit operator-named "known soft
  failure" decision per the O-A-O001-resume Path B option.
- **scope**:
  - in: `src/voc/connectors/oliveyoung_browser_api.py` —
    `_click_sort_button_robust` (~3003-3155), `_trigger_review_list_api`
    cascade (~3225-3290), terminal-status branch (~1383-1555); add new
    status string + DOM probe widening
  - in: `src/voc/app/collection_summary.py` — recognise the new
    `sort_control_unreachable` status in `_has_auth_evidence_entry` /
    `_is_blocked_entry`; route to `sort_control_failure_by_sort` cleanly
    without lossy aliasing through `blocked_or_empty_state`
  - in: `scripts/inspect_run_quality.py` — update warning string for
    the new status
  - in: `tests/test_connectors/...` — connector unit tests for
    reachable / unreachable behavior
  - in: `tests/test_app/test_collection_summary.py` — classifier unit
    test for the new status routing
  - out: live collection (separate ops dispatch after this lands);
    credentials; public publish; generated outputs under `outputs/`;
    unrelated connectors; CLAUDE.md §6 protected detector / aggregate /
    lexicon / golden / IMPACTS_KO / RECOMMENDATIONS_KO / verdict
    template files unless explicitly required and approved
- **requirements**:
  - Before `_click_sort_button_robust`, scroll the sort row / scope
    into view (idempotent — does not change behavior when the row is
    already visible)
  - If rating labels are absent on first poll, probe **safe**
    disclosure affordances (e.g. text-equals match against
    `{"정렬", "더보기", "전체보기", "필터", "정렬 기준"}`) inside the
    sort scope only; do NOT use broad substring selectors that could
    click `랭킹` / category-nav elements
  - Add terminal status `sort_control_unreachable` emitted when the
    target sort control cannot be reached after the widened probe; do
    NOT emit it for true blocked/empty result states
  - Route the new status through `collection_summary.py` to
    `sort_control_failure_by_sort` cleanly (NOT through
    `blocked_or_empty_state`)
  - Update `inspect_run_quality.py` warning string for the new status
  - Preserve existing `blocked_or_empty_state` semantics for true
    blocked/empty result states (no behavior regression on currently
    succeeding sorts)
  - Add unit tests for: (a) sort-row not present on initial poll →
    disclosure click → second poll succeeds (rescue path); (b) sort-row
    not present after disclosure click → terminal
    `sort_control_unreachable`; (c) `collection_summary` correctly
    classifies the new status as `sort_control_failure: true` without
    any false `auth_evidence`; (d) renderer / inspector display the
    new status verbatim
  - Do NOT run live collection in this implementation ticket
- **commands** (verification gates run pre-commit):
  - `pytest tests/test_app/test_collection_summary.py -v`
  - `pytest tests/test_connectors/ -v` (or wherever the connector unit
    tests live)
- **output**:
  - 3-5 modified files (connector + classifier + inspector); 1-2 new
    test files
- **stop conditions**:
  - patch + tests green → handoff
  - no live collection in this ticket
  - no stage; no commit until reviewed
  - acceptance gate (post-merge ops dispatch): one-product
    re-collection on Tocobo or Anua observes either RATING_ASC
    `max_cap_reached` with `raw>0, inserted>0` (rescue succeeded) OR
    `RATING_ASC: status=sort_control_unreachable,
    sort_control_failure_by_sort.RATING_ASC=true,
    anti_bot_or_blocked_by_sort.RATING_ASC=false` (rescue did not
    succeed but the diagnostic now distinguishes the cause cleanly)

---

## 11. Claude Code native subagent mode

§3 (worktree / branch discipline) describes the **multi-session
multi-worktree** mode: each specialist is a separate Claude Code
session running in a sibling worktree, and the operator pastes (or the
orchestrator reads, post-A-002) handoff files between them. That mode
is the right shape when work is heavy, branches are long-lived, or the
operator wants visible isolation per role.

This section adds the **single-session native mode**, where the
operator runs **one** Claude Code session in the main worktree and the
orchestrator delegates to specialist roles via Claude Code's built-in
**subagent** mechanism (`.claude/agents/*.md`) plus the
`/orchestrate` slash command (`.claude/commands/orchestrate.md`). The
two modes are not exclusive — they coexist and the operator picks
per task.

### When to use native subagents

Use native subagent mode when **any** of these are true:

- The goal is small enough to fit in a single operator session (one
  doc draft + one read-only inspection, a single bug-fix + its test,
  etc.).
- File scopes are clearly disjoint, so concurrency is structural
  rather than physical.
- The operator wants a single handoff to review at the end, not 2–4
  paste-backs.
- No long-lived topic branch is needed (the work lands as one or two
  commits on `main` or one short-lived branch).

Prefer the §3 multi-worktree mode when **any** of these are true:

- A specialist's work will span many turns and needs an isolated
  branch (e.g. P-001 post drafting in `aiagent-product` over
  multiple revisions).
- Two writers need to operate on overlapping files but want a clean
  per-branch history before integration.
- The operator wants visible separation for accountability /
  policy-chain reasons (e.g. brand content drafting kept off the
  main worktree until the safety check is signed).
- Live collection is involved — `aiagent-ops` isolates the working
  tree from concurrent doc edits.

### Subagent definitions

Five subagents live in `.claude/agents/`:

| File | Subagent name | Maps to playbook role |
|---|---|---|
| `orchestrator.md` | `orchestrator` | §2.1 Orchestrator |
| `product-strategy.md` | `product-strategy` | §2.2 Product / Strategy |
| `implementation.md` | `implementation` | §2.3 Implementation |
| `qa-regression.md` | `qa-regression` | §2.4 QA / Regression |
| `ops-data.md` | `ops-data` | §2.5 Ops / Data |

Each definition file carries: `name`, `description` (used by Claude
Code to decide when to invoke), `tools` allowlist, role instructions,
allowed / forbidden areas, stage / commit restrictions, and the
handoff requirement. The role wording mirrors §2 of this playbook —
when this playbook changes a role boundary, the matching subagent
file must be updated in the same change.

### Concurrency rule

**At most one writer subagent per orchestration unit**, unless:

1. File scopes are **provably disjoint** (no path overlap, no shared
   protected file at risk), AND
2. The operator **explicitly approves** the parallel layout in the
   dispatching turn (e.g. "...run Product post 002 and Implementation
   cardnews planner stub IN PARALLEL").

Read-only subagents (`qa-regression`, read-only `ops-data` tasks like
Brand-20 readiness) may run in parallel with each other and with one
writer. The orchestrator must print the concurrency plan to chat
before dispatching so the operator can abort if the plan is wrong.

Why this rule: two writers in the same session can both stage edits
to overlapping files within one turn, and the §6 commit protocol's
"stage explicitly by path" discipline cannot reliably untangle a
post-hoc collision. Parallelism is cheaper to constrain up front than
to reconcile after.

### Filesystem handoff is still required

Native subagent mode does **not** relax the §5 "Filesystem handoff
protocol". Every subagent — including those running in the same
process as the orchestrator — must write
`ops/agent_handoffs/<ticket-id>.md`. Chat output from a subagent is
commentary, not authority, even when the orchestrator can technically
read the subagent's chat result inline.

Reasons:

- Uniform review surface — operator reviews a file, not a
  conversation log.
- Audit trail — handoff files survive the session; chat does not.
- Mode-portability — a ticket can move from native mode to multi-
  worktree mode (or vice versa) without changing how the handoff
  is consumed.

### `/orchestrate` slash command

`.claude/commands/orchestrate.md` defines the slash command. Usage:

```
/orchestrate <operator goal in plain language>
```

The command equips the current Claude session as the orchestrator,
re-grounds it from this playbook + `CLAUDE.md`, decomposes the goal
into tickets per §4, prints a concurrency plan, dispatches to the
appropriate subagent(s), reads each subagent's handoff file directly
from the filesystem, and synthesizes a unified review per §7.

It enforces:

- no commit / no push / no `git add` / no history rewrite
- no live collection unless the goal **explicitly** names a goodsNo
  or batch in the dispatching turn (per §8 — per-batch
  authorization, never standing)
- no edit to CLAUDE.md §6 protected files unless explicitly
  authorized in the same turn
- one writer subagent default, parallel writers only on explicit
  operator approval

#### Examples

```
/orchestrate Draft Post 002 and run Brand-20 readiness check. Do not commit.
```
→ Two tickets. Product-strategy writes
`docs/instagram_public_education_post_002.md` (writer). Ops-data
runs read-only Brand-20 readiness (reader). One writer + one reader
→ parallel allowed. Both write handoff files. Orchestrator
synthesizes.

```
/orchestrate Triage the buyer_journey drift test failure. Read-only.
```
→ One ticket, qa-regression. Read-only inspection, single-
recommendation handoff. No writer. Orchestrator surfaces the
recommendation to the operator.

```
/orchestrate Authorize live collection of A000000214231 only and run smoke.
```
→ One ticket, ops-data, with **explicit per-batch authorization for
A000000214231**. The goodsNo named in the operator turn IS the
authorization. Smoke runs `scripts/run_all.py` for that one SKU,
verifies `cardnews_mode == "private_demo"` and `schema_version ==
"1.1"` in the manifest, writes handoff.

#### What `/orchestrate` does NOT do

- It does not stage, commit, push, or run anything destructive.
- It does not invent missing scope. If the goal is ambiguous about
  which files to touch or which subagent owns a piece, the
  orchestrator stops and asks.
- It does not absorb a subagent's chat output as a handoff. If the
  expected `ops/agent_handoffs/<ticket-id>.md` is missing, the
  ticket is incomplete and gets returned (per §6 #8).

### Mode selection — quick rule

| Situation | Mode |
|---|---|
| Single goal, fits one session, scopes obvious | native (`/orchestrate`) |
| Heavy multi-turn drafting, isolation desired | multi-worktree (§3) |
| Live collection batch | multi-worktree (`aiagent-ops`) |
| One writer + one read-only check | native, parallel |
| Two writers on disjoint scopes | multi-worktree by default; native only if operator explicitly approves |
| Two writers on overlapping scopes | multi-worktree, never native |

When in doubt: **multi-worktree**. Native mode is a convenience for
small, well-scoped tasks; it is not a replacement for the worktree
discipline that protects the repo state.

---

## 12. Maintenance cadence

### Daily start (Operator + Orchestrator, ~10 min)

- `git log --oneline -10` — quick scan of recent commits.
- `git status --short` — confirm working tree state.
- Scan §10 board for `in-progress` tickets that should have moved.
- Pick the day's top 1–2 tickets.

### Per-task handoff (every dispatch → handoff cycle)

- Operator dispatches with §4 ticket format.
- Agent runs, produces §5 handoff.
- Orchestrator (or operator directly) reviews per §7 checklists.
- If accepted: operator runs the proposed commit per §6.
- If rejected: operator returns the handoff with the failing checks
  listed; agent revises.

### Weekly review (Friday, ~30 min)

This colocates with the DM conversion ledger's Friday review
(`bc17ed4` §6) so both happen in one sitting.

- **Tickets**: count `done` / `blocked` / `still-todo` from §10.
  Move stale `in-progress` to `blocked` with a reason.
- **DM ledger** (`bc17ed4` §6): run the 7-step routine — inflow,
  samples sent, proposals sent, wins/losses, stale → dormant, reason
  patterns, content signals.
- **Policy consistency** (§7 last block): run the 4-row consistency
  check.
- **Branch hygiene**: `git worktree list` — close any worktrees whose
  ticket is `done`. `git branch --merged main` — delete merged topic
  branches.
- **Backlog drift**: scan untracked items in `git status` against the
  6 deferred classes (probe scripts, buyer_journey test, docs
  backlog, figma_plugin, .mcp.json, misc data). Decide whether any
  should move from "deferred" to a fresh ticket.

### Monthly retrospective (last Friday of month, ~60 min)

- Re-read this playbook. What rule has been bent more than once?
  That rule needs to either harden or relax — pick one.
- Re-read `108888e` strategy. Does the brand still match what we
  actually do? If not, queue a strategy revision ticket.
- Re-read `6dc8a0f` checklist §8.3 automation gate (20 manual posts
  × 0 violations). Are we on track to enable Phase B planner work?
- Adjust §10 board topic-priority for the next month.

---

## Appendix — Why this stays small

- **No queue server, no ticket DB, no agent runtime.** Tickets are
  markdown in this file. Agents are Claude sessions launched by the
  operator. State is git.
- **No autonomous commits.** Every commit touches the operator turn.
  This is the single most important rule; it is what keeps the brand
  promise enforceable.
- **No private knowledge outside git.** If an agent learned something
  important that future agents need, it lands as a doc commit (not
  in chat memory, not in conversation logs that future agents won't
  see).
- **Every agent role can be retired or merged** when the
  operation grows or shrinks. The 5-role split is a v1.0 starting
  point, not a fixed org chart.
