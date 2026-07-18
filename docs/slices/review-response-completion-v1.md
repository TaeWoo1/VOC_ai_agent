# Program Contract — Review Response Completion v1 (가이드형 NAVER Action Window 답변 제출)

> Status: **IN PROGRESS, UNCOMMITTED, OFFLINE. 라이브 게이트 잠금.** 승인된 답변 준비(PR #284/#286)
> 위에 **가이드형·사람 수행 답변 제출**을 얹는 프로그램. 4개 워크트리(AW 계약 · R4 런타임 · 백엔드 · FE) +
> 거버넌스 문서에 걸치는 **프로그램**이며 슬라이스가 아니다. 현재까지: **Phase 2(계약 v2) 구현·검증 완료**,
> **Phase 1(거버넌스/범위 문서) 완료**, Phase 4(백엔드)/Phase 3(런타임)/Phase 5(FE) 진행 예정. 아무것도
> 커밋되지 않음.
>
> 상위 계약: 범위 `docs/product-scope-v1.md` §5·§9(**v1.6** 잠금), 안전 경계 `docs/action-window-runtime/
> r4-preparation.md` §4.1 + ADR `docs/sellerops_local_agent_runtime_adr.md` §4, 능력표 roadmap §4.1,
> 거버넌스 `docs/action-window-runtime/decisions.md` D-032 + `r4-gate-record.md`(6번째 G3 스코프 + G6 템플릿),
> 계약 `contracts/action-window/v2/`. 본 문서는 **프로그램 실행 계약**을 소유하며 그들의 결정을 중복 선언하지
> 않는다.
>
> **정직성 경계.** SellerOps는 **쓰지·입력하지·제출하지 않는다.** 판매자가 답변을 작성·붙여넣고 직접
> 제출하며, 런타임은 답변란을 **하이라이트하고 관찰만** 한다. **검증 없음** — NAVER REVIEW 공식 API가 없고
> export에 답변 상태가 없어 게시 여부를 확인할 수 없으며 제품은 이를 암시하지 않는다. 결과는 **운영자 보고 +
> 명시적 UNVERIFIED**로만 기록하고 **절대 "완료"/채널 주장 아님**. `발송/전송/등록` 라벨 금지. 라이브 접속·
> 자격증명·게이트 소비 없음.
>
> **`RESPONSE_NEEDED`·승인은 여전히 아무것도 약속하지 않는다.** 제출 준비는 운영자가 명시적으로 시작할
> 때만 시작된다. `TriageDisposition`("does not draft, queue, send")과 `ReviewReplyApprovalState`(a decision,
> not a workflow phase)는 이 프로그램 이후에도 문자 그대로 참이며, 승인은 **취소 가능**을 유지한다(결과 기록이
> 승인을 소비하지 않는다).

## Goal

승인된 리뷰 답변에서 시작해, 운영자가 SellerOps의 **가이드**를 받아 NAVER 판매자센터에 **직접** 답변을
등록하고, SellerOps가 **로컬·운영자 보고·미검증** 결과를 리뷰 옆에 기록한다 — 마켓 제출은 **엄격히 수동**.

## 확정된 제품 오너 결정 (재론 금지)

| 축 | 결정 |
|---|---|
| 제출 행동 | **판매자 제출, 런타임 관찰 전용**(제로 클릭). 런타임은 창 foreground + 답변란 read-only 하이라이트 + `USER_ACTION_OBSERVED` 기록. 타이핑·제출 클릭 없음. |
| 계약 버전 | **병렬 `contracts/action-window/v2/`**(protocol 2). v1 불변, 기존 v1 export 실행 기록 마이그레이션 없음. |
| 완료 의미 | **`COMPLETED` 없음, read-back 없는 유사 검증 없음.** 종단 = `OPERATOR_REPORTED`. |
| 결과 기록 | **보고와 검증 분리**: `operatorOutcome ∈ {OPERATOR_REPORTED_SUBMITTED, SUBMISSION_ABORTED}` + `verification = UNVERIFIED`. UI는 **항상 쌍** 표기, `UNVERIFIED` 단독 금지. |
| 재시도 | `submissionRef` **1회용**; 보고된 제출 후 재시도는 새 발급(승인 head 재확인). 자동 재구동 금지. |
| 감사 위치 | **백엔드 리뷰 귀속**(V20), UNVERIFIED, AW-run ref 참조, append-only. 승인은 취소 가능 유지. |
| 배송 | **단계별 거버넌스 PR**, G4 합성 사다리까지 구현 가능. 라이브는 게이트 잠금(6번째 G3 스코프 + 1회용 G6, 미부여). |
| 런타임 격리 | **분리된 v2 엔진/드라이버.** 감사되는 v1 export 런타임 + 영속 run store는 **불변**. |

## 단계 (governed PR, worktree 경계 배타)

1. **거버넌스/범위 PR** — scope v1.6, r4-preparation §4.1 + ADR §4, roadmap §4.1, D-032(6번째 G3 스코프 +
   G6 템플릿), 본 문서. *코드 없음.* **[Phase 1 — 완료(작업 트리)]**
2. **계약 v2 PR** — `contracts/action-window/v2/`(enum·payload·terminal·event·validator·schema·v2 기계
   일관성 테스트). v1 편집 없음, 영속 run 마이그레이션 없음. **[Phase 2 — 구현·검증 완료: `contract-v2.test.ts`
   68 통과; v1 55 통과 유지]**
3. **런타임 PR** — 분리된 v2 `REPLY_SUBMISSION` 엔진/드라이버(`NaverReplySubmitProbeDriver`: detect/validate/
   ingest 없음, verifier 없음, 타이핑·제출 클릭 없음), 합성 사다리 + source-guard/privacy 테스트. **오프라인.**
   감사되는 v1 런타임·store 불변. **[Phase 3 — 예정]**
4. **백엔드 PR** — `submissionRef` 발급(1회용, 바인딩), `V20 review_reply_outcome`(operator_outcome +
   verification 분리 컬럼, `unique(submission_ref)`, `unique(org_id,command_id)`, COMPLETED 값 없음),
   `ReviewReplyOutcomeWriter` + `ReviewReplyService.recordSubmissionReported`, capability, DTO, 테스트.
   `ReviewReplyApprovalWriter/Service` 패턴 정확 미러. **[Phase 4 — 예정]**
5. **FE PR** — 리뷰→run 핸드오프, v2 소비, NAVER 채널 라벨 + 제출 카피, 운영자 보고 종단 컴포넌트(항상
   outcome+verification 쌍), §10.2/§18 스펙 개정, 테스트. **[Phase 5 — 예정]**

## Explicit exclusions (non-goals)

- SellerOps의 쓰기·타이핑·제출·제출 클릭 없음. 무인/스케줄 실행 없음.
- 리뷰 run의 `COMPLETED` 없음. 검증 주장 없음. read-back 없는 로컬 유사 검증 없음.
- AW 와이어·런타임 영속에 답변 텍스트 없음(`PROHIBITED_KEYS`).
- 라이브 NAVER 접속·자격증명·게이트 소비 없음. 라이브는 별개·미부여.
- `contracts/action-window/v1/` 변경 없음, 영속 v1 run 재작성 없음.
- 종단은 항상 쌍(outcome + verification), `UNVERIFIED` 단독 없음.
- 새 `TriageDisposition` 값 없음; 승인 취소 가능 유지; phase machine 없음.
- attention 카운트·심각도·랭킹 변경 없음. NAVER 전용.

## Acceptance criteria

- **계약 v2:** 기계 일관성(schema↔TS, 신규 3 enum 포함); `REPLY_SUBMISSION`은 opaque `submissionRef` 요구,
  EXPORT는 금지; `SUBMISSION_REPORTED`는 operatorOutcome+verification 둘 다 요구; `RUN_OPERATOR_REPORTED`는
  status=OPERATOR_REPORTED(≠COMPLETED); `VERIFICATION_STATES`에 VERIFIED 부재; v1→v2 버전 거부.
- **런타임(합성):** 관찰 ≠ 완료; 운영자 보고 → `OPERATOR_REPORTED`, `COMPLETED` 도달 불가; 이중 제출 없음
  (resume 시 재구동 금지); source-guard가 타이핑/제출 클릭/텍스트 영속 부재 증명; v1 export 경로·store 회귀
  없음.
- **백엔드:** 게이트 비대칭(비-RESPONSE_NEEDED에서 기록 거부, 승인 해제는 허용); spent `submissionRef` 재사용
  거부; 멱등(같은 command → replay); 동시성; outcome view는 body·채널 주장 없이 두 사실 반환.
- **FE:** 게이트된 가이드 어피던스; 종단이 쌍 표기(never UNVERIFIED 단독, never 완료/발송/전송/등록);
  `pages-copy`/`channelSupport`/§10.2 라벨 검사 통과.

## Validation commands (offline)

```bash
# Phase 3 전 필수: 의존성 설치 + 전체 타입체크 + v1/v2 테스트
cd collector && npm ci && npm run typecheck && npm test

# 백엔드 (Phase 4)
cd backend && ./gradlew test

# 프론트 (Phase 5)
cd frontend && npm ci && npm run typecheck && npm test && npm run build
```

라이브 실행은 이 문서 범위 밖 — 6번째 G3 스코프 `reply submission` 인스턴스 + 1회용 G6를 dispatch 턴에
채워야 하며, 어느 것도 존재하지 않는다.
