/**
 * **The 상품평 discovery CLI's gate, its disclosure, and the one input that reaches into the page.**
 *
 * The disclosure carries more weight here than on any earlier calibration, because more of this screen is
 * content: review bodies, buyer names, product names, photos and videos are all on it. A sentence that
 * overstates the boundary is the kind that quietly stops being true.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCOVERY_BANNER_LINES,
  REVIEW_DISCOVERY_OPERATION,
  discoveryAsk,
  discoveryExitCode,
  parseProductIds,
  reportableFrame,
} from "../../instruments/calibration/calibrate-review-list";
import { COUPANG_WING_REVIEW_DISCOVERY_SCOPE, PHASE_SPECS, WING_PHASES } from "../../src/cli/approval-manifest";
import type { ReviewFrameCensus } from "../../src/action-window/coupang-wing-review-list";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("the identifiers that reach into the page", () => {
  it("accepts well-formed id:digits pairs and preserves the operator's order", () => {
    expect(parseProductIds("productId:15411270785,sellerProductId:1234567")).toEqual([
      { id: "productId", digits: "15411270785" },
      { id: "sellerProductId", digits: "1234567" },
    ]);
  });

  it("**drops anything that is not digits** rather than repairing it", () => {
    for (const bad of [
      "productId:1541 1270785",
      "productId:15411270785'",
      "productId:</script>",
      "productId:0x1541",
      "productId:",
      ":15411270785",
      "productId",
      "",
    ]) {
      expect(parseProductIds(bad), `accepted ${bad}`).toEqual([]);
    }
    expect(parseProductIds(undefined)).toEqual([]);
  });

  it("**is optional, unlike the 고객문의 calibration's** — there is no review id to supply", () => {
    // Coupang publishes no review API, so SellerOps holds no review identifier. A run that refused to start
    // without one could never measure the screen it exists to measure.
    expect(parseProductIds(undefined)).toEqual([]);
    const source = readFileSync(resolve(HERE, "../../instruments/calibration/calibrate-review-list.ts"), "utf8");
    expect(source).not.toContain("Refusing to start: SELLEROPS_REVIEW_PRODUCT_IDS");
  });
});

describe("the run declares what it is", () => {
  it("is a READ_ONLY phase whose declared actions include no read, click, or highlight", () => {
    const spec = PHASE_SPECS.COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY;
    expect(spec.mode).toBe("READ_ONLY");
    expect(spec.allowsHighlight).toBe(false);
    expect(spec.capableActions).toEqual([
      "OPEN_DEDICATED_WINDOW",
      "WAIT_OPERATOR_LOGIN_NAV",
      "CLASSIFY_SANITIZED_PAGE_CATEGORY",
      "MEASURE_REVIEW_LIST_STRUCTURE",
      "MEASURE_REVIEW_IDENTIFIER_CANDIDATES",
    ]);
    for (const forbidden of [
      "READ_CREDENTIAL_VALUES_ONCE",
      "HIGHLIGHT_REAL_CONTROL",
      "OBSERVE_USER_CLICK_TRANSITION",
      "HAND_CREDENTIAL_TO_SELLEROPS_BACKEND",
    ]) {
      expect(spec.capableActions).not.toContain(forbidden);
    }
  });

  it("is registered as a WING phase, so its entry URL is screened against WING and not the NAVER host", () => {
    expect(WING_PHASES).toContain("COUPANG_WING_REVIEW_STRUCTURE_DISCOVERY");
  });

  it("**the disclosure names what is NOT read, item by item**", () => {
    const surfaces = [
      REVIEW_DISCOVERY_OPERATION,
      COUPANG_WING_REVIEW_DISCOVERY_SCOPE.maxActions,
      DISCOVERY_BANNER_LINES.join(" "),
    ];
    for (const disclosure of surfaces) {
      const text = disclosure.toLowerCase();
      // The three kinds of content on this screen that a seller would care most about.
      expect(text).toContain("review body");
      expect(text).toContain("buyer name");
      expect(text).toContain("product name");
      // And the flattering claim that must never appear: text IS read, in one place, against our own literals.
      expect(text).not.toContain("no text is read");
      expect(text).not.toContain("0 text reads");
    }
  });

  it("**the scope names the measurements that were ADDED**, not only the ones it started with", () => {
    // An approval that describes less than the run does is the same defect as one that describes more. The
    // per-position reading, the row-width counts, and the dropdown option counting are all new work in the
    // page, and the operator is approving those too.
    const operation = REVIEW_DISCOVERY_OPERATION;
    expect(operation).toContain("PER CELL POSITION");
    expect(operation).toContain("how many cells each row holds");
    expect(operation).toContain("options");

    // And the budget states what those readings do NOT return, positively, so it is checkable.
    const budget = COUPANG_WING_REVIEW_DISCOVERY_SCOPE.maxActions;
    expect(budget).toContain("0 review identifier values");
    expect(budget).toContain("0 dropdown option texts returned");
  });

  it("the scope names the identifier reading, which is what the run is FOR", () => {
    for (const text of [REVIEW_DISCOVERY_OPERATION.toLowerCase(), DISCOVERY_BANNER_LINES.join(" ").toLowerCase()]) {
      expect(text).toContain("de-duplicat");
    }
  });

  it("the scope sentence names the SECOND attribute allowlist rather than leaving it implicit", () => {
    // role / type / aria-valuenow / contenteditable are what let the probe tell a pressable range control from
    // a printed caption. An operator approving the run is owed the actual list of what it looks at.
    const text = COUPANG_WING_REVIEW_DISCOVERY_SCOPE.maxActions;
    for (const attr of ["role", "type", "aria-valuenow", "contenteditable"]) {
      expect(text).toContain(attr);
    }
  });

  it("the Korean checkpoint says what does not leave the window", () => {
    const lines = discoveryAsk().lines.join(" ");
    expect(lines).toContain("리뷰 본문");
    expect(lines).toContain("구매자 이름");
    expect(lines).toContain("이 창 밖으로 나가지 않습니다");
    expect(lines).toContain("아무것도 전송되지 않습니다");
  });

  it("**the run does not ask about replies, on any surface it shows the operator**", () => {
    // The operator established WING has no seller reply feature, so the scope must not claim to look for one —
    // an approval that describes a measurement the run does not take is as wrong as one that omits a measurement
    // it does take.
    const surfaces = [
      REVIEW_DISCOVERY_OPERATION,
      COUPANG_WING_REVIEW_DISCOVERY_SCOPE.maxActions,
      DISCOVERY_BANNER_LINES.join(" "),
      discoveryAsk().lines.join(" "),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain("답글");
      expect(surface.toLowerCase()).not.toContain("reply control exists");
    }
    // And the budget states the absence positively, so it is checkable rather than merely true.
    expect(COUPANG_WING_REVIEW_DISCOVERY_SCOPE.maxActions).toContain("0 reply-control lookups");
  });

  it("**the harness banner does not claim a measurement the run removed** — it did, and this pins it", () => {
    // The bootstrap banner outlived the measurement it described: it told the operator the run establishes
    // "whether a seller REPLY CONTROL exists" for two units after that measurement was deleted. The TypeScript
    // surfaces were covered by the test above; the shell the operator actually reads was not.
    const banner = readFileSync(resolve(HERE, "../../../tools/coupang-local/wing-review-bootstrap.sh"), "utf8");
    expect(banner).not.toContain("REPLY CONTROL exists");
    expect(banner).not.toContain("counts whether such a control exists");
    // The run's actual product, named where the operator will read it.
    expect(banner).toContain("PER CELL POSITION");

    // The manifest the operator approves from must name the same additions. Under-describing a run is the
    // same defect as over-describing it, and this file is what they read at the moment of granting.
    const manifest = readFileSync(resolve(HERE, "../../../tools/coupang-local/wing-review-preflight.sh"), "utf8");
    expect(manifest).toContain("CELL POSITION");
    expect(manifest).toContain("how many cells each row");
    expect(manifest).toContain("쿠팡에서 보기");
    expect(manifest).toContain("period dropdown is counted");
    // The word survived in a PASS line too. Every operator-visible mention had to go, not the prose ones only.
    expect(manifest).not.toContain("reply readings");
  });

  it("**an undetermined acquisition answer is its own exit code**, never rounded up to success", () => {
    // 5 is "we could not decide whether the reviews carry an identifier" — the reading that must not be
    // recorded as "there is none", because a screen whose rows were never found produces it either way.
    expect(discoveryExitCode("MEASURED", true)).toBe(0);
    expect(discoveryExitCode("MEASURED", false)).toBe(5);
    expect(discoveryExitCode("ABORTED_BEFORE_CHECKPOINT", true)).toBe(7);
    expect(discoveryExitCode("ABORTED_BEFORE_CHECKPOINT", false)).toBe(7);
  });

  it("has no click, type, navigation, or network path in its source", () => {
    const source = readFileSync(resolve(HERE, "../../instruments/calibration/calibrate-review-list.ts"), "utf8");
    const code = source
      .split("\n")
      .filter(
        (l) =>
          !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"),
      )
      .join("\n");
    for (const forbidden of [".click(", ".fill(", ".type(", ".press(", ".goto(", "waitForEvent", "fetch("]) {
      expect(code, `discovery CLI must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("which frame gets reported", () => {
  function frame(index: number, resolved: boolean, labelsAgreeing: number): ReviewFrameCensus {
    return {
      frameIndex: index,
      census: {
        reason: "OK",
        elementsScanned: 10,
        shadowRootsFound: 0,
        elementsWithAnchorAttributes: 0,
        anchorDigitRunLengths: [],
        controlAffordances: [],
        unitSource: "COLUMN" as const,
        columnProbe: {
          reason: "OK" as const,
          headerId: "exposedWithOption",
          cellsInColumn: 3,
          cellsWithDigits: 3,
          cellsWithTwoRuns: 3,
          distinctFirstRunValues: 1,
          distinctSecondRunValues: 3,
          cellsMatchingOurDigits: 0,
        },
        labelCounts: [],
        textShapes: [],
        unit: {
          resolved,
          level: null,
          labelsAgreeing,
          unitCount: 0,
          unitsWithDetailAffordance: 0,
          unitsWithImage: 0,
          unitsWithVideo: 0,
          unitsWithRatingAria: 0,
          unitsWithStarLikeClass: 0,
          unitsMatchingOurDigits: 0,
          unitAttributeDigitLengths: [],
          unitPrintedDigitLengths: [],
          unitsWithDetailLink: 0,
          idCandidates: [],
          leafCounts: [],
        },
        pagination: { dateInputCount: 0, selectCount: 0, numericPagerCount: 0, highestPagerNumber: 0 },
        cells: [],
        selects: [],
        distinctRowSignatures: 0,
      },
    };
  }

  it("prefers the frame whose review unit actually RESOLVED", () => {
    const frames = [frame(0, false, 9), frame(1, true, 2)];
    expect(reportableFrame(frames)?.frameIndex).toBe(1);
  });

  it("with none resolved, reports the frame whose field words agreed the most", () => {
    // Reporting an arbitrary frame would describe the navigation and call it a refusal.
    const frames = [frame(0, false, 1), frame(1, false, 4), frame(2, false, 0)];
    expect(reportableFrame(frames)?.frameIndex).toBe(1);
  });

  it("no frames at all yields nothing rather than throwing", () => {
    expect(reportableFrame([])).toBeUndefined();
  });
});
