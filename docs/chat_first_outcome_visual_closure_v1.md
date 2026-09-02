# Chat-first Outcome & Visual Closure v1

> **What this is.** Six closures on top of Chat-first Completion & Continuity v1. No new Agent
> architecture; the planner, retrieval, approval and the proven NAVER acquisition are untouched.
>
> **Marketplace calls 0 · marketplace WRITE 0 · migrations 0.** The completion turn was rendered in a real
> browser from the acquisition the `9b4e0c6f` E2E actually produced — the run's own record, read back.

---

## §1 What is waiting is the WORK QUEUE; the inquiry feed is the workspace's source record

**Root cause.** The home brief asked two different questions and printed them as one: its number came from
the freshness-qualified KPI and its rows from `/api/inquiries/rows?status=UNANSWERED` — the customer's
inquiries as records. Measured on the real org: **10 actionable work items against 21 unanswered records**,
and separately a KPI that read 0 because it excludes channels whose collection is unproven. Neither number
is wrong. Showing them as one is.

**Fix.** The brief reads `/api/inquiries` — the queue that owns "what the seller has to do" — and says its
own total: 「지금 처리할 일이 10건 있습니다」 over the same rows. The KPI strip keeps its own, differently
qualified, number and its own caveat. **They are not reconciled**, because they answer different questions.

**An empty queue is not an empty shop.** With nothing actionable and records held, the brief names both:
「지금 처리할 일은 없습니다. 지금까지 들어온 문의 3건은 문의 화면에서 볼 수 있습니다.」 And the first-use
state stopped calling that shop empty at all: `held` counted only the 7-day window, so an org whose
inquiries are all older read 「첫 수집이 끝나면…」 while holding three of them. The backlog counter is
windowless and now counts — the two measures are not added, either one being non-zero is enough.

## §2 The completion turn, rendered from the real acquisition

`GET /api/imports/reviews/runs/{syncJobId}/acquisition` answers from the attempt row the ingest wrote. On
the Demo Org that is the E2E run: `2026-08-20 ~ 2026-09-02, new 115, duplicate 33, failed 0`. In the
browser the resumed turn reads:

> 네이버 스마트스토어 리뷰 8월 20일~9월 2일을 확인했습니다. 새로 들어온 리뷰 115건, 이미 확인한 리뷰
> 33건입니다. 이어서 확인하겠습니다. 오늘 확인 가능한 리뷰가 2건입니다. …

— which channel, which days, what came in, what was already held, no failures (silent, because there were
none), then the reviews that arrived and the next moves. No plan, segment, sync or provenance word.

**A real defect the rendering exposed.** The resume check read `GET /api/sync-runs` **unfiltered** — the
org's newest runs, capped — so a completed acquisition could fall out of the list behind the routine
collection of every other channel. On the real org the E2E run was no longer in it hours later, and a
seller pressing 「계속 확인하기」 would have been told the collection had not finished. The read is now
scoped to the step's own channel. `dataType` is deliberately not sent: an upload-shaped row carries the
type in `uploadType`, and filtering on the other column would drop exactly the rows this check looks for.

## §3 A freshness question is a shape; a refresh picks its action by capability

**Root cause.** 「오늘 네이버 리뷰 있어?」 has three parts this product owns — object, channel, period — and
nothing about it is discovered by planning it. Across four QA passes the identical sentence came back once
as 「요청을 어떻게 조사할지 계획하지 못했습니다」.

**Fix — a recovery, deliberately not a pre-empt.** `freshnessQuestionOf` recognises the closed shape;
`answerFreshnessQuestion` composes the answer from the same reads the specialist makes. It runs **only when
the planner produced nothing**, because the planner's answer carries claim levels, partial-collection
honesty and the resume gate that this lane does not reimplement — bypassing it would have traded a rare
failure for a permanent loss of those. Anything wider than the shape (a rating, a product, a ranking, a
follow-up over a set) is not recognised and the failure stands, exactly as before.

**The same intent, a different action per channel.** `acquisitionPlanFor` answers `GUIDED` or `AUTOMATIC`
from the capability, so 「최신화해줘」 asks for a seller step where one exists and runs the product's own
collection where it does not. The seller never learns which is which.

## §4 One primary object collection per turn

**Root cause of the "46 rows" reading: the metric.** The DOM census counted every `li` on the page — 12
sidebar threads and 7 nav items included. The bulk answer itself was already one collection with a head of
four. Measured properly, `main` holds 33 rows for a whole six-turn thread and the bulk turn draws one list.

**Fix, structural anyway.** `secondaryCollections` folds every object collection after the first in a turn
the seller asked ONE question of — the count stays, one press restores the rows — and a sentence that named
two domains (「리뷰랑 문의 둘 다」) folds nothing. `domainsAsked` counts the domains the SENTENCE names,
never the ones an answer happened to draw.

## §5 The helper the seller reads is 「reviewnary 도우미」

The deferral rested on one thing this repository could not verify: what the installed program is called on
the seller's computer. The product owner settled it. 76 seller-facing strings moved, plus the product prose
those screens still carried (「reviewnary가 대신 클릭하지 않아요」, 「reviewnary에 넘겼어요」) — a pointer at a
window this pass had just renamed could not keep calling it something else. Internal names are untouched:
the launchd label `ai.sellerops.local-agent`, the packages, the env vars, the connector ids, the repository.
`productName.test.ts`'s declared exception count fell **29 → 6**.

## §6 A frozen QA state

The previous package's before/after captures were taken while the routine scheduler was moving the org's
data underneath them. This pass ran with `SELLEROPS_COLLECT_SCHEDULER_ENABLED=false` and
`SELLEROPS_SELF_PILOT_ENABLED=false`, so every screen is the same state. The completion turn's thread is a
QA fixture written into the runtime's own conversation store — the shape a stale answer leaves behind,
pointing at the real acquisition; screen F is a disposable org created through the product's own signup
with three inquiry records inserted directly and no work items. Both are named in the report.

---

## Verification

| | |
|---|---|
| backend | **3,642** tests · 0 failures |
| agent-runtime | **817** tests · 0 failures · typecheck clean |
| frontend | **2,644** tests · 222 files · 0 failures · typecheck clean |
| collector | **9,398** tests · 0 failures |
| browser | 1440 / 1366 / 1152 · A–F · horizontal scroll 0 · off-host 0 |

The one console error per pass is `503 http://127.0.0.1:47615/bridge/pair/request` — the local helper is
not running, which is what a missing helper looks like. No product request failed.

**Test contracts rewritten, and why.** Each because the contract moved:

- `AgentHome.test.tsx` — the brief reads the queue (§1); five cases now state their own work, and one is
  rewritten as the records-held morning the fix exists for.
- `agentObjectV1.test.tsx` — the "collected and empty" fixture now says so on both counters, and a case is
  added for records older than the window.
- `productName.test.ts` — the deferral count, with the decision that moved it.
- `CompletedResult` · `AgentPairingPanel` · `macos-approval-presenter` · `confirmation-page-approval-channel`
  — the helper's name.

**No safety assertion was weakened.**

---

## Reported, not fixed

- **The strip and the brief still show different numbers on one screen** — 「현재 미답변 문의 0건」 above
  「들어온 문의 3건」 on the disposable org, because the KPI excludes a channel whose collection is unproven
  and the brief counts records. §1 says not to force them together; whether the STRIP's label should say
  what it excludes is a **product-owner decision**.
- **The completion turn says the same count twice** — 「오늘 확인 가능한 리뷰가 2건」 and 「이번에 확인한 …
  오늘 작성된 리뷰는 2건」. Tried suppressing the second when the numbers agree and **reverted it**: that
  sentence is the claim ladder (what is held vs what this run brought in), and the distinction is exactly
  what `reviewClaim.ts` exists to keep.
- **The freshness lane is a recovery**, so a planner that answers the shape *wrongly* (rather than failing)
  is still the answer the seller gets.
- **The QA fixtures are scaffolding**: a conversation JSON in the runtime store, and three inserted inquiry
  rows plus one CONNECTED account row on a disposable org (`기록만 있는 상점`). No marketplace, no
  credential, and nothing written to the Demo Org.
- **`CLAUDE.md` was not extended** with this package's canonical entry.
