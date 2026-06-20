import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HYDRATION_TIMEOUT_MS, waitForSpaHydration } from "../../src/naver/hydration";
import type { PwPage } from "../../src/profile";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Call = { method: string; args: unknown[] };

interface Fake {
  page: PwPage;
  calls: Call[];
  /** The predicate the helper handed to `waitForFunction`, captured for inspection. */
  predicate?: () => boolean;
  /** The options the helper passed (to assert the timeout budget). */
  opts?: { timeout?: number };
}

/**
 * Minimal recording page. Every method records its call so we can prove the helper
 * touches NOTHING but `waitForFunction`. `waitForFunction` itself is driven by `behavior`:
 * omit it entirely (offline surface), resolve it (hydrated), or reject it (timeout/error).
 */
function fakePage(behavior: {
  omit?: boolean;
  resolve?: boolean;
  reject?: Error;
}): Fake {
  const calls: Call[] = [];
  const fake: Fake = { calls } as Fake;
  const guard = (method: string) =>
    async (...args: unknown[]): Promise<never> => {
      calls.push({ method, args });
      throw new Error(`${method} must not be called by the hydration wait`);
    };
  const page: Record<string, unknown> = {
    url: () => "https://sell.smartstore.naver.com/",
    content: guard("content"),
    goto: guard("goto"),
    click: guard("click"),
    waitForEvent: guard("waitForEvent"),
  };
  if (!behavior.omit) {
    page.waitForFunction = async (
      predicate: () => boolean,
      arg: unknown,
      opts?: { timeout?: number },
    ): Promise<unknown> => {
      calls.push({ method: "waitForFunction", args: [predicate, arg, opts] });
      fake.predicate = predicate;
      fake.opts = opts;
      if (behavior.reject) throw behavior.reject;
      return undefined;
    };
  }
  fake.page = page as unknown as PwPage;
  return fake;
}

function timeoutError(): Error {
  const e = new Error("Timeout exceeded");
  e.name = "TimeoutError";
  return e;
}

describe("waitForSpaHydration — result mapping", () => {
  it("offline surface with no waitForFunction → not-attempted (and never tries to wait)", async () => {
    const fake = fakePage({ omit: true });
    expect(await waitForSpaHydration(fake.page)).toBe("not-attempted");
    expect(fake.calls).toEqual([]); // nothing was called at all
  });

  it("predicate settles → hydrated", async () => {
    const fake = fakePage({ resolve: true });
    expect(await waitForSpaHydration(fake.page)).toBe("hydrated");
  });

  it("TimeoutError → timeout (safe: caller still reads whatever rendered)", async () => {
    const fake = fakePage({ reject: timeoutError() });
    expect(await waitForSpaHydration(fake.page)).toBe("timeout");
  });

  it("any other rejection → error (never masked as hydrated)", async () => {
    const fake = fakePage({ reject: new Error("navigation interrupted") });
    expect(await waitForSpaHydration(fake.page)).toBe("error");
  });
});

describe("waitForSpaHydration — bounded budget", () => {
  it("defaults to HYDRATION_TIMEOUT_MS", async () => {
    const fake = fakePage({ resolve: true });
    await waitForSpaHydration(fake.page);
    expect(fake.opts?.timeout).toBe(HYDRATION_TIMEOUT_MS);
  });

  it("honours an explicit timeoutMs override", async () => {
    const fake = fakePage({ resolve: true });
    await waitForSpaHydration(fake.page, { timeoutMs: 1234 });
    expect(fake.opts?.timeout).toBe(1234);
  });
});

describe("waitForSpaHydration — predicate waits for SPA-root hydration only", () => {
  /** Run the captured browser predicate against a stubbed `document`. */
  function evalPredicate(predicate: () => boolean, root: { childElementCount: number } | null): boolean {
    const original = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { querySelector: () => root };
    try {
      return predicate();
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
  }

  it("true only once the app root has children; false when empty or absent", async () => {
    const fake = fakePage({ resolve: true });
    await waitForSpaHydration(fake.page);
    const predicate = fake.predicate;
    expect(predicate).toBeTypeOf("function");
    expect(evalPredicate(predicate!, { childElementCount: 3 })).toBe(true); // hydrated
    expect(evalPredicate(predicate!, { childElementCount: 0 })).toBe(false); // shell, not hydrated
    expect(evalPredicate(predicate!, null)).toBe(false); // no SPA root (e.g. login page)
  });
});

describe("waitForSpaHydration — no side effects (read-only, no click/nav/capture)", () => {
  it("touches ONLY waitForFunction across the run", async () => {
    const fake = fakePage({ resolve: true });
    await waitForSpaHydration(fake.page);
    expect(fake.calls.map((c) => c.method)).toEqual(["waitForFunction"]);
  });
});

describe("hydration.ts — purity source guard (no click/nav/capture/persist path)", () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "hydration.ts");
  const code = stripComments(readFileSync(SRC_PATH, "utf8"));

  for (const token of [
    ".click(",
    ".fill(",
    ".press(",
    "dispatchEvent",
    "waitForEvent",
    ".goto(",
    "saveAs",
    "runExport",
    "writeStatus",
    ".content(",
  ]) {
    it(`executable source contains no \`${token}\``, () => {
      expect(code.includes(token)).toBe(false);
    });
  }

  it("imports no live browser / fs / network module (a type-only profile import is erased)", () => {
    const importLines = code
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/from\s+["']playwright["']/.test(imports)).toBe(false);
    expect(/from\s+["']node:fs["']/.test(imports)).toBe(false);
    expect(/from\s+["']node:https?["']/.test(imports)).toBe(false);
  });
});
