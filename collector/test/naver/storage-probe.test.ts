import { describe, expect, it } from "vitest";
import {
  diffStorageKeyNames,
  extractStorageSignals,
  SANITIZED_STORAGE_GROUP_KEYS,
  SANITIZED_STORAGE_KEY_KEYS,
  STORAGE_KEY_NAME_DIFF_KEYS,
  type RawStorageInput,
} from "../../src/naver/storage-probe";

const SALT = "fixed-synthetic-salt-AB";

// Synthetic hostile snapshot — every NAME and VALUE carries a string that must NOT
// appear in the sanitized output (PII, tokens, store/account ids, raw URL). Inlined
// (not a fixture file) so no real data can ever be parked here.
const HOSTILE_STRINGS = [
  "달빛코스메틱", // store/brand name
  "홍길동", // person name
  "seller-admin@example-store.co.kr",
  "SECRETTOKEN12345", // token-like VALUE
  "SELLER-7788", // seller id
  "channel-9988-store", // channel/store id in a key NAME
  "ncp_session_abc", // session value
  "store_550022", // store id in a value
  "https://sell.smartstore.naver.com/#/review/search", // raw URL
  "nid.naver.com", // raw host
];

const HOSTILE_INPUT: RawStorageInput = {
  contextLabel: "A_same_session",
  originUrl: "https://sell.smartstore.naver.com/#/review/search?store=550022&channel=9988",
  salt: SALT,
  cookies: [
    {
      name: "NID_SES_channel-9988-store",
      value: "ncp_session_abc-SECRETTOKEN12345-very-long-session-value-blob",
      domain: ".naver.com",
      httpOnly: true,
      secure: true,
      expires: -1,
    },
    {
      name: "STORE_SELLER-7788",
      value: "store_550022-홍길동",
      domain: "sell.smartstore.naver.com",
      httpOnly: false,
      secure: true,
      expires: 1893456000,
    },
  ],
  localStorage: [
    { key: "commerce.account.달빛코스메틱", value: "SECRETTOKEN12345" },
    { key: "ui.theme", value: "dark" },
  ],
  sessionStorage: [{ key: "selectedStore.channel-9988-store", value: "store_550022" }],
  indexedDbNames: ["commerce-db-SELLER-7788", "keyval-store"],
};

describe("extractStorageSignals — sanitization (hostile snapshot)", () => {
  const signals = extractStorageSignals(HOSTILE_INPUT);
  const serialized = JSON.stringify(signals);

  it("output contains none of the raw PII / token / store-account / URL strings", () => {
    for (const s of HOSTILE_STRINGS) expect(serialized).not.toContain(s);
  });

  it("never leaks a raw key/cookie name or any value substring", () => {
    expect(serialized).not.toContain("NID_SES");
    expect(serialized).not.toContain("selectedStore");
    expect(serialized).not.toContain("commerce.account");
    expect(serialized).not.toContain("keyval-store");
    expect(serialized).not.toContain("dark"); // a localStorage value
    expect(serialized).not.toContain("smartstore"); // no raw host/URL fragment
  });

  it("never emits the salt", () => {
    expect(serialized).not.toContain(SALT);
  });

  it("emits ONLY allowed group keys and allowed per-key fields", () => {
    for (const g of signals.groups) {
      for (const k of Object.keys(g)) expect(SANITIZED_STORAGE_GROUP_KEYS).toContain(k);
      for (const key of g.keys) {
        for (const f of Object.keys(key)) expect(SANITIZED_STORAGE_KEY_KEYS).toContain(f);
      }
    }
  });

  it("a cookie entry never carries a `value` field — only a length bucket + flags", () => {
    const cookieGroups = signals.groups.filter((g) => g.storageType === "cookie");
    expect(cookieGroups.length).toBeGreaterThan(0);
    for (const g of cookieGroups) {
      for (const key of g.keys) {
        expect(key).not.toHaveProperty("value");
        expect(["empty", "tiny", "small", "medium", "large", "huge"]).toContain(key.valueLengthBucket);
        expect(typeof key.httpOnly).toBe("boolean");
        expect(typeof key.secure).toBe("boolean");
        expect(typeof key.isPersistent).toBe("boolean");
      }
    }
  });

  it("still extracts useful coarse structure (categories/buckets, not content)", () => {
    // localStorage / sessionStorage / indexedDB groups are always present at the page origin.
    const types = signals.groups.map((g) => g.storageType);
    expect(types).toContain("localStorage");
    expect(types).toContain("sessionStorage");
    expect(types).toContain("indexedDB");
    const page = "seller-center";
    expect(signals.groups.find((g) => g.storageType === "localStorage")?.originCategory).toBe(page);
  });
});

describe("extractStorageSignals — value length is bucketed only", () => {
  const mk = (len: number): RawStorageInput => ({
    contextLabel: "A_same_session",
    originUrl: "https://sell.smartstore.naver.com/#/review/search",
    salt: SALT,
    cookies: [],
    localStorage: [{ key: "k", valueLength: len }],
    sessionStorage: [],
    indexedDbNames: [],
  });
  const bucketOf = (len: number) =>
    extractStorageSignals(mk(len)).groups.find((g) => g.storageType === "localStorage")!.keys[0]!.valueLengthBucket;

  it("buckets value lengths empty/tiny/small/medium/large/huge", () => {
    expect(bucketOf(0)).toBe("empty");
    expect(bucketOf(40)).toBe("tiny");
    expect(bucketOf(500)).toBe("small");
    expect(bucketOf(5_000)).toBe("medium");
    expect(bucketOf(50_000)).toBe("large");
    expect(bucketOf(200_000)).toBe("huge");
  });

  it("uses a pre-measured valueLength without needing the value", () => {
    const out = extractStorageSignals(mk(5_000));
    expect(JSON.stringify(out)).not.toContain("5000"); // length is bucketed, never echoed
  });
});

describe("extractStorageSignals — key-name hashing & salt policy", () => {
  const base = (salt: string): RawStorageInput => ({
    contextLabel: "A_same_session",
    originUrl: "https://sell.smartstore.naver.com/#/review/search",
    salt,
    cookies: [],
    localStorage: [{ key: "selectedStore", valueLength: 10 }],
    sessionStorage: [],
    indexedDbNames: [],
  });
  const hashOf = (salt: string) =>
    extractStorageSignals(base(salt)).groups.find((g) => g.storageType === "localStorage")!.keys[0]!.keyNameHash;

  it("hashes are STABLE for the same name + same salt (A/B comparability)", () => {
    expect(hashOf(SALT)).toBe(hashOf(SALT));
  });

  it("hashes DIFFER when the salt differs", () => {
    expect(hashOf(SALT)).not.toBe(hashOf("a-different-salt"));
  });

  it("a hash is a short hex digest, not the raw name", () => {
    const h = hashOf(SALT);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain("selectedStore");
  });
});

describe("extractStorageSignals — coarse key-name categories", () => {
  const categoryOf = (key: string): string => {
    const out = extractStorageSignals({
      contextLabel: "A_same_session",
      originUrl: "https://sell.smartstore.naver.com/#/review/search",
      salt: SALT,
      cookies: [],
      localStorage: [{ key, valueLength: 1 }],
      sessionStorage: [],
      indexedDbNames: [],
    });
    return out.groups.find((g) => g.storageType === "localStorage")!.keys[0]!.keyNameCategory;
  };

  it("maps names to coarse categories without echoing them", () => {
    expect(categoryOf("XSRF-TOKEN")).toBe("csrf");
    expect(categoryOf("NID_SESSION")).toBe("session");
    expect(categoryOf("authToken")).toBe("auth");
    expect(categoryOf("selectedChannelStore")).toBe("store");
    expect(categoryOf("ui.theme.pref")).toBe("pref");
    expect(categoryOf("zzz_unknown_blob")).toBe("other");
  });
});

describe("diffStorageKeyNames — A/B set difference (bucketed, sanitized)", () => {
  const snapshot = (label: "A_same_session" | "B_cold", keys: string[]): ReturnType<typeof extractStorageSignals> =>
    extractStorageSignals({
      contextLabel: label,
      originUrl: "https://sell.smartstore.naver.com/#/review/search",
      salt: SALT,
      cookies: [],
      localStorage: keys.map((k) => ({ key: k, valueLength: 5 })),
      sessionStorage: [],
      indexedDbNames: [],
    });

  it("reports both / A-only / B-only by hashed name, as buckets only", () => {
    const a = snapshot("A_same_session", ["keep1", "keep2", "lostOnCold"]);
    const b = snapshot("B_cold", ["keep1", "keep2", "coldOnly"]);
    const diff = diffStorageKeyNames(a, b);
    const local = diff.find((d) => d.storageType === "localStorage")!;
    expect(local.bothCount).toBe("few"); // keep1 + keep2 = 2
    expect(local.aOnlyCount).toBe("one"); // lostOnCold
    expect(local.bOnlyCount).toBe("one"); // coldOnly
    // Output is only buckets + fixed enums.
    for (const d of diff) for (const f of Object.keys(d)) expect(STORAGE_KEY_NAME_DIFF_KEYS).toContain(f);
    expect(JSON.stringify(diff)).not.toContain("keep1");
  });

  it("different salts make everything look A-only/B-only (why salt must be shared)", () => {
    const a = extractStorageSignals({
      contextLabel: "A_same_session",
      originUrl: "https://sell.smartstore.naver.com/#/review/search",
      salt: "salt-A",
      cookies: [],
      localStorage: [{ key: "same", valueLength: 1 }],
      sessionStorage: [],
      indexedDbNames: [],
    });
    const b = extractStorageSignals({
      contextLabel: "B_cold",
      originUrl: "https://sell.smartstore.naver.com/#/review/search",
      salt: "salt-B",
      cookies: [],
      localStorage: [{ key: "same", valueLength: 1 }],
      sessionStorage: [],
      indexedDbNames: [],
    });
    const local = diffStorageKeyNames(a, b).find((d) => d.storageType === "localStorage")!;
    expect(local.bothCount).toBe("none"); // mismatched salt ⇒ no shared hashes
    expect(local.aOnlyCount).toBe("one");
    expect(local.bOnlyCount).toBe("one");
  });
});
