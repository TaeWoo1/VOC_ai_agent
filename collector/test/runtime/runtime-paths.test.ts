import { describe, it, expect } from "vitest";
import {
  resolveRuntimeDataRoot,
  resolveRuntimePaths,
  runtimePathsFrom,
} from "../../src/runtime/runtime-paths";

describe("runtime data root — per-user, outside the install tree", () => {
  it("uses %LOCALAPPDATA% on Windows", () => {
    const root = resolveRuntimeDataRoot({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\seller\\AppData\\Local" },
      homedir: "C:\\Users\\seller",
    });
    expect(root).toContain("SellerOps");
    expect(root).toContain("Agent");
    expect(root.startsWith("C:\\Users\\seller\\AppData\\Local")).toBe(true);
  });

  it("falls back to <home>\\AppData\\Local when LOCALAPPDATA/APPDATA are absent on Windows", () => {
    const root = resolveRuntimeDataRoot({ platform: "win32", env: {}, homedir: "C:\\Users\\seller" });
    expect(root).toContain("AppData");
    expect(root).toContain("Local");
    expect(root).toContain("SellerOps");
  });

  it("uses Application Support on macOS", () => {
    const root = resolveRuntimeDataRoot({ platform: "darwin", env: {}, homedir: "/Users/seller" });
    expect(root).toBe("/Users/seller/Library/Application Support/SellerOps/Agent");
  });

  it("uses XDG_DATA_HOME (then ~/.local/share) on Linux", () => {
    expect(
      resolveRuntimeDataRoot({ platform: "linux", env: { XDG_DATA_HOME: "/data/xdg" }, homedir: "/home/seller" }),
    ).toBe("/data/xdg/SellerOps/Agent");
    expect(resolveRuntimeDataRoot({ platform: "linux", env: {}, homedir: "/home/seller" })).toBe(
      "/home/seller/.local/share/SellerOps/Agent",
    );
  });

  it("an explicit SELLEROPS_AGENT_DATA_DIR override wins on every platform", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      expect(
        resolveRuntimeDataRoot({ platform, env: { SELLEROPS_AGENT_DATA_DIR: "/custom/root" }, homedir: "/h" }),
      ).toBe("/custom/root");
    }
  });

  it("keeps profiles, config and the pairing file all under the one data root (preserved on update)", () => {
    const p = runtimePathsFrom("/data/root");
    expect(p.profilesDir.startsWith("/data/root")).toBe(true);
    expect(p.configDir.startsWith("/data/root")).toBe(true);
    expect(p.pairingFile.startsWith("/data/root")).toBe(true);
    // The pairing file lives under the run dir, so the "preserve the data root" rule keeps the pairing.
    expect(p.pairingFile.startsWith(p.runDir)).toBe(true);
  });

  it("resolveRuntimePaths composes the data root and the sub-paths together", () => {
    const p = resolveRuntimePaths({ platform: "darwin", env: {}, homedir: "/Users/seller" });
    expect(p.dataRoot).toContain("SellerOps/Agent");
    for (const dir of [p.profilesDir, p.logsDir, p.runDir, p.configDir, p.diagnosticsDir, p.downloadsDir]) {
      expect(dir.startsWith(p.dataRoot)).toBe(true);
    }
  });
});
