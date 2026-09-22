# Full MVP Production E2E v1

세 채널의 automatic source가 **하나의 실제 `CUSTOMER_OPERATIONS_V1` production run** 안에서 함께 수집·관측되는지를
단계별로 증명한다. 각 단계는 자기 승인 하나로 실행되고, 결과는 `docs/evidence/INDEX.md`에 행으로 남는다.
선행 기록: `docs/full_mvp_real_api_preflight_v1.md`(공식 API READ preflight, `LIVE_PASS`).

## Stage 1 — 네 source가 한 run에서 관측되는가 (2026-09-23 00:17 KST) · `PASS`

### 1-0. 승인과 범위

- 승인 **`apr-resp-e2e-110e3840d46659fa`** · runId `resp-full-e2e-1` · mode READ_ONLY · Demo Org — operator 「Seated and
  ready.」, 옵션 A(responsibility scheduler만 켜고 pause 가드로 run 하나만) 명시 승인. 단일 사용, 소진됨.
- 코드 `e396ee1e`(워크트리 clean). 코드 변경 0.
- 실행 프로세스: 별도 backend(18080). collect / self-pilot / self-pilot triage / proactive / aside(둘) OFF,
  **responsibility scheduler만 ON**, 문의·리뷰 publish execution OFF, admin dismissal OFF, 모델 capability 17개 OFF +
  API key 15개와 standing READ grant를 프로세스 환경에서 제거, Coupang live gate = 이 approval id,
  `RESPONSIBILITY_RUNTIME_ORG_IDS` = Demo Org 하나. 실행기 sha256 `d2fa3f34…990b`, 스냅샷 SQL sha256 `86d663f2…abfe6`.
- 브라우저 · Aside · Coupang 브라우저 로그인 사용 0.

### 1-1. 절차 (실측 시각)

| 시각 (KST) | 단계 |
|---|---|
| 00:14 | 전 스냅샷 = 기준선과 동일 확인, Home·확인할 일 캡처 |
| 00:14:56 | scheduler 없는 dev backend(8080)에서 `pause` → PAUSED, `next_run_at` null, run 생성 0 |
| 00:15:18 | 18080 기동(설정 검증 통과, Flyway 검증만) |
| 00:15–00:17 | 80초 대기 — run 생성 0 · sync job 0 |
| 00:17:04 | `resume` → run `6a59a816` 1개(RESUME, window 00:00–02:00) |
| 00:17:29–33 | tick이 run 실행 → `SUCCESS` |
| 00:17:42 | 18080 종료(재시도·다음 window 전) |

최종: responsibility ACTIVE, `next_run_at` 02:00 KST. 재시도 예약 없음. 이후 scheduler가 켜진 프로세스 없음.

### 1-2. 결과 — source별 관측

| source | 수집 구간 | completeness | 관측 / 새 항목 | 실패 이유 |
|---|---|---|---|---|
| NAVER · INQUIRY | 09-09 ~ 09-23 (routine 재시작) | COMPLETE | 2 / 2 | 없음 |
| CAFE24 · INQUIRY | 09-09 ~ 09-23 | COMPLETE | 0 / 0 | 없음 |
| CAFE24 · REVIEW | 09-09 ~ 09-23 | COMPLETE | 0 / 0 | 없음 |
| COUPANG · INQUIRY | 09-17 ~ 09-23 | COMPLETE | 0 / 0 | 없음 |

run outcome `SUCCESS`, 알림 `UNDELIVERABLE`(메일 설정 없음 — 발송 0). sync job 4개 전부 `trigger=RESPONSIBILITY`
`SUCCESS`. 채널 연결 상태 3개 CONNECTED, 연속 실패 0.

**marketplace 요청 ≈ 9 (상한 20):** NAVER 3(토큰 1 + 상품 문의 GET 1 + 고객 문의 GET 1) · CAFE24 4(토큰 갱신 2 +
board-6 GET 1 + board-4 GET 1; 목록 0건이라 댓글 발견·읽기 0) · COUPANG 2(미답변·답변 GET — 이 수집기는 요청마다
로그를 남기지 않으므로 코드 경로 기준).

### 1-3. 성공 기준

| 기준 | 결과 |
|---|---|
| 네 source 모두 관측 행 | 4/4 |
| 0건 source는 COMPLETE, false gap 0 | 3 source COMPLETE 0 · 공백 case 0 · Home `gaps` 0 → 0 |
| duplicate inquiry/review 0 | 중복 external_id 문의 0 · 리뷰 0 (전후) |
| marketplace WRITE 0 | 문의 execution 3 → 3 · 리뷰 execution 2 → 2 · 로그에 전송 줄 0 |
| model call 0 | `agent_llm_usage` 2,572 → 2,572 · goal 해석 2 → 2 · 문의 초안 17 → 17 · 리뷰 triage 15 → 15 · 모델 로그 줄 0 |
| NAVER ingestion 설명 | 아래 1-4 |
| Home / 확인할 일 전후 | 아래 1-5 |

### 1-4. NAVER 항목의 ingestion 결과

preflight가 본 두 lane 항목(상품 문의 09-17 수신 · 고객 문의 09-18 수신)은 DB에 없었고 이번 run에서 **새로** 들어왔다
(`naver-qna:` · `naver-payinq:` prefix — lane 충돌 없음, `data_origin=REAL`). 둘 다 **채널에서 이미 판매자가 답변한
상태(ANSWERED)**였다 ⇒ work item은 미답변 REAL만 만들므로 0, 확인할 일 큐 무변화. case도 0 — 이번 run이 NAVER·COUPANG의
첫 완결 관측(기준점)이고 `discover`는 기준점 이후 생성된 행만 후보로 본다(설계된 동작).

### 1-5. Home · 확인할 일 전후

| 항목 | 전 | 후 |
|---|---|---|
| sources | 2 (CAFE24 문의·리뷰) | **4** (NAVER · CAFE24 ×2 · COUPANG, 전부 COMPLETE) |
| decisions | 1 | 1 (`1dc22b86` 변화 없음으로 판정) |
| gaps | 0 | 0 |
| 확인할 일 문의 큐 | 24 | 24 |

### 1-6. DB 쓰기 (실측, Demo Org)

manifest가 예상한 것:

| 표 | 변화 |
|---|---|
| `responsibility` | pause 1 → resume 1 (최종 ACTIVE) |
| `responsibility_run` | 3 → 4 |
| `responsibility_run_source` | 6 → 10 |
| `sync_jobs` | 1,553 → 1,557 |
| `sync_cursors` | 기존 4행 갱신, 새 행 0 |
| `inquiries` | 3,360 → 3,362 (NAVER +2), CAFE24·COUPANG +0 |
| `reviews` | +0 |
| `inquiry_work_item` · `proactive_case` · case 이벤트 | +0 |
| `channel_connection_status` | 3개 갱신 |
| `connector_credentials` | Cafe24 1행 갱신(토큰 회전 2회) |
| 상품 연결 이벤트 | 0 |

**manifest 표에 없던 production side effect (결정론, 모델 0 — 실제 production 경로의 부수 효과로 기록):**

| 표 / 경로 | 변화 | 출처 |
|---|---|---|
| `answer_memory` | +2 (NAVER 상품 문의 1 · 고객 문의 1, `IMPORTED_SELLER_ANSWER`, `REAL`) | ingest follow-up — 채널에 올라간 판매자 답변을 과거 답변으로 기록 |
| `customer_memory_entries` | +2 | `CustomerMemoryIndexer` (kind=INQUIRY) |
| `item_analyses` | +2 | `ItemAnalysisService` upload-trigger |
| answer memory 백필 | Demo Org 19건 대상 · 다른 org 1곳 3건 대상 | `AnswerMemoryBackfillRunner` — **부팅 시** 실행(run과 무관, 모든 기동에서 돈다) |

### 1-7. 해석이 필요한 관측

- **CAFE24 문의 0건 (a3676)** — 직전 run(09-22 00:34, 구간 09-08~09-22)은 a3676(09-21 수신)을 관측했고 이번 구간에도
  들어가지만 board-6 목록이 돌려주지 않았다. 원인: **remote deletion after previous observation; local row
  intentionally preserved** — operator가 marketplace에서 테스트 문의를 직접 삭제했다. 로컬 행은 그대로(UNANSWERED,
  `updated_at` 무변경)이며, 이는 「absence는 삭제로 자동 판정되지 않는다」(`docs/inquiry_operational_truth_v1.md`)는
  계약대로의 동작이다.
- **빠진 구간이 cursor상 지나간 것이 됐다** — NAVER cursor는 09-09부터 재시작(09-05 20:29 ~ 09-09 미관측, WARN 로그
  1줄), COUPANG `throughDate` 09-05 → 09-23(09-06 ~ 09-16 미관측, 7일 상한). 두 구간은 routine 수집이 다시 보지 않으며
  복구는 별도 bounded backfill 승인이 필요하다.
- Home의 다음 확인 시각(02:00 KST)은 scheduler가 꺼진 로컬 환경에서는 실행되지 않는다(기존 성질).

## Stage 2 — 새 REAL 문의 1건이 Case → Goal → Knowledge → Resolution → Draft를 지나는가 (2026-09-23 02:08 KST) · `PARTIAL`

### 2-0. 승인과 범위

- 승인 **`apr-resp-e2e2-2f33eab5166f93e0`** · runId `resp-full-e2e-2` · Demo Org — operator 「Seated and ready.」. 단일 사용, 소진됨.
- 코드 `e7e79354`(제품 코드는 `e396ee1e`와 동일, 워크트리 clean). 코드 변경 0.
- 실행 방식은 stage 1과 같다(8080 pause → 18080 responsibility scheduler만 ON → 80초 run 0 → resume → run 1개 → 즉시 종료).
- 모델 ON(Demo Org allow-list, access scope `ALLOW_LIST`): Inquiry Goal · Agent Draft · Knowledge embedding · intent ·
  eligibility. OFF + key 제거: 나머지 12개(Investigation · Inquiry decision · 상세 enrichment 포함). 과금 호출 상한은
  daily quota로 강제(오늘 사용량 0 + 6). Goal key는 operator 지시로 같은 vendor의 기존 draft key를 **참조**로 설정
  (값 복사·출력 0).
- 테스트 문의: operator가 Cafe24 문의 게시판에 직접 작성 — 「상품을 받은 뒤 교환이나 반품은 언제까지 가능한가요?
  개봉하지 않은 상품 기준도 함께 알려주세요.」

### 2-1. 결과 — 단계별

run `ae8d0d3c` RESUME · window 02:00–04:00 · 02:08:15–02:08:32 · `SUCCESS` · 18080 종료 02:08:40.

| 단계 | 결과 |
|---|---|
| 수집 | CAFE24 문의 COMPLETE 1/새 1 (테스트 문의, ROOT·UNANSWERED·REAL) · NAVER · CAFE24 리뷰 · COUPANG COMPLETE 0 |
| Case | `d14a492c` 새로 열림 — CUSTOMER_WORK · NEEDS_DECISION · decided_by RULE · UNANSWERED_INQUIRY |
| Goal | `INTERPRETED`(contract `customer-goal-interpreter/v3`, 3.9 s) — goal 2개, 둘 다 subject ORGANIZATION · ANSWER · STATED; g2는 constraint `미개봉`. **해석은 정확했다** |
| Knowledge | 두 goal 모두 `KNOWLEDGE.ORG`를 조회했고 근거 0 |
| Resolution | `NEEDS_SELLER` → **`ADD_KNOWLEDGE`**, knowledge gap `{basis: NO_ANSWER_BASIS, topic: EXCHANGE_RETURN, suggestedScope: ORG, missingSubject: "드립니다"}` |
| Investigation | `INVESTIGATION_SKIPPED CAPABILITY_OFF` (설계대로) |
| Draft | **도달하지 않음** — 초안은 `REPLY_TO_CUSTOMER`에서만 준비된다. work item OPEN 유지, proposal·draft 0 |

### 2-2. 호출과 쓰기 (실측)

- vendor 호출 4 / 상한 36: goal 1 · knowledge embedding(QUESTION) 2 · knowledge intent 1 · **eligibility 0**(판정에
  넘어온 문단이 없었다). 과금 호출 1 / 상한 6. Investigation · decision · 나머지 capability 0.
- marketplace READ ≈11–12 / 상한 22 — NAVER 토큰 1 + GET 2 · CAFE24 토큰 갱신 2 + 목록 2 + 답변 관측(발견 1 + 댓글 ≤1) ·
  COUPANG GET 2(마지막 두 항목은 요청 로그가 없어 코드 경로 기준). WRITE 0.
- 신규 문의 1 / 상한 3 — 다른 REAL 문의 유입 0.
- DB: inquiries +1 · work item +1(OPEN) · audit +1 · case +1 · case event +2(OPENED · INVESTIGATION_SKIPPED) ·
  goal interpretation +1 · agent_llm_usage +1 · customer_memory +1 · run +1 · run_source +4 · sync_jobs +4.
  proposal · draft · draft evidence · knowledge_candidate · knowledge_embedding · approval · execution **+0**.
  부팅 시 answer memory 백필 러너 재실행(stage 1과 같은 부수 효과).
- Home: sources 4(CAFE24 문의 1/새 1) · decisions 1 → 2 · gaps 0 → 0 · 확인할 일 문의 큐 24 → 25.

### 2-3. 판정과 남은 결함 (이 기록 시점, 수정 전)

`PARTIAL` — Case · Goal · Resolution은 production 경로로 증명됐고 Draft는 도달하지 않았다. 중단 조건 발동 0,
승인 · 전송 · marketplace WRITE 0.

1. **Knowledge retrieval miss** — Demo Org에는 「수령 후 7일 이내, 개봉하지 않은 상품에 한해 교환과 반품 가능」
   정책(`EXCHANGE_REFUND_POLICY`)이 있는데 두 goal 모두 근거 0으로 `ADD_KNOWLEDGE`가 됐다. eligibility가 호출되지
   않았으므로 문단은 그 앞 단계에서 사라졌다. 원인 미확정 — 후속 trace에서 닫는다.
2. **근거 없는 gap 낱말** — knowledge gap의 `missingSubject`가 고객이 쓰지 않은 「드립니다」였다. 이 값은 판매자에게
   「무엇이 부족한가」로 보이는 문장의 재료다.

### 2-4. 결함 1 종결 — 왜 근거가 사라졌는가 (승인 `apr-retr-diag-1d83874393b6129d`, 2026-09-23)

모델 없이 재현 가능한 단계를 먼저 전부 확인했다. **candidate 생성 · topic 필터 · remedy 필터 · lexical ranking은
두 질문 모두 통과**했고(lexical 경로는 이번 질문에도 `FOUND`, coverage 1.0), eligibility는 호출된 적이 없다.
남은 미지수는 질문 벡터 하나뿐이었고 그것만 bounded diagnostic으로 샀다 — **벤더 8회**(intent 2 + QUESTION
embedding 6), PASSAGE embedding 0(문단 벡터 36행 전부 캐시 적중), marketplace 0 · WRITE 0 · DB write 0 · run 0.

측정 (`text-embedding-3-large`/1024, 문서 2건 · 비교 단위 5개):

| 질문 | best | runner-up = 배경 평균 | margin | 판정 |
|---|---|---|---|---|
| Stage 2 실제 문의 | 0.6639 (교환·반품 기준) | 0.5670 (배송교환정책) | **0.0969** | 부재 |
| 기존 「성공」 교환 질문 | 0.6109 (배송교환정책) | 0.6064 (교환·반품 기준) | **0.0045** | 부재 |

**두 질문 모두 부재로 판정된다.** 「기존 성공 질문」이 성공이었던 것은 semantic lane이 꺼진 replay(=lexical)
에서였고, semantic이 켜진 production에서는 그 질문도 근거를 받지 못한다. 즉 이것은 이번 문의의 특성이 아니라
이 코퍼스에 대한 일반 결함이다.

**사라진 지점은 `KnowledgeRetriever`의 semantic 부재 게이트이고, 원인은 corroboration이다.** 이 org는 같은
교환 기한을 두 문서에 적어 두었다(국문 정책 1문장, 영문 배송 노트의 "Exchanges are accepted within 7 days of
delivery when the product is unused."). 게이트는 「best가 나머지로부터 얼마나 떨어져 있나」를 묻는데, 여기서
**나머지가 곧 두 번째 답**이므로 떨어질 수 없다 — 판매자의 문서가 서로 일치할수록 corpus가 침묵한다고 판정된다.
두 문장의 상호 유사도는 **0.750**이다.

부수 확인(가설 2): 검색용 질문 텍스트에 제목 「문의 드립니다」와 편집기가 남긴 `<meta charset="utf-8">`가 섞여
있었고 실제로 점수를 깎았다 — 태그 리터럴 제거만으로 margin 0.0969 → **0.1228**, 제목까지 빼면 0.1414. 다만
production 조합(원문+재진술)에서는 0.0640이라 **이 정리만으로는 닫히지 않는다**. 두 수정이 모두 필요하고,
결정적인 쪽은 corroboration이다.

### 2-5. 수정 (generic, 교환/반품 전용 hardcode 0)

1. **동의는 배경이 아니다** — `KnowledgeSemantics.agreementOf(a, b)`: 두 문단이 **이 질문에 답한 문장끼리**
   얼마나 가까운가. 배경 평균에서 best와 동의하는 문단을 빼고 계산하고, 남는 것이 없으면 「한 문서짜리 corpus」와
   같은 약한 규칙(`SOLO_MIN_SEMANTIC_COSINE`)으로 떨어진다. 문단↔문단 비교는 이미 메모리에 있는 벡터라 **추가 벤더
   호출 0**. 측정하지 못하는 lane은 `OptionalDouble.empty()`를 받아 **이전 게이트 그대로**다(기본 구현).
   문서 전체가 아니라 *답한 문장*을 비교하는 것이 topic 검사로 변질되지 않게 막는다 — 배송을 말하는 두 문서가 배송에
   대해 다른 말을 하면 여기서 갈린다.
2. **임계값은 골라진 것이 아니라 측정된 것** — `MIN_SEMANTIC_AGREEMENT = 0.70`. benchmark에서 **둘 다 질문에
   답하지 않는** 문단쌍 1,235개(=이 게이트가 지키려는 배경)의 분포는 median 0.254 · p95 0.448 · p99 0.514 ·
   **max 0.611**이고, 실제 corroboration 쌍은 **0.750**이다. 0.70은 관측된 모든 배경쌍 위, corroboration 아래다.
   sweep: 0.50~0.90 구간에서 benchmark 세 수치가 **전혀 움직이지 않고** 첫 열화는 0.45(부재 정확도 0.952)다.
3. **retrieval 질문 텍스트의 markup 리터럴 정리** — `RetrievalQuery.clean()`에서 여는 괄호 바로 뒤에 요소 이름이
   오는 좁은 형태만 제거한다. **표시 경로의 `MarkupText`는 무변경**(디코딩된 태그를 «보이는 글자»로 남기는 것은
   의도된 계약이다). 「두께가 2 < 3 인가요?」 같은 문장은 그대로 남는 것을 테스트가 고정한다.

**benchmark는 이 결함을 볼 수 없었다** — 114 질문 중 두 문서가 함께 답하는 질문이 **0건**이다. 그래서 임계값을
「점수를 올리는 값」이 아니라 「배경 분포 위」로 정했고, `AgreementBackgroundTest`가 그 분포와 임계값의 관계를
영구히 고정한다(벤더 호출 0).

### 2-6. Regression

| 대상 | 결과 |
|---|---|
| 114질문 benchmark (semantic, 벤더 0) | recall **92.5%** · top1-wrong **0** · any-wrong **0** · 부재 정확도 **100%** — shipped와 동일 |
| lexical baseline | 43.0% — 불변 |
| 기존 성공 교환 질문 / 이번 실제 질문 / knowledge 없는 질문 | `LiveExchangeQuestionReplayTest` 통과 |
| 실제 Demo Org 재측정 (같은 8회 벤더 호출 안에서) | 두 질문 모두 근거 회복 — 이번 질문 `[교환·반품 기준 0.6667, 배송교환정책 0.6027]`, 기존 질문 `[배송교환정책 0.6109, 교환·반품 기준 0.6064]` |
| backend 전체 | **4,800 tests · 실패 0** |

marketplace 호출 **0** · WRITE **0** · DB write **0** · 마이그레이션 **0** · Stage 2 재실행 **없음**.
