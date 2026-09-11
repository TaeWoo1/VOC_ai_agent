# Aside Execution Provider v1 — M1 (Execution Provider Foundation) + M2 (Aside Execution Adapter)

> **문서 성격.** IMPLEMENTED EXPERIMENT (2026-09-12, branch `experiment/aside-executor`, baseline
> `reviewnary-pre-aside-v1`). `docs/review_acquisition_aside_v2.md`(TARGET DESIGN)와
> `docs/aside_capability_discovery_v1.md`(capability fact) 위에서 **실제로 코드가 된 것**만 적는다. 이 문서가 두
> 문서와 다르게 말하는 곳은 구현이 드러낸 사실이며, §9에 따로 모았다. NAVER Seller Center 접근 **0** · 실제
> export **0** · 마켓플레이스 WRITE **0** · DB 마이그레이션 **0** · production default 변경 **0**.

## 0. 상태

**M1+M2 DONE.** 기존 `LOCAL_HELPER` 경로는 새 seam 뒤에서 byte-identical 하게 돌고(§3), `ASIDE`가 두 번째
execution provider로 존재하며(§4), 로컬 fixture 페이지를 대상으로 **실제 Aside 브라우저**가
`identity assert → 기간 입력 → exactly-one export click → 다운로드 → host path → SHA-256 → validate → delete →
(simulated) ingest ACK`를 끝까지 수행했다(§7). NAVER workflow는 이 build에 **바인딩돼 있지 않고**, 그래서
`REVIEWNARY_EXECUTION_PROVIDER=ASIDE`는 boot에서 명시적으로 거절된다(§6).

## 1. 경계 — seam이 어디에 있고 왜 거기인가

```
FE START_RUN(importRef) ─▶ ImportSegmentHost
                            ├─ resolveScope(ref)  ← 서버가 org·account·window를 답한다 (기존)
                            ├─ decideSegmentEntry ← kind/channel/declared 대조 (기존)
                            ├─ admit()            ← acquisition admission (기존)
                            └─ HOST_SEGMENT ─▶ SegmentExecutionProvider.start(request, ctx)   ← NEW seam
                                                 ├─ LOCAL_HELPER: assembleImportRun + session.attach   (WRAP, 변경 0)
                                                 └─ ASIDE:        executor(repl) → host-file handoff → outcome
```

- **seam은 `HOST_SEGMENT` 결정 뒤, `assembleImportRun` 앞이다.** 그 앞은 ticket·org fence·account slot·
  channel·admission — 어느 provider도 우회하면 안 되는 domain/security state이고, 그 뒤가 "이 승인된 segment를
  terminal outcome까지 나른다"이다. 두 executor가 공통으로 할 수 있는 일은 정확히 그것뿐이다.
- **`ImportProbeDriver` 아래에 두지 않았다.** 그 인터페이스는 "판매자가 누르고 우리는 관찰한다"이고 첫 번째
  불변식이 *click/fill/submit 메서드 부재*다. 스스로 클릭하는 executor가 그것을 구현하면 절반이 no-op이거나
  Action Window 계약이 깨진다(discovery §15, aside_v2 §14의 예상과 일치).
- **두 단계 generic stack은 만들지 않았다.** `BrowserExecutionProvider` 같은 저수준 브라우저 명령 채널은 없다.
  Aside 쪽의 "executor"는 범용 인터페이스가 아니라 **닫힌 어휘의 export workflow 하나를 돌리고 파일을 돌려주는
  것**이다(§4.2).

### 1.1 계약 (`collector/src/action-window/initial-import/execution-provider.ts`)

| 요소 | 내용 |
|---|---|
| `ExecutionProviderKind` | `LOCAL_HELPER` · `ASIDE` (PD-3 axis). default `LOCAL_HELPER`. `MANUAL`은 provider가 아니다 |
| `SegmentExecutionRequest` | `runId` · `channelCode` · `accountSlot`(opaque server surrogate) · `required{start,end}` — **launch ref·org·token·store name 칸이 없다** |
| `SegmentExecutionContext` | `transport` · `importRef`(ingest 권한, host 소유) · `startFrame` · `persistDir` · `now` |
| `HostedSegmentRun` | `runStatus()` · `session()`(LOCAL_HELPER만 non-null) · `detach()` · `settled(): Promise<Outcome>` |
| `SegmentExecutionOutcome` | ok: `provider·runId·workflow·artifactRef·scopeEvidence·processed·observed` / fail: `failure{code,stage,recoverable}·observed` |
| `ExecutionFailureCode` | 엔진의 `ImportBlockerCode` **재사용** + aside_v2 §10의 `AUTH_REQUIRED·STORE_MISMATCH·STORE_UNRESOLVED·SCOPE_UNREADABLE·TRANSFER_FAILED·PROVIDER_UNAVAILABLE·PROVIDER_REFUSED·PROVIDER_TIMEOUT` + `CANCELLED` |
| `ExecutionObservation` | `startedAt·completedAt·durationMs·executorVersion?·artifactSha256?·artifactBytes?·identity?·llmCalls?` |
| `storeIdentityVerdict()` | `MATCH` / `MISMATCH` / `UNRESOLVED` — 빈 기대값·빈 관측값은 UNRESOLVED |

PD-7의 run-scoped 승인 다섯 축 중 organization·channel·store account·period는 **launch ref가 서버에서
묶는다**(runtime wire는 identity-free — 기존 설계 그대로). 남은 축 **workflow/version**은 outcome의
`workflow{id,version}`로 기록된다(요청 DTO에 org를 싣지 않는 이유는 기존 `ResolvedLaunchScope`와 같다).

### 1.2 Provider의 책임 / 비책임

책임: 승인된 segment 하나를 terminal outcome까지; 실패는 구조화된 코드; 관측 metadata.
비책임: parsing · normalization · dedup · Review Attention · seller decision · product intelligence · 임의 자동화.
Aside provider의 ingest는 **기존 `buildSegmentIngestUpload`**(launch-ref bound, 같은 endpoint, 같은 backend
parser)로 간다 — 이것이 PD-8(a)이고 Runner 파서는 0이다.

## 2. 주요 파일

| 파일 | 역할 |
|---|---|
| `collector/src/action-window/initial-import/execution-provider.ts` | M1 계약 (§1.1) |
| `collector/src/action-window/initial-import/local-helper-execution.ts` | `LOCAL_HELPER` WRAP — `assembleImportRun`+`attach()` 그대로, terminal을 outcome으로 읽는다 |
| `collector/src/action-window/initial-import/import-host.ts` | seam 소비 — `execution?` dep, 없으면 `driver`로 LOCAL_HELPER; `activeRun()`·`executionProvider()` 추가 |
| `collector/src/action-window/initial-import/import-dispatch.ts` | `onStatePublished` 훅 하나 추가(persist 뒤 호출; 없으면 무변경) |
| `collector/src/action-window/initial-import/execution-provider-selection.ts` | env parse + boot gate |
| `collector/src/aside/aside-cli.ts` | `aside repl <program>` / `aside --version` — 이 두 invocation만 (closed list) |
| `collector/src/aside/export-workflow.ts` | 닫힌 workflow 어휘 + 구조 validation |
| `collector/src/aside/export-runtime.ts` | 브라우저 안에서 도는 함수 하나 (`toString()`으로 배송) |
| `collector/src/aside/aside-export-executor.ts` | plan → program → repl → result 검증/매핑 |
| `collector/src/aside/host-file-handoff.ts` | Runner: stable-wait → read → SHA-256 → validate → **delete** → upload(bytes) |
| `collector/src/aside/aside-execution-provider.ts` | `ASIDE` provider (executor + handoff → outcome, sanitized log) |
| `collector/src/config.ts` | `executionProvider` · `asideCli` · `asideAccount` |
| `collector/src/cli/local-agent.ts` | boot gate 호출; `isSettled`를 `activeRun()`으로 |
| `collector/src/agent/agent-bridge.ts` | `AgentImportConfig.execution?` passthrough |

## 3. LOCAL_HELPER wrap — delta 0

- `LocalHelperSegmentExecution.start()`는 host가 inline으로 하던 `assembleImportRun(...)` + `session.attach()`를
  **같은 인자·같은 순서**로 호출한다. 엔진·세션·드라이버·quarantine·launch-ref ingest·persist marker·readiness
  decorator는 이 wrapper의 존재를 모른다.
- 더한 것은 outcome 읽기뿐: dispatch에 `onStatePublished` 훅(persist **뒤**에 호출)을 붙여 terminal stage에서
  `engine.detectedArtifactRef()·recordedScopeEvidence()·processedCount()·terminalFailure()`를 outcome으로 옮긴다.
- host의 slot 의미(COMPLETED는 slot 유지, FAILED/CANCELLED는 retry에 해제, replay 루프 가드)는 그대로다.
- 증거: 기존 import/host/session/e2e 스위트 무수정 green(§8) + `execution-provider.test.ts`가 명시 provider
  유무에서 fixture driver의 **call sequence 동일**을 단언. `aw_import_host_run_hosted {kind:"SEGMENT"}` 로그 줄은
  byte-identical이고 provider는 별도 줄 `aw_import_host_execution_provider {provider}`로 적는다.
- `CollectionMethod` / provenance / `scopeEvidence` 값 무변경. FE wire 무변경.

## 4. ASIDE provider

### 4.1 Invocation — `aside repl`만

- `aside-cli.ts`의 `ASIDE_ALLOWED_INVOCATIONS = ["repl", "--version"]`. `exec`(LLM agent)·`session`·`memory`·
  `skills`·`login`… 리터럴은 소스에 없고 guard 테스트가 그것을 읽는다.
- 결과 프로토콜: 프로그램이 stdout에 `ASIDE_RESULT <json>` 한 줄. **Aside는 프로그램이 throw해도 exit 0**
  (2026-09-12 실측)이라 exit code는 신호가 아니고, 결과 줄의 유무가 신호다. stdout의 나머지(Aside 자신의
  "Opened a new tab … (url)" 줄)는 URL을 담으므로 **반환도 로그도 하지 않는다**.
- no-result 분류(closed): `UNAVAILABLE`(CLI 없음 ENOENT / "Aside isn't running on this machine" — 실제 app quit
  상태에서 실측, exit 1) · `REFUSED`("Account not found") · `TIMEOUT`(우리 ceiling ≤ Aside의 120 s) · `FAULT`.
- 정상 경로 LLM 호출 **0** — `repl`은 모델을 부르지 않는다(discovery §2). outcome에 `llmCalls: 0`.

### 4.2 Workflow — 닫힌 어휘

`ExportWorkflow` = `ref{id,version}` · `entryUrl` · `authSignals[]` · `identity{selector, TEXT|ATTRIBUTE}` ·
`steps[]`(kind ∈ **FILL·SELECT·CLICK·WAIT_FOR**, `$REQUIRED_START/$REQUIRED_END` 토큰) · `scopeReadback|null` ·
`exportSelector` · timeouts. `EVALUATE`·`NAVIGATE`·script·loop·조건 없음. 잘못된 shape는 executor 생성 시 거절.
**NAVER workflow는 없다** — 이 build의 `NAVER_ASIDE_WORKFLOWS_BOUND = []`.

### 4.3 Runtime — 브라우저에서 도는 함수 하나

`asideExportRuntime(plan, {openTab, closeTab})`를 `Function.prototype.toString`으로 직렬화해 JSON plan과 함께
보낸다. 같은 소스 텍스트가 (a) Aside repl에서, (b) 오프라인 테스트에서 fake page로 실행된다 — **테스트가
검사하는 코드 = 브라우저가 도는 코드**. 순서는 고정: open → auth signal(있으면 `AUTH_REQUIRED`) → identity
(exactly one + non-empty + exact match) → steps → scope read-back → export(download race를 먼저 arm) → `path()` →
tab close(finally). selector는 JSON 안에서만 이동하고 코드가 되지 않는다.

esbuild(`keepNames`)가 inner function에 `__name(fn,"fn")`을 붙이므로 프로그램 preamble이
`const __name = (t, _) => t;` 한 줄을 정의한다. guard 테스트가 **빈 vm context + fake openTab/closeTab만**으로
프로그램을 실행해 다른 free reference가 없음을 증명한다.

## 5. Safety — source guard (`test/aside/aside-guard.test.ts`)

`src/aside/*.ts` 전 파일(주석 제거 후)에 다음 토큰 부재를 단언한다: `captcha` · `password` · `cua` · `chrome.` ·
`fs.` · `readFile(` · `require(` · `process.` · `.evaluate(` · `evaluateHandle` · `addInitScript` · `cookies(` ·
`storageState` · `localStorage` · `sessionStorage` · `display.` · `aside.` · `memory_search` · `"exec"` ·
`"session"` · `"steer"` · `"queue"` · `"login"` · `"skills"` · `"memory"` · `keyboard` · `dispatchEvent` · `.goto(` ·
`.press(`. 생성된 프로그램 텍스트에도 같은 검사. CLI wrapper의 subcommand 리터럴은 `"repl"`뿐. workflow 어휘는
정확히 네 kind. 즉 CAPTCHA 자동 해결·자동 로그인/password·credential 추출·CUA·LLM exec fallback은
**호출할 코드가 존재하지 않는다**(G-1 fence, PRODUCT_DECISION_NEEDED-A의 실행).

## 6. Fail-closed

- **Ambiguity (G-2).** 모든 action은 `one(selector)`을 지난다: `count()` → 0이면 `TARGET_NOT_FOUND`, 2+면
  `TARGET_AMBIGUOUS{candidates}`, 1일 때만 action. `locator(...).click()` 직접 체인은 guard가 소스에서 금지.
  fake page 테스트(0/1/2+ · step별 attribution)와 실제 Aside E2E(`?dup=1` → AMBIGUOUS, 다운로드 0)로 확인.
- **Auth (PD-2).** authSignal 하나라도 count>0 → `AUTH_REQUIRED`(recoverable), 아무것도 건드리지 않는다.
- **Identity (PD-4).** 요소 0/2+ · 빈 관측 · 빈 기대 → `STORE_UNRESOLVED`(성공 아님), 불일치 → `STORE_MISMATCH`,
  둘 다 **step 전·download 전**에 멈춘다. 기대값을 바인딩하지 않은 run은 구조적으로 성공할 수 없다.
- **Scope.** read-back 선언 시 MISMATCH → `SCOPE_MISMATCH`, 읽기 불가 → `SCOPE_UNREADABLE`; 선언 없으면
  evidence는 `OPERATOR_CONFIRMED`(aside_v2 §9 — 사람이 확인하지 않은 Aside 실행을 MACHINE_MATCHED로 올리지 않는다).
- **Executor unavailable.** CLI 부재·daemon down → `PROVIDER_UNAVAILABLE`(recoverable). timeout →
  `PROVIDER_TIMEOUT`. malformed/off-shape 결과 → `RUNTIME_FAULT`(성공으로 해석되는 off-shape 결과 없음).
- **Boot.** `REVIEWNARY_EXECUTION_PROVIDER` 미설정/공백 → `LOCAL_HELPER`; 알 수 없는 값 → config error;
  `ASIDE` + 바인딩된 workflow 0 → **boot 거절**(조용한 downgrade 없음). `HELPER_ENV_KEYS`(packaged helper의
  helper.env)에는 **넣지 않았다** — 실험 스위치를 packaged 배포가 읽게 하지 않는다.

## 7. Download → host file → handoff → lifecycle

`host-file-handoff.ts`: `download.path()`(실제 host 경로, discovery §7) → 크기 안정 대기(두 번 연속 동일, 상한
10 s) → read → SHA-256 → `extensionCategory(suggestedName)==="xlsx"` && `sniffXlsxReadable(head)`(quarantine과
**같은 두 검사, 같은 함수**) → **delete** → `upload({bytes, artifactRef, scopeEvidence})` → `{ok, processed}`.

delete가 upload **앞**인 이유: quarantine의 delete-after-validate 자세를 우리가 이름 짓지 않은 파일에 적용한
것이다 — 판매자 PC에 raw export를 남기지 않고(PD-6), 지울 수 없는 파일은 **행이 하나도 쓰이기 전에** run을
실패시킨다(`ARTIFACT_INVALID @CLEANUP`, 기존 quarantine과 같은 성질). 업로드는 메모리에서 간다.

실패 시 정리: 모든 early return이 best-effort delete 후 코드를 낸다 — `TRANSFER_FAILED`(미도착/불안정/읽기
불가) · `ARTIFACT_INVALID`(ext/magic/undeletable) · `INGEST_FAILED`(ACK 없음; 파일은 이미 삭제). 남는 artifact는
"지울 수 없었던 것"뿐이고 outcome에 `deleted:false`로 드러난다. `artifactRef = artifactRefFor([runId,"aside",sha])`
— 같은 바이트·다른 run이면 다른 ref, SHA-256은 결정론(테스트). 실패 artifact의 local quarantine/TTL(PD-5)은
**구현하지 않았다** — 서버 idempotency-key 저장소(M4) 전에는 재전송 소비자가 없다.

## 8. 테스트

| 층 | 파일 | 수단 | 결과 |
|---|---|---|---|
| 계약 + LOCAL_HELPER wrap + host/ASIDE fake | `test/action-window/initial-import/execution-provider.test.ts` | fixture driver, scripted provider | 10 tests |
| selection/config | `.../execution-provider-selection.test.ts` | pure | 5 |
| CLI wrapper | `test/aside/aside-cli.test.ts` | **fake CLI**(`test/support/fake-aside-cli.mjs`): result/malformed/silent/down/account/hang/ENOENT | 11 |
| runtime | `test/aside/export-runtime.test.ts` | fake page, 같은 함수 직접 실행 | 19 |
| source guard | `test/aside/aside-guard.test.ts` | 소스 스캔 + 빈 vm 실행 | 14 |
| handoff | `test/aside/host-file-handoff.test.ts` | **실제 tmp filesystem** | 8 |
| provider | `test/aside/aside-execution-provider.test.ts` | scripted executor/handoff | 4 |
| executor 오프라인 chain | `test/aside/aside-export-executor.test.ts` | fake CLI가 **실제 program text**를 평가, 실제 fixture bytes를 tmp에 "다운로드", 실제 handoff | 11 |
| **실제 Aside E2E (opt-in)** | `test/aside/aside-e2e.test.ts` (`ASIDE_E2E=1`) | 실제 Aside 브라우저 · loopback fixture 서버(`test/support/aside-fixture.ts`) | 8 |

**실제 Aside E2E 결과 (2026-09-12, Aside CLI 1.26.906.1630, app 1.0.910.1):** 8/8 PASS —
happy path 2.5 s(identity MATCH → fill → apply → exactly-one export → **실제 다운로드** → custody →
`sha256 == contracts/review-export/naver/v1 fixture` → simulated ingest ACK → 삭제, `~/Downloads` 잔여 0,
`llmCalls 0`) · `?dup=1` → `TARGET_AMBIGUOUS`(서버가 export를 serve한 횟수 불변) · `?noexport=1` →
`TARGET_NOT_FOUND` · `?auth=1` → `AUTH_REQUIRED` · `?store=other` → `STORE_MISMATCH`(download 0) · `?stall=1` →
`DOWNLOAD_TIMEOUT`(ingest 0) · read-back 불일치 → `SCOPE_MISMATCH`(export 전). 별도로 app을 종료한 상태에서 CLI
가 `PROVIDER_UNAVAILABLE` 텍스트를 내는 것을 실측하고 분류기에 고정했다(app 재기동 완료).

**Aside 없는 환경(CI):** `describe.skipIf(!ASIDE_E2E)` — E2E 8건 skip, 나머지 전부 green. collector 전체 스위트
결과는 §11.

## 9. Discovery 때 예상과 달랐던 사실

1. **계약 모양.** aside_v2 §14의 `execute(run) → {artifact bytes…}`는 LOCAL_HELPER가 구현할 수 없다 — 그 run은
   세션·판매자 클릭·in-session ingest·delete-after-validate와 분리되지 않는다. 그래서 공유 계약은 한 단계 위
   (`start(request, ctx) → HostedSegmentRun`, outcome은 ingest 이후)이고, "파일을 돌려주는" 계약은 ASIDE 내부
   executor 층(`ExportExecutionResult{hostPath…}`)에만 있다. 두 provider가 같은 것을 약속하도록 하려면 이 모양이
   유일했다.
2. **`getTabs`는 없다.** CLI help의 예시(`getTabs()`)는 실제 repl에서 `ReferenceError`. 존재하는 것은
   `openTab`/`closeTab`(discovery와 일치). help 텍스트는 근거가 아니다.
3. **`captcha` global은 CLI repl에 없다**(`typeof captcha === "undefined"`); `password`·`cua`·`chrome`·`fs`는
   있다. MCP repl에서는 discovery가 `captcha`를 관측했다. 어느 쪽이든 guard는 이름으로 막는다.
4. **에러여도 exit 0.** 프로그램 throw는 stderr + `[error | Nms]` + exit 0. exit 1은 pre-flight(계정 없음, daemon
   down)에서만. 결과 프로토콜을 stdout 한 줄로 둔 이유.
5. **esbuild `__name`.** 직렬화된 함수 텍스트가 `tsx`에서는 `__name` helper를 참조한다(vitest transform에서는
   아님). preamble shim + 빈 vm 테스트로 닫았다.
6. **다운로드 파일명.** `<a download="…">`의 이름이 그대로 `~/Downloads`에 착지하고 `download.path()`가 그 경로를
   준다(discovery의 GUID temp 우려 없음). 같은 이름 재다운로드는 Chromium이 `(1)`을 붙이지만 우리는 path()만 쓴다.

## 10. Product decisions needed

새 결정 **없음.** 확인 성격의 사실 셋만 적는다:
- PRODUCT_DECISION_NEEDED-A(discovery §16, repl-only + captcha/password/cua 금지)는 이 구현이 **그대로 실행**했다
  (§5). 뒤집으려면 guard 테스트를 지워야 한다.
- 핸드오프 shape는 **shape 1**(Runner가 host path 직접 read)로 구현했다(discovery §16-C 권장안). shape 2(base64
  반환)는 만들지 않았다.
- ASIDE run은 M2에서 **FE wire(`aw_view`)를 발행하지 않는다** — v2 view의 blocker 어휘에 `AUTH_REQUIRED`·`STORE_*`·
  `PROVIDER_*`가 없고, FE에 Aside run을 가르치는 것은 M3의 「지금 동기화」 surface다. host의
  `activeRun().runStatus()/settled()`와 sanitized log로 관측된다. (계약 확장은 M3에서 product-owner 확인 사항.)

OPEN 유지: Q-1(scheduled unattended) · H-3(NAVER store identifier 실값) · PD-5 quarantine TTL.

## 11. 회귀

- `collector`: `tsc --noEmit` — 이 변경으로 인한 오류 0(baseline에 이미 있던
  `reply-session.test.ts(105,12)` TS18048 한 건은 무관·무변경).
- `vitest run` 전체(collector): **401 files passed · 21 skipped / 9,550 tests passed · 160 skipped · 실패 0**
  (skip은 기존 opt-in live/browser 스위트 + 이 패키지의 opt-in Aside E2E 8건). 신규 오프라인 82 tests + E2E 8.
- backend · frontend · agent-runtime · contracts: **변경 0**.

## 12. M3 readiness — NAVER ONE-EXPLICIT-RUN POC

준비된 것: seam · ASIDE provider · fail-closed 프리미티브 · identity seam · handoff · 관측. M3에서 만들 것:
1. NAVER `ExportWorkflow` 인스턴스(entryUrl·authSignals·identity read·steps·export selector) —
   `NAVER_ASIDE_WORKFLOWS_BOUND`에 바인딩. **H-3(실제 store identifier)를 첫 측정으로** 확정하고
   `expectedIdentity`를 서버 소유 사실에서 바인딩.
2. `ImportHostDeps.execution`에 실제 `AsideSegmentExecution`을 boot에서 조립(`buildNaverImportCarrierCore`:
   ingest는 기존 `buildSegmentIngestUpload`, `asideCli`/`asideAccount`는 config).
3. 「지금 동기화」 1회 run(PD-7) — 승인 매니페스트에 workflow/version 축 추가, FE wire 결정(§10 세 번째).
4. aside_v2 §15 성공 기준 1~8 측정(attempt 1행 · rows_new · 재전송 idempotency · no-leak · fixture 두 종 · WRITE 0 ·
   LOCAL_HELPER 회귀 · 승인 1=run 1).
