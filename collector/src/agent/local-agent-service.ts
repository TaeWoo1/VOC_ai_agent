/**
 * **The macOS AgentLifecycle autostart adapter — the Local Agent as an installed background service.**
 *
 * The ADR (`docs/sellerops_local_agent_runtime_adr.md` §3.3) names 기동/종료/자동시작 as the AgentLifecycle
 * boundary and records its adapters as 미구현: no tray, no installer, no OS autostart. That gap is what forces
 * an operator to start the agent in a terminal — and a terminal-started agent is not the product path, because
 * the seller then reads their pairing code off a developer console instead of the product's own approval
 * channel.
 *
 * A web page cannot spawn a local process, so "the frontend launches the agent" is not implementable and this
 * module does not pretend otherwise. What it implements is the shape an installed product actually has: the
 * agent runs as a **launchd user agent in the seller's GUI session**, already up before SellerOps is opened, and
 * the frontend simply finds it on loopback. That is the same posture an installer would leave behind.
 *
 * Two properties are load-bearing and are enforced here rather than left to whoever writes the plist:
 *
 *  - **the service host must have a real human approval channel.** A launchd job has no TTY, so the DEV stderr
 *    presenter can never reach a person from here — pairing would fail closed on every attempt, which is exactly
 *    the failure this adapter exists to remove. The plan therefore pins `NODE_ENV=production` and REFUSES unless
 *    the presenter that decision produces is the native one. `LimitLoadToSessionType: Aqua` is part of the same
 *    guard: an osascript dialog needs a GUI session to appear in.
 *  - **a plist is not a secret store.** `~/Library/LaunchAgents` is readable by anything running as the user, and
 *    `launchctl print` echoes the environment back. Secret-ish keys are refused outright, on the same key list
 *    the logger uses, so the service can never become a quieter way to spill a token.
 *
 * Everything here is pure: it builds a plan and renders text. Writing the file and driving `launchctl` is the
 * CLI's job (`cli/local-agent-service.ts`), which is what keeps every refusal testable without touching launchd.
 */
import { isAbsolute, resolve, sep } from "node:path";

/** The service's reverse-DNS launchd label. Stable: it is the identity `launchctl bootout` addresses. */
export const LOCAL_AGENT_SERVICE_LABEL = "ai.sellerops.local-agent";

/**
 * Secret-ish env keys, refused in a plist. Deliberately the SAME list `log.ts` drops from metadata — a value
 * that is too sensitive to log is too sensitive to write into a world-readable property list.
 */
const FORBIDDEN_ENV_KEY_SUBSTRINGS = [
  "token",
  "password",
  "passwd",
  "cookie",
  "authorization",
  "secret",
  "credential",
  "session",
];

/**
 * Keys the BUILDER owns. A caller that sets these is not configuring the service, it is overriding the guard
 * that makes the service pairable, so it is refused rather than merged.
 */
const RESERVED_ENV_KEYS = ["NODE_ENV"];

export const LOCAL_AGENT_SERVICE_REFUSALS = [
  "UNSUPPORTED_PLATFORM",
  "NO_HUMAN_APPROVAL_CHANNEL",
  "NODE_NOT_ABSOLUTE",
  "ENTRYPOINT_OUTSIDE_TREE",
  "NO_AGENT_ARGUMENTS",
  "RESERVED_ENV_KEY",
  "SECRET_ENV_KEY",
  "UNPRINTABLE_ENV_VALUE",
] as const;
export type LocalAgentServiceRefusal = (typeof LOCAL_AGENT_SERVICE_REFUSALS)[number];

export interface LocalAgentServiceInput {
  platform: string;
  /** The user's home directory — where the LaunchAgents directory lives. */
  homeDir: string;
  /** The collector package root. The working directory, and the tree every executable path must stay inside. */
  collectorRoot: string;
  /** Absolute path to the node binary. launchd inherits almost no PATH, so a bare `node` would not resolve. */
  nodePath: string;
  /** Absolute path to the TS loader CLI (`node_modules/.bin/tsx` resolves to a `.mjs` node runs directly). */
  loaderPath: string;
  /** Absolute path to the agent entrypoint. */
  entrypoint: string;
  /** Arguments passed to the entrypoint — the connections file, the carrier flag. Never empty. */
  agentArgs: readonly string[];
  /** Run-identity bindings for the plist environment. Sanitized only; secrets are refused. */
  env: Readonly<Record<string, string>>;
}

export interface LocalAgentServicePlan {
  label: string;
  /** Where the plist is written. Under the user's own LaunchAgents directory — a user agent, never system-wide. */
  plistPath: string;
  programArguments: readonly string[];
  workingDirectory: string;
  env: Readonly<Record<string, string>>;
  stdoutPath: string;
  stderrPath: string;
  /** The presenter kind this host will boot with. Recorded so the operator can see WHY pairing can work. */
  approvalPresenter: string;
}

export type LocalAgentServicePlanResult =
  | { ok: true; plan: LocalAgentServicePlan }
  | { ok: false; refusal: LocalAgentServiceRefusal };

/** Whether `child` is `parent` itself or sits underneath it — the same containment posture as the profile guard. */
function isInsideTree(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * XML 1.0 forbids most C0 control characters outright, and a value carrying one would either break the parse or
 * survive as something the operator cannot see. DEL is included for the same reason.
 */
function hasUnprintable(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\x7f]/.test(value);
}

/**
 * Build the launchd plan, or refuse.
 *
 * `decidePresenter` is injected rather than imported so this module stays free of the CLI composition root (the
 * decision lives in `cli/local-agent.ts` on purpose) while the refusal that depends on it stays testable here.
 */
export function buildLocalAgentServicePlan(
  input: LocalAgentServiceInput,
  decidePresenter: (env: NodeJS.ProcessEnv, platform: string) => string,
): LocalAgentServicePlanResult {
  if (input.platform !== "darwin") return { ok: false, refusal: "UNSUPPORTED_PLATFORM" };
  if (input.agentArgs.length === 0) return { ok: false, refusal: "NO_AGENT_ARGUMENTS" };
  if (!isAbsolute(input.nodePath)) return { ok: false, refusal: "NODE_NOT_ABSOLUTE" };
  if (!isInsideTree(input.collectorRoot, input.loaderPath) || !isInsideTree(input.collectorRoot, input.entrypoint)) {
    return { ok: false, refusal: "ENTRYPOINT_OUTSIDE_TREE" };
  }

  for (const [key, value] of Object.entries(input.env)) {
    const lower = key.toLowerCase();
    if (RESERVED_ENV_KEYS.some((r) => r.toLowerCase() === lower)) return { ok: false, refusal: "RESERVED_ENV_KEY" };
    if (FORBIDDEN_ENV_KEY_SUBSTRINGS.some((f) => lower.includes(f))) return { ok: false, refusal: "SECRET_ENV_KEY" };
    if (hasUnprintable(value) || hasUnprintable(key)) return { ok: false, refusal: "UNPRINTABLE_ENV_VALUE" };
  }

  // Sorted so the rendered plist is byte-stable across installs — an operator diffing it sees real changes only.
  const env: Record<string, string> = {};
  for (const key of Object.keys(input.env).sort()) env[key] = input.env[key] ?? "";
  // The builder's own key, set last so nothing above can have displaced it.
  env.NODE_ENV = "production";

  // The whole point of the adapter: a job with no TTY must still be able to show a human an approval code.
  const approvalPresenter = decidePresenter(env as NodeJS.ProcessEnv, input.platform);
  if (approvalPresenter !== "macos_native") return { ok: false, refusal: "NO_HUMAN_APPROVAL_CHANNEL" };

  return {
    ok: true,
    plan: {
      label: LOCAL_AGENT_SERVICE_LABEL,
      plistPath: resolve(input.homeDir, "Library/LaunchAgents", `${LOCAL_AGENT_SERVICE_LABEL}.plist`),
      programArguments: [input.nodePath, input.loaderPath, input.entrypoint, ...input.agentArgs],
      workingDirectory: resolve(input.collectorRoot),
      env,
      // `.status/` is already the collector's gitignored runtime area, so service logs cannot be staged by
      // accident. The agent's stdout is sanitized JSON by contract.
      stdoutPath: resolve(input.collectorRoot, ".status", "local-agent-service.out.log"),
      stderrPath: resolve(input.collectorRoot, ".status", "local-agent-service.err.log"),
      approvalPresenter,
    },
  };
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render the plan as a launchd property list.
 *
 * Every interpolated value is escaped: a label or env value containing `</string>` would otherwise close the
 * element and let arbitrary launchd keys — `Program`, another `ProgramArguments` — be appended by whoever
 * controls that string.
 */
export function renderLaunchAgentPlist(plan: LocalAgentServicePlan): string {
  const args = plan.programArguments.map((a) => `    <string>${xml(a)}</string>`).join("\n");
  const env = Object.entries(plan.env)
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(plan.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(plan.workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>${xml(plan.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(plan.stderrPath)}</string>
</dict>
</plist>
`;
}

/**
 * Parse a `KEY='value'` run-identity file into a plain map.
 *
 * Deliberately minimal: comments, blanks, and one optional layer of matching quotes. It is NOT a shell parser —
 * no interpolation, no escapes, no `export` — because anything it silently mis-parsed would end up in the
 * service environment as a wrong run binding, and a wrong binding is what the live-walk gate exists to catch.
 * A malformed line is skipped, never guessed at.
 */
export function parseServiceEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
