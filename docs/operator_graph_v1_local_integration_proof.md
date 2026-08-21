# Operator Graph v1 — local integration proof (2026-08-21)

> **What this is.** The first end-to-end run of the SellerOps **Operator Graph v1** against **real
> SellerOps data**: a local PostgreSQL holding one org's 7,136 real customer utterances collected over
> NAVER / Cafe24 / Coupang, with the whole chain — migration → ingest follow-up → derived state →
> Operator tools → findings, evidence and coverage — exercised as the product would exercise it.
>
> **What this is NOT.** **Not a marketplace run.** Nothing here contacted NAVER, Coupang or Cafe24. No
> credential was read, no Action Window opened, no collector agent started, and no WRITE of any kind was
> executed or added. Every read went to a local backend over already-stored rows.
>
> **It moves no capability status.** `docs/multi-channel-connector-roadmap.md` §4.1 keeps 운영 지원 truth.
> Contract: `docs/sellerops_operator_graph_v1.md`. Recovery baseline:
> `docs/demo_baseline_recovery_audit_2026-08-21.md`.

## 0. Environment

| | |
|---|---|
| Branch / code | `feat/operator-graph-v1` |
| Database | local PostgreSQL 15.13, database `sellerops` (the working dev DB, not disposable) |
| Org | `7146c50f-…d8e0` "데모 제조사" — 3,916 reviews · 3,220 inquiries · 64 products · 3,208 UNANSWERED |
| Channels present in that data | NAVER 3,880 reviews · Cafe24 3,201 inquiries · Coupang 22 reviews · GMARKET 11 (legacy) |
| Services | `tools/dev/local-stack.sh up` — backend `:8080`, agent-runtime `:8787`, frontend `:5173`, all restarted onto current code |
| Marketplace contact | **none** |

## 1. V47 — Flyway applied against real PostgreSQL

CI does not validate migrations (`docs/ci-coverage.md`), so this is the first real execution.

```
Successfully validated 45 migrations
Current version of schema "public": 46
Migrating schema "public" to version "47 - customer memory index"
Successfully applied 1 migration, now at version v47 (execution time 00:00.044s)
```

`customer_memory_entries` created with all four indexes
(`uq_customer_memory_entries_source`, `ix_…_signature`, `ix_…_topic`, `ix_…_product`).
Schema check confirms the table has **no column able to hold customer text** — the columns are
`id, org_id, entry_kind, source_id, channel_id, product_id, topic, signature_key, severity,
occurred_on, answered, created_at, updated_at`.

## 2. The chain, on real data

No marketplace call could prove this chain on this org, and finding out why is the first result.

**A re-collection proves nothing here, by design.** Ingest is idempotent: every one of the 7,136 rows
already exists, so a re-sync inserts none, `IngestOutcome.insertedIds` is empty, and `IngestFollowUp`
correctly does nothing. The follow-up is proven for NEW rows by `IngestFollowUpTest` and
`OperatorCapabilityChainTest`; what real data proves is what happens to an org whose data predates it.

Baseline, and what each existing operator backfill recovered:

| Derived state | Before | Operator backfill | After |
|---|---|---|---|
| `item_analyses` | 640 / 7,136 (9%) | `POST /api/item-analysis/backfill` (existing) | **7,136** (converged: last batch 0/0) |
| `review_issues` | 0 | `POST /api/review-issues/extract` (existing) | **19 issues · 81 evidence** |
| `customer_memory_entries` | 0 | **did not exist** → see §3 | 0 |

The 640 pre-existing analyses are the fingerprint of audit defect B: only the file-upload path ever
triggered analysis, so 91% of a real corpus was unanalysed.

## 3. Blockers found on real data, and the patches

Five. Each was found by real data, fixed minimally, pinned by a regression, and re-run.

### B1 — the customer-memory index was unreachable for every existing seller (P0)

The index is written at ingest; ingest is idempotent; therefore no re-collection can ever populate it
for data collected before it existed. Measured: after recovering everything else, 7,136 real utterances
left the index at **0**. Two of the three follow-ups already had an operator backfill
(`/api/item-analysis/backfill`, `/api/review-issues/extract`); this one did not. Same class as audit
defect B — the code works and the capability is dead.

**Patch:** `CustomerMemoryIndexer.backfill(orgId, kind, limit, page)` + `POST /api/customer-memory/backfill`
— the missing third member of an existing trio, following its contract exactly (manual, bounded, paged
by a stable total order, idempotent by key, reads only already-stored rows).
**Regression:** `CustomerMemoryBackfillTest` (5), whose first test reproduces the defect.
**Result:** 3,916 + 3,220 = **7,136 indexed**, both walks converging.

### B2 — 기타 reported as the biggest repeated inquiry (P0, honesty)

First real repeats run returned `기타 1,777건` as the top candidate. 기타 is
`ItemAnalysisCategories.FALLBACK` — "the analyzer's verdict when no keyword matched", a statement about
the classifier, not about customers. Reporting it as a pattern is exactly the failure this service's own
javadoc forbids for null signatures.

**Patch:** exclude `FALLBACK` from the topic axis, for the same reason null is excluded.
**Regression:** `RepeatedInquiryServiceTest` (+1).
**After:** 7 real candidates — 품질 523 · 사이즈 473 · 배송 240 · 가격 195 · 색상 4 · 설치 3 · 제품정보 3.

### B3 — "판단할 수 없습니다" on an org with complete product linkage (P0, honesty)

The demo org has 81 issue-evidence rows and **zero unlinked**. Every product without an issue
nevertheless reported 판단 불가, because `verdict()` returned UNCERTAIN whenever the product had no rows
and the org had some — regardless of whether anything was actually unattributable. Crying uncertainty
everywhere teaches a seller to ignore it, which is how the real blind spots stop being read.

**Patch:** `unlinked == 0` ⇒ the zero is measured ⇒ `COVERED`. Same correction applied to the
item-analysis verdict (no rows to analyse is not an analysis gap).
**Regression:** `ProductSignalsCoverageTest` (+1).

### B4 — a KEYWORD run spent the whole model budget (P1)

With plan and judge OFF, a run still spent **5 of 6** model-budget units on round-trips that each
returned `available: false`. Nothing was wrong with the answer, but two more findings would have
reported BUDGET_EXHAUSTED over a budget never actually used, leaving real findings unjudged.

**Patch:** a capability that answers `available:false` *with no providerVersion* is off for this org, so
stop asking for the rest of the run — both the budget gate and the call itself read the learned state. A
`MODEL_DECLINED` answer (providerVersion present) still says nothing about the next finding, so asking
continues.
**Regression:** `operatorBudget.test.ts` (+3).
**After:** llm 5 → 2 per run.

### B5 — the LLM planner's narrow tool list killed two of three runs (P0, only visible with a live model)

The first real planner answered `specialists:["INQUIRY_OPS"], tools:["get_today_inbox"]` — a
reasonable-looking plan. Both INQUIRY_OPS and REPORT_OPS then died on `ToolNotInPlanError` reaching for
the rest of their own fixed sequence, and two good runs returned "조회에 실패했습니다" with zero findings.

**Patch:** a specialist's tool needs are a property of the specialist, not of the plan; the graph
dispatches with `plan.tools ∪ SPECIALIST_TOOLS[specialist]`. The fence is unchanged — the registry is
READ-only end to end, unknown names still throw, WRITE still does not exist.
**Regression:** `operatorScenarios.e2e.test.ts` (+3).

### Also fixed (P2)

Product hint kept only the last token before 상품, so "선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드
상품" searched for "전선몰드", matched six real products, and answered about a different one (0 issues)
than the one named (53). Now the full phrase resolves first with the token as fallback. The test fake was
also made faithful to `ProductQueryService`'s ranking, which is why it had not caught this.
`오늘 뭐부터` no longer dispatches PRODUCT_OPS with no product to resolve.

## 4. The four scenarios, on real data

Planner/judge **OFF** (the default posture; every CI run and every plain demo):

| # | Ask | Result |
|---|---|---|
| 1 | 오늘 뭐부터 봐야 해? | 4 findings, all `SUPPORTED`, 4 evidence. 미답변 **3,208** (server, uncapped) + 배송 파손 15건 · 접착 파손 1건 · 표면 누락 2건. budget tool=3 llm=2 `COMPLETE` |
| 2 | 선바로 일체형 전선몰딩 … 상품 요즘 문제 있어? | 5 findings, all `SUPPORTED`, 23 evidence rows across 배송 파손 15 · 배송 누락 4 · 표면 누락 2 · 접착 누락 1 · 접착 파손 1. All `COVERED`. Ambiguity disclosed in the note |
| 3 | 이 문의 답변 초안 만들어줘 | **NOT PROVEN — blocked by pre-existing org state.** The OPEN work-item queue is empty (3,199 DISMISSED across 7 dismissal batches, 1 ACTION_PENDING, 1 COMPLETED), so the draft graph correctly answered "no unanswered inquiries to draft". Matches the residual `docs/demo_runbook_v1.md` §4 already records. The **new** half was proven separately: recall on a real inquiry returned 5 precedents with `coverage=COVERED indexed=7136 unlinked=0` and `retriever=LEXICAL:customer-memory-lexical/v1` |
| 4 | 이번 주 대표에게 보고할 내용 정리해줘 | 2 findings `SUPPORTED`. 미답변 **3,208** stated as "현재" (not "이번 주" — the period guard holding on real data) + FAQ 후보 2 / 상세페이지 개선 후보 0, both verified against SQL |

## 5. Planner/judge OFF vs ON

ON was enabled **for this org only** (`SELLEROPS_AGENT_{PLAN,JUDGE}_ORG_IDS=<org uuid>`, never `*`),
reusing the vendor key already configured for the draft capability, passed through in-process; the value
was never read, printed or copied. Both answered live:
`agent-plan/v1+openai:gpt-5-2025-08-07+agent-plan-prompt/v1+…`,
`agent-judge/v1+openai:gpt-5-2025-08-07+agent-judge-prompt/v1+…`.

| | OFF (KEYWORD / RULE_BASED) | ON (LLM / LLM) |
|---|---|---|
| ① 오늘 뭐부터 | 4 findings · `INQUIRY_OPS + REVIEW_OPS` · llm 2 | 1 finding · `INQUIRY_OPS` only · llm 2 — the model chose a narrower plan and answered less |
| ② 상품 | 5 findings, identical statements and evidence | **identical** — 5 findings, same 23 evidence rows |
| ④ 리포트 | 2 findings · `REPORT_OPS` · llm 2 · `COMPLETE` | 5 findings · `REPORT_OPS+REVIEW_OPS+INQUIRY_OPS` · llm 6 · **`BUDGET_EXHAUSTED`** |
| Verdicts | every finding `judgeKind=RULE_BASED` | every finding `judgeKind=LLM` |

**What ON changes:** breadth of the plan, and the labels. **What it does not change:** any number, any
piece of evidence, or any coverage verdict — those come from Spring either way. ② is byte-identical
between the two modes, which is the property that matters: the model chooses what to look at, not what
is true.

**The budget behaved exactly as contracted under real pressure.** ON ④ hit the ceiling and still returned
5 findings, marked the one it could not judge `NEEDS_REVIEW` with a null verdict rather than asserting or
dropping it, and said so twice in the note: *"근거가 확인되지 않아 1건은 답에서 제외했습니다. 조회
예산에 도달해 일부는 확인하지 못했습니다."*

## 6. Evidence, provenance and coverage — verified

- **Traceability.** Every finding in every run cited ≥1 evidence id, and every cited id resolved to an
  `EvidenceRef` present in the same answer. Zero findings with empty evidence reached a surface.
- **Provenance is read, never hardcoded:** `inbox/SERVER:unansweredInquiries`,
  `issue-memory/RULE_BASED`, `item-analysis/STORED`, `customer-memory/LEXICAL:v1`, and per-finding
  `judgeKind` LLM vs RULE_BASED — all correct against the source that produced them.
- **Counts verified against SQL**, not just against each other: 3,208 미답변 (`limit=1` returned 1 item
  and the count still 3,208 — audit defect A proven fixed live); FAQ 후보 = 2; 배송 파손 = 15.
- **Coverage.** All `COVERED` on this org, and independently confirmed correct: `review_issue_evidence`
  is 81 rows with **0 unlinked** and reviews/inquiries are **100% product-linked**. B3 was found because
  the code claimed uncertainty this data does not have.
- **No customer text** appeared in any answer, in the index schema, or in any log line inspected.
- **WRITE:** none added, none executed. The Operator catalogue remained 12 READ tools.

## 7. Regression after all patches

| Stack | Result |
|---|---|
| backend | **2,528 passed** / 18 skipped / 0 failed |
| frontend | **2,207 passed** / 0 failed |
| agent-runtime | **191 passed** / 23 skipped / 0 failed |
| collector | **9,150 passed** / 150 skipped / 0 failed (untouched) |

## 8. What this run does NOT establish

1. **No marketplace was contacted.** Live collection remains proven only by the runs already in
   `docs/evidence/INDEX.md` §1.
2. **Scenario 3's draft path was not driven** — the org's OPEN queue is empty. The LLM draft endpoint
   itself answered live (`available: true`), consistent with the 2026-08-20 proof.
3. **Extraction recall is the binding limit, not the plumbing.** Of 3,220 real inquiries, **0** produced
   an `aspect:problem` signature, and only 80 of 3,916 reviews did. So recall degrades to topic-level and
   repeat detection is topic-only. This is the documented, unmeasured rule extractor
   (`IssueVocabulary`, `contracts/review-eval/naver/v1/RUBRIC.md`), not a fault in the index.
4. **A broad LLM plan can exhaust the budget** (ON ④). Honest, but the answer is narrower than it could
   be; the limits are unchanged and untuned.
5. **Overlapping specialists can duplicate a finding** — ON ④ stated the 3,208 count twice, from
   REPORT_OPS and INQUIRY_OPS.
