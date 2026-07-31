# tools/cafe24-reply-spike

Operator runbook for the **Cafe24 Board-6 Reply API Capability Spike** — a one-shot,
triple-gated probe of whether the official comments API can post a reply to a single
controlled board-6 test inquiry and flip its `reply_status`.

> This directory is **documentation only**. The spike logic lives in the backend
> package `com.sellerops.connector.cafe24.spike` and is inert unless the flags below
> are deliberately set. There is **no** committed script that fires a live write, and
> nothing here runs a Cafe24 call by itself. See
> `docs/sellerops_cafe24_board6_reply_api_spike_audit.md` for the full contract audit.

## What it does / does not do

- **Does:** one comment POST to ONE operator-owned board-6 test article, then verifies
  exactly one comment was created and observes `reply_status` (before/after).
- **Never:** touches the production onboarding scope or credential; adds
  `mall.write_community` to the production app; posts to a real customer inquiry;
  calls PUT/DELETE, auto-reply, or order/product/review; prints a token, mall id,
  comment body, writer value, or password.

## Gates (all must be set for a live write)

1. `sellerops.connector.cafe24.enabled=true` — the connector flag.
2. `sellerops.connector.cafe24.spike.reply.enabled=true` — the spike configuration.
3. `sellerops.connector.cafe24.spike.reply.execute-write=true` — the write switch
   (default **false** → read-only readiness probe + dry-run plan only).
4. `sellerops.connector.cafe24.spike.reply.approval=<single-use value>` — the explicit
   single-use approval; must be non-blank for any POST, and is consumed after one use.

Additional properties:

| Property (`sellerops.connector.cafe24.spike.reply.*`) | Meaning |
|---|---|
| `account-id` | the **disposable spike** seller account UUID (never a production account) |
| `article-no` | the operator-owned board-6 **test** article number |
| `command-id` | idempotency key for the attempt |
| `content-source` | `FIXED` (default harmless phrase) or `OPERATOR` |
| `operator-content` | operator override text (only read when `content-source=OPERATOR`; rejected fail-closed on e-mail / long digit run / empty) |

Board is fixed to 6 in code; a non-6 target is refused.

## One-time operator prerequisites (a future, gated step — not part of the prep unit)

1. **Developer Console:** add `mall.read_community` + `mall.write_community` to a
   **spike/disposable** app registration only (never the production onboarding app);
   keep the redirect URI byte-identical across the console, the authorize URL, and the
   token exchange.
2. **Spike OAuth consent:** grant both scopes against the **disposable** spike account;
   store the resulting spike credential in the **disposable** DB. The spike verifies
   the granted scope from the token response and fails closed if `mall.write_community`
   was not actually granted.
3. **Test inquiry:** create exactly one operator-owned board-6 inquiry with
   `reply_status = N` and **no** personal data / order number / contact in its text.

Secrets are sourced from the macOS Keychain exactly as for `tools/cafe24-local`
(`sellerops-vault-master-key`, `sellerops-cafe24-oauth`, `sellerops-cafe24-db`) and are
never committed here.

## Fresh single-use approval required immediately before the POST

A live comment POST needs a fresh, in-turn approval naming **channel = Cafe24**,
**account = the disposable spike account**, **store**, **date = today**, **operator
seated**, and explicit authorization to perform **exactly one** comment POST to the
named board-6 test article (read-only probes + that single write). A plan or a prior
approval is never authorization.

## Reading the output (sanitized)

The runner logs only: the dry-run `PLAN`, `write_scope_granted=<bool>`, the read-only
probe (`pre_status_token`, `comment_count`), and — on a gated write — `OUTCOME`,
`VERDICT` (A/B/C or NONE), booleans, counts, and `N/P/C/OTHER` status tokens. Verdict
**A** = comment created + status `C`; **B** = created but status unchanged (HALT, no
PUT); **C** = rejected / no write scope (Guided Handoff remains the primary path).

## Fail-closed on a mid-POST error (retry needs a fresh approval)

If the network fails *during or after* the single POST, the spike HALTs and does not
retry — the comment may already have landed. The approval is consumed and the result
is remembered, so the same `command-id` returns the cached HALT and a new `command-id`
is refused for reusing a consumed approval. To attempt again, first check the article's
comments/`reply_status` directly, then obtain a **fresh single-use approval** for a new
attempt (with a distinct `command-id`).
