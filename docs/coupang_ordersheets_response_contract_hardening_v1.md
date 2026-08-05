# Coupang Ordersheets Response Contract Hardening v1

> **Status:** implementation complete **and live-verified** on a disposable environment. Fixes the
> first-`ORDER_SUMMARY`-sync blocker found during the Coupang live first-connection proof: the connect
> test passed, but the first sync failed because the `ordersheets` **HTTP 200 body did not deserialize
> into `OrdersheetEnvelope`** for the live vendor. Under a fresh single-use approval, the same failing
> sync now **succeeds** on this fix against the retained credential (details below).
>
> Canonical live-run rules: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md).
> Predecessor (the connect-test fix, proven live): [`coupang_connection_failure_diagnostic_hardening_v1.md`](./coupang_connection_failure_diagnostic_hardening_v1.md).

## What went wrong (the live finding)

The hardened connect test now succeeds on the live credential (`returnShippingCenters` 400 →
`CLIENT_ERROR` → `ordersheets` auxiliary probe 200 → `PENDING → PREPARING`). But the connect-test
order-access probe classifies on **HTTP status only** (200 → CONFIRMED) and never parses the body.
The **sync** is the first path that binds the `ordersheets` envelope, and it failed:

```
수집 실패: 쿠팡 주문 목록 응답을 해석할 수 없습니다.
```

That is `CoupangOrdersClient.getOrdersheets`'s parse-failure: `ordersheets` returned **HTTP 200**
but a body that did not bind into `OrdersheetEnvelope(code, message, data[], nextToken)`. The old
code **discarded the body** (correct for PII, but it left the exact shape invisible), so the cause
could not be seen without re-running — and re-running blindly is not allowed. *(The 200-body shape
for this vendor is not asserted here; it is what the live re-verify will confirm via the new
shape-only diagnostic.)*

## The hardening (two independent parts)

### 1. Parser: match the official v5 contract, forward-compatible, fail closed on identity

The DTO was audited field-by-field against the official v5 `ordersheets` contract:

| Contract element | Before | After |
| --- | --- | --- |
| root `code` / `message` (documented, **unused** by collection) | `Integer` / `String` | **`JsonNode`** — a scalar-vs-object variance on a field we never read can no longer break the whole page's binding |
| root `data[]` / `nextToken` | `List<Ordersheet>` / `String` | unchanged (real contract types kept) |
| `shipmentBoxId` / `orderId` (64-bit) | `Long` | `Long` (64-bit safe; Jackson coerces a numeric **string** id too) |
| `orderItems[].orderPrice` (monetary) | `Long` | `Long` via **`MoneyAmountDeserializer`** — tolerates a plain number **and** a `{currencyCode, units, nanos}` money object, canonicalized to a KRW-won `Long` |
| unknown additive fields (any level) | `@JsonIgnoreProperties(ignoreUnknown=true)` | unchanged — additive fields never break binding |

Fail-closed is preserved for the **identity/amount** fields the daily total depends on: a missing
`shipmentBoxId`, `status`, paid/ordered timestamp, `orderItems`, or a money value that cannot be
canonicalized fails the page (an honest error) rather than emitting a wrong total. Money
canonicalization: an integral number → itself; a fractional number / numeric string → rounded to
the nearest won; a money object → `units` plus the `nanos` sub-unit fraction rounded (0 for KRW);
`null`/empty → `null` (caller fails closed on the missing amount).

### 2. Shape-only diagnostic (schema, never values)

When a 200 body fails to bind, `getOrdersheets` now emits a **shape-only** diagnostic instead of a
blind generic error. It records only:

- the response `Content-Type` family (media type, params dropped);
- the Jackson **binding path** as `field[index].field` — built solely from
  `JsonMappingException.Reference` field names and array indices;
- the target Java type (`MismatchedInputException.getTargetType().getSimpleName()`);
- the root JSON node **type**, the root object's **key-name set**;
- the `data` node **type** and element **count**, and the first element's **key-name set**.

**No response value, buyer PII, order id, amount, secret, header, or raw body is ever recorded.**
Object *keys* are API schema, not data. The full shape goes to a sanitized `WARN` log; the operator-
facing sync error carries the safe path suffix, e.g.:

```
쿠팡 주문 목록 응답을 해석할 수 없습니다 (위치=data[0].orderItems[0].orderPrice).
```

so the exact failing field is actionable from the run record alone.

## Verification

- **Unit** (`CoupangApiConnectorTest`, H2 + recording fake HTTP): synthetic fixtures built from the
  official contract — a `{currencyCode, units, nanos}` money object (→ canonical won), unknown
  additive fields at every level + nullable `discountPrice`/`remotePrice` + a scalar-vs-object
  `code`/`message` variance + a blank-string `nextToken`, a 64-bit / string-rendered id, an
  unparseable body (`data` as object → value-free path `위치=data`), and a money object without
  `units` (fail closed at the exact value-free path `위치=data[0].orderItems[0].orderPrice`). Full
  backend suite green.
- **Live (verified, 2026-08-06).** Disposable `:55432/coupang_proof`, backend `:18091` running **this
  branch's code** (`984d067`), real gateway, interlock armed with a fresh single-use approval
  (`apr-5669c7c8…` / run `cp-466d21…`), operator `Seated and ready.`. The exact sync that had failed on
  `main` was re-run **once** against the **retained** credential (no re-entry):

  | signal | old run `37bb19c4` (main) | new run `1b7ccbb7` (this fix) |
  | --- | --- | --- |
  | status / rows | FAILED · 0 | **SUCCESS · 50 / 50 / 0** |
  | `connection_status` | PREPARING | **CONNECTED** |
  | `channel_orders` (total / distinct ext id) | 0 | **50 / 50** (zero dup) |
  | `order_daily_summaries` | — | 7 days · 50 orders |
  | `sync_cursor` | none | `{"initialized":true,"throughDate":"2026-08-06"}` |
  | status sweep | — | FINAL_DELIVERY 30 · DELIVERING 13 · ACCEPT 7 |

  The multi-status sweep populated three statuses (proving the sweep ran); the shape-only parse
  diagnostic fired **zero** times (the 200 body now binds cleanly). Log leakage grep (Authorization /
  secret / access_key / Bearer / signature / `orderer` / `receiver` / PII) = **0**. Only the single
  approved sync ran (idempotent re-sync is deferred to the landing on a pristine DB). Env torn down;
  interlock disarmed.

## Scope / prohibitions honored

Read-only marketplace GETs only; no order/shipping/product write; no raw provider body, header,
signature, credential, order id, or buyer PII logged, recorded, or fixtured (all fixtures are
synthetic, from the official contract — no real response is stored); no unconfirmed Coupang error
semantics asserted; no new migration (Flyway top stays **V36**). Feature-branch only; **PR opened,
not merged** — the final main first-sync + idempotent re-sync proof is a separate landing on a
pristine DB after this fix merges.
