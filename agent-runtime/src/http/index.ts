/**
 * Public surface of the Agent Runtime HTTP layer — the service, server, contract, config, and
 * store provider. Imported by the bootstrap entry ({@link ./main}) and by the contract/integration
 * tests.
 */
export { AgentRunService } from "./AgentRunService";
export type { AgentRunServiceDeps, SpringClientBundle, SpringClientFactory } from "./AgentRunService";

export { createHttpServer } from "./server";

export { HttpError, toHttpError, errorBody } from "./errors";
export type { HttpErrorBody } from "./errors";

export { StartRunRequestSchema, ResumeRunRequestSchema } from "./contract";
export type {
  AgentRunDomain,
  AgentRunStatus,
  AgentRunView,
  CapabilitiesView,
  CheckpointView,
  HealthView,
  InquiryCheckpointView,
  ResumeRunRequest,
  ReviewCheckpointView,
  StartRunRequest,
} from "./contract";

export { SERVICE_VERSION, loadConfig } from "./config";
export type { RuntimeConfig, RuntimeEnv, RunStoreKind } from "./config";

export { RunStoreProvider, ProductionStoreNotConfiguredError, scopeFor } from "./runStoreProvider";
export type { RunStores } from "./runStoreProvider";

export { defaultSpringClientFactory } from "./springClientFactory";
