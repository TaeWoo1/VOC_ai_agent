# HANDOFF — R4 Action Window NAVER Runtime

> **Purpose:** a short orientation for a future Claude session picking this workstream up cold.
> **This file grants nothing.** It authorizes no live action, no commit, no push. It is a map, not a gate.
> Canonical detail lives in the docs linked below; where this file and they disagree, **they win**.

**Updated:** 2026-07-17 · **Worktree:** `BE/worktrees/sellerops-r4-runtime` (dedicated BE writer, owner file
`.claude-worktree-owner` — never stage it) · **Branch:** `feat/r4-supervised-channel-runtime`

**Discovery:** the root `CLAUDE.md` workstream routing table points here, and the `r4-runtime-handoff`
skill (`.claude/skills/r4-runtime-handoff/SKILL.md`) routes here. **Both carry paths only** — they
deliberately restate no status, so a fact landing in this workstream should never require editing them.
**This directory is status-of-record for Runtime detail** and wins over any status claim in a router or
in `docs/sellerops_current_state.md`, whose Action Window entries are a scoped summary, not a substitute.

**`docs/multi-channel-connector-roadmap.md` §4.1** — the capability table — outranks this file (conflict
priority #5) and is *not* mirrored here. Runtime evidence may show it stale; **report that, do not edit
it from this branch.**

⚠ **Still stale, by decision, not oversight:** `docs/slices/action-window-v1.md` (DRAFT) still says the
overlay / download-detection seams are 미구현. That is a product-owner decision, deliberately not taken
here. Report it; do not silently edit it.

## Where to read first

1. [`current-state.md`](current-state.md) — the living handoff state. ⚠ Its `updated at:` header still says
   **2026-07-13**, but its bullets carry `UPDATE` segments through 2026-07-15. **Trust the UPDATE segments,
   not the header date.** The bullets are long and accrete rather than being rewritten.
2. [`r4-evidence-pack.md`](r4-evidence-pack.md) — §8-N dated live/offline evidence. §8-17 is Run 4; §8-18 is
   Run 5 (**still the last live run**); §8-19 (A1), §8-20 (A2-B) and §8-21 (A3) are **offline** slices —
   all three on `main`, **live-verified by nothing**. Milestone A shipped a capability, not a live proof.
3. [`r4-preparation.md`](r4-preparation.md) — **normative**: §3 gates G1–G6, §4 live-action safety
   boundary, §6 adapter ladder, §7 abort criteria.
4. [`r4-gate-record.md`](r4-gate-record.md) — recorded gate sign-offs + the export-pilot pre-dispatch runbook.
5. [`r4-operator-runbook.md`](r4-operator-runbook.md) — **the only operator-facing doc here**; the other
   entries are engineering records. Read it if a human is about to run an **export**: Phase A prep, the
   click and confirm windows, what a lapse costs, when to abort. **Grants nothing.**
   ⚠ **It describes the EXPORT pilot. Run 5 deliberately inverts its §3** (click, do NOT confirm) — that
   choreography lives in Run 5's own dispatch record. **Do not reconcile the two.**
6. The per-run dispatch records (`r4-run2-…`, `r4-run3-…`, `r4-run4-…`, `r4-run5-…`) for run-specific
   choreography. **Executed records are frozen** — later truth arrives as a forward-pointer, never an edit.
   ⚠ [`r4-run6-session-recovery-dispatch-record.md`](r4-run6-session-recovery-dispatch-record.md) is a
   **DRAFT — NOT AUTHORIZED, all-☐**. It **names** two product-owner decisions it deliberately does not
   take (a `session recovery` G3 scope; a longer authorized live window) and **grants nothing**.

## State in one line

**The NAVER supervised export pilot is PROVEN END-TO-END on the real surface** (Run 4, 2026-07-15), and
**the human barrier is now real** — Run 5 (2026-07-16) live-proved that `USER_ACTION_OBSERVED` fires on a
real click, which had **never** happened before and was `false` on Run 4 itself. The §8-8 → §8-18 arc is
complete. There is no open Runtime blocker; what remains is polish and product decisions.

## Live run results (chronological — every G6 below is CONSUMED)

| Run / probe | Date | Result |
|---|---|---|
| Run 1 — export pilot | 07-13 | **FAILED** fail-closed `UNSUPPORTED_STATE` at `prepareSurface`, 0-of-3. Non-mutating. §8-8 |
| §8-10 frame probe | 07-13 | Child-frame hypothesis **REFUTED** — surface is the top document |
| §8-11 row-shape probe | 07-13 | Row-shape-miss hypothesis **REFUTED** — `semanticRowCount: many`, zero gap |
| Run 2 — settle verification | 07-14 | **FAILED**, reproduced Run 1. The settle is **REFUTED** as the fix. §8-13 |
| §8-14 readiness-branch probe | 07-14 | **ROOT CAUSE CONFIRMED**: empty-state-**marker precedence** — a "no results" placeholder coexists with a populated grid and masks a would-be-`READY` surface |
| Run 3 — precedence fix | 07-14 | **PASSED** readiness, reached the human barrier (2-of-3). Observe-only; benign `DOWNLOAD_TIMEOUT`. Readiness false-empty **RESOLVED LIVE**. §8-16 |
| **Run 4 — full export pilot** | **07-15** | **COMPLETED 3-of-3.** Real click → download → quarantine-validate (OOXML sniff) → real `/api/uploads` ingest. Backend `SUCCESS` **55/55/0/0**, clean first ingest. §8-17 |
| **Run 5 — barrier + observation** | **07-16** | **`USER_ACTION_OBSERVED` LIVE-PROVEN** — `observed: true` on a real click, the first time ever; persisted `humanCheckpoint.observed` agrees (`run_a911f3c6799c`). Click-but-never-confirm ⇒ benign `FAILED`/`DOWNLOAD_TIMEOUT`/2-of-3. **Non-mutating, verified.** First machine evidence of live period/scope. §8-18 |

**⚠ Run 4 MUTATED, as authorized:** 55 real test-seller review rows are in the **local dev** backend DB
(`localhost:8080`, never production). **Not reversible by the Runtime.**

**🔎 Run 4 choreography finding:** the export is a **TWO-step** human action — the highlighted-control click
raises an **expected NAVER confirmation dialog** the operator must manually confirm; the download fires only
on that confirmation. Both steps must land inside the ~60 s detect window. That dialog is **expected and is
NOT a §7 abort trigger**; §7's "any *unrecognized* prompt/dialog → abort" still stands for everything else.
Operator-facing version: [`r4-operator-runbook.md`](r4-operator-runbook.md) §3; normative:
`r4-preparation.md` §7.

**Timing facts a cold session re-derives WRONG (code-verified, not run-verified):**

- ✅ **RESOLVED 2026-07-16 — the open `USER_ACTION_OBSERVED` question is ANSWERED, and it was a defect.**
  `humanCheckpoint.observed` was **`false` on every live run to date, including Run 4.** The chain:
  `session.ts:195` voids `watchUserAction()` (untracked by `autoBusy`, so `whenSettled()` returns at
  once) → `driveOneRun` sent `REQUEST_STEP_RECHECK` **~1 s after the highlight** → `beginVerify()`
  (`engine.ts:444-448`) left `WAIT_FOR_USER_ACTION` without requiring `observed` → when the seller acted
  20–40 s later, `session.ts:236`'s stage guard dropped it. **Fixed OFFLINE this slice** (`driveOneRun`
  now waits on the run's own `USER_ACTION_OBSERVED` event before rechecking). **The engine/session/
  persistence wiring was always correct — only the CLI's FE stand-in mis-timed.**
  ✅ **LIVE-PROVEN 2026-07-16 (Run 5, §8-18) — the fix works on the real surface.** `aw.live.barrier
  { observed: true }` on a real NAVER click: **the in-page listener (`observer.ts`) fires live**, which no
  prior run had ever shown. The persisted `humanCheckpoint.observed` **agrees** with the emitted line
  (`run_a911f3c6799c`) — so the §4 audit trail is a truthful record for the first time, where Runs 1–4
  recorded `false` regardless of what the seller did.
- ⚠ **`OBSERVE_TIMEOUT_MS` = 10 min WAS cosmetic; after the fix it is load-bearing.** The human budget is
  now **two windows, not one**: the seller acts on the highlighted control within the observe window,
  **then** confirms the dialog within ~60 s (`DOWNLOAD_TIMEOUT_MS`), which now starts at the click rather
  than at the highlight. **Strictly more generous than Run 4's combined ~60 s** — so Run 4's timing is no
  longer the live truth, and the operator must be told before the next run.
  ✅ **LIVE-CONFIRMED 2026-07-16 (Run 5, §8-18):** the timeout fired **~60 s after the barrier observation**,
  not after the highlight. The two-window budget is real, not just intended.
- ✅ **`CONFIRM_PROMPT` — the one text an operator reads at run time — WAS STALE; FIXED 2026-07-16 (D-025).**
  Run 5 hit it live: it said "manually confirm the expected NAVER confirmation dialog" (contradicting that
  run's own non-confirming scope) and "from the moment the highlight appears you have about 60 SECONDS" for
  **both** steps (made false by `40d7c53`). It had been rewritten in `4c6d1ac` **before** the barrier fix
  landed and never revisited; §8-18 reported it rather than fixing it mid-dispatch, which would have
  invalidated the offline verification the G6 rested on. **Now:** both windows are **interpolated from
  `OBSERVE_TIMEOUT_MS` / `DOWNLOAD_TIMEOUT_MS`** — the prose cannot restate a stale number again — and the
  confirm/do-not-confirm choice is **deferred to the run's approved scope** rather than hardcoded, because the
  prompt is shared across scopes. **Root cause of the rot: it was unexported and unasserted.** It is now both.
- ⚠ **Observation is an audit record, NOT the completion authority — keep it that way.** `driveOneRun`
  rechecks **anyway** on observe-timeout, deliberately: the in-page listener (`observer.ts:21-28`) has
  never fired on a live run, and `armObserve`'s `timeout: 0` arming means an already-fired download is
  still detected. A lost observation costs latency, never the run. **Do not gate `beginVerify()` on
  `observed`** — that would make completion depend on an unproven live mechanism and contradict
  "observation ≠ completion".
- ⚠ **Why the tests missed it — the transferable part.** `SyntheticProbeDriver.completeUserAction()`
  reports the action **while the run is still parked**, a timing the live path cannot reproduce, so
  `run-action-window-live-naver-browser.test.ts:202`'s `observed: true` passed against a path that never
  worked. **Green tests certified an impossible ordering.** The new
  `DeferredActionProbeDriver` reports it late, as a real seller does; that test fails against everything
  before this slice.
- ⚠ **The Runtime never observes the confirmation.** `observer.ts` listens only on the tagged export
  control; the dialog is outside it. **The download firing is the sole evidence of step 2** — unchanged
  by the fix, which only makes step 1 observable.

## Git state

- **`origin/main` = `73f027e`** (PR #280 merged, 2026-07-16). The branch is **synced — 0 ahead, 0 behind**
  (`--ff-only`, no merge commit created locally) and holds **ZERO local-only commits**: **Milestone A —
  A1, A2-B and A3 — is entirely on `main`.** Nothing this workstream has built is held locally.
  > **No HEAD SHA is recorded here on purpose.** The commit that writes it is never the commit it names,
  > so a HEAD line is stale on arrival — `cb081e0` and `5667ed4` both shipped one behind. **Run
  > `git log --oneline origin/main..HEAD`**; that is the live measure.
- ⚠ **This section was TWELVE merges stale when refreshed 2026-07-17** — it still described the Run-5 era
  (`ccd9597`, #268) after five R4 slices had landed. A git-state block rots silently and continuously;
  **enumerate it, never assert it from memory.** `git log --merges ccd9597..origin/main` and
  `git diff --name-only` are the measure — the #263 batch's "docs/skill only" claim was FALSE and shipped
  inside `5667ed4`'s own commit message for exactly this reason.

**The twelve merges from `ccd9597` (#268) to `73f027e` (#280)** — re-derived from `git log`, 2026-07-17:

| Merge | SHA | `collector/` + `contracts/` |
|---|---|---|
| #270 docs(runtime): Run 5 barrier-observation evidence | `dd367a6` | 0 |
| **#272 feat(runtime): period scope as a guided precondition** (D-025) | `a8c8566` | **6 — the only behavioural merge in the gap** |
| #273 docs(runtime): scope the G3 summary to the read-only probe | `e2dce38` | 0 |
| #276 docs(runtime): declare G3 a per-run gate (D-026) | `9a06a08` | 0 |
| **#277 — Milestone A1** (`--no-ingest`, D-027) | `69cf75f` | yes — §8-19 |
| **#278 — Milestone A2-B** (recoverable login parks, D-028) | `5de0f95` | yes — §8-20 |
| #279 review triage — **another workstream** | `4404b4f` | **0** — backend Java + `docs/product-scope-v1.md` |
| **#280 — Milestone A3** (the CLI recovery loop, D-029) | `73f027e` | yes — §8-21 |

Plus **#269 / #271 / #274 / #275** — attention + ingest workstreams, **0 `collector/` files** between them.

- **#279 landed mid-batch and moved the baseline by 0.** `git diff --stat 5de0f95..4404b4f -- collector/
  contracts/` is **empty** — it is backend Java + `docs/product-scope-v1.md` only. So no merge-from-main
  commit was required and PR #280 contained exactly `cc9aba8`. **That is the baseline red-flag rule holding**
  (see Working rules): a backend-only merge that *had* moved the count would have been the finding.
- ⚠ **A recorded `origin/main` SHA is a snapshot, not a fact — including the one above.** Before #265,
  `main` had ALREADY moved to `31b3e44` before the session fetched: the local ref knew, nothing surfaced
  it, and this file's `ff6eef5` was stale *while Run 5 was being planned against it*. **Re-check with
  `git fetch` + `git rev-list --left-right --count origin/main...HEAD` before trusting the line above.**
  > ⚠ **Reported, not acted on:** the no-HEAD-SHA rule above — *"the commit that writes it is never the
  > commit it names"* — **applies to `origin/main` by its own reasoning**, and this line keeps rotting for
  > precisely the cause the rule already names. Durable facts (a PR number, a merge SHA) do not rot; a
  > moving-ref snapshot does. Left as-is by scope decision, not because it is sound.
- ⚠ **"Held locally" ≠ "not pushed" — they are different facts, and this file conflated them.**
  Before #263, this section said the batch was **"none pushed"**. That was **FALSE**: the feature branch
  had already been pushed to `origin/feat/r4-supervised-channel-runtime`, by something other than the
  session that wrote the claim (no `post-commit` hook exists; the remote-tracking reflog shows a single
  `update by push`). `git log origin/main..HEAD` measures **distance from `main`** — it says nothing
  about whether the *branch* is on the remote. **To claim "not pushed", check
  `git ls-remote origin refs/heads/<branch>`. Never infer push state from your own actions.**
- **Syncing and pushing remain operator decisions — do not fetch-and-merge or push on your own
  initiative.**
- **`git log origin/main..HEAD` remains the honest measure** — the "ahead N" figure against
  `origin/feat/r4-supervised-channel-runtime` has repeatedly overcounted work already on `main`.
  ⚠ **Use the three-dot diff (`git diff origin/main...HEAD`) when previewing a PR.** The two-dot form
  compares trees, so when `main` has moved it renders *other people's merged work* as deletions — this
  produced a bogus "1,871 deletions" reading against #259 while preparing #260.
  **Not currently firing** — the branch is synced to `main`, so the two forms agree while that holds.
  **The warning stands: it re-arms the moment `main` moves again — which it has done mid-batch FIVE
  times in five days (#261, #262, #263, #264, #279).** Assume it will happen during the next batch too.
- ⚠ **Do not plan against `main` being still — and do not claim it has been.** Opening #280 I wrote that
  this was *"three consecutive slices where `main` didn't move"*. **#279 falsified it within minutes**, and
  the merge's first parent came out `4404b4f` rather than the `5de0f95` I had verified against. A
  quiet-`main` streak is a fact about the past that predicts nothing about the next hour; it is never a
  premise. **The cost here was zero only because #279 touched no `collector/` file — which was checked, not
  assumed.**
- **Merges BEFORE `ccd9597`** (everything after it is in the table above): **#268** (this file's git-state
  refresh after #267, `ccd9597` — **docs only**),
  **#267** (the Run 5 dispatch checklist + this file after #265, `db45f5a` — **docs
  only**), **#265** (the human-barrier fix + readiness instrumentation + the Run 5 boundary, `64de3ea`),
  **#264** (backend CI workflow + `SyncScheduleRunnerTest` clock precision,
  `31b3e44` — **backend Java + `.github/workflows/` only**; landed on `main` while the #265 batch was
  held and arrived here via the `fb98f1b` merge; does **not** touch `collector/`, so the baseline below
  is unaffected), **#263** (R4 operator guidance + routing cleanup, `ff6eef5`),
  **#262** (export→report chain verification, `3b668d7` — **backend Java only**; landed on `main` while
  #263 was open and arrived here on the ff-sync; does **not** touch `collector/`, so the baseline below
  is unaffected), **#261** (bridge abuse hardening, `d7d1161` — reached this branch via `d87ec17`),
  **#260** (this handoff + Run 4 status durability, `09f2411`), **#259** (bridge fail-closed
  pairing approval via out-of-band `ApprovalPresenter` — merged to `main` *after* the R4 branch point;
  landed here on sync), **#258** (R4 runtime, `23de8d7`), #257 + #255/#254/#253 (local-agent bridge
  hardening), #256, #252 (synthetic UI verification harness). The **#260** batch carried `45ed82c` (upload
  log sanitization §4.3) + the four Run 4 status corrections (`19b5f10`, `47cada6`, `568d6f7`, `49dc847`).
  Earlier R4 landmarks: **#242** (live driver
  core `NaverLiveProbeDriver`), **#246** (gated live entrypoint), **#250** (`settleExportSurface`).
- Merge policy: **normal merge commit** (`gh pr merge N --merge`) — never squash/rebase — then fetch +
  `--ff-only` sync. ⚠ **`MERGEABLE`/`CLEAN` is a precondition, not a formality — and `UNKNOWN` is not
  `CLEAN`.** #280's first poll returned `mergeable: UNKNOWN` (GitHub still computing); merging on that would
  have been merging on no information. **Verify the merge afterwards from its parents**, not from the CLI's
  say-so: `73f027e` has parents `4404b4f` + `cc9aba8`, which is what proves it was neither squashed nor
  rebased.

## Last slice — Milestone A (A1 → A2-B → A3), **all on `main`**, 2026-07-16→17

**Milestone A is complete and merged.** In one arc it made a live login failure survivable: A1 gave the run
a way to decline ingest, A2-B made `LOGIN_REQUIRED`/`SESSION_EXPIRED` **park** instead of kill, and A3 gave
the CLI the loop that drives a park back into a live run.

| Slice | PR / merge | What landed | Evidence |
|---|---|---|---|
| **A1** | #277 `69cf75f` | `--no-ingest` — and the `--no-upload` footgun that motivated it ([D-027](decisions.md)) | §8-19 |
| **A2-B** | #278 `5de0f95` | recoverable login parks; `recoverable: true` produced for the first time ([D-028](decisions.md)) | §8-20 |
| **A3** | #280 `73f027e` | the CLI recovery loop, bounded by a shared 10-min budget ([D-029](decisions.md)) | §8-21 |

⚠ **All three are OFFLINE. Milestone A shipped a capability and proved it against fake drivers — it did not
prove anything about NAVER, and it consumed no gate.** Run 5 (2026-07-16) is **still the last live run**.
The detail for A2-B and A3 is in their own sections below; **the next step is a live validation that needs a
fresh scope-matched G3 + a fresh single-use G6** — see
[`r4-run6-session-recovery-dispatch-record.md`](r4-run6-session-recovery-dispatch-record.md) (**a draft; it
grants nothing**).

## Earlier slice — the docs-governance batch (2026-07-15→16) — **no longer the last slice**

**Retained for the lessons, which still bind.** All 6 commits are on `main` (#263/#265/#267/#268 — see Git
state); the "held local" framing this section used to carry is spent.
**No capability claim moved, no gate flipped, no G6 granted, no canonical product doc touched.** The only
non-docs change in the batch is `4c6d1ac`'s **string-only** `CONFIRM_PROMPT` rewrite (see Git state).

- **`cb081e0`** — refreshed this file's git state + baseline after #260.
- **`4c6d1ac`** — R4 operator guidance (detailed below); its honesty constraints still bind. **Also the
  batch's one `collector/src` touch:** `CONFIRM_PROMPT`, string only.
- **`15e6fe3`** — **routers carry paths, not state.** Root `CLAUDE.md`'s Action Window section became a
  paths-only routing table; the `r4-runtime-handoff` skill's dated status became durable rules; this
  file's **Discovery block** stopped mirroring §9/§4.1/§7. The evidence: 3 of the 4 Run 4 commits each
  had to touch the same 3 routers; the 4th touched 1 file, because 표 B derives from §4.1 **by rule** and
  no router quotes it. **State docs are exempt — this section is supposed to carry state.**
- **`1b9f582`** — README §5 rank 6 no longer hedges "(once it exists)"; the contract exists
  (`contracts/action-window/v1/`, MERGED PR #212). Same pathology as `15e6fe3`: a **precedence list
  carrying status**, rotted silently.
- **`5667ed4`** — this file's git state + last slice, after `main` moved mid-batch. **Introduced the
  false "docs/skill only" claim corrected in Git state above.**
- **`d87ec17`** — merged `main` (#261) in. Disjoint, clean; baseline 2837 → 2855 (+18).

⚠ **Corrected in `1b9f582` — previously reported for two sessions and written into `15e6fe3`'s own commit
message:** "three precedence lists conflict at rank 6" is **OVERSTATED**. Root `CLAUDE.md`'s rank 6 is
*the active slice*; README §5's rank 6 is *the FE↔Runtime contract* — **different objects.** Neither list
ranks the other's item: disjoint tails, not a collision. Silence is not contradiction, and
`CLAUDE.md:139-141` already splits **status** (this directory wins) from **intent** (root wins). **Do not
re-derive this as a defect.** Also refuted: "nothing cites README §5" — `r4-preparation.md:11` cites it,
and `SKILL.md:14` calls that file normative.

**PO decision made 2026-07-15, deliberately NOT applied:** workstream precedence lists **defer to root's
ranks 1-5 and never restate them**. README §5 still mirrors those ranks, so writing the rule now would
publish one its only instance visibly breaks. **The rule + the §5 dedup are one follow-up slice.** This
paragraph is currently the decision's only home in the repo.

### The R4 operator guidance (`4c6d1ac`) — DELIVERED 2026-07-15

Run 4 proved the path; the human choreography was scattered and the one text an operator reads at run time
was stale. Now closed, offline, in one commit:

- **NEW [`r4-operator-runbook.md`](r4-operator-runbook.md)** — the run-time choreography (Phase A prep,
  the ~60 s window, timeout cost, abort, evidence). Choreography **only**: it links to the gate record for
  authorization and §8-17 for evidence rather than restating them. **It grants nothing.**
- **`r4-preparation.md` §7** — the expected-dialog carve-out, now explicit in the normative section, and
  **narrowed to exactly one dialog**: uncertain ⇒ it is not the expected one ⇒ abort.
- **`CONFIRM_PROMPT`** (`collector/src/cli/run-action-window-live-naver.ts`) — rewritten for the two-step
  action + the ~60 s budget. String only; no behavior, no timers.
- **`r4-gate-record.md`** — its pre-dispatch runbook no longer says "the pilot did not succeed"; still
  grants nothing, every G6/P6 still consumed.

**The honesty constraints that shaped it still bind any future edit:**

- **The Run 4 confirmation dialog is NOT named.** Write "an expected NAVER confirmation dialog" only.
  `export-click-signals.ts` records — in a source comment — an *earlier* live run hitting a copyright/usage
  consent misread as `date_range_required`. **Whether that is the same dialog Run 4 hit is not
  established.** Do not merge the two observations.
- **The period/date step is UNOBSERVED.** It exists only as three words in §4 ("selects period/scope"), one
  CLI prompt line, and a halt branch (`EXPORT_DATE_RANGE_REQUIRED`) that has never fired live. Keep the §4
  obligation; invent no procedure.
  **UPDATE 2026-07-16 — Run 5 MEASURED it for the first time (§8-18), and the procedure rule still stands.**
  Observed: `readinessBranch: labeled_count_positive` · `selectedRangePresent: false` ·
  `dateRangeControlPresence: some`, with readiness `READY`. The operator **confirmed they selected no
  period/scope**, so `selectedRangePresent: false` is a **true negative that agrees with the operator state** —
  not the detector false-negative class that cost Runs 1–3.
  **Readiness passed without requiring a selected range**, and the branch shows why: rung 1 fired on a labeled
  positive row count and **short-circuited before any date-range rung could evaluate**. So
  `EXPORT_DATE_RANGE_REQUIRED` is dead for a **structural** reason — on any surface with countable rows the date
  rung is **unreachable**, not merely unused.
  **✅ DECIDED 2026-07-16 → [D-025](decisions.md): correct-by-design.** Period/scope is a **guidance-only §4 human
  precondition** — the gate answers *exportability*, never *scope*. The Runtime observes and logs it; it never
  gates. ⚠ **The rung-1 story is narrower than the truth:** rung 1 explains Run 5's *path*, but the **structural
  bound is rung 6** (`results_container_zero_rows`) — the date rung needs **no `<table>`/`<tbody>`/`role=grid|
  table|rowgroup` anywhere**, so a review grid halts before it even at **zero** rows. Now locked by test.
  ⚠ **The detector is UNPROVEN in the positive direction** — one true negative is not validation. Whether it
  reports `true` when a range **is** selected is untested live, so the markers stay placeholders
  (`collector/CLAUDE.md` §6). **Still: invent no procedure until a run reports one.**
  **↳ CORRECTION 2026-07-16 (D-025):** this bullet used to say *"a hardwired `false` would look identical"* —
  **false, withdrawn.** Offline we know it is not hardwired. The real, stronger concern: the regex reads the
  `value` **attribute**, but live reads are `page.content()` serialization and a JS/user-set value updates the
  IDL **property** only — so on an SPA picker the detector may be **incapable of ever returning `true`**. That is
  why promoting it to a blocker risks a **100% halt rate**, not a rare miss.
- ⚠ **The Run 4 dialog's identity is STILL OPEN — Run 5 did not close it.** The
  `dialogMatchesRecordedConsentMarkers` eyeball was **NOT_OBSERVED** (not returned by the operator), so whether
  Run 4's dialog is the copyright/usage consent recorded in `export-click-signals.ts` remains established in
  **neither direction**. **Do not merge the two observations.** A future run can settle it for free.

## Last live run — Run 5 (barrier + observation) — EXECUTED 2026-07-16 · G6 CONSUMED

**Run 5 is DONE and it PASSED its headline question** (§8-18): `USER_ACTION_OBSERVED` **fires on a real
NAVER click**, and the persisted `humanCheckpoint.observed` agrees with the emitted line. The barrier fix
is live-proven; the §4 audit trail is truthful for the first time. **Non-mutating, verified** (no download,
quarantine never created, backend never reachable). **Its G6 is CONSUMED — it authorizes nothing further.**

- **It was a THIRD G6 scope** — the read-only probe was **no-click**; the export pilot is **click + confirm
  + ingest**; Run 5 was a real click that **deliberately never confirmed**, landing on Run 3's benign
  `FAILED`/`DOWNLOAD_TIMEOUT`/2-of-3 by construction.
- **Why non-mutating was not politeness — AS OF RUN 5:** there was **no no-ingest mode**.
  `buildLiveRunDeps` wired the real uploader unconditionally, `ingest` was non-optional, and the engine ran
  VALIDATE→INGEST with no gate. **If the seller confirmed, ingest was unconditional and irreversible.** Not
  confirming was the only lever — the one Run 3 used.
  - ⚠ **CORRECTED 2026-07-16 by A1 → [D-027](decisions.md).** This bullet used to end *"This still holds
    for every future run"*, and that is now **false**: `--no-ingest` declines the handoff (validate runs,
    the artifact is dropped, the run lands CANCELLED at 2-of-3). What **remains true for every future
    run** is the part that matters: **on the DEFAULT path a confirmed download is still ingested
    unconditionally and irreversibly**, and **not acting is still the only lever that is non-mutating BY
    CONSTRUCTION.** `--no-ingest` is **not** a safety flag and is **strictly more mutating than not
    acting** — it still opens live NAVER, still needs a real human action, and still lands a real file in
    quarantine. It earns its place for one purpose only: exercising detect + quarantine-validate against
    a real artifact **without a DB write** — the leg Run 4 could only prove by writing 55 irreversible rows.
- ⚠ **`naver-surface.ts`'s "never logged" clause was relaxed deliberately** — to the **log only**, fixed
  enums only; **never extend it to transport or persistence** (the FE has no period/scope blocker code;
  giving it one is a governed contract change).

## Recoverable login parks — A2-B, offline, 2026-07-16 ([D-028](decisions.md), §8-20)

**`LOGIN_REQUIRED` / `SESSION_EXPIRED` no longer kill the run.** They **park**: `WAITING_FOR_HUMAN`,
`recoverable: true`, `REQUEST_STEP_RECHECK` offered, `0-of-3`, no `RUN_FAILED`. A recheck re-runs the **real**
`prepareSurface` probe; only that probe clears the blocker — a human saying "I logged in" never does.
`UNSUPPORTED_STATE` stays terminal **by construction** (exhaustive switch ⇒ a 4th code is a compile error).
**Zero contract / FE / backend / schema change.**

- ⚠ **`recoverable` was a lie until this slice, and the FE dutifully rendered it.** `recoverable: true` was
  produced **nowhere** in production code; the field carried exactly one value while `resumeStateFor` separately
  and correctly classified those runs `RESUME_FROM_FAILURE`. **If a doc or a memory says "recoverable is
  hardcoded false", that is now stale.**
- ⚠ **The recovery is proven OFFLINE ONLY.** ~~The CLI cannot exercise it~~ — **corrected 2026-07-17: A3 /
  [D-029](decisions.md) closed this.** The CLI now drives the recovery through an injected operator gate
  (prompt → the seller logs in → they signal → the Runtime re-probes). But **it has still never run against
  NAVER**: the proof is fake drivers over an in-process loopback, and the gate exists precisely so the loop
  never needs a browser to be tested. The FE/Bridge affordance (`HumanCheckpointCard` + `copy.ts`) was
  **already built and waiting** and is unchanged.
- ⚠ **KNOWN, TESTED LIMITATION — a *successful* login can still kill the run.** The driver never navigates, so a
  recheck probes whatever page login landed on; off the export surface → readiness HALT → `UNSUPPORTED_STATE` →
  terminal. **Where NAVER lands a seller after login is UNOBSERVED.** Per D-028 "return to the review page
  before rechecking" is a **guidance-only §4 human precondition** — the D-025 category: observed, never gated.
  **Free falsifier, rides any future run:** does the operator, after logging in, still see a readiness-`READY`
  export surface? `true` → the loop closes unaided. `false` → a navigate seam becomes a real PO question.
- ⚠ **The A2 fork I offered was MIS-FRAMED, and the correction is the durable part.** I presented it as "4-step
  plan (fixture 10's shape) vs a cheaper blocker that diverges from the fixture". **False.** The contract
  fixtures are **schema examples, not engine goldens** — no test asserts engine↔fixture agreement, and fixture
  04, the *live-proven* barrier, already diverges on six fields. A 4-step plan would **not** have made fixture 10
  projectable (`esm.prepare_session` / `esm_plus`); it buys one integer. **Do not re-derive the fork.**

## The CLI recovery loop — A3, offline, 2026-07-17 ([D-029](decisions.md), §8-21)

**A parked run no longer dies at teardown.** The CLI prompts, waits for the seller to log in and signal, then
re-probes for real and continues the same run. Bounded by a **shared 10-minute budget** — not per-attempt
timeouts. **Zero contract / FE / backend / schema / stage / navigation change.**

- ⚠ **NEVER RUN LIVE.** Proven against fake drivers over an in-process loopback only. The operator gate is
  injected precisely so the loop is testable without a browser — which is also why **passing tests say nothing
  about NAVER.** Any live use needs a fresh scope-matched G3 + a fresh single-use G6.
- ⚠ **A G6 now authorizes a LONGER live window: ~21 min → ~32 min** worst case. D-028's boundary requires a
  fresh G3 + G6 but says nothing about *duration*, and duration is what changed. **Put it in the dispatch
  record; do not let it be discovered at the seat.**
- ⚠ **The bound is TIME, not tries** (PO, 2026-07-17). A cap was never the real bound — a sentinel timeout
  breaks the loop, so an uncapped loop cannot spin. And 3 attempts buy almost nothing for D-028's dominant
  case, which **fails at attempt 1**: a seller who logs in but lands off the export surface yields `LOGGED_IN`
  → readiness HALT → `UNSUPPORTED_STATE` → terminal. `MAX_RECOVERY_ATTEMPTS = 3` is a **spin backstop only**;
  if it ever fires, the stale-sentinel trap reopened — do not read it as "the seller gave up".
- ⚠ **"D-028's falsifier is free" was FALSE and is now corrected.** `lastDiagnostic` is assigned after an
  unguarded `page.content()`, so a thrown probe keeps the previous probe's value. A3 logs
  `aw.live.readiness` **per attempt** and withholds it on `driver-error`. **If a doc or memory says A3 harvests
  the falsifier at zero cost, that is stale.** Guarding `page.content()` in the driver is the deeper fix —
  **open, reported, out of A3's scope.**
- ⚠ **The `--no-upload` footgun, a third time — and my guard against it was itself vacuous.** `awaitRecovery` is
  optional and `main()` is untestable, so the loop could be green while the live CLI stayed dead. The source
  guard asserted `/awaitRecovery:/`, which **`recoverLoop`'s type signature satisfies** — renaming `main()`'s
  wiring left all 56 tests green. Caught only by deliberately falsifying it. **A vacuous guard against a
  footgun is the footgun.** Falsify every lock before trusting it.
- **D-028's known limitation is UNCHANGED.** A3 adds no navigation; `OPEN_TARGET_SURFACE` stays dormant. What
  A3 adds is the *delivery* of the guidance D-028 ratified and nothing had ever printed.

## Next — two OPEN product-owner decisions from Run 5

**No Runtime blocker is open.** What follows is decisions and polish, not work the code is waiting on.

- **✅ DECIDED 2026-07-16 → [D-025](decisions.md) — the unreachable date rung is CORRECT-BY-DESIGN.**
  Period/scope is a **guidance-only §4 human precondition**: the readiness gate answers *exportability*, never
  *scope*. The Runtime observes + logs it and never gates. The rung and `EXPORT_DATE_RANGE_REQUIRED` are
  **retained, not deleted** (fail-closed HALTs cost nothing dormant; they preserve the §8-14 lineage), with the
  unreachability now **locked by test**. ⚠ **The rationale is the CATEGORY argument, NOT Run 5** — Run 5 is
  *silent* on whether NAVER requires a period (see the timing/verify note below). **Do not re-derive D-025 from
  Run 5's `observed: true`.**
- **✅ DONE 2026-07-16 — the stale `CONFIRM_PROMPT` is fixed** (same slice as D-025). It no longer hardcodes
  "confirm the dialog" (that is the run scope's call, not the prompt's), its two-window budget is
  **interpolated from the timers** so it cannot restate a stale number, the period/scope line is lifted to
  prominence as the operator's own unenforced step, and it now warns that a validated download is ingested
  unconditionally. It is **exported and test-locked** — being unexported and unasserted is how it rotted.
- **OPEN — `selectedRangePresent` is unproven in the positive direction.** Run 5 produced one **true negative**
  (operator selected nothing, detector said nothing). ⚠ The stronger concern is **not** "hardwired `false`"
  (withdrawn as false — see the correction above) but that the regex reads the `value` **attribute** while live
  reads are `page.content()` serialization: a JS/user-set value updates the IDL **property** only, so on an SPA
  picker the detector may be **incapable of ever returning `true`**. The blind spots are now characterized by
  offline test. **A future run that does select a range settles the direction for free** — and it is D-025's
  named falsifier: `true` → revisit a blocker **on evidence**; `false` → confirms the blindness and a blocker
  stays off the table until a **different** detector exists.
- **OPEN — the Run 4 dialog's identity.** Run 5's `dialogMatchesRecordedConsentMarkers` was **NOT_OBSERVED**;
  the question is open in **neither direction**. Also free to settle on any future click run.
- **The `COMPLETED` path under the new timing is still unproven** — it rests on Run 4's **old-timing** evidence.
  Re-proving it needs a **separate mutating run with a fresh export-scoped G6**.
- ⚠ **Run 5 cannot speak to platform acceptance, and no future record should claim it does.**
  `action-window/observer.ts` is a plain DOM click listener, so `observed: true` means **a human acted** — not
  that NAVER accepted the request. `naver-live-driver.ts` passes verify's `completionSignalPresent` as a
  hardcoded `true` (deliberate: no proven post-action DOM completion marker exists, so **the download is the
  only artifact evidence**), and Run 5 had none. Its `DOWNLOAD_TIMEOUT` is **equally consistent with
  consent-declined, range-refused, and click-no-op.**

Deferred items: a dedicated `INGEST_FAILED` contract code (governed contract + FE mapping); folding
`esm/esm-review-schema-shape.ts:38`'s third copy of the row-count bucket into
`collector/src/row-count-bucket.ts`. **PO decision still
open:** whether to *relax* the readiness gate (accept a visible+enabled export control + grid container as
`READY`, relying on download-detection fail-closed) — see `current-state.md`.

**⚠ Corrected 2026-07-16 (A2-B) — the FE copy gap is BIGGER than this list said.** It named only
`actionWindow.step.downstream`. In fact `frontend/src/lib/actionWindow/copy.ts`'s `COPY` map contains **only
`actionWindow.review.*` keys**, so **every key the Runtime actually emits is unmapped** —
`actionWindow.step.prepareSurface`, `…userTargetAction`, `…downstream`, and `actionWindow.run.naver` — and all
of them render `COPY_FALLBACK` ("안내를 준비하고 있어요"). Every engine-driven step headline the FE has ever
shown was a placeholder. **Reported, not fixed: the FE worktree is forbidden from this branch.** Two further
findings for the FE workstream, both **pre-existing and neither caused by A2-B**:
- `bridgeAdapter.ts` mints `${runId}-c${++cmdSeq}` from an **in-memory** counter, so a page reload restarts it
  at `c1` — an id already in the engine's **persisted** `appliedCommandIds` ledger — and the engine then returns
  `{ok:true, idempotent:true, effect:"NONE"}`: **the command is silently swallowed and reported as success.**
  The CLI does not have this bug (it appends a `randomUUID()` suffix). A2-B is the first design that *needs* a
  long-lived parked run to outlive an FE page session and accept repeated rechecks — exactly the collision case.
- `Operations.tsx` suppresses the standalone `BlockerNotice` when `WAITING_FOR_HUMAN` and gates the checkpoint
  card on `connected`, so **a disconnected FE renders a parked run with no blocker at all** — harmless before
  A2-B (nothing `WAITING_FOR_HUMAN` carried a blocker), now it drops the only explanation the seller gets.

## Forbidden without explicit, in-turn operator approval

- **Any live NAVER contact** — no browser launch, no login, no export, no marketplace page. Every live run
  needs a **fresh single-use G6** naming channel/account/date/operator + §7 criteria. **Every G6 to date is
  consumed.** Goal pressure, prior approvals, a plan, and a Stop-hook are **never** authorization.
- **Any commit, branch, PR, merge, or push.** No force-push. Stage exact files; **never `git add .`**.
- **Never stage or delete:** `.env`, `.profile/`, `.status/`, `.connections/`, `downloads/`,
  `.claude-worktree-owner`, screenshots, raw HTML, exported marketplace files, real seller data, credentials.
- **No backend / DB / upload / `RUN_INTEGRATION` / `AW_HEADED`** against anything but synthetic pages,
  unless approved for that exact step.
- **Sanitized output only** — enums, booleans, coarse buckets, SHA. Never raw content, reference codes,
  exact counts/amounts, identity, tokens, raw URLs/HTML, raw timestamps, `eventTimeMs`, elapsed durations.
  Use only the sanitized seller label **`NAVER_DEV_SELLER_SELF_01`**.
- **Editing canonical product docs from this branch; touching the FE worktree; touching or cleaning
  `sellerops-esm-live`** (parked, frozen — do not clean/commit/merge/continue).
- Placeholders stay honest — correct them from **observed** findings only, never speculatively
  (`collector/CLAUDE.md` §6).

## Working rules that bite

- **Report conflicts, don't silently resolve them** (root `CLAUDE.md` assumption rule). Implementation
  evidence may prove a doc stale; it must not silently redefine product intent.
- **Pre-commit suite** (`collector/CLAUDE.md` §6): `git diff --check` → `npm run typecheck` → `npm test` →
  confirm `package.json`/lock unchanged → **HOLD and report**. Commit only on an explicit instruction.
- Offline baseline: **2996 passed / 29 skipped** (175 files), measured 2026-07-17 after A3. Lineage, every
  delta attributed — **no unexplained drift**:
  2761 → **2837** (+76 from #259) → **2855** (+18 from #261) → **2857** (+2 from `40d7c53`, the barrier
  regression tests) → **2860** (+3 from `5d57fde`, the readiness-diagnostic tests) → **2899** (the
  post-#268/#277-branch-point measure) → **2926** (+27 from **A1 / #277**, all new) → **2976** (+50 from
  **A2-B**, all new: `stage-tables` +32 in a new file · `engine` +12 · `session-integration` +4 ·
  `run-action-window-live-naver` +2 · `naver-session-integration` **+0**, two rows moved from the terminal
  table to the park table) → **2996** (+20 from **A3**, all new and all in
  `run-action-window-live-naver.test.ts`: `awaitFreshSentinel` +3 · the recovery loop +9 · `recoveryPrompt` +6 ·
  source guard +2; **file count unchanged at 175** — A3 added no test file). **#264 added 0** — it is backend
  Java + `.github/workflows/` only and touches no `collector/` file, so the merge moved the count not at all.
  **A docs-only or backend-only change that moves this number is a red flag, not drift.**
- Ask for an explicit **"seated and ready"** before any headed/human-in-the-loop run. A no-click failure
  means **operator-absent first**, not a code bug.
- Source-guard tests read module source and grep forbidden tokens — **strip comment lines first**
  (`collector/CLAUDE.md` §5). Prose has caused false failures before.
