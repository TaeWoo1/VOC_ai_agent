/**
 * **What the unattended loop does, and what it refuses to say.**
 *
 * The interesting assertions are the negative ones: a run that could not read never reports `OBSERVED`, a recipe
 * the helper does not publish is refused without running anything, and nothing the backend sends can point this
 * at a target — because the exchange carries no target at all.
 */
import { describe, expect, it } from "vitest";
import {
  digestOfRefs,
  runFixtureObserveCycle,
  type FixtureObserveRunnerOptions,
} from "../../src/aside/fixture-observe-runner";
import { FIXTURE_OBSERVE_RECIPE_ID } from "../../src/aside/fixture-observe-workflow";

interface Sent {
  url: string;
  body: unknown;
}

function harness(opts: {
  claim: unknown;
  replResult?: unknown;
  replKind?: "RESULT" | "NO_RESULT";
}): { options: FixtureObserveRunnerOptions; sent: Sent[]; programs: string[] } {
  const sent: Sent[] = [];
  const programs: string[] = [];
  const options: FixtureObserveRunnerOptions = {
    baseUrl: "http://127.0.0.1:8080",
    token: "rvh_test",
    bridgePort: 47615,
    fetchImpl: (async (url: string, init?: { body?: string }) => {
      sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith("/claim")) {
        return { ok: true, json: async () => opts.claim } as unknown as Response;
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch,
    runProgram: (async (program: string) => {
      programs.push(program);
      return opts.replKind === "NO_RESULT"
        ? { kind: "NO_RESULT", reason: "UNAVAILABLE", elapsedMs: 1 }
        : { kind: "RESULT", result: opts.replResult, elapsedMs: 1 };
    }) as never,
  };
  return { options, sent, programs };
}

const JOB = { jobId: "job-1", recipe: FIXTURE_OBSERVE_RECIPE_ID };

describe("the unattended loop — nothing to do is a normal answer", () => {
  it("reports nothing when no job is queued", async () => {
    const h = harness({ claim: { jobId: null, recipe: null } });
    expect(await runFixtureObserveCycle(h.options)).toEqual({ kind: "NO_WORK" });
    expect(h.programs).toHaveLength(0);
    expect(h.sent.filter((s) => s.url.includes("/report"))).toHaveLength(0);
  });

  it("an unreachable backend takes no job and runs nothing", async () => {
    const h = harness({ claim: {} });
    const options = {
      ...h.options,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    };
    expect(await runFixtureObserveCycle(options)).toEqual({ kind: "UNREACHABLE" });
    expect(h.programs).toHaveLength(0);
  });
});

describe("the unattended loop — a recipe it does not publish is refused without running", () => {
  it("refuses an unknown recipe name and never builds a program", async () => {
    const h = harness({ claim: { jobId: "job-9", recipe: "SCRAPE_COUPANG_WING_V1" } });

    const result = await runFixtureObserveCycle(h.options);

    expect(result).toEqual({ kind: "REPORTED", outcome: "REFUSED", observedCount: null });
    // Refused BEFORE anything is built: no program is ever serialized for a recipe we do not publish.
    expect(h.programs).toHaveLength(0);
    const report = h.sent.find((s) => s.url.includes("/report"));
    expect(report?.body).toEqual({ outcome: "REFUSED", observedCount: null, contentDigest: null });
  });
});

describe("the unattended loop — what it reads and what it says", () => {
  it("reports the count and a digest of the surface's own refs", async () => {
    const h = harness({
      claim: JOB,
      replResult: { ok: true, items: [{ ref: "co-0002", state: "SETTLED" }, { ref: "co-0001", state: "NEW" }] },
    });

    const result = await runFixtureObserveCycle(h.options);

    expect(result).toEqual({ kind: "REPORTED", outcome: "OBSERVED", observedCount: 2 });
    const report = h.sent.find((s) => s.url.includes("/report"))?.body as Record<string, unknown>;
    expect(report["outcome"]).toBe("OBSERVED");
    expect(report["observedCount"]).toBe(2);
    // Order-independent: the same surface read twice digests the same, whatever order the rows came back in.
    expect(report["contentDigest"]).toBe(digestOfRefs(["co-0001", "co-0002"]));
    expect(digestOfRefs(["co-0002", "co-0001"])).toBe(digestOfRefs(["co-0001", "co-0002"]));
  });

  it("opens only its own loopback surface", async () => {
    const h = harness({ claim: JOB, replResult: { ok: true, items: [] } });
    await runFixtureObserveCycle(h.options);
    expect(h.programs[0]).toContain("http://127.0.0.1:47615/fixture/customer-operations");
  });

  it("an empty surface is a real observation of zero", async () => {
    const h = harness({ claim: JOB, replResult: { ok: true, items: [] } });

    expect(await runFixtureObserveCycle(h.options))
      .toEqual({ kind: "REPORTED", outcome: "OBSERVED", observedCount: 0 });
    const report = h.sent.find((s) => s.url.includes("/report"))?.body as Record<string, unknown>;
    expect(report["observedCount"]).toBe(0);
    expect(report["contentDigest"]).toBe(digestOfRefs([]));
  });
});

describe("the unattended loop — a failed read is never an empty surface", () => {
  it("an absent executor reports EXECUTOR_UNAVAILABLE with no count", async () => {
    const h = harness({ claim: JOB, replKind: "NO_RESULT" });

    expect(await runFixtureObserveCycle(h.options))
      .toEqual({ kind: "REPORTED", outcome: "EXECUTOR_UNAVAILABLE", observedCount: null });
    const report = h.sent.find((s) => s.url.includes("/report"))?.body as Record<string, unknown>;
    expect(report["observedCount"]).toBeNull();
    expect(report["contentDigest"]).toBeNull();
  });

  it("an unreadable answer reports SURFACE_UNREADABLE with no count", async () => {
    for (const bad of [null, "ok", { ok: true }, { ok: true, items: [{ ref: 1 }] }]) {
      const h = harness({ claim: JOB, replResult: bad });
      expect(await runFixtureObserveCycle(h.options))
        .toEqual({ kind: "REPORTED", outcome: "SURFACE_UNREADABLE", observedCount: null });
    }
  });

  it("the runtime's own failure codes map to closed tokens, never to a count", async () => {
    const unreadable = harness({
      claim: JOB,
      replResult: { ok: false, code: "SURFACE_UNREADABLE", stage: "READ", elapsedMs: 2 },
    });
    expect(await runFixtureObserveCycle(unreadable.options))
      .toEqual({ kind: "REPORTED", outcome: "SURFACE_UNREADABLE", observedCount: null });

    const fault = harness({
      claim: JOB,
      replResult: { ok: false, code: "RUNTIME_FAULT", stage: "NAVIGATE", elapsedMs: 2 },
    });
    expect(await runFixtureObserveCycle(fault.options))
      .toEqual({ kind: "REPORTED", outcome: "EXECUTOR_UNAVAILABLE", observedCount: null });
  });
});

describe("the unattended loop — the exchange carries no target", () => {
  it("nothing it sends or receives names a url, a prompt or a credential", async () => {
    const h = harness({ claim: JOB, replResult: { ok: true, items: [{ ref: "co-0001", state: "NEW" }] } });
    await runFixtureObserveCycle(h.options);

    for (const s of h.sent) {
      const body = JSON.stringify(s.body ?? {});
      for (const token of ["http", "url", "prompt", "script", "token", "credential", "selector"]) {
        expect(body.toLowerCase(), `${s.url} carries ${token}`).not.toContain(token);
      }
    }
  });
});
