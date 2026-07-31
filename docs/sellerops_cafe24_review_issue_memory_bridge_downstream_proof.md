# Cafe24 Review → Issue-Memory Bridge — real-source downstream processing proof (sanitized)

> **What this is.** A **real-source downstream processing proof**: an already-stored, real-origin
> Cafe24 board-4 REVIEW is promoted into the canonical review store and driven through the EXISTING
> Issue-Memory pipeline — **with no Cafe24 API call**. It is **not** a new Cafe24 acquisition; the
> acquisition of this row is the prior live evidence (`#375` fresh insert, `#386` idempotent replay).
> Counts, closed-vocabulary keys, and binding booleans only — **no** review body/title/writer, member
> id, `article_no`, or org/account id appears here.

## Setup

- Disposable `cafe24_phaseb` (127.0.0.1:55432); real `sellerops:5432` untouched.
- Backend booted from this branch's working tree (reconciler + endpoint) via `tools/cafe24-local`
  (Keychain gate `decryptable=true`; Flyway **V34, no migration** — this change adds none).
- Session JWT minted by resetting the disposable-DB **app-login** password to an ephemeral value
  (local dev app-login only; Cafe24 marketplace credential untouched; files shredded after).
- **No Cafe24 API call**: only `POST …/reviews/reconcile-issue-memory` (reads storage) and the
  org-scoped `GET /api/review-issues` were invoked. The boot log shows **0** Cafe24 admin-API / board
  sync lines during the proof.

## Baseline (already stored, from #375)

| check | value |
|---|---|
| board-4 REVIEW community articles | **1** (source KST date 2026-06-29) |
| canonical `reviews` rows with a `cafe24:` external id | **0** |
| `review_issues` / `review_issue_evidence` | **0 / 0** |

## Action — bounded, no-API reconcile

`POST /api/seller-accounts/{account}/reviews/reconcile-issue-memory?startDate=2026-06-29&endDate=2026-06-29`
→ HTTP 200, `ReconcileResult`:

```
eligible=1  promoted=1  alreadyPromoted=0  skippedEmptyBody=0  skippedInvalidIdentity=0  refreshTriggered=true
```

## Result — the real review reached Issue-Memory processing

| check | observed |
|---|---|
| canonical `reviews` with a `cafe24:` external id | **1**, all `cafe24:b4:a…` and CAFE24-channel (`channelCAFE24=true`) |
| Issue-Memory refresh fired (AFTER_COMMIT) | **yes** (real tx committed → listener ran) |
| `review_issues` created | **0** |
| `review_issue_unknown_units` created | **2** |
| unknown-unit FK → the promoted CAFE24 review | **true** (n=2, all trace to `cafe24:b4:a…`) |
| `GET /api/review-issues` (org-scoped, channel-agnostic) | **0 issues** (consistent) |
| Cafe24 API / board-sync log lines during the proof | **0** |

**Honest reading.** The bridge/reconciler mechanism is proven end-to-end on **real** data: the stored
article was promoted (no API), a genuine CAFE24-channel review row was created, and the existing
extraction ran over it — its two opinion units were **unattributable**, so they went to the
**unknown-unit pen** (each FK-traceable to the promoted review), and **no `review_issue` was created**.
That is a faithful **content** outcome, not a bridge defect: this particular real board-4 review
carries no rule-based complaint signature (consistent with a neutral/positive 구매평). The full
article → `review_issue` + evidence-FK path is exercised where a complaint body exists — proven by the
synthetic H2 tests (`Cafe24ReviewIssueBridgeTest`), not fabricated here.

## Proof level

- **Live/real-source proven (this unit):** stored real-origin Cafe24 board-4 review → bounded no-API
  reconcile (`promoted=1`) → canonical CAFE24 review (honest provenance) → existing extraction ran →
  opinion units traceable back to the promoted review; org-scoped issue-graph endpoint reachable; zero
  Cafe24 API calls; zero external send.
- **Synthetic-proven (tests):** the article → `review_issue` + `review_issue_evidence` (FK to the
  source review) path when the body carries a recognized complaint; idempotent replay; empty-body skip;
  board-6 exclusion; tenant isolation.
- **Not claimed:** this is **not** a new Cafe24 live acquisition (acquisition = #375/#386). `N`/`P`/`C`
  reply tokens, 비밀글 exclusion, and a fresh board-4 insert remain as recorded in the acquisition
  proofs — untouched here.

## Post-run

Backend stopped; ephemeral app-login secret files shredded; disposable `cafe24_phaseb` left in its proof
state (1 promoted CAFE24 review, 2 unknown units, 0 issues); real `sellerops:5432` untouched. No
push/PR/merge performed by the proof itself; no Cafe24 API call, no OAuth, no external send.
