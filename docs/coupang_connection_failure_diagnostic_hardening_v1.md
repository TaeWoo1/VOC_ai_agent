# Coupang Connection-Failure Diagnostic Hardening v1

> **Status:** implementation + **live-verified** on a disposable environment. Fixes a first-connection
> failure discovered during the Coupang live first-connection attempt: a valid credential was blocked
> by an opaque `PROVIDER_UNAVAILABLE`, with no way to see the real HTTP status.
>
> Canonical live-run rules: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md).
> Interlock/harness this builds on: [`coupang_live_approval_harness_v1.md`](sellerops_live_approval_contract.md).

## What went wrong (the live finding)

During the live Coupang first-connection attempt, the connect test failed with the sanitized marker
`PROVIDER_UNAVAILABLE`. The credential probe (`returnShippingCenters`) had returned a status that was
**none of** `{200, 401, 403, 429}`, and the old code collapsed every such outcome — a transport
failure, a 5xx, and a non-401/403 4xx — into one opaque `UNAVAILABLE`, **logging nothing**. There was
no way to tell what actually happened without leaking the provider body.

The hardened build then captured the truth on the same credential:

```
Coupang credential probe not-OK: endpoint=returnShippingCenters httpStatus=400 category=CLIENT_ERROR
```

`returnShippingCenters` returns **HTTP 400 for this vendor** — it is **unsuitable** as the
credential-liveness probe here. The credential itself is valid: the `ordersheets` auxiliary probe
returned **200 (CONFIRMED)**, and the connect test now reports **SUCCESS** (`connection_status`
`PENDING → PREPARING`). *(Why the endpoint 400s for this vendor is not asserted — Coupang's exact
400 semantics are not guessed; only the observed status is recorded.)*

## The hardening

### 1. Status-carrying, split classifications (`CoupangOrdersClient`)

- `credentialProbe` now returns `CredentialProbeResult(classification, httpStatus)`. The opaque
  `UNAVAILABLE` is split into **`SERVER_ERROR`** (5xx), **`CLIENT_ERROR`** (a non-401/403 4xx, e.g.
  400/404), and **`TRANSPORT_ERROR`** (no response — connect/timeout/TLS/DNS). `OK / INVALID /
  IP_DENIED / RATE_LIMITED / INCONCLUSIVE_FORBIDDEN` are unchanged.
- `probeOrderAccess` likewise returns `OrderAccessResult(classification, httpStatus)`.
- `httpStatus` is a **safe scalar** — a number. It is `NO_HTTP_STATUS` (`-1`) for a transport failure.
  No provider body, header, signature, or credential is ever carried.

### 2. `ordersheets` auxiliary fallback (`CoupangApiConnector.verifyConnection`)

When `returnShippingCenters` gives **no authoritative credential verdict** (`CLIENT_ERROR` or
`SERVER_ERROR`) it may simply be unsuitable for the vendor, so the verifier now consults the endpoint
we actually need — a read-only `ordersheets` probe:

- `ordersheets` **200 → SUCCESS** (proves the HMAC credential the return-centers endpoint could not).
- `ordersheets` **403 (IP marker) → `CALL_ENVIRONMENT_MISMATCH`**; **403 (no marker) → `ORDER_ACCESS_DENIED`**.
- `ordersheets` **throttle / 5xx / transport → `PROVIDER_UNAVAILABLE`** (still honest — never fabricated
  into a success or an `INVALID_CREDENTIAL`).

A **`TRANSPORT_ERROR`** on the credential probe is systemic (the gateway was unreachable), so no second
doomed call is issued — it reports `PROVIDER_UNAVAILABLE` directly.

The already-proven path is unchanged: an `OK`/`INCONCLUSIVE_FORBIDDEN` credential probe still runs the
authoritative order-access probe, whose inconclusive outcomes still degrade to `success()` (a proven
credential is never blocked by a transient order-side condition).

### 3. Sanitized diagnostic logging (`CoupangApiConnector`)

A non-OK credential probe and a non-CONFIRMED order probe each emit **one** `WARN` carrying only
`endpoint`, the numeric `httpStatus`, and the `category`. Verified on the live run: **zero** occurrences
of `Authorization / secret / access_key / Bearer / X-Requested-By / signature` in the log.

## Verification

- **Unit** (`CoupangApiConnectorTest`, H2 + recording fake HTTP): `credentialProbe` classifies
  200/401/429/404/400/503/403-IP/transport each with the exact status; the **live failure is reproduced**
  (`returnShippingCenters` 404/503 → `CLIENT_ERROR`/`SERVER_ERROR`) and the `ordersheets` fallback
  rescues a valid credential (200 → SUCCESS); both-inconclusive → `PROVIDER_UNAVAILABLE`; a 404 + a
  non-IP 403 → `ORDER_ACCESS_DENIED`; a transport failure makes exactly one HTTP attempt. Full backend
  suite green.
- **Live** (disposable `:55432/coupang_proof`, backend `:18091`, real gateway, armed interlock, fresh
  single-use approval): the stored credential that previously failed now returns **SUCCESS**;
  `returnShippingCenters=400 (CLIENT_ERROR)` captured; `connection_status PENDING → PREPARING`; zero leak.

## Scope / prohibitions honored

Read-only marketplace GETs only (`returnShippingCenters`, `ordersheets`); no order/shipping/product
write; no raw provider body / header / signature / credential logged or recorded; no unconfirmed Coupang
error semantics asserted; no new migration (Flyway top stays V36); feature-branch only.

## What remains (separate unit, its own grant)

The credential now verifies, so the **Coupang Main Live First-Connection + Order Routine Proof** — the
first `ORDER_SUMMARY` sync (`PREPARING → CONNECTED`), status-sweep + `nextToken` evidence, and idempotent
re-sync — can proceed as its own operator-present unit under its own fresh single-use approval (this
unit's grant was connect-test only).
