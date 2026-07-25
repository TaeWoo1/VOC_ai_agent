# CI coverage — what is verified automatically, and what deliberately is not

Three workflows, split by what can break independently. Each is hermetic: no database service, no Docker,
no browser, **no secrets**, so every one of them runs identically on a fork PR.

| workflow | triggers on | verifies |
|---|---|---|
| `backend-ci.yml` | `backend/**` | Spring Boot suite (H2, Flyway disabled) |
| `frontend-ci.yml` | `frontend/**`, `contracts/**` | full frontend typecheck + suite + production build |
| `collector-ci.yml` | `collector/**`, `contracts/**`, frontend contract/bridge clients | the FE ↔ Local Agent **boundary** |

## Why `collector-ci.yml` exists separately

The high-risk surface is the seam between three separate typecheck/npm worlds — the shared Action Window
contracts, the collector runtime that speaks them, and the frontend clients that consume them. They can only
break *each other*, and nothing inside any one package's own CI is guaranteed to notice. So this workflow
checks the seam explicitly, in two independently attributable jobs:

**Job `collector` — contracts + collector (hermetic)**

1. **Guard path filter + contract fixtures** (`tools/ci/check-contract-importers.sh`, runs before install) —
   asserts every frontend file importing `contracts/action-window` sits under a filtered path, and that the
   schemas + fixtures the conformance suites read are present. See "the silence problem" below.
2. **Contracts typecheck** — `npx tsc -p ../contracts/tsconfig.json`. The contracts have no package of their
   own and were previously only checked *transitively*, as imports of whichever consumer pulled them in.
   This project also pins them as portable: no DOM lib and no `@types/node`, because both a browser bundle
   and a Node runtime consume them.
3. **Contracts conformance tests** — `npx vitest run test/contracts` (123 assertions over the v1 + v2
   fixtures and the schema ↔ TypeScript consistency checks).
4. **Collector typecheck** — `npm run typecheck`, which is *two* projects: the collector itself, and
   `test/crossstack`, which type-checks **real frontend source** alongside collector source. That second
   project is the boundary check.
5. **Collector hermetic unit + integration tests** — `npm test` (~4850 assertions).

**Job `frontend-contract-client` — frontend contract + bridge clients**

1. **Frontend typecheck** — app-wide, because a contract change breaks the frontend at the *type* level first
   and can surface in any file, not only direct importers.
2. **Contract + bridge client tests** — `src/lib/{actionWindow,bridge,guidedConnection}` and
   `src/components/{actionWindow,bridge}` (~298 assertions): the contract clients, the bridge
   client/transport, the guided-connection session, and the components that render from the contract view
   model. Deliberately **not** the whole frontend suite — `frontend-ci.yml` owns that.

## Deliberately excluded, and why

**No live NAVER, no headed Chrome, no marketplace network, no disposable backend, no approval-gated suite.**

This is not a convenience choice. `collector/CLAUDE.md` §4 makes a live marketplace run require *explicit,
per-run operator approval*, with a human performing login / 2FA / CAPTCHA. A CI job able to start one would
*be* a standing authorization — precisely what that rule forbids — and it would do so on every push.

The mechanism: every browser / live-backend / headed suite is gated on an env var being exactly `"1"`
(`describe.skipIf(!RUN)`, `it.skipIf(!HEADED)`), and the workflow pins both **blank**:

```yaml
env:
  RUN_INTEGRATION: ''
  AW_HEADED: ''
```

Pinned rather than merely unset, so no repository- or environment-level default can quietly arm a live run
inside CI. In a normal run this leaves ~15 files / ~125 assertions skipped, which is expected and correct.

Also excluded: the **disposable-backend harnesses** under `tools/review-import-validation/` and
`tools/reply-state-validation/`. They create and drop real Postgres databases and boot a real backend; they
are operator-run, and their name-guarded teardown assumes a human is watching.

Consequence worth stating plainly: **CI does not validate Flyway migrations.** The backend suite runs H2 with
Flyway disabled, so a broken migration is green here. Migrations are validated by booting a real backend —
which is what the disposable-backend harnesses do.

## The silence problem this workflow is designed around

A path-filtered workflow's failure mode is *silence*: the day someone imports the shared contract from a
frontend file outside the filtered paths, the boundary stops being checked and nothing says so. A green PR
that never ran the check is worse than a red one. Two specific defences:

- `tools/ci/check-contract-importers.sh` fails the build if an importer appears outside the filtered
  prefixes, naming the offending file and the two places to update. Run it locally exactly as CI does:
  `bash tools/ci/check-contract-importers.sh`
- It also enforces a **floor** on fixture counts. The conformance suites are fixture-driven (`it.each` over a
  directory), so an emptied fixture directory would not fail them — it would silently reduce 123 assertions
  to none.

The `paths:` lists for `pull_request` and `push` are duplicated verbatim and must stay in lockstep. They are
**not** factored into a YAML anchor: the GitHub Actions parser does not support anchors/aliases, so an anchor
would be a filter that quietly fails to apply.

`frontend-ci.yml`'s filter was `contracts/action-window/v1/**`, which was a real hole — the frontend also
imports v2 and `aw-carrier-kind.ts`, so a v2 change could break it with no signal. It is now `contracts/**`;
enumerating versions is what went stale the moment v2 landed.

## Versions

Node **20** across all three Node workflows, JDK **17** for the backend (matching the Gradle toolchain), and
`npm ci` against the committed `collector/package-lock.json` / `frontend/package-lock.json`, with
`actions/setup-node` npm caching keyed per lockfile.

One honest gap: the repo declares no Node version — there is no `.nvmrc` and no `engines` field, so `20` is a
per-workflow convention rather than a repository fact, and local development currently runs a newer Node. That
divergence has not caused a problem, but pinning it in-repo would make it impossible for it to.
