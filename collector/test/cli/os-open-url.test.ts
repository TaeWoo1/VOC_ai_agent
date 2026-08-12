/**
 * The hand-off of the walk's last step to the seller's OWN browser.
 *
 * This module builds an argv for a process launcher from a string that ultimately comes from operator
 * configuration, so the tests are mostly about what it REFUSES. The one positive property worth pinning is that
 * the URL arrives as its own argument on every platform.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planOsOpen } from "../../src/cli/os-open-url";
import { SELLEROPS_COUPANG_CONNECT_PATH, isSellerOpsReturnUrl } from "../../src/cli/sellerops-return-url";

const RETURN_URL = `http://localhost:5173${SELLEROPS_COUPANG_CONNECT_PATH}`;

describe("isSellerOpsReturnUrl", () => {
  it("accepts exactly what the screening produces", () => {
    expect(isSellerOpsReturnUrl(RETURN_URL)).toBe(true);
    expect(isSellerOpsReturnUrl(`http://127.0.0.1:4173${SELLEROPS_COUPANG_CONNECT_PATH}`)).toBe(true);
  });

  it("**a loopback origin is not enough** — the route has to be the connect route", () => {
    // A screened value can only ever come out on this path, so anything else reaching the launcher means the
    // screening was skipped.
    expect(isSellerOpsReturnUrl("http://localhost:5173")).toBe(false);
    expect(isSellerOpsReturnUrl("http://localhost:5173/somewhere")).toBe(false);
    expect(isSellerOpsReturnUrl(`http://localhost:5173${SELLEROPS_COUPANG_CONNECT_PATH}?next=x`)).toBe(false);
  });

  it("refuses every host that is not this machine, and every non-http scheme", () => {
    for (const off of [
      `https://wing.coupang.com${SELLEROPS_COUPANG_CONNECT_PATH}`,
      `http://192.168.1.9:5173${SELLEROPS_COUPANG_CONNECT_PATH}`,
      "file:///Users/someone/x.html",
      "javascript:alert(1)",
      "",
    ]) {
      expect(isSellerOpsReturnUrl(off), off).toBe(false);
    }
  });
});

describe("planOsOpen", () => {
  it("hands the URL to the OS default browser on each supported platform", () => {
    expect(planOsOpen(RETURN_URL, "darwin")).toEqual({ ok: true, command: "open", args: [RETURN_URL] });
    expect(planOsOpen(RETURN_URL, "linux")).toEqual({ ok: true, command: "xdg-open", args: [RETURN_URL] });
    expect(planOsOpen(RETURN_URL, "win32")).toEqual({
      ok: true,
      command: "cmd",
      // The empty string is `start`'s title argument; without it `start` reads the URL as a window title.
      args: ["/c", "start", "", RETURN_URL],
    });
  });

  it("**the URL is always its own argument** — never concatenated into a command line", () => {
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const plan = planOsOpen(RETURN_URL, platform);
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.args.filter((a) => a === RETURN_URL)).toHaveLength(1);
      expect(plan.command).not.toContain(RETURN_URL);
      // Nothing else in the argv mentions the destination, so there is no second place to sanitize.
      expect(plan.args.filter((a) => a.includes("localhost"))).toHaveLength(1);
    }
  });

  it("**re-screens the URL itself** rather than trusting the caller to have screened it", () => {
    for (const off of ["https://wing.coupang.com/connect/coupang", "http://localhost:5173", "javascript:alert(1)"]) {
      expect(planOsOpen(off, "darwin"), off).toEqual({ ok: false, reason: "NOT_A_SELLEROPS_RETURN_URL" });
    }
  });

  it("refuses an unrecognized platform rather than guessing at a launcher", () => {
    expect(planOsOpen(RETURN_URL, "freebsd")).toEqual({ ok: false, reason: "UNSUPPORTED_PLATFORM" });
    expect(planOsOpen(RETURN_URL, "aix")).toEqual({ ok: false, reason: "UNSUPPORTED_PLATFORM" });
  });

  it("its refusal reasons carry no URL and no host — they are logged", () => {
    const res = planOsOpen("https://wing.coupang.com/secret-path", "darwin");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("coupang");
    expect(JSON.stringify(res)).not.toContain("secret-path");
  });

  it("**the planner spawns nothing** — deciding and launching are different modules", () => {
    const src = readFileSync(resolve(__dirname, "../../src/cli/os-open-url.ts"), "utf8");
    const code = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("/*") && !l.trimStart().startsWith("//"))
      .join("\n");
    for (const forbidden of ["child_process", "spawn(", "exec(", "execSync", "playwright", "node:fs"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
