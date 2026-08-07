/**
 * Tests for `verifyRepoIdentity` — the check that makes a destructive approval's `gitSha` a CLAIM ABOUT THE
 * RUNNING CODE rather than a string that merely exists.
 *
 * Every case here is a way the previous presence-only check could be satisfied while the running code was not
 * the commit the operator approved: a redirected repository, a moved HEAD, a dirty tree, or a git command that
 * failed and was read as success. The git runner is injected, so these are hermetic — no repo state required,
 * and the failure modes can be produced exactly rather than approximated.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  PINNED_GIT_ENV,
  hardenedGitFlags,
  REPO_IDENTITY_CAUSES,
  STRIPPED_GIT_ENV_VARS,
  sanitizedGitEnv,
  verifyRepoIdentity,
  type GitRunResult,
} from "../../src/cli/repo-identity";

const ROOT = "/repo";
const SHA = "a666ad1";

/** A scripted git: maps the first two argv tokens to a result. Anything unscripted is a hard failure. */
function gitFake(script: Record<string, GitRunResult>) {
  return (args: readonly string[]): GitRunResult => {
    const key = args.slice(0, 2).join(" ");
    const hit = script[key];
    if (!hit) throw new Error(`unscripted git call: ${args.join(" ")}`);
    return hit;
  };
}

const OK_SCRIPT: Record<string, GitRunResult> = {
  "rev-parse --show-toplevel": { status: 0, stdout: `${ROOT}\n` },
  "rev-parse --short": { status: 0, stdout: `${SHA}\n` },
  "status --porcelain": { status: 0, stdout: "" },
  "ls-files -v": { status: 0, stdout: "H src/a.ts\n" },
};

function verify(script: Record<string, GitRunResult>, expectedSha = SHA) {
  return verifyRepoIdentity({
    expectedSha,
    repoRoot: ROOT,
    runGit: gitFake(script),
    realpath: (p) => p, // identity: the fake paths are already canonical
  });
}

describe("verifyRepoIdentity — the happy path is the ONLY path that passes", () => {
  it("accepts this repository, at the pinned commit, with a clean tree", () => {
    const r = verify(OK_SCRIPT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.head).toBe(SHA);
  });

  it("tolerates trailing whitespace from git output", () => {
    expect(
      verify({ ...OK_SCRIPT, "rev-parse --short": { status: 0, stdout: `  ${SHA}  \n\n` } }).ok,
    ).toBe(true);
  });
});

describe("verifyRepoIdentity — HEAD drift and a dirty tree are refused", () => {
  it("HEAD moved since bootstrap → HEAD_DRIFT", () => {
    const r = verify({ ...OK_SCRIPT, "rev-parse --short": { status: 0, stdout: "deadbee\n" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe("HEAD_DRIFT");
      expect(r.reason).toContain("deadbee");
      expect(r.reason).toContain(SHA);
    }
  });

  it("uncommitted or untracked changes → DIRTY_TREE, reporting a COUNT not filenames", () => {
    const r = verify({
      ...OK_SCRIPT,
      "status --porcelain": { status: 0, stdout: " M src/secret-plan.ts\n?? .env.local\n" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe("DIRTY_TREE");
      expect(r.reason).toContain("2 uncommitted");
      expect(r.reason).not.toContain("secret-plan");
      expect(r.reason).not.toContain(".env");
    }
  });

  it("blank lines in porcelain output are not counted as dirt", () => {
    expect(verify({ ...OK_SCRIPT, "status --porcelain": { status: 0, stdout: "\n\n  \n" } }).ok).toBe(true);
  });
});

describe("verifyRepoIdentity — an unreadable git NEVER reads as clean or unchanged", () => {
  it("a failing `status` refuses rather than assuming a clean tree", () => {
    // The fail-OPEN shape this module exists to prevent: `status` errors, stdout is empty, empty looks clean.
    const r = verify({ ...OK_SCRIPT, "status --porcelain": { status: 128, stdout: "" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("GIT_UNREADABLE");
  });

  it("a failing `rev-parse HEAD` refuses rather than assuming the commit matches", () => {
    const r = verify({ ...OK_SCRIPT, "rev-parse --short": { status: 128, stdout: "" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("GIT_UNREADABLE");
  });

  it("HEAD that does not resolve to a commit shape refuses", () => {
    const r = verify({ ...OK_SCRIPT, "rev-parse --short": { status: 0, stdout: "HEAD\n" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("GIT_UNREADABLE");
  });

  it("a missing/malformed bootstrapped SHA refuses before any git call", () => {
    for (const bad of ["", "unknown", "zzzzzzz", "abc", "  "]) {
      const r = verifyRepoIdentity({
        expectedSha: bad,
        repoRoot: ROOT,
        runGit: () => {
          throw new Error("git must not be called for a malformed SHA");
        },
        realpath: (p) => p,
      });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.cause).toBe("GIT_UNREADABLE");
    }
  });

  it("a realpath failure refuses rather than comparing unresolved paths", () => {
    const r = verifyRepoIdentity({
      expectedSha: SHA,
      repoRoot: ROOT,
      runGit: gitFake(OK_SCRIPT),
      realpath: () => {
        throw new Error("ENOENT");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("GIT_UNREADABLE");
  });
});

describe("verifyRepoIdentity — a redirected repository is refused, and named as such", () => {
  it("a decoy toplevel → WRONG_REPOSITORY (not HEAD_DRIFT)", () => {
    // Reporting this as drift would send the operator to re-bootstrap, papering over the redirect entirely.
    const r = verify({ ...OK_SCRIPT, "rev-parse --show-toplevel": { status: 0, stdout: "/tmp/decoy\n" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("WRONG_REPOSITORY");
  });

  it("a decoy that ALSO reports the pinned SHA and a clean tree is still refused", () => {
    // The decoy repository's whole purpose is to answer every subsequent question correctly.
    const r = verify({
      "rev-parse --show-toplevel": { status: 0, stdout: "/tmp/decoy\n" },
      "rev-parse --short": { status: 0, stdout: `${SHA}\n` },
      "status --porcelain": { status: 0, stdout: "" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("WRONG_REPOSITORY");
  });

  it("an empty toplevel is refused, never treated as a match", () => {
    const r = verify({ ...OK_SCRIPT, "rev-parse --show-toplevel": { status: 0, stdout: "\n" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("WRONG_REPOSITORY");
  });

  it("a SYMLINKED path that resolves to this repo is accepted (realpath, not string compare)", () => {
    const r = verifyRepoIdentity({
      expectedSha: SHA,
      repoRoot: "/link/to/repo",
      runGit: gitFake(OK_SCRIPT),
      realpath: (p) => (p === "/link/to/repo" ? ROOT : p),
    });
    expect(r.ok).toBe(true);
  });
});

describe("sanitizedGitEnv — the ambient git environment cannot reach the check", () => {
  it("strips every listed variable AND the numbered GIT_CONFIG_KEY_n / VALUE_n pairs", () => {
    const hostile: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      HOME: "/home/op",
      GIT_DIR: "/tmp/decoy/.git",
      GIT_WORK_TREE: "/tmp/decoy",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "status.showUntrackedFiles",
      GIT_CONFIG_VALUE_0: "no",
      GIT_CONFIG_PARAMETERS: "'core.excludesFile=/tmp/hide'",
      GIT_CEILING_DIRECTORIES: "/",
    };
    const clean = sanitizedGitEnv(hostile);
    for (const k of STRIPPED_GIT_ENV_VARS) {
      // The two config-file variables are PINNED rather than removed (see the next test); everything else is
      // removed outright. Either way the ambient value is gone.
      if (k in PINNED_GIT_ENV) expect(clean[k], k).toBe("/dev/null");
      else expect(clean[k], k).toBeUndefined();
    }
    expect(clean.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(clean.GIT_CONFIG_VALUE_0).toBeUndefined();
    // …while leaving the ordinary environment intact, so git still runs.
    expect(clean.PATH).toBe("/usr/bin");
    expect(clean.HOME).toBe("/home/op");
  });

  it("the stripped list covers each variable that can REDIRECT git or inject config", () => {
    for (const v of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_COMMON_DIR",
      "GIT_INDEX_FILE",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_CEILING_DIRECTORIES",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_CONFIG_PARAMETERS",
    ]) {
      expect(STRIPPED_GIT_ENV_VARS as readonly string[], v).toContain(v);
    }
  });

  it("PINS the config files rather than only unsetting them — a hostile HOME must not re-open the hole", () => {
    // Stripping GIT_CONFIG_GLOBAL alone is NOT enough: git falls back to $XDG_CONFIG_HOME/git/config and then
    // $HOME/.gitconfig, so a prepared HOME can still supply a `core.excludesFile` that hides untracked files
    // from `status --porcelain` — exactly the bypass GIT_CONFIG_PARAMETERS was stripped to close. (Reproduced
    // against a real repo during review: with HOME hijacked and the variable merely unset, an untracked file
    // vanished from porcelain output.) The list-membership assertion above cannot catch that; this can.
    const clean = sanitizedGitEnv({ HOME: "/tmp/hostile", XDG_CONFIG_HOME: "/tmp/hostile/.config" });
    expect(clean.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(clean.GIT_CONFIG_SYSTEM).toBe("/dev/null");
    // An ambient value must not survive: the pin is applied AFTER the copy, so it always wins.
    const overridden = sanitizedGitEnv({ GIT_CONFIG_GLOBAL: "/tmp/hostile/gitconfig" });
    expect(overridden.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(PINNED_GIT_ENV.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  });
});

describe("verifyRepoIdentity — dirt hidden WITHOUT an env var is still caught", () => {
  const WITH_LSFILES = { ...OK_SCRIPT, "ls-files -v": { status: 0, stdout: "H src/a.ts\nH src/b.ts\n" } };

  it("a clean tree with no marked paths passes", () => {
    expect(verify(WITH_LSFILES).ok).toBe(true);
  });

  it("assume-unchanged (lowercase tag) is refused even though `status` reports clean", () => {
    // `git update-index --assume-unchanged` needs no environment variable, so stripping the git env does not
    // reach it: a modified tracked file simply stops appearing in porcelain output.
    const r = verify({ ...WITH_LSFILES, "ls-files -v": { status: 0, stdout: "H src/a.ts\nh src/secret.ts\n" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe("DIRTY_TREE");
      expect(r.reason).toContain("assume-unchanged");
      expect(r.reason).not.toContain("secret");
    }
  });

  it("skip-worktree (S tag) is refused", () => {
    const r = verify({ ...WITH_LSFILES, "ls-files -v": { status: 0, stdout: "S collector/.env\n" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("DIRTY_TREE");
  });

  it("an unreadable index refuses rather than assuming nothing is marked", () => {
    const r = verify({ ...WITH_LSFILES, "ls-files -v": { status: 128, stdout: "" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("GIT_UNREADABLE");
  });
});

describe("repo-identity — the shell harness mirrors this module", () => {
  // Both files assert in prose that "the two must not be able to read different trees". Prose is not a test:
  // the shell copy could quietly lose a variable or a `-c` flag and nothing would notice, because the shell
  // selfcheck can only exercise the bypasses someone thought to write a case for. This asserts the mirror.
  const SHELL = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../tools/coupang-local/wing-harness-common.sh",
  );
  const src = readFileSync(SHELL, "utf8");
  const hardened = src.slice(src.indexOf("git_hardened() {"), src.indexOf("\n}", src.indexOf("git_hardened() {")));

  it("strips every variable this module strips", () => {
    for (const v of STRIPPED_GIT_ENV_VARS) {
      if (v in PINNED_GIT_ENV) continue; // pinned below, not unset
      expect(hardened, `${v} must be stripped in git_hardened`).toContain(`-u ${v}`);
    }
  });

  it("pins every config file this module pins", () => {
    for (const [k, v] of Object.entries(PINNED_GIT_ENV)) {
      expect(hardened, `${k} must be pinned in git_hardened`).toContain(`${k}=${v}`);
    }
  });

  it("carries every hardened -c flag, including the ones an env pin cannot cover", () => {
    // `core.excludesFile` has a DEFAULT PATH ($HOME/.config/git/ignore) that no config-file pin suppresses —
    // review demonstrated the bypass surviving the pin alone. `safe.directory` is pinned because pinning the
    // global config removes the operator's own entry.
    for (const flag of ["status.showUntrackedFiles=normal", "core.excludesFile=/dev/null", "safe.directory="]) {
      expect(hardened, `git_hardened must pass -c ${flag}`).toContain(flag);
    }
    for (const flag of hardenedGitFlags("/repo")) {
      if (flag === "-c") continue;
      const key = flag.split("=")[0]!;
      expect(hardened, `git_hardened is missing ${key}`).toContain(key);
    }
  });

  it("also checks the index bits — a marked path is invisible to `status` in either layer", () => {
    expect(src).toContain("ls-files -v");
    // …and captures git's exit status instead of piping into `grep -c`, which prints 0 on failure and would
    // render an unreadable index as "working tree clean".
    expect(src).toContain("marked_rc=$?");
    expect(src).not.toMatch(/ls-files -v 2>\/dev\/null \| grep/);
  });
});

describe("repo-identity — sanitized surface", () => {
  it("the cause set is closed and carries no free-form detail", () => {
    expect([...REPO_IDENTITY_CAUSES]).toEqual(["GIT_UNREADABLE", "WRONG_REPOSITORY", "HEAD_DRIFT", "DIRTY_TREE"]);
  });

  it("no refusal reason leaks a path outside the repo, a filename, or an env value", () => {
    const cases = [
      verify({ ...OK_SCRIPT, "rev-parse --show-toplevel": { status: 0, stdout: "/Users/someone/secret-clone\n" } }),
      verify({ ...OK_SCRIPT, "status --porcelain": { status: 0, stdout: " M collector/.env\n?? token.txt\n" } }),
      verify({ ...OK_SCRIPT, "status --porcelain": { status: 128, stdout: "" } }),
    ];
    for (const r of cases) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        for (const forbidden of ["/Users/", "secret-clone", ".env", "token.txt"]) {
          expect(r.reason, `reason must not contain ${forbidden}`).not.toContain(forbidden);
        }
      }
    }
  });
});
