# NAVER Guided Acquisition — Runtime Closure v2

> **What this is.** The 2026-09-02 live sitting (`apr-d84630691a99` → `apr-bd4c710a7a3e`, run
> `wt-3ef34c20b538`) reached `LOCATE_EXPORT` and named its verdict for the first time. It also produced five
> new blockers, four of them in code the sitting had to walk through to get there. This package closes six.
>
> **No live marketplace run happened in this package.** Marketplace calls 0 · WRITE 0 · download 0 · auto
> click 0 · submit 0 · model calls 0 · migrations 0 · backend source unchanged.

---

## 0. What the sitting established, and what it did not

`TARGET_AMBIGUOUS` at `LOCATE_EXPORT`, `count: 2`, on a surface the classifier read as `SYNC_DOWNLOAD` with
`hasActionableExportCandidate: true` and `asyncMarkerPresent: false`. So the export control is present, the
wording matches, and the layout is recognised — the run stopped because **two things matched and it refuses to
pick**. That is fail-closed working, not a locator bug.

`frameResolved: false` with `childFrames: 1` persists and is now **excluded as a cause**: the locate found two
candidates *in that context*.

**Not established:** what the two candidates were. The diagnostic carried a bucketed count and nothing about
the candidates, so no rule could be derived from it — and none was invented (§5).

---

## 1. A terminal run gives its slot back

`ImportSegmentHost.hostedRef` is the duplicate guard: a second `START_RUN` for the ref already hosted is
ignored, so one ticket cannot build two sessions. It was **never cleared when the run ended**, and the backend
mint is idempotent, so a retry carries the *same* ref. Every attempt after the first terminal run was answered
`IGNORE_ALREADY_HOSTED` and returned **in silence** — no host log, no refusal, nothing on the wire.

Measured on the day: sockets attached three times, `aw_import_host_run_hosted` **once** in 106 log lines, and
the seller's screen said 「판매자센터 창을 띄웠어요」. Restarting the helper made the next press work
immediately, which is what confirmed the slot — not the session — was the thing being held.

- `releaseIfSettled()` runs when a start arrives: a run that ended **without completing** releases its slot and
  clears `hostedRef`. `COMPLETED` deliberately keeps it (`isRetriableAfterImportRunStatus`) — a spent ticket
  must not host a second ingest of the same segment, and the next segment arrives under a different ref.
- The ignore branch **logs** (`aw_import_host_start_ignored_already_hosted`). A duplicate for a live run is
  legitimate; being illegible is not.
- "Is this run over?" had two hand-written copies — the host had none and the carrier had its own list. Now
  one definition, derived from `IMPORT_TERMINAL_STAGES`.

**And the frontend stops claiming success it cannot see.** 「판매자센터 창을 띄웠어요」 rendered on
`launched && !running` — "a ticket exists and this card is rendering no live view" — which is *exactly* the
shape of both failures: never hosted, and died. It now requires a live view. A minted ticket is a request; a
run the runtime is driving is the evidence. The recovery card also renders refusals now, and a **terminal**
blocker is no longer hidden behind a `running &&` gate that made a failed run render nothing at all.

## 2. A remount starts the run once, and never zero times

The start effect set `startedRef` **before** its first `await` and the cleanup never released it. Under
`React.StrictMode` — which this app mounts under (`main.tsx`) — pass one abandoned itself at
`if (!runtime || !live) return;` and pass two was refused by the ref. Result: no mint, no `START_RUN`, no
error, and a card that looked ready. That is the "sockets attach, nothing happens" shape from the sitting.

The two flags now say what they mean: `startedRef` guards an attempt **in flight** and is released when that
attempt is torn down; `committedRef` is set once a `START_RUN` has been handed over and is never released.
Both guided-run components carry it — the Coupang path had the identical bug.

**Honest limit, pinned in the test:** the *mint* may be attempted more than once under a double-invoked mount.
It is idempotent by segment — an open `ISSUED` ticket is handed back rather than a second one created, verified
against the live backend on 2026-09-02 — so what the test fixes is `START_RUN` exactly once and never zero.

## 3. A stopped run is described as stopped

The conversation card looked blocker wording up through `resolveCopy`, whose fallback is `COPY_FALLBACK` —
「안내를 준비하고 있어요」. `RUNTIME_FAULT` had no entry, so a run that had been dead for minutes told the
seller it was being prepared.

Two holes, both closed: the card now reads `blockerView`, whose fallback is at least honest, and every code in
`BLOCKER_CODES` has wording of its own. `blockerCopyCoverage.test.ts` drives that from the contract's own list,
so a new code fails the build until someone writes the sentence a seller will read. `RUNTIME_FAULT` says the
two true things — this run stopped, and the recovery is a NEW run — and deliberately does not offer 다시 확인,
which is the recoverable parks' repair and cannot restart a terminal run.

**A correction to the previous package's report.** "The seller UI was not the gap" was true of
`TARGET_NOT_FOUND` and false in general.

## 4. The 조회 step is not skipped, and the reason it was is not a wording list

`inferRequiresApply` needs exactly one apply control; it counted **45** and answered `false`, so `APPLY_RANGE`
was never planned and the seller went from the date fields to the export locate having never been asked to
press 조회.

The cause is one line: `hasApplyWording` lowercased the **entire opening tag** — attributes included — and
asked whether it contained `조회 · 검색 · 적용 · search`. On a real seller surface `search` is a substring of
ordinary `class`, `id` and `href` values. The in-page selector had *always* read `textContent` + `value` only,
so two implementations of one rule disagreed and the pure side was the wrong one — the exact divergence
`import-locate.ts`'s own header forbids.

**How the apply control became unique.** Two rules, and the second is the DOM relationship the sitting showed
was missing:

1. **Label, not markup.** Wording is read off element text plus `value`, and nothing else.
2. **Position relative to the date controls.** A candidate must FOLLOW the first actionable date input in
   document order. A filter's button belongs to the fields it applies to; a site-wide 검색 box in the page
   header does not. A surface with no date input yields no apply candidates at all.

Stated as document order rather than as a common ancestor **because both sides must compute the same answer** —
the pure side from serialized HTML (a character offset), the in-page side from the live DOM
(`compareDocumentPosition`). An ancestry walk is not exactly expressible in both, and a divergence there ends
every locate in `aw_import_locate_tag_divergence`.

Failing closed is unchanged: two real 조회 buttons after the dates is still `count: 2`.

**The compensating control that could not fire, said plainly.** The code justified the conservative default
with "a surface that did need applying is caught by the scope read-back". The read-back reads the date
**inputs**, which hold the typed value whether or not the range has been applied — it returned `MATCH` on
2026-09-02. That safety net does not exist on this surface, and the detection rule is now the only thing
standing there.

## 5. The export tie: what was fixed, what was not, and what may not be guessed

**A provable rule, taken.** A container matches on its child's accessible name, so a wrapper and the control
inside it are counted twice — `<span role="button"><button>엑셀 다운로드</button></span>` is one control and
two candidates. The innermost wins. This is **not a new heuristic**: it is the rule `markContinuationTarget`
has always applied to its own candidate set, now applied to this one, on both sides. It can only ever collapse
a nested pair; two disjoint controls stay two and the run still fails closed.

**A rule that may not be invented.** Whether 2026-09-02's two candidates were a nested pair is **NOT PROVEN** —
the log recorded a count and no structure. Picking one on ordering, or on "the one with an id", would be the
guess the DOM protocol exists to forbid, and it would silently authorize the seller to download whatever we
picked.

**So the next tie is decidable.** `exportCandidateShapes` reports, per candidate: element kind, WHICH
accessible source carried the keyword (text / aria-label / title), WHICH of **our own** keywords matched (an
index into our closed list — our word, never the page's), whether it declares `data-export="review"`, and its
ordinal. Enums, booleans and integers only. It rides in
`aw_import_export_locate_unresolved`, so one approved live run now produces the evidence a rule would have to
be derived from.

**Reported, not built: seller selection.** The panel already says 「대상이 여러 개예요 · 직접 알맞은 항목을
선택해 주세요」 and there is nothing on screen to select. Making that true needs one of two things this package
deliberately did not invent: a per-candidate press in the in-page panel (whose action set is a closed
vocabulary by design — that is what stops the seller's own page reaching the engine), or an unbound
download-detection path where the seller presses whichever control they mean and the artifact + scope gates
decide. Both are real designs; both are **product-owner decisions**, and neither is something to ship from
zero DOM evidence.

## 6. The recovery surface is reachable by pressing things

`/connect/review-history` is where a seller picks the period, continues a stopped run, and abandons a plan
covering the wrong days. Its only entry point was a ghost link inside the collapsed 「어떻게 진행되나요」
disclosure **of a different section** — which is not an entry point: on 2026-09-02 the operator reached it by
typing the URL and said so.

It is now the action of the section it belongs to (「리뷰 수집 실행」 → 「기간별로 가져오기」), and a stopped
run in the conversation offers 「기간을 다시 고르기」 beside 「다시 시도」 — the second exit a seller needs at
the moment they are told the run ended. The workbench link moved to that section's secondary line.

---

## Verification

| | |
|---|---|
| collector | **9,388** tests · 404 files · 0 failures · 20 skipped · typecheck clean |
| frontend | **2,631** tests · 221 files · 0 failures · typecheck clean |
| backend | untouched — no source, no migration, no test change |
| live | **none.** No marketplace contact of any kind in this package |

**Test contracts rewritten, and why.** Six, each because the contract genuinely moved:

- `import-locate.test.ts` ×3 — the apply control is now identified *relative to the date fields*, so cases that
  asserted it resolving on a surface with no date inputs now carry them. The wording assertions are unchanged;
  a new case pins the positional half.
- `GuidedImportCard.test.ts` ×2 — 「판매자센터 창을 띄웠어요」 now requires a live view, so both tests publish
  the run before asserting the sentence. The assertions themselves (the ticket is never rendered; the copy does
  not send the seller looking) are unchanged.
- `ConnectHub.test.tsx` ×1 — the link names changed with §6; the destinations, which is what the test is about,
  did not.

**No safety assertion was weakened.**

---

## Reported, not fixed

- **The export tie's identity** — §5. One approved live run, with the new per-candidate diagnostic, answers it.
- **Seller selection among genuine candidates** — §5, product-owner decision.
- **`frameResolved: false` with `iframePresent: true`** remains unexplained. It is no longer a suspect.
- **Channel continuity in the conversation** — see below. Deliberately untouched.

### Regression recorded, not repaired: the second turn loses the channel

Observed 2026-09-02. The seller asked 「네이버 최신 리뷰 확인해줘」 and the answer carried NAVER review rows;
the follow-up 「가장 최신 리뷰 확인하고 싶어. 오늘 들어온 리뷰 있나?」 came back with a Cafe24 inquiry list
above it and human-action cards for **both** NAVER and Coupang. The channel the first turn established did not
survive into the second.

It is recorded here and **not fixed in this package**: conversation semantics are frozen for this work, and
`agentic_experience_ux_v2` / `working_context_v1` own the anchor contract that would decide whether a channel
is part of the working context at all. Two readings exist and they are not equivalent — a channel mentioned in
turn one could be a *filter that persists* (like a selected inquiry) or a *description of what that answer
drew* (like the set the suggestion chips follow). Choosing between them is a product decision, and the wrong
choice silently narrows every later question.
