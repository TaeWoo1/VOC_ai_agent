# Proactive Operations Agent v1 — bounded live tick

**Date:** 2026-08-25 · **Org:** canonical Demo Org · **Branch:** `feat/proactive-operations-agent-v1`
**Verdict:** **LIVE_PARTIAL** — the tick ran correctly and prepared nothing, because after the
bootstrap fence this org has no current work to raise.
**Marketplace WRITE 0 · marketplace READ 0 · new channel call 0 · LLM call 0**

---

## 1. Bootstrap flood audit — the reason this proof did not start with a live tick

The candidate gate as landed was **RED**. It asked whether work is real; nothing in it asked whether
the work is *current*. Measured against the canonical Demo Org, on the day the switch would have been
flipped:

| lane | eligible, no fence | oldest source date | newest source date | within 30 days |
|---|---|---|---|---|
| INQUIRY | **22** | 2014-10-28 | 2025-02-19 | **0** |
| REVIEW | **16** | 2020-10-10 | 2026-07-02 | **0** |

Every one of the 22 inquiries was over a year old; the newest was 18 months old. All 22 work items
were created in a **single historical backfill on 2026-08-22**. And the ordering was `created_at ASC`
— oldest first — so a capped first tick would have spent its whole budget on the org's stalest rows
and told the seller a customer had been waiting since 2014.

**Source-state fingerprint dedupe does not cover this.** It guarantees "the same state is not analysed
twice"; it says nothing about whether a state should have been analysed at all.

### The fence

One clause per lane plus one required config value. No watermark subsystem, no new table.

- `sellerops.proactive.observed-since` — an ISO-8601 instant. Only work SellerOps **first observed** at
  or after it may be investigated. **Blank is fail closed: no boundary, no candidates, ever.**
- Inquiry gate adds `inquiry_work_item.created_at >= :observedSince`; review gate adds
  `reviews.created_at >= :observedSince`.
- Ordering flipped to **newest-observed first**.

Three columns were considered and rejected, each for a measured reason:

| column | why not |
|---|---|
| `updated_at` / `last_seen_at` | routine collection touches them every sweep — **3,266 of this org's 3,334 inquiry rows** carry a touch newer than their insert. Either would call the whole corpus fresh every hour. |
| `received_at` alone | a historical backfill run *after* enable pours the same backlog in through the other door. |
| any default value | "beginning of time" is the flood; "process start" re-opens it on every restart; "now, remembered somewhere" is the watermark subsystem this deliberately does not build. |

**Reconcile is never fenced.** Closing a card whose inquiry was answered overnight is correct whether
or not the org may prepare new ones.

### A second fence the audit forced

The local deployment runs self-pilot scope `LOCAL_SINGLE_USER` — "every org in this database", **35 of
them**. A proactive loop inheriting that scope would have begun preparing work for every one on the
day it was switched on. So the target set is now an **intersection**: `sellerops.proactive.org-ids`
(blank = nobody) filtered by the orgs self-pilot allows. The named list is the SOURCE, never a filter
applied after enumerating the database. Proven live: the tick logged **대상org수=1**.

### After the fence

| lane | before | after (boundary `2026-08-23T00:00:00Z`) |
|---|---|---|
| INQUIRY | 22 | **0** |
| REVIEW | 16 | **0** |

**Boundary chosen as "after every bulk import".** This org's imports were 2026-06-17 (3,700 reviews),
2026-07-06 (3,201 inquiries), 2026-08-22 (68 inquiries, 130 reviews) and **2026-08-23 (505 reviews)**.
That last one matters: an earlier draft of this proof was going to use a rolling 72-hour window, which
would have admitted one review — and that review turned out to be part of the 08-23 bulk import. A
window measured in hours cannot tell an import from an arrival; a boundary placed after the imports
can.

---

## 2. The live tick

Config: `enabled=true`, `org-ids=<canonical Demo Org>`, `observed-since=2026-08-23T00:00:00Z`,
`inquiries-per-tick=2`, `reviews-per-tick=1` (ceiling 3), `interval=24h`, `initial-delay=25s` — a
single invocation through the production scheduler path, not a test harness.

```
23:38:08  proactive: tick 시작 대상org수=1
23:38:08  proactive tick org=<demo> 재확인=0 준비(문의)=0 준비(리뷰)=0 종료=0 처리됨=0 변화없음=0 실패=0
```

| check | observed |
|---|---|
| `proactive_case` rows written | **0** |
| marketplace WRITE / READ / new channel call | **0 / 0 / 0** |
| LLM calls charged | **0** — the org's only `agent_llm_usage` row today is 15:47, eight hours before the tick |
| `inquiry_approval` / `inquiry_action_intent` / `inquiry_execution` created | **0 / 0 / 0** |
| `inquiry_reply_draft` / `answer_memory` created | **0 / 0** |
| work-item audit rows created | **0** |
| duplicates / cross-org | **0 / 0** (one org in the target set) |

**Observability defect found and fixed mid-proof.** The first tick logged nothing at all: the report
line was gated on "something happened", so *"the loop ran and found nothing"* and *"the loop is not
running"* were indistinguishable — and the second is the failure an operator needs to see. The report
is now logged unconditionally, one line per org per interval, counts only.

---

## 3. Stale / reconcile (§8) — the Cafe24 test inquiry

Verified by DB read only; **no channel call was made to establish it**.

| | `cafe24:b6:a3672` | `cafe24:b6:a3673` |
|---|---|---|
| status | `ANSWERED` | `ANSWERED` |
| operational_state | `ACTIVE` | `EXCLUDED_THREAD_REPLY` |
| thread_role | `ROOT` | `REPLY` |
| work item phase | `COMPLETED` | (none — history only) |
| **passes candidate gate** | **false** | **false** |

Two independent reasons each. This also **completes an open statement from the answer-execution
proof**: that report recorded the local read model as still `UNANSWERED` and predicted it would catch
up on the next routine collection. It did — routine collection ingested article 3673, the parent
reconciled to `ANSWERED`/`COMPLETED`, and the reply article was correctly projected as a thread reply
rather than a new customer question. Observed, no longer predicted.

---

## 4. UI observation (§7)

Real backend + real frontend, logged in as the Demo Org.

| surface | endpoint | rendered |
|---|---|---|
| 홈 `/` | `/api/proactive/summary` → `{open:0, high:0, draftsPrepared:0}` | page renders, **no banner**, no error state |
| 문의 `/inquiries` | `/api/proactive/cases` → `{items:[], total:0, high:0}` | page renders (7,982 chars of queue), **no section** |
| Agent `/agent` | same | page renders, **no section** |

The **0-case contract holds on the real UI**: the section is absent, not empty — no placeholder, no
skeleton, no "AI가 확인 중입니다" line for a seller to read past every morning.

`/api/proactive/telemetry` → `prepared 0 · surfaced 0 · opened 0 · acted 0 · closedUnacted 0 ·
draftsPrepared 0 · medianSecondsToAction **null**`. Null, not zero — an unmeasured median must not
read as instant. No open/action event was manufactured to fill it.

---

## 5. What was NOT observed

- **`NO_FRESH_INQUIRY_CANDIDATE`** and **`NO_FRESH_REVIEW_CANDIDATE`.** After the fence this org has
  nothing current in either lane. Nothing was invented to produce a card.
- Therefore the **positive** UI path (a card, its evidence, its CTA) was not observed live. It is
  covered by the component tests against the real DTO shape, and the API contract those tests assume
  is exactly what the live endpoints returned.

---

## 6. Verdict

**LIVE_PARTIAL.** The tick ran through the production path, targeted exactly one org out of 35,
prepared nothing, wrote nothing, spent nothing, and left every boundary intact. The absence of cards
is the fence working, not the feature failing — and it is the honest state of this org's data.
