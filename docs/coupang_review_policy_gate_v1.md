# Coupang WING Review — Policy Gate v1

**Question.** May SellerOps, under a seller's explicit connection, read that seller's own WING 상품평 screen
`READ_ONLY` on a schedule, store what it reads, and analyse it as VOC — as a shipped product feature?

**Verdict: `POLICY_UNCLEAR`.** Not because the documents were not read. They were read, in full, and the
answer is that Coupang's rules do not address this. No clause permits it. No clause squarely prohibits it.
Three clauses reach it obliquely.

**Development posture: `PILOT_ALLOWED`. GA: `POLICY_GATED`** (§6, product-owner decision 2026-08-14).
`UNCLEAR` is not used as a blocker on building; it is used as a blocker on releasing.

This unit did no coding and no live calibration, as scoped.

---

## 1. What was read, and how

Coupang's own hosts refuse automated fetches (`coupang.com` → HTTP 403, `helpseller.coupangcorp.com` → 403).
**The bot filter was not defeated.** Spoofing headers to get past an access control is the class of thing this
repo forbids, and doing it *to read the rules about automated access* would be self-refuting.

The primary text was taken instead from the Internet Archive's dated snapshots of Coupang's own pages — the
same words Coupang published, with a timestamp attached, which is a stronger citation than a live fetch.

| Document | Snapshot | Version stamped in the document |
|---|---|---|
| 쿠팡 판매이용약관 (공통 · 마켓플레이스 · **오픈 API** · 풀필먼트) | 2023-08-07 | — |
| 쿠팡 이용약관 (회원) | 2025-12-01 | 2024-11-05 시행 |
| 쿠팡 서비스 이용 정책 | 2023-08-07 | 2018-09-07 |
| 상품평 · 상품문의 · 판매자평 운영정책 | 2023-08-07 | 2022-08-05 |

> **Staleness is a real limitation.** The seller terms snapshot is from 2023; Coupang has revised its terms
> since (a revision effective **2026-09-03** is known). Every clause below must be re-checked against the
> current text in WING before anything ships. That re-check is part of the gate in §6, and it is an
> operator task — the current text sits behind a login.

**Absence was established by counting, not by failing to find.** Keyword census over the entire seller-terms
document:

| term | hits | what they were |
|---|---|---|
| 스파이더 / 스크레이퍼 / 자동화 / 매크로 / 정보처리시스템 / 외부 프로그램 | **0** | — |
| 로봇 | 6 | all in the site's product-category nav (`로봇/작동완구`) |
| 크롤 | 1 | the word `스크롤` in a UI hint |

The seller terms contain no automation vocabulary at all.

---

## 2. 마켓플레이스 §14 — the gate the last unit named, and it is the wrong gate

`docs/coupang_review_feasibility_v1.md` §12 left the policy axis open pending "마켓플레이스 판매이용약관 §14
verbatim". It has now been read. **제14조 (금지행위)** lists 31 prohibited acts, and every one of them is
about *selling conduct*: 허위 구매, 중복 등록, 카테고리 위반, 불공정 키워드, 허위 배송 정보, 선불전자지급수단
관련 행위, 불성실한 고객대응.

Nothing about automation, collection, storage, or external programs. The only item with any reach is the
catch-all:

> 31. 회사 또는 쿠팡의 일상 업무를 방해하거나 방해할 수 있는 기타 행위 .

A paced `READ_ONLY` read of one's own screen does not obviously 방해 anything — and "does not obviously" is
not permission.

**So §14 is silent, and the last unit was watching the wrong door.** The exposure is not in the *access*
clauses. It is in the *keeping a copy* clauses. That reframing is the main result of this unit.

---

## 3. The three clauses that actually reach us

### 3.1 쿠팡 서비스 이용 정책 — 시스템 부정 행위 (the closest thing to an on-point rule)

> 1) 사이버몰 및 기타 회사의 정보처리시스템 ( 이하 ' 사이버몰등 ') 에 회사가 제공하지 않은 비정상적인 방법으로
> 접근하거나 이용하는 행위
> …
> 3) 회사가 게시한 정보를 무단으로 복제하거나 위조 · 변조하는 행위

WING is "기타 회사의 정보처리시스템". Item 1 is the access question; item 3 is the storage question, and item
3 is the sharper of the two — a stored review corpus *is* 복제 of 회사가 게시한 정보, and 무단 unless Coupang
says otherwise.

**But the scoping cuts the other way.** This table is introduced as "쿠팡이용약관 제12조 제2항에 따라 금지되는
**회원**의 행위" and its enforcement list is 회원 자격 조치. The policy's preamble covers 회원 *and* 판매자, so
the document is not cleanly one or the other. It was written about buyers abusing 사이버몰; its words are wide
enough to reach a seller reading WING. **Which of those governs is exactly what Coupang has to answer.**

### 3.2 공통 판매이용약관 §14 (비밀유지) — VOC analysis is, on the text, 가공

> ① 이용자는 서비스 사용 중 자신이 인지하거나 취득한 회사 또는 서비스에 관한 어떠한 정보 ( 구매자 정보 등
> 서비스 이용과 관련하여 취득한 개인정보보호법상 개인정보 및 회사의 기술 및 사업정보 … ( 이하 총칭하여
> "기밀정보" ) 도 본 약관의 이행 , 서비스의 사용 , 서비스를 통한 상품의 구매자와의 거래 수행 등을 위한 목적
> 이외의 목적으로 사용해서는 안됩니다 .
> ③ 이용자는 회사의 사전 서면 동의 없이 회사에 귀속된 기밀 정보를 복사 , 복제 또는 **가공**하거나 제 3 자에게
> 제공 , 판매 , 홍보 또는 공개할 수 없으며 …

Buyer information obtained through the service is 기밀정보 by this definition. §14③ forbids 복사·복제·가공 of
it without Coupang's **prior written consent**. A VOC pipeline is, in the plainest sense of the word, 가공.

The counter-argument is §14①'s purpose test: analysing your own reviews to run your own store is arguably
"서비스의 사용 … 을 위한 목적". Genuinely arguable in both directions, which is the definition of `UNCLEAR`.

### 3.3 마켓플레이스 §13 — our copy would outlive Coupang's own privacy expiry

> ② 회사는 개인정보 보호를 위하여 배송 등의 목적으로 해당 판매자에게 공개된 구매자의 개인정보를 상당한
> 기간이 경과한 후에는 비공개 처리합니다 .

Coupang deliberately *retires* buyer identifiers from seller view after a period. A SellerOps-side corpus
keeps them forever. **A stored copy defeats a privacy control Coupang built on purpose** — and it does so
silently, which is worse than doing it loudly. This is the strongest argument for the design constraint in
§6: store no buyer identifier at all.

---

## 4. A finding about code already on `main`

**오픈 API 서비스 이용약관 §5③** — a document the previous units never opened:

> ③ 이용자는 회사가 제공하는 서비스 이용과 관련하여 API 서비스를 통해 제공된 데이터에만 접속할 수 있으며 ,
> API 서비스를 통해 제공된 해당 데이터를 **복제 , 저장 또는 전송할 수 없습니다** .

and §6①6:

> 6. 제 3 자의 동의 없이 개인정보를 수집하거나 데이터베이스 , 저장매체 등에 개인정보를 저장하는 행위 ;

SellerOps **already stores Coupang INQUIRY data acquired through the official Open API** (Units 1–2, merged).
Read literally, §5③ prohibits that.

Read literally, §5③ also prohibits every ERP, OMS, and order-management integration Coupang itself promotes
its API for — no such tool could function without storing a response. So the literal reading is almost
certainly not the intended one, and the clause most likely aims at redistribution rather than at ordinary
operational persistence.

**We do not get to make that call for Coupang.** This is now a named open item against shipped code, not a
discovery about a future feature. It is listed in §5 as question Q4 and tracked as its own task; it is *not*
a reason to rip out working INQUIRY code today, and it is *not* something to leave undocumented.

> **Scope correction (product owner, 2026-08-14).** §5③ governs *data provided through the API service*.
> **REVIEW is not an API path** — Coupang publishes no review endpoint, which is why this whole workstream
> exists. So §5③ does **not** reach the WING review pilot. Q4 survives as an INQUIRY-only question, and it
> does not gate review development.

---

## 5. What to ask Coupang

Send as one enquiry (WING 판매자 문의 → 입점/제휴 or 마켓플레이스 담당). Lead with the product description so
the questions are read in context.

### 5.1 Product description to include verbatim

> SellerOps는 판매자가 자신의 판매 업무를 처리하도록 돕는 커머스 운영 도구입니다. 판매자 본인이 명시적으로
> 연결을 허용한 자신의 계정에 한해 동작하며, 다음 범위로 상품평 기능을 검토하고 있습니다.
>
> - 판매자 **본인 계정**의 WING 상품평 화면을, 판매자가 직접 로그인한 브라우저에서 **읽기 전용**으로 조회
> - 조회 대상은 **판매자 자신의 상품에 달린 상품평**
> - 저장 항목: 별점, 등록일, 상품 식별자(노출상품ID/옵션ID), 상품평 본문
> - **저장하지 않는 항목: 구매자 ID·닉네임 등 작성자 식별정보 일체, 이미지·동영상 원본**
> - 용도: 해당 판매자 본인에게만 제공되는 VOC 분석 및 CS 업무 지원
> - **재배포·외부 공개·제3자 제공·광고 활용 없음**. 다른 판매자에게 제공하지 않음
> - 공개 상품 페이지 크롤링은 하지 않음. 미공개 내부 API 호출도 하지 않음
> - 조회 주기는 판매자당 1일 수 회 수준으로 제한하며, 쿠팡 시스템 부하를 고려해 조정 가능

### 5.2 The questions, in priority order

**Q1 — the actual gate.**
판매자가 자신의 계정으로 로그인한 상태에서, 판매자 본인의 WING 상품평 화면을 소프트웨어를 이용해 읽기 전용으로
조회하는 것이 「쿠팡 서비스 이용 정책」의 '시스템 부정 행위' 1)호(회사가 제공하지 않은 비정상적인 방법으로
접근하거나 이용하는 행위)에 해당합니까? 해당 조항이 **판매자의 WING 이용**에도 적용됩니까, 아니면 회원의
사이버몰 이용에만 적용됩니까?

**Q2 — storage.**
판매자가 자신의 상품에 달린 상품평(별점·등록일·본문)을 자신의 업무 시스템에 저장하여 VOC 분석에 사용하는 것이
「쿠팡 서비스 이용 정책」 '시스템 부정 행위' 3)호(회사가 게시한 정보를 무단으로 복제) 또는 판매이용약관
제14조 제3항(기밀정보의 복사·복제·가공)에 해당합니까? 해당한다면 제14조 제3항의 **'회사의 사전 서면 동의'**를
받을 수 있는 절차가 있습니까?

**Q3 — the sanctioned route, if there is one.**
상품평 데이터를 판매자에게 제공하는 **공식 경로**(Open API, 공식 export, 파트너/솔루션 제휴 등)가 현재
존재하거나 계획되어 있습니까? 있다면 그 경로의 신청 방법과 조건은 무엇입니까?

**Q4 — the one about shipped code.**
오픈 API 서비스 이용약관 제5조 제3항은 "API 서비스를 통해 제공된 데이터를 복제, 저장 또는 전송할 수 없습니다"
라고 규정합니다. 판매자 연동 솔루션이 주문·문의 등 API 응답을 **판매자 업무 처리 목적으로 자신의 시스템에
저장**하는 것도 이 조항의 금지 대상입니까? (ERP·주문관리 솔루션의 통상적인 연동을 포함하여 답변 부탁드립니다.)

**Q5 — personal data.**
상품평에 노출되는 구매자 ID 일부를 **저장하지 않고** 별점·등록일·본문만 저장하는 경우에도 제한이 있습니까?

### 5.3 What an answer must contain to count

A reply is only usable as a gate release if it is **in writing, attributable to Coupang, and answers Q1 and
Q2 directly**. "문의 주셔서 감사합니다" is not an answer. A phone call is not an answer. Silence is not
consent — see §6.

---

## 6. The development posture — `PILOT_ALLOWED`, GA `POLICY_GATED`

**Product-owner decision, 2026-08-14.** `POLICY_UNCLEAR` stands, but **it is not used as a blocker on
technical development.** The reasoning on the record:

- §5③ governs API-provided data, and REVIEW is not an API path (§4 scope correction).
- No explicit permission *or* prohibition of seller-owned WING `READ_ONLY` review automation has been found.
- Commercial services (CREMA, ReviewAid) offer Coupang review back-fill, scheduled sync, and migration to a
  seller's own mall. **This is market precedent, not permission.** It is recorded because pretending not to
  know it would be dishonest, and it carries **zero evidentiary weight** on the policy axis — the standing
  rule that the existence of third-party crawlers is never an argument for allowance is unchanged.

So: **build it, pilot it, do not GA it.** The gate moved from "may we write code" to "may we release".

### 6.1 Data minimization — binding for the pilot

These are not aspirations. They are the shape of the pilot, and each is enforced by a test rather than by
intention:

| # | Constraint |
|---|---|
| **D1** | **Seller-owned WING only.** The seller's own account, their own products. |
| **D2** | **No public product-page access.** Excluded as a path, permanently and independently. |
| **D3** | **No author collection or storage** — 구매자 ID, nickname, masked ID, or any author-derived value. Not stored, not logged, not used in a dedupe key. |
| **D4** | **No raw HTML, DOM, screenshots.** The value-free census discipline from the three discovery sittings carries forward. |
| ~~**D5**~~ | ~~No permanent storage of review body text.~~ **Lifted 2026-08-14 — see §6.1.1.** |
| **D6** | **No transmission to external LLMs** in this unit. Not required for the MVP. |
| **D7** | **Storable:** review raw text, rating, date, product identifiers (productId / vendorItemId), media metadata. Nothing else. |
| **D8** | **No marketplace writes.** Coupang offers sellers no reply to a 상품평, so there is no reply, draft, or write flow to build — and none is built. |

#### 6.1.1 D5 lifted — raw review text is persisted

**Product-owner decision, 2026-08-14, made with the clauses in view.** Raw review text is stored.

This is the decision that moves the channel from change-detection to actual VOC: a seller can now be told
*what buyers said*, not merely that ratings moved. It is also the decision that runs closest to the clauses
in §3 — 서비스 이용 정책 '시스템 부정 행위' 3) (무단 복제) and 공통 §14③ (복사·복제·가공). Storing the text
is the act those clauses describe most directly.

**It is recorded here as a product decision, not as a legal determination.** `POLICY` stays `UNCLEAR`; the
GA gate (§6.2) is unchanged and still requires a written answer. What changed is that the pilot no longer
holds back the part of the product that makes it worth building.

**D3 did not move with it.** Author values remain excluded — no 구매자 ID, nickname, or masked ID, anywhere,
including dedupe keys. Review text is stored; the person who wrote it is not identified. That separation is
the reason this is defensible at all, and it is enforced by test.

### 6.2 GA release gate

The pilot may run. **Coupang REVIEW may not go GA** unless all of these hold:

1. **G1 — Written answer.** Q1 and Q2 answered in writing by Coupang. **A non-answer is a `DISALLOWED` for
   GA purposes.**
2. **G2 — Current text.** The clauses in §2–§4 re-verified against the terms then in force in WING, not
   against the 2023 snapshot this document rests on.
3. **G3 — Zero buyer identifiers** (= D3), permanently. This holds *regardless* of what Coupang answers,
   because §13② shows Coupang retires those identifiers on purpose.
4. **G4 — Seller-scoped and non-redistributable.** Visible only to the seller whose account produced it. No
   cross-seller aggregation, no external publication. §2②6 of the 상품평 운영정책 shows Coupang treats
   republication of reviews as its own right to license — so we take none of it.
5. **G5 — Seller consent is explicit and revocable**, and revocation deletes the stored corpus.
6. **G6 — Raw review text.** This document originally required any relaxation of D5 to be gated on G1.
   **It was not.** The product owner lifted D5 on 2026-08-14 for the pilot, deliberately and with the
   clauses in view (§6.1.1). Recorded as it happened rather than reworded to look satisfied: **raw text
   persistence is in the pilot ahead of the policy answer, and remains gated on G1 for GA.**

If G1 fails, the honest outcome is not "ship it quietly". Coupang REVIEW stays a pilot, and the roadmap
says so.

---

## 7. The axes

| Axis | State | Basis |
|---|---|---|
| **TECHNICALLY_POSSIBLE** | **CONDITIONAL_YES** | three live sittings, `docs/coupang_review_feasibility_v1.md` |
| **POLICY** | **UNCLEAR** | §14 read and silent; three clauses reach obliquely; no permission anywhere. §5 is the enquiry that would resolve it |
| **DEVELOPMENT** | **PILOT_ALLOWED** | product-owner decision, §6. Bounded by D1–D4, D6–D8; **D5 lifted** (§6.1.1) |
| **GA_RELEASE** | **POLICY_GATED** | G1–G6, §6.2 |
| **PRODUCT** | **acquisition + VOC + locate** | list / detail / new-review notification, and `[쿠팡에서 보기]` → Action Window exact locate. **Never a reply channel** — WING offers no reply (D8) |

`docs/multi-channel-connector-roadmap.md` §4.1 keeps Coupang REVIEW at **BLOCKED**, and the connector's
`REVIEW_API` stays an honest `unsupportedScope`. Nothing here promotes anything.

---

## 8. Classification of every unresolved point

- **Repository-verifiable:** whether stored INQUIRY data can be scoped or retained differently (§4, Q4 —
  INQUIRY only; it does not gate review work).
- **External-research required:** the current text of the seller terms and 서비스 이용 정책 (G2) — behind a
  WING login, so an operator task.
- **Product-owner decision — settled 2026-08-14:** development posture is `PILOT_ALLOWED` under D1–D7.
  **Still open:** whether to send the §5 enquiry, and when to revisit **D5** (review body text), which is
  what separates a change-detection channel from a VOC-analysis one.
- **Coupang decision:** Q1–Q5. Nobody else can answer these, and no amount of further reading will.

---

## 9. Live findings, 2026-08-14 — and two defects the data found in the probe

Two `READ_ONLY` sittings on the operator's own 상품평 screen, one manifest each.

### 9.1 What the screen is

Ten reviews, each its own `TBODY`, resolved from the `노출상품ID (옵션ID)` column with 20 field labels
agreeing. Every row carries a detail link, an image, and a star-class element. Row widths uniform at 15
cells. Pager reaches page 5; **0 `input[type=date]`**; four `<select>`s carrying 6, 3, 3 and 3 options.

### 9.2 The key question, answered: **there is none**

| | |
|---|---|
| Best column (position 4) | 10 of 10 rows populated, **9 distinct values** |
| `distinctRowSignatures` | **9 of 10** |
| Verdict | **`NO_UNIQUE_POSITION`** |

Two reviews are identical in every number the screen prints. No single-column key, and no composite key —
the second is what `distinctRowSignatures` exists to say, and no per-column reading could have said it.

### 9.3 The probe was wrong twice, and its own output is what proved it

**First: bucketing by digit length.** The run reported a 10-digit identifier "unique where present, on 7 of
10 rows" and called it `PARTIAL_COVERAGE`, 3 rows missing. The per-position reading showed the same column
holding 8-, 9- and 10-digit values at 2 + 1 + 7 = 10. **No row was missing**, and two rows *collided*. A
fully-populated non-unique column had been reported as a partially-covering key — the opposite state, stated
confidently. Length is a property of a value, not of the question.

**Second: counting runs instead of rows.** Rewriting the rule, the first version counted each digit run at a
position separately. A date cell prints `2026`, `08`, `11` on every row, so three identical rows scored three
distinct values and passed as a key. Caught by a fixture before any rerun. What is counted per position is
now the row's whole tuple, sorted.

Both are the same failure this workstream keeps meeting: **an indirect measurement answering wrongly and
confidently.** It is the reason §5d of the approval contract now permits direct reading during seller-owned
`READ_ONLY` calibration — a count-only probe does not merely answer slowly, it can answer backwards.

### 9.4 The dropdowns are not what we guessed

Zero of the four selects matched any period word we supplied, and — after adding `N개월` / `N일` / `N년`
shape patterns — zero matched any period *shape* either. Whatever those dropdowns offer, it is not a period
range in the vocabulary or the form we assumed. **Incremental acquisition by date range is unestablished**,
and the pager (5 pages) is the only paging structure actually observed.

### 9.5 What acquisition gets to use

A **content hash**, which is the ingestion spine's existing fallback when a source carries no `external_id`.
The two colliding rows differ in what the buyer wrote. This is available only because §6.1.1 lifted D5; the
earlier instruction not to key on review body was given when review body was not stored, and is superseded
by that decision rather than quietly ignored.

**`[쿠팡에서 보기]` cannot be anchored on a number.** No per-row-unique value exists to re-find a review by,
so locate has to match on what is visible — which §5d now permits and which the previous posture did not.
