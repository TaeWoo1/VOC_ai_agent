/**
 * **The frame sweep.** The in-page tests can prove what one document yields; only this level can prove the
 * probe looks at every document.
 *
 * The reason it exists: a seller center embeds sub-applications, so a document-wide scan of the TOP document is
 * still a scan of the wrong document when the list lives in a child frame. That is the same class of mistake as
 * assuming the row tag — one level up — and it produces the same shape of confident zero.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingInquiryDriver, WING_INQUIRY_STATUS_LABELS } from "../../src/action-window/coupang-wing-inquiry-driver";
import { clearLogSink, getLogSink } from "../../src/log";
import type { InquiryDigitExpectation } from "../../src/action-window/coupang-wing-inquiry-list";

const DIGITS: InquiryDigitExpectation[] = [{ id: "inquiryId", digits: "158421449" }];

/** A census as the page would return it, with `matchCount` under our control. */
function pageResult(matchCount: number, elementsWithAnchorAttributes = 5): unknown {
  return {
    reason: "OK",
    elementsScanned: 100,
    shadowRootsFound: 0,
    elementsWithAnchorAttributes,
    anchorDigitRunLengths: [9],
    anchors: [
      {
        id: "inquiryId",
        matchCount,
        topology:
          matchCount === 1
            ? {
                matchedTagName: "A",
                attributeKinds: ["HREF"],
                ancestorDepthScanned: 4,
                repeatLevels: [
                  {
                    depth: 1,
                    tagName: "TR",
                    siblingCount: 2,
                    siblingsSharingClassShape: 2,
                    classTokenCount: 1,
                    attributeKinds: ["ID"],
                    hasDetailAffordance: true,
                    digitRunLengths: [9],
                  },
                ],
              }
            : null,
      },
    ],
    labelCounts: WING_INQUIRY_STATUS_LABELS.map((l) => ({
      id: l.id,
      elementCount: 0,
      topology: null,
      sharedRepeatLevel: null,
      hitsSharingRepeatShape: 0,
    })),
  };
}

type FrameScript = (script: string) => Promise<unknown>;

function pageWithFrames(frames: FrameScript[]): unknown {
  return {
    frames: () => frames.map((evaluate) => ({ evaluate: (s: string) => evaluate(s) })),
    evaluate: () => Promise.resolve(null),
    waitForLoadState: () => Promise.resolve(),
  };
}

function driverFor(frames: FrameScript[]): CoupangWingInquiryDriver {
  const page = pageWithFrames(frames);
  return new CoupangWingInquiryDriver(page as never, { context: { pages: () => [page] } as never });
}

describe("the probe scans every frame, not just the top document", () => {
  it("**finds the list in a child frame** that the top document does not contain", async () => {
    const driver = driverFor([
      () => Promise.resolve(pageResult(0)),
      () => Promise.resolve(pageResult(1)),
    ]);

    const frames = await driver.censusAllFrames(DIGITS);

    expect(frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    expect(frames[0]!.census.anchors[0]!.matchCount).toBe(0);
    expect(frames[1]!.census.anchors[0]!.matchCount).toBe(1);
  });

  it("a frame it cannot evaluate is SKIPPED, not reported as an empty reading", async () => {
    // Cross-origin, or detached mid-scan. Reporting it as a census of zero would read as "the list is not
    // there", which is a claim this probe did not earn.
    const driver = driverFor([
      () => Promise.reject(new Error("cross-origin")),
      () => Promise.resolve(pageResult(1)),
    ]);

    const frames = await driver.censusAllFrames(DIGITS);

    expect(frames.map((f) => f.frameIndex)).toEqual([1]);
  });

  it("the frame is identified by INDEX — a frame URL would carry the seller's own account path", async () => {
    clearLogSink();
    const driver = driverFor([() => Promise.resolve(pageResult(1))]);

    const frames = await driver.censusAllFrames(DIGITS);

    const wire = JSON.stringify(frames) + JSON.stringify(getLogSink());
    expect(wire).not.toContain("http");
    expect(wire).toContain("frameIndex");
  });

  it("every frame gets the SAME script — a per-frame variation would be a per-frame promise", async () => {
    const seen: string[] = [];
    const driver = driverFor([
      (s) => {
        seen.push(s);
        return Promise.resolve(pageResult(0));
      },
      (s) => {
        seen.push(s);
        return Promise.resolve(pageResult(0));
      },
    ]);

    await driver.censusAllFrames(DIGITS);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("a page that exposes no frames yields nothing rather than throwing", async () => {
    const page = { evaluate: () => Promise.resolve(null), waitForLoadState: () => Promise.resolve() };
    const driver = new CoupangWingInquiryDriver(page as never, { context: { pages: () => [page] } as never });

    expect(await driver.censusAllFrames(DIGITS)).toEqual([]);
  });
});
