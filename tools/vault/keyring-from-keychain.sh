#!/usr/bin/env bash
# Emit SELLEROPS_VAULT_KEY_RING from the macOS Keychain — for `$(...)` capture, never for a terminal.
#
# WHY THIS EXISTS
# A credential is sealed under a master key and stamped with a key *id*. The id is a label the
# deployment picks; it is not the key. The demo org proved how far apart those can drift: four
# credentials stamped `local-dev-1`, a Keychain entry named exactly `local-dev-1` present on the same
# machine, and that entry unable to open any of them. The key that actually sealed them lives under a
# different Keychain account entirely.
#
# So the mapping from key id to where its material lives is real configuration, and it belongs
# somewhere explicit rather than in someone's memory. That is this file. It maps
#     <vault key id>  ->  <Keychain account under service sellerops-vault-master-key>
# and prints the ring string the backend reads.
#
# OUTPUT IS SECRET. It contains base64 master keys. Use it only as:
#     export SELLEROPS_VAULT_KEY_RING="$(tools/vault/keyring-from-keychain.sh)"
# Never run it bare into a terminal, a log, a pipe to a file, or an agent transcript. Entries whose
# Keychain account is absent are skipped silently, so a machine holding only some keys still boots.
set -euo pipefail

SERVICE="${SELLEROPS_VAULT_KEYCHAIN_SERVICE:-sellerops-vault-master-key}"

# key-id : keychain-account
#
# local-dev-1 -> taewookang
#   Verified 2026-08-22 against this machine's `sellerops` DB: the Keychain account `taewookang` holds
#   the key that seals the rows stamped `local-dev-1` (the demo org's Cafe24 and FILE_IMPORT
#   credentials). The Keychain entry literally named `local-dev-1` is a DIFFERENT key and opens none of
#   them — do not "fix" this line to match the names.
MAPPINGS=(
  "local-dev-1:taewookang"
)

out=""
for m in "${MAPPINGS[@]}"; do
  key_id="${m%%:*}"
  account="${m#*:}"
  material="$(security find-generic-password -s "$SERVICE" -a "$account" -w 2>/dev/null || true)"
  [ -n "$material" ] || continue
  [ -n "$out" ] && out="$out,"
  out="$out$key_id:$material"
done
printf '%s' "$out"
