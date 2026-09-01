# NAVER Guided Acquisition — Live Findings Closure v1

> **What this is.** The 2026-09-01 live sitting (`apr-8d49636779f6` → `apr-3b7c1d9e4f20`, run
> `wt-f566f6e56fb3`) walked a real NAVER Seller Center as far as the range-confirm step and ended
> `BLOCKED`. It produced nine named defects. This package closes them **structurally** — not by patching the
> example that hit them.
>
> **No live marketplace run happened in this package.** Marketplace calls 0 · WRITE 0 · download 0 · auto
> click 0 · submit 0 · model calls 0 · migrations 0. The one live-shaped verification was a **local backend
> call** (`POST /plans/{id}/extend`) that touches no channel.

---

## 0. What the sitting actually proved before it stopped

Pairing (macOS dialog) → on-demand `import/naver` carrier → account-scoped window → seller login → review
search surface recognised (`dateInputCount=2`, iframe) → guidance overlay `READY` → both date barriers →
scope verdict. Then `LOCATE_EXPORT`, and nothing.

The stopping shape mattered more than the stop: **every failure was fail-closed** — `SURFACE_OPEN_FAILED`,
`SESSION_EXPIRED`, `SURFACE_SETTLE_TIMEOUT`, `UNREADABLE`, terminal. Nothing guessed its way forward.

---

## 1. A run that ends says where it died

`recordFailure` covered the eight **recoverable** reliability parks and nothing else. A terminal engine
failure — `TARGET_NOT_FOUND`, `TARGET_AMBIGUOUS`, `DOWNLOAD_TIMEOUT`, `ARTIFACT_INVALID`, `INGEST_FAILED`,
`RUNTIME_FAULT` — emitted no marker at all. Two sittings ended that way and neither was attributable.

**A correction to how this was first reported.** The seller UI was *not* the gap: `view.blocker` already
carried the code, the FE card had copy for `TARGET_NOT_FOUND`, and so did the in-page panel's guidance pack.
What was missing was the **log**.

- `ImportSegmentEngine.fail()` now captures the stage **before** overwriting it, and `terminalFailure()`
  answers `{code, stage}` — `TARGET_NOT_FOUND` alone cannot separate "the seller is on the wrong page" from
  "our export locator is wrong"; only the stage can.
- A new marker, `aw_acquisition_terminal`, deliberately **separate** from `aw_acquisition_failure`: the
  eight park states are recoverable by construction (`isRecoverable` is total-true), and widening that enum
  to hold terminal failures would make the invariant a lie.
- Emitted from `publishState()` — the single choke point every state change passes through — latched so it
  records once, so a terminal path added later cannot forget to announce itself.

**And the export locate now leaves evidence.** The date branch has logged a sanitized structural diagnostic
on every unresolved locate since it was written; the export branch logged nothing, which is why the sitting
died with no evidence. It now emits `aw_import_export_locate_unresolved` carrying `frameResolved`,
`childFrames` and the existing pure classifier `planExportAction` (layout enum + bucketed candidate counts —
never a selector, never page text). **The locate itself is untouched.**

## 2. A one-day window is a complete reading, not an unreadable one

`extractDates` de-duplicates, so a segment whose start equals its end produced one distinct date, and
`matchExportScope` required two. `MATCH` was **unreachable** for that segment shape — observed live as
`UNREADABLE datesParsed=1 spanDiffers=false` on a `2026-09-01 ~ 2026-09-01` window the plan itself had
minted. The seller was asked to confirm a range the runtime could have verified, and the run's scope
evidence was downgraded to `OPERATOR_CONFIRMED` for no reason.

One distinct date is now accepted **only** when the required window is itself one day **and** both controls
actually held a date (`countDateReadings`) — otherwise a half-filled picker would read as a confident MATCH.
Every other shape is unchanged, and every doubt still falls to `UNREADABLE`.

## 3. The confirm step stops pointing at the field it already finished

`onScopeRead` returned `"NONE"` on the confirm branch: no overlay, and the annotation left sitting on the
end-date control. The seller read that leftover highlight as "still waiting for this field" and reported the
run stuck on the second date box while it was in fact waiting on the panel. It now returns
`CLEAR_HIGHLIGHT` — the effect that already existed for finding 12, the same defect.

## 4. One command, one label per step

`REQUEST_STEP_RECHECK` means a different thing at every barrier, and the FE already had the lookup
(`recheckLabel`, `RECHECK_BY_STEP`) — the in-page panel used it and said 「기간이 같아요」. The conversation
card hardcoded 「내려받기를 마쳤습니다 · 다시 확인」 for all of them, so at the range-confirm step, before
anything had been downloaded, the only control on screen claimed the seller had downloaded a file. The card
now uses the same lookup, so the two windows say the same word.

## 5. A refused press is never silence

Two ways a press died and neither left a trace: `importRuntime.send` dropped anything the current view did
not allow **without writing a frame**, and a runtime rejection came back on the wire and was discarded.
From the UI, the log and the wire, "ignored" and "never sent" were indistinguishable.

- Helper: `aw_import_command_refused {type, reason}` — sanitized, the engine's own refusal enum.
- FE: `subscribeRefusal` distinguishes `NOT_ALLOWED_NOW` (never left the process) from `REFUSED_BY_RUNTIME`
  (made the round trip), and the card renders one line.

## 6. Already-correct is not "not done"

**Same root cause as §2, and the fix is the same one.** The mechanism was already there — the engine asks
`isTargetPrefilled` before arming the observer and reports the step `SKIPPED`. But `isTargetPrefilled`
requires `matchExportScope(...).match === "MATCH"`, which a one-day window could never return. Live:
`prefilled=false datesParsed=1`, and the seller had to change a correct date and change it back.

## 7. A finished run can start another

Once `engaged` is true the card replaces its primary with the run panel, so a run that reached a terminal
state left the seller with no control at all — after 「그만두기」 the card had neither 「최신 리뷰
가져오기」 nor anything else, and only a page reload brought it back. A terminal, non-`COMPLETED` run now
offers 「다시 시도」, which remounts the run component so the whole attach → plan → launch → `START_RUN`
chain runs again.

## 8. One calendar: Asia/Seoul

`ReviewImportLaunchService` already ran on `Clock.system(KST)` and its own docblock said why — "for a Korean
seller a UTC 'today' is yesterday for nine hours every night". `ReviewImportPlanController.extendPlan` passed
`LocalDate.now(ZoneOffset.UTC)` anyway. For the nine hours between KST midnight and 09:00 the two disagreed,
and "extend this plan up to today" is what decides how many days a segment covers.

At 00:52 KST the seller was handed a **single-day** segment on a date whose reviews they already had, while
two weeks of uncollected reviews sat outside any reachable window.

`ReviewImportCalendar` is three lines and no configuration — deliberately not a timezone framework. Storage
stays in UTC instants; this converts an instant to the date the seller reads, and does no other work.

**Verified end to end** at UTC `2026-09-01` / KST `2026-09-02`: `POST …/extend` moved the plan
`2026-09-01 → 2026-09-02` and minted a second segment. The same call was a no-op before.

## 9. A plan can be abandoned

`abandonReviewImportPlan` has existed since the plan model did and had **zero UI callers**. Invisible until a
plan is wrong: the card shows the newest non-abandoned plan and the range chooser appears only when there is
none, so a seller handed a plan covering the wrong days had no way back. 「다른 기간으로 다시 선택하기」 now
calls it, confirmed first because it closes a plan that remembers covered segments. Reviews already ingested
stay; nothing on the marketplace is touched.

## 10. The name a seller reads

The deferral was doing two jobs and only one was justified: naming the **installed helper**, and naming the
**product** in guidance prose the helper draws. The second had no reason to wait — a live seller read
「SellerOps 안내」 on the panel of a product called reviewnary.

125 string occurrences across 16 source files moved (the in-page panel header and its pack title, the NAVER
and Coupang walkthrough prose, the FE mirror), plus 3 JSX text nodes and one mirrored sentence in
`tools/coupang-local/wing-reveal-preflight.sh` — which a test caught, because that sentence is duplicated
and must not drift. `productName.test.ts`'s declared-exception count moved **40 → 29** and the docblock says
why, which is what that test exists to force.

**What deliberately did not move, and one thing that had to move back.** 「SellerOps 도우미」 is the name of
a program the seller installs and must find on their own computer; the launchd label is still
`ai.sellerops.local-agent` and this repository cannot verify what the installed application is called.
Renaming the instruction without renaming the thing it points at is the worse defect. The confirmation page's
pointer at the OS approval dialog was renamed by the sweep and **reverted**: that sentence names a window the
helper titles 「SellerOps 도우미 연결」, and a pointer that disagrees with the window sends the seller looking
for something that does not exist under that name.

Operator-facing CLI output (`collector/src/cli/`, including approval-manifest text) was left alone — it is
not seller-facing guided UI, and the approval contract's wording is not this package's to move.

---

## LOCATE_EXPORT — root cause **NOT PROVEN**, and deliberately not guessed at

The brief forbids speculative frame/locator changes and none were made. What the code establishes:

- The export locate and the date locate read the **same context** (`this.proven.surfaceContext()`), and the
  date locate **succeeded** in that context minutes earlier in the same run. So "the export control is in a
  frame we are not reading" — the 2026-07-25 root cause for the *date* controls, fixed then by moving off
  `page.content()` — is **weakened** as a hypothesis, though `surface_facts` did report
  `frameResolved: false` with `iframePresent: true`.
- Remaining live hypotheses, with no evidence between them: the export control is not on the review-search
  screen at that point in the flow; the wording no longer matches `EXPORT_WORDING`; or the layout is one the
  classifier reads as async/unrecognised.

`aw_import_export_locate_unresolved` is exactly the discriminator, and it needs one approved live run to
speak. **Nothing was changed on the strength of a hypothesis.**

---

## Verification

| | |
|---|---|
| backend | **3,631** tests · 0 failures · 25 skipped · `compileJava` clean |
| collector | **9,374** tests · 381 files · 0 failures · typecheck clean |
| frontend | **2,627** tests · 220 files · 0 failures · typecheck clean |
| integration | KST boundary proven against the running backend (local call, marketplace 0) |
| browser | `/connect/review-history` @1440×900 — 「다른 기간으로 다시 선택하기」 renders, no horizontal scroll, no off-host requests, old panel name absent; the 4 console errors are all `127.0.0.1:47615/bridge/health` with the helper intentionally down |

**Test contracts rewritten, and why.** `guided-panel-shell` (panel header name), `productName` (the
declared-exception count — the test exists to force this to be deliberate), and the copy expectations in
`reviewImport` · `CredentialDiagnosisPanel` · `CoupangIssuance`/`CoupangRenewal` · `tutorial` ·
`coupang-wing-*` · `reply-composer-inpage` · `confirmation-page-approval-channel`. Three runtime test stubs
gained `subscribeRefusal`. **No safety assertion was weakened.**

---

## Reported, not fixed

- **`LOCATE_EXPORT` root cause** — above. Needs one approved live run.
- **`frameResolved: false` with `iframePresent: true`** was observed and is unexplained. It did not stop the
  date controls being found, so it is not obviously the export cause, and it was not chased.
- **Segments stay one-day here.** The KST fix widened the plan to 09-02, and the planner made a *second*
  one-day segment rather than a two-day one. That is existing planner behaviour and was left alone — §2 is
  what makes that shape work.
- **Operator CLI copy** still says SellerOps (scope note above).
- **`aw_import_panel_intent`** logs `accepted` but not the command type; the panel path is narrower than the
  wire path (two commands) so it was left as-is.

## Ready for the next live proof

Everything the last sitting needed and did not have now exists: a terminal failure names its stage, the
export locate leaves structure, a refused press says so, a one-day window verifies exactly, the confirm step
draws itself, the labels tell the truth, an already-correct date skips, a dead run restarts, the calendar is
the seller's, and a wrong plan can be abandoned. **A fresh approval is required — none is carried forward.**
