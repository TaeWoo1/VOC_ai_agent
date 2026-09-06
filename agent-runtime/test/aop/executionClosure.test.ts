/**
 * <b>The six definitions own real execution now — and the cursor that survives a restart owns nothing.</b>
 *
 * AOP Execution Closure v1. Two properties are worth a test of their own here, because both are the
 * kind that a passing feature suite cannot see:
 *
 *   §A  the steps in a definition are the steps that RUN — the trail is the definition's own order
 *   §B  the durable cursor holds ids and closed tokens, and a second resume performs nothing
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECKPOINT_KEYS, FileAopCheckpointStore, MemoryAopCheckpointStore, forbiddenKeysIn, sanitize,
} from "../../src/aop/AopCheckpointStore";
import type { AopCheckpoint } from "../../src/aop/AopCheckpointStore";
import { ProcedureRuntime } from "../../src/aop/ProcedureRuntime";
import type { ProcedureOps } from "../../src/aop/ProcedureRuntime";
import type { ProcedureState, ProcedureUpdate } from "../../src/aop/ProcedureState";
import { PROCEDURES } from "../../src/aop/procedures";

interface Ctx { readonly log: string[]; stop?: boolean }

function opsThat(over: Partial<ProcedureOps<Ctx>> = {}): ProcedureOps<Ctx> {
  const mark = (name: string) => async (_s: ProcedureState, ctx: Ctx): Promise<ProcedureUpdate> => {
    ctx.log.push(name);
    return {};
  };
  return {
    hydrateWorld: mark("hydrateWorld"), loadObject: mark("loadObject"),
    checkPrecondition: mark("checkPrecondition"), investigate: mark("investigate"),
    evidence: mark("evidence"), prepare: mark("prepare"), revise: mark("revise"),
    humanWait: mark("humanWait"), resume: mark("resume"),
    readOpportunities: mark("readOpportunities"), validateApproval: mark("validateApproval"),
    execute: mark("execute"), terminal: mark("terminal"),
    shouldRun: () => true,
    ...over,
  };
}

describe("§A — a definition's steps are the steps that run", () => {
  it("ANSWER_INQUIRY runs its own order, and the trail is that order", async () => {
    const ctx: Ctx = { log: [] };
    const runtime = new ProcedureRuntime<Ctx>(opsThat(), { checkpoints: new MemoryAopCheckpointStore() });
    const { state } = await runtime.run("ANSWER_INQUIRY", ctx, { conversationId: "c-1", threadId: "t-1" });
    expect(state.stepTrail).toEqual(PROCEDURES.ANSWER_INQUIRY.steps.map((s) => s.id));
    expect(state.version).toBe("answer-inquiry/v1");
  });

  it("ANSWER_REVIEW stops where its precondition fails, and later steps do not run", async () => {
    const ctx: Ctx = { log: [] };
    const runtime = new ProcedureRuntime<Ctx>(opsThat({
      checkPrecondition: async () => ({ terminal: "BLOCKED_BY_PRECONDITION", absence: "NOT_SUPPORTED" }),
    }), { checkpoints: new MemoryAopCheckpointStore() });
    const { state } = await runtime.run("ANSWER_REVIEW", ctx, { conversationId: "c-1", threadId: "t-2" });
    expect(state.stepTrail).toEqual(["loadObject", "gate"]);
    expect(state.terminal).toBe("BLOCKED_BY_PRECONDITION");
    expect(ctx.log).not.toContain("prepare");
    expect(ctx.log).not.toContain("execute");
  });

  it("every procedure reaches a terminal it declared it could reach", async () => {
    for (const definition of Object.values(PROCEDURES)) {
      const ctx: Ctx = { log: [] };
      // The stub settles the first terminal the definition DECLARES: what is being checked is that a
      // procedure can run end to end and finish somewhere it said it could, not what the stub returns.
      const runtime = new ProcedureRuntime<Ctx>(opsThat({
        terminal: async () => ({ terminal: definition.completion[0]! }),
      }), { checkpoints: new MemoryAopCheckpointStore() });
      const { state } = await runtime.run(definition.id, ctx, { conversationId: "c", threadId: `t-${definition.id}` });
      expect(state.terminal, definition.id).toBe(definition.completion[0]);
      expect(state.stepTrail.length, definition.id).toBeGreaterThan(0);
    }
  });
});

describe("§B — the cursor is a cursor", () => {
  const cursor = (over: Partial<AopCheckpoint> = {}): AopCheckpoint => ({
    threadId: "c-1:ANSWER_INQUIRY", conversationId: "c-1", procedureId: "ANSWER_INQUIRY",
    procedureVersion: "answer-inquiry/v1", step: "approval", stepTrail: ["loadObject", "gate", "prepare"],
    refs: { workItemId: "w-1", inquiryId: "i-1", draftVersion: 2 },
    draftId: "2", approvalId: "ap-1", terminal: "WAITING_HUMAN", absence: null,
    interrupt: "SEND_APPROVAL", updatedAt: "2026-09-06T00:00:00.000Z", ...over,
  });

  it("holds only the declared keys, and nothing that could carry content", () => {
    const written = sanitize(cursor());
    expect(Object.keys(written).sort()).toEqual([...CHECKPOINT_KEYS].sort());
    expect(forbiddenKeysIn(written)).toEqual([]);
  });

  it("drops anything a caller adds that the shape does not declare", () => {
    const smuggled = { ...cursor(), body: "고객이 쓴 문장", refs: { workItemId: "w-1", body: "x" } } as unknown as AopCheckpoint;
    const written = sanitize(smuggled);
    expect(forbiddenKeysIn(written)).toEqual([]);
    expect(Object.keys(written)).not.toContain("body");
    expect(Object.keys(written.refs)).toEqual(["workItemId"]);
  });

  it("survives the process — a file store hands the same cursor to a new store object", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aop-cursor-"));
    const first = new FileAopCheckpointStore(dir);
    await first.save(cursor());
    // ── the process ends here ──
    const restarted = new FileAopCheckpointStore(dir);
    const loaded = await restarted.load("c-1:ANSWER_INQUIRY");
    expect(loaded).not.toBeNull();
    expect(loaded!.procedureId).toBe("ANSWER_INQUIRY");
    expect(loaded!.procedureVersion).toBe("answer-inquiry/v1");
    expect(loaded!.step).toBe("approval");
    expect(loaded!.refs.workItemId).toBe("w-1");
    expect(loaded!.approvalId).toBe("ap-1");
  });

  it("a second resume of the same stopped procedure is refused — the exactly-once gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aop-claim-"));
    const store = new FileAopCheckpointStore(dir);
    await store.save(cursor());
    expect((await store.claim("c-1:ANSWER_INQUIRY")).outcome).toBe("CLAIMED");
    expect((await store.claim("c-1:ANSWER_INQUIRY")).outcome).toBe("CONFLICT");
  });

  it("a finished procedure leaves no cursor for a later resume to mistake for work", async () => {
    const store = new MemoryAopCheckpointStore();
    const ctx: Ctx = { log: [] };
    const runtime = new ProcedureRuntime<Ctx>(opsThat({
      terminal: async () => ({ terminal: "WAITING_HUMAN", interrupt: "SEND_APPROVAL" }),
    }), { checkpoints: store });
    await runtime.run("ANSWER_INQUIRY", ctx, { conversationId: "c-1", threadId: "t-9" });
    expect(await store.load("t-9")).not.toBeNull();

    // The person acted; the procedure now finishes. The cursor is gone with it.
    const done = new ProcedureRuntime<Ctx>(opsThat({
      terminal: async () => ({ terminal: "ANSWERED" }),
    }), { checkpoints: store });
    await done.run("ANSWER_INQUIRY", ctx, { conversationId: "c-1", threadId: "t-9" });
    expect(await store.load("t-9")).toBeNull();
  });

  it("a run whose claim is refused performs no step at all", async () => {
    const store = new MemoryAopCheckpointStore();
    await store.save(cursor({ threadId: "t-x" }));
    await store.claim("t-x");
    const ctx: Ctx = { log: [] };
    const runtime = new ProcedureRuntime<Ctx>(opsThat(), { checkpoints: store });
    const { state } = await runtime.run("ANSWER_INQUIRY", ctx, { conversationId: "c-1", threadId: "t-x" });
    // Nothing ran: no side effect can be repeated by a resume that lost the claim.
    expect(ctx.log).toEqual([]);
    expect(state.terminal).toBe("WAITING_HUMAN");
  });
});
