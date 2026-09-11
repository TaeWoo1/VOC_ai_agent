/**
 * The in-browser runtime, executed here directly against a fake page. This is the same source text Aside runs,
 * so what is pinned here is what fails closed there: zero and many matches, an auth signal, every identity
 * verdict, the scope read-back, the download timeout — and that the tab is closed on every path.
 */
import { describe, expect, it } from "vitest";
import {
  asideExportRuntime,
  type AsideRuntimeEnv,
  type ExportRuntimePlan,
  type RuntimeDownloadLike,
  type RuntimeLocatorLike,
  type RuntimePageLike,
} from "../../src/aside/export-runtime";

interface FakePageSpec {
  counts?: Record<string, number>;
  texts?: Record<string, string | null>;
  attrs?: Record<string, Record<string, string>>;
  values?: Record<string, string>;
  download?: { path: string | null; name: string; failure?: string | null } | null;
  openThrows?: boolean;
}

function fakeEnv(spec: FakePageSpec) {
  const calls: string[] = [];
  const values: Record<string, string> = { ...(spec.values ?? {}) };
  let opened = 0;
  let closed = 0;
  const locator = (sel: string): RuntimeLocatorLike => ({
    count: async () => spec.counts?.[sel] ?? 0,
    click: async () => {
      calls.push(`click:${sel}`);
    },
    fill: async (v) => {
      calls.push(`fill:${sel}`);
      values[sel] = v;
    },
    selectOption: async (v) => {
      calls.push(`select:${sel}=${v}`);
    },
    waitFor: async () => {
      if ((spec.counts?.[sel] ?? 0) === 0) throw new Error("timeout");
    },
    textContent: async () => spec.texts?.[sel] ?? null,
    getAttribute: async (name) => spec.attrs?.[sel]?.[name] ?? null,
    inputValue: async () => values[sel] ?? "",
  });
  const page: RuntimePageLike = {
    locator,
    waitForEvent: async () => {
      if (!spec.download) throw new Error("download timeout");
      const dl: RuntimeDownloadLike = {
        path: async () => spec.download!.path,
        suggestedFilename: () => spec.download!.name,
        failure: async () => spec.download!.failure ?? null,
      };
      return dl;
    },
  };
  const env: AsideRuntimeEnv = {
    openTab: async () => {
      opened += 1;
      if (spec.openThrows) throw new Error("cannot open");
      return page;
    },
    closeTab: async () => {
      closed += 1;
    },
  };
  return { env, calls, opened: () => opened, closed: () => closed, values };
}

function plan(overrides: Partial<ExportRuntimePlan> = {}): ExportRuntimePlan {
  return {
    entryUrl: "http://127.0.0.1:1/fixture",
    authSignals: ["#login-form"],
    identity: { selector: "#store-name", read: "TEXT", expected: "fixture-store-42" },
    steps: [
      { kind: "FILL", selector: "#start", value: "2026-01-01", stage: "SCOPE" },
      { kind: "FILL", selector: "#end", value: "2026-01-31", stage: "SCOPE" },
      { kind: "CLICK", selector: "#apply", stage: "SCOPE" },
    ],
    scopeReadback: { start: "#start", end: "#end" },
    required: { start: "2026-01-01", end: "2026-01-31" },
    exportSelector: ".export",
    downloadTimeoutMs: 100,
    stepTimeoutMs: 100,
    ...overrides,
  };
}

const HAPPY: FakePageSpec = {
  counts: { "#store-name": 1, "#start": 1, "#end": 1, "#apply": 1, ".export": 1 },
  texts: { "#store-name": "fixture-store-42" },
  download: { path: "/tmp/fixture-download.xlsx", name: "fixture.xlsx" },
};

describe("export runtime — the happy path", () => {
  it("fills, clicks exactly one export control, awaits the download, returns the host path, closes the tab", async () => {
    const f = fakeEnv(HAPPY);
    const r = await asideExportRuntime(plan(), f.env);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.hostPath).toBe("/tmp/fixture-download.xlsx");
    expect(r.identity).toBe("MATCH");
    expect(r.scopeEvidence).toBe("MACHINE_MATCHED");
    expect(f.calls).toEqual(["fill:#start", "fill:#end", "click:#apply", "click:.export"]);
    expect(f.opened()).toBe(1);
    expect(f.closed()).toBe(1);
  });

  it("without a scope read-back the evidence is OPERATOR_CONFIRMED, never MACHINE_MATCHED", async () => {
    const f = fakeEnv(HAPPY);
    const r = await asideExportRuntime(plan({ scopeReadback: null }), f.env);
    expect(r.ok && r.scopeEvidence).toBe("OPERATOR_CONFIRMED");
  });
});

describe("export runtime — fail-closed ambiguity (G-2)", () => {
  it("0 matches → TARGET_NOT_FOUND, nothing clicked", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, ".export": 0 } });
    const r = await asideExportRuntime(plan(), f.env);
    expect(r).toMatchObject({ ok: false, code: "TARGET_NOT_FOUND", stage: "EXPORT", candidates: 0 });
    expect(f.calls).not.toContain("click:.export");
    expect(f.closed()).toBe(1);
  });
  it("1 match → executes", async () => {
    const f = fakeEnv(HAPPY);
    expect((await asideExportRuntime(plan(), f.env)).ok).toBe(true);
  });
  it("2+ matches → TARGET_AMBIGUOUS with the count, nothing clicked — the first match is never taken", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, ".export": 2 } });
    const r = await asideExportRuntime(plan(), f.env);
    expect(r).toMatchObject({ ok: false, code: "TARGET_AMBIGUOUS", stage: "EXPORT", candidates: 2 });
    expect(f.calls).not.toContain("click:.export");
  });
  it("ambiguity on a step is attributed to that step's stage", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, "#apply": 3 } });
    const r = await asideExportRuntime(plan(), f.env);
    expect(r).toMatchObject({ ok: false, code: "TARGET_AMBIGUOUS", stage: "SCOPE", candidates: 3 });
    expect(f.calls).toEqual(["fill:#start", "fill:#end"]);
  });
});

describe("export runtime — authentication is a person's job (PD-2)", () => {
  it("an auth signal present → AUTH_REQUIRED before anything is touched", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, "#login-form": 1 } });
    const r = await asideExportRuntime(plan(), f.env);
    expect(r).toMatchObject({ ok: false, code: "AUTH_REQUIRED", stage: "AUTH" });
    expect(f.calls).toEqual([]);
    expect(f.closed()).toBe(1);
  });
});

describe("export runtime — store identity (PD-4)", () => {
  it("MATCH proceeds", async () => {
    expect((await asideExportRuntime(plan(), fakeEnv(HAPPY).env)).ok).toBe(true);
  });
  it("MISMATCH fails closed before any step and before any download", async () => {
    const f = fakeEnv({ ...HAPPY, texts: { "#store-name": "another-store" } });
    const r = await asideExportRuntime(plan(), f.env);
    expect(r).toMatchObject({ ok: false, code: "STORE_MISMATCH", stage: "IDENTITY" });
    expect(f.calls).toEqual([]);
  });
  it("no identity element → STORE_UNRESOLVED, not a success", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, "#store-name": 0 } });
    expect(await asideExportRuntime(plan(), f.env)).toMatchObject({ ok: false, code: "STORE_UNRESOLVED", stage: "IDENTITY", candidates: 0 });
  });
  it("two identity elements → STORE_UNRESOLVED (an ambiguous identity is not evidence)", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, "#store-name": 2 } });
    expect(await asideExportRuntime(plan(), f.env)).toMatchObject({ ok: false, code: "STORE_UNRESOLVED", candidates: 2 });
  });
  it("an empty observed value → STORE_UNRESOLVED", async () => {
    const f = fakeEnv({ ...HAPPY, texts: { "#store-name": "   " } });
    expect(await asideExportRuntime(plan(), f.env)).toMatchObject({ ok: false, code: "STORE_UNRESOLVED" });
  });
  it("no expectation → STORE_UNRESOLVED even when the page shows something", async () => {
    const f = fakeEnv(HAPPY);
    const r = await asideExportRuntime(plan({ identity: { selector: "#store-name", read: "TEXT", expected: "" } }), f.env);
    expect(r).toMatchObject({ ok: false, code: "STORE_UNRESOLVED" });
    expect(f.calls).toEqual([]);
  });
  it("reads an attribute when the workflow says so", async () => {
    const f = fakeEnv({ ...HAPPY, texts: {}, attrs: { "#store-name": { "data-store": "fixture-store-42" } } });
    const r = await asideExportRuntime(plan({ identity: { selector: "#store-name", read: "ATTRIBUTE", attribute: "data-store", expected: "fixture-store-42" } }), f.env);
    expect(r.ok).toBe(true);
  });
});

describe("export runtime — scope read-back", () => {
  it("MISMATCH → SCOPE_MISMATCH, no export click", async () => {
    const f = fakeEnv(HAPPY);
    const r = await asideExportRuntime(plan({ required: { start: "2026-02-01", end: "2026-02-28" } }), f.env);
    // The steps filled January (plan literals), the required window is February.
    expect(r).toMatchObject({ ok: false, code: "SCOPE_MISMATCH", stage: "SCOPE" });
    expect(f.calls).not.toContain("click:.export");
  });
  it("unreadable controls → SCOPE_UNREADABLE (not MISMATCH)", async () => {
    const f = fakeEnv({ ...HAPPY, counts: { ...HAPPY.counts!, "#end": 1 } });
    const r = await asideExportRuntime(plan({ steps: [], scopeReadback: { start: "#nope", end: "#end" } }), f.env);
    expect(r).toMatchObject({ ok: false, code: "SCOPE_UNREADABLE", stage: "SCOPE" });
  });
});

describe("export runtime — download", () => {
  it("no download within the window → DOWNLOAD_TIMEOUT (the export WAS clicked, once)", async () => {
    const f = fakeEnv({ ...HAPPY, download: null });
    const r = await asideExportRuntime(plan(), f.env);
    expect(r).toMatchObject({ ok: false, code: "DOWNLOAD_TIMEOUT", stage: "DOWNLOAD" });
    expect(f.calls.filter((c) => c === "click:.export")).toHaveLength(1);
    expect(f.closed()).toBe(1);
  });
  it("a download that reports a failure or no path → DOWNLOAD_TIMEOUT", async () => {
    expect(await asideExportRuntime(plan(), fakeEnv({ ...HAPPY, download: { path: null, name: "x" } }).env)).toMatchObject({ ok: false, code: "DOWNLOAD_TIMEOUT" });
    expect(await asideExportRuntime(plan(), fakeEnv({ ...HAPPY, download: { path: "/p", name: "x", failure: "canceled" } }).env)).toMatchObject({ ok: false, code: "DOWNLOAD_TIMEOUT" });
  });
  it("a tab that cannot be opened → UNSUPPORTED_STATE at PREPARE, and no close is attempted on a tab that never existed", async () => {
    const f = fakeEnv({ ...HAPPY, openThrows: true });
    expect(await asideExportRuntime(plan(), f.env)).toMatchObject({ ok: false, code: "UNSUPPORTED_STATE", stage: "PREPARE" });
    expect(f.closed()).toBe(0);
  });
});
