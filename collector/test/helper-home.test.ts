import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  HELPER_ENV_KEYS,
  helperHome,
  helperVersion,
  loadConfig,
  parseHelperEnv,
  withHelperEnvFile,
} from "../src/config";
import { resolveProfileDir } from "../src/profile";
import { buildLocalAgentServicePlan } from "../src/agent/local-agent-service";

/**
 * Local Helper Pilot Packaging v1 — the packaged helper keeps its state under `REVIEWNARY_HELPER_HOME`,
 * reads the seller's login from a 0600 file there, and announces the package version.
 */
describe("helperHome", () => {
  it("is the collector tree when unset — the developer checkout is unchanged", () => {
    expect(helperHome({})).toBe(resolve(__dirname, ".."));
    expect(loadConfig({}).profileBaseDir).toBe(resolve(__dirname, "..", ".profile"));
  });

  it("moves every state root together when set", () => {
    const cfg = loadConfig({ REVIEWNARY_HELPER_HOME: "/Users/seller/Library/Application Support/reviewnary-helper" });
    const home = "/Users/seller/Library/Application Support/reviewnary-helper";
    expect(cfg.profileBaseDir).toBe(`${home}/.profile`);
    expect(cfg.profileDir).toBe(`${home}/.profile/naver`);
    expect(cfg.downloadDir).toBe(`${home}/downloads`);
    expect(cfg.statusFile).toBe(`${home}/.status/naver.json`);
  });

  it("the profile guard follows the home, so a packaged profile is inside its own tree and nothing else", () => {
    const home = "/Users/seller/Library/Application Support/reviewnary-helper";
    expect(resolveProfileDir(`${home}/.profile/naver`, helperHome({ REVIEWNARY_HELPER_HOME: home }))).toBe(`${home}/.profile/naver`);
    expect(() => resolveProfileDir("/tmp/elsewhere", helperHome({ REVIEWNARY_HELPER_HOME: home }))).toThrow(/inside the collector/);
  });
});

describe("helper.env", () => {
  it("reads only the closed key list, and the process env wins", () => {
    const text = "SELLEROPS_BASE_URL=http://127.0.0.1:8080\nSELLEROPS_APP_URL='http://localhost:5173'\nBRIDGE_PORT=1\n# c\nNODE_ENV=development\nSELLEROPS_PASSWORD=never\n";
    expect(parseHelperEnv(text)).toEqual({ SELLEROPS_BASE_URL: "http://127.0.0.1:8080", SELLEROPS_APP_URL: "http://localhost:5173" });
    const merged = withHelperEnvFile(
      { REVIEWNARY_HELPER_HOME: "/h", SELLEROPS_EMAIL: "operator@example.invalid" },
      (path) => (path === "/h/helper.env" ? text : null),
    );
    expect(merged.SELLEROPS_EMAIL).toBe("operator@example.invalid");
    expect(merged.SELLEROPS_BASE_URL).toBe("http://127.0.0.1:8080");
    // A password line in the file is not a key the helper reads — the file cannot carry a credential.
    expect(merged.SELLEROPS_PASSWORD).toBeUndefined();
    expect(merged.NODE_ENV).toBeUndefined();
    expect(merged.BRIDGE_PORT).toBeUndefined();
  });

  it("without a home there is no file to read", () => {
    let reads = 0;
    withHelperEnvFile({}, () => {
      reads++;
      return "SELLEROPS_EMAIL=x";
    });
    expect(reads).toBe(0);
  });

  it("names exactly what the installer writes", () => {
    expect([...HELPER_ENV_KEYS]).toEqual([
      "SELLEROPS_BASE_URL", "SELLEROPS_APP_URL", "NAVER_REVIEW_URL", "BRIDGE_ALLOWED_ORIGINS",
      // Which executor carries a screen read on this machine, and where its CLI is. Added deliberately:
      // the BYO lane was selectable only by process env vars, which an installed helper never sees, so
      // the product's one opt-in execution mode could not be opted into on a packaged install — and a
      // launchd agent's PATH would not have found the CLI even if it had been.
      "REVIEWNARY_EXECUTION_PROVIDER",
      "ASIDE_CLI",
    ]);
    for (const key of HELPER_ENV_KEYS) expect(key.toLowerCase()).not.toMatch(/password|email|token|secret/);
  });

  it("carries the executor's path from the file — a launchd agent has no PATH to find it on", () => {
    const merged = withHelperEnvFile(
      { REVIEWNARY_HELPER_HOME: "/h" },
      () => "ASIDE_CLI=/Users/x/.local/bin/aside\n",
    );
    expect(merged.ASIDE_CLI).toBe("/Users/x/.local/bin/aside");
  });

  it("carries the execution provider from the file, and the process env still wins over it", () => {
    const merged = withHelperEnvFile(
      { REVIEWNARY_HELPER_HOME: "/h" },
      () => "REVIEWNARY_EXECUTION_PROVIDER=ASIDE\n",
    );
    expect(merged.REVIEWNARY_EXECUTION_PROVIDER).toBe("ASIDE");
    const overridden = withHelperEnvFile(
      { REVIEWNARY_HELPER_HOME: "/h", REVIEWNARY_EXECUTION_PROVIDER: "LOCAL_HELPER" },
      () => "REVIEWNARY_EXECUTION_PROVIDER=ASIDE\n",
    );
    expect(overridden.REVIEWNARY_EXECUTION_PROVIDER).toBe("LOCAL_HELPER");
  });
});

describe("helperVersion", () => {
  it("is the package version, not a literal", () => {
    expect(helperVersion({})).toMatch(/^\d+\.\d+\.\d+/);
    expect(helperVersion({})).not.toBe("0.0.1-poc");
  });

  it("can be overridden to reproduce the update path — never in production", () => {
    expect(helperVersion({ REVIEWNARY_HELPER_VERSION_OVERRIDE: "0.0.9" })).toBe("0.0.9");
    expect(helperVersion({ REVIEWNARY_HELPER_VERSION_OVERRIDE: "0.0.9", NODE_ENV: "production" })).not.toBe("0.0.9");
  });
});

describe("buildLocalAgentServicePlan — packaged helper", () => {
  const HOME = "/Users/seller/Library/Application Support/reviewnary-helper";
  const input = {
    platform: "darwin",
    homeDir: "/Users/seller",
    collectorRoot: HOME,
    stateRoot: HOME,
    nodePath: `${HOME}/app/bin/node`,
    loaderPath: null,
    entrypoint: `${HOME}/app/helper.mjs`,
    agentArgs: ["--bridge-only"],
    env: { REVIEWNARY_HELPER_HOME: HOME, BRIDGE_ALLOWED_ORIGINS: "https://app.example.invalid" },
  };
  const presenter = (env: NodeJS.ProcessEnv, platform: string) =>
    env.NODE_ENV === "production" && platform === "darwin" ? "macos_native" : "dev_tty_stderr";

  it("runs the bundle directly under node, with logs under the home", () => {
    const res = buildLocalAgentServicePlan(input, presenter);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.programArguments).toEqual([`${HOME}/app/bin/node`, `${HOME}/app/helper.mjs`, "--bridge-only"]);
    expect(res.plan.workingDirectory).toBe(HOME);
    expect(res.plan.stdoutPath).toBe(`${HOME}/.status/local-agent-service.out.log`);
    expect(res.plan.env.REVIEWNARY_HELPER_HOME).toBe(HOME);
    expect(res.plan.env.NODE_ENV).toBe("production");
  });

  it("still refuses a bundle outside the home, and still refuses a password in the plist", () => {
    expect(buildLocalAgentServicePlan({ ...input, entrypoint: "/tmp/helper.mjs" }, presenter)).toEqual({ ok: false, refusal: "ENTRYPOINT_OUTSIDE_TREE" });
    expect(buildLocalAgentServicePlan({ ...input, env: { ...input.env, SELLEROPS_PASSWORD: "x" } }, presenter)).toEqual({ ok: false, refusal: "SECRET_ENV_KEY" });
  });
});
