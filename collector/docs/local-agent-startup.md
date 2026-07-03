# Local Agent Startup / Composition Root (design + usage)

> **Shipped slice.** This documents the device-local production entrypoint that
> wires the progressive-reconnect ladder into a running lifecycle:
> `src/agent/local-agent-startup.ts` (pure composition root) and
> `src/cli/local-agent.ts` (the thin, gated live CLI). It is the slice that turns
> the earlier "future wiring seam" (`createLocalAgentProgressiveService`) into an
> actual startup path. Catch-up **execution**, an operator reconnect UI, and a
> persisted connection store remain separate, not-yet-existing slices.

## Why this exists

The progressive-reconnect stack was built bottom-up and merged as pure,
offline-tested layers — policy core → runtime → live Chrome port → composition
service — but nothing constructed or called it in production. This root closes
that gap: one `LocalAgentProgressiveService` for the whole device, booted against
the configured connections, with the sanitized intents surfaced and a clean
shutdown. A device that boots through here runs the **progressive** ladder
exclusively — it never constructs the legacy two-step `LocalAgentRuntime`
reconnect path.

## What it does

- **Constructs the service.** `createLocalAgentStartup(config)` builds one wired
  `LocalAgentProgressiveService` (which builds the live
  `ProgressiveReconnectChromeBrowser` per connection) driven by a
  `LocalAgentStartup`.
- **Per-connection startup + isolation.** `boot(connections)` starts each
  connection in turn. A connection whose `start` throws is reported
  (`started:false`) and never aborts the others; a malformed configured entry is
  skipped (surfaced), not fatal. Every connection — including a partial start — is
  retained so its browser is always closed on shutdown.
- **Routing.** `routeSessionLost(id)` and `routeHumanCompleted(id, action)`
  address exactly one connection by id (unknown id → `null`, never a throw).
- **One-shot user actions.** A user-action request is drained (surfaced) exactly
  once and reported; a second drain for the same step is empty.
- **Pending catch-up, surfaced but never acknowledged.** A catch-up request means
  "run one catch-up sync". Executing catch-up is **out of scope** here, so the
  root never acknowledges/consumes it — that would falsely mark it done. It stays
  **pending** and is exposed as `pendingCatchUp` (a pure read; repeated reads
  never duplicate or consume it). `shutdown()` reads and **surfaces** any
  still-pending catch-up in its report rather than silently discarding it as
  completed.
- **Clean, idempotent shutdown.** `shutdown()` stops + closes each managed
  connection exactly once; a second shutdown is a no-op. The CLI wraps it in
  `createSignalShutdown` so a double SIGINT/SIGTERM runs teardown once.

## Configured connections

`parseProgressiveConnections(raw)` reads a **sanitized** JSON array of connection
descriptors — never a credential, store id, cookie, token, URL, or DOM. Each
descriptor:

```json
[
  {
    "connectionId": "conn-A",
    "loginMode": "GMARKET",
    "autoReconnectConsent": true,
    "autoSubmitConsent": true,
    "assistedReconnectConsent": true,
    "autoReconnectCapability": "ASSISTED_ONLY"
  }
]
```

- `loginMode` ∈ `ESM_PLUS | GMARKET | AUCTION`. The account fingerprint, the
  dedicated profile id, and the initial-form strategy (`DIRECT` for `ESM_PLUS`,
  `DOCUMENT_START_BOOTSTRAP` otherwise) are **derived**, not carried.
- `autoReconnectCapability` is optional and defaults to `UNKNOWN` — the agent
  never claims `VERIFIED`.
- The three consents are separate grants (never bundled).
- **Resilient, not all-or-nothing.** A malformed entry or a duplicate
  `connectionId` is skipped and surfaced (`rejectedEntryIndexes` /
  `duplicateConnectionIds`) so the remaining connections still boot. Only
  structurally unusable input (bad JSON, a non-array root, or an empty `[]`) fails
  closed.

## Running it (gated)

```bash
cd collector
npm run local-agent -- --connections <path.json> [--i-understand-this-launches-local-agent-chrome]
```

Booting launches a local Chrome per connection — a **live** action. The launch
decision is the pure `decideRun(args, raw, env)`:

- **DRY RUN (default).** Without the approval flag — or with incomplete live
  config — the CLI validates + counts the connections, prints the plan, and
  **launches nothing and creates no profile**. If the operator passed the approval
  flag but live config is incomplete, it refuses (non-zero) rather than silently
  degrading.
- **LIVE BOOT.** Only when the operator approved **and** the live config is
  complete. A human always performs login / 2FA / CAPTCHA — the agent never types
  marketplace credentials and never bypasses auth.

Required live config (supplied out-of-band, never committed):

- `ESM_AUTH_SURFACE_URL` — the ESM login surface URL.
- `STORAGE_PROBE_SALT` — the salt used for the one-way form/environment
  signatures.
- Optional: `COLLECTOR_CHROME_PATH`, `ESM_FRAME_ORIGIN_ALLOWLIST`. The per-
  connection profile lives under `<collector>/.profile/<dedicatedProfileId>`.

## Boundaries (out of scope here)

No OS auto-start, no tray UI, no installer, no catch-up **execution** (pending
catch-up is surfaced only), no Device Vault, no backend writes, no persistence
migration. Nothing on this path writes `CapabilityStatus` / schema-mapping /
dedup verification — a running Local Agent is **not** a CONFIRMED capability.

## Related

- `src/agent/progressive-reconnect.ts` — the pure policy core (reducer, ladder,
  consent gates, bounded bootstrap).
- `src/agent/progressive-reconnect-runtime.ts` — the pure orchestrator over the
  browser port.
- `src/agent/progressive-reconnect-chrome.ts` — the live-only real Chrome port.
- `src/agent/local-agent-progressive-service.ts` — the per-connection composition
  service this root drives.
