# Issue Evidence Trust Closure + Agentic Report v1 (2026-09-04)

Two packages in one commit, in the order the brief gave them: first the trust of the issue evidence
that every downstream object (Opportunity, report) rests on; then a weekly / monthly operating report
that reads like an operator wrote it and can be traced line by line to what the data actually says.

Opportunity Engine · Knowledge · Retrieval · Approval · Guided execution are **unchanged** except where
a real defect was measured. Marketplace calls **0** · marketplace WRITE **0** · approvals **0** ·
migrations **2** (V95 data repair, V96 new table) · model calls in QA: **5** (report narratives).

---

## 1. Issue Evidence Trust Closure

### 1-1. What was measured first

The live defect the brief named — 「파손없이 잘 도착했네요」 as evidence for 「배송 파손」, which the
Opportunity Engine turned into an 교환·반품 기준 suggestion — was measured against the whole Demo Org
before any code changed (`quotes.py`, read-only through the product's own detail endpoint):

| | before |
|---|---|
| evidence rows (Demo Org) | **85** |
| rows on 4–5★ reviews | 배송 파손 **14/15** · 접착 부족 15/18 · 배송 지연 6/6 · 배송 누락 4/4 · 배송 결함 2/2 |
| 「배송 파손」 rows that were 「파손없이 잘 도착했네요」 | **13/15** |
| rows whose review is not REAL | **12** (11 `DEMO_SEED` + 1 `VERIFY_FIXTURE`, 11 of them inside 「접착 탈락」 19) |

The extractor (`RuleBasedIssueSignatureExtractor`) has **no polarity seam at all**: `IssueVocabulary`
is a substring table, so a problem word inside its own negation is a hit. Triage semantics were audited
for reuse and rejected on principle, not convenience — `ReviewTriageRules.tier` is a pure function of
the star rating, and the whole point of `OpinionUnitSplitter` is that a 5★ review may still say
「배송이 좀 늦었네요」 in one clause. A rating gate would have deleted the structural fix the package
was built on. The AI triage pilot covers few reviews and is default-off, so it cannot be the gate either.

### 1-2. The fixture (measured, not asserted)

`IssuePolarityFixtureTest` holds 35 sentences written fresh in the SHAPES the live corpus used —
A 실제 불만 · B 문제 없음/부정 표현 · C 칭찬 속 issue 단어 (incl. another product's problem) · D mixed.

| | false issues (B+C) | real complaints lost (A+D) |
|---|---|---|
| shipped extractor (`issue-rules-v1`) | **14 / 17** | 1 / 16 (*) |
| after (`issue-rules-v2`) | **0 / 19** | **0 / 16** |

(*) the one miss was the splitter's documented no-aspect-inheritance on 「붙였는데 하루 만에
떨어졌어요」 — a design decision, not a polarity defect — so the fixture line was reworded rather than
the split rule changed.

### 1-3. The seam: `NegationScope`

Closed, mechanical, applied to the **matched keyword**, never to the review's sentiment:

- **after** the keyword, across bridge tokens only (particles, degree adverbs 전혀/하나도/별로, the
  verbal negation link 지/진/하지, a few placeholder nouns 곳/것/데/품): 없 · 않 · 못 · 안+verb ·
  「줄 알」 (counterfactual). 「접착력이 약해서 안 붙어요」 keeps 약해 because 서 is not a bridge.
- **before** the keyword: 안/못 as their own word (「절대 안 떨어져요」), and 미 for aspects (「미설치라」).
- a keyword that **is** a negation (「안 왔」, 「없어서」, 「붙지 않」) is never negated — 「부품이 없어서
  못 썼어요」 must not read 못 as denying 없어서.
- the aspect is negated too (「설치를 안 해봐서 잘 모르겠어요」 is not about installing), **except**
  when the marker sits inside a problem keyword: 「배송이 안 왔어요」 stays 배송:누락.
- `OTHER_PRODUCT`: a unit that names another product (타사 · 다른 제품 · 전에 쓰던 …) is a real complaint
  about somebody else's product — four live rows of 「접착 탈락」 were one review's 「전에 설치했던
  타사의 몰딩은 … 떨어져서」.

Two new `UnknownReason`s (`NEGATED_PROBLEM`, `OTHER_PRODUCT`) so the pen shows what the rule decided
instead of folding it into 「nothing was wrong」. No sentiment model, no rating gate, no wider vocabulary.

### 1-4. Re-extraction can now retract

Evidence could only ever be **added** — a better extractor could not undo a worse one, and the
fourteen 「파손없이」 rows would have stayed evidence on every deployment forever. `extract()` is now a
**reconcile**: the current extractor is authoritative for every unit of the review it is handed; a
stored evidence row whose unit no longer matches is deleted, an UNKNOWN row that is now matched (or
has a new reason) is replaced, and the issue's evidence span is re-derived from what remains.
Identity and lifecycle are never touched.

Two repairs travel with it:

- **synthetic reviews are refused at the write** (`review.getDataOrigin().synthetic()`), because the
  read-time `realDataOnly` filter is a session property and extraction also runs from listeners and
  boot runners — which is how 11 seeded reviews became evidence. **V95** deletes the rows such
  reviews wrote and re-derives the affected spans (V93's cascade shape: the predicate is provenance).
- **`ReviewIssueReextractionRunner`** re-derives every org whose issues are stamped with another
  extractor version, once (`reextractAll` pages the whole corpus, then stamps `issue-rules-v2`).
  Database only, idempotent, failure logged. Bounded by the corpus; the Demo Org's 4,599 REAL reviews
  took ~100 s on boot.

### 1-5. Live after

| | before | after |
|---|---|---|
| evidence rows | 85 | **51** (12 synthetic removed by V95, 18 retracted by negation, 4 by the other-product rule) |
| 「배송 파손」 | 15 | **1** (the real 「배송 시 박스가 파손되어서」) |
| 「배송 결함」 · 「설치 난이도」 · 「크기 난이도」 | 2 · 4 · 1 | **0 · 0 · 0** |
| 「배송 누락」 | 4 | **2** (both the real 「외경캡이 하나도 안왔네요」) |
| 「접착 탈락」 | 19 | **7** (11 seeded rows gone, 1 「절대 안떨어져요」 retracted, 4 「타사 몰딩」 rows retracted) |
| UNKNOWN pen | — | `NEGATED_PROBLEM` **33**, `OTHER_PRODUCT` **5** |
| Opportunities (Demo Org) | **7** | **5** — the false 「배송 파손 → 교환·반품 기준」 and 「배송 누락」 suggestions are gone |

The full pass also **found** evidence the bounded after-ingest refresh had never reached (older
reviews: 포장 파손 +1, 포장 불일치 +1) — the ceiling was hiding real rows as well as false ones. The
other-product rule landed after the boot pass, so it was applied through the documented manual path
(`POST /api/review-issues/extract`, 10 pages, 4,599 scanned: `evidenceRemoved=4`, `unknownAdded=4`).

---

## 2. Weekly / Monthly Agent Report v1

### 2-1. Audit of what existed

`/reports` was `ReportsV2.tsx` deriving everything client-side from four reads through
`lib/reportView.ts` (`buildWeeklyReport`): nothing was stored, every open recomputed, "이번 기간" mixed
window figures with standing ones (Secondary Workspaces v1 had already had to relabel that). There was
no report table and no version architecture to audit — so the simplest snapshot semantics were built
rather than chosen from options. The runtime's `ReportOpsNode` (chat: 「대표에게 보고할 내용」) is
untouched; it composes other specialists' findings and is not this report.

### 2-2. The model — one report, two calendars

`ReportKind` WEEKLY | MONTHLY over **completed** periods only (last Mon–Sun, previous calendar month;
calendar Asia/Seoul, the one the Overview series bucket by). "This week so far" would change every
morning and a snapshot of it would be stale by lunch.

`ReportFacts` is everything the report may say, as **values with ids**:

- `counters` — 받은 리뷰 · 부정 리뷰 · 받은 문의 · 주문 (periodic, with `previous`/`delta`) and
  현재 답변이 필요한 문의 (**not** periodic — what is waiting NOW). All from reads that already exist
  (Overview series, REAL rows only; `countUnansweredOperational`).
- `issues` — per issue, evidence in the period vs the previous period (`issueCountsInWindow`, one
  query per window) plus the issue memory's own change labels and product.
- `opportunities` — the Opportunity Engine's derivation at the period's end, by id.
- `nextSteps` — prepared actions that are always an existing object: the unanswered queue, an
  opportunity's own next action, an issue's evidence page when it rose and nothing is proposed yet.
  **No to-do table.**

**An absent reading is not a zero.** The first live monthly narrative said 「주문은 전월 0건에서
317건으로」 because July had no order rows. A periodic counter whose previous window holds no row now
has `previous=null`, no delta, and the sentence says 「이전 기간 자료 없음」.

### 2-3. Fact · interpretation · unsupported cause

`ReportSummaryComposer` is the deterministic reading, each line typed:

| kind | example |
|---|---|
| FACT | 「접착 부족」 관련 리뷰가 4건 있었습니다 (이전 기간 1건). |
| INTERPRETATION | 「접착 부족」 관련 리뷰 증가를 확인할 필요가 있습니다. |
| LIMIT | 늘어난 원인은 리뷰가 말해주지 않습니다. 근거 리뷰를 직접 확인해 주세요. |

The narrative is the **ninth LLM capability** (`sellerops.agent.report.*`, own flag · key · org list ·
door `AgentReportNarrativeService`, row added to `AgentDraftBoundaryTest`, payload floor asserted on
bytes). What leaves is the facts JSON — counts, dates, vocabulary titles, the seller's own product
names, opportunity labels — and no customer text. The model must cite fact ids per line; then
`NarrativeClaimGuard` **drops** (never rewrites) any line that cites an unknown id, cites nothing, or
contains a closed causal / outcome marker (때문 · 원인은 · 탓 · 인해 · 나빠졌 · 악화 · 저하 · 개선됐 ·
효과 · 성과 · 매출 · 만족도 …). 「생산 품질이 나빠졌습니다」 and 「테이프 두께 때문에」 are refused in
the unit test; the interpretation 「증가를 확인할 필요가 있습니다」 is kept.

### 2-4. Snapshot semantics

`agent_report` (V96): one row per `(org, kind, period_start, version)`, JSON columns for facts ·
summary · validated narrative, `narrative_status` READY | UNAVAILABLE | FAILED with its sentence.

- **open = read.** `GET /current?kind=` returns the stored newest version, generating only when the
  period was never generated. Reopening asks the model nothing and recomputes nothing.
- **regenerate = new version.** Explicit `POST /regenerate`; version N stays readable by id.
- **narrative optional at every step** — off for the org, failed at the vendor, fully refused: the
  status says which and the deterministic summary is the whole reading.
- an unaligned `periodStart` and an unfinished period are **400**.

### 2-5. Screen

Top: 「AI 운영 요약」 — the narrative (headline + lines, each line followed by links to the objects its
fact ids name) or the summary (INTERPRETATION marked 「확인 필요」, LIMIT muted, the status sentence
under it). Below: 이번 기간에 달라진 것 (figures with 「이전 기간보다 N건 늘음 (M건)」 / 「이전 기간 자료
없음」 / 「기간과 무관한 지금 수치」) → 반복된 문제 (rows → `/memory/{issueId}`) → 개선 기회 (rows →
the same page) → 다음에 할 일 (rows → their object) → 이전 리포트 (disclosure, by id). Zero is not a
door. `lib/reportView.ts` and its two tests were retired with the derivation they guarded; the parity
they protected (홈 and 리포트 print the same unanswered count) now holds by construction — both read
`countUnansweredOperational`.

### 2-6. Live QA (real Demo Org · disposable org for 「변화 없음」)

| check | result |
|---|---|
| weekly generate | 200, **23.8 s** (narrative call), READY, 6 lines · **0 untraced · 0 unsupported** |
| monthly generate | 200, 19.3 s, READY, 6 lines · 0 · 0 |
| reopen weekly ×2 | same id, byte-identical facts and narrative |
| regenerate | v2; v1 still readable by id with identical facts (only `generatedAt` differs) |
| unaligned start | 400 |
| fresh org weekly / monthly | UNAVAILABLE, one 「달라진 것이 없습니다」 line, 0 issues · 0 opps · 0 steps |
| browser 1440 / 1366 / 1152 | AA violations **0** · horizontal scroll 0 · console errors 0 |
| doorways | issue row → exact `/memory/{id}` with its Opportunity cards; unanswered → `/inquiries?status=UNANSWERED`; v2 by id shows 「2번째 판」 |

The QA backend was started with the report capability enabled by copying the plan capability's
key and org list into the report variables **at process start only** (no file edited, nothing
printed); the stack left running for the operator still has it on. The three report rows this
session created on the Demo Org before the counter shape changed were deleted and regenerated.

---

## 3. Verification

backend **3,857** · frontend **230 files / 2,722** · failures 0 · typecheck clean. Contracts rewritten: the extractor
version pin (v1 → v2); `theEvidenceSpanWidensAndNeverNarrows` → `…WidensAsEvidenceArrives` plus a
retraction test (the premise changed: deletion is a flow now); `App.routes.test` title; `ReportsV2.test`
rewritten for the snapshot contract. Safety tests weakened: **0**.

## 4. Remaining defects (reported, not fixed)

- A rule change inside one extractor version does not re-run the boot pass (the stamp is the version
  string); a future rule edit must bump `VERSION`, or it reaches old rows only through the manual path.
- 「부착후 지저분하고 않고 깔끔합니다」 (a typo for 하지 않고) and 「조금 약해보이는대 다설치하니 튼튼」
  remain evidence — closing them needs typo tolerance or a "looked X but wasn't" hedge, both wider
  than the measured shapes.
- 「배송 지연」 6/6 on 4–5★ reviews are **real** mild delays and stay evidence by design; the
  Opportunity for it is therefore true but small.
- Report figures use REAL rows only, never the demo corpus, so a demo deployment's report can be
  emptier than its dashboard (the dashboard's fallback rule is deliberate and unchanged).
- The narrative's headline is not required to cite ids (only vocabulary-checked).
- Evidence `occurred_on` is a UTC date while the report calendar is KST — an evidence row can sit one
  day across a period edge.
- First-open latency is the narrative call (19–24 s); the page shows 「불러오는 중…」 without a clock.
