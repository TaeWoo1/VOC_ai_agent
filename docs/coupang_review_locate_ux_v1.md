# Coupang Review Locate UX v1 — `[쿠팡에서 보기]`

**Status:** built, live-proven 2026-08-15, merged as one unit.
**Companion:** `docs/coupang_review_acquisition_v1.md` (what is stored, and how a review is recognised
again). This document owns the *entry point*: the seller pressing a button and being shown that review on
Coupang's own screen. It supersedes that document's §7 item 3, which recorded this as not done.

---

## 1. What the run is, and what it is not

A locate is the narrowest run in this codebase. The seller presses `[쿠팡에서 보기]` on a 상품평 SellerOps
already stored; the Local Agent reads the 상품평 목록 page the seller has on screen, compares every row
against that one review, and — when exactly one row matches — draws a band around it and scrolls to it.

That is the whole run. It **stores nothing**: unlike the acquisition walk, which reads the same rows through
the same reader and hands them to the backend, there is no handoff on this path. It turns no page, presses
nothing, types nothing, and navigates nowhere.

**It is not a link.** Coupang publishes no per-review URL and no review id, so there is nothing to link to;
the review is re-found by matching. That is why the button has a run behind it and a status line beside it
rather than being an anchor.

---

## 2. Why a binding, on a run that mutates nothing

The Action Window contract forbids anything that identifies a review on its wire. What finds a review on the
screen is product, option, date, rating and the body's `review-body-fingerprint/v1` — a bag of fields that,
taken together, *describes one buyer's review*. So it does not travel:

```
seller presses  →  backend mints a single-use locateRef (16 hex)
                →  the browser carries ONLY that into START_RUN(REVIEW_LOCATE)
                →  the Local Agent spends it over its OWN authenticated session
                →  and gets back the five fields it matches on
```

The frontend never receives the locate target and could not display it. The `locateRef` is single-use and
short-lived (10 minutes): the run holds the resolved target for its lifetime, so re-checking after the seller
turns a page needs no second resolve, and a token that outlived its run would be a re-usable handle to one
buyer's review.

**A review that cannot produce a usable target is refused at the PRESS** — no 노출상품ID, no 별점 or no
등록일 means the target matches nothing anywhere. Minting it anyway would open the seller's browser and then
report the review is "not on this page", which says the review is elsewhere when the truth is that SellerOps
never had enough to look with.

---

## 3. The four things the seller can be told

| What happened | Blocker | What the screen says |
|---|---|---|
| Exactly one row matched | — | 쿠팡 화면에서 이 상품평에 테두리를 그렸습니다 |
| No row on this page matched | `TARGET_NOT_FOUND` | 이 페이지에는 없습니다 — 페이지를 넘겨 보세요, 넘기시는 동안 계속 확인합니다 |
| Two or more rows matched | `TARGET_AMBIGUOUS` | 어느 줄인지 가릴 수 없어 **아무것도 표시하지 않았습니다** |
| The screen is not a readable 상품평 목록 | `UNSUPPORTED_STATE` | 상품평 목록 화면을 띄워 주세요 |

Plus two that are about SellerOps rather than the page: the binding could not be resolved
(`LOCATE_TARGET_UNRESOLVED`, terminal — press again), and the agent is not reachable at all (reported from
the transport refusal, so "not paired", "agent off" and "agent busy with something else" are different
sentences).

**The copy is locate-specific on purpose.** `TARGET_NOT_FOUND` on a guided walk means "a control that should
be on this page is missing" — a fault. Here it means "your review is on another page" — not a fault at all.
Rendering the shared blocker wording would tell a seller something is broken every time they are on page 2,
so `frontend/src/lib/actionWindow/locate/locateCopy.ts` owns this surface's sentences.

**Two matches is a refusal, not a choice.** There is no path from `ambiguous` to a highlight. The failure a
lenient match produces is not "no ring" — it is a ring around a different buyer's review, which the seller
reads as SellerOps telling them who wrote what. (The collision it protects against is real and known: two
textless 상품평 on the same option, the same day, at the same 별점 are indistinguishable — see the
acquisition doc §3.)

---

## 4. Looking again while the seller turns pages

A parked locate re-reads the visible page on a bounded poll, so the band appears when the seller lands on the
right page — without them alt-tabbing back to SellerOps to press anything. `REQUEST_STEP_RECHECK` remains
available; the loop removes the *need* to press it, never the ability.

Each tick is a READ of the page in front of the seller — the same read the acquisition walk performs at a
checkpoint, with the same result: nothing is stored, and the log line is enums and integers. It stops the
instant the run leaves the park, is cancelled, or the window is closed, and it never re-reads a window the
seller closed (only their next command clears that latch).

---

## 5. What the live proof established — 2026-08-15

One sitting, `COUPANG_WING_REVIEW_LOCATE`, READ_ONLY, on the operator's own WING 상품평 screen against the
22 reviews the acquisition proof had stored.

```
run_grant                  GRANTED
aw_locate_client_attached  clients=1
locate_binding             resolved=true
locate_attempt             verdict=LOCATED matches=1 rows=10 highlighted=true
```

Verified against the database and the log, not against the run's own summary:

- **0 reviews stored** — `reviews` still 22, and 0 `sync_jobs` created during the sitting. The claim that
  this path has no handoff is measured, not asserted.
- **Bindings spent** — every minted `locateRef` has a non-null `consumed_at`; a second resolve is refused.
- **0 marketplace actions** — every occurrence of click / type / submit / navigate in the run's log is
  banner or manifest prose.
- **V40 applied on real PostgreSQL** (as did V39, which CI's H2 profile never exercises).
- **The band is visible.** The operator confirmed it on screen — which is the only check that matters here,
  and the one that found §6.

---

## 6. The ring was never drawn, and no test could tell

The first attempt reported `verdict=LOCATED matches=1 highlighted=true` and the operator, looking at the real
screen, reported **no ring**. Both were correct.

The annotate script set `outline` on the matched `<tr>`. Measured in a real Chromium, the row screenshotted
before and after:

```
computed outline on <tr> : rgb(43, 108, 255) solid 3px
pixels changed           : false
same treatment on cells  : true
```

**Chromium does not paint an outline on a table row.** The run had been reporting a fact about the DOM and
presenting it as a fact about the seller's screen — and every offline test agreed with it, because every
offline test asked the DOM, and the DOM was telling the truth.

The fix moves the band to the CELLS, where it paints: an inset `box-shadow` on the top and bottom of every
cell, closed with a left band on the first and a right on the last, plus a background tint, all `!important`
because this is a page SellerOps does not own. `box-shadow` rather than a border, so the seller's table does
not reflow under them. The row keeps the marker attribute, so what was rung is still one element to find.

`collector/test/action-window/coupang-review-highlight.browser.test.ts` asks the **pixels** instead: it
screenshots the row in a real Chromium, annotates, screenshots again, and requires the images to differ. One
of its cases pins the old treatment as painting nothing, so restoring it fails there while every DOM-level
test stays green. It also proves the teardown restores the row byte-for-byte, that no other row is touched,
and that a page fighting back with `!important` of its own still loses. Gated on `RUN_INTEGRATION=1`.

**This affects the earlier records.** The acquisition doc's §6.5 and §6.6 both report `highlighted=true` from
their locate legs. Those runs did find the right row and did mark it; what they could not have known is that
nobody could see it. Their locate claims should be read as "the right row was identified", not "the seller
saw a ring" — the second is true only from commit `c334b763` onward.

---

## 7. Where the pieces live

| Piece | File |
|---|---|
| The intent + its binding | `contracts/action-window/v2/index.ts` (`REVIEW_LOCATE`, `locateRef`) |
| The carrier kind | `contracts/action-window/aw-carrier-kind.ts` (`locate`) |
| Stage machine + contract mapping | `collector/src/action-window/coupang-review/review-locate-stages.ts` |
| The pure engine (never holds the target) | `collector/src/action-window/coupang-review/review-locate-engine.ts` |
| The session (holds it, and looks again) | `collector/src/action-window/coupang-review/review-locate-session.ts` |
| Binding → target, over the agent's session | `collector/src/action-window/coupang-review/review-locate-target-client.ts` |
| The band, and taking it off | `collector/src/action-window/coupang-review/review-row-inpage.ts` |
| Bridge carrier endpoint | `collector/src/bridge/review-locate-endpoint.ts` |
| The gated live host | `collector/src/cli/run-coupang-review-locate-live.ts` |
| Mint / resolve, single-use | `backend/.../review/channel/ChannelReviewLocateService.java`, `V40__channel_review_locate_ref.sql` |
| The button and its four outcomes | `frontend/src/pages/app/ChannelReviews.tsx`, `frontend/src/lib/actionWindow/locate/` |
| Approval phase + harness | `COUPANG_WING_REVIEW_LOCATE`, `tools/coupang-local/wing-review-locate-{bootstrap,preflight}.sh` |

---

## 8. What is NOT done

1. **One account, one screen shape.** The proof ran on a single seller's 상품평 list. The reader is the
   acquisition's, which has the same limit recorded against it.
2. **Ambiguity is reported, never resolved.** Two identical textless 상품평 on one option, one day, one
   rating remain indistinguishable, and this unit deliberately adds no tiebreaker — a buyer name or a row
   position would be exactly the unstable or identifying anchor the pilot refuses.
3. **The seller must already be on the 상품평 목록.** The run does not navigate there, and will not: opening
   a marketplace window is one thing, driving it is another. The band appears once they arrive.
4. **Discoverability of the entry point is unmeasured.** The 상품평 screen is reached from the channel
   workspace's header (`[상품평]`, rendered only when the channel resolves to `COUPANG`), and there is no
   route to it from `/connect`. During the live sitting the operator could not find that button; the API and
   the render condition both check out, so what failed is discovery rather than the code — and that is a real
   finding about the surface, not a defect I have reproduced.
5. **No second-channel story.** `REVIEW_LOCATE` is Coupang-only by construction: the mint refuses any other
   channel, because the reader, the header roles and the pager all belong to the WING 상품평 screen.
