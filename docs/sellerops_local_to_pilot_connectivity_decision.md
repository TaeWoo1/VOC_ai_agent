# Decision — SellerOps Local-to-Pilot Connectivity (NAVER egress IP · Cafe24 callback)

> Status: **ACCEPTED (operations decision), 2026-08-05.** 이 문서는 **개발·내부 테스트 단계부터
> pilot 전환까지** SellerOps의 두 외부 연결 결정 — ① **NAVER API egress(공인 IP)**, ② **Cafe24 OAuth
> callback URL** — 의 정본이다. 토폴로지 결정(단일 production host + 고정 공인 IPv4, AWS면 EC2/Lightsail
> + 고정 IP)의 근거·비교는 여기서 소유하지 않고, 그 상위 결정 메모리를 참조한다(§6). 본 문서는 **단계별
> 역할·절차·전환 트리거**만 확정한다.
>
> **왜 새 문서인가.** 저장소에는 배포·연결(egress/callback) 운영을 총괄하는 정본 문서가 없다.
> `docs/sellerops_local_agent_runtime_adr.md`는 **로컬 에이전트 런타임 경계**를,
> `docs/multi-channel-connector-roadmap.md`는 **커넥터 전략**을 소유하며, egress·callback 운영 결정은
> 지금까지 슬라이스 open-question(`docs/slices/naver-guided-connection.md:1129·1372`)과 감사 기록에만
> 흩어져 있었다. 이 결정은 그 문서들 위에 걸치므로 별도 decision 문서로 둔다.
>
> **정직성·보안 경계.** 이 문서는 **역할과 절차만** 기록한다. 실제 공인 IP·credential·Secret·SSH
> private key는 git·정본 문서·메모리에 **저장하지 않는다**; 실제 값은 로컬 env 또는 secret manager에서
> 관리한다. 아래 production 항목(24시간 서버, 고정 egress IP)은 **현재 미프로비저닝**이며, 본 문서는
> 방향을 확정하되 구현·프로비저닝을 주장하지 않는다.

---

## 1. 맥락 (저장소 증거)

- **NAVER API 호출 주체 = backend.** 3개 엔드포인트(oauth2/token + pay-order product-orders
  last-changed-statuses/query)가 모두 backend JVM 기본 outbound 소켓
  (`JdkNaverHttpClient` → `PacingNaverHttpClient`)로 나간다. **proxy·egress 고정·egress-IP config
  key 없음** → egress IP = 호스트의 NAT/공인 IP. Local Agent(collector)는 NAVER REST를 **0회** 호출
  (브라우저 안내 전용).
- **Cafe24 callback = backend 수신.** `SELLEROPS_CONNECTOR_CAFE24_REDIRECT_URI`
  (기본 `http://localhost:8080/api/connect/cafe24/callback`) + `SELLEROPS_CONNECTOR_CAFE24_RESULT_URL`
  (기본 `http://localhost:3000/connect/cafe24/result`) (`backend/src/main/resources/application.yml`).
  제품 backend는 `/api/connect/cafe24/callback`을 쓴다(미추적 dev 도구 `tools/cafe24-callback`의
  `/cafe24/callback`과 상이 — `docs/sellerops_canonical_reference.md` D18).
- **현행 라이브 증거:** Cafe24 first-connection·inquiry live proof는 **운영자의 공개 터널**로 callback을
  수신하고 redirect_uri를 등록값과 byte-match했다(`docs/sellerops_cafe24_first_connection_tutorial_live_proof.md:13`).
  NAVER 라이브 증거는 모두 **운영자 로컬 backend egress**를 테스트 앱에 수동 allow-list한 것이다.
  → 둘 다 **개발·검증 전용**이며 pilot 정본이 아니다.

## 2. 결정

### 2.1 개발·내부 테스트 단계

- backend·frontend·Local Agent를 **개발자 컴퓨터**에서 실행한다.
- NAVER API 호출은 **로컬 backend**가 수행한다.
- NAVER **테스트 애플리케이션**에는 **현재 개발 네트워크의 공인 IPv4**를 `API 호출 IP`로 등록한다.
- 공유기 재연결·네트워크 이동·VPN 등으로 공인 IP가 바뀌면 **수동 갱신**한다.
- 로컬 backend는 NAVER **outbound** 호출을 위해 외부에 공개할 필요가 없다.
- 이 방식은 **개발·내부 검증 전용**이며 실제 판매자 pilot 운영에 사용하지 않는다.

### 2.2 Cafe24 개발 단계

- OAuth callback은 **외부에서 접근 가능한 HTTPS URL**이 필요하다.
- **지금부터 고정된 공개 callback URL을 유지**한다.
- **임시 터널 URL을 정본 callback으로 사용하지 않는다**(개발 편의의 일회성 터널은 정본이 아니다).
- 개발 backend가 로컬이어도 **callback 주소 자체는 고정**한다.
- pilot 전환 시 **callback URL을 바꾸기보다**, callback이 향하는 **내부 처리 목적지를 production으로
  전환**하는 구조를 우선한다(등록된 redirect_uri를 안정적으로 유지).

### 2.3 Pilot 전환

- production backend를 **24시간 실행 가능한 서버**로 이전한다.
- NAVER API outbound를 **고정 공인 IPv4 1개**로 고정한다.
- AWS 사용 시 **EC2 또는 Lightsail + 고정 IP**가 후보다.
- **실제 egress == 고정 IP**를 host / container / reboot / redeploy 기준으로 검증한다.
- 판매자에게는 **production 고정 IP만** NAVER 앱에 등록하도록 안내한다.
- **로컬·staging IP는 production 사용자에게 노출하지 않는다.**
- **Cafe24 callback을 production 처리 경로에 연결**한다(§2.2의 "목적지 전환" 구조).
- backend advertised-egress config, FE setup contract, IP 등록 tutorial, 오류 진단을 함께 반영한다(§5).

### 2.4 전환 트리거

다음 중 하나가 발생하기 **전까지 AWS 프로비저닝을 미룬다**:

- 외부 pilot 판매자 연결 예정
- 24시간 주문 수집 필요
- 개발자 PC가 꺼져도 수집 지속 필요
- Cafe24/NAVER 실제 production 연동 시작

### 2.5 보안·기록

- 실제 공인 IP·credential·Secret·SSH key는 **git·정본 문서·메모리에 저장하지 않는다.**
- 문서에는 **환경별 역할과 절차만** 기록한다.
- 실제 값은 **로컬 env 또는 secret manager**에서 관리한다.

## 3. 환경별 역할·egress·callback 표

| 환경 | 실행 위치 | NAVER egress IP (API 호출 IP) | Cafe24 callback | 판매자 노출 |
|---|---|---|---|---|
| **개발·내부 테스트** | 개발자 PC (로컬 backend) | 개발망 현재 공인 IPv4, **수동 갱신**, 테스트 앱에만 등록 | 고정 공개 HTTPS callback URL, 목적지=로컬 처리 | **없음** (테스트 앱 전용) |
| **staging** (선택) | 별도/미정 | 별도 IP 또는 미고정, **판매자 미노출**, 자체 테스트 앱 | 고정 callback URL(정본과 분리) | **없음** |
| **production (pilot)** | 24시간 서버 (AWS EC2/Lightsail 후보) | **고정 공인 IPv4 1개**, egress==IP 검증, seller가 자기 앱에 등록 | 동일 고정 callback URL, 목적지=production 처리 경로 | **production 고정 IP만** |

- production NAVER egress 총수는 향후 확장해도 **≤ 3**(NAVER 앱 `API 호출 IP` 상한).
- callback URL은 단계 간 **불변**을 지향; 바뀌는 것은 callback이 향하는 **내부 목적지**다.

## 4. 정정 사항 (이 문서가 대체·정정)

- 이전 상태 **"즉시 AWS 프로비저닝 대기"** → **"pilot 직전까지 연기"** 로 정정한다. AWS 프로비저닝은
  §2.4 전환 트리거 중 하나가 발생하기 전까지 착수하지 않는다. (연기 대상은 프로비저닝이며, 결정된
  토폴로지 자체는 유효하다 — §6.)
- Cafe24 정본 callback을 **터널 URL로 두는 임시 관행**을 폐기하고, **고정 공개 callback URL**을 지금부터
  유지한다(§2.2).

## 5. 이후 코드 단위 (pilot 전환 시, 미구현 — 본 문서 범위 밖)

인프라(고정 egress 확보·egress==IP 검증) → **B2** backend advertised-egress config
`SELLEROPS_NAVER_ADVERTISED_EGRESS_IPS`(인프라 보장값 **선언**, IP 고정 장치 아님; ≤3 IPv4; secret 주입;
부재⇒fail-safe) + 배포 시 `declared==observed` fail-closed 검증 게이트 → **B3** FE setup contract
`naverAdvertisedEgressIps: string[]`(위생 처리, FE 하드코딩 금지) → **B4** 튜토리얼 'API 호출 IP 등록'
단계(복사 버튼, `주문 관련 API 그룹` 인접) → **B5** token/order error-CODE 화이트리스트 매퍼 →
`REASON_IP_NOT_ALLOWED` / `REASON_MISSING_ORDER_PERMISSION`. 코드·인프라·live·push 없음(문서 결정만).

## 6. 참조

- 토폴로지 결정(단일 host + 고정 IPv4, AWS⇒EC2+EIP)·근거·3안 비교: 세션 메모리
  `naver-fixed-egress-deployment-decision-v1`.
- 프로비저닝 런북·검증 매트릭스·연기 상태: 세션 메모리 `naver-fixed-egress-provisioning-v1`.
- egress 부재 감사·오류 진단 gap: 세션 메모리 `naver-api-egress-ip-readiness-audit-v1`.
- 필요 권한·`주문 관련 API 그룹`: 세션 메모리 `naver-required-api-permissions-audit-v1`.
- 런타임 경계: `docs/sellerops_local_agent_runtime_adr.md`. 커넥터 전략:
  `docs/multi-channel-connector-roadmap.md`. NAVER 연결 슬라이스 open-question:
  `docs/slices/naver-guided-connection.md` §(고정 IP 필요 여부·IP 불일치 reason code).
