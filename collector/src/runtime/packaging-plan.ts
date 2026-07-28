/**
 * **Pilot runtime — packaging plan (pure).**
 *
 * The Windows install/update/uninstall scripts (`packaging/windows/*.ps1`) make three decisions that MUST be
 * right or a seller loses their NAVER login on the next update:
 *
 *  1. the **install root** (the code) is a DIFFERENT directory from the **data root** (profiles, pairing,
 *     settings) — the ADR keeps OS concerns behind a boundary, and here the boundary is literal: an update
 *     replaces the install root wholesale and must never touch the data root;
 *  2. auto-start is a **per-user login item** (a Startup-folder shortcut), never a system service — a headed
 *     Chrome the seller logs into has to run in their own interactive session, which a session-0 service is
 *     not;
 *  3. an uninstall removes the code and the login item but **preserves the profiles by default**, so an
 *     accidental uninstall/reinstall does not force a re-login.
 *
 * This module is the single source of truth for those paths + the update-safety invariant, mirrored by the
 * PowerShell scripts, and unit-tested here so the "data survives an update" guarantee is proven off-Windows.
 */

import path from "node:path";
import { resolveRuntimeDataRoot, type RuntimePathsInput } from "./runtime-paths";

function pathFor(platform: string): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Vendor segment shared with the data root; the install leaf is `app` (distinct from the data leaf `Agent`). */
const VENDOR_SEGMENT = "SellerOps";
const INSTALL_LEAF = "app";

/**
 * The install root — where the agent CODE lives, replaced wholesale on update. Deliberately a SIBLING of the
 * data root under the same vendor folder (`…\SellerOps\app` vs `…\SellerOps\Agent`), so the two never nest.
 * An explicit `SELLEROPS_AGENT_INSTALL_DIR` wins (custom install / test).
 */
export function resolveInstallRoot(input: RuntimePathsInput): string {
  const override = input.env.SELLEROPS_AGENT_INSTALL_DIR?.trim();
  if (override) return override;
  const p = pathFor(input.platform);
  if (input.platform === "win32") {
    const base =
      input.env.LOCALAPPDATA?.trim() || input.env.APPDATA?.trim() || p.join(input.homedir, "AppData", "Local");
    return p.join(base, VENDOR_SEGMENT, INSTALL_LEAF);
  }
  if (input.platform === "darwin") {
    return p.join(input.homedir, "Library", "Application Support", VENDOR_SEGMENT, INSTALL_LEAF);
  }
  const xdg = input.env.XDG_DATA_HOME?.trim() || p.join(input.homedir, ".local", "share");
  return p.join(xdg, VENDOR_SEGMENT, INSTALL_LEAF);
}

/**
 * The Windows per-user Startup-folder shortcut path (auto-start at login, no admin). Uses `%APPDATA%` (roaming
 * — the Start Menu lives there) → `…\Microsoft\Windows\Start Menu\Programs\Startup\SellerOps 로컬 도우미.lnk`.
 */
export function windowsStartupShortcutPath(env: NodeJS.ProcessEnv, homedir: string): string {
  const appData = env.APPDATA?.trim() || path.win32.join(homedir, "AppData", "Roaming");
  return path.win32.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "SellerOps 로컬 도우미.lnk",
  );
}

/** `true` iff `child` is the same as or nested under `parent` (using the platform's separators). */
export function isUnder(child: string, parent: string, platform: string): boolean {
  const p = pathFor(platform);
  const c = p.resolve(child);
  const b = p.resolve(parent);
  return c === b || c.startsWith(b + p.sep);
}

export interface UpdatePlan {
  readonly installRoot: string;
  readonly dataRoot: string;
  /** The update replaces this. */
  readonly replace: string;
  /** The update must NOT touch this. */
  readonly preserve: string;
  /** True only when the data root is provably NOT under the install root (so replacing code keeps the login). */
  readonly safe: boolean;
}

/**
 * Plan an in-place update: replace the install root, preserve the data root. `safe` is the invariant the
 * PowerShell updater asserts before deleting anything — if the data root were ever under the install root, a
 * wholesale replace would wipe the login, so a false here must ABORT the update rather than proceed.
 */
export function planUpdate(input: RuntimePathsInput): UpdatePlan {
  const installRoot = resolveInstallRoot(input);
  const dataRoot = resolveRuntimeDataRoot(input);
  return {
    installRoot,
    dataRoot,
    replace: installRoot,
    preserve: dataRoot,
    // Safe when neither contains the other — the pilot layout (sibling `app`/`Agent`) guarantees this.
    safe: !isUnder(dataRoot, installRoot, input.platform) && !isUnder(installRoot, dataRoot, input.platform),
  };
}

export interface UninstallPlan {
  /** Always removed: the code + the login item. */
  readonly removeInstallRoot: string;
  readonly removeStartupShortcut: string | null;
  /** Removed ONLY when the seller explicitly asks (`-RemoveData`); otherwise the login/profiles are kept. */
  readonly dataRoot: string;
  readonly removeData: boolean;
}

/** Plan an uninstall. Profiles are kept by default; only an explicit opt-in removes the data root. */
export function planUninstall(input: RuntimePathsInput, opts: { removeData: boolean }): UninstallPlan {
  return {
    removeInstallRoot: resolveInstallRoot(input),
    removeStartupShortcut:
      input.platform === "win32" ? windowsStartupShortcutPath(input.env, input.homedir) : null,
    dataRoot: resolveRuntimeDataRoot(input),
    removeData: opts.removeData,
  };
}
