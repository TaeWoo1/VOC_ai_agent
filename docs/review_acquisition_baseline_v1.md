# Review Acquisition Baseline v1 — CURRENT FACT

> **문서 성격.** Aside Acquisition Track 착수 전, 현재 저장소(`feat/proactive-operations-agent-v1`,
> 2026-09-12 HEAD `6523fc9c` 기준 — git provenance는 부록 B)의 **리뷰 취득(acquisition) 현행 구현**을 코드에서 재도출한 기록이다.
> 이 문서의 모든 문장은 **CURRENT FACT**다 — 코드 경로가 인용된다. 목표 구조는 적지 않는다
> (`docs/review_acquisition_aside_v2.md`가 TARGET DESIGN을 소유한다). 확인하지 못한 것은
> **`[미확인]`**으로 표시하고 사실처럼 쓰지 않는다.
>
> 이 inventory는 코드 수정·branch·worktree·tag·MCP 호출·NAVER UI 조작 **0**으로 작성됐다.
>
> PD-8(2026-09-12, option a)과 관련해 이 문서가 이미 기록한 CURRENT FACT: 파서는 백엔드(§10) · ingest endpoint는 raw bytes를
> 받아 메모리에서 파싱하며 파일을 영속 저장하지 않는다(§2.4·§11). 이 사실은 target decision 때문에 바뀌지 않는다.
>
> 정본 우선순위: 이 문서는 evidence 층이다. capability 상태는 `docs/multi-channel-connector-roadmap.md`
> §4.1이, 런타임 경계는 `docs/sellerops_local_agent_runtime_adr.md`가, Action Window 상태는
> `docs/action-window-runtime/HANDOFF.md`가 소유한다.

---

## 0. 한 장 요약

리뷰는 채널마다 **다른 방식**으로 들어온다. 백엔드 `CollectionMethod`
(`backend/src/main/java/com/sellerops/collect/runtime/CollectionMethod.java`)가 그 네 가지를 이름 짓는다:

| 방식 | 채널 | 무엇이 브라우저를 갖는가 | 리뷰가 들어오는 길 |
|---|---|---|---|
| `API` | Cafe24 (board 4 구매후기) | 없음 — 서버 HTTP | `Cafe24ApiConnector.fetch(REVIEW)` → `CanonicalCommunityArticle` → `Cafe24ReviewPromoter` → `reviews` |
| `SELLER_CENTER_EXPORT` | NAVER SmartStore | **판매자 PC의 Local Agent(“reviewnary 도우미”)가 띄운 Chromium** | 판매자가 공식 Excel export 클릭 → 도우미가 download 감지 → `/api/imports/reviews/launches/{ref}/ingest` |
| `SELLER_CENTER_READ` | Coupang WING 상품평 | 판매자 PC의 도우미 Chromium | 판매자가 페이지를 넘김 → 도우미가 화면을 읽음 → `/api/agent/review-handoff` |
| `MANUAL_UPLOAD` | 전 채널 | 없음 | 판매자가 파일 선택 → `/api/uploads` |

NAVER·Coupang 리뷰에는 **공식 API가 없다**(`NaverApiConnector` · `CoupangApiConnector` 각 docblock,
§4.1 표). 그래서 두 채널의 리뷰 취득만이 **판매자 PC 위의 인증된 브라우저 세션**에 의존한다. Aside track이
바꾸려는 대상은 정확히 이 층이다.

가장 강한 coupling 지점 셋:
1. **`ImportProbeDriver` 인터페이스**(`collector/src/action-window/initial-import/import-driver.ts`) —
   순수 엔진(`ImportSegmentEngine`)이 브라우저를 아는 유일한 seam. 15개 메서드 전부 관찰·주석·파일 작업이고
   클릭은 없다.
2. **launch ticket**(`review_import_launch.launch_ref`, V28) — 서버가 run의 범위를 정하고 런타임은 16-hex
   ref만 든다. ingest 경로의 idempotency·org fence·provenance가 전부 여기에 매달려 있다.
3. **account slot → profile dir**(`account_session_slot`, V30 · `profile.ts#accountScopedProfileDirFor`) —
   “어느 스토어의 세션인가”를 파일시스템 격리 하나로 답한다. 런타임이 로그인된 스토어 identity를 slot과
   **대조하는 코드는 import 경로에 없다**(§14).

---

## 1. 전체 review acquisition architecture

### 1.1 다섯 런타임 중 셋이 관여한다
`docs/architecture.md`의 다섯 런타임 중 리뷰 취득은 **backend · collector · frontend**에 걸친다.

- **backend** — system of record. `reviews` 테이블, `sync_jobs`/`sync_cursors`/`sync_schedules`,
  `review_import_plan/segment/launch/attempt`, `account_session_slot`, `connector_credentials`(vault).
  ingest·dedup·provenance·scheduler·org fence 전부 여기.
- **collector** — Local Agent. 판매자 PC에서 도는 Node/TS 프로세스. 브라우저 소유(Playwright), 로컬 브리지
  서버(loopback), Action Window 엔진/세션/드라이버, 로컬 dot-dir 상태.
- **frontend** — 판매자가 run을 시작하는 곳. `/connect/review-history`(`lib/actionWindow/import/importSession.ts`)
  → 브리지 WebSocket으로 `aw_attach{carrier:"import", channelCode:"naver"}`.

### 1.2 공통 spine (채널 무관)
```
소스 → CanonicalReview[] → IngestionService.ingestReviews(org, channel, rows, acquisitionSyncJobId)
     → dedup(external_id ∥ content_hash) → reviews INSERT → IngestFollowUp
     → sync_jobs 1행 (method · data_type · counts)
```
- `IngestionService` (`backend/.../ingest/IngestionService.java`): "Source-agnostic persistence + dedup.
  Any connector … calls these methods, so dedup and storage are written once." 행 단위 트랜잭션.
- `IngestFollowUp` (`ingest/IngestFollowUp.java`): 성공 ingest 뒤 item-analysis · `ReviewSegmentIngestedEvent`
  (issue memory refresh) · `CustomerMemoryIndexer` — 세 ingest 경로(upload · API sync · Coupang handoff)가
  같은 후처리를 부른다. best-effort, ingest를 실패시키지 않는다.
- `CollectionRunService` (`collect/runtime/`): 모든 경로가 `sync_jobs` 한 행과 `channel_connection_status`
  갱신으로 수렴하는 지점. (docblock의 "NO existing caller is wired to it yet"는 낡았다 —
  `FileUploadConnector`가 `collectionRuns`를 주입받아 쓴다. `[정정 대상 docblock]`)

### 1.3 Review Core는 acquisition을 어떻게 보는가
- `Review` entity (`review/Review.java`): `org_id · channel_id · product_id · rating · body · received_at ·
  external_id · content_hash · dedup_key_version · reply_state · source_option_id · media_count · replied_at ·
  acquisition_sync_job_id(V83) · data_origin`. 채널이 무엇이든 한 표.
- Review Attention(triage)·Repeated Issue·Product Intelligence는 `reviews`만 읽는다. acquisition 방식은
  `acquisition_sync_job_id → sync_jobs.method`로만 역추적된다(`ExecutableIdentityResolver`, §14).
- `IngestFollowUp` 이후의 어떤 Core 컴포넌트도 collector·브라우저·파일을 알지 못한다.

---

## 2. NAVER acquisition (SmartStore 리뷰 · EXPORT 감독형)

### 2.1 capability 상태 (§4.1 표 그대로)
- 방식 `EXPORT(감독형) + MANUAL`. 공식 API **없음**. 구현됨 ✅. 라이브 검증 ✅
  (2026-07-15 Run 4 · 2026-07-25/26 세그먼트 · 2026-08-23 refresh PARTIAL→hardening ·
  **2026-09-02 E2E LIVE PASS**: `rows_new 115 · rows_duplicate 33 · scope MACHINE_MATCHED`,
  `docs/naver_guided_acquisition_e2e_v1.md`). 운영 지원 ❌ (스케줄 없음, 판매자 착석 run).
- 저장 리뷰: canonical Demo Org NAVER `REAL` 4,455 (2026-09-02 기준).

### 2.2 호출 흐름 (실제 code path)
```
[FE] /connect/review-history
  POST /api/imports/reviews/plans/selected-range            ReviewImportPlanController → ReviewImportPlanService.createPlan (월 단위 세그먼트)
  POST /api/imports/reviews/plans/{planId}/launches/next-segment
        → ReviewImportLaunchService  : review_import_launch 1행, launch_ref 16-hex, kind=SEGMENT, ISSUED (single-use, V28)
  ws://127.0.0.1:<port>/bridge/ws  (pairing token → 단일 사용 ticket)  aw_attach{import,naver}

[collector — resident helper: local-agent.ts --bridge-only]
  OnDemandCarrierHost.activate → RESIDENT_CARRIER_ACTIVATORS → activateNaverReviewImport (cli/local-agent.ts:1498)
    buildNaverImportCarrierCore(cfg, NAVER_REVIEW_URL ∥ landing default)
    InitialImportEndpoint + ImportSegmentHost.attach()
  START_RUN{launchRef}
    ImportSegmentHost → resolveScope → GET /api/imports/reviews/launches/{ref}/scope   (bearer = device token)
      ← {kind:SEGMENT, channelCode, accountSlot, required:{start,end}}
    LazyImportDriver.openSurface:
      profileDir = accountScopedProfileDirFor(<helperHome>/.profile, "naver", accountSlot)   // sha256(channel\0slot)[:24]
      launchNaverContext(profileDir)  = chromium.launchPersistentContext(headed, chromiumSandbox, acceptDownloads)
      page.goto(NAVER_REVIEW_URL)      // 이후 navigate 0
      NaverLiveProbeDriver(page, {quarantineDir, saveManagedCopy, ingest: buildSegmentIngestUpload(...)})
      NaverLiveImportDriver(proven)   // 날짜 입력·조회·scope read-back만 추가
    ImportSegmentEngine(runId, channelCode, importRef=launchRef, required)  + ImportSegmentSession
```
엔진 stage(`import-stages.ts`): `PREPARE_SESSION → … → WAIT_FOR_START → WAIT_FOR_END → WAIT_FOR_APPLY →
WAIT_FOR_RANGE_CONFIRM → WAIT_FOR_EXPORT → WAIT_FOR_CONSENT → DETECT_DOWNLOAD → VALIDATE → INGEST → COMPLETED`.
엔진 effect 어휘(`import-engine.ts`): `PREPARE · READ_FACTS · locate · prefilled · highlight · highlightAll ·
observe · READ_SCOPE · CLEAR_HIGHLIGHT · DETECT_DOWNLOAD · VALIDATE_ARTIFACT · INGEST · CLEANUP` —
**클릭·타이핑·export·동의 effect는 존재하지 않는다**(docblock 보장 1).

### 2.3 드라이버가 실제로 하는 일 (`naver-live-driver.ts` · `naver-live-import-driver.ts`)
- **세션 판정**: `page.url()+page.content()` → `sessionVerdictFromContent` → 5-state `SessionVerdict`
  (`LOGGED_IN · RECONNECT_REQUIRED · ACCOUNT_LOGIN_REQUIRED · AUTH_CHALLENGE_REQUIRED · UNKNOWN`) →
  `naverSessionPrecondition` → `READY ∥ LOGIN_REQUIRED/SESSION_EXPIRED/UNSUPPORTED_STATE`. `UNKNOWN`은 진행 금지.
- **frame 해석**: 리뷰 surface는 iframe-hosted; `resolveSurfaceFrame`(2026-07-25 첫 라이브 실패에서 확정).
- **export 컨트롤 찾기**: accessible name이 `EXPORT_TARGET_KEYWORDS`(엑셀·다운로드·내려받기·excel·download·xlsx·csv)에
  걸리는 interactive 요소를 in-page tagger로 표시. 2026-09-02부터 실제 컨트롤이 둘(「다운로드」 anchor + 「엑셀」 button)이라
  `highlightAll`로 둘 다 링을 씌우고 **판매자가 누른다**.
- **동의 dialog**: export 클릭 뒤에야 생기므로 locate가 deferred; dialog BODY에 export 의미가 있을 때만
  `PRIMARY_ACTION_KEYWORDS`(확인·동의…) 컨트롤을 continuation으로 인정. 판매자가 누른다.
- **download 감지**: Playwright `waitForEvent("download")` — export barrier에서 무장(2026-08-23 hardening),
  listener는 시도 간 유지(2026-09-02). 바이트를 메모리에 들고 quarantine으로.
- **scope read-back**: 날짜 input 값을 읽어 `matchExportScope(required)` → `MATCH` 만 `EXPORT`로 진행,
  `MISMATCH`는 `SCOPE_BLOCKED` park. 하루 창은 두 컨트롤 모두 읽혔을 때만 인정.
- **읽을 수 없으면** 판매자 확인 → `OPERATOR_CONFIRMED`(절대 `MACHINE_MATCHED`로 승격 안 함).

### 2.4 ingest 경로
`ingest-handoff.ts#buildSegmentIngestUpload` → `upload.ts#uploadSegmentReviewBytes` →
`POST /api/imports/reviews/launches/{launchRef}/ingest` (multipart; 파일명은 `artifactRef` 파생 opaque;
`scopeEvidence` 동봉) → `ReviewImportPlanController.ingestForLaunch` → `ReviewImportLaunchService`(ticket spend,
`ReviewImportIdentityFence`) → `ReviewImportRunService.importSegment(..., MACHINE_MATCHED|OPERATOR_CONFIRMED)` →
`FileUploadConnector.ingest(method=SELLER_CENTER_EXPORT)` → `UploadFormat`(바이트 sniff; NAVER export는
**확장자 없는 UUID 파일명**, 2026-08-23 실측) → `FileParser`(POI/commons-csv) → `ReviewRowMapper` →
`IngestionService.ingestReviews(..., acquisitionSyncJobId)`.
결과: `review_import_segment_attempt` 1행(SUCCEEDED/FAILED, 자기 sync_job), segment `COMPLETED+COVERED`,
`sync_jobs{method=SELLER_CENTER_EXPORT, data_type=REVIEW}`, `reviews.acquisition_sync_job_id` 스탬프.
`review_import_segment.rows_reconciled`는 **항상 false** — NAVER export 행 상한 미확인.

### 2.5 파일 lifecycle (판매자 PC)
- 감지된 download 바이트 → `.aw-quarantine/aw-quarantine-<artifactRef>`: 확장자 category + ZIP/OOXML magic sniff
  → **delete-after-validate**(`quarantine.ts`; `valid`는 `deleted`를 요구).
- 동시에 `saveManagedCopy` → `<helperHome>/downloads/<sanitized basename>` 에 **판매자용 사본 보존**
  (`cli/local-agent.ts:1780` 부근; best-effort, 이름 미로깅).
- 업로드는 메모리 바이트로. 파일명·경로·URL은 wire·로그·`.import-runs` 마커에 실리지 않는다
  (`findProhibitedFields` gate).

### 2.6 로컬 영속 상태 (`collector/.gitignore`)
`.profile/naver-agent-<hash24>/`(Chrome user-data-dir — NAVER 로그인 세션·cookie가 **여기 파일로 존재**) ·
`downloads/` · `.status/` · `.connections/` · `.bridge/`(pairing store, token은 SHA-256만) ·
`.operation-runs/`(v1 export) · `.import-runs/`(감사용 마커; 재시작 시 비terminal → **ABANDONED**, launch ref는
절대 디스크에 안 씀) · `.aw-quarantine/` · `.auth/device.json`(0600, `rvh_` device token).
루트는 `REVIEWNARY_HELPER_HOME`(패키지 도우미) ∥ collector 트리.

### 2.7 legacy 경로 (product path 아님)
`naver/review-export.ts#runExport`는 `page.click`으로 export trigger·modal confirm을 **직접 누른다**.
호출자는 `instruments/calibration/discover-export.ts` · `capture-export-same-session.ts` 뿐(운영자 gated
계측). `review-usage-confirm.ts`(approved-index 1클릭) · `account-store-continue.ts`(reconnect-continue 카드
guarded 1클릭 — `cli/continue-account-store-same-session.ts`, `naver/reconnect-resolve.ts`) ·
`export-click-diagnose.ts`(진단 1클릭)도 같은 부류. resident helper의 import carrier는 이들을 import하지
않는다(`naver-live-driver.ts` docblock "No legacy capture path" + source guard).

---

## 3. Cafe24 acquisition (API)

- `connector/cafe24/Cafe24ApiConnector.java`: `sellerops.connector.cafe24.enabled=true`일 때만 bean.
  `fetch(REVIEW)` = board 4 구매후기 `Cafe24BoardArticlesClient.fetchPage` → `Cafe24BoardArticleMapper.toCanonical`
  → `CanonicalCommunityArticle`. 비밀글은 fail-closed 제외(`isPublicPost()` 양성 판독만).
- 인증: refresh-token grant → **즉시 회전 write-back**(단일 사용 토큰) → 호출. 토큰은 `CredentialVault`
  `secrets.refresh_token`만 authoritative.
- canonical `reviews`로의 승격: `ingest/Cafe24ReviewIssueBridge`(신규) · `Cafe24ReviewPromotionReconciler`(과거)
  → `Cafe24ReviewPromoter.promote` — external_id `cafe24:b<board>:a<articleNo>`, `dedupKeyVersion=V1`,
  `replyState=UNKNOWN`, product는 `product_no`를 SKU로 링크.
- 실행자: `SyncRunExecutor`(스케줄 또는 수동) → cursor `Cafe24ArticleCursor`. 라이브 2026-07-30/31.
  운영 지원 ❌(플래그 off).
- **브라우저 0 · 판매자 개입 0**(OAuth 최초 동의 제외).

## 4. Coupang acquisition (WING 상품평 · READ 감독형)

- 공식 API·export **없음**(2026-08-14 전수 확인). 정책: DEVELOPMENT `PILOT_ALLOWED` / GA `POLICY_GATED`
  (`docs/coupang_review_policy_gate_v1.md`).
- 흐름: FE/대화가 `ChannelReviewAcquisitionService.mint`(COUPANG · API-mode 계정 · session slot 필수 ·
  `acquisitionRef` TTL 10분) → 도우미 `acquire/coupang` carrier(`activateCoupangReviewAcquisition`) →
  `POST /api/agent/review-acquisition-targets`(ref 소진) → `ReviewAcquisitionEngine`(effect `RESOLVE·READ·
  HANDOFF·CLEANUP`, 클릭 0) → 판매자가 WING 상품평 페이지를 **직접 넘기고** 도우미가 `offerPage`로 읽음
  (`review-acquisition.ts`; pager를 읽어 완주 판정, 못 읽으면 `UNKNOWN`으로 중단·coverage 미주장) →
  걷기 끝에 **한 번의** `POST` (`review-handoff-client.ts`; 재시도 없음 — `received` 이중 계상 방지) →
  `AgentReviewHandoffService` → `IngestionService`(method `SELLER_CENTER_READ`, dedup **v2/v3**, 옵션ID 1차
  resolve, 작성자 값 **미전송·미저장**).
- 라이브 2026-08-15(22건) · 2026-08-23(멱등·attribution 23/23).
- 파일 없음. 브라우저는 NAVER와 같은 도우미 Chromium(계정 slot profile).

---

## 5. Local Agent(“reviewnary 도우미”) 현재 책임

| 책임 | 코드 | 상태 |
|---|---|---|
| loopback 브리지(pairing·health·carrier slot) | `bridge/bridge-server.ts` · `pairing.ts` · `origin-policy.ts` | 제품 경로. `ws` 라이브러리, 127.0.0.1 전용, origin allow-list(wildcard 무시), 단일 사용 ticket, 서버 heartbeat |
| 사람 승인 채널 | `bridge/macos-approval-presenter.ts` | macOS native(osascript)만. 없으면 `503 approval_unavailable` fail-closed |
| 백엔드 인증 | `auth/helper-session.ts` | device token(`rvh_`, RFC 8628 모양) — `docs/helper_device_authentication_v1.md`. 판매자 비밀번호 **미보유** |
| on-demand carrier 7종 | `cli/local-agent.ts#RESIDENT_CARRIER_ACTIVATORS` | `issuance/coupang · issuance/naver · renewal/coupang · locate/coupang · import/naver · acquire/coupang · reply/naver` |
| 브라우저 소유 | `profile.ts#launchNaverContext` (Playwright bundled Chromium 또는 `COLLECTOR_BROWSER_CHANNEL`=chrome) | 계정 slot별 persistent profile |
| Action Window 엔진·세션·드라이버 | `action-window/**` | 순수 엔진 + 주입 드라이버 |
| 로컬 상태 dot-dir | §2.6 | gitignored |
| 패키징/설치 | `tools/helper/build-macos.sh` · `cli/local-agent-service.ts`(launchd `ai.sellerops.local-agent`) | **macOS 전용, 아키텍처별, 서명 없음** |
| (별도 boot) 다채널 connector orchestrator | `local-agent.ts --connections` → `LocalAgentConnectorStartup` → `ConnectorOrchestrator` → `BrowserChannelConnector` → Progressive Reconnect | **리뷰 product path 아님**. NAVER는 registry에 `BROWSER/AVAILABLE`로 선언되지만 유일한 실제 browser port(`progressive-reconnect-chrome.ts`)는 ESM 로그인 표면 전제. `[이 boot의 NAVER 라이브 상태 미확인]` |

도우미가 **하지 않는 것**(코드로 고정): 마켓플레이스 클릭·타이핑·export·submit(`.click(`는 `reply-composer-open.ts`
한 곳 1회 + legacy 계측 모듈뿐, source guard) · 로그인 자동화 · CAPTCHA/2FA · cookie 직렬화/전송 · 스케줄 실행.

---

## 6. browser 실행 코드

- 유일한 product-path 런처: `profile.ts#launchNaverContext(profileDir, channel?, policy?)` →
  `chromium.launchPersistentContext(userDataDir, {headless:false, acceptDownloads:true, chromiumSandbox:true,
  channel?})`. `markProfileCleanExit`로 crash-restore bubble 억제. `resolveProfileDir`가 helperHome 밖 경로 거부.
- `launchPersistentBrowser` = 같은 함수의 채널 무관 alias(ESM은 다른 profileDir).
- Progressive Reconnect(ESM): `progressive-reconnect-chrome.ts` — **실제 Chrome Stable spawn + `connectOverCDP`**
  (`navigator.webdriver=false`, `--enable-automation/--use-mock-keychain/--headless` 거부). 리뷰 경로 미사용.
- `local-agent-launch.ts`: macOS에서 `--use-mock-keychain` drop(OS Keychain 자동완성). 리뷰 경로 미사용.
- ADR(`docs/sellerops_local_agent_runtime_adr.md` §2): 실제 Chrome+전용 프로필+CDP 유지, Electron 미채택,
  인앱 프로젝션은 **미구현** 목표.

## 7. login / session / cookie

- **로그인 자동화: 없음**(NAVER). 판매자가 도우미가 띄운 창에서 직접 로그인·2FA·계정 선택.
- **세션 판정**: `session.ts#detectSession`(3-state, fail-safe LOGGED_OUT) · `naver/session-verdict.ts`(5-state) ·
  `session-probe.ts`(sanitized signals) · `naver-session-precondition.ts`(→ blocker code). 판정 입력은
  URL 카테고리·password field·auth challenge·GNB/logout/export 존재 boolean뿐.
- **세션 저장 위치**: Chromium persistent profile 디렉터리(파일). 코드가 cookie를 읽는 유일한 곳은
  `naver/storage-collect.ts`(`context.cookies()`) — 진단 프로브, 이름 hash·길이 bucket만 출력. 전송·저장 0.
- **세션 복구**: `RECONNECT_REQUIRED`(Commerce 계정 선택 interstitial)는 판매자 클릭. legacy
  `account-store-continue.ts`만 guarded 1클릭(계측).
- **readiness 영속**: `POST /api/imports/reviews/launches/{ref}/session-readiness` →
  `account_session_slot.readiness_state`(`READY · LOGIN_REQUIRED · TWO_FACTOR_REQUIRED · ACCOUNT_AMBIGUOUS ·
  EXPIRED · UNOBSERVED_EXTERNAL`) + `readiness_reason`(`AGENT_START · BEFORE_WORK · SESSION_FAILURE ·
  MANUAL_RECHECK`). collector 쪽 `session-readiness.ts`는 "not yet driven by the live agent loop"라 적고
  있으나, `activateNaverReviewImport`가 `core.onAgentStart()`(UNOBSERVED_EXTERNAL)를 호출하고
  `ReadinessObservingImportDriver`가 `prepareSurface` 결과를 관측한다. `[네 시점 전부 라이브 보고되는지 미확인]`
- ESM Progressive Reconnect(리뷰 경로 밖): Chrome Keychain 자동완성 관찰 + **최대 1회 gated submit**.
  `AutoReconnectCapability`는 `CONDITIONAL`이지 `VERIFIED`가 아니다.

## 8. scheduler / job

**backend** (API 채널 전용):
- `SyncScheduler`(`sellerops.collect.scheduler-enabled`, 60s tick) → `SyncScheduleClaimer`(`FOR UPDATE SKIP LOCKED`,
  INTERVAL만, at-most-once per tick) → `SyncScheduleRunner`(성공=cadence, 429=retry-after≥1m, 실패=1/5/25m backoff,
  3회 연속 실패=DEGRADED+alert) → `SyncRunExecutor`(PullConnector 페이지 순회, `sync_cursors` 전진,
  `SyncRunGate` 단일 비행 + stale 회수).
- `SelfPilotReconciler`(`sellerops.self-pilot.enabled`, scope `ALLOW_LIST|CONNECTED_SELLERS|ALL_ORGS`):
  CONNECTED 계정에 기본 schedule 생성. **Action Window 데이터 타입(NAVER REVIEW·Coupang REVIEW)은 절대 schedule을
  받지 않는다**(docblock).

**collector**: `connection/sync-state.ts`(타입만) · `esm/esm-ttl-schedule.ts` · `LocalAgentRuntime`(offline
orchestration, catch-up executor 주입형) — **NAVER 리뷰에 대한 라이브 스케줄러는 존재하지 않는다**. ADR §3.3
"주기 실행(catch-up)은 not-yet-existing slice".

⇒ **NAVER 리뷰는 매 run이 판매자 착석 run이다.** unattended 실행은 코드에도 정책에도 없다.

## 9. file download / watch / import

- download 감지: Playwright download event(§2.3). 파일 시스템 watch는 없다.
- 판별: 확장자가 아니라 **바이트**(`quarantine.ts` ← `review-download-save.ts#sniffXlsxReadable`; 백엔드
  `UploadFormat`) — 두 경로가 같은 계약(2026-08-23).
- 수동 fallback: FE 세그먼트 파일 업로드 → `ReviewImportRunService.importSegment(..., OPERATOR_CONFIRMED)`.
  일반 업로드: `POST /api/uploads`(`UploadController`, `channelId·uploadType·method?·file`, 10MB).
- 계약 fixture: `contracts/review-export/naver/v1/`(`naver-review-export-v1.xlsx` · `expected-rows.json` · SPEC).

## 10. parser / normalization

- **백엔드가 파서다.** `ingest/parse/FileParser`(POI XSSF, zip-bomb guard, BOM strip) → `ParsedTable` →
  `ingest/map/ReviewRowMapper`(`HeaderAliases`: 내용/리뷰내용…, 상품명/sku, 평점/별점, 작성일/리뷰등록일,
  리뷰id/리뷰글번호→`externalId`, 답글여부→`ReviewReplyState`, 답글등록일시) → `CanonicalReview`.
- collector `review/review-normalizer.ts`는 offline spec-layer(`SellerOpsReviewEvent`)이고 소비자는
  `events/sanitized-summary.ts`뿐 — **ingest 경로에 없다**. `xlsx/workbook-shape-read.ts`는 셀을 읽지 않는
  구조 리더(artifact parse gate).
- Coupang은 파일 없이 화면 행을 `review-rows.ts#canonicalizeReviewRows`가 정규화한다.

## 11. ingestion API

| endpoint | 인증 | 호출자 | 비고 |
|---|---|---|---|
| `POST /api/uploads` | JWT | FE · `cli/upload-file.ts` · legacy `uploadReviewFile` | `method` 생략=MANUAL_UPLOAD |
| `POST /api/imports/reviews/launches/{ref}/ingest` | JWT 또는 device token | 도우미 import carrier · FE 수동 fallback | ticket 소진, `scopeEvidence`, `ReviewImportIdentityFence` |
| `GET  /api/imports/reviews/launches/{ref}/scope` | 동상 | 도우미 | kind·channelCode·accountSlot·required |
| `POST /api/imports/reviews/launches/{ref}/session-readiness` | 동상 | 도우미 | readiness 영속 |
| `POST /api/agent/review-handoff` | device token | 도우미 Coupang carrier | `AgentReviewHandoffController` |
| `POST /api/agent/review-acquisition-targets` | device token | 도우미 | acquisitionRef 소진 |

device token의 허용 경로는 `HelperDeviceAuthFilter` allow-list(`docs/helper_device_authentication_v1.md`).
`[정확한 allow-list 항목은 이번 inventory에서 파일을 열지 않았음]`

## 12. dedup / idempotency

- DB: `uq_reviews_external (org_id, channel_id, external_id) where external_id is not null` ·
  `uq_reviews_hash`(V2). 
- 규칙(`IngestionService` + `ReviewDedupKey`): external_id 있으면 그것으로; 없으면 `ContentHash`(NFC·lower·공백
  collapse) — v1 `channel|product|date|body`(NAVER·Cafe24), v2 `+rating`(GMARKET·COUPANG), v3 `+optionId`
  (textless). 행 단위 트랜잭션; `DataIntegrityViolationException`이면 키 재조회 → 중복 skip / 진짜 실패 구분.
- NAVER 재export의 33/33 중복 skip이 2026-09-02 라이브로 확인됨.
- ticket 단일 사용: 같은 ref 2회 ingest → 409. run 마커는 ref를 안 들므로 재시작 = 새 ticket.
- Coupang: 같은 목록 2회 → `stored=0 skipped=n`(2026-08-23).

## 13. retry / failure handling

- **import 엔진**: blocker `LOGIN_REQUIRED · SESSION_EXPIRED · UNSUPPORTED_STATE · TARGET_NOT_FOUND ·
  TARGET_AMBIGUOUS · SCOPE_MISMATCH · DOWNLOAD_TIMEOUT · ARTIFACT_INVALID · INGEST_FAILED · RUNTIME_FAULT` +
  reliability park 7종(`SURFACE_OPEN_FAILED · PREPARE_NOT_STARTED · SURFACE_SETTLE_TIMEOUT ·
  GUIDANCE_PACK_REJECTED · OVERLAY_MOUNT_FAILED · OVERLAY_NOT_VISIBLE · SURFACE_CLOSED`, 전부 recoverable).
  세션/scope park는 자동 재프로브(2026-09-02). 판매자 명령: `REQUEST_STEP_RECHECK · PAUSE_RUN · CANCEL_RUN ·
  SWITCH_TO_MANUAL · SET_GUIDANCE_ENABLED · FIND_CURRENT_STEP`.
- **재시작**: `.import-runs` 비terminal → ABANDONED, 재구동 0. 서버가 plan/segment를 들고 있어 다음 run이 이어받음.
- **서버 attempt**: 실패는 `SUCCEEDED/FAILED` attempt 행 + 새 ticket으로 재시도. execution과 coverage 분리.
- **로그 latch**: `aw_acquisition_terminal{code,stage}`(2026-09-02 closure) — terminal 실패가 침묵하지 않음.
- **API 채널**: §8의 backoff/DEGRADED/alert.

## 14. channel / store identity

- 백엔드: `seller_accounts`(org · channel · CONNECTED · is_file_upload) ↔ `account_session_slot.account_slot`
  (24자 opaque, 계정당 1개, 영구) → 도우미 profile dir. `ReviewImportIdentityFence`: JWT org == plan org ==
  segment org == account org == ticket org, 매 join 재증명. `ExecutableIdentityResolver`: `MARKETPLACE`는
  provenance(acquisition_sync_job → attempt → plan → CONNECTED non-file 계정 + 리뷰글번호)에서만.
- collector: `naver/account-fingerprint.ts`(연결 온보딩 시 로그인 후 stable identity token → hash → 연결에 바인딩),
  `account-store-resolver.ts`(expected channel code/store fingerprint와 후보 대조, 정확히 1개일 때만 RESOLVED),
  `connection/seller-account-fingerprint.ts`, reply lane의 `session-account-verify.ts`.
- **import 경로의 공백(CURRENT FACT)**: `action-window/initial-import/**` · `cli/local-agent.ts`의 import
  carrier · `bridge/**`에는 위 identity 모듈 참조가 **0**이다. 즉 guided import는 「slot별 profile 디렉터리 격리」
  로 스토어 분리를 보장할 뿐, **run 시점에 로그인된 스토어가 slot의 계정과 같은지 대조하지 않는다.** 판매자가
  그 profile 창에서 다른 스토어로 로그인하면 잡을 장치가 없다. (다중 스토어 검증은 §4.1에 "계정 1곳만 검증".)

## 15. Review Core ↔ acquisition coupling

| Core 컴포넌트 | acquisition을 아는가 |
|---|---|
| `reviews` 스키마 | `acquisition_sync_job_id`(nullable, 백필 없음) · `dedup_key_version` · `source_option_id` |
| Review Attention / triage | 모름 — `reviews`만 읽음. `data_origin` 필터만 |
| Repeated Issue / issue memory | `ReviewSegmentIngestedEvent`로 refresh 트리거(경로 무관) |
| Product Intelligence / item analysis | `IngestFollowUp`가 inserted id로 호출 |
| Reply lane / executable identity | `ExecutableIdentityResolver` — **method + launch binding**에 의존(NAVER `MARKETPLACE`의 유일한 근거) |
| Coverage / freshness | `ChannelCoverageService.lastSuccessfulSync(org, channel, "REVIEW")` = `sync_jobs` 중 `method.observesChannel()`(SELLER_CENTER_EXPORT·READ)이고 `data_type=REVIEW`인 최신 SUCCESS/PARTIAL |

⇒ 취득 방식이 바뀌어도 Core가 요구하는 것은 **네 가지뿐**: (a) `CanonicalReview` 모양, (b) `sync_jobs` 1행에
`method`+`data_type`, (c) `reviews.acquisition_sync_job_id`, (d) `MARKETPLACE` 판정을 위한 launch binding.

## 16. security / credential boundary

| 비밀 | 보관 | 접근 |
|---|---|---|
| NAVER 판매자센터 로그인 | **판매자 PC Chrome profile 파일**(`.profile/naver-agent-*`)에만. 서버·도우미 코드·wire·로그 0 | 판매자만 타이핑 |
| NAVER Commerce API client id/secret(주문 API) · Cafe24 refresh token · Coupang HMAC | 백엔드 `connector_credentials`, envelope AES-GCM, master key `SELLEROPS_VAULT_MASTER_KEY` + `VaultKeyRing` | `CredentialVault.open`만, 커넥터 실행 시 |
| 도우미 → 백엔드 | `rvh_` device token(서버는 SHA-256만, allow-list 경로, 즉시 revoke) | `.auth/device.json` 0600 |
| FE → 도우미 | pairing token(hash at rest) + 단일 사용 WS ticket + origin allow-list + macOS native 승인 | loopback only |
| run 권한 | `launch_ref`/`acquisitionRef` 16-hex 단일 사용, 서버가 범위 해석 | 디스크 미기록 |

wire/영속 금지 필드: selector·URL·path·credential·page content(`contracts/action-window/v2#findProhibitedFields`,
run store save/load 양쪽 gate). `log.ts`가 secret-ish 키를 드롭.
마켓플레이스 WRITE: 리뷰 취득 경로 **0**(reply lane은 별도, 여기 범위 밖).

## 17. user intervention (NAVER guided import, 한 세그먼트)

1. 도우미 설치·실행(macOS launchd) · FE pairing 승인(native dialog)
2. 도우미가 띄운 창에서 NAVER 로그인 · 2FA · 계정/스토어 선택
3. 시작일 · 종료일 입력(가이드 ring)
4. 조회 클릭
5. (read-back 실패 시) 범위 확인
6. export 클릭(둘 중 하나)
7. 동의 dialog 확인 클릭
8. (목록 기간 밖이면) 기간 컨트롤 변경 — reply lane에서 관측, import에서도 같은 UI
9. 다음 세그먼트 시작(패널 버튼 → FE가 ticket 발급)
10. 실패 시: 다시 확인 / 수동 업로드 전환

## 18. known limitations (코드·기록에서 확인된 것)

- 도우미 **macOS 전용**, 서명 없음, 아키텍처별 빌드(`build-macos.sh`). Windows 미검증(ADR §1).
- NAVER export **행 상한 미확인** ⇒ `rows_reconciled=false` 영구.
- unattended 실행 **없음**; 세그먼트마다 판매자 착석.
- 스토어 identity run-time 대조 **없음**(§14); 다중 스토어 계정 라이브 검증 **1곳**.
- 재시작 시 run **ABANDONED**(설계).
- NAVER UI 변경에 취약한 곳: export 키워드 표 · 동의 dialog 문맥 규칙 · 날짜 input locate · iframe 해석
  (전부 in-page 구조 규칙; 2026-07-25 iframe, 2026-08-23 listener, 2026-09-02 두 컨트롤 등 라이브마다 수정 이력).
- 조회 기간 UI가 목록 필터를 정하며 pagination은 숫자 pager가 없다(reply lane census 실측) ⇒ 오래된 리뷰는
  기간 변경이 유일한 경로.
- Coupang: 정책 GA gate, 작성자 미저장, textless 병합 잔여.
- `CollectionRunService` docblock stale(§1.2).

## 19. code reference index

collector: `src/cli/local-agent.ts`(1498 `activateNaverReviewImport` · 1711 `buildNaverImportCarrierCore` ·
2182 `runBridgeOnlyBoot`) · `src/profile.ts` · `src/session.ts` · `src/naver/{session-check,session-verdict,
session-probe,storage-collect,export-scope-match,import-locate,review-export(legacy),review-download-save}.ts` ·
`src/action-window/{naver-live-driver,naver-acquisition-adapter,quarantine,ingest-handoff,run-store}.ts` ·
`src/action-window/initial-import/{import-engine,import-stages,import-session,import-host,import-dispatch,
import-run-store,import-driver,naver-live-import-driver,lazy-import-driver,readiness-observing-driver,
session-readiness,guided-preflight,reliability-failure}.ts` · `src/action-window/coupang-review/{review-acquisition-engine,
review-acquisition,review-handoff-client,review-rows}.ts` · `src/bridge/{bridge-server,pairing,origin-policy,
initial-import-endpoint,aw-carrier,on-demand-carrier-host}.ts` · `src/auth/helper-session.ts` · `src/upload.ts` ·
`src/config.ts` · `src/status.ts` · `src/agent/{progressive-reconnect,progressive-reconnect-chrome,
local-agent-runtime,local-agent-connector-startup}.ts` · `src/connector/{channel-registry,connector-orchestrator}.ts`.

backend (`com.sellerops`): `upload.UploadController` · `connector.FileUploadConnector` · `ingest.{IngestionService,
ReviewDedupKey,ContentHash,IngestFollowUp,Cafe24ReviewPromoter}` · `ingest.parse.{UploadFormat,FileParser}` ·
`ingest.map.ReviewRowMapper` · `reviewimport.{ReviewImportPlanService,ReviewImportLaunchService,
ReviewImportRunService,ReviewImportIdentityFence,ScopeEvidence,ReviewImportPlanController}` ·
`collect.{SyncScheduler,SyncScheduleClaimer,SyncScheduleRunner,SyncRunExecutor,SyncRunGate,
AgentReviewHandoffService,AgentReviewAcquisitionController,AcquisitionPathRegistry}` ·
`collect.runtime.{CollectionMethod,CollectionRunService}` · `connector.{PullConnector,ConnectorRegistry}` ·
`connector.cafe24.Cafe24ApiConnector` · `connector.naver.NaverApiConnector` · `connector.coupang.CoupangApiConnector` ·
`credential.{CredentialVault,VaultKeyRing}` · `selleraccount.{AccountSessionSlotService,SessionReadinessState,
SessionProbeReason}` · `identity.ExecutableIdentityResolver` · `coverage.ChannelCoverageService` ·
`selfpilot.SelfPilotReconciler` · `review.{Review,ReviewRepository}` · `review.channel.ChannelReviewAcquisitionService`.

migrations: `V2__file_ingest.sql`(unique idx) · `V27__review_import_plan.sql` · `V28__review_import_launch.sql` ·
`V30__account_session_slot.sql` · `V83__review_acquisition_sync_job.sql`.

contracts: `action-window/v2` · `review-import-journey/v1` · `session-readiness/v1` · `acquisition/v1` ·
`review-export/naver/v1` · `review-fingerprint/v1`.

docs: `multi-channel-connector-roadmap.md` §4.1 · `sellerops_local_agent_runtime_adr.md` ·
`action-window-runtime/HANDOFF.md` · `resident_helper_on_demand_carrier_v1.md` ·
`channel_integration_completeness_audit_v1.md` · `naver_guided_acquisition_e2e_v1.md` ·
`naver_guided_acquisition_live_findings_closure_v1.md` · `helper_device_authentication_v1.md` ·
`local_helper_pilot_packaging_v1.md` · `coupang_review_acquisition_v1.md` · `coupang_review_policy_gate_v1.md` ·
`evidence/INDEX.md`.

---

## 부록 B. Git provenance audit (2026-09-12, 읽기 전용)

> 이 부록은 CURRENT FACT의 **출처 commit**을 적는다. 본문의 사실은 바꾸지 않는다.

- branch `feat/proactive-operations-agent-v1` · HEAD `6523fc9c5450963d49dbec44fe7a192c04bb3669`(2026-09-12, docs-only:
  `docs/review_triage_contract_v2.md`). `main`(`2491f1ab`)보다 **253 commit 앞**, main은 0 앞. 원격 tracking branch **없음**
  (`git branch -r --contains HEAD` = 0).
- working tree: modified **71** · untracked **25**(이 세 문서 포함). `collector/` **dirty 0** · `contracts/`는
  `review-triage-events/v1/CONTRACT.md` 수정 + `product-truth/` untracked · migration은 `V99__seller_triage_correction.sql`
  untracked(HEAD 최고 `V98`).

| 본문 절 | 핵심 code path | 최종 commit | 분류 |
|---|---|---|---|
| §2 NAVER launch/import · §5 브리지 · §6 브라우저 | `collector/src/**`(local-agent.ts `7c86e314` · import-host `e334b30e` · import-driver `9b4e0c6f` · bridge-server `b7db225e` · profile `7639c98e`) | 2026-09-02~05 | **HEAD_PROVEN** |
| §4 Coupang acquire | `review-acquisition-engine.ts` `29aac9b2` · `AgentReviewHandoffService` `29aac9b2` | 2026-08-28 | **HEAD_PROVEN** |
| §3 Cafe24 review connector | `Cafe24ApiConnector` `3a34c5fc` | 2026-08-26 | **HEAD_PROVEN** |
| §8 sync_jobs · §11 ingestion · §12 dedup · §15 follow-up | `SyncJob` `c972b31f` · `IngestionService` `29aac9b2` · `IngestFollowUp` `639748e0` | — | **HEAD_PROVEN** |
| §14 account slot/profile · `ReviewImportLaunchService` · `ExecutableIdentityResolver` | `e3d2035a` · `ddb35951` · `29aac9b2` | — | **HEAD_PROVEN** |
| §16 `CredentialVault` | 코드 동일; **docblock만 worktree 수정**(stale 문장 교정, +7/−2) | — | **MIXED**(동작 HEAD_PROVEN, 주석 WORKTREE_ONLY) |
| §1.2 `AcquisitionPathRegistry` / capability overview | `AcquisitionPathRegistry` clean; `CollectControlService`·`ChannelCapabilityOverview`는 worktree에서 `backgroundDataTypes`·`declaredSupport` 추가(Product Truth 패키지) — 본문 미인용 | — | 본문 범위 밖 · WORKTREE_ONLY |
| `ChannelApiGapRegistry` | worktree에서 COUPANG `REVIEW_REPLY` gap 추가 — 본문 미인용 | — | 본문 범위 밖 · WORKTREE_ONLY |
| §4.1 표 인용 | `docs/multi-channel-connector-roadmap.md` worktree 수정은 Cafe24 PRODUCT 행·archive 경로 2곳; **NAVER/Coupang REVIEW 행은 HEAD와 동일** | — | **HEAD_PROVEN** |

결론: 이 문서가 인용하는 acquisition code path는 **전부 HEAD에 있으며 worktree 수정에 의존하지 않는다.** dirty 상태는
다른 두 패키지(Seller Triage Correction T-07 · Canonical Product Truth / Product Self-Knowledge Truth Closure)의 것이다.
