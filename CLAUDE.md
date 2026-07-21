# CLAUDE.md

SellerOps collector project instructions.

## Current phase — NAVER SmartStore v1 (anti-drift anchor)

**The active phase is completing NAVER SmartStore v1 end-to-end.** Phase source of
truth: `docs/action-window-runtime/naver-smartstore-v1-plan.md`. Status lives there and
in each workstream home — this block carries rules, not status.

**v1 = one channel, four surfaces, all in scope:** (1) guided API onboarding (orders),
(2) review export (Action Window), (3) session readiness, (4) guided review reply. v1 is
not "complete" until all four meet the plan's §9 criteria. (The guided-connection *slice*
scopes review out of *itself* — that is slice scope, not phase scope; review still ships
in v1 via the Action Window track.)

**v1 runtime shape:** real local Chrome + dedicated NAVER profile + Action Window tutorial
overlay. **Cropped/projection UI is excluded from v1.** API-center work is **guided-tutorial
support only** — never automatic API issuance or linking. The seller manually creates/opens
their own app and copies Client ID/Secret into SellerOps; **SellerOps never reads Client
ID/Secret from the API-center page** (the observe tool reads only a sanitized page category).

**Scope fence.** Coupang and Cafe24 are the **next**-channel targets, **after** NAVER v1.
Do not start them and do not widen v1 into them.

**Git cadence for this phase — overrides the "one slice = one PR" workflow below and in
`collector/CLAUDE.md` §6 until v1 is complete:**

- **No push / PR / merge / rebase / remote sync / branch deletion** until the single final
  v1 integration. No force-push (standing).
- **No new local commits** unless the user explicitly instructs one; when they do, commit a
  meaningful completed unit. **Do not optimize for tiny checkpoints.**
- Work accumulates in the tree / meaningful local commits; the branch stays local.

Live NAVER, credentials, and sanitization follow the standing rules below and in
`collector/CLAUDE.md` §4 (each live run still needs a fresh, single-use, in-turn G6).

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

### Product-boundary check — mandatory before any NAVER live run

Approval to run live is **not** approval to act like the product. Every NAVER live dispatch must
explicitly answer, **before launch**:

1. Is this **product-path behavior** or a **one-off diagnostic exception**?
2. Will the tool **click export, consent, download, submit, upload, or otherwise mutate platform state**?
3. If yes — is that **supported v1 product behavior**?
4. If not — the run must be **labeled a diagnostic exception**, the **human-driven product alternative
   must be stated**, and the user must **explicitly approve that exception in the grant**. A generic
   live grant never covers it.
5. **Default production NAVER review export stays human-driven Action Window:** the user clicks
   export / consent / download **on NAVER**; SellerOps only **detects, validates, and processes the
   resulting download**.
6. **Do not implement, wire, or present automatic export / consent / download as NAVER v1 behavior.**

**B3 Run B (2026-07-20) is not precedent for product behavior** — a single supervised diagnostic
exception to classify one artifact. **No further B3 live download probes.** Detail lives in
`docs/action-window-runtime/naver-smartstore-v1-plan.md` §8; this block carries the rule, not the status.

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
7. the active slice — **named by `docs/sellerops_current_state.md` §10 ("Active slice")**, which resolves
   this step. Do not infer it from a slice file's own `Status:` line; those self-claims go stale and §10
   overrides them.

Past phase/roadmap docs are historical evidence, not current status, unless a canonical doc explicitly delegates to them.

### Workstream routing

State lives in each workstream's own home. **This table carries paths only** — for status, read the home,
never this table.

| Workstream | Home | Entry point |
|---|---|---|
| Action Window / R4 NAVER Runtime | `docs/action-window-runtime/` | `HANDOFF.md` — the `r4-runtime-handoff` skill also routes there |
| Action Window frontend | `docs/workstreams/action-window-frontend/` | `progress.md` (scoped rules: `frontend/CLAUDE.md`) |
| ESM Plus live capture | `docs/esm/` | `live-capture-checklist.md` |
| Everything else | flat `docs/`, `docs/slices/` | no dedicated home — use the reading order above |

**For Action Window *status*, the `docs/action-window-runtime/` records win**, including over
`docs/sellerops_current_state.md`. Product *intent* still follows the conflict priority below.
`HANDOFF.md` also records which docs are stale **by decision** — report those, do not resolve them.

**Router rule.** A router carries paths, not state. If a status change forces an edit to this table, to a
skill, or to a HANDOFF's discovery block, that surface was carrying state that belongs in the workstream
home. Paths rot rarely and break loudly; status rots constantly and silently.

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
