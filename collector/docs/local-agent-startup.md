# Local Agent Startup / Composition Root (design + usage)

> **Shipped slice.** This documents the device-local production entrypoint that
> boots the configured connections through the multi-channel **Connector
> Orchestrator**: `src/agent/local-agent-connector-startup.ts` (pure composition
> root) and `src/cli/local-agent.ts` (the thin, gated live CLI). Progressive
> Reconnect remains the **browser-auth subcomponent**
> (`src/agent/local-agent-startup.ts` + `local-agent-progressive-service.ts`),
> adapted per connection by the orchestrator's `BrowserChannelConnector`. Catch-up
> **execution**, an operator reconnect UI, a live API port, and a persisted
> connection store remain separate, not-yet-existing slices.

## Why this exists

The progressive-reconnect stack drives ONE browser channel. SellerOps is
multi-channel (NAVER, ESM, Cafe24, and more to come), and different channels are
reached differently — a **browser** export session vs. a credentialed **API**.
This root generalizes the old progressive-only boot onto the channel-agnostic
`ConnectorOrchestrator`: it loads a **mixed** set of connections, turns each into
a connector handle through the channel registry, and drives them all through the
**one** uniform operation `ChannelConnector.ensureReady()` — each connection
settled in isolation, with a sync intent **generated but never executed**.

Progressive Reconnect is not replaced — it is the browser strategy's auth
subcomponent. A device that boots through here still runs the **progressive**
ladder for its browser channels and never constructs the legacy two-step
`LocalAgentRuntime` reconnect path.

## What it does

- **Builds handles through the registry.** Each validated connection becomes a
  `ConnectorHandle` via `createConnectorHandle(channel, id, deps)`. Browser
  channels are wired to ONE shared `LocalAgentProgressiveService`; every other
  channel gets a `SKIPPED` handle.
- **Boots each connection independently.** `boot(connections)` drives every
  handle through the orchestrator via a single `ensureReady()`, in order and in
  isolation: a connector whose `ensureReady()` throws is reported `FAILED` and
  never aborts the others; a malformed configured entry is skipped (surfaced),
  not fatal.
- **Surfaces the four common outcomes.** Every connection settles as `READY`,
  `NEEDS_USER_ACTION`, `FAILED`, or `SKIPPED` — a sanitized enum, alongside its
  `channel`, `strategy`, `implementationStatus`, `authStatus`, and (browser-only)
  `reconnectPath`.
- **Surfaces sync intents, never executes them.** A `SyncIntent` (mechanism only:
  `API_FETCH` / `BROWSER_EXPORT`) is **generated** only when a connection is both
  `READY` and `AVAILABLE`. Generating it triggers no export, fetch, upload, dedup,
  backend write, or status mutation.
- **Lazy browser service.** The browser-auth service is constructed **only** when
  the boot actually contains a runnable browser connection. An API-only or
  discovery-only boot builds no browser service at all.
- **Clean, idempotent shutdown + isolation.** `shutdown()` stops each started
  connector exactly once; a second shutdown is a no-op; one connection's failed
  teardown never blocks the rest. The CLI wraps it in `createSignalShutdown` so a
  double SIGINT/SIGTERM runs teardown once.

## Channels & strategies

The channel → strategy mapping is declared once in the registry
(`src/connector/channel-registry.ts`); connectors and the orchestrator never
hard-code a channel. Two independent axes: the **strategy** (`BROWSER` / `API`)
and the operational **implementation status**.

| Channel(s)                              | Strategy  | Implementation      | On boot                                  |
| --------------------------------------- | --------- | ------------------- | ---------------------------------------- |
| **NAVER**, **ESM**                      | `BROWSER` | `AVAILABLE`         | runnable — Progressive Reconnect auth    |
| **Cafe24**                              | `API`     | `NOT_IMPLEMENTED`   | `SKIPPED` (no API port wired yet)        |
| **Coupang**, **11st**, **SSG**, **TodayHouse** | *(none)* | `DISCOVERY_REQUIRED` | `SKIPPED` (no connector at all)          |

- **NAVER / ESM** are the AVAILABLE **browser** adapters — the only runnable
  connections today.
- **Cafe24** is the **API / `NOT_IMPLEMENTED`** channel: the strategy exists, but
  no live API port is wired, so it settles `SKIPPED` and never yields a sync
  intent. (Not implemented in this slice.)
- **Coupang / 11st / SSG / TodayHouse** are **`DISCOVERY_REQUIRED`**: no strategy
  proven yet, so they produce a no-connector `SKIPPED` handle — never a fake
  connector, never held for shutdown.

## Mixed connection descriptors

`parseConnectorConnections(raw)` reads a **sanitized** JSON array of MIXED
descriptors — never a credential, store id, cookie, token, URL, or DOM:

```json
[
  {
    "connectionId": "naver-1",
    "channel": "NAVER",
    "loginMode": "ESM_PLUS",
    "autoReconnectConsent": true,
    "autoSubmitConsent": true,
    "assistedReconnectConsent": true,
    "autoReconnectCapability": "ASSISTED_ONLY"
  },
  { "connectionId": "cafe24-1", "channel": "CAFE24" },
  { "connectionId": "coupang-1", "channel": "COUPANG" }
]
```

- **`channel` is required** and must be a known channel (see the table above). An
  unknown channel is a malformed entry.
- **Browser-auth fields apply only to browser strategies.** For a `BROWSER`
  channel (NAVER / ESM) `loginMode` (∈ `ESM_PLUS | GMARKET | AUCTION`) and the
  three separate consents are **required**; the account fingerprint, dedicated
  profile id, and initial-form strategy (`DIRECT` for `ESM_PLUS`,
  `DOCUMENT_START_BOOTSTRAP` otherwise) are **derived**, not carried.
  `autoReconnectCapability` is optional and defaults to `UNKNOWN` (never claims
  `VERIFIED`). For an **API** or **discovery-required** channel these fields are
  ignored — an API descriptor needs only `connectionId` + `channel`.
- **Resilient, not all-or-nothing.** A malformed entry or a duplicate
  `connectionId` is skipped and surfaced (`rejectedEntryIndexes` /
  `duplicateConnectionIds`) so the remaining connections still boot. Only
  structurally unusable input (bad JSON, a non-array root, or an empty `[]`) fails
  closed.

## Running it (gated, strategy-aware)

```bash
cd collector
npm run local-agent -- --connections <path.json> [--i-understand-this-launches-local-agent-chrome]
```

The launch decision is the pure `decideRun(args, raw, env)`, and the live-config
gate is **strategy-aware**:

- **A runnable browser connection exists** (at least one `BROWSER` + `AVAILABLE`).
  The Chrome **approval flag** and the **browser environment values** are
  required. Without them (or with incomplete config) the CLI does a **DRY RUN** —
  it validates + counts the connections, prints the plan, and launches nothing /
  creates no profile; if approved but config is incomplete it refuses (non-zero)
  rather than silently degrading. With both, it **LIVE BOOTs**; a human always
  performs login / 2FA / CAPTCHA — the agent never types marketplace credentials.
- **No runnable browser connection** (API-only or discovery-only). No Chrome ever
  launches, so **no approval flag and no browser environment values are
  required** — the CLI boots directly, every connection settles `SKIPPED`, no
  browser service is constructed, and it exits cleanly (nothing is held resident).

Browser environment values (required **only** for a runnable browser connection,
supplied out-of-band, never committed):

- `ESM_AUTH_SURFACE_URL` — the browser login surface URL.
- `STORAGE_PROBE_SALT` — the salt used for the one-way form/environment
  signatures.
- Optional: `COLLECTOR_CHROME_PATH`, `ESM_FRAME_ORIGIN_ALLOWLIST`. The
  per-connection profile lives under `<collector>/.profile/<dedicatedProfileId>`.

The production config shape reflects this: `LocalAgentConnectorStartupConfig` has
an **optional** `browser` runtime config rather than mandatory global ESM fields;
the browser service is realized lazily and only if a browser connection needs it.

## Boundaries (out of scope here)

Cafe24 (or any API port) is **not implemented** — API channels settle `SKIPPED`.
No OS auto-start, no tray UI, no installer, no catch-up **execution**, no Device
Vault, no backend writes, no persistence migration, no scheduler. Sync intents
are **surfaced, never executed**. Nothing on this path writes `CapabilityStatus` /
schema-mapping / dedup verification — a running Local Agent is **not** a CONFIRMED
capability.

## Related

- `src/connector/connector-orchestrator.ts` — the channel-agnostic orchestrator
  this root drives (see `docs/connector-orchestrator-model.md`).
- `src/connector/channel-registry.ts` — the channel → strategy / implementation
  table.
- `src/agent/local-agent-startup.ts` — the progressive-only composition root; now
  the browser-auth subcomponent (hosts `ProgressiveServiceLike`).
- `src/agent/local-agent-progressive-service.ts` — the per-connection progressive
  composition service wired for browser channels.
- `src/agent/progressive-reconnect.ts` — the pure policy core (reducer, ladder,
  consent gates, bounded bootstrap).
