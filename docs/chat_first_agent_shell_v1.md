# Chat-first Agent Shell Completion v1

**2026-08-27** · branch `feat/proactive-operations-agent-v1` · frontend + backend + agent-runtime
· marketplace WRITE **0** · marketplace READ **0** · schema change **0** · model calls **1**

Agent Command Center v1 established the shape — chat-first, object-backed. This package finishes the
shell and, for the first time, **runs a real sentence all the way through it**: home command box →
`/agent` → LLM planner → specialists → tools → evidence → rendered operational objects. Everything
here is either a correction to a seller-facing number, a correction to the home hierarchy, or that
one proof.

---

## 1. Home hierarchy — the input moved above the numbers

The order shipped as **브리핑 → 숫자 → 물어보기**. Measured in a real browser, that put the one
control this product is named for at **y=1,010** on a 1440×900 screen — 110px below the fold at 100%,
290px below it at 125%. A chat-first product whose chat entry has to be scrolled to is not one.

The order is now **브리핑 → 물어보기 → 준비된 일 → 숫자 → 참고**.

| | before | after |
|---|---|---|
| greeting | y=180 | y=180 |
| command input | y≈1,010 | **y=239** |
| numbers | y≈300 | y=760 |

Measured after the change, Chromium 1440×900@2×, real local backend, canonical Demo Org:

| viewport | fold | briefing | command box | above fold |
|---|---|---|---|---|
| 1440×900 (100%) | 900 | 180 | 239 | both |
| 1152×720 (125% equivalent) | 720 | 180 | 239 | both |

Document height 1,649px · horizontal overflow **0** · console errors **0**.

**The input is deliberately small.** A chat-first product is not a product whose home page is a chat
window: the briefing above it and the work below it are what the seller came for, and a viewport-sized
empty text box would be a worse version of both. It is a slot inside `AgentBriefing` rather than a
child of it, because the greeting is arithmetic over the objects it renders and the input is not one
of them.

Regression: `Overview.commandCenter.test.tsx` §1-A asserts document position, greeting → input →
prepared work → numbers.

---

## 2. Empty proactive truth — audited, and left alone

Active proactive cases = **0** in the Demo Org, and that is the correct state: both stored cases point
at work that is finished, and Agent Command Center v1 filters them out of recommendations at query
time.

`ProactiveCases` already renders **nothing** when there is nothing — §2's first allowed option, and a
rule this component has carried since it shipped ("announcing its own absence would cost the seller a
glance every single visit"). The all-zero case has its own sentence in the greeting: 「지금 먼저 확인할
일은 없습니다.」

**Nothing was run to fill it.** No tick, no model call on a real customer inquiry, no fixture.
Regression `§2/§14-D` asserts the absent section and the absence of any 확인 중 / 분석 중 placeholder.

---

## 3. Seller-facing demo data — the rule, and what it changed on screen

### The audit

`OperationsMetricsRepository` computed 매출·주문·문의·리뷰·부정 리뷰 over
`(:syntheticVisible = true or data_origin = 'REAL')`. On a deployment with
`sellerops.seed.demo-content=true` that is **every row**, mixed, unlabelled.

Measured on this deployment (2026-08-27):

| corpus | rows | date range |
|---|---|---|
| orders | REAL 56 · DEMO_SEED 25 | seeded rows 2026-05-31 ~ 06-13 |
| inquiries | REAL 3,336 · DEMO_SEED 16 · VERIFY_FIXTURE 3 | seeded rows 2026-06-06 ~ 06-13 |
| reviews | REAL 4,507 · DEMO_SEED 44 | seeded rows 2026-05-31 ~ 06-13 |

Every seeded row sits **outside all three windows** the screen offers (7 / 14 / 30 days), so applying
rule A moved no figure on this deployment. That is a fact about today's data, not a reason not to
write the rule down.

### The rule

`OperationsMetricsService.fallBackToExampleData(syntheticVisible, realWindowHasRows, syntheticWindowHasRows)`
— rule A is the default and rule B is the single branch out of it:

- **A.** Seller-facing operational figures are computed over the seller's own rows. Always.
- **B.** Only when a deployment deliberately seeded demo content **and** the real window produced
  nothing at all **and** the seeded window has something to show, the seeded corpus is used —
  and the response carries `exampleDataIncluded`, which the 숫자 section renders as
  「이 기간에는 실제 데이터가 없어 예시 데이터를 함께 보여드립니다.」
- **There is no branch that mixes them.** That is the point: a total that is 90% real is the one shape
  a label cannot describe honestly.

Rule B exists so rule A is safe to apply unconditionally. Without it, a demo with no collection behind
it renders six honest zeros and a flat chart, which is not what the switch was turned on to produce.

`counted()` — which decides whether a channel's silence is a zero — is untouched. Coverage semantics
and every fixture are untouched, per the instruction.

### §3-C — one briefing sentence WAS stating manufactured data as fact

`buildTopProductIssues` fed the home insight 「{상품} 부정 리뷰 N건」 with a date range attached. N is a
count of review ROWS, so seeded rows landed in it. Measured before and after:

| | top product | negative reviews | origin |
|---|---|---|---|
| before | 바닥용 평면 몰딩 | 4 | **DEMO_SEED 4 / REAL 0** |
| before (2nd) | 선바로 광폭 케이블 몰딩 | 4 | **DEMO_SEED 4 / REAL 0** |
| after | 선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드 | 3 | REAL 3 |

The home briefing was naming a manufactured product, with manufactured reviews, as the seller's worst
product — with a date range, in the seller's own operational language. The fix is one filter; the
review screens, the issue extractor and its evidence are untouched.

### Audited and NOT changed

`REPEATED_REVIEW_ISSUE` says 「반복되는 리뷰 문제 19건」 — a count of open ISSUES, not of reviews. All
19 have at least one REAL review behind them, so the sentence is true on real data alone. One of the
19 is mixed (8 REAL + 11 DEMO_SEED evidence rows), which means that issue's own **evidence count** on
its detail screen includes seeded rows. Narrowing that is an issue-extractor question, not a briefing
one, and historical cleanup is out of scope. Reported, not changed.

---

## 4. `totalElements` — the rows and the count now read the same predicate

The answered-elsewhere rule shipped one package ago as a Java filter over the fetched page: correct
rows, and a total that still counted the rows it had just dropped. A queue that renders 9 and
paginates 12 is its own defect.

The predicate moved into `findOperationalByOrgIdAndPhase` verbatim — in `OPEN` and `PROPOSED`, and
only there, an inquiry the channel already reports as `ANSWERED` is not work. `COMPLETED` and
`EXECUTED` carry answered inquiries by definition, so a clause that ignored the phase would empty
exactly the tabs that are supposed to be full. `InquiryQueueService.stillWaiting` is deleted; the one
Java filter that remains is a null guard, not a narrowing.

Regression: three work items (waiting / answered-elsewhere / manufactured) →
`content 1 · totalElements 1 · totalPages 1`.

---

## 5. Command palette — unchanged, and asserted to stay deterministic

미답변 문의 · 리뷰 문제 · 오늘 할 일 still resolve by `matchCommandIntent` — a noun plus a show-verb,
no model, no run. Live result, read-only Demo Org:

> 답변이 필요한 문의 / 지금 답변이 필요한 문의는 22건입니다. + 5 clickable rows + 「문의 화면에서 전체 보기」

The 22 is passed down from the KPI already on screen; a second read is a second chance to contradict
the card six inches above. New regression `§14-E`: a recognised command calls `navigate` **zero**
times and starts no run.

---

## 6. The free-text lane — audit

The seam is complete and nothing was missing. `frontend → agent-runtime → LlmInvestigationPlanner →
specialists → OperatorToolRegistry (100% READ) → evidence → OperatorAnswer` all existed and are
wired. `OperatorAnswer` already carries what a structured result needs: `findings[].statement`,
`findings[].surfaceLink`, `evidence[].locator` with `productId`/`productName`/`label`/`count`,
`nextActions[].surfaceLink`.

**One real gap, and it was in the frontend.** `agentContext` carried `productId` into the `/agent`
URL and `Agent.tsx` read it back — and then sent `goalText` alone. See §9.

No missing protocol. Nothing was built to make the lane work; it worked.

---

## 7. One bounded free-text proof — LIVE

Typed into the home command box, which does not recognise it and hands it to `/agent` unchanged —
the exact path a seller takes.

> **최근에 반복해서 문제가 생기는 상품이 있어?**

| | |
|---|---|
| plan | `plannerKind: LLM`, `modelAnswered: true`, 3 needs, 2 specialists (REVIEW_OPS + INQUIRY_OPS) |
| tool calls | **10**, all READ, all over locally-held rows |
| model calls | **1** (planner). Judge capability unkeyed ⇒ the rule judge decided — withhold-only |
| findings | 10, all `SUPPORTED` |
| result | DONE, `stopReason: COMPLETE` |
| marketplace calls | **0** (backend log: naver/coupang/cafe24 references **0**) |
| DB writes | **0** — order/inquiry/review composition byte-identical before and after |
| console errors | 0 |

Schedulers, proactive and self-pilot were forced OFF for the whole session; connectors OFF.

The answer named five products with their own evidence, and disclosed its own limits without being
asked:

> 열려 있는 반복 리뷰 문제 19건 가운데 근거가 많은 8건(전체 근거 85건 중 71건)을 확인해 상품 9개로
> 나눴습니다. 나머지는 확인하지 않았으므로 전체 순위가 아닙니다.

---

## 8. Object-backed result

`lib/answerObjects.ts` groups the answer's **own evidence** by `locator.productId` and renders
「이 답변이 가리키는 상품 N개」 — a row per product with its facts and a 「확인하기」 link to
`/products/{id}`, a route that already exists.

Three rules, each tested:

- **Nothing is derived.** Every id, name, label and count was already in `EvidenceRef.locator`.
- **Two counts are never summed.** 「리뷰 3」 and 「문의 2」 are two facts; 「관련 5건」 is a third one
  nobody read.
- **Org-wide answers produce no object**, rather than an empty one — there is nothing to open.

No generic Agent Object Protocol. No new component. The heading counts what is rendered below it, and
the findings above already said what is wrong, so it is not said twice (§11).

Live: the free-text run rendered 5 product objects with working links.

---

## 9. Current-page context — the gap was real, and it is closed

`agentContext` has carried `{goal, productId, channelCode, surface}` since Agent Command Center v1.
The Agent page read it back and sent `goalText` alone: **the product id died at the request boundary.**

It was invisible because every screen that offers the link also writes the product's NAME into the
suggested sentence, so the planner resolved it by name and the answer looked right. What the seller
paid was a resolve call and the obligation to keep describing a product they were already looking at.
「이 상품만 봐줘」 — the sentence with no name in it — could not work.

The minimal contract, and nothing more:

- `StartRunRequest.productId` (frontend) → `StartRunRequestSchema` (zod) → `GoalRequest.productId`.
- `OperatorAgentRuntime.contextEntities` spends **one org-scoped read** (`get_product_signals`) to turn
  the id into a **verified** `ResolvedEntity`, seeded into the graph's existing `entities` state — the
  same slot `productOps` already reads (`already?.id`).

**A hint is not a fact.** An id from a URL proves nothing: not that the row exists, not that it is this
org's, not what it is called. One org-scoped read answers all three, so the entity that reaches the
graph was resolved the way a named one is, and every scope invariant downstream (`EvidenceScope`) keeps
asking the question it already asked. The call is charged to the run's budget. A failure is **silence**:
a stale bookmark or another org's id leaves the run exactly as it is today.

Live: `/agent?goal=…&productId=b718ed98-…&from=product` from a product detail page.
Regressions: 3 runtime tests (resolved-by-name control · no name lookup with the hint · foreign id
dropped in silence) and 2 frontend tests (sent when present · absent when there is no entity).

---

## 10. Action safety — unchanged

`CommandInput` contains no write call and no path to one. 「답변 보내줘」 matches no intent and reaches
`/agent`, whose tool catalogue is **100% READ** and refuses a WRITE tool at construction. The
marketplace write still happens only through the approval CTA on the inquiry screen. Regression G,
unchanged from the previous package, still asserts `confirmInquiryPublish` is never called.

---

## 11. Browser QA

Chromium 1440×900@2× (and 1152×720 for the 125% equivalent), real local backend, canonical Demo Org,
read-only.

| screen | file | verdict |
|---|---|---|
| 홈 100% | `30-home.png` | briefing 180 · command 239 · numbers 760 |
| 홈 125% equivalent | `31-home-125.png` | both above the 720 fold |
| 명령 결과 (deterministic) | `32-command-result.png` | object + 5 rows, stays on 홈 |
| 상품 상세 Agent 진입 | `34-product-agent-entry.png` | href carries `productId` |
| 자유문장 handover | `35-agent-handover.png` | `/agent?goal=…`, nothing dispatched |
| 자유문장 결과 | `36-freetext-result.png` | 10 findings + 5 product objects |

- **AA contrast failures: 0**, composited over tints, every text node on the home screen.
- **One failure was found and fixed**: the primary CTA's *hover* state. `hover:bg-brand-600` under
  white is **4.49:1** — under AA by a hundredth, on the most-pressed control in the product, in the
  exact state a cursor is in while the label is being read. Hover now **darkens** to `brand-800`
  (`#1550B5`, **7.38:1**). One token added to the existing brand ramp; 5 call sites changed
  (`Btn.solid`, `.btn-primary`, `AuthCard`, and two `hover:text-brand-600` links in the daily loop).
- Horizontal overflow 0 · console errors 0 · document height 1,649px.

**Reported, not fixed:** 18 legacy Action Window / review-import call sites still use `bg-brand`
(`#3182F6`, **3.71:1** at rest, not only on hover). They are outside this package's surfaces and
outside the daily loop, and fixing them is a token migration this package is forbidden to do.

---

## 12. Counts

| | |
|---|---|
| marketplace calls | **0** |
| marketplace WRITE | **0** |
| model calls | **1** (one planner call, the §7 proof) |
| DB writes | **0** |
| schema migrations | **0** |
| backend | 396 suites · 3,431 tests · 0 failures · 23 skipped |
| frontend | 181 files · 2,398 tests · 0 failures |
| agent-runtime | 50 files (5 skipped) · 491 tests · 0 failures · 23 skipped |

---

## 13. Remaining blockers

1. **The free-text lane needs `agent-runtime` running.** It is a separate process on 8787 and is not
   part of a normal boot. A seller-facing deployment story for it does not exist yet.
2. **The planner call took 22 seconds** and the screen shows only 「확인하는 중…」 for all of it. Not
   fixed here (no progress contract exists to render).
3. **`bg-brand` at 3.71:1** on 18 legacy call sites — §11.
4. **`NO_ANSWER_BASIS` still does not survive a reload**, unchanged: that state deliberately writes no
   draft version, so there is no row to stamp. Recompute is 0 model calls.
5. **The product list's first row is 「(미지정 상품)」**, so the contextual Agent link from it reads
   「(미지정 상품) 상품에 대해 알려 줘」. Product-page ordering is a product-owner decision, untouched.
6. **`SellerOps` helper strings** remain in the declared exception set — deferred to Disconnected
   Channel Onboarding Live Walkthrough v1, per §13 of this package's instruction.
7. **One review issue's evidence count is mixed** (8 REAL + 11 DEMO_SEED) — §3, reported not changed.
