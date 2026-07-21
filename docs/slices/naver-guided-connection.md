# Slice Contract — NAVER Guided Connection (Guided-Connection G3)

> Status: **RATIFIED (v1, 2026-07-19) — 오프라인 구현 착수: G3-A + G3-B. G3-C/D 게이트 유지.**
> (원 상태: DRAFT — 제품 오너 리뷰 대기 2026-07-08.) 비준 세부는 **§0**. 이 문서는 **assisted NAVER
> 가이드 연결 파일럿**의 G3
> 실행 계약이다. 오프라인 구현·로컬 커밋은 착수하되 **라이브 NAVER 액션은 없다**. 대상은 **셀러 소유 NAVER 커머스 API 애플리케이션 발급
> 흐름**(type=SELF)이며, **미래 SellerOps 솔루션-제공자 OAuth 연동 모델로 문서화하지 않는다**
> (`docs/product-scope-v1.md` §6.1). **실제 NAVER 사용은 마켓 정책 게이트 뒤에 유지**된다(§14).
>
> 상위 계약: 제품 원칙 `docs/product-scope-v1.md` §1.2·§6.1, 프론트 여정·완료기준 `docs/sellerops_frontend_spec.md`
> §16.7·§16.9·§16.10·§16.11·§17-B G3, capability 진실 `docs/multi-channel-connector-roadmap.md` §4.1·§11,
> 런타임 경계·인증 불변식 `docs/sellerops_local_agent_runtime_adr.md` §3·§4, 브리지 `docs/slices/local-agent-bridge.md`(G1),
> 프로젝션 `docs/slices/browser-projection-v0.md`(G2). 본 문서는 그 위에 **가이드 상태 엔진 + 안전 자격증명
> 등록 + 첫 수집 합성** 계약을 소유한다.

베이스라인: Product Shell `3006e447b91de72f5e3627da75f390c74d92bfac`, Local Agent Bridge G1
`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`, Browser Projection V0 `a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`.
**G3는 렌더러-중립이다**: G1(페어링·관측)에 **의존**하고, **최소 하나의 승인된 렌더러 위에서** 동작한다 —
**기본 렌더러 = ACTION_WINDOW**(`docs/slices/action-window-v1.md`, 승인된 기본 production 설계이나 미구현),
**선택 렌더러 = PROJECTION**(G2 `a0e4f6f`, 채널·정책 게이트가 허용할 때만). **가이드 상태 엔진(§8)은 두
렌더러가 공유**하며, **마켓별 로직이 PROJECTION에 직접 의존하지 않는다.**

---

## 0. v1 비준 (Ratification 2026-07-19) — 오프라인 구현 착수

제품 오너가 본 계약을 **NAVER SmartStore v1 흐름으로 비준**한다(우선순위 ① 현재 태스크 결정 +
`docs/action-window-runtime/naver-smartstore-v1-plan.md`). 아래를 넘어서는 UX는 발명하지 않는다.

- **착수 범위 = G3-A + G3-B (오프라인)**: 가이드 상태 엔진 + 합성 흐름(§19 G3-A), 안전 자격증명 등록·연결
  테스트·첫 sync를 **기존 백엔드 경계 어댑터/합성**으로(§19 G3-B). **G3-C(라이브 정찰)·G3-D(하드닝)은 여전히
  게이트** — 별도 PO 승인 + 단일-사용 G6 + §14 정책 해명 선결. **라이브 NAVER·브라우저·원격 git 없음.**
- **가이드-여정 상태 머신 = FE 소유 순수 모듈**(`frontend/src/lib/guidedConnection/`, 렌더러-중립,
  오프라인). §8 의미 상태를 그대로 따르되 **라이브 DOM 감지(§9)는 G3-C까지 유예** — G3-A/B에서 발급 하위
  단계는 **사용자-구동 가이드 전이**(합성 픽스처)로 진행하고 FE는 라이브 상태를 감지하지 않는다. 이는
  frontend/CLAUDE.md의 "runtime owns semantic state"와 **충돌하지 않는다**: 본 상태는 AW **런(run)** 계약이
  아니라 **온보딩 여정** 오케스트레이션이며, sanitized 신호(페어링 상태·API 결과)만 소비한다.
- **[CONFLICT 해소] 리뷰 export 준비 스텝**: DRAFT §16은 NAVER 리뷰 수집을 G3 범위 밖(Action Window 별도
  트랙)으로 둔다. v1 위저드는 **"리뷰 export 준비(readiness) 스텝"**을 포함하되, 이는 리뷰 수집을 G3 안에서
  재구현하는 것이 **아니라** 연결 완료 후 **기존 라이브-검증된 Action Window export 트랙으로의 준비/핸드오프
  표시**다(실제 수집·클릭·다운로드는 여전히 AW 트랙·감독형·게이트). 근거: 우선순위 ① + v1 plan §7.
- **재사용(신규 백엔드 능력 없음)**: 기존 백엔드 경계(`credentials`/`test-connection`/`sync`), FE apiClient,
  bridge 페어링 상태, 기존 연결-상태 어휘(§3.2의 3종은 발명·통합하지 않고 완료 시 매핑만 — 통합은 별도 과제).
- **불변식 계승(테스트 강제)**: Secret 무영속·무로깅(§11·§17.4), 사용자 결정 건너뛰기 금지(§17.2), 미지 상태
  **fail-closed**(§17.3), `completed`는 **등록+테스트+sync 후에만**(§12), **0건 vs 실패 구분**(§12). 자동
  로그인·Secret 추출·클립보드·2FA/CAPTCHA 우회·**cropped/projection UI 없음**(v1 기본 = 실제 로컬 Chrome +
  Action Window 오버레이).
- **구현 위치**: `frontend/src/lib/guidedConnection/*`(순수 상태 머신·타입·합성 픽스처) +
  `frontend/src/` 위저드 UI. **검증: FE typecheck + 단위 테스트(§18) — 라이브 NAVER 불필요(§17.10).**

> **✅ RULED 2026-07-21 (PO) — v1은 G3-A/B에서 완료되고, G3-C/D는 POST-v1이다.** 본 §0 비준이 곧 **NAVER v1
> 온보딩 기준**이다: `ConnectNaver` 위저드 + 안전 자격증명 폼 → Vault → `test-connection` → `sync` →
> 대시보드. **API 센터 ①②단계는 튜토리얼 안내 + 셀러 자기확인(self-attestation)** 으로 출시하며 **라이브
> API-센터 DOM 감지는 v1에 불필요**하다 — **G3-C.1·G3-C.2는 v1 게이트가 아니다**(라이브 API-센터 관측은
> **진단·도구 보정 증거일 뿐** 제품 경로가 아니다). §20-(3)의 G3-C 착수·플래그 활성·SUPERVISED_ACTION 범위는
> 그에 따라 **POST-v1로 연기**된다. ⚠ 경계 불변: **API 센터는 가이드 튜토리얼 지원 전용** — 자동 발급·자동
> 연동 없음, **SellerOps는 API-센터 페이지에서 Client ID/Secret을 절대 읽지 않음**, 셀러가 앱을 직접
> 생성/열고 값을 **수동 복사**한다. **신규 발급 앱에 대한 assisted end-to-end 워크는 POST-v1**(Vault·로컬 DB
> 변경 — 별도 PO 승인 + 신규 단일-사용 G6 필요, v1-검증으로 주장 금지). 상세: v1 plan §8-B9 · §9 · §10.

---

## 1. 목적 (Purpose)

G3는 **assisted(제품 오너 관찰) 사용자**를 셀러 소유 NAVER 커머스 API 애플리케이션 발급 흐름을 통해 안내하고,
**첫 실주문 수집까지** 완료시킨다. G1(관측·페어링) 위에, **승인된 렌더러**(기본 ACTION_WINDOW; 선택 PROJECTION)
위에서 단계 정의·사용자 통제 vs 자동 경계·안전 자격증명 등록·연결 테스트·첫 주문 수집을 얹는다. **자동 로그인·
자동 클릭·코치마크·2FA/CAPTCHA 처리·자동 Secret 추출·클립보드는 넣지 않는다**(§16). 이 파일럿은 **셀러 소유
앱 경로**이며 솔루션-제공자 모델이 아니다.

## 2. 제품 성공 기준 (Product success criterion)

Frontend Spec §16.10의 6단계를 **모두** 통과해야 성공이다. **키 발급만으로는 성공이 아니다.**
1. SellerOps에서 NAVER 커머스 API 흐름을 연다.
2. 애플리케이션 발급을 사용자에게 안내한다.
3. Client ID·Client Secret을 **안전하게 등록**한다.
4. SellerOps 연결 테스트를 통과한다.
5. **첫 실주문 데이터 수집**을 수행한다.
6. SellerOps에 수집 결과를 표시한다.
> 완료 전이는 **③ 등록 성공 + ④ 테스트 통과 + ⑤ 수집 결과**가 모두 성립할 때만(§8 completed, §12).

## 3. 현행 저장소 증거 (Current repository evidence)

> 파일 경로·라인 확인(2026-07-08 정찰). 분류: 구현됨 / production 런타임 배선 / 라이브 검증 / 문서만 / 미래.

### 3.1 재사용 가능 (있음)
- **NAVER OAuth/토큰 클라이언트 (구현됨, 플래그 OFF 기본 → 미배선)**: `backend/.../connector/naver/NaverTokenClient.java`
  — bcrypt 전자서명(`Base64(BCrypt.hashpw(clientId+"_"+timestamp, salt=clientSecret))` `:101-112`) →
  `POST /external/v1/oauth2/token`(`grant_type=client_credentials`, `type=SELF`, `:177-206`), 토큰 캐시.
  `NaverApiConnector.java`(`KIND="NAVER_API"`, ORDER_SUMMARY만, `implements ConnectionVerifier`),
  `NaverOrdersClient.java`(2-콜 `/product-orders/last-changed-statuses`→`/query`). `@ConditionalOnProperty
  sellerops.connector.naver.enabled=true`(기본 false → mock). **공식 인증 메커니즘과 정확히 일치**(§4 대조).
- **자격증명 등록 엔드포인트 + Vault (배선됨)**: `POST /api/seller-accounts/{accountId}/credentials`
  (`SellerAccountCollectController.java:88`, write-only·마스킹 반환) → `CollectControlService.storeCredential`
  (`:272-284`, 템플릿 검증 후 `vault.store`) → `CredentialVault.java`(envelope 암호화, master key env
  `SELLEROPS_VAULT_MASTER_KEY`, 키 없으면 fail-closed). 엔티티 `ConnectorCredential`.
- **NAVER 자격증명 템플릿 (배선됨)**: `CredentialTemplates.java:47-53` — `client_id`(비밀 아님),
  `client_secret`(`secret=true`), `authType="API_KEY"`. **백엔드가 폼의 진실 원천.**
- **연결 테스트 (배선됨; NAVER만 실검증)**: `POST /api/seller-accounts/{accountId}/test-connection`
  (`:81`) → `CollectControlService.testConnection`(`:305-344`, 상태 `SUCCESS/FAILED/UNSUPPORTED/NOT_CONFIGURED`,
  안전 사유 `INVALID_CREDENTIAL/TEMPORARY_PROVIDER_ERROR/PROVIDER_UNAVAILABLE`). NAVER만
  `verifyConnection`→live 토큰 mint/discard(`NaverTokenClient.verify` `OK/INVALID/RATE_LIMITED/UNAVAILABLE`).
- **수집 트리거·결과 (배선됨)**: `POST /api/seller-accounts/{accountId}/sync`(`:49`) → `manualSync` →
  `SyncRunExecutor`; 결과 `SyncJob.status` `RUNNING/SUCCESS/PARTIAL/FAILED` + counts `success/skipped/failed`
  (`:245-250`). **빈 수집/dedup = SUCCESS**(0건과 실패 구분).
- **첫 주문 표시 (프론트 배선됨)**: `frontend/src/pages/Orders.tsx`(요약 대시보드 `/api/orders/summary`),
  `ChannelDetail.tsx`(`api.manualSync` 버튼·run-history `SyncRunView`·last-synced).
- **감독형 클릭·후보-인덱스·서명·안전 상태감지 유틸 (구현됨, collector-local)**: `naver/session-verdict.ts`
  `classifySessionVerdict`(5-state enum), `naver/export-classify.ts` `planExportAction`(no-click 레이아웃),
  `naver/session-probe.ts`/`export-probe.ts`(sanitized 신호·bucket enum), `naver/account-store-resolver.ts`
  (`ResolverDecision`·`clickCandidateIndex`·정확히 1클릭), **`esm/esm-candidate-signature.ts`(버전드 salted
  서명 — 불일치 시 `UI_CHANGED` + 0클릭; 감독형 단일-클릭 핵심 안전 프리미티브)**, `naver/review-usage-confirm.ts`
  `scanReviewUsageConfirmCandidates`(no-click 후보-인덱스 배지). **전부 sanitized(enum/boolean/16-hex).**
- **프로젝션 API (프론트 클라이언트 배선됨; 에이전트-측은 seam만 — State B)**: `frontend/.../projectionClient.ts`
  (`start/stop/requestControl/releaseControl/requestTargetSwitch/sendInput/subscribe/frameRendered`,
  capabilities `{view,control}`), `useProjection.ts` 훅은 **구현·커밋**(`a0e4f6f`). **단 정상 Local Agent
  제품 부팅은 프로젝션 소스를 생성·주입하지 않는다**(`resolveAgentBridgeConfig`가 `projection` 미설정 →
  `/projection/ws` 404) — production-runtime 미배선(browser-projection-v0 §22.8). PROJECTION 렌더러는 **선택**
  이며, 미배선이어도 기본 렌더러 ACTION_WINDOW로 G3가 성립한다(§5.A).
- **sanitized 로깅·핑거프린트 (배선됨)**: `collector/src/log.ts` `FORBIDDEN_KEY_SUBSTRINGS`
  (`token/password/passwd/cookie/authorization/secret/credential/session`), 프로젝션 프라이버시 테스트
  금지목록, `naver/account-fingerprint.ts`(one-way 16-hex, raw 식별자 미저장).

### 3.2 부재/격차 (이 슬라이스가 세움)
- **가이드 상태 엔진 부재**: NAVER API 센터 발급 흐름을 단계 상태로 안내·감지·재개하는 오케스트레이터 없음.
- **프로젝션↔가이드 브릿지 부재**: G2는 화면 투사·입력만; 어느 단계인지·다음 행동을 구동하는 계층 없음.
- **합성 NAVER-유사 픽스처 부재**: NAVER API 센터 흐름을 흉내낸 마켓-무관 합성 픽스처 없음(§18에서 생성).
- **세 가지 연결 상태 어휘 불일치 (보고)**: backend `ChannelConnectionStatus`(CONNECTED/DEGRADED/EXPIRED/
  DISCONNECTED/NEEDS_REAUTH) · backend `ChannelStatus`(카드 intent) · collector `ConnectionStatus`
  (PENDING_USER_LOGIN…ACCOUNT_MISMATCH, collector-local). G3 가이드 상태(§8)는 이 셋을 발명·통합하지 않고
  **별도 가이드-여정 상태**로 두되 완료 시 기존 엔드포인트/상태에 매핑한다. 어휘 통합은 별도 과제 — 보고만.
- **stale 주석 보고**: `CollectControlService.java:324-335` "no connector implements this yet"는 **오기**
  (NaverApiConnector가 verifier 구현). 정정은 G3 범위 밖 — 보고.

## 4. 공식 NAVER 흐름 증거 (Official NAVER flow evidence)

> **공식 커머스 API 센터·SmartStore 도움말만** 사용해 확인한 현행 요구. UI-특정/불안정 세부는 **라이브
> assisted 정찰 필요**로 표기. 출처는 §부록.

**확인된 사실(공식/광범위 교차확인):**
- API 센터: `apicenter.commerce.naver.com`(문서 `/ko/basic/commerce-api`). 가입 시 **개발업체 계정명·
  장애대응 연락처·약관 동의**.
- **발급은 통합매니저(integration manager) 권한으로만 가능**(부매니저 불가).
- 애플리케이션 등록: **앱 정보 + API 호출 IP + API 그룹**(상품/주문(판매자)/판매자정보 등) 추가 → 등록 후
  **Client ID(애플리케이션ID)·Client Secret(시크릿) 발급**. **스토어별 애플리케이션 최대 1개.**
- 인증: **OAuth2 client_credentials**, **bcrypt 전자서명**(`clientId + "_" + timestamp`를 password로, Client
  Secret을 salt로 bcrypt→base64 = `client_secret_sign`) → `POST https://api.commerce.naver.com/external/v1/
  oauth2/token`(`type="SELF"` = 셀러 소유), 13자리 ms timestamp, 응답 `access_token`을 Bearer로 사용.
  → **저장소의 `NaverTokenClient` 구현과 정확히 일치**(§3.1, 상호 검증).
- 셀러 소유(type SELF) vs 솔루션-제공자: 셀러 소유 앱은 `type=SELF`. 솔루션-제공자 앱 등록은 **별개 경로**
  이며 본 파일럿 범위 밖(미래 모델, product-scope §6.1).

**라이브 assisted 정찰 필요(불안정/UI-특정 — 가정 금지):**
- API 센터 각 화면의 **현행 정확한 문구·레이아웃·버튼 위치**.
- 발급 흐름 내 **2FA/사람 검증**의 정확한 지점·형태.
- **스토어 애플리케이션 인증(스토어 인증)** 정확한 단계.
- 애플리케이션 **활성/비활성/만료** 정확 조건.
- **API 그룹 체크박스 정확 라벨**·권한 세분.
- API 호출 IP 설정의 정확한 요구(고정 IP 필요 여부·SellerOps 측 값).

## 5. 여정 단계 (Journey phases)

### A. 준비 (Readiness) — 렌더러-중립
G3 준비 요건은 특정 렌더러가 아니라 아래로 정의한다:
- **Local Agent 페어링·가용**(G1);
- **가이드 상태 엔진 가용**(§8);
- **최소 하나의 승인된 렌더러 가용**;
- **기본 렌더러 = `ACTION_WINDOW`**(실제 창 직접 행동);
- **선택 렌더러 = `PROJECTION`**, **채널·정책 게이트가 허용할 때만**(G2 `{view,control}` 협상).
- 사용자 권한·NAVER 계정 준비(통합매니저 권한 — §4), 기존 연결 감지(이미 연결된 NAVER 계정?),
  SellerOps 측 콜백/IP/설정 값 준비(고정값이면 SellerOps가 제시), **데스크톱 환경**.
> **프로젝션 capability는 시작 조건이 아니다.** 프로젝션이 없어도 기본 렌더러(ACTION_WINDOW)로 여정이
> 시작될 수 있다. 마켓별 로직은 렌더러에 직접 의존하지 않는다(§8 상태 엔진 공유).

### B. NAVER 애플리케이션 발급 (Issuance)
- API 센터 접근 → 계정/스토어 선택 → 애플리케이션 생성 → API 그룹·권한 검토 → 필요 네트워크/IP 설정 →
  최종 사용자 확인 → **Client ID·Secret 발급**.

### C. SellerOps 연결 완료 (Completion)
- 안전 자격증명 입력 → 등록(Vault) → 연결 테스트 → 첫 주문 sync → 결과 표시 → 연결·스케줄 상태.

## 6. 행위자 경계 (Actor boundary)

각 스텝을 `USER_REQUIRED` / `SELLEROPS_AUTOMATED` / `SELLEROPS_GUIDED` / `SUPERVISED_ACTION` / `UNSUPPORTED`로
분류. 원칙(ADR §4): **결정적 편의는 자동화; 계정 선택·권한·동의·불확실 의도는 사용자; 로그인·2FA·CAPTCHA·
계정잠금·사람검증은 절대 우회 안 함.**

| 스텝 | 행위자 | 근거 |
|---|---|---|
| 프로젝션 워크스페이스 열기·준비 체크 | SELLEROPS_AUTOMATED | 로컬 소유 화면 |
| API 센터 화면으로 이동(상태 감지 신뢰 시) | SELLEROPS_GUIDED | 신뢰 낮으면 사용자 안내 |
| NAVER 로그인 | USER_REQUIRED | ADR §4 우회 금지 |
| 2FA·CAPTCHA | USER_REQUIRED | 우회 금지 |
| 계정/스토어 선택 | USER_REQUIRED | 자동화 영구 금지(ADR §4) |
| API 그룹·권한 검토 | USER_REQUIRED | 동의·판단 |
| 결정적 비-비밀 값 채우기(안전 시) | SUPERVISED_ACTION | 감독형 단일 입력(서명 일치 시) |
| 최종 앱 생성·동의 | USER_REQUIRED | 명시적 의도 |
| 발급된 Client ID 입력(검토된 필드) | USER_REQUIRED(입력) / SELLEROPS_GUIDED(안내) | §11 |
| Client Secret 전용 비밀 필드 입력 | USER_REQUIRED | 자동 추출 금지(§11·§16) |
| 자격증명 저장 동의 | USER_REQUIRED | 분리 동의(product-scope §1.2) |
| Vault 등록·연결 테스트·첫 sync·결과 표시 | SELLEROPS_AUTOMATED | 기존 백엔드 경계 |
| 자동 로그인·자동 Secret 추출·무인 클릭 | UNSUPPORTED | §16 |

## 7. 초기 자동화 경계 (Initial automation boundary)

**SellerOps 자동:** 필요한 로컬 프로젝션 워크스페이스 열기 · 준비 체크 제시 · **SellerOps 고정값 제공** ·
상태 감지가 신뢰될 때만 이동 · 안전할 때 결정적 비-비밀 값 채우기 · 완료 상태 감지 · **사용자가 입력한
자격증명을 안전 제출** · 연결 테스트 · 첫 주문 수집 시작 · 결과 표시.
**사용자 필수:** 로그인 · 2FA·CAPTCHA · 계정/스토어 선택 · API 그룹·권한 검토 · 최종 앱 생성·동의 · 명시적
자격증명 저장 동의 · **Client Secret을 SellerOps 보안 필드에 직접 입력**.
> **첫 파일럿에서 자동 Client Secret 추출·클립보드 접근을 구현하지 않는다.**

## 8. 가이드 상태 머신 (Guided state machine)

> 셀렉터·현행 UI 문구를 발명하지 않는다. **의미 상태**만. raw URL·셀렉터·DOM·계정/마켓 식별자를 프론트
> 이벤트·영속 상태에 인코딩하지 않는다(§3.1 프라이버시 계승).

각 상태 정의(안전 증거 / 사용자 설명 / 기대 행위자 / 허용 다음 행동 / 완료 조건 / 타임아웃·실패 / 재개):
- **readiness_checking** — 증거: 페어링·가이드 상태 엔진·**최소 1개 승인된 렌더러**·데스크톱 boolean.
  행위자: SELLEROPS_AUTOMATED. (기본 렌더러 ACTION_WINDOW; PROJECTION은 선택 — §5.A.)
- **agent_unavailable** / **renderer_unavailable** — G1 페어링/렌더러 가용 상태 매핑. 행위자:
  USER_REQUIRED(실행/페어링). `renderer_unavailable`는 **승인된 렌더러가 하나도 없을 때만**(PROJECTION 단독
  부재는 ACTION_WINDOW 가용 시 차단 사유 아님).
- **naver_login_required** — 증거: 세션 verdict enum(NOT_LOGGED_IN). 행위자: USER_REQUIRED. 우회 금지.
- **authority_or_eligibility_unresolved** — 통합매니저 권한/자격 불명(감지 신뢰 낮음 → fail-closed 안내).
- **account_store_choice_required** — 계정/스토어 선택. 행위자: USER_REQUIRED(자동 선택 금지).
- **application_list** / **application_creation** / **permission_review** — 발급 하위 단계(coarse). 행위자:
  USER_REQUIRED(검토·생성). 안전할 때 SUPERVISED_ACTION(결정적 비-비밀 값).
- **final_user_confirmation** — 앱 생성·동의. USER_REQUIRED.
- **credential_issued** — 발급 완료 감지(coarse 신호, 값 미포함). 다음: SellerOps 자격증명 입력.
- **sellerops_credential_entry** — Client ID/Secret 입력 표면(§11). USER_REQUIRED.
- **credential_registration** — Vault 등록(`POST …/credentials`). SELLEROPS_AUTOMATED. 완료: 마스킹 상태.
- **connection_testing** — `test-connection`. 완료: `SUCCESS`.
- **first_order_sync** — `sync`. 완료: `SyncJob` `SUCCESS`(0건 포함) 또는 `PARTIAL`.
- **completed** — ③+④+⑤ 성립 후에만. 결과 표시.
- **recoverable_ui_drift** — 서명 불일치/UI 변경(§9 fail-closed) → 사용자 확인 요청.
- **unsupported_state** — 감지 신뢰 부족 → 안내·수동 확인(fail-closed).
- **terminal_failure** — 복구 불가(사람 개입). 안전 사유 코드만.
- 공통: **타임아웃/실패 시 사용자 안내 + 재시도**; **재개는 안전 의미 진행만 복원**(§13).

## 9. 상태 감지 전략 (State-detection strategy)

평가·분리(가정 금지, **fail-closed**):
- **coarse URL-origin/path 분류**: **로컬 에이전트 내부에서만** 유지(프론트로 raw URL 미전달; `UrlCategory`
  류 enum만 — `session-probe.ts` 패턴).
- **접근성/DOM 상태 분류**: sanitized 신호(boolean/bucket)만(`extractProbeSignals` 재사용).
- **가시 후보 열거 + 후보 서명**: `account-store-resolver.ts`·`esm-candidate-signature.ts`(버전드 salted
  서명) 재사용 — **서명 불일치 시 0클릭 + `recoverable_ui_drift`**.
- **기존 감독형 후보-인덱스 패턴**: `scanReviewUsageConfirmCandidates`(no-click 배지) 재사용.
- **페이지 변경·팝업 감지**: G2 `target_changed`(opaque handle) 재사용.
- **신뢰 부족 시 사람 확인**: 임계 미만이면 `unsupported_state`로 fail-closed.
> **assisted 정찰 전에는 안정 셀렉터를 가정하지 않는다**(§4 라이브 정찰 필요). 상태 감지는 **fail-closed**
> — 모르면 진행하지 않고 사용자에게 넘긴다.

## 10. 가이드 UI (Guided UI)

최종 스타일 없이 사용자 가시 구조: 진행·현재 단계 · **SellerOps 행동 vs 사용자 행동** 구분 · 투사 브라우저
영역(G2) · 짧은 안내문 · **프라이버시/로컬-전용 인디케이터**(G2 계승) · **제어-소유자 인디케이터** · 재시도 ·
수동 확인 · 도움/assisted-핸드오프 상태 · 일시정지·재개 · 완료 결과. **최종 코치마크 스타일·범용 AI 해석
없음**(§16). 셀러 언어. raw URL/DOM/식별자 미표시.

## 11. 안전 자격증명 입력 (Secure credential entry)

- **Client ID**는 검토된 SellerOps 필드에 입력 가능. **Client Secret은 전용 비밀 필드** 사용.
- Secret은 **프론트 localStorage·로그·분석·스냅샷·SellerOps가 캡처한 프로젝션 프레임·브리지 이벤트에 절대
  기록하지 않는다.** (G2 프레임/입력 무영속·무로깅 계승; §3.1 forbidden 키.)
- Secret은 **기존 보안 백엔드 자격증명 등록 경계**(`POST /api/seller-accounts/{accountId}/credentials` →
  `CredentialVault`)로만 전송. **저장 후 재표시 안 함**(마스킹만). **실패 제출도 Secret 미에코**.
- 등록 성공은 **상태로만** 표현. **명시적 자격증명 저장 동의** 필요.
> **자동 클립보드 읽기·페이지-비밀 추출 없음.** 사용자가 NAVER 화면에서 값을 확인해 SellerOps 필드에 직접 입력.

## 12. 연결 테스트·첫 sync (Connection test & first sync)

**신규 백엔드 능력 발명 없이** 기존 경계 조합:
- 연결 테스트: `POST /api/seller-accounts/{accountId}/test-connection`(NAVER 실검증기). 셀러 안전 실패
  범주: `INVALID_CREDENTIAL`(자격증명 확인)·`TEMPORARY_PROVIDER_ERROR`/`PROVIDER_UNAVAILABLE`(잠시 후
  재시도)·`UNSUPPORTED`/`NOT_CONFIGURED`. **원문/스택 미노출.**
- 첫 주문 sync: `POST /api/seller-accounts/{accountId}/sync`(ORDER_SUMMARY). 결과 `SyncJob`
  `SUCCESS/PARTIAL/FAILED` + counts.
- **0건 결과 vs 실패 구분**: 빈 수집/dedup = `SUCCESS`(counts 0) — "수집됨, 신규 주문 없음"으로 표시,
  실패와 다르게. 부분 실패 = `PARTIAL`(일부 반영).
- 재시도: 테스트/sync 각각 재호출. 대시보드/주문 페이지(`Orders.tsx`·`ChannelDetail.tsx`) 확인.
- **정확한 완료 전이**: `credential_registration(성공) → connection_testing(SUCCESS) → first_order_sync
  (SUCCESS/PARTIAL) → completed`. 셋 중 하나라도 미성립이면 completed 아님.

## 13. 재개·복구 (Resume & recovery)

**안전 의미 진행만 영속**(페이지 내용·민감데이터 저장 금지):
- SellerOps 새로고침 → 마지막 안전 단계 복원(G1/G2 재접속; 제어는 뷰만).
- 렌더러 끊김 → 승인된 렌더러 재접속(PROJECTION 사용 시 G2 재접속·제어 재요청; ACTION_WINDOW 사용 시
  실제 창 재초점). 렌더러 전환은 안전 의미 진행을 보존.
- 로컬 에이전트 재시작 → 재페어링/재연결 후 단계 복원.
- NAVER 로그아웃 → `naver_login_required`로 되돌림.
- 2FA 중단 → 사용자 재수행 대기.
- **앱 이미 생성됨** → `application_list`에서 감지, 중복 생성 안내 회피.
- **자격증명 이미 등록됨** → `test-connection`부터 재개(중복 등록 회피).
- **테스트 통과·sync 실패** → sync만 재시도.
- **sync 완료·프론트 종료** → 재진입 시 `completed` 복원(결과 재조회).
- 사용자 이탈 후 복귀 → 안전 단계에서 재개.
- **NAVER UI 변경** → 서명 불일치 → `recoverable_ui_drift` → 사용자 확인.

## 14. 마켓 정책 게이트 (Marketplace-policy gate)

- **채널-중립 프로젝션은 구현됨**(G2, `a0e4f6f`). **실제 NAVER 사용을 "NAVER 승인됨"으로 기술하지 않는다.**
- **자동 로그인·자동 클릭·무인 운영·CAPTCHA/2FA 우회·숨은 브라우저 액션 없음.**
- **라이브 NAVER 검증은 명시적 제품 오너 승인 + 정책 해명(마켓 약관상 셀러-통제 로컬 프로젝션·입력 릴레이
  허용 범위)** 선결(G3-C). 문의 시 **셀러-통제 로컬 프로젝션·입력 릴레이를 정확히 기술**한다.

## 15. 파일럿 관찰 계획 (Pilot observation plan)

제품 오너가 관찰할 것: 어디서 설명이 필요한가 · 사용자가 어디서 망설이는가 · 어느 선택이 판단을 요하는가 ·
어느 결정적 단계가 반복적인가 · 로컬-전용 프라이버시 설명이 신뢰되는가 · 안전 Client Secret 입력이 이해되는가 ·
연결 완료를 인지하는가 · 총 소요·복구 지점. **관찰 노트에 자격증명·페이지 스크린샷·고객 식별자·raw 페이지
내용을 수집하지 않는다.**

## 16. 명시적 제외 (Explicit exclusions)

솔루션-제공자 OAuth · 마켓 승인 주장 · 자동 로그인 · Device Vault · 자동 Secret 추출 · 클립보드 접근 ·
범용 DOM-이해 AI · 무인 자동 클릭 · CAPTCHA/2FA 처리 · **NAVER 리뷰 수집(G3 범위 밖)** · Windows 배포 ·
클라우드 런타임 · 타 채널.

> **NAVER 리뷰 수집 경로 명확화(2026-07-08 채널 결정).** G3는 **셀러 소유 API 앱 발급 + 주문(ORDER_SUMMARY)
> API 수집**에 한정한다. NAVER **주문·문의는 구현·인가된 범위에서 공식 API**를 쓴다. NAVER **리뷰는
> 판매자센터 공식 export를 ACTION_WINDOW로**(사용자가 실제 창에서 직접 export) 수집한다 — 이는 **별도
> 트랙**(`docs/slices/action-window-v1.md`, `docs/multi-channel-connector-roadmap.md` §5.1)이며 G3 범위 밖이다.
> 따라서 위 "NAVER 리뷰 수집 G3 범위 밖"은 **미지원이 아니라 Action Window로 처리**한다는 뜻이다.
> **커머스 솔루션 마켓(솔루션-제공자 모델)은 장기 옵션이며 현 파일럿의 선결이 아니다**(product-scope §1.3·§6.1).

## 17. 수용 기준 (Acceptance criteria)

1. 페어링된 에이전트 + 가이드 상태 엔진 + **최소 하나의 승인된 렌더러(기본 ACTION_WINDOW)** 없이는 여정이
   **시작되지 않는다**. (PROJECTION 단독 부재는 ACTION_WINDOW 가용 시 시작을 막지 않는다.)
2. 사용자-통제 결정(로그인·계정선택·권한·동의)은 **건너뛸 수 없다**.
3. 미지 UI 상태는 **fail-closed**(진행 대신 사용자 확인).
4. **Secret이 로그·이벤트·영속 프론트 저장에 절대 나타나지 않는다**(테스트로 강제).
5. 새로고침·재접속이 **안전 의미 진행을 복원**한다.
6. 연결 테스트는 **기존 실제 백엔드 경계**(`test-connection`)를 쓴다.
7. 첫 주문 수집은 **기존 실제 NAVER 커넥터**(ORDER_SUMMARY)를 쓴다.
8. 완료는 **자격증명 등록 + 연결 테스트 + sync 결과** 후에만 표시.
9. **0건 vs 실패 수집이 구분**된다.
10. 구현 검증에 **라이브 NAVER 액션 불필요**(합성 픽스처로 전부).
11. 구현이 **솔루션-제공자 연동·NAVER 승인을 주장하지 않는다**.

## 18. 검증 전략 (Validation strategy)

- **채널-중립 NAVER-유사 합성 픽스처**(복제 브랜드/자산 없이 생성): API 센터-유사 단계 화면·발급-유사·
  자격증명 발급-유사.
- 상태 머신 단위 테스트 · 행위자-경계 테스트 · 미지-상태 fail-closed 테스트 · **자격증명 프라이버시 테스트**
  (Secret 부재) · 새로고침/재개 테스트 · 렌더러 끊김 테스트(렌더러-중립) · 연결테스트·sync 어댑터 테스트(기존 경계
  목/합성) · 0건·부분실패 테스트 · 합성 픽스처 브라우저 QA · **이후 별도 승인된 assisted 라이브 정찰(G3-C)**.

## 19. 구현 슬라이스 (Implementation slices)

- **G3-A — 가이드 상태 엔진 + 합성 흐름**: 라이브 NAVER 없음. 상태 머신·행위자 경계·fail-closed·합성 픽스처
  + 단위 테스트. 프로젝션/브리지 위 가이드 계층.
- **G3-B — 안전 자격증명 등록·연결 테스트·첫 sync 합성**: 기존 백엔드 경계(`credentials`/`test-connection`/
  `sync`) + 픽스처. Secret 프라이버시 테스트. 신규 백엔드 능력 없음.
- **G3-C — assisted 라이브 NAVER 정찰·셀렉터/상태 보정**: **별도 제품 오너 승인 + 정책 게이트 필요**
  (§14). 실제 UI 문구·2FA 지점·스토어 인증 확정, 후보 서명 보정.
- **G3-D — 파일럿 하드닝**: 관찰 증거 확보 후에만.

## 20. 미해결 결정 (Open decisions)

### (1) 저장소 검증 가능 (repository-verifiable)
- 세 연결-상태 어휘(§3.2) 통합 여부·범위 — 코드로 도출.
- `NaverApiConnector` 플래그(`sellerops.connector.naver.enabled`)를 파일럿에서 켜는 경계·조건.
- `test-connection`/`sync` 응답을 가이드 상태로 매핑하는 정확 대응 — 기존 타입 정독.
- `CollectControlService:324-335` stale 주석 정정(별도).

### (2) 외부 리서치 필요 (external-research)
- API 센터 현행 UI 문구·레이아웃·2FA 지점·스토어 인증·활성/만료 조건·API 그룹 라벨·IP 요구(§4 라이브 정찰).
- 마켓 약관상 셀러-통제 로컬 프로젝션·입력 릴레이 허용 범위(§14).

### (3) 제품 오너 결정 필요 (product-owner)
- G3-C 라이브 정찰 착수 승인·정책 해명 시점.
- 파일럿 앱 발급을 위한 NAVER 플래그 활성 승인.
- 결정적 비-비밀 값 감독형 자동 입력(SUPERVISED_ACTION)의 허용 범위.
- 자격증명 저장 동의·프라이버시 문구의 최종 표현.

---

### 부록 — 근거 문서·파일·출처
- 제품 원칙: `docs/product-scope-v1.md` §1.2·§6.1(셀러 소유 파일럿 ≠ 솔루션-제공자)
- 프론트 여정·완료: `docs/sellerops_frontend_spec.md` §16.10·§16.11·§17-B G3
- capability 진실: `docs/multi-channel-connector-roadmap.md` §4.1(NAVER ORDER_SUMMARY 라이브 1회)·§11
- 런타임·인증 불변식: `docs/sellerops_local_agent_runtime_adr.md` §3·§4
- G1/G2: `docs/slices/local-agent-bridge.md`, `docs/slices/browser-projection-v0.md`
- 현행 코드: `backend/.../connector/naver/{NaverTokenClient,NaverApiConnector,NaverOrdersClient}.java`,
  `.../collect/{SellerAccountCollectController,CollectControlService}.java`, `.../credential/{CredentialVault,
  CredentialTemplates,ConnectorCredential}.java`, `.../sync/{SyncJob,SyncRunExecutor}.java`,
  `collector/src/naver/{session-verdict,export-classify,session-probe,account-store-resolver}.ts`,
  `collector/src/esm/esm-candidate-signature.ts`, `frontend/src/{pages/Orders,pages/ChannelDetail,
  lib/bridge/projectionClient}.tsx?`
- NAVER 공식(외부 리서치): 커머스 API 센터 `apicenter.commerce.naver.com/ko/basic/commerce-api`,
  공식 기술지원 `github.com/commerce-api-naver/commerce-api`, 인증 토큰 발급(전자서명·`/external/v1/oauth2/token`·
  `type=SELF`) — 공식 문서 + 광범위 교차확인. **UI-특정 세부는 라이브 assisted 정찰로 확정(§4·§20-2).**
