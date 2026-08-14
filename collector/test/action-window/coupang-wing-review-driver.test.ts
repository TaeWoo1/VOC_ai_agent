/**
 * **The frame sweep, and the label sets.** The in-page tests prove what one document yields; only this level
 * can prove the probe looks at every document, and that the words it hands the page are ours.
 *
 * A seller centre embeds sub-applications, so a document-wide scan of the TOP document is still a scan of the
 * wrong document when the list lives in a child frame. That is the same class of mistake as assuming the row
 * tag, one level up, and it produces the same shape of confident zero.
 */
import { describe, expect, it } from "vitest";
import {
  CoupangWingReviewDriver,
  WING_REVIEW_CONTROL_LABELS,
  WING_REVIEW_FIELD_LABELS,
  WING_REVIEW_TEXT_SHAPES,
} from "../../src/action-window/coupang-wing-review-driver";
import { clearLogSink, getLogSink } from "../../src/log";

/** A census as the page would return it, with the identifier reading under our control. */
function pageResult(distinctIds: number, labelsAgreeing = 3): unknown {
  return {
    reason: "OK",
    elementsScanned: 400,
    shadowRootsFound: 0,
    elementsWithAnchorAttributes: 20,
    anchorDigitRunLengths: [11],
    controlAffordances: WING_REVIEW_CONTROL_LABELS.map((r, i) => ({
      id: r.id,
      interactiveCount: i === 0 ? 1 : 0,
      staticCount: 0,
      insideUnitCount: 0,
    })),
    labelCounts: WING_REVIEW_FIELD_LABELS.map((l) => ({ id: l.id, elementCount: 1 })),
    textShapes: WING_REVIEW_TEXT_SHAPES.map((s) => ({ id: s.id, leafCount: 0, unitCount: 0 })),
    unit: {
      level: {
        depth: 1,
        tagName: "TR",
        siblingCount: 4,
        siblingsSharingClassShape: 3,
        classTokenCount: 1,
        attributeKinds: ["ID"],
        hasDetailAffordance: true,
        digitRunLengths: [11],
      },
      labelsAgreeing,
      unitCount: 4,
      unitsWithImage: 3,
      unitsWithDetailLink: 3,
      idCandidates: [{ source: "ATTRIBUTE", digitLength: 9, unitsCarrying: 3, distinctValues: distinctIds }],
    },
    pagination: { dateInputCount: 2, selectCount: 1, numericPagerCount: 5, highestPagerNumber: 12 },
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

function driverFor(frames: FrameScript[]): CoupangWingReviewDriver {
  const page = pageWithFrames(frames);
  return new CoupangWingReviewDriver(page as never, { context: { pages: () => [page] } as never });
}

describe("the probe scans every frame, not just the top document", () => {
  it("**finds the reviews in a child frame** that the top document does not contain", async () => {
    const driver = driverFor([() => Promise.resolve(pageResult(1)), () => Promise.resolve(pageResult(3))]);

    const frames = await driver.censusAllFrames();

    expect(frames.map((f) => f.frameIndex)).toEqual([0, 1]);
    // The child frame's ids are unique per unit; the top document's are not.
    expect(frames[0]!.census.unit.idCandidates[0]!.uniquePerUnit).toBe(false);
    expect(frames[1]!.census.unit.idCandidates[0]!.uniquePerUnit).toBe(true);
  });

  it("a frame it cannot evaluate is SKIPPED, not reported as an empty reading", async () => {
    // Cross-origin, or detached mid-scan. Reporting it as a census of zero would read as "the reviews carry no
    // identifier", which is a claim this probe did not earn.
    const driver = driverFor([() => Promise.reject(new Error("cross-origin")), () => Promise.resolve(pageResult(3))]);

    const frames = await driver.censusAllFrames();

    expect(frames.map((f) => f.frameIndex)).toEqual([1]);
  });

  it("the frame is identified by INDEX — a frame URL would carry the seller's own account path", async () => {
    clearLogSink();
    const driver = driverFor([() => Promise.resolve(pageResult(1))]);

    const frames = await driver.censusAllFrames();

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

    await driver.censusAllFrames();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("a page that exposes no frames yields nothing rather than throwing", async () => {
    const page = { evaluate: () => Promise.resolve(null), waitForLoadState: () => Promise.resolve() };
    const driver = new CoupangWingReviewDriver(page as never, { context: { pages: () => [page] } as never });

    expect(await driver.censusAllFrames()).toEqual([]);
  });

  it("**the log line's alphabet is the census's own** — no review, name, or date can reach it", async () => {
    clearLogSink();
    const driver = driverFor([() => Promise.resolve(pageResult(2))]);

    await driver.censusAllFrames();

    const wire = JSON.stringify(getLogSink());
    // Only ids we supplied, counts, and tag names. Nothing that could carry page content.
    expect(wire).toContain("aw_coupang_review_census");
    expect(wire).toContain("TR/4/3");
    // And nothing about a reply — the probe does not ask, so the log cannot answer.
    expect(wire).not.toContain("reply");
  });
});

describe("the words handed to the page are ours", () => {
  it("**asks about ranges and sorting, and not about replies**", () => {
    // The operator established WING has no seller reply feature. The reply words are gone rather than gathered
    // and ignored — a measurement kept "for later" after being told not to use it is one that gets used.
    const texts = WING_REVIEW_CONTROL_LABELS.map((l) => l.exactText);
    expect(texts).toContain("최신순");
    expect(texts).toContain("3개월");
    expect(texts).toContain("조회기간");
    for (const replyWord of ["답글", "댓글", "답변", "답변하기"]) {
      expect(texts, `must not ask about ${replyWord}`).not.toContain(replyWord);
    }
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("the shape patterns describe formats, and none of them can match a review body", () => {
    for (const shape of WING_REVIEW_TEXT_SHAPES) {
      const re = new RegExp(shape.pattern);
      expect(re.test("배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다"), shape.id).toBe(false);
      expect(re.test("김서연"), shape.id).toBe(false);
      // Anchored at the start, so a shape can never match a fragment of something longer.
      expect(shape.pattern.startsWith("^"), shape.id).toBe(true);
    }
  });

  it("the field labels are Coupang's words, and no buyer NAME is among them", () => {
    const texts = WING_REVIEW_FIELD_LABELS.map((l) => l.exactText);
    expect(texts).toContain("평점");
    expect(texts).toContain("작성일");
    // The 구매자 COLUMN HEADER is counted; a buyer's name is never compared against anything.
    expect(texts).toContain("구매자");
    // No reply-state column either — that question is closed.
    expect(texts).not.toContain("답글여부");
    expect(new Set(texts).size).toBe(texts.length);
  });
});
