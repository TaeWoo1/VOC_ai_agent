# Session Readiness contract (v1)

The channel-neutral vocabulary for **"is this channel's session usable right now?"** — the first thing the
Agent needs to know, pull-first, about once a day, before it does any work on a seller's channel.

This is an **internal state contract**, not an Action Window wire contract. Nothing here crosses the
FE ↔ Runtime socket; it is versioned separately from `ACTION_WINDOW_TRANSPORT_VERSION`. It is pure — no I/O,
no logging, no browser, no clock — and type-checks under `contracts/tsconfig.json` (no DOM, no Node).

## States (`SessionReadinessState`)

| state | meaning | seller action offered |
|---|---|---|
| `READY` | session usable; the Agent may work | none |
| `LOGIN_REQUIRED` | a real marketplace login is required | `LOG_IN` |
| `TWO_FACTOR_REQUIRED` | a 2FA / OTP / CAPTCHA challenge is in front of the session | `COMPLETE_AUTH_CHALLENGE` |
| `ACCOUNT_AMBIGUOUS` | session present, but which account/store is unresolved | `SELECT_ACCOUNT` |
| `EXPIRED` | **not confirmed usable** (lapsed *or* observed-but-ambiguous); fail-closed — does not assert the session ever existed | `LOG_IN` |
| `UNOBSERVED_EXTERNAL` | not observed at all — **not inferred as ready** | none |

`singleActionForReadiness(state)` is the **exactly-one-thing** guarantee: every non-ready state maps to one
action, never a menu. `readinessObservation(channelCode, state, reason)` is the only constructor a probe uses,
so the offered action can never drift from that mapping.

## Boundaries

- **Sanitized only.** An observation is a channel-code enum plus enums (`state`, `reason`, `action`), and an
  optional **opaque per-account slot** (`accountKey`). There is nowhere in it for a token, cookie, seller/account
  id, email, URL, or page text. A probe derives the state from those upstream and drops them before anything
  reaches this contract.
- **Per-account, not just per-channel.** Two accounts on one channel (two NAVER stores) are kept apart by the
  optional `accountKey` slot, so their readiness is never silently collapsed. The slot is a caller-chosen,
  sanitized, opaque label — **not** the marketplace account id. Omit it for the single-account case.
- **Never infer.** A channel the Agent has not observed is `UNOBSERVED_EXTERNAL`, mirroring the journey
  kernel's discipline for the unobserved upper journey (`../../review-import-journey/v1`). It is "not seen",
  not "probably ready".
- **SellerOps performs none of the actions.** `ReadinessAction` is copy intent for the seller (log in, clear
  the challenge, pick the account). SellerOps never solves a 2FA/CAPTCHA, never clicks an account chooser, and
  never auto-logs-in — consistent with the CLAUDE.md safety fences.

## Who classifies

The per-channel classification of raw signals into a state lives in each channel's own **observe-only** probe,
not here. The collector's NAVER probe
(`collector/src/action-window/initial-import/session-readiness.ts`) maps its existing `SessionVerdict` into
these states and projects sanitized observations through the existing `JourneyProjectionPort` — no FE, no
mounted component.

Backend persistence of readiness now EXISTS (Account-scoped Persistent Session Runtime, migration
`V29__account_session_slot.sql`, product-scope §1.7 carve-out extension approved 2026-07-27): the runtime
posts each observation (opaque launch ref + these enums only) to
`POST /api/imports/reviews/launches/{ref}/session-readiness`, and the state is stored on the account's slot
and surfaced through the existing connection-status projection. The `accountKey` field on
`SessionReadinessObservation` is that opaque slot — never a marketplace id.

**Deliberate boundary:** this slice ships the classify-and-project *seam* and the four `ReadinessProbeReason`
moments as the vocabulary; it does **not** yet invoke the probe from the live agent loop at those moments
(`local-agent` calls nothing here). Wiring the invocation runs against a real marketplace session, so it is a
separately-approved follow-up — the reasons are what that wiring will use, not a claim it is already connected.
