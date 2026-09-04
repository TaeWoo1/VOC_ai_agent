# Secondary Workspaces UX Closure v1

2026-09-04. HEAD at start: `0f44dab0`.

Chat / Reviews / Inquiries / Products / Knowledge are **frozen** for this package. The subject is the
rest of the product — `/overview`, `/orders`, `/reports`, `/settings`, `/connect` and the navigation
over them — and the question is not "how should these look" but **"what job does each of them do, and
is what it says true."**

The audit came first, in a real browser against the real Demo Org at 1440 / 1366 / 1152. It found one
disease in three places, and that disease is what this package is about.

---

## §0 The finding

**Three seller-facing numbers, three definitions, and in two cases the same noun.**

| noun on screen | 홈 | `/overview` | `/inquiries` | `/reports` | `/api/inbox` |
|---|---|---|---|---|---|
| 지금 처리할 일 | **11** | — | **21** | — | — |
| 미답변 문의 / 답변이 필요한 문의 | — | **1** | — | **22** | **22** |

Every one of those screens links to at least one of the others. 홈's 「처리할 일 11건 전체 보기」 opened a
screen headed 「지금 처리할 일 21」. 「운영 숫자」 — the page whose entire job is the numbers — printed the
smallest and most wrong of them.

Neither number was a rendering bug. Both were computed, from real reads, by predicates that did not
match the words above them.

### A — a window predicate on a figure that has no window

`OperationsMetricsService.counted(state, rowsInWindow)` is this dashboard's honesty rule, and its own
docblock states it in two clauses: a channel is counted **either** when its collection is provably
current (so its zero is a measured zero) **or** when it actually contributed rows we hold.

`unansweredInquiries` was summed over channels that passed that rule *with the window's operand*:

```java
boolean countInquiries = counted(inquiryState, inquiry[0]);   // rows RECEIVED between the dates
long unansweredNow = channelRows.stream()
        .filter(ChannelMetricRow::countedInInquiries)          // ← the window verdict
        .mapToLong(ChannelMetricRow::unansweredInquiries)      // ← a point-in-time number
```

Cafe24 received nothing in seven days, so `countInquiries` was false, so its **21 standing unanswered
inquiries were dropped** — 21 rows sitting in this database right now, that 문의 lists, that the seller
owes an answer for. By the rule's own second clause Cafe24 qualifies; the code was asking the right
question with the wrong quantity.

The screen already knew. The section caption over the channel table reads
**「현재 미답변」은 기간과 무관한 지금 수치** — while the row beneath it printed `—` for a number the same
response was carrying.

**Fix.** One more verdict on the row, because there are two questions:
`countedInUnansweredNow = counted(inquiryState, unansweredHeld)`. Same rule, unrelaxed — an unproven
silence still never becomes a zero — asked with the operand it was written for. The KPI gets its own
exclusion count (derived from the rows, not appended to `exclusions`, which is the 「합계에서 빠진 것」
list and would print Cafe24 twice for INQUIRY) and its own `freshnessUnproven`.

Measured, same commit, same org: **1 → 22**, `excludedChannels` **2 → 1** (Coupang: holds none *and*
unproven, so it is still excluded and still named), and the Cafe24 row now prints `문의 —` beside
`현재 미답변 21` — two true verdicts on one row.

### B — a declared set that no endpoint served

`InquiryWorkItemPhase.AWAITING_SELLER = {OPEN, PROPOSED}` carries this comment:

> Declared once and read by every recommendation surface, so a phase added later has to be classified
> here rather than silently landing on one side.

No endpoint served it. `GET /api/inquiries` defaulted to `phase=OPEN` — one member of the set — so:

- 홈 asked without naming a phase, got **11**, and printed 「지금 처리할 일이 11건 있습니다」;
- 문의 asked **twice**, concatenated the two pages in the component, and printed **21**.

Two screens, one noun, two definitions, neither of them the declared one. The client-side sum had a
second defect the live data has not reached: each call is capped at 100, so an org with 300 OPEN items
would have had a page subset drawn as its own total.

**Fix.** The repository query takes the set (`w.phase in :phases` — one query, not a second copy of the
REAL/ACTIVE and answered-elsewhere clauses), the service takes a `Set`, and **no `phase` means
`AWAITING_SELLER`**. Naming a phase returns exactly that phase, so every caller that names one is
byte-identical. 문의 now makes **one** read and shows the server's own total; when the server holds more
than the page returned, the heading says so instead of letting the drawn rows read as the whole debt.

Measured live: no phase **21** · `phase=OPEN` **11** · `phase=PROPOSED` **10**. 홈 and 문의 both print 21.

### C — a filter parameter no screen has ever read

`INQUIRY_NEEDS_REPLY_PATH = "/inquiries?state=NEEDS_REPLY"`. The record's axis is `status`, and its
values are `UNANSWERED` / `ANSWERED`. `state` was read by nothing.

So 리포트's 「답변이 필요한 문의 22건」 and 홈's brief both opened the **whole record** and left the seller
to find the 22 among 94. The constant's own comment claimed the destination 「NEEDS_REPLY 필터가 그 행들을
보여준다」 — a filter that does not exist under that name.

**Fix.** `"/inquiries?status=UNANSWERED"`, whose `totalCount` is that same 22 — verified by clicking it
at all three widths and reading **전체 문의 22** on the landing.

The one site that did **not** get it is 홈's 「처리할 일 N건 전체 보기」: that number is the *queue*, and a
record filter would land the seller on a different set than the one counted. It goes to `/inquiries`,
whose first section is that queue.

### D — one question answered from two sets

The home palette's 「미답변 문의 보여줘」 titled its answer with the `/overview` KPI and filled it with the
`OPEN` work queue: the count never described the rows beneath it, and neither described the screen its
「전체 보기」 opened. It now reads `GET /api/inquiries/rows?status=UNANSWERED` once — heading, count, rows
and destination are one question.

---

## §1 `/overview` — what it is for, and the conclusion

**Kept, not promoted, headline corrected.**

Home is the control plane and answers 「무엇을 할 것인가」. `/overview` is the only surface that answers the
three questions home does not: **어느 기간인가** (7/14/30), **어떻게 변했나** (three trend charts), and
**어느 채널인가 / 왜 이 숫자인가** (the per-channel table with three freshness verdicts per row, plus the
「이 숫자에 대하여」 disclosure carrying 매출 기준, 주문 세는 단위, 합계에서 빠진 것, and the exact window and
comparison dates). None of that is on home and none of it belongs there.

It is reached from the home number strip's 「자세한 숫자 보기」 and is deliberately not in the menu — a
drill-down from the numbers it explains. That placement is correct and unchanged.

What was wrong was not its existence but its truthfulness: the page named 운영 숫자 printed the one
number in the product that every other surface disagreed with. §0-A closed that. **No KPI was added, no
insight was invented, and no number moved except the one that was wrong.**

## §2 `/orders` — audited, deliberately unchanged

Why a seller opens Orders, per the brief: 주문 사실 확인 · 배송 상태 · 고객 context · 상품 문제 조사. The
audit measured whether the data can answer any of them.

- The only order endpoint is `GET /api/orders/summary`, over `order_daily_summaries` — **aggregates
  only**. The screen shows 주문 수 · 매출 · 하루 평균 · 최다 채널 · 추이 · 채널별 매출. There are no rows.
- Per-order rows **do** exist: `channel_orders`, **450** in this org (NAVER 295 · COUPANG 155). They are
  read today by ingestion, the inquiry draft's order-fact reader, the coverage audit and the
  walkthrough — never by a seller surface.
- But they cannot answer those four jobs, and the reason is in the entity, not in the UI:
  - **no product.** `ChannelOrder` carries `externalOrderId`, `parentOrderId`, `rawStatusCode`,
    `normalizedStatus`, `paymentAmount`, `summaryDate`, `paidAt`, `statusChangedAt`. There is no
    product id and no line item.
  - **no shipping, by design.** `NormalizedOrderStatus` is `{PAID, UNKNOWN}` and says so out loud:
    *"Fail closed: we never guess a shipping / cancel / return / claim meaning from a code we have not
    observed live."* Measured: NAVER **295 PAID**, Coupang **155 UNKNOWN**.
  - **no customer** (the entity holds no buyer PII, correctly).

  A row list built on this would print, for every Coupang order, a status column reading 확인되지 않음,
  and for every order a blank where the product goes. That is not an operations workspace; it is the
  aggregate with 450 rows of noise under it.
- **Exact order inspection already has its doorway**, in the one place it can be honest: the inquiry
  detail's 운영 정보 card, fed by `InquiryOrderFactReader` (stored row when fresh → one bounded exact
  READ where a vendored contract exists → the stale row cited with its own date → a named reason).
  It renders nothing when the inquiry names no order, which is nearly always: **1 of 3,357** inquiries
  in this org carries a channel-supplied `source_order_ref`.

**Conclusion: no change.** What an Orders workspace needs is not UI — it is (a) widening the NAVER
request's `lastChangedType` so real status transitions are observed, and (b) an order → product line
linkage. Both are **product-owner decisions** and neither is invented here.

## §3 `/reports` — kept, made honest, dead numbers opened

Does it generate? Yes — from four live reads (`review-issues`, `inbox`, `item-analysis`,
`dashboard/summary`), with the standing rule that a source which failed renders as 확인할 수 없음 and
never as zero.

On what period? **A mixed one, and the page was applying the wrong half to the whole.** The recurring-
issue sections *are* periodic — `IssueChangeView` judges change over a recent surge window against an
eight-week baseline. The counts are not: 답변이 필요한 문의, 확인이 필요한 리뷰 and the FAQ candidates are
all standing-now. The page said 「이번 기간」 over both.

Fixed without renaming the page (the change lane really is the weekly part) by saying which is which:
the counts panel now carries **「기간과 무관한 지금 수치입니다.」** — the same distinction Executive
Readiness Fix v1 drew on 홈.

What a seller can then do with it — the part that was missing:

- **상품별로 몰린 이슈** was five rows naming a product, with a count, and **nowhere to go**. Every row now
  opens `/products/{id}`, the screen that owns 「이 상품에서 무엇이 반복되나」. A row with no product id
  stays readable and offers no door rather than a dead link. (Same shape Product Operations Continuity
  v1 closed on 상품 상세.)
- **0 is not a door.** 확인이 필요한 리뷰's per-channel shares included 「쿠팡 0」 as a link to an empty
  list. A zero share stays in the breakdown — that a channel is clear is information — and stops being
  a control. A figure that could not be **read** keeps its link: 「셀 수 없었다」 is not 「없다」.
- 답변이 필요한 문의 now opens the record filtered to exactly its own count (§0-C).

No new weekly capability was built and no insight the data does not state was generated. The Agent's
`reportOpsNode` was audited and not duplicated: this screen reads the same backend figures directly.

## §4 `/settings` — audited, unchanged

No daily work lives there. The five rows are all things changed occasionally: 회사 정보 · 운영 기준 ·
AI 답변 스타일 · 리뷰 답변 문구 · 연결 알림, each with a one-line statement of what it decides.

**No vocabulary conflict.** The row already reads 「운영 기준」 from `lib/knowledgeWords.ts`, the same
noun `/settings/policies` and `/knowledge` use; the older 「운영 정책 / 답변 기준」 was retired in a previous
package. Knowledge Inbox is on `/knowledge` and was not pushed here.

**Reported, not acted on:** 고객운영 메모리 and 리포트 sit under 「더 보기」 on Settings because they are not
in the menu. Neither is a setting. That is a navigation placement question (§6), not a Settings defect,
and moving them is an IA decision this package did not take.

## §5 `/connect` and the helper — one fix, the rest reported

**No developer concepts reach the screen.** Grepped and confirmed against the live render: `bridge`,
`pairing`, `carrier`, `token`, `profile` appear only in identifiers and comments. The rendered nouns
are 채널 · 연결됨 · 오류 · 마지막 수집 · 리뷰/상품평. (리뷰 vs 상품평 is deliberate — `reviewWord(channelCode)`
uses the platform's own word for its own object.)

**The measured defect was a sentence that cancelled itself out.** Two rows read
`오류 · 마지막 수집 1일 전`. The timestamp is `lastSyncedAt`, which the backend sets to the last
**success**; behind it sat `consecutiveFailures: 7`. So the row said "there is an error" and "it
collected yesterday" side by side, and a seller cannot tell from that whether their data is current.

A failing row now says what the time actually is:
**`마지막 성공 1일 전 · 그 뒤로 수집되지 않았습니다`**. Both facts are already in that response; a healthy
row is unchanged. The A5 state vocabulary (연결됨 · 연결 필요 · 연결 중 · 재연결 필요 · 오류) is a
product-owner decision and was not touched.

**Reported, not fixed:**

- The connectors' `lastError` strings are genuinely actionable
  (「…등록된 'API 호출 IP'를 확인해 주세요」) but carry vendor codes and HTTP statuses
  (`GW.IP_NOT_ALLOWED`, `HTTP 403`). Surfacing them raw would *add* the developer concepts §5 asks to
  remove. What is needed is a **connector-error → seller-sentence mapping** owned beside the connector
  that knows the code. Not invented here.
- The page carries **three sections that all mean "get reviews"** — 정기 자료 가져오기 · 리뷰 수집 실행 ·
  리뷰 수집 — with four ways in (자료 넘기기 · 기간별로 가져오기 · 리뷰 수집 열기 → · 작업대). 「작업대」 is an
  internal word for the Action Window operations screen. Consolidating them is an acquisition-IA change
  that touches the Action Window frontend workstream, which this package does not own.
- Failing rows carry two controls (자세히 + 확인하기) against the design contract's one-primary-per-row;
  the healthy row correctly has one.

## §6 Navigation — audited, unchanged

The hierarchy already exists and is already justified in `lib/nav.v2.ts`: **운영** (홈 · 상품 · 리뷰 ·
문의 · 주문) is daily, **연결·설정** (알고 있는 정보 · 채널 연결 · 설정) is setup, and `/overview`,
`/reports`, `/memory` and `/agent` are deliberately out of the menu with the reason written down —
each is reached from the thing it explains rather than being a destination.

They are not "listed at the same weight": two groups, two headings, and the mobile tab bar derives its
four tabs from the same model so the three IAs cannot drift.

The one placement the audit questions is 리포트 / 고객운영 메모리 reaching the seller **only** through
Settings 「더 보기」 (§4). Raised as a product-owner decision; no abstract IA was invented.

## §7 GMARKET read visibility — decision, no code change

Provenance, measured: **11 reviews, `data_origin = REAL`, `external_id` null, `acquisition_sync_job_id`
null** — i.e. real seller reviews that arrived through file upload, not through a connector. They are
the seller's own data and must not be hidden.

What the global switcher means: `GET /api/channels` enforces `ProductChannels` — NAVER / Coupang /
Cafe24 — an **explicit product-owner decision of 2026-08-17** ("a channel on screen is a channel that is
actually usable"). So the selector means **연결 지원 채널**, not 보유 리뷰 채널. There is also no GMARKET
seller account, and reviews are scoped by `(org, channel)` with no `seller_account_id` column, so a
GMARKET tab would be a switcher position with no account behind it.

**Conclusion: no change, and the total is not narrowed.** The product tile still counts all 1,761 and
the product-scoped record still lists the GMARKET rows (Product Operations Continuity v1 §1) — that is
where the seller sees them today. Widening the global switcher would put a channel on screen that
cannot be connected, collected from, or replied to, which is precisely what the 2026-08-17 decision
forbids, and reversing it silently is not this package's call.

**Open product-owner question:** should an org-wide surface announce that reviews are held on channels
outside the supported set? Answering yes needs a read that does not exist today (per-channel review
counts across the unsupported set) and a decision about what the seller is then invited to do with them.

## §8 Archive completeness / state truth on Orders and Reports

- `/orders` — every figure is computed from **one** response for the current filter and is labelled with
  its own scope (`주문 · 최근 7일`, or the chosen day). The KPI, the chart and the table cannot disagree,
  and no page subset is called a total. **No defect.**
- `/reports` — nothing is paged; the counts are server totals, and `unansweredInquiries` is explicitly
  the uncapped server number rather than a count over the capped feed. **No defect.**
- The one page-subset-as-total shape found anywhere was the inquiry queue (§0-B), and it is closed:
  one read, the server's own total, and a heading that says so when the server holds more than the page
  returned.

The 11f5274c principle — the UI reads the field, it does not infer — is what §0-A and §0-B are
applications of.

## §9 The unnamed frontend flake

Did not reproduce. The full frontend suite ran clean throughout this package (final: 230 files /
2,729 tests / 0 failures, plus repeated targeted runs). No tracking project opened, per the brief.

---

## §10 Verification

**Live, on the real Demo Org, after restarting backend and frontend on this commit** (a long-lived dev
process is a version pin):

| | before | after |
|---|---|---|
| `/api/inquiries` (no phase) `totalElements` | 11 | **21** |
| `/api/inquiries?phase=OPEN` | 11 | 11 (unchanged) |
| `/api/inquiries?phase=PROPOSED` | 10 | 10 (unchanged) |
| 홈 「지금 처리할 일」 | 11 | **21** |
| `/inquiries` 「지금 처리할 일」 | 21 | 21 |
| `/overview` 「현재 미답변 문의」 | 1 | **22** |
| `/overview` KPI `excludedChannels` | 2 | **1** |
| `/overview` 채널표 카페24 「현재 미답변」 | — | **21** (문의 column still `—`) |
| `/api/inbox` · `/reports` | 22 | 22 |
| 리포트 「답변이 필요한 문의 22건」 destination | `/inquiries` (whole record) | `/inquiries?status=UNANSWERED` → **전체 문의 22** |
| 리포트 상품별 이슈 rows that open | 0 of 5 | **5 of 5** |
| `/connect` failing row | `오류 · 마지막 수집 1일 전` | `오류 · 마지막 성공 1일 전 · 그 뒤로 수집되지 않았습니다` |

**Browser QA — 8 routes × 1440 / 1366 / 1152** (`/`, `/overview`, `/orders`, `/reports`, `/settings`,
`/connect`, `/inquiries`, `/knowledge`): **AA text-node violations 0** (composited backgrounds),
horizontal scroll **0**, console errors **0**, off-host requests **0**. The only non-app requests are to
`127.0.0.1:8787`, the agent-runtime, which is not started in this session.

Click path, identical at all three widths: 리포트 「답변이 필요한 문의 22건」 (y=426) → one navigation →
the record filtered to exactly 22.

**Tests.** backend **3,798** / 0 failures (25 skipped) · frontend **2,729** / 0 · typecheck clean.

New guards, and each was **proven to fail on the old code before being kept**:

- `StandingBacklogMetricTest` — a channel with an empty window and a held backlog is counted in
  미답변, excluded from 문의, carries its own exclusion count, and still reports 최신 미확인.
- `InquiryQueueServiceTest` — no phase means the declared set; the set is the one
  `InquiryWorkItemPhase` declares, not one this file spells.
- `ReportsV2.test` — every product-issue row is a door, a row without an id is not; a zero share is not
  a link and a non-zero one is.
- `ChannelList.reviewEntry.test` — a failing row names the last success and says nothing landed since,
  and leaks no vendor code; a healthy row is unchanged.

**Contract changes, recorded honestly (no safety test weakened):**

1. `GET /api/inquiries` with no `phase` now answers `AWAITING_SELLER` instead of `OPEN`. Naming a phase
   is unchanged. The only caller relying on the default was 홈, which meant the set.
2. `CustomerInbox.test`'s queue fixture answered per phase, because the screen asked per phase. It now
   refuses a `phase` argument — the screen going back to deciding membership itself is the defect.
3. `homeReportParity.test` asserted the two figures agreed on `/inquiries?state=NEEDS_REPLY`. They did —
   on a destination that showed neither of them. It now asserts the axis the record reads.
4. `ReportsV2.test`'s href assertion, for the same reason.
5. `InquiryItem.phase` widened to `string | null`, for the same reason `workItemId` already is: a record
   row that carries no work item carries no phase. No consumer reads it.

**Marketplace calls 0 · marketplace WRITE 0 · model calls 0 · approvals 0 · migrations 0 · DB row
changes 0** ⇒ no evidence row.

## §11 Reported, not fixed

- **Orders needs data, not UI** (§2): NAVER `lastChangedType` widening and an order → product linkage.
  Product-owner decisions.
- **Connector errors need a seller-sentence mapping** (§5), owned beside the connector that knows the
  code. Today the actionable half is behind 자세히 and carries vendor codes.
- **`/connect` has three overlapping acquisition sections and the word 「작업대」** (§5) — an acquisition-IA
  change inside the Action Window frontend workstream.
- **리포트 / 고객운영 메모리 are reachable only through Settings 「더 보기」** (§4, §6).
- **GMARKET's 11 reviews are visible only on a product-scoped record** (§7) — product-owner decision.
- `/inquiries` is 5,550px because the queue is 21 real items over a decade-old backlog; that is the
  length of the work, not a layout defect.
- **Repository rule conflict.** `frontend/CLAUDE.md` forbids `backend/**` edits for the Action Window
  Frontend workstream. This package edited eight backend files (five production, three tests) under the current task's product-owner
  instruction (conflict priority 1), because §0-A and §0-B are backend-computed figures and could not be
  corrected on the screen without the screen inventing a number. All edits are **reads and predicates**;
  no state semantics changed, no write path was touched, and no approval boundary moved.
