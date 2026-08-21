# Cafe24 Inquiry Source Reconciliation — Audit (2026-08-22)

**What this is.** An audit of the Cafe24 inquiry ingest/sync path, asking whether SellerOps can tell
that an inquiry is no longer valid at the source — and what is polluting current operational truth in
the meantime. Read on `feat/operator-graph-v2` + the local `sellerops` database (PG 15.13), org
`7146c50f…d8e0`. **Code change 0; this document is the audit only.** The package that acts on it is
`docs/inquiry_operational_truth_v1.md`.

**Nothing here was established against a marketplace.** No Cafe24 call was made, no credential was read.

---

## 0. 판정 요약

**추정은 사실이었고, 셀러는 이미 조치를 마쳤다.**

`inquiry_work_item` **3,199행이 `DISMISSED` / `disposition=SPAM`** — 2026-07-06에 승인된 batch 7개
(`cafe24-spam-dismiss-2026-07-06-chunk-01…07`, manifest hash + `approved_by` + `EXECUTED`)로 처리됨.

**그런데 그 판정을 읽는 소비자가 하나도 없다.** dismissal은 work item의 `phase`만 바꾸고
`inquiries.status`는 건드리지 않는데, 미답변 수·리포트·customer memory·반복 분석·Operator는 전부
`inquiries`를 직접 읽는다.

**이것은 수집 결함이기 이전에 read-path 결함이다.** 그리고 Cafe24에 다시 접속하지 않고 고칠 수 있는
유일한 부분이기도 하다.

숫자 정정: `inquiries`는 **3,229**건(Cafe24 **3,201**). 3,220은 `customer_memory_entries`의 INQUIRY
인덱스 수(Cafe24 3,201 + Coupang 11 + NAVER 8)다.

---

## 1. 재관측 시 INSERT만 하는가, UPDATE도 하는가 — **UPDATE 한다**

`IngestionService.ingestInquiries`가 `external_id`(=`cafe24:b6:a<article_no>`) 기준 source-aware
upsert다(V34). `sourceUnchanged`면 skip, 바뀌었으면 in-place update.

**그러나 이 3,201행에는 한 번도 적용된 적이 없다.** V34는 **2026-08-10** 설치, 행들은 **2026-07-06**
적재. 증거는 데이터에 있다 — **3,200행이 `created_at = updated_at`**. `is_secret`이 전량 NULL인 것도
같은 이유(당시 컬럼 부재).

## 2. source의 답변/상태 변경을 반영하는가 — **코드는 반영하지만 재관측이 없다**

`applyInquirySource`가 title/body/inform_status/is_secret을 쓰고, `UNANSWERED→ANSWERED` 전이는
`reconcileConnectorAnswered`로 OPEN work item까지 원자적으로 완료 처리한다. 상태는 monotonic이라 stale
재수집이 답변을 되돌리지 못한다. **설계는 정상이다.**

문제는 커서다. 데모 org Cafe24 계정의 INQUIRY 커서가 `b6:o2:s2025-03-23:e2025-03-25`에 고정돼 있고,
`sync_schedules`는 **1시간 주기로 활성**이다. `SyncRunExecutor.runPages`는 backfill seed가 없으면 저장된
커서를 그대로 읽고, **backfill이 끝나도 창을 지우는 코드가 없다.** 커서 슬롯은 (account × dataType)당
하나뿐이므로, 운영자가 한 번 기간 backfill을 돌리면 **이후의 모든 정기 수집이 그 과거 창에 영구히
묶인다.** 스팸과 무관한 독립 결함이고, 스팸 문제보다 범위가 넓다.

부수: 2026-08-18부터 이 계정의 모든 수집(INQUIRY 41건 포함)이
`자격 증명 복호화에 실패했습니다`로 FAILED.

## 3. 삭제/비노출 감지 방법 — **없다. 그리고 이유가 두 겹이다**

**(a) 마지막 관측 시각을 어디에도 기록하지 않는다.** `inquiries`에 `last_seen_at`이 없고, 형제 테이블
`cafe24_community_articles`의 `collected_at`은 **hash가 같으면 `save()` 자체를 건너뛰어** 갱신되지
않는다. 변하지 않은 행을 "오늘도 봤다"고 기록하는 경로가 시스템 전체에 없다 — absence 판정의 전제
자체가 없다.

**(b) "삭제"와 "비노출"을 구분할 수 없다.** `Cafe24BoardArticleRow`는 9개 필드만 투영한다
(`article_no, title, content, product_no, rating, created_date, updated_date, reply_status, secret`).
**노출/차단 상태 필드가 없다.** "제한" 조치는 Cafe24가 플래그로 알려주더라도 현재 프로젝션에는 보이지
않는다.

Cafe24 admin API의 tombstone·`articles/count` 제공 여부는 **external-research 항목**이다. 저장소에
근거가 없고, 근거 없이 단정하지 않는다.

## 4. authoritative full snapshot인가 incremental인가 — **둘 다 아니다**

"고정된 과거 창의 재개 가능한 offset sweep"이다.
`GET /admin/boards/6/articles?start_date&end_date&limit&offset` — 정렬 파라미터를 보내지 않고, 응답
정렬 순서를 문서화한 근거가 저장소에 없다.

snapshot 자격을 깨는 것들:

- **`start_date`/`end_date` 의미가 계약이 아니라 doc-asserted이고, 이미 위반이 관측됐다** —
  `end_date` 이후의 `created_date`를 가진 게시글이 반환돼서 `withinWindow` 커넥터측 가드가 생겼다
  (`1bd1893b`). over-return은 확인됐고, under-return 하지 않는다는 것은 확인되지 않았다.
- **정렬 미상 + offset 페이징.** sweep 도중 삭제가 일어나면 뒤 페이지가 당겨져 한 행이 건너뛰어진다.
- **커넥터가 스스로 행을 버린다.** `article_no` 없는 행은 drop. REVIEW 경로는 비밀글까지 drop.
- **부분 실패가 조용히 끝난다.** 429나 페이지 오류는 커서를 그대로 두고 run을 종료한다.

INQUIRY 경로에 유리한 점 하나: `excludeSecret=false`이므로 board 6에서는 비밀글로 인한 거짓 absence는
없다.

## 5. absence를 삭제로 판정해도 안전한 조건

동시에 모두 성립할 때만:

1. 하나의 `sync_job`, 하나의 board, 하나의 닫힌 창, **offset 0부터 소진까지**
2. `status = SUCCESS`, rate-limited 아님, 페이지 오류 0, `MAX_PAGES` 가드 미도달
3. 그 run에서 `missingArticleNo = 0`, `excludeSecret` 미적용
4. 판정 대상은 **동일 창 안에 `received_at`이 있고 동일 board를 가리키는 `external_id`** 인 행으로 한정
5. **관측 수 하한 가드** — 저장 대비 관측이 급감하면 대량 삭제가 아니라 필터 고장으로 보고 fail closed
6. 판정 결과는 **비가역 삭제가 아니라 되돌릴 수 있는 상태 전이**

**6번을 지키는 한 5번이 틀려도 회복 가능하다.** absence 추론의 정확도를 올리는 것보다, 틀렸을 때
되돌릴 수 있게 만드는 쪽이 훨씬 싸고 확실하다.

이 조건 전체는 **현재 충족 불가능**하다. 자격 증명 복호화 실패로 sweep 자체가 불가능하고, 재연결은
셀러 동의 사항이다(`docs/sellerops_live_approval_contract.md`).

## 6. 현재 DB가 lifecycle/status/tombstone을 표현할 수 있는가 — **없다**

`inquiries`에 `source_state`도 `last_seen_at`도 `deleted_at`도 없다. `status`는
`UNANSWERED`/`ANSWERED` 2값이고 답변 여부만 뜻한다 — 여기에 `DELETED`를 섞으면 monotonic 규칙과
충돌한다.

이미 있는 것 두 가지는 그대로 쓸 수 있다: `inquiry_work_item.phase = DISMISSED` + `disposition`
(닫힌 enum · 감사 로그 · 승인 batch ledger), 그리고
`inquiry_work_item_dismissal_batch`(manifest hash · all-or-nothing · 500건 chunk · 멱등).

## 7. 최소 reconciliation 설계

**1단계 — 이미 내려진 판정을 read path가 존중하게 한다 (Cafe24 접속 불필요).** 소비자 5곳:

| 소비자 | 위치 | 당시 상태 |
|---|---|---|
| 홈 미답변 수 | `DashboardService:54` | 비밀글만 제외 |
| Today Inbox | `InboxService:58` | 아무 제외 없음 |
| 상품별 신호 | `ProductSignalsService` | 없음 |
| 반복 signature / topic | `CustomerMemoryEntryRepository:53,78` | 없음 |
| item analysis | `RuleBasedInboxItemAnalyzer:104,121` | 없음 |

work queue(`InquiryQueueService`)는 이미 phase 필터라 손댈 필요 없다.

**2단계 — source absence (Cafe24 재연결 필요, 별도 승인).** `last_seen_at` 추가 + no-op 경로에서도
갱신, 커서 lane 분리, 그리고 §5의 6개 조건을 만족한 sweep에 한해서만 전이.

**1단계 없이 2단계만 해도 목표는 달성되지 않고, 2단계 없이 1단계만 해도 목표는 달성된다.**

## 8. 기존 3,201행 복구 방법

- **3,199건** — work item이 `DISMISSED/SPAM`이고 승인 batch에 연결됨. **추론이 아니라 승인된 셀러
  판정의 backfill**이다. 이것이 이 복구가 안전한 이유다.
- **2건** (article 283/284) — 실제 문의. 283은 `COMPLETED`, 284는 `ACTION_PENDING`. 건드리지 않는다.
- customer memory 3,201건 — 제외 표시만, 삭제 없음.

`article_no` 범위도 이 판정을 뒷받침한다: 스팸 3,199건은 **289–3487** 연속 구간, 진짜 문의 2건은
**283–284**로 그 앞이다.

---

## 9. 확인하지 못한 것

- Cafe24 board articles의 **응답 정렬 순서** 및 `start_date`/`end_date`의 정확한 의미
- 삭제 게시글의 tombstone 또는 `articles/count` 제공 여부
- "제한/비노출" 상태를 나타내는 필드의 존재 여부

셋 다 라이브 관측이 필요하고, 현재는 자격 증명 복호화 실패로 불가능하다.
