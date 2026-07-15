/**
 * **Local Agent Bridge — standalone DEV/TEST HARNESS** (slice `docs/slices/local-agent-bridge.md`).
 *
 *   tsx src/cli/bridge.ts [--dev-insecure-auto-approve]
 *
 * NOTE: In production the bridge is **owned by the real Local Agent** (`src/cli/local-agent.ts` →
 * `src/agent/agent-bridge.ts`), started once with the agent and fed real settled runtime state. This CLI is
 * only a standalone harness for developing/QA-ing the bridge surfaces WITHOUT booting the agent — it exposes
 * no real connection state (its snapshot is empty until events are injected in a test).
 *
 * G1 is pairing + observability only — this launches NO marketplace browser and performs no live action.
 * It binds ONLY loopback (127.0.0.1) on a stable documented port (default 47615, override `BRIDGE_PORT`),
 * persists pairing-token *hashes* to `.bridge/pairings.json` (gitignored, 0600), and refuses to start if a
 * bridge is already bound (single-instance — prevents duplicate agents silently competing).
 *
 * **Dev relaxation gate (slice §0.4).** `--dev-insecure-auto-approve` skips the human local pairing
 * confirmation. It is honored ONLY when `NODE_ENV !== "production"`; with `NODE_ENV=production` the flag is
 * refused and the process exits non-zero. Never ship it enabled.
 *
 * Import is side-effect-free (`main()` runs only when invoked directly).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { log } from "../log";
import { FilePairingStore } from "../bridge/pairing-store";
import { BridgeServer } from "../bridge/bridge-server";
import { parseAllowedOrigins } from "../bridge/origin-policy";
import { createStderrApprovalPresenter } from "../bridge/stderr-approval-presenter";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..", "..");

const DEFAULT_PORT = 47615;
const AGENT_VERSION = "0.0.1-poc";
/** Dev-convenience default allow-list (Vite dev server). Production MUST set BRIDGE_ALLOWED_ORIGINS. */
const DEV_DEFAULT_ORIGINS = "http://localhost:5173 http://127.0.0.1:5173";

const DEV_FLAG = "--dev-insecure-auto-approve";

export interface BridgeCliConfig {
  port: number;
  allowedOrigins: string[];
  pairingFile: string;
  autoApprovePairing: boolean;
}

/** PURE config resolution — decides the run parameters, incl. refusing the dev flag under production. */
export function resolveBridgeConfig(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { ok: true; config: BridgeCliConfig } | { ok: false; error: string } {
  const wantsDevAutoApprove = args.includes(DEV_FLAG);
  const isProduction = env.NODE_ENV === "production";
  if (wantsDevAutoApprove && isProduction) {
    return { ok: false, error: "dev-auto-approve-refused-in-production" };
  }
  const port = env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, error: "invalid-port" };
  }
  const allowedOrigins = parseAllowedOrigins(env.BRIDGE_ALLOWED_ORIGINS ?? DEV_DEFAULT_ORIGINS);
  if (allowedOrigins.length === 0) {
    return { ok: false, error: "no-allowed-origins" };
  }
  return {
    ok: true,
    config: {
      port,
      allowedOrigins,
      pairingFile: resolve(collectorRoot, ".bridge", "pairings.json"),
      autoApprovePairing: wantsDevAutoApprove && !isProduction,
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resolution = resolveBridgeConfig(args, process.env);
  if (!resolution.ok) {
    console.error(JSON.stringify({ error: resolution.error }));
    process.exit(2);
    return;
  }
  const { config } = resolution;

  const store = new FilePairingStore(config.pairingFile, { now: () => Date.now() });
  const server = new BridgeServer({
    store,
    allowedOrigins: config.allowedOrigins,
    agentVersion: AGENT_VERSION,
    port: config.port,
    autoApprovePairing: config.autoApprovePairing,
    // DEV human channel: shows the out-of-band approval code on THIS terminal. Unavailable (so pairing fails
    // closed) when stderr is redirected or under production — see `bridge/stderr-approval-presenter.ts`.
    approvalPresenter: createStderrApprovalPresenter(),
  });

  try {
    const { port } = await server.listen();
    console.log(JSON.stringify({ event: "BRIDGE_LISTENING", port, allowedOrigins: config.allowedOrigins, autoApprovePairing: config.autoApprovePairing }));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EADDRINUSE → a bridge is already bound: refuse rather than silently compete (single-instance).
    console.error(JSON.stringify({ error: code === "EADDRINUSE" ? "bridge-already-running" : "listen-failed", code }));
    process.exit(3);
    return;
  }

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    log("bridge_shutdown", {});
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
