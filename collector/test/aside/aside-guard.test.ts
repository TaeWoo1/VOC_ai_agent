/**
 * **Source guard for the Aside provider.** Discovery (G-1) found that Aside ships automation Reviewnary's fence
 * forbids — CAPTCHA solving, password autofill / auto-login, visual-browse (`cua`), the LLM `exec` agent.
 * "The developer decided not to call them" is not a fence. These tests make the forbidden surface structurally
 * absent from the provider's production path:
 *
 *  - no source file under `src/aside/` names a forbidden global, subcommand, or storage/evaluate primitive;
 *  - the CLI wrapper's allowed invocations are exactly `repl` and `--version`;
 *  - the workflow vocabulary is closed (no script/evaluate/navigate step);
 *  - the serialized runtime has no free reference beyond the one esbuild helper the preamble shims — proven by
 *    evaluating the real program text in an empty VM with only fake tab primitives;
 *  - every action in the runtime goes through the count-first primitive.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { ASIDE_ALLOWED_INVOCATIONS } from "../../src/aside/aside-cli";
import { buildRuntimePlan, buildRuntimeProgram, RUNTIME_PREAMBLE } from "../../src/aside/aside-export-executor";
import { EXPORT_STEP_KINDS, validateExportWorkflow } from "../../src/aside/export-workflow";
import { fixtureWorkflow } from "../support/aside-fixture";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const SRC = resolve(HERE, "../../src/aside");

/** Strip block comments and comment lines so prose mentioning a forbidden token never trips. */
function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

const FILES = readdirSync(SRC).filter((f) => f.endsWith(".ts"));

/** Tokens no Aside-provider source may contain. Word-ish matches; `password`/`captcha`/`cua` are Aside globals. */
const FORBIDDEN_TOKENS = [
  "captcha",
  "password",
  "cua.",
  "cua(",
  "\"cua\"",
  "chrome.",
  "chrome[",
  "fs.",
  "readFile(",
  "require(",
  "process.",
  ".evaluate(",
  "evaluateHandle",
  "addInitScript",
  "cookies(",
  "storageState",
  "localStorage",
  "sessionStorage",
  "display.",
  "aside.",
  "memory_search",
  "\"exec\"",
  "'exec'",
  "\"session\"",
  "\"steer\"",
  "\"queue\"",
  "\"login\"",
  "\"skills\"",
  "\"memory\"",
  "keyboard",
  "dispatchEvent",
  ".goto(",
  ".press(",
] as const;

describe("aside provider — forbidden capability tokens are absent from every source file", () => {
  it.each(FILES)("%s", (file) => {
    const code = codeOnly(resolve(SRC, file));
    for (const token of FORBIDDEN_TOKENS) {
      // `aside-cli.ts` legitimately names `process.execPath`? It does not — it uses child_process.spawn only.
      // `host-file-handoff.ts` reads a file, but through `node:fs` named imports (`readFileSync`), not `fs.`.
      expect(code, `${file} contains ${token}`).not.toContain(token);
    }
  });
});

describe("aside provider — the only CLI invocations are repl and --version", () => {
  it("the allow-list is exactly those two", () => {
    expect([...ASIDE_ALLOWED_INVOCATIONS]).toEqual(["repl", "--version"]);
  });
  it("the CLI wrapper spells no other Aside subcommand as a literal", () => {
    const code = codeOnly(resolve(SRC, "aside-cli.ts"));
    for (const sub of ["exec", "session", "account", "login", "logout", "host", "memory", "skills", "guide", "update", "settings", "mcp"]) {
      expect(code).not.toMatch(new RegExp(`["'\`]${sub}["'\`]`));
    }
    expect(code).toContain('"repl"');
  });
});

describe("aside provider — the workflow vocabulary is closed", () => {
  it("exactly FILL / SELECT / CLICK / WAIT_FOR", () => {
    expect([...EXPORT_STEP_KINDS]).toEqual(["FILL", "SELECT", "CLICK", "WAIT_FOR"]);
  });
  it("rejects a step kind outside the vocabulary and a workflow without an identity read", () => {
    const w = fixtureWorkflow("http://127.0.0.1:1/");
    expect(validateExportWorkflow(w)).toEqual([]);
    expect(validateExportWorkflow({ ...w, steps: [{ kind: "EVALUATE" as never, selector: "x", stage: "SCOPE" }] })).toContain("STEP_KIND_UNKNOWN");
    expect(validateExportWorkflow({ ...w, identity: undefined as never })).toContain("IDENTITY_INVALID");
    expect(validateExportWorkflow({ ...w, entryUrl: "javascript:alert(1)" })).toContain("ENTRY_URL_INVALID");
    expect(validateExportWorkflow({ ...w, steps: [{ kind: "CLICK", selector: "#x", value: "no", stage: "SCOPE" }] })).toContain("STEP_VALUE_INVALID");
  });
});

describe("aside provider — the serialized runtime is self-contained", () => {
  const program = buildRuntimeProgram(
    buildRuntimePlan(fixtureWorkflow("http://127.0.0.1:1/"), { runId: "run_000000000000", channelCode: "naver", accountSlot: "", required: { start: "2026-01-01", end: "2026-01-31" } }, "fixture-store-42"),
  );

  it("references no free helper beyond the esbuild name helper, and the preamble shims that one", () => {
    // Under `tsx` (keepNames) the serialized text carries `__name(...)`; under vitest's transform it carries
    // nothing. Either way the only helper allowed is the one the preamble defines.
    const fnText = program.slice(program.indexOf("const __run = ("));
    const free = [...new Set(fnText.match(/\b__[a-zA-Z]+\b/g) ?? [])].filter((id) => !["__run", "__plan", "__result"].includes(id));
    expect(free.every((id) => id === "__name")).toBe(true);
    expect(program.startsWith(RUNTIME_PREAMBLE)).toBe(true);
  });

  it("carries no forbidden token into Aside", () => {
    for (const token of FORBIDDEN_TOKENS) expect(program).not.toContain(token);
  });

  it("evaluates in an EMPTY context with only openTab/closeTab — no closure over this package", async () => {
    // Replace the final print with a return so the VM hands the result back.
    const body = program.replace(/console\.log\("ASIDE_RESULT " \+ JSON\.stringify\(__result\)\);$/, "return __result;");
    const calls: string[] = [];
    const page = {
      locator: (sel: string) => ({
        count: async () => (sel === "#login-form" ? 0 : 1),
        click: async () => void calls.push(`click:${sel}`),
        fill: async () => void calls.push(`fill:${sel}`),
        selectOption: async () => undefined,
        waitFor: async () => undefined,
        textContent: async () => "fixture-store-42",
        getAttribute: async () => null,
        inputValue: async () => (sel === "#start" ? "2026-01-01" : "2026-01-31"),
      }),
      waitForEvent: async () => ({ path: async () => "/vm/download.xlsx", suggestedFilename: () => "f.xlsx", failure: async () => null }),
    };
    const sandbox = {
      openTab: async () => page,
      closeTab: async () => void calls.push("closeTab"),
      Date,
      JSON,
      Object,
    };
    const result = (await runInNewContext(`(async () => { ${body} })()`, sandbox)) as { ok: boolean; hostPath?: string };
    expect(result.ok).toBe(true);
    expect(result.hostPath).toBe("/vm/download.xlsx");
    expect(calls).toEqual(["fill:#start", "fill:#end", "click:#apply", "click:.export", "closeTab"]);
  });

  it("every action call sites on the count-guarded handle, never directly on a fresh locator", () => {
    const code = codeOnly(resolve(SRC, "export-runtime.ts"));
    // Direct `locator(...).click()` chains would bypass the count.
    expect(code).not.toMatch(/locator\([^)]*\)\s*\.\s*(click|fill|selectOption)\(/);
    // The three actions appear only on the guarded handles.
    for (const action of [".click(", ".fill(", ".selectOption("]) {
      const sites = code.split(action).length - 1;
      expect(sites, `${action} sites`).toBeGreaterThan(0);
      for (const line of code.split("\n").filter((l) => l.includes(action))) {
        expect(line, line).toMatch(/\b(loc|ex\.loc)\b/);
      }
    }
  });
});
