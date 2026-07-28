/**
 * **Pilot runtime — stable per-user data root (pure).**
 *
 * A pilot agent is installed once and then *updated* in place. If the seller's NAVER login, the pairing that
 * lets SellerOps talk to the agent, and the agent's settings all lived inside the install tree, every update
 * that replaced that tree would silently log the seller out and un-pair them — the single worst first
 * impression a "set it and forget it" helper can make. So the runtime keeps two roots strictly apart:
 *
 *  - the **install root** — the code, replaced wholesale on update, owns nothing durable;
 *  - the **data root** — the seller's persistent state (browser profiles, pairing store, settings, logs,
 *    diagnostics), under the OS's per-user application-data location, untouched by an update.
 *
 * This module resolves the data root and its sub-paths per platform, so an update preserves the profile and
 * settings by construction (task: "업데이트 시 profile·설정 보존"). It is a pure leaf: the platform, environment
 * and home directory are all parameters, so the resolution is fully unit-testable without reading real env or
 * touching a real filesystem. No directory is created here — a caller (the boot) does that with `ensureDataDirs`.
 *
 * Nothing here is logged or emitted: a path is not sanitized output. The caller that mkdirs these directories
 * never prints them; only the boolean fact that a directory exists ever reaches a log.
 */

import { mkdirSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import path from "node:path";

/**
 * The path flavor for a platform — `win32` separators for Windows, `posix` otherwise — so a resolver
 * parameterized by platform is correct on the Windows *target* and deterministic in a test that runs on a
 * different host. Using the host's `node:path` would make a Windows path resolve wrong on a macOS CI runner.
 */
function pathFor(platform: string): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * The full set of directories the runtime owns under the data root. Every one lives UNDER `dataRoot`, so a
 * single "preserve the data root" rule on update keeps all of them.
 */
export interface RuntimePaths {
  /** The per-user data root — the one directory an update must preserve. */
  readonly dataRoot: string;
  /** Base dir for account-scoped Chrome profiles (`<channel>-agent-<hash>` leaves live here). */
  readonly profilesDir: string;
  /** Sanitized agent logs (metadata-only; never bodies/secrets). */
  readonly logsDir: string;
  /** Runtime control files: the single-instance lock and the owned-process registry. */
  readonly runDir: string;
  /** Agent settings + one-time consent record (never a credential). */
  readonly configDir: string;
  /** Where a sanitized diagnostics export is written on request. */
  readonly diagnosticsDir: string;
  /** Where a captured export lands before ingest (managed, seller-named copy). */
  readonly downloadsDir: string;
  /** The durable bridge pairing store file (moved out of the install tree so an update keeps the pairing). */
  readonly pairingFile: string;
}

/** Inputs for the pure resolver — every OS fact is a parameter, so the resolution is deterministic in a test. */
export interface RuntimePathsInput {
  /** Usually `process.platform` (`"win32"` | `"darwin"` | `"linux"` | …). */
  readonly platform: string;
  /** Usually `process.env`. Only application-data vars are read; a missing var falls back to the home dir. */
  readonly env: NodeJS.ProcessEnv;
  /** Usually `os.homedir()`. A parameter so tests never depend on the runner's real home. */
  readonly homedir: string;
}

/** The vendor/app segment every platform nests the data root under, so it never collides with other apps. */
const VENDOR_SEGMENT = "SellerOps";
const APP_SEGMENT = "Agent";

/**
 * Resolve the per-user data root for a platform. An explicit `SELLEROPS_AGENT_DATA_DIR` always wins — it is how
 * a custom install location, or a test, pins the root — otherwise the OS convention is used:
 *
 *  - **Windows**: `%LOCALAPPDATA%` (per-user, non-roaming — a browser profile must not roam) → `…\SellerOps\Agent`.
 *    Falls back to `%APPDATA%`, then `<home>\AppData\Local`, so a stripped environment still resolves.
 *  - **macOS**: `<home>/Library/Application Support/SellerOps/Agent`.
 *  - **Linux / other**: `$XDG_DATA_HOME` or `<home>/.local/share`, then `/SellerOps/Agent`.
 *
 * Always absolute (`resolve`), so a relative env value cannot scatter state under the process's cwd.
 */
export function resolveRuntimeDataRoot(input: RuntimePathsInput): string {
  // An operator-supplied override is trusted as-is (only trimmed): forcing it through a path module would
  // rewrite separators against the wrong flavor when a test simulates another platform.
  const override = input.env.SELLEROPS_AGENT_DATA_DIR?.trim();
  if (override) return override;

  const p = pathFor(input.platform);
  if (input.platform === "win32") {
    const base =
      input.env.LOCALAPPDATA?.trim() ||
      input.env.APPDATA?.trim() ||
      p.join(input.homedir, "AppData", "Local");
    return p.join(base, VENDOR_SEGMENT, APP_SEGMENT);
  }
  if (input.platform === "darwin") {
    return p.join(input.homedir, "Library", "Application Support", VENDOR_SEGMENT, APP_SEGMENT);
  }
  const xdg = input.env.XDG_DATA_HOME?.trim() || p.join(input.homedir, ".local", "share");
  return p.join(xdg, VENDOR_SEGMENT, APP_SEGMENT);
}

/** Resolve the whole path set from a data root. Sub-paths are fixed leaf names, so they are stable across updates. */
export function runtimePathsFrom(dataRoot: string, platform: string = process.platform): RuntimePaths {
  const p = pathFor(platform);
  const root = dataRoot;
  return {
    dataRoot: root,
    profilesDir: p.join(root, "profiles"),
    logsDir: p.join(root, "logs"),
    runDir: p.join(root, "run"),
    configDir: p.join(root, "config"),
    diagnosticsDir: p.join(root, "diagnostics"),
    downloadsDir: p.join(root, "downloads"),
    pairingFile: p.join(root, "run", "pairings.json"),
  };
}

/** Convenience: resolve the full path set for a platform/env/home in one call. */
export function resolveRuntimePaths(input: RuntimePathsInput): RuntimePaths {
  return runtimePathsFrom(resolveRuntimeDataRoot(input), input.platform);
}

/** Resolve the runtime paths for the CURRENT process (reads `process.platform`/`process.env`/`os.homedir()`). */
export function currentRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  return resolveRuntimePaths({ platform: process.platform, env, homedir: osHomedir() });
}

/**
 * Create every data directory (recursive, idempotent). Best-effort per directory is deliberately NOT used: a
 * data root the agent cannot create is a real, actionable fault (a bad `SELLEROPS_AGENT_DATA_DIR`, a
 * permissions problem) that the self-check surfaces — swallowing it would strand the seller with a silent
 * failure later. The `pairingFile`'s directory is `runDir`, already in the list, so the file itself is not
 * pre-created here (the pairing store writes it atomically when a pairing is first stored).
 */
export function ensureDataDirs(paths: RuntimePaths): void {
  for (const dir of [
    paths.dataRoot,
    paths.profilesDir,
    paths.logsDir,
    paths.runDir,
    paths.configDir,
    paths.diagnosticsDir,
    paths.downloadsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}
