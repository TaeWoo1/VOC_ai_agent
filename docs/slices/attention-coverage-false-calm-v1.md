# Slice — Attention Coverage / False-Calm Guard v1

> **Status:** IMPLEMENTED, offline. A read-time safety slice: the attention summary now says whether
> it can safely determine the review-attention state, so an empty list is never rendered as "nothing
> needs attention" when SellerOps could not attribute the reviews. **No migration, no new acquisition
> infrastructure, no account-scoped-ingest redesign** — the deeper fix stays a separate track.

- **Workstream:** Review Operations (`docs/workstreams/review_operations_mvp.md`)
- **Loop stages:** UNDERSTAND / PRIORITIZE (the attention surface)
- **Date:** 2026-07-24 · **Live contact:** none

---

## 1. Why — an empty attention surface was hiding real 1★ reviews

Two scopes could not be safely attributed, and **both collapsed into an unlabeled empty summary
indistinguishable from a genuine zero** — a false calm on the one surface a seller trusts to say
"you're caught up":

1. **Multi-account channel.** When an org holds more than one seller account on a channel, ingested
   reviews carry no `seller_account_id`, so `IngestedReviewVocItemSource.unambiguousChannelFor`
   returned null and the caller produced `EMPTY_SNAPSHOT`. The code even said so — *"an ambiguous
   unsupported state, NOT a confirmed zero… the response carries no status field"* — but only in a
   `log.warn` the seller never sees. A seller with two accounts on one channel saw a calm, empty
   surface over real unanswered 1★ reviews.
2. **Unsupported channel.** ESM+/GMARKET (and any channel with no attention source) resolved to no
   source → `EMPTY_SNAPSHOT` → zero signals, rendered exactly like "nothing needs attention".

## 2. What changed

**`AttentionCoverage`** (new enum, `com.sellerops.attention`): `COVERED` ·
`UNCERTAIN_MULTI_ACCOUNT` · `UNCERTAIN_UNSUPPORTED_CHANNEL`. A sanitized read-time verdict — it names
the scope's coverage, never any org/account/channel identity.

**`VocItemSource.coverage(orgId, accountId)`** — a default returning `COVERED`.
`IngestedReviewVocItemSource` overrides it to `UNCERTAIN_MULTI_ACCOUNT` on exactly the condition that
made `unambiguousChannelFor` return null (>1 account on the channel). Same condition, now surfaced.

**`OperatorAttentionService.attention`** decides coverage first: **no source → `UNCERTAIN_UNSUPPORTED_
CHANNEL`**, else the source's verdict. An uncertain scope contributes **no** signals (never a
fabricated one, never a real one read off a snapshot that could not be attributed); the empty list
plus the verdict is the honest answer. `OperatorAttentionSummary` carries `coverage`.

**Frontend** (`AttentionSignalList`): when `coverage !== "COVERED"` it renders an explicit
decline-to-answer notice **instead of** "지금 확인할 일이 없습니다." — a new branch ordered *before*
the empty-list branch. FE-owned copy (`attentionUncertaintyCopy`, `lib/attention.ts`), reason-specific:

- multi-account: **"이 채널의 확인 상태를 안전하게 판단할 수 없어요."** + why (여러 계정이 연결되어
  리뷰를 계정별로 구분할 수 없고, 아무 일도 없다는 뜻이 아님).
- unsupported: **"이 채널의 리뷰 확인 상태는 아직 지원하지 않아요."** + why (비어 있는 것이 확인이
  끝났다는 뜻이 아니라 아직 판단하지 않는다는 뜻).

The DEV mock (`lib/mocks.ts`) mirrors the new backend: the non-NAVER demo account now reports
`UNCERTAIN_UNSUPPORTED_CHANNEL`, single-account NAVER reports `COVERED`.

## 3. What is NOT in this slice

- **No account-scoped ingest.** Reviews still carry no `seller_account_id`; the multi-account case is
  now *declared* uncertain, not *resolved*. Closing it is the separate, deeper track.
- **No new acquisition infrastructure, no migration.** Coverage is computed at read time from
  existing `seller_accounts` counts + the source registry.
- **No change to single-account NAVER.** A supported, unambiguous scope stays `COVERED`; its empty
  window still reads "지금 확인할 일이 없습니다." — a measured zero the guard must not swallow.
- **The drill-down (`items`) is unchanged.** An uncertain scope raises no signals, so there is no
  card to drill; the summary is the gate, and that is where the false calm lived.

## 4. Verification

| | before | after |
|---|---|---|
| backend | 1503 (2 skipped) | **1506** (2 skipped) |
| frontend | 805 | **808** |
| collector | untouched | untouched |

Both typechecks clean.

**Tests.** Backend `AttentionCoverageTest` (new): single-account NAVER with a 1★ review → `COVERED`
+ the signal; single-account NAVER with no reviews → `COVERED` + measured empty (the preserve-behavior
case); a second NAVER account → `UNCERTAIN_MULTI_ACCOUNT` + empty (the 1★ review is real and must not
hide). `EsmAttentionEmptyStateTest` updated: GMARKET → `UNCERTAIN_UNSUPPORTED_CHANNEL`, not a safe
empty. Frontend `AttentionSignalList.test.tsx`: COVERED-empty still says "확인할 일이 없습니다";
multi-account and unsupported each render the decline notice and NOT the calm line.

**Falsified:** revert the service to always-`COVERED` → the multi-account + GMARKET tests fail; revert
the FE guard (`uncertainty = null`) → both FE uncertain tests fail.

## 5. Recorded, not fixed

- **The real fix for multi-account is account-scoped ingest** (reviews carrying a `seller_account_id`),
  which would let the surface *answer* instead of decline. This slice makes the gap honest and visible;
  it does not close it.
- **ESM+/GMARKET review attention** remains unsupported — now stated as such rather than shown as calm.
  Serving it is a source-adapter + attribution question on its own track.
- **Run 7 — EXECUTED and COMPLETED 2026-07-24.** No gate consumed by this slice, no live contact.
