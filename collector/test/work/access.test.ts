/**
 * Pure offline tests for signal visibility / projection.
 *
 * Focus: the owning seller sees the full signal (seller-private included); another seller sees nothing; a
 * manufacturer sees a signal only through an active grant, with seller-private order/customer references
 * stripped unless the grant explicitly includes them; a revoked / expired grant projects to not-visible.
 */

import { describe, it, expect } from "vitest";

import { projectSignalForViewer } from "../../src/work/access";
import { seller, manufacturer, signal, grant } from "./fixtures";

describe("projectSignalForViewer", () => {
  it("gives the owning seller the full signal, including seller-private references", () => {
    const view = projectSignalForViewer(signal(), seller("seller-1"), null, 1_000);
    expect(view.visible).toBe(true);
    if (!view.visible) return;
    expect(view.signal.sellerPrivate).toEqual({ orderRefHash: "ord-hash-abc", customerRefHash: "cust-hash-xyz" });
    expect(view.signal.shareable.topicCategory).toBe("sizing");
  });

  it("denies a different seller (not the owner), even with a grant present", () => {
    const view = projectSignalForViewer(signal(), seller("seller-2"), grant(), 1_000);
    expect(view).toEqual({ visible: false, reason: "NOT_OWNER" });
  });

  it("a granted manufacturer sees shareable content but NOT seller-private references by default", () => {
    const view = projectSignalForViewer(signal(), manufacturer("maker-1"), grant(), 1_000);
    expect(view.visible).toBe(true);
    if (!view.visible) return;
    expect(view.signal.shareable.severityBucket).toBe("mid");
    expect(view.signal.sellerPrivate).toBeNull(); // withheld — grant does not include seller-private fields
  });

  it("a manufacturer granted seller-private fields sees the order/customer references", () => {
    const g = grant({}, { includeSellerPrivateFields: true });
    const view = projectSignalForViewer(signal(), manufacturer("maker-1"), g, 1_000);
    expect(view.visible).toBe(true);
    if (!view.visible) return;
    expect(view.signal.sellerPrivate).toEqual({ orderRefHash: "ord-hash-abc", customerRefHash: "cust-hash-xyz" });
  });

  it("a manufacturer with no grant sees nothing", () => {
    expect(projectSignalForViewer(signal(), manufacturer("maker-1"), null, 1_000)).toEqual({ visible: false, reason: "NO_GRANT" });
  });

  it("a revoked grant denies the manufacturer read", () => {
    expect(projectSignalForViewer(signal(), manufacturer("maker-1"), grant({ revoked: true }), 1_000)).toEqual({ visible: false, reason: "REVOKED" });
  });

  it("an expired grant denies the manufacturer read (evaluated against the reference time)", () => {
    const g = grant({ notAfterMs: 500 });
    expect(projectSignalForViewer(signal(), manufacturer("maker-1"), g, 400).visible).toBe(true); // before expiry
    expect(projectSignalForViewer(signal(), manufacturer("maker-1"), g, 600)).toEqual({ visible: false, reason: "EXPIRED" });
  });

  it("an out-of-scope signal kind denies the manufacturer read", () => {
    const view = projectSignalForViewer(signal({ kind: "claim" }), manufacturer("maker-1"), grant(), 1_000);
    expect(view).toEqual({ visible: false, reason: "SIGNAL_KIND_OUT_OF_SCOPE" });
  });
});
