/**
 * **Repository-identity verification for destructive live runs — "the code that runs IS the code the manifest
 * names".**
 *
 * The gap this closes. `validateApprovalPrerequisites` checks that `runId` / `approvalId` / `gitSha` are
 * PRESENT and not `"unknown"` (`UNBOUND_IDENTITY`) — but nothing compared `gitSha` to the actual HEAD or looked
 * at the working tree. So a leftover `.env` from a consumed approval reached PREPARED carrying a SHA that does
 * not describe the running code, which the approval contract treats as `REVOKED`
 * (`docs/sellerops_live_approval_contract.md` §1.6). The read-only WING probe had this protection in
 * `wing-probe-preflight.sh`; the destructive deletion entrypoint had no preflight at all.
 *
 * Why it lives in TypeScript rather than only in the harness script: the shell preflight is something an
 * operator *runs*, and a hand-typed CLI invocation skips it entirely. This module is called by BOTH the
 * manifest DISPLAY CLI and the destructive RUNTIME CLI, so the two cannot disagree and neither can be bypassed
 * by not running a script. The harness keeps its own copy of the same checks for an actionable early message —
 * defense in depth, exactly like the deletion driver re-checking the calibration flag the gate already checked.
 *
 * **Fails closed on every ambiguity.** A git command that errors, a toplevel that is not this repository, an
 * unreadable status — all refuse. None of them is ever read as "clean" or "unchanged"; that fail-OPEN shape is
 * the whole point of the module.
 *
 * **Sanitized output.** Refusals carry a fixed cause enum plus a short reason built from repo-relative paths,
 * short SHAs, and counts. No environment values, no file contents, no absolute paths outside the repo root,
 * no credentials.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

/**
 * Git environment variables that must NOT be inherited. Each one can silently redirect a git command at a
 * different repository or suppress what `status` reports:
 *   - `GIT_DIR` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` / `GIT_INDEX_FILE` / object dirs — point the check at a
 *     clean decoy repository;
 *   - `GIT_CEILING_DIRECTORIES` — stop discovery short of this repo;
 *   - `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` / `GIT_CONFIG_NOSYSTEM` / `GIT_CONFIG_COUNT` (with
 *     `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`) — inject `status.showUntrackedFiles=no`;
 *   - `GIT_CONFIG_PARAMETERS` — inject a `core.excludesFile`, which hides untracked files even against an
 *     explicit `-c status.showUntrackedFiles=normal`.
 *
 * Stripping `GIT_CONFIG_GLOBAL` is NOT sufficient on its own: git then falls back to `$XDG_CONFIG_HOME/git/config`
 * and `$HOME/.gitconfig`, so a hostile `HOME` re-opens exactly the `core.excludesFile` hole. The config files are
 * therefore PINNED to /dev/null by {@link sanitizedGitEnv} rather than merely unset — see {@link PINNED_GIT_ENV}.
 * This mirrors the harness's `git_hardened`, deliberately: the two must not be able to read different trees.
 */
export const STRIPPED_GIT_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
] as const;

/** Result of running one git command. `status !== 0` is ALWAYS a refusal — never a defaulted-to-clean read. */
export interface GitRunResult {
  status: number;
  stdout: string;
}

/** Injectable git runner (tests provide a fake; production uses {@link runGitHardened}). */
export type GitRunner = (args: readonly string[]) => GitRunResult;

/**
 * Config sources PINNED to an empty file rather than unset. Unsetting `GIT_CONFIG_GLOBAL` makes git fall back
 * to `$XDG_CONFIG_HOME/git/config` → `$HOME/.gitconfig`, so an operator shell with a prepared `HOME` could
 * still supply a `core.excludesFile` that hides untracked files from `status --porcelain` — the same bypass
 * `GIT_CONFIG_PARAMETERS` was stripped to close. Pointing both at /dev/null closes it without unsetting `HOME`
 * (which git needs for other things). Repo-local config still applies, and must: it is part of the checkout.
 */
export const PINNED_GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
});

/**
 * Strip every ambient git variable — INCLUDING the numbered `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` pairs,
 * which are not a fixed set and so cannot be listed above. Dropping only `GIT_CONFIG_COUNT` would be enough
 * for git to ignore them today, but removing the whole family keeps the guarantee independent of that detail.
 * Then pin the global/system config files, so unsetting them cannot fall through to `$HOME`.
 */
export function sanitizedGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if ((STRIPPED_GIT_ENV_VARS as readonly string[]).includes(k)) continue;
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, ...PINNED_GIT_ENV };
}

/** The production runner: git in `repoRoot`, ambient git env stripped, untracked reporting forced on. */
export function runGitHardened(repoRoot: string): GitRunner {
  return (args) => {
    const res = spawnSync("git", ["-C", repoRoot, "-c", "status.showUntrackedFiles=normal", ...args], {
      encoding: "utf8",
      env: sanitizedGitEnv(process.env),
    });
    // A spawn error (git missing, ENOENT) surfaces as a null status — normalize to a non-zero refusal rather
    // than letting `status ?? 0` read as success.
    return { status: res.status ?? 1, stdout: typeof res.stdout === "string" ? res.stdout : "" };
  };
}

/** Why the repository identity was refused. Each maps to a sanitized `repo_identity (<cause>)` refusal. */
export const REPO_IDENTITY_CAUSES = [
  /** A git command failed, or a path could not be resolved — refused rather than assumed clean/unchanged. */
  "GIT_UNREADABLE",
  /** The git toplevel is not this repository (a redirected or nested checkout). */
  "WRONG_REPOSITORY",
  /** HEAD is not the commit the bootstrapped identity pinned — the manifest's gitSHA would over-claim. */
  "HEAD_DRIFT",
  /** Uncommitted or untracked changes — the running code is not the commit the manifest names. */
  "DIRTY_TREE",
] as const;
export type RepoIdentityCause = (typeof REPO_IDENTITY_CAUSES)[number];

export type RepoIdentityResult =
  | { ok: true; head: string }
  | { ok: false; cause: RepoIdentityCause; reason: string };

export interface VerifyRepoIdentityInput {
  /** The short SHA the bootstrap pinned (the manifest's `gitSha`). */
  expectedSha: string;
  /** The repository this run must be reading. Compared by realpath against git's own toplevel. */
  repoRoot: string;
  /** Injected for tests; defaults to the hardened production runner. */
  runGit?: GitRunner;
  /** Injected for tests; defaults to `fs.realpathSync`. */
  realpath?: (p: string) => string;
}

/** A short SHA as bootstrap writes it (7–40 hex). Anything else is not a pinned commit. */
const SHORT_SHA = /^[0-9a-f]{7,40}$/;

/**
 * Verify that the working tree is clean and HEAD is EXACTLY the commit the identity pinned, in EXACTLY this
 * repository. Every failure mode refuses; nothing defaults to a pass.
 *
 * Order is deliberate and stable, so the reported cause is the most fundamental one: which repository → what
 * HEAD is → whether HEAD matches → whether the tree is clean. A redirected repository must not be reported as
 * "HEAD drift", which would send the operator to re-bootstrap and paper over the redirect.
 */
export function verifyRepoIdentity(input: VerifyRepoIdentityInput): RepoIdentityResult {
  const runGit = input.runGit ?? runGitHardened(input.repoRoot);
  const realpath = input.realpath ?? ((p: string) => realpathSync(p));

  if (!SHORT_SHA.test(input.expectedSha)) {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "the bootstrapped git SHA is missing or malformed" };
  }

  // 1) This must be the repository the run claims. Compared by REALPATH so a symlinked path cannot present
  //    itself as a different tree than the one git is actually reading.
  const top = runGit(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "git could not resolve the repository toplevel" };
  }
  let topReal: string;
  let rootReal: string;
  try {
    topReal = realpath(top.stdout.trim());
    rootReal = realpath(input.repoRoot);
  } catch {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "could not resolve the repository path" };
  }
  if (!topReal || !rootReal || topReal !== rootReal) {
    // The paths are the operator's own repo root — not a secret — but the refusal stays coarse on purpose.
    return { ok: false, cause: "WRONG_REPOSITORY", reason: "git is not reading the expected repository" };
  }

  // 2) HEAD must be the pinned commit. `--short` is compared against the bootstrap's short SHA; git prints
  //    the same abbreviation length for the same repository, and a mismatch is a refusal either way.
  const head = runGit(["rev-parse", "--short", "HEAD"]);
  if (head.status !== 0) {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "git could not read HEAD" };
  }
  const headSha = head.stdout.trim();
  if (!SHORT_SHA.test(headSha)) {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "HEAD did not resolve to a commit" };
  }
  if (headSha !== input.expectedSha) {
    return {
      ok: false,
      cause: "HEAD_DRIFT",
      reason: `HEAD is ${headSha} but the run was bootstrapped at ${input.expectedSha} — re-bootstrap`,
    };
  }

  // 3) The tree must be clean. A `status` that FAILS is refused, never read as clean — that is the fail-open
  //    shape this exists to prevent. Only the COUNT of dirty entries is reported: filenames are not secret,
  //    but a sanitized refusal has no reason to carry them.
  const status = runGit(["status", "--porcelain"]);
  if (status.status !== 0) {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "could not read git status — refusing to assume a clean tree" };
  }
  const dirty = status.stdout.split("\n").filter((l) => l.trim().length > 0);
  if (dirty.length > 0) {
    return {
      ok: false,
      cause: "DIRTY_TREE",
      reason: `${dirty.length} uncommitted or untracked change(s) — the running code is not commit ${headSha}`,
    };
  }

  // 4) …and no path may be MARKED so that `status` cannot see it. `--assume-unchanged` / `--skip-worktree`
  //    hide a modified tracked file with no environment variable at all, so stripping the git env does not
  //    reach them. `ls-files -v` tags those paths with a lowercase letter (assume-unchanged) or `S`
  //    (skip-worktree). Without this, "working tree clean ⇒ the running code IS this commit" over-claims.
  const marked = runGit(["ls-files", "-v"]);
  if (marked.status !== 0) {
    return { ok: false, cause: "GIT_UNREADABLE", reason: "could not read the index — refusing to assume a clean tree" };
  }
  const hidden = marked.stdout.split("\n").filter((l) => /^[a-z]|^S /.test(l));
  if (hidden.length > 0) {
    return {
      ok: false,
      cause: "DIRTY_TREE",
      reason: `${hidden.length} path(s) marked assume-unchanged/skip-worktree — changes there are invisible to git status`,
    };
  }
  return { ok: true, head: headSha };
}
