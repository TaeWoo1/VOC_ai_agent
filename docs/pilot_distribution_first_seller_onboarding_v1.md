# Pilot Distribution & First Seller Onboarding v1

2026-09-14. 실제 pilot seller Mac에서 **설치 → 연결 → Coupang authenticated acquisition → Reviewnary Core**를
운영자가 따라 할 수 있는 **재현 가능한 절차**로 만든다.

Aside Acquisition Productization v1은 **DONE으로 freeze**. 이 패키지는 기능이 아니라 **배포·절차·진단**이다 —
새 seller UI **0** · scheduler/unattended **0** · auto-login/MFA/CAPTCHA **0** · pagination **0** ·
marketplace write **0** · 새 telemetry 플랫폼 **0** · 마이그레이션 **0** · backend 소스 **무변경**.

---

## 1. Packaging audit — 무엇이 구워지고, 무엇이 구워지면 안 되는가

### 1-1. localhost가 구워지는 자리는 **하나**다

`tools/helper/build-macos.sh`가 `REVIEWNARY_APP_URL` / `REVIEWNARY_BASE_URL`을 읽어 **`BUILD.txt`**에
적고, `설치.command`가 그것을 읽어 `service.env`에 쓰고, launchd plist가 그 값을 프로세스에 준다.
기본값은 개발용(`http://localhost:5173` / `http://127.0.0.1:8080`)이다.

**재현 가능성 실측** — 같은 스크립트에 두 변수만 주고 다시 빌드:

```
app_url=https://pilot.example.invalid
base_url=https://pilot.example.invalid
```

코드 안에도 같은 기본값이 **fallback으로** 남아 있지만(`loadConfig`), plist가 언제나 값을 주므로 설치된
도우미에서는 도달하지 않는다.

### 1-2. 고친 것 — **개발용 패키지가 판매자 Mac에 조용히 설치되던 것**

`설치.command`는 `BUILD.txt`가 없거나 비면 **localhost로 조용히 폴백**했다. 그렇게 설치된 도우미는 없는
백엔드에 말을 걸고, 판매자가 보는 것은 「서버 연결 확인 필요」 한 줄뿐이며 **원인이 화면에 없다** —
build 스크립트가 자기 주석에 경고로 적어 둔 바로 그 증상이다. 이제 **거절한다**:

> 이 설치 파일은 개발용입니다 (내 컴퓨터 주소로 만들어졌습니다). 담당자에게 파일럿용 설치 파일을 받아 주세요.

개발자 설치는 `REVIEWNARY_ALLOW_LOCAL_INSTALL=1`로 **소리 내어** 한다. 실측: dev 스탬프 → 거절,
파일럿 스탬프 → 통과.

그리고 `build-macos.sh`는 `node_modules` 없는 체크아웃에서 **자기 안내문 두 줄 전에** raw
`MODULE_NOT_FOUND` 스택으로 죽었다 — 의존성 검사를 그것을 읽는 줄보다 **앞으로** 옮겼다.

### 1-3. dev-only 경로는 패키지에서 **도달 불가**

| dev 장치 | 패키지에서 | 무엇이 막나 |
|---|---|---|
| `--dev-insecure-auto-approve` | **도달 불가** | `설치.command`가 넘기지 않고(plist args = `--bridge-only`), 넘겨도 `env.NODE_ENV !== "production"` 게이트 |
| `REVIEWNARY_HELPER_VERSION_OVERRIDE` | **도달 불가** | 같은 production 게이트 — 설치된 도우미는 자기 버전에 대해 거짓말할 수 없다 |
| email/password 로그인 | **도달 불가** | `helper-session.ts:109`의 같은 게이트. 자격은 device token뿐 |

`NODE_ENV=production`은 service planner가 **고정**하고 호출자가 덮어쓰려 하면 **거절**한다
(`RESERVED_ENV_KEYS`). 실측 plist에 `NODE_ENV=production` 존재, args는 `--bridge-only` 하나.

### 1-4. 패키지에 secret **없음**

패키지 전수 스캔(값 미출력, 개수만): `rvh_` 토큰 0 · private key 0 · AWS/OpenAI 키 모양 0 ·
`password=` 0. 상태 파일(`.auth` · `helper.env` · `service.env` · `.profile` · `.connections` ·
`.status` · `downloads`) **전부 부재**.

유일한 hit 둘은 **키 이름과 개발용 기본 리터럴**(`env.SELLEROPS_PASSWORD ?? "demo1234"`)이다 —
저장소에 공개된 데모 계정 값이고, §1-3의 production 게이트로 **설치된 도우미에서는 읽히지 않는다**.
비밀이 아니지만 **구워져 있다는 사실은 기록**해 둔다.

---

## 2. Operator provisioning — seller UI는 건드리지 않는다

판매자는 execution provider를 고르지 않고 이름도 보지 않는다(`execution_strategy_v1.md` §5, 그리고
이번 파일럿 결정). 브라우저 수집은 **그들을 위해 provision된다**.

```
tools/helper/browser-collection.sh on   [--aside-cli /abs/path/to/aside]
tools/helper/browser-collection.sh off      # LOCAL_HELPER로 롤백
tools/helper/browser-collection.sh show
```

- `helper.env`의 **선언된 키 두 개**(`REVIEWNARY_EXECUTION_PROVIDER` · `ASIDE_CLI`)만 쓰고 `chmod 600`,
  그리고 launchd 재기동. 운영자가 넣어 둔 다른 줄은 **보존**한다.
- **절대경로를 요구한다.** launchd agent는 PATH를 거의 물려받지 않으므로 `aside` 같은 이름은 이 셸에서만
  풀리고 도우미에서는 풀리지 않는다 — 타이핑한 곳에서만 되는 설정을 쓰느니 거절한다.
- `off`는 다른 provider를 쓰지 않고 **두 키를 지운다**. 기본값(LOCAL_HELPER)이 한 곳에서 답한다.
- **credential을 쓸 수 없다**: `helper.env`의 키 목록이 닫혀 있고 plist planner는 secret-ish 키를 거절한다.
- 이 스크립트는 **패키지에 들어가지 않는다**(`tools/`). 판매자가 실행할 수 있는 물건이 아니다.

**실측 왕복**: `on` → 도우미 boot line `ASIDE` · `off` → `LOCAL_HELPER` · `on` → `ASIDE`.
bare name 거절 확인.

---

## 3. Install / onboarding runbook

### 운영자가 하는 것

| # | 단계 | 확인 |
|---|---|---|
| O-1 | 파일럿 사이트로 빌드: `REVIEWNARY_APP_URL=https://<host> REVIEWNARY_BASE_URL=https://<host> tools/helper/build-macos.sh` | `BUILD.txt`의 두 URL |
| O-2 | 배포 프론트가 **도우미 브리지 허용**으로 빌드됐는지: `PILOT_GUIDED_HELPER_ENABLED=true` + `PILOT_HELPER_BRIDGE_URL`(loopback) | `deploy/pilot/smoke.sh`가 서빙된 CSP를 검사 |
| O-3 | 판매자 Mac에 폴더 전달(616MB — Chromium 포함) | arch 일치(`arm64`/`x86_64`) |
| O-4 | 설치 후 **browser collection provisioning**: `browser-collection.sh on --aside-cli /abs/path` | 출력의 `browserCollection: CONFIGURED` |
| O-5 | 막히면 진단 한 줄 요청(§4) | — |

### 판매자가 하는 것

| # | 단계 | 막혔을 때 |
|---|---|---|
| S-1 | **`reviewnary 도우미 설치.command`** 더블클릭 | Gatekeeper: 「확인되지 않은 개발자」 → 우클릭 → **열기** → 열기. (서명·공증 없음 — 이번 파일럿은 운영자 동반) |
| S-2 | 열린 `/connect`에서 로그인 | — |
| S-3 | **[도우미 연결]** → 이 Mac에 뜨는 창에서 **[허용]** | 「설치 필요」가 남으면 §4 |
| S-4 | **[이 기기 연결]** | 실패 시 **[다시 시도]** / **[연결 취소]**(v1 Closeout §C-4) |
| S-5 | 쿠팡 판매자 페이지 로그인 + **상품평 목록** 열기 | — |
| S-6 | 채널 화면 「상품평 가져오기」의 **[지금 동기화]** 한 번 | 아래 복구표 |
| S-7 | 수집 이력 · 홈에서 결과 확인 | — |

### 실패 복구 — 판매자가 읽는 문장 그대로

| 무엇 | 어디 | 다음 걸음 |
|---|---|---|
| 도우미 미설치/미실행 | 도우미 카드 | 설치 안내 / 다시 찾기 |
| 기기 연결 실패 | 도우미 카드 | **다시 시도**(이 브라우저가 든 코드 재승인) / **연결 취소** |
| 계정 전제조건 | 가져오기 섹션 | 도우미 연결하기 / 쿠팡 연결 확인하기 |
| 로그인 필요 | run 중 + 수집 이력 | 「쿠팡 판매자 화면에 로그인이 되어 있지 않아…」 |
| 스토어 불일치/미확인 | run 중 + 수집 이력 | 「…아무것도 읽지 않았습니다」 |
| 아무것도 저장 못 함 | **수집 이력에 FAILED 한 행** | 닫힌 7단어 → 판매자 문장 |

---

## 4. Pilot diagnostics — 이미 있던 것과, 한 줄 보탠 것

**있던 것**: 도우미 카드 6단어 + 다음 걸음 · 수집 이력(상태 · 저장/건너뜀/실패 · coverage 문장 · 실패 문장) ·
`/bridge/health`(버전) · `BUILD.txt` · `.status/local-agent-service.{out,err}.log`.

**없던 것**: 막힌 파일럿을 설명하는 사실 **둘** — 이 도우미가 **어느 사이트**를 보는가, **브라우저 수집이
설정돼 있는가**. 둘 다 이 Mac에서 이미 world-readable(plist, `helper.env`)인데 운영자가 판매자에게 파일을
열게 해야 알 수 있었고, 둘 다 「서버 연결 확인 필요」나 「지금 동기화가 활성화되지 않음」으로 **같아 보인다**.

⇒ **새 플랫폼 0 · 새 엔드포인트 0**, 기존 `service.mjs status` 한 줄에 네 필드:

```json
{"loaded":true,"healthy":true,"agentVersion":"0.2.0","protocolVersion":1,
 "appUrl":"…","baseUrl":"…","browserCollection":"CONFIGURED|NOT_CONFIGURED","executorPathSet":true}
```

비밀·개인정보·마켓플레이스 데이터 **0**: 사이트는 공개 URL, 수집 모드는 닫힌 토큰, 실행기 경로는
**있다/없다**만(경로 자체는 싣지 않는다). 운영자가 판매자에게 요청하는 것은 **이 한 줄**이다.

---

## 5. Real host dependency — Coupang Aside가 실제로 요구하는 것

**세 채널의 호스트 요건은 서로 다르고, 섞으면 필요 없는 blocker가 생긴다.**

| | 요구 | Coupang Aside 리뷰 취득에 필요한가 |
|---|---|---|
| **공개 HTTPS Reviewnary origin** | 판매자 브라우저가 앱에 닿고, 도우미가 backend에 닿는다 | **필요** |
| Cafe24 OAuth callback (byte-identical HTTPS) | Cafe24 연결 | **불필요** |
| **고정 outbound IPv4** | NAVER 커머스 · Coupang OpenAPI가 호출 IP를 등록받는다 | **불필요** |

**왜 고정 IP가 아닌가.** 이 lane에서 마켓플레이스로 나가는 트래픽은 **판매자 Mac의 브라우저**가 낸다.
우리 호스트는 Coupang에 아무 요청도 하지 않는다. 취득의 게이트를 코드에서 읽으면 넷이고 그중 어느 것도
Coupang API 호출이 아니다 — 채널이 COUPANG일 것 · 파일 업로드 계정이 아닐 것 · session slot이 있을 것 ·
credential에 `vendor_id`가 있을 것. `vendor_id`는 **판매자가 폼에 입력하는 값**이고(`CredentialTemplates`),
session slot은 읽기 한 번으로 **지연 생성**된다.

**정직하게 적는 미검증 지점**: 그래서 *원리적으로는* Coupang OpenAPI 연결이 없어도 이 lane이 서야 하지만,
**증명된 적은 없다** — 지금까지의 모든 라이브는 `CONNECTED` 계정(즉 OpenAPI 테스트를 통과한 계정)에서
돌았다. 계정은 OpenAPI sync가 성공해야 `PENDING → PREPARING → CONNECTED`로 가므로, 고정 IP가 없는
파일럿의 계정은 **`PENDING`에 머문 채** 이 lane을 쓰게 된다. 그 형상은 §8-3의 결정/검증 항목이다.

**또 하나의 호스트 요건**: 배포 프론트는 **도우미 브리지를 허용하도록 빌드**돼야 한다
(`PILOT_GUIDED_HELPER_ENABLED=true` → `VITE_ENABLE_AGENT_BRIDGE` → CSP `connect-src`에 loopback origin).
켜지 않으면 브라우저가 도우미 호출을 **CSP로 차단**하고, 판매자에게는 「설치 필요」가 영원히 보인다.
`deploy/pilot/smoke.sh`가 서빙된 번들의 CSP를 실제로 검사한다.

---

## 6. First seller acceptance checklist

| # | 항목 | 어떻게 확인 |
|---|---|---|
| 1 | helper installed | `service.mjs status` → `loaded:true healthy:true`, `appUrl`이 파일럿 호스트 |
| 2 | paired | 도우미 카드 「연결됨」 (native [허용] 뒤) |
| 3 | browser collection enabled | `status` → `browserCollection: CONFIGURED` · `executorPathSet: true` |
| 4 | authenticated marketplace | 판매자가 WING 로그인 + 상품평 목록 |
| 5 | one explicit sync | [지금 동기화] **1회** — 한 번 누름 = 한 run |
| 6 | identity MATCH | 헬퍼 로그 `aw_coupang_review_aside_read … verdict:"MATCH"` |
| 7 | sync_jobs durable result | 수집 이력에 행 하나(성공/일부/실패 + coverage 문장) |
| 8 | review appears in Core/Home | `/api/reviews/recent` 최상단 · 홈 최근 수집 상태 갱신 |
| 9 | retry/dedup | 두 번째 press → `stored 0 · skipped N`, 리뷰 수 불변 |
| 10 | failure recovery | 로그아웃 상태로 1회 → `LOGIN_REQUIRED` 문장 + 수집 이력 FAILED 행 |

1·3·6·7·8·9는 2026-09-14 패키지 도우미 라이브에서 이미 관측됐다
(`aside_acquisition_productization_v1.md` Closeout §C-5). 10은 **파일럿에서 처음 관측될 항목**이다.

---

## 7. READY_FOR_FIRST_EXTERNAL_SELLER — **NO**

절차와 패키지는 준비됐다. 막는 것은 **하나이고 코드가 아니다**.

| | 상태 |
|---|---|
| 재현 가능한 production-target 빌드 | **READY** (§1-1) |
| 개발용 패키지 오배포 방지 | **READY** (§1-2) |
| dev 경로 패키지 미포함 | **READY** (§1-3) |
| 패키지 secret 없음 | **READY** (§1-4) |
| operator provisioning + rollback | **READY** (§2) |
| 설치/온보딩 runbook | **READY** (§3) |
| 진단 | **READY** (§4) |
| **공개 HTTPS Reviewnary 호스트** | **BLOCKER — 없다** |
| 서명/공증 | 이번 파일럿 blocker 아님(운영자 동반, §3 S-1) |

**실제 blocker는 호스트 하나다.** 도메인과 배포 대상이 정해지기 전에는 파일럿용 패키지를 구울 수 없고
(§1-1의 두 변수가 바로 그 값이다), 판매자 브라우저가 닿을 origin도 없다.
`pilot_runtime_foundation_v1.md` §10 · `pilot_host_provisioning_v1.md`가 그 topology를 이미 적어 두었다 —
**이 패키지는 그 문서들을 다시 쓰지 않는다.**

---

## 8. PRODUCT_DECISION_NEEDED

1. **공개 HTTPS Reviewnary 호스트** — 도메인과 배포 대상. 이 값 없이는 §1-1의 빌드도 §3의 배포도 진행할 수
   없다. (고정 outbound IPv4는 **이 lane의 전제가 아니다** — §5.)
2. **Coupang OpenAPI 연결을 첫 파일럿의 전제로 둘 것인가.** 리뷰 취득은 코드상 요구하지 않지만 그 형상은
   미검증이고, 요구하지 않기로 하면 계정이 `PENDING`에 머문 채 운영되는 화면 문구를 따로 봐야 한다.
3. **패키지 전달 방법** — 616MB 폴더를 어떻게 건네고 arch(arm64/x86_64)를 어떻게 고르는가.
