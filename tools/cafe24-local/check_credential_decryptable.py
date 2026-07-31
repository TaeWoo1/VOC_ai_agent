#!/usr/bin/env python3
"""Boolean-only pre-boot gate: can the configured vault master key decrypt the
stored Cafe24 credential envelope?

This mirrors backend `EnvelopeCipher.open` (AES-256-GCM envelope
`[version:1][dekIv:12][wrappedDek:48][payloadIv:12][ciphertext:n]`) so the local
run script can fail closed *before* booting a backend whose master key does not
match the key that sealed the stored credential — the exact failure that surfaced
at run time as "자격 증명 복호화에 실패했습니다".

Contract, by design:
  * master key is read from env SELLEROPS_VAULT_MASTER_KEY (base64, 32 bytes);
  * the credential envelope is read as hex from STDIN (the run script fetches it
    with psql — this script never touches the DB or the network);
  * output is a single boolean line and an exit code — NEVER the key, the
    envelope bytes, or any decrypted plaintext.

Exit codes: 0 = decryptable, 3 = NOT decryptable (wrong/again key or tampering),
2 = master key missing/invalid format, 4 = envelope input missing/malformed.
"""
import base64
import os
import sys

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except Exception:  # pragma: no cover - dependency guidance only
    print("decryptable=ERROR reason=cryptography_module_missing", file=sys.stderr)
    sys.exit(2)

VERSION = 1
IV = 12
WRAPPED_DEK = 48  # 32-byte DEK + 16-byte GCM tag
HEADER = 1 + IV + WRAPPED_DEK + IV


def load_master_key() -> bytes:
    raw = os.environ.get("SELLEROPS_VAULT_MASTER_KEY", "").strip()
    if not raw:
        print("decryptable=ERROR reason=master_key_unset")
        sys.exit(2)
    try:
        mk = base64.b64decode(raw, validate=True)
    except Exception:
        print("decryptable=ERROR reason=master_key_not_base64")
        sys.exit(2)
    if len(mk) != 32:
        print("decryptable=ERROR reason=master_key_not_32_bytes")
        sys.exit(2)
    return mk


def envelope_open(mk: bytes, env: bytes) -> bytes:
    if len(env) <= HEADER:
        raise ValueError("short envelope")
    if env[0] != VERSION:
        raise ValueError("unsupported version")
    o = 1
    dek_iv = env[o:o + IV]; o += IV
    wrapped = env[o:o + WRAPPED_DEK]; o += WRAPPED_DEK
    pay_iv = env[o:o + IV]; o += IV
    ct = env[o:]
    dek = AESGCM(mk).decrypt(dek_iv, wrapped, None)   # unwrap DEK with master key
    return AESGCM(dek).decrypt(pay_iv, ct, None)      # decrypt payload with DEK


def main() -> int:
    mk = load_master_key()
    hex_in = sys.stdin.read().strip()
    if not hex_in:
        print("decryptable=ERROR reason=no_envelope_on_stdin")
        return 4
    try:
        env = bytes.fromhex(hex_in)
    except ValueError:
        print("decryptable=ERROR reason=envelope_not_hex")
        return 4
    try:
        plaintext = envelope_open(mk, env)
    except Exception:
        # Wrong master key (GCM auth fails) or tampering. No detail leaks.
        print("decryptable=false")
        return 3
    ok = plaintext is not None and len(plaintext) > 0
    print("decryptable=true" if ok else "decryptable=false")
    return 0 if ok else 3


if __name__ == "__main__":
    sys.exit(main())
