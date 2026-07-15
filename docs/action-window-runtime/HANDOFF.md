# HANDOFF — R4 Action Window NAVER Runtime

> **Purpose:** a short orientation for a future Claude session picking this workstream up cold.
> **This file grants nothing.** It authorizes no live action, no commit, no push. It is a map, not a gate.
> Canonical detail lives in the docs linked below; where this file and they disagree, **they win**.

**Updated:** 2026-07-15 · **Worktree:** `BE/worktrees/sellerops-r4-runtime` (dedicated BE writer, owner file
`.claude-worktree-owner` — never stage it) · **Branch:** `feat/r4-supervised-channel-runtime`

**Discovery:** the root `CLAUDE.md` reading order points here, and the `r4-runtime-handoff` skill
(`.claude/skills/r4-runtime-handoff/SKILL.md`) routes here. `docs/sellerops_current_state.md` — the reading
order's own §6 "living handoff state" — **was corrected by the product owner on 2026-07-15** and its §9 now
records Run 4 and routes here. **This directory remains status-of-record for Runtime detail;** §9 is a
scoped summary, not a substitute. That doc is otherwise still a 2026-07-08 snapshot — only the Action
Window entry was refreshed.

**`docs/multi-channel-connector-roadmap.md` §4.1** (the capability table — *higher* in the conflict priority
than `current_state`) **was corrected on 2026-07-15**: NAVER REVIEW now reads export→ingest end-to-end
라이브 검증 (Run 4), scoped inline to 감독형·개발셀러·로컬 dev 백엔드. **운영 지원 stays ❌ and the 셀러 표기
cell is unchanged** — no seller-facing claim moved.

`docs/sellerops_current_state.md` §7 was aligned on 2026-07-15 and now records the Run 4 export→ingest run
with the same scope bounds.

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
   entries are engineering records. Read it if a human is about to run an export: Phase A prep, the
   **~60 s** click+confirm window, what a lapse costs, when to abort. **Grants nothing.**
6. The per-run dispatch records (`r4-run2-…`, `r4-run3-…`, `r4-run4-…`) for run-specific choreography.

## State in one line

**The NAVER supervised export pilot is PROVEN END-TO-END on the real surface** (Run 4, 2026-07-15). The
§8-8 → §8-17 arc is complete. There is no open Runtime blocker; what remains is polish and product decisions.

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

**⚠ Run 4 MUTATED, as authorized:** 55 real test-seller review rows are in the **local dev** backend DB
(`localhost:8080`, never production). **Not reversible by the Runtime.**

**🔎 Run 4 choreography finding:** the export is a **TWO-step** human action — the highlighted-control click
raises an **expected NAVER confirmation dialog** the operator must manually confirm; the download fires only
on that confirmation. Both steps must land inside the ~60 s detect window. That dialog is **expected and is
NOT a §7 abort trigger**; §7's "any *unrecognized* prompt/dialog → abort" still stands for everything else.
Operator-facing version: [`r4-operator-runbook.md`](r4-operator-runbook.md) §3; normative:
`r4-preparation.md` §7.

**Two timing facts a cold session re-derives WRONG (verified in code 2026-07-15, not by a run):**

- ⚠ **`OBSERVE_TIMEOUT_MS` = 10 min is COSMETIC on this path — never quote it as the human budget.**
  `waitForUserAction` runs un-awaited and its result is discarded once the stage has moved on
  (`session.ts:236`), because `driveOneRun` auto-sends `REQUEST_STEP_RECHECK` the moment the run parks.
  So `detectDownload` is already racing its 60 s timer ~1 s after the highlight appears. **The only number
  that can fail a run is ~60 s** (`DOWNLOAD_TIMEOUT_MS`), and it covers click **+** confirm. The early
  `timeout: 0` arming (`naver-live-driver.ts`) means an early click is never missed.
- ⚠ **The Runtime never observes the confirmation.** `observer.ts` listens only on the tagged export
  control; the dialog is outside it. **The download firing is the sole evidence of step 2.**
  ❓ **Open, NOT determinable from code or docs:** whether `USER_ACTION_OBSERVED` /
  `humanCheckpoint.observed` is therefore ever recorded on a live run — §4 claims the Runtime "observes the
  user's action" as part of the audit trail. If it is not, that is a **defect, not a doc problem**.
  Unreviewed; needs engineering + PO.

## Git state

- **`origin/main` = `09f2411`** (PR #260 merged, 2026-07-15). HEAD = **`09f2411`** — the branch is synced,
  not ahead.
- **ZERO local-only commits.** `git log origin/main..HEAD` shows **0**; nothing is held unpushed. The six
  commits previously held by the accumulation cadence all landed via **#260**: `45ed82c` (upload log
  sanitization §4.3), `053a10a` (this file + orientation skill + reading order), and the four Run 4 status
  corrections — `19b5f10` (`current_state` §9), `47cada6` (roadmap §4.1/§1/§5.1), `568d6f7`
  (`current_state` §7), `49dc847` (capability matrix).
- **`git log origin/main..HEAD` remains the honest measure** — the "ahead N" figure against
  `origin/feat/r4-supervised-channel-runtime` has repeatedly overcounted work already on `main`.
  ⚠ **Use the three-dot diff (`git diff origin/main...HEAD`) when previewing a PR.** The two-dot form
  compares trees, so when `main` has moved it renders *other people's merged work* as deletions — this
  produced a bogus "1,871 deletions" reading against #259 while preparing #260.
- Recent merges: **#260** (this handoff + Run 4 status durability, `09f2411`), **#259** (bridge fail-closed
  pairing approval via out-of-band `ApprovalPresenter` — merged to `main` *after* the R4 branch point;
  landed here on sync), **#258** (R4 runtime, `23de8d7`), #257 + #255/#254/#253 (local-agent bridge
  hardening), #256, #252 (synthetic UI verification harness). Earlier R4 landmarks: **#242** (live driver
  core `NaverLiveProbeDriver`), **#246** (gated live entrypoint), **#250** (`settleExportSurface`).
- Merge policy: **normal merge commit** (`gh pr merge N --merge`) — never squash/rebase — then fetch +
  `--ff-only` sync.

## Last slice — R4 operator guidance, DELIVERED 2026-07-15

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

## Next slice — none chosen

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
- Offline baseline: **2837 passed / 29 skipped** (174 files). Measured on the post-#260 sync tree —
  the jump from 2761 is **+76 tests from #259**, not drift.
- Ask for an explicit **"seated and ready"** before any headed/human-in-the-loop run. A no-click failure
  means **operator-absent first**, not a code bug.
- Source-guard tests read module source and grep forbidden tokens — **strip comment lines first**
  (`collector/CLAUDE.md` §5). Prose has caused false failures before.
