# Coupang Review Acquisition + Locate v1

What SellerOps stores when it reads a seller's own WING 상품평 screen, how it recognises a review it
already has, and how it finds one again on the screen.

**Status: LIVE-PROVEN end to end on 2026-08-15, and re-proven on the corrected manifest at commit
`533cafc2`** — first backfill (22 stored into an empty database), same-range re-sync (`stored=0 /
skipped=22`, database unchanged), and one stored review located and rung on the seller's own screen. **§6.6
is the proof of record**; §6.5 keeps how each fact was learned, including the five refusals and the two
defects only a live screen could produce. Nothing here is promoted in
`docs/multi-channel-connector-roadmap.md` §4.1.

**Posture, unchanged from the gate:** `TECHNICALLY_POSSIBLE = CONDITIONAL_YES` / `POLICY = UNCLEAR` /
`DEVELOPMENT = PILOT_ALLOWED` / `GA = POLICY_GATED`
(`docs/coupang_review_policy_gate_v1.md`). Building is not gated on Coupang's answer; releasing is.

---

## 1. Why this shape, and not the obvious one

Three measured facts decided nearly every design choice here. None of them was assumed.

| Fact | Where it was established | What it forced |
|---|---|---|
| Coupang publishes no review API and WING offers no export | feasibility v1 | The screen is the only source |
| The screen carries **no per-review-unique value** — two of ten reviews were identical in every number it prints, `distinctRowSignatures` 9 of 10 | gate v1 §9.2 | No `external_id`; identity is a content hash; locate cannot ask for a row by number |
| The four dropdowns match no period word **and no period shape** | gate v1 §9.4 | No date-range incremental collection; the pager is the only traversal actually observed |

## 2. What is stored

Per review: the review text as the screen printed it, the rating, the date, Coupang's 노출상품ID and —
when the cell prints one — the 옵션ID, and how many photos/videos the review itself carries.

The body is what the buyer wrote, and only that. Where a long review is printed cut off with a 더보기 control
inside the same cell, the control's own label is stripped before anything is stored — otherwise the seller
reads a review ending in a button and the body fingerprint locate anchors on is computed over a word no
customer wrote.

Whether the text may be a **prefix** is the agent's `bodyExpandable` — the cell offered to show more. It does
not cross to the backend, which has no column for it; the run's summary line prints `expandable=N` for the
operator, and §7 keeps it as a named gap rather than a claim the product cannot keep.

**The buyer is not stored, and the guarantee is structural rather than filtered.** There is no author
field on the wire record, none on the canonical record, and no column on `reviews`. The wire record
also *rejects* an unknown property, so a client that sent an author is refused audibly instead of
accepted with the field silently dropped. `V37__review_source_option_and_media.sql` says so where the
columns are defined.

That the buyer's column is nonetheless **resolved** is deliberate. The reader maps every header cell to
a role by Coupang's own word, and `구매자` / `작성자` take a role named `excluded` — because an unmapped
column is one careless fallback away from being read, while a column that is explicitly the one we do
not read is something a test can hold. `excludedColumns` comes back as a count, and the regression
asserts the column was found and its text appears nowhere.

**A rating-only review is STORED, as textless.** Coupang lets a buyer rate without writing, and renders a
fixed placeholder sentence where the body would be. That sentence is the channel's UI, not a customer's
words, so it is never stored as a body: the review is kept with an empty body and a `textless` flag, and the
surface says 별점만 남긴 상품평. The rating is the signal such a review carries, and on the first live account
86% of the 상품평 were these. How many were textless is reported per run rather than folded into the total.

## 3. How a review is recognised again

Through the ingestion spine's existing fallback: `external_id` when a source has one, a content hash
when it does not. Coupang has none, so it always hashes.

The formula is **v2** — `SHA-256(channel | product | date | body | rating)` — the same version ESM+ uses,
reached from the other direction. ESM+ exports carry no review id; Coupang's screen carries no unique
value at all. Rating has to be in the key because short bodies repeat: under v1 a five-star and a
one-star `좋아요` on one product on one day would fold into a single row.

**A textless review keys on v3, which folds in the purchased option** —
`SHA-256(channel | product | date | | rating | optionId)`. It has no body to separate it from another
rating-only review, so under v2 every one of them on a product/day/rating collapses into a single row. The
live reading found 옵션ID on every row, which is what makes this available.

The version applies **per ROW, not per channel** — which is what `reviews.dedup_key_version` was always for.
A review WITH text keeps v2, so nothing about written reviews changes: the option stays out of their key,
because the body already separates them and a key including it would change identity if a cell ever rendered
without one.

**The residue is a v1 limitation, recorded rather than closed.** Two textless reviews of the same OPTION on
the same day at the same rating still merge. Closing it needs a per-review identifier Coupang does not
publish; a row position or the buyer's name is not one, and neither will be added.

## 4. How collection advances

**SellerOps does not turn the page.** A pager click is a marketplace action and belongs to the seller
(root `CLAUDE.md`, "No hidden or chained platform clicks"), so the walk is the Action Window's shape:
the operator pages, SellerOps reads whatever page is up.

**v1 walks to the end of the pager — on a backfill and on a re-sync alike.** An earlier draft stopped at
the first page that brought nothing new, reasoning that everything behind it must already be held. That
reasoning holds only on a newest-first list, and **this screen's sort order has never been proven live**;
the same screen's four dropdowns already turned out not to be the period filters they resembled (§1). On
any other ordering, a page of familiar reviews says nothing whatever about the pages behind it, and the
walk would stop early *while reporting full coverage* — silent, and shaped exactly like success. The
optimisation returns as a follow-up if a live run proves the ordering, and not before.

So a re-sync costs the same page turns a backfill does. That is a real cost, taken deliberately.

**Completion is a reading, not an inference.** `complete` is true in exactly one case: the pager itself
showed this was the last page — either it resolved and this page is its highest with the next control
absent or dead, or there is no pager and nothing to press at all (a one-page list). A pager that is
present but unreadable is `UNKNOWN`, which **stops** the walk, because "we could not tell" must never
round up to "there was no more".

**The operator's word ends the walk without completing it.** A person answering "that was the last page"
is answering from memory of a screen; it is recorded as `operatorFinished`, next to `complete` rather
than inside it — the same separation the Coupang inquiry reply run keeps between an operator's report and
a verification.

Everything collected is still stored on every ending — dedupe makes that free — and what is withheld is
the claim. The import record says `PARTIAL`, and the review list renders the warning in words rather than
leaving the seller to infer it from a number that looks fine.

**The pager is read as structure, not guessed at**: which page numbers are offered, which one is marked
as showing (`aria-current`, then an `active`/`current`/`selected` class, then the one that is not a
link), and whether a next control exists and is pressable. That last one is what stops a *windowed* pager
— 1…10 while 50 pages exist — from reading page 10 as the end. Candidates inside a `<table>` are excluded:
a review row prints `1` in its 번호 cell and `5` in its 평점 cell, so every row is an element with two
numeric children, and the first version of this census resolved a review row as the paging control.

## 5. `[쿠팡에서 보기]`

No review id exists, so locate cannot ask the screen for a row by number. It re-finds the review by
everything that agrees: product, option (when both sides print one), date, rating, and the review body's
`review-body-fingerprint/v1` — the same contract computed identically in Java and TypeScript, so the
target the backend derives and the row the page yields are compared on one rule. The fingerprint travels
instead of the text.

**The buyer's name is not an anchor.** It is on the screen and it would make matching easier. It is also
the one field on the row that identifies a person, and an anchor is a thing the product would then have
to hold in order to re-find a review later — exactly the storage this pilot refuses.

**One match or nothing.** Zero and two are both refusals and neither highlights anything, because the
failure a loose match produces is not "no ring" — it is a ring around someone else's review, which the
seller reads as SellerOps telling them what a buyer said. The highlight itself is a marker attribute, a
band drawn around the row, and a scroll: it never clicks, focuses, types, or submits.

**The product entry point is `docs/coupang_review_locate_ux_v1.md`** — the `REVIEW_LOCATE` intent, the
single-use `locateRef`, the button, and the live proof. Read it for anything about how a seller *asks* for
a locate; this section stays the description of how a review is matched.

> **Correction (2026-08-15, commit `c334b763`).** The highlight used to set `outline` on the matched `<tr>`
> with a 2px offset, which paints the ring OUTSIDE the row — nothing changed inside the row, and on the real
> WING list the operator saw no mark. Both live records below report `highlighted=true` from their locate
> legs, and those runs did identify and mark the right row — but nobody could SEE it until the band moved
> onto the cells. Read those claims as "the right row was identified". See the locate doc §6, including its
> note on the first, wrong diagnosis.

## 6. Where the pieces live

| Piece | File |
|---|---|
| In-page row reader (header → role) + the highlight | `collector/src/action-window/coupang-review/review-row-inpage.ts` |
| Canonicalization, drop rules, boundary key | `collector/src/action-window/coupang-review/review-rows.ts` |
| The walk, and what completion means | `collector/src/action-window/coupang-review/review-acquisition.ts` |
| Locate matching | `collector/src/action-window/coupang-review/review-locate.ts` |
| The driver | `collector/src/action-window/coupang-review/coupang-wing-review-reader-driver.ts` |
| Agent → backend handoff | `backend/.../collect/AgentReviewHandoffService.java` |
| Dedup formula version | `backend/.../ingest/ReviewDedupKey.java` |
| The columns, and what the option is part of | `V37__review_source_option_and_media.sql`, `V38__review_source_option_in_textless_key.sql` |
| The seller's record (list / detail / locate target) | `backend/.../review/channel/`, `frontend/src/pages/app/ChannelReviews.tsx` |

## 6.5 What the first live backfill established — 2026-08-15

Six seated `READ_ONLY` sittings on the operator's own 상품평 screen. The first five refused; the sixth
collected. Every refusal was the design working, and every fix came from a measurement rather than a guess.

> **The run below is superseded as the proof of record by §6.6**, which repeated it on the corrected
> manifest after nine review findings were fixed. What this section holds that §6.6 cannot is *how each
> fact was learned* — the five refusals, the markup that ended them, and the two defects only a live screen
> could produce. The numbers came out identical.

### The proof, end to end

```
BACKFILL   page 1: rows=10 new=9   page 2: rows=10 new=9   page 3: rows=4 new=4 → FINAL_PAGE_REACHED
           pages=3 rows=24 collected=22 textless=19 complete=true lastPage=3 dropped(0/0/0)
           handoff: received=22 stored=22 skipped=0 failed=0
LOCATE     verdict=LOCATED matches=1 rows=10 highlighted=true
RE-SYNC    same three pages walked again
           handoff: received=22 stored=0 skipped=22 failed=0
DATABASE   22 rows before and after · dedup_key_version v2=3 / v3=19 · 22 distinct content hashes
           0 rows whose body is Coupang's placeholder
HISTORY    SUCCESS 22/22/0  →  SUCCESS 22/0/22
```

A re-sync costs the same three page turns a backfill does — v1 walks the pager to the end either way — and
stores nothing. That is the idempotence the incremental design rests on, read straight off the counts.

| Question | Answer |
|---|---|
| Real header parsing | **Works.** All five roles resolved from Coupang's own words, first attempt |
| The buyer column | **Found and excluded** — `excludedColumns=1` on every page |
| Row width | 7 columns, 24 rows, **zero** mismatches |
| `productId` / `옵션ID` | **Both present on all 22** — the option id is not the sometimes-absent field the census suggested |
| Completion | Read from the screen: page 3's next control carries `disabled` |
| Locate | One match, one ring, on a real stored review |
| Marketplace actions | **0.** The operator turned every page |
| `mediaCount` | 0 everywhere — **cannot yet tell "no photos" from "not detected"** |
| Body truncation | Undetermined; only 3 of 22 reviews had text at all |
| Idempotence | `stored=0 / skipped=22` on the second walk, database unchanged |

### The pager, which took five readings

WING states component state in **`data-wuic-attrs`**, not in `class`:

```html
<span data-wuic-partial="prev" data-wuic-attrs="disabled"><a href="#"></a></span>
<span data-wuic-attrs="page:1 active"><a href="#">1</a></span>
<span data-wuic-partial="next" data-wuic-attrs=""><a href="#"></a></span>
```

Three failures with one cause each: the current page is the token `active` in that attribute (not a class,
not aria — so descending into the cell found nothing either); `disabled` lives there too; and prev/next are
**empty `<a>`s** whose glyph is CSS, so every rule looking for the word `다음` or a `>` came back empty on a
screen that plainly shows `< 1 2 3 >`.

The reading that ended it was the operator opening devtools and pasting the markup. What the probe
contributed was narrowing it to one region and proving four hypotheses wrong; what a person reading the
screen contributed was the answer. **A diagnostic that cannot say why it refused costs a seated sitting per
guess** — which is why the census now reports its own refusal in integers, and why the region reports its
skeleton (tags and attribute NAMES, never a value) when it cannot resolve.

### Two defects only a live screen could produce

**19 of 22 stored reviews carried a Coupang placeholder as their body.** The design assumed a rating-only
review leaves the cell empty; WING renders `등록된 내용이 없습니다.` there. The empty-cell guard never fired
(`dropped body=0`) and the placeholder was stored as if a customer had written it — and two of them then
merged, which is precisely the silent collapse that guard existed to prevent. Now recognised as an empty
body, matched as the whole normalized cell so a real review that mentions the phrase survives.

**The new-review count was always zero.** The import's start was stamped after the rows were written, so
every freshly-stored review sat milliseconds before its own import: a handoff that had just stored 22
rendered "새 상품평 0". The clock was the bug, not the query.

### What is done with a rating-only review — decided

This account's reviews are **86% rating-only**, so the choice had a real consequence either way. The
product-owner decision (2026-08-15) is: **store them, keyed additionally on the purchased option.**

- The rating IS the signal. Dropping them would have thrown away the whole distribution — 1★×3, 2★×1, 4★×5,
  5★×13 — for a record showing 3 of 22.
- **Coupang's placeholder is never stored as a body.** It is UI text, not a customer's words. The review is
  stored as `textless` with an empty body, and the surface says 별점만 남긴 상품평 rather than implying
  SellerOps lost something.
- **`dedup_key_version` v3** keys a textless review on `channel|product|date||rating|optionId`. It applies
  per ROW, not per channel — a written review on the same channel keeps v2, so nothing about text reviews
  changes. Folding the option is what the screen supports: the live reading found 옵션ID on every row.
- **The residue is a v1 limitation, recorded rather than closed.** Two textless reviews of the same OPTION on
  the same day at the same rating still merge. Closing it would need a per-review identifier Coupang does not
  publish; a row position or the buyer's name is not one, and neither will be added.
- The wire carries `textless` rather than inferring it from a blank body, and a row whose flag and body
  disagree is refused. A blank body could be a reader defect; the flag is the agent saying it saw a rating
  with no text, and the two key differently.

---

## 6.6 The final proof, on the corrected manifest — 2026-08-15

§6.5's sitting was approved against manifest text that said a rating-only 상품평 was **"skipped and counted,
not stored"** — while 19 of the 22 reviews it stored were exactly that. The text was corrected, along with
eight other review findings, and the whole sequence was then repeated end to end. **This is the proof of
record.**

Approval `apr-06f26026cbc8` · run `wt-cfca7f76f844` · commit `533cafc2` (PINNED) · phase
`COUPANG_WING_REVIEW_ACQUISITION` · mode `READ_ONLY`. A database created empty for the sitting — **0 reviews,
0 review imports** before the first press — so the backfill is an insertion and not a re-read. The schema it
ran on includes `V38`, applied at boot.

```
BACKFILL   page 1: rows=10 new=9 known=1   page 2: rows=10 new=9 known=1   page 3: rows=4 new=4 known=0
           pages=3 rows=24 collected=22 textless=19 expandable=0
           complete=true stop=FINAL_PAGE_REACHED lastPage=3 dropped(date=0 rating=0 product=0)
           handoff: received=22 stored=22 skipped=0 failed=0
LOCATE     verdict=LOCATED matches=1 rows=10 highlighted=true
RE-SYNC    the same three pages walked again, 0 marketplace clicks
           handoff: received=22 stored=0 skipped=22 failed=0
DATABASE   22 rows before and after the re-sync
           textless=19 / with text=3 · dedup_key_version v3=19 / v2=3 · source_option_id on 22 of 22
           0 rows whose body holds Coupang's placeholder or a 더보기 control
           reviews has NO author-shaped column at all
HISTORY    AGENT_HANDOFF REVIEW SUCCESS 22/22/0  →  AGENT_HANDOFF REVIEW SUCCESS 22/0/22
LOG        every event across both runs is a read, a confirm, a handoff or a locate —
           0 clicks, 0 inputs, 0 submissions, 0 navigations
```

| What was asked | Result |
|---|---|
| 3-page full backfill | **PASS** — 24 rows read, walk closed by the pager itself at page 3 |
| 22 stored | **PASS** — `stored=22 skipped=0 failed=0`, database 0 → 22 |
| text 3 / textless 19 | **PASS** — and keyed accordingly, v2×3 / v3×19 |
| placeholder body = 0 | **PASS** — 0 rows matching the placeholder or an expander control |
| author persistence = 0 | **PASS** — `excludedColumns=1` every page; no author-shaped column exists to hold one |
| same-range re-sync | **PASS** — `stored=0 skipped=22`, count unchanged at 22 |
| exact locate | **PASS** — `matches=1 highlighted=true`, once per run, independently |
| marketplace write = 0 | **PASS** — the operator turned all six page-transitions across the two runs |
| manifest states the (c) rule | **PASS** — see below |

**The manifest now says what is stored.** Both the scope sentence the gate validates and the operator-facing
disclosure carry it: a 상품평 rated without writing **is stored**, as a review with no text; Coupang's
`등록된 내용이 없습니다.` is never kept as though a customer had written it; such a review is told apart by
the option it was left on; and two textless reviews of ONE option on one day at one rating merge into one —
a known limit, accepted rather than fixed with a buyer name or a row position. The pre-decision sentence is
gone, and a test fails if it returns.

**The screen settled an argument about the completion rule.** Page 3 reported `next=true/false` — a next
control *drawn but dead* — and on a pager whose numbers resolve, that is exactly what distinguishes the last
page from a windowed one, which is what the walk read. A review-driven change had briefly extended the same
"is it pressable" question to the branch used when NO page numbers are found at all; a second independent
review caught that this branch is reached only when the reader falls back to scanning the whole document for
anything arrow-shaped, so a dead `›` in a site header would have completed a walk after page 1. It was
reverted: with no numbers to place a control against, any control at all means the walk stops. The live
sitting never touched that branch — its pager resolved on all three pages.

**`expandable=0` across 24 rows** says this account has no folded review bodies, which is why §7.5 stays
open rather than being closed by a guess.

**`known=1` on pages 1 and 2** is the recorded limitation, visible in the run's own counts: two rows on one
page were the same textless review by every field the screen publishes, and collapsed. 24 rows read, 22
identities.

---

## 7. What is NOT done

1. **One account, one sitting's worth of screens.** Everything in §6.5 was measured on a single seller's
   상품평 list of 3 pages and 24 rows. The header words, the `data-wuic-attrs` pager convention and the
   placeholder sentence are WING's, not this account's — but a second account is what would prove that.
2. **The agent does not pre-load what is already stored.** `ReviewAcquisitionSession` accepts `knownKeys`
   and the CLI passes none, so its `new` / `known` counts are per-SITTING: they catch two identical rows on
   one screen, not a review stored last week. That is deliberate for v1 — the walk covers the whole pager
   regardless, and the DATABASE is the dedupe authority, which the re-sync proved (`stored=0 / skipped=22`).
   It matters only if a future version stops walking to the end.
3. ~~**`[쿠팡에서 보기]` is not wired from the frontend.**~~ **DONE — 2026-08-15**, and documented on its
   own in `docs/coupang_review_locate_ux_v1.md`. The `REVIEW_LOCATE` intent, the single-use `locateRef` (the
   `submissionRef` shape this item predicted), the `locate` carrier, the button and its four outcomes all
   landed together and were proven on the real screen. The detail page now offers the button because there
   is a run behind it.
4. **The product SKU is Coupang's 노출상품ID with no channel prefix**, matching every other connector.
   An org connected to two channels where a NAVER SKU is exactly a Coupang productId digit string would
   collide. Not observed; recorded here rather than silently assumed away.
5. **A prefix body cannot be flagged in the product.** `bodyExpandable` — the cell offering 더보기 — is the
   only honest "this may be cut off" signal, and it stops at the agent's summary line because `reviews` has
   no column for it. The live run could not decide whether it needs one: only 3 of 22 reviews had any text at
   all, and none of the three was long enough for WING to fold. An account with long reviews settles it, and
   a column invented before that would be schema written against a guess.

6. **`mediaCount` was 0 on every row.** With 19 of 22 reviews textless there was nothing to attach a photo
   to, so "this account has no review media" and "the reader does not find media where WING puts it" are
   still indistinguishable. An account with photo reviews would settle it in one reading.

7. **Upgrading past commit `533cafc2` is a boundary, not a no-op — for rows stored before it.** Two of that
   commit's fixes change what a stored review hashes to, and nothing recomputes an existing hash:

   - a **textless** review whose 옵션ID cell was blank was keyed v2 and is now keyed v3, so a re-sync would
     not recognise it and would store a second copy;
   - a review whose body kept a trailing `더보기` now strips it, which changes both its hash and the
     fingerprint `[쿠팡에서 보기]` matches on — the old row would be un-locatable and would re-store.

   **Measured exposure today: zero rows, in every database that exists** (both proof databases return 0 for
   each case; the live account prints 옵션ID on every row and none of its three text reviews was folded).
   That is why there is no data migration — writing one against zero rows would be ceremony. It is recorded
   here because the same upgrade against an account that *does* have those rows needs one, and the check is
   the two queries above.

8. **The agent and the backend must be at the same commit.** `AgentReviewHandoffRequest.Review` refuses an
   unknown property by design — that is what makes "no author field exists" enforceable rather than
   promised — so an agent from before `533cafc2`, still sending `bodyTruncated`, gets one 400 for the whole
   sitting. Fail-closed and audible, but it costs the operator every page they turned; the harness pins the
   commit for exactly this reason.

9. **`V38` and `V39` are not exercised by any test.** The backend test profile disables Flyway and runs on
   H2, so a green build says nothing about them. Both were applied to a real PostgreSQL instead — `V38` by
   the backend that served the §6.6 sitting (`now at version v38`), `V39` by hand against the same database
   — which is the stronger evidence, but it is evidence from a run rather than from CI.

10. **A sitting hands over at most 500 reviews.** The handoff is one bounded batch, and the backend refuses
   an oversized one as a whole — so the walk stops at that bound with `REVIEW_LIMIT_REACHED` rather than
   spending an operator's whole sitting on pages that would then be refused together. What was read is
   stored; `complete` is false, and the sitting says so. A seller with more than 500 상품평 therefore cannot
   backfill in one go: the agent pre-loads no stored keys (§7.2), so a second sitting re-walks from page 1
   and the database dedupes it — correct, but it never reaches page 51. Closing that is the same work as
   §7.2, and it only becomes urgent on an account with more reviews than any yet seen.

11. **GA gates G1–G6 are untouched** (`docs/coupang_review_policy_gate_v1.md` §6.2). Nothing in this unit
   moves them; a written Coupang answer is still what releases this.
