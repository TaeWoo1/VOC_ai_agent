# Agent Command Center v1

**Date:** 2026-08-27 · **Branch:** `feat/agent-evidence-scope-integrity` · **Predecessor:**
Core Daily Loop UX Integration v1 (CLOSED)

**Product direction (product-owner, this task):** reviewnary is **Agent-first + structured
operational workspace** — *chat-first, object-backed*. Chat carries intent; the work is shown in the
structured UI that already owns it. It is **not** a chat-only product, and the home screen is not an
empty chatbot box.

**Scope:** seller-facing truth correction · answer-basis persistence · home information architecture ·
briefing objects · a command box over existing objects · a written design contract · browser visual QA.
**Marketplace WRITE 0 · marketplace call 0 · model call 0.**

---

## 1. Seller-facing truth: three corrections

### 1-A. 답변이 필요한 문의 is REAL only

The home KPI read **30**. The org holds **22** real unanswered inquiries plus **6 `DEMO_SEED`** and
**2 `VERIFY_FIXTURE`**.

The rows were not a bug. `SyntheticDataVisibility` is bound to `sellerops.seed.demo-content`, and a
demo deployment shows its demo dashboard **on purpose** — that switch stays exactly as it is. What was
wrong is which numbers it was allowed to reach. A manufactured row may appear in a chart of what the
shop did. **It may never appear in a number that says the seller owes an answer.**

That rule already existed twice in this codebase — `InquiryWorkItemWriter` refuses to open a work item
on a synthetic inquiry, and `InquiryQueueService` drops one from the actionable queue ("Operational
means REAL"). This package gave it a third reader and one definition:

```java
InquiryRepository.countUnansweredOperational(orgId)          // scalar — 홈 · 문의
InquiryRepository.countUnansweredOperationalByChannel(orgId) // per channel — 채널별 표
```

`InboxService` and `ChannelCoverageService` both read it, so 홈 and 문의 cannot disagree.

**Deliberately not narrowed:** the coverage *state* still counts every stored row
(`countActiveByChannel`), because a channel whose only rows are seeded has still reported, and
narrowing that would flip its collection verdict. Only the "waiting" half of the pair is REAL-only.

**Live, after the change:** 홈 KPI **22건**, 채널별 「현재 미답변」 카페24 21 · 나머지 1. Fixtures were
not deleted and no row was touched.

### 1-B. Work the channel already finished is not work

A Cafe24 board post was answered by the seller in the marketplace console; our sweep has not run
since, so the work item still reads `PROPOSED` while the inquiry reads `ANSWERED`. It sat in the
queue of 21.

`InquiryQueueService.stillWaiting(phase, inquiry)` drops it — **and only in `OPEN`/`PROPOSED`**, the
two phases where "answered" contradicts the phase. `COMPLETED` and `EXECUTED` rows carry answered
inquiries *by definition*, and a blanket predicate would have emptied exactly the tabs that are meant
to be full. Nothing is written; `reconcileConnectorAnswered` still owns closing them on the next
collection.

### 1-C. A proactive case whose work is finished is not an active issue

Both open cases in the canonical Demo Org pointed at finished work: one at the answered inquiry above,
one at a `COMPLETED` work item. The reconciler owns closing them and has not run (the loop is off).

`ProactiveCaseRepository.STILL_WAITING` is a query-level predicate shared by the list and both counts:

- an `INQUIRY` subject must still be REAL · `ACTIVE` · `UNANSWERED`;
- a bound work item must be in `InquiryWorkItemPhase.AWAITING_SELLER` (`OPEN`, `PROPOSED`).

`REVIEW` subjects are unconstrained — they open no work item and a review has no "answered" fact.

**No cleanup architecture.** `proactive_case.status` is still derived by the reconciler and nothing
else writes it. What changed is what a READ recommends.

**Consequence, reported not hidden:** 「AI가 먼저 확인한 일」 is now **empty** in the Demo Org, because
both of its cards were pointing at finished work. The briefing shows deterministic items instead. A
proactive tick would prepare fresh cases; running one means model calls on real customer inquiries and
was not done.

---

## 2. The answer state survives a reload

`GROUNDED` / `NEEDS_CLARIFICATION` / `NO_ANSWER_BASIS` were computed on every generate and stored
nowhere. Reopening an inquiry showed the draft with no statement of what it was — so a reply that
**asks the customer for their 규격** read as an answer that had come out short.

**Audit first.** The nearest existing seam is `inquiry_reply_draft`, which already carries
`author_kind`, `model_version`, `knowledge_state`, `product_id` per version. It is the right home and
it needs **one column**:

```sql
-- V82
alter table inquiry_reply_draft add column answer_basis varchar(24);
```

- **Not derivable from `knowledge_state`.** Both `GROUNDED` and `NEEDS_CLARIFICATION` sit on
  `knowledge_state = GROUNDED`; what separates them is whether the customer settled their 규격, a fact
  about the QUESTION that this table does not hold.
- **Nullable, no backfill.** A version written before the migration claims nothing. A state invented
  by a migration cannot afterwards be told apart from one that was observed.
- **Append-only intact.** Stamped when a version is written, never updated. `Provenance` gained one
  field; no existing row moved.
- The value travels out on `ReplyDraftView` as `answerBasis` + `answerBasisNote` +
  `answerBasisAction`. The action line is the **general** one on a reload — the customer's own noun is
  not stored, and re-deriving it would mean re-reading their message.

**Known limit (unchanged, stated again):** `NO_ANSWER_BASIS` writes **no draft**, so there is no row
to stamp. A reload of an inquiry in that state shows no card and the 「초안 만들기」 button, which
recomputes at **zero model cost** (that state never calls a model). The states that produced a version
— including `SELLER_APPROVED_FALLBACK`, which carries `NO_ANSWER_BASIS` — restore exactly.

---

## 3. Home information architecture

**Before:** six KPI tiles, then a proactive section, then findings, then charts. The seller's first
decision was "which of these six is a problem".

**After:**

| # | Area | What it is |
|---|---|---|
| 1 | **브리핑** | one sentence + the operational objects it counts |
| 2 | **숫자** | the same six KPIs, under a heading that says what they are; the window control lives here now |
| 3 | **무엇을 도와드릴까요?** | the command box and its object result |
| 4 | 참고 | 추이 · 채널별 · 이 숫자에 대하여 (unchanged) |

Nothing was dropped. The dashboard data moved **down**, under a heading, in service of the briefing.

**One control moved for a reason:** the 최근 7/14/30일 buttons were in the page header — the first
filled button on the screen, a filter for a section 900px below it. They now sit in the 「숫자」
section header.

**「답변이 필요한 문의」 is back on this screen.** A previous package removed it because the same 26
appeared three times at equal weight. It appears twice now and the two are different statements: the
briefing row is a task with somewhere to go, the 숫자 card is the size of it. A command center that
never mentions the largest thing waiting is not one.

---

## 4. Briefing objects

**No new card framework.** The briefing is composed of components that already existed:

| Group | Object | Source |
|---|---|---|
| 준비된 초안 | rows linking to the inquiry | `/api/inquiries?phase=PROPOSED` (the work queue) |
| AI가 먼저 확인한 일 | `ProactiveCases`, unchanged | `/api/proactive/cases` |
| 지금 눈여겨볼 것 | `InsightList`, unchanged | `OperationsInsight` (already `{title, detail, to, actionLabel}`) |

Each row carries one sentence, minimum context, a deterministic count/status, and one destination.
No Agent prose.

`ProactiveCases` gained one optional prop, `onLoaded(count)`, so the greeting counts what was
**rendered** rather than re-reading it.

---

## 5. Agent voice

The greeting is **arithmetic**: `briefingHeadline(prepared + proactive + findings)`. No model is
called on this screen — the dashboard keeps working when the day's AI budget is gone, a property this
product has had since `demo_core_experience_v1.md` §7 and does not give up for a greeting.

- 「오늘 먼저 확인하면 좋은 일이 4개 있습니다.」 — never 「4개의 proactive case를 탐지했습니다」.
- Zero gets its own sentence: 「지금 먼저 확인할 일은 없습니다.」 — never 「0개 있습니다」.
- 「답변 초안을 준비해 둔 문의 1건」 — never `DRAFT_PREPARED`, never `PROPOSED`.

`briefing.test.ts` asserts the absence of the log vocabulary, not just the presence of the sentence.

---

## 6. The command box, and exactly what it is

**It is a command palette over screens that already exist. It is not a planner.**

That distinction is a product contract, not a preference. `docs/sellerops_operator_graph_v2.md` says
an Agent run's plan is made by the **LLM planner or the run fails** — there is no deterministic
keyword planner, not even as a fallback. Nothing here is one:

- a **recognised** sentence resolves to a workspace **object** (the same way a palette resolves 「설정」
  to a settings page). It chooses no tools, claims no evidence, and states no fact it did not read
  from the object it is showing;
- an **unrecognised** sentence is handed to `/agent` unchanged, where the planner plans it or the run
  fails exactly as it does today. The sentence lands in the Agent's own box; nothing dispatches.

**Matching is deliberately narrow.** A sentence must name one of three nouns **and** ask to be shown
something (`보여` / `알려` / `목록` / `확인해` / …). 「3호 몰딩 문의가 몇 건이야」 is a question about the
catalogue and goes to the Agent. Guessing is the one thing this box must not do — and the chips under
the input make the supported set visible instead of folklore.

| Intent | Object |
|---|---|
| 미답변 문의 보여줘 | the work queue rows + the home KPI's own count |
| 리뷰 문제 보여줘 | `IssueList` — the component 고객 기억 uses, not a second copy |
| 오늘 할 일 알려줘 | the briefing, which is already on this screen; the palette takes you to it |

---

## 7. Object-backed results

The count in the inquiry object is the home screen's **own KPI**, passed down rather than re-read: two
reads of "how much is waiting" is two chances for the box to contradict the card six inches above it.
The rows come from the queue, which is the list the 문의 screen works from.

No list component was re-implemented for chat.

---

## 8. Context-aware Agent seam — audit result: **it already exists**

`lib/agentContext.ts` carries `{goal, productId, channelCode, surface}` on the `/agent` link, and
`AgentLaunch` is offered from 홈 · 문의 · 리뷰 · 상품 목록 · 상품 상세 — five surfaces. The contract is
already the right one: **structured context, never an injected fact**, and the seller presses send.

The command box adds one caller (`surface: "home"`). **No new contract was designed and none was
needed.**

---

## 9. Approval boundary — unchanged

There is no write call in `CommandInput.tsx` and no path from a typed sentence to one. 「답변 보내줘」
reaches the Agent, whose tool catalogue is 100% READ. The marketplace write still happens only through
the approval CTA on the inquiry screen. Regression G asserts `confirmInquiryPublish` is not called and
that the sentence navigates to `/agent` instead.

---

## 10. Design contract

`docs/reviewnary_design.md` — typography, spacing, content width, surfaces, CTA hierarchy, state
colours, briefing rules, object cards, evidence disclosure, empty/loading/error, accessibility,
responsive. It records what the code already does plus the rules the last three UX packages arrived
at. **No token migration, no new palette, no new font, no component library added.**

Reference galleries (21st.dev and similar) may be read for **patterns**; nothing was copied and no
dependency was added.

---

## 11. Visual QA — real browser, measured

Playwright/Chromium, 1440×900 @2×, against the **live local backend and the canonical Demo Org**
(read-only) for 홈 · 명령 결과 · 스타일 설정, and against a **synthetic fixture** for the three inquiry
states — rendering those live would mean generating drafts on this seller's actual customer inquiries.

| Screen | Contrast failures (AA, composited over tints) | Horizontal scroll | Console errors |
|---|---|---|---|
| 홈 (100%) | 0 | no | 0 |
| 홈 (125% equivalent) | 0 | no | 0 |
| 명령 결과 (미답변 문의) | 0 | no | 0 |
| 문의 · GROUNDED | 0 | no | 0 |
| 문의 · NEEDS_CLARIFICATION | 0 | no | 0 |
| 문의 · NO_ANSWER_BASIS | 0 | no | 0 |
| AI 답변 스타일 | 0 | no | 0 |

- Home document height **1,661px**; at the 125% equivalent viewport the greeting, all four briefing
  items and the 「숫자」 heading are above the fold.
- Chunk addresses / locators render **nowhere** (`hasLocator: false` on all three inquiry states).
- Style settings: the 저장 button sits below the fold on a long settings form. Left as is — it is a
  form, not an operational CTA.

**Marketplace calls 0 · model calls 0 · DB rows unchanged** (inquiries 30, drafts 11, proactive
prepared 2, work items 3,272 — identical before and after; the two proactive cases were already
`surfaced_at` from a previous audit and are now filtered out of the read entirely, so nothing new was
written).

---

## 12. Migration applied locally

Booted with connectors · scheduler · self-pilot · proactive · draft all forced OFF.

```
Current version of schema "public": 81
Successfully applied 1 migration to schema "public", now at version v82 (00:00.008s)
Started SellerOpsApplication in 6.026 seconds
```

Boot log: naver/coupang/cafe24 references **0**, openai/anthropic/vision **0**, ERROR/WARN **0**.
`information_schema` confirms `answer_basis varchar(24)`; **11 of 11** existing drafts carry null, as
designed.

---

## 13. Tests

| | suites | tests | failed | skipped |
|---|---|---|---|---|
| backend | 395 | 3,426 | 0 | 23 |
| frontend | 180 | 2,385 | 0 | — |

Regression coverage (§16 A–J):

| | claim | where |
|---|---|---|
| A | operational count excludes every manufactured origin; per-channel sums to the total | `OperationalUnansweredCountTest` |
| B | an answered inquiry leaves the actionable queue; a COMPLETED tab is not emptied | `InquiryQueueServiceTest` · `ProactiveRecommendationStalenessTest` |
| C | a terminal / dismissed work item is not an active issue; totals follow the list | `ProactiveRecommendationStalenessTest` |
| D | the basis is stamped and read back; a pre-migration version claims nothing | `InquiryReplyDraftServiceTest` · `InquiryResponsePanel.answerStates.test.tsx` |
| E | the briefing precedes the dashboard grid in the document; it counts what is rendered | `Overview.commandCenter.test.tsx` |
| F | a list intent renders a list with links, not a paragraph | `Overview.commandCenter.test.tsx` |
| G | 「답변 보내줘」 calls no publish and reaches the Agent | `Overview.commandCenter.test.tsx` |
| H | every workspace route still mounts | `App.routes.test.tsx` |
| I | AA on every text node of 7 screens, composited over tints | browser QA (§11) |
| J | user-facing `SellerOps` outside the declared helper exceptions = 0 | `productName.test.ts` |

---

## 14. SellerOps naming — §15 honoured, nothing renamed

The 150 remaining strings are the declared exception set: connect / onboarding / Action Window /
helper copy that names the **local agent application the seller installs and must find on their own
computer**. This package did not rename any of them, and the audit of the installed executable's real
display name is still owed. General UI brand strings remain `reviewnary`; `productName.test.ts` fixes
both the offender count (0) and the exception count.

---

## 15. Remaining blockers

1. **「AI가 먼저 확인한 일」 is empty in the Demo Org.** Correct — both cases pointed at finished work —
   but the demo loses its clearest "the AI went first" card. Fixing it means running a proactive tick,
   which is model calls on real customer inquiries: **product-owner decision**.
2. **`NO_ANSWER_BASIS` still does not survive a reload**, because that state deliberately writes no
   version. Recomputing costs no model call; a row for it would be the state/event architecture §2
   forbids.
3. **`InquiryQueueResponse.totalElements` is not narrowed** by either read-time filter (the REAL one or
   the new answered one), so a page can show fewer rows than its own total. Pre-existing; the screens
   that matter read `content.length` or the KPI.
4. **The window metrics (매출·주문·문의·리뷰·부정 리뷰) still include demo rows** on a demo deployment.
   That is what `sellerops.seed.demo-content` means and changing it would empty the demo dashboard:
   **product-owner decision**, not fixed.
5. **The style settings 저장 button is below the fold** on a long form.
6. **The Agent chat lane itself was not exercised** — a free-text run needs the agent-runtime service
   and the org's LLM planner capability, neither of which was started. The palette's hand-over is
   asserted by navigation, not by a completed run.
