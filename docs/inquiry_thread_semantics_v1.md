# Cafe24 Thread Semantics Recovery v1 — 답글은 문의가 아니다

**날짜:** 2026-08-25 · **브랜치:** `feat/agent-evidence-scope-integrity` · **marketplace WRITE 0 · 이 문서 시점까지 marketplace 요청 0**

선행: `docs/inquiry_answer_execution_v1.md` (승인된 bounded READ proof — verdict
`STANDARD_BOARD_REPLY_ARTICLE`). 그 proof가 드러낸 결함을 이 package가 고친다.

> **한 문장.** Cafe24 게시판에서 답변은 질문에 달린 **자식 글**이고, 우리는 그 부모 포인터를
> 받아 놓고 버리고 있었다 — 그래서 **판매자 자신의 답변이 「고객이 답변을 기다리는 문의」로**
> 저장돼 미답변 큐에 앉아 있었다.

---

## 1. 현재 mapper 감사 — 무엇을 읽고 무엇을 버렸는가

`GET /api/v2/admin/boards/6/articles` 응답 한 행에 대해, 이 package **이전**의 상태:

| source field | 이전 | 이후 | 비고 |
|---|---|---|---|
| `article_no` | 읽음 | 읽음 | dedup key `cafe24:b6:a{n}` |
| `parent_article_no` | **버림** | **읽음** | 스레드 역할을 결정하는 유일한 관계 |
| `reply_depth` | **버림** | **읽음** | 교차 확인 신호 |
| `reply_sequence` | **버림** | **읽음** | 기록만 (판정에 쓰지 않음) |
| `reply_status` | 읽음 | 읽음 | `N`/`P`/`C` — 유일한 답변완료 신호 |
| `reply` | 버림 | 버림 | **답변 신호가 아니다** — 답변된 글에서도 `F` |
| `reply_user_id` | 버림 | **버림 (의도적)** | §3 |
| `created_date` | 읽음 | 읽음 | |
| `content` / `title` | 읽음 | 읽음 | 판매자 소유 데이터 |
| `secret` | 읽음 | 읽음 | fail-closed 비밀글 게이트 |
| `order_id` / `product_no` | 읽음 | 읽음 | 정확 결합 전용 |
| `writer` · `writer_email` · `member_id` · `client_ip` · `nick_name` | 투영 안 함 | 투영 안 함 | 고객 PII — 투영하지 않은 필드는 실수로 저장될 수 없다 |

**결정적 사실: 이 수정에 새 요청·새 endpoint·새 scope가 필요 없다.**
`Cafe24BoardArticlesClient`는 필드를 제한하지 않으므로 `parent_article_no`는 **지금까지 모든 응답에
이미 들어 있었다**. 우리가 record에 칸을 만들지 않았을 뿐이다.

### root / reply 판정 규칙

```
parent_article_no > 0  →  REPLY
reply_depth      > 0  →  REPLY      (신호가 어긋나면 fail closed)
그 외                  →  ROOT
```

**article_no 인접성은 쓰지 않는다.** "247이 246 바로 다음이니 246의 답변"은 같은 종류의 추론이고,
같은 분에 두 고객이 글을 쓰면 인접성은 우연이다. 우연으로 진짜 질문을 숨기면 사과로 복구되지 않는다.
`Cafe24ThreadStructureTest`가 `src/main` 전체를 훑어 article 번호 산술이 없음을 확인한다.

두 신호가 어긋나는 경우(부모는 있는데 depth 0, 또는 depth>0인데 부모 없음)는 **관측된 적이 없고**,
어긋나면 REPLY로 fail close하면서 수집 회계에 `스레드신호불일치=` 카운트로 드러낸다. 이 방향으로
닫는 이유: 분류는 매 sweep마다 출처에서 다시 계산되므로 되돌릴 수 있고, 반대 방향의 실수(우리 답변을
고객 질문으로 보여주는 것)는 이미 한 번 일어났다.

---

## 2. Canonical thread semantics

증명된 것은 하나다: **답글은 새로운 root inquiry가 아니다.**

`SourceThreadRole { ROOT, REPLY }` — 채널 중립 어휘. `null`은 정직한 값이며 "출처가 스레드 구조를
발행하지 않는다"(파일 업로드, ESM, NAVER, Coupang) 또는 "아직 물어보지 않았다"를 뜻한다.
**`null`은 「출처가 ROOT라고 말했다」가 아니다** — 이 구분이 historical backlog 처리의 전부다.

관계 저장은 새 테이블이 아니라 **행 위의 값 두 개**다 (`source_order_ref`와 같은 방식):

```
inquiries.thread_role                 varchar(16)   ROOT | REPLY | null
inquiries.thread_parent_external_id   varchar(200)  부모의 external_id (REPLY에만)
```

부모를 **같은 식별자 공간**(`cafe24:b6:a246`)으로 가리키므로 두 번째 식별자 어휘도, join 테이블도
필요 없다. 같은 사실이 틀릴 수 있는 자리를 하나 더 만들지 않는다. (`V74__inquiry_thread_role.sql`)

---

## 3. Seller-answer attribution — verdict: `THREAD_REPLY_UNKNOWN_ACTOR`

자식 글의 본문을 부모의 `answer_body`로 올리려면 **판매자가 썼다는 것**을 증명해야 한다. 감사 결과:

| 근거 후보 | 상태 |
|---|---|
| 자식의 `reply_user_id` | **부재** — 라이브 관측에서 자식에는 없었다 |
| 자식의 `member_id` / `writer` | 고객 PII를 함께 나르는 필드 — 이 저장소가 투영하지 않는다 |
| 부모의 `reply_user_id` | **존재**(C·P에), 그러나 그것은 **부모**에 대한 사실이다 |
| `reply_depth` / `reply_sequence` | 위치이지 행위자가 아니다 |
| 공식 계약 | 답글의 작성자에 대해 아무 말도 하지 않는다 |

**"부모가 C니까 자식은 판매자 답변"은 역추론이고 하지 않는다.** 게시판의 답글은 원칙적으로 다른
고객도 달 수 있다.

⇒ 자식 글은 `THREAD_REPLY_UNKNOWN_ACTOR` 상태로 **보존**되고, `answer_body`/`answered_at`으로
**승격되지 않는다**. 부모의 `reply_status=C` → `ANSWERED`는 출처가 실제로 증명한 것이므로 그대로 둔다.

`reply_user_id`를 투영하지 않기로 한 이유도 여기 있다: 그것이 증명할 수 있는 유일한 것을 실제로는
증명하지 못하면서(자식에 없다), 다른 코드가 나중에 저장할 수 있는 운영자 신원을 record에 올린다.

---

## 4. Ingestion correction (신규 수집)

- `ROOT` → 지금까지와 동일한 canonical Inquiry.
- `REPLY` → **독립 Inquiry를 만들지 않는다**는 뜻이 아니라, 행은 저장하되 **고객 문의로 취급하지
  않는다**: work item을 열지 않고, `operational_state = EXCLUDED_THREAD_REPLY`로 현재 운영 읽기에서
  빠진다. 삭제하지 않는 이유는 §8.
- 부모의 `answered state`는 출처가 증명하는 범위(= `reply_status`)에서만 갱신. `answer_body`/
  `answered_at`은 이 package에서 Cafe24에 대해 **쓰지 않는다**.
- `reply` 필드는 답변 신호로 쓰지 않는다(계속).

**재수집이 스스로 고친다.** `sourceUnchanged()`에 thread role을 넣었으므로, 본문이 영원히 바뀌지 않는
행도 "출처의 구조적 역할을 처음 읽은" 순간 변경으로 인식돼 갱신된다. 다만 routine lane의 창은
**14일**이고 저장된 Cafe24 행은 2014–2025년이므로, **historical backlog는 routine 수집으로는 절대
닿지 않는다** — §6의 bounded re-read가 필요한 이유.

---

## 5. 기존 데이터 오염 감사 (adjacency 사용 안 함)

Demo Org(`데모 제조사`) · Cafe24 board 6 · 2026-08-25 기준:

| 구분 | 건수 |
|---|---|
| Cafe24 미답변 · 운영 노출(ACTIVE) | **69** (계정 결합 68 + 계정 미결합 1) |
| 그중 external `article_no` 파싱 가능 | **69 / 69** — 전부 exact re-read 가능 |
| 그중 `inform_status` 공백 | **45** |
| 그중 `N` / `P` | 21 / 3 |
| Cafe24 답변완료(`C`, ACTIVE) | 43 (+ 계정 미결합 1) |
| Cafe24 미답변 · `EXCLUDED_SPAM`(운영 비노출) | **3,199** (전부 `N`, 계정 미결합) |

**오염 건수는 offline으로 확정할 수 없다 — 그것이 정직한 답이다.** `parent_article_no`를 저장한 적이
없으므로 DB만으로 root/reply를 가를 수 있는 행은 **0건**이다. 증명된 오염은 **1건**(`cafe24:b6:a247`,
라이브 READ로 `parent=246` 확인)이다.

`inform_status` 공백(45)은 **출처가 준 신호**이고(라이브에서 자식 글의 `reply_status`는 `null`이었다)
adjacency가 아니므로 **re-read 대상을 좁히는 근거로는 쓸 수 있으나 분류가 아니다**. 공백인 root 글이
있을 수 있고, 그 가능성을 배제할 관측이 없다. **"C 바로 다음 번호" 37건을 자동 변경/삭제하지 않는다.**

`EXCLUDED_SPAM` 3,199건 중에도 답글이 섞여 있을 개연성이 크지만, 이미 운영 비노출이므로 이 package의
복구 대상이 아니다(§6의 목적은 "사용자에게 미답변 업무로 보이는 행"이다).

### downstream 오염

| 소비자 | 상태 |
|---|---|
| `inquiry_work_item` (OPEN) | 오염 — 자식 글마다 OPEN 작업이 열려 있다 (`a247` 확인) |
| Dashboard / Inbox / Coverage / Item Analysis / Customer Memory | 전부 `operational_state = ACTIVE` 게이트를 이미 통과하므로 **같은 수정으로 함께 교정된다** |
| 작업 큐 (`findOperationalByOrgIdAndPhase`) | **게이트가 없었다** — `data_origin='REAL'`만 확인 → 이 package에서 `ACTIVE` 절 추가 |
| `inquiry_proposal` | b6에 5건, 그중 **3건이 `inform_status` 공백 행** — AI 초안이 (아마도) 우리 답변에 대해 만들어졌을 후보 |
| `answer_memory` | **0건** — 구조적으로 오염 불가: 임포터는 `answer_body`가 있는 행만 읽고 Cafe24는 그것을 채운 적이 없다 |
| `customer_memory_entries` | b6 기원 3,425건 — 읽기가 `operational_state`를 이미 존중하므로 같은 수정으로 교정 |
| Agent / RAG | Operator는 `/api/inquiries`(작업 큐)를 읽으므로 큐 게이트 수정으로 함께 교정. Agent invariant는 새로 만들지 않았다 |

---

## 6. Bounded reclassification 전략

목적은 10년치 재수집이 아니라 **지금 화면에 「미답변 업무」로 떠 있는 행이 정말 root inquiry인지**
확인하는 것이다.

- 대상: 그 계정의 **운영 노출 미답변 행** (`findActiveUnansweredForAccount` — ACTIVE · REAL ·
  UNANSWERED · 계정 결합, id 순).
- 방법: LIST의 **`article_no` 다중값 exact filter** (사본이 comma 허용을 명시). date range 없음,
  offset 없음, search/keyword 없음.
- 읽는 필드: `article_no`, `parent_article_no`, `reply_depth`, `reply_sequence`, `reply_status`,
  `created_date`. **본문·작성자·PII는 이 재분류에 필요 없다.**
- 응답하지 않은 번호는 **아무것도 바꾸지 않는다** — 한 번의 부재는 삭제가 아니다.
- 구현: `Cafe24ThreadReclassifier` + `Cafe24ThreadReclassificationRunner`. **4중 게이트**(커넥터 플래그 ·
  자체 플래그 · account-id · `dry-run` **기본값 true**). 스케줄러·수집 경로·HTTP 표면 어디에도 연결되지
  않았고, 요청 상한은 호출 **전에** 검사한다.

---

## 7. Live READ manifest — **여기서 멈춘다**

| 항목 | 값 |
|---|---|
| Org | `데모 제조사` `7146c50f-ff6d-4c83-ae96-18c930e6d8e0` |
| Cafe24 account | `78da0eb3-3088-4ecb-919f-3e08dad1d402` (`카페24 자사몰`, CONNECTED) |
| endpoint | `GET /api/v2/admin/boards/6/articles?article_no={exact ids}&limit={batch}` — **이 하나뿐** |
| scope | `mall.read_community` (**보유 중**; 변경 0, 재동의 0) |
| 대상 행 | **68건** (계정 결합 · REAL · ACTIVE · UNANSWERED). 계정 미결합 1건(`a284`)은 자격증명 경로가 없어 제외 |
| 요청 방식 | 20개씩 comma batch → **4회**. 상한 **6회** |
| 읽는 필드 | `article_no` · `parent_article_no` · `reply_depth` · `reply_sequence` · `reply_status` · `created_date` |
| 폐기 | 본문 · 제목 · 작성자 · 이메일 · member_id · IP · 전화 — 전부 미투영 |
| 보고 | **카운트만** (요청·응답·미응답·답글판정·원글확인·신호불일치) |
| 관측 중 DB mutation | **0** (`dry-run=true`로 1회 실행) |
| marketplace WRITE | **0** |
| 관측 외 부작용 | 인증 refresh 1회의 단일사용 토큰 회전 write-back(모든 Cafe24 호출에 불가피, 상시 routine과 동일) |

**두 번째 org를 자동 포함하지 않았다.** `데모 테스트`(`f5868cf8…`) org가 자체 Cafe24 계정
(`ce40f950…`)과 자체 자격증명으로 같은 board를 갖고 있고(미답변 69 · 공백 45), 계정이 다르므로
**별도 승인 라인**이 필요하다. 결정하지 않고 올린다.

**broad date sweep은 이 계획에 없다.** 필요해지면 그 이유부터 보고하고 승인 없이 실행하지 않는다.

---

## 8. Proof 이후의 repair (설계 — 아직 실행 안 함)

READ에서 답글로 확인된 행**만** 대상. repair semantics:

- `thread_role = REPLY` · `thread_parent_external_id = 부모 키` 기록
- projector가 `operational_state = EXCLUDED_THREAD_REPLY`로 투영 → 운영 큐·카운트에서 빠짐
- **DELETE 없음.** 본문·상태·work item·감사 기록·customer memory 모두 그대로. 역사/감사 읽기는 불변
- **OPEN work item을 닫지 않는다.** 판매자가 dismiss한 적도, 처리한 적도 없다 — disposition을 쓰면
  아무도 내리지 않은 결정을 원장에 남기게 된다. 큐는 `ACTIVE` 게이트로 지나간다
- `data_origin`(REAL/DEMO_SEED) 변경 0

`EXCLUDED_THREAD_REPLY`가 `EXCLUDED_SPAM`보다 우선한다: 전자는 "그것은 애초에 고객 문의가 아니었다"이고
후자는 고객 문의에 대한 판단이다. 판매자의 dismissal은 work item에 그대로 남으므로 잃는 것이 없다.
projector는 대칭이다 — 재읽기가 `ROOT`라고 하면 행은 즉시 운영으로 돌아온다.

---

## 9. Repair 후 재계산 (예상, 실측 아님)

재분류 전 Demo Org 현재값:

| 표면 | 값 | corpus |
|---|---|---|
| Inbox 미답변 | **77** | ACTIVE 전체 (CAFE24 69 · COUPANG 5 · NAVER 3) |
| Dashboard 미답변 | **28** | ACTIVE **비밀글 제외** |
| 작업 큐 OPEN | **64** | OPEN work item ∩ REAL ∩ (이제) ACTIVE |

세 숫자가 서로 다른 것은 이 package의 결함이 아니라 **corpus가 다르기 때문**이고(비밀글 제외 여부,
work item 존재 여부), 그 사실 자체가 별도로 검토할 값어치가 있다.

재분류 후 값은 **출처가 무엇이라고 답하는지에 전적으로 달려 있다.** `69`에도 `20`에도 맞추지 않는다.
20 vs 69 product-policy 논의는 thread 오염을 제거한 뒤에도 차이가 남을 때만 다시 연다.

---

## 10. Answer Memory recoverability — **불가 (이번에는)**

`answer_memory`에 Cafe24 기원 행은 **0건**이고, 구조적으로 그럴 수밖에 없다: 임포터는
`status='ANSWERED' AND answer_body IS NOT NULL`인 행만 읽고 Cafe24 mapper는 `answer_body`를 채운 적이
없다.

자식 글의 본문이 곧 답변 본문이므로 재료는 있다. 그러나 `IMPORTED_SELLER_ANSWER`로 올리려면 §3의
두 조건(**actor 증명** + **parent relation 증명**)이 모두 필요한데, actor가 미증명이다.
⇒ **연결하지 않는다.** AI 초안에서 memory를 만들지 않는다는 기존 fence는 그대로.

---

## 11. 남은 WRITE blocker (기록만)

증명된 WRITE 후보는 `POST /api/v2/admin/boards/{board_no}/articles` + `reply_article_no = 부모`.
미증명: `writer` · `member_id` · `client_ip` · `title` · 그리고 **`reply_status=C`가 부모에 붙는지
자식에 붙는지**. 이번 package에서 이 값들을 추측해 정하지 않았다. `mall.write_community` 미보유,
onboarding write-scope 가드 무변경.

---

## 12. 하지 않은 것

Cafe24 WRITE · OAuth write scope 개방 · actor 값 설정 · adapter 구현 · historical date crawl ·
adjacency 기반 자동 수정 · 자식 글의 판매자 귀속 · `EXCLUDED_SPAM` 3,199건 손대기 · board 4(리뷰)
답글 경로 수정(같은 성격의 결함이 있을 수 있으나 범위 밖 — **관측으로만 보고**) · dashboard 재설계 ·
20 vs 69 결정 · 새 커넥터 · 새 HITL architecture · Agent invariant 신설.
