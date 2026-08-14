# Coupang Review Integration — Feasibility v1

> **Status:** INVESTIGATION. **Nothing is promoted.** Coupang REVIEW remains `BLOCKED` in
> `docs/multi-channel-connector-roadmap.md` §4.1 and `REVIEW_API` remains an honest `unsupportedScope`
> on `CoupangApiConnector`. This document records what was established, by what evidence, and what a
> single READ_ONLY sitting is being asked to decide.
>
> - **Unit:** Coupang Review Integration Feasibility v1 → **READ_ONLY review acquisition feasibility**
> - **Date:** 2026-08-14
> - **Live contact:** **one sitting, 2026-08-14 — VOID.** It ran clean and returned a confident
>   `NO_IDENTIFIER` from a unit that was not a review. See §9. Nothing from it is recorded as a finding
>   about Coupang.

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
| PRODUCT_RECOMMENDED | **NOT YET** | Depends on §6 and on the identifier verdict. Reply is closed — §7. |

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

## 7. The reply question is closed — by observation, not measurement

**The operator confirmed WING offers sellers no way to answer a 상품평.** So:

> **Coupang review operations are acquisition-and-analysis only.** No engineering changes that, and no
> guided human-in-the-loop reply path is possible on this channel.

An earlier version of this probe measured whether a reply control existed. That measurement was
**removed rather than kept and ignored** — the words are not in the run at all, the phase no longer
declares the action, and the approval scope states `0 reply-control lookups` positively so it is
checkable. A measurement kept "for later" after being told not to use it is one that gets used later.

## 7-ter. The column the operator found — 노출상품ID (옵션ID)

The operator read a column off the real screen that no field-word scan had found. Coupang's own
definitions make those two numbers **`productId`** and **`vendorItemId`**, which changes two things:

1. **Catalog identity is available per row without SellerOps supplying anything.** It is *printed*, not
   marked up — exactly as the 접수번호 was on 고객문의, and exactly where attribute scanning would never
   have looked. The probe now anchors on that fixed header and resolves its column geometrically.
2. **It is the better anchor for the row itself.** One cell per review, by construction — where field
   words on this screen all sit in a single header cell. The column leads; label agreement is the
   fallback, and `unitSource` reports which one resolved the unit so the weaker reading can never be
   mistaken for the stronger.

**A 상품ID is not a review id, and this is the trap the column creates.** It is the most
identifier-looking thing on the screen and it is per *product*: many reviews share one. Collecting on it
would fold them together. That is why the column reports `distinctFirstRunValues` and
`distinctSecondRunValues` separately — a first-run count well below the cell count is exactly what a
product id looks like, and the option id varying faster is what says option-level identity exists.

Neither number is returned. Only counts of how many differ.

## 7-bis. The one question the sitting is for

**Could these reviews be collected and de-duplicated at all?**

That needs a **stable identifier** — present on each review and DIFFERENT for each. Those are two
properties, and one count cannot express both, so both travel: how many units carry a digit run of a
given length, and how many DISTINCT values those runs have.

- `unitsCarrying === distinctValues` → a dedupe key candidate.
- `unitsCarrying` far above `distinctValues` → a category code. Collecting on it would fold every
  review on the screen into one row, **and the fold would look exactly like de-duplication working.**

Asked of markup and of printed text separately, because on the 고객문의 screen the identifier turned
out to be printed rather than marked up.

**Three states, not two.** `NO_IDENTIFIER` may only be claimed from a reading that actually found the
review rows. On a screen whose unit never resolved, finding no candidate is equally consistent with
"the probe never reached the reviews" — the confident zero three 고객문의 sittings were spent on. That
reading is `UNDETERMINED` and exits `5`.

---

## 8. What the run measures, and what it refuses to touch

`COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY` (READ_ONLY) —
`collector/src/cli/calibrate-review-list.ts`.

**No anchor to hand the page.** Every earlier probe here had one: SellerOps held the inquiry's own id, so
the match ran inwards and only counts came back. There is no review id to hold. So the anchors are
**Coupang's own fixed UI words**, and the review unit is whatever repeating structure the most of them
agree on. The row tag is a finding; three sittings were paid to learn that.

**Scope of this sitting: `TECHNICALLY_POSSIBLE` only.** The policy axis stays `UNCLEAR` regardless of what
comes back, and no acquisition is implemented on the strength of it.

Measured in one pass:

| Question | How | What travels |
|---|---|---|
| Stable identifier? | Every digit run inside a unit, tallied by source and length | Units carrying, and distinct values — **never a value** |
| Detail URL per review? | An `<a href>` inside the unit | A count — never the address |
| Incremental collection? | Sort / period words, split by whether the hit is pressable | Two counts per word, plus how many sit inside a unit |
| How far back? | The largest number the pager prints | One integer |
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
| C. Seller-owned WING screen, READ_ONLY | **being measured** | **UNCLEAR** (판매이용약관 §14 unread) | **pending** — gated on the identifier verdict and §6 |
| D. Public product-page scraping | Yes | **DISALLOWED** (2026-09-03) | ✕ **not adopted** |

## 10. Open points, classified

- **repository-verifiable (done):** the review spine is export-artifact-shaped and already ends in
  canonical review → dedup → attention; a Coupang path would need a source and a mapping, not a spine.
- **external-research required:** 마켓플레이스 판매이용약관 §14 verbatim (the policy axis for C).
- **product-owner decision:** the 아이템위너 question in §6.
- **measurement required:** everything in §8 — one sitting.

---

## 9. The first live sitting, and why its verdict was thrown away

The run completed (exit 0) against the real screen and returned `acquisitionVerdict: NO_IDENTIFIER`.
**That verdict is void.** The probe had not resolved a review.

What gave it away, from the run's own numbers:

| Reading | Value | What it means |
|---|---|---|
| `unit.unitCount` | 4 | four "reviews" |
| `textShapes.dateDotted.unitCount` | **10** | ten dates inside those four |
| `unit.siblingsSharingClassShape` | **1** of 4 | the four siblings share no shape — not a repeating list |
| every `idCandidate.unitsCarrying` | **1** | each digit length appears in exactly one member |
| `unitsWithImage` / `unitsWithDetailLink` | 3 / 1 | members are not alike |

A review row holds one review's worth of evidence. This set held everyone's — it was a **container**, and
every count the run produced described the wrong element.

**Two defects, one of them the interesting one.**

1. *Candidate identity collided.* Sets were keyed on `tagName + siblingCount`, so `DIV:4` covered a
   container set (1 of 4 sharing a class shape) **and** the row set the field words meant (4 of 4 — visible
   in `labelCounts.starRating.sharedRepeatLevel`). Votes cast at one place in the document were counted for
   another. A sibling set *is* its parent plus a tag; those are now compared by reference, which cannot
   collide.

2. *The evidence heuristic cannot catch this on its own, and that is not fixable by tuning.* A wrapper whose
   every child contains a date scores 4/4; the row set, whose header row has no date, scores 3/4. **The
   wrapper wins.** So there is now an independent guard on the outcome rather than a better heuristic: if the
   resolved unit holds more than two of any one shape per member, it is a container and the verdict is
   `UNDETERMINED` — never `NO_IDENTIFIER`.

This is the same failure the three 고객문의 sittings produced, in a new costume: **a confident zero that
reads exactly like a real refutation.** The difference is that this time the run's own output contained the
contradiction, and the guard now makes the probe state it rather than leaving it to be noticed.

### What the sitting DID establish

These readings do not depend on which unit was resolved, so they survive:

- **One document, no shadow DOM, no iframes** (`framesScanned: 1`, `shadowRootsFound: 0`). The screen is
  plainly reachable — unlike the hypotheses that cost the 고객문의 sittings.
- **It is a table with 7 columns** (`TH`, `siblingCount: 7`), and `등록일` / `작성자` are among its headers.
  `평점` is absent; the screen says **`별점`** (6 hits). No `사진` / `동영상` / `구매자` header words.
- **Long digit runs DO exist in markup**: `anchorDigitRunLengths` includes 8, 9, 10 and 11. This is the
  opposite of the 고객문의 finding, where the needed lengths were simply absent — a review id in an
  attribute is plausible here, and that is the single most encouraging number in the run.
- **Dates are `YYYY.MM.DD`** (10 leaves, `dateDotted` only).
- **Paging exists and is bounded**: numeric pager, highest printed page **5**; 4 `<select>` elements and
  **no `input[type=date]`** — so the period filter is a dropdown, not a date range.
- **No interactive `최신순` / `최근 N개월`** was found; only `조회` (×4). Sort and period control remain
  unestablished.

`ownershipScope` is `NOT_ESTABLISHED` — no product id was supplied, so the catalog question was not asked.
