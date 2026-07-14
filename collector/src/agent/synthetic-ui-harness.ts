/**
 * **Synthetic Action Window UI-verification harness (DEV/TEST ONLY).**
 *
 * A production-refused, connection-free, browser-free agent that hosts ONE synthetic Action Window run
 * over the real Local Agent Bridge so an operator can run the manual FE browser-UI protocol
 * (`docs/workstreams/action-window-frontend/live-verification-protocol.md`) end-to-end. Unlike the
 * production `local-agent.ts` boot — which requires a `--connections` config and LIVE-BOOTs a real Chrome
 * per browser connection — this harness needs no connections file, launches no browser, and touches no
 * marketplace: it stands up a `BridgeServer` (auto-approve pairing, DEV) + `ActionWindowEndpoint` +
 * `ActionWindowSession` driven by the `SyntheticProbeDriver`.
 *
 * Alongside the Bridge it exposes a SEPARATE **loopback control server** so the operator can deterministically
 * drive the FE's connection states — the piece the shipped agent lacked (checkpoint completion, a real socket
 * drop, and pausing / rehosting under the SAME or a DIFFERENT run id):
 *   - `POST /control/complete-user-action` → advance the synthetic human checkpoint;
 *   - `POST /control/drop-socket`           → force-close attached FE sockets (a real drop → FE reconnecting);
 *   - `POST /control/host {runId?, up?}`     → set the announced run id and pause/resume announcing
 *                                              (`up:false` = agent "down" → FE offline; a NEW `runId` while a
 *                                              session is live → FE reconnect settles offline, never spliced);
 *   - `GET  /control/status`                 → sanitized `{ runId, announcing, attachedClients }`.
 *
 * Refused under `NODE_ENV=production` (both here and by the Bridge's own auto-approve guard). Loopback only.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { BridgeServer } from "../bridge/bridge-server";
import { FilePairingStore } from "../bridge/pairing-store";
import { ActionWindowEndpoint } from "../bridge/action-window-endpoint";
import { ActionWindowEngine } from "../action-window/engine";
import { ActionWindowSession, SyntheticProbeDriver } from "../action-window/session";
import { parseAllowedOrigins } from "../bridge/origin-policy";
import { log } from "../log";

export const DEFAULT_BRIDGE_PORT = 47615;
export const DEFAULT_CONTROL_PORT = 47616;
const AGENT_VERSION = "0.0.1-poc-synthetic-ui-harness";
/** DEV default allow-list (Vite dev server). Override with `BRIDGE_ALLOWED_ORIGINS`. */
const DEV_DEFAULT_ORIGINS = "http://localhost:5173 http://127.0.0.1:5173";
const SYNTHETIC_CHANNEL = "synthetic";
const RUN_COPY_KEY = "actionWindow.run.synthetic";
const LOOPBACK = "127.0.0.1";
const MAX_CONTROL_BODY_BYTES = 4096;

export interface SyntheticUiHarnessConfig {
  bridgePort: number;
  controlPort: number;
  allowedOrigins: string[];
  pairingFile: string;
  runId: string;
  channelCode: string;
  now?: () => number;
}

export type ResolveResult =
  | { ok: true; config: SyntheticUiHarnessConfig }
  | { ok: false; error: string };

/** PURE config resolution. Refuses `NODE_ENV=production`; needs NO connections file and NO browser env. */
export function resolveSyntheticUiHarnessConfig(
  env: NodeJS.ProcessEnv,
  opts: { pairingFile: string; runId: string },
): ResolveResult {
  if (env.NODE_ENV === "production") {
    return { ok: false, error: "synthetic-ui-harness-refused-in-production" };
  }
  const bridgePort = env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : DEFAULT_BRIDGE_PORT;
  if (!isValidPort(bridgePort)) return { ok: false, error: "invalid-bridge-port" };
  const controlPort = env.AW_UI_HARNESS_CONTROL_PORT ? Number(env.AW_UI_HARNESS_CONTROL_PORT) : DEFAULT_CONTROL_PORT;
  if (!isValidPort(controlPort)) return { ok: false, error: "invalid-control-port" };
  if (controlPort === bridgePort) return { ok: false, error: "control-port-conflicts-with-bridge-port" };
  const allowedOrigins = parseAllowedOrigins(env.BRIDGE_ALLOWED_ORIGINS ?? DEV_DEFAULT_ORIGINS);
  if (allowedOrigins.length === 0) return { ok: false, error: "no-allowed-origins" };
  return {
    ok: true,
    config: {
      bridgePort,
      controlPort,
      allowedOrigins,
      pairingFile: opts.pairingFile,
      runId: opts.runId,
      channelCode: SYNTHETIC_CHANNEL,
    },
  };
}

function isValidPort(p: number): boolean {
  return Number.isInteger(p) && p > 0 && p <= 65535;
}

export interface RunningSyntheticUiHarness {
  readonly bridgePort: number;
  readonly controlPort: number;
  hostedRunId(): string;
  close(): Promise<void>;
  /** Test-only handles for driving/inspecting the hosted run without going through HTTP. */
  readonly endpoint: ActionWindowEndpoint;
  readonly driver: SyntheticProbeDriver;
  readonly session: ActionWindowSession;
  readonly bridge: BridgeServer;
}

/** Stand up the Bridge (synthetic AW session) + the loopback control server. Loopback only. */
export async function startSyntheticUiHarness(config: SyntheticUiHarnessConfig): Promise<RunningSyntheticUiHarness> {
  const now = config.now ?? (() => Date.now());
  const store = new FilePairingStore(config.pairingFile, { now });
  const driver = new SyntheticProbeDriver();
  const endpoint = new ActionWindowEndpoint({ runId: config.runId, channelCode: config.channelCode });
  const engine = new ActionWindowEngine({ runId: config.runId, channelCode: config.channelCode, runCopyKey: RUN_COPY_KEY });
  const session = new ActionWindowSession(engine, driver, endpoint.transport);
  session.attach();

  const bridge = new BridgeServer({
    store,
    allowedOrigins: config.allowedOrigins,
    agentVersion: AGENT_VERSION,
    port: config.bridgePort,
    autoApprovePairing: true, // DEV harness — the Bridge itself refuses this under NODE_ENV=production
    actionWindow: endpoint,
  });
  const bridgeListen = await bridge.listen();

  const control = createControlServer({ endpoint, driver });
  const controlPort = await listen(control, config.controlPort);

  log("aw_ui_harness_listening", { bridgePort: bridgeListen.port, controlPort });

  return {
    bridgePort: bridgeListen.port,
    controlPort,
    endpoint,
    driver,
    session,
    bridge,
    hostedRunId: () => endpoint.hostedRunId(),
    close: async () => {
      await closeServer(control);
      await bridge.close();
    },
  };
}

// ── Loopback control server ────────────────────────────────────────────────────────────────────────
function createControlServer(deps: { endpoint: ActionWindowEndpoint; driver: SyntheticProbeDriver }): Server {
  const { endpoint, driver } = deps;
  return createServer((req, res) => {
    void handleControl(req, res, endpoint, driver);
  });
}

async function handleControl(
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: ActionWindowEndpoint,
  driver: SyntheticProbeDriver,
): Promise<void> {
  const method = req.method ?? "GET";
  const path = (req.url ?? "").split("?")[0];

  if (method === "GET" && path === "/control/status") {
    return sendJson(res, 200, {
      runId: endpoint.hostedRunId(),
      announcing: endpoint.isAnnouncing(),
      attachedClients: endpoint.clientCount(),
    });
  }

  if (method === "POST" && path === "/control/complete-user-action") {
    const body = await readJson(req);
    const observed = typeof body?.observed === "boolean" ? body.observed : true;
    driver.completeUserAction(observed);
    return sendJson(res, 200, { ok: true, observed });
  }

  if (method === "POST" && path === "/control/drop-socket") {
    const dropped = endpoint.dropClientSockets();
    return sendJson(res, 200, { ok: true, dropped });
  }

  if (method === "POST" && path === "/control/host") {
    const body = await readJson(req);
    if (typeof body?.runId === "string" && body.runId.length > 0) endpoint.setHostedRun(body.runId);
    const up = typeof body?.up === "boolean" ? body.up : true;
    endpoint.setAnnouncing(up);
    return sendJson(res, 200, { ok: true, runId: endpoint.hostedRunId(), announcing: endpoint.isAnnouncing() });
  }

  return sendJson(res, 404, { error: "not_found" });
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_CONTROL_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
