# Pilot Release Closure v1

2026-09-05. `HEAD 7c86e314` 기준. **새 제품 기능 0** — 첫 외부 판매자 파일럿을 막는 것만 닫는다.
Chat · Reviews · Inquiries · Knowledge · Retrieval 알고리즘 · 승인 경계 · Guided 실행 fence는 **freeze**.

범위 밖(명시): 오래된 리뷰의 기간 변경 자동화 · 서명/공증 · Windows · GraphRAG · 새 Opportunity/Report 기능.

---

## 0. 먼저 — 직전 패키지의 보고 하나를 정정한다

`full_pilot_walkthrough_v1.md` §6과 그 CLAUDE.md 항목은 파일럿 필수 항목으로 이렇게 적었다:

> **Guided Reply는 dev bridge 전용이 아니어야 한다** — `VITE_AW_BRIDGE=1` + DEV에서만 런타임이 생기므로
> 판매자 빌드에서는 「직접 답변하고 기록하기」(복사)만 남는다.

**틀렸다.** 그 문장의 출처는 코드가 아니라 **낡은 주석**이었다 — `useReplyRuntime.ts`의 머리말이
「DEV + VITE_AW_BRIDGE」라고 적고 있었고, 실제 게이트는 그보다 앞선 패키지에서 이미 제거돼 있었다
(`replyBridge.ts`의 docblock이 「No longer DEV-gated」라고 적고 그 이유까지 남겨 두었다). 확인은 추론이 아니라
**production 빌드**로 했다: `npm run build` 산출물에 reply carrier 연결 경로(`expectedCarrier`)와 도우미 기본
포트와 가이드 라벨이 모두 살아 있다.

정정과 함께 **진짜 게이트**를 찾았고, 그것이 §2다: 문제는 런타임 코드가 아니라 **빌드가 만드는 CSP**였다.

기록 규칙대로, 낡은 주석은 고쳤고(`useReplyRuntime.ts`) 같은 실수가 다시 「blocker」로 보고되지 않도록
소스 스캔 테스트를 남겼다(`replyPilotCapability.test.ts`) — **문장은 이 질문에 대해 믿을 수 없고 소스는 믿을 수 있다.**

---

## 1. Production/pilot deployment

**이미 있는 것**(`deploy/pilot/`, Pilot Host Provisioning v1): compose overlay(raw 포트 공개 0 ·
`restart: unless-stopped` · Cafe24 callback/result URL과 runtime URL을 `PILOT_PUBLIC_HOST`에서 파생) ·
Caddy edge(자동 TLS, same-origin 라우팅) · `pilot.env.example`(이름만) · `host-bootstrap.sh` ·
`deploy.sh`(pull→env 검증→build→up(Flyway)→health→smoke) · `smoke.sh` · `egress-check.sh` ·
`backup.sh`/`restore.sh`.

**이 패키지가 더한 것 — 개발과 production 자격을 섞지 않게 만드는 검사들**(`deploy.sh`):

| 검사 | 왜 |
|---|---|
| 파일럿 env가 **체크아웃 밖**에 있어야 한다 | 저장소 안의 env는 언젠가 커밋된다. 기본값은 `/etc/sellerops/pilot.env`이고 0600이 이미 강제된다 |
| `PILOT_PUBLIC_HOST`가 `localhost`·`127.0.0.1`·`*.local`이면 거부 | 개발 이름으로 production을 배포하는 것은 자격이 섞이는 첫 단계다 |
| 여섯 모델 capability 각각 **켜졌으면 키가 있어야** 한다 | 백엔드 boot validator가 이미 거부하지만, 여기서 걸면 스택트레이스 대신 **변수 이름**이 나온다 |
| 도우미가 켜졌으면 `PILOT_HELPER_BRIDGE_URL`은 **loopback** | 도우미는 판매자 자기 컴퓨터에서 돈다. 원격 주소는 모든 판매자의 브라우저를 한 대의 도우미로 보내는 설정이고, 실수로 할 수 있는 종류의 설정이 아니다 |
| 도우미가 켜졌으면 **이 사이트용 도우미 패키지 빌드 명령**을 출력 | §2 |

**NAVER 고정 공인 IPv4 · 공개 HTTPS · Cafe24 callback**: 배포 경로는 전부 준비돼 있고 값만 비어 있다 —
`PILOT_PUBLIC_HOST`(A 레코드가 Elastic IP를 가리키는 이름) · `PILOT_ACME_EMAIL` ·
`SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS`(그 Elastic IP, `egress-check.sh`가 호스트와 컨테이너의
실제 outbound와 대조) · Cafe24 앱의 등록 redirect URI는 `https://<host>/api/connect/cafe24/callback`으로
compose가 **파생**하므로 별도 값이 아니다.

**이 저장소가 할 수 없는 것, 그리고 그 이유**: 인스턴스·Elastic IP·도메인·인증서는 **과금되는 실제 리소스**이고
계정 자격이 필요하다 — product-owner 입력이다. 필요한 것은 다섯 개뿐이다: ① AWS 리전과 계정 ② 도메인 이름
③ 인증서 알림 이메일 ④ Cafe24 앱의 client id/secret ⑤ NAVER 커머스 앱 자격. 그 다섯이 오면 `host-bootstrap.sh`
→ `pilot.env` 작성 → `deploy.sh` 순서로 끝난다(값은 저장소에 들어가지 않는다).

---

## 2. Guided Reply를 pilot build의 정식 capability로

**§0의 정정 뒤에 남는 진짜 게이트는 CSP다.** production 빌드는 `frontend/src/lib/security/csp.ts`가 만든
`<meta http-equiv="Content-Security-Policy">`를 싣고, 그 `connect-src`는 **`VITE_ENABLE_AGENT_BRIDGE=true`일
때만** 도우미 origin(http + ws)을 이름 짓는다. 켜지 않으면 브라우저가 도우미와의 통신을 거부하므로, 런타임
코드가 무엇을 하든 가이드 lane은 조용히 복사 경로로 떨어진다.

그래서 **dev 플래그를 production에 켜는 방식이 아니라, 이미 있는 capability 구조에 파일럿을 얹었다**:

- `frontend/Dockerfile`: `VITE_ENABLE_AGENT_BRIDGE` · `VITE_BRIDGE_URL` **ARG/ENV 추가**(기본값 비어 있음 = OFF).
- `deploy/pilot/docker-compose.pilot.yml`: `PILOT_GUIDED_HELPER_ENABLED`(기본 false) ·
  `PILOT_HELPER_BRIDGE_URL`(기본 loopback)에서 빌드 인자로 전달.
- `deploy/pilot/pilot.env.example`: 두 이름과, 켤 때 함께 해야 하는 일(§2-1)을 적었다.
- `smoke.sh`: **설정과 산출물의 일치**를 검사한다 — 켜져 있는데 서빙된 번들의 CSP가 도우미를 이름 짓지 않으면
  실패(그 조합은 프론트 이미지를 다시 빌드하지 않은 상태이고, 다른 어떤 검사도 잡지 못한다).

**`VITE_AW_BRIDGE`는 이것이 아니다** — 그것은 Operations 화면의 dev 어댑터 스위치이고 DEV 전용이며 파일럿과
무관하다. 두 이름이 비슷해서 §0의 오독이 생겼으므로 Dockerfile 주석과 테스트가 그 구분을 적어 둔다.

**승인/제출 barrier 무변경**: 이 항목은 브라우저가 도우미와 말할 수 있게 만들 뿐이다. 단일 사용 승인 · 신원 검사 셋 ·
`.click(` 한 파일 한 번 · `.fill(` 한 파일 · `WAIT_FOR_SUBMIT`에서의 종료는 그대로다.

### 2-1. 도우미 패키지는 사이트별 산출물이다

`tools/helper/build-macos.sh`가 `REVIEWNARY_APP_URL` / `REVIEWNARY_BASE_URL`을 **`BUILD.txt`에 스탬프**하고,
`설치.command`가 그것을 읽어 `helper.env`(0600)의 `BRIDGE_ALLOWED_ORIGINS`·`SELLEROPS_APP_URL`·
`SELLEROPS_BASE_URL`로 쓴다. 이전에는 설치 시점의 env 변수만 봤으므로 — 판매자가 더블클릭하면 그런 변수가 없다 —
모든 설치본이 **판매자 자기 컴퓨터의 localhost**를 가리켰고, 도우미는 있지도 않은 백엔드에 말을 걸며 아무도 쓰지
않는 origin의 페어링만 받아들였다. 판매자에게는 「서버 연결 확인 필요」로만 보인다. 스탬프가 없는 옛 패키지는
예전처럼 로컬 기본값으로 떨어진다.

---

## 3. Retrieval v2 — 파일럿 org에서만 켠다

**global default는 OFF 그대로**(`application.yml`의 세 `enabled: ${...:false}`). 감사 결과 파일럿에 필요한 배관은
이미 있었다: 세 capability 각각 자기 flag·키·명시 org 목록을 갖고, 조직 질문은 `AgentCapabilityAccess` 하나에
묻는다(Retrieval Runtime Closure v1 §5). 그래서 파일럿 설정은 **두 줄짜리 결정**이다:

1. 배포에서 셋을 켠다 — `SELLEROPS_KNOWLEDGE_{EMBEDDING,INTENT,ELIGIBILITY}_ENABLED=true` + 각자의 `_API_KEY`
   (키가 없으면 `deploy.sh`가 이름을 대고 멈추고, 그래도 지나가면 백엔드 boot validator가 거부한다).
2. **어느 조직인가**는 이미 정해진 정책이 답한다 — 파일럿은 `SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS`,
   즉 **채널을 연결한 조직**. 판매자 UUID를 env에 붙여넣고 재기동하는 온보딩(그 사이 다른 판매자가 전부 죽는다)을
   피하려고 만든 정책이고, 정확히 한 조직만 원하면 `SELLEROPS_KNOWLEDGE_*_ORG_IDS`가 그 위에 남아 있다.
   정책은 **넓히기만 하고 조직 질문만** 넓힌다 — flag도 키도 덮지 못한다.

### 3-1. 벤더로 나가는 것 — 세 capability의 payload 경계

각 줄은 이 저장소의 **직렬화 바이트 단언 테스트**가 지키는 것이고, 그 테스트 이름을 함께 적는다.

| capability | 나가는 것 | 나가지 않는 것 | 고정하는 테스트 |
|---|---|---|---|
| `knowledge.embedding` | 모델 · 차원 · 임베딩할 **텍스트 배열** 셋뿐. 텍스트는 (a) **판매자 문단**(org당 1회, 내용 주소 캐시) 또는 (b) **고객 질문**(검색 1회분, 저장 안 함) | 조직/상품/고객 식별자, 문의·리뷰 메타데이터, 판매자 문장의 두 번째 사본 | `KnowledgeEmbeddingPayloadFloorTest` |
| `knowledge.intent` | **고객 문장 하나** — 「무엇을 알아야 답하는가」로 되쓰기 위해 | 판매자 문단, 상품·주문·회사 정보. 판매자가 직접 친 검색어는 **사지 않는다**(자기 어휘를 쓰고 있으므로) | `KnowledgeQuestionIntentPayloadFloorTest` |
| `knowledge.eligibility` | **고객 문장 + 순위에 오른 판매자 문단**(최대 6, 위치로만 참조) — 셋 중 가장 넓은 payload라 자기 flag·자기 키 | 문서 제목 밖의 메타데이터, 고객·주문 식별자. 출력은 **boolean 하나**(거절 전용) | `KnowledgeEligibilityPayloadFloorTest` |

**저장되는 생성물은 없다** — intent 재진술은 고객 문장의 파생 사본이라 표도 컬럼도 만들지 않고 5분 메모에만 살며,
eligibility의 결과는 boolean이다. 저장되는 유일한 것은 **판매자 문단의 벡터**이고, 그 키는 내용 주소
(`org, model, dimensions, sha256`)라 문서를 고치면 새 키가 되고 되돌리면 옛 키에 적중한다. **질문 벡터는 DB에
넣지 않는다.**

**정직하게 이름 붙이는 노출**: 이 셋을 켜면 **모든 검색에서 고객의 질문이 벤더로 나간다**. 오늘 `NO_ANSWER_BASIS`
초안과 판매자의 검색 상자는 모델을 0회 부른다 — 그러니 이것은 넓히기이고, 그래서 **머지가 아니라 배포 결정**이다.
그리고 redaction은 lane이 물려준다: 리뷰는 `redactFullBody`를 지나고 문의는 `toPlainText`뿐이다(이 패키지가 만든
노출이 아니고, 초안 capability가 이미 그 텍스트를 보낸다 — 그대로 보고한다). 세 capability는 여전히 **판매자 일일
AI 예산 밖**이고, 그 결정도 그대로다.

---

## 4. 실행할 수 없는 리뷰의 UX

**결함은 「이유가 없다」가 아니라 「막다른 길」이었다.** 감사에서 실제 동작이 이랬다: 취득 계보가 없는 리뷰에도
`canStartSubmissionRun`이 참이라 **「네이버에서 직접 답변하기(가이드)」 버튼이 그대로 보였고**, 누르면 서버가
대상 mint를 거절해 「**답변 준비를 시작하지 못했습니다. 다시 시도해 주세요.**」가 떴다 — 성공할 수 없는 재시도를
권하는 오류. 직전 walkthrough는 이것을 「이유 없이 복사 경로로 떨어진다」로 적었는데, 실제로는 **누르기 전까지
떨어지지도 않았다.**

- **서버가 규칙을 한 번만 말한다**: `canStartSubmissionRun`이 이제 mint가 쓰는 것과 **같은 조건**
  (`ExecutableIdentity.MARKETPLACE`)을 포함하고, 왜 없는지를 닫힌 어휘로 함께 보낸다 —
  `guidedUnavailableReason`: `SOURCE_NOT_EXECUTABLE` · `CHANNEL_ALREADY_ANSWERED` · null.
- **`null`은 「아직 승인 전」이다** — 승인할 것이 남아 있는 판매자는 「가이드가 왜 없지」를 묻고 있지 않다.
  묻지 않은 질문에 답하는 것이 화면이 시끄러워지는 방식이다.
- **화면은 그 결정을 읽는다**(재도출하지 않는다): 이전에는 `channelReplyState === "ANSWERED"`를 클라이언트가
  다시 계산했다. 이제 문장 하나가 서버의 이유로 결정되고, **문구는 그대로 옮겨 왔다**(옳은 문장이었다).
- **내부 어휘는 화면에 없다**: `provenance` · `MARKETPLACE` · `취득 계보` · 코드 토큰 **0**(테스트가 단언).
  판매자가 읽는 것은 사실과 다음 걸음이다 — 「이 리뷰는 판매자센터 화면에서 찾아 드릴 수 없어요. 채널 연동으로
  가져온 리뷰만 안내할 수 있습니다. 아래 답변을 복사해 판매자센터에서 직접 등록해 주세요.」 그리고 **[복사]는
  그대로 그 자리에 있다.**

Demo Org 기준 리뷰 4,455건 중 `MARKETPLACE` identity는 **115건**이므로, 이 문장이 보이는 것이 파일럿의 정상
상태다. 계보를 넓히는 방법은 하나 — 가이드형 수집으로 가져오는 것 — 이고 그것은 이 패키지 밖이다.

---

## 5. 아직 외부 판매자를 막는 것

1. **호스트가 없다** — 고정 공인 IPv4 + 공개 HTTPS. 코드가 아니라 프로비저닝이고 §1의 다섯 입력이 필요하다.
2. **Cafe24 앱 자격과 NAVER 커머스 앱 자격**이 파일럿 호스트 이름으로 등록돼 있어야 한다(값은 저장소 밖).
3. **첫 연결의 라이브 증명은 아직 없다** — Disconnected Channel Onboarding v1이 `UNPROVEN_BY_NO_SAFE_TEST_ACCOUNT`로
   닫힌 그대로이고, 첫 실제 판매자의 첫 연결이 그 증명이 된다.
4. **오래된 리뷰의 기간 확대는 판매자의 손**으로 남는다(범위 밖으로 명시됨; `full_pilot_walkthrough_v1.md` §5-7).

**막지 않는 것**(이번에 닫혔다): 가이드 lane이 파일럿 빌드에서 꺼져 있던 것 · 도우미 패키지가 로컬을 가리키던 것 ·
retrieval 파일럿 설정이 이름조차 없던 것 · 실행 불가 리뷰의 막다른 버튼.

---

## 6. 검증

- backend **3,878 tests / 실패 0**(전체) — `*ReviewReply*`(새 테스트 4건: 복사 경로 안내 · 두 이유의 구분 · 승인 전 침묵 ·
  identity를 고정한 copy-gate) · frontend **234 files / 2,760 tests / 실패 0**(VocItemReplyPrep 44 · 새 `replyPilotCapability` 4) · `tsc` clean.
- **production 빌드 실측**: 플래그 없이 `connect-src 'self' http://127.0.0.1:8787`, 플래그와 함께
  `… http://127.0.0.1:47615 ws://127.0.0.1:47615` — §2의 스위치가 실제로 산출물을 바꾼다.
- **로컬 라이브 스모크(§4)**: 백엔드를 새 클래스로 재기동한 뒤 실제 Demo Org에서 두 리뷰를 열었다 —
  계보 없는 `3d3c9c65`는 버튼이 `[승인 해제]`·`[복사]`뿐이고 「이 리뷰는 판매자센터 화면에서 찾아 드릴 수 없어요…
  아래 답변을 복사해 판매자센터에서 직접 등록해 주세요.」가 뜨며, 계보 있는 `471cf8ef`는 `[네이버에서 직접
  답변하기(가이드)]`가 그대로 있다(게이트가 과하게 조여지지 않았다). 두 화면 모두 내부 어휘 **0** · off-host 요청 **0**.
- `deploy.sh` · `smoke.sh` 문법 검사 통과. **파일럿 호스트가 없으므로 그 위에서의 실행은 하지 않았다**(할 수 없다).
- **마켓플레이스 호출 0 · WRITE 0 · submit 0 · 모델 호출 0 · 마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행 없음.
- **계약이 바뀌어 테스트 3건을 다시 썼다**: 두 backend 테스트는 이제 identity를 고정한 채 각자의 게이트를 읽고
  (약화 0 — 오히려 새 조건에 대한 단언이 늘었다), FE의 「채널이 이미 답변함」 fixture는 서버가 보내는 이유를 싣는다.

---

## 7. Context Integrity Gate (2026-09-05, 프로비저닝 직전 점검)

과금 리소스를 만들기 전에 네 가지만 다시 확인했다. 하나는 **문제가 아니었고**(증명), 셋은 **진짜 gap이라 고쳤다**.

### 7-1. Runtime topology — `127.0.0.1:8787`은 stale allowance도, 런타임 의존성도 아니었다

§6이 인용한 `connect-src 'self' http://127.0.0.1:8787`은 **`VITE_AGENT_RUNTIME_URL`을 주지 않은 빌드**의
코드 기본값이다(`agentClient.ts` 한 곳이 그 변수를 읽고, CSP는 같은 값을 미러링한다). 파일럿 overlay는 그것을
`https://${PILOT_PUBLIC_HOST}/agent-runtime`으로 굽고 edge가 prefix를 떼어 runtime으로 보낸다.

파일럿 모양으로 실제 production 빌드를 돌려 **산출물에서 읽었다**:

```
connect-src 'self' https://pilot.example.test http://127.0.0.1:47615 ws://127.0.0.1:47615
번들 전체 grep '127.0.0.1:<port>' → 47615 만 13회, 8787 은 0회
```

즉 의도한 그래프 그대로다 — 브라우저는 **공개 HTTPS 하나**와, 판매자 자기 컴퓨터의 **도우미 loopback**
(그 스위치를 켰을 때만)에만 말한다. `VITE_API_BASE_URL=""`이라 `/api`는 same-origin이고 CSP에 별도 origin이
생기지 않는다. 도우미를 끄면 그 두 줄이 사라진다(번들 문자열에는 기본값이 남지만, 이름을 짓지 않은 origin은
브라우저가 거부한다 — 그것이 이 게이트의 작동 방식이다).

**고친 것은 코드가 아니라 검사다.** 이 실수는 오직 「overlay 없이 이미지를 빌드했다」로만 일어나고, 그때
증상은 판매자 브라우저가 **자기 컴퓨터**를 agent-runtime으로 부르는 것이며 화면에는 「AI 도우미를 시작하지
못했습니다」로만 보인다 ⇒ `smoke.sh`가 **서빙된 페이지의 CSP**에서 두 가지를 단언한다: loopback
agent-runtime이 **없을 것**, 그리고 이 사이트 자신의 origin을 **이름 지을 것**. 유일하게 허용되는 loopback은
도우미이고 그 검사는 이미 있었다.

### 7-2. Retrieval rollout — `CONNECTED_SELLERS` 자동 확대를 이 셋에서 **되돌렸다**

감사 결과 결함이 맞았다: `SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS`(파일럿 값)에서
`AgentCapabilityAccess.decide()`가 **일곱 capability 전부**의 org 질문에 답하므로, 세 retrieval capability는
flag+key만 있으면 `*_ORG_IDS`가 비어 있어도 **연결한 모든 판매자**에게 적용된다. 즉 새 판매자가 **연결했다는
이유만으로** 자기 고객의 질문이 벤더로 나가는 대상이 된다.

이것은 `retrieval_runtime_closure_v1.md` §5가 내린 결정의 **반대**이고, 되돌리는 이유를 그대로 적는다. 그 §5가
닫은 함정(「켜졌고 키도 있는데 아무에게도 닿지 않고 아무 말도 없다」)은 **진짜였고 seam도 옳았다**. 틀린 것은
그 seam이 여기서 낸 **답**이다 — `CONNECTED_SELLERS`의 뜻은 「채널을 연결한 판매자는 **Agent를** 쓸 수 있다」이고,
이 셋은 Agent가 아니다. OAuth 동의를 마친 판매자가 요청한 것은 **수집**이지 고객 문장의 외부 처리가 아니다.

- `AgentCapabilityGate.admitsPolicyWidening()` (기본 `true`) — 세 knowledge properties가 **`false`로 override**.
  `decide()`는 capability 자신의 목록으로 먼저 판정한 뒤, widening을 거절한 capability에는 scope를 적용하지 않는다.
  **좁히는 방향으로만 작동한다**: scope가 admit하지 않을 org를 여기서 admit할 방법은 없다.
- **함정은 widening이 아니라 거절로 닫는다** — `PilotConfigValidator`가 이제 「켜짐 + 키 있음 + 이름 지은 조직 0」을
  **모든 scope에서** 기동 거부하고, 조언도 다르다(`…_ORG_IDS`를 말하지 `CONNECTED_SELLERS로 설정하세요`라고
  말하지 않는다 — 이 capability에는 그것이 아무 일도 하지 않는 조언이다). 침묵이 결함이었고, 답은 거절이다.
- `deploy.sh`가 같은 것을 **변수 이름으로** 먼저 잡고, `*_ORG_IDS=*`도 거부한다(파일럿의 답이 아니다).
- global default는 그대로 **OFF**. `*` wildcard는 capability **자신의 목록**이 「전부」라고 말하는 것이라 이 변경과
  무관하고 그대로 동작한다.
- plan / draft / judge / report는 **무변경** — `CONNECTED_SELLERS`가 계속 답하고, 파일럿 판매자를 추가하는 데
  env 편집도 재기동도 필요 없다.

### 7-3. Production auth/env inventory — 네 이름이 컨테이너에서 **보이지 않았다**

`SocialLoginConfiguration`은 `SELLEROPS_OAUTH_{GOOGLE,NAVER}_CLIENT_{ID,SECRET}`을 읽는데,
`docker-compose.yml`의 backend `environment:`에도 두 env 예시에도 **하나도 없었다** — Agent capability가 겪은
것과 **같은 결함 종류**(Pilot Runtime Foundation v1 §3): 호스트 env 파일에 아무리 정확히 써도 컨테이너가 볼 수
없다. 이름만 추가했다(값 없음 = 그 provider는 존재하지 않음 = 이메일/비밀번호 로그인 그대로).

혼동하면 안 되는 **네 가지, 서로 다른 것**:

| | 무엇 | 변수 | 콘솔 | callback / 등록 대상 |
|---|---|---|---|---|
| A | **Google 소셜 로그인** (판매자 로그인) | `SELLEROPS_OAUTH_GOOGLE_CLIENT_ID` · `_SECRET` | Google Cloud Console | `https://<host>/login/oauth2/code/google` |
| B | **NAVER 소셜 로그인** (판매자 로그인) | `SELLEROPS_OAUTH_NAVER_CLIENT_ID` · `_SECRET` | NAVER Developers | `https://<host>/login/oauth2/code/naver` |
| C | **NAVER 커머스 API** (스토어 수집) | `SELLEROPS_CONNECTOR_NAVER_ENABLED` · `_ADVERTISED_EGRESS_IPS` | 네이버 커머스API 센터 | callback 없음 — **호출 IP 등록**(이 호스트의 고정 IPv4) |
| D | **Cafe24** (연결·수집·답변) | `SELLEROPS_CONNECTOR_CAFE24_ENABLED` · `_CLIENT_ID` · `_CLIENT_SECRET` · `_API_VERSION` | Cafe24 Developers | `https://<host>/api/connect/cafe24/callback` (overlay가 파생, **byte-identical** 등록 필요) |

A·B는 판매자 **로그인**이고 C·D는 판매자 **채널**이다. B와 C는 둘 다 「NAVER」이지만 콘솔·자격·등록 대상이
전부 다르고, 서로의 값을 넣으면 조용히 실패한다. 쿠팡은 **판매자가 제품 화면에서 직접 입력**하므로 호스트 env에
자격이 없다(플래그뿐). 값은 이 저장소에 넣지 않는다.

### 7-4. Clean production data — 게이트는 있었고, 두 칸이 비어 있었다

`MockDataSeeder`는 셋으로 나뉘어 있고 데모 콘텐츠는 데모 조직 **안에** 중첩돼 있다(`enabled=false`면 둘 다
꺼진다). 채널 카탈로그는 자기 플래그(기본 true)로 **제품 참조 데이터**라 남는다 — 그것이 없으면 「채널 연결」
화면이 설 자리가 없다. 데모 조직은 `organizations.count()==0`에서만 심어지므로 판매자가 있는 DB에는 나타날 수
없다. compose는 세 이름을 전부 통과시키고, `pilot.env.example`은 셋 다 `false`, `smoke.sh`는 배포된 호스트에서
`/api/auth/demo/config`가 `enabled:false`인지 확인한다.

비어 있던 두 칸을 `deploy.sh`에 채웠다: **`SELLEROPS_SEED_DEMO_CONTENT=true` 거부**와
**`SELLEROPS_CONNECTOR_MOCK_ENABLED` / `_MOCK_FALLBACK_ENABLED=true` 거부**. 후자가 중요한 이유는 이미
기록돼 있다 — mock 커넥터는 실패하지 않고 **성공하며** 합성 행을 `data_origin=REAL`로 써서 이후 판매자 행과
분리할 수 없다(기동 거부가 둘이 아직 구분 가능한 마지막 순간이다; 실제 커넥터와 **함께** 켜면
`PilotConfigValidator`가 이미 거부한다).

**로컬 Demo DB를 production으로 복사하는 경로는 만들지 않았다.** `backup.sh`/`restore.sh`는 그 호스트 자신의
볼륨을 대상으로 하고, `deploy.sh`는 어떤 덤프도 복원하지 않는다. 파일럿 DB는 **빈 볼륨 + Flyway**로 시작한다.

### 7-5. 이 게이트에서 하지 않은 것

AWS 리소스 생성 0(리전·도메인 미확정). 실제 파일럿 호스트가 없으므로 `deploy.sh`/`smoke.sh`는 **문법 검사와
로컬 dry-run 성격의 확인**까지이고, 그 위에서의 실행은 호스트가 생긴 뒤다.
