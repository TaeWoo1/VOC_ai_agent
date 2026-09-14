# Aside Acquisition Productization v1

2026-09-14. 이미 live-proven한 Coupang Aside review acquisition을 개발자용 PoC가 아니라
**seller-facing BYO acquisition flow**로 만든다.

IssueActionCandidate v0 / Core / Media contract **freeze**. 새 marketplace semantics **0** ·
새 control plane **0** · scheduler **0** · pagination **0** · marketplace WRITE **0** · 실행 LLM **0** ·
마이그레이션 **0**.

---

## 1. 기존 PoC와 productized flow의 차이

인벤토리 결과 **누르고 난 뒤는 전부 있었다**. 없던 것은 **누를 자리**였다.

| | PoC (M3–M6) | v1 |
|---|---|---|
| 실행 lane | mint → carrier → Aside read → identity → ingest → dedup → `sync_jobs` → coverage 문장 → 실패 어휘 | **무변경** |
| 시작하는 곳 | Agent 대화의 `HUMAN_ACTION_REQUIRED` artifact **하나** | 대화 + **채널 화면의 「상품평 가져오기」** |
| 채널 화면이 하는 말 | 「**Action Window**는 판매자가 직접 실행하는 수집 경로라…」 — 내부 낱말, 누를 것 없음 | 「판매자가 직접 실행하는 수집 경로라… 위 「상품평 가져오기」에서 실행할 수 있습니다」 |
| 누르기 전에 아는 것 | 없음 — 전제조건은 눌러서 400/409로 배운다 | 계정 전제조건 + 도우미 상태 + 무엇이 열려 있어야 하는지 |
| 설치된 Runner에서 BYO | **불가능** — `REVIEWNARY_EXECUTION_PROVIDER`가 프로세스 env 전용이라 패키지 helper가 볼 수 없다 | `helper.env`의 선언된 키 |

**추가된 코드는 읽기 하나와 화면 하나뿐이다.** `GuidedAcquisitionRun`은 대화 artifact에서 **그대로**
꺼내 두 화면이 mount하고, 실행·승인·ingest 경로는 한 글자도 바뀌지 않았다.

---

## 2. 실제 onboarding UX

```
/connect/channels/{account}
  └ 리뷰 기록                     (기존)
  └ 상품평 가져오기               ← v1, y=431 · 1440/1366/1152 전부 fold 위
       · 쿠팡은 상품평을 가져오는 판매자 API가 없어서, 열려 있는 판매자 화면을 읽어 옵니다.
         쿠팡 판매자 페이지에 로그인한 뒤 상품평 목록을 열어 두고 아래 버튼을 눌러 주세요.
       · reviewnary 도우미  [연결됨 | 설치 필요 | 실행 필요 | 기기 연결 필요 | …]   ← 기존 카드 그대로
       · (막혔으면) 한 문장 + 다음 걸음 하나
       · [지금 동기화]            ← 준비됐을 때만 활성
       · (누른 뒤) 진행 패널 · 완료 문장 · [다시 동기화]
  └ 수집 이력                     (기존) — 상태 · 저장/건너뜀/실패 · coverage 문장 · 실패 사유 문장
```

- **한 번 누름 = 한 run.** 다시 읽으려면 다시 눌러야 하고, 그것이 run 컴포넌트를 다시 mount한다는 뜻이다.
  조용히 재실행하는 버튼은 단계가 하나인 스케줄러다.
- **화면에 provider 이름 0** — 실측으로 `ASIDE` · `LOCAL_HELPER` · `SELLER_CENTER_READ` ·
  `Action Window` · `PAGE_LIMIT_REACHED` · `carrier` · `acquisitionRef` 전부 **미노출**
  (`execution_strategy_v1.md` §5 결정 그대로).
- 이 채널에 화면 읽기 경로가 **없으면 섹션 자체를 그리지 않는다**. 「가져오기」 제목을 붙여 놓고 왜
  비어 있는지 설명하는 것은 못 하는 일을 모든 채널에 광고하는 것이다.

---

## 3. Runner / browser state model

세 축이고, **서로 다른 곳에서 실패하므로 따로 묻는다**.

| 축 | 누가 답하나 | 값 | 마켓플레이스 접촉 |
|---|---|---|---|
| **계정** | backend `GET …/review-acquisition-readiness` | `READY` · `CHANNEL_NOT_SUPPORTED` · `FILE_UPLOAD_ACCOUNT` · `HELPER_NOT_LINKED` · `STORE_IDENTITY_UNKNOWN` | **0** |
| **기계** | 기존 도우미 카드(`helperStatusOf`) | 연결됨 · 설치 필요 · 실행 필요 · 다시 연결 필요 · 기기 연결 필요 · 업데이트 필요 | 0 |
| **마켓플레이스 로그인** | **아무도 — run이 알아낸다** | `LOGIN_REQUIRED` (fail closed) | run 1회 |

- **계정 축은 `mint()`가 늘 강제하던 바로 그 술어다.** `readinessOf`가 한 곳이고 두 caller가 묻는다 —
  화면이 「준비됨」이라고 말하는데 누르면 거절당하는 상태가 구조적으로 없다.
- **기계 축은 두 번 파생하지 않는다.** 도우미 카드가 소유자이고(bridge phase + 버전 probe + device link),
  패널은 `onState`로 **보고받는다**. 카드의 진단을 한 줄 아래에 다시 적지 않는다 — 처음 렌더에서 같은
  문장이 두 번 나왔고, 그것을 지운 자리에 카드가 말할 수 없는 것 하나만 남겼다(「도우미가 준비되면…」).
- **로그인은 추측하지 않는다.** 확인하려면 마켓플레이스를 읽어야 하고, 설정 화면이 렌더될 때마다 판매자의
  세션을 써서 배지를 칠하는 것은 이 제품이 하지 않는 일이다. 그래서 `READY`는 **「시작할 수 있습니다」**이지
  **「성공할 것입니다」가 아니다**, 무엇이 열려 있어야 하는지는 문장으로 말하고, 없으면 run이 닫고 멈춘다.
- 읽기가 **답하지 않았으면 막는다**(null ≠ 허가). 읽기가 **실패했으면 섹션을 그리지 않는다** — 전제조건을
  모르는 버튼은 버튼이 아니다.

---

## 4. auth / recovery UX

| 무엇 | 언제 보이나 | 무엇을 하라고 하나 |
|---|---|---|
| 계정 전제조건 | 누르기 **전** | 그 하나(도우미 연결 / 쿠팡 연결 확인) 또는 아무것도(바꿀 수 없는 사실) |
| 도우미 | 누르기 **전** | 카드가 소유한 한 걸음 |
| 로그인 필요 | run 중 + `수집 이력` | 「쿠팡 판매자 화면에 로그인이 되어 있지 않아… 로그인한 뒤 다시 동기화해 주세요」 |
| 스토어 불일치/미확인 | run 중 + `수집 이력` | 「…아무것도 읽지 않았습니다」 — 읽지 않았다는 사실이 먼저다 |
| 실행기 연결 실패 | run 중 + `수집 이력` | 「…잠시 뒤 다시 동기화해 주세요」 |

**아무것도 저장하지 못한 press도 durable record를 남긴다**(M6 §6). 라이브 실측: 실패한 press가
`sync_jobs` **FAILED · 저장 0 · 건너뜀 0 · 실패 0 · `STORE_UNRESOLVED`** 한 행으로 남았고, 화면은 그것을
「실패」와 판매자 문장으로 그렸다. 새 테이블·컬럼·마이그레이션 **0**.

### 4-A. 이 sitting이 찾은 결함 — 우리 것을 판매자 탓으로 말하고 있었다

라이브 첫 press는 마켓플레이스에 닿았고 **스토어 라벨을 성공적으로 읽었다**
(`observedCount 1 · labelHits 2` — 판매자는 로그인돼 있었고 목록도 열려 있었다). 그런데도 멈췄다:

```
aw_coupang_review_aside_identity  verdict=UNRESOLVED  reason=NO_EXPECTATION
```

`NO_EXPECTATION`은 **화면이 틀렸다는 뜻이 아니라 대조할 기대값이 우리에게 없다는 뜻**이다. 기대값은
credential에 봉인된 `vendor_id`의 fingerprint이고, vault를 열 수 없으면 null이다. 그리고 판매자가 받은
문장은 —

> ⚠ 어느 판매자 계정인지 확인하지 못했어요 · 안전을 위해 리뷰를 가져오지 않고 멈췄어요.
> **판매자 화면이 정상적으로 열려 있는지 확인한 뒤 '다시 시도'를 눌러 주세요.**

— **멀쩡한 창을 고치라고 보낸다.** 그리고 이것은 **누르기 전에, 마켓플레이스 접촉 0으로 알 수 있었다.**

⇒ `ScreenReadReadiness.STORE_IDENTITY_UNKNOWN`. `resolve()`가 쓰던 vault 읽기를 메서드 하나로 뽑아
readiness가 **존재 여부만** 묻고, 화면은 「이 계정의 쿠팡 연결 정보를 확인할 수 없어, 화면에 열린 스토어가
이 계정의 것인지 대조할 수 없습니다」 + 「쿠팡 연결 확인하기」로 **연결을 가리킨다**. run 중 문구는
그대로 둔다 — 실제로 다른 스토어가 열려 있는 경우에는 그 문장이 옳다.

---

## 5. Live E2E — `LIVE PASS`

승인 `apr-cp-aside-prod-3d2d22` / run `wt-5a58af5f` (선행 `apr-cp-aside-prod-1dd307`은 코드·환경이
바뀌어 **REVOKED**, 계약대로 재-bootstrap).

```
도우미 연결 → 이 기기 연결 → linked/verified OK → 도우미 「연결됨」 → 지금 동기화 활성
  → ONE PRESS 17:39:45Z
  → provider ASIDE · target/binding resolved
  → aside read: verdict MATCH · readReason OK · rows 10 · rolesResolved 5 · excludedColumns 1
                pager 1/3 · textless 10 · llmCalls 0 · 3,532ms
  → walk: fresh 9 · known 1 · PAGE_LIMIT_REACHED · pages 1 · collected 9
  → handoff: received 9 · stored 1 · skipped 8 · failed 0
  → carrier released (SETTLED_SURFACE_CLOSED)
```

- **Coupang REAL 리뷰 68 → 69.**
- **새 행은 stamped다**(`acquisition_sync_job_id` 존재, `data_origin REAL`, ★5, 수신 2026-09-13) —
  `coupang_aside_operator_run_lane_v1.md` §6.1이 `OUTSTANDING_NON_BLOCKING_EVIDENCE`로 남긴
  **「마켓플레이스에서 온 신규 행이 고쳐진 stamp 경로를 지난다」가 이 run으로 닫혔다**. 만들어 낸 조건이
  아니라 자연 발생한 신규 리뷰 1건이다(필터 조작 0 · pagination 0 · 행 삭제 0).
- `sync_jobs`: `PARTIAL · SELLER_CENTER_READ · ACTION_WINDOW · 1/8/0 · PAGE_LIMIT_REACHED`.
- Core: `/api/reviews/recent` 최상단이 그 리뷰. Home 최근 수집 상태
  `lastSuccessfulSyncAt 2026-09-13T17:39:52Z`.
- 판매자 화면 수집 이력: 「화면에서 실행 · 리뷰 · 일부 성공 · 저장 1 · 건너뜀 8 · 실패 0 · 2분 전」 +
  「읽지 못하고 남은 리뷰가 있다는 신호는 이번 수집에서 없었습니다.」
- **마켓플레이스 클릭 0 · 키 입력 0 · 다운로드 0 · WRITE 0 · pagination 0 · 실행 LLM 0.**
- 3폭(1440/1366/1152) 가로 스크롤 0 · off-host 요청 0 · 내부 낱말 노출 0.

### 5-A. 첫 grant에서 일어난 일 (숨기지 않고 적는다)

첫 승인(`apr-cp-aside-prod-1dd307`)에서 읽힌 행은 **0**이고 identity 관측은 **3회**였다 — 매니페스트가
상정한 1회보다 많다. 원인은 harness: 내가 recheck를 세 번 눌렀고, 각 press가 identity를 다시 관측했다.
두 번째 매니페스트는 그래서 `identity observations ≤ 2`를 명시하고 실제로 **1회**만 썼다.

같은 sitting에서 harness 결함 둘도 있었다 — 정지 조건 regex가 화면의 **고정 안내문**(「…로그인한 뒤…」)에
걸려 3초 만에 브라우저를 닫았고(그래서 carrier가 붙자마자 떨어졌다), 다음 시도는 그 carrier가 잡혀 있어
attach되지 않았다. 제품 코드가 아니라 관측 도구의 문제이고, 둘 다 그 자리에서 고쳤다.

---

## 6. durable observability

새 표·컬럼·플랫폼 **0**. 전부 이미 있던 자리다.

| 사실 | 어디에 | 판매자에게 |
|---|---|---|
| 시작됨 / 어떤 executor | helper 로그(`aw_coupang_review_acquisition_execution_provider`) | 안 보임(결정) |
| 무엇을 읽었나 | helper 로그(`aw_coupang_review_aside_read`) | 안 보임 |
| 무엇이 저장됐나 | `sync_jobs` 3 counts | 저장/건너뜀/실패 |
| 남은 리뷰가 있나 | `ReviewCoverageSignal`(행의 순수 함수) | 한 문장 |
| 왜 아무것도 저장 못 했나 | `sync_jobs.error_message`, 닫힌 7단어 | 판매자 문장 |
| 언제 마지막으로 성공했나 | `ChannelCoverageRow` | 채널 연결 · Home |

---

## 7. 실제 pilot seller에게 요구되는 설치 단계

1. reviewnary 도우미 설치 (`/connect/helper`의 안내 — 이번 패키지 무변경)
2. 채널 화면에서 **도우미 연결**(브라우저 ↔ 도우미, OS 승인 1회)
3. **이 기기 연결**(도우미 ↔ 계정, 비밀번호 없음 — 버튼 한 번)
4. 쿠팡 판매자 페이지 로그인 + 상품평 목록 열기 (판매자 자신의 마켓플레이스 동작)
5. **지금 동기화**

**그리고 오늘은 6번이 더 필요하다 — 그것이 남은 가장 큰 gap이다**(§8-1).

---

## 8. 남은 productization gap

1. **BYO는 아직 판매자가 켤 수 없다.** `REVIEWNARY_EXECUTION_PROVIDER`가 이제 `helper.env`의 선언된
   키라 **설치된 도우미가 읽을 수 있게** 됐지만, 그 파일을 편집하는 것은 여전히 사람이 파일을 고치는
   일이고 설치 프로그램은 이 키를 쓰지 않는다. 제품 안에 스위치가 없다(그것을 만드는 것은 §5가 숨기기로
   한 이름을 화면에 올리는 일이라 **product-owner 결정**). **이번 sitting의 라이브는 작업트리 helper를
   프로세스 env로 띄워 증명했다 — 재빌드한 패키지 도우미로는 증명되지 않았다.**
2. **device-link 카드가 `linking: pending`에서 멈춘다.** start는 성공하고 approve가 실패하면 카드는
   영원히 폴링하고 판매자에게는 끝낼 컨트롤도 취소할 컨트롤도 없다. 이 패키지 이전부터 있던 결함이고,
   고치지 않았다.
3. **pagination/backlog 없음** — 1페이지, 1회. `BACKLOG_POSSIBLE`이 그것을 말한다.
4. **바인딩을 못 푼 실패는 기록할 수 없다**(M6 §6) — 계정 슬롯 자체가 못 풀린 것이므로 어느 계정의
   이력에 넣을지 말할 수 없다.
5. **run 중 store 문구는 화면을 가리킨다** — `NO_EXPECTATION`은 readiness가 먼저 잡지만, 실제
   `DIFFERENT_STORE`가 아닌 다른 UNRESOLVED 사유에서는 여전히 「판매자 화면이…」로 읽힌다.
6. **스케줄/무인 실행 없음**(Q-1, 승인 밖) · **Coupang reply/write 없음**(채널에 기능이 없다).
7. `collector/test/action-window/reply-submission/reply-session.test.ts`의 타입 오류 1건은 **이 패키지
   이전부터 있던 것**이고 건드리지 않았다(vitest는 통과).

---

## 9. PRODUCT_DECISION_NEEDED

1. **판매자가 BYO를 켜는 방법.** 제품 안의 스위치 = 화면에 execution 개념을 올리는 일(§5 결정과 충돌) ·
   설치 프로그램이 `helper.env`에 쓰기 = 설치 시 한 번 묻기 · 운영자만 = 파일럿 한정. 셋 다 다른 제품이다.
2. **재빌드한 패키지 도우미로 BYO 라이브를 한 번 더 증명할 것인가** — 오늘의 증명은 개발 체크아웃
   도우미다.
3. **`linking: pending` 복구 컨트롤**(취소/다시 시도)을 이 lane에 붙일 것인가.

---

# Closeout (2026-09-14)

세 결정을 반영하고 `PARTIAL` → **`DONE`**으로 닫는다. Aside 기능 확장 **0** — scheduler/unattended ·
auto login/MFA/CAPTCHA · pagination · marketplace write/reply · NAVER · 새 execution provider 추상화 전부
손대지 않았다. 마이그레이션 **0** · backend 소스 **무변경**.

## C-1. execution provider는 일반 seller UI에 노출하지 않는다 (product-owner decision)

- `ASIDE` · `LOCAL_HELPER` 같은 기술명은 seller UI **금지 유지**(`execution_strategy_v1.md` §5).
- 파일럿에서 BYO browser runtime 설정은 **operator-assisted provisioning**으로 허용한다 — §C-3의 두 줄.
- 장기 방향은 installer/setup이 「브라우저 수집 사용」 **opt-in**을 받아 내부 runtime config를 쓰는 것이고,
  **self-service installer 전체 구현은 지금 하지 않는다.**
- 그래서 이 closeout은 스위치를 화면에 만들지 않았다. 만든 것은 그 스위치가 **존재할 수 있는 자리**뿐이다.

## C-2. packaged vs checkout helper — 실제로 다른 것 둘

| | checkout helper | packaged helper |
|---|---|---|
| 기동 | `npx tsx src/cli/local-agent.ts --bridge-only` | launchd user agent, `app/bin/node app/helper.mjs --bridge-only` |
| 승인 대화상자 | `dev_tty_stderr`(+`--dev-insecure-auto-approve`) | **`macos_native`** — 판매자가 실제로 [허용]을 누른다 |
| 설정 | 프로세스 env | `service.env`(launchd가 주입) + **`helper.env`**(도우미가 스스로 읽는 닫힌 키 목록) |
| provider 선택 | env 한 줄 | `helper.env`의 선언된 키 — **v1에서 추가** |
| **`aside` 실행 파일** | 개발자 셸의 PATH에 있다 | **PATH에 없다** |

**두 번째가 이번 closeout이 찾은 것이다.** launchd agent는 「PATH를 거의 물려받지 않는다」 — 이 저장소가
node 바이너리를 절대경로로 두는 이유로 자기 코드에 적어 둔 사실이다. `ASIDE_CLI`는 오래전부터 있었지만
`HELPER_ENV_KEYS`에 없었으므로, 설치된 도우미는 provider를 `ASIDE`로 고를 수는 있어도 **아무것도 실행할 수
없었다**. 그래서 키를 하나 더 선언했다(경로이지 비밀이 아니다). `ASIDE_ACCOUNT`는 **추가하지 않았다** —
이 파일럿에서 필요해진 적이 없고, 쓰이지 않는 키를 미리 여는 것은 설정 표면을 넓히는 일이다.

**실측 before/after**(설치된 도우미 자신의 로그):
`reviewAcquisitionProvider: LOCAL_HELPER` → **`ASIDE`**, `approvalPresenter: macos_native`.

## C-3. pilot provisioning steps (operator-assisted)

1. `tools/helper/build-macos.sh` — 사이트 URL을 `REVIEWNARY_APP_URL`/`REVIEWNARY_BASE_URL`로 굽는다.
2. 판매자 Mac에서 **`reviewnary 도우미 설치.command`** 더블클릭(앱·브라우저 교체, 상태 보존).
3. **운영자가** `<helper home>/helper.env`에 두 줄:
   ```
   REVIEWNARY_EXECUTION_PROVIDER=ASIDE
   ASIDE_CLI=<aside 실행 파일 절대경로>
   ```
   `chmod 600`, 그리고 `launchctl stop/start ai.sellerops.local-agent`.
4. 판매자: **도우미 연결**(native [허용]) → **이 기기 연결** → 쿠팡 로그인 + 상품평 목록 → **지금 동기화**.

3번이 self-service가 아니라는 것이 §C-1이 명시적으로 허용한 상태이고, §9-1이 올린 결정의 대상이다.

## C-4. pairing recovery — `linking: pending` wedge

**결함.** 도우미는 grant를 발급한 순간부터 만료까지 `linking: "pending"`을 보고한다 — 참이고, 브라우저
쪽 절반이 성공했는지에 대해서는 아무 말도 하지 않는다. approve가 실패하면 카드는 자기 오류 낱말을 적었고
**2초 뒤 status poll이 그것을 도우미의 `pending`으로 덮었다**. 판매자는 「연결 확인 중」을 계속 읽었고
끝낼 컨트롤도 멈출 컨트롤도 없었다. 2026-09-14 라이브 관측.

**수정 — 기존 generic device-link 컴포넌트 안에서, pairing/token/security contract 변경 0.**

- 브라우저의 **자기 시도**가 별도 축이 된다(`DeviceAttempt`: `none · approving · failed · abandoned`).
  도우미가 `linked`가 **아닐 때만** 이 축이 도우미의 `pending`을 이긴다 — 어디서든 링크가 성사되면 모든
  시도가 끝난다.
- **시도가 끝나면 빠른 polling을 멈춘다.** 느린 beat는 남아, 다른 탭이나 설정에서 성사된 링크는 새로고침
  없이 여전히 카드를 초록으로 만든다.
- **[다시 시도]** — 이 브라우저가 **자기가 발급받은 userCode를 들고 있다**가 그대로 다시 승인한다. 도우미
  소스가 이미 「the browser gets the same one back only if it kept it」이라고 적어 둔 그 조건이다. 새 grant
  0 · 도우미 호출 0.
- **[연결 취소]** — 도우미의 grant를 **철회하지 않는다**(bridge에 그런 경로가 없고 이 패키지는 만들지
  않는다). 판매자가 더는 원하지 않는 일을 진행 중인 것처럼 그리는 것을 멈출 뿐이고, 남은 grant는 스스로
  만료된다.
- `busy`(다른 탭이 발급받아 이 브라우저에 코드가 없는 grant)는 **in-flight이 아니라 기다림이 있는 실패**로
  다룬다 — 승인할 수도 철회할 수도 없으므로.

**라이브**(패키지 도우미, 실제 grant, production 페이지 코드; 강제한 것은 approve 응답 403 **한 번**뿐이고
그것이 관측된 원인 그대로다): 「**연결하지 못했습니다**」 + [다시 시도] + [연결 취소] → **8초의 polling을
지나도 그대로**(옛 동작은 2초 안에 「연결 확인 중」으로 뒤집혔다) → [다시 시도] → **연결됨**.

**정직 보고**: [연결 취소]의 라이브 증명은 하지 않았다 — 취소하면 도우미의 grant가 만료될 때까지 몇 분간
재연결이 막히고, 그 상태로 운영자의 기계를 두고 싶지 않았다. 단위 테스트가 그 경로를 고정한다.
그리고 **새로고침으로 컴포넌트 상태를 잃으면** 카드는 다시 「연결 확인 중」을 보이지만 **무한은 아니다** —
도우미 자신이 grant 만료 시 `expired`를 보고하고 카드는 다시 [이 기기 연결]을 그린다(≤ grant TTL).

## C-5. Live E2E — packaged helper, `LIVE PASS`

승인 `apr-cp-aside-pkg-afaaf3` / run `wt-ead9510d`.

```
packaged install (launchd, macos_native) → helper.env 두 줄 → 재기동: provider ASIDE
  → 도우미 연결(판매자가 native [허용]) → 이 기기 연결 → device_link_result outcome=linked
  → 도우미 「연결됨」 → readiness READY → ONE PRESS 04:49:14Z
  → provider ASIDE · target/binding resolved
  → aside read: verdict MATCH · readReason OK · rows 10 · rolesResolved 5 · pager 1/3 · llmCalls 0 · 4,523ms
  → walk: fresh 9 · known 1 · PAGE_LIMIT_REACHED · pages 1
  → handoff: received 9 · stored 0 · skipped 9 · failed 0
  → sync_jobs PARTIAL 0/9/0 · Home lastSuccessfulSyncAt 04:49:23Z
```

- **COUPANG REAL 69 → 69.** 아침 run 이후 새 리뷰가 없었고 **9행 전부 dedup으로 걸러졌다** — 같은
  ingestion spine이 패키지 경로에서도 idempotent임을 보인 것이고, 만들어 낸 조건이 아니다.
- device link는 **이 run에서 새로 맺혔다**(양쪽 기존 링크를 먼저 revoke해 링크 단계가 증명에 포함되도록 했다).
- **마켓플레이스 클릭 0 · 키 입력 0 · 다운로드 0 · WRITE 0 · pagination 0 · 실행 LLM 0.** off-host 0.

## C-6. Aside Acquisition Productization v1 — **DONE**

| 완료 판정 | 상태 |
|---|---|
| packaged helper 기준 seller-facing acquisition E2E | **PASS** (§C-5) |
| failed pairing self-recovery | **PASS** (§C-4, 취소 경로는 테스트) |

## C-7. 실제 seller pilot 전에 남은 gap

1. **provisioning 3단계가 사람 손이다**(§C-3). 판매자가 켜는 방법은 없고, 그것이 §C-1의 장기 방향이다.
2. **패키지가 서명·공증되지 않았다** — 판매자 Mac에서 Gatekeeper를 지나야 하고, 그 절차는 운영자 동반이다.
3. **`연결 취소` 라이브 미관측** · **새로고침 후에는 grant TTL까지 「연결 확인 중」**(무한은 아님).
4. **pagination/backlog 없음** · **바인딩 미해결 실패는 기록 불가** · **스케줄/무인 없음** — v1 그대로.
5. **호스트가 없다** — 고정 공인 IPv4 + 공개 HTTPS(`pilot_runtime_foundation_v1.md` §10). 이번 증명은
   `localhost` 사이트로 구운 패키지다.
6. `collector/test/action-window/reply-submission/reply-session.test.ts` 타입 오류 1건은 **선행 결함**.

## C-8. PRODUCT_DECISION_NEEDED

1. **installer opt-in의 모양** — 「브라우저 수집 사용」 체크 하나가 `helper.env`를 쓰게 할 것인가, 그리고
   그 체크박스가 execution 개념을 화면에 올리지 않고 무엇이라고 불릴 것인가.
2. **패키지 서명/공증** — 파일럿을 운영자 동반으로 갈 것인가, 배포 채널을 만들 것인가.
3. **`ASIDE_ACCOUNT`** — Aside가 여러 계정을 들 때 필요해지면 그때 키를 열 것인가(지금은 열지 않았다).
