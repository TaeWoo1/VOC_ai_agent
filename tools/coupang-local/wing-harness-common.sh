#!/usr/bin/env bash
#
# Shared preflight checks for the two Coupang WING harnesses — the READ-ONLY selector probe
# (`wing-probe-preflight.sh`) and its DESTRUCTIVE sibling, the key-deletion preflight
# (`wing-deletion-preflight.sh`).
#
# This file exists so the destructive harness does not become a second, drifting copy of hardening that took
# three review rounds to get right (ambient-git stripping, `case`-not-`grep` freshness parsing, a failing
# `git status` refusing rather than reading as clean, the `.env`-blind profile guard). One copy, two callers.
#
# It is SOURCED, never executed: it defines functions and sets `FAILED`, and makes no decision of its own about
# what a caller must check. Each preflight still owns its phase, its manifest display, and its disclosure copy.
#
# Nothing here launches a browser, makes a Coupang call, or reads a credential/.env VALUE.

# The caller must define REPO_ROOT before sourcing. FAILED accumulates across checks.
FAILED="${FAILED:-0}"
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILED=1; }

# Git, with the ambient git environment stripped and untracked-file reporting forced on. Without this,
# GIT_DIR / GIT_WORK_TREE can point the drift check at a clean decoy repository, and
# GIT_CONFIG_COUNT/KEY_n/VALUE_n (or a repo-level status.showUntrackedFiles=no) can hide a dirty tree —
# either of which turns "the running code IS this commit" into a false claim.
# GIT_CONFIG_PARAMETERS is stripped for its own reason: `-c status.showUntrackedFiles=normal` does NOT
# counter a `core.excludesFile` injected through it, which hides untracked files just as effectively.
#
# The config files are PINNED to /dev/null rather than merely unset. Unsetting GIT_CONFIG_GLOBAL makes git fall
# back to $XDG_CONFIG_HOME/git/config → $HOME/.gitconfig, so a prepared HOME re-opens exactly that
# core.excludesFile hole. Pinning closes it without unsetting HOME, which git needs for other things.
#
# Pinning the config FILES is still only half of it: $XDG_CONFIG_HOME/git/ignore (default
# $HOME/.config/git/ignore) is read from a DEFAULT PATH, not through any config key, so the same prepared HOME
# hides untracked files with no config involved. `-c core.excludesFile=/dev/null` overrides that default path
# without suppressing the repository's own tracked .gitignore. `-c safe.directory` is pinned too: with the
# global config gone, a repo owned by another uid would abort with "dubious ownership" and surface only as an
# opaque "not reading this repository".
# Mirrors `sanitizedGitEnv` / `PINNED_GIT_ENV` / `hardenedGitFlags` in collector/src/cli/repo-identity.ts — the
# TS gate performs the same verification independently, and the two must not be able to read different trees.
# `repo-identity.test.ts` asserts THIS FILE carries every one of those variables and flags.
git_hardened() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY \
      -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_COMMON_DIR -u GIT_CEILING_DIRECTORIES \
      -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_PARAMETERS \
      GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
      git -C "$REPO_ROOT" -c status.showUntrackedFiles=normal -c core.excludesFile=/dev/null \
          -c "safe.directory=$REPO_ROOT" "$@"
}

# Resolve a path through symlinks; empty on failure (callers MUST treat empty as a refusal, never as a match).
realpath_of() {
  python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]) if sys.argv[1] else '')" "$1" 2>/dev/null || echo ""
}

# Read one field from a prepared manifest JSON ($1=path, $2=key). Fails LOUDLY: a renamed/missing/blank key
# must never render as an empty line under a PASS banner. The path is passed via argv, never interpolated.
jget_from() {
  python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
k = sys.argv[2]
if k not in d:
    sys.exit(1)
v = d[k]
if isinstance(v, bool):
    v = "true" if v else "false"
elif isinstance(v, list):
    v = ",".join(v)
if v is None or v == "":
    sys.exit(1)
print(v)' "$1" "$2" 2>/dev/null
}

# ---- shared checks ------------------------------------------------------------

# The identity must be real bootstrapped values. The manifest gate refuses "unknown" too (UNBOUND_IDENTITY);
# catching it here gives the operator the actionable message instead. $1=run id $2=approval id $3=git commit
check_identity_bound() {
  local ok=1 pair name value
  for pair in "run id:$1" "approval id:$2" "git commit:$3"; do
    name="${pair%%:*}"; value="${pair#*:}"
    if [ -z "$value" ] || [ "$value" = "unknown" ]; then
      fail "$name is empty or \"unknown\" — re-run the bootstrap"; ok=0
    fi
  done
  [ "$ok" = "1" ] && pass "run identity bound (run ${1:0:8}… · approval ${2:0:8}…)"
}

# The identity must be FRESH: a grant is single-use and process-lifetime (contract §1.5/§2), so a run env left
# behind by an earlier session must not silently re-authorize a new one. $1=epoch stamp $2=ttl seconds
#
# `case`, not `grep -E`: grep matches LINE-wise, so a multi-line stamp whose second line is a valid epoch
# satisfies an anchored pattern and then puts a non-numeric token into the arithmetic below. An arithmetic
# ERROR unwinds the whole `if` — skipping both branches, leaving FAILED untouched, and silently deleting the
# freshness check. The leading-zero rejection matters for the same reason: bash would parse it as octal.
check_identity_fresh() {
  local stamp="$1" ttl="$2" epoch_ok=1 age
  case "$stamp" in
    ""|*[!0-9]*|0*) epoch_ok=0 ;;
  esac
  if [ "$epoch_ok" = "1" ] && { [ "${#stamp}" -lt 10 ] || [ "${#stamp}" -gt 11 ]; }; then
    epoch_ok=0
  fi
  if [ "$epoch_ok" != "1" ]; then
    fail "bootstrap timestamp missing or malformed in the run env — re-run the bootstrap"
    return
  fi
  # Digits only, 10–11 of them, no leading zero: the arithmetic below cannot error.
  age=$(( $(date +%s) - 10#$stamp ))
  if [ "$age" -lt 0 ] || [ "$age" -gt "$ttl" ]; then
    fail "run identity is stale (${age}s old, max ${ttl}s) — re-bootstrap for a fresh approval id"
  else
    pass "run identity is fresh (${age}s old)"
  fi
}

# No code drift since bootstrap: git must be reading THIS repository, HEAD must equal the bootstrapped SHA, and
# the working tree must be clean — otherwise the code that would run is not the code the manifest's gitSHA
# names, and the approval is REVOKED by contract §1.6. Sets CUR_GIT for the caller's display line.
# $1=bootstrapped git commit
check_no_code_drift() {
  local run_git="$1" toplevel toplevel_real repo_real dirt dirt_rc
  toplevel="$(git_hardened rev-parse --show-toplevel 2>/dev/null || echo "")"
  toplevel_real="$(realpath_of "$toplevel")"
  repo_real="$(realpath_of "$REPO_ROOT")"
  if [ -n "$toplevel_real" ] && [ -n "$repo_real" ] && [ "$toplevel_real" = "$repo_real" ]; then
    pass "git checks are reading this repository ($repo_real)"
  else
    fail "git is not reading this repository (got '${toplevel:-none}', expected ${repo_real:-unresolved}) — refusing"
  fi

  CUR_GIT="$(git_hardened rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if [ "$CUR_GIT" != "unknown" ] && [ "$CUR_GIT" = "$run_git" ]; then
    pass "git commit unchanged since bootstrap ($CUR_GIT)"
  else
    fail "git commit changed or unreadable ($run_git → $CUR_GIT) — re-bootstrap the run"
  fi

  dirt="$(git_hardened status --porcelain 2>/dev/null)"; dirt_rc=$?
  if [ "$dirt_rc" != "0" ]; then
    # An unreadable status must never render as "clean" — that is the fail-open shape this guards.
    fail "could not read git status (exit $dirt_rc) — refusing rather than assuming a clean tree"
  elif [ -z "$dirt" ]; then
    # `status` alone does not prove it: `--assume-unchanged` / `--skip-worktree` hide a modified tracked file
    # with no environment variable at all. `ls-files -v` tags those paths lowercase (assume-unchanged) or `S`.
    #
    # The output is captured BEFORE it is counted, deliberately. Piping straight into `grep -c` discards git's
    # exit status and prints `0` when git errors — the same fail-OPEN shape the `status` check above refuses,
    # and it would render as "working tree clean".
    local marked_out marked_rc marked
    marked_out="$(git_hardened ls-files -v 2>/dev/null)"; marked_rc=$?
    if [ "$marked_rc" != "0" ]; then
      fail "could not read the git index (exit $marked_rc) — refusing rather than assuming nothing is hidden"
    else
      marked="$(printf '%s\n' "$marked_out" | grep -cE '^[a-z]|^S ')"
      if [ "${marked:-0}" != "0" ]; then
        fail "$marked path(s) marked assume-unchanged/skip-worktree — changes there are invisible to git status; clear the marks, or run from a full (non-sparse) checkout"
      else
        pass "working tree clean — the running code IS commit $CUR_GIT"
      fi
    fi
  else
    fail "working tree is dirty — commit or stash first, then re-bootstrap (the manifest's gitSHA must name the code that runs):"
    printf '%s\n' "$dirt" | head -5 | sed 's/^/        | /'
  fi
}

# The local toolchain must be able to start the run with nothing more installed or asked.
# $1=collector dir $2=entrypoint (collector-relative) $3=human label
check_toolchain() {
  [ -x "$1/node_modules/.bin/tsx" ] && pass "collector toolchain present (tsx resolvable)" \
    || fail "collector dependencies missing — run 'npm install' in $1"
  [ -f "$1/$2" ] && pass "$3 entrypoint present ($2)" \
    || fail "$3 entrypoint missing: $1/$2"
}

# The dedicated Chrome profile must exist AND resolve inside the collector tree — the boundary
# collector/src/profile.ts enforces at launch, applied here through realpath (so an in-tree path that symlinks
# out, which the launch guard's purely lexical check would accept, is refused). $1=collector dir
#
# LIMIT, stated honestly: this checks the EFFECTIVE value only when it comes from the environment or the
# default. The documented invocation sources `collector/.env` first, and this preflight never reads .env
# values. So if .env sets COLLECTOR_PROFILE_DIR at all, the check would be validating a different path than the
# run uses — and it refuses instead of reassuring. Only the KEY is looked for; no .env value is read or logged.
check_dedicated_profile() {
  local collector_dir="$1" raw resolved collector_real
  if [ -f "$collector_dir/.env" ] && grep -qE '(^|[[:space:]])(export[[:space:]]+)?COLLECTOR_PROFILE_DIR=' "$collector_dir/.env"; then
    fail "collector/.env sets COLLECTOR_PROFILE_DIR — this preflight cannot verify a path it must not read. Unset it there (or export it in this shell) and re-run"
    return
  fi
  raw="${COLLECTOR_PROFILE_DIR:-$collector_dir/.profile/naver}"
  resolved="$(realpath_of "$raw")"
  collector_real="$(realpath_of "$collector_dir")"
  # Both must be non-empty before the comparison: an empty collector_real would degrade the pattern below to
  # `/*`, which matches every absolute path and would turn this guard into a rubber stamp.
  if [ -z "$resolved" ] || [ -z "$collector_real" ]; then
    fail "could not resolve the profile or collector path — refusing rather than comparing empty paths"
    return
  fi
  case "$resolved" in
    "$collector_real"/*)
      [ -d "$resolved" ] && pass "dedicated Chrome profile present inside the collector tree" \
        || fail "dedicated Chrome profile directory does not exist: $resolved" ;;
    *)
      fail "profile directory resolves OUTSIDE the collector tree ($raw) — the launch path guard will refuse it" ;;
  esac
}

# A browser must actually be launchable: the bundled Chromium (default) or the configured channel.
check_browser_launchable() {
  local channel="${COLLECTOR_BROWSER_CHANNEL:-}" pw_cache
  if [ -z "$channel" ]; then
    pw_cache="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
    ls -d "$pw_cache"/chromium-* >/dev/null 2>&1 && pass "bundled Chromium installed (Playwright cache)" \
      || fail "no bundled Chromium in $pw_cache — run 'npx playwright install chromium' in the collector"
  elif [ "$channel" = "chrome" ]; then
    [ -d "/Applications/Google Chrome.app" ] && pass "browser channel 'chrome' installed" \
      || fail "COLLECTOR_BROWSER_CHANNEL=chrome but Google Chrome is not installed"
  else
    pass "browser channel '$channel' configured (installation not verifiable here)"
  fi
}

# Verify a prepared manifest's operator-destructive-action descriptor is EXACTLY the canonical contract.
# $1 = manifest path. Returns 0 when correct, 1 otherwise (printing which field is wrong).
#
# The gate already enforces this field-by-field (DESTRUCTIVE_ACTION_CONTRACT_MISMATCH) — this is the DISPLAY
# side of the same invariant: a softened descriptor must never be shown to an operator as if it were canonical.
# It lives here, as a function over a file, so it can be exercised against crafted fixtures; inline in the
# preflight it was unfalsifiable, because the gate makes a wrong descriptor unproducible through the CLI.
verify_destructive_descriptor() {
  local manifest="$1" pair key want got rc=0
  for pair in \
    "operation:DELETE_WING_OPEN_API_KEY" \
    "irreversible:true" \
    "invalidatesExistingCredentialImmediately:true" \
    "agentPerformsAction:false" \
    "explicitCheckpointRequired:true" \
    "credentialValueReadBudget:0"
  do
    key="${pair%%:*}"; want="${pair#*:}"
    got="$(python3 -c 'import json,sys
d = json.load(open(sys.argv[1])).get("operatorDestructiveAction")
if not isinstance(d, dict) or sys.argv[2] not in d:
    sys.exit(1)
v = d[sys.argv[2]]
print("true" if v is True else "false" if v is False else v)' "$manifest" "$key" 2>/dev/null)" || got=""
    if [ "$got" != "$want" ]; then
      echo "  FAIL  destructive descriptor $key is '${got:-missing}', must be '$want'"
      rc=1
    fi
  done
  return $rc
}

# Verify a prepared manifest's operator-REVEAL-action descriptor is EXACTLY the canonical contract.
# $1 = manifest path. Returns 0 when correct, 1 otherwise (printing which field is wrong).
#
# The mirror of verify_destructive_descriptor, and it guards the OPPOSITE direction. There, the risk is a
# descriptor that UNDERSTATES the danger. Here it is one that OVERSTATES safety: `keyCreationRuledOut: true`
# would tell an operator SellerOps had confirmed no key was created, which nothing can — every sanitized signal
# is identical between an issued and a no-key surface (`NO_DISCRIMINATING_SIGNAL`). `createsKeyMaterial` and
# `keyCreationRuledOut` are BOTH false and are not redundant: the first says the approved operation is not the
# key-creating one, the second says this run cannot prove none happened anyway.
#
# `operation` and `forbiddenFollowOnAction` are checked as a PAIR, so a manifest re-pointed at key issuance or
# at the destructive deletion is refused rather than displayed under reveal disclosure copy.
#
# The want-table below is mirrored from COUPANG_WING_ISSUANCE_REVEAL_ACTION in
# collector/src/cli/approval-manifest.ts; `coupang-wing-reveal-gate.test.ts` asserts the two agree field for
# field, so this copy cannot drift into approving semantics the runtime does not implement.
verify_reveal_descriptor() {
  local manifest="$1" pair key want got rc=0
  for pair in \
    "operation:REVEAL_WING_ISSUANCE_CONFIGURATION" \
    "forbiddenFollowOnAction:COMPLETE_WING_KEY_ISSUANCE" \
    "createsKeyMaterial:false" \
    "keyCreationRuledOut:false" \
    "irreversible:false" \
    "agentPerformsAction:false" \
    "explicitCheckpointRequired:true" \
    "credentialValueReadBudget:0" \
    "expectedOutcome:CONFIGURATION_SURFACE" \
    "expectedOutcomeConfirmed:false" \
    "autoAdvanceAfterReveal:false"
  do
    key="${pair%%:*}"; want="${pair#*:}"
    got="$(python3 -c 'import json,sys
d = json.load(open(sys.argv[1])).get("operatorRevealAction")
if not isinstance(d, dict) or sys.argv[2] not in d:
    sys.exit(1)
v = d[sys.argv[2]]
print("true" if v is True else "false" if v is False else v)' "$manifest" "$key" 2>/dev/null)" || got=""
    if [ "$got" != "$want" ]; then
      echo "  FAIL  reveal descriptor $key is '${got:-missing}', must be '$want'"
      rc=1
    fi
  done
  return $rc
}

# Resolve the manifest output path. BSD mktemp substitutes only TRAILING X's, so a `.XXXXXX.json` template
# creates a file named literally that, which then collides on the next run — take a temp DIRECTORY instead.
# Echoes the path, or nothing on failure (the caller must refuse). $1=temp-dir prefix
resolve_manifest_out() {
  local out="${SELLEROPS_MANIFEST_OUT:-}" dir
  if [ -z "$out" ]; then
    dir="$(mktemp -d "${TMPDIR:-/tmp}/$1.XXXXXX")" || dir=""
    out="${dir:+$dir/manifest.json}"
  fi
  echo "$out"
}
