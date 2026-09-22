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
