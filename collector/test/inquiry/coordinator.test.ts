/**
 * Pure offline tests for the inquiry intake coordinator (the vertical slice end-to-end).
 *
 * Focus: normal intake settles at PROPOSED (Seller-channel inquiry reply, never auto-approved); duplicate
 * ingestion is idempotent and does not re-draft; the same inquiry id on different connections stays
 * isolated; the provider receives ONLY the permitted seller context; a provider failure leaves the work item
 * OPEN and retryable; and conflicting reuse of a source identity is rejected. No LLM, network, connector,
 * persistence, or wall clock (a source guard enforces the last).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { InquiryIntakeCoordinator, type InquiryIngestOutcome, type InquiryCoordinatorState } from "../../src/inquiry/coordinator";
import type { InquiryObservation } from "../../src/inquiry/observation";
import type { InquiryProposalProvider, InquiryProposalDraft, SellerInquiryContext } from "../../src/inquiry/proposal-provider";
import { toInquirySignal, deriveSourceIds, sellerContextFromSignal } from "../../src/inquiry/intake";
import { autoApprove } from "../../src/work/work-item";
import { projectSignalForViewer } from "../../src/work/access";
import type { DataGrant } from "../../src/work/data-grant";

/** A fake drafting provider — records the exact context it was given and can be scripted to fail N times. */
class FakeProvider implements InquiryProposalProvider {
  readonly calls: SellerInquiryContext[] = [];
  failuresRemaining = 0;
  draft: InquiryProposalDraft = { summaryCategory: "stock_availability_reply" };
  async propose(context: SellerInquiryContext): Promise<InquiryProposalDraft> {
    this.calls.push(context);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error("provider unavailable");
    }
    return this.draft;
  }
}

function obs(over: Partial<InquiryObservation> = {}): InquiryObservation {
  return {
    sellerId: "seller-1",
    connectionId: "conn-1",
    channel: "NAVER",
    channelInquiryId: "INQ-1",
    productId: "prod-1",
    orderRef: "ORDER-9",
    inquiryText: "이 상품 재고 있나요? 홍길동 010-0000-0000",
    observedAt: 5,
    responseDeadlineAt: null,
    category: { topicCategory: "stock", severityBucket: "mid" },
    ...over,
  };
}

function expectOk(o: InquiryIngestOutcome): Extract<InquiryIngestOutcome, { ok: true }> {
  if (!o.ok) throw new Error(`expected ok, got ${o.reason}`);
  return o;
}

describe("normal seller inquiry intake", () => {
  it("runs observation → signal → work item → proposal and stops at PROPOSED (Seller approval pending)", async () => {
    const provider = new FakeProvider();
    const out = expectOk(await new InquiryIntakeCoordinator(provider).ingest(obs(), 100));
    expect(out.idempotent).toBe(false);
    expect(out.slice.aggregate.workItem.phase).toBe("PROPOSED");
    expect(out.slice.proposal).not.toBeNull();
    expect(out.slice.proposal!.actionKind).toBe("POST_INQUIRY_REPLY"); // a Seller-channel inquiry reply
    expect(out.slice.proposal!.summaryCategory).toBe("stock_availability_reply");
    expect(out.slice.signal.kind).toBe("cs_inquiry");
    expect(out.slice.aggregate.workItem.owner).toEqual({ role: "SELLER", partyId: "seller-1" });
  });
});

describe("duplicate observation idempotency", () => {
  it("re-ingesting the same observation returns the existing slice without re-drafting or re-opening", async () => {
    const provider = new FakeProvider();
    const coord = new InquiryIntakeCoordinator(provider);
    const first = expectOk(await coord.ingest(obs(), 100));
    const second = await coord.ingest(obs(), 200);
    expect(second).toMatchObject({ ok: true, idempotent: true });
    expect(provider.calls).toHaveLength(1); // no second draft
    if (second.ok) expect(second.slice.aggregate.workItem.workItemId).toBe(first.slice.aggregate.workItem.workItemId);
  });
});

describe("same inquiry id on different connections remains isolated", () => {
  it("opens two independent work items for the same channel inquiry id on different connections", async () => {
    const provider = new FakeProvider();
    const coord = new InquiryIntakeCoordinator(provider);
    const a = expectOk(await coord.ingest(obs({ connectionId: "conn-1" }), 100));
    const b = expectOk(await coord.ingest(obs({ connectionId: "conn-2" }), 100));
    expect(a.slice.aggregate.workItem.workItemId).not.toBe(b.slice.aggregate.workItem.workItemId);
    expect(a.idempotent).toBe(false);
    expect(b.idempotent).toBe(false);
    expect(provider.calls).toHaveLength(2);
  });
});

describe("the proposal provider receives only the permitted seller context", () => {
  it("is called with the seller-visible context and no manufacturer / hashed / internal-id fields", async () => {
    const provider = new FakeProvider();
    await new InquiryIntakeCoordinator(provider).ingest(obs(), 100);
    expect(provider.calls).toHaveLength(1);
    const ctx = provider.calls[0]!;
    expect(Object.keys(ctx).sort()).toEqual(["category", "channel", "inquiryText", "orderRef", "productId", "responseDeadlineAt", "sellerId"]);
    expect(ctx.inquiryText).toBe(obs().inquiryText); // the seller sees its own raw text
    // No signal id, work-item id, sellerPrivate hashes, or manufacturer fields leaked into the context.
    expect(JSON.stringify(ctx)).not.toContain("Hash");
    expect(JSON.stringify(ctx)).not.toContain("wi-");
  });
});

describe("inquiry reply cannot auto-approve", () => {
  it("the proposal requires human approval and the coordinator never advances past PROPOSED", async () => {
    const out = expectOk(await new InquiryIntakeCoordinator(new FakeProvider()).ingest(obs(), 100));
    expect(out.slice.proposal!.requiresApproval).toBe(true);
    expect(out.slice.aggregate.approval).toBeNull(); // not approved
    const auto = autoApprove(out.slice.aggregate, { commandId: "c-auto", actor: { role: "SELLER", partyId: "seller-1" }, atMs: 200 });
    expect(auto).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
    expect(out.slice.aggregate.workItem.phase).toBe("PROPOSED");
  });
});

describe("provider failure leaves the work item open and retryable", () => {
  it("a first-attempt provider failure keeps the work item OPEN; a later ingestion retries and proposes", async () => {
    const provider = new FakeProvider();
    provider.failuresRemaining = 1;
    const coord = new InquiryIntakeCoordinator(provider);

    const failed = await coord.ingest(obs(), 100);
    expect(failed.ok).toBe(false);
    if (failed.ok || failed.reason !== "PROPOSAL_UNAVAILABLE") throw new Error("expected PROPOSAL_UNAVAILABLE");
    expect(failed.slice.aggregate.workItem.phase).toBe("OPEN"); // left open
    expect(failed.slice.proposal).toBeNull();

    const retried = expectOk(await coord.ingest(obs(), 150));
    expect(retried.slice.aggregate.workItem.phase).toBe("PROPOSED");
    expect(retried.slice.aggregate.workItem.workItemId).toBe(failed.slice.aggregate.workItem.workItemId); // same work item
    expect(provider.calls).toHaveLength(2); // failed once, retried once
  });

  it("the retry reuses the SAME work item — no second work item is created", async () => {
    const provider = new FakeProvider();
    provider.failuresRemaining = 1;
    const coord = new InquiryIntakeCoordinator(provider);
    await coord.ingest(obs(), 100); // fails, work item left OPEN
    const retried = expectOk(await coord.ingest(obs(), 150)); // retry succeeds
    expect(coord.snapshot().entries).toHaveLength(1); // exactly one work item tracked
    expect(retried.slice.aggregate.audit.filter((e) => e.type === "WORK_ITEM_OPENED")).toHaveLength(1); // opened once
  });
});

describe("provider context is reconstructed solely from the created signal", () => {
  it("the provider is called with exactly sellerContextFromSignal(signal) — not the observation", async () => {
    const provider = new FakeProvider();
    const out = expectOk(await new InquiryIntakeCoordinator(provider).ingest(obs(), 100));
    // Reconstruct the expected context from the SIGNAL alone; it must equal what the provider received.
    expect(sellerContextFromSignal(out.slice.signal)).toEqual(provider.calls[0]);
  });
});

describe("manufacturer projection cannot see the seller-private raw values", () => {
  it("a granted manufacturer (no seller-private field grant) sees the signal but not the raw text/order", () => {
    const o = obs();
    const signal = toInquirySignal(o, deriveSourceIds(o));
    const grant: DataGrant = {
      grantId: "g-1",
      sellerId: "seller-1",
      manufacturerId: "maker-1",
      scope: { channels: ["NAVER"], productIds: ["prod-1"], signalKinds: ["cs_inquiry"], includeSellerPrivateFields: false },
      revoked: false,
      notBeforeMs: null,
      notAfterMs: null,
    };
    const view = projectSignalForViewer(signal, { role: "MANUFACTURER", partyId: "maker-1" }, grant, 0);
    expect(view.visible).toBe(true);
    if (!view.visible) return;
    expect(view.signal.sellerPrivate).toBeNull(); // whole seller-private compartment stripped
    const serialized = JSON.stringify(view.signal);
    expect(serialized.includes(o.inquiryText)).toBe(false);
    expect(serialized.includes("ORDER-9")).toBe(false);
  });
});

describe("coordinator dedup state is serializable and rehydratable", () => {
  it("state survives JSON serialization and still deduplicates (idempotent, no re-draft)", async () => {
    const coord = new InquiryIntakeCoordinator(new FakeProvider());
    const first = expectOk(await coord.ingest(obs(), 100));

    const rehydratedState = JSON.parse(JSON.stringify(coord.snapshot())) as InquiryCoordinatorState;
    const freshProvider = new FakeProvider();
    const rebuilt = InquiryIntakeCoordinator.fromSnapshot(rehydratedState, freshProvider);

    const again = await rebuilt.ingest(obs(), 200);
    expect(again).toMatchObject({ ok: true, idempotent: true });
    expect(freshProvider.calls).toHaveLength(0); // no re-draft after rehydration
    if (again.ok) expect(again.slice.aggregate.workItem.workItemId).toBe(first.slice.aggregate.workItem.workItemId);
  });

  it("a conflicting source payload after rehydration returns SOURCE_CONFLICT", async () => {
    const coord = new InquiryIntakeCoordinator(new FakeProvider());
    await coord.ingest(obs({ inquiryText: "original" }), 100);
    const rebuilt = InquiryIntakeCoordinator.fromSnapshot(JSON.parse(JSON.stringify(coord.snapshot())) as InquiryCoordinatorState, new FakeProvider());
    expect(await rebuilt.ingest(obs({ inquiryText: "TAMPERED" }), 200)).toEqual({ ok: false, reason: "SOURCE_CONFLICT" });
  });
});

describe("conflicting reuse of a source identity is rejected", () => {
  it("the same (channel, connection, channelInquiryId) with different content is a SOURCE_CONFLICT", async () => {
    const coord = new InquiryIntakeCoordinator(new FakeProvider());
    await coord.ingest(obs({ inquiryText: "first" }), 100);
    expect(await coord.ingest(obs({ inquiryText: "DIFFERENT CONTENT" }), 100)).toEqual({ ok: false, reason: "SOURCE_CONFLICT" });
  });
});

describe("the inquiry slice is pure/offline", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = resolve(here, "..", "..", "src", "inquiry");
  const files = ["observation.ts", "proposal-provider.ts", "intake.ts", "coordinator.ts"];

  it("reads no wall clock and imports no http / browser / connector / upload", () => {
    for (const file of files) {
      const raw = readFileSync(resolve(srcDir, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["Date.now", "new Date", "Date.parse", "Date.UTC", "Math.random", "fetch("]) {
        expect(code.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
      for (const badImport of ["node:http", "node:https", "playwright", "../connector/", "../naver/", "../upload", "../esm/"]) {
        expect(code.includes(`from "${badImport}"`), `${file} must not import ${badImport}`).toBe(false);
      }
    }
  });
});
