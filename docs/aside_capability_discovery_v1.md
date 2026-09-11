# Aside Capability Discovery v1 — read-only

> **문서 성격.** Aside Acquisition Track의 capability discovery 결과다. 목표 하나에 답한다:
> **Aside를 Reviewnary의 authenticated browser execution provider로 실제로 쓸 수 있는가.**
> Astra는 전부 제외한다.
>
> **범위.** 이번 단계는 read-only probe다. NAVER Seller Center 접근·로그인·export·marketplace write·
> credential 입력·provider code 구현·commit은 **하지 않았다**. 확인은 실제 tool schema / CLI help /
> REPL 반환값 / 로컬 상태 파일로 했고, 추정은 최소화했다.
>
> **작성일.** 2026-09-12. 이 저장소 worktree `experiment/aside-executor` @ `de1838f6`(pre-Aside baseline).
> 코드 변경 0.
>
> **환경 snapshot (2026-09-12, 이 기계).** 이 문장들은 이 시점의 이 설치본에 대한 사실이며 Aside는
> 초기 제품이므로 빠르게 변할 수 있다.
> - Aside Browser.app `1.0.910.1` (`at.studio.AsideBrowser`, Chromium 기반, `/Applications/Aside.app`)
> - Aside CLI `1.26.906.1630` (`~/.local/bin/aside` → `~/.aside/cli`), skill version 3
> - Aside Daemon: `aside-daemon` LISTEN `127.0.0.1:21420`
> - 계정: email `dnxorkd1@gmail.com`, plan **free**, mode `cloud`, single account `u0`
> - default model: `claude-code / claude-opus-5 @ high` (BYO-model; Aside는 자체 모델 없음)

---

## 상태 어휘

각 사실은 넷 중 하나로 결론짓는다.

- **CONFIRMED** — 실제 schema / help / probe로 확인.
- **SUPPORTED-BUT-UNPROVEN** — Aside가 capability는 제공하나 Reviewnary PoC(특히 NAVER)에서 미검증.
- **NOT-SUPPORTED** — 현재 제공 기능으로 불가능하거나 명시적으로 없음.
- **UNKNOWN** — 이번 조사로 답할 수 없음.

가격/plan/policy처럼 외부에서 변할 수 있는 것은 **snapshot fact**로 표시한다.

---

## Executive conclusion

**READY_WITH_GAPS.**

Aside는 Reviewnary가 필요로 하는 실행 프리미티브를 **전부 제공한다**: 로그인 세션을 소유한 persistent
Chromium profile, 결정론적 Playwright 스타일 navigation/click/read, 공식 다운로드 이벤트와 완료 감지,
external process가 읽을 수 있는 실제 host 경로로의 파일 착지, run identifier·구조화된 오류·토큰/비용
관측. 그리고 **모델을 부르지 않는 결정론 실행 경로(`aside repl`)가 존재**한다 — 이것이 「every sync
observable and idempotent」와 「no LLM cost per sync」를 동시에 만족시키는 핵심이다.

READY가 아니라 READY_WITH_GAPS인 이유는 셋이다. 어느 것도 PoC를 막지 않지만 **provider 계약과 policy
fence에서 반드시 다뤄야 한다**:

1. **G-1 (policy fence — 가장 중요).** Aside는 우리 정책이 **금지한** 자동화를 기본으로 제공한다 —
   `captcha` global(reCAPTCHA/Turnstile/hCaptcha/이미지 CAPTCHA를 click/drag/OCR로 자동 해결)과
   Password Manager 자동 autofill/자동 회원가입. PD-2(「MFA/CAPTCHA/re-auth는 AUTH_REQUIRED로 fail
   closed, 우회 0」)와 CLAUDE.md fence(CAPTCHA/2FA 우회 금지)를 지키려면 **Reviewnary Runner는 이 기능들을
   호출하지 않는 결정론 실행 경로(`repl`)만 쓰고, agent 경로(`exec`)는 쓰지 않아야** 한다. 이것은 provider
   구현에서 **구조로** 강제할 사항이다(§10, §Product decisions).

2. **G-2 (ambiguity가 자동 fail되지 않는다).** Aside의 locator는 Playwright **strict mode가 꺼져 있다** —
   두 개가 매치되는 버튼에 `.click()`을 하면 **첫 번째를 눌러 성공**한다(§Browser 실측). fail-closed는
   **구현 가능하지만 자동이 아니다**: Runner가 매 액션 전에 `locator.count() === 1`을 assert해야 한다.
   aside_v2 §9의 「export 컨트롤 2개 이상이면 정지」는 우리가 코드로 강제해야 하는 규칙이지 Aside가 주는
   보장이 아니다.

3. **G-3 (store identity의 실제 값 미검증).** 페이지 URL·title·DOM·iframe을 stable하게 읽는 수단은
   **CONFIRMED**이나, NAVER SmartStore에서 실제로 어떤 machine-verifiable store identifier를 얻을 수
   있는지는 NAVER를 열지 않았으므로 **UNKNOWN**(H-3 그대로). PD-4의 fail-closed는 이 값이 관측되지 않으면
   `STORE_UNRESOLVED`로 정지하므로 안전 측면은 유지되나, PoC 첫 측정 대상이다.

target architecture(aside_v2)와 **충돌하는 결정은 없다**. PD-1~PD-8은 그대로 유효하고, `ExecutionProvider`
seam은 Aside의 실행 모델과 맞는다(§추천 provider boundary).

---

## 1. Confirmed Aside capabilities (요약표)

| 질문 | 상태 | 근거(확인 방법) |
|---|---|---|
| A. runtime / invocation | **CONFIRMED** | CLI help, `aside mcp` schema, daemon port, state.db |
| B. browser / profile ownership | **CONFIRMED** | persistent Chromium profile, `browser_binding.profileId`, 로그인 세션 재사용 |
| C. authentication boundary | **CONFIRMED (+G-1)** | Password Manager skill, `captcha` skill, `paymentUse` 설정 |
| D. deterministic navigation/execution | **CONFIRMED (+G-2)** | REPL Playwright API 실측(click/fill/select/waitFor/snapshot) |
| E. store identity observables | **CONFIRMED (observables) / UNKNOWN (NAVER 실값)** | `page.url()`·`title()`·`snapshot`·`evaluate` 실측; NAVER 미접촉 |
| F. download capability | **CONFIRMED** | download 이벤트·`download.path()`·`chrome.downloads.search` state 실측 |
| G. file handoff / filesystem | **CONFIRMED (host Downloads) / 제약 있음 (REPL fs sandbox)** | 실제 host 경로 착지 + fs sandbox 실측 |
| H. multiple account/store | **부분 CONFIRMED** | multi-account(u0/u1), single Chromium profile, session isolation |
| I. error taxonomy | **CONFIRMED** | `abort_reason` JSON, session status, Playwright error 문자열 |
| J. observability | **CONFIRMED** | `session_turns.token_usage`/cost, run id, screenshot, UA version |
| K. cost / dependency | **부분 CONFIRMED / 일부 snapshot fact** | BYO-model, `repl`=모델 0, plan(외부 사실) |

---

## 2. A — runtime / invocation

**CONFIRMED.**

- **형태.** Aside는 세 조각이다: (1) Chromium 기반 데스크톱 브라우저 `Aside.app`, (2) 백그라운드
  `aside-daemon`(`127.0.0.1:21420` LISTEN), (3) CLI(`aside`). MCP는 `aside mcp`가 stdio로 노출한다.
  이 저장소의 Claude Code는 이미 `aside` MCP server(`command: ~/.local/bin/aside`, `args:["mcp"]`)로
  연결돼 있다.
- **두 호출 방식(CONFIRMED, 이 track의 핵심 구분):**
  - **`exec` (MCP tool / `aside exec`)** — **LLM agent**에게 자연어 task를 위임한다. 비결정론적이고
    **모델 토큰을 쓴다**. probe에서 「PROBE_OK만 답하라」는 지시에 `session_id`를 반환하고 그대로 따랐다.
  - **`repl` (MCP tool / `aside repl`)** — persistent sandbox에서 **Playwright 스타일 JS**를 돌린다.
    **모델을 부르지 않는다**(deterministic). 120초 timeout. `page`/`tabs`/`snapshot`/`fetch`/`fs`/
    `chrome`/`captcha`/`password`/`cua`/`aside` global 제공.
  → **Reviewnary Runner가 원하는 것은 `repl`이다**(결정론 + 비용 0 + fail-closed 강제 가능). `exec`는
    agent라 우리의 「추측으로 진행하지 않는다」와 상충한다.
- **deterministic command 수단.** `repl` = 임의 JS. **CONFIRMED**.
- **long-running / run identifier.** session이 run 단위다. `aside session list/resume/stop/steer/queue/
  archive/delete`, id 형식 `ses_...` 또는 짧은 16자(`UyopPapX8r2IDlx1`). state.db `sessions` 테이블에
  `status`(idle/aborted/errored), `trigger`, `trigger_idempotency_key`, `permission_mode`, `incognito`,
  `ephemeral`, `browser_binding`, `runtime_config`. **CONFIRMED**.
- **sync/async.** `aside repl "<code>"`는 동기(코드 실행 후 반환). `aside exec`는 session을 만들고 진행 중
  steer/queue/stop 가능(async 제어). MCP `repl` 호출은 요청-응답 동기. **CONFIRMED**.
- **timeout.** `repl` 120초/호출(schema 명시). **CONFIRMED**. 그보다 긴 작업은 여러 repl 호출로 나눠야 함.
- **cancellation.** `aside session stop <id>` / `steer` / `queue`. abort는 `abort_reason` JSON에
  `{"kind":"aborted-by-user"}`로 기록됨(실측). **CONFIRMED**.
- **retry.** daemon에 auto-retry 로그(`[AgentSession] auto retry start`) 존재 — 이는 **Aside 내부**의 모델
  호출 재시도이지 Reviewnary가 원하는 ingest 재전송 idempotency와는 다른 층이다. 후자는 우리 백엔드가
  소유한다(aside_v2 §8).
- **structured error.** state.db `session_turns.abort_reason`가 JSON: `{"kind":"error","error":"..."}`,
  `{"kind":"aborted-by-user"}`, `{"kind":"error","error":"This operation was aborted"}`. REPL 예외는
  Playwright 문자열(§I). **CONFIRMED**.
- **status polling.** `aside session list`, `aside.sessions.get(id)`(REPL global) — id·status·incognito·
  ephemeral·timestamps 반환. **CONFIRMED**.

## 3. B — browser / profile ownership (+ C 세션)

**CONFIRMED.**

- **browser 생성 주체.** Aside daemon이 Chromium 프로파일을 소유·기동한다. Reviewnary는 브라우저를
  만들지 않는다 — 목표(aside_v2 원칙 2)와 정확히 일치.
- **persistent profile.** 있음. `browser_binding.profileId` = `5a6dedfb-…`(계정별 고정). 로그인 쿠키는
  Chromium 프로파일 파일에 산다(`~/Library/Application Support/Aside/Default`). **CONFIRMED**.
- **기존 로그인 세션 재사용.** `exec`/`repl` 세션이 이 프로파일 위에서 돌아 이미 로그인된 사이트를 그대로
  쓴다(Aside 제품 자체의 전제). **CONFIRMED (일반)**. NAVER 특정은 미검증.
- **named identity 선택.** 계정 단위(`--account u0|u1`)로 프로파일을 가른다. 이 기계는 **단일 계정 u0 /
  단일 Chromium 프로파일(Default)**. **부분 CONFIRMED** — 계정별 격리는 있으나, **한 NAVER 로그인 안에서
  여러 SmartStore를 named profile로 가르는 기능은 제공되지 않는다**(§H).
- **restart 후 세션 유지.** persistent profile이므로 유지(도우미 baseline과 같은 성질). **SUPPORTED**.
- **cookie를 API로 읽을 필요 없음.** Reviewnary는 쿠키를 보지 않고 Aside 세션을 **쓰기만** 한다 — PD-1
  요구(credential/session Cloud 미이동)와 일치. REPL fs는 쿠키 DB 접근이 sandbox로 막혀 있어(§G) **오히려
  안전**하다. **CONFIRMED**.
- **incognito/ephemeral.** 세션 단위 플래그. 실측: MCP `repl` 기본 세션은 `incognito:true, ephemeral:true`
  (기존 로그인 프로파일과 분리될 수 있음 — PoC에서 「로그인 세션을 실제로 재사용하려면 어떤 세션 모드로
  띄워야 하는가」를 확정해야 함, 아래 gap). `exec` 세션은 `incognito:false`. **CONFIRMED (플래그 존재) /
  UNPROVEN (NAVER 로그인 재사용에 맞는 모드)**.

## 4. C — authentication boundary (+ G-1)

**CONFIRMED — 단, 우리 정책과의 충돌이 여기 있다.**

- **Password Manager.** native `password` global(REPL): `listItems`·`autofillItem`·`generatePassword`·
  `store`. **비밀번호 평문을 에이전트에 노출하지 않고** 로그인/결제카드/신원 autofill, 자동 회원가입,
  저장 자격 검색을 수행. **CONFIRMED**.
  - Reviewnary 함의: credential을 Claude/Reviewnary가 평문으로 볼 필요는 **없다**(좋음). 그러나 이 기능은
    **자동 로그인**을 의미하므로, PD-2의 「사람이 정상 인증」을 지키려면 Runner가 이 global을 **호출하지
    않아야** 한다.
- **CAPTCHA — G-1, 정책 충돌.** `captcha` global(REPL): `click`·`drag`·`readText`(OCR/vision)로
  reCAPTCHA/Turnstile/hCaptcha/이미지 CAPTCHA를 **자동 해결**한다. keyword auto-inject까지 설정돼 있다.
  이것은 CLAUDE.md fence(「No CAPTCHA / 2FA bypass」)와 PD-2가 **금지**하는 바로 그 행위다. → provider
  구현은 이 global을 **구조적으로 사용 불가**로 두어야 한다(§10, PRODUCT_DECISION_NEEDED-A).
- **payment.** `paymentUse.enabled=false`(현재 설정). 우리는 어차피 결제 미사용. **CONFIRMED (안전)**.
- **login-required / expired / MFA / CAPTCHA / re-auth 감지 신호.** Aside가 이 상태를 **Reviewnary Runner가
  판별 가능한 구조화된 신호로** 내주는지는 **UNKNOWN** — `exec` 경로는 agent가 알아서 처리(=우회 위험),
  `repl` 경로에서는 **우리가 snapshot으로 로그인/2FA/계정선택 화면을 직접 판별**해야 한다(도우미 baseline의
  5-state verdict가 하던 일). 즉 감지 로직은 **Reviewnary가 소유**하고 Aside는 관측 표면(snapshot)만 준다.
  이는 H-2를 「Aside가 신호를 주지 않으므로 Runner가 snapshot 규칙으로 판정한다」로 좁힌다.

## 5. D — deterministic navigation / execution (+ G-2)

**CONFIRMED.** REPL은 완전한 Playwright 스타일 API를 준다(실측):

- page: `goto`·`reload`·`goBack/Forward`·`click`·`fill`·`title`·`url`·`screenshot`·`pdf`·`waitForSelector`·
  `waitForEvent`·`waitForURL`·`waitForLoadState`·`frames`·`frameLocator`·`getByRole/Text/Label`·`evaluate`·
  `on(event)`·`snapshot`.
- locator: `click`·`fill`·`selectOption`·`check`·`press`·`type`·`hover`·`count`·`isVisible`·`isEnabled`·
  `isDisabled`·`innerText`·`getAttribute`·`nth`·`first`·`filter`·`boundingBox`·`waitFor`·`setInputFiles`·
  `dragTo`·`scrollIntoViewIfNeeded`.
- `snapshot(page,{interactive})` = accessibility tree + ref id(`e12`) + `diff`. child-iframe 포함, 뷰포트
  밖 요소 포함. **iframe 해석·요소 질의·가시 텍스트 읽기 전부 가능** — baseline이 in-page tagger로 하던
  일을 Aside snapshot이 대체한다.
- date range 입력: `fill`/`selectOption`으로 가능(일반). NAVER 특정 미검증.
- **element ambiguity — G-2 (실측).** `button.dup`이 2개인데 `locator('button.dup').click()`이 **성공**했다
  (Playwright strict mode OFF, 첫 요소 클릭). `count()`는 2를 정확히 반환. 없는 셀렉터 클릭은 `"Selector
  '#nope' not found"`로 **throw**. bad port navigation은 `net::ERR_UNSAFE_PORT` throw.
  → **fail-closed는 구현 가능하나 자동이 아니다.** Runner는 매 결정적 액션 전에 `count()===1`을 assert하고,
    2 이상이면 `TARGET_AMBIGUOUS`로 정지해야 한다(aside_v2 §9를 우리가 코드로 강제).
- `page.on('dialog')`·`on('download')`·`on('filechooser')` 이벤트 등록 가능 — 동의 dialog 처리 seam 존재.
  **CONFIRMED**.
- `cua`(visual-browse, 좌표 클릭)·`captcha`도 있으나 결정론/정책 관점에서 **사용하지 않는다**(§10).

## 6. E — store identity verification feasibility

**observables: CONFIRMED. NAVER 실제 identifier: UNKNOWN (H-3 유지).**

- 현재 페이지를 structured하게 읽는 수단 전부 실측 확인: `page.url()`, `page.title()`,
  `snapshot(page)`(title+url+iframe 트리), `page.evaluate(() => …)`, `getByRole`/`locator(...).innerText()`.
- 따라서 aside_v2 §6이 요구하는 「expected identity vs observed identity 대조에 필요한 **observable**」은
  **Aside가 제공한다**(CONFIRMED). 예: SmartStore 관리 URL의 stable path segment, 계정/스토어 표시 영역의
  텍스트, DOM data attribute 등을 읽어 Runner에서 즉시 hash(baseline `account-fingerprint.ts` 계약 재사용).
- **미결(H-3).** NAVER SmartStore에서 실제로 어떤 값이 **machine-verifiable stable id**로 쓸 만한지는
  NAVER를 열지 않았으므로 모른다. PD-4는 「충분한 증명 부족 시 `STORE_UNRESOLVED` fail closed」이므로
  안전은 유지되며, 이것이 PoC의 첫 측정 항목이다.

## 7. F — download capability

**CONFIRMED — 강함.**

- **download 이벤트.** `page.waitForEvent('download')` 동작(실측). download 없으면 timeout throw(파일
  미발생을 확정적으로 판별 가능).
- **download 객체 메서드(실측):** `path()`·`suggestedFilename()`·`failure()`·`saveAs()`·`cancel()`·
  `delete()`·`createReadStream()`·`url()`·`guid`·`page()`.
- **완료·실패·크기·MIME.** `chrome.downloads.search(query)`가 `state`(complete/in_progress/interrupted)·
  `exists`·`totalBytes`·`bytesReceived`·`mime`·`error`·`paused`·`danger`·`filename`·`finalUrl`·`id`를
  반환(실측: `{state:"complete", exists:true, totalBytes:14, mime:"application/macbinary"}`). partial/
  incomplete 구분·다중 다운로드 구분(id·startTime)·완료 감지·실패 감지 전부 **CONFIRMED**.
- **파일명/타입.** `suggestedFilename()` + `chrome.downloads` mime. NAVER는 확장자 없는 UUID명(baseline
  §2.4)이라 우리는 category(확장자 유무)만 쓰고 바이트 sniff는 백엔드가 소유(변경 0) — aside_v2 §7과 일치.
- **실제 local file path.** `download.path()` = **실제 host 경로**(`/Users/taewookang/Downloads/…`),
  임시 경로가 아니라 사용자 Downloads에 착지(실측). → **§G의 핸드오프 seam.**
- **target folder 지정.** `download.saveAs(<path>)` 가능하나 **REPL fs sandbox 안**으로만(§G). chrome
  download 정책상 기본 착지는 host Downloads.

## 8. G — file handoff / filesystem boundary

**핵심 발견. CONFIRMED — 두 개의 서로 다른 파일시스템 뷰가 있다.**

1. **REPL fs global은 sandbox돼 있다.** readable/writable roots = **현재 세션 디렉터리 + project workspace
   뿐**이다. 실측: `~/Users/taewookang`, `~/Downloads`, worktree, `/tmp` 전부
   `"Path escapes Project and session roots"`로 거부. session의 writableRoots =
   `~/.aside/u/0` + `~/.aside/u/0/sessions/<sid>`. `saveAs`를 세션 밖 절대경로로 하면
   `"escapes the session directory"`.
2. **그런데 download는 실제 host `~/Downloads`에 착지하고, `download.path()`가 준 그 경로는 REPL
   `fs.stat`/`fs.readFile`로 읽힌다**(실측: 23바이트·14바이트 두 번 확인). 즉 **완료된 다운로드 파일은
   sandbox 예외로 REPL에서 읽을 수 있고**, 물리적으로는 host 파일시스템의 `~/Downloads`에 있다.

→ **핸드오프 결론(READY):** 다운로드 파일은 판매자 PC의 실제 `~/Downloads/<name>`에 존재한다. 따라서
   **Reviewnary Runner(별도 host 프로세스)는 그 경로를 직접 읽을 수 있다.** 두 가지 실행 shape:
   - **(shape 1, 권장) Runner가 host 프로세스.** Runner가 `aside repl`로 export→download를 돌리고,
     `download.path()`(또는 `chrome.downloads.search`의 `filename`)로 host 경로를 받아 **Runner 자신이
     그 파일을 읽어** SHA-256 → 기존 ingest endpoint로 raw bytes 전송 → ACK → local delete. Runner는
     Aside sandbox 밖의 평범한 프로세스이므로 `~/Downloads` 접근에 제약 없음.
   - **(shape 2, 대안) REPL 안에서 바이트 반환.** REPL에서 `fs.readFile(download.path())` → base64 →
     `console.log`로 Runner에 반환. 단일 repl 호출로 export+read를 끝내야 함(세션 종료 후 임시 REPL은
     파일 접근 보장 안 됨 — guide 명시). 파일 크기·120초 제한 때문에 shape 1이 안전.
- **cleanup.** `download.delete()` 또는 Runner의 host `unlink`로 ACK 후 삭제(PD-5). REPL fs로 세션 밖
  삭제는 불가하므로 **Runner(host)가 삭제를 소유**하는 것이 자연스럽다.
- **PD-8와 정합.** Runner는 파서를 만들지 않고 raw bytes만 기존 endpoint로 보낸다 — Aside/REPL의 fs 제약과
  무관하게 성립(파싱은 백엔드 메모리).

## 9. H — multiple account / store

**부분 CONFIRMED.**

- **multi-account.** CLI `--account u0|u1`, `aside account list/status/use`. 계정별 프로파일 격리.
- **한 run이 어느 프로파일에서 돌았는지 기록.** `sessions.browser_binding.profileId` + `runtime_config` +
  session id로 확인 가능. **CONFIRMED**.
- **concurrent execution.** 여러 세션이 동시에 존재(실측 17 세션). 다만 전부 **같은 profileId**를 공유 —
  같은 Chromium 프로파일 위 다중 세션이다.
- **격리의 한계(중요).** 초기 PoC는 「1 seller / 1 store」이므로 문제없다. 그러나 **한 NAVER 로그인 안의
  여러 SmartStore**를 named profile로 자동 격리하는 기능은 없다 → 여러 스토어 org에서는 **§E의 run-time
  store identity 대조(PD-4)가 유일한 안전장치**다. aside_v2 §6이 이미 이 방향(구조로 닫는다).

## 10. I — error / status taxonomy

**CONFIRMED.** Aside가 내는 실제 신호 → Reviewnary target status 매핑:

| Aside 관측(실측) | Reviewnary target(aside_v2 §10) |
|---|---|
| `session_turns.abort_reason {"kind":"aborted-by-user"}` | (운영자 취소) |
| `{"kind":"error","error":"This operation was aborted"}` / session `errored` | `RUNTIME_FAULT` / `PROVIDER_TIMEOUT` |
| REPL `"Selector '…' not found"` (throw) | `TARGET_NOT_FOUND` |
| `locator.count() >= 2` (우리가 assert) | `TARGET_AMBIGUOUS` |
| `waitForEvent('download')` timeout (throw) | `DOWNLOAD_TIMEOUT` |
| `chrome.downloads` state `interrupted` + `error` | `ARTIFACT_INVALID` / `DOWNLOAD_TIMEOUT` |
| snapshot이 login/2FA/계정선택 화면(우리가 판정) | `AUTH_REQUIRED` / `TWO_FACTOR_REQUIRED` (PD-2) |
| store id 미관측/불일치(우리가 판정) | `STORE_UNRESOLVED` / `STORE_MISMATCH` (PD-4) |
| daemon 미기동(`ECONNREFUSED 127.0.0.1:21420`, 실측) | `PROVIDER_UNAVAILABLE` |
| Runner→백엔드 전송 실패 | `TRANSFER_FAILED` |

- 구분 가능(실측): target missing(throw) vs ambiguous(count) vs timeout(throw) vs browser unavailable
  (ECONNREFUSED) vs cancelled(abort_reason). **product enum은 이 단계에서 수정하지 않는다.** aside_v2 §10의
  taxonomy가 이 신호들을 이미 상위 집합으로 덮는다.
- `PROVIDER_UNAVAILABLE`은 실제로 재현됨: Aside Browser 미기동 상태에서 MCP `repl`/`memory_search`가
  `fetch failed: connect ECONNREFUSED 127.0.0.1:21420 / Aside isn't running`을 반환.

## 11. J — observability

**CONFIRMED.** Reviewnary SyncRun에 채울 수 있는 Aside 필드:

| SyncRun에 원하는 것 | Aside가 주는가 | 근거 |
|---|---|---|
| run id | **예** | session id(`ses_…`/16자) |
| start/end timestamp | **예** | `session_turns.started_at`/`finished_at`(unix), `sessions.created/updated_at` |
| steps/events | **예(agent 경로)** | `aside.sessions.messages(id)` transcript; repl 경로는 우리 로그 |
| error detail | **예** | `abort_reason` JSON(§I) |
| screenshots | **예** | `page.screenshot()`(44KB PNG 실측), `annotatedScreenshot` |
| logs | **예** | daemon 로그(구조화 JSON, sanitized) |
| token/model usage | **예** | `session_turns.token_usage {input,output,cacheRead,cacheWrite,totalTokens}` |
| monetary/credit usage | **예(계산치)** | `token_usage.cost {input,output,cacheRead,cacheWrite,total}` (실측 예: $0.1218) |
| browser version | **예** | UA `Chrome/152.0.0.0`; app `1.0.910.1` |
| executor version | **예** | CLI `1.26.906.1630`, runtime `1.26.829.1514` |

- **중요.** 우리가 `repl`(결정론) 경로를 쓰면 **모델 토큰·비용이 0**이다(agent 미호출). token_usage/cost는
  `exec`(agent) 경로에서만 발생. 즉 관측 필드는 있으나 결정론 경로에서는 대부분 0이며, 그것이 우리가
  원하는 바다.
- **sanitized 원칙 유지.** Aside 응답에서 selector·URL·path·credential·page content는 provider 계약 경계
  (`findProhibitedFields` gate)에서 걸러 SyncRun에는 enum·count·hash·바이트만 남긴다(aside_v2 §5).

## 12. K — cost / dependency

**부분 CONFIRMED / 일부 snapshot fact (외부에서 변함).**

- **BYO-model (CONFIRMED, 설정).** Aside는 자체 모델이 없다. 이 기계 default = `claude-code /
  claude-opus-5`. 사용자의 ChatGPT/Claude 구독 또는 API 키 또는 Aside cloud credit으로 과금.
- **결정론 실행 비용 (CONFIRMED, 핵심).** `repl`(Playwright JS)은 **모델을 부르지 않는다** → LLM 비용 0.
  `exec`(agent)만 토큰을 쓴다. **Reviewnary가 `repl` 경로를 쓰면 sync당 반복 LLM 비용이 없다.**
- **plan (snapshot fact, 외부 사실, 변동 가능).** 이 계정 = **free**. 공개 자료 기준 Free 500 credit/월 +
  routine 3개, Pro $20/월, Max $200/월(YC F25, 2026-06 launch). Aside 서버 실행(cloud) 시 credit 소모;
  local 실행은 사용자 자원. **정확한 실행당 credit 단가는 UNKNOWN**(벤더 미공개, 저장소에서 검증 불가).
- **browser execution 자체 비용.** local 실행 = 판매자 PC 자원(도우미 baseline과 동일). **CONFIRMED
  (local)**.
- **rate limit / concurrency.** **UNKNOWN**(공개 수치 없음). repl 120초/호출은 확인.
- **dependency.** Aside 서비스(daemon + 로그인된 앱)에 의존. 미기동 시 `PROVIDER_UNAVAILABLE`. → Local
  Helper/수동 업로드 fallback이 필수(aside_v2 §13, 유지).

가격/plan/policy는 **snapshot fact**이며 초기 제품이라 빠르게 바뀔 수 있다.

---

## 13. Current target architecture(aside_v2)와 충돌하는 점

**충돌하는 결정은 없다.** PD-1~PD-8 전부 유효하다. 다만 **provider 계약에서 반드시 강제할 조건 셋**과
**PoC에서 검증할 가정 둘**이 생겼다:

- **강제 조건 (충돌 아님, 구현 규율):**
  1. **결정론 경로만.** Runner는 `repl`만 쓰고 `exec`(agent)는 쓰지 않는다(G-1·G-2·비용·「추측 금지」).
  2. **정책 global 미사용.** `captcha`·`password`(자동 로그인)·`cua`(좌표 우회) global을 provider 코드에서
     구조적으로 호출 불가로 둔다 — 도우미의 source-guard와 같은 모양의 fence.
  3. **매 액션 pre-assert.** `count()===1`, snapshot 기반 화면 판정, download 완료 확인, store id 대조.
- **PoC 검증 가정:**
  - H-3: NAVER의 실제 machine-verifiable store id(§E).
  - 세션 모드: 로그인된 프로파일을 실제로 재사용하려면 어떤 세션 모드/`--account`로 repl을 띄워야 하는가
    (MCP 기본 repl 세션은 incognito였음).

## 14. KEEP / WRAP / REPLACE / REMOVE 재평가 (capability 조사 후)

aside_v2 부록 A를 capability 근거로 재확인한 결과 — **분류 변경 없음**. 근거만 강화:

| 분류 | 항목 | capability 근거(신규) |
|---|---|---|
| KEEP | parser·dedup·plan/segment/launch·ingest spine·Attention/RAG·수동 fallback | Aside가 건드리지 않음. PD-8로 파서 위치 변경 0 확정 |
| WRAP | Local Helper import carrier 전체를 `ExecutionProvider.LOCAL_HELPER`로 | 그대로. Aside는 두 번째 provider |
| WRAP | downloader/uploader(`ingest-handoff.ts`·`uploadSegmentReviewBytes`) | Runner가 host에서 같은 endpoint 호출(§G shape 1) |
| REPLACE | direct Chrome/session ownership(`profile.ts#launchNaverContext`, slot profile dir) | **Aside가 profile·세션 소유(§B)로 이 역할을 가져감** — 확인됨 |
| REPLACE | seller-center UI navigation·export 관찰 규칙 | **Aside snapshot/locator가 대체(§D)** — iframe·요소질의·다운로드 감지 전부 제공 |
| REMOVE 후보 | legacy 클릭 계측 모듈 | 그대로(별도 결정) |
| REMOVE 아님 | Local Helper 자체 | Coupang READ·issuance·locate·renewal·reply carrier의 유일한 host. Aside는 NAVER import 하나만 provider로 |

**LOCAL_HELPER vs ASIDE 공존.** 같은 `ExecutionProvider` 계약 뒤에서 provider로 공존 **가능**(CONFIRMED
방향): LOCAL_HELPER는 기존 엔진을 WRAP(내부 변경 0), ASIDE는 Runner가 `repl`로 구현. 계약 밖으로 나오는
값은 sanitized enum·count·hash·바이트뿐.

## 15. 추천 provider boundary

**Option A (ReviewAcquisitionProvider 수준)를 추천한다** — 단, aside_v2 §14의 `ExecutionProvider`
어휘로.

이유:
- capability 조사 결과 Aside의 자연스러운 단위는 **「인증된 프로파일 위에서 결정론 브라우저 워크플로 1회를
  돌리고 파일을 host에 떨군다」**이다. 이것은 정확히 **한 export run = 한 provider 호출**(Option A)이지,
  범용 저수준 브라우저 명령 채널(Option B의 `BrowserExecutionProvider`)이 아니다.
- Option B(저수준 click/type/navigate를 Reviewnary orchestration이 원격 구동)는 **두 개의 나쁜 결과**를
  낳는다: (1) NAVER UI 변경 추종 규칙이 다시 Reviewnary 코드로 돌아온다(REPLACE 목표에 역행), (2) 매
  저수준 명령이 왕복이라 120초 repl 창·비용·복잡도가 커진다.
- 따라서 **한 계약, 한 단위**: `ExecutionProvider.execute(run) → {artifact, observed} | {error}`
  (aside_v2 §14 그대로). Aside adapter 내부에서 navigation/assert/download/read를 **하나의 repl 프로그램**
  으로 수행한다. `BrowserExecutionProvider`라는 두 번째 추상화는 **만들지 않는다**(불필요).
- interface 이름보다 **책임 경계**가 먼저다: provider는 「범위 사실을 받아 → 인증·스토어 대조·기간 설정·
  공식 export·다운로드 → 파일과 관측을 반환」한다. ingest 권한(launch_ref)·파싱·dedup·상태는 provider에
  주지 않는다.

## 16. Product decisions needed

- **PRODUCT_DECISION_NEEDED-A (policy fence 확정).** provider는 `exec`(agent)가 아니라 **`repl`
  (결정론)만** 사용하고, `captcha`/자동 `password` 로그인/`cua`를 **호출 금지**로 둔다 — 이를 source-guard
  테스트로 강제한다. (aside_v2 PD-2·CLAUDE.md fence의 실행 방식 확정. 방향은 이미 결정돼 있으므로 **확인**
  성격.)
- **PRODUCT_DECISION_NEEDED-B (execution locality).** Aside를 **local 실행**(판매자 PC)만 쓸 것인가, cloud
  실행도 허용할 것인가. PD-1(credential/session Cloud 미이동)과 정합하려면 **local 권장**. cloud는 세션이
  Aside 서버에 사는 것을 의미하므로 별도 검토.
- **PRODUCT_DECISION_NEEDED-C (핸드오프 shape).** §G shape 1(Runner가 host에서 `~/Downloads` 파일 직접
  read)과 shape 2(repl에서 base64 반환) 중 확정. shape 1 권장(크기·120초 제한 회피).
- **OPEN 유지:** Q-1(scheduled unattended의 policy 적합성). H-3(NAVER store id 실값)은 PoC 측정.

## 17. PoC blockers / non-blockers

**Blockers (PoC 시작 전 반드시):**
- 없음(코드 차원). Aside는 필요한 프리미티브를 전부 제공한다.
- 단 **정책 fence(A)**를 provider 설계에 못박지 않으면 시작하면 안 된다 — 이것은 코드 blocker가 아니라
  설계 blocker다.

**Non-blockers (PoC 중 처리):**
- H-3 store id 실값 — PoC 첫 측정. 없으면 `STORE_UNRESOLVED` fail-closed라 안전.
- 세션 모드(로그인 프로파일 재사용) — PoC 초기에 `--account`/세션 모드로 확정.
- G-2 ambiguity assert — Runner 코드에서 `count()===1`로 처리.
- 가격/rate limit UNKNOWN — free plan·local 실행으로 PoC 가능. 운영 규모는 별도.

---

## 18. 다음 큰 development milestones (제안 — 실행은 product-owner 확인 후)

각 milestone: 목적 · 변경 영역 · 완료 조건 · 제외 · 위험.

### Milestone 1 — Execution Provider Foundation (계약 + LOCAL_HELPER wrap)
- **목적.** `ExecutionProvider` 계약을 `contracts/`에 고정하고, 기존 Local Helper import carrier를
  `LOCAL_HELPER` provider로 WRAP해 **기존 테스트가 그대로 통과**함을 증명(교체 가능성의 대조군).
- **변경 영역.** 새 계약(`contracts/`), `ExecutionProvider` axis 저장 위치(PD-3, sync_jobs vs attempt),
  LOCAL_HELPER adapter(엔진 내부 변경 0), sanitized 응답 gate 재사용.
- **완료 조건.** LOCAL_HELPER 경로 회귀 green, capability delta 0, no-leak 테스트 green.
- **제외.** Aside 코드 0, NAVER 접근 0, enum/schema는 계약이 요구하는 최소만.
- **위험.** `ExecutionProvider` 어휘가 `ImportProbeDriver`의 관찰 어휘와 충돌 → 한 단계 위 계약으로 회피
  (aside_v2 §14).

### Milestone 2 — Aside Execution Adapter (skeleton, NAVER 미접촉)
- **목적.** Runner가 `aside repl`을 호출하는 `ASIDE` adapter를 골격까지. 정책 fence(A) 구조화, 결정론
  액션 라이브러리(assert-then-act), store-id observe/hash, download→host-path 핸드오프(§G shape 1).
- **변경 영역.** Runner(Seller PC), `repl` 프로그램 템플릿, `count()===1`/snapshot 판정/`captcha`·
  `password` 미사용 source-guard, provider 응답 sanitize.
- **완료 조건.** **가짜 export 페이지(로컬 fixture)** 로 end-to-end: 스토어 대조 → 기간 설정 read-back →
  export 클릭 → download 감지 → host 파일 경로 반환. NAVER 0.
- **제외.** NAVER Seller Center, marketplace write, scheduler.
- **위험.** MCP 세션 모드(incognito) 때문에 로그인 프로파일 재사용이 fixture에선 안 드러남 → M3에서 확인.

### Milestone 3 — NAVER Export Live PoC (single explicit run)
- **목적.** PD-7 human checkpoint 1회로 실제 NAVER SmartStore export → 기존 ingest E2E. H-3(store id
  실값) 측정.
- **변경 영역.** M2 adapter를 NAVER에 연결, `AUTH_REQUIRED`/`STORE_*` 실측 매핑, freshness.
- **완료 조건.** aside_v2 §15 성공 기준 1~8(attempt SUCCEEDED, reviews==rows_new, 재전송 attempt 0,
  no-leak 0, store mismatch fail-closed, WRITE 0, LOCAL_HELPER 회귀 green, 승인 1=run 1).
- **제외.** scheduler, 다중 스토어 자동화, cloud 실행.
- **위험.** 세션 인증 상태·NAVER UI 변경. fail-closed라 안전하나 friction 관측 필요.

### Milestone 4 — PoC Hardening
- **목적.** 실패 taxonomy 완성, at-least-once + idempotency-key(§8), fail-closed 전수, 반복 sync, metrics.
- **변경 영역.** idempotency-key 저장소(백엔드), provider 실패 코드, quarantine TTL, 관측 필드.
- **완료 조건.** 재전송이 attempt를 늘리지 않음, 모든 fail-closed 경로 테스트, LOCAL_HELPER/수동 fallback
  동작.
- **제외.** unattended/scheduler(Q-1).
- **위험.** attempt 이중 계상(Coupang이 재시도를 금지한 이유) — idempotency-key로 방어.

(정확한 milestone 경계는 M1 계약 확정 후 조정.)

---

## 19. 작성된 문서와 repo diff

- **신규:** `docs/aside_capability_discovery_v1.md` (이 문서).
- **수정:** 없음. baseline/aside_v2/comparison 문서 무변경.
- **commit:** 없음(이번 단계 commit 0).
- **코드 변경:** 0.
- **Aside probe로 생긴 로컬 artifact:** 판매자 `~/Downloads`에 만든 probe 파일 2개는 **삭제 완료**. 진단용
  `state.db` 사본은 세션 scratchpad(저장소 밖)에만 있음 — repo 미포함.

---

## 부록. 확인 방법 로그 (2026-09-12)

- CLI: `aside --version`(1.26.906.1630), `aside --help`, `aside <sub> --help`, `aside guide` / `guide repl`,
  `aside skills list/show`, `aside account`, `aside settings`.
- MCP: `mcp__aside__repl`(Playwright API·fs sandbox·download·chrome.downloads·globals 실측),
  `mcp__aside__exec`(PROBE_OK 무접촉 확인), `mcp__aside__memory_search`.
- 로컬 상태(read-only): `~/.aside/`(runtime·logs·accounts.json·u/0/{settings,models,skills,state.db}),
  `~/Library/Application Support/Aside/`(Chromium profile·CaptchaProviders·AsidePasswordManager),
  `/Applications/Aside.app/Contents/Info.plist`. state.db는 immutable 사본으로 스키마만 조회.
- 외부(snapshot fact): aside.com 공개 자료·YC F25·가격 기사(2026-06~29). 가격/plan/rate는 변동 가능.
- **미접촉:** NAVER Seller Center, marketplace UI/write, 실제 export, credential 입력, provider code.
