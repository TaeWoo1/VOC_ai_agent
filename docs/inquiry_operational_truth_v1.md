# Inquiry Operational Truth & Sync Lifecycle Hardening — v1

**Date** 2026-08-22 · **Branch** `feat/inquiry-operational-truth` · **Local PG 15.13 `sellerops`**,
org `7146c50f…d8e0` · **No marketplace contact, no credential read, no WRITE.**

**What this is.** The audit that preceded it
(`docs/cafe24_inquiry_source_reconciliation_audit_2026-08-22.md`) and the package that acts on it.
Three separate defects, one package, because they share one corpus:

1. the seller's spam decisions were recorded and then ignored by every current-truth read;
2. a historical backfill permanently redefined where routine collection starts;
3. nothing anywhere recorded "the source still showed us this row", so no reconciliation of any kind
   could be built.

**What it is NOT.** Not a deletion, not an absence-based reconciliation, and not a spam classifier.
Nothing here decides what is spam — the seller already did, through the approved dismissal batches of
2026-07-06 — and nothing here turns a missing row into a deleted one.

---

## 1. The finding, in one paragraph

`inquiry_work_item` has held **3,199 rows at `DISMISSED` / `disposition=SPAM`** since 2026-07-06,
written by seven approved batches with manifest hashes (`cafe24-spam-dismiss-2026-07-06-chunk-01…07`,
`approved_by=demo@sellerops.ai`). The work queue honoured that decision, because the queue read is
phase-filtered. **Nothing else did.** 홈, Today Inbox, 상품 신호, 반복 문의, item analysis and the
Operator all count through `inquiries` directly, and `inquiries` had no idea. The home screen printed
**3,208 미답변** of which **3,199 were work the seller had already decided not to do**, and the repeat
analysis reported `기타 ×1,779 · 품질 ×523 · 사이즈 ×473 · 배송 ×240 · 가격 ×195` — every one of them
a spam board post — as customer patterns.

---

## 2. Schema and model

| Object | Migration | What it holds |
|---|---|---|
| `inquiries.operational_state` | **V51** | `ACTIVE` · `EXCLUDED_SPAM` · `SOURCE_REMOVED`, NOT NULL default `ACTIVE` |
| `inquiries.operational_state_at` | V51 | when it last changed; null while never left `ACTIVE` |
| `inquiries.last_seen_at` | V51 | when the source last showed us the row — **including unchanged runs** |
| `idx_inquiries_org_state_status` / `…_received` | V51 | the two shapes every current read now has |
| `sync_cursors` key `backfill` | **V52** | the historical lane, split from the routine `primary` lane |

`InquiryOperationalState` is a closed enum. `SOURCE_REMOVED` is **spelled and unreachable** — the same
technique the Operator's WRITE action class uses — so that the day a sweep is proven authoritative there
is somewhere honest to put a source deletion, and until then a test can assert nothing puts one there.

### Source of truth

```
inquiry_work_item.phase = DISMISSED          ← the AUTHORITY (seller decision, approved batch, audited)
  + .disposition        = SPAM
            │
            │  InquiryOperationalStateProjector    (the ONLY writer)
            ▼
inquiries.operational_state = EXCLUDED_SPAM  ← a PROJECTION (rebuildable, reversible, never a decision)
            │
            ▼
InquiryRepository.ACTIVE  →  홈 · Today Inbox · 상품 신호 · item analysis · 리포트 · Operator
CustomerMemoryEntryRepository.ACTIVE_SOURCE  →  반복 문의 · 현재 retrieval
ItemAnalysisRepository (list)  →  FAQ / 상세페이지 후보
```

The projection is **symmetric**: `project()` returns the state the ledger implies *right now*, not a
one-way transition — so a reversal at the work item flows back through the same call with no undo
bookkeeping. `InquiryOperationalStateFenceTest` proves there is exactly one writer, because a second
writer is a second authority and the first symptom would be a count that disagrees with the queue with
nobody able to say which is right.

### What deliberately does NOT carry the exclusion

- **Dedup keys** (`existsByOrgIdAndChannelId…`, `findByOrgIdAndChannelIdAndExternalId`). They must see
  every stored row or a re-collected spam post would insert a second copy of itself on every sweep.
- **Id-driven reads** (`findAllById`). The caller has already decided what it is asking about.
- **Historical / audit reads.** Exclusion is a state, never a delete.
- **The customer-memory index itself.** 3,201 entries were kept; only *current retrieval* passes over
  them. The guard is a subquery on the inquiry, not a copy of the flag on the entry — a copy would be a
  second place to be wrong, and the two would drift the first time a dismissal was reversed. It is
  written as "not exists an excluded source" rather than "exists an active source", because the two
  differ only for an entry whose inquiry row is gone, and there the second form would turn a missing
  record into evidence of a dismissal nobody made.

---

## 3. Cursor lifecycle repair (defect 2)

**The invariant: a historical backfill must never redefine the starting cursor or window of routine
collection.**

`sync_cursors` held one row per (org, account, data type) under the key `primary`, and
`SyncRunExecutor.runPages` wrote the operator's backfill seed into it. Nothing ever cleared it. The demo
org's Cafe24 INQUIRY cursor was found parked at **`b6:o2:s2025-03-23:e2025-03-25`** with an **hourly
schedule enabled** — so every scheduled run swept a three-day window from March 2025 starting at offset
2, collected nothing, and did so forever. That is why 3,201 inquiries collected on 2026-07-06 were never
re-observed once (**3,200 still carry `created_at = updated_at`**), and why no reply-status change on any
of them could ever land although the upsert that would have applied it has existed since V34.

Two lanes, one table: `primary` is routine, `backfill` is historical. V52 moves any `primary` value in
the windowed article-cursor shape into the backfill lane and clears the routine one. A cleared routine
cursor is the honest state — "routine collection has recorded no progress on this board" — and it
restores the unbounded offset sweep that was the behaviour before any backfill ran. That sweep is
idempotent: the V34 external-id upsert absorbs a re-observed article as an update or a no-op.

Applied live:

| account | data type | before (`primary`) | after (`primary`) | after (`backfill`) |
|---|---|---|---|---|
| `78da0eb3…` (demo) | INQUIRY | `b6:o2:s2025-03-23:e2025-03-25` | *(null)* | `b6:o2:s2025-03-23:e2025-03-25` |
| `78da0eb3…` | REVIEW | `b4:o0:s2026-06-30:e2026-07-06` | *(null)* | `b4:o0:s2026-06-30:e2026-07-06` |
| `c5f63e75…` | INQUIRY | `b6:o905:s2026-05-06:e2026-05-06` | *(null)* | `b6:o905:s2026-05-06:e2026-05-06` |
| `c5f63e75…` | REVIEW | `b4:o3:s2026-04-09:e2026-06-25` | *(null)* | `b4:o3:s2026-04-09:e2026-06-25` |
| `bdccb7a7…` / `c5f63e75…` | ORDER_SUMMARY | JSON envelope / date | **untouched** | — |

ORDER_SUMMARY cursors self-window and are not backfill seeds, so the pattern cannot match them.

---

## 4. Observation primitive (defect 3)

Both upserts skipped the save entirely when the source matched storage, so an unchanged row and a row
the seller deleted at the platform left **exactly the same trace: none**. `inquiries.last_seen_at` and
`cafe24_community_articles.collected_at` are now written on the no-op branch too.

**Recording it is not acting on it.** Nothing turns a stale `last_seen_at` into a tombstone, and
`InquiryOperationalStateFenceTest` proves there is no such path — by text scan *and* by exhausting every
(state × work-item shape) combination through the projector. Absence-based reconciliation stays disabled
until a Cafe24 sweep is proven to be an authoritative snapshot; §7 lists what that proof requires.

---

## 5. Live result on the real corpus

All numbers below are the demo org through the real HTTP API, backend restarted on this branch.

| Reading | Before | After |
|---|---|---|
| 홈 `GET /api/dashboard/summary` 미답변 | **3,208** | **9** |
| Today Inbox / 리포트 / Operator `GET /api/inbox` 미답변 | **3,208** | **9** |
| 홈 할 일 문구 | `미답변 문의 3208건을 확인하세요.` | `미답변 문의 9건을 확인하세요.` |
| `GET /api/item-analysis` rows | 7,136 | **3,937** (INQUIRY 3,220 → 21) |
| … of which `답변 필요` | 3,208 | **9** — the same number as the inbox |
| 상품 `b718ed98…` 신호 (inquiries / unanswered) | 3,201 / 3,200 | **2 / 1** |
| 반복 문의 TOPIC 축 | `품질 523 · 사이즈 473 · 배송 240 · 가격 195` | **`색상 4 · 설치 3 · 제품정보 3 · 가격 2`** |
| 반복 문의 SIGNATURE 축 | 6 (already clean) | 6 (unchanged) |
| `indexedInquiries` (rubric denominator) | 3,220 | **21** |
| `inquiries` rows | 3,229 | **3,229** — nothing deleted |
| `customer_memory_entries` INQUIRY | 3,220 | **3,220** — nothing deleted |
| `inquiry_work_item` DISMISSED/SPAM | 3,199 | 3,199 — untouched |

Recovery of the existing rows, through `POST /api/inquiries/operational-state/backfill`:

```
run 1  {"examined":3199,"excluded":3199,"restored":0}
run 2  {"examined":3199,"excluded":0,"restored":0}      ← idempotent
```

**Reversal, proven live and round-tripped:** one work item moved `DISMISSED → OPEN`, backfill →
`{"restored":1}` and 미답변 **9 → 10**; restored to `DISMISSED/SPAM`, backfill → `{"excluded":1}` and
미답변 **10 → 9**. The database ends exactly where it started.

Other orgs: **untouched**, all 30 remaining inquiries `ACTIVE`. Reviews: untouched (3,916 analyses).

---

## 6. Repeat-inquiry re-measurement (contaminated vs clean)

`contracts/inquiry-issue/v1/RUBRIC.md` gates, recomputed on the cleaned corpus. **The contaminated
figures are kept beside the clean ones deliberately** — a measurement whose denominator changed is not
the same measurement, and quietly replacing it would hide that the corpus, not the classifier, moved.

| Gate | 2026-08-21 (contaminated) | 2026-08-22 (clean) | Verdict |
|---|---|---|---|
| G1 recall | 19 / **3,220** = 0.006 | 19 / **21** = **0.905** | the denominator was the defect, not the classifier |
| G2 precision | 1.00 on the genuine subset | 1.00 | PASS |
| G3 usefulness (≥5 signatures × ≥3 occurrences / 28d) | **4** | **4** | **미달 — unchanged** |
| G4 no manufactured pattern | 0 violations (0/3,201 spam labelled) | 0 violations | PASS |

**G3 did not move, and that is the honest result.** The spam never produced a signature — the classifier
refused all 3,201 — so removing it from the corpus could not add a repeat. What the cleanup fixed is the
**TOPIC axis**, which was the rule-based extractor's output and *was* counting spam: `품질 523` and
`사이즈 473` were never customer patterns. The remaining constraint on G3 is the size of the genuine
corpus (**21 indexed inquiries, 19 signed**), not contamination. **Repeat-inquiry detection therefore
stays a LIMITATION**, for a different and now clearly stated reason.

---

## 7. What still needs a live Cafe24 reconnect

Every collection run on the demo org's Cafe24 account has failed since **2026-08-18** with
`자격 증명 복호화에 실패했습니다` (41 INQUIRY runs). Nothing in this package assumes otherwise, and none of
it required the marketplace.

Left explicitly at the live approval boundary:

1. **Re-connect the Cafe24 account.** Until then the repaired routine cursor cannot actually sweep, so
   `last_seen_at` stays null on every row (0 of 3,229 — measured, not assumed).
2. **Prove the routine lane sweeps forward.** One unbounded board-6 sweep to exhaustion, then observe
   that new articles land and reply-status changes update rows in place. The mechanism is repaired and
   unit-proven (`SyncCursorLaneTest`); the live half needs the connection.
3. **Prove a sweep is an authoritative snapshot** — the precondition for ever enabling
   absence → `SOURCE_REMOVED`. Conditions carried over from the audit: one job, one board, one closed
   window, offset 0 to exhaustion, `SUCCESS`, no rate-limit, no page error, no `MAX_PAGES` trip, zero
   rows dropped for a missing `article_no`, and an observed-count floor against the stored count. The
   `start_date`/`end_date` filter is doc-asserted and has already been observed returning rows outside
   its own window, so this is the item that genuinely needs live evidence rather than reasoning.
4. **Whether Cafe24 exposes deletion or restriction at all.** The row projection carries nine fields and
   none of them is a visibility flag; a 비노출 게시글 may be invisible to us even when it is still there.

---

## 8. Regression

| Suite | Tests | Failures |
|---|---|---|
| backend | **2,582** (+17) | 0 |
| frontend | **2,215** (+2) | 0 |
| agent-runtime | 232 | 0 |
| collector | 9,150 | 0 |

New: `InquiryOperationalTruthTest` (8) · `InquiryOperationalStateFenceTest` (3) ·
`SyncCursorLaneTest` (2) · `SourceObservationPrimitiveTest` (3) ·
`reportView.test.ts` parity + unavailable (2).

Existing tests changed, and why: `Cafe24ArticleBackfillFlowTest` now reads the **backfill** lane (the
behaviour it asserts moved lanes, it did not change); the two dismissal-service tests take the projector
in their constructor.

---

## 9. Product decisions this leaves open

1. **Does an excluded inquiry belong in historical reports?** Current/live figures reflect the exclusion
   immediately (§5). Nothing rewrites a past report, because nothing stores one — the weekly report is
   derived live from four endpoints. If stored periodic reports ever exist, this is the question that
   has to be answered first.
2. **There is no seller-facing un-dismiss control.** Reversal works and is proven, but today it is
   reached by moving the work item and re-running the projection. Whether a seller should be able to
   restore a dismissed inquiry from the UI is a product decision, not a missing implementation.
3. **The corpus itself.** 3,201 of this org's 3,229 inquiries are spam board posts that the platform may
   or may not still be serving. That is a collection-policy question (should board 6 spam be ingested at
   all?), and it is upstream of everything here.
