# Multi-Channel Connector Roadmap

SellerOps를 NAVER 단일 collector에서 **multi-commerce connector platform**으로 확장하기 위한
설계·로드맵 문서. **문서이며 구현이 아님** — 아래 어떤 항목도 라이브 접속/브라우저/업로드/DB 변경을
지시하지 않는다. 실제 작업은 각 PR이 개별 승인될 때 별도로 진행한다.

> Status: **LIVING / CANONICAL (capability truth).** 본 문서의 §4.1 현행표가
> (채널 × DataType × method × 상태)의 **유일한 현행 선언**이다. 다른 문서(제품 범위,
> 프론트 스펙, CEO 원페이저, 페이즈 기록)는 채널 capability를 중복 서술하지 않고 이 표를
> 참조한다. UI의 셀러 표기 문구도 이 표의 "셀러 표기" 열을 따른다.
>
> 변경 이력:
> - 2026-08-19 — **§4.1 Coupang ORDER_SUMMARY 행 정정 (구현됨 ❌→✅ · 라이브 검증 ❌→✅ 2026-08-06)** 및 §1 커넥터
>   상태표의 "인증 골격만(capability 빈 집합)" 문구 철회. 이 행은 코드와 라이브 증거가 이미 반증하고 있었다:
>   `CoupangApiConnector.capabilities()`가 `{ORDER_SUMMARY, INQUIRY}`를 둘 다 `CONFIRMED`로 반환하고,
>   `CoupangOrdersClient`(657줄)는 실제 v5 `ordersheets` 일자 페이징을 구현하고 있으며,
>   `docs/coupang_final_main_first_connection_order_routine_proof_v1.md`가 2026-08-06 `main` `59c2e6c`에서
>   첫 연결·첫 수집·멱등 재수집을 승인 `apr-01212e2da29a`로 라이브 증명했다. 이 행이 인용하던 증거
>   (`docs/sellerops_phase3d_completion_summary.md` §3)는 **archive된 페이즈 문서**였고, 그 사이 갱신되지 않았다.
>   원인은 증거 문서가 어떤 정본에서도 링크되지 않은 채 남아 있었던 것 — 재발 방지로 `docs/evidence/INDEX.md` 신설.
>   **운영 지원(❌)과 셀러 표기(표기하지 않음)는 바뀌지 않았다** — 그 승격은 제품 오너 결정이며 이 정정의 범위가 아니다.
> - 2026-07-26 (같은 날 2차) — §4.1 초기 리뷰 연동 노트만 **갱신**. 표의 어떤 열도 갱신하지 않음. 한 구간이 끝난 뒤
>   **SmartStore 화면의 패널에서 다음 구간을 이어서 시작**할 수 있게 했다(다음 구간·남은 개수 표시,
>   구간마다 서버가 새 일회용 티켓 발급, Bridge·에이전트 연결 재사용). **티켓 발급 권한 경로는 바뀌지 않았다**:
>   백엔드만 발급하고 프론트만 요청할 수 있으며, 로컬 에이전트에는 발급 경로가 없다 — 패널의 누름은
>   `aw_guidance_intent`로 프론트에 **요청**으로 전달된다. **이 경로는 오프라인(실소켓) 증명만 있고
>   라이브 실행은 아직 없다.** 근거: `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md`
>   (Addendum 5). **운영 지원·셀러 표기 변경 없음.**
> - 2026-07-26 — §4.1 초기 리뷰 연동 노트만 **갱신**. 표의 어떤 열도 갱신하지 않음. 여정을 재설계하고
>   **같은 날 1구간 라이브로 실행**했다(1계정·1구간·일회용 로컬 백엔드, 신규 62건). **기간 탐색(DISCOVERY)
>   실행은 폐기**됐고(마켓 한계가 존재하지 않음이 2026-07-25 라이브에서 확인됨), 기간은 셀러가 SellerOps에서
>   직접 고른다(`range_evidence = OPERATOR_SELECTED`, 마켓플레이스 창 없음). 안내는 SmartStore 화면 안
>   패널로 이동했고 **그 경로도 1회 라이브 실행됨** — 다만 라이브에서 범위 게이트가 한 번에 통과했으므로
>   **패널의 차단 표시(원인·수정·재검사)는 여전히 오프라인 증명뿐**이다. 근거:
>   `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md` (Addendum 3·4).
>   **운영 지원·셀러 표기 변경 없음.**
> - 2026-07-25 — §4.1에 **초기 리뷰 연동(가이드형 세그먼트 import) 노트만 추가·갱신**. 표의 어떤 열도
>   갱신하지 않음: 세그먼트 실행·기간 탐색·셀러 CTA 경로가 각각 1회 라이브 실행됐을 뿐이며(1계정·1구간·
>   일회용 로컬 백엔드), 페어링 승인 통제는 아직 미검증이다. 근거:
>   `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md` (Addendum 2).
>   **운영 지원·셀러 표기 변경 없음.**
> - 2026-07-15 — **NAVER REVIEW 라이브 검증 상태만 갱신**(§4.1 현행표 · §1 collector 서술 · §5.1 범위
>   한정). 근거: Run 4 (`docs/action-window-runtime/r4-evidence-pack.md` §8-17) — export→ingest
>   end-to-end 실행. **운영 지원 단계·셀러 표기 변경 없음**; 그 외 채널·항목은 이전 기준 유지.
> - 2026-07-08 — §5.1(**Action Window = 기본 production 리뷰 수집 모드**)·§5.2(**채널별 연결 결정**
>   NAVER/Cafe24/Coupang/11번가/ESM+/SSG/오늘의집)·§6(개발 시퀀스) 신설, §11.5(사용자 대면 자율 모드
>   ↔ 방식/연결 모드 매핑) 추가. 진실 원천은 여전히 §4.1; 파생 뷰는 `docs/channel-capability-registration-matrix.md`.
> - 2026-07-07 — §1/§4.1/§5/부록 A 갱신(NAVER·Cafe24 라이브 검증 반영, 수집 전략
>   교정 — 브라우저 자동화를 보편적 최후수단으로 규정하던 표현 폐기, 4단계 상태 모델 도입).

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
- **API 커넥터 상태** (2026-07-07 갱신 — 상세·증거는 §4.1 현행표가 정본):

  | 채널 | code | 커넥터 | 수집 구현 상태 |
  |---|---|---|---|
  | NAVER | `NAVER` | `NaverApiConnector` | ORDER_SUMMARY **구현 + 라이브 1회 검증**(2026-06-14, `docs/sellerops_phase3c_live_smoke.md` §0). REVIEW 공식 API **없음**(코드 주석 확인) |
  | Cafe24 | `CAFE24` | `Cafe24ApiConnector` | ORDER_SUMMARY **구현 + 라이브 E2E PASS**(`docs/sellerops_cafe24_live_verification.md`). 게시판(리뷰/문의) discovery **CONFIRMED**(`docs/sellerops_cafe24_community_board_discovery.md`), 아티클 저장 기반 머지(캡처 미실행). OAuth 온보딩(`/api/connect/cafe24`) 구현 |
  | ESM+ (Gmarket/Auction) | `GMARKET` | `EsmApiConnector` | 인증 골격 + **INQUIRY 오프라인 read 스켈레톤**(unwired, `NEEDS_VERIFICATION`) + INQUIRY **Excel 임포트 백엔드** 구현(FE 미노출) |
  | SSG | `SSG` | `SsgApiConnector` | 인증 골격만(capability 빈 집합) |
  | Coupang | `COUPANG` | `CoupangApiConnector` | ORDER_SUMMARY **구현 + 라이브 1회 검증**(2026-08-06, `docs/coupang_final_main_first_connection_order_routine_proof_v1.md`). INQUIRY **구현 + 라이브 검증**(2026-08-14). REVIEW 공식 API **없음**. 상태 정본은 §4.1 |
  | 11번가 | `ELEVENST` | `ElevenstApiConnector` | 인증 골격만(capability 빈 집합) |
  | 오늘의집 | `OHOU` *(예정)* | **없음** | 커넥터 없음(파트너 제한 API) |

**Collector (Node/TS + Playwright)**
- NAVER 전용 **헤드풀 캡처 에이전트**. 리뷰 수집의 유일한 검증 경로:
  `세션/재연결 → export 클릭 → 시맨틱 확인 → 다운로드 저장+OOXML 검증 → POST /api/uploads → 로컬 status`.
  감독형 캡처→다운로드 저장까지 라이브 검증됨(2026-06-22 트랙 기록); **백엔드 자동 업로드 브리지 포함
  export→ingest 전 구간도 라이브 검증됨**(2026-07-15, Run 4 — 감독형·개발셀러·**로컬 dev 백엔드**,
  프로덕션 아님. 근거: `docs/action-window-runtime/r4-evidence-pack.md` §8-17). 상태 정본은 §4.1.
- 로컬 `.status/naver.json`만 기록, 백엔드 SyncJob/health에는 흔적 없음.
- 무인 헤드리스 모드 없음. cold-context 재연결 지속성 미해결(ESM도 동일 — `docs/esm/decisions.md` D8).
- ESM+(Gmarket/Auction) 리뷰 표면은 마켓 선택 탭까지 확인(2026-07-07, `docs/esm/live-capture-plan.md`);
  캡처는 미실행.

**Frontend**
- 주요 화면은 fail-closed strict 읽기(`frontend/src/lib/apiClient.ts`의 `*Strict` 계열)로 전환됨.
  조용한 mock 폴백(`getOrMock`)은 채널 카탈로그·스케줄 등 일부에만 잔존하며, 제품 방향상
  mock은 명시적 데모 모드로만 분리한다(`docs/sellerops_frontend_spec.md` 참조).

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

### 4.1 채널 × DataType 현행표 (LIVING — capability 진실의 정본)

> 이 표가 **현행 선언**이다. 상태가 바뀌면(새 검증, 새 구현) 이 표를 갱신하고 증거 문서를
> 링크한다. UI·다른 문서는 이 표를 참조하며 중복 선언하지 않는다. 상태 4단계의 정의는
> 부록 A를 따른다: **연결 가능 → 구현됨 → 라이브 검증 → 운영 지원**.

*갱신: 2026-08-19 (Coupang ORDER_SUMMARY 구현됨·라이브 검증 열 정정 — 위 변경 이력 참조); 2026-07-31 (Cafe24 REVIEW 라이브 검증 열 — PR #375, 2026-07-30; Cafe24 INQUIRY 라이브 검증 열 — PR #382, 2026-07-31; NAVER REVIEW — 2026-07-15; 그 외 행·열은 2026-07-07 기준). 스냅샷 기준선: `docs/sellerops_completion_checkpoint_v1.md`(`026c113`).*

| 채널 | DataType | 방식(method) | 연결 가능 | 구현됨 | 라이브 검증 | 운영 지원 | 증거 | 셀러 표기 |
|---|---|---|---|---|---|---|---|---|
| **공통(전 채널)** | REVIEW·INQUIRY·ORDER_SUMMARY | MANUAL(파일 업로드) | ✅ | ✅ | ✅ (E2E 스모크) | **✅** | `docs/sellerops_phase2.md` §Smoke | "엑셀 업로드 지원 (양식 채널별 확인 필요)" |
| NAVER | ORDER_SUMMARY | API | ✅ 키 등록 폼 | ✅ | ✅ 1회 (2026-06-14) | ❌ (플래그 off, 스케줄 off) | `docs/sellerops_phase3c_live_smoke.md` §0 | "자동 수집 지원: 주문" |
| NAVER | REVIEW | EXPORT(감독형) + MANUAL | — (브라우저 세션) | ✅ collector | ✅ 캡처→저장 (2026-06-22); **export→ingest end-to-end 라이브 검증 (2026-07-15, Run 4 — 감독형·개발셀러·로컬 dev 백엔드)** | ❌ | `collector/README.md`, collector 트랙 기록, `docs/action-window-runtime/r4-evidence-pack.md` §8-17 | "네이버 리뷰 export 업로드 지원" |
| NAVER | INQUIRY | 미확정 | — | ❌ | ❌ | ❌ | — | 표기하지 않음 (MANUAL만) |
| Cafe24 | ORDER_SUMMARY | API(OAuth) | ✅ OAuth 연결 플로우 (FE `/connect/cafe24`) | ✅ | ✅ E2E PASS (토큰 회전·금액 대사 포함) | ❌ (플래그 off) | `docs/sellerops_cafe24_live_verification.md` | "자동 수집 지원: 주문·매출" |
| Cafe24 | REVIEW | API(게시판 4 구매후기) | ✅ (동일 OAuth) | ✅ (CanonicalCommunityArticle + 비밀글 fail-closed 제외) | ✅ 아티클 캡처 라이브 검증 (2026-07-30, PR #375 — 공개 리뷰 fresh insert + 동일창 replay 멱등; reply_status는 **UNKNOWN만 라이브 관측**(raw가 N/P/C 아님 → fail-closed; 사전 기대 PENDING 철회). N/P/C 토큰은 tests-only; **완료 v1 (2026-07-31, PR pending — raw_received·저장·비밀글제외·창밖제외·식별번호없음·reply_status 분포 sanitized 계측 + 동일창 멱등 replay(행 불변·커서 안정) 라이브 재확인·Attention/VOC 노출 NEW_REVIEW=1)**; 비밀글 제외 count는 이 window에 비밀글 부재로 tests-only 유지) | ❌ (플래그 off) | `docs/sellerops_cafe24_review_acquisition_completion_live_proof.md` | "카페24 구매후기 수집 지원" |
| Cafe24 | INQUIRY | API(게시판 6 문의사항) | ✅ (동일 OAuth) | ✅ (CanonicalInquiry → 문의 + OPEN 작업항목; source-aware upsert + is_secret V34; board 9 미수집) | ✅ board-6 라이브 검증 (2026-07-31, PR #382 — 현행 작업큐 sink, exact-window 계약: in-window 1건 emit·out-of-window pre-mapper 제외·C→ANSWERED·is_secret=true·secret 경계(Inbox 포함/Dashboard·analysis 제외)·멱등 replay). public/N/P/UNKNOWN 토큰·N→C 전이는 tests-only | ❌ (플래그 off) | `docs/sellerops_cafe24_inquiry_read_live_proof.md` | 라이브 검증됨(운영 지원 아님) — "지원" 표기 금지 |
| ESM+ (`GMARKET`) | ORDER_SUMMARY | API | ✅ 키 등록 폼 | ❌ (인증 골격만) | ❌ | ❌ | `docs/sellerops_phase3d_completion_summary.md` §3 | 표기하지 않음 |
| ESM+ (`GMARKET`) | INQUIRY | API(스켈레톤) + MANUAL(Excel 임포트) | ✅ | 부분 — read 스켈레톤 unwired(`NEEDS_VERIFICATION`) + Excel 임포트 백엔드(FE 미노출) | Gate 1 표면 확인만; API probe ❌ | ❌ | `docs/sellerops_phase0_esm_inquiry_gate1_findings.md` | 검증 전 — 표기 금지 |
| ESM+ (`GMARKET`/`AUCTION`) | REVIEW | EXPORT(감독형) 후보 | — | ❌ | 표면(마켓 탭)만 확인 (2026-07-07) | ❌ | `docs/esm/live-capture-plan.md` | 표기하지 않음 |
| Coupang | ORDER_SUMMARY | API(HMAC) | ✅ 키 등록 폼 | ✅ 커넥터 + 공식 v5 `ordersheets` 일자 페이징(`nextToken`·상태별 sweep·`shipmentBoxId` 중복제거) + 공용 ingest | ✅ **라이브 검증 (2026-08-06)** — 첫 연결 → 첫 ORDER_SUMMARY 수집 → `PREPARING→CONNECTED` → 동일 창 멱등 재수집 | ❌ (플래그 off, 스케줄 off) | `docs/coupang_final_main_first_connection_order_routine_proof_v1.md` (승인 `apr-01212e2da29a`, `main` `59c2e6c`, preflight 9/9) | 표기하지 않음 |
| Coupang | REVIEW | 공식 API **없음** — 2026-08-14 재확인(문서 카테고리 11개 전수, 리뷰 엔드포인트 부재). 공식 export 없음·판매자 답글 기능 없음(operator 확인) ⇒ **수집+분석 전용, 답변 채널 아님**. 후보는 seller-owned WING 화면 READ_ONLY뿐. READ_ONLY 3회로 구조 확정(리뷰 1건 = `<tbody>`, `노출상품ID (옵션ID)` 컬럼 앵커, 리뷰별 10자리 식별자 coverage **7/10**) ⇒ **TECHNICALLY_POSSIBLE = CONDITIONAL_YES**, **POLICY = UNCLEAR**(§14 원문 확인 완료 2026-08-14 — 31개 항 전부 판매행위 규율, 자동화 조항 **부재**. 실제 노출은 접근이 아니라 **사본 보유**: 서비스 이용 정책 '시스템 부정 행위' 1)·3), 공통 §14③ 복사·복제·가공, 마켓플레이스 §13②. 허용 조항도 없음. **DEVELOPMENT = `PILOT_ALLOWED` / GA = `POLICY_GATED`** — product-owner 결정 2026-08-14: 쿠팡 서면 답변은 **출시**를 막지 개발을 막지 않으며, 파일럿은 data-minimization D1~D8로 제한(seller-owned WING only · **작성자 값 금지(dedupe key 포함)** · raw HTML/DOM/screenshot 금지 · 외부 LLM 전송 금지 · marketplace write 0). **D5 해제 2026-08-14 — 리뷰 원문 저장함**(복제·가공 조항을 인지한 상태의 제품 결정이며 법적 확정 아님). **D6 수정 2026-08-17 — 리뷰 AI triage 파일럿(별점+본문만, org opt-in·off-by-default·운영자 트리거·bounded)에 한해 외부 LLM 전송 허용**(`docs/coupang_review_policy_gate_v1.md` §6.1.2, RUBRIC v2 §8.3.1; 마찬가지로 제품 결정이며 법적 확정 아님). 제품 형태: 수집+VOC+`[쿠팡에서 보기]` locate, 답변 채널 아님). public scraping은 이용약관(2026-09-03 시행) 명시 금지로 **채택 안 함**. **Acquisition + Locate v1 LIVE 검증 완료 2026-08-15, 수정된 매니페스트(커밋 `533cafc2`)로 재검증 완료**(`docs/coupang_review_acquisition_v1.md` §6.6이 기록 기준) — backfill(3페이지·24행·**빈 DB에 22건 저장**) → 동일 범위 재수집(**stored=0 / skipped=22, DB 건수 불변**) → 저장 리뷰 **실화면 locate·highlight**(`matches=1`, 독립 2회) 전부 통과. 컬럼은 쿠팡 자체 헤더 단어로 해석하고 **구매자 열은 '읽지 않을 열'로 찾아 제외** — 작성자 저장 0건. 페이지 넘김은 **판매자**(marketplace 클릭·입력·전송 0), 완주 판정은 pager를 **읽어서** 함(`data-wuic-attrs`에 `active`/`disabled`, 이전/다음은 텍스트 없는 `<a>`+CSS 글리프). pager를 못 읽으면 coverage를 주장하지 않고 중단. dedupe는 content hash — 본문 있는 리뷰 **v2**, 별점만 리뷰 **v3**(옵션ID 포함). 이 계정 상품평의 86%가 별점만이었고 쿠팡이 그 자리에 찍는 placeholder 문장은 **본문으로 저장하지 않음**. 알려진 한계: 같은 옵션·같은 날·같은 별점의 별점만 리뷰는 병합. **Locate UX v1 LIVE 검증 완료 2026-08-15, 머지된 main(커밋 `f357fafe`)에서 재검증 — `docs/coupang_review_locate_ux_v1.md` §5.1이 기록 기준**(앞선 `c334b763` sitting은 independent review 수정 이전). 같은 리뷰 2회 press, 각각 자기 바인딩을 발급·소진하고 두 번 다 `matches=1`, 2회차 후 테두리는 **한 줄만** — 누적이 아니라 교체 — `[쿠팡에서 보기]`에 실제 run이 붙음: `REVIEW_LOCATE` intent + 전용 `locate` carrier + 백엔드가 발급하는 일회용 `locateRef`(리뷰를 식별하는 값은 브라우저에도 Action Window 와이어에도 실리지 않고, 에이전트가 자기 세션으로 해석). 실화면에서 `matches=1`, **저장 0건**(DB 22건 불변·sync job 0), 바인딩 소진, marketplace 액션 0. 이 sitting에서 오프라인 스위트가 잡을 수 없던 결함도 발견 — 테두리를 `<tr>`의 `outline`으로 그렸는데 **Chromium은 그것을 칠하지 않음**. 이전의 `highlighted=true`(§6.5·§6.6 포함)는 행을 정확히 찾았지만 보이지 않았음. 띠를 셀로 옮기고 실제 Chromium **픽셀** 회귀로 고정. 남은 것: 본문 잘림 가능 표시 미저장(`bodyExpandable`가 agent에서 멈춤), `mediaCount` 전 행 0(첨부없음/미감지 미확정), 계정 1곳만 검증. **capability 표시에 acquisition 축 추가 2026-08-16(#107)** — 이 칸의 `❌`는 지금도 **공식 API 기준**이며 그대로다. 다만 운영 화면의 capability overview는 pull connector의 답(`supported`/`verificationStatus`, 의미 변경 없음)과 **별도로** `acquisitionPaths[{method, verificationStatus}]`를 함께 싣는다: COUPANG/REVIEW → `ACTION_WINDOW` / `LIVE_PROVEN`(근거는 **취득**을 증명한 sitting인 `docs/coupang_review_acquisition_v1.md` §6.6 — 22건 저장. locate 재검증 §5.1은 저장 0건이라 다른 주장을 증명한다). 이유는 배지가 `supported=false` 하나만 읽어 **`리뷰 미지원`이라고 표시했고, 바로 아래 패널이 수집된 상품평 22건을 세고 있었기** 때문. source of truth는 좁은 code-level registry(`AcquisitionPathRegistry`)이고 `connector_capabilities` 테이블·스케줄 게이팅은 손대지 않았다(=이 축은 수집 스케줄을 열지 않는다). 공식 API 부재는 `supported=false`에서 추론하지 않고 `REVIEW_API` 제외 범위 노트로 표시한다. **표기 정리 2026-08-16(#110·#111·#112)** — (a) 그 `REVIEW_API` 노트는 원래 `CoupangApiConnector` 한 곳에만 있었고 이 커넥터는 기본 off라, 기본 환경(=`MockApiConnector`가 답하는 환경)에서는 노트가 통째로 사라져 **acquisition 배지만 남는 과대표기**가 됐다. 공식 API 부재는 **채널의 사실**이므로 `ChannelApiGapRegistry`(channel 키)로 옮기고 overview가 connector scope와 code 기준 병합(중복 1회)하도록 했다 — 여전히 `supported=false`에서 추론하지 않으며, 감사한 채널만 등재한다(NAVER는 사실이지만 미등재). (b) acquisition 축에서 **`지원`이라는 단어를 쓰지 않는다**: `상품평 수집 경로 확인됨 · Action Window` + `실계정 검증 완료`. `지원`은 4단계의 **운영 지원** 전용이고, 어휘 정본은 `docs/channel-capability-registration-matrix.md` §0(취득 경로 표기 어휘)이다. (c) 수집 설정 행은 `이 채널 미지원` → **`자동 수집 미지원`**(cadence 기준) + 경로가 있는 행에만 "Action Window는 판매자가 직접 실행하는 수집 경로라 자동 수집 주기 대상이 아닙니다" 한 줄. **이 칸의 `❌`와 `셀러 표기 = 표기하지 않음`은 그대로다** | — | ❌ | ❌ | ❌ | `docs/coupang_review_feasibility_v1.md`, `docs/coupang_review_policy_gate_v1.md`, `docs/coupang_review_acquisition_v1.md`, `docs/coupang_review_locate_ux_v1.md` | 표기하지 않음 |
| Coupang | INQUIRY | **API — 공식 v5 `onlineInquiries`(상품별 고객문의)**. PII를 담은 `callCenterInquiries`(고객센터)는 **호출하지 않음** | — | ✅ 커넥터 + 7일 창 backfill 워크 + 공용 ingest | ✅ **라이브 검증 (2026-08-14)** — 실계정 수집 2건, 동일 창 재수집 insert 0 / skip 2 / 중복 0 | ❌ (플래그 off) | `docs/coupang_inquiry_live_proof_v1.md`, `docs/coupang_routine_operations_v1.md` | 검증됨 — 단, 운영 지원 아님 |
| 11번가 | ORDER_SUMMARY | API | ✅ 키 등록 폼 | ❌ (인증 골격만) | ❌ | ❌ | 동상 §3 | 표기하지 않음 |
| 11번가 | REVIEW·Q&A | API 후보 — **세트 내 유일한 공식 리뷰 API**(스펙 로그인 장벽) | — | ❌ | ❌ | ❌ | 동상 §6 | 표기하지 않음 |
| SSG | ORDER_SUMMARY | API | ✅ 키 등록 폼 | ❌ (인증 골격만) | ❌ | ❌ | 동상 §3 | 표기하지 않음 |
| SSG | REVIEW | 채널 자체 부재 확인 | — | — | — | — | 동상 §6 | 표기하지 않음 |
| 오늘의집 | 전체 | MANUAL만 (API 파트너 제한) | — | MANUAL만 | — | MANUAL만 ✅ | 동상 §3 | "엑셀 업로드 지원" |

**요약 문장 (다른 문서가 인용할 한 줄):** 운영 지원(production-supported) 수준은 현재
**파일 업로드(전 채널)뿐**이다. NAVER·Cafe24의 ORDER_SUMMARY, NAVER 리뷰 감독형 캡처,
Cafe24 REVIEW(board 4)·INQUIRY(board 6) read는 **라이브 검증됨**(상시 운영 아님, 감독형·단일계정·
disposable 백엔드), 나머지는 구현/골격/후보 단계다.

> **NAVER REVIEW 과거 리뷰 초기 연동(가이드형 세그먼트 import) — 2026-07-25 기준, 부분 라이브.**
> 위 REVIEW 행은 **단일 export → ingest** 능력이다. 초기 연동은 그 위에 **월 단위 세그먼트를 순서대로
> 안내해 과거 구간을 채우는** 별개 실행이며, 상태는 **한 줄로 요약할 수 없으므로 분리해 기록한다.**
>
> - **세그먼트 실행(SEGMENT) = 라이브 증명됨(1회).** 2026-07-25, 실제 판매자센터에서 1개 월 구간을
>   8/8 `COMPLETED`, ticket `CONSUMED`, segment `COMPLETED+COVERED`, attempt `SUCCEEDED`
>   (신규 70 / 중복 0), `scope_evidence = MACHINE_MATCHED`. **모든 마켓플레이스 클릭은 운영자 수행**이며
>   런타임은 탐지·강조·관찰만 했다. 범위 게이트가 잘못된 기간을 **라이브로 차단**하고 recheck 복구까지
>   증명됨. 증거: `docs/action-window-runtime/naver-initial-review-import-live-proof-record.md`.
>   ⚠ **1계정·1구간·일회용 로컬 백엔드**다. 운영 지원(production-supported) 아님.
> - **기간 탐색(DISCOVERY) = 2026-07-26 폐기.** 2026-07-25에 1회 라이브 실행되어 계획을 만들었지만
>   (범위 2023-07-01 ~ 2026-07-25, 37개 월 구간, `range_evidence = OPERATOR_CONFIRMED`), 그 실행의 전제가
>   **틀렸음이 같은 실행에서 확인됐다**: NAVER 리뷰 달력은 기간을 제한하지 않으므로 "발견할 한계"가 없다.
>   이제 기간은 셀러가 SellerOps에서 시작 월을 고르는 방식으로 정해지고(종료일 = 오늘, 기간·구간 수를
>   확인 후 생성), `range_evidence = OPERATOR_SELECTED`로 기록된다. **마켓플레이스 창을 열지 않으며**,
>   런타임의 discovery 엔진·세션·드라이버 역할은 삭제됐다. 이는 라이브 검증 항목이 아니라 **제거된 항목**이다.
> - **SmartStore 화면 안 안내(오버레이 패널) = 라이브 실행됨(1회, 2026-07-26).** 셀러가 SellerOps에서 기간을
>   한 번 고른 뒤, 판매자센터 창에서 최신 월 1구간을 완료했다(`COMPLETED+COVERED`,
>   신규 62 / 중복 0, `scope_evidence = MACHINE_MATCHED`). 마켓플레이스와의 상호작용은 **시작일 입력 +
>   엑셀 다운로드 + NAVER 확인, 두 번**이었다. 종료일은 기본값이 오늘이어서 요구값과 같았고 해당 단계가
>   `SKIPPED`로 보고됐다 — 2026-07-25에 일부러 틀린 날짜를 넣어야 했던 자리(finding 13)가 우회 없이 지나갔다.
>   ⚠ **"SellerOps 창을 한 번도 보지 않았다"는 아직 확인되지 않았다**: 로그는 마켓플레이스 상호작용 횟수만
>   말해주고, 운영자의 시선은 로그에 남지 않는다. 이 슬라이스의 목표 자체이므로 다음 실행에서 명시적으로
>   확인해야 한다.
>   ⚠ **패널의 차단 표시는 미증명**: 게이트가 첫 판독에서 MATCH였으므로 원인·수정·재검사 렌더링은
>   오프라인 증명뿐이다. ⚠ 1계정·1구간·일회용 로컬 백엔드. 운영 지원 아님.
> - **패널에서 다음 구간 이어가기 = 2026-07-26(같은 날 2차) 추가, 오프라인 증명만.** 구간이 `COMPLETED`되면 패널이 사라지지
>   않고 완료·다음 구간·남은 개수와 `다음 구간 계속하기`를 남긴다. 누름은 실행 명령이 아니라 **요청**이다:
>   런타임은 계획을 볼 수 없고(와이어에 계획·구간 식별자가 없음) 티켓을 발급할 수도 없으므로,
>   `aw_guidance_intent` 한 개 값으로 프론트에 전달되고 프론트가 기존과 **동일한** 엔드포인트
>   (`POST /plans/{planId}/launches/next-segment`)로 새 일회용 티켓을 받아 같은 연결에서 다음 구간을 시작한다.
>   증명 범위: 실 소켓 위에서 **2구간 연속 완료**(런 식별자 2개, 티켓 2개, 소켓 1개, ingest 2회) —
>   `collector/test/crossstack/fe-import-runtime-real-bridge.test.ts`. ⚠ **라이브 실행 없음.**
>   ⚠ 마지막 구간에서는 전체 완료만 알리고 컨트롤을 제공하지 않으며, 15분간 누르지 않으면 패널을 내린다
>   (실제 값으로는 관측되지 않음).
> - **셀러 경로(FE 단일 CTA → Bridge → 로컬 에이전트) = 라이브 증명됨(1회).** 같은 실행에서 스크래치
>   클라이언트 없이 카드의 버튼 하나로 탐색 → 계획 → 1개 구간 적재(신규 61 / 중복 0)까지 도달. `SCOPE_MISMATCH`
>   차단이 **셀러 화면에 표시되고** 날짜 수정 + recheck로 복구되는 경로도 이때 처음 라이브로 증명됨.
>   ⚠ 이 실행에서 **로컬 에이전트 페어링 승인 통제는 검증되지 않았다**(하네스에 TTY가 없어 dev 자동승인 사용).
>   ⚠ 또한 이 실행은 **폐기된 discovery 경로**를 거쳤다. 2026-07-26 이후의 경로(기간 선택 → 구간 실행)는
>   아직 라이브로 실행된 적이 없다. **셀러가 에이전트를 페어링할 제품 경로는 2026-07-26에 추가됐다**
>   (import 카드의 `도우미 연결하기`, env 플래그 없음) — 다만 승인 통제 자체는 여전히 미검증이다.
>
> **따라서 위 표의 `라이브 검증` 열은 초기 연동으로 인해 갱신되지 않는다.** 세 갈래 모두 **1계정·1구간·
> 일회용 로컬 백엔드** 위에서 각 1회 실행된 증거이고, 운영 지원과는 다른 층위다. "과거 리뷰 전체 연동 지원"
> 류의 표기는 금지. 정직 표기는 현행 "네이버 리뷰 export 업로드 지원"을 유지한다.

> **NAVER REVIEW 답변 제출(가이드형) — v1.6, 계획·오프라인·미검증.** 위 표의 REVIEW 행은 **수집(read)**
> 능력이다. v1.6은 별개 축으로 **답변 제출(write)** 을 추가하나, 이 표의 "지원"과 혼동 금지: **가이드형·사람
> 수행·관찰 전용**(SellerOps는 입력·제출 안 함), 방식은 Action Window `REPLY_SUBMISSION` 실행(`contracts/
> action-window/v2/`). NAVER REVIEW 공식 API가 없어 **게시 여부 검증 불가** — 결과는 **운영자 보고 +
> UNVERIFIED**로만 기록한다. 현재 **오프라인 구현 단계**이며 라이브는 게이트 잠금(6번째 G3 스코프
> `reply submission` + 1회용 G6). **"답변 등록/발송 지원" 류의 표기 금지** — 정직 표기는 "네이버 리뷰 답변
> 작성 가이드(직접 등록)".

> **ESM+ INQUIRY 진행 노트.** PR #141로 **offline INQUIRY read 스켈레톤**
> (`com.sellerops.connector.esm.inquiry` — status 매핑, 7일 date 청킹, request/response DTO, parser, fake-HTTP
> 클라이언트 오케스트레이션, offline signed seam 테스트)이 존재한다. **아직 unwired**이며 wire shape는
> `NEEDS_VERIFICATION`(엔드포인트·필드명·페이징 신호 미검증). 사람-관측 **Gate 1**(판매자센터 UI)도 1회 완료되어
> surface가 확인됐다(결과: `docs/sellerops_phase0_esm_inquiry_gate1_findings.md` — UI는 3개월/최대 1년 범위로,
> 7일 API 가정과 표면이 다름; 리스트가 data-bearing). 이후 INQUIRY **Excel 파일 임포트 백엔드**
> (`EsmInquiryImportController` preview/confirm + file-import-accounts)와 message-kind 게이트가 머지되었다
> (프론트 미노출). 다음 단계는 **제약된 Gate 2 read-only probe(별도 1회성 승인)**다.
> **capability 변경 없음, INQUIRY는 `NEEDS_VERIFICATION` 유지, nothing CONFIRMED.**

---

## 5. 채널 × DataType별 수집 전략 (2026-07-07 교정)

> **교정 노트.** 이전 판(및 `docs/sellerops_phase2.md`의 5단계 사다리)은 브라우저 자동화를
> "보편적 최후 수단(last resort)"으로 규정했다. 이 규정은 폐기한다. 리뷰·문의처럼 **공식
> API가 구조적으로 존재하지 않는 데이터**에서는, 판매자가 명시적으로 승인한 브라우저/에이전트
> 자동화 또는 공식 export 자동화가 **정당한 1차 경로**다. "최후 수단"이라는 보편 서열 대신,
> 채널 × DataType마다 아래 기준으로 **가장 자동화되고 반복 가능하며 사용자가 동의한 연결**을
> 선택한다.

**목표 함수**: 각 (채널 × DataType)에 대해 *가장 자동화되고(반복 실행 가능), 반복 가능하며
(스키마·세션이 안정), 사용자가 동의한(판매자 승인·약관 적합)* 연결 방식을 최적화한다.

**방식 선택 기준**
- **공식 API** — 해당 DataType을 **충분히 완전하고 안정적으로** 제공할 때 사용한다.
  범위(누락 필드)·약관·rate limit을 discovery(§4)로 확인한 뒤 선택. 무인 스케줄이 가능한
  유일한 방식이며, ORDER_SUMMARY는 대부분 여기로 수렴한다.
- **판매자 승인 브라우저/에이전트 자동화 또는 공식 export 자동화** — 리뷰·문의 등 필요한
  데이터가 API로 제공되지 않거나 불충분할 때의 경로. 감독형(사람이 로그인/2FA, 1회 실행
  감독)에서 시작해, 세션·스키마 신뢰가 쌓이면 채널별로 자동화 수준을 상향한다.
  NAVER 리뷰가 이 방식으로 검증된 선례다(§4.1). 채널별 약관·차단 리스크 평가는 discovery
  항목(§4의 4·9번)으로 수행하며, **평가 결과에 따라 채널별로 채택 여부를 정한다 —
  일괄 금지도, 일괄 허용도 아니다.**
- **Manual upload** — **임시 브리지/폴백**이며 제품의 목적지가 아니다. 새 채널을 가장
  빨리·정직하게 열 수 있는 시작점(기존 `/api/uploads` + 매핑)이고, 자동 경로 장애 시의
  강등 경로로 항상 유지된다.

**원칙**
- 한 채널이 DataType마다 다른 method를 가질 수 있다(예: Cafe24 ORDER_SUMMARY=API,
  NAVER REVIEW=EXPORT). method는 §4.1 현행표에 선언된 것만 유효하다.
- 신규 채널 도입 순서는 여전히 **manual(즉시) → 감독형 자동화 → 무인 상향**의 신뢰 사다리를
  따른다. 단 이는 *도입 순서*이지 방식의 우열이 아니다 — 리뷰류는 EXPORT/에이전트 자동화가
  종착일 수 있다.
- method 강등은 항상 허용(자동 경로 실패 시 manual로 안내). 강등은 데이터/UI에 정직하게 표기.
- **안전·승인 게이트(§7·§8)는 자동화 수준과 무관하게 그대로 적용된다**: 모든 라이브 실행은
  명시적 1회성 승인, 인증(로그인/2FA/CAPTCHA)은 항상 사람, 무인 스케줄은 cold-context
  재연결이 풀리기 전 금지(P4 게이트).

### 5.1 기본 production 리뷰 수집 모드 = ACTION_WINDOW (2026-07-08)

공식 리뷰 API가 없는(또는 불충분한) 채널에서, **모든 마켓 채널의 기본 production 리뷰 수집 모드는
ACTION_WINDOW**다(제품 결정 `docs/product-scope-v1.md` §1.5, 계약 `docs/slices/action-window-v1.md`).
**이는 승인된 기본 production 설계이며, "모든 마켓 채널의 기본 모드"로서는 아직 실현되지 않았다(approved
default production design, not yet realized as the cross-channel default).** **상태 갱신 2026-07-15:**
**NAVER 한정**으로는 구현·라이브 검증됐다(Run 4 — export→ingest end-to-end, 감독형·개발셀러·로컬 dev
백엔드. §4.1 · `docs/action-window-runtime/r4-evidence-pack.md` §8-17). **그 외 모든 채널은 미구현**이며,
현재 운영 검증 수집은 §4.1이 말하는 것(운영 지원=파일 업로드)뿐이다.
- SellerOps가 **로컬 에이전트 소유의 실제 전용 Chrome 창을 열거나 앞으로 가져와**, 실제 마켓 페이지를
  사용자가 직접 제어하게 하고, 그 위에 **선택적 게임-튜토리얼 오버레이**(다음 요소 하이라이트·다음 행동
  설명·의미 진행 추적)를 얹는다. **사용자가 실제 마켓 요소를 직접 클릭**하며 **SellerOps는 한 사용자
  행동을 몰래 마켓 클릭 시퀀스로 번역하지 않는다.** 신뢰 부족 시 **fail-closed**(수동 진행).
- **공식 다운로드가 시작된 뒤** SellerOps가 자동으로 감지·검증·임포트(기존 `/api/uploads`·`IngestionService`)·
  dedup·매핑·분석·리포트한다 — **신규 인입 스키마·백엔드 능력 없음.** 결과는 기존 `SyncJob`(0건=SUCCESS).
- **Browser Projection과의 관계**: 프로젝션(§collector/G2, 커밋 `a0e4f6f`)은 **제거·폐기되지 않으며**
  채널-중립 로컬 뷰/입력 인프라로 유지되나 **라이브 마켓 리뷰 수집의 기본 모드가 아니다.** "Projected
  Direct Action"은 채널별 정책·제품 리뷰 후 이후에 활성화될 수 있다. **같은 가이드 상태 엔진이 두
  렌더러(Action Window·Projection)를 지탱**한다.
- **정직성·게이트**: Action Window는 §4.1 현행표에 EXPORT 방식이 선언·검증된 채널에만 실제 배정하며,
  **실제 마켓 사용은 정책 해명(마켓 약관상 셀러-통제 오버레이·다운로드 감지 허용 범위) + 제품 오너 승인**
  선결(§8). **어떤 마켓의 승인도 받지 않았다**(§10). 첫 라이브 보정 후보 = **ESM+(Gmarket/Auction) 리뷰
  export**(별도 승인). *(2026-08-17: **PAUSED** — 채널 확장 일시 중단, 노출 채널 NAVER/Coupang/Cafe24 3종
  (`docs/product_assembly_ia_v1.md` §2). 두 번째 Action Window 채널은 실제로 Coupang REVIEW가 됐다(§4.1).)*

### 5.2 채널별 연결 결정 (2026-07-08, 보수적 — 구현/문서/라이브 검증/미래 분리)

아래는 §4.1 현행표를 **재정의하지 않고**, 채널별 **연결 방향·등록 전략·리뷰 수집 모드**를 결정으로 못박는다.
capability 진실은 §4.1, 자율 모드 배정은 `docs/channel-capability-registration-matrix.md`.

- **NAVER** — 단기: **셀러 소유 커머스 API 앱(type=SELF) 발급**을 SellerOps가 가이드(발급 튜토리얼 + 안전
  등록) + 연결 테스트 + 첫 실주문 sync로 온보딩 완료(`docs/slices/naver-guided-connection.md`). 주문·문의:
  구현·인가된 범위에서 **공식 API**. 리뷰: **판매자센터 export를 ACTION_WINDOW로**(사용자 직접 수행).
  장기: **커머스 솔루션 마켓**은 제품·고객 검증 후 고려하되 현 파일럿의 선결이 아니다. 마켓 라이브-사용·정책
  게이트는 정직 유지.
- **Cafe24** — 이미 연동됨. **고객 자기 소유 Cafe24 몰에만** 사용. **Cafe24/Market Plus를 타 마켓의
  프록시·허브로 쓰지 않는다.** 리뷰·게시판·주문·문의 자동화는 **실제 Cafe24 앱·게시판·스코프·라이브 검증된
  계정 능력에 의존**한다. **모든 Cafe24 몰이 동일한 리뷰 구조를 지원한다고 일반화하지 않는다.**
- **Coupang** — 셀러가 **자체개발/셀러 소유 경로로 Open API 키를 발급**할 수 있을 가능성. 공식 계정 동작이
  검증된 곳에서 **가이드 키 발급·연결 흐름을 구축·계획**한다. **가능한 충돌 기록**: 한 셀러 계정이 동일
  API-키 구성에서 SellerOps와 다른 연결된 셀러툴을 동시에 쓰지 못할 수 있다. 고객 기반 성장에 따라
  **SellerOps 통합사업자/셀러툴 등록을 병행**한다. 공식 API는 **검증된 capability에만**. 리뷰는 공식 리뷰
  경로가 검증되기 전까지 **ACTION_WINDOW 또는 INTEGRATION_PENDING**.
- **11번가** — **셀러 발급 API 키를 현재 쓸 수 있다고 주장하지 않는다.** 자체개발/직접-키 경로가 SellerOps에
  현재 가용한지 **검증**한다. 공식 셀러툴/제공자 등록 문의는 **병행**. 권한·API 범위 검증 전까지: API capability =
  **INTEGRATION_PENDING**; 공식 리뷰 export는 라이브 검증 시 **ACTION_WINDOW** 가능.
- **ESM+ / Gmarket / Auction** — 거래/API capability는 존재할 수 있으나 **SellerOps 제공자 온보딩·권한이
  아직 미검증**. 공식 제공자/셀러툴 등록 문의는 **사업자등록 후**. 그때까지: 리뷰·문의 export는 **ACTION_WINDOW**;
  사용자가 **Gmarket/Auction 선택·다운로드를 직접** 수행, 이후 다운로드 처리 자동. **Gmarket·Auction 귀속
  분리.** **안전 상태 감지·정책 리뷰 전 숨은 드롭다운 선택을 자동화하지 않는다.**
- **SSG · 오늘의집** — API·제공자 capability는 공식 파트너 접근이 검증되기 전까지 **INTEGRATION_PENDING**.
  실제 공식 export 흐름이 검증된 뒤에만 **ACTION_WINDOW** 사용. 그 외에는 **FILE_IMPORT** 제공 또는 미지원
  유지. **사설 파트너·타 솔루션 벤더의 존재로 API 접근을 추정하지 않는다.**

---

## 6. PR 단위 로드맵

각 PR은 작고 독립 머지 가능하며, **문서/스캐폴드 PR과 라이브 PR을 분리**한다. 라이브 검증은 별도 승인(§7).
번호는 권장 순서이며 채널 추가(P3.x)는 병렬 가능.

> **현재 개발 시퀀스 (2026-07-08, 제품 오너 결정 — 각 단계 별도 승인·구현 미착수):**
> 1. **정본 문서 갱신**(이 작업). 2. **Action Window V1 계약 리뷰**(`docs/slices/action-window-v1.md`).
> 3. **Action Window 공통 엔진 + 합성 픽스처**(라이브 없음). 4. **ESM+를 첫 실제 Action Window 보정
> 후보**로(별도 승인). 5. **NAVER 셀러 소유 API 가이드 연결**(G3). 6. **Coupang 가이드 키 발급**(공식
> 검증된 곳). 7. **제공자 등록 문의 병행**(사업자등록 후). 8. **Operation Run Engine**(실행 모드·체크포인트
> 안정 후). 이 시퀀스는 아래 P0–P4와 병렬로 진행하되 라이브·구현은 단계별 승인.

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

## 11. 가이드 셋업 & 연결 모드 (커넥터 레벨 규칙, 2026-07-07)

가이드 연결의 **프론트 화면·상호작용은 Frontend Spec §16이 정본**이며, 런타임 경계는
`docs/sellerops_local_agent_runtime_adr.md`가 정본이다. 본 절은 그와 중복하지 않고 **커넥터 레벨
규칙만** 고정한다.

### 11.1 연결 모드 (4단계)

각 (채널 × DataType)의 연결이 어느 정도 자동화되는지를 아래 모드로 선언한다. §4.1 현행표에 채널별
"가이드 셋업 방식"을 적을 때 이 어휘를 쓴다.

| 모드 | 정의 | 사람의 역할 |
|---|---|---|
| **AUTOMATED** | OAuth류로 연결이 거의 자동 완료 | 동의 클릭 |
| **GUIDED** | SellerOps가 발급/연결 화면을 단계별 안내하고 안전한 편의 단계를 자동 수행 | 발급·로그인·계정 선택 등 사람 통제 단계 |
| **ASSISTED** | 파일럿 등에서 운영자가 사용자와 함께 진행 | 사람 주도 |
| **MANUAL** | 파일 업로드 등 사용자가 직접 데이터 투입 | 사람 전담 |

- 모드는 방식(method: API/EXPORT/MANUAL)과 **직교**한다. 예: NAVER ORDER_SUMMARY는 method=API이면서
  현재 셋업 모드는 GUIDED(파일럿은 ASSISTED)일 수 있다.
- 현행표에 선언되지 않은 모드를 셀러에게 약속하지 않는다.

### 11.2 자동 로그인 capability는 독립 추적

- **자동 로그인(auto-login) 지원 여부는 (채널 × DataType)의 데이터 수집 capability와 별개 축으로
  독립 추적**한다. 한 채널이 데이터는 수집 가능(구현/라이브 검증)이어도 자동 로그인은 미지원일 수 있다.
- 자동 로그인 상태도 4단계(연결 가능/구현됨/라이브 검증/운영 지원, 부록 A)로 표기하며, **현재 어느
  채널도 자동 로그인은 운영 지원이 아니다** — 기본 경로는 사람 로그인 + 세션 프로필 보존이다.

### 11.3 로컬 세션 vs 미래 클라우드 세션 실행 구분

- 수집 실행이 **로컬 세션**(사용자 PC의 감독형 브라우저/전용 프로필)에서 일어나는지, **미래 클라우드
  세션**(원격 브라우저, 미구현)에서 일어나는지를 커넥터/실행 기록에서 구분한다.
- 두 실행지는 동일 `ChannelConnector` 계약·flow 정의를 공유하되(`docs/sellerops_local_agent_runtime_adr.md`),
  현재 구현·검증된 것은 **로컬 세션뿐**이다. 클라우드 실행은 방향으로만 문서화한다.

### 11.4 셀러 표기 정직성 (가이드 셋업)

- **과대 표기 금지**: 가이드 셋업·자동 로그인·Windows 지원·클라우드 실행을 셀러 대면 문구에서
  구현·검증 수준을 넘어 표기하지 않는다.
  - 가이드 셋업은 §4.1 현행표에 GUIDED 이상으로 선언되고 실제 동작하는 채널에만 표기.
  - 자동 로그인은 §11.2 상태가 최소 라이브 검증인 채널에만, 그리고 "동의 후 시도"로만 표기(자동 보장 아님).
  - Windows·클라우드는 운영 지원 전까지 "지원"으로 표기 금지.
- 셋업 모드/자동 로그인/실행지 표기는 프론트 레이아웃 세부와 무관하다(레이아웃은 Frontend Spec 소관).

### 11.5 사용자 대면 자율 모드 ↔ 방식/연결 모드 매핑 (2026-07-08)

`docs/product-scope-v1.md` §1.4의 **사용자 대면 자율 모드**(AUTOMATIC_OPERATION/ACTION_WINDOW/FILE_IMPORT/
INTEGRATION_PENDING)는 셀러 **표현 계층**이며, 본 로드맵의 **방식(method)**·**연결 모드(§11.1)**와 아래처럼
느슨하게 대응한다(직교 축 — 강제 1:1 아님). 배정 진실은 `docs/channel-capability-registration-matrix.md`.

| 자율 모드(셀러 대면) | 방식(method §4.1) | 연결 모드(§11.1) | 사람의 역할 |
|---|---|---|---|
| **AUTOMATIC_OPERATION** | API | AUTOMATED/GUIDED | 최초 연결·동의만 |
| **ACTION_WINDOW** | EXPORT(판매자센터, 실제 창 직접 행동) | GUIDED | 로그인·범위·**export 클릭 직접** |
| **FILE_IMPORT** | MANUAL(파일 업로드) | MANUAL | 파일 직접 선택 |
| **INTEGRATION_PENDING** | 미확정/미검증 | — | (표기: 미지원/확인 중) |

- **마켓 전체가 아니라 (채널 × DataType × 조작) 단위 배정**(§1.4). §4.1에 선언·검증되지 않은 모드를
  셀러에게 약속하지 않는다.

---

### 부록 A — 용어
- **method**: 한 (채널×DataType)의 수집 방식 — `API` | `EXPORT`(판매자 승인 브라우저/에이전트·공식 export 자동화) | `MANUAL`.
- **status**: 그 방식의 검증 수준 — `CONFIRMED` | `EXPERIMENTAL` | `UNSUPPORTED` (코드의
  `verificationStatus`와 대응).
- **감독형(supervised) 캡처**: 사람이 로그인/2FA를 수행하고 1회 export를 감독하는 collector 실행. 무인 아님.
- **canonical record**: `CanonicalReview`/`CanonicalInquiry`/`CanonicalOrderSummary` — 채널 무관 적재 단위.

**상태 4단계 (§4.1 현행표의 열 정의 — 반드시 구분해 쓸 것)**

| 단계 | 정의 | 판정 근거 |
|---|---|---|
| **연결 가능(connectable)** | 셀러가 제품 안에서 해당 채널의 연결(자격증명 등록/OAuth)을 시작할 수 있다 | 자격증명 템플릿·연결 플로우 존재 |
| **구현됨(implemented)** | 해당 (채널×DataType)의 수집 코드 경로가 존재하고 오프라인 테스트를 통과했다 | 코드 + 테스트 (라이브 실행 없음) |
| **라이브 검증(live-verified)** | 감독 하 실제 실행이 1회 이상 성공했고 sanitized 기록이 저장소에 있다 | 검증 기록 문서 링크 필수 |
| **운영 지원(production-supported)** | 상시 사용을 제품이 약속한다 — 기본 활성, 운영 절차·복구 경로 존재 | 명시적 운영 결정 (현재: 파일 업로드만) |

**UI 표기 규칙**: 셀러에게 "지원"으로 보여줄 수 있는 것은 **운영 지원** 단계뿐이다.
라이브 검증 단계는 파일럿/감독 하 기능으로만, 구현·골격 단계는 표기하지 않는다
(§10, `frontend/src/lib/channelSupport.ts`의 보수적 문구 규칙과 정합).
