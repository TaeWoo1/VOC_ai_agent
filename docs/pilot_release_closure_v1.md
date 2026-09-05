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
