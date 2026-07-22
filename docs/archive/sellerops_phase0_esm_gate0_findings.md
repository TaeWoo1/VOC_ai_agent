# SellerOps Phase 0 — ESM+/GMARKET Gate 0 오프라인 데이터 도메인 체크리스트 (findings)

`docs/sellerops_phase0_esm_live_discovery_protocol.md`(이하 Discovery Protocol)의 **Gate 0만 실행한 결과**다.
Gate 0은 **오프라인 공개 문서 검토**이며, ORDER_SUMMARY / REVIEW / INQUIRY 각 도메인을 `UNKNOWN`/`미확인`에서
**문서 레벨 증거 라벨**로 끌어올린다. 라이브 접속·로그인·자격증명·브라우저·클릭·다운로드·업로드·credentialed API 호출은
**전혀 하지 않았다.**

> Status: GATE 0 — offline 문서 검토만. 라이브 미수행. 어떤 capability도 CONFIRMED로 표기하지 않는다. production
> status 문자열·코드·프론트·테스트를 변경하지 않는다.

관련 문서(본 문서는 이들 **위에 얹는다** — 중복 정의하지 않고 참조):
- 게이트·체크리스트 템플릿·증거 사다리: Discovery Protocol §3/§4/§7.
- 채널별 공식 API 현황·자격증명·rate limit: `docs/sellerops_phase3d_multi_channel_adapters.md`(이하 Phase 3D) §2.3.
- ESM+↔GMARKET 카탈로그 정합·status deferral: `docs/sellerops_phase0_esm_discovery.md`(이하 ESM Discovery) §1/§4/§9.
- sanitized 출력·status 어휘: `docs/multi-channel-connector-roadmap.md`(이하 Connector Roadmap) §9/§10.
- 약속 규칙·UI 정직성·drift guard: `docs/product-scope-v1.md`(이하 Product Scope) §5/§6/§9.

---

## 1. Gate 0 범위

- **수행한 것**: 저장소 내 이미 캡처된 공식-문서 기반 사실(Phase 3D §2.3 등)의 재정리 + **공개 ESM/Gmarket 문서**
  검토(공개 포털·공개 API 가이드).
- **하지 않은 것**: ESM+/Cafe24 라이브 호출, 로그인, 자격증명 사용, 브라우저 자동화, 판매자센터 비공개 페이지 접근,
  클릭, 다운로드/업로드, credentialed API 호출, DB 변경, 스케줄러/manualSync/backfill.
- Gate 0은 Discovery Protocol §3 게이트 표의 최하단 단계(read-only pre-flight 이전)다. 본 결과는 라이브 디스커버리
  (Gate 1+)를 **시작하지 않으며**, 어떤 결론도 그 자체로 라이브 수집·CONFIRMED 표기를 허가하지 않는다(별도 슬라이스·별도 승인).

## 2. 검토한 레퍼런스

Connector Roadmap 스타일에 따라 **간결한 레퍼런스 이름**으로 기록한다(raw deep-link URL·이메일 주소·비밀정보 미기재).

**저장소(이미 캡처된 공식-문서 파생 사실)**: Phase 3D §2.3, ESM Discovery §1/§4/§9, Connector Roadmap §9/§10,
Product Scope §5/§6/§9.

**공개 ESM/Gmarket 문서**(포털 `etapi.gmarket.com`, 운영: 주식회사 지마켓; 엔드포인트 호스트 `sa2.esmplus.com`;
인증가이드 `etapi.ebaykorea.com`):
- "주문 | 배송 API" 카테고리 — 주문조회(`RequestOrders`)·입금확인중 주문조회(`PreRequestOrders`, 5초당 1콜)·
  주문상태조회·발송처리·외부주문 조회·배송진행정보 조회.
- "지마켓/옥션 주문조회 API 호출수 제한 안내(2025-04-23 적용)" — 주문조회 5초당 1콜.
- "판매자문의 조회 API"(`/item/v1/communications/customer/bulletin-board`) 및 "판매자 문의 답변 내용 추가 안내".
- "상품 등록/수정/전환/조회 API" 카테고리(상품), "API 인증가이드"(JWT HS256).
- ESM PLUS 고객관리 공식 매뉴얼 — 판매자센터 UI에 **'상품평 관리'** 기능 언급(단, Trading API 카테고리에는 리뷰 없음).

> 메모: API 카테고리 구성은 **상품 / 주문·배송 / 클레임 / 정산 / CS(=판매자문의) / 서비스**다. **리뷰·상품평 조회
> 카테고리는 공개 API에 존재하지 않는다.** CS는 '판매자문의'(INQUIRY)이며 구매후기(REVIEW)가 아니다.

## 3. 도메인별 Gate 0 체크리스트

Discovery Protocol §4 템플릿의 셀을 **공개 문서 증거로 채운 결과**다(빈칸이었던 셀의 승격). 모든 값은 **문서 레벨**이며,
정확한 스키마·볼륨·PII는 라이브(Gate 1+) 전까지 단정하지 않는다.

| 항목 | ORDER_SUMMARY | REVIEW | INQUIRY |
|---|---|---|---|
| **Gate 0 증거 상태** | **`NEEDS_VERIFICATION`** | **`NEEDS_DISCOVERY`** | **`NEEDS_VERIFICATION`** |
| 추정 메뉴/페이지 | 주문·배송 관리 계열 | 판매자센터 '상품평 관리' UI (API 아님) | 문의/Q&A (CS) 계열 |
| 공식 API 존재 | **있음** — 주문·배송 API(`RequestOrders`/`PreRequestOrders`/주문상태조회/배송진행정보) | **없음(문서화 안 됨)** — 리뷰 조회 API 부재 | **있음** — 판매자문의 조회 API(7일 조회창) |
| export 존재 | 미확인 (Gate 1/2) | 미확인 (Gate 1/2) | 미확인 (Gate 1/2) |
| 리포트/이메일 경로 | 미확인 | 미확인 | 미확인 |
| 날짜 필터 존재 | 있음(추정) — 기간 기반 주문조회 | 미확인 | 있음(추정) — **7일 조회창** 제약이 기간 파라미터 시사 |
| 계정/스토어 범위 선택자 | Master ID가 G마켓·옥션 양측 carry; 한도는 "per seller ID per token" | 미확인 | Master ID carry; G마켓은 `qnaType=3`만, SSG.COM 문의 응답 포함(공식 안내) |
| 페이지네이션/리스트 형상 | 미확인 (라이브 확인) | 미확인 | 미확인 — 단, `status` 코드 필터 존재(전체/미처리/처리완료/처리중/중복) |
| 행 단위 PII/식별자 노출 여부 | **높음** — 주문은 구매자/수령인/주소 포함 가능 → 강한 sanitize 필요 | 미확인 — 리뷰는 작성자/본문 포함 가능 | 중간 — 문의 본문/작성자 포함 가능 → 본문은 `safePreview` 경유 |
| `sourceCreatedAt` 등가 존재 | 있음(추정) — 주문/결제 일시 | 미확인 | 있음(추정) — 문의 등록 일시 |
| status/replyStatus/rating 존재 | 주문 상태값 존재(주문상태조회); rating 해당 없음 | rating 미확인(공식 API 부재) | **replyStatus 등가 있음** — `status`(미처리/처리완료/처리중) + 답변내용 파라미터 |
| 상품 식별자 노출 & sanitize | 노출 가능 → **16-hex salted 해시로만** | 미확인 → 동일 규칙 | 노출 가능 → **16-hex salted 해시로만** |
| 연동 경로 판정 | **공식 API** | 공식 API 경로 = **likely unsupported**; export/manual 경로 = 미확인 | **공식 API** |
| Gate 1/2 라이브 필요 | 예 (스키마·페이지네이션·날짜필터·PII 표면 확인) | 예 (판매자센터에 리뷰 export/list 존재 여부 육안 확인) | 예 (7일창 페이지네이션·스키마·`status`→replyStatus 매핑 확인) |
| 승격에 필요한 증거 | 권한 발급 → 라이브 end-to-end 1회 + 스키마 확인 | export/manual 경로 식별 + 스키마 (API 경로는 부재로 종결할 근거 없음 — Gate 0 한계) | 권한 발급 → 라이브 end-to-end 1회 + `status`→replyStatus 매핑 확인 |

도메인 노트:
- **ORDER_SUMMARY** — 공식 API 경로가 가장 명확하다(엔드포인트·rate limit 공개). 그러나 주문은 **PII 표면이 가장 크고**,
  주문 요약(ORDER_SUMMARY)으로 쓰려면 행 단위 식별자를 sanitize/집계하는 매핑이 라이브 확인 필요.
- **REVIEW** — 공개 Trading API에 **리뷰 조회 API가 없다.** 판매자센터 UI에는 '상품평 관리'가 있으나, 이것이 export
  가능한지·자동화 가능한지는 **Gate 0에서 알 수 없다.** 따라서 API 경로만 "likely unsupported"로 기록하고, terminal
  UNSUPPORTED 판정은 **Gate 1/2로 보류**한다. Product Scope §6에 따라 REVIEW는 **manual/EXPERIMENTAL부터** 출발한다.
- **INQUIRY** — 공식 API가 문서화돼 있고, `status`(미처리/처리완료/처리중)가 **attention 루프의 replyStatus 신호에
  직결**된다(UNANSWERED_INQUIRY / UNKNOWN_REPLY_STATUS 등). 7일 조회창은 페이지네이션/창 이동 전략을 라이브로 확인해야 한다.

## 4. 발견 요약 (Korean-first)

- **공개 문서상 viable해 보이는 것**: **ORDER_SUMMARY**와 **INQUIRY** — 둘 다 공식 ESM Trading API 경로가 있다. 단,
  **권한 발급이 선행**돼야 하며(수동·재량 이메일 신청 + IP allowlisting), 이는 보장되지 않는다(Phase 3D §2.3:
  "내부 사정으로 거절될 수 있음").
- **여전히 미지**: REVIEW의 실제 연동 경로(공식 API 부재 → 판매자센터 export/manual 가능성 미확인); 모든 도메인의
  export/리포트·이메일 경로; 라이브 스키마·페이지네이션·날짜필터 동작·실제 PII 표면·볼륨.
- **미래 Gate 1/2에서 먼저 볼 도메인**: **INQUIRY 추천.** 이유 — (1) 공식 API가 문서화돼 있고, (2) `status`가
  replyStatus 신호에 직결돼 SellerOps attention 루프에 **즉시 가치**가 있으며, (3) 주문 대비 **PII 표면이 낮다.**
  그 INQUIRY Gate 1 사전 준비(허용 sanitized 관측·중단 조건·복붙 관측 양식)는
  `docs/sellerops_phase0_esm_inquiry_gate1_readiness.md`에 정의돼 있다(Gate 1 미실행).
- **Gate 0에서 추론하면 안 되는 것**:
  - 어떤 도메인도 **CONFIRMED 아님** — 라이브 end-to-end 미통과.
  - 라이브 스키마·정확한 페이지네이션·날짜필터·볼륨·PII 구성을 **단정 금지**.
  - 권한 발급이 **보장된다고 가정 금지**(재량 거절 가능).
  - REVIEW를 **terminal UNSUPPORTED로 단정 금지** — 공식 API 경로만 부재이고, UI/export 경로는 미검증이다.

## 5. 상태 규율

- 본 문서의 `UNKNOWN`/`NEEDS_DISCOVERY`/`NEEDS_VERIFICATION`은 Discovery Protocol §7의 **증거 사다리(문서 레벨 전용)**
  라벨이다. **production enum/status 문자열·코드·프론트 badge 매핑을 변경하지 않는다**(ESM Discovery §9 deferral과 일치).
  - in-code capability `verificationStatus`: `CONFIRMED | NEEDS_VERIFICATION | UNSUPPORTED`.
  - 수집 전략 status: `CONFIRMED | EXPERIMENTAL | UNSUPPORTED`(Connector Roadmap §10).
- 오늘 기준 ESM+/GMARKET은 모든 DataType이 정직하게 **UNSUPPORTED / safe-empty / no-CONFIRMED**이며, 본 PR은 이를
  **바꾸지 않는다.** 기존 가드 테스트가 고정한다(이미 통과 중, 본 PR 신규 추가 없음):
  - `ChannelCapabilityOverviewTest.esmGmarketOverviewExposesNoConfirmedDataType`
  - `EsmApiConnectorTest.capabilitiesExposeNoCollectableDataType` / `unsupportedDataTypesThrowWithZeroHttp`
  - `EsmAttentionEmptyStateTest.gmarketAccountWithNoArticlesYieldsEmptySummary` / `gmarketDrilldownReturnsAnEmptyPage`
- 새 DataType 없음 — 미래 confirmed 시 기존 `{REVIEW, INQUIRY, ORDER_SUMMARY, PRODUCT, SALES}`에 매핑(Discovery
  Protocol §8 경로).

## 6. 안전 확인

- 본 Gate 0은 **라이브 미수행**: ESM+/Cafe24 호출·로그인·자격증명·브라우저·클릭·다운로드·업로드·credentialed API·DB
  변경·스케줄러·manualSync/backfill **없음**.
- 산출물: 본 문서(docs) + Discovery Protocol §4에 1줄 포인터. production 코드/프론트/테스트/`application.yml`/secret/
  DataType/Flyway 변경 **없음**.
- 비밀정보(Master ID·seller id·secret key·JWT·raw 응답·신청 이메일 주소)는 본 문서/로그/PR에 출력하지 않았다.
- 검토는 **공개 문서만** 사용했고, 판매자센터 비공개 페이지에는 접근하지 않았다.
