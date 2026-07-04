/**
 * Shared builders for the commerce work-domain tests (not a test file — no `.test.` suffix, so vitest does
 * not collect it). Every value is sanitized: coarse enums / opaque hashes / caller-supplied epoch-ms.
 */

import type { CommerceSignal, Party, SignalKind } from "../../src/work/types";
import type { DataGrant, DataGrantScope } from "../../src/work/data-grant";
import type { CommerceChannel } from "../../src/connection/sync-state";
import type {
  OpenWorkItemCommand,
  ProposeActionCommand,
  ApprovalCommand,
  CreateActionIntentCommand,
  RecordExecutionCommand,
  RecordVerificationCommand,
} from "../../src/work/work-item";

export const seller = (partyId = "seller-1"): Party => ({ role: "SELLER", partyId });
export const manufacturer = (partyId = "maker-1"): Party => ({ role: "MANUFACTURER", partyId });

// ── Command builders (every state-changing command carries an explicit commandId) ──────────────────

export const openCmd = (o: Partial<OpenWorkItemCommand> = {}): OpenWorkItemCommand => ({ commandId: "c-open", workItemId: "wi-1", actor: seller(), atMs: 10, ...o });
export const proposeCmd = (o: Partial<ProposeActionCommand> = {}): ProposeActionCommand => ({ commandId: "c-prop", proposalId: "p-1", actor: seller(), actionKind: "POST_INQUIRY_REPLY", summaryCategory: "reply", atMs: 20, ...o });
export const approveCmd = (o: Partial<ApprovalCommand> = {}): ApprovalCommand => ({ commandId: "c-appr", actor: seller(), atMs: 30, ...o });
export const intentCmd = (o: Partial<CreateActionIntentCommand> = {}): CreateActionIntentCommand => ({ commandId: "c-int", actionIntentId: "ai-1", actor: seller(), paramsCategory: "c", atMs: 40, ...o });
export const execCmd = (o: Partial<RecordExecutionCommand> = {}): RecordExecutionCommand => ({ commandId: "c-exec", executionResultId: "ex-1", actor: seller(), success: true, outcomeCategory: "done", atMs: 50, ...o });
export const verifyCmd = (o: Partial<RecordVerificationCommand> = {}): RecordVerificationCommand => ({ commandId: "c-ver", verificationResultId: "ve-1", actor: seller(), verified: true, checkCategory: "ok", atMs: 60, ...o });

export function signal(overrides: Partial<CommerceSignal> = {}): CommerceSignal {
  return {
    signalId: "sig-1",
    channel: "NAVER",
    kind: "cs_inquiry",
    sellerId: "seller-1",
    productRef: { productId: "prod-1" },
    shareable: { severityBucket: "mid", topicCategory: "sizing", recencyBucket: "recent_1_3d" },
    sellerPrivate: { sourceText: "raw inquiry body", orderRef: "ORDER-9", channelSourceRef: "INQ-1", responseDeadlineAt: null, orderRefHash: "ord-hash-abc", customerRefHash: "cust-hash-xyz" },
    ...overrides,
  };
}

export function grant(overrides: Partial<DataGrant> = {}, scopeOverrides: Partial<DataGrantScope> = {}): DataGrant {
  const scope: DataGrantScope = {
    channels: ["NAVER"] as CommerceChannel[],
    productIds: ["prod-1"],
    signalKinds: ["cs_inquiry", "product_voc"] as SignalKind[],
    includeSellerPrivateFields: false,
    ...scopeOverrides,
  };
  return {
    grantId: "grant-1",
    sellerId: "seller-1",
    manufacturerId: "maker-1",
    scope,
    revoked: false,
    notBeforeMs: null,
    notAfterMs: null,
    ...overrides,
  };
}

/** A fixed reference time used across grant tests (no wall-clock read anywhere in the domain). */
export const REF_MS = 1_000;
