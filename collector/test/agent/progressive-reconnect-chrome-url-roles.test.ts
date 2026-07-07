import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The live-only Chrome port is never unit-tested (it drives a real browser). Its URL ROLES are
// safety-critical, so lock them with a source guard: LOGGED_IN may only be produced from the
// session-probe surface, and login establishment must use the auth surface.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, "../../src/agent/progressive-reconnect-chrome.ts"), "utf8");

/** Extract one async method's source body by brace matching. */
function methodBody(name: string): string {
  const start = SRC.indexOf(`async ${name}(`);
  if (start < 0) throw new Error(`method ${name} not found`);
  let i = SRC.indexOf("{", start);
  let depth = 0;
  let end = i;
  for (; i < SRC.length; i += 1) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  // Strip comment lines so prose can't produce a false match.
  return SRC.slice(start, end + 1).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
}

describe("progressive-reconnect-chrome URL roles", () => {
  it("inspectSession navigates the session-probe surface, never the auth/login URL", () => {
    const b = methodBody("inspectSession");
    expect(b).toContain("this.opts.sessionProbeUrl");
    expect(b).not.toContain("this.opts.authSurfaceUrl");
  });

  it("establishLoginMode brings the page to the auth surface for login-mode establishment", () => {
    expect(methodBody("establishLoginMode")).toContain("page.goto(this.opts.authSurfaceUrl");
  });

  it("submitLoginOnce verifies the post-submit logged-in state only from the session-probe surface", () => {
    expect(methodBody("submitLoginOnce")).toContain("this.opts.sessionProbeUrl");
  });
});
