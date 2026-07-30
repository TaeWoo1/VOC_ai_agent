/**
 * The Spring-backed run stores over the REAL {@link HttpAgentRunStateClient}, with the backend HTTP
 * contract emulated by {@link FakeAgentRunStateBackend}. Proves the durable-store behaviour that makes
 * pilot operation safe: version-guarded writes (a stale write fails closed, never overwrites), the
 * claim state machine (CLAIMED / ALREADY_DONE / CONFLICT), and per-domain ownership over one table.
 */
import { describe, expect, it } from "vitest";
import { HttpAgentRunStateClient, StaleRunVersionError } from "../../src/spring/AgentRunStateClient";
import { SpringReviewRunStore, SpringRunStore } from "../../src/http/springStores";
import { FakeAgentRunStateBackend } from "../support/FakeAgentRunStateBackend";
import type { RunSnapshot } from "../../src/checkpoint/RunStore";

function client(backend: FakeAgentRunStateBackend, token: string): HttpAgentRunStateClient {
  return new HttpAgentRunStateClient({ baseUrl: "http://fake", token, fetchImpl: backend.fetch });
}

function inquirySnap(threadId: string, status: "AWAITING_APPROVAL" | "DONE"): RunSnapshot {
  return {
    threadId,
    status,
    inquiryId: "inq-1",
    workItemId: "wi-1",
    phase: "OPEN",
    priorityBucket: "P1",
    category: "general",
    trail: ["selected"],
  };
}

describe("Spring-backed run store", () => {
  it("inserts then loads the snapshot, and a version-guarded update bumps in place", async () => {
    const backend = new FakeAgentRunStateBackend({ tok: "orgA" });
    const store = new SpringRunStore(client(backend, "tok"));

    await store.save(inquirySnap("t1", "AWAITING_APPROVAL"));
    expect(backend.peek("orgA", "t1")!.version).toBe(1);

    const loaded = await store.load("t1");
    expect(loaded!.status).toBe("AWAITING_APPROVAL");
    expect(loaded!.workItemId).toBe("wi-1");

    // Same client remembers version 1 → the next save is a guarded update to version 2.
    await store.save(inquirySnap("t1", "DONE"));
    expect(backend.peek("orgA", "t1")!.version).toBe(2);
    expect(backend.peek("orgA", "t1")!.status).toBe("DONE");
  });

  it("fails closed (StaleRunVersionError) when another writer advanced the version", async () => {
    const backend = new FakeAgentRunStateBackend({ tok: "orgA" });
    const a = new SpringRunStore(client(backend, "tok"));
    const b = new SpringRunStore(client(backend, "tok"));

    await a.save(inquirySnap("t1", "AWAITING_APPROVAL")); // version 1 (client a knows v1)
    await b.load("t1"); // client b learns v1
    await b.save(inquirySnap("t1", "DONE")); // b wins → version 2
    // a still expects v1 → stale, must not overwrite.
    await expect(a.save(inquirySnap("t1", "DONE"))).rejects.toBeInstanceOf(StaleRunVersionError);
    expect(backend.peek("orgA", "t1")!.version).toBe(2);
  });

  it("inserting an already-present thread is a stale/conflict write", async () => {
    const backend = new FakeAgentRunStateBackend({ tok: "orgA" });
    const a = new SpringRunStore(client(backend, "tok"));
    const b = new SpringRunStore(client(backend, "tok")); // fresh client → no known version → insert

    await a.save(inquirySnap("t1", "AWAITING_APPROVAL"));
    await expect(b.save(inquirySnap("t1", "AWAITING_APPROVAL"))).rejects.toBeInstanceOf(StaleRunVersionError);
  });

  it("claim is a real lock: a STAGGERED claimer that reads after the winner still cannot re-claim", async () => {
    const backend = new FakeAgentRunStateBackend({ tok: "orgA" });
    const winner = new SpringRunStore(client(backend, "tok"));
    const loser = new SpringRunStore(client(backend, "tok"));

    await winner.save(inquirySnap("t1", "AWAITING_APPROVAL"));
    expect((await winner.claim("t1")).outcome).toBe("CLAIMED"); // AWAITING → RESUMING

    // The loser reads AFTER the winner claimed. Its snapshot still reads AWAITING (the runtime view),
    // but the claim is authoritative and refuses it — this is the exactly-once gate (H1 regression).
    const loaded = await loser.load("t1");
    expect(loaded!.status).toBe("AWAITING_APPROVAL");
    expect((await loser.claim("t1")).outcome).toBe("CONFLICT");

    // Winner finishes; a later claim replays DONE (idempotent double resume).
    await winner.save(inquirySnap("t1", "DONE"));
    const late = new SpringRunStore(client(backend, "tok"));
    expect((await late.claim("t1")).outcome).toBe("ALREADY_DONE");
  });

  it("load only returns a row of its own domain (single table, three stores)", async () => {
    const backend = new FakeAgentRunStateBackend({ tok: "orgA" });
    const inquiry = new SpringRunStore(client(backend, "tok"));
    const review = new SpringReviewRunStore(client(backend, "tok"));

    await inquiry.save(inquirySnap("t1", "AWAITING_APPROVAL"));
    expect(await inquiry.load("t1")).not.toBeNull();
    expect(await review.load("t1")).toBeNull(); // an INQUIRY row is invisible to the review store
  });

  it("a run is only visible within the org that created it", async () => {
    const backend = new FakeAgentRunStateBackend({ tokA: "orgA", tokB: "orgB" });
    const a = new SpringRunStore(client(backend, "tokA"));
    const b = new SpringRunStore(client(backend, "tokB"));

    await a.save(inquirySnap("shared", "AWAITING_APPROVAL"));
    expect(await a.load("shared")).not.toBeNull();
    expect(await b.load("shared")).toBeNull(); // different org → invisible
  });
});
