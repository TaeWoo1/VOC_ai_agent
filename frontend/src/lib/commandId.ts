// Idempotency keys for operator commands.
//
// This exists because `crypto.randomUUID()` alone is a trap. It is declared
// `[SecureContext]` in the WebCrypto IDL, so on a non-secure origin it is not a
// slow-or-degraded function — it is UNDEFINED. `vite.config.ts` sets `server.host: true`,
// whose whole purpose is serving the dev app on a LAN IP (`http://192.168.x.x:5173`),
// which is not a secure context. Calling it directly there throws a TypeError before any
// request is attempted, and jsdom does not model the gating at all
// (`Crypto-impl.js` delegates straight to Node), so no test can see it: the suite stays
// green while the control is inert in the browser it ships to.
//
// `getRandomValues` is the way out: it is deliberately NOT `[SecureContext]` in the same
// IDL, so it is available on exactly the origins where `randomUUID` is not.

/**
 * The platform cannot produce secure randomness at all.
 *
 * Distinct from a failed request on purpose: a request can be retried, this cannot. No
 * command id can be minted, so no decision can be recorded on this origin, and telling the
 * operator to "try again" would be a lie that costs them clicks to disprove.
 */
export class SecureRandomUnavailableError extends Error {
  constructor() {
    super("secure randomness is unavailable, so no command id can be minted");
    this.name = "SecureRandomUnavailableError";
  }
}

/**
 * A fresh idempotency key: a v4 UUID from the platform's CSPRNG.
 *
 * Never `Math.random()`, and not as a matter of taste. A command id is what makes a retry
 * a replay instead of a second decision; two colliding ids in one org make the server
 * reject the second as a conflicting reuse (409) or, worse, replay it as the first. That
 * is a correctness property, and `Math.random` is neither uniform nor collision-resistant
 * enough to carry it — it is also seeded per-context, so two tabs can walk the same
 * sequence.
 *
 * @throws SecureRandomUnavailableError when neither API is available.
 */
export function newCommandId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  // Preferred: one call, and the platform's own formatting.
  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }
  // Insecure origin: randomUUID is gone but getRandomValues is not.
  if (typeof c?.getRandomValues === "function") {
    return uuidV4(c);
  }
  throw new SecureRandomUnavailableError();
}

/** RFC 4122 §4.4: 122 random bits, with the version and variant fields overwritten. */
function uuidV4(c: Crypto): string {
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Byte 6 high nibble = version 4. Byte 8 high bits = variant 10xx (RFC 4122).
  // Both are stamped over random data, which is why a v4 UUID carries 122 random bits and
  // not 128 — getting these wrong yields a well-formed string that is not a v4 UUID, and
  // nothing downstream would notice.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}
