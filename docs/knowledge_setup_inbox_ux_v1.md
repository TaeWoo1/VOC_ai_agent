# Knowledge Setup & Inbox UX v1

2026-09-04. Retrieval / Grounded Drafting / the Knowledge model are used **as they are**; the subject
of this package is the seller's experience, not the algorithm.

The sentence the product should be able to say:

> 「이미 사용 중인 자료를 연결해 주세요. reviewnary가 먼저 읽고, 모르는 것만 물어보겠습니다.」

and not

> 「회사 지식을 처음부터 입력하세요.」

Marketplace calls **0** · marketplace WRITE **0** · model calls **0** · migrations **0**.
No evidence row.

---

## §0 The audit, in a real browser, before any code

Read-only on the canonical Demo Org, and on a disposable org created through the product's own
signup. Screenshots are outside the repository (they carry real customer sentences).

**A1 — the screen did not keep its own title.** `/knowledge` is headed 「reviewnary가 알고 있는
정보」 and stated nothing it knew: one 확인 필요 card, three files, and two links. The Demo Org holds
**11** written product facts, **2** operating rules, **23** past answers and **308** collected
products, and none of those numbers appeared anywhere.

**A2 — 「답변 기준으로 등록」 filed a QUESTION as the company's answer.** A 정보 필요 candidate stores
the ask; the screen sent `accept` with an empty body; `accept` fell back to the stored text. Proven
live on the QA org: pressing it wrote a product FAQ whose body was 「'…'에 대해 고객에게 안내하는
공식 기준이 있나요? 이 상품에 저장된 지식에서 찾지 못했습니다.」 — indexed and citable, so the next
customer to ask that question would have been answered with reviewnary's own confusion. **P0.**

**A3 — three screens, three names, one set of rows.** An uploaded shipping policy appeared in
`/knowledge` under 자료 and in `/settings/policies` under 「운영 정책 / 답변 기준」, and neither said
the other existed. The knowledge screen linked to it as a third name, 「운영 정책」.

**A4 — the 자료 list could show what it could not create.** `POST /api/knowledge/documents` has taken
`scope=PRODUCT` since Knowledge Sources & Acquisition v1; the only upload control hard-coded `ORG`,
and the product screen had none. The Demo Org's list contains PRODUCT documents to this day.

**A5 — the list stated two of the six facts a person can answer about a file.** Name and scope; not
kind, not when, not who. All three were already on the DTO.

**A6 — the company-wide gap was a link.** A PRODUCT gap opened a quick-add; an ORG gap said
「운영 정책에 추가하기」 and sent the seller to a settings screen to write a title and a body and come
back and regenerate by hand. Measured: 「제주도인데 배송이 며칠 걸리나요?」 — a question with a
perfectly ordinary answer — named what was missing and offered nothing.

**A7 — first day.** Two minutes after signup: 「지금 확인하실 항목은 없습니다」, an empty 자료, and a
link list. Arithmetically true, and it reads as 「you have nothing; start typing」. The page's only
prominent control was 「과거 답변에서 찾아보기」, which for a 0-answer company can only report that it
found nothing.

**A8 — the inquiry lane produced gaps and dropped them.** `ReviewDraftComposer` has filed its asks
into 확인 필요 since Grounded Review Drafting v1; `InquiryDraftComposer` computed the same verdict,
returned it to whoever was looking at that one inquiry, and filed nothing. So the inbox meant to
collect 「reviewnary가 모르는 것」 held half of them.

---

## §1 The seller's mental model

Five words, all of them already the product's own, owned in one place
(`frontend/src/lib/knowledgeWords.ts`):

**확인 필요 · 상품 지식 · 운영 기준 · 자료 · 과거 고객 응답.**

Internal meanings are unchanged. What changed is that the rendering table is one table, so
`SHIPPING_POLICY` has exactly one Korean name and a token the table cannot name renders as **nothing**
rather than as itself. `/settings/policies` is 「운영 기준」 everywhere (route unchanged) and its own
type list is now that table rather than a second copy of it.

---

## §2 `/knowledge` states what it knows

`GET /api/knowledge/summary` → six counting queries, no joins, no model.

> 상품 지식 · 운영 기준 · 연결된 자료 · 과거 고객 응답

**The first three partition the two corpora.** A knowledge source is either something a person typed
(`document_name is null`) or something that came out of a file, so nothing is counted twice and the
three numbers add up to the size of the library — the only reason to print four numbers instead of
one. A test asserts the partition rather than the values.

**`products` is deliberately not part of that sum.** It is what reviewnary read from the channels
without being taught, and it is on the screen so that a company that has connected but written
nothing is not told it has nothing: 「채널에서 가져온 상품 정보 142개를 이미 읽고 있습니다.」

**`pastAnswers` is neither.** Past answers are consulted and never official, and the screen says so in
words rather than by putting them in the same group (§7).

Order: **확인 필요 → 알고 있는 정보 → 자료 → 직접 등록.** 확인 필요 first because it is the only part
with anything to decide.

---

## §3 Knowledge Inbox

Three groups, because they call for three different readings.

**정보 필요** — a question a draft ran into. The stored text is the ASK, so it is shown as one and
never offered as an answer: 「답변 기준 추가」 opens the editor with an **empty** body.

**확인할 후보** — a sentence this seller has written to customers many times, verbatim. It is theirs,
so the editor opens **holding** it and they confirm or edit.

**자료 문제** — only what is deterministically detectable today: an ACTIVE document that produced no
passages cannot be quoted, and a list that showed it as normal would be hiding that. **No conflict
engine** was built and nothing is guessed. An already-retired file is not a problem — the seller
answered that question.

**The P0 is closed at the service, not on the screen.** `KnowledgeCandidateService.accept` refuses a
`DRAFT_GAP` accepted with no content (400 「고객에게 안내할 내용을 적어 주세요.」). A
`REPEATED_ANSWER` keeps its fallback, because that text is an answer the seller already wrote.

**And the inquiry lane now files its gaps** (§A8): after the version is written, when **both** lanes
came back `ABSENT` about a noun the customer actually wrote. Both lanes, because a question the
operating rules answered is not a gap in the product's knowledge; the customer's own noun, because
an ask a seller cannot recognise is an ask they will not answer. Idempotent by the question, and it
cannot throw into the caller — a knowledge inbox must never be able to fail a draft.

---

## §4 Structured Quick Add

One editor (`KnowledgeQuickAdd`), three callers: the inquiry gap, the review gap, the inbox.

```
상품 지식 추가
적용 범위  이 상품        출처  판매자가 직접 입력
주제       [상품 설명 — 이 상품이 무엇인지, 어떤 점이 다른지 ▾]
고객에게 안내할 내용
[                                                   ]
규격       [전체 상품 공통 ▾]
[저장하고 다시 답변 만들기]  [취소]
```

ORG shows 「회사 전체」 and the operating-rule topics instead. **Scope is shown, not asked** — the
seller opened this from a product or from the company's rules.

**It saves nothing itself.** The caller owns the write, because the same form serves three different
ones and a component that both edits and decides where the row goes is two components arguing about
one truth. The 규격 control renders **only when the caller's write can carry one**: the inbox path is
`accept`, which stores PRODUCT or ORG and nothing finer, and a select that silently drops the
seller's choice is worse than an absent one.

**Two vocabularies, crossed explicitly.** `KnowledgeGapView.topic` speaks the ASKED vocabulary
(`KnowledgeTopic.SHIPPING`); a write speaks the STORED one (`OrgKnowledgeType.SHIPPING_POLICY`).
Handing the first straight through was a **500** — measured live, 「제주도인데 배송이 며칠 걸리나요?」
→ 「저장하지 못했습니다」 with `SHIPPING` on the wire — so `ruleTypeForAskedTopic` writes the crossing
down and returns null for anything it has no rule type for. A token this table cannot name never
reaches the wire.

---

## §5 자료 추가

Two questions and no more: what kind of material, and the file. **Scope is fixed by where the control
lives** — the knowledge screen files company material, the product screen files that product's — so a
seller holding a manual for one listing is never asked which listing.

The product screen gained a 자료 section reading `GET /api/knowledge/documents?productId=`, its own
query rather than a filter over the company's whole list: a shop with three hundred products would
otherwise read three hundred products' documents to show one product's two. Org documents are
excluded from it — a shipping policy listed under a cutting board reads as a fact about the board.

The seller confirms the FILE, never its passages.

---

## §6 자료 화면

Name · 종류 · 적용 범위 · 상태 · 시점 · 올린 사람 — the six a person can answer about a file, five of
which were already on the DTO and unrendered. `passages` appears only as its one honest consequence
(「읽을 내용 없음」), and retiring is offered as retiring: the row stays so every citation that stood
on it still resolves.

**One provenance rule.** The acquisition path invented an author from the email's local part while the
library resolved the user's name, so the 자료 list printed 「ks-qa-1788447858」 beside an uploaded
manual and 「지식 QA」 two sections down. Both now use the library's rule; the local part survives only
as the fallback for a user row with no name.

---

## §7 Existing operational information is shown

The 상품 정보 line and the 과거 고객 응답 count exist so the seller does not read this screen as an
empty form. Past answers are named as what they are — 「참고만 하고, 공식 기준으로는 쓰지 않습니다」 —
and no Answer Memory management screen was built.

---

## §8 Candidate → confirmation

The card says where it was found (the group and its one-line explanation), what was seen (the seller's
own sentence, verbatim), and where it would apply (회사 전체 / the product name). The decision is
[답변 기준으로 등록] / [아니요]; accepting opens the editor first. **AI still promotes nothing.**

---

## §9 Connected to the Grounded Draft

The gap card and the editor are on the screen that named the gap, for both corpora. Saving re-asks —
the caller regenerates — and nothing about approval moves.

**The acknowledgement moved out of the state card.** It used to live inside it, so a save whose
regenerate could not run (capability off, budget spent, vendor silent) rendered no card and therefore
no acknowledgement at all: the seller wrote a fact, pressed save, and the screen said only that the
machinery was unavailable. Saving is what THEY did, and it happened either way. Which sentence
follows depends on what actually happened — a card means the regenerate produced a verdict, and
without one 「답변을 다시 만들었습니다」 would be the screen reporting work nobody did.

**An approval is never silently reused.** The freeze already existed and is now pinned: a regenerate
on an approved review is a 409 through the same gate a hand-typed save goes through, and the approved
version and its fingerprint do not move (`ReviewReplyServiceTest`). On the inquiry lane the publish
path refuses when the head version or fingerprint is no longer the approved one.

---

## §10 First use

Real data only, and no fake progress. A company that has written nothing is told what has already
been read; a company where nothing has been read at all is told that fact and where to go
(「채널에서 가져온 정보가 아직 없습니다. 채널 연결」). **This screen holds no channel read**, and
inventing one to phrase a sentence would put a second, drifting answer beside the home screen's.

「과거 답변에서 찾아보기」 is offered only when there are past answers to look through: a control
whose one possible outcome is 「없습니다」 is not an action, and on a first day it was the loudest
thing on the page.

---

## §11 UI

Existing primitives (`Section`, `Btn`, `Status`), existing tokens. New colours, components or
frameworks: **0**.

---

## §12 Live QA — disposable org, real seller data 0

The org was created through the product's own signup; its products, reviews, inquiries and past
answers are synthetic rows this package inserted. The canonical Demo Org was **read only**.

| | scenario | result |
|---|---|---|
| A | knowledge screen | 확인 필요 1 · 상품 지식 1 · 운영 기준 2 · 연결된 자료 2 · 과거 고객 응답 4 · 「상품 정보 2개를 이미 읽고 있습니다」 |
| B | product knowledge + reopen | type · 규격 (`60x90cm / 5mm`) · author · date · 인용 1 all survive a fresh read |
| C | ORG rule from a product-less inquiry | 운영 기준 추가 → `SHIPPING_POLICY` · `SELLER_ENTERED_KNOWLEDGE`, then 「판매자가 등록한 운영 정책·과거 답변을 근거로 썼습니다」 |
| D | manual uploaded from the product screen | `PRODUCT` scope, product not re-asked; retrieval `FOUND` on 「식기세척기에 넣어도 되나요」 |
| E | policy uploaded from the knowledge screen | `ORG` scope; retrieval `FOUND` on 「반품 배송비」 |
| F | missing knowledge → quick add → back to the task | gap → editor → save → `knowledgeState GROUNDED`; the gap was filed in 확인 필요 as 「「두께」에 대해…」 |
| G | candidate → confirmation | 과거 답변 4건에서 반복 → editor prefilled → `SELLER_ENTERED_KNOWLEDGE`, candidate `ACCEPTED` |
| H | past answers | counted and named as 참고, never in 자료 or 직접 등록 |
| I | inactive document | retire → `NO_RELEVANT_EVIDENCE`; restore → `FOUND` |
| J | approval | regenerate on an approved review is refused; version and fingerprint unmoved |

Three widths (1440 / 1366 / 1152) over 4 routes: **AA text-node violations 0** (composited over
tints) · horizontal scroll 0 · console errors 0 · off-host requests 0.

---

## §13 Reported, not fixed

- **A gap answered from the inquiry screen leaves its 확인 필요 card open.** Measured: the same
  「두께」 ask is both satisfied and still listed. Closing it would need a rule matching a saved
  sentence to an open gap, and that rule is a guess. A candidate closes on a person's press.
- **「초안 준비됨」 on a work item with no draft.** The inbox row reads the work-item phase, and
  `InquiryProposalWriter` moves it to `PROPOSED` when a proposal is written even though the composer
  wrote no version. Pre-existing, and queue semantics are outside this package.
- **`review_triage` is required before a review reaches the reply lane,** so with AI triage off the
  review-gap surface has no live row in a fresh org; J was proven at the service instead.
- **The 자료 문제 group detects one thing.** 「같은 주제의 서로 다른 공식 자료」 is not detected — two
  shipping rules are normal, and the rule that would separate them is the conflict engine this
  package was told not to build.
- **`frontend/CLAUDE.md` forbids `backend/**` edits** for the Action Window Frontend workstream. This
  package edits both, under the product-owner instruction that small backend changes are allowed when
  the structure blocks the UX (conflict priority 1). Named here rather than left implicit.

## §14 Next

Answer Memory as a surface of its own; a document-conflict signal worth a person's time; whether
「판매자가 직접 쓴 답변」 should be offerable as knowledge from the reply screen (a separate decision,
by design).
