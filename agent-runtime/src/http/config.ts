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

/**
 * Which durable store backs runs:
 *  - `spring`: the backend-owned, org-isolated, optimistic-locked store — the ONLY kind allowed in
 *    production (durable + safe behind more than one replica);
 *  - `file`: a local single-instance JSON store — dev/proof only (survives restart, unsafe for >1 replica);
 *  - `memory`: same-process only — tests.
 */
export type RunStoreKind = "spring" | "file" | "memory";

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
  if (value === undefined || value === "") return "development";
  if (value === "production" || value === "test" || value === "development") return value;
  // Fail closed on a typo: silently downgrading `prod`/`PRODUCTION` to development would slip the
  // single-instance store past the production guard. An unrecognized APP_ENV is a hard error.
  throw new Error(`invalid APP_ENV="${value}" (expected one of: development, test, production)`);
}

function pickStoreKind(value: string | undefined): RunStoreKind {
  if (value === "spring" || value === "memory") return value;
  return "file";
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
