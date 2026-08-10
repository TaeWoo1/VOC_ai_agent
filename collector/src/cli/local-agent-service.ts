/**
 * **`install | status | uninstall` for the Local Agent launchd service — the product-path start of the agent.**
 *
 * This is the operator-facing half of `agent/local-agent-service.ts`. It exists so the seller's machine ends up
 * in the state an installed product would leave it in: the Local Agent already running as a background user
 * agent in their GUI session, discoverable by the frontend on loopback, with a real OS approval dialog for
 * pairing. After `install`, nothing about the guided walk needs a terminal — which is the difference between a
 * product-path run and a developer demo.
 *
 * What it deliberately is NOT: a live-run authorization. Installing the service does not grant, extend, or stand
 * in for a per-run approval. The agent it starts still meets `coupangLiveWalkRefusal` on boot and still refuses
 * unless the phase, the approval id, and the repository identity are all bound — this CLI only decides that a
 * process runs, never what it is allowed to do. It opens no browser, touches no marketplace, and reads no
 * credential.
 *
 * `install` is idempotent: an already-loaded job is booted out first, so re-running it after a code change
 * replaces the service rather than racing a second copy onto the same port.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildLocalAgentServicePlan,
  LOCAL_AGENT_SERVICE_LABEL,
  parseServiceEnvFile,
  renderLaunchAgentPlist,
  type LocalAgentServicePlan,
} from "../agent/local-agent-service";
import { decideApprovalPresenter } from "./local-agent";

const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Absolute — launchd inherits no useful PATH, and `spawn` here runs with `shell:false` for the same reason. */
const LAUNCHCTL = "/bin/launchctl";

/** How long to wait for the freshly-bootstrapped agent to answer on loopback before calling the install unproven. */
const HEALTH_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 500;

const DEFAULT_BRIDGE_PORT = 47615;

export const SERVICE_CLI_USAGE = [
  "Usage:",
  "  local-agent-service install --run-env <path> -- <agent args...>",
  "  local-agent-service status",
  "  local-agent-service uninstall",
].join("\n");

/** A single sanitized line; the CLI never prints an env value, a pairing detail, or a marketplace fact. */
function emit(body: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: "LOCAL_AGENT_SERVICE", ...body }));
}

function fail(reason: string, exitCode = 2): never {
  console.error(`[local-agent-service] ${reason}`);
  process.exit(exitCode);
}

/**
 * Split `install`'s own options from the arguments meant for the agent.
 *
 * Pure and exported: the boundary matters, because an agent flag that leaked into this CLI's option parsing (or
 * the reverse) would silently install a service running something other than what the operator wrote.
 */
export function splitServiceArgs(args: readonly string[]): { own: string[]; agentArgs: string[] } {
  const sep = args.indexOf("--");
  if (sep === -1) return { own: [...args], agentArgs: [] };
  return { own: args.slice(0, sep), agentArgs: args.slice(sep + 1) };
}

/** Read `--flag value`. Returns null when absent or valueless — never a partially-applied option. */
export function readOption(args: readonly string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  const value = args[i + 1] ?? "";
  return value === "" || value.startsWith("--") ? null : value;
}

function launchctl(...argv: string[]): { ok: boolean; status: number } {
  const res = spawnSync(LAUNCHCTL, argv, { shell: false, stdio: "ignore" });
  return { ok: res.status === 0, status: res.status ?? -1 };
}

function domainTarget(): string {
  // A GUI-session domain, not `system`: the job must run as the seller, in the Aqua session an approval dialog
  // can actually appear in.
  return `gui/${process.getuid?.() ?? 0}`;
}

interface BridgeHealth {
  ok: boolean;
  service?: string;
  agentVersion?: string;
  protocolVersion?: number;
}

async function probeHealth(port: number): Promise<BridgeHealth | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/bridge/health`);
    if (!res.ok) return null;
    const body = (await res.json()) as BridgeHealth;
    return body.ok === true && body.service === "sellerops-local-agent" ? body : null;
  } catch {
    return null;
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<BridgeHealth | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const health = await probeHealth(port);
    if (health) return health;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
}

function bridgePort(env: NodeJS.ProcessEnv): number {
  const raw = env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : DEFAULT_BRIDGE_PORT;
  return Number.isInteger(raw) && raw > 0 && raw <= 65535 ? raw : DEFAULT_BRIDGE_PORT;
}

function planFor(agentArgs: readonly string[], runEnv: Record<string, string>): LocalAgentServicePlan {
  const loaderPath = resolve(collectorRoot, "node_modules/tsx/dist/cli.mjs");
  const entrypoint = resolve(collectorRoot, "src/cli/local-agent.ts");
  // Existence is checked HERE and not in the pure builder: the builder decides whether a path is *allowed*, this
  // decides whether it is *there*. A plist naming a missing loader installs fine and then crash-loops silently
  // under KeepAlive, which reads to an operator exactly like "the agent does not work".
  if (!existsSync(loaderPath)) fail("tsx loader not found — run `npm install` in collector/ first.");
  if (!existsSync(entrypoint)) fail("agent entrypoint not found — collector/src/cli/local-agent.ts is missing.");

  const built = buildLocalAgentServicePlan(
    {
      platform: process.platform,
      homeDir: process.env.HOME ?? "",
      collectorRoot,
      nodePath: process.execPath,
      loaderPath,
      entrypoint,
      agentArgs,
      env: runEnv,
    },
    decideApprovalPresenter,
  );
  if (!built.ok) fail(`refused: ${built.refusal}`, 3);
  return built.plan;
}

async function install(own: readonly string[], agentArgs: readonly string[]): Promise<void> {
  if (agentArgs.length === 0) fail(`no agent arguments given.\n${SERVICE_CLI_USAGE}`);
  const runEnvPath = readOption(own, "--run-env");
  // The run-identity file is REQUIRED rather than optional. A service installed without it boots an agent whose
  // phase/approval bindings are empty, which the live-walk gate refuses — so the operator would be debugging a
  // running-but-refusing agent instead of reading one honest message here.
  if (!runEnvPath) fail(`--run-env <path> is required.\n${SERVICE_CLI_USAGE}`);
  if (!existsSync(runEnvPath)) fail("--run-env path does not exist.");
  const runEnv = parseServiceEnvFile(readFileSync(runEnvPath, "utf8"));
  if (Object.keys(runEnv).length === 0) fail("--run-env file carried no bindings.");

  const plan = planFor(agentArgs, runEnv);
  mkdirSync(dirname(plan.plistPath), { recursive: true });
  mkdirSync(resolve(collectorRoot, ".status"), { recursive: true });
  // 0600: the plist carries no secret by construction (the builder refuses secret-ish keys), but it also carries
  // the exact command the agent runs, and nothing outside this user needs to read or rewrite that.
  writeFileSync(plan.plistPath, renderLaunchAgentPlist(plan), { mode: 0o600 });

  // Replace, never race: an already-loaded job is booted out first so `install` is safe to re-run after any
  // code, branch, or approval change. A bootout failure is expected on a first install.
  launchctl("bootout", `${domainTarget()}/${plan.label}`);
  const boot = launchctl("bootstrap", domainTarget(), plan.plistPath);
  if (!boot.ok) {
    // Remove the file before refusing. launchd loads `~/Library/LaunchAgents` at login, so a plist left behind
    // by a FAILED install would quietly start the agent at the seller's next login — bound to an approval that
    // has long since been consumed, from an install nobody was told succeeded.
    rmSync(plan.plistPath, { force: true });
    fail(`launchctl bootstrap failed (status ${boot.status}); the plist was removed, nothing is installed.`, 4);
  }

  const port = bridgePort(process.env);
  const health = await waitForHealth(port, HEALTH_TIMEOUT_MS);
  emit({
    action: "install",
    label: plan.label,
    plistPath: plan.plistPath,
    approvalPresenter: plan.approvalPresenter,
    // Honest: the service is loaded either way, but only a health answer proves the agent actually came up.
    healthy: health !== null,
    ...(health ? { agentVersion: health.agentVersion, protocolVersion: health.protocolVersion } : {}),
  });
  if (!health) {
    console.error(
      "[local-agent-service] loaded, but the agent did not answer on loopback — check collector/.status/local-agent-service.err.log",
    );
    process.exit(5);
  }
}

async function status(): Promise<void> {
  const port = bridgePort(process.env);
  const loaded = launchctl("print", `${domainTarget()}/${LOCAL_AGENT_SERVICE_LABEL}`).ok;
  const health = await probeHealth(port);
  emit({
    action: "status",
    label: LOCAL_AGENT_SERVICE_LABEL,
    loaded,
    healthy: health !== null,
    ...(health ? { agentVersion: health.agentVersion, protocolVersion: health.protocolVersion } : {}),
  });
}

function uninstall(): void {
  const plistPath = resolve(process.env.HOME ?? "", "Library/LaunchAgents", `${LOCAL_AGENT_SERVICE_LABEL}.plist`);
  const out = launchctl("bootout", `${domainTarget()}/${LOCAL_AGENT_SERVICE_LABEL}`);
  rmSync(plistPath, { force: true });
  emit({ action: "uninstall", label: LOCAL_AGENT_SERVICE_LABEL, wasLoaded: out.ok, plistRemoved: !existsSync(plistPath) });
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  const { own, agentArgs } = splitServiceArgs(rest);
  switch (command) {
    case "install":
      return install(own, agentArgs);
    case "status":
      return status();
    case "uninstall":
      return void uninstall();
    default:
      fail(`unknown command ${command ? `'${command}'` : "(none)"}.\n${SERVICE_CLI_USAGE}`, 1);
  }
}

// Inert on import — the same rule every gated CLI in this package follows, so tests load it without effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
