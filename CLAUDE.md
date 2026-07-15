# CLAUDE.md

SellerOps collector project instructions.

## Working directory

Use this repository only:

`/Users/taewookang/Downloads/workspace/aiagent-sellerops`

Do not work from or modify:

`/Users/taewookang/Downloads/workspace/aiagent-review-ops-industrial`

If the shell cwd resets outside `aiagent-sellerops`, explicitly `cd` back before running commands.

## Default workflow

Work in small PR-sized slices.

Before changing code:

1. Inspect current branch and status.
2. Confirm the intended scope.
3. Avoid broad rewrites.

Before committing:

1. Run `git diff --check`.
2. Run collector verification:

   * `cd collector`
   * `npm run typecheck`
   * `npm test`
3. Confirm `package.json` and `package-lock.json` are unchanged unless the task explicitly requires dependency/script changes.
4. Stage only the intended files.
5. Do not use `git add .`.

After opening a PR, report:

1. commit hash
2. PR URL
3. changed files
4. verification results
5. package/package-lock status
6. safety confirmations
7. recommended next step, but do not execute it

## Safety boundaries

Do not run live NAVER, live ESM, browser, Playwright, backend, DB, upload, or RUN_INTEGRATION unless explicitly approved for that exact step.

Do not use credentials, seller IDs, Master ID, API keys, JWTs, real seller data, raw HTML, screenshots, exported files, or AI API calls unless explicitly approved.

Never stage or delete:

* `.env`
* `.profile/`
* `.status/`
* `.connections/`
* `downloads/`
* screenshots
* raw HTML
* exported marketplace files
* real NAVER/ESM/review data
* credentials

No force-push.

## Recency chain status

Current completed chain:

normalizers → SellerOpsEvent → sanitized summaries → attention signals → digest → priority score → ranking → attention view.

Review recency is implemented through:

`writtenAt` → internal `eventTimeMs` → sanitized review `recencyBucket`

Rules:

* `eventTimeMs` is internal only.
* Sanitized outputs may expose `recencyBucket`, never `eventTimeMs`.
* Do not expose raw timestamps or elapsed durations.
* Do not use `Date.parse`, `Date.now`, `new Date`, `Date.UTC`, or generatedAt.
* Use explicit `referenceTimeMs` only.
* Timezone-less strings must remain unknown.
* Do not assume KST unless a platform-specific policy explicitly allows it.

Still deferred:

* recency for `cs_inquiry`
* recency for `claim`
* recency for `order_shipping`
* `sales_context` recency stays unknown by design
* recency factor in priority scoring
* attentionView recency passthrough
* live NAVER
* live ESM/API/credentialed work

## Style

Prefer concise plans and short prompts.

Do not repeat the full safety runbook in every response. Refer to “standing safety rules” unless the task is live, credentialed, destructive, or unusually risky.

When uncertain, stop and report the uncertainty instead of guessing.

## SellerOps product & frontend

### Required reading order

Read the canonical documents before product/frontend work, in this order:

1. `docs/product-scope-v1.md` — product scope contract (v1.1)
2. `docs/sellerops_frontend_spec.md` — frontend redesign source of truth
3. `docs/multi-channel-connector-roadmap.md` — connector strategy + §4.1 living capability table
4. `docs/sellerops_local_agent_runtime_adr.md` — local-agent runtime & guided-connection boundaries
5. relevant live-verification records (`docs/sellerops_phase3c_live_smoke.md`, `docs/sellerops_cafe24_live_verification.md`)
6. `docs/sellerops_current_state.md` — living handoff state
7. the currently active document under `docs/slices/`

Past phase/roadmap docs are historical evidence, not current status, unless a canonical doc explicitly delegates to them.

### Action Window / R4 NAVER Runtime

For anything touching the Action Window runtime, start at
`docs/action-window-runtime/HANDOFF.md` — the orientation entry point for that workstream (state,
live-run history, gates, committed vs. local-only). The `r4-runtime-handoff` skill routes there.

**Known conflict (2026-07-15, unresolved by design):** `docs/sellerops_current_state.md` (§6 above)
predates the R4 live runs and still describes the Action Window as `계약만(미구현)` / `구현 없음`.
That is stale — Run 4 proved the NAVER export path end-to-end on the real surface on 2026-07-15
(`docs/action-window-runtime/r4-evidence-pack.md` §8-17). **For Action Window *status*, the
`docs/action-window-runtime/` records win.** Product *intent* still follows the conflict priority
below. Correcting `sellerops_current_state.md` is a product-owner decision, deliberately not taken
here — report the conflict, do not silently resolve it.

### Conflict priority

When sources conflict, this order wins:

1. explicit product-owner decisions from the current task
2. `docs/product-scope-v1.md`
3. `docs/sellerops_frontend_spec.md`
4. `docs/sellerops_local_agent_runtime_adr.md`
5. the living capability table in `docs/multi-channel-connector-roadmap.md` (§4.1)
6. the active slice document (`docs/slices/*`)
7. current implementation evidence
8. historical roadmap and phase records

Implementation evidence may reveal that documentation is stale, but it must not silently redefine product intent — **report the conflict** instead.

### Assumption rule

- Do not invent product, UX, channel-support, API, or security decisions.
- Verify repository facts before relying on them.
- Mark external-research questions explicitly.
- Surface product-owner decisions rather than resolving them yourself.
- Never encode unresolved assumptions into code or canonical documentation.
- Classify every unresolved point as: (1) repository-verifiable, (2) external-research required, or (3) product-owner decision required.

### Work discipline

- Work in meaningful feature slices; do not open small incremental commits.
- Do not create commits, branches, or PRs without explicit approval.
- Keep implemented / live-verified / documented / future capability clearly separated.
- Never expose credentials, tokens, cookies, account identifiers, raw page content, or personal data in logs or reports.
