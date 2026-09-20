# Inquiry Architecture v3 — Capability-Oriented Resolution (설계 · 구현 0)

2026-09-20 · 브랜치 `feat/review-decision-workspace-v1` · 기준 커밋 `fbe33ff0`

**상태: ADOPTED — product-owner 결정 2026-09-20.** 채택 내용: authority 넷(KNOWLEDGE / ENTITY_STATE / PROCEDURE / SELLER), PROCEDURE는 SELLER에 합치지 않는 first-class(실행기 없으면 DECLARED + CAPABILITY_GAP), CUSTOMER_INPUT은 step의 required input, CAPABILITY_GAP·SYSTEM_ACQUIRE는 state, 과거 답변은 precedent, 공개 Q&A는 non-sensitive 상품 맥락만 묻는다, headline 다섯(Wrong Automation은 배포 차단), 72행 gold는 명백한 행만 동결.
**WP-1(결정론 authority layer + eval 자산 복구) 구현됨 → `docs/inquiry_architecture_v3_wp1.md`. WP-2(Resolution Planner: contract → 201호출 shadow) → `docs/inquiry_architecture_v3_wp2.md`. WP-3(step shape를 capability class별로 쪼개고, effect를 registry로 옮기고, positional scorer를 split-tolerant goal scorer로 대체) → `docs/inquiry_architecture_v3_wp3.md` — plan gold는 v3.2로 재표현됐고(재라벨 0), `effect`와 `depends_on`은 plan에서 사라졌다. WP-4(Planner Final Validation & Freeze Gate) → `docs/inquiry_architecture_v3_wp4.md` — smoke 통과 후 67×1 shadow 실행, **freeze gate 미통과 → Resolution Planner는 동결되지 않았고 WP-4 E2E도 제안하지 않는다**(closing contract가 닫는 권한의 「개수」와 「순서」만 정하고 「무엇이 닫는가」를 정하지 않아, 마지막에 적힌 step이 closer가 된다 — 모델의 SELLER-마지막 습관 49/49가 의미 판단으로 바뀌었다). WP-3.1(Closing Authority Semantics & Replay Diagnostics) → `docs/inquiry_architecture_v3_wp31.md` — **모델 호출 0**, 기존 raw answer를 replay만 해서 진단했다(verdict 동일 확인). **WP-4의 headline은 방향이 틀렸다** — 「누가 계획에 있는가」가 아니라 「누가 실제로 닫는가」로 재면 v3는 1.000→0.875로 퇴행한 것이 아니라 **0.722→0.875로 개선**됐고, 1.000은 한 need가 두 개의 ending을 적은 plan 20/72건을 정답으로 세고 있었다. wrong closer 5건은 전부 **같은 모양**이다(gold가 닫아야 한다고 말한 authority가 PRECONDITION으로 강등되고 마지막에 적힌 step이 닫는다 — 그중 둘에는 SELLER가 아예 없다). truncated content 보존(`said`)·`unavailable_fields`·registry snapshot을 row에 적어 다음 truncation은 관찰 가능하지만 **기존 4건은 영구 복구 불가**다. closing contract 후보는 **C(`closing_authority`를 need의 명시 필드로)** 선택. **Part II에서 Candidate C를 구현했다**(모델 호출 0) — step-level role은 **삭제**됐고(`ResolutionPlan.Role` 부재, role을 실은 답은 `PLAN_SHAPE`), need가 `closing_authority`를 **steps보다 먼저** 선언하며, 같은 authority의 capability 둘이 함께 닫는 것이 한 필드로 표현된다(gold 4건·WP-4 실패 3건이 그 모양이었다). validator는 셋을 잃고(`NO_CLOSING_STEP`·`MULTIPLE_CLOSING_AUTHORITIES`·`PRECONDITION_AFTER_CLOSER` — 쓸 수 없게 됐으므로) 하나를 얻었다(`CLOSING_AUTHORITY_UNSUPPORTED`). gold **v3.3**은 v3.2의 무손실 재표현이고(양방향 검증 72/72, 재라벨 0) v3.2는 그대로 얼어 있다. **옛 모델 답변은 하나도 바뀌지 않는다** — projection으로 재해석하면 correct closer는 63/72로 동일하고, 바뀌는 것은 WP-2 needs의 **61/361(두 ending)**과 WP-4의 **3/5 contract violation**이 구조적으로 쓸 수 없게 된다는 것뿐이다. 남은 wrong closer 5건은 여전히 모델의 선택이며 **8-call smoke 전에는 아무것도 주장하지 않는다**. prompt `resolution-planner/v4` · backend 4,504/0 · tools 98/0 · mutation 19/19. **8-call smoke는 bar 8/8 통과**(commit `3397cc6d`, 호출 8/상한 8, 합성 질문만, 마켓플레이스·DB·마이그레이션 0) — correct closing authority 8/8 · contract violation 0 · seller fallback 0 · 신원 입력 0이고, 특히 `R:8989a9d0` 모양(C7)이 SELLER 없이 KNOWLEDGE로 닫혔으며 쓸 수 없는 capability(C8)는 **그대로 유지되고 gap으로 기록**됐다. bar가 이름 붙이지 않은 것 둘을 함께 보고한다 — C4에서 `ORDER_TRACKING` 한 칸 때문에 해결 가능한 goal이 gap이 됐고(§2의 `gapOf` 결정이 resolver 몫으로 남아 있는 그 결함의 두 번째 실물), C6은 고객이 묻지 않은 PROCEDURE need를 만들어 `procedure_for_read=1`이 됐다(freeze gate 3번 항목). **WP-3.2(Planner Boundary & Scope Hardening) → `docs/inquiry_architecture_v3_wp32.md`** — 모델 호출 0. residual 셋의 **소유자를 확정**했다. (A) PROCEDURE 경계: 72 gold를 먼저 감사해 「PROCEDURE step이 있는 goal 7건 전부가 PROCEDURE로 닫힌다, 반례 0」을 확인한 뒤에만 invariant `PROCEDURE_NOT_CLOSING`을 추가했다(WP-2에서 8회 발화했을 모양). **다만 이것은 C6를 고치지 못한다** — C6는 follow-up을 두 번째 need로 쪼갠 것이고 need 단위 규칙은 그것을 볼 수 없다. plan 단위 규칙은 정당한 계획(예외 승인과 반송 방법을 함께 묻는 문의)을 금지하게 되므로 만들지 않았고, **계약의 한계로 기록**한 뒤 instruction 한 문장과 `procedure_for_read` 측정에 맡긴다. (B) scope: capability만 보던 채점기가 C3/C7의 `SELLER_CATALOGUE`→`THIS_LISTING`를 0으로 보고하고 있었다 ⇒ scope/instance를 **first-class metric**으로 올리고(denominator는 선택지가 둘 이상인 capability만) freeze gate에 넣었다 — 실측 capability 11/11, **scope 0/2**. (C) over-read: `gapOf`는 **건드리지 않고** 설계 셋을 값으로 비교해 **B(planner field는 후보, resolver가 최소 충분 state를 결정)**를 WP-4 Entity Resolver 입력으로 권고한다(A에서만 P01·C4 두 건이 해결 가능한 goal을 gap으로 만든다; field-level은 R:7a8136b2 반례로 여전히 기각). prompt는 `resolution-planner/v5`로 바뀌었고 **system_fp 변경·schema_fp 불변·input_fp 8/8 동일·request_fp 0/8 동일** ⇒ **벤더 요청이 바뀌었으므로 67×1 전에 새 8-call smoke가 필요하다**(manifest 제시, 승인 없음). backend 4,504/0 · tools 105/0 · mutation 22/22. planner는 여전히 동결되지 않았고 WP-4 E2E도 제안하지 않는다.** 아래 본문은 설계 당시 그대로다 — WP-1이 바꾼 것 둘: GapReason에 가능한 gap `UNREADABLE_SOURCE`가 더해졌고(§4-B의 ACQUIRABLE과 같은 「가능한 gap」), 부록 A의 계획 라벨은 plan gold v3로 동결됐다(6행 PENDING_ADJUDICATION).

선행 문서: `inquiry_need_eval_v1.md`(need 단위 gold) · `inquiry_decision_v2.md` · `inquiry_decision_v2_1.md` ·
`inquiry_decision_v2_2.md`(A/B 466호출 · targeted 45호출).

---

## 0. 한 페이지 요약

**문제.** v2의 CoverageJudge는 need 하나에 대한 한 번의 enum 판정(FULL / CONDITIONAL / PARTIAL / NONE) 안에서 일곱 가지 서로 다른 질문을
동시에 답한다:
- 이 문장이 사실인가(static knowledge)
- 규격마다 다른가(variant semantics)
- 지금 이 주문은 어떤가(live state)
- 회사 규칙이 무엇인가(policy)
- 과거 답을 다시 써도 되는가(precedent provenance)
- 표가 전부를 덮는가(completeness)
- 관련 있는 글인가, 답하는 글인가(relevance vs answering)

실측이 이 책임 집중을 가리킨다:
- 남은 unsafe FULL 4건 중 1건(`4181864b`)은 **권한 혼동**이었다 — 주문 상태 need를 회사 배송 정책으로 FULL. v2.2가 판정 뒤에 코드로
  잡았다.
- 나머지 3건(`ae51c7f8` · T6c · `dae8554d` n2)은 **지식 내부의 의미 판단**이다. 반복해도 같게 틀리거나(3/3), 흔들린다(1/3).

**제안.** 판정 전에 **어떤 authority가 이 need를 닫을 수 있는가**를 먼저 정하고, authority마다 자기 완료 조건을 가진 resolver가 닫는다.

```
문의 ─▶ Resolution Planner (LLM 1회, registry-bound strict schema)
          │  need별 bounded plan: authority step 1–3 · entity · customer slot · 의존
          ▼
       Code: plan 검증 · registry 대조 · 불가능한 step → CAPABILITY_GAP (대체 authority 금지)
          ▼
   ┌───────────────┬──────────────────┬──────────────────┬──────────────┐
   KNOWLEDGE        ENTITY_STATE        PROCEDURE           SELLER
   검색 + Extract-   connector 읽기      전제 읽기 + 정책     handoff packet
   and-Check(LLM)   (결정론)            + (v3.0: 실행 0)    + Teach
   └───────────────┴──────────────────┴──────────────────┴──────────────┘
          ▼
       Code: need 상태 = step 결과의 결정론 함수 · 미해결 필수 need가 있으면 완결 금지
          ▼
       Draft(해결된 부분만) ─▶ InquiryClaimGuard ─▶ 승인 경계 ─▶ 채널 실행(기존, 무변경)
```

**vocabulary.**
- **Authority 넷**: `KNOWLEDGE` · `ENTITY_STATE` · `PROCEDURE` · `SELLER`.
- 넷에 들지 않는 것:
  - **CUSTOMER_INPUT**은 authority가 아니라 step에 붙는 **slot**이다.
  - **CAPABILITY_GAP / SYSTEM_ACQUIRE**는 **resolution state**다.
  - **과거 답변**은 **precedent**(memory)이고 resolver가 아니다.

**데이터 대입(67 case / 72 need, 사람 기준, 모델 0).**

| 계획 형태 | need 수 | 비율 |
|---|---|---|
| authority 하나 | 58 | 80.6% |
| KNOWLEDGE + 고객 slot | 5 | 6.9% |
| 여러 authority의 순차 계획(PROCEDURE 7 · LISTING→SELLER 2) | 9 | 12.5% |

- 첫 step이 KNOWLEDGE인 need는 55개다.
- 단일 라벨 classifier는 14개(19.4%)를 표현하지 못한다 ⇒ **bounded plan**이 맞다.

**남은 오류에 대한 정직한 예측.**
- capability 분리가 **구조적으로** 없애는 것: 권한 혼동(`4181864b` · A의 T13a).
- 지식 내부 의미 오류 3건은 분리만으로는 **없어지지 않는다**.
- v3는 그 자리의 판정을 「FULL인가?」라는 holistic verdict에서 **Extract-and-Check**로 바꾼다:
  - 요청된 칸마다 원문 인용을 추출한다.
  - 규격 적용 범위를 따로 묻는다.
  - 칸이 다 찼는지는 코드가 센다.
- 이것이 세 모양을 줄인다는 것은 **가설이고 측정 전이다**(§7).

**비용.**
- 지식 경로의 LLM 호출 수는 v2와 같다(plan + 지식 판정 + 초안).
- 지식이 필요 없거나 후보가 0인 case(dev set 67 중 27)는 판정 호출이 빠진다.
- F5 intent 재진술을 planner가 흡수하면 F5 ON 기준 질문당 ≈1.8s가 줄어든다(§13, 추정).

**첫 Work Package(§17).** **v3 WP-1 — Capability Registry + Entity-State Resolver + Resolution-Plan gold (모델 0)**.

**운영 사고 1건 보고.**
- 원인: Eval v1의 저장소 밖 gold 파일(`questions.jsonl` · `needs.jsonl` · `precedents.jsonl`)이 시스템 임시 디렉터리 정리로 사라졌다.
- 복구된 것: `needs.jsonl`은 세션 기록에 남은 빌드 스크립트를 재실행해 **해시 `db92a913…` 바이트 동일**로 되살렸고, 이 문서의 §8은 그 파일로
  했다.
- 복구되지 않은 것: `questions.jsonl`·`precedents.jsonl`은 원천 TSV가 함께 사라져 복구하지 못했다(해시는 `dataset.meta.json`에 남아
  있다).
- 결정 필요: gold의 **내구성 있는 저장소 밖 위치**는 product-owner 결정이다(§16-D).

---

## 1. 외부 architecture research

출처는 vendor 공식 문서다. 네 페이지(채널톡 「ALF란?」·「ALF 통계」·「ALF 주요 변경점」, ALF 테스트 전용 문서)는 조사 시점에 HTTP 500이었다:
- 「통계」의 해결 정의는 **검색 엔진 발췌**에 기댄다.
- 「테스트」는 전용 문서를 찾지 못했다.

### 1-A. 문제를 어떤 execution primitive로 나누는가

| | 정적 지식 | 행동 지침(행동 없음) | 라이브 데이터 | 정책 + 행동 | 사람 |
|---|---|---|---|---|---|
| **채널톡 ALF** | 지식(공개 아티클/FAQ만 참조, v2에서 파일·웹) | 규칙(자연어 프롬프트 · 고객/대화/채널로 범위 · 채널당 30) | 태스크의 Function 노드(API) — 예: 카페24 허브 `getOrders` | 태스크(노드 그래프: Agent·Message·Code·Action·Function·Approver…) | 상담원 연결 · Approver 노드 |
| **Intercom Fin** | content(「support content or data」만) | Guidance(「대화에 행동을 할 수 없다」, handoff 제외) | Data connector | Procedure(자연어 step + code condition + connector + sub-procedure + checkpoint) — **단일 FAQ에는 쓰지 말라**고 명시 | handoff · checkpoint |
| **Ada** | Knowledge | Custom Instructions · Coaching | Action / API tool | Playbook(SEND·SET·ASK·RUN·IF/ELSE·GO TO) | Handoff |

URL:
- https://docs.channel.io/help/ko/articles/%ED%83%9C%EC%8A%A4%ED%81%AC-ALF-v2-2a16be8b
- https://docs.channel.io/help/ko/articles/%EA%B7%9C%EC%B9%99-b43e19a1
- https://docs.channel.io/help/ko/articles/%EC%B9%B4%ED%8E%9824-%ED%97%88%EB%B8%8C-657238c6
- https://www.intercom.com/help/en/articles/12495167-fin-procedures-explained
- https://www.intercom.com/help/en/articles/10210126-provide-fin-ai-agent-with-specific-guidance
- https://docs.ada.cx/docs/welcome/key-concepts
- https://docs.ada.cx/docs/automation/playbooks

**공통점.** 셋 다 **데이터의 종류**로 primitive를 가른다:
- 정적 지식 = 검색 + grounded 생성
- 라이브 데이터 = 플랫폼이 실행하는 API(모델이 아니다)
- 정책 + 행동 = 구조화된 절차

「도메인 intent」로 가르는 제품은 없다. 배송·환불은 **절차의 인스턴스**이지 route 종류가 아니다.

### 1-B. LLM과 결정론의 경계

- **절차 진입은 LLM의 의도 매칭**이다. 작성자가 쓴 「언제 쓰는가」 설명과 대조한다:
  - ALF 태스크 트리거
  - Fin 「When to use this procedure」
  - Ada handoff 설명

  결정론 필터(VIP·채널·영업시간)는 **좁히기만** 한다.
- **절차 안의 critical path는 결정론**이다:
  - Fin code condition(「critical action에 권장」, https://www.intercom.com/help/en/articles/13459814-how-to-write-code-conditions-for-fin-procedures)
  - ALF Code 노드
  - Ada IF/ELSE
- **필수 입력은 connector가 정한다** — Fin은 「connector 호출 전에 고객에게 그 정보를 묻는다」(입력 스키마가 slot).
- **API 실패를 알아서 복구하는 제품은 없다**:
  - Fin은 「자동으로 처리하지 않고 재시도하지 않으며 grounded 되지 않은 응답을 낼 수 있다」고 적는다
    (https://www.intercom.com/help/en/articles/13704396-troubleshooting-fin-procedures-and-data-connectors).
  - 셋 다 status code 분기를 작성자에게 요구한다.
- **본인 확인은 별도의 결정론 gate**다 — 카페24 허브 비회원 OTP, Fin JWT/Email OTP(Workflows).
- **승인은 명시 노드**다 — ALF Approver, Fin checkpoint(https://www.intercom.com/blog/procedures-simulations-updates/).
- **ALF 규칙은 프롬프트라서 약하다.** 공식 문제 해결 문서가 「할 수 없는 행동을 약속할 수 있다」·「두 행동을 한 규칙에 넣으면 실패한다」를
  경고한다(https://docs.channel.io/help/ko/articles/ALF-%EB%AC%B8%EC%A0%9C-%ED%95%B4%EA%B2%B0-219af581).

### 1-C. 실패와 평가의 계층

| 층 | ALF | Fin | Ada |
|---|---|---|---|
| 수동 미리보기 | 적용된 규칙 표시 · 규칙 버전/롤백 | Preview(라이브 데이터 가능) | Interactive Testing |
| 묶음 Q&A | — | Batch test ≤50, 사람 채점 | — |
| **저장·재실행 시뮬레이션** | 태스크 「테스트」 모드(외부 API·데이터 변경 없음). 저장 suite는 문서에서 **찾지 못함** | Procedure별: AI 고객 · **connector는 샘플 payload(라이브 호출 없음)** · 성공 기준(답변·속성·connector 발동·결과) · AI judge Pass/Fail · 출시 전 재실행 권장 | 테스트 케이스 = inquiry + 시나리오 + 변수 + 측정 가능한 기대 결과 1–10 · GenAI judge · 변경 세트에 대해 실행. **Action은 mock되지 않는다(라이브)** |
| 생성 직전 검사 | — | — | Safe · Relevant · Accurate 검사 후 전송 |
| 운영 지표 | 해결 = 의미 있는 답 뒤 24h 내 상담 요청 없음(과금 대상) · Incomplete / Impossible 분류 | Resolution(confirmed/assumed) · involvement · funnel(resolved / procedure handoff / escalated) · CX Score | **ARR** = Relevant ∧ Accurate ∧ Safe ∧ Contained, 대화마다 LLM 판정 |

URL:
- https://www.intercom.com/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews
- https://www.intercom.com/help/en/articles/12599517-run-simulations-for-fin-procedures
- https://fin.ai/help/en/articles/10772642-fin-ai-agent-resolutions
- https://docs.ada.cx/docs/optimization/testing/simulations
- https://docs.ada.cx/docs/generative/measure-success/understand-and-improve-your-ai-agent-s-automated-resolution-rate

Ada ARR의 이력 두 가지가 이 문서의 교훈이다:
- 2024-07-31 이전에는 표본 기반이었다.
- 2025-02-24 이전에는 knowledge만 평가하고 process/action은 평가하지 않았다.

**headline은 한 번 정해도 무엇을 덮는지가 바뀐다.**

### 1-D. Reviewnary에 옮길 원칙

1. **authority(데이터의 종류)로 가르고, 도메인으로 가르지 않는다.** 배송·환불은 procedure의 인스턴스이고 route가 아니다.
2. **라이브 상태는 connector만 말한다.** 문서가 대신하지 않는다(Fin: content는 grounded 답, 상태는 connector).
3. **필수 입력은 capability의 계약에서 나온다.** 모델이 「무엇을 물어볼지」를 발명하지 않는다.
4. **실패 분기는 작성자(=코드)가 소유한다.** 모델이 연결 실패를 메우게 두지 않는다.
5. **행동은 명시 승인 노드 뒤에만** 있다.
6. **평가는 층을 나눈다.** 컴포넌트 → 절차별 시뮬레이션(**mock connector**) → 운영 지표이고, 시뮬레이션은 **설정 변경 전후 재실행**이 목적이다.
7. **지식 공백은 분류된 결과이자 작업 큐**다(ALF Impossible, Fin 「resolution state unknown」). 억지 답이 아니다.

### 1-E. 옮기지 않을 것

- **과금용 해결 정의**. 「24h 무반응 = 해결」·「고객이 떠남 = assumed」는 침묵을 보상한다. 게다가 마켓플레이스 Q&A는 **비동기 게시판**이라
  「떠남」에 신호가 없다.
  - Reviewnary의 해결은 **정확성 판정 + 관측된 결과**(채널 read-back `VERIFIED`)로 정의한다. Ada의 Accurate/Safe 쪽이고, 과금 정의는
    아니다.
- **LLM이 전부 정하는 handoff**(Ada). 승인 경계 뒤에서 쓰는 작은 도구는 escalation 조건을 **코드**가 정한다.
- **라이브 API 시뮬레이션**(Ada). 마켓플레이스 WRITE가 걸려 있으므로 mock만 허용한다(Fin·ALF 테스트 모드).
- **행동을 싣는 규칙 프롬프트**(ALF 규칙의 태그·배정). 공식 문서가 스스로 fragile하다고 적는다.
- 브라우저 자동화 노드·SMS·보이스·엔터프라이즈 쿼터. 특히 브라우저 자동화는 CLAUDE.md의 「hidden or chained platform clicks」 금지와
  충돌한다.
- **작성자가 절차를 만드는 no-code 빌더.** Reviewnary의 판매자는 절차 작성자가 아니다. 절차는 제품(코드)이 소유하고 판매자는 **정책 사실**만
  가르친다.

---

## 2. 현재 v2 architecture — 코드 기준 지도와 실패 원인

### 2-A. 한 문의의 초안 요청이 지나가는 길 (HEAD `fbe33ff0`)

```
POST /api/inquiries/{workItemId}/draft/generate
 └ InquiryDraftComposer.composeDraft
    ├ enrichDetailIfNeeded ............ NAVER 상세 1회 가능 (기본 OFF, LLM 0)
    ├ InquiryKnowledgeAssessor.assess(EXACT_ALLOWED)
    │   ├ SpecApplicability.classify .. 규칙 (규격 경고 줄)
    │   ├ Spine → InquiryEvidenceRetriever: product / org / answer-memory lane + order fact
    │   │     lane마다(ON이면) [LLM knowledge.intent] · embeddings · [LLM knowledge.eligibility]
    │   ├ CatalogueInvestigator ........ 결정론
    │   └ (v2 ON) InquiryDecisionEngine
    │        [LLM plan] → collect(need별 재검색) → E1..E30 / P1..P6 번호 → [LLM judge]
    │        → NeedAggregation.enforce + basis
    ├ NO_ANSWER_BASIS → 초안 없음 (판매자 승인 fallback만) · noteGap
    └ [LLM draft agent-draft-prompt/v12] → forbidden phrase → InquiryClaimGuard → save + evidence
```

측정된 비용(`inquiry_decision_v2.md` §7-A · v2.1 §15 · v2.2 §7):
- plan p50 1.7–1.8s
- judge p50 1.8–2.1s
- 합계 질문당 **≈3.5–3.8s**
- 초안은 추가로 ≈5s(기존 측정)
- F5 ON이면 intent ≈1.8s · eligibility ≈1.1s가 앞에 붙는다

### 2-B. 실패 원인 — 실측에서 읽은 여섯 가지

| # | 원인 | 증거 |
|---|---|---|
| F1 | **권한 혼동**: 증거 풀이 이질적이다(지식·정책·옵션·주문 사실·과거 답변). judge가 「어느 권한이 이 need를 닫을 수 있는가」까지 판정한다 | B의 `4181864b`: ORDER_STATE를 회사 배송 정책으로 FULL. A의 T13a: 정책으로 CONDITIONAL. v2.2가 판정 **뒤** 코드(`SCOPE_UNATTRIBUTED`)로 FULL만 잡았고 CONDITIONAL은 열린 질문으로 남았다 |
| F2 | **holistic verdict**: 충분성·규격 적용·표 완결성·관련 vs 답변을 enum 하나로 낸다. 어느 하위 판단이 틀렸는지 관측할 수 없다 | `ae51c7f8` FULL ×3(일관) · `dae8554d` n2 FULL ×3(일관) · T6c 1/3(흔들림). 셋 다 「이 listing의 근거 인용 + 가정·누락 비움」이라 code invariant가 닿을 자리가 없었다 |
| F3 | **규격 구조가 judge에게 보이지 않는다**: listing이 N개 규격으로 팔린다는 사실이 payload에 없다 | targeted: 규격별 표가 **함께** 있을 때(V1)는 3/3, 규격 없는 한 문장만 있을 때(V3·`ae51c7f8`) 실패 |
| F4 | **NeedType이 두 축을 겸한다**: 주제(스펙·호환·정책)와 권한(주문 상태·판매자 결정). `CATALOGUE_AVAILABILITY`는 「우드 색이 있나」(카탈로그 구조)와 「화이트 1호가 품절인가」(listing 상태)를, `SELLER_DECISION`은 「대량 할인」(새 판단)과 「파손 분무기 처리」(주문 절차)를 함께 담는다 | §8-C 교차표 |
| F5 | **precedent가 같은 판정에 들어간다**: v2.1이 reuse_scope로 입장을 막았지만 판정 payload에는 여전히 P1..P6이 들어간다 | v2.1 §계약 · `PrecedentReuse` |
| F6 | **직렬 지연**: plan → collect → judge가 순차이고, need가 지식을 요구하지 않아도 judge를 부른다 | §2-A |

**데이터 쪽 사실.** dev set의 58/67 case가 판매자로 끝난다(§8-B). 이 판매자의 지식이 얇고 dev set이 일부러 어렵기 때문이다. 따라서 v3의 가치
절반은 자동 답변이 아니라 **좋은 handoff와 정확한 Teach**에서 나온다.

---

## 3. 제안하는 v3 architecture

```
                         CapabilityRegistry.snapshot(org, inquiry)   ← Code (결정론, 요청마다)
                           │  ids · status · fields · bindings · askable slots · freshness
                           ▼
 inquiry ─▶ [1] Resolution Planner (LLM, strict schema, enum = registry ids)
             │   needs[] × steps[1..3]{authority, entity, fields|cells, dependsOn} + slots[]
             ▼
           [2] Plan Validator (Code)
             │   · 스키마/enum 밖 → PLAN_FAILED → NO_ANSWER_BASIS (현재와 동일한 fail-closed)
             │   · status≠AVAILABLE인 step → CAPABILITY_GAP(reason)  ※ 다른 authority로 바꾸지 않는다
             │   · ORDER step에 바인딩 없음 → ENTITY_UNBOUND → slot(askable일 때) 또는 SELLER
             ▼
           [3] Resolvers (의존 없는 step은 병렬)
             ├ KNOWLEDGE ─ scoped retrieval(F5 lanes, precedent 제외) + catalogue 구조
             │             └ Knowledge Extractor (LLM, case당 1회 · KNOWLEDGE step에 후보가 있을 때만)
             │                  → cell별 {verbatim span, source, appliesTo}
             │             └ Code check: span ⊂ source · scope admissible · 필수 cell 전부 · 규격 적용
             ├ ENTITY_STATE ─ OrderFactLookup / listing 상태 (결정론, LLM 0)
             ├ PROCEDURE ─ 전제 entity 읽기 + 정책 KNOWLEDGE step → v3.0: 항상 SELLER packet
             └ SELLER ─ handoff packet + Teach 후보 (+ precedent 제안, reuse_scope gate)
             ▼
           [4] Resolution Aggregator (Code) — need 상태 = step 결과의 결정론 함수
             │   RESOLVED / RESOLVED_CONDITIONAL(slot) / NEEDS_CUSTOMER_INPUT / NEEDS_SELLER / CAPABILITY_GAP / FAILED
             │   case: 필수 need가 하나라도 미해결이면 완결 금지 (현재 basis 규칙의 일반화)
             ▼
           [5] Draft (해결된 need의 span만 · 되물을 slot 목록) → InquiryClaimGuard → 저장
           [6] 승인 경계 · InquiryApproval · 채널 어댑터 · read-back 검증 — 전부 무변경
```

**설계 원칙 다섯.**
1. **authority는 증거 전에 정한다.** 증거가 authority를 고르지 않는다.
2. **불가능한 authority는 대체되지 않고 GAP이 된다.** planner는 registry의 전체 id를 보되 status도 본다. 「주문 상태가 필요한데 connector가 없다」가
   「정책 문서로 답한다」로 미끄러지는 것이 F1이다. 필요와 가용성을 분리해 기록하면 **어떤 capability가 없어서 판매자에게 갔는가**가 지표가 된다.
3. **LLM은 의미를 읽고, Code는 완료를 센다.** planner는 요구를 적고, extractor는 원문을 인용한다. 「충분한가」는 코드가 칸과 인용으로 결정한다.
4. **precedent는 판정에 들어가지 않는다.** 판매자 packet과 초안 문체에만 쓴다.
5. **바뀌지 않는 것**: 승인 경계, 실행 어댑터, idempotency, read-back 검증, Claim Guard, 규격 경고 줄, payload floor(식별자 0).

---

## 4. Capability vocabulary와 registry contract

### 4-A. Authority — 이 need를 닫을 **권한**이 누구에게 있는가

| authority | 뜻 | 닫을 수 있는 것 | 절대 하지 않는 것 |
|---|---|---|---|
| `KNOWLEDGE` | 판매자가 **게시했거나 가르친** 일반 사실 | 상품 지식 · 문서 · 운영 정책 · 카탈로그 구조(옵션명·추가상품·상세 텍스트 사실) | 한 인스턴스의 **현재** 상태(이 주문, 지금 품절) |
| `ENTITY_STATE` | **한 인스턴스의 지금** 상태 | ORDER(결제·취소·이행·송장) · LISTING(판매 상태·옵션별 판매 상태) | 일반 규칙을 대신 말하기 |
| `PROCEDURE` | 무언가가 **행해져야** 하는 요청 | 전제 상태 + 정책 + 행동 + 승인으로 된 bounded workflow | v3.0에서 실행(실행 가능한 절차 0 — §6-C) |
| `SELLER` | 기존 권한이 없고 판매자의 **새 판단**이 필요 | handoff packet, 판매자 답 이후의 Teach | 판단을 추측하기 |

**넷으로 충분한 이유(최소성 검증, §8).** 72 need는 전부 이 넷과 slot으로 표현된다. 다섯째 후보를 검토한 결과는 다음과 같다:
- `CATALOGUE`: KNOWLEDGE의 source로 충분하다. 유일한 예외인 「지금 품절인가」는 ENTITY_STATE(LISTING)다.
- `POLICY`: KNOWLEDGE의 source(ORG)다. 권한이 다르지 않고 **scope**가 다르다.
- `ADVICE`(「어느 쪽이 나아요」): 판매자 지식이 비교를 적어 두면 KNOWLEDGE, 아니면 SELLER다.

셋 다 새 authority가 필요한 need가 없었다.

### 4-B. authority가 **아닌** 것 — CUSTOMER_INPUT · CAPABILITY_GAP · SYSTEM_ACQUIRE · precedent

**CUSTOMER_INPUT은 slot이다.** step에 붙는 `{name, why}`다. 고객은 사실을 **제공**할 뿐 need를 **닫지** 않는다. 닫는 것은 slot이 채워진 뒤의
KNOWLEDGE·ENTITY step이다. 「규격을 알려주시면」(`ae51c7f8`)은 KNOWLEDGE step이 `variant` slot과 함께 RESOLVED_CONDITIONAL로 끝난
것이다.
- **askable 여부는 코드가 정한다**(registry의 채널 surface별). 공개 상품 Q&A에서는 주문번호·연락처를 묻는 slot을 askable=false로 두고, 그러면
  SELLER로 간다. 주문 바인딩 부재(`4181864b`)가 여기에 해당한다.
- 이것은 「고객에게 주문번호·사진을 요구하지 않는다」는 InquiryClaimGuard `CUSTOMER_ACTION` 규칙과 같은 방향이다. 여기서는 **계획 단계**에서
  막는다.

**CAPABILITY_GAP은 resolution state다.** 필요한 authority나 필드가 이 org·채널에서 불가능할 때의 결과다. reason은 닫힌 넷이다:
- `ACQUIRABLE`(시스템이 얻을 수 있으나 아직 안 얻음 = 옛 **SYSTEM_ACQUIRE**)
- `DISABLED`(기능이 꺼짐)
- `NOT_SUPPORTED`(채널이 그 필드를 주지 않음. 예: NAVER 저장 주문의 이행 상태)
- `UNAVAILABLE`(이번 호출이 실패)

SYSTEM_ACQUIRE는 planner가 고르는 capability가 아니다. **resolver가 내는 state + 코드가 제안하는 system action**(상세 읽기, 이미지 lane)이다.

**Precedent(과거 답변)는 memory다.**
- `REUSABLE / ORDER_ONLY / CASE_ONLY / UNKNOWN` 입장 규칙(`PrecedentReuse`)은 그대로 둔다.
- 입장한 precedent는 (a) 판매자 packet의 「예전에 이렇게 답했습니다」와 (b) 판매자가 여는 답변 칸의 prefill(REUSABLE만)에 쓴다.
- **어떤 need도 precedent로 RESOLVED가 되지 않는다.**

### 4-C. Registry contract (Code 소유)

```
CapabilityRegistry.snapshot(orgId, inquiry) → Snapshot
Snapshot {
  version: "capability-registry/v1"
  entries: [
    { id: "KNOWLEDGE.PRODUCT"       status: AVAILABLE|DISABLED            sources: [SELLER_ENTERED, UPLOADED, CHANNEL_AUTHORED]
                                    boundListing: productId|null          variantAxis: {count, names[]}|null }
    { id: "KNOWLEDGE.ORG"           status                                 topics: [OrgKnowledgeType…] (있음/없음만) }
    { id: "KNOWLEDGE.CATALOGUE"     status                                 detail: READABLE|NOT_ACQUIRED|IMAGE_ONLY|NOT_COLLECTED }
    { id: "ENTITY.ORDER"            status: AVAILABLE|NOT_SUPPORTED|UNBOUND
                                    binding: SOURCE_EXACT|NONE             fields: {PAYMENT, CANCELLATION, FULFILLMENT, TRACKING} → OBSERVED|NOT_SUPPORTED
                                    lookup: EXACT_ALLOWED|STORED_ONLY     freshness }
    { id: "ENTITY.LISTING"          status                                 fields: {SALE_STATUS, OPTION_SALE_STATUS} asOf }
    { id: "PROCEDURE.*"             status: DECLARED_NOT_EXECUTABLE       (v3.0: 선언만, §6-C) }
    { id: "SELLER"                  status: AVAILABLE }
  ]
  slots: [ { name: "variant"|"measurement"|"order_ref"|…, askable: bool, reason } ]   ← 채널 surface별
}
```

- **모델이 이름을 만들 수 없다.**
  - planner의 `authority` 필드는 이 snapshot의 id를 **enum**으로 받는 strict `json_schema`다(v2.1이 need id에 쓴 것과 같은 기계).
  - `fields`·`slot name`도 snapshot에서 온 enum이다.
  - 모르는 값이 오면 PLAN_FAILED다.
- **status는 숨기지 않는다.** planner는 DISABLED/NOT_SUPPORTED인 id도 고를 수 있다. 그래야 plan이 **진짜 요구**를 적는다. 가용성은 [2]가
  처리한다.
- **fields는 관측된 사실만** 담는다. 예: NAVER 저장 주문은 `NormalizedOrderStatus`가 PAID/UNKNOWN뿐이므로 `FULFILLMENT: NOT_SUPPORTED`
  이고, Cafe24는 exact READ(`GET /api/v2/admin/orders/{id}`)가 있으므로 `OBSERVED`다.
- **snapshot 자체가 관측값**이다. calibration fingerprint(input_fp)에 들어간다. 같은 문의라도 registry가 바뀌면 다른 입력이다.
- 새 connector·새 절차 = **snapshot에 entry 추가**다. planner 프롬프트의 route 문장을 늘리는 일이 아니다. tool registry 변화는 enum으로 흡수된다.

---

## 5. Resolution Planner contract

### 5-A. 한 번이냐 두 번이냐

| 기준 | 두 호출(NeedPlanner → Capability Router) | **한 호출(Resolution Planner)** |
|---|---|---|
| 지연 | +1 순차 왕복(≈1.7s p50) | v2 plan과 같은 1회. 출력 ≈+40–80 토큰(≈+0.2–0.4s, 추정) |
| 토큰 | 문의 문장을 두 번 보낸다 | 한 번 |
| 오류 전파 | router는 planner가 **잘라 놓은** need만 본다. 원문의 「주문」 맥락이 잘리면 복구할 수 없다 | 분해와 권한을 같은 문맥에서 정한다. 대신 한 호출이 두 오류를 함께 낼 수 있다 |
| 관측 | 단계별로 분리 | 출력 필드가 분리돼 있어 채점은 분리된다(§9-A: need 분해 · authority · slot을 따로 채점) |
| 확장성 | router만 바꾸면 된다 | registry enum이 바뀌면 같은 스키마로 흡수된다 |
| testability | 두 단계를 각각 replay | 한 단계 replay, 필드별 채점 |

**권고: 한 호출.** 근거는 셋이다:
- F1의 뿌리가 「need를 자른 뒤 권한을 따로 정하는 것」이었다.
- v2의 plan 호출이 이미 need마다 `type`을 고르고 있어 증분이 작다.
- 두 번째 호출은 지연을 v2보다 **늘린다**.

재평가 조건: Eval v2 A층(§9-A)에서 authority 오류가 need 분해 오류와 **독립적으로** 많이 관측되면, 그때 router를 떼어 작은 모델로 내리는 것을
검토한다(§12).

### 5-B. 출력 스키마(strict)

```jsonc
{
  "needs": [                                   // minItems 1, maxItems 6 (MAX_NEEDS 유지)
    {
      "id": "N1",                              // enum N1..N6, 순서대로
      "ask": "…",                              // ≤120자 — 무엇을 알아야 닫히는가(검색 재진술 겸용 → F5 intent 대체 후보)
      "needType": "PRODUCT_COMPATIBILITY",     // v2 8값 — 진단 annotation 전용, 실행은 이것을 읽지 않는다
      "steps": [                               // minItems 1, maxItems 3
        {
          "authority": "KNOWLEDGE.PRODUCT",    // enum = snapshot ids
          "entity": "LISTING" | "ORDER" | "ORG" | "NONE",
          "fields": ["FULFILLMENT"],           // ENTITY_STATE일 때만, enum = snapshot fields
          "cells": {                           // KNOWLEDGE일 때만
            "attributes": ["…"],               // ≤4, 짧은 명사 — 채워야 할 칸
            "variantScope": "ALL" | "CUSTOMER_NAMED" | "UNSPECIFIED"
          },
          "dependsOn": 0 | null                // 앞 step의 index
        }
      ],
      "slots": ["variant"]                     // enum = snapshot slot names
    }
  ]
}
```

- `rationale`·`why` 같은 **소비자 없는 칸은 요구하지 않는다**(Agent Responsiveness v1 규칙).
- `needType`은 Eval v1 gold와의 비교를 위해 남긴다. 실행은 읽지 않으며, 구조 테스트가 그것을 고정한다.
- 결정론 lane은 **문장을 읽지 않는다**(operator graph v2 계약). 코드가 쓰는 입력은 문의의 **구조적 사실**뿐이다: 채널, 주문 바인딩 유무, 상품
  바인딩, registry.

### 5-C. Plan Validator — 코드가 거절하는 것

- 스키마·enum 위반, 중복 id, step 0개 → **PLAN_FAILED** → NO_ANSWER_BASIS(현재와 같다).
- `ENTITY_STATE` step인데 `entity`가 ORDER/LISTING이 아닌 경우 → PLAN_INCONSISTENT(같은 fail-closed).
- `PROCEDURE` step인데 앞선 `ENTITY.ORDER` 전제가 없는 경우 → 코드가 전제 step을 **보탠다**. 전제는 계약이지 모델의 선택이 아니다.
- `KNOWLEDGE` step인데 `cells`가 없는 경우 → 거절.
- **authority 치환 금지**: 코드는 step의 authority를 바꾸지 않는다. 불가능하면 GAP이다.

---

## 6. Resolver별 책임과 완료 조건

### 6-A. KNOWLEDGE — 검색 + Extract-and-Check

**입력.**
- need의 `ask`와 `cells`
- scoped retrieval — 기존 F5 세 lane 중 **product · org 두 lane**. answer-memory lane은 precedent로만 따로 간다.
- 카탈로그 구조: 옵션명, 추가상품, 상세 텍스트 사실, 그리고 **registry의 `variantAxis`**(규격 수와 이름)

**Knowledge Extractor(LLM, case당 1회).** KNOWLEDGE step이 있고 후보 passage가 ≥1일 때만 부른다. 칸마다 다음을 낸다:

```jsonc
{ "need": "N1", "cell": "…", "found": true,
  "span": "원문 그대로의 인용", "source": "K3",          // K-ids = 이번 호출에 보낸 passage만(enum)
  "appliesTo": "ALL_VARIANTS" | "NAMED" | "UNKNOWN", "variants": ["2호"] }
```

**Code check(결정론).**
1. `span`이 `source` 원문의 부분 문자열인가. 공백 정규화만 허용하고, 아니면 그 칸은 미충족이다.
2. `source`의 `EvidenceScope`가 admissible한가. 다른 listing은 거절한다. v2.1/v2.2 규칙을 그대로 옮긴다.
3. 필수 cell이 **전부** 충족됐는가. 하나라도 비면 `INSUFFICIENT(missing=[cell…])`다.
4. 규격: `variantScope=UNSPECIFIED` ∧ `variantAxis.count > 1` ∧ 어느 칸이 `appliesTo ≠ ALL_VARIANTS`이면 → `RESOLVED_CONDITIONAL(slot=variant)`.
   `UNKNOWN`은 **안전 쪽(조건부)**으로 센다.
5. `variantScope=ALL`(「호수별로 전부」)이면 → 규격마다 칸이 채워져야 한다(`variants`로 센다).

**완료 조건.** 필수 칸 전부가 검증된 인용을 갖고, 고객의 규격(또는 전 규격)에 적용된다.

**하지 않는 것.**
- 주문·재고 상태를 추론하지 않는다(그 step은 없다).
- precedent를 보지 않는다.
- 「FULL인가」를 묻지 않는다.

기존 `SpecApplicability` 규격 경고 줄은 v3 cutover 전까지 병행한다. 그 줄이 지금 `ae51c7f8` 모양을 고객 문장에서 되묻게 만드는 마지막 방어선이다.

### 6-B. ENTITY_STATE — 결정론 connector

**ORDER.**
- 기존 `InquiryOrderFactReader`의 우선순위를 그대로 쓴다: 저장+FRESH → exact READ(EXACT_ALLOWED ∧ 계약 있는 채널) → stale(날짜 인용) → 불가.
- 결과는 요청된 `fields`별로 나온다:
  - `OBSERVED(value, asOf)`
  - `NOT_SUPPORTED` → CAPABILITY_GAP.NOT_SUPPORTED. 예: `7a8136b2` — NAVER 주문은 PAID만 저장된다.
  - `UNBOUND` → askable slot이면 NEEDS_CUSTOMER_INPUT, 아니면 SELLER. 예: `4181864b`, T13a.
  - `UNAVAILABLE` → GAP.
- **ORG 정책은 이 step을 절대 닫지 않는다.** 정책은 같은 need의 별도 KNOWLEDGE step으로 **맥락**에만 들어간다. v2.2
  `fullRequiresAttributedEvidence`가 판정 뒤에 하던 일을 **계획 구조**가 한다.

**LISTING.** 판매 상태와 옵션별 판매 상태(`product_variants`), 그리고 `asOf`. 「화이트 1호가 완전 품절인가」(`ae41a418` n1)가 여기서 닫힌다.

**LLM 0. 완료 조건.** 요청된 필드 전부가 바운드된 인스턴스에서 관측됐고, freshness가 계약 안에 있다.

### 6-C. PROCEDURE — 무엇이 필요하고 무엇이 로드맵인가

dev set의 절차 need는 7개다: 재구매 대응 · 누락 품목 · 분실 · 파손 부품/환불 · 묶음 오해 · 파손 재발송 · 주소 변경. **전부** 마켓플레이스 쪽
주문 WRITE(교환·반품·환불·주소 변경)를 요구하고, Reviewnary에는 그 어댑터도 승인 계약도 없다. 문의 **답변** 게시(Cafe24 POST / NAVER PUT)는
절차 resolver가 아니다. 판매자 승인 뒤의 **채널 실행**이다.

- **v3.0.** `PROCEDURE.*`는 registry에 `DECLARED_NOT_EXECUTABLE`로만 존재한다. resolver는 두 가지를 한다:
  - (1) 전제 `ENTITY.ORDER`와 관련 정책 KNOWLEDGE step을 실행한다.
  - (2) 항상 `NEEDS_SELLER`로 끝나며 packet을 만든다: 고객이 원하는 것 · 주문 상태 · 정책 인용 · 모르는 것.

  초안은 행동을 **약속하지 않는다**(InquiryClaimGuard `SELLER_PROMISE`·`REMEDY`가 이미 막는다).
- **「송장번호 알려주세요」(`f81ad84a`)는 절차가 아니라 ENTITY_STATE(TRACKING) 읽기**다. 이 분리가 NeedType `ORDER_ACTION`이 섞던 것을
  푼다.
- **로드맵(구현하지 않음).** 절차가 실행 가능해지려면 넷이 필요하다:
  - (a) 채널별 공식 WRITE 계약
  - (b) 대상에 묶인 승인(`InquiryApproval`과 같은 모양 — 대상 필드 + fingerprint + single-use)
  - (c) idempotency key와 `DELIVERY_UNKNOWN → 검증, 재전송 없음` 규칙
  - (d) read-back 검증

  이것은 문의 답변 실행이 이미 가진 네 가지이고, 새 절차는 **그 모양을 복사**한다. 권한·승인·idempotency·외부 WRITE는 **Code가** 소유한다.

### 6-D. SELLER — handoff와 Teach

**packet.**
- 다음을 담는다:
  - need별 상태와 이유(`INSUFFICIENT missing=[안쪽 높이 3–5호]` 같은 **칸 단위** 결손)
  - 관측된 entity 상태
  - 인용된 정책
  - 입장한 precedent(reuse_scope 표시)
  - 고객 slot 중 이미 받은 것
- v2의 「PARTIAL」은 판매자가 무엇을 채워야 하는지 말하지 못했다. 칸 단위 결손은 Teach 입력을 정확하게 만든다.

**Teach.**
- 기존 `CaseKnowledgeService.teach` → `KnowledgeCandidateService`를 쓴다. 판매자 답이 KNOWLEDGE(product/org, 규격 지정 가능)로 승격된다.
- **ORDER_ONLY·CASE_ONLY 답은 지식으로 승격되지 않는다.** 그 안의 **정책 문장**만 판매자가 따로 가르칠 수 있다.
- Teach 뒤 재조사·재초안은 기존 경로다.

**SELLER-only need**(대량 할인·재입고 시점·「어느 쪽이 나은가」): 첫 답이 Teach로 org 정책이 되면 다음부터 KNOWLEDGE.ORG로 닫힌다.
**Repeat Seller Ask after Teach**(§10)가 이 순환을 잰다.

### 6-E. Precedent — resolver가 아니다

입장 규칙과 저장은 무변경이다. v3에서 바뀌는 것은 **판정 payload에서 빠진다**는 것 하나다(F5 해소). 초안이 과거 답변의 **문체**를 참고하는 것은
Organization Answer Style의 exemplar 결정(현재 DEFER)과 같은 질문이라 여기서 열지 않는다.

---

## 7. Universal CoverageJudge의 처리

| 부분 | 처리 |
|---|---|
| 한 enum 판정(FULL/COND/PARTIAL/NONE)이 need 상태를 정하는 것 | **제거**. 상태는 step 결과의 코드 함수 |
| 판정 payload의 ORDER_FACT · 정책-대-주문 저울질 | **제거**. ENTITY_STATE step이 소유 |
| 판정 payload의 precedent P1..P6 | **제거**. packet으로 |
| `NeedAggregation.enforce`의 scope 규칙(OTHER_INSTANCE_ONLY · SCOPE_UNATTRIBUTED) | **MOVE**. KNOWLEDGE code check(다른 listing 거절)와 계획 구조(주문 need = ENTITY step)로. `EvidenceScope`는 그대로 쓴다 |
| 「FULL + assumptions → PARTIAL」 같은 판정 후 보정 규칙 | **제거**. 칸과 인용이 대신한다 |
| strict schema · enum-bound id · 엄격 parse · Envelope 실패 종류 · 번호 재매김 · 5분 memo | **KEEP**. Extractor가 그대로 쓴다 |
| 좁은 **Knowledge Sufficiency** 판단 | **NARROW**. 판정이 아니라 추출: 칸별 인용 + `appliesTo`. 「충분한가」는 코드가 센다 |

**남은 오류 셋이 v3에서 어떻게 되는가 (예측, 미측정).**

| 모양 | case | capability 분리만으로 | Extract-and-Check에서 | 남는 위험 |
|---|---|---|---|---|
| 권한 혼동 | `4181864b` · T13a(A) | **없어진다.** 주문 need에는 ENTITY step만 닫는 권한이 있다. 정책은 맥락이고 CONDITIONAL도 같이 막힌다(v2.2의 열린 질문 해소) | — | planner가 주문 need를 KNOWLEDGE로 잘못 계획하는 것. A층 지표 「missing required authority」로 잰다 |
| 규격 의존 상품 단위 수치 | `ae51c7f8` · V3 | 남는다(같은 FAQ가 KNOWLEDGE에 온다) | 규격 수가 **구조화 입력**이 된다(v2.2 §7 선택지 (a)의 일반화). 판단은 「FULL?」이 아니라 「이 인용이 모든 규격에 적용되는가」라는 한 가지 질문이 되고, UNKNOWN은 조건부로 센다 | 모델이 상품 단위 문장을 `ALL_VARIANTS`라고 **자신 있게** 말하는 것. targeted V1(규격별 표 동반) 3/3은 규격 구조가 보이면 맞힌다는 간접 증거일 뿐이다 |
| 부분 표 | T6c · P1/P4 | 남는다 | **구조로 바뀐다.** 「호수별 폭과 높이」 = `attributes:[폭, 높이] × variantScope:ALL`. 높이 3–5호 칸을 채울 인용이 없으면 코드가 INSUFFICIENT라 한다 | 모델이 1·2호 높이를 3–5호 칸에 **복사 인용**하는 것. span의 `variants`와 원문 위치 대조로 일부 잡힌다 |
| 관련 있지만 다른 질문 | `dae8554d` n2 · R1 | 남는다 | 칸이 「T자 분기에서 규격을 맞춰야 하는가」로 **명명**되고 인용을 요구받는다. 「한 가닥이면 3호 권장」을 그 칸의 답으로 인용하는지가 관측 가능해진다 | 여전히 의미 판단이다. 이 모양이 가장 적게 줄 것으로 예상한다. gold(NONE) 자체도 재판정 후보다(v2.2 §4) |

**정직한 결론.** v3가 **확실히** 없애는 것은 권한 혼동 한 종류다. 나머지 셋은 「holistic verdict → 명명된 칸 + 인용 + 코드 집계」로 바꿔 **관측
가능하게** 만드는 것까지다. 줄어드는지는 WP-3의 A/B(§11 Stage 3)가 답한다. 그 실험의 hard-negative는 이미 있다: targeted 12 + 실제 3.

---

## 8. 67-case DEV set의 offline capability mapping

**방법.**
- 입력은 동결 gold `needs.jsonl`(해시 `db92a913…` 확인)의 canonical 72 need다.
- 사람(설계자)이 각 need에 v3 계획과 **S0 데이터에서의** 종착을 붙였다. 모델은 0회 불렀다.
- 계획은 「무엇이 필요한가」이고, 종착은 「S0에서 무엇이 되는가」다. 둘을 분리했다.
  - 「KNOWLEDGE → (부족) → SELLER」에서 SELLER는 계획이 아니라 **fallback**이다. 그래서 계획 열에는 KNOWLEDGE만 적는다.
- **이 라벨은 설계자의 것이고 holdout이 아니다.** Eval v1 gold와 같은 지위(DEV/CALIBRATION)다.

### 8-A. 분포

| 계획 패턴 | need | 비고 |
|---|---|---|
| KNOWLEDGE 하나 | 50 | 종착: 자동 6 · GAP·ACQUIRABLE 14(상세 이미지 12 · 카페24 상세 미수집 2) · 판매자 30 |
| KNOWLEDGE + slot(CUSTOMER) | 5 | `ae51c7f8` · T6b · T9a · T9b · X9a — 전부 규격/굵기 slot, 전부 고객 되묻기 |
| ENTITY_STATE 하나 | 5 | ORDER 4(`7a8136b2` · `f81ad84a` → NOT_SUPPORTED · `4181864b` · T13a → UNBOUND) · LISTING 1(`ae41a418` n1 → 자동) |
| ENTITY(LISTING) → SELLER | 2 | T7a · T7b(재입고 — 지금 판매 중지라는 사실 + 판매자 판단) |
| PROCEDURE → ENTITY(ORDER) [→ KNOWLEDGE] → SELLER | 7 | 전부 판매자(실행 가능한 절차 0) |
| SELLER 하나 | 3 | `f403e606` n2 · `ae41a418` n2 · N6 |
| **합계** | **72** | 여러 authority 계획 9 · slot 5 · 단일 58 |

| 종착(S0) | need | case(67) |
|---|---|---|
| 자동 답변(RESOLVED) | 7 | 4 case 전부 자동 |
| 고객에게 되묻기 | 5 | 5 |
| 판매자(지식 부족 · 판단 · 절차) | 42 | 58 case가 판매자에 닿는다 |
| CAPABILITY_GAP(ACQUIRABLE 14 · NOT_SUPPORTED 2 · UNBOUND 2) | 18 | (판매자 수에 포함) |

- 지식 판정 호출이 필요한 case(KNOWLEDGE step에 gold 후보가 있음)는 **40/67**이다.
- KNOWLEDGE step이 아예 없는 case는 **10/67**이다.

### 8-B. vocabulary 검증 — 무엇을 확인했나

1. **네 authority로 72개 전부 표현된다.** 표현되지 않아 새 값이 필요했던 need는 0이다.
2. **authority 하나로 끝나지 않는 need가 19.4%**(14)다. 단일 classifier는 그만큼을 틀리거나 잃는다 ⇒ bounded plan.
3. **v2 NeedType은 권한과 1:1이 아니다**(F4):
   - `CATALOGUE_AVAILABILITY` 14 = KNOWLEDGE 13 + ENTITY(LISTING) 1
   - `SELLER_DECISION` 9 = SELLER 3 + LISTING→SELLER 2 + PROCEDURE 4
   - `ORDER_ACTION` 4 = ENTITY 1 + PROCEDURE 3

   NeedType은 진단 annotation으로 남기고 실행 축에서 뺀다.
4. **CAPABILITY_GAP은 첫 번째 종착 원인**이다. dev set에서 판매자로 가는 need의 18/60이 「지식이 없어서」가 아니라 「**시스템이 아직 얻지 않았거나
   채널이 주지 않아서**」다. 이것은 Teach로 닫을 수 없고 acquisition 로드맵(이미지 lane · 카페24 상세 · 주문 이행 상태)으로 닫는다. v2의
   PARTIAL/NONE은 두 원인을 구분하지 않았다.
5. **dev set의 결손.** PROCEDURE 7개가 전부 「실행 불가」라 절차 resolver의 성공 경로는 이 데이터로 잴 수 없다. ENTITY(ORDER)가 RESOLVED되는
   need도 **0**이다. Eval v2 시뮬레이션(§9-C)은 이 둘을 **합성 world state**로 채워야 한다.

### 8-C. 어려웠던 실제 case의 v3 path

| case | v2에서 무슨 일이 | v3 계획 | v3 종착 | 달라지는 이유 |
|---|---|---|---|---|
| `7a8136b2` (주문 발송 시점) | gold PARTIAL. 정책(OK) + 주문 PAID. judge가 둘을 저울질 | `ENTITY.ORDER{FULFILLMENT}` (+ 맥락: `KNOWLEDGE.ORG` 발송 기준) | `CAPABILITY_GAP.NOT_SUPPORTED`(NAVER 저장 주문은 이행 상태 없음) → 판매자 packet: 「결제 완료 · 발송 상태는 채널이 알려주지 않음 · 회사 기준 출고 2일」 | 정책은 이 need를 **닫을 권한이 없다.** 구조가 그렇게 말하고 판정에 맡기지 않는다 |
| `4181864b` | B: 정책으로 FULL(unsafe) → v2.2 코드로 PARTIAL | `ENTITY.ORDER{FULFILLMENT}` | `ENTITY_UNBOUND`. 공개 Q&A라 `order_ref` slot askable=false → 판매자 | 판정 뒤 보정이 아니라 **계획 단계**에서. A의 CONDITIONAL 모양(T13a)도 같이 닫힌다 |
| `ae51c7f8` (몇 가닥) | 3/3 FULL(일관 오답) — 상품 단위 FAQ, listing 5규격 | `KNOWLEDGE.PRODUCT cells:[수용 가닥 수] variantScope:UNSPECIFIED` + slot `variant` | variantAxis.count=5 ∧ appliesTo≠ALL(또는 UNKNOWN) → `RESOLVED_CONDITIONAL(variant)` → 「규격을 알려주시면」 | 규격 수가 입력이 되고, 질문이 「FULL?」에서 「모든 규격에 적용?」으로 좁아진다. **가설.** 모델이 ALL이라고 자신 있게 답하면 여전히 틀린다 |
| `dae8554d` n1 / n2 | n1 FULL(정답) · n2 FULL ×3(gold NONE) | n1: `KNOWLEDGE.PRODUCT cells:[4호 수용 가능 여부(10mm×2)]` · n2: `KNOWLEDGE.PRODUCT + KNOWLEDGE.CATALOGUE(추가상품 T자캡) cells:[분기 시 한 가닥 쪽 규격 일치 필요 여부]` | n1 RESOLVED · n2는 그 칸을 답하는 인용이 없으면 INSUFFICIENT → 판매자(칸 이름이 packet에) | 관련 문장(「한 가닥이면 3호 권장」)을 **그 칸의 답으로** 인용하는지가 관측 가능해진다. 줄어들지는 미측정 |
| `ffc2cc44` (1.5sq 두 가닥) | gold PARTIAL / ASK_SELLER. v2 판정 PARTIAL_LEAK 계열 | `KNOWLEDGE.PRODUCT cells:[1.5sq 두 가닥에 맞는 호수]` | 내경표는 있으나 1.5sq 외경 인용이 없음 → INSUFFICIENT(missing=[1.5sq 전선 외경]) → 판매자. Teach가 그 한 줄을 가르치면 다음부터 닫힌다 | 결손이 **칸 이름**으로 나가 판매자가 채울 것이 분명해진다 |
| S T6c (호수별 폭·높이) | 1/3 흔들림 | `cells:[안쪽 폭, 안쪽 높이] variantScope:ALL` | 폭 5칸 충족 · 높이 2/5 → INSUFFICIENT(missing=[높이 3·4·5호]) | 부분 표가 **코드가 세는 빈칸**이 된다 |

전체 72행은 부록 A에 있다.

---

## 9. Eval v2 설계 — 세 층

**원칙.**
- Eval v1(need gold · 채점기 · replay · fingerprint · integrity)은 **버리지 않는다.** A·B층의 기반이다.
- headline은 C층에서 나온다: 「이 상황을 안전하고 올바르게 해결했는가」.

### 9-A. A층 — Planner / Router

- **gold.** 72 need에 붙인 v3 계획(부록 A)과 합성 targeted 12. product-owner 검토 후 동결하고 해시를 붙인다.
- **채점**(필드별 분리):
  - need 분해: v1의 need 매칭을 그대로 쓴다.
  - **required-authority recall**: 필요한 authority가 plan에 있는가. **주문 need의 ENTITY 누락은 hard fail**이다.
  - unnecessary authority
  - slot 정확도
  - plan consistency(Validator 거절률)
  - run-to-run agreement(v2.1의 안정성 지표)
- **입력 고정.** v2.1 capture(input_fp · system_fp · schema_fp · request_fp)에 **registry snapshot fp**를 더한다.

### 9-B. B층 — Resolver component

- **KNOWLEDGE.**
  - retrieval recall: 기존 gold evidence set 기준(v1 L2).
  - **cell 충족 precision**: 코드가 충족이라 한 칸 중 gold가 답이라고 한 칸의 비율. v2 「FULL precision」의 후계다.
  - variant 적용 정확도
  - span 검증 실패율(모델이 원문에 없는 문장을 인용한 비율)
  - 부분 표 탐지
- **ENTITY_STATE.** 결정론이다. world-state fixture에 대한 단위 테스트로 필드별 OBSERVED / NOT_SUPPORTED / UNBOUND / UNAVAILABLE을 가린다.
- **PROCEDURE.** v3.0은 「실행 안 함 + packet 완결성」만 본다: 전제·정책·결손이 packet에 있는가.
- **SELLER / clarification.** 올바른 slot을 물었는가, 물어서는 안 되는 slot(askable=false)을 묻지 않았는가, packet의 칸 단위 결손이 gold 결손과
  맞는가.
- **재사용.** v2.1 calibration harness(`CalibrationRunner` model/oracle/replay, `CalibrationVariants`의 counterfactual 여섯 종, `judge.mjs`
  integrity)를 그대로 쓴다. 대상만 judge에서 extractor로 바뀐다.

### 9-C. C층 — End-to-End Simulation

시나리오 파일(`contracts/inquiry-sim/v1/*.jsonl`, 합성만 커밋)의 형태:

```jsonc
{
  "id": "SIM-ORDER-SHIP-NAVER-01",
  "channel": "NAVER", "surface": "PRODUCT_QNA",            // askable slot을 정한다
  "world": {                                                // mock — 라이브 호출 0
    "listing": { "variants": ["1호","2호","3호","4호","5호"], "detail": "READABLE" },
    "knowledge": [ { "scope": "PRODUCT", "text": "…", "variantId": null } ],
    "policy": [ { "type": "SHIPPING_POLICY", "text": "…" } ],
    "order": { "binding": "SOURCE_EXACT", "fields": { "PAYMENT": "PAID", "FULFILLMENT": "NOT_SUPPORTED" } },
    "registry": { "ENTITY.ORDER": "AVAILABLE", "KNOWLEDGE.CATALOGUE": "AVAILABLE" }
  },
  "opening": "고객의 첫 문장",
  "expect": {
    "authorities": ["ENTITY.ORDER"],                         // A층 교차 확인
    "outcome": "NEEDS_SELLER",                               // AUTO | ASK_CUSTOMER | NEEDS_SELLER
    "gap": "NOT_SUPPORTED",
    "draftMayState": ["결제 완료"],                          // 선택
    "askSlots": []
  },
  "never": [                                                 // 1급 — 금지 결과
    "주문 상태를 정책으로 단정", "발송 시점 약속", "주문번호 요구", "precedent 문장을 사실로 서술"
  ]
}
```

- **judge**는 두 층이다:
  - (1) `expect`의 구조 필드(outcome · gap · slot · authority)는 **코드가 채점**한다.
  - (2) 초안 문장의 `never`/`draftMayState`는 먼저 코드(ClaimGuard 규칙 재사용 + 문자열/수치 검사)로 보고, 코드로 못 가르는 것만 LLM judge가
    본다. LLM judge의 판정은 **고정 표본에서 사람과 일치율**을 먼저 재고 쓴다.
- **mock만 허용**한다(§1-E). connector는 world fixture에서 읽고 채널 WRITE 경로는 컴파일 단계에서 배제한다. agent-runtime `test/scenario/`의
  「CI는 벤더를 부르지 않는다」 규칙을 그대로 쓴다.
- **회귀 실행.** 같은 시나리오 집합을 설정 변경 전후(프롬프트·모델·registry·threshold)에 각 3회 돌려 **시나리오별 결과 뒤집힘**을 본다. 집계
  점수만 보지 않는다(v2.2 targeted의 교훈: 일관된 오답과 흔들림은 다른 처방이다). CI는 녹화된 모델 출력으로 replay하고(모델 0), 라이브 모델
  재실행은 승인 manifest 1회분이다.
- **초기 코퍼스.**
  - 67 case를 world로 변환한다(실제 문장은 저장소 밖).
  - 합성 30개를 더한다: dev set에 없는 것 — **ENTITY RESOLVED 경로 · Cafe24 exact 주문 · 규격 명시 · 정책 존재 · 절차 packet** — 을 채운다.

### 9-D. 파일럿에서 새 holdout·시나리오를 만드는 운영

1. **주 1회 표본.** 파일럿 org의 새 문의에서 층화 표본(채널 × 종착)을 뽑는다. 판매자가 실제로 보낸 답과 승인·수정 기록(`author_kind`, 초안
   fingerprint)이 함께 붙는다.
2. **라벨.** 운영자(설계자 아님)가 need · 계획 · 올바른 종착을 붙인다. 판매자의 실제 답은 「올바른 결과」의 증거일 뿐 gold 자체가 아니다(외부 판매자
   행동을 gold로 쓰지 않는다는 review triage 규칙과 같다).
3. **동결 → 1회 사용 → 소진.** holdout은 해시를 붙여 저장소 밖에 두고, 선택에 쓰는 순간 selection set으로 강등된다(Knowledge Retrieval v2 holdout
   규칙).
4. **실패 → 시나리오.** 운영 중 wrong automation·잘못된 handoff 사례는 합성 world로 옮겨 C층 회귀 시나리오가 된다(고객 문장 재작성, 실제 문장 0).
5. **gold 내구성.** 저장소 밖 위치는 OS 임시 디렉터리가 아니어야 한다(§0 사고). 위치는 product-owner 결정이다.

---

## 10. Metrics

### 10-A. Component (진단용 — headline 아님)

| 층 | 지표 |
|---|---|
| A | need 매칭 F1 · **required-authority recall**(ORDER 누락 = hard fail) · unnecessary authority · slot 정확도 · plan 거절률 · run-to-run agreement |
| B·KNOWLEDGE | retrieval recall · **cell 충족 precision** · variant 적용 정확도 · span 검증 실패율 · 부분 표 탐지율 |
| B·ENTITY | 필드별 관측 정확도(결정론 — 100%가 아니면 버그) · freshness 위반 |
| B·SELLER | packet 결손 정확도 · 금지 slot 질문 0 |
| 비용 | 호출 수/문의 · p50/p95 · 토큰 — v2.1 fingerprint 행 그대로 |

### 10-B. Product (시뮬레이션 + 파일럿)

- **Wrong Automation Rate** — 자동 답변 중 근거 없는·틀린 주장 또는 권한 밖 주장(주문 상태 단정, 약속). **gate**: 0을 목표로 하고 임계를 넘으면
  배포하지 않는다.
- **Partial Resolution Leakage** — 필수 need 일부만 해결했는데 완결처럼 나간 비율(v2의 PARTIAL_LEAK).
- **Correct Clarification** — 되물어야 할 때 되묻고, 물으면 안 되는 것을 묻지 않은 비율.
- **Correct Handoff** — 판매자로 보내야 할 때 보내고, 불필요한 escalation이 없는 비율. packet 결손 정확도를 포함한다.
- **Safe Resolution Rate** — 문의 단위로 (자동 답변이 옳음) ∨ (되묻기가 옳음) ∨ (handoff가 옳음)이고 금지 결과가 0인 비율.
- **Seller Touch Rate** — 판매자가 문장을 써야 했던 문의의 비율. 승인만 누른 것과 고친 것을 **분리**한다(`author_kind`).
- **Repeat Seller Ask after Teach** — 판매자가 가르친 칸(같은 org · 같은 scope · 같은 cell)을 다시 판매자에게 물은 비율.
- **Capability-gap demand** — GAP reason별 문의 수. 로드맵 입력이고 품질 지표는 아니다.
- **Customer follow-up / reopen** — 같은 스레드의 추가 질문. 게시판 채널에서는 신호가 약하므로 참고 지표로 둔다(§1-E).

### 10-C. Headline 넷 (+ gate 하나)

| # | headline | 이유 |
|---|---|---|
| G | **Wrong Automation Rate** (gate) | 판매자 목소리로 나가는 틀린 답이 가장 비싼 실패다. 평균에 섞지 않고 문턱으로 쓴다 |
| 1 | **Safe Resolution Rate** | 「이 상황을 안전하고 올바르게 해결했는가」 그 자체. 자동·되묻기·handoff를 **같은 분자**에 넣어 자동화율 경쟁을 막는다 |
| 2 | **Seller Touch Rate** (쓴 문장 기준) | 제품이 판매자 시간을 실제로 줄였는가. 승인 클릭은 touch가 아니다 |
| 3 | **Repeat Seller Ask after Teach** | 학습 루프가 도는가 — Reviewnary가 채널톡·Fin과 다른 지점(판매자가 가르친 것이 authority가 된다) |
| 4 | **Correct Handoff** | dev set 58/67이 판매자로 가는 현실에서 handoff 품질이 제품 경험의 대부분이다 |

「Automated Resolution Rate」는 headline으로 두지 **않는다**. 이 데이터에서 자동은 4/67이고, 자동화율을 headline으로 두면 Wrong Automation과
반대 방향 압력이 생긴다. 참고 지표로만 싣는다.

---

## 11. 단계별 migration plan (big-bang 없음, 전부 기본 OFF)

| Stage | 유지 | 추가 | 제거/축소 | Eval gate | Rollback |
|---|---|---|---|---|---|
| **0 · eval 자산** (모델 0) | v2 전체 | 부록 A 계획 gold 동결 · A층 채점기(`judge.mjs` 확장) · 시나리오 스키마 + 합성 30 · world→collector fixture | — | 채점기 손계산 fixture 초록 · integrity mutation 테스트 | 파일만 |
| **1 · Registry + ENTITY resolver** (모델 0) | v2 plan/judge | `CapabilityRegistry`(결정론) · `EntityStateResolver`(기존 `InquiryOrderFactReader`·listing 상태 재사용) | v2의 ORDER 판정 경로: 플래그 ON이면 ORDER need는 judge 대신 ENTITY resolver가 상태를 정한다(v2.2 invariant의 일반화, CONDITIONAL까지) | 72 oracle에서 주문 need unsafe 0 · 나머지 need 무변경(byte diff) · 결정론 fixture 100% | 플래그 OFF → v2.2 그대로 |
| **2 · Resolution Planner shadow** (모델, 승인 필요) | v2 plan이 실행을 결정 | v3 planner 프롬프트/스키마 · Plan Validator. capture 위에서만 실행하고 production 결정에 쓰지 않는다 | — | A층: required-authority recall ≥ 0.95 · ORDER 누락 0 · 안정성 ≥ v2 plan · 지연 p50 ≤ v2 plan +0.5s | 플래그 OFF(shadow라 제품 영향 0) |
| **3 · Knowledge Extractor A/B** (모델, 승인 필요) | judge v2(arm A) | extractor + code check(arm B). **같은 capture · 같은 모델** | — | B층: unsafe(=cell 과충족) ≤ judge v2(=3, v2.2 투영) · targeted positive control 유지 · 12+3 hard-negative 개선 · 비용 ≤ judge | arm 선택 플래그 |
| **4 · cutover** | ClaimGuard · 규격 경고 줄 · 승인·실행 전부 | planner v3 + resolvers + aggregator · 초안 입력을 resolution에서 · SELLER packet | v2 judge 호출 · `NeedAggregation.enforce`의 판정 후 보정 규칙 · 판정 payload의 precedent | C층 시뮬레이션: Wrong Automation 0 · Safe Resolution ≥ v2.2 · 시나리오 뒤집힘 검토 | `inquiry-decision.engine=v2|v3` 플래그. v2 코드는 **1 release 유지** |
| **5 · F5 흡수** (선택, 측정) | F5 embedding | planner `ask`를 검색 재진술로 · extractor가 부적격 passage를 인용하지 않음으로 eligibility 대체 | knowledge.intent · knowledge.eligibility 호출(v3 경로에서만) | Knowledge Retrieval v2 벤치마크 114 · recall ≥ 0.90 · any-wrong 0 · 부재 1.0(기존 회귀 기준) | 두 capability 플래그 복귀 |
| **6 · SELLER packet + Teach 칸 단위** | Teach 경로 | packet UI · 칸 단위 결손 → Teach prefill | v2 PARTIAL 문구 | Repeat Seller Ask 측정 시작 | UI 플래그 |

**Decision v2.x 재사용량.** 다음은 전부 옮긴다:
- 계약·harness 대부분: strict schema, Envelope, enum-bound ids, calibration runner, replay, fingerprint, integrity, counterfactual
  variants, EvidenceScope, PrecedentReuse, reuse_scope migration, gold data, targeted set, Teach 연결

**새로 짜는 것**: 프롬프트 둘(planner v3 · extractor), Registry, Validator, Aggregator.
**지우는 것**: 판정 enum이 need 상태를 정하는 한 경로와 그 보정 규칙들.

---

## 12. Jev / small model 후보 (지금 적용하지 않음)

**순서.** LLM → 운영 라벨(판매자 수정·승인 기록 포함) → **shadow 비교** → 더 싼 판정. Resolution Planner를 처음부터 Jev나 작은 분류기로
고정하지 않는다. 분해와 권한을 함께 보는 첫 단계는 **분포를 모르는** 곳이고, 가장 비싼 오류(주문 need를 지식으로 계획)가 거기서 난다.

| 결정 | taxonomy 안정성 | 판단 길이 | 라벨 축적 경로 | 후보 여부 |
|---|---|---|---|---|
| authority 선택(need `ask` → 4값 + entity) | 높음(4값, 도메인 무관) | 짧음 | A층 gold + 판매자 handoff 결과 | **1순위 후보** — planner에서 떼어 낼 때 |
| `appliesTo`(인용 1개 + 규격 목록 → ALL/NAMED/UNKNOWN) | 높음(3값) | 짧음 | extractor 로그 + 되묻기 결과 | **후보** — 오류 비용 비대칭이라 UNKNOWN 쪽으로 보정 |
| knowledge eligibility(문단이 이 칸에 관련 있는가) | 높음(2값, 이미 거절 전용) | 짧음 | 기존 eligibility 로그 | 후보(Stage 5 이후) |
| slot 필요 여부 | 중간(slot 이름이 registry와 함께 는다) | 짧음 | 되묻기·고객 답 | 나중 |
| need 분해 | 낮음(문장마다 다름) | 긺 | — | **비후보** |
| cell 인용 추출 | 낮음 | 긺 | — | **비후보** |
| 초안 문장 | — | — | — | 비후보 |

**전환 조건(각 후보마다).**
- 라벨 ≥ 수백 건 · shadow 2주 일치율 ≥ LLM의 run-to-run agreement
- 불일치 표본의 사람 판정에서 작은 모델이 안전 쪽으로만 틀림
- 지연·비용 이득이 실측됨

---

## 13. 예상 LLM call · latency · cost

**가정.**
- 측정값: plan 1.8s · judge 2.0s · extractor ≈ judge(2.0–2.4s, 규격 구조 입력 추가) · 초안 ≈5s · intent 1.8s · eligibility 1.1s · 임베딩
  0.2s.
- v3 planner 출력 증분은 **추정** +0.2–0.4s다.
- 전부 순차 p50이다.

| 경로 | v2 (F5 OFF) | v2 (F5 ON) | v3 (Stage 4) | v3 (Stage 5, F5 흡수) |
|---|---|---|---|---|
| 지식 + 초안 | plan 1.8 + judge 2.0 + draft 5 ≈ **8.8s** | intent 1.8 + elig 1.1 + emb + plan + judge + draft ≈ **12s** | plan 2.1 + emb 0.2 + extract 2.2 + draft 5 ≈ **9.5s** | ≈ **9.5s**(F5 ON 대비 −2.5s) |
| 지식 필요, 후보 0 | plan + judge ≈ 3.8s → 판매자 | +2.9s | plan 2.1 + retrieval → **extract 생략** ≈ 2.3s | 같음 |
| 주문·절차·판매자만 | plan + judge ≈ 3.8s | 같음 | plan 2.1 + ENTITY(결정론, ms) ≈ **2.2s** | 같음 |

**dev set에 대입한 호출 수(67 문의, 초안은 자동/되묻기 case만).**
- v2: plan 67 + judge 67 + draft 9 = **143**
- v3: plan 67 + extract 40 + draft 9 = **116**(−19%)

이 비율은 dev set 분포(어렵고 지식이 얇음)의 것이다. 파일럿 분포는 모른다.

**병렬화.** ENTITY 읽기와 retrieval은 plan 뒤에 병렬로 돈다. extractor는 case당 한 번이다(need마다 부르지 않는다 — v2 judge와 같은 묶음). 초안은
extractor 결과가 필요해 순차다.

**결정론 fast path**(문장을 읽지 않는다):
- registry snapshot
- 주문 바인딩 부재
- detail NOT_ACQUIRED
- 후보 0
- NO_ANSWER 시 초안 생략(현재와 같다)

**캐시.**
- v2의 5분 요청 memo를 planner·extractor에 그대로 쓴다. 조사와 초안이 같은 판정을 공유한다.
- 판매자 문단 벡터 캐시는 content-addressed 그대로다.
- **plan 캐시는 문장 키로 만들지 않는다.** registry가 다르면 다른 뜻이다.

**비용.**
- extractor 입력은 judge보다 작을 것으로 예상한다(precedent·주문 사실·다른 need의 후보 제외 · 규격 구조 추가).
- 출력은 인용 때문에 **클 수 있다**(칸당 span). 출력 토큰이 지연을 지배한다는 측정(Agent Responsiveness v1 §1-B)이 있으므로 span 길이 상한(예:
  120자)이 필요하다.
- 순 비용은 **미측정**이고 Stage 3 A/B가 잰다.

---

## 14. Decision v2.x에서 재사용할 자산

| 자산 | v3에서의 자리 |
|---|---|
| strict `json_schema` · enum-bound id · minItems=maxItems · `parseJudge` 엄격성 · Envelope(REFUSAL/TRUNCATED/HTTP/TRANSPORT/EMPTY/UNPARSEABLE) | planner·extractor 둘 다 |
| `InquiryDecisionService` org gate · 5분 memo · payload floor(식별자 0) | 그대로 |
| `EvidenceScope` · `CaseScope` · `EvidenceCandidate` scope 유도 | KNOWLEDGE code check(다른 listing 거절) · ENTITY 바인딩 |
| `PrecedentReuse` · `AnswerMemoryReuseScope` · V114 | precedent 입장 규칙 그대로 |
| `InquiryEvidenceCollector`의 lane·카탈로그·옵션·추가상품 수집 | KNOWLEDGE resolver의 수집기(ORDER_FACT·precedent 분리) |
| `DetailCapability` | registry `KNOWLEDGE.CATALOGUE.detail` → GAP reason |
| `InquiryOrderFactReader` · `OrderFactLookup` · `ExactOrderLookupCapability` | ENTITY.ORDER resolver 본체 |
| `NeedAggregation.basis`(미해결이 하나라도 있으면 완결 금지) | Aggregator의 case 규칙(일반화) |
| `CalibrationRunner`(model/oracle/replay) · fingerprint · `CalibrationVariants` 여섯 종 · `judge.mjs` integrity/parity/caseOutcomes | A·B층 harness |
| Eval v1 gold 72 need · targeted 12 · 실제 3 hard case | A·B층 gold, C층 world의 씨앗 |
| `InquiryClaimGuard` · 규격 경고 줄 · 승인·실행·검증 | 무변경 |
| Teach(`CaseKnowledgeService` → `KnowledgeCandidateService`) | SELLER resolver 이후 |

## 15. 폐기할 complexity

- 한 enum 판정이 need 상태를 정하고, 그 판정을 코드가 **뒤에서** 고치는 구조: `FULL+assumption→PARTIAL`, `SCOPE_UNATTRIBUTED`,
  `customerInput→CONDITIONAL` 보정. 판정 뒤 보정은 판정이 너무 많은 것을 말한다는 증거다.
- 판정 payload의 이질 풀(E1..E30에 지식·정책·옵션·주문 사실 혼재)과 P1..P6.
- NeedType을 실행 축으로 쓰는 것(`instanceScope()` · `fullRequiresAttributedEvidence()` · `aboutTheListing()`의 실행 분기). 진단 annotation으로만
  남긴다.
- 조사 경로의 legacy whole-question lane과 v2 need별 lane의 **이중 검색**. 초안 인용 기록이 legacy passage만 적는 불일치(v2 §9)도 함께 사라진다.
- (Stage 5) knowledge.intent · knowledge.eligibility의 v3 경로 호출.

---

## 16. 열린 결정 (product-owner)

- **A. 네 authority + slot + GAP의 vocabulary 채택 여부.** 특히 PROCEDURE를 v3.0에서 「선언만」으로 둘지, SELLER에 합칠지. 이 문서는 선언을
  권한다 — 절차 need의 packet은 ENTITY + 정책 전제를 갖고, 로드맵의 자리를 미리 잡는다.
- **B. 부록 A의 72행 계획 라벨 검토와 동결.** 설계자 라벨이다. 특히 이 셋이 경계다:
  - `f81ad84a`(송장 = ENTITY 읽기인가)
  - `8989a9d0`/T1(색 섞기 = KNOWLEDGE 부족인가, SELLER 판단인가)
  - `f403e606` n2(비교 조언)
- **C. 공개 Q&A surface의 askable slot 정책.** 주문번호·연락처는 askable=false를 제안한다.
- **D. 저장소 밖 gold의 내구성 있는 위치.** `questions.jsonl`·`precedents.jsonl` 재구성 여부도 포함한다. questions는 실제 문의 id 목록(원천 DB에
  있다)과 합성 문장(v1 대화 기록에 있다)으로 재구성할 수 있다.
- **E. headline 넷의 채택과 Wrong Automation gate의 임계.**

---

## 17. 구현한다면 첫 번째 Work Package

**Inquiry v3 WP-1 — Capability Registry + Entity-State Resolver + Resolution-Plan gold (모델 0 · 기본 OFF)**

- **범위.**
  1. 부록 A를 A층 gold로 동결한다(PO 검토 반영, 해시). 채점기에 required-authority recall · ORDER 누락 hard fail · slot 정확도를 넣는다.
  2. `CapabilityRegistry.snapshot`(결정론)을 만든다. 기존 사실에서만 파생한다: `DetailCapability`, `ExactOrderLookupCapability`,
     `NormalizedOrderStatus` 관측 범위, `product_variants`, org 지식 유형 유무, 채널 surface. calibration fingerprint에 snapshot fp를
     더한다.
  3. `EntityStateResolver`: 기존 `InquiryOrderFactReader` + listing 판매 상태를 필드별 OBSERVED/NOT_SUPPORTED/UNBOUND/UNAVAILABLE로
     감싼다.
  4. 플래그(`sellerops.inquiry-decision.entity-authority`, 기본 OFF): v2 경로에서 ORDER need의 상태를 judge 대신 ENTITY resolver가 정한다.
     정책은 맥락이고, CONDITIONAL도 닫힌다.
  5. 시나리오 스키마 + 합성 world 10(ENTITY RESOLVED 경로를 포함 — dev set의 결손).
- **Gate.**
  - 72 oracle에서 주문 need의 unsafe 0.
  - 주문 need 외 결과는 byte 동일.
  - 결정론 fixture 100%.
  - backend 전체 초록.
  - mutation 테스트: 정책 인용으로 주문 need를 닫으려는 변형이 잡힌다.
- **왜 이것이 첫째인가.**
  - 모델 호출 없이 v3의 **확실한** 이득(권한 혼동 제거)을 production 경로에 옮긴다.
  - 이후 모든 단계가 필요로 하는 registry와 gold를 먼저 세운다.
  - 실패해도 플래그 하나로 v2.2에 돌아간다.
- **하지 않는 것.** planner·extractor 프롬프트 · 실제 모델 호출 · 마이그레이션 · 마켓플레이스 호출.

---

## 부록 A. 72 need의 v3 계획 (설계자 라벨 · DEV/CALIBRATION · 고객 문장 0)

계획 열은 **필요한 authority**다(fallback인 SELLER는 적지 않는다). 종착 열은 S0 스냅샷에서 예상되는 결과다.

| case | need | v2 NeedType (gold) | gold 충분성 | v3 계획 (authority 순서) | S0 데이터에서의 종착 |
|---|---|---|---|---|---|
| R `c491451a` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `0c582144` | n1 | SELLER_DECISION | NONE | PROCEDURE → ENTITY(ORDER) → KNOWLEDGE → SELLER | 판매자 |
| R `ffc2cc44` | n1 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `dae8554d` | n1 | PRODUCT_COMPATIBILITY | FULL | KNOWLEDGE | 자동 답변 |
| R `dae8554d` | n2 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `f2ff4a0b` | n1 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `77a91fab` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `77a91fab` | n2 | PRODUCT_COMPATIBILITY | FULL | KNOWLEDGE | 자동 답변 |
| R `77a91fab` | n3 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `e66f3a57` | n1 | PRODUCT_COMPATIBILITY | FULL | KNOWLEDGE | 자동 답변 |
| R `b30d57be` | n1 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `9a91964c` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `7a8136b2` | n1 | ORDER_STATE | PARTIAL | ENTITY(ORDER) | GAP·FIELD_NOT_OBSERVED → 판매자 |
| R `83e607e0` | n1 | ORDER_ACTION | NONE | PROCEDURE → ENTITY(ORDER) → SELLER | 판매자 |
| R `d28c23f9` | n1 | CATALOGUE_AVAILABILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `f81ad84a` | n1 | ORDER_ACTION | NONE | ENTITY(ORDER) | GAP·FIELD_NOT_OBSERVED → 판매자 |
| R `e9030ab6` | n1 | PRODUCT_USAGE | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `9b8cc5a5` | n1 | SELLER_DECISION | NONE | PROCEDURE → ENTITY(ORDER) → KNOWLEDGE → SELLER | 판매자 |
| R `320d1157` | n1 | CATALOGUE_AVAILABILITY | NONE | KNOWLEDGE | 판매자 |
| R `2673edfb` | n1 | CATALOGUE_AVAILABILITY | NONE | KNOWLEDGE | 판매자 |
| R `8989a9d0` | n1 | CATALOGUE_AVAILABILITY | PARTIAL | KNOWLEDGE | 판매자 |
| R `e9555ebc` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `f403e606` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `f403e606` | n2 | SELLER_DECISION | NONE | SELLER | 판매자 |
| R `c626515c` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| R `ae51c7f8` | n1 | PRODUCT_COMPATIBILITY | CONDITIONAL | KNOWLEDGE +slot(CUSTOMER) | 고객에게 되묻기 |
| R `515dd536` | n1 | SELLER_DECISION | NONE | PROCEDURE → ENTITY(ORDER) → KNOWLEDGE → SELLER | 판매자 |
| R `4181864b` | n1 | ORDER_STATE | PARTIAL | ENTITY(ORDER) | ENTITY_UNBOUND → 판매자 |
| R `ae41a418` | n1 | CATALOGUE_AVAILABILITY | FULL | ENTITY(LISTING) | 자동 답변 |
| R `ae41a418` | n2 | SELLER_DECISION | NONE | SELLER | 판매자 |
| S `T1a` | n1 | CATALOGUE_AVAILABILITY | PARTIAL | KNOWLEDGE | 판매자 |
| S `T1b` | n1 | CATALOGUE_AVAILABILITY | PARTIAL | KNOWLEDGE | 판매자 |
| S `T2a` | n1 | CATALOGUE_AVAILABILITY | NONE | KNOWLEDGE | 판매자 |
| S `T2b` | n1 | CATALOGUE_AVAILABILITY | NONE | KNOWLEDGE | 판매자 |
| S `T2c` | n1 | CATALOGUE_AVAILABILITY | NONE | KNOWLEDGE | 판매자 |
| S `T3a` | n1 | PRODUCT_USAGE | NONE | KNOWLEDGE | 판매자 |
| S `T3b` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `T4a` | n1 | PRODUCT_USAGE | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `T4b` | n1 | PRODUCT_USAGE | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `T5a` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `T5b` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `T6a` | n1 | PRODUCT_COMPATIBILITY | FULL | KNOWLEDGE | 자동 답변 |
| S `T6b` | n1 | PRODUCT_COMPATIBILITY | CONDITIONAL | KNOWLEDGE +slot(CUSTOMER) | 고객에게 되묻기 |
| S `T6c` | n1 | PRODUCT_SPEC | PARTIAL | KNOWLEDGE | 판매자 |
| S `T7a` | n1 | SELLER_DECISION | PARTIAL | ENTITY(LISTING) → SELLER | 판매자 |
| S `T7b` | n1 | SELLER_DECISION | PARTIAL | ENTITY(LISTING) → SELLER | 판매자 |
| S `T8a` | n1 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| S `T8b` | n1 | PRODUCT_COMPATIBILITY | PARTIAL | KNOWLEDGE | 판매자 |
| S `T9a` | n1 | PRODUCT_COMPATIBILITY | CONDITIONAL | KNOWLEDGE +slot(CUSTOMER) | 고객에게 되묻기 |
| S `T9b` | n1 | PRODUCT_COMPATIBILITY | CONDITIONAL | KNOWLEDGE +slot(CUSTOMER) | 고객에게 되묻기 |
| S `T10a` | n1 | CATALOGUE_AVAILABILITY | PARTIAL | KNOWLEDGE | 판매자 |
| S `T10b` | n1 | SELLER_DECISION | PARTIAL | PROCEDURE → ENTITY(ORDER) → KNOWLEDGE → SELLER | 판매자 |
| S `T11a` | n1 | ORDER_ACTION | NONE | PROCEDURE → ENTITY(ORDER) → KNOWLEDGE → SELLER | 판매자 |
| S `T12a` | n1 | ORDER_ACTION | NONE | PROCEDURE → ENTITY(ORDER) → SELLER | 판매자 |
| S `T13a` | n1 | ORDER_STATE | PARTIAL | ENTITY(ORDER) | ENTITY_UNBOUND → 판매자 |
| S `X6a` | n1 | PRODUCT_COMPATIBILITY | FULL | KNOWLEDGE | 자동 답변 |
| S `X6b` | n1 | PRODUCT_SPEC | NONE | KNOWLEDGE | 판매자 |
| S `X9a` | n1 | PRODUCT_COMPATIBILITY | CONDITIONAL | KNOWLEDGE +slot(CUSTOMER) | 고객에게 되묻기 |
| S `X3a` | n1 | PRODUCT_USAGE | PARTIAL | KNOWLEDGE | 판매자 |
| S `X2a` | n1 | CATALOGUE_AVAILABILITY | NONE | KNOWLEDGE | 판매자 |
| S `N1` | n1 | POLICY | NONE | KNOWLEDGE | 판매자 |
| S `N2` | n1 | POLICY | NONE | KNOWLEDGE | 판매자 |
| S `N3` | n1 | POLICY | NONE | KNOWLEDGE | 판매자 |
| S `N4` | n1 | POLICY | PARTIAL | KNOWLEDGE | 판매자 |
| S `N5` | n1 | PRODUCT_SPEC | NONE | KNOWLEDGE | 판매자 |
| S `N6` | n1 | SELLER_DECISION | NONE | SELLER | 판매자 |
| S `N7` | n1 | CATALOGUE_AVAILABILITY | FULL | KNOWLEDGE | 자동 답변 |
| S `N8` | n1 | PRODUCT_USAGE | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `N9` | n1 | PRODUCT_SPEC | PARTIAL | KNOWLEDGE | 판매자 |
| S `N10` | n1 | POLICY | NONE | KNOWLEDGE | 판매자 |
| S `N11` | n1 | PRODUCT_SPEC | UNKNOWN | KNOWLEDGE | GAP·ACQUIRABLE → 판매자 |
| S `N12` | n1 | CATALOGUE_AVAILABILITY | PARTIAL | KNOWLEDGE | 판매자 |
