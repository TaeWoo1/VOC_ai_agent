# Catalogue-independent Review Ingest + Bootstrap Closeout v1

2026-09-14. Product decision: **a review does not need a product catalogue to be a review.**

A Coupang 상품평 read from the browser arrives with three things the channel published — 노출상품ID,
옵션ID, and the product name printed beside it. Until this package, a row whose identifiers matched no
listing this org holds was **dropped**: counted `UNRESOLVED_DISPLAY_PRODUCT_ID`, reported as a failure,
and stored nowhere.

That made a seller's own reviews conditional on a catalogue that arrives down a **different pipe**. The
product catalogue is built by the OpenAPI product sync; a seller who connected the browser and nothing
else holds **zero products**. Measured live on 2026-09-13, on exactly that shape of org: identity MATCH,
read ok, 10 rows, `handoff received 9 · stored 0 · failed 9`, `optionInCatalogue=0
optionNotInCatalogue=9`, org reviews **0**.

So the review **read** was OpenAPI-independent and the review **ingest** was not. This closes that.

---

## 1 · Inventory first — most of it already existed

The audit is the reason this package is small.

| what the brief asked for | what the repository already had |
|---|---|
| a review with no product | **`reviews.product_id` is already nullable**, and has been since Cafe24 promotion; `Cafe24ReviewPromoter` writes null ones today |
| read paths that survive a null product | **already null-guarded** — every review read site guards `getProductId()`, because the Cafe24 rows forced it years ago |
| product denominators that exclude it | **already** — `countOperationalByProduct` requires `r.productId is not null`; `ReviewIssueQueryService` counts `unattributed` on its own axis and never folds it into a product row |
| issue extraction on an unlinked review | **already** — issues are org-scoped by signature (`uq_review_issues_signature` is `(org_id, signature_key)`), and `review_issue_evidence.product_id` is nullable |
| the purchased option preserved | **already** — `reviews.source_option_id` (V37) |
| an identifier-only attribution lane | **already**, for inquiries — `ChannelProductRef`: «its presence IS the rule», resolve by the channel's identifier or not at all |
| a reconcile that links stored rows later | **already**, as a pattern — `ReviewProductLinkBackfill`: bounded, re-runnable, counted, idempotent |

What was missing was **two columns and one lane**.

## 2 · The product linkage model

**V105 — two columns, no backfill, no new table.**

```sql
alter table reviews add column source_product_ref  varchar(64);   -- 노출상품ID, verbatim
alter table reviews add column source_product_name varchar(255);  -- what the channel printed
create index idx_reviews_source_product_ref on reviews (channel_id, source_product_ref)
    where source_product_ref is not null;
```

Mirrors `inquiries.source_product_ref` exactly — same width, same partial index, same meaning: a verbatim
record of what the source said, **sitting beside** the resolution rather than replacing it.

**`product_binding` was deliberately NOT added.** Inquiries need it to protect a person's answer from a
later collection (`USER_CONFIRMED`). Reviews have no such lane: nobody hand-binds a review's product, so a
column distinguishing «linked at ingest» from «linked by reconcile» would change no behaviour and
would have to be kept true by hand forever.

**No backfill.** The 4,830 stored reviews were resolved at ingest and their source ref is not recoverable
from anything this database holds. `null` means «this row predates the column», which is the true
statement, and it is never read as «the channel named nothing».

### The lane

`CanonicalReview` gains one component, `ChannelProductRef productRef`, and it means what it means for
inquiries — **its presence is the rule**:

- **null** → the legacy name/SKU `resolveOrCreate`, byte for byte. Every file-upload source.
- **non-null** → attributed by what the caller already resolved against the channel's own identifiers
  (`AgentReviewHandoffService`: 옵션ID first, then 노출상품ID with an option tie-break), **find-only**.
  No name fallback. No product created. No `(미지정 상품)` bucket.

Not finding one is an answer, not a failure: the review is stored with a null product and the channel's
identity beside it.

### Two unresolved products are two things

The brief forbids folding different unresolved products into one `(미지정 상품)` domain object. Here that
is **structural rather than policed** — there is no object to fold them into, because nothing is created.
What keeps them apart afterwards is that each row carries the channel's own id.

### Nothing resolves by the name

`ReviewProductLabel` is the one rule for what to *print*: the linked catalogue name, else what the channel
called it. It is a label and never an attribution — `ReviewProductLinkageFenceTest` fixes that
`getSourceProductName()` has **exactly one reader** and that no count in `ReviewRepository` mentions
either source column.

It also gives every surface the reading it needs **without a third field**: a null `productId` with a
non-null name IS the unlinked state, because the only producer of a name without an id is that fallback.

## 3 · The dedup key had to change, and why

Every review hash folds in «which product is this about». The only available answer was our own
`products.id` — which cannot be computed for an unlinked row and, worse, **changes when a catalogue
arrives later and the row is reconciled**. A key that changes on reconcile means the next read of the same
review hashes to something new and is stored twice: the seller would watch their review count double for
connecting an API.

So a **declaring source keys on the identifier the channel published**, which no resolution of ours can
move. Non-declaring sources keep passing their resolved product id and hash byte-for-byte as before.

**The migration cost is real and is paid in one place.** A review stored under the pre-V105 formula is
recognised by a declaring re-read through one bounded legacy-key lookup, asked only where such a row can
exist (a declaring row that DID resolve). Without it, the first re-read of an already-collected store
would file every one of its 상품평 again — measured: **33 Coupang rows** in the local Demo Org are in that
state.

## 4 · The unresolved review, as the seller meets it

- **Review list / record / home** — the row is named with the channel's product name, and carries no
  product doorway (there is nothing to open).
- **Decision Workspace** — it opens, the judgment controls stand, the decision trail records. The product
  figures are **absent rather than zero** (`productSignal` null — that rule predates this package), and
  the screen now says why: 「판매 채널에서 읽은 상품명입니다. 아직 상품 목록의 상품과 연결되지 않아
  상품별 수치는 표시하지 않습니다.」
- **`상품 미지정` is not used for these rows.** It would be wrong twice: the channel *did* name the
  product, and that phrase is this product's word for the shared bucket unresolved rows must never join.
- **Issue extraction runs**, and the evidence carries a null product — which `ReviewIssueQueryService`
  already counts as `unattributed`, apart from every per-product row.
- **`unlinked` is its own count**, on the handoff result and in the helper's log line. It is a fact about
  the catalogue, not about the import: `failed` now means only what the ingestion spine could not write,
  and a complete walk whose rows were all unlinked records **SUCCESS**.

## 5 · The carrier lifecycle bug

**Symptom (live, 2026-09-13):** after the store-identity confirmation CTA, the next run was refused twice
with 「판매자센터 화면을 준비하지 못했습니다」. A helper restart was the only way past it.

**Cause, read out of the code and the logs.** The bootstrap run ends UNRESOLVED and **parks** — blocker
`STORE_UNRESOLVED`, stage `awaiting_page`, status `WAITING_FOR_HUMAN`, which is *not settled*. So
`maybeRelease` correctly kept the carrier, for the fifteen-minute window grace. Two seconds later the
seller pressed 「이 스토어를 연결하고 리뷰 가져오기」, the card remounted asking for the **same** carrier,
and `OnDemandCarrierHost` took its `same` branch and re-announced the parked run. But the acquisition
carrier mints its `runId` at activation and binds a single-use acquisition ref to it — **the carrier IS
the run** — so a second `START_RUN` on that engine is refused, and the seller reads a screen-preparation
failure about a helper that is working fine.

**Fix — one declaration, no new semantics.** `ActivatedCarrier` gains `servesOneRun`, a property of the
carrier's *kind*, and `acquire/coupang` declares it. The `same` branch then reads the same two things the
existing handover reads, and they mean the same things here:

- **no attached tab** — the frontend is the only thing that sends commands, so a run with no tab on it is
  not being driven by anyone;
- **`servesOneRun`** — a re-announcement would be *useless*, not merely redundant.

Both required. A tab still attached always re-announces (a refresh, a second tab of the same run), and a
carrier whose window outlives its run — every guided walk, where WING shows the secret key once and the
seller returns to the same screen to copy it — always re-announces. Release is sequenced exactly as the
handover is, so two carriers never hold a browser at once, and the spent run's `dispose()` writes its
ending down as it always did.

**No scheduler, no retry semantics, no wire change.**

## 5-A · The readiness dead end (found live, 2026-09-14, mid-sitting)

The first live attempt on a genuinely fresh browser-only account never reached the marketplace. The
seller linked their helper — card 연결됨, `device_link_result {"outcome":"linked"}` — and the same
service answered **`HELPER_NOT_LINKED`**, under a sentence telling them to connect the helper they had
just connected, beside a button going to a page that could not have changed the answer.

**The state was reading a different fact than its name.** `linked` was
`slots.findBySellerAccountId(...).isPresent()` — whether this account has an **AccountSessionSlot**,
which is an opaque identifier **minted on first use** (`getOrCreate`; the session-slot GET mints one
just by being read). Its absence says nothing about a helper and everything about whether some other
screen has happened to ask for one yet. A seller who connected a browser and nothing else never had one.

So the gate required a value that only the gated action produces — **the same circularity this package's
sibling closed for the store identity**, in a second place, and this time it was a dead end rather than a
detour.

**Fix.** `linked` now asks the fact its name claims: does this org have a live helper device
(`existsByOrgIdAndRevokedAtIsNull`). The slot is minted where it is actually needed — by `mint`, at the
moment the seller asks for a run — which is find-or-create and grants nothing (the slot is not a
capability; the org still comes from the JWT everywhere it is accepted).

**And the screen stops holding two answers to one question.** With the corrected predicate, the 도우미
card and this sentence agree. The duplicate `[도우미 연결하기]` beside the blocked sentence is gone: the
card above already offers `[이 기기 연결]`, and the file's own neighbouring rule already said so —
«the card directly above owns the next step; a second button to the same page is not a choice».

## 6 · Live harness

`tools/helper/live-redact.sh` — a stdin filter for harness output, masking the 업체코드 shape and any
named literal. It exists because on 2026-09-13 the code appeared in my own stdout, from a command I ran,
after I had said it would not. It is a **discipline, not a privacy control**: it masks a shape, and a
shape can be wrong in both directions. `live-preflight.sh` pipes its own status line through it — the
point of a harness discipline is that it does not depend on remembering which line is safe.

The observation caps, the installed-package preflight and the stop rules are unchanged.

## 7 · What this package does not do

- **No reconcile is implemented.** The *boundary* is what was asked for and what was built: the source ref
  is stored and indexed by `(channel_id, source_product_ref)`, so when a catalogue arrives
  `channel_products` can be joined on it and the link written **without re-reading the marketplace** — and
  the dedup key does not move when it is. `ReviewProductLinkBackfill` is the shape such a pass takes.
- **No OpenAPI call is made** by the browser lane, and none was added.
- **The 문의·주문 OpenAPI lane is untouched.**
- No pagination, no write, no scheduler, no multimodal, no NAVER.
