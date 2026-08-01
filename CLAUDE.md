# CLAUDE.md

Instructions for working in the active SellerOps repo.

## Product identity

**SellerOps is a multi-channel commerce operations AI agent for SME sellers/manufacturers.**
It carries operational work between human decisions — normalizing reviews, inquiries, orders, and
reports across the seller's channels. It is **not** a scraper dump, a browser click-bot, or a
VOC/cardnews project.

Canonical product / strategy / state reference: `docs/sellerops_canonical_reference.md` (re-derive
state before citing at any later commit).

## Where development happens

- Normal work: **`sellerops/repo`** (this repo).
- Isolated feature work: **`sellerops/worktrees/<feature-name>/`** (created from this repo).
- **Never develop in `sellerops/runtime-holders/`.**

## Runtime holders

`sellerops/runtime-holders/` contains preserved runtime worktrees linked to the shared `aiagent/.git`
host. They hold live browser profiles, `.env` files, connections, and run state that exist in exactly
one place on disk and are **not** recoverable from git.

- Do not `git clean` there.
- Do not delete ignored files there.
- Do not move a holder with plain `mv` — use `git worktree move`, and only when explicitly approved.
- Do not read, print, or copy `.env` or connection secrets.

## Active source ownership

- `backend/` — Spring Boot service (Java, Gradle, Postgres/Flyway, JWT).
- `frontend/` — React/Vite operations UI.
- `collector/` — TypeScript local agent: channel acquisition + Action Window (NAVER, ESM, Cafe24).
- `contracts/` — shared contracts (Action Window, review fingerprint).
- `tools/` — dev/support tooling.
- `docs/` — current SellerOps docs; `docs/archive/` holds historical material.

## Safety fences

- **No CAPTCHA / 2FA bypass**, no auth bypass.
- **No hidden or chained platform clicks** — manual progress always remains available.
- **No automatic export / download / submit** as product behavior — only through an explicit,
  approved **human checkpoint**.
- **Official APIs first; the Action Window** pattern for user-confirmed platform actions: the seller
  clicks export/consent/download/submit on the marketplace; SellerOps only detects, validates, and
  processes the result.
- **Fail closed** on ambiguous, missing, or changed platform targets.
- **Sanitized output only** — never expose credentials, tokens, cookies, seller IDs, API keys, JWTs,
  raw page content, screenshots, exported files, or personal data. Internal timing (`eventTimeMs`)
  never surfaces; only `recencyBucket` may.

## Branch / PR rules

- Work from **feature branches** (never commit product changes directly to `main`).
- **No force-push** unless explicitly approved.
- **No live marketplace runs** without a fresh, single-use, in-turn approval. A plan, a prior
  approval, or a restored environment is never authorization. **Canonical contract:
  `docs/sellerops_live_approval_contract.md`** — the single source for the Standing Safety Contract,
  the Approval Manifest, and the approval lifecycle. Do not restate the rule elsewhere; link there.
  - **Default = one line.** When `bootstrap`/`preflight` has prepared and displayed a valid
    **Approval Manifest** (channel / account / surface / operation / mode / allowed actions on the
    record), the operator's entire single-use grant is the one line **"Seated and ready."**, bound
    to that manifest's `approvalId` + `runId` + scope. Ask for more only in the exceptions the
    canonical contract §3 lists (no manifest; account/operator/date unfixed; scope changed; process
    restarted; or a **WRITE/submission**, which always needs its own explicit mode-`WRITE` approval).
  - **Same-session, same-scope retries need no re-approval** (the live debug-loop). A change of
    channel / account / scope, a new session, or any code/branch/run/environment change ⇒ the
    approval is `REVOKED`; re-bootstrap for a new `approvalId` and a fresh grant.
- Never print secrets. Stage exact files — never `git add .`; never stage `.env`, `.profile/`,
  `.status/`, `.connections/`, `downloads/`, credentials, or real seller data.

## Product / frontend reading order

Read the canonical documents before product/frontend work:

0. `docs/product_operating_model.md` — anti-drift orientation: what SellerOps is, who for, the open
   channel set, acquisition posture, user journey. Orientation only; points, owns nothing.
1. `docs/sellerops_canonical_reference.md` — product identity, strategy, honest state, authority.
2. `docs/product-scope-v1.md` — product scope contract (**scope lock v1.6**).
3. `docs/sellerops_frontend_spec.md` — frontend source of truth.
4. `docs/multi-channel-connector-roadmap.md` — connector strategy; §4.1 = living capability table.
5. `docs/sellerops_local_agent_runtime_adr.md` — local-agent runtime & guided-connection boundaries.

Channel lessons (derived from §4.1, non-authoritative): `docs/channel_capability_ledger.md`.

**Status lives in workstream homes, not here:** Action Window / R4 → `docs/action-window-runtime/`
(`HANDOFF.md`); Action Window frontend → `docs/workstreams/action-window-frontend/` (`progress.md`);
ESM live capture → `docs/esm/` (`live-capture-checklist.md`); review operations MVP →
`docs/workstreams/review_operations_mvp.md`. A router carries paths, not state.

### Conflict priority

1. explicit product-owner decisions from the current task
2. `docs/product-scope-v1.md`
3. `docs/sellerops_frontend_spec.md`
4. `docs/sellerops_local_agent_runtime_adr.md`
5. `docs/multi-channel-connector-roadmap.md` §4.1 (living capability table)
6. the active slice document (`docs/slices/*`)
7. current implementation evidence
8. historical roadmap and phase records

Implementation evidence may reveal docs are stale, but must not silently redefine product intent —
**report the conflict** instead. For Action Window *status*, `docs/action-window-runtime/` wins.

### Assumption rule

Do not invent product, UX, channel-support, API, or security decisions. Verify repository facts
before relying on them. Surface product-owner decisions rather than resolving them. Classify every
unresolved point as: repository-verifiable, external-research required, or product-owner decision.
When uncertain, stop and report rather than guess.
