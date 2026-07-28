/**
 * **Approval-presenter wiring.** Locks WHERE presenter selection lives and what each host resolves to.
 *
 * Two properties matter:
 *  1. Selection happens ONLY in the real `local-agent.ts` boot path. `createAgentBridge` must NOT default a
 *     presenter — a default would hand a real native presenter to every embedder, so any suite pairing
 *     through the composition root on a macOS machine would pop a real dialog mid-run.
 *  2. `decideApprovalPresenter` is a PURE (env, platform) → kind decision, so every host combination is
 *     testable without spawning a process, touching a TTY, or putting a dialog on anyone's screen.
 */
import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { decideApprovalPresenter, createApprovalPresenterFor } from "../../src/cli/local-agent";
import { createAgentBridge } from "../../src/agent/agent-bridge";
import { nullApprovalPresenter } from "../../src/bridge/approval-presenter";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const DEV = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

describe("decideApprovalPresenter (pure host decision)", () => {
  it("production on macOS → the native dialog", () => {
    expect(decideApprovalPresenter(PROD, "darwin")).toBe("macos_native");
  });

  it("production on Windows → the native dialog (the pilot adapter — pairing no longer fails closed)", () => {
    expect(decideApprovalPresenter(PROD, "win32")).toBe("windows_native");
  });

  it("production on a host with no adapter yet → none (fail-closed)", () => {
    for (const platform of ["linux", "freebsd"]) {
      expect(decideApprovalPresenter(PROD, platform)).toBe("none");
    }
  });

  it("DEV → the TTY stderr presenter, on EVERY platform including macOS", () => {
    // Deliberate: a dev/test boot must never be able to put a native dialog on screen.
    for (const platform of ["darwin", "linux", "win32"]) {
      expect(decideApprovalPresenter(DEV, platform)).toBe("dev_tty_stderr");
    }
  });

  it("an unset NODE_ENV is treated as DEV, never as production", () => {
    expect(decideApprovalPresenter({} as NodeJS.ProcessEnv, "darwin")).toBe("dev_tty_stderr");
  });
});

describe("createApprovalPresenterFor", () => {
  it("`none` yields the always-unavailable fail-closed default", () => {
    expect(createApprovalPresenterFor("none")).toBe(nullApprovalPresenter);
    expect(createApprovalPresenterFor("none").available()).toBe(false);
  });

  it("builds a presenter for every kind without performing I/O", () => {
    for (const kind of ["macos_native", "windows_native", "dev_tty_stderr", "none"] as const) {
      const p = createApprovalPresenterFor(kind);
      expect(typeof p.available).toBe("function");
      expect(typeof p.present).toBe("function");
      // `available()` must be side-effect free — safe to call here; it spawns nothing and shows nothing.
      expect(typeof p.available()).toBe("boolean");
    }
  });

  it("production-off-macOS resolves end-to-end to an unavailable presenter", () => {
    const kind = decideApprovalPresenter(PROD, "linux");
    expect(createApprovalPresenterFor(kind).available()).toBe(false);
  });
});

describe("createAgentBridge must NOT default a presenter", () => {
  it("an un-wired composition root fails closed rather than inheriting a native dialog", async () => {
    const dir = mkdtempSync(join(tmpdir(), `agent-bridge-wiring-${randomUUID()}-`));
    const bridge = createAgentBridge({
      port: 0,
      allowedOrigins: ["http://localhost:5173"],
      pairingFile: join(dir, "pairings.json"),
      agentVersion: "test",
      refSalt: "test-salt",
      now: () => Date.now(),
      // NOTE: no approvalPresenter — this is the point of the test.
    });
    const listen = await bridge.listen();
    cleanups.push(async () => { await bridge.close(); rmSync(dir, { recursive: true, force: true }); });
    expect(listen.ok).toBe(true);
    const port = (listen as { ok: true; port: number }).port;

    // No presenter was injected, so the bridge must refuse to pair — NOT reach for a native dialog. If
    // `createAgentBridge` ever defaults one, this returns 200 here (and, on macOS, opens a real dialog).
    const res = await fetch(`http://127.0.0.1:${port}/bridge/pair/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
      body: JSON.stringify({ workspaceLabel: "w" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "approval_unavailable" });
  });
});
