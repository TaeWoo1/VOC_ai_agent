# NAVER review-id reconciliation — run record (EXECUTED, 2026-07-20)

> **Status: ✅ EXECUTED.** Two supervised READ-ONLY live runs. The second resolved the target review by its
> **channel review id**, exactly one row, operator-confirmed.
>
> Scope contract: [`r4-review-id-reconciliation-scope.md`](r4-review-id-reconciliation-scope.md).
> Decision: [D-036](decisions.md).

## Gates affirmed in the dispatching turn (PO, 2026-07-20)

Fresh, single-use, affirmed before the run: **read-only live NAVER inspection**, explicit
`"게이트 확인, seated and ready."`, with the scope stated by the PO in the same turn — compare in memory,
require global cardinality 1 across all rungs, re-verify the fingerprint in-page before outlining, fail closed
on anything but `outlined`, print no raw id / account id / body / URL / UUID / hash, claim **review identity
only** (not seller-account binding), and never click / navigate / type / paste / open a composer / submit.

This run crossed **no write boundary**: nothing was minted, recorded, downloaded, or posted. Its authorization
is deliberately its own flag (`--i-understand-this-inspects-live-naver-read-only`), and the CLI **refuses** a
reply or export approval flag rather than accepting the stronger grant.

## Target (privacy-safe metadata only)

The single approved `RESPONSE_NEEDED` NAVER candidate: **★1, received 2026-02-01 KST, body ~502 chars**, with
a channel-side id present in `reviews.external_id`. Same review as the Run 1–3 abort rehearsals. No raw body,
id, account id, action ref, or fingerprint was printed at any point.

## Run 1 — `idrun_34686ac82c82` · `ZERO_MATCH`

Filtered list, target visible, **13** candidate rows, scan **not truncated**.

| Rung | Rows exposing any id-shaped token |
|---|---|
| visible-text | 6 |
| anchor-href | 6 |
| input-value | 0 |
| data-attribute | 3 |
| page-state | absent |
| **network-response** | **PRESENT** |

No row carried the target identity, but **the review-list network response did** — the id the export gave us
is the id the surface serves. The runtime reported the split honestly, did **not** fall back to the calibrated
flow, and did not describe a payload match as a row match.

## The correction that made Run 2 work (PO, from the seller-center UI)

The product owner pointed out that the review list is **horizontally scrollable**, and the `리뷰글번호` column
sits off to the right. The `ZERO_MATCH` was therefore about **rendering, not exposure**: those cells were not
in the DOM. The 6-of-13 visible-text count was the tell — a list whose review-number column is present in
every row would expose a token in every row.

Two changes followed, both read-only:

1. **Exclusive-ancestor scope** — the innermost-container rule keeps an inner element and drops the wrapper
   that may carry the id. The scan now widens to the outermost ancestor that contains **this row and no
   other**, so a wrapper-borne id is attributed to exactly one row and cannot manufacture a second claimant.
2. **In-session rescan** — a miss no longer ends the run. The operator adjusts the view and the runtime
   re-reads (bounded at 10 scans). **The runtime still never scrolls or clicks**; the operator moves the view,
   the runtime only reads what is brought into it.

A PO decision was taken rather than assumed: **`상품주문번호` was NOT used as a matching key.** It is not the
identity we import (`external_id` is `리뷰글번호`), so it could not prove equality, and
`docs/review_acquisition.md` classifies it High sensitivity.

## Run 2 — `idrun_b00209b6f66d` · ✅ `MATCHED`

Same session, same filter; the operator scrolled the `리뷰글번호` column into view before the first scan.

```
matchMode        channel-review-id
matched          true      matchCount 1      matchedSource visible-text
candidateRowCount 13       scanCount 1       scopeExpandedRows 2
rowsTruncated    false     tokensTruncated  false
pageStatePresence false    networkResponsePresence true
outline          outlined  highlighted true  operatorConfirmed TRUE
secondary        asserted [] · unavailable [rating, recencyBucket, productRefFingerprint] · mismatched []
sellerAccountBinding  asserted-by-request-bundle-not-verified-against-session
```

The outline passed its **in-page re-verification** (the row at that index still carried the target
fingerprint), and the operator confirmed the outlined row was the target review.

## Exact limited claims

**This run IS:**

- **E1 — proven equality.** The review id imported from the seller's Excel export (`리뷰글번호` →
  `reviews.external_id`, carried character-for-character) and the id the live NAVER review row renders are
  **the same id**, proven by `review-id-fingerprint/v1` digests compared in memory. No raw id existed in the
  probe process at all: the backend sends only the digest.
- **E2 — exactly one row, highlighted and confirmed.** Global cardinality across every rung was 1; the row was
  outlined and the operator visually confirmed it.
- **E3 — no leak.** No raw review id, account id, action ref, review body, draft, URL, selector, or digest
  appears in any log line, the console report, or the persisted record (a unit test pins the record's shape).

**This run is NOT (do not broaden):**

- **NOT** a verified seller-account binding. The account half of the key comes from the request bundle and the
  open session's account is never read back, so `CONTEXT_MISMATCH` cannot fire in this flow. The record says so
  in its own field. **Review identity only.**
- **NOT** a general claim that the id is always reachable. It is reachable **when the `리뷰글번호` column is
  rendered**; off-screen, it is not in the DOM. Run 1 is the counter-example, kept deliberately.
- **NOT** a claim about any other review, account, channel, or filter — one supervised target.
- **NOT** cross-source body-fingerprint robustness (B1 stays `[EXT]`), and **NOT** any reply, composer, or
  submission progress. Nothing was posted; no ref was minted.
- **NOT** an endorsement of the operator-calibrated fallback as equivalent. It remains a strictly weaker mode
  (`ROW_MATCH_MODES`), labelled with its own caveat.

## Evidence

- `collector/.review-id-runs/idrun_34686ac82c82.json` (Run 1, `ZERO_MATCH`) and
  `idrun_b00209b6f66d.json` (Run 2, matched + confirmed) — gitignored, sanitized, 0600.
- Offline proof: collector typecheck clean · suite **4089 passed / 61 skipped** · browser rung green ·
  backend `./gradlew test` BUILD SUCCESSFUL.
- Independent read-only review: 1 HIGH + 8 MEDIUM found **before** the live runs, all fixed and
  mutation-tested (see the scope doc and the PR body).
