# HANDOFF — R4 Action Window NAVER Runtime

> **Purpose:** a short orientation for a future Claude session picking this workstream up cold.
> **This file grants nothing.** It authorizes no live action, no commit, no push. It is a map, not a gate.
> Canonical detail lives in the docs linked below; where this file and they disagree, **they win**.

**Updated:** 2026-07-15 · **Worktree:** `BE/worktrees/sellerops-r4-runtime` (dedicated BE writer, owner file
`.claude-worktree-owner` — never stage it) · **Branch:** `feat/r4-supervised-channel-runtime`

**Discovery:** the root `CLAUDE.md` reading order points here, and the `r4-runtime-handoff` skill
(`.claude/skills/r4-runtime-handoff/SKILL.md`) routes here. ⚠ **`docs/sellerops_current_state.md` — the
reading order's own §6 "living handoff state" — predates the R4 live runs and still says the Action Window
is `계약만(미구현)` / `구현 없음`. That is stale. For Action Window status, this directory wins;** correcting
that doc is a product-owner decision, deliberately not taken (see root `CLAUDE.md` → Action Window / R4).

## Where to read first

1. [`current-state.md`](current-state.md) — the living handoff state. ⚠ Its `updated at:` header still says
   **2026-07-13**, but its bullets carry `UPDATE` segments through 2026-07-15. **Trust the UPDATE segments,
   not the header date.** The bullets are long and accrete rather than being rewritten.
2. [`r4-evidence-pack.md`](r4-evidence-pack.md) — §8-N dated live/offline evidence. §8-17 is Run 4.
3. [`r4-preparation.md`](r4-preparation.md) — **normative**: §3 gates G1–G6, §4 live-action safety
   boundary, §6 adapter ladder, §7 abort criteria.
4. [`r4-gate-record.md`](r4-gate-record.md) — recorded gate sign-offs + the export-pilot pre-dispatch runbook.
5. The per-run dispatch records (`r4-run2-…`, `r4-run3-…`, `r4-run4-…`) for run-specific choreography.

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

## Git state

- **`origin/main` = `23de8d7`** (PR #258 merged). HEAD = **`45ed82c`**.
- **Exactly ONE local-only commit: `45ed82c`** — `refactor(collector): sanitize upload.done +
  item-analysis.count logs (§4.3)`. Offline cleanup slice; verified (typecheck clean, 2761 passed /
  29 skipped); **HELD unpushed by the standing local-accumulation cadence** — it is a cleanup, not a
  milestone. Do not push/PR it without an explicit operator go.
- The branch reads "ahead 4" of `origin/feat/r4-supervised-channel-runtime`, but three of those are already
  on `origin/main` via PR #258. **`git log origin/main..HEAD` is the honest measure — it shows 1.**
- Recent merges: **#258** (R4 runtime, `23de8d7`), #257 + #255/#254/#253 (local-agent bridge hardening),
  #256, #252 (synthetic UI verification harness). Earlier R4 landmarks: **#242** (live driver core
  `NaverLiveProbeDriver`), **#246** (gated live entrypoint), **#250** (`settleExportSurface`).
- Merge policy: **normal merge commit** (`gh pr merge N --merge`) — never squash/rebase — then fetch +
  `--ff-only` sync.

## Next slice — planned, NOT started

**R4 operator guidance** (docs + one CLI string; offline). Run 4 proved the path but there is **no
operator-facing runbook**: the human choreography is scattered across §4's role list, a sentinel paragraph
in the gate record, the dispatch records, and `CONFIRM_PROMPT`
(`collector/src/cli/run-action-window-live-naver.ts:219-231`) — the only text an operator actually reads at
run time, and it is now stale (it describes the export as one action and never mentions the ~60 s window).

Three files: a new `r4-operator-runbook.md`; a §7 amendment carrying the expected-dialog carve-out into the
normative section; and the `CONFIRM_PROMPT` text.

**Two operator-confirmed honesty constraints — do not violate:**

- **The Run 4 confirmation dialog is NOT named.** Write "an expected NAVER confirmation dialog" only.
  `export-click-signals.ts:233-239` records — in a source comment — an *earlier* live run hitting a
  copyright/usage consent (`리뷰 다운로드 및 활용` / `저작권자` / `계속하시겠습니까`) misread as
  `date_range_required`. **Whether that is the same dialog Run 4 hit is not established.** Do not merge the
  two observations.
- **The period/date step is UNOBSERVED.** It exists only as three words in §4 ("selects period/scope"), one
  unexplained CLI prompt line, and a halt branch (`EXPORT_DATE_RANGE_REQUIRED`) that has never fired live.
  Keep the §4 obligation; invent no procedure.

Other deferred items: a dedicated `INGEST_FAILED` contract code (governed contract + FE mapping); folding
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
- Offline baseline: **2761 passed / 29 skipped**.
- Ask for an explicit **"seated and ready"** before any headed/human-in-the-loop run. A no-click failure
  means **operator-absent first**, not a code bug.
- Source-guard tests read module source and grep forbidden tokens — **strip comment lines first**
  (`collector/CLAUDE.md` §5). Prose has caused false failures before.
