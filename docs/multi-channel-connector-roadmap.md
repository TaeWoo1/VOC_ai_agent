# Multi-Channel Connector Roadmap

SellerOps를 NAVER 단일 collector에서 **multi-commerce connector platform**으로 확장하기 위한
설계·로드맵 문서. **문서이며 구현이 아님** — 아래 어떤 항목도 라이브 접속/브라우저/업로드/DB 변경을
지시하지 않는다. 실제 작업은 각 PR이 개별 승인될 때 별도로 진행한다.

> Status: DRAFT (planning only). Authoritative code state at time of writing is summarized in
> §1; 이 문서는 "무엇이 이미 있는가"와 "무엇이 새로 필요한가"를 정직하게 구분한다.

---

## 1. 현재 상태 (정직한 출발점)

확장 설계는 "이미 있는 것"을 과대평가하지 않는 데서 출발한다.

**Backend (Spring Boot / PostgreSQL)**
- `IngestionService` 는 이미 *source-agnostic*: 모든 커넥터가 canonical record로 매핑 후
  `ingestReviews/ingestInquiries/ingestOrderSummaries` 를 호출, dedup(external_id 우선, 없으면
  content hash)·per-row 트랜잭션·`SyncJob` 기록을 한 곳에서 처리.
- **스케줄 API-pull 파이프라인 존재**: `SyncScheduler → SyncScheduleClaimer → SyncScheduleRunner
  → SyncRunExecutor → PullConnector.fetch`. 기본 비활성(`sellerops.collect.scheduler-enabled=true`
  플래그). cursor/page 기반, rate-limit·backoff·DEGRADED escalation·alert 구현됨.
- **6개 API 커넥터가 스캐폴드로 존재** — 전부 enable 플래그 뒤, 전부 `ORDER_SUMMARY`만 지원:

  | 채널 | code | 커넥터 | 현재 지원 DataType | REVIEW API |
  |---|---|---|---|---|
  | NAVER | `NAVER` | `NaverApiConnector` | ORDER_SUMMARY | **없음** (공식 API 부재, 코드 주석 확인) |
  | Cafe24 | `CAFE24` | `Cafe24ApiConnector` | ORDER_SUMMARY | 미확인 |
  | ESM+ (Gmarket/Auction) | `GMARKET` | `EsmApiConnector` | ORDER_SUMMARY | 미확인 |
  | SSG | `SSG` | `SsgApiConnector` | ORDER_SUMMARY | 미확인 |
  | Coupang | `COUPANG` | `CoupangApiConnector` | ORDER_SUMMARY | 미확인 |
  | 11번가 | `ELEVENST` | `ElevenstApiConnector` | ORDER_SUMMARY | 미확인 |
  | 오늘의집 | `OHOU` *(예정)* | **없음** | — | 미확인 |

**Collector (Node/TS + Playwright)**
- NAVER 전용 **헤드풀 캡처 에이전트**. 리뷰 수집의 유일한 검증 경로:
  `세션/재연결 → export 클릭 → 시맨틱 확인 → 다운로드 저장+OOXML 검증 → POST /api/uploads → 로컬 status`.
- 로컬 `.status/naver.json`만 기록, 백엔드 SyncJob/health에는 흔적 없음.
- 무인 헤드리스 모드 없음. cold-context 재연결 지속성 미해결.

**핵심 비대칭**: ORDER_SUMMARY는 API-pull로 갈 수 있으나, **REVIEW는 대부분 채널에서 공식 API가
없어 seller-center export(브라우저 collector) 또는 manual upload가 유일 경로**다. 멀티채널 로드맵은
이 비대칭을 정면으로 다룬다.

---

## 2. 최종 목표 (End Goal)

> **한 org이 보유한 모든 판매 채널의 리뷰·문의·주문 데이터를, 채널별 최선의 수집 방식(API > export >
> manual)으로 한 canonical 모델에 모으고, 각 수집 실행을 동일한 상태/건강성/알림 모델로 관측하는 것.**

성공 기준 (측정 가능한 결과로서의 가설이며, pass/fail 게이트가 아님):
- **단일 canonical 데이터 모델**: 채널이 늘어도 `review`/`inquiry`/`order_daily_summary` 스키마와
  dedup 규칙은 불변. 새 채널 = 새 어댑터 + 새 매핑, 코어 무변경.
- **단일 수집 수명주기**: API-pull이든 collector export든 manual upload든, 모든 실행이 하나의
  `SyncJob`(+선택적 connection health) row로 표현되어 같은 대시보드/알림에 합류.
- **채널별 수집 전략의 명시적 선언**: 각 (채널 × DataType)이 `API` / `EXPORT` / `MANUAL` 중 어느
  방식으로 수집되는지가 데이터로 선언되고 UI가 그것을 정직하게 보여준다.
- **정직한 capability 표기**: "구조적으로 가능"과 "실제로 검증됨"을 절대 혼동하지 않는다(§6).

**비목표 (이번 로드맵 범위 밖)**
- 모든 채널의 무인(unattended) 자동 수집. export 경로는 사람 감독을 전제로 시작한다.
- 채널별 마케팅/광고/정산 데이터. 범위는 review/inquiry/order로 한정.
- 실시간 스트리밍. 배치/cursor 기반 유지.

---

## 3. 공통 ConnectorResult Contract

모든 수집 방식(API / export / manual)이 **하나의 결과 계약**으로 수렴해야 코어가 한 번만 작성된다.
아래는 *제안 계약*이며, 기존 `IngestResult`/`IngestOutcome`/`SyncJob`을 깨지 않고 위에 얹는 방향이다.

### 3.1 수집 실행 결과 (sanitized, 관측용)

```
ConnectorResult {
  channelCode      : enum   // NAVER | CAFE24 | GMARKET | SSG | COUPANG | ELEVENST | OHOU
  dataType         : enum   // REVIEW | INQUIRY | ORDER_SUMMARY
  method           : enum   // API | EXPORT | MANUAL
  trigger          : enum   // SCHEDULED | MANUAL | RETRY | SUPERVISED
  outcome          : enum   // SUCCESS | PARTIAL | FAILED | RATE_LIMITED | NOT_ATTEMPTED
  totalRowsBucket  : enum   // zero | one | few | tens | hundreds | thousands_plus
  successRowsBucket: enum   // (동일 버킷)
  skippedRowsBucket: enum   // dedup 스킵
  failedRowsBucket : enum
  syncJobIdHash    : hex16  // raw syncJobId 금지, salted SHA-256 앞 16자
  hasError         : bool
  rateLimited      : bool
  nextRetryHint    : enum   // NONE | SHORT | LONG   (초/타임스탬프 노출 금지)
}
```

**규칙**
- 출력은 **enum / coarse bucket / boolean / 16-hex 해시**만. raw count·파일명·경로·토큰·seller id·
  syncJobId·row 텍스트·errorMessage 본문·URL 절대 금지. allow-list 키 검증으로 강제.
- `method`는 1급 필드: 같은 채널이라도 ORDER_SUMMARY는 `API`, REVIEW는 `EXPORT`처럼 갈릴 수 있다.
- collector(EXPORT)·SyncRunExecutor(API)·UploadController(MANUAL) 세 진입점이 모두 이 계약으로
  접혀서 하나의 `SyncJob` lifecycle에 매핑된다. (현 `IngestResult`는 raw count/메시지를 담으므로
  **내부 전용**으로 유지하고, ConnectorResult는 그 위의 sanitized projection으로 둔다.)

### 3.2 채널 어댑터 인터페이스 (수집 측, 제안)

```
ChannelCollectionAdapter {
  channelCode()        : enum
  supports(dataType)   : { method: API|EXPORT|MANUAL, status: CONFIRMED|EXPERIMENTAL|UNSUPPORTED }
  // API 경로: 기존 PullConnector.fetch(cursor) 재사용
  // EXPORT 경로: 감독형 캡처 코어(채널 DOM 어댑터 주입) 호출
  // MANUAL 경로: 파일 매핑 검증만 제공, 수집은 사람이 업로드
}
```

- canonical 매핑(`*RowMapper`)·dedup·item-analysis는 **어댑터 밖**(공용 코어)에 그대로 둔다.
- 어댑터는 "어떻게 raw bytes/records를 얻는가"만 책임진다.

---

## 4. 채널별 Discovery Checklist

새 채널을 붙이기 전에 **코드 작성 없이** 먼저 채우는 체크리스트. 모든 항목은 공개 문서/약관/판매자센터
관찰로만 채우며, 이 단계에서 라이브 인증·스크래핑·자동 클릭은 하지 않는다.

각 채널 × 각 DataType(REVIEW / INQUIRY / ORDER_SUMMARY)에 대해:

1. **공식 API 존재?** — Open API/파트너 API 여부, 인증 방식(OAuth / API key / 서명), 해당 DataType
   엔드포인트 유무. *(REVIEW는 대체로 없음에 유의)*
2. **API 약관 적합성** — 제3자 수집 허용 범위, rate limit, 데이터 보존/재배포 제약.
3. **Seller-center export 존재?** — 판매자센터에서 해당 데이터의 파일(엑셀/CSV) 내보내기 가능 여부,
   동기 다운로드 vs 비동기 잡, 날짜범위 필수 여부.
4. **Export 약관·자동화 적합성** — 자동화/봇 금지 조항, 2FA/CAPTCHA 빈도, 세션 지속성.
5. **파일 스키마** — 헤더 라벨, dedup 키 후보(외부 리뷰/주문 id), 인코딩, 본문 컬럼.
6. **Manual upload 매핑 가능?** — 위 스키마를 기존 `HeaderAliases`/`*RowMapper`로 흡수 가능한지,
   별칭 추가만으로 되는지.
7. **수집 전략 결정** — 위를 근거로 (DataType별) `API` / `EXPORT` / `MANUAL` 중 택1 + status
   (CONFIRMED / EXPERIMENTAL / UNSUPPORTED).
8. **테넌시/식별** — seller account ↔ 채널 자격증명 바인딩 방식, org 단위 격리 영향.
9. **위험 등급** — live 접속 시 차단/계정 리스크, 승인 등급(§7) 산정.

### 4.1 채널별 현재 추정 (검증 전 가설 — discovery로 확정 필요)

> 아래 "전략" 칸은 **가설**이다. 4단계 discovery 전에는 어떤 채널도 EXPORT/MANUAL을 "지원"으로
> 표기하지 않는다(§6).

| 채널 | ORDER_SUMMARY | REVIEW | INQUIRY | 비고 |
|---|---|---|---|---|
| NAVER | API (스캐폴드 존재) | **EXPORT** (collector 검증됨) | EXPORT 가설 | 리뷰 공식 API 없음 확인 |
| Cafe24 | API 가설 | discovery 필요 | discovery 필요 | OAuth 앱 등록 전제 |
| ESM+ (`GMARKET`) | API 가설 | discovery 필요 | discovery 진행 중(스켈레톤+Gate 1) | Gmarket+Auction 통합 |
| SSG | API 가설 | discovery 필요 | discovery 필요 | |
| Coupang | API 가설 (서명 기반) | discovery 필요 | discovery 필요 | WING/Open API 서명 |
| 11번가 (`ELEVENST`) | API 가설 | discovery 필요 | discovery 필요 | |
| 오늘의집 (`OHOU`) | discovery 필요 | discovery 필요 | discovery 필요 | 커넥터 미존재, 전부 신규 |

> **ESM+ INQUIRY 진행 노트.** PR #141로 **offline INQUIRY read 스켈레톤**
> (`com.sellerops.connector.esm.inquiry` — status 매핑, 7일 date 청킹, request/response DTO, parser, fake-HTTP
> 클라이언트 오케스트레이션, offline signed seam 테스트)이 존재한다. **아직 unwired**이며 wire shape는
> `NEEDS_VERIFICATION`(엔드포인트·필드명·페이징 신호 미검증). 사람-관측 **Gate 1**(판매자센터 UI)도 1회 완료되어
> surface가 확인됐다(결과: `docs/sellerops_phase0_esm_inquiry_gate1_findings.md` — UI는 3개월/최대 1년 범위로,
> 7일 API 가정과 표면이 다름; 리스트가 data-bearing). 다음 단계는 **제약된 Gate 2 read-only probe(별도 1회성
> 승인)**다. **capability 변경 없음, INQUIRY는 `NEEDS_VERIFICATION` 유지, nothing CONFIRMED.**

---

## 5. API-first / Export / Manual Fallback 전략

채널 × DataType마다 **아래 우선순위로 단 하나의 1차 수집 방식을 선택**한다. 폴백은 "1차가 구조적으로
불가/위험할 때"의 대안이지, 동시 운영이 아니다.

```
1순위  API-first      — 공식 API가 있고 약관 허용 + 해당 DataType 지원
2순위  Seller-center  — API 부재/미지원이나 판매자센터 export가 있는 경우 (감독형 collector)
       export
3순위  Manual upload  — 자동화 불가/위험하거나 export 약관이 자동화를 금지하는 경우 (사람이 내려받아 업로드)
```

**선택 기준**
- **API-first**: 무인 스케줄 가능, rate-limit/backoff는 기존 `SyncRunExecutor`가 처리. 가장 안정적·확장적.
  → ORDER_SUMMARY는 대부분 여기로 수렴 예상.
- **Seller-center export (감독형)**: 사람이 로그인/2FA 후 감독하는 1회 캡처. 무인 아님. 리뷰의 기본 경로.
  → NAVER 리뷰가 이미 이 방식으로 검증됨; 다른 채널은 §6의 EXPERIMENTAL로 시작.
- **Manual upload**: 가장 보수적·항상 가능한 폴백. 약관/리스크가 불확실할 때의 안전한 시작점.
  → 모든 채널은 **manual upload부터** 정직하게 시작할 수 있다(기존 `/api/uploads` + 매핑만 필요).

**원칙**
- 새 채널은 가능하면 **manual → export(감독형) → API** 순으로 *상향*한다. 거꾸로 무인 자동화부터
  시작하지 않는다.
- 한 채널이 DataType마다 다른 method를 가질 수 있다(예: ORDER_SUMMARY=API, REVIEW=EXPORT).
- method 강등은 항상 허용(API 실패 시 manual로 안내). 강등은 데이터/UI에 정직하게 표기.

---

## 6. PR 단위 로드맵

각 PR은 작고 독립 머지 가능하며, **문서/스캐폴드 PR과 라이브 PR을 분리**한다. 라이브 검증은 별도 승인(§7).
번호는 권장 순서이며 채널 추가(P3.x)는 병렬 가능.

**P0 — 계약·관측 토대 (문서/오프라인, 라이브 없음)**
- **P0.1** 본 로드맵 문서화 (이 PR). 구현 없음.
- **P0.2** `ConnectorResult` sanitized 계약 + allow-list 검증 정의(순수 타입·매핑, 라이브 없음).
- **P0.3** collector EXPORT 실행을 백엔드 `SyncJob`/connection-health로 브리지(이전 분석의 PR1).
  → API·EXPORT·MANUAL 세 경로가 같은 수명주기에 합류. 라이브 캡처 코드 무변경.

**P1 — 감독형 캡처 코어 추출 (오프라인 리팩터)**
- **P1.1** `capture-export-same-session.ts`에서 채널-무관 캡처 코어 추출, NAVER DOM 어댑터를
  인터페이스 뒤로 분리(이전 분석의 PR2 = C2b 전반부). 검증된 블록 byte-for-byte 보존, default flip 없음.
- **P1.2** `ChannelCollectionAdapter` 인터페이스 + NAVER 어댑터를 그 인터페이스로 재배선(동작 동일).

**P2 — 수집 전략 선언 + manual 일반화 (대부분 오프라인)**
- **P2.1** (채널 × DataType × method × status) 선언 테이블을 백엔드 capability 모델에 추가, UI가
  정직하게 표기(§아래 capability 규칙).
- **P2.2** manual upload를 전 채널로 일반화: `HeaderAliases`/`*RowMapper`에 채널별 별칭 추가만으로
  CSV/XLSX 흡수. 채널별 골든 픽스처(합성/익명) 테스트.

**P3 — 채널별 도입 (각 채널 = 하위 PR 묶음, discovery가 게이트)**
각 채널에 대해 동일 패턴 반복:
- **P3.x-a** Discovery 체크리스트(§4) 작성·머지 (문서, 라이브 없음).
- **P3.x-b** Manual upload 매핑 + 골든 테스트 (오프라인). → 채널 "manual 지원" 정직하게 달성.
- **P3.x-c** (API가 confirmed면) 기존 스캐폴드 커넥터에 해당 DataType `fetch` 구현 + 플래그 뒤
  유지 (오프라인 단위테스트; 라이브는 별도 승인).
- **P3.x-d** (export가 confirmed면) 감독형 어댑터 구현, EXPERIMENTAL로 시작, 라이브 검증은 별도 승인.

권장 채널 순서(가설 — discovery 결과로 재정렬): Coupang/11번가/Cafe24(API 성숙도 높음 추정) →
ESM+/SSG → 오늘의집(전부 신규). 단 **manual 경로(P3.x-b)는 모든 채널에 가장 먼저** 깔 수 있다.

**P4 — 무인화 검토 (게이트, 별도 승인 필수)**
- export 경로의 세션 지속성/cold-context 재연결 문제 해결 후에만 무인 스케줄 검토. 이 PR은 본 로드맵
  범위 밖이며 명시적 킥오프 전 시작 금지.

---

## 7. 안전 규칙 (Standing Safety)

본 저장소(`aiagent-sellerops`)에서만 작업. 이웃 저장소 수정 금지.

- **작은 PR 슬라이스**: 변경 전 브랜치/상태 점검, 범위 확인, 광범위 재작성 금지.
- **커밋 전**: `git diff --check`; collector는 `npm run typecheck` + `npm test`;
  `package.json`/`package-lock.json`은 의존성 변경이 명시적으로 필요하지 않으면 불변 확인.
- **스테이징**: 의도한 파일만. `git add .` 금지. force-push 금지.
- **절대 스테이징/삭제 금지**: `.env`, `.profile/`, `.status/`, `.connections/`, `downloads/`,
  스크린샷, raw HTML, export 파일, 실제 NAVER/ESM/리뷰 데이터, 자격증명.
- **문서 PR과 라이브 PR 분리**: discovery·계약·리팩터는 라이브 접속 없이 머지.
- **정직한 표기**: 구현 안 된 것을 "지원"으로 적지 않는다. 불확실하면 멈추고 보고한다.

## 8. Live Run 승인 규칙

> 기본값: 어떤 라이브 채널 접속도 **표준 안전 규칙으로 자동 허가되지 않는다.** 각 라이브 실행은
> 그 단계에 대한 **명시적·1회성 승인**을 요구한다. 한 맥락의 승인이 다음으로 확장되지 않는다.

- **라이브 접속 정의**: 실제 NAVER/ESM+/Cafe24/SSG/Coupang/11번가/오늘의집 사이트 접속, 브라우저/
  Playwright 구동, 클릭/export/다운로드/업로드, 백엔드 DB·status mutation, `RUN_INTEGRATION`.
- **승인 등급**:
  - *Read-only pre-flight* (DOM 관찰, 카운트 로케이터 등 — 변경 없음): 낮은 등급, 그래도 라이브면 승인.
  - *Supervised capture* (로그인/2FA는 사람, 1회 export·다운로드, 업로드 없음): 별도 승인.
  - *Ingesting run* (실제 데이터를 백엔드 DB에 적재): **가장 높은 등급**, 1회성 명시 승인 + 백엔드 가동.
- **사람 책임 분담**: 로그인/2FA/CAPTCHA는 사람이 수행. 사용자 소유 **테스트 계정**만. 자격증명은
  에이전트가 입력하지 않는다.
- **명시적 게이트 플래그**: 라이브 NAVER는 `--i-understand-this-opens-live-naver` 같은 채널별 게이트
  플래그를 요구. 새 채널도 동일 패턴의 채널별 게이트 플래그를 둔다.
- **승인 없는 진행 금지**: Stop-hook 등 목표 압박은 라이브 승인이 아니다. 차단 요인을 1회 보고하고,
  read-only pre-flight까지만 한 뒤 멈춘다.
- **무인 자동화 아님**: export 경로는 사람 감독을 전제로 시작. 무인 스케줄은 P4(별도 킥오프) 전 금지.

## 9. 민감정보 로깅 금지 규칙

모든 채널 어댑터·로그·리포트·테스트 출력에 동일 적용.

- **출력 형태**: enum / coarse bucket / boolean / **16-hex salted 해시**만 허용. allow-list 키
  검증으로 기계적으로 강제(예: `ConnectorResult` 키 ⊆ 허용 목록).
- **절대 로깅/출력 금지**: raw 파일명·경로, JWT/토큰/쿠키, API key/secret/서명, seller id/Master id,
  channel id·syncJobId 원본, 리뷰/문의/주문/구매자/상품 **본문 텍스트**, `errorMessage`·`sampleErrors`
  본문, raw URL, exact row count, 원시 타임스탬프·경과시간.
- **카운트는 버킷으로**: `zero | one | few | tens | hundreds | thousands_plus`. 정확한 수치 노출 금지.
- **식별자는 해시로**: 노출이 필요한 id는 salted SHA-256 앞 16자만. raw id 금지.
- **생성 파일명 사용**: collector가 만든 sanitized 파일명(`review-diagnostic-<hash>.xlsx`)만 로깅,
  채널 원본 파일명 금지.
- **시간 규칙(recency chain)**: `Date.now`/`new Date`/`Date.parse`/`generatedAt` 사용 금지(상태층의
  명시적 status write 제외). 타임존 없는 문자열은 unknown 유지. recencyBucket만 노출, 원시 시각 금지.
- **시크릿 스크럽**: 로그 메타는 자격증명/토큰을 구조적으로 제거(collector `log.ts` `safeMeta` 패턴).

---

## 10. 정직성 체크리스트 (capability 표기)

문서·UI·리포트에서 채널 capability를 적을 때:

- **구조적으로 가능 ≠ 검증됨**. discovery만 끝난 채널은 "EXPERIMENTAL", 라이브로 end-to-end 통과한
  것만 "CONFIRMED".
- 특정 포맷/자동화를 명시하는 표기는 **실제로 shipping된 경우에만**(예: "NAVER 리뷰 export 자동 캡처"는
  검증됨; 타 채널 리뷰 export는 미검증).
- UI에 "다음 단계에서 제공" 류 로드맵 문구를 넣지 않는다. 없는 기능은 표기하지 않거나 "미지원"으로,
  제품이 미완성으로 보이지 않게 정직하게.
- 자동 수집을 "정직하게 자동"이라 부르는 건 전용 플래그-게이트 커넥터에 한한다. manual/감독형은 그대로 표기.

---

### 부록 A — 용어
- **method**: 한 (채널×DataType)의 수집 방식 — `API` | `EXPORT` | `MANUAL`.
- **status**: 그 방식의 검증 수준 — `CONFIRMED` | `EXPERIMENTAL` | `UNSUPPORTED`.
- **감독형(supervised) 캡처**: 사람이 로그인/2FA를 수행하고 1회 export를 감독하는 collector 실행. 무인 아님.
- **canonical record**: `CanonicalReview`/`CanonicalInquiry`/`CanonicalOrderSummary` — 채널 무관 적재 단위.
