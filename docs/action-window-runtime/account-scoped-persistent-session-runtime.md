# Account-scoped Persistent Session Runtime (design + offline proof record)

> **Scope:** give each seller account its own persistent browser profile so a marketplace login survives an
> agent restart, keep multiple accounts on one channel fully isolated, and persist session readiness in the
> backend (reconciled with connection health) — surfaced through the *existing* projection, no new FE.
> **Authorization:** `product-scope-v1.md` §1.7 **carve-out extension** (owner-approved 2026-07-27) — durable
> persistence for THIS runtime only. Standing safety (root + `collector/CLAUDE.md` §4) is unchanged. This
> record grants **no** live authorization.
> **Date:** 2026-07-27 · **Mode:** offline (no browser, no NAVER, no marketplace socket) until the final
> live step.

## The one thread: an opaque account slot, backend → scope → profile

The runtime already keeps a NAVER login in a persistent Chrome profile, but the import path used ONE shared
profile (`.profile/naver`) for every account, and the Action Window wire refuses to carry a seller-account
id. So two accounts on one channel would have shared cookies. This slice threads a **server-owned, opaque,
stable per-account slot** end-to-end:

- **Backend owns it.** `account_session_slot` (migration `V29`) holds one row per seller account with a
  stable opaque `account_slot` (24-hex, minted once via `AccountSessionSlotService.resolveSlot`, find-or-
  create/idempotent — the *reuse* is what makes a profile stable across restarts). It is **not** the
  seller-account id and is **not reversible** to it.
- **Launch scope carries it.** `resolveScope` adds `accountSlot` to the identity-free
  `ReviewImportLaunchScopeView` (and the collector `LaunchScopeResponse` / `ResolvedLaunchScope` and the pure
  `SegmentLaunchScope`). No plan/segment/account id joins it.
- **The profile is chosen from it.** `accountScopedProfileDirFor(profileBaseDir, channelCode, accountSlot)`
  (collector `profile.ts`) resolves `${base}/<channel>-agent-<sha256(channel␠slot) :24>` — a one-way hash, in-
  tree-guarded, distinct from the ESM `esm-agent-<hash>` family. Same account → same dir (restart reuse); two
  accounts → two dirs (isolation); no raw slot/separator/`..` reaches the path.

## When the profile binds (product-owner decision 2026-07-27)

The account is known only at **run start** (it rides the launch scope), but the browser opens at boot. So:
SellerOps stays in the boot context; the **seller-center tab opens in its own account-scoped persistent
context at run start**, once `resolveScope` has set the slot. A connect-time warm-up that arrives before the
slot is known is **deferred** (LazyImportDriver swallows the deferral; the first run opens the surface in the
right profile). Trade-off accepted: the seller center appears at run start rather than at connect, and it is
a second OS window.

## Durable session readiness + connection-health reconciliation

- The runtime posts each probe observation — opaque ref + two sanitized enums only — to
  `POST /api/imports/reviews/launches/{ref}/session-readiness`; the server resolves ref→account and stores
  `readiness_state`/`readiness_reason`/`last_observed_at` on the slot (survives an agent restart). Unknown
  enum values **fail closed** (400), never a guessed READY.
- The existing `GET /api/seller-accounts/{id}/connection-status` view is enriched with `sessionReadiness` +
  `sessionObservedAt` — reconciled *beside* the sync-health `ChannelConnectionStatus` already owns, never
  conflated with it. This is the "existing projection" surface; **no new FE screen**.

## Acceptance criteria — how each is met (offline)

| criterion | evidence |
|---|---|
| Account A login survives a restart | slot is stable (`AccountSessionSlotServiceTest`), and the same slot → same profile dir (`profile.test.ts`); so a restart reuses A's `userDataDir`. |
| Account B never mixes profiles/cookies with A | distinct slots → distinct dirs (`profile.test.ts`); distinct DB rows (`AccountSessionSlotServiceTest`). |
| Expiry/re-login reflects only the correct account | readiness is recorded per account slot; B untouched when A is written (`AccountSessionSlotServiceTest`). |
| No real seller/account id, cookie, token in path/log/trace | slot is opaque + not-reversible; profile leaf is a hash (`profile.test.ts` asserts the slot is absent from the path); readiness log omits the key; the readiness POST body is `{state, reason}` only (`upload.test.ts`); scope `toString` carries no account/segment/plan id (`ReviewImportLaunchServiceTest`). |
| Fresh profile only in explicit tests | production always resolves an account-scoped (or legacy-shared) dir; a fresh profile is only ever chosen by a test passing a new slot. |

**Whole-stack offline gate green:** backend `./gradlew test`; contracts typecheck + `vitest run test/contracts`
(163); collector `npm run typecheck` + full `vitest run` (~5360); frontend `tsc --noEmit` + `vitest run` (1025).

## Boundaries (still locked)

- **No live run yet.** The final live step (one real NAVER account, prove a login survives an agent restart)
  runs only under a fresh, single-use, in-turn approval — never standing.
- **No** auto-login/2FA/CAPTCHA, **no** profile upload/sync, **no** second-channel adapter, **no** new FE
  screen, **no** `#355` change. `OperationRun`/`CapabilityPolicy` bodies and automatic dispatch remain locked.
