# ESM+ Live Capture — Durable Decisions

Standing rulings for ESM+ work. These hold across sessions; change them only with an
explicit, recorded decision. Rationale/scope: [`live-capture-plan.md`](./live-capture-plan.md).

## D1 — There is no marketplace-unified capture
ESM+ serves Gmarket and Auction through one shared shell, but a capture is **never**
"both" or "unattributed". Every capture belongs to exactly one marketplace, established by
a verified page signal. Do not run any capture as marketplace-unified.

## D2 — GMARKET and AUCTION must be selected explicitly
The marketplace is chosen by an explicit on-page control (e.g. the G마켓/옥션 tab observed
2026-07-07: index 0 = GMARKET, index 1 = AUCTION). Never infer the marketplace from the
current page by default; select it and verify.

## D3 — INQUIRY and REVIEW are independent capture kinds
They are different surfaces with independent controls. Discovering, verifying, or capturing
one says nothing about the other. Treat all four `(kind × marketplace)` targets separately.

## D4 — loginMode is not marketplace attribution
The connection `loginMode` (`ESM_PLUS|GMARKET|AUCTION`) only selects the login-form
strategy. It must never be recorded as the marketplace of captured data.

## D5 — Backend channel code is not marketplace attribution
The ingest channel code `GMARKET` is the ESM+ storage label for **both** Gmarket and
Auction. It is not attribution and must not be read as the selected marketplace.

## D6 — Excel import is a fallback, separate from Live capture
The ESM inquiry Excel importer and the live-browser capture track are distinct mechanisms
with distinct code paths. Excel import is an interim/fallback bridge. A provisioned
FILE_UPLOAD SellerAccount is for Excel import only and is **never** proof of a live
browser/API connection.

## D7 — No marketplace attribution without a verified page signal
Attribution requires a verified signal read from the page (selected tab state, selected
label, URL/site param, or heading). Absent such a signal, the marketplace is `unknown`;
do not guess from hostname, `loginMode`, or channel code.

## D8 — Session/reconnect goes through the established orchestration
Reaching a session uses the established dedicated-profile + assisted-reconnect flow
(`collector/src/agent/progressive-reconnect*`, `naver/reconnect-resolve`), not a one-off
tool. A challenge (CAPTCHA/2FA/login) always stops to manual; never bypass auth.
**Scope:** D8 governs *reconnect/session handling only* — it does **not** mandate that `local-agent`
own the browser for every capture path (see D9).

## D9 — The established successful capture lifecycle is capture-owned, supervised, and same-process
The proven ESM+ REVIEW capture path (2026-06-30 → 2026-07-02, `collector/docs/esmplus-review-export-discovery.md`)
is **`capture-esm-review` owning one supervised browser lifecycle**: the operator logs in inside that same
browser when needed, and the approved capture/export runs **without closing it**. This flow used **no**
`local-agent` and **no** session hand-off. Routing capture through a `local-agent` browser (same-browser
continuity) remains an **optional future architecture for unattended runs — not a current requirement, and
not the only solution.** The one measured limitation is scoped: *in the tested `local-agent` shutdown →
separately launched capture flow, the authenticated session was not reusable, even though both launches
used the same profile.* That does not invalidate the capture-owned lifecycle.

## D10 — Live capture must be connection-explicit (PR #207)
A live ESM capture must name an explicit ESM connection (`--connection-id` + `--connections`) and resolve
its dedicated profile via the shared `connectionProfileDirFor` resolver (fail-closed on invalid / unknown /
non-ESM / non-BROWSER / non-runnable). There is **no** implicit `.profile/esm` fallback for a live capture.
This is an additive attribution/safety requirement layered on the D9 lifecycle — it does not replace it.
