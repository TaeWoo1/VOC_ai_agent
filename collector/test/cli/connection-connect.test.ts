import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseConnectionConnectArgs,
  runConnectionConnect,
} from "../../src/cli/connection";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import { createConnectionRegistry } from "../../src/connection/registry";
import { saveConnectionRegistryToFile, loadConnectionRegistryFromFile } from "../../src/connection/store";

const NOW = "2026-06-18T00:00:00.000Z";
const LATER = "2026-06-18T05:00:00.000Z";
const ALIAS = "내 메인 스토어";
const COMMERCE = "synthetic-commerce-id-홍길동-0001";
const ACCOUNT = "synthetic-account-scope-김철수-9999";
const SELLER_URL = "https://sell.smartstore.naver.com/#/safe-path?token=SECRET_QUERY";

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conn-connect-"));
  storeFile = join(dir, ".connections", "connections.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedPending(connectionId = "conn-1"): void {
  saveConnectionRegistryToFile(
    storeFile,
    createConnectionRegistry([
      createPendingConnection({
        connectionId,
        platform: "NAVER_SMARTSTORE",
        userProvidedDisplayName: ALIAS,
        now: NOW,
      }),
    ]),
  );
}

function probeJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    currentUrl: SELLER_URL,
    loggedInSignal: true,
    sellerShellSignal: true,
    commerceIdCandidate: COMMERCE,
    ...over,
  });
}

describe("parseConnectionConnectArgs", () => {
  it("parses a full connect invocation", () => {
    const r = parseConnectionConnectArgs([
      "connect",
      "--connection-id",
      "conn-1",
      "--store-file",
      "/tmp/x.json",
      "--probe-json",
      "{}",
    ]);
    expect(r).toEqual({
      ok: true,
      value: { connectionId: "conn-1", storeFile: "/tmp/x.json", probeJson: "{}" },
    });
  });

  it.each([
    [["init"], "unknown-command"],
    [["connect", "--probe-json", "{}"], "missing-connection-id"],
    [["connect", "--connection-id", "conn-1"], "missing-probe-json"],
  ] as const)("rejects %s", (args, expected) => {
    expect(parseConnectionConnectArgs(args)).toEqual({ ok: false, errorCategory: expected });
  });

  it("does not accept a live flag (no special handling for the approval flag)", () => {
    const r = parseConnectionConnectArgs([
      "connect",
      "--connection-id",
      "conn-1",
      "--probe-json",
      "{}",
      "--i-understand-this-opens-live-naver",
    ]);
    // The flag is simply ignored — connect has no live path.
    expect(r.ok).toBe(true);
  });
});

describe("runConnectionConnect — success", () => {
  it("binds a pending connection when the probe is resolvable", () => {
    seedPending();
    const out = runConnectionConnect({ connectionId: "conn-1", storeFile, probeJson: probeJson(), now: LATER });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.connectionStatus).toBe("CONNECTED");
    expect(out.result.sourceCategory).toBe("commerce-id");
    expect(out.result.statusState).toBe("CONNECTED");
  });

  it("persists the bound fingerprint hash + category", () => {
    seedPending();
    runConnectionConnect({ connectionId: "conn-1", storeFile, probeJson: probeJson(), now: LATER });
    const conn = loadConnectionRegistryFromFile(storeFile).get("conn-1");
    expect(conn?.connectionStatus).toBe("CONNECTED");
    expect(conn?.boundStoreFingerprintHash).toBe(fingerprintHash(COMMERCE));
    expect(conn?.fingerprintSourceCategory).toBe("commerce-id");
  });

  it("output omits raw token, fingerprint hash, raw URL, and store path", () => {
    seedPending();
    const out = runConnectionConnect({ connectionId: "conn-1", storeFile, probeJson: probeJson(), now: LATER });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(COMMERCE);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/); // no hash
    expect(serialized).not.toContain(SELLER_URL);
    expect(serialized).not.toContain("SECRET_QUERY");
    expect(serialized).not.toContain(storeFile);
  });
});

describe("runConnectionConnect — failures (no bind)", () => {
  it("capture failure (not logged in) → signal-capture-failed", () => {
    seedPending();
    const out = runConnectionConnect({
      connectionId: "conn-1",
      storeFile,
      probeJson: probeJson({ loggedInSignal: false }),
      now: LATER,
    });
    expect(out).toEqual({
      ok: false,
      errorCategory: "signal-capture-failed",
      reasonCategory: "not-logged-in",
    });
    expect(loadConnectionRegistryFromFile(storeFile).get("conn-1")?.connectionStatus).toBe(
      "PENDING_USER_LOGIN",
    );
  });

  it("missing seller context → fingerprint-not-resolvable (missing-seller-context)", () => {
    seedPending();
    const out = runConnectionConnect({
      connectionId: "conn-1",
      storeFile,
      probeJson: probeJson({ commerceIdCandidate: null }),
      now: LATER,
    });
    expect(out).toEqual({
      ok: false,
      errorCategory: "fingerprint-not-resolvable",
      reasonCategory: "missing-seller-context",
    });
  });

  it("ambiguous conflicting candidates → fingerprint-not-resolvable (ambiguous-seller-context), no bind", () => {
    seedPending();
    const out = runConnectionConnect({
      connectionId: "conn-1",
      storeFile,
      probeJson: probeJson({ accountScopeCandidate: ACCOUNT }),
      now: LATER,
    });
    expect(out).toEqual({
      ok: false,
      errorCategory: "fingerprint-not-resolvable",
      reasonCategory: "ambiguous-seller-context",
    });
    expect(loadConnectionRegistryFromFile(storeFile).get("conn-1")?.boundStoreFingerprintHash).toBeNull();
  });

  it("missing connection → connection-not-found", () => {
    seedPending("conn-1");
    const out = runConnectionConnect({
      connectionId: "conn-MISSING",
      storeFile,
      probeJson: probeJson(),
      now: LATER,
    });
    expect(out).toEqual({ ok: false, errorCategory: "connection-not-found" });
  });

  it("malformed --probe-json → invalid-probe-json and does not echo the input", () => {
    seedPending();
    const out = runConnectionConnect({
      connectionId: "conn-1",
      storeFile,
      probeJson: "{ not json SECRET_QUERY ",
      now: LATER,
    });
    expect(out).toEqual({ ok: false, errorCategory: "invalid-probe-json" });
    expect(JSON.stringify(out)).not.toContain("SECRET_QUERY");
  });

  it("conflicting raw synthetic identities never appear in errors", () => {
    seedPending();
    const out = runConnectionConnect({
      connectionId: "conn-1",
      storeFile,
      probeJson: probeJson({ accountScopeCandidate: ACCOUNT }),
      now: LATER,
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(COMMERCE);
    expect(serialized).not.toContain(ACCOUNT);
    expect(serialized).not.toContain("홍길동");
    expect(serialized).not.toContain("김철수");
  });
});

describe("isolation", () => {
  it("writes only under the temp store; persists hash (not raw token)", () => {
    seedPending();
    runConnectionConnect({ connectionId: "conn-1", storeFile, probeJson: probeJson(), now: LATER });
    expect(existsSync(storeFile)).toBe(true);
    const onDisk = readFileSync(storeFile, "utf8");
    expect(onDisk).not.toContain(COMMERCE);
    expect(onDisk).toContain(fingerprintHash(COMMERCE));
  });
});
