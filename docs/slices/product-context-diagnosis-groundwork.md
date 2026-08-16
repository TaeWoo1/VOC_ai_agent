# Product Context Diagnosis — groundwork, not a build

**Status: investigation only.** Nothing here is implemented, and nothing here touches
`Review Triage Calibration v1`. Written 2026-08-16, during that unit, at the product owner's
direction: find out whether a *product context* axis is even possible before designing one.

> **What this document did NOT do**, and what the next unit must not undo:
> the 220-row sample, the DEV/HOLDOUT split, `v1` §5's gates and the in-flight human labeling are
> untouched. **No product context was shown to any labeler**, and none may be — the gold labels are
> answers to "does the seller need to do something about this *review*", and a label formed while
> looking at a listing is an answer to a different question.
>
> Every example below was drawn from the **3,614 reviews outside the sample**, for the same reason
> the calibration rows are (`review-eval/naver/v2` §7.2).

---

## 1. The separation this is for

Two questions are currently answered by one screen, and they are not the same question:

| | question | evidence it needs |
|---|---|---|
| **Triage** | 지금 무엇을 먼저 봐야 하는가 | the review, and the star |
| **Diagnosis** | 왜 이런 리뷰가 나왔고, 무엇을 고쳐야 하는가 | the review **and the listing** |

`Review Triage v1` answers the first. It cannot answer the second, and the interesting failures are
almost entirely in the second: a 5★ buyer who is happy but did the wrong thing because the listing
never said otherwise is a **product-detail defect**, not a review to look at.

## 2. Can a review be tied to a product? — yes, measurably

Measured on the real NAVER corpus (`channel = NAVER`, `external_id is not null`, 3,858 rows), and on
the 220-row calibration sample within it.

| | corpus | the 220 sample |
|---|---|---|
| rows carrying `reviews.product_id` | **3,858 / 3,858 (100%)** | **220 / 220 (100%)** |
| distinct products | 45 | 27 |
| rows whose product carries a **10–11 digit** identifier — the shape of a SmartStore 상품번호 | **3,190 (82.7%)** | **170 (77.3%)** |
| distinct such identifiers | 32 | 19 |
| rows carrying a per-review option id (`source_option_id`) | **0** | **0** |

**Where the mapping comes from.** `IngestionService` calls
`ProductService.resolveOrCreate(orgId, row.productName(), row.sku())` on every ingested review, and
`ReviewRowMapper` reads those from the export's own `상품명` and `상품코드 / 품번 / 상품번호`
columns. So the link is **the seller's own export row**, not a guess SellerOps made — which is why
coverage is 100% rather than a match rate.

Three limits worth stating before anyone builds on it:

- **Identity is name-or-SKU keyed, not channel-keyed.** With no SKU, `resolveOrCreate` falls back to
  an exact match on the product *name*. A listing whose title is edited therefore becomes a second
  `products` row and splits its own review history. Nothing detects that today.
- **`channel_products` is empty** (0 rows). The table that would hold `external_product_id` per
  channel exists and is unused, so there is no stored path from a product to its listing on a
  channel — only the digit string that happens to sit in `products.sku` for 4 of 5 rows.
- **No option granularity.** `source_option_id` is populated by the Coupang path, not by the NAVER
  export. A review cannot currently be attributed to the option the buyer actually bought, which is
  precisely the axis "옵션/규격 정보 보강" would need.

## 3. Can the product's detail be obtained? — not today, by any path in this repo

Every connector was checked for a product or catalog client:

| channel | what exists | product/catalog client |
|---|---|---|
| NAVER | token, orders, onboarding, setup | **none** |
| Coupang | `ordersheets`, `onlineInquiries`, inquiry reply | **none** |
| Cafe24 | boards, board articles, orders | **none** |
| ESM / 11st / SSG | connector shells | **none** |

So the **entire product context available in SellerOps today is `products.name` and
`products.sku`** — a title and an identifier. No option list, no attributes, no description, no
images, no price history (`channel_products.channel_price` exists and is unpopulated).

That is less thin than it sounds. Real SmartStore titles are keyword-dense and carry much of the spec
themselves — `세모금컵 4000매 …`, `… 커플미니`, `[세모금] 세모금생수컵 디스펜서 하향식`. A first
version of the axis could run on **title + option words alone** and would already separate "the
listing never mentions this" from "the listing says it plainly".

**What is required for the rest, and how it must be obtained.** The description and option table
would have to come from an **official seller-product API**, under the `Official APIs first` rule —
not from reading a listing page. Whether such an endpoint exists and what it returns is
**external-research required** for every channel here; the roadmap's §4.1 records no product-API fact
for any of them, and this document does not assume one. Raw HTML, DOM dumps and screenshots are out
regardless: they are already forbidden for Coupang by `docs/coupang_review_policy_gate_v1.md`'s
D-limits, and only a **normalized** product context — title, options, attributes, description text —
should ever be stored or reasoned over.

## 4. Does the class this axis targets actually exist here? — yes, and it is invisible to the rating

Scanning the **3,614 out-of-sample** reviews for text that refers to a specification a listing could
have answered (사이즈 / 규격 / 두께 / 길이 / 매수 / 용량 / 호환 / 안 맞— / 설명에 / 상세페이지):

- **66 rows (1.8%)**
- by rating: **62 at 5★, 4 at 4★, none below 4★**

⚠ That scan is a **prevalence probe, not a detector and not a rule**. It is a hand-written pattern
run once to answer "is this class present at all", and nothing derived from it may enter a tier rule —
`review-eval/naver/v2` §6.3 requires a promotion signal to be traceable to a `DEV` label, and this
is neither. The count is a floor, not an estimate: the pattern misses every phrasing it does not list.

**A real one, out-of-sample**, 5★, on 선바로 일체형 전선몰딩 (product `6473457702`):

> 저는 모서리 커버를 샀는데 그 길이만큼 잘라서 했다가 알고보니 커버 위에 덧씌우는 것이더라구요.
> 모서리는 브이자로 잘라서 붙이고 그 위에 덧씌워야 해요.

Read as triage: **참고**. Five stars, no request, nothing for the seller to do about this buyer, and
`Review Triage v1` is right to leave it at the bottom of the list. Read as diagnosis: the listing did
not explain how the corner cover is fitted, one buyer cut it wrong, and the fix is a paragraph in the
상세 설명. **The two readings disagree, and both are correct.** That disagreement is the whole
argument for a second axis instead of a bigger tier rule.

## 5. The proposed axis — design only

Per review, **beside** the tier and never feeding it:

| value | meaning |
|---|---|
| `DETAIL_SUFFICIENT` | The listing already answers what the review raises. |
| `DETAIL_AMBIGUOUS` | The listing touches it, but not clearly enough to prevent the misunderstanding. |
| `DETAIL_MISSING_RELEVANT_INFO` | The listing is silent on what the review is about. |
| `DETAIL_CONTRADICTS_REVIEW` | The listing states something the review says is not so. |
| `NOT_APPLICABLE` | The review raises nothing a listing could address — delivery, packaging, courier, praise. |

And the actions it would license, which are **product actions, not reply actions** — the surface
still offers no automatic reply, and this axis must not become a route to one:

| axis value | typical next action |
|---|---|
| `DETAIL_MISSING_RELEVANT_INFO` | 상품 상세 설명 보강 |
| `DETAIL_AMBIGUOUS` | 옵션·규격 정보 보강 |
| `DETAIL_CONTRADICTS_REVIEW` | 실제 상품·출고 확인 |
| `NOT_APPLICABLE` + 배송·포장 계열 | 배송 프로세스 확인 |
| any, when the same product repeats | 반복 여부 모니터링 |

### 5.1 Four properties it has to have, decided now rather than later

1. **It is a second axis, not a tier input.** A tier says what to look at first; this says what to
   fix. `DETAIL_MISSING_RELEVANT_INFO` on a 5★ praise-only review must not promote it to 확인 필요 —
   that would put a copywriting task at the top of a worklist meant for customer problems.
2. **Its unit is the product, not the review.** One buyer misreading a listing is an anecdote; four
   buyers misreading the same sentence is a defect. The useful surface is almost certainly
   *per-product*, aggregating reviews — which is also what makes it cheap, since 27 products cover
   the whole 220-row sample and one covers 97 of them.
3. **It needs its own gold set, its own rubric, and its own gates.** Nothing in
   `review-eval/naver/v2` measures it, and reusing those numbers for it would be a category error.
   That gold set is **not this one relabeled** — §9 of that rubric says why labeling is not an
   operating procedure.
4. **It fails closed on a missing listing.** With no product context, the answer is
   `NOT_APPLICABLE`-by-absence, stated as "확인할 상세 정보가 없습니다" — never `DETAIL_SUFFICIENT`
   by default. 23% of the sample has no channel-shaped identifier at all, so this is the common case,
   not the edge.

## 6. What the next unit would have to do first

In order, and none of it started:

1. **Decide the product-identity question.** `channel_products` is the table for it and it is empty.
   Until a product has a stable channel-side identity, "the same listing" is a name match.
2. **Establish, per channel, whether an official product API exists** and what normalized fields it
   returns. External research; no assumption in this document.
3. **Build the normalized product-context record** — title, options, attributes, description text —
   with the raw forms explicitly excluded.
4. **Then** write the axis rubric and draw its own sample. Not before: an axis whose evidence cannot
   be fetched is a taxonomy, not a feature.

## 7. What stays true meanwhile

`Review Triage Calibration v1` continues unchanged — same 220 rows, same split, same gates, same
labeling workflow. The one thing this investigation changes about it is a sentence in its report:
when the false-negative taxonomy comes back, some fraction of what looks like a triage miss will be
**this axis instead**, and naming it will keep the tier rule from being widened to cover a job it
should not be doing.
