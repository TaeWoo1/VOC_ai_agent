# Pilot Readiness v3 — Cafe24 Inquiry 파일럿

**2026-09-23 · 판정 `NOT_DEPLOYABLE` · 감사 기준 커밋 `e1725c47` · 수정 반영 `f85ac7f2`**

> **현재 상태: `code ready for provisioning; deployment prerequisites remain`.**
>
> **코드 blocker는 전부 `CLOSED`다**(B2 · B3 · S1 — `f85ac7f2`), 그리고 **B1도 `CLOSED`다**
> (`release/pilot-cafe24-v1` — §9). 전체 판정이 여전히 `NOT_DEPLOYABLE`인 이유는 **남은 둘이
> 저장소 안에 없기** 때문이다:
>
> | | 남은 blocker | 성격 |
> |---|---|---|
> | **B4** | canonical public HTTPS host | product-owner 입력 + 호스트 프로비저닝 |
> | **B5** | off-host backup | 운영 리소스 |
>
> 둘 다 코드 수정으로 닫히지 않는다. 이 문서의 §1-1 · §1-2 · §1-3 · §2-2 S1은 **결함이 무엇이었는지의
> 기록으로 보존**하고, 각 항목 끝에 무엇으로 닫혔는지를 적는다 — 닫힌 결함의 이유를 지우면 같은
> 모양이 다시 들어오는 것을 막을 근거가 사라진다.

§0~§7은 **읽기 전용 감사**(`e1725c47`)다. **코드 변경 0 · 인프라 생성 0 · 마켓플레이스 호출 0 ·
모델 호출 0 · DB 변경 0 · push 0.** §8이 그 감사가 낸 코드 blocker를 닫은 기록(`f85ac7f2`)이며,
그 작업도 **인프라 0 · 마켓플레이스 0 · 모델 0 · 마이그레이션 0 · push 0**이다.

이 문서는 `docs/pilot_readiness_v2.md`(2026-09-13, `READY_PENDING_HOST`)를 **대체한다**. 그 판정은
「코드 쪽에 남은 파일럿 blocker는 없다」였고, 그 뒤 **149 커밋**이 착지했다(Full MVP Stage 1~3,
Review Decision Workspace, Customer Operations). CLAUDE.md의 assumption rule대로 인용하지 않고
현 커밋에서 다시 도출했으며, **결론이 달라졌다.**

## 0. 무엇이 이 문서의 것이고 무엇이 아닌가

topology는 `docs/pilot_host_provisioning_v1.md`와 `docs/pilot_runtime_foundation_v1.md` §10이 계속
소유하고 여기서 다시 쓰지 않는다. capability 진실은 `docs/multi-channel-connector-roadmap.md` §4.1과
생성 문서 `docs/product_truth_matrix.md`가 소유한다.

**이 문서가 소유하는 것**: 지금 이 저장소를 공개 호스트에 올릴 수 있는가, 없다면 무엇 때문인가,
그리고 첫 외부 판매자를 받기 위한 target architecture와 rehearsal 합격 기준.

**lane 결정은 이 문서가 정정한다.** 감사 시점에 저장소는 서로 다른 두 답을 들고 있었다 —
`deploy/pilot/pilot.env.example` 헤더 · `preflight.sh` §4 · `smoke.sh`는 **Cafe24 only(2026-09-13 결정)**,
`docs/pilot_host_handoff_v1.md`와 `docs/pilot_first_external_seller_v1.md`(둘 다 2026-09-14)는
**Coupang 브라우저 상품평 only**. §3의 product-owner 결정이 이것을 닫는다: **Cafe24 only, Inquiry lane.**
09-14 두 문서는 그 lane에 대해서는 더 이상 현재 계획이 아니며, 도우미 패키징·배포 절차 기술은 유효하다.

---

## 1. 판정 `NOT_DEPLOYABLE` — 근거 넷 (감사 시점 `e1725c47`)

> 아래 넷은 **감사가 관측한 그대로** 보존한다. `1-2`와 `1-3`은 그 뒤 `f85ac7f2`로 닫혔고 제목에
> 그렇게 적혀 있다 — 결함의 기록을 지우면 같은 모양이 다시 들어올 때 근거가 없다.

### 1-1. 배포할 것이 remote에 없다 (blocker — **CLOSED** `release/pilot-cafe24-v1`, §9)

`deploy/pilot/`은 **`main`에 존재하지 않는다.** compose overlay · Caddyfile · `deploy.sh` ·
`backup.sh` · `restore.sh` · `smoke.sh` · `preflight.sh` · `pilot.env.example` 전부
`feat/review-decision-workspace-v1`에만 있다.

| 사실 | 값 |
|---|---|
| `main` | `2491f1ab` |
| 감사 대상 커밋 | `e1725c47` |
| main 대비 | **457 커밋 앞, 0 뒤** |
| origin 추적 | **없음** — `git ls-remote --heads origin`에 이 브랜치 없음 |
| `git ls-tree main deploy/pilot/` | **빈 결과** |

그런데 `deploy/pilot/deploy.sh`의 1단계는 `git pull --ff-only`다. 호스트에서 clone하면 받는 것은
`main` — Stage 3도, G1–G4도, 배포 키트 자체도 없는 트리다. **파일럿 호스트가 실행할 수 있는
배포 절차가 remote에 존재하지 않는다.**

`feat/proactive-operations-agent-v1`(`de1838f6`)은 `feat/review-decision-workspace-v1`의 **조상**이므로
(검증: `git merge-base --is-ancestor` YES) 후보 커밋은 **하나**로 좁혀진다. 갈라진 두 줄기가 아니다.

### 1-2. Stage 3가 증명한 lane의 실패 상태가 화면에서 사라진다 (blocker — **CLOSED** `f85ac7f2`, §8-1)

백엔드 `PublishOutcomeCategory`(`backend/src/main/java/com/sellerops/inquiry/publish/PublishOutcomeCategory.java:8-20`)는
`PENDING · PUBLISHING · COMPLETED · CHECKING_REQUIRED · RETRYABLE_FAILURE · PERMANENT_FAILURE`를
`name()`으로 직렬화한다. 프론트 union(`frontend/src/lib/types.ts:1986-1991`)은

```ts
/** Mirrors com.sellerops.inquiry.publish.PublishOutcomeCategory — the coarse outcome the UI renders. */
export type PublishOutcomeCategory =
  | "PUBLISHING" | "COMPLETED" | "CHECKING_REQUIRED" | "RETRYABLE" | "PERMANENT";
```

**`RETRYABLE_FAILURE` → `"RETRYABLE"`, `PERMANENT_FAILURE` → `"PERMANENT"`, `PENDING`은 아예 없다.**
그리고 그 타입의 주석은 스스로 *Mirrors* 라고 적고 있다.

TypeScript는 이것을 잡을 수 없다. union이 손으로 쓰였고, `publishCategoryLabel`
(`frontend/src/lib/inquiryPublish.ts:99`)의 switch에 **`default`가 없어** 컴파일러는 exhaustive라고
믿으며 런타임에 `undefined`를 반환한다.

새로고침 뒤 실제 렌더(`InquiryResponsePanel.tsx:219` `priorDelivery`, 카드 `:833-852`):

| 저장된 execution 상태 | category | 판매자가 보는 것 |
|---|---|---|
| `COMPLETED` | `COMPLETED` | 정상 — **Stage 3가 통과시킨 유일한 토큰** |
| `EXECUTED` · `DELIVERY_UNKNOWN` | `CHECKING_REQUIRED` | 정상 · 「상태 다시 확인」 |
| `DISPATCHING` | `PUBLISHING` | 정상 |
| **전송 0 실패** | `RETRYABLE_FAILURE` | **빈 상자.** `canResumePublish`(`:122`)가 `"RETRYABLE"`을 보므로 false ⇒ 「이어서 등록」 없음. `:709`가 `priorDelivery` non-null이면 전송 블록을 숨기므로 **다시 보낼 길이 전혀 없다** |
| **채널이 거절** | `PERMANENT_FAILURE` | **빈 상자.** 그리고 Case 화면(`copy/customerOps.ts:45` → `OperationsCase.tsx:563`)이 `default`로 떨어져 **「미발송」** — 보내고 거절당한 답변에 대해 **거짓** |

**G3은 실패하지 않았다.** 데이터는 계약대로 흘러온다 — 화면이 틀린 이름으로 읽는다. Stage 3가
통과한 이유는 그 run이 `COMPLETED` 하나만 만들었기 때문이고, 그 토큰이 **양쪽에서 우연히 같다.**

두 vocabulary를 묶는 테스트가 저장소에 없다. 유일한 FE delivery fixture
(`InquiryResponsePanel.publish.test.tsx:88`)도 `category: "COMPLETED"`를 쓴다.

### 1-3. 배포용 pilot env가 수집 스케줄을 만들고 실행하지 않는다 (blocker — **CLOSED** `f85ac7f2`, §8-2)

`deploy/pilot/pilot.env.example:128-133`이 그 함정을 **스스로 적어 두고 그대로 출고한다**:

```
SELLEROPS_SELF_PILOT_ENABLED=true
SELLEROPS_SELF_PILOT_SCOPE=CONNECTED_SELLERS
SELLEROPS_SELF_PILOT_DEFAULT_INTERVAL_MINUTES=60
# Self-pilot CREATES the schedules; this poller EXECUTES them. Both halves are needed for routine
# collection — with this false, schedules appear and nothing ever collects.
SELLEROPS_COLLECT_SCHEDULER_ENABLED=false
```

`SyncScheduler` bean은 `sellerops.collect.scheduler-enabled=true`일 때만 존재한다
(`collect/SyncScheduler.java:19`). Cafe24는 OAuth callback만으로 `CONNECTED`가 되고
(`Cafe24OnboardingService.java:301-305`) 판매자는 `frontend/src/pages/Cafe24ConnectResult.tsx:15`에서
**「이제 문의·리뷰·주문이 자동으로 수집됩니다.」**를 읽는다.

이 형상에서 그 문장은 거짓이고 데이터는 오지 않는다. `deploy.sh`도 `smoke.sh`도 이 조합을 잡지 않는다.
Coupang 브라우저 lane에서는 API 수집이 없으므로 이 기본값이 옳았다 — **Cafe24 Inquiry lane에서는 아니다.**

### 1-4. canonical public host 미정 (blocker)

`PILOT_PUBLIC_HOST` 하나가 여전히 미정이다. §3에서 product-owner가 「안정적인 HTTPS pilot host 하나를
canonical public host로 사용」한다고 결정했으므로 남은 것은 **그 이름을 고르는 일**이다. 이 값 하나가
TLS · CORS · Cafe24 redirect URI · 번들 CSP · 도우미 패키지 스탬프를 전부 결정한다.

---

## 2. 등급

### 2-1. Pilot blocker (닫히기 전에는 배포하지 않는다)

| # | 항목 | 상태 | 근거 |
|---|---|---|---|
| B1 | 배포 가능한 remote canonical commit 없음 | **CLOSED** `release/pilot-cafe24-v1` | §1-1 · §5 · §9 |
| B2 | publish outcome vocabulary 불일치 — 실패 두 상태가 빈 상자 + 통제 없음 | **CLOSED** `f85ac7f2` | §1-2 · §8-1 |
| B3 | self-pilot on + collect scheduler off ⇒ 수집이 영원히 일어나지 않음 | **CLOSED** `f85ac7f2` | §1-3 · §8-2 |
| B4 | canonical public host 미정 | **OPEN** | §1-4 |
| B5 | **off-host backup 부재** — product-owner가 첫 외부 판매자 전 필수로 결정 | **OPEN** | §2-2의 S4, §3 |

**남은 둘은 코드가 아니다.** 코드 쪽은 provisioning을 받을 준비가 됐고, 호스트와 백업이라는 배포 전제가 남아 있다.

### 2-2. Should-fix (첫 판매자 전에 닫는 것이 옳다)

| # | 항목과 근거 |
|---|---|
| S1 | **WRITE arming을 boot에서 검증하지 않음** — `PilotConfigValidator`에 publish · client-ip · shop-no 검사가 **0**. `execution-enabled=true`면 adapter bean이 **존재**하므로 G1 fail-fast를 통과하고, 승인이 바인딩된 뒤 `Cafe24ChannelReplyAdapter.java:110`(`clientIp.isEmpty() \|\| shopNo <= 0`)에서 거절 → `RETRYABLE_FAILURE`. **B2와 합쳐지면 빈 상자.** validator의 docblock(`:19-22`)이 막겠다고 적은 실패 유형 그 자체. **CLOSED** `f85ac7f2` — §8-3 |
| S2 | `/health`가 리터럴 — `common/HealthController.java:11`이 `{"status":"UP"}` 고정. DB를 보지 않으므로 Postgres를 잃은 backend도 healthy이고 `restart: unless-stopped`가 발동하지 않는다. (기동 시점 추론은 유효하다: validator가 거부하면 컨텍스트가 뜨지 않아 health에 도달하지 못한다. 없는 것은 **지속적 readiness**다) |
| S3 | 로그 로테이션 없음 — `deploy/`·compose 전체에 `max-size`/`log-opts` **0**, `host-bootstrap.sh`가 `daemon.json`도 쓰지 않음. 기본 `json-file` 무제한 |
| S4 | 백업이 설치되지 않음 — cron 줄은 `backup.sh` 헤더 주석에만 있고 `host-bootstrap.sh`는 디렉터리만 만든다. 실제로 도는 유일한 백업은 `deploy.sh` 3단계의 pre-migration 덤프. 덤프는 **같은 호스트 디스크**이고, vault 마스터 키는 덤프에 없고 `/etc/sellerops/pilot.env`에만 있다(키를 잃으면 덤프의 봉인 자격은 복구 불가) |
| S5 | 스케줄러 스레드 1개 — `spring.task.scheduling` 미선언 ⇒ Spring 기본 pool=1인데 responsibility tick이 `adopt-wait-seconds`(기본 **900초**, `application.yml:436`)를 **스레드 안에서** 기다린다. `application.yml:451`이 `PILOT_ACCEPTED_LIMITATION`으로 자인. 최대 15분간 collect·self-pilot·proactive·janitor가 전부 정지 |
| S6 | raw 토큰 노출 — `frontend/src/components/connect/ChannelStatusSection.tsx:77`이 `lastError`를 그대로 출력(`GW.IP_NOT_ALLOWED`·HTTP 코드·예외명). `ChannelList.tsx`는 `lastErrorKo` + 이중 fold로 옳게 하고 있다. `CollectionHistorySection.tsx:127`은 테스트가 **노출을 단언**한다 |
| S7 | 재시작 직후 폭주 — `SyncScheduler.java:32`에 `initialDelay` 없음 ⇒ 컨텍스트가 뜨는 즉시, 다운 중 도래한 모든 schedule이 첫 tick에 발사 |
| S8 | 부팅 write 러너 둘이 기본 ON — `sellerops.reviewissue.reextract-on-startup`·`sellerops.answer-memory.import-on-startup` 둘 다 `matchIfMissing=true`이고 **application.yml·compose·env 어디에도 선언되지 않았다**. DB 전용·멱등·실패 비치명이지만 `ApplicationReadyEvent` 이전 동기 실행이라 큰 DB에서 `deploy.sh`의 health 300초 예산과 경쟁 |

### 2-3. Later (기록하고 넘어간다)

- `sellerops.connector.cafe24.oauth.result-redirect-url`이 boot 검증 대상이 아니다(`redirect-uri`는 검증됨).
  실해는 낮다 — pilot overlay(`docker-compose.pilot.yml:34`)가 `PILOT_PUBLIC_HOST`에서 파생시킨다.
- 고아 `RUNNING` sync_job은 **같은 (account, dataType) 요청이 다시 올 때만** 회수된다
  (`SyncRunGate.java:81-110`, stale 기본 60분). 부팅 sweep 없음.
- `SyncScheduleClaimer`는 **설계상 at-most-once** — claim이 실행 전에 커밋되므로 재시작이 그 회차를
  조용히 버린다(`SyncScheduleClaimer.java:20-23`이 자인, lease/reclaim은 명시적 보류).
- guided-reply 중단 사유가 React state뿐이라 새로고침에 사라지고, `recoverable`은 캡처되지만 읽히지 않는다.
- 공개 호스트에서 signup 무제한(`SecurityConfig.java:79` `permitAll`, 플래그 없음). 하류는 안전하다 —
  연결이 없는 org는 `CONNECTED_SELLERS` scope가 집지 않는다.
- `deploy.sh` 주석의 "97 migrations"는 stale — 실제 113 파일 / 최신 `V99`.
- **Review publish lane은 같은 S1 형상을 그대로 갖고 있다 — 고치지 않았다.**
  `sellerops.review.publish.*`는 자기 flag · 자기 live-approval-id를 가진 **별도 실행 lane**이고,
  `Cafe24ReviewCommentAdapter.java:80`이 `shopNo <= 0`에서 거절하는 모양도 inquiry lane과 같다. 켜면
  같은 「승인 소진 + 전송 0」이 가능하다. **닫지 않은 이유**: product-owner 결정으로 이 lane은 꺼져
  있고(§3-3), capability가 `IMPLEMENTED — 어떤 몰에도 게시된 적 없음`이라 첫 라이브 증명 자체가 아직
  없다. 그 증명을 준비하는 패키지가 이 검사를 **함께** 가져가는 것이 맞고, 지금 넣으면 아무도 켜지
  않을 lane에 대한 추측이 된다. **이 lane을 켜기로 결정하는 순간 S1과 같은 boot 검증이 전제다.**
- **`PilotConfigValidator` 생성자가 11 → 16 인자가 됐다(§8-3).** 지금은 허용한다 — 인자들은 커넥터
  스위치와 같은 모양의 배포 사실이고, 테스트는 헬퍼로 호출을 모으고 있다. **다음에 config를 하나라도
  더 추가하면 그때가 refactor trigger다**: 채널별 config 객체(예: `Cafe24DeploymentConfig`,
  `NaverDeploymentConfig`)로 묶어 넘기고 validator는 그 객체에 묻는다. 지금 묶지 않는 이유는 이
  클래스가 스스로 「not a configuration framework」라고 적어 두었기 때문이고, 그 선을 넘는 것은
  인자 하나가 아니라 **다음 하나**여야 한다.

### 2-4. 재확인한 것 (다시 감사하지 않는다)

- **safety default가 일관되게 fail-closed** — 커넥터 7 · 모델 capability 9 · proactive · self-pilot ·
  responsibility · mock 2 · **양쪽 publish execution** 전부 `false`. `agent.access.scope` 기본값은
  가장 좁은 `ALLOW_LIST`. `true`인 것은 `flyway.enabled` · `seed.channel-catalogue`(참조 데이터) ·
  `agent.quota.enabled`(안전한 방향)뿐.
- **기본값 부팅에서 외부 호출 0** — 마켓플레이스 0, 벤더 0. 진단 러너 11개는 커넥터 플래그 **위에**
  자기 두 번째 플래그를 요구하고 그 플래그들은 어디에도 선언돼 있지 않다.
  `ApiReadPreflightRunner`는 `sellerops.preflight.api-read.approval-id`가 없으면 **bean 자체가 없고**,
  스케줄러가 하나라도 켜져 있으면 거절한다.
- **Responsibility runtime은 multi-replica 안전** — `FOR UPDATE SKIP LOCKED`(materialize·claim) +
  부분 유니크 인덱스 `uq_responsibility_run_active`(V106:75) + lease 180초/heartbeat 30초 +
  `attempt+1` 재획득. 8시간 정전이면 **MISSED 4행 + 현재 창 1건**, 소급 수집 없음.
- **Stage 3 멱등 펜스 다섯이 전부 DB 유니크 인덱스**(V9·V12) — 재시작과 무관하게 성립.
- **`DispatchRecoveryRunner`가 부팅마다 `DISPATCHING → DELIVERY_UNKNOWN`으로 재분류하고 절대 재전송하지 않는다.**
- `uq_sync_schedules_account_data_type`(V4)이 self-pilot 스케줄 생성을 multi-replica 안전하게 만든다.
- **env 이름이 전부 컨테이너에 도달** — `pilot.env.example` ↔ compose 교차검증 누락 **0**.
- Flyway forward-only · undo 스크립트 **0** · `baseline-on-migrate` 기본 `false`이고 `deploy.sh`가 `true`를 거부.
- `preflight.sh`/`deploy.sh`/`smoke.sh`는 실제로 촘촘하다 — ACME 이전 DNS 확인, **서빙된 번들의 CSP**에서
  runtime origin 검증, Flyway baseline 행 거부, 데모 입구 OFF 확인.

---

## 3. Product-owner 결정 (2026-09-23)

1. **첫 외부 파일럿 채널은 Cafe24 only.**
2. **핵심 lane은 Inquiry.**
3. **Cafe24 Review는 read/triage까지.** review reply publish는 **blocker가 아니다.**
4. **marketplace WRITE 기본값은 OFF.**
5. **clean-org rehearsal 전에는 READ + Grounded Draft까지만.**
6. **FE outcome(B2) · scheduler(B3) · write arming(S1)이 닫히고 rehearsal을 통과한 뒤에야**
   Cafe24 Inquiry **Human Approval WRITE만** 선택적으로 enable.
7. **off-host backup은 첫 외부 판매자 전에 필수**(B5).
8. **안정적인 HTTPS pilot host 하나를 canonical public host로 사용.**

이 결정이 `docs/pilot_host_handoff_v1.md` · `docs/pilot_first_external_seller_v1.md`의 Coupang-first
lane 선택을 대체한다. 두 문서의 도우미 패키징·전달·롤백 절차는 계속 유효하다.

**결정 4·5·6의 근거**: `docs/product_truth_matrix.md`에서 **CAFE24 INQUIRY는 수집·읽기·초안·실행
네 축 전부 `LIVE_PROVEN`**이고, 이것은 어떤 채널×객체 조합에서도 처음이다(2026-09-23, 커밋 `e1725c47`,
자식 글 `3680`). CAFE24 REVIEW는 수집·읽기 `LIVE_PROVEN` · 초안 `TEST_PROVEN` · **실행 `IMPLEMENTED`
— 어떤 몰에도 게시된 적 없다.** 그래서 Review reply는 blocker가 아니고, Inquiry WRITE는 선택적이다.

---

## 4. 첫 pilot target architecture

### 4-1. 호스트

Ubuntu 24.04 LTS · 2 vCPU / 4 GB / 40 GB+ · swap 2 GB(Gradle 빌드 피크 > 2 GB) ·
Docker + compose plugin **≥ 2.24**(overlay의 `!reset` 요구) · **공개 포트 80/443만** ·
A 레코드가 가리키는 안정적 HTTPS 이름.

**고정 공인 IPv4는 이 파일럿의 요건이 아니다.** 호출 IP 등록은 NAVER 커머스 API의 요구이고
(`PilotConfigValidator`의 그 조건은 `naverEnabled` 하나에만 걸려 있다), Cafe24는 우리 호스트의
출발지 주소를 검사하지 않는다. 필요한 것은 **안정적인 이름**이다. Elastic IP는 NAVER를 **추가할 때의**
전제이지 시작의 전제가 아니다.

### 4-2. 프로세스

```
              ┌──────────────── Caddy (ACME, 80/443) ────────────────┐
  판매자 브라우저 │  /api/*, /health → backend:8080                    │
  ──────────────▶│  /agent-runtime/* → agent-runtime:8787 (prefix 제거) │
                │  그 외 → frontend:80 (SPA)                          │
                └──────────────────────────────────────────────────┘
                     backend ──▶ postgres:16-alpine (named volume)
                     agent-runtime ──▶ backend (spring run store, DB 없음)
```

**단일 origin.** 프론트는 same-origin `/api/*`를 부르고(`VITE_API_BASE_URL=""`), 번들 CSP는
사이트 자신의 origin만 이름 짓는다. raw port 공개 **0**(`ports: !reset []`). 전부
`restart: unless-stopped`. Postgres는 named volume `sellerops_pgdata`.

### 4-3. 이 파일럿이 켜는 것과 끄는 것

| | 값 | 왜 |
|---|---|---|
| `SELLEROPS_CONNECTOR_CAFE24_ENABLED` | **`true`** | 유일한 채널 |
| `SELLEROPS_CONNECTOR_NAVER_ENABLED` · `_COUPANG_ENABLED` | `false` | 켜면 NAVER는 고정 IP를, Coupang은 등록 IP를 끌어들인다 |
| `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI` | `https://<host>/api/connect/cafe24/callback` | Cafe24 앱 등록값과 **byte-identical**. boot 검증 대상 |
| `SELLEROPS_VAULT_MASTER_KEY` | 생성 | 커넥터가 켜지므로 필수 |
| `SELLEROPS_SELF_PILOT_ENABLED` · `_SCOPE` | `true` · `CONNECTED_SELLERS` | 연결이 곧 수집 요청. env 편집·재기동 없이 새 판매자를 집는다 |
| **`SELLEROPS_COLLECT_SCHEDULER_ENABLED`** | **`true`** | **B3. 이 절반이 없으면 스케줄만 쌓이고 아무것도 수집되지 않는다** |
| `SELLEROPS_INQUIRY_PUBLISH_EXECUTION_ENABLED` | **`false`** | 결정 4·6. rehearsal 통과 후 선택적으로만 |
| `SELLEROPS_REVIEW_PUBLISH_EXECUTION_ENABLED` | `false` | 결정 3 — 어떤 몰에도 게시된 적 없는 adapter |
| `SELLEROPS_AGENT_ACCESS_SCOPE` | `CONNECTED_SELLERS` | PLAN/DRAFT/JUDGE/CONVERSE/REPORT의 org 질문 |
| `SELLEROPS_KNOWLEDGE_{EMBEDDING,INTENT,ELIGIBILITY}_ORG_IDS` | **명시 UUID** | 고객 질문이 벤더로 나가므로 scope로 넓히지 않는다. `*` 금지 |
| `SELLEROPS_SEED_*` 셋 · mock 둘 | `false` | 합성 행이 `REAL`로 착지하면 이후 분리 불가 |
| `SELLEROPS_PROACTIVE_ENABLED` · `SELLEROPS_RESPONSIBILITY_SCHEDULER_ENABLED` | `false` | 각자 별도 결정 |
| `PILOT_GUIDED_HELPER_ENABLED` | `false` | **Cafe24는 도우미가 필요 없다.** 켜면 CSP에 loopback을 넣고 패키지 빌드·전달이 따라온다 |

### 4-4. 판매자가 밟는 길

회원가입 → `/connect` → Cafe24 mall id 입력 → Cafe24 동의 화면 → callback → `CONNECTED` →
**self-pilot이 ≤5분 안에 schedule을 만들고 collect poller가 ≤60초 안에 실행** → 홈이
`NO_CHANNEL` → `NO_DATA` → `WORKING`으로 이동. **판매자가 눌러야 하는 첫 수집 버튼은 없다**
(그 버튼은 NAVER·Coupang의 PREPARING→CONNECTED 전이용이고 Cafe24에는 그 전이가 없다).

여기까지가 **READ + Grounded Draft**의 끝이다. 초안은 화면에 서고, 전송은 결정 6이 열리기 전에는
「초안 복사 → 판매자센터에서 직접 등록」이다 — 그리고 `executionEnabled=false`일 때 화면이 그렇게
말한다(`inquiryPublish.ts:79`).

---

## 5. deploy candidate 조건 — remote canonical commit

**규칙: 파일럿 호스트는 origin에서 fast-forward로 도달 가능한 단일 커밋만 배포한다.**

`deploy/pilot/deploy.sh`의 1단계가 `git pull --ff-only`이므로 이것은 선호가 아니라 그 스크립트가
동작하기 위한 **전제**다. 충족 조건 넷:

1. **배포 대상이 origin에 존재한다** — 브랜치든 태그든, `git ls-remote`가 답한다.
2. **`deploy/pilot/` 전체가 그 커밋에 있다** — 오늘 `main`에는 없다.
3. **그 커밋이 fast-forward로 도달 가능하다** — 호스트 체크아웃이 rebase도 merge도 하지 않는다.
4. **그 커밋 id가 이 문서와 evidence 행에 적힌다** — 배포된 것이 무엇인지 나중에 되물을 수 있어야 한다.

로컬 체크아웃을 손으로 옮겨 `deploy.sh --no-pull`로 도는 것은 **한 번은 되지만 절차가 아니다**:
무엇이 배포됐는지 말해 줄 remote 기록이 없고, 다음 배포의 diff 기준이 사라진다.

**감사 시점 상태**: 조건 1·2·3 전부 미충족(§1-1).
**현재 상태**: 조건 **1·2·3·4 전부 충족** — `release/pilot-cafe24-v1`이 origin에 있고, 그 tip이
`pilot-cafe24-v1-rc1` 태그로 고정돼 있다(§9). **deploy candidate는 이 브랜치다.**

---

## 6. clean-org production rehearsal — acceptance criteria

빈 볼륨에서 시작한다. 기존 DB를 복사해 오지 않는다 — 파일럿 DB는 **빈 볼륨 + Flyway**다.

### 6-0. 사전

`host-bootstrap.sh` → `/etc/sellerops/pilot.env` 작성(0600, 체크아웃 **밖**) → `preflight.sh` 전항목 통과.

### 6-1. 합격 기준

| # | 확인 | 합격 |
|---|---|---|
| R1 | `deploy.sh`가 §5의 remote canonical commit에서 pull로 시작해 끝까지 간다 | 7단계 전부 통과, 출력된 commit == 의도한 commit |
| R2 | Flyway | 적용 수 == 체크아웃의 `V*.sql` 수, 실패 0, **BASELINE 행 0** |
| R3 | `smoke.sh` | **전항목 ok, 실패 0** — 특히 데모 입구 `enabled:false`, raw port 4개 비공개, 서빙 CSP에 loopback runtime 부재 + 사이트 origin 존재, Cafe24 redirect URI == 이 호스트의 callback |
| R4 | 데모/합성 데이터 | org 수 **0**, 합성 행 **0**. 채널 카탈로그 13행만 존재 |
| R5 | 제품 자신의 signup으로 org 생성 | 연결 전 홈이 **「판매 채널을 연결하면 시작할 수 있습니다.」**. 「지금 먼저 확인할 일은 없습니다」가 **렌더되지 않는다** |
| R6 | Cafe24 OAuth 1회 | callback 302 `status=connected`, 봉인 자격 1행, `seller_accounts.status=CONNECTED` · `is_file_upload=false` |
| R7 | **첫 수집이 실제로 도착한다** | 연결 후 **시계로 측정**. self-pilot이 schedule 생성(≤5분) → collect poller 실행(≤60초) ⇒ **≤6분 내 첫 sync_run 성공**. 홈이 `NO_DATA` → `WORKING` |
| R8 | Inquiry lane end-to-end (READ + Draft) | 실제 문의 1건이 수집 → work item → Case → Knowledge → **`GROUNDED` draft**. **모델 호출은 이 경로에만**, 마켓플레이스 WRITE **0** |
| R9 | **전송이 도달 불가임을 확인** | `execution-enabled=false` ⇒ `ChannelReplyAdapter` bean 부재. 화면이 「초안 복사」를 제시하고 「답변 보내기」를 제시하지 **않는다** |
| R10 | **재시작 복구** | `docker compose restart` 후: 스케줄 cursor 복구, 진행 중이던 sync가 중복 실행되지 않음, `DISPATCHING` 행이 있었다면 `DELIVERY_UNKNOWN`으로 재분류(재전송 0), 홈/큐가 재시작 전과 같은 수를 말함 |
| R11 | **호스트 재부팅 복구** | reboot 후 사람 개입 없이 스택 복귀(`restart: unless-stopped` + docker enabled), R3 재통과 |
| R12 | **백업/복원 리허설** | `backup.sh`가 덤프를 만들고, `restore.sh`가 그것을 되돌리고, 복원 뒤 `smoke.sh` 재통과 + Cafe24 자격이 **여전히 열린다**(같은 vault 키) |
| R13 | **off-host 복사** | 덤프가 호스트 밖 저장소에 도달함을 확인(B5) |
| R14 | 로그 | 24시간 뒤 디스크 사용이 유계임을 확인(S3이 닫힌 뒤) |
| R15 | ERROR/WARN | 기동과 R5~R10 전 구간에서 설명되지 않는 ERROR **0** |

**R7·R10·R11·R12는 이 저장소에서 한 번도 실행된 적 없는 구간이다.** 나머지는 로컬 또는 테스트로
관측된 적이 있다.

### 6-2. rehearsal 이후에만

결정 6에 따라 **B2 · B3 · S1이 닫히고 R1~R15가 통과한 뒤에만** Cafe24 Inquiry Human Approval WRITE를
선택적으로 enable한다. 그때 필요한 것은 네 값과 한 동의다 — `…PUBLISH_EXECUTION_ENABLED=true` ·
`…CAFE24_LIVE_APPROVAL_ID` · `…CAFE24_CLIENT_IP`(이 호스트의 egress) · `…CAFE24_SHOP_NO`(관측된 값) ·
판매자 자신의 `mall.write_community` 재동의. 그리고 그 실행은 **자기 단일 사용 승인**을 따로 받는다
(`docs/sellerops_live_approval_contract.md`).

---

## 7. 이 감사가 하지 않은 것

- 코드를 고치지 않았다. 위 blocker·should-fix는 **제안**이고 착수는 별도 결정이다.
  (§8이 그중 셋을 실제로 닫은 별도 작업의 기록이다.)
- 인프라를 만들지 않았다. AWS 리소스 생성 **0**.
- 마켓플레이스와 모델을 부르지 않았다. **호출 0 · WRITE 0 · DB 변경 0.**
- push하지 않았다.
- `main` 병합 전략을 정하지 않았다 — §5는 조건을 적고 방법(merge / release tag)은 열어 둔다.

---

## 8. 코드 blocker 종결 — `f85ac7f2` (2026-09-23)

§1~§2가 낸 것 중 **코드로 닫을 수 있는 셋만** 닫았다. Stage 3 lifecycle · workflow · state 의미 ·
고아 `57ee2220` · legacy lane **무변경**. 파일 10개, **인프라 0 · 마켓플레이스 0 · 모델 0 ·
마이그레이션 0 · DB 변경 0 · push 0.**

검증: **backend 4,811 tests · frontend 3,109 tests · 실패 0** (전체 스위트, 이 커밋 기준).

### 8-1. B2 — publish outcome vocabulary `CLOSED`

**backend enum이 canonical이다.** `PublishOutcomeCategory`의 constant 이름이 wire 위의 토큰이므로
(직렬화는 `name()`, `@JsonValue` 없음, naming strategy 없음) frontend union·label·gate·tag를 전부
그 이름으로 맞췄다 — `PENDING` · `PUBLISHING` · `COMPLETED` · `CHECKING_REQUIRED` ·
`RETRYABLE_FAILURE` · `PERMANENT_FAILURE`.

**unknown token은 truthful fallback을 받는다.** `default` 절의 **부재**가 이 결함을 보이지 않게 만든
원인이었으므로(§1-2), 이제 모르는 토큰도 문장을 받는다. 그 문장은 확실히 참인 것 하나만 말하고
— 이 화면이 상태를 읽지 못했다 — **성공도 실패도 주장하지 않으며 토큰을 인쇄하지 않는다.**

**복구 경로는 비대칭으로 열었다.** 읽기 전용인 「상태 다시 확인」은 모르는 상태에서도 제공한다
(재조회는 고객 앞에 아무것도 놓지 않는다). **두 번째 customer write가 될 수 있는 「이어서 등록」은
fail-closed** — 이 빌드가 이미 메시지가 나갔는지 알 수 없기 때문이다.

「미발송」은 **delivery 행이 아예 없을 때만** 쓴다. 없는 것과 읽지 못한 것은 다른 사실이고, 그 둘을
합쳤기 때문에 거절당한 답변이 「미발송」으로 불렸다.

`ExecutionResultArtifact`가 들고 있던 **같은 철자의 두 번째 allow-list는 삭제**했다 — 한 번의 어긋남이
두 화면의 침묵이 된 경로다. vocabulary의 소유자는 `publishCategoryLabel` 하나다.

**cross-language contract test**: `frontend/src/lib/publishOutcomeCategoryContract.test.ts`가 **Java
소스를 읽어** 두 vocabulary를 대조한다(손으로 적은 세 번째 목록이 아니다 — 이미 두 번 어긋난 것을
또 베끼는 일이다). 더해서 모든 backend constant가 문장과 태그를 받는지, unknown이 빈 화면·거짓
주장·raw 토큰을 만들지 않는지, 그리고 §1-2 표의 각 행이 이제 무엇을 렌더하는지를 단언한다.
**옛 union에서 red 1건, 옛 gate/label에서 red 3건**을 확인한 뒤 남겼다.

### 8-2. B3 — self-pilot / collect scheduler `CLOSED`

`deploy/pilot/pilot.env.example`의 `SELLEROPS_COLLECT_SCHEDULER_ENABLED`를 **`true`**로 바꾸고,
`deploy.sh`와 `preflight.sh`가 반쪽 조합을 **hard fail**한다. `application.yml`의 fail-closed
기본값 둘(`self-pilot.enabled` · `collect.scheduler-enabled` 모두 `false`)은 **건드리지 않았다** —
일반 개발 부팅은 바이트 동일하다. 이것은 배포 형상의 실수이지 코드의 실수가 아니다.

**실측 matrix**(실제 스크립트 실행, docker·네트워크 stub, 인프라 0):

| 설정 | `deploy.sh` |
|---|---|
| Cafe24 파일럿 baseline | **통과** |
| self-pilot on + collect **off** | **거절** — 「schedules appear and nothing is ever collected」 |
| self-pilot on + collect **미설정** | **거절** (같은 메시지) |
| scope `ALLOW_LIST` + org ids **공백** | **거절** — 「collects for nobody」 |
| scope `ALLOW_LIST` + org ids 명시 | 통과 |
| scope `LOCAL_SINGLE_USER` | **거절** — loopback 전용 자세 |
| scope 오타 | **거절** |
| self-pilot **off** + collect off | 통과 — 수집하지 않는 배포는 정상 |

`preflight.sh` §5-A가 **이미지 빌드 전에** 같은 조합을 잡는다(실측 확인). scope가 `ALLOW_LIST`인데
org 목록이 빈 경우를 함께 거절하는 이유는 **그것이 shipped 기본값**이기 때문이다 — self-pilot만 켠
env가 그 기본값을 물려받아 아무에게도 수집하지 않는다.

기존 거절 7종(seed · mock · `ALL_ORGS` · dev-outbox · flyway baseline · vault · localhost)은
**회귀 없이 유지**됨을 같은 harness로 확인했다.

### 8-3. S1 — WRITE arming boot validation `CLOSED`

`PilotConfigValidator.inquiryWriteProblems()`가 **전송이 켜졌을 때만, 채널별로** 검사한다.

**invariant는 Cafe24와 NAVER가 같다** — 두 adapter 모두 `PublishExecutionWiring`에서
`execution-enabled` + 자기 커넥터 플래그로 등록되고 **arming 값은 그 조건에 없다**. 그래서 반쯤
무장된 배포에는 진짜 adapter bean이 있고, publish core의 fail-fast가 그것을 찾아 confirm을
통과시키며, 단일 사용 승인이 바인딩되고 work item이 `ACTION_PENDING`까지 간 다음에야 adapter가
자기 빈 `client_ip`나 `shop_no = 0`에서 거절한다. 브리프는 Cafe24였으나 NAVER를 빼면 **같은 형상에
대한 문서화된 구멍**이 남으므로 함께 닫았다.

| 전송 | 채널 설정 | 결과 |
|---|---|---|
| **off** | 전 값 공백 | **정상 부팅** — 출고 자세이며 adapter bean 자체가 없다 |
| on | Cafe24 `client_ip` 공백 | **boot 거절** |
| on | Cafe24 `shop_no = 0` | **boot 거절** (관측된 값이어야 하며 기본값 1을 가정하지 않는다) |
| on | Cafe24 `live-approval-id` 공백 | **boot 거절** |
| on | Cafe24 셋 다 공백 | **한 번에 3건 모두 지목** — 재시작마다 하나씩 발견하게 두지 않는다 |
| on | NAVER `live-approval-id` 공백 | **boot 거절** |
| on | 커넥터가 **꺼진** 채널의 값 | **묻지 않는다** — Coupang 없는 호스트가 Coupang 비밀 없이 뜨는 것과 같은 규칙 |

회귀 테스트는 `PilotConfigValidatorTest`에 6건(위 표의 각 행 + 「반쯤 무장된 호스트는 **뜨지
않는다**」 — 로그 경고가 아니라 throw임을 단언). 클래스 전체 **25 tests · 실패 0**.

### 8-4. 이 작업이 하지 않은 것

- 인프라를 만들지 않았고, 마켓플레이스·모델을 부르지 않았고, 마이그레이션을 추가하지 않았고,
  push하지 않았다.
- **Stage 3 lifecycle · 승인 경계 · workflow · state 의미를 바꾸지 않았다.** 바뀐 것은 이미 흐르던
  사실을 화면이 **어떤 이름으로 읽는가**, 그리고 배포가 **무엇을 거절하는가**다.
- 고아 `57ee2220`과 legacy lane을 건드리지 않았다.
- `application.yml`의 어떤 기본값도 바꾸지 않았다.
- **should-fix S2~S8은 그대로 열려 있다** — `/health` 리터럴 · 로그 로테이션 · 백업 cron ·
  스케줄러 pool=1 · raw `lastError` 노출 · `SyncScheduler` initialDelay 부재 · 부팅 write 러너 둘.

---

## 9. B1 종결 — `release/pilot-cafe24-v1` (2026-09-24)

`deploy.sh`의 1단계가 `git pull --ff-only`인데 배포 키트 전체가 **origin에 없는 브랜치에만** 있었다
(§1-1). 그것을 닫았다. **코드 변경 0 · 인프라 0 · 마켓플레이스 0 · 모델 0.**

### 9-1. 무엇을 만들었나

| | 값 |
|---|---|
| **remote branch** | **`release/pilot-cafe24-v1`** — 이것이 **deploy candidate**다 |
| 분기 시점 커밋 | `04b4d5be` (당시 `feat/review-decision-workspace-v1` tip) |
| **immutable RC tag** | **`pilot-cafe24-v1-rc1`** — annotated, 이 브랜치의 최종 커밋을 가리킨다 |
| `main` 병합 | **하지 않았다.** `main`은 `2491f1ab` 그대로 |
| force push · history rewrite | **없음.** 둘 다 새 ref이고 기존 ref는 하나도 움직이지 않았다 |

**`main`에 merge하지 않은 것은 결정이다**(product-owner, 2026-09-24). 파일럿은 자기 브랜치에서
출발하고, `main` 병합은 rehearsal과 첫 판매자 이후의 별도 질문으로 남는다. 그래서 호스트는
`main`이 아니라 **이 브랜치**를 체크아웃한다.

### 9-2. 절차와 그 안전성

1. tracked 파일 수정 **0** 확인(untracked는 `node_modules` 둘뿐 — 커밋 트리에 들어가지 않는다).
2. `git fetch origin --prune --tags`.
3. **같은 이름의 remote branch·tag가 이미 있는지 먼저 확인** — 둘 다 없었다. 있었다면 덮어쓰지 않고
   중단하는 것이 지시였고, 그것이 force push 금지의 실질적 의미다.
4. `04b4d5be`에서 브랜치 생성 → origin push(새 ref, 460 커밋).
5. 이 문서 갱신 → **문서 전용 커밋** → 같은 브랜치에 push.
6. 그 최종 커밋에 annotated tag → tag push.
7. origin의 branch와 tag가 **정확히 같은 커밋**을 가리키는지 확인.

### 9-3. 아직 닫히지 않은 것

B1이 닫혔다고 **배포 준비가 끝난 것이 아니다.** 남은 것은 **B4(canonical public HTTPS host)**와
**B5(off-host backup)**이고 둘 다 저장소 밖이다. 그리고 **§6의 clean-org rehearsal은 아직 수행되지
않았다** — RC1은 「배포할 수 있는 것이 이름을 갖게 됐다」는 뜻이지 「배포해서 동작하는 것을 봤다」는
뜻이 아니다. R1~R15 중 어느 것도 실행되지 않았고, 그중 R7·R10·R11·R12는 이 저장소에서 **한 번도**
실행된 적이 없다.

**현재 상태: `code ready for provisioning; deployment prerequisites remain`.**
