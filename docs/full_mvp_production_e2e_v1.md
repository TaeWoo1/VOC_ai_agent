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

## 3. Stage 2 rerun — `PASS` (2026-09-23)

### 3-0. 승인과 범위

- approvalId **`apr-resp-e2e2-d7c190f2edc59568`** · runId `resp-full-e2e-2r` · mode READ_ONLY (+ 모델) · Demo Org
- 코드 **`31ec02ec`**(§2-5 수정 포함) · 실행기 `resp-e2e2-run.sh` sha256 `fb4aa95a68fb797a…`(stage 2와 **바이트 동일**) ·
  스냅샷 `snapshot2.sql` sha256 `adce51e747253be5…`(동일)
- stage 2의 승인은 코드 `e7e79354`에 묶여 있었으므로 계약대로 `REVOKED`로 보고 새 단일 사용 승인을 받았다.

### 3-1. 실행 전 재검증 — 새 문의가 유일한 대상임을 쿼리로 확정

후보 창은 15일이 아니라 `since = max(firstSettledObservation, now−15d)` = **2026-09-21 21:44:14**.
그 창 안의 REAL 문의는 4건이고 **넷 다 모델 호출 0**으로 예측했다 — `89d24480`·`59c7c80c`는 signature 불변이라
`OperationsCaseProcessor.handle`에서 단락되고, `bf624a8b`·`a5bc25e0`는 `ANSWERED`라 케이스가 열리지 않는다.
**run 로그가 그대로 확인했다**: `변화없음=2 새Case=1 갱신=0 조사=0 조사생략=1 초안=1`.

8080 백엔드는 `SELLEROPS_*` 환경변수가 **하나도 없고** `responsibility.scheduler-enabled`·`collect.scheduler-enabled`
기본값이 둘 다 false라 run을 시작할 수 없다(확인 후 그대로 두었다 — pause/resume 조작 0).

### 3-2. 절차 — 조작 없이 «정확히 하나»

18080을 03:30:32에 기동(responsibility scheduler만 ON, 과금 상한 `used=1 → limit=7`). `next_run_at`이
**04:00:00**이었으므로 상태를 건드리지 않고 그 시각을 기다렸다 — **88회 연속 정숙 폴링(약 29분) 동안 새 run 0건**,
04:00:13에 run `1ab54bc8` 시작 → 04:00:37 `SUCCESS` → 04:01:18 프로세스 종료. stage 1·2가 쓴 pause 가드는
필요 없었다: 「정확히 하나」를 스케줄 자체가 보증한다.

### 3-3. 결과 — 단계별

| 단계 | 결과 |
|---|---|
| 수집 | CAFE24 문의 `COMPLETE` **관측 1 / 새 1**(수신 1 저장 1, 비밀글·창밖·스레드답글 제외 0) · NAVER 문의 0 · CAFE24 리뷰 0 · COUPANG 문의 0 |
| 새 문의 | `11b6a729` REAL · ROOT · UNANSWERED. 제목 「문의 드립니다」 + 본문에 이중 이스케이프된 `<meta charset="utf-8">` — **두 결함의 조건이 그대로 재현된 입력** |
| Case | `e1df3bb5` `PREPARED` (새 케이스 1, 기존 2건은 변화없음) |
| Goal | `INTERPRETED`, `customer-goal-interpreter/v3`, goal 2건 — evidence가 고객의 두 문장 그대로(markup·「드립니다」 **불포함**) |
| Knowledge | **FOUND** — 근거 2건, `ORG_POLICY 교환·반품 기준` + `ORG_POLICY 배송교환정책` |
| Eligibility | **실제로 호출됨** 2회(passages 2 · 1), 둘 다 `answered=true`, 거절 0 |
| Resolution | **`REPLY_TO_CUSTOMER`** |
| Investigation | OFF — `조사=0 조사생략=1` |
| Draft | work item `4c53cbee` **`PROPOSED`** · 초안 **v1 `MODEL`** · **`answer_basis=GROUNDED`** · `prepared=DRAFT_PREPARED` |

초안 본문(132자)은 판매자 자신의 정책만 인용한다 — 「…수령하신 날로부터 **7일 이내**에 신청 … **개봉하지 않은**
미사용 상품에 한해 교환 및 반품이 가능합니다」. 두 문서의 사실이 한 문장으로 합쳐졌고 지어낸 수치는 없다.

**§2-5 수정이 라이브에서 확인된 지점은 근거 목록이다** — 서로를 배경으로 지워 corpus를 침묵시키던 두 문서가
이제 **둘 다 근거로 인용된다**.

### 3-4. 호출과 쓰기 (실측)

- vendor **7 / 문의당 상한 12 / run 상한 36**: goal 1 · knowledge intent 1 · knowledge embedding(QUESTION) 2 ·
  **knowledge eligibility 2** · agent draft 1. PASSAGE embedding **0**(문단 벡터 36행 캐시 적중 — 예측대로).
  과금(goal+draft) **2 / 6**. 켜지 않은 capability 호출 **0**.
- marketplace: NAVER 상품 문의·고객 문의 · CAFE24 게시판 · COUPANG READ만. **WRITE 0 · 승인 0 · execution 0**
  (로그에 publish/approval/execute 마커 0). ERROR/WARN **0**.
- DB diff: inquiries +1 · work_items +1(**PROPOSED +1, OPEN 불변**) · wi_audit +2 · cases +1 · case_events +3 ·
  goal_interp +1 · proposals +1 · inq_drafts +1 · **draft_evidence +2** · llm_usage +2 · customer_memory +1 ·
  run +1 · run_source +4 · sync_jobs +4.
  **불변**: knowledge_embedding 36 · **knowledge_candidate 3**(gap 적재 0 ⇒ GROUNDED와 일관) · approvals 3 ·
  executions 3 · reviews · review_triage · sync_cursors · item_analyses · answer_memory · wi_open.
- 화면: 문의 큐 `totalElements` **25 → 26**.

### 3-5. 판정

**`PASS`** — 성공 기준 8개 전부 충족. 새 inquiry 1 · Case 1 · Goal 저장 · 교환·반품 정책 FOUND/GROUNDED ·
`REPLY_TO_CUSTOMER` · work item `PROPOSED` · 초안 v1 `MODEL` · draft evidence에 실제 정책 2건 인용 ·
approval/execution/marketplace WRITE 0. 중단 조건 발동 0. 신규 문의 1 / 상한 3.

### 3-6. 이 run이 증명하지 않는 것

- 초안 **문장**은 결정론이 아니다. 고정된 것은 어떤 근거가 실렸는가이지 모델이 쓴 문장이 아니다.
- retrieval 세 단계 중 둘이 매 검색마다 새 모델 호출이므로 경계선 비결정성은 남는다.
- **전송은 증명하지 않았다**(WRITE 0). 판매자가 초안을 복사해 채널에 올리는 단계는 이 run의 범위 밖이다.

## 4. Stage 3 — 승인된 답변이 실제로 고객에게 등록되는가 · **manifest (미실행)**

Draft → 승인 → 실행 → 완료 lifecycle을 **실제 marketplace WRITE 1회**로 닫는 단계. 이 절은 **계획이고 실행
기록이 아니다** — 작성 시점까지 marketplace WRITE **0**, 승인 소진 **0**, DB 행 변경 **0**.

### 4-0. 기준 코드와 선행 조건

- 기준 커밋 **`cbab8347`**(「승인은 소진됐는데 아무것도 실어 나르지 않는 경로가 열려 있었다」 — Stage 3
  lifecycle gap G1~G4 종결). 이 manifest는 **그 커밋에서만** 유효하다: G1이 arming 순서를 바꿨고
  G4가 절차에서 한 단계를 없앴으므로, 이전 커밋 기준의 manifest를 재사용하면 절차가 틀린다.
- 선행: Stage 3 감사(코드·DB 추적, 수정 0)와 §3 Stage 2 rerun `PASS`.
- 승인 **`apr-c24-a3678-stage3-01c3d8b4bf78ab87`** — mode **WRITE**, max WRITE **1**, 자동 재시도 **0**,
  단일 사용. **미소진**. 이 manifest에 bind되며, 코드·브랜치·스코프·계정이 바뀌면 계약대로 `REVOKED`다.

### 4-1. 대상 — 하나, 그리고 그 하나뿐

| 항목 | 값 |
|---|---|
| org | `7146c50f-ff6d-4c83-ae96-18c930e6d8e0` (Demo Org) |
| seller account | `78da0eb3-3088-4ecb-919f-3e08dad1d402` (CAFE24, API) |
| inquiry | `11b6a729-3159-468a-9ee4-f5b2ea8a8043` |
| external id | `cafe24:b6:a3678` (board 6, article 3678) |
| source subtype | **NULL** — 이 채널의 유일한 문의 리소스 |
| work item | `4c53cbee-0472-44e5-81ad-158f24f27bc3` · phase **`PROPOSED`** |
| case | `e1df3bb5-b5b9-4b9e-942b-27fc5e2f885c` · status **`PREPARED`** |
| draft head | **v1** · `author_kind=MODEL` · `answer_basis=GROUNDED` · `created_by=SYSTEM:RESPONSIBILITY` |

**전송될 draft v1의 정확한 전문.** 이것이 고객에게 그대로 등록된다. 한 글자도 다르면 지문이 달라지고
confirm이 409로 거절한다.

- 제목: `교환 신청 기한 및 개봉 여부 기준 안내`
- 본문(132자):

```
문의 주셔서 감사합니다. 상품 교환은 상품을 수령하신 날로부터 7일 이내에 신청해 주셔야 하며, 사용하지 않은 상태여야 합니다. 특히 포장을 개봉하지 않은 미사용 상품에 한해 교환 및 반품이 가능합니다. 도움이 필요하시면 말씀해 주세요.
```

- **full fingerprint** (`esm-answer-v1`):
  `5b8f503710e013c4caa7ec7ffaac8fed2e5d6d24c0824369e61a1a22a37d18c3`

**이것은 `MODEL` 초안이다.** 지금까지의 두 live WRITE(Cafe24 `a3672`, NAVER `686514802`)는 **모두 판매자가
고쳐 쓴 v2 `SELLER`**를 보냈고, `MODEL` 원문이 그대로 고객에게 나간 적은 이 제품에서 **한 번도 없다**.
v1을 그대로 보낼지, 판매자가 v2를 써서 보낼지는 **product-owner 결정**이며 이 manifest는 v1 기준으로
적는다(v2를 만들면 지문이 바뀌므로 §4-1의 지문과 §4-4의 단계 2를 그 값으로 갱신해야 한다).

### 4-2. arming — 이제 confirm **앞에** 서야 한다

`cbab8347` G1 이후 `confirm-publish`는 **바인딩 전에** capability와 transport를 묻는다. 무장되지 않은 채
누르면 **409**이고 approval · intent · execution **어느 것도 쓰이지 않으며** work item은 `PROPOSED`로 남고
초안도 잠기지 않는다. 즉 arming 누락은 이제 조용한 교착이 아니라 **되돌릴 것이 없는 거절**이다.

| 게이트 | 요구 값 | 현재 | 막으면 나타나는 것 |
|---|---|---|---|
| Cafe24 write scope | `mall.write_community` | **✅ 이미 보유** | adapter가 `RETRYABLE_FAILURE`로 거절(전송 0) |
| publish flag | `SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED=true` | ❌ `false` | confirm **409**, 행 0 |
| connector flag | `SELLEROPS_CONNECTOR_CAFE24_ENABLED=true` | ❌ `false` | confirm **409**, 행 0 |
| live approval gate | `SELLEROPS_INQUIRY_PUBLISH_CAFE24_LIVE_APPROVAL_ID=apr-c24-a3678-stage3-01c3d8b4bf78ab87` | ❌ 공백 | `Cafe24WriteApprovalRequired` — 요청이 조립되기 전에 throw |
| client ip | `SELLEROPS_INQUIRY_PUBLISH_CAFE24_CLIENT_IP=<이 배포의 egress IPv4>` | ❌ 공백 | adapter가 `RETRYABLE_FAILURE`(전송 0) |
| shop no | `SELLEROPS_INQUIRY_PUBLISH_CAFE24_SHOP_NO=1` | ❌ `0` | adapter가 `RETRYABLE_FAILURE`(전송 0) |

`client_ip`는 **배포 설정**이다 — 08-25 관측값을 재사용하지 않고 이 프로세스가 실제로 나가는 주소를 넣는다.
나머지 프로세스 자세는 Stage 1~3과 동일: 격리 backend(18080), collect · self-pilot · proactive · aside ·
responsibility scheduler **전부 OFF**, 리뷰 publish **OFF**, 모델 capability 전부 OFF + key 제거.

### 4-3. 예산과 금지

| 항목 | 상한 |
|---|---|
| marketplace **WRITE** | **정확히 1회** (`POST /api/v2/admin/boards/6/articles`) |
| 자동 재시도 | **0** — `Cafe24ReplyArticleClient`에 재시도 메서드가 없다 |
| verification **READ** | **최대 2회** (`fetchByArticleNumbers` 1 + 자식 번호를 못 받았을 때만 같은 날짜 `fetchPage` 1) |
| 토큰 갱신 | ≤2 (기존 성질) |
| 모델 호출 | **0** — 이 경로에 drafter · planner · retrieval이 없다 |
| 새 문의 유입 | 0 (수집 스케줄러 OFF) |
| DB 직접 수정 | **0** |

**금지**: `rearm` 사용, 두 번째 POST, 다른 문의 접촉, `57ee2220` 수정(그 행은 G1 회귀 증거다).

### 4-4. 절차

1. **bounded READ 1회 — 대상이 아직 거기 있고 미답변인가.** `GET /api/v2/admin/boards/6/articles`에
   `article_no=3678` exact 필터. 확인할 것 셋: 글이 **존재**한다 · `parent_article_no`가 비어 있다(ROOT) ·
   댓글/자식 답변이 없다(미답변). **이 단계는 생략하지 않는다** — 직전 테스트 문의 `a3676`은 operator가
   marketplace에서 직접 삭제했고(§1-7), 로컬 행은 그대로 남았다. 삭제된 대상에 POST하면 실패가 예산을
   태운다. 없거나 이미 답변돼 있으면 **여기서 중단**하고 WRITE로 가지 않는다.
2. **head draft 재확인.** `version=1`, `content_fingerprint=5b8f5037…d18c3`. 다르면 중단.
3. **`POST /api/inquiries/4c53cbee-0472-44e5-81ad-158f24f27bc3/confirm-publish`** 1회
   (`commandId` = 새 UUID, `expectedFingerprint` = 위 지문). 이 **한 요청 안에서** 승인 바인딩 → intent →
   execution → **marketplace POST 1회** → exact READ 검증 → work item/inquiry 갱신 → case 수렴이 전부
   일어난다. 판매자 관점에서 승인과 전송은 두 단계가 아니다.
4. **§4-5 / §4-6과 대조.** 추가 responsibility run은 **필요 없다** — G4가 case 수렴을 이 요청 안으로 옮겼다.

### 4-5. 성공 시 예상 상태

| 대상 | 기대 |
|---|---|
| `inquiry_approval` | **+1** — `approved_draft_version=1` · `approved_fingerprint=5b8f5037…` · `action_kind=POST_INQUIRY_REPLY` · `target_external_id=cafe24:b6:a3678` · `source_subtype=NULL` |
| `inquiry_action_intent` | **+1** |
| `inquiry_execution` | **+1** · `status=COMPLETED` · `provider_message_no=<몰이 이름 지은 자식 article_no; 이름 짓지 않았으면 대상 번호 `3678`>` · `verify_attempts=1` |
| `inquiry_verification` | **+1** · `verified=true` · `observed_status=ANSWERED` |
| work item `4c53cbee` | `PROPOSED → ACTION_PENDING → EXECUTED → **COMPLETED**` |
| `inquiry_work_item_audit` | **+4** (`APPROVAL_GRANTED` · `ACTION_INTENT_CREATED` · `EXECUTION_RECORDED` · `VERIFICATION_RECORDED`) |
| inquiry `11b6a729` | **즉시 `ANSWERED`** · `answered_at` 최초 1회 각인 (수집을 기다리지 않는다) |
| case `e1df3bb5` | **즉시 `ACTED` / `SELLER_ACTED`** · `acted_at` 각인 · `reconciled_at` 각인 |
| `operations_case_event` | **+1** `SELLER_ACTED`, provenance에 `WORK_ITEM_COMPLETED;delivery=COMPLETED;outcome=COMPLETED;verified=true;observed=ANSWERED` 인용 |
| `answer_memory` | **+1** `EXECUTOR_SENT_VERIFIED` (검증 성공 뒤에만) |
| 문의 상세 / Case 화면 | **새로고침 후에도** 「답변이 등록되었습니다」 · Case 태그 「등록됨」 (G3) |
| Home 「실행 대기」 / 확인할 일 | 이 행이 **즉시** 사라진다(phase `COMPLETED`는 `AWAITING_SELLER` 밖) |
| `agent_llm_usage` | **+0** |

검증은 2xx가 아니라 **exact READ**가 정한다: 자식 글 존재 · `parent_article_no==3678` · 답글 구조 ·
**정규화 본문 해시 == 승인 초안** · 부모 `reply_status`. 다섯 중 하나라도 어긋나면 성공이 아니다.

### 4-6. 실패 시 예상 상태 — 어디에 정확히 남는가

**모든 분기에서 approval과 intent는 이미 쓰였고 남는다**(POST 이전에 바인딩되므로). 초안은 `PROPOSED`를
떠났으므로 **얼어 있다**. 자동 재시도는 어느 분기에도 없다.

| 분기 | execution | work item | case (G1b 적용) | inquiry |
|---|---|---|---|---|
| **POST 4xx**(401/403/429 제외) — 명시적 거절 | `FAILED` · `failure_reason=EXECUTION_FAILED` · `result_code=<HTTP>` | `FAILED` | **`ACTED`/`SELLER_ACTED`**, `delivery=FAILED;outcome=PERMANENT_FAILURE` 인용 | `UNANSWERED` 유지 |
| **POST 401 / 403 / 429** — 아무것도 안 나감 | `ACTION_PENDING`(복귀) | `ACTION_PENDING` | **`PREPARED` 유지** — 아무것도 실려가지 않았으므로 카드가 열려 있다 | `UNANSWERED` |
| **POST 5xx 또는 transport 예외** — 나갔는지 모름 | `DELIVERY_UNKNOWN` | `ACTION_PENDING`(불변) | **`ACTED`/`SELLER_ACTED`**, `delivery=DELIVERY_UNKNOWN;outcome=CHECKING_REQUIRED` | `UNANSWERED` |
| **POST 2xx + 검증 불일치**(자식 없음/부모 불일치/해시 불일치) | `EXECUTED` 유지 · `verify_attempts=1` | `EXECUTED` | **`ACTED`/`SELLER_ACTED`**, `delivery=EXECUTED;outcome=CHECKING_REQUIRED;verified=false;observed=DELIVERY_UNKNOWN` | `UNANSWERED` |
| **POST 2xx + 자식 확인 · 부모 `reply_status≠C`** | `EXECUTED` 유지 | `EXECUTED` | 위와 같되 `observed=ANSWER_POSTED_STATUS_UNRESOLVED` | `UNANSWERED` |
| **arming 누락** — confirm 자체가 거절 | **행 없음** | `PROPOSED` 유지 | `PREPARED` 유지 | `UNANSWERED` |

세 번째·네 번째·다섯 번째 분기에서 **답변이 고객에게 갔을 수 있다**. 그때 규칙은 하나다 — **재전송하지 않고
`POST /verify`로 다시 읽는다**(두 번째 답변은 덮어쓰기가 아니라 두 번째 자식 글이 된다). `answer_memory`는
검증 성공에서만 쓰이므로 이 분기들에서 **+0**이다.

### 4-7. 실행 전후로 비교할 DB — 실측 스냅샷 (2026-09-23, org `7146c50f`)

| 카운터 | 실행 전 | 성공 시 기대 |
|---|---|---|
| `inquiry_approval` | **3** | 4 |
| `inquiry_action_intent` | **3** | 4 |
| `inquiry_execution` | **3** | 4 |
| `inquiry_verification` | **2** | 3 |
| `answer_memory` | **25** | 26 |
| `agent_llm_usage` | **2575** | 2575 (불변) |
| work item `COMPLETED` | **8** | 9 |
| work item `PROPOSED` | **14** | 13 |
| work item `ACTION_PENDING` | **1** | 1 (불변 — 그 1건은 `57ee2220`이고 건드리지 않는다) |
| case `PREPARED` | **5** | 4 |
| case `ACTED` | **0** | 1 |
| `inquiries` UNANSWERED · REAL | **3270** | 3269 |
| 대상 case event | **3** | 4 |
| 대상 work item audit | **2** | 6 |
| 대상 draft 행 | **1** (v1) | 1 (append-only, 불변) |

**대상 row snapshot (실행 전, 실측)**

```
inquiry_work_item 4c53cbee : phase=PROPOSED       updated_at=2026-09-23 04:00:31.890439+09
inquiries        11b6a729 : status=UNANSWERED  operational_state=ACTIVE  thread_role=ROOT
                            data_origin=REAL   external_id=cafe24:b6:a3678  source_subtype=NULL
proactive_case   e1df3bb5 : status=PREPARED  prepared_action=DRAFT_PREPARED  draft_version=1
                            acted_at=NULL  closed_at=NULL  reconciled_at=NULL
                            responsibility_id=82ea2751  recommended_action_type=REPLY_TO_CUSTOMER
inquiry_reply_draft       : v1  MODEL  GROUNDED  fp=5b8f503710e013c4caa7ec7ffaac8fed2e5d6d24c0824369e61a1a22a37d18c3
inquiry_approval/execution/verification for 4c53cbee : 없음
```

**불변이어야 하는 것**: `57ee2220`(ACTION_PENDING 고아 — G1 회귀 증거) · `a492dba2`·`7eafaf5a`(과거 live
WRITE 증명 행) · `knowledge_candidate` · `knowledge_embedding` · 리뷰 lane 전부 · 다른 org.

### 4-8. 이 단계가 증명하는 것과 증명하지 않는 것

**증명한다**: OperationsCase가 연 일 하나가 draft → 승인 → 실행 → 검증 → case 종결까지 **하나의 production
경로**로 닫히는가. 지금까지 증명된 것은 **adapter**였다 — 08-25 Cafe24 WRITE는 case 행이 **아예 없었고**,
08-26 NAVER WRITE의 case는 work item이 `COMPLETED`인데 `PREPARED`에 멈춘 채로 남아 있다.

**증명하지 않는다**: 초안 **문장**의 결정론(고정된 것은 어떤 근거가 실렸는가이다) · 다른 채널의 전송 ·
리뷰 답변 전송 · `MODEL` 초안을 그대로 보내는 것이 옳은 제품 결정인가(§4-1의 미결).

### 4-9. 실행 시도 1 — `HALTED_AT_PRECONDITION` (2026-09-23 19:35~19:41 KST)

승인 **`apr-c24-a3678-stage3-01c3d8b4bf78ab87`**(mode WRITE, max 1) 아래에서 §4-4를 시작했고 **1단계에서
멈췄다**. **marketplace WRITE 0 · POST 0 · 승인 미소진.**

**자세.** 1단계는 `inquiry.publish.execution-enabled=**false**`인 프로세스에서 했다 — 그 설정에서는
`PublishExecutionWiring`이 조건을 만족하지 못해 **어떤 ChannelReplyAdapter bean도 존재하지 않으므로**, 실수로도
POST에 도달할 수 없다. 「읽기만 하겠다」가 의도가 아니라 **구조**인 상태에서 읽었다. 커넥터는 CAFE24만 ON,
모델 capability 16개 OFF + API key 15개 공백(둘 다 끈 이유는 boot validator가 「켰는데 키가 없음」을 거부하기
때문이고, 그 거부가 §4-2가 말한 fence가 실제로 도는 모습이다), 스케줄러 전부 OFF, 18080 격리 기동 3회.

**관측 — exact article READ 3회가 전부 빈손.** 계측기는 `Cafe24ShopScopeProbe`(단일 bounded LIST, 명시된
article 번호만, 쓰기 없음).

| # | 요청 | 대상 | 결과 |
|---|---|---|---|
| ① | 1회 | `3678` | `OK` · 조회대상 1 · **응답 0** |
| ② | 1회 | `3672, 3673, 3676, 3678` | `OK` · 조회대상 4 · **응답 0** |
| ③ | 1회 | `3672` | `OK` · 조회대상 1 · **응답 0** |

**③이 판정의 근거다.** `article_no=3672` 단건 필터는 2026-08-25에 이 계측기가 `shop_no=1 · board_no=6`을
확정하며 **행을 돌려준 바로 그 호출**이다(§inquiry_answer_execution_v1 Part D). 지금은 HTTP 200에 `articles`
배열이 비어서 온다. **필터가 무시된 것이 아니다** — 무시됐다면 무관한 행이라도 돌아왔을 것이고, 0이 온다는
것은 몰이 이 스코프에 그런 글이 없다고 답한 것이다. 따라서 부재는 목표 하나의 성질이 아니라 **exact-id 경로
전체**의 성질이다.

**「삭제」로 판정하지 않는다.** 관측된 것은 부재뿐이고, 「absence는 삭제로 자동 판정되지 않는다」
(`docs/inquiry_operational_truth_v1.md`)가 그것을 금지한다. 다만 §1-7에 operator가 `a3676`을 마켓플레이스에서
직접 삭제한 전례가 있고, 부재한 넷 중 하나가 바로 그 `3676`이다.

**같은 날 04:00 수집은 `a3678`을 실제로 관측했다** — §3-3의 CAFE24 문의 `COMPLETE` **관측 1 / 새 1**이 그것이고,
같은 자격·같은 board 6이다. 그 경로는 **날짜창 목록**이고 이번에 빈손인 것은 **article_no 지정 조회**다. 두
경로의 관측이 갈린다는 것이 이 기록의 핵심 관측이며, 원인은 미확정이다.

**진행하지 않은 두 번째 이유 — 검증이 같은 읽기 위에 서 있다.** `Cafe24ChannelReplyAdapter.verifyCreated`는
`fetchByArticleNumbers`로 자식 글을 찾는다. exact-id 경로가 빈손인 상태에서는 POST가 성공해도 자식을 찾지
못해 판정이 **`DELIVERY_UNKNOWN`**으로 떨어진다. 그러면 단일 사용 WRITE를 쓰고도 `VERIFIED`에 도달할 수 없고,
재전송은 금지(덮어쓰기가 아니라 두 번째 자식 글이 된다)이므로 복구 경로도 없다. **검증 불가가 예정된 전송은
승인이 허가한 것이 아니다.**

**DB (실행 전후 동일).** approval **3** · action intent **3** · execution **3** · verification **2** ·
work item `4c53cbee` **`PROPOSED`** · case `e1df3bb5` **`PREPARED`** · inquiry `11b6a729` **`UNANSWERED`** ·
draft **v1**(fp `5b8f5037…d18c3`) · `agent_llm_usage` **2575**(모델 호출 **0**) · `answer_memory` **25**.
§4-7의 실행 전 스냅샷과 **한 칸도 다르지 않다**. 유일한 쓰기는 **인가가 필수로 수반하는 Cafe24 refresh token
단일 사용 회전**(`connector_credentials.last_rotated_at` 19:40:16)이고, 이는 승인된 READ의 성질이지 이 run의
결정이 아니다. 부팅마다 도는 answer-memory 백필도 재실행됐고 새 행은 0이다(Stage 1과 같은 부수 효과).

marketplace 요청: LIST **3** + 토큰 갱신 ≤3. WRITE **0**. ERROR/WARN **0**. 18080 프로세스는 전부 종료했고
기존 8080 backend는 건드리지 않았다.

**승인 상태**: `apr-c24-a3678-stage3-01c3d8b4bf78ab87`은 **소진되지 않았다**. 코드가 `720c3cee` 그대로이고
계정·채널·대상 범위가 유지되는 동안 같은 세션에서 유효하다.

**다음에 필요한 것**(셋 중 하나, 전부 product-owner 입력): 마켓플레이스 관리자에서 board 6에 `a3678`이
실제로 있는지 육안 확인 · 없으면 새 테스트 문의를 올려 수집 run 1회로 새 대상을 만들고 manifest를 갱신 ·
있으면 스코프 축(shop_no / mall / board)을 좁히는 bounded READ.
