/**
 * **The one way this package talks to Aside: `aside repl <program>`.**
 *
 * Aside (`docs/aside_capability_discovery_v1.md`) exposes two ways to drive its browser — `exec`, which hands a
 * prompt to an LLM agent, and `repl`, which runs Playwright-style JavaScript deterministically with no model
 * call. Reviewnary uses `repl` and nothing else. That is not a preference recorded in a comment; it is the
 * shape of this module: {@link ASIDE_ALLOWED_INVOCATIONS} is the closed list of argv heads this wrapper will
 * ever spawn, and `aside-guard.test.ts` reads the source to make sure no other literal exists.
 *
 * ## Result protocol
 *
 * A program prints exactly one line `ASIDE_RESULT <json>` on stdout when it has an answer. Everything else on
 * stdout (Aside's own "opened a tab (url)" line, timing badges) is noise and is never returned or logged — a
 * tab line contains the URL. Aside exits 0 even when the program throws (observed 2026-09-12: the error goes to
 * stderr, exit code stays 0), so the exit code carries no signal; the presence of the result line does.
 *
 * ## What comes out
 *
 * Only the parsed result or a closed classification. Never stdout text, never stderr text, never the program.
 */
import { spawn } from "node:child_process";

/** The ONLY argv heads this package may hand to the Aside CLI. `--version` is a flag, not a session. */
export const ASIDE_ALLOWED_INVOCATIONS = ["repl", "--version"] as const;
export type AsideInvocation = (typeof ASIDE_ALLOWED_INVOCATIONS)[number];

/** The stdout line prefix a program uses to hand its answer back. */
export const ASIDE_RESULT_PREFIX = "ASIDE_RESULT " as const;

/** Aside's own per-call ceiling for `repl` (schema-stated, discovery §2). We never wait longer than it. */
export const ASIDE_REPL_CEILING_MS = 120_000;

export interface AsideCliOptions {
  /** The executable. Default `aside` on PATH. Tests point it at a script. */
  command?: string;
  /** Arguments placed before the invocation (tests: `[fakeScript]` with `command: process.execPath`). */
  prefixArgs?: readonly string[];
  /** `--account <id>`, when the seller's Aside has more than one. Opaque; never logged. */
  account?: string;
  /** Our own wall-clock ceiling for one call. Clamped to {@link ASIDE_REPL_CEILING_MS}. */
  timeoutMs?: number;
}

/** Why there was no result line. Closed set; the only thing a caller ever learns about a failed call. */
export type AsideNoResultKind =
  /** The CLI is not installed, or the daemon/browser is not running. */
  | "UNAVAILABLE"
  /** The CLI refused before running anything (unknown account, permission). */
  | "REFUSED"
  /** Our ceiling elapsed. */
  | "TIMEOUT"
  /** The program ran but produced no parsable result (a thrown error, malformed output). */
  | "FAULT";

export type AsideReplRun =
  | { kind: "RESULT"; result: unknown; elapsedMs: number }
  | { kind: "NO_RESULT"; reason: AsideNoResultKind; elapsedMs: number };

/**
 * Pure: classify the CLI's stderr/stdout text when no result line came back. The text itself goes no further
 * than this function. Patterns come from observation (discovery §9: `ECONNREFUSED 127.0.0.1:21420` /
 * "Aside isn't running" when the app is closed; `Account not found` on a bad `--account`).
 */
export function classifyAsideNoResult(text: string, exitCode: number | null): AsideNoResultKind {
  if (/isn['’]t running|is not running|not running|ECONNREFUSED|failed to connect|daemon/i.test(text)) return "UNAVAILABLE";
  if (/Account not found|permission|not allowed|denied/i.test(text)) return "REFUSED";
  if (exitCode !== null && exitCode !== 0 && text.trim().length === 0) return "UNAVAILABLE";
  return "FAULT";
}

/** Pure: the LAST result line wins; a non-JSON payload is a fault, not a result. */
export function parseAsideResultLine(stdout: string): { found: true; result: unknown } | { found: false; malformed: boolean } {
  const lines = stdout.split(/\r?\n/);
  let payload: string | null = null;
  for (const line of lines) {
    const at = line.indexOf(ASIDE_RESULT_PREFIX);
    if (at >= 0) payload = line.slice(at + ASIDE_RESULT_PREFIX.length).trim();
  }
  if (payload === null) return { found: false, malformed: false };
  try {
    return { found: true, result: JSON.parse(payload) as unknown };
  } catch {
    return { found: false, malformed: true };
  }
}

function argvFor(invocation: AsideInvocation, opts: AsideCliOptions, program: string | null): string[] {
  const args: string[] = [...(opts.prefixArgs ?? []), invocation];
  if (invocation === "repl") {
    if (opts.account) args.push("--account", opts.account);
    if (program !== null) args.push(program);
  }
  return args;
}

interface SpawnCapture {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError: NodeJS.ErrnoException | null;
  timedOut: boolean;
}

function spawnCapture(command: string, args: readonly string[], timeoutMs: number): Promise<SpawnCapture> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const done = (capture: Omit<SpawnCapture, "stdout" | "stderr" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, ...capture });
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => done({ exitCode: null, spawnError: err }));
    child.on("close", (code) => done({ exitCode: code, spawnError: null }));
  });
}

/**
 * Run one deterministic program in Aside's browser. Never throws: every failure is a closed
 * {@link AsideNoResultKind}. Never logs; the caller decides what is sanitized enough to record.
 */
export async function runAsideRepl(program: string, opts: AsideCliOptions = {}): Promise<AsideReplRun> {
  const command = opts.command ?? "aside";
  const timeoutMs = Math.min(opts.timeoutMs ?? ASIDE_REPL_CEILING_MS, ASIDE_REPL_CEILING_MS);
  const t0 = Date.now();
  const capture = await spawnCapture(command, argvFor("repl", opts, program), timeoutMs);
  const elapsedMs = Date.now() - t0;
  if (capture.spawnError) {
    // ENOENT / EACCES: the CLI itself is not there. Anything else spawn-level is still "cannot run it".
    return { kind: "NO_RESULT", reason: "UNAVAILABLE", elapsedMs };
  }
  if (capture.timedOut) return { kind: "NO_RESULT", reason: "TIMEOUT", elapsedMs };
  const parsed = parseAsideResultLine(capture.stdout);
  if (parsed.found) return { kind: "RESULT", result: parsed.result, elapsedMs };
  if (parsed.malformed) return { kind: "NO_RESULT", reason: "FAULT", elapsedMs };
  return { kind: "NO_RESULT", reason: classifyAsideNoResult(`${capture.stderr}\n${capture.stdout}`, capture.exitCode), elapsedMs };
}

/** `aside --version`, or null when it cannot be read. The only other invocation this package makes. */
export async function readAsideCliVersion(opts: AsideCliOptions = {}): Promise<string | null> {
  const command = opts.command ?? "aside";
  const capture = await spawnCapture(command, argvFor("--version", opts, null), 10_000);
  if (capture.spawnError || capture.timedOut || capture.exitCode !== 0) return null;
  const line = capture.stdout.trim().split(/\r?\n/)[0] ?? "";
  return /^[0-9][0-9A-Za-z.\-]*$/.test(line) ? line : null;
}
