import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOption, SERVICE_CLI_USAGE, splitServiceArgs } from "../../src/cli/local-agent-service";

describe("splitServiceArgs", () => {
  it("puts everything after `--` on the agent side, untouched", () => {
    expect(
      splitServiceArgs([
        "--run-env",
        "/tmp/wing-walk.env",
        "--",
        "--connections",
        ".connections/coupang-walk.json",
        "--action-window-coupang-issuance-live",
      ]),
    ).toEqual({
      own: ["--run-env", "/tmp/wing-walk.env"],
      agentArgs: ["--connections", ".connections/coupang-walk.json", "--action-window-coupang-issuance-live"],
    });
  });

  it("keeps a later `--` inside the agent side — only the FIRST separator divides the two", () => {
    expect(splitServiceArgs(["--run-env", "e", "--", "--flag", "--", "--other"]).agentArgs).toEqual([
      "--flag",
      "--",
      "--other",
    ]);
  });

  it("yields no agent arguments when the separator is absent, rather than adopting the CLI's own options", () => {
    // Without this, `install --run-env x --action-window-coupang-issuance-live` would install a service whose
    // carrier flag came from a typo instead of a deliberate separator.
    expect(splitServiceArgs(["--run-env", "e"])).toEqual({ own: ["--run-env", "e"], agentArgs: [] });
  });
});

describe("readOption", () => {
  it("reads a flag's value", () => {
    expect(readOption(["--run-env", "/tmp/x.env"], "--run-env")).toBe("/tmp/x.env");
  });

  it("returns null rather than a partially-applied option", () => {
    expect(readOption([], "--run-env")).toBeNull();
    expect(readOption(["--run-env"], "--run-env")).toBeNull();
    // The next token is another flag, so the value was omitted — never silently adopt the flag as the path.
    expect(readOption(["--run-env", "--other"], "--run-env")).toBeNull();
  });
});

describe("the service CLI's boundary", () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const SRC_PATH = join(__dirname, "..", "..", "src", "cli", "local-agent-service.ts");
  const code = stripComments(readFileSync(SRC_PATH, "utf8"));

  it("never drives a browser or a marketplace — it decides that a process runs, not what it does", () => {
    for (const token of ["playwright", "chromium", "launchPersistentContext", "page.", ".goto(", ".click(", ".fill("]) {
      expect(code, `service CLI must not reference ${token}`).not.toContain(token);
    }
  });

  it("execs launchctl by absolute path with no shell, so no argument can be interpreted as a command", () => {
    expect(code).toContain('const LAUNCHCTL = "/bin/launchctl"');
    expect(code).toContain("shell: false");
    // `exec`/`execSync` take a command STRING through a shell — the one shape this file must never use.
    expect(code).not.toContain("execSync(");
    expect(code).not.toMatch(/\bexec\(/);
  });

  it("states all three commands in its usage, so an operator is never told a half-truth about the surface", () => {
    for (const command of ["install", "status", "uninstall"]) {
      expect(SERVICE_CLI_USAGE).toContain(command);
    }
  });

  it("is inert on import — loading it starts nothing", () => {
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });
});
