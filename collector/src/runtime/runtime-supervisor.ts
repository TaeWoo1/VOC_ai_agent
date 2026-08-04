/**
 * **Pilot runtime supervisor — composition of the lifecycle pieces.**
 *
 * This ties the pure runtime modules into the one thing the boot calls: acquire the per-user data root, take
 * the single-instance lock (reaping a crashed prior run's orphans), and expose the owned-process registry and
 * a clean release. It is deliberately thin — every hard decision lives in a pure module with its own tests
 * (`runtime-paths`, `single-instance-lock`, `owned-process-registry`, `self-check`), so this file is mostly
 * wiring and the small platform probes (Chrome presence, directory writability) that feed the self-check.
 *
 * **Pilot vs dev.** The relocation + lock engage only in *pilot mode* (a packaged production agent, or an
 * explicit `SELLEROPS_PILOT_RUNTIME=1`). A dev/test boot is byte-for-byte unchanged: no data-root move, no
 * lock, so the existing suite and the many live CLIs behave exactly as before.
 */

import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import {
  ensureDataDirs,
  resolveRuntimePaths,
  type RuntimePaths,
} from "./runtime-paths";
import {
  acquireSingleInstanceLock,
  defaultLockAdapter,
  type LockAdapter,
} from "./single-instance-lock";
import {
  defaultProcessKiller,
  fileRegistryStore,
  OwnedProcessRegistry,
  type ProcessKiller,
  type TerminateOutcome,
} from "./owned-process-registry";
import { runtimeSelfCheck, type RuntimeSelfCheckInput, type RuntimeSelfCheckResult } from "./self-check";

/** Lock + registry file names under `run/`. */
export const AGENT_LOCK_FILE = "agent.lock";
export const OWNED_PROCESSES_FILE = "owned-processes.json";

/** True when the full pilot lifecycle (data-root relocation + single-instance lock) should engage. */
export function isPilotMode(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === "production") return true;
  const flag = env.SELLEROPS_PILOT_RUNTIME;
  return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
}

/**
 * Point the collector's profile/download/status/pairing locations at the durable data root, so an in-place
 * update preserves them. Uses `??=` semantics: an explicit operator override always wins. Mutates the given
 * env object (the boot passes `process.env`, so `resolveProfileDir` — which reads `process.env` — sees the
 * relocated base).
 */
export function applyPilotDataRootEnv(env: NodeJS.ProcessEnv, paths: RuntimePaths): void {
  const setDefault = (key: string, value: string): void => {
    if (env[key] === undefined || env[key] === "") env[key] = value;
  };
  setDefault("COLLECTOR_PROFILE_BASE_DIR", paths.profilesDir);
  setDefault("COLLECTOR_PROFILE_DIR", join(paths.profilesDir, "naver"));
  setDefault("COLLECTOR_ESM_PROFILE_DIR", join(paths.profilesDir, "esm"));
  setDefault("COLLECTOR_DOWNLOAD_DIR", paths.downloadsDir);
  setDefault("COLLECTOR_STATUS_FILE", join(paths.logsDir, "status.json"));
  setDefault("SELLEROPS_BRIDGE_PAIRING_FILE", paths.pairingFile);
}

/** Standard installed-Chrome locations per platform — the ADR mandates real Chrome, not bundled Chromium. */
const CHROME_PATHS: Readonly<Record<string, readonly string[]>> = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"],
};

/**
 * Is a Chrome the agent can drive present? With no configured channel the bundled Chromium ships with the
 * package, so it is always available; with a channel (e.g. `chrome`) a real install must exist. Best-effort:
 * an unknown platform with a channel set answers `true` rather than block a valid but unusual setup.
 */
export function browserChannelAvailable(
  channel: string | undefined,
  platform: string,
  fileExists: (p: string) => boolean = existsSync,
): boolean {
  if (!channel || channel.trim() === "") return true; // bundled Chromium
  const candidates = CHROME_PATHS[platform];
  if (!candidates) return true; // unknown platform — do not false-alarm
  return candidates.some((p) => fileExists(p));
}

/** Best-effort writability probe for a directory (the profile area must persist cookies). Never throws. */
export function isDirWritable(dir: string): boolean {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Assemble the self-check input from config facts + the small platform probes. Pure given its inputs. */
export function buildSelfCheckInput(opts: {
  appUrl: string;
  allowedOrigins: readonly string[];
  backendReachable: boolean;
  agentVersion: string;
  requiredAgentVersion?: string;
  reviewUrlPresent: boolean;
  browserChannel: string | undefined;
  platform: string;
  profilesDir: string;
  approvalChannelAvailable: boolean;
  fileExists?: (p: string) => boolean;
}): RuntimeSelfCheckInput {
  return {
    appUrl: opts.appUrl,
    allowedOrigins: opts.allowedOrigins,
    backendReachable: opts.backendReachable,
    agentVersion: opts.agentVersion,
    requiredAgentVersion: opts.requiredAgentVersion,
    reviewUrlPresent: opts.reviewUrlPresent,
    browserAvailable: browserChannelAvailable(opts.browserChannel, opts.platform, opts.fileExists),
    profileDirWritable: isDirWritable(opts.profilesDir),
    approvalChannelAvailable: opts.approvalChannelAvailable,
  };
}

/** The acquired pilot runtime. `releaseLock` drops the single-instance lock (idempotent). */
export interface PilotRuntime {
  readonly paths: RuntimePaths;
  readonly agentVersion: string;
  readonly ownedProcesses: OwnedProcessRegistry;
  /** True when this boot took over a crashed prior run's lock. */
  readonly lockRecovered: boolean;
  /** Sanitized tally of orphans reaped on takeover (counts only), or null when nothing was recovered. */
  readonly reapTally: Record<TerminateOutcome, number> | null;
  releaseLock(): void;
}

export type AcquirePilotResult =
  | { readonly ok: true; readonly runtime: PilotRuntime }
  | { readonly ok: false; readonly holderPid: number };

export interface AcquirePilotOptions {
  env: NodeJS.ProcessEnv;
  platform: string;
  homedir?: string;
  agentVersion: string;
  pid?: number;
  pgid?: number;
  /** Injected seams for tests. */
  lockAdapter?: LockAdapter;
  killer?: ProcessKiller;
}

/**
 * Acquire the pilot runtime: resolve + create the data root, relocate the collector's durable paths onto it,
 * then take the single-instance lock. A live holder → refuse (duplicate prevention). A dead holder → take
 * over AND reap its orphaned owned processes by exact pid before proceeding (crash recovery).
 */
export function acquirePilotRuntime(opts: AcquirePilotOptions): AcquirePilotResult {
  const homedir = opts.homedir ?? osHomedir();
  const paths = resolveRuntimePaths({ platform: opts.platform, env: opts.env, homedir });
  ensureDataDirs(paths);
  applyPilotDataRootEnv(opts.env, paths);

  const pid = opts.pid ?? process.pid;
  const pgid = opts.pgid ?? pid;
  const lock = acquireSingleInstanceLock(
    join(paths.runDir, AGENT_LOCK_FILE),
    { pid, pgid, agentVersion: opts.agentVersion },
    opts.lockAdapter ?? defaultLockAdapter(),
  );
  if (!lock.acquired) return { ok: false, holderPid: lock.holderPid };

  const killer = opts.killer ?? defaultProcessKiller(opts.platform, opts.env);
  const ownedProcesses = new OwnedProcessRegistry(
    fileRegistryStore(join(paths.runDir, OWNED_PROCESSES_FILE)),
    killer,
  );

  // On a crash takeover, the registry was rehydrated from the dead run's file — its current set IS the
  // orphans. `terminateAll("force")` reaps them by exact pid and clears the file, so this run starts clean.
  let reapTally: Record<TerminateOutcome, number> | null = null;
  if (lock.recovered) {
    reapTally = ownedProcesses.terminateAll("force");
  }

  return {
    ok: true,
    runtime: {
      paths,
      agentVersion: opts.agentVersion,
      ownedProcesses,
      lockRecovered: lock.recovered,
      reapTally,
      releaseLock: lock.release,
    },
  };
}

/** Run the self-check and return its result (thin pass-through kept here so the boot has one import). */
export function runtimeSelfCheckFor(input: RuntimeSelfCheckInput): RuntimeSelfCheckResult {
  return runtimeSelfCheck(input);
}
