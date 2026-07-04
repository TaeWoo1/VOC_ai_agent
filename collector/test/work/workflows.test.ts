/**
 * Pure offline end-to-end workflow tests + domain-boundary guards.
 *
 * Focus: the seller inquiry workflow (Signal → Proposal → Seller Approval → ActionIntent → Execution →
 * Verification) and the seller order-exception workflow both run to COMPLETED; a manufacturer can REQUEST a
 * seller action through an active grant but can never directly execute a seller-channel write; a grant
 * revoked after a manufacturer work item was opened denies further transitions (`ACCESS_REVOKED`) and
 * redacts projection; one failed work item does not affect another; and the domain reads no wall clock.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  openSellerWorkItem,
  openManufacturerWorkItem,
  proposeAction,
  approve,
  autoApprove,
  createActionIntent,
  recordExecution,
  recordVerification,
  type GrantAuthzContext,
} from "../../src/work/work-item";
import { DEFAULT_APPROVAL_POLICY } from "../../src/work/approval-policy";
import { projectSignalForViewer, projectWorkItemForViewer } from "../../src/work/access";
import type { TransitionOutcome, WorkItemAggregate } from "../../src/work/types";
import { seller, manufacturer, signal, grant, openCmd, proposeCmd, approveCmd, intentCmd, execCmd, verifyCmd } from "./fixtures";

const policy = DEFAULT_APPROVAL_POLICY;
const REF = 1_000;

function unwrap(o: TransitionOutcome): WorkItemAggregate {
  if (!o.ok) throw new Error(`expected ok, got ${o.error.code}: ${o.error.message}`);
  return o.aggregate;
}

describe("seller inquiry workflow", () => {
  it("Signal → Proposal → Seller Approval → ActionIntent → Execution → Verification", () => {
    const opened = unwrap(openSellerWorkItem(signal({ kind: "cs_inquiry" }), openCmd({ workItemId: "wi-inq" })));
    const proposed = unwrap(proposeAction(opened, proposeCmd({ actionKind: "POST_INQUIRY_REPLY" }), policy));
    const approved = unwrap(approve(proposed, approveCmd({ actor: seller("seller-1") }))); // explicit Seller approval
    const intent = unwrap(createActionIntent(approved, intentCmd()));
    const executed = unwrap(recordExecution(intent, execCmd({ success: true })));
    const completed = unwrap(recordVerification(executed, verifyCmd({ verified: true })));

    expect(completed.workItem.phase).toBe("COMPLETED");
    expect(completed.approval).toMatchObject({ mode: "HUMAN", approver: seller("seller-1") });
    expect(completed.audit.map((e) => e.type)).toEqual(["WORK_ITEM_OPENED", "PROPOSAL_ADDED", "APPROVAL_GRANTED", "ACTION_INTENT_CREATED", "EXECUTION_RECORDED", "VERIFICATION_RECORDED"]);
  });
});

describe("seller order-exception workflow", () => {
  it("an order/shipment change requires human approval, then completes end-to-end", () => {
    const opened = unwrap(openSellerWorkItem(signal({ kind: "order_exception" }), openCmd({ workItemId: "wi-ord" })));
    const proposed = unwrap(proposeAction(opened, proposeCmd({ actionKind: "CHANGE_ORDER_OR_SHIPMENT", summaryCategory: "reship" }), policy));
    expect(proposed.proposal!.requiresApproval).toBe(true);
    const approved = unwrap(approve(proposed, approveCmd({ actor: seller("seller-1") })));
    const completed = unwrap(recordVerification(unwrap(recordExecution(unwrap(createActionIntent(approved, intentCmd())), execCmd({ success: true }))), verifyCmd({ verified: true })));
    expect(completed.workItem.phase).toBe("COMPLETED");
    expect(completed.approval!.mode).toBe("HUMAN");
  });
});

describe("manufacturer product/VOC visibility + action authority through DataGrant", () => {
  const vocSignal = signal({ signalId: "voc-1", kind: "product_voc" });
  const authz = (g = grant(), referenceTimeMs = REF): GrantAuthzContext => ({ grant: g, referenceTimeMs });

  it("with an active grant, a manufacturer can see the VOC signal and open a product/VOC work item", () => {
    const view = projectSignalForViewer(vocSignal, manufacturer("maker-1"), grant(), REF);
    expect(view.visible).toBe(true);
    if (view.visible) expect(view.signal.sellerPrivate).toBeNull(); // shareable only, no order/customer refs

    const opened = unwrap(openManufacturerWorkItem(vocSignal, openCmd({ workItemId: "wi-voc", actor: manufacturer("maker-1") }), grant(), REF));
    expect(opened.workItem.owner).toEqual({ role: "MANUFACTURER", partyId: "maker-1" });
    const wiView = projectWorkItemForViewer(opened.workItem, manufacturer("maker-1"), grant(), REF);
    expect(wiView.visible).toBe(true);
  });

  it("a manufacturer can REQUEST a seller action but cannot directly create a seller-channel write", () => {
    const opened = unwrap(openManufacturerWorkItem(vocSignal, openCmd({ workItemId: "wi-voc", actor: manufacturer("maker-1") }), grant(), REF));

    // Allowed: request the seller to act (no direct side effect), driven to completion by the manufacturer.
    const requested = unwrap(proposeAction(opened, proposeCmd({ actor: manufacturer("maker-1"), actionKind: "REQUEST_SELLER_ACTION", summaryCategory: "please_reship" }), policy, authz()));
    expect(requested.proposal!.requiresApproval).toBe(true); // still needs a human sign-off
    const approved = unwrap(approve(requested, approveCmd({ actor: manufacturer("maker-1") })));
    const intent = unwrap(createActionIntent(approved, intentCmd({ actor: manufacturer("maker-1") }), authz()));
    expect(intent.workItem.phase).toBe("ACTION_PENDING");
    expect(intent.actionIntent!.actionKind).toBe("REQUEST_SELLER_ACTION");

    // Denied: a manufacturer proposing a direct seller-channel write is refused on authority.
    const write = proposeAction(opened, proposeCmd({ actor: manufacturer("maker-1"), actionKind: "POST_INQUIRY_REPLY" }), policy, authz());
    expect(write).toMatchObject({ ok: false, error: { code: "AUTHORITY_DENIED" } });
  });
});

describe("grant revoked / expired after a manufacturer work item is opened", () => {
  const vocSignal = signal({ signalId: "voc-1", kind: "product_voc" });

  it("further transitions return ACCESS_REVOKED and projection is redacted (no riding a previously valid grant)", () => {
    const opened = unwrap(openManufacturerWorkItem(vocSignal, openCmd({ workItemId: "wi-voc", actor: manufacturer("maker-1") }), grant(), REF));

    // Grant revoked AFTER opening → the next transition re-evaluates and is denied.
    const revokedAuthz: GrantAuthzContext = { grant: grant({ revoked: true }), referenceTimeMs: REF };
    expect(proposeAction(opened, proposeCmd({ actor: manufacturer("maker-1"), actionKind: "REQUEST_SELLER_ACTION" }), policy, revokedAuthz)).toMatchObject({ ok: false, error: { code: "ACCESS_REVOKED" } });
    expect(projectWorkItemForViewer(opened.workItem, manufacturer("maker-1"), grant({ revoked: true }), REF)).toEqual({ visible: false, reason: "REVOKED" });

    // Expiry is evaluated against the reference time.
    const expiredAuthz: GrantAuthzContext = { grant: grant({ notAfterMs: 500 }), referenceTimeMs: 600 };
    expect(proposeAction(opened, proposeCmd({ actor: manufacturer("maker-1"), actionKind: "REQUEST_SELLER_ACTION" }), policy, expiredAuthz)).toMatchObject({ ok: false, error: { code: "ACCESS_REVOKED" } });
  });

  it("a manufacturer transition with no grant context fails closed (ACCESS_REVOKED)", () => {
    const opened = unwrap(openManufacturerWorkItem(vocSignal, openCmd({ workItemId: "wi-voc", actor: manufacturer("maker-1") }), grant(), REF));
    expect(proposeAction(opened, proposeCmd({ actor: manufacturer("maker-1"), actionKind: "REQUEST_SELLER_ACTION" }), policy)).toMatchObject({ ok: false, error: { code: "ACCESS_REVOKED" } });
  });
});

describe("cross-work-item isolation", () => {
  it("one work item failing verification does not affect another that completes", () => {
    const drive = (workItemId: string, signalId: string, verified: boolean): WorkItemAggregate => {
      const opened = unwrap(openSellerWorkItem(signal({ signalId }), openCmd({ workItemId })));
      const approved = unwrap(autoApprove(unwrap(proposeAction(opened, proposeCmd({ actionKind: "CLASSIFY_SIGNAL" }), policy)), approveCmd()));
      const executed = unwrap(recordExecution(unwrap(createActionIntent(approved, intentCmd())), execCmd({ success: true })));
      return unwrap(recordVerification(executed, verifyCmd({ verified })));
    };
    const a = drive("wi-a", "s-a", false); // fails verification
    const b = drive("wi-b", "s-b", true); // completes

    expect(a.workItem.phase).toBe("FAILED");
    expect(a.workItem.failureReason).toBe("VERIFICATION_FAILED");
    expect(b.workItem.phase).toBe("COMPLETED");
    expect(a.audit.every((e) => e.workItemId === "wi-a")).toBe(true);
    expect(b.audit.every((e) => e.workItemId === "wi-b")).toBe(true);
  });
});

describe("the work domain reads no wall clock", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = resolve(here, "..", "..", "src", "work");
  const files = ["types.ts", "data-grant.ts", "approval-policy.ts", "action-authority.ts", "access.ts", "work-item.ts"];

  it("no src/work module reads Date.* / Math.random, or imports fs / http / a connector", () => {
    for (const file of files) {
      const raw = readFileSync(resolve(srcDir, file), "utf8");
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["Date.now", "new Date", "Date.parse", "Date.UTC", "Math.random"]) {
        expect(code.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
      for (const badImport of ["node:fs", "node:http", "node:https", "playwright", "../connector/", "../naver/"]) {
        expect(code.includes(`from "${badImport}"`), `${file} must not import ${badImport}`).toBe(false);
      }
    }
  });
});
