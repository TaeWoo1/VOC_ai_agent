# SellerOps Phase 0 — ESM+/GMARKET INQUIRY Gate 1 준비 패킷 (readiness packet)

미래의 **사람이 감독하는 Gate 1 시각 내비게이션**(ESM+/GMARKET **INQUIRY 전용**)을 위한 **준비 문서**다. 어떤 라이브
관측을 **해도 되는지**와 그것을 **어떻게 안전하게(불리언/버킷/카테고리만, 비밀·PII 0건) 보고**할지를 사전에 정의한다.
**본 패킷은 Gate 1을 실행하지 않는다.**

> Status: GATE 1 READINESS — 준비 문서. **Gate 1 미실행 / 라이브 미수행 / INQUIRY 전용.** 어떤 capability도 CONFIRMED로
> 표기하지 않는다. production status 문자열·코드·프론트·테스트를 변경하지 않는다. INQUIRY는 `NEEDS_VERIFICATION`로 유지된다.

관련 문서(본 문서는 이들 **위에 얹는다** — 중복 정의하지 않고 참조):
- 게이트 정의·증거 로깅·candidate-index(Gate 2–3)·증거 사다리: `docs/sellerops_phase0_esm_live_discovery_protocol.md`
  (이하 Discovery Protocol) §3/§5/§6/§7.
- Gate 0 결과·INQUIRY 우선 근거: `docs/sellerops_phase0_esm_gate0_findings.md`(이하 Gate 0 Findings) §3/§4.
- sanitized 출력 규칙: `docs/multi-channel-connector-roadmap.md`(이하 Connector Roadmap) §9; `CLAUDE.md` §4.
- 약속 규칙·drift guard: `docs/product-scope-v1.md`(이하 Product Scope) §9.

본 패킷은 Discovery Protocol §6의 candidate-index 진단(Gate 2–3)의 **한 단계 아래(Gate 1)**다. Gate 1은 **사람의 눈으로만**
내비게이션을 확인하며 **도구·클릭·자동화가 없다.** NAVER에서 검증된 컬렉터 패턴(readiness gate, candidate-index,
approved-index, sanitized outcome enum)은 Discovery Protocol §6에 이미 인용돼 있으므로 여기서 재인용하지 않고 참조만 한다.

---

## 1. 목적 (Purpose)

ESM+/GMARKET **INQUIRY**(판매자문의/Q&A) 한 도메인에 대해, 미래의 Gate 1 사람-시각 내비게이션을 **준비**한다. 목표는
Gate 0의 공개 문서 가정 — 공식 **판매자문의 조회 API**, **7일 조회창**, **`status`(미처리/처리완료/처리중) 필터** — 이
실제 판매자센터 내비게이션·가시 정보 카테고리와 **부합하는지**를 (미래에) 안전하게 확인할 수 있게 하는 것이다. 본 패킷은
그 확인을 **수행하지 않으며**, 무엇을 봐도 되고 어떻게 보고할지의 **사전 규약**만 제공한다(Gate 0 Findings §4의 "INQUIRY
먼저" 권고를 잇는다).

## 2. 엄격한 Non-goals

본 패킷은 **다음을 하지 않는다**:

- Gate 1 수행
- ESM+ 라이브 접속
- 로그인 / 자격증명 사용
- 브라우저 자동화 실행
- 클릭
- 다운로드 / 업로드
- API 호출
- DB 변경
- 스케줄러 / manualSync / backfill 실행
- 어떤 capability도 CONFIRMED 표기
- `GmarketVocItemSource` 구현
- 수집(collection) 구현
- AI 답변 초안 생성

## 3. Gate 1 사전 조건 (Preconditions)

미래의 Gate 1 런은 **본 런에 대한 별도의 1회성 명시 승인**을 요구한다(Product Scope §9, Discovery Protocol §3/§10 —
상위 게이트 승인이 하위를 자동 허가하지 않는다). 운영자는 시작 전 다음을 **명시적으로 확인**한다:

- [ ] **의도적으로** ESM+/GMARKET을 연다(우발적 접속 아님).
- [ ] **데이터가 보이는 스크린샷을 공유하지 않는다.**
- [ ] 실제 판매자/고객/주문/상품 식별자를 **붙여넣지 않는다.**
- [ ] **sanitized 관측만** 보고한다(§4 허용 목록, §5 금지 목록).
- [ ] **모호함 / 2FA / CAPTCHA / 계정·스토어 선택자 불확실 / 데이터 노출 페이지**가 나오면 **멈춘다**(§6).

(라이브 진입의 per-run 승인 정신은 Discovery Protocol §6이 인용하는 `--i-understand-this-opens-live-naver` 플래그 패턴을
ESM+ 전용으로 동일 적용한다 — 본 패킷은 절차만 정의하며 플래그를 도입하지 않는다.)

## 4. 허용 sanitized 관측 (Allowed observations)

INQUIRY 전용. 각 항목은 **`yes` / `no` / `unknown`** 또는 **일반 카테고리**로만 기록한다(값·본문·식별자 없음).

- 문의/CS 메뉴 카테고리 존재: yes / no / unknown
- 상품문의 / 고객문의 / bulletin-board 카테고리 가시: yes / no / unknown
- 날짜 필터 존재: yes / no / unknown
- 날짜 범위 제약: `none` / `7-day` / `30-day` / `custom` / `unknown`
- status / reply-status 필터 존재: yes / no / unknown
- status 값이 **일반 카테고리로만** 보이는지: `unprocessed` / `processed` / `in-progress` / `unknown` (개별 레코드 아님)
- 페이지네이션 존재: yes / no / unknown
- export 버튼 존재: yes / no / unknown
- 검색/필터 컨트롤 존재: yes / no / unknown
- 리스트 행 가시: yes / no / unknown
- 본문 보려면 상세 페이지가 필요한지: yes / no / unknown
- 답변(reply) 액션 컨트롤 존재: yes / no / unknown
- 상품/계정/스토어 선택자 출현: yes / no / unknown
- 페이지에 PII/고객 식별자가 있는 것으로 보이는지: yes / no / unknown **(값 없음)**
- 페이지에 문의 본문 텍스트가 있는 것으로 보이는지: yes / no / unknown **(텍스트 없음)**

수량이 필요하면 정확한 행 수 대신 **버킷**만: `zero | one | few | tens | hundreds | thousands_plus`(Connector Roadmap §9).

## 5. 금지 관측 (Forbidden)

다음은 **보고/붙여넣기/커밋 금지**(Discovery Protocol §5, CLAUDE.md §4):

- Master ID
- seller ID
- 계정 / 스토어 ID
- 고객 이름
- 전화 / 이메일 / 주소
- 주문번호
- 상품 ID / SKU
- 실제 상품명
- 문의 제목 / 내용 / 본문
- 답변(reply) 텍스트
- 비즈니스 민감 **정확한 행 수**
- 실제 레코드에 결부된 **raw timestamp**
- 데이터가 보이는 스크린샷
- raw HTML
- 토큰/식별자가 포함된 URL
- cookie / localStorage / sessionStorage
- JWT / token / secret
- 다운로드 파일명
- 로컬 경로

시간 규칙(표준): `Date.now` / `new Date` / `Date.parse` 금지, `recencyBucket`만; raw timestamp / `eventTimeMs` 금지.

## 6. 중단 조건 (Stop conditions)

미래 Gate 1은 다음 중 하나가 발생하면 **즉시 멈추고 보고**한다(가드 완화 금지):

- 로그인 실패
- 2FA / CAPTCHA 출현
- 계정 / 스토어 선택이 모호
- 안전한 관측을 하기 **전에** 페이지가 raw 고객/주문/상품 데이터를 노출
- 어떤 값이 민감한지 운영자가 **불확실**
- 진행하려면 **클릭이 필요**해짐
- export / download / upload / reply / write 컨트롤과 마주침
- 모달이 동의·액션을 요구
- 계속하려면 비공개 데이터를 **복사해야** 함

(Discovery Protocol §6의 readiness-gate 정신 — 단일·명확한 상태에서만 진행, 모호하면 멈춤 — 과 일치.)

## 7. 관측 양식 (Observation form)

아래는 **비밀 없는** 복붙용 양식이다. **실제 값 필드를 요구하지 않는다** — 모두 불리언/버킷/카테고리.

```
- Gate:                     (예: Gate 1)
- Domain:                   INQUIRY
- Operator:                 (이니셜/역할만, 실명·ID 금지)
- Date:                     (날짜 버킷/대략, 레코드 결부 timestamp 금지)
- Access level:             (예: 테스트 계정 / 폐기 가능 계정)
- Menu category visible:    yes / no / unknown
- Inquiry page category visible: yes / no / unknown
- Date filter:              yes / no / unknown
- Date range constraint:    none / 7-day / 30-day / custom / unknown
- Status filter:            yes / no / unknown
- Status categories visible: unprocessed / processed / in-progress / unknown
- Pagination:               yes / no / unknown
- Export button presence:   yes / no / unknown
- Search/filter controls:   yes / no / unknown
- Row list visible:         yes / no / unknown
- Detail page required:     yes / no / unknown
- Reply action visible:     yes / no / unknown
- Selector ambiguity:       yes / no / unknown
- PII appears:              yes / no / unknown   (값 없음)
- Inquiry text appears:     yes / no / unknown   (텍스트 없음)
- Stop condition triggered: none / <§6 항목>
- Sanitized notes:          (카테고리·불리언·버킷만; 식별자/본문/URL 금지)
```

## 8. 증거 해석 (Evidence interpretation)

미래 Gate 1 관측은 다음과 같이 해석한다(어떤 해석도 CONFIRMED를 부여하지 않는다):

- INQUIRY 메뉴가 존재하고 **status/date 컨트롤이 안전하게 관측**되면 → Discovery Protocol §6의 **Gate 2
  candidate-index 진단**으로 진행할 근거가 된다(여전히 별도 승인).
- **데이터가 보이는 행만** 보이고 컨트롤을 안전하게 관측할 수 없으면 → **멈추고**, 더 제약된 Gate 2 계획을 요구한다.
- export/download 컨트롤이 보이면 → **존재만 기록**, 클릭하지 않는다(Gate 4/5 경계).
- reply/write 컨트롤이 보이면 → **존재만 기록**, 클릭하지 않는다.
- Gate 1 관측은 INQUIRY를 **CONFIRMED로 표기하지 않는다.**
- INQUIRY는 별도 승인된 **비파괴 end-to-end 검증 경로**가 생기기 전까지 **`NEEDS_VERIFICATION`로 유지**된다
  (Discovery Protocol §7 증거 사다리; 이는 문서 레벨 라벨이며 production status를 바꾸지 않는다).

## 9. 미래 아키텍처와의 관계

미래에 INQUIRY가 confirmed 되면 다음 경로로 흐를 수 있다(구조 변경 불필요 — 이미 채널 일반화됨):

`DataType.INQUIRY` → GMARKET `ConnectorCapabilities` → (미래) `GmarketVocItemSource` →
`OperatorAttentionService` → **replyStatus 기반 attention 신호** → `safePreview`.

read-side seam(`VocItemSource`/registry)은 PR #135에서 이미 준비됐다(Discovery Protocol §8 경로). **그러나 본 PR은 위
어느 것도 구현하지 않는다.** 새 DataType·새 source 어댑터·capability 변경 없음.

## 10. 안전 체크리스트 (운영자용)

- [ ] 스크린샷 없음
- [ ] raw 값 없음
- [ ] 명시적 미래 승인 외 클릭 없음
- [ ] 다운로드 / 업로드 없음
- [ ] 실제 데이터 복붙 없음
- [ ] 모호하면 멈춤
- [ ] 불리언 / 버킷 / 카테고리만 보고

---

비밀정보(Master ID·seller id·secret key·JWT·raw 응답)는 본 문서/로그/PR에 출력하지 않는다. 본 패킷은 production
코드·프론트·테스트·`application.yml`·secret·DataType·Flyway를 변경하지 않는다. 오늘 기준 ESM+/GMARKET이 정직하게
**UNSUPPORTED / safe-empty / no-CONFIRMED** 임은 기존 가드 테스트가 고정한다(이미 통과 중, 본 PR 신규 추가 없음):
`ChannelCapabilityOverviewTest.esmGmarketOverviewExposesNoConfirmedDataType`,
`EsmApiConnectorTest.capabilitiesExposeNoCollectableDataType` / `unsupportedDataTypesThrowWithZeroHttp`,
`EsmAttentionEmptyStateTest.gmarketAccountWithNoArticlesYieldsEmptySummary` / `gmarketDrilldownReturnsAnEmptyPage`.
