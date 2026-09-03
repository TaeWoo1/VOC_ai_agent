# Operational Workspace UX System v1

2026-09-04 · HEAD before this package: `1841c8a0` (Knowledge workstream PASS/FREEZE).

Not a per-page cosmetic redesign. reviewnary's strong parts — chat-first Agent, Guided Acquisition /
Reply, Grounded Drafting, Approval, Knowledge/Inbox, Orders/Products/Inquiries/Reviews — were each
correct on their own and did not read as one product. This package fixes the **information structure,
the state vocabulary and the action grammar** so a 40–50대 non-technical seller can see, without being
told, what to do next.

Visual direction is unchanged (Calm Operational Assistant). No new design system, no new colour, no
new component library, no new taxonomy, no retrieval or approval change.

---

## 1. The audit (code untouched, real Demo Org, 1440×900@2×)

Every number below is a measurement of the live app at `1841c8a0`, not a reading of the code.

| surface | doc height | rounded/bordered boxes | pills | actions | first primary |
|---|---|---|---|---|---|
| `/` (대화) | 900 | 1 | 1 | 18 | — |
| `/overview` | 1,184 | 8 | 9 | 23 | — |
| **`/reviews`** | **6,550** | 11 | 3 | **65** | 확인 필요만 보기 @511 |
| **`/inquiries`** | **7,068** | 3 | 0 | **116** | — |
| `/products` | 959 | 3 | 0 | 21 | — |
| `/orders` | 900 | 8 | 0 | 19 | — |
| `/reports` | 1,332 | 10 | 0 | 17 | — |
| `/knowledge` | 943 | 2 | 1 | 17 | 답변 기준 추가 @281 |
| `/settings` | 951 | 12 | 0 | 18 | — |
| `/connect` | 900 | 10 | 3 | 21 | — |

Per the eleven audit questions, the answers that were **no**:

- **`/inquiries`** — one flat 7,068px column with exactly **one heading** (`h1:문의`). The work queue
  and the record archive are the same list: an answered inquiry from last week sits at full weight
  directly under the oldest unanswered one, and the 22 the header counts dissolve into 94 rows.
- **`/reviews`** — the work queue exists and is above the record, which is right, but each of its four
  rows mounted the entire reply-preparation panel: the customer's sentence **twice**, **four state
  words that describe different things** (승인 대기 · 상태 미상 · 대응 필요 · 기타), two dates, three
  explanatory sentences repeated verbatim per row, and a textarea — ~570px a row. The review record
  began ~4,000px down the page.
- **`/products`** — headed **「상품 10개」** over a catalogue of **308**. Six of the ten rows read
  「문의·리뷰 아직 없음」; the product carrying **1,761 reviews and 8 inquiries** was not on the page.
  No line said more products existed.
- **`/settings`** — called one row 「운영 정책 / 답변 기준」 after the screen it opens had been renamed
  **운영 기준** by the previous package. Same rows, two names, neither aware of the other.
- **status truth** — see §2. This was the worst finding and it was live.

Answers that were **yes** and were left alone: `/` is the control plane and stays it; `/orders` is
filter → numbers → trend → per-channel and reads correctly for the question a seller opens it with;
`/reports` and `/overview` are archives and say so; `/knowledge` was rebuilt one package ago and is
frozen.

---

## 2. The status truth defect, measured

The 문의 list said **「초안 준비됨」** whenever the work item sat in `PROPOSED`.

`PROPOSED` is written when a **proposal** is recorded, and `InquiryProposal` states in its own class
contract that it persists *no reply-draft text*. On 2026-09-04 the Demo Org held:

```
PROPOSED work items: 10      with a draft: 2      with only a proposal: 8
```

So **eight rows told the seller a draft was waiting for them when nothing had been written.** The UI
was inferring a fact from an adjacent one.

The same premise was in the chat lane, written down as a comment:

```ts
// A PROPOSED item has an AI draft by the phase's own meaning
```

It has no such meaning. Both lanes now read the fact.

- `InquiryQueueItem.hasDraft` — one `select distinct workItemId from InquiryReplyDraft` per page.
- `InboxList.rowState(item, hasDraft)` — the phase is not consulted.
- `inquiryWorkload.classify(row, detail)` — a row with no draft is 「아직 초안이 없는 문의」 whatever
  phase it sits in, and the runtime no longer spends a bounded detail read on a draftless row (that
  read could never have returned a basis).
- Absent the read, **no row claims a draft**: an unread fact is not a true fact, and the fail-closed
  direction here is the one that under-promises.

A `PROPOSED` row with no draft is simply what it always was: 답변 필요.

**Live after:** 2 rows say 초안 준비됨, 8 say 답변 필요.

---

## 3. The workspace grammar

One mental model, not one layout. Every operational surface reads top to bottom as:

```
지금 처리할 일        ← bounded, compact rows, ONE primary each, the work state first
────────────────
전체 기록             ← search / filter, compact rows, quieter ink
```

- **Home / 대화 is the control plane** and is unchanged. It carries intent; the structured surfaces
  own the objects.
- **Workspaces are for exact inspection, bulk handling, search, precision edit and recovery.** A chat
  is not duplicated into a sidebar on every page.
- **A queue row is a door, not a room.** It says what the work is and opens the one screen that does
  it. A row that mounts the work is a task screen wearing a list's clothes, and four of them stacked
  is what 6,550px looked like.
- **A page is not a total.** A screen states the size of the thing, and separately what it is showing.
- **One fact, one place.** A number that appears in the sentence above a button does not appear again
  on the button.

---

## 4. The status vocabulary and where each word comes from

`frontend/src/lib/workState.ts` — one table, and each word names a fact the screen was actually told.
The rule this table exists to keep: **a surface may only say one of these when the field it points at
says so.**

| word | tone | the fact that proves it |
|---|---|---|
| 답변 필요 | warn | the channel's own answered/unanswered state (`FeedItem.status`) |
| 확인 필요 | bad | the stored triage tier / negative-review condition |
| 초안 준비됨 | info | **a draft version exists** (`hasDraft` / `detail.draft`) — never a phase |
| 초안 필요 | warn | reply work was committed to and nothing has been written |
| 승인 대기 | info | a saved draft with no standing approval (`ReviewReplyWorkState`) |
| 승인됨 | neutral | an approval stands. **Never 완료** — the next step is in the seller center |
| 답변함 | neutral | proven answered |

Nothing is `good`: none of these is a proven-finished state, and 승인됨 least of all.

**Deliberately not merged.** 답변 필요 and 초안 필요 look like one state and are two: the first is about
the CUSTOMER (nobody has answered them), the second about the SELLER'S OWN WORK (they put this review
on their list and have written nothing). Collapsing them erases the difference between an inbox and a
worklist. The review lane reads the same table through `replyWorkStateWord`.

`lib/knowledgeWords.ts` gains `KNOWLEDGE_NOUN` for the same reason one level up — 확인 필요 · 상품 지식 ·
운영 기준 · 자료 · 과거 고객 응답 — so a screen cannot invent a sixth noun for what the product knows.

---

## 5. Reviews — before / after

`MyReplyWork` rows are `ReplyWorkRow` (a `WorkItem`): **one** state word, ★, product, the customer's
sentence, the date — and the row itself opens `/reviews/reply/{reviewId}`, the surface Review Approval
Path v1 built, where 승인 sits at **y=594** with the document fitting the viewport at every width.
`작업에서 제외` stays as the list's own quiet control, with its confirmation unchanged.

| | before | after |
|---|---|---|
| `/reviews` document | 6,550px | **4,022px** (−39%) |
| bordered boxes | 11 | 7 |
| pills | 3 | 0 |
| state words per queue row | 4 | **1** |
| customer sentence per row | 2× | 1× |
| reads to render the queue | 1 + one prep read **per row** | **1** |

The whole queue, the attention headline, the filters and the first five record rows now fit inside
~1,140px. `확인 필요만 보기` stopped repeating a number that is already in the sentence beside it and
on the filter chip below it.

`ReviewReplyWorkState` and every approval gate, fingerprint and draft version are untouched. This
package added **no** write to any review surface.

`VocItemCard` had no remaining consumer once both lists became rows, so it and its test were deleted
rather than left as dead code with a passing test. `ReplyWorkControls` — the one reply cluster — is
unchanged and still mounted by the surfaces that do the work.

---

## 6. Inquiries — before / after

The list is also the selection rail, so it stays one column (a two-pane split would break the
340px rail the detail shape depends on). What changed is that **the boundary is now visible and the
words are now true**:

- 「초안 준비됨」 → §2. Live: 10 rows → **2**.
- A labelled divider `답변한 문의 {n}건` before the settled rows, drawn in the same idiom as the
  existing 「1년 넘게 지난 답변 필요 문의」 divider (not a heading — the detail pane keeps the only `h2`),
  and those rows render dim.

Live at 1440: 22 open above the divider, 72 answered below it, and the page header's 22 is the same 22.

---

## 7. Products — before / after

The screen was asking the product **resolver** for a worklist. `GET /api/products` answers 「이 이름의
상품이 있나」; its empty-query head is alphabetical and capped, which is correct for what it is.

`ProductCatalogService` / `GET /api/products/catalog` is the read the screen needed: the org's real
total, and the head ordered by **what the seller owes, then what customers complained about** —
unanswered inquiries → negative reviews → review volume → name. That is the same rule
`lib/productRows.ts` already sorted by; moving it to the layer that can see the whole catalogue is what
lets it work.

Three reads, never one per row (two grouped counts and the catalogue), ranking in memory. The page
stays bounded at 20 because the screen reads facts for every row it shows.

**Two synthetic rules, on purpose.** WHICH products are listed follows the auto-enabled `realDataOnly`
filter, so the page and `countByOrgId` agree in every deployment. WHAT ranks them is REAL only and says
so in the queries: ranking a seller's catalogue by manufactured complaints is how a demo screen came to
name an invented product as the shop's worst.

| | before | after |
|---|---|---|
| header | 「상품 10개」 (catalogue: 308) | **「전체 300개」** + a line saying what the page is |
| first row | 코드 15223228019 · 문의 1 · 리뷰 7 | **선바로 일체형 전선몰딩 · 미답변 1 · 문의 8 · 리뷰 1,761** |
| rows with nothing | 6 of 10 | 0 of the first 12 |
| “more exist” line | never rendered (`rows.length >= 20` against a head of 10) | rendered whenever total > page |

300, not 308, because eight of the org's products are `DEMO_SEED` and the filter excludes them — the
same number `countByOrgId` has always returned. `search` is untouched and still answers search.

---

## 8. Chat ↔ Workspace continuity (verified live)

- **Chat review artifact → exact review workspace.** `/reviews/reply/{id}?from=chat` resolves the
  account by an org-scoped read, renders 답변 작업 for that review, 승인 present, 「대화로 돌아가기」
  present.
- **Chat inquiry artifact → exact inquiry.** `/inquiries/{inquiryId}` selects that row
  (`aria-current="true"`), the list column keeps its own scroll, page height 900px. No other object is
  touched.
- **Workspace and chat now converge.** The 내 답변 작업 row opens the *same* URL a chat review artifact
  links to. Two ways in, one screen — which is the whole reason the row became a door.
- **No standalone chat was added to any workspace.** `conversationWriteFence` and the approval
  boundary are unchanged; this package added no write anywhere.

---

## 9. Orders / Reports / Settings

- **Orders** — audited, unchanged. Filter → four numbers → trend → per-channel revenue, with
  「주문 처리는 각 판매자센터에서 합니다」 stated at the top. It answers the question a seller opens it
  with. No workflow was invented for it.
- **Reports** — audited, unchanged. An archive with five honestly-named sections, 1,332px.
- **Settings** — 「운영 정책 / 답변 기준」 → **운영 기준**, from `KNOWLEDGE_NOUN`. Knowledge's daily
  확인 필요 was **not** pushed here; it stays on `/knowledge`. **Reported, not changed:** 고객운영 메모리
  and 리포트 live under 설정 because they are not in the nav, so 설정 is their only menu home. Removing
  them from a settings screen would strand them, and giving them a nav slot is an IA decision.

---

## 10. Browser QA — 1440 / 1366 / 1152

Real Demo Org, real data, deviceScaleFactor 2, after restarting backend and frontend at this commit.

| | 1440 | 1366 | 1152 |
|---|---|---|---|
| AA text-node violations (composited background) | **0** | **0** | **0** |
| horizontal scroll | none | none | none |
| off-host requests | 0 | 0 | 0 |
| `/reviews` document | 4,022 | 4,022 | 4,052 |
| `/products` document | 1,772 | 1,772 | 1,772 |
| 답변 작업 승인 button `y` | 594 | 594 | **594** |

Console errors are the local-helper health probe (`127.0.0.1`, ERR_CONNECTION_REFUSED) at every width,
as in every prior package; nothing else.

Screenshots (before/after, both widths of every changed surface) hold real customer sentences and stay
outside the repository, in the session scratchpad.

---

## 11. Verification

- backend **3,781** tests · 0 failures (`OperationalWorkspaceTruthTest` new: 4)
- agent-runtime **835** tests · 0 failures
- frontend **2,704** tests / 229 files · 0 failures · typecheck clean

Marketplace calls **0** · marketplace WRITE **0** · model calls **0** · migrations **0** · DB row
changes **0** ⇒ no evidence row.

### Contracts that changed, and the tests rewritten for them

Three, all in the same direction — a screen stating a fact it was told instead of one it inferred.

1. `InboxList.workState.test` — “the state word comes from the work item's **phase** before the feed's
   status” → “초안 준비됨 needs a **draft**, not a phase”, plus the new divider's position.
2. `MyReplyWork.test` — “offers NO competing triage control — the decision is **shown**” → the triage
   decision is no longer shown on a queue row at all (it is read and edited on the surfaces that own
   it); the original assertion, that no interactive triage affordance exists here, is unchanged and now
   true by construction.
3. `MyReplyWork.test` — “preserves the reply-preparation flow — a 대응 필요 row still opens 답변 준비”
   → “opens the review's reply work surface — and reads nothing per row to do it”. The flow is not
   withheld; it moved to the screen built for it. A second test was added for the row that cannot be
   opened at all (a Cafe24 community article is not a `reviews` record — the absence of an affordance,
   never the absence of the row).
4. `inquiryWorkload.test` (runtime) — `classify("PROPOSED", null) → DRAFT_READY` → `UNANSWERED`. The
   deleted premise is quoted in §2.

**No safety test was weakened.** Nothing in this package touches approval, execution, retrieval,
guided-browser or the Agent tool catalogue.

### Repository-rule conflict, reported

`frontend/CLAUDE.md` forbids `backend/**` edits in that workstream. This package modifies six backend
files, under the product-owner instruction in the brief («backend state 자체가 잘못되어 UX를 정상화할 수
없다면 필요한 작은 domain/backend 수정은 가능하다», conflict priority 1). Every one of them is a read:
two facts a screen needed (`hasDraft`, `reviewId`), two grouped counts, one catalogue read. **No state
semantics were changed and no state was invented** — `PROPOSED` still means exactly what it meant.

---

## 12. Still awkward, and the next package

**Reported, not fixed:**

- **`/inquiries` is still 7,100px.** The boundary is visible and the words are true, but 94 rows in one
  column is a long page. Splitting it properly means the list column stops being the selection rail,
  which is a layout the detail shape depends on — an IA decision, not a defect fix.
- **Synthetic rows stamped `data_origin='REAL'`.** 「전선몰딩 1호 (합성 샘플)」 and 「코너 커버 2호 (합성
  샘플)」 are in the review work queue and the product list because they are stored as real. Reported by
  three previous packages; historical cleanup is out of scope and would be a data decision.
- **Product detail's 미답변 문의 count is not a door.** `/inquiries` has no product filter, so a link
  from a product to its own unanswered inquiries cannot be made honestly today. It needs a
  product-scoped inquiry read — a backend capability, not a copy change.
- **`/products` catalogue total is 300 while the table holds 308.** That is the `realDataOnly` filter
  working as designed and the same number every other screen shows; it is a fact about this deployment,
  not a defect.
- **고객운영 메모리 / 리포트 under 설정** — §9.
- **Product names that are bare numeric codes** — a data fact, rendered as a product object with a
  muted 「코드」 mark rather than replaced.

**Next:** 문의 IA (queue and archive as two surfaces rather than two regions of one list), and a
product-scoped inquiry read so a product can open its own work.
