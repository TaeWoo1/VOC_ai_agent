import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConnectionBindFromSignals } from "../../src/connection/onboarding";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import { createConnectionRegistry } from "../../src/connection/registry";
import { saveConnectionRegistryToFile, loadConnectionRegistryFromFile } from "../../src/connection/store";
import type { AccountFingerprintRawSignals } from "../../src/naver/account-fingerprint-adapter";

const NOW = "2026-06-18T00:00:00.000Z";
const LATER = "2026-06-18T03:00:00.000Z";
const COMMERCE = "FAKE_COMMERCE_ID_홍길동스토어_0001";
const OTHER = "FAKE_ACCOUNT_SCOPE_김철수_9999";
const ALIAS = "내 메인 스토어";

let dir: string;
let storeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conn-onboard-"));
  storeFile = join(dir, ".connections", "connections.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedPending(connectionId = "conn-1"): void {
  const reg = createConnectionRegistry([
    createPendingConnection({
      connectionId,
      platform: "NAVER_SMARTSTORE",
      userProvidedDisplayName: ALIAS,
      now: NOW,
    }),
  ]);
  saveConnectionRegistryToFile(storeFile, reg);
}

function signals(over: Partial<AccountFingerprintRawSignals> = {}): AccountFingerprintRawSignals {
  return {
    urlCategory: "seller-center",
    loggedInSignal: true,
    sellerShellSignal: true,
    commerceIdCandidate: COMMERCE,
    ...over,
  };
}

describe("runConnectionBindFromSignals — success", () => {
  it("binds a pending connection to CONNECTED on a resolvable commerce-id", () => {
    seedPending();
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals(),
      now: LATER,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.connectionStatus).toBe("CONNECTED");
    expect(out.result.sourceCategory).toBe("commerce-id");
    expect(out.result.statusState).toBe("CONNECTED");
    expect(out.result.updatedAt).toBe(LATER);
  });

  it("persists the bound fingerprint hash + category to the store", () => {
    seedPending();
    runConnectionBindFromSignals({ connectionId: "conn-1", storeFile, rawSignals: signals(), now: LATER });
    const conn = loadConnectionRegistryFromFile(storeFile).get("conn-1");
    expect(conn?.connectionStatus).toBe("CONNECTED");
    expect(conn?.boundStoreFingerprintHash).toBe(fingerprintHash(COMMERCE));
    expect(conn?.fingerprintSourceCategory).toBe("commerce-id");
  });

  it("result omits the raw token and the fingerprint hash", () => {
    seedPending();
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals(),
      now: LATER,
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(COMMERCE);
    expect(serialized).not.toMatch(/[0-9a-f]{64}/); // no hash
    expect(serialized).not.toContain(storeFile); // no file path
  });
});

describe("runConnectionBindFromSignals — failures (no bind)", () => {
  it("missing connection → connection-not-found", () => {
    seedPending("conn-1");
    const out = runConnectionBindFromSignals({
      connectionId: "conn-MISSING",
      storeFile,
      rawSignals: signals(),
      now: LATER,
    });
    expect(out).toEqual({ ok: false, errorCategory: "connection-not-found" });
  });

  it("empty connectionId → invalid-input", () => {
    seedPending();
    const out = runConnectionBindFromSignals({ connectionId: "  ", storeFile, rawSignals: signals(), now: LATER });
    expect(out).toEqual({ ok: false, errorCategory: "invalid-input" });
  });

  it("not logged in → fingerprint-not-resolvable (not-logged-in), no bind", () => {
    seedPending();
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals({ loggedInSignal: false }),
      now: LATER,
    });
    expect(out).toEqual({
      ok: false,
      errorCategory: "fingerprint-not-resolvable",
      reasonCategory: "not-logged-in",
    });
    // Unchanged on disk.
    expect(loadConnectionRegistryFromFile(storeFile).get("conn-1")?.connectionStatus).toBe(
      "PENDING_USER_LOGIN",
    );
  });

  it("missing seller context → fingerprint-not-resolvable (missing-seller-context), no bind", () => {
    seedPending();
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals({ commerceIdCandidate: null }),
      now: LATER,
    });
    expect(out).toEqual({
      ok: false,
      errorCategory: "fingerprint-not-resolvable",
      reasonCategory: "missing-seller-context",
    });
    expect(loadConnectionRegistryFromFile(storeFile).get("conn-1")?.boundStoreFingerprintHash).toBeNull();
  });

  it("ambiguous conflicting candidates → fingerprint-not-resolvable (ambiguous-seller-context), no bind", () => {
    seedPending();
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals({ commerceIdCandidate: COMMERCE, accountScopeCandidate: OTHER }),
      now: LATER,
    });
    expect(out).toEqual({
      ok: false,
      errorCategory: "fingerprint-not-resolvable",
      reasonCategory: "ambiguous-seller-context",
    });
    expect(loadConnectionRegistryFromFile(storeFile).get("conn-1")?.connectionStatus).toBe(
      "PENDING_USER_LOGIN",
    );
  });

  it("malformed store JSON → store-load-failed (no raw contents echoed)", () => {
    mkdirSync(dirname(storeFile), { recursive: true });
    writeFileSync(storeFile, "{ not json ", "utf8");
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals(),
      now: LATER,
    });
    expect(out).toEqual({ ok: false, errorCategory: "store-load-failed" });
  });

  it("conflicting raw synthetic identities never appear in errors/results", () => {
    seedPending();
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: signals({ commerceIdCandidate: COMMERCE, accountScopeCandidate: OTHER }),
      now: LATER,
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(COMMERCE);
    expect(serialized).not.toContain(OTHER);
    expect(serialized).not.toContain("홍길동");
    expect(serialized).not.toContain("김철수");
  });
});

describe("isolation + boundary", () => {
  it("writes only under the temp store file (no repo .connections / .status)", () => {
    seedPending();
    runConnectionBindFromSignals({ connectionId: "conn-1", storeFile, rawSignals: signals(), now: LATER });
    expect(existsSync(storeFile)).toBe(true);
    const onDisk = readFileSync(storeFile, "utf8");
    // Only the hash + alias are persisted; never the raw token.
    expect(onDisk).not.toContain(COMMERCE);
    expect(onDisk).toContain(fingerprintHash(COMMERCE));
    expect(onDisk).toContain(ALIAS);
  });

  it("the onboarding module imports no Playwright / browser; fs only via the store layer", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "connection", "onboarding.ts"),
      "utf8",
    );
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/chromium/i.test(imports)).toBe(false);
    // No direct fs import — persistence goes through ./store only.
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
  });
});
