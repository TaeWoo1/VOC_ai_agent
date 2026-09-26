# Pilot Provisioning Plan v1 — B4 public host · B5 off-host backup

**2026-09-24 · PLAN.** 인프라 생성 **0** · 마켓플레이스 **0** · 모델 **0** · push **0** ·
billable 리소스 **0**.

> **B5의 스크립트 쪽은 그 뒤 구현됐다** — `backup.sh`의 off-host 업로드 · `SELLEROPS_BACKUP_S3_*`
> env 계약 · `deploy.sh`/`preflight.sh` 게이트. 계획은 바뀌지 않았고 §2-E·§4-D가 그 상태를 가리킨다.
> **여전히 만들지 않은 것**: 버킷 · 자격 · 호스트 · DNS. B5가 CLOSED가 되려면 §6-B의 리허설이
> 필요하고, 그중 B5-7은 **새 호스트**에서 돈다.

`docs/pilot_readiness_v3.md`가 남긴 blocker 둘 — **B4 canonical public HTTPS host**와
**B5 off-host backup** — 을 닫기 위해 **무엇을 만들고, 어떤 순서로, 무엇이 있어야 CLOSED인가**를
확정한다. 배포 후보는 **`release/pilot-cafe24-v1`**(RC1 = `pilot-cafe24-v1-rc1` → `7a0b6749`)이고
이 문서는 그것을 바꾸지 않는다.

## 0. 소유 경계

**topology · host sizing · port map · TLS · Cafe24 callback · secrets 목록 · DB persistence ·
startup/restart · deploy 절차 · smoke 계획**은 `docs/pilot_host_provisioning_v1.md`가 계속 소유한다.
여기서 다시 쓰지 않고 필요한 곳에서 인용만 한다.

**이 문서가 소유하는 것**: 외부 리소스 목록 · DNS를 포함한 실행 순서 · secrets/env 인벤토리 ·
**비용 자리(값 없음)** · **B4/B5의 acceptance criteria** · 그리고 그 뒤 R1–R15 실행 순서.

**한 가지 정정**: `pilot_host_provisioning_v1.md` §3은 루트 볼륨 **30 GB**를 권고한다. 이번
product-owner 지시는 **40 GB 이상**이므로 **40 GB+를 따른다**(우선순위 1). 이유도 이 문서 쪽이
맞다 — 이미지 빌드 · 로그 · 그리고 §2-2 S3(로그 로테이션 미구현)이 아직 열려 있다.

---

## 1. 필요한 외부 리소스

이 저장소가 만들 수 없고 **operator/product-owner가 계정에서 만들어야 하는 것**. 아직 **하나도
만들지 않았다.**

### 1-A. B4 — public host

| # | 리소스 | 사양 / 제약 | 왜 |
|---|---|---|---|
| R-1 | **compute instance 1대** | Ubuntu 24.04 LTS · **2 vCPU / 4 GB** · **root 40 GB+** · x86_64 | 이미지가 그대로 빌드된다. 2 GB는 JVM heap + Postgres + Gradle 빌드가 한 박스에 있어 불가(`pilot_host_provisioning_v1.md` §3) |
| R-2 | **swap 2 GB** | 인스턴스 내부 swapfile | Gradle 빌드 단계 피크 > 2 GB. `host-bootstrap.sh`가 만든다 — **별도 리소스가 아니다** |
| R-3 | **공인 IPv4 주소** | A 레코드가 가리킬 안정적 주소 | **고정 IP 등록이 필요한 것은 NAVER**이고 이 파일럿에서 NAVER는 꺼져 있다. 그래도 **A 레코드가 흔들리면 ACME가 깨지므로** 주소는 안정적이어야 한다 |
| R-4 | **DNS zone + A 레코드 1개** | `PILOT_PUBLIC_HOST` → R-3 | 이 값 하나가 TLS · CORS · Cafe24 redirect URI · 번들 CSP를 전부 결정한다(§2-C) |
| R-5 | **inbound 방화벽 규칙** | **80/443만** 공개. SSH는 SSM 등 콘솔 경로 우선, 불가하면 운영자 IP로 제한 | raw port는 overlay가 `ports: !reset []`로 이미 닫는다. 남은 노출면은 edge뿐 |
| R-6 | **Cafe24 앱** | redirect URI가 `https://<host>/api/connect/cafe24/callback`와 **byte-identical** | 등록·authorize·토큰 교환이 전부 같은 문자열이어야 한다. `preflight.sh`가 이 일치를 검사한다 |
| R-7 | **ACME 연락 메일** | `PILOT_ACME_EMAIL` | Let's Encrypt 발급 통지 |

**의도적으로 없는 것**: 로드밸런서 · RDS · 컨테이너 레지스트리 · CI/CD · WAF · Elastic IP 고정
등록(NAVER를 켜는 날의 전제이지 시작의 전제가 아니다).

### 1-B. B5 — off-host backup

| # | 리소스 | 사양 / 제약 | 왜 |
|---|---|---|---|
| R-8 | **object storage bucket 1개** | **호스트와 다른 장애 도메인**. 버전 관리 ON. 공개 접근 전면 차단 | 호스트가 죽어도 남아야 한다는 것이 B5의 정의다 |
| R-9 | **bucket 보존 정책** | **객체 잠금(WORM) 또는 최소한 versioning + 삭제 방지** | 아래 §3-B의 이유 — 호스트에서 지울 수 있는 백업은 랜섬·오조작을 견디지 못한다 |
| R-10 | **업로드 전용 자격** | **`PutObject`만**. `DeleteObject`·`ListBucket` 없음. 이 버킷 prefix로 범위 한정 | 호스트가 털려도 **과거 백업을 지울 수 없다.** 복원은 운영자가 자기 자격으로 한다 |
| R-11 | **복원용 읽기 자격** | 운영자 보관. **호스트에 두지 않는다** | 호스트에 있으면 R-10의 의미가 사라진다 |
| R-12 | **vault master key의 off-host 사본** | `SELLEROPS_VAULT_MASTER_KEY`. 백업과 **다른 곳**(비밀번호 관리자/KMS) | **§3-C — 이것이 없으면 B5는 거짓이다** |
| R-13 | **백업 실패 알림 경로** | 메일 · 챗 webhook · 또는 dead-man's-switch 중 하나 | §3-D — 조용히 실패하는 백업은 백업이 없는 것과 구별되지 않는다 |

---

## 2. Provisioning 순서 (DNS 포함)

**순서가 곧 안전장치다.** 각 단계는 **되돌릴 수 있는 동안** 확인된다 — ACME는 실패를
rate-limit하고, Cafe24 redirect URI의 오타는 판매자가 동의 화면 앞에 선 다음에야 드러난다.

### 2-A. 이름과 주소 먼저 (ACME 이전)

1. **`PILOT_PUBLIC_HOST` 값 확정** — product-owner. scheme·path 없는 순수 호스트 이름.
2. 인스턴스(R-1) 생성 · 공인 IPv4(R-3) 확보.
3. **A 레코드(R-4) 생성 후 전파 확인.**
4. 방화벽(R-5): **80/443만** 열고 나머지는 닫는다.
5. `host-bootstrap.sh` 실행 — Docker + compose plugin(**≥ 2.24**, overlay의 `!reset` 요구) ·
   swap 2 GB · `/etc/sellerops`(0700) · `/var/backups/sellerops`(0700).

### 2-B. 저장소와 설정

6. `release/pilot-cafe24-v1`을 `/opt/sellerops/repo`에 clone(**`main`이 아니다**).
   재현 가능한 배포를 원하면 `pilot-cafe24-v1-rc1` 태그를 체크아웃한다.
7. `/etc/sellerops/pilot.env`를 `deploy/pilot/pilot.env.example`에서 만들고 **0600**.
   비밀 셋은 **호스트에서 생성**한다(§3-A).

### 2-C. Cafe24 앱 등록 — 여기서 한 글자가 전부를 정한다

8. Cafe24 앱의 redirect URI를 **`https://<PILOT_PUBLIC_HOST>/api/connect/cafe24/callback`**로 등록.
9. `pilot.env`에 **같은 문자열**을 넣는다. overlay가 `PILOT_PUBLIC_HOST`에서 파생시키므로 보통
   비워 두면 되고, **직접 쓰는 순간 두 곳이 어긋날 수 있다.**

### 2-D. 검증 후 기동

10. **`deploy/pilot/preflight.sh`** — DNS 해석 · 80/443 비어 있음 · env 모드 0600 · JWT 길이 ·
    Cafe24 redirect URI 일치 · seed/mock 전부 false · flyway baseline false ·
    **§5-A의 self-pilot/collect 조합** · 백업 디렉터리 · docker compose 버전. **전항목 통과 후 진행.**
11. **`deploy/pilot/deploy.sh`** — pull → env 검증 → (첫 배포는 덤프 생략) → build → up(Flyway) →
    health → smoke.
12. **`deploy/pilot/smoke.sh`** 전항목 ok(= R3).

### 2-E. B5 배선 (아래 §3 — **스크립트는 구현됐다**, 남은 것은 리소스와 리허설)

13. 버킷(R-8) · 보존 정책(R-9) · 업로드 전용 자격(R-10) 생성.
14. 호스트에 업로드 자격을 **0600**으로 배치. `backup.sh`의 off-host 업로드 단계는 **구현돼 있다**
    (`SELLEROPS_BACKUP_S3_ENABLED=true`로 켠다).
15. **`deploy/pilot/install-backup-job.sh`** — `/etc/cron.d/sellerops-backup`(0644)을 설치한다.
    §2-2 S4(「cron 줄은 `backup.sh` 헤더 주석에만 있다」)는 **이 스크립트로 닫혔다**.
    스케줄은 **03:17 KST**이고 zone은 **job에만** 박힌다(`CRON_TZ`/`TZ=Asia/Seoul`) — 이 저장소는
    호스트 timezone을 설정하지 않고 권장 이미지는 UTC라, zone을 적지 않은 `17 3 * * *`은 서울 기준
    **12:17**에 돌았을 것이다. OS 전체 시간대는 바꾸지 않는다.
16. **복원 리허설**(R12·R13) — 이것을 하기 전에는 B5가 CLOSED가 아니다.

**순서가 바뀐 것이 아니라 강제된다(2026-09-26).** 13~15는 이제 **10~12보다 먼저** 끝나 있어야 한다 —
`deploy.sh`가 `SELLEROPS_BACKUP_S3_ENABLED=true`·네 값·`aws` 셋 다 없으면 **배포를 거부**하고,
`preflight.sh`는 같은 셋과 cron 파일 부재를 **note가 아니라 FAIL**로 센다. 이전에는 note였고, note는
호스트가 「백업이 있다」고 믿게 되는 경로 그 자체였다. 로컬 덤프는 어느 쪽이든 찍히므로 이 거부가 막는
것은 「백업 여부」가 아니라 **복구할 수 없는 판매자 데이터를 쌓기 시작하는 것**이다.
`host-bootstrap.sh`는 AWS CLI **v2**를 설치한다(`apt install awscli`는 v1이고 `backup.sh`가 부르는
`aws s3api put-object`의 그 제품이 아니다).

---

## 3. B5 설계 — 결정이 필요한 다섯

`deploy/pilot/backup.sh`는 이미 `pg_dump -Fc`를 `/var/backups/sellerops`에 쓰고 14일 보존한다.
**없는 것은 호스트 밖으로 나가는 한 걸음**과 그것을 둘러싼 네 가지다.

### 3-A. 무엇이 덤프에 있고 무엇이 없나 (이미 참인 사실)

덤프에는 **봉인된 자격(vault ciphertext)과 판매자 데이터**가 있고, **env secret은 없다.**
`SELLEROPS_VAULT_MASTER_KEY`와 `SELLEROPS_JWT_SECRET`은 `/etc/sellerops/pilot.env`에만 있다.
**다른 키로 복원하면 자격은 하나도 열리지 않는다** — 설계대로다.

### 3-B. 업로드 자격의 권한 — 제안

**`PutObject`만.** 호스트가 침해돼도 과거 백업을 **지울 수 없어야** 한다. 버킷에 versioning과
가능하면 객체 잠금을 건다. 삭제 권한을 가진 자격은 **호스트에 두지 않는다**(R-11).
retention은 버킷의 lifecycle이 집행하고 **스크립트가 집행하지 않는다** — 삭제를 아는 스크립트는
삭제할 수 있는 스크립트다.

### 3-C. vault master key 사본 — **이것이 B5의 진짜 조건이다**

호스트가 사라지면 남는 것은 덤프뿐인데, **덤프만으로는 채널 자격을 열 수 없다.** 그래서
`SELLEROPS_VAULT_MASTER_KEY`의 off-host 사본(R-12)이 **백업과 다른 곳**에 있어야 한다.
같은 버킷에 넣으면 그 버킷 하나가 뚫렸을 때 암호문과 열쇠가 함께 나간다.

**이 사본이 없으면 「호스트 장애에서 복구 가능」은 거짓이고, B5는 CLOSED가 아니다.**

### 3-D. 성공/실패가 보여야 한다 — 제안

현재 `backup.sh`는 파일명과 바이트 수를 stdout에 찍고 cron이 로그로 넘긴다. **아무도 그 로그를
읽지 않으면 실패는 침묵이다.** 최소 형태:

- 매 실행이 **성공/실패 · 시각 · 바이트 수 · 원격 객체 키**를 한 줄로 남긴다.
- **실패는 밀어서 알린다**(R-13). 이 저장소에는 알림 인프라가 없으므로 **새로 정하는 것**이다.
- 가능하면 **dead-man's-switch** — 「오늘 백업이 없었다」를 감지하는 쪽이 낫다. 실패 알림만 있으면
  cron이 아예 안 돌 때 아무 신호도 없다.

### 3-E. 암호화 — 제안과 그 대가

버킷의 at-rest 암호화는 기본으로 켠다. **클라이언트측 추가 암호화는 권하지 않는다(초기)** —
그러면 **잃어버리면 복구 불가능한 열쇠가 하나 더** 생기고, §3-C가 이미 그 성격의 열쇠를 하나
요구하고 있다. 두 번째를 더하기 전에 첫 번째의 보관이 증명돼야 한다.

전송은 HTTPS. 덤프 파일은 호스트에서 **0700 디렉터리**에 머문다(이미 그렇다).

### 3-F. Retention — 제안 (결정은 product-owner)

| 대상 | 제안 | 이유 |
|---|---|---|
| 호스트 로컬 | **7일** | 빠른 복원용. 현재 14일이고 off-host가 생기면 줄여도 된다 |
| off-host 일간 | **30일** | 파일럿 규모에서 「언제부터 잘못됐나」를 되짚기에 충분 |
| off-host 월간 | **3~6개월** 중 택1 | 장기 보존 필요 여부는 사업 판단 |

**값은 제안이고 결정이 아니다.**

---

## 4. Secrets / env 인벤토리

이름만 적는다. **값은 저장소에 들어가지 않는다.**

### 4-A. 호스트에서 생성 (받아오는 값이 아니다)

| 이름 | 생성 |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand` |
| `SELLEROPS_JWT_SECRET` | `openssl rand -base64 48` (≥32자, placeholder 금지 — `deploy.sh`가 검사) |
| `SELLEROPS_VAULT_MASTER_KEY` | `openssl rand -base64 32` (AES-256) · **off-host 사본 필수(R-12)** |

### 4-B. product-owner / 외부에서 받는 값

| 이름 | 출처 |
|---|---|
| `PILOT_PUBLIC_HOST` | product-owner |
| `PILOT_ACME_EMAIL` | operator |
| `SELLEROPS_CONNECTOR_CAFE24_CLIENT_ID` · `_CLIENT_SECRET` | Cafe24 앱 |
| `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI` · `_RESULT_URL` | 보통 **비워 둔다** — overlay가 host에서 파생 |

### 4-C. 이 파일럿의 자세 (값이 아니라 결정)

`CAFE24_ENABLED=true` · NAVER·Coupang·mock **전부 false** · seed 셋 **false** ·
`SELF_PILOT_ENABLED=true` + `SCOPE=CONNECTED_SELLERS` + **`COLLECT_SCHEDULER_ENABLED=true`** ·
`INQUIRY_PUBLISH_EXECUTION_ENABLED=false` · `REVIEW_PUBLISH_EXECUTION_ENABLED=false` ·
`PROACTIVE_ENABLED=false` · `RESPONSIBILITY_SCHEDULER_ENABLED=false` ·
`PILOT_GUIDED_HELPER_ENABLED=false`(Cafe24는 도우미 불필요) · `MAIL_MODE≠dev-outbox` ·
`FLYWAY_BASELINE_ON_MIGRATE=false`.

**AI capability**: 켜는 것마다 키가 있어야 하고, 세 retrieval capability는 **org를 이름으로**
나열해야 한다(`*` 금지). 전부 끈 채 시작해도 READ + Draft lane은 **초안이 없을 뿐** 동작한다 —
켤지 여부는 별도 결정이다.

### 4-D. B5가 추가로 요구하는 것 (아직 이름이 없다)

**이 이름들은 이제 정식 계약이다** — `SELLEROPS_BACKUP_S3_ENABLED` · `_BUCKET` · `_REGION` ·
`_ENDPOINT` · `_ACCESS_KEY_ID` · `_SECRET_ACCESS_KEY`. `pilot.env.example`에 선언돼 있고
`deploy.sh`·`preflight.sh`가 같은 이름을 검사한다.

**컨테이너에는 일부러 넘기지 않는다.** `backup.sh`는 cron으로 **호스트에서** 돌고 업로드하는
컨테이너는 하나도 없다 — compose에 이름을 적으면 애플리케이션 프로세스가 쓸 코드 경로도 없는
객체 저장소 자격을 쥐게 된다. compose는 같은 `--env-file`을 읽으므로 이름을 **보기는 한다**;
하지 말아야 할 일은 그것이 컨테이너 안으로 넘어가는 것이고, `docker-compose.yml`에 그 이유가
적혀 있다.

---

## 5. 예상 월 비용 — 자리만

**값을 추측하지 않는다.** 단가는 계정·리전·약정에 따라 달라지는 **외부 사실**이고 이 저장소가
검증할 수 없다. operator가 채운다.

| 항목 | 수량 | 월 비용 |
|---|---|---|
| compute instance (2 vCPU / 4 GB) | 1 | _______ |
| root volume 40 GB+ | 1 | _______ |
| 공인 IPv4 주소 | 1 | _______ |
| egress 트래픽 | 파일럿 규모 | _______ |
| object storage 저장 (백업) | §3-F 보존 정책에 따름 | _______ |
| object storage 요청/전송 | 일 1회 업로드 | _______ |
| DNS zone | 1 | _______ |
| **합계** | | **_______** |

TLS 인증서는 **Let's Encrypt로 비용 0**이다(Caddy 자동 발급/갱신) — 이것은 추측이 아니라 선택한
구성의 성질이다.

---

## 6. Acceptance criteria — 무엇이 있어야 CLOSED인가

### 6-A. B4 `CLOSED` 조건

| # | 확인 | 합격 |
|---|---|---|
| B4-1 | `PILOT_PUBLIC_HOST`가 정해졌고 A 레코드가 이 호스트를 가리킨다 | `preflight.sh`의 DNS 항목 ok |
| B4-2 | 80/443만 외부에서 열려 있다 | `smoke.sh`의 raw port 4종 미공개 ok |
| B4-3 | TLS가 그 이름으로 발급·서비스된다 | `https://<host>/` **200**, `http://` → **301/308** |
| B4-4 | `/api` · `/agent-runtime` · SPA가 **한 origin**에서 라우팅된다 | `smoke.sh` health 3종 ok |
| B4-5 | **번들 CSP가 사이트 origin을 이름 짓고 loopback runtime을 이름 짓지 않는다** | `smoke.sh`의 CSP 검사 ok — 이미지가 overlay 없이 빌드되면 판매자 브라우저가 **자기 컴퓨터**를 runtime으로 부른다 |
| B4-6 | Cafe24 redirect URI가 등록값과 **byte-identical** | `smoke.sh`의 redirect URI 검사 ok |
| B4-7 | 재부팅 후 사람 개입 없이 복귀 | reboot → B4-3·B4-4 재통과 |
| B4-8 | `deploy.sh` 7단계 전부 통과, `smoke.sh` **실패 0** | 로그 |

**B4-1 ~ B4-8 전부 ok일 때만 B4 CLOSED.**

### 6-B. B5 `CLOSED` 조건

| # | 확인 | 합격 |
|---|---|---|
| B5-1 | 일 1회 덤프가 **자동으로** 돈다 | cron 설치됨 · 연속 **2일** 객체 생성 확인 |
| B5-2 | 덤프가 **호스트 밖** 버킷에 도착한다 | 객체 키·바이트 수 대조 |
| B5-3 | 업로드 자격이 **지울 수 없다** | 그 자격으로 `DeleteObject` 시도 → **거부** |
| B5-4 | 보존 정책이 집행된다 | lifecycle 설정 확인(스크립트가 아니라 버킷이 집행) |
| B5-5 | **성공과 실패가 둘 다 보인다** | 성공 1건 · **고의 실패 1건**(잘못된 자격)이 로그에 남고 알림이 도착 |
| B5-6 | vault master key의 **off-host 사본**이 존재하고 열린다 | 백업과 다른 보관소에서 꺼내 대조 |
| B5-7 | **호스트 장애 복구 리허설** | **새 인스턴스**에 clone → `pilot.env` 재작성(키는 B5-6에서) → `restore.sh` → `smoke.sh` 통과 → **Cafe24 자격이 실제로 열린다** |
| B5-8 | 복원 후 데이터가 맞는다 | 복원 전후 org/문의/리뷰 행 수 일치 |
| **B5-9** | **읽을 수 없는 덤프는 스키마를 지우기 전에 거절된다** | 새 호스트에서 잘린 덤프로 `restore.sh` → **non-zero 종료 · `DROP SCHEMA` 0회 · DB 무변경**, 그 뒤 정상 덤프로 B5-7이 그대로 통과 |

**B5-7이 핵심이다.** 같은 호스트에서 복원하는 것은 볼륨 손상은 증명해도 **호스트 상실**은 증명하지
못한다. B5의 정의가 「host 자체 장애에서도 복구 가능」이므로 리허설도 새 호스트여야 한다.

#### B5-7의 restore guard 계약

리허설이 확인하는 것은 「정상 덤프가 복원된다」만이 아니다. **복구가 실패하는 방식**도 acceptance의
일부다 — 이 계약이 없으면 B5-7은 좋은 덤프 하나에 대해서만 참이고, 정작 호스트를 잃은 날 손에 쥔
것이 잘린 덤프였을 때 무슨 일이 벌어지는지는 아무도 확인한 적이 없게 된다.

| | 계약 |
|---|---|
| **정상 덤프** | 새 호스트에서 **정상 복원**된다 — 프롬프트 → 서비스 중지 → 스키마 재생성 → 복원 → 재기동, 그리고 B5-8의 행 수 대조 통과 |
| **손상·잘린 덤프** | **`DROP SCHEMA` 이전에 거절**된다. `pg_restore --list`가 아카이브를 끝까지 읽지 못하면 그 자리에서 non-zero 종료(`exit 3`)이고 이후 어떤 명령도 실행되지 않는다 — 서비스 중지조차 하지 않는다 |
| **거절 시** | 기존 **DB mutation 0**. 검증 단계는 파일을 열지 데이터베이스를 열지 않으며(`--list`는 `-d`를 받지 않는다) 거절된 실행이 남기는 DB 변경은 **없다** |

이 셋이 B5-9이고, 구현과 회귀는 `deploy/pilot/restore.sh` · `deploy/pilot/restore-guard.test.sh`가
소유한다(실제 DB·컨테이너·네트워크 없이 도는 harness). **리허설은 그 harness를 다시 돌리는 것이
아니라 새 호스트에서 같은 성질을 관측하는 것이다** — harness는 스크립트의 제어 흐름을 고정하고,
B5-9는 그 제어 흐름이 실제 postgres와 실제 덤프에 대해서도 같은지를 묻는다.

**B5-1 ~ B5-8 전부 ok일 때만 B5 CLOSED.**

---

## 7. 그 다음 — clean-org rehearsal R1–R15 실행 순서

`docs/pilot_readiness_v3.md` §6의 합격 기준을 **어떤 순서로** 돌릴지 정한다. 기준 자체는 그 문서가
소유하고 여기서 바꾸지 않는다.

**전제**: B4 CLOSED · B5-1~B5-6 확인. (B5-7은 §7-D에서 R12·R13과 함께 돈다.)

| 단계 | 항목 | 비고 |
|---|---|---|
| **A. 배포 자체** | R1 deploy · R2 Flyway · R3 smoke · R4 데모/합성 0 | 실패하면 여기서 멈춘다. 뒤 단계가 전부 이것 위에 선다 |
| **B. 첫 사용자** | R5 signup + 연결 전 홈 | **연결 전에** 확인한다 — 한 번 연결하면 이 화면은 이 org에서 다시 관측할 수 없다 |
| **B′. org를 이름으로 등록** | org UUID 확인 → rollout/capability allow-list 기입 → scheduler·model capability 설정 → **재기동 1회** | **아래 §7-0.** 이 단계가 빠져 있었고, 그것이 감사가 찾은 모순이다 |
| **C. 연결과 수집** | R6 Cafe24 OAuth → **R7 첫 수집 도착(시계로 측정)** → R8 Inquiry READ + `GROUNDED` draft → R9 전송 도달 불가 확인 | R7이 **B3 수정의 라이브 증명**이다. R9는 「WRITE는 꺼져 있다」를 화면에서 확인한다 |
| **D. 복구** | R10 컨테이너 재시작 → R11 호스트 재부팅 → **R12 백업/복원 · R13 off-host 사본** | 실제 데이터가 생긴 **뒤에** 돌아야 의미가 있다. 빈 DB 복원은 아무것도 증명하지 않는다 |
| **E. 시간이 필요한 것** | R14 로그 유계(24시간) · R15 ERROR 0 | R14는 **S3(로그 로테이션)이 닫힌 뒤에만** 통과할 수 있다 |

### 7-0. clean-org runbook — canonical 순서 (2026-09-26 정정)

**앞선 표에는 모순이 있었다.** A→B→C는 R8(`GROUNDED` draft)과 「자동 확인 시작」을 C에 놓는데, 그 둘이
의존하는 값들은 **org UUID를 이름으로 요구**한다 — `SELLEROPS_KNOWLEDGE_*_ORG_IDS`(세 retrieval
capability는 `*` 금지, 공란 금지) · `SELLEROPS_AGENT_*_ORG_IDS` · `RESPONSIBILITY_RUNTIME_ORG_IDS`.
그런데 **그 UUID는 R5(signup)가 끝나야 존재한다.** 즉 배포 시점의 env로는 원리적으로 채울 수 없고,
채워 넣은 값은 **재기동해야 읽힌다**. 순서를 적지 않은 문서는 운영자에게 이것을 현장에서 발견하게 한다.

canonical 순서는 다음과 같다. **재기동은 두 번뿐이고, 두 번 다 이유가 있다.**

| # | 단계 | 왜 여기인가 |
|---|---|---|
| 1 | signup / login / org 생성 | 연결 전 홈(R5)은 **이 org에서 지금만** 관측 가능하다 |
| 2 | **org UUID 확인** | 아래 전부의 입력. 화면 또는 DB에서 읽는다 |
| 3 | **rollout / capability allow-list 기입** | `*` 금지·공란 금지가 `deploy.sh`와 백엔드 boot validator 양쪽에 있다 |
| 4 | scheduler + 필요한 model capability 설정 | self-pilot·collect 두 짝, responsibility scheduler, 켜는 capability마다 키 |
| 5 | **stack restart (1회차)** | 3·4는 env이고 env는 재기동으로만 읽힌다 |
| 6 | **Cafe24 OAuth** | 3·5 뒤에 두는 것이 canonical — 아래 주석 |
| 7 | automatic collect 도착 | R7. 연결 후 ≤5분 + ≤60초 ⇒ **≈6분**, 시계로 잰다 |
| 8 | Inquiry 생성 | 실제 고객 문의 1건이 수집돼 work item이 된다 |
| 9 | 자동 확인 시작 | 3에서 rollout에 이름이 올라가 있어야 버튼이 존재한다 |
| 10 | Goal / Knowledge / draft / approval | R8. 모델 호출은 이 경로에만 |
| 11 | Home 확인 | 숫자·상태가 9·10과 일치하는지 |
| 12 | **별도 WRITE decision** | 여기까지가 READ 파일럿이다. 아래는 다른 결정이다 |
| 13 | WRITE env + 판매자 재동의 | `…PUBLISH_EXECUTION_ENABLED` · 승인 ID · `CLIENT_IP` · `SHOP_NO` + `mall.write_community` 재동의 |
| 14 | **stack restart (2회차)** | 13이 env이기 때문. WRITE를 켜지 않으면 이 재기동도 없다 |
| 15 | publish | 자기 **단일 사용 승인**을 따로 받는다 |
| 16 | exact read-back | 2xx가 아니라 exact READ 1회로 본문 해시 == 승인 초안 |
| 17 | convergence | 다음 수집에서 채널 상태와 우리 상태가 일치하는지 |

**Cafe24 OAuth(6)는 allow-list(3) 앞뒤 어느 쪽에도 놓을 수 있다** — 연결 자체는 org UUID를 이름으로
요구하지 않는다. 그럼에도 **첫 파일럿 runbook은 allow-list를 먼저**로 적는다: 뒤에 놓으면 3·4를 채우고
재기동하는 순간이 연결 이후로 밀려 **재기동이 한 번 더** 생기고, 그 재기동은 방금 연결한 판매자의 첫
수집 창과 겹친다. 한 번 줄이는 쪽이 canonical이고, 다른 순서가 **틀린 것은 아니다**.

12~17은 `pilot_readiness_v3.md` §6-2가 이미 소유한 결정이다 — 이 표는 그것을 **순서 위에 얹기만** 한다.

### 7-A. 순서가 이렇게 되는 이유

- **B′가 A와 C 사이인 이유는 §7-0**이다 — org UUID는 R5의 산출물이고, 그것을 이름으로 요구하는
  값들은 재기동으로만 읽힌다.
- **R5는 연결 전에만 관측 가능**하다. 앞선 패키지들이 「연결 전 첫 화면은 이 org에서 관찰 불가」로
  두 번 보고했던 것이 정확히 이 순서 문제다.
- **R7은 시계로 잰다** — 「스케줄이 생겼다」가 아니라 **데이터가 도착했다**를 본다. 연결 후
  ≤5분(self-pilot) + ≤60초(collect poller)이므로 **≈6분**이 예상이고, 예상과 다르면 그 자체가 결과다.
- **R10~R13은 D단계**다. R12를 빈 DB에서 돌리면 복원이 아무것도 되돌리지 않는다.
- **R14는 S3에 걸려 있다.** 로그 로테이션이 없는 상태로 24시간을 재면 결과는 「유계가 아니다」이고,
  그것은 rehearsal의 실패가 아니라 **아직 닫지 않은 should-fix의 확인**이다.

### 7-B. rehearsal 중 하지 않는 것

marketplace WRITE **0**(R9가 그 부재를 확인한다) · `main` 병합 **0** · RC1 태그 변경 **0** ·
실제 고객에게 나가는 답변 **0**.

### 7-C. 통과 이후

R1–R15 전부 통과하면 남는 결정은 **Cafe24 Inquiry Human Approval WRITE를 켤 것인가** 하나이고,
그것은 `pilot_readiness_v3.md` §3 결정 6에 따라 **B2·B3·S1이 닫힌 지금** 비로소 열리는 질문이다.
켠다면 그 실행은 **자기 단일 사용 승인**을 따로 받는다.

---

## 8. 이 문서가 하지 않은 것

- 인프라를 만들지 않았다. **billable 리소스 0.**
- 인프라를 만들지 않았다 — 버킷·자격·호스트·DNS **0**. (§2-E의 스크립트 구현과 §6-B의 restore
  guard는 그 뒤 별도 커밋에서 착지했고, 이 문서의 계획 자체는 바뀌지 않았다.)
- 비용을 추측하지 않았다. §5는 자리만이다.
- 리전·계정·도메인 이름·버킷 이름을 정하지 않았다 — 전부 product-owner 입력이다.
- `release/pilot-cafe24-v1`과 `pilot-cafe24-v1-rc1`을 건드리지 않았다.
