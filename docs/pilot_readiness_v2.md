# Pilot Readiness v2 — 첫 외부 판매자를 받을 수 있는가

**날짜:** 2026-09-13 · **판정: `READY_PENDING_HOST`**
**마이그레이션 0 · 마켓플레이스 0 · WRITE 0 · 모델 0 · AWS 리소스 생성 0**

Pilot Readiness Gate v1이 `NOT_PILOT_READY`로 닫으며 남긴 blocker는 하나였다 —
「고정 공인 IPv4 + 공개 HTTPS Cafe24 callback을 가진 호스트가 없다」. 이 문서는 그것을 **둘로 쪼개고**,
그중 하나가 첫 파일럿에 필요하지 않다는 것을 코드로 증명한다.

---

## 1. Blocker는 하나가 아니라 둘이었고, Cafe24 파일럿에는 하나만 필요하다

| 요구 | 누가 요구하나 | 무엇에 대한 것인가 | Cafe24-only 파일럿에 필요한가 |
|---|---|---|---|
| 안정적인 공개 **HTTPS 호스트 이름** | Cafe24 OAuth | **인바운드** — Cafe24가 도달할 redirect URI | **예** |
| 고정 공인 **IPv4** | NAVER Commerce | **아웃바운드** — 판매자가 등록할 호출 IP | **아니오** |

둘은 서로 다른 방향의 요구이고 서로 다른 채널의 것이다. 코드가 그렇게 말한다 —
`PilotConfigValidator`의 IP 조건은 `naverEnabled && blank(...)`이고, `deploy.sh`의 조건도
`NAVER on but ADVERTISED_EGRESS_IPS blank`다. Cafe24가 요구하는 것은 callback이 **절대 URL · 비-loopback
호스트 · HTTPS**라는 것뿐이고, 그것은 TLS를 가진 안정적인 호스트 이름이면 충족된다. 고정 IP는 그 문장에
등장하지 않는다.

**증명은 논증이 아니라 테스트다** — `PilotConfigValidatorTest`:

- `cafe24OnlyPilotStartsWithoutAnyAdvertisedEgressIp` — Cafe24만 켜고 egress IP를 비운 배포가
  **문제 0개**로 기동한다.
- `addingNaverToThatSamePilotIsRefusedUntilTheCallIpIsKnown` — 같은 배포에 NAVER를 더하는 순간 거부된다.

그리고 이것은 이미 내려진 제품 결정과 맞는다 — **PRIMARY 온보딩 채널은 Cafe24**다(판매자가 낼 것이
mall id 하나 · 로컬 도우미 불필요 · 인가 전체가 철회 가능한 동의). 즉 **EIP 프로비저닝은 파일럿을
시작하기 위한 전제가 아니라 NAVER를 추가하기 위한 전제**다.

**남은 것은 코드가 아니다**: 안정적인 공개 HTTPS 호스트 이름 하나(DNS + ACME가 닿는 :80/:443)와
그 이름으로 등록된 Cafe24 앱. `deploy/pilot/`은 그 호스트를 받을 준비가 되어 있다(§2).

## 2. Deployment topology — 이미 있고, 이번에 네 칸을 메웠다

`deploy/pilot/` 9개 파일: compose overlay(`ports: !reset []`로 raw port 공개 0) · Caddy edge(자동 TLS ·
same-origin `/api`·`/agent-runtime`·SPA) · `deploy.sh`(pull→env 검증→build→up→health→smoke) ·
`smoke.sh`(16개 검사, credential 0 · WRITE 0) · `backup.sh`/`restore.sh` · `egress-check.sh` ·
`host-bootstrap.sh` · `pilot.env.example`.

이번에 닫은 **설정 표면 결함 넷** — 전부 「배포가 해야 하는 일을 할 수 없거나, 하면 안 되는 일을 조용히
할 수 있는」 모양이고, 제품 의미는 하나도 바뀌지 않았다:

| 결함 | 왜 문제인가 | 고친 방법 |
|---|---|---|
| `SELLEROPS_AGENT_{PLAN,DRAFT,JUDGE,CONVERSE,REPORT}_ORG_IDS=*`를 `deploy.sh`가 거부하지 않았다 | `*`는 「이 백엔드의 모든 org」다. 세 retrieval capability에 대해서는 이미 거부하고 있었고 **이 비대칭은 결정이 아니었다** | 같은 거부를 다섯에 적용 |
| `SELLEROPS_AGENT_ACCESS_SCOPE=ALL_ORGS`도 거부되지 않았다 | `application.yml` 스스로 「공유 백엔드에서는 쓰지 말라」고 적어 둔 단일 사용자 자세다 | 파일럿에서 `ALLOW_LIST`/`CONNECTED_SELLERS`만 허용 |
| `SELLEROPS_VAULT_KEY_RING`이 컨테이너 env에 **도달하지 못했다** | `CredentialVault`·`VaultKeyRing`은 rotation을 완전히 지원하는데, 이름이 닿지 않아 **배포된 호스트에서 키 교체가 불가능**했다 — key id를 바꾸는 순간 모든 자격이 `KEY_MISMATCH` | compose와 템플릿에 이름 추가(값 0) |
| `SELLEROPS_MAIL_MODE`가 닿지 않았고 `dev-outbox`를 막는 것도 없었다 | 그 모드는 **비밀번호 재설정 링크를 포함한 메일 전문을 INFO 로그에 쓴다** | 이름을 닿게 하고(기본 `off`) 파일럿에서 `dev-outbox`를 거부 |
| `SELLEROPS_AGENT_REPORT_*`가 `deploy.sh` 검증 대상인데 템플릿에 없었다 | 켜려는 운영자가 베낄 이름이 없었다 | 템플릿에 세 줄 추가 |

## 3. 점검 결과

### org isolation — **통과, 그리고 결함 하나를 고쳤다**

`AuthPrincipal(userId, orgId, email)`은 JWT에서만 오고, **요청 본문·쿼리에서 orgId를 받는 엔드포인트는
저장소 전체에 0개**다. `JwtAuthFilter`는 org가 실제로 존재하는지까지 확인해 삭제된 org의 토큰을
**인증하지 않는다**(빈 읽기로 통과시키지 않는다).

**실측**: 새로 가입한 다른 org의 토큰으로 Demo Org의 이슈·리뷰·계정·decision-context·decision-log를
찔러 6개 경로 전부 데이터 0. 그런데 **두 경로가 404가 아니라 500**이었다 —
`ReviewIssueQueryService.requireIssue`와 `ReviewIssueLifecycleService.require`가
`IllegalArgumentException`을 던지는데 그것을 매핑하는 핸들러가 없다.

**샌 것은 없다**(둘 다 아무것도 돌려주지 않는다). 대가는 다른 데 있었다 — 자기 것이 아닌 페이지를 연
판매자가 「없습니다」가 아니라 **크래시**를 보고, ERROR 수를 지켜보는 파일럿 운영자가 **일어나지 않은
장애**를 본다. 삭제된 이슈로 가는 오래된 북마크도 같은 500이다. ⇒ `ApiException.notFound`로 고쳤고,
이미 「absent rather than forbidden」이라 이름 붙어 있던 테스트가 이제 **상태 코드까지** 단언한다.
실측 500 → **404**, 자기 org는 200, 백엔드 ERROR **0**.

### credential · logs · backup

- 자격은 `CredentialVault` 하나가 org 범위 질의로 읽고 쓰며, 봉투 암호화(AES-256-GCM, 자격마다 새 DEK)에
  **fingerprint**로 키를 확인한다. 키가 없으면 기동은 되지만 비밀을 만지는 모든 연산이 닫히고,
  **커넥터를 켠 채 키가 없으면 기동이 거부된다**.
- 로그에 고객 문장도 자격도 나가지 않는다. 벤더로 나가는 payload는 capability마다 **바이트 단위 floor
  테스트**가 있다(13개).
- 백업은 `pg_dump -Fc` + 14일 보관이고 **env secret은 들어 있지 않다** — 복원에는 같은 마스터 키가
  필요하고, 다르면 `KEY_MISMATCH`로 아무것도 열리지 않는다.

### demo-only 전제 — **이미 안전한 기본값**

`seed.enabled` **false** · `seed.demo-content` **false** · `seed.demo-entry` **false**(enabled를 따름) ·
`connector.mock.enabled` **false** · `mock-fallback.enabled` **false**. 유일한 기본 ON은
`seed.channel-catalogue`이고 그것은 제품 참조 데이터다(없으면 채널 연결 화면에 내밀 것이 없다).
`deploy.sh`는 이 다섯 중 넷을 파일럿에서 **다시 거부**하고, `smoke.sh`는 서빙된 배포에서
`/api/auth/demo/config`가 `"enabled":false`인지 확인한다.

### onboarding

가입은 org + user 두 행만 만든다(자격도 계정도 만들지 않는다). `CONNECTED`가 처음 쓰이는 곳은 셋뿐이고
전부 서로 다르다 — 파일 업로드는 즉시, NAVER·Coupang은 **자격 테스트만으로는 되지 않고 주문 수집이
성공해야** 하며, Cafe24는 OAuth 완료 시점이다.

**그래서 `CONNECTED_SELLERS` scope에서는 가입과 첫 수집 사이에 Agent lane이 꺼져 있다**(그 사이 판정은
`NEEDS_CHANNEL_CONNECTION`). 결함이 아니라 정의이고, 파일럿 안내에 적어야 하는 사실이다.

## 4. Core loop E2E smoke — 실행함

실제 Demo Org, 커넥터·스케줄러·프로액티브·시드·모든 AI capability **OFF**. **acquisition은 포함하지
않았다** — 커넥터가 꺼져 있고 라이브 마켓플레이스 실행은 단일 사용 승인이 필요하다. 취득은 자기 증거를
갖고 있고, 여기서 증명한 것은 **취득 이후의 고리**다.

| # | 단계 | 결과 |
|---|---|---|
| 1 | **Home** | 「아직 판단하지 않은 리뷰가 **13건**」 + 행 |
| 2 | 행 클릭 → **Decision Workspace** | `/reviews/{account}/reply/{id}` 「리뷰 처리」, tier·고객 문장·판단 영역 present |
| 3 | **판단 기록** | 「대응 필요」 눌림 |
| 4 | 근거가 있는 리뷰의 **반복 신호** | 「접착 부족」 → `/memory/{issueId}` |
| 5 | **Repeated Issue** | 분모 3행(1,761중 16 · 416중 1 · 786중 1) · 별점 분포 · 우리가 써 둔 것 · 판단과 조치 · 기록 |
| 6 | 이슈 → 리뷰 **왕복** | `/reviews/reply/{다른 근거 리뷰}` 「리뷰 처리」 |
| 7 | **Home 재방문** | 13 → **12** |

**7번이 이 스모크의 요점이다** — 워크스페이스에서 내린 판단이 Home의 숫자를 움직였다. 고리가 닫힌다.
콘솔 오류 0 · off-host 0.

## 5. Instrumentation — 네 가설은 새 계측 0, 다섯 번째는 결정이 필요하다

`docs/pilot_usage_loop_v1.md` **§6**에 리뷰·판단·반복 문제 lane의 질의를 더했다(전부 Demo Org에서
**실행 검증**). 요약:

| 가설 | 답하는 durable row | 새 계측 |
|---|---|---|
| NEEDS_ATTENTION을 처리하는가 | `review_triage` × tier 식 | **0** |
| correction/decision/action을 남기는가 | 세 audit 표 | **0** |
| repeated issue를 확인하는가 | `review_issue_state_events` (`actor='OPERATOR'`) | **0** |
| BYO Aside 없이 Core를 쓰는가 | 판단 × `sync_jobs.method` | **0** |
| **Home을 다시 여는가** | — | **결정 필요** |

**다섯 번째만 답이 없다.** 서버에 로그인/세션 기록이 **없고**(`users`에 `last_login_at`이 없다),
프론트의 analytics는 **env가 없으면 sink가 없어 `track`이 no-op**이며 sink는 분석 동의 뒤에만 시작한다.
즉 오늘 화면 재방문은 **측정되지 않는다**. 선택지는 외부 sink를 켜는 것(판매자 행동이 제3자 벤더로
나간다)과 서버에 최소 신호를 만드는 것(사람의 행동을 저장하는 새 사실) 둘이고, **둘 다 배포·프라이버시
결정이라 아무것도 만들지 않았다**. 그때까지 재방문은 **active day(운영 행위가 있은 날)**로만 보인다.

## 6. 판정 — `READY_PENDING_HOST`

**코드 쪽에 남은 파일럿 blocker는 없다.** 남은 것은 셋이고 전부 저장소 밖이다:

1. 안정적인 공개 **HTTPS 호스트 이름** + DNS + ACME가 닿는 :80/:443 (과금 리소스)
2. 그 이름으로 등록된 **Cafe24 앱** 자격(등록 redirect URI가 byte-identical해야 한다)
3. 파일럿 org id를 담은 `/etc/sellerops/pilot.env` (0600, 체크아웃 밖)

**고정 공인 IPv4는 여기 없다** — NAVER를 켜는 날의 전제다(§1).

## 7. 고치지 않고 보고

- **마이그레이션 롤백 경로가 없다.** 97개 마이그레이션에 undo 스크립트 0, Flyway는 forward-only이며
  `out-of-order`는 꺼져 있고 `validate-on-migrate`는 켜져 있다(불일치 시 **기동 실패** — 조용히 틀리지
  않는다는 점은 좋다). 그리고 **CI가 마이그레이션을 검증하지 않는다**(백엔드 스위트는 H2 + Flyway
  disabled). 오늘의 롤백 이야기는 「마지막 덤프를 복원하고 같거나 더 새로운 커밋으로 재배포」뿐이다.
  → §8 결정 1.
- **`baseline-on-migrate: true`**는 `flyway_schema_history`가 없는 비어 있지 않은 스키마를 만나면
  baseline을 잡고 그 아래 마이그레이션을 **조용히 건너뛴다**. 덤프 복원에서는 무해하지만(덤프에 이력표가
  들어 있다) 손으로 만든 DB에서는 부분 마이그레이션 상태로 기동한다.
- **`PilotConfigValidator`는 Cafe24 redirect 호스트가 `PILOT_PUBLIC_HOST`와 같은지 확인하지 않는다** —
  https·비-loopback만 본다. `PILOT_PUBLIC_HOST` 모양 검사는 `deploy.sh`에만 있어
  `docker compose up`으로 직접 띄우면 건너뛴다.
- **mock connector는 여전히 설정되지 않은 모든 채널의 기본 resolution 대상**이고
  `mock-fallback.enabled=false`만이 실제로 서빙되는 것을 막는다. 그 행들은 `DEMO_SEED`가 아니라
  **`data_origin=REAL`로 들어와** `DataOrigin`으로 되돌릴 수 없다.
- **일반적인 화면 열람 계측이 DB에 없다** — `proactive_case.surfaced_at/opened_at` 하나뿐.
- `DevOutboxMailer`는 메일 전문을 INFO로 남긴다. 기본값 `off`이고 이제 `deploy.sh`가 파일럿에서
  `dev-outbox`를 거부하지만, **그 로깅 자체는 그대로 둔다**(개발 도구로서는 그것이 용도다).

## 8. PRODUCT_DECISION_NEEDED

1. **마이그레이션 정책.** forward-only를 명시적 정책으로 적을 것인가, 아니면 되돌릴 수 있는
   마이그레이션 규칙과 CI 검증을 만들 것인가. 오늘은 둘 다 없고 관행만 있다.
2. **재방문을 무엇으로 잴 것인가** — 외부 analytics sink를 켤 것인가, 서버에 최소 활동 신호를 만들 것인가
   (`docs/pilot_usage_loop_v1.md` §7).
3. **파일럿 호스트 프로비저닝** — 리전/계정 · 도메인 · ACME 이메일 · Cafe24 앱 자격. 과금 리소스이므로
   이 유닛이 만들지 않았다.
4. **Demo Org QA 상태.** 이 세션의 스모크가 Demo Org에 판단 1건과 이슈 상태 전이 1건을 남겼다.
   파일럿 코호트 밖이므로 지표를 오염시키지 않지만, 남길지 지울지는 결정이다.
