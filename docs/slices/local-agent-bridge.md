# Slice Contract — Local Agent Bridge (Guided-Connection 인프라 G1)

> Status: **APPROVED FOR IMPLEMENTATION — 2026-07-08 (제품 오너 결정 반영, §0).** 이 문서는 프론트↔로컬
> 에이전트 **안전 브리지**의 G1 실행 계약이다. §0의 승인된 결정이 §5·§6·§9·§15의 이전 "PO 결정 대기"
> 항목을 대체한다. 커밋은 별도 지시로만.
> 상위 계약: 제품 원칙 `docs/product-scope-v1.md` §1.2·§6.1, 프론트 화면 `docs/sellerops_frontend_spec.md`
> §16.7·§17-B G1, 런타임 경계 `docs/sellerops_local_agent_runtime_adr.md`(Runtime ADR) §3.4·§7,
> 커넥터 레벨 규칙 `docs/multi-channel-connector-roadmap.md` §11. 본 문서는 그들이 참조하는
> **브리지(전송·페어링·이벤트) 계약**을 소유하며 그들의 결정을 중복 선언하지 않는다.
>
> **정직성 경계.** 프론트↔에이전트 통신 채널은 이 G1 슬라이스로 **처음 구축**된다(그 전에는 부재 —
> Runtime ADR §1·§3.4, 정찰 §3). 자동 로그인·Device Vault·Windows·클라우드는 이 슬라이스 범위 밖이며(§4)
> 여전히 미구현이다. Browser Projection(G2)은 **이후 채널-중립 V0로 구현·커밋**됐고(`a0e4f6f`, 마켓 미승인·
> 비-기본 렌더러·production-runtime 미배선 State B — `docs/slices/browser-projection-v0.md`) **이 G1
> 슬라이스 범위 밖**이다. **G1 자체는 페어링·관측(observability) 전용**이며 마켓 워크플로/브라우저 제어
> 명령을 포함하지 않는다(§0.5).

베이스라인: Product Shell 커밋 `3006e447b91de72f5e3627da75f390c74d92bfac` (커밋됨). 이 슬라이스는
Product Shell(§17-A)과 **분리된 트랙**(§17-B)이며 프론트 IA 재편에 의존하지 않는다.

---

## 0. 승인된 결정 (Approved decisions, 2026-07-08)

제품 오너 리뷰 결과. 아래가 이후 절의 "PO 결정 대기" 표기를 **대체**한다.

### 0.1 전송 (§6 대체)
- **WebSocket이 1차 장기 전송**이다. HTTP는 **최소 health·페어링 부트스트랩·좁게 필요한 요청/응답**에만 쓴다.
- **자동 SSE 폴백을 구현하지 않는다.** WS 경로가 막히면 폴백으로 조용히 전환하지 말고 **멈추고 증거와
  함께 보고**한다(§Phase B 게이트).
- 루프백 WebSocket 설계에 의존하기 **전에**, HTTPS 프론트 컨텍스트에서의 **no-marketplace Chrome 호환성
  스파이크**를 수행한다(결과는 §6.1에 기록).
- 제품 UX는 **Chrome Local Network Access(LNA) 권한**을 고려해야 한다(프론트 상태 §7에 반영).

### 0.2 페어링 (§5·§7 대체)
- 페어링은 **SellerOps에서 개시**하고, **로컬 에이전트 소유의 로컬 확인 페이지**에서 명시적으로 확인한다.
- 페어링은 **리보크 전까지 유효**하다(만료 없음; 티켓은 별개 — 아래 0.4).
- 페어링은 **SellerOps와 로컬 에이전트 양쪽에서** 리보크할 수 있다.

### 0.2.1 승인 계약 — out-of-band 승인 비밀 (2026-07-15)

**문제.** 확인 페이지의 **Origin 검사만으로는 승인을 보호하지 못한다.** `Origin`은 비-브라우저
로컬 프로세스가 자유롭게 위조할 수 있고(`/bridge/pair/confirm`은 Origin 부재도 통과),
`requestId`·`confirmationCode`는 **둘 다 `POST /bridge/pair/request` 응답으로 요청자에게 반환**된다.
즉 위협 모델상의 공격자(로컬 프로세스)가 확인 엔드포인트가 검사하던 값을 모두 쥔다 →
**사람 없이 스스로 페어링 가능**했다.

**계약.**
- 요청마다 **out-of-band 승인 비밀**(8 hex = 32비트)을 발급한다. 이 값은
  **HTTP 응답에 실리지 않고 · 확인 페이지에 렌더링되지 않고 · 영속화되지 않고 · `log()`를 타지 않는다.**
  (확인 페이지는 공개된 `requestId`만 알면 누구나 가져갈 수 있으므로 여기에 코드를 넣으면 계약이 무너진다.)
- 비밀은 **`ApprovalPresenter` 포트로만** 사람에게 전달된다. 사람이 확인 페이지에 **직접 입력**한다.
- `allow`는 이 비밀을 요구한다. `deny`는 요구하지 않는다(거부는 신뢰를 부여하지 않으므로 fail-closed).
- `confirmationCode`는 **인증자가 아니다.** 요청자에게 반환되므로 공격자가 아는 값이며,
  "내가 낸 요청이 맞나"를 눈으로 대조하는 용도로만 남는다. 승인 비밀과 **별개 값**이다.
- **시도 5회**(오답) 후 요청을 **소각(burn)**한다 — 이후 정답 코드도 실패한다. 짧은 코드의
  무차별 대입을 막는 것은 길이가 아니라 이 시도 상한이다(5분 요청 TTL 내 ~5/2^32).
- 비교는 **양쪽을 SHA-256 해시한 뒤 constant-time** 비교한다(공격자 입력이
  `Buffer.from(x,"hex")`의 무음 절단에 닿지 않게, 길이 차이가 새지 않게).
- **거부(declined)는 표현 가능해야 한다.** presenter의 UI에 거부 수단이 있으면 `{status:"declined"}`로
  매핑하고, 브리지는 요청을 **즉시 폐기**한 뒤 `403 approval_declined`로 응답한다 —
  `503 approval_unavailable`(사람 채널 자체가 없음)과 **구분**되므로 프론트는 "연결할 수 없음"이 아니라
  "거부됨"을 보여줄 수 있다. 거부 수단이 없는 채널은 사람에게 보안 프롬프트를 띄워놓고 "아니오"를
  말할 방법을 주지 않는 것과 같다(2026-07-15 라이브에서 실제로 발생 — 아래 §0.2.2).
  단, **무시되어 자동 닫힘(gave up)은 `presented`**다 — 코드는 읽을 수 있는 시간 동안 화면에 있었고
  사람이 지금 브라우저에 입력 중일 수 있다; 이를 거부로 처리하면 정상 진행한 페어링을 죽인다.
- **Fail-closed — 모든 환경에서.** presenter가 사람에게 도달함을 증명하지 못하면(`available()===false`)
  브리지는 **아무것도 발급하지 않고** `503 approval_unavailable`(sanitized: 고정 error 코드만)로 거절한다.
  presenter 미주입 시 기본값은 `nullApprovalPresenter`(항상 unavailable) → **위험한 기본값이 표현 불가능**하다.
  발급 후 **표시(present)가 실패하면 요청을 롤백**(discard)한다 — 사람이 코드를 못 본 요청은 남기지 않는다.
  (§0.4의 dev 완화 `--dev-insecure-auto-approve`만이 유일한 우회이며, **명시적 주입**이 필요하고
  production에서 거부된다. 이는 presenter 부재의 대체 경로가 **아니다**.)
- **프로토콜/스키마 영향 없음**: `BRIDGE_PROTOCOL_VERSION` 불변, `PairRequestResponse` 불변
  (승인 코드는 응답에 없다), 영속 `pairings.json` 스키마 불변 → **마이그레이션·재페어링 불필요**.
  `pair/confirm`은 에이전트 내부 계약(확인 페이지 ↔ 엔드포인트, 동일 빌드)이라 FE 계약이 아니다.

### 0.2.2 라이브 검증 기록 — macOS 다이얼로그 (2026-07-15)

운영자 입회 하 **승인된 라이브 실행**(3개 세션). presenter를 **직접** 호출(합성 값만);
local-agent·BridgeServer·커넥터·마켓플레이스 경로 미기동, 페어링/런타임 상태 **미생성/미기록**
(`.bridge`/`.status`/`.connections` 없음, 잔류 프로세스 없음 확인). presenter의 import 그래프는
`node:child_process` + `node:fs` + 무-import 타입 모듈뿐이라 위 경로들은 **구조적으로 도달 불가**.

**최종 결과 — 사람의 세 결말이 모두 관측됨 (승인·거부 양 경로 검증 완료):**

| 조작 | `available()` | 결과 | 소요 |
|---|---|---|---|
| `확인` | `true` (darwin) | `presented` | 2872 ms |
| `Esc` | `true` (darwin) | `declined` | 4505 ms |
| `취소` 버튼 | `true` (darwin) | `declined` | 3702 ms |

→ ADR §3.3의 **"macOS 지원"은 관측된 사실**이다. (무시 후 자동 닫힘(gave up)→`presented`는
설계상 의도이며 라이브 미관측 — 90초 대기가 필요해 검증 가치 대비 비용이 크다.)

**중간 이력 — 교훈으로 남긴다.**
- **1차**: `확인 → presented` 확인. 동시에 **거부 불가** 발견 — `확인` 단일 버튼 + `cancel button`
  미정의라 Esc가 무반응이었다(보안 구멍 아님 — `확인`만으로는 아무 권한도 부여되지 않고 코드 입력이
  여전히 필요; 그러나 **동의 UX 결함**: 사람에게 보안 프롬프트를 띄워놓고 "아니오"를 말할 방법을
  주지 않았다). → `buttons {"취소","확인"} … cancel button 1` + `on error number -128` → `declined` 추가.
- **2차**: Esc/취소 두 leg 모두 `presented`(2.2s/1.8s). 스크립트에는 `cancel button 1`·
  `on error number -128`이 **정상 존재**했다 → 전송 스크립트를 덤프해 **본문 렌더링 결함 2건** 발견:
  1. **줄바꿈 소실** — 본문을 `"\n"`으로 조립한 뒤 **통째로** 이스케이프 → 이스케이프 단계가
     제어문자(=방금 넣은 `\n`)를 제거 → 한 줄 덩어리로 표시.
  2. **본문 전체 절단** — 신뢰 불가 *필드*용 120자 캡을 **조립된 본문 전체**에 적용 →
     `요청한 적이 없다면 [취소]`에서 잘림(`를 누르세요 (코드를 알려주지 마세요)` 미표시).
     승인 코드가 보인 건 **우연히** 120자 안에 들었기 때문 — origin/라벨이 길었다면 **코드가 통째로
     사라진 채 `presented`를 반환**했을 것이다(가장 위험한 형태의 결함).
  → 2차의 "확인이 눌림"과 이 렌더링 결함은 **같은 사건**이었다: [취소]를 누르라는 문장 자체가 잘려
    있었다.
- **수정**: 필드별 이스케이프·캡(`sanitizeField`, 80자, 생략 표시 `…`) + 줄바꿈은 AppleScript
  `linefeed` 상수 연결로 구성(리터럴 내부 문자로는 불가능 — raw newline은 구문 오류이고 제어문자
  제거 단계가 먹는다). 고정 안내문과 승인 코드는 **절대 캡하지 않는다**.
- **3차**: 본문 수정 후 Esc/취소 **양쪽 모두 첫 시도에 `declined`** → 진단이 옳았음을 확인.
  소요 4.5s/3.7s(2차의 ~2s 대비)는 읽을 수 있는 다이얼로그를 실제로 읽은 것과 일치한다.

**교훈**: hermetic 테스트가 `toContain(code)`만 검사해 **뭉개지고 잘린 본문을 통과**시켰다 —
표시물은 값 포함 여부가 아니라 **구조**를 검사해야 한다(장문/적대 입력이 코드·안내문을 밀어내지
못함 + 리터럴 구분자 미증가 구조 테스트 추가됨).

**한계(정직하게).** 이 설계는 **HTTP 표면에 갇힌 로컬 프로세스**의 승인 위조를 막는다.
에이전트의 콘솔을 읽을 수 있는 동일 uid 프로세스(리다이렉트된 로그 파일, tty 접근, ptrace)는
여전히 코드를 얻을 수 있다 — 이는 동일 uid 침해에 내재한 한계이며(그런 프로세스는 토큰을 직접
ptrace로 꺼낼 수도 있다) 이 슬라이스가 해결한다고 주장하지 않는다.

### 0.2.3 남용·표시 하드닝 (2026-07-15) — 독립 리뷰 후속 2건

§0.2.1이 **승인 비밀의 기밀성**을 세웠다면, 이 패스는 그 비밀이 **사람에게 도달하는 표면**과
**사람의 주의(attention)** 자체를 방어한다. 위협 모델은 동일하다(Origin을 자유롭게 위조하는 로컬 프로세스).

#### (A) 신뢰 불가 필드의 표시 계약 — 공유 규칙

**문제.** `origin`·`workspaceLabel`은 **임의의 호출자 제공 문자열**이고, 승인 표면은 이를
**승인 코드·안내문 바로 옆에** 렌더링한다. 터미널은 건네받은 이스케이프 시퀀스를 **실행한다.**
DEV stderr presenter는 두 필드를 **그대로** 출력했다 → 조작된 `workspaceLabel`이 커서를 승인 코드 줄로
올려 **공격자가 고른 코드로 다시 쓰거나**, 박스를 지우거나, bidi로 origin을 신뢰 도메인처럼 읽히게
할 수 있었다. 이는 유일한 out-of-band 채널을 "사람이 **진짜** 코드를 읽는다"에서 "사람이 **호출자가
그린 것**을 읽는다"로 바꾼다 — 미관 문제가 아니라 **동의 무결성(consent integrity) 결함**이다.
macOS 다이얼로그는 이미 정화했고 **터미널은 하지 않았다**(같은 규칙의 두 번째 표면이 비어 있었다).

**계약.**
- 신뢰 불가 필드는 **불활성(inert)·유계(bounded) 텍스트**다. 주변 표면이 **어떻게 렌더링되는지에
  영향을 줄 수 없다.**
- 규칙은 `src/bridge/untrusted-display.ts`(**무-import 순수 leaf**)가 **단독 소유**한다. macOS 다이얼로그와
  DEV 터미널이 **같은 규칙**을 쓰고, 향후 Windows/Linux 어댑터는 규칙을 **상속**한다(재유도하지 않는다).
- **제거 대상 = 렌더링되지 않으면서 렌더러를 조작하는 코드 포인트**만:
  - **C0+DEL**(`<0x20`, `0x7f`) — ESC가 ANSI 시퀀스를 연다(`\x1b[1A`=커서 위, `\x1b[2K`=줄 지움);
    CR은 현재 줄을 덮어쓰고 LF는 박스를 깬다. (AppleScript 리터럴 내부에서는 **구문 오류**다.)
  - **C1**(`0x80–0x9f`) — **U+009B가 CSI**다. ESC만 막으면 **우회로가 남는다**.
  - **bidi·비가시 포맷터**(U+200B–200F, 202A–202E, 2060–2064, 2066–2069, FEFF) — Trojan-Source류.
    RLO는 뒤 글자를 재배열해 origin을 **다른 호스트로 읽히게** 한다 → 사람에게 요구하는 **유일한
    판단**("이 origin을 아는가")을 무력화한다. 렌더링되지 않으므로 제거해도 **사람이 잃는 정보가 없다**.
- **ASCII 허용목록이 아니다.** 한국어·이모지·일반 문장부호는 그대로 통과한다 — 정상 워크스페이스
  라벨을 뭉개는 것은 **흔한 경우**이지 공격이 아니다. 이것은 **제어문자 필터**다.
- **필드별 캡**(80자, 생략 표시 `…`) — 조립된 본문이 아니라 **각 필드에** 건다. **strip → cap 순서**가
  load-bearing이다(먼저 캡하면 보이지 않는 제어문자에 예산을 쓰고, 제거 후 캡을 넘겨 렌더된다).
  **코드 포인트 단위**로 센다(서로게이트 쌍을 쪼개면 그 자체가 렌더를 깬다).
- **승인 코드는 서버 발급 hex이며 절대 캡하지 않는다.** 고정 안내문도 마찬가지 —
  §0.2.2가 라이브에서 얻은 교훈(**본문 전체 캡 → 코드가 사라진 채 `presented`**)의 일반화다.
- **어댑터별 구문(syntax) 이스케이프는 그 위에 유지**된다(`appleScriptLiteral`, 확인 페이지 HTML
  이스케이프). strip은 **렌더러**에 관한 것, escape는 **구문**에 관한 것 — **둘 다** 필요하다.

#### (B) 동시 대기 페어링 요청 상한 (pending cap)

**문제.** 페어링 요청은 **무제한**이었다. 요청 1건 = **사람 1회 방해**(브리지는 모든 요청을 presenter로
표시한다). 로컬 프로세스가 요청을 살포해 **사람이 아무거나 눌러 넘길 때까지 승인 프롬프트로 파묻을
수 있었다** — §0.2.1의 코드 기밀성을 우회하지는 못하지만, 사람의 판단을 마모시켜 **동의 자체를 무의미**하게 만든다.

**계약.**
- `PairingRegistryOptions.maxPendingRequests` — **주입 가능**, 기본 **8**. 요청 1건 = 진행 중인 사람 동의
  1건이므로 동시 몇 건 이상은 이미 비정상이다. 8은 사람이 몇 번 재시도할 여지(재시도마다 새 요청이
  나고 이전 요청은 5분 TTL 동안 pending으로 남는다)를 남기면서도 **유의미하게 낮다**.
- **`requestPairing` 내부에서 강제**한다 → 우회 불가이고, 레지스트리 자신의 sweep과 **경쟁하지 않는다**
  (한 호출 안에서 sweep→계수→발급이 원자적).
- **만료 요청을 먼저 sweep한 뒤 계수**한다 → 상한은 **살아있는 동의에만** 걸리고, 죽은 항목이 상한을
  **잠그지 못한다**.
- **`pending`만 계수한다.** terminal(allowed/denied)까지 세면 공격이 **더 쉬워진다** — 아무도 기다리지
  않는 요청으로 **TTL 내내 상한을 점유**할 수 있다.
- 상한에 걸리면 **아무것도 발급하지 않는다**(requestId·코드·엔트리 없음).

#### (C) refuse-not-evict — 이 패스의 핵심 결정

상한이 걸릴 때 **누가 지는가**가 보안 속성을 결정한다.
- **축출(evict oldest live)** = 플러드를 **아무것도 안 하는 것보다 강하게** 만든다. 공격자가 **사람이
  지금 콘솔에서 코드를 읽으며 승인 중인 바로 그 요청**을 밀어낼 수 있고, 그 사람의 confirm은 **이유 없이
  실패**하거나 — 더 나쁘게 — 슬롯을 차지한 **공격자의 요청**에 안착한다.
- **신규 거절(refuse)** = 플러드는 **신규 페어링만** 막을 수 있다. 가시적이고, TTL이 빠지면서 **스스로
  회복**하며, 페어링은 안전-임계 경로가 아니다. **진행 중인 동의는 오염되지도 탈취되지도 않는다.**
→ 이 흐름의 다른 모든 곳과 같이 **fail-closed**. 해소된 요청(사람이 거부/승인)은 슬롯을 **즉시** 돌려준다
  — busy는 **일시적**이며 잠긴 에이전트가 아니다.

#### (D) presenter **앞에서** 거절 + sanitized `503 pairing_busy`

- 브리지는 **presenter를 호출하기 전에** 거절한다. **presenter가 희소 자원**이다(호출 1회 = 다이얼로그/
  콘솔 블록 1회) → 플러드는 **그 앞에서** 끊어야 한다. 프롬프트 N개를 사람에게 던진 뒤 거절하면
  **공격의 대부분이 이미 성립**한다.
- 응답 **`503 pairing_busy`** — 고정 error 코드만(`{error:"pairing_busy"}`).
  - **`503 approval_unavailable`과 구분**된다: 후자는 **사람 채널 자체가 없음**(fail-closed, 영구적 성격),
    전자는 **일시적 용량 부족** → 프론트는 "연결할 수 없음"이 아니라 **"잠시 후 다시 시도"**를 보일 수 있다.
  - **429가 아닌 이유**: 이것은 에이전트의 **전역 동의 용량**이지 호출자별 rate limit이 아니다 —
    여기엔 제한할 **호출자 신원이 없다**. "새 페어링을 지금 받을 수 없는 일시 상태" = 503의 정의.
  - 본문은 호출자가 **이미 알던 것 외에 아무것도 주지 않는다**(id·코드·용량 수치 없음).
- 로그 `bridge_pair_refused`는 **수치만**(`reason`·`pending`·`limit`) 남긴다 — origin·requestId·코드 없음.
  수치는 운영자가 **플러드와 사람의 재시도를 구분**하는 데 필요하고, 식별자는 그렇지 않으며
  sanitization 계약(collector §4.3)이 배제하는 값이다.

**프로토콜/스키마 영향 없음**: `BRIDGE_PROTOCOL_VERSION` 불변, 영속 `pairings.json` 스키마 불변 →
**마이그레이션·재페어링 불필요**. dev 완화(`autoApprovePairing`)에서는 요청이 즉시 confirm되어 `pending`으로
남지 않으므로 **상한이 실질적으로 걸리지 않는다**(막을 사람도 없다) — 그래도 레지스트리가 규칙을
소유하므로 그 경로도 거절을 처리한다.

**FE 계약 — 미구현 후속(정직하게).** 이 슬라이스는 FE를 건드리지 않았다. `bridgeClient.requestPairing`은
현재 **모든 non-ok 응답을 `phase:"unreachable"`로 접는다**(`frontend/src/lib/bridge/bridgeClient.ts:160`)
→ `pairing_busy`·`approval_unavailable`·`approval_declined` **셋 다 "연결할 수 없음"으로 보인다.**
위 "프론트는 구분해 보일 수 있다"는 **응답 코드가 가능케 한 능력**이지 **현재 동작이 아니다.**
세 코드를 구분해 표시하는 것은 **별도 FE 슬라이스**다(§15 (1) 저장소 검증 가능 항목).

### 0.3 초기 지원 범위
- **1 OS 사용자 · 1 SellerOps 워크스페이스 · 다수 커머스 채널 연결 · 다수 SellerOps 브라우저 탭.**
- **한 에이전트에 다수 SellerOps 워크스페이스는 제외.**

### 0.4 인증·보안 게이트
- **Production은 미페어링 접근을 절대 허용하지 않는다.**
- **개발/테스트용 페어링 완화는 명시적 플래그**를 요구하며 **production 빌드에서 사용 불가**여야 한다.
- assisted macOS 파일럿은 **기존 백엔드 dev 인증을 임시로** 유지할 수 있다.
- **고객 회사 PC 설치 전에는 리보크 가능한 per-agent 백엔드 토큰이 필수**다(파일럿 이후 선결).
- (파생) 장기 페어링 비밀은 URL에 담지 않고, WS 핸드셰이크는 **단명·1회용 연결 티켓**으로 인가한다(§5).

### 0.5 G1 명령 경계 (§9 확정)
- 허용: **health/status 요청 · 페어링 요청·확인 · 페어링 리보크 · 현재 상태 스냅샷 · 버전/능력 협상.**
- **불허(G1)**: 마켓 워크플로 start/cancel/stop, 브라우저 제어·실행, 자동 클릭, 로그인·자격증명 입력.
  → G1은 **페어링과 관측(observability) 전용**.

### 0.6 하드닝 패스 결과 (2026-07-08) — 커밋 블로커 해소
구현 후 커밋 블로커 2건을 해소하고 정직성을 강화한 결과. 아래가 §2.2·§6의 이전 "무-의존성/손수 구현"
서술과 §8 이벤트 상태를 **갱신**한다.
- **성숙한 WebSocket 라이브러리 채택(A)**: 손수 만든 RFC6455 프레임 코덱(`ws-frame.ts`)을 **삭제**하고
  전송을 **`ws` 패키지**로 교체(런타임 dep, `@types/ws` devDep, lock 갱신). 보안 코어(오리진·티켓·리플레이·
  페어링·리보크·이벤트 스키마·로깅)는 그대로 유지. `maxPayload` 명시, **압축 비활성**, **바이너리 페이로드
  거부**(G1은 JSON 텍스트 전용), ping/pong·close·malformed·급단절은 라이브러리가 처리. **SSE 폴백 없음.**
- **실제 로컬 에이전트 통합(B)**: 브리지는 이제 **실제 Local Agent 프로세스가 소유**한다
  (`src/agent/agent-bridge.ts` ← `src/cli/local-agent.ts`). 승인된 에이전트 런이 브리지를 **정확히 1회**
  기동·부착, SellerOps 탭과 독립 상주, SIGINT/SIGTERM에 **idempotent close**, 단일 인스턴스(EADDRINUSE→
  경쟁 안 함), 스냅샷·이벤트는 **실제 설정 연결 + 실제 `ConnectorOrchestrator` settle 결과**에서 파생.
  전송 코드는 마켓 커넥터에 삽입하지 않음. 표준 `cli/bridge.ts`는 **dev/test 하니스로 라벨**만 유지.
- **능력 정직성(C)**: hello/snapshot이 **`supportedEvents`**(실제 배선된 카테고리)를 협상으로 알린다.
  실제 배선 = agent_lifecycle · bridge_status · capability · connection_lifecycle · pending_user_action ·
  recoverable_failure. **예약(미배선, 스키마만)** = browser_lifecycle · auth_session · collection_progress ·
  collection_result · terminal_failure — 실제 진행/브라우저 이벤트를 **날조하지 않는다**(신뢰 seam 부재).
- **페어링 저장 경계(D)**: 프론트 localStorage bearer 저장은 **assisted macOS 파일럿용 임시 방식**이며
  최종 고객-PC 보안 자세가 아니다. **Browser Projection·고객-PC 배포 전에 non-exportable WebCrypto 키 +
  proof-of-possession(또는 검토된 대안)**을 평가한다. **production 페어링 우회는 계속 금지.** 페어링 암호는
  이 패스에서 재설계하지 않음(구체 취약점 수정 목적 아님).
- **미인증 health 최소화(E)**: health에서 `paired`(및 페어링 상태 일체) **제거**. 미인증 health는
  "호환 에이전트 존재 + 프로토콜/버전"만 노출. 상세 페어링·연결 상태는 **승인 오리진 + 인증 세션** 필요.
  (프론트는 stale 토큰을 health가 아니라 ws-ticket 401로 발견한다.)

---

## 1. 목적 (Purpose)

**이 브리지가 가능케 하는 것**: SellerOps 웹 프론트엔드가, 같은 PC에서 **독립적으로 실행 중인** 로컬
에이전트의 **가용성·페어링·실시간 상태**를 안전하게 확인하는 최소 채널. 구체적으로 프론트가:

- 로컬 에이전트가 설치·실행·페어링되었는지 감지하고(§16.7의 4상태를 실동작으로),
- 페어링된 뒤 **sanitized 실시간 상태 이벤트**(에이전트/연결/브라우저 수명, 사용자 행동 필요, 완료/실패)를 받고,
- 프론트 새로고침/종료 후에도 에이전트가 계속 돌고, 재접속 시 현재 상태를 복원하며,
- 버전/능력 협상으로 비호환을 표면화한다.

**이 브리지가 지금 가능케 하지 않는 것**(후속 슬라이스에서 이 브리지 위에 얹음): 브라우저 화면 투사·입력
릴레이(Browser Projection V0, §17-B G2), 가이드 NAVER 단계(G3), 자동 재로그인(G4), Windows/클라우드
런타임(G6). 이 슬라이스는 **관측·페어링·수명 보고**만 세우고, 마켓 쓰기·자동 클릭·자동 로그인은 넣지 않는다.

**왜 지금**: Frontend Spec §16.7이 정의한 로컬 에이전트 상태(미설치/미페어링/offline/정상)와 §16.3의
실시간 단계 상태는 **전송 채널이 없으면 화면 개념일 뿐**이다. G1은 그 화면들이 실제로 매달릴
관측·페어링 토대다. G2 이후 모든 가이드 연결 기능이 여기에 의존한다(§17-B 의존성 열).

---

## 2. 현행 증거 (Current-state evidence)

> 파일 경로는 저장소 확인. 재사용 가능한 것 / 부재한 인프라 / 아키텍처 격차로 분류한다.
> (근거: Runtime ADR §1·§3, 부록; 2026-07-07 로컬 에이전트 아키텍처 정찰.)

### 2.1 재사용 가능한 코드 (있음)
- **로컬 에이전트 진입점·수명**: `collector/src/cli/local-agent.ts` — 별도 Node CLI(`main()` `:176`),
  승인 플래그(`--i-understand-this-launches-local-agent-chrome` `:45`) 없으면 DRY RUN(`decideRun` `:107-129`),
  `createSignalShutdown()` idempotent SIGINT/SIGTERM(`:135-142`, 등록 `:227-233`), 브라우저 연결 상주
  (`:244-245` "browser connections stay resident … until a signal triggers a clean shutdown"). 웹 UI와
  독립된 프로세스 수명이 **이미** 존재(§10 "독립 수명" 요건의 토대). 모듈 doc(`:22-24`)이 tray/installer/
  OS auto-start/Device Vault/catch-up/backend-write **미구현**을 명시.
- **상태 머신**: `collector/src/agent/local-agent-state.ts` — `LocalAgentState` **11개 값**(`:47-58`),
  순수 reducer `reduceLocalAgent`(`:182-277`, 불법 전이는 안전 no-op), STOP/RESTART 우세(`:186-189`,
  RESTART는 READY 상속 안 함). 드라이버: `local-agent-runtime.ts`(`class LocalAgentRuntime :305`, 모두
  주입식·실 브라우저/fs/timer 미소유), `progressive-reconnect-runtime.ts`(Mealy 드라이버 `:80`,
  `MAX_DRIVE_STEPS=12` `:74`; 액션 `BEGIN_INSPECTION/ESTABLISH_LOGIN_MODE/SUBMIT_LOGIN_ONCE/
  REQUEST_CATCH_UP(기록만 `:152-154`)/EMIT_USER_ACTION`). 프론트 이벤트로 매핑할 원천(§8.1).
- **커넥터 오케스트레이션·관측 seam**: `collector/src/connector/*`. 관측자
  `ConnectorOrchestratorObserver`는 **단일 콜백 `onConnectionSettled(result)`**(`connector-orchestrator.ts:63-65`)
  이며 **settle-시점 전용**(성공/실패/SKIPPED 각 분기에서 완료 후 1회 — `:130,154,171`). 채널-무관
  계약 `ChannelConnector.ensureReady()`를 로컬·클라우드 루트가 공유. **이벤트 어댑터가 감쌀 대상.**
- **sanitized 결과 타입 (이미 존재)**: `ConnectorStartupResult`(`connector-orchestrator.ts:37-53`, 헤더
  "Only enums / booleans — never raw data") 필드 = `connectionId, channel, strategy, implementationStatus,
  outcome, authStatus, capabilityStatus, reconnectPath, pendingUserAction, syncIntent`. 사람 개입 enum
  `ConnectorUserAction`(6값, `channel-connector.ts:49-55`)·`ReconnectPath`(4값)·`ConnectorReadyOutcome`
  (`READY/NEEDS_USER_ACTION/FAILED/SKIPPED`)가 §8 카테고리로 거의 그대로 매핑됨.
- **sanitized 로깅 계약**: `collector/src/log.ts` `safeMeta`(`:38-50`) — 키명에 token/password/passwd/
  cookie/authorization/secret/credential/session 포함 시 **드롭**(`FORBIDDEN_KEY_SUBSTRINGS :9-18`),
  스칼라(`null|string|number|boolean`)만 통과, 비스칼라는 타입 태그로 붕괴. 인메모리 sink로 테스트 가능
  (`:29-35`). 이벤트 페이로드 sanitize의 **기존 표준**(§8.3 재사용).
- **16-hex/해시 헬퍼 (이미 존재)**: `sha256(...).slice(0,16)` 패턴 다수(`ingestion/envelope.ts:98`,
  `esm/esm-candidate-signature.ts`(salt 필수·fail-closed), `naver/account-store-resolver.ts:208-211`);
  연결별 프로필 id `dedicatedProfileIdFor`(`progressive-reconnect.ts:105-107`, slice 24). opaque id 규율의 토대.
- **백엔드 통신 선례**: `collector/src/upload.ts` — 백엔드 JWT(`login`→`Bearer`) + `POST /api/uploads`
  (`:123`), 기본 `http://localhost:8080`. **SellerOps dev 자격증명(NAVER 아님)**이며 doc(`:38-43`)이
  이미 "productized path replaces this with a **revocable collector/pairing token** (separate slice)"라고
  이 슬라이스의 후속을 지목. 단 이는 **백엔드와의 채널이지 프론트와의 채널은 아님**.

### 2.2 부재한 인프라 (없음 — 이 슬라이스가 세움)
- **프론트↔에이전트 전송 채널 전무 (확인됨)**: collector에 HTTP/WS/SSE 서버·IPC·고정 포트·페어링
  토큰 엔드포인트 **없음**. 유일한 소켓은 `progressive-reconnect-chrome.ts`의 **일시적 빈 포트 선점기**
  (`net.createServer`+`listen(0,"127.0.0.1")` `:106-108`)로, 자기 Chrome에 `connectOverCDP`하려는 용도이지
  프론트 브리지가 아님. 상태는 현재 **stdout JSON(`printingObserver` `local-agent.ts:145-163`) / `.status/*.json`
  (`status.ts:88-91`) / sentinel 파일**로만 나간다. 프론트로 나가는 전송이 0.
- **페어링/인증 재료 없음**: 로컬 페어링 토큰·오리진 허용·리보크 개념 없음("pairing token"은 `upload.ts:41`
  에 **미래 아이디어로만** 언급). 프론트는 백엔드용 JWT(localStorage `sellerops_token`,
  `frontend/src/lib/apiClient.ts:63`)만 보유.
- **버전/능력 협상 없음**: 에이전트 버전·capability를 프론트가 물을 표면 없음.
- **로컬 헬스 엔드포인트 없음**: "에이전트 살아있나"를 프론트가 확인할 최소 진단 표면 없음.
- **전송 의존성 (착수 당시 없음 → 하드닝에서 `ws` 채택)**: 착수 시점 `collector/package.json`엔
  `dependencies` 블록이 없었다. **하드닝 패스(§0.6-A)에서 `ws`를 런타임 dep로, `@types/ws`를 devDep로
  추가**하고 전송을 `ws`로 구현한다(손수 만든 RFC6455 코덱은 삭제). 프로토콜 정확성·유지보수가
  package/lock 무변경보다 우선(제품 오너 결정).

### 2.3 아키텍처 격차 (결정 필요)
- **HTTPS→localhost 혼합 콘텐츠**(repository-verifiable + external-research): 프론트는 axios로
  `VITE_API_BASE_URL ?? "http://localhost:8080"`에 붙는다(`apiClient.ts:61`). dev는 `http://localhost:5173`
  (`frontend/vite.config.ts`)이라 `http://localhost:*` 호출이 동작하지만, **배포 프론트가 HTTPS면 브라우저
  혼합 콘텐츠 정책이 `http://localhost` 요청을 차단**한다. 로컬 브리지 전송의 오리진/스킴 설계가 이
  제약을 받는다(§5·§6, 미해결).
- **settle-시점 이벤트 한계 (확인됨)**: `ConnectorOrchestratorObserver`는 **settle 후 1회만** 발화하며
  실행-중 스트리밍 콜백이 없다(§2.1). 단 런타임은 주입식 sink로 `EMIT_USER_ACTION`(사람 차례) 등을
  settle 지점에서 방출한다(`progressive-reconnect-runtime.ts:56-61`, `local-agent-runtime.ts:120-131`).
  → **"브라우저 열림" 같은 실행-중 이벤트를 실시간으로 내려면 기존 settle-only seam 위에 스트리밍
  seam 보강이 필요할 수 있다.** 정확한 필요 범위는 구현 슬라이스 첫 과제(§15 (1)).
- **CORS/오리진/CSRF 규약 부재**: 백엔드는 Spring Boot + JWT지만, 로컬 에이전트에는 오리진 검사·CSRF
  개념이 없다(서버 자체가 없으므로). 브리지 서버는 이를 **처음부터** 세워야 한다(§5).

### 2.4 문서 불일치 보고 (report, not silently fix)
- Runtime ADR §3.4는 `LocalAgentState`를 **"12상태"**로 적었으나, 코드(`local-agent-state.ts:47-58`)는
  **11개 값**이다(STOPPED, STARTING, INSPECTING_SESSION, READY, PREPARING_RECONNECT,
  WAITING_FOR_CREDENTIAL_SELECTION, VERIFYING_LOGIN, HUMAN_RECONNECT_REQUIRED, SYNCING, PAUSED, DEGRADED).
  CLAUDE.md 충돌 규칙(구현 증거가 정본을 조용히 재정의하지 않고 **보고**)에 따라 여기에 사실을 기록한다.
  Runtime ADR §3.4의 정정은 이 슬라이스 범위 밖 — 별도 정정 필요.

---

## 3. 범위 (Scope)

이 슬라이스에 **포함**되는 것만:

- 로컬 에이전트 **발견/가용성** 감지(설치/실행/미실행 구분의 실동작).
- 프론트↔에이전트 **안전 페어링**(개시·로컬 확인·리보크 가능한 페어링 재료).
- **브리지 연결 상태**(연결됨/끊김/재접속 중).
- **sanitized 실시간 이벤트 전달**(§8 카테고리).
- 현재 **로컬 에이전트 상태 + 연결(채널)별 상태**.
- **사용자 행동 필요(user-action-required)** 이벤트(로그인/2FA/계정 선택 등 사람 차례).
- **브라우저 열림/닫힘** 상태.
- **완료/실패** 이벤트(recoverable / terminal 구분).
- **독립 에이전트 수명**(프론트와 무관하게 실행 지속).
- 프론트 **새로고침 후 재접속·상태 복원**.
- 명시적 **버전/능력 협상**.
- **로컬 헬스 엔드포인트**(또는 동등한 최소 진단 표면).
- **테스트 + 개발자 런북**.

---

## 4. 명시적 제외 (Explicit exclusions)

이 슬라이스에서 **하지 않는다**(각각 후속 슬라이스/트랙):

- 브라우저 프레임·스크린샷 스트리밍 (→ G2)
- 마우스·키보드 릴레이 (→ G2)
- Browser Projection V0 (→ G2)
- 가이드 NAVER 단계 (→ G3)
- 자동 로그인 (→ G4)
- OS 자격증명 저장소(Device Vault) (→ G4)
- 자격증명 입력 (영구 제외 — 에이전트는 자격증명을 입력하지 않음, scope §1.2·§7-13)
- Windows 패키징 (→ G6)
- 자동시작 설치 (→ G6)
- 클라우드 런타임 (방향으로만, Runtime ADR §3.5)
- 마켓 쓰기 액션 (v1 영구 범위 밖, scope §2·§7-2)
- 백엔드 집계 변경
- 브리지 상태 표면을 넘는 UI 리디자인

---

## 5. 신뢰·보안 경계 (Trust & security boundary)

> 임의의 암호/전송 설계를 **선택하지 않는다**. 아래는 원칙과, 저장소 증거로 뒷받침되는 것 / 외부
> 리서치 필요 / 제품 오너 결정 필요로 **분리**한 것이다.

### 5.1 증거로 뒷받침되는 원칙 (decisions supported by evidence)
- **로컬호스트 전용 리스닝**: 브리지 서버는 loopback(`127.0.0.1`/`::1`)에만 바인딩하고 외부 인터페이스에
  노출하지 않는다. (근거: 로컬 에이전트는 사용자 PC 프로세스이며 원격 접근 요구가 없음 — scope §1.2
  "독립 백그라운드 실행", Runtime ADR §3.3.)
- **자격증명·페이지 본문 무전송**: 브리지 이벤트는 자격증명·쿠키·토큰·페이지 본문·스크린샷·URL·좌표·
  DOM 텍스트를 **싣지 않는다**. (근거: 기존 sanitized 계약 `log.ts safeMeta`, Frontend Spec §16.9,
  scope §9 출력 규칙 — enum/coarse/boolean/16-hex만.)
- **sanitized 로깅**: 영속 로그에 위 금지 데이터를 남기지 않는다(§16.9 계승).
- **여러 브라우저 탭 안전성 요구**: 같은 PC의 여러 SellerOps 탭이 붙어도 상태 일관성이 깨지지 않아야
  한다(§10에서 다중 탭 동작 정의).
- **ambient localhost 신뢰 금지**: "localhost에서 왔으니 신뢰"만으로 상태/명령을 허용하지 않는다 —
  같은 PC의 다른 프로세스/웹사이트도 localhost로 요청할 수 있으므로 **명시적 페어링 재료**를 요구한다.
  (근거: 로컬 CSRF/DNS-rebinding류 위협은 localhost 서비스의 알려진 문제 — 아래 5.2에서 완화책은 리서치.)

### 5.2 외부 리서치 필요 (external research)
- **전송·암호 세부 설계**: 페어링 재료의 형식(토큰 엔트로피·수명), 오리진 검증 방식, DNS-rebinding·
  로컬 CSRF 완화(예: `Origin`/`Host` 검사, 사전 등록 오리진, 토큰 헤더), 리플레이 저항(nonce/만료).
  → 저장소에 선례 없음. 브라우저-로컬 서비스 보안 관용례를 조사해 **제안**한 뒤 승인받는다.
- **HTTPS 프론트 → localhost 접근**: 배포 프론트가 HTTPS일 때 `http://localhost` 접근의 혼합 콘텐츠
  차단 회피책(로컬 TLS/신뢰 인증서, `*.localhost` 예외 규칙, 브라우저별 정책 차이). §2.3·§6과 연동.
- **토큰 저장 위치**: 에이전트 측 페어링 비밀의 저장(로컬 파일 권한 모델). collector에 Device Vault는
  없음(Runtime ADR §3.2) — OS 자격증명 저장소가 아닌 **로컬 파일** 전제의 안전 저장 관용례 조사.

### 5.3 제품 오너 결정 필요 (product-owner decision)
- **페어링 개시·확인 UX 모델**: 페어링을 프론트가 개시하고 **로컬(에이전트 측)에서 사람이 확인**하는
  방식(코드 입력? 에이전트 콘솔/트레이 승인?)의 선택. 트레이가 미구현이므로(Runtime ADR §3.3) 파일럿
  확인 표면 선택이 필요.
- **리보크 정책**: 페어링 재료의 만료·회전·수동 리보크 정책과 트리거.
- **다중 로컬 사용자**: 한 PC에 OS 사용자가 여럿일 때 페어링 격리 요구 수준(파일럿은 단일 사용자 가정?).
- **개발 모드 완화**: dev에서 페어링을 생략/자동화할지, 생략 시 그 경로가 production에 새지 않도록 하는
  게이트(scope §11 "production 읽기의 mock 강등 금지"와 정합).
- **업로드용 dev 계정 → 페어링 토큰 이관 시점**(Runtime ADR §7 (3)).

---

## 6. 전송 옵션 (Transport options)

> 현행 아키텍처와 호환되는 옵션만 평가한다. **최종 전송은 증거 없이 확정하지 않는다.** 아래는 비교이며,
> 제안이 있으면 "승인 필요 제안"으로 명시한다.

collector는 현재 어떤 서버도 없다(§2.2). 프론트는 axios(HTTP) 사용자다(`apiClient.ts`). 세 후보:

| 축 | A. HTTP + WebSocket | B. HTTP + SSE (+ HTTP 명령) | C. 다른 저장소 지원 IPC |
|---|---|---|---|
| 브라우저 호환 | 광범위(WS 표준) | 광범위(EventSource); 단 커스텀 헤더 제약 | 브라우저에서 직접 불가(로컬 데몬 경유 필요) |
| 이벤트 방향 | 양방향(이벤트+명령 한 채널) | 서버→클라(SSE) + 클라→서버(HTTP POST) 분리 | 양방향이나 브라우저-비친화 |
| 재접속 | 수동 재연결 로직 필요 | EventSource **자동 재연결**(Last-Event-ID) 내장 | 별도 구현 |
| 신규 의존성 | **`ws` 신규 devDep 필요**(또는 raw 구현) | **불필요 — `node:http` 빌트인**으로 SSE+POST 가능(§2.2) | 브리지 데몬 신규 |
| 구현 복잡도 | 중(핸드셰이크·핑퐁·재연결 자체) | 낮음(SSE 표준 재연결) + 명령은 평범한 POST | 높음(브라우저 브리지 데몬 추가) |
| 보안 모델 | 오리진 검증·토큰 서브프로토콜 필요 | HTTP 헤더/오리진 검사 재사용 가능 | 별도 |
| Projection 적합성(G2) | 바이너리 프레임·저지연 릴레이에 유리 | 단방향 텍스트 위주 — 프레임/입력 릴레이엔 부적합 | 미지수 |
| macOS→Windows 이식 | Node 표준(ws/http) — OS 무관 | Node 표준(http) — OS 무관 | OS별 재구현 위험 |
| 테스트 용이성 | 중(WS 목) | 높음(HTTP 요청·SSE 스트림 각각 테스트) | 낮음 |

**결정(§0.1): A(WebSocket)가 1차 장기 전송이다.** HTTP는 health·페어링 부트스트랩·좁게 필요한 요청/응답
에만 쓴다. **자동 SSE 폴백은 구현하지 않는다.**
> **정정(하드닝 §0.6-A).** 최초 구현은 "신규 의존성 회피"를 위해 손수 만든 RFC6455 코덱을 썼으나,
> **프로토콜 정확성·유지보수를 우선**해 성숙한 **`ws` 패키지**로 교체했다(런타임 dep + `@types/ws` devDep,
> lock 갱신). 위 표의 "신규 의존성" 축은 더 이상 결정 근거가 아니다 — `ws`가 핸드셰이크·프레이밍·ping/pong·
> close·malformed·급단절을 처리하고, `maxPayload`·압축 비활성·바이너리 거부는 서버가 명시 설정한다.

### 6.1 Chrome 호환성 스파이크 결과 (2026-07-08, no-marketplace)

승인된 결정 §0.1에 따라 루프백 WS 설계에 의존하기 전에 실제 Chromium(Playwright, build 1228)으로
HTTPS 프론트 컨텍스트 스파이크를 수행했다. **마켓 접속 없음.** 결과:

| 시나리오 | 결과 | 증거 |
|---|---|---|
| HTTPS(**로컬** 오리진) → `ws://localhost`·`ws://127.0.0.1` | **연결 성공(open)** | 혼합 콘텐츠 localhost 예외 성립 |
| 새로고침 후 재연결(로컬 오리진) | **재연결 성공(open)** | reload 후 두 URL 모두 open |
| WS Origin 헤더(서버 수신) | `https://localhost:<port>` | 서버가 핸드셰이크에서 Origin 확인 |
| HTTPS(**public** 주소공간, `CSP: treat-as-public-address`) → 루프백, 권한 없음 | **차단** | `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` (PNA preflight 미발생) |
| 위 public 페이지 + **Local Network Access 권한 부여** | **연결 성공(open)** | Playwright `grantPermissions(["local-network-access"])` 후 open |
| 에이전트 미기동(닫힌 루프백 포트) | **연결 실패** | `net::ERR_CONNECTION_REFUSED` |

**해석·게이트 판정 = 통과(WS 경로 viable, 폴백 불필요).**
- **개발(localhost 오리진) 프론트**는 무조건 연결된다(혼합 콘텐츠 localhost 예외).
- **배포(public HTTPS) 프론트**는 **Chrome Local Network Access 권한**을 받아야 루프백에 연결된다. 권한
  없으면 `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`로 **차단**되고, 권한을 부여하면 **연결된다**.
  이는 §0.1이 이미 승인한 "LNA 권한 고려" UX 요구와 정확히 일치한다 — **해결 불가 차단이 아니라
  권한-게이트**다. 따라서 폴백 없이 Phase C로 진행한다.
- **프론트 함의**: 브리지 클라이언트는 연결 실패를 (a) LNA 차단(`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`
  또는 즉시 실패) → **"로컬 네트워크 접근 허용 필요" 상태 + 권한 안내**, (b) `ERR_CONNECTION_REFUSED`
  → **"에이전트 미기동/오프라인"**, (c) 정상 open으로 구분해야 한다(§7·§8·프론트 §Phase C).
- **한계(정직)**: 헤드리스 하니스는 LNA **네이티브 권한 프롬프트를 자동 클릭하지 못한다**. 스파이크는
  프롬프트 대신 (i) 무권한=차단, (ii) 프로그램적 권한 부여=허용을 검증했다. 실제 프롬프트 승인 흐름은
  헤드드(사람) 환경의 상호작용이며 본 슬라이스에서 자동 검증 대상이 아니다.

> 이 결과가 §5.2의 "HTTPS→localhost 접근" 리서치 항목을 **해소**한다(혼합 콘텐츠는 localhost 예외로
> 통과, public 배포는 LNA 권한으로 해소). 스파이크 하니스 코드는 저장소에 남기지 않는다(1회성).

---

## 7. 페어링 사용자 여정 (Pairing user journey)

> 시각 세부(패널·문구·애니메이션)는 확정하지 않는다([UX-DECISION], Frontend Spec §16). 아래는
> **상태와 필요한 사용자 행동**만 정의한다. §16.7의 4상태를 페어링·버전까지 확장한다.

| 상태 | 의미 | 필요한 사용자 행동 |
|---|---|---|
| 에이전트 미설치 | 로컬 에이전트 자체가 없음 | 설치 안내를 따른다(설치 패키지는 [AGENT-DEP], 미구현) |
| 설치됨·offline | 설치됐으나 실행 중 아님 | 에이전트를 실행한다 |
| online·미페어링 | 실행 중이나 이 프론트와 페어링 안 됨 | 페어링을 개시한다 |
| 페어링 요청됨 | 프론트가 페어링을 개시함 | 로컬 확인을 기다림 |
| 사용자 확인 필요 | 에이전트 측에서 사람 승인 대기 | **로컬에서 페어링을 확인**한다(§5.3 확인 표면) |
| 페어링됨 | 신뢰 수립, 이벤트 수신 | (없음 — 정상 운영) |
| 버전 비호환 | 프론트↔에이전트 능력/버전 불일치 | 에이전트/앱을 업데이트한다(§어느 쪽인지 표면화) |
| 끊김 | 페어링됐으나 연결 유실 | 대기(자동 재접속) 또는 에이전트 실행 확인 |
| 페어링 리보크됨 | 페어링 재료 무효화됨 | 다시 페어링을 개시한다 |
| 로컬 에이전트 오류 | 에이전트 내부 오류 | 안내에 따라 재시작/로그 확인(로그는 sanitized) |

- **미설치/offline**의 설치·실행 안내 자체는 [AGENT-DEP](설치 패키지·트레이 미구현). 화면은 상태를
  정의하되 "설치됨/자동시작"을 있는 것처럼 표기하지 않는다(§4, scope §6.1).

---

## 8. 이벤트 모델 (Event model)

### 8.1 기존 재사용 enum·상태 인벤토리 먼저
구현 슬라이스는 **새 enum을 발명하기 전에** 아래(저장소 확인됨)를 인벤토리·매핑한다:
- `LocalAgentState`(**11개 값**, `local-agent-state.ts:47-58`): STOPPED, STARTING, INSPECTING_SESSION,
  READY, PREPARING_RECONNECT, WAITING_FOR_CREDENTIAL_SELECTION, VERIFYING_LOGIN,
  HUMAN_RECONNECT_REQUIRED, SYNCING, PAUSED, DEGRADED — 에이전트/연결 수명의 원천.
- `ConnectorStartupResult`(`connector-orchestrator.ts:37-53`) 필드 + `ConnectorReadyOutcome`
  (`READY/NEEDS_USER_ACTION/FAILED/SKIPPED`) — 완료/실패 seam(§8.2 category 8·9·10 매핑).
- `ConnectorUserAction`(6값, `channel-connector.ts:49-55`: SELECT_SAVED_CREDENTIAL, ENTER_MISSING_USERNAME,
  COMPLETE_MANUAL_LOGIN, COMPLETE_ADDITIONAL_AUTHENTICATION, PROVIDE_API_CREDENTIAL, REAUTHORIZE_API_ACCESS)
  + `ReconnectPath`(4값) — category 6(사용자 행동 필요)에 거의 그대로 매핑.
- `onConnectionSettled`(settle-전용) + 주입식 sink `EMIT_USER_ACTION` — 진행/사람-차례 seam(§2.3 한계).
- `log.ts safeMeta`(`:38-50`) sanitize 규칙 — §8.3 페이로드 필터의 기준.
> **매핑 산출물**: `LocalAgentState` 11상태 + 위 enum → 아래 프론트 이벤트 카테고리의 정확한 대응표는
> 구현 슬라이스의 첫 산출물이다(Runtime ADR §7 (1) 과제). 여기서 값을 발명하지 않는다.
> **주의**: Runtime ADR/current_state가 "12상태"로 적은 것은 코드상 11상태의 오기다(§2.4 보고).

### 8.2 최소 의미 이벤트 카테고리 (프론트가 필요로 하는 것)
페이지별 구현 세부 없이 **의미 카테고리**만. **[배선]** = 실제 런타임 seam에 연결되어 지금 방출됨,
**[예약]** = 스키마에만 존재(신뢰 seam 부재; 날조 금지). 에이전트가 hello/snapshot의 `supportedEvents`로
어느 것이 배선인지 협상해 알린다(§0.6-C). 이 구분은 **capability 정직성**의 핵심이다.
1. **브리지 상태** — 연결됨/끊김/재접속 중. **[배선]**(프론트 관측).
2. **에이전트 수명** — 시작됨/종료 중. **[배선]**(CLI seam: 에이전트 부팅/종료).
3. **연결 수명** — 채널 연결별 상태 변화(안전 opaque id). **[배선]**(settle `ConnectorStartupResult`).
4. **브라우저 수명** — 브라우저 열림/닫힘. **[예약]**(settle 관측자에 신뢰 seam 없음 — G2).
5. **인증/세션 상태** — 로그인/세션 유효/만료. **[예약]**(스트리밍 seam 없음; authStatus는 스냅샷에만).
6. **사용자 행동 필요(pending user action)** — 사람 차례. **[배선]**(settle 결과의 `pendingUserAction`).
7. **수집 진행(collection progress)** — coarse 진행. **[예약]**(실행-중 seam 없음; syncIntent는 미실행).
8. **수집 결과(collection result)** — coarse 결과. **[예약]**.
9. **회복 가능 실패(recoverable failure)** — 재시도 안내 동반. **[배선]**(settle outcome FAILED).
10. **종료 실패(terminal failure)** — 사람 개입 필요. **[예약]**(구분 seam 없음).
11. **능력/버전 정보** — 협상 결과·비호환. **[배선]**(hello/snapshot).
> 예약 카테고리는 이벤트 포트에 메서드로 존재하나(테스트·G2 대비) **실제 에이전트 배선이 호출하지
> 않으며**, 픽스처에서 부른 값을 실제 진행으로 표기하지 않는다. G2(Browser Projection)·라이브 수집에서
> 신뢰 seam이 생기면 `supportedEvents`에 승격한다.

### 8.3 필드 분류 (모든 제안 필드는 셋 중 하나)
| 분류 | 정의 | 예 |
|---|---|---|
| **노출 안전(safe)** | 그대로 프론트로 | 상태 enum, boolean, coarse bucket, 16-hex opaque id, 카테고리 코드, 에이전트/프로토콜 버전 |
| **변환 필요(transform)** | 원본 금지, 파생만 | 시각→`recencyBucket`류 coarse, 정밀 카운트→"없음/있음/많음" 버킷, 채널·계정 실식별자→16-hex opaque id |
| **금지(forbidden)** | 어떤 형태로도 전송·로깅 금지 | raw URL, 셀렉터, 좌표, DOM 텍스트, 스크린샷/프레임, 키 입력, 자격증명·토큰·쿠키, 개인정보, 계정 실명 |

- 이 슬라이스에서 **좌표/URL/요소 메타데이터는 금지**다. 프로젝션 코치마크용 예외(§16.2)는 **G2 이후**의
  "로컬 신뢰 채널 예외" [PO-DECISION](Runtime ADR §3.4·§7 (3))이며 여기서 열지 않는다.
- 정밀 카운트/타임스탬프는 scope §9(출력은 enum/coarse/boolean/16-hex)와 recency 규칙(CLAUDE.md)에 따라
  **변환 필요** 또는 **금지**로 취급한다.

---

## 9. 명령 경계 (Command boundary)

이 슬라이스에서 프론트가 보낼 수 있는 요청만:
- **현재 상태 요청**(에이전트/연결/버전 조회).
- **페어링 요청**.
- 페어링 **확인 또는 리보크**.
- **이미 승인된** 로컬 에이전트 연결 워크플로 **시작**(승인·감독 원칙 계승 — 새 자동 클릭·마켓 액션 아님).
- 로컬 소유 워크플로 **취소/중지** — **단 현행 수명 의미가 안전히 지원할 때만**(§2.3의 settle-시점
  한계 확인 후; 지원 못 하면 이 슬라이스에서 제외하고 사유를 남긴다).

**금지**: 마켓 쓰기 액션, 자동 클릭, 자동 로그인, 자격증명 입력, 계정/스토어 선택 자동화(scope §7-13·§7-14,
Runtime ADR §4 불변식). 명령은 **관측·페어링·이미-승인된 워크플로 제어**로 한정한다.

---

## 10. 프로세스 수명 (Process lifetime)

- **프론트 새로고침/종료 시**: 로컬 에이전트는 **계속 실행**한다(scope §1.2 "브라우저 탭과 독립"; 현행
  `local-agent.ts`가 이미 웹 UI와 독립 상주). 프론트 종료가 에이전트를 멈추지 않는다.
- **에이전트 재시작 시**: 프론트는 브리지 연결 유실을 감지(§7 끊김)하고, 에이전트 복귀 후 재접속하여
  현재 상태를 다시 수신한다. 페어링 재료가 유효하면 재페어링 없이 복원, 무효면 §7 리보크 경로.
- **프론트 상태 복원**: 프론트는 로컬 상태를 신뢰 원천으로 삼지 않고, 재접속 시 **에이전트로부터 현재
  상태를 재조회**해 복원한다(단일 진실 = 에이전트).
- **중복 에이전트 프로세스**: 동일 페어링/포트를 두 에이전트가 잡는 상황은 방지/감지한다(단일 소유 —
  구체 락 방식은 구현 슬라이스, single-instance 관용례).
- **다중 탭**: 같은 PC의 여러 프론트 탭이 붙어도 각 탭이 일관된 현재 상태를 받는다(브로드캐스트/재조회).
- **종료 소유권**: 에이전트 종료는 **로컬(사용자/에이전트)** 소유다. 프론트는 에이전트를 종료시키지
  않는다(관측자·페어링 클라이언트일 뿐).
- **OS 자동시작 없음**: 트레이·인스톨러·OS 자동시작은 **미구현**(Runtime ADR §3.3). 있는 것처럼 표기 금지.

---

## 11. 제안 구현 경계 (Proposed implementation boundaries)

> 코드 없이 **모듈 경계**만. 전송 코드를 마켓 커넥터에 결합하지 않고, 기존 오케스트레이터 로직 **주위에
> 어댑터**를 둔다(Runtime ADR §3.4 프론트↔에이전트 계약 경계).

- **collector 브리지 서버/어댑터** — loopback 리스닝, 페어링 검증, sanitized 이벤트 방출. `connector/*`·
  런타임을 감싸는 **새 어댑터**(커넥터 내부에 전송 삽입 금지).
- **페어링 스토어** — 페어링 재료의 로컬 저장·검증·리보크(§5.2 저장 관용례).
- **이벤트 어댑터** — 기존 `ConnectorOrchestratorObserver`/`LocalAgentState` seam → §8 카테고리로 변환
  (§8.3 필드 분류 강제; sanitize는 `log.ts safeMeta` 재사용).
- **프론트 브리지 클라이언트** — 전송 클라이언트(SSE/WS 어느 쪽이든 어댑터 뒤). 백엔드 axios 클라이언트와
  **분리**(다른 오리진·다른 신뢰 모델).
- **프론트 provider/hook** — 브리지 상태·이벤트 구독을 컴포넌트에 노출(§16.7 상태 표면이 매달릴 곳).
- **최소 상태 UI** — §7 상태를 표시하는 최소 표면(브리지 상태 뱃지/패널). §4에 따라 그 이상 UI 리디자인 없음.
- **테스트** — §13.

---

## 12. 수용 기준 (Acceptance criteria)

정밀·검증 가능하게. 최소:
1. 프론트가 에이전트 **미설치/offline을 감지**한다.
2. **명시적 로컬 확인 없이는 페어링이 완료되지 않는다**.
3. **미페어링·잘못된 오리진** 클라이언트는 상태 이벤트를 받지 못하고 명령을 낼 수 없다.
4. 페어링된 프론트는 **sanitized 수명 이벤트**를 받는다(§8 카테고리).
5. 프론트 **새로고침 시 재접속·현재 상태 복원**.
6. 프론트 **종료가 로컬 에이전트를 멈추지 않는다**.
7. 이벤트 페이로드·로그에 **금지 데이터(§8.3)가 없다**(스키마·프라이버시 테스트로 강제).
8. 다중 커머스 연결이 **안전 opaque id(16-hex)로만** 구분된다(실식별자 노출 없음).
9. **버전 비호환이 표면화**된다.
10. **macOS에서 테스트 통과**.
11. **Windows 마이그레이션 경로가 문서화**되어 있다(§14; 코드 아님).
12. 검증에 **라이브 마켓 액션이 불필요**하다(합성 픽스처로 전부 가능).

---

## 13. 검증 계획 (Validation plan)

- **단위 테스트**: 이벤트 어댑터(seam→카테고리 매핑), sanitize 필터(§8.3), 페어링 스토어(발급/검증/리보크).
- **전송 통합 테스트**: 브리지 서버 기동→클라이언트 접속→이벤트 수신(합성 이벤트 주입).
- **오리진·비인가 접근 테스트**: 미페어링/잘못된 오리진 요청이 상태·명령에서 거부됨(수용 기준 3).
- **재접속 테스트**: 연결 끊김→복구→상태 복원(수용 기준 5).
- **다중 탭 테스트**: 두 클라이언트가 일관 상태 수신(§10).
- **에이전트 재시작 테스트**: 에이전트 재기동 후 프론트 재접속(§10).
- **페이로드 프라이버시/스키마 테스트**: 금지 필드 부재 스캔(수용 기준 7; 기존 카피/sanitize 테스트 패턴 확장).
- **프론트 테스트**: 브리지 hook/provider 상태 전이(vitest; 기존 `?raw`/유닛 패턴 재사용).
- **수동 로컬 QA**: macOS에서 실제 에이전트↔프론트 페어링·이벤트 육안 확인(라이브 마켓 없음).
- **no-marketplace 픽스처**: 모든 테스트가 합성 이벤트/페어링 픽스처로 동작(라이브 NAVER/ESM 불필요).

---

## 14. 마이그레이션 경로 (Migration path)

이 브리지가 **이후** 지탱하는 것(지금 끌어오지 않음):
- **Browser Projection V0(G2)**: 브리지 위에 저지연 프레임/입력 릴레이 채널 추가. §6에서 전송 어댑터를
  경계 뒤에 두면 SSE→WS 승격이 국소화된다. §8.3 금지 필드(좌표/URL) 완화는 그때의 [PO-DECISION].
- **가이드 NAVER 연결(G3)**: §8의 "사용자 행동 필요"·"수집 진행/결과" 이벤트가 단계 패널을 구동. 채널별
  flow 정의(Frontend Spec §16.3)를 이벤트 카테고리에 매핑.
- **자동 재로그인(G4)**: CredentialVault 어댑터(Runtime ADR §3.2)와 결합. 브리지는 "인증/세션 상태"·"사용자
  행동 필요" 이벤트만 이미 제공하므로 신규 이벤트 최소.
- **Windows 로컬 에이전트(G6)**: 전송을 Node 표준(§6 A/B 모두 OS 무관)으로 두면 브리지 서버는 재구현
  불필요, OS 의존은 페어링 저장/자동시작 어댑터로 국소화(Runtime ADR OS 어댑터 경계).
- **클라우드 관리형 런타임**: 로컬 브리지 계약(페어링·이벤트 카테고리)을 원격 세션 계약으로 일반화 —
  단 클라우드 실행은 미구현(Runtime ADR §3.5), 방향으로만.

---

## 15. 미해결 결정 (Open decisions)

> 모든 미해결 항목을 (1) 저장소 검증 가능 / (2) 외부 리서치 필요 / (3) 제품 오너 결정으로 분류. 가정으로
> 메우지 않는다.

### (1) 저장소 검증 가능 (repository-verifiable)
- `onConnectionSettled`가 settle-전용임은 **확인됨**(§2.1·§2.3). 남은 검증은 "브라우저 열림" 등 실행-중
  이벤트를 실시간 전달하려면 기존 settle-only seam + `EMIT_USER_ACTION` sink 위에 **스트리밍 seam 보강이
  필요한 범위** — `local-agent-runtime.ts`·`progressive-reconnect-runtime.ts` 정독으로 확정.
- `LocalAgentState` **11상태**(§8.1) → §8 카테고리 정확 매핑표 — 코드로 도출.
- 현행 dev 프론트가 `http://localhost` 호출에 실제로 성공하는 범위와, 브리지 오리진 후보(§2.3) — 코드·설정 확인.
- "취소/중지" 명령이 현행 수명 의미에서 안전한지(§9) — 오케스트레이터/런타임 정독(`REQUEST_CATCH_UP`은
  현재 기록만 되고 실행되지 않음 — `progressive-reconnect-runtime.ts:152-154`).
- Runtime ADR/current_state의 "12상태" 오기 정정(§2.4) — 정본 문서 별도 수정 필요.
- 페어링 거절 3코드(`pairing_busy`·`approval_unavailable`·`approval_declined`)의 **FE 구분 표시**(§0.2.3 (D)) —
  현재 `bridgeClient.requestPairing`은 모든 non-ok를 `unreachable`로 접는다(`bridgeClient.ts:160`, 확인됨).
  에이전트 측 코드는 이미 구분해 응답하므로 **FE 전용 슬라이스**로 분리 가능 — 각 코드의 문구는 PO 확인 필요.

### (2) 외부 리서치 필요 (external research)
- 로컬 브리지 보안 관용례: 오리진 검증·DNS-rebinding/로컬 CSRF 완화·페어링 토큰 엔트로피/수명·리플레이 저항(§5.2).
- HTTPS 프론트 → `http://localhost` 혼합 콘텐츠 회피(로컬 TLS/신뢰 인증서/`*.localhost` 정책, 브라우저 차이)(§2.3·§5.2).
- 페어링 비밀의 로컬 파일 안전 저장(Device Vault 부재 전제)(§5.2).
- SSE vs WebSocket 최종 선택이 G2 Projection 요구와 정합하는지의 기술 근거(§6).

### (3) 제품 오너 결정 필요 (product-owner)
- **전송 선택**(SSE+POST vs WebSocket) 확정 — §6 관찰은 갈림, 승인 필요(§6 제안은 확정 아님).
- 페어링 개시·**로컬 확인 UX 모델**(코드 입력? 에이전트 콘솔/트레이 승인?) 및 리보크 정책(§5.3).
- 다중 로컬 사용자 격리 요구 수준·개발 모드 페어링 완화 범위(§5.3).
- 업로드용 dev 계정을 리보크 가능 페어링 토큰으로 이관하는 시점(§5.3, Runtime ADR §7 (3)).
- "취소/중지" 명령을 이 슬라이스에 포함할지(§9) — (1) 검증 결과에 따라 PO가 최종 결정.

---

### 부록 — 근거 문서·파일
- 제품 원칙·현재/미래 경계: `docs/product-scope-v1.md` §1.2·§6.1·§7
- 프론트 상태·슬라이스: `docs/sellerops_frontend_spec.md` §16.7·§16.9·§17-B G1
- 런타임 경계·프론트↔에이전트 계약·미해결 과제: `docs/sellerops_local_agent_runtime_adr.md` §3.4·§4·§7
- 커넥터 레벨 연결 모드·정직성: `docs/multi-channel-connector-roadmap.md` §11·부록 A
- 현행 코드: `collector/src/cli/local-agent.ts`, `collector/src/agent/local-agent-runtime.ts`,
  `progressive-reconnect-runtime.ts`, `progressive-reconnect-chrome.ts`, `collector/src/profile.ts`,
  `collector/src/agent/local-agent-launch.ts`, `collector/src/connector/*`, `collector/src/**/log.ts`
- 프론트 통신 현행: `frontend/src/lib/apiClient.ts`, `frontend/vite.config.ts`
