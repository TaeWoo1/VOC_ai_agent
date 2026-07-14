/**
 * **Synthetic Action Window UI-verification agent — DEV/TEST harness CLI.**
 *
 *   npm run action-window-ui-harness
 *   # or: npx tsx src/cli/action-window-ui-harness.ts
 *
 * Hosts ONE synthetic Action Window run over the real Local Agent Bridge so an operator can run the manual
 * browser-UI protocol (`docs/workstreams/action-window-frontend/live-verification-protocol.md`) against a
 * real paired agent — WITHOUT a `--connections` config, WITHOUT launching any browser, and WITHOUT touching
 * any marketplace (unlike the production `local-agent.ts` boot). It binds loopback only:
 *   - the Bridge on `BRIDGE_PORT` (default 47615, the FE's `VITE_BRIDGE_URL`), auto-approving pairing (DEV);
 *   - a control server on `AW_UI_HARNESS_CONTROL_PORT` (default 47616) exposing the loopback drive controls
 *     (checkpoint completion, socket drop, pause/resume + same/different run id) the shipped agent lacked.
 *
 * **Production-refused:** with `NODE_ENV=production` the process refuses to start (non-zero exit); the Bridge's
 * own auto-approve guard refuses too. Import is side-effect-free (`main()` runs only when invoked directly).
 *
 * See the protocol doc for the exact per-step recipe (which `curl` drives which step).
 */
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { log } from "../log";
import { resolveSyntheticUiHarnessConfig, startSyntheticUiHarness } from "../agent/synthetic-ui-harness";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..", "..");

/** Runtime-assigned opaque synthetic run id — never derived from any account/connection. */
function syntheticRunId(): string {
  return `run_synthetic_${randomBytes(6).toString("hex")}`;
}

async function main(): Promise<void> {
  const pairingFile = resolve(collectorRoot, ".bridge", "pairings.json");
  const resolution = resolveSyntheticUiHarnessConfig(process.env, { pairingFile, runId: syntheticRunId() });
  if (!resolution.ok) {
    console.error(JSON.stringify({ error: resolution.error }));
    process.exit(2);
    return;
  }

  const harness = await startSyntheticUiHarness(resolution.config);
  console.log(
    JSON.stringify({
      event: "AW_UI_HARNESS_LISTENING",
      bridgePort: harness.bridgePort,
      controlPort: harness.controlPort,
      runId: harness.hostedRunId(),
      controls: {
        completeUserAction: `POST http://127.0.0.1:${harness.controlPort}/control/complete-user-action`,
        dropSocket: `POST http://127.0.0.1:${harness.controlPort}/control/drop-socket`,
        host: `POST http://127.0.0.1:${harness.controlPort}/control/host  {"runId?":"<id>","up?":true|false}`,
        status: `GET  http://127.0.0.1:${harness.controlPort}/control/status`,
      },
    }),
  );

  let closed = false;
  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    log("aw_ui_harness_shutdown", {});
    await harness.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
