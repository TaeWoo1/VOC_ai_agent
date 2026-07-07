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
