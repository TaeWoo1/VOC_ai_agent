import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "instruments", "calibration", "capture-esm-review.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("capture-esm-review — exactly-one-click / observe-and-discard boundary", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("requires the ESM live-approval flag", () => {
    expect(/hasEsmLiveApproval\s*\(/.test(code)).toBe(true);
    expect(/esmApprovalRequiredMessage\s*\(/.test(code)).toBe(true);
  });

  it("REQUIRES an explicit approved index (refuses when absent)", () => {
    expect(/parseApprovedIndexArg\s*\(/.test(code)).toBe(true);
    expect(/approvedIndex\s*===\s*null/.test(code)).toBe(true);
    expect(/--approved-index/.test(code)).toBe(true);
  });

  it("clicks EXACTLY once (no auto-repeat, no fallback, no loop click)", () => {
    const clicks = code.match(/\.click\s*\(/g) ?? [];
    expect(clicks.length).toBe(1);
    // The one click is bound to the single stamped approved-index locator.
    expect(/\[data-sellerops-esm-cap-index="\$\{approvedIndex\}"\]/.test(code)).toBe(true);
  });

  it("waits for EXACTLY one download event", () => {
    const waits = code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? [];
    expect(waits.length).toBe(1);
  });

  it("binds the approved index with a count() === 1 guard before clicking", () => {
    expect(/\.count\s*\(\s*\)/.test(code)).toBe(true);
    expect(/bound\s*!==\s*1/.test(code)).toBe(true);
  });

  it("delegates save+validate+DELETE to review-download-save (never names saveAs itself)", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/naver\/review-download-save["']/.test(code)).toBe(true);
    expect(/saveAndInspectDownload(?:<[^>]*>)?\s*\(/.test(code)).toBe(true);
    expect(code.includes("saveAs")).toBe(false);
  });

  it("uses the pure capture-gate decisions + structural validation", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-capture-gate["']/.test(code)).toBe(true);
    expect(/capturePreconditionMet\s*\(/.test(code)).toBe(true);
    expect(/decideApprovedCapture\s*\(/.test(code)).toBe(true);
    expect(/classifyPostClickOutcome\s*\(/.test(code)).toBe(true);
    expect(/classifyFileStructure\s*\(/.test(code)).toBe(true);
  });

  it("enters cross-origin frames ONLY via the allowlist, re-confirmed before acting", () => {
    expect(/frameHostAllowed\s*\(/.test(code)).toBe(true);
    expect(/findAllowlistedFrame\s*\(/.test(code)).toBe(true);
    expect(/cfg\.esmFrameOriginAllowlist/.test(code)).toBe(true);
  });

  it("NO upload / NO DB / NO status write / NO scheduler", () => {
    for (const token of [
      "uploadReviewFile",
      "uploadSavedReviewDownload",
      "writeStatus",
      "runExport",
      "manualSync",
      "scheduler",
      "setInterval",
      "cron",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
    // No import of the backend-upload or run-status modules.
    expect(/from\s+["']\.\.\/\.\.\/src\/upload["']/.test(code)).toBe(false);
    expect(/from\s+["']\.\.\/\.\.\/src\/status["']/.test(code)).toBe(false);
    expect(/from\s+["'][^"']*review-upload[^"']*["']/.test(code)).toBe(false);
  });

  it("is connection-explicit: resolves the ESM profile from a validated --connection-id, no implicit fallback", () => {
    // Live capture must name an ESM connection and resolve its dedicated profile via the SHARED resolver —
    // never the unattributed default `.profile/esm`, and never NAVER's profile.
    expect(/--connection-id/.test(code)).toBe(true);
    expect(/--connections/.test(code)).toBe(true);
    expect(/resolveCaptureConnectionProfile\s*\(/.test(code)).toBe(true);
    expect(/from\s+["']\.\.\/\.\.\/src\/cli\/esm-capture-connection["']/.test(code)).toBe(true);
    expect(/cfg\.profileBaseDir/.test(code)).toBe(true);
    // No implicit `.profile/esm` fallback for a live capture, and never NAVER's profile.
    expect(/cfg\.esmProfileDir/.test(code)).toBe(false);
    expect(/cfg\.profileDir\b/.test(code)).toBe(false);
    // Fails closed (non-zero exit) when the connection does not resolve.
    expect(/!resolution\.ok/.test(code)).toBe(true);
    expect(/esmSentinelPathFor\s*\(/.test(code)).toBe(true);
    expect(/probe-sentinel/.test(code)).toBe(false);
  });

  it("does not depend on terminal stdin / an Enter keypress", () => {
    expect(code.includes("process.stdin")).toBe(false);
    expect(/waitForEnter/.test(code)).toBe(false);
  });

  it("emits a sanitized capture summary and honest non-goal markers", () => {
    expect(/console\.log\(JSON\.stringify\(/.test(code)).toBe(true);
    expect(/uploaded:\s*false/.test(code)).toBe(true);
    expect(/rowsParsed:\s*false/.test(code)).toBe(true);
    expect(/schemaInferred:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
    // Never prints raw page/frame url or html.
    expect(/console\.log\([^)]*\.(url|content)\s*\(/.test(code)).toBe(false);
  });
});

describe("capture-esm-review — Gate 4 opt-in schema-shape inspection (--inspect-schema-shape)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("is opt-in: gated on the --inspect-schema-shape flag", () => {
    expect(/--inspect-schema-shape/.test(code)).toBe(true);
    expect(/inspectSchemaShape\s*=\s*args\.includes\(/.test(code)).toBe(true);
  });

  it("wires the opt-in inspectors via the esm-capture-inspect helper as the pre-delete hook", () => {
    // The schema-shape composition (readWorkbookShape → summarizeSchemaShape) now lives in the
    // helper; the CLI delegates to it and passes the combined hook to the SAME save module.
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-capture-inspect["']/.test(code)).toBe(true);
    expect(/buildCaptureInspectFn\s*\(/.test(code)).toBe(true);
    expect(/saveAndInspectDownload<CaptureInspection>\s*\(/.test(code)).toBe(true);
    expect(/inspectFn/.test(code)).toBe(true);
  });

  it("inspection runs ONLY after structural xlsx validation, and the stop precedence fails closed", () => {
    // Structural sniff still gates the result; the fail-closed precedence is encoded in the helper.
    expect(/classifyFileStructure\s*\(/.test(code)).toBe(true);
    expect(/deriveCaptureStop\s*\(/.test(code)).toBe(true);
    // A failed cleanup is still surfaced (observable, not silent).
    expect(/inspection\.deleteFailed/.test(code)).toBe(true);
  });

  it("surfaces the sanitized schema-shape and keeps confirmation markers false", () => {
    expect(/schemaShapeInspected/.test(code)).toBe(true);
    expect(/schemaShape\b/.test(code)).toBe(true);
    // The schema-shape object is the summariser's output, which hard-codes
    // schemaMappingConfirmed:false / dedupKeyConfirmed:false — and the CLI keeps its own honest markers.
    expect(/schemaInferred:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
  });

  it("still has EXACTLY one click + one download wait (Gate 3 invariants preserved)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    expect((code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? []).length).toBe(1);
  });

  it("adds NO upload / DB / status / scheduler with the new path", () => {
    for (const token of ["uploadReviewFile", "writeStatus", "runExport", "manualSync", "scheduler", "setInterval", "cron"]) {
      expect(code.includes(token)).toBe(false);
    }
    expect(/from\s+["']\.\.\/\.\.\/src\/upload["']/.test(code)).toBe(false);
    expect(/from\s+["']\.\.\/\.\.\/src\/status["']/.test(code)).toBe(false);
  });
});

describe("capture-esm-review — Gate 5 opt-in row-shape probe (--probe-row-shape)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("is opt-in and dormant by default: gated on the --probe-row-shape flag", () => {
    expect(/--probe-row-shape/.test(code)).toBe(true);
    expect(/probeRowShape\s*=\s*args\.includes\(/.test(code)).toBe(true);
  });

  it("parses an optional --row-sample-rows cap", () => {
    expect(/parseRowSampleRowsArg\s*\(/.test(code)).toBe(true);
    expect(/rowSampleRows/.test(code)).toBe(true);
  });

  it("composes schema-shape + row-shape through the one inspect hook", () => {
    expect(/buildCaptureInspectFn\s*\(/.test(code)).toBe(true);
    expect(/probeRowShape/.test(code)).toBe(true);
    expect(/inspection\.inspection\?\.rowShape/.test(code)).toBe(true);
  });

  it("surfaces the sanitized row-shape and keeps honest non-goal markers", () => {
    expect(/rowShapeProbed/.test(code)).toBe(true);
    expect(/rowShape\b/.test(code)).toBe(true);
    expect(/rowsParsed:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
  });

  it("adds NO extra click / download path (Gate 3 invariants preserved)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    expect((code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? []).length).toBe(1);
  });

  it("adds NO upload / DB / status / scheduler", () => {
    for (const token of ["uploadReviewFile", "writeStatus", "runExport", "manualSync", "scheduler", "setInterval", "cron"]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});

describe("capture-esm-review — Gate 5 / Slice 5A opt-in composite-key emit (--emit-composite-key)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("is opt-in and dormant by default: gated on the --emit-composite-key flag", () => {
    expect(/--emit-composite-key/.test(code)).toBe(true);
    expect(/emitCompositeKey\s*=\s*args\.includes\(/.test(code)).toBe(true);
  });

  it("passes the flag + channel + store fingerprint through the one inspect hook", () => {
    expect(/buildCaptureInspectFn\s*\(/.test(code)).toBe(true);
    expect(/emitCompositeKey/.test(code)).toBe(true);
    expect(/channel:\s*["']esmplus["']/.test(code)).toBe(true);
    expect(/storeFingerprint:\s*cfg\.esmStoreFingerprint/.test(code)).toBe(true);
    expect(/inspection\.inspection\?\.compositeKeys/.test(code)).toBe(true);
  });

  it("surfaces the sanitized composite keys and keeps honest non-goal markers", () => {
    expect(/compositeKeyEmitted/.test(code)).toBe(true);
    expect(/compositeKeys\b/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
  });

  it("adds NO extra click / download path (Gate 3 invariants preserved)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    expect((code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? []).length).toBe(1);
  });

  it("adds NO upload / DB / status / scheduler (composite-key path)", () => {
    for (const token of ["uploadReviewFile", "writeStatus", "runExport", "manualSync", "scheduler", "setInterval", "cron"]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});

describe("capture-esm-review — Slice 2b opt-in header-label capture (--capture-review-headers)", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("is opt-in and dormant by default: gated on the --capture-review-headers flag", () => {
    expect(/--capture-review-headers/.test(code)).toBe(true);
    expect(/captureReviewHeaders\s*=\s*args\.includes\(/.test(code)).toBe(true);
  });

  it("wires the header-label capture through the one inspect hook + local artifact path", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-review-header-quarantine["']/.test(code)).toBe(true);
    expect(/headerLabelArtifactPath\s*\(/.test(code)).toBe(true);
    expect(/captureHeaderLabels:\s*captureReviewHeaders/.test(code)).toBe(true);
    expect(/inspection\.inspection\?\.headerLabels/.test(code)).toBe(true);
  });

  it("surfaces the sanitized header-label capture and keeps honest non-goal markers", () => {
    expect(/headerLabelsCaptureRequested/.test(code)).toBe(true);
    expect(/headerLabels\b/.test(code)).toBe(true);
    expect(/schemaInferred:\s*false/.test(code)).toBe(true);
    expect(/dedupKeyClaimed:\s*false/.test(code)).toBe(true);
  });

  it("delegates the literal-label write to the quarantine module (CLI never names saveAs/writeFile)", () => {
    expect(code.includes("saveAs")).toBe(false);
    expect(code.includes("writeFileSync")).toBe(false);
  });

  it("adds NO extra click / download path (Gate 3 invariants preserved)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    expect((code.match(/waitForEvent\s*\(\s*["']download["']/g) ?? []).length).toBe(1);
  });

  it("adds NO upload / DB / status / scheduler (header-label path)", () => {
    for (const token of ["uploadReviewFile", "writeStatus", "runExport", "manualSync", "scheduler", "setInterval", "cron"]) {
      expect(code.includes(token)).toBe(false);
    }
  });
});

describe("capture-esm-review — required marketplace attribution", () => {
  const code = stripComments(readFileSync(CLI_PATH, "utf8"));

  it("REQUIRES an explicit --marketplace and fails closed when missing/invalid", () => {
    expect(/--marketplace GMARKET\|AUCTION/.test(code)).toBe(true);
    expect(/parseMarketplaceArg\s*\(/.test(code)).toBe(true);
    expect(/marketplace === null/.test(code)).toBe(true);
  });

  it("verifies the marketplace BEFORE any export scan/click (no export before verification)", () => {
    // Call sites (with "(") — not the comma-terminated import list.
    const gateAt = code.indexOf("marketplaceGateOutcome(");
    const decideAt = code.indexOf("decideApprovedCapture(");
    const clickAt = code.search(/\.click\s*\(/);
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(decideAt); // verified before the approved-index decision
    expect(gateAt).toBeLessThan(clickAt); // and before the click
  });

  it("re-checks the marketplace IMMEDIATELY before the export click (fails closed on reset)", () => {
    expect(/preClickMarketplace/.test(code)).toBe(true);
    expect(/marketplace-reset/.test(code)).toBe(true);
    const preClickAt = code.indexOf("preClickMarketplace !== marketplace");
    const clickAt = code.search(/\.click\s*\(/);
    expect(preClickAt).toBeGreaterThan(-1);
    expect(preClickAt).toBeLessThan(clickAt);
  });

  it("never auto-clicks a marketplace tab — the single click is still the approved-index locator", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    expect(/\[data-sellerops-esm-cap-index="\$\{approvedIndex\}"\]/.test(code)).toBe(true);
  });

  it("both-tabs-selected (AMBIGUOUS) fails closed; UNKNOWN/mismatch prompts the ready signal once", () => {
    expect(/AMBIGUOUS_FAIL/.test(code)).toBe(true);
    expect(/marketplace-ambiguous/.test(code)).toBe(true);
    expect(/MARKETPLACE_SELECTION_REQUIRED/.test(code)).toBe(true);
    expect(/esmMarketplaceReadyPathFor\s*\(/.test(code)).toBe(true);
    // The marketplace-ready signal is waited on and consumed (removed) after each use. (The read-only
    // --observe-marketplace A/B branch reuses the same signal for snapshot B, so ≥1 wait sites exist.)
    expect((code.match(/waitForSentinel\s*\(\s*marketplaceReadyPath/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(/removeSentinel\(marketplaceReadyPath\)/.test(code)).toBe(true);
  });

  it("carries the VERIFIED sourceMarketplace into the capture result (never inferred, only on success)", () => {
    expect(/sourceMarketplace:\s*marketplace/.test(code)).toBe(true);
    expect(/marketplaceVerified:\s*true/.test(code)).toBe(true);
    expect(/marketplaceVerificationMethod/.test(code)).toBe(true);
    // Stops carry the REQUESTED marketplace, never a claimed sourceMarketplace.
    expect(/requestedMarketplace:\s*marketplace/.test(code)).toBe(true);
  });

  it("does not infer marketplace from loginMode / channel code / connection id", () => {
    expect(/marketplace\s*[:=]\s*loginMode/.test(code)).toBe(false);
    expect(/marketplace\s*[:=]\s*connectionId/.test(code)).toBe(false);
  });
});
