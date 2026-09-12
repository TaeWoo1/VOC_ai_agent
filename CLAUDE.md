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
만들지 않았다). **`docs/image_product_knowledge_v1.md`**(Image Product Knowledge v1 — **설계만, 구현 0**. 08-26 승인 `apr-nv-detail-13250364547-r2`로 요청 **1회**: 이 판매자의 상세페이지는 `IMAGE_REFERENCES_ONLY`이고 텍스트 **104자** · 이미지 **26장** · 옵션 **20/20 id 보유** ⇒ verdict **`IMAGE_ONLY_GAP`**. 측정이 닫은 것은 **텍스트 경로뿐**이었고 옵션 이름의 내용은 미관측이었다 — 프로브가 판매자 콘텐츠를 한 글자도 내보내지 않기 때문이며(설계 결과이지 결함이 아니다), A/C를 가르는 비용은 **READ 1회**였다. **그 1회를 썼고 판정은 뒤집히지 않았다** — 승인 `apr-nv-option-13250364547-r1`(요청 1 · WRITE 0 · 저장 0): `options=20 axes=2 spec_bearing=20 capacity_bearing=0`, 즉 **규격은 옵션 라벨에 이름으로 있으나** 수용 가닥수는 20개 전수에서 관계어 **0건** ⇒ 후보 **B `VARIANT_LABEL_ONLY`**, `IMAGE_ONLY_GAP` **CONFIRMED**. `(##개)`를 가닥수로 읽지 않았다 — 숫자는 관계가 아니고 그 추론이 바로 원래 결함이다(`OptionSemantics`는 관계 **단어**를 요구하고 의도적으로 과소 계수하며 판매자 라벨은 **자릿수 마스킹**으로만 나간다: `16x10mm`→`##x##mm`, 패턴 상한 3). 부수 소득: `SpecApplicability.VARIANT_NAMED`가 NAVER에서 **구조적으로 도달 가능**함이 확인돼 §6의 「규격 라벨 없는 수치는 저장 거절」이 실행 가능한 규칙이 됐다. 상태는 이제 **`TEXT_LANE_WIRED` · `IMAGE_LANE_UNBUILT` · 비용 전제 `UNVERIFIED`**다 — payload floor는 **승인**됐고 착수 순서는 **텍스트 우선**으로 정해졌다. 그래서 지어진 것은 이미지 lane이 아니라 그 바닥이다: 감사 결과 `ProductDetailEnrichment`는 `main`에서 **caller 0**이었고 채널 유래 지식 문서도 **0**이었으므로 이미지 lane은 **한 번도 돈 적 없는** 텍스트 lane 위에 설계되고 있었다 ⇒ `ProductDetailEnrichmentTrigger`가 세 조건(actionable inquiry · exact attribution · 지식 없음/오래됨) 전부일 때만 상품 **하나**를 읽는다(sweep 0, 스케줄러 0, 실패는 초안을 죽이지 않는다); `detailContent`의 `<img src>`만 투영하고 **listing gallery는 grounding source 금지**(구조 테스트); **SSRF-safe CDN fetch 계약**(https 전용 · 문서에서 뽑은 URL만 · 인증 헤더 0 · 리다이렉트마다 재검증 · content-type 화이트리스트 · 바이트 상한 · 사설/메타데이터 주소 거부, 범용 fetcher 노출 금지). **Stage 0 census 실행됨**(`apr-nv-image-census-13250364547-r1`, 마켓플레이스 1 · CDN 26 · **모델 0** · DB 0): `unique_sha256=26 duplicate_fetches=0 reuse_ratio=1.00`, 3.65MB/26장 — **상품 하나 안의 중복은 0**이고, 설계가 기댄 **상품 간** 재사용은 카탈로그를 읽어야 재는 것이라 **이 census가 답할 수 없다** ⇒ 비용 전제는 `UNVERIFIED`로 남고 다시 product-owner 결정이다. 이미지 lane 코드는 여전히 **0**이며 `AI_EXTRACTED_FROM_SELLER_IMAGE` 생산자 0 테스트는 초록이지만, 그 authorship이 선언만 하고 아무도 적용하지 않던 `carriesExactFiguresUnaided()`는 **이제 production에서 적용된다** — 근거 중 하나라도 그림에서 왔으면 규격 적용 범위 줄이 격상되고, 새 seam·payload floor 변화는 0이다. 붙을 자리는 새 파이프라인이 아니라 이미 있는 `ProductDetailEnrichment`의 `Outcome.IMAGE_ONLY`이고 어휘도 이미 있다 — `AI_EXTRACTED_FROM_SELLER_IMAGE`는 생산자 0이 테스트로 고정돼 있어 **그 테스트가 이 lane의 스위치**이며 조용히 켜지지 않는다. 상세 이미지 **한정**(리뷰·첨부 제외) · 상품당 상한 · **바이트 해시** dedupe(판매자는 같은 배너를 온 상품에 재사용하므로 비용의 분모는 상품 수가 아니라 **고유 그림 수**이고 그 비율 측정이 **첫 작업** — 무너지면 착수하지 않는 것이 옳다) · **규격 라벨 없는 수치는 저장 거절**(「3~4가닥」만 뜬 조각이 바로 이 사건을 다시 일으키는 모양이다) · 실패 격리로 최악이 **오늘**. **가장 큰 안전 델타에 이름을 붙여 둔다** — payload floor의 성질이 바뀐다: 우리가 고른 문장이 아니라 **판매자 이미지 원본**이 모델로 나가고 그 안에 무엇이 찍혀 있는지 보내기 전에 모른다 ⇒ 착수는 비용 판단이 아니라 **product-owner 결정**이며 이 문서는 그 질문에 답하지 않는다. 세 번째 LLM capability는 앞의 둘과 같은 격리 규율을 진다. 대규모 OCR pipeline · vector DB · generic document ingestion **금지**. **Stage 1 준비 완료·모델 호출 0**(§10, 08-27): 트리거 **기본값 OFF**(라이브 미검증 capability가 머지만으로 판매자 채널을 읽지 않는다 — 평범한 boot은 상세 READ 0), **cross-product census는 하지 않기로 결정**(v1 경제성은 실제 문의가 가리킨 상품 하나로 판단하고 cache table도 만들지 않는다; 파일럿 중 해시가 쌓이면 재평가), 텔레메트리 `reuse_ratio` → **`unique_ratio`+`dedupe_hit_ratio`**(계산한 것은 unique/fetched였으므로 「재사용률」은 정반대 이름이었다), **규격 지속성**은 코드가 이미 옳았고 없던 것은 그 순서를 고정하는 테스트였다(`writeOptions`가 shape 판정 앞 ⇒ 그림 페이지도 옵션 20을 쓴다; 대상 상품은 API 20/저장 0이었다), **26장 전수**(spec-bearing image를 누락하지 않는 결정론적 pre-filter가 없으므로 「12장이면 충분」은 근거 없는 절단), **one-image-per-call 유지**(묶어서 아끼는 것은 상수 프롬프트뿐 ≈$0.005이고 파는 것은 provenance 보장이다), 그리고 **벤더 감사**: 설정 모델 `gpt-5-2025-08-07`은 벤더 문서에서 **deprecated·종료 예정**으로 표시돼 있고 이미지 토큰화도 타일 기반(70+140/타일)이다 — 여섯 capability 전부의 기본값이므로 **모델 갱신은 product-owner 결정**. 비용은 관측 치수 기반 산식으로 상품당 **≈$0.03~$1**(장별 치수는 census가 남기지 않아 정확한 합계는 Stage 1이 낸다), 지연은 **UNMEASURED**. **영구 처리 영수증은 기존 seam으로 표현 불가**로 판정하고 테이블을 만들지 않았다 — `ProductKnowledgeSource`로 표현하면 본문 없는 문서가 「등록된 지식 N건」을 부풀리고, `SyncCursor`는 이미지 단위를 담지 못한다 ⇒ 최소 contract만 §10-4에 적었다). **Stage 1 라이브 실행됨**(§11, `apr-nv-image-knowledge-13250364547-r1`, 08-27): 모델 `gpt-5.6-terra`(이 capability만 별도 model property — 나머지 다섯의 기본값은 건드리지 않았다), 마켓플레이스 1 · CDN 26 · **vision 26회** · WRITE 0 · 실비 **$0.104**(이론 상한 $0.556 ≤ 승인 $0.75, 그 상한은 `detail:high`의 2,500 patch 캡과 출력 1,200 토큰에서 나오며 **테스트가 계산한다** — `auto`는 이 모델에서 patch 예산이 없어 상한을 말할 수 없다). **추출은 됐고 채택은 0이다**: triple 48 · `NO_FACTS` 16 · 실패 3, 그리고 **발행 0 · 판매자 화면 무변화**. 이유 둘 — (1) 이미지의 `#호`·`WOOD`와 채널 옵션 `그레이 / #호(##개)`는 **다른 문자열**이라 exact match 0(포장 수량을 떼거나 영문을 국문으로 옮기는 것은 인코딩 보정이 아니라 추측이다), (2) **찾던 사실이 그 페이지에도 없다**(가닥·심선·코어 관련 attribute 0건; 적혀 있는 것은 외경/내경 치수·재질·원산지). 즉 **48개의 그럴듯한 사실을 쥐고 하나도 내보내지 않았다** — 「읽었다」와 「말해도 된다」의 분리가 관측으로 확인됐다. 부수 결함 둘도 닫혔다: `ProductDetailEnrichment`가 문서를 저장하면서 **청크를 만들지 않아** `TEXT_INDEXED`가 검색 불가능한 문서를 가리키고 있었고(`ProductKnowledgeIndexer`로 추출해 두 writer가 공유), receipt identity는 **`(org, product, sha, extractor, model)`**이다 — `(org, sha)`는 cross-product cache가 되므로 금지. 남은 product-owner 결정: **채널 옵션 이름의 선언적 축 분해를 허용할 것인가**(fuzzy가 아니라 채널 포맷 파싱이지만 새 규칙이다) · 영문↔국문 색상 대응은 **사전이고 사전은 ontology의 시작**이라 더 위험하다) · **`docs/cafe24_comment_answer_observation_v1.md`**(카페24 board-6 답변 표현은 **하나가 아니다** — 승인된 bounded READ `apr-c24-a3674-obs`(요청 7 · WRITE 0 · DB 변경 0, 대상은 운영자 본인의 「연동 테스트」 글 셋뿐이라 실고객 문의 무접촉)로 verdict **`STANDARD_BOARD_COMMENT`** 확정: 판매자가 관리자 화면에서 등록한 답변이 **댓글**로 존재했고 자식 글은 0, 긴급문의 경로는 해당 없음. **핵심은 댓글 답변이 `reply_status`를 바꾸지 않는다는 것** — 14:56 답변 뒤 routine sweep이 17:43에 재수집하고도 미답변으로 저장했으므로 이것은 신호 오독이 아니라 **관측 표면 밖**이었다. 행위자는 추정이 아니라 **동일성**(`member_id == mall_id`, 플랫폼이 문서화한 상점명 렌더링 조건, 08-25 actor probe에서 43/44 관측)으로 확정하고 그 비교의 **boolean만** 흐른다 — id·본문·작성자명은 public record에 필드가 없다. 수정은 `Cafe24InquiryAnswerObserver` 하나: 문서화된 `comment=T` 필터로 발견 1회 + 후보당 댓글 READ 1회(상한 20)이고 후보는 이 페이지가 미답변으로 저장했을 행뿐, **댓글은 문의로 수집되지 않으며** 증명된 판매자 댓글만 부모를 `ANSWERED`로 만든다. **downstream 0**(`becameAnswered` → `reconcileConnectorAnswered`가 이미 OPEN work item을 닫는다), 새 scope 0, 새 테이블·phase·event 0, 그리고 **`answer_body` 미저장** — 「답변했다」와 「이렇게 답했다」는 다른 주장이고 후자는 Answer Memory라는 자체 downstream을 갖는다. `inform_status`는 계속 `N`을 적는다: 채널이 말한 것과 우리가 내린 결론은 다른 칸이다. **라이브 재증명 `LIVE_VERIFIED`**(2026-08-26, `apr-c24-a3674-reproof`, WRITE 0) — 진단 러너가 아니라 판매자에게 실제로 도는 routine sweep 안에서 요청 2회(발견 1 + 댓글 1)로 대상을 `ANSWERED`로 옮겼고 `answered_at`은 댓글 자신의 시각(14:56:24), `inform_status`는 여전히 `N`, org 미답변 35→34; 승인된 READ 결과를 DB에 재생하는 흉내는 쓰지 않았다. work item은 `COMPLETED`가 아니라 **`PROPOSED`**에 남는다 — **과거 백로그 정합 `LIVE_VERIFIED`**(`apr-c24-hist-comments`, 요청 **5**/상한 26, WRITE 0): `article_no`+`comment=T` 결합 발견 1회로 25건 중 4건만 좁혀 읽었고 — **그 4건은 이미 답변돼 있었다**(2014·2014·2019·2021, 전부 질문 며칠 안에 답변된 뒤 최대 12년간 「답변 필요」로 방치) — **진짜 미답변 25→21**. `answer_body` 미저장 · `inform_status` 무변경. 그리고 **answered-elsewhere lifecycle**: `reconcileConnectorAnswered`가 이제 `OPEN`과 **`PROPOSED`**를 닫는다(PROPOSED는 AI 초안뿐이고 승인·실행 이전이므로 외부 source truth가 이긴다) — `APPROVED` 이후와 `ACTION_PENDING`·`EXECUTED`는 실행 lifecycle이 계속 소유하고, 새 phase·event·disposition **0**이며 판정은 transition이 아니라 「지금 answered인가」라서 self-healing이다. 화면도 `status`를 읽어 「이미 답변된 문의입니다」를 보이고 전송 CTA를 끈다. **`P`는 fail-closed 유지** — 계약이 스스로 모순되므로(속성표=처리중, 필터표=답변) 오직 결정론적 증거(판매자 댓글·답변 글)만 `ANSWERED`로 옮긴다. 장기 방향은 `docs/operational_knowledge_direction_v1.md`에 기록만 했다 — 운영 지식은 상품 FAQ가 아니며 언젠가 Entity·Fact·Relation·Provenance·Applicability가 되지만 **이번 구현 0**). **`docs/inquiry_thread_semantics_v1.md`**(스레드 의미 복구 — Cafe24 게시판에서 **답변은 질문에 달린 자식 글**이므로 답글은 독립 고객 문의가 아니다: `SourceThreadRole{ROOT,REPLY}`는 출처의 `parent_article_no`/`reply_depth`로만 정해지고 **article 번호 인접성은 판정에 쓰지 않는다**(소스 스캔 테스트); 관계는 새 테이블이 아니라 `thread_role` + `thread_parent_external_id` 두 칸이고 부모를 **같은 external-id 공간**으로 가리킨다. **답글이 판매자가 쓴 것이라는 증명은 없다**(자식에 `reply_user_id` 부재, 작성자 필드는 PII라 미투영) ⇒ `THREAD_REPLY_UNKNOWN_ACTOR`로 보존하고 `answer_body`로 **승격하지 않는다**; 그래서 Answer Memory 연결도 하지 않는다. 신규 수집은 **새 요청·새 endpoint·새 scope 없이** 고쳐진다(그 필드는 이미 모든 응답에 있었다); 제외는 삭제가 아니다 — `EXCLUDED_THREAD_REPLY`(`EXCLUDED_SPAM`보다 우선, projector 단일 writer 유지)로 현재 읽기에서만 빠지고 OPEN work item은 **닫지 않는다**. 작업 큐가 `ACTIVE` 게이트 없이 읽던 결함도 함께 닫았다. historical backlog는 routine 창(14일)이 닿지 않아 **exact `article_no` bounded re-read**를 했다 — 승인된 GET 4회(상한 6)로 **requested 68 / returned 68 / 미응답 0 / 불일치 0**, **proven REPLY 44 · ROOT 24**(미답변 업무의 65%가 고객의 질문이 아니었다; `reply_depth` 최대 2 — 답글에 달린 답글). `inform_status` 공백 44 = REPLY 44 완전 일치이지만 **공백도 인접성도 판정에 쓰지 않았기에** 그 일치가 증거가 된다. **REPLY ≠ 판매자 작성**은 유지(자식에 `reply_user_id` 부재) ⇒ `answer_body`·Answer Memory 승격 0. repair **실행됨**(2026-08-25, **marketplace 호출 0** — 승인된 READ가 남긴 44개 `(article_no, parent)`를 해시로 고정해 재생): 기존 dismissal batch는 **정직하게 표현할 수 없어 쓰지 않았다**(매니페스트가 없던 승인을 요구하고, `ELIGIBLE`이 `OPEN`만 허용해 `PROPOSED` 2건 때문에 실행 자체가 불가) ⇒ 새 테이블·phase·event 0, 새 단어는 disposition **`SOURCE_THREAD_REPLY`** 하나이며 `sellerDecision()` 술어로 **승인 경로 진입 불가**, `phase_from`은 실제 phase, `dismissal_batch_id`는 null. 실측: 미답변 68→**24**, work item OPEN 64→**22**, 작업 큐/Agent 64→**22**, Inbox 69→**25**, 홈 KPI 69→**25**, summary 카드 20→**10**, 삭제 0·proposal 5→5(2건 실행 불가). **20 vs 69는 thread 오염이 아니라 비밀글 필터였고**(제거 후에도 25 vs 10, 간격 15 = 비밀글 15) product-owner decision으로 남는다. WRITE 0) · **`docs/inquiry_workflow_completion_v2.md`** (RAG retrieval correctness — 질문을 답할 수 있는 라이브러리가 0을 돌려주고 답할 수 없는 라이브러리가 1.00을 돌려주던 역전의 원인과 재설계; 사람이 정하는 `USER_CONFIRMED` 상품 연결; NAVER 두 subtype의 **서로 다른** 공식 답변 계약과 그로부터 나온 `OVERWRITE_WITHOUT_PROOF`) · **`docs/inquiry_operational_truth_v1.md`** (문의 operational lifecycle — 셀러의 SPAM dismissal은 current read 전부에서 존중되고, historical backfill은 routine cursor를 재정의하지 않으며, **absence는 삭제로 자동 판정되지 않는다**) · **`docs/seller_operations_knowledge_and_answer_memory_v1.md`** (Knowledge Scope 5종 — `CHANNEL_FACT`·`ORDER_STATE`는 **검색 코퍼스를 갖지 않고** 결정론적 출처에서 그때 읽는다; org 단위 **운영 정책**과 판매자가 실제로 한 **과거 답변**이 상품 지식과 같은 채점기를 쓰는 3-lane retrieval; **AI 초안은 Answer Memory에 들어가지 않는다**(구조 fence)) · **`docs/operational_fact_binding_v1.md`** (주문 결합 — 주문 참조는 **채널이 지목한 것만** 저장하고 본문에서 추출하지 않는다(`InquiryOrderBinding`은 값이 하나이고 그 부재가 fence다); OrderFact는 결제·취소·발송을 **따로** 든다(`cancelled`의 `FALSE` 금지는 08-25 exact READ 도입으로 **저장 경로 한정**으로 좁혀졌다 — 아래 항목); freshness는 `ChannelDataState` 재사용이며 **`ORDER_SUMMARY` 집계가 번 freshness로 개별 주문을 말하지 않는다**; exact single-order lookup 계약 미보유 선언은 **Cafe24에 대해 08-25 정정됨** — 아래 항목) · **`docs/exact_operational_context_v1.md`**(주문 단건 조회 — Cafe24 공식 `GET /api/v2/admin/orders/{order_id}`를 사본으로 고정한 뒤에야 capability를 옮겼고(`ExactOrderLookupCapability`는 vendored 문서를 **이름으로** 가리키며 테스트가 그 파일의 존재를 확인한다), **참조가 있다는 것은 호출할 이유가 아니다**(`OrderFactLookup` — 문의 상세와 초안만 `EXACT_ALLOWED`, 나머지는 전부 `STORED_ONLY`; cache는 표가 아니라 **메모리 5분**), 그리고 `cancelled`의 `FALSE` fence는 vocabulary에서 **SOURCE**로 옮겼다 — `NOT_CANCELLED`는 `EXACT_READ`에서만 살아남고 저장 경로에서 온 값은 record의 constructor가 지운다) · **`docs/pilot_usage_loop_v1.md`**(Pilot Usage Loop v1 — 파일럿에서 **무엇을 성공으로 셀 것인가**의 계약. 감사 결과 **코드 변경 0**: `proactive_case.work_item_id`가 이미 `inquiry_approval`·`inquiry_execution`·`inquiry_verification`으로 가는 조인이고, 초안 채택은 `inquiry_reply_draft`의 append-only `author_kind`+`content_fingerprint`로 갈린다 — 새 이벤트 스트림도 「AI 채택률」 테이블도 만들지 않는다. strong success는 **`VERIFIED` 하나**이며 `ANSWER_POSTED_STATUS_UNRESOLVED`는 성공에도 실패에도 넣지 않는다; `prepared`는 분모일 뿐 성공이 아니고 Agent 메시지 수·토큰·렌더 수는 KPI가 아니다. 지연은 `created_at`이 아니라 **`surfaced_at`** 기준(판매자가 볼 수 없던 시간은 반응 시간이 아니다). 데모 표시 칸을 만들지 않고 **명시적 org 코호트**로 제외하며 canonical Demo Org는 코호트 밖이다 — LIVE_GREEN 증명의 `surfaced_at`은 판매자가 아니라 관측용 브라우저가 남긴 값이었다. 리뷰 lane은 `review_reply_outcome.verification`이 `UNVERIFIED` 하나뿐이라 **VERIFIED에 구조적으로 도달할 수 없다**) · **`docs/knowledge_gap_resolution_v1.md`**(Knowledge Gap Resolution v1 — `NO_ANSWER_BASIS`가 **정확해도** 판매자가 그 자리에서 지식을 보충할 수 없으면 같은 질문은 영원히 같은 답을 받는다. 감사 결과 필요한 것 대부분이 **이미 있었고**(CRUD·즉시 색인·`SELLER_ENTERED_KNOWLEDGE`·상품 결합·재생성 엔드포인트·라이브러리 화면) 없던 것은 셋이다 — 문의 화면에서 지식으로 가는 길, 지식의 **규격 적용 범위**, 그리고 **무엇이 부족한지** 말하는 문장. 「답변 기준 추가」는 문의 상세 그 카드 안에서 열리고(상품 재검색 0, 큰 관리 화면으로 보내지 않으며, **상품이 없으면 버튼도 없다**), 저장은 **저장까지만** 한다 — 저장→재색인→검색→적용 가능성→**초안 재생성**이고 승인·Action Executor·전송은 제자리(`KnowledgeWriteFenceTest`가 `inquiry/reply`·`publish`·`proposal`·`lifecycle`에 지식 writer가 없음을, 지식 문서를 만들 수 있는 클래스가 **셋뿐**임을 이름으로 고정한다). **규격 범위는 기존 seam으로 표현 불가**로 판정했다 — `source_type`은 글의 종류, `authored_origin`은 글의 출처이고 `channel_source_ref`는 채널 문서의 동일성 키라 재사용하면 재수집이 판매자 글을 덮는다; 본문에 `[2호] 3~4가닥`을 적고 regex로 복원하는 것은 **migration도 constraint도 없는 스키마**다 ⇒ V79 **한 칸** (`variant_id uuid references product_variants`), backfill **없음**(`null`은 「모른다」가 아니라 **전체 상품 공통**이고 기존 5행이 이미 그것이다), FK가 **임의 규격 이름을 불가능하게** 만든다(다른 상품의 규격은 400 — 조용한 null은 한 규격의 주장을 전 규격으로 넓히는 것이다). 검색 규칙은 **비대칭**이다: 고객이 3호를 말했으면 2호 문서는 약한 근거가 아니라 **다른 물건에 대한 근거**라 문서 집합 단계에서 빠지고(랭킹 뒤에 거르면 4칸 중 하나를 차지했다 사라져 멀쩡한 공통 답이 빈손이 된다), 아무도 말하지 않았으면 **아무것도 빼지 않는다** — 규격별 문서가 「답할 수 있다」의 증거이고 정직한 답은 **되묻는 것**이다. 그래서 규격 확정이 **검색보다 먼저** 일어난다. 「지식 하나 추가 = GROUNDED」가 **아니다**: 해당 없는 지식은 `NO_ANSWER_BASIS` 유지, 규격별 지식 + 규격 미확정은 `NEEDS_CLARIFICATION`, 규격이 등록되지 않은 리스팅에서는 지식을 넣어도 `VARIANT_UNRESOLVED`라 되묻는 것이 맞다. 부족한 것을 말하는 줄은 **고객이 쓴 명사를 그대로 인용**하고(「'가닥' 관련 내용이 없습니다」) 새 classifier가 아니라 기존 단어 목록을 **명사/어투로 쪼갠 것**이 전부다 — 단어는 하나도 더하거나 빼지 않았고 합집합이 여전히 판정을 결정한다. **판매자가 직접 쓴 답변은 자동으로 지식이 되지 않는다**(실제 답변 ≠ 객관적 상품 지식; 「이 답변을 답변 기준으로 저장」은 **별도 결정**). 이미지 lane은 **`TECHNICAL_LIVE_PROOF_COMPLETE` · rollout `DEFERRED`**로 기록하고 추가 vision 호출 0이며 두 lane 모두 기본값 OFF임을 테스트가 `application.yml`에서 확인한다. 다음 패키지는 **Organization Answer Style v1** — Knowledge는 「무엇이 사실인가」, Style은 「어떻게 말하는가」이고 **style이 factual grounding을 override할 수 없다**. 커넥터·스케줄러를 끈 채 기동해 V79를 실제 로컬 DB에 적용했다(마이그레이션 1건, 채널·모델 활동 0, ERROR/WARN 0; 기존 지식 5건 전부 `variant_id` null · 청크 없는 문서 0 · 규격 후보 425). **마켓플레이스 호출 0 · 모델 호출 0 · 실제 판매자 지식 삽입 0** ⇒ evidence 행 없음) · **`docs/organization_answer_style_v1.md`**(Organization Answer Style v1 — 같은 근거라도 회사마다 원하는 방식으로 답변을 쓰게 한다. **Knowledge = 무엇이 사실인가 · Style = 그 사실을 어떻게 말하는가**이고, style은 factual grounding·applicability·safety를 **절대 override하지 못한다**. 감사 결과 바닥은 이미 있었고 **서 있는 사람이 없었다** — `AnswerStyleSafetyFloor`는 한 패키지 앞서 작성돼 「production 참조 0」을 테스트로 고정해 두고 있었고, 이 패키지가 그 caller이며 그 테스트는 **「참조 정확히 1」**로 뒤집혔다. V80 한 테이블 · **org_id가 PK**(「회사당 하나」가 떨어질 수 있는 제약이 아니라 테이블의 성질) · 백필 0 — **행이 없는 것이 정상 상태**이고 그때 답하는 `defaults()`는 이 제품이 이미 쓰던 문장이라 오늘 만족하는 회사는 할 일이 없다(기본값과 동일한 프로필은 프롬프트 섹션을 **아예 렌더하지 않는다** — 기본 스타일이 곧 shipped 프롬프트이므로 다시 적는 것이 곧 변경이다). 조립은 **우리 코드가** 한다: 세 enum(말투·길이·이모지)은 우리가 쓴 문장이 되고 판매자 문자열은 **따옴표 데이터**로 라벨 붙은 줄에 실리며, 그 섹션은 **user turn에만** 간다 — system turn에 판매자 문자열을 놓았다면 **한 회사가 다른 모든 회사의 초안을 쓰는 안전 규칙을 편집**할 수 있었고 어떤 phrase check로도 그 모양에서는 회복되지 않는다(구조 테스트). payload floor는 두 번째로, **한 종류만** 넓어졌다(이 org 자신의 표현 설정 — 고객·주문·상품·식별자 0). **required phrase에는 사실을 담을 수 없다**: 「꼭 포함할 표현」은 모든 답변에 넣으라는 **무조건적** 지시이고 사실은 무조건 참인 적이 없다 — 「당일 발송됩니다」의 자리는 운영 정책이고 거기서는 근거라 grounding의 지배를 받는다(닫힌 단어 목록으로 write 시점 **거절**, render 시점 **제거**). 금지 표현은 모델 **뒤에도** 검사해 걸리면 초안을 **거절**한다 — 단어를 지워내면 아무도 고르지 않은 의미가 남고 그대로 저장하면 규칙이 선호가 된다. `NO_ANSWER_BASIS`는 모델 0·초안 0 그대로이되 판매자가 등록한 **unknown fallback**이 있으면 그 문장을 **한 글자도 바꾸지 않고** 저장한다(새 author kind `SELLER_APPROVED_FALLBACK`; 인사·말투 미적용; **basis는 여전히 NO_ANSWER_BASIS**라 화면은 계속 무엇이 빠졌는지 말하고 「답변 기준 추가」도 그대로 — 유예는 답변이 아니다; 상세 읽기 실패·판독 중에는 **쓰지 않는다**). GROUNDED 불변성은 **payload로** 검증한다 — 같은 질문에 두 스타일이면 user turn의 사실 부분이 완전히 동일하고 스타일 섹션만 뒤에 붙는다(모델이 쓴 문장은 결정론적 함수가 아니므로 「친근하게 썼는가」는 벤더의 기분을 단언하는 테스트다). 스타일 identity는 새 컬럼이 아니라 기존 `model_version`에 `+style/v3`으로 붙고, append-only 초안은 스타일을 바꿔도 움직이지 않는다. 화면은 `/settings/style` **AI 답변 스타일** — prompt·system·temperature·model 같은 단어 **0**(테스트), preview는 **고정 합성 예시** 위에 인사·호칭·필수 표현만 그리고 본문은 자리 표시자다(스타일 미리보기가 절대 해서는 안 되는 일이 상점 주인에게 자기 회사 정책처럼 읽히는 배송 답변을 보여 주는 것이다). **exemplar는 DEFER** — `usableAsExemplar`는 caller **0**이 테스트로 고정돼 그 테스트가 이 lane의 스위치이고, 리뷰 답글·자동 학습·product/channel/customer별 style·generic prompt builder는 **0**. 커넥터·스케줄러를 끈 채 기동해 V80을 실제 로컬 DB에 적용했다(마이그레이션 1건, 채널·모델 활동 0, ERROR/WARN 0, style 행 0). **마켓플레이스 호출 0 · 모델 호출 0 · WRITE 0** ⇒ evidence 행 없음) · **`docs/review_triage_contract_v1.md`** (Review Triage Contract v1 — 축이 **둘**이다: actionability(`ReviewTriageTier` NEEDS_ATTENTION/WATCH/FYI, 기존 그대로)와 **Reply Recommendation**(별도 축, review context + channel capability + **seller policy**로 판단하며 tier에 합치지 않는다 — 5★ 칭찬은 조치 0이면서 답변 가치가 있을 수 있고 1★ 무본문은 그 반대다). seller-facing queue는 **derived UX**이고 `WATCH`는 메인 bucket이 아니다. tie-breaker 유지(1–2★ 무본문 → WATCH · 3★ 무조치 → 확인 필요 아님). **§4(09-11): `NEEDS_ATTENTION`의 기준은 「부정 표현이 있는가」가 아니라 「이 한 건 때문에 판매자가 지금 확인·판단·조치해야 하는가」다** — 남아 있는 문제·기능 이상·조치 가능성·명시적 요구는 확인 필요, **이미 해결됐거나 이미 수령해 개별 대응할 일이 없는 마찰은 WATCH**(반복 여부는 반복 문제 화면이 본다). 그래서 **v1 §2 첫 행 「칭찬+양보 = 조치」 blanket rule은 그대로 승계하지 않는다**(§5-B) — 「높은 별점이 조치 가능한 불만을 무효화하지 않는다」는 승계하고, 문장 **모양**만으로 조치라고 보는 규칙은 승계하지 않는다; **220 gold와 holdout 판정은 재작성 0**이고 그 코퍼스는 개정 이전 rubric의 것이라 §4의 근거로 인용할 수 없다. AI 지표는 **`author_kind = 'MODEL'`만**(`RULE` 템플릿 승인 제외 — 문의 lane이 이미 낸 결함이고 실측 승인 4건 중 2건이 `RULE`), approval history는 현재 행이 아니라 **`review_reply_approval_audit`**을 읽는다. NAVER `media_count` producer가 생기기 전까지 「사진 있음」은 근거로 **금지**(REAL 4,753행 전부 0). RUBRIC v1 §1·§4·§5와 v1 §2의 나머지 다섯, v2 §2.2·§2.3·§3.1·§8.3·§8.5·§8.9·§12·§13을 **승계**하고 개정 1건(v1 §2 첫 행); 새로 추가된 것은 rubric이 라벨한 적 없는 답변 축 하나라 **220 gold를 새 축으로 옮길 수 없다**. **§2-A(09-11) seller reply policy**: 공개 SmartStore 7곳·약 400건 READ-ONLY 관측으로 archetype 셋(`NO_REPLY`·`SELECTIVE`·`BROAD`)이 전부 실물로 확인됐고 최소 설정은 이 셋으로 충분하다; **SELECTIVE의 조건은 rating threshold로 받는다**(관측이 예상을 뒤집었다 — 답글 다는 두 판매자 모두 별점에 반응하고 답글 문장이 그것을 인용한다), complaint/actionability 기반은 **판매자가 진술한 적 없는 기준**이라 채택하지 않고 question 기반은 「없다」가 아니라 「이 표본에서 미관측」이다. **외부 seller 행동은 Attention gold로 쓰지 않는다** — 답글 유무로 판정하면 답글 없는 1★ 결함을 놓치고 답글 있는 5★ 칭찬을 올리며, 두 replier 모두 별점으로 반응하므로 우리가 벗어나려는 heuristic을 학습한다; §4는 이 관측으로 바뀌지 않는다. **§5-C(09-11) T-07 seller triage correction 구현됨**: 판매자 판단은 **세 값**(`NEEDS_ATTENTION`/`WATCH`/`FYI`)이고 **AI pilot과 무관하게** 가능하며(pilot은 `shownSource` RULES/AI만 정한다), 시스템 판단을 **overwrite하지 않고 나란히** 선다 — `FINAL_TIER_RANK`가 correction 테이블을 읽지 않아 **순서도 바뀌지 않는다**(재정렬은 overwrite의 다른 이름이다). 되돌리기는 삭제가 아니라 `WITHDRAWN`(삭제는 frozen snapshot에서 행을 없앨 수 있다), 변경은 append-only `review_triage_correction_audit`(`tier_from`/`tier_to`)에 남고, correction은 **Decision Data**라 silver `review_triage_behavior_events`와 섞지 않는다. **이 결정은 「WATCH/FYI 선택지 없음」을 명시적으로 뒤집는다** — 그 규율은 pilot에 대해 옳았고 seller에 대해 틀렸다(「필요 없음」이 규칙의 값으로 저장돼, 참고라고 생각한 판매자에게 지켜보기가 기록됐다); V99에 이유가 적혀 있다. 새 generic event platform **0** · 새 enum·classifier·holdout **0**. **§4-A(09-11) `WATCH`의 의미 확정**: 「지금 처리할 필요는 낮지만 **같은 신호가 반복되면** 상품·설명·설치·배송·운영을 **구체적으로** 개선할 가치가 있는 마찰」이고 **product defect에 한정되지 않는다**; 가르는 질문은 「이 문장이 열 번 반복되면 판매자가 **무엇을** 바꿀 수 있는가」다. 45건 targeted validation이 세 규칙을 만장일치로 확정했다 — **workaround의 존재만으로는 WATCH가 아니고**(마찰을 이름으로 댄 우회 7/7 vs 원인 무명 0/2) · **NA와 WATCH를 가르는 것은 요구의 강도가 아니라 현재 미해결 결함의 명시 여부**이며(결함 명시 3/3 NA · 개선 제안만 6/6 WATCH · 종료된 배송 지연 7/7 WATCH) · **안내할 내용이 특정되면 구매 결정 마찰도 WATCH**(특정 안 되면 임의로 올리지 않는다). §5-E는 #57 adjudication을 **원 라벨을 덮어쓰지 않고** 곁에 기록하고(canonical = `adjudicated if present else 원 라벨`), §5-F는 **Attention Dev Set v1.1 — n=105(60+45)를 전부 development evidence로** 고정한다: 모델이 45건을 보지 않았어도 **설계자가 봤으므로 독립이 아니며** validation·holdout·go/no-go·production 성능 주장은 **금지**다. §4-B가 제안한 5-value `improvement_target` enum은 **`NOT_ADOPTED` — 측정이 지지하지 않았다**(recall 3/16이고 aspect 축이 FYI 25/27에도 잡혀 구별력이 없다; 삭제하지 않고 근거와 함께 남긴다) ⇒ **새 enum·field·낱말 0**, 필요한 변경은 기존 `problem_type`을 `problem_present`에 종속시키지 않는 것뿐이다. 라벨 원문은 실제 고객 문장이라 **저장소에 커밋하지 않는다**. §4-A에 product-owner 결정 **둘**이 더 붙었다 — **자기 귀책 자체는 기준이 아니다**(원인을 자기 선택으로 명시하면서 판매자가 바꿀 자리를 함께 말하지 않으면 `FYI`, 안내 공백을 함께 말하면 `WATCH`) · **판매자 안내로 해결된 구체적 어려움은 `WATCH`**(그 안내가 반복 가능한 guidance로 승격될 수 있으므로; 다만 어려움이 특정되지 않은 응대 칭찬은 아니다). §5-G는 **Candidate B v3를 `DEVELOPMENT-FROZEN`**으로 고정한다 — `attention-dev-prompt/vB3` · sha256 `90cf1275…` · schema `attention-facts-schema/v1` **무변경** · `gpt-5-2025-08-07`; vB2에서 바뀐 것은 계약 문장 셋뿐이고 **결정표는 바이트 동일**이며, freeze 근거는 점수가 아니라 **남은 오답 셋이 전부 계약에 이미 문장이 있는 경계**라는 것이다(새 field·enum·factor 요구 **0**). 이 candidate는 **결정론이 아니다** — 한 행을 두 prompt로 3회씩 다시 물어 확인했으므로 행당 1회 표본의 수치는 그만큼 흔들리고 **어떤 수치도 PASS 기준이 아니다**) |
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

**`docs/agent_runtime_architecture_audit_v1.md` · `docs/agent_procedure_layer_v1.md`**
(Agent Procedure Layer v1 — 2026-09-06. 반복되는 Agent 품질 defect가 edge-case rule 누적인지 감사한 뒤
(`src/conversation/` 8일 만에 8파일 2,639줄 → 26파일 7,729줄, `ConversationService` 1,324 → 3,579줄,
「라이브에서 측정된 결함」 주석 124건) 결론 **B**를 실행했다: architecture rewrite가 아니라 plan과 answer
사이에 흩어진 **같은 판단**을 한 곳씩으로 모은다. **planner · NeedKind(14) · specialist(5) · tool(31,
전부 READ) · artifact(24) · `ActiveTask` · 승인 경계 · 프롬프트 무변경.** **WorldState**는 turn당 한 번
파생되고 필드는 넷뿐(readiness · anchor kind · activeTask · 그 turn의 coverage 스냅샷)이며, planner에게는
**닫힌 enum 한 줄**(`판매자 상태: NO_CHANNEL|NO_DATA|WORKING`)만 간다 — 채널 이름·숫자·id·고객 문장 0,
`UNKNOWN`은 아무것도 보내지 않고, **하류는 planner가 그 줄을 존중하는지에 의존하지 않는다**(연결 0인
판매자의 답은 같은 world에서 procedure가 정한다). **Procedure**는 record 하나(`precondition(world)` +
next step)이고 여섯이다 — ONBOARD_CHANNEL · DAILY_WORK · ANSWER_INQUIRY · ANSWER_REVIEW ·
CAPTURE_KNOWLEDGE · IMPROVE_FROM_ISSUES; 새 DSL·graph·workflow engine **0**. `AbsenceReason` 여섯 중
**`ZERO_MEASURED` 하나만 가게에 대한 주장**이고, 이것이 `ChannelDataState`가 오래 적어 두고 아무도
강제하지 않던 규칙(「`ZERO`만이 「없습니다」라고 말할 수 있다」)을 실행 가능한 코드로 만든 것이다.
**제거된 중복 판단**: readiness 4→1 · absence 문장 3→1 · connect step 라벨 2→1 · 문의 초안 전제 3→1 ·
리뷰 초안 전제 2→1(말투 수정 lane은 **아예 묻지 않고 있었다**) · FE 「연결된 것이 있나」 2→1
(`firstConnectionState.ts` 삭제). FE↔runtime은 **엔드포인트가 달라 코드를 공유할 수 없으므로 규칙을
공유**하고 양쪽 테스트가 같은 표를 고정한다(절반 수렴, 그렇게 적는다). **branch는 줄지 않았고 줄 수
없었다** — compose 44→44 · directLane 37→37 · turnNow 16→17이고, 그 `if`는 판단이 아니라 **dispatch**
(planner action 6 + 닫힌 intent 17)라 줄이는 것이 곧 금지된 rewrite다; 줄어든 것은 판단 지점이다.
**Multi-turn Scenario Eval**(`test/scenario/`)은 기존 harness 위의 선언 층이고 **`world`가 1급 축**이라
같은 문장을 두 가게에 묻고 답이 올바르게 달라지는가를 단언한다; **`never`가 `expect`만큼 1급**이며
판매자가 볼 수 있는 전부(message·notes·artifact 제목/줄/항목/라벨·칩)를 훑는다; plan 녹화는 문장을 키로
하는 공유 파일이고 녹화 없는 문장은 **그 문장을 인쇄하며** 실패한다. **CI는 벤더를 부르지 않는다.**
최소 검증 4개(NO_CHANNEL의 「할 일 없음」 금지 · follow-up capability 반복 금지 · WORKING에 connect CTA
금지 · exact-object flow 회귀 0) 전부 통과하고 **넷 다 옛 코드에서 빨개지는 것을 확인한 뒤** 남겼다.
**라이브 브라우저가 결함 둘을 새로 드러냈고 같은 세션에서 닫았다**: (A) 연결된 판매자의 두 번째
capability 질문이 카드를 통째로 다시 인쇄했다 — said-once를 first-use world에만 쓴 것이 원인이고
**사실은 어느 가게가 물어도 한 번만 말한다**(`alreadySaidAnswer`, 카드 없이 한 문장과 다음 걸음);
(B) 「지금 먼저 하실 일은 없습니다」 바로 아래에 「답변이 필요한 문의가 24건」이 있었다 — 체크리스트가
빈 이유는 그 run이 list artifact 대신 **findings**를 냈기 때문이고 ⇒ `honestZero(items, findings)`,
**일을 찾은 turn은 그 주장을 하지 않는다**. clean seller 3-turn과 Demo Org 3-turn 라이브 재현 ·
콘솔 오류 0 · off-host 0. backend **파일 0** · runtime 861 · frontend 2,762 · 실패 0.
**마켓플레이스 0 · WRITE 0 · 모델 호출은 QA turn뿐 · 마이그레이션 0** ⇒ evidence 행 없음.
**고치지 않고 보고**: planner 뒤에서 문장을 읽는 15개 모듈과 compose의 8회 재해석은 그대로이고
(`AgentPlanPrompt`의 「planner is still the only thing that reads the sentence」는 여전히 사실과 다르다),
`ConversationService.ts:442`의 `/이 상품/`, `checklistOf`가 findings를 읽지 않는 것, plan 단계가 여전히
turn의 87~98%인 것)

**`docs/agent_semantic_ownership_v1.md`** (Agent Semantic Ownership Closure v1 — 2026-09-06. 직전
audit이 숫자로만 남겨 둔 「planner 뒤에서 문장을 다시 읽는 곳」을 **전수 분류하고 중복만 제거**한다.
Planner · NeedKind · specialist · tool(31, 전부 READ) · artifact · ActiveTask · 승인 경계 · 프롬프트
v15 **무변경**, 새 taxonomy·DSL·두 번째 planner **0**. 소유 계약은 넷 — **Planner = goal의 의미 ·
WorldState = 가게의 현실 · Procedure = precondition/next step · Composer = 표현**. 분류는 **A**(planner
전 결정론 lane) · **B**(경계이거나 **planner가 실제로 들고 있지 않은 의미** — 전부 실제 planner trace로
확인) · **C**(plan이 이미 정한 것을 후단이 다시 판단)이고 **C만** 제거했다. 주석 제거 기준 실측
**70 reads / 21 files → 61 / 16**. **§2 리뷰 sense는 처음부터 plan의 것이었다** — `ReviewEvidenceSense`가
한국어 낱말표 둘로 「부정 리뷰」와 「리뷰 문제 근거」를 갈랐는데, 이웃 파일 `specialistInput.ts`가 바로 그
행위를 「second planner invariant I2가 금지한다」고 적어 두고 있었다. 8문장 실 planner trace(Demo Org,
09-06): plan의 tool 선택이 낱말표와 **7/8 일치**하고 **8번째에서 plan이 옳았다**
(「리뷰가 안 좋은 상품 뭐야?」는 어느 목록에도 없어 표가 기본값으로 떨어졌다) ⇒ 표를 지우고 plan의
`candidateTools`를 읽는다. **한 번의 조회가 아니라 사다리**인 이유도 trace가 정했다 — planner는
`get_dashboard_product_issues`를 보조 read로 후하게 붙이므로 둘 다 이름 지은 plan은 여전히 이슈 질문이다
(`get_review_issue_evidence_summary` → ISSUE · `search_review_issues` → ISSUE(보수 방향) ·
`get_dashboard_product_issues` 단독 → NEGATIVE · 없으면 ISSUE); `allowedTools`는 **인가**라 읽으면 plan의
선택이 보이지 않는다. graph가 `grouping`·`channelScope` 옆에서 한 번 정해 `SpecialistInput.reviewSense`로
넘긴다. **라이브 착지**: Demo Org에서 「리뷰가 안 좋은 상품 뭐야?」가 이제 「…에 부정 리뷰가 3건
있습니다」로 답한다. **§3 정정을 기록한다** — 처음엔 `COMPANY_INTRO_ASK` 정규식을 **그냥 지웠다**(그
finding은 `COMPANY_PROFILE` 분기에서만 생산되므로 존재 자체가 증거라고 봤다). **trace가 그것이 틀렸다고
말했다**: 「우리 회사 특성 고려하면 배송 문의에 어떻게 답하는 게 좋을까」는 `COMPANY_PROFILE`을
`POLICY`·`PAST_ANSWER`와 **나란히** 선언한다 — need는 「이 turn이 프로필을 필요로 한다」이지 「판매자가
읽어 달라고 했다」가 아니다. 그런데 정규식도 틀렸다(6문장 실측: 「우리 회사는 어떤 회사야?」와 「우리
회사에 대해 알려줘」를 **놓쳐** 판매자 자신의 소개를 「등록된 회사 정보를 참고했습니다」로 바꿔치기)
⇒ 신호는 낱말이 아니라 **plan의 모양**이다 — `companyIsTheQuestion` = 「COMPANY_PROFILE이 이 run의
**유일한** need인가」, 6/6. 그걸 물으려고 답변이 need의 **자기 토큰**을 보고한다(`AnsweredNeed.kind` —
새로 발명한 의미가 아니라 need가 이미 갖고 있던 것이고, 지금까지는 산문 `question`만 보고돼 하류에 다시
읽을 문장밖에 없었다). **§4 run의 axis가 두 번 정해지고 있었다** — graph가 dispatch마다 한 번 정해 로그를
남기고 모든 specialist에게 주는데, `ConversationService`가 같은 plan·같은 working set·같은 문장으로 **다시**
정했고 두 번째 호출은 `emitLog = false`를 넘겼다(자기가 반복이라는 것을 알고 있었다) ⇒ state 채널
`OperatorState.axis` → `OperatorAnswer.axis`로 **carry**하고 composer는 읽기만 한다(문장 읽기 3개 소멸).
같은 모양이 한 단계 아래에도 있어 `subjectTermOf`가 graph + rows step + workload step **셋**에서 돌던 것을
`SpecialistInput.subjectTerm`으로 옮겼고, `sentenceSubjectOf`는 **정의가 둘**이었다(graph inline +
ConversationService private) — 서로 맞았지만 맞게 하는 장치가 없었다 ⇒ `scopeOverride.ts` 하나.
**§5 틀리는 것 말고는 할 수 있는 게 없던 낱말표** — `DRAFT_WORDS`(초안·써줘·작성해줘…)가
`requestedAction === "NONE"`일 때 「답변 초안 작성은 이 대화 창구에서 하지 않습니다」를 찍었는데, trace상
planner는 답변 초안 요청 **5/5를 `PREPARE_INQUIRY_DRAFT`로** 읽으므로 그 경우엔 가드가 눌렀고, 표가 낸
**유일한 고유 출력은 거짓**이었다 — 「제품 설명 문구 써줘」(plan `NONE`, 써줘 포함)가 답변과 무관한 요청에
그 문장을 받았다. READ 전용 천장은 여전히 `OperatorToolRegistry`가 강제한다. **§6 Scenario eval에 manual
QA defect 12개를 대화로 추가**(`world` 1급 축 · `never` 1급 · **CI 벤더 호출 0**, 새 plan 2개는 실 planner에서
녹화): 연결 0의 「할 일 없음」 금지 · 수집 상태 문장 · capability 반복 금지 · 연결된 판매자에게 connect CTA
금지 · 일을 찾은 turn의 부재 주장 금지 · 새 목록의 직전 축 상속 금지 · 지시 대상 없는 대명사는 모델 0회 ·
화면 위 refine 유지 · §5 · §4 · 거절에 답변 모양 artifact 금지 · 서수 inspect 모델 0회. **전부 옛 코드에서
빨개지는 것을 확인**했다(notice 복원 시 3건 red). 구조 guard `semanticOwnership.test.ts`가 sense의 caller
1개 · 퇴역한 정규식 · axis 읽기 1회 · `subjectTermOf` call site · **후단 모듈의 「goalText 옆 한국어 낱말
배열」 0** · class B 생존자 목록 · 그리고 read 수 자체(≤61/≤16)를 고정한다. runtime **883** · frontend
**2,762** · 실패 0 · backend 파일 **0**. 라이브 재확인(스택 재기동 후 실 planner, 1440×900): clean seller
3-turn은 **이전과 같은 답** · Demo Org에서 §2·§5가 화면에 착지 · **콘솔 오류 0 · off-host 0 · backend
ERROR 0**. **계약이 바뀌어 테스트 3건과 plan fixture 3건을 다시 썼다**(전부 단언이 늘었고 안전 테스트 약화
0; fixture의 `tools: []`는 「clarification으로 도구가 0개 돈 run」의 기록이었고 그 docblock이 exact라고 적은
것은 needs·clarification·period뿐이다). **고치지 않고 보고**: 후단 goalText 모듈은 15 → **13**이지 0이
아니고 남은 것은 전부 class B이며 `AgentPlanPrompt`의 그 문장은 **여전히 사실과 다르다** · `analyzeIntentOf`는
작은 closed field로 은퇴시킬 수 있는 유일한 B이지만 consumer가 하나뿐이라 두지 않았다 · 회사 read-back
분기는 Demo Org에 회사 정보가 없어 **라이브 미관측**(단위 테스트로만 고정) · `groupingOf`는 graph에서 여전히
두 번 호출된다(같은 순수 함수·같은 입력·소유자 1) · 마켓플레이스 0 · WRITE 0 · 마이그레이션 0)

**`docs/agent_product_self_knowledge_v1.md`** (Agent Product Self-Knowledge v1 — 2026-09-07. Agent
architecture **FREEZE**(AOP/Procedure 추가 0). Clean seller에서 「연동하고 나면 뭐가 되냐고」가 앞 turn과
거의 같은 onboarding 답을 반복하던 defect. **trace가 planner를 무죄로 만들었다** — 여섯 문장 전부
`EXPLAIN_CAPABILITY`로 맞게 읽혔고, 못 한 것은 「어떤 종류의 capability 질문인가」를 말하는 것이며 그럴 축이
없었다. 그래서 런타임의 판별자가 proxy(`informationNeeds.length === 0`)였고 양방향으로 틀렸다: need를 붙인
문장은 채널 lane으로 떨어져 **「어느 채널에 대한 질문인지 알려주세요 (네이버 · 쿠팡 · 카페24)」** — 거절문의
괄호 안에 답이 든 되물음 — 이 됐고, need 0인 서로 다른 네 질문은 카드 하나와 getting-started 하나로 합쳐졌다.
**축 하나**(`filters.capabilityAspect`, 프롬프트 v16→**v17**, `reviewIntent`·`inquiryIntent`와 같은 가족)와
**factual source 하나**(`operator/capability/ProductSelfKnowledge.ts`)로 닫는다 — 중복 작성 0이고 입력은 전부
기존 source of truth다(tool catalogue · action class · 그 turn의 coverage 스냅샷 **추가 읽기 0** · 모든 실행
경로가 쓰는 `capabilityOf` · 여섯 Procedure). `AssistantCapability.ts`는 파생만 남기고 문장은 옮겼다(같은 문장의
두 번째 사본 금지). **연결 전에 답할 수 있는 것이 요점** — 채널 capability 읽기는 채널-keyed거나 org 범위라
계정이 필요 없고, 연결을 **결정하려는** 판매자가 그 답을 가장 필요로 한다. `null` aspect는 여섯 번째 값이 아니라
**필드 이전 동작의 재현**(`fallbackAspect`)이라 v17 이전 backend에서 바이트 동일. **「모른다」·「안 된다」·「이
배포에서 꺼져 있다」는 다른 문장**(연결된 Demo Org가 「연결하신 뒤에 확인해 드릴 수 있습니다」를 듣고 있었다;
내부 플래그 이름 노출 0), **읽을 수 있는 사실은 withhold하지 않는다**(연결된 채널은 그 계정의 review capability를
실제로 읽고, subtype 둘이 같은 답이면 그것이 채널의 답 — per-object lane 무변경). **capability 질문은 채널을
상속하지 않는다**(`focusForAxis` 한 줄, 넓히는 방향으로만 — 「리뷰 답글도 자동으로 보내?」가 직전 NAVER를 물고
와 좁혀지고 그래서 반복으로 눌렸다: `productFocus.ts`가 닫은 것과 같은 모양), **「한 사실은 한 번」은 사실 단위**
(키에 채널이 들어간다; 재질문의 답이 직전 문장 그대로에 카드만 뗀 것이면 첫 답보다 적다), 렌더링은 채널 수만큼
반복하지 않고 **사실로 묶는다**(실측 12→5줄). 라이브(clean seller 실브라우저 1440×900@2×): 여섯 질문이 여섯
답을 받고 **콘솔 오류 0 · off-host 0 · 가로 스크롤 0**; 연결된 Demo Org 매트릭스는 이 org의 진짜 상태를 말한다.
runtime **975** · backend **3,898** · frontend **2,779** · 실패 0. **마켓플레이스 0 · WRITE 0 · 승인 0 ·
마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행 없음. **계약이 바뀌어 테스트 3건을 다시 썼다**(안전 테스트 약화 0).
**고치지 않고 보고**: AFTER_CONNECT vs CHANNEL_ACTION은 채널을 지목한 문장에서 실행마다 갈릴 수 있다 · 매트릭스는
「어떤 동작인가」 축이 없어 네 능력을 전부 답한다 · recorded plan은 v17 실측이지만 CI는 벤더를 부르지 않으므로
프롬프트가 다섯을 구분하지 못하게 되어도 단언은 통과한다 — 그 검사는 라이브 재녹화뿐이다)

**`docs/grounded_conversation_lane_v1.md`** (Grounded Conversation Lane v1 + Cross-Lane Context
Continuity — 2026-09-07. **AOP/LangGraph 실행 구조 FREEZE**(WorldState · Procedure · NeedKind · tool ·
Evidence · Approval · Executor · Checkpoint 무변경, 새 procedure·tool·marketplace WRITE 0). 바꾼 것은
하나 — **ASK/EXPLAIN에는 LLM의 reasoning을 돌려주고, DO/CHANGE는 지금의 결정론 구조 그대로 둔다.**
**결함은 다섯 개의 답이 틀려서가 아니라 다섯 개뿐이어서다** — `capabilityAspect`는 닫힌 토큰이고 여섯 번째
질문은 그 값이 아니므로, 새 informational 질문을 지원하는 유일한 길이 「토큰 하나 + composer 하나 추가」였다.
같은 커밋·같은 스택에서 capability만 껐다 켜서 잰 before/after: 「너랑 사방넷이랑 뭐가 달라?」는 네 도메인
카드였고 이제 「그 서비스는 제가 정확히 알지 못합니다」 + 우리가 하는 일이며, 「세 군데 연결하면 문의가 중복으로
보여?」는 채널 매트릭스였고 이제 채널별 저장·원본 글 단위 dedupe를 답한다. **§1 감사 결과 새 store는 필요
없었다** — 맥락은 이미 일곱 곳(transcript · selectedInquiry/selectedObject · workingSet ids · activeTask/
pendingPrepared · AOP cursor · surface hint · priorLine)에 정확히 있었고 이름이 없었을 뿐이라
`ContextEnvelope`는 **projection**이다(영속 0 · 캐시 0 · 조정 0; durable envelope를 만들었다면 anchor의 두
번째 사본이 생기고 어긋났을 때 어느 쪽이 대화의 것인지 말할 사람이 없다). refs만 담고 사실은 소유 surface에서
다시 읽으며, **id는 모델로 나가지 않는다**(닫힌 `key=value` 줄뿐이고 floor가 그 줄에 이름·본문이 나타나는 날
거절한다). **§3 열 번째 LLM capability** `sellerops.agent.converse.*`(`POST /api/agent/converse`, 자기 flag·
key·prompt·parser·quota kind·바이트 payload floor, **기본값 OFF**). grounding source는 전부 기존 진실 —
등록된 tool catalogue · action class · **그 turn의 coverage 스냅샷(추가 읽기 0)** · 모든 실행 경로가 쓰는
`capabilityOf` 판정 · `routineEnabled` · `SellerReadiness`, 그리고 손으로 쓴 것은 **구조 사실 4줄뿐이고 그
개수를 테스트가 고정한다**. 즉 `ProductSelfKnowledge`는 ASK lane에서 문장 생성기이기를 그만두고 **grounding
source**가 되며, 다섯 composed 답은 **fallback으로 남는다**. **모든 실패가 이전 답으로 착지한다** — capability
off · quota · floor 거절 · 모델 거절 · 도달 불가 · 출력 guard 거절 전부 결정론 composer가 문장을 쓴다(그래서
CI 스위트는 무변경: fake client에 `converse` 메서드가 아예 없어 이 lane은 CI에서 돌지 않고 녹화된 답을 **바꿀
수 없다**). **payload floor: 고객 콘텐츠 0** — 판매자 자신의 문장 · 이 스레드에서 우리가 쓴 문장 ≤6 · 사실
시트 · 닫힌 토큰이 전부이고 `Input` record는 칸이 넷이라 object id를 실을 자리가 없다. 「한 사실은 한 번」
suppression은 **삭제가 아니라 fallback으로 축소**했다. **§4 continuity 실결함 하나** — 진행 중 단계의 carry가
`selectedInquiry`만 봐서 REVIEW·PRODUCT anchor 스레드는 첫 대화 turn에 `activeTask`를 잃었다(`sameAnchor`,
옛 규칙에서 빨개지는 것 확인). fence 셋: 대화 turn은 **어떤 procedure도 진행시키지 않고**(router는 문장을 읽지
않으며 draft·approval·execute를 든 procedure는 전부 DO 토큰을 요구 — readiness×anchor×action 전수 단언),
**멈춘 procedure는 질문 뒤에도 멈춰 있으며**(`WAITING_HUMAN` cursor의 `approvalId` 불변 — interrupt는 허가가
아니고 「이 답변 괜찮아?」는 그 허가가 아니다), **lane은 READ only**(세 모듈에 writer·approval·channel 호출
이름 0, 소스 스캔). **§6 실측 비용**: converse 왕복 **≈2,200ms** · prompt **1,288~1,427 토큰** · completion
98~128 · reasoning 0, capability turn 전체 **2,501~3,027ms → 4,190~5,681ms**(모델 호출 1 → 2), 판매자 일일
예산에 `AgentUsageKind.CONVERSE`로 청구(enum 값 하나, 마이그레이션 0). **§7 라이브**: clean seller 실브라우저
8문장 → 8개의 서로 다른 답(사방넷·판매자센터·「그냥 문의 AI야?」·매일 들어와야 하나·할 수 없는 것·중복·쿠팡
리뷰 답글·네이버 리뷰 등록), **콘솔 오류 0 · off-host 0 · 가로 스크롤 0**; 연결된 Demo Org에서 같은 두 문장이
**그 가게의 사실로 다르게** 답한다(연결된 세 채널·정기 수집·네이버/쿠팡의 최초 1회 확인). grounded turn 10건
전부 응답 · guard 거절 0 · capability를 뺀 org에서는 `answered=false`로 옛 답이 그대로. backend **3,903** ·
frontend **2,779** · runtime **994** · 실패 0 · **테스트 재작성 0**(안전 테스트 약화 0, boundary 표가 열 번째
행을 얻었다) · **마켓플레이스 0 · WRITE 0 · 승인 0 · 실행 0 · 마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행
없음. **고치지 않고 보고**: 객체에 대한 「왜」 질문(「왜 이 리뷰가 문제야?」)은 여전히 객체를 그려서 답한다 —
확장하려면 이 capability의 payload에 객체의 사실과 결국 고객 문장을 넣어야 하고 그것은 **floor 결정**이지 문구
결정이 아니다(seam은 준비돼 있다) · per-object capability lane 무변경 · `capabilityAspect`는 fallback이 계속
쓴다 · grounded 답은 결정론이 아니다(사실은 고정, 문장은 아니다) · 구조 사실 4줄은 아무도 재도출하지 않는다 ·
제품 질문마다 왕복 한 번(**≈2.2s**)이 늘어나는 것과 **판매자 문장·스레드가 매 제품 질문마다 벤더로 나가는
것**은 머지가 아니라 **배포 결정**이다)

**`docs/planner_model_prompt_benchmark_v1.md`** (Planner Model & Prompt Benchmark v1 — 2026-09-06.
Agent Runtime 구조는 **FREEZE**하고, 「플래너의 모델과 프롬프트가 실제로 최선인가」만 잰다. **핵심 설계:
새 채점기를 만들지 않았다** — 대화는 `test/scenario/cases.ts`에 **데이터로 한 번** 적히고 두 번 실행된다
(CI는 녹화 plan으로 벤더 호출 0, `bench/`는 arm이 지목한 모델의 **실 plan**으로), 채점은 같은
`violationsOf()`다. 즉 **모델은 제품 자신의 단언으로 채점된다**(어떤 artifact를 그렸나 · `never`를 어겼나 ·
결정론 lane이 모델을 안 불렀나 · 어떤 링크 · 어떤 상태). 판매자 데이터는 전부 fake이므로 코퍼스가 arm
사이에서 흔들리지 않고 마켓플레이스에 닿지 않는다. 셋은 **선택 48 turn**(CI 시나리오 전부 + 벤치 전용
S1~S12)과 **블라인드 홀드아웃 14 turn**이며 **모든 문장·기대값을 arm 실행 전에 적고 이후 고치지 않았다**.
arm 다섯: baseline(`gpt-5-2025-08-07`@`minimal`) · luna@none · luna@low · mini@none · **promptB**. **모델은
바꾸지 않았다** — luna-low는 정확도 동률(93.8%)에 **지연 +33%**(2,677→3,553ms)라 직전 패키지가 12.2초→4.8초로
되찾은 그 지연을 되돌리고, luna-none(83.3%)·mini-none(79.2%)은 **첫 화면의 첫 질문**(capability·first-use)에
답하지 못한다. **프롬프트는 바꿨다: `agent-plan-prompt/v15` → `v16`** — v15의 서른 개 대시 한 줄기를 결정
단위 여섯 절로 묶은 것이고, **규칙을 하나도 더하거나 빼지 않았다는 것이 측정이다**(공백 제거 문자 다중집합
비교: v16 = v15 + 제목 **178자** + `-`4 − `\`3, keyword 예외·판매자 문구·예문 **0**). 선택 94.4% → **95.8%**,
홀드아웃 92.9% → **92.9%(동률 — 정직하게 적는다)**, 지연 **중립**(promptB 뒤에 baseline 3번째 pass를 넣어
시간 교란을 확인했다), 비용 100회당 $1.071 → **$1.069**. **채택 근거는 총점이 아니라 부분집합 관계다** —
v16이 실패하는 turn은 v15가 실패하는 turn의 **진부분집합**이고, v15가 3 pass 중 2번 놓치던 **「첫 아침의
질문」**을 v16은 여섯 번의 실행에서 한 번도 놓치지 않았다. **never violation은 다섯 arm 전부 0** — 안전
성질이 모델이 아니라 런타임·procedure 층에 있다는 관측이다. **벤치마크가 자기 계측기의 결함을 먼저 찾았다**:
world가 리뷰를 `ALL`로만 심어 **채널 지정 리뷰 읽기가 전부 404**였고, 그래서 plan이 정확한 「카페24만 봐봐」가
모든 arm에서 `FAILED`였으며 **mini-none만 PASS**했다(리뷰가 아니라 coverage를 계획해 다른 질문에 답했다) —
계측기가 틀린 방향으로 모델을 칭찬하고 있었으므로 고치고 다섯 arm을 전부 재실행했다. 라이브 브라우저
12 turn(clean seller 5 + Demo Org 7, 1440×900@2×, 콘솔 오류 0 · off-host 0): 「최근 3일…」이 **`LAST_N_DAYS`
계약대로** 답하고, 근거 없는 문의에는 초안을 지어내지 않고 기준을 되묻는다. backend **3,880** · runtime
**883** · 실패 0. **마켓플레이스 0 · WRITE 0 · 승인 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음.
**고치지 않고 보고**: 지시 대상 없는 대명사(「그건 어때?」·「저기 그거」)가 결정론 lane을 통과하지 못해
clean seller에서 **읽은 적 없는 것에 대한 부재 주장**으로 착지한다(가장 심각한 잔여, procedure 층의 일이며
낱말 추가로 닫지 않는다) · STALE 채널을 이름으로 부르지 않는다 · 모델 arm은 각 1 pass · 비용 단가는 외부
사실 · 벤치마크 동안 AI 예산을 모든 arm에 동일하게 올렸다(제품 코드 무변경) · 라이브 QA는 두 조직을
**명시적으로 allow-list**한 부팅에서 했다(파일 수정 0, `CONNECTED_SELLERS`·전역 활성화 미사용))

**`docs/langgraph_orchestration_aop_v1.md`** (LangGraph Orchestration Migration + AOP Runtime Core v1 —
2026-09-06. Agent architecture는 **바꾸지 않는다** — WorldState · Planner · Procedure semantics ·
NeedKind · typed tools · Evidence · Knowledge/RAG · artifacts · Approval · Executor fences · Helper
그대로이고, 옮긴 것은 **custom conversation orchestration** 하나다. **§0 개발용 quota**: `enabled`는
「기록하는가」, 새 **`enforced`**는 「거절할 수 있는가」 — 하나였을 때 **한도를 끄면 계량기까지
꺼져서** usage·latency·cost가 가장 필요한 sitting이 아무 행도 남기지 않았다(대신 한도를 올리면 첫
pass가 모델이 아니라 할당량을 잰다). local/QA/bench는 `enforced=false`, production/pilot 기본값은
`true` 그대로, **거절된 호출은 여전히 미기록**(벤더가 청구하지 않은 지출), metering 없는 enforcement는
제공 안 함, 프로액티브 예산 양보도 같은 스위치를 읽는다(보이지 않는 두 번째 강제점 금지).
**§1 before**: `turnNow` **292줄** — 지역 변수 할당 순서가 orchestration이었고, 다섯 갈래 `if` 사슬과
early return 여섯 개가 그 안에 있었다(operator run은 **이미** LangGraph였고 turn 자체가 아니었다).
**§2 after**: `START → hydrate → chooseRoute ─┬ click / captureDecision / resume / direct
└ operator → procedure → compose → persist`. 노드 이름이 `chooseRoute`인 것은 LangGraph가 state
채널과 겹치는 노드를 거절하기 때문이고 operator graph가 자기 `interpretGoal`에 대해 적어 둔 그
규칙이다. **각 phase는 의미를 이미 소유한 코드에 위임**하므로 이관은 답을 바꿀 수 없다 — `turnNow`
**292 → 16줄**이고 구조 테스트가 「turnNow는 phase를 직접 부르지 않는다 · 각 phase의 call site는
정확히 1」을 고정한다. **§3 state는 id·닫힌 토큰·trail뿐**이고 `turnGraph` 모듈에 `token`·`artifact`·
`body`·`draft`·`approval`·`text`가 **낱말로도 없다**(구조 테스트); 협력자는 `configurable`로 흘러
직렬화되지 않는다 — **bearer token을 담을 수 있는 checkpoint는 그것을 흘리는 checkpoint다**.
**§4 AOP Runtime Core**(`src/aop/`): 정의는 **데이터**이고 step은 구현이 아니라 닫힌 `HandlerName`을
지목한다(데이터로 다시 쓰는 v1은 이관이 아니라 재구현이다); entry도 닫힌 토큰 표라 routing이
검사·정렬·테스트 가능하고, compile은 정의의 순서를 chain으로 만들며 **분기는 하나**(terminal을 세운
step이 마지막이다 — precondition 실패와 human interrupt가 공유하는 그 탈출구). publish되지 않은
handler를 지목한 정의는 **컴파일이 거절**한다. natural-language compiler·visual editor·business-user
builder는 **만들지 않는다**. **§5 여섯 절차 그대로**(새 절차 0), priority는 전순서라 「파일에서 먼저」가
계약이 아니며, **router는 두 번째 planner가 아니다**(판매자 문장을 읽지 않는다) — **대부분의 turn은
어떤 절차에도 속하지 않고 그것이 정직한 답이다**. 이 이관이 실제로 옮긴 판단은 **하나**: 절차 선택과
precondition이 composer 안에서 문장 쓰기와 뒤섞여 내려지던 것을 router가 정해 verdict로 넘긴다(같은
함수·같은 입력·소유자 하나; 문장은 여전히 composer의 것). **§6 persistence**: transcript·working set·
pending은 `ConversationStore`, 초안·승인·실행·지식은 backend DB, graph state는 **한 turn의 execution
cursor**뿐이다 — **in-process checkpointer를 붙이지 않았고 그것이 결정이다**(같은 사실의 두 번째
durable store는 resume 뒤 어긋날 수 있고 어느 쪽이 옳은지 말할 사람이 없다). **§7 interrupt는
일시정지이지 허가가 아니다** — `interrupt → 기존 approval validation → 별도 execute` 순서, 재실행
방지는 기존 single-use fence, 두 번째 resume은 아무것도 시작하지 않는다(테스트로 sync run 수 불변).
**§9 parity**: 스위트 **913 통과·실패 0**, 실 planner 라이브 parity **정확히 동일**(selection 46/48 ·
holdout 13/14 · 실패 turn 집합 문자 그대로 같음 · **새로 깨진 것 0**) ⇒ **dual runtime 없음, 이관
커밋이 곧 cutover**. 브라우저 4 turn 재확인(콘솔 0 · off-host 0). **§10 남은 custom orchestration을
정직하게 적는다**: `directLane` 내부(~300줄)는 orchestration이 아니라 **dispatch**라 노드로 쪼개면
switch문을 그래프로 그리는 일이 된다 · `compose`(~520줄)는 여전히 한 노드이고 procedure **판단**만
밖으로 나왔지 **표현**은 안에 있다 · **여섯 정의 중 subgraph로 실행되는 것은 아직 없다**(컴파일·
라우팅·검사는 실재하고, draft·tone·execute step은 여전히 `directLane`/`compose` 안에서 벌어진다 —
정의가 약속하고 런타임이 하지 않는 것처럼 읽히지 않도록 적어 둔다) · conversation별 직렬화는 그래프
밖이다. **§11 다음에 full AOP product를 만들 때**: **durable checkpointer가 먼저**이고 나머지 잔여는
전부 「절차가 turn보다 오래 살 수 있는가」에 걸려 있다(붙일 자리는 이미 있다) · compose를 표현
노드들로 쪼개기 · handler의 입출력 스키마 · 실행 중 정의 버전이 바뀌면 무엇이 되는가 · 절차별
텔레메트리(`conversation_procedure` 한 줄이 이번에 생겼다). **Planner prompt/model 무변경**(v16 ·
`gpt-5-2025-08-07`@`minimal`). backend **3,884** · frontend **2,762** · runtime **913** · 실패 0 ·
**마켓플레이스 0 · WRITE 0 · 승인 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음)

**`docs/aop_execution_closure_v1.md`** (AOP Execution Closure v1 — 2026-09-06. 직전 패키지에서 AOP 정의는
**데이터**가 됐지만 실행은 여전히 `directLane`/`compose` 안에 있었다. 이 패키지가 그 간격을 닫는다 —
**steps · precondition · terminal · interrupt가 설명 metadata가 아니라 실제 runtime path**가 된다. 새
Procedure 0 · 새 기능 0 · Planner/WorldState/tools/Evidence/Draft/Approval/Executor semantics 무변경.
**여섯이 실제로 도는 subgraph다**: `loadObject`(exact object load) · `gate` · *prepare* · *revise* ·
*approval* · *execute* · `settle`(ANSWER_INQUIRY) 등, 어휘 자체를 실행 모델로 다시 썼다(investigate ·
evidence · humanWait · resume 포함). step id가 state 채널과 겹치면 LangGraph가 거절하므로 outcome을 정하는
step은 `terminal`이 아니라 **`settle`**이다(turn graph의 `chooseRoute`, operator graph의 `interpretGoal`과
같은 규칙). **`CAPTURE_KNOWLEDGE`에 wait step이 없는 것이 요점** — 질문을 put하는 것은 `ANSWER_INQUIRY`의
draft step이고(그래서 그 절차가 `KNOWLEDGE_ANSWER`를 함께 선언한다) 이 절차는 판매자가 **답했을 때** 도는
쪽이며, 답이 아니었던 문장은 이 절차의 turn이 아니므로 놓아 준다. **directLane에서 제거한 procedure
transition 넷**: pendingCapture→capture resume · tone→revise와 그 precondition · ANALYZE의 「draftable이면
초안, 아니면 advisory」 판단 · prepareIntent→prepare. **남긴 것은 dispatch**(acquisition · freshness ·
referentless · ordinal · filter · prioritize · label select) — 노드로 쪼개면 LangGraph가 아니라 switch문을
그래프로 그리는 일이다. 문장은 `procedureIntent.ts`에서 **한 번** 닫힌 토큰으로 읽히고 그 아래로는 아무도
판매자의 말을 보지 않는다(router는 여전히 두 번째 planner가 아니다). turn graph는 라우트 하나를 얻었고
(계획 이전 `procedure`는 terminal이면 그 turn이 끝, 대상을 못 실었으면 ordinary lane으로 **놓아 준다**),
두 방문은 **trail로 구분**한다(노드는 자기가 어디서 들어왔는지 모르고 `route`는 turn이 어떻게 시작했는지를
계속 말해야 한다). **Durable checkpoint `AopCheckpointStore`**: conversationId · procedureId+version · step ·
object refs · draftId · approvalId · terminal뿐이고 `sanitize()`가 **whitelist**라 선언되지 않은 필드는
통과하지 못하며 `forbiddenKeysIn()`이 실제 write에 대고 body·text·draft·token류 부재를 단언한다. Memory
기본 · File은 프로세스를 넘고 · **`claim()`이 exactly-once 게이트**여서 claim을 잃은 resume은 **step을
하나도 실행하지 않는다**(duplicate side effect 0의 구조적 근거); 끝난 절차는 cursor를 지운다(자기 run보다
오래 사는 cursor는 나중 resume이 「아직 할 일」로 오인할 물건이다). thread id는 `${conversationId}:${procedureId}`라
멈춘 두 절차가 서로를 resume하지 않는다. **interrupt는 허가가 아니다** — cursor의 `approvalId`는 **id**이고
유효성은 매번 그 기록에서 읽는다(verdict를 담으면 resume이 아무도 두 번 주지 않은 「예」를 물려받는다);
`approval`·`execute` step은 chat 문장에서 **도달 불가**다. parity: 스위트 **922 통과·실패 0**, 라이브 실
planner selection **46/48** · holdout **13/14**로 **실패 turn 집합 동일 · 새로 깨진 것 0**, 브라우저 4 turn
동일이며 「조금 더 부드럽게 써줘」가 이제 `ANSWER_INQUIRY.settle`의 precondition으로 답한다(콘솔 0 ·
off-host 0). **마켓플레이스 0 · WRITE 0 · 승인 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음.
**계약이 바뀌어 테스트 4건을 다시 썼다**(aopCore의 step 목록 · procedureLayer의 gate call site 2→3 —
세 번째가 절차 자신의 gate이고 **같은 함수**다 · semanticOwnership의 `analyzeIntentOf` 파일 목록 ·
turnGraphOwnership의 router call site 1→3, 각각 이름 있는 메서드 안); 안전 테스트 약화 0. **아직 legacy에
남은 business decision을 정직하게 적는다**: compose의 **post-plan ANALYZE 가드**(pre-plan 쌍둥이만 옮겼다 —
옮기려면 플래너의 target 루프를 subgraph로 보내야 하고 그것은 별도 패키지다; 구조 테스트가 이 잔여를 이름으로
고정한다) · `compose`는 여전히 한 노드이고 **판단은 나왔으나 표현은 안에 있다** · `ANSWER_REVIEW`의
loadObject/prepare는 chat lane에서 도달하지 않는다(리뷰 답글은 작업 화면이 소유한다) · `approval`·`execute`는
아직 chat에서 실행되지 않으며 그것을 옮기려면 승인 계약을 건드려야 한다 · conversation별 직렬화는 그래프
밖이다. **성공 기준**: 새 workflow는 정의 추가 + 기존 handler 안이면 `directLane`·`compose`에 새 `if` 없이
붙는다; 다만 **새 handler가 필요하면** 닫힌 `HandlerName` union과 `ProcedureOps`를 함께 고쳐야 하고(정의가
런타임이 publish하지 않은 행동에 닿을 수 없어야 한다) 새 종류의 화면 출력은 여전히 compose를 건드린다)

**`docs/agent_runtime_production_closure_v1.md`** (Agent Runtime Production Closure v1 — 2026-09-06.
새 architecture·새 기능 **0**. 질문 하나: 지금 런타임이 **process · container · concurrency 경계**에서도
옳은가. Planner · WorldState · Procedure semantics · NeedKind · typed tools · Evidence · Draft ·
Approval · Executor fence · Helper **무변경**. **§1 감사가 찾은 것은 성능이 아니라 caller 0이었다** —
`procedureCheckpoints` seam은 선언돼 있었지만 `http/main.ts`가 넘기지 않아 **배포된 호스트의 모든
stopped procedure가 메모리에 있었다**(container replacement에서 소실 · replica 둘이면 서로를 못 본다;
파일 store는 로컬 restart proof에만 옳고 `.claim`은 `existsSync`+`writeFileSync`라 프로세스 사이의
lock이 아니다) ⇒ 가장 단순한 것이 **기존 PostgreSQL**이었다: `agent_runs`가 이미 org-scoped identity ·
version · **진짜 claim**(상태를 RESUMING으로 옮기는 UPDATE + 2분 crash lease)을 갖고 런타임이 이미 그
표에 말하므로 **새 표·마이그레이션·엔드포인트 0**이고 바뀐 것은 셋(domain `PROCEDURE` 추가 ·
`WAITING_HUMAN`을 claimable로 만드는 절 하나 · `SpringAopCheckpointStore`). **domain을 나눈 것이 fence**
— `CONVERSATION`은 자기 것 셋(`text`·`message`·`content`)을 갖지만 **cursor는 자기 것이 없어서**
STRICT set을 진다(라이브에서 같은 키가 PROCEDURE 400 · CONVERSATION 200). status를 `AWAITING_APPROVAL`로
재사용하면 lock을 공짜로 얻지만 **컬럼에 거짓말이 남는다**(절차는 지식 답변을 기다리며 멈출 수 있고
그것은 승인이 아니다). 저장 가능한 것은 여전히 cursor뿐이고 `sanitize()`는 whitelist다. store는 다른
모든 durable store와 같은 이유로 **요청마다** 해석된다(`RunStores.procedureCursors`,
`ProcedureRuntime.run`이 store를 호출마다 받는다 — 컴파일된 subgraph는 그대로 한 번만). 로컬 두 store의
결함도 닫았다: claim이 `delete`에서만 풀려 **두 번째로 멈춘 절차가 영원히 resume 불가**였다. **§2
conversation은 어디에서도 직렬화되지 않는다** — 그리고 `SpringConversationStore`가 자기 version guard를
무력화하고 있었다(save 안에서 읽고 바로 쓰므로 **409 한 번 없이 조용히 덮어쓴다**; 실측으로 먼저 쓴
turn이 사라졌다) ⇒ merge를 409 핸들러가 아니라 **평범한 경로**로 만들었다(어차피 필요한 그 읽기가 지금
저장된 것을 말하고, transcript는 append-only라 합침이 모호하지 않다; 움직이지 않은 대화에서 merge는
**항등**). **index가 더 흔한 충돌이었다** — org당 행 하나라 서로 다른 두 대화가 동시에 저장만 해도
부딪히고, 그 예외는 **대화가 이미 저장된 뒤에** 던져져 판매자의 turn을 실패시켰다. AOP claim은 진짜
exactly-once(라이브 Postgres에 **동시 4회** → CLAIMED 정확히 1), claim을 잃은 run은 **step 0**.
**§3 cross-surface: orchestration 중복은 없고**(draft·precondition·approval·execute의 owner는 백엔드
하나) **한 질문이 두 곳에서 답해지고 chat 쪽이 틀렸다** — 「지금 이 리뷰로 가이드형 답변을 시작할 수
있는가」를 리뷰 화면은 서버의 `canStartSubmissionRun`을 읽어 답하는데 대화는 **채널 capability만** 보고
스스로 정해, 채널이 이미 답변한 리뷰에 「판매자센터 입력칸에 넣어 두겠습니다」를 약속했고 **어떤 mint도
그 약속을 지킬 수 없었다**(mint는 409) ⇒ 화면을 chat 경로에 태우지 않고 **대화가 이미 손에 든 응답을
읽는다**(닫힌 이유 `CHANNEL_ALREADY_ANSWERED`·`SOURCE_NOT_EXECUTABLE`, 토큰 노출 0, [복사] 유지).
문장이 두 곳인 것은 중복이 아니라 **register 차이**이고 중복이었던 것은 규칙이다. **§4 compose 잔여
ANALYZE guard verdict = procedure decision** — 그것은 **어느 business step이 도는가**(advisory냐
production draft path냐)를 고르므로 `src/aop/answerStep.ts`로 옮기고 **두 lane이 묻는다**; compose에
남은 것은 렌더링이고 compose 전체 분해는 하지 않았다. 토큰은 **둘**(`PREPARE`·`ADVISE`) — REFUSE가
없는 이유는 두 caller가 각각 초안도 만들고 거절도 하며 **같은 `inquiryDraftPrecondition`**을 지나기
때문이다. 부수 효과로 **판매자의 문장은 turn당 정확히 한 번 읽힌다**(`analyzeIntentOf(` 보유 파일 3→**2**,
구조 테스트가 고정). **§5 proof**: 오프라인은 실제 client + 백엔드 계약 fake 위에서 container
replacement(빈 version 캐시의 새 client + 새 runtime)와 두 replica의 경주를 재현한다 — production이
backend store를 해석 · 저장된 cursor의 키 == `CHECKPOINT_KEYS` · 다른 org는 load null/claim CONFLICT ·
fresh process가 **같은 절차 · 같은 refs**로 이어받음 · 동시 claim ×3 → 1 · replica ×2 → `resume` 1회 ·
끝난 절차의 두 번째 resume은 그 run에 닿지 못함 · claim 잃은 run step 0 · 다시 저장된 cursor는 다시
claimable · cursor는 approval **id**만 들고 verdict를 들 자리가 없음 · 서지 않는 승인은 **execute
이전에** 멈춤. 라이브는 일회용 org의 실제 Postgres(A 저장 200/키 13 · B 동시 4회 → 1 CLAIMED ·
C 400 · D 200 · E fresh 읽기 + DELETE 204 · F 404/404). **라이브 planner parity**: pass 2에서
selection **46/48** · holdout **13/14**로 **실패 turn 집합 문자 그대로 동일 · 새로 깨진 것 0**
(pass 1의 44/48은 숨기지 않고 적는다 — 둘 다 `NO_CHANNEL` world의 planner 변동이고 코드를 한 글자도
바꾸지 않은 pass 2가 이관 전 집합을 재현했다). 브라우저 4 turn(Demo Org, 콘솔 0 · off-host 0),
**마켓플레이스 0 · WRITE 0 · 승인 0 · 실행 0 · 신규 draft 행 0 · 마이그레이션 0** ⇒ evidence 행 없음.
backend **3,886** · runtime **938** · 실패 0. **§6 남은 single-process assumption**: 대화 turn 사이에는
여전히 lock이 없다(두 동시 turn은 서로를 모르는 답을 낸다 — replica를 넘는 lock 없이는 못 고친다) ·
AOP claim은 cursor가 **이미 있을 때만** 잡히므로 같은 절차의 첫 실행 둘은 동시에 돈다 · 파일 store의
`.claim`은 원자적이지 않다 · `scopeCache`는 file/memory 전용 · 로컬 두 conversation store는
last-write-wins · 파일럿은 런타임 replica 하나다. **§8 Agent runtime architecture FREEZE** — 다음은
구조 리팩터링이 아니라 manual pilot QA와 실제 workflow 검증이다)

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

**`docs/review_approval_path_v1.md`** (Review Approval Path v1 — 2026-09-03. 새 기능이 아니라 **이미
동작하는 승인 경로에 도달할 수 없던 문제**만 닫는다. Template Settings · selector · Grounded Drafting ·
Chat semantics · visual system · approval/write architecture · Guided Reply execution driver는 **freeze**.
**직전 안내가 실제 UI와 불일치한 이유를 먼저 잰다** — 「내 답변 작업 3번째 카드」의 각 조각은 DOM에
있었고 화면으로서는 없었다: `/reviews/{account}` 문서 **5,587px**(뷰포트 900)에서 그 제목은 y=**3,420**,
첫 「승인」은 y=**5,425**(6 화면 아래), 첫 화면은 리뷰 **4,455개** 기록이며 대상 `c329471c`는 tier가
`참고`라 「확인 필요순」 1페이지에 **없다**. 「3번째」라는 좌표도 화면에 번호로 적혀 있지 않다 —
**판매자가 셀 수 없으면 좌표가 아니다.** ⇒ 결함은 승인 기능의 부재가 아니라 「어느 리뷰인지 아는 상태」
에서 「그 리뷰의 승인 버튼」까지 가는 길의 부재. **§1 주소가 진입점**: 기존 exact read를 재사용해 라우트
둘 — `/reviews/:accountId/reply/:reviewId`(모든 reply 엔드포인트가 이미 받는 쌍, 읽기 1회)와
**`/reviews/reply/:reviewId`**(대화는 리뷰 id만 들고 있으므로 계정은 wire가 아니라 화면이 org-scoped
exact read로 푼다 — 두 번째 식별자를 계약에 넣어 읽기 한 번을 아끼는 것은 잘못된 교환이고, 남의 org id는
그 읽기에서 404라 삭제된 리뷰와 같은 실패로 착지한다). `actionRef`는 계약대로 **파싱하지 않는다**.
**§2 배치를 뒤집었다** — 「내 답변 작업」이 기록 **아래**에 있던 이유(「기록의 후속 조치이지 무엇을 봐야
하는지의 두 번째 목록이 아니다」)는 **그것이 무엇인가**에 대해 여전히 참이고 **어디에 놓이는가**에
대해서는 틀린 결론이었다: y **3,420 → 161**, 세 폭 전부 fold 위, 목록보다 먼저. 그리고 업무 상태에
이름이 생겼다 — 행의 chip 셋(`미답변`=채널이 한 말 · `기타`=무엇에 관한 것인지 · `답변함으로 기록`=운영자
보고) 중 어느 것도 「어느 행이 내 승인을 기다리나」에 답하지 않았다 ⇒ `ReviewReplyWorkState`
{`DRAFT_NEEDED`·**`AWAITING_APPROVAL`**·`APPROVED`}, `null`은 네 번째 상태가 아니라 reply work를 질 수
없는 행(capability 부재는 진술의 부재). **`hasReplyPreparation`의 사본이 아니다** — 그 boolean은 초안 ·
서 있는 승인 · **철회된** 승인을 합집합하고(패널 mount에는 정확히 옳다), 「승인을 기다린다」와 「이미
승인했다」는 반대 지시다 ⇒ 배치 쿼리 **하나** 추가(`findReviewIdsWithStandingApproval`, state=APPROVED,
인덱스 조회 1회/페이지). 정렬·개수는 **표현 규칙**(승인 대기→초안 필요→승인됨, 같은 상태 안 서버 순서
유지; 제목은 **승인 대기만** 세고 0은 렌더 0 — 세 행 위의 「3건」은 판매자가 지금 할 수 없는 일을 센다).
**§3 작업 화면**: 상품 · ★ · 작성일 · 고객 문장 · 초안 · 저장 · **승인**이 한 화면이고 목록·필터·정렬·
페이지네이션 **0**, AI tier/분류는 **지우지 않고 접는다**(정렬된 이유이지 답변의 근거가 아니다);
`ReplyWorkControls`는 기록·큐가 mount하는 **그 클러스터 그대로**라 두 번째 reply flow가 없고 이 화면이
얻은 write는 **0**(승인 경계·append-only version·fingerprint 무변경, dirty면 저장 전 승인 불가).
부수로 `VocItemReplyPrep`의 heading level이 caller 소유가 됐다(고정 `h4`가 이 화면에서 h2/h3를 건너뛰던
axe `heading-order` — 취향이 아니라 읽기 순서 결함). **§4 primary**: 「승인」이 틴트(`bg-brand/10`)에서
측정된 solid primary(`brand-700` 5.41:1 · hover `brand-800` 7.38:1)로 — 되돌리기 어려운 유일한 결정이
텍스트 저장과 같은 무게를 지고 있었다; 「복사」와 경쟁하지 않는다(복사는 승인이 선 뒤에만 있고 그때 이
버튼은 사라진다). **sticky는 쓰지 않았다 — 필요 없었다**: 1440/1366/1152 **전부 문서가 뷰포트를 넘지
않고** 승인 y=**478**. **§5 chat handoff**: `conversationWriteFence` **무변경**이고 승인을 대화 안으로
들이지 않았다 — 바뀐 것은 리뷰 action artifact 둘의 `to` 문자열(`"/reviews"` → `/reviews/reply/{id}?from=chat`)
과 FE 문구(「리뷰 화면에서 확인」 → 「이 리뷰의 답변 작업 열기」)뿐. `from=chat`은 상태가 아니라 「돌아갈
길을 제시해도 된다」는 신호이고 그 대화는 `/`의 org-네임스페이스 포인터가 이미 복원한다(새 배관 0);
기록에서 들어오면 그 링크는 렌더되지 않는다(가 본 적 없는 곳으로 가는 길은 거짓이다). fence는 **소스
스캔** — 두 리터럴이 helper를 쓰고 bare `/reviews`를 쓰지 않으며 `routeSend`가 approve/publish/execute/
outcome에 이름으로도 닿지 않는다. **§6 라이브 QA**(재기동 후 실제 Demo Org, 대상 `c329471c` 초안 v3
`44627df4…`): 대화 진입 → **한 번의 navigation** → exact target → v3 초안 표시 → 승인 활성·solid,
1440/1366/1152 동일; 기록 화면은 「승인 대기 2건」과 대상이 **첫 행**. **AA 위반 3폭 전부 0** · 가로
스크롤 0 · 콘솔 오류 0 · off-host 0. **판매자 클릭 2회**(링크 1 + 승인 1, 스크롤 0) — 전에는 1회 +
3,420px 스크롤 + 카드 세기. 사후 확인: 초안 head **v3 무변경** · 대상 approval **0** · submissionRef
**0** · `RESPONSE_NEEDED` 유지. backend **3,669** · runtime **829** · frontend **2,685** · 실패 0.
**마켓플레이스 호출 0 · WRITE 0 · 모델 0 · 마이그레이션 0 · 승인 0** ⇒ evidence 행 없음. **계약이 바뀌어
테스트 1건을 다시 썼다**(「the page ends with 내 답변 작업」 → DOM position으로 「목록보다 먼저」).
**고치지 않고 보고**: 기록 화면의 첫 승인 버튼은 1152×720에서 fold 아래(y=746/720 — 큐를 접는 것은 이
패키지가 하지 않기로 한 워크리스트 재설계이고 보장된 경로는 작업 화면이다), 작업 큐 행의 첫 줄은 여전히
상품명, 행마다 패널 mount(행당 읽기 1회) 유지, `frontend/CLAUDE.md`가 그 workstream에 금지한
`backend/**` 수정을 product-owner 지시(「없다면 최소한으로 추가한다」)에 따라 읽기 전용으로 셋 했다는
충돌, 대화의 **읽기용** 리뷰 artifact는 여전히 bare `/reviews`, 그리고 Phase 2 라이브 실행은 보류·승인은
판매자의 것).

**`docs/knowledge_retrieval_quality_v1.md`** (Knowledge Retrieval Quality v1 — 2026-09-03. 판매자가
올바른 Knowledge를 넣어도 고객의 표현이 조금만 달라지면 못 찾던 병목 하나만 닫는다. Source / Canonical
Knowledge / Answer Memory / Style 분리 · PRODUCT/ORG scope · provenance · active · 문서 import ·
evidence contract · Candidate는 **그대로**. **감사가 좋은 소식을 먼저 줬다** — 세 lane이
`KnowledgeRetriever.rank` **한 함수**로 수렴하고 scope·active·variant·topic 거절은 전부 그 앞에서 끝나므로
바꿀 seam이 하나였다. 병목은 셋으로 갈렸고 하나만 「의미」였다: **부재 게이트 희석**(분모가 모든 내용
어절이라 「두께」 FOUND · 「두께가 생각보다 얇아 아쉬웠습니다」 0.13으로 탈락) · **활용/띄어쓰기**(떨어지↔떨어질은
조사도 어미도 아니다) · **진짜 동의**(들뜨다→접착). 그리고 **lexical 자신이 wrong-source의 출처였다**
(「제주도인데 며칠」→「반품과 환불 안내」, 그 문서에 `도착`이 있다 — 겹침이 진짜라 어떤 임계값도 못 가른다).
**구현 전에 benchmark를 만들었다**: 4도메인 fixture(몰딩·주방매트·선풍기·회사정책 + 「교환만 있는 회사」·
「문서 하나뿐인 회사」) 소스 15 · 질문 46(A~I + J 규격토큰 + K 단일문서), Recall@4 · wrong-source ·
no-evidence precision 셋을 함께 본다(recall만 보면 전부 돌려주는 retriever가 이긴다). harness는 production
클래스를 그대로 부르고 벡터만 checked-in 캐시라 **CI는 벤더를 부르지 않는다**. **측정이 답한 것 다섯**:
① 절대 cosine 임계는 원리적으로 실패한다(「자꾸 들떠요」 0.159 vs 「너무 좋아요 만족합니다」 0.176 — 분포가
겹쳐 recall과 no-evidence를 동시에 못 산다), ② **차원은 품질 변수**(같은 모델 256차원은 margin에서
no-evidence 33%까지), ③ **비교 단위는 passage가 아니라 문장**(「두께」 vs 세 두께를 적은 문단 0.310 · 옆
색상 노트 0.306 — 통짜 문단에겐 둘 다 「이 몰딩에 대한 글」이고, 판매자가 보는 passage는 그대로 두고 자기
최고 문장의 점수를 받는다), ④ **부재는 높이가 아니라 모양**이다 ⇒ leave-one-out margin(「최고 passage가
나머지로부터 얼마나 떨어져 있나」 — lexical의 `MIN_TOPIC_COVERAGE`가 이미 하는 주장과 같다: 이 코퍼스가
해낸 것으로 나눈다), ⑤ **hybrid는 측정으로 기각**(선택 지점에서 lexical union은 recall을 하나도 더하지
못하고 wrong-source만 0%→11.1%로 되돌린다 — lexical의 오류는 전부 admission이다). 결과
**recall 38.9% → 86.1% · top1-wrong 5.6% → 0% · any-wrong 11.1% → 0% · no-evidence 90% 유지**.
채택: `text-embedding-3-large` 1024차원 · 문장 단위 · LOO margin 0.10 · band 0.90 · 단일 문서는 자기
약한 규칙(절대값). **semantic이 부재를 판정하고 lexical은 그것이 불가능할 때의 답**이다(capability off ·
미색인 passage · 벤더 무응답 ⇒ 하나라도 못 보면 전체가 예전 그대로 — 절반만 읽고 내린 부재는 절반에 대한
부재다). **scope는 재판정되지 않는다** — semantic lane은 lane이 만든 candidate 목록만 보고 구조 테스트가
repository·findAll·isActive를 이름으로 막는다(은퇴한 매뉴얼은 목록에 없어 아무리 가까워도 못 찾는다).
후보 사다리는 semantic에서 쓰지 않는다(그 넷은 lexical 분모 희석 우회용이고 벡터엔 그 분모가 없다 · 형태당
호출 1회). **교환 ≠ 반품**: 남은 wrong-source는 한 모양이었다(「반품 배송비」가 「교환 안내」를 0.51로 가져와
왕복 6000원을 반품비 3000원 자리에) ⇒ **enum은 쪼개지 않고**(`EXCHANGE_RETURN`은 플래너 토큰이자 판매자
받은함 필터이고 거기선 한 칸이 옳다) 근거 자격을 정할 때만 `remedyApplicable`로 더 잘게 묻는다 — 거절 전용 ·
제목/질문 텍스트만 · 둘 다 이름 지은 문서는 둘 다 근거. **저장소는 기존 PostgreSQL**(pgvector 없음 —
이 배포에 확장이 없고 필요도 없다: 검색은 늘 상품 하나/회사 하나로 경계지어져 실측 4·6·26행이며 그 크기에서
ANN은 마이크로초 선형 스캔에 운영 표면과 비결정성만 더한다), V92 `knowledge_embedding`은
**content-addressed**(`org, model, dimensions, sha256`)라 **lifecycle이 사라진다** — 수정하면 새 해시라
낡은 벡터는 다시 조회되지 않고, 되돌리면 캐시 적중으로 **임베딩 0회**(실측 32→33행), 은퇴는 candidate
목록에서 빠지므로 표를 건드리지 않는다. **질문 벡터는 저장하지 않는다**(고객 문장의 두 번째 사본 금지).
쓰기는 검색 시점 `REQUIRES_NEW`(벤더 호출이 판매자의 저장 트랜잭션에 들어가지 않는다) · 백그라운드 잡 0.
**일곱 번째 LLM capability, 기본값 OFF** — 자기 flag·key·door(`AgentDraftBoundaryTest` 표가 여섯 번째 행을
얻었다)·payload floor(model·dimensions·texts **셋뿐**, 일곱 중 가장 좁다). **정직하게 이름 붙이는 새 노출
하나**: 매 검색마다 **고객의 질문**이 나간다 — `NO_ANSWER_BASIS` 초안과 판매자의 검색 상자는 오늘 모델을
0회 부르므로 이것은 widening이고, 그래서 머지가 아니라 **배포 결정**이다(꺼 두면 바이트 단위로 이전과 동일).
**§7 실행 중 기존 결함 하나를 찾아 고쳤다** — `PUT …/knowledge/sources/{id}`가 **500**이었다
(`uq_pk_chunks_ordinal`: Hibernate가 모든 insert를 모든 delete보다 먼저 실행한다). 지식 **추가**는 되고
**수정**만 안 돼서 아무도 못 봤다; 두 인덱서에 `flush()` 한 줄, 그리고 회귀 테스트가 실제로 빨개지게 하려고
두 chunk 엔티티가 마이그레이션이 늘 갖고 있던 유니크 인덱스를 이제 `@Table`에 **선언**한다. **§9 Knowledge
Need는 retrieval과 분리해 감사**했다 — 기준(「이 리뷰에 답하려면 판매자 고유 사실이 실제로 필요한가」)이
닿지 못하는 경우는 정확히 하나, **별점이 반대를 가리키는 ★5 질문 리뷰**였다 ⇒ `QuestionShape`(토픽이 아니라
**문법**: `QueryWords`가 갖고 있던 닫힌 목록의 의문 부분집합, 낱말 추가 0) 절을 **하나 더하고 아무것도 빼지
않았다**. **빼려다 되돌린 것을 기록한다** — 「빈 라이브러리면 무조건 묻는다」를 지우면 §E 칭찬은 깨끗해지지만
★4 「괜찮긴한데 잘떨어지네요」를 잃는다(별점이 볼 수 없는 불만이고 이 lane이 존재하는 이유). 라이브가 하나
더 드러냈고 고쳤다: 회사 배송 정책으로 GROUNDED가 된 초안이 같은 화면에서 「이 **상품**의 기준이 있나요」를
묻고 있었다 ⇒ grounded 판정을 「**어느 lane이든** 답했는가」로. **라이브 before/after**(일회용 QA org ·
리뷰는 파일 업로드 · 지식은 판매자 CRUD · 실제 판매자 데이터 0 · DB 직접 수정 0 · **c329471c 무접촉**):
검색 **3/15 → 12/15**, 초안 **1/5 → 3/5 GROUNDED**이고 「두께가 생각보다 얇아 아쉬웠습니다」가 판매자 자신의
규격 노트(1.2/1.6/2.0mm)를 인용해 답한다; 칭찬은 before/after 모두 요청 0. **지연·비용 실측**: warm
137–408ms(질문 임베딩 1회) · **cold 2,734ms**(그 코퍼스 첫 검색) vs lexical 5–29ms, 벡터 **32행 131KB**
(행당 4KB), 검색당 질문 ≈20토큰 — 다만 임베딩은 판매자 **일일 AI 예산에 청구되지 않고** 그것은
**product-owner 결정**으로 올린다. **overfit 점검**: production 코드에 「실리콘」·「전선몰딩」·「선바로」·
「떨어」·특정 org/product id·이번 QA 문장 **0건**. **여전히 실패하는 것**: 「잘떨어지네요」·「자꾸 들떠요」
(가장 큰 남은 gap) · 「방수 되나요?」가 부착 안내를 가져오는 false evidence 1건(m=0.12면 닫히지만 「두께가
생각보다…」를 잃는다) · 「언제쯤 받아볼 수 있을까요?」 · polarity 미검출 · 첫 검색 2.7초. backend **3,737** ·
실패 0 · **마켓플레이스 호출 0 · WRITE 0 · 승인 0 · 실행 0 · 마이그레이션 1** ⇒ evidence 행 없음.
**계약이 바뀌어 테스트 2건을 다시 썼다**)

**`docs/knowledge_retrieval_quality_v2.md`** (Knowledge Retrieval Quality v2 — 2026-09-03. v1이 방향을
증명했으니 v2는 **그 숫자가 정직한지 먼저** 확인했다: 46개 벤치마크는 v1의 임계값을 고르는 데 쓰인 집합이라
**114개 · 7 라이브러리**(원두·가죽·**값이 반대인 다른 회사 정책**·**문서 18개 종합몰**)로 넓히고 범주 셋을
더하자(**L 오타** 두깨·몆일·싸이즈 · **M 한두 낱말** 보관?·소음 · **N 질문하지 않는 불만**) v1의
**86.1%가 79.6%로 읽혔다**. arm은 각각 독립 측정: **B passage 요약 +1.0pp(소음)** · **C1 query intent만
90.3%/부재 90.5%** · **C2 원문+intent 93.5%** · **D synthetic question 색인은 해롭다**(74.2%, 부재 71.4% —
생성된 질문이 이웃 질문과도 가까워 corpus 바닥을 올리고 LOO margin을 무너뜨린다; v1의 hybrid 기각과 같은
모양) · **E eligibility는 recall을 사지 못하고 wrong-source와 false evidence를 전부 지운다**(0%/100%). 채택은
**F5 = 원문+intent + 랭킹 후 거절 전용 judge → 92.5 / top1-wrong 0 / any-wrong 0 / no-evidence 100**;
**C2 단독은 기각**했다(any-wrong 2.2 · 부재 85.7 — v1이 세운 「wrong-source 0」 보증을 못 지키고, 안전 테스트를
약화시켜 얻는 recall은 교환 조건이 아니다). 부재 게이트의 cluster-aware 변형도 만들어 재고 **기각**(control은
+3.2pp지만 부재 76.2→71.4 · any-wrong 1.1→3.2, 채택 조합에서는 전면 후퇴). 새 capability **둘**, 둘 다 **기본값
OFF** — 8번째 `knowledge.intent`(고객 문장 **하나만** 나가고 「무엇을 알아야 답하는가」로 되쓴다; 판매자가 친
질문은 사지 않는다 — 자기 어휘를 쓰고 있으므로) · 9번째 `knowledge.eligibility`(**고객 문장 + 판매자 문단이 한
요청**에 담기는 셋 중 가장 넓은 payload라 자기 flag·자기 key; `KnowledgeTopic`과 **같은 거절 전용 모양**이고
문단 6개 상한, 못 찾은 검색은 0원). **채택한 조합은 생성물을 하나도 저장하지 않는다** — intent는 고객 문장의
파생 사본이라 표도 컬럼도 만들지 않고 세 lane이 도는 5분만 메모리에 남으며(구조 테스트가 `Repository`·
`@Entity`·`save(` 부재와 그것을 아는 파일이 셋뿐임을 고정), judge의 출력은 boolean 하나다; **저장될 뻔한 유일한
생성물이 synthetic question이었고 측정이 그것을 기각했다** ⇒ Grounded Draft의 근거와 판매자 인용은 언제나 원본
source이고 그것을 지키려고 새로 만든 장치는 0. 지식 획득 경로 6종은 감사만 하고 **변경 0**(문서 업로드는 여전히
chunk 승인이 아니라 종류·범위·현행 여부만 묻고, 과거 답변은 자동 Canonical이 아니다). **라이브 before/after**
(일회용 org · 승인 0 · 실행 0): v1이 「여전히 실패한다」고 적어 둔 **「잘떨어지네요 자꾸 들떠요」가 판매자 자신의
부착 안내를 인용**하게 됐고, **「한 번 썼는데 눌어붙었어요」가 반품 정책을 근거로 들던 틀린 인용이 사라졌다**;
capability를 분리해 한 번 더 돌리자 벤치마크의 이야기가 그대로 재현됐다 — **intent는 recall과 wrong-source를
함께 올리고 judge가 틀린 쪽만 걷어낸다**(둘은 짝이지 선택지가 아니다). 실측 지연: 검색만 하는 turn
**0.37s → 1.9~2.8s**, 초안 turn 5.7~13.4s → 10.3~25.6s; 벡터 39행/156KB. **Graph/ontology는 아직 필요하지 않다** —
114+7건의 실패 원인에 관계형 multi-hop이 **0건**이고 재검토 조건만 적어 둔다. 남은 결정: 세 capability 모두
**판매자 일일 AI 예산 밖**(v1의 결정이 이제 셋이고 둘은 검색당 LLM 왕복) · 지연 수용 여부 · 벤더로 나가는 폭 ·
모델 · 파일럿 org 지정. backend **3,749 tests · 실패 0**, 벤치마크는 CI에서 벤더를 부르지 않는다(기각된 arm의
캐시는 넣지 않았다 — 기각한다는 것이 그 뜻이다). 회귀 기준 상향: recall ≥ 0.90 · any-wrong 0 · 부재 정확도 1.0 ·
lexical 대비 +0.45. **마켓플레이스 호출 0 · WRITE 0 · 승인 0 · 마이그레이션 0** ⇒ evidence 행 없음. **§12 Holdout 검증(09-03, 같은 커밋 · production 변경 0)**: 114 벤치마크는 architecture selection에도 쓰였으므로 **한 번도 보지 않은 44문항**(사료·카시트·앰플 + 회사 정책 — 어휘가 겹치지 않는 네 도메인, 실제 판매자 CRUD와 실제 `draft/generate` 경로)으로 다시 쟀다. **v1 80.6/8.3/19.4/50.0 → intent만 97.2/2.8/**30.6**/62.5 → F5 **97.2 / 0 / 0 / 100**** — 벤치마크의 이야기(intent가 recall과 wrong-source를 함께 올리고 judge가 그것을 0으로 되돌린다)가 unseen data에서 그대로 재현됐고 **「92.5/0/100」은 selection artefact가 아니었다**. judge는 15문단을 제거해 **14개가 옳은 제거**였다. **관측된 유일한 실패는 threshold가 아니라 성질이다** — 「화장품 냉장고에 넣어도 되나요?」가 채점 pass에서만 근거 없음이었고 반복 2회는 GROUNDED, 반대로 「몇 방울이나 쓰는 게 맞아요?」는 채점 pass에서만 맞았다: v1의 검색은 결정론이었으나 F5는 세 단계 중 **둘이 매 검색마다 새로 이루어지는 모델 호출**이라 경계선에서 흔들리고, **「같은 리뷰를 두 번 열면 같은 근거가 보인다」는 보장이 사라졌다**(고치지 않고 이름만 붙였다). 실측 호출·지연: intent **질문당 1회**(검색만 하는 turn 347ms → 2,556ms — 왕복 한 번의 크기이고 세 lane이 5분 메모를 공유한다), judge **48회**(상품 28 + 정책 20, 못 찾은 검색은 0회, 근거를 찾은 turn에 약 +1.3초), 전체 turn p50 6.3s → **10.6s** · p95 15.6s → **22.2s**. **이 44문항은 소진됐다** — 두 번째로 쓰면 selection 집합이 되므로 harness에 넣지 않았다. 파라미터 수정 0 · 마켓플레이스 0 · 승인 0)

**`docs/retrieval_runtime_closure_v1.md`** (Retrieval Runtime Closure v1 — 2026-09-03. Knowledge Retrieval
Quality v2는 **PASS**이고 recall은 더 올리지 않는다. threshold · scorer · candidate ladder · 프롬프트 · 모델 ·
세 lane 구조 **전부 그대로**이고, 이 패키지는 F5를 **판매자 제품에서 일관되고 반복 가능하게** 만든다.
**착수 이유는 holdout이 이름 붙인 성질이다** — v1의 검색은 결정론이었는데(「인용이 장식이 아니라 근거가 되는
전제」) F5는 세 단계 중 **둘이 매 검색마다 새로 이루어지는 모델 호출**이라 경계선에서 흔들리고
「같은 리뷰를 두 번 열면 같은 근거가 보인다」가 사라졌다 ⇒ 캐시가 아니라 **구조로** 되돌린다.
**§1 감사 결과 본체는 이미 서 있었다** — 문의 상세와 리뷰 답변 작업 **어느 쪽도 retrieval을 다시 돌리지
않고**(`InquiryEvidenceRetriever`를 이름으로도 모른다) 저장 행과 인용 행을 읽는다. 없던 것은 **리뷰 lane의
answer basis 한 칸**과 그 성질을 고정하는 테스트였다: `review_reply_draft.answer_basis`는 Grounded Review
Drafting v1부터 채워지는데 **읽는 코드가 0**이라 「근거 있음 / 기본 문구」가 그 세션의 `result`에서만 렌더됐고,
새로고침하면 초안과 인용은 남고 **「이 문장이 회사의 지식으로 쓰였는가」만 사라졌다** — 판매자가 고객에게 보낼
문장에 대해 가장 알아야 하는 사실이다. `ReviewReplyPrepView`에 두 칸을 더하고 문장은
**`ReviewDraftComposer.basisNoteOf` 하나**가 정해 생성 경로와 읽기 경로가 공유한다(같은 사실의 두 렌더링이
갈라질 자리를 만들지 않는다; `null`은 세 번째 진술 「기록되지 않았다」이고 그때 화면은 아무 말도 하지 않는다).
**다시 계산하지 않고 다시 읽는다** — 재계산은 곧 retrieval 재실행이고 그 두 단계는 매번 새 모델 호출이다.
`RetrievalRuntimeClosureTest`가 **retrieval을 부를 수 있는 파일은 셋**(초안 버전을 쓰는 두 composer + §4 진단),
**두 판매자 읽기 경로는 retriever를 이름으로도 갖지 않음**, 생성 중간 산출물을 아는 파일 셋의
`Repository`/`@Entity`/`save(` **0**을 고정한다. **§2 invalidation 경계는 새 표·새 버전 컬럼·새 프레임워크 0** —
세 키가 전부 **내용**이라 낡은 답이 존재할 수 없다(문서를 고치면 다른 해시, 은퇴시키면 candidate 목록에서 빠지고,
되돌리면 예전 키로 적중; 버전 컬럼을 두 chunk 표와 answer memory에 걸쳐 손으로 맞출 필요가 없다).
**§3 감사 — 한 초안이 같은 문장을 여섯 번 샀다**: 한 grounded 초안은 세 lane을 한 질문의 두 표현으로 검색하는데
`questionVector`는 **캐시가 없고** eligibility는 **memo가 아예 없었다**(intent만 5분 TTL) ⇒ 틀린 것은 없고
**한 번 이상 지불한 것이 전부**였다. `SearchMemo` 하나를 세 문이 공유하고 키는 각각 (intent 모델+질문) ·
(org+embedding 모델+차원+문장) · **(judge 모델+질문+순서대로 이어붙인 문단 텍스트)** — 마지막이 곧
「동일 input + 동일 knowledge snapshot」의 정의다. **5분은 임의 캐시 수명이 아니라 retention**이다(정확성은
키가 주고, 무한 보관해도 답은 옳다; 5분인 이유는 이 답들이 **고객 표현에서 파생된 사본**이고 이 저장소는 그
사본을 하나만 갖는다는 쪽이다), null도 답으로 기억한다(방금 거절한 벤더에게 세 lane이 다시 묻지 않는다),
**제품의 일관성은 memo가 아니라 저장된 행에서 온다**. 질문 벡터는 **DB 표에 넣지 않는다** — 그 표는 판매자
문단의 content-addressed 캐시이고 고객 질문 행을 넣는 것이 v1이 거부한 두 번째 사본이다. **§4 결함 둘**:
(A) `eligibility.filter`가 `semantics != null`만 보고 돌아서 **판매자가 자기 라이브러리에 「반품 조건」을 칠
때**와 **Agent가 이 회사 정책을 읽을 때** 거절 전용 모델이 **판매자 자신의 문서 중 무엇을 볼지** 정하고 있었다
— 측정된 문제(wrong-source 인용)와 **다른 종류의 실패**이고 판매자가 쓴 글을 쓴 사람에게 숨긴다 ⇒ 판정도
`customerWritten`으로 게이트(intent가 처음부터 그랬던 그 게이트, 세 call site를 구조 테스트가 고정);
(B) `InquiryKnowledgeCoverageService`는 docblock에 「no marketplace and no model」이라 적어 두고 두 라우트가
**화면이 쓰는 오버로드**로 흘러가 있었다 — 주문 사실을 `EXACT_ALLOWED`로 읽어 **인증된 GET 하나가 결합된
문의마다 마켓플레이스 요청 1회**(막으려고 존재하는 `STORED_ONLY` 오버로드는 caller 0이 돼 있었다), 그리고 v2
capability가 켜지면 **행마다** 재진술 1 + 판정 최대 2의 **상한 없는 sweep** ⇒ `measured()` 하나로
`STORED_ONLY` + non-customer-written이 되고 보고서가 자기가 측정한 것을 말한다
(`retrieval = STORED_FACTS_NO_PER_QUESTION_MODEL` — 그 숫자를 배포 형상의 숫자로 읽으면 production이 닿는
범위를 **과소평가**한다). **§5 production 사용 조건 감사**: 벤더로 나가는 것은 (7) 판매자 문단 + 고객 질문 +
재진술 · (8) 고객 문장 하나 · (9) 고객 문장 + 순위에 오른 문단(위치로만)이고 payload floor는 세 테스트가
**직렬화 바이트로** 단언한다. **redaction은 lane마다 다르다** — 리뷰는 `redactFullBody`를 지나고 문의는
`toPlainText`뿐이며, 이 패키지가 만든 노출은 아니지만(초안 capability가 이미 그 텍스트를 보낸다) 세 retrieval
capability가 **caller의 redaction을 그대로 물려받는다**는 것은 사실이라 **고치지 않고 product-owner 결정으로
올린다**. 실패는 전부 fail-soft로 이전 동작으로 떨어진다(문단 하나라도 벡터가 없으면 전체가 lexical —
「절반만 읽고 내린 부재는 절반에 대한 부재다」). **비용 귀속: 세 capability는 로그를 한 줄도 남기지 않았다** ⇒
기존 `AgentLlmCallMetrics`로 **메타데이터 전용** 한 줄씩(`knowledge_embedding`은 `kind=PASSAGE|QUESTION`을
**나눠** 보고한다 — 문단은 org당 1회 사서 영구 보관하고 질문은 검색 1회분이라 합친 숫자는 두 질문 어느 쪽의
답도 아니다); 문장·재진술·문단은 로그에 없다. **세 capability는 여전히 판매자 일일 AI 예산 밖**이고 그 결정은
그대로다 — 바뀐 것은 이제 그 결정을 데이터로 할 수 있다는 것뿐. **파일럿 함정 하나를 닫았다**: 세 capability가
자기 allow-list를 직접 읽고 plan·draft·judge는 `AgentCapabilityAccess`에 묻고 있었으므로
`SCOPE=CONNECTED_SELLERS` + `ENABLED=true` + 키 = **아무 조직에도 닿지 않고 기동 검증도 항의하지 않는**
스위치였다 ⇒ 조직 질문을 한 곳에 묻는다(flag·key·명시 목록은 각자의 것, 정책은 **조직 질문만 · 넓히는
방향으로만**, `ALLOW_LIST` 기본은 바이트 동일). 기본값은 전부 **OFF** 그대로. **§6 실측**: 왕복 횟수는 이 코드의
성질이므로 결정론 테스트로 재고 커밋했다(세 lane · 실제 DB · Spring이 조립하는 문 · 벤더만 카운터) — 같은
fixture를 `d956b920` worktree에서 한 번 더 돌려 arm을 비교했다. **cold** 임베딩 6→**4** · 재진술 1 · 판정 2 ·
**다시 열기 0→0**(캐시가 아니라 구조) · **regenerate(상태 동일) 임베딩 4·판정 2 → 0·0·0** ·
**Knowledge 수정 후 임베딩 5·판정 2 → 1·1**, 세 경로 합계 **22 → 9 왕복(−59%)**; regenerate가 0이라는 것은
비용 이야기만이 아니라 **§0의 비결정성이 그 경로에서 사라진다**는 뜻이다. 로컬 실측 지연(모델 왕복 0):
cold 17ms · **다시 열기 8ms** · regenerate 14ms · 수정 후 14ms이고, 같은 실행에서 **다시 열기가
`draftAnswerBasis=GROUNDED`를 돌려주는 것이 라이브로 확인됐다**(retrieval 0 · 모델 0). **벤더 왕복이 포함된
wall-clock은 이 세션에서 재지 못했다** — `.env.local`의 키가 이 환경에 없는 운영자 셸 변수를 참조하므로
라이브 벤더 호출 0이고, 지연의 벤더 성분은 실측 횟수 × holdout이 실측한 왕복 비용의 곱으로만 말할 수 있어
**유도값이지 측정값이 아니다**. 벤치마크 114와 소진된 holdout 44는 **새 parameter 선택에 다시 쓰지 않았다**
(이 패키지는 parameter를 하나도 움직이지 않는다). backend **3,768** · frontend **2,720** · 실패 0 ·
**마켓플레이스 호출 0 · WRITE 0 · 승인 0 · 모델 호출 0 · 마이그레이션 0** ⇒ evidence 행 없음. **계약이 바뀌어
테스트 1건을 다시 썼다**(`KnowledgeQuestionIntentPayloadFloorTest`의 source scan이 주석을 제거한다 — 이웃 두
capability가 memo·로그 규칙 때문에 이 capability의 docblock을 **가리키고**, `AgentDraftBoundaryTest`가 같은
이유로 같은 일을 이미 한다: 「자기 설명 때문에 실패하는 guard는 고쳐지지 않고 삭제된다」; 성질은 **코드**에
대한 것이고 같은 테스트가 `SearchMemo`의 존재를 새로 단언한다). **고치지 않고 보고**: 문의 lane의 벤더 payload
redaction · 세 capability의 예산 귀속 · 경계선 비결정성은 regenerate 경로에서만 사라진다(*다른* 두 질문의 상대
순서는 고정하지 않는다) · `answer_basis` 없는 과거 버전은 백필하지 않았다 · memory lane 판정 memo와 인용 행이
붙은 GROUNDED 초안은 **라이브 관측 없음**(이 세션에 벤더 키가 없다))

**`docs/knowledge_setup_inbox_ux_v1.md`** (Knowledge Setup & Inbox UX v1 — 2026-09-04. Retrieval /
Grounded Drafting / Knowledge model은 **현 상태 그대로 사용**하고, 이번 대상은 알고리즘이 아니라 판매자
경험이다. 목표 문장은 「이미 사용 중인 자료를 연결해 주세요. reviewnary가 먼저 읽고, 모르는 것만
물어보겠습니다」이지 「회사 지식을 처음부터 입력하세요」가 아니다. **구현 전에 실제 브라우저로 감사했고
그 감사가 P0 하나를 라이브로 증명했다** — 정보 필요 카드의 「답변 기준으로 등록」이 **질문을 회사의 답변으로
저장하고 있었다**: candidate가 저장한 텍스트는 ASK인데 화면이 빈 body로 `accept`를 보냈고 `accept`가 그
텍스트로 되돌아갔다(일회용 QA org에서 실측 — 본문이 「'…'에 대해 고객에게 안내하는 공식 기준이 있나요? 이
상품에 저장된 지식에서 찾지 못했습니다.」인 상품 FAQ가 색인되고 인용 가능해졌다; 다음 고객은 reviewnary
자신의 혼란을 답변으로 받았을 것이다). 그 외 감사 결과: 화면이 **자기 제목을 지키지 못했고**(「알고 있는
정보」라는 제목 아래 아는 것을 하나도 말하지 않았다 — Demo Org는 상품 지식 11 · 운영 기준 2 · 과거 답변 23 ·
수집 상품 308), **세 화면이 한 벌의 행을 세 이름으로** 불렀으며(업로드된 배송 정책이 `/knowledge`의 자료와
`/settings/policies`의 「운영 정책 / 답변 기준」에 동시에 있고 서로를 모른다), **자료 목록이 자기가 만들 수
없는 것을 보여주고 있었고**(`scope=PRODUCT`는 API가 오래전부터 받는데 업로드 컨트롤은 `ORG` 하드코딩,
상품 화면엔 업로드 없음), **파일에 대해 사람이 답할 수 있는 여섯 중 둘만** 적었고(종류·시점·올린 사람은
DTO에 이미 있었다), **회사 전체 gap은 링크**였으며(「제주도인데 배송이 며칠 걸리나요?」가 무엇이 없는지
말하고 아무것도 제공하지 않았다), **첫날 화면의 가장 큰 컨트롤이 「과거 답변에서 찾아보기」**였다(답변 0인
회사에서 유일한 결과는 「없습니다」), 그리고 **문의 lane이 gap을 만들고 버리고 있었다**(리뷰 lane은 Grounded
Review Drafting v1부터 확인 필요에 적재했는데 문의는 같은 판정을 그 화면에만 돌려주고 끝 ⇒ 「모르는 것」을
모으는 받은함이 절반만 갖고 있었고, 하필 판매자가 앞에 서 있을 확률이 낮은 절반이었다). **어휘는 한 곳**
(`lib/knowledgeWords.ts`) — 확인 필요 · 상품 지식 · 운영 기준 · 자료 · 과거 고객 응답 다섯이고 내부 의미는
무변경, 이름 없는 토큰은 **자기 자신으로 렌더되지 않고 아예 렌더되지 않는다**; `/settings/policies`도 같은
표를 쓰며 이름은 「운영 기준」 하나다(라우트 무변경). **`GET /api/knowledge/summary`** 여섯 개의 세는 쿼리 —
**앞의 셋은 corpus를 분할한다**(사람이 친 것 `document_name is null` / 파일에서 나온 것)라 판매자가 더하면
라이브러리 크기가 되고, 그것이 숫자 하나 대신 넷을 찍는 유일한 이유다(테스트는 값이 아니라 **분할**을 단언);
**`products`는 그 합이 아니다** — 가르치지 않았는데 채널에서 읽은 것이고, 연결은 했지만 아무것도 쓰지 않은
회사에게 「아무것도 없다」고 말하지 않기 위해 화면에 있다; **`pastAnswers`는 둘 다 아니다**(참고이지 공식이
아니며 화면이 말로 그렇게 말한다). 순서는 **확인 필요 → 알고 있는 정보 → 자료 → 직접 등록**. **받은함은 셋**
— 정보 필요(질문이므로 질문으로 보이고 편집기는 **빈 채로** 열린다) · 확인할 후보(판매자 자신의 문장이므로
**담은 채로** 열린다) · 자료 문제(오늘 결정론으로 감지 가능한 것 하나뿐 — ACTIVE인데 문단 0인 자료는 인용될
수 없다; **conflict engine 0**, 추측 0, 이미 사용 중지한 파일은 문제가 아니다). P0는 화면이 아니라 서비스에서
닫혔다 — `accept`는 `DRAFT_GAP`을 내용 없이 승인하면 **400**이고 `REPEATED_ANSWER`는 fallback을 유지한다
(그 텍스트는 판매자가 이미 쓴 답이다). 그리고 **문의 lane이 gap을 적재한다** — 버전을 쓴 **뒤**, 고객이 실제로
쓴 명사에 대해 **두 lane 모두** `ABSENT`일 때만(운영 기준이 답한 질문은 상품 지식의 공백이 아니고, 판매자가
알아볼 수 없는 ask는 답하지 않을 ask다), 질문 기준 멱등이며 caller로 throw하지 않는다. **구조화 편집기는
하나**(`KnowledgeQuickAdd`)이고 caller가 셋(문의 gap · 리뷰 gap · 받은함) — 적용 범위는 **보여줄 뿐 묻지
않고**(상품에서 열었으면 상품을 다시 고르게 하지 않는다) 출처는 「판매자가 직접 입력」으로 **선언**되며,
**저장은 caller가 소유한다**(같은 폼이 세 가지 write를 섬긴다; 편집과 행의 목적지를 동시에 정하는 컴포넌트는
하나의 진실을 두고 다투는 두 컴포넌트다). **규격 컨트롤은 caller의 write가 실을 수 있을 때만 렌더된다** —
받은함 경로는 `accept`이고 그것은 PRODUCT/ORG보다 잘게 저장하지 않으므로, 판매자의 선택을 조용히 버리는
select는 없는 것보다 나쁘다. **어휘 둘을 명시적으로 교차한다** — `KnowledgeGapView.topic`은 ASKED
(`KnowledgeTopic.SHIPPING`), write는 STORED(`OrgKnowledgeType.SHIPPING_POLICY`)라 그대로 넘기면 **500**이었고
(라이브 실측: 「제주도인데 배송이 며칠 걸리나요?」 → 「저장하지 못했습니다」, wire에 `SHIPPING`) ⇒
`ruleTypeForAskedTopic`이 교차를 적고 이름 없는 토큰에는 null을 준다. **자료 추가는 두 질문뿐**이고 **scope는
컨트롤이 사는 자리가 정한다**; 상품 화면은 `?productId=`로 **자기 것만** 읽는다(상품 300개인 가게가 한 상품의
파일 둘을 보려고 300개를 읽지 않는다) 그리고 org 자료는 제외한다(도마 아래 놓인 배송 정책은 도마에 대한
사실로 읽힌다). 자료 행은 이름 · 종류 · 적용 범위 · 상태 · 시점 · 올린 사람이고 `passages`는 **정직한 결과
하나**(「읽을 내용 없음」)로만 나타난다. **provenance 규칙도 하나** — 취득 경로가 이메일 local part로 작성자를
지어내는 동안 라이브러리는 사용자 이름을 조회하고 있어서 목록이 업로드 자료 옆에 「ks-qa-1788447858」, 두 섹션
아래에 「지식 QA」를 찍었다 ⇒ 라이브러리 규칙으로 통일. **§9 — 저장 확인 문구를 상태 카드 밖으로 꺼냈다**:
카드 안에 있어서 재생성이 돌 수 없는 저장(capability off · 예산 소진 · 벤더 무응답)은 카드가 없고 따라서
**확인도 없었다** — 판매자는 사실을 쓰고 저장을 눌렀는데 화면은 기계가 불가하다는 말만 했다; 저장은 그들이 한
일이고 어느 쪽이든 일어났으므로 이제 밖에서 말하되 **뒤따르는 문장은 실제로 일어난 일에 달렸다**(카드가 없으면
「답변을 다시 만들었습니다」는 아무도 하지 않은 일을 보고하는 것이다). **승인은 조용히 재사용되지 않는다** —
freeze는 이미 있었고 이제 고정됐다(승인된 리뷰의 재생성은 손으로 친 저장과 **같은 게이트**로 409이고 승인된
버전·fingerprint는 움직이지 않는다). **첫 사용은 실제 데이터만** — 아무것도 읽지 않은 회사에는 그 사실과 다음
걸음(「채널에서 가져온 정보가 아직 없습니다. 채널 연결」)을 말하되 **이 화면은 채널 읽기를 갖지 않으므로**
연결 여부를 주장하지 않는다(문장을 위해 읽기를 만들면 홈 화면 옆에 어긋날 두 번째 답이 생긴다); 「과거 답변에서
찾아보기」는 볼 과거 답변이 있을 때만 렌더된다. 새 색·컴포넌트·프레임워크 **0**. **라이브 QA는 일회용 org**
(제품 자신의 signup · 합성 행 · canonical Demo Org는 **읽기 전용**) A~J 전부 통과 — 상품 자료 업로드가
`PRODUCT` scope로 착지하고 검색 `FOUND`, 회사 자료가 `ORG`로 착지하고 `FOUND`, 사용 중지하면
`NO_RELEVANT_EVIDENCE`·복구하면 `FOUND`, 후보 승인이 `SELLER_ENTERED_KNOWLEDGE`로 쓰이고 candidate는
`ACCEPTED`, 규격 지정 지식은 다시 열어도 종류·규격·작성자·시점·인용 수가 그대로. 3폭(1440/1366/1152) 4화면
**AA 위반 0**(틴트 위 합성) · 가로 스크롤 0 · 콘솔 오류 0 · off-host 0. backend **3,773** · frontend **2,729** ·
실패 0. **마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 마이그레이션 0** ⇒ evidence 행 없음. **계약이 바뀌어
테스트를 다시 썼다** — `KnowledgeHome.test`는 새 받은함/편집기 계약으로 재작성됐고(자료 행이 건강한 문서의
문단 수 대신 종류·시점·provenance를 적는다: 판매자의 행동을 바꾸는 것은 **0**인 경우뿐이다), 퀵애드 라벨 두
개가 바뀌었다(「답변 기준 내용」→「고객에게 안내할 내용」, 변형 선택의 「적용 범위」→「규격」 — 「적용 범위」는
이제 상품/회사 전체를 가리킨다). **고치지 않고 보고**: 초안이 없는 work
item이 「초안 준비됨」으로 보이는 것(행이 phase를 읽고 `InquiryProposalWriter`가 proposal을 쓰면 `PROPOSED`로
옮긴다 — 기존 성질이고 큐 semantics는 이 패키지 밖), AI triage가 꺼진 fresh org에서는 리뷰 gap 표면에 라이브
행이 없어 J를 서비스에서 증명한 것, 자료 문제가 한 가지만 감지한다는 것, 그리고 `frontend/CLAUDE.md`가 그
workstream에 금지한 `backend/**` 수정을 product-owner 지시(「구조가 UX를 막으면 작은 backend 변경 가능」,
conflict priority 1)에 따라 했다는 충돌)

**§12-A Knowledge Gap Continuity v1 (2026-09-04, 같은 문서)**: 직전 패키지가 「고치지 않고 보고」로
남긴 잔여 하나 — **문의 화면에서 답한 gap의 확인 필요 카드가 열린 채 남는다** — 를 닫고 Knowledge
workstream을 freeze한다. **문장이 아니라 id로 닫는다**: gap이 적재될 때 확인 필요 행의 id가 gap과 함께
**돌아오고**(`KnowledgeGapView.candidateId` · `ReviewKnowledgeGapView.candidateId`), 그 화면의 quick-add는
자기가 어느 ask에 답하는지 알게 되어 **이미 있던 `accept`**로 저장한다 — 사실을 적재하고 **바로 그 행을**
한 트랜잭션에서 닫으며 어떤 source가 됐는지 기록하는 유일한 write다. 직전 패키지의 반대 이유는 그대로
존중된다: **판매자가 쓴 문장을 물어본 문장과 비교하지 않으므로** 다른 곳에서 쓴 지식은 아무 카드도 닫지
않고, 두 줄 아래의 거의 같은 ask도 열린 채 남는다. `accept`는 `variantId`를 얻었다 — 그것 없이 경유하면
규격이 조용히 버려지고, 값이 조용히 버려지는 컨트롤은 없는 것보다 나쁘다(받은함 편집기도 같은 이유로 이제
규격을 제공한다). **그리고 답한 ask는 곧바로 돌아오지 않는다**: 저장은 초안을 다시 요청하고 재생성은 gap
판정을 다시 돌리며 그 질문은 여전히 라이브러리로 답할 수 없을 수 있다 — 라이브에서 실측된 대로 방금 닫은
행이 같은 숨결에 새로 적재됐고 화면에서 그것은 **닫은 적 없는 것과 구별되지 않는다** ⇒ `noteGap`은 이 org가
그 정확한 ask를 이미 `ACCEPTED`했으면(같은 scope·상품·질문) 아무것도 적재하지 않고 **null**을 돌려준다
(gap은 여전히 참이므로 계속 보이되 뒤에 받은함 행이 없다). `DISMISSED`는 **일부러 제외** — 「아니요」는
「지금은 이것 말고」이고 `dismiss`가 그렇게 적어 두었다. 저장이 실패하면 ask는 열린 채다(`accept`가 한
트랜잭션 — 다른 상품의 규격 거절이 400이고 candidate는 `OPEN`으로 증명). **라이브 한 세션**(일회용 org):
ask 셋 적재(문의 gap + 리뷰의 상품 ask + 리뷰의 배송 ask) → 문의 gap 답변 → **확인 필요 2** → 리뷰의 둘 중
하나 답변 → **확인 필요 1**, 남은 것은 아무도 답하지 않은 배송 ask. 닫힌 두 행은 각자 어떤 source가 됐는지
들고 있고 중복 적재 0. 3폭 × 지식·문의·리뷰 화면 **AA 위반 0** · 가로 스크롤 0 · 콘솔 오류 0 · off-host 0.
backend **3,777** · frontend **2,730** · 실패 0. 마이그레이션 0 · 마켓플레이스 0 · WRITE 0 · 모델 0.

**`docs/inquiry_operations_workspace_v1.md`** (Data Origin Integrity + Inquiry Operations
Workspace v1 — 2026-09-04. 두 단계. Chat · Reviews · Knowledge · Retrieval · Guided execution 무변경,
승인 경계·write path·`DataOrigin` 값·마켓플레이스 semantics **무변경**. **[1] Data Origin** — 세
패키지째 보고된 「synthetic이 `REAL`로 저장된다」를 **producer 기준**으로 닫았다. 감사 결과 정상 경로는
전부 옳았고(커넥터 ingest = `REAL`, `MockDataSeeder` = `DEMO_SEED` 명시, V54/55/56 = 구조적 규칙,
`AnswerMemoryService` = 파생 REAL) 범인은 하나 — `collector/test/upload.test.ts`의 gated integration
test 둘이 **production ingest path로** 리뷰 CSV를 실제 백엔드에 POST하는데 기본 계정이
`demo@sellerops.ai`였다. **ingest path는 결함이 아니다**(건네받은 것을 기록하는 것이 옳고, 업로드에는
「이건 테스트다」가 없다) — 결함은 **판매자 데이터를 가진 org에 fixture를 올린 것**이다. V54가 못 잡은
이유도 구조적이다: 그 규칙은 external id **부재**를 요구하는데 이 행들은 ingest를 지나 external id를
가졌다. 두 번째 테스트는 매 실행 `randomUUID()`를 **의도적으로** 쓰므로(고정 id면 dedup 절반이 공허하게
통과) 멈출 수 없었다 — 실측 5 runs × 3 = **`awfx-` 15** · `SYN-` 3 · `COLLECTOR-SMOKE-` 5 = **23**,
그리고 이 23은 `contracts/review-eval/naver/v2/synthetic-rows.json`이 **이미 행 단위로 열거**하고
있었다(`inFrame: 23`) — 없던 것은 DB 안의 사실뿐. **닫은 방법**: producer는 `disposableOrg()`(제품 자신의
`POST /api/auth/signup` · `@example.invalid` · 매 실행 새 nonce · **환경변수에서 자격을 절대 읽지
않는다** — 다른 목적으로 `SELLEROPS_EMAIL`을 export한 운영자가 자기 상점을 겨냥하게 되면 안 된다),
`ingest-fixture-fence.test.ts`가 그 describe 블록에 판매자 자격 0 · token source 1 · signup+`.invalid`+
nonce를 고정. 분류는 **V93**이 `VERIFY_FIXTURE`(enum이 이미 정의한 값 — 「real in shape, synthetic in
origin」)로, 새 origin 0 · 계약 확장 0 · 삭제 0이고 패턴은 prefix가 아니라 **문서화된 전체 shape**로
매칭해 live DB에서 먼저 검증했다(15/3/5 일치 · **10자리 id 0건** — 실제 NAVER 리뷰글번호는 10자리이므로
export 행을 가리킬 수 없다). **cascade는 원인에만**: V56의 evidence 규칙을 무제한 재실행해 보니 V56이 본
적 없는 행 둘을 쓸어갔다 — **`(미지정 상품)`**(ingest의 placeholder bucket이고 `ProductService`가
**이름으로** 조회하므로 필터 뒤로 숨기면 다음 미귀속 ingest가 두 번째를 만든다)과 아직 리뷰가 없는 카페24
상품코드(판매자가 실제로 파는 상품) ⇒ **fixture 리뷰가 떠받친 행에만** 적용하도록 좁혔고, 전 카탈로그
재실행 여부는 별개 질문으로 남긴다. **regression은 의도가 아니라 구조로 불가능**(모든 강등 절이
`VERIFY_FIXTURE` 존재 AND REAL 증거 부재를 요구) — 실측 REAL 증거 있는데 강등된 상품 **0** · 강등된
10자리 리뷰 **0**. Demo Org: 리뷰 REAL 4,622→**4,599** / FIXTURE 0→**23**, 상품 REAL 300→**294**,
listing 294→289, 문의 무변경. **「308 vs 300」은 subset label도 mismatch도 아니었다** — 8건이 이미
`DEMO_SEED`였고 `data_origin`은 auto-enabled 필터라 `countByOrgId`를 포함한 **모든 평범한 읽기**가 300을
돌려주고 있었다(308은 필터 없는 raw psql count) ⇒ **라벨 변경 0 · 임의 필터 0**, 숫자가 294로 움직인 것은
위의 다른 이유다. **[2] Inquiry Operations Workspace** — before 실측: 읽기 **1회**(inbox feed
`limit=500`)를 한 열에 전부 렌더해 **7,100px · 94행 · 제목 하나**, 업무와 기록이 같은 목록(지난주 답변한
문의가 가장 오래 기다린 미답변 네 줄 아래 같은 무게로), **검색 0**, 상한은 절벽(「최근 500건까지」가 전부
— 문의 3,000건 판매자는 500행을 받고 나머지에 대해 아무 말도 못 듣는다), deep link가 **500행이 로드돼
있어야** 풀리고, `scope` prop의 mixed 모드는 A2 이후 caller 0. **IA는 지금 처리할 일 → 전체 문의**이고
읽기가 둘인 이유는 질문이 둘이며 **엔드포인트가 이미 둘 다 있었기** 때문이다. **큐의 포함 조건은 이 화면이
정하지 않는다** — `InquiryWorkItemPhase.AWAITING_SELLER`(백엔드가 「판매자가 무언가 결정하기를 기다리는
phase」라고 한 번 선언하고 모든 추천 surface가 읽는 그것)이고, 상태어는 `lib/workState.ts`에서 오며
**초안 준비됨은 `hasDraft`**(phase 아님, `11f5274c`에서 닫힌 그 결함). 정렬은 **새 heuristic 0** — 이
제품이 가진 유일한 urgency 기준(대기 시간)을 **두 그룹 안에서** 적용한다(이 org의 카페24 백로그는 10년을
거슬러 올라가 순수 worst-first면 2014년 질문이 한 시간 전 질문을 묻는다; 옛 행은 숨기지도 버리지도 않고
자기 divider 아래). 읽기 실패는 그렇게 말하고(record는 별개 읽기라 무사) **0이면 섹션 자체를 렌더하지
않는다**. 기록은 `GET /api/inquiries/rows`(이미 window·channel·status·order·limit·subject 축 보유) 50행
한 페이지 + `totalCount`이고 필터가 곧 URL이며, 「최근 N건」은 **뒤에 더 있을 때만** 말하고 빈 결과는
「찾는 문의가 없습니다」와 「아직 들어온 문의가 없습니다」를 가른다(table framework·정렬·저장된 뷰·일괄
선택 **0**). **doorway `/inquiries?productId=`**: `productId`를 rows 쿼리에 축으로 더했고 그것은 `q`(상품
**이름**도 매치)와 달리 **binding**이며 **상품 화면이 인쇄하는 그 count와 같은 술어**다 — 실측 인쇄 1 →
열린 `totalCount` 1, 전체 8 → 8. **0은 문이 아니다**(빈 목록을 여는 컨트롤은 지키지 못한 약속). scope는
문장으로 말하고 해제 가능하며 남의 org id는 매치 0. **그리고 렌더해 보고 찾은 결함 하나 — 업무도
scope된다**: record만 좁히면 「미답변 문의 1」을 누른 판매자가 **다른 상품 21건이 첫 섹션인** 페이지에
도착하고 원하던 행은 **1,900px 아래**였다 ⇒ 이미 읽은 행을 필터(두 번째 쿼리 0), 헤딩은 「이 상품의 지금
처리할 일」, **문 뒤 페이지 1,947px → 900px**(세 폭 모두 뷰포트 안). exact 문의는 라우트·`InboxDetail`
무변경(side panel 0 · 두 번째 detail surface 0 · 행별 확장 0)이고 **현재 페이지에 없는 deep link는
`?inquiryId=`로 같은 술어를 통해 1회 색인 조회**(500행을 들고 있던 이유가 사라졌다). Chat continuity:
런타임 링크 무변경이고 `workItemId`가 큐·기록·링크된 행 어디서든 풀리면 실리므로 「이 문의」는 scope할 수
있을 때만 약속하며, standalone chat 복제 **0** · `conversationWriteFence`·승인 경계 무변경 · **write 0**.
**§6 Knowledge gap 상태**: 정확한 gap에 답해 candidate가 ACCEPTED됐는데 재생성된 초안이 아직 그 지식을
쓰지 못하면 화면이 **「답변 기준이 필요합니다」를 다시** 말했다 — 그 사실은 **이미 있었고 삼켜지고
있었다**(`noteGap`은 같은 identity로 이미 ACCEPTED면 null을 주는데 composer가 그것을 「할 말 없음」으로
읽었다) ⇒ `alreadyAnswered`(filed 0인 경로에서만 쿼리 1회)를 읽어 **「답변 기준은 추가하셨습니다 / 다만 이
질문에 그대로 적용할 수 있는 내용은 아직 찾지 못했습니다」**로 가르고 출구는 「답변 기준 더 채우기」로
유지(더 채우는 것이 다음 걸음이고, 멈추는 것은 이미 준 것을 다시 요구하는 일이다); **identity only ·
resemblance 0**이고 reload는 주장하지 않는다(저장된 행은 결정을 적지 받은함 상태를 적지 않는다).
retrieval·threshold·scorer·Knowledge model **무변경**. 브라우저 QA 1440/1366/1152 — `/inquiries`
**7,100 → 5,536px**, doorway **900px**, **AA 위반 3폭 전부 0** · 가로 스크롤 0 · off-host 0, click path는
상품 → 「미답변 문의 1 ›」 → scope된 페이지(두 섹션 다 fold 위) → 행 → 상세로 **클릭 2회 · 스크롤 0**.
**함께 찾아 고친 semantic defect 셋**: 큐 행의 `snippet`이 wire에는 있는데 FE 타입에 없어 고객 문장 대신
(scope된 페이지에서 모든 행이 공유하는) 상품명으로 행 제목을 달 뻔한 것, doorway 착지(위), 그리고 모든
Spring context 기동을 실패시켰을 **JPQL 절 중복**(컴파일되는 종류의 편집이라 기록한다). backend **3,786** ·
collector **9,417** · runtime **835** · frontend **2,708** · 실패 0. **마켓플레이스 호출 0 · WRITE 0 ·
모델 호출 0 · 승인 0 · 마이그레이션 1**(V93) ⇒ evidence 행 없음. **계약이 바뀌어 `CustomerInbox.test`를
다시 썼다**(옛 단언은 client-side 필터 rail · 단일 목록 · mixed 모드에 대한 것이었고, 여전히 참인 것은
전부 단언한다: 행을 고르기 전에는 목록이 화면 · deep link가 그 행을 연다 · work item이 풀릴 때만 응답
워크플로 · 기본 자세에서 전송 0 · 빈 상태와 실패 상태 구분); **안전 테스트 약화 0**. **정직 보고**:
`ReviewReplyTemplates.test`가 전체 실행 1회에서 실패하고 단독·재실행에서 통과했다(이 패키지가 건드리지
않은 파일, 조사하지 않음). **고치지 않고 보고**: `/inquiries` 5,536px은 큐 21건이 전부 실제 업무라 백로그의
길이이지 레이아웃 결함이 아니다 · 기록 50행에 「더 보기」 없음(찾기에는 맞고 훑기에는 아니다) · 상품의
리뷰·문제 근거 figure는 여전히 평범한 타일(`/reviews`에 상품 필터가 없고 issue-evidence에 상품 scope
라우트가 없어 오늘 정직한 문을 만들 수 없다 — 백엔드 읽기가 필요하다) · Orders/Reports 무변경 · 설정 아래
메모리·리포트 · `MockDataSeeder`의 8 상품 44 리뷰는 `DEMO_SEED`로 남는다)

**`docs/product_operations_continuity_v1.md`** (Product Operations Continuity v1 — 2026-09-04.
새 dashboard가 아니라 **상품 화면이 이미 말하고 있는 사실을 실제 doorway로 완성**한다. Chat ·
Grounded Drafting · Knowledge model · Retrieval · Guided execution · 승인 경계는 **freeze**이고 이
패키지가 더한 write는 **0**. 감사가 먼저였고 결론은 하나 — **상품 화면의 숫자 넷 중 둘이 막다른
길**이었다(리뷰 1,761과 문제 근거 80은 누를 수 없고, 반복되는 문제 15건은 **5건만 렌더되며 10건이
더 있다는 말이 없었고** 행은 링크가 아니었다). **§1 리뷰 doorway — 재사용하면 안 되는 이유를
측정으로 찾았다**: 상품 범위 리뷰 read는 `GET /api/reviews/recent?productId=`로 **이미 있었지만**
그것은 `ProductChannels.VISIBLE_CODES`로 좁혀져 있고 타일의 숫자(`countByOrgIdAndProductId`)는
그렇지 않다 ⇒ 실측 `signals.volume.reviews=2` vs `recent total=0`이 **상품 8개**에서 재현됐다
(원인은 이 org의 **GMARKET 리뷰 11건** — REAL이고 seller-visible 채널이 아니다). 그 read에 문을
달았다면 판매자는 **「리뷰 2」를 누르고 빈 목록에 착지**했을 것이므로, 브리프가 허용한 **가장 작은
read capability**를 새로 만들었다: `findByOrgIdAndProductId`를 `countByOrgIdAndProductId` **바로
옆에 같은 술어로** 두고(둘 다 평범한 JPA라 `realDataOnly`를 똑같이 통과하고 **어느 쪽도 그 조건을
손으로 적지 않아** 어긋날 자리가 없다) `GET /api/products/{productId}/reviews`가 그 둘을 함께
돌려준다 — 실측 **1761↔1761 · 2↔2**. 행은 기존 `RecentReviewItemView` 그대로이고 매핑도
`ReviewRows.row()` **하나**로 합쳐 window read와 공유한다(같은 리뷰가 대화와 화면에서 다르게 읽히는
두 번째 사본 금지). 목적지 `/reviews?productId=`는 **계정 스위처가 없다** — 한 상품의 리뷰는 한
계정의 것이 아니고 눌린 숫자도 그렇게 세지지 않았으므로 첫 계정으로 redirect하는 것은 **묻지 않은
더 좁은 질문에 답하는 것**이다(채널은 탭이 아니라 행의 사실이 된다); 범위는 문장으로 말하고 해제
가능하며 **work queue와 archive가 같은 범위를 존중**하고 모든 행은 Review Approval Path v1이 지은
**그 하나의 작업 화면**(`/reviews/reply/{id}`)을 연다(이 컴포넌트의 write **0**). **§1-C 안전
fence가 옳았다** — 처음엔 `OperatorVocItem`에 `productId`를 실어 화면에서 걸렀고
`OperatorAttentionItemsJsonContractTest`가 **직렬화된 바이트에서 `productid`를 찾아** 빨개졌다;
필드를 **되돌리고** 좁히기를 쿼리 안으로 옮겼다(`findCommittedReplyWorkByChannel`에 절 하나, `null`이면
바이트 동일) — **읽은 뒤 거르면** 계정 to-do가 페이지보다 길 때 이 상품의 일이 조용히 사라지고,
**`productName`으로 거르는 것**은 display name이라(정직하게 보일 수 없으면 withheld) 두 상품이 같은
이름을 가질 수 있다. 실측 계정 to-do 3 → 이 상품 **2**, 응답에 `productId` 키 **없음**. **§2 이슈
근거**: 새 issue detection **0** — 근거 화면은 `/memory/{issueId}`로 이미 있었고 상품 화면이 링크하지
않았을 뿐이라 **모든 반복 문제 행이 문**이 되고 나머지는 `Disclosure`로 「문제 10건 더 보기」;
**문제 근거 타일은 사라지고 그 숫자는 섹션 제목으로 옮겼다**(독립된 수가 아니라 아래 이슈들의 근거
합이었고 갈 곳이 없던 유일한 숫자다 — 사실은 사라지지 않고 자리를 옮겼다) ⇒ **타일의 숫자 셋이 전부
문**이고 **0은 여전히 문이 아니다**. **§3 위계는 한 번만 옮겼다** — 채널 리스팅(판매자가 이미 아는
제원)이 신호 바로 아래라 이 페이지에 오는 두 이유가 300px 아래에서 시작했다 ⇒ 반복되는 문제
y **428 → 234**(fold 위), 채널 리스팅 234 → 1,289. 새 카드·색·컴포넌트 0. **§4 Knowledge continuity**:
「**회사 전체 지식에서 보기**」 — 문구가 **회사 전체**인 것이 요점이다(그 화면에 상품 필터가 없으므로
「이 상품의 자료」는 지킬 수 없는 약속이고 **링크는 자기가 가는 곳을 말한다**); **부족한 정보**는 열린
확인 필요 중 이 상품 것만 세어 한 줄로 말하고 편집기는 `/knowledge`에 그대로 둔다(**두 번째 받은함
0**, 좁히는 축은 binding, **읽기 실패는 아무 말도 하지 않는다** — 빈 목록과 못 읽은 목록을 구별할 수
없으므로). **§6 archive completeness**: `GET /api/inquiries/rows`가 `MAX_LIMIT`=50에 **항상 page 0**을
물어 `totalCount`는 정직하고 **도달 불가능**했다(실측 94행 중 **44행**) — 기록이 자기 크기를 말하면서
걸어갈 수 없으면 아카이브가 아니라 검색창이다 ⇒ `page` 파라미터 하나(부재 = 예전과 바이트 동일이라
Agent ROWS lane 포함 모든 caller 무변경)와 「더 보기」(누적, 필터가 바뀌면 page 1로, 더 볼 것이 없으면
렌더 0); 라이브 50 → **94**. `/reviews` 기록은 이미 정직해 무변경. **거대한 table framework 0**.
**§7** `ab0caf74`의 data-origin 구분 무변경이고 새 read는 상품 조회와 리뷰 count/list **두 지점**에서
`realDataOnly`를 물려받는다(합성 상품은 라이브에서 **404** — 남의 org와 같은 메시지라 probe 불가;
행 단위 배제는 REAL 상품 위의 `VERIFY_FIXTURE` 리뷰로 테스트가 고정해 **figure와 door가 함께 1**).
**QA 1440/1366/1152 · 8 route**: **AA 위반 0** · 가로 스크롤 0 · off-host 0, **click path 세 폭 동일
스크롤 0** — 상품 → 이 상품 리뷰 → 정확한 리뷰의 승인 **2클릭**(타일 y=114 → 첫 행 y=191 → 승인
y=594), 상품 → 반복 문제 → 그 이슈의 근거 **1클릭**(y=307). backend **3,792** · frontend **2,725** ·
실패 0. **마켓플레이스 호출 0 · WRITE 0 · 모델 0 · 승인 0 · 마이그레이션 0 · DB 행 변경 0** ⇒
evidence 행 없음. **계약이 바뀌어 테스트 1건을 다시 썼다**(「나머지는 위에서 찾아 주세요」 단언은
참이었고 막다른 길이었다 — 새 단언은 그때의 전부에 **길**을 더한다); **안전 테스트 약화 0**.
**고치지 않고 보고**: GMARKET 리뷰 11건은 `/reviews` 채널 스위처에 탭이 없어 이제 **상품 범위 기록이
보이는 유일한 곳**이다(타일을 좁힐지 채널 집합을 넓힐지는 **product-owner 결정**) · `/memory` 좌측
목록은 여전히 org 전체 · 이슈 근거 인용은 `/inbox/{reviewId}`로만 링크 · `/inquiries` 5,550px ·
상품 지식 카드 두 개 세로 적층 · Orders/Reports/Settings 무변경(`/memory`는 주 내비에 없다) ·
`frontend/CLAUDE.md`가 그 workstream에 금지한 `backend/**` 수정을 product-owner 지시(conflict
priority 1)에 따라 했고 **전부 읽기 · state semantics 변경 0 · write 0**)

**`docs/visual_qa_product_polish_v1.md`** (Visual QA & Product Polish Closure v1 — 2026-09-04.
기능 추가 0 · `frontend/` 전용 · backend 0 · 마이그레이션 0. Knowledge/Retrieval · Grounded Drafting ·
Approval · Guided Browser execution · `workState` semantics · scope semantics는 **freeze**. 코드 수정
전에 실제 Demo Org 13화면을 1440에서 **스크린샷으로** 감사했고(육안 기준 12항목), 고친 것은 페이지가
아니라 **반복되는 visual grammar**다. **참조**: `shadcn` skill의 rules(구성·스타일)와 `ai-elements`
references를 판단 재료로 읽었고 **컴포넌트 import 0 · 새 의존성 0**(레지스트리는 Tailwind v4 + Radix
전제라 이 저장소에서 조용히 깨진다); 구속력 있는 계약은 `docs/reviewnary_design.md`이고 아래 변경은
전부 거기 이미 적힌 규칙의 적용이다. Anthropic `frontend-design` 플러그인은 **이 환경에 설치돼 있지
않다**(가정하지 않고 보고). **공통 문제 다섯**: ① **구분자 없는 사실 나열** — 한 객체에 대한 여러 사실을
한 줄에 적는 같은 모양이 리뷰 기록 헤더·지식 자료 행·문의 메타·답변 작업 헤더·상품 행에 있는데 상품 행만
구분자를 썼다(손으로 쓰면 선택적 사실마다 점을 조건부로 그려야 하기 때문). ② **내용보다 시끄러운 반복
상태어** — `Status variant="word"`가 색 + 점 + semibold **셋**을 지고 있어 「답변 필요」 20개가 옆의 고객
문장과 같은 무게였다. ③ **거의 아무것도 담지 않은 상자** — 리포트의 카드 5개(그 안에 또 카드), 상품
상세의 ~500px 타일 3개, grid 행 높이로 늘어나는 figure. ④ **같은 동작을 두 번** — 이미 링크인 행 옆의
「열기」. ⑤ **한 화면에서 같은 사실을 두 번** — 문의의 page head와 섹션 제목. **바꾼 것 여섯**:
`Facts`(`Children.toArray`가 null을 버리므로 **없는 사실은 자기 구분자를 데리고 사라진다** — 호출자는
사실만 쓰고 구두점은 쓰지 않는다, 측정된 5곳 적용) · `Status` word 변형을 **`font-medium`**으로(색·점·
단어 무변경, 제품의 모든 큐 행에 적용) · `lib/sharedWord.ts`로 규칙 승격(`lib/conversation/`이
재export) · **리포트 `Panel` → `Section`**(읽는 페이지가 wallpaper 대신 outline이 된다; `Panel`은
설정 **폼**에는 남는다 — 거기서 상자는 「당신의 손이 필요하다」는 뜻이다) · 상품 상세 타일이 내용
크기로 · 상품 행의 「열기」와 문의 head의 중복 카운트 제거. **주문과 설정은 감사만 하고 무변경**(가장 잘
조립된 두 화면이다). **측정**: 리포트 1,400px/14면 → **1,072px/10면**, 상품 상세 반복되는 문제
y=428 → **y≈330**, 문의 중복 제목 제거, 리뷰 헤더가 구분자를 얻음. **쓰고, 재고, 되돌린 추상화 하나**:
shared-word 규칙을 `/products`에도 붙였다가 실측이 **혼합 목록**(미답변 2 · 반복 문제 6 · 없음 2)이라
아무것도 접지 않음을 보고 되돌렸다 — 관측된 반복 없는 추상화는 이 패키지가 하지 않기로 한 것이다.
**`/inquiries`에서도 발화하지 않으며 그것이 규칙이 작동하는 모습이다**: 큐는 「답변 필요」 19 +
**「초안 준비됨」 2**라 `onlySharedWord`의 전원 일치 조건이 깨지고, 「거의 전부」로 느슨하게 하면 판매자가
가장 빨리 처리할 수 있는 그 2행을 숨기게 된다 ⇒ 캡션은 침묵하고, 반복 소음은 **구별을 숨기지 않는 쪽**
(상태어의 세 번째 강조 제거)으로 답했다. QA **13 route × 1440/1366/1152 — AA 위반 0 · 가로 스크롤 0 ·
콘솔 오류 0 · off-host 0**, frontend **230 files / 2,730 tests / 실패 0**(전체 실행 3회 연속) · typecheck clean ·
**테스트 재작성 0**(이 패키지가 바꾼 것 중 테스트가 진술하는 계약이 없다). **직전 패키지가 이름을 잡지
못했던 flake를 잡아 근본 원인까지 갈랐다** — `Reviews.test.tsx`에서 **실패하는 테스트 이름이 실행마다
달라졌고**(그것이 단서다), 포착된 메시지는 「spy가 호출되지 않아야 하는데 1회 호출됨」이며 인자가
`getChannelReviewsStrict("acc-nv", …)`인데 **그 테스트의 fixture에는 `acc-nv`가 없다**. 원인: 그 호출은
**이전 테스트**의 것이다 — `ChannelReviews`는 계정을 먼저 읽고 기록은 그 promise의 **연속**에서 읽으므로,
자기 단언만 통과하면 끝나는 테스트가 두 번째 읽기를 큐에 남긴다; RTL `cleanup`은 언마운트하지만 이미
스케줄된 `.then`을 취소하지 못하고 내부 `active` 가드는 setState를 막을 뿐 호출을 막지
않는다 ⇒ 그 호출이 `afterEach`의 clear **이후**, 다음 테스트 안에 착지했고 어느 테스트에 착지하는지는
스케줄링이 정했다(그래서 이름이 옮겨 다녔고 단독 실행에서는 재현되지 않았다). 수정은 **각 테스트
시작에서도 clear**하는 한 줄(hook은 async 경계라 teardown 중 큐된 연속은 그때 이미 실행됐다) — production
코드 0, 다른 테스트 0. **정직 보고**: before 스크린샷은
1440 13장만 진짜이고 1366/1152는 **after 전용**이다(오촬영으로 narrow before가 덮여 조용히 다시 찍지
않고 삭제했다). **가장 약한 화면 셋**: 리뷰(나란한 통계 상자 둘 · 두 갈래 필터 줄 · 「목록」 제목) ·
문의 상세(내용보다 320px 긴 카드 · 같은 행의 두 밀도) · 채널 연결(「리뷰 가져오기」를 뜻하는 섹션 셋과
「작업대」). **디자인 관점의 잔여**: 홈 마지막 행과 composer 사이 ~300px · 「제목 없는 문의」가 행의 가장
큰 글자 · 리뷰 채널 스위처의 약한 활성 신호 · 화면에 남은 내부 단어(인용 단위 · 작업대 · demo) ·
설정의 그룹 경계가 간격뿐. **마켓플레이스 0 · WRITE 0 · 모델 0 · 마이그레이션 0 · DB 변경 0** ⇒
evidence 행 없음)

**`docs/secondary_workspaces_ux_closure_v1.md`** (Secondary Workspaces UX Closure v1 — 2026-09-04.
Chat / Reviews / Inquiries / Products / Knowledge는 **freeze**하고 나머지 화면(`/overview` · `/orders` ·
`/reports` · `/settings` · `/connect` · navigation)이 **어떤 seller job을 하는지**와 **하는 말이 참인지**를
실제 브라우저로 먼저 감사했다. 감사가 찾은 것은 화면 셋이 아니라 **병 하나가 세 군데 있는 것**이었다 —
**같은 명사, 다른 정의**: 「지금 처리할 일」이 홈 **11** · 문의 **21**, 「미답변 문의」가 운영 숫자 **1** ·
리포트/inbox **22**, 그리고 그 화면들은 서로를 링크한다(홈의 「처리할 일 11건 전체 보기」가 「지금 처리할 일
21」이라 적힌 화면을 열었고, 가장 작고 가장 틀린 숫자가 **숫자가 전부인 페이지**에 있었다). **(A) 기간이 없는
숫자에 기간의 질문**: `counted(state, rowsInWindow)`의 docblock은 「최신이 증명됐거나 **우리가 들고 있는 행을
실제로 냈거나**」인데, 미답변 합계가 **창 안에 도착한 행** 수로 그 규칙을 통과한 채널만 더하고 있었다 ⇒
카페24가 7일간 아무것도 받지 않아 **지금 대기 중인 21건이 통째로 빠졌고**, 채널표는 같은 응답이 싣고 있는
그 21에 대해 「—」를 찍었다(캡션은 이미 「'현재 미답변'은 기간과 무관한 지금 수치」라고 적혀 있었다). 규칙은
**완화하지 않고**(증명되지 않은 침묵은 여전히 0이 되지 않는다) 쓰라고 쓰인 피연산자로 물었다 —
`countedInUnansweredNow` 한 칸, 자기 exclusion 수(`exclusions`에 넣으면 「합계에서 빠진 것」이 카페24를 두 번
찍는다)와 자기 freshness. 실측 **1 → 22**, 제외 **2 → 1**(쿠팡은 보유 0 + 미증명이라 여전히 빠지고 여전히
이름이 불린다), 카페24 행은 `문의 —` 옆에 `현재 미답변 21` — 한 행에 참인 판정 둘. **(B) 선언됐지만 아무도
서브하지 않은 집합**: `InquiryWorkItemPhase.AWAITING_SELLER = {OPEN, PROPOSED}`는 「한 번 선언하고 모든 추천
surface가 읽는다」고 적혀 있는데 `GET /api/inquiries`의 기본값은 **`OPEN` 하나**였다 ⇒ 홈은 phase를 말하지
않아 절반을 받아 11을 찍고, 문의는 **두 번 호출해 컴포넌트에서 페이지를 이어붙여** 21을 찍었다(그 client
sum은 phase당 100 상한이라 백로그가 크면 **페이지 부분집합이 자기 총계로** 그려졌을 모양이다). 쿼리가 집합을
받고(`phase in :phases` — 두 번째 사본 대신 절 하나), **phase를 말하지 않으면 `AWAITING_SELLER`**이며 phase를
말하면 바이트 동일. 실측 무-phase **21** · OPEN **11** · PROPOSED **10**, 홈과 문의가 같은 21. 서버 총계가
페이지보다 크면 제목이 그렇게 말한다. **(C) 아무도 읽지 않는 필터 파라미터**: `INQUIRY_NEEDS_REPLY_PATH`가
`?state=NEEDS_REPLY`였는데 기록의 축은 `status`다 ⇒ 리포트의 「답변이 필요한 문의 22건」과 홈 브리핑이
**전체 기록**을 열어 판매자가 94 중 22를 찾아야 했다(상수의 주석은 「NEEDS_REPLY 필터가 그 행들을 보여준다」고
적고 있었다). `?status=UNANSWERED`로 바꿔 세 폭 모두에서 **전체 문의 22**에 착지함을 클릭으로 확인. 홈의
「처리할 일 N건 전체 보기」만 `/inquiries`로 — 그 숫자는 **큐**이고 기록 필터는 센 것과 다른 집합에 착지시킨다.
**(D)** 홈 팔레트의 「미답변 문의 보여줘」가 제목·총계는 KPI에서, 행은 OPEN 큐에서 가져오던 것을 **한 read**로.
**§1 `/overview`는 유지**(홈이 답하지 않는 셋을 소유한다 — 기간·추이·채널별과 「이 숫자에 대하여」; nav에 넣지
않는 것도 그대로다. 틀린 것은 존재가 아니라 헤드라인이었고 그것만 고쳤다. **새 KPI 0 · 가짜 insight 0**).
**§2 `/orders`는 감사 후 무변경** — 브리프가 든 네 job이 **데이터로 답할 수 없다**: 엔드포인트는 집계뿐이고
(`order_daily_summaries`), per-order 행은 실재하지만(`channel_orders` 450 = NAVER 295 · COUPANG 155)
**상품이 없고**(엔티티에 product id·line item 0) **배송이 설계상 없으며**(`NormalizedOrderStatus`가 {PAID,
UNKNOWN}뿐이고 스스로 「관측하지 않은 코드에서 배송·취소 의미를 추측하지 않는다」고 적는다 — 실측 NAVER 295
PAID · 쿠팡 155 UNKNOWN) 고객도 없다 ⇒ 행 목록은 쿠팡 전 행이 「확인되지 않음」이고 상품 칸이 빈 표가 된다.
exact order inspection **doorway는 이미 정직한 자리에 있다**(문의 상세의 운영 정보 카드 · `InquiryOrderFactReader`)
— 다만 채널이 주문을 지목한 문의가 **3,357건 중 1건**이다. 필요한 것은 UI가 아니라 NAVER `lastChangedType`
확대와 주문↔상품 라인 연결이며 **product-owner 결정**. **§3 `/reports`**: 실제로 생성되고(네 read, 실패한
source는 0이 아니라 「확인할 수 없음」), 기간은 **섞여 있었다** — 반복 문제의 변화 판정은 진짜 주간
창(`IssueChangeView`: 최근 surge 창 vs 8주 baseline)이고 세 count는 **지금** 수치인데 페이지가 양쪽에
「이번 기간」을 적용했다 ⇒ 이름은 그대로 두고 count 패널이 **「기간과 무관한 지금 수치입니다」**라고 말한다.
그리고 **상품별로 몰린 이슈 5행이 전부 문이 됐다**(`/products/{id}` — 상품 id 없는 행은 읽히되 문 없음),
**0은 문이 아니다**(「쿠팡 0」 공유 칩이 빈 목록으로 가는 링크였다; **읽지 못한** figure는 링크를 유지한다 —
「셀 수 없었다」는 「없다」가 아니다). 새 weekly capability 0 · Agent `reportOpsNode` 중복 0. **§4 `/settings`
무변경**(매일 하는 일 없음, 어휘 충돌 없음 — 행은 이미 `KNOWLEDGE_NOUN`의 「운영 기준」이다; 「더 보기」의
고객운영 메모리·리포트는 설정이 아니라 **nav 배치 질문**이라 보고만). **§5 `/connect`**: 렌더된 문자열에
bridge/pairing/token/carrier **0**(식별자·주석뿐)이고 리뷰/상품평은 플랫폼 자기 낱말이라 의도된 것. 실측된
결함은 **서로를 지우는 문장 둘** — `오류 · 마지막 수집 1일 전`인데 그 시각은 마지막 **성공**이고 뒤에
`consecutiveFailures: 7`이 있었다 ⇒ 실패 중인 행은 **`마지막 성공 1일 전 · 그 뒤로 수집되지 않았습니다`**
(둘 다 같은 응답의 사실, 정상 행 무변경, A5 상태 어휘 무변경). **벤더 문자열은 올리지 않았다** — 연결자의
`lastError`는 행동 가능하지만 `GW.IP_NOT_ALLOWED`·`HTTP 403`을 싣고 있어 그대로 올리면 §5가 없애라는 개발자
개념을 **더하는** 일이다(필요한 것은 **connector-error → seller-sentence 매핑**이고 코드를 아는 쪽이 소유한다).
**§6 navigation 무변경** — 위계는 이미 있고 `lib/nav.v2.ts`에 이유가 적혀 있다(운영 5 / 연결·설정 3, 그리고
`/overview`·`/reports`·`/memory`·`/agent`는 설명하는 대상에서 도달하는 것이라 일부러 메뉴 밖). **§7 GMARKET
결정 · 코드 변경 0**: 11행은 `REAL`이고 **`external_id`·`acquisition_sync_job_id`가 null** ⇒ 파일 업로드로
들어온 판매자 실데이터다; 글로벌 스위처는 `ProductChannels`(2026-08-17 product-owner 결정)를 강제하므로
**「연결 지원 채널」**을 뜻하고 GMARKET 계정도 없다(리뷰는 `(org, channel)` 스코프라 스위처 자리에 놓을 계정이
없다) ⇒ **총계를 숨기지 않고**(상품 타일 1,761 · 상품 범위 기록에 그 행들이 보인다) 스위처도 넓히지 않는다 —
연결·수집·답변이 불가능한 채널을 화면에 올리는 것이 그 결정이 금지한 바로 그것이고, 조용히 뒤집는 것은 이
패키지의 권한이 아니다. **§8** Orders/Reports에는 page-subset-as-total 없음(모든 figure가 한 응답에서 나오고
자기 scope를 라벨로 단다); 유일한 그 모양이 큐였고 §0-B가 닫았다. **§9** 이름 못 잡은 flake는 재현되지 않았다.
QA 8 route × 1440/1366/1152 — **AA 위반 0 · 가로 스크롤 0 · 콘솔 오류 0 · off-host 0**. backend **3,798** ·
frontend **2,729** · 실패 0 · typecheck clean. 새 guard 넷은 **전부 옛 코드에서 빨개지는 것을 확인한 뒤**
남겼다. **마켓플레이스 호출 0 · WRITE 0 · 모델 0 · 승인 0 · 마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행 없음.
**계약이 바뀌어 테스트 4건과 타입 1개를 다시 썼다**(무-phase 기본값 · per-phase fixture · parity 목적지 ·
href · `InquiryItem.phase`를 `workItemId`와 같은 이유로 nullable); **안전 테스트 약화 0**. **고치지 않고 보고**:
Orders는 UI가 아니라 데이터가 필요하다 · connector-error 매핑 · `/connect`의 겹치는 수집 섹션 셋과 「작업대」 ·
리포트/메모리가 설정 「더 보기」로만 닿는 것 · GMARKET · `/inquiries` 5,550px는 백로그의 길이 ·
`frontend/CLAUDE.md`가 금지한 `backend/**`를 product-owner 지시(priority 1)로 8개 파일 수정했고 **전부 읽기와
술어 · state semantics 변경 0 · write 0**)

**`docs/operational_workspace_ux_v1.md`** (Operational Workspace UX System v1 — 2026-09-04.
페이지별 cosmetic redesign이 아니라 **정보 구조 · 상태 표현 · 행동 문법**을 한 제품으로 정리한다. Calm
Operational Assistant 시각 방향 · 새 design system · 새 색 · 새 taxonomy · retrieval · approval **전부
무변경**. **감사가 먼저이고 숫자는 전부 라이브 실측이다**(실제 Demo Org, 1440×900@2×): `/reviews`
**6,550px** · 컨트롤 65개 · 행 하나에 상태어 **넷**(승인 대기 · 상태 미상 · 대응 필요 · 기타) · 고객
문장 **두 번** · 행마다 답변 준비 패널 전체(~570px)라 리뷰 기록이 4,000px 아래에서 시작했고, `/inquiries`
**7,068px** · 제목 **하나**(`h1:문의`)로 업무 큐와 기록 아카이브가 같은 목록이며, `/products`는 카탈로그
**308개** 위에 **「상품 10개」**를 찍고 그 열 중 여섯이 「문의·리뷰 아직 없음」인데 **리뷰 1,761개짜리
상품은 페이지에 없었다**(더 있다는 문장도 렌더된 적 없다 — `rows.length >= 20`을 head 10에 대고 물었다),
설정은 직전 패키지가 **운영 기준**으로 바꾼 화면을 여전히 「운영 정책 / 답변 기준」으로 불렀다.
**본체는 상태 진실이다** — 문의 목록의 「초안 준비됨」은 work item **phase**(`PROPOSED`)에서 읽고 있었고,
그 phase는 **proposal**이 기록될 때 쓰이며 `InquiryProposal`은 자기 계약에 **답변 본문을 저장하지 않는다**고
적어 두었다: 실측 **PROPOSED 10건 중 초안 보유 2건**, 즉 **여덟 행이 아무도 쓰지 않은 문장을 읽으러 가라고
말하고 있었다**. 같은 전제가 대화 lane에도 주석으로 있었다(「A PROPOSED item has an AI draft by the phase's
own meaning」 — 그런 뜻은 없다) ⇒ 양쪽이 이제 **사실을 읽는다**(`InquiryQueueItem.hasDraft`, 페이지당
`select distinct` 1회 · `rowState(item, hasDraft)` · `classify(row, detail)`), **읽지 못했으면 어떤 행도
초안을 주장하지 않는다**(읽지 않은 사실은 참인 사실이 아니다). 초안 없는 `PROPOSED`는 늘 그랬던 것 —
답변 필요 — 이고 라이브에서 10 → **2**. **문법은 하나**: 지금 처리할 일 → 전체 기록, 홈/대화는 그대로
control plane, workspace는 정밀 검사·일괄 처리·검색·복구용이며 **모든 화면에 chat을 복제하지 않는다**;
**큐 행은 방이 아니라 문**이고 **page는 total이 아니다**. 어휘는 `lib/workState.ts` **한 표**(답변 필요 ·
확인 필요 · 초안 준비됨 · 초안 필요 · 승인 대기 · 승인됨 · 답변함)이고 **각 단어 옆에 그것을 증명하는
필드가 적혀 있다**; `good` 톤은 하나도 없고(승인됨은 **완료가 아니다** — 다음 걸음은 판매자센터다),
**답변 필요와 초안 필요는 일부러 합치지 않았다**(전자는 고객에 대한 사실, 후자는 판매자 자기 작업에 대한
사실 — 합치면 받은함과 작업 목록의 차이가 사라진다). 지식 명사 다섯도 `KNOWLEDGE_NOUN`으로 같은 이유로
고정. **Reviews**: `ReplyWorkRow`(기존 `WorkItem` 프리미티브)가 상태어 **하나** · ★ · 상품 · 고객 문장으로
줄고 행 자체가 **`/reviews/reply/{reviewId}`**(Review Approval Path v1이 지은 화면, 승인 y=**594**)를
연다 ⇒ **6,550 → 4,022px(−39%)** · 상자 11→7 · pill 3→0 · 행당 상태어 4→**1** · 고객 문장 2→1 ·
**큐 렌더 읽기 = 행마다 1회 → 전체 1회**; 승인 경계·fingerprint·draft version 무변경이고 이 패키지가
리뷰 화면에 더한 write는 **0**. 소비자가 사라진 `VocItemCard`는 초록 테스트를 단 죽은 코드로 남기지 않고
테스트와 함께 삭제했다(`ReplyWorkControls` — 유일한 답변 클러스터 — 는 그대로). **Inquiries**: 목록이
선택 rail이기도 하므로 한 열을 유지하되 **경계를 보이게** 했다 — `답변한 문의 {n}건` divider(기존 「1년
넘게 지난…」과 같은 관용구, heading 아님)와 dim 처리, 라이브 22 위 / 72 아래. **Products**: 화면이
**resolver**에게 worklist를 묻고 있었다(빈 질의 head는 이름순·상한 — resolver로서는 옳다) ⇒
`ProductCatalogService` · `GET /api/products/catalog`가 **org의 진짜 total**과 **판매자가 빚진 것 → 고객이
불평한 것** 순서(미답변 문의 → 부정 리뷰 → 리뷰 수 → 이름; `lib/productRows.ts`가 이미 쓰던 그 규칙을
카탈로그 전체가 볼 수 있는 층으로 옮긴 것)를 돌려준다 — 읽기 **3회**(묶음 count 2 + 카탈로그), 행당 읽기
0, 페이지 상한 20. **합성 규칙은 둘로 갈린다**: 어느 상품이 나열되는가는 `realDataOnly` 필터를 따라
`countByOrgId`와 같은 답을 주고, 무엇이 순위를 정하는가는 **항상 REAL만**이다(만들어 낸 불만으로 판매자
카탈로그를 줄 세우는 것이 데모 화면이 지어낸 상품을 「최악의 상품」이라 부른 그 결함이다). 결과:
「상품 10개」 → **「전체 300개」**, 첫 행 「코드 15223228019 · 리뷰 7」 → **「선바로 일체형 전선몰딩 ·
미답변 1 · 문의 8 · 리뷰 1,761」**, `search`는 무변경. **Chat ↔ Workspace continuity 라이브 확인**: 대화
리뷰 artifact → `/reviews/reply/{id}?from=chat`(계정 해석 · 승인 존재 · 「대화로 돌아가기」), 대화 문의
artifact → `/inquiries/{inquiryId}`(그 행이 `aria-current`, 다른 객체 오염 0), 그리고 **큐 행이 대화
artifact와 같은 URL을 연다** — 들어가는 길 둘, 화면 하나. 어떤 workspace에도 standalone chat을 붙이지
않았고 `conversationWriteFence`·승인 경계 무변경. **Orders/Reports는 감사만 하고 무변경**(없는 workflow를
만들지 않았다), **Settings는 이름 하나**(Knowledge의 일상 「확인 필요」를 설정으로 밀지 않았다). 브라우저
QA 1440/1366/1152 — **AA 텍스트 노드 위반 3폭 전부 0** · 가로 스크롤 0 · off-host 0 · 승인 버튼 y=594가
세 폭 동일. backend **3,781** · runtime **835** · frontend **2,704**/229 files · 실패 0.
**마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 마이그레이션 0 · DB 행 변경 0** ⇒ evidence 행 없음.
**계약이 바뀌어 테스트 4건을 다시 썼다**(전부 같은 방향 — 화면이 추론한 사실 대신 들은 사실을 말한다;
안전 테스트 약화 **0**). **저장소 규칙 충돌 보고**: `frontend/CLAUDE.md`가 그 workstream에 금지한
`backend/**` 수정을 product-owner 지시(conflict priority 1)에 따라 여섯 파일에 했고 **전부 읽기**이며
**state semantics 변경 0 · 가짜 상태 0**이다. **고치지 않고 보고**: `/inquiries` 7,100px(제대로 쪼개면
목록 열이 선택 rail이기를 그만두므로 IA 결정), 합성 행의 `data_origin='REAL'`(세 패키지째 보고), 상품
상세의 「미답변 문의」가 문이 아닌 것(`/inquiries`에 상품 필터가 없어 오늘 정직하게 링크할 수 없다 —
product-scoped inquiry read가 필요), total 300 vs 표 308(필터가 설계대로 동작하는 것), 설정 아래의
고객운영 메모리·리포트(nav에 없어 설정이 유일한 메뉴 집), 숫자 코드가 이름인 상품 행)

**`docs/opportunity_engine_v1.md`** (Auth Entry Regression Closure + Opportunity Engine v1 — 2026-09-04.
**로그인 회귀는 코드가 아니라 배포 자세였다**: `Login.tsx`는 여전히 `SocialSignInButtons`를 렌더하고 그 컴포넌트는
`GET /api/auth/social/providers`가 `true`인 provider만 그린다 — Spring은 dotenv를 읽지 않으므로 `.env.local`을 소스하지
않고 `bootRun`한 backend에서는 둘 다 false라 버튼이 0이다(`git log -S`로 제거 커밋 0 확인, 네 변수는 이름·값 모두
존재하되 값은 읽지 않았다). `tools/dev/local-stack.sh up`으로 띄우면 `{"google":true,"naver":true}`이고 링크는
`/oauth2/authorization/{provider}` → 302. auth 변경 **0**. **Opportunity Engine v1**: Issue(「접착 불만이 반복됩니다」)와
Opportunity(「'접착' 안내를 FAQ에 보완하는 것을 검토하세요」)는 다른 객체다 — Opportunity는 **저장하지 않고 매 읽기마다
도출**하며 정체성은 `(issueId, kind)`, 저장되는 것은 판매자의 **결정과 초안**뿐(V94 `improvement_opportunity`, 행 없음 =
OPEN, proactive_case의 annotation 규칙). 생성 기준은 **결정론 한 파일**(`OpportunityRules`): 게이트는 추출기 자신의
`NEW_MIN_EVIDENCE(3)` + dismissed/RESOLVED 제외(그래서 「evidence 없는 제안 0」은 구조), 두 lane — GUIDANCE(고객에게
말할 수 있는 aspect만: 배송→운영 기준, 접착·설치·설명→사용법, 표면·색상·크기→설명; 포장·가격은 없음; 상품 없으면
PRODUCT lane 미생성)와 PRODUCT(파손·결함·균열·탈락·부족·오염 → 제품 개선 검토) — 이슈당 최대 하나씩. kind는 판매자
지식 상태가 가른다: 지식이 aspect를 언급하지 않으면 **FAQ 보완**, 언급하면 **상세·안내 보완**. 그 「언급」은 retrieval이
아니라 **mention check**(`KnowledgeMentionCheck` — 추출기의 같은 aspect 낱말로 active 지식 substring 검사, 랭킹·임계·
벤더 0; 이슈마다 retriever를 돌리면 읽기 한 번에 임베딩 19회다). 라이브가 규칙 하나를 고쳤다: `배송×파손` 15건은
「배송 기준」이 아니라 **교환·반품·환불 기준**이다. 판매자가 보는 네 가지(무엇이 반복 · 왜 · 근거 `/memory/{issueId}` ·
다음 행동)의 모든 문장은 `OpportunityDraftComposer` 한 파일이고 **원인·효과 0**. 준비된 행동은 **초안까지 · 모델 0**:
accept가 결정론 scaffold(FAQ는 질문 + 빈 답변 칸, 상세·운영 기준은 판매자 문장 발췌, 검토 메모는 숫자와 항목)를 만들고
판매자가 고치며, 목적지는 기존 seam — FAQ·운영 기준은 그 `KnowledgeQuickAdd`로 **판매자가 저장**, 나머지는 복사;
`OpportunitySafetyFenceTest`가 채널·승인·모델·지식 writer 0을 이름으로 고정. 붙은 곳: `/memory/{id}`(결정·초안이 있는
유일한 곳) · `/products/{id}`(「개선 기회 N건」 행 — 신호 카드와 **같은** product-scoped 이슈 목록에서 시작, 0·실패는 침묵) ·
Chat(NeedKind `IMPROVEMENT_OPPORTUNITY` · 프롬프트 **v15** · READ tool `list_improvement_opportunities` · artifact
`OPPORTUNITY_LIST`; 런타임은 도출 0, 대화는 결정 0; 카드 행으로 그려진 finding은 산문에서 반복하지 않는다). 라이브 Demo Org:
이슈 19 → Opportunity **7** · 근거 없는 행 0 · accept/dismiss/restore가 reload를 넘기고 종료 시 결정 행 **0** · chat 카드 =
API 집합 · 3폭 AA 0. **고치지 않고 보고**: Opportunity는 이슈만큼만 참이다 — 「배송 파손」 근거 인용이 「파손없이 잘
도착했네요」였다(규칙 추출기의 부정문 오탐; 어휘는 측정 라벨 없이 손대지 않는다 ⇒ product-owner 결정). 마켓플레이스 0 ·
WRITE 0 · 승인 0 · 마이그레이션 1 · 플래너 호출 2(QA) ⇒ evidence 행 없음.)

**`docs/review_decision_workspace_v1.md`** (Review Decision Workspace v1 — 2026-09-12. 새 기능이 아니라
**배치와 도달성**: 판매자가 리뷰 하나를 열었을 때 「왜 봐야 하는지 → 무엇을 판단할지 → 무엇을 할지」를 한 화면에서
끝낸다. **마이그레이션 0 · 새 테이블 0 · 새 enum 0 · 새 classifier 0 · 새 LLM capability 0 · 마켓플레이스 0 ·
WRITE 0 · 모델 0.** 감사 결과 **여덟 정보 중 일곱이 이미 있었고 다섯이 이 화면에 없었다** — 고객 문장과 tier·이유는
「이 리뷰의 자동 분류」 아래 **접혀 있었고**(승인 화면에는 옳고 판단 화면에는 틀린 접기), T-07 판매자 판단은 **다른
화면에만** 있었으며, 반복 문제는 **제목 한 줄뿐 예시 0**, 회사 지식은 **언급 0**, 그리고 결정 trail **다섯 개**가
몇 달째 쓰이면서 **읽는 코드가 0**이었다. 그래서 만든 것은 새 진실이 아니라 **읽는 쪽** — GET 둘
(`decision-context` · `decision-log`)이고 이 컨트롤러에 **write는 없다**(결정의 두 번째 문은 언젠가 첫 문과 다른 말을
한다). context는 **모델 0**이다: 열 때마다 retrieval을 돌리면 아직 아무도 요구하지 않은 문단을 위해 **여는 값이
돈이 된다** ⇒ 이 블록은 「라이브러리에 무엇이 있는가」만 답하고 「초안이 무엇 위에 섰는가」는 초안 자신의 인용이 답한다.
**유사 리뷰는 추출기가 이미 같은 문제의 근거로 묶은 리뷰뿐** — 두 번째 유사도 메커니즘은 아무도 측정하지 않은
classifier가 판매자의 읽는 순서를 정하는 일이다. §5-C가 남긴 「Decision Workspace 때 다시 정한다」를 여기서 정했다:
조치 선택 = **기존 `TriageDisposition` 그대로**(새 enum 0·낱말 0, 채널을 아는 것은 버튼 아래 한 줄뿐), 완료 기록은
`ACTION_STARTED`/`ACTION_COMPLETED` **둘만**이고 **`ACTION_NOT_NEEDED` 제외**(그 진술은 `NO_ACTION`이 이미 결정
spine에 쓴다 — 한 press가 두 spine에 두 강도로 들어가는 것이 §5-C가 금지한 모양), 조치 기록의 **pilot 게이트 해제**
(T-07이 correction에 대해 한 논증). **결함 하나를 찾아 고쳤다 — 판단과 답변은 다른 능력인데 주소가 하나였다**:
`decide()`는 채널 capability를 보지 않는데 리뷰 화면이 얻을 수 있는 유일한 ref는 **답변 flow가 있는 채널에만**
발급돼, **쿠팡 상품평에는 판단 컨트롤이 존재할 수 없었다** ⇒ `decisionRef`를 워크스페이스가 열 수 있는 모든 리뷰에
서버가 mint해 돌려준다(클라이언트는 여전히 round-trip만; 답변 lane의 ref가 같은 결정을 가리키므로 context 읽기가
실패해도 **맥락만 잃고 판단 능력은 잃지 않는다**). 사본을 늘리지 않으려고 다섯을 끌어올리고
`ReplyWorkControls`는 **지웠다**(`SellerCorrectionControls` · `TriageTierChip`/`AiMarkChip` · `ChannelAnsweredState` ·
`reviewWord` · `IssueEvidenceQuote` — 마지막은 **마스킹 규칙**의 두 번째 사본이 바뀔 때 잊히는 쪽이기 때문). **그리고
이 화면이 review 처리의 canonical mutation surface가 된다**(product-owner decision): 기록 화면의 상세는 서 있는 것을
**읽고** 문 하나를 낼 뿐 아무것도 쓰지 않으며, 그 삭제로 `ACTION_NOT_NEEDED` vs `NO_ACTION` 이중 경로가 닫힌다. 승인 경계·append-only
버전·fingerprint·복사 후 판매자 직접 등록 handoff **무변경**. backend **3,942** · frontend **239 files / 2,822** · 실패 0 · axe 위반 0 ·
**실제 Demo Org 로컬 브라우저 QA 통과**(커넥터 전부 OFF · 1440/1366/1152 · 콘솔 오류 0 · off-host 0 · 채널 호출 0; 쿠팡 상품평에서 판단 컨트롤이 서는 것을 라이브로 확인). **계약이 바뀌어 테스트 1건을 다시 썼다**(14 → 26 단언, 안전 테스트 약화 0). **고치지 않고 보고**:
`ACTION_NOT_NEEDED` enum 값은 남기고 그 컨트롤만 지웠다(production caller 0) · tier 낱말이 한 화면에 두 번(대조가 읽히려면 필요) ·
`decision-context`는 bounded read 약 10회 · 반복 신호는 추출기만큼만 참(부정문 오탐 잔존) · `ACTION_NOT_NEEDED`를 쓰는
pilot 컨트롤은 기록 화면에 잔존 · `frontend/CLAUDE.md`가 금지한 `backend/**` 수정을
product-owner 지시(priority 1)로 했고 **전부 읽기 전용**)

**`docs/pilot_readiness_v2.md`** (Pilot Readiness v2 — 2026-09-13. 판정 **`READY_PENDING_HOST`**.
v1이 남긴 blocker 「고정 공인 IPv4 + 공개 HTTPS callback」은 **하나가 아니라 둘이었고 서로 다른 방향의
요구**다 — HTTPS 호스트는 **인바운드**(Cafe24가 도달할 redirect URI), 고정 IPv4는 **아웃바운드**(NAVER가
등록을 요구하는 호출 IP). 코드가 그렇게 말한다(`PilotConfigValidator`의 IP 조건은 `naverEnabled &&`,
`deploy.sh`도 같다) ⇒ **Cafe24-only 파일럿에는 고정 IP가 필요 없고**, 그것을 논증이 아니라 테스트로
증명했다(`cafe24OnlyPilotStartsWithoutAnyAdvertisedEgressIp` 문제 0개 · `addingNaverToThatSame…` 거부).
PRIMARY 온보딩이 Cafe24라는 기존 결정과 맞고, **EIP는 파일럿 시작의 전제가 아니라 NAVER 추가의 전제**다.
설정 표면 결함 **넷**을 닫았다(제품 의미 변경 0): `AGENT_{PLAN,DRAFT,JUDGE,CONVERSE,REPORT}_ORG_IDS=*`가
거부되지 않던 것(세 retrieval capability에는 이미 거부가 있었고 **그 비대칭은 결정이 아니었다**) ·
`ACCESS_SCOPE=ALL_ORGS`(application.yml 스스로 공유 백엔드에서 쓰지 말라고 적어 둔 자세) ·
**`SELLEROPS_VAULT_KEY_RING`이 컨테이너 env에 도달하지 못해 배포된 호스트에서 키 교체가 불가능**했던 것 ·
**`SELLEROPS_MAIL_MODE=dev-outbox`가 비밀번호 재설정 링크를 포함한 메일 전문을 INFO 로그에 쓰는데 막는 것이
없던** 것(+ `AGENT_REPORT_*`가 검증 대상인데 템플릿에 없던 것). **org isolation 실측**: 새 org의 토큰으로
6개 경로를 찔러 데이터 0 — 다만 **두 경로가 404가 아니라 500**이었다(`IllegalArgumentException`을 매핑하는
핸들러가 없다). 샌 것은 없고 대가는 다른 데 있었다 — **자기 것이 아닌 페이지를 연 판매자가 크래시를 보고,
ERROR 수를 지켜보는 운영자가 일어나지 않은 장애를 본다**; 삭제된 이슈로 가는 북마크도 같다 ⇒
`ApiException.notFound`로 고쳤고 이미 「absent rather than forbidden」이라 이름 붙어 있던 테스트가 이제
**상태 코드까지** 단언한다(실측 500 → 404, 자기 org 200, ERROR 0). demo 전제는 **이미 안전한 기본값**
(seed/demo-content/demo-entry/mock/mock-fallback 전부 false; 기본 ON은 채널 카탈로그뿐이고 그것은 참조
데이터다). **Core loop E2E 실행** — acquisition은 제외(커넥터 OFF · 라이브는 단일 사용 승인이 필요하고
취득은 자기 증거를 갖는다): Home 13 → Decision Workspace → 판단 기록 → 반복 신호 → Repeated Issue(분모 3행 ·
별점 분포 · 기록) → 이슈↔리뷰 왕복 → **Home 12**. **7번이 요점이다 — 워크스페이스의 판단이 Home의 숫자를
움직였고 고리가 닫힌다**(콘솔 0 · off-host 0). Instrumentation은 `docs/pilot_usage_loop_v1.md` §6으로
확장했고 **네 가설은 새 계측 0**(durable audit 표에서 읽는다; `review_issue_state_events`는 `actor='OPERATOR'`
필수 — 그 표의 대부분은 추출기의 `SYSTEM/CREATED`라 그것을 세면 파이프라인이 돈 횟수를 센다),
**다섯 번째(재방문)만 답이 없다** — 서버에 로그인/세션 기록이 없고 analytics는 env 없으면 `track`이 no-op이라
**오늘 측정되지 않는다**; 외부 sink를 켜는 것과 서버에 신호를 만드는 것 **둘 다 프라이버시 결정이라 아무것도
만들지 않았다**. backend **4,066** · frontend **242 files / 2,890** · 실패 0. **고치지 않고 보고**:
마이그레이션 롤백 경로 0 · undo 스크립트 0 · **CI가 마이그레이션을 검증하지 않는다**(H2 + Flyway disabled) ·
`baseline-on-migrate:true`가 손으로 만든 DB에서 마이그레이션을 **조용히 건너뛸 수 있다** · validator가 Cafe24
redirect 호스트가 `PILOT_PUBLIC_HOST`와 같은지는 보지 않는다 · **mock connector가 여전히 설정되지 않은 모든
채널의 기본 resolution 대상**이고 그 행들은 `DEMO_SEED`가 아니라 `REAL`로 들어와 되돌릴 수 없다 ·
DB에 일반적인 화면 열람 계측이 없다. **PRODUCT_DECISION_NEEDED**: 마이그레이션 정책(forward-only를 명시할
것인가 / CI 검증) · 재방문 측정 방법 · 파일럿 호스트 프로비저닝 · Demo Org QA 잔여 상태) · **`docs/operations_home_v1.md`** (Operations Home v1 — 2026-09-13. 로그인하면 「지금 확인할 것」이 화면에 있다;
**chat-first는 유지하되 chat-only가 아니다** — 네 영역이 대화 **위에** 서고 대화는 그대로 아래에 있다.
**마이그레이션 0 · 새 테이블 0 · 새 enum 0 · 모델 호출 0 · 마켓플레이스 0 · WRITE 0 · DB 행 변경 0.** 감사 결과
네 영역 중 **셋이 이미 org-wide**였다(`/api/review-issues` · `ChannelCoverageService` · work item phase + 초안 존재);
없던 하나는 **확인 필요 리뷰**로, 모든 tier read가 채널별이라 프론트가 계정마다 하나씩 **N번 읽어 흉내내고**
있었다 ⇒ org-wide 질의 셋(`countByOrgGroupedByFinalTierRank`/`…TierRank` 쌍 · `findUndecidedByOrgAndTier` ·
`countUndecidedByOrgAndTier`, 전부 `TRIAGE_TIER_RANK`·`NOT_DISMISSED_PREDICATE` 재사용)과 그것들을 모으는
`GET /api/operations/home` **하나**. **읽기가 하나인 이유**: Home은 채널의 기록도 계정의 큐도 아닌 유일한
화면이고, 클라이언트에서 합치면 채널 셋을 가진 판매자가 **더할 수 없는 숫자 셋**을 본다. **컨트롤러에 write 0**
(결정으로 가는 두 번째 문은 언젠가 첫 문과 다른 말을 한다). **urgency를 발명하지 않는 장치 셋**: ① **어떤 칸도 두
숫자의 합이 아니다** — 기존 대시보드의 `urgentCount = 미답변 + 부정 리뷰`(실측 24+19=**43**)는 서로 다른 두
모집단을 더해 아무도 세지 않은 셋째를 만들고 urgent라 부르며, 43으로 행동하는 판매자는 **어떤 행 집합도 설명하지
않는 숫자**로 행동한다 ⇒ 이 view엔 그런 칸이 없고 `OperationsHomeContractTest`가 이름으로 막는다(단, 정확히 한
모집단을 세고 이름에 그것이 적힌 `needsAttentionTotal`·`watchTotal`은 **보호 대상이지 위반이 아니다**);
② **「분류된 수」와 「지금 결정 필요한 수」가 다른 칸** — tier는 리뷰의 read-time 함수라 결정을 기록해도 바뀌지
않으므로 tier만 세면 끝낸 일을 계속 요구하고 미결정만 세면 tier의 크기를 잃는다(실측 **확인 필요 15 중 미결정
13**), `WATCH`는 **관찰**이라 자기 칸으로 보고되고 아무것에도 더해지지 않는다(실측 **122**);
③ **관찰 중 문제를 일처럼 그리지 않는다**(실측 **관찰 중 16 · 누군가의 차례 1** — 「반복 문제 17건」이 할 일 목록
옆에 서면 관측 열여섯이 일 열여섯으로 보인다). 반복 문제 행은 workspace의 맥락을 그대로 들고 오고(severity ·
trend · 근거 수 · **상품별 분모** · 별점 분포) 분모는 여기서도 **쌍이지 비율이 아니다**; 행마다 자기 context read를
사므로 **가장 세게 상한**(3). 「준비된 작업」은 **어떤 기록이 존재한다고 말하는 것만** 담는다 — **phase는 초안이
아니다**(`InquiryProposal`은 답변 본문을 저장하지 않는다; 실측 PROPOSED 10 대 초안 2), 그리고 비었을 때 **자라지
않는다**. 라이브가 결함 하나를 드러냈다 — 한 문자열이던 행 제목이 **「승인된 리뷰 답변」 네 줄**로 나와 열어 보지
않고는 고를 수 없었다 ⇒ `label`(일의 종류)과 `detail`(상품·리뷰 날짜, 문의는 그 제목)을 나눴다. 수집 상태는
`ChannelCoverageRow`를 **통째 재사용**하고 채널당 한 줄로 접되 **평균 내지 않는다**(가장 나쁜 상태가 말한다 —
세 상태의 평균은 아무도 계산하지 않은 넷째다), **provider 기술명 0**(테스트가 렌더된 문자열로 확인). **읽기 실패 ⇒
아무것도 그리지 않는다**(질의가 죽어서 「확인 필요 0건」을 그리는 것은 **오류를 근거로 아침이 한가하다고 말하는
일**이고, 대화는 별개 읽기라 그대로 돈다). backend **4,054** · frontend **241 files / 2,883** · 실패 0 ·
**실제 Demo Org 브라우저 QA 통과**(비율 0 · 합산 숫자 0 · 기술명 0 · composer 유지 · **1440×900에서 네 영역 전부
fold 위** · axe 0 · 콘솔 0 · off-host 0 · 채널 0 · 모델 0 · DB 행 변경 0). **고치지 않고 보고**: 레거시
`/api/dashboard/summary`의 `urgentCount`는 그대로 43을 낸다(이 패키지는 쓰지 않는다) · **사이드바의 「연결 문제
3건」은 stale**(열린 `REPEATED_FAILURE` 셋은 08-18~23의 것이고 세 채널 모두 지금 `CONNECTED`·연속 실패 0이며 그
**뒤에** 성공 수집했다 ⇒ Home의 수집 영역은 **연결 상태와 마지막 성공 수집에서 읽고 알림 행에서 읽지 않는다** —
회복된 실패를 현재 문제로 그리는 것이 금지된 urgency 발명이다) · 1366/1152에서 아래 두 영역은 스크롤(720px에 네
영역과 docked composer를 함께 넣는 것은 내용을 깎지 않고는 안 된다 ⇒ 일하는 두 영역을 위에 뒀다) ·
`observing` 16은 근거 있는 이슈만 센다(전체 20 중 3은 근거 0). **PRODUCT_DECISION_NEEDED**: stale 알림의 수명 ·
`urgentCount` 은퇴 여부) · **`docs/repeated_issue_v1.md`** (Repeated Issue v1 — 2026-09-13. 개별 리뷰가 아니라 **반복되는 문제 하나**를
판단하고 추적한다. **마이그레이션 0 · 새 테이블 0 · 새 enum 0 · 새 classifier 0 · 새 LLM capability 0 ·
마켓플레이스 0 · WRITE 0 · 모델 0 · DB 행 변경 0.** 감사 결과 최소 UX 열 항목 중 **여섯이 이미 있었고 이미
렌더되고 있었다** — lifecycle 5값 · `IssueChangeView` 추세 · 대표 근거 · `/acting`·`/remediated`·`/dismiss`·
`/restore` · `review_issue_state_events` 기록. 없던 것은 **분모 하나**와 **읽는 쪽 하나**다. `byProduct`는
`IssueEvidenceSummaryView`에 있었으나 **프론트 소비자가 0**이었다. **본체는 분모이고 그것이 가장 위험한
숫자다**: `IssueProductEvidenceView`에 `productReviews` 칸을 **분자 옆에** 더했고(따로 다니는 분모는 언젠가
다른 모집단을 가리킨다), **쌍을 렌더하되 비율을 만들지 않는다** — 추출기는 본문 있는 리뷰만 읽으므로 읽은 적
없는 리뷰가 분모에는 있고 분자에는 구조적으로 들어갈 수 없어, 퍼센트는 **아무도 측정하지 않은 「검사된
모집단」에 대한 주장**이 되고 하필 사람이 보고 행동할 그 숫자다(테스트가 `%`·퍼센트·비율 부재를 단언).
어느 상품에도 닿지 않은 근거는 **자기 줄로** 말한다(말하지 않으면 합계가 모자란 이유를 알 길이 없다).
「우리가 써 둔 것」은 `KnowledgeMentionCheck` 재사용이고 **세 상태를 가른다**(빈 라이브러리 · 가졌으나 이
문제를 다루지 않음 · 답함) — 합치면 **이미 답을 써 둔 판매자에게 가서 쓰라고 말하게 된다**; 「답변 기준
채우기」는 빠진 것이 있을 때만 렌더된다. `OpportunityRules.guidanceTargetOf`를 순수 함수로 재사용해
**「배송 파손」은 교환·반품 규칙이 답한다**는 측정된 정정을 두 번 정하지 않는다. **판단 어휘는 새로 만들지
않았다** — `IssueLifecycleState`가 lifecycle이 생긴 이래 그 어휘이고 per-review 축과 겹치지 않는다; 없던 것은
**판매자의 문장**이었다(두 transition은 처음부터 operator note를 받는데 화면이 하나도 보내지 않아, 모든 결정이
**아무 말도 하지 않은 사람의 상태 변경**으로 기록됐다). 칸은 **선택**이고 **해결 처리 컨트롤은 어느 상태에도
없다**(무변경). 양방향 연결 완성 — 근거 인용마다 **`/reviews/reply/{reviewId}`**로, 그리고 **조건이
사라졌다**(옛 인박스 링크는 그 페이지가 이미 들고 있는 행만 열 수 있어 membership 검사가 붙어 있었고, 그래서
판매자가 인용 뒤의 리뷰에 닿을 수 있는지가 **다른 화면이 무엇을 fetch했는지**에 달려 있었다); 소비자 0이 된
`evidenceInboxRef`와 `/memory`의 매 로드 인박스 조회는 삭제. 읽기는 둘이고 `allSettled`로 **따로 실패한다**
(못 읽은 블록은 아무것도 그리지 않는다 — 「0개 상품」은 보지 못한 사실에 대한 주장이다). **컨트롤러에 write
0**(결정의 두 번째 문 금지) · **열 때 모델 0**(retrieval 두 단계는 검색마다 새 모델 호출이라 여는 값이 돈이
된다). backend **4,045** · frontend **240 files / 2,844** · 실패 0 · **실제 Demo Org 브라우저 QA 통과**
(1440/1366/1152 · axe 0 · 콘솔 0 · off-host 0 · 채널 0 · 모델 0 · DB 행 변경 0; 접착 부족 = 전선몰딩
**1,761건 중 16건** · 종이컵보관함 416건 중 1건 · 세모금컵 786건 중 1건). **계약이 바뀌어 테스트 2건을 다시
썼다**(`memoryScope`의 「textarea 0」은 「두 번째 composer 없음」의 proxy였는데 판단을 적는 칸이 생기며
**판단하는 화면에서 아무것도 못 쓰게 하는 규칙**이 됐다 ⇒ 주장을 직접 한다; 링크 테스트는 더 강한 주장으로).
**고치지 않고 보고**: 판매자 결정 컨트롤은 **오늘 이 org에서 도달 불가**(`startActing`은 `NEEDS_REVIEW`를
요구하고 25/25가 `OBSERVING`이며, 어떤 7일 창에도 근거 4건 이상이 **없다** — 13개월에 18건으로 퍼져 임계가
전제하는 밀도에 못 미친다; **과거 날짜로 lifecycle-pass를 돌려 상태를 올리지 않았다** ⇒ note 경로는 단위
테스트만, 라이브 미관측) · 「우리가 써 둔 것」 인용 3건이 바로 아래 개선 기회 rationale과 **중복**(정본은 새
블록이나 중복은 확장 금지된 패키지 안에 있다) · 접착 부족의 별점 분포가 **3★3 · 4★5 · 5★10 · 1~2★ 0**으로
이 반복 문제는 전부 **칭찬 속에서** 이야기된다(분포는 아직 안 그린다). **v1.1 closeout(09-13, product-owner decision 둘)**: **판매자는 `OBSERVING`에서도 명시적으로 조치를 시작할 수
있다** — `sellerMayStartActing()`이 `OBSERVING`+`NEEDS_REVIEW`를 허용하되 **자동 rule/threshold는 무변경**이고
`systemMayTransitionTo`는 여전히 `OBSERVING → ACTING`을 거부한다(두 행위자의 권한을 enum에 **나란히** 둔 이유 —
한쪽을 넓히는 편집이 다른 쪽을 조용히 넓힐 수 없다); `VERIFYING`·`RESOLVED`는 이미 조치가 기록돼 있어 제외한다.
화면은 조치가 가능해도 reviewnary의 입장을 함께 말한다(「먼저 확인을 권할 만큼 근거가 모이지는 않았습니다」).
**이 변경이 결함 하나를 드러냈고 테스트가 잡았다** — start/complete 분기가 `=== "NEEDS_REVIEW"`였고 나머지를
「조치 완료」로 흘려보내, `OBSERVING` 합류 순간 **「조치 시작」 버튼이 「조치 완료로 기록」을 호출**했다(상수 비교
대신 상태에 묻는다). 그리고 **근거의 별점 분포를 count로** 그린다 — percentage·average·importance 추론 **0**
(이 단위들은 **이 문제를 말한** 근거라 평균 별점은 상품이 아니라 **추출기가 무엇을 매치했는가**에 대한 숫자이고,
severity는 problem vocabulary에서 오지 별점에서 오지 않는다); **근거를 세지 리뷰를 세지 않으며**(grain이
`(review, unit_ordinal)`) **0인 칸을 지우지 않는다** — 실측 접착 부족 **5★ 10 · 4★ 5 · 3★ 3 · 1~2★ 0**,
즉 별점으로 정렬하는 어떤 화면도 이 문제를 보여 줄 수 없다. append-only trail 그대로(새 이벤트 표 0).
라이브 QA: 관찰 중 → 「조치 시작」 + 메모 → **조치 중**, 기록에 「운영자 · 메모」 착지, reload 유지, 다음 행동이
「조치 완료로 기록」으로 바뀜; axe 0 · 콘솔 0 · off-host 0 · 3폭 가로 스크롤 0. backend **4,048** ·
frontend **240 files / 2,853** · 실패 0. **계약이 바뀌어 테스트 3건을 더 다시 썼다**(「조치 시작 only from 확인
필요」·waiting note·`statesCannotBeSkipped` → 살아남는 주장은 **시작 없이 완료를 주장할 수 없다**이고 그것이
원래 요점이었다). **남은 PRODUCT_DECISION_NEEDED 없음**) · **`docs/local_helper_pilot_packaging_v1.md`** (Local Helper Pilot Packaging v1 — 2026-09-05. 도우미는
`tsx` 체크아웃이었고 두 시작 경로가 서로 배타적이었다(launchd는 비밀번호를 plist에 못 싣고 supervisor는 첫 pairing에
터미널이 필요) ⇒ `REVIEWNARY_HELPER_HOME` 상태 루트(프로필·pairing·상태·다운로드가 업데이트에 살아남는다) + 도우미가
스스로 읽는 0600 `helper.env`(닫힌 키 목록, plist는 경로만) + 패키지 버전 `agentVersion`. `tools/helper/build-macos.sh`가
esbuild 번들·node·Playwright·Chromium·`설치.command`(네이티브 로그인 대화상자 → 검증 → 0600)를 만든다 — **macOS만,
아키텍처별, 서명 없음(operator-assisted)**. 번들이 드러낸 결함: 한 파일 안에서 모든 CLI의 「직접 실행이면 main」 가드가
참이 된다 ⇒ `invokedDirectly(import.meta.url, 자기 파일명)`. 화면: `/connect` 상단 「reviewnary 도우미」 카드가 여섯
단어(연결됨·설치 필요·실행 필요·다시 연결 필요·연결 확인 중·업데이트 필요) + 네이버 로그인 관측(READY/LOGIN_REQUIRED/…)을
그리고 내부 단어 0(테스트), `/connect/helper` 설치·업데이트 안내, 두 자료 섹션 하나로·「작업대」→「실행 기록」,
`lastErrorKo`(backend `ConnectorErrorWording`, `GW.IP_NOT_ALLOWED`는 IP를 말하고 자격을 묻지 않는다) + 「기술 정보」
fold에 원문. 실제 설치된 launchd 도우미에서 복구 재현: 미실행·종료·backend 재시작·구버전(override, dev 전용)·재부트스트랩
전부 모델과 일치, 3폭 AA 0. **E2E 라이브 leg는 준비만**(사람이 눌러야 하는 허용·네이버 로그인·export + 단일 사용 승인) ·
KST 경계 debt: 리포트 이슈 창을 리뷰 수신 KST 날짜로(112 리뷰·1,245 문의가 UTC와 다른 날). 마켓플레이스 0 · WRITE 0.)

**`docs/helper_device_authentication_v1.md`** (Helper Device Authentication v1 — 2026-09-05. 도우미가 판매자
비밀번호를 0600 `helper.env`에 저장하고 매 실행 `POST /api/auth/login`하던 것을 **B안 — 기존 auth 위의 최소 자체
device-flow seam**(RFC 8628 모양, 라이브러리 0)으로 대체했다; Spring Authorization Server(STATELESS JWT·SPA와 맞지 않는
세션 전제 + 표 3개 + 이중 JWT 검증, 제3자 클라이언트 없어 이득 0)와 외부 provider(전체 auth 이전)는 기각. 기존
Google/NAVER/email 로그인 **무변경**. 흐름: 도우미 `POST /api/auth/device/code`(공개 클라이언트, 비밀 0) → **paired 브라우저가
bridge로 userCode를 받아 자기 JWT 세션으로** `POST /api/helper-devices/approve`(판매자는 아무것도 치지 않는다) → 도우미
`POST /api/auth/device/token` 한 번 → `rvh_` 토큰(서버는 SHA-256만, V97 `helper_devices`; 도우미는 `<home>/.auth/device.json`
0600, origin 바인딩, 180일, 재시작·업데이트 유지). `HelperDeviceAuthFilter`가 `JwtAuthFilter` 앞에서 prefix로 알아보고
**allow-list 경로만** 연다(도우미의 실제 호출 목록 + 자기 행 `/api/helper-devices/me`; `/api/users/me`·기기 목록·approve·
문의·리뷰·지식은 **401**, fallback 없음, JWT 파서에 닿지 않음). refresh 없음 — 매 요청 lookup이라 revoke 즉시; pending
grant는 메모리(5분·100건). 설정 › 계정 › **연결된 기기**(`/settings/devices`)에서 이름·연결 시각·마지막 사용·[연결 해제].
카드 단어 셋 추가(기기 연결 필요 · 연결 확인 중 · 서버 연결 확인 필요), `MIN_HELPER_VERSION` 0.2.0(비밀번호 모델 도우미는
업데이트 필요). `HELPER_ENV_KEYS`에서 EMAIL/PASSWORD **삭제**(파일에 있어도 안 읽음), `first-run.mjs` 삭제, installer가 옛
비밀번호 파일을 지우고 `unlink.mjs`가 제거 시 자기 토큰을 revoke; production 도우미는 device 토큰 **아니면 세션 없음**
(비밀번호 경로 도달 불가, 테스트). 라이브: curl로 전 경로(승인 재사용 404 · 재상환 400 · 범위 밖 401 · 해제 뒤 401), 실제
launchd 설치 0.2.0(옛 helper.env 삭제 확인), 브라우저 Playwright(pairing 1.8 s · 연결 3.7 s · 설정 해제 → 카드 복귀 10.1 s,
내부 단어 0) — 브라우저 leg는 네이티브 허용 창을 사람이 눌러야 해 dev auto-approve 도우미로 같은 코드를 돌렸고 설치 도우미의
첫 허용·연결은 운영자 몫. 라이브가 결함 하나(연결됨 뒤 폴링 정지)를 찾아 닫았다. backend 3,874 · collector 9,443 · frontend
2,752 · 실패 0. 마이그레이션 1 · 마켓플레이스 0 · WRITE 0 · 모델 0.)

**`docs/pilot_release_closure_v1.md`** (Pilot Release Closure v1 — 2026-09-05. 새 제품 기능 **0**; 첫 외부 판매자
파일럿을 막는 것만 닫는다. **먼저 직전 패키지의 보고 하나를 정정한다** — 「Guided Reply는 `VITE_AW_BRIDGE=1` + DEV에서만
런타임이 생긴다」는 **틀렸고**, 근거가 코드가 아니라 **낡은 주석**이었다(DEV 게이트는 앞선 패키지에서 이미 제거됐고
`replyBridge.ts`가 그 이유까지 적어 두었다). production 빌드 산출물에 reply carrier 연결 경로가 살아 있음을 실제 빌드로
확인했고, 낡은 주석을 고친 뒤 같은 오독이 다시 「blocker」로 보고되지 않도록 **소스 스캔 테스트**를 남겼다
(`replyPilotCapability.test.ts` — 문장은 이 질문에 대해 믿을 수 없고 소스는 믿을 수 있다). **진짜 게이트는 빌드가 만드는
CSP였다**: production 번들의 `connect-src`는 **`VITE_ENABLE_AGENT_BRIDGE=true`일 때만** 도우미 origin(http+ws)을 이름
짓고, 아니면 브라우저가 도우미와의 통신을 거부해 런타임 코드와 무관하게 가이드 lane이 복사로 떨어진다 ⇒ dev 플래그를
production에 켜는 대신 **이미 있는 capability 구조**에 얹었다(`frontend/Dockerfile` ARG/ENV 둘 · 파일럿 compose가
`PILOT_GUIDED_HELPER_ENABLED`/`PILOT_HELPER_BRIDGE_URL`에서 전달 · 기본값 OFF). 실측: 플래그 없이
`connect-src 'self' http://127.0.0.1:8787`, 플래그와 함께 `… http://127.0.0.1:47615 ws://127.0.0.1:47615`.
**도우미 패키지는 사이트별 산출물이 됐다** — `build-macos.sh`가 사이트 URL을 `BUILD.txt`에 스탬프하고 `설치.command`가
그것을 읽는다(이전에는 설치 시점 env만 봐서, 더블클릭한 판매자의 설치본이 전부 **자기 컴퓨터의 localhost**를 가리켰고
화면에는 「서버 연결 확인 필요」로만 보였다). **Retrieval v2는 global default OFF 그대로**이고 파일럿은 두 줄짜리
결정이다 — 배포에서 셋을 켜고(키 없으면 `deploy.sh`가 이름을 대고 멈춘다), **어느 조직인가는 이미 있는
`AgentCapabilityAccess`가 답한다**(`CONNECTED_SELLERS` = 채널을 연결한 조직; UUID를 env에 붙여넣고 재기동하는 온보딩을
피하려고 만든 정책이고 정책은 조직 질문만·넓히기만 한다). 세 capability의 **벤더 payload 경계**를 표로 적고 각 줄에
그것을 지키는 바이트 단언 테스트 이름을 붙였다(embedding = 모델·차원·텍스트 배열뿐 / intent = 고객 문장 하나 /
eligibility = 고객 문장 + 순위에 오른 문단 최대 6, 출력은 boolean); 저장되는 생성물은 **판매자 문단의 벡터뿐**이고
질문 벡터는 DB에 넣지 않으며, 켜면 **모든 검색에서 고객 질문이 벤더로 나간다**는 것이 이 결정의 실체다(그래서 머지가
아니라 **배포 결정**). **실행 불가 리뷰의 결함은 「이유가 없다」가 아니라 「막다른 길」이었다** — 취득 계보가 없는
리뷰에도 `canStartSubmissionRun`이 참이라 가이드 버튼이 그대로 보였고, 누르면 mint 거절로 「답변 준비를 시작하지
못했습니다. 다시 시도해 주세요」가 떴다(성공할 수 없는 재시도) ⇒ 서버가 mint와 **같은 조건**(`MARKETPLACE`)을 capability에
넣고 닫힌 어휘 `guidedUnavailableReason`(`SOURCE_NOT_EXECUTABLE`·`CHANNEL_ALREADY_ANSWERED`·null)을 함께 보내며,
화면은 그것을 **읽고**(이전에는 `channelReplyState`를 클라이언트가 재도출했다) 사실과 다음 걸음을 말한다 — 내부 어휘
(`provenance`·`MARKETPLACE`·취득 계보) 노출 **0**(테스트), **[복사]는 그 자리에 그대로**. `null`은 「아직 승인 전」이라
아무 말도 하지 않는다(묻지 않은 질문에 답하는 것이 화면이 시끄러워지는 방식이다). **배포 경로**는 이미 있던
`deploy/pilot/` 위에 개발/production 자격이 섞이지 않게 하는 검사를 더했다 — 파일럿 env가 체크아웃 **밖**이어야 하고,
`PILOT_PUBLIC_HOST`가 개발 이름이면 거부하고, 여섯 capability 각각 켜졌으면 키가 있어야 하며(백엔드 validator보다 먼저,
**변수 이름**으로), 도우미 bridge URL은 **loopback**이어야 하고, 켜져 있으면 이 사이트용 도우미 빌드 명령을 출력한다;
`smoke.sh`는 **설정과 산출물의 일치**를 본다(켜졌는데 서빙된 번들의 CSP가 도우미를 이름 짓지 않으면 실패 — 프론트
이미지를 다시 빌드하지 않은 상태이고 다른 어떤 검사도 잡지 못한다). **남은 blocker는 코드가 아니다** — 고정 공인 IPv4 +
공개 HTTPS 호스트가 없고(과금 리소스·계정 자격 ⇒ **product-owner 입력 다섯**: 리전/계정 · 도메인 · 인증서 이메일 ·
Cafe24 앱 자격 · NAVER 커머스 앱 자격), Cafe24/NAVER 앱이 그 호스트 이름으로 등록돼야 하며, 첫 연결의 라이브 증명은
여전히 첫 실제 판매자의 첫 연결이다. **마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 마이그레이션 0 · DB 행 변경 0** ⇒
evidence 행 없음. **계약이 바뀌어 테스트 3건을 다시 썼다**(두 backend 테스트는 identity를 고정한 채 각자의 게이트를
읽는다 — 약화 0, 단언은 늘었다; FE fixture는 서버가 보내는 이유를 싣는다). **§7 Context Integrity Gate(09-05,
프로비저닝 직전)**: 넷을 다시 확인해 하나는 증명하고 셋을 고쳤다. **(1) topology** — §6이 인용한
`connect-src … 127.0.0.1:8787`은 stale allowance도 런타임 의존성도 아니라 **`VITE_AGENT_RUNTIME_URL`을 주지 않은
빌드의 코드 기본값**이었다: 파일럿 모양으로 실제 production 빌드를 돌리니 `connect-src 'self'
https://<host> http://127.0.0.1:47615 ws://127.0.0.1:47615`이고 번들 전체에 **8787은 0회**(loopback은 도우미
47615뿐, `VITE_API_BASE_URL=""`이라 `/api`는 same-origin) ⇒ 코드는 그대로 두고 **검사를 더했다** — 이 실수는 오직
「overlay 없이 이미지를 빌드」로만 일어나고 그때 증상은 판매자 브라우저가 **자기 컴퓨터**를 runtime으로 부르는
것이므로, `smoke.sh`가 서빙된 CSP에서 loopback runtime **부재**와 사이트 자신의 origin **존재**를 단언한다.
**(2) retrieval — `CONNECTED_SELLERS` 자동 확대를 이 셋에서 되돌렸다.** 결함은 진짜였다: 파일럿 scope에서
`AgentCapabilityAccess`가 일곱 capability **전부**의 org 질문에 답하므로 세 retrieval capability는 flag+key만 있으면
`*_ORG_IDS`가 비어도 **연결한 모든 판매자**에게 적용됐다 — 즉 **연결했다는 이유만으로** 고객 질문이 벤더로 나간다.
이것은 `retrieval_runtime_closure_v1.md` §5의 반대이고 이유를 적는다: 그 §5가 닫은 함정(켜졌는데 아무에게도 닿지
않고 아무 말도 없다)은 진짜였고 seam도 옳았으나 **그 seam이 여기서 낸 답**이 틀렸다 — `CONNECTED_SELLERS`의 뜻은
「연결한 판매자는 **Agent를** 쓸 수 있다」이고 이 셋은 Agent가 아니며, OAuth 동의를 마친 판매자가 요청한 것은
**수집**이다 ⇒ `AgentCapabilityGate.admitsPolicyWidening()`(기본 true)을 세 knowledge properties가 **false**로
override하고 `decide()`가 그 capability에는 scope를 적용하지 않는다(**좁히는 방향으로만** — scope가 admit하지 않을
org를 여기서 admit할 길은 없다). **함정은 widening이 아니라 거절로 닫는다**: `PilotConfigValidator`가
「켜짐+키+이름 지은 조직 0」을 **모든 scope에서** 기동 거부하고 조언도 다르다(`…_ORG_IDS`를 말하지
「CONNECTED_SELLERS로 설정하세요」라고 말하지 않는다 — 여기서는 아무 일도 하지 않는 조언이다); `deploy.sh`가 같은
것을 변수 이름으로 먼저 잡고 `*_ORG_IDS=*`도 거부한다. global default는 **OFF** 그대로, plan/draft/judge/report는
**무변경**. **(3) env inventory — 네 이름이 컨테이너에서 보이지 않았다**: `SocialLoginConfiguration`이 읽는
`SELLEROPS_OAUTH_{GOOGLE,NAVER}_CLIENT_{ID,SECRET}`이 `docker-compose.yml`에도 두 env 예시에도 **없어서**, 호스트
env에 아무리 정확히 써도 컨테이너가 볼 수 없었다(Agent capability와 같은 결함 종류) ⇒ 이름만 추가(값 없음 = 그
provider는 존재하지 않음 = 이메일/비밀번호 그대로). 혼동 금지 넷을 표로 적었다 — **Google 소셜 로그인**
(`/login/oauth2/code/google`) · **NAVER 소셜 로그인**(`/login/oauth2/code/naver`) · **NAVER 커머스**(callback 없음,
**호출 IP 등록**) · **Cafe24**(`/api/connect/cafe24/callback`, byte-identical); 쿠팡 자격은 판매자가 제품 화면에서
넣으므로 호스트 env에 없다. **(4) clean data** — 게이트는 있었고(데모 콘텐츠는 데모 조직 **안에** 중첩, 조직 0일
때만 심어짐, 채널 카탈로그는 참조 데이터라 남는다, `smoke.sh`가 `demo/config enabled:false` 확인) 비어 있던 두 칸을
`deploy.sh`에 채웠다: `SEED_DEMO_CONTENT=true` 거부와 **mock 커넥터 두 스위치 거부**(mock은 실패하지 않고
**성공하며** 합성 행을 `data_origin=REAL`로 써서 이후 분리 불가). **로컬 Demo DB를 production으로 복사하는 경로는
없다** — `backup/restore`는 그 호스트 자신의 볼륨이고 `deploy.sh`는 어떤 덤프도 복원하지 않으며 파일럿 DB는
**빈 볼륨 + Flyway**로 시작한다. backend **3,880 · 실패 0**, AWS 리소스 생성 **0**, 마켓플레이스 0 · WRITE 0 ·
모델 0 · 마이그레이션 0. **계약이 바뀌어 테스트 1건을 다시 썼다** — `KnowledgeCapabilityAccessTest`가 이제 반대를
단언하고 그 이유를 자기 docblock에 적는다; 안전 테스트 약화 0, 단언은 21개로 늘었다)

**`docs/full_pilot_walkthrough_v1.md`** (Full Pilot Walkthrough v1 — 2026-09-05. 기능 개발이 아니라 **처음 쓰는
판매자 한 명으로서 제품 전체를 로그인부터 재접속까지 걸어 본** sitting. 깨끗한 org(제품 자신의 signup)와 canonical
Demo Org를 함께 썼다 — 전자는 첫 화면·채널 연결·도우미 기기 연결, 후자는 실제 데이터가 있어야만 보이는 문의·리뷰·
지식·상품·기회·리포트. walkthrough 중 결함 7종을 같은 sitting에서 고쳤다: **규격 대조를 하지 않았으면서 「고객이 어떤
규격·옵션인지 밝히지 않았습니다」라고 쓰던 문장**(`SpecApplicability`가 옵션이 **등록돼 있었는지**를 함께 답하게 하고
`AnswerBasisState`가 셋을 가른다 — 등록된 옵션과 대조해서 못 정한 것 · 옵션 목록 자체가 없는 것 · 판정을 기록하지 않은
reload) · 첫 판매자에게 「**다시** 연결 필요」(연결한 적 없는 기기에 재연결을 말하던 라벨) · 홈 첫 행이 「제목 없는 문의」
(제목이 없으면 고객 문장을 쓴다) · **판매자가 등록한 접착 안내를 리뷰 초안이 못 찾던 것 — 코드가 아니라 배포 형상**
(retrieval v2 세 capability가 기본값 OFF라 「기본 문구」로 떨어졌고, 켜자 판매자 자신의 문장을 인용한 GROUNDED 초안이
나왔다 ⇒ **파일럿 배포 결정**) · 지식·정책·이슈 화면의 날짜가 UTC(`kstDate` 하나로) · 문구 둘 · 타입 오류 하나.
**§5가 이 sitting의 본체다 — NAVER Guided Reply가 승인된 리뷰를 찾지 못한 것은 acceptance 실패가 아니라 pilot
defect였다.** 2026-09-03 LIVE PASS는 **같은 08-28 날짜**의 리뷰를 `locate_sweep step 9`에서 찾았는데, 그때 6일 전이던
그 날짜가 오늘은 **8일 전**이다. 스윕 로그가 원인을 말한다 — 행 수가 22→33으로 늘다가 **32→22로 줄고**(DOM을 재활용하는
가상 그리드) 15번째 화면에서 **`atBottom:true`**이며 15개 화면 전부 `recencySpread`가 `TODAY`/`THIS_WEEK`뿐, 즉
**일주일보다 오래된 행이 하나도 없이 목록이 끝났다**. 화면은 자기 기본 조회 기간을 보여주고 있었고 **스크롤은 필터
바깥에 닿을 수 없다**; locate는 기간을 한 번도 정하지 않고 화면이 주는 대로 받았다. 그것을 `TARGET_NOT_FOUND`로 보고한
것은 **거짓**이고(리뷰는 거기 있다) 그 문장이 암시하는 복구(다시 찾기)는 원리적으로 성공할 수 없다. 고친 방법은
**기존 UI 경로 · 새 클릭 0**: 목록 자신의 기간·페이지 컨트롤을 읽는 **범위 census**(`review-list-range-inpage.ts` —
나가는 것은 정수뿐: 활성 날짜 입력 수 · 파싱된 값 수 · as-of 기준 **일수 차** · pager 수 · 최대 페이지 번호, 날짜 문자열도
선택자도 페이지 텍스트도 넘지 않고, 날짜 술어는 acquisition lane이 라이브에서 쓰던 그것), 재활용 그리드에서는 한 스캔이
전체를 볼 수 없으므로 **화면마다의 recency bucket을 누적**해 세 판정을 가르는 것(`OUT_OF_LISTED_RANGE`(바닥까지 갔고
대상의 bucket을 한 번도 못 봤다) · `NOT_ON_SURFACE` · `NOT_ESTABLISHED`(step cap — 아무것도 증명하지 못했다)), 그리고
`OUT_OF_LISTED_RANGE`이면 **로그인을 기다리는 것과 같은 모양으로 읽기 전용 5분을 기다린다** — 판매자가 그 화면의 기간을
바꾸고 화면 자신의 [조회]를 누르면 census가 창이 바뀐 것을 보고 **목록을 첫 행으로 되감은 뒤**(재조회된 그리드는 1행부터
그려지므로 이전 스크롤 위치에서 이어 읽으면 그 위의 행들을 「없다」고 말하게 된다) 다시 스윕한다; 기간 컨트롤이 **없는**
화면에서는 기다리지 않는다. **페이지네이션 자동 클릭은 하지 않았다** — `.click(`은 여전히 `reply-composer-open.ts` 한
파일에서 정확히 한 번, `.fill(`은 `reply-composer-fill.ts` 한 파일뿐이고, 기간을 넓히는 것은 판매자의 클릭이며 우리는
결과를 감지한다(Action Window 계약 그대로; census는 pager 구조를 **기록만** 한다). **사라지던 실패도 함께 닫았다**:
도우미 로그에 `aw_naver_reply_terminal {event, code, recoverable, stage}`가 세션의 단일 publish choke point에 latch하고
(acquisition의 `aw_acquisition_terminal`과 같은 모양), 리뷰 답변 작업 화면이 run을 **구독해**(`ReplySignal`에 닫힌 어휘의
`code`·`recoverable` — 페이지에서 온 값은 절대 싣지 않는다) 멈춘 run의 **이유를 문장으로** 말하고(우리 코드명은 화면에
나오지 않는다) 「답변함으로 기록」·「답변 안 함으로 기록」 대신 **[다시 시도]**를 보이며, 물기 전에 전제를 말한다
(「네이버 리뷰 목록의 조회 기간에 이 리뷰의 작성일(2026-08-28)이 포함돼 있어야 찾을 수 있어요」). **라이브 확인 — 두 단계**: 고친 번들을
실제 설치 위치에 다시 빌드해 넣고 같은 대상 `471cf8ef`로 실행했는데, 처음 두 번은 판매자센터 세션이 만료돼 사람이
로그인하지 않아 10분 뒤 끝났다 — 그 종료가 이제 로그(`LOGIN_REQUIRED`, recoverable)와 화면(「네이버 로그인이
필요해요…」 + [다시 시도])에 **남는다**(직전 sitting에서 같은 상황이 만든 것은 침묵이었고, 승인 동작은 **0회 소진**됐다).
세 번째 실행에서 판매자가 로그인하자 **`LIVE PASS`**: census가 목록 기간을 `startDaysBefore 6 / endDaysBefore 0` —
**최근 7일**로 읽어 8일 된 대상이 구조적으로 목록 밖임을 확정했고(15화면 `atBottom`, 대상 bucket `OLDER` **0행**),
**`pagerNumberCount 0`** — 숫자 페이저가 아예 없어 **pagination은 답이 될 수 없었고 기간 필터가 유일한 결정론적
경로임이 관측으로 확정됐다**. 판매자가 기간을 1개월로 바꾸자 `WINDOW_CHANGED`(`startDaysBefore 30`) → 첫 행 되감기 →
재스윕 **14번째 화면**에서 리뷰 id 지문이 정확히 1행 → `detail_control candidates 1` → `detail_scope matched 1`(후보 2 중
nested 1 제거, **본문 지문으로 패널 신원 확인**) → `open_composer via detail` → `locate_composer composersInRow 1` →
**`execution_observed COMPOSER_FILLED`**. DB: `review_reply_execution` **+1행**(`lane GUIDED` · `approved_version 1` ·
`approved_fingerprint 27d352c5` = 승인된 head · **`provider_ref` 비어 있음**) · outcome **0** · `reply_state` **PENDING** ·
초안 **v1 그대로** · 09-03 proof 행 무변경 · 그 뒤 submit/보고/terminal 마커 **0**(run은 제출 barrier에 서 있다).
**마켓플레이스 WRITE 0 · submit 0 · 등록 0 · 마이그레이션 0.** **판매자 추가 수동 동작 1회**(조회 기간 확대)는 숨기지
않고 friction으로 적었다 — 기간 컨트롤을 우리가 조작하는 것은 이 lane의 클릭·타이핑 fence가 금지하고, URL 파라미터
경로는 **추측하지 않고** census가 구조만 기록해 둔다. 판정 **`BLOCKED`**(첫 실제 판매자에게 그대로 넘기기 — 리뷰 답변
lane 자체는 끝까지 돌았다) — 파일럿 전 필수 넷: 고정 공인 IPv4 + 공개 HTTPS 호스트 · retrieval v2 배포에서 켜기 ·
Guided Reply가 파일럿 빌드에서 꺼져 있던 것(**정정: dev 전용이 아니었다 — 게이트는 CSP였고
`pilot_release_closure_v1.md` §0·§2에서 닫혔다**) · 취득 계보 없는 리뷰가 실행 불가임을 화면이 말하기
(Demo Org 4,455건 중 `MARKETPLACE` identity는 **115건**). 정직 보고: locate가 기간을 기다리는 5분과 로그인을 기다리는
10분 동안 **판매자 화면은 아무 말도 하지 않는다** — reply engine에 park/recheck 상태가 없어서이고 이 sitting에서 만들지
않았다. collector **9,468** · frontend **2,755** · backend **3,875** · 실패 0, `reply-guard` 소스 스캔은 새 모듈을
등록해 **1,006 → 1,024** 단언으로 늘었다(완화 0))

**`docs/agentic_report_v1.md`** (Issue Evidence Trust Closure + Agentic Report v1 — 2026-09-04. **[1]** 「파손없이 잘
도착했네요」가 「배송 파손」 evidence가 되어 Opportunity까지 만들던 결함을 hard-code가 아니라 seam으로 닫았다: 추출기에는
polarity seam이 **없었고**(`IssueVocabulary`는 substring 표), triage tier는 별점의 순수 함수라 절 단위 판정에 쓸 수 없다(5★
안의 「배송이 좀 늦었네요」를 살리는 것이 splitter의 존재 이유) ⇒ `NegationScope` — 매치된 **키워드**에 붙은 부정(없·않·못·안+동사·
「줄 알」, bridge는 조사·정도부사·지/진/하지·곳/것/데/품만; 앞의 안/못, aspect의 미), 부정형 키워드(「안 왔」「없어서」)는 다시
부정되지 않고, 「배송이 안 왔어요」의 안은 problem 키워드 안에 있으므로 aspect를 지우지 않는다; 「타사 제품」은
`OTHER_PRODUCT`. 실제 표현 모양의 fixture 35문장: false **14/17 → 0/19**, 실제 불만 손실 **0/16**. 재추출은 append가 아니라
**reconcile**이 됐고(현재 extractor가 그 리뷰의 모든 unit에 대해 authoritative — 더 나은 추출기가 나쁜 추출기를 되돌릴 수
있어야 한다), 합성 리뷰는 **write 시점에 거절**(V95가 11 `DEMO_SEED`+1 `VERIFY_FIXTURE` 행 제거), boot runner가 버전이 다른
org를 한 번 전수 재추출해 `issue-rules-v2`로 stamp. 라이브: evidence **85 → 51**, 배송 파손 **15 → 1**, 접착 탈락 19 → 7, Opportunity **7 → 5**
(가짜 교환·반품 기준 제안 소멸). **[2]** `/reports`는 4개 읽기를 클라이언트에서 합치던 파생이었고 저장도 버전도 없었다 ⇒
`ReportFacts`(**id 있는 값들**: 기간 counter·이슈별 기간 근거 수·Opportunity·기존 객체로만 가는 다음 행동) 스냅샷을
`agent_report`(V96, `(org, kind, period_start, version)`)에 얼리고, **열기 = 읽기 · 재생성 = 새 버전**, 완료된 기간만(지난
월~일 / 전월, KST). 결정론 `ReportSummaryComposer`가 FACT · INTERPRETATION(「확인할 필요」) · LIMIT(「원인은 리뷰가 말해주지
않습니다」)을 쓰고, **아홉 번째 LLM capability** `sellerops.agent.report.*`(자기 flag·key·door, boundary 표 행, 바이트
payload floor — facts JSON만, 고객 문장 0)가 쓴 문장은 `NarrativeClaimGuard`가 **fact id 인용 없으면 버리고** 닫힌 원인·성과
어휘(때문·원인·탓·나빠졌·매출·만족도…)면 버린다 — 고쳐 쓰지 않는다. **없는 읽기는 0이 아니다**(7월 주문 행이 없어 「전월
0건에서 317건」이 나왔다 ⇒ `previous=null`·「이전 기간 자료 없음」). 라이브 Demo Org: 주간 23.8s·월간 19.3s, 12줄 전부 trace·
unsupported 0, 재열람 byte-identical, v2 뒤 v1 id로 읽힘, 일회용 org는 UNAVAILABLE+「달라진 것이 없습니다」, 3폭 AA 0.
남은 결함: 같은 버전 안의 규칙 변경은 boot 재추출을 다시 돌리지 않는다(VERSION bump 필요), 오타형 1건, KST/UTC 하루 경계, 첫 열기 지연은 narrative 호출 그대로.)

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

**`docs/agent_object_first_use_v1.md`** (Agent Object + First-use Closure v1 — 2026-09-01. 대화·플래너
semantics **freeze**. 질문 둘: **UI가 「현재 객체」라고 부르는 것으로 실제로 일할 수 있는가**, 그리고
**처음 들어온 판매자의 아침이 제품처럼 보이는가**. **§1 리뷰가 1급 객체가 된다** — 없던 것은 읽기였다:
런타임의 리뷰 읽기는 기간 목록과 org 전체 이슈 목록뿐이라 anchor된 리뷰 하나에 대해서는 침묵하거나,
직전 패키지가 **시도했다 되돌린** 확대(「이 리뷰」→그 상품)로 ★1 질문에 그 상품의 최신 ★5로 답하거나
둘뿐이었다 ⇒ **`GET /api/reviews/{reviewId}`** 하나(리뷰 1행 · 상품 · 채널 · 계정 · **그 리뷰 자신의
이슈 근거 링크**, org 범위 · 남의 org id는 404 · 본문은 60자 preview가 아니라 **비식별 처리된 전문**).
`issues`는 「왜 이런 리뷰가 나왔을까」의 정직한 답이다 — **이 리뷰가 이미 근거로 기록된** 반복 문제이고,
상품 전체 집계는 다른 행에 대한 다른 주장이며, 묶이지 않은 리뷰는 별점에서 원인을 지어내지 않고 그렇게
말한다. **identity는 남고 고객의 문장은 남지 않는다**(`REVIEW_DETAIL`은 `INQUIRY_DETAIL` 규칙 그대로 —
`body`는 영속 전 제거되고 새로고침 때 같은 exact endpoint에서 다시 읽는다: 고객 문장의 사본은 언제나
하나). **anchor가 자기를 답한 턴에서 죽던 결함**도 닫혔다(`workingSetOf`는 SET 없는 턴에 null을 주므로
상품·리뷰 anchor가 바로 그 턴에 떨어졌다 ⇒ `drewFreshObjectList`, 세 종류 한 규칙). **§1-C 플래너에는
「이 객체」라는 토큰이 없다** — 라이브에서 「이 리뷰 자세히 봐줘」는 리뷰 ROWS `limit:1`로 계획돼 상품의
최신 리뷰를 읽었다; 새 vocabulary를 만들지 않고 **다른 객체에 대한 같은 문장이 이미 쓰던 lane**
(`pronounInspectOf`)에 명사 **리뷰·상품**을 더했다(기존 표 하나, 명사 하나, 새 cue **0**) — 읽기 1회 ·
모델 0. 그 밖은 여전히 플래너가 계획하되 **anchor된 객체는 항상 답 안에 있다**: exact 읽기가 먼저 돌고
ROWS 요청이면 같은 상품의 이웃 리뷰가 **이름 붙어** 옆에 붙는다(「방금 보신 리뷰와 같은 상품의
리뷰입니다」). anchor 하나뿐인 집합은 교집합할 필터가 아니다(그래서 「비슷한 리뷰」가 「방금 본 1건 중
1건」이 되던 것도 닫혔다). **§1-D `replyCapability`**는 기존 `capabilityOf` 판정이고 `UNKNOWN`(확인 안
함)과 `NOT_SUPPORTED`(채널이 지원 안 함)는 다른 문장이며, 답글 컨트롤은 `DRAFTABLE`에만 그려진다.
**§2 첫 사용 세 상태**(`homeFirstUseState`, 이미 화면에 있는 `metrics.channels`에서 **파생** — 두 번째
읽기 0): `NO_CHANNEL`(연결하면 무엇을 맡길 수 있는지 + 다음 행동 하나) · `NO_DATA`(연결은 끝났고 아직
가져온 것이 없다 / 가져왔는데 없다 — `ZERO`와 미관측을 가른다) · `WORKING`(기존 브리핑). **「지금 먼저
확인할 일은 없습니다」는 셋 중 하나에서만 참이고 나머지 둘에서는 거짓**이라 opener는 `WORKING`에서만
그려진다; 맡길 수 있는 일은 **이 판매자 표의 채널이 실제로 제공하는 데이터 타입**에서 파생돼, 리뷰 수집
경로가 없는 채널이 리뷰 약속으로 나오지 않는다. **§3 중복 둘을 구조로 닫았다**: 한 채널의 수집 상태는
**컨트롤을 든 쪽**(STEP 카드)만 말하고 카드 없는 채널만 문장을 갖는다(gap은 계속 evidence로 남는다);
제목 반복은 **생산자가 선언**한다(`titleSaid` — 「가장 오래 기다린 것부터…」 위의 「가장 오래 기다린
문의」는 어떤 containment 검사도 볼 수 없는 반복이고, 선언이 없으면 기존 containment가 fallback);
객체 카드를 그린 턴은 같은 근거를 「이 답변이 가리키는 상품」으로 다시 세지 않는다. **§4 capability
답변은 카탈로그를 따라간다** — 도구별 절(clause)이라 `get_review_detail`이 있을 때만 「리뷰 하나를
고르시면…」이 나온다. 검증: backend **3,594** · runtime **796** · frontend **2,627** · 실패 0,
**라이브 브라우저 QA 1440/1366/1152**(일회용 QA org, 실제 판매자 데이터 0): 리뷰 객체 4턴 · 새로고침
유지 · 상품 객체 · 문의 객체 · capability · 첫사용 2상태 — **AA 위반 3폭 전부 0 · 콘솔 오류 0 ·
off-host 0**. 색 토큰 하나 이동(`bad` #DC2626 → **#B91C1C**: 「부정」 칩이 자기 tint 위에서 **4.49:1**로
AA를 백분의 일 차이로 놓치고 있었고, anchor된 리뷰 옆에 부정 행이 그려지는 순간 드러났다).
**마켓플레이스 호출 0 · WRITE 0 · DB 행 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음. **계약이 바뀌어
테스트 4건을 다시 썼다**(stale 채널 문장이 카드 옆 산문에서 「정확히 한 번」이라고 단언하던 것 — 이제
카드가 그 사실의 유일한 렌더이고 카드의 `asOf`·이유는 그대로 단언한다). **고치지 않고 보고**: 리뷰
ordinal 선택은 여전히 카드를 그리지 않는다(frozen 대화 semantics), 결정론 INSPECT lane의
`replyCapability`는 읽기 하나만 사서 `UNKNOWN`, 상품에는 detail 카드가 없어 context bar가 목록 행에서
이름을 되찾는다, QA 한정 예산·allowlist override는 바이트 단위로 복원했다).

**`docs/pilot_readiness_closure_v1.md`** (Pilot Readiness Closure v1 — 2026-09-01. feature package가 아니라
질문 하나: **개발자가 env를 고치거나 서버를 재기동하지 않고 새 판매자를 파일럿에 추가할 수 있는가.** Agent/
conversation architecture는 **freeze**. 감사한 다섯 항목 중 넷이 진짜였고 둘이 더 나왔는데 그 둘은 「불편」이
아니라 **배포된 호스트에서 제품이 돌지 않는다**였다. **§2 접근 정책에 이름을 붙였다** — 판매자 하나를 넣는 일이
org UUID를 env 셋에 붙여넣고 재기동하는 일(그 사이 다른 판매자의 대화·실행이 전부 죽는다)이었고, 유일한 대안
`*`는 자기 docblock이 「공유 백엔드에서는 쓰지 말라」고 적어 둔 로컬 단일 사용자 장치였다 — 즉 **production
onboarding 경로가 「판매자마다 재기동」 아니면 「여기서는 안전하지 않다고 문서화된 스위치」 둘뿐**이었다 ⇒
`sellerops.agent.access.scope` 하나: `ALLOW_LIST`(기본, 기존 동작과 바이트 동일) · **`CONNECTED_SELLERS`**(파일럿
값 — CONNECTED·비파일업로드 계정을 가진 org, `findOrgIdsWithConnectedApiAccount`가 정기 수집에 이미 쓰는 **같은
문장**이고 「누가 원하는가」의 추측이 아니라 **누가 요청했는가의 기록**이다; 공개 호스트의 drive-by 가입은 연결한
것이 없으므로 쓰는 것도 없다) · `ALL_ORGS`(bare `*`가 뜻하던 것의 정직한 이름). **정책은 넓히기만 하고 org 질문만
넓힌다** — flag·key(`isDeployed`)는 어떤 scope도 덮지 못하고 목록에 적힌 org는 어떤 scope에서도 유지되며 오타는
기동 시 거절된다(`AgentCapabilityGate`가 배포 질문과 org 질문을 가른다; `isEnabledFor`는 여전히 정확히 그 둘의
논리곱이라 쪼개는 것만으로는 아무것도 안 움직인다). 범위는 **plan·draft·judge**이고 triage/signature/image는 각자
rollout 상태가 있어 조용히 넓히지 않았다. **§2-A 거절 문장은 누구의 차례인지 말한다** — 연결이 없는 org가 첫
문장에서 「AI 계획 기능이 꺼져 있습니다」(배포에 대해 참, 판매자에게 무용)를 듣고 있었다 ⇒ `unavailableMessage`
(quota와 **별도 칸** — 한도에 닿은 것이 아니므로 AGENT_QUOTA_EXHAUSTED로 보고하면 다른 처방을 말하게 된다),
failure 분류는 무변경. **§3 컨테이너가 볼 수 없던 이름들**: `docker-compose.yml`이 `SELLEROPS_AGENT_*`를 **하나도**
통과시키지 않았고 두 env 예시에도 없었다 — 런북대로 세운 호스트는 플래너가 꺼진 채로 뜨고 자유문장 turn이 전부
실패하며 어떤 변수를 채우라는 말도 없다(모델 override는 일부러 제외 — `${K:-}`는 컨테이너에서 **빈 문자열**이 되어
설정된 모델을 지운다). **§4 켜졌는데 아무도 못 쓰는 capability는 기동 실패다**(키 없음 · ALLOW_LIST인데 목록이 빔 —
정확히 그 파일럿 함정), 그리고 validator는 **어떤 capability의 property key도 읽지 않는다** — 두 capability의 flag를
한 파일이 읽으면 두 노출이 한 스위치가 되고 `AgentDraftBoundaryTest`가 첫 버전을 잡았다 ⇒ capability가 **자기 이름을
말한다**(`capabilityName()`). **§5 `tools/dev/org-cleanup.sh`** — org UUID 하나, dry-run 기본, **CONNECTED 계정을 가진
org는 거절**(실측: 데모 org와 이 패키지 자신의 QA org를 거절), 단일 트랜잭션이라 막히면 전부 롤백, 표 목록은 카탈로그에서
(손으로 쓴 목록은 다음 마이그레이션에서 낡는다). **§6 상호작용 둘**: 서수로 부르는 것은 **누르는 것과 같은 행위**라
「두 번째 리뷰 자세히」가 클릭·「이 리뷰」와 같은 결정론 lane으로 exact 카드를 그리고, `replyCapability`의 `UNKNOWN`은
**예산 결정이었지 정직함이 아니었다** ⇒ 계정 기준 org-scoped READ 하나를 더 사서 같은 `capabilityOf`로 판정한다(다만
**읽어서 아무것도 안 나오면 여전히 UNKNOWN** — 「확인 못 했다」와 「지원 안 한다」는 다른 주장이고 관측된 것은 하나뿐이다).
**§7 production run store가 제품이 쓰는 것을 받지 않았다** — 허용 domain이 `{INQUIRY,REVIEW,ISSUE}`인데 대화는
`CONVERSATION`/`OPEN`을 쓰고, `APP_ENV=production`은 그 store를 **요구**하며 파일럿 compose가 정확히 그 조합이다 ⇒
**모든 배포 호스트에서 모든 대화가 create에서 400**이었다(= chat-first 제품이 첫 문장에서 거절). domain·status를 넣되
**sanitization fence는 유지**하고 이 domain에 한해 **세 키만** 좁혔다 — `turns[].text`(판매자가 친 문장) ·
`turns[].message`(우리가 쓴 문장) · `pendingCapture.candidate.content`(판매자 자신의 지식이 될 문장); **판매자가 친 것을
담지 못하는 transcript는 transcript가 아니다**. body·details·draft·quote·writer·email·phone·address는 대화에서도 그대로
금지이고 고객의 문장은 저장 전에 이미 제거된다(§9-6이 실측) ⇒ 펜스 없는 로컬 파일 store에서 이 경로로 옮기는 것은
검사가 **늘어나는** 변화다(실측: 파일 store의 대화 40개 전수에서 `text`/`message` 40건 · `content` 1건 · 그 외 0건).
**§8 커넥터가 꺼진 채널은 수집을 멈춰야지 지어내면 안 된다** — `resolvePullConnector`가 dedicated channel이 없는
connector(=`MockApiConnector`)로 폴백해서, 커넥터 flag를 끈 채널의 sync가 실패가 아니라 **성공**하며 합성 리뷰·문의를
`data_origin='REAL'`로 판매자 표에 썼다(이 패키지 QA에서 실측: 커넥터 전부 off인 QA org가 스케줄러 두 tick에 리뷰 60·문의
45를 수집; **마켓플레이스 호출은 0** — mock은 네트워크도 자격도 쓰지 않으므로 egress 결함이 아니라 데이터 정합 결함이다)
⇒ `sellerops.connector.mock-fallback.enabled`(기본 **true**로 로컬·테스트 무변경, 파일럿 예시는 **false**), 채널 자신의
커넥터는 절대 가리지 않는다. **§9 검증은 clean pilot-style boot 위에서**(시드·커넥터·self-pilot·proactive·전송 전부 off,
mock fallback 펜스, plan/draft on **allow-list 비어 있음**, scope=CONNECTED_SELLERS, 런타임은 production+spring store —
파일럿 compose가 만드는 그 자세; 마이그레이션 86 검증·적용 0, ERROR/WARN 0, 7.0초): 가입 직후 연결 전 → 판매자의 다음
걸음 문장 · 연결 직후 → **env 편집 0 · 재기동 0 · 같은 프로세스**에서 DONE · org A/B 격리(404) · 데이터 org 「미답변 35건」 ·
서수 inspect가 row #2와 **같은 id**의 카드 · **backend와 runtime 재기동 뒤** 대화 6 turn·anchor 유지·저장된 카드의 `body`
제거 확인·같은 스레드 계속 · scoped cleanup 실행. 브라우저 1440/1366/1152에서 첫사용 3상태와 서수 카드 — **AA 위반 0 ·
가로 스크롤 0 · 콘솔 오류 0 · off-host 0**. backend **3,613** · runtime **801** · frontend **2,627** · 실패 0.
**마켓플레이스 호출 0 · WRITE 0 · 마이그레이션 0** ⇒ evidence 행 없음. **정직 보고**: CONNECTED 계정은 안전한 테스트 몰이
없어 **행을 직접 넣었다**(마켓플레이스 0·자격 0) — 증명된 것은 그 행을 **읽는 admission 정책**이지 그 행을 **쓰는 연결
흐름**이 아니며, 후자의 첫 증명은 여전히 첫 파일럿 판매자의 첫 연결이다. **고치지 않고 보고**: 대화에 turn 상한이 없고
스냅샷 천장은 256KB(현재 최대 85KB — 상한을 정하는 것은 판매자가 무엇을 잃느냐는 제품 결정) · 접근 정책은 gate마다 존재
쿼리 1회(캐시 없음) · 나머지 세 AI capability는 allow-list 유지(다만 §4 validator는 그것들에도 적용된다) · mock fallback이
이미 쓴 합성 행은 로컬 QA org에 남아 있다. **남은 외부 증명과 파일럿 프로비저닝 입력은 §10**)

**`docs/pilot_connection_external_proof_gate_v1.md`** (Pilot Connection & External Proof Gate v1 —
2026-09-01. Agent/UI architecture **freeze**. 질문 둘과 감사 하나. **(1) 연결 flow가 정말 admission을
만드는가** — 직전 패키지는 `CONNECTED_SELLERS`를 **읽는** 정책만 증명했고 그 행은 **DB에 직접 넣은**
것이었다: 손으로 넣은 행은 연결 flow가 admission query가 모르는 상태에 착지해도 **알아챌 수 없다**(그
행이 맞도록 쓰였기 때문). 이번엔 아무것도 삽입하지 않고 제품 자신의 flow를 돌린다 — 실제
`Cafe24OnboardingService` · 실제 `/api/connect/cafe24/start` · state guard · mall-identity gate ·
이 저장소가 만드는 토큰 요청 · 실제 `CredentialVault` 봉인 · 실제 상태 전이 · 실제
`hasConnectedApiAccount` · 실제 `AgentCapabilityAccess`. **가짜는 하나뿐이고 그것은 반드시 가짜여야 하는
것이다** — `Cafe24HttpClient`, 자기 docblock이 이미 「커넥터의 유일한 fakeable HTTP 경계」라고 적어 둔
그 인터페이스(앱 자격은 placeholder이고 프로세스를 나가지 않는다). CI에서 항상 도는
`ConnectionAdmissionTest`(4) + 배포 모양 그대로의 **disposable Postgres IT**(`SELLEROPS_PG_PROOF=1`,
2/2 · Flyway 86 · allow-list **비움** · 시드 off · mock 두 스위치 off · `PilotConfigValidator` 통과):
가입 → `POST /api/agent/plan`이 「판매 채널을 연결하시면…」 → start(PENDING, **시작은 완료가 아니다**) →
callback **302 `status=connected`**(인가 코드는 리다이렉트에 없다) → 토큰 교환 **1** · 봉인된 자격 **1** ·
`CONNECTED`·`is_file_upload=false` → **같은 프로세스에서 `ALLOWED`**(env 편집 0 · 재기동 0), 두 번째
판매자는 여전히 거절, 합성 행 **리뷰 0 · 문의 0**, 실 로컬 DB 무접촉(44 org 불변). 끝은 정책 bean으로
단언하고 `/api/agent/plan`을 두 번 부르지 않는다 — gate 뒤는 **유료 벤더 호출**이고 게이트가 이미 답한
것을 사려고 테스트가 돈을 쓰지 않는다(비용 0인 거절은 HTTP로 단언했다). 외부로 남는 것: 실제 mall의 동의
화면 · 그것이 발급하는 code · 그 mall의 토큰 엔드포인트가 이 요청을 받는가 — **첫 파일럿 판매자의 첫
연결**. **(2) mock fail-closed** — 오류가 없는 결함이다: 아무것도 throw하지 않고 sync가 **성공**하며
`data_origin=REAL` 기본값 때문에 합성 행이 판매자 행과 구분되지 않는다. 독립적인 fence **둘**(서로에게
의존하지 않는다): `sellerops.connector.mock.enabled`(기본 **false**) = **bean 자체가 없다**(등록되지 않은
bean은 registry든 나중에 쓰일 코드든 어떤 경로로도 resolve 불가) · `sellerops.connector.mock-fallback.enabled`
(**true→false**) = dedicated 커넥터 없는 채널은 **아무것도** resolve하지 않는다. **기본값 on으로 낸 것이
잘못이었다** — 아무 말도 하지 않은 배포(= 아직 아무도 감사하지 않은 모든 배포)를 위험한 쪽으로 만들었다.
세 번째 조건은 기동 시: mock과 실제 커넥터가 **함께** 켜지면 `PilotConfigValidator`가 거부한다(두 스위치
모두 시킨 대로 동작하므로 다른 무엇도 항의하지 않는다; 섞이면 되돌릴 수 없고 기동이 마지막 구분
가능한 순간이다). **삭제가 아니라 fence** — `ConnectorRegistry`의 1-인자 생성자는 fallback을 켠 채로
남고 그것이 「명시적 dev/test fixture」의 뜻이다(Spring은 그 생성자에 닿지 않는다). `MockConnectorFenceTest`가
brief의 세 상태(커넥터 off · 자격 없음 · 미지원 타입)에서 **행 0**을 고정하고 — registry는 Spring이 만드는
모양(fallback off)이며 mock은 **일부러 목록 안에** 있다 — `MockConnectorAvailabilityTest`가 `application.yml`을
텍스트로 읽어 기본값 둘을 고정한다. 로컬 실측: 자기 커넥터가 켜진 CAFE24·NAVER·COUPANG은 **무변경**,
커넥터 없는 GMARKET·ELEVENST·SSG는 `API/auto-collect=true/전 타입 지원`(mock의 것)에서
**`null`/false/0타입**으로 — 수집할 수 없는 채널이 그렇다고 말한다. **(3) 외부 live proof 감사(마켓플레이스
WRITE 0)**: **READY** NAVER Guided Acquisition(`import/naver` — 계정 + **foreground TTY**로 페어링된
도우미; 분리 실행된 resident helper는 `503 approval_unavailable`로 페어링을 거부한다) · NAVER Review
Guided Reply **composer-fill**(승인된 초안 + 단일 사용 `submissionRef` + **review-id fingerprint 보유**;
`UNAVAILABLE`이면 한 글자도 넣지 않는다. 경계는 열거형 source guard가 강제한다 — `.fill(`는 **한 파일**,
`.click(`는 **한 파일에서 정확히 한 번**(등록/submit 단어가 붙은 컨트롤에는 tagger가 마커를 달지 않는다),
`.press(`·`keyboard`·`dispatchEvent`·`.submit(`·`requestSubmit`는 **어디에도 없다**, 디렉터리에 추가된
모듈이 목록에 없으면 **빌드 실패**; fill gate는 순수하고 fail-closed이며 채우지 못한 run도 barrier까지
가서 판매자가 붙여넣는다 — **「채우지 못함」은 「답변하지 못함」이 아니다**; `COMPOSER_FILLED ≠ posted`) ·
**BLOCKED** Cafe24 리뷰 댓글(플래그 · 단일 사용 승인 id · `SHOP_NO`(**0=전송 없음**) · `mall.write_community`
재동의는 전부 설정이고, 진짜로 없는 것은 **공개 댓글을 달아도 되는 리뷰 객체**다 — 쓸 수 있는 mall은
실제 고객 리뷰를 든 Demo Org의 그것뿐) · NAVER 고객 문의 답변(승인이 **subtype을 묶는다** — 두 subtype은
겹치지 않는 bare int64라 잘못 쓰면 실패가 아니라 **다른 고객에게 답이 간다**; 없는 것은 미답변 문의) ·
Coupang 문의 답변/guided acquisition(자격 + **호출 IP 등록** + 미답변 문의; acquisition만 돌리면 행의 작은
쪽만 증명된다. Coupang 리뷰 답글은 기능 자체가 없어 `NOT_SUPPORTED`이지 「아직」이 아니다). 검증: backend
**3,631** · runtime **801** · frontend **2,627**(소스 무변경) · 실패 0, 로컬 스택 재기동 clean(ERROR/WARN 0,
7.6초). **계약이 바뀌어 테스트를 다시 썼다** — 여섯 `*ConnectorConfigurationTest`는 *dedication*을 단언하며
「나머지는 mock」으로 표현하고 있었으므로 `registryGraph()`가 dev 배포처럼 fixture를 요청한다(단언은 전부
보존, 기본값은 `MockConnectorAvailabilityTest`가·수집 결과는 `MockConnectorFenceTest`가 소유). **안전 테스트
약화 0.** **마켓플레이스 호출 0 · WRITE 0 · 모델 호출 0 · 마이그레이션 0** ⇒ evidence 행 없음. **고치지 않고
보고**: 커넥터 없는 채널의 로컬 동작 변화(되돌리려면 두 스위치를 **모두** true), fallback이 이미 쓴 합성 행은
로컬 QA org에 잔존, `data_origin` 기본값은 여전히 `REAL`(생산자 기준 provenance 스탬프는 같은 규칙의 네 번째
사본이라 두 번째 합성 생산자가 생기기 전에는 만들지 않는다), 접근 정책의 gate당 존재 쿼리 1회 무캐시,
`sellerops.seed.enabled=true`의 데모 계정 생성.)

**`docs/naver_guided_acquisition_live_findings_closure_v1.md`** (NAVER Guided Acquisition Live Findings
Closure v1 — 2026-09-02. 2026-09-01 라이브 sitting이 `BLOCKED at LOCATE_EXPORT`로 끝나며 남긴 결함 9종을
**예시별 patch가 아니라 구조로** 닫는다. 라이브 실행 0 · 마켓플레이스 0 · WRITE 0 · 마이그레이션 0.
**(1) 끝난 run은 어디서 죽었는지 말한다** — `recordFailure`는 **회복 가능한** park 8종만 덮었고 terminal
engine 실패(`TARGET_NOT_FOUND`·`DOWNLOAD_TIMEOUT`·`ARTIFACT_INVALID`·`INGEST_FAILED`·`RUNTIME_FAULT`)는
마커가 **0**이라 두 sitting이 모두 귀속 불가로 끝났다. **첫 보고를 정정한다 — 판매자 UI는 gap이 아니었다**
(`view.blocker`도, FE copy도, in-page 팩도 이미 있었다); 없던 것은 **로그**다. `fail()`이 stage를 덮기 전에
붙잡아 `terminalFailure(){code,stage}`가 답하고(`TARGET_NOT_FOUND`만으로는 「판매자가 다른 화면」과 「우리
locator가 틀림」을 못 가른다), 새 마커 `aw_acquisition_terminal`은 park enum과 **일부러 분리**한다(그 8종은
`isRecoverable` total-true라 terminal을 넣으면 불변식이 거짓이 된다). 발행은 `publishState()` 단일 choke
point에 latch. **그리고 export locate가 증거를 남긴다** — 날짜 branch는 처음부터 구조 진단을 로깅했는데
export branch는 0이었다 ⇒ `aw_import_export_locate_unresolved`(+`frameResolved`·`childFrames`·기존 순수
분류기 `planExportAction`; selector·페이지 텍스트 0). **locate 자체는 무변경.** **(2) 하루짜리 창은 완전한
읽기다** — `extractDates`가 중복 제거를 하므로 시작=종료면 distinct 1이고 `matchExportScope`는 2를 요구해
그 segment 모양에서 `MATCH`가 **도달 불가**였다(라이브 `UNREADABLE datesParsed=1`, plan이 스스로 만든 창).
이제 요구 창이 하루이고 **두 컨트롤이 모두 읽혔을 때만**(`countDateReadings`) 1개를 받는다 — 반쯤 채운
picker가 확신에 찬 MATCH가 되지 않도록. **(3) 확인 단계**는 `"NONE"` 대신 `CLEAR_HIGHLIGHT`(finding 12와
같은 결함·같은 수리) — 끝난 칸을 계속 가리키던 하이라이트 제거. **(4) 라벨은 step의 것** — FE에 이미 있던
`recheckLabel`을 대화 카드도 쓴다(다운로드 전에 「내려받기를 마쳤습니다」라고 말하던 유일한 컨트롤).
**(5) 거절은 침묵이 아니다** — 헬퍼 `aw_import_command_refused`, FE `subscribeRefusal`이
`NOT_ALLOWED_NOW`(프레임조차 안 나감)와 `REFUSED_BY_RUNTIME`(왕복 후 거절)을 구분. **(6) 이미 맞는 날짜는
(2)와 같은 뿌리** — `isTargetPrefilled`가 `MATCH`를 요구했고 하루 창에서 그것이 불가능해 `prefilled=false`,
판매자가 맞는 값을 바꿨다 되돌려야 했다. **(7) 끝난 run에서 다시 시작** 가능(remount). **(8) 달력은
Asia/Seoul 하나** — `ReviewImportLaunchService`는 이미 KST였고 controller만 `ZoneOffset.UTC`라 KST 00:00–09:00
아홉 시간 동안 어긋났다; `ReviewImportCalendar`는 3줄·설정 0(**timezone framework 금지**), 저장은 UTC instant
그대로. **UTC 09-01/KST 09-02에서 실측 검증**: extend가 plan을 `09-01 → 09-02`로 옮기고 두 번째 segment를
만들었다(이전 코드에서는 no-op). **(9) plan 취소 UI** — `abandonReviewImportPlan`은 caller **0**이었다.
**(10) 이름** — 가이드 산문 125곳/16파일 + JSX 3곳 + `wing-reveal-preflight.sh`의 미러 1문장(테스트가
잡았다)이 reviewnary로; `productName.test.ts` 예외 수 **40 → 29**. **「SellerOps 도우미」는 남는다**(판매자가
자기 컴퓨터에서 찾아야 하는 프로그램, launchd label `ai.sellerops.local-agent`), 그래서 그 창을 가리키는
confirmation page 문장은 sweep이 바꾼 뒤 **되돌렸다** — 창과 다른 이름을 부르는 포인터가 더 나쁜 결함이다;
운영자 CLI(승인 매니페스트 포함)는 seller-facing이 아니라 무변경. **LOCATE_EXPORT root cause는 `NOT PROVEN`**
이고 추측 수정 0 — export와 날짜 locate가 **같은 context**를 쓰고 그 context에서 날짜는 성공했으므로 「다른
프레임」 가설은 약해졌다(다만 `frameResolved=false`는 미해명). backend 3,631 · collector 9,374 · frontend
2,627 · 실패 0, 브라우저 QA 1440×900(가로 스크롤 0 · off-host 0 · 콘솔 오류는 전부 헬퍼 미기동 health probe).
**다음 라이브 proof는 새 승인이 필요하다** — 이월된 승인은 없다.)

**`docs/review_reply_template_settings_v1.md`** (Review Reply Template Settings v1 — 2026-09-02.
리뷰 답변 초안이 **코드에 박힌 문구**에서 시작하던 것을 회사가 자기 말투로 정하게 만든다. 새 AI drafting
architecture도 새 taxonomy도 아니고, 이미 있던 분류를 **org 설정값으로 끌어올린 최소 변경**이다. **감사가
먼저 숫자를 고쳤다** — `RuleBasedReviewReplyProvider`의 category는 **7종**(별점으로 고르는 `positive_reply` ·
낱말 **5종** `quality`/`delivery`/`packaging`/`product_info`/`pricing` · fallback `general_reply`)이고 직전
preflight 보고의 「키워드 6종」은 부정확했다; enum으로 옮기며 `pricing_reply`를 한 번 빠뜨렸고
`ReviewReplyTemplateDefaultsTest`가 잡았다(그 테스트가 존재하는 이유). **선택 규칙 무변경** — 별점이 낱말을
이기고(★5 「배송 빨라요」에 사과문을 보내지 않기 위해), 낱말은 선언 순서 첫 hit, 그 외 fallback. **두 층이고
세 번째는 없다**: `ReviewReplyTemplateKey`(category·낱말·순서·기본 문구) → V89 `review_reply_template`
(`(org, key)` 유니크, **행은 override일 때만** 존재 · 백필 0 · 가입 시 생성 0) → 없으면 출고 기본값.
**기본값 복원은 DELETE**(기본 문구를 다시 써 넣으면 그 org는 이후 제품이 문구를 고쳐도 따라오지 않는다 —
고르지도 않은 문장을 영구히 얼리는 것이다). v1에 상품별·계정별·채널별 override·조건식·우선순위·템플릿 언어
**0**이고 `ReviewReplyTemplateFenceTest`가 `productId`/`sellerAccountId`/`channelCode`를 이름으로 금지한다.
provider는 `ObjectProvider` optional 주입이라 template 저장이 없는 context에서도 **테이블 생기기 전과 같은
바이트**를 낸다. **style layer임을 구조로 고정** — fence가 사실 출처(`KnowledgeRetriever`·`ProductKnowledge`·
`AnswerMemory`·`OrderFact`·repository들) · 모델 seam(`AgentLlm`·`ChatModel`·`prompt`) · **보간 문법**
(`{{`·`${`) · 승인 계약(`ReviewReplyDraft`·`ReviewReplyApproval`·`contentFingerprint`)을 전부 이름으로
막는다: template은 **문장 전체**이지 사실을 끼워 넣는 슬롯이 아니고, 향후 Grounded Review Drafting은 이 층과
**합성**되지 이 층을 **통해** 도착하지 않는다(이번 grounding 구현 **0**). **provenance는 view에만** —
override 문구는 `providerVersion=templates-v1+org`로 보고되지만 저장되지 않고 아무것도 바인딩하지 않으며,
초안 version·`content_fingerprint`·승인·execution binding은 **무변경**이고 **APPROVED head만** 실행에 쓰인다.
화면은 `/settings/review-templates` 「리뷰 답변 문구」 — 유형별 **한국어 이름 · 언제 쓰는지 한 줄 · 트리거
낱말 · 상자 · 저장 · 기본값 복원**이고 **내부 key 노출 0**(렌더된 전체 텍스트를 검사; 이름 없는 category는
raw로 그리지 않고 아예 렌더하지 않는다), 순서는 제품이 실제로 판단하는 순서, 저장은 내용이 바뀌었을 때만
활성화돼 기본값과 같은 내용을 override로 써 넣는 경로를 화면에서 막는다. 라이브(로컬 스택 재기동 · V89 62ms ·
ERROR/WARN 0): 설정 전 7종 기본값 → 저장 → `c329471c` 제안이 org 문구 + `templates-v1+org`로 바뀌고 **초안
head v1은 무변경**, 제품 signup으로 만든 **org B는 기본값**이며 서로의 문구가 보이지 않고, `PUT …/reply/draft`
baseVersion 1로 **v2** 생성(v1 fp `700b7924…` 그대로 · 승인 0 · execution 0), 공백/4000바이트 초과/알 수 없는
유형은 400에 행 0, 기본값 복원은 행 삭제. 브라우저 1440/1366/1152 — key 노출 0 · **AA 위반 0** · 가로 스크롤 0 ·
콘솔 오류 0 · off-host 0. backend **3,662** · frontend **2,667** · 실패 0. **마켓플레이스 호출 0 · WRITE 0 ·
모델 호출 0** ⇒ evidence 행 없음. **고치지 않고 보고**: Demo Org의 `positive_reply` override는 QA가 설정한 값
그대로 남아 있고(화면에서 [기본값 복원] 한 번), 이 org에 승인된 리뷰 답변이 없어 「승인된 초안 무변경」의
라이브 관측은 없으며, **§8 Closure(09-03) — precedence를 뒤집었다가, 재서, 되돌렸다.** 「★4 불만이 칭찬 문구로 시작하는 것」을
고치려고 selection을 `낱말 5종 → rating≥4 → GENERAL`로 바꿨고, 실제 NAVER 코퍼스 4,455행에 두 규칙을 돌려
**쟀다**: `positive_reply`를 떠나는 것은 **1,153건**이고 그중 **★5가 1,098건**(delivery 896 · pricing 117 ·
quality 77 · product_info 48 · packaging 15), 겨냥한 ★4 불만은 **55건**이며, 정작 target `c329471c`는 불만이
다섯 목록의 **어떤 낱말도 쓰지 않아** 그대로였다 — **바꾸려던 것은 안 바뀌고 안 바꾸려던 것이 1,098건
바뀌었다** ⇒ **되돌렸다**(`rating≥4 → POSITIVE ; else 낱말 5종 ; else GENERAL`). 이유는 구조적이다:
**이 낱말들은 topic을 감지하지 polarity를 감지하지 않는다** — 「배송 빨라요」와 「배송 늦어요」는 이 표에 같은
단어이고, 가릴 수 있는 것이 생기기 전에는 topic이 별점을 이겨서는 안 되며 여기에 감정 heuristic을 넣는 것이
곧 이 provider가 「아니라고 정의된」 AI다(낱말 목록·classifier·polarity heuristic **0**). **대신 고친 것은
문구의 성격이다** — 되돌리면 ★4 불만이 다시 이 문구로 시작하므로 **그 문구가 축하하지 않게** 했다:
이름 「칭찬 리뷰」 → **「별점 4~5점 기본 문구」**(제품은 칭찬인지 불만인지 모르고 별점과 topic 낱말만 보므로
「칭찬」은 아무도 하지 않은 판정을 판매자에게 약속하는 일이다 — 어떤 이름에도 「칭찬」이 없음을 테스트가
고정), 기본 문구 「좋은 후기를 남겨주셔서 진심으로 감사합니다…」 → **「저희 제품을 이용해 주셔서 감사합니다.
남겨주신 후기 잘 읽었습니다.」**(감사하되 만족을 **단정하지 않고** 약속 0 ⇒ 판매자는 **틀린 문장을 지우는
대신 중립적인 문장을 고쳐 쓴다**; `ReviewReplyTemplateDefaultsTest`의 리터럴이 같은 커밋에서 함께 움직였고,
그 테스트가 존재하는 이유가 「reword를 아무도 안 읽은 diff가 아니라 결정으로 만드는 것」이다). 부수로
provenance를 **행 기준**으로 고쳤다(기본값과 같은 문구를 저장한 회사도 그것을 고른 것이므로 `+org`; 읽기 1회
유지). 라이브 회귀: ★5+「배송」 → `positive_reply`(사과문 아님) · ★≤2+「배송」 → `delivery_reply` ·
**`c329471c` ★4 → `positive_reply` + org override가 시작 문구 + 초안 v3 `44627df4…` 유지**(v1·v2 무변경 ·
재생성 0 · 승인 0 · execution 0). backend **3,666** · frontend **2,667** · 실패 0 · 브라우저 3폭 AA 0 ·
key 노출 0 · 마이그레이션 0 · 마켓플레이스 0 · 모델 0. **FREEZE** — org override · 7 categories ·
save/reset/default fallback · isolation · next-draft application · validation · approval 불변성은 유지하고,
configurable trigger words · product/channel/account override · custom category · interpolation DSL ·
AI classifier · polarity heuristic · grounded drafting은 **추가하지 않는다**. **열린 채로 남는 것**: ★4 불만을
낱말로 알아보는 문제는 이 층에서 풀 수 없고, 진짜 답은 polarity를 아는 층이며 이 패키지가 만들지 않는다).

**Design contract:** `docs/reviewnary_design.md` — 40~50대 비기술 판매회사 대표를 기준 사용자로 하는
`frontend/` 디자인 계약(타이포 스케일 · 간격 리듬 · 콘텐츠 폭 · 표면 위계 · CTA 위계 · 상태 색 ·
Agent 브리핑 · 구조화 객체 카드 · 근거 공개 · 빈/로딩/오류 · 접근성 · 반응형). **코드가 이미 하는 것의
기록이고 새 디자인 시스템이 아니다**; 여기 없는 색·서체·컴포넌트 라이브러리는 이 문서가 허가하지 않는다.
**`docs/reviewnary_visual_system_v1.md`** (Reviewnary Visual System + Conversation Shell v1 — 그 계약 위에서
**대화 셸의 시각 체계**를 다시 정한 `frontend/` 전용 패키지. 행동 변경 0: freshness routing · channel
continuity · actionable work 정의 · acquisition E2E · planner/retrieval/memory · 승인 경계 전부 무변경.
핵심은 **containment가 정보가 된다**는 것 — 대화 열은 **종이**(`bg-surface`)이고 레일과 업무 화면이 가라앉은
바닥이며, 읽는 객체(목록·표·차트·지표)는 상자 없이 **머리카락 선 사이에 끼워 넣어** 문단과 같은 왼쪽 끝에
정렬되고, **테두리는 「손이 필요한 것」에만** 남는다(단계·승인·guided run·지식 질문·보낼 초안). 고도(그림자)는
**입력 상자 하나**에만 쓴다. 타입은 어시스턴트 산문 전용 단계 `prose` 17/1.75가 생겨 평범한 턴에서 **답이 가장
큰 글자**가 되고(판매자가 여는 것은 여전히 그 위), 읽기 열은 840→**720px**, 턴 간격 24→32px. `✳︎` 이름표는
**정체성이 아니라 정보를 나르는 두 자리**(실행 중 · 중지됨)에만 남는다. 새 색 토큰 **0** — accent와 세 번
측정해 어둡게 만든 상태색 사다리는 건드리지 않았고, 추가 토큰은 셋(`prose`·`shadow-composer`·`max-w-thread`).
skill 감사: 공식 `frontend-design`을 **프로세스**로 썼고, `shadcn`/`vercel/ai-elements`는 참고만 — registry의
`bubble`·`marker`는 **radix-ui + Tailwind v4** 문법이라 이 저장소(Tailwind 3.4 · Radix 0)에서 조용히 깨지고
`message-scroller`는 새 npm 의존성을 요구하므로 **가져온 컴포넌트 0**이다. 마켓플레이스 0 · WRITE 0 ·
마이그레이션 0 ⇒ evidence 행 없음)

**`docs/outcome_artifact_visual_closure_v1.md`** (Outcome Artifact + Visual Final Closure v1 — 2026-09-02.
visual direction과 chat semantics는 **freeze**하고 `a041b163`이 남긴 cross-layer presentation blocker만
닫는다. **§1 완료 결과의 숫자는 숫자로 이동한다** — 백엔드 attempt row의 다섯 사실(channel · window ·
rowsNew · rowsDuplicate · rowsFailed)이 한국어 문장 하나로 납작해져 있어서, 화면이 숫자에 크기를 주려면
**우리가 쓴 문장을 되파싱**해야 했다(이 저장소가 다른 모든 곳에서 거부하는 모양) ⇒ 닫힌 artifact
**`ACQUISITION_RESULT`** 하나(값만 — run id·plan·segment·provenance 0)와 `acquisitionMeaning()`:
**prose는 의미만**(새로 들어왔다 / 없다 / 말할 수 없다 — 숫자도 날짜도 0), **카드는 숫자와 기간만**.
`titleSaid`는 생산자가 선언한다. **completion truth 복제 0** — claim ladder(`reviewClaim.ts`)는 무변경이고
이미 있던 규칙(같은 수면 evidence로)에 절 하나만 붙었다(claim.count == 그 채널 receipt의 rowsNew이면
disclosure로; **다르면 여전히 말한다** — 라이브에서 카드 115 옆에 「이번에 확인한 … 50건」이 선다).
카드는 **파생 0**(115+33=148은 아무도 관측하지 않은 셋째 수), 기록에 없는 tally는 0이 아니라 렌더 0,
`rowsFailed:0`은 행을 쓰지 않고 실패가 **있으면** 자기 figure를 `bad`로 갖는다. 라이브(실제 Demo Org
attempt `c1701821`): **네이버 스마트스토어 · 8월 20일~9월 2일 · 115 새로 들어옴 · 33 이미 있던 리뷰**.
**§2 sentinel window** — `claimsFor`에 `{from:"0000-00-00", to:"9999-99-99"}`를 넘겨 필터를 통과시키던
자리에서 `windowWord`가 그것을 **판매자 문장에 인쇄**하고 있었다(「… 중 0000-00-00~9999-99-99에 작성된
리뷰는 50건입니다」) ⇒ `DateWindow | null`, **행 수는 그대로**(sentinel 범위가 하던 일이 정확히 그것),
바뀌는 것은 절 하나뿐 — **기간이 없으면 기간을 말하지 않는다**. claim 의미 재설계 0. 회귀는 둘:
unit(같은 수 · sentinel 0)과 **source scan**(`agent-runtime/src` 어느 .ts의 코드에도 그 리터럴 없음),
그리고 라이브 3폭에서 렌더된 문서의 sentinel **0**. **§3** 문의 collection의 두 줄 footer를 한 줄로
(더 보기는 왼쪽 muted · 화면에서 보기는 오른쪽 — 리뷰 목록이 이미 쓰던 모양), 본문 없는 리뷰는
「별점 5점만 남긴 리뷰 · {상품}」로 이름 짓고 **상품은 meta 줄에서 빠진다**(한 사실 한 번; ★ 배지도
이름이 별점을 말하면 렌더 0) — 새 정보 생성 0. **§4** `.claude/skills/*` 심볼릭 링크 3개가 ignored
디렉터리를 가리켜 fresh clone에서 **끊긴 파일**로 도착하던 것을 untrack하고 `skills-lock.json` +
`docs/design_skills_bootstrap.md`(명령 하나)로 대체 — 제품 runtime 의존성 0. 검증: runtime **822** ·
frontend **2,652**/223 files · 실패 0 · typecheck clean(직전 커밋에 있던 `freshnessUx` cast 오류도 함께
수정), 라이브 브라우저 A–E × 1440/1366/1152 — **AA 위반 0 · 가로 스크롤 0 · off-host 0**.
**마켓플레이스 호출 0 · WRITE 0 · DB 변경 0 · 마이그레이션 0** ⇒ evidence 행 없음. **고치지 않고 보고**:
같은 상품·같은 별점·같은 날짜의 본문 없는 리뷰 둘은 여전히 같은 이름, 실패 경로에서 receipt가 사라지는 것,
QA 발판(폭당 대화 fixture · 로컬 백엔드 JVM 예산 상향). **§5 Presentation Closure(같은 날)**: 그 「완료 턴이
자기 step을 다시 올린다」를 닫았다 — resume이 원래 질문을 재계획하면서 만든 읽기가 방금 소비한 sync보다
새로우므로 freshness 규칙이 다음 수집을 **맞게** 요구했고, 그 카드가 **영수증 바로 아래**에 섰다(영속된 턴이
ACQUISITION_RESULT와 HUMAN_ACTION_REQUIRED/REVIEW_IMPORT를 함께 들고 WAITING_HUMAN이었다). `withoutSettledCollectionSteps`가
그 **두 번째 렌더링만** 떨어뜨린다 — freshness·coverage 값은 하나도 재계산하지 않고, REVIEW_IMPORT만 · receipt가
이름 붙인 채널만 · receipt가 있을 때만(보여줄 것이 없는 완료는 카드를 지킨다)이며 같은 턴의 **다른 채널 step은
그대로**다. status·pendingHumanActions·「계속 확인하기」 칩은 같은 목록에서 파생되므로 따라오고, **다음 turn은
계약대로 다시 계산한다**(라이브: 「최신이야?」 → 「오늘 12:43 기준 …」 + 제안된 「최신 상태로 갱신」). step에서
빠진 채널의 as-of 줄은 목록 footer로 돌아온다 — 사실은 말하고 다시 하라는 요구만 사라진다. **실패 경로는 실제
fixture로 확인하고 무변경**: 문장 + step 카드 + 「계속 확인하기」 + 「파일로 직접 올리기」가 전부 있고 실패 run에
receipt를 주장하지 않는다(harness 테스트가 고정). 라이브 3폭 — 완료 턴 step **없음** · 다음 turn freshness 재계산
**있음** · 미완료 턴 surface 온전, sentinel 0 · AA 0 · off-host 0. runtime **826**. 정직 보고: Demo Org의 모든
계정이 마지막 실패보다 새로운 성공 run을 갖고 있어 라이브에서 실패 분기를 고를 수 없다 ⇒ 스크린샷은 같은
surface를 그리는 「아직 수집이 끝나지 않았습니다」 분기이고, 실패 문장 자체는 harness가 실제 FAILED row로 고정한다)

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
