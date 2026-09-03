# Knowledge Retrieval Quality v1

2026-09-03 · HEAD `7ef48aa1` 기준 · backend + 벤치마크 · **마켓플레이스 호출 0 · 마켓플레이스 WRITE 0 ·
승인 0 · 마이그레이션 1(V92) · 새 의존성 0**

Knowledge Sources & Acquisition v1이 닫지 않고 넘긴 병목 하나를 닫는다.

> 판매자가 올바른 Knowledge를 넣어도 고객의 표현이 조금만 달라지면 검색하지 못한다.

Source / Canonical Knowledge / Answer Memory / Style의 의미 분리, PRODUCT / ORG scope, provenance,
active state, 문서 import, evidence contract, Knowledge Candidate는 **그대로 쓴다**. 이 패키지가 바꾸는
것은 「어느 passage가 이 질문에 답하는가」를 정하는 규칙 하나다.

---

## 1. 기존 retrieval 구조와 실제 병목

**감사 결과 구조는 하나였고 그것이 좋은 소식이다.** 세 lane(상품 지식 · 운영 정책 · Answer Memory)이
전부 `KnowledgeRetriever.rank(query, candidates, discountedSubject)` **한 함수**로 수렴한다. scope 필터,
active 필터, variant 적용범위, provenance tie-break, `KnowledgeTopic` 거절은 전부 lane이 **그 함수를
부르기 전에** 끝낸다. 그래서 검색 방식을 바꾸는 데 필요한 seam은 하나뿐이었다.

- `RetrievalQuery` — 한 질문을 TOPIC → TITLE → SUBJECT → FULL의 후보 ≤4로 만들고, **먼저 hit이 난 후보가
  답한다**.
- `KnowledgeText.weigh/assess` — 어절 단위 **prefix 매칭**(조사·어미 tail만 허용), 희소도 가중 coverage.
- 게이트 셋 — `MIN_ASKABLE_RATIO 0.35`(부재 판정, 질문의 **내용 어절 문자 수** 분모) ·
  `MIN_TOPIC_COVERAGE 0.4`(랭킹) · `MIN_MATCHED_CHARS 2`.
- passage 단위 = `KnowledgeText.chunk` (목표 420자, 최소 60, 최대 900) + **문서 제목을 붙여서** 매칭.
- 저장소는 PostgreSQL 하나. **pgvector 확장은 이 배포에 존재하지 않고**(`pg_available_extensions`에서 0건),
  embedding/vector 의존성이나 추상화도 저장소 전체에 **없었다**. 유일한 관련 seam은
  `sellerops.customermemory.retriever.provider: lexical`인데, 그것은 **고객 본문**에 대한 것이라 이
  패키지의 대상(판매자 자신의 문서)과 payload 성격이 다르다.

**병목은 세 가지로 갈렸고, 그중 하나만 「의미」 문제였다.**

| # | 모양 | 실측 | 원인 |
|---|---|---|---|
| 1 | 부재 게이트 희석 | 「두께」 FOUND · 「두께가 생각보다 얇아 아쉬웠습니다」 NO_RELEVANT | 분모가 **모든 내용 어절**이라 매칭되지 않는 낱말이 늘수록 ratio가 무너진다. 2/15 = 0.13 |
| 2 | 활용·띄어쓰기 | 「잘떨어지네요」 vs 「잘 떨어질 때」 | `떨어지` ↔ `떨어질`은 조사도 어미도 아니라 prefix 규칙이 잇지 못한다 |
| 3 | 진짜 동의 | 「자꾸 들떠요」 → 접착 안내 | 사전 없이는 불가능 |

**그리고 lexical lane 자신이 wrong-source의 출처였다** — 「제주도인데 며칠 걸릴까요?」가 「반품과 환불
안내」를 돌려준다(그 문서에 `도착`이 있다). 이것은 threshold 문제가 아니라 겹침이 진짜라서 어떤 임계값도
가르지 못한다.

## 2. Benchmark dataset

`backend/src/test/resources/retrieval-benchmark/` — **fixture이고 판매자 데이터가 아니다**. 한 어휘에
맞추는 것을 막기 위해 도메인을 넷으로 나눴다: 케이블 몰딩 · 실리콘 주방 매트 · 무선 선풍기 · 회사 운영 정책
(+ 「교환 정책만 있는 회사」와 「문서 하나뿐인 회사」 두 변형). **소스 15개 / 질문 46개**, 브리프의 A~I에
J(규격·수치 토큰)와 K(문서 하나짜리 라이브러리)를 더했다.

측정치 셋 — 답할 수 있는 질문에 대해 **Recall@4**(=production 상한), **wrong-source**(top1 / any:
기대 문서가 아닌 passage를 하나라도 돌려줬는가), 답이 「없음」인 질문에 대해 **no-evidence precision**.
recall만 보면 전부 돌려주는 retriever가 이기고, 그것은 판매자의 고객에게 사실을 말하게 되는 층이다.

harness는 `KnowledgeRetriever`·`RetrievalQuery`·`KnowledgeTopic`·`KnowledgeText`를 **production 그대로**
부른다. 벡터만 checked-in 캐시에서 온다(`vectors.json`) — 벤더를 부르는 테스트는 돌지 않는 테스트이고,
벤더가 모델을 재조정하면 숫자가 움직이는 벤치마크는 벤치마크가 아니다.

## 3. lexical / semantic / hybrid 측정

전부 같은 fixture, 같은 게이트 구조, 같은 cap(4).

| arm | recall | top1-wrong | any-wrong | no-evidence |
|---|---|---|---|---|
| **LEXICAL (shipped)** | **38.9%** (14/36) | 5.6% | 11.1% | 90.0% |
| SEMANTIC 절대 임계 f=0.25 (small-256, passage) | 87.1% | 3.2% | 16.1% | 66.7% |
| SEMANTIC 절대 임계 f=0.50 | 25.8% | 0% | 3.2% | 100% |
| MARGIN small-1536 (passage) m=0.05 | 74.2% | 0% | 6.5% | 88.9% |
| MARGIN large-1024 (passage) m=0.05 | 80.6% | 0% | 0% | 77.8% |
| MARGIN large-1024 (**sentence**) m=0.05 | 87.1% | 0% | 6.5% | 66.7% |
| HYBRID = 위 + lexical union | 88.9% | 0% | **11.1%** | 70.0% |
| **선택: MARGIN large-1024 · sentence · LOO m=0.10 · split** | **86.1%** (31/36) | **0%** | **0%** | **90.0%** |

측정이 답한 것 다섯:

1. **절대 cosine 임계는 원리적으로 실패한다.** 한국어 구어 질문과 그 답 passage가, 칭찬과 무관한 passage와
   **같은 높이**에 있다 — 「자꾸 들떠요」 0.159 / 「너무 좋아요 만족합니다」 0.176. 두 분포가 겹치므로 어떤
   수를 골라도 recall과 no-evidence를 동시에 살 수 없다(위 두 줄이 그 곡선의 양 끝이다).
2. **차원은 품질 변수다.** 같은 모델을 256으로 자르면 margin 규칙에서 no-evidence가 33%까지 떨어진다.
   짧은 벡터는 「이 상품에 대한 글」과 「이 질문에 대한 글」을 구별하지 못한다.
3. **비교 단위는 passage가 아니라 문장이다.** 「두께」 vs 세 가지 두께를 적은 문단 = 0.310, 그 옆 색상 노트
   = 0.306 — 통째로 임베딩된 문단에게 둘 다 「이 몰딩에 대한 문단」이다. 문장으로 쪼개면 갈린다. **판매자가
   보는 passage는 그대로**이고, passage는 자기 최고 문장의 점수를 받는다.
4. **부재는 높이가 아니라 모양으로 판정해야 한다.** 채택한 규칙은 leave-one-out margin — 「최고 passage가
   **나머지로부터** 얼마나 떨어져 있나」. 이것은 lexical쪽 `MIN_TOPIC_COVERAGE`가 이미 하는 주장과 같다:
   외부에서 고른 수가 아니라 **이 코퍼스가 해낸 것**으로 나눈다.
5. **hybrid는 측정으로 기각됐다.** 선택된 지점에서 lexical union은 recall을 **하나도** 더하지 못하고
   (88.9% vs 86.1%는 lexical이 semantic이 놓친 것을 찾아서가 아니라 band가 넓어져서다) wrong-source만
   0% → 11.1%로 되돌린다. lexical의 오류는 전부 **admission**이기 때문이다.

임계 선택: m=0.12는 no-evidence 100%를 사지만 recall이 77.8%로 떨어지고 **「두께」와 「두께가 생각보다
얇아 아쉬웠습니다」를 둘 다 잃는다** — 이 패키지가 존재하는 이유를 잃는 값이라 고르지 않았다.

## 4. 선택한 architecture

**semantic이 부재를 판정하고, lexical은 그것이 불가능할 때의 답이다.**

```
lane의 candidate 목록 (scope · active · variant · 읽기 필터가 이미 끝난 것)
        ↓
KnowledgeSemanticSearch — 질문 1회 임베딩 + 문장 벡터 조회(없으면 캐시에 채움)
        ↓  하나라도 못 보면 null
KnowledgeRetriever.rank(..., semantics)
   · 못 본 passage가 있으면 → 기존 lexical 그대로
   · 전부 봤으면 → LOO margin 부재 게이트 → best × 0.90 band
        ↓
KnowledgeTopic.applicable + remedyApplicable (거절 전용, 무변경/추가)
        ↓  provenance tie-break · 정렬 · cap 4 (무변경)
Grounded Draft
```

- **scope는 재판정되지 않는다.** semantic lane은 lane이 만든 목록만 본다 — 은퇴한 매뉴얼은 목록에 없어
  아무리 가까워도 찾을 수 없고, 다른 회사의 passage는 애초에 목록에 없다. 구조 테스트가
  `KnowledgeSemanticSearch`에 repository·`findAll`·`isActive`·`Product`·`Source`가 **없음**을 고정한다.
- **다 보지 못하면 판정하지 않는다.** passage 하나라도 벡터가 없으면 전체가 lexical로 되돌아간다 — 코퍼스의
  절반만 읽고 내린 부재는 절반에 대한 부재다.
- **후보 사다리는 semantic에서 쓰지 않는다.** 네 형태는 lexical 분모 희석을 우회하려고 존재하고 벡터에는
  그 분모가 없다. 짧게 만드는 것은 뜻을 지우는 일이고 형태당 벤더 호출 1회다.
- **교환 ≠ 반품**(`KnowledgeTopic.remedyApplicable`). 벤치마크의 남은 wrong-source는 한 모양이었다 —
  「반품 배송비」 질문이 「교환 안내」를 0.51로 가져와 왕복 6000원을 반품비 3000원 자리에 놓는다. **enum은
  쪼개지 않았다**: `EXCHANGE_RETURN`은 플래너 토큰이자 판매자의 받은함 필터이고, 「교환·반품」이 한 칸인
  것은 그 화면에서는 옳다. 근거 자격을 정할 때만 더 잘게 묻는다. 거절 전용 · 제목/질문 텍스트에서만 읽고
  선언된 타입에서는 읽지 않는다(둘 다 이름 지은 문서는 둘 다 근거가 된다).

## 5. embedding model / storage 선택 이유

- **모델 `text-embedding-3-large`, 1024차원.** 후보 넷을 같은 벤치마크로 재서 골랐다(§3). 3-small은
  1536차원에서도 D류(진짜 동의)에서 1/5, large는 4/5.
- **저장소는 기존 PostgreSQL, 별도 vector DB 없음, pgvector 없음.** 이 배포에 확장이 없고 필요도 없다 —
  검색은 언제나 상품 하나의 라이브러리 · 회사 하나의 정책 · 회사 하나의 answer memory로 **경계지어져
  있고**(레퍼런스 배포 실측 4 · 6 · 26행) 그 크기에서 ANN 인덱스는 마이크로초짜리 선형 스캔에 운영 표면과
  비결정성을 더할 뿐이다. 애플리케이션 측 코사인.
- **캐시는 content-addressed** (V92 `knowledge_embedding`, `(org, model, dimensions, sha256)` 유니크).
  이것이 lifecycle 설계 전부다(§7).
- **질문 벡터는 저장하지 않는다.** 고객 문장의 두 번째 사본을 만들지 않는다 — 이 저장소가 다른 모든 곳에서
  거부하는 모양이고 여기서도 읽을 사람이 없다.

## 6. Retrieval flow와 안전 경계

일곱 번째 LLM capability(`sellerops.knowledge.embedding`)이고 **기본값 OFF**다. 앞의 여섯과 같은 규율 —
자기 flag · 자기 key · 자기 door(`KnowledgeEmbeddingService` → `KnowledgeEmbeddingGenerator`,
`AgentDraftBoundaryTest`의 표가 여섯 번째 행을 얻었다) · 자기 payload floor. **payload는 일곱 중 가장 좁다**:
model · dimensions · texts 셋뿐이고 조직·상품·주문·식별자를 담을 자리가 없다(직렬화 바이트로 단언).

**정직하게 이름 붙이는 새 노출 하나** — 이 capability는 **매 검색마다 고객의 질문**을 내보낸다. 오늘
`NO_ANSWER_BASIS`로 끝나는 초안은 드래프터를 **부르지 않고**, 판매자의 지식 검색 상자는 아무것도 부르지
않는다. 그 두 경로가 이 capability를 켜면 먼저 임베딩을 부른다. 그래서 머지가 아니라 **배포 결정**이고,
꺼 두면 모든 lane이 이 패키지 이전과 바이트 단위로 같다.

## 7. embedding lifecycle

**표는 chunk 행의 투영이 아니라 「이 회사의 이 텍스트의 벡터」다.** 그래서:

| 판매자 행동 | 벌어지는 일 |
|---|---|
| 지식 추가 | 다음 검색에서 그 문장들이 임베딩되어 캐시에 들어간다 |
| 문서 수정 | 새 텍스트 = 새 해시 = 새 벡터. **낡은 벡터는 다시 조회되지 않는다** — 무효화할 것이 없다 |
| 되돌리기 | 옛 해시가 캐시에 있으므로 **임베딩 0회** (실측: 32 → 33행, 새 문장 하나만) |
| 사용 중지 | source 필터가 candidate 목록에서 빼므로 벡터가 조회되지 않는다. 표는 건드리지 않는다 |
| 삭제 | 고아 행이 남는다(무해). 인용은 계속 풀린다 |

쓰기는 검색 시점에 **`REQUIRES_NEW` 트랜잭션**으로 일어난다 — 벤더 호출이 판매자의 저장 트랜잭션 안에 있으면
안 되고, 벤더 실패가 판매자의 검색을 롤백해서도 안 된다. 백그라운드 잡·큐·스케줄러 **0**.

**§7을 실행하다가 라이브에서 기존 결함 하나를 찾아 고쳤다.** `PUT /api/products/knowledge/sources/{id}`가
**500**이었다(`duplicate key ... uq_pk_chunks_ordinal`). 재색인이 한 트랜잭션에서 옛 chunk를 지우고 새것을
쓰는데 Hibernate는 **모든 insert를 모든 delete보다 먼저** 실행하므로 두 번째 ordinal 1이 첫 번째를 만난다.
지식을 **추가**하는 것은 되고 **고치는** 것만 안 되므로 아무도 보지 못했다. 두 인덱서에 `flush()` 한 줄.
회귀 테스트가 실제로 실패하게 만들려면 엔티티가 그 유니크 제약을 **선언**해야 했다(생성 스키마에는 없었다) —
그래서 두 chunk 엔티티가 마이그레이션이 늘 갖고 있던 인덱스를 이제 자기 `@Table`에 적는다. flush를 빼면
테스트가 빨개진다(확인함).

## 8. Grounded Draft before/after (라이브)

일회용 QA org(제품 자신의 `POST /api/auth/signup`) · 리뷰는 **파일 업로드**로 · 지식은 판매자 자신의 CRUD로.
**실제 판매자 데이터 0 · DB 직접 수정 0 · 숨은 엔드포인트 0 · c329471c 무접촉.**

**검색(생산 엔드포인트 `…/knowledge/search`, `…/org-knowledge/search`) — 답이 있어야 하는 15문항:**

| 질문 | before | after |
|---|---|---|
| 두께 | FOUND 규격 안내 | FOUND 규격 안내 |
| **두께가 생각보다 얇아 아쉬웠습니다** | **NO_RELEVANT** | **FOUND 규격 안내** |
| 잘떨어지네요 | NO_RELEVANT | **NO_RELEVANT** (남은 실패) |
| 자꾸 들떠요 | NO_RELEVANT | **NO_RELEVANT** (남은 실패) |
| 벽에서 계속 떨어집니다 | NO_RELEVANT | FOUND 부착 방법 안내 |
| 무슨 색이 있나요? | NO_RELEVANT | FOUND 색상과 재질 |
| 설거지할 때 같이 돌려도 되나요? | NO_RELEVANT | FOUND 세척 방법 |
| 뜨거운 냄비 올려도 되나요? | NO_RELEVANT | FOUND 내열 온도 |
| 언제쯤 받아볼 수 있을까요? | NO_RELEVANT | **NO_RELEVANT** (남은 실패) |
| 제주도인데 며칠 걸릴까요? | NO_RELEVANT | FOUND 배송 안내 |
| 배송이 너무 느려서 실망했습니다 | NO_RELEVANT | FOUND 배송 안내 |
| 반품하고 싶은데 배송비는요? | NO_RELEVANT | FOUND 반품과 환불 안내 |
| 환불은 언제 되나요? | FOUND 반품과 환불 안내 | FOUND 반품과 환불 안내 |
| 색상 바꾸고 싶어요 | FOUND 교환 안내 | FOUND 교환 안내 |
| 고장났는데 수리 되나요? | NO_RELEVANT | FOUND A/S 안내 |

**3/15 → 12/15.** 답이 「없음」이어야 하는 3문항: 「너무 좋아요 만족합니다」·「포장이 예뻐요」는 before/after
모두 정확히 없음, **「방수 되나요?」는 after에서 부착 방법 안내를 가져온다**(벤치마크 I3와 같은 실패, §10).

**초안(생산 엔드포인트 `…/reply/draft/generate`):**

| 리뷰 | before | after |
|---|---|---|
| ★2 두께가 생각보다 얇아 아쉬웠습니다 | `NO_ANSWER_BASIS` · RULE · 기준 요청 1 | **`GROUNDED` · MODEL · 근거[규격 안내]** — 「1호 1.2mm, 2호 1.6mm, 3호 2.0mm … 전선 지름이 4mm를 넘는 경우 2호 이상」 |
| ★2 배송이 너무 느려서 실망했습니다 | `NO_ANSWER_BASIS` · RULE · 요청 2 | **`GROUNDED` · MODEL · 근거[배송 안내]** — 「평일 오후 2시 이전 결제 건은 당일 출고 … 제주·도서산간 2~3일」 |
| ★5 …그런데 식기세척기에 넣어도 되나요? | `GROUNDED` · MODEL(어절이 그대로 겹쳤다) | `GROUNDED` · MODEL |
| ★5 너무 좋아요 만족합니다 | `NO_ANSWER_BASIS` · RULE · **요청 0** | 동일 — 칭찬은 기준을 요구하지 않는다 |
| ★3 잘떨어지네요 자꾸 들떠요 | `NO_ANSWER_BASIS` · RULE · 요청 1 | **동일** (남은 실패) |

**1/5 → 3/5 GROUNDED.** 초안이 말한 수치는 전부 판매자 문서의 것이고 새 사실은 없다. 없는 근거를 억지로
붙인 사례 0(방수 질문은 리뷰 코퍼스에 없다).

## 9. Knowledge Need 판단 변화

브리프 §9대로 retrieval과 **분리해서** 감사했다. 기준은 「이 리뷰에 제대로 답하려면 판매자/회사 고유의
사실이 실제로 필요한가」이고, 기존 규칙이 닿지 못하는 경우가 정확히 하나 있었다 — **별점이 반대를 가리키는
경우**: ★5인데 질문을 한 리뷰(「물에 닿아도 써도 되나요?」). 절을 **하나 더했고 아무것도 빼지 않았다**.

`QuestionShape.asks()` — 토픽이 아니라 **문법**이다. 읽는 낱말은 `QueryWords`가 2026-08-24부터 갖고 있던
닫힌 목록의 **의문 부분집합**이고, 목록에 낱말을 더하지 않았다(`습니다`·`입니다`는 여기 없고 `습니까`·
`나요`는 있다). 여기에 토픽 낱말을 넣는 순간 이 클래스는 자기가 피하려고 존재하는 키워드 분류기가 된다.

**빼려다 되돌린 것 하나를 기록한다.** 「라이브러리가 비었으면 무조건 묻는다」를 지우면 §E(칭찬)가 더
깨끗해지지만, ★4 「괜찮긴한데 잘떨어지네요」를 빈 라이브러리에서 잃는다 — 별점이 볼 수 없는 불만이고 이
lane이 존재하는 이유다. 칭찬에 한 번 더 묻는 쪽이 싼 오류라 되돌렸다.

**라이브가 또 하나를 드러냈고 고쳤다.** 「배송이 너무 느려서」가 회사 배송 정책으로 `GROUNDED`가 됐는데 같은
화면이 「이 **상품**에 대한 공식 기준이 있나요」를 물었다 — 방금 쓴 근거를 엉뚱한 코퍼스에 대해 다시 요구하는
셈이다. grounded 판정을 「**어느 lane이든** 답했는가」로 고쳤다.

**여전히 못 하는 것: polarity.** ★4가 명백한 불만인데 라이브러리가 무관한 문서로 차 있으면 아무것도 묻지
않는다. 세 패키지가 이 벽을 양쪽에서 쟀다. 덜 묻는 쪽이 안전한 방향이다.

## 10. 지연 · 인덱스 비용 · 운영 영향

- **검색 지연(실측, 로컬)**: warm 137–408ms (질문 임베딩 왕복 1회), **cold 2,734ms**(그 코퍼스의 문장 32개를
  한 번에 임베딩하는 첫 검색). lexical은 5–29ms였다. 초안 경로에서 이것은 드래프터 호출(6.5–12.5초) 옆의
  **한 자릿수 퍼센트**다. 판매자의 검색 상자에서는 눈에 보이는 변화다 — 정직하게 적는다.
- **인덱스 크기(실측)**: chunk 10개 → 문장 벡터 **32행 · 131KB**(행당 4KB). 상품 하나의 라이브러리 전체가
  40KB 언저리다.
- **비용**: 벤더 공표 단가는 이 저장소가 검증할 수 없는 **외부 사실**이다. 관측된 물량으로 말하면 —
  상품 하나 라이브러리 최초 색인 ≈1,500 토큰(1회), 검색당 질문 ≈20 토큰. 판매자의 일일 AI 예산에는
  **청구되지 않는다**(임베딩은 `AgentUsageKind` 소비자가 아니다) — 이것은 **product-owner 결정**으로
  올린다: 켤 배포에서 예산에 넣을지.
- **운영**: 새 프로세스·큐·스케줄러·마이그레이션 잡 **0**. 벤더가 죽으면 벡터가 채워지지 않고 lane이
  lexical로 되돌아간다(조용히, 그리고 그것이 옳다).

## 11. 특정 기업 overfit 점검

production 코드 전체를 이름으로 훑었다: **「실리콘」·「전선몰딩」·「선바로」·「떨어」·특정 org id·특정
product id·이번 QA 문장 = 0건.** 도메인 낱말이 들어간 유일한 자리는 이미 있던
`KnowledgeTopic`(배송·교환·반품·결제·계산서·영수증)이고, 이 패키지가 더한 것은 그 표를 **쪼갠** remedy 축
하나다 — 새 낱말 0. e-commerce 도메인 객체(Product/Review/Inquiry)를 쓰는 것은 이 제품의 정상적인
specialization이라 generic으로 바꾸지 않았다.

임계값도 한 회사에서 고르지 않았다: 벤치마크는 서로 다른 상품 도메인 셋과 회사 정책 하나, 그리고 「문서
하나뿐인 회사」·「교환 정책만 있는 회사」 변형을 포함한다.

## 12. 남은 실패와 다음

**여전히 실패하는 것(라이브·벤치마크 양쪽에서 같은 것):**

1. **「잘떨어지네요」·「자꾸 들떠요」** — 부착 안내를 못 찾는다. 임베딩이 이 구어 표현과 「접착력이 오래
   유지됩니다 / 한쪽 끝이 들뜰 수 있습니다」를 잇지 못하고, margin도 서지 않는다. **가장 큰 남은 gap**이다.
2. **「방수 되나요?」 → 부착 방법 안내** (false evidence 1건). m=0.12면 닫히지만 「두께가 생각보다…」를 잃는다.
3. **「언제쯤 받아볼 수 있을까요?」** — 배송 정책 대신 현금영수증 안내가 살짝 높게 나와 margin이 서지 않는다.
4. **polarity 미검출** (§9).
5. **첫 검색 2.7초** — cold 색인이 검색 경로에 있다. 지식 저장 시점에 미리 채우면 없앨 수 있지만 그러면
   벤더 실패가 판매자의 저장에 붙는다. 지금은 저장을 지켰다.

**다음으로 해야 할 것(짧게):**

- **질의 확장 없이 recall을 더 올릴 수 있는가** — 1·3번은 「질문을 한 번 더 다른 형태로 묻는다」가 아니라
  **passage 쪽 표현을 더 잘게 나누는 것**(더 짧은 단위, 문서 제목 외 소제목)으로 접근할 여지가 있다. 측정 먼저.
- **판매자에게 보이는 것**: 근거가 붙지 않았을 때 「무엇이 빠졌는지」는 이미 말한다. 「이 표현으로는 못 찾았다」는
  말하지 않는다 — 검색기 사정을 판매자 언어로 옮기는 일이라 이 패키지에서 하지 않았다.
- **예산 귀속**(§10) · **켤 것인가**(§6의 새 노출) — 둘 다 product-owner 결정.
- Answer Memory lane은 semantic으로 함께 옮겼지만 **이번 라이브에서 관측되지 않았다**(QA org에 과거 답변 0).

---

## 검증

- backend **3,737 tests** · 실패 0 · `RetrievalBenchmarkTest`가 shipped 경로에 대해 recall ≥0.80 ·
  any-wrong = 0 · no-evidence ≥0.85 · lexical 대비 +30pp를 단언한다.
- V92는 실제 로컬 DB에 적용(마이그레이션 1건, ERROR/WARN 0, 기동 6.6초).
- **마켓플레이스 호출 0 · 마켓플레이스 WRITE 0 · 승인 0 · 실행 0.** 다른 org의 embedding 행 0,
  Demo Org 지식 18/6 무변경, review approval 2 / execution 1 (기존 라이브 증명) 무변경 ⇒ evidence 행 없음.
- **계약이 바뀌어 테스트 2건을 다시 썼다**: `ReviewKnowledgeNeedTest`(질문 절 추가 · 되돌린 시도 기록),
  `ReviewDraftComposerTest`(정책 lane 근거 케이스 추가).
- QA org(`KRQ QA`)와 그 33개 벡터·11개 초안은 로컬 DB에 남아 있다.
