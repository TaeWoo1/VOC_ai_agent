# Chat-first Operating Experience v3

> **What this is.** `frontend/` plus one backend correction, aimed at a single question: does reviewnary's
> main surface read as a conversation with an operator, or as a workflow screen that happens to accept
> sentences? Measured first, on the real Demo Org, at 1440 / 1366 / 1152.
>
> **No marketplace run. No planner, retrieval, memory, approval or provenance change.**

---

## 0. What the before-audit measured

Four ordinary turns in one thread, counted from the rendered DOM:

| | turn A | turn B | turn E | turn G |
|---|---|---|---|---|
| bordered boxes | 8 | 31 | 53 | **59** |
| controls | 11 | 33 | 54 | **82** |
| solid (primary-looking) | 4 | 5 | 5 | **8** |
| list rows | 27 | 72 | 114 | **144** |

Nothing was wrong with any single turn. Each printed the list it answered with, and **no turn ever put its
list away** — so by the fourth question the answer to it arrived underneath three lists the seller had
already read. That is the whole of why the surface reads as admin UI: not decoration, accumulation.

Three more, all reproduced from the live screen:

- **Channel contamination.** A NAVER thread asked an ordinary follow-up and got a Cafe24 freshness footer
  and a **COUPANG step card** beside it — two solid primaries, three marketplaces, one question.
- **A card with three ways forward.** 「최신 리뷰 가져오기」 · 「계속 확인하기」 · 「파일로 직접 올리기」, plus
  a 「계속 확인하기」 chip 15 cm below repeating one of them.
- **A contradiction inside one answer.** 「지금까지 확인한 오늘 리뷰는 2건입니다」 directly above
  「네이버 스마트스토어 리뷰는 아직 확인한 적이 없어요」.

## 1. The conversation hierarchy, as changed

**A finished turn keeps its answer and folds its list.** The latest turn shows objects; older turns collapse
to one line that still states the count (`문의 20건 다시 보기`) and reopens on a press. Nothing is lost — it
is put away.

**A list answers with a head and offers the rest.** Four rows, then `리뷰 20건 더 보기` (`headRows.tsx`).
Four is enough to see the shape of what came back and to recognise the one you meant, and few enough that
the sentence above it is still the biggest thing in the turn. Lists of three or fewer are left alone.

**One step card per turn, and the thread's channel wins.** The runtime still raises a step per stale
channel and every one is true; stacking them under one answer is what turned a reply into a status board.
`threadChannel()` reads backwards for the first channel any object in the thread names, and the turn keeps
that card. This changes nothing about what was READ — scope belongs to the planner — only which of the
cards a turn produced belongs in THIS thread. The channel screen still holds them all.

**Escapes belong beside a step you are in, not beside the way in.** A card whose primary acts in place (a
guided run, a sync) holds 「계속 확인하기」 and the manual fallback back until it has been pressed; a card
whose primary sends the seller to another screen keeps them, because leaving *is* the step and the resume
control is how they come back. And a RESUME chip is dropped when a step card is on screen: the same press
15 cm apart makes the seller work out which one is real.

**One fact, one place.** Measured after: boxes **59 → 13**, controls **82 → 21**, solid **8 → 3**, rows
**144 → 71** at the same fourth turn; A/B/E in the table below. Console errors 0, off-host requests 0, no
horizontal scroll at any of the three widths.

| | A | B | E | G |
|---|---|---|---|---|
| boxes | 8 → **6** | 31 → **15** | 53 → **12** | 59 → **13** |
| controls | 11 → **9** | 33 → **20** | 54 → **17** | 82 → **21** |
| solid | 4 → **2** | 5 → **5** | 5 → **5** | 8 → **3** |
| rows | 27 → **27** | 72 → **60** | 114 → **60** | 144 → **71** |

## 2. The contradiction, fixed at its source

A guided import wrote its run row with **no `dataType` at all**, so
`ChannelCoverageService.lastSuccessfulSync(org, channel, "REVIEW")` could never see it. On 2026-09-02 a run
landed 115 NAVER reviews and the product went on saying the channel had never been checked — in the same
answer that showed the seller two of the reviews it had just collected.

`CollectionMethod.observesChannel()` names the distinction that was missing: a guided export and a guided
screen read observed the channel at the moment they ran; a `MANUAL_UPLOAD` is a file of unknown age, and
letting a year-old export refresh "last checked" is the same lie in the other direction. Only the observing
methods stamp a `dataType`.

**Not backfilled.** The existing run predates the fix and rewriting history to make a screenshot look right
is not a repair — the next guided import sets it, and until then the line stays.

## 3. Deliberately not done, and why

**「최신화해줘」 still needs the press.** The brief asks for an explicit READ request to start the guided
acquisition with no further CTA. It cannot: the seller's press is what authorizes opening their seller
center (`sellerops_live_approval_contract.md` §3 — the walk begins when the seller presses 시작), and
replacing it with a language model's reading of a sentence is precisely the substitution the contract
exists to prevent. What was fixed is the part that was really wrong: that press is now the card's **only**
control, and it is labelled as the action they asked for. **Product-owner decision** if it should change.

## 4. Reported, not fixed

- **The freshness footer still names other channels** in a NAVER thread. The rows really were org-wide (the
  planner's scope), so the footer is honest about what it is bounding; making it single-channel means
  changing what is read, which is planner semantics and frozen here.
- **Channel continuity is presentation-level only.** A follow-up with no named channel is still planned
  org-wide; this package drops the other channels' CARDS, it does not carry the channel into the plan.
- **The acquisition result is still not summarised in the thread** (「새 리뷰 115건 · 중복 33건 · 실패 0」),
  and plan / segment / merge are still the seller's to operate on the recovery screen.
- **`reply/naver` still mints a ticket per mounted consumer** (seven in 70 ms, live). The fix is a
  refcounted shared bridge connection in `useReplyRuntime`, and rewriting a socket lifecycle was not
  something to rush at the end of this sitting.
- **The planner answered 「이번 달」 with 「이번 주」** and thread titles repeat in the sidebar. Planner and
  thread-naming, both untouched.

## 5. Verification

frontend **2,636** tests · 222 files · backend **3,634** · failures **0** · typechecks clean. Collector
untouched. Live browser QA at 1440 / 1366 / 1152 against the real Demo Org, before and after, with the
screenshots kept outside the repository — they contain real customer sentences.
