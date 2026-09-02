# Chat-first Semantic & Surface Finalization v1

> **What this is.** The last four confusions, closed at their source, and the chat UX frozen. No new
> architecture; planner/model, acquisition E2E, retrieval, approval, channel contract and plan/segment are
> untouched.
>
> **Marketplace calls 0 · WRITE 0 · migrations 0.** QA ran on a frozen state (scheduler and self-pilot off).

---

## §1 A freshness question is ROUTED, not recovered — and the lane reuses the sources it answers from

**Root cause.** 「오늘 네이버 리뷰 있어?」 / 「네이버 리뷰 최신이야?」 / 「언제까지 확인했어?」 have three parts
this product owns — the object it stores, the channel whose coverage it knows, the period it can name — and
nothing about them is discovered by planning them. Planning them is where they went wrong: the identical
sentence failed once across four QA passes and answered a checklist on another. The previous package made
the deterministic answer a *recovery* after a planner failure, which left the variance the planner still
had when it answered wrongly rather than failing.

**Fix.** The closed shape is recognised (`freshnessQuestionOf`) and answered before the planner is asked.
Two shapes now: `ROWS` (what arrived in a window) and **`AS_OF`** (「최신이야?」, 「언제까지 확인했어?」 — the
state of the collection, with no list under it, because a list answers a question the seller did not ask).
`언제까지 확인했어?` names no object at all, so it leans on the thread and must carry a collection word.

**Nothing is recomputed.** The lane reuses `freshnessVerdict`, `staleSentence`, `asOfWord`,
`isFreshnessRequired` and `rowsSentence`, and the step card is now built by **one producer** —
`reviewRows.reviewImportStep`, shared with the rows path, because two lanes asking for the same step were
naming it two different things. Two more sources were unified in the process:

- the lane judges 「오늘」 against the run's **own reference date**, exactly as the graph does — asking the
  server clock made it judge a different day from the answer beside it;
- the card is built from the coverage row the caller **already read**, so the step could not say 「8월 27일
  기준」 while the sentence beside it said 「8월 20일 기준」.

**It stands down where it cannot answer in full.** A stale channel the product can refresh by itself
belongs to the planner path, which owns what a refresh means afterwards — partial said as partial, failure
with its reason class, and the claim ladder. Rather than reimplementing half of that, the lane returns null
and the run proceeds exactly as before. Every existing freshness contract still passes unchanged, which is
the evidence that the two paths agree.

**Variance measured, not asserted.** Each of the three sentences was asked three times, in a fresh thread,
at each of three widths: the answers are identical strings, character for character, with 0 planner calls.

## §2 One meaning for the home inquiry number

**Root cause.** The strip's number was the freshness-qualified KPI, which excludes channels whose
collection is unproven. On the disposable org it read 「현재 미답변 문의 0건」 directly above 「지금까지 들어온
문의 3건」 — both true, and only understandable if you know an internal definition.

**Fix.** The strip says the same 「지금 처리할 일」 the rest of the screen means: the work queue's own total,
the number the brief and its rows come from. The KPI keeps its place on the numbers screen, where its
exclusions are shown. Raw inquiry records stay what they are — the workspace's source record, named in the
brief's sentence when the queue is empty and reachable from the 문의 screen. **They are not reconciled**; a
failed queue read leaves the old number rather than a fabricated zero.

## §3 The claim ladder stays; the prose says the number once

**Root cause.** A completion said 「오늘 확인 가능한 리뷰가 2건입니다」 and 「이번에 확인한 … 오늘 작성된
리뷰는 2건입니다」 one line apart. They are two different grounds for one number — what is held, and what
this run brought in — and `reviewClaim.ts` is right to keep them apart. At the same count a seller reads 2
and 2 and has to work out why we said it twice.

**Fix, in presentation only.** When the counts agree the claim leaves the paragraph and becomes what it is:
the provenance of a number already stated, in the evidence disclosure. When they differ it is genuinely new
information and it is said. The ladder itself is unchanged.

## §4 The bulk turn, judged from the screen

The census that produced the earlier "46 rows" reading counted the sidebar and the nav. Judged from the
screenshot instead, the bulk turn is already what it should be: one prose line (「네이버 문의는 20건입니다」),
one collection, four representative rows, one expand (「문의 16건 더 보기」), one workspace link, three chips,
and the evidence folded. **No patch was made to reduce a DOM number.** The structural rule from the previous
package (one primary collection per turn unless the sentence named two domains) stands.

## §5 The console error is a real refusal, and it is not ours to silence

`503 http://127.0.0.1:47615/bridge/pair/request` comes from a helper that IS running and refusing to pair
(a detached resident helper answers 403/503 rather than granting). Asking is how the page finds that out,
and the browser logs any non-2xx resource. Removing the line would mean not asking. Left as is.

---

## Verification

| | |
|---|---|
| agent-runtime | **819** tests · 0 failures · typecheck clean |
| frontend | **2,644** tests · 222 files · 0 failures · typecheck clean |
| backend · collector | unchanged by this package |
| browser | 1440 / 1366 / 1152 · A–F · horizontal scroll 0 · off-host 0 · **variance 0 on A·B·C (3 runs each)** |

**Test contracts rewritten, and why.**

- `chatFirstOutcome.test.ts` — the lane is routed rather than recovered (`FRESHNESS`, planner calls 0), the
  question shape gained `ask`, and a variance case was added.
- `freshnessUx.test.ts` — one assertion moved from the message to the evidence disclosure (§3). Every other
  assertion in that file passes unchanged, which is what says the routed lane and the rows path agree.
- `AgentHome.test.tsx` — the strip's label (§2).

**No safety assertion was weakened.**

---

## Reported, not fixed

- **The lane stands down for AUTOMATIC channels**, so a freshness question about a channel the product can
  refresh itself still goes through the planner and keeps its variance. Closing that means moving the
  refresh/partial/claim semantics too, which is the planner path's contract and is frozen here.
- **`언제까지 확인했어?` with no channel in the thread answers for all three channels.** That is honest, and
  it is three sentences; whether it should ask which channel instead is a wording decision.
- **The QA scaffolding stands**: a conversation fixture in the runtime store and a disposable org with
  three inserted inquiry records. Nothing was written to the Demo Org.
- **`CLAUDE.md` was not extended** with this package's canonical entry.
