# ESM Plus — access model & recommended path (offline)

> **Offline access-model note — no live API calls.** No ESM credentials, seller
> IDs, ESM+ Master ID, API key, or JWT exist or are modeled here. Secrets never
> live in the repo. This documents *how access would be obtained* and which path
> SellerOps should pursue — before any integration work.

## Primary reference

Official **ESM Trading API guide**:
<https://etapi.gmarket.com/pages/API-가이드> (in code:
`ESM_TRADING_API_GUIDE_URL`). Used as **documentation context only** — no live
API calls are made from this layer. See also `esmplus-feasibility.md` for the
capability map and normalized event shapes.

## Facts the guide establishes (paraphrased)

- A **Gmarket / Auction seller membership** is required.
- An **ESM+ Master ID** is required.
- **API permission / application approval** is required, and **may be denied** for
  internal support / resource / stability reasons — approval is **not** guaranteed.
- Authentication is **key / JWT style**: header `kid` carries the **ESM+ Master
  ID**; payload `ssi` carries **site ID + site seller ID** (Auction/Gmarket
  seller IDs).
- The API checks **authentication, allowed IP / request integrity, and
  authorization** for the requested resources.
- The application asks for: **API scope, ESM Master ID, service site URL, sales
  scale, development period**.
- **Selling-tool companies** must themselves register as Gmarket/Auction seller
  members using their **own business information**, and may additionally need
  **service introduction materials** and the **current number of Gmarket/Auction
  sellers** using them.

**Interpretation:** ESM API access is **not a simple self-serve OAuth-style
integration**. It is a discretionary, application-and-approval gate with
membership, Master ID, key/JWT auth, and allowed-IP/authorization checks layered
on top. None of these credentials exist in this repo and none will be committed.

## 1. Access models

### A. Seller-owned pilot integration

- Uses the **seller's own** ESM+ Master ID / Gmarket seller ID / Auction seller
  ID / API permission.
- Useful for a **single design-partner seller** to validate CS-inquiry / order /
  claim workflows against real (their own) data, with their consent.
- **Not scalable** as a SaaS onboarding model — every seller would have to obtain
  and hand over their own API permission and credentials.
- Requires **explicit seller consent** and careful credential handling: secrets
  stay in the seller's runtime environment, **never in this repo**, never logged.
- Treat strictly as a pilot, not the architecture.

### B. SellerOps as approved selling-tool provider *(scalable target)*

- SellerOps (the company) eventually needs its **own business registration** and
  Gmarket/Auction **seller memberships**, plus its own **ESM+ Master ID** and
  **API permission as a selling-tool service company**.
- The application likely requires **service introduction material, service site
  URL, requested API scope, development period, and seller-count** information.
- Sellers would connect by **enabling / selecting / authorizing the SellerOps
  selling-tool integration inside ESM Plus** (rather than each seller handing
  over raw credentials).
- This is the **scalable, multi-seller target model** — the long-term path.

### C. Browser / export fallback

- **Only** for data not covered by official APIs (e.g. **reviews**, if no
  official API exists — currently unconfirmed; see §5 and `esmplus-feasibility.md`).
- Must remain **user-consented and human-assisted**.
- **No CAPTCHA / 2FA bypass. No automatic account / store selection.** The same
  discipline as the NAVER connection work applies (see
  `connection-onboarding.md`).
- A last resort, scoped to the specific unsupported area only.

## 2. Practical approval interpretation

We do **not** know ESM's exact internal review severity or scoring, and this
document does not claim to. What the guide makes reasonable to infer:

- Approval is **discretionary**. It likely evaluates **eligibility** (valid
  business + memberships + Master ID), **service stability**, **requested API
  scope**, and **operational readiness** — not a fixed checklist we can see.
- A **seller-owned pilot (model A) is probably easier** to stand up than
  selling-tool **provider approval (model B)**: model A reuses an existing
  seller's already-granted permission rather than asking ESM to approve a new
  third-party service.
- **New selling-tool provider approval (model B) may require stronger proof:**
  service introduction, a **security / operations plan**, **pilot sellers**, and
  demonstrable **product maturity**. A brand-new company with no track record
  should expect more scrutiny.
- Approval can still be **denied** for internal resource / stability reasons even
  when materials are complete. Plan for that outcome; do not assume approval.

## 3. Recommended staged path

### A. Representative seller pilot *(do first)*

- Use a **representative seller account only as a design-partner / pilot seller**,
  under **that seller's own** ESM Master ID and permission.
- Position the work honestly as an **internal operations tool / delegated
  development for that seller**, not as a public multi-tenant SaaS.
- Validate the **CS-inquiry / order / claim** workflows end to end against one
  real (consented) account.
- **Do not** treat this as the long-term multi-seller SaaS architecture — it is a
  validation vehicle that retires integration unknowns, nothing more.

### B. SellerOps business / provider path *(prepare in parallel)*

- After **business registration**, create SellerOps' own **Gmarket / Auction
  seller memberships** and **ESM+ Master ID**.
- Prepare the **selling-tool provider application**.
- Assemble the materials the guide implies: **service introduction**, **security /
  operations** material, **requested API scope**, **development period**, **service
  site URL**, and **pilot evidence** from step A.
- If the **current seller count is zero**, be **transparent** about it and ask ESM
  support directly whether a new SaaS provider can apply with **pilot / design-
  partner evidence** in lieu of an existing seller base (see §4 and §7).

## 4. Seller-count catch-22

- The guide asks **selling-tool service companies** to share the **current number
  of Gmarket/Auction sellers** using their service.
- For a **new company**, that number may be **zero** — yet provider approval is
  what would *let* sellers onboard, creating a chicken-and-egg risk.
- This does **not** necessarily make approval impossible, but it is a **real
  risk** to plan around, not assume away.
- **Recommended response:** prepare a clear **pilot / design-partner narrative**
  (the model-A work as evidence of a working, consented integration) and **ask
  ESM support explicitly** whether new providers can apply before having many
  sellers.
- **Other-channel sales** (NAVER, etc.) may help establish general business
  credibility, but they do **not** substitute for the core requirement:
  **ESM / Gmarket / Auction authorization and provider eligibility** specifically.

## 5. Review strategy — dual track

> **Decision (current).** The ESM+ **API path is blocked** — we do not have
> approved ESM Trading API credentials / Secret Key / API permission, and
> seller-center login alone is not enough for the API. Accordingly: ESM+
> **INQUIRY / ORDER / CLAIM** stay on the deferred **API-first** track, and ESM+
> **REVIEW** moves to the **model-C browser/export fallback** track (this §5),
> because no official review API path is confirmed. ESM+ REVIEW is
> **`NEEDS_DISCOVERY`**; nothing is CONFIRMED. The step-by-step discovery ladder
> (Gates 0–4) and the Gate-1 manual-observation checklist live in
> **`esmplus-review-export-discovery.md`**.

Replaces any vague "review unknown" interpretation with an explicit two-field
stance. Reviews **remain part of the ultimate product goal**; we just do not yet
know the mechanism.

- **`reviewOfficialApi`: `unknown` / unconfirmed.** Reviews are not among the
  guide's confirmed API areas. Do not claim a review API exists until verified
  with ESM (see §7).
- **`reviewCollectionStrategy`: browser / export fallback planned** *if* no
  official API exists. This is the model-C path, scoped to reviews only.
- Any browser/export review collection uses **NAVER-style discipline**:
  - **user consent**;
  - **human login** (the operator authenticates; SellerOps never handles the
    password);
  - **no CAPTCHA / 2FA bypass**;
  - **no automatic account / store selection**;
  - **sanitized signals / logs** (coarse categories and booleans only — no raw
    URLs, tokens, HTML, screenshots, or PII);
  - **no automatic reply posting**.

These two fields are the documented product stance, not a code schema; the
feasibility doc's capability table still records `review = unknown` for the API
dimension.

## 6. Product & security implications

SellerOps' design and its provider-application materials should emphasize:

- **API-first** for **CS / order / claim / settlement** where official APIs exist.
- **Browser / export fallback only** for unsupported data such as **reviews**.
- **CS answers: draft generation + human approval.** Even where a CS-answer API
  exists, SellerOps starts with **drafts a human approves** — **no automatic
  answer posting initially.** Writing back to a seller's channel is a separately
  gated step.
- **Tenant isolation** — per-seller data and state never bleed across tenants.
- **Credential isolation** — each seller's / the provider's credentials are
  scoped and never shared.
- **Secrets not in the repo** — credentials live **runtime-only** (environment /
  secret store), never committed, never logged.
- **Allowed-IP planning** — egress IPs are a setup prerequisite; plan stable,
  registerable IPs per the guide's allowed-IP check.
- **PII / token masking** — drop buyer/recipient PII at normalization; mask any
  identity tokens; sanitized summaries expose categories/booleans only.
- **Audit logs** — every authorized action is auditable back to a seller binding.
- **Rate limiting / backoff** — respect API limits; escalate backoff, don't retry
  blindly.
- **Failure-safe behavior** — non-essential failures degrade gracefully; never
  block on, or silently swallow, an authorization or session error.
- **Account binding & drift guard** — the same connection-onboarding invariants as
  NAVER: bind to a confirmed account, detect drift / account mismatch, require
  re-auth rather than guessing.

## 7. Open questions for ESM support

Draft list to send to ESM support before committing to model B:

1. Can a **new** selling-tool / SaaS company apply with **zero current
   Gmarket/Auction sellers** if it has **pilot / design-partner evidence**?
2. What **minimum operational / security materials** are required for **new
   providers** (e.g. security plan, operations plan, service introduction)?
3. Is a **representative seller pilot under that seller's own ESM Master ID**
   acceptable **before** provider approval?
4. What is the **exact path** for a provider to become **selectable** in **ESM
   Plus 셀링툴 / API 관리**?
5. Do sellers **authorize a provider through the ESM UI**, or must the provider
   **collect seller IDs / Master ID manually** per seller?
6. Are **reviews** available via any **official API or export API**?
7. If no review API exists, are **user-consented exports / browser-assisted
   collection** allowed under ESM policy?
8. Are **CS-answer APIs** permitted for providers, and are there **audit / rate
   limits** on them?
9. What **scopes** are available per API area (product / order-shipping / claim /
   settlement / CS / service / star-delivery)?
10. Are **allowed IPs** registered **per provider, per seller, or both**, and is
    **sandbox / test access** available **before** production approval?

## Out of scope (now)

Live ESM API calls · credentials / seller IDs / Master ID / API key / JWT · JWT
signer · API client / request code · backend · DB · upload · browser automation ·
Cafe24 · RUN_INTEGRATION. NAVER live work is separately **paused** (see
`connection-onboarding.md`).
