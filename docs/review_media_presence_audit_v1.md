# Review Media Presence Audit v1

2026-09-13. **Measurement only — no code change, no storage change, no schema, no enum.**
Marketplace calls **0** · WRITE **0** · model calls **0** · migrations **0**.

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

## §2 — Cafe24 · **`MEDIA_UNKNOWN`** (measurement prepared, blocked on approval + two external values)

**CONTRACT.** `docs/vendor/cafe24-admin-api/get-boards-articles.md`, vendored in this repository,
states three things about the exact endpoint the connector already calls
(`GET /api/v2/admin/boards/{board_no}/articles`):

- the response property table carries **`attach_file_urls`** with sub-fields `name`, `url` (line 205);
- the response sample prints it literally: `"attach_file_urls": [ { "name": "…", "url": "…" } ]` (line 123);
- the LIST publishes an **`attached_file` (`T`/`F`)** request filter (line 65) — i.e. the vendor
  supports asking *«only the articles that have one»* without reading any of them.

**CODE.** `Cafe24BoardArticleRow` projects `article_no · title · content · product_no · rating ·
created_date · updated_date · reply_status · secret · order_id · parent · depth · sequence` and is
annotated `@JsonIgnoreProperties(ignoreUnknown = true)`. If the field is on the wire today it is
parsed and discarded without a trace. `cafe24_community_articles` has 18 columns and none of them is
an attachment. `Cafe24ReviewPromoter` writes a `Review` without ever naming `mediaCount`.

So for Cafe24 the five stages read: **source YES (contract) · parser NO · canonical NO · DB NO ·
Attention NO**, and the only unanswered one is whether this seller's board-4 articles actually
populate it. That is one bounded READ and nothing else.

### §2-A — The bounded READ this measurement needs (prepared, NOT run)

| | |
|---|---|
| channel / account | CAFE24, the canonical Demo Org's connected mall (`seller_accounts` CONNECTED, sealed OAuth credential present, `last_synced_at 2026-09-08`) |
| surface | `GET /api/v2/admin/boards/4/articles` — the endpoint the connector already calls on every routine sweep |
| operation | READ |
| mode | **READ** (no WRITE variant exists for this measurement) |
| requests | **≤ 3**: one `attached_file=T` discovery over a window we already hold, plus at most two `article_no=`-pinned reads |
| what leaves the mall | nothing |
| what is reported | **integers only** — articles in window, articles with a non-empty `attach_file_urls`, the length distribution of that array, and whether the `attached_file=T` filter is honoured |
| what is stored | **nothing.** No column, no table, no file. No `name`, no `url`, no filename, no body. |
| what is NOT done | no PUT, no POST, no comment, no scope change, no new connector code path |

**Two things block it and neither is mine to supply.** This session's environment has
`SELLEROPS_VAULT_MASTER_KEY` **unset** and `SELLEROPS_CAFE24_CLIENT_ID` **unset**, so the sealed
credential cannot be opened and the connector cannot start; and a live marketplace run needs a fresh,
single-use, in-turn approval bound to this manifest (`docs/sellerops_live_approval_contract.md`).
**STOPPED and requested** — see the final report.

---

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
changes it. **Every path in this document lands on `MEDIA_UNKNOWN`.** An enum with one reachable
value reads as a fact and is not one.

What this audit *does* establish is the one field that would be worth a schema change **before** any
enum: `media_count` cannot answer «did anyone look». Whatever the multimodal decision turns out to
be, that column's contract — 0 meaning both «none» and «unreported» — is the thing to fix first,
because it is what makes every number in §1 unusable as evidence.

---

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

## §8 — The smallest next multimodal boundary

Unchanged from the v1 matrix and now measured rather than argued: the line runs **between carrying
presence and carrying a reference.**

- **Presence** needs no new store anywhere (`CanonicalReview.mediaCount` · `reviews.media_count` ·
  the chip), and for Cafe24 it needs no new request either — the contract says the field rides on a
  call the connector already makes, and `attached_file=T` even offers a count without reading bodies.
- **A reference** — a URL, a filename, a byte — has no slot at any stage, and the moment one exists
  the product is storing a customer's photograph. `docs/image_product_knowledge_v1.md` already
  recorded that as a product-owner decision rather than a cost one, and this audit does not reopen it.

The single cheapest honest step is therefore: **project Cafe24's `attach_file_urls` length and
nothing else**, after §2-A's measurement says whether there is anything to project.

---

## PRODUCT_DECISION_NEEDED

1. **Approve (or decline) §2-A's bounded Cafe24 READ.** ≤ 3 requests, integers out, nothing stored.
   It needs a single-use live approval **and** two repo-external values this session does not hold:
   the vault master key that sealed the Demo Org's credential, and the Cafe24 app credentials.
2. **NAVER: one real export file, or leave it DEFERRED.** A single seller-center download read
   offline would settle a column the repository has only ever seen as a synthetic placeholder.
3. **Coupang: wire a caller for the census, or accept `MEDIA_UNKNOWN` as the standing answer.**
   Reading out the probe that already exists is a code change; leaving it unread means the measured
   zero can never become `MEDIA_NOT_OBSERVED`.
4. **`media_count`'s contract.** 0 currently means both «no media» and «nobody counted». Fixing that
   is the prerequisite for any later media work being measurable, and it is a schema decision.
5. **Whether a media *reference* may be stored at all — and the answer may legitimately differ per
   channel.** Coupang carries a written commitment not to; Cafe24 and the seller's own NAVER export
   carry none. This is the same decision the v1 matrix raised and it is still open.
