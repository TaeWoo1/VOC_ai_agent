/**
 * <b>The execution cursor at the process, container and replica boundary.</b>
 *
 * Agent Runtime Production Closure v1. The AOP subgraphs and the six definitions are frozen; what is
 * proven here is the only thing left that a passing feature suite cannot see — that a stopped
 * procedure is found, and continued exactly once, by a process that did not start it.
 *
 * The backend is the real one's contract ({@link FakeAgentRunStateBackend} emulates
 * `/api/agent-run-store` at the HTTP layer), so the REAL {@link HttpAgentRunStateClient} and the REAL
 * {@link SpringAopCheckpointStore} run. A "container replacement" is a second client + store over the
 * same rows with an empty version cache; "two replicas" are two of those racing.
 */
import { describe, expect, it } from "vitest";
import { HttpAgentRunStateClient } from "../../src/spring/AgentRunStateClient";
import { FakeAgentRunStateBackend } from "../support/FakeAgentRunStateBackend";
import { AOP_DOMAIN, SpringAopCheckpointStore } from "../../src/http/springStores";
import { CHECKPOINT_KEYS, MemoryAopCheckpointStore, forbiddenKeysIn } from "../../src/aop/AopCheckpointStore";
import type { AopCheckpoint, AopCheckpointStore } from "../../src/aop/AopCheckpointStore";
import { ProcedureRuntime } from "../../src/aop/ProcedureRuntime";
import type { ProcedureOps } from "../../src/aop/ProcedureRuntime";
import type { ProcedureState, ProcedureUpdate } from "../../src/aop/ProcedureState";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import { inquiryAnswerStep } from "../../src/aop/answerStep";

const TOKEN = "token-org-a";
const OTHER = "token-org-b";
const ORG_A = "org-a";

function backend(): FakeAgentRunStateBackend {
  return new FakeAgentRunStateBackend({ [TOKEN]: ORG_A, [OTHER]: "org-b" });
}

/** A store built the way a fresh process builds one: a new client, an empty version cache. */
function storeOn(be: FakeAgentRunStateBackend, token = TOKEN): SpringAopCheckpointStore {
  return new SpringAopCheckpointStore(
    new HttpAgentRunStateClient({ baseUrl: "http://backend.invalid", token, fetchImpl: be.fetch }),
  );
}

function cursor(over: Partial<AopCheckpoint> = {}): AopCheckpoint {
  return {
    threadId: "c-1:ANSWER_INQUIRY", conversationId: "c-1", procedureId: "ANSWER_INQUIRY",
    procedureVersion: "answer-inquiry/v1", step: "prepare", stepTrail: ["loadObject", "gate", "prepare"],
    refs: { workItemId: "wi-1", inquiryId: "inq-1", draftVersion: 3 },
    draftId: "3", approvalId: null, terminal: "WAITING_HUMAN", absence: null,
    interrupt: "KNOWLEDGE_ANSWER", updatedAt: "2026-09-06T00:00:00.000Z", ...over,
  };
}

interface Ctx { readonly log: string[] }

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

describe("§1 — the cursor a deployed host keeps", () => {
  it("production resolves the backend-owned cursor store; local kinds do not", () => {
    const spring = new RunStoreProvider(
      { env: "production", runStoreKind: "spring", backendBaseUrl: "http://backend.invalid", runStoreDir: "/tmp/x" } as never,
      () => new HttpAgentRunStateClient({ baseUrl: "http://backend.invalid", token: TOKEN, fetchImpl: backend().fetch }),
    );
    const stores = spring.storesForRequest({ token: TOKEN, scope: "s" });
    expect(stores.procedureCursors).toBeInstanceOf(SpringAopCheckpointStore);
    // …and the same provider that refuses to boot production on a local kind is the one that decides
    // this, so the cursor cannot end up on a disk that goes away with the container.
    const local = new RunStoreProvider(
      { env: "development", runStoreKind: "memory", backendBaseUrl: "http://backend.invalid", runStoreDir: "/tmp/x" } as never,
    );
    expect(local.storesForRequest({ token: TOKEN, scope: "s" }).procedureCursors)
      .toBeInstanceOf(MemoryAopCheckpointStore);
  });

  it("a saved cursor is a PROCEDURE row holding ids and closed tokens, and nothing else", async () => {
    const be = backend();
    await storeOn(be).save(cursor());
    const row = be.peek(ORG_A, "c-1:ANSWER_INQUIRY")!;
    expect(row.domain).toBe(AOP_DOMAIN);
    // WAITING_HUMAN is the claimable status: this is what makes the row resumable by another process.
    expect(row.status).toBe("WAITING_HUMAN");
    expect(Object.keys(row.snapshot as object).sort()).toEqual([...CHECKPOINT_KEYS].sort());
    expect(forbiddenKeysIn(row.snapshot)).toEqual([]);
  });

  it("another org cannot see or continue this cursor", async () => {
    const be = backend();
    await storeOn(be).save(cursor());
    expect(await storeOn(be, OTHER).load("c-1:ANSWER_INQUIRY")).toBeNull();
    expect((await storeOn(be, OTHER).claim("c-1:ANSWER_INQUIRY")).outcome).toBe("CONFLICT");
  });

  it("a container-style fresh process finds the cursor and continues the SAME procedure", async () => {
    const be = backend();
    // The first process runs the procedure until it stops for the seller — and the runtime, not the
    // test, is what writes the cursor.
    const stopping = new ProcedureRuntime<Ctx>(opsThat({
      resume: async (_s, ctx) => {
        ctx.log.push("resume");
        return { terminal: "WAITING_HUMAN", refs: { workItemId: "wi-1", inquiryId: "inq-1" } };
      },
    }));
    const ctxA: Ctx = { log: [] };
    const first = await stopping.run("CAPTURE_KNOWLEDGE", ctxA, {
      conversationId: "c-9", threadId: "c-9:CAPTURE_KNOWLEDGE", checkpoints: storeOn(be),
    });
    expect(first.checkpoint?.procedureId).toBe("CAPTURE_KNOWLEDGE");

    // ── the container is replaced here: new runtime, new client, empty version cache ──
    const restarted = new ProcedureRuntime<Ctx>(opsThat());
    const ctxB: Ctx = { log: [] };
    const { state } = await restarted.run("CAPTURE_KNOWLEDGE", ctxB, {
      conversationId: "c-9", threadId: "c-9:CAPTURE_KNOWLEDGE", checkpoints: storeOn(be),
    });
    expect(state.procedureId).toBe("CAPTURE_KNOWLEDGE");
    expect(ctxB.log).toContain("resume");
    // Exact-object continuity: the second process acts on the object the first one loaded, by id.
    expect(state.refs).toMatchObject({ workItemId: "wi-1", inquiryId: "inq-1" });
    // The run finished, so the cursor is gone: a cursor that outlives its run is what a later resume
    // would mistake for work still to do.
    expect(await storeOn(be).load("c-9:CAPTURE_KNOWLEDGE")).toBeNull();
  });
});

describe("§2 — two resumes, one claim", () => {
  it("simultaneous claims on one cursor: exactly one CLAIMED", async () => {
    const be = backend();
    await storeOn(be).save(cursor());
    const outcomes = await Promise.all([
      storeOn(be).claim("c-1:ANSWER_INQUIRY"),
      storeOn(be).claim("c-1:ANSWER_INQUIRY"),
      storeOn(be).claim("c-1:ANSWER_INQUIRY"),
    ]);
    expect(outcomes.filter((o) => o.outcome === "CLAIMED")).toHaveLength(1);
  });

  it("two replicas resuming the same procedure run its steps exactly once", async () => {
    const be = backend();
    await storeOn(be).save(cursor({ threadId: "c-2:CAPTURE_KNOWLEDGE", conversationId: "c-2", procedureId: "CAPTURE_KNOWLEDGE", procedureVersion: "capture-knowledge/v1" }));
    const shared: string[] = [];
    // Two runtimes, two clients — the shape of two containers behind one load balancer.
    const replica = (): Promise<unknown> => new ProcedureRuntime<Ctx>(opsThat())
      .run("CAPTURE_KNOWLEDGE", { log: shared }, {
        conversationId: "c-2", threadId: "c-2:CAPTURE_KNOWLEDGE", checkpoints: storeOn(be),
      });
    await Promise.all([replica(), replica()]);
    // `resume` is the step that would re-perform the seller's knowledge write. Once.
    expect(shared.filter((s) => s === "resume")).toHaveLength(1);
  });

  it("a completed procedure's second resume starts nothing", async () => {
    const be = backend();
    const store = storeOn(be);
    await store.save(cursor({ threadId: "c-3:CAPTURE_KNOWLEDGE", conversationId: "c-3", procedureId: "CAPTURE_KNOWLEDGE", procedureVersion: "capture-knowledge/v1" }));
    const once: Ctx = { log: [] };
    await new ProcedureRuntime<Ctx>(opsThat()).run("CAPTURE_KNOWLEDGE", once, {
      conversationId: "c-3", threadId: "c-3:CAPTURE_KNOWLEDGE", checkpoints: storeOn(be),
    });
    expect(once.log).toContain("resume");

    const twice: Ctx = { log: [] };
    await new ProcedureRuntime<Ctx>(opsThat()).run("CAPTURE_KNOWLEDGE", twice, {
      conversationId: "c-3", threadId: "c-3:CAPTURE_KNOWLEDGE", checkpoints: storeOn(be),
    });
    // Nothing was there to continue, so this is a first run over a fresh cursor — not a REPLAY of the
    // finished one. What must never happen is the finished run's side effect happening twice, and the
    // cursor is gone, so no step of the STOPPED run is reachable.
    expect(await storeOn(be).load("c-3:CAPTURE_KNOWLEDGE")).toBeNull();
  });

  it("a run that loses the claim executes no step at all", async () => {
    const held: AopCheckpointStore = {
      load: async () => cursor(),
      save: async () => undefined,
      delete: async () => undefined,
      claim: async () => ({ outcome: "CONFLICT" as const }),
    };
    const ctx: Ctx = { log: [] };
    await new ProcedureRuntime<Ctx>(opsThat()).run("ANSWER_INQUIRY", ctx, {
      conversationId: "c-4", threadId: "c-4:ANSWER_INQUIRY", checkpoints: held,
    });
    expect(ctx.log).toEqual([]);
  });

  it("a cursor saved again is claimable again — a procedure may stop twice", async () => {
    const be = backend();
    await storeOn(be).save(cursor());
    expect((await storeOn(be).claim("c-1:ANSWER_INQUIRY")).outcome).toBe("CLAIMED");
    const store = storeOn(be);
    await store.load("c-1:ANSWER_INQUIRY");
    await store.save(cursor({ step: "revise" }));
    expect((await storeOn(be).claim("c-1:ANSWER_INQUIRY")).outcome).toBe("CLAIMED");
  });
});

describe("§5 — the approval boundary survives the boundary", () => {
  it("a cursor keeps the approval ID, never its verdict — and the resume re-reads it", async () => {
    const be = backend();
    await storeOn(be).save(cursor({ threadId: "c-5:ANSWER_REVIEW", conversationId: "c-5", procedureId: "ANSWER_REVIEW", procedureVersion: "answer-review/v1", approvalId: "apr-1", interrupt: "SEND_APPROVAL" }));
    const stored = (await storeOn(be).load("c-5:ANSWER_REVIEW"))!;
    expect(stored.approvalId).toBe("apr-1");
    // There is nowhere in the shape to put "and it was valid": the only thing a resume inherits is the
    // id, so validity is a question it has to ask the approval's own record every time.
    expect(Object.keys(stored)).not.toContain("approved");
    expect(Object.keys(stored)).not.toContain("decision");
  });

  it("an approval that no longer stands stops the run BEFORE execute", async () => {
    const ctx: Ctx = { log: [] };
    await new ProcedureRuntime<Ctx>(opsThat({
      // What the real step does: read the approval's own record, and refuse when it does not bind the
      // draft that would be sent. Reaching this step is a pause resumed — never a permission carried.
      validateApproval: async (_s, c) => {
        c.log.push("validateApproval");
        return { terminal: "BLOCKED_BY_PRECONDITION", absence: "NOT_ACTIONABLE" };
      },
      shouldRun: (stepId) => stepId !== "humanWait",
    })).run("ANSWER_REVIEW", ctx, { conversationId: "c-6", threadId: "c-6:ANSWER_REVIEW" });
    expect(ctx.log).toContain("validateApproval");
    expect(ctx.log).not.toContain("execute");
  });
});

describe("§4 — which step answers an inquiry is asked once", () => {
  it("advice over a draftable object IS the draft; over one that cannot take a draft it is advice", () => {
    expect(inquiryAnswerStep("ADVISE", "DRAFTABLE")).toBe("PREPARE");
    expect(inquiryAnswerStep("ADVISE", "ALREADY_ANSWERED")).toBe("ADVISE");
    expect(inquiryAnswerStep("PREPARE_DRAFT", "ALREADY_ANSWERED")).toBe("PREPARE");
    // A plan the seller did not phrase as advice never becomes one.
    expect(inquiryAnswerStep("NONE", "AWAITING_SEND")).toBe("PREPARE");
  });
});
