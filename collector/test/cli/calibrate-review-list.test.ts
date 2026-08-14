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
} from "../../src/cli/calibrate-review-list";
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
    const source = readFileSync(resolve(HERE, "../../src/cli/calibrate-review-list.ts"), "utf8");
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
      "CLASSIFY_REVIEW_REPLY_AFFORDANCE",
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

  it("the scope sentence names the SECOND attribute allowlist rather than leaving it implicit", () => {
    // role / type / aria-valuenow / contenteditable are what let the probe tell a 답글 button from a 답글여부
    // header. An operator approving the run is owed the actual list of what it looks at.
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
    expect(lines).toContain("답글은 등록되지 않습니다");
  });

  it("**an undetermined reply answer is its own exit code**, never rounded up to success", () => {
    // 5 is "we could not decide whether a reply control exists" — the reading that must not be recorded as
    // "Coupang has no seller reply", because a screen whose rows were never found produces it either way.
    expect(discoveryExitCode("MEASURED", true)).toBe(0);
    expect(discoveryExitCode("MEASURED", false)).toBe(5);
    expect(discoveryExitCode("ABORTED_BEFORE_CHECKPOINT", true)).toBe(7);
    expect(discoveryExitCode("ABORTED_BEFORE_CHECKPOINT", false)).toBe(7);
  });

  it("has no click, type, navigation, or network path in its source", () => {
    const source = readFileSync(resolve(HERE, "../../src/cli/calibrate-review-list.ts"), "utf8");
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
        replyAffordances: [],
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
          unitsWithReplyControl: 0,
          unitsWithReplyInput: 0,
        },
        pagination: { dateInputCount: 0, selectCount: 0, numericPagerCount: 0 },
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
