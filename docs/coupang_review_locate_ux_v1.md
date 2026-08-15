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
| No row on this page matched | `TARGET_NOT_FOUND` | 이 페이지에는 없습니다 — 페이지를 넘겨 보세요, 넘기시는 동안 잠시 자동으로 다시 확인합니다 |
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

A parked locate re-reads the visible page on a bounded poll (every 2s, for ten minutes), so the band appears
when the seller lands on the right page — without them alt-tabbing back to SellerOps to press anything.
`REQUEST_STEP_RECHECK` remains available; the loop removes the *need* to press it, never the ability, and the
copy says "잠시" rather than promising a watch that never ends — see §8.

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

That sitting was taken at `c334b763`, before the independent review changed the code (§6.1). §5.1 is the
re-proof on the merged code, and it is the one that counts.

---

## 5.1 The re-proof on merged main — LIVE_PROVEN at `f357fafe`

A second sitting, `COUPANG_WING_REVIEW_LOCATE`, READ_ONLY, run `wt-9c2caad10d47` / approval
`apr-9503d9512dae`, pinned to `f357fafe` — merged main, review fixes included.

**What nearly made this proof worthless.** The backend serving the first attempt had been started at 06:09;
the review fixes were compiled at 15:14 and merged at 15:18, and the project runs `bootRun` without
devtools, so that JVM had loaded the pre-fix classes and would have kept serving them. The four things this
sitting exists to check — the read→highlight identity recheck, page pinning, the stale-binding guards, the
teardown — are all *inside* those fixes. Run as-is, the sitting would have produced a clean green log
proving the behaviour of code that is not what shipped, and the doc would have recorded it as LIVE_PROVEN.
**A long-lived dev process is a silent version pin.** Backend and frontend were both restarted from
`f357fafe` before the bootstrap; the harness pins the commit, but nothing pins a JVM that is already up.

Two presses on the same review, on a 10-row 상품평 page:

```
07:31:35  run_grant                GRANTED
07:37:14  locate_binding           resolved=true          ← press 1, its own binding
07:37:18  review_read              rows=10 excludedColumns=1
07:37:18  locate                   LOCATED matches=1 highlighted=true
07:38:36  locate_binding           resolved=true          ← press 2, a different binding
07:38:40  review_read              rows=10 excludedColumns=1
07:38:40  locate                   LOCATED matches=1 highlighted=true
```

| | before | after |
|---|---|---|
| `reviews` | 22 | **22** |
| `sync_jobs` | 2 | **2** |
| `channel_review_locate_ref` | 3 | **5** (= presses), both rows `consumed_at` non-null |

- **The four review-era additions do not block the happy path.** `matches=1` on both presses is the whole
  answer: the identity recheck accepted a row it had just read, and the pinned page was still the page.
- **The second press replaces the ring; it does not add one.** The operator confirmed **one row** outlined
  after press 2. This is the only way to check it — `highlighted=true` is written identically whether or not
  the previous ring was retracted, so the accumulation defect §6.1 fixed would leave exactly this log.
- **0 marketplace actions.** Every click / type / submit / navigate string in the 52-line log is banner or
  manifest prose.
- **0 stored.** Not one review written, not one sync job — on a path that reads 10 rows twice.

---

## 6. The ring landed where nobody looks, and no test could tell

The first attempt reported `verdict=LOCATED matches=1 highlighted=true` and the operator, looking at the real
screen, reported **no ring**. Both were correct.

The annotate script set `outline` on the matched `<tr>` with `outline-offset: 2px`. Measured in a real
Chromium:

```
outline-offset=2px   row-clip identical=true    whole-table identical=false
outline-offset=0px   row-clip identical=false   whole-table identical=false
```

**The ring was painted — outside the row's own box.** Nothing changed inside the row, which is where a seller
looks, and on the real WING list the operator saw no mark at all. The run had been reporting a fact about the
DOM and presenting it as a fact about the seller's screen, and every offline test agreed with it, because
every offline test asked the DOM and the DOM was telling the truth.

> **Correction, and the reason this section is worth reading twice.** The first diagnosis recorded here was
> "Chromium does not paint an outline on a `<tr>`". That is FALSE, and it was arrived at exactly the way the
> original bug was: by measuring the wrong region — screenshotting only the row's own clip, which an offset
> ring falls outside of. An independent review caught it and the measurement above is the re-check. The fix
> was right; the reason given for it was not. What is established is what was observed: the old treatment was
> not visible to the operator on the real screen, and the cell band is.

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

## 6.1 What the independent review changed

Four reviewers went over the diff before merge. What they found, and what it cost, is worth recording because
none of it was reachable from the offline suite as it stood:

- **A second press did not take the first ring off.** Pressing on B while A was rung left both rung — or, when
  B was not on the page, left A's ring on screen under the words "이 페이지에는 없습니다". The run now clears
  before it re-aims.
- **Three ways a read could be applied to the wrong run.** The first read, the poll tick, and a cancel all had
  windows in which an answer about the review the seller had LEFT completed or parked the run they had just
  pressed. Every async step is now bound to the run's binding, and a ring drawn for a run that has moved on is
  retracted.
- **The frontend could show the previous press's verdict under the newly pressed review** — for one round
  trip normally, and permanently with the socket down. Nothing is published now between a press and the
  agent's acknowledgement of it.
- **An index and a header width are not an identity.** A list that re-rendered with one new review on top
  passed both checks and rang a different review, reported as a successful locate. The annotate now re-checks
  the row's own printed date, rating and product.
- **Single-use was a read-then-write.** Two concurrent resolves could both spend one binding; the condition
  now lives in the UPDATE's own WHERE clause.
- **The teardown deleted inline styles it had not set**, taking WING's own with them.
- **`activePage()` re-resolved per call**, so a tab opened between ring and clear stranded the ring.
- Plus: page text reaching a log every two seconds through a pager diagnostic a locate never uses; the live
  driver constructed with no surface deps, making two documented guarantees inert in production; a
  single-use secret in a URL path; and a mint that checked null but not the rating's range.

Every fix is pinned by a test that was checked against the unfixed code — three of the first drafts passed
either way and were rewritten.

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

   **And for a textless review the fingerprint carries no information at all.** A blank body canonicalizes to
   `""`, so every rating-only 상품평 shares one fingerprint — on the first live account that was 86% of them.
   The match is then product + date + rating (+ option, when both sides print one). On ONE page a collision
   is safe: it lands on `AMBIGUOUS` and rings nothing. Across pages it is not: if the true row is on page 2
   and a collision sits on page 1, the run rings the page-1 row and reports a confident `LOCATED`. The
   ring-is-exact promise therefore holds for reviews with text, and for textless ones holds only as far as
   product + option + date + rating separate them.
3. **The seller must already be on the 상품평 목록.** The run does not navigate there, and will not: opening
   a marketplace window is one thing, driving it is another. The band appears once they arrive.
4. **The look-again loop is bounded at ten minutes and says nothing when it stops.** The copy asks the seller
   to press `[다시 확인]` "한참 뒤라면" rather than promising it watches forever, which is honest but not the
   same as telling them the moment it gave up. A run that re-parked on expiry would.
5. ~~**The entry point cannot be found, and that is now measured.**~~ **Fixed — see below.** The 상품평
   screen was reached only from the channel workspace's header (`[상품평]`, rendered when the channel
   resolved to `COUPANG`), with no route to it from `/connect`. **Both live sittings stalled here** — at
   `c334b763` the operator could not find the button, and at the §5.1 re-proof they reported the collected
   reviews as missing entirely. The data was never missing: the API answered `total=22` for that account
   while they were looking at a screen with no way in, and the sitting only continued because they were
   handed the URL directly. Twice is not a discovery anecdote; the surface had no path to a working feature.

   Unit #96 (`feat(connect): put the 상품평 record where a seller can find it`) put the entry on the
   `/connect` channel row itself, labelled with what is behind it (`상품평 22개 보기`), and restated the
   record as a panel above the workspace's connection sections. The count fails soft — a failed read drops
   the number and keeps the link — so the entry cannot disappear the way the feature did. Proven locally
   against the same 22 stored 상품평: one click from `/connect` to the record at 1440px and at 390px.
6. **No second-channel story.** `REVIEW_LOCATE` is Coupang-only by construction: the mint refuses any other
   channel, because the reader, the header roles and the pager all belong to the WING 상품평 screen.
7. ~~**The capability table and the record now disagree on the same screen.**~~ **Fixed — see below.**
   `GET /api/channels/COUPANG/capabilities/overview` returned `REVIEW: supported=false, UNSUPPORTED`, which
   the workspace rendered as the badge `리뷰 미지원` — directly under the #96 panel saying 22 상품평 were
   collected. Both statements were true, and that was the problem: one boolean was carrying two questions.

   **Two corrections to how this was first written down.** The overview is **not** read from the
   `connector_capabilities` table — it is computed from the in-code `ConnectorCapabilities` of the resolved
   `PullConnector`, and the table feeds a different endpoint that gates the schedule controls. And
   `supported` does not mean "the official API supports it"; it means "the resolved pull connector can serve
   it", which for Coupang coincides with the official API only because the resolved connector is the API one.

   Unit #107 added an **additive** axis to the overview: `acquisitionPaths[{method, verificationStatus}]`,
   populated from a narrow code-level `AcquisitionPathRegistry` — COUPANG/REVIEW → `ACTION_WINDOW` /
   `LIVE_PROVEN`. **Its evidence is not §5.1 above**: the claim is that the Action Window *acquires*
   reviews, so the sitting that proves it is `docs/coupang_review_acquisition_v1.md` §6.6 (22 stored into
   an empty database, then a re-sync storing 0). §5.1 stored nothing by design and proves the other
   half — that a stored review can be found again. `supported` / `verificationStatus` keep their meaning, the
   `connector_capabilities` table and schedule gating are untouched (an acquisition path is not a cadence),
   and the badge now reads `리뷰 수집 지원 · Action Window`. The absence of an official API is not inferred
   from `supported=false`: it is the connector's own `REVIEW_API` 제외 범위 note.

   **Three things #107 did not fix, named here so they are not mistaken for done.**

   1. **The counterweight is missing wherever the real connector is not resolved, and that is the default.**
      `SELLEROPS_CONNECTOR_COUPANG_ENABLED` defaults to false, so the answering connector is
      `MockApiConnector` — which also excludes REVIEW for COUPANG/NAVER, and declares **no** unsupported
      scopes. The registry is keyed on channel+type, not on the resolved connector, so the badge reads
      `리뷰 수집 지원 · Action Window` while `리뷰 API 없음 (쿠팡 미제공)` appears nowhere on the page. This
      is the **overclaiming** direction, which is the direction this axis exists to prevent, and it is a
      fixture gap in the dev/default configuration rather than a defect in the model. Fixing it means the
      mock declaring the honest scope, or the overview refusing a path whose connector is a stand-in —
      neither is a frontend copy change, and #107 was scoped not to chase it.
   2. **The 수집 설정 section still says 이 채널 미지원 for 리뷰, one scroll below the new badge.** That
      section reads a different endpoint (`connector_capabilities`, seeded `supported=false`) and gates
      whether a cadence may be switched on — an Action Window acquisition is a seated operator run, not
      something a schedule can trigger, so the row is correct to stay disabled. But nothing on screen
      carries that reasoning, so a seller reads 수집 지원 and 미지원 within one scroll. The fix is copy in
      the schedule row (e.g. 자동 수집 미지원), and that file was explicitly out of scope here.
   3. **The word 지원.** `docs/channel-capability-registration-matrix.md` reserves seller-facing "지원"
      for the 운영 지원 stage, and §4.1's Coupang REVIEW row still reads 셀러 표기 = 표기하지 않음 while GA
      is `POLICY_GATED`. The copy `수집 지원 · Action Window` was an explicit product-owner instruction in
      the #107 task, which outranks the matrix under the conflict priority — but the matrix and the shipped
      UI now disagree, and that column is the product owner's to set.
