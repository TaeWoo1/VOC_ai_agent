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
| `EXPIRED` | session was there, no longer confirmed usable | `LOG_IN` |
| `UNOBSERVED_EXTERNAL` | not observed at all — **not inferred as ready** | none |

`singleActionForReadiness(state)` is the **exactly-one-thing** guarantee: every non-ready state maps to one
action, never a menu. `readinessObservation(channelCode, state, reason)` is the only constructor a probe uses,
so the offered action can never drift from that mapping.

## Boundaries

- **Sanitized only.** An observation is a channel-code enum plus enums (`state`, `reason`, `action`). There is
  nowhere in it for a token, cookie, seller/account id, URL, or page text. A probe derives the state from those
  upstream and drops them before anything reaches this contract.
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
mounted component. Backend persistence of readiness is intentionally deferred (a follow-up), so this slice
adds no migration.
