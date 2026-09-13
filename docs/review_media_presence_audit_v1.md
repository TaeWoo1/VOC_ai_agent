# Review Media Presence Audit v1

2026-09-13. **Measurement only — no storage of any media reference, no enum.**
Marketplace calls **3** (one approved bounded READ, §2-A) · marketplace WRITE **0** ·
model calls **0** · migrations **1** (V101, §6-A).

**Revised 2026-09-13 (Media Semantics Closeout v1).** The first version of this document closed with
Cafe24 as `MEDIA_UNKNOWN` and a prepared manifest. The measurement has since been approved and run,
and §6-A's semantics fix has landed. Both sections are rewritten below; the rest stands.

Companion to `docs/review_acquisition_capability_matrix_v1.md`, which separated media into five
stages (source → parser → canonical → DB → Attention) and found each channel blocked at a different
one. That audit answered *«what could reach us»*. This one answers the narrower question the product
owner asked next: **what does the source actually carry, and what have we actually seen?**

---

## §0 — How a claim is allowed to be made here

Three kinds of statement, never mixed:

| Kind | Means | Example |
|---|---|---|
| **CODE** | A fact about this repository at this commit. Re-derivable by reading it. | `WING_REVIEW_FIELD_LABELS` has zero production callers. |
| **MEASURED** | A number this session produced against the live local database. | `media_count > 0` on 0 of 4,832 rows. |
| **CONTRACT** | A vendored vendor document says so. Not an observation of this seller's data. | Cafe24's LIST returns `attach_file_urls`. |

### The three words

Documentary vocabulary only. **No enum, no column, no schema.** They exist so this document can stop
using one word for three different situations:

- **`MEDIA_PRESENT`** — we have looked at the source and media was there.
- **`MEDIA_NOT_OBSERVED`** — we have looked, with a reader that could have seen it, and it was not there.
- **`MEDIA_UNKNOWN`** — nobody has looked, or the reader that ran could not have seen it if it were there.

The distinction that matters is the second versus the third, and this repository currently cannot
express it: `Review.media_count` is `int`, not null, and its own docblock says **«0 when unreported»**
(`backend/src/main/java/com/sellerops/review/Review.java:95`). One value carries «this review has no
photo» and «nobody counted». Every zero below is read with that in mind.

---

## §1 — The measurement that covers every channel at once

**MEASURED**, whole local database, 2026-09-13:

```
4,832 reviews · 13 orgs · media_count > 0 on 0 rows · max(media_count) = 0 · null 0
```

| channel | origin | acquisition job | rows | `media_count > 0` | max |
|---|---|---|---:|---:|---:|
| CAFE24 | REAL | yes | 10 | 0 | 0 |
| CAFE24 | REAL | no | 200 | 0 | 0 |
| COUPANG | REAL | no | 46 | 0 | 0 |
| COUPANG | DEMO_SEED | no | 22 | 0 | 0 |
| GMARKET | REAL | no | 11 | 0 | 0 |
| NAVER | REAL | yes | 171 | 0 | 0 |
| NAVER | REAL | no | 4,327 | 0 | 0 |
| NAVER | DEMO_SEED | no | 22 | 0 | 0 |
| NAVER | VERIFY_FIXTURE | no | 23 | 0 | 0 |

**This number proves less than it looks like it does**, and §0 says why. **CODE**: there are exactly
three producers of a `CanonicalReview` in the backend —

- `AgentReviewHandoffService:297` (Coupang WING) supplies `row.mediaCount()`;
- `ReviewRowMapper:67` (every file upload — NAVER export and manual CSV/XLSX) calls the 9-argument
  overload, and `CanonicalReview`'s own docblock names what that means: *«a source that reports a
  reply state but no purchased option and no review media»* → `mediaCount = 0`, written once as a
  default rather than measured;
- `MockApiConnector:188`, fenced off at two independent switches since Pilot Connection v1.

and one direct writer, `Cafe24ReviewPromoter:106`, which never touches the field at all.

**MEASURED**: exactly **32** of the 4,832 rows reached the database through the WING handoff — the
canonical Demo Org's Coupang rows, all 32 carrying an option id and none an external id. So of the
4,832 zeros, **32 are a counter's answer and 4,800 are the entity's default**; and even those 32 are
§3's reading, whose own blindness is the subject of that section. The whole-database zero is
therefore **not** `MEDIA_NOT_OBSERVED`. It is `MEDIA_UNKNOWN` with one channel's worth of texture.

---

## §2 — Cafe24 · **`MEDIA_PRESENT`** — measured 2026-09-13

**CONTRACT.** `docs/vendor/cafe24-admin-api/get-boards-articles.md`, vendored in this repository,
states three things about the exact endpoint the connector already calls
(`GET /api/v2/admin/boards/{board_no}/articles`):

- the response property table carries **`attach_file_urls`** with sub-fields `name`, `url` (line 205);
- the response sample prints it literally: `"attach_file_urls": [ { "name": "…", "url": "…" } ]` (line 123);
- the LIST publishes an **`attached_file` (`T`/`F`)** request filter (line 65).

**CODE.** `Cafe24BoardArticleRow` projects `article_no · title · content · product_no · rating ·
created_date · updated_date · reply_status · secret · order_id · parent · depth · sequence` and is
annotated `@JsonIgnoreProperties(ignoreUnknown = true)`. The field is parsed and discarded without a
trace on every sweep. `cafe24_community_articles` has 18 columns and none is an attachment.
`Cafe24ReviewPromoter` writes a `Review` without ever naming `mediaCount`.

### §2-A — The measurement

Approved bounded READ, executed once against the canonical Demo Org's connected mall
(`Cafe24AttachmentPrevalenceRunner`, board 4, window 365 days, **3 requests**, integers out, nothing
stored):

```
outcome=OK  requests=3
articlesInWindow=7   windowFull=false
withAttachment=1     attachmentsTotal=1     attachmentsMax=1
vendorFilteredWith=1 vendorFilteredWithout=0
filterPartitions=false  filterAgreesWithField=true
```

**Cafe24 review articles carry attachments. One of seven does, and it carries one file.** That is the
first observation of review media anywhere in this product, and it converts the v1 matrix's
«contract says YES, nobody looked» into a fact.

**The denominator is not an artefact of our paging.** Our own stored copy of this board says 7 of its
134 articles fall inside the 365-day window (the other 127 are 2015–2025), and the probe read exactly
7. The window read is complete; the *board* is not measured, and 127 older articles are unmeasured.

**Two contract observations, both worth recording:**

- **`attached_file=T` agrees exactly with the field.** The filter returned 1 and the probe measured 1
  independently. Counting articles-with-media by the filter is therefore trustworthy, and it costs one
  request and reads no bodies.
- **`attached_file=F` does NOT return the complement.** It returned 0 where 6 were expected, so
  `T + F ≠ total` and the partition does not hold. Whatever `F` means on this mall, it is not «and
  the rest» — so a count of articles *without* an attachment cannot be obtained that way, and only the
  positive filter may be relied on. The vendored reference documents the parameter and not its
  semantics; this is now recorded next to it.

**What was NOT done:** nothing stored, no column added, no URL, name or filename read into any field
(`RawArticle` has two fields and one is an `int`), no article number logged, no paging beyond the
window, no second window, no write of any kind. The single state change was the single-use refresh
token rotation the shared `Cafe24Authorizer` performs on every authorize — verified afterwards as
**1 credential row, rotated once, connection intact**, with the Demo Org's 134 reviews and 134
board-4 articles unchanged.

## §3 — Coupang · **`MEDIA_UNKNOWN`**, and the census the brief asked for **has no caller**

Coupang is the only channel whose media producer exists and runs. What it is:

**CODE** — `collector/src/action-window/coupang-review/review-row-inpage.ts:198`:

```js
function mediaCountOf(cells, byRole) {
  if (!Object.prototype.hasOwnProperty.call(byRole, 'body')) { return 0; }
  var el = cells[byRole.body];
  if (!el || !el.querySelectorAll) { return 0; }
  return el.querySelectorAll('img, video').length;
}
```

It counts inside the **body cell only**, and the comment above it says why: a row-wide count would
have counted the product thumbnail every row carries. That reasoning is right and it is also the
limit — **`REVIEW_COLUMN_ROLES` (line 52) has six roles and none of them is media**: `excluded ·
date · rating · product · productName · body`. A WING grid column holding photos would be an unnamed
column, and an unnamed column is not looked in.

**MEASURED** — Coupang rows by shape:

| shape | rows | `media_count > 0` | textless |
|---|---:|---:|---:|
| option id present (WING-acquired) | 32 | **0** | 28 |
| external id present (`RV-*` CSV) | 12 | 0 | 0 |
| neither | 2 + 22 seed | 0 | 0 |

**MEASURED** — the last observed WING reading (2026-09-12, Aside driver,
`aw_coupang_review_aside_read`): `rows 10 · verdict MATCH · rolesResolved 5 · excludedColumns 1 ·
textless 10 · bodyExpandable 0 · bodyTruncated 0`. Ten of ten rows had an empty body cell. A counter
that looks only inside an empty body cell returns 0 whatever the row holds elsewhere.

**CODE** — the per-run log line (`aside-review-acquisition-driver.ts:112`) reports
`textless · bodyExpandable · bodyTruncated · textlessExpandable` and **says nothing about media**. A
live run therefore reports media only through the stored rows, which §1 already counted.

### §3-A — «read out the existing photoWord / videoWord census»: there is nothing to read

The brief asks to read out the census that already exists. **It cannot be read out, and that is the
finding.** `WING_REVIEW_FIELD_LABELS` (`coupang-wing-review-driver.ts:58`) does contain
`{ id: "photoWord", exactText: "사진" }` and `{ id: "videoWord", exactText: "동영상" }`, and
`censusReviewList` / `censusAllFrames` would log them (`aw_coupang_review_census`, line 207).

**CODE**: `grep -rn "censusReviewList\|censusAllFrames\|aw_coupang_review_census" collector/src tools`
returns **the two definitions and the log statement, and not one call site** — not in the acquisition
run, not in the Aside driver, not in any CLI, not in any tool script. Every caller that exists is a
test (`collector/test/action-window/coupang-wing-review-driver.test.ts`), and the only references to
`WING_REVIEW_FIELD_LABELS` outside its own file are in two test files.

So the two probe words were written, compiled, tested, and **never once asked**. Reading them out
would mean adding a production caller, which is a code change this audit is not permitted to make.

### §3-B — Verdict, and the boundary that is a decision rather than a gap

**`MEDIA_UNKNOWN`.** Two readings fit the measured zero and nothing in this repository chooses
between them: the seller's 상품평 genuinely carry no photos, or the detector is looking in the wrong
cell. Calling it `MEDIA_NOT_OBSERVED` would claim a reader that could have seen it, and §3's first
paragraph is the reason we cannot claim that.

Separately and unchanged: **Coupang's media boundary is a written commitment, not an unbuilt
feature.** `docs/coupang_review_policy_gate_v1.md` §5.1 records 「저장하지 않는 항목: … 이미지·동영상
원본」 and D7 permits *media metadata* only. Nothing in this audit touches that, and no equivalent
statement exists for Cafe24 or for the seller's own NAVER export.

---

## §4 — NAVER · **`DEFERRED`**

The brief's condition applies: the Seller Center is not accessible from this session and this audit
does not open it.

**CODE / MEASURED**, what the repository can say without one:

- the committed export contract (`contracts/review-export/naver/v1/SPEC.md`) declares 25 columns and
  **column E is `포토/영상`** — confirmed this session by parsing the real fixture's header row;
- `ReviewRowMapper` claims 8 of those 25 by alias (`body · product · sku · rating · date ·
  externalId · replyState · repliedAt`) and **`포토/영상` is not one of them**; `HeaderAliases.pick`
  is an exact-key lookup, so it cannot be satisfied by a neighbouring column;
- the file-upload path constructs `CanonicalReview` through the no-media overload, so even a mapped
  column would have nowhere to go;
- **MEASURED**: in the committed fixture, column E is non-empty on **1 of 6 data rows**, and its
  value is `https://example.invalid/synthetic-media-1`. `.invalid` is a reserved TLD. That cell is
  the fixture author's placeholder, not an observation — **the shape of a real `포토/영상` cell is
  unrecorded anywhere in this repository.**

Deferred, therefore, on the strongest possible ground: we do not know whether a real cell holds a
URL, a count, a `Y`/`N`, or a blank. **What would close it is one real export file** — a single
seller-center download, read offline, with nothing stored. No API, no credential, no live run.

---

## §5 — Manual CSV / XLSX upload · **`MEDIA_UNKNOWN` by construction**

`POST /api/uploads` accepts any file for any channel and is addressed by channel with no account
(which is what Agent-native Core Boundary v1 was about). **CODE**: `ReviewRowMapper` defines aliases
for body, product, sku, rating, date, external id and reply state, and **no alias of any kind for a
media, photo, image, attachment or video column**. A seller whose file carries one is not refused and
is not read — the column is skipped in silence.

There is no fixed source schema here, so the honest verdict is neither PRESENT nor NOT_OBSERVED: the
path cannot see media at all, and whether the files sellers actually upload carry any is a question
about their files rather than about this product.

---

## §6 — So is an acquisition-completeness model needed?

Not yet as an enum — the v1 matrix already concluded that, and this audit strengthens rather than
changes it. An enum over four values, three of which no path can reach, reads as a fact and is not one.

What this audit established as worth doing **first** was narrower, and it is done.

### §6-A — `media_count` can now say whether a zero is an answer (V101)

The column was `int not null` meaning «0 when unreported», so one value carried «this review has no
photo» and «nobody counted» — which is why §1's whole-database zero proved so little. V101 adds
**one boolean**, `reviews.media_count_observed`:

| | meaning |
|---|---|
| `false` | **UNKNOWN** — nobody looked, or the reader that ran could not have seen it |
| `true`, count `0` | **observed none** |
| `true`, count `> 0` | **observed present** |

Carried, never derived: `CanonicalReview.mediaObserved` is a component of the record and the
producers set it, because `mediaCount > 0` is exactly the conflation being removed and a test forbids
that expression in both files. The Coupang WING handoff passes `true` (its counter ran); every
file-upload path passes `false` through overloads whose defaults say so.

**The backfill is deliberately the conservative one: every existing row is `false`, including the 32
a counter did produce.** Those rows are precisely the case the three words exist for — `mediaCountOf`
looks inside the body cell only and the WING column vocabulary has no media role, so a reader ran and
could not have seen media outside the cell it looked in. Calling them «observed none» would put a
migration's authority behind a reading that did not have it. Verified after applying V101 to the
local database: **4,829 rows, all `false`, 0 ERROR/WARN.**

**It stores no reference.** One boolean column; a test asserts the migration's DDL adds exactly that
and nothing that could hold a URL, filename or blob.

**No product surface reads it yet, and that is the design.** The first reader is whatever consumes
media; until then it exists so a measurement can tell a zero apart from a silence — which is what no
measurement could do before it, including this document's own §1.

## §7 — Does storing a media reference actually become necessary?

**Not for anything the product does today, and the audit can say that with a measurement.**

- Attention does not read media: **MEASURED** — `OperatorVocItem` has 24 record components and the
  substring `media` appears in none of them. (Correcting the v1 matrix's report of «17 fields»: the
  count is 24 at this commit. The claim that mattered — none of them is media — is unchanged.)
- **MEASURED** — `getMediaCount` has exactly **one** reader in the whole backend
  (`ChannelReviewService`, which puts the number on the review DTO). The decision workspace's
  `decision-context` does not read it, the drafters do not, the retrieval lanes do not, the issue
  extractor does not.
- **MEASURED** — the frontend renders it in exactly **two** places, both the same 「사진·영상 {n}」 chip
  on the channel record (`ChannelReviews.tsx:495` and `:643`), and both are `> 0`-gated — so on this
  database neither has ever drawn. The Decision Workspace does not render it at all.

So the reference is needed exactly when the product decides to do something with the picture, and not
one step earlier. **Storing presence is a different and much smaller question** — and the slot for it
already exists at every stage except the two Cafe24 has never wired.

---

## §8 — The smallest next multimodal boundary, and whether it is needed

The line still runs **between carrying presence and carrying a reference**, and the measurement moves
one of those two from «unknown» to «available».

- **Presence is now real and cheap on Cafe24.** The field rides on a call the connector already
  makes; projecting its array LENGTH needs no new request, no new scope, no new store beyond the two
  columns that exist. `attached_file=T` even counts it without reading bodies, and §2-A measured that
  filter as trustworthy.
- **A reference has no slot at any stage**, and the moment one exists the product is storing a
  customer's photograph. `docs/image_product_knowledge_v1.md` recorded that as a product-owner
  decision rather than a cost one, and nothing here reopens it.

**Is the next multimodal step actually needed? Not yet, and the audit can say so with numbers.**
`getMediaCount` has exactly one backend reader and two `> 0`-gated frontend render sites; Attention,
the drafters, retrieval and the issue extractor read nothing. The prevalence measured is **1 article
in 7 over a year, carrying 1 file** — enough to prove the capability exists and nowhere near enough
to make a seller's day depend on it. Multimodal inference, image download and image storage remain
what they were: a product-owner decision that this measurement informs and does not force.

What the measurement *does* change is that the cheapest honest step is no longer blocked on an
unknown. Projecting Cafe24's `attach_file_urls` **length** would make `media_count_observed=true` for
a whole channel and turn §1's uninterpretable zero into a real prevalence figure — without a single
URL entering the database.

## PRODUCT_DECISION_NEEDED

1. **Project Cafe24's `attach_file_urls` LENGTH on the existing sweep, or leave the channel
   unmeasured?** The measurement says the field is populated and the filter is trustworthy. Doing it
   costs no new request and stores no reference; not doing it leaves a channel with proven media at
   `media_count_observed=false` forever.
2. **NAVER:** one real export file read offline would settle a column this repository has only ever
   seen as a synthetic placeholder. Otherwise `DEFERRED` stands.
3. **Coupang:** wire a caller for the census that exists, or accept `MEDIA_UNKNOWN` as the standing
   answer. Without a caller the measured zero can never become «observed none».
4. **Whether a media *reference* may be stored at all**, and the answer may legitimately differ per
   channel: Coupang carries a written commitment not to; Cafe24 and the seller's own NAVER export
   carry none. Unchanged, and now the only remaining gate on anything multimodal.
5. **`attached_file=F` does not return the complement** on this mall. If Cafe24 prevalence is ever
   counted by filter rather than by field, only the positive filter may be used — recorded here
   beside the vendored reference, which documents the parameter and not its semantics.
