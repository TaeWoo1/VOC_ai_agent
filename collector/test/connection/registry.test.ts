import { describe, expect, it } from "vitest";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import { completeManualAccountSelection } from "../../src/connection/workflow";
import {
  createConnectionRegistry,
  registryFromRecords,
} from "../../src/connection/registry";
import { toConnectionRecord } from "../../src/connection/record";
import type { CollectorConnection } from "../../src/connection/types";

const NOW = "2026-06-18T00:00:00.000Z";
const FAKE_RAW_IDENTITY = "FAKE_STORE_홍길동테스트_0001";
const ATTACKER = "<script>steal('PII_홍길동_010-0000-0000')</script>";

function conn(id: string): CollectorConnection {
  return createPendingConnection({
    connectionId: id,
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: `별칭-${id}`,
    now: NOW,
  });
}

function connected(id: string): CollectorConnection {
  return completeManualAccountSelection(
    conn(id),
    fingerprintHash(`${FAKE_RAW_IDENTITY}-${id}`),
    "commerce-id",
    `별칭-${id}`,
    NOW,
  );
}

describe("registry get/list/upsert/remove", () => {
  it("supports basic CRUD", () => {
    const reg = createConnectionRegistry([conn("a")]);
    expect(reg.get("a")?.connectionId).toBe("a");
    expect(reg.get("missing")).toBeUndefined();
    expect(reg.list()).toHaveLength(1);

    reg.upsert(conn("b"));
    expect(reg.list().map((c) => c.connectionId)).toEqual(["a", "b"]);

    // upsert replaces by id.
    reg.upsert({ ...conn("a"), userProvidedDisplayName: "다시" });
    expect(reg.get("a")?.userProvidedDisplayName).toBe("다시");
    expect(reg.list()).toHaveLength(2);

    expect(reg.remove("a")).toBe(true);
    expect(reg.remove("a")).toBe(false);
    expect(reg.list().map((c) => c.connectionId)).toEqual(["b"]);
  });

  it("copies the seed so later input mutation does not affect the registry", () => {
    const seed = [conn("a")];
    const reg = createConnectionRegistry(seed);
    seed.push(conn("zzz"));
    expect(reg.list()).toHaveLength(1);
  });
});

describe("registry apply", () => {
  it("applies an updater and stores the result", () => {
    const reg = createConnectionRegistry([conn("a")]);
    const next = reg.apply("a", (c) => ({ ...c, connectionStatus: "NEEDS_REAUTH" }));
    expect(next.connectionStatus).toBe("NEEDS_REAUTH");
    expect(reg.get("a")?.connectionStatus).toBe("NEEDS_REAUTH");
  });

  it("throws a sanitized error for a missing connection", () => {
    const reg = createConnectionRegistry();
    expect(() => reg.apply("nope", (c) => c)).toThrowError("registry: connection-not-found");
  });
});

describe("registry toRecords / fromRecords", () => {
  it("round-trips through records", () => {
    const reg = createConnectionRegistry([connected("a"), connected("b")]);
    const records = reg.toRecords();
    const result = registryFromRecords(records);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry.list()).toEqual(reg.list());
    }
  });

  it("rejects a malformed record with a sanitized category and no echoed raw value", () => {
    const good = toConnectionRecord(connected("a"));
    const bad = { ...toConnectionRecord(connected("b")), platform: ATTACKER };
    const result = registryFromRecords([good, bad]);
    expect(result).toEqual({ ok: false, errorCategory: "unknown-platform" });
    expect(JSON.stringify(result)).not.toContain(ATTACKER);
    expect(JSON.stringify(result)).not.toContain("PII_홍길동");
  });

  it("does not leak raw store identity in serialized records (only the hash + alias)", () => {
    const reg = createConnectionRegistry([connected("a")]);
    const serialized = JSON.stringify(reg.toRecords());
    expect(serialized).not.toContain(FAKE_RAW_IDENTITY);
    // The hash is present; the user alias is the only free-form string, by contract.
    expect(serialized).toContain(fingerprintHash(`${FAKE_RAW_IDENTITY}-a`));
    expect(serialized).toContain("별칭-a");
  });
});
