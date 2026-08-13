/**
 * **The flow that holds the secrets.** Two things are under test and they are different in kind:
 *
 *  1. **Order.** A read never happens before a person has pressed. Enforced here by handing the flow a `read`
 *     seam that records whether `confirm` had already resolved true — the invariant a call site could otherwise
 *     invert with no test noticing.
 *  2. **Containment.** Nothing that leaves this flow — the returned record, the log sink, the seams it did not
 *     call — carries a value or any substring of one.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../src/log";
import { CredentialDigestSalt } from "../../src/credential/credential-evidence";
import {
  handOffCoupangCredential,
  type CredentialHandoffResponse,
  type CredentialReadResult,
} from "../../src/credential/coupang-credential-handoff";

const VENDOR = "V-00099";
const ACCESS = "8f2c1ab4d5e6f70819a2b3c4d5e6f708";
const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";
const SECRETS = { vendor_id: VENDOR, access_key: ACCESS, secret_key: SECRET };
const SALT = CredentialDigestSalt.forTest("fixed-salt");

const VERIFIED: CredentialHandoffResponse = { stored: true, connectionStatus: "SUCCESS", connectionReason: null };

interface Recorder {
  confirmCalls: number;
  readCalls: number;
  postCalls: number;
  /** True if `read` ran while `confirm` had NOT yet resolved true — the ordering violation, caught in the act. */
  readBeforeConfirm: boolean;
  posted: Readonly<Record<string, string>> | null;
}

function seams(opts: {
  allow?: boolean;
  read?: CredentialReadResult;
  post?: CredentialHandoffResponse | (() => Promise<CredentialHandoffResponse>);
}): { seams: Parameters<typeof handOffCoupangCredential>[0]; rec: Recorder } {
  const rec: Recorder = { confirmCalls: 0, readCalls: 0, postCalls: 0, readBeforeConfirm: false, posted: null };
  let confirmed = false;
  return {
    rec,
    seams: {
      salt: SALT,
      confirm: async () => {
        rec.confirmCalls++;
        confirmed = opts.allow !== false;
        return confirmed;
      },
      read: async () => {
        rec.readCalls++;
        if (!confirmed) rec.readBeforeConfirm = true;
        return opts.read ?? { ok: true, values: SECRETS };
      },
      post: async (secrets) => {
        rec.postCalls++;
        rec.posted = secrets;
        const p = opts.post ?? VERIFIED;
        return typeof p === "function" ? p() : p;
      },
    },
  };
}

/** Everything the run said out loud, as one string. The leak sweep's subject. */
function spokenLog(): string {
  return JSON.stringify(getLogSink());
}

function expectNoSecretIn(text: string): void {
  for (const secret of [VENDOR, ACCESS, SECRET]) {
    expect(text).not.toContain(secret);
    // Substrings too: a truncated "first 8 characters" of a key is still a key's first 8 characters.
    for (let n = 4; n <= secret.length; n++) expect(text).not.toContain(secret.slice(0, n));
  }
}

beforeEach(() => clearLogSink());

describe("a person decides first, and the order is a property of the flow", () => {
  it("does not read before the confirmation resolves true", async () => {
    const { seams: s, rec } = seams({});
    await handOffCoupangCredential(s);
    expect(rec.readBeforeConfirm).toBe(false);
    expect(rec.confirmCalls).toBe(1);
  });

  it("a refusal reads NOTHING and sends NOTHING", async () => {
    const { seams: s, rec } = seams({ allow: false });
    const record = await handOffCoupangCredential(s);
    expect(record.outcome).toBe("NOT_ALLOWED");
    expect(rec.readCalls).toBe(0);
    expect(rec.postCalls).toBe(0);
    expect(record.evidence).toEqual([]);
  });

  it("asks exactly once — a refused barrier is not re-asked until it says yes", async () => {
    const { seams: s, rec } = seams({ allow: false });
    await handOffCoupangCredential(s);
    expect(rec.confirmCalls).toBe(1);
  });
});

describe("what stops the run before anything is transmitted", () => {
  it("an unresolved screen never reaches the POST, and carries the in-page reason", async () => {
    const { seams: s, rec } = seams({ read: { ok: false, reason: "CELL_NOT_UNIQUE", id: "secret_key" } });
    const record = await handOffCoupangCredential(s);
    expect(record).toMatchObject({ outcome: "READ_REFUSED", readRefusal: "CELL_NOT_UNIQUE", readRefusalId: "secret_key" });
    expect(rec.postCalls).toBe(0);
  });

  it("three cells holding one string are read, and then NOT sent", async () => {
    const same = { vendor_id: ACCESS, access_key: ACCESS, secret_key: ACCESS };
    const { seams: s, rec } = seams({ read: { ok: true, values: same } });
    const record = await handOffCoupangCredential(s);
    expect(record.outcome).toBe("VALUES_NOT_DISTINCT");
    expect(rec.postCalls).toBe(0);
    // The evidence still exists — the run can say WHAT it saw without saying what the value was.
    expect(record.evidence).toHaveLength(3);
  });

  it("a throwing transport is a STORE_FAILED, and the thrown error is not inspected or re-raised", async () => {
    const { seams: s } = seams({
      post: async () => {
        throw new Error(`connect ECONNREFUSED while sending ${SECRET}`);
      },
    });
    const record = await handOffCoupangCredential(s);
    expect(record.outcome).toBe("STORE_FAILED");
    // The classic leak: an error message quoting the request it failed on, printed by a caller that logs errors.
    expectNoSecretIn(JSON.stringify(record) + spokenLog());
  });

  it("a backend that refuses carries its safe reason and stores nothing", async () => {
    const { seams: s } = seams({ post: { stored: false, connectionStatus: "FAILED", connectionReason: "HTTP_409" } });
    const record = await handOffCoupangCredential(s);
    expect(record).toMatchObject({ outcome: "STORE_FAILED", connectionReason: "HTTP_409" });
  });
});

describe("the successful path", () => {
  it("stores and verifies, and hands the POST exactly the three values it read", async () => {
    const { seams: s, rec } = seams({});
    const record = await handOffCoupangCredential(s);
    expect(record).toMatchObject({ outcome: "STORED_AND_VERIFIED", connectionStatus: "SUCCESS" });
    expect(rec.posted).toEqual(SECRETS);
    expect(rec.postCalls).toBe(1);
  });

  it("a stored credential whose check did not pass is NOT reported as verified", async () => {
    const { seams: s } = seams({
      post: { stored: true, connectionStatus: "FAILED", connectionReason: "CALL_ENVIRONMENT_MISMATCH" },
    });
    const record = await handOffCoupangCredential(s);
    expect(record).toMatchObject({
      outcome: "STORED_NOT_VERIFIED",
      connectionStatus: "FAILED",
      connectionReason: "CALL_ENVIRONMENT_MISMATCH",
    });
  });
});

describe("containment — the sweep", () => {
  it("no value, and no substring of one, in the returned record on the success path", async () => {
    const { seams: s } = seams({});
    const record = await handOffCoupangCredential(s);
    expectNoSecretIn(JSON.stringify(record));
  });

  it("no value in anything the run logged, on ANY path", async () => {
    for (const opts of [
      {},
      { allow: false },
      { read: { ok: false, reason: "CELL_EMPTY", id: "access_key" } as CredentialReadResult },
      { read: { ok: true, values: { vendor_id: ACCESS, access_key: ACCESS, secret_key: ACCESS } } as CredentialReadResult },
      { post: { stored: false, connectionStatus: "FAILED", connectionReason: "HTTP_500" } },
    ]) {
      clearLogSink();
      await handOffCoupangCredential(seams(opts).seams);
      expectNoSecretIn(spokenLog());
    }
  });

  it("the record's own type has no field that could hold one — checked by construction on the widest path", async () => {
    const { seams: s } = seams({});
    const record = await handOffCoupangCredential(s);
    // Every string in the record, flattened. If a value were carried anywhere it would be one of these.
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(record);
    for (const s2 of strings) {
      expect([VENDOR, ACCESS, SECRET]).not.toContain(s2);
    }
  });
});
