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
