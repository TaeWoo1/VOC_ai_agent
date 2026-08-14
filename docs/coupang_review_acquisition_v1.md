# Coupang Review Acquisition + Locate v1

What SellerOps stores when it reads a seller's own WING 상품평 screen, how it recognises a review it
already has, and how it finds one again on the screen.

**Status: the first live backfill ran on 2026-08-15 and collected 22 reviews from the operator's own WING
screen; one stored review was located and rung on that screen.** §6.5 records what it established, the two
defects it exposed, and the one product decision it forces. The **same-range re-sync proof has not run yet**
— it is the remaining live step. Nothing here is promoted in `docs/multi-channel-connector-roadmap.md` §4.1.

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
when the cell prints one — the 옵션ID, how many photos/videos the review itself carries, and whether the
list cell had cut the text off.

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

**Rating-only reviews are dropped and counted, not stored.** Coupang lets a buyer rate without writing.
With no per-review identifier, two textless five-star reviews of one product on one day are
indistinguishable, and storing them would merge two real reviews into one — a merge that would look
exactly like dedupe working. The drop is reported per run.

## 3. How a review is recognised again

Through the ingestion spine's existing fallback: `external_id` when a source has one, a content hash
when it does not. Coupang has none, so it always hashes.

The formula is **v2** — `SHA-256(channel | product | date | body | rating)` — the same version ESM+ uses,
reached from the other direction. ESM+ exports carry no review id; Coupang's screen carries no unique
value at all. Rating has to be in the key because short bodies repeat: under v1 a five-star and a
one-star `좋아요` on one product on one day would fold into a single row.

**The option id is deliberately not in the key.** The column prints it on some rows and not others, so a
key including it would change identity when a cell rendered differently, and a re-read of the same
review would import as new. The residual: two options of one product, same day, same rating, same body
text, merge. That is recorded here as a known limitation rather than traded for an unstable key.

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
seller reads as SellerOps telling them what a buyer said. The highlight itself is a marker attribute, an
outline, and a scroll: it never clicks, focuses, types, or submits.

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
| The seller's record (list / detail / locate target) | `backend/.../review/channel/`, `frontend/src/pages/app/ChannelReviews.tsx` |

## 6.5 What the first live backfill established — 2026-08-15

Six seated `READ_ONLY` sittings on the operator's own 상품평 screen. The first five refused; the sixth
collected. Every refusal was the design working, and every fix came from a measurement rather than a guess.

### The run that worked

```
page 1: rows=10 new=9 known=1      page 2: rows=10 new=9 known=1
page 3: rows=4  new=4 known=0  →  FINAL_PAGE_REACHED
handoff: received=22 stored=22 skipped=0 failed=0   complete=true  lastPage=3
dropped(date=0 rating=0 product=0 body=0)
locate:  verdict=LOCATED matches=1 highlighted=true
```

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
| Body truncation | Undetermined; only 3 reviews had text to truncate |

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

### The open product decision

This account's reviews are **86% rating-only**. What acquisition does with them is a product-owner decision
with a real consequence either way, and it is recorded here rather than resolved:

- **(a) drop them** (the v1 rule, currently in code) — the record shows 3 of 22, and the rating distribution
  (1★×3, 2★×1, 4★×5, 5★×13) is lost entirely. No silent merge.
- **(b) store them** marked as textless — the record shows ~19, and two rating-only reviews of one product on
  one day at one score merge. Counts understate.
- **(c) store them, folding the option id into the key for textless reviews only** — now available, because
  the option id turned out to be present on every row. Separates options; same-option same-day same-rating
  still merges.

---

## 7. What is NOT done

1. **The live proof has not run.** First backfill, same-range re-sync proving `stored=0`, and one
   locate/highlight on a real review all require a fresh seated approval. Until then, the reader has
   never met the real header row — and the two things most likely to differ from the fixture are the
   exact header words (§2's role literals are candidates, supplied generously) and whether every row's
   cell count matches the header's, which currently fails the whole read closed.
2. **The sitting has a harness but has never been run.** `COUPANG_WING_REVIEW_ACQUISITION` is its own
   phase with its own bootstrap, preflight and CLI — separate from the structure discovery's, because that
   manifest describes a run that returns no text and this one returns review bodies. One checkpoint per
   page (the operator turns them), one handoff at the end, then an optional locate checkpoint. Every word
   of its disclosure is pinned by a test that reads the shell files, because this workstream has twice
   shipped a banner describing a measurement that no longer existed.
3. **`[쿠팡에서 보기]` is not wired from the frontend.** The locate itself is built, tested, and performed
   live: the acquisition sitting offers a locate checkpoint after the handoff and rings one stored review on
   the operator's own screen. What is missing is the *product* entry — a button in the review detail that
   starts that locate without a terminal.

   That needs a `REVIEW_LOCATE` run intent in `contracts/action-window/v2/`, a locate engine in the
   collector, and a backend-minted `reviewRef` so neither the review nor its target crosses the frontend —
   the same shape `submissionRef` has. The transport already exists: the Coupang guided issuance walk is
   FE-initiated over the bridge and is live-proven, so this is choreography rather than new plumbing.

   The intent is deliberately **not** in the contract yet. An intent no runtime honors is the same defect as
   an approval manifest declaring an action the run never performs — a promise in the shared vocabulary. It
   lands with the slice that implements it. The detail page correspondingly renders the review and its
   catalog identity and offers **no button**, rather than a button that does nothing.
4. **Truncated bodies are detected, not solved.** If the list cell cuts a review off, `bodyTruncated`
   says so and the stored text is a prefix. Whether the real screen truncates is a live question.
5. **The product SKU is Coupang's 노출상품ID with no channel prefix**, matching every other connector.
   An org connected to two channels where a NAVER SKU is exactly a Coupang productId digit string would
   collide. Not observed; recorded here rather than silently assumed away.
6. **GA gates G1–G6 are untouched** (`docs/coupang_review_policy_gate_v1.md` §6.2). Nothing in this unit
   moves them; a written Coupang answer is still what releases this.
