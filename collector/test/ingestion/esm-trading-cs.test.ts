/**
 * Pure offline tests for the ESM Trading CS API contract slice (official-fields DTO, Model B).
 *
 * Focus: an official CS record + query context maps to the existing envelope and reaches a PROPOSED WorkItem;
 * title + details are preserved in sellerPrivate; inquirer PII is discarded at the DTO boundary; the reply
 * token is extracted to the encrypted store (keyed by connectionId + sellerId + messageNo) and never leaks;
 * the master Secret-Key ref never leaks; the A/G site is resolved from context + connection; the 7-day window
 * and the 1000-byte answer limit are enforced; already-answered inquiries are skipped.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  ESM_TRADING_CS_ADAPTER,
  ESM_CS_QUERY_WINDOW_MAX_MS,
  ESM_CS_ANSWER_MAX_BYTES,
  validateQueryWindow,
  validateAnswerComments,
  validateQueryStatus,
  validateAnswerStatus,
  discardInquirerPii,
  type EsmTradingCsClient,
  type EsmCsInquiryRecord,
  type EsmCsRawInquiry,
  type EsmCsAnswerRequest,
  type ProviderCredentialRef,
  type SellerConnection,
} from "../../src/ingestion/esm-trading-cs-client";
import { InMemoryEsmReplyTokenStore } from "../../src/ingestion/esm-reply-token-store";
import { ingestEsmTradingCsRecord, ingestEsmTradingCsRecords, type EsmCsIngestContext } from "../../src/ingestion/esm-trading-cs-ingest";
import { InquiryIngestionConsumer, type IngestionContext } from "../../src/ingestion/consumer";
import { InquiryIntakeCoordinator } from "../../src/inquiry/coordinator";
import { sellerContextFromSignal } from "../../src/inquiry/intake";
import { projectSignalForViewer } from "../../src/work/access";
import type { DataGrant } from "../../src/work/data-grant";
import type { InquiryProposalProvider } from "../../src/inquiry/proposal-provider";

const REPLY_TOKEN = "esm-reply-token-SECRET-abc123";
const SECRET_KEY_REF = "vault://sellerops-esm-secret-key-SECRET";
const DETAILS = "이 상품 재고 있나요?";
const TITLE = "재고 문의";
const ORDER_NO = "ORDER-9";
const INQUIRER_NAME = "홍길동";
const INQUIRER_PHONE = "010-0000-0000";
const GM_SELLER = "gm-seller-1";
const AU_SELLER = "au-seller-2";

const MASTER: ProviderCredentialRef = { provider: "ESM_TRADING_CS", masterId: "esm-master-1", secretKeyRef: SECRET_KEY_REF };
const connA: SellerConnection = { sellerId: "seller-1", connectionId: "conn-1", channel: "ESM", gmarketSellerId: GM_SELLER, auctionSellerId: null };
const connB: SellerConnection = { sellerId: "seller-2", connectionId: "conn-2", channel: "ESM", gmarketSellerId: null, auctionSellerId: AU_SELLER };
const ctxA: EsmCsIngestContext = { marketplace: "GMARKET", capturedAt: 100, observedAtMs: 5 };
const ctxB: EsmCsIngestContext = { marketplace: "AUCTION", capturedAt: 100, observedAtMs: 5 };

function record(over: Partial<EsmCsInquiryRecord> = {}): EsmCsInquiryRecord {
  return {
    qnaType: "NORMAL", sellerId: GM_SELLER, messageNo: "MSG-1", goodsNo: "goods-1", siteGoodsNo: "site-goods-1",
    orderNo: ORDER_NO, payNo: "PAY-1", informStatus: "미처리", receiveDate: "2026-07-04 10:00:00", answerDate: null,
    contractType: "C", title: TITLE, details: DETAILS, token: REPLY_TOKEN, reAsking: false, ...over,
  };
}

function countingProvider(): InquiryProposalProvider & { calls: number } {
  const p = { calls: 0, propose: async () => { p.calls++; return { summaryCategory: "stock_reply_draft" }; } };
  return p;
}

describe("official record + context → envelope → PROPOSED WorkItem", () => {
  it("maps an unanswered Gmarket record and reaches a PROPOSED work item, preserving title + details", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    const mapped = await ingestEsmTradingCsRecord(record(), connA, ctxA, store);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.envelope.sourceAdapter).toEqual(ESM_TRADING_CS_ADAPTER);
    expect(mapped.envelope.channelInquiryId).toBe("MSG-1");
    expect(mapped.envelope.productId).toBe("goods-1"); // goodsNo (master), not siteGoodsNo
    expect(mapped.envelope.sourceObservedAt).toBe(5); // context-supplied, not parsed from receiveDate
    expect(mapped.envelope.responseDeadlineAt).toBeNull();
    expect(mapped.envelope.sellerPrivatePayload).toEqual({ inquiryText: DETAILS, orderRef: ORDER_NO, title: TITLE }); // preserved

    const ctx: IngestionContext = { authenticatedSellerId: "seller-1", authorizedConnectionIds: ["conn-1"] };
    const out = await new InquiryIngestionConsumer(new InquiryIntakeCoordinator(countingProvider())).ingest(mapped.envelope, ctx, 200);
    expect(out).toMatchObject({ ok: true, phase: "PROPOSED", proposed: true });
  });

  it("stores the reply token keyed by connectionId + sellerId + messageNo", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    await ingestEsmTradingCsRecord(record(), connA, ctxA, store);
    expect(await store.get({ connectionId: "conn-1", sellerId: "seller-1", messageNo: "MSG-1" })).toBe(REPLY_TOKEN);
    expect(await store.get({ connectionId: "conn-1", sellerId: "seller-9", messageNo: "MSG-1" })).toBeNull();
  });
});

describe("inquirer PII is discarded at the DTO boundary", () => {
  it("discardInquirerPii drops inquirerName/inquirerPhone and they never reach the DTO or envelope", async () => {
    const raw: EsmCsRawInquiry = { ...record(), inquirerName: INQUIRER_NAME, inquirerPhone: INQUIRER_PHONE };
    const dto = discardInquirerPii(raw);
    expect("inquirerName" in dto).toBe(false);
    expect("inquirerPhone" in dto).toBe(false);
    expect(JSON.stringify(dto).includes(INQUIRER_NAME)).toBe(false);
    expect(JSON.stringify(dto).includes(INQUIRER_PHONE)).toBe(false);

    const store = new InMemoryEsmReplyTokenStore();
    const mapped = await ingestEsmTradingCsRecord(dto, connA, ctxA, store);
    if (!mapped.ok) throw new Error("map failed");
    const envJson = JSON.stringify(mapped.envelope);
    expect(envJson.includes(INQUIRER_NAME)).toBe(false);
    expect(envJson.includes(INQUIRER_PHONE)).toBe(false);
  });
});

describe("secrets never leak", () => {
  it("reply token and master secret-key ref are absent from envelope, WorkItem, audit, and sanitized results", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    const mapped = await ingestEsmTradingCsRecord(record(), connA, ctxA, store);
    if (!mapped.ok) throw new Error("map failed");
    const envJson = JSON.stringify(mapped.envelope);
    expect(envJson.includes(REPLY_TOKEN)).toBe(false);
    expect(envJson.includes(SECRET_KEY_REF)).toBe(false);

    const coordinator = new InquiryIntakeCoordinator(countingProvider());
    const ctx: IngestionContext = { authenticatedSellerId: "seller-1", authorizedConnectionIds: ["conn-1"] };
    const result = await new InquiryIngestionConsumer(coordinator).ingest(mapped.envelope, ctx, 200);
    const resultJson = JSON.stringify(result); // sanitized outcome
    for (const s of [REPLY_TOKEN, SECRET_KEY_REF, TITLE, DETAILS]) expect(resultJson.includes(s), `result leaked ${s}`).toBe(false);
    const snapshotJson = JSON.stringify(coordinator.snapshot());
    expect(snapshotJson.includes(REPLY_TOKEN)).toBe(false);
    expect(snapshotJson.includes(SECRET_KEY_REF)).toBe(false);

    expect(await store.get({ connectionId: "conn-1", sellerId: "seller-1", messageNo: "MSG-1" })).toBe(REPLY_TOKEN);
  });
});

describe("A/G site resolution + tenant isolation", () => {
  it("resolves the site from context + connection and isolates tenants (tokens + event ids)", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    const a = await ingestEsmTradingCsRecord(record({ sellerId: GM_SELLER }), connA, ctxA, store);
    const b = await ingestEsmTradingCsRecord(record({ sellerId: AU_SELLER }), connB, ctxB, store);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(await store.get({ connectionId: "conn-1", sellerId: "seller-1", messageNo: "MSG-1" })).toBe(REPLY_TOKEN);
    expect(await store.get({ connectionId: "conn-2", sellerId: "seller-2", messageNo: "MSG-1" })).toBe(REPLY_TOKEN);
    expect(a.envelope.eventId).not.toBe(b.envelope.eventId);
  });

  it("rejects a site the connection is not on, and a marketplace-seller-id mismatch", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    // connA has no Auction seller id → an Auction-context query is not authorized.
    expect(await ingestEsmTradingCsRecord(record({ sellerId: GM_SELLER }), connA, ctxB, store)).toEqual({ ok: false, reason: "SITE_NOT_AUTHORIZED" });
    // Gmarket context but the response's marketplace seller id doesn't match the connection's.
    expect(await ingestEsmTradingCsRecord(record({ sellerId: "some-other-seller" }), connA, ctxA, store)).toEqual({ ok: false, reason: "SITE_NOT_AUTHORIZED" });
  });
});

describe("record validation", () => {
  it("eligibility is driven solely by informStatus (미처리 in, 처리완료 skipped, unknown fails closed); answerDate is ignored", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    // 처리완료 → skip.
    expect(await ingestEsmTradingCsRecord(record({ informStatus: "처리완료" }), connA, ctxA, store)).toEqual({ ok: false, reason: "ALREADY_ANSWERED" });
    expect(await store.get({ connectionId: "conn-1", sellerId: "seller-1", messageNo: "MSG-1" })).toBeNull();
    // Unknown status → fail closed.
    expect(await ingestEsmTradingCsRecord(record({ informStatus: "알수없음" }), connA, ctxA, store)).toEqual({ ok: false, reason: "UNKNOWN_STATUS" });
    // 미처리 with a sentinel answerDate → still eligible; answerDate is never consulted for eligibility.
    const eligible = await ingestEsmTradingCsRecord(record({ informStatus: "미처리", answerDate: "0000-00-00" }), connA, ctxA, store);
    expect(eligible.ok).toBe(true);
  });

  it("rejects blank tenant / message identity without fabricating", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    expect(await ingestEsmTradingCsRecord(record({ messageNo: "  " }), connA, ctxA, store)).toEqual({ ok: false, reason: "MISSING_MESSAGE_NO" });
    expect(await ingestEsmTradingCsRecord(record(), { ...connA, sellerId: "" }, ctxA, store)).toEqual({ ok: false, reason: "MISSING_SELLER_ID" });
  });
});

describe("title is preserved through the chain and hidden from manufacturers", () => {
  it("Envelope → InquiryObservation → CommerceSignal.sellerPrivate → SellerInquiryContext keeps title; manufacturer projection strips it", async () => {
    const store = new InMemoryEsmReplyTokenStore();
    const mapped = await ingestEsmTradingCsRecord(record(), connA, ctxA, store);
    if (!mapped.ok) throw new Error("map failed");
    expect(mapped.envelope.sellerPrivatePayload.title).toBe(TITLE);

    const coordinator = new InquiryIntakeCoordinator(countingProvider());
    const ctx: IngestionContext = { authenticatedSellerId: "seller-1", authorizedConnectionIds: ["conn-1"] };
    await new InquiryIngestionConsumer(coordinator).ingest(mapped.envelope, ctx, 200);
    const signal = coordinator.snapshot().entries[0]!.slice.signal;
    // Preserved into the signal's seller-private compartment + the reconstructed seller context.
    expect(signal.sellerPrivate.title).toBe(TITLE);
    expect(sellerContextFromSignal(signal)?.title).toBe(TITLE);

    // A granted manufacturer (no seller-private field grant) never sees title or details.
    const grant: DataGrant = { grantId: "g", sellerId: "seller-1", manufacturerId: "maker-1", scope: { channels: ["ESM"], productIds: "ALL", signalKinds: ["cs_inquiry"], includeSellerPrivateFields: false }, revoked: false, notBeforeMs: null, notAfterMs: null };
    const view = projectSignalForViewer(signal, { role: "MANUFACTURER", partyId: "maker-1" }, grant, 0);
    expect(view.visible).toBe(true);
    if (view.visible) expect(view.signal.sellerPrivate).toBeNull(); // title + details stripped
    expect(JSON.stringify(view).includes(TITLE)).toBe(false);
    expect(JSON.stringify(view).includes(DETAILS)).toBe(false);
  });
});

describe("bounded windows and answer limits", () => {
  it("enforces the 7-day query window", () => {
    expect(validateQueryWindow({ fromMs: 0, toMs: ESM_CS_QUERY_WINDOW_MAX_MS })).toEqual({ ok: true });
    expect(validateQueryWindow({ fromMs: 0, toMs: ESM_CS_QUERY_WINDOW_MAX_MS + 1 })).toEqual({ ok: false, reason: "WINDOW_TOO_LARGE" });
    expect(validateQueryWindow({ fromMs: 500, toMs: 100 })).toEqual({ ok: false, reason: "INVALID_WINDOW" });
  });

  it("enforces the 1000-byte answer comments limit (UTF-8)", () => {
    const answer: EsmCsAnswerRequest = { messageNo: "MSG-1", token: REPLY_TOKEN, answerStatus: 1, title: TITLE, comments: "재고 있습니다." };
    expect(validateAnswerComments(answer.comments)).toEqual({ ok: true });
    expect(validateAnswerComments("")).toEqual({ ok: false, reason: "EMPTY" });
    expect(validateAnswerComments("가".repeat(333))).toEqual({ ok: true }); // 999 bytes
    expect(validateAnswerComments("가".repeat(334))).toEqual({ ok: false, reason: "TOO_LONG" }); // 1002 bytes
  });

  it("rejects unsupported query/answer status values at the validation boundary", () => {
    for (const s of [1, 2, 3, 4, 5]) expect(validateQueryStatus(s)).toEqual({ ok: true });
    for (const s of [0, 6, 2.5, -1]) expect(validateQueryStatus(s)).toEqual({ ok: false, reason: "UNSUPPORTED_QUERY_STATUS" });
    for (const s of [1, 2]) expect(validateAnswerStatus(s)).toEqual({ ok: true });
    for (const s of [0, 3, 1.5]) expect(validateAnswerStatus(s)).toEqual({ ok: false, reason: "UNSUPPORTED_ANSWER_STATUS" });
  });
});

describe("client seam → batch mapping", () => {
  it("a fake client's records map independently and in order (unanswered proposed, answered skipped)", async () => {
    const client: EsmTradingCsClient = {
      listInquiries: async () => [record({ messageNo: "MSG-A" }), record({ messageNo: "MSG-B", informStatus: "처리완료" }), record({ messageNo: "MSG-C" })],
    };
    const window = { fromMs: 0, toMs: ESM_CS_QUERY_WINDOW_MAX_MS };
    expect(validateQueryWindow(window).ok).toBe(true);
    const store = new InMemoryEsmReplyTokenStore();
    const records = await client.listInquiries(MASTER, connA, { window, status: 1 });
    const results = await ingestEsmTradingCsRecords(records, connA, ctxA, store);
    expect(results.map((r) => (r.ok ? r.envelope.channelInquiryId : r.reason))).toEqual(["MSG-A", "ALREADY_ANSWERED", "MSG-C"]);
    expect(await store.get({ connectionId: "conn-1", sellerId: "seller-1", messageNo: "MSG-B" })).toBeNull();
  });
});

describe("the ESM Trading CS slice keeps tokens out of logs (pure/offline)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = resolve(here, "..", "..", "src", "ingestion");
  const files = ["esm-trading-cs-client.ts", "esm-reply-token-store.ts", "esm-trading-cs-ingest.ts"];

  it("imports no log / http / browser / connector and reads no wall clock", () => {
    for (const file of files) {
      const raw = readFileSync(resolve(srcDir, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["Date.now", "new Date", "Date.parse", "Date.UTC", "Math.random", "fetch("]) {
        expect(code.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
      for (const badImport of ["../log", "node:http", "node:https", "playwright", "../connector/", "../naver/", "../esm/"]) {
        expect(code.includes(`from "${badImport}"`), `${file} must not import ${badImport}`).toBe(false);
      }
    }
  });
});
