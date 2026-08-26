# Image Product Knowledge v1 — 설계, 그리고 그 아래에 깔린 것

> **상태: `TECHNICAL_LIVE_PROOF_COMPLETE` · production rollout **`DEFERRED`**(2026-08-27, product-owner).**
> 기술 증명은 끝났고 **배포는 하지 않는다** — 현재 대상에서 usable fact 0 · quota 연동 없음 · 기본값 OFF ·
> 판매자가 직접 답변 기준을 쓰는 loop(`docs/knowledge_gap_resolution_v1.md`)가 더 우선. receipt·variants·
> 기존 증명은 되돌리지 않으며 **추가 vision 호출은 0**이다. 아래 lane 상태는 그대로 유효하다:
> `TEXT_LANE_WIRED`(기본값 OFF) · `IMAGE_LANE_BUILT` · `STAGE_1_LIVE_PROVEN`.
> Stage 1이 **실행됐다**(§11): 26장 · 모델 호출 26 · 실비 $0.104. 추출은 됐고(triple 48) **채택은 0**이며
> 판매자 화면은 변하지 않았다 — 라벨 공간이 다르고, 무엇보다 **찾던 사실이 그 페이지에도 없다**.
> 「읽었다」와 「말해도 된다」의 분리가 관측으로 확인된 것이 이 실행의 결과다.
> Stage 1 준비는 **§10**이 소유한다 — 트리거 기본값 OFF, 답변 근거와 운영 상태의 분리, 규격 지속성,
> 26장 전수 방침, 멀티모달 벤더 감사, Stage 1 매니페스트 초안. **vision model 호출은 여전히 0이다.**
> 상품 간 재사용 측정은 **하지 않기로 결정**됐다(§9-1의 (b)) — v1의 경제성은 실제 문의가 가리킨
> 상품 하나의 비용으로 판단한다.
>
> **아래는 2026-08-26 시점의 기록이다.**
> product-owner가 §4의 payload floor를 **승인**했고(판매자 상세 이미지를 모델에 보낼 수 있다), 착수 순서를
> **텍스트 우선**으로 정했다. 그래서 이 턴에 실제로 지어진 것은 이미지 lane이 **아니라** 그것이 서 있어야 할
> 바닥이다:
>
> 1. **텍스트 lane이 production에 연결됐다.** 감사 결과 `ProductDetailEnrichment`는 `main`에서 **caller 0**이었고
>    DB에도 채널 유래 지식 문서가 **0**이었다 — 즉 이미지 lane은 **한 번도 돈 적 없는** 텍스트 lane 위에 설계되고
>    있었다. `ProductDetailEnrichmentTrigger`가 세 조건(actionable inquiry · exact attribution · 지식 없음/오래됨)
>    전부일 때만 상품 **하나**를 읽는다. sweep 없음, 스케줄러 없음, 실패는 초안을 죽이지 않는다.
> 2. **detail 이미지 주소가 처음으로 투영된다** — `detailContent`의 `<img src>`만. `NaverProductDetail.imageUrls()`는
>    **listing gallery**(대표+옵션 이미지)이고 grounding source로 **금지**이며, 그 분리는 구조 테스트로 고정했다.
> 3. **SSRF-safe CDN fetch 계약**(`ImageFetchPolicy`) — https 전용 · 문서에서 뽑은 URL만 · 인증 헤더 0 ·
>    리다이렉트마다 **재검증** · content-type 화이트리스트 · 개별/총 바이트 상한 · 사설·링크로컬·메타데이터 주소 거부.
>    범용 URL fetcher로 노출되지 않는다(경계 테스트).
> 4. **Stage 0 census 실행됨**(§9-1) — **모델 호출 0**.
>
> **이미지 lane 자체는 여전히 0줄이다.** `AI_EXTRACTED_FROM_SELLER_IMAGE`는 생산자 0이고 그 사실이 테스트로
> 고정돼 있다. 다만 그 authorship이 선언만 하고 아무도 적용하지 않던 규칙
> (`carriesExactFiguresUnaided()`)은 **이제 production에서 적용된다** — §9-2.
>
> **금지 사항은 그대로 설계의 일부다:** 대규모 OCR pipeline · vector DB · generic document ingestion ·
> catalog-wide sweep.

## 1. 이 설계가 존재하는 이유 — 측정된 하나의 사실

2026-08-26, 승인 `apr-nv-detail-13250364547-r2`로 **요청 1회**:

| 관측 | 값 |
|---|---|
| `DetailContentShape` | **`IMAGE_REFERENCES_ONLY`** |
| detailContent 텍스트 | **104자** |
| detailContent 이미지 | **26장** |
| 옵션 / id 보유 | **20 / 20** |

「전선이 몇 가닥까지 들어가나요?」의 답 — 규격별 수용 가능한 전선 개수 — 은 그 26장 안에 있다
(판매자 진술 + 위 측정). 상세 **텍스트** 경로는 104자로 닫혔다. 자세한 판정 근거와 **반증 조건**은
`docs/answer_applicability_v1.md` §8이 소유한다.

**같이 측정된, 더 큰 사실 하나.** 이 org에는 상품 **308**개에 판매자 작성 지식 문서가 **5**개뿐이고
그중 3개가 이 한 상품에 있다. 즉 「그림을 못 읽는다」는 이 org의 grounding 결핍 중 **한 조각**이지
전부가 아니다. 이 설계를 다 만들어도 나머지 305개 상품은 여전히 근거가 없다 — 그러므로 이 lane의
성공 기준은 「AI가 그림을 읽는다」가 아니라 **「이 질문에 답할 근거가 생겼는가」**여야 하고,
착수 순위는 그 기준으로 다른 후보(판매자 입력 UX, 옵션 수집)와 비교돼야 한다.

## 2. 붙는 자리 — 새 파이프라인이 아니다

이미 있다. `ProductDetailEnrichment.apply()`는 오늘 이렇게 끝난다:

```java
if (!measurement.textIsEnough()) {
    // 정직한 멈춤. 페이지의 답이 그림 안에 있고, 그림을 읽는 능력이 없다.
    return new Result(Outcome.IMAGE_ONLY, measurement, options, imageCount);
}
```

`Outcome.IMAGE_ONLY`가 **그 자리**다. 게이트는 이미 결정론적이다 —
`measurement.needsImageUnderstanding()`은 다섯 shape 중 `IMAGE_REFERENCES_ONLY`에만 참이고,
`MIXED`에는 **거짓**이다(텍스트 경로가 있으면 그것부터 쓴다). 새 트리거·새 스케줄러·새 수집 경로 **0**.

어휘도 이미 있다. `KnowledgeAuthorship.AI_EXTRACTED_FROM_SELLER_IMAGE`는 V77에 **선언만 되어 있고
생산자가 없으며**, 없다는 사실이 `DetailContentShapeTest.theImageAuthorshipIsDeclaredAndUnused()`로
고정돼 있다. **그 테스트가 이 lane의 스위치다** — 구현이 시작되는 순간 그것이 빨간불로 바뀌고,
바뀌었다는 것이 곧 「이제 기계가 판매자의 그림에서 문장을 만든다」는 선언이다. 조용히 켜지지 않는다.

## 3. 범위 — 무엇을 읽고 무엇을 읽지 않는가

- **상품 상세페이지 이미지만.** 리뷰 이미지·문의 첨부·주문 첨부·판매자가 올린 임의 파일은 **대상 아님**.
  입력은 `NaverProductDetail.detailContent()`가 가리킨 `<img>`뿐이고, listing 대표 이미지(10장)도 아니다 —
  대표 이미지는 상품 사진이지 스펙 표가 아니다.
- **상품당 상한.** 26장은 n=1의 관측이다. 상한은 상품당 **12장**을 제안한다: 상세페이지의 스펙/규격 표는
  상단부에 몰리는 것이 일반적이라는 **가정**이며, 이 가정은 착수 전에 **한 상품으로 검증**해야 한다
  (12장으로 이 질문의 답이 잡히는가). 상한 초과분은 **버리지 않고 「미조회」로 세어 보고**한다 —
  조용한 절단은 「전부 읽었다」로 읽힌다.
- **org 전체 sweep 금지.** `ProductDetailEnrichment`의 계약 그대로 상품 하나씩이고, 세 트리거는 동등하며
  어느 것도 두 번째 상품을 읽을 이유가 되지 않는다. 308상품 × 12장을 한 번에 도는 경로는 만들지 않는다.

## 4. 이미지 동일성 — 해시가 예산을 정한다

각 이미지는 **바이트 내용 해시**로 식별한다(URL 아님 — CDN 쿼리스트링이 바뀌면 같은 그림이 다른 주소가 된다).

이것이 비용 설계의 핵심이다: **판매자는 같은 배너를 온 상품에 재사용한다.** 배송안내·교환반품·브랜드
띠는 308개 상품에 같은 그림으로 붙어 있을 가능성이 높다. 추출을 **(org, image_hash)** 단위로 캐시하면
상품 수가 아니라 **고유 그림 수**가 비용의 분모가 된다. 이 비율은 착수 전에 **측정 가능**하고(추출 없이
해시만 세면 된다), **그 측정이 첫 작업이어야 한다** — 결과가 「고유 그림이 상품 수만큼 많다」면 이 설계의
비용 전제가 무너지고 그때는 착수하지 않는 것이 옳다.

- **refresh**: 해시가 그대로면 재추출 **0**. 기존 `STALE_AFTER = 30일` 게이트를 그대로 재사용한다.
- **dedupe**: 같은 해시의 추출 결과는 하나이고 여러 상품이 그것을 가리킨다.
- **원본 이미지 미저장**: 해시와 추출된 문장만 남긴다. 그림 파일 사본을 갖는 것은 다른 종류의 결정이고
  이 설계에 없다.

## 5. 추출 — 세 번째 LLM capability라는 것을 먼저 인정한다

backend는 「유일한 LLM egress」이고 오늘 capability는 **둘**이다(`review/triage/llm/`, `agent/llm/`) —
각자 자기 플래그·키·전송·프롬프트·payload floor를 갖고, 서로에게 **구조적으로 도달 불가**하다.
이미지 추출은 **세 번째**이며 같은 규율을 그대로 진다: 자기 플래그, 자기 키, 자기 프롬프트,
자기 payload floor, 그리고 앞의 둘에 닿지 못한다는 테스트.

**그리고 이것이 이 설계가 만드는 가장 큰 안전 델타다 — 이름을 붙여 둔다.**
오늘 payload floor의 성질은 「모델에게 보내는 것은 우리가 고른 문장뿐」이다. 이미지 추출은 그 성질을
바꾼다: **판매자가 만든 이미지 원본이 모델로 나간다.** 발췌도 요약도 아닌 통짜 자산이고, 그 안에 무엇이
찍혀 있는지 우리는 보내기 전에 모른다(연락처·담당자 사진·다른 거래처 로고가 들어 있을 수 있다).
그러므로 착수 결정은 「비용이 맞는가」가 아니라 **「판매자의 상세페이지 이미지를 모델에 보내도 되는가」**이며,
그것은 **product-owner 결정**이지 구현 판단이 아니다. 이 문서는 그 질문을 답하지 않는다.

- 모델/API: 미정. backend capability로서의 **형태**만 위에 고정하고, 어느 모델인지는 착수 시 결정한다.
- **비용**은 수식으로만 적는다: `고유 이미지 수 × 이미지당 vision 토큰 × 단가`. 세 항 중 첫째만
  측정 가능하고(§4) 나머지는 모델 선택에 달렸다 — **숫자를 지어내지 않는다.** 착수 전 산출물은
  「이 org의 고유 이미지 수」와 「상품 1개 파일럿의 실측 토큰」 두 개다.
- **지연**: 추출은 **판매자 경로에 없다.** 초안 생성도 문의 상세 렌더도 vision 호출을 **동기로 하지
  않는다**. 문의가 트리거가 될 수는 있지만 그 문의의 초안이 결과를 기다리지는 않는다 — 아직 없으면
  그 초안은 정직하게 `NO_ANSWER_BASIS`다(§8).

## 6. 추출 결과의 모양 — fact가 아니라 snippet, 그리고 규격이 붙는다

저장은 **`ProductKnowledgeSource`** 한 행: `authoredOrigin = AI_EXTRACTED_FROM_SELLER_IMAGE`,
판매자 화면 라벨은 **「상품 상세페이지」**(판매자에게는 자기가 쓴 그 페이지가 맞다), 저장은 authorship으로
구분된다 — 판매자 입력본·채널 상세 텍스트본과 **세 번째로** 갈린다. `product_fact`로는 **가지 않는다**:
fact는 단정이고 그림에서 읽은 숫자는 단정할 준비가 안 됐다.

**규격 결합이 이 lane의 존재 이유다.** 이 사건의 결함은 「숫자를 못 읽었다」가 아니라 **「그 숫자가 어느
규격의 것인지 담을 자리가 없었다」**였다(`docs/answer_applicability_v1.md`). 그러므로:

- 추출 단위는 **(규격 라벨, 속성, 값)**이고, **규격 라벨을 못 찾은 수치는 저장하지 않는다.**
  「3~4가닥」만 떠 있는 조각은 이 사건을 **다시 일으키는** 바로 그 모양이다.
- 저장된 규격 라벨은 옵션(20개, 전부 id 보유)과 **대조**한다. 맞으면 `SpecApplicability.VARIANT_NAMED`가
  NAVER에서 처음으로 도달 가능해진다. 못 맞추면 `VARIANT_UNRESOLVED`로 남고 초안은 **되묻는다** —
  이미 있는 seam이고 새 classifier가 아니다.

**수치 검증은 「맞는 숫자인가」가 아니라 「이 문장을 저장해도 되는가」다.** 모델이 읽은 값이 진짜인지
확인할 대조 자료가 우리에게 없다(그래서 그림을 읽는 것이다). 그러므로 검증은 **거절 조건**으로만 쓴다:
규격 라벨 부재 → 거절 · 같은 규격에 모순되는 두 값 → 둘 다 거절 · 옵션 목록에 없는 규격 → `UNRESOLVED`.
**추측으로 메우지 않고 버린다.**

## 7. 실패 격리

추출 실패는 **수집도 enrichment도 죽이지 않는다.** 실패하면 오늘과 **똑같은 상태**로 끝난다 —
`Outcome.IMAGE_ONLY`, 저장 0, 초안은 `NO_ANSWER_BASIS`. 즉 이 lane의 최악은 **오늘**이다.
(같은 교훈이 이미 두 번 있었다: proactive를 ingest가 아니라 스케줄러에 붙인 것, 두 문의 lane의
failure isolation.) 재시도는 상한을 갖고, 상한 초과는 「미조회」로 **세어 보고**한다.

## 8. 이 설계가 **닫지 않는** 것

- **§8 unknown-answer semantics**(`GROUNDED` / `NEEDS_CLARIFICATION` / `NO_ANSWER_BASIS`)는 이 lane과
  **독립**이며 이미지 없이도 성립한다. 이번 턴에서는 지시대로 구현하지 않았다(설계까지만·STOP).
  오히려 순서상 **먼저** 닫는 것이 맞다: 근거가 없을 때 정직하게 멈추는 것은 그림을 읽기 전에 필요하다.
- **옵션 이름의 내용**은 여전히 미관측이다. 그것이 규격+스펙을 들고 있다면 verdict는 `STRUCTURED_GROUNDABLE`로
  바뀌고 **이 문서 전체가 불필요해진다.** 가르는 비용은 **READ 1회**이며, 이 설계에 착수하기 전에
  그 1회를 쓰는 편이 거의 확실히 싸다. — **권고: 착수 결정 전에 그 1회를 먼저 승인받을 것.**
- 나머지 305개 상품의 근거 결핍(§1).

## 9. 착수 전 체크리스트

1. [x] **옵션 이름 READ 1회 — 완료(2026-08-26, `apr-nv-option-13250364547-r1`). verdict는 바뀌지
   않았다.** `options=20 axes=2 spec_bearing=20 capacity_bearing=0` — 규격은 옵션 라벨에 이름으로
   있지만 수용 가닥수는 20개 전수에서 관계어 **0건**(`docs/answer_applicability_v1.md` §8-1).
   ⇒ `VARIANT_LABEL_ONLY`, **`IMAGE_ONLY_GAP` CONFIRMED**. 부수 소득: `SpecApplicability.VARIANT_NAMED`가
   NAVER에서 구조적으로 도달 가능 — 추출된 사실이 붙을 **정확한 variant가 채널에 존재한다**.
2. [x] **판매자 상세 이미지를 모델에 보내도 되는가 — product-owner 승인됨(2026-08-26).** provenance는
   `AI_EXTRACTED_FROM_SELLER_IMAGE`로 **분리 유지**되며 `SELLER_ENTERED_KNOWLEDGE`·
   `SELLER_AUTHORED_CHANNEL_CONTENT`와 동일 취급 금지. 출처는 판매자, **추출은 AI**다.
3. [x] **고유 이미지 해시 수 측정 — 실행됨, 그러나 질문에 답하지 못했다.** §9-1.
4. [ ] 상품 1개 파일럿: 상한 12장으로 이 질문의 답이 잡히는가 + 실측 토큰 — **모델 호출이므로 별도 승인**
5. [x] **세 번째(실제로는 여섯 번째) LLM capability 격리 설계** — `AgentDraftBoundaryTest`의
   `CAPABILITIES`/`TRANSPORT_HOLDERS`/`flags` 세 목록에 한 줄씩. 형태는 §5 그대로.
6. [ ] `theImageAuthorshipIsDeclaredAndUnused()`를 끄는 커밋 = 이 lane의 공개 선언 — **아직 초록**

### 9-1. Stage 0 census — 측정됐고, 전제는 확인되지 않았다

승인 `apr-nv-image-census-13250364547-r1`(마켓플레이스 GET **1** · CDN GET **26/상한 26** · WRITE 0 ·
DB 변경 0 · **모델 호출 0**):

```
shape=IMAGE_REFERENCES_ONLY text_chars=104 images=26 listing_gallery=10
img_tags=26 fetchable=26 duplicate_urls=0 inline_data=0 insecure_or_other=0
CENSUS  image_requests=26 fetched_ok=26 unique_sha256=26 duplicate_fetches=0
        unique_ratio=1.00 dedupe_hit_ratio=0.00 cross_product_reuse=UNMEASURED
BYTES   total=3,828,342  min=24,992  max=784,899  mean=147,243
DIMENSIONS readable=26/26 distinct_sizes=22 most_common=860x559×4
OUTCOMES {OK=26}
```

**상품 하나 안에서 바이트 중복은 0이다.** 26장이 26개의 서로 다른 그림이고, 재사용은 없다.

> **이름 정정(2026-08-27, product-owner).** 최초 텔레메트리는 이 값을 `reuse_ratio`라고 불렀는데,
> 실제로 계산한 것은 unique/fetched였다 — **재사용률이 아니라 고유율**이고, 두 이름은 정반대 방향을
> 가리킨다. 「reuse 1.00」은 「전부 재사용됐다」로 읽히지만 관측된 사실은 **재사용이 0**이라는 것이다.
> 그래서 지금은 두 값을 각각 적는다: `unique_ratio=1.00`(내려받은 것 중 서로 다른 것의 비율)과
> `dedupe_hit_ratio=0.00`(바이트 캐시가 이 상품 **안에서** 막았을 요청의 비율). 두 값 모두
> `scope=WITHIN_PRODUCT`이며, 이 lane의 비용 전제인 **상품 간** 재사용은 `UNMEASURED`로 적힌다.

**그리고 그것은 §4가 물은 질문이 아니다.** §4의 비용 논증은 **상품 간** 재사용이다 — 같은 배송안내 띠가
308개 상품에 붙어 있으면 분모가 상품 수가 아니라 고유 그림 수가 된다는 것. 이 census는 상품 **하나**를
읽었으므로 그 비율을 **측정할 수 없다**. 측정하려면 카탈로그 전체를 읽어야 하고, **그것이 정확히 이
lane이 금지한 구조다.** 그러므로:

- **비용 전제는 `UNVERIFIED`로 남는다.** 「무너지면 착수하지 않는 것이 옳다」는 §4의 기준은 아직 판정
  불가이며, 이것을 「측정했다」로 적는 것은 사실이 아니다.
- 알게 된 것: 이 상품의 실측 상한은 **3.65MB / 26장**이고, 평균 **144KB**, 최대 **766KB**, 거의 전부가
  **860px 폭**이다. 상품 1개 파일럿의 전송량은 이제 추정이 아니라 **관측값**이다.
- 남은 선택지는 셋이었다: (a) 표본 N개 상품으로 재사용률을 재는 별도 승인, (b) 재사용 가정을 버리고
  상품당 비용으로 착수 판단, (c) 착수 보류.

**결정: (b)** (product-owner, 2026-08-27). 카탈로그 census도, 표본 N개 enrichment도 하지 않는다.
v1의 경제성은 **실제로 들어온 actionable inquiry가 가리킨 그 상품 하나**의 비용으로 판단하며,
cross-product cache table은 만들지 않는다. 파일럿을 쓰다 보면 여러 상품의 해시가 자연히 쌓이고,
cross-product cache는 **그때 다시 평가한다** — 지금 그것을 재려면 이 lane이 금지한 구조를 한 번
만들어야 하고, 만들고 나서 「역시 필요 없다」로 끝나는 편이 훨씬 비싸다.

### 9-2. 이미지 lane이 없는데 그 안전 규칙은 이미 산다

`KnowledgeAuthorship.carriesExactFiguresUnaided()`는 이미지 유래 문장이 수치를 **단독으로 단정할 수
없다**고 선언해 두고 **호출자가 0**이었다 — 규칙을 적는 enum이 아니라 주석이었다. 이제
`InquiryEvidenceRetriever`가 passage마다 authorship을 들고 다니고, 현재 근거 중 **하나라도** 그림에서
온 것이면 드래프터가 읽는 **규격 적용 범위 줄이 격상된다**(그 enum 자신의 docblock이 지정한 처방:
「variant-unresolved spec이 이미 받는 것과 같은 처방」). 새 seam 0 · payload floor 변화 0 —
그 줄은 여전히 옵션 이름을 싣지 않는다.

**생산자가 생기기 전에 게이트가 먼저 서 있다.** 추출 lane이 켜지는 날 이 규칙은 이미 돌고 있다.

---

## 10. Stage 1 준비 — 벤더를 감사했고, 모델은 아직 부르지 않았다

*(2026-08-27, product-owner 지시 §0–§15. **vision live call = 0**.)*

### 10-1. 트리거 기본값 OFF

`sellerops.product.detail.enrichment.enabled`의 기본값이 `true` → **`false`**. 라이브에서 한 번도
돌지 않은 capability가 「클래스가 머지됐다」는 이유로 판매자 채널을 읽기 시작하면 안 된다. 평범한
`bootRun`은 상세페이지 READ를 **0회** 만든다. 켜는 것은 승인된 bounded live proof 한 번뿐이고,
Demo/Pilot 기본값을 올리는 것은 그 증명 **뒤에 오는 별개의 결정**이다.

읽기 기본값은 소스에서 검증한다(`ProductDetailEnrichmentTriggerTest.defaultIsOff`) — 프로퍼티를
세팅하는 Spring 컨텍스트로 기본값을 증명할 수는 없다. 그 컨텍스트는 정확히 반대 명제를 증명한다.

### 10-2. 「근거가 없다」와 「돌지 않았다」를 나눴다

`AnswerBasisState`는 **증거**에 대한 진술이다. 다음은 전부 **기계**에 대한 진술이며 서로 다른 칸이다:

| 상황 | 예전 화면 | 지금 |
|---|---|---|
| 근거 있음 + 벤더 무응답 | 「답변 기준이 필요합니다」 | 「답변 초안을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.」 |
| 근거 있음 + 일일 예산 소진 | 「답변 기준이 필요합니다」 | 「오늘 사용할 수 있는 AI 처리량을 모두 썼습니다…」 |
| capability OFF | 「답변 기준이 필요합니다」 | 「AI 답변 초안 기능이 켜져 있지 않습니다.」 |
| 상세페이지 READ 실패 | 「답변 기준이 필요합니다」 | 「상품 상세 정보를 확인하지 못했습니다.」 |
| 검색이 **끝났고** 쓸 근거가 0 | 「답변 기준이 필요합니다」 | 그대로 — **여기서만** 그 문장이 나온다 |

**새 enum은 만들지 않았다.** 기존 seam 감사 결과 두 개면 충분했다: `ProductDetailEnrichmentTrigger.
Outcome`(이미 `READ_FAILED`를 갖고 있다)과 `GeneratedDraftView`의 메시지 칸 — 이름만
`quotaMessage` → **`unavailableMessage`**로 정직해졌다(이제 예산 말고도 세 가지를 싣는다).
`AnswerBasisState`는 두 enum의 순수 함수 그대로이고 값도 셋 그대로다.

화면 규칙은 **우선순위 하나**다: `unavailableMessage`가 있으면 그것이 카드가 되고
「답변 기준이 필요합니다」는 **렌더되지 않는다**. 특히 상세페이지 READ가 실패했을 때 그렇다 —
**끝까지 보지 못한 것과 보고 나서 없는 것은 다른 주장**이고, 전자에서 판매자를 「상품 지식을
등록하세요」로 보내면 이미 자기 상세페이지에 써 둔 것을 한 번 더 쓰게 만든다.

`PENDING`(「상품 상세 정보를 확인 중입니다.」)은 **오늘 생산자가 없다**. enrichment는 동기이고
이미지 lane은 존재하지 않으므로 draft 시점에 in-flight 상태가 될 수 없다. 그래서 만들지 않았다 —
`carriesExactFiguresUnaided()`가 그랬듯 **enforcement 0인 상태 값**을 미리 두지 않는다. 이미지 lane이
비동기로 붙는 날 §10-4의 receipt가 그 생산자다.

### 10-3. 변수 지속성 전제 — 그림 페이지도 규격은 저장한다

대상 상품의 실측: **API 옵션 조합 20 / 저장된 `product_variants` 0**. 즉 답이 규격에 따라 달라지는
바로 그 상품에서 `SpecApplicability.VARIANT_NAMED`가 도달 불가였다.

코드는 이미 옳았다 — `ProductDetailEnrichment.writeOptions()`가 shape 판정 **앞에** 있어서
`IMAGE_REFERENCES_ONLY`여도 규격은 기록된다. 없던 것은 **그 순서를 고정하는 테스트**였고
(`ProductDetailEnrichmentTest`), 그것이 이 클래스의 **첫 단위 테스트**다. 「그림이면 할 일이 없으니
일찍 반환하자」는 한 줄짜리 리팩터가 규격을 조용히 데려간다.

옵션 식별자는 채널이 준 것을 **그대로** 쓴다(합성 id 금지 — 매 읽기마다 새 identity를 받는 variant는
없는 variant보다 나쁘다). variant write는 **로컬 DB mutation이지 marketplace WRITE가 아니며**,
Stage 1 매니페스트에 예상 로컬 변경으로 **명시**한다.

### 10-4. 영구 처리 영수증 — 기존 seam으로는 표현할 수 없다 (구현 0)

요구: 재기동 뒤에 같은 이미지를 다시 모델에 넣지 않는다. **특히 결과가 0이었을 때** — 분석했고
쓸 fact가 없었거나 전부 안전 규칙에 걸린 경우에도 「했다」를 기억해야 한다.

기존 seam 감사 결과 **안전하게 표현 불가**:

- `ProductKnowledgeSource`로 표현하려면 본문이 빈 문서를 저장해야 한다(`body`는 NOT NULL). 청크가 0이라
  검색에는 안 걸리지만, **`countByOrgIdAndProductId`가 세는 「등록된 지식 N건」을 부풀린다** — 판매자
  화면이 없는 지식을 있다고 말하게 된다. 이미지당 한 행이면 상품 하나에 26건이 더해진다.
- `SyncCursor`/`ChannelDataState`는 (계정, DataType) 단위 수집 커서다. 이미지 단위를 담을 자리가 없다.
- 트리거의 in-memory attempt memory(6h)는 재기동에서 사라지고, 애초에 「요청했다」이지 「모델에
  넣었다」가 아니다.

⇒ **최소 persistence contract만 보고하고 테이블은 만들지 않았다**(지시 §4). 필요한 최소:

```
product_detail_image_receipt
  org_id, product_id, image_sha256(bytes),     -- identity는 URL이 아니라 바이트
  processed_at, model_version, outcome,        -- ACCEPTED / NO_USABLE_FACT / REFUSED_BY_SAFETY / FETCH_FAILED
  facts_accepted, facts_refused
  unique(org_id, image_sha256)                 -- 상품 간 dedupe가 아니라 재처리 방지
```

`unique(org_id, image_sha256)`는 **cross-product cache가 아니다** — 저장하는 것은 추출 결과가 아니라
「이 바이트는 이미 처리했다」는 사실이고, 상품 간 재사용 판단은 §9-1의 결정 (b)대로 하지 않는다.
이 테이블이 없으면 §14-G(재기동 후 동일 해시 재모델링 방지)는 **테스트할 수 없고**, 그래서 그 항목은
receipt와 함께 보류다.

### 10-5. 26장 — 임의 상한 없음

기존 제안 「12/26」은 **승인되지 않았다**. 어떤 그림에 규격 사실이 있는지는 semantic inspection 전에
알 수 없고, 앞 12장·큰 12장·파일명 12장은 전부 **근거 없는 절단**이다. spec-bearing image를 절대
누락하지 않는 결정론적 pre-filter가 **없으므로 26장 전부**가 first proof의 기준이다.
`ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT`는 이미 26이다.

### 10-6. 멀티모달 벤더 감사 — 추측하지 않은 것과, 확인된 것

**설정된 모델은 `gpt-5-2025-08-07`**(`sellerops.agent.draft.model` 기본값, vendor `OPENAI`,
`/v1/chat/completions`). 여섯 capability 전부 같은 기본값을 쓴다.

벤더 문서에서 확인한 사실:

| 항목 | 값 | 출처 |
|---|---|---|
| gpt-5 텍스트 가격 | 입력 **$1.25 / 1M**, 출력 **$10.00 / 1M** | 벤더 pricing 페이지 |
| gpt-5 이미지 토큰화 | **타일 기반** — base **70** + 타일당 **140** | 벤더 vision 가이드 |
| 요청당 최대 이미지 | 1,500 | 같은 문서 |
| 요청당 최대 페이로드 | 512 MB | 같은 문서 |
| 지원 포맷 | PNG · JPEG · WEBP · 비애니메이션 GIF | 같은 문서 |

**그리고 감사가 실제로 찾아낸 것:** 벤더 문서의 이미지 토큰화 표에서 **`gpt-5`에는 deprecation 표시가
붙어 있다** — 「Deprecated and scheduled for shutdown」. 패치 기반 sizing 표(멀티플라이어 1.2)에는
`gpt-5.5`·`gpt-5.6-*`만 있고 `gpt-5`는 **의도적으로 제외**돼 있다. 이것은 이 lane만의 문제가 아니라
**여섯 capability 전부의 기본 모델**이 종료 예정 스냅샷이라는 뜻이며, Stage 1을 그 모델에 고정하는
것은 좋은 생각이 아니다 ⇒ **product-owner 결정 항목**(모델 갱신은 이 패키지의 범위가 아니다).

비용 계산의 **근거**(추정이 아니라 위 표의 산식):

- 관측된 최빈 크기 860×559 → 2048 안에 들어가므로 축소 없음 → 짧은 변을 768로 → 1182×768 →
  512 타일 3×2 = **6타일** → `70 + 6×140` = **910 토큰/장**.
- 세로로 긴 상세 이미지(예: 860×3000)는 2048로 축소된 뒤 768 정규화 → 768×2679 → 2×6 = **12타일** →
  **1,750 토큰/장**.
- 26장이면 **약 23,700 ~ 45,500 입력 토큰 = $0.03 ~ $0.06**. 출력은 닫힌 JSON이라 작지만
  gpt-5에서는 **추론 토큰이 출력에 포함**되므로 `max_output_tokens`(4,000) 기준 최악이
  26×4,000 = 104,000 → **$1.04**. 즉 상품 하나의 현실적 상한은 **$1 남짓**.
- **정확한 합계는 아직 낼 수 없다.** census는 크기 22종의 **집계만** 남겼고 장별 치수는 로그에 없다
  (설계상 그렇다). Stage 1이 장별 치수를 남기면 그때 실측으로 대체한다.

**지연 시간은 측정하지 않았다** — 모델을 부르지 않았으므로 UNMEASURED다. 추측하지 않는다. 다만
26장 순차 호출이 판매자의 HTTP 요청 위에 있을 수 없다는 것은 이미 확실하므로, 이미지 lane은
**비동기**여야 하고 그래서 §10-2의 `PENDING`이 그때 생산자를 갖는다.

### 10-7. one-image-per-call 유지 — 권고

벤더는 요청당 1,500장을 허용한다. 그래도 **한 장씩** 부른다:

1. **payload floor가 호출 단위로 증명 가능하다.** 「이미지 1장 + 상수 프롬프트, 그 외 0」은
   직렬화된 바이트로 검사할 수 있는 문장이다.
2. **provenance가 구조적이다.** 모델이 출처를 잘못 말할 방법이 없다 — 한 장만 봤기 때문이다.
   `imageOrdinal`을 모델이 **자기 신고**하게 만드는 순간, 그것은 검증할 수 없는 주장이 된다.
3. **실패 격리**가 장 단위로 유지된다.
4. **아끼는 것이 없다.** 묶어서 아끼는 것은 상수 프롬프트 반복분뿐이고(장당 수백 토큰), 이미지
   토큰 910~1,750 앞에서 무의미하다 — 26장 기준 **$0.005 수준**. 그 돈으로 provenance 보장을
   파는 거래다.

### 10-8. 추출 범위 — 안정적인 Product/Variant 규격만

이미지에서 **발견해도 이번 corpus에 넣지 않는다**: 배송 일정 · 재고 · 사은품 · 프로모션 ·
교환/반품 정책 · 연락처 · 판매자 운영정보. 이것들은 장기 Operational Knowledge scope이고
(`docs/operational_knowledge_direction_v1.md`) 지금은 deferred다. free-form OCR dump 금지,
닫힌 추출 `{specLabel, attribute, value}` 유지.

### 10-9. Stage 1 승인 매니페스트 (초안 — 아직 요청하지 않았다)

```
approvalId       : (미발급)
channel/product  : NAVER · 채널상품번호 13250364547
mode             : READ + 신규 LLM capability(vision)
marketplace GET  : 최대 1 (상세 재조회)
CDN GET          : 최대 26
분석 대상 이미지  : 26 (임의 절단 없음)
모델             : (product-owner 결정 — 현재 기본값 gpt-5-2025-08-07은 종료 예정)
이미지 모델 호출  : 최대 26 (one image per call)
payload          : 이미지 1장 + 상수 프롬프트. 상품명·옵션·문의·과거답변·정책·판매자 식별자 0
페이로드 추정     : 3.65MB 업링크 / 23.7k~45.5k 입력 토큰 / 출력 상한 104k 토큰
비용 추정 근거    : 위 §10-6 산식(벤더 문서 실측 단가·타일 산식). 상품당 상한 ≈ $1
지연              : UNMEASURED — 이 실행이 최초 측정
로컬 DB 변경      : product_variants 최대 20(신규) · image receipt 26행 · 채택된 image-derived
                   ProductKnowledgeSource 0~1 · 0건/거부 결과도 receipt에 기록
marketplace WRITE : 0
재시도            : 0
feature flags     : sellerops.product.detail.enrichment.enabled=true (이 실행 한정)
                   + 신규 vision capability 플래그 (기본 OFF)
rollback/disarm   : 두 플래그를 끄면 즉시 원상 — 코드 경로가 플래그 뒤에만 있다.
                   receipt/variant 행은 남지만 판매자 화면 의미는 변하지 않는다.
```


---

## 11. Stage 1 라이브 증명 — 그림은 읽혔고, 답은 거기 없었다

*(2026-08-27 · 승인 `apr-nv-image-knowledge-13250364547-r1` · 실행됨)*

```
start   channel_product_no=13250364547 marketplace_budget=1 image_budget=26 model_budget=26
        extractor=image-fact/v1+image-fact-prompt/v1+schema/v1+openai:gpt-5.6-terra
                 +detail:high+out1200+effort:none
VARIANTS enrichment=IMAGE_ONLY options_written=20 images_on_page=10
        shape=IMAGE_REFERENCES_ONLY text_chars=104 images=26 img_tags=26 fetchable=26
RUN     outcome=READ marketplace_requests=1 images_considered=26 images_fetched=26
        model_calls=26 reused_receipts=0 failed_images=3
FACTS   images_with_facts=7 zero_fact_images=16 accepted=0 unresolved=48 refused=0
        published_documents=0
USAGE   prompt_tokens=34,200 completion_tokens=2,977
```

실비 **약 $0.104**(입력 34,200×$2/1M + 출력 2,977×$12/1M). 이론상 상한 $0.556, 승인 한도 $0.75.

### 11-1. 무엇이 됐는가

**추출은 됐다.** 26장 중 7장에서 **48개 triple**을 닫힌 스키마로 받았고, 16장은 정직하게 `facts=[]`
(대부분의 상세 이미지는 규격을 적지 않는다 — 예상된 답이다), 3장은 실패(`MODEL_FAILED` 1 ·
`OFF_SCHEMA` 2). 규격 지속성도 됐다: `IMAGE_REFERENCES_ONLY` 페이지에서 **옵션 20건이 저장**됐다
(실행 전 0건).

### 11-2. 그리고 **0건이 채택됐다** — 이유는 둘이고, 둘 다 설계가 예상한 거절이다

**(1) 라벨 공간이 다르다.** 이미지가 쓰는 규격 이름과 채널이 들고 있는 옵션 이름이 같은 문자열이
아니다(자릿수 마스킹):

| 이미지의 `specLabel` | 저장된 `option_name` |
|---|---|
| `#호` · `WOOD` · `BLACK` · `GRAY` · `WHITE` | `그레이 / #호(##개)` · `블랙 / #호(##개)` · `우드 / #호(##개)` · `화이트 / #호(##개)` |

축 토큰으로 쪼개도 `#호` ≠ `#호(##개)`(포장 수량이 붙어 있다)이고, `WOOD` ≠ `우드`(영문 대 국문).
**16개 라벨 전부 exact match 0.** `(##개)`를 떼거나 `WOOD`를 `우드`로 옮기는 것은 인코딩 차이 보정이
아니라 **다른 문자열로 바꾸는 것**이고, 그것이 바로 이 lane이 금지한 추측이다 ⇒ 48건 전부
`UNRESOLVED`, 발행 0, 판매자 화면 변화 0.

**(2) 애초에 그 사실이 적혀 있지 않다.** 48개 triple 중 **가닥/심선/코어/수용 관련 attribute는 0건**이다.
상세페이지가 적어 둔 것은 `A 외경 너비`·`B 외경 높이`·`C 내경 너비`·`D 내경 높이`·재질·원산지·
포장 수량이다. **「전선이 몇 가닥 들어가는가」는 이 페이지에도 없다** — 내경 치수에서 **추론**해야
나오는 값이고, 그 추론이 바로 2026-08-26 사건의 원형이다.

### 11-3. §14 성공 기준 판정

| # | 기준 | 판정 |
|---|---|---|
| 1 | 이미지에서 capacity 관련 사실을 찾았는가 | **아니다** — 0/48 |
| 2 | specLabel이 structured variant와 exact match 되는가 | **아니다** — 0/16 |
| 3 | variant별 capacity relation이 결정론적으로 구성되는가 | **해당 없음** — 재료가 없다 |
| 4 | 숫자만 보고 규격/가닥을 추론하지 않았는가 | **그렇다** — 채택 0 · 발행 0 |
| 5 | 규격 미지정 문의가 `NEEDS_CLARIFICATION`이 되는가 | 변화 없음(기존 동작 유지). 새 근거가 0이므로 이번 실행이 바꾼 것이 없다 |
| 6 | exact variant일 때만 GROUNDED 가능한가 | **라이브로는 증명 불가** — 채택된 근거가 0이라 보여줄 대상이 없다. 규칙 자체는 단위 테스트로만 증명됨 |

**기준 4는 이 실행의 가장 중요한 결과다.** 파이프라인 전체가 돌았고, 48개의 그럴듯한 사실을 손에
쥐었고, **하나도 판매자 화면에 내보내지 않았다.** 「읽었다」와 「말해도 된다」가 실제로 분리돼 있다는
것이 관측으로 확인됐다.

### 11-4. 남은 것은 product-owner 결정 둘

1. **축 분해를 허용할 것인가.** NAVER 옵션 이름은 채널이 문서화한 `색상 / 규격(수량)` 형식이다. 이것을
   **선언적·결정론적으로 파싱**해 축 값(`그레이`, `#호`, `##개`)을 얻는 것은 fuzzy match가 아니라
   **채널 포맷 파싱**이다. 다만 그것은 새 규칙이고, 만들지 말라는 지시가 있는 영역과 맞닿아 있으므로
   **product-owner 결정**으로 올린다. 영문/국문 색상 대응(`WOOD`↔`우드`)은 **별개이며 더 위험하다** —
   그것은 사전이고, 사전은 ontology의 시작이다.
2. **이 lane을 이 상품에 대해 계속할 것인가.** (2)의 발견은 축 분해로 해결되지 않는다. 답이 페이지에
   없으므로, 이 상품의 이 질문에 대해서는 **판매자가 지식을 쓰는 것 외에 방법이 없다** —
   `NO_ANSWER_BASIS`의 「답변 기준이 필요합니다」가 정확히 그 상황을 말하고 있었다.
