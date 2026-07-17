import { afterEach, describe, expect, it, vi } from "vitest";
import { SecureRandomUnavailableError, newCommandId } from "./commandId";

// The fallback exists for an origin no test environment reproduces: `crypto.randomUUID` is
// [SecureContext], so it is UNDEFINED on http://<lan-ip>, while jsdom/node expose it
// unconditionally. So the gating is SIMULATED here by removing the method — that is the
// only way to exercise the path the browser will actually take, and without these tests
// the fallback would be code nothing ever ran.

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Swap in a crypto object for one test; vi.stubGlobal is undone by unstubAllGlobals. */
function withCrypto(c: unknown) {
  vi.stubGlobal("crypto", c);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("newCommandId", () => {
  it("prefers randomUUID when the platform offers it", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    withCrypto({ randomUUID, getRandomValues: vi.fn() });

    expect(newCommandId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  describe("on an insecure origin, where randomUUID does not exist", () => {
    /** getRandomValues, filled from a caller-supplied byte source. */
    function seeded(byteAt: (i: number) => number) {
      return {
        // No randomUUID — exactly what an http://<lan-ip> origin looks like.
        getRandomValues: (a: Uint8Array) => {
          for (let i = 0; i < a.length; i++) {
            a[i] = byteAt(i);
          }
          return a;
        },
      };
    }

    it("still mints a well-formed v4 UUID", () => {
      withCrypto(seeded((i) => (i * 17 + 3) & 0xff));
      expect(newCommandId()).toMatch(V4);
    });

    it("stamps version 4 over the random bits, whatever they were", () => {
      // All-zero and all-ones bracket the range: the version nibble must read 4 in both,
      // so it is being written rather than inherited from the entropy.
      withCrypto(seeded(() => 0x00));
      expect(newCommandId()[14]).toBe("4");
      withCrypto(seeded(() => 0xff));
      expect(newCommandId()[14]).toBe("4");
    });

    it("stamps the RFC 4122 variant (10xx) over the random bits", () => {
      // Byte 8's top two bits must be 10, so the nibble is one of 8/9/a/b — never c-f
      // (Microsoft variant) or 0-7 (NCS). Getting this wrong yields a string that passes
      // any naive UUID regex and is not a v4 UUID.
      withCrypto(seeded(() => 0x00));
      expect(newCommandId()[19]).toBe("8");
      withCrypto(seeded(() => 0xff));
      expect(newCommandId()[19]).toBe("b");
    });

    it("uses all 16 bytes of entropy, in order", () => {
      // A distinct byte per position, so a slice/offset error shows up as a wrong digit
      // rather than as a plausible-looking UUID.
      withCrypto(seeded((i) => i));
      // 000102030405060708090a0b0c0d0e0f, with byte 6 (0x06 → 0x46) and byte 8
      // (0x08 → 0x88) overwritten.
      expect(newCommandId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    });

    it("does not repeat itself across calls", () => {
      // Real entropy this time (node's), not a fixture: two ids in a row must differ, or
      // the "idempotency key" would make every decision a replay of the last.
      const real = globalThis.crypto;
      withCrypto({ getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
      const ids = new Set(Array.from({ length: 50 }, () => newCommandId()));
      expect(ids.size).toBe(50);
      for (const id of ids) {
        expect(id).toMatch(V4);
      }
    });
  });

  it("throws a distinct error when there is no secure randomness at all", () => {
    withCrypto({});
    expect(() => newCommandId()).toThrow(SecureRandomUnavailableError);
    withCrypto(undefined);
    expect(() => newCommandId()).toThrow(SecureRandomUnavailableError);
  });

  it("never falls back to Math.random", () => {
    // The type is what makes a retry a replay instead of a second decision, so a
    // non-CSPRNG is a correctness bug, not a quality-of-randomness nit. Pinned as a
    // behaviour because the alternative — "we just wouldn't" — is not enforceable.
    const spy = vi.spyOn(Math, "random");
    withCrypto({});
    expect(() => newCommandId()).toThrow(SecureRandomUnavailableError);
    expect(spy).not.toHaveBeenCalled();
  });
});
