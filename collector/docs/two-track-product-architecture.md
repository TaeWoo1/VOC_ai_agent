# Two-Track Product Architecture — Seller Operations & Manufacturer Intelligence

> **Status: architecture note.** This documents the product-level split that the
> connector layer is being re-aligned onto. Only the connector composition seams
> exist in code today — the browser-track root
> (`src/agent/local-agent-connector-startup.ts`) and the API-track root
> (`src/connector/cloud-api-connector-startup.ts`), both driving the shared
> `ConnectorOrchestrator` (`connector-orchestrator-model.md`). The
> **Signal → WorkItem → Proposal → Action → Verification** lifecycle below is the
> shared target shape; the WorkItem domain is **not implemented yet** and is named
> here only so both agents are designed against one spine.

---

## 1. Two agents, one seller-owned data spine

SellerOps is two products over the same commerce data, serving two audiences:

- **Seller Operations Agent** — serves the *seller*. It watches the seller's own
  channel data (reviews, inquiries, claims, orders) and helps the seller run the
  store: surface what needs attention, propose a response, act, verify it landed.
- **Manufacturer Intelligence Agent** — serves the *manufacturer/brand* upstream
  of the seller. It reasons over product-level signal aggregated **across the
  sellers who have granted access**, to inform the manufacturer's product,
  quality, and supply decisions.

The load-bearing rule is **seller-owned channel data**. All channel data belongs
to the seller who collected it. The Seller Operations Agent operates on it by
default. The Manufacturer Intelligence Agent may see a seller's data **only**
through an explicit, revocable **seller-to-manufacturer DataGrant** — a
first-class authorization that names which seller, which manufacturer, and which
scope (channel / product / signal category) is shared. No grant, no cross-flow:
the manufacturer track never reads a seller's data by default, and a seller can
revoke a grant. (The DataGrant is a design object here, not yet a code module.)

```
  seller-owned channel data
        │
        ├── Seller Operations Agent            (always: the seller's own data)
        │
        └── explicit seller→manufacturer DataGrant
                  │
                  └── Manufacturer Intelligence Agent   (only granted scope)
```

## 2. Cloud API connectors vs. Local Browser connectors

Both agents are fed by the **same connector contract**
(`ChannelConnector.ensureReady()`), but ingestion splits by **who owns the auth**
and **where it runs** — two tracks, one orchestrator:

| aspect            | **Local Browser connectors**                         | **Cloud API connectors**                              |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Composition root  | `local-agent-connector-startup.ts` (Local Agent)     | `cloud-api-connector-startup.ts` (Cloud seam)         |
| Strategy          | `BROWSER` (`BrowserChannelConnector`)                | `API` (`ApiChannelConnector` + injected port)         |
| Auth subject      | human-attended browser session on the seller's device | credential / OAuth token (e.g. Cafe24)               |
| Where auth lives  | the seller's own machine — credentials never leave it | injected `ApiConnectorPort` (token vault behind seam) |
| Channels today    | NAVER, ESM (`AVAILABLE`)                             | Cafe24 (`AVAILABLE` only when its port is injected)   |
| Owns the other's? | **No** — never stores or constructs an API port      | **No** — constructs no browser service; SKIPs browser |

**Ownership is enforced, not just documented.** The Local Agent owns browser
connectors only: it constructs no Cafe24 API port and stores no Cafe24
credential — a Cafe24 descriptor reaching the Local Agent settles `SKIPPED`
(`NOT_IMPLEMENTED`). The Cloud seam owns API connectors only: it constructs no
browser service — a browser descriptor reaching it settles `SKIPPED` (not owned),
never a throw and never a browser launch. Each track's source guard test asserts
it imports nothing from the other track.

An API channel is **runtime-ready only when its production port is injected**
into the Cloud seam (deps-driven promotion to `AVAILABLE`); absent the port it
stays `NOT_IMPLEMENTED`. The live token call + encrypted token persistence live
behind the injected port — a separate, not-yet-existing slice.

## 3. Shared lifecycle: Signal → WorkItem → Proposal → Action → Verification

Both agents are designed against ONE downstream lifecycle so the tracks converge
rather than fork. Today the connector layer produces the sanitized inputs (a
`SyncIntent` per ready connection, generated never executed); the stages after
**Signal** are the target domain, **not implemented yet**.

| stage            | meaning                                                                 | status                 |
| ---------------- | ----------------------------------------------------------------------- | ---------------------- |
| **Signal**       | a sanitized, coarse observation derived from channel data (attention signals today) | partial — exists for the review/event spine |
| **WorkItem**     | a deduped, owned unit of work a signal rolls up into                    | **not implemented**    |
| **Proposal**     | a suggested response/action for a WorkItem (draft reply, price change…) | **not implemented**    |
| **Action**       | the executed proposal (send / update / export)                          | **not implemented**    |
| **Verification** | confirmation the action landed and had its intended effect              | **not implemented**    |

The two agents differ in *audience and aggregation*, not in spine: the Seller
Operations Agent runs this lifecycle over one seller's data; the Manufacturer
Intelligence Agent runs an aggregate view of the same signals across granted
sellers. Keeping one lifecycle is why the connector tracks stay symmetric — same
`ensureReady()`, same `SyncIntent`, same sanitized enums — differing only in auth
ownership.

## 4. Scope of the current slice

- Preserves the reusable Cafe24 auth components (`Cafe24ApiConnectorPort`,
  authorization-state mapping, `Cafe24AuthorizationStore`, `Cafe24OAuthClient`).
- Removes Cafe24 production ownership from the Local Agent (browser-only again).
- Adds the pure Cloud API connector composition seam (owns API ports, drives the
  orchestrator; no server, scheduler, database, network call, or backend write).
- Does **not** implement the WorkItem domain, the DataGrant module, any new
  channel, or any live API port.
