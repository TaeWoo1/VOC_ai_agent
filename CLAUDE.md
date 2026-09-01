# CLAUDE.md

Instructions for working in the active SellerOps repo.

## Product identity

**SellerOps is a multi-channel commerce operations AI agent for SME sellers/manufacturers.**
It carries operational work between human decisions — normalizing reviews, inquiries, orders, and
reports across the seller's channels. It is **not** a scraper dump, a browser click-bot, or a
VOC/cardnews project.

**Product assembly (2026-08-17, product-owner decision):** the product is **workflow-centric**
(홈 / 리뷰 / 문의 / 주문 / 채널 연결), not channel-centric; channel expansion is **paused** and the
seller-visible channel set is exactly **NAVER / Coupang / Cafe24** (a channel on screen is a channel
that is actually usable — `ProductChannels.java`, `lib/productChannels.ts`). Canonical:
`docs/product_assembly_ia_v1.md`.

Canonical product / strategy / state reference: `docs/sellerops_canonical_reference.md` (re-derive
state before citing at any later commit). **FE/IA is frozen as of A7 (2026-08-18)** —
`docs/product_assembly_ia_v1.md` §8; the local demo procedure is `docs/demo_runbook_v1.md`.

## Where development happens

- Normal work: **`sellerops/repo`** (this repo).
- Isolated feature work: **`sellerops/worktrees/<feature-name>/`** (created from this repo).
- **Never develop in `sellerops/runtime-holders/`.**

## Runtime holders

`sellerops/runtime-holders/` contains preserved runtime worktrees linked to the shared `aiagent/.git`
host. They hold live browser profiles, `.env` files, connections, and run state that exist in exactly
one place on disk and are **not** recoverable from git.

- Do not `git clean` there.
- Do not delete ignored files there.
- Do not move a holder with plain `mv` — use `git worktree move`, and only when explicitly approved.
- Do not read, print, or copy `.env` or connection secrets.

## Active source ownership

- `backend/` — Spring Boot service (Java, Gradle, Postgres/Flyway, JWT). **The only LLM egress** — now
  two capabilities, each with its own flag, key, transport, prompt and payload floor, and each provably
  unable to reach the other's (`review/triage/llm/` for review triage; `agent/llm/` for the agent
  runtime's draft seam).
- `frontend/` — React/Vite operations UI.
- `collector/` — TypeScript local agent: channel acquisition + Action Window (NAVER, ESM, Cafe24).
- `agent-runtime/` — standalone Node/TS **LangGraph** orchestration service (port 8787), and since
  2026-08-21 SellerOps's **AI Operator 실행 구조**: an `OperatorGraph` that interprets a goal **with an
  LLM planner and no deterministic fallback** (v2 — no plan, no run), chooses
  specialists (ProductOps · ReviewOps · InquiryOps · ReportOpsNode) and tools, keeps **evidence as
  first-class state**, judges what may be said, and stops on a bounded budget — over the four existing
  compiled graphs with human `interrupt`/resume, whose contracts are unchanged. Tools adapt onto Spring.
  A docker-compose service with its own CI status check and a live `/agent` route. It **holds no
  credential of any kind**: the draft, planner and judge models are all BACKEND capabilities reached
  with the operator's forwarded bearer, so "the backend is the only LLM egress" is still the property to
  check here. **The Operator's tool catalogue is 100% READ — there is no WRITE tool and a structural
  test refuses one** (`OperatorToolRegistry`, `operatorToolRegistry.test.ts`); credential handoff, Action
  Window commands and guided-submission mints are deliberately absent from it (`privilegedPlaneFence`).
  **Two lanes, and they are not the same product:** a button sends a closed `intent` and runs
  deterministically; a typed sentence is planned by the LLM or the run **fails**. Canonical:
  **`docs/sellerops_operator_graph_v2.md`** (제품 행동 계약 — Agent chat의 계획은 **반드시 LLM Planner**가
  세우고, 세울 수 없으면 run은 실패한다; 결정론 goal/keyword planner는 test·fallback 용도로도 존재하지
  않는다) · `docs/sellerops_operator_graph_v1.md`(구현·라이브 증명 기록, runtime semantics는 v2가 대체) ·
  `docs/decisions/agent-runtime-langgraph-llm-split.md`.
- `contracts/` — shared contracts (Action Window, review fingerprint).
- `tools/` — dev/support tooling.
- `docs/` — current SellerOps docs; `docs/archive/` holds historical material.

Map of how these connect, and which document owns each part: `docs/architecture.md` (pointer only).

## Safety fences

- **No CAPTCHA / 2FA bypass**, no auth bypass.
- **No hidden or chained platform clicks** — manual progress always remains available.
- **No automatic export / download / submit** as product behavior — only through an explicit,
  approved **human checkpoint**.
- **Official APIs first; the Action Window** pattern for user-confirmed platform actions: the seller
  clicks export/consent/download/submit on the marketplace; SellerOps only detects, validates, and
  processes the result.
- **Fail closed** on ambiguous, missing, or changed platform targets.
- **Sanitized output only** — never expose credentials, tokens, cookies, seller IDs, API keys, JWTs,
  raw page content, screenshots, exported files, or personal data. Internal timing (`eventTimeMs`)
  never surfaces; only `recencyBucket` may.

## Branch / PR rules

- Work from **feature branches** (never commit product changes directly to `main`).
- **No force-push** unless explicitly approved.
- **No live marketplace runs** without a fresh, single-use, in-turn approval. A plan, a prior
  approval, or a restored environment is never authorization. **Canonical contract:
  `docs/sellerops_live_approval_contract.md`** — the single source for the Standing Safety Contract,
  the Approval Manifest, and the approval lifecycle. Do not restate the rule elsewhere; link there.
  - **Default = one line.** When `bootstrap`/`preflight` has prepared and displayed a valid
    **Approval Manifest** (channel / account / surface / operation / mode / allowed actions on the
    record), the operator's entire single-use grant is the one line **"Seated and ready."**, bound
    to that manifest's `approvalId` + `runId` + scope. Ask for more only in the exceptions the
    canonical contract §3 lists (no manifest; account/operator/date unfixed; scope changed; process
    restarted; or a **WRITE/submission**, which always needs its own explicit mode-`WRITE` approval).
  - **Same-session, same-scope retries need no re-approval** (the live debug-loop). A change of
    channel / account / scope, a new session, or any code/branch/run/environment change ⇒ the
    approval is `REVOKED`; re-bootstrap for a new `approvalId` and a fresh grant.
- Never print secrets. Stage exact files — never `git add .`; never stage `.env`, `.profile/`,
  `.status/`, `.connections/`, `downloads/`, credentials, or real seller data.

## Canonical reading path

Six stops, in order. Everything else in `docs/` is evidence or lineage reached **from** these — if a
document is not on this path and nothing here links to it, it does not carry current truth.

| # | Stop | Owns | Document |
|---|---|---|---|
| 0 | orientation | what SellerOps is, who for, channel posture, user journey — **points, owns nothing** | `docs/product_operating_model.md` |
| 1 | **product scope / journeys** | identity, strategy, honest state, authority · the scope contract | `docs/sellerops_canonical_reference.md` · `docs/product-scope-v1.md` (**scope lock v1.13**) |
| 2 | **architecture** | the five runtimes, how they connect, the fail-closed gates — **a pointer page** | `docs/architecture.md` |
| 3 | **capability truth** | channel × DataType × method × status — **the single declaration** | `docs/multi-channel-connector-roadmap.md` §4.1 |
| 4 | **decisions** | ADRs and standing contracts | `docs/decisions/` · **`docs/proactive_operations_agent_v1.md`** (Proactive Operations Agent — 판매자가 찾기 전에 오늘 처리할 일을 **조사해 준비해 두는** 층. 새 work queue가 아니라 기존 운영 진실 위의 **주석**이다: 일의 수명은 여전히 `inquiry_work_item`과 리뷰 reply ledger가 소유하고, `proactive_case.status`는 매 tick 그것들로부터 **파생**된다(케이스를 직접 바꾸는 API가 없다). 후보 게이트는 **결정론** — LLM은 「여기 일이 있다」를 발명하지 않고, SQL이 정한 뒤에 조사만 한다; 리뷰 tier는 `ReviewRepository.TRIAGE_TIER_RANK`를, 리뷰 dismissal은 `NOT_DISMISSED_PREDICATE`를 **재사용**해 세 번째 사본을 만들지 않는다. 조사는 별도 파이프라인이 아니라 판매자가 누르는 그 production draft path(`proposeAs`/`generateAs`)이고, 문의는 **PROPOSED에서 멈춘다** — 승인 경계·Action Executor·전송은 전부 제자리, 이 패키지에서 도달 불가(`ProactiveSafetyFenceTest`가 채널 호출·승인·Answer Memory 쓰기·product binding을 이름으로 막는다). dedupe identity에 **source state**를 넣어 바뀌지 않은 소스는 아무것도 쓰지 않고 바뀐 소스는 옛 케이스를 `SUPERSEDED`로 닫으며, subject당 열린 케이스 1개는 **부분 유니크 인덱스**가 보증한다. tick 순서는 reconcile→prepare — 간밤에 채널에서 답변된 문의가 같은 실행에 다시 떠오르는 창을 없앤다. 리뷰는 답변을 준비하지 **않는다**(증명된 리뷰 답변 WRITE adapter가 없으므로 `RECOMMENDATION_ONLY`가 천장이고, 반복 문제는 issue memory에서 **읽으며** 정책은 꾸며내지 않는다). ingest가 아니라 스케줄러에 붙어 수집과 함께 실패하지 않고, org 범위는 Self-Pilot Runtime v1이 이미 답한 질문을 재사용하며 per-tick 상한은 백그라운드가 판매자의 일일 AI 예산을 이기지 못하게 한다. **marketplace WRITE 0 · 채널 호출 0 · Agent tool catalogue WRITE 0 불변**; 기본값 OFF이고 **라이브 미실행**) · **`docs/sellerops_operator_graph_v2.md`** (AI Operator 제품 행동 계약 — LLM-first planning · Product Knowledge · 2026-08-21) · `docs/sellerops_operator_graph_v1.md` (실행 구조 · 구현 기록) · `docs/sellerops_live_approval_contract.md` · `docs/sellerops_local_agent_runtime_adr.md` · `docs/sellerops_local_to_pilot_connectivity_decision.md` (NAVER egress IP · Cafe24 callback) · `docs/coupang_review_policy_gate_v1.md` · **`docs/inquiry_action_flow_v1.md`** (문의 답변 흐름 — 채널별 WRITE capability 감사, 근거 있는 초안, **대상에 묶인 승인**과 전송 직전 재확인; Agent graph는 여전히 WRITE 0) · **`docs/inquiry_answer_execution_v1.md`**(문의 답변 실행 — 공식 계약 **재조정**: `PUT`이 `reply_status`를 받지 않는다는 관측에서 「답변할 방법이 없다」로 간 것은 추론이었고 틀렸다. **Cafe24에서는 답변도 글이며**(`POST /articles` + `reply_article_no`), 별도의 **긴급문의 답변** 리소스가 reference에서 답변 본문을 싣는 유일한 객체다 — 후보는 A1 답변 글 · A2 댓글 · B 긴급문의 답변 **셋**이고 board 6이 무엇을 쓰는지는 계약이 말하지 않는다. 승인된 bounded READ proof(GET 5회, 미답변 문의 무접촉)로 **`STANDARD_BOARD_REPLY_ARTICLE` 확정** — 답변은 질문에 달린 **자식 글**이고(`parent_article_no`), **답변 본문은 이미 우리가 호출하는 `GET /boards/{board_no}/articles`가 돌려주고 있었다**; 그래서 드러난 결함 — `parent_article_no`를 투영하지 않아 **판매자 자신의 답변이 미답변 문의로 수집된다** — `docs/inquiry_thread_semantics_v1.md`에서 수정됨. **3단계(Cafe24 Answer Execution v1, 08-25)**: 행위자도 승인된 bounded READ로 확정했다(요청 4회, requested 87 / returned 87 / 미해결 0, WRITE 0 · DB 변경 0, 대상은 이미 증명된 REPLY 44와 그 부모 44뿐이고 PII는 존재 플래그·해시 클래스만 남는다) — 기존 답변 **43/44가 `member_id=mall_id`**(계약이 문서화한 **상점명 렌더링** 조건), 제목은 **SAME_AS_PARENT 43/44**, `reply_status`·담당자ID는 **부모에만** 있고 자식은 전부 null. 그래서 요청 본문이 결정됐다 — `writer`·`member_id`는 `mall_id`, `title`은 질문 제목 그대로(초과·부재는 **자르지 않고 거절**), `reply_status=C`, `reply_user_id`·`secret`·`password`는 **미전송**, `client_ip`는 **배포 설정**이며 관측됐다고 과거 값을 재사용하지 않는다. 다만 **부모=C / 자식=null은 관측된 최종 상태이지 `POST(reply_status=C)`의 side effect 증명이 아니다** ⇒ 종결 의미를 셋으로 나눴다: A `VERIFIED` · B **`ANSWER_POSTED_STATUS_UNRESOLVED`**(답변은 나갔고 완료 표시만 미확정 — 재전송도 undocumented WRITE도 하지 않으며 Memory도 쓰지 않는다) · C `DELIVERY_UNKNOWN`. adapter는 기존 Action Executor seam에 붙고(새 HITL 0, Agent tool 0) **한 번의 POST 뒤 재시도 메서드가 없다**; 검증은 2xx가 아니라 exact READ 1회로 자식 존재·부모 일치·답글 구조·**본문 해시 == 승인 초안**을 본 뒤 부모 상태를 관측한다. onboarding write-scope 가드는 **삭제하지 않고 `Cafe24ScopeContract`로 옮겼다** — 연결 스코프는 여전히 기동 시 write를 거부하고, `mall.write_community`는 **판매자가 켜는 별도 재동의**(연결 스코프 + 정확히 그 하나)로만 요청되므로 silent escalation이 불가능하고 write scope 때문에 기동이 실패하지도 않는다. capability는 NEEDS_VERIFICATION → **DIRECT_API**(구현됨·라이브 미실행)이며 행에 전송 전 조건 셋을 적는다: **write grant · `client_ip` 설정 · 승인된 라이브 실행 ID**. 그리고 product-owner 결정으로 **비밀글도 미답변 workload에 포함**(홈 카드 10 → **25**, secret-excluding 쿼리 2개 삭제). **정정 2026-08-27**: 이 문장이 기록될 당시의 `TEST_INQUIRY_REQUIRED`는 **더 이상 현재 상태가 아니다** — §30에서 실제 POST 1회로 답변이 게시되고 exact READ로 검증돼 **`VERIFIED`**가 됐다(2026-08-25, `b0bfb022`; 자식 글 생성·부모 일치·답글 구조·**본문 해시 == 승인 초안**·부모 `reply_status=C`). 파일럿 관점의 채널별 전송 준비 상태는 `docs/pilot_runtime_foundation_v1.md` §0-A가 소유한다) · **`docs/answer_applicability_v1.md`** (Answer Applicability v1 · §9 **답변 근거 상태** — `GROUNDED`/`NEEDS_CLARIFICATION`/`NO_ANSWER_BASIS`는 **새 classifier가 아니라** 기존 두 enum의 순수 함수이고, **`NO_ANSWER_BASIS`에서는 모델을 호출하지도 초안을 저장하지도 않는다**(화면은 「답변 기준이 필요합니다.」와 빠진 근거 한 줄; 판매자가 직접 쓴다). 그 결과 결정론적 fallback drafter가 **사라졌다** — 「확인한 뒤 정확한 안내를 드리겠습니다」는 근거 0으로 판매자 목소리로 한 약속이었고, Organization Answer Style v1이 판매자 승인 문장을 줄 때까지 임의 promise template은 만들지 않는다 ⇒ 모델이 쓰지 않으면 초안도 없다; proactive도 초안이 없으면 `DRAFT_PREPARED`가 아니라 `NONE`이다 — **근거가 검색됐다는 것과 그 근거를 이
질문에 그대로 적용할 수 있다는 것은 다른 주장이다**. 2026-08-26 NAVER 라이브에서 「전선이 몇 가닥까지
들어가나요?」에 초안이 「일반 가전 전선 기준으로 3~4가닥」이라고 답했는데, 감사 결과 흔한 원인 셋이 전부
아니었다 — 모델은 **지어내지 않았고**(그 문장은 판매자 FAQ의 Q&A 그대로), 검색은 **엉뚱한 문서를 가져오지
않았으며**(그 chunk에 바로 그 질문이 있다), 한정어도 **떼지 않았다**. 결함은 판매자의 FAQ가 규격을
구분하지 않고 상품 단위로 쓰여 있는데 시스템에 「이 질문의 답은 옵션에 따라 달라진다」를 담을 자리가
없었다는 것이다. 그래서 `SpecApplicability` 셋(`NOT_VARIANT_SENSITIVE`·`VARIANT_UNRESOLVED`·
`VARIANT_NAMED`)이 결정론적으로 분류하고, 주문 상태 줄과 **같은 seam**으로 프롬프트(v6)에 한 줄이
들어간다 — 확정되지 않았으면 수치를 이 고객의 확정 사실로 단정하지 말고 규격을 되묻는다. **판매자의
근거를 숨기지 않는다**(등록된 FAQ를 못 쓰게 만드는 것은 다른 종류의 거짓말이다); 바뀌는 것은 그 수치가
닫는 문장이냐 되묻는 문장이냐다. payload floor는 그대로 — 그 줄은 **질문에 대한 사실**이라 옵션 이름을
싣지 않는다. 새 ontology·variant engine·스키마 **0**이고, variant 데이터는 오늘 **Coupang에서만** 오므로
NAVER에서 `VARIANT_NAMED`는 도달 불가라고 적어 둔다. 테스트는 **분류**와 **모델이 무엇을 들었는가**만
검증한다 — 모델이 쓴 문장은 이 저장소 안 어떤 것의 결정론적 함수도 아니다. 같은 사건이 화면 결함 둘도
드러냈고 함께 닫았다: 인용이 **제목만** 보여 「자주 묻는 질문 - 접착과 재부착」 옆에 가닥 수 답변이 서
있었으므로 **첫 근거는 펼쳐서 출처·제목·발췌를 보이고 나머지는 접는다**(넷 다 펼치면 반대쪽 실패이고,
locator는 여전히 화면에 없다); 발췌는 드래프터가 실제로 본 문장에서 오고 나중 조회는 출처에서 읽어
온다(`DraftEvidenceSnippets` — 텍스트 사본은 하나뿐, 삭제된 문서는 **발췌 없는 인용**으로 남는다).
그리고 같은 문의가 목록 「17분 전」·상세 「방금」으로 보이던 것은 사다리 하나(`lib/elapsed.ts`)로
합쳤다 — **숫자와 단위는 한 곳에서 정하고 말투만 각자 고른다**. 마켓플레이스 호출 0 · DB 변경 0. §9-1
(08-27): **답변 근거와 운영 상태는 다른 질문이다** — 근거가 완벽한 질문에서 벤더가 응답하지 않았을 때도
화면이 「답변 기준이 필요합니다」라고 말했고, 판매자는 이미 등록한 지식을 한 번 더 등록하러 갔을 것이다.
**새 enum 없이** 기존 `ProductDetailEnrichmentTrigger.Outcome`과 `quotaMessage`→**`unavailableMessage`**로
갈랐고, 화면 규칙은 우선순위 하나다(`unavailableMessage`가 있으면 「답변 기준이 필요합니다」는 렌더되지
않는다). **끝까지 보지 못한 것과 보고 나서 없는 것은 다른 주장이다**; `PENDING`은 생산자가 없으므로
만들지 않았다). **`docs/image_product_knowledge_v1.md`**(Image Product Knowledge v1 — **설계만, 구현 0**. 08-26 승인 `apr-nv-detail-13250364547-r2`로 요청 **1회**: 이 판매자의 상세페이지는 `IMAGE_REFERENCES_ONLY`이고 텍스트 **104자** · 이미지 **26장** · 옵션 **20/20 id 보유** ⇒ verdict **`IMAGE_ONLY_GAP`**. 측정이 닫은 것은 **텍스트 경로뿐**이었고 옵션 이름의 내용은 미관측이었다 — 프로브가 판매자 콘텐츠를 한 글자도 내보내지 않기 때문이며(설계 결과이지 결함이 아니다), A/C를 가르는 비용은 **READ 1회**였다. **그 1회를 썼고 판정은 뒤집히지 않았다** — 승인 `apr-nv-option-13250364547-r1`(요청 1 · WRITE 0 · 저장 0): `options=20 axes=2 spec_bearing=20 capacity_bearing=0`, 즉 **규격은 옵션 라벨에 이름으로 있으나** 수용 가닥수는 20개 전수에서 관계어 **0건** ⇒ 후보 **B `VARIANT_LABEL_ONLY`**, `IMAGE_ONLY_GAP` **CONFIRMED**. `(##개)`를 가닥수로 읽지 않았다 — 숫자는 관계가 아니고 그 추론이 바로 원래 결함이다(`OptionSemantics`는 관계 **단어**를 요구하고 의도적으로 과소 계수하며 판매자 라벨은 **자릿수 마스킹**으로만 나간다: `16x10mm`→`##x##mm`, 패턴 상한 3). 부수 소득: `SpecApplicability.VARIANT_NAMED`가 NAVER에서 **구조적으로 도달 가능**함이 확인돼 §6의 「규격 라벨 없는 수치는 저장 거절」이 실행 가능한 규칙이 됐다. 상태는 이제 **`TEXT_LANE_WIRED` · `IMAGE_LANE_UNBUILT` · 비용 전제 `UNVERIFIED`**다 — payload floor는 **승인**됐고 착수 순서는 **텍스트 우선**으로 정해졌다. 그래서 지어진 것은 이미지 lane이 아니라 그 바닥이다: 감사 결과 `ProductDetailEnrichment`는 `main`에서 **caller 0**이었고 채널 유래 지식 문서도 **0**이었으므로 이미지 lane은 **한 번도 돈 적 없는** 텍스트 lane 위에 설계되고 있었다 ⇒ `ProductDetailEnrichmentTrigger`가 세 조건(actionable inquiry · exact attribution · 지식 없음/오래됨) 전부일 때만 상품 **하나**를 읽는다(sweep 0, 스케줄러 0, 실패는 초안을 죽이지 않는다); `detailContent`의 `<img src>`만 투영하고 **listing gallery는 grounding source 금지**(구조 테스트); **SSRF-safe CDN fetch 계약**(https 전용 · 문서에서 뽑은 URL만 · 인증 헤더 0 · 리다이렉트마다 재검증 · content-type 화이트리스트 · 바이트 상한 · 사설/메타데이터 주소 거부, 범용 fetcher 노출 금지). **Stage 0 census 실행됨**(`apr-nv-image-census-13250364547-r1`, 마켓플레이스 1 · CDN 26 · **모델 0** · DB 0): `unique_sha256=26 duplicate_fetches=0 reuse_ratio=1.00`, 3.65MB/26장 — **상품 하나 안의 중복은 0**이고, 설계가 기댄 **상품 간** 재사용은 카탈로그를 읽어야 재는 것이라 **이 census가 답할 수 없다** ⇒ 비용 전제는 `UNVERIFIED`로 남고 다시 product-owner 결정이다. 이미지 lane 코드는 여전히 **0**이며 `AI_EXTRACTED_FROM_SELLER_IMAGE` 생산자 0 테스트는 초록이지만, 그 authorship이 선언만 하고 아무도 적용하지 않던 `carriesExactFiguresUnaided()`는 **이제 production에서 적용된다** — 근거 중 하나라도 그림에서 왔으면 규격 적용 범위 줄이 격상되고, 새 seam·payload floor 변화는 0이다. 붙을 자리는 새 파이프라인이 아니라 이미 있는 `ProductDetailEnrichment`의 `Outcome.IMAGE_ONLY`이고 어휘도 이미 있다 — `AI_EXTRACTED_FROM_SELLER_IMAGE`는 생산자 0이 테스트로 고정돼 있어 **그 테스트가 이 lane의 스위치**이며 조용히 켜지지 않는다. 상세 이미지 **한정**(리뷰·첨부 제외) · 상품당 상한 · **바이트 해시** dedupe(판매자는 같은 배너를 온 상품에 재사용하므로 비용의 분모는 상품 수가 아니라 **고유 그림 수**이고 그 비율 측정이 **첫 작업** — 무너지면 착수하지 않는 것이 옳다) · **규격 라벨 없는 수치는 저장 거절**(「3~4가닥」만 뜬 조각이 바로 이 사건을 다시 일으키는 모양이다) · 실패 격리로 최악이 **오늘**. **가장 큰 안전 델타에 이름을 붙여 둔다** — payload floor의 성질이 바뀐다: 우리가 고른 문장이 아니라 **판매자 이미지 원본**이 모델로 나가고 그 안에 무엇이 찍혀 있는지 보내기 전에 모른다 ⇒ 착수는 비용 판단이 아니라 **product-owner 결정**이며 이 문서는 그 질문에 답하지 않는다. 세 번째 LLM capability는 앞의 둘과 같은 격리 규율을 진다. 대규모 OCR pipeline · vector DB · generic document ingestion **금지**. **Stage 1 준비 완료·모델 호출 0**(§10, 08-27): 트리거 **기본값 OFF**(라이브 미검증 capability가 머지만으로 판매자 채널을 읽지 않는다 — 평범한 boot은 상세 READ 0), **cross-product census는 하지 않기로 결정**(v1 경제성은 실제 문의가 가리킨 상품 하나로 판단하고 cache table도 만들지 않는다; 파일럿 중 해시가 쌓이면 재평가), 텔레메트리 `reuse_ratio` → **`unique_ratio`+`dedupe_hit_ratio`**(계산한 것은 unique/fetched였으므로 「재사용률」은 정반대 이름이었다), **규격 지속성**은 코드가 이미 옳았고 없던 것은 그 순서를 고정하는 테스트였다(`writeOptions`가 shape 판정 앞 ⇒ 그림 페이지도 옵션 20을 쓴다; 대상 상품은 API 20/저장 0이었다), **26장 전수**(spec-bearing image를 누락하지 않는 결정론적 pre-filter가 없으므로 「12장이면 충분」은 근거 없는 절단), **one-image-per-call 유지**(묶어서 아끼는 것은 상수 프롬프트뿐 ≈$0.005이고 파는 것은 provenance 보장이다), 그리고 **벤더 감사**: 설정 모델 `gpt-5-2025-08-07`은 벤더 문서에서 **deprecated·종료 예정**으로 표시돼 있고 이미지 토큰화도 타일 기반(70+140/타일)이다 — 여섯 capability 전부의 기본값이므로 **모델 갱신은 product-owner 결정**. 비용은 관측 치수 기반 산식으로 상품당 **≈$0.03~$1**(장별 치수는 census가 남기지 않아 정확한 합계는 Stage 1이 낸다), 지연은 **UNMEASURED**. **영구 처리 영수증은 기존 seam으로 표현 불가**로 판정하고 테이블을 만들지 않았다 — `ProductKnowledgeSource`로 표현하면 본문 없는 문서가 「등록된 지식 N건」을 부풀리고, `SyncCursor`는 이미지 단위를 담지 못한다 ⇒ 최소 contract만 §10-4에 적었다). **Stage 1 라이브 실행됨**(§11, `apr-nv-image-knowledge-13250364547-r1`, 08-27): 모델 `gpt-5.6-terra`(이 capability만 별도 model property — 나머지 다섯의 기본값은 건드리지 않았다), 마켓플레이스 1 · CDN 26 · **vision 26회** · WRITE 0 · 실비 **$0.104**(이론 상한 $0.556 ≤ 승인 $0.75, 그 상한은 `detail:high`의 2,500 patch 캡과 출력 1,200 토큰에서 나오며 **테스트가 계산한다** — `auto`는 이 모델에서 patch 예산이 없어 상한을 말할 수 없다). **추출은 됐고 채택은 0이다**: triple 48 · `NO_FACTS` 16 · 실패 3, 그리고 **발행 0 · 판매자 화면 무변화**. 이유 둘 — (1) 이미지의 `#호`·`WOOD`와 채널 옵션 `그레이 / #호(##개)`는 **다른 문자열**이라 exact match 0(포장 수량을 떼거나 영문을 국문으로 옮기는 것은 인코딩 보정이 아니라 추측이다), (2) **찾던 사실이 그 페이지에도 없다**(가닥·심선·코어 관련 attribute 0건; 적혀 있는 것은 외경/내경 치수·재질·원산지). 즉 **48개의 그럴듯한 사실을 쥐고 하나도 내보내지 않았다** — 「읽었다」와 「말해도 된다」의 분리가 관측으로 확인됐다. 부수 결함 둘도 닫혔다: `ProductDetailEnrichment`가 문서를 저장하면서 **청크를 만들지 않아** `TEXT_INDEXED`가 검색 불가능한 문서를 가리키고 있었고(`ProductKnowledgeIndexer`로 추출해 두 writer가 공유), receipt identity는 **`(org, product, sha, extractor, model)`**이다 — `(org, sha)`는 cross-product cache가 되므로 금지. 남은 product-owner 결정: **채널 옵션 이름의 선언적 축 분해를 허용할 것인가**(fuzzy가 아니라 채널 포맷 파싱이지만 새 규칙이다) · 영문↔국문 색상 대응은 **사전이고 사전은 ontology의 시작**이라 더 위험하다) · **`docs/cafe24_comment_answer_observation_v1.md`**(카페24 board-6 답변 표현은 **하나가 아니다** — 승인된 bounded READ `apr-c24-a3674-obs`(요청 7 · WRITE 0 · DB 변경 0, 대상은 운영자 본인의 「연동 테스트」 글 셋뿐이라 실고객 문의 무접촉)로 verdict **`STANDARD_BOARD_COMMENT`** 확정: 판매자가 관리자 화면에서 등록한 답변이 **댓글**로 존재했고 자식 글은 0, 긴급문의 경로는 해당 없음. **핵심은 댓글 답변이 `reply_status`를 바꾸지 않는다는 것** — 14:56 답변 뒤 routine sweep이 17:43에 재수집하고도 미답변으로 저장했으므로 이것은 신호 오독이 아니라 **관측 표면 밖**이었다. 행위자는 추정이 아니라 **동일성**(`member_id == mall_id`, 플랫폼이 문서화한 상점명 렌더링 조건, 08-25 actor probe에서 43/44 관측)으로 확정하고 그 비교의 **boolean만** 흐른다 — id·본문·작성자명은 public record에 필드가 없다. 수정은 `Cafe24InquiryAnswerObserver` 하나: 문서화된 `comment=T` 필터로 발견 1회 + 후보당 댓글 READ 1회(상한 20)이고 후보는 이 페이지가 미답변으로 저장했을 행뿐, **댓글은 문의로 수집되지 않으며** 증명된 판매자 댓글만 부모를 `ANSWERED`로 만든다. **downstream 0**(`becameAnswered` → `reconcileConnectorAnswered`가 이미 OPEN work item을 닫는다), 새 scope 0, 새 테이블·phase·event 0, 그리고 **`answer_body` 미저장** — 「답변했다」와 「이렇게 답했다」는 다른 주장이고 후자는 Answer Memory라는 자체 downstream을 갖는다. `inform_status`는 계속 `N`을 적는다: 채널이 말한 것과 우리가 내린 결론은 다른 칸이다. **라이브 재증명 `LIVE_VERIFIED`**(2026-08-26, `apr-c24-a3674-reproof`, WRITE 0) — 진단 러너가 아니라 판매자에게 실제로 도는 routine sweep 안에서 요청 2회(발견 1 + 댓글 1)로 대상을 `ANSWERED`로 옮겼고 `answered_at`은 댓글 자신의 시각(14:56:24), `inform_status`는 여전히 `N`, org 미답변 35→34; 승인된 READ 결과를 DB에 재생하는 흉내는 쓰지 않았다. work item은 `COMPLETED`가 아니라 **`PROPOSED`**에 남는다 — **과거 백로그 정합 `LIVE_VERIFIED`**(`apr-c24-hist-comments`, 요청 **5**/상한 26, WRITE 0): `article_no`+`comment=T` 결합 발견 1회로 25건 중 4건만 좁혀 읽었고 — **그 4건은 이미 답변돼 있었다**(2014·2014·2019·2021, 전부 질문 며칠 안에 답변된 뒤 최대 12년간 「답변 필요」로 방치) — **진짜 미답변 25→21**. `answer_body` 미저장 · `inform_status` 무변경. 그리고 **answered-elsewhere lifecycle**: `reconcileConnectorAnswered`가 이제 `OPEN`과 **`PROPOSED`**를 닫는다(PROPOSED는 AI 초안뿐이고 승인·실행 이전이므로 외부 source truth가 이긴다) — `APPROVED` 이후와 `ACTION_PENDING`·`EXECUTED`는 실행 lifecycle이 계속 소유하고, 새 phase·event·disposition **0**이며 판정은 transition이 아니라 「지금 answered인가」라서 self-healing이다. 화면도 `status`를 읽어 「이미 답변된 문의입니다」를 보이고 전송 CTA를 끈다. **`P`는 fail-closed 유지** — 계약이 스스로 모순되므로(속성표=처리중, 필터표=답변) 오직 결정론적 증거(판매자 댓글·답변 글)만 `ANSWERED`로 옮긴다. 장기 방향은 `docs/operational_knowledge_direction_v1.md`에 기록만 했다 — 운영 지식은 상품 FAQ가 아니며 언젠가 Entity·Fact·Relation·Provenance·Applicability가 되지만 **이번 구현 0**). **`docs/inquiry_thread_semantics_v1.md`**(스레드 의미 복구 — Cafe24 게시판에서 **답변은 질문에 달린 자식 글**이므로 답글은 독립 고객 문의가 아니다: `SourceThreadRole{ROOT,REPLY}`는 출처의 `parent_article_no`/`reply_depth`로만 정해지고 **article 번호 인접성은 판정에 쓰지 않는다**(소스 스캔 테스트); 관계는 새 테이블이 아니라 `thread_role` + `thread_parent_external_id` 두 칸이고 부모를 **같은 external-id 공간**으로 가리킨다. **답글이 판매자가 쓴 것이라는 증명은 없다**(자식에 `reply_user_id` 부재, 작성자 필드는 PII라 미투영) ⇒ `THREAD_REPLY_UNKNOWN_ACTOR`로 보존하고 `answer_body`로 **승격하지 않는다**; 그래서 Answer Memory 연결도 하지 않는다. 신규 수집은 **새 요청·새 endpoint·새 scope 없이** 고쳐진다(그 필드는 이미 모든 응답에 있었다); 제외는 삭제가 아니다 — `EXCLUDED_THREAD_REPLY`(`EXCLUDED_SPAM`보다 우선, projector 단일 writer 유지)로 현재 읽기에서만 빠지고 OPEN work item은 **닫지 않는다**. 작업 큐가 `ACTIVE` 게이트 없이 읽던 결함도 함께 닫았다. historical backlog는 routine 창(14일)이 닿지 않아 **exact `article_no` bounded re-read**를 했다 — 승인된 GET 4회(상한 6)로 **requested 68 / returned 68 / 미응답 0 / 불일치 0**, **proven REPLY 44 · ROOT 24**(미답변 업무의 65%가 고객의 질문이 아니었다; `reply_depth` 최대 2 — 답글에 달린 답글). `inform_status` 공백 44 = REPLY 44 완전 일치이지만 **공백도 인접성도 판정에 쓰지 않았기에** 그 일치가 증거가 된다. **REPLY ≠ 판매자 작성**은 유지(자식에 `reply_user_id` 부재) ⇒ `answer_body`·Answer Memory 승격 0. repair **실행됨**(2026-08-25, **marketplace 호출 0** — 승인된 READ가 남긴 44개 `(article_no, parent)`를 해시로 고정해 재생): 기존 dismissal batch는 **정직하게 표현할 수 없어 쓰지 않았다**(매니페스트가 없던 승인을 요구하고, `ELIGIBLE`이 `OPEN`만 허용해 `PROPOSED` 2건 때문에 실행 자체가 불가) ⇒ 새 테이블·phase·event 0, 새 단어는 disposition **`SOURCE_THREAD_REPLY`** 하나이며 `sellerDecision()` 술어로 **승인 경로 진입 불가**, `phase_from`은 실제 phase, `dismissal_batch_id`는 null. 실측: 미답변 68→**24**, work item OPEN 64→**22**, 작업 큐/Agent 64→**22**, Inbox 69→**25**, 홈 KPI 69→**25**, summary 카드 20→**10**, 삭제 0·proposal 5→5(2건 실행 불가). **20 vs 69는 thread 오염이 아니라 비밀글 필터였고**(제거 후에도 25 vs 10, 간격 15 = 비밀글 15) product-owner decision으로 남는다. WRITE 0) · **`docs/inquiry_workflow_completion_v2.md`** (RAG retrieval correctness — 질문을 답할 수 있는 라이브러리가 0을 돌려주고 답할 수 없는 라이브러리가 1.00을 돌려주던 역전의 원인과 재설계; 사람이 정하는 `USER_CONFIRMED` 상품 연결; NAVER 두 subtype의 **서로 다른** 공식 답변 계약과 그로부터 나온 `OVERWRITE_WITHOUT_PROOF`) · **`docs/inquiry_operational_truth_v1.md`** (문의 operational lifecycle — 셀러의 SPAM dismissal은 current read 전부에서 존중되고, historical backfill은 routine cursor를 재정의하지 않으며, **absence는 삭제로 자동 판정되지 않는다**) · **`docs/seller_operations_knowledge_and_answer_memory_v1.md`** (Knowledge Scope 5종 — `CHANNEL_FACT`·`ORDER_STATE`는 **검색 코퍼스를 갖지 않고** 결정론적 출처에서 그때 읽는다; org 단위 **운영 정책**과 판매자가 실제로 한 **과거 답변**이 상품 지식과 같은 채점기를 쓰는 3-lane retrieval; **AI 초안은 Answer Memory에 들어가지 않는다**(구조 fence)) · **`docs/operational_fact_binding_v1.md`** (주문 결합 — 주문 참조는 **채널이 지목한 것만** 저장하고 본문에서 추출하지 않는다(`InquiryOrderBinding`은 값이 하나이고 그 부재가 fence다); OrderFact는 결제·취소·발송을 **따로** 든다(`cancelled`의 `FALSE` 금지는 08-25 exact READ 도입으로 **저장 경로 한정**으로 좁혀졌다 — 아래 항목); freshness는 `ChannelDataState` 재사용이며 **`ORDER_SUMMARY` 집계가 번 freshness로 개별 주문을 말하지 않는다**; exact single-order lookup 계약 미보유 선언은 **Cafe24에 대해 08-25 정정됨** — 아래 항목) · **`docs/exact_operational_context_v1.md`**(주문 단건 조회 — Cafe24 공식 `GET /api/v2/admin/orders/{order_id}`를 사본으로 고정한 뒤에야 capability를 옮겼고(`ExactOrderLookupCapability`는 vendored 문서를 **이름으로** 가리키며 테스트가 그 파일의 존재를 확인한다), **참조가 있다는 것은 호출할 이유가 아니다**(`OrderFactLookup` — 문의 상세와 초안만 `EXACT_ALLOWED`, 나머지는 전부 `STORED_ONLY`; cache는 표가 아니라 **메모리 5분**), 그리고 `cancelled`의 `FALSE` fence는 vocabulary에서 **SOURCE**로 옮겼다 — `NOT_CANCELLED`는 `EXACT_READ`에서만 살아남고 저장 경로에서 온 값은 record의 constructor가 지운다) · **`docs/pilot_usage_loop_v1.md`**(Pilot Usage Loop v1 — 파일럿에서 **무엇을 성공으로 셀 것인가**의 계약. 감사 결과 **코드 변경 0**: `proactive_case.work_item_id`가 이미 `inquiry_approval`·`inquiry_execution`·`inquiry_verification`으로 가는 조인이고, 초안 채택은 `inquiry_reply_draft`의 append-only `author_kind`+`content_fingerprint`로 갈린다 — 새 이벤트 스트림도 「AI 채택률」 테이블도 만들지 않는다. strong success는 **`VERIFIED` 하나**이며 `ANSWER_POSTED_STATUS_UNRESOLVED`는 성공에도 실패에도 넣지 않는다; `prepared`는 분모일 뿐 성공이 아니고 Agent 메시지 수·토큰·렌더 수는 KPI가 아니다. 지연은 `created_at`이 아니라 **`surfaced_at`** 기준(판매자가 볼 수 없던 시간은 반응 시간이 아니다). 데모 표시 칸을 만들지 않고 **명시적 org 코호트**로 제외하며 canonical Demo Org는 코호트 밖이다 — LIVE_GREEN 증명의 `surfaced_at`은 판매자가 아니라 관측용 브라우저가 남긴 값이었다. 리뷰 lane은 `review_reply_outcome.verification`이 `UNVERIFIED` 하나뿐이라 **VERIFIED에 구조적으로 도달할 수 없다**) · **`docs/knowledge_gap_resolution_v1.md`**(Knowledge Gap Resolution v1 — `NO_ANSWER_BASIS`가 **정확해도** 판매자가 그 자리에서 지식을 보충할 수 없으면 같은 질문은 영원히 같은 답을 받는다. 감사 결과 필요한 것 대부분이 **이미 있었고**(CRUD·즉시 색인·`SELLER_ENTERED_KNOWLEDGE`·상품 결합·재생성 엔드포인트·라이브러리 화면) 없던 것은 셋이다 — 문의 화면에서 지식으로 가는 길, 지식의 **규격 적용 범위**, 그리고 **무엇이 부족한지** 말하는 문장. 「답변 기준 추가」는 문의 상세 그 카드 안에서 열리고(상품 재검색 0, 큰 관리 화면으로 보내지 않으며, **상품이 없으면 버튼도 없다**), 저장은 **저장까지만** 한다 — 저장→재색인→검색→적용 가능성→**초안 재생성**이고 승인·Action Executor·전송은 제자리(`KnowledgeWriteFenceTest`가 `inquiry/reply`·`publish`·`proposal`·`lifecycle`에 지식 writer가 없음을, 지식 문서를 만들 수 있는 클래스가 **셋뿐**임을 이름으로 고정한다). **규격 범위는 기존 seam으로 표현 불가**로 판정했다 — `source_type`은 글의 종류, `authored_origin`은 글의 출처이고 `channel_source_ref`는 채널 문서의 동일성 키라 재사용하면 재수집이 판매자 글을 덮는다; 본문에 `[2호] 3~4가닥`을 적고 regex로 복원하는 것은 **migration도 constraint도 없는 스키마**다 ⇒ V79 **한 칸** (`variant_id uuid references product_variants`), backfill **없음**(`null`은 「모른다」가 아니라 **전체 상품 공통**이고 기존 5행이 이미 그것이다), FK가 **임의 규격 이름을 불가능하게** 만든다(다른 상품의 규격은 400 — 조용한 null은 한 규격의 주장을 전 규격으로 넓히는 것이다). 검색 규칙은 **비대칭**이다: 고객이 3호를 말했으면 2호 문서는 약한 근거가 아니라 **다른 물건에 대한 근거**라 문서 집합 단계에서 빠지고(랭킹 뒤에 거르면 4칸 중 하나를 차지했다 사라져 멀쩡한 공통 답이 빈손이 된다), 아무도 말하지 않았으면 **아무것도 빼지 않는다** — 규격별 문서가 「답할 수 있다」의 증거이고 정직한 답은 **되묻는 것**이다. 그래서 규격 확정이 **검색보다 먼저** 일어난다. 「지식 하나 추가 = GROUNDED」가 **아니다**: 해당 없는 지식은 `NO_ANSWER_BASIS` 유지, 규격별 지식 + 규격 미확정은 `NEEDS_CLARIFICATION`, 규격이 등록되지 않은 리스팅에서는 지식을 넣어도 `VARIANT_UNRESOLVED`라 되묻는 것이 맞다. 부족한 것을 말하는 줄은 **고객이 쓴 명사를 그대로 인용**하고(「'가닥' 관련 내용이 없습니다」) 새 classifier가 아니라 기존 단어 목록을 **명사/어투로 쪼갠 것**이 전부다 — 단어는 하나도 더하거나 빼지 않았고 합집합이 여전히 판정을 결정한다. **판매자가 직접 쓴 답변은 자동으로 지식이 되지 않는다**(실제 답변 ≠ 객관적 상품 지식; 「이 답변을 답변 기준으로 저장」은 **별도 결정**). 이미지 lane은 **`TECHNICAL_LIVE_PROOF_COMPLETE` · rollout `DEFERRED`**로 기록하고 추가 vision 호출 0이며 두 lane 모두 기본값 OFF임을 테스트가 `application.yml`에서 확인한다. 다음 패키지는 **Organization Answer Style v1** — Knowledge는 「무엇이 사실인가」, Style은 「어떻게 말하는가」이고 **style이 factual grounding을 override할 수 없다**. 커넥터·스케줄러를 끈 채 기동해 V79를 실제 로컬 DB에 적용했다(마이그레이션 1건, 채널·모델 활동 0, ERROR/WARN 0; 기존 지식 5건 전부 `variant_id` null · 청크 없는 문서 0 · 규격 후보 425). **마켓플레이스 호출 0 · 모델 호출 0 · 실제 판매자 지식 삽입 0** ⇒ evidence 행 없음) · **`docs/organization_answer_style_v1.md`**(Organization Answer Style v1 — 같은 근거라도 회사마다 원하는 방식으로 답변을 쓰게 한다. **Knowledge = 무엇이 사실인가 · Style = 그 사실을 어떻게 말하는가**이고, style은 factual grounding·applicability·safety를 **절대 override하지 못한다**. 감사 결과 바닥은 이미 있었고 **서 있는 사람이 없었다** — `AnswerStyleSafetyFloor`는 한 패키지 앞서 작성돼 「production 참조 0」을 테스트로 고정해 두고 있었고, 이 패키지가 그 caller이며 그 테스트는 **「참조 정확히 1」**로 뒤집혔다. V80 한 테이블 · **org_id가 PK**(「회사당 하나」가 떨어질 수 있는 제약이 아니라 테이블의 성질) · 백필 0 — **행이 없는 것이 정상 상태**이고 그때 답하는 `defaults()`는 이 제품이 이미 쓰던 문장이라 오늘 만족하는 회사는 할 일이 없다(기본값과 동일한 프로필은 프롬프트 섹션을 **아예 렌더하지 않는다** — 기본 스타일이 곧 shipped 프롬프트이므로 다시 적는 것이 곧 변경이다). 조립은 **우리 코드가** 한다: 세 enum(말투·길이·이모지)은 우리가 쓴 문장이 되고 판매자 문자열은 **따옴표 데이터**로 라벨 붙은 줄에 실리며, 그 섹션은 **user turn에만** 간다 — system turn에 판매자 문자열을 놓았다면 **한 회사가 다른 모든 회사의 초안을 쓰는 안전 규칙을 편집**할 수 있었고 어떤 phrase check로도 그 모양에서는 회복되지 않는다(구조 테스트). payload floor는 두 번째로, **한 종류만** 넓어졌다(이 org 자신의 표현 설정 — 고객·주문·상품·식별자 0). **required phrase에는 사실을 담을 수 없다**: 「꼭 포함할 표현」은 모든 답변에 넣으라는 **무조건적** 지시이고 사실은 무조건 참인 적이 없다 — 「당일 발송됩니다」의 자리는 운영 정책이고 거기서는 근거라 grounding의 지배를 받는다(닫힌 단어 목록으로 write 시점 **거절**, render 시점 **제거**). 금지 표현은 모델 **뒤에도** 검사해 걸리면 초안을 **거절**한다 — 단어를 지워내면 아무도 고르지 않은 의미가 남고 그대로 저장하면 규칙이 선호가 된다. `NO_ANSWER_BASIS`는 모델 0·초안 0 그대로이되 판매자가 등록한 **unknown fallback**이 있으면 그 문장을 **한 글자도 바꾸지 않고** 저장한다(새 author kind `SELLER_APPROVED_FALLBACK`; 인사·말투 미적용; **basis는 여전히 NO_ANSWER_BASIS**라 화면은 계속 무엇이 빠졌는지 말하고 「답변 기준 추가」도 그대로 — 유예는 답변이 아니다; 상세 읽기 실패·판독 중에는 **쓰지 않는다**). GROUNDED 불변성은 **payload로** 검증한다 — 같은 질문에 두 스타일이면 user turn의 사실 부분이 완전히 동일하고 스타일 섹션만 뒤에 붙는다(모델이 쓴 문장은 결정론적 함수가 아니므로 「친근하게 썼는가」는 벤더의 기분을 단언하는 테스트다). 스타일 identity는 새 컬럼이 아니라 기존 `model_version`에 `+style/v3`으로 붙고, append-only 초안은 스타일을 바꿔도 움직이지 않는다. 화면은 `/settings/style` **AI 답변 스타일** — prompt·system·temperature·model 같은 단어 **0**(테스트), preview는 **고정 합성 예시** 위에 인사·호칭·필수 표현만 그리고 본문은 자리 표시자다(스타일 미리보기가 절대 해서는 안 되는 일이 상점 주인에게 자기 회사 정책처럼 읽히는 배송 답변을 보여 주는 것이다). **exemplar는 DEFER** — `usableAsExemplar`는 caller **0**이 테스트로 고정돼 그 테스트가 이 lane의 스위치이고, 리뷰 답글·자동 학습·product/channel/customer별 style·generic prompt builder는 **0**. 커넥터·스케줄러를 끈 채 기동해 V80을 실제 로컬 DB에 적용했다(마이그레이션 1건, 채널·모델 활동 0, ERROR/WARN 0, style 행 0). **마켓플레이스 호출 0 · 모델 호출 0 · WRITE 0** ⇒ evidence 행 없음) |
| 5 | **evidence** | every live run: date, channel, capability, commit, approval id, outcome | `docs/evidence/INDEX.md` |

**Demo 제품 정의:** `docs/demo_core_experience_v1.md`가 **데모로 보여줄 SellerOps**를 소유한다 —
첫 화면은 운영 Dashboard, 상품 화면과 Product Knowledge/RAG는 데모 필수, Agent는 어디서든, 그리고
Agent reasoning graph는 여전히 **WRITE 0**(marketplace WRITE는 승인 뒤 별도 Action Executor). 기존
canonical technical 문서를 덮어쓰지 않고 그 위에서 **화면과 경험의 순서**만 정한다. 매출 semantics는
채널마다 다르며 그 감사 결과가 §4.1에 있다. UX 감사와 재설계 원칙: `docs/frontend_ux_audit_v1.md` ·
**`docs/demo_ux_polish_v1.md`** (Demo UX Polish v1 — 기능 추가 0, `frontend/` 전용. 실제 Demo Org로
16개 화면을 렌더 기준 감사한 뒤 P0/P1만 고쳤다: 채널이 보낸 **원본 HTML/엔티티가 문의·리뷰 본문에
그대로 노출**되던 것을 표시 단계에서만 벗기고(`lib/plainText.ts` — 저장된 행 무변경, 태그는 해석하지
않고 제거), 목록 행과 상세 헤드라인을 **상품명이 아니라 고객이 쓴 문장**으로 바꿨으며(이 org의
카페24 백로그는 대부분 미연결이라 26행이 전부 「상품 미지정」이었다), **프로액티브 [확인하기]로
도착한 문의가 첫 화면 밖으로 밀리던 것**을 섹션 미렌더 + 3-pane 비율 조정으로 닫았다. 화면이 시키던
「초안을 복사해 등록하세요」에 대응하는 **[초안 복사]**를 붙였고 — **저장된 버전만** 복사하며
클립보드가 없으면 성공했다고 말하지 않는다 — raw enum 노출(`ACTIVE`·`SUSPENDED`·`22,500KRW`·매핑
없는 phase 통과)과 에이전트 화면의 배포 배지를 없앴다. 새 색·새 컴포넌트·새 프레임워크 0, backend
무변경, 마켓플레이스 호출 0 · DB 변경 0 ⇒ evidence 행 없음. **고치지 않고 보고한 것**: 합성 행이
`data_origin='REAL'`로 저장돼 리뷰·상품 화면에 섞여 보이는 것(historical cleanup 금지), 상품 목록
상단의 숫자 이름(정렬 = product-owner 결정), 그리고 **연결 전 첫 화면은 이 org에서 관찰 불가**
— 세 채널이 이미 연결돼 있다; 다만 미연결 시 카페24 7단계 튜토리얼로 가는 경로는 코드에서 확인했다) ·
**`docs/executive_ux_redesign_v1.md`** (Executive-friendly UX Redesign v1 — Demo UX Polish v1 위에서
**정보 위계**를 다시 정한 `frontend/` 전용 재설계. 기준 사용자는 40~50대 비기술 판매회사 대표이고,
합격선은 「30초 안에 지금 상황·문제·AI가 한 일·내가 누를 것이 보이는가」다. 설치된 `ui-ux-pro-max`
skill을 먼저 썼고 — 그 `--design-system` 출력(랜딩 패턴 · Exaggerated Minimalism · Fira Code · 새
accent)은 이 제품에 맞지 않아 **채택하지 않았으며** 채택한 것은 `--domain ux` 가이드라인이다.
홈은 영역 **둘**이 된다: 일이 기다리는 숫자 **셋**(주문·미답변 문의·부정 리뷰, 나머지 셋은 조용한 한
줄)과 「AI가 먼저 확인한 일」의 **카드 그 자체**(1건 있다는 배너가 아니라) — `†` 각주와 그 범례는
「최신 수집 확인 안 됨」 네 단어로, 행마다 반복되던 [AI에게 묻기] ×3은 제거. 문의는 모양이 **둘**이다
— 행 미선택이면 목록이 화면이고, 행을 고르면 `[목록 340px | 상세 나머지]`가 되며 필터 11칩은 접히고
「왼쪽 목록에서 항목을 고르면…」 빈 패널은 사라진다; 목록 열이 자체 스크롤을 가져 `/inquiries/{id}`
문서 높이가 **11,580 → 1,215px**. 문의 상세는 고객의 문장과 초안이 가장 큰 활자가 되고, 근거는 기본
**접힘**(요약 「AI가 확인한 내용 · 상품 정보 1개」)이며 `locator` 같은 chunk 주소는 화면에서 **완전히
제거**, primary CTA는 자기 줄을 갖는다. **되돌린 것 하나 — 「상품 미지정」**: 없애는 편이 깔끔했지만
상품 부재는 초안이 근거를 못 가진 **이유**이고 그것을 설명하는 gap 줄은 초안 생성 전에는 없다.
에이전트의 두 번째 워크플로(「문의 답변 초안」 섹션)는 프롬프트 아래 보조 버튼으로 접혔고 「외부 발송
없음」 보증은 그 버튼에 붙어 유지된다. 카페24 튜토리얼 문구에서 자격 증명·매핑·리디렉션·스코프·동기화가
빠졌다. 가독성은 토큰 **둘** — `muted` `#6B7684`(canvas 위 **4.19:1**, AA 미달) → `#4E5968`(6.34:1),
`sm` 14/1.43 → 15/1.6, `xs` 12 → 13px. 새 서체·새 팔레트·새 컴포넌트 라이브러리 **0**, backend 무변경,
마켓플레이스 호출 0 · DB 변경 0 ⇒ evidence 행 없음. **고치지 않고 보고한 것**: 합성 행의
`data_origin='REAL'`, 상품 화면이 「이 상품에서 무엇이 반복되나」에 답하려면 **새 metric**이 필요하다는
것, 그리고 연결 전 첫 화면은 이 org에서 여전히 관찰 불가) ·
**`docs/executive_readiness_fix_v1.md`** (Executive Readiness Fix v1 — Adversarial UX Review v1(구현자가
자기 작업을 공격적으로 재검수한 pass: 구현 배경을 주지 않은 fresh reviewer 3인이 스크린샷만 보고
읽었고, 그들이 말한 것은 DOM 측정으로 대조해 **오독 1건은 폐기**했다)이 낸 `NOT_EXECUTIVE_READY`의
**데모 blocker만** 닫은 `frontend/` 전용 패키지. 기능 추가 0, backend 무변경. **감사 먼저 —
세 「모순」은 값이 아니라 라벨의 문제였다**: 매출·주문·문의·리뷰는 window 집계이고 **미답변 문의는
`unansweredNow`로 기간이 없으며**, 인사이트의 부정 리뷰·반복 문제는 **전체 기간**이다. 그래서 backend
숫자는 하나도 바꾸지 않고 표시층만 고쳤고, 구분은 열거가 아니라 **`comparable`에서 파생**한다(나중에
추가될 KPI도 목록 수정 없이 맞게 표시된다) — `최근 7일 주문` · **`현재 미답변 문의`** ·
`최근 7일 신규 문의`, 채널표의 `2 / 26` 한 칸은 **「문의」·「현재 미답변」 두 열**로 쪼갰고, 홈의
`INQUIRY_BACKLOG` 행은 바로 위 카드와 같은 소스·같은 숫자라 **홈에서만** 뺐다(문의 화면은 계속 들고
있다). **문의 상세의 fold**: 「초안 복사」가 y=901·fold 900이었고 125%에서 181px 아래였다 — sticky로
고정해 봤으나 **199px 막대가 초안 본문을 덮어 철회**했고, 채택한 것은 복사 컨트롤을 **초안 카드
헤더**로 옮기는 것이다(등록 가능한 채널에서는 「답변 보내기」가 여전히 아래에서 확인 단계와 함께
primary — 유일한 비가역 컨트롤을 보낼 텍스트 옆에 두지 않는다). 100%에서 질문·근거·초안·CTA 전부
보이고, **125%에서는 초안 본문 첫 줄까지** — 나머지는 콘텐츠 길이의 문제라 정직하게 남겼다. **대비는
실측으로 AA green**(7 route 전 텍스트 노드 위반 0): `.btn-primary` 3.71→5.41(58곳, Agent 주 CTA와
온보딩 전부 — 직전 패키지는 `Btn` 프리미티브만 고쳤다), `warn` 4.39→6.20, `good` 4.00→5.55 — 둘 다
평범한 표면에서는 통과하고 **자기 tint 위에서만** 떨어졌다. 어포던스는 `Disclosure`(그려진 셰브론),
클릭 가능한 KPI의 셰브론, disabled primary의 중립화. 리뷰는 「정렬」·「보기」 라벨과 「이 18건만 보기」,
「수집 기록 없음」→「마지막 수집 시각 기록 없음」. 「연결 확인 3」의 알림은 **실재하므로**(REPEATED_FAILURE
3건) 죽이지 않고 **「연결 문제 3건」**으로 이름을 붙였다. **하지 않고 보고한 것**: 데모 hero의
「연동 테스트」는 `proactive_case`에 provenance 열이 없고 그 문의의 `data_origin`이 **`REAL`**이며(운영자가
올린 진짜 게시글) **열린 케이스가 그것 하나뿐**이라 제외하면 「AI가 먼저 확인한 일」이 사라진다 —
새 classifier를 만들지 말라는 지시대로 만들지 않았고 **product-owner 결정**으로 올린다. 상품 화면·
온보딩·합성 데이터 cleanup은 지시대로 무변경. 171 파일 / 2,321 테스트 / 실패 0, 마켓플레이스 호출 0 ·
DB 변경 0 ⇒ evidence 행 없음) ·
**`docs/core_daily_loop_ux_v1.md`** (Core Daily Loop UX Integration v1 — 새 기능 **0**. 이미 구현된
층들(문의 work item · 상품/주문 근거 · Product Knowledge · Knowledge Gap · 세 answer state ·
Organization Answer Style · Human Approval)을 **판매자 하루 하나의 loop**로 잇고 데모를 막는 gap만
닫는다. **`style/v3`은 identity가 아니었다** — `v3`은 그 org의 저장 카운터라 서로 다른 회사가 같은
문자열을 찍고, 바꿨다 되돌린 회사가 같은 프로필을 `v5`로 찍었다 ⇒ `AnswerStyleProfile.digest()`(정규화
프로필의 SHA-256 12자리)로 **`style/v3@8f1c0a2b4d6e`**; 같은 말투는 같게·다른 말투는 다르게 찍히고
필드는 라벨·구분자로 나뉘어 텍스트를 옮겨 붙여도 충돌하지 않는다. **프로필 없음 = `style/default`**
(digest 없음 — 설정한 적 없는 회사와 기본값을 저장한 회사는 다른 사실이다). digest는 **snapshot이
아니다**: 판매자 문장은 단방향으로만 들어가 고객·판매자 문장의 두 번째 사본이 생기지 않는다. 필요한
schema는 **한 줄**(V81 `model_version` 120→200) — 측정된 stamp가 115자이고 더 긴 벤더 모델 id에서
넘치며, **넘치는 provenance의 수리는 자르는 것이 아니다**. **`SELLER_APPROVED_FALLBACK`은 AI 초안이
아니다** — `author_kind`를 읽는 production 코드는 **없고**(docs only), 술어 `<> 'SELLER'`가 모델이 쓰지
않은 문장을 「AI 초안 그대로 승인」에 넣고 있었다(채택률을 **올리는 쪽으로** 틀리는 오류) ⇒ `= 'MODEL'`,
유예는 분자·분모 어디에도 없이 `approved_deferral`로 따로 센다. **제품명은 reviewnary** — 내부
이름(패키지·env·클래스·DB·connector id)은 **하나도** 바꾸지 않고 화면 문자열 **50곳/31파일**만 옮겼다;
남긴 **150곳/39파일**(연결·온보딩·Action Window·도우미)은 브랜드가 아니라 **사실** 때문이다 —
「SellerOps 도우미」는 판매자가 자기 컴퓨터에서 찾아야 하는 프로그램의 이름이고 이 저장소는 설치된
애플리케이션이 무엇으로 보이는지 확인할 수 없다(다음 패키지가 관측 후 함께 옮긴다). `productName.test.ts`가
예외 밖 노출 0과 예외의 **개수**를 고정한다. **본체는 세 answer state다** — 백엔드는 오래전부터 셋을
갖고 있었고 화면은 하나만 그렸다: `GROUNDED`가 실패와 **같은 주황 경고 띠**로 발표됐고,
`NEEDS_CLARIFICATION`은 **아무 데도 그려지지 않아**(`answerBasisAction`이 null, `answerBasisNote`는 렌더
site 없음) 판매자가 「규격을 알려주시면」이라는 **되묻는 초안**을 *답이 짧게 나온 것*으로 읽고 보냈다 ⇒
`AnswerStateCard` 하나가 세 모양을 그리고 **문장은 백엔드의 것**이며 화면은 테두리·순서·컨트롤만 정한다;
**good은 GROUNDED 하나뿐**(되묻기는 정확한 답변이면서 여전히 눈을 요구한다), 대비 실측 ink 13.98 ·
muted 6.00 · good 5.97. **reload에서는 상태를 주장하지 않는다** — 저장된 행은 「어떤 지식이 있었나」를
들 뿐 「고객이 규격을 밝혔나」를 들지 않으므로 되묻는 초안을 GROUNDED로 표시하는 것은 이 화면이 막으려는
자신 있는 오답이다(남은 한계). knowledge gap loop는 끝이 침묵이었다 ⇒ 「저장했습니다 · 다시 만들었습니다」
**두 사실만** 말하고 결과는 카드가 말하며, 저장한 문장이 사는 곳으로 가는 최소 경로가 열린다. §11 중복
제거: 같은 사실을 세 번 말하던 knowledge note는 카드가 있는 동안 렌더하지 않고(그 긴 형태는 **이 화면에
없는 인용**을 가리켰다), 테마에 없어 CSS가 생성되지 않던 색 토큰 3종 교체, Agent 근거 줄에서 내부
evidence id와 provenance 문자열 제거. **bounded model proof 2회**(합성 fixture · 마켓플레이스 0 · DB 0):
사실은 그대로고 인사·길이·말투만 움직였다. **Demo Org 감사는 읽기 전용**이고 숫자는 서로 모순이 아니다
(KPI 30 = 채널표 합) — 다만 **틀린 seller-facing 숫자 둘을 고치지 않고 보고**한다: KPI가 합성 행 8건을
세어 22→30(`countByStatus`에 `data_origin` 없음 · 숫자 변경은 product-owner 결정), 그리고 채널에서 이미
답변된 `PROPOSED` 1건이 작업 큐에 남음(전송 CTA는 꺼져 있고 다음 수집에서 self-heal). 마켓플레이스 호출
**0** · 마켓플레이스 WRITE **0** · DB 변경 **0**).

**`docs/agent_command_center_v1.md`** (Agent Command Center v1 — 제품 방향 수정: reviewnary는
Dashboard-first + Agent assistant가 아니라 **Agent-first + structured operational workspace**,
정확히는 **chat-first, object-backed**. Chat은 의도를 나르고 일은 그 일을 이미 소유한 구조화된 UI가
보여준다. 직전 패키지가 **고치지 않고 보고했던 숫자 둘을 닫았다**: (1) 홈 미답변 KPI가 합성 8건을
세어 22→30이던 것 — 행은 버그가 아니었다(`sellerops.seed.demo-content`는 데모가 데모 대시보드를
보여주라는 뜻이고 그 스위치는 그대로다), 틀린 것은 그 스위치가 **어느 숫자에 닿아도 되는가**였다:
합성 행은 가게가 한 일의 차트에 나올 수 있어도 **판매자가 답변을 빚졌다고 말하는 숫자**에는 나올 수
없다 — 이 규칙은 이미 `InquiryWorkItemWriter`와 `InquiryQueueService`에 두 번 있었고
(「Operational means REAL」) 여기서 정의 하나(`countUnansweredOperational`)를 얻어 홈과 문의가 같은
문장을 말한다; coverage **상태**는 여전히 저장된 전 행을 세므로(합성만 있는 채널의 수집 판정이 뒤집히지
않는다) 좁아진 것은 「기다리는 수」 한쪽뿐이다. (2) 채널에서 이미 답변된 `PROPOSED` 1건 —
`stillWaiting`은 **`OPEN`/`PROPOSED`에서만** 떨어뜨린다(`COMPLETED`·`EXECUTED`의 문의는 정의상
답변돼 있어 무조건 술어는 바로 그 탭을 비운다); 쓰지 않고 `reconcileConnectorAnswered`가 계속 소유한다.
(3) 프로액티브 케이스 둘이 **둘 다 끝난 일**을 가리키던 것은 `STILL_WAITING` 술어(subject는 REAL·ACTIVE·
UNANSWERED, work item은 `AWAITING_SELLER`)로 **쿼리 단계에서 추천에서만** 빠진다 — status는 여전히
reconciler만 쓰고 cleanup 아키텍처는 0. 그 결과 「AI가 먼저 확인한 일」이 Demo Org에서 **비었고**,
채우려면 실제 고객 문의에 모델을 부르는 tick이 필요하므로 **product-owner 결정**으로 올린다.
**세 answer state가 reload를 넘긴다** — 감사 결과 가장 가까운 seam은 `inquiry_reply_draft`였고 필요한
것은 **칸 하나**(V82 `answer_basis`, nullable, backfill 0, append-only 유지): `knowledge_state`로는
파생 불가하다(GROUNDED와 NEEDS_CLARIFICATION은 둘 다 `knowledge_state=GROUNDED`이고 가르는 것은
**고객이 규격을 밝혔는가**라는 질문에 대한 사실이라 이 표에 없다). 마이그레이션 이전 버전은 **아무것도
주장하지 않는다**; reload의 action 줄은 고객의 명사를 인용하지 않는 **일반 문장**이다(그 단어는 저장돼
있지 않고 되살리려면 고객 메시지를 다시 읽어야 한다). `NO_ANSWER_BASIS`는 초안을 쓰지 않으므로 찍을 행이
없다 — 재계산은 **모델 0회**라 버튼으로 남긴다. **홈 IA는 브리핑 → 숫자 → 물어보기 → 참고**이고 대시보드
데이터는 버리지 않고 **제목 아래로 내려갔다**; 기간 버튼은 페이지 헤더(화면 첫 채워진 버튼, 900px 아래
섹션의 필터)에서 「숫자」 헤더로 옮겼다. 인사말은 **산술**이다 — 아래 렌더된 객체 수의 결정론적 함수이고
이 화면에서 **모델은 호출되지 않는다**(AI 예산이 떨어져도 대시보드는 돈다); 0은 「0개 있습니다」가 아니라
자기 문장을 갖는다. 브리핑 카드 프레임워크는 **새로 만들지 않았다** — 준비된 초안은 work queue rows,
「AI가 먼저 확인한 일」은 기존 섹션, findings는 `InsightList` 그대로이고 `ProactiveCases`는 prop 하나
(`onLoaded`)만 얻어 인사말이 **재조회가 아니라 렌더된 것**을 센다. **command box는 planner가 아니라
palette다** — 이것은 취향이 아니라 계약이다(`sellerops_operator_graph_v2.md`: Agent run의 계획은 LLM
planner가 세우거나 run이 실패하며 결정론 keyword planner는 fallback으로도 없다): 인식된 문장은 **이미
있는 workspace object**로 해석되고(도구를 고르지 않고 근거를 주장하지 않으며 보여주는 객체에서 읽지
않은 사실을 말하지 않는다), 인식되지 않은 문장은 `/agent`로 **그대로** 넘어가 planner가 계획하거나 오늘과
똑같이 실패한다. 매칭은 명사 + 「보여/알려/목록…」을 함께 요구할 만큼 **좁고**(「3호 몰딩 문의가 몇
건이야」는 넘어간다) 칩이 지원 집합을 보이게 한다. 결과는 **산문이 아니라 객체**이고 문의 객체의 숫자는
홈의 KPI를 내려받는다(두 번 읽으면 6인치 위 카드와 어긋날 기회가 두 번이다); 리뷰는 고객 기억 화면의
`IssueList`를 **그대로** 쓴다. context seam(§8)은 **이미 있었다** — `agentContext`가
`{goal, productId, channelCode, surface}`를 나르고 5개 화면이 제공하므로 새 계약 0. 승인 경계 무변경:
`CommandInput`에 write 호출이 없고 「답변 보내줘」는 `confirmInquiryPublish`를 부르지 않고 Agent로 간다.
`docs/reviewnary_design.md`가 타이포·간격·표면·CTA·상태색·브리핑·객체 카드·근거 공개·빈/로딩/오류·접근성·
반응형을 적되 **토큰 마이그레이션·새 팔레트·새 서체·컴포넌트 라이브러리 0**. 시각 QA는 실제 브라우저
(Playwright 1440×900@2×): 홈·명령 결과·스타일 설정은 **라이브 Demo Org 읽기 전용**, 문의 세 상태는
**합성 fixture**(라이브 렌더는 실제 고객 문의에 초안을 생성하는 일이다) — 7화면 전부 **AA 위반 0**(틴트
위 합성 계산) · 가로 스크롤 0 · 콘솔 오류 0 · locator 노출 0. V82는 커넥터·스케줄러·프로액티브·초안을
끈 채 실제 로컬 DB에 적용(8ms, 기동 6.03초, 채널·모델 참조 0, ERROR/WARN 0, 기존 초안 11/11 null).
**마켓플레이스 호출 0 · 마켓플레이스 WRITE 0 · 모델 호출 0 · DB 행 변경 0** ⇒ evidence 행 없음.
**고치지 않고 보고한 것**: 빈 프로액티브 섹션, `NO_ANSWER_BASIS` reload, `totalElements`가 읽기 필터를
따라오지 않는 것(기존 성질), window 지표의 데모 행 포함(스위치의 의미이므로 product-owner 결정),
스타일 설정 저장 버튼 fold 아래, 그리고 Agent 자유문장 lane 자체는 agent-runtime 미기동으로 미실행).

**`docs/chat_first_agent_shell_v1.md`** (Chat-first Agent Shell Completion v1 — Agent Command Center
v1이 정한 모양을 마감하고, **처음으로 실제 문장 하나를 끝까지 통과시켰다**. 스키마 변경 **0**.
**홈 위계**: 명령 입력이 여섯 칸 숫자 그리드 **아래** y≈1,010에 있었다 — 1440×900에서 fold 110px 아래,
125%에서 290px 아래. chat-first 제품의 chat 진입점이 스크롤해야 보이면 그것은 chat-first가 아니다 ⇒
**브리핑 → 물어보기 → 준비된 일 → 숫자 → 참고**이고 입력은 `AgentBriefing`의 **슬롯**이다(인사말은
자기가 그리는 객체 수의 산술이고 입력은 그 객체가 아니다). 실측 briefing 180 · command **239** ·
숫자 760, 900/720 fold **둘 다 위**. 입력은 **작다** — 뷰포트만 한 빈 텍스트 상자는 브리핑과 일 양쪽의
나쁜 버전이다. **합성 데이터 계약**: window 지표가
`(:syntheticVisible = true or data_origin='REAL')`로 계산되고 있었다 ⇒ 규칙에 이름을 붙였다
(`fallBackToExampleData`) — **A** 판매자 지표는 판매자 행으로, **B** 데모 콘텐츠를 켠 배포에서 실제
window가 **완전히 비었을 때만** 시드 corpus를 쓰고 그때는 `exampleDataIncluded`가 화면에 라벨을 강제한다,
그리고 **섞는 분기는 없다**(90%가 진짜인 합계는 라벨이 정직하게 설명할 수 없는 유일한 모양이다). B는 A를
무조건 적용해도 안전하게 만드는 장치다. 이 배포에서는 시드 행이 7/14/30일 창 **밖**이라 숫자가 하나도
움직이지 않았다 — 오늘 데이터에 대한 사실이지 규칙을 안 적는 이유가 아니다. **§3-C가 실제로 물었다**:
홈 브리핑의 「{상품} 부정 리뷰 N건」은 리뷰 **행** 수여서, 고치기 전 1·2위가 **바닥용 평면 몰딩 4건**과
**선바로 광폭 케이블 몰딩 4건** — **둘 다 DEMO_SEED 100%**였다. 즉 화면이 만들어 낸 상품을 만들어 낸
리뷰로 판매자의 최악 상품이라고 날짜 범위까지 붙여 부르고 있었다 ⇒ 필터 한 줄, 리뷰 화면·이슈 추출기·
근거는 무변경. 「반복되는 리뷰 문제 19건」은 **이슈** 수이고 19건 전부 REAL 근거를 하나 이상 가져 참이라
**고치지 않고 보고**한다(그중 1건은 근거가 8 REAL + 11 DEMO_SEED로 섞여 있다). **`totalElements`**:
answered-elsewhere 술어가 직전 패키지에서 fetch된 페이지 위 Java 필터였다 — 행은 맞고 total은 방금
버린 행을 세고 있었다 ⇒ 술어를 그대로 쿼리로 옮겼고(`OPEN`/`PROPOSED`에서만; `COMPLETED`·`EXECUTED`는
정의상 답변된 문의를 들어 무조건 술어는 그 탭을 비운다) 남은 Java 필터는 null 가드뿐이다. **명령
팔레트는 그대로**이고 recognised 문장은 `navigate` **0회**·run **0**(§14-E). **자유문장 lane 감사 —
빠진 protocol 없음**: `OperatorAnswer`가 이미 `findings[].surfaceLink`·`evidence[].locator`
(`productId`/`productName`/`label`/`count`)·`nextActions[].surfaceLink`를 들고 있다. **실제 gap은
프론트에 하나**였다(§9). **bounded free-text proof LIVE**: 「최근에 반복해서 문제가 생기는 상품이
있어?」를 홈 명령 상자에 쳐서 `/agent`로 넘긴 뒤 실행 — 플래너 **LLM 1회**, tool **10회**(전부 READ,
전부 로컬 보유 행), findings 10 전부 `SUPPORTED`, `stopReason: COMPLETE`, **마켓플레이스 호출 0 ·
DB 쓰기 0**(주문·문의·리뷰 구성이 전후 바이트 동일), 스케줄러·프로액티브·self-pilot·커넥터 전부 OFF.
답변은 묻지도 않았는데 자기 한계를 밝혔다 — 「…나머지는 확인하지 않았으므로 전체 순위가 아닙니다」.
**object-backed result**: `lib/answerObjects.ts`가 답변 **자신의 근거**를 상품별로 묶어
「이 답변이 가리키는 상품 N개」 + 사실 + `/products/{id}` 「확인하기」를 그린다 — 파생 0, **두 카운트를
더하지 않는다**(「리뷰 3」과 「문의 2」는 사실 둘이고 「관련 5건」은 아무도 읽지 않은 셋째다), org 범위
답변은 빈 객체가 아니라 **객체 없음**. 새 Agent Object Protocol·새 컴포넌트 0. **§9 gap은 진짜였고
닫혔다**: `agentContext`가 `productId`를 URL까지 날랐지만 `Agent.tsx`가 `goalText`만 보내
**id가 요청 경계에서 죽고 있었다** — 안 보인 이유는 링크를 주는 화면들이 제안 문장에 상품 **이름**을
같이 써서 플래너가 이름으로 풀었기 때문이고, 판매자가 낸 비용은 resolve 호출과 **이미 보고 있는 상품을
계속 설명해야 하는 의무**였다(「이 상품만 봐줘」는 작동할 수 없었다). 최소 계약만: `StartRunRequest.
productId` → zod → `GoalRequest.productId` → `OperatorAgentRuntime.contextEntities`가 **org 범위 READ
1회**로 검증해 기존 `entities` 상태에 **검증된** `ResolvedEntity`로 심는다(`productOps`가 이미 읽는
`already?.id` 자리). **hint는 fact가 아니다** — URL의 id는 행의 존재도, 이 org의 것인지도, 이름도
증명하지 않으므로 읽기 한 번이 셋을 한꺼번에 답하고, 그래서 하류의 `EvidenceScope` 불변식은 묻던 질문을
그대로 묻는다; 호출은 예산에 청구되고 실패는 **침묵**이다. **접근성 — 실측으로 하나 찾아 고쳤다**:
primary CTA의 **hover**가 `bg-brand-600` 흰 글씨 **4.49:1**로 AA를 백분의 일 차이로 놓치고 있었다 —
제품에서 가장 많이 눌리는 컨트롤이고, 커서가 올라가 있는 그 상태가 바로 라벨을 읽는 상태다 ⇒ **hover는
밝아지지 않고 어두워진다**(`brand-800` `#1550B5`, **7.38:1**); 기존 brand 램프에 토큰 **하나**, 호출부
5곳. 홈 전 텍스트 노드 AA 위반 **0**(틴트 위 합성), 가로 스크롤 0, 콘솔 오류 0. **고치지 않고 보고한
것**: 레거시 Action Window·리뷰 임포트 18곳의 `bg-brand`(**3.71:1**, hover가 아니라 평상시 — 토큰
마이그레이션은 이 패키지 금지), 플래너 22초 동안 화면은 「확인하는 중…」뿐, `NO_ANSWER_BASIS` reload,
상품 목록 첫 행이 「(미지정 상품)」이라 그 화면의 Agent 링크 문장도 그렇게 읽히는 것, 섞인 근거 이슈 1건,
그리고 자유문장 lane은 여전히 **agent-runtime 별도 기동**이 필요하다는 것. **마켓플레이스 호출 0 ·
마켓플레이스 WRITE 0 · DB 행 변경 0 · 마이그레이션 0 · 모델 호출 1** ⇒ evidence 행 없음).

**`docs/disconnected_channel_onboarding_v1.md`** (Disconnected Channel Onboarding Live Walkthrough v1 —
「연결했습니다」에서 「reviewnary가 내 판매 운영을 이해하기 시작했습니다」까지. `frontend/` 전용 · backend
무변경 · 마켓플레이스 호출 **0** · 모델 호출 **0** · 마이그레이션 **0**. **감사 결과 기계는 이미 다
있었고 그 위에 서 있는 것이 없었다** — `ChannelCoverageRow`가 채널×데이터타입별로 `state`·`rows`·
`openRows`를 이미 들고 있고 `ChannelDataState`는 §7이 요구한 구분(`ZERO` ≠ `OBSERVED_FRESHNESS_UNPROVEN`
≠ `BLOCKED` ≠ `NOT_SUPPORTED` ≠ `NOT_CONNECTED`)을 몇 달 전에 자기 docblock에 적어 두었는데,
`GET /api/channels/coverage`는 **프론트 소비자가 0**이었다. 그래서 새 백엔드·새 enum·새 엔드포인트
**0**. 세 채널의 완료 화면은 전부 같은 모양으로 끝나고 있었다 — 연결 상태 + 마지막 성공 수집, 그리고
primary CTA가 `/orders`·`/settings/channels`·`/settings/review-import`, 즉 **우리 배관에 대한 사실 넷과
가게에 대한 사실 0개**, 그리고 방금 가게를 연결한 판매자를 연결할 것들의 목록으로 돌려보냄. **상태가
문장을 정하고 실행이 숫자를 정한다**(`lib/firstSourceSummary.ts`): 숫자는 절대 `rows`에서 오지 않고
(그것은 시드 행을 포함하며 「가져왔습니다」 아래의 숫자는 시드를 담을 수 **없어야** 한다) 종료된
`SyncRunView.successRows`에서 온다. 동사는 **관측이 고쳤다** — 처음에 쓴 「확인했습니다」는 채널이 무엇을
**가지고 있는가**에 대한 주장이라, 실제 Demo Org 쿠팡 연결에 대해 렌더하니 문의 2건을 보유한 org에
**「문의 0건을 확인했습니다」**를 찍었다(`successRows`는 *이번 실행*이 가져온 수이고 재방문에서는 다른
숫자다) ⇒ 「가져왔습니다」는 두 읽기에서 모두 참이고, 0을 가져온 실행은 자기 줄을 가져 「문의가
없습니다」로 승격되지 **않는다**(그 문장은 `ZERO`만 말할 수 있다). 두 숫자를 **더하지 않는다**. 카드는
세 여정 모두의 끝이 되고 유일한 primary는 **「오늘 할 일 확인하기」 → `/`**이며 — 브리핑과 명령 상자가
이미 거기 산다(§9에 새 화면 0) — 채널을 부르지도 실행을 시작하지도 않는다(「완료」가 아직 일어나는 일의
이름이 되면 안 된다). **이 패키지의 본체는 disconnected 홈이다**: 가입 2분 된 판매자가 0건 셋과 전부 0인
7행 표 셋 위에서 「지금 먼저 확인할 일은 없습니다」를 읽고 있었다 — **산술적으로 맞고 운영적으로
거짓**이며, 할 일은 하나 있고 그것이 전부인데 화면에 없었다. 앞선 두 패키지가 「연결 전 첫 화면은 이
org에서 관찰 불가」로 적어 둔 바로 그것이 **전용 disconnected org를 만들자마자 관찰됐다**. 이제 연결이
하나도 없는 동안 인사말은 **세는 것을 멈추고**(네 번째 그룹도 플래그도 아니다 — 첫 연결 전에는 기다리는
일의 수가 아직 사실이 아니라 읽기의 부재다) 「판매 채널을 연결하면 시작할 수 있습니다」와 버튼 하나를
말하며, 연결이 하나 생기면 **저절로** 사라진다. 실패한 읽기는 `null`이지 `false`가 **아니다** — 멀쩡히
연결된 판매자에게 연결이 없다고 말하는 것은 이 화면이 장애를 발명하는 일이고 판매자가 확인할 수 없는
유일한 오류다. CTA y=**266**, 900과 1152×720(125% 등가) **둘 다 fold 위**. **§11**: `/agent`는
`/capabilities`를 mount에 부르고 그 답을 **버리고 있었다** — 런타임이 죽어도 상자는 활성이고 판매자는
치고 누르고 기다린 뒤 실패를 읽었다 ⇒ 이유는 상자 **위**에 렌더되고(처음엔 입력과 계정 선택 **아래**에
붙어 죽은 컨트롤을 먼저 만났다) 컨트롤은 비활성이며 페이지가 이미 아는 것을 알아내려고 run을 시작하지
않는다; 문구는 **「채널 연결과는 관계없는 문제입니다」**이지 「채널 연결에는 문제가 없습니다」가 아니다
(연결이 하나도 없는 org에서 그 문장은 거짓이고, 이 알림은 판매자의 채널에 대해 의견을 가질 자격이
없다). **§12**: 플래너 호출은 **블로킹 HTTP 한 번**이고 `trail`은 답과 **함께** 오며 응답 전에는 thread
id가 없어 `getRun` 폴링도 불가 ⇒ 단계별 진행은 **새 프로토콜**(id-first start 또는 SSE)이 필요하므로
만들지 않고 보고한다; 프로토콜 없이 실은 것은 사실 하나 — 「보통 20초쯤 걸립니다 · N초 경과」(측정된
시계이고 막대나 단계 목록은 아무도 재지 않은 것의 애니메이션이다). **대비**: 온보딩 경로의 첫 화면에서
둘 발견 — 카페24 튜토리얼 **활성** 단계 칩 `text-brand` on `bg-brand/15` **2.85:1**, 쿠팡 스테퍼 배지
`bg-brand` + 흰 글씨 **3.71:1**. 카페24에 `brand-700`을 먼저 넣었더니 그 틴트 위에서 **4.16:1**로
여전히 미달 — **색은 흰 배경이 아니라 그것이 놓이는 표면에서 확인해야 한다**(⇒ `brand-800`). **§1**:
전용 disconnected org는 제품 자신의 `POST /api/auth/signup`으로 만들었다(`AuthService.signup`은 계정 0의
Organization을 만들고 `MockDataSeeder`는 `organizations.count()==0`에서만 돈다) — 실측 신규 org
accounts/inquiries/reviews **0/0/0**, canonical Demo Org **4/3,355/4,551 무변경**, 가짜 marketplace 성공
state **0**, 폼에 비밀번호 입력 **0**(가입 응답의 JWT를 주입). **§13 helper naming — 브랜드 불일치가
아니었다**: 실제 실행 파일·번들·인스톨러가 **없고**(`npx tsx collector/src/cli/local-agent.ts`), OS가
보여주는 것은 launchd 사용자 에이전트 **`ai.sellerops.local-agent`** 하나이며 Dock 아이콘도 창도 없다.
즉 화면은 판매자가 **구할 수도 설치할 수도 실행할 수도 없는** 프로그램의 이름을 부르고 방법은 말하지
않는다 — 「SellerOps 도우미」→「reviewnary 도우미」 rename은 그 지시를 똑같이 따를 수 없게 두면서 지원
담당자가 grep할 launchd label과 일치하는 유일한 문자열만 지운다 ⇒ **이름 붙일 것이 생기기 전에는 rename
하지 않는다**(이번 패키지 rename **0**, 마이그레이션 순서만 기록). **§10**: agent-runtime에는 lifecycle
owner가 **있다** — `docker-compose.yml`의 서비스(`depends_on: backend healthy`, frontend가 그것에
의존)라 `docker compose up`이 넷을 함께 띄운다; 8787을 따로 띄우는 것은 **우리 로컬 dev 경로의 성질**이지
패키징의 성질이 아니므로 packaging architecture **0**. **§14 PRIMARY = 카페24**(판매자가 낼 것이 mall
id 하나 · 로컬 도우미 **불필요** · 인가 전체가 **철회 가능한 동의** — NAVER는 스토어당 앱 1개에 삭제
불가라 되돌릴 수 없는 쪽이 가장 크고 쿠팡은 키 발급 + 호출 IP 등록이다). **라이브 walkthrough는 실행하지
않았고 막은 것은 승인이 아니다** — §1의 「기존 seller account와 충돌 0」을 지키려면 어느 mall을 쓸지가
정해져야 하는데, 쓸 수 있는 카페24 mall은 canonical Demo Org에 이미 연결된 그것뿐이고 같은 (app, mall)에
대한 두 번째 OAuth 승인이 기존 refresh token을 살려 두는지는 **이 저장소에서 증명할 수 없는 벤더
동작**이다; 틀리면 모든 문의 lane `LIVE_VERIFIED` 증명이 서 있는 그 연결이 끊긴다 ⇒ **product-owner
결정**으로 올리고 bounded manifest는 §9에 미리 써 두었다. 브라우저 walkthrough 8화면(1440×900@2×,
off-host 요청 **0** — 리스너로 단언), AA 텍스트 노드 위반 **0**, 가로 스크롤 0. **고치지 않고 보고한
것**: disconnected 홈의 0 벽(숨기는 것은 Home redesign), 새 org에서 경고색으로 렌더되는 「채널 3곳이 이
숫자에 없습니다」, 연결 문구에 남은 「SellerOps」, `/settings/channels` 레거시 홉, NAVER·쿠팡이 도우미
경로를 기본으로 제시하는 것, 단계별 플래너 진행에 필요한 새 프로토콜, 그리고 **NAVER 완료 화면은
라이브 렌더 없음**(연결된 계정에서 `/connect/naver`는 NAVER 연결 테스트를 부른다) ⇒ evidence 행 없음).

**`docs/pilot_readiness_gate_v1.md`** (Pilot Readiness Gate v1 — feature package가 아니라 질문 하나다:
**첫 외부 판매자가 혼자 시작할 수 있는가.** product-owner 결정으로 **별도 Cafe24 mall이 없으므로** Demo Org의
연결은 **보존**되고 재-OAuth·재연결은 하지 않는다 ⇒ Disconnected Channel Onboarding v1은
**OFFLINE/UX_PROOF = PASS · FRESH_ACCOUNT_LIVE_PROOF = `UNPROVEN_BY_NO_SAFE_TEST_ACCOUNT`**로 정직하게
닫고, **첫 실제 판매자의 첫 연결이 production live onboarding proof**가 된다(§7이 그 재사용 가능한
manifest — 계정·mall id·credential·IP 값은 저장소에 넣지 않는다). **P0 다섯**: (1) 빈 DB로 뜨는 배포가
`demo@sellerops.ai`/`demo1234`를 **항상** 만들고 로그인 헤더의 「데모 화면 보기」가 그 값을 채워 넣는데
`sellerops.seed.enabled`에 **env placeholder가 없어 끌 수 없다**(한 줄 변경이지만 production boot이 무엇을
만드느냐는 product-owner 결정이라 **보고만** 한다); (2) `self-pilot.enabled` 기본 false ⇒ reconciler bean이
없어 **첫 수집 이후 다시 수집되지 않는다**(판매자마다 org UUID를 env에 넣고 재시작해야 하므로
`READY_WITH_OPERATOR`); (3) `docker compose up`은 네 프로세스를 올리지만 커넥터 셋 전부 기본 off·vault는
키 없이 fail-closed·`.env.example`에 그 이름이 **하나도 없어** 채널을 연결할 수 없다; (4) 고정 공인 IPv4와
고정 HTTPS Cafe24 callback이 **미프로비저닝**; (5) 전송 lane은 `TEST_INQUIRY_REQUIRED`라 답변은 판매자가
초안을 복사해 채널에 올린다. **최종 verdict `NOT_PILOT_READY`**. **고친 것은 `frontend/` 첫 사용 경험뿐이고
backend 소스 0 · 마이그레이션 0**: **§3 helper 감사 — 세 채널 모두 도우미는 필수가 아니다**(NAVER는
text로 발급이 끝나고 Coupang은 `guidanceImpossible`이 체크리스트로 자동 낙하하며 Cafe24는 아예 무관) ⇒
`PILOT_BLOCKER`가 아니라 **어느 쪽을 먼저 내미느냐**가 결함이었다. 라이브 측정: `/connect/naver`의 유일한
컨트롤을 누르면 「**내 PC의 SellerOps 도우미를 찾지 못했어요. 도우미를 실행한 뒤 다시 시도해 주세요**」 —
이 저장소에 설치 가능한 아티팩트가 **없는** 프로그램을 실행하라는 지시이고, 빠져나갈 길은 찾을 수 없는
것을 **다시 찾기** 아래의 가장 작은 컨트롤이었다(막다른 길은 아니다: 세 번 눌러 credential 입력에 닿는데
그중 하나는 1분 전에 답한 질문이다). 세 gate 전부 **표시만** 바꿔 도우미 없는 경로가 `btn-primary`가 되고
가이드는 `(도우미 필요)` 라벨의 ghost가 된다 — reducer event·bridge·host·walk·커넥터/auth 아키텍처
**무변경**이고 도우미를 켜 둔 판매자는 여전히 한 번 눌러 같은 walk에 닿는다; 안내가 불가능할 때 **나아갈
길이 멈춘 것보다 위에** 그려진다(`reviewnary_design.md` §10). **한 동작에 이름 하나** — 모든 gate와
fallback에서 「직접 진행하기」이고 옛 라벨을 부르던 문장도 함께 고쳤다(화면에 없는 버튼을 가리키는 문장이
이 패키지가 시작된 결함이다). 테스트는 존재가 아니라 **class**를 고정한다 — 존재는 한 번도 퇴행하지 않았고
prominence가 결함 전부다. **§4 연결 전 경고색**: 홈 KPI 셋이 전부 `text-warn`으로 「채널 3곳이 이 숫자에
없습니다」였다 — 빠졌다고 말하려면 빠질 **총합**이 있어야 하고 첫 연결 전에는 없다(정의상 전부 빠져 있고
맨 위 문장이 이미 그렇게 말한다); 가입 2분 된 계정에서 그것은 화면이 **장애를 발명하는** 일이다 ⇒ 숨기지
않고 더 평범한 사실을 muted로 말한다(**「아직 연결된 채널이 없습니다」**). 신호는 두 번째 조회가 아니라
`hasAnyConnectedChannel(metrics.channels)`로 **파생**하고(6인치 아래 표와 어긋날 기회를 만들지 않는다),
**`NOT_SUPPORTED`는 연결 없음으로 세지 않는다**(리뷰 수집 경로가 없는 연결된 NAVER는 여전히 연결된
NAVER다). **§5**: PRIMARY(카페24) 경로의 `/settings/channels` 레거시 홉 4곳 → `/connect`, 그리고 그 경로에
**「SellerOps」 문구는 없다** — NAVER·쿠팡에 남은 것은 전부 도우미 lane이고 §3이 그것을 primary에서
치웠으므로 이름은 그대로 둔다(가리키는 대상이 이름을 유지하는데 지시만 바꾸는 것이 더 나쁜 결함이다).
**§6 agent-runtime은 lifecycle owner가 있다** — `docker compose up --build`가 넷을 올리고 판매자가 8787을
따로 띄울 일은 없다(`PILOT_BLOCKER` 아님); 없던 것은 launcher가 아니라 **배포 설정**이라 운영자용 실행
절차를 §6-1에 이름만으로 고정했다(값·키·IP는 저장소에 넣지 않는다). 라이브 마켓플레이스 실행 **0** ·
WRITE **0** · 모델 **0** · DB 변경 **0** · 마이그레이션 **0** ⇒ evidence 행 없음).

**`docs/pilot_runtime_foundation_v1.md`** (Pilot Runtime Foundation v1 — Readiness Gate가 찾은 runtime/config
P0을 닫는다. 새 product feature도 UX 패키지도 아니다. **먼저 두 가지 정정**: (1) 직전 보고의
「Inquiry workflow 전송 = BLOCKED / 전송 lane 없음」은 **틀렸다** — 이 저장소의 capability registry docblock과
CLAUDE.md 요약을 **현 커밋에서 재도출하지 않고** 인용했고, 그 뒤에 착지한 라이브 전송 둘을 놓쳤다:
**Cafe24 문의 `VERIFIED`**(2026-08-25 `b0bfb022` — POST 1회·재시도 0, 판정은 2xx가 아니라 exact READ로 자식
존재·부모 일치·답글 구조·**본문 해시 == 승인 초안**·부모 `C`)와 **NAVER 상품 문의 `LIVE_VERIFIED`**(2026-08-26
`692c5a78` — PUT 1회·중복 0, 승인 `mode WRITE max 1` 소진, 판정은 `NaverAnsweredStateReader`의 read-back).
둘 다 **나간 문장은 AI 초안이 아니었다** — v1 `MODEL`은 보존된 채 나가지 않고 판매자가 고쳐 쓴 v2 `SELLER`가
승인·발송·검증 대상이었다. 즉 **capability가 없는 것**과 **파일럿 런타임에서 켜지지 않은 것**은 다르고, 이것은
후자다(채널별 표는 §0-A: **SUPPORTED** Cafe24 문의·NAVER 상품 문의 / **OPERATOR_ASSISTED** NAVER 고객 문의·
Coupang 문의 / **NOT_SUPPORTED** Coupang 리뷰·NAVER 리뷰 직접 전송; 새 marketplace WRITE proof **0**, 기록에서
읽었을 뿐이다). (2) Cafe24 고정 callback도 신규 구축이라 가정하지 않고 감사했다 — `tools/cafe24-callback`은
README가 스스로 「제품 callback이 아니다」라고 적은 dev 수신기로 **code를 교환하지 않으며**, 연결성 결정 문서의
production 항목은 **미프로비저닝**이고 Cafe24 첫 연결 라이브 증명은 **운영자의 공개 터널**로 받았다 ⇒
**새 callback 인프라 금지**이고 필요한 것은 기존 backend 엔드포인트 앞의 **안정적인 공개 HTTPS 호스트 이름**뿐이다
(이름이 고정된 터널도 byte-identical 요건을 만족한다; 일회성 URL은 아니다 — 운영 결정). 목표는
`SELF_SERVE_PRODUCTION_READY`가 아니라 **`OPERATOR_ASSISTED_PILOT_READY`**. **§2 데모 계정 보안**:
`MockDataSeeder`가 기본값 ON인 플래그 하나 뒤에서 서로 다른 일 셋을 하고 있었다 ⇒ 채널 카탈로그(제품 참조
데이터, 이 저장소의 **유일한 `channels` 생산자**, 기본 **true**·멱등) · 데모 조직(비밀번호가 저장소에 적혀 있는
계정, 기본 **false**) · 데모 콘텐츠(기존대로 false)로 쪼갰다. `sellerops.seed.enabled`는 **env placeholder가
없어 끌 수조차 없었다** ⇒ `${SELLEROPS_SEED_ENABLED:false}`. **삭제 0** — true로 두면 예전과 똑같이 시드된다.
로그인의 「데모 화면 보기」는 **URL이 아니라 배포가** 결정한다: `GET /api/auth/demo/config`(불리언 하나, 계정
아님)에 **명시적 true**일 때만 프리필하고 `null`(아직 묻는 중)은 no로 센다 — 느리거나 죽은 백엔드가 「작동하지
않는 입구」를 그리는 상태가 없다. 카탈로그에 **자기 플래그**를 준 이유는 여러 테스트가 `channels` 표를 소유하며
`seed.enabled=false`로 그것을 눌러 왔기 때문이다 — 「데모 데이터 없음」과 「참조 데이터 없음」은 같은 요청이 아니다.
**§3 `.env.example`은 이름만** 담고 목적을 스스로 적는다(「복사하면 바로 안전하게 실행」 — 모든 커넥터 OFF),
compose가 그 이름들을 backend 컨테이너로 통과시킨다. **§4 fail-closed 기동 검증**(`PilotConfigValidator`,
새 config framework 0): 커넥터를 켰는데 vault 마스터 키가 없거나 · NAVER를 켰는데 판매자에게 등록하라고 안내할
고정 호출 IP가 없거나 · Cafe24를 켰는데 앱 자격이 없거나 callback이 **비어 있거나 HTTPS가 아니거나 여전히
로컬 기본값**이면 기동을 거부한다(등록 URI·authorize·토큰 교환이 byte-identical이어야 하고 교환이 바로 이
property를 읽으므로 로컬 기본값은 개발 편의가 아니라 결함이다); **꺼진 커넥터는 아무것도 요구하지 않는다**
(그렇지 않으면 정직한 기본 자세가 기동 불가가 된다). 메시지는 **환경변수 이름만** 싣는다. **§5~§6 정기 수집이
본체다**: 기계는 이미 옳았고 — `SelfPilotReconciler`가 CONNECTED·비파일업로드 계정에 스케줄을 멱등하게
만든다 — 틀린 것은 **scope**였다(`ALLOW_LIST`=env UUID 목록 / `LOCAL_SINGLE_USER`=전체 org이지만 **loopback DB가
아니면 기동 거부**). 파일럿은 둘 다 아니다 ⇒ 세 번째 값 **`CONNECTED_SELLERS`**: 대상은 **DB가 이미 아는 것**
(`select distinct orgId from SellerAccount where CONNECTED and not fileUpload`). **loopback fence가 필요 없다 —
「모든 org」가 아니라 「요청한 org」이기 때문이다**: 계정이 CONNECTED가 되는 유일한 길은 판매자가 OAuth 동의를
마치거나 자격을 입력하는 것이고, **채널을 연결한다는 것이 곧 수집하라는 지시**다. 연결이 없으면 대상도 없고,
마지막 연결이 끊기면 스스로 빠진다 — 두 번째 목록을 맞춰 둘 필요가 없다. 새 job platform·큐·workflow engine
**0**(enum 값 하나 · 쿼리 하나 · 분기 하나). **§7** 수집은 READ 전용이고 single-flight·rate budget·freshness·
cursor 계약 무변경, 한 org의 실패는 다른 org를 멈추지 않는다(이미 있던 성질을 긴 org 목록에 대해 고정). **§8
Proactive는 분리 유지** — 정기 수집을 켜도 켜지지 않는다(자기 flag + 자기 명시 org 목록이고 교집합은 **좁히기만**
한다; `@ConditionalOnProperty`와 두 기본값을 소스·설정에서 확인하는 테스트). 「데이터가 최신으로 유지된다」는
기본이고 「에이전트가 일을 만든다」는 별도 선택이다. **§11 agent-runtime에서 진짜 결함 하나**: `VITE_AGENT_RUNTIME_URL`이
번들에 굽히는데 frontend `Dockerfile`에 **build arg가 없어서** 모든 이미지가 코드 기본값 `http://127.0.0.1:8787`로
굳었다 — 원격 파일럿 호스트에서 그것은 **판매자 자기 컴퓨터**를 가리키고 /agent lane이 전원에게
「AI 도우미를 시작하지 못했습니다」로 실패한다(런타임 설정 실패가 제품 고장의 옷을 입은 것) ⇒ ARG/ENV + compose
build arg, 기본값은 그대로라 로컬 스택 무변경. **§12 운영자 runbook 12단계**(자격 값 0) · **§13 observability는
기존 logs/DB만**(새 플랫폼·표·엔드포인트 0; 로컬 DB에 실제로 돌려 확인한 다섯 개 읽기 — 그중 핵심은 `enabled=t`인데
`last_success`가 오래된 행, 그것이 「멈췄다」의 모양이다). **§14 UX 변경 0**(데모 입구만, 그것은 배포가 만들지 않은
계정으로 들어가는 길을 그리던 correctness 결함이다). **최종 verdict `NOT_PILOT_READY`** — 다섯 P0 중 넷을 닫았고
남은 **하나는 코드가 아니다**: 고정 공인 IPv4와 안정적인 공개 HTTPS Cafe24 callback을 가진 **호스트가 없다**
(§10에 minimum topology·operator steps를 적어 두고 프로비저닝 여부는 **product-owner 결정**으로 올린다).
P1은 그 호스트에서 compose 1회 실행·`VITE_AGENT_RUNTIME_URL` 설정·직접 전송을 성공 기준에 넣을지 결정이며,
**「모든 채널에서 직접 전송이 안 됨」은 P0로 올리지 않는다**. backend 3,450 tests · frontend 190 files/2,441 tests ·
실패 0. 마켓플레이스 호출 **0** · WRITE **0** · 모델 **0** · 마이그레이션 **0** ⇒ evidence 행 없음).

**`docs/reviewnary_design.md` v2 = Reviewnary Product UI Redesign v1** (2026-08-27, `frontend/` 전용 · backend
API contract · domain semantics · Agent safety · Human Approval · routes **무변경**). 기존 IA/레이아웃을 정답으로
두지 않고 제품 정체성(**AI 판매운영 담당자 · Agent-first · chat-first · object-backed**)에 맞게 clean-sheet로 다시
설계했다. 먼저 실제 Demo Org 8화면을 스크린샷으로 감사한 뒤 design 문서를 「코드의 기록」에서 **「앞으로 만들 UI의
source of truth」**로 올렸다(타입 스케일 base 16 · 사이드바 232 · 콘텐츠 1120 · 간격 6단계 · 반지름 8/10/12 ·
surface 3단계 · GOOD/WARN/BAD/INFO · 화면별 5초 질문). 공통 primitive는 필요해진 만큼만 추출했다 — `Status` ·
`WorkItem` · `ObjectRow` · `Section`/`ListBox` · compact `Metric` · `AgentCommand`(=`CommandInput`) ·
context-label `AgentLaunch` — generic framework 0. **글로벌 셸**: 데스크톱 상단 바 제거(페이지 제목이 페이지를
연다), 「연결 문제 N건」은 모든 화면의 가장 강한 시각 요소였던 warn pill에서 **사이드바 하단의 secondary 상태 줄**로,
「AI에게 묻기」는 화면마다 **객체를 이름으로 부르는 라벨**(「이 상품 분석하기」·「이 문의 조사하기」·「문의에서도
반복되는지 확인」)로. **홈**: 브리핑 문장 → 명령 상자 → 먼저 볼 일(초안·AI가 먼저 확인한 일·눈여겨볼 것이 한
컨테이너의 행) → compact 숫자(freshness 경고는 카드마다가 아니라 **한 줄**) → 추이(2:1) → 채널별 → 「이 숫자에
대하여」는 disclosure. **상품**: SKU 표 폐기 → 이름 · `채널 · 문의 · 리뷰 · 답변 기준` facet · 열기, 상품당 signals +
knowledge source **fail-soft 2회 읽기**(≤20행), 정렬은 미답변→문제 근거→리뷰 순의 **표현 규칙**이고 「(미지정 상품)」은
항상 마지막(`lib/productRows.ts`; backend 무변경). **리뷰**: 「확인 필요 N건 + 이 N건만 보기」와 **반복되는 문제**가
목록 위에, 행은 `상태 단어 · ★ · 문장 · 상품`이고 분류 내부는 xs. **문의**: 행의 첫 단어가 work state(`초안 준비됨`은
queue phase에서, `답변 필요`·`답변함`은 feed에서), **1년 넘은 답변 필요 문의는 자기 divider 아래 muted**로(최근 답변
필요 → 오래된 답변 필요 → 나머지; divider는 heading이 아니다), rail은 상품명을 뺀다. **주문**: 필터 최상단 →
숫자 4 → 추이 1 → 채널별 매출 표(막대) — 「운영 인사이트」 카드는 데이터가 말하므로 삭제. **채널 연결**: 행마다
primary 1개(상태가 정한다), 리뷰 기록은 텍스트 링크, 오류 상세는 disclosure. **설정**: 카드 벽 → 그룹 리스트,
Knowledge=무엇을 / Style=어떻게 한 줄씩. 텍스트 감소는 실측 — 홈 설명문 12문장→4, 채널 17→1, 설정 14→2, 주문
4→0(시각 QA 스크립트가 `[다요]\.` 문장 수를 센다). **Browser-first 2회 iteration**: 1차 critique로 리뷰 별점 중복 ·
문의 정렬(오래된 답변 필요가 최근 답변함 아래로 밀리던 것) · rail 3줄 wrap · 상품 0 facet 소음 · `AI 확인 필요` chip
크기 · 리뷰 수집 카드 h2를 고쳤고, 2차에서 7 route **텍스트 노드 AA 위반 0**(틴트 위 합성 실측; 유일한 위반은
장식 「·」 글리프였고 그려진 점으로 교체) · 가로 스크롤 0 · 콘솔 오류 0 · off-host 요청 0. 테스트 계약 변경 **1건**을
정직하게 적는다: `ChannelList.reviewEntry.test`의 「리뷰 기록 링크가 healthy 행의 solid CTA」는 새 계약(행당 primary 1)과
충돌해 **새 계약으로 다시 썼다**(링크·카운트·미숨김 보장은 유지). 193 files / 2,455 tests / 실패 0.
**마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · DB 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음. **고치지 않고
보고한 것**: 상품 이름이 숫자 코드인 행(데이터 사실), 데모 org의 NAVER 미답변 1건이 work item 없이 「답변 방향을
제안할 수 없습니다」로 뜨는 것(백엔드 큐 범위), `/agent` 화면 자체는 셸만 새것이고 내부 구성은 무변경, 그리고
before/after 스크린샷은 실제 고객 문장을 담아 저장소 밖(scratchpad)에 둔다.

**`docs/contextual_agent_workspace_v1.md`** (Contextual Agent Workspace & Interactive UX QA v1 — `frontend/`
전용 · backend API contract · domain semantics · Agent safety · Human Approval · routes **무변경**. Agent가
모든 운영 화면에 **우측 contextual panel**(400px · 기본 닫힘 · ≥1440 docked / 미만 overlay · 페이지 헤더의
객체 이름 launcher 하나)로 붙고, 홈은 inline command를 유지하되 인식되지 않은 문장을 panel로 넘겨 실행한다.
page context는 `useAgentSurface`가 **구조화된 필드**로 등록하고 요청에는 `productId` hint로만 실리며 문장에
끼워 넣지 않는다; 답변 렌더는 `/agent`와 panel이 **하나의 `OperatorAnswerView`**를 공유한다. 「보내줘」는
승인 경계 문장을 대기 전에 보이고 panel 모듈은 publish/approve/resume를 이름으로 **import 0**(구조 테스트).
차트는 `TrendChart` 하나로 hover/키보드 tooltip · legend toggle · 단위별 축 · 날짜 tick · **백엔드가 답할 수
있을 때만** 클릭 affordance(`/orders?days=&channel=&date=`가 필터이고 KPI·차트·표는 한 응답을 읽는다; 문의·
리뷰 점은 inert). **QA는 이 커밋에서 재기동한 세 프로세스에 대해 Playwright로 두 번** 돌렸고(TC 27개 · 4 viewport ·
panel 닫힘/열림 · AA 위반 0 · 모델 호출 3 · 마켓플레이스 0). **P0 발견**: HEAD backend가 운영자의
`.env.local`(Cafe24 켜짐 · HTTPS callback 없음)로 **기동 거부** — QA는 해석 불가 `.invalid` 호스트를 QA 한정
override로 넣어 띄웠고 product-owner 결정으로 올린다. 고치지 않고 보고한 것: 리뷰 반복 문제 → 목록 필터
(endpoint가 `tier`만 받음), `AgentContext`에 문의 id 없음, 플래너 문장의 raw enum).

**`docs/contextual_agent_contract_completion_v1.md`** (Contextual Agent Contract Completion v1 — UI package가
아니다: 「현재 화면의 정확한 operational object를 Agent가 실제로 이해한다」는 계약을 닫는다. **문의 context gap은 copy
bug가 아니라 contract bug였다** — `AgentContext`/`StartRunRequest`에 문의 식별자가 없어 「이 문의 조사하기」가 org
queue를 조사했다. product의 기존 패턴(`productId` hint → org-scoped READ 1회 → `ResolvedEntity`)을 **한 종류 넓혀**
`workItemId`를 붙였다(**inquiryId가 아니다** — 런타임이 문의 하나에 대해 가진 exact READ는 `GET /api/inquiries/{workItemId}`뿐이고
inquiryId는 그 읽기에서 나온다; 이름이 실체와 다른 식별자는 이 계약이 거부하는 종류의 결함이다). 검증 READ가 답한
것(채널·상태·수신일·bound product)은 **런타임이 미리 mint한 evidence ref 하나**(ids·closed state·날짜만)로 그래프에 들어가고
고객 본문은 그 호출과 함께 버려진다 — `InquiryOps`는 detail을 **다시 읽지 않고**(그 tool은 초안 전용) 그 ref를 인용하며,
customer-memory는 product 대신 **inquiryId로 anchor**하고 org queue·inbox 읽기는 C3 규칙으로 **건너뛴다**. 다른 org의
id는 404 → 무음 drop(cross-org lookup이 존재할 endpoint가 없다). **라이브 첫 run이 진짜 결함을 드러냈다**: 문의는 특정됐는데
planner가 문장만 읽고 「어떤 문의인지」 되물었다 — product는 launcher가 상품 **이름**을 문장에 써서 한 번도 겪지 않은
일이다 ⇒ 기존 run-state seam(`priorContext`, closed vocabulary)으로 **「(INQUIRY) 특정됨」만** 전달한다(id·채널·이름·고객
단어 0, backend 프롬프트 무변경). 두 번째 run에서 답은 이 문의 하나에 대한 것이었고 queue 총계 0·raw token 0·WRITE 0.
launcher는 **work-item id를 쥐고 있을 때만 「이 문의」**를 약속한다(없으면 목록 goal). **enum 노출은 모델이 아니라 우리
것이었다** — `productOps`의 결정론 문장이 listing row의 토큰을 그대로 조립했다 ⇒ `channelNameKo`·`14,500원`·판매상태 closed
map(모르는 토큰은 절을 **생략**, 추측 0), 프롬프트 뒤 regex 0. **지연은 planner가 전부다**: 실측 plan 33.4s / tools 0.08s /
judge 0.01s / total 33.5s — 병렬화할 것이 없고 후보는 planner 자체(모델·프롬프트 길이)라 이 패키지에서 손대지 않는다;
측정은 새 tracer가 아니라 기존 log에 `operator_stage`·`operator_tool_call` 두 이벤트다. 진행 문구 「보통 20초쯤」은 실측 분포
없이 단정한 것이라 「잠시 시간이 걸릴 수 있습니다」로. backend 무변경 · 마이그레이션 0 · 마켓플레이스 호출 0 · WRITE 0 ·
모델 호출 2(첫 run이 결함을 드러냈고 두 번째가 증명) ⇒ evidence 행 없음).

**`docs/agentic_operating_workspace_v2.md`** (Reviewnary Agentic Operating Workspace v2 — 주 상호작용이 AI 운영
담당자와의 **대화**가 된다: 자연어 goal → LLM planner → 채널별 **capability reasoning**(acquisition AUTOMATIC/
GUIDED_HUMAN_ACTION/UNSUPPORTED × execution API/GUIDED_BROWSER/NOT_SUPPORTED, 기존 capability 읽기에서 파생 · 새
registry 0) → freshness 판정(capability ≠ freshness: AUTOMATIC+stale은 agent가 `manualSync`로 스스로 새로 읽고,
GUIDED+stale만 채널당 하나의 `HUMAN_ACTION_REQUIRED`) → 인간 단계 완료를 SyncJob seam에서 감지해 **원래 요청을
resume** → 닫힌 artifact 어휘 17종(LLM HTML 0) → working-set follow-up → `APPROVAL`/`GUIDED_EXECUTION`/정직한
NOT_SUPPORTED. **executableIdentity는 라벨·prefix가 아니라 acquisition provenance**에서 온다(`ExecutableIdentityResolver`,
V83; 임의 CSV는 `NONE`). Cafe24 리뷰 댓글 API 실행(`review/publish/cafe24`, V84, 비밀번호는 감사 결과 A — 댓글당
임시값, 저장 0, 기본 OFF)과 NAVER guided reply의 composer fill(`reply-composer-fill.ts`만 `.fill(` 허용, submit은
판매자의 클릭, `COMPOSER_FILLED ≠ posted`), Coupang guided acquisition `acquire/coupang` carrier(V85 mint)는 전부
**IMPLEMENTED · LOCAL_PROVEN · LIVE_UNPROVEN**(안전한 라이브 대상이 없어 WRITE를 강제하지 않았다). 홈 `/`은 대화,
Overview는 `/overview`, panel은 같은 thread. A–L 증명·free-language QA·browser QA(1440/1366/1152, AA 0)·§15–§23
보고. **마켓플레이스 호출 0 · WRITE 0 · 자동 submit 0** ⇒ evidence 행 없음. 동반: `docs/cafe24_review_comment_execution_v1.md`.
**§24 Acceptance Closure(08-28)**: read-only 감사가 찾은 저장소 측 gap을 전부 닫았다 — `POST /api/agent/reply-submission-targets`
(단일 사용 spend, 모든 승인 게이트 재확인), **`OPEN_COMPOSER`**(런타임이 정확한 리뷰 행의 비제출 「답글 작성」을 직접 누르고 그 행
범위 안의 composer만 채운다; `.click(`은 `reply-composer-open.ts` 한 곳, 자동 submit 0 — real-DOM 증명), review-id ladder 기반
`NaverLadderReplyDriver`(hint-only fill 금지), NAVER 대화 export는 신뢰된 `import/naver` carrier + launch 바인딩으로, V86 action
intent 바인딩(계정·채널·identity·operation·mode·만료·단일 사용) + v1→v2 회귀 테스트, Cafe24 per-review 중복 POST 펜스
(`ALREADY_EXECUTED`), fake freshness 3건, `filters.reviewIntent` plan token(+ 라이브 planner 녹음 2건), Coupang capability 펜스,
서버측 `NOT_MARKETPLACE_OBJECT`, FILE_UPLOAD 의미, 홈 shortcut 제거, E는 QA org에서 GROUNDED v1→v2 증명. 남은 것은 **외부 라이브
증명뿐**). **§25 Query Accuracy v1(08-29)**: 조회 정확도 진단에서 planner는 6/6 문장을 맞게 읽었고 의미는 전부
**계획 이후**에 죽었다(`PlanFilters`에 limit·order·status 칸 없음, 휴리스틱 `wantsWorkload` 라우팅, period가 게이트에만 쓰이고
읽기 인자가 아님, zod strip으로 channel 유실) ⇒ 프롬프트 v4의 닫힌 토큰 넷(`inquiryIntent ROWS|WORKLOAD|COUNT`·`limit`·
`order`·`status`)이 **tool/backend 인자까지 그대로** 도달하고, 「최근 문의」는 새 `GET /api/inquiries/rows`(문의 자체),
「내가 답해야 할 문의」는 작업 큐로 **명시 토큰**으로 갈라지며, ROWS는 항상 artifact + working set을 만들어 refine 체인이
직전 집합 위에 선다; judge 꺼짐은 org당 한 번만 묻는다. Text-to-SQL 0 · 마켓플레이스 0 · WRITE 0 · 마이그레이션 0. **§26 Freshness UX v1(08-29)**: 네 사실(마지막 관측 시각 · 요청 창 · freshness 판정 · acquisition capability)을 분리 — 답할 수 있으면 결과 먼저 + 「채널 · 언제 기준」 + 선택적 [최신 상태로 갱신](DONE), 「오늘」류만 필수 단계(WAITING_HUMAN)이고 채널당 문장 하나; stale 0은 「0건」이 아니고 플래너는 말하지 않은 「오늘」을 만들지 않는다(v5). **§27 Chat UI v1(08-29)**: 홈 = 대화(transcript 독립 스크롤 · composer viewport bottom dock · KPI 띠 → 빈 스레드의 muted 한 줄 · 스레드 목록은 사이드바 · 예시 프롬프트는 빈 대화에서만); composer는 ArrowUp/Stop 한 자리이고 **Stop은 실제**다 — 스트림 종료 → `OperatorBudget.cancel()`로 다음 단계 0(진행 중 단계는 끝남) · `CANCELLED` 턴 영속 · 되돌렸다고 말하지 않는다; 한 대화의 턴은 직렬화. **§28 Chat Motion v1(08-29)**: `motion`으로 절제된 motion(150–250ms ease-out, 메시지 fade+8px, artifact/progress/칩 layout, send↔stop·copy↔check 제자리 crossfade, 사이드바 height, reduced-motion 존중, 기존 스레드 재생 0) + composer dock 기하(20px 바닥, 위 fade 하나). **§29 Knowledge Context v1-A(08-30)**: 회사 운영 기준이 Agent에 닿는다 — READ tool `search_org_knowledge`(기존 `/api/org-knowledge/search`, 필요한 turn에서만 검색·프롬프트 주입 0)로 POLICY need를 읽고, 「보관하고 있지 않다」 고정 부정문은 삭제(정책 있으면 인용 · 없으면 「등록된 배송 기준이 아직 없습니다」+`KNOWLEDGE_ENTRY→/settings/policies` 선택 단계); 라이브가 드러낸 planner 오라우팅(PRODUCT_OPS 상품 되묻기 · REPORT_OPS 재진술)은 `policyRouted`(POLICY-only ⇒ INQUIRY_OPS 단독)와 `needScopeOf`(POLICY는 항상 ORG scope)로 결정론 닫음, 검색 query는 문장이 아니라 판매자의 **명사**; draft lane은 `InquiryDraftComposer`가 계속 authoritative이고 `DraftArtifact.evidenceSummary`가 lane별 **개수만** 싣는다; `InquiryAnswerMemoryHook`은 SELLER/MODEL만 기억(`SELLER_APPROVED_FALLBACK`·`RULE` 승인은 memory 0); `RuleBasedDraftProvider` 템플릿 삭제(카테고리만, 본문 ""·`NO_ANSWER_BASIS`) + `SpringDraftProvider`는 retriever preview에 passage 0이면 모델 미호출, `performRecord`는 본문 없는 승인 거절; judge digest는 passage 본문 대신 제목·`judgeStatement`; provenance/memory strength는 tie-break만(`tieBreakRank`). 마이그레이션 0 · 마켓플레이스 0 · WRITE 0. **§30 v1-A closure(08-30)**: 문의 초안 drafter는 **`InquiryDraftComposer` 하나** — 레거시 `/api/agent-runs` 두 lane(`/agent`의 초안 버튼·미답변 처리 shortcut, 도달 가능)은 `ComposerDraftProvider`→`DraftPreparer`로 **위임**(propose→`draft/generate`, 문의 화면과 같은 호출)하고 title/body-only 모델 seam(`SpringDraftProvider`·`POST /api/agent/inquiry-draft`·`AgentDraftController`·ungrounded overload)은 **삭제**(구조 테스트); 초안 없음은 빈 본문(+백엔드 문장)이고 승인은 비활성·`NO_DRAFT_TEXT`; restart-resume는 규칙 재생성 대신 **저장 버전을 읽어 fingerprint로 확인**(`DRAFT_CHANGED`). scope 문구: 특정 문의 턴이 WORKLOAD intent라 org 큐를 읽고 gate에 거절돼 「전체 집계뿐이라 이 상품의…」가 붙던 것 — entity 규칙이 intent 토큰보다 앞서고 `RejectedEvidence.needEntity`로 문장이 문의/상품/조직을 구분; 「AI 초안이 준비돼 있습니다」는 phase가 아니라 `locator.draftVersion`이 말한다. 실제 Demo Org 문의에서 GROUNDED는 retriever absence gate 때문에 미도달(harness·backend 테스트로 증명). 마이그레이션 0 · 마켓플레이스 0 · WRITE 0. **§31 Seller Context v1-B(08-30)**: 회사가 어떤 곳인지 한 문단(≤500자)을 **판매자만** 쓰는 별도 org profile(V87 `organization_profile`, 답변 스타일·정책 테이블과 분리)로 두고, 초안 composer는 basis 판정 **뒤** 모델 경로에서만 「회사 정보」 섹션(user turn · 사실 아님 footer)으로 읽으며 `companyContextUsed`는 플래그뿐 — **business_summary만으로 GROUNDED 불가**(판정이 그것을 보지 않는다, fence 테스트). Agent lane은 닫힌 need `COMPANY_PROFILE` + READ tool `get_seller_profile` 하나로 필요한 turn에서만 읽고(POLICY와 같은 ORG 라우팅) 목록·개수·리뷰 turn은 읽기 0, planner prompt는 문장 하나(+307자)·catalogue 한 줄이며 상시 inject 0; judge는 라벨·길이만. 화면은 `/settings/company` 하나. 마이그레이션 1 · 마켓플레이스 0 · WRITE 0.

**`docs/pilot_host_provisioning_v1.md`** (Pilot Host Provisioning v1 — PREPARE. 제품 코드 0. HEAD 감사: 루트
compose는 5432·8080·8787·5173을 전부 호스트에 공개하고 restart 정책·edge·TLS·백업 seam이 없다. 준비물은
`deploy/pilot/`: compose overlay(`ports: !reset []`로 raw port 공개 0, `restart: unless-stopped`, JVM heap 고정, Cafe24
callback/result URL과 runtime URL을 `PILOT_PUBLIC_HOST`에서 파생) · Caddy edge(자동 TLS, same-origin 라우팅 `/api`→backend ·
`/agent-runtime`→runtime · 나머지→SPA — 프론트가 이미 same-origin `/api/*`를 부르고 runtime URL이 build arg라 **코드 변경 0**) ·
`pilot.env.example`(이름만) · `host-bootstrap.sh` · `deploy.sh`(pull→env 검증→build→up(Flyway)→health→smoke) · `smoke.sh`
(credential 0·WRITE 0) · `egress-check.sh`(host·container outbound == advertised) · `backup.sh`/`restore.sh`(pg_dump -Fc,
env secret 미포함). 권장: EC2 t3.medium + EIP + A 레코드, 공개 포트 80/443만, SSH는 SSM 우선. Cafe24 callback은 기존
`/api/connect/cafe24/callback`에 stable host를 앞세울 뿐이고 Demo Org 토큰은 건드리지 않는다. **billable 리소스 생성 0** —
region·domain·Cafe24 app·NAVER IP 등록·SSH 자세·off-host 백업은 product-owner 입력).

**`docs/conversation_object_integrity_v1.md`** (Conversation Object Integrity v1 — 2026-08-30. 통합 QA가 이름 붙인
객체 정합성 결함만 닫는다: **문의 identity ≠ work-item identity**(ROWS 집합은 inquiry id로 색인, `title`은 영속),
**effective answer state 하나**(검증된 read-back이 `inquiries.status`도 ANSWERED로 — V88이 과거 검증 행을 닫음),
**선택 문의 anchor**(`WorkingSetView.selectedInquiry` — 새 목록을 그리기 전까지 유지, 상품은 곁에 추가), **actionability
gate**(`inquiryActionability.ts` — 답변된·전송 대기·비대상 문의는 retrieval·proposal·모델 호출 0), **tone revision lane**
(`styleIntent.ts` — 세 `ToneHint` 토큰의 닫힌 cue 표, 초안이 있을 때만; planner 0·tool 0·같은 근거·새 버전). 실제 planner로
A–G 재검증, 마켓플레이스 0 · WRITE 0. Knowledge retrieval tuning·wording 대개편·Knowledge Capture는 미포함.)

**`docs/retrieval_grounding_correctness_v1.md`** (Retrieval & Grounding Correctness v1 — 2026-08-30. 새 RAG 엔진이
아니라 결정론적 lexical retrieval을 정확하게 연결한다: **`RetrievalQuery`**(한 질문을 TOPIC→TITLE→SUBJECT→FULL의
bounded candidate ≤4로 검색, 세 lane·composer·검색 endpoint 공유; scorer·threshold 불변), **`RetrievalOutcome`**
(`FOUND`·`ABSENT`·`NO_RELEVANT_EVIDENCE`·`NOT_APPLICABLE`이 모든 검색 응답과 `InquiryEvidence` lane별로 실리고 seller
문장·`answerBasisAction`·KNOWLEDGE_ENTRY 제안이 그것을 따른다), **`KnowledgeTopic`**(닫힌 topic 표로 질문과 문서
**선언**(type·title)을 읽어 서로 다른 topic만 거절 — 인정은 못 하고 거절만 한다), **`search_answer_memory`**
(`GET /api/answer-memory/search`, need `PAST_ANSWER`, prompt v8 — 과거 답변은 answer_memory를 읽고 customer memory와
섞지 않는다; memory 단독 GROUNDED 금지 유지). 라이브 A–J on disposable org, 마켓플레이스 0 · WRITE 0. **Retrieval Query Selection v1 (08-30, 같은 문서 §):** 같은 문서가 판매자의 「반품 조건」에는 FOUND, 플래너의 need 문장에는 NO_RELEVANT이던 결함 — 첫 divergence는 SUBJECT candidate였다(플래너의 문서·설명·FAQ·작성·상품의 같은 **artefact 명사**가 topic 단어로 채점되고 8단어 cap이 조건을 밀어냈다). `QueryTokens`가 닫힌 두 class — INSTRUCTION(어간 + 닫힌 어미 문법: 명시돼·명시된·확인해주세요가 항목 하나) · META(artefact·당사자·관계·기록 명사 + 조사) — 를 분리하고 topic-bearing 단어만 SUBJECT가 된다(문장마다 stop word 추가 금지); 구조화된 topic은 `?topic=`으로 **먼저** 시도하되 질문의 KnowledgeTopic을 단어 하나짜리 candidate로 만들지는 않는다(threshold lowering의 다른 모양). 세 lane이 같은 정규화를 쓰고 answer memory lane의 같은 결함(문의에·뭐라고·답했어)도 함께 닫혔다. threshold·scorer·candidate 상한·planner 호출 수 불변, 마이그레이션 0.)

**`docs/seller_facing_response_hygiene_v1.md`** (Seller-facing Response Hygiene v1 — 2026-08-30. Agent 내부
구조는 그대로 두고 판매자가 읽는 문장만 닫는다: 모든 seller-facing 문장은 **`operator/wording/sellerWording.ts`
한 곳의 닫힌 어휘**에서 고른다 — 출처 라벨(상품 정보·운영 정책·과거 승인 답변·주문 정보·회사 정보), lane×outcome
문장표(없다·찾지 못했다·바로 적용하기 어렵다는 섞이지 않는다; backend `AnswerBasisState`와 같은 문장), 판매자
문서의 **bounded excerpt**(전문 복창 0), planner rationale/clarification은 **읽어서 닫힌 문장을 고를 뿐** 출력하지
않는다. 회사 정보는 소개 자체를 물은 turn에만 읽어 주고, NO_ANSWER_BASIS는 「무엇이 빠졌나 + 다음 한 걸음(답변
기준 추가)」, 선택된 문의는 다시 묻지 않으며, 「방금 본 리뷰를 …묶었습니다」는 리뷰 집합을 실제로 묶었을 때만이다.
`DraftArtifact`는 본문 우선 + compact 근거 한 줄 + 「말투 다듬기」/「보내기 준비」(둘 다 대화 문장, 승인 경계 무변경) +
reload 시 저장 버전 재읽기. 라이브 A–J (disposable org, 마켓플레이스 0 · WRITE 0) + 브라우저 7턴 토큰 0.)

**`docs/knowledge_capture_learning_loop_v1.md`** (Knowledge Capture / Learning Loop v1 — 2026-08-30. Agent가 업무 중
실제 Knowledge Gap을 만나면 **판매자에게 그 사실 하나를 묻고**, 판매자가 쓴 문장을 **fingerprint에 묶인 「저장하고 계속」**
뒤에만 기존 seller-write seam(`POST /api/org-knowledge/sources` · `POST /api/products/{id}/knowledge/sources`,
`SELLER_ENTERED_KNOWLEDGE`)으로 저장하고 원래 일을 **한 번** 다시 한다. 게이트는 composer의 per-lane 판정을 값으로 실은
`GeneratedDraftView.knowledgeGap`(문장 파싱 0) — `ABSENT`/미선언 miss만 묻고 **`NOT_APPLICABLE`은 같은 정책을 다시
묻지 않으며**, 두 topic을 이름 짓는 질문은 planner의 POLICY gap이 그중 하나를 골랐을 때만 ORG로 간다. 질문은 scope×topic
닫힌 템플릿(모델 0), 답변 판정은 닫힌 취소/질문/명령 cue, 정규화는 공백·길이뿐, 중복/충돌 fence는 결정론(같은 본문·같은 제목·
같은 단위 다른 수치 → 덮어쓰기 0, 설정 화면으로). `pendingCapture`가 대화 상태에 영속되고 다른 문의로 옮기면 떨어진다;
resume 전 actionability 재검사(답변된 문의는 기준만 저장). writer는 `KnowledgeCaptureWriter.ts` 한 파일(write fence).
라이브: 충돌·중복·취소·stale·저장→GROUNDED 재초안(근거 인용)·GOAL 재실행·ANSWERED 경계 전부 확인; **lexical retriever가
판매자의 「출고」와 고객의 「배송」을 잇지 못해 저장 뒤에도 `DRAFT_STILL_GAP`인 경우는 정직하게 남기고 보고**(threshold 무변경).
마켓플레이스 0 · WRITE 0 · 마이그레이션 0. **§12–15 Captured Knowledge Reuse Robustness v1 (08-31)**: 저장 직후의 두 miss를
scorer에서 닫았다 — threshold·candidate 구조·세 lane 불변. 상품명이 설명하는 낱말은 **조사까지** 분모에서 빠지고, 질문이
**정확히 하나의** `KnowledgeTopic`을 이름 지을 때만 그 topic 어휘(배송↔출고↔발송)가 서로를 만나며, 닫힌 어미(나요)와 ㅂ니다
활용 규칙 하나가 stem을 잇고, **측정 단위**(mm·일·개, 며칠)는 실제 낱말 매치 옆에서만 세는 보조 concept이다(단독 채택 0 — 「폭 몇
mm」→「높이 18mm」도 닫힘); 가닥 같은 **셈 명사는 단위가 아니라 낱말**이고 「몇 가닥」은 `\d+가닥`을 말한 passage가 답한다.
숫자는 판매자의 것 그대로. 라이브 A–I 전부 FOUND/거절이 맞고, 지연 3–6ms · 모델 호출 증가 0).

**`docs/agent_interaction_model_v2.md`** (Agent Interaction Model v2 — 2026-08-31. 홈 대화를 「챗봇이 붙은
SaaS」가 아니라 **보이는 객체를 가리키고 클릭하고 이어서 맡기는** operating workspace로 만든 coherent refactor.
**P0 org/session binding 먼저**: backend는 깨끗했고 노출은 프론트 셋 — `getOrMock`이 **모든 오류에서** NAVER+Cafe24
fixture를 라벨 없이 렌더하던 fallback 삭제(mock 빌드 한정), 로그아웃을 세션 해체로(`sessionScope.ts` — 대화 포인터·
bridge 페어링·연결 흐름 상태), 대화 포인터 **org 네임스페이스** + org 전환 시 provider 전체 리셋; runtime은
`ConversationView.orgId` 스탬프+load 단언(불일치=404)으로 위치적 격리에 단언을 더했다. **Focus는 명시 상태다**:
`activeTask`(INSPECT·PREPARE_REPLY·REVISE_DRAFT·CAPTURE_KNOWLEDGE·APPROVE_REPLY)가 continuation에 실려 reload를
넘긴다. **자연어 선택은 결정론**(`visibleSelection.ts`, model 0): 채널 map + workload와 **같은** `TOPIC_WORDS` +
행 텍스트 literal — 집합 밖을 이름 지으면 플래너로 거절, 복수면 **후보 제시**(집합이 후보로 좁혀져 ordinal·클릭이 그
위에 선다). **CLICK == FOCUS**: 행 클릭이 `StartTurnRequest.select`로 같은 anchor 전이를 만들고(transcript 무추가·
영속·미검증 id는 READ 1회 검증 후에만), 모든 UI 버튼이 같은 contract를 쓴다. **INSPECT ≠ WORKLOAD**: 선택은 새
`INQUIRY_DETAIL` artifact(닫힌 사실 + transient 고객 발췌, org 재조회 0)이고, **anchor 위의 PREPARE는 플래너 0** —
compose에서 추출한 `prepareOneInquiry` 하나를 직접 lane과 공유(33s→0.2s, capture 질문 포함). 홈 오프너는 **실제
workload**를 말한다(proactive 0 + 미답변>0 ⇒ 「확인이 필요한 일이 있습니다」; 「없습니다」는 두 읽기가 빈손일 때만;
중복 소유자 `AgentBriefing`/`briefingHeadline` 퇴역). 목록 행은 객체(제목+상태+메타, workspace는 보조 아이콘), 근거는
「근거 N」으로 접히고 빈 generic 행은 렌더 안 됨. QA가 드러낸 결함 둘을 닫음: anchor 상품 힌트는 **「이 상품」을 말한
문장에만** 실리고, 집합보다 큰 limit은 refine이 아니다(`scopeOverride` **`NEW_LIMIT`**). 재계약 §14(안전 테스트 약화 0):
ordinal=INSPECT·anchored PREPARE plan 0으로 objectIntegrity/responseHygiene 재작성. 검증: runtime 727 · frontend
2,579 · backend 3,580 전부 green + **라이브 브라우저 QA**(disposable org, 시나리오 1–7 전부 통과 — label select 74ms
LLM 0, 클릭→「이 고객」 정확 대상, capture 저장→GROUNDED cited, 새 대화에서 저장 기준 재사용·재질문 0, 후보 3건 임의
선택 0, Org B 격리, reload 후 anchor 유지; 모델 PLAN 5·DRAFT 4·JUDGE 2, 콘솔 오류 0·off-host 0). **marketplace 호출
0 · WRITE 0 · 마이그레이션 0** ⇒ evidence 행 없음. 정직 보고: cleanup 중 `agent-runtime/.runstore/` 전체 삭제는
과했음(로컬 dev 대화 파일; DB·채널 무관), planner org allowlist는 파일럿 운영 결정, visibleSelection v1은 INQUIRIES만.)

**`docs/conversation_core_chat_ux_v1.md`** (Conversation Core + Chat UX v1 — 2026-08-31. PO QA의 대화
결함 다섯을 root cause에서 닫음. **ConversationTask 계약**(mode ANSWER·LIST·FILTER·INSPECT·ANALYZE·
PREPARE·REVISE·EXECUTE × scope ORG·VISIBLE_SET·SELECTED_ENTITY, `taskInterpreter.ts`) — 결정론으로
읽는 것은 테이블 위 객체에 대한 FILTER·ANALYZE·INSPECT·PREPARE·REVISE뿐이고 나머지는 그대로 LLM
planner다(결정론 goal planner는 이번에도 0). **FILTER**: 「배송 관련 문의만 봐줘」가 같은 5건을
반복하던 원인 둘 — ROWS 실행기에 topic 축이 없었고(플래너는 이미 닫힌 토큰을 내고 있었다) 결정론
filter lane 자체가 없었다 — 를 `applyVisibleFilter`(visible set 위 channel·topic·status·order·limit,
제목 우선 + bounded detail READ ≤8로 본문, **11~15ms · LLM 0**)와 `InquiryRowsSpec.topic`으로 닫음;
집합보다 큰 limit·행을 다 못 든 집합은 플래너로. **ANALYZE**: 「뭐라고 답하면 좋을까」는 조언 요청이라
actionability gate의 지배를 받지 않는다 — DRAFTABLE anchor는 기존 draft step(가장 강한 조언은
초안), 그 외는 `advisory.ts`가 상태를 사실로 말하고 판매자 corpus 세 retrieval seam의 bounded
excerpt로 답변 방향을 정리한다(모델 0·쓰기 0); gate는 명령형 PREPARE(「새 답변 준비해줘」)에만 남는다.
UI: SUMMARY 카드 해제(평범한 대답은 산문), **legacy `/agent`의 중복 대화 embed·free-text 폼 제거**
(「정해진 작업」= 닫힌 intent button lane + checkpoint만 남음, panel 「전체 화면」→`/`). **§9 New-list
Scope Integrity**: 「최근 문의 7개 보여줘」가 anchored 스레드에서 직전 집합의 채널/상태를 물려받아
「네이버 답변 안 한 최근 7건」이 되던 context contamination을 결정론으로 닫음 — 명시적 새 LIST는 ORG
scope이고 계승은 refine 표현(「그중·여기서·방금 본·~만」)만 한다: voided refine(NEW_LIMIT·NEW_PERIOD)은
**직전 집합 값과 같은 filter 축을 base로 보고 떨어뜨리며**(`scopeOverride` — 닫힌 토큰 동등성, 문장
읽기 0; EMPTY_SET은 유지), `priorLineOf`가 집합 축은 화면 설명이지 조건이 아니라고 고정 지시문으로
말하고(backend 프롬프트 무변경), `visibleFilterOf`는 refine 표현 없는 문장을 받지 않는다(「7개만」의
만은 개수라 limit 소비 후 marker 판독). selected entity는 감사 결과 구조적으로 이미 목록 read에 닿지
않았다. 라이브 브라우저 acceptance 8종 + §9 두 chain 전부 통과(disposable org, 결정론 lane 전부 LLM 0),
runtime 737·frontend 2,575 green. **backend 0 · 마이그레이션 0 · marketplace 호출 0 · WRITE 0**. 정직
보고: FILTER v1은 INQUIRIES만, grounded advisory 인용은 라이브 미관측(unit test로 고정),
fast-interpretation 모델은 만들지 않음 — 필요가 관측되면 product-owner 결정.)

**`docs/conversation_ux_v2.md`** (Conversation UX v2 — 2026-08-31. PO QA의 여섯 증상을 예시별 patch가
아니라 **네 개의 공통 원인**에서 닫는다. **(1) 질문의 주어**: 표현할 자리가 닫힌 5-값 `filters.topic`
하나뿐이라 현금영수증·세금계산서·파손 같은 낱말은 조용히 사라지고 더 넓은 질문의 답이 원래 질문의 답인
것처럼 나갔다 ⇒ `subjectTerm.ts`가 문장이 **주어로 표시한 낱말만**(「X 관련」·「X에 대한」·「X 문의」)
결정론으로 뽑아 `GET /api/inquiries/rows?q=`의 **하나의 bound LIKE**(제목 OR 본문)로 보내고, 이미 자기
축을 가진 낱말과 행을 서술하는 동사형은 거부한다(실패 방향은 항상 「좁히지 않음」). **플래너는 이 낱말을
모른다** — plan schema는 닫힌 토큰 그대로이고 프롬프트(v9)는 오히려 「다섯 값에 안 맞으면 topic 은 null」을
가르친다; payload floor 무변경. 좁힌 낱말은 **되말하므로** 그 아래의 0은 그 주제에 대한 0이다. 부수로
`scopeOverride`에 **`NEW_SUBJECT`**: 이미 주어를 가진 집합을 **다른** 주어로 좁히라는 문장은 refine이
아니라 조직에 대한 새 질문이다(「파손 문의」 위의 「교환 문의는?」이 「방금 본 문의 중 …없습니다」였다).
**(2) 순서를 묻는 질문**: 작업 어휘에 순위 mode가 없어 최상급 질문이 목록으로만 표현됐다 ⇒ 닫힌 토큰
`inquiryIntent=PRIORITY` + `urgency.ts`. **기준은 하나이고 문장으로 나온다** — 「고객이 기다린 시간을
기준으로 정했습니다 / 채널이 정한 답변 기한 정보는 아직 없어 대기 시간만 봅니다」(이 제품이 실제로 가진
urgency 신호는 대기 시간뿐이다), 행마다 `waitingDays`; 화면 위 집합에는 결정론 lane(LLM 0·읽기 0)이지만
문장이 **자기 scope를 이름 지으면** 플래너의 것이다. **(3) 선택한 행의 본문**: 본문 읽기가 work item에
묶여 있어 답변된 문의는 제목만 남았고, 서수에 보는 동사가 붙으면(「두 번째 거 자세히 보여줘」) 플래너가
큐를 다시 읽어 목록을 재인쇄했다 ⇒ 행이 **문의 피드와 같은 마스킹**의 `snippet`을 들고 오고(저장 시
제거), 서수+viewing tail은 선택이며, 플래너가 행 하나를 지목했을 때도 곁의 목록을 지우고 INSPECT와 **같은
카드**를 그린다. **(4) 한 사실은 한 번만**: 초안 없는 DRAFT 카드·빈 목록 카드·`ASKED` 캡처 카드는 이제
**아무것도 그리지 않고**, 카드의 컨트롤을 반복하던 칩·재개 불가 단계의 「계속 확인하기」·방금 거절된 요청을
되풀이하던 칩·「근거 N」의 숫자가 사라졌으며, supporting finding은 4→2, 순위 문장은 `urgencySentence()`
하나를 headline과 finding이 공유한다. 라이브 QA는 disposable org에서 실제 플래너·초안 모델로 15문장
(A1~D5) — 주어·순위·선택·초안·말투·capture 저장까지 전부 통과, 콘솔 오류 0. backend 3,582 · runtime 748 ·
frontend 2,576 green. **마켓플레이스 호출 0 · WRITE 0 · 마이그레이션 0** ⇒ evidence 행 없음. 정직 보고:
snippet은 스레드에 저장되지 않아 새로고침 뒤 목록 행은 제목만 남는다(의도된 성질), 플래너 변동성은
프롬프트로 좁혔을 뿐 결정론이 아니다, 순위 기준은 대기 시간 하나이고 PRIORITIZE는 문의만이며, `q`는
형태소 분석이 아닌 부분 문자열이다.)

**`docs/working_context_v1.md`** (Working Context v1 — 2026-08-31. 「채팅으로 데이터를 조회하는 SaaS」가
아니라 **현재 업무 맥락을 아는 AI 운영 담당자**로 느껴지게 하는 패키지. 구현 전 7개 제품(Rovo · Linear ·
Asana Dash · Notion Agent · Devin · Sierra Explorer · Glean)의 interaction pattern만 bounded 조사했고
브랜딩·픽셀은 복제하지 않았다; 수렴점 중 이 저장소에 **없던 단 하나**가 「에이전트가 지금 보고 있는 객체를
이름으로 말한다」였다. **본체(§1)**: 행을 클릭하면 대화가 그 문의에 anchor되고 다음 「답변 준비해줘」와
지식 공백 질문이 전부 그것에 작용하는데 — 전부 이미 참이었고 **어느 것도 화면에 없었다**(프론트 전체에서
`activeTask` 참조 0). `ContextBar`가 transcript와 입력 상자 **사이**에 한 줄로 객체 이름 · 출처 · 진행 중인
단계 · 「해제」를 그린다(SET일 때는 판매자 자신의 낱말로 집합을 설명하고 해제 불가). **이름은 새 상태가
아니다** — anchor는 계약상 id와 닫힌 토큰뿐이므로(저장된 대화에 고객 문장의 두 번째 사본 금지) 라벨은
**스레드가 이미 그린 artifact**에서 되찾고 그래서 새로고침을 넘긴다; 이름 지을 수 없으면 「선택한 문의」라고
정직하게 말한다. `INSPECT`에는 단어를 주지 않는다(객체를 보여주는 것이 곧 inspection이다). **§1-A 해제**는
`select: {kind:"CLEAR"}` — 클릭이 지나는 같은 seam, anchor와 task만 떨어지고 집합·transcript는 그대로, 읽기
0 · 모델 0이며 프론트는 **낙관적으로 지우지 않는다**. **§1-B**: 그 테스트가 더 오래된 결함을 찾았다 —
집합은 ROWS면 inquiry id, 작업 큐면 work-item id로 색인되는데 `anchoredSet`이 inquiry id로만 대조해
**작업 큐 행 클릭이 집합을 1건으로 무너뜨리고 있었다**(행은 두 id를 다 들고 있으므로 둘 중 하나로 알아본다).
**§2 홈**: 인사말·숫자 줄·오프너가 같은 수를 **세 번** 말하고도 그 12건이 무엇인지는 말하지 않았다 ⇒ 브리핑이
`rows?status=UNANSWERED&order=OLDEST&limit=3` **한 번**으로 실제 행을 이름 부르고(누르면 anchor), 숫자는 그
행들이 위에 있는 이유로 **한 번**만 나오며, 읽기 실패는 조용히 count 줄로 되돌아간다. **§3** 진행은 시간순
(끝난 것 위 · 지금 아래)이고, 플래너 대기 동안 화면이 가진 진짜 사실은 시계뿐이라 없는 단계는 그리지 않는다.
**§4** `CAPTURE_KNOWLEDGE` 동안 placeholder가 「답변 기준을 여기에 적어 주세요」. **§5 한 사실은 한 번만**:
펼친 행의 미리보기 중복 · ROWS 목록의 반복 그룹 헤더 · 지식 저장 카드의 재초안 문장 · 홈의 미답변 수 —
그리고 라이브가 찾은 진짜 버그 하나(`same key: UNANSWERED` — 연속 구간 그룹의 키 충돌로 React가 행 누락·복제를
경고하고 있었다). 검증: runtime 752 · frontend 2,590 · 실패 0 · typecheck clean, 일회용 org에서 라이브
브라우저 QA A1–A10 전부 통과 · 콘솔 오류 0. **마켓플레이스 호출 0 · WRITE 0 · backend 소스 무변경 ·
마이그레이션 0** ⇒ evidence 행 없음. 정직 보고: 플래너 대기의 단계별 진행은 새 프로토콜이 필요하고, 제안 칩은
여전히 working set만 따르며, ContextBar는 문의 anchor만 이름 짓는다.)

**`docs/agent_responsiveness_v1.md`** (Agent Responsiveness v1 — 2026-09-01. 자유 문장 turn이 8~27초라
직전 네 패키지가 만든 Agent 행동 개선이 전부 대기 시간에 잠겨 있던 문제. **추측으로 architecture를 만들지
않았다 — §1이 측정이고 이후 모든 변경이 자기를 정당화한 숫자를 이름으로 댄다.** 측정 자체가 불가능했던 것이
먼저다: 런타임은 자기 plan stage만 재서 **벤더 호출·백엔드·네트워크가 한 숫자**로 왔고, 30초짜리 turn의
원인 넷(큰 프롬프트 · 느린 회선 · 큐 · 출력 예산을 생각에 쓰는 reasoning 모델)을 가를 방법이 없었다 ⇒
`AgentLlmCallMetrics`(경과 ms + 벤더 자신의 토큰 수)를 기존 `agent_plan`/`agent_draft` 로그 줄에 실었다
(실패 경로 포함 전부, **메타데이터 전용** — `usage` 블록만 읽고 요청·응답 본문은 읽지 않는다; 시간은
transport 사실이므로 transport가 잰다). **결과: 한 번의 벤더 호출이 모든 turn의 98~99%**(plan 11,274ms /
tools 65ms / judge 12ms), 그리고 그 호출의 길이는 **읽은 토큰이 아니라 뱉은 토큰**을 따른다 — 입력은 지연이
4배 떨어지는 동안 5.5k로 **상수**였으므로 큰 시스템 프롬프트는 겉보기와 달리 지렛대가 아니고, 뱉은
592~926 토큰 중 **256~576이 내부 reasoning**이었다(답 자체는 ~340 토큰 JSON). 결정론 lane은 이미 **6~8ms**
였으므로 제품에는 두 계층뿐 중간이 없었다. **금지선 유지**: 문장 분류기·키워드 표·예문별 canned intent
**0**, LLM planner가 계획하거나 run이 실패한다는 v2 계약 무변경. 바꾼 것은 플래너에게 **무엇을 요구하는가**
와 **무엇으로 생각하게 하는가**, 그리고 생각하는 동안 **화면이 무엇을 하는가**다. (1) **읽는 코드가 없는
칸을 요구하지 않는다** — `informationNeeds[].why`·`retrievalStopWhen`·`stopWhenEnough`·`retrievalParallel`은
`agent-runtime` 전체에서 **소비자 0**이었다(검증기가 plan 객체에 복사하고 아무도 다시 읽지 않았다):
프롬프트 **v10**이 요구를 멈추고 `rationale`·`clarificationReason`은 그것을 읽는 분기에서만 요구하며, 실행을
정하는 칸(needs·kinds·specialists·tools·evidence·filters·target·action·tone)은 **전부 그대로**라 before/after
비교가 성립한다(`promptAsksOnlyForFieldsWithAConsumer`가 되돌아오면 실패한다). (2) **plan reasoning-effort
기본값 `low` → `minimal`** — 실제 Demo Org 14문장에서 reasoning 토큰 256~576 → **0**, 중앙값 12.2s → 4.8s,
그리고 **14문장 중 13문장 결과 동일**(나머지 하나는 빠른 설정이 근거를 *더* 실어 답한 capability 질문).
초안 capability는 손대지 않았다 — 그 모델은 고객이 읽을 한국어 문장을 쓰고 이 모델은 스키마에 닫힌 토큰을
채운다. (3) **깊은 reasoning은 「어렵다는 증거」가 있는 한 곳에만** — 검증기가 plan을 거절한 뒤의 **repair
1회**(`retry-reasoning-effort`, 기본 `low`, 공란이면 escalation off). 이웃 둘은 시도했고 **측정으로 기각**했고
그 기록을 남긴다: **follow-up은 retry가 아니다**(`priorContext`는 re-plan 진행 줄과 대화의 working-set 줄
**둘**을 나르므로 존재만 보고 「어렵다」로 읽자 대화의 두 번째 문장마다 3.4s → 5.6~9.6s가 됐다 ⇒ wire에 명시
`retry` 플래그), **graph re-plan은 계획이 아니라 세상에 대한 것이다**(라이브 실측: 이미 6.6s를 쓴 turn에서
re-plan이 강한 설정으로 **12.6s**를 더 쓰고 needs 0·specialists 0을 돌려줘 합계 19.4s — 비용은 확실하고
이득은 미관측). (4) **판매자 자신의 문장이 네트워크보다 먼저 그려진다** — user turn이 `ensureId()` **뒤에**
append돼 첫 메시지가 왕복 한 번을 기다렸고, `send`는 그 앞에서 로컬 도우미 health probe(페어링된 브라우저
기준 최대 1.5s)까지 **await**하고 있었다; 이제 말풍선은 동기로 그려지고 둘은 그 아래에서 돈다(도우미 힌트는
요청 **옆에서** 해결되므로 런타임이 듣는 내용은 무변경). 실측 **말풍선 7~18ms**. 진행 행은 여전히 런타임이
보고한 stage만 그린다 — **가짜 진행 0**이고, 플래너 호출 중 참인 사실은 「이해하는 중」과 시계뿐이라 그것만
그린다. **before/after(같은 14문장·같은 org·같은 기계): 중앙값 12,236ms → 3,433ms(3.6×), 최악 26,554ms →
5,822ms(4.6×), 분포 7.4~26.6s → 2.5~5.8s**이고 **14문장 전부 status·artifact·working set·headline 동일**
(latency diff가 아니라 **outcome diff**로 비교했다 — 다른 질문에 답하는 빠른 플래너는 빠른 것이 아니다).
라이브 브라우저 한 스레드: 3,377ms / **157ms** / **159ms** / 4,494ms / 6,233ms, 마지막 turn의 trace는
plan 5,874ms · tool 9회 합 151ms · judge 0ms(플래너가 여전히 97%), 콘솔 오류 0. **부수 결함 하나**: org 범위
답변 뒤에 직전 working set의 제안 칩이 붙던 context pollution — anchor는 「그중…」의 지시 대상이라 계속
이어져야 하지만 **칩은 이 답변이 화면에 올린 것**을 따라야 한다 ⇒ `drewSetOf(artifacts)`로 두 값을 분리했고,
**anchor된 문의의 칩은 남긴다**(ContextBar가 그 객체를 계속 이름으로 부르고 있으므로 판매자가 무엇에 대한
칩인지 볼 수 있다). backend 3,592 · runtime 756 · frontend 2,592 · 실패 0. **마켓플레이스 호출 0 · WRITE 0 ·
DB 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음. **하지 않고 보고한 것**: **모델 교체**(여섯 capability 기본값이
벤더가 deprecated로 표시한 스냅샷이고 교체는 `image_product_knowledge_v1.md` §10이 기록한 **product-owner
결정** — 플래너의 일은 닫힌 토큰 스키마 채우기라 작은 모델이 잘하는 모양이고 **남은 가장 큰 지렛대**이지만
이 패키지는 쓰지 않았다; §1-B의 토큰-시간 관계로 외삽하면 방출 속도 2배 모델에서 중앙값 ≈1.7s인데 **그것은
외삽이지 측정이 아니다**), 5.5k 시스템 프롬프트 단축(측정이 지렛대가 아니라고 말한다), **초안 모델 미측정**
(Demo Org에서 초안을 만드는 것은 실제 고객 문의에 버전을 쓰는 일이라 하지 않았다 ⇒ PREPARE turn의 두 번째
모델 호출은 **UNMEASURED**), 플래너 호출 **내부**의 단계별 진행(새 프로토콜 필요), plan 캐시(같은 문장도
working set이 다르면 다른 뜻이라 문장 키 캐시는 두 번째 질문에 첫 번째의 범위로 답한다).)

**`docs/planner_model_benchmark_v1.md`** (Planner Model Benchmark v1 — 2026-09-01. 위 문서 §7이 「남은
가장 큰 지렛대」로 남긴 **모델 교체**를 외삽이 아니라 실행으로 답한다. **제품 변경 0 · 플래너 기본값
무변경.** 플래너 capability 하나만 움직였고(Draft·Judge 무변경) 프롬프트 v10 · 스키마 · tool
catalogue · 검증기 · 결정론 lane은 arm 사이에서 동일하며 매 arm은 백엔드를 재기동해 프로세스
환경에서 핀을 확인한 뒤 시작한다. 먼저 드러난 것은 **`reasoning_effort` 어휘가 이식되지 않는다**는
것 — shipped 기본값 `minimal`은 두 후보 모두에서 **400**이고(지원값은 `none|low|medium|high|xhigh`),
따라서 모델 교체는 한 줄 변경이 아니다; 공정한 짝은 이름이 아니라 의미(**reasoning 토큰 0**)로
맞춰 baseline `minimal` ↔ 후보 `none`이다. eval set은 PO QA·회귀에서 실제로 깨진 문장과 paraphrase
**53문장/16그룹**(그룹 = 대화 하나)이고 채점은 문장이 아니라 **제품 결과** — 어느 행이 어떤 순서로
그려졌는가(id), 채널·상태가 맞는가, 초안이 **어느 문의에** 붙었는가, 결정론 lane이 모델을 부르지
않았는가. 코퍼스는 제품 자신의 signup으로 만든 **일회용 org**(문의 15 · 리뷰 14 · 이슈 2 · 상품 3 ·
정책 3 · 주문 60행, 실제 판매자 데이터 0). 결과: baseline `gpt-5-2025-08-07`@minimal **73.1%**
(212 turn) · plan p50 3,143ms · p95 6,983 · $1.007/100호출 · **hard FAILED 0/212**; `gpt-5.6-luna`
@none 72.6% · p50 2,638 · $0.142 · FAILED 5/106; **@low 79.7%(212) · p50 4,232 · $0.159 · FAILED
4/212**; `gpt-5.4-mini`@none 74.5% · **p50 1,835** · $0.537 · FAILED 6/106; @low 75.5% · p50 3,120 ·
$0.631. 입력 토큰이 다섯 arm에서 5,648~5,662 상수인 것이 프롬프트 동일성의 증거다. **대표 failure**:
mini@none은 flagship 심층 문장(「반복해서 문제가 생기는 상품」)에서 **도구를 0개 부르고** 두 pass
모두 「리뷰 신호는 이번 조사 계획에 포함되지 않았습니다」였다(baseline·luna는 `search_review_issues`
+ evidence ×2로 「포장 파손 4건」을 짚는다); luna@none은 분명한 문장(「논슬립 주방 매트 리뷰는
어때?」)에서 계획 자체를 실패한다; luna@low는 baseline이 **4 pass 전부** 재현하는 new-list scope
오염(「그거 어떻게 처리하지?」에 대시보드를 지어내고 이어진 「미답변 문의 보여줘」에 「방금 본 문의
중 …없습니다」)을 없애 5개 turn에서 앞서지만, **「답변 초안 만들어줘」가 4/4 → 2/4로 회귀**한다(원인은
초안 능력이 아니라 앞 turn의 범위 해석). **판정: 어떤 후보도 「correctness 유지 + latency·cost 동시
하락」을 만족하지 않는다 ⇒ 기본값 무변경**(애매하면 바꾸지 않는다). **product-owner 결정으로 올림**:
luna@low로 교체하면 정확도 +6.6pp · 비용 −84% · turn p95 10.1→9.0s를 얻고 플래너 p50 3.1→4.2s(+35%)와
초안 chain 회귀를 잃는다 — 결정한다면 파일럿 org의 실제 코퍼스에서 같은 eval set을 한 번 더 돌리는
것이 옳다. 정직 보고: 비용 단가는 벤더 페이지의 **외부 사실**이고 저장소가 검증할 수 없다; 첫 시도는
판매자 **일일 AI 예산**(기본 200)을 올리지 않아 baseline 106 turn 중 64개가 모델이 아니라 예산의
행동을 재고 있었다(모든 arm에 동일하게 상향, 제품 코드 무변경). **마켓플레이스 호출 0 · WRITE 0 ·
마이그레이션 0 · 제품 소스 변경 0** ⇒ evidence 행 없음.)

**`docs/conversation_contract_correctness_v2.md`** (Conversation Contract Correctness v2 — 2026-09-01.
Planner Model Benchmark v1의 53-turn eval에서 **다섯 모델이 공통으로 틀린 10 turn**은 모델의 성질이 아니라
**이 저장소의 계약**이다. 예문별 patch가 아니라 감사가 찾은 **다섯 원인**에서 닫았고, 바뀐 것은 전부
「말 → scope → target → constraints → capabilities → execution」의 어느 칸이 비어 있었는가로 설명된다.
**플래너 모델 무변경**(`gpt-5-2025-08-07` @ `minimal`)이고 **결정론 goal planner는 여전히 0** — 더한 결정론은
계획의 **실행 조건**에만 붙는다. **A 표현할 수 없는 제약은 조용히 사라진다**: `period`가 닫힌 7토큰이라
「최근 3일」이 축을 비운 채 도착해 15건 전부를 답했다 ⇒ 축에 값이 아니라 **모양**을 줬다(`LAST_N_DAYS` +
`periodDays` 1~365, 프롬프트 v11이 「가까운 토큰으로 바꾸지 말라」고 말하고 `periodLabel`이 판매자가 말한
숫자로 되말한다; 나머지 축은 닫힌 토큰 그대로). **B 말하지 않은 제약을 읽기가 만든다**: 「별점 낮은 리뷰
보여줘」에 기간이 없는데 답이 「최근 7일 …3건」이었고 판매자가 가진 것은 **8건** — 라벨이 창을 밝혔으니
**문장은 정직했고 답은 틀렸다**. 기본 창은 런타임과 백엔드 **두 층**에 있었고 둘 다 닫았다(**없는 하한은
하한 없음** — `GET /api/inquiries/rows`는 처음부터 그랬고 `reviews/recent`만 7일을 넣고 있었다; 창이 없으면
freshness는 채널 상태로 판정하고 증거의 기간은 **돌아온 행들 자신의 범위**다). **C 읽지 못한 토큰이 좁히는
조건이 된다**: 세 lane(`subjectTermOf`·`visibleFilterOf`·`visibleSelectionOf`)이 각자 무시 목록을 갖고 같은
부류를 빠뜨렸다 — **가리키는 말**. 「그중 …거 하나만」의 `하나`가 주어가 돼 「하나 관련 문의는 없습니다」,
「배송이 너무 늦습니다 이거 보여줘」의 `이거`가 모든 행이 포함해야 할 문자열이 돼 목록 15건이 다시 인쇄됐다
— 셋 다 「좁히지 못할지언정 틀리게 좁히지 않는다」를 적어 두고 **읽지 못한 토큰을 조건으로 승격**하고 있던
같은 역전이다 ⇒ **`conversation/reference.ts` 하나**가 지시어(두 목록의 곱으로 생성)·고유어 수사·수량
표현(3일·이틀 — 단, **3호·16mm 같은 규격 값은 진짜 주어**)·의문사·관형형 어미·의존명사를 갖고 세 lane이
`namesContent()` 하나를 묻는다. 그 위에 **관계절의 동사는 주어가 아니다**(표지가 연 명사구 전체를 잡아
**머리명사에 가장 가까운 내용어**를 고르고, 앞 명사구를 닫는 명사에서 멈춘다 — 「재입고 언제 되냐는 문의」가
`q=되냐`를 보내고 있었다)와 **leftover는 주어의 증거가 아니다**(문장이 `만` 또는 주어 표지로 **표시**해야
한다). **D 대상 단계가 이번 turn의 객체를 못 본다**: 행 하나를 찾고도 「어떤 문의인지 알려주세요」였다 —
`inquiryFromHistory`가 **이전 turn들**만 뒤지기 때문 ⇒ 이번 turn이 그린 행을 먼저 보되 **서수는 저장된
집합만** 읽는다(세지 않은 서수에 답하지 않는다). 그리고 **행위는 대상을 가질 수 있어야 한다** — PREPARE를
고르고 문의를 읽는 도구를 하나도 부르지 않은 계획이 관측돼, 대상이 안 풀리면 **문장이 스스로 말한
좁힘**(topic 또는 주어)으로 **bounded READ 1회**를 한다(새 goal을 고르는 두 번째 플래너가 아니라 **전제
조건**이고, 0건·2건 이상이면 예전처럼 되묻는다). **E 참조는 focus에 묶이거나 되묻는다**: 1행 집합의 지시
대상은 하나뿐인데 결정론 lane은 `selectedInquiry`에만 묶어 「이 고객한테 뭐라고 답해야 해?」가 org 큐를 읽고
WAITING_HUMAN으로 끝났다(플래너의 `resolveTargets`는 **처음부터** 1행 집합을 대상으로 취급하고 있었다 —
두 경로가 「이 문의」의 뜻을 다르게 알았다) ⇒ `focusInquiryOf` 하나로 통일; 그리고 **지시 대상 없는 참조는
조사를 승인하지 않는다**(빈 스레드의 「그거 어떻게 처리하지?」가 org의 주문·문의 큐·체크리스트를 3.7~9.1초
걸려 조사했다 ⇒ 이제 **모델 0회·도구 0회**로 되묻고, 내용어가 하나라도 있으면 그대로 플래너의 것이라 이
분류는 **플래너로 보내는 실수만** 할 수 있다). **NEW LIST와 refine이 섞이던 경로**: 「배송 관련 문의만
봐줘」 뒤의 「답변 안 한 문의 보여줘」가 「방금 본 문의 중 배송 관련 …1건」으로 돌아왔다(미답변 12건을
1건으로) — 규칙은 이미 있었고(`visibleFilterOf`의 Conversation Core v1 §9 refine 표현 요구) 없던 것은
**플래너 경로도 그것을 읽는 것** ⇒ 다섯 번째 override **`NO_REFINE_EXPRESSION`**. `~만`의 뜻은 **붙은 명사가
정하고**(대명사류=refine, 영역 명사=새 질문), **조각은 여전히 refine**이라 문장이 **스스로 설 때만** 적용된다
(「배송 관련부터」는 자기 대상이 없으므로 무변경). **F 같은 축의 두 구현이 다른 필드를 봤다**: 화면 lane은
제목·스니펫·**상품명**을 맞췄고 백엔드는 텍스트 두 칸만 봐서 「실리콘 몰딩 관련 문의 있어?」가 5건을 두고
「없습니다」였다 ⇒ `q` 술어에 org-scoped `exists` 하나(새 파라미터 0·새 축 0·추가 READ 0). **검증**: 같은
org·같은 rubric·같은 모델에서 53-turn 회귀 **73.1% → 94.3%**, 그리고 한 문장도 재사용하지 않은 **23-turn
unseen** paraphrase/multi-turn **100%**(그 검사가 결함 둘을 더 찾았다 — 「3일」과 「이틀」이 주어가 되고
있었다). 라이브 브라우저 multi-turn QA 13종(로그인 → 목록 → refine → 새 목록 → 기간 → 리뷰 → 지시 대상
없음 → focus → 라벨 선택 → 수량 → 서술된 대상) 통과, off-host 요청 0. runtime 773 · backend 3,593 · 실패 0.
**정직 보고**: 계약이 바뀌어 **테스트 3건을 다시 썼다**(「별점 2점 이하 리뷰」 기대 문장에서 「최근 7일」이
빠졌다 — 판매자가 말하지 않은 기간을 답이 주장하지 않는 것이 이 패키지의 요지다). **고치지 않고 보고**:
「우리 상품 목록 보여줘」는 **capability가 없다**(도구 카탈로그에 상품 목록 READ가 없고 새 need kind·프롬프트
어휘가 필요하다 ⇒ **product-owner 결정**; 대신 그 답이 같은 문장을 두 번 말하던 결함은 **문장 단위 dedupe**로
닫았다), G02.2 「교환 문의는?」의 topic-vs-주어 두 읽기는 **제품 결정**, 그리고 플래너 변동성은 그대로다 —
이 패키지는 계획 **이후**를 결정론으로 만들었을 뿐 계획 자체를 고정하지 않는다. **마켓플레이스 호출 0 ·
WRITE 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음.)

**`docs/agentic_experience_ux_v2.md`** (Agentic Experience + UI/UX v2 — 2026-09-01. 「채팅으로 데이터를
조회하는 봇」이 아니라 **현재 업무를 알고, 먼저 판단하고, 다음 행동까지 준비해 두는 운영 담당자**로 읽히게
만드는 패키지. **conversation semantics 무변경**(결정론 lane·scope 규칙·`subjectTerm`/`reference`·
`scopeOverride`·focus contract·승인 경계 전부 그대로). 실제 브라우저로 8개 흐름을 before/after 촬영해
판단했다. **§4 인사말은 브리핑이 아니다** — 「안녕하세요.」가 페이지에서 가장 큰 글자였고 그 아래 숫자 줄,
그 아래 같은 말을 **일까지 붙여** 하는 브리핑이 있었다(행동 가능한 것이 나오기 전 세 겹) ⇒ 브리핑이 있으면
인사말은 숫자 줄로 내려가고 브리핑이 헤드라인이며, 첫 연결 전에는 브리핑이 없으므로 헤드라인이 남는다;
브리핑 행은 **왜 위에 있는지**(`waitingDays`)를 든다 — 「1개월 전」은 접수일이고 「40일째 대기」가 이유다.
**§5 순위 질문은 어느 것인지 답한다** — 「…12건 중 먼저 보실 1건입니다」는 판단 자리에 놓인 **개수**였다 ⇒
`urgencySentence`가 **「먼저 보실 것은 「제목」입니다 — 40일째 대기 중입니다」**로 시작하고 개수는 순서를
설명하는 자리로 물러난다; 랭크된 목록은 **자기가 판단한 행을 펼친 채로** 도착해 고객 문장과 「답변 준비」가
바로 보이고, 같은 동작을 되풀이하던 칩은 제거(한 동작이 15cm 떨어져 두 번 렌더되면 판매자가 어느 쪽이
진짜인지 고른다). **§2 답변과 한계는 다른 칸이다** — `TurnView.notes`: 같은 문장·같은 결정론이고 자리만
바뀌었다(정직성 감소 0, 「said once」 테스트는 `message`+`notes`로 재작성). **§3 리뷰·상품 행도 문의 행과
같은 객체**(제자리에서 펼침 · 워크스페이스는 보조 아이콘)이되 **리뷰는 anchor되지 않는다**(focus contract는
문의만 이름 짓는다 — 흉내내지 않는다). **§6 한 사실은 한 번만**, 규칙 넷 전부 일반 규칙이다: 문장이 이미
말한 제목의 카드 헤더 미렌더(접근성 이름은 유지) · 위 문장을 그대로 되풀이하는 블록 미렌더 · 모든 행이
공유하는 단어는 캡션에서 한 번(「부정」 ×8 → 「모두 부정 리뷰입니다.」) · **STEP 카드가 든 채널은 목록
footer에서 제외**(같은 상태를 말하면서 고치는 컨트롤까지 가진 쪽이 이긴다). **§7 진행은 한 줄**(끝난 단계는
같은 줄의 조용한 자취 — 여전히 런타임이 보고한 단계만, 가짜 진행 0). **§8 상품 목록은 capability이지 거절이
아니다** — 직전 패키지가 product-owner 결정으로 올린 항목을 구현: READ tool `list_products`(기존
`GET /api/products`, 빈 질의 = 백엔드의 catalog head; `resolve_product`에 빈 문자열을 넣는 것이 **아니다**),
need kind **`PRODUCT_CATALOG`**(구조상 ORG scope — 「우리 상품」에서 읽힌 PRODUCT mention이 「전부 보여
달라」는 유일한 need를 좁히면 안 된다 · `CURRENT_STATE` · precondition **`NONE`**), ProductOps가 **resolve
이전에** 답하고 카탈로그만 물었으면 resolve 호출 0, 답은 **둘 중 무엇인지 말한다**(상한 미만이면
「등록된 상품은 N개입니다」, 가득 차면 「이름순으로 N개」+전체 링크 — 백엔드가 총계를 주지 않으므로 이것이
가능한 유일한 정직한 구분), 프롬프트 **v12**. tool catalogue는 여전히 **100% READ**. **§9 아무것도 묻지
않은 specialist는 아무것도 보고하지 않는다** — 「…는 이번 조사 계획에 포함되지 않았습니다」는 우리 플래너에
대한 사실이지 판매자 사업에 대한 사실이 아니었다(필수 need의 침묵 가드는 그대로). 검증: runtime 780 ·
frontend 2,603 · backend prompt suite · 실패 0 · typecheck clean, 일회용 QA org(제품 자신의 signup, 실제
판매자 데이터 0)에서 라이브 브라우저 8흐름 before/after · 콘솔 오류 0 · off-host 0. **마켓플레이스 호출 0 ·
WRITE 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음. **정직 보고**: 계약이 바뀌어 테스트 3건을 다시
썼다(인사말·진행 한 줄·`said(turn)`); 「너는 어떤 일을 도와줄 수 있어?」는 여전히 운영 조사로 계획된다(어시
스턴트 자신에 대한 질문은 capability가 없다 — **product-owner 결정**이고, 여기서 canned intent를 만드는 것은
이 패키지가 피한 바로 그 예문별 patch다); 랭크된 목록은 클릭 없이 bounded detail READ 1회를 쓴다; 리뷰·상품은
여전히 anchor 대상이 아니다.

**`docs/frontend_agent_workspace_v1.md`** (Frontend-first Agent Workspace Redesign v1 — 2026-09-01. 기능
추가가 아니라 **이미 동작하는 Agent가 유능한 운영 담당자처럼 읽히게** 만드는 패키지. planner·retrieval·
conversation semantics **무변경**(결정론 lane · scope 규칙 · `subjectTerm`/`reference` · `scopeOverride` ·
승인 경계 전부 그대로). 감사는 실제 브라우저 8흐름을 **1440/1366/1152** 전 폭에서 찍고 화면당 컨테이너·
배지·AA 위반을 센 뒤에 시작했다. **R1 상자의 더미**(화면당 둥근 상자 5~10, 테두리 요소 최대 22) ·
**R2 같은 행동이 세 번**(행마다 ↗ 아이콘 + 행 안의 버튼 + 카드 footer 링크, 공유 상태어 「답변 필요」 ×5,
접수일과 대기일 나란히) · **R3 시스템 상태가 일보다 무겁다**(고객 불만 8건이 주제인 화면에서 유일한 solid
버튼이 「최신 상태로 갱신」) · **R4 판매자가 받을 것이 가장 작은 글자**(초안 16px regular, 회색 상자 안,
17px 안내문 아래) · **R5 문의만 객체**(상품 행은 누를 수 없고 리뷰 행은 현재 객체가 될 수 없다) ·
**R6 사이드바의 지난 대화가 내비게이션보다 무겁다** · **R7 자기 자신에 대한 질문에 판매자의 배송 정책으로
답한다** · **R8 홈 AA 위반 2건**(장식 「·」 1.12:1). 고친 것: **리듬과 무게**(턴 사이 24 · 턴 안 12 —
턴 안의 어떤 것도 턴처럼 떨어지지 않는다; 답변은 컨테이너 없는 산문 `base` 16/1.7이고 **자기 턴에서 가장
큰 글자가 아니다**), **행마다 컨트롤 하나**(행이 곧 컨트롤이고 워크스페이스 링크는 그 행 안에 텍스트 링크로
한 번), **판매자가 연 객체가 가장 큰 글자**(고객 문장·초안 `lg`, 초안은 상자 안 상자를 그만두고 왼쪽 선
하나로 인용), **한 사실은 한 번**(`sharedWord.ts` — 모든 행이 공유하는 낱말은 캡션에서 한 번, 판매자가 그
상태를 **요청했으면 아예 말하지 않는다**(신호는 `scope.status`); 대기일은 접수일을 **대체**한다; 카드 헤더는
한 줄), **시스템 상태는 secondary**(제안된 갱신은 outline, 답이 실제로 기다리는 단계만 solid; 홈 freshness는
warn에서 muted로), **현재 객체 3종**(문의·상품·리뷰가 같은 focus contract를 쓰고 한 번에 하나; 상품은 스레드가
그린 행이면 읽기 0, 아니면 상품 화면 launch와 **같은** org-scoped READ 1회, 리뷰는 **이 대화가 그렸다는
기록**으로만 확인 — 단건 리뷰 endpoint가 없고 클릭을 확인하려고 없는 읽기를 만들지 않는다. **상품은 이름을
부르고 리뷰는 설명한다** — 상품명은 판매자의 카탈로그 라벨이라 새로고침을 넘고, 리뷰 본문은 고객의 것이라
계약상 transient이므로 「선택한 리뷰」 + 닫힌 사실(상품·★·날짜); ContextBar는 **입력창에 붙어** 하나의 윤곽이
된다), 그리고 **§8 자기 자신에 대한 질문**: `EXPLAIN_CAPABILITY`는 이미 있었고 라우팅도 맞았으나 **채널
하나에 대해서만** 답할 줄 알았다 ⇒ 채널을 말하지 않고 **조회할 것도 선언하지 않은** 계획(플래너의 구조,
문장의 낱말이 아니다)은 어시스턴트에 대한 질문으로 읽고, 답은 **파생**된다(`AssistantCapability.ts` —
등록된 도구를 가진 specialist에서 도메인, `get_channel_coverage` READ 1회에서 연결된 채널, 그리고
`registry.actionClasses()`에서 경계: 카탈로그가 READ 전용인 것은 `OperatorToolRegistry`가 생성 자체를
거부하는 성질이다). 예문 하드코딩 0 · 손으로 관리하는 기능 목록 0, 프롬프트 **v13**이 이 질문에 need를
세우지 말라고 가르친다(배송 기준 인용이 거기서 나왔다). 검증: runtime 789 · frontend 2,615 · backend 3,593 ·
실패 0, 8흐름 전후 3폭 라이브(일회용 QA org, 실제 판매자 데이터 0) · **AA 위반 3폭 전부 0**(2→0) · 콘솔 오류
0 · 가로 스크롤 0 · 둥근 컨테이너 61→54(`d-capability`만 2→5로 늘었고 그것이 §8의 요점이다). **마켓플레이스
호출 0 · WRITE 0 · DB 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음. **정직 보고**: 리뷰 anchor는 유지되지만
「이 리뷰에 대해」를 답하는 lane이 없다(단건 리뷰 읽기 부재) — 이 패키지 안에서 「이 리뷰」를 그 리뷰의 상품으로
푸는 것을 **시도했다가 되돌렸다**(라이브에서 「이 리뷰는 어떤 상품 문제야?」가 그 상품의 최신 ★5 리뷰로
답했다; 한 객체를 가리키는 지시어가 다른 객체에 대한 scope로 조용히 바뀌면 안 된다), 한 채널의 수집 상태가
STEP 카드와 note 줄에서 두 번 말해질 수 있다(runtime note에 채널 태그가 없어 병합하려면 산문 매칭이 된다),
브리핑 카드 제목의 근사 중복, 연결 전 첫 화면은 이 org에서 여전히 관찰 불가).

**Design contract:** `docs/reviewnary_design.md` — 40~50대 비기술 판매회사 대표를 기준 사용자로 하는
`frontend/` 디자인 계약(타이포 스케일 · 간격 리듬 · 콘텐츠 폭 · 표면 위계 · CTA 위계 · 상태 색 ·
Agent 브리핑 · 구조화 객체 카드 · 근거 공개 · 빈/로딩/오류 · 접근성 · 반응형). **코드가 이미 하는 것의
기록이고 새 디자인 시스템이 아니다**; 여기 없는 색·서체·컴포넌트 라이브러리는 이 문서가 허가하지 않는다.

**Demo org / channel knowledge:** `docs/demo_org_and_channel_knowledge_v1.md` owns the canonical Demo
Org's **provenance contract** (`REAL` / `DEMO_SEED` / `VERIFY_FIXTURE`, default reads exclude synthetic),
the **vault key diagnosis contract** (a credential is opened with the key that sealed IT; `KEY_MISMATCH`
is proven by fingerprint, not guessed), and **Channel Knowledge v1** (platform knowledge — never
seller-specific policy). It moves no capability status; §4.1 keeps all three.

**Screens:** `docs/product_assembly_ia_v1.md` owns product IA, screen responsibility and the visible
channel set (supersedes frontend spec §5–§8·§17-A); `docs/sellerops_frontend_spec.md` owns frontend
principles (states, seller language, a11y, capability honesty, guided connection, Action Window screens).

**Scope-lock companions:** v1.9 Self-Pilot Runtime → `docs/self_pilot_runtime_v1.md`; v1.10 Auth + Growth
Instrumentation → `docs/auth_growth_instrumentation_v1.md`; v1.11 Service Readiness →
`docs/service_readiness_v1.md`.

**Derived views (never promote a status):** `docs/channel_capability_ledger.md` (channel lessons) ·
`docs/channel-capability-registration-matrix.md` (registration cross-view) ·
`docs/channel_integration_completeness_audit_v1.md` (per-capability reachability).

**Evidence rule.** Every live run gets a row in `docs/evidence/INDEX.md` in the same PR that lands its
proof. **Landing a proof document without a row there is a defect** — an unlinked proof is how Coupang
`ORDER_SUMMARY` stayed recorded as "인증 골격만" for two weeks after it was live-proven
(`docs/channel_integration_completeness_audit_v1.md` §5). A proof file may only be retired once its row
carries its whole unique claim.

**Status lives in workstream homes, not here:** Action Window runtime → `docs/action-window-runtime/`
(`HANDOFF.md`); Action Window frontend → `docs/workstreams/action-window-frontend/` (`progress.md`);
ESM live capture → `docs/esm/` (`live-capture-checklist.md`); review operations MVP →
`docs/workstreams/review_operations_mvp.md`; **review AI triage demo ("리뷰 AI 데모 준비" and the like) →
`docs/workstreams/review_ai_triage_demo.md`** (canonical entry point). A router carries paths, not state.

### Conflict priority

1. explicit product-owner decisions from the current task
2. `docs/product-scope-v1.md`
3. `docs/product_assembly_ia_v1.md` (IA / screens / visible channels), then `docs/sellerops_frontend_spec.md`
   (frontend principles)
4. `docs/sellerops_local_agent_runtime_adr.md`
5. `docs/multi-channel-connector-roadmap.md` §4.1 (living capability table)
6. the active slice document (`docs/slices/*` — index: `docs/slices/README.md`)
7. current implementation evidence
8. historical records under `docs/archive/` and the r4 evidence in `docs/action-window-runtime/`

Implementation evidence may reveal docs are stale, but must not silently redefine product intent —
**report the conflict** instead. That is exactly how the Coupang `ORDER_SUMMARY` correction happened.
For Action Window *status*, `docs/action-window-runtime/HANDOFF.md` wins.

### Assumption rule

Do not invent product, UX, channel-support, API, or security decisions. Verify repository facts
before relying on them. Surface product-owner decisions rather than resolving them. Classify every
unresolved point as: repository-verifiable, external-research required, or product-owner decision.
When uncertain, stop and report rather than guess.
