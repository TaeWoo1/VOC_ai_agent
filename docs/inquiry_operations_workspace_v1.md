# Data Origin Integrity + Inquiry Operations Workspace v1

2026-09-04 · HEAD before this package: `11f5274c` (Operational Workspace UX System v1 PASS).

Two stages. A small provenance closure, then the 문의 surface rebuilt as work-queue → record.

Chat · Reviews · Knowledge · Retrieval · Guided execution are unchanged. No approval boundary, no
write path, no `DataOrigin` value and no marketplace semantics were touched.

---

# [1] Data Origin Integrity

## 1.1 The contract, and the paths that write it

`DataOrigin` is already three values with a stated meaning: `REAL` (acquired from the seller's actual
channel), `DEMO_SEED` (`MockDataSeeder`), `VERIFY_FIXTURE` ("written by a live-verification run to
prove a code path end to end — real in shape and synthetic in origin"). It is a projection axis, not a
delete: rows stay and stop being counted.

Producers audited:

| path | writes | correct? |
|---|---|---|
| connector ingest (API, export, Action Window) | `REAL` by column default | ✅ — this is what REAL means |
| `MockDataSeeder` | `DEMO_SEED` explicitly, on every entity it builds | ✅ |
| V54/V55/V56 one-time classification | structural rules over pre-column rows | ✅ for what it could see |
| `AnswerMemoryService` | the caller's value, `REAL` when absent | ✅ (derived from a REAL row) |
| **gated collector integration tests** | **`REAL`** | ❌ — the root cause |

## 1.2 Root cause

Two `it.skipIf(!RUN_INTEGRATION)` tests in `collector/test/upload.test.ts` POST review CSV **to a real
local backend through the production ingest path** — `FileParser` → `ReviewRowMapper` →
`IngestionService`, the same path a seller's export takes. Both defaulted to
`SELLEROPS_EMAIL ?? "demo@sellerops.ai"`.

That path records what it is handed, and it is right to: nothing in an upload says "this came from a
test". So the rows landed as `REAL`, indistinguishable from an export row. **The ingest path was never
the defect. Uploading fixtures into an organisation that holds a seller's data was.**

V54's rule could not catch them. It classified pre-column rows by a structural fact — `MockDataSeeder`
builds entities by hand, so its rows carry neither an external id nor a content hash — and these rows
came through ingest, so they *have* an external id and the rule passed over every one.

The second test mints `randomUUID()` ids **deliberately** (a fixed id would already be in the dev DB
and the insert half of the assertion would pass vacuously), so it could not stop growing. Measured:

```
COLLECTOR-SMOKE-<ts>-N    5   2026-06-17   no generator survives in any ref
SYN-<date>-<hex>-000N     3   2026-06-22   no generator survives in any ref
awfx-<uuid>              15   2026-07-11…  collector/test/upload.test.ts, 3 rows per run × 5 runs
                         ──
                         23
```

Those 23 are already enumerated row-by-row in `contracts/review-eval/naver/v2/synthetic-rows.json`
(`inFrame: 23`) — the review-evaluation corpus knew about them and reports every reading with and
without them. What was missing was the fact in the database.

## 1.3 The closure

**Producer** — `disposableOrg()`: both gated tests now sign up their own throwaway organisation
through the product's own `POST /api/auth/signup`, on `@example.invalid` (RFC 2606, undeliverable),
fresh per run. The credential is never taken from the environment — an operator who exported
`SELLEROPS_EMAIL` for something else must not thereby aim this at their own shop. Rows still
accumulate, in an org nobody reads. `collector/test/ingest-fixture-fence.test.ts` fixes it: no
seller credential in that describe block, one token source, signup + `.invalid` + a per-run nonce.

**Classification** — `V93__ingest_fixture_data_origin.sql` marks those rows `VERIFY_FIXTURE`, the
value the enum already defines for exactly this. No new origin, no widened contract, nothing deleted.
The patterns match each family's **whole documented shape**, not a prefix, and were verified against
the live DB before being written down: 15 / 3 / 5 matched, and **zero 10-digit ids** — a real NAVER
리뷰글번호 is 10 digits (`contracts/review-id-fingerprint/v1/SPEC.md`), so none of these can name an
export row. Derivations inherit, by V55's own rule and join.

**The cascade is restricted to the cause.** V56's evidence rule ("a product is real when at least one
REAL review or inquiry supports it") is re-run only over rows a fixture review actually held up.
Running it unrestricted was tried and measured first, and it swept two rows V56 never saw — the
catalogue has grown since it ran once:

- **`(미지정 상품)`** — ingest's own placeholder bucket, which `ProductService` looks up **by name**.
  Hiding it behind the filter would have made the next unattributed ingest create a second one.
- **a bare Cafe24 product code with no reviews yet** — a real product the seller sells.

Neither is a fixture and neither has anything to do with the cause fixed here. Whether V56's rule
should be re-run over the whole catalogue is a separate question; this migration does not answer it.
Both rows were restored and the migration re-applied from a clean history.

**Regression, asserted rather than intended.** Every demotion clause requires a `VERIFY_FIXTURE`
review to exist AND no REAL evidence, so a REAL→non-REAL move is structurally impossible. Measured
after: products supported by REAL evidence and demoted anyway = **0**; 10-digit NAVER reviews
demoted = **0**.

Demo Org, before → after:

| | before | after |
|---|---|---|
| reviews REAL | 4,622 | **4,599** |
| reviews VERIFY_FIXTURE | 0 | **23** |
| products REAL | 300 | **294** |
| listings REAL | 294 | **289** |
| item_analyses REAL | 7,748 | 7,725 |
| customer_memory REAL | 7,830 | 7,807 |
| inquiries | unchanged | unchanged |

## 1.4 「308 vs 300」 — what it actually was

**Not a subset label and not a mismatch.** `products` holds 308 rows for this org; 8 were already
`DEMO_SEED` before this package, and `data_origin` is an auto-enabled Hibernate filter, so *every*
ordinary read — including `countByOrgId`, which the catalogue total uses — returns 294 (300 before the
six fixture-held products were reclassified).

So the two numbers were never in conflict: 308 was a raw `psql` count including manufactured rows, and
300 was what every screen in the product has always shown. **No label was changed and no filter was
invented.** The number moved 300 → 294 for a different reason, stated above.

---

# [2] Inquiry Operations Workspace v1

## 2.1 The before structure, measured

`/inquiries` made ONE read — the inbox feed at `limit=500` — and rendered every row it got in a single
column, filtering and ordering on the client.

- **7,100px, 94 rows, one heading** (`h1:문의`). 22 unanswered, 72 answered.
- **Work and record were the same list.** An answered inquiry from last week sat at the same weight as
  the oldest unanswered one, four rows below it.
- **No search at all.** A seller looking for 「세금계산서」 scrolled.
- **The ceiling was a cliff.** `limit: 500` with 「목록은 최근 500건까지 표시됩니다」 as the whole story;
  a pilot seller with three thousand inquiries would have been handed 500 rows and told nothing about
  the rest.
- **A deep link needed the whole page loaded.** The 500-row read existed partly so that any linked row
  would be somewhere in it.
- **A dead mode.** The `scope` prop's mixed 문의+리뷰 branch had no caller since product assembly A2.

## 2.2 The IA

```
문의                                   ← header: 지금 처리할 일 N건
  AI가 먼저 확인한 일                   ← unchanged
  지금 처리할 일  N                     ← WORK QUEUE, bounded by how much work exists
     · 최근 대기 (longest-waiting first)
     · ── 1년 넘게 지난 문의 N건 ──      ← divider, dim rows
  전체 문의  N                          ← RECORD: 검색 · 채널 · 답변 상태 (server-side), one page
```

A chosen row keeps the two-shape layout Executive-friendly UX Redesign v1 measured: the sections step
back to a 340px rail and 고객 문의 + AI 답변 take the rest. That was not disturbed.

**Two reads, because there are two questions** — and the product already had both endpoints.

**An inquiry may be in both, and that is not a duplicated fact.** In the queue it is work; in the
record it is a record. 리뷰 has read this way since Review Approval Path v1 (4 rows in 내 답변 작업,
all 4,455 in 목록), and the record's own line says so: 「답변한 문의까지 모두 여기 있습니다」.

## 2.3 The work queue's membership condition

`GET /api/inquiries?phase=OPEN` + `?phase=PROPOSED` — i.e.
**`InquiryWorkItemPhase.AWAITING_SELLER`**, declared once in the backend as 「the phases where the work
is still waiting for the SELLER to decide something」 and read by every recommendation surface. A phase
added later has to be classified there; **nothing about inclusion is decided on this screen.**

State words come from `lib/workState.ts` and each names a fact:

- **초안 준비됨** ⟸ `hasDraft` — the draft's own answer. Never the phase (that defect was closed in
  `11f5274c`; the demo org's ten `PROPOSED` rows still hold two drafts, and the screen still says 2).
- **답변 필요** ⟸ the channel's own status.

**No new heuristic.** Ordering is longest-waiting first — the one urgency criterion this product has
(`conversation/urgency.ts` says so in as many words) — applied **inside** two groups rather than across
them, because this org's Cafe24 backlog reaches back a decade and a 2014 question sorted purely
worst-first buries one from an hour ago. The old rows are not hidden, dropped or reordered away.

**A failed queue read says so** (「지금 처리할 일을 불러오지 못했습니다」) and the record, a separate
read, is unaffected. **Zero renders no section** — a heading over an empty queue is a number the seller
cannot act on.

## 2.4 The record

`GET /api/inquiries/rows`, which already took window · channel · status · order · limit · subject-word.
One page of 50, `totalCount` beside it, and the filters ARE the URL — so a narrowed list is a link.

「최근 N건을 보여 드립니다」 renders **only when there is more behind it**. An empty result is told apart:
「찾는 문의가 없습니다」 when the seller narrowed, 「아직 들어온 문의가 없습니다」 when they did not.
Answered rows are dim: the record is a place to look things up, never louder than the work above it.

Not built: a table framework, column sorting, saved views, bulk selection.

## 2.5 상품 → 문의 doorway

`/inquiries?productId=…`, with `&status=UNANSWERED` on the 미답변 figure.

**The number and the door share a predicate.** `productId` was added to the rows query beside the
existing axes, and it is the **binding** (`inquiries.product_id`) — deliberately distinct from `q`,
which also matches a product *name*. It is the same clause `countByOrgIdAndProductIdAndStatus` uses,
which is the count the 상품 screen prints. Asserted live and in a test: **printed 1 → opened
`totalCount` 1**; all-status **8 → 8**.

**Zero is not a door.** A figure of 0 renders as a plain tile: a control that opens an empty list is a
broken promise.

The scope is stated (「{상품}의 문의만 보고 있습니다」) and clearable (「전체 문의 보기」). Another org's
product id is not a probe — the org clause means it matches nothing.

**The work is scoped too, and that was found by looking.** With only the record scoped, a seller who
pressed 「미답변 문의 1」 arrived at a page whose first section was 21 items about other products, with
the row they asked for **1,900px** below it — the doorway would have delivered them to the wrong thing
correctly. When the page is about one product, so is the work on it, and the heading says
「이 상품의 지금 처리할 일」. It is a filter over rows already read (`productId` is on every queue row),
never a second query. **Doorway page height: 1,947px → 900px**, the whole thing inside the viewport at
all three widths.

## 2.6 Exact inquiry and detail

`/inquiries/{inquiryId}` is unchanged as a route and still mounts the same `InboxDetail` — no side
panel, no second detail surface, no per-row expansion. The 340px rail keeps the selection.

**A deep link naming a row the current page does not hold** is fetched by `?inquiryId=` through the
SAME predicate: one indexed lookup where the screen used to keep 500 rows loaded so that any link
would resolve. A row that cannot be found says so.

## 2.7 Chat ↔ Workspace continuity

- Chat inquiry artifact → `/inquiries/{inquiryId}` (the runtime's existing link, unchanged) → that row
  is selected and its detail opens, whether or not the current filters would have shown it.
- The Agent context carries `workItemId` when one resolves — from the queue, the record page, or the
  linked row — so 「이 문의에 대해 물어보기」 promises 「이 문의」 only when it can scope it, and
  `productId` rides along when the page is product-scoped.
- No standalone chat was added. `conversationWriteFence`, the approval boundary and the publish path
  are untouched; this package added **no write anywhere**.

## 2.8 Knowledge gap state (§6)

The defect: a seller answers an exact gap, the candidate closes by id (Knowledge Gap Continuity v1) —
and the regenerated draft still cannot use that knowledge, so the screen says **「답변 기준이
필요합니다」 again**. That tells them their work did not happen. It did; it just does not answer *this*
question yet, and those are two different sentences.

**The fact already existed and was being swallowed.** `noteGap` returns null when this org has already
`ACCEPTED` this exact ask — same scope, same product, same question — and the composer treated that
null as "nothing to say". It now reads it (`alreadyAnswered`, one extra query, only on the path that
filed nothing) and the gap carries `previouslyAnswered`. The screen says:

> **답변 기준은 추가하셨습니다.**
> 다만 이 질문에 그대로 적용할 수 있는 내용은 아직 찾지 못했습니다.

with the way out still offered, relabelled 「답변 기준 더 채우기」 — adding more IS the next step; what
stops is asking for what was already given. **Identity only, never resemblance.** A reload does not
claim it: a stored draft row records what was decided, not what the inbox held.

**No retrieval, threshold, scorer or Knowledge model change.**

## 2.9 Status truth

| word | source of truth |
|---|---|
| 초안 준비됨 | `InquiryQueueItem.hasDraft` — a draft VERSION exists |
| 답변 필요 (queue) | the work item is in `AWAITING_SELLER` and has no draft |
| 답변 필요 / 답변함 (record) | `inquiries.status`, the channel's own state |
| 지금 처리할 일 N | the queue read's own row count |
| 전체 문의 N | `rows.totalCount`, the same predicate as the page |
| 미답변 문의 N (상품) | `countByOrgIdAndProductIdAndStatus` — and the door opens that predicate |
| 답변 기준은 추가하셨습니다 | `KnowledgeCandidate` ACCEPTED under the ask's own identity |

## 2.10 Browser QA — 1440 / 1366 / 1152

Real Demo Org, real data, `deviceScaleFactor: 2`, after restarting backend and frontend at this commit.

| | 1440 | 1366 | 1152 |
|---|---|---|---|
| `/inquiries` document | **5,536** (was 7,100) | 5,536 | 5,536 |
| `/inquiries?productId=…&status=UNANSWERED` | **900** | 900 | 900 |
| AA text-node violations (composited background) | **0** | **0** | **0** |
| horizontal scroll | none | none | none |
| off-host requests | 0 | 0 | 0 |

Click path: `/products/{id}` → press 「미답변 문의 1 ›」 → `/inquiries?productId=…&status=UNANSWERED`
→ 「이 상품의 지금 처리할 일 1」 and 「전체 문의 1」, both above the fold, scope stated and clearable →
press the row → `/inquiries/{inquiryId}` with the detail beside the rail. **Two clicks, no scrolling.**

Console errors are the local-helper health probe (`127.0.0.1`, ERR_CONNECTION_REFUSED) at 1440/1366,
as in every prior package; none at 1152.

## 2.11 Semantic defects found and fixed along the way

1. **`InquiryQueueItem.snippet` was on the wire and missing from the FE type**, so the queue row could
   not show the customer's sentence without adding it — the row would have had to be titled by the
   product name, which every row on a scoped page shares.
2. **The doorway landing** (§2.5) — found by rendering it, not by reasoning about it.
3. **A duplicated JPQL clause** in `findRowsInWindow` that would have made every Spring context fail to
   start. Caught by the suite before it left the machine, recorded because it is the kind of edit that
   compiles.

## 2.12 Verification

- backend **3,786** tests · 0 failures (5 new)
- collector **9,417** tests · 0 failures (2 new)
- agent-runtime **835** · frontend **2,708** / 229 files · 0 failures · typecheck clean

Marketplace calls **0** · marketplace WRITE **0** · model calls **0** · approvals **0** · migrations
**1** (V93) ⇒ no evidence row.

**Contracts that changed, and the test rewritten for it.** `CustomerInbox.test` was rewritten for the
two-read shape: the old assertions were about a client-side 인박스 필터 rail, a single 문의 목록 and the
mixed mode. Everything they protected that is still true is asserted (the list is the screen until a
row is chosen; a deep link opens its row; the response workflow appears only when a work item
resolves; no send on the default posture; empty and failed states told apart), plus the new
properties. **No safety test was weakened.**

**A flaky test, reported honestly.** `ReviewReplyTemplates.test` failed once in a full-suite run and
passed in isolation and on a full re-run. Untouched by this package; not investigated.

## 2.13 Remaining UX debt

**Inquiries** — `/inquiries` is still 5,536px because the queue holds 21 items and every one is real
work; that is the length of the seller's actual backlog, not a layout defect. The record page is 50
rows with no 「더 보기」: the seller narrows rather than pages, which is right for finding and wrong for
browsing.

**Products** — the 리뷰 and 문제 근거 figures are still plain tiles: `/reviews` has no product filter and
the issue-evidence list has no product-scoped route, so a door cannot be made honestly today. Both need
a backend read, not a copy change.

**Orders** — audited in the previous package, unchanged. Filter → four numbers → trend → per-channel.
No workflow was invented for it.

**Reports** — an archive, 1,332px, five honestly-named sections. Unchanged.

**Settings** — 고객운영 메모리 and 리포트 live under 설정 because they are not in the nav, so 설정 is
their only menu home. Removing them would strand them; giving them a nav slot is an IA decision.

**Data** — `data_origin` is now correct at the producer, but `MockDataSeeder`'s own 8 products and 44
reviews remain in the Demo Org as `DEMO_SEED` (excluded from every read, by design). Historical
cleanup is out of scope.
