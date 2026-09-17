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
import { buildReviewRuntimePlan, buildReviewRuntimeProgram } from "../../src/aside/coupang-review-executor";
import { COUPANG_REVIEW_READ_WORKFLOW } from "../../src/aside/coupang-review-workflow";
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

/**
 * `.evaluate(` is forbidden EXCEPT in the files whose job is to forward this repository's own page scripts — a
 * review list cannot be read without running a reader in the page. The exemption is narrower than the ban it
 * replaces: a forwarder may not AUTHOR page code, which the dedicated describe below asserts OF EVERY FORWARDER, so
 * "arbitrary evaluate" remains structurally impossible rather than merely unused.
 *
 * The list is explicit and each entry is a decision: the NAVER Seller Center review runtime was added with the
 * operator's single-file approval (2026-09-17) for exactly this shape — wait for the grid, read rows, close the tab.
 */
const EVALUATE_FORWARDERS = ["coupang-review-runtime.ts", "naver-review-runtime.ts"] as const;

describe("aside provider — forbidden capability tokens are absent from every source file", () => {
  it.each(FILES)("%s", (file) => {
    const code = codeOnly(resolve(SRC, file));
    for (const token of FORBIDDEN_TOKENS) {
      if (token === ".evaluate(" && (EVALUATE_FORWARDERS as readonly string[]).includes(file)) continue;
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


describe.each(EVALUATE_FORWARDERS)("aside provider — the evaluate forwarder %s forwards, and cannot author page code", (EVALUATE_FORWARDER) => {
  const code = codeOnly(resolve(SRC, EVALUATE_FORWARDER));

  it("names no DOM API and no selector of its own", () => {
    for (const token of ["document.", "querySelector", "getElementById", "innerHTML", "innerText", "window."]) {
      expect(code, `${EVALUATE_FORWARDER} contains ${token}`).not.toContain(token);
    }
  });

  it("holds no string literal long enough to be a script — page code lives in the reviewed in-page modules", () => {
    const literals = code.match(/"[^"\n]*"|'[^'\n]*'/g) ?? [];
    for (const lit of literals) expect(lit.length, lit.slice(0, 40)).toBeLessThan(40);
  });

  it("every evaluate argument is a named plan field, never an expression", () => {
    const args = [...code.matchAll(/\.evaluate\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(args.length).toBeGreaterThan(0);
    for (const a of args) expect(a, a).toMatch(/^plan\.[a-zA-Z]+Script$/);
  });

  it("cannot turn a page: no click, no pager, no second navigation", () => {
    for (const token of [".click(", ".fill(", ".press(", ".goto(", ".type(", "setInputFiles", "waitForEvent",
      "nextPage", "pager"]) {
      expect(code, `${EVALUATE_FORWARDER} contains ${token}`).not.toContain(token);
    }
  });
});

describe("aside provider — the Coupang runtime is self-contained and fails closed in order", () => {
  const plan = buildReviewRuntimePlan(COUPANG_REVIEW_READ_WORKFLOW);

  /** Run the serialized program in an empty VM against a described page. */
  async function runInVm(page: {
    auth: { signedIn: boolean };
    identity?: unknown;
    rows?: unknown;
    throwOn?: string;
  }): Promise<{ calls: string[]; result: Record<string, unknown> }> {
    const program = buildReviewRuntimeProgram(plan);
    const body = program.replace(/console\.log\("ASIDE_RESULT " \+ JSON\.stringify\(__result\)\);$/, "return __result;");
    const calls: string[] = [];
    const tab = {
      waitForLoadState: async () => undefined,
      evaluate: async (script: string) => {
        const which = script === plan.authScript ? "auth" : script === plan.identityScript ? "identity" : script === plan.readerScript ? "rows" : "UNKNOWN";
        calls.push(which);
        if (which === "UNKNOWN") throw new Error("a script that is not one of the three plan fields reached the page");
        if (page.throwOn === which) throw new Error("page moved");
        return which === "auth" ? page.auth : which === "identity" ? page.identity : page.rows;
      },
    };
    const sandbox = { openTab: async () => (calls.push("openTab"), tab), closeTab: async () => void calls.push("closeTab"), Date, JSON, Object };
    const result = (await runInNewContext(`(async () => { ${body} })()`, sandbox)) as Record<string, unknown>;
    return { calls, result };
  }

  it("references no free helper beyond the esbuild name helper", () => {
    const program = buildReviewRuntimeProgram(plan);
    const fnText = program.slice(program.indexOf("const __run = ("));
    const free = [...new Set(fnText.match(/\b__[a-zA-Z]+\b/g) ?? [])].filter((id) => !["__run", "__plan", "__result"].includes(id));
    expect(free.every((id) => id === "__name")).toBe(true);
  });

  it("carries no forbidden token into Aside", () => {
    // Two exemptions, both narrower than the ban they replace:
    //  - `.evaluate(` — the forwarder's whole job, and the describe above proves it can only forward.
    //  - the `input[type="password"]` SELECTOR inside the auth script. The banned capability is Aside's
    //    `password` global (auto-login); this is the opposite act — COUNTING a sign-in field in order to
    //    REFUSE. A guard that could not tell those apart would forbid the fail-closed check.
    const program = buildReviewRuntimeProgram(plan);
    // The two allowed forms, both from the sign-in-wall check: the FIELD SELECTOR, and the COUNT it reports.
    // Everything else named `password` is the banned capability (Aside's auto-login global), so removing
    // exactly these two and re-scanning is the whole test.
    const allowed = ['input[type=\\"password\\"]', "passwordInputs"];
    let scrubbed = program;
    for (const form of allowed) {
      expect(scrubbed, form).toContain(form);
      scrubbed = scrubbed.split(form).join("SIGNIN_FIELD");
    }
    expect(scrubbed).not.toContain("password");
    for (const token of FORBIDDEN_TOKENS) {
      if (token === ".evaluate(") continue;
      expect(scrubbed, token).not.toContain(token);
    }
  });

  it("the one password mention is counted, never read or filled", () => {
    const program = buildReviewRuntimeProgram(plan);
    for (const line of program.split("\n").filter((l) => l.includes("password"))) {
      expect(line, line).toContain(".length");
      expect(line, line).not.toMatch(/\.(fill|type|value\s*=)/);
    }
  });

  it("happy path: auth, then identity, then rows — in that order, and the tab is closed", async () => {
    const { calls, result } = await runInVm({ auth: { signedIn: true }, identity: { labelHits: 2, distinct: 1, values: ["A00000001"] }, rows: { reason: "OK", rows: [] } });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["openTab", "auth", "identity", "rows", "closeTab"]);
  });

  it("a signed-out browser stops at AUTH — no identity read, no row read", async () => {
    const { calls, result } = await runInVm({ auth: { signedIn: false } });
    expect(result).toMatchObject({ ok: false, code: "AUTH_REQUIRED", stage: "AUTH" });
    expect(calls).toEqual(["openTab", "auth", "closeTab"]);
  });

  it("an identity read that throws stops before the rows", async () => {
    const { calls, result } = await runInVm({ auth: { signedIn: true }, throwOn: "identity" });
    expect(result).toMatchObject({ ok: false, code: "RUNTIME_FAULT", stage: "IDENTITY" });
    expect(calls).toEqual(["openTab", "auth", "identity", "closeTab"]);
  });
});
