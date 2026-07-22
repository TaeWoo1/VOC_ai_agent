# SellerOps Phase 0 — ESM+/GMARKET INQUIRY Gate 1 결과 (findings)

사람이 감독하는 **Gate 1 시각 내비게이션**(ESM+/GMARKET **INQUIRY 전용**)이 **1회 완료**되었다. 본 문서는 그
관측 결과를 **sanitized(불리언/버킷/카테고리만, 비밀·PII 0건)** 로 기록하고, 그 해석과 **데이터 보유(data-bearing)
표면을 위한 제약된 Gate 2 read-only probe 프로토콜**을 정의한다.

> Status: GATE 1 FINDINGS — **사람-관측 라이브 내비게이션 1회 완료.** **본 PR(문서)은 추가 라이브 접속을 수행하지
> 않는다.** INQUIRY 전용. 어떤 capability도 CONFIRMED로 표기하지 않는다. production status 문자열·코드·프론트·테스트를
> 변경하지 않는다. INQUIRY는 `NEEDS_VERIFICATION`로 유지된다.

관련 문서(본 문서는 이들 **위에 얹는다** — 중복 정의하지 않고 참조):
- Gate 1 준비·허용/금지 관측·관측 양식: `docs/sellerops_phase0_esm_inquiry_gate1_readiness.md`(이하 Readiness Packet)
  §4/§6/§7/§8.
- 게이트 정의·candidate-index(Gate 2–3)·증거 사다리: `docs/sellerops_phase0_esm_live_discovery_protocol.md`
  (이하 Discovery Protocol) §5/§6/§6.1/§7.
- Gate 0 결과·INQUIRY 우선 근거: `docs/sellerops_phase0_esm_gate0_findings.md`(이하 Gate 0 Findings) §3/§4.
- sanitized 출력 규칙·로드맵 상태: `docs/multi-channel-connector-roadmap.md`(이하 Connector Roadmap) §4.1/§9.

---

## 1. Gate 1 sanitized 결과 (관측값 없음 — 불리언/카테고리만)

Readiness Packet §7 관측 양식의 필드를 그대로 채운다. **실제 값·본문·식별자·정확한 행 수·raw timestamp 없음.**

- Gate: Gate 1 (사람-관측 라이브 내비게이션 1회 완료)
- Domain: INQUIRY
- 문의/CS 메뉴 카테고리 존재: **yes**
- 문의 페이지(상품문의/고객문의/bulletin-board류) 가시: **yes**
- 날짜 필터 존재: **yes**
- 날짜 범위 제약: **`custom`** — UI 관측상 **3개월 단위, 최대 약 1년 전까지** 조회 가능 (자세한 해석은 §2 (b))
- status / reply-status 필터 존재: **yes**
- status 값이 일반 카테고리로 보임: **yes** (`in-progress`(처리중) 포함 — 개별 레코드 아님)
- 페이지네이션 존재: **yes**
- 검색/필터 컨트롤 존재: **yes**
- 리스트 행 가시: **yes**
- 본문 보려면 상세 페이지 필요: **no** (리스트 자체가 본문을 노출 — 즉 **data-bearing**)
- 페이지에 PII/고객 식별자가 있는 것으로 보임: **yes** *(값 없음)*
- 페이지에 문의 본문 텍스트가 있는 것으로 보임: **yes** *(텍스트 없음)*
- export 버튼 존재: **yes** — **관측만, 클릭 안 함**
- 답변(reply) 액션 컨트롤 존재: **yes** — **관측만, 클릭 안 함**
- 상품/계정/스토어 선택자 모호성: **no** (선택 모호하지 않음)
- 중단 조건 발생: **none**

## 2. 증거 해석 (Evidence interpretation)

어떤 해석도 CONFIRMED를 부여하지 않는다.

- **(a) 더 유망하나 더 위험.** INQUIRY는 메뉴·필터·상태·페이지네이션이 모두 **확인**되어 surface·signal(특히
  replyStatus) 잠재력이 높다. 그러나 리스트가 **data-bearing**(PII·문의 본문이 리스트에 노출, 상세 클릭 불필요)이라,
  행을 자유롭게 스캔하면 PII/본문을 캡처할 위험이 있다 — Gate 2를 **제약**해야 하는 핵심 이유.
- **(b) UI 표면 ≠ API 표면 (windowing divergence — 어느 쪽도 "틀렸다"고 단정하지 않음).**
  - **UI 관측값**: 날짜 범위가 **3개월 단위, 최대 약 1년 전**까지.
  - **API 문서 가정 / 현재 스켈레톤**: **7일 청크** (`EsmInquiryDateWindow.SEVEN_DAY_MAX`, Gate 0 §3의 공개 API 가정).
  - 이 둘은 **서로 다른 표면**(판매자센터 UI vs. 공식 API)이며, 본 Gate 1은 **UI만** 관측했다. 공식 API가 실제로
    7일 윈도우를 강제하는지/그렇지 않은지는 **`NEEDS_VERIFICATION`** — **라이브 API 스키마가 검증되기 전까지 API
    가정을 "틀렸다"고 결론짓지 않는다.** 7일 청킹 스켈레톤은 그대로 두고, divergence는 미래 라이브 read-only
    probe에서 해소한다.
- **(c) Gate 2는 행을 자유롭게 스캔할 수 없다.** Readiness Packet §8의 "data-bearing이면 멈추고 더 제약된 Gate 2를
  요구한다" 분기에 해당 → §3의 제약된 프로토콜을 따른다.

## 3. 제약된 Gate 2 프로토콜 (data-bearing 표면용 read-only probe)

Discovery Protocol §6의 candidate-index(Gate 2–3) **기본 절차에 얹는 제약 델타**다. 기본 절차를 여기서 재서술하지
않는다(§6 참조). 본 절은 **설계 문서**이며 **실행이 아니다** — 도구·플래그·자동화를 도입하지 않고, 실행은 **별도
1회성 명시 승인**을 요구한다.

**금지 (data-bearing 표면이므로 §6보다 강화):**
- 행 **본문/내용 스캔** 금지
- 스크린샷 금지 · raw HTML 금지
- 어떤 **값 복사**도 금지 · 식별자 금지 · 문의 제목/본문/답변 텍스트 금지
- 비즈니스 민감 **정확한 행 수** 금지

**허용 (안전한 컨테이너/컨트롤만):**
- 메뉴 / 날짜 필터 / status 셀렉터 / 페이지네이션 / 검색·필터 / export·reply **컨트롤의 존재 여부**를
  boolean·category로만.
- 행은 **개수 버킷**(`zero|one|few|tens|hundreds|thousands_plus`, Connector Roadmap §9)까지만 — 행 **내용은 보지
  않는다.**
- status 값은 **일반 카테고리**(unprocessed/processed/in-progress/unknown)로만, 개별 레코드 아님.

**클릭 정책:**
- 기본 **무클릭**.
- 데이터 미노출이 보장되는 **컨트롤에 한해**, 별도 승인 시 **정확히 1회**(fallback 선택자·2차 클릭 없음, §6 절차).
- export / download / upload / reply / write 컨트롤은 **존재만 기록, 클릭 금지**(Gate 4/5 경계, §6 7항).

**즉시 중단 (Readiness Packet §6 재사용):**
- data-bearing 콘텐츠가 **캡처될** 상황 / 안전 관측 **전에** PII 노출 / 모호 / 동의·액션 모달 / 2FA·CAPTCHA /
  계속하려면 비공개 데이터를 복사해야 함.

## 4. 상태·안전 푸터

INQUIRY는 별도 승인된 **비파괴 end-to-end 검증 경로**가 생기기 전까지 **`NEEDS_VERIFICATION`로 유지**된다(Discovery
Protocol §7 — 문서 레벨 라벨, production status 불변). 비밀정보(Master ID·seller id·secret key·JWT·raw 응답)는 본
문서/로그/PR에 출력하지 않는다. 본 문서는 production 코드·프론트·테스트·`application.yml`·secret·DataType·Flyway를
변경하지 않는다.

오늘 기준 ESM+/GMARKET이 정직하게 **UNSUPPORTED / safe-empty / no-CONFIRMED** 임은 기존 가드 테스트가 고정한다(이미
통과 중, 본 PR 신규 추가 없음):
`ChannelCapabilityOverviewTest.esmGmarketOverviewExposesNoConfirmedDataType`,
`EsmApiConnectorTest.capabilitiesExposeNoCollectableDataType`,
`EsmAttentionEmptyStateTest.gmarketAccountWithNoArticlesYieldsEmptySummary` / `gmarketDrilldownReturnsAnEmptyPage`.

PR #141의 offline INQUIRY read 스켈레톤(`com.sellerops.connector.esm.inquiry`)은 **unwired**이며 wire shape는
`NEEDS_VERIFICATION`다. 미래 **라이브 read-only probe(제약된 Gate 2)는 별도 1회성 승인** 사안이다 — 본 문서는 그
실행이 아니다.
