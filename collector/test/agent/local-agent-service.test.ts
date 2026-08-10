import { describe, expect, it } from "vitest";
import {
  buildLocalAgentServicePlan,
  LOCAL_AGENT_SERVICE_LABEL,
  LOCAL_AGENT_SERVICE_REFUSALS,
  parseServiceEnvFile,
  renderLaunchAgentPlist,
  type LocalAgentServiceInput,
} from "../../src/agent/local-agent-service";
import { decideApprovalPresenter } from "../../src/cli/local-agent";

const COLLECTOR = "/repo/collector";

function input(over: Partial<LocalAgentServiceInput> = {}): LocalAgentServiceInput {
  return {
    platform: "darwin",
    homeDir: "/Users/seller",
    collectorRoot: COLLECTOR,
    nodePath: "/opt/homebrew/bin/node",
    loaderPath: `${COLLECTOR}/node_modules/tsx/dist/cli.mjs`,
    entrypoint: `${COLLECTOR}/src/cli/local-agent.ts`,
    agentArgs: ["--connections", ".connections/coupang-walk.json", "--action-window-coupang-issuance-live"],
    env: { SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_GUIDED_ISSUANCE_WALK" },
    ...over,
  };
}

function build(over: Partial<LocalAgentServiceInput> = {}) {
  return buildLocalAgentServicePlan(input(over), decideApprovalPresenter);
}

/** The real decision function, so the presenter guard is proved against production behaviour, not a stub. */
describe("buildLocalAgentServicePlan", () => {
  it("plans a GUI-session user agent running the real entrypoint through node", () => {
    const res = build();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.label).toBe(LOCAL_AGENT_SERVICE_LABEL);
    expect(res.plan.plistPath).toBe(`/Users/seller/Library/LaunchAgents/${LOCAL_AGENT_SERVICE_LABEL}.plist`);
    expect(res.plan.programArguments).toEqual([
      "/opt/homebrew/bin/node",
      `${COLLECTOR}/node_modules/tsx/dist/cli.mjs`,
      `${COLLECTOR}/src/cli/local-agent.ts`,
      "--connections",
      ".connections/coupang-walk.json",
      "--action-window-coupang-issuance-live",
    ]);
    expect(res.plan.workingDirectory).toBe(COLLECTOR);
  });

  it("pins NODE_ENV=production so the service host has a NATIVE approval channel, never the TTY presenter", () => {
    const res = build();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.env.NODE_ENV).toBe("production");
    // The whole reason the adapter exists: a launchd job has no TTY, so `dev_tty_stderr` could never pair.
    expect(res.plan.approvalPresenter).toBe("macos_native");
  });

  it("refuses when the decided presenter is not a human channel", () => {
    // A host whose decision yields anything else would install a service that can never complete pairing.
    const res = buildLocalAgentServicePlan(input(), () => "dev_tty_stderr");
    expect(res).toEqual({ ok: false, refusal: "NO_HUMAN_APPROVAL_CHANNEL" });
    expect(buildLocalAgentServicePlan(input(), () => "none")).toEqual({
      ok: false,
      refusal: "NO_HUMAN_APPROVAL_CHANNEL",
    });
  });

  it("refuses a non-darwin platform — launchd is the macOS adapter and nothing else", () => {
    expect(build({ platform: "win32" })).toEqual({ ok: false, refusal: "UNSUPPORTED_PLATFORM" });
    expect(build({ platform: "linux" })).toEqual({ ok: false, refusal: "UNSUPPORTED_PLATFORM" });
  });

  it("refuses an empty agent argument list", () => {
    expect(build({ agentArgs: [] })).toEqual({ ok: false, refusal: "NO_AGENT_ARGUMENTS" });
  });

  it("refuses a relative node path — launchd inherits no PATH to resolve it with", () => {
    expect(build({ nodePath: "node" })).toEqual({ ok: false, refusal: "NODE_NOT_ABSOLUTE" });
  });

  it("refuses an executable outside the collector tree, including via traversal", () => {
    expect(build({ entrypoint: "/tmp/evil.ts" })).toEqual({ ok: false, refusal: "ENTRYPOINT_OUTSIDE_TREE" });
    expect(build({ loaderPath: "/tmp/loader.mjs" })).toEqual({ ok: false, refusal: "ENTRYPOINT_OUTSIDE_TREE" });
    expect(build({ entrypoint: `${COLLECTOR}/../../etc/passwd` })).toEqual({
      ok: false,
      refusal: "ENTRYPOINT_OUTSIDE_TREE",
    });
    // A sibling directory sharing the root's prefix is NOT inside it.
    expect(build({ entrypoint: `${COLLECTOR}-evil/src/cli/local-agent.ts` })).toEqual({
      ok: false,
      refusal: "ENTRYPOINT_OUTSIDE_TREE",
    });
  });

  it("refuses secret-ish env keys — a plist is not a secret store", () => {
    for (const key of [
      "SELLEROPS_PASSWORD",
      "BRIDGE_TOKEN",
      "MY_SECRET",
      "COOKIE_JAR",
      "AUTHORIZATION",
      "SESSION_ID",
      "credential_path",
    ]) {
      expect(build({ env: { [key]: "x" } })).toEqual({ ok: false, refusal: "SECRET_ENV_KEY" });
    }
  });

  it("refuses NODE_ENV from the caller — the builder owns the key the presenter guard depends on", () => {
    expect(build({ env: { NODE_ENV: "development" } })).toEqual({ ok: false, refusal: "RESERVED_ENV_KEY" });
    // Even the "harmless" matching value: accepting it would make the guard look caller-controlled.
    expect(build({ env: { NODE_ENV: "production" } })).toEqual({ ok: false, refusal: "RESERVED_ENV_KEY" });
    expect(build({ env: { node_env: "development" } })).toEqual({ ok: false, refusal: "RESERVED_ENV_KEY" });
  });

  it("refuses control characters in an env key or value", () => {
    expect(build({ env: { WALKTHROUGH_RUN_ID: "wt-1\nEXTRA=1" } })).toEqual({
      ok: false,
      refusal: "UNPRINTABLE_ENV_VALUE",
    });
    expect(build({ env: { WALKTHROUGH_RUN_ID: "wt-\u00001" } })).toEqual({
      ok: false,
      refusal: "UNPRINTABLE_ENV_VALUE",
    });
  });

  it("orders env keys deterministically so a reinstall diffs cleanly", () => {
    const a = build({ env: { B_KEY: "2", A_KEY: "1" } });
    const b = build({ env: { A_KEY: "1", B_KEY: "2" } });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Object.keys(a.plan.env)).toEqual(Object.keys(b.plan.env));
    expect(Object.keys(a.plan.env)).toEqual(["A_KEY", "B_KEY", "NODE_ENV"]);
  });

  it("keeps service logs inside the collector's gitignored runtime area", () => {
    const res = build();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.stdoutPath).toBe(`${COLLECTOR}/.status/local-agent-service.out.log`);
    expect(res.plan.stderrPath).toBe(`${COLLECTOR}/.status/local-agent-service.err.log`);
  });

  it("has a refusal constant for every refusal the builder can return", () => {
    const returned = new Set(
      [
        build({ platform: "win32" }),
        build({ agentArgs: [] }),
        build({ nodePath: "node" }),
        build({ entrypoint: "/tmp/x.ts" }),
        build({ env: { NODE_ENV: "x" } }),
        build({ env: { A_TOKEN: "x" } }),
        build({ env: { A: "\u0001" } }),
        buildLocalAgentServicePlan(input(), () => "none"),
      ]
        .filter((r): r is { ok: false; refusal: (typeof LOCAL_AGENT_SERVICE_REFUSALS)[number] } => !r.ok)
        .map((r) => r.refusal),
    );
    expect([...returned].sort()).toEqual([...LOCAL_AGENT_SERVICE_REFUSALS].sort());
  });
});

describe("renderLaunchAgentPlist", () => {
  function plist(over: Partial<LocalAgentServiceInput> = {}): string {
    const res = build(over);
    if (!res.ok) throw new Error(`unexpected refusal ${res.refusal}`);
    return renderLaunchAgentPlist(res.plan);
  }

  it("renders a launchd user agent that starts at load and is kept alive", () => {
    const xml = plist();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(`<key>Label</key>\n  <string>${LOCAL_AGENT_SERVICE_LABEL}</string>`);
    expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(xml).toContain("<key>KeepAlive</key>");
    expect(xml).toContain("<key>NODE_ENV</key>\n    <string>production</string>");
  });

  it("limits the job to the Aqua session — an approval dialog needs a GUI session to appear in", () => {
    expect(plist()).toContain("<key>LimitLoadToSessionType</key>\n  <string>Aqua</string>");
  });

  it("escapes every interpolated value, so a value cannot close its element and inject launchd keys", () => {
    const xml = plist({ env: { WALKTHROUGH_RUN_ID: '</string><key>Program</key><string>/bin/sh' } });
    // The injected markup survives only as inert text; no second Program key is created and no extra
    // <string> element is opened inside ProgramArguments.
    expect(xml).not.toContain("<key>Program</key>");
    expect(xml).toContain("&lt;/string&gt;&lt;key&gt;Program&lt;/key&gt;&lt;string&gt;/bin/sh");
    expect(xml.match(/<key>Program(Arguments)?<\/key>/g)).toEqual(["<key>ProgramArguments</key>"]);
  });

  it("escapes ampersands and quotes in the rendered paths and values", () => {
    const root = "/repo/a&b/collector";
    const xml = plist({
      collectorRoot: root,
      loaderPath: `${root}/node_modules/tsx/dist/cli.mjs`,
      entrypoint: `${root}/src/cli/local-agent.ts`,
      env: { WALKTHROUGH_RUN_ID: 'wt-"1" & 2' },
    });
    expect(xml).toContain("<key>WorkingDirectory</key>\n  <string>/repo/a&amp;b/collector</string>");
    expect(xml).toContain("wt-&quot;1&quot; &amp; 2");
    // A bare ampersand anywhere would make the plist unparseable, which launchd reports as a load failure.
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});

describe("parseServiceEnvFile", () => {
  it("reads the bootstrap's KEY='value' bindings", () => {
    const parsed = parseServiceEnvFile(
      [
        "# Generated by wing-walk-bootstrap.sh",
        "",
        "WALKTHROUGH_RUN_ID='wt-aa501583ad7d'",
        'WALKTHROUGH_APPROVAL_ID="apr-dbd92d6108dc"',
        "SELLEROPS_APPROVAL_PHASE=COUPANG_WING_GUIDED_ISSUANCE_WALK",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      WALKTHROUGH_RUN_ID: "wt-aa501583ad7d",
      WALKTHROUGH_APPROVAL_ID: "apr-dbd92d6108dc",
      SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_GUIDED_ISSUANCE_WALK",
    });
  });

  it("skips what it cannot parse rather than guessing at a run binding", () => {
    const parsed = parseServiceEnvFile(["=novalue", "no-equals-sign", "1BAD=x", " ", "GOOD='y'"].join("\n"));
    expect(parsed).toEqual({ GOOD: "y" });
  });

  it("strips only one matching quote layer and never interpolates", () => {
    const parsed = parseServiceEnvFile(["A='$HOME'", "B='\"x\"'", "C='mismatched\""].join("\n"));
    expect(parsed.A).toBe("$HOME");
    expect(parsed.B).toBe('"x"');
    expect(parsed.C).toBe("'mismatched\"");
  });
});
