# Full MVP · REAL API read preflight v1 (2026-09-22)

Demo Org(`7146c50f…`)의 세 연결 채널이 **이 환경에서 공식 API READ에 실제로 응답하는가**를, run을 만들지 않고 잰 기록.
UI/UX는 Phase 4에서 freeze; 이 문서는 E2E 검증의 첫 관문이다.

## 0. 승인과 범위

- 승인 `apr-api-read-9066f36a7e463ef5` · run `preflight-12cc0cac` · commit `12cc0cac` · mode **READ_ONLY** · operator 「Seated and ready.」
- **operator가 승인에 좁힌 범위**: Coupang은 미답변/답변 endpoint 각 **1페이지까지만**. 이 commit의 Coupang `fetch()`는
  한 구간을 페이지가 빌 때까지 넘기므로 그 상한을 보장할 수 없고, 코드를 고치면 승인이 무효가 된다(계약 §1.6) ⇒ **Coupang live 승인
  id를 넣지 않고** 실행했다. 코드 게이트(`CoupangLiveCallGuard`, `signedGet` 첫 줄)가 서명·HTTP 이전에 막았다 — **Coupang 요청 0**.
- 프로세스: `.env.local`(값 미출력) + 덮어쓰기 — collect/responsibility scheduler · self-pilot · proactive · 모든 모델 capability ·
  publish execution **OFF**, self-pilot READ grant **unset**. 러너는 스케줄러가 하나라도 켜져 있으면 실행을 거절한다.
- 방식: API 계정 × {INQUIRY, REVIEW} 중 **코드가 제공하는 것만** 커넥터 `fetch()` **1회**(최근 7일 KST, limit 50), 건수만 세고 버림.

## 1. 결과 — 코드상 지원 vs 이번 환경 실제 API

| 채널 | 계정 · 토큰(메타데이터만) | 커넥터 스위치 | 문의: 코드 | 문의: **이번 환경 실제** | 리뷰: 코드 | 리뷰: **이번 환경 실제** |
|---|---|---|---|---|---|---|
| NAVER | CONNECTED · API_KEY(client credentials, 저장 만료 없음) | ON(상품 문의·고객 문의 lane ON) | 지원 | **SUCCESS · 1건**(상품 문의 lane 1페이지, 1.2s; 고객 문의 lane은 다음 페이지라 이번에 읽지 않음) | **공식 API 없음** | 호출 안 함(NOT_OFFERED) |
| CAFE24 | CONNECTED · OAUTH2 · 읽기 스코프 보유 | ON | 지원 | **SUCCESS · 0건**(board 6, 0.6s — 7일 창에 새 글 없음) | 지원 | **SUCCESS · 0건**(board 4, 0.6s) |
| COUPANG | CONNECTED · HMAC(저장 만료 없음) | ON | 지원 | **미실행 — 요청 0**(SETTING: `CoupangLiveApprovalRequiredException`, 좁혀진 승인 범위를 지키려 게이트를 열지 않음) | **공식 API 없음** | 호출 안 함(NOT_OFFERED) |

**ResponsibilitySources(커넥터 ON에서 해석)** = `NAVER:INQUIRY · CAFE24:INQUIRY · CAFE24:REVIEW · COUPANG:INQUIRY` — 템플릿 네 개 전부.
09-22 00:34 실행에 CAFE24 둘만 있었던 것은 그 프로세스(backend 18080, 인덱스 해당 행)가 NAVER/COUPANG을 끈 상태였기 때문이다.

## 2. 부수 효과 (실측)

- **Cafe24 토큰 갱신 1회**(22:57:01 KST, `last_rotated_at` 갱신) — manifest가 선언한 유일한 쓰기, 성공.
- sync job **0** · 새 문의/리뷰 행 **0** · 커서 변경 **0** · 연결 상태 변경 **0** · 스케줄 변경 **0** · 모델 호출 **0** · WRITE **0** ·
  Coupang 요청 **0** · Cafe24 댓글 확인 GET **0**(새 글이 없어 후보 없음).

## 3. 실패·이상 분류

| 항목 | 분류 | 내용 |
|---|---|---|
| COUPANG 문의 미실행 | **설정**(의도) | 승인 범위(각 1페이지)를 코드가 보장할 수 없어 게이트를 열지 않음. 다음 관문: 1페이지 상한을 가진 preflight 경로 + 새 manifest |
| 부팅 후 기동 거부 | **설정** | preflight가 끝난 뒤 `PilotConfigValidator`가 `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI`가 로컬 기본값이라며 기동을 거부. 운영자 `.env.local`로는 이 커밋의 백엔드가 서비스로 뜨지 않는다(Contextual Agent Workspace v1이 보고한 그 P0) |
| 러너가 검증기보다 먼저 돎 | **코드 결함(경미)** | 기동을 거부할 프로세스에서 live 읽기가 먼저 실행됐다 — preflight는 설정 검증 뒤에 돌아야 한다 |
| NAVER 리뷰 · COUPANG 리뷰 | **capability** | 공식 API 없음(가이드/Aside 경로 — 이번 범위 밖) |
| 인증 실패 | 없음 | — |

## 4. 다음 preflight를 위한 코드 정리 (2026-09-22, 마켓플레이스 호출 0)

§3의 셋을 닫았다. 새 manifest는 이 정리가 들어간 commit을 가리킨다.

- **Coupang 1페이지 상한 — 구조적으로.** `CoupangInquiriesClient.probeFirstPage`는 한 answered-type 버킷의 `pageNum=1`을 **정확히
  한 번** 보낸다: 페이지 번호 파라미터도 루프도 없고(소스 스캔 테스트가 고정), 제공자가 「5페이지 더 있다」고 해도 요청은 1회이며
  다음 페이지의 존재는 `morePages`로 **보고만** 한다(총계 없는 가득 찬 페이지는 `null` = 모름). 창은 공식 7일 상한으로 clamp.
  production `fetchInquiryPage`(창을 끝까지 넘기는 수집)는 **무변경**. 커넥터는 `BoundedReadProbe`로 두 버킷을 각각 묻고,
  preflight는 이 인터페이스를 구현한 커넥터에 대해 `fetch()`를 **부르지 않는다**.
- **NAVER 두 lane 독립 검증.** `NaverInquiryCollector.probeFirstPages`가 상품 문의(`PRODUCT_QNA`)와 고객 문의(`CUSTOMER_INQUIRY`)의
  1페이지를 각각 한 번씩 묻는다(토큰 1회 공유, 한 lane의 실패가 다른 lane을 막지 않음, 커서 전진 없음).
- **설정 검증 → 그 뒤에만 외부 호출.** preflight는 더 이상 `ApplicationRunner`가 아니다(러너는 `ApplicationReadyEvent`보다 먼저
  돈다 — §3의 결함). 검증기가 ready 리스너 중 **가장 먼저**(`@Order(HIGHEST_PRECEDENCE)`), preflight가 **가장 나중**에 돌고,
  preflight는 추가로 `PilotConfigValidator.passed()`를 묻는다 — 순서가 첫째 가드, 명시적 통과 표시가 둘째 가드다. 검증 조건은
  **하나도 바뀌지 않았다**.
- **Cafe24 callback.** 검증기는 그대로. 운영자 `backend/.env.local`에 빠져 있던 `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI` 한 줄을
  runbook §1.4의 등록값으로 추가했다(비밀 아님; 토큰 갱신은 이 값을 보내지 않는다 — runbook §1.5). 커넥터를 켠 채 preflight 없이
  기동해 **검증기 통과를 확인**(기동 거부 0 · 커넥터 로그 0 · Cafe24 토큰 시각 불변 · sync job 0). 등록값이 Cafe24 개발자센터에서
  **지금도 같은지는 저장소가 확인할 수 없다** — authorization-code 교환(재동의)을 할 때만 문제가 되며 READ preflight는 쓰지 않는다.
- **부팅은 한 명령**: `tools/live-proof/api-read-preflight.sh <approvalId> <orgId> <out.json>` — 스케줄러·모델·publish OFF, self-pilot
  grant unset, Coupang 게이트는 **이 approval id로만**, limit 10.
