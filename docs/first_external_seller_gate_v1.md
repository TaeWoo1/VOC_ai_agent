# First External Seller Gate v1

2026-09-14. product/code feature **freeze**. 새 acquisition/execution capability **0** ·
마켓플레이스 WRITE 0 · 클릭 0 · 다운로드 0 · pagination 0 · 실행 LLM 0 · 마이그레이션 0 · 코드 변경 **0**.

두 가지만 한다 — **A** PENDING Coupang 계정에서 취득이 실제로 되는지 라이브로 확정하고, **B** 공개 호스트로
넘기는 데 필요한 것을 값 하나만 빼고 전부 확정한다.

---

## A. PENDING Coupang live validation — **LIVE PASS**

승인 `apr-cp-aside-pending-082a2b` / run `wt-73ba5a54`.

### A-1. 무엇을 PENDING으로 만들었나

운영자 소유 Coupang 계정을 **`connection_status=PENDING` · `last_synced_at=NULL`**로 두고 돌렸다(원래 값
`CONNECTED` / `2026-09-05 20:30:11`을 먼저 기록하고 **끝난 뒤 정확히 복원**했다).

**왜 새 계정을 만들지 않았는지 적어 둔다.** identity가 MATCH하려면 credential에 운영자의 진짜 `vendor_id`가
있어야 하는데, **그 값을 되읽는 제품 경로가 없다** — `GET …/credentials`는 메타데이터만 돌려준다(설계대로).
새 계정에 심으려면 vault를 직접 복호화해야 했고, 그것은 credential material을 손으로 다루는 일이다. 계정의
**상태만** 바꾸면 같은 술어를 건드리지 않고 검사할 수 있다.

**그래서 이 증명의 한계도 정확히 말한다**: 이것은 「status 게이트가 없다」를 증명하지, 「한 번도 연결된 적
없는 계정이 다른 모든 면에서 같다」를 증명하지 않는다. 보이는 절반(`last_synced_at=NULL` → 「수집 이력
없음」)은 함께 재현했다.

### A-2. 결과

| | |
|---|---|
| 실행 시점 계정 | **`PENDING` · `last_synced_at NULL`** |
| readiness | **`READY`** |
| identity | **MATCH** |
| read | `ok` · 10행 · `rolesResolved 5` · pager 1/3 · **`llmCalls 0`** · 3,915ms |
| walk | `fresh 9 · known 1 · PAGE_LIMIT_REACHED · pages 1` |
| handoff | **received 9 · stored 0 · skipped 9 · failed 0** (dedup — 같은 페이지) |
| sync_jobs | `PARTIAL · SELLER_CENTER_READ · ACTION_WINDOW · 0/9/0 · PAGE_LIMIT_REACHED` |
| Core / Home | `lastSuccessfulSyncAt 2026-09-14T05:45:40Z` · COUPANG `REAL` 69 → 69 |
| 마켓플레이스 | 클릭 0 · 키입력 0 · 다운로드 0 · WRITE 0 · pagination 0 · off-host 0 |

**그리고 화면 읽기는 계정을 연결하지 않는다** — run 뒤에도 상태는 `PENDING`이었다. `PREPARING`에서 올라온
`ORDER_SUMMARY` sync만 `CONNECTED`로 옮기고, 이 lane은 그 경로가 아니다.

### A-3. UI가 OpenAPI 미연결을 acquisition blocker처럼 말하는가 — **아니다**

PENDING 상태로 채널 화면을 렌더해 확인: 「상품평 가져오기」 섹션 정상 렌더 · readiness `READY` ·
「연결 전」 / 「연결되지 않」 / 「먼저 연결」 / 「API 연결이 필요」 **한 문장도 없음**.
연결 상태 패널은 「수집 이력 없음」이라고만 말한다 — 수집에 대한 사실이지 게이트가 아니다.

### A-4. OpenAPI-independent acquisition — **참이다. 다만 한 단어를 정확히 해야 한다**

코드에서 읽은 취득 게이트는 넷이고 **`connectionStatus`는 그중에 없다** — 채널이 COUPANG · 파일 업로드
계정이 아님 · session slot 존재 · credential에 `vendor_id` 존재. session slot은 읽기 한 번으로 **지연
생성**되고, credential 저장 경로(`storeCredential`)에는 **connector-enabled 게이트가 없다**.

**그러나 `vendor_id`를 담는 폼은 Coupang credential 폼 하나뿐이고 그 세 칸은 전부 `required`다.** 즉
판매자는 **Wing OpenAPI 키를 발급받아야** 업체코드를 저장할 수 있다 — 그 키가 **작동할 필요는 없다**
(성공 호출 0 · `CONNECTED` 불필요 · 따라서 **호출 IP 등록 불필요**).

> 「OpenAPI 연결은 필수조건이 아니다」는 **연결**에 대해 참이고 **키 발급**에 대해서는 참이 아니다.
> 제품에는 이미 guided issuance 흐름이 있으므로 새 작업은 아니지만, 첫 판매자 체크리스트에 들어가야 한다.

---

## B. Production host handoff

코드 기능 개발 **0**. 값 하나(`PILOT_PUBLIC_HOST`)를 빼면 전부 확정돼 있다.

### B-1. exact env — Coupang Aside 파일럿 최소 집합

`deploy/pilot/pilot.env.example`의 이름 그대로. **굵은 것이 이 lane에 필수**이고, 나머지는 명시적으로 끈다.

| 변수 | 값 | 왜 |
|---|---|---|
| **`PILOT_PUBLIC_HOST`** | `<도메인>` | **미정 — 유일한 blocker** |
| **`PILOT_ACME_EMAIL`** | 운영자 메일 | Let's Encrypt |
| **`PILOT_GUIDED_HELPER_ENABLED`** | **`true`** | 이것이 `VITE_ENABLE_AGENT_BRIDGE`가 되고 CSP `connect-src`에 loopback을 넣는다. **false면 브라우저가 도우미 호출을 차단하고 판매자에게는 「설치 필요」가 영원히 보인다** |
| **`PILOT_HELPER_BRIDGE_URL`** | `http://127.0.0.1:47615` | loopback이어야 하고 `deploy.sh`가 검사한다 |
| **`POSTGRES_PASSWORD` · `SELLEROPS_JWT_SECRET`** | 생성 | — |
| **`SELLEROPS_VAULT_MASTER_KEY` · `SELLEROPS_VAULT_KEY_ID`** | 생성 / `pilot-v1` | credential 봉인 |
| `SELLEROPS_SEED_*` | 전부 `false` | 데모 계정·콘텐츠 없음 |
| `SELLEROPS_CONNECTOR_MOCK_*` | 전부 `false` | mock은 실패하지 않고 **성공**하며 합성 행을 `REAL`로 쓴다 |
| `SELLEROPS_CONNECTOR_NAVER_ENABLED` | `false` | **켜면 `ADVERTISED_EGRESS_IPS`를 요구한다 — 이 lane에 필요 없는 고정 IP를 끌어들인다** |
| `SELLEROPS_CONNECTOR_CAFE24_ENABLED` | `false` | 켜면 byte-identical HTTPS callback + 앱 자격을 요구한다 |
| `SELLEROPS_CONNECTOR_COUPANG_ENABLED` | **`false` 권장** | 이 lane은 Coupang API를 부르지 않는다. 켜면 스케줄러가 등록되지 않은 IP에서 API pull을 시도해 **반복 실패**로 시끄러워진다. credential 저장은 이 플래그와 무관하다(검증됨) |
| `SELLEROPS_AGENT_*` | 기본 `false` | 파일럿 결정 사항, 이 lane과 무관 |

**미검증**: 「Coupang 커넥터를 끈 채 판매자가 연결 마법사로 credential을 등록하는」 전체 경로는 이 세션에서
돌려 보지 않았다. 검증된 것은 `storeCredential`에 connector 게이트가 없다는 코드 사실뿐이다(§8-2).

### B-2. DNS / TLS / deploy 순서

1. A 레코드 `<도메인>` → 호스트 공인 IPv4 (**고정일 필요 없음** — 이 lane은 outbound IP를 등록하지 않는다).
2. 80/443만 공개. TLS는 Caddy가 ACME로 자동 발급(`PILOT_ACME_EMAIL`).
3. `deploy/pilot/pilot.env`를 **체크아웃 밖**에 두고 위 값을 채운다.
4. `deploy/pilot/deploy.sh` — pull → env 검증 → build → up(Flyway) → health → `smoke.sh`.
   `smoke.sh`가 **서빙된 번들의 CSP**에 도우미 origin이 있는지, 사이트 origin이 맞는지 실제로 확인한다.
5. 회원가입 → Coupang 연결 마법사에서 키 3종 입력(§A-4) → 화면에서 session slot 생성.

`pilot_host_provisioning_v1.md` / `pilot_runtime_foundation_v1.md` §10이 topology를 이미 소유한다 —
이 문서는 다시 쓰지 않는다.

### B-3. package build command (아키텍처별)

```
REVIEWNARY_APP_URL=https://<도메인> REVIEWNARY_BASE_URL=https://<도메인> \
  tools/helper/build-macos.sh
```

- **판매자 Mac의 아키텍처와 같은 Mac에서 빌드한다.** 스크립트는 cross-build를 주장하지 않고, 설치 프로그램은
  `BUILD.txt`의 `arch`가 그 Mac과 다르면 **거절**한다. arm64 판매자에겐 arm64, x86_64 판매자에겐 x86_64.
- universal 패키지 · 자동 업데이터 · 서명/공증은 **만들지 않는다**(이번 결정).
- 산출물: `dist/reviewnary-helper-macos-<arch>/` — 약 **616MB**(Chromium 포함).

### B-4. checksum / 전달

```
shasum -a 256 <(cd dist && tar cf - reviewnary-helper-macos-<arch>)   # 또는 zip 후 shasum
```
- 운영자가 **비공개 경로**로 전달(operator-assisted private distribution). 공개 다운로드 페이지 없음.
- 전달물에 자격·개인정보 **없음**(감사 완료: `pilot_distribution_first_seller_onboarding_v1.md` §1-4).
- 판매자 Mac에서 설치 전 같은 명령으로 대조.

### B-5. rollback / support

| 상황 | 조치 |
|---|---|
| 브라우저 수집을 끄고 싶다 | `tools/helper/browser-collection.sh off` → `LOCAL_HELPER` |
| 도우미를 지우고 싶다 | `reviewnary 도우미 제거.command`(device token도 서버에서 revoke) |
| 기기 연결만 끊고 싶다 | 설정 › 연결된 기기 → 연결 해제 |
| 판매자가 막혔다 | `service.mjs status` **한 줄**(사이트 · 수집 모드 · 버전; 비밀·개인정보·마켓플레이스 데이터 0) |
| 잘못된 패키지를 받았다 | 설치 프로그램이 arch 불일치와 개발용 스탬프를 **거절**한다 |

---

## C. READY_FOR_FIRST_EXTERNAL_SELLER — **NO (blocked on one value)**

| | |
|---|---|
| PENDING 계정에서 취득 | **PASS** (§A) |
| UI가 미연결을 blocker로 말하지 않음 | **PASS** (§A-3) |
| 패키지 재현성·무결성·진단 | **PASS**(직전 패키지) |
| 아키텍처별 산출물 절차 | **PASS** (§B-3) |
| rollback/support | **PASS** (§B-5) |
| **공개 HTTPS Reviewnary 호스트** | **없음 — blocker** |

---

## D. PRODUCT_DECISION_NEEDED

1. **`PILOT_PUBLIC_HOST` 도메인과 배포 대상.** §B-1의 첫 줄이자 §B-3 빌드 명령의 두 값. 이것 없이는
   파일럿 패키지를 구울 수도, 판매자 브라우저가 닿을 origin도 만들 수 없다.
2. **첫 판매자 Mac의 아키텍처**(arm64 / x86_64) — 빌드는 같은 아키텍처의 Mac에서 해야 한다.
3. **Wing OpenAPI 키 발급을 첫 판매자 온보딩에 포함할 것인가** — 취득에 키가 *작동할* 필요는 없지만
   `vendor_id`를 저장하려면 키 3종을 **입력**해야 한다(§A-4).
