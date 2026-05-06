# Instagram VOC — DM Conversion Ledger

> **Operations log**. 공개 `public_education` 게시물에서 인입된
> Instagram DM lead를 인입 → qualification → sample report → proposal →
> outcome까지 추적한다. 본 doc은 매주 금요일 리뷰의 입력 자료이고,
> revision은 §6 routine 결과로만 발생한다.
>
> **Policy sources** (binding):
> - `docs/instagram_voc_brand_strategy.md` — `108888e` (브랜드 포지셔닝)
> - `docs/instagram_public_education_post_001.md` — `648b728` (post 001 = `source_post_id` 첫 값)
> - `docs/instagram_voc_publishing_checklist.md` — `6dc8a0f` (post 발행 정책)
> - `cardnews/safety_validator.py::validate_cardnews_mode` — `a2b2ae6` (sample report = `private_demo` mode 강제)
> - `docs/instagram_voc_dm_response_script.md` — `7879a7d` (응답 템플릿 + §8 conversion path)
>
> **Ledger version**: v1.0 (2026-05-06)

---

## 1. Scope

### Applies to

- ✅ **인디뷰티 브랜드 운영자**가 보낸 inbound Instagram DM (제품 / 상세
  페이지 / CS / 마케팅 의사결정자).
- ✅ Story 답장이나 post 댓글에서 DM으로 유도된 대화도 동일 기록.
- ✅ 본 ledger의 한 행은 **하나의 lead = 하나의 brand contact**. 같은
  브랜드가 여러 사람에게서 DM을 보냈더라도 lead는 1개로 통합 (브랜드
  단위로 기록). 후속 대화는 같은 lead 행의 `notes`에 누적.

### Does NOT apply to

- ❌ **소비자 제품 문의** ("이 쿠션 어디서 사요?", "추천해 주세요").
  DM 응답 스크립트 §5 Template E로 redirect한 대화는 ledger에 남기지
  않는다. 단, 같은 계정에서 추후 운영자 정체로 다시 DM이 들어오면
  새 lead로 등록한다.
- ❌ **공개 댓글 / Story 인용**. 본 ledger는 1:1 대화 추적용. 공개
  surface의 상호작용은 별도 콘텐츠 회고(`§7.3 Post-publish observations`
  in `648b728` post 001)에서 다룬다.
- ❌ **광고 / 협찬 / affiliate 제안**. DM 응답 스크립트 §1 4번째
  branch로 거절한 경우 ledger에 남기지 않는다 (운영 회의 회고 정도면
  충분).

---

## 2. Ledger fields

각 lead는 다음 15개 필드를 가진다. 새 lead 인입 시 §3 status 정의를
참조해 `qualification_stage`를 결정한다.

| # | Field | Type | When set | Notes |
|---|---|---|---|---|
| 1 | `lead_id` | string | 인입 즉시 | 형식: `lead_YYYYMMDD_NN` (예: `lead_20260512_01`). 같은 날 여러 인입 시 NN을 01부터 증가. 영구 식별자. |
| 2 | `source_post_id` | string | 인입 즉시 | 어느 `public_education` 게시물에서 인입됐는지. 형식: post markdown SHA 또는 ID (예: `public_education_001` / `648b728`). 모르면 `unknown`로 기록 후 회고에서 추정. |
| 3 | `dm_received_at` | datetime (KST) | 인입 즉시 | `YYYY-MM-DD HH:MM` 형식. 야간/주말 인입은 그대로 기록하고 응답 시간만 별도로 노트. |
| 4 | `brand_name` | string | qualification 후 | qualification 응답에서 명시 확인 후 기재. 모르는 상태에서는 빈칸. **다른 브랜드 분석 요청은 ledger에 남기지 않음** (해당 lead는 §1에서 거절 처리). |
| 5 | `contact_handle` | string | 인입 즉시 | Instagram 핸들 (`@brand_handle`). DM 식별자. |
| 6 | `contact_email` | string | 채널 전환 후 | 잠재 고객이 이메일 회신을 선택한 경우. 받지 못한 경우 빈칸. |
| 7 | `product_or_category` | string | qualification 후 | 분석 대상 제품 또는 카테고리. 자유 기술 (예: "쿠션 라인 1종", "립틴트 카테고리 전체"). 특정 SKU 코드는 안 적어도 됨. |
| 8 | `main_concern` | enum | qualification 후 | `상세페이지` / `제품_개선` / `CS` / `재구매` / `신제품_반응` / `기타(자유 기술)`. 1~2개 선택. |
| 9 | `data_provided_type` | enum | qualification 후 | `public_link` / `csv` / `api` / `self_owned_reviews` / `cs_notes` / `none`. 여러 개일 경우 콤마 분리 (예: `csv, cs_notes`). |
| 10 | `qualification_stage` | enum | 변경 시마다 갱신 | `new` / `qualified` / `sample_requested` / `sample_sent` / `proposal_sent` / `won` / `lost` / `dormant`. 정의는 §3. |
| 11 | `sample_report_sent_at` | datetime (KST) | sample 발송 시 | 빈칸 = 아직 sample 단계 아님. 한 lead가 여러 sample을 받는 경우는 거의 없으므로 첫 발송 시각 1개만. |
| 12 | `paid_proposal_sent_at` | datetime (KST) | Template F (가격 견적) 발송 시 | 빈칸 = 아직 견적 단계 아님. |
| 13 | `outcome` | enum + free-text | terminal stage 도달 시 | 권장 enum: `contract_signed(scope)` / `declined_by_brand(reason)` / `declined_by_us(reason)` / `no_response_30d` / `paused_by_brand(reason)`. reason 자유 기술. |
| 14 | `anonymized_case_permission` | enum | sample 만족 confirm 후 | `yes` / `no` / `pending`. **명시적 동의 없이 `yes`로 기재 금지**. pending은 "아직 묻지 않았거나 답변 보류". |
| 15 | `notes` | free-text | 누적 | 대화 진행, 거절 사유, 보안 인증 요구, 특이사항 등. 시간순 prepend. **raw 리뷰 / 개인정보 / 비밀번호 절대 금지** (§4 참조). |

### Field 작성 원칙

- **빈칸 vs `unknown`**: 아직 알 수 없는 정보는 빈칸. 명시적으로 "정보를
  요청했으나 거절됨"인 경우 `notes`에 기록하고 해당 필드는 빈칸 유지
  (혹은 `withheld`로 표기).
- **Enum 일관성**: enum 필드는 정확한 토큰만 사용. 오타/변형은 향후 회고
  통계 자동화 시 깨진다. 새 값이 필요하면 `notes`에 임시 기록 후 §6
  weekly review에서 enum 확장 결정.
- **갱신 vs 누적**: `qualification_stage`는 갱신 (한 값만 유지). `notes`는
  누적 (이전 노트 보존, 시간순 prepend).

---

## 3. Status definitions (`qualification_stage`)

| Stage | 정의 | 진입 조건 | 다음 stage 조건 |
|---|---|---|---|
| **`new`** | 인입 직후, 아직 응답 안 함 | DM 받았고 §1 scope 통과 | DM 응답 스크립트 §3 first response 발송 |
| **`qualified`** | First response 발송 + 잠재 고객 회신으로 §4 qualification 핵심 4개(브랜드/제품/영역/데이터) 답변 확보 | brand_name + product_or_category + main_concern + data_provided_type 4개 모두 채워짐 | 운영자가 sample 작업 결정 → `sample_requested` |
| **`sample_requested`** | Sample 작업 시작 결정. 아직 발송 전 | 운영자가 sample 작업 큐에 넣음 (분석 시작 시각 별도 트래킹 권장) | sample 발송 → `sample_sent` |
| **`sample_sent`** | Sample report 비공개 1:1로 발송 완료 | `sample_report_sent_at` 기재 | (1) 잠재 고객 만족 → `proposal_sent` 가능 / (2) 응답 없음 30일 → `dormant` / (3) 거절 회신 → `lost` |
| **`proposal_sent`** | DM 스크립트 Template F (paid 견적) 발송 완료 | `paid_proposal_sent_at` 기재 | (1) 계약 체결 → `won` / (2) 거절/보류 → `lost` 또는 `paused_by_brand` (outcome에 표시) / (3) 응답 없음 30일 → `dormant` |
| **`won`** | 계약 체결 (paid 단계 진입) | 계약/결제/시작일 합의 완료 | terminal — 갱신 없음. 후속 운영은 별도 운영 ledger로 이관 |
| **`lost`** | 명시적으로 거절되었거나, 우리 측에서 진행 안 하기로 결정 | outcome 필드에 사유 기재 | terminal |
| **`dormant`** | 응답 없음 30일 이상 | sample_sent 또는 proposal_sent 후 30일 무응답 | reactivated 시 새 lead가 아니라 같은 lead의 notes에 prepend + stage를 적절히 되돌림 |

### Stage transitions are forward-only (예외: `dormant` reactivation)

- 정상 흐름: `new → qualified → sample_requested → sample_sent → proposal_sent → won|lost`.
- `dormant`는 sample_sent 또는 proposal_sent에서만 진입. dormant에서
  잠재 고객이 다시 응답하면 가장 적절한 직전 stage로 복귀하고 `notes`에
  reactivation 시각 + 사유 기록.
- 거꾸로 가는 transition (예: `proposal_sent → qualified`)은 금지. 잘못
  분류했다면 새 lead를 만들지 말고 기존 행의 `notes`에 정정 사유 기록.

### `qualified` vs `sample_requested` 분리 이유

운영자가 받은 정보로 sample을 만들 가치가 있는지 판단할 시간이 필요하다.
"qualified = 정보 확보 완료"와 "sample_requested = 작업 결정"을 분리하면,
정보는 확보됐으나 작업하지 않기로 한 lead(데이터 부족, scope 외 등)를
별도 stage로 추적할 수 있다.

---

## 4. Privacy rules (binding)

본 ledger를 채울 때 다음 규칙은 lock된다. 위반 시 즉시 해당 항목을
삭제하고, 위반 사례를 §6 weekly review에 기록 후 재발 방지 절차 결정.

### 절대 저장 금지

- ❌ **비밀번호, 셀러센터 ID/PW, OAuth 토큰**. DM 응답 스크립트 §7
  처음부터 받지 않으므로 ledger에 들어올 일이 없어야 한다. 만약 잠재
  고객이 자발적으로 DM에 보내왔다면 즉시 해당 메시지 삭제 + ledger
  notes에 "credential 자발 전송 → 즉시 삭제 안내" 기록.
- ❌ **셀러센터 로그인 URL + 직원 식별 정보** (관리자 이름, 사번 등).
- ❌ **잠재 고객의 신용카드/결제 수단 정보**.
- ❌ **잠재 고객의 직원/대표 개인 연락처** (개인 휴대폰, 개인 이메일).
  업무용 이메일 + Instagram 핸들만 ledger에 저장. 개인 휴대폰을 받았다면
  notes에 "phone provided, not stored"로만 표시.

### 절대 paste 금지

- ❌ **Raw 리뷰 텍스트**. 잠재 고객이 자기 브랜드 리뷰 일부를 DM에
  paste 했더라도 ledger 본문에 옮기지 않는다. 패턴 요약만 한 줄
  (예: "리뷰 일부 paste — 색상 옵션 관련 patterns 5건 언급").
- ❌ **고객 개인 데이터** (구매자 이름, 연락처, 주소, 주문번호). CSV에
  포함되어 있으면 §7 데이터 처리 규칙에 따라 마스킹 후 수신.
- ❌ **임원/사내 의사결정자 실명 + 직책**. notes에 의사결정 동향을
  기록할 때는 "마케팅 디렉터" 같은 직책 일반화. "OO 본부장"식 표기 금지.

### 권장 — 링크로 분리

- ✅ **민감 자료는 별도 비공개 파일**에 저장하고 ledger에는 경로/링크만
  기재. 보안 클라우드 (만료 기한 설정), 회사 내부 NAS, 또는 본 저장소
  바깥의 비공개 작업 디렉터리.
- ✅ **CSV / API export 파일**은 ledger 옆 디렉터리가 아니라 별도 비공개
  저장소에 두고 ledger의 notes에 "internal://path/to/file" 형식으로
  참조.
- ✅ **Sample report PDF/markdown**도 ledger 본문에 첨부하지 않고 별도
  비공개 경로 + 발송 시각만 기록 (`sample_report_sent_at`).

### `anonymized_case_permission`은 명시 동의가 있을 때만 `yes`

- DM에서 "괜찮아요" 한 마디로는 부족하다. 명시적으로 "익명/가상 case
  형태로 공개 콘텐츠에 사용 동의"를 받은 경우에만 `yes`로 기재.
- 동의 메시지 원문(또는 캡처 파일 경로)을 notes에 기록.
- 동의가 모호한 경우 `pending`으로 두고 sample 만족 후 별도 confirm
  단계에서 다시 묻기.
- 명시적으로 거절한 경우 `no`로 기재 + 거절 의사를 영구 lock으로 기록.

### 본 ledger의 노출 범위

- 본 doc은 git 저장소에 commit되므로 향후 visibility scope에 따라
  운영자만 접근 가능한 별도 비공개 fork로 옮기는 것을 검토. 현재는
  `notes` 필드에 식별 가능 정보를 절대 paste하지 않으므로 git tracked
  상태로 유지.
- 실제 운영 ledger row가 채워지기 시작하면 (특히 `won` lead가 나오면)
  본 doc의 visibility를 다시 검토. v1.x revision 사유로 §6 weekly
  review에서 다룬다.

---

## 5. Example rows

> **모든 예시는 가상**(`is_fictional: true` 마커). 어떤 실제 인디뷰티
> 브랜드와도 무관하며, ledger 형식 시범 목적으로만 작성. 실제 lead가
> 인입되면 본 §5는 그대로 두고 §7 (Active leads)에 행을 추가한다.

### Example A — qualified, 작업 결정 전

```yaml
lead_id: lead_20260512_01
source_post_id: 648b728  # public_education_001
dm_received_at: 2026-05-12 14:23
brand_name: "Brand Alpha (가상)"
contact_handle: "@brand_alpha_kr"
contact_email: "ops@brand-alpha.example"
product_or_category: "립틴트 라인 신제품 1종"
main_concern: "상세페이지, 신제품_반응"
data_provided_type: "public_link"
qualification_stage: "qualified"
sample_report_sent_at: ""
paid_proposal_sent_at: ""
outcome: ""
anonymized_case_permission: "pending"
notes: |
  - 2026-05-12 14:23 — DM 인입 (post 001 보고 문의)
  - 2026-05-12 14:51 — first response 발송 (script v1.0)
  - 2026-05-13 10:14 — 4개 qualification 모두 회신:
      brand=Brand Alpha (가상), product=신제품 립틴트 1종,
      concern=상세페이지+신제품 반응, data=public 링크만.
      이메일도 알려줌 → ops@brand-alpha.example로 후속.
  - 분석 작업 결정 보류 — 데이터가 public 링크 1개뿐이라 sample
    scope이 thin. 운영자 결정 후 sample_requested로 진행 또는
    Template A (sample 한계 명시)로 응답하고 종료 결정 필요.
  is_fictional: true
```

### Example B — sample_sent 후 proposal 진입

```yaml
lead_id: lead_20260514_02
source_post_id: 648b728  # public_education_001
dm_received_at: 2026-05-14 09:08
brand_name: "Brand Beta (가상)"
contact_handle: "@brand_beta_official"
contact_email: "marketing@brand-beta.example"
product_or_category: "쿠션 베이스 라인 (3 SKU)"
main_concern: "제품_개선, CS"
data_provided_type: "csv, cs_notes"
qualification_stage: "proposal_sent"
sample_report_sent_at: 2026-05-19 16:45
paid_proposal_sent_at: 2026-05-23 11:20
outcome: ""
anonymized_case_permission: "no"
notes: |
  - 2026-05-14 09:08 — DM 인입
  - 2026-05-14 10:01 — first response 발송
  - 2026-05-15 — qualification 회신 (4개 모두). 셀러센터 CSV 6개월치
    + CS 로그 일부 가능하다고 함.
  - 2026-05-15 11:30 — Template B 발송 (수신 채널 + 컬럼 검토 안내).
  - 2026-05-16 — 보안 클라우드 링크로 CSV 수신 (개인정보 컬럼 사전
    마스킹 확인). 자세한 파일 경로는 internal://review_ops/leads/
    lead_20260514_02/ (외부 노출 금지).
  - 2026-05-19 16:45 — sample report 발송 (cardnews_mode=private_demo
    manifest 확인, 1:1 비공개 이메일 첨부).
  - 2026-05-21 — sample 만족 회신. 익명 case 사용은 "현재 검토 어렵
    다"는 답 → anonymized_case_permission=no 영구 lock.
  - 2026-05-22 — Q7 (timeline) 회신: 다음 분기 운영회의용. Q8 (의사
    결정 참여자): 마케팅 디렉터 + CS 리드 2명.
  - 2026-05-23 11:20 — Template F (가격 견적 요청) 발송.
  - 회신 대기 중.
  is_fictional: true
```

### Example C — 거절 (`lost`)

```yaml
lead_id: lead_20260507_01
source_post_id: 648b728  # public_education_001
dm_received_at: 2026-05-07 19:32
brand_name: "Brand Gamma (가상)"
contact_handle: "@brand_gamma_kr"
contact_email: ""
product_or_category: "선크림 1 SKU"
main_concern: "제품_개선"
data_provided_type: "public_link"
qualification_stage: "lost"
sample_report_sent_at: 2026-05-09 14:00
paid_proposal_sent_at: ""
outcome: "declined_by_brand(보안 인증 요구 — SOC2 미보유로 진행 보류)"
anonymized_case_permission: "no"
notes: |
  - 2026-05-07 19:32 — DM 인입 (야간, 다음날 오전 응답 예정)
  - 2026-05-08 09:45 — first response 발송
  - 2026-05-08 — qualification 회신 (4개 모두).
  - 2026-05-09 14:00 — public link 기반 sample report 발송
    (Template A 안내 그대로, scope 한계 명시).
  - 2026-05-10 — sample 만족 회신, 다음 단계 진행 의향 있음. 다만
    유료 단계 진입 전 SOC2 / DPA 등 보안 인증 자료 요구.
  - 2026-05-10 — DM 스크립트 §7에 따라 솔직 답변: 현재 단계에서는
    해당 보안 인증 보유하고 있지 않다고 안내. 진행 보류 합의.
  - outcome=declined_by_brand(보안 인증 요구). 향후 우리 측이 해당
    인증을 보유하게 되면 reactivation 가능 — notes에 "future_revisit_
    candidate" 태그.
  is_fictional: true
```

---

## 6. Weekly review routine

매주 **금요일** 운영자가 본 ledger를 review한다. 목표: lead 흐름의
건강 상태 + 다음 주 콘텐츠/스크립트 revision input.

### Routine steps

1. **Active leads 정리** — `qualification_stage`별로 행 수 집계:
   - new (응답 대기)
   - qualified (작업 결정 대기)
   - sample_requested (작업 중)
   - sample_sent (잠재 고객 응답 대기)
   - proposal_sent (계약 검토 대기)
2. **이번 주 새 인입 카운트** — `dm_received_at`이 직전 토요일 00:00
   ~ 오늘 금요일까지인 행 수.
3. **이번 주 발송 카운트** — `sample_report_sent_at` / `paid_proposal_
   sent_at`이 같은 7일 윈도우 안에 있는 행 수.
4. **Win / loss 카운트** — `qualification_stage`가 이번 주에 `won`
   또는 `lost`로 전환된 lead 수.
5. **Stale 점검** — `sample_sent` 또는 `proposal_sent` 상태로 30일
   넘은 lead → `dormant`로 일괄 전환 + notes에 "auto-dormant on
   YYYY-MM-DD".
6. **거절 사유 패턴 추출** — 이번 주 lost lead의 outcome 사유 (가격 /
   scope / 보안 / timing / data 부족 등) 수집. 동일 사유가 2주 연속
   반복되면 §7 (lessons captured) 또는 DM 스크립트 v1.x revision
   후보로 기록.
7. **콘텐츠 시그널** — 이번 주 인입에서 관찰된 운영자 질문 톤 / 요구사항
   패턴 → posts 002~020 manuscripts에 반영할 것 결정.

### 회의록 형식 (선택 사항이지만 권장)

```yaml
weekly_review:
  week_of: 2026-05-12 (월) ~ 2026-05-16 (금)
  reviewer: "(이름)"
  reviewed_at: 2026-05-16 17:00 KST
  active_leads_by_stage:
    new: 0
    qualified: 1
    sample_requested: 0
    sample_sent: 1
    proposal_sent: 1
    dormant: 0
  this_week_inflow: 2
  this_week_samples_sent: 1
  this_week_proposals_sent: 1
  this_week_wins: 0
  this_week_losses: 0
  reason_patterns_observed:
    - "보안 인증 요구 (SOC2/DPA) — 1건 반복 (cumulative 2건째)"
  content_signals_for_posts_002_to_020:
    - "DM 스크립트 §7 보안 인증 안내가 이번 주 1건 발생 — Template
      G 후보 (paid 단계 진입 전 보안 안내)로 신설 검토."
    - "post 002 후보 주제: '리뷰 분석 외주는 어떤 데이터 보안 질문을
      받게 되는가' — 보안 인증 question을 정면으로 다루는 educational
      post. 운영자 톤 lock 유지."
  revision_candidates:
    dm_script: "Template G 신설 후보 (보안 안내). v1.1 revision."
    posts_pillar: "P4 (월간 VOC 운영법)에 보안/데이터 신뢰성 카드
                   추가 검토."
    ledger: "outcome enum에 'declined_by_brand_security' 명시적
             값 추가 검토."
```

### 회고 → 정책 revision 흐름

- 본 ledger는 lead 추적이 1차 목적이지만, 부산물로 정책 약점이 가장
  먼저 보이는 곳이 된다.
- 동일 사유의 lost가 2주 연속 발생 → DM 스크립트 / publishing
  checklist / strategy doc revision 후보.
- 동일 질문 패턴이 3건 이상 인입 → posts 002~020 콘텐츠 주제 후보.
- Privacy 위반 시도 (잠재 고객이 credential 자발 전송 등) 1회라도
  발생 → §4 privacy rules의 안내 표현 / DM script Template B 강화
  후보.

---

## 7. Active leads

> 실제 lead 인입 시 §5 example과 동일한 yaml 블록 형식으로 본 섹션에
> 행을 추가한다. 발행 직전(즉, post 001을 publish하기 전)까지는 이
> 섹션은 비어 있다.

```
(현재 active lead 없음 — post 001 publish 후 첫 인입부터 기록 시작)
```

---

## Appendix A — Versioning & revision

- **v1.0** (2026-05-06): 최초 작성. 정책 source 5개(`108888e`, `648b728`,
  `6dc8a0f`, `a2b2ae6`, `7879a7d`)에 정렬. 15-필드 schema + 8-state
  qualification_stage 정의 + 4-카테고리 privacy rules + 3개 fictional
  example + 7-step weekly review routine.
- 본 ledger는 §6 weekly review에서 발견된 schema 약점에 따라 revision
  한다:
  1. 새 enum 값 추가 (예: `outcome=declined_by_brand_security`)
  2. 새 필드 추가 (예: `security_inquiry_received: yes/no` — 보안 인증
     요구 추적)
  3. Privacy rule 강화 (잠재 고객 행동 패턴에 따라)
- 기존 lead 행의 schema 호환성:
  - 새 필드 추가 시 기존 lead는 빈칸으로 둔다 (forward-compatible).
  - Enum 값 추가는 기존 lead에 영향 없음.
  - 필드 삭제 / rename은 v2.x 이상에서만 검토.

---

## Appendix B — 빠른 참조 (compact reference)

### Lead 인입 즉시 채울 4개

`lead_id` / `source_post_id` / `dm_received_at` / `contact_handle`

### Qualified 도달 시 채워야 할 4개

`brand_name` / `product_or_category` / `main_concern` / `data_provided_type`

### Sample 발송 시 채울 1개

`sample_report_sent_at`

### Proposal 발송 시 채울 1개

`paid_proposal_sent_at`

### Terminal 시 채울 2개

`outcome` / `anonymized_case_permission` (아직 안 물었으면 `pending`
유지)

### 매번 누적

`notes` (시간순 prepend; raw review / PII / credential paste 절대 금지)
