/**
 * Bootstrap entry for the Agent Runtime HTTP service.
 *
 *   1. load env config
 *   2. resolve the durable run stores — FAILS CLOSED if APP_ENV=production on a single-instance store
 *   3. build the service with the production Spring-client factory
 *   4. start the HTTP server
 *
 * Run: `npm run serve` (tsx) or `node dist/http/main.js` (built). See `.env.example` / the Dockerfile
 * for the env knobs.
 */
import { loadConfig } from "./config";
import { RunStoreProvider } from "./runStoreProvider";
import { defaultSpringClientFactory } from "./springClientFactory";
import { AgentRunService } from "./AgentRunService";
import { createHttpServer } from "./server";
import { log } from "../log";

function main(): void {
  const config = loadConfig();
  // Throws ProductionStoreNotConfiguredError before any port is opened if the store is unsafe here.
  const storeProvider = new RunStoreProvider(config);
  const service = new AgentRunService({
    storeProvider,
    clientFactory: defaultSpringClientFactory(config.backendBaseUrl),
    env: config.env,
  });
  const server = createHttpServer(service, config);

  server.listen(config.port, () => {
    log("agent_runtime_listening", {
      port: config.port,
      env: config.env,
      runStore: storeProvider.kind,
      durable: storeProvider.durable,
      corsOrigins: config.corsAllowedOrigins.length,
    });
  });

  // Graceful shutdown: stop accepting new connections, let in-flight requests drain, then exit. A
  // bounded timeout forces exit so a hung keep-alive connection can't block the deploy; a second
  // signal short-circuits to an immediate exit.
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      log("agent_runtime_shutdown_forced", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    log("agent_runtime_shutdown", { signal });
    const timer = setTimeout(() => {
      log("agent_runtime_shutdown_timeout", { signal });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
