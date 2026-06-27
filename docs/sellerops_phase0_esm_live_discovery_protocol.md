# SellerOps Phase 0 — ESM+/GMARKET 통제형 라이브 디스커버리 프로토콜

ESM+/GMARKET이 SellerOps 제품 루프(주문/매출 요약·리뷰·문의)에 필요한 **소스 데이터를 실제로 제공할 수 있는지**,
그리고 **어떤 연동 경로**(공식 API / 판매자센터 export / 리포트·이메일 수집 / 불가)인지를 **사람이 감독하는 게이트형
디스커버리**로 안전하게 답하기 위한 **프로토콜 설계 문서**다. 이 문서 자체가 산출물이다.

> Status: DISCOVERY PROTOCOL (planning + 무실행). 본 문서는 ESM+ 라이브 접속을 **수행하지 않으며**, 어떤 ESM+
> capability도 CONFIRMED로 표기하지 않는다. 컬렉터·라이브 수집·브라우저 자동화 PR이 **아니다.**

관련 문서(본 문서는 이들 **위에 얹는다** — 중복 정의하지 않고 참조):
- ESM+ 표면 검증·카탈로그 정합: `docs/sellerops_phase0_esm_discovery.md` (이하 ESM Discovery). 본 문서는 그 §8의
  "후속 라이브 디스커버리"를 구체화한 절차다.
- 라이브 승인 등급·sanitized 출력·status 어휘: `docs/multi-channel-connector-roadmap.md` (이하 Connector Roadmap)
  §8/§9/§10.
- 채널별 공식 API 현황·자격증명 형상: `docs/sellerops_phase3d_multi_channel_adapters.md` (이하 Phase 3D) §2.3/§5.
- 제품 범위·약속 규칙·drift guard: `docs/product-scope-v1.md` (이하 Product Scope) §5/§6/§9.
- 표준 안전 모델·금지 데이터: `CLAUDE.md` §4, `collector/CLAUDE.md`.

본 프로토콜은 새 용어를 만들지 않는다. NAVER 감독형 라이브 작업에서 검증된 컬렉터 패턴(readiness gate,
candidate-index 진단, approved-index 플래그, sanitized outcome enum)을 **그대로 재사용**한다(§6 참조).

---

## 1. 목적 (Purpose)

ESM+/GMARKET이 다음을 지원할 수 있는지 결론을 낸다:

- **ORDER_SUMMARY** — 주문/매출 요약
- **REVIEW** — 리뷰
- **INQUIRY** — 문의 / Q&A
- (이후) 향후 GMARKET `VocItemSource` 어댑터를 통한 attention / drill-down / `safePreview`

각 도메인에 대해 **연동 경로**를 판정한다: 공식 API / 판매자센터 export / 리포트·이메일 수집 / **불가** / **미지**.
그리고 어떤 DataType이 UNSUPPORTED → (미래) CONFIRMED로 올라가기 위해 **어떤 증거가 필요한지**를 명시한다.

오늘 기준 사실(ESM Discovery §1, Phase 3D §2.3): ESM+는 신규 채널이 아니라 카탈로그의 `GMARKET`과 동일하며,
모든 DataType이 정직하게 **UNSUPPORTED**다. ESM API는 **NEEDS_ACCOUNT_PERMISSION**(수동·재량 이메일 신청, JWT HS256,
`aud: sa.esmplus.com`, 주문 inquiry ~5초당 1콜, **공식 리뷰 API 문서화 안 됨 → 리뷰는 부재 가능성**).

## 2. 엄격한 Non-goals

본 프로토콜은 **다음을 하지 않는다**:

- 컬렉터 구현
- 어떤 capability도 CONFIRMED 표기
- `LAST_SUCCESS` 기록
- 파일 자동 다운로드/저장/업로드
- DB 행 변경
- CAPTCHA/2FA 우회
- 금지 영역 스크래핑
- 시크릿 저장
- raw 판매자 데이터 로깅
- 고객/주문/상품 식별자 수집
- 스케줄러 / manualSync / backfill 실행
- AI 답변 초안 생성

## 3. 승인 게이트 (Gate 0–5)

각 레벨은 **독립적·1회성 명시 승인**을 요구한다(Product Scope §9, Connector Roadmap §8). 상위 게이트 승인이 하위를
자동 허가하지 않는다. 확신이 없으면 멈추고 보고한다.

| Gate | 행위 | 출력 | 매핑 |
|---|---|---|---|
| **Gate 0** | 오프라인 문서/공식 API/공개 레퍼런스 검토만 | 문서 갱신 | Connector Roadmap §8 "read-only pre-flight" 이전 단계 |
| **Gate 1** | 사람이 ESM+를 **수동으로 열어** 내비게이션을 눈으로 확인 (도구·자동화 없음) | 사람의 메모(여기 §4 체크리스트에 sanitized로 기록) | 사람 책임 영역 |
| **Gate 2** | 감독형 **candidate-index 진단만**: clickable 후보에 인덱스 badge, sanitized 메타데이터만 출력. **특정 후보를 사용자가 승인하기 전에는 클릭 없음** | sanitized 후보 메타데이터 (§5/§6) | Connector Roadmap §8 "supervised capture"; 컬렉터 `scanReviewUsageConfirmCandidates` 패턴 |
| **Gate 3** | 승인된 **단일 후보 1회 클릭**, 클릭 후 상태는 sanitized로만 | sanitized post-click 신호 | 컬렉터 `confirmReviewUsageOnce` + approved-index 플래그 패턴 |
| **Gate 4** | export/다운로드 **가능성 확인만** (버튼·날짜필터·범위선택 존재 여부). **다운로드는 하지 않는다** (별도 명시 승인 시에만) | boolean 존재 플래그 | Connector Roadmap §8; readiness gate(`decideCaptureGate`) 정신 |
| **Gate 5** | **실제 다운로드 또는 업로드** | — | **본 프로토콜 범위 밖.** 별도 PR + 별도 승인 필수 |

라이브 게이트 진입은 컬렉터의 per-run 승인 플래그 패턴(`--i-understand-this-opens-live-naver`,
`collector/src/cli/live-run-approval.ts`)을 ESM+ 전용으로 동일하게 적용한다(미래 슬라이스에서 도입; 본 문서는 절차만 정의).

## 4. 데이터 도메인 체크리스트

Gate 0–2에서 도메인별로 다음을 sanitized로 채운다(빈칸 = 미지/미확인; 추정 셀은 Phase 3D §2.3 출발점).

| 항목 | ORDER_SUMMARY | REVIEW | INQUIRY |
|---|---|---|---|
| 추정 메뉴/페이지 | 주문 관리 계열 | 미지 | 문의/Q&A 계열 |
| 공식 API 존재 | 가설 있음 (ESM Trading API) | **문서화 안 됨 → 부재 가능성** | 가설 있음 (주문 inquiry) |
| export 존재 | 미확인 | 미확인 | 미확인 |
| 리포트/이메일 경로 | 미확인 | 미확인 | 미확인 |
| 날짜 필터 존재 | 미확인 | 미확인 | 미확인 |
| 계정/스토어 범위 선택자 | 미확인 (Master ID가 G마켓·옥션 양측 carry) | 미확인 | 미확인 |
| 페이지네이션/리스트 형상 | 미확인 | 미확인 | 미확인 |
| 행 단위 PII/고객 식별자 노출 여부 | 미확인 (주문은 PII 위험 높음) | 미확인 | 미확인 |
| `sourceCreatedAt` 등가 존재 | 미확인 | 미확인 | 미확인 |
| status/replyStatus/rating 존재 | 해당 없음 | rating 미확인 | replyStatus 미확인 |
| 상품 식별자 노출 & sanitize 방법 | 미확인 → 16-hex salted 해시로만 | 미확인 | 미확인 |
| 연동 경로 판정 | API / export / report / unsupported / unknown | 동일 | 동일 |
| 승격에 필요한 증거 | 라이브 end-to-end 1회 통과 + 스키마 확인 | 동일 | 동일 |

원칙: 새 DataType은 만들지 않는다(기존 `{REVIEW, INQUIRY, ORDER_SUMMARY, PRODUCT, SALES}`에 매핑). REVIEW는 공식
API 부재 가능성이 높아 **manual/EXPERIMENTAL부터** 출발한다(Product Scope §6).

## 5. 증거 로깅 정책

오직 sanitized 메타데이터만 기록한다(Connector Roadmap §9, CLAUDE.md §4).

**허용**:
- 페이지 카테고리, 메뉴 라벨 **카테고리**
- 날짜 필터 존재/부재, export 버튼 존재/부재 (boolean)
- 일반 컬럼 **카테고리** (date / rating / status / product-like / name-like)
- boolean 플래그
- coarse 가시성 (`rows visible: yes/no`, `pagination visible: yes/no`)
- 카운트는 **버킷**으로만 (`zero | one | few | tens | hundreds | thousands_plus`)

**금지** (절대 출력/로깅/커밋 금지):
- seller ID, Master ID, 계정/스토어 ID
- 고객 이름, 전화/이메일/주소
- 주문번호
- 상품 ID/SKU, **실제** 상품명
- 리뷰/문의 본문
- raw HTML
- 실데이터가 보이는 스크린샷
- cookie / localStorage / sessionStorage
- JWT / token / secret
- raw 응답 본문
- 다운로드 파일명
- 로컬 경로
- 비즈니스 민감 볼륨이 드러나는 **정확한 행 수**

시간 규칙(표준): `Date.now` / `new Date` / `Date.parse` 금지, `recencyBucket`만. raw timestamp / `eventTimeMs` 금지.

## 6. Candidate-index 진단 프로토콜 (Gate 2–3)

NAVER에서 검증된 패턴을 그대로 따른다 (참고 구현, 재구현 아님):
`collector/src/naver/review-usage-confirm.ts`(`scanReviewUsageConfirmCandidates` = no-click 인덱스 badge +
sanitized 후보 메타데이터; `confirmReviewUsageOnce` = 정확히 1회 동의 클릭), approved-index 플래그
(`--diagnose-confirm-review-usage-index`), sanitized outcome enum(`collector/src/naver/export-click-signals.ts`),
observe window(`collector/src/cli/capture-export-same-session.ts`).

절차:
1. 화면의 clickable 후보에 **인덱스 라벨을 badge** 한다 (사람이 라이브 브라우저에서 눈으로 식별용).
2. **sanitized 후보 메타데이터만** 출력한다 (index / kind / visible / enabled / text-length 버킷). 본문·식별자 없음.
3. 사용자가 **정확히 하나의 인덱스를 승인**한다.
4. **그 하나만 클릭**한다 (fallback 선택자 없음, 두 번째 클릭 없음).
5. 클릭 후 상태를 rescan/poll 한다 (bounded observe window).
6. **성공을 조기 단정하지 않는다** — sanitized outcome enum으로만 관측.
7. export/download/upload/status-write 컨트롤은 **별도 승인 없이 클릭하지 않는다** (Gate 4/5 경계).

readiness gate(`decideCaptureGate`, `collector/src/cli/same-session.ts`) 정신: 단일·명확한 컨트롤 상태에서만
진행하고, 모호하면 진행하지 않는다(가드 완화 금지). halt 상태(EXPORT_TARGET_EMPTY / _UNKNOWN /
EXPORT_DATE_RANGE_REQUIRED / RECONNECT_REQUIRED 등, `collector/src/status.ts`)는 그대로 멈춤 사유로 쓴다.

## 7. 상태 모델 (evidence ladder — 문서 레벨 전용)

본 프로토콜은 증거 수준을 다음 사다리로 서술한다:

`UNKNOWN` → `NEEDS_DISCOVERY` → `NEEDS_VERIFICATION` → `CONFIRMED`

- **UNKNOWN**: 접근/구조 미파악.
- **NEEDS_DISCOVERY**: Gate 0–2 일부 진행, 경로 가설 존재, 라이브 구조 미확인.
- **NEEDS_VERIFICATION**: 경로 식별, capability 선언 가능하나 라이브 end-to-end 미통과.
- **CONFIRMED**: 라이브 end-to-end 1회 통과 + 스키마 확인.

**중요 — production enum/status 문자열은 본 PR/프로토콜에서 변경하지 않는다.** 이는 ESM Discovery §9의 deferral과
일치한다:
- in-code capability `verificationStatus`: `CONFIRMED | NEEDS_VERIFICATION | UNSUPPORTED`
  (`CollectControlService.channelCapabilityOverview`).
- 수집 전략 status: `CONFIRMED | EXPERIMENTAL | UNSUPPORTED` (Connector Roadmap §10).

`UNKNOWN` / `NEEDS_DISCOVERY`는 **이 문서에서만 쓰는 증거 라벨**이며 코드/프론트 badge 매핑을 건드리지 않는다.

## 8. SellerOps 아키텍처 매핑 (미래 confirmed 시)

어떤 도메인이 미래에 confirmed 되면 다음 경로로 흐른다 (구조 변경 불필요 — 이미 채널 일반화됨):

1. `EsmApiConnector.capabilities` 의 `ConnectorCapabilities` 가 해당 DataType을 `supported`로 선언 (스키마 확인 후).
2. 기존 `DataType` (`REVIEW` / `INQUIRY` / `ORDER_SUMMARY`)에 매핑 — **새 DataType 없음**.
3. 향후 **GMARKET `VocItemSource` 어댑터** 가 read-side seam(`VocItemSourceRegistry`)에 등록 (PR #135에서 seam 준비됨).
4. `OperatorAttentionService` 가 채널 코드로 그 source를 resolve → snapshot/items.
5. `safePreview`(`VocPreviewSanitizer`)는 평문 입력만 받으므로 그대로 재사용.
6. dashboard summary / attention / drill-down / spike는 채널 일반 계약을 그대로 탄다.

오늘은 GMARKET source 어댑터가 **없으므로** registry 정책상 safe-empty다 (아래 §10 가드 참조).

## 9. 종료 기준 (Exit criteria)

디스커버리는 도메인별로 다음 중 **정확히 하나**로 결론낸다:

- 공식 API로 **viable**
- 공식 판매자센터 export로 **viable**
- 스케줄형 리포트/이메일 수집으로 **viable**
- **금지된 자동화 없이는 not viable**
- **unknown / 추가 접근 필요**

결론과 그 근거(증거 사다리 §7 + sanitized 체크리스트 §4)를 ESM Discovery 또는 본 문서에 기록한다. 어떤 결론도
그 자체로 라이브 수집·CONFIRMED 표기를 허가하지 않는다(별도 슬라이스·별도 승인).

## 10. 안전 체크리스트 (미래 라이브 런 이전, 운영자용)

- [ ] 본 런에 대한 **1회성 명시 승인**을 받았다 (표준 안전 규칙은 자동 허가하지 않음).
- [ ] **테스트/폐기 가능 계정**만 사용한다 (실 운영 계정 아님).
- [ ] 로그인 / 2FA / CAPTCHA는 **사람이 직접** 수행한다 (도구는 자격증명을 타이핑하지 않음).
- [ ] 현재 게이트 레벨을 명확히 선언했고, 상위 게이트로 임의 확장하지 않는다.
- [ ] 출력은 **sanitized 메타데이터만** (§5 허용 목록), 금지 데이터 0건.
- [ ] candidate-index 진단은 **승인된 단일 인덱스 1회 클릭**만 (§6).
- [ ] **다운로드/업로드/DB변경/스케줄러/manualSync/backfill 없음** (Gate 5는 본 프로토콜 밖).
- [ ] 모호하면 **멈추고 보고**한다 (가드 완화 금지).

## 현재 상태 가드 (이미 통과 중인 테스트 — 본 PR은 신규 추가 없음)

오늘 ESM+/GMARKET이 정직하게 UNSUPPORTED / safe-empty / no-CONFIRMED 임은 기존 테스트가 고정한다:
- `ChannelCapabilityOverviewTest.esmGmarketOverviewExposesNoConfirmedDataType` — 모든 DataType UNSUPPORTED, CONFIRMED 없음.
- `EsmApiConnectorTest.capabilitiesExposeNoCollectableDataType` / `unsupportedDataTypesThrowWithZeroHttp` — 빈 capability, HTTP 0건.
- `EsmAttentionEmptyStateTest.gmarketAccountWithNoArticlesYieldsEmptySummary` / `gmarketDrilldownReturnsAnEmptyPage` — attention safe-empty.

본 문서는 production 코드/프론트/테스트를 변경하지 않는다. 비밀정보(Master ID·seller id·secret key·JWT·raw 응답)는
본 문서/로그/PR에 출력하지 않는다.
