# SellerOps Phase 0 — ESM+ Discovery & Generic-Surface Validation

채널 일반화(channel-generic)된 SellerOps 운영자 표면이 **두 번째 커머스 채널(ESM+)** 을 수용할 수 있는지를
**커넥터를 만들지 않고** 검증·문서화하는 discovery 슬라이스. 라이브 수집·적재 슬라이스가 아니다.

관련 문서(본 문서는 이들 **위에 얹는다** — 중복 정의하지 않고 참조):
- 수집 전략·채널별 계약: `docs/multi-channel-connector-roadmap.md` (이하 Connector Roadmap)
- 제품 범위 경계: `docs/product-scope-v1.md`
- ESM 어댑터 아키텍처: `docs/sellerops_phase3d_multi_channel_adapters.md`

> Status: DISCOVERY (planning + 가드레일 테스트). 본 슬라이스는 ESM+ 라이브 접속을 수행하지 않으며,
> 어떤 ESM+ capability도 CONFIRMED로 표기하지 않는다.

---

## 1. ESM+ ↔ `GMARKET` 정합 (catalog reconciliation)

"ESM+"는 신규 채널이 아니라 **현재 카탈로그의 `GMARKET` 채널과 동일하다.** 카탈로그는 G마켓·옥션을
의도적으로 단일 코드 `GMARKET` 으로 모델링한다(`AUCTION` 코드는 없음). 이미 존재하는 것:

- `backend/.../connector/esm/EsmApiConnector.java` — JWT 인증 **스켈레톤**. `dedicatedChannels() = {GMARKET}`,
  `capabilities()` 의 `supportedDataTypes` 는 **빈 집합**(수집 가능한 DataType 없음). `sellerops.connector.esm.enabled=true`
  플래그 뒤에만 빈으로 존재하며, 꺼져 있으면 GMARKET은 mock 커넥터로 resolve된다.
- `EsmJwtSigner` — self-signed HS256 JWT, `aud = sa.esmplus.com`, `ssi` 클레임에 G마켓·옥션 seller id 동시 수용.
- `GMARKET` `CredentialTemplate`, `MockDataSeeder` / 프론트 `mocks.ts` 의 GMARKET 시드.

**방향(승인됨): 본 슬라이스는 `GMARKET` 을 재사용한다.** 별도 `ESMPLUS` 코드를 신설하지 않는다 — 그것은
`EsmApiConnector` 주석이 "별도 승인이 필요한 channel-catalog 변경"이라 명시한 카탈로그 변경이며 GMARKET을
중복시킨다. 새 코드·새 credential template·새 DataType 없음.

## 2. 로그인/접근 가정

- 인증: ESM Trading API 계열은 **self-signed JWT(HS256)**. 발급 토큰 엔드포인트가 없다 — 스켈레톤은
  **HTTP를 전혀 수행하지 않는다**(서명만 offline 검증).
- 자격증명 단위: ESM+ Master ID + 발급 secret key (+ issuer, gmarket_seller_id, optional auction_seller_id).
  org-scoped credential vault에 보관 (`GMARKET` CredentialTemplate 기존 형상 그대로).
- 식별/테넌시: seller account ↔ credential 바인딩은 기존 vault 경로 사용. 신규 테넌시 모델 불필요.

## 3. Export/다운로드 가능성

**미확인 (discovery 필요).** ESM 판매자센터 export(주문/리뷰/문의)의 존재·포맷·자동화 가능성은
Connector Roadmap §4 체크리스트로 별도 확인해야 한다. 2FA/CAPTCHA 빈도, 세션 지속성, rate-limit
프로파일 모두 미측정. 본 슬라이스는 어떤 export도 시도하지 않는다.

## 4. 대상 데이터 도메인 & source type

기존 `DataType` enum {`REVIEW`, `INQUIRY`, `ORDER_SUMMARY`, `PRODUCT`, `SALES`} 에 매핑 — **새 DataType 없음.**

| DataType | ESM+ 현재 추정 (Connector Roadmap §4.1) | 비고 |
|---|---|---|
| ORDER_SUMMARY | API 가설 (etapi.gmarket.com) | 스켈레톤은 fetch 미구현; 스키마는 후속 승인 슬라이스 |
| REVIEW | discovery 필요 | **공식 리뷰 API 문서화 안 됨** — export/manual 후보 |
| INQUIRY | discovery 필요 | export/manual 후보 |

## 5. 예상 API/파일 형상 (알려진 범위)

- API: ESM Trading API(`etapi.gmarket.com`, 지마켓 운영), JWT 인증. 주문/문의/상품 스키마는 후속 승인 슬라이스.
- 파일: 리뷰 export 형상 미확인. manual upload 매핑 가능성(HeaderAliases/RowMapper 흡수 여부)은 discovery 항목.

## 6. 미지(Unknowns) & 리스크

- 공식 리뷰 API 부재 가능성 → REVIEW는 manual/EXPERIMENTAL부터 시작 (product-scope-v1 §6 약속 규칙).
- 라이브 리스크: 2FA/CAPTCHA, 세션 지속성, rate limit, 계정 잠금. 라이브 검증은 Connector Roadmap §8 별도 승인.
- 테넌시: Master ID 1개가 G마켓·옥션 양쪽 seller id를 carry — org당 credential 1개로 양 마켓 커버.

## 7. 채널 일반화 표면에의 매핑 (검증 결과)

핵심 발견: **표면마다 일반화 수준이 다르다.** 두 부류로 갈린다.

| 표면 | ESM+/GMARKET 오늘 상태 | 일반화 수준 |
|---|---|---|
| **Capability overview** (`GET /api/channels/{code}/capabilities/overview`) | `connectorClass="API"`, `autoCollectSupported=true`, 모든 DataType `supported=false` / `verificationStatus="UNSUPPORTED"`. **CONFIRMED 없음.** | **완전 일반화** — `CollectControlService.channelCapabilityOverview` 가 커넥터의 **in-code** `ConnectorCapabilities` 를 읽는다(`connector_capabilities` DB 행 불필요). GMARKET이 `EsmApiConnector` 로 resolve → 정직한 빈 capability. |
| **Dashboard summary** | 계정-scoped 일반 구조는 동작하나 수집 데이터 없음 → 빈 상태 | DTO 일반화. 데이터 소스만 부재. |
| **Attention signals / `OperatorVocItem` / `safePreview`** (PR #131–133) | GMARKET 계정 → **safe empty / zero-signal** (예외 없음, 누수 없음) | **DTO/계약은 일반화.** PR #135부터 데이터 접근은 channel-generic `VocItemSource` 로 위임된다(아래 gap 노트). |
| **`VocPreviewSanitizer`** | 입력이 평문 텍스트 → 채널 무관 | **이미 일반화** — 소스가 생기면 그대로 재사용. |

**문서화된 gap (PR #135로 부분 해소):** attention 계약(OperatorVocItem/safePreview)은 일반화돼 있고, PR #135가
read-side 데이터 접근을 채널 일반화된 `VocItemSource` + `VocItemSourceRegistry` 뒤로 추출했다 —
`OperatorAttentionService` 는 더 이상 `Cafe24CommunityArticleRepository` 에 직접 의존하지 않는다. **Cafe24가
첫 어댑터(`Cafe24VocItemSource`)** 이고, **GMARKET은 아직 실제 source 어댑터가 없어** registry 정책상 safe empty
를 반환한다(허위 신호 없음). 실제 ESM+/GMARKET attention 피드는 별도의 source 어댑터(또는 ESM 소스 테이블)와
라이브 discovery가 필요하며 향후 작업이다.

## 8. 최소 어댑터 계약 (ESM+ 수집 전 필요 조건)

ESM+에서 어떤 데이터든 수집하려면 최소한:
1. `EsmApiConnector.fetch` 의 실제 DataType별 스키마 구현(현재 미구현, 후속 승인 슬라이스) — capability가
   해당 DataType를 `supported`로 올리는 근거.
2. attention/drill-down/preview가 의미를 가지려면 **GMARKET `VocItemSource` 어댑터**(PR #135의 seam에 연결)
   또는 ESM 전용 소스 테이블. read-side seam(`VocItemSource`/registry)은 PR #135에서 이미 준비됨.
3. (선택) credential template/route 조정 — 현재 GMARKET 형상으로 충분.

`DataType` enum, `ConnectorCapability`/`connector_capabilities` 구조, `ChannelCapabilityOverview` DTO,
`OperatorVocItem`/`safePreview` 계약은 **변경 불필요** — 이미 채널 일반화돼 있다.

## 9. status 어휘 주의 & 본 슬라이스의 deferral

두 어휘가 공존한다 (혼동 금지):
- **in-code capability** `verificationStatus`: `CONFIRMED | NEEDS_VERIFICATION | UNSUPPORTED` (커넥터/overview).
- **수집 전략 status** (Connector Roadmap §10, 부록 A): `CONFIRMED | EXPERIMENTAL | UNSUPPORTED`.

원안에서 제안된 `NEEDS_DISCOVERY` / `UNKNOWN` 상태값은 **본 슬라이스에서 도입하지 않는다(deferred)** —
새 status 문자열은 프론트 badge 매핑(`CapabilityBadges.tsx`)을 건드리고, "다음 단계 제공" 류 로드맵 문구
금지(product-scope-v1 §5/§7)와의 정합을 따로 검토해야 한다. ESM+는 오늘 기준 **모든 DataType UNSUPPORTED**
로 정직하게 표기되며, 그 이상은 후속 슬라이스에서 다룬다.

## 10. 안전 확인

- 본 슬라이스는 **ESM+ 라이브 수집을 수행하지 않았다.** 브라우저·로그인·다운로드·업로드·DB 변경·스케줄러·
  manualSync/backfill 없음. fake LAST_SUCCESS 없음. 어떤 ESM+ capability도 CONFIRMED로 표기하지 않음.
- 산출물: 본 문서(docs) + 읽기 전용 가드레일 테스트(§7의 비대칭을 고정). production 코드/프론트 변경 없음.
  새 DataType/Flyway/application.yml/secret 없음.
- 비밀정보(Master ID·seller id·secret key·JWT·raw 응답)는 본 문서/로그/PR에 출력하지 않음.
