> **⚠ RETIRED AS CURRENT-STATE AUTHORITY — historical handoff, not live truth.**
> This document is **no longer** the SellerOps current-state source of truth. Its body is a
> **2026-07-08 snapshot** (with partial 07-15 / 07-18 patches) that predates PRs #317–#322 and
> the repo restructure — readable for lineage, **not citable for current state**.
>
> - **Product / strategy / state authority:** [`docs/sellerops_canonical_reference.md`](sellerops_canonical_reference.md)
> - **Repo overview & working rules:** [`README.md`](../README.md) · [`CLAUDE.md`](../CLAUDE.md)
> - **Action Window / runtime status of record:** [`docs/action-window-runtime/HANDOFF.md`](action-window-runtime/HANDOFF.md)
>
> Everything below is preserved unchanged for historical lineage. Do not rely on its paths,
> commit SHAs, scope-lock versions, or 구현됨/미구현 claims as current.

---

## 2026-08-04 부록 (15) — NAVER Credentials Row Highlight v1: credentials 하이라이트를 라벨 `<th>` → 부모 `<tr>`로 승격 (오프라인+실chromium 완료, 라이브 대기)

> 부록(14) 라이브 재검증 #2가 확정한 COVERAGE 갭(credentials overlay가 `<th>` "애플리케이션 ID" 라벨 셀만 감싸고 값 `<td>` 포함 행 전체 아님)을 정본 구현. 세부: 슬라이스 §0.2.19. **collector 3파일만; 백엔드·FE·selector 앵커·상태기계·bridge·runner·telemetry 불변.**

- **앵커 불변 / 태그 대상만 승격**: credentials 고정라벨 앵커(candidateQuery+exactText)는 adopted probe에서 무드리프트 파생 그대로. 읽기전용 태그 `data-aw-target`를 매칭 라벨 셀에서 `el.closest("tr")`로 이동 → overlay가 행 전체(라벨+값 셀) 박싱. **값 `<td>` 미판독**(closest=구조 탐색만, 값 문자열/innerText/textContent/.value 미판독; 스크립트는 여전히 `{count, sig?}`만 반환).
- **anti-drift sig 불변**: sig는 라벨 `el` 기준 계속 계산(승격 조상 `tr` 아님) → locate(태그 없음)↔highlight(태그+승격) 시그니처 일치 byte-불변. locate 경로(tag=false)는 승격 블록 미방출.
- **fallback / 타깃 격리**: `<tr>` 부재 시 라벨 셀 유지(조용한 드롭 없음). create_app(버튼)·api_group(헤딩)은 `tagAncestor` 없음 → 태그 로직 byte-불변. credentials만 `TAG_ANCESTOR={credentials:"tr"}`.
- **3파일**: `visual-recon-inpage.ts`(`buildFixedLabelLocateScript` 옵션 `tagAncestor`), `issuance-highlight-selectors.ts`(`IssuanceFixedLabelLocator.tagAncestor?`+`TAG_ANCESTOR` 배선), `naver-issuance-driver.ts`(`issuanceLocateScript` 통과).
- **테스트**: 헤르메틱 스크립트-텍스트(closest("tr")+fallback+sig on el+값-미판독, create_app/api_group closest 부재) + **실 chromium**(RUN_INTEGRATION) 실 KV 테이블에서 `data-aw-target`가 `<tr>` 안착·UUID값 미반환·`<tr>`부재 fallback·api_group 승격 없음 + 갱신 selector 레지스트리(credentials만 tagAncestor:"tr", 앵커는 필드별 단언으로 드리프트 마스킹 방지).
- **게이트**: collector typecheck green; 전체 **6312 passed**/138 skip/0 fail; 실 chromium tag-promotion **7/7**(RUN_INTEGRATION) green. `git diff --check` 클린, package/lock 불변.
- **독립 리뷰 = HIGH 0 / MEDIUM 0.** 7 하드 제약 확인 + overlay 소비 안전(sig 무재계산, `closest`=라벨 자기 행). LOW 1(반영·코드 무변경): `closest("tr")`는 단일 key/value 행 전제 — 부록11 관측 shape(`<tr><th>애플리케이션 ID</th><td>값</td></tr>`)+ID/Secret probe 분리가 행-분리 레이아웃 시사 → 코드 무변경, 라이브에서 행 shape 함께 확인.
- **라이브 커버리지 확정(2026-08-04, gated `apr-68de4dbfe24a`/`wt-0abd156b646f`/`048c1b8`, 실제 NAVER 기존-앱 상세, 소진·클린):** 자연 존재-앱 흐름으로 api_group `aw_issuance_stage_ok{mounted:true}`(조작자 "보여") → 조작자-확인 `REQUEST_STEP_RECHECK` 1회 → `aw_issuance_stage_ok{credentials, attempt:0, tagged:true, mounted:true}`, 두 곳 mount fault 전무. **조작자 육안(값 미판독): "행 전체 감싸고 있어. id와 시크릿은 별도의 행이고"** = credentials 하이라이트가 라벨 `<th>` 아닌 **행 `<tr>` 전체(값 셀 포함)** 박싱 **라이브 증명**; 리뷰 LOW(다열 과박싱) 라이브 배제(ID/Secret 행-분리 확정). 값·Secret·스크린샷·클립보드 미판독, return·step5·추가 "다음" 없이 즉시 teardown, :47615 free, 코드 미변경, 그랜트 소진.
- **상태**: **오프라인/실-chromium/라이브 모두 완료 — 커버리지 목표 라이브 증명.** 부록14 credentials 행-커버리지 갭 종결. push/PR 없음.

---

## 2026-08-04 부록 (14) — Overlay Mount Fix v1: overlay mount의 esbuild `__name` 심 누수 제거 (현행 issuance 상태, 오프라인+실chromium+라이브 재검증 완료)

> `Overlay Mount Fix v1`. 부록(13)이 확정한 원인(`position_overlay`/`SYMBOL_NOT_DEFINED`)을 오프라인 재확인 후 수정. 세부: 슬라이스 §0.2.18. **overlay 1파일(`overlay.ts`)만; selector·상태기계·bridge·runner·telemetry 불변.**

- **원인 오프라인 재확인(라이브 불필요)**: `overlay.ts`를 tsx와 동일(esbuild `keepNames`)하게 변환 → `mountOverlay`의 직렬화 page 본문에 `const reposition = __name(() => {…}, "reposition")` 정확히 확인. `page.evaluate`는 콜백 본문만 페이지로 보내는데 모듈스코프 `__name` 헬퍼는 미전달 → 페이지에서 `ReferenceError: __name is not defined`. `reposition`이 mount IIFE 유일 name-inferable 클로저(untrack `obj[key]=()=>{}` = computed-assignment는 이미 clean).
- **수정**: `const reposition = [ () => {…} ][0]!` — 배열-리터럴 index initializer는 name-inferable 아님 → esbuild가 `__name` 래퍼 미방출, 런타임 동작 동일(stable ref 유지). `(0,…)` sequence는 tsc TS2695 거부 → 배열-index 채택.
- **회귀 테스트**: `overlay-mount-shim.test.ts`(transform-레벨, 권위): esbuild(keepNames) 변환 후 **파일 내 모든 `page.evaluate` 콜백**(balanced-paren 추출)에 `__name(` 부재 단언 + positive control + reposition 참조 유지. 미래 어느 evaluate 콜백에라도 name-inferable 클로저 추가 시 라이브 아니라 이 테스트에서 실패.
- **게이트**: collector typecheck green; 전체 **6307 passed**/135 skip/0 fail; 실 chromium overlay(RUN_INTEGRATION fixture-browser 10/10, mount+reposition 실동작) green. 독립 리뷰 **HIGH 없음**; MEDIUM 1(가드 전 evaluate 일반화)·LOW 2(TS2695 명시·정규식 완화) 반영.
- **라이브 재검증 확정(2026-08-04, 2회):** #1 `apr-fa311753d4d8`/`17cb404`: api_group mount 1회 → `aw_issuance_stage_ok{api_group, attempt:0, tagged:true, mounted:true}` + fault 전무 + 조작자 육안 "보여". #2 `apr-4aaf216197e7`/`8fb5513`(overlay=17cb404 동일): api_group 확인 후 조작자-확인 `REQUEST_STEP_RECHECK` 1회로 step4 진행 → `aw_issuance_stage_ok{credentials, attempt:0, tagged:true, mounted:true}` + fault 전무. **api_group+credentials 두 overlay 모두 실제 렌더** → 부록12/13의 `position_overlay`/`SYMBOL_NOT_DEFINED` blocker **최종 종결(라이브, credentials까지)**. credentials 값·스크린샷 미판독, 성공 즉시 teardown, 코드 미변경. **[신규 발견]** credentials overlay가 `<th>` "애플리케이션 ID" 라벨 셀만 감싸고 행 `<tr>` 전체 아님(calibration 부록11의 "행 `<tr>` 권장" 미구현) = highlight COVERAGE 후속 UX 후보(mount 범위 아님).

---

## 2026-08-03 부록 (13) — Overlay Mount Fault Identification v1: mount 내부 하위단계 + 코드기반 fingerprint (직전 진단 단위, 라이브 확정 완료)

> `Overlay Mount Fault Identification v1`. 부록(12)이 실패 단계를 `mount`/`reason=OTHER`로 확정했으나 **mount 내부 어느 라인**인지 미확정으로 남긴 공백을 좁힌다. **아직 overlay 동작 미수정**(수정은 다음 단위). `mountOverlay()` 내부를 하위단계로 분리, mount가 던지는 Error를 **먼저 코드기반 fingerprint로 분류**, **UNKNOWN일 때만** 진단 전용 sanitized message 부착. 세부: 슬라이스 §0.2.17. **상태 기계·selector·scroll·tag·bridge·runner 불변, 제어 흐름 불변**(관측 seam은 동일 error re-throw).

- **mount 하위단계**(`overlay.ts` in-page IIFE `__aw_mount_stage__` breadcrumb, **엄격 코드순·단조**): `find_tagged_target|remove_previous|reveal_target|create_overlay|inject_style|append_overlay|position_overlay|unknown`. 성공/no-op 시 breadcrumb **`delete`** → 이후 mount가 본문 실행 전 reject되면 stale 대신 `unknown`.
- **고정 fingerprint**(`fingerprintMountFault`, 순수, 원문 무유출): `CONTEXT_DESTROYED|FRAME_DETACHED|TARGET_CLOSED|SYMBOL_NOT_DEFINED|NULL_PROPERTY_ACCESS|NOT_A_FUNCTION|DOM_EXCEPTION|TYPE_ERROR|UNKNOWN`. **UNKNOWN일 때만** `sanitizeMountMessage`(URL·따옴표구간·숫자런 제거, 120자 캡; 프레임워크 문자열=페이지콘텐츠 아님).
- **관측 seam**(제어흐름 불변): 드라이버 `mountStepOverlay`가 mount throw catch → `readMountSubStage`(best-effort→`unknown`)+fingerprint → `aw_issuance_mount_substage_fault{target,subStage,reason,errorName[,message(UNKNOWN만)]}` → **동일 error 그대로 re-throw**. 상위 `stage:"mount"` catch·recovery byte-불변.
- **테스트(전부 offline)**: 드라이버 5 + 순수 헬퍼(모든 fingerprint 분기·null modern/legacy·DOMException-by-name·scrub·길이캡). collector typecheck + 전체 **6303 passed**. 독립 리뷰 **HIGH·MEDIUM 없음**(초기 MEDIUM 2 = `reveal_target` 단조화 + 성공시 clear, 전부 반영; LOW 2 문서 반영).
- **다음 = 단일 gated 라이브 진단 1회**(fresh PREPARED 준비 완료): 존재-앱 상세 api_group mount 1회 → `subStage`+(`UNKNOWN`이면)`message`로 **mount 내부 라인·원인 확정**. 수정은 그 다음 단위 — 자동클릭·다음단계·overlay 수정·push/PR 없음.
- **라이브 확정(2026-08-03, gated `apr-12fa19dfb4e6`/`wt-e40f5a50b070`/`43c56ff`, 실제 NAVER 존재-앱 상세, 소진·클린):** **mount 내부 실패 하위단계 = `position_overlay` 확정, fingerprint = `SYMBOL_NOT_DEFINED` 확정.** 자연 존재-앱 흐름(app_list 착지→START_RUN→open_app 관찰→앱 열기→app_detail 검증→step3 api_group highlight)으로 mount 1회 구동 → `aw_issuance_stage_ok{api_group}`(locate 성공) 직후 `aw_issuance_mount_substage_fault{subStage:"position_overlay", reason:"SYMBOL_NOT_DEFINED", errorName:"Error"}` **3/3 내부재시도 결정적**. find/remove/reveal/create/inject/append 통과, 마지막 `position_overlay`(최초 reposition()+scroll/resize 리스너)에서 throw. 부록12의 `OTHER`를 정밀화 — SYMBOL_NOT_DEFINED(= "… is not defined"). **인식된 fingerprint → message 무수집.** **강한 가설(다음 FIX 단위 확정 대상, 사실기록 아님)**: `position_overlay`의 named 클로저 `const reposition=()=>{}`를 tsx/esbuild(keepNames)가 `__name(...)`로 감싸는데 페이지 컨텍스트에 `__name` 부재 → `ReferenceError: __name is not defined`(function-form `page.evaluate`에 esbuild 심 누수; 드라이버 `evalStr`가 회피해온 계열). **다음 = `Overlay Mount Fix v1`**(mount evaluate가 심 미참조하게; selector·상태기계·bridge·runner 불변). "다음"·추가재시도·overlay수정·push/PR 없음.

---

## 2026-08-03 부록 (12) — Overlay Root-Cause Isolation v1: highlight 경로 단계별 sanitized stage telemetry (직전 진단 단위 — 라이브 확정 완료)

> `Overlay Root-Cause Isolation v1`. 부록(10) Reset의 "throw 지점 UNDETERMINED"를 **단 한 번의 gated 라이브 진단으로 정확한 실패 단계만** 확정하기 위해 driver highlight 경로에 **순수 관측** 추가. 세부: 슬라이스 §0.2.16. **상태 기계·selector·bridge·runner·overlay 로직 불변 — `naver-issuance-driver.ts` 한 파일.**

- **5단계 telemetry** `resolve|scroll|tag|mount|visible_check` + **고정 reason enum** `TIMEOUT|CONTEXT_DESTROYED|FRAME_DETACHED|TARGET_CLOSED|NO_PAINT|OTHER`(원문 message는 분기만·무기록). catch → `aw_issuance_stage_fault{target,stage,attempt,errorName(name-only),reason,timeout}`; swallowed scroll=별도 이벤트; tag 비유일=`_nonunique`; 성공=`_ok`. 값/텍스트/URL/셀렉터/원문 무유출.
- **제어흐름 등가**(독립 리뷰 확정): scroll catch undefined 반환·early-return·timeout·retry·throw 모두 byte-불변, 추가 await 없음.
- **가드**: 드라이버 소스가드 144 green(금지 토큰 미추가). 오프라인 테스트: 5단계 stage·reason 확정 + sanitization + happy stage_ok + swallowed/nonunique 분기. collector typecheck + 전체 **6275 passed**. 독립 리뷰 **HIGH·MEDIUM 없음**, LOW 3 전부 반영.
- **다음 = 단일 gated 라이브 진단**(존재-앱 상세에서 api_group highlight 1회 → stage+reason으로 실패 단계 확정). 수정·자동클릭·다음단계·push/PR 없음.
- **라이브 확정(2026-08-03, gated `apr-086d54491b64`/`wt-6866cb9cd980`/`77f83f4`, 실제 NAVER 존재-앱 상세, 소진·클린):** **실패 단계 = `mount` 확정.** app_detail 검증 후 `aw_issuance_stage_ok{api_group,tagged:false,mounted:false}`(resolve+scroll+tag 라이브 성공) 직후 `aw_issuance_stage_fault{stage:"mount",reason:"OTHER",errorName:"Error"}`가 **3/3 결정적** → park. reason OTHER = CONTEXT_DESTROYED/NO_PAINT/TIMEOUT 전부 아님 → **기존 "scroll→Angular 재렌더 context 파괴" 가설 반증.** mount evaluate가 미분류 일반 Error를 결정적으로 throw(원문 message는 범위상 미수집 → *왜*는 미확정). 다음 단위=`Overlay Mount Fault Message Capture & Fix v1`(mount OTHER fault에 sanitized message 캡처 → 1회 진단으로 원인 확정 → overlay mount 수정; selector/상태기계/bridge/runner 불변).

---

## 2026-08-03 부록 (11) — NAVER Element Calibration Diagnostic: app-detail 안정 앵커를 조작자 DevTools 증거로 확정 (직전 진단 단위)

> `NAVER Element Calibration Diagnostic`. 부록(10) Reset이 남긴 공백(**안정 DOM 앵커 미측정** — 존재-앱 하이라이트 실패의 뿌리)을,
> `Overlay Root-Cause Isolation`보다 먼저, **조작자 본인 DevTools 증거로** 확정한다. 세부: 슬라이스 §0.2.15 + `docs/slices/naver-element-calibration-snippet.md`.

- **얇은 READ-ONLY 런타임** `collector/src/cli/calibrate-element-anchors.ts`: dedicated Chrome를 한 번 열고(스크리닝된 base로 goto 1회) **대기만** —
  `.evaluate` 없음, 값/텍스트/속성 읽기 없음, 클릭·입력·재-내비게이션·하이라이트·태그 없음. 가드가 "아무것도 읽지 않음"을 증명.
- **게이트**: READ-ONLY 플래그(`--i-understand-this-inspects-live-naver-read-only`)만 허용; 모든 MUTATING 플래그 거부; URL fail-closed; production 거부; import inert.
- **증거 = 조작자 DevTools 스니펫**(value-scoped): api_group 라벨·애플리케이션 ID 라벨을 `$0`로 선택→ sanitized 구조만(tag/role/class/attr **이름**/테스트-훅 값/labelMatch/frame).
  **allowlist+positive-shape** 설계 — 값·outerHTML·쿠키·토큰·자유형 속성값(aria-label/상점명) 출력 불가. 누출 테스트 LEAKS=NONE.
- **보고 산출만**: 안정 앵커 후보 / 하이라이트 대상=라벨 vs 부모 섹션 / frame·surface 구조 / 다음 최소 수정안. **selector·상태 기계·overlay·bridge·runner 불변.**
- **상태**: 오프라인 완성(가드 63, collector typecheck+전체 6267 green), 독립 리뷰 HIGH·MEDIUM·LOW 전부 반영.
- **라이브 확정(2026-08-03, gated `apr-9c358c356136`/`wt-e6cccae6b69a`/`3d4d1a2`, 조작자 DevTools 증거, 값 미수신·소진·클린):** 페이지=Angular SPA(top-frame). `api_group`=`h4.sub-title`("API 그룹"), `credentials`(애플리케이션 ID)=테이블 행 `<tr><th>애플리케이션 ID</th><td>값</td></tr>`의 `<th>`. 둘 다 **id/role/data/aria 없음, `_ngcontent-*`(회전)+일반 클래스뿐 → 고정 한글 텍스트가 유일 앵커**(현행 fixed-label 설계 옳음 확정). 하이라이트 = api_group은 라벨 헤딩 자체, credentials는 행 `<tr>` 권장. **앵커 건전(matchCount=1) → 오버레이 미표시는 앵커 문제 아님** → 다음 단위 `Overlay Root-Cause Isolation v1` 그대로(가설: scrollIntoView가 Angular 재렌더로 직후 raw evaluate 컨텍스트 파괴 — 확정 아님). selector/상태기계/overlay/bridge/runner 미변경, push/PR 없음.

---

## 2026-08-03 부록 (10) — API Issuance Live Runtime Reset: 확정된 라이브 사실 baseline (직전)

> `API Issuance Live Runtime Reset`. 누적된 라이브 시도(부록 5–9) 뒤 정본을 **확정 사실만** 담는 clean baseline로 리셋.
> 아래 외의 원인·진단은 **가설**이며 확정 원인으로 기록하지 않는다. 세부·다음 단위: 슬라이스 §0.2.14. **문서-only, 라이브 실행 없음.**

**확정된 라이브 사실:**
- **open_app 전환 라이브 성공** (존재-앱: app_list→app_detail 관찰 + step 2 완료).
- **app_detail 분류는 fully-loaded 상태에서 성공** (로딩 중엔 app_list/unknown 가능).
- **api_group / credentials matchCount=1** (캘리브레이션 fixed-label 유일 해석).
- **Playwright locator search 정상** (comma-list candidateQuery + hasText; 합성 진단 확인) — 탐색은 실패 지점 아님.
- **overlay 아직 라이브 표시 성공 0회.**
- **throw 지점 미확정** — tag / signature / mount / visibility-verify 중 어디인지 아직 미확정.

**다음 단위 = `Overlay Root-Cause Isolation v1`:** resolve→scroll→tag→mount→visible-check 단계별 safe stage telemetry(오류
name + 민감정보 없는 고정 reason enum만); 상태 기계·selector·bridge·runner 불변(순수 관측 추가); 단 한 번의 gated 라이브
진단으로 정확한 실패 단계만 확정.

---

## 2026-08-03 부록 (9) — Overlay-Mount SPA Hardening: overlay mount SPA-safe + app-detail 구조 분류 (현행)

> `NAVER Overlay-Mount SPA Hardening v1`. 부록(8) 뒤 라이브 #5에서 탐색(locator)은 성공했으나 `mountOverlay`의 raw
> function-form `page.evaluate`가 soft-nav에 걸려 throw → api_group 오버레이 mount 실패. 또한 존재-앱 상세가 로딩 중
> `app_list`로 오분류. 세부: 슬라이스 §0.2.13. **라이브 실행 없음.**

- **overlay mount SPA-safe(`overlay.ts`):** `mountOverlay`의 `page.evaluate`를 `runEvaluateResilient`(bounded 재시도
  `MOUNT_EVAL_RETRIES=2`, transient nav 오류만 재시도, 메시지 substring은 제어용·무유출)로 감쌈. 각 mount는 이전 오버레이 제거→중복 없음.
- **atomic tag→mount + paint 검증(`naver-issuance-driver.ts`):** `resolveFixedLabelTarget` `afterTag` 콜백 → `highlightTarget`이
  mount를 같은 retried try·재해결 active page에서 원자 수행. tag↔mount 사이 context drift 시 **재-tag+재-mount**(stale tag에 mount
  안 함). **[리뷰 HIGH] mount 뒤 `overlayMounted` 검증** — `mountOverlay`의 silent `if(!target) return` no-op(오버레이 없이
  "성공" 보고 = fail-open)을 잡아 재-tag+재-mount 강제, 소진 시 recoverable page_mismatch(fail-closed). anti-drift sig 유지.
- **whenSettled refcount(`issuance-session.ts`):** `autoBusy` boolean→`busyCount` refcount(START_RUN 드라이브+detached
  watchBarrier 동시 소유의 clobber 제거 — overlay mount 재시도가 macrotask sleep span 시 표면화됐던 조기 반환 봉합). 테스트 훅; 프로덕션 동작 불변.
- **app-detail 구조 분류(`observe-api-center.ts`):** census value-free boolean `appDetailMarkerPresent`(요소 accessible-name을
  KNOWN 고정 라벨 `["API 그룹","애플리케이션 ID"]`과 EXACT 비교, boolean만 방출; **[리뷰 MEDIUM] marker candidate에서 th/a/button
  제외** — 리스트 컬럼 헤더/앱-이름 링크의 false-match 방지) + classifier precedence에 marker→app_detail(editable 다음, app_list
  앞). 존재-앱 상세가 평문(폼 입력 없음)이어도 app_detail. 잔여 false-match는 하류 target_not_found park로 fail-closed.
- **계약·범위:** 새 stage/status/enum/마이그레이션 **없음**; **FE 변경 없음.** collector typecheck + 전체 **6204 tests** 그린.
  독립 적대적 리뷰 **HIGH 1(mount no-op fail-open)·MEDIUM 1(marker th/a/button) 반영, LOW 기록**. **라이브 실행·credential
  값읽기·push/PR 없음.** 존재-앱 오버레이 렌더링 라이브 증명은 이 봉합으로 기대되나 **여전히 미증명(PENDING, 다음 gated 승인 필요)**.

---

## 2026-08-03 부록 (8) — SPA-Stable Guidance Runtime: fixed-label 탐색을 Playwright locator 기반으로 (현행)

> `NAVER SPA-Stable Guidance Runtime v1`. 부록(7) checkpoint 모델은 회복까지 라이브 증명됐으나 `api_group` locate가
> `settle`+bounded-retry를 뚫고도 execution-context-destroyed로 계속 throw(오버레이 mount 실패). 근본 원인: raw
> `page.evaluate`는 SPA soft-navigation을 넘어 재-resolve 못 함. 봉합: **탐색 자체를 Playwright locator로 이관.** 세부:
> 슬라이스 §0.2.12. **라이브 실행 없음.**

- **SPA-안정 탐색(`resolveFixedLabelTarget`):** fixed-label 탐색을 `page.evaluate` 문자열 → **locator 기반**으로 교체 —
  `page.locator(query,{hasText})` → `first().waitFor({state:"attached"})`(auto-wait, soft-nav 넘어 재-resolve = 실제
  봉합) → `count()` 유일성 → `scrollIntoViewIfNeeded()`(읽기전용) → **그제서야** 감사된 value-free tag+sig IIFE로 이미
  resolve된 요소에 tag(bounded 재시도). 매 attempt `activePage()` 재-resolve(context/frame 변경 추종). locator timeout →
  `{count:0}`(bounded target_not_found park). **매칭 의미·anti-drift sig·value-free OUTPUT 모두 불변.**
- **VERIFY_OPEN bounded polling(`probeSurfaceSettled`):** hydration 중 일시적 `unknown`을 첫 read에서 오분류→park하던
  플레이크 봉합. sanitized category를 정본 landing 또는 bounded 횟수까지 폴링 후 결정; 끝내 정착 안 하면 recoverable
  page_mismatch(fail-closed 유지). **[리뷰 H1] `credential_issuance`를 정본 성공 landing으로 수용** — existing 앱 상세는
  발급된 ID/Secret을 read-only로 보여 분류기가 `app_detail`이 아닌 `credential_issuance`로 분류(read-only>editable);
  엔진이 `app_detail`만 받으면 existing-app dead-end → 둘 다 수용(하류 fail-closed). **[리뷰 H1] 폴당 15초 settle 스톨
  제거**(최초 1회 settle → 이후 경량 `readSurface` 재읽기). 세션이 `probeSurfaceSettled ?? probeSurface` 사용.
- **공식 재사용 live-proof CLI(`src/cli/issuance-live-proof.ts`):** 스크래치패드 `issuance-*-runner.mjs`를 커밋된 게이트
  브리지-클라이언트 CLI로 정리 — 브라우저 드라이버 아님, 열린 `/bridge/ws`에 붙어 **START_RUN + '다음'만** 전송, sanitized
  프레임만 출력, **명시적 sentinel당 '다음' 1회(auto-recheck 없음)**, `hasLiveRunApproval` 게이트 + import-inert + 소스 가드.
- **계약·범위:** 새 stage/status/enum/마이그레이션 **없음**; **FE 변경 없음.** collector typecheck + 전체 **6195 tests** 그린.
  독립 적대적 리뷰 **HIGH 1(H1)·MEDIUM 1(M2: count() retry 밖) 반영, LOW 반영(L3 픽스처 정리)**; L4/L5/L6 안전 관측.
  **라이브 실행·credential 값읽기·push/PR 없음.** api_group/credentials existing-app **오버레이 렌더링 라이브 증명은 여전히
  미증명(PENDING, 다음 gated 승인 필요)** — 이번엔 탐색이 locator 기반이라 soft-nav에 강함.

---

## 2026-08-02 부록 (7) — Existing-App Same-Page Guidance: api_group·credentials = viewport CHECKPOINT (현행)

> `NAVER Existing-App Same-Page Guidance v1`. 부록(6)의 라이브 재시도에서 `api_group` locate가 settle 뒤에도
> execution-context-destroyed로 계속 throw → app_detail에서는 **NAVER 클릭을 기다리지 않는** 재설계. 세부: 슬라이스 §0.2.11.
> **라이브 실행 없음.**

- **재설계:** open_app만 실제 NAVER 클릭/전환을 관찰(`OBSERVE_USER_CLICK_TRANSITION` open_app 전용). app_detail 진입 후
  `api_group`·`애플리케이션 ID`는 **같은 페이지 viewport CHECKPOINT** — ① 안정화 ② 섹션 locate ③ scroll(오버레이 mount가
  수행) ④ 오버레이 위치 안내 ⑤ **클릭 대기 안 함(observer arm 제거)** ⑥ **SellerOps '다음'으로 진행**. `create_app`도
  checkpoint(등록 컨트롤 안내 → 직접 생성 → '다음'; 다음 api_group checkpoint의 locate가 app_detail 게이트). `return`은
  guidance-only checkpoint.
- **엔진:** checkpoint `onTargetHighlighted`→`"NONE"`(정지) → observer 무장 0. barrier에서 `REQUEST_STEP_RECHECK`는
  checkpoint면 `advanceCheckpoint`("다음"), open_app이면 재관찰. `resume`은 checkpoint 재-guide. open_app 전환 관찰
  barrier + VERIFY_OPEN 불변.
- **드라이버:** `armObserve` 완전 no-op. **bounded in-page 재시도**(settle→read; exec-context throw 시 재settle+재read,
  `MAX_INPAGE_RETRIES=2`) → 모두 실패해야 throw → recoverable park. scroll은 기존 오버레이 mount의 `scrollIntoView(center)`
  재사용(중복 없음).
- **회복=in-place 재-guide(독립 리뷰 M1):** open_app 뒤 런은 app_detail 상주 → checkpoint park를 상단 재-probe하면
  app_detail이 page_mismatch로 오분류되어 dead-end. `recheck`는 checkpoint를 guide 중이면 그 섹션을 **제자리 재-guide**
  (target_not_found/page_mismatch/surface-close/throw 모두 self-heal); 그 외 park만 재-probe. **부록(6)의 latch+cap 제거**;
  bound은 드라이버 재시도 + 명시적 '다음'(auto-loop 없음).
- **매니페스트:** read-only 능력 `REVEAL_SECTION_IN_VIEWPORT` 추가; `OBSERVE_USER_CLICK_TRANSITION` open_app 전용 명시.
- **auto-recheck 의존 제거:** checkpoint는 park가 아닌 barrier이므로 auto-recheck 루프로 진행되지 않음 — 진행은 명시적
  '다음' 한 번씩(auto-recheck는 park 회복에만).
- **계약·범위:** 새 stage/status/enum/마이그레이션 **없음**; **FE 변경 없음.** collector typecheck + 전체 **6158 tests** 그린.
  독립 적대적 리뷰 **HIGH=0**(MEDIUM 1=M1 in-place 회복 반영; LOW 반영). **라이브 highlight·클릭·credential 값읽기·push/PR
  없음.** api_group/credentials existing-app 라이브 증명은 **미증명(PENDING, 다음 gated 승인 필요)**.

---

## 2026-08-02 부록 (6) — Post-Navigation Highlight Reliability: guide 레이스 봉합 (현행)

> `NAVER Post-Navigation Highlight Reliability v1`. 부록(5) existing-app 흐름의 **라이브 부분 증명** 갭을 코드로 봉합.
> 세부: 슬라이스 §0.2.10. **라이브 실행 없음.**

- **라이브 부분 증명(2026-08-02, 실 NAVER, 단일사용 승인 소진):** existing-app 분기 + `open_app` 안내 + 관찰된
  `app_list→app_detail` 전환 + `VERIFY_OPEN`(일시 unknown fail-closed park + auto-recheck 복구) + **step 2 완료**까지
  라이브 성립(2회 재현). **차단:** step 2 직후 `guide(api_group)` 고정라벨 locate가 app_detail probe ~7ms 뒤
  execution-context-destroyed로 throw → 런이 park 없이 idle. 근본 원인 = `guide()`에 locate 전 settle 부재.
- **봉합(코드):** ① `guide()`가 locate 전 `driver.settleSurface()`(networkidle 바운드, value-free)로 surface 정착 →
  nav 직후 페이지에서 in-page read 미발화(모든 강조 단계 target-generic). ② settle에도 read가 nav를 race해 throw하면
  `onDriveError`→엔진 `onDriveFault()`가 **recoverable `page_mismatch` park + CLEAR_HIGHLIGHT**(idle 멈춤 제거,
  `RUN_FAILED` 아님). ③ `REQUEST_STEP_RECHECK`가 (상단 재-probe 대신) **같은 강조 타깃 재-guide**(판매자는 이미 상세
  페이지). ④ 연속 fault를 **`MAX_CONSECUTIVE_DRIVE_FAULTS=3`으로 바운드**(정상 highlight마다 리셋) → 캡 초과 시 재-guide
  중단·상단 재-probe 폴백(영구 오류 무한 재시도 불가). ⑤ 태그 스크립트 사전-clear + `CLEAR_HIGHLIGHT` + `autoBusy`
  직렬화 + **재-guide를 barrier 아닌 자동(RUNNING) stage로** 수행 → 중복 highlight·이중 arm 방지. ⑥ surface-close 등
  non-fault park는 재-guide latch를 해제(닫았다 다시 열면 상단 재-probe로 정상 복구).
- **계약·범위:** 새 stage/status/enum/마이그레이션 **없음**(`page_mismatch`·`REQUEST_STEP_RECHECK` 재사용). **FE 변경
  없음.** collector typecheck + 전체 **6152 tests** 그린(+8 신뢰성). 독립 적대적 리뷰 **HIGH=0**(MEDIUM 1=surface-close
  latch 반영; LOW 반영). **라이브 highlight·클릭·credential 값읽기·push/PR 없음.** 완료 후 existing-app Phase B live-proof
  runtime을 **fresh PREPARED까지만** 만들고 승인 대기.
  api_group/credentials 강조의 existing-app 라이브 증명은 이 봉합 뒤에도 **미증명(PENDING)** — 다음 gated 승인 필요.

---

## 2026-08-02 부록 (5) — Existing-App Guided Connection: open_app = NAVIGATION 안내, 두 경로 모두 ready_candidate (현행)

> `NAVER Existing-App Guided Connection v1`. 기존 앱 판매자도 issuance 튜토리얼을 완료하게 함. 세부: 슬라이스 §0.2.9.

- **`open_app`을 강조가 아닌 NAVIGATION 안내로 재정의(강조·selector 제거).** 강조 컨트롤은 `create_app`/`api_group`/
  `credentials` 3개뿐. `open_app` 구조 앵커 기계(`OPEN_APP_STRUCTURAL_SELECTOR`/`structuralSelectorFor`/
  `buildStructuralLocateScript`/`structural_candidate`) **전부 삭제**.
- **런타임:** 기존 앱 → step2에서 안내 문구만 표시(합성 sig, NAVER 질의 0) → 드라이버가 `app_list→app_detail` **전환만
  관찰**(sanitized 카테고리 폴링) → 엔진 `VERIFY_OPEN` 재-probe로 app_detail 검증 후에만 step2 완료 + calibrated
  `api_group`/`credentials` 강조 **재사용**. **잘못된 페이지·다중 전환 = recoverable park**(page_mismatch/waiting_login).
- **두 경로 모두 `ready_candidate`**(existing-app의 강조 타깃 2개 live_confirmed; open_app은 강조 없는 안내 단계).
  `SELECTORS_CALIBRATED` 계속 `true`(existing-app이 새 selector 추가 안 함). FE 정적 위저드 이미 기존-앱 단계 보유 →
  계약 enum 불변, FE 변경 없음.
- collector typecheck + **6144 tests** 그린; 독립 리뷰 HIGH=0 MED=0. **라이브 highlight·클릭·credential·push/PR 없음.**
  완료 후 existing-app live-proof runtime을 **PREPARED까지만** 만들고 승인 대기. new-app Phase B highlight proof는
  여전히 PENDING(부록(4)).

---

## 2026-08-02 부록 (4) — SELECTORS_CALIBRATED=true(new-app 한정) + Phase B 신규-앱 범위

> issuance highlight calibration의 **현행** 상태(부록(3) 갱신). 세부: 슬라이스 §0.2.8.

- **2차 selector-probe 라이브:** 3개 fixed-label 재확인 `matchCount=1`; **`open_app` 구조 앵커 = 44(non-unique)**
  → 유일 해석 실패(broad row selector). guided gate로 강조 0.
- **제품 오너 결정 = Phase B를 new-app(신규 앱 생성) 경로로 한정.** `SELECTORS_CALIBRATED` **false→true(new-app 한정)**:
  라이브 driver는 calibrated fixed-label registry로 강조(`CANDIDATE_TARGET_SELECTORS`는 fixture 마커로 강등). `create_app`/
  `api_group`/`credentials`는 읽기전용 probe 2회로 라이브 `matchCount=1` 증명.
- **`open_app`/existing-app = v1 범위 제외:** `structural_candidate`(not_ready), guided gate로 fail-closed park.
  Phase B highlight proof는 **빈-앱 스토어(생성 분기)에서만 유의미**.
- **Phase B highlight proof(`API_ISSUANCE_HIGHLIGHT_PROOF`) = implementation complete / live proof PENDING —
  requires empty-app store.** new-app 경로 구현 완료(플래그 전환 + guided highlight 준비). 라이브 proof **보류**:
  NAVER 앱 삭제 불가 → 빈-앱 스토어 없음. PREPARED manifest/임시 runtime **회수**(grant 미소비); 향후 라이브는
  빈-앱 스토어 + 새 bootstrap + 새 단일-사용 승인 필요. **existing-app 경로 계속 `not_ready`.** collector typecheck +
  6145 tests 그린; 독립 리뷰(플래그 전환) PASS HIGH=0 MED=0. 우회 proof·push/PR 없음.

---

## 2026-08-02 부록 (3) — selector-probe LIVE 검증 + open_app 구조 앵커 후보 (현행)

> issuance highlight calibration의 **현행** 상태(부록(2)를 갱신). 세부: 슬라이스 §0.2.7.

- **selector-probe LIVE 검증(실제 NAVER, 읽기 전용, 승인 소비):** driver 자체 fixed-label locate 메커니즘이
  `create_app`/`api_group`/`credentials`를 라이브 `matchCount=1`로 해석(uniqueCalibrated:3). `open_app`=0 당시.
  강조·클릭·값읽기·credential 0, sanitized 정수만. → 플래그 전환 선결 ①(driver 메커니즘 라이브 확인) = 3개 충족.
- **`open_app` = value-free 구조 앵커 후보:** 고정 라벨 없음 → 단일 앱-엔트리 ROW를 구조 COUNT로 매칭(텍스트/값
  읽기 없음), `status:"structural_candidate"`(미측정, unadoptable). existing-app 경로 **여전히 not_ready**.
- **가이드 vs 측정 분리:** `structural_candidate`는 guided-highlightable 아님 — 라이브 guided walk는 미확정 앵커를
  절대 강조하지 않고 fail-closed park; 읽기전용 probe만 측정(승격 근거). (독립 리뷰 MEDIUM을 이 게이트로 해소.)
- **`SELECTORS_CALIBRATED` 여전히 false, `api-center-adapter.ts` 무변경.** 전환 선결 ②(open_app 라이브 유일성 확인
  → 승격)만 남음. collector typecheck + 6144 tests 그린; 독립 리뷰 HIGH=0. 라이브 highlight·클릭·credential·push/PR 없음.

---

## 2026-08-02 부록 (2) — Phase-B highlight selector 보정 + read-only selector-probe 단계 (현행)

> 이 블록이 issuance highlight calibration의 **현행** 상태다(바로 아래 부록(1)의 selector 서술을 갱신).
> 세부 계약: [`docs/slices/naver-guided-connection.md`](slices/naver-guided-connection.md) §0.2.6.

- **Phase B highlight driver를 fixed-label locator로 보정.** 새 순수 모듈 `issuance-highlight-selectors.ts`가
  4개 highlight target을 고정 라벨 locator로 매핑; `create_app`·`api_group`·`credentials`는 부록(1)의 visual-recon
  채택 세트에서 **그대로 파생**(단일 소스, 드리프트 없음) → `live_confirmed`. **driver는 더 이상 CSS `[data-aw-target]`
  픽스처가 아니라 fixed-label locator로 강조 대상을 찾는다.**
- **경로 readiness 분리:** new-app(create_app→api_group→credentials) = `ready_candidate`; existing-app = `not_ready`
  (`open_app`은 고정 라벨 없음 → `no_fixed_label`, driver fail-closed `count:0` → 복구 가능한 `target_not_found` park).
- **`return`은 selector 대상 제거 → 안내 전용**(NAVER DOM 조회 0, 합성 고정 sig, 마켓 액션 0).
- **fixed-label locate = value-free OUTPUT**(`{count, sig}`만 반환; 텍스트/값 미반환) + 읽기전용 `probeTargetMatch`.
- **새 read-only 단계 `API_ISSUANCE_SELECTOR_PROBE`**(게이트드 CLI `probe-issuance-selectors.ts`): 각 target의
  라벨 matchCount·highlight 가능 여부만 측정(강조·클릭·값읽기 0). `allowsHighlight:false`라 `SELECTORS_CALIBRATED`
  없이 PREPARE 가능 — driver 메커니즘 라이브 확인의 근거.
- **`SELECTORS_CALIBRATED`는 여전히 false, `api-center-adapter.ts` 무변경.** 전환 조건 = selector-probe가 driver
  메커니즘으로 각 calibrated target 라이브 `matchCount=1` 확인 **AND** `open_app` 보정 → 그 뒤 Phase B highlight proof.
- **게이트:** collector typecheck + 6138 tests 그린; 독립 리뷰 HIGH=0 MED=0. **라이브 highlight·클릭·credential·push/PR
  없음.** fresh `API_ISSUANCE_SELECTOR_PROBE` runtime을 PREPARED까지만 만들고 승인 대기.

---

## 2026-08-02 부록 — NAVER API센터 Visual Recon calibration (현행, HEAD `a256c91`)

> current-state 부록(1). 아래 본문(2026-07-08 스냅샷)이 아니라 이 블록이 이 주제의 현행 상태다.
> 제품·전략 정본은 여전히 [`docs/sellerops_canonical_reference.md`](sellerops_canonical_reference.md),
> 세부 계약은 [`docs/slices/naver-guided-connection.md`](slices/naver-guided-connection.md) §0.2.5.

- **Visual Recon(redacted-screenshot) 라이브 검증 완료** — 실제 NAVER API센터. redaction: 계정 핸들 / API호출 IP /
  Client ID 가림, **공개 스토어명·앱 설명 노출**; 뷰포트 밖·미렌더 노드는 캡처 대상 아님으로 HALT 없음; 캡처 직후
  오버레이 제거; `app_detail/api_group/credentials`는 동일 페이지 viewport checkpoint.
- **6개 fixed-label target 모두 live `matchCount=1`:** `애플리케이션 등록`, `애플리케이션 ID`(app_detail 섹션 앵커),
  `API 그룹`, `애플리케이션 ID`(credentials 라벨), `보기`, `복사`.
- **`다시사용`(reactivate)은 미검증** — 일시중단 앱이 없어 register-state에서 `0`. 일시중단 앱에서 별도 측정 필요.
- **채택:** 위 6개를 `collector/src/action-window/api-issuance-calibration/visual-recon-adopted.ts`에 채택
  (candidate 선택자 재사용·드리프트 방지, frozen `evaluateSelectorCandidate`로 채택 가능성 기계 증명). `다시사용`·
  `시크릿` 라벨은 제외(각각 0 live·CREDENTIAL_VALUE_TARGET 차단).
- **이 selector들은 reviewer/tutorial용 Playwright `role=`/`text=` selector**이며, Phase B issuance highlight
  driver의 **CSS/클릭 대상 selector**(`CANDIDATE_TARGET_SELECTORS`: create_app/open_app/api_group/credentials/
  return)와는 **별개**다(open_app·return 미측정, selector 엔진도 다름).
- **따라서 `SELECTORS_CALIBRATED=false`가 정확한 현재 상태** — 그 플래그는 issuance highlight 계약용이며 이 채택은
  이를 건드리지 않는다(`api-center-adapter.ts` 무변경).
- **아직 미완료:** ① create_app/open_app/api_group/credentials/return용 **실제 CSS(클릭 대상) selector 보정**,
  ② **Phase B highlight proof**(`API_ISSUANCE_HIGHLIGHT_PROOF`). 이 둘을 완료하는 커밋에서만
  `SELECTORS_CALIBRATED=true`.
- **다음 큰 개발 단위 = `NAVER API Issuance Highlight Selector Calibration`.**

---

# SellerOps — Current State (living handoff)

> **Living handoff document — not a strategy document.** 이 문서는 "지금 어디까지 됐는가"의 단일
> 스냅샷이다. 제품 의도/범위는 `docs/product-scope-v1.md`, 프론트 스펙은 `docs/sellerops_frontend_spec.md`,
> capability 진실은 `docs/multi-channel-connector-roadmap.md` §4.1이 정본이며, 본 문서는 그들을 참조한다.
> 새 슬라이스가 끝나거나 상태가 바뀌면 갱신한다.

## 1. Last updated
2026-07-08 (Product Shell 커밋 `3006e44`; Local Agent Bridge G1 `c253dca`; **Browser Projection V0(§17-B G2)
커밋 완료 `a0e4f6f`**; **NAVER Guided Connection G3(§17-B) 계약 초안** — 문서 전용, 구현 미착수;
**정본 문서에 최종 제품·채널 전략 인코딩 커밋 완료 `5889a1d`** — SellerOps=SME 멀티채널 커머스 운영
에이전트 재정의(운영 루프 OBSERVE→…→RESUME), 사용자 대면 자율 모드 4종, **기본 리뷰 수집 모드=ACTION_WINDOW**,
사업자·등록 결정, OperationRun 방향, 신규 문서 `channel-capability-registration-matrix.md`·`slices/action-window-v1.md`).
**마켓 라이브-사용 게이트 유지(닫힘)**; 자동 로그인 여전히 미구현.

> **⚠ 2026-07-15 부분 갱신 — Action Window / R4 Runtime 상태만.** 이 날짜에 갱신된 것은 §9의 Action
> Window 항목뿐이다. **나머지 모든 항목은 여전히 2026-07-08 기준**이며 그 이후를 반영하지 않는다.
> Action Window Runtime 상태의 정본은 `docs/action-window-runtime/`이며, 진입점은
> [`docs/action-window-runtime/HANDOFF.md`](action-window-runtime/HANDOFF.md)다.

> **⚠ 2026-07-18 부분 갱신 — §10 Active slice만.** 이 날짜에 갱신된 것은 §10뿐이다(Review Response
> Completion v1 병합을 명시하고 Preparation v1을 이전 슬라이스로 강등). **나머지 항목은 여전히
> 2026-07-08 기준**(§9의 Action Window 항목은 2026-07-15 기준)이며 그 이후를 반영하지 않는다.
>
> **알려진 staleness — 해소하지 않고 보고한다.** 이 문서는 **리뷰 트리아지가 머지된 사실을 모른다**:
> 백엔드 PR #279(`4404b4f`)·프론트 PR #283(`6fff8f8`)이 2026-07-17에 들어왔고 scope lock은 v1.3(`7052e71`)
> 을 거쳐 **v1.4**가 됐지만, §9의 "구현됨/미구현" 목록과 §1의 기준일은 손대지 않았다. 그 전면 갱신은
> 이 슬라이스의 일이 아니며(범위를 넘어 문서를 다시 쓰는 것이 된다), 제품 오너에게 별도로 올린다.
> 특히 **§9 "명시적으로 미구현(표기 금지)"의 "채널 쓰기(답변 발송)"는 여전히 유효**하다 — v1.4가 허용한
> 것은 답변 **준비**(로컬 초안·승인·복사)이지 발송이 아니다.

> **통합 상태(integ/sellerops-main).** origin/main(`5a43dcb`)에 sellerops/main(`5889a1d`)을 non-fast-forward
> 병합한 통합 브랜치. 유일 충돌 `collector/src/cli/local-agent.ts`을 두 계보 보존으로 해소(Bridge + same-process
> human-completion 결합; ESM 프로필은 origin의 `base.profileBaseDir` 유지, Bridge pairing-file 전용 `collectorRoot`
> 재도입). **병합 트리가 진실로 포함하는 것**: Product Shell · CLI에 배선된 Local Agent Bridge · 채널-중립
> Browser Projection(**State B — 정상 부팅 미배선**) · same-process ESM reconnect · connection-explicit ESM
> capture · 공유 전용-프로필 해석 · 운영-에이전트 전략 문서 · **Action Window는 계약만(미구현)**
> *(2026-07-08 병합 트리 기준의 사실 기록. 현재 상태는 §9 — 이후 NAVER 한정으로 구현·라이브 검증됨)*. 검증:
> collector typecheck OK·`npm test` 2331 pass(1 skip), frontend typecheck OK·166 pass·build OK. 푸시·PR 없음.

## 2. Current product phase
Seller Track 프론트 리디자인 + **가이드 연결 인프라 트랙 진행**. **Product Shell 슬라이스 = 커밋 완료**
(베이스라인 `3006e447b91de72f5e3627da75f390c74d92bfac`). **Local Agent Bridge(§17-B G1) = 커밋 완료**
(`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`, 페어링+관측 전용 브리지). **현재 문서 작업 = Browser
Projection V0(§17-B G2) 실행 계약 초안**(`docs/slices/browser-projection-v0.md`, 제품 오너 리뷰 대기).
Browser Projection **구현은 미착수**(계약 승인 전). Guided Connection·자동 로그인·Device Vault·Windows
패키징·클라우드 런타임은 **여전히 미구현**(범위 밖 §9·§14). 수집·커넥터 백엔드는 기존 상태 유지(신규 채널 오픈 없음).

## 3. Canonical document index
| 문서 | 역할 |
|---|---|
| `docs/product-scope-v1.md` (v1.2) | 제품 범위 계약, 운영 에이전트 정의·운영 루프·자율 모드·Action Window 기본·사업자 결정, Track, frontstage/backstage, 가이드 연결 원칙 |
| `docs/sellerops_frontend_spec.md` | 프론트 IA·화면·여정·가이드 연결·Action Window 화면(§18)·슬라이스 정본 |
| `docs/multi-channel-connector-roadmap.md` | 수집 전략 + §4.1 채널 현행표(capability 진실) + §5.1 Action Window 기본 + §5.2 채널 결정 + §11 연결 모드 |
| `docs/channel-capability-registration-matrix.md` | (파생 뷰) 채널×capability × 자율 모드 × 셀러키/제공자 등록 × 사업자 조치 × 블로커 |
| `docs/sellerops_local_agent_runtime_adr.md` | 로컬 에이전트 런타임 경계·프로젝션 방향 ADR |
| `docs/slices/action-window-v1.md` | Action Window(기본 리뷰 수집 모드) 실행 계약 초안 |
| `docs/slices/{local-agent-bridge,browser-projection-v0,naver-guided-connection}.md` | 가이드 연결 인프라 G1·G2·G3 슬라이스 계약 |
| `docs/sellerops_phase3c_live_smoke.md`, `docs/sellerops_cafe24_live_verification.md` | 라이브 검증 기록 |

## 4. Current frontend state
- React 18 + TS + Vite + Tailwind SPA(`frontend/`). 라우팅 react-router-dom, 상태는 자체 `useApiData` + axios.
- 주요 읽기는 fail-closed strict(`apiClient.ts` `*Strict`), 일부 조용한 mock 폴백(`getOrMock`) 잔존(제거는 후속 S4).
- **Product Shell 반영 후 상태**: 내비게이션 2그룹(운영/연결·설정), 채널·업로드·알림은 `/settings/*`,
  구경로 리다이렉트 유지, `/search` 제거, 404 페이지 신설, 모바일 임시 드로어 내비(메뉴 버튼), 개발자
  오류 문구 → 셀러 언어("잠시 후 다시 시도해 주세요") 전량 교체. **비즈니스 로직·API 무변경.**
- **커밋 완료**(`3006e44`). 검증 결과는 §15.

## 5. Current backend state
- Spring Boot 3 + Postgres + Flyway + JWT. 컨트롤러 ~26개(auth/channels/dashboard/orders/inbox/
  seller-accounts/sync/uploads/attention/inquiries/connector-alerts/cafe24-connect 등).
- 커넥터 플래그 기본 off. 스케줄러 기본 off. 자격증명은 AES-256-GCM Vault(API 키용).

## 6. Connector & local-agent state
- 커넥터: NAVER·Cafe24 ORDER_SUMMARY 구현, 나머지(Coupang/ESM/11st/SSG) 인증 골격만. 상세는 §4.1 현행표.
- 로컬 에이전트(collector): 실제 Chrome+CDP 감독형 세션, 전용 프로필, 승인 플래그 없으면 DRY RUN.
  트레이/인스톨러/OS 자동시작/Device Vault/catch-up 실행은 **미구현**.

## 7. Live-verified capabilities
- 파일 업로드(전 채널) 인입 + dedup (E2E 스모크).
- NAVER ORDER_SUMMARY API 수집 1회 (2026-06-14).
- Cafe24 ORDER_SUMMARY API 수집 E2E PASS (토큰 회전·금액 대사).
- NAVER 리뷰 감독형 캡처→다운로드 저장 (2026-06-22).
- NAVER 리뷰 감독형 export→ingest **전 구간**(자동 업로드 브리지 포함) 1회 (2026-07-15, Run 4 —
  `COMPLETED` 3-of-3, 백엔드 `SUCCESS` 55/55/0/0). 범위: **감독형**(사람이 실제 클릭)·**개발 셀러**·
  **로컬 dev 백엔드**(프로덕션 아님). **셀러 대면 출시·무인 자동 수집·운영 지원 아님** — 상세는 §9,
  capability 정본은 `docs/multi-channel-connector-roadmap.md` §4.1(운영 지원 ❌ 유지), 근거는
  `docs/action-window-runtime/r4-evidence-pack.md` §8-17.
- Cafe24 게시판(리뷰/문의) 열람 discovery 1회 CONFIRMED.

## 8. Implemented but not live-verified
- Cafe24 OAuth 프론트 연결 플로우(FE `/connect/cafe24`); 백엔드 토큰 체인은 검증됐으나 FE 플로우 자체 미검증.
- 자격증명 템플릿 기반 키 등록 폼(6채널), 연결 확인(`test-connection` — 실검증기는 NAVER만).
- 스케줄/수동수집/백필/재시도/알림 acknowledge 계열.
- 문의 제안 생성 워크플로(FE 연결됨), 백엔드 draft/verify/confirm-publish(FE 미연결).
- ESM INQUIRY read 스켈레톤(unwired), ESM INQUIRY Excel 임포트 백엔드(FE 미노출).

## 9. Explicitly NOT implemented (표기 금지)
- **Action Window(기본 리뷰 수집 모드)** — **⚠ 상태 갱신 2026-07-15: 더 이상 "미구현"이 아니다.**
  **NAVER 한정**으로 창 오버레이·감독형 export·다운로드 완료 감지·검증·백엔드 ingest가 구현됐고, **실제
  NAVER 화면에서 end-to-end 라이브 검증됐다**(Run 4, 2026-07-15 — `COMPLETED` 3-of-3, 백엔드 `SUCCESS`
  55/55/0/0). 근거: `docs/action-window-runtime/r4-evidence-pack.md` §8-17. **Runtime 상태의 정본 =
  `docs/action-window-runtime/`**(진입점 [`HANDOFF.md`](action-window-runtime/HANDOFF.md)); 본 문서는
  그것을 참조만 한다.
  **그럼에도 §9(표기 금지)에 남는 이유 — 아래는 여전히 사실이며 셀러 대면 표기를 금지한다:**
  검증 범위는 **감독형(사람이 실제 클릭) NAVER 파일럿 1회**다 — **개발 셀러 + 로컬 dev 백엔드**
  (`localhost:8080`, 프로덕션 아님). **타 채널 미구현**, **무인 자동 수집 아님**, **셀러 대면 기능으로
  출시된 바 없음**. 실제 마켓 사용은 여전히 **건별 승인 게이트** 뒤다(§14 · `docs/action-window-runtime/`
  `r4-preparation.md` §3 G1–G6 — §14의 G6=Windows Migration과는 **다른 번호 체계**). 계약 문서
  `docs/slices/action-window-v1.md`는 아직 DRAFT이며 자체 §미구현 서술이 갱신되지 않았다(제품 오너 판단
  대기). 자율 모드=ACTION_WINDOW는 제품 의도로 유지.
- **브라우저 프로젝션**(인앱 브라우저 뷰 투사) — **채널-중립 V0 구현·커밋됨**(`a0e4f6f`, 로컬 픽스처 전용,
  **마켓 사용 미승인·비-기본 렌더러** §20). **production-runtime 미배선 (State B)**: 정상 Local Agent 제품
  부팅은 프로젝션 소스를 생성·주입하지 않는다(`resolveAgentBridgeConfig`가 `projection` 미설정 → `/projection/ws`
  404); 실제 CDP 소스 `ProjectionAdapter`는 테스트/QA 하니스에서만 생성(browser-projection-v0 §22.8). 프론트
  프로젝션 클라이언트·기능 플래그는 구현·커밋됐으나 별도 QA 하니스 없이는 연결 불가. 자동 마스킹·코치마크·
  자동 로그인·다중 동시 타깃·Windows는 여전히 미구현.
- **OS Device Vault / 자동 자격증명 입력 / 자동 재로그인** — 미구현.
- **프론트↔로컬 에이전트 통신 채널** — **G1 브리지로 구축됨(페어링+관측 전용, 실제 Local Agent 소유)**.
  **G1 자체에는** 프로젝션·입력 릴레이·워크플로/브라우저 제어 명령이 없다(G1 범위 밖·§0.5). 그중 **프로젝션 +
  제한된 입력 릴레이는 G2로 구현·커밋**(`a0e4f6f`; 단 마켓 미승인·**production-runtime 미배선 State B**);
  **마켓 워크플로/브라우저 제어·자동 클릭·자격증명 입력 명령은 여전히 미구현**(설계상 영구 제외 계열).
- **실행-중 이벤트(browser_lifecycle·collection_progress/result·auth_session·terminal_failure)** — **예약**
  (스키마만; 실제 방출 seam 없음, `supportedEvents`에서 제외). 실제 배선 = agent/bridge lifecycle·
  connection_lifecycle·pending_user_action·recoverable_failure·capability.
- **Windows 지원** — 미구현(현행 macOS 전제; 브리지 전송은 `ws`/Node 표준이라 이식 경로만 문서화).
- **클라우드 관리형 런타임** — 미구현(방향으로만).
- 채널 쓰기(답변 발송/주문 상태 변경), 무인 자동 수집, 자동 제품 매칭, standalone AI 검색.

## 10. Active slice
**Review Response Completion v1 (가이드형 NAVER Action Window 답변 제출) — 병합 완료(main), 오프라인 전용** —
`docs/slices/review-response-completion-v1.md` (**2026-07-18**). 승인된 답변 준비 위에 **가이드형·사람 수행
제출**을 얹는다: `RESPONSE_NEEDED` 승인 답변 → **네이버에서 직접 답변하기(가이드)** → 운영자가 판매자센터에
직접 붙여넣고 제출 → **로컬·운영자 보고·명시적 UNVERIFIED** 결과 기록. **발송 없음**: SellerOps는 쓰지·
입력하지·제출하지 않고 창을 앞으로 가져와 관찰만 하며, 게시 여부는 검증하지 않는다(NAVER REVIEW 공식 API
부재 → 결과는 절대 "완료"/채널 주장 아님; 보고(`OPERATOR_REPORTED_SUBMITTED`/`SUBMISSION_ABORTED`)와
검증(`UNVERIFIED`)을 **항상 쌍으로** 표기, `UNVERIFIED` 단독 금지). scope lock **v1.6**(§5·§9 좁은 outbound
예외), R4 §4.1 + ADR §4 변형-행동 개정, 결정 **D-032**(6번째 G3 스코프 `reply submission` + G6 템플릿).
계약은 **병렬 `contracts/action-window/v2/`**(protocol 2 — `OPERATOR_REPORTED` 종단·`COMPLETED` 아님·
outcome⟂verification), 런타임은 **격리된 `collector/src/action-window/reply-submission/`**(감사되는 v1 export
런타임·`OperationRun` store 불변, 절대 타이핑/제출 클릭 없음), 백엔드는 **V20**(1회용 `submission_ref` 바인딩 +
append-only `review_reply_outcome`, `operator_outcome`·`verification` 분리 컬럼, `COMPLETED` 값 없음).
**두 스택 PR 병합**: 플랫폼 **#291**(merge `3203b05`) → 프론트 **#292**(merge `9f2af64`). 검증: collector
typecheck+**3115** · backend `./gradlew test` BUILD SUCCESSFUL · frontend typecheck+**577**+build; 독립
읽기 전용 리뷰 clean. **라이브 리뷰 실행은 여전히 게이트 잠금** — 신선한 scope-matched G3(6번째 스코프
`reply submission`) + 1회용 G6가 필요하며 어느 것도 부여되지 않았다(D-032). collector 감사 런타임·라이브
접속·자격증명 변경 없음.

### 이전 활성 슬라이스 (참고) — Review Response Preparation v1, 병합 완료 (PR #284 백엔드 · #286 프론트)
`docs/slices/review-response-preparation-v1.md`. `RESPONSE_NEEDED` 리뷰에 한해 redacted 본문 →
**규칙 기반** 추천 초안 → 편집 → 승인(고정) → **복사**. **발송 없음**(마켓플레이스 쓰기 경로 부재, 답변은
운영자의 클립보드로만), **AI 없음**(`sellerops.reply.review.provider=rule_based`), scope lock **v1.4**
(§5 계약 + §9 좁은 redacted 판매자-대면 예외). Completion v1(위)이 이 위에 **가이드형 제출 + UNVERIFIED
결과 기록**을 얹으며 v1.4의 "클립보드로만"을 좁게 대체했다.

### 이전 활성 슬라이스 (참고) — NAVER Guided Connection (Guided-Connection G3)
**계약 초안 작성 중** — `docs/slices/naver-guided-connection.md`
(**DRAFT, 제품 오너 리뷰 대기 2026-07-08**). **문서 전용; 구현 미착수.** G3 = G1(페어링)·G2(프로젝션) 위에
**셀러 소유 NAVER 커머스 API 앱 발급(type=SELF) 가이드 + 첫 실주문 수집**(Frontend Spec §16.10 6단계).
셀러 소유 파일럿 경로이며 **솔루션-제공자 모델 아님**(product-scope §6.1). 가이드 상태 엔진·행위자 경계
(USER_REQUIRED/…/UNSUPPORTED)·fail-closed 상태 감지·안전 자격증명 등록(Secret은 백엔드 Vault 경계로만·
프론트/로그/프레임 미기록)·기존 `test-connection`/`sync` 합성·재개/복구 규정. **자동 로그인·자동 클릭·자동
Secret 추출·클립보드·2FA 처리 제외.** 슬라이스: G3-A(상태엔진+합성)·G3-B(자격증명/테스트/sync 합성)·
**G3-C(라이브 정찰 — 별도 승인+정책 게이트)**·G3-D(하드닝). **마켓 라이브-사용 게이트 유지(닫힘, §14).**
관찰: 백엔드 NAVER 커넥터(`NaverTokenClient`/`NaverApiConnector`)는 **구현됐으나 플래그 OFF 기본**(라이브
검증은 플래그 활성+승인 후). **Browser Projection V0은 커밋 완료**(`a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`).

### 이전 활성 슬라이스 (참고) — Browser Projection V0 (G2), 커밋 `a0e4f6f`
`docs/slices/browser-projection-v0.md`(§0 PO 결정 인코딩, §19 스파이크, §22 구현 결과·§22.8 State B). **상태:
구현·검증·커밋 완료(`a0e4f6f`), 마켓 사용 미승인(§20 게이트), 비-기본 렌더러, production-runtime 미배선
(State B — 정상 부팅이 프로젝션 소스를 생성·주입하지 않음, §22.8).** G2 = G1 브리지 위에 실제 Chrome
뷰 로컬 투사(`Page.startScreencast` 바이너리 프레임) + 명시적 사람 입력 릴레이(iframe·Electron 아님,
ADR §6 옵션 C). **프로젝션 전용 바이너리 전송을 G1 상태 채널과 분리**(64KiB JSON 미변경), 페어링=신뢰
루트·프로젝션 단명 세션·제어 리스 분리, 단일 제어 소유자+다중 관람, 2분 idle 리스, drop-old 큐(depth≤2),
데스크톱 전용. 마켓 자동화·자동 로그인·자동 클릭·코치마크·다중 동시 타깃은 범위 밖. **Local Agent Bridge
G1은 커밋 완료**(`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`). Product Shell은
`3006e447b91de72f5e3627da75f390c74d92bfac`로 커밋 완료.

### 신규/변경 파일 (Browser Projection V0)
- **collector 신규**: `src/bridge/{projection-protocol,projection-session,projection-input,projection-adapter,
  projection-hub,projection-endpoint}.ts`; `test/bridge/projection-{session,input,adapter,hub,server,privacy}.test.ts`
  (46개); `test/fixtures/projection/{minimal,seller-center,popup}.html`(합성·마켓 무관).
- **collector 변경**: `src/bridge/bridge-server.ts`(프로젝션 엔드포인트/WS/틱/리보크 캐스케이드 — G1 상태
  채널 미변경), `src/agent/agent-bridge.ts`(선택적 프로젝션 주입 seam).
- **frontend 신규**: `src/lib/bridge/{projectionProtocol,projectionClient}.ts`(+`projectionClient.test.ts`),
  `src/hooks/useProjection.ts`, `src/components/bridge/ProjectionView.tsx`.
- **frontend 변경**: `components/AppShell.tsx`(`VITE_ENABLE_AGENT_PROJECTION` 게이트).
- **패키지 변경 없음**(collector·frontend package.json/lock 무변경).

### 검증 (2026-07-08)
- collector: typecheck OK, `npm test` **2299 pass**(1 skip; 프로젝션 46). frontend: typecheck OK,
  `npm test` **166 pass**(프로젝션 10), `npm run build` OK.
- E2E QA(실제 Chrome 150 + 실제 전송 + 로컬 픽스처): 제어 획득, **입력→렌더 p95 130ms**, 리사이즈 후
  좌표 오차 0px, 리보크 시 프레임·입력 중단. 리치 픽스처 프레임 ~36.5KB, everyNth6=7.2fps→시간기반 캡 권장.
- 프라이버시: 프레임 바이트·입력·URL·티켓 로그 0(소스가드+로그싱크). QA 하니스는 저장소 밖 스크래치패드 1회성.

G1 = 프론트↔로컬 에이전트 **안전 페어링 + 관측 전용** 브리지. **WebSocket 전송 = 성숙한 `ws` 라이브러리**
(HTTP는 health·페어링·티켓 부트스트랩), loopback 전용, 명시적 오리진 허용(와일드카드 금지), 로컬 확인
페어링(리보크 전까지 유효, 양측 리보크), 단명·1회용 WS 티켓, sanitized 실시간 이벤트, 스냅샷 복원, 다중
탭, 버전/능력 협상(`supportedEvents`), 단일 인스턴스. **마켓 워크플로/브라우저 제어/자동 클릭/자격증명
입력 명령 없음.** **브리지는 실제 Local Agent가 소유**(`src/agent/agent-bridge.ts` ← `cli/local-agent.ts`):
승인 런에서 1회 기동, SellerOps 탭과 독립 상주, SIGINT/SIGTERM에 idempotent close, 스냅샷·이벤트는
실제 설정 연결 + 실제 orchestrator settle에서 파생. 표준 `cli/bridge.ts`는 dev/test 하니스.

### 신규/변경 파일 (Local Agent Bridge G1 + 하드닝)
- **collector 신규**: `src/bridge/{protocol,origin-policy,pairing,pairing-store,event-adapter,
  confirmation-page,bridge-server}.ts`, `src/agent/agent-bridge.ts`, `src/cli/bridge.ts`(dev 하니스),
  `test/bridge/*`(7 스펙+helpers, 47 테스트). (`ws-frame.ts`·그 테스트는 하드닝에서 삭제.)
- **collector 변경**: `.gitignore`(`.bridge/`), `package.json`+`package-lock.json`(**`ws` 런타임 dep +
  `@types/ws` devDep**), `src/cli/local-agent.ts`(브리지 통합), `src/cli/bridge.ts`(하니스 라벨).
- **frontend 신규**: `src/lib/bridge/{bridgeProtocol,bridgeClient}.ts`(+`bridgeClient.test.ts` 12 테스트),
  `src/hooks/useBridge.ts`, `src/components/bridge/BridgeStatus.tsx`.
- **frontend 변경**: `components/AppShell.tsx`(`VITE_ENABLE_AGENT_BRIDGE` 게이트 도크; 내비 무변경).
- **패키지 변경 = `ws`/`@types/ws`/lock 뿐**(다른 dep 변경 없음).

### 검증 (2026-07-08, 하드닝 후)
- collector: typecheck OK, `npm test` **2253 pass**(1 skip; 브리지 47 포함), 실제 Local Agent+Bridge
  수명 스모크 통과(브리지 1회 기동 → 실제 settle → 클린 SHUTDOWN·close).
- frontend: typecheck OK, `npm test` **156 pass**(브리지 12 포함), `npm run build` OK(146 모듈).
- Chrome 스파이크(§6.1): HTTPS→루프백 WS(로컬 open, public은 LNA 권한, 미기동 connection_refused).
- 브라우저 QA(실제 `ws` 브리지+실제 프론트, mock): unpaired→연결→로컬 확인→paired→새로고침 재연결→다중
  탭→리보크→에이전트 미기동 **전부 통과**. 미인증 health는 `paired` 없이 최소 노출 확인.
- `ws` 전송 테스트: 바이너리 거부(1003)·oversize(1009)·clean close·malformed·오리진/티켓/리플레이 거부.
- **페어링 저장 정직성**: 프론트 localStorage bearer는 **assisted macOS 파일럿 임시 방식**이며, 고객-PC
  배포·Projection 전에 non-exportable WebCrypto + proof-of-possession(또는 대안)을 평가한다. production
  페어링 우회는 계속 금지.
- `git diff --check` clean. `docs/esm/live-capture-checklist.md`·`tools/` 무변경. `.bridge/` gitignored.

## 11. Current blockers
- (repository-verifiable) org 횡단 대시보드 집계 API 부재 — 대시보드 재설계(후속 슬라이스) 선행 조건.
- (repository-verifiable) 비-Cafe24 seller-account 생성 API 부재 — 채널 연결 일반화 선행.
- (product-owner) 최종 모바일 내비 구성(5탭 등) 미승인 — 본 슬라이스는 임시 드로어로만.
- (product-owner) 고객 응대 통합 화면 최종 명칭 미정 — 본 슬라이스는 `/inbox`·`/inquiries` 유지.

## 12. Unrelated pre-existing uncommitted changes
- `docs/esm/live-capture-checklist.md` — **두 종류를 구분**한다: (a) **origin-main을 통해 커밋된 내용**
  (PR #208 `58ed027` 등 ESM 라이브 캡처 이력 정리)은 이 통합 브랜치에 정상 포함됨; (b) **다른 워크트리의
  무관한 로컬 미커밋 변경**(sellerops 워크트리 및 `sellerops-esm-live` 워크트리에 남아 있는 미커밋 편집)은
  **이 통합에 반영하지 않으며 수정 금지.** 통합 커밋은 (a)만 담고 (b)는 건드리지 않았다.
- `tools/` — 미추적(Cafe24 콜백 릴레이). 본 작업·통합 범위 밖. **수정 금지.**
- (직전 세션의) 정본 문서 변경들(product-scope/frontend-spec/connector-roadmap/ADR)은 `3006e44`로 커밋됨.

## 13. Next approved work
- **정본 문서 전략 인코딩 — 문서 전용, 커밋 완료 `5889a1d`.** SellerOps=SME 멀티채널 커머스 운영 에이전트
  재정의, 운영 루프(OBSERVE→…→RESUME), 자율 모드 4종, **기본 리뷰 수집=ACTION_WINDOW**(Projection은 비-기본
  렌더러), 사업자·등록 결정, OperationRun 방향. 갱신: `product-scope-v1.md`(v1.2)·`sellerops_frontend_spec.md`(§18)·
  `multi-channel-connector-roadmap.md`(§5.1·§5.2·§11.5). 신규: `channel-capability-registration-matrix.md`·
  `slices/action-window-v1.md`. **구현 없음.**
- **현재 개발 시퀀스(제품 오너 결정 — 각 단계 별도 승인, 미착수):** 1. 정본 문서 갱신(이 작업) → 2. Action
  Window V1 계약 리뷰 → 3. Action Window 공통 엔진+합성 픽스처 → 4. ESM+ 첫 라이브 Action Window 보정(별도
  승인) → 5. NAVER 셀러 소유 API 가이드 연결(G3) → 6. Coupang 가이드 키 발급(공식 검증된 곳) → 7. 제공자
  등록 문의 병행(사업자등록 후) → 8. Operation Run Engine(실행 모드·체크포인트 안정 후).
- **Local Agent Bridge G1** — 구현·하드닝·검증·**커밋 완료**(`c253dcacc979a0c779d9423a6df7dc80cd2ea9be`).
  남은 한계(정직 표기): 실행-중 이벤트(browser_lifecycle·collection_progress/result 등)는 **예약**이며
  실제 방출은 G2/라이브 수집의 신뢰 seam이 생겨야 `supportedEvents`로 승격(현재는 날조하지 않고 미노출);
  Windows/클라우드는 이식 경로만 문서화; 페어링 토큰 localStorage 저장은 파일럿 임시 방식(고객-PC 전
  WebCrypto+PoP 평가 — G2 진입 시점 평가 대상).
- **Browser Projection V0(§17-B G2) = 커밋 완료**(`a0e4f6f099c9d898142ef24b9f0d22ce9dc40f0f`, 25파일
  +4024/−24). 채널-중립·로컬 픽스처 전용, E2E QA(입력→렌더 p95 130ms·리사이즈 좌표 0px·리보크 중단)·
  10분 소크(−38.8 MB/min) 통과. **마켓 사용 미승인**(§20 게이트). 튜닝 TODO: 시간기반 프레임 캡으로 밀집
  페이지 ≥8fps.
- **현재 문서 작업 = NAVER Guided Connection(G3) 실행 계약 초안**(`docs/slices/naver-guided-connection.md`,
  DRAFT). 문서 전용, **구현 미착수.** 셀러 소유 앱 발급(type=SELF)+첫 수집 가이드; 기존 백엔드 경계
  (`credentials`/`test-connection`/`sync`)·G1/G2 위 합성; 자동 로그인·Secret 추출·클립보드·2FA 처리 제외.
  **제품 오너 리뷰·구현(G3-A) 착수 승인 대기.** **마켓 라이브-사용 게이트 유지(닫힘)** — G3-C 라이브 정찰은
  별도 승인+정책 해명 선결.
- Product Shell은 `3006e44`로 커밋 완료됨.

## 14. Must NOT be started yet
- **Action Window 구현(AW-2 이후) 및 실제 마켓 Action Window/Projected Direct Action 사용** — 계약 리뷰
  전 구현 금지; 실제 마켓 사용은 정책 해명 + 제품 오너 승인 게이트 뒤(`slices/action-window-v1.md` §17).
- **OperationRun 도메인 구현** — 방향 기록만(product-scope §1.7); 실행 모드·체크포인트 안정 전 착수 금지.
- NAVER Guided Connection(G3), Automatic Relogin(G4), Tutorial(G5), Windows Migration(G6) (Frontend Spec §17-B).
- **Browser Projection V0의 실제 마켓 대상 사용**(§20 게이트: 마켓 약관 허용성 해명 + 고객-PC 보안 리뷰
  선결); V0 코드 자체는 채널-중립 구현·**커밋 완료**(`a0e4f6f`), 단 **production-runtime 미배선(State B, §9·§22.8)**.
- **Browser Projection의 정상-부팅 배선**(`resolveAgentBridgeConfig`에 프로젝션 소스 주입) — 별도 배선 작업, 미착수.
- 대시보드 재설계, 가입/온보딩, inbox/inquiry 통합, 리포트 구현, 자동 로그인, 시각 리브랜딩, 신규 백엔드
  능력, 채널 카탈로그 정책 변경. (프론트↔에이전트 통신 G1·프로젝션 V0 **구현·커밋 완료** — 이 목록에서 제외;
  단 프로젝션 정상-부팅 배선은 별도 미착수 작업, State B §9.)

## 15. Product Shell 검증 결과 (2026-07-07)
- `npm run typecheck` — 통과(오류 0).
- `npm test` — 144 테스트 통과(카피 가드 스캔 확장 포함; 착수 전 87 → 144).
- `npm run build` — 통과(142 모듈, dist 생성).
- `git diff --check` — whitespace 오류 없음.
- dev 서버(mock 모드) 부팅 확인, `/`·`/settings/channels`·미지의 경로 모두 SPA 200 응답. 번들에
  `/settings/*` 경로·404 문구·모바일 메뉴·그룹 헤더 컴파일 확인, `/search` 라우트·"AI 검색" 라벨 제거 확인.
- **브라우저 시각 QA — 완료(2026-07-07)**: 로컬 mock 모드 앱을 Playwright(collector 번들 chromium)로
  구동해 데스크톱 1440px·모바일 390px 검사. 결과: 데스크톱 12라우트 정상 렌더(가로 오버플로우 0,
  개발자 문구 0), 구경로 4종 리다이렉트+쿼리/파라미터 보존, `/search`·unknown → 404 렌더(조용한
  리다이렉트 없음), "AI 검색" 내비 제거, 사이드바 2그룹(운영/연결·설정)·중첩 채널상세에서 "채널 연결"
  활성·알림 배지 "2" 확인. 모바일: 메뉴 버튼·드로어 열림/닫힘(링크·ESC·백드롭)·열림 시 드로어 포커스·
  닫힘 시 버튼 포커스 복원·헤더 미겹침·긴 조직명 오버플로우 없음 모두 통과. 오류 상태(strict 읽기
  실패 주입): 셀러 복구 문구 표시·"백엔드" 없음·시드 데이터 미강등(fail-closed) 확인.
  **결함 0건 — 제품 오너 커밋 승인 준비 완료.**
