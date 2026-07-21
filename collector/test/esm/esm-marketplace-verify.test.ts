import { describe, expect, it } from "vitest";
import {
  classifySelectedMarketplace,
  isMarketplace,
  marketplaceGateOutcome,
  parseMarketplaceArg,
  type MarketplaceTabSignal,
} from "../../src/esm/esm-marketplace-verify";

const tab = (labelToken: "GMARKET" | "AUCTION" | null, selected: boolean, visible = true): MarketplaceTabSignal => ({
  labelToken,
  selected,
  visible,
});

describe("parseMarketplaceArg — explicit intent, never inferred", () => {
  it("missing --marketplace fails closed (null)", () => {
    expect(parseMarketplaceArg([])).toBeNull();
    expect(parseMarketplaceArg(["--connection-id", "esm-live-g0", "--approved-index", "0"])).toBeNull();
  });

  it("invalid value fails closed (null) — no normalization", () => {
    expect(parseMarketplaceArg(["--marketplace", "gmarket"])).toBeNull(); // lowercase not accepted
    expect(parseMarketplaceArg(["--marketplace", "BOTH"])).toBeNull();
    expect(parseMarketplaceArg(["--marketplace"])).toBeNull(); // no value
  });

  it("accepts exactly GMARKET / AUCTION", () => {
    expect(parseMarketplaceArg(["--marketplace", "GMARKET"])).toBe("GMARKET");
    expect(parseMarketplaceArg(["--marketplace", "AUCTION"])).toBe("AUCTION");
  });

  it("reads ONLY --marketplace — loginMode / channel code / connection id never influence it", () => {
    const args = ["--connection-id", "esm-live-g0", "--login-mode", "AUCTION", "--channel", "GMARKET", "--marketplace", "GMARKET"];
    expect(parseMarketplaceArg(args)).toBe("GMARKET"); // not the loginMode/channel value
  });
});

describe("classifySelectedMarketplace — sanitized enum from tab signals only", () => {
  it("selected GMARKET (with unselected AUCTION present) → GMARKET", () => {
    expect(classifySelectedMarketplace([tab("GMARKET", true), tab("AUCTION", false)])).toBe("GMARKET");
  });

  it("selected AUCTION → AUCTION", () => {
    expect(classifySelectedMarketplace([tab("GMARKET", false), tab("AUCTION", true)])).toBe("AUCTION");
  });

  it("both tabs selected → AMBIGUOUS (fail-closed signal)", () => {
    expect(classifySelectedMarketplace([tab("GMARKET", true), tab("AUCTION", true)])).toBe("AMBIGUOUS");
  });

  it("no tab selected → UNKNOWN", () => {
    expect(classifySelectedMarketplace([tab("GMARKET", false), tab("AUCTION", false)])).toBe("UNKNOWN");
  });

  it("a selected tab that is not visible is ignored → UNKNOWN", () => {
    expect(classifySelectedMarketplace([tab("GMARKET", true, false)])).toBe("UNKNOWN");
  });

  it("is order-independent — no reliance on a badge index / position", () => {
    const a = [tab("GMARKET", true), tab("AUCTION", false)];
    const reversed = [...a].reverse();
    expect(classifySelectedMarketplace(reversed)).toBe("GMARKET");
    // Duplicated selected GMARKET entries still resolve to GMARKET (distinct-by-label).
    expect(classifySelectedMarketplace([tab("GMARKET", true), tab("GMARKET", true)])).toBe("GMARKET");
  });

  it("takes tab signals ONLY (no index/loginMode/channel/connection input in the signature)", () => {
    // Purely structural guarantee: the function accepts one array; there is no channel/loginMode/index arg.
    expect(classifySelectedMarketplace.length).toBe(1);
  });
});

describe("marketplaceGateOutcome — VERIFIED only on an exact live match", () => {
  it("selected GMARKET satisfies requested GMARKET → VERIFIED", () => {
    expect(marketplaceGateOutcome("GMARKET", "GMARKET")).toBe("VERIFIED");
  });
  it("selected AUCTION satisfies requested AUCTION → VERIFIED", () => {
    expect(marketplaceGateOutcome("AUCTION", "AUCTION")).toBe("VERIFIED");
  });
  it("GMARKET selected with AUCTION requested is NOT verified (selection required)", () => {
    expect(marketplaceGateOutcome("AUCTION", "GMARKET")).toBe("SELECTION_REQUIRED");
  });
  it("AUCTION selected with GMARKET requested is NOT verified (selection required)", () => {
    expect(marketplaceGateOutcome("GMARKET", "AUCTION")).toBe("SELECTION_REQUIRED");
  });
  it("UNKNOWN is NOT verified (selection required)", () => {
    expect(marketplaceGateOutcome("GMARKET", "UNKNOWN")).toBe("SELECTION_REQUIRED");
  });
  it("AMBIGUOUS fails closed immediately (never VERIFIED, never auto-resolved)", () => {
    expect(marketplaceGateOutcome("GMARKET", "AMBIGUOUS")).toBe("AMBIGUOUS_FAIL");
    expect(marketplaceGateOutcome("AUCTION", "AMBIGUOUS")).toBe("AMBIGUOUS_FAIL");
  });
  it("no detected value ever yields VERIFIED except an exact enum match", () => {
    for (const detected of ["UNKNOWN", "AMBIGUOUS", "AUCTION"] as const) {
      expect(marketplaceGateOutcome("GMARKET", detected)).not.toBe("VERIFIED");
    }
  });
});

describe("isMarketplace", () => {
  it("recognizes only the two concrete enums", () => {
    expect(isMarketplace("GMARKET")).toBe(true);
    expect(isMarketplace("AUCTION")).toBe(true);
    expect(isMarketplace("UNKNOWN")).toBe(false);
    expect(isMarketplace("gmarket")).toBe(false);
    expect(isMarketplace(null)).toBe(false);
  });
});
