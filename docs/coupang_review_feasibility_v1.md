# Coupang Review Integration — Feasibility v1

> **Status:** INVESTIGATION. **Nothing is promoted.** Coupang REVIEW remains `BLOCKED` in
> `docs/multi-channel-connector-roadmap.md` §4.1 and `REVIEW_API` remains an honest `unsupportedScope`
> on `CoupangApiConnector`. This document records what was established, by what evidence, and what a
> single READ_ONLY sitting is being asked to decide.
>
> - **Unit:** Coupang Review Integration Feasibility v1 → Coupang WING Review Structure Discovery v1
> - **Date:** 2026-08-14
> - **Live contact:** none yet. The discovery run is built, offline-tested, and **not yet run.**

---

## 1. Three axes, kept apart

A capability question on a marketplace has three independent answers, and collapsing them is how a
channel gets built that works and should not have been. They are tracked separately throughout:

1. **TECHNICALLY_POSSIBLE** — can the data be obtained at all?
2. **POLICY** — `ALLOWED` / `UNCLEAR` / `DISALLOWED` by Coupang's own terms.
3. **PRODUCT_RECOMMENDED** — should SellerOps do it, given the first two and the seller's interest.

**The existence of third-party Chrome extensions and crawlers is not evidence on any axis.** Several
are sold publicly for exactly this data; they are a reason Coupang wrote a new clause, not a licence.

---

## 2. Candidate A — official Review API: **does not exist**

Re-verified on 2026-08-14 against the current documentation site (`developers.coupang.com`), which
enumerates its surface by category:

> 상품(22) · 카테고리(6) · 브랜드(3) · 배송/주문(12) · 반품(7) · 교환(4) · 프로모션/쿠폰(21) ·
> 물류(8) · **고객 문의(6)** · 정산(2) · Rocket Growth(9)

No endpoint in any category mentions 리뷰 / 상품평 / 후기 / review / rating / feedback. The six
customer-inquiry endpoints are the ones this repo already uses.

This is a **count of the whole catalogue**, not a failed search — so the finding is "not in the list",
not "not found". Axis 1 is therefore `TECHNICALLY_IMPOSSIBLE`: nothing is blocked, nothing exists.

The prior repo state (`BLOCKED`, "공식 API 없음", confirmed 2026-07-07) is **confirmed, not merely
carried forward.** Re-verifying was worth doing: the inquiry unit's whole direction changed when an
undocumented-to-us reply endpoint turned out to be published.

---

## 3. Candidate D — public product-page scraping: **DISALLOWED, and about to be explicitly so**

Coupang's revised 이용약관, **effective 2026-09-03**, prohibits automated collection in terms:

> 로봇(bot), 스파이더(spider), 스크레이퍼(scraper) 등 자동화 프로그램을 이용해 시스템에 접근하거나
> 데이터를 수집하는 행위

This governs `coupang.com` — which is precisely the surface a public product-page scraper would touch.
Candidate D is **closed**, not deprioritised. It is not analysed further and no fallback depends on it.

(The same revision widens Coupang's own use of user content to AI training. That is about Coupang's
rights over its data, not ours, and is recorded here only so it is not later mistaken for a permission.)

---

## 4. Candidate B — official WING export: **CLOSED by operator observation**

The operator confirmed on their own account that WING **has** a review list screen and that it offers
**no official Excel/CSV download**. That closes the cheapest and safest path — the one that would have
landed straight on the existing review spine (`contracts/review-export/naver/v1/` → parse gate →
canonical review → dedup → attention queue) with only a parser and a column mapping to write.

Recorded as an operator observation, not a repository fact. If Coupang adds an export, this becomes
first choice again immediately.

---

## 5. Candidate C — READ_ONLY reading of the seller's own WING screen

The remaining candidate, and the subject of the discovery run.

| Axis | State | Basis |
|---|---|---|
| TECHNICALLY_POSSIBLE | **UNKNOWN — being measured** | The screen exists; nothing about its structure has been measured. |
| POLICY | **UNCLEAR** | The bot clause governs `coupang.com`. The seller relationship is governed by 마켓플레이스 판매이용약관 §14 (마켓플레이스 시스템 악용), whose **verbatim text has not been read**. A seller reading their own screen is not obviously 악용 — and "not obviously" is not `ALLOWED`. |
| PRODUCT_RECOMMENDED | **NOT YET** | Depends on §6 and on the reply verdict. |

**The policy axis stays `UNCLEAR` on purpose.** Reading §14's actual text is the next external-research
item; until then no run beyond a single READ_ONLY structural measurement is justified, and none is built.

---

## 6. The structural finding that outranks the engineering — 아이템위너

Coupang shares 상품평 across **every seller of the same item**. Only 셀러평 stays with the seller.

So on Coupang, "reviews on my product" and "reviews of my sales" are **not the same set**, and no
screen reading can separate them — the distinction lives in order data the review does not carry.

This is a **product-owner decision**, not a technical one:

> Is the operational unit the item's review stream (which includes other sellers' sales), or only the
> seller's own sales (which Coupang does not expose as a review set)?

If the answer is the latter, Coupang review operations largely do not exist as a capability, whatever
the screen turns out to support. The probe therefore reports catalog scope **asymmetrically**: finding a
product id we hold proves our catalog is on the screen; finding none proves nothing, and there is no
verdict for "other sellers' items" because no measurement can earn it.

---

## 7. The one question the sitting is for

**Does a seller reply control exist on the 상품평 screen?**

Everything forks on it:

- **Present** → Coupang review operations can reach a guided human-in-the-loop reply, and the channel
  is worth the shape of investment the 고객문의 path received.
- **Absent** → the channel is **acquisition-and-analysis only**, permanently, and no engineering
  changes that. Worth knowing before designing an acquisition path, not after.

It is answered **independently of the row structure**, so a screen whose layout fails to resolve still
yields the answer. And it distinguishes an interactive `답글` from a printed one: `답글여부` as a column
header is a word, `답글 등록` on a button is a capability. Collapsing them would report a reply feature
on a screen that has none — the most expensive wrong answer available here.

**Three states, not two.** `NO_REPLY_CONTROL` may only be claimed from a reading that actually found the
review rows. On a screen whose unit never resolved, zero interactive hits is equally consistent with
"the probe never reached the reviews" — which is exactly the confident zero three 고객문의 sittings were
spent on. That reading is `UNDETERMINED` and exits `5`.

---

## 8. What the run measures, and what it refuses to touch

`COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY` (READ_ONLY) —
`collector/src/cli/calibrate-review-list.ts`.

**No anchor to hand the page.** Every earlier probe here had one: SellerOps held the inquiry's own id, so
the match ran inwards and only counts came back. There is no review id to hold. So the anchors are
**Coupang's own fixed UI words**, and the review unit is whatever repeating structure the most of them
agree on. The row tag is a finding; three sittings were paid to learn that.

Measured in one pass:

| Question | How | What travels |
|---|---|---|
| Reply control exists? | Fixed reply words, split by whether the hit is pressable | Two counts per word, plus how many sit inside a review unit |
| The review unit | The repeat the field words agree on | Tag, sibling counts, class-token count, agreeing-label count |
| Rating | `aria-valuenow` presence, and a class shape containing a token we supply | Per-unit booleans, counted |
| Date | Fixed SHAPE patterns | Which pattern id matched, and how many leaves — **never a date** |
| Stable id candidates | Digit runs in `href`/`id`/`data-*`, and in printed text | **LENGTHS only**, both routes reported separately |
| Attachments | `<img>` / `<video>` element presence per unit | Counts — **never a `src`** |
| Paging / range | `input[type=date]`, `select`, a repeating numeric pager | Counts |
| Catalog scope | Product ids we already hold, matched as whole digit runs | How many units carried one |

**Two attribute allowlists, both named.** The identifier allowlist (`href` / `id` / `data-*`) is
unchanged. A second, deliberately tiny one exists for structure classification — `role` and `type`
compared against fixed literals, `aria-valuenow` and `contenteditable` tested for presence — because a
`div[role=button]` is a control and calling it furniture would produce a false "no reply feature". It is
stated in the approval scope rather than left implicit.

**What is never read into any returned field:** review bodies, buyer names, product names, image and
video sources. Page text is read in exactly one function and compared there against fixed words and shape
patterns we supply, reduced to a count. The honest claim is **"page text never leaves the page"** — not
"nothing is read", which would be false.

**Zero clicks, inputs, replies, navigations, highlights, and network calls.** Pinned by source guards.

### Why the tie-break is the interesting part

On a table the field words live in the **header**, not in the rows. So every label votes equally for the
header-cell repeat, for the row repeat, and for whatever page section encloses both. Taking the innermost
resolves the unit to a header cell and then asks whether that cell contains a photo; taking the outermost
resolves it to "grid, filters, pager" and counts the pager as a review.

Tied candidates are separated by what they **contain**: the review unit is the repeat whose members most
consistently each hold one review's worth of evidence — a date, a rating token. A header cell holds none;
a page section holds all of it in one member and none in the others; a row holds one each. Depth breaks
what remains, outward. Both the unit count and the agreeing-label count travel, so a pick that went wrong
is visible to whoever reads the run rather than silently believed.

---

## 9. Classification as it stands

| Candidate | TECHNICALLY_POSSIBLE | POLICY | PRODUCT_RECOMMENDED |
|---|---|---|---|
| A. Official Review API | **No — does not exist** | — | ✕ closed |
| B. Official WING export | **No — operator confirmed none** | would have been cleanest | ✕ closed (reopen if Coupang adds one) |
| C. Seller-owned WING screen, READ_ONLY | **being measured** | **UNCLEAR** (판매이용약관 §14 unread) | **pending** — gated on the reply verdict and §6 |
| D. Public product-page scraping | Yes | **DISALLOWED** (2026-09-03) | ✕ **not adopted** |

## 10. Open points, classified

- **repository-verifiable (done):** the review spine is export-artifact-shaped and already ends in
  canonical review → dedup → attention; a Coupang path would need a source and a mapping, not a spine.
- **external-research required:** 마켓플레이스 판매이용약관 §14 verbatim (the policy axis for C).
- **product-owner decision:** the 아이템위너 question in §6.
- **measurement required:** everything in §8 — one sitting.
