# Agentic Experience + UI/UX v2

2026-09-01. Scope: `frontend/` (the conversation surface and the home), `agent-runtime/` (what the
answer SAYS and one new READ capability), and one backend prompt/vocabulary line. **Conversation
semantics were not touched**: the deterministic lanes, the scope rules, `subjectTerm`/`reference`,
`scopeOverride`, the focus contract and the approval boundary are byte-for-byte the ones
`conversation_contract_correctness_v2.md` left. **Marketplace calls 0 · WRITE 0 · migrations 0.**

The goal was not a repaint. It was to make reviewnary read as *an operations person who knows what is
on your desk, decides what matters, and has the next step ready* rather than a bot you query. The
acceptance test was the screen: real Playwright walkthroughs of eight flows on a live disposable org,
before and after, at 1440×900@2×.

Reference patterns (interaction only — no branding, no pixels copied): Rovo/Notion *work with the
current object*, Linear *triage with a stated reason*, Asana Dash *proactive briefing*, Devin *real
progress*, Sierra *insight → evidence → action*, Glean *the user states an outcome*. Visual density
was judged against ChatGPT/Claude: content, not containers.

---

## §1 What the audit found (measured, not assumed)

Eight flows were driven through the product UI and screenshotted before any change
(`shots-before/*.png`, kept outside the repo — they contain real customer sentences).

| # | flow | what the seller actually read |
|---|---|---|
| 1 | home | 「안녕하세요.」 as the largest text on the page, then a numbers line, then a brief that said the same thing WITH the work attached — three layers before anything actionable |
| 2 | a list, then a row press | the brief's rows anchored the conversation correctly and the context bar could only call the result **「선택한 문의」** |
| 3 | 「지금 제일 급한 문의가 뭐야?」 | 「…12건 중 먼저 보실 1건입니다」 — a **count** where a judgement belonged; WHICH one was a card you had to read, and the criterion's limit sat in the same paragraph as the answer |
| 4 | 「너는 어떤 일을 도와줄 수 있어?」 | one clarification said **twice** (prose + a titled block repeating it), and 「주문·매출 흐름은 **이번 조사 계획에** 포함되지 않았습니다」 — a fact about our planner, not their business |
| 5 | 「우리 상품 목록 보여줘」 | 「어떤 상품을 묻는지 확인하지 못했습니다. 상품명이나 SKU를 함께 알려주세요.」 — **a missing capability wearing a refusal's words** |
| 7 | 「별점 낮은 리뷰 보여줘」 | 「부정」 on all 8 of 8 rows; NAVER's collection state said **three times** (prose · footer chip · step card); rows were links out, not objects |

---

## §2 §4 The greeting is not the briefing

The hello was arithmetic and honest and said the least of anything on the page. Once there IS a brief,
the greeting joins the numbers as one quiet line and **the brief is the headline**; before the first
connection there is no brief and nothing else to say, so the headline stays. No number moved.

The brief's rows now carry **why they are on top** — `waitingDays`, the same whole-day arithmetic the
ranked answer uses. 「1개월 전」 is a receipt date; 「40일째 대기」 is a reason.

## §3 §5 A ranking answers WHICH ONE

`urgencySentence` leads with the row that came first and the wait that put it there —
**「먼저 보실 것은 「현금영수증 발행 부탁드립니다」입니다 — 40일째 대기 중입니다.」** — then the order
sentence, then the criterion. The count did not disappear; it moved behind the judgement, where it
explains the order rather than standing in for it.

And a ranked list **opens the row it judged**: the top row arrives expanded with the customer's own
message and 「답변 준비」 in it. A ranking whose answer is still a row you have to click is a list
wearing a judgement's sentence. The chip that repeated 「답변 준비해줘」 under the card is gone — the
row carries that control, and one action rendered twice six inches apart makes the seller pick which
copy is real.

## §4 §2 The answer and its limits are different fields

"① the answer, ② its limits" has been the ordering rule for several packages, and both halves were
joined into one paragraph. `TurnView.notes` is the same sentences — deterministic, closed, unchanged —
in their own place: a quiet line under the objects. A limit the answer already stated is dropped
rather than printed under it.

Nothing became less honest: what the run could not see is still said, on every path that said it
before. The runtime tests that assert 「said once」 now assert it over `message` + `notes`, because the
property is about what reaches the screen.

## §5 §3 review · product rows are objects on the same terms as an inquiry row

A review row opens **in place** (full text, 「리뷰 화면에서 열기」, 「상품 보기」) instead of only
navigating away. A review cannot be ANCHORED — the focus contract names inquiries and this component
does not pretend otherwise — so a press expands and nothing in the conversation changes.

Product rows keep their object shape and gained `more`, so a catalogue that is the *head* of a longer
list can say so.

## §6 One fact, one rendering

Four rules, each general, none an example-specific patch:

1. **A card whose title the sentence already said draws no header.** 「답변 안 한 문의는 12건입니다.」
   with 「답변 안 한 문의」 printed again two lines below is one fact in two type sizes. The title
   remains the section's accessible name; only the second rendering goes.
2. **A block that only repeats the sentence above it is not drawn.** Exact restatement only.
3. **A word every row shares is not a distinction.** 「부정」 × 8 becomes 「모두 부정 리뷰입니다.」 once,
   and stays on the row only where a list actually mixes the two.
4. **A channel raised as a STEP is not restated in the list footer** — the step card says the same
   state and carries the control that changes it.

## §7 Progress is one line

Finished stages were a column that grew while the seller waited and pushed the answer down when it
arrived. They are now a quiet trail on the same line as what is happening. Still only stages the
runtime reported, still in its order, still no invented steps and no bar.

## §8 The catalogue is a capability, not a refusal

「우리 상품 목록 보여줘」 had **no need kind to live in**, so it reached ProductOps as a product question
that named no product and got the resolver's honest refusal. The previous package raised this as a
product-owner decision; this one implements it.

- `list_products` — a READ tool over the existing `GET /api/products` (blank query ⇒ the backend's own
  catalog head). Not `resolve_product` with an empty string: that tool exists to turn a word into one
  row and is described to the planner that way.
- `PRODUCT_CATALOG` — a need kind, ORG-scoped by construction (a stray PRODUCT mention read out of
  「우리 상품」 must not narrow the one need whose answer is "here is everything"), `CURRENT_STATE` in
  time, `NONE` as its precondition — the one product read that must not wait for a product.
- ProductOps answers it **before** resolution and returns the rows as a `PRODUCT_LIST`; when the
  catalogue is all that was asked, no resolve call is spent.
- The answer says which of two things it is: fewer rows than the ceiling ⇒ 「등록된 상품은 N개입니다」;
  a full page ⇒ 「이름순으로 N개 보여드립니다」 plus a link to the rest. The backend returns no total,
  so this is the only truthful distinction available.
- Prompt **v12** names the kind and the tool, and tells the planner not to use it when a product WAS
  named.

The tool catalogue stays 100% READ; `OperatorToolRegistry` still refuses anything else.

## §9 A specialist that was asked nothing reports nothing

「리뷰 신호는 이번 조사 계획에 포함되지 않았습니다」 / 「주문·매출 흐름은 …」 were emitted by specialists
the plan gave **zero needs**. That is a statement about our planner, and it arrived under answers it
had nothing to do with. Nothing was asked of them, so they claim nothing either way — the silence
guard in `operatorGraph` still says any REQUIRED need that ended PENDING, which is the property that
was actually protecting the seller.

---

## §10 Verification

- agent-runtime **780** tests · frontend **2,603** tests · backend **3,593** tests · **0 failures** ·
  typecheck clean on both TS projects.
- Live browser walkthrough of eight flows, before and after, on a disposable QA org created through
  the product's own signup (15 inquiries · 14 reviews · 3 products · 3 policies; **no real seller
  data**). Console errors **0**, off-host requests **0** in both runs.
- **Marketplace calls 0 · marketplace WRITE 0 · DB row changes 0 · migrations 0** ⇒ no evidence row.

### Test contracts deliberately rewritten (3)

Each is a consequence of a stated change, not a weakened assertion:

1. `AgentHome.test` — the greeting no longer prints 「오늘 제가 먼저 확인한 일이 2개 있습니다」 as the
   page's largest text; it is asserted in the numbers line instead, with `not.toHaveTextContent` on
   the phrase it used to duplicate.
2. `ConversationWorkspace.test` — progress is one line, so the finished-stage `<li>` list is asserted
   to be empty and the ORDER of the two labels is asserted instead.
3. `freshnessUx` / `acceptanceClosure` / `conversationUxV2` — 「said once」 is now asserted over
   `message` + `notes` through one `said(turn)` helper.

## §11 Reported, not fixed

- **「너는 어떤 일을 도와줄 수 있어?」 has no capability of its own.** The duplicate clarification and the
  planner-vocabulary sentence are gone, but a question ABOUT the assistant is still planned as an
  operational investigation. It is also **not stable**: the before run answered it with review issues
  and a product list, and the final after run refused it outright
  (「요청을 어떻게 조사할지 계획하지 못했습니다」) — planner variance, not a behaviour this package fixed,
  and it is reported as variance rather than claimed as an improvement. Giving that question a real
  answer is a new product surface — **product-owner decision**; a canned "what I can do" intent here
  would be exactly the per-example patch this package avoided.
- **A ranked list spends one bounded detail READ without a click** (the top row opens itself). It is
  the same read a press makes, on the seller's own data, on their own screen — but it is a read the
  seller did not ask for by name.
- **Reviews and products still cannot be ANCHORED.** The focus contract names inquiries; the rows now
  LOOK like objects on the same terms, and the honest limit is that a press expands rather than
  focuses.
- **The QA org's daily AI budget and capability allowlists were raised in `backend/.env.local`** for
  the walkthrough and restored from the pre-package copy afterwards. No product default changed.
