# D4-4b.2 — Email provider feasibility spike

_Planning doc only. No provider code. No real send. Snapshot: `main @ 58d9ec2`._

Decides **how** a future real email provider seam (D4-4b.2) should be approached,
so that when it is authorized it slots behind the existing send gate with zero
change to the gate's safety guarantees. **This document implements nothing.**

---

## 1. Current send lane state

The send lane is complete as a **fake/staging** path (D4-4a preview, D4-4b fake
final-send). Grounded in `ops/discord_outreach_bot/action_dispatch.py`:

- **Preview** — `propose_send_preview(...)` runs the precondition gate, arms a
  single-use pending (`kind="send"`), and writes an inert `send_preview.json` to
  a staging dir. Nothing is sent.
- **Fake final-send** — `confirm_send_final(operator_id, *, authorize_send=...)`
  re-verifies, gates, then calls the provider seam `_send_fn`.
- **Provider seam** — one module-level binding: `_send_fn = _fake_send`.
  `_fake_send` returns `{"result":"sent","provider":"fake", ...}` with a
  deterministic id from `content_hash`. No network, SMTP, or API.
- **Two-key gate** — `_SEND_ENV_FLAG = "AGENT_SEND_ENABLED"` (infra key) **and**
  `authorize_send=True` set only by the phrase `최종 발송 승인` (per-turn key).
- **artifact_hash** — `_send_artifact_hash(preview)` recomputed at confirm vs the
  staged preview; mismatch blocks and clears pending.
- **Idempotency** — `_already_sent(packet_dir, content_hash)` reads `send_log.md`
  (`_SEND_LOG_FILENAME`); `_append_send_log(...)` appends one `result=sent` line
  **only on success**. Failures write nothing (retry-safe).
- **Exceptions** — `SendNotAuthorized` and `ProviderUnavailable` are caught in
  `confirm_send_final` and mapped to fail-closed cards.
- **No real email provider exists.** There is no SMTP, no Gmail, no OAuth, no
  token, no account anywhere in the repo.

The seam is therefore already shaped for a provider swap: a real adapter is just
a different `_send_fn` that honors the same input/return contract and raises the
same two exception types.

---

## 2. Candidate provider options

| # | Option | What it does |
|---|---|---|
| A | **Gmail API — draft only** | `users.drafts.create` — writes a draft into a Gmail mailbox; **never** calls `send`. Operator reviews/sends in Gmail UI. |
| B | **Gmail API — send** | `users.messages.send` (or `drafts.send`) — actually delivers the email. |
| C | **SMTP** | Direct SMTP submission (e.g. `smtp.gmail.com` app password, or any relay). Sends immediately. |
| D | **Local `mailto:` / manual handoff** | Bot emits a `mailto:` link or a copy-ready block; the human sends entirely by hand. No API at all. |

---

## 3. Option comparison

| Criterion | A. Gmail draft | B. Gmail send | C. SMTP | D. mailto/manual |
|---|---|---|---|---|
| Setup complexity | Medium (OAuth app, `gmail.compose` scope) | Medium–High (same + send scope) | Low–Medium (host/port/cred or app password) | Trivial |
| OAuth/token/secrets | OAuth token, refresh token; narrow `compose` scope; secret storage needed | OAuth token; **broad `send`/`gmail.modify` scope**; secret storage | App password / SMTP creds stored as secret | **None** |
| Risk of accidental send | **Very low** — API has no delivery effect; draft sits until a human clicks send | **High** — one call delivers; a planner/logic slip = real outbound | **High** — same as B, plus less observable | **None** — human is the only sender |
| Testability | Good — mock the Drafts client; assert a draft body, never a send call | Good to mock, but the real path is irreversible | Mockable, but SMTP integration tests are flaky/side-effecty | Trivial — pure string output |
| Audit / idempotency fit | Excellent — `content_hash` → draft id maps cleanly into `send_log.md`; `result=drafted` | Good — `result=sent` + message id; but "sent" is irreversible | Workable — message id less reliable; harder to dedupe | Weak — no machine record of what the human did |
| Founder-outreach fit | **Strong** — keeps human-in-the-loop voice/edits on every message, which matches early hand-crafted outreach | Strong for volume, premature for v1 hand outreach | Weak — bypasses the Gmail review surface founders actually use | Strong for tiny volume, but no audit trail / no scale path |

Notes:
- The gate's value (preview → phrase → idempotent ledger) is fully preserved by
  **A** and largely by **B/C**; **D** moves the action outside the gate entirely
  (the bot never "acts"), so its audit/idempotency story is weakest.
- **B and C share the same irreversible-delivery risk class** as today's
  "still impossible" line; both are out of scope until much later.

---

## 4. Recommended first real-provider slice

**Gmail API, draft-only (Option A).** It is the smallest slice that produces a
*real* artifact in the operator's actual mail surface while keeping delivery
strictly human-gated:

- No message can leave without a human clicking **Send** in Gmail — so the
  worst-case failure of the bot/gate is "an unwanted **draft**," not an unwanted
  email.
- It maps onto the existing seam with no gate change: `_send_fn` → a
  `gmail_draft` adapter returning `{"result":"drafted","provider":"gmail_draft",
  "draft_id": ...}`; `send_log.md` records `result=drafted` + `content_hash`.
- It uses the **narrow** `gmail.compose` scope (create drafts), never a send
  scope — minimizing token blast radius.
- It exercises the genuinely hard parts (OAuth, token storage, MIME assembly,
  attachments, rate limits) **without** the irreversible-send risk, so those can
  be de-risked before any send slice is even considered.

Direct send (B/C) is deferred and gated behind its own much-later milestone.

---

## 5. Required gates to preserve (non-negotiable)

A real adapter must change **only** `_send_fn` and its construction; every gate
below stays byte-for-byte as today:

- `진행해` (and any planner/NL confirm) **never** sends or drafts — only the
  phrase `최종 발송 승인` sets `authorize_send=True`.
- `AGENT_SEND_ENABLED` (infra key) is still required; the two-key gate
  (`_send_authorized() and authorize_send`) is unchanged. A real-provider build
  should additionally sit behind its **own** capability flag (see §6) so enabling
  the fake flag never reaches a real mailbox.
- `_send_artifact_hash` re-check at confirm; mismatch → block + clear pending.
- `_already_sent` idempotency via `send_log.md`; a re-confirm of identical
  content → `already_sent`, no duplicate draft/send.
- Provider failure path: `SendNotAuthorized` / `ProviderUnavailable` / generic
  failure must write **no** `send_log.md` line (retry-safe, fail-closed).
- `status.json` is never mutated; the only packet mutation remains the
  success-line append to `send_log.md`.

---

## 6. Proposed implementation split

- **D4-4b.2a — provider interface + adapters behind env (no live calls).**
  Formalize the `_send_fn` contract as a small `EmailProvider` protocol
  (`send(preview) -> result dict`, raises `SendNotAuthorized`/`ProviderUnavailable`).
  Ship two adapters: the existing `_fake_send` (default, unchanged) and a
  `gmail_draft` adapter that is **import-safe but inert** unless its own
  capability flag (e.g. `AGENT_EMAIL_PROVIDER=gmail_draft`) is set. No OAuth
  performed at import. Default behavior identical to today.
- **D4-4b.2b — gated live draft smoke.** Behind both `AGENT_SEND_ENABLED` and the
  provider flag, plus explicit per-turn authorization, create **one real draft**
  in a designated test mailbox using a constructed packet under `outputs/`.
  Verify draft created, `result=drafted` + `content_hash` in `send_log.md`,
  duplicate → `already_sent`, no message actually sent.
- **D4-4b.2c — optional real send (much later, separate authorization).** Only if
  explicitly approved; carries its own irreversibility review, its own flag, and
  a stricter confirmation. Not in the draft-only track.

---

## 7. Test plan

- **Fake provider unchanged** — all existing send tests pass untouched;
  `_send_fn` default is still `_fake_send`; no test reaches a network.
- **Gmail adapter mocked** — unit tests inject a fake Drafts client; assert the
  adapter builds the right MIME, calls `drafts.create` (never `send`), and maps
  the response to `result=drafted`. Assert `ProviderUnavailable` on client error
  and that **no** `send_log.md` line is written on failure.
- **No token in repo** — a test/asserted invariant that no credential, token, or
  client-secret file is committed; provider reads secrets only from env / an
  ignored path; CI has no live credentials.
- **Live smoke gated** — the live-draft smoke runs only when the env flags AND
  explicit per-turn operator authorization are present; it is never part of the
  default `pytest` run; artifacts confined to `outputs/`.
- **Gate regression** — re-assert §5 invariants with the real adapter selected
  but env off: `최종 발송 승인` + provider-flag-off → `send_not_authorized`,
  pending preserved, no draft.

---

## 8. Open questions (must be answered before D4-4b.2a)

- **Which Gmail account** is the sender / draft owner? Founder's real mailbox vs
  a dedicated outreach mailbox?
- **Draft-only vs send** — confirm draft-only is the v1 commitment; when (if ever)
  is send revisited?
- **OAuth app & credential storage** — who owns the Google Cloud OAuth client?
  Where do the refresh token and client secret live (keychain / env / ignored
  file)? Token rotation/expiry handling?
- **Attachment handling** — does outreach include attachments (PDF report,
  cardnews)? MIME assembly, size limits, and whether attachments are part of the
  `content_hash`.
- **Rate limits** — Gmail API per-user quota; expected outreach volume; backoff
  policy (and whether a draft-quota error maps to `ProviderUnavailable`).
- **Audit logs** — is `send_log.md` (`result=drafted` + draft id + `content_hash`)
  sufficient, or is a separate Gmail-side audit reference needed?

---

## 9. Recommendation

- **Do not implement real send yet.** Real delivery (Gmail send / SMTP) stays in
  the "still impossible" tier until a separate, explicitly authorized milestone.
- **Start with draft-only feasibility (Option A).** First slice = D4-4b.2a
  (provider interface + inert `gmail_draft` adapter behind its own flag), with the
  existing fake path as the unchanged default. Resolve the §8 open questions
  before writing D4-4b.2a; run a live draft smoke (D4-4b.2b) only when gated and
  explicitly authorized.
- All §5 gates are preserved verbatim; the only eventual code change is the
  `_send_fn` binding plus a new capability flag — no change to the phrase gate,
  the artifact-hash check, or the idempotency ledger.
