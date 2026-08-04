import { describe, it, expect } from "vitest";
import {
  isUnder,
  planUninstall,
  planUpdate,
  resolveInstallRoot,
  windowsStartupShortcutPath,
} from "../../src/runtime/packaging-plan";
import { resolveRuntimeDataRoot } from "../../src/runtime/runtime-paths";

const win = { LOCALAPPDATA: "C:\\Users\\seller\\AppData\\Local", APPDATA: "C:\\Users\\seller\\AppData\\Roaming" };

describe("resolveInstallRoot — a sibling of the data root, never nested", () => {
  it("Windows install root is …\\SellerOps\\app, distinct from the data root …\\SellerOps\\Agent", () => {
    const input = { platform: "win32", env: win, homedir: "C:\\Users\\seller" };
    const install = resolveInstallRoot(input);
    const data = resolveRuntimeDataRoot(input);
    expect(install.endsWith("SellerOps\\app")).toBe(true);
    expect(data.endsWith("SellerOps\\Agent")).toBe(true);
    expect(install).not.toBe(data);
  });

  it("an explicit SELLEROPS_AGENT_INSTALL_DIR override wins", () => {
    expect(
      resolveInstallRoot({ platform: "win32", env: { SELLEROPS_AGENT_INSTALL_DIR: "D:\\opt\\agent" }, homedir: "C:\\h" }),
    ).toBe("D:\\opt\\agent");
  });
});

describe("windowsStartupShortcutPath — a per-user login item", () => {
  it("lands in the roaming Start Menu Startup folder", () => {
    const p = windowsStartupShortcutPath(win, "C:\\Users\\seller");
    expect(p).toContain("Start Menu\\Programs\\Startup");
    expect(p.endsWith(".lnk")).toBe(true);
  });
});

describe("isUnder", () => {
  it("detects nesting per platform", () => {
    expect(isUnder("C:\\a\\b\\c", "C:\\a\\b", "win32")).toBe(true);
    expect(isUnder("C:\\a\\bbb", "C:\\a\\b", "win32")).toBe(false); // sibling prefix, not nested
    expect(isUnder("/a/b/c", "/a/b", "linux")).toBe(true);
    expect(isUnder("/a/b", "/a/b", "linux")).toBe(true); // same dir counts as under
  });
});

describe("planUpdate — data survives an in-place update", () => {
  it("replaces the install root and preserves the data root, and marks it safe", () => {
    const plan = planUpdate({ platform: "win32", env: win, homedir: "C:\\Users\\seller" });
    expect(plan.replace).toBe(plan.installRoot);
    expect(plan.preserve).toBe(plan.dataRoot);
    // The invariant the updater asserts: the data root is NOT under the install root (sibling layout).
    expect(plan.safe).toBe(true);
    expect(isUnder(plan.dataRoot, plan.installRoot, "win32")).toBe(false);
  });

  it("flags UNSAFE if a misconfiguration ever nested the data root under the install root", () => {
    // Override the install root to be an ancestor of the (default) data root → unsafe → the updater must abort.
    const env = { ...win, SELLEROPS_AGENT_INSTALL_DIR: "C:\\Users\\seller\\AppData\\Local\\SellerOps" };
    const plan = planUpdate({ platform: "win32", env, homedir: "C:\\Users\\seller" });
    expect(plan.safe).toBe(false);
  });
});

describe("planUninstall — profiles kept by default", () => {
  const input = { platform: "win32", env: win, homedir: "C:\\Users\\seller" };

  it("removes code + login item but keeps the data root unless explicitly asked", () => {
    const keep = planUninstall(input, { removeData: false });
    expect(keep.removeInstallRoot).toContain("SellerOps\\app");
    expect(keep.removeStartupShortcut).toContain("Startup");
    expect(keep.removeData).toBe(false);
  });

  it("removes the data root only on explicit opt-in", () => {
    expect(planUninstall(input, { removeData: true }).removeData).toBe(true);
  });

  it("has no startup shortcut to remove off Windows", () => {
    expect(planUninstall({ platform: "darwin", env: {}, homedir: "/Users/seller" }, { removeData: false }).removeStartupShortcut).toBeNull();
  });
});
