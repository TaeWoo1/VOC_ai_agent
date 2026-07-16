# HANDOFF — R4 Action Window NAVER Runtime

> **Purpose:** a short orientation for a future Claude session picking this workstream up cold.
> **This file grants nothing.** It authorizes no live action, no commit, no push. It is a map, not a gate.
> Canonical detail lives in the docs linked below; where this file and they disagree, **they win**.

**Updated:** 2026-07-16 · **Worktree:** `BE/worktrees/sellerops-r4-runtime` (dedicated BE writer, owner file
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
2. [`r4-evidence-pack.md`](r4-evidence-pack.md) — §8-N dated live/offline evidence. §8-17 is Run 4.
3. [`r4-preparation.md`](r4-preparation.md) — **normative**: §3 gates G1–G6, §4 live-action safety
   boundary, §6 adapter ladder, §7 abort criteria.
4. [`r4-gate-record.md`](r4-gate-record.md) — recorded gate sign-offs + the export-pilot pre-dispatch runbook.
5. [`r4-operator-runbook.md`](r4-operator-runbook.md) — **the only operator-facing doc here**; the other
   entries are engineering records. Read it if a human is about to run an **export**: Phase A prep, the
   click and confirm windows, what a lapse costs, when to abort. **Grants nothing.**
   ⚠ **It describes the EXPORT pilot. Run 5 deliberately inverts its §3** (click, do NOT confirm) — that
   choreography lives in Run 5's own dispatch record. **Do not reconcile the two.**
6. The per-run dispatch records (`r4-run2-…`, `r4-run3-…`, `r4-run4-…`, `r4-run5-…`) for run-specific
   choreography.

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

- **`origin/main` = `ccd9597`** (PR #268 merged, 2026-07-16). The branch was **synced — 0 ahead, 0 behind**
  (`--ff-only`, no merge commit created locally) **at the moment Run 5 was dispatched**; this file's own
  Run 5 edits are local-only until committed.
  > **No HEAD SHA is recorded here on purpose.** The commit that writes it is never the commit it names,
  > so a HEAD line is stale on arrival — `cb081e0` and `5667ed4` both shipped one behind. **Run
  > `git log --oneline origin/main..HEAD`**; that is the live measure.
- **ZERO local-only commits.** Everything Run 5 needs offline is on `main`, across two PRs — each commit
  verified an ancestor of `origin/main` after its sync (`git merge-base --is-ancestor`), not inferred
  from having merged it:
  - **#267** (`db45f5a`) — **docs only**: `4f701aa` (this file after #265) · `bff96b5` (the Run 5
    **dispatch checklist**).
  - **#265** (`64de3ea`) — the Run-5-preparation batch: `ca4808e` (this file after #263) · `40d7c53`
    (**the human-barrier fix** — `driveOneRun` now waits on `USER_ACTION_OBSERVED`) · `5d57fde`
    (readiness diagnostic + the Run 5 boundary) · `fb98f1b` (merge of `main`/#264) · `4539534` (this
    file after #264).
  - **That #265 batch DID change `collector/src` behaviourally** — unlike the #263 batch, and unlike
    #267, which is docs only. The distinction matters because a reader carries the older framing
    forward.
    `40d7c53` changed `cli/run-action-window-live-naver.ts` (barrier timing); `5d57fde` changed that
    file plus `action-window/naver-surface.ts` (the readiness diagnostic). **Verify a file set with
    `git diff --name-only origin/main...HEAD`; never assert it from memory** — the #263 batch's
    "docs/skill only" claim was FALSE and shipped in `5667ed4`'s own commit message.
- ⚠ **A recorded `origin/main` SHA is a snapshot, not a fact — including the one above.** Before #265,
  `main` had ALREADY moved to `31b3e44` before the session fetched: the local ref knew, nothing surfaced
  it, and this file's `ff6eef5` was stale *while Run 5 was being planned against it*. **Re-check with
  `git fetch` + `git rev-list --left-right --count origin/main...HEAD` before trusting the line above.**
- ⚠ **"Held locally" ≠ "not pushed" — they are different facts, and this file conflated them.**
  Before #263, this section said the batch was **"none pushed"**. That was **FALSE**: the feature branch
  had already been pushed to `origin/feat/r4-supervised-channel-runtime`, by something other than the
  session that wrote the claim (no `post-commit` hook exists; the remote-tracking reflog shows a single
  `update by push`). `git log origin/main..HEAD` measures **distance from `main`** — it says nothing
  about whether the *branch* is on the remote. **To claim "not pushed", check
  `git ls-remote origin refs/heads/<branch>`. Never infer push state from your own actions.**
- **Syncing and pushing remain operator decisions — do not fetch-and-merge or push on your own
  initiative.**
- The six commits held by the *batch before that* all landed via **#260**: `45ed82c` (upload log
  sanitization §4.3), `053a10a` (this file + orientation skill + reading order), and the four Run 4 status
  corrections — `19b5f10` (`current_state` §9), `47cada6` (roadmap §4.1/§1/§5.1), `568d6f7`
  (`current_state` §7), `49dc847` (capability matrix).
- **`git log origin/main..HEAD` remains the honest measure** — the "ahead N" figure against
  `origin/feat/r4-supervised-channel-runtime` has repeatedly overcounted work already on `main`.
  ⚠ **Use the three-dot diff (`git diff origin/main...HEAD`) when previewing a PR.** The two-dot form
  compares trees, so when `main` has moved it renders *other people's merged work* as deletions — this
  produced a bogus "1,871 deletions" reading against #259 while preparing #260.
  **Not currently firing** — the branch is synced to `main`, so the two forms agree while that holds.
  **The warning stands: it re-arms the moment `main` moves again — which it has done mid-batch four
  times in three days (#261, #262, #263, #264).** Assume it will happen during the next batch too.
- Recent merges: **#268** (this file's git-state refresh after #267, `ccd9597` — **docs only**),
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
  hardening), #256, #252 (synthetic UI verification harness). Earlier R4 landmarks: **#242** (live driver
  core `NaverLiveProbeDriver`), **#246** (gated live entrypoint), **#250** (`settleExportSurface`).
- Merge policy: **normal merge commit** (`gh pr merge N --merge`) — never squash/rebase — then fetch +
  `--ff-only` sync.

## Last slice — docs-governance batch (6 commits, held local, 2026-07-15→16)

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
- **Why non-mutating was not politeness:** there is **no no-ingest mode**. `buildLiveRunDeps` wires the
  real uploader unconditionally, `ingest` is non-optional, and the engine runs VALIDATE→INGEST with no
  gate. **If the seller confirms, ingest is unconditional and irreversible.** Not confirming is the only
  lever — the one Run 3 used. **This still holds for every future run.**
- ⚠ **`naver-surface.ts`'s "never logged" clause was relaxed deliberately** — to the **log only**, fixed
  enums only; **never extend it to transport or persistence** (the FE has no period/scope blocker code;
  giving it one is a governed contract change).

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
`collector/src/row-count-bucket.ts`; FE copy mapping for `actionWindow.step.downstream`. **PO decision still
open:** whether to *relax* the readiness gate (accept a visible+enabled export control + grid container as
`READY`, relying on download-detection fail-closed) — see `current-state.md`.

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
- Offline baseline: **2860 passed / 29 skipped** (174 files). Measured 2026-07-16 on the synced
  post-`db45f5a` tree (i.e. **including #264, #265, and #267**); neither ff-sync moved it, as expected —
  #267 is docs only. Lineage, every delta attributed — **no unexplained drift**:
  2761 → **2837** (+76 from #259) → **2855** (+18 from #261) → **2857** (+2 from `40d7c53`, the barrier
  regression tests) → **2860** (+3 from `5d57fde`, the readiness-diagnostic tests). **#264 added 0** — it
  is backend Java + `.github/workflows/` only and touches no `collector/` file, so the merge moved the
  count not at all. **A docs-only or backend-only change that moves this number is a red flag, not
  drift.**
- Ask for an explicit **"seated and ready"** before any headed/human-in-the-loop run. A no-click failure
  means **operator-absent first**, not a code bug.
- Source-guard tests read module source and grep forbidden tokens — **strip comment lines first**
  (`collector/CLAUDE.md` §5). Prose has caused false failures before.
