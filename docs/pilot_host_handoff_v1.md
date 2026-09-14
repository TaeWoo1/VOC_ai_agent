# Pilot Host Handoff v1

2026-09-14. 파일럿을 공개 호스트로 넘기는 데 필요한 것 전부 — **값 하나(`PILOT_PUBLIC_HOST`)를 빼고** 확정.
코드 기능 개발 **0**. topology는 `pilot_host_provisioning_v1.md` / `pilot_runtime_foundation_v1.md` §10이
소유하고 이 문서는 다시 쓰지 않는다.

## 1. public HTTPS single origin

**origin 하나**가 모든 것을 받는다 — SPA · `/api` · agent runtime. Caddy가 앞에 서고 raw port는 공개하지
않는다(`deploy/pilot/` overlay가 `ports: !reset []`).

- 프론트는 same-origin `/api/*`를 부른다(`VITE_API_BASE_URL=""`).
- 판매자 브라우저는 그 origin에서 **자기 PC의 도우미**(`http://127.0.0.1:47615`)로 loopback 호출을 한다.
  그 호출이 CSP `connect-src`에 들어가는 것은 **빌드 시점 플래그**의 결과다(§2).

**고정 outbound IPv4는 이 파일럿의 요건이 아니다.** Coupang 브라우저 취득에서 마켓플레이스로 나가는
트래픽은 **판매자 Mac의 브라우저**가 내고, 우리 호스트는 Coupang에 아무 요청도 하지 않는다. A 레코드가
가리킬 공인 IPv4는 필요하지만 **등록용 고정 IP는 아니다**. (고정 IP를 요구하는 것은 NAVER 커머스와 Coupang
OpenAPI이며, 둘 다 이 파일럿에서 **꺼진다** — §2.)

## 2. exact env

`deploy/pilot/pilot.env.example`의 이름 그대로. 체크아웃 **밖**에 두고 `deploy.sh`가 검증한다.

| 변수 | 값 | 왜 |
|---|---|---|
| **`PILOT_PUBLIC_HOST`** | `<도메인>` | **미정 — 유일한 blocker** |
| **`PILOT_ACME_EMAIL`** | 운영자 메일 | Let's Encrypt |
| **`PILOT_GUIDED_HELPER_ENABLED`** | **`true`** | `VITE_ENABLE_AGENT_BRIDGE`가 되어 CSP `connect-src`에 loopback을 넣는다. **false면 브라우저가 도우미 호출을 차단하고 판매자에게는 「설치 필요」가 영원히 보인다** |
| **`PILOT_HELPER_BRIDGE_URL`** | `http://127.0.0.1:47615` | loopback이어야 하고 `deploy.sh`가 검사 |
| **`POSTGRES_PASSWORD` · `SELLEROPS_JWT_SECRET`** | 생성 | — |
| **`SELLEROPS_VAULT_MASTER_KEY`** · `SELLEROPS_VAULT_KEY_ID` | 생성 / `pilot-v1` | credential 봉인 |
| `SELLEROPS_SEED_ENABLED` · `_DEMO_CONTENT` · `_DEMO_ENTRY` | `false` | 데모 계정·콘텐츠 없음 |
| `SELLEROPS_CONNECTOR_MOCK_ENABLED` · `_MOCK_FALLBACK_ENABLED` | `false` | mock은 실패하지 않고 **성공**하며 합성 행을 `REAL`로 쓴다 |
| `SELLEROPS_CONNECTOR_NAVER_ENABLED` | `false` | **켜면 `ADVERTISED_EGRESS_IPS`를 요구한다** — 이 파일럿에 필요 없는 고정 IP를 끌어들인다 |
| `SELLEROPS_CONNECTOR_CAFE24_ENABLED` | `false` | 켜면 byte-identical HTTPS callback + 앱 자격 |
| `SELLEROPS_CONNECTOR_COUPANG_ENABLED` | `false` | **브라우저 취득은 Coupang API를 부르지 않는다.** 켜면 스케줄러가 등록되지 않은 IP에서 pull을 시도해 반복 실패로 시끄러워진다 |
| `SELLEROPS_SELF_PILOT_*` | 기본값 | 이 lane은 스케줄러가 없다 |
| `SELLEROPS_AGENT_*` | `false` | 파일럿 결정, 이 lane과 무관 |

## 3. DNS / TLS / deploy

1. A 레코드 `<도메인>` → 호스트 공인 IPv4.
2. 방화벽 **80/443만**. TLS는 Caddy가 ACME로 자동 발급.
3. `pilot.env`를 채우고 `deploy/pilot/deploy.sh` — pull → env 검증 → build → up(Flyway) → health → smoke.
4. `smoke.sh`가 **서빙된 번들의 CSP**에 도우미 origin이 있는지와 사이트 origin이 맞는지 실제로 확인한다.
5. 판매자 회원가입 → 쿠팡 계정 만들기 → **업체코드 입력**(§5) → 도우미 설치·연결 → 지금 동기화.

## 4. package build · architecture-specific artifact

```
REVIEWNARY_APP_URL=https://<도메인> REVIEWNARY_BASE_URL=https://<도메인> \
  tools/helper/build-macos.sh
```

- **판매자 Mac과 같은 아키텍처의 Mac에서 빌드한다.** cross-build를 주장하지 않고, 설치 프로그램은
  `BUILD.txt`의 `arch`가 그 Mac과 다르면 **거절**한다. arm64 ↔ arm64, x86_64 ↔ x86_64.
- 개발용 스탬프(localhost)를 담은 패키지는 설치 프로그램이 **거절**한다(`REVIEWNARY_ALLOW_LOCAL_INSTALL`로만 우회).
- universal 패키지 · 자동 업데이터 · 서명/공증은 **만들지 않는다**.
- 산출물 `dist/reviewnary-helper-macos-<arch>/` ≈ **616MB**(Chromium 포함).

## 5. checksum / private delivery

```
cd dist && tar czf reviewnary-helper-macos-<arch>.tgz reviewnary-helper-macos-<arch>
shasum -a 256 reviewnary-helper-macos-<arch>.tgz
```
운영자가 **비공개 경로**로 전달(공개 다운로드 페이지 없음). 판매자 Mac에서 설치 전 같은 명령으로 대조.
전달물에 자격·개인정보 **없음**(감사: `pilot_distribution_first_seller_onboarding_v1.md` §1-4).
설치는 Gatekeeper 때문에 **우클릭 → 열기**가 필요하다(서명 없음, 운영자 동반).

## 6. rollback

| 상황 | 조치 |
|---|---|
| 브라우저 수집만 끄기 | `tools/helper/browser-collection.sh off` → `LOCAL_HELPER` |
| 도우미 제거 | `reviewnary 도우미 제거.command` (device token도 서버에서 revoke) |
| 기기 연결만 해제 | 설정 › 연결된 기기 → 연결 해제 |
| 배포 되돌리기 | 이전 이미지로 `deploy.sh` 재실행; DB는 `backup.sh`/`restore.sh`(같은 호스트 볼륨) |
| 판매자가 막혔을 때 | `service.mjs status` **한 줄** — 사이트 · 수집 모드 · 버전. 비밀·개인정보·마켓플레이스 데이터 0 |

## 7. host에 실제로 필요한 외부 값

| 값 | 누가 정하나 |
|---|---|
| **`PILOT_PUBLIC_HOST`** 도메인 | **product owner — 없으면 빌드도 배포도 불가** |
| `PILOT_ACME_EMAIL` | 운영자 |
| 호스트(리전/사양)와 A 레코드 | 운영자 |
| 첫 판매자 Mac의 아키텍처 | 판매자에게 확인 |

DB 비밀번호 · JWT 비밀 · vault 마스터 키는 **생성**하는 값이지 받아야 하는 값이 아니다.
