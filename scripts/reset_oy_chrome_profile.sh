#!/usr/bin/env bash
#
# reset_oy_chrome_profile.sh — operator-safe Chrome profile reset for the
# OliveYoung CDP-attached collection workflow.
#
# Why this exists
# ---------------
# The CDP-attached Chrome profile (cookies / localStorage / service-worker
# cache / OY anti-bot fingerprint state) accumulates state that, after
# repeated false-empty / anti-bot events, can stay contaminated for many
# hours — even days. The empirical signal: the profile shows zero reviews
# on a known-good product page even >30 minutes after a manual reload.
#
# When that happens, no amount of waiting / IP cooldown / `--strict-reset-
# session-on-block` clears it; the only fix is to start with a fresh
# profile dir and re-login.
#
# This script does NOT delete state. It moves the contaminated profile
# aside (suffix `_broken_<UTC_timestamp>`) so the operator can:
#   - inspect what was in there if needed (cookies, IndexedDB, etc.),
#   - restore it manually if the contamination turns out to be elsewhere
#     (network IP, account, etc.),
#   - delete it later when sure it's irrelevant.
#
# Hard rules
# ----------
#   - Never `rm -rf` permanently by default.
#   - Refuse to operate if Chrome is running against the target profile
#     (rename would break Chrome's open file handles).
#   - Print, don't execute, the relaunch command. The operator confirms
#     and runs it.
#   - macOS / Linux / WSL — POSIX shell only.
#
# Usage
# -----
#
#     scripts/reset_oy_chrome_profile.sh                # auto-detect, dry-run-confirm
#     scripts/reset_oy_chrome_profile.sh --yes          # skip confirmation prompt
#     scripts/reset_oy_chrome_profile.sh --profile-dir /tmp/chrome-debug-oy
#     scripts/reset_oy_chrome_profile.sh --port 9222
#
# Exit codes
# ----------
#   0  archived OK (or operator declined; nothing harmful done)
#   1  profile dir not found and no candidate detected
#   2  Chrome appears to be running against the target profile (refuse)
#   3  user input error (bad flag combination, unsupported OS, etc.)
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

# Candidate profile paths in priority order. The two documented in
# `docs/phase2_oy_authenticated_collection_operations.md` come first;
# the third is the historical alternate the user mentioned.
DEFAULT_CANDIDATES=(
    "/tmp/chrome-debug-oy"
    "${HOME}/Library/Chrome-OY-debug"
    "${HOME}/chrome-oy-profile"
    "/tmp/chrome-oy-profile"
)

DEFAULT_CDP_PORT=9222
ASSUME_YES=0
EXPLICIT_PROFILE_DIR=""
CDP_PORT="${DEFAULT_CDP_PORT}"

# ---------------------------------------------------------------------------
# Argument parsing — POSIX-friendly while/case loop.
# ---------------------------------------------------------------------------

print_usage() {
    sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help)
            print_usage
            exit 0
            ;;
        --yes|-y)
            ASSUME_YES=1
            shift
            ;;
        --profile-dir)
            EXPLICIT_PROFILE_DIR="${2:-}"
            if [ -z "${EXPLICIT_PROFILE_DIR}" ]; then
                echo "✗ --profile-dir requires a path argument" >&2
                exit 3
            fi
            shift 2
            ;;
        --port)
            CDP_PORT="${2:-}"
            if [ -z "${CDP_PORT}" ]; then
                echo "✗ --port requires a numeric argument" >&2
                exit 3
            fi
            shift 2
            ;;
        --)
            shift
            break
            ;;
        *)
            echo "✗ unknown argument: $1" >&2
            print_usage >&2
            exit 3
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Locate Chrome binary (mac / linux).
# ---------------------------------------------------------------------------

detect_chrome_bin() {
    if [ "$(uname -s)" = "Darwin" ]; then
        local mac_bin="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if [ -x "${mac_bin}" ]; then
            echo "${mac_bin}"
            return 0
        fi
    fi
    for cand in google-chrome google-chrome-stable chromium chromium-browser; do
        if command -v "${cand}" >/dev/null 2>&1; then
            command -v "${cand}"
            return 0
        fi
    done
    echo ""
    return 1
}

CHROME_BIN="$(detect_chrome_bin || true)"

# ---------------------------------------------------------------------------
# Resolve target profile dir.
# ---------------------------------------------------------------------------

resolve_profile_dir() {
    if [ -n "${EXPLICIT_PROFILE_DIR}" ]; then
        echo "${EXPLICIT_PROFILE_DIR}"
        return 0
    fi
    for cand in "${DEFAULT_CANDIDATES[@]}"; do
        if [ -d "${cand}" ]; then
            echo "${cand}"
            return 0
        fi
    done
    echo ""
    return 1
}

PROFILE_DIR="$(resolve_profile_dir || true)"

if [ -z "${PROFILE_DIR}" ]; then
    echo "✗ No OY Chrome profile dir found." >&2
    echo "" >&2
    echo "  Searched:" >&2
    for cand in "${DEFAULT_CANDIDATES[@]}"; do
        echo "    - ${cand}" >&2
    done
    echo "" >&2
    echo "  Hints:" >&2
    echo "    - If you launched Chrome with a custom --user-data-dir," >&2
    echo "      pass it explicitly: --profile-dir /path/to/your/profile" >&2
    echo "    - If you've never launched a CDP Chrome for OY, there is" >&2
    echo "      nothing to reset; just launch a new one (command below)." >&2
    echo "" >&2
    echo "  Suggested launch command (creates a fresh profile at the first" >&2
    echo "  documented default path):" >&2
    if [ -n "${CHROME_BIN}" ]; then
        echo "    \"${CHROME_BIN}\" \\" >&2
    else
        echo "    /path/to/chrome \\" >&2
    fi
    echo "      --remote-debugging-port=${CDP_PORT} \\" >&2
    echo "      --user-data-dir=${DEFAULT_CANDIDATES[0]}" >&2
    exit 1
fi

# Resolve to absolute path so the archive-rename can't be defeated by
# trailing slashes or relative paths.
PROFILE_DIR="$(cd "${PROFILE_DIR}" && pwd)"

# ---------------------------------------------------------------------------
# Refuse to rename if Chrome is currently using the profile.
# Chrome holds open file handles inside `Default/`, so renaming the dir
# would either fail or silently corrupt state across processes.
# ---------------------------------------------------------------------------

profile_in_use() {
    # macOS `lsof +D` / Linux `lsof +D` both report processes with open
    # FDs under the path. We tolerate `lsof` being absent (e.g. minimal
    # Linux containers) — in that case we conservatively assume the
    # profile is *not* in use rather than blocking the reset; CDP attach
    # will surface any real conflict.
    if ! command -v lsof >/dev/null 2>&1; then
        return 1
    fi
    # +D is recursive but expensive on large profiles. Bound to 5s.
    if lsof +D "${PROFILE_DIR}" 2>/dev/null | grep -q "Google Chrome"; then
        return 0
    fi
    return 1
}

if profile_in_use; then
    echo "✗ Chrome appears to be running against ${PROFILE_DIR}." >&2
    echo "  Quit Chrome (Cmd+Q on macOS) before resetting the profile." >&2
    echo "  ('Close window' is not enough — fully quit so file handles" >&2
    echo "  release.)" >&2
    exit 2
fi

# Also refuse if the CDP port is reachable — that signals an attached
# Chrome we shouldn't surprise. lsof without `+D` is cheap.
if command -v lsof >/dev/null 2>&1; then
    if lsof -i ":${CDP_PORT}" >/dev/null 2>&1; then
        echo "✗ A process is listening on CDP port ${CDP_PORT}." >&2
        echo "  Quit that Chrome window before resetting the profile." >&2
        exit 2
    fi
fi

# ---------------------------------------------------------------------------
# Compute archive name + plan the operation.
# ---------------------------------------------------------------------------

# UTC timestamp matches the convention used elsewhere in the repo
# (manifest, snapshots, diagnostics).
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_NAME="$(basename "${PROFILE_DIR}")_broken_${TS}"
ARCHIVE_PATH="$(dirname "${PROFILE_DIR}")/${ARCHIVE_NAME}"

# Approximate the disk footprint we're about to move.
if command -v du >/dev/null 2>&1; then
    SIZE_HUMAN="$(du -sh "${PROFILE_DIR}" 2>/dev/null | awk '{print $1}')"
else
    SIZE_HUMAN="?"
fi

cat <<EOF

  ──────────────── OY Chrome profile reset ────────────────
  Source profile : ${PROFILE_DIR}
  Approx size    : ${SIZE_HUMAN}
  Archive target : ${ARCHIVE_PATH}
  CDP port       : ${CDP_PORT}
  Chrome binary  : ${CHROME_BIN:-(not detected — print only)}

  Plan:
    1. mv  ${PROFILE_DIR}
        →  ${ARCHIVE_PATH}     (preserves all state for inspection)
    2. mkdir -p ${PROFILE_DIR}  (fresh empty profile)
    3. print the relaunch command so YOU can run it manually

  This is a NON-DESTRUCTIVE reset. Nothing is permanently deleted.

EOF

# ---------------------------------------------------------------------------
# Confirmation prompt.
# ---------------------------------------------------------------------------

if [ "${ASSUME_YES}" -ne 1 ]; then
    printf "  Proceed? [y/N] "
    # Read a single line; if not from a TTY, default to no.
    if [ -t 0 ]; then
        read -r REPLY
    else
        REPLY=""
    fi
    case "${REPLY}" in
        y|Y|yes|YES) : ;;
        *)
            echo "  Aborted by operator. No changes made."
            exit 0
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# Execute archive + recreate.
# ---------------------------------------------------------------------------

# Defensive: refuse to overwrite an existing archive (would happen only
# if the operator runs this twice in the same UTC second, which is
# vanishingly rare but not worth losing data over).
if [ -e "${ARCHIVE_PATH}" ]; then
    echo "✗ Archive path already exists: ${ARCHIVE_PATH}" >&2
    echo "  Wait one second and re-run, or pass an explicit --profile-dir." >&2
    exit 3
fi

mv "${PROFILE_DIR}" "${ARCHIVE_PATH}"
mkdir -p "${PROFILE_DIR}"

echo
echo "  ✓ Archived ${PROFILE_DIR} → ${ARCHIVE_PATH}"
echo "  ✓ Created fresh ${PROFILE_DIR}"
echo

# ---------------------------------------------------------------------------
# Print relaunch command.
# ---------------------------------------------------------------------------

cat <<EOF
  ──────────────── Next steps ────────────────

  1. Launch a fresh CDP Chrome against the empty profile:

EOF

if [ -n "${CHROME_BIN}" ]; then
    cat <<EOF
       "${CHROME_BIN}" \\
         --remote-debugging-port=${CDP_PORT} \\
         --user-data-dir=${PROFILE_DIR}
EOF
else
    cat <<EOF
       /path/to/chrome \\
         --remote-debugging-port=${CDP_PORT} \\
         --user-data-dir=${PROFILE_DIR}
EOF
fi

cat <<EOF

  2. Sign in to https://www.oliveyoung.co.kr/ in that window.

  3. Verify the CDP endpoint is reachable:

       curl -s http://localhost:${CDP_PORT}/json/version | python3 -m json.tool

  4. Confirm the new profile sees reviews. Pick a known-good product:

       PYTHONPATH=. python3 scripts/diagnose_oy_access.py \\
           --product-url "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000171427" \\
           --cdp-endpoint "http://localhost:${CDP_PORT}"

       Expected verdict: ok
       (review_api_observed.fired=true, review_card_visible=true)

  5. If the diagnostic shows verdict=ok, resume your scrape:

       PYTHONPATH=. python3 scripts/run_all.py --product-url "..."

  Old profile preserved at:
    ${ARCHIVE_PATH}

  Delete it manually with \`rm -rf "${ARCHIVE_PATH}"\` once you're certain
  the contamination is gone (recommended: keep for a week).

EOF
