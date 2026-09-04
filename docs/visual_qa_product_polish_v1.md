# Visual QA & Product Polish Closure v1

2026-09-04. HEAD at start: `7138454b`. `frontend/` only — no backend file, no migration, no semantic
change. Knowledge/Retrieval, Grounded Drafting, Approval, Guided Browser execution, `workState`
semantics and product/inquiry/review scope semantics are **frozen** and untouched.

The package is an audit first and a fix second, and the fixes are to **repeated visual grammar**, not
to pages.

---

## §1 Design references actually used

| reference | how it was used |
|---|---|
| `shadcn` skill (`rules/composition.md`, `rules/styling.md`) | Read as judgement material — "use `Separator`, not raw border divs", "`Badge` not custom styled spans", "items always inside their group", "`className` for layout, not styling". **0 components imported, 0 dependencies added.** The registry targets Tailwind v4 + Radix; this repo is Tailwind 3.4 with no Radix, so an import would break silently (already recorded in `reviewnary_visual_system_v1.md`). |
| `ai-elements` skill (`references/message.md`, `conversation.md`) | Read for conversation composition. Nothing imported: the home thread already has its own message and artifact vocabulary and adding a second would be the "different product" gap this package exists to close. |
| `docs/reviewnary_design.md` | **The binding contract.** Type scale, spacing rhythm, surface levels, CTA hierarchy, status tones — every change below is an application of a rule already written there, not a new rule. |

Anthropic's `frontend-design` plugin is **not installed in this environment** (the skill list carries
`shadcn`, `ai-elements`, `migrate-radix-to-base` and three repo skills). Reported rather than assumed.

## §2 Before — screenshot audit, 1440×900, real Demo Org

Per screen: best thing · most jarring thing · must fix · leave alone.

**홈 / 대화** — best: no card soup at all; the work rows are the content and the brief sentence is the
headline. Jarring: a run-on strip of five different kinds of thing at 13px joined by dots
(`안녕하세요. · 오늘 주문 0건 · 최근 7일 부정 리뷰 0건 · 일부 채널 최신 수집 확인 필요 · 자세한 숫자 보기`),
and ~300px of nothing between the last work row and the composer. Must fix: nothing structural.
Leave: the composer dock — a short thread under a bottom-docked input is the dock's geometry, and
re-opening it is Chat UX, which is frozen.

**운영 숫자** — best: the emphasised KPI reads first and the caveat sits under the number it qualifies.
Jarring: four bordered tiles + three chart cards + a table container = seven surfaces. Must fix:
nothing. Leave: the tiles; each holds a number a seller presses.

**리뷰** — best: 내 답변 작업 above the record, and one solid CTA on the page. Jarring: line 2 is four
unrelated facts with **nothing between them** (`총 4432개 마지막 수집 시각 기록 없음 답변은 여기서…`) at
15px muted — the brief's 「작은 회색 글씨의 연속」 exactly. Must fix: that line. Leave (reported): the two
side-by-side stat boxes and the two-group filter row.

**리뷰 답변 작업** — best: one screen, approve visible, no scroll. Jarring: the review being answered is
16px regular — the same size as everything else — so the object of the task does not read as the object;
and the head line is four space-joined facts. Must fix: the head line. Leave: the two blue buttons
(they are sequential, not simultaneous).

**문의** — best: the row is the cleanest in the product (state · channel · product · customer sentence ·
time), one eye scan. Jarring: **the same words twice, 80px apart** — the page head's
「지금 처리할 일 21건」 and the section's 「지금 처리할 일 21」; and twenty semibold orange 「답변 필요」 marks
running down the left edge of a screen whose content is what customers wrote. Must fix: both.

**문의 상세** — best: the customer's sentence is the largest text; one primary CTA; evidence folded.
Jarring: the detail card runs 320px past its own content, which reads as a loading state; the rail rows
are a different density from the same rows on the list. Must fix: the meta line's separators. Leave
(reported): the card's tail and the rail density.

**상품** — best: the facet line (`네이버 · 문의 8 · 리뷰 1,761 · 답변 기준 2`) is the product's separator
grammar done right. Jarring: **「열기」 in brand colour on every row** — the row is already the link, so
that is the same action drawn twice, twenty times down the right edge. Must fix: that.

**상품 상세** — best: three tiles that are all doors, and the repeated-problem rows each open their
evidence. Jarring: the three tiles are ~500px wide each for a label and one number, so three wide empty
surfaces sit above the section that is the screen's actual subject. Must fix: the tile sizing.

**주문** — best: the most composed page in the product — compact figures, one chart, one table with bars.
Jarring: nothing. **Must fix: nothing. Left unchanged.**

**리포트** — best: the honesty rules (a failed source says so). Jarring: **five stacked cards, with cards
nested inside a card**, each with a grey description line, on a page whose job is reading. It is the one
screen built from a different primitive family (`Panel`) than every other screen (`Section`/`ListBox`) —
the 「다른 탭이 오래된 admin UI처럼 보이는」 gap, measured. Must fix: this.

**알고 있는 정보** — best: flat, compact metric line, a real primary action at the top. Jarring: source
rows list four facts with nothing between them. Must fix: that line.

**설정** — best: grouped list, one action per row, entirely consistent. Jarring: nothing.
**Must fix: nothing. Left unchanged.**

**채널 연결** — best: the alert bar and the per-row primary. Jarring: three sections that all mean "get
reviews" (정기 자료 가져오기 · 리뷰 수집 실행 · 리뷰 수집) and the internal word 「작업대」. Must fix: nothing
here — it is an acquisition-IA change inside the Action Window frontend workstream. Reported.

## §3 The five common problems

1. **Fact runs with no separator.** The same shape — several unrelated facts about one object on one
   muted line — is drawn on the review record header, the knowledge source row, the inquiry meta line,
   the reply-task header and the product row. Only the product row separated them, because separating
   them by hand means rendering the dot conditionally beside every optional fact.
2. **A repeated state mark louder than the content.** `Status variant="word"` carried colour **and** a
   dot **and** semibold — three emphasis carriers — so twenty identical 「답변 필요」 marks matched the
   weight of the customer sentences they sat beside.
3. **Boxes that hold almost nothing.** Five stacked panels on 리포트 with cards inside cards; three
   ~500px tiles on 상품 상세 for three numbers; figures stretching to a grid row's height.
4. **The same action drawn twice.** 「열기」 beside a row that is already the link.
5. **The same fact said twice within one screen.** 문의's page head and section heading.

## §4 What changed in the visual system

Six changes, all general, all in `frontend/`:

- **`Facts`** (`components/ui/ObjectRow.tsx`) — a run of facts on one line, separated by the product's
  drawn dot. `Children.toArray` drops `null`/`false`, so **an absent fact takes its separator with it**
  and the caller writes facts, not punctuation. Applied at the five measured sites.
- **`Status variant="word"` → `font-medium`.** Colour and dot unchanged; the third carrier removed. This
  is the one change that touches every queue row in the product, and it changes no word and no colour.
- **`lib/sharedWord.ts`** — the "a word every row carries is a fact about the list" rule promoted out of
  `lib/conversation/` (which re-exports it) and wired into the inquiry queue's section caption.
- **리포트: `Panel` → `Section`.** The page that reads becomes an outline instead of wallpaper; the two
  lists inside it become row lists with the product's own container; figures stop stretching.
  `Panel` itself stays — it is right around the settings **forms**, which are containment that means
  "your hand is needed".
- **상품 상세 tiles size to their content** (`grid-cols-3` → `flex flex-wrap`, `min-w-[9.5rem]`).
- **상품 rows drop 「열기」**; 문의's page head drops the count its own section heading carries.

**Not done, deliberately.** No new colour, no new type step, no new dependency, no component library, no
token migration, no abstraction ahead of an observed repetition — see §6 for the one abstraction that was
written, measured to be inert on this data, and reverted.

## §5 Page by page, measured at 1440

| screen | before | after |
|---|---|---|
| 리포트 | 1,400px · 14 bordered surfaces · nested cards | **1,072px · 10** · no nesting |
| 상품 상세 | 3 tiles ≈500px wide; 반복되는 문제 at y=428 | tiles hug content; **반복되는 문제 at y≈330** |
| 문의 | 「지금 처리할 일 21」 twice, 80px apart; 20 semibold warn marks | said once; state words recede |
| 상품 | 「열기」 ×20 in brand colour | the row is the control |
| 리뷰 | `총 4432개 마지막 수집…답변은 여기서…` | `총 4432개 · 마지막 수집 시각 기록 없음 · 답변은…` |
| 알고 있는 정보 | `자주 묻는 질문 전선몰딩 1호 2026-09-03 demo` | the same four facts, separated |
| 주문 · 설정 | — | **unchanged, on purpose** |

## §6 One abstraction written, measured, and reverted

The shared-word rule was wired into `/products` as well. Measured on the real org, the list is a mix —
`미답변 1` on two rows, `반복 문제` on six, nothing on two — so the rule correctly collapses nothing, and
shipping it there would have been an abstraction with no observed repetition behind it. Reverted.

**It also does not fire on `/inquiries` today, and that is the rule working.** The queue is 19 rows of
「답변 필요」 and **2 of 「초안 준비됨」** (`OPEN`×11 + `PROPOSED` without a draft ×8 + `PROPOSED` with a
draft ×2). `onlySharedWord` requires *every* row to agree, and loosening it to "almost every" would hide
exactly the two rows a seller can act on fastest. So the caption stayed silent and the repetition was
answered the honest way instead — by taking the third emphasis carrier off the state word (§4), which
lowers the noise without hiding a distinction. The wiring stays because it fires for the common case (a
seller on one channel with one kind of work) and it reuses the declared rule rather than a second one.

## §7 QA

**13 routes × 1440 / 1366 / 1152**, real Demo Org, after restarting both processes on this commit:
**AA text-node violations 0** (composited backgrounds, every text node), **horizontal scroll 0**,
console errors 0, off-host 0. Long product names, long review and inquiry bodies, work-0 and work-many,
mixed channels and empty states are all present in this org's real data and were rendered.

`frontend` **230 files / 2,730 tests / 0 failures** (three consecutive full runs), typecheck clean. No
test was weakened; none needed rewriting, because nothing this package changed is a contract a test
states.

### The flake — caught, named, root-caused, closed

It reproduced during this package and the **failing test name moved between runs**, which is the tell.
Two captures:

- `리뷰 — narrowed to one product > states the scope, offers the way out, and drops the channel switcher`
- `리뷰 — the workflow surface > points at 채널 연결 when no review-capable channel is connected` —
  `AssertionError: expected "spy" to not be called at all, but actually been called 1 times`, the call
  being `getChannelReviewsStrict("acc-nv", {page: 0, size: 20, sort: "attention"})`.

Both in `src/pages/app/Reviews.test.tsx`, both passing in isolation.

**Root cause.** `acc-nv` is not in that test's fixture — the test renders an org with no review-capable
channel. The call came from the *previous* test. `ChannelReviews` reads the accounts first and reads the
record only in the **continuation** of that promise, so a test that ends as soon as its own assertion
passes leaves the second read queued. RTL's `cleanup` unmounts the component but cannot un-queue a
`.then` that is already scheduled, and the `active` guard inside it stops the setState, not the call. The
call therefore landed after `afterEach` had cleared the spies — inside the next test — and which test it
landed in depended on scheduling. Hence the moving name, and hence never reproducing in isolation.

**Fix.** Clear at the *start* of each test as well as the end. Hooks are an async boundary, so a
continuation queued during teardown has already run by the time `beforeEach` clears. Verified with three
consecutive full-suite runs, 2,730/2,730. It is one line plus the note that explains it, in the test
file; no production code and no other test changed.

**Screenshots.** The genuine before set is 1440 (13 screens, captured before the first edit). 1366/1152
are **after only** — a mis-capture overwrote the narrow before images with post-change renders and they
were deleted rather than presented as before. Said plainly rather than quietly re-shot.

## §8 The three visually weakest screens that remain

1. **리뷰** — two side-by-side stat boxes holding one number and three numbers, a two-group filter row
   whose halves are the same control type styled as different things, and 「목록」 as a section heading.
   The 내 답변 작업 card also wraps its own intro sentence and disclosure, making one very large surface.
2. **문의 상세** — the detail card runs ~320px past its content, and the rail draws the same rows at a
   different density from the list they came from.
3. **채널 연결** — three sections that all mean "get reviews", four ways in, and the internal word 「작업대」.

## §9 Purely design-side awkwardness still open

- The home thread's ~300px gap between the last work row and the docked composer.
- 「제목 없는 문의」 as a row's largest text — true, and it reads like the product forgot something.
- The 리뷰 channel switcher marks the active channel with a white box and the others with plain text;
  「which channel am I on」 is the weakest signal on that header.
- `인용 단위`, `작업대`, `demo` (an email local part rendered as an author) are internal words on screen.
- Settings' four groups are separated only by a gap, so the grouping is felt rather than read.

**One test file changed for a reason that is not visual** — `Reviews.test.tsx`, the flake above. Recorded
here rather than folded into the visual changes.

**마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 승인 0 · 마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행 없음.
