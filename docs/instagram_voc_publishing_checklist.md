# Instagram VOC — Publishing Checklist (`public_education` mode)

> **Reusable 2-eye review runbook**. Run this checklist for **every**
> `public_education`-mode Instagram post before publishing. Attach the
> filled-out copy to the post's review ledger (e.g.
> `docs/instagram_public_education_post_NNN.md` §7).
>
> **Policy sources** (binding):
> - `docs/instagram_voc_brand_strategy.md` — committed as `108888e`
> - `docs/instagram_public_education_post_001.md` — committed as `648b728`
>   (template seed for the 14-row safety check)
>
> **Checklist version**: v1.0 (2026-05-06)

---

## 1. Scope

### Applies to

- ✅ `public_education`-mode Instagram posts (account의 공개 게시물).
- ✅ 재게시(re-share, IG Story 인용 등)도 동일 체크 통과 필요.

### Does NOT apply to

- ❌ `private_demo` 산출물.
  - **`private_demo`는 어떤 경우에도 Instagram(또는 그 외 공개 채널)에
    게시할 수 없다.** 1:1 비공개 채널(DM/email)에서만 사용한다.
  - 현재 `cardnews/render.py` 출력은 모두 `private_demo`이므로 본 체크
    리스트로 통과시킬 수 없다 (내용 조건 자체가 불일치).
- ❌ `consented_case_study` 콘텐츠.
  - 별도 승인 경로 필요 — `docs/instagram_voc_brand_strategy.md` §9 및
    Phase C 가이드 참조.
  - 동의서(consent) 검증, 브랜드 disclosure 문구, 표시 기간 lock 등
    추가 항목이 본 체크리스트에 포함되어 있지 않다.

### Mode 판별 빠른 게이트 (게시 전 첫 검사)

```
이 게시물의 mode는 무엇인가?
├── private_demo          → STOP. Instagram 게시 금지. 종료.
├── consented_case_study  → STOP. consented_case_study 승인 경로로 이동. 본 체크리스트 사용 금지.
└── public_education      → 본 체크리스트 §2 진행.
```

---

## 2. Required inputs before review

검토를 시작하기 전에 다음 입력이 모두 준비되어 있어야 한다. 하나라도
빠지면 검토를 시작하지 않는다.

| # | Input | Format / location | 비고 |
|---|---|---|---|
| 1 | 게시물 markdown 경로 | `docs/instagram_public_education_post_NNN.md` | metadata block + 7-card body 포함 |
| 2 | Visual mockup 경로 | 예: `docs/instagram_public_education_post_NNN_mockup.png` 또는 Figma share link | 카드별 1장씩, 총 N장 |
| 3 | 최종 caption | 게시물 markdown §3 또는 별도 첨부 | 모바일 "더 보기" 컷오프 위치까지 검수 |
| 4 | 최종 hashtag 셋 | 게시물 markdown §4 또는 별도 첨부 | 8~12개 / 정책 태그 only |
| 5 | 게시 예정일·시각 | YYYY-MM-DD HH:MM (KST) | DM 응답 가능 시간대 확인 |
| 6 | 검토자(reviewer) 이름 | 작성자(author) ≠ reviewer 강제 | 2-eye 원칙 |
| 7 | CTA 행선지 / DM 핸들 | 실제 IG 핸들 + 이메일 주소 | placeholder(`@account`, `hello@xxx`) 잔존 시 자동 차단 |
| 8 | Placeholder 교체 증명 | grep 결과 0건 캡처 또는 검토 화면 | §3 #11 항목과 짝 |
| 9 | DM 응대 스크립트 준비 | 별도 doc 경로 또는 본 체크리스트에 첨부 | 게시 시점에 운영 가능해야 함 |
| 10 | 후속 트래픽 모니터링 책임자 | 이름 | +7/+14/+30일 ledger 채울 사람 |

준비되지 않은 입력 항목은 본 체크리스트 상단의 `Inputs collected` 표
(아래 §6의 ledger 템플릿)에 빈칸으로 남기지 말고 "준비 안됨"으로
명시하고, 게시 보류한다.

---

## 3. Safety checklist (14 rows, post-by-post)

> 모든 항목 ✅ 필수. 하나라도 ❌이면 게시 보류 + 본문 재수정.
> "예외" 또는 "다음에 고치기"로 우회 게시 금지. 우회 사유가 있다면
> 본 체크리스트의 v1.1 revision으로 정책을 먼저 갱신해야 한다.

| # | 검사 항목 | Pass criteria | 적용 범위 | 결과 |
|---|---|---|---|---|
| 1 | brand 이름 노출 | 카드/캡션/해시태그/이미지 어디에도 식별 가능한 브랜드명 없음. **(`consented_case_study`만 예외 — 본 체크리스트 적용 대상 아님)** | 카드+캡션+태그+시각 자산 전부 | ☐ |
| 2 | product 이름 노출 | 동일. 제품 라인명·SKU·코드네임 일체 없음 | 동일 | ☐ |
| 3 | raw 리뷰 인용 | 어떤 카드/캡션에도 실제 리뷰에서 추출된 텍스트 인용 없음. 일반 한국어 리뷰 패턴 표현(예: "색이 달라요", "건조해요")은 OK이며, 출처 없음을 검토자가 확인 | 카드+캡션 | ☐ |
| 4 | scraped 출처 / 플랫폼 언급 | "OliveYoung에서", "Coupang에서", "스크래핑 결과", "API에서" 등 데이터 출처 표현 없음 | 카드+캡션+태그 | ☐ |
| 5 | affiliate / 추천 톤 | "추천합니다", "사세요", "인생템", "필수템", "할인 중", "협찬", "광고" 등 어휘 없음. 제품을 사도록 유도하는 어떤 표현도 없음 | 카드+캡션 | ☐ |
| 6 | 제품 비판 | "이 제품은 OO이다" 형태의 단정 평가 없음. 카테고리 단위 표현조차 "OO 카테고리는 안 좋다"식 단정 없음 | 카드+캡션 | ☐ |
| 7 | 미검증 수치 클레임 | "리뷰의 70%가…", "10배 더 정확한…", "N건의 누적", "N% 개선" 등 출처 불명/검증 불가 수치 없음. **수치 비유 자체도 회피** ("N줄/N건" 같은 비유적 수치도 사용하지 않는다 — 표준 substitute는 "반복되는 리뷰 표현 / 누적되는 고객 언어") | 카드+캡션 | ☐ |
| 8 | 단정형 / over-certain 어휘 | "필요/해야 함/원인은/결함/방치/문제입니다/반드시" 등 directive·단정 어휘 없음. 모든 신호는 "가능성/후보/검토/권장/확인" 형태로 hedge | 카드+캡션 | ☐ |
| 9 | 의학적 효능 단정 | "치료/완치/의학적/임상적으로/효능 N%/흡수율 N%" 등 의학·약리 효능을 단정하는 표현 없음 | 카드+캡션 | ☐ |
| 10 | CTA B2B 정렬 | CTA가 정확히 **"샘플 리포트 / 월간 리뷰 자산 관리 문의는 DM으로 보내주세요."** 형식. "무료/지금 신청/선착순/이벤트/특가" 등 마케팅·소비자 후킹 어휘 없음. "비공개 1:1 회신" 신뢰 표현 유지 | 카드 7 + 캡션 마지막 단락 | ☐ |
| 11 | placeholder 잔존 | `@account`, `hello@xxx`, `(이름)`, `YYYY-MM-DD`, `<...>` 등 placeholder가 모두 실 값으로 교체됨. grep 0건 확인 | 카드+캡션+ledger | ☐ |
| 12 | 시각 자산 누설 | 어떤 카드 mockup에도 브랜드 로고/제품 사진/스크린샷/캡처/영수증/제품 패키지 사진 없음. 일러스트는 generic only | 시각 자산 | ☐ |
| 13 | hashtag 정책 | 태그 수 8~12개. B2B 운영/마케팅/분석 영역만. 금지 태그(`#쿠션추천 / #립스틱추천 / #오늘의템 / #인생템 / #뷰티추천 / #광고 / #내돈내산 / #협찬` 등 B2C 추천 태그) 미포함. 영문 일반 뷰티 태그(`#kbeauty / #beautytips`)도 v0.1에서는 회피 | 태그 셋 | ☐ |
| 14 | 2-eye review 완료 | 작성자(author) ≠ 검토자(reviewer). 두 사람 모두 본 체크리스트의 1~13번이 ✅ 임을 명시적으로 확인하고 사인(이름 + 날짜) | ledger §6 | ☐ |

### 결과 처리

- 14개 모두 ✅ → §6 ledger의 `safety_checklist_passed: Yes`로 기록 + §6의
  `publish_approved: Yes`로 진행 가능.
- 1개라도 ❌ → 게시 보류. ❌ 항목 번호와 사유를 §6 ledger의 `notes`에
  기록. 본문 수정 후 처음부터 다시 14개 검사.

---

## 4. Language guidance

### Allowed (use these — they encode the analyst voice)

- **"신호일 수 있습니다"** — 어떤 표현도 단일 원인으로 단정하지 않는다.
- **"검토 후보로 볼 수 있습니다"** — 결정이 아니라 운영 우선순위 후보.
- **"내부 확인 질문으로 바꿔볼 수 있습니다"** — 외부 분석가가 할 수 있는
  것의 한계를 인정하면서 운영 가치를 제시.
- **"반복되는 리뷰 표현"** — 수치 비유 회피 + 누적 의미 lock.
- **"누적되는 고객 언어"** — 동일 의도, 더 부드러운 톤.
- 보조 표현: "가능성", "후보", "검토", "권장", "확인", "이어질 수
  있습니다", "다시 봐야 한다는 뜻일 수 있습니다", "다음 한 주에 확인해볼
  후보".

### Avoid (these break tone, safety, or both)

- **"문제입니다"** — 단정. 외부 신호로 내부 원인 단정 불가.
- **"원인입니다" / "원인은 OO 때문"** — 동일 사유.
- **"반드시"**, **"꼭 해야 합니다"**, **"필수입니다"** — directive 톤.
- **"추천합니다"**, **"사세요"** — affiliate/B2C 추천 톤.
- **"무료 분석"**, **"무료 진단"** — 가격 anchor 훼손 + 분석가 톤 충돌.
- **"OO 브랜드 분석 결과"**, **"OO 제품 리뷰 분석"** — 무동의 브랜드별
  공개 분석 (`consented_case_study`만 별도 경로로 가능).
- **"스크래핑 결과"**, **"크롤링 데이터"** — 데이터 출처 노출.
- 보조 회피: "결함", "원흉", "범인", "최고/최악", "베스트/워스트",
  "퇴출", "효능 입증", "임상적으로".

### 빠른 검수 grep (검토자용)

게시물 markdown 또는 caption 텍스트에 다음 정규식이 매치되면 즉시 보류:

```
(문제입니다|원인입니다|원인은|반드시|꼭 해야|필수입니다|추천합니다|사세요|무료 분석|무료 진단|스크래핑|크롤링|결함|범인|베스트|워스트|효능|임상)
```

매치된 항목은 §6 ledger의 `notes`에 기록.

---

## 5. CTA policy

### Allowed (use exactly this — locked CTA wording)

- **"샘플 리포트 / 월간 리뷰 자산 관리 문의는 DM으로 보내주세요."**
- **"비공개 1:1 회신"** (신뢰 담보 보조 표현; CTA 직후에 위치)

위 두 표현은 v0.1 정책에서 **lock**된 CTA 표현이다. 변경하려면 정책
문서(`docs/instagram_voc_brand_strategy.md`) 명시적 revision이 선행되어야
한다. 한 게시물 단위로 우회 변경 금지.

### Avoid (CTA에 절대 사용 금지)

- **"무료"** (단어 자체) — 1차 CTA로 사용 금지. 가격 anchor + 분석가
  톤 모두 깨진다.
- **"선착순"**, **"지금 신청"**, **"이벤트"**, **"한정"**, **"특가"** —
  마케팅 후킹 어휘 일체.
- **affiliate / 추천 CTA**:
  - "이 제품 사세요", "장바구니 링크", "할인 코드", "구매 링크" 등
    소비자 구매 유도 CTA 일체.
  - 광고/협찬 표시(`#광고`, `#협찬`) 부착이 필요한 어떤 CTA도 본 채널에서
    사용 금지(B2B 신뢰 채널이므로 광고성 CTA 자체가 부적합).
- **"메시지 주세요"** 단일 — "DM으로"라는 channel 명시 필수.
- 영문 CTA 단독("Drop us a DM" 등) — v0.1에서는 한국어 CTA 통일.

### CTA 위치 규칙

- 카드 7 (CTA 카드)에 한 번.
- 캡션 마지막 단락에 한 번.
- 캡션 본문 중간/머리에 CTA 반복 금지 — 분석가 톤 약화.
- Story 재게시 시 sticker CTA는 동일 wording 사용.

---

## 6. Review ledger template

> 본 ledger 블록을 게시물 markdown(`docs/instagram_public_education_post_
> NNN.md`)의 §7에 인라인하거나, 별도 ledger doc(`docs/instagram_voc_
> review_ledger.md`)에 행 단위로 누적한다.

```markdown
### Review ledger — public_education_post_NNN

| Field | Value |
|---|---|
| `post_id` | public_education_NNN |
| `policy_commit` | 108888e (strategy doc SHA) |
| `checklist_version` | v1.0 (`docs/instagram_voc_publishing_checklist.md`) |
| `author` | (이름) |
| `author_signed_at` | YYYY-MM-DD |
| `reviewer` | (이름) — author와 다른 사람이어야 함 |
| `review_date` | YYYY-MM-DD |
| `safety_checklist_passed` | ☐ Yes (14/14) / ☐ No (실패한 항목 #N + 사유 → notes) |
| `mockup_reviewed_at` | YYYY-MM-DD by (reviewer 이름) |
| `mockup_path` | (파일 경로 또는 share link) |
| `placeholders_replaced` | ☐ `@account` / ☐ `hello@xxx` / ☐ `(이름)` / ☐ 기타 |
| `cta_wording_verified` | ☐ Yes (locked CTA 정확히 일치) |
| `hashtag_set_verified` | ☐ Yes (8~12개, 금지 태그 없음) |
| `dm_response_script_ready` | ☐ Yes (경로) / ☐ No (보류) |
| `publish_approved` | ☐ Yes / ☐ No |
| `notes` | 검토 중 발견된 이슈, 우회 시도 거절 기록, 추가 메모 |
```

`publish_approved: No`인 ledger는 archive 후 다음 revision의 입력 자료로
사용한다 — 어떤 항목이 어떤 사유로 실패했는지가 §8 automation 설계의
가장 중요한 입력이다.

---

## 7. Post-publish tracking

게시 후 7/14/30일 시점에 ledger를 채워 본 게시물을 운영 학습 자산으로
archive한다.

```markdown
### Publish record — public_education_post_NNN

| Field | Value |
|---|---|
| `published_at` | YYYY-MM-DD HH:MM (KST) |
| `instagram_url` | (게시물 영구 링크) |
| `caption_diff_vs_doc` | ☐ 동일 / ☐ 차이 있음 (사유 + 원본/실제 둘 다 보존) |
| `hashtag_diff_vs_doc` | ☐ 동일 / ☐ 차이 있음 (사유) |
| `monitoring_owner` | (이름) — §2 #10에서 지정된 책임자 |
```

```markdown
### Post-publish observations — public_education_post_NNN

| 시점 | DM 문의 수 | 샘플 리포트 발송 수 | 정책 위반 보고 | 메모 |
|---|---|---|---|---|
| +7일  |   |   | ☐ 없음 / ☐ 있음 (사유) |   |
| +14일 |   |   | ☐ 없음 / ☐ 있음 (사유) |   |
| +30일 |   |   | ☐ 없음 / ☐ 있음 (사유) |   |
```

```markdown
### Lessons for posts 002~020

> 30일 시점에 작성. 본 게시물의 실측 운영 데이터를 기반으로 다음
> 게시물 또는 §8 automation 설계에 반영할 결정.

- 가장 잘 작동한 카드 / 표현:
- 가장 약했던 카드 / 표현:
- DM 유입의 톤(질문 유형, 브랜드 규모 분포 등):
- 정책상 수정·교체가 필요했던 부분:
- 다음 게시물에 반영할 결정:
- 본 체크리스트 v1.0에 추가/수정이 필요한 항목:
```

### "정책 위반 보고" 처리

- "있음"으로 기록되면 즉시:
  1. 본 체크리스트의 어느 행이 실패했는지 식별 (보통 §3의 14개 중 하나).
  2. 해당 게시물 보존 여부 결정 (수정/삭제/그대로 두고 다음에 보완).
  3. 본 체크리스트 v1.0 → v1.1로 revision (해당 정책 갱신 또는 강화).
  4. 모든 게시물 작성자/검토자에게 revision 공지.

---

## 8. Automation implications

본 체크리스트는 **`safety_validator(public_education_mode)`의 v1 spec**으로
사용된다. 두 종류로 분류:

### 8.1 코드 자동화 가능 (Phase B candidates)

다음 항목은 정규식·constant·deterministic 검사로 자동화 가능:

| 체크리스트 행 | 자동화 형태 |
|---|---|
| §3 #4 (scraped/플랫폼 언급) | 키워드 ban list (`OliveYoung`, `Coupang`, `스크래핑`, `크롤링`, `API에서` 등) |
| §3 #5 (affiliate/추천 톤) | 키워드 ban list (`추천합니다`, `사세요`, `인생템`, `필수템`, `할인 중`, `협찬`, `광고` 등) |
| §3 #7 (미검증 수치) | regex (`\d+\s*%`, `\d+\s*배`, `\d+\s*건의`, `\d+\s*줄`) → require human override per match |
| §3 #8 (directive 어휘) | 키워드 ban list (기존 `cardnews.safety_validator.BANNED_FRAMINGS_KO` 확장) |
| §3 #9 (의학적 단정) | 키워드 ban list (`치료`, `완치`, `의학적`, `임상`, `효능`) |
| §3 #10 (CTA wording) | exact-string match against locked CTA |
| §3 #11 (placeholder) | regex (`@account`, `hello@xxx`, `\(이름\)`, `YYYY-MM-DD`, `<[^>]+>`) → 0 매치 강제 |
| §3 #13 (hashtag 정책) | 태그 수 8~12 + ban list 검사 |
| §4 회피 어휘 grep | §4 마지막 정규식 그대로 코드화 |
| §5 CTA "무료/선착순/지금 신청/이벤트/한정/특가" | 키워드 ban list |

### 8.2 사람 필수 (절대 자동화 금지)

| 체크리스트 행 | 자동화 불가 사유 |
|---|---|
| §3 #1, #2 (brand/product 식별) | 한국어 brand·SKU 표기 변형이 무한. 사람 판단 필수. consented case study 예외 처리도 사람 결정 |
| §3 #3 (raw 리뷰 인용) | 일반 한국어 리뷰 패턴 vs 특정 리뷰 출처 추출의 구분은 사람 판단 |
| §3 #6 (제품 비판) | 카테고리 단위 단정 여부의 미묘한 톤 차이는 사람 판단 |
| §3 #12 (시각 자산 누설) | 이미지에 들어간 로고/패키지 식별은 사람 검수 (자동 OCR로 보조는 가능하나 단독 통과 불가) |
| §3 #14 (2-eye review) | 사람 사인 그 자체. 자동화 절대 불가 |
| §6 ledger 작성·검토 | 동일 |
| §7 lessons captured | 동일. 게시물의 운영 학습은 사람의 해석 결과 |

### 8.3 Automation gating rule (정책으로 lock)

> **`public_education` 자동화는 다음 두 조건이 모두 충족된 후에만
> enable한다.**
>
> 1. 첫 20개 `public_education` 게시물이 본 체크리스트로 검토·통과되었고,
>    각 게시물의 ledger가 `safety_checklist_passed: Yes (14/14)` + `policy
>    issues reported: 없음`으로 기록되어 있다.
> 2. 그 20개 ledger의 `lessons captured` 누적 결과가 본 체크리스트의
>    어떤 행도 약화하지 않으며, 오히려 강화 또는 동일 유지를 권고한다.
>
> 위 두 조건이 모두 충족되기 전에는 `cardnews/public_education_planner`의
> output을 자동으로 게시 surface로 보내지 않는다. planner output이 만들어
> 지더라도 사람이 본 체크리스트로 한 번 더 통과시켜야만 게시 가능하다.

자동화 진입 후에도 **§8.2 항목은 영구히 사람 검수**다. `safety_
validator`는 §8.1을 강제하고 §8.2는 ledger field로 강제한다 (사인 부재
시 publish stage에서 차단).

---

## Appendix A — Per-post quick-run version

> 매 게시물 검토 시 본 체크리스트 전체를 다시 읽지 않아도 되도록,
> 게시물 markdown §7에 다음 컴팩트 블록을 인라인하면 된다. 본 doc은
> 정책 source-of-truth로 유지하고, 인라인 블록은 그날의 운영 기록으로
> 사용한다.

```markdown
### Quick checklist run — public_education_post_NNN

- Mode gate: ☐ public_education (private_demo/consented_case_study 아님)
- Inputs ready (10개): ☐ Yes
- Safety 14-row pass: ☐ 14/14 / 실패 #__ (사유)
- Language grep clean: ☐ Yes
- CTA exact lock: ☐ Yes
- Placeholders 0 match: ☐ Yes
- 2-eye sign-off:
  - author: (이름) @ YYYY-MM-DD
  - reviewer: (이름) @ YYYY-MM-DD
- Approved to publish: ☐ Yes / ☐ No (사유)
```

---

## Appendix B — Versioning & revision

- **v1.0** (2026-05-06): 최초 작성. `docs/instagram_public_education_
  post_001.md` (`648b728`)의 14-행 safety check를 reusable form으로 추출.
  Strategy doc (`108888e`) §4·§5·§9 호환.
- 본 체크리스트는 매 게시물의 ledger에서 발견된 정책 약점에 따라
  revision한다. revision 시:
  1. 본 doc을 직접 수정 (이전 버전은 git 이력으로 보존).
  2. 기존 게시물 ledger의 `checklist_version` 필드는 변경하지 않는다
     (그 게시물이 어떤 버전으로 검수됐는지가 audit point).
  3. 새 게시물부터는 새 버전을 적용.
  4. revision 사유와 영향 게시물 범위를 본 doc의 versioning 표에 기록.
