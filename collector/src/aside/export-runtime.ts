/**
 * **The program that runs INSIDE Aside's browser — one function, shipped by `toString()`.**
 *
 * This function is executed in two places with the same source text: in Aside's `repl` (the Runner serializes
 * it with `Function.prototype.toString` and sends it as the program), and in the offline test suite (called
 * directly with a fake page). That is what makes the fail-closed choreography testable without Aside: the code
 * the test exercises IS the code the browser runs.
 *
 * Two consequences the reader must keep true:
 *
 *  1. **No closure.** Nothing here may reference an import or a module-level identifier — the text is
 *     evaluated where none of them exist. `aside-guard.test.ts` runs the serialized text in an empty `vm`
 *     context to prove it. Plain JavaScript semantics only (no TS-only syntax that survives into the text).
 *  2. **Every action is `count() === 1` first.** Aside's locators run with Playwright strict mode OFF
 *     (discovery G-2: two matches ⇒ the first is clicked, silently). So no locator here is ever acted on
 *     directly: {@link one} counts, and only a single match becomes an actionable handle. Zero and many both
 *     fail closed, with the count reported.
 *
 * What it never does: log in, solve anything, read storage, evaluate arbitrary page script, navigate anywhere
 * but the entry URL, or click anything the workflow did not name. The globals Aside offers for those
 * (`captcha`, `password`, `cua`, `chrome`, `fs`) are not in {@link AsideRuntimeEnv} and the guard test asserts
 * the source never names them.
 *
 * Output is sanitized by construction: codes, stages, counts, a verdict, and — on success — the host path of
 * the download, which the Runner consumes in-process and never logs.
 */

/** The minimal page surface the runtime needs. Playwright's `Page` (as Aside exposes it) satisfies it. */
export interface RuntimeLocatorLike {
  count(): Promise<number>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  selectOption(value: string): Promise<unknown>;
  waitFor(opts?: { timeout?: number }): Promise<void>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  inputValue(): Promise<string>;
}

export interface RuntimeDownloadLike {
  path(): Promise<string | null>;
  suggestedFilename(): string;
  failure?(): Promise<string | null>;
}

export interface RuntimePageLike {
  locator(selector: string): RuntimeLocatorLike;
  waitForEvent(event: "download", opts?: { timeout?: number }): Promise<RuntimeDownloadLike>;
  waitForLoadState?(state?: string): Promise<void>;
}

/** The ONLY globals the program receives from Aside. `openTab` / `closeTab` are Aside's own (discovery §2). */
export interface AsideRuntimeEnv {
  openTab(url: string): Promise<RuntimePageLike>;
  closeTab(page: RuntimePageLike): Promise<void>;
}

/** The fully resolved plan the Runner builds from a workflow + request. Values only; no functions. */
export interface ExportRuntimePlan {
  entryUrl: string;
  authSignals: readonly string[];
  identity: { selector: string; read: "TEXT" | "ATTRIBUTE"; attribute?: string; expected: string };
  steps: readonly { kind: "FILL" | "SELECT" | "CLICK" | "WAIT_FOR"; selector: string; value?: string; stage: "NAVIGATE" | "SCOPE" | "EXPORT" }[];
  scopeReadback: { start: string; end: string } | null;
  required: { start: string; end: string };
  exportSelector: string;
  downloadTimeoutMs: number;
  stepTimeoutMs: number;
}

export type ExportRuntimeResult =
  | {
      ok: true;
      hostPath: string;
      suggestedName: string;
      identity: "MATCH";
      scopeEvidence: "MACHINE_MATCHED" | "OPERATOR_CONFIRMED";
      elapsedMs: number;
    }
  | {
      ok: false;
      code:
        | "UNSUPPORTED_STATE"
        | "AUTH_REQUIRED"
        | "STORE_UNRESOLVED"
        | "STORE_MISMATCH"
        | "TARGET_NOT_FOUND"
        | "TARGET_AMBIGUOUS"
        | "SCOPE_UNREADABLE"
        | "SCOPE_MISMATCH"
        | "DOWNLOAD_TIMEOUT"
        | "RUNTIME_FAULT";
      stage: "PREPARE" | "AUTH" | "IDENTITY" | "NAVIGATE" | "SCOPE" | "EXPORT" | "DOWNLOAD" | "EXECUTOR";
      candidates?: number;
      elapsedMs: number;
    };

/**
 * Run one bounded export. See the module note for the two invariants. Keep this function free of any
 * reference to module scope — it is serialized.
 */
export async function asideExportRuntime(plan: ExportRuntimePlan, env: AsideRuntimeEnv): Promise<ExportRuntimeResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const fail = (
    code: Extract<ExportRuntimeResult, { ok: false }>["code"],
    stage: Extract<ExportRuntimeResult, { ok: false }>["stage"],
    candidates?: number,
  ): ExportRuntimeResult => {
    const r: Extract<ExportRuntimeResult, { ok: false }> = { ok: false, code, stage, elapsedMs: elapsed() };
    if (typeof candidates === "number") r.candidates = candidates;
    return r;
  };
  let page: RuntimePageLike | null = null;
  try {
    try {
      page = await env.openTab(plan.entryUrl);
    } catch (e) {
      return fail("UNSUPPORTED_STATE", "PREPARE");
    }
    if (typeof page.waitForLoadState === "function") {
      try {
        await page.waitForLoadState("domcontentloaded");
      } catch (e) {
        /* the settle is best-effort; the identity read below is the real readiness check */
      }
    }
    const opened = page;

    // The fail-closed primitive: count first, act on exactly one.
    const one = async (
      selector: string,
      stage: Extract<ExportRuntimeResult, { ok: false }>["stage"],
    ): Promise<{ loc: RuntimeLocatorLike; err?: undefined } | { loc?: undefined; err: ExportRuntimeResult }> => {
      const loc = opened.locator(selector);
      let n = 0;
      try {
        n = await loc.count();
      } catch (e) {
        return { err: fail("RUNTIME_FAULT", stage) };
      }
      if (n === 0) return { err: fail("TARGET_NOT_FOUND", stage, 0) };
      if (n > 1) return { err: fail("TARGET_AMBIGUOUS", stage, n) };
      return { loc };
    };

    // AUTH — any signal present means a person authenticates. Nothing here proceeds past it.
    for (const sel of plan.authSignals) {
      let n = 0;
      try {
        n = await opened.locator(sel).count();
      } catch (e) {
        n = 0;
      }
      if (n > 0) return fail("AUTH_REQUIRED", "AUTH");
    }

    // IDENTITY — exactly one element, a non-empty read, an exact match. Anything less is not a success.
    const idLoc = opened.locator(plan.identity.selector);
    let idCount = 0;
    try {
      await idLoc.waitFor({ timeout: plan.stepTimeoutMs });
      idCount = await idLoc.count();
    } catch (e) {
      idCount = 0;
    }
    if (idCount !== 1) return fail("STORE_UNRESOLVED", "IDENTITY", idCount);
    let observed: string | null = null;
    try {
      observed =
        plan.identity.read === "ATTRIBUTE"
          ? await idLoc.getAttribute(plan.identity.attribute || "")
          : await idLoc.textContent();
    } catch (e) {
      observed = null;
    }
    const want = (plan.identity.expected || "").trim();
    const got = (observed || "").trim();
    if (want.length === 0 || got.length === 0) return fail("STORE_UNRESOLVED", "IDENTITY", idCount);
    if (want !== got) return fail("STORE_MISMATCH", "IDENTITY");

    // STEPS — the closed vocabulary, each through `one`.
    for (const step of plan.steps) {
      const r = await one(step.selector, step.stage);
      if (r.err) return r.err;
      const loc = r.loc;
      try {
        if (step.kind === "FILL") await loc.fill(step.value || "");
        else if (step.kind === "SELECT") await loc.selectOption(step.value || "");
        else if (step.kind === "CLICK") await loc.click();
        else if (step.kind === "WAIT_FOR") await loc.waitFor({ timeout: plan.stepTimeoutMs });
        else return fail("RUNTIME_FAULT", step.stage);
      } catch (e) {
        return fail("RUNTIME_FAULT", step.stage);
      }
    }

    // SCOPE — read back what is selected, when the workflow says where. Values never leave this block.
    let scopeEvidence: "MACHINE_MATCHED" | "OPERATOR_CONFIRMED" = "OPERATOR_CONFIRMED";
    if (plan.scopeReadback) {
      const s = await one(plan.scopeReadback.start, "SCOPE");
      const e = await one(plan.scopeReadback.end, "SCOPE");
      if (s.err || e.err) return fail("SCOPE_UNREADABLE", "SCOPE");
      let sv = "";
      let ev = "";
      try {
        sv = (await s.loc.inputValue()).trim();
        ev = (await e.loc.inputValue()).trim();
      } catch (err) {
        return fail("SCOPE_UNREADABLE", "SCOPE");
      }
      if (sv.length === 0 || ev.length === 0) return fail("SCOPE_UNREADABLE", "SCOPE");
      if (sv !== plan.required.start || ev !== plan.required.end) return fail("SCOPE_MISMATCH", "SCOPE");
      scopeEvidence = "MACHINE_MATCHED";
    }

    // EXPORT — arm the download race BEFORE the click that fires it (the same ordering the guided driver learned).
    const ex = await one(plan.exportSelector, "EXPORT");
    if (ex.err) return ex.err;
    const waiting = opened.waitForEvent("download", { timeout: plan.downloadTimeoutMs });
    waiting.catch(() => undefined);
    try {
      await ex.loc.click();
    } catch (e) {
      return fail("RUNTIME_FAULT", "EXPORT");
    }
    let dl: RuntimeDownloadLike;
    try {
      dl = await waiting;
    } catch (e) {
      return fail("DOWNLOAD_TIMEOUT", "DOWNLOAD");
    }
    let hostPath: string | null = null;
    try {
      hostPath = await dl.path();
    } catch (e) {
      hostPath = null;
    }
    let failure: string | null = null;
    try {
      failure = typeof dl.failure === "function" ? await dl.failure() : null;
    } catch (e) {
      failure = null;
    }
    if (!hostPath || failure) return fail("DOWNLOAD_TIMEOUT", "DOWNLOAD");
    let suggestedName = "";
    try {
      suggestedName = dl.suggestedFilename();
    } catch (e) {
      suggestedName = "";
    }
    return { ok: true, hostPath, suggestedName, identity: "MATCH", scopeEvidence, elapsedMs: elapsed() };
  } catch (e) {
    return fail("RUNTIME_FAULT", "EXECUTOR");
  } finally {
    if (page) {
      try {
        await env.closeTab(page);
      } catch (e) {
        /* a tab that would not close is not a run outcome */
      }
    }
  }
}
