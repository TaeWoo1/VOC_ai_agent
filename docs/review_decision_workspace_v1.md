# Review Decision Workspace v1 — 한 리뷰를 한 화면에서 판단하고 기록한다

**2026-09-12.** 새 기능 패키지가 아니라 **배치와 도달성**의 패키지다. 판매자가
`NEEDS_ATTENTION`/`WATCH` 리뷰 하나를 열었을 때 「왜 봐야 하는지 → 무엇을 판단할지 → 무엇을 할지」를
한 화면에서 끝내게 한다.

**마이그레이션 0 · 새 테이블 0 · 새 enum 0 · 새 classifier 0 · 새 LLM capability 0 · 마켓플레이스 호출 0 ·
WRITE 0 · 모델 호출 0.**

---

## 0. 감사 먼저 — 필요한 것은 거의 다 있었고, 한 화면에 없었다

착수 전에 재사용 대상을 전수 확인했다. 결론은 **여덟 정보 중 일곱이 이미 구현돼 있었고, 그중 다섯이 이
화면에 없었다**는 것이다.

| # | 워크스페이스가 답하는 것 | 이미 있던 것 | v1 이전에 이 화면에 있었나 |
|---|---|---|---|
| 1 | 무슨 문제인가 | `ChannelReviewDetailView.body` (redacted full text) | **접혀 있었다** (`이 리뷰의 자동 분류` 아래) |
| 2 | 왜 확인해야 하는가 | `ReviewTriageNote` (tier·reason·recommendedAction) + `AiTriageMarkView` | **접혀 있었다** |
| 3 | 유사 리뷰 / 반복 신호 | `ReviewIssue` + `ReviewIssueEvidence` (T-01이 제목만 한 줄로) | **제목 한 줄뿐, 예시 0** |
| 4 | 상품 정보 / Seller Knowledge | `ProductKnowledgeSource` · `OrgKnowledgeSource` · `KnowledgeCandidate` · 상품 리뷰 카운트 | **없었다** |
| 5 | 판매자 판단 | T-07 `TriageCorrection` + `TriageCorrectionAudit` | **다른 화면에만 있었다** |
| 6 | 조치 선택 | `TriageDisposition` + `review_triage_audit` | 있었다 (`ReplyWorkControls`) |
| 7 | 조치에 맞는 답변 draft | `VocItemReplyPrep` · `ReviewDraftComposer` · 승인/fingerprint | 있었다 |
| 8 | 완료 / Decision Log | 감사 trail **다섯 개**, **읽는 코드 0** | **없었다** |

즉 이 패키지가 만든 것은 새 진실이 아니라 **읽는 쪽**이다. §8의 다섯 trail은 몇 달째 쓰이고 있었고
아무도 읽지 않았다.

---

## 1. 화면 — 사람이 결정하는 순서

`/reviews/{accountId}/reply/{reviewId}` (대화에서는 `/reviews/reply/{reviewId}`, 라우트 **무변경**).
제목만 「답변 작업」 → **「리뷰 처리」**로 바뀐다: 이 화면의 질문이 「이 문장을 승인할까」에서
「이 리뷰를 어떻게 할까」로 넓어졌기 때문이다.

1. **고객이 남긴 내용** — 고객의 문장이 **이 페이지에서 가장 큰 활자**다(`lg`). 이전에는 접혀 있었다.
2. **왜 여기 있는가** — tier chip · AI 마크 · `triage.reason` · `recommendedAction`. 접는 것은
   **키워드 자동 분류 하나뿐**이고, 접는 이유는 그 정확도가 측정된 적이 없다는 것이며 disclosure가 그렇게 말한다.
3. **반복 신호** — 이 리뷰가 근거로 기록된 반복 문제, 각 문제의 **org 전체 근거 수**, 그리고 **같은 문제를
   말한 다른 리뷰**(인용은 read time 마스킹, 최대 3건/문제, 최대 3문제). 「근거 전체 보기」는
   `/memory/{issueId}`.
4. **이 상품에 대해 우리가 아는 것** — 상품 리뷰/부정 카운트, 등록된 상품 지식·회사 운영 기준 **수**와 제목
   최대 5개, 그리고 **아직 답하지 않은 확인 필요 수**. 그리고 한 줄: 초안이 실제로 무엇을 근거로 썼는지는
   아래 초안의 인용이 말한다.
5. **판매자 판단** — T-07 correction. 시스템 판단 옆에 서고 덮어쓰지 않으며 목록 순서를 바꾸지 않는다.
6. **무엇을 하시겠어요?** — `TriageDisposition` 셋. 아래 한 줄은 **채널을 안다**(답변 가능한 채널이면
   초안이 열린다고, 아니면 열리지 않는다고 말한다). 결정이 서면 **조치 시작함 / 조치 완료함**을 기록할 수 있다.
7. **답변 준비** — `대응 필요`일 때, 그리고 이미 초안·승인이 있을 때. **같은 `VocItemReplyPrep` 패널**이고
   승인 경계·append-only 버전·fingerprint·복사 후 판매자가 직접 등록하는 handoff는 **한 글자도 바뀌지 않았다**.
8. **기록** — 다섯 trail을 합쳐 최신순. 새 저장소 0.

### 1-A. 이 화면이 review 처리의 **canonical mutation surface**다 (product-owner decision, 2026-09-12)

리뷰 기록 화면(`/reviews/{account}`)의 상세 패널은 같은 일을 **전부** 할 수 있었다 — 응답 결정, 답변
초안과 승인, 판매자 자기 tier, 그리고 pilot의 조치 버튼. 전부 동작했고, 전부 **두 번째 방**이었다.
그중 한 방만 「무엇이 반복되는가 · 다른 누가 같은 말을 했는가 · 이 회사가 무엇을 적어 두었는가」를 볼 수
있었고, 다른 방은 볼 수 없었다. 하나의 결정에 방이 둘이면 제품은 답을 둘 갖게 되고 — 그것이
`ACTION_NOT_NEEDED`와 `NO_ACTION`이 같은 문장을 두 벌로 갖고 있던 이유이기도 하다.

그래서 **기록 화면은 기록으로 남는다.** 서 있는 것을 **읽고**(시스템 tier · 판매자 수정 · 처리 상태 ·
채널이 말한 답변 등록 여부) 문 하나(「이 리뷰 처리하기」)를 낸다. 여기서 쓰는 것은 **없다**:
`ReplyWorkControls`(소비자 0이 된 클러스터)는 삭제했고, 조치 기록 컨트롤도 함께 사라졌다 —
`ACTION_NOT_NEEDED`의 이중 경로는 그 삭제로 닫힌다.

---

## 2. 새로 만든 것은 읽기 둘뿐

```
GET /api/seller-accounts/{accountId}/channel-reviews/{reviewId}/decision-context
GET /api/seller-accounts/{accountId}/channel-reviews/{reviewId}/decision-log
```

둘 다 GET · org 범위 · **구조적으로 bounded**이고, 이 컨트롤러에는 **write가 없다**. 워크스페이스가
기록하는 모든 것은 이미 잠금·멱등키·감사 trail을 소유한 기존 라우트로 나간다 — 결정에 두 번째 문을 내면
두 문이 언젠가 서로 다른 말을 한다.

**decision-context**가 읽는 것: 리뷰 1 · 상품 1 · 채널 1 · 이 리뷰의 evidence link · 문제 ≤3 · 문제당
다른 근거 ≤3 · 카운트 4 · 지식 제목 ≤5. **모델 호출 0**이다 — 워크스페이스를 열 때 retrieval을 돌리면
(Retrieval v2: 질문 재작성 1회 + 판정 최대 2회) 아직 아무도 요구하지 않은 문단을 위해 **열 때마다 돈을
쓰게 된다**. 그래서 이 블록은 **라이브러리에 무엇이 있는가**만 답하고, **초안이 무엇 위에 섰는가**는
초안 자신의 인용(`ReviewReplyPrepView.draftEvidence`)이 답한다.

**decision-log**가 읽는 것: `review_triage_correction_audit` · `review_triage_audit` ·
`review_triage_actions` · `review_reply_approval_audit` · `review_reply_outcomes`. 전부 append-only이고
전부 이미 쓰이고 있었다. **그래서 새로고침이 아무것도 잃지 않는다** — 이 화면의 상태는 처음부터 브라우저에
산 적이 없다.

---

## 3. 제품 결정 — §5-C가 남겨 둔 것을 여기서 정한다

Review Triage Contract v1 §5-C는 이렇게 적어 두었다: 「조치 시작·완료·불필요 버튼은 pilot 뒤에 그대로
둔다 … **Recommended Action / Decision Workspace 작업 때 다시 정한다**」. 그 결정을 여기서 한다.

| 결정 | 내용 | 근거 |
|---|---|---|
| **조치 선택 = `TriageDisposition`** | 새 action enum을 만들지 않는다. 세 값·세 단어·같은 엔드포인트·같은 감사 trail 그대로 | 이 저장소가 「사람이 내린, 바뀔 수 있고 답변 가능해야 하는 결정」에 이미 쓰는 모양이다. 네 번째 taxonomy는 drift한다 |
| **낱말도 그대로** | 「대응 필요 / 지켜보기 / 조치 불필요」 유지. 워크스페이스가 더하는 것은 **버튼 아래 한 줄**이고 그 줄만 채널을 안다 | 이름을 바꾸면 작업 큐·기록·감사 trail이 같은 값을 다른 말로 부른다 |
| **완료 기록은 둘** | `ACTION_STARTED` · `ACTION_COMPLETED`. **`ACTION_NOT_NEEDED`는 넣지 않는다** | 그 진술은 바로 위 단계가 `NO_ACTION`으로 이미 기록한다. 한 번의 press가 두 spine에 두 강도로 들어가는 것이 §5-C가 금지한 바로 그 모양이다 |
| **조치 기록의 pilot 게이트 해제** | 워크스페이스에서는 AI pilot 여부와 무관하게 기록할 수 있다 | T-07이 correction에 대해 한 것과 같은 논증이다 — 판매자가 자기가 한 일을 적는 것은 pilot의 것이 아니다. 기록 화면의 pilot 컨트롤은 **무변경** |
| **`NO_ACTION`에는 완료 버튼 없음** | 결정 자체가 결론이므로 더 보고할 것이 없다 | 없는 일의 완료를 기록하게 두지 않는다 |

### 3-1. 결함 하나를 찾아 고쳤다 — **판단과 답변은 다른 능력인데 주소가 하나였다**

`TriageDisposition`은 자기 계약에 이렇게 적고 있다: 「`RESPONSE_NEEDED`를 기록한다고 해서 아무것도
초안되거나 큐에 들어가거나 전송되거나 약속되지 않는다」. 그리고 `ReviewTriageService.decide()`는 **채널
capability를 전혀 보지 않는다** — org + 계정 + 채널로만 인가한다.

그런데 리뷰 단위 화면이 얻을 수 있는 유일한 `actionRef`는 `ReviewReplyWorkLookup`이 주는 것이었고, 그것은
**답변 flow가 있는 채널에만** 발급된다. 결과: **쿠팡 상품평에는 판단을 기록할 수 있는 컨트롤이 화면에
존재할 수 없었다.** 엔드포인트는 처음부터 받아 줬고, 막혀 있던 것은 **주소**뿐이다.

수정은 `decision-context`가 `decisionRef`(`review:<uuid>`, 서버가 mint)를 **워크스페이스가 열 수 있는 모든
리뷰에** 돌려주는 것이다. 클라이언트는 여전히 ref를 만들지 않고 round-trip만 한다. 답변 lane이 있는
채널에서는 그 lane의 ref가 같은 결정을 가리키므로, **context 읽기가 실패해도 판단 능력은 잃지 않는다**
(맥락만 잃는다).

---

## 4. 하지 않은 것

- **새 Customer Timeline · Opportunity Engine · multi-agent — 0.** 반복 신호는 기존 issue memory를 읽는다.
- **새 유사도 판정 — 0.** 「비슷한 리뷰」는 **추출기가 이미 같은 문제의 근거로 묶은 리뷰**뿐이다. 이 저장소의
  유사도 메커니즘은 aspect+problem signature 하나이고, 워크스페이스를 위해 두 번째를 만드는 것은 아무도
  측정하지 않은 classifier가 판매자의 읽는 순서를 정하게 하는 일이다.
- **근거 없는 count 생성 — 0.** `evidenceCount`는 read가 돌려준 org 전체 수 그대로다. 「N번째」·추세·상품
  단위 분모는 만들지 않는다.
- **AI 판단 overwrite — 0.** 시스템 tier는 여전히 read time 계산이고, correction은 옆에 선다.
  `FINAL_TIER_RANK`는 correction 테이블을 읽지 않는다.
- **승인 경계 변경 — 0.** 초안·승인·fingerprint·복사·판매자 직접 등록 handoff 전부 그대로.
- **marketplace execution 확장 — 0.**
- **Aside / NAVER acquisition — 무변경.** `feat/aside-integration-v1`은 그대로 보존돼 있다.

---

## 5. 리팩터 — 사본을 늘리지 않으려고 넷을 끌어올리고 하나를 지웠다

| 옮긴 것 | 어디서 → 어디로 | 이유 |
|---|---|---|
| `SellerCorrectionControls` | `ChannelReviews.tsx` 내부 함수 → `components/reviews/SellerCorrectionControls.tsx` | 워크스페이스도 같은 질문을 한다. 두 번째 사본은 오늘만 일치한다 |
| `TriageTierChip` · `AiMarkChip` | 같음 → `components/reviews/TriageTierChip.tsx` | 같은 이유. chip 색이 두 화면에서 갈라지지 않는다 |
| `ChannelAnsweredState` | `ReplyWorkControls.tsx` → `components/reviews/ChannelAnsweredState.tsx` | 워크스페이스도 「판단 전에」 이 사실을 말해야 한다 |
| `reviewWord` | `ChannelReviews.tsx` → `lib/channelVocabulary.ts` | 워크스페이스가 리뷰를 여섯 군데에서 부른다. 한 화면이 쿠팡 행을 상품평이라 부르고 그 화면이 링크한 화면이 리뷰라 부르는 일을 막는다 |
| `IssueEvidenceQuote` | `ReviewIssueQueryService` private → `reviewissue/IssueEvidenceQuote.java` | **마스킹 규칙**의 두 번째 사본은 규칙이 바뀔 때 잊히는 쪽이다 |
| `ReplyWorkControls` | **삭제** | 소비자가 사라진 클러스터를 초록 테스트를 단 죽은 코드로 남기지 않는다(`VocItemCard` 때와 같은 처분) |

---

## 6. 검증

- backend **3,942 tests · 실패 0** (신규 `ReviewDecisionWorkspaceServiceTest` 9건 포함)
- frontend **239 files / 2,822 tests · 실패 0** · `tsc --noEmit` clean
- 신규/재작성 프런트 테스트: `ReviewReplyTask.test.tsx` **30건**, `lib/reviewDecision.test.ts` 4건
- axe: 1440 / 1366 / 1152 **전 폭 위반 0**(반복 신호·지식·판단·조치·초안·기록이 모두 렌더된 상태)

### 6-A. 로컬 브라우저 QA — 실제 Demo Org (2026-09-12)

커넥터 **전부 OFF** · 스케줄러 OFF · 프로액티브 OFF · 시딩 OFF로 기동한 스택. **off-host 요청 0 ·
콘솔 오류 0 · 백엔드 로그의 채널 호출 0.**

| 항목 | 관측 |
|---|---|
| Queue → Workspace | 내 답변 작업 9행이 전부 `/reviews/reply/{id}`; 기록 상세의 문 1개로 정확한 워크스페이스 도착 |
| 기록 상세 mutation 제거 | 판매자 판단 블록 **0** · 조치 기록 블록 **0** · 대응 필요 버튼 **0** · 승인 **0** · 문 **1** |
| 1 · 2 무엇이 문제인가 | 고객 문장이 페이지에서 **가장 큰 활자**(18px) — 「접착력은 별로에요ㅠㅠ 자꾸 떨어져요..」, tier 칩 지켜보기 + 이유 문장이 접히지 않고 그 옆에 |
| 3 반복 신호 | 「접착 탈락 · 심각도 보통 · 근거 7건」 + 다른 리뷰 **3건**을 인용·날짜·별점과 함께 |
| 4 상품·지식 | 리뷰 1,761 · 부정 3 · 등록된 상품 지식 3 · 회사 운영 기준 2 · 제목 3개 · **아직 답하지 않은 확인 필요 1건** |
| 5 판매자 판단 | 확인 필요 기록 → 「시스템 판단 지켜보기 · 판매자 수정 확인 필요」가 **나란히** |
| 6 조치 선택 | 대응 필요 기록 → 조치 시작함/완료함 등장 → 조치 완료함 기록 |
| 7 조치에 맞는 초안 | 대응 필요 **이후에만** 답변 준비가 마운트되고 템플릿 초안·「AI 초안 준비」·「초안 저장」이 보인다 |
| 8 기록 | 3건, 최신순 — 조치 완료 → 조치 대응 필요 → 판매자 판단 확인 필요 |
| 새로고침 | 판단·조치·초안 섹션·기록 3건 **그대로**(브라우저에 산 적이 없다) |
| 폭 | 1440 / 1366 / 1152 — 가로 스크롤 0 · axe 0 |

**답변 flow가 없는 채널에서도 판단할 수 있다는 것이 라이브로 확인됐다** — 쿠팡 상품평 하나에서
판매자 판단 3버튼과 조치 3버튼이 모두 서고, 「이 채널에서는 reviewnary가 답변을 작성하지 않습니다」가
그 아래 서며, 답변 준비 섹션은 렌더되지 않는다. 이 화면에는 그 전까지 **판단 컨트롤 자체가 없었다**.

QA가 쓴 행은 리뷰 **하나**에 대해 넷이다 — correction 1 · correction_audit 1 · triage 1 · action 1.
초안 **0** · 승인 **0** · 마켓플레이스 **0**.

## 7. 고치지 않고 보고하는 것

- **`ACTION_NOT_NEEDED`는 아직 살아 있다** — `TriageActionKind`에 남아 있고 과거 행도 남아 있으며, 기록
  화면에서 그것을 쓰던 컨트롤만 사라졌다. enum 값을 지우는 것은 이미 기록된 행의 의미를 바꾸는 일이라 하지
  않았다. 오늘 그 값을 쓰는 production caller는 **0**이다.
- **내 답변 작업 큐는 여전히 기록 화면 안에 있다.** 큐 행은 워크스페이스를 열지만, 큐 자체의 자리를 옮기는 것은
  IA 결정이라 이 패키지가 하지 않았다.
- **tier 낱말이 한 화면에 두 번 나온다** — 위의 chip(왜 이 리뷰가 여기 있는가)과 판매자 판단 블록의
  「시스템 판단 [참고]」(무엇에 동의/반대하는가). 두 번째를 지우면 대조가 읽히지 않으므로 **의도적으로 남긴다**.
- **`decision-context`는 read 약 10회다.** 전부 bounded이고 판매자 데이터가 늘어도 커지지 않지만, 한 번의
  조회로 합치지는 않았다 — 합치려면 기록 화면의 상세 read와 계약을 공유해야 하고 그것은 다른 패키지다.
- **반복 신호는 추출기만큼만 참이다.** 부정문 오탐(`Auth Entry Regression Closure + Opportunity Engine v1`이
  이미 보고)이 남아 있고, 워크스페이스는 그것을 고치지도 숨기지도 않는다.
- **`ACTION_NOT_NEEDED`를 쓰는 pilot 컨트롤은 기록 화면에 그대로 있다.** 워크스페이스에서만 빼는 결정이라,
  같은 org에서 두 경로가 서로 다른 것을 쓴다. 통합은 pilot 컨트롤 자체를 정리할 때다.
- **라이브 브라우저 QA 미실행.** 이 패키지는 오프라인(vitest + axe) 검증까지다.
- **저장소 규칙 충돌**: `frontend/CLAUDE.md`가 그 workstream에 금지한 `backend/**` 수정을 했다
  (product-owner 지시, conflict priority 1). **전부 읽기 전용**이다 — 새 쿼리 넷, 새 read 서비스 하나,
  새 GET 컨트롤러 하나. state semantics 변경 0 · write 0 · 마이그레이션 0.
