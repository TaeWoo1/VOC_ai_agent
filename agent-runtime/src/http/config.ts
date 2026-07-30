/**
 * Environment configuration for the Agent Runtime HTTP service.
 *
 * Every knob is an env var with a safe local-dev default, mirroring the backend's config
 * posture (no profiles, env-driven). Nothing here is a secret: the service holds NO channel
 * credential and NO JWT signing key — it only forwards the operator's bearer token to the
 * backend. `backendBaseUrl` is the one address it needs.
 */

/** Runtime environment. `production` is treated strictly by the run-store provider (fail-closed). */
export type RuntimeEnv = "development" | "production" | "test";

/** Which durable store backs runs. Only file/memory exist today; a production store is future work. */
export type RunStoreKind = "file" | "memory";

export interface RuntimeConfig {
  readonly port: number;
  /** Base URL of the Spring backend (system of record). Server-to-server; no CORS involved. */
  readonly backendBaseUrl: string;
  readonly env: RuntimeEnv;
  readonly runStoreKind: RunStoreKind;
  readonly runStoreDir: string;
  /** Browser origins allowed to call this service (the Vite frontend). */
  readonly corsAllowedOrigins: readonly string[];
}

/** The service version reported by /health and /capabilities. */
export const SERVICE_VERSION = "0.1.0-product-integration";

function pickEnv(value: string | undefined): RuntimeEnv {
  if (value === "production" || value === "test") return value;
  return "development";
}

function pickStoreKind(value: string | undefined): RunStoreKind {
  return value === "memory" ? "memory" : "file";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const origins = (env["AGENT_RUNTIME_CORS_ORIGINS"] ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return {
    port: Number(env["AGENT_RUNTIME_PORT"] ?? "8787"),
    backendBaseUrl: (env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080").replace(/\/+$/, ""),
    env: pickEnv(env["APP_ENV"]),
    runStoreKind: pickStoreKind(env["AGENT_RUNTIME_RUNSTORE_KIND"]),
    runStoreDir: env["AGENT_RUNTIME_RUNSTORE_DIR"] ?? "./.runstore",
    corsAllowedOrigins: origins,
  };
}
