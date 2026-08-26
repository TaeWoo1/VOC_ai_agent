# Core Daily Loop UX Integration v1

**Status:** 구현 완료 · 2026-08-27
**Scope:** integration / UX / audit only. 새 기능 확장 **0**, 새 connector **0**, Agent architecture 변경 **0**.
**마켓플레이스 호출 0 · 마켓플레이스 WRITE 0 · DB 변경 0.** 모델 호출은 §8의 **2회**(합성 fixture)뿐이다.

이 패키지는 새 층을 만들지 않는다. 이미 구현된 것들 — 문의 우선순위/work item · 상품·주문 근거 ·
Product Knowledge · Knowledge Gap Resolution · `GROUNDED`/`NEEDS_CLARIFICATION`/`NO_ANSWER_BASIS` ·
Organization Answer Style · Human Approval — 을 **판매자 한 사람의 하루**로 잇고, 데모를 방해하는
UX·semantic gap만 닫는다.

---

## 1. Style audit identity — `style/v3` 은 identity가 아니었다

Organization Answer Style v1은 초안의 `model_version`에 `+style/v3`을 붙였다. 감사 결과 그 문자열은
**재현 가능한 식별자가 아니다**: `v3`은 그 org 자신의 저장 카운터이므로

- 서로 다른 회사가 같은 `style/v3`을 찍고 서로 다른 말투로 답했고,
- 설정을 바꿨다가 되돌린 회사는 **바이트 단위로 같은 프로필**을 `style/v5`로 찍었다.

감사자가 실제로 묻는 질문 — 「이 답변은 지금 설정된 스타일로 쓰인 것인가」 — 에 답할 수 없었다.

**고친 방법은 새 칸이 아니라 같은 seam이다.** `AnswerStyleProfile.digest()`가 정규화된 프로필의
SHA-256 앞 12자리를 내고, `identity()`가 `style/v3@8f1c0a2b4d6e`를 낸다. 성질 둘:

- **같은 말투는 같게 찍힌다** — org가 달라도, 버전 카운터가 달라도.
- **다른 말투는 다르게 찍힌다** — 말투·길이·이모지·인사·마무리·호칭·표현 목록·unknown fallback
  어느 하나만 달라도. 필드는 라벨과 구분자로 나뉘어 있어 「인사 끝 + 마무리 시작」을 옮겨 붙여도
  같은 digest가 나오지 않는다(`AnswerStyleIdentityTest`).

**프로필 없음은 `style/default`이고 digest가 없다.** 한 번도 설정한 적 없는 회사와 기본값을 저장한
회사는 다른 사실이고, 재현할 저장이 있는 쪽은 후자뿐이다. 기본값 자체는 shipped 상수라 지문이 필요
없다.

**digest는 snapshot이 아니다.** 판매자의 인사말과 표현 목록은 단방향으로만 들어간다 — 재현 가능한
감사를 만들면서 고객·판매자 문장의 **두 번째 사본**을 만들지 않는 것이 이 선택의 전부다. prompt
snapshot 저장 architecture는 만들지 않았다.

**필요했던 schema 변경은 한 줄이다.** `V81` — `inquiry_reply_draft.model_version`을
`varchar(120)` → `varchar(200)`. 측정값: 배포된 OpenAI 설정에서 stamp는 **115자**이고, 더 긴 벤더
모델 id에서는 120을 넘는다. 넘치는 provenance 문자열의 수리는 **자르는 것이 아니다**. 새 칸·새 테이블·
backfill **0**이고, 문자열의 **의미**는 바뀌지 않는다.

## 2. Pilot metric — `SELLER_APPROVED_FALLBACK`은 AI 초안이 아니다

`author_kind`를 읽어 채택률을 계산하는 **production 코드는 없다**(감사됨: `InquiryReplyDraftService`가
쓰고 `ReplyDraftView`가 실어 보낼 뿐이다). 지표는 전부 `docs/pilot_usage_loop_v1.md`의 SQL이고, 거기
술어가 `author_kind <> 'SELLER'`였다 — 그러면 **모델이 쓰지 않은 문장**이 「AI 초안 그대로 승인」에
들어가고, 그것은 **채택률을 올리는 쪽으로** 틀리는 오류다.

**docs only 정정.** 술어는 `= 'MODEL'`이 됐고, 유예는 분자에도 분모에도 넣지 않은 채
**`approved_deferral`**로 따로 센다. `RULE`도 같은 이유로 빠진다.

## 3. 사용자-facing 이름 — reviewnary

제품명은 **reviewnary**다. 내부 이름(패키지·env·클래스·DB·connector identifier)은 **하나도**
바꾸지 않았다. 화면 문자열만 옮겼다: 사이드바 · 인증 카드 · 오류 화면 · 공개 헤더/푸터 · 랜딩 ·
브라우저 탭 제목 · 로그인/가입 오류 · 리뷰/문의/상품/Agent/메모리 화면의 산문 — **50곳 / 31파일**.

**남긴 것은 목록으로 선언했다 — 150곳 / 39파일**: 연결·온보딩·Action Window·도우미 계열.
이유는 브랜드가 아니라 **사실**이다. 「SellerOps 도우미」는 판매자가 **자기 컴퓨터에 설치하고 직접
찾아야 하는 프로그램**의 이름이고, 이 저장소는 그 설치된 애플리케이션이 실제로 무엇으로 보이는지
확인할 수 없다. 가리키는 대상을 그대로 둔 채 안내문만 바꾸는 것은 이름이 두 개인 것보다 나쁜 결함이다.
그 화면들은 다음 패키지(Disconnected Channel Onboarding Live Walkthrough v1)가 소유하며, 설치된
이름을 **관측한 뒤** 둘을 함께 옮기는 것이 옳다. `productName.test.ts`가 예외 목록 밖의 노출을 **0**으로
고정하고, 예외의 **개수**까지 고정한다 — 조용히 자라는 allow-list는 규칙이 없는 것과 같다.

## 4. 문의 상세의 위계 — 다섯 걸음

판매자가 읽는 순서를 고정했다: **1 고객이 무엇을 물었는가 → 2 AI가 무엇을 판단했는가 →
3 무슨 근거를 봤는가 → 4 어떤 답변을 준비했는가 → 5 지금 무엇을 누르면 되는가.**

2가 **없었다**. 그래서 §5가 이 패키지의 본체다.

3은 초안 카드 안에 붙어 있고 이 패키지도 그대로 뒀다 — 근거를 초안 위로 올리면 초안이 fold 아래로
내려간다(Executive Readiness Fix v1이 측정으로 닫은 문제). 대신 2의 카드가 「무엇을 확인했는가」를
한 줄로 답하므로, **이해의 순서**는 지켜지고 화면의 순서만 다르다.

**기본 표면에서 사라진 기술 용어:** Agent 근거 줄의 내부 evidence id와 raw provenance 문자열
(`근거 e1 · … · inbox/SERVER:unansweredInquiries` → 라벨·건수·기간·확인일만). `GROUNDED`·
`NO_ANSWER_BASIS`·`SpecApplicability`·model·classifier·retrieval score·locator는 이미 화면에 없다.

**부수 결함 하나** — 문의 상세의 운영 정보 카드가 `bg-surface-2`·`text-ink-2`·`text-ink-3`을 쓰고
있었는데 **테마에 없는 토큰**이라 CSS가 생성되지 않았다(배경 없음, 색 상속). 존재하는 토큰으로 교체.

## 5. 세 상태 — 하나의 카드, 세 가지 모양

백엔드는 오래전부터 세 상태를 가지고 있었고 **화면은 그중 하나만 그리고 있었다.**

- **GROUNDED**는 실패와 **같은 주황 경고 띠**로 발표됐다. 「판매자가 등록한 근거를 사용해 썼습니다」는
  참이지만 좋은 소식이 아니라 고지처럼 쓰여 있었다.
- **NEEDS_CLARIFICATION**은 **아무 데도 그려지지 않았다**. `answerBasisAction`은 이 상태에서 `null`을
  돌려줬고 `answerBasisNote`는 렌더 site가 없었다. 그래서 판매자는 「규격을 알려주시면」이라는 정중한
  **되묻는 초안**을 *답이 짧게 나온 것*으로 읽고 그대로 보냈다.

이제 `AnswerStateCard` 하나가 세 모양을 그린다. **문장은 백엔드의 것**이고
(`AnswerBasisState.messageKo()`/`actionKo()`), 화면은 **테두리·순서·어떤 컨트롤이 어느 상태에
속하는가**만 정한다 — 문장을 프론트에 다시 쓰면 그것이 어긋나는 두 번째 사본이다.

| 상태 | 문장 | 색 | 딸려 오는 것 |
|---|---|---|---|
| `GROUNDED` | 「답변에 필요한 정보를 확인했습니다.」 | **good** | 근거 인용 · 초안 · 등록/복사 CTA |
| `NEEDS_CLARIFICATION` | 「정확한 답변을 위해 고객에게 확인할 내용이 있습니다.」 + 「고객이 어떤 규격·옵션인지 밝히지 않았습니다. 아래 초안은 그 내용을 되묻습니다.」 | warn | 되묻는 초안이 primary |
| `NO_ANSWER_BASIS` | 「답변 기준이 필요합니다.」 + 무엇이 빠졌는가 | warn | **[답변 기준 추가]** · 초안 **0** · 판매자의 빈 상자 |

**good은 GROUNDED 하나뿐이다.** `NEEDS_CLARIFICATION`은 정확한 답변이면서 여전히 판매자의 눈을
필요로 한다 — 고객은 답을 받는 것이 아니라 질문을 받는 참이고, 그것을 흘려보내면 스스로 답할 수 있는
질문을 되묻게 된다. 대비 실측(카드 tint 위): `ink` **13.98:1** · `muted` **6.00:1** · `good` 텍스트
**5.97:1**.

**초안이 없는 것이 오류처럼 보이면 안 된다** — `NO_ANSWER_BASIS`는 헤드라인·빠진 것·직접 쓰는
상자·[답변 기준 추가]를 갖고, 「초안을 만들지 못했습니다」류의 실패 문구는 없다. 기계가 돌지 못한
경우(예산·용량·벤더 무응답)는 **다른 카드**이고 상태 카드는 아예 렌더되지 않는다 — 끝까지 보지 못한
것과 보고 나서 없는 것은 다른 주장이다(§9-1, 2026-08-27).

**reload에서는 상태를 주장하지 않는다.** 저장된 행이 들고 있는 것은 「어떤 지식이 있었는가」
(`knowledge_state`)이지 「고객이 규격을 밝혔는가」가 아니다. 되묻는 초안을 `GROUNDED`로 표시하는 것은
바로 이 화면이 막으려는 종류의 자신 있는 오답이므로, 카드 없이 저장된 문장만 보인다. **남은 한계이며
§17에 적는다.**

## 6. Knowledge gap inline loop — 저장하고 나서 무슨 일이 있었나

`[답변 기준 추가]` → inline 저장 → 재색인 → **같은 문의 재판단** → 결과 변경. 흐름은 이미 있었고
**끝이 침묵이었다**: 상자가 닫히고 초안이 다시 만들어지는데, 판매자는 자기 문장이 저장되긴 했는지
알 수 없었다. 특히 재생성이 **같은 상태**로 떨어질 때 — 이 질문을 덮지 않는 지식을 추가하면 그것이
평범한 결과다.

이제 저장 직후 한 줄이 붙는다: 「답변 기준을 저장했습니다. 저장한 내용으로 답변을 다시 만들었습니다.」
**두 사실만 말하고 결과는 주장하지 않는다** — 결과는 바로 아래 카드가 말한다. 그리고 §12의 최소 경로가
그 자리에 열린다: 「이 상품에 등록된 답변 기준 보기」 → `/products/{productId}`.

마켓플레이스 자동 WRITE **0**(`confirmInquiryPublish` 미호출을 테스트가 고정).

## 7. Style settings 통합

`/settings/style`의 설명을 「문의 답변의 말투와 표현 방식을 설정합니다. 상품 정보나 정책 등 사실
자체는 바뀌지 않습니다.」로 바꾸고, **나머지 절반이 어디 있는지** 화면 안에서 가리키게 했다 —
「답변의 내용은 어디서 오나요」 패널에서 운영 정책과 상품별 답변 기준으로. 자기 짝을 한 번도 부르지
않는 설정 화면은 누가 두고 간 개발자 스위치처럼 읽힌다. prompt/model 같은 단어는 여전히 **0**.

## 8. Bounded model proof — 로컬 2회

`AnswerStyleLiveModelProofTest` — 기본 **skip**이고 `SELLEROPS_STYLE_PROOF=1`에서만 돈다. 합성 질문 ·
합성 근거 1개 · 마켓플레이스 0 · DB 0 · Spring context 0. 빌드를 막는 단언은 결정론적인 것 하나뿐이다:
**두 payload의 사실 부분이 바이트 단위로 같고 스타일 섹션만 뒤에 붙는다.**

실행(2026-08-27, `gpt-5-2025-08-07`, 호출 **2**):

```
---- DEFAULT_STYLE  reason=ok
안녕하세요. 문의 주셔서 감사합니다. 테스트몰딩은 화이트와 아이보리 두 가지 색상으로만 판매하고
있습니다. 추가로 궁금하신 점이 있으면 언제든지 말씀해 주세요. 감사합니다.

---- style/v7@e3eb355ac258  reason=ok
안녕하세요, 테스트몰딩입니다. 테스트몰딩은 화이트와 아이보리 두 가지 색상으로만 판매하고 있으니
참고 부탁드립니다. 좋은 하루 보내세요.
```

**사실은 같다** — 근거에 있는 단 하나의 사실(「화이트와 아이보리 두 가지」)이 양쪽에서 그대로다.
색상이 늘지도, 가격이 생기지도, 배송 약속이 붙지도 않았다. **말투·길이·인사는 다르다** — 두 번째는
판매자가 등록한 인사말과 마무리를 그대로 쓰고 `SHORT`만큼 짧다. 벤더의 산문은 여전히 unit test truth로
만들지 않았다.

## 9. Fallback proof — 로컬

`AnswerStyleDraftTest`(실 DB `@DataJpaTest`, 모델 stub) 9/9 통과:
**F** fallback 없음 → 모델 호출 **0** · 초안 **0**, **G** 승인된 fallback 있음 → 그 문장 **그대로** ·
모델 호출 **0** · `author_kind=SELLER_APPROVED_FALLBACK` · basis는 여전히 `NO_ANSWER_BASIS`.
UI 수준은 `InquiryResponsePanel.answerStyle.test.tsx` 3건. 마켓플레이스 **0**.

## 10. Demo Org 감사 — 읽기 전용

canonical Demo Org(`7146c50f`, 「데모 제조사」), **mutation 0**. 실측:

| 확인 | 값 |
|---|---|
| Cafe24 `ACTIVE`+`REAL` 미답변 | **21** — 정정된 진실 그대로(`docs/cafe24_comment_answer_observation_v1.md`의 25→21) |
| Cafe24 오래된 답변 행이 「답변 필요」로 노출되나 | **아니오** — `ACTIVE`+`ANSWERED` 50, 그중 미답변으로 서 있는 행 0 |
| 홈 KPI 「현재 미답변 문의」 | **30** |
| 같은 조건 `REAL`만 | **22** |
| 채널표 미답변 합 | CAFE24 21 · COUPANG 5 · NAVER 4 = **30** (KPI와 일치) |
| 작업 큐(`OPEN`+`PROPOSED`) | **21** |

**semantic 충돌은 없다** — 30은 채널표 합과 정확히 같고, 21은 다른 질문(작업 항목)의 답이다.
**틀린 seller-facing 숫자는 둘이고 아래 §17에 blocker로 적는다.**

## 11. 가독성

새 디자인 시스템 **0**. 이번에 줄인 중복:

- GROUNDED에서 「판매자가 등록한 상품 정보를 근거로 썼습니다」가 상태 카드·인용 카드와 **세 번**
  같은 사실을 말하고 있었다 ⇒ 상태 카드가 있는 동안 그 줄은 렌더하지 않는다.
- `NO_ANSWER_BASIS`에서 그 줄의 긴 형태(「아래 과거 답변은 참고용이며」)는 **이 화면에 없는 인용**을
  가리킨다 — 근거 없는 생성은 evidence 행을 기록하지 않으므로 「아래」가 없다.
- 존재하지 않는 색 토큰 3종 교체(§4).
- Agent 근거 줄에서 내부 id와 provenance 문자열 제거(§4).

## 12. Product Knowledge 표면

새 knowledge admin **0**. 이미 있는 `/products/{id}`의 라이브러리로 **연결만** 했다(§6).

## 13. Agent

Agent architecture 변경 **0**. 문의 상세의 판단·근거·준비된 action이 이미 Agent의 행동이고, 이번에
한 것은 그 화면에서 **기계의 어휘를 뺀 것**뿐이다.

## 14. Regression

| | 무엇 | 어디 |
|---|---|---|
| A | 기본 style과 custom style → 사실 payload 동일 | `AgentDraftPayloadFloorTest` · `AnswerStyleDraftTest` C · §8 |
| B | style digest가 서로 다른 프로필을 구별 | `AnswerStyleIdentityTest` (5건) |
| C | 기존 초안은 style 변경으로 mutation 0 | `AnswerStyleDraftTest` |
| D | fallback은 AI 초안 지표에 포함되지 않음 | `docs/pilot_usage_loop_v1.md` (docs only — production reader 0) |
| E | GROUNDED → 근거 + 초안 + CTA, 경고색 아님 | `InquiryResponsePanel.answerStates.test.tsx` |
| F | NEEDS_CLARIFICATION → 빠진 맥락 + 되묻는 초안, 사실 추가 0 | 같은 파일 |
| G | NO_ANSWER_BASIS → knowledge CTA + 초안 0 | 같은 파일 · `knowledgeGap.test.tsx` |
| H | knowledge 저장 → 재판단, 결과를 주장하지 않음 | 같은 파일 (2건) |
| I | 이미 답변된 문의 → 전송 CTA 0(그리고 「다시 작성」도 0) | 같은 파일 |
| J | 사용자-facing `SellerOps` → 선언된 예외 외 **0** | `src/lib/productName.test.ts` |
| K | 마켓플레이스 WRITE 0 | `answerStates` · `knowledgeGap` |

## 15. 세 상태 walkthrough — 판매자는 무엇을 보고 무엇을 누르는가

실제 렌더 덤프 기준(브라우저 스크린샷은 §17 참조).

- **A · GROUNDED** — 고객의 질문 아래 초록 카드로 「답변에 필요한 정보를 확인했습니다」가 서고, 그
  아래 초안 본문과 근거 인용(출처·제목·발췌)이 있다. **누를 것은 [초안 복사]**(등록 가능한 채널에서는
  [답변 보내기]와 확인 단계), 보조로 [수정]·[다시 작성].
- **B · NEEDS_CLARIFICATION** — 주황 카드가 「정확한 답변을 위해 고객에게 확인할 내용이 있습니다」와
  「고객이 어떤 규격·옵션인지 밝히지 않았습니다」를 말하고, 초안은 규격을 **되묻는** 문장이다.
  **판매자가 규격을 이미 안다면 [수정]해서 답하고, 모르면 그대로 보낸다.**
- **C · NO_ANSWER_BASIS** — 주황 카드가 「답변 기준이 필요합니다」와 「…「가닥」 관련 내용이 없습니다」를
  말하고 초안은 **없다**. **누를 것은 [답변 기준 추가]** — 그 자리에서 한 문장을 쓰고 저장하면 같은
  화면에서 다시 판단된다. 아니면 아래 빈 상자에 직접 쓴다.

## 16. 무엇을 하지 않았는가

새 connector · image/CV · ontology · shipping/gift/promotion knowledge · option axis parsing ·
color dictionary · Product analytics 재설계 · Agent architecture 변경 · automatic style learning ·
review style · **marketplace WRITE live proof** — 전부 **0**.

## 17. 남은 blocker와 한계

1. **홈 KPI 「현재 미답변 문의」가 합성 행을 센다.** `countByStatus`에 `data_origin` 조건이 없어
   Demo Org에서 22 → **30**으로 부푼다(`DEMO_SEED` 6 + `VERIFY_FIXTURE` 2). 숫자를 바꾸는 것은
   **product-owner 결정**이라 고치지 않고 보고한다.
2. **`PROPOSED`인데 채널에서는 이미 답변된 work item 1건**(Cafe24, 2026-08-26 수신)이 작업 큐에 남아
   21에 포함된다. 상세 화면은 「이미 답변된 문의」로 전송 CTA를 끄므로 **잘못된 행동은 불가능**하고,
   `reconcileConnectorAnswered`는 self-healing이라 **다음 수집에서 닫힌다** — 커넥터가 꺼진 이
   환경에서 sweep이 돌지 않았을 뿐이다.
3. **열린 proactive case 2건이 둘 다 끝난 일을 가리킨다** (하나는 work item `COMPLETED`, 하나는 위
   2번). `proactive_case.status`는 매 tick 파생되는데 `SELLEROPS_PROACTIVE_ENABLED=false`라 tick이
   돈 적이 없다. 데이터 mutation 금지 지시대로 **고치지 않았다**.
4. **reload에서는 세 상태를 복원할 수 없다**(§5). 복원하려면 `inquiry_reply_draft`에 `answer_basis`
   한 칸이 필요하고, 그것은 이 패키지의 범위를 넘는 schema 결정이다.
5. **브라우저 스크린샷은 찍지 않았다.** GROUNDED/NEEDS_CLARIFICATION을 실제로 렌더하려면 **실제
   고객 문의에 대해 초안을 생성**해야 하고, 그것은 §8이 허용한 합성 2회를 넘는 모델 호출을 실제
   판매자 데이터에 하는 일이다. 대신 렌더 덤프(§15)와 렌더 테스트 9건으로 고정했다.
6. **`SellerOps` 문자열 150곳이 남아 있다**(§3) — 선언된 예외이고, 다음 패키지가 설치된 도우미의
   실제 이름을 관측한 뒤 함께 옮기는 것이 옳다.
7. **`DraftKnowledgeState.messageKo(scopes)`의 과거-답변 caveat는 가리킬 대상이 없다** — 그 문장이
   나오는 상태는 evidence 행을 기록하지 않는다. 화면에서는 §11로 렌더되지 않게 됐지만 **문장 자체는
   그대로 두었다**; 백엔드 copy 변경은 자체 근거가 필요하다.

---

## 부록 — 로컬 실행 기록 (2026-08-27)

- **V81 적용.** 커넥터 3개 · 수집 스케줄러 · self-pilot · proactive · draft capability를 **명시적으로
  끈 채** 기동. Flyway `Current version 80` → `Migrating to "81 - reply draft model version width"`
  → `Successfully applied 1 migration … now at version v81` (5ms). 기동 **6.45s**. 부팅 로그의
  naver/coupang/cafe24 문자열 **0** · openai/anthropic/vision/enrichment **0** · ERROR/WARN **0**.
  `information_schema`: `inquiry_reply_draft.model_version` = **varchar(200)**. 종료 후 8080 해제.
- **데이터 무변경.** 실행 전후 `inquiries`(ACTIVE·UNANSWERED) **30** · `inquiry_reply_draft` **11** ·
  `organization_answer_style` **0**.
- **테스트.** backend **393 suites / 3,415 / 실패 0 / skip 23**(skip +1 = §8의 opt-in proof) ·
  frontend **177 files / 2,365 / 실패 0**.
