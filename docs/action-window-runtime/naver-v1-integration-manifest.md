# NAVER SmartStore v1 — Final Integration Manifest

> **Status: PLAN-ONLY (2026-07-21). Nothing here is executed.** No branch integration, no commit, no
> remote git, no live run, no file deletion. This manifest is the input to the **single final v1
> integration** permitted by the phase rule (root `CLAUDE.md` "Current phase"); executing any step below
> needs an explicit, separate operator instruction.
>
> Sources: `naver-smartstore-v1-plan.md` (§8 blockers, §9 completion criteria, §10 governance, unresolved
> list), `HANDOFF.md`, `docs/slices/naver-guided-connection.md` §0, `g3c-live-walk-preflight.md`.

---

## 0. Topology correction (read this first)

An earlier working assumption — that v1 requires merging **two divergent feature branches** — is **WRONG**
and is corrected here:

- `feat/naver-guided-reply-session-v1` (worktree `sellerops-naver-live-review-match`) is at `b41749d`,
  which **IS `origin/main`**. PRs **#311–#315 are already merged to main.** The guided-reply
  operator-assisted calibration stack is therefore **already upstream** — there is no second feature
  branch to integrate.
- `feat/naver-smartstore-v1` (this worktree) is **15 ahead / 11 behind** `origin/main`.
- `git cherry` reports **`12c93a8` (shared review-body fingerprint + backend reply-target hint) as already
  upstream** — it is patch-equivalent to main's `6e2f932`. It will drop on rebase / resolve trivially on
  merge. The other **14** commits are unique to this branch.

**Consequence:** the final integration is a **single ordinary branch→main integration** of this branch,
after syncing it with main — not a cross-worktree branch marriage.

---

## 1. Surface ownership

| v1 surface | Owner | Where it lives | State |
|---|---|---|---|
| **Onboarding / API** | **this branch** (`feat/naver-smartstore-v1`) | `frontend/src/lib/guidedConnection/*`, `frontend/src/pages/ConnectNaver.tsx`, `collector/src/cli/observe-api-center.ts` | Built offline (`f9d069c`, `18171b2`, `0eef9ad`, API-center observer chain `f7ab96f…58b102e`). Bar RULED 2026-07-21 → G3-A/B. |
| **Review export** | **`origin/main`** (already merged) | Action Window export track | LIVE-VERIFIED end-to-end (Run 4). B3 caveat **ACCEPTED 2026-07-21**. |
| **Session readiness** | **both** — core on `origin/main`, B4 wizard wiring on **this branch** | `collector/src/naver/*` (main) + `guidedConnection/bridgeSession.ts` (`18171b2`, `0eef9ad`) | Offline-proven; reconnect modelled first-class. |
| **Guided reply** | **`origin/main`** (PRs #311–#315) | `calibrate-reply-target`, row-mapping artifact, `reply-row-inpage`, `review-id-locator`, `reply-cross-source` | Source of truth RULED 2026-07-20. **Nothing to integrate from this branch.** |

---

## 2. Integration candidates

**In scope — the 14 unique commits on `feat/naver-smartstore-v1`:**

| Commit | Subject | Surface |
|---|---|---|
| `144e8e0` | v1 working plan (phase source of truth) | docs |
| `f9d069c` | guided-connection wizard (G3-A/B, offline) | onboarding |
| `5c7d461` | plan: wizard built offline (B9 resolved-offline) | docs |
| `06ac57c` | G3-C assisted live-walk preflight (plan-only) | docs |
| `f7ab96f` | read-only API-center observation harness (G3-C.2, offline) | onboarding |
| `18171b2` | dedicated-profile session continuity (B4, offline) | session readiness |
| `0eef9ad` | live bridge session detection → readiness (B4) | session readiness |
| `e80f313` | API-center harness browser-safe + pre-launch URL screen | onboarding |
| `33a09a4` | API-center guided tutorial observer | onboarding |
| `a243d29` | manual API-center tutorial checkpoints | onboarding |
| `ac67a0f` | two-step API-center tutorial calibration | onboarding |
| `cdd01c8` | extend API-center navigation checkpoint timeout | onboarding |
| `de0aa4b` | read newest API-center tab during checkpoint | onboarding |
| `58b102e` | classify API-center detail pages before app lists | onboarding |

**Excluded from the manifest, deliberately:**
- `12c93a8` — **already upstream** (dup of `6e2f932`). No action; do not re-apply.
- Worktree `sellerops-naver-live-review-match` **uncommitted** work (session-account binding/identity/
  verify/probe + `run-guided-reply-session-live-naver.ts`, ~14 new files). **NOT in v1 scope, NOT owned by
  this manifest** — it is post-#315 work in its own worktree. **[PO] decision required** on whether it is
  post-v1 or a late v1 addition; the default and recommendation is **post-v1**.

---

## 3. Local uncommitted changes — keep / drop / review

Working tree: 21 entries. Classification:

| # | Path | Verdict | Ground |
|---|---|---|---|
| 1 | `CLAUDE.md` (+53) | **KEEP** | Product-boundary rules — governance, must ship. |
| 2 | `collector/CLAUDE.md` (+29) | **KEEP** | §4.7 product-boundary check — governance, must ship. |
| 3 | `docs/action-window-runtime/naver-smartstore-v1-plan.md` | **KEEP** | All four PO rulings. |
| 4 | `docs/action-window-runtime/HANDOFF.md` | **KEEP** | Ruled pointers. |
| 5 | `docs/action-window-runtime/current-state.md` | **KEEP** | 1-line touch. |
| 6 | `docs/action-window-runtime/g3c-live-walk-preflight.md` | **KEEP** | Stale-harness correction + G3-C-not-gating ruling. |
| 7 | `docs/slices/naver-guided-connection.md` | **KEEP** | §0 v1-completes-at-G3-A/B ruling. |
| 8 | `collector/src/action-window/reply-submission/reply-target-bundle.ts` | **DROP** | **Byte-identical to `origin/main`** — already upstream; arrives via the merge. |
| 9 | `collector/src/cli/prepare-reply-target.ts` | **DROP** | Byte-identical to `origin/main`. |
| 10 | `collector/test/.../reply-target-bundle.test.ts` | **DROP** | Byte-identical to `origin/main`. |
| 11 | `collector/test/cli/prepare-reply-target.test.ts` | **DROP** | Byte-identical to `origin/main`. |
| 12 | `collector/src/cli/discover-reply-target.ts` (+301/−16) | **SPLIT — see §4** | Three layers: settle hardening (keep) · sentinel mode (keep) · ladder wiring (drop). |
| 13 | `collector/test/cli/discover-reply-target.test.ts` (+406/−4) | **SPLIT — see §4** | Same three layers. |
| 14 | `collector/src/action-window/reply-submission/review-row-candidate-ladder.ts` (untracked) | **DROP** | Dead-lettered — see §4. |
| 15 | `collector/test/.../review-row-candidate-ladder.test.ts` (untracked) | **DROP** | Dead-lettered — see §4. |
| 16 | `collector/src/naver/review-download-save.ts` (+78) | **REVIEW** | Differs from main; authored outside this session — unreviewed. |
| 17 | `collector/test/naver/review-download-save.test.ts` (+82) | **REVIEW** | Same. |
| 18 | `collector/test/naver/review-usage-confirm.test.ts` (+2) | **REVIEW** | Same. |
| 19–21 | `.claude-worktree-owner`, `git`, `remote` (untracked) | **NEVER TOUCH** | Stray root artifacts — never stage, never delete. |

---

## 4. Ladder decision (explicit)

**RULED — the review-row candidate ladder is dead-lettered and does NOT ship in v1.** It was superseded
before adoption; its one live pass returned a negative result (201 `ul > li` candidates, 0 `REVIEW_ROW`,
`UNCALIBRATED`), and the guided-reply answer is owned by the operator-assisted calibration stack already on
`origin/main` (RULED 2026-07-20).

| Component | Decision |
|---|---|
| `review-row-candidate-ladder.ts` + its test (untracked) | **DEAD-LETTERED — do not ship in v1.** Leave on disk untracked; **never staged**. Not deleted (standing "do not delete files"). |
| `ladderCalibration` wiring in `discover-reply-target.ts` | **REMOVE / EXCLUDE before final consolidation** — the `ladderCalibration` field on `DiscoverySummary`, the `LADDER_PROBE_UNAVAILABLE` blocker, `sanitizeLadderProbes`, `MAX_RUNG_ORDINAL`, the ladder import, and the matching tests + no-leak allow-list entry. |
| `settleRowCensus` hardening | **KEEP CANDIDATE** — reusable utility, live-verified 2026-07-20 (no `ROW_CENSUS_SETTLE_TIMEOUT`, no false-empty). Ladder-independent. |
| `--require-sentinel` / `--sentinel` support | **KEEP CANDIDATE** — reusable utility; it is what made the cold-profile live runs viable (shared `.status/probe-same-session.ready`, stale-sentinel clear, fail-closed timeout, no page read on timeout). Ladder-independent. |

> ⚠ The keep candidates and the drop live **in the same two files**. Consolidation therefore requires a
> **deliberate de-wiring pass**, not a file-level keep/drop. That pass is code work and is **not
> authorized by this manifest**.

---

## 5. The docs unit (one commit)

Commit **as a single docs unit** (7 files, +524/−39 — no feature code):

`CLAUDE.md` · `collector/CLAUDE.md` · `docs/action-window-runtime/naver-smartstore-v1-plan.md` ·
`docs/action-window-runtime/HANDOFF.md` · `docs/action-window-runtime/current-state.md` ·
`docs/action-window-runtime/g3c-live-walk-preflight.md` · `docs/slices/naver-guided-connection.md`
(+ this manifest).

It carries: the **product-boundary check** (root + collector §4.7); **guided-reply source of truth**
(2026-07-20); **B6** — live reply submission not required for v1 (2026-07-20); **B9** — onboarding
completes at G3-A/B, G3-C not gating (2026-07-21); **B3** — export finding accepted as triaged
(2026-07-21). Stage **exact files**; never `git add .`.

---

## 6. Code changes needing separate review before commit

1. **The de-wiring pass on `discover-reply-target.ts` + its test** (§4) — removes ladder wiring while
   preserving settle + sentinel. Must be reviewed as its own change with typecheck + full suite green, and
   an explicit check that the sanitized output shape and the no-leak allow-list are consistent afterwards.
2. **`review-download-save.ts` (+78) / `review-download-save.test.ts` (+82) / `review-usage-confirm.test.ts`
   (+2)** — authored outside this session, differ from main, **never reviewed here**. Independent review
   required before any commit; do not fold into the docs unit.
3. **Post-merge reconciliation of `discover-reply-target.ts`** — main also changed this file, so the merge
   touches it on both sides. Re-verify after the merge, not before.

*(Items 8–11 in §3 need no review — they are already-upstream duplicates and are simply not staged.)*

---

## 7. Final green gate checklist

Run **after** sync-with-main and **after** the de-wiring pass, before any PR:

1. `cd collector && npm run typecheck` — clean.
2. `cd collector && npm test` — full vitest, hermetic (no network/browser, `RUN_INTEGRATION` skipped).
3. Frontend typecheck + unit tests (guided-connection state machine + `ConnectNaver`).
4. `git diff --check` — clean.
5. `package.json` / `package-lock.json` **unchanged**.
6. Forbidden-path sweep — nothing staged from `.env`, `.profile/`, `.status/`, `.connections/`,
   `downloads/`, `.reply-runs/`, `.reply-target/`, `findings/*.local.md`, screenshots, raw HTML, exported
   files; stray root `git` / `remote` / `.claude-worktree-owner` untouched.
7. Forbidden-content grep — no credentials, seller ids, tokens, raw review text, raw URLs.
8. Confirm the ladder files are **not staged** and no `ladderCalibration` symbol survives in staged code.
9. Backend build/test **only if** the merge touches Java (gated surface — needs explicit approval).
10. Re-run 1–4 **after** the merge commit, on the merged result.

---

## 8. Post-v1 — must NOT ship or be claimed in v1

| Item | Ruling |
|---|---|
| **Live guided reply submission** | RULED 2026-07-20 — not required for v1; separate PO approval + fresh single-use G6. Seller performs the final platform submission. |
| **First-time issuance assisted walk** (real freshly issued NAVER app → Vault → `test-connection` → `sync`) | RULED 2026-07-21 — post-v1; mutates Vault + local DB; separate PO approval + fresh G6; **not v1-verified**. |
| **Coupang / Cafe24** | Scope fence — next-channel targets **after** NAVER v1. Do not start, do not widen v1 into them. |
| **Automatic export / consent / download** | Never v1 behavior. Production export stays **human-driven Action Window**: the seller clicks export and consent on NAVER; SellerOps only detects, validates, and processes the resulting download. |
| **G3-C.1 / G3-C.2 as gates**; API-center automation | API-center is **guided tutorial support only** — no automatic issuance or linking, and **SellerOps never reads Client ID/Secret from the page**. |

---

## 9. Risks before final integration

1. **Merge surface is real, not trivial.** 26 files were touched on both sides (backend reply DTOs/service,
   `ReviewBodyFingerprint`, collector reply-target modules, `discover-reply-target.ts`, `upload.ts`,
   `contracts/review-fingerprint/v1/*`). `12c93a8` being already-upstream *reduces* this but does not
   eliminate it. **Mitigation:** sync with main **before** the de-wiring pass, so de-wiring happens once, on
   the final file.
2. **Ladder de-wiring can silently break the sanitized contract.** The no-leak allow-list and
   `DiscoverySummary` shape were extended for `ladderCalibration`; removing it must not leave a stale
   allow-list entry or an orphaned blocker enum. **Mitigation:** gate item 8.
3. **Three unreviewed local files** (`review-download-save*`, `review-usage-confirm.test.ts`) could ride
   into the release unexamined. **Mitigation:** they are `REVIEW`, never staged with the docs unit.
4. **Backend is a gated surface.** If the merge lands Java changes, the green gate needs an approved
   backend build — which the phase rules do not grant by default.
5. **`origin/main` may move again** between manifest and execution. **Mitigation:** re-run §0's topology
   check immediately before integrating; do not trust these counts if time has passed.
6. **Documentation drift is now the main correctness risk, not code.** Several rulings live in more than
   one doc; if the integration edits one and not the others they will disagree. **Mitigation:** the docs
   unit (§5) ships them together, in one commit.

---

## 10. Exact next action after this manifest

**Sync this branch with `origin/main`** — `git fetch origin` then merge `origin/main` into
`feat/naver-smartstore-v1` **locally** (a fetch + local merge; **no push, no PR, no remote mutation**), so
the 11 upstream commits land and `12c93a8`'s duplication resolves. Then re-run gate items 1–4 and report
the conflict set.

**This is a git operation and is NOT authorized by this manifest.** It needs an explicit instruction, and
it is the one step that must precede the de-wiring pass (risk 1). Everything else in §§4–7 follows it.
