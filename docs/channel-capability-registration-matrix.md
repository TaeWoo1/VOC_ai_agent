# Channel Capability & Registration Matrix

> Status: **LIVING (derived cross-view + registration tracker), 2026-07-08.** 이 문서는 채널별
> **(수집 방식 진실 × 사용자 대면 자율 모드 × 셀러키/제공자 등록 × 사업자 조치 × 블로커)**를 한 표로
> 교차 정리한 **파생 뷰**다. **채널 × DataType의 방식(method)·상태(4단계) 진실 원천은 여전히
> `docs/multi-channel-connector-roadmap.md` §4.1 현행표**이며, 본 문서는 그것을 **재정의하지 않고 참조·인용**한다.
> 충돌 시 §4.1이 이긴다(`CLAUDE.md` conflict priority). 본 문서가 추가하는 것은 §4.1에 없는
> **사용자 대면 자율 모드·셀러 발급 자격증명 가능성·제공자 등록 필요·계정 권한·정책 신뢰·사업자
> 등록 조치·다음 검증·블로커** 열이다.
>
> **정직성 경계.** 아래 어떤 셀도 구현·검증 수준을 §4.1을 넘어 상향하지 않는다. "가능(possible)"·
> "후보(candidate)"·"미검증(unverified)"은 확정이 아니다. 마켓 승인은 실제로 부여·검증된 경우가 아니면
> 어디에도 "승인됨"으로 적지 않는다(`docs/product-scope-v1.md` §1.3 사업자·등록 결정).
>
> **단일 원천 규율(강화).** ① **`docs/multi-channel-connector-roadmap.md` §4.1 현행표가 capability-status의
> 유일한 진실 원천**이다. ② 본 매트릭스는 **파생 business/registration 뷰**이며 capability를 소유하지 않는다.
> ③ **표 B의 `구현`·`검증` 열은 §4.1에서 그대로 인용**하며(§1.1·§1.2 각 행 = §4.1의 해당 행 또는 검증 증거
> 문서에 대응), **매트릭스에서 독립적으로 상향(promote)하지 않는다.** ④ `？`(미확인)은 외부 리서치/라이브
> 정찰 전까지 **`？`로 유지**한다 — 매트릭스가 미지를 확정으로 바꾸지 않는다. ⑤ 상태 상향은 오직 §4.1 갱신 +
> 증거 링크로만 이뤄지고, 그 뒤 본 매트릭스가 이를 반영한다(역방향 금지).

관련 정본: 제품 방향·자율 모드 `docs/product-scope-v1.md` §1.2·§1.3·§1.4, 수집 전략·현행표
`docs/multi-channel-connector-roadmap.md` §4.1·§5·§11, Action Window 계약 `docs/slices/action-window-v1.md`,
NAVER 가이드 연결 `docs/slices/naver-guided-connection.md`.

---

## 0. 어휘 (Legend)

**사용자 대면 자율 모드(user-facing mode)** — `docs/product-scope-v1.md` §1.4:
- **AUTOMATIC_OPERATION** — 공식 API/웹훅/승인된 파트너 경로. 반복 사용자 조작 0, 백그라운드·스케줄 실행 허용.
- **ACTION_WINDOW** — SellerOps가 실제 마켓 페이지 + 튜토리얼 오버레이를 준비, 사용자가 실제 마켓에서
  필요한 행동을 **직접** 수행, 이후 다운스트림 자동. (계약: `docs/slices/action-window-v1.md`) **승인된 기본
  production 설계이며, "모든 마켓 채널의 기본 모드"로서는 아직 실현되지 않았다** — **NAVER 한정**으로는
  구현·라이브 검증됐고(2026-07-15, Run 4 — 감독형·개발셀러·로컬 dev 백엔드. §4.1), **그 외 모든 채널은
  미구현**이다. 모드 배정은 목표 표현이고, 실제 운영 검증 상태는 표 B의 `구현`·`검증` 열(§4.1 인용)을 본다.
  셀러에게 "이미 제공"으로 표기 금지(NAVER 포함 — 운영 지원 단계 아님).
- **FILE_IMPORT** — 사용자가 공식 export 파일 선택, 검증·다운스트림 자동.
- **INTEGRATION_PENDING** — 공식 권한/정책/API 범위/기술 동작이 아직 미검증.

> **모드는 마켓 전체가 아니라 (채널 × DataType × 조작) 단위로 배정**한다(§1.4). 한 채널이 주문=AUTOMATIC,
> 리뷰=ACTION_WINDOW, 문의=INTEGRATION_PENDING처럼 갈릴 수 있다.

**상태 4단계**(§4.1 부록 A): 연결 가능 → 구현됨 → 라이브 검증 → 운영 지원. **셀러에게 "지원"으로 보이는
것은 운영 지원 단계뿐**(현재 = 파일 업로드만).

**취득 경로 표기 어휘**(제품 오너 결정 2026-08-16 — units #110·#111·#112). 화면의 acquisition 축은
**`지원`이라는 단어를 쓰지 않는다.** `지원`은 위 4단계의 **운영 지원**에만 남기고, 취득은 **경로 + 검증
상태**로 말한다:

| 사실 | 화면 문구 |
|---|---|
| 취득 경로가 있고 실계정으로 증명됨 (`LIVE_PROVEN`) | `수집 경로 확인됨 · <경로>` + `실계정 검증 완료` |
| 취득 경로는 있으나 미증명 (`NEEDS_VERIFICATION`) | `수집 경로 있음 · <경로>` + `실계정 검증 전` |
| 공식 API 부재 | 채널의 제외 범위 노트 그대로 (쿠팡 리뷰 = `리뷰 API 없음 (쿠팡 미제공)`) |
| 자동 수집 주기 대상 아님 | `자동 수집 미지원` (채널 미지원이 아니라 **cadence** 미지원) |

이 어휘는 §4.1의 `셀러 표기` 열을 **올리지 않는다**. 쿠팡 리뷰는 여전히 `표기하지 않음`(GA
`POLICY_GATED`)이며, 경로·증거를 사실대로 적는 것과 capability를 "지원"으로 내거는 것은 다른 행위라는
해석 위에 서 있다. 이 해석이 제품 오너 의도와 다르면 그 열이 정본이고 이 표기가 바뀐다.

**열 축약**: 셀러키 = 셀러 발급 자격증명 가능 여부 · 제공자등록 = SellerOps 제공자/셀러툴 등록 필요 여부 ·
계정권한 = 현재 계정 권한 상태 · 구현 = 저장소 구현 상태 · 검증 = 라이브 검증 상태 · 정책신뢰 = 정책/권한
신뢰 · 사업자조치 = 사업자·제공자 등록 조치 · 다음검증 = 다음 검증 단계 · 블로커 = 블로킹 조건.
값: ✅=예/확인, ❌=아니오/부재, ⚠=부분, ？=미확인(외부 리서치/라이브 정찰 필요).

---

## 1. 매트릭스 (한 행 = 채널 × capability)

가독성을 위해 13개 열을 **동일 행 키**를 공유하는 두 표로 나눈다(논리적으로 채널 × capability당 한 행).

### 1.1 표 A — 모드·경로·자격증명·등록·권한

| 채널 | 데이터/액션 | 사용자 대면 모드 | 공식 API/Export 경로 | 셀러키 | 제공자등록 | 계정권한 |
|---|---|---|---|---|---|---|
| 공통(전 채널) | 파일 업로드(주문·문의·리뷰) | **FILE_IMPORT** | 판매자센터 Excel/CSV export | — | ❌ | 셀러 자체 |
| NAVER | 주문(ORDER_SUMMARY) | **AUTOMATIC_OPERATION**(플래그 게이트) | 커머스 API `/product-orders` | ✅ type=SELF 앱 | ❌(SELF) | 통합매니저 필요 |
| NAVER | 문의(INQUIRY) | INTEGRATION_PENDING | 미확정 | ？ | ？ | ？ |
| NAVER | 리뷰(REVIEW) | **ACTION_WINDOW**(+FILE_IMPORT 폴백) | 공식 리뷰 API **없음** → 판매자센터 export | ✅(export는 키 불요) | ❌ | 셀러 로그인 |
| Cafe24 | 주문(ORDER_SUMMARY) | **AUTOMATIC_OPERATION**(플래그 게이트) | OAuth 앱 API | ✅ 셀러 자체 몰 | ✅ Cafe24 앱(연동됨) | 셀러 몰 소유 |
| Cafe24 | 리뷰·문의(게시판) | INTEGRATION_PENDING | 게시판 API(동일 OAuth) | ✅ | ✅ | 몰·게시판·스코프 의존 |
| Coupang | 주문(ORDER_SUMMARY) | INTEGRATION_PENDING | Open API(HMAC) | ✅ 가능(자체개발 경로) | ⚠ 병행 등록 권장 | ？ 이중 셀러툴 충돌 가능 |
| Coupang | 문의(INQUIRY) | INTEGRATION_PENDING | CS API 후보(스키마 미열람) | ？ | ？ | ？ |
| Coupang | 리뷰(REVIEW) | **ACTION_WINDOW** 또는 INTEGRATION_PENDING | 공식 리뷰 API **없음**(확인) | export 시 불요 | ？ | 셀러 로그인 |
| 11번가 | 주문(ORDER_SUMMARY) | INTEGRATION_PENDING | Open API | ？ 확인 필요 | ⚠ 병행 등록 문의 | ？ |
| 11번가 | 리뷰·Q&A | INTEGRATION_PENDING(→ ACTION_WINDOW 후보) | 세트 내 **유일 공식 리뷰 API**(로그인 장벽) | ？ | ？ | ？ |
| ESM+ Gmarket | 주문(ORDER_SUMMARY) | INTEGRATION_PENDING | API | ？ | ⚠ 사업자등록 후 문의 | ？ 제공자 온보딩 미검증 |
| ESM+ Gmarket | 문의(INQUIRY) | INTEGRATION_PENDING(+FILE_IMPORT 백엔드) | API 스켈레톤(unwired) + Excel 임포트 | ？ | ？ | ？ |
| ESM+ Gmarket | 리뷰(REVIEW) | **ACTION_WINDOW**(1차 보정 후보) | 판매자센터 export | export 시 불요 | ？ | 셀러 로그인 |
| ESM+ Auction | 리뷰(REVIEW) | **ACTION_WINDOW**(귀속 분리) | 판매자센터 export | export 시 불요 | ？ | 셀러 로그인 |
| SSG | 주문(ORDER_SUMMARY) | INTEGRATION_PENDING | API | ？ | ✅ 파트너 접근 필요 | ？ |
| SSG | 리뷰(REVIEW) | INTEGRATION_PENDING | **채널 자체 부재 확인** | — | — | — |
| 오늘의집 | 전체 | **FILE_IMPORT** | 파트너 제한 API(직접 불가) | — | ✅ 파트너 접근 필요 | ？ |

### 1.2 표 B — 구현·검증·정책·사업자·다음 단계·블로커 (동일 행 키)

| 채널 | 데이터/액션 | 구현 | 검증 | 정책신뢰 | 사업자조치 | 다음검증 | 블로커 |
|---|---|---|---|---|---|---|---|
| 공통 | 파일 업로드 | ✅ | ✅ 운영 지원 | ✅ 셀러 자체 파일 | — | 채널별 골든 픽스처 | 없음 |
| NAVER | 주문 | ✅ | ✅ 라이브 1회(2026-06-14) | ✅ 공식 인증 메커니즘 일치 | Solution Market은 **장기·비선결** | 플래그 활성 승인 후 파일럿 sync | 플래그 off·스케줄 off |
| NAVER | 문의 | ❌ | ❌ | ？ | — | API 존재 discovery | 방식 미확정 |
| NAVER | 리뷰 | ✅ collector | ⚠ 캡처→저장 1회(2026-06-22); **export→ingest end-to-end 라이브 검증 1회(2026-07-15, Run 4 — 감독형·개발셀러·로컬 dev 백엔드)**; 운영 지원 아님 | ⚠ 셀러-통제 로컬, 마켓 약관 해명 필요 | — | Action Window 보정 완료(Run 4, 2026-07-15); 다음 = 셀러 대면·운영 지원·프로덕션 준비 여부 판단(각 별도 승인 — 확정된 계획 아님) | 마켓 정책 게이트 |
| Cafe24 | 주문 | ✅ | ✅ E2E PASS | ✅ 셀러 몰 OAuth | 자체 몰만(프록시 금지) | 파일럿 운영 결정 | 플래그 off |
| Cafe24 | 리뷰·문의 | ⚠ 보드 분류·저장(아티클 캡처 미구현) | ⚠ 보드 열람 1회 | ⚠ 몰별 상이 | 자체 몰만 | 아티클 캡처 + 라이브 | 아티클 수집 미구현 |
| Coupang | 주문 | ❌ 인증 골격만 | ❌ | ？ | 통합사업자/셀러툴 등록 **병행** | 셀러 자체개발 키 discovery | 이중 셀러툴 동시 사용 제약 가능 |
| Coupang | 문의 | ❌ | ❌ | ？ | 병행 | CS API 스키마 열람 | 스키마 미확인 |
| Coupang | 리뷰 | ❌ | ❌ | ？ | 병행 | 공식 리뷰 경로 검증 or Action Window | 공식 리뷰 API 부재 |
| 11번가 | 주문 | ❌ 인증 골격만 | ❌ | ？ | 셀러툴/제공자 등록 문의 **병행** | 자체개발/직접키 경로 가용성 확인 | 셀러키 가용성 미확인 |
| 11번가 | 리뷰·Q&A | ❌ | ❌ | ？ 로그인 장벽 | 병행 | 리뷰 API 접근 조건 확인 | 로그인 장벽·범위 미검증 |
| ESM+ Gmarket | 주문 | ❌ 인증 골격만 | ❌ | ？ | **사업자등록 후** 제공자 문의 | 제공자 온보딩·권한 확인 | 제공자 권한 미검증 |
| ESM+ Gmarket | 문의 | ⚠ 스켈레톤 unwired + Excel 백엔드(FE 미노출) | ⚠ Gate 1 표면만 | ？ | 병행 | 제약된 Gate 2 read-only probe(별도 승인) | wire shape `NEEDS_VERIFICATION` |
| ESM+ Gmarket | 리뷰 | ❌ | ⚠ 표면(마켓 탭)만(2026-07-07) | ⚠ 약관 해명 필요 | 병행 | Action Window 1차 보정(별도 승인) | 마켓 정책 게이트 |
| ESM+ Auction | 리뷰 | ❌ | ❌ | ⚠ 약관 해명 필요 | 병행 | Gmarket과 **귀속 분리** 보정 | 마켓 정책 게이트 |
| SSG | 주문 | ❌ 인증 골격만 | ❌ | ？ | 파트너 접근 문의 | 파트너 API 접근 확인 | 파트너 권한 미검증 |
| SSG | 리뷰 | — | — | — | — | — | 채널 자체 부재 |
| 오늘의집 | 전체 | 파일 업로드만 | ✅(업로드만) | ✅(업로드) | 파트너 접근 문의 | 실제 공식 export 흐름 검증 | 직접 API 파트너 제한 |

> **요약 한 줄(다른 문서 인용용):** 현재 **운영 지원(상시 약속)** 은 **파일 업로드(전 채널)뿐**이다.
> NAVER·Cafe24 주문과 NAVER 리뷰 캡처는 **라이브 검증**(상시 운영 아님), 리뷰·문의 다수는
> **ACTION_WINDOW 후보 또는 INTEGRATION_PENDING**이며, ACTION_WINDOW의 실제 마켓 사용은 **정책 해명 게이트**
> 뒤에 있다(§4.1 + Action Window 계약 §라이브 보정).

---

## 2. 5분류 (명확 분리)

같은 매트릭스를 제품 오너 판단용으로 **5개 상태로 명확히 분리**한다. 상향은 §4.1 갱신 + 증거 링크로만.

### 2.1 현재 라이브 검증된 capability (live-verified)
- 파일 업로드(전 채널) 인입 + dedup — **운영 지원**.
- NAVER 주문(ORDER_SUMMARY) API 수집 — 라이브 1회(2026-06-14).
- Cafe24 주문(ORDER_SUMMARY) API 수집 — E2E PASS.
- NAVER 리뷰 감독형 캡처 → 다운로드 저장 — 1회(2026-06-22).
- NAVER 리뷰 감독형 **export→ingest 전 구간**(자동 업로드 브리지 포함) — 1회(2026-07-15, Run 4). 범위:
  **감독형**(사람이 실제 클릭)·**개발 셀러**·**로컬 dev 백엔드**(프로덕션 아님). **셀러 대면 출시·무인 자동
  수집·운영 지원 아님.** 상태 정본 = §4.1(운영 지원 ❌ 유지); 근거 = `docs/action-window-runtime/r4-evidence-pack.md` §8-17.
- Cafe24 게시판(리뷰/문의) 열람 discovery — 1회 CONFIRMED(아티클 수집 아님).
- Browser Projection V0(채널-중립, 로컬 픽스처) — **하니스 E2E 검증**(마켓 사용 미승인, **비-기본 렌더러**,
  **production-runtime 미배선 State B** — 정상 부팅이 프로젝션 소스를 생성·주입하지 않음, `slices/browser-projection-v0.md` §22.8).
  (이는 리뷰/문의/주문 데이터 수집 capability가 아니라 렌더러 인프라이므로 §4.1 데이터-행 상태와 무관.)

### 2.2 구현됐으나 라이브 미검증 (implemented, not live-verified)
- Cafe24 OAuth 프론트 연결 플로우(백엔드 토큰 체인은 검증, FE 플로우 미검증).
- 6채널 자격증명 템플릿 키 등록 폼 + `test-connection`(실검증기는 NAVER만).
- 스케줄/수동수집/백필/재시도/알림 acknowledge.
- ESM INQUIRY read 스켈레톤(unwired), ESM INQUIRY Excel 임포트 백엔드(FE 미노출).
- NAVER 커넥터(`NaverTokenClient`/`NaverApiConnector`) — 플래그 OFF 기본.

### 2.3 공식 문서화됐으나 미부여/미검증 (documented, not granted/tested)
- NAVER 커머스 API 셀러 소유(type=SELF) 발급 — 공식 인증 메커니즘 확인, **UI·2FA·스토어 인증 라이브 정찰 필요**.
- Coupang Open API(HMAC) 셀러 자체개발 키 경로 — **가용성·이중 셀러툴 제약 확인 필요**.
- 11번가 Open API·리뷰 API — **셀러키 가용성·로그인 장벽·범위 미검증**.
- ESM+ 주문/문의 API — **제공자 온보딩·권한 미검증**.
- SSG 주문 API — **파트너 접근 미검증**.

### 2.4 미래 제공자 등록 가능성 (future provider-registration possibility)
- NAVER **커머스 솔루션 마켓**(솔루션-제공자 OAuth 모델) — **장기 옵션, 첫 유료 파일럿의 선결 아님**.
- Coupang **통합사업자/셀러툴 등록** — 고객 기반 성장에 따라 병행.
- 11번가·ESM+(Gmarket/Auction) **셀러툴/제공자 등록** — 사업자등록 후 문의(병행).
- SSG·오늘의집 **파트너 접근** — 공식 파트너 자격 확인 후에만.

### 2.5 미지원 또는 불명 (unsupported/unknown)
- SSG 리뷰 — 채널 자체 부재(확인).
- NAVER 문의 — 방식 미확정.
- 오늘의집 직접 API — 파트너 제한(현재 파일 업로드만).
- 위 표의 `？` 셀 전부 — 외부 리서치/라이브 정찰 전까지 **약속 금지**.

---

## 3. 사업자·제공자 등록 전략 요약 (교차)

`docs/product-scope-v1.md` §1.3의 결정을 채널 매트릭스에 투영:
- 제품 오너는 **한국 개인사업자(sole-proprietor) 등록**을 진행한다.
- 공식 **셀러툴·API 파트너·플랫폼 등록 문의는 제품 개발과 병행**한다. **등록 대기 중 개발을 멈추지 않는다.**
- **NAVER 커머스 솔루션 마켓은 장기 옵션**이며 첫 유료 파일럿의 즉시 선결이 아니다.
- **어떤 마켓도 실제 승인·검증 전에는 "승인됨"으로 기술하지 않는다.**
- 공식 등록은 온보딩·API 인가를 개선할 수 있으나, **공식 리뷰 API가 없는 채널에 리뷰 API를 자동으로
  제공하지 않는다** — 그런 채널의 리뷰는 여전히 ACTION_WINDOW 또는 FILE_IMPORT다.

---

### 부록 — 근거
- 방식·상태 진실: `docs/multi-channel-connector-roadmap.md` §4.1(현행표)·§5·§11·부록 A
- 자율 모드·사업자 결정·운영 루프: `docs/product-scope-v1.md` §1.2·§1.3·§1.4·§1.5
- Action Window: `docs/slices/action-window-v1.md`
- NAVER 가이드 연결: `docs/slices/naver-guided-connection.md`
- 라이브 검증 기록: `docs/sellerops_phase3c_live_smoke.md`, `docs/sellerops_cafe24_live_verification.md`,
  `docs/sellerops_phase0_esm_inquiry_gate1_findings.md`, `docs/esm/live-capture-plan.md`
