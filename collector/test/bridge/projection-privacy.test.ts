import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { BridgeServer } from "../../src/bridge/bridge-server";
import { FilePairingStore } from "../../src/bridge/pairing-store";
import { ProjectionEndpoint } from "../../src/bridge/projection-endpoint";
import { ProjectionRegistry } from "../../src/bridge/projection-session";
import type { ProjectionSource } from "../../src/bridge/projection-hub";
import type { AdapterFrame } from "../../src/bridge/projection-adapter";
import { getLogSink, clearLogSink } from "../../src/log";

const APP = "http://localhost:5173";
const SRC = join(__dirname, "..", "..", "src", "bridge");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

class RecordingSource implements ProjectionSource {
  started = false;
  inputs: unknown[] = [];
  get isStarted(): boolean { return this.started; }
  get viewport(): { width: number; height: number } { return { width: 1280, height: 720 }; }
  async start(): Promise<void> { this.started = true; }
  async stop(): Promise<void> { this.started = false; }
  async dispatchInput(input: unknown): Promise<{ accepted: boolean }> { this.inputs.push(input); return { accepted: true }; }
}

async function start() {
  const dir = mkdtempSync(join(tmpdir(), `proj-priv-${randomUUID()}-`));
  const store = new FilePairingStore(join(dir, "pairings.json"), { now: () => Date.now() });
  let push: (f: AdapterFrame) => void = () => {};
  const endpoint = new ProjectionEndpoint({
    registry: new ProjectionRegistry({ now: () => Date.now() }),
    capabilities: { view: true, control: true, format: "jpeg", fps: 10 },
    initialTargetHandle: "aaaa1111bbbb2222",
    createSource: (onFrame) => { push = onFrame; return new RecordingSource(); },
  });
  const server = new BridgeServer({ store, allowedOrigins: [APP], agentVersion: "test", port: 0, autoApprovePairing: true, projection: endpoint });
  const { port } = await server.listen();
  cleanups.push(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
  return { port, pushFrame: (f: AdapterFrame) => push(f) };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: APP, ...headers }, body: JSON.stringify(body) });
}
async function tokenAndTicket(port: number): Promise<string> {
  const req = await (await post(port, "/bridge/pair/request", { workspaceLabel: "w" })).json();
  const token = (await (await post(port, "/bridge/pair/poll", { requestId: req.requestId })).json()).pairingToken;
  return (await (await post(port, "/projection/ticket", { clientProjectionVersion: 1 }, { Authorization: `Bearer ${token}` })).json()).ticket;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip // and /* *\/ comments so forbidden-token scans only see real code (per collector CLAUDE.md §5). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

describe("projection privacy — no frame bytes / secrets in logs", () => {
  it("logs only counters/ids — never frame bytes, typed text, tickets, or URLs", async () => {
    const { port, pushFrame } = await start();
    clearLogSink();
    const ticket = await tokenAndTicket(port);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/projection/ws?ticket=${ticket}`, { origin: APP });
    await new Promise((res) => ws.on("open", res));
    await wait(50);
    ws.send(JSON.stringify({ type: "request_control" }));
    await wait(30);
    const SECRET_TEXT = "zzsecrettypedzz";
    ws.send(JSON.stringify({ type: "input", input: { kind: "text", text: SECRET_TEXT } }));
    // a frame whose bytes are a recognizable pattern
    const marker = Buffer.alloc(400, 0xab);
    pushFrame({ seq: 5, bytes: marker, deviceWidth: 1280, deviceHeight: 720 });
    await wait(50);
    ws.close();

    const dump = JSON.stringify(getLogSink());
    expect(dump).not.toContain(ticket);
    expect(dump).not.toContain(SECRET_TEXT);
    expect(dump).not.toContain(marker.toString("base64"));
    expect(dump).not.toContain("abababab"); // frame byte pattern hex
    for (const bad of ["password", "cookie", "authorization", "secret", "credential", "http://", "file://"]) {
      expect(dump.toLowerCase()).not.toContain(bad);
    }
  });
});

describe("projection source guard — no marketplace / auto-login / navigation commands", () => {
  const files = [
    "projection-protocol.ts", "projection-session.ts", "projection-input.ts",
    "projection-adapter.ts", "projection-hub.ts", "projection-endpoint.ts",
  ];

  it("the adapter dispatches only screencast + Input.* CDP methods (no navigation/auto-login)", () => {
    const src = stripComments(readFileSync(join(SRC, "projection-adapter.ts"), "utf8"));
    const cdpCalls = [...src.matchAll(/cdp\.send\(\s*"([^"]+)"/g)].map((m) => m[1]!);
    const allowed = new Set(["Page.startScreencast", "Page.stopScreencast", "Page.screencastFrameAck", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText"]);
    for (const c of cdpCalls) expect(allowed.has(c)).toBe(true);
    // No navigation / target-goto / login / credential commands anywhere.
    for (const forbidden of ["Page.navigate", "Page.goto", ".goto(", "login", "credential", "password", "Runtime.evaluate", "Page.addScriptToEvaluate"]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("no marketplace domain, workflow, or auto-login token appears in any projection module", () => {
    for (const f of files) {
      const src = stripComments(readFileSync(join(SRC, f), "utf8")).toLowerCase();
      for (const bad of ["naver", "coupang", "cafe24", "gmarket", "11st", "ssg", "auto-login", "autologin", "startworkflow", "runworkflow"]) {
        expect(src.includes(bad)).toBe(false);
      }
    }
  });

  it("the pure modules import no fs/http/net/playwright", () => {
    for (const f of ["projection-protocol.ts", "projection-session.ts", "projection-input.ts", "projection-hub.ts"]) {
      const importLines = readFileSync(join(SRC, f), "utf8").split("\n").filter((l) => /^\s*import\s/.test(l));
      const joined = importLines.join("\n");
      for (const bad of ["node:fs", "node:http", "node:net", "playwright", "from \"ws\""]) {
        expect(joined.includes(bad)).toBe(false);
      }
    }
  });
});
