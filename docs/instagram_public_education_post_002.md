# Public Education Post 002 — 상세페이지에 없는 정보는 리뷰에서 반복됩니다

> **Policy source**: `docs/instagram_voc_brand_strategy.md`, committed as
> `108888e`. This post is a `public_education`-mode artifact and must
> comply with §4 (Public content principles), §5 (Tone of voice), and
> §9 (Cardnews mode implications) of that document.
>
> **Series anchor**: `docs/instagram_public_education_post_001.md`
> (`648b728`). Visual baseline, tone, CTA grammar, and safety check
> structure are inherited verbatim from Post 001 to keep the series
> recognizable. Drift from those defaults must be intentional and
> recorded in §7.5.
>
> **Do not** publish without running §5 of this file (Publishing safety
> check) and the 2-eye review per the strategy doc.

---

## 1. Metadata

| Field | Value |
|---|---|
| `post_id` | `public_education_002` |
| `mode` | `public_education` |
| `pillar` | 상세페이지 개선 신호 (primary) / 리뷰 → 내부 확인 질문 (secondary) |
| `audience` | 인디뷰티 브랜드 운영자 (제품 / 상세페이지 / CS / 마케팅 의사결정자) |
| `series_role` | Note 002 — Post 001의 thesis(리뷰=운영 데이터)를 상세페이지 surface에 적용한 후속 노트 |
| `status` | draft v0.1 (pre-2-eye-review) |
| `target_card_count` | 7 |
| `caption_target_length` | 5~8 short paragraphs |
| `cta_type` | DM funnel (sample report inquiry) |
| `policy_commit` | `108888e docs(strategy): define Instagram VOC brand positioning` |
| `series_predecessor` | `public_education_001` (`648b728`) |
| `created_at` | 2026-05-06 |
| `tone_anchor` | 단정하지 않지만, 실무적으로 유용한 분석가 |

### Mode constraints (binding for this post)

- `brand_names_present`: **must be false**
- `product_names_present`: **must be false**
- `raw_scraped_data_present`: **must be false**
- `numeric_claims_from_scraped_reviews_present`: **must be false**
- `affiliate_or_recommendation_tone_present`: **must be false**
- `product_criticism_present`: **must be false**
- `anonymized_category_level_only`: **must be true**

---

## 2. Carousel copy (7 cards)

> **Visual style baseline (all cards)**: 단색 무채색 배경 (off-white #F8F6F2
> 권장), serif 본문(예: Noto Serif KR), 카드 우측 하단 페이지 인디케이터
> `1/7`–`7/7`, 본문 좌측 정렬, 카드 상하 padding 넉넉히. 색·아이콘 강조 최소.
> 마지막 카드(7/7)만 액센트 배경(예: 진한 차콜 #1F1D1A + 본문 흰색)으로
> CTA 강조. 브랜드/제품 이미지·로고·스크린샷 일체 사용 금지. Post 001과
> 동일 baseline을 의도적으로 재사용하여 시리즈 인식성을 lock한다.

---

### Card 1 — Hook / Title

- **Headline (대형)**:
  ```
  상세페이지에 없는 정보는
  리뷰에서 반복됩니다
  ```
- **Body (중형, headline 아래)**:
  ```
  인디뷰티 브랜드 운영자를 위한
  상세페이지 개선 신호 노트
  ```
- **Visual note**:
  - Headline 두 줄 가운데 정렬, 줄바꿈 위치 고정 ("상세페이지에 없는 정보는"
    / "리뷰에서 반복됩니다").
  - Body는 서브헤딩 톤(작고 회색).
  - 좌측 상단 또는 본문 위에 작은 marker `Note 002` (Post 001의 `Note 001`과
    같은 위치·서체).
  - 좌측 하단에 small caps `INDIE BEAUTY · VOC NOTE` 한 줄 (Post 001과 동일).
- **Max text length guidance**:
  - Headline: ≤ 22자 / 줄 (현재 14자 / 11자 — OK).
  - Body sub: ≤ 30자 / 줄 (현재 16자 / 14자 — OK).
  - Card 1은 본문이 길어지면 hook 효과가 떨어진다. 위 길이 이내로 유지.

---

### Card 2 — 고객 동선

- **Headline (소형)**:
  ```
  구매 직전 단계에서
  ```
- **Body (본문 본격)**:
  ```
  고객은 상세페이지에서
  답을 찾지 못하면 리뷰로 이동합니다.

  리뷰는 단순한 후기 모음이 아니라,
  상세페이지가 답하지 않은 질문을
  다시 확인하는 두 번째 surface입니다.
  ```
- **Visual note**:
  - Headline은 소형 회색, 본문은 serif 굵기 medium.
  - 카드 가운데에 본문 블록 한 덩어리, 줄간격 1.6.
  - 일러스트/아이콘 없음 — Post 001과 동일하게 글의 절제된 톤이 시각 메시지.
  - "두 번째 surface"의 `surface`는 영문 그대로 둔다(분석가 메모 톤).
- **Max text length guidance**:
  - Headline: ≤ 12자 (현재 9자).
  - Body: ≤ 110자 (현재 약 88자, 줄바꿈 4회 — 모바일 가독 양호).
  - 4줄을 넘기지 않는다. 넘기면 행간이 빡빡해진다.

---

### Card 3 — 관점 전환

- **Headline (소형)**:
  ```
  그래서
  ```
- **Body**:
  ```
  리뷰에 같은 질문이 반복된다면,
  그건 평가가 아니라
  고객이 구매 전에 확인하고 싶었던
  정보일 수 있습니다.

  같은 질문이 누적되는 만큼
  상세페이지의 같은 자리가
  비어 있을 가능성이 있습니다.
  ```
- **Visual note**:
  - Card 2와 시각적 대칭. Headline 위치·서체 동일, 본문 블록 위치 동일.
  - 본문 마지막 두 줄("상세페이지의 같은 자리가 / 비어 있을 가능성이
    있습니다")만 약간 굵게(serif semibold) 하여 메시지 lock.
  - 어떤 수치(예: "N건", "N%", "N줄")도 사용하지 않는다 — 출처 없는 클레임
    위험 회피 (Post 001 §card 3 정책 그대로 승계).
- **Max text length guidance**:
  - Headline: ≤ 8자 (현재 3자).
  - Body: ≤ 130자 (현재 약 102자).
  - 카드 2와의 시각적 호흡을 위해 줄 수도 비슷하게 유지(현재 7줄).

---

### Card 4 — 해석 예시 (옵션/발색)

- **Headline (소형)**:
  ```
  예를 들어
  ```
- **Body**:
  ```
  "색이 생각보다 달라요"는
  발색 이미지, 옵션 표기,
  톤 매칭 가이드의
  확인 신호일 수 있습니다.

  어디에 더 명확히 적혀 있었어야 했는지를
  리뷰 표현이 알려주고 있는 것일 수 있습니다.
  ```
- **Visual note**:
  - "색이 생각보다 달라요" 부분만 다른 색(예: 진한 차콜) 또는 따옴표 강조.
  - 따옴표는 영문 더블 쿼트로 본 시리즈 통일 (Post 001과 동일).
  - 아이콘 사용 금지. 인용 텍스트 자체가 시각 강조점.
- **Max text length guidance**:
  - Headline: ≤ 8자 (현재 4자).
  - Body: ≤ 140자 (현재 약 110자).
  - 인용된 표현은 일반 한국어 리뷰에서 흔히 보이는 어구. **특정 브랜드/
    제품에서 추출된 raw quote가 아님.** 누구의 리뷰인지 식별 불가.

---

### Card 5 — 해석 예시 (마무리감/맥락)

- **Headline (소형)**:
  ```
  또 다른 예로
  ```
- **Body**:
  ```
  "생각보다 건조해요"는
  마무리감 표현, 피부 타입 가이드,
  사용 상황 설명의
  확인 신호일 수 있습니다.

  같은 제품이라도 누가, 언제, 어떤 기대로 썼느냐에 따라
  필요한 한 줄이 달라집니다.
  ```
- **Visual note**:
  - Card 4와 동일 양식. 인용 표현만 강조 처리.
  - 두 카드(4, 5)를 시리즈처럼 좌우 페어로 인식하도록 layout 통일 — Post 001과
    같은 페어 패턴.
  - "필요한 한 줄이 달라집니다"를 약간 굵게 하여 메시지 lock.
- **Max text length guidance**:
  - Headline: ≤ 10자 (현재 7자).
  - Body: ≤ 140자 (현재 약 112자).
  - "생각보다 건조해요" 역시 일반 표현. raw quote 아님.

---

### Card 6 — 핵심 thesis

- **Headline (소형)**:
  ```
  중요한 건
  ```
- **Body**:
  ```
  리뷰 표현을 FAQ로 옮겨붙이는 게 아니라,
  반복되는 표현을 상세페이지의
  빠진 설명으로 번역하는 것입니다.

  "이 표현이 자주 나온다"가 아니라
  "상세페이지의 어느 자리가 비어 있는가"로요.
  ```
- **Visual note**:
  - 본문 위쪽 두 줄("리뷰 표현을 FAQ로 옮겨붙이는 게 아니라, / 반복되는
    표현을 상세페이지의")을 살짝 더 큰 글씨로 배치하여 thesis 무게 lock.
  - 마지막 두 줄(따옴표 두 개)은 자연스럽게 좌측 들여쓰기로 분리하여
    "분석가의 메모" 톤을 시각화 — Post 001 card 6 패턴 그대로 승계.
- **Max text length guidance**:
  - Headline: ≤ 8자 (현재 5자).
  - Body: ≤ 140자 (현재 약 112자).
  - 단정형 어휘("필요/해야 함/원인은/결함") 사용 금지 검증 필요(safety
    check §5 항목 8).

---

### Card 7 — 결론 + CTA

- **Headline (대형, 결론 톤)**:
  ```
  리뷰는 상세페이지가 놓친
  고객 질문을 알려주는 운영 자산입니다.
  ```
- **Body (sub-CTA)**:
  ```
  반복되는 리뷰 표현을
  상세페이지의 다음 한 줄로 번역하고 싶다면,
  샘플 리포트 / 월간 리뷰 자산 관리 문의는
  DM으로 보내주세요.

  · DM @account
  · hello@xxx (이메일)

  비공개 1:1 회신으로 전달드립니다.
  ```
- **Visual note**:
  - **유일한 액센트 배경 카드**: 진한 차콜(#1F1D1A) + 본문 off-white
    (Post 001과 동일).
  - Headline 2줄, 가운데 정렬, serif large.
  - DM/이메일 핸들은 placeholder(`@account` / `hello@xxx`) — 실 발행 전
    실제 핸들로 교체. 한 번에 한 placeholder가 남아있다면 게시 차단.
  - "비공개 1:1 회신으로 전달드립니다"는 신뢰 담보 표현. 절대 누락 금지.
- **Max text length guidance**:
  - Headline: ≤ 30자 / 줄 (현재 13자 / 19자).
  - Body: ≤ 170자 (현재 약 130자).
  - DM/이메일 줄은 short bullet 형태 유지 (CTA 시각 정렬).

---

## 3. Caption draft

> **톤 가이드**: 게시물 본문(카드)과 톤이 같은 분석가 보이스. 캡션은 카드를
> 압축한 요약이 아니라, 카드의 thesis를 한 번 더 다른 각도로 lock하는
> 보조 surface로 작성. CTA는 마지막 단락에 한 번만. Post 001 §3의 캡션
> 정책을 그대로 승계.

```
상세페이지에 없는 정보는
리뷰에서 반복됩니다.

고객은 상세페이지에서 답을 찾지 못하면
리뷰로 이동합니다. 리뷰가 일종의
두 번째 상세페이지처럼 작동하는 셈입니다.

같은 질문이 리뷰에서 반복된다면,
그건 평가가 아니라
"구매 전에 확인하고 싶었던 정보"일 수 있습니다.

저희는 반복되는 리뷰 표현을
"이건 클레임이다"가 아니라
"상세페이지의 어느 자리가 비어 있는가"라는
내부 확인 질문으로 번역합니다.

리뷰를 FAQ로 그대로 복사하는 것이 아니라,
반복 표현을 상세페이지의 빠진 한 줄로
번역하는 작업이 핵심입니다.

샘플 리포트 / 월간 리뷰 자산 관리 문의는 DM으로 보내주세요.
(비공개 1:1 회신)
```

**Caption 길이**: 약 6개 단락, 모두 짧은 호흡으로 통일. Instagram 캡션
모바일 가독 한계(약 3~4줄에서 "더 보기"가 잘림) 고려해 첫 두 단락에 핵심
메시지를 배치 — Post 001과 동일 정책.

**CTA 표현 규칙** (Post 001 승계):
- "무료"라는 단어를 1차 CTA로 쓰지 않는다 — 분석가 톤과 충돌, 가격 anchor를
  망가뜨림.
- "DM"이라는 channel 명만 노출하고, "지금 신청하면", "선착순", "무료 분석"
  같은 마케팅 어휘 금지.
- "비공개 1:1 회신"이라는 신뢰 담보 표현은 유지(브랜드 측 데이터 보호 시그널).
- 본 게시물 고유: 캡션 본문에서도 "상세페이지의 빠진 한 줄"이라는 표현을
  유지하여 Post 001(리뷰=운영 데이터) → Post 002(리뷰=상세페이지 개선 신호)
  의 thesis 연결을 lock.

---

## 4. Hashtag draft

> **원칙**: Post 001 §4 정책 승계. 인디뷰티 브랜드 운영자가 검색·구독하는
> 운영/마케팅/분석 영역 태그 중심. 일반 소비자 후킹 태그 사용 금지. 태그 수
> 8~12개 사이 유지. 본 게시물은 상세페이지 surface 비중이 크므로
> `#상세페이지개선` / `#상세페이지카피`를 앞쪽으로 끌어올린다.

**1차안 (10개)**:

```
#인디뷰티 #VOC #상세페이지개선 #상세페이지카피 #리뷰분석
#브랜드운영 #제품운영 #CS운영 #리뷰관리 #브랜드분석
```

**보조 후보 (필요 시 교체)**:
- `#인디브랜드`, `#스몰브랜드`, `#뷰티브랜드`, `#커머스운영`,
  `#커스터머인사이트`, `#리테일VOC`, `#리포트`

**금지 태그** (Post 001 §4와 동일):
- 소비자 후킹·구매 유도 태그 (`#쿠션추천`, `#립스틱추천`, `#오늘의템`,
  `#인생템`, `#뷰티추천`, `#광고`, `#내돈내산`, `#협찬` 류) — 브랜드 정체성
  훼손.
- 영문 일반 뷰티 태그(`#kbeauty`, `#beautytips`)도 1차 launch에서는 회피
  (영문 audience는 v3 이후 별도 전략).

---

## 5. Publishing safety check

게시 전 모든 항목 ✅ 필수. 하나라도 ❌이면 게시 보류 + 본문 재수정.
14항목 구성·문구는 Post 001 §5와 정합되도록 의도적으로 동일 키 셋을
유지한다 — 시리즈 운영 학습 자산이 동일 컬럼으로 누적되어야 함.

| # | 검사 항목 | Pass criteria | 결과 |
|---|---|---|---|
| 1 | brand 이름 노출 | 카드/캡션/해시태그 어디에도 식별 가능한 브랜드명 없음 | ☐ |
| 2 | product 이름 노출 | 동일 (특정 제품/라인 식별 불가) | ☐ |
| 3 | raw 리뷰 인용 | "색이 생각보다 달라요" / "생각보다 건조해요"는 일반 한국어 패턴 표현이며 특정 브랜드/제품/사용자에게서 추출되지 않았음 | ☐ |
| 4 | scraped 데이터 출처 언급 | "OliveYoung에서", "Coupang에서" 등 플랫폼명/스크랩 출처 표현 없음. "스크래핑"이라는 단어 자체도 본문/캡션/해시태그에 등장하지 않음 | ☐ |
| 5 | affiliate / 추천 톤 | "추천", "인생템", "사세요", "할인", "구매하세요" 등 어휘 없음 | ☐ |
| 6 | 제품 비판 | "이 제품은 OO이다" 형태의 단정 평가 없음. 특정 카테고리 비판도 없음 | ☐ |
| 7 | 미검증 수치 클레임 | "리뷰의 70%가…", "10배 더 정확한…", "N건의 누적" 등 출처 불명/검증 불가 수치 없음. 본 게시물은 수치 비유(예: "N줄") 자체를 사용하지 않으며, "반복되는 리뷰 표현 / 누적되는 고객 질문"으로 표현 통일됨 | ☐ |
| 8 | 단정형 어휘 | "필요", "해야 함", "원인은", "결함", "당장" 등 directive 어휘 없음 (카드 6 자체 검증). 본 게시물은 "확인 신호일 수 있습니다 / 가능성이 있습니다 / 일 수 있습니다"로 hedge 통일 | ☐ |
| 9 | 의학적 효능 단정 | "치료", "완치", "의학적", "흡수율 N%" 등 표현 없음 | ☐ |
| 10 | CTA B2B 정렬 | CTA가 정확히 "샘플 리포트 / 월간 리뷰 자산 관리 문의는 DM으로 보내주세요." 형식이며, "무료/지금 신청/선착순/이벤트" 등 마케팅·소비자 후킹 어휘 없음 | ☐ |
| 11 | placeholder 잔존 | `@account`, `hello@xxx`가 실 핸들로 교체되었음 | ☐ |
| 12 | 시각 자산 누설 | 어떤 카드에도 브랜드 로고/제품 사진/스크린샷/캡처/상세페이지 캡처 없음. 발색 이미지·톤 매칭 예시 시각화 시에도 추상 도형만 허용 | ☐ |
| 13 | hashtag 정책 | 8~12개 / B2B 영역 / 금지 태그(§4) 미포함 | ☐ |
| 14 | 2-eye review | 작성자 1명 + 검토자 1명의 사인 (이름/날짜) | ☐ |

**검사 통과 후 기록**:
- 게시 직전 본 파일 §7 ledger에 `published_at`, `reviewer`,
  `instagram_post_url`을 기록한다.
- 게시 후 본 파일은 read-only로 archive (운영 학습 자산).

---

## 6. Notes for future automation

이 문서는 **수동 작성 artifact**다. 첫 20개 `public_education` 게시물을
사람이 만든 뒤, 반복 패턴을 추출해 `cardnews/public_education_planner`의
template로 굳히는 것이 §10 Phase B 작업이다 (Post 001과 동일 게이트). Post
002는 시리즈의 두 번째 데이터 포인트로서, **Post 001과 어떤 슬롯이 동일하게
재현되는지(=template 후보 강화)** 와 **어떤 슬롯이 매번 새로 사람이 작성해야
하는지(=human-only 슬롯)** 를 좀 더 명확히 분리해 기록한다.

### Template 가능 (반복 가능, 자동 생성 후보)

| Card slot | Template field | Post 001과의 일치 | 비고 |
|---|---|---|---|
| 모든 카드의 visual baseline | `visual_style: { bg, font_family, page_indicator, accent_card_index }` | 동일 | 본 시리즈 통틀어 동일하게 lock |
| Card 1 hook 구조 | `hook_two_lines: [str, str]` + `subtitle: str` | 동일 패턴 | 두 줄 줄바꿈 고정 |
| Card 2~3 의 "표면(고객 동선) → 우리 관점(운영 신호)" 대비 | `framing_pair: { surface_view: str, operator_view: str }` | 동일 패턴 | manifesto-style 게시물 공통 구조 |
| Card 4~5 의 "예시 페어" 구조 | `example_pair: [{ quote_pattern, signal_translation }, { quote_pattern, signal_translation }]` | 동일 페어 슬롯 | 본문은 사람 작성, 슬롯 형태는 template화 가능 |
| Card 7 CTA 블록 | `cta: { headline_two_lines, body_lines, dm_handle, email_handle, trust_line }` | 동일 | DM/email handle은 환경변수에서 주입 |
| Hashtag set | `hashtag_set_id: "b2b_voc_v1"` | 동일 정책 셋 | 본 게시물은 `#상세페이지개선`/`#상세페이지카피`를 앞쪽으로 ordering 조정 (set 멤버십은 동일) |
| Placeholder 자동 검출 | `@account`, `hello@xxx` 등 placeholder regex로 자동 차단 | 동일 | safety_validator로 코드화 |
| 14항목 safety check 키 셋 | `safety_check_v1` (열 14개 ID 고정) | 동일 | 게시물별로 결과만 갱신 |

### 사람 필수 (template로 굳히면 안 되는 슬롯)

| Card slot | 이유 |
|---|---|
| Card 4~5의 인용 표현 ("색이 생각보다 달라요" / "생각보다 건조해요") | 매 게시물마다 카테고리·제품군에 따라 다르며, 일반 표현인지 특정 brand에서 새어 나오는지 사람의 판단 필요. 자동 생성 시 raw quote leak 위험 |
| Card 4~5의 "신호 번역" 본문 (옵션 표기/톤 가이드/마무리감 표현 …) | 어떤 상세페이지 슬롯에 매핑되는지의 판단은 분석가 보이스의 핵심. template가 만들면 평균화되어 가치 손실 |
| Card 6 thesis 한 문장 ("FAQ로 옮겨붙이는 게 아니라 …") | 게시물의 핵심 운영 메시지. template이 만들면 톤이 균일해져 "분석가" 보이스가 죽는다 (Post 001과 동일 결정) |
| Caption 마지막 단락 직전의 thesis 재진술 | 동일 |
| Pillar 매핑 | 자동화 가능하지만 검토자가 강제 확인. Post 002처럼 한 게시물이 두 pillar(상세페이지 개선 신호 / 리뷰→내부 확인 질문)를 동시에 수행할 때의 균형 결정은 사람 판단 |
| 시리즈 연결 문장 (Post N → Post N+1 thesis 승계) | Post 002의 §3 캡션은 Post 001의 thesis를 승계하면서 surface를 좁힌다. 이 연결 결정은 시리즈 큐레이터(사람)가 매번 판단 |
| 2-eye review sign-off | 자동화 절대 불가. 사람의 명시적 사인 필요 |

### Phase B planner 설계 시사점 (Post 001과 누적해서 읽을 것)

- `public_education_planner`는 **항상 "수동 시드 → 자동 확장"** 모드로
  설계한다. zero-shot 자동 생성을 default로 두지 않는다.
- Post 001/002 두 게시물에서 **Card 1 hook / Card 2-3 framing pair / Card
  4-5 example pair / Card 6 thesis / Card 7 CTA**의 5-슬롯 구조가 동일하게
  재현되었다 — Phase B template의 1차 후보 구조로 lock 가능.
- 입력 형태 후보:
  - `public_education_seed.yaml` (수동 작성한 카드 본문 + 정책 태그)
  - 또는 본 markdown 형식 그대로 파싱
- 출력 형태:
  - `cardnews/templates/public_education/*.html.j2`로 렌더링
  - 게시 직전 `safety_validator(public_education_mode)` 통과 강제
- 자동화 진입 조건 (§10 manual-first 게이트):
  - 첫 20개 수동 게시물의 톤/safety/CTA 검증 결과가 본 문서 같은 형태로
    archive되어 있어야 함
  - 검증 결과가 "0건의 정책 위반"으로 기록되어야 함
  - 그 이전에는 본 markdown 형식으로 100% 수동 작성 유지

---

## 7. Review ledger

> 발행 전 작성자/검토자 사인을 받아 lock한다. 발행 후 결과 필드(아래)는
> 게시일로부터 7일·14일·30일 시점에 채워 본 게시물을 운영 학습 자산으로
> archive한다. 모든 ledger 필드가 채워진 뒤에는 본 markdown을 read-only로
> 유지한다.

### 7.1 Pre-publish sign-off

| Field | Value |
|---|---|
| `draft_version` | v0.1 (initial draft) |
| `author` | (이름) — 작성일: YYYY-MM-DD |
| `reviewer` | (이름) — 사인일: YYYY-MM-DD |
| `safety_check_passed` | ☐ Yes (§5의 14항목 전부 ✅) / ☐ No (재수정 필요) |
| `placeholders_replaced` | ☐ `@account` 실 핸들로 교체 / ☐ `hello@xxx` 실 이메일로 교체 |
| `visual_mockup_path` | (예: `docs/instagram_public_education_post_002_mockup.png`) |
| `visual_mockup_reviewed_by` | (이름) — 사인일: YYYY-MM-DD |
| `dm_response_script_ready` | ☐ Yes (`docs/instagram_voc_dm_response_script.md`, `7879a7d`) / ☐ No |
| `series_continuity_check` | ☐ Post 001 thesis 승계 문장 캡션에 포함됨 / ☐ Card 1 marker가 `Note 002`로 표시됨 |

### 7.2 Publish record

| Field | Value |
|---|---|
| `published_at` | YYYY-MM-DD HH:MM (KST) |
| `instagram_post_url` | (게시물 영구 링크) |
| `caption_final` | (실제 발행된 caption 본문 — 본 doc과 diff 발생 시 diff 사유 기록) |
| `hashtag_final` | (실제 발행된 해시태그 셋 — 본 doc과 diff 발생 시 diff 사유 기록) |

### 7.3 Post-publish observations

| 시점 | DM 문의 수 | 샘플 리포트 발송 수 | 정책 위반 보고 | 메모 |
|---|---|---|---|---|
| +7일 |  |  | ☐ 없음 / ☐ 있음 (사유) |  |
| +14일 |  |  | ☐ 없음 / ☐ 있음 (사유) |  |
| +30일 |  |  | ☐ 없음 / ☐ 있음 (사유) |  |

### 7.4 Operational notes (발행 전 기억할 것)

- 본 게시물은 **시리즈의 두 번째 게시물**이다. Post 001에서 정한 visual
  baseline / tone / CTA 문법 / 14항목 safety check 키 셋을 그대로 승계해야
  시리즈 인식성이 형성된다. Diff가 생긴다면 그 사유를 §7.5에 기록한다.
- DM 응대 스크립트(`docs/instagram_voc_dm_response_script.md`, `7879a7d`)와
  DM 전환 ledger(`docs/instagram_voc_dm_conversion_ledger.md`, `bc17ed4`)가
  이미 갖춰져 있으므로, 본 게시물 발행 시점에 별도 신규 작업 없이 DM
  funnel이 가동 가능한지만 확인한다.
- §5 안전 체크에서 한 항목이라도 ❌이면 발행 보류. 우회 발행 금지.
- 본 게시물의 thesis(상세페이지 개선 신호)는 후속 Post 003 이후의 "구체
  attribute별 신호" 게시물(예: 옵션/발색 surface, 마무리감 surface)로 분기될
  수 있다. 본 게시물은 그 분기의 우산 역할이므로 너무 좁은 카테고리로
  내려가지 않는다.

### 7.5 Lessons captured (post-publish)

> 발행 후 30일 시점에 작성자가 채운다. 이 노트는 §6 "Notes for future
> automation"의 입력 자료로 사용되어, 세 번째~스무 번째 게시물의 수동
> 작성과, 이후 `public_education_planner` template 설계의 근거가 된다.

- Post 001 대비 효과 차이 (DM 유입 톤·수, 저장률 체감 등):
- 가장 잘 작동한 카드 / 표현:
- 가장 약했던 카드 / 표현:
- DM 유입의 톤 (질문 유형, 브랜드 규모 분포 등):
- 정책상 수정·교체가 필요했던 부분:
- 시리즈 연결(Post 001 → 002) 인식 여부 (저장 / 프로필 클릭 / 이전 게시물
  열람 등 정성 신호):
- 다음 게시물(Post 003)에 반영할 결정:
