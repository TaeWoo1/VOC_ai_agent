# Slice Contract — Review Response Preparation v1 (Attention 표면 · 백엔드)

> Status: **BACKEND IMPLEMENTED & VERIFIED, UNCOMMITTED — FE 미착수.** 백엔드(V19 마이그레이션 · 제공자
> seam · redaction 확장 · draft/approval 서비스 · 컨트롤러 · 테스트)와 scope v1.4 문서가 작업 트리에
> 있으며 **커밋되지 않았다**. 프론트엔드 노출은 **이 슬라이스에 없다**(별도 PR).
>
> 상위 계약: 범위 `docs/product-scope-v1.md` §1.6·§5·§9(v1.4 잠금), 화면·카피 `docs/sellerops_frontend_spec.md`
> §10.2·§10.3·§10.4·§15·§17, 트리아지 선행 계약은 product-scope §5의 "리뷰 트리아지(로컬 기록)" 항목.
> 본 문서는 **답변 준비의 실행 계약**을 소유하며 그들의 결정을 중복 선언하지 않는다.
>
> **정직성 경계.** 이 슬라이스는 **발송을 만들지 않는다.** 마켓플레이스 쓰기 경로(adapter · action intent ·
> dispatcher · verification)는 **전부 부재**하며, 이 슬라이스가 추가한 것도 없다. 승인은 텍스트를 **고정**할
> 뿐 전송하지 않는다. 답변은 **운영자의 클립보드로만** 나간다. 라이브 LLM은 없다(규칙 기반 전용,
> 플래그 게이트). 라이브 접속·자격증명·collector/R4 변경 없음.
>
> **`RESPONSE_NEEDED`는 여전히 아무것도 약속하지 않는다.** 게이트는 준비를 **제안**할 뿐 **유발**하지
> 않는다 — 트리아지 기록 시 아무것도 쓰이지 않고, 운영자가 명시적으로 시작할 때만 시작된다.
> `TriageDisposition`의 "recording RESPONSE_NEEDED does not draft, queue, send, or promise a reply"는
> 이 슬라이스 이후에도 **문자 그대로 참**이며, 그 유지는 요구사항이다.

베이스라인:
- 리뷰 트리아지 백엔드 PR #279 (merge `4404b4f`), 프론트 PR #283 (`6fff8f8`).
- scope lock v1.3 (`7052e71`) → 이 슬라이스가 **v1.4**로 올린다.

## Goal

`RESPONSE_NEEDED`로 기록된 리뷰에서 **복사 가능한 승인된 답변**까지, 운영자가 한 화면에서 끝낸다:
redacted 본문 열람 → 규칙 기반 추천 초안 → 편집 → 승인(고정) → 복사.

## Included (이 슬라이스)

- `V19__review_reply_prep.sql` — `review_reply_draft`(append-only 버전) · `review_reply_approval`(현재 상태,
  1행/리뷰) · `review_reply_approval_audit`(append-only, `UNIQUE(org_id, command_id)`). 추가 전용, 드롭 없음.
- 제공자 seam — `ReviewReplyProposalProvider` + `RuleBasedReviewReplyProvider`,
  `sellerops.reply.review.provider` 플래그(`rule_based` 기본, `ai` 예약·미구현).
- redaction 확장 — `VocPreviewSanitizer.redactFullBody`: 미리보기와 **동일한 규칙**, 절단 없음, 얇음에 의한
  suppression 없음, 줄 구조 보존. `sanitize` 동작은 **불변**(회귀 핀 테스트 포함).
- `ReviewReplyService`(인가 + 게이트 + capabilities) · `ReviewReplyDraftService` · `ReviewReplyApprovalService`
  + `ReviewReplyApprovalWriter`(`REQUIRES_NEW` + `READ_COMMITTED` + `PESSIMISTIC_WRITE`).
- `OperatorReviewReplyController` — `GET …/reply`, `PUT …/reply/draft`, `POST …/reply/approval`.
- 테스트 72개 신규(아래 §Acceptance) + scope v1.4 / frontend spec 개정.

## 계약의 핵심 (다른 곳에 없는 결정만)

1. **게이트는 비대칭이다.** `RESPONSE_NEEDED`가 아니면 저장·승인·복사는 409/불가, **승인 해제는 항상 허용**.
   승인이 초안을 고정하므로 해제까지 막으면 리뷰가 APPROVED에서 나올 수 없다. 읽기는 항상 허용.
2. **초안은 트리아지 변경에도 보존된다.** 전진만 막고, 기존 작업은 지우지 않는다.
3. **복사는 승인된 head 버전·지문만.** 서버가 `approval.approvedBody`로 제공하며 `canCopy`가 아닐 때는
   **아예 싣지 않는다**(비밀 유지가 아니라 계약 — 클라이언트가 "상자 안의 아무 텍스트"를 복사하는 쪽으로
   흘러갈 여지를 없앤다). 승인 중에는 저장이 동결되므로 `approved_version`은 항상 head이며, 아니면
   **fail closed**.
4. **capabilities는 서버가 계산한다**(`canSave`/`canApprove`/`canWithdraw`/`canCopy`). 규칙이
   disposition × 초안 유무 × 승인 상태에 걸쳐 있어 클라이언트 재유도는 표면 간 drift를 부른다.
   렌더링용이며 **인가가 아니다** — 서버가 매 호출 독립적으로 강제한다.
5. **저장된 초안에 provenance를 남기지 않는다.** 운영자가 편집한 순간 그 텍스트는 그의 것이며,
   `RULE_BASED`를 찍는 것은 사람이 다시 쓴 문장을 규칙 엔진 공로로 돌리는 거짓말이다. 추천은 **제안되는
   순간에만** provenance를 싣는다(그때가 참인 시점).
6. **추천은 저장하지 않는다.** 리뷰 본문(write-once)의 순수 함수이므로 읽을 때마다 재계산 — 저장하면
   운영자가 쓰지 않은 "초안"이 존재하게 되고, 패널을 열었을 뿐인데 초안이 있다고 보고하게 된다.
7. **rating이 keyword보다 먼저**다. 5★ "배송 빨라요"에 배송 사과문을 붙이지 않기 위함이며, 대가는
   4★ 리뷰의 사소한 불만을 놓치는 것 — 불완전한 추천은 몇 초면 고치지만, 만족한 고객에게 사과하는 추천은
   **먼저 발견해야** 고칠 수 있다.
8. **`BODY_MAX_BYTES`는 저장 안전 한계이지 채널 한계가 아니다.** NAVER 실제 한계는 미검증이며 지어내지
   않는다(`EsmAnswerValidation`은 ESM이 문서화했기에 공식 한계를 말할 수 있다 — 여기는 아니다).

## Explicit exclusions

- **마켓플레이스 발송·게시·쓰기 일체.** publish/send/dispatch 라우트 없음(구조적으로 테스트에서 확인).
- **collector / R4 / NAVER 런타임 변경, 라이브 접속, 자격증명, 브라우저.**
- **AI/LLM.** 플래그가 `ai`를 예약하되 미구현이며, 선택 시 **부팅 실패**(조용한 규칙 fallback 금지).
- **`TriageDisposition` 변경** — 값 추가 없음, phase machine 없음, `InquiryWorkItemPhase` 어휘 차용 없음.
- **자동 초안 생성** — 트리아지 기록 시 아무것도 쓰지 않는다.
- **attention 카운트·심각도·랭킹 변경 없음.**
- **Cafe24** — 트리아지 앵커가 없어 `actionRef`가 null이므로 어피던스 자체가 없다(역량 한계).
- **`replyStatus` 쓰기 없음.** NAVER 행은 여전히 전부 null(export가 답변 상태를 싣지 않음)이므로 제품은
  실제 답변 게시 여부를 **알 수 없고**, 아는 척하지 않는다.
- **스케줄러·큐·배정.** 프론트엔드 노출.

## Acceptance criteria (달성됨)

- 백엔드 테스트 **72개** 신규(전체 스위트 **1166** 통과, 실패 0, skip 1은 기존):
  reply 패키지 60개(`ReviewReplyServiceTest` 40 · `RuleBasedReviewReplyProviderTest` 11 ·
  `OperatorReviewReplyControllerTest` 5 · `ReviewReplyApprovalConcurrencyTest` 4) +
  `VocPreviewSanitizerTest` 12개 추가(기존 15 → 27).
- 게이트 비대칭 확인: `RESPONSE_NEEDED` 밖에서 저장·승인 409 / **해제 성공** / 초안 보존·열람 가능.
- 승인 → 트리아지 변경 → 해제 → 편집 재개 시퀀스(대칭 게이트였다면 갇혔을 경로) 확인.
- 복사는 승인 head만 제공, 미승인 시 없음, `canCopy` 아닐 때 본문 미탑재, 버전 불일치 시 fail closed.
- **redaction 동등성**: 미리보기와 전체 본문이 "무엇이 민감한가"에 대해 **항상 일치**함을 속성 테스트로
  고정(PII 6종 × 공백 형태 9종). `sanitize` 회귀 핀(절단·suppression·개행 붕괴)도 유지.
- **capability ≡ enforcement**: `canSave`·`canApprove`·`canWithdraw`가 false인 각 상태에서 해당 쓰기가
  실제로 거부됨을 짝지어 확인.
- **스키마가 writer의 위임을 실제로 강제**: `applyApproval`로 `(APPROVED, null, null)` /
  `(WITHDRAWN, v, fp)`를 시도하면 테스트 스키마에서도 거부됨.
- 동시성: `REQUIRES_NEW` 핀과 `resolveRace` 복구를 **뮤테이션으로 검증**.

### 리뷰에서 발견·수정된 결함 (2026-07-17, 독립 리뷰)

구현 직후 read-only 독립 리뷰에서 blocker 5건이 나왔고 전부 수정·재검증했다. 각 수정은 **원래 버그를
되돌리면 실제로 실패하는 테스트**로 고정했다(뮤테이션 확인).

1. **redaction 분기 (privacy)** — `redactFullBody`가 개행을 보존하려고 별도 정규화를 쓰면서, 단일 구분자만
   허용하는 패턴(`01[016789][-.\s]?…`)을 2문자 공백(`" \n"`)이 무력화했다. 미리보기가 잡는 전화·카드번호를
   전체 본문이 **원문 그대로 노출**하면서 `bodyRedacted=false`로 "가린 것 없음"이라고 보고했다. 정규화를
   공유(`normalizeForRedaction`)해 **공백 run이 1문자를 넘지 않는다**는 불변식을 구조로 만들었다. 대가:
   빈 줄(문단 간격)이 한 줄 개행으로 접힌다 — 줄 구조는 남고 간격만 잃는다.
2. **capability/enforcement 불일치** — `canApprove`/`canWithdraw`가 false인데 서버가 허용했다. 해제는 행
   존재가 아니라 **상태**를 검사하고, 승인도 `requireNotFrozen`을 거치도록 통일.
3. **`replay()`가 binding 무시** — 같은 state·다른 version에 command id를 재사용하면 200 `replayed=true`로
   응답하며 승인이 조용히 누락됐다. 비교에 `approvedVersion` 추가.
4. **V19/엔티티 CHECK 불일치** — `chk_review_reply_approval_binding`이 엔티티에 없어 테스트 스키마에서
   미강제였다. `@Check` 추가.
5. **문서의 검증 수치 오류** — 이 절의 수치가 실제와 달랐다. 수정.

> 2에서 3의 게이트를 replay보다 먼저 두자 **자기 명령의 성공이 자기 재시도를 막는** 회귀가 났다(승인 후
> 같은 commandId 재시도 → 409). `gateOrReplay`가 닫힌 게이트를 다시 검사해 해결 — 승인 행과 audit 행이
> 한 트랜잭션에서 커밋되므로(`ReviewReplyApprovalWriter`) "게이트를 닫은 상태"와 "그 이유를 설명하는
> 증거"는 항상 동시에 보인다. 타이밍 의존이 아니다.

**추가 6 (수정 후 최종 리뷰에서 발견) — 수정이 새로 만든 결함: `Integer` 참조 비교.**
2번을 고치며 `baseVersion != head.getVersion()`(오른쪽이 `int` → 언박싱 → 값 비교)을
`baseVersion != …map(…).orElse(0)`(양쪽 `Integer` → **참조 비교**)로 바꿔버렸다. `Integer.valueOf`
캐시(−128..127) 덕에 버전 1~127에서는 우연히 동작하고, **버전 128부터 모든 승인이 영구히 409**가 된다 —
게다가 메시지는 "새로고침 후 다시 시도하세요"라 도움이 될 수 없다(새로고침해도 서로 다른 박스가 나온다).
기존 테스트는 전부 작은 `int` 리터럴이라 캐시 안에 들어가 잡을 수 없었다. `int`로 언박싱해 수정하고,
경계값 128을 고정하는 테스트를 추가했다.

**추가 7 — 과장된 주석 2건 (문서 정확성).** ① `no X → X edge appears in the trail`은 순차 경로에서만 참이며,
동시 경로에서는 게이트가 락 없는 check-then-act라 `APPROVED → APPROVED`가 생긴다 — **이 슬라이스의 동시성
테스트가 바로 그 엣지를 단언한다**. 주석을 사실대로 고쳤다(락을 걸 만한 사안은 아니다: writer의
`PESSIMISTIC_WRITE`가 쓰기를 직렬화하므로 각 행이 지목하는 선행 상태와 최종 상태는 정확하고, 대가는
중복 audit 행 하나와 `decidedBy`/`decidedAt` 귀속뿐이다). ② 삭제된 필드를 가리키던 `{@link #H_WS}` 수정.

**추가 5 (수정 후 최종 리뷰에서 발견) — 유니코드 공백: 기존 결함, 이 슬라이스가 노출을 넓힘.**
Java의 `\s`는 ASCII 전용이라 **NBSP(U+00A0)·전각 공백(U+3000)·좁은 NBSP(U+202F)** 를 공백으로 보지 않는다.
`010<NBSP>1234<NBSP>5678`은 `[-.\s]?`도 통과하지 못해 **미리보기·전체 본문 양쪽 모두에서 전혀 가려지지
않았다** — 즉 1번의 "두 경로가 일치한다" 속성 테스트로는 잡히지 않는다(둘 다 똑같이 실패하므로). 웹/워드
붙여넣기와 CJK IME에서 흔히 들어오는 문자다. `WS`를 `(?U)\s+`로 바꿔 두 표면 모두 강화했고, 속성 테스트의
구분자 집합에 세 문자를 추가해 고정했다. **attention 목록의 기존 미리보기도 함께 개선된다.**
남는 한계: zero-width(U+200B·U+FEFF)는 유니코드 White_Space가 아니라 여전히 숫자열을 쪼갤 수 있다 —
더 오래된 별개의 우회이며, 클래스 문서가 이미 "완전한 PII 제거를 보장하지 않는다"고 밝히는 범위다.

## Validation commands (canonical)

```bash
cd backend && ./gradlew test
```

## 미해결 (제품 오너)

- scope v1.4 §9 예외 문안 검토 — 유일하게 가드를 **느슨하게 하는** 편집이므로, "redacted · 판매자 대면 ·
  운영자 화면"으로 좁게 읽히는지 확인 필요.
- `docs/sellerops_current_state.md` §10 staleness — 이 문서는 리뷰 트리아지가 머지된 사실을 모른다
  (기준일 2026-07-08). 보고만 하고 임의 수정하지 않음.
