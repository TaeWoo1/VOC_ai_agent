# Slice Contract — Action Window V1 (기본 production 리뷰 수집 모드)

> Status: **DRAFT — 제품 오너 리뷰 대기(2026-07-08). 승인된 기본 production 설계이며 아직 구현·라이브
> 검증되지 않음(approved default production design, not yet implemented or live-verified).** 이 문서는
> **Action Window**의 V1 실행 계약 **초안**이다. **구현·커밋·라이브 마켓 액션 없음.** Action Window는
> **모든 마켓 채널의 기본 production 리뷰 수집 모드**(설계 방향)다(`docs/product-scope-v1.md` §1.4·§1.5·§1.6,
> `docs/multi-channel-connector-roadmap.md` §5.1). **어떤 문서·UI도 Action Window가 이미 셀러에게 제공된다고
> 암시하지 않는다** — 현재 운영 검증 수집은 §4.1(운영 지원=파일 업로드)뿐이다.
> 핵심 원칙: **실제 마켓 페이지를 실제 Chrome 창에서 사용자가 직접 조작**하고, SellerOps는 그 위에
> **선택적 게임-튜토리얼 오버레이**로 다음 요소·다음 행동·의미 진행을 안내하며, **공식 다운로드가 시작된
> 뒤 자동으로 감지·검증·임포트·dedup·매핑·분석·리포트**한다.
>
> 상위 계약: 제품 원칙 `docs/product-scope-v1.md` §1.2·§1.4·§1.6, 수집 전략
> `docs/multi-channel-connector-roadmap.md` §5·§5.1·§11, 런타임 경계·인증 불변식
> `docs/sellerops_local_agent_runtime_adr.md` §3·§4·§6, 브리지 `docs/slices/local-agent-bridge.md`(G1),
> 프로젝션 `docs/slices/browser-projection-v0.md`(G2), 가이드 상태 엔진 `docs/slices/naver-guided-connection.md`(G3).
> 본 문서는 그들 위에 **Action Window 렌더러 + 직접-행동 오버레이 + 다운로드→인입 핸드오프** 계약을 소유한다.
>
> **정직성 경계.** 실제 마켓 페이지 위에 오버레이를 그리고 다운로드 완료를 감지하는 Action Window
> 렌더러는 **현재 미구현**이다(저장소에 오버레이 주입·다운로드-완료 감지 seam 부재). 본 계약은 방향·경계를
> 확정하되 구현을 주장하지 않는다. 실제 마켓 대상 사용은 **정책 게이트 뒤**에 유지된다(§15).

베이스라인: Product Shell `3006e447b91de72f5e3627da75f390c74d92bfac`, Local Agent Bridge G1
`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`, Browser Projection V0 `a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`.

---

## 1. 목적과 제품 가치 (Purpose & product value)

**무엇을 가능케 하는가**: 공식 리뷰 API가 없는(또는 불충분한) 채널에서, 셀러가 **자기 판매자센터에서
공식 export를 직접** 수행하되, SellerOps가 그 실제 브라우저 화면 위에 **다음에 무엇을 클릭할지**를
단계별로 안내하고, **다운로드가 시작되면 나머지 운영 작업(검증·임포트·dedup·매핑·분석·리포트)을 전부
자동화**한다.

**왜 기본 모드인가**: SellerOps의 agentic 가치는 "수집이 무클릭인가"가 아니라 **사람 체크포인트 앞뒤에서
제거된 end-to-end 운영 작업의 총량**으로 측정된다(`product-scope-v1.md` §1.2). 리뷰류는 대부분 채널에서
공식 API가 구조적으로 없다(§4.1) — 이 현실에서 **가장 정직하고 정책-안전하며 반복 가능한** production
경로는, 사용자가 자기 계정에서 공식 UI로 직접 export하고 SellerOps가 그 전후를 자동화하는 것이다.
Action Window는 "브라우저 클릭 봇"이 아니다 — **한 사용자 행동을 몰래 여러 마켓 클릭으로 번역하지 않는다**(§2).

**제품 가치 요약**: (a) 정책-안전(사용자가 자기 계정에서 직접 조작) · (b) 낮은 진입 장벽(비기술 오너도
단계 안내로 완주) · (c) 높은 자동화(다운로드 후 전부 자동) · (d) 채널-일반화(같은 가이드 상태 엔진 재사용).

## 2. 실제-Chrome 직접-행동 원칙 (Actual-Chrome direct-action principle)

- SellerOps는 **로컬 에이전트가 소유한 실제 전용 Chrome 창을 열거나 앞으로 가져온다**(bring-to-front).
- **실제 마켓 페이지가 보이고 사용자가 직접 제어**한다(SellerOps 안에 투사하는 것이 아니라 실제 창에서 조작).
- SellerOps는 그 실제 페이지 위에 **선택적 게임-튜토리얼 스타일 오버레이**를 표시한다.
- 오버레이는 **다음 요소를 하이라이트**하고 **다음 행동을 설명**하며 **의미 진행(semantic progress)을 추적**한다.
- **사용자가 실제 마켓 요소를 직접 클릭**한다.
- **SellerOps는 한 사용자 행동을 몰래 마켓 클릭 시퀀스로 번역하지 않는다.**
- 사용자는 **안내를 켜고 끌 수 있다**(§3).
- **상태 신뢰가 부족하면 fail-closed**로 사용자가 수동 진행하게 둔다(§8).
- **공식 다운로드가 시작된 뒤** SellerOps가 **자동으로 감지·검증·임포트·dedup·매핑·분석·리포트**한다(§9·§10).

> **Projection과의 관계**(§16, `browser-projection-v0.md`): Action Window의 기본 렌더러는 **실제 Chrome
> 창의 오버레이(직접 행동)**다. Browser Projection은 **제거·폐기되지 않으며** 채널-중립 로컬 뷰/입력
> 인프라로 남되, **라이브 마켓 리뷰 수집의 기본 production 모드가 아니다.** "Projected Direct Action"(투사
> 화면 위 직접 행동)은 **채널별로 정책·제품 리뷰 후 이후에 활성화될 수 있다.** **두 렌더러(Action Window·
> Projection)는 같은 가이드 상태 엔진을 공유**하며 마켓 로직을 중복하지 않는다.

## 3. 오버레이 on/off (Overlay toggle)

- 오버레이는 **항상 사용자가 끌 수 있다**(수동 모드 §7). 끄면 실제 마켓 창은 그대로 사용 가능하고 SellerOps는
  **다운로드 완료 감지·인입만** 유지한다(가이드 없이도 수집은 성립).
- 오버레이는 **시각 안내일 뿐 마켓 요소를 대신 클릭하지 않는다**(§2). 끄고 켜도 진행 상태(§4)는 보존.
- 최종 시각 스타일(스포트라이트 모양·색·애니메이션·문구)은 **[UX-DECISION]** — 본 계약에서 확정하지 않는다.

## 4. 의미 상태 엔진 (Semantic state engine)

- Action Window는 **G3 가이드 상태 엔진(`naver-guided-connection.md` §8·§9)을 공유·확장**한다. 마켓별 로직을
  Action Window 전용으로 복제하지 않는다.
- 상태는 **의미 상태(semantic states)** 만 표현한다 — raw URL·셀렉터·DOM·계정/마켓 식별자를 프론트
  이벤트·영속 상태에 인코딩하지 않는다(G2 §8.3, G3 §9 프라이버시 계승).
- 리뷰-export 공통 의미 단계(초안, 채널 어댑터가 채움): **준비(로그인·기간·범위 등 전제) → export 진입 →
  범위/기간 지정 → export 실행 → 다운로드 시작 감지 → 다운로드 완료 감지 → 인입 핸드오프 → 결과 표시**.
- 각 상태: 안전 증거 / 사용자 설명 / 기대 행위자 / 허용 다음 행동 / 완료 조건 / 타임아웃·실패 / 재개(§11).
- 신뢰 임계 미만이면 `unsupported_state`/`recoverable_ui_drift`로 **fail-closed**(§8).

## 5. 채널 어댑터 (Channel adapters)

- 공통 엔진 위에 **채널별 어댑터**가 (a) 의미 단계의 채널 구체화, (b) 후보 요소 서명, (c) 다운로드 산출물
  형식 기대치를 제공한다. **마켓 로직은 어댑터에만** 있고 엔진·렌더러는 채널-무관.
- 어댑터는 **안정 셀렉터를 가정하지 않는다** — 가시 후보 열거 + 버전드 salted 서명(§6)으로 fail-closed.
- 1차 어댑터 후보 순서(개발 시퀀스 §개발 순서): **ESM+(Gmarket/Auction) 리뷰 export**가 첫 실제 Action
  Window 보정 후보(별도 승인) → 이후 NAVER 리뷰 → 채널 확장. **Gmarket·Auction 귀속은 분리**(matrix §1).
- 채널 어댑터는 §4.1 현행표에 export 방식이 선언·검증된 채널에만 실제 배정한다.

## 6. 감독형 후보-인덱스 동작 (Supervised candidate-index behavior)

- 기존 감독형 프리미티브 재사용: `naver/account-store-resolver.ts`(`clickCandidateIndex`, 정확히 1클릭),
  `esm/esm-candidate-signature.ts`(버전드 salted 서명 — 불일치 시 `UI_CHANGED` + **0클릭**),
  `naver/review-usage-confirm.ts`(`scanReviewUsageConfirmCandidates`, no-click 배지). 전부 sanitized(enum/
  boolean/16-hex).
- **Action Window의 기본은 사용자 직접 클릭**이다(§2). SUPERVISED_ACTION(감독형 단일 클릭·결정적 비-비밀
  값 입력)은 **서명이 일치하고 사용자 승인이 있을 때만, 정확히 1개**. 서명 불일치 → 0행동 + 사용자 확인.
- **한 사용자 행동을 클릭 시퀀스로 확장하는 것은 금지**(§2). 감독형 자동 행동의 허용 범위는 **[PO-DECISION]**(§17).

## 7. 사용자 행동 vs SellerOps 행동 (User action vs SellerOps action)

**SellerOps 행동(안전·결정적 편의):** 올바른 Chrome 탭/창을 앞으로 가져오기 · 오버레이 표시·진행 추적 ·
현재 단계 재탐색 · (안전·서명 일치 시) 결정적 비-비밀 값 감독형 입력 · **다운로드 시작·완료 감지** · 산출물
검증·임포트·dedup·매핑·분석·리포트.
**사용자 행동(항상):** 로그인 · 2FA·CAPTCHA · 계정/스토어 선택 · 기간·범위 선택 · **실제 export 버튼 클릭** ·
법적 의미·불확실 판단. 인증은 **절대 우회하지 않는다**(ADR §4 불변식).
- "이 단계를 완료했어요" 폴백(§12 UX)으로 사용자가 감지 실패 시 수동으로 진행 신호를 줄 수 있다.

## 8. Fail-closed 동작

- 상태 감지 신뢰가 임계 미만이면 **진행하지 않고** 사용자에게 넘긴다(`unsupported_state`).
- 후보 서명 불일치·UI 변경 → **0행동 + `recoverable_ui_drift`** → 사용자 확인.
- 무한 자동 재시도 금지 — 실패 단계에서 멈추고 재시도/수동 진행 안내.
- 오버레이가 확신 없이 **잘못된 요소를 하이라이트하지 않는다** — 모르면 하이라이트를 숨기고 수동 안내.

## 9. 다운로드 감지 (Download detection)

- **공식 다운로드가 시작·완료됨을 감지**하는 것이 Action Window의 핵심 자동화 접점이다. 감지는 **로컬
  에이전트-측**에서 수행(브라우저 다운로드 이벤트/파일시스템 산출물), 프론트에는 **coarse 상태 enum**만 전달.
- 다운로드 산출물은 기존 collector 검증 계승: **확장자 + OOXML/ZIP 매직 스니프**(의존성-free), 원본 마켓
  파일명 미로깅(생성 sanitized 파일명만). 저장은 gitignored quarantine(collector 선례).
- **저장소 현행 격차(정직)**: 감독형 다운로드 저장·검증은 NAVER 리뷰 트랙에 선례가 있으나(2026-06-22),
  **Action Window 오버레이 렌더러·범용 다운로드-완료 감지 seam은 미구현**. 본 슬라이스가 세운다.

## 10. 인입 핸드오프 (Ingestion handoff)

- 다운로드 완료 후 **기존 인입 경계**로 넘긴다: `POST /api/uploads`(파일 임포트) → `IngestionService`
  (dedup·per-row 트랜잭션·`SyncJob`) → canonical 저장 → item-analysis → 대시보드/리포트.
- **신규 인입 스키마·백엔드 능력을 발명하지 않는다** — Action Window는 "공식 export를 사용자 직접, 이후
  기존 파일-임포트 파이프라인 자동"이다. 결과 `SyncJob` `SUCCESS/PARTIAL/FAILED` + counts; **0건 = SUCCESS**
  (실패와 구분).
- 다운스트림 자동(운영 루프 §1.2): dedup 제거·상품 매핑·채널 귀속·이슈 분류·반복 VOC 감지·긴급/위험 점수·
  리포트. **사람 체크포인트(export 클릭)는 그 앞 단계만 멈추고, 다운스트림은 완료 후 자동 재개**(§11).

## 11. 일시정지·재개·새로고침·로그아웃·UI-드리프트 복구

**안전 의미 진행만 영속**(페이지 내용·민감데이터·다운로드 산출물 원문 미저장):
- **일시정지·재개**: 사용자가 언제든 멈추고 이어서 진행. 진행 상태(어느 의미 단계) 보존.
- **SellerOps 새로고침**: 마지막 안전 단계 복원(G1/G2 재접속). 오버레이 재부착.
- **마켓 로그아웃**: `login_required`로 되돌림 — 우회 금지, 사용자 재로그인 대기.
- **UI 드리프트**(마켓 UI 변경): 서명 불일치 → `recoverable_ui_drift` → 0행동 + 사용자 확인.
- **다운로드 중단/부분**: 재시도 안내(부분 산출물 인입 금지 — 완료 감지 후에만 핸드오프).
- **인입 실패·다운로드 성공**: 인입만 재시도(중복 다운로드 회피, dedup가 재업로드를 흡수).

## 12. UI 요구 (Required Action Window UX)

`docs/sellerops_frontend_spec.md` §16(가이드 연결)·§18(신설)의 프론트 정본을 따르되, Action Window 필수 요소:
- 올바른 Chrome 탭/창을 앞으로 가져오기 · 현재 단계 / 총 단계 · 실제 대상 위 스포트라이트/배지 · 간결한 지시 ·
  **안내 on/off** · **현재 단계 다시 찾기** · **수동 모드** · **일시정지·재개** · **"이 단계를 완료했어요"
  폴백** · **recoverable UI-drift 상태** · **다운로드 완료 감지 표시** · **SellerOps로 안전 핸드오프**.
- 셀러 언어(개발자 용어·로드맵 문구 금지). raw URL/DOM/식별자 미표시. 로컬-전용·비저장 프라이버시 고지(§13).

## 13. 프라이버시·로깅 경계 (Privacy & logging boundaries)

- **프레임·입력·페이지 내용·다운로드 원문을 영속 로그·분석·스냅샷·백엔드로 보내지 않는다**(G2 §9 계승).
- 상태·이벤트는 **enum/boolean/coarse bucket/16-hex** 만(`log.ts FORBIDDEN_KEY_SUBSTRINGS` 계승).
- **자격증명·쿠키·토큰·계정 실명·raw URL·셀렉터를 노출·저장하지 않는다.**
- 오버레이가 하이라이트에 쓰는 좌표/요소 메타데이터는 **로컬 에이전트 내부**에 유지(프론트로 raw 미전달) —
  좌표/URL을 프론트로 넘기는 예외는 **명시적 [PO-DECISION]**(ADR §3.4·§7(3), G2 §8.3에서 열지 않음).
- **자동 클립보드 읽기·페이지-비밀 추출 없음**(G3 §11 계승).

## 14. 수용 기준 (Acceptance criteria)

1. 페어링된 로컬 에이전트 없이는 Action Window가 **시작되지 않는다**.
2. **사용자가 실제 마켓 요소를 직접 클릭**한다 — SellerOps가 한 행동을 클릭 시퀀스로 확장하지 않는다.
3. 오버레이를 **끄고도 수집이 성립**한다(다운로드 감지·인입 유지).
4. 미지 UI 상태는 **fail-closed**(잘못된 하이라이트·자동 진행 금지).
5. 인증(로그인·2FA·계정선택·범위선택)은 **건너뛸 수 없다**.
6. **다운로드 완료 감지 후에만** 인입 핸드오프(부분 산출물 인입 금지).
7. 인입은 **기존 파일-임포트 경계**(`/api/uploads`·`IngestionService`)를 쓴다 — 신규 백엔드 능력 없음.
8. **0건 vs 실패 수집이 구분**된다.
9. **프레임·입력·페이지 내용·자격증명이 로그·이벤트·영속 저장에 나타나지 않는다**(테스트로 강제).
10. 새로고침·일시정지·재개가 **안전 의미 진행을 복원**한다.
11. 구현 검증에 **라이브 마켓 액션 불필요**(합성 픽스처로 전부 — §15).
12. Action Window가 **마켓 승인·무인 자동화를 주장하지 않는다**(정직 표기).

## 15. 검증 전략 (Synthetic-fixture validation) & 라이브 보정(별도 승인)

- **채널-중립 합성 픽스처**(복제 브랜드/자산 없이): export-유사 판매자센터 화면·범위 지정-유사·다운로드 트리거-
  유사(합성 파일 산출). Browser Projection V0의 리치 합성 셀러센터 픽스처(마켓 무관) 재사용/확장.
- 단위·통합: 상태 엔진 · 채널 어댑터 서명 · fail-closed · 후보-인덱스 · **다운로드 감지→인입 핸드오프** ·
  0건/부분실패 · 프라이버시(프레임·입력·비밀 부재) · 새로고침/재개 · 오버레이 on/off · 합성 픽스처 브라우저 QA.
- **라이브 마켓 보정은 별도 제품 오너 승인 + 정책 게이트 선결**(§마켓 정책). **첫 실제 Action Window 보정
  후보 = ESM+(Gmarket/Auction) 리뷰 export**(matrix §1, 개발 시퀀스). 라이브 전까지 실제 마켓 미접속.

## 16. Browser Projection과의 관계 (명시)

- **Projection은 제거·폐기되지 않는다.** 채널-중립 로컬 뷰/입력 인프라로 커밋된 채 유지(`a0e4f6f`).
- **Action Window(실제 창 직접 행동)가 라이브 마켓 리뷰 수집의 기본 production 모드**다.
- **Projected Direct Action**(투사 위 직접 행동)은 채널별 정책·제품 리뷰 후 이후에 활성화될 수 있다.
- **같은 가이드 상태 엔진**이 Action Window·Projection 두 렌더러를 지탱한다(마켓 로직 중복 금지).

## 17. 마켓 정책 게이트 & 미해결 결정

- **자동 로그인·자동 클릭·무인 운영·CAPTCHA/2FA 우회·숨은 브라우저 액션 없음**(영구 제외, ADR §4).
- **실제 마켓 Action Window 사용은 정책 해명(셀러-통제 오버레이·다운로드 감지의 마켓 약관 적합성) +
  제품 오너 승인** 선결.
- 미해결 분류:
  - **(1) 저장소 검증**: 다운로드-완료 감지 seam(브라우저 이벤트 vs 파일시스템) · 오버레이 주입 방식(CDP
    vs content-script) · G3 상태 엔진 재사용 경계.
  - **(2) 외부 리서치**: 셀러-통제 오버레이·직접-행동 안내가 각 마켓 약관 자동화 조항에 저촉되는지.
  - **(3) 제품 오너**: 감독형 결정적 비-비밀 값 자동 입력 허용 범위 · 오버레이 좌표/URL 프론트 노출 예외
    개방 시점 · 첫 라이브 보정(ESM+) 착수 승인.

## 18. 구현 슬라이스 (Implementation slices, 미착수)

- **AW-1 — 계약 리뷰**(이 문서). 구현 없음.
- **AW-2 — 공통 가이드 엔진 + 합성 픽스처**: G3 상태 엔진 공유 확장, 채널-무관 렌더러, 오버레이 on/off,
  fail-closed, 다운로드 감지→인입 핸드오프. 라이브 마켓 없음.
- **AW-3 — ESM+ 리뷰 export 어댑터(합성)**: Gmarket/Auction 귀속 분리, 후보 서명. 합성 픽스처 검증.
- **AW-4 — ESM+ 라이브 Action Window 보정**: **별도 승인 + 정책 게이트**(§17). 실제 UI·다운로드 흐름 보정.
- **AW-5 — 채널 확장**(NAVER 리뷰 등) 및 하드닝: 관찰 증거 후에만.

---

### 부록 — 근거 문서·파일
- 제품 방향·자율 모드·운영 루프: `docs/product-scope-v1.md` §1.2·§1.4·§1.6
- 수집 전략(Action Window 기본): `docs/multi-channel-connector-roadmap.md` §5·§5.1·§11
- 런타임·인증 불변식: `docs/sellerops_local_agent_runtime_adr.md` §3·§4·§6
- 가이드 상태 엔진·감독형 프리미티브 재사용: `docs/slices/naver-guided-connection.md` §8·§9,
  `collector/src/naver/{account-store-resolver,review-usage-confirm}.ts`, `collector/src/esm/esm-candidate-signature.ts`
- Projection 인프라(비-기본 렌더러): `docs/slices/browser-projection-v0.md`
- 인입 경계: `backend/.../uploads/*`, `IngestionService`, `SyncJob`
- capability·등록 매트릭스: `docs/channel-capability-registration-matrix.md`
