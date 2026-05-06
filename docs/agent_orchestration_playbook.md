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

### P-001 — Post 002 manuscript draft

- **role**: Product / Strategy Agent
- **status**: todo
- **goal**: Draft `docs/instagram_public_education_post_002.md` —
  the second public_education manifesto-style post per the strategy
  doc's first 20-topic list (`108888e` §7).
- **context**: Post 001 is locked (`648b728`). The publishing
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
- **status**: todo
- **goal**: Produce a design document for capturing OliveYoung
  product detail page snapshots (HTML, breadcrumb, og:title) into a
  per-run audit artifact. **Design only, no code in this ticket.**
- **context**: Brand-20 row-order verification (`4464c81`) used a
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
- **status**: todo
- **goal**: Investigate the assertion drift in
  `tests/test_content/test_cardnews_buyer_journey.py` (currently
  untracked; 1 known failing test against the regenerated run-003
  fixture). Decide whether to fix the test, regenerate the fixture,
  or open a `impl/` ticket to fix the producer code.
- **context**: This test was deferred from Group A and Group C
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

---

## 11. Maintenance cadence

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
