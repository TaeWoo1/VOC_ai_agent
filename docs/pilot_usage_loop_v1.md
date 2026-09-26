# Pilot Usage Loop v1 — 계측 감사와 측정 계약

Status: **offline audit + measurement contract** (2026-08-26). 선행: `docs/proactive_operations_agent_v1.md`
(Proactive Operations Agent v1 = LIVE_GREEN / CLOSED, 증거 `docs/evidence/proactive_operations_agent_live_tick_v1.md`).
이 문서가 소유하는 것: **파일럿에서 무엇을 성공으로 셀 것인가**, 그 숫자가 어느 행에서 나오는가,
그리고 무엇을 세지 않기로 했는가.

**코드 변경: 없음.** 이 유닛은 새 이벤트 스트림도, 새 analytics system도, 새 테이블도 만들지 않는다.
감사 결과 열한 개 지표가 전부 이미 있는 행에서 계산된다 — 아래 §2가 그 계산식이다.

---

## 1. 감사 — 이미 있는 계측

| 필요한 사실 | 어디에 있나 | 쓰는 사람 |
|---|---|---|
| proactive candidate 준비됨 | `proactive_case` 행의 존재 + `created_at` | reconciler(유일한 writer) |
| surfaced | `proactive_case.surfaced_at` | `ProactiveCaseService.list` — 카드가 실제로 렌더된 순간 |
| opened | `proactive_case.opened_at` | `POST /api/proactive/cases/{id}/opened` — [확인하기] 클릭에서만 |
| 준비된 초안 | `proactive_case.prepared_action='DRAFT_PREPARED'` + `draft_version` | investigator |
| 초안 저자 | `inquiry_reply_draft.author_kind` (`MODEL`/`RULE`/`SELLER`/`SELLER_APPROVED_FALLBACK`) + `content_fingerprint` | append-only, 버전마다 한 행 |
| 판매자 수정 | 같은 work item의 **다음 버전**이 `author_kind='SELLER'` | `PUT /draft` |
| 승인 | `inquiry_approval(approved_draft_version, approved_fingerprint, approver, created_at)` | work item당 유니크 1행 |
| 전송 시도 | `inquiry_execution(status, created_at)` | `InquiryPublishService` |
| VERIFIED | `inquiry_verification(verified=true)` → work item phase `COMPLETED` | 재조회 1회로만 |
| 상태 미확정 | `inquiry_verification.observed_status='ANSWER_POSTED_STATUS_UNRESOLVED'` | Cafe24 adapter |
| 리뷰 쪽 행동 | `review_triage_actions`(`REPLY_DRAFTED`/`REPLY_SUBMITTED` 등), `review_reply_outcome` | 기존 triage pilot funnel |
| 판매자 행동 일자 | `inquiry_work_item_audit.actor like 'SELLER:%'` + `created_at` | 모든 승인·제안 경로 |

**조인 키는 이미 있다.** `proactive_case.work_item_id`가 문의 lifecycle 전체(`inquiry_approval` ·
`inquiry_execution` · `inquiry_verification` · `inquiry_work_item_audit`)로 가는 외래키이고,
`subject_id`가 리뷰 쪽(`review_triage_actions` · `review_reply_*`)으로 가는 키다. V75의 주석이
이미 그렇게 적어 두었다 — "Everything after the seller acts … is already recorded on
inquiry_work_item_audit / inquiry_execution / inquiry_verification and is not copied here."

**프론트 analytics**(`frontend/src/lib/analytics/`)에는 `proactive_cases_viewed` ·
`proactive_case_opened{kind}` 두 이벤트가 있고 PII allow-list를 지난다. 그러나 이것은 **vendor sink**
(GTM/PostHog)로만 가고 배포자가 키를 넣지 않으면 아무 데도 도착하지 않는다. 따라서 **파일럿 KPI의
출처는 DB이고, analytics 이벤트는 보조**다. 둘이 어긋나면 DB가 맞다.

## 2. 지표 정의 — 전부 하나의 읽기

아래 네 블록은 로컬 DB에서 **실행 검증**했다(2026-08-26). 파일럿 코호트는
`where c.org_id = any(:pilot_org_ids)`로 좁힌다(§4).

### A. proactive usefulness

```sql
select c.org_id,
       count(*)                                    as prepared,
       count(c.surfaced_at)                        as surfaced,
       count(c.opened_at)                          as opened,
       count(*) filter (where c.status = 'ACTED')  as acted,
       count(*) filter (where c.status = 'CLOSED') as closed_unacted,
       count(v.hit)                                as verified
from proactive_case c
left join lateral (select 1 as hit from inquiry_verification v
                   where v.work_item_id = c.work_item_id and v.verified limit 1) v on true
group by c.org_id;
```

비율 셋: `opened/surfaced` · `acted/opened` · `verified/surfaced`.

### B. draft usefulness

AI 초안을 **그대로 승인**했는지 **고쳐서 승인**했는지는 승인된 버전의 저자로 갈린다.
`inquiry_reply_draft`가 append-only이기 때문에 이 판정에 새 칸이 필요 없다.

```sql
select count(*) filter (where c.prepared_action = 'DRAFT_PREPARED')                    as drafts_prepared,
       count(*) filter (where a.id is not null and ad.author_kind = 'MODEL')           as approved_unchanged,
       count(*) filter (where a.id is not null and ad.author_kind = 'SELLER'
                          and ad.content_fingerprint <> pd.content_fingerprint)        as approved_edited,
       count(*) filter (where a.id is not null and ad.author_kind = 'SELLER'
                          and ad.content_fingerprint = pd.content_fingerprint)         as approved_same_text,
       count(*) filter (where a.id is not null
                          and ad.author_kind = 'SELLER_APPROVED_FALLBACK')             as approved_deferral,
       count(*) filter (where c.status = 'PREPARED' and a.id is null)                  as pending,
       count(*) filter (where c.status = 'CLOSED'  and a.id is null)                   as abandoned
from proactive_case c
left join inquiry_reply_draft pd on pd.work_item_id = c.work_item_id and pd.version = c.draft_version
left join inquiry_approval    a  on a.work_item_id  = c.work_item_id
left join inquiry_reply_draft ad on ad.work_item_id = c.work_item_id
                                and ad.version = a.approved_draft_version
where c.subject_kind = 'INQUIRY';
```

세 가지가 서로 다른 사실이고 합치면 거짓말이 된다:

- **`approved_unchanged`** — 승인된 버전을 **모델이** 썼다. AI 초안이 그대로 나갔다.
- **`approved_edited`** — 판매자가 다음 버전을 저장했고 지문이 달라졌다. 초안은 출발점이었다.
- **`approved_same_text`** — 판매자 버전인데 지문이 초안과 같다. 다시 저장했을 뿐 내용은 그대로다.
  **`approved_unchanged`에 합산하지 않는다** — 채택률을 높이는 쪽으로 반올림하는 일이기 때문이다.
- **`pending`은 `abandoned`가 아니다.** 아직 열려 있는 카드는 판매자가 버린 것이 아니라 아직 하지
  않은 것이다. 포기는 케이스가 **닫혔는데** 승인이 없는 경우로만 센다.

`author_kind`가 null인 옛 행은 `SELLER`로 읽는다(Inquiry Draft v1 이전 행 — 전부 사람이 썼다).

#### `SELLER_APPROVED_FALLBACK`은 AI 초안이 아니다 (2026-08-27 정정)

Organization Answer Style v1이 author kind를 하나 늘렸다. `NO_ANSWER_BASIS`에서 판매자가 등록해 둔
「답을 모를 때 사용할 문구」가 있으면 그 문장이 **한 글자도 바뀌지 않고** 초안 버전으로 저장된다 —
**모델 호출 0**이고, 문장은 판매자 자신의 것이다.

원래 술어는 `author_kind <> 'SELLER'`였고, 그 조건은 이 행을 **`approved_unchanged`로 셌다**. 그러면
「AI가 쓴 답변을 판매자가 그대로 승인했다」는 숫자에 **AI가 쓰지 않은 문장**이 들어간다 — 그리고 그것은
채택률을 올리는 쪽으로 틀리는 종류의 오류다. 지금 술어는 `= 'MODEL'`이다.

- **분자에서 제외** — `approved_unchanged`·`approved_edited` 어디에도 넣지 않는다.
- **분모에서도 제외** — 「AI 초안 채택률」의 분모는 *모델이 쓴 초안*이고, 유예 문구는 그 모집단이
  아니다. `drafts_prepared`는 `prepared_action='DRAFT_PREPARED'`를 세므로 이 행이 준비된 케이스는
  분모에 남는데, 그 자리는 **`approved_deferral`**이 받는다: 준비는 됐고 채택 대상은 아니었다.
- **별도로 센다** — `approved_deferral`은 실패도 성공도 아니다. 「답할 근거가 없어서 회사가 정해 둔
  문장으로 유예했다」는 사실이고, 파일럿에서 그 빈도는 *지식이 얼마나 비어 있는가*의 지표이지
  *AI가 얼마나 쓸모 있는가*의 지표가 아니다.

`RULE`도 같은 이유로 `approved_unchanged`에서 빠진다 — 결정론적 fallback drafter는 2026-08-26에
생산자가 사라졌으므로 새 행은 생기지 않지만, 옛 행이 모델 채택률에 섞이면 그 역시 같은 방향의 거짓말이다.

**코드 변경 0.** 이 지표들은 전부 문서의 SQL이고, production 코드에서 `author_kind`를 읽어 채택률을
계산하는 곳은 감사 결과 **없다**(`InquiryReplyDraftService`가 쓰고, `ReplyDraftView`가 그대로 실어
보낼 뿐이다).

### C. speed

```sql
select percentile_cont(0.5) within group (order by extract(epoch from c.opened_at - c.surfaced_at))
         filter (where c.opened_at is not null)  as surfaced_to_opened,
       percentile_cont(0.5) within group (order by extract(epoch from c.acted_at  - c.surfaced_at))
         filter (where c.acted_at  is not null)  as surfaced_to_action,
       percentile_cont(0.5) within group (order by extract(epoch from v.at - c.surfaced_at))
         filter (where v.at is not null)         as surfaced_to_verified
from proactive_case c
left join lateral (select min(v.created_at) as at from inquiry_verification v
                   where v.work_item_id = c.work_item_id and v.verified) v on true;
```

**중앙값이고 평균이 아니다** — 판매자가 2주 방치한 한 건이 평균을 소설로 만든다.
기준점은 `created_at`이 아니라 **`surfaced_at`**이다: 판매자가 볼 수 없었던 시간을 판매자의
반응 시간에 넣으면 야간에 준비된 카드가 전부 느린 판매자로 기록된다.

### D. repeat usage

```sql
select org_id, count(distinct day) as active_days
from (
  select org_id, (created_at at time zone 'Asia/Seoul')::date as day
    from inquiry_work_item_audit where actor like 'SELLER:%'
  union all
  select org_id, (created_at at time zone 'Asia/Seoul')::date from inquiry_reply_draft where created_by like 'SELLER:%'
  union all
  select org_id, (created_at at time zone 'Asia/Seoul')::date from review_reply_draft  where created_by like 'SELLER:%'
  union all
  select org_id, (created_at at time zone 'Asia/Seoul')::date from review_triage_actions
) d group by org_id;
```

**proactive를 확인한 날**은 따로: `select count(distinct (opened_at at time zone 'Asia/Seoul')::date)`.

정의를 좁힌다 — **active day = 그날 운영상 무언가를 한 날**이지 로그인한 날이 아니다. 서버에는
로그인/세션 기록이 없고(§5의 알려진 한계), 그것을 만드는 것은 이 유닛이 하지 않기로 한 일이다.
읽기만 하고 아무것도 안 한 날은 PostHog `today_inbox_viewed`로만 보이며 sink가 꺼져 있으면 보이지 않는다.

## 3. opened 의미 — 이미 맞게 되어 있다

`opened_at`은 카드의 [확인하기] `onClick`에서만 기록된다(`ProactiveCases.tsx`). 렌더는
`surfaced_at`만 만들고, background probe는 없으며, 서버는 **첫 열람만** 남긴다(두 번째 방문은
`opened_at`을 덮어쓰지 않는다) — "얼마 만에 봤나"가 질문이고 "마지막으로 언제 또 봤나"는 다른
질문이기 때문이다. §2가 요구한 세 가지 오염원 중 코드로 막을 수 있는 둘은 막혀 있다.

**막히지 않은 하나: 자동 브라우저.** LIVE_GREEN 증명에서 `surfaced_at`을 실제로 기록한 것은 판매자가
아니라 **관측용 Playwright 세션**이었다. 코드가 구별할 수 있는 사실이 아니므로 코호트로 막는다(§4).
그때 [확인하기]를 **일부러 누르지 않았고** 그래서 `opened_at`은 지금도 null이다 — 그 규율이 이
지표를 믿을 수 있게 하는 유일한 장치다.

## 4. 코호트 — 테스트/데모 트래픽 제외

`organizations`에는 데모 표시 칸이 없고 **만들지 않는다**. 측정 대상은 제품 상태가 아니라 질의의
파라미터다.

- **파일럿 코호트 = 명시적 org id 목록**(`sellerops.proactive.org-ids`와 같은 모양, 제품 밖에서 관리).
- **canonical Demo Org `7146c50f-…`는 코호트에 없다.** 그 org의 proactive 케이스 1건, surfaced 1건은
  전부 제품 검증 산물이다.
- 합성 행은 이미 `DataOrigin`으로 갈린다(`REAL` 외 제외). 다만 **`a3674`는 `REAL`이다** — 판매자가
  스토어프론트에 직접 쓴 진짜 문의이므로 origin으로는 걸러지지 않는다. 코호트 제외가 그것을 덮는다.
- 기술 증명과 판매자 행동은 같은 표에 올리지 않는다.

## 5. 핵심 KPI — 그리고 KPI가 아닌 것

| | 지표 | 성공의 의미 |
|---|---|---|
| 1 | `opened / surfaced` | 먼저 꺼내 준 일이 볼 만한 일이었나 |
| 2 | `acted / opened` | 열어 본 뒤 실제로 처리로 이어졌나 |
| 3 | `verified / surfaced` | **끝까지 갔나** — 유일한 strong success |
| 4 | `approved_unchanged / drafts_prepared` | 초안을 그대로 쓸 수 있었나 |
| 5 | `surfaced → opened` 중앙값 | 반응 속도 |
| 6 | `surfaced → VERIFIED` 중앙값 | 한 건이 끝나는 데 걸리는 시간 |
| 7 | active days | 다시 여는가 |

**KPI로 올리지 않는 것:** Agent 메시지 수, 토큰 사용량, 카드 렌더 수, 준비된 케이스 수 그 자체.
넷 다 판매자가 아무 일도 처리하지 않아도 올라간다. `prepared`는 분모로만 쓰고 성공으로 세지 않는다.

**Agent가 준비했다는 이유로 완료로 세지 않는다.** `ACTED`는 판매자가 work item을 움직였다는
뜻이지 고객이 답을 받았다는 뜻이 아니다. 답이 나간 것은 `EXECUTED`, 확인된 것은 `VERIFIED`뿐이다.

## 6. 인터뷰 질문 — 제품 안에 넣지 않는다

설문 UI를 만들지 않는다. 파일럿 대화에서 묻는다.

1. 이 카드를 안 보여줬으면 직접 확인했을 일인가요? 아니면 몰랐을 일인가요?
2. AI가 조사해 온 것 중 실제로 도움이 된 것은 무엇이었나요?
3. 초안을 그대로 쓸 수 있었나요? 고쳤다면 어디를요?
4. 이 기능 때문에 문의를 확인하는 시간이 줄었나요?
5. 내일도 이 화면을 먼저 보실 것 같은가요?

3번의 답은 §2-B의 `approved_edited`와 대조한다 — 숫자와 말이 어긋나면 숫자가 무엇을 놓쳤는지가
다음 질문이다.

## 7. 알려진 한계

1. **리뷰 lane은 VERIFIED에 도달할 수 없다.** `review_reply_outcome.verification`의 체크 제약이
   `('UNVERIFIED')` 하나다 — 리뷰 답글에는 읽어서 확인할 오라클이 없기 때문이다. 리뷰 케이스는
   `RECOMMENDATION_ONLY`가 천장이고, `verified/surfaced`의 분모에서 리뷰를 빼거나 lane을 나눠 읽는다.
   지금 리뷰 lane은 `NO_FRESH_REVIEW_CANDIDATE`라 관측 자체가 0이다.
2. **일일 예산에 걸려 준비하지 못한 후보는 어디에도 남지 않는다.** tick 로그에만 있고 행이 없다.
   §5의 분모는 전부 `surfaced`이므로 KPI에는 영향이 없지만, "하루 3건이 부족했나"는 로그로만 답한다.
3. **open 횟수는 없다.** 첫 열람만 남는다(v1 KPI에는 충분하다는 결정).
4. **읽기만 한 방문일은 서버에 없다.** 로그인/세션 기록이 없다.
5. **`ANSWER_POSTED_STATUS_UNRESOLVED`는 성공도 실패도 아니다.** 답변은 나갔고 완료 표시만
   미확정이다. `verified`에 넣지 않고, 실패로도 세지 않으며, 별도 칸으로 보고한다.
6. **`inquiries.content_hash`가 비어 있다**(Cafe24 실 문의 전량). 고객이 본문만 고친 경우
   재조사가 트리거되지 않는다 — Proactive v1에서 기록만 하고 고치지 않은 결함이며, 실제 파일럿에서
   관측되면 그때 커넥터 작업으로 내려간다.
7. **analytics sink는 기본 OFF다.** `proactive_case_opened`는 배포자가 GTM/PostHog 키를 넣은
   환경에서만 vendor에 도착한다. KPI는 DB에서 나오므로 파일럿은 sink 없이도 성립한다.

## 8. 이 유닛이 하지 않은 것

새 이벤트 테이블, 새 analytics 추상, `organizations`의 데모 플래그, 로그인 세션 기록,
"AI 채택률" 전용 테이블, dashboard 재설계, proactive architecture 확장. 전부 §1의 감사에서
**기존 행으로 계산 가능**하다는 결론이 났기 때문이다.

---

## 6. 리뷰·판단·반복 문제 lane (2026-09-13 추가)

§1~§5는 **문의 lane**(proactive · 초안 · 전송)의 계약이다. 그 뒤로 Review Decision Workspace ·
Repeated Issue · Operations Home이 생겼고, 사업 가설 다섯 개가 그 lane을 향한다. **코드 변경 0** —
아래는 전부 이미 쓰이고 있는 durable row에 대한 읽기이고, 새 이벤트 스트림도 새 표도 만들지 않는다.

**코호트 규칙은 §4 그대로다** — 아래 모든 질의의 `org_id in (…)`는 명시적 파일럿 org 목록이고
canonical Demo Org는 거기 없다. 아래 숫자는 2026-09-13에 Demo Org로 **실행 검증**한 것이므로
지표가 아니라 질의가 도는지에 대한 증거다.

### 가설과 그것을 답하는 행

| 가설 | 답하는 durable row | 새 계측 필요? |
|---|---|---|
| seller가 NEEDS_ATTENTION을 실제 처리하는가 | `review_triage` × tier 식 | **아니오** |
| seller correction을 남기는가 | `review_triage_correction_audit` | **아니오** |
| decision을 남기는가 | `review_triage_audit` | **아니오** |
| action을 남기는가 | `review_triage_actions` | **아니오** |
| repeated issue를 확인하는가 | `review_issue_state_events` (`actor='OPERATOR'`) | **아니오** |
| **Home을 다시 여는가** | — | **예 — 아래 참조** |

### A. NEEDS_ATTENTION 처리율

```sql
with tiered as (
  select r.id, case
     when r.rating is null then 1
     when r.rating <= 2 and (r.body is null or trim(r.body) = '') then 1
     when r.rating <= 2 then 0
     when r.rating >= 4 then 2 else 1 end as rank
  from reviews r where r.org_id in (:pilot_orgs) and r.data_origin = 'REAL')
select count(*) filter (where t.rank = 0)                                  as needs_attention,
       count(*) filter (where t.rank = 0 and tr.review_id is not null)     as decided
from tiered t left join review_triage tr on tr.review_id = t.id;
```

**tier 식은 `ReviewRepository.TRIAGE_TIER_RANK`의 사본이고 그것이 이 질의의 약점이다** — 제품이
식을 바꾸면 여기도 바꿔야 한다. 대안은 분류를 저장하는 것인데, tier는 리뷰의 read-time 함수이고
저장하면 리뷰가 바뀔 때 낡는 두 번째 사본이 생긴다. 질의 쪽 사본은 사람이 고칠 수 있고 저장된 사본은
조용히 틀린다. (실측 Demo Org: 15 / 3)

### B. 판단을 남기는가

```sql
select 'decision' k, count(*) n, max(created_at)::date last_on from review_triage_audit            where org_id in (:pilot_orgs)
union all select 'correction', count(*), max(decided_at)::date from review_triage_correction_audit where org_id in (:pilot_orgs)
union all select 'action',     count(*), max(acted_at)::date   from review_triage_actions          where org_id in (:pilot_orgs)
union all select 'issue decision', count(*), max(created_at)::date from review_issue_state_events
   where org_id in (:pilot_orgs) and actor = 'OPERATOR';
```

`review_issue_state_events`에서 **`actor='OPERATOR'`가 필수다** — 그 표의 대부분은 추출기가 이슈를
만들 때 쓰는 `SYSTEM/CREATED`이고, 그것을 세면 판매자가 한 일이 아니라 파이프라인이 돈 횟수를 센다.
(실측: 14 / 4 / 3 / 1)

### C. 다시 여는가 — §2-D의 union에 리뷰 lane을 더한다

```sql
select org_id, count(distinct day) as active_days, min(day) as first_day, max(day) as last_day from (
  select org_id, (created_at at time zone 'Asia/Seoul')::date as day from review_triage_audit            where org_id in (:pilot_orgs)
  union all select org_id, (decided_at at time zone 'Asia/Seoul')::date from review_triage_correction_audit where org_id in (:pilot_orgs)
  union all select org_id, (acted_at   at time zone 'Asia/Seoul')::date from review_triage_actions          where org_id in (:pilot_orgs)
  union all select org_id, (created_at at time zone 'Asia/Seoul')::date from review_issue_state_events      where org_id in (:pilot_orgs) and actor = 'OPERATOR'
) d group by org_id;
```

**§2-D의 정의를 그대로 승계한다 — active day는 그날 운영상 무언가를 한 날이지 로그인한 날이 아니다.**
그리고 그 한계도 그대로다: **서버에 로그인/세션 기록이 없다**(`users`에 `last_login_at`이 없고 세션
표도 없다). 읽기만 하고 아무것도 안 한 날은 durable row를 남기지 않는다.

**그 빈칸을 메우는 유일한 기존 경로는 외부 analytics sink**(`today_inbox_viewed` 등)인데
`frontend/src/lib/analytics/`는 **env가 없으면 sink가 없고 `track`은 no-op**이며 sink는 분석 동의
뒤에만 시작한다. 즉 이 문장이 쓰일 당시 **아무것도 측정되지 않았다**.

**2026-09-13 product-owner 결정으로 그 빈칸은 §6-F가 메운다 — 외부 analytics는 쓰지 않는다.**
위 union은 그대로 유효하고(그날 **무언가를 한** 날), §6-F는 그것이 답할 수 없는 것 — **열어서 보기만
한 날** — 만 더한다. 둘은 같은 질문의 다른 절반이라 합치지 않는다.

### D. BYO Aside 없이도 Core를 쓰는가

```sql
select coalesce(j.method, '(no run recorded)') as acquired_by,
       count(distinct r.id)          as reviews,
       count(distinct tr.review_id)  as reviews_decided
from reviews r
  left join sync_jobs j     on j.id = r.acquisition_sync_job_id
  left join review_triage tr on tr.review_id = r.id
where r.org_id in (:pilot_orgs) and r.data_origin = 'REAL'
group by 1 order by 2 desc;
```

가설을 그대로 옮긴 질의다 — **Aside가 가져오지 않은 리뷰에서도 판단이 기록되는가**.
`SELLER_CENTER_EXPORT`가 Aside lane이고 나머지(API · FILE_UPLOAD · 기록 없음)는 아니다.
이 비율이 Aside lane에서만 0이 아니면 Core는 Aside의 부속이다. (실측: 기록 없음 4,494/10 ·
`SELLER_CENTER_EXPORT` 115/3 — 즉 이 org에서는 Aside 밖에서도 쓰이고 있다.)

### F. 다시 여는가 — 열어서 보기만 한 날 (2026-09-13)

**결정: 외부 analytics를 쓰지 않는다. first-party minimal signal 하나만 쓰고, 목적은 Home 재방문
여부 하나다.** 그래서 `home_open_day`(V100)는 칸이 둘이고 **둘 다 기본 키**다.

```sql
create table home_open_day (
    org_id    uuid not null references organizations (id) on delete cascade,
    opened_on date not null,
    primary key (org_id, opened_on)
);
```

**표가 곧 privacy statement다.** user id · IP · user agent · clickstream · referrer · 경로 ·
시각 · 고객이나 판매자가 쓴 글자 — 어느 것도 **넣을 자리가 없다**. 규칙으로 금지한 것이 아니라
없는 칸은 나중에 아무도 자세히 읽지 않은 변경이 채울 수 없기 때문이고, `HomeOpenDayShapeTest`가
엔티티 필드 수 · 마이그레이션 컬럼 수 · 패키지가 그 낱말들을 **언급조차 하지 않는다**를 고정한다.

**같은 org의 같은 날 여러 방문은 한 usage day다** — 질의가 조심해서가 아니라 기본 키가 그렇게
정한다. 화요일에 아홉 번 열면 아홉 번째는 아무것도 쓰지 않으므로, 이 표는 세션도 방문 빈도도 체류
시간도 **표현할 수 없다**. §6-E가 「Home 열람 수 그 자체」를 KPI에서 뺀 것과 모순되지 않는 이유가
그것이다 — 열람 수는 애초에 저장되지 않는다.

날짜는 **Asia/Seoul이고 서버가 정한다**. 브라우저가 말한 날짜는 브라우저가 말한 사실이고, 세는
것은 판매자의 화요일이다.

쓰는 곳은 홈 mount의 `POST /api/usage/home-opened` **하나**이고 본문이 없다 — org는 토큰의 것,
날짜는 서버 시계의 것이라 요청이 누구·언제를 주장할 자리가 없다(그래서 흘릴 것도 없다).
`GET /api/operations/home`의 부수 효과로 두지 않은 이유는 그 GET을 health check·prefetch·재시도·
smoke 스크립트도 지나가기 때문이다 — 그러면 이 저장소 자신의 probe가 판매자의 아침으로 세어진다.
실패는 침묵이고 화면은 측정됐다는 사실을 보이지 않는다.

```sql
-- 파일럿 org별 재방문: 며칠 열었나, 처음·마지막은 언제인가
select org_id, count(*) as usage_days, min(opened_on) as first_day, max(opened_on) as last_day
from home_open_day where org_id in (:pilot_orgs) group by org_id order by usage_days desc;

-- 열기만 한 날 vs 무언가를 한 날 (§6-C의 union과 대조)
select h.org_id, count(*) filter (where d.day is null) as opened_only,
                 count(*) filter (where d.day is not null) as opened_and_acted
from home_open_day h
  left join ( /* §6-C의 union */ ) d on d.org_id = h.org_id and d.day = h.opened_on
where h.org_id in (:pilot_orgs) group by 1;
```

**코호트는 이 표에 없다** — §4 그대로 명시적 org 목록이고 canonical Demo Org는 거기 없다. 제품이
「이건 진짜인가」 플래그를 들고 다니지 않는 이유는 그 플래그가 언제나 한 군데에서 빠지기 때문이다.

### E. KPI로 올리지 않는 것 (§5 승계 + 추가)

화면 렌더 수 · Home 열람 수 그 자체 · 확인 필요 **분류** 수(판매자가 한 일이 아니다) ·
관찰 중 반복 문제 수 · 대화 turn 수.

## 7. 남은 PRODUCT_DECISION — 「다시 여는가」를 무엇으로 잴 것인가

네 가설은 durable row로 **새 계측 없이** 답해진다. 다섯 번째(재방문)만 답이 없고, 선택지는 둘이다.

1. **외부 analytics sink를 파일럿에 켠다.** 이미 만들어져 있고 동의 게이트도 있다. 대가는
   **판매자의 화면 행동이 제3자 벤더로 나간다**는 것이고, 그것은 문구 결정이 아니라 배포·프라이버시
   결정이다.
2. **서버에 최소 신호 하나를 만든다** (예: org별 마지막 활동 일자). 새 사실을 저장하는 일이고,
   사람의 행동에 대한 기록이므로 역시 product-owner 결정이다.

**아무것도 만들지 않았다.** 둘 다 「무엇을 기록해도 되는가」에 대한 결정이고 이 유닛의 권한이 아니다.
그때까지 재방문은 **active day(운영 행위가 있은 날)**로만 보이며, 그 정의가 무엇을 빠뜨리는지는 §6-C에
적혀 있다.

---

## 8. Home Operations Summary — 측정 계약 (2026-09-26, product-owner 결정)

Home은 **P0**이고, 판매자가 들어오자마자 **오늘 무엇이 들어왔는지 · 지금 무엇을 봐야 하는지 ·
Reviewnary가 최근 무엇을 했는지**를 가볍게 파악할 수 있어야 한다. 그 요약은 미래 기능이 아니라
**지금 Home의 일**이다.

동시에 기존 결정은 그대로다 — 전통적 KPI dashboard 확장 · 큰 KPI 카드 · chart/trend graph는 만들지
않고, **Home Inbox가 주인공**이다. 이 절이 소유하는 것은 화면 모양이 아니라 **그 숫자들이 언제 말해도
되는 것이 되는가**, 즉 §5의 「무엇을 KPI로 올리지 않는가」와 짝이 되는 **표시 자격**이다.

**보류된 것은 요약 전체가 아니라 지표 하나다** — 「오늘 처리 완료」. 그 하나만 §8-3에서
future domain/schema decision으로 남기고, 나머지 둘은 지금 표시 자격을 갖는다.

아래는 2026-09-26 감사(로컬 DB 읽기 전용 · 마켓플레이스 0 · 모델 0)가 확정한 계약이다.

### 8-1. 오늘 들어온 것

- **KST calendar day 기준.** 제품에 이미 그 정의가 있다 — `home_open_day.opened_on`은
  「Asia/Seoul, 서버가 결정한다(a client-supplied date is a client-supplied fact)」이다.
  §2의 `handled` 계열이 쓰는 **rolling 24h와 같은 창이 아니다.** 한 화면에서 두 창을 섞지 않는다.
- **새 read가 필요하지 않다.** Home은 이미 `GET /api/dashboard/overview?days=7`을 호출한다
  (`AgentHome.tsx`). 그 응답의 `series`는 **KST 하루당 한 점의 dense 시계열**이고 상한이
  `LocalDate.now(KST)`이므로, **`series['reviews']`·`series['inquiries']`의 마지막 점이 곧 오늘**이다.
  `days=1` 별도 호출도, backend/query 추가도 필요 없다.
- **fresh observation이 확인된 경우에만 숫자를 말한다.** 판정에 새 규칙을 만들지 않는다 — 같은 응답의
  `kpis[key].excludedChannels`와 `kpis[key].freshnessUnproven`이 이미 그 질문의 답이다.
  **표시 자격은 `excludedChannels == 0 && !freshnessUnproven`** — 이때 모든 채널이
  `counted()`(`OBSERVED_FRESH` 이거나 `ZERO` 이거나 그 창에 행이 있음)를 통과했고 그중 미증명이 없으므로,
  그날의 0은 **측정된 0**이다.
- **자격을 갖추지 못하면 0을 쓰지 않는다.** 숫자 자리에 수집 상태를 말한다(예: 「수집 상태 확인 필요」와
  해당 채널). **측정된 0과 관측되지 않은 0은 다른 사실이고**, 하루짜리 창에서 이 혼동은 드물지 않다 —
  조용한 채널과 읽지 못한 채널이 둘 다 「0」으로 보인다.
- `series`의 합계는 `counted()`를 적용하지 않은 **모든 채널의 합**이다. 그래서 위 자격이
  둘을 동시에 만족시킨다: 자격이 성립할 때만 `series` 합계의 모집단과 KPI의 모집단이 일치한다.
- `exampleDataIncluded`가 참이면 그 숫자는 판매자의 것이 아니다. 화면이 그 사실을 렌더해야 한다.
- 이 조항이 존재하는 이유는 관측된 실패 모양 하나다: **책임이 마지막으로 돈 지 한참 지났는데 화면은
  `자동 확인 중`이고, 그 아래 「오늘 0건」이 서 있는 상태.** 수집이 멈춘 것과 오늘 조용한 것이 같은
  글자로 보이면 판매자는 확인할 방법이 없다.

### 8-2. 지금 볼 것

- **Home의 canonical deduped work count를 재사용한다.** 두 번째로 세지 않는다.
- **서버 total을 단순 합산하지 않는다.** `decisions.total` · `attentionTotal` · `totalElements`는
  **서로 겹치는 모집단**이고 dedupe는 `owner` 키로 행 위에서 일어난다. 세 수의 합은 아무도 관측한
  적 없는 네 번째 수다.
- **truncated일 때 확정 total을 주장하지 않는다.** 이 규칙은 이미 제품에 있다 — 서버가 보낸 것보다
  더 있다고 말하면 그 총계는 하한이고, 그때 Home은 수를 말하지 않는다.
- 보조 사실로 **실행 대기**(`ops.prepared`)를 쓸 수 있다. 판매자가 이미 결정했고 아직 끝나지 않은 일이라
  「지금 볼 것」과 같은 시점값이고, 창을 갖지 않는다.

### 8-3. 오늘 끝낸 것 — **지표를 만들지 않는다**

**Review/Inquiry를 관통하는 canonical completion event가 없다.** 그 이름의 지표를 지금 만들면
정의되지 않은 수를 화면에 올리는 일이 된다. 후보 셋 중 **하나를 임의로 대용하지 않는다** — 셋은 서로
다른 주장이고, 그중 무엇도 두 lane을 관통하지 않는다:

| 후보 | 왜 대용할 수 없는가 |
|---|---|
| `inquiry_work_item_audit.phase_to='COMPLETED'` | 한 phase에 actor가 여럿이다 — 커넥터 ingest가 쓴 COMPLETED는 **판매자가 채널에서 직접 답한 것**이고, 상태 보정이 쓴 것은 완료가 아니다. 행을 세면 셋이 한 수에 섞인다 |
| `review_triage.disposition` | **판단이지 완료가 아니다.** `RESPONSE_NEEDED`는 「답해야 한다」이고 그 자체로 일이 남아 있다는 뜻이다 |
| `review_reply_outcome.operator_outcome` | 값이 둘이고 하나는 `SUBMISSION_ABORTED`다 — **중단은 전송이 아니다.** 전송을 뜻하는 값은 따로 있고, 그것도 판매자의 *보고*이지 확인이 아니다 |

**§7(알려진 한계) 1번이 이 지표의 선행 조건이다.** 리뷰 lane이 `VERIFIED`에 도달할 수 없는 것은 구현
미비가 아니라 **스키마 제약**이다 — `review_reply_outcome`의
`chk_review_reply_outcome_verification`이 `verification in ('UNVERIFIED')` 하나만 허용한다.
**이 지표는 마이그레이션 없이 열리지 않는다.**

따라서 선행은 문구 결정이 아니라 **future domain + schema decision**이고, 순서는 하나뿐이다: 두 lane을
관통하는 완료의 의미를 먼저 정하고(§8-5의 셋째 질문이 그것을 묻는다), 그 정의가 행을 만들고, 그 뒤에
숫자가 화면에 오른다. 순서를 바꾸면 §5가 금지한 모양 — 판매자가 아무 일도 처리하지 않아도 올라가는
수 — 이 된다.

### 8-4. 그 사이에 Home이 말할 수 있는 것 — `home.handled`를 그 이름 그대로

「오늘 처리 완료」가 없는 동안에도 **Reviewnary가 최근 무엇을 했는가**는 말할 수 있다.
`CustomerOperationsHome.handled`가 이미 그것이고, **「처리 완료」라는 이름으로 재해석하지 않는다.**

**다섯 숫자의 창이 같지 않다** — 이것이 이 절의 핵심이고, 한 제목 아래 묶을 때 반드시 지켜야 한다:

| 필드 | 창 | 정확한 의미 |
|---|---|---|
| `checked` | **24h** | 그 창에 **열린** CUSTOMER_WORK 케이스 수 — 분모이지 합이 아니다 |
| `autoResolved` | **24h** | 그 창에 **열린** 케이스 중 지금 `AUTO_RESOLVED`인 것 (규칙이 「조치 불필요」로 정리) |
| `draftsPrepared` | **24h** | 그 창에 **열린** 케이스 중 초안이 준비된 것 |
| `monitoring` | **창 없음 — 시점값** | 지금 열려 있는 `MONITORING` 케이스 수 |
| `verifying` | **창 없음 — 시점값** | 판매자가 이미 결정했고 canonical record가 아직 정산하지 않은 케이스 수 |

두 가지가 따라온다.
**(a)** 「최근 24시간」 제목 아래에는 **`checked` · `autoResolved` · `draftsPrepared`만** 놓을 수 있다.
`monitoring`·`verifying`을 그 아래 두면 창을 갖지 않는 수에 창을 붙이는 것이다 —
`verifying`은 「지금 볼 것」 쪽의 시점 사실로 쓰는 것이 맞다.
**(b)** 세 개의 24h조차 **`created_at`(케이스가 열린 시각) 기준**이지 「처리한 시각」이 아니다. 30시간 전에
열려 2시간 전에 정리된 케이스는 세지 않는다. 그러므로 이 묶음은 **「우리가 어제부터 본 것과 그 처리」**이지
**「어제부터 처리한 것」이 아니다.** 화면 문구가 그 차이를 넘어서면 안 된다.

**문의 전용 파일럿에서는 `monitoring`이 구조적으로 0이다** — `OperationsCaseRules.forInquiry`는 그 값을
만들지 않는다(`MONITORING`은 리뷰 쪽 결론이다). 그래서 이 묶음이 비어 있는 것은 고장이 아니라
그 배포가 관찰하는 것의 모양이고, 화면은 **0을 나열하는 대신 아무 일도 없었다고 말한다.**

### 8-5. 파일럿에서 확인할 질문

§6(인터뷰 질문)의 다섯과 **같은 자리에서 같은 방식으로** 묻는다 — 설문 UI를 만들지 않고 파일럿
대화에서 묻는다. 아래 넷은 그 다섯을 대체하지 않고 잇는다.

6. 오늘 새로 들어온 양을 실제로 궁금해하시나요?
7. 「확인할 일 N」만으로 충분한가요, 부족한가요?
8. 어떤 상태가 되면 그 건을 「처리 완료」라고 보시나요?
9. 하루 처리량을 아는 것이 이 화면에서 하실 일을 바꾸나요?

**8번의 답이 §8-3의 선행 조건이다** — 판매자가 무엇을 완료로 인식하는지가 canonical completion
event의 정의보다 먼저다. 그 답 없이 정의부터 만들면 §7(알려진 한계) 5번이
(`ANSWER_POSTED_STATUS_UNRESOLVED`는 성공도 실패도 아니다) 이미 만난 문제를 두 lane에 걸쳐 다시 만든다.
