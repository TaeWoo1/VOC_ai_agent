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

---
---

# Part 2 — positive live proof (2026-08-26)

**Verdict:** **LIVE_GREEN** · marketplace WRITE 0 · seller approval 0 · execution 0 · Answer Memory 0

Part 1 proved the fence held and, honestly, that this org had nothing current to raise. Two
product-owner corrections landed after it, and then a real customer-side inquiry was written on the
Cafe24 storefront so the positive path could be observed rather than asserted.

## 1. The two corrections

**Freshness is now a fact about the ORG, not about a deployment.** The bootstrap boundary was an env
var chosen for one audit; a value someone can retype is a flood someone can re-open. An audit for
somewhere to persist it came back empty — this repository has no org-settings and no per-org
feature-flag persistence at all; `organizations` carried a name and nothing else. One nullable column
on the org (`proactive_baseline_at`, V76) was the smallest honest answer: a settings subsystem for one
timestamp is more architecture than the value is worth, and a watermark table is not what this needs —
there is no cursor to advance, no progress to resume, and nothing to reconcile.

**Activation IS the baseline.** The reconciler stamps it once, on the first tick it ever runs for an
org, and that tick prepares nothing — nothing can have been observed after an instant recorded a
moment ago. There is nothing for an operator to set and therefore nothing to mistype.

```
23:58:47  proactive: 활성화 기준 시각을 기록했습니다 org=7146c50f…
23:58:47  proactive tick org=7146c50f… 재확인=0 준비(문의)=0 준비(리뷰)=0 …
```

`organizations.proactive_baseline_at = 2026-08-25 23:58:47.752+09` — on **one of 35 orgs**.

**The budget is a day, and one budget.** Per-tick was bounding a moment (ten ticks of three is
thirty); per-lane was two numbers that happen to add up rather than a budget anyone decided. Now:
**3 expensive preparations per org per day, inquiries and reviews together**, counted off
`proactive_case` itself — no second ledger, because that table already records exactly the thing being
capped — over the **same Asia/Seoul day the Agent quota uses**, read from `AgentQuotaService` rather
than recomputed so the two gates cannot disagree about when today started. The loop **reads** the
shared quota and never charges or reserves it (`proactive reserve = 0`); when the org's budget is
gone, the loop yields to the person. Reconcile passes neither gate — closing finished work is not a
purchase.

With the lane caps gone, selection is one bounded list across both kinds: priority tier → most
recently observed → stable id tiebreak. An investigation may **raise** a card's priority (a 2점 review
turning out to be a repeat issue) and can never lower it.

## 2. Natural ingest — no manual channel read

The inquiry was written by the operator on the Cafe24 storefront and left for the standing routine.
Collection runs hourly; the sweep at 00:24 picked it up. **No Cafe24 call was made to find it.**

DB-only identification returned **exactly one** row, and every clause was already true of it:

| | |
|---|---|
| external id | `cafe24:b6:a3674` — a new article, separate from `a3672`/`a3673` |
| seller account | the expected Cafe24 connection |
| origin / state / role / status | `REAL` · `ACTIVE` · `ROOT` · `UNANSWERED` |
| received (channel) | 2026-08-26 00:13:09+09 — after the baseline |
| first observed (SellerOps) | 2026-08-26 00:24:26+09 — after the baseline |
| product / order reference | none / none |
| size | title 6 chars, body 155 chars (counted, not quoted) |

Review lane: **0** post-baseline candidates → **`NO_FRESH_REVIEW_CANDIDATE`**, unchanged and not
manufactured.

## 3. One tick

```
00:25:40  proactive: tick 시작 대상org수=1
00:25:46  proactive tick org=7146c50f… 재확인=0 준비(문의)=1 준비(리뷰)=0 종료=0 처리됨=0 변화없음=0 실패=0
```

Six seconds — the model call. One case, from one candidate, out of a daily budget of three.

## 4. What was prepared

| | |
|---|---|
| case | `INQUIRY` · `PREPARED` · **`HIGH`** · reason `UNANSWERED_INQUIRY` |
| prepared action | **`DRAFT_PREPARED`**, draft version 1 |
| evidence state | `NO_PRODUCT`, 0 passages, 0 `inquiry_draft_evidence` rows |
| knowledge gap | present — the sentence that says what binding a product would buy |
| draft authorship | **`MODEL`**, `created_by = SYSTEM:PROACTIVE_AGENT`, model version recorded |
| draft size | title 8 chars, body 108 chars (counted, not quoted) |
| product binding | **none created** — the inquiry named no product, so none was invented |
| source state | `status=UNANSWERED;op=ACTIVE;thread=ROOT;product=-;hash=-` |

**The evidence is honestly empty, and that is the correct outcome.** The question names no product,
and nothing in the org's operating policy or past answers matched it — so nothing was retrieved,
nothing was cited, and the card says so rather than implying grounding it does not have.

## 5. The approval boundary held

| | |
|---|---|
| work item phase | **`PROPOSED`** — exactly where it must stop |
| audit trail | `WORK_ITEM_OPENED` (SYSTEM:CONNECTOR_INGEST) → `PROPOSAL_ADDED` (**SYSTEM:PROACTIVE_AGENT**) |
| `inquiry_approval` | **0** |
| `inquiry_action_intent` | **0** |
| `inquiry_execution` | **0** |
| `answer_memory` | **0** |
| marketplace WRITE / new channel call | **0 / 0** |

The audit names the machine as the actor. A system-prepared draft that recorded a seller as its author
would put a person's name on a sentence they have never read.

## 6. UI — the positive path, in a real browser

**문의 `/inquiries`** — the section renders, with one card:

> 먼저 확인 · 문의 · 카페24 자사몰 · 상품 미지정
> **고객이 답변을 기다리고 있습니다. 오늘 들어온 문의입니다.**
> 답변 초안 준비됨
> 이 문의가 어떤 상품에 대한 것인지 연결해 두면, 다음 초안은 상품 지식을 근거로 씁니다.
> [확인하기]

CTA → `/inquiries/71e64356-…` — the inquiry flow that already existed. **Send/approve controls in the
section: 0.**

**홈 `/`** — one line and a link, not a second list: *"AI가 먼저 확인한 일 1건 — 그중 1건은 답변
초안까지 준비돼 있습니다. 보낼지는 직접 확인합니다."*

**Agent `/agent`** — 「이미 확인해 둔 일」 renders **above the prompt**: the case is there before
anyone asks.

**One copy defect found and fixed.** The card read `상품 미지정 … · 상품 미지정` — the evidence label
for `NO_PRODUCT` repeated the product line verbatim. A line a seller reads twice in a row is a line
they stop reading, so the evidence label now says nothing for that state and the knowledge-gap
sentence carries it alone.

## 7. Telemetry — this event only

`candidate created 1 · prepared 1 · surfaced 1 · opened null · acted null · closed null`

`surfaced_at` was set by this proof's own UI observation, which is what surfacing means — the card was
rendered on a screen. **`opened` stays null because nothing clicked the CTA**: the observation reads
the link's target and deliberately does not follow it, since a click would record a seller action no
seller took. Nothing was manufactured to fill a counter.

**Quota consumed: exactly one `DRAFT` call** on 2026-08-26, against a daily cap of 3 preparations and
the org's shared Agent budget. No proactive reservation.

## 8. Observed gap, recorded not fixed

`inquiries.content_hash` is **null for all 3,335 real rows** in this org, so the dedupe source state
carries `hash=-`. The signature still changes on status, operational state, thread role and product
binding — which covers every case that changes what an investigation would find — but a customer
*editing the text of their own question* would not currently trigger a re-investigation. Recorded here
rather than patched, because nothing about this proof required it and the feature is closed.

## 9. Verdict

**LIVE_GREEN.** A real customer inquiry, collected by the standing routine with no channel call of our
own, became a deterministic candidate, was investigated through the production draft path, produced a
model-authored draft the seller has not approved, persisted one case, and appeared on three screens —
with the work item stopped at `PROPOSED` and every write boundary intact.

Feature disarmed after the tick (`enabled=false`, scheduler bean absent on restart).
backend **3,184 / 0 / 22** · frontend **2,299 / 0**.
