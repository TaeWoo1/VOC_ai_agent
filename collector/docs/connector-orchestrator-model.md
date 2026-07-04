# Connector Orchestrator Model — architecture note

> **Status: offline core.** Pure/offline TypeScript under `src/connector/`
> (type-only agent imports, no fs / http / browser / backend). This note
> documents only the two load-bearing pieces of that layer:
> `ChannelConnector.ensureReady()` and the **API vs. Browser** strategy split.
> It sits **above** the per-(channel × account) record in
> `connector-sync-state-model.md` and reuses that layer's vocabulary
> (`CommerceChannel`, `ConnectorType`, `AuthStatus`, `CapabilityStatus`)
> unchanged.

---

## 1. `ChannelConnector.ensureReady()`

A *connector* abstracts ONE question per (channel × connection): **"get this
channel's session/credential into a usable state, once."** The orchestrator
drives every connector — API or browser, NAVER or ESM or Cafe24 — through the
**same single operation**, `ensureReady()`, so adding a channel never changes
the lifecycle, only which strategy + adapter seam it plugs into.

`ensureReady()` returns one common `EnsureReadyResult` regardless of strategy:

| field               | meaning                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `outcome`           | `READY` \| `NEEDS_USER_ACTION` \| `FAILED` \| `SKIPPED`                  |
| `authStatus`        | channel-agnostic `AuthStatus` (`CONNECTED` / `RECONNECT_REQUIRED` / …)  |
| `reconnectPath`     | browser-only rung that resolved the attempt; **`null` for API**         |
| `pendingUserAction` | which human action is needed, or `null`                                 |

**Contract, enforced by the orchestrator:**

- `ensureReady()` is called **exactly once** per connection.
- It is an **at-most-once recovery**: inspect the session/credential, and only if
  it is unhealthy-but-recoverable, attempt **one** reconnect/refresh. It never
  loops.
- Only when the outcome is `READY` **and** the channel's `ImplementationStatus`
  is `AVAILABLE` does the orchestrator then call the pure `planSync()`, which
  **generates** (never executes) a `SyncIntent`. Producing an intent triggers no
  export, fetch, upload, dedup, backend write, or status mutation.
- The sync-intent gate is the operational `ImplementationStatus` axis —
  **never** `CapabilityStatus`, which rides along on the intent as informational
  data/schema/dedup posture only.
- Per-connection isolation: a connector whose `ensureReady()` throws is reported
  `FAILED` and never aborts the others; everything crossing the boundary is a
  sanitized enum / boolean.

## 2. API vs. Browser strategies

Two strategy families implement the one contract. They differ only in how
`ensureReady()` inspects and recovers auth; both return the same result shape and
both generate a `SyncIntent` the same way.

| aspect              | `API` (`ApiChannelConnector`)                          | `BROWSER` (`BrowserChannelConnector`)                              |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Auth subject        | credential / token (e.g. Cafe24)                       | human-attended browser session (NAVER, ESM)                       |
| Inspect             | injected `ApiConnectorPort.inspect()` (non-mutating)   | launching the browser **is** the inspection (no separate step)    |
| One-shot recovery   | `port.refresh()` once when recoverable                 | Progressive Reconnect ladder, run once via `service.start()`      |
| `reconnectPath`     | always `null`                                          | the rung reported by the progressive machine                      |
| Sync mechanism      | `API_FETCH`                                             | `BROWSER_EXPORT`                                                   |
| `stop()`            | no-op (no held resource)                               | closes the live browser (`service.stop()`)                        |

**Browser strategy** adapts the *already-built* Progressive Reconnect service
(`ProgressiveServiceLike`) as its auth subcomponent — the orchestrator is the
channel-level peer of `LocalAgentStartup`, not a replacement for the progressive
machine. If `autoReconnectConsent` was not granted, `ensureReady()` returns
`SKIPPED` with `COMPLETE_MANUAL_LOGIN` and never launches a browser.

**API strategy** talks only to an injected `ApiConnectorPort` seam — **no live
HTTP / OAuth call exists in this repo yet**. Production wires a real client;
tests inject a fake. This keeps the readiness posture honest: the shape exists,
the wire does not (Cafe24 is `NOT_IMPLEMENTED`).

The channel → strategy mapping is declared once in `channel-registry.ts`; the
orchestrator and connectors never hard-code a channel.
