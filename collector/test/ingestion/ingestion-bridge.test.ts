/**
 * Pure offline tests for the Local Agent → Cloud inquiry ingestion trust boundary.
 *
 * Focus: an ESM capture maps to a versioned envelope with a deterministic (seller-scoped) event id and
 * reaches a PROPOSED WorkItem; the consumer fails closed on schema / strict shape / adapter registry /
 * recomputed event id / authenticated context BEFORE the workflow; dedup / SOURCE_CONFLICT / isolation are
 * preserved; batch items are validated independently in stable order; and no failure or success result carries
 * inquiry text or order references.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { deriveEventId, INQUIRY_ENVELOPE_SCHEMA_VERSION, type InquiryIngestionEnvelope } from "../../src/ingestion/envelope";
import { esmCaptureToEnvelope, ESM_INQUIRY_ADAPTER, type EsmInquiryCapture } from "../../src/ingestion/esm-producer";
import { InquiryIngestionConsumer, type IngestionContext } from "../../src/ingestion/consumer";
import { InquiryIntakeCoordinator } from "../../src/inquiry/coordinator";
import type { InquiryProposalProvider } from "../../src/inquiry/proposal-provider";

const INQUIRY_TEXT = "이 상품 재고 있나요? 홍길동 010-0000-0000";
const ORDER_REF = "ORDER-9";
const CTX: IngestionContext = { authenticatedSellerId: "seller-1", authorizedConnectionIds: ["conn-1", "conn-2"] };

function countingProvider(): InquiryProposalProvider & { calls: number } {
  const p = { calls: 0, propose: async () => { p.calls++; return { summaryCategory: "stock_reply_draft" }; } };
  return p;
}

function capture(over: Partial<EsmInquiryCapture> = {}): EsmInquiryCapture {
  return { sellerId: "seller-1", connectionId: "conn-1", esmInquiryId: "ESM-INQ-1", productId: "prod-1", orderRef: ORDER_REF, inquiryText: INQUIRY_TEXT, observedAtMs: 5, responseDeadlineAtMs: null, topicCategory: "stock", severityBucket: "mid", ...over };
}

function envelopeFrom(over: Partial<EsmInquiryCapture> = {}, capturedAt = 100): InquiryIngestionEnvelope {
  const r = esmCaptureToEnvelope(capture(over), capturedAt);
  if (!r.ok) throw new Error(`capture rejected: ${r.reason}`);
  return r.envelope;
}

const consumer = (provider: InquiryProposalProvider) => new InquiryIngestionConsumer(new InquiryIntakeCoordinator(provider));

describe("ESM capture → envelope → PROPOSED Seller WorkItem", () => {
  it("a valid ESM capture with a known adapter and authorized context reaches a PROPOSED work item", async () => {
    const provider = countingProvider();
    const out = await consumer(provider).ingest(envelopeFrom(), CTX, 200);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.phase).toBe("PROPOSED");
    expect(out.proposed).toBe(true);
    expect(out.idempotent).toBe(false);
    expect(out.workItemId).toMatch(/^wi-/);
    expect(provider.calls).toBe(1);
    // The ESM producer emits exactly the registered descriptor.
    expect(envelopeFrom().sourceAdapter).toEqual(ESM_INQUIRY_ADAPTER);
  });
});

describe("deterministic seller-scoped event id", () => {
  it("is stable across captures and independent of capturedAt", () => {
    expect(envelopeFrom().eventId).toBe(envelopeFrom({}, 999).eventId);
    expect(envelopeFrom().eventId).toBe(deriveEventId({ schemaVersion: INQUIRY_ENVELOPE_SCHEMA_VERSION, sellerId: "seller-1", channel: "ESM", connectionId: "conn-1", channelInquiryId: "ESM-INQ-1" }));
  });

  it("identical connection/inquiry ids under DIFFERENT sellers produce different event ids", () => {
    expect(envelopeFrom({ sellerId: "seller-1" }).eventId).not.toBe(envelopeFrom({ sellerId: "seller-2" }).eventId);
  });
});

describe("consumer fails closed BEFORE the workflow", () => {
  it("rejects an unsupported schema version (no intake call)", async () => {
    const provider = countingProvider();
    const bad: InquiryIngestionEnvelope = { ...envelopeFrom(), schemaVersion: 999 as never };
    expect(await consumer(provider).ingest(bad, CTX, 200)).toMatchObject({ ok: false, reason: "UNSUPPORTED_SCHEMA_VERSION" });
    expect(provider.calls).toBe(0);
  });

  it("rejects a tampered event id (recomputed, never trusted)", async () => {
    const provider = countingProvider();
    const tampered: InquiryIngestionEnvelope = { ...envelopeFrom(), eventId: "evt-forged00000000" };
    expect(await consumer(provider).ingest(tampered, CTX, 200)).toMatchObject({ ok: false, reason: "EVENT_ID_MISMATCH" });
    expect(provider.calls).toBe(0);
  });

  it("rejects an unknown adapter name and an unsupported adapter version", async () => {
    const c = consumer(countingProvider());
    expect(await c.ingest({ ...envelopeFrom(), sourceAdapter: { name: "mystery", version: "1.0.0", channel: "ESM" } }, CTX, 200)).toMatchObject({ ok: false, reason: "UNKNOWN_ADAPTER" });
    expect(await c.ingest({ ...envelopeFrom(), sourceAdapter: { name: "esm-inquiry", version: "9.9.9", channel: "ESM" } }, CTX, 200)).toMatchObject({ ok: false, reason: "UNSUPPORTED_ADAPTER_VERSION" });
  });

  it("rejects a self-consistent but false adapter/channel claim (registry is authoritative)", async () => {
    // Adapter claims NAVER and envelope says NAVER (self-consistent), but esm-inquiry is registered for ESM.
    const bad: InquiryIngestionEnvelope = { ...envelopeFrom(), channel: "NAVER", sourceAdapter: { name: "esm-inquiry", version: "0.1.0", channel: "NAVER" } };
    expect(await consumer(countingProvider()).ingest(bad, CTX, 200)).toMatchObject({ ok: false, reason: "ADAPTER_CHANNEL_MISMATCH" });
  });

  it("rejects an authenticated seller mismatch and an unauthorized connection", async () => {
    const c = consumer(countingProvider());
    const otherSeller: IngestionContext = { authenticatedSellerId: "seller-2", authorizedConnectionIds: ["conn-1"] };
    expect(await c.ingest(envelopeFrom(), otherSeller, 200)).toMatchObject({ ok: false, reason: "SELLER_CONTEXT_MISMATCH" });
    const noConn: IngestionContext = { authenticatedSellerId: "seller-1", authorizedConnectionIds: ["conn-9"] };
    expect(await c.ingest(envelopeFrom(), noConn, 200)).toMatchObject({ ok: false, reason: "CONNECTION_NOT_AUTHORIZED" });
  });

  it("rejects invalid timestamps, a deadline before observation, and blank required payload fields", async () => {
    const c = consumer(countingProvider());
    expect(await c.ingest({ ...envelopeFrom(), sourceObservedAt: -1 }, CTX, 200)).toMatchObject({ ok: false, reason: "INVALID_ENVELOPE" });
    expect(await c.ingest({ ...envelopeFrom(), capturedAt: Number.NaN }, CTX, 200)).toMatchObject({ ok: false, reason: "INVALID_ENVELOPE" });
    expect(await c.ingest({ ...envelopeFrom(), sourceObservedAt: 500, responseDeadlineAt: 100 }, CTX, 200)).toMatchObject({ ok: false, reason: "INVALID_ENVELOPE" });
    expect(await c.ingest({ ...envelopeFrom(), sellerPrivatePayload: { inquiryText: "  ", orderRef: null } }, CTX, 200)).toMatchObject({ ok: false, reason: "INVALID_ENVELOPE" });
    expect(await c.ingest({ ...envelopeFrom(), productId: "" }, CTX, 200)).toMatchObject({ ok: false, reason: "INVALID_ENVELOPE" });
    expect(await c.ingest({ ...envelopeFrom(), category: { topicCategory: "stock", severityBucket: "MASSIVE" as never } }, CTX, 200)).toMatchObject({ ok: false, reason: "INVALID_ENVELOPE" });
  });
});

describe("ESM producer rejects missing source identity without fabricating", () => {
  it("rejects a blank channel inquiry id / connection id / seller id", () => {
    expect(esmCaptureToEnvelope(capture({ esmInquiryId: "  " }), 100)).toEqual({ ok: false, reason: "MISSING_CHANNEL_INQUIRY_ID" });
    expect(esmCaptureToEnvelope(capture({ connectionId: "" }), 100)).toEqual({ ok: false, reason: "MISSING_CONNECTION_ID" });
    expect(esmCaptureToEnvelope(capture({ sellerId: "" }), 100)).toEqual({ ok: false, reason: "MISSING_SELLER_ID" });
  });
});

describe("dedup, isolation, and conflict (preserved from intake)", () => {
  it("a duplicate envelope does not re-draft", async () => {
    const provider = countingProvider();
    const c = consumer(provider);
    const env = envelopeFrom();
    const first = await c.ingest(env, CTX, 200);
    const second = await c.ingest(env, CTX, 300);
    expect(second).toMatchObject({ ok: true, idempotent: true });
    expect(provider.calls).toBe(1);
    if (first.ok && second.ok) expect(second.workItemId).toBe(first.workItemId);
  });

  it("the same inquiry id on different connections stays isolated", async () => {
    const provider = countingProvider();
    const c = consumer(provider);
    const a = await c.ingest(envelopeFrom({ connectionId: "conn-1" }), CTX, 200);
    const b = await c.ingest(envelopeFrom({ connectionId: "conn-2" }), CTX, 200);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.workItemId).not.toBe(b.workItemId);
    expect(provider.calls).toBe(2);
  });

  it("a conflicting payload under the same source identity returns SOURCE_CONFLICT", async () => {
    const c = consumer(countingProvider());
    await c.ingest(envelopeFrom({ inquiryText: "original" }), CTX, 200);
    expect(await c.ingest(envelopeFrom({ inquiryText: "DIFFERENT" }), CTX, 200)).toMatchObject({ ok: false, reason: "SOURCE_CONFLICT" });
  });
});

describe("batch ingestion applies context + validation independently", () => {
  it("one authorization or validation failure does not block other items, and order is stable", async () => {
    const provider = countingProvider();
    const c = consumer(provider);
    const badSchema: InquiryIngestionEnvelope = { ...envelopeFrom({ esmInquiryId: "ESM-BAD" }), schemaVersion: 999 as never };
    const unauthorized = envelopeFrom({ connectionId: "conn-9", esmInquiryId: "ESM-U" }); // conn-9 not authorized
    const results = await c.ingestBatch([envelopeFrom({ esmInquiryId: "ESM-A" }), badSchema, unauthorized, envelopeFrom({ esmInquiryId: "ESM-C" })], CTX, 200);
    expect(results.map((r) => (r.ok ? "ok" : r.reason))).toEqual(["ok", "UNSUPPORTED_SCHEMA_VERSION", "CONNECTION_NOT_AUTHORIZED", "ok"]);
    expect(provider.calls).toBe(2); // only the two valid items drafted
  });

  it("a batch replay is idempotent (no second WorkItem, no re-draft)", async () => {
    const provider = countingProvider();
    const c = consumer(provider);
    const batch = [envelopeFrom({ esmInquiryId: "ESM-A" }), envelopeFrom({ esmInquiryId: "ESM-B" })];
    await c.ingestBatch(batch, CTX, 200);
    const replay = await c.ingestBatch(batch, CTX, 300);
    expect(replay.every((r) => r.ok && r.idempotent)).toBe(true);
    expect(provider.calls).toBe(2);
  });
});

describe("sanitized results and envelope transport", () => {
  it("no success OR failure result contains inquiry text, order reference, or draft text", async () => {
    const c = consumer(countingProvider());
    const results = await c.ingestBatch([
      envelopeFrom(),
      { ...envelopeFrom({ esmInquiryId: "ESM-X" }), eventId: "evt-forged00000000" }, // fails, still has payload
      envelopeFrom({ connectionId: "conn-9", esmInquiryId: "ESM-U" }), // unauthorized, still has payload
    ], CTX, 200);
    const serialized = JSON.stringify(results);
    expect(serialized.includes(INQUIRY_TEXT)).toBe(false);
    expect(serialized.includes(ORDER_REF)).toBe(false);
    expect(serialized.includes("stock_reply_draft")).toBe(false);
    expect(Object.keys(results[0]!).sort()).toEqual(["eventId", "idempotent", "ok", "phase", "proposed", "workItemId"]);
  });

  it("JSON serialization + rehydration preserve the envelope contract", async () => {
    const env = envelopeFrom();
    const rehydrated = JSON.parse(JSON.stringify(env)) as InquiryIngestionEnvelope;
    expect(rehydrated.eventId).toBe(env.eventId);
    expect(rehydrated.sellerPrivatePayload.inquiryText).toBe(INQUIRY_TEXT);
    const out = await consumer(countingProvider()).ingest(rehydrated, CTX, 200);
    expect(out.ok && out.proposed).toBe(true);
  });
});

describe("the ingestion bridge is pure/offline", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = resolve(here, "..", "..", "src", "ingestion");
  const files = ["envelope.ts", "adapter-registry.ts", "esm-producer.ts", "consumer.ts"];

  it("reads no wall clock and imports no http / browser / connector / persistence", () => {
    for (const file of files) {
      const raw = readFileSync(resolve(srcDir, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["Date.now", "new Date", "Date.parse", "Date.UTC", "Math.random", "fetch("]) {
        expect(code.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
      for (const badImport of ["node:http", "node:https", "playwright", "../connector/", "../naver/", "../esm/", "../upload"]) {
        expect(code.includes(`from "${badImport}"`), `${file} must not import ${badImport}`).toBe(false);
      }
    }
  });
});
