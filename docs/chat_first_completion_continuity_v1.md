# Chat-first Completion & Continuity v1

> **What this is.** The normal path — *ask in the chat → step into Seller Center only where the platform
> requires a person → get the result in the same chat* — closed on the E2E and conversation infrastructure
> that already exists. No new Agent architecture.
>
> **Marketplace calls 0 · marketplace WRITE 0 · auto click 0 · auto download 0 · submit 0 · migrations 0.**
> The live acquisition proof this builds on is `9b4e0c6f` and is not re-run here.

---

## §1 An explicit READ instruction runs; a question about freshness asks

**Root cause.** 「네이버 리뷰 최신화해줘」 and 「오늘 네이버 리뷰 있어?」 reached the identical card, so a seller
who had just written the instruction was handed a button repeating it back. And 「그럼 최신화해줘」 was worse:
the sentence names no object, so the planner had nothing to route on — measured live, the same words came
back once as a working-set refine that re-printed the two rows already on screen, and once as
「지금 먼저 하실 일은 없습니다」.

**Fix, in three parts.**

- `conversation/acquisitionRequest.ts` — a closed reading of the sentence: an action word, an object, and
  never a question. The object may be the conversation's (「그럼 최신화해줘」 under a review list is the same
  instruction), but only when the sentence names no *other* operational object — 「문의 최신화해줘」 is about
  inquiries whatever is on screen.
- `conversation/acquisitionStep.ts` — the instruction is carried out deterministically. It is **not a goal
  planner**: it is the same family as CLICK==FOCUS and the anchored PREPARE — a closed action on an object
  the conversation already holds, run through the machinery that owns it. One read (the channel's coverage)
  names the account and the path; a sentence it does not recognise, a channel it cannot resolve, and a
  channel whose acquisition is AUTOMATIC all fall through to the planner unchanged.
- `HumanActionRequiredArtifact.autoStart` — the card starts its guided run on arrival instead of rendering
  the control that asks for the instruction again.

**Freshness decides whether we must ASK, never whether the seller may ask US.** Once §4 landed, the channel
read FRESH and the rows path had nothing stale to act on — so an explicit instruction now treats every
readable channel as one to act on (`reviewRows.ts`), and the card is a required step rather than an offer.

**A query with missing freshness is unchanged in kind and clearer in words:** the card names when the
channel was last read (「오늘 12:43 이후 아직 확인하지 못했어요」) and carries exactly one primary, now labelled
for the question it answers — **「최신 상태 확인」** rather than 「최신 리뷰 가져오기」, which described our import.

**Nothing is widened.** The run behind the card is the same guided READ, performed in the seller's own
window with the marketplace's own confirmations. Every marketplace WRITE, composer fill and submission keeps
the approval contract it has; no write path reads any file added here.

## §2 Plan / segment / merge leave the normal flow

**Root cause.** The conversation lane stitched the plan itself: list plans → if none open, create one from
the **first of the current month** → extend → ask for the next segment. The month it guessed had nothing to
do with what the account had already covered, which is how a seller ended up abandoning a plan, typing
dates and merging segments to ask a question the product could answer.

**Fix.** `POST /api/imports/reviews/plans/next-launch?accountId=` — find or create the plan, carry it to
today, authorize the next run, in one call. The period is **derived from the account's verified coverage**
(`ReviewImportCoverage.lastCoveredDate` across all its plans), not from the calendar. Calendar months stay
the unit — one export per month is a bound the marketplace screen imposes — and an overlapping month is
safe by construction because ingest dedups. An account with nothing covered starts at the current month;
reaching further back is `/connect/review-history`'s job, where the seller can see what it costs.

## §3 The completion is summarised in the same conversation

**Root cause.** A finished run said 「새 리뷰 가져오기가 끝났습니다」 and nothing else — true, and silent about
the four things the seller wanted.

**Fix.** `GET /api/imports/reviews/runs/{syncJobId}/acquisition` answers the window and the three tallies
from the attempt row the ingest wrote. **The client names WHICH run; the server says WHAT happened** — a
count the browser hands back and the transcript prints as fact is a number nobody verified. The sentence is
`conversation/acquisitionSummary.ts`, and it carries no internal word (no plan, segment, sync or
provenance). A run that is not a guided acquisition keeps the sentence that was always true.

## §4 Freshness comes from acquisition provenance

**Root cause.** Two records can prove a channel was read and only one was consulted. A connector pull writes
a sync run stamped with the account and data type; a guided acquisition writes an upload-shaped run **plus**
the `ReviewImportSegmentAttempt` that is its actual provenance. So a NAVER account holding 4,455 reviews
acquired by approved export answered 「아직 확인한 적이 없어요」 — because a column that happens to be null
decided it.

**Fix.** `ChannelCoverageService.lastSuccessfulSync` takes the later of the two records for REVIEW.
**Nothing is backfilled**: the attempt row was always there, and this is a second reader of it. Measured on
the real Demo Org after the change: NAVER REVIEW `lastSuccessfulSyncAt = 2026-09-02T03:43:03Z`, the E2E
acquisition's own instant, where it had been `null`.

## §5 Channel continuity reaches the READ

**Root cause.** The previous package hid the foreign channel's card. The read underneath was still org-wide
— hiding a card a read produced is not continuity, it is a different answer with one column painted over.

**Fix.** `conversation/channelFocus.ts` — the focus is **the last channel the SELLER named**, derived from
the transcript on every turn (no stored field, survives reload). Not the last channel an answer happened to
draw: an answer's channels are ours, a sentence's channel is theirs. It only ever **fills a hole** — a plan
that names a channel keeps it, 「전체 채널」 clears the focus — so the failure direction is "not narrowed",
never "narrowed to the wrong one". Applied once per turn and shared by the graph's read and the service's
own axis, so the rows and the sentence about them cannot be scoped differently.

**Two overrides keep the focus and the rest drop it.** An explicit new LIST is a fresh ORG question
(Conversation Core v1 §9) and must not inherit — that contract is unchanged. `EMPTY_SET` (the sentence IS a
refine) and the new `ACQUISITION_REQUEST` (an instruction about the channel in focus) keep it.

**A scoped read names its scope on the object:** the review card's title carries the channel, so a narrowing
the seller did not restate this turn is still visible where the rows are.

## §6 The reply-carrier ticket storm

**Root cause, measured in the helper's own log:** seven `bridge_ticket_minted` inside 70 ms for one screen.
`useReplyRuntime` connected per MOUNT, and a conversation can hold several reply cards at once, each mounted
twice under `React.StrictMode`. Every one minted a single-use ticket and opened a socket.

**Fix.** `replyConnection.ts` — one refcounted session for the app, because the thing being shared is a fact
about the machine, not about a card. The first lease connects, the rest wait on the same promise, the last
release closes. The short grace window before closing is not a heuristic: StrictMode unmounts and remounts
in the same frame, so an immediate close would tear down the session the next mount is about to ask for.

## §7 The period the seller said

**Root cause.** The period axis held weeks and trailing day counts and **no months**, so 「이번 달」 had
nothing to be planned as and came back as 「이번 주」 — a smaller question answered under the seller's own
words. Same shape as the `LAST_N_DAYS` defect: an axis that cannot hold what the sentence said drops it.

**Fix.** `THIS_MONTH` / `LAST_MONTH` as calendar windows (read off the date string, not counted in days),
prompt **v14**, plus `conversation/periodTerm.ts` — when the sentence names a calendar period in so many
words and the plan carries a different one, the sentence wins. It **corrects, never introduces**: a plan
with no period keeps none, because 「오늘 할 일」 is a queue question whose 「오늘」 is not a filter.

## §8 Visual hierarchy

- **Repeated thread titles.** A seller who asks 「네이버 리뷰 최신화해줘」 on three days got three identical
  rows. A time column on every row was removed for a good reason — it restated the order the list is in —
  so it comes back **only on the rows that cannot otherwise be told apart**.
- **The truncation said twice.** 「초안이 있는 문의 중 8건까지만…」 rode on the inquiry card AND in the turn's
  notes, a few centimetres apart. The card wins, for the same reason a step card wins over the prose beside
  it: it is the thing the sentence is about.
- **A total the rows contradict.** Observed 2026-09-02: 「답변을 기다리는 문의가 0건 있습니다」 above three rows
  waiting since 2016 — the count and the rows are different reads with different definitions of "waiting".
  The greeting keeps the number only while it can still describe the rows it introduces. The two
  definitions themselves are **reported, not reconciled** (below).

---

## Verification

| | |
|---|---|
| backend | **3,642** tests · 0 failures |
| agent-runtime | **814** tests · 0 failures · typecheck clean |
| frontend | **2,641** tests · 222 files · 0 failures · typecheck clean |
| browser | real Demo Org, 1440 / 1366 / 1152, before/after · horizontal scroll 0 · off-host requests 0 |

Console errors in QA are `503 http://127.0.0.1:47615/bridge/pair/request` — the local helper is not running
in this pass, which is what a missing helper looks like. No product request failed.

**Test contracts rewritten, and why.** Four, each because the contract genuinely moved:

- `HumanActionArtifact.test.tsx` — the card asks for ONE call (`launchNextReviewImportForAccount`) instead of
  the four-request stitch (§2), and the required CTA is 「최신 상태 확인」 (§1). The assertions about what the
  card must not do are unchanged, and two new cases pin `autoStart` and its absence.
- `useReplyRuntime.test.tsx` — the close is one tick late by design now (§6); the test waits for it rather
  than asserting it synchronously. Two new cases pin the storm and the StrictMode pair.
- `AgentOperatorResponseParserTest` — prompt version v13 → v14.
- `RecentReviewServiceTest` / `ReviewImportLaunchServiceTest` / `ReviewImportQueryServiceTest` — new
  constructor argument and new methods; existing assertions untouched.

**No safety assertion was weakened.**

---

## Reported, not fixed

- **Two definitions of "waiting"** — the home KPI counts operational work items
  (`countUnansweredOperational`); the inquiry feed counts the inquiry's own status. They disagreed live
  (0 vs. three rows). Which one the home briefing should mean is a **product-owner decision**; this package
  only stopped the sentence asserting a total its own rows contradict.
- **Planner variance** is unchanged. 「오늘 네이버 리뷰 있어?」 planned cleanly in three of four QA passes and
  한 번 실패했다 with 「요청을 어떻게 조사할지 계획하지 못했습니다」. The deterministic lanes added here are the
  answer for the sentences they own; the rest is still the planner's.
- **AUTOMATIC channels** are not handled by the acquisition lane — 「카페24 리뷰 최신화해줘」 falls through to
  the planner path, which refreshes through the product's own collection seam. Correct today; a single lane
  for both is a later decision.
- **「SellerOps 도우미」** stays the name in the pairing panel: it is the launchd program
  (`ai.sellerops.local-agent`) a seller must find on their own computer, and a pointer that calls the window
  by a different name is a worse defect than the inconsistency (NAVER Guided Acquisition closure §10).
- **The Demo Org's data moved during QA.** The restarted backend loaded the operator's scheduler env, a
  routine Cafe24 sweep ran, and the answered-elsewhere reconciler closed the 21-item backlog. That is the
  product working as designed (READ only, no marketplace WRITE), but it means the BEFORE and AFTER captures
  are not over identical data.
- **`CLAUDE.md` was not extended** with this package's canonical entry.
