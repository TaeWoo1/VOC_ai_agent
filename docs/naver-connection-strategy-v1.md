# NAVER API Connection Strategy v1

**Status:** DRAFT · 2026-07-29 · authored from the live-confirmed constraints of the 2026-07-29 NAVER
Commerce API Center recon (see `docs/action-window-runtime/naver-guided-api-connection-live-recon-runbook.md`).
This doc defines the two connection paths, the target architecture that lets them swap on one connector,
and the migration + capability priority. It intentionally does **not** implement solution auth / JWE / event
hooks — those are named as remaining long-term work only.

Scope of the accompanying change: **frontend `guidedConnection` + docs only.** No backend, migration,
connector, or live NAVER call. #369 / #371 untouched.

---

## 0. Live-confirmed facts this strategy is built on

From the 2026-07-29 seated recon (read-only; existing app preserved — no delete/deactivate/reissue):

1. **One application per store** — `내 스토어 애플리케이션` is capped at one app per store/account.
2. **No app-delete** — the Commerce API Center provides **no delete** for a store application; official CS
   guidance is to **비활성화 (deactivate)** an unused app. (The `삭제` seen on the detail screen is a
   row-level delete for a 호출 IP / API 그룹 entry, not an app delete.)
3. **Recovery = Secret reissue on the existing app**, not delete-and-recreate. A lost Secret is recovered by
   re-viewing (`보기`) or reissuing (`재발급`) it on the same app.
4. **One store-wide Secret** — a store app has a single Client Secret shared by every program that uses it.
   **Reissue rotates it for all consumers at once**; there is no per-consumer key or per-consumer revocation.
5. **Disconnect ≠ deactivation** — leaving SellerOps must remove only SellerOps's stored credential; it must
   never deactivate/delete the store's single, non-deletable, possibly-shared NAVER app.

These invalidate the earlier `삭제 후 재발급` (delete-then-reissue) recovery assumption, which is retired.

---

## 1. Two connection paths

### 1.1 `DIRECT_STORE_APP` — short-term pilot path (current)

The seller owns a Commerce API application (type=SELF) on their store and hands its Client ID + Secret to
SellerOps, which stores them in its vault and calls the Commerce API on the seller's behalf.

- **Mechanics:** integration-manager permission → register the app (app info + API 그룹 + 호출 IP) → issue
  Client ID/Secret → enter into SellerOps → connection test → first ORDER_SUMMARY sync. Auth is OAuth2
  client-credentials with a bcrypt-signed secret (matches the existing `NaverTokenClient`).
- **Constraints (from §0):** one app/store, non-deletable, one store-wide Secret, reissue rotates for all.
- **Recovery:** re-view or **reissue** the Secret on the existing app (warn: rotation breaks all consumers).
- **New-app issuance:** only on a store that **verifiably has no app** — a store that already holds one is
  routed to reuse (it cannot create a second, and cannot delete the first).
- **Disconnect:** remove the SellerOps vault credential only — never touch the NAVER app.
- **Honest limitation:** the seller shares a store-wide key with SellerOps; there is no per-tool revocation
  short of a store-wide Secret rotation. Acceptable for a pilot; not the end state.

### 1.2 `SOLUTION_SUBSCRIPTION` — long-term official path (target)

SellerOps registers as a NAVER commerce **solution provider**; each seller **authorizes** SellerOps's
solution application (커머스ID / 솔루션 연동) instead of creating or handing over their own app + Secret.

- **Why it's the end state:** per-seller, **scoped and revocable** authorization; the seller never shares a
  store-wide Secret; SellerOps upgrades/rotates its own solution credentials without touching sellers.
- **Entry points observed in the API Center:** `솔루션` / `내 솔루션` / `개발사 입점정보`.
- **Not implemented here:** the solution auth grant, JWE handling, and event/webhook hooks are **future
  work** (see §5). This doc only names them.

---

## 2. Target architecture — one connector, swappable auth

Both paths must sit behind the **same connector and the same canonical data model**, so the auth mode is a
swappable strategy, not a fork of the pipeline:

```
guided FE (auth-mode agnostic)
        │  authMode ∈ { DIRECT_STORE_APP, SOLUTION_SUBSCRIPTION }
        ▼
NAVER connector  ──► auth strategy (client-credentials  |  solution grant)   ← ONLY this differs per mode
        │
        ▼
canonical data model  (CanonicalOrder / channel_orders / order_daily_summaries / review + inquiry events)
```

- **Canonical model unchanged across modes.** ORDER_SUMMARY / per-order / review / inquiry normalization,
  sanitization, recency, and idempotent upsert are identical regardless of how the connector authenticated.
- **Auth is the only seam.** The connector exposes a token/authorization provider; `DIRECT_STORE_APP`
  supplies it from the vaulted store Secret, `SOLUTION_SUBSCRIPTION` from the seller's solution grant.
- **The guided FE stays auth-mode agnostic** — it drives discovery/reuse/recovery + connection test + first
  sync the same way; only the credential-acquisition step differs by mode. (v1 FE implements
  `DIRECT_STORE_APP` only; `SOLUTION_SUBSCRIPTION` slots in without reshaping the journey.)

---

## 3. `DIRECT_STORE_APP` → `SOLUTION_SUBSCRIPTION` migration

When the solution path is live, migrate a seller without breaking their connection:

1. SellerOps completes 개발사 입점 + solution-app review; the solution auth flow ships behind a flag.
2. For a seller on `DIRECT_STORE_APP`, present the solution-authorization step (seller grants SellerOps's
   solution app; no new store app, no Secret handover).
3. On a successful solution grant + connection test on the **same** canonical pipeline, switch the seller's
   stored `authMode` to `SOLUTION_SUBSCRIPTION`.
4. Remove the vaulted store Secret from SellerOps (SellerOps-side only) — the seller's store app is left
   intact and untouched (it cannot be deleted, and may serve other tools).
5. The seller may **reissue** the store Secret at their discretion afterward to cut off any lingering direct
   consumers — SellerOps no longer depends on it, so its own connection is unaffected.

No canonical-data migration is needed — the data model is identical across modes (§2).

---

## 4. NAVER API capability priority

Ordered by value and risk (read before write; never widen scope speculatively):

1. **주문 read (ORDER_SUMMARY / per-order)** — the pilot's proven core; lowest risk, highest value.
2. **문의 read + 답변 write (inquiry reply)** — read first, then supervised reply submission via the
   existing Action Window / guided-reply human checkpoint.
3. **정산 read** — settlement/statement read only (financial data; higher review bar in the solution path).
4. **제한적 order write** — narrowly-scoped order actions (e.g. status handling) only after 1–3 are stable
   and only through an explicit human checkpoint; never bulk/auto.

---

## 5. Principles & remaining long-term work

- **Official solution scope is API-only.** In `SOLUTION_SUBSCRIPTION`, only the **API-scoped** surface is put
  up for NAVER's review — no browser automation / DOM-click behavior is part of the solution submission. The
  Action Window / guided-browser mechanisms stay a pilot/manual-assist concern, out of the solution's
  reviewed surface.
- **Fail closed on scope.** Capabilities are added in the §4 order; an unproven capability stays
  `INTEGRATION_PENDING`, never guessed into the UI.

**Remaining long-term implementation (NOT in this slice):**
- Solution-provider 입점 + solution-app review (business/legal, terms/privacy, 정산 bar).
- Solution auth grant flow (per-seller scoped, revocable) + JWE handling.
- Event / webhook hooks for push delivery.
- Backend `authMode` field + connector auth-strategy seam + migration wiring.
- FE `SOLUTION_SUBSCRIPTION` credential-acquisition step (slots into the existing journey).
