/**
 * **The locate's range verdict (offline, fake page).**
 *
 * The live defect this file locks (2026-09-05): a run swept the seller center review grid to the bottom of
 * its scroll pane, matched nothing, and reported `TARGET_NOT_FOUND` — while every row it had seen was
 * `TODAY`/`THIS_WEEK` and the target was eight days old. The list was showing a recent window; the review had
 * aged out of it. Scrolling cannot reach outside a filter, so more scrolling would never have found it.
 *
 * What is asserted here is the DISTINCTION and what follows from it: a bottomed-out sweep that never showed
 * the target's own recency bucket waits for the seller to widen the screen's period and then re-sweeps the new
 * list; a sweep that DID cover the target's bucket still fails closed immediately; and the wait is not offered
 * on a screen with no period control, because there would be nothing for the seller to change.
 */
import { describe, it, expect } from "vitest";
import {
  NaverLadderReplyDriver,
  type LadderReplyPage,
} from "../../../src/action-window/reply-submission/naver-ladder-reply-driver";
import { composerSigFor, type ReplyTargetHint } from "../../../src/action-window/reply-submission/reply-surface";

const FP = "c".repeat(64);
const HINT: ReplyTargetHint = { rating: 4, recencyBucket: "OLDER", bodyFingerprint: "b".repeat(64) };

/** One in-page row as the ladder returns it: an id fingerprint plus the coarse secondary facts. */
function row(index: number, opts: { hit?: boolean; bucket: string; rating?: number }) {
  return {
    rowIndex: index,
    idFingerprints: [{ source: "visible-text", fingerprint: opts.hit ? FP : "d".repeat(64) }],
    secondary: { rating: opts.rating ?? 4, recencyBucket: opts.bucket },
  };
}

function ladderResult(rows: ReturnType<typeof row>[]) {
  return { rows, pageStateFingerprints: [], rowCount: rows.length, rowsTruncated: false, tokensTruncated: false };
}

interface PageScript {
  /** Rows the ladder answers with, per call. The last entry repeats once exhausted. */
  ladder: ReturnType<typeof row>[][];
  /** Whether the scroll pane reports it is at the bottom (it always reports it moved). */
  atBottom: boolean;
  /** Date inputs the range census finds. */
  dateInputCount: number;
  /** The seller widens the period: from this census call on, the window the screen reports changes. */
  widenAfterCensusCalls?: number;
  /** The target only becomes visible once the list has been rewound (i.e. re-queried and re-swept). */
  hitOnlyAfterRewind?: boolean;
}

function fakePage(script: PageScript, seen: { ladderCalls: number; rewinds: number; censusCalls: number }): LadderReplyPage {
  return {
    url: () => "https://sell.smartstore.naver.com/#/review/search",
    content: () => Promise.resolve(""),
    evaluate: <T>(s: string): Promise<T> => {
      if (s.includes("dateInputCount:")) {
        seen.censusCalls += 1;
        const widened =
          script.widenAfterCensusCalls !== undefined && seen.censusCalls > script.widenAfterCensusCalls;
        return Promise.resolve({
          dateInputCount: script.dateInputCount,
          valuesParsed: script.dateInputCount > 0 ? 2 : 0,
          startDaysBefore: widened ? 30 : 6,
          endDaysBefore: 0,
          pagerNumberCount: 0,
          highestPagerNumber: 0,
        } as unknown as T);
      }
      if (s.includes("rewound:")) {
        seen.rewinds += 1;
        return Promise.resolve({ rewound: true, rowCount: 1 } as unknown as T);
      }
      if (s.includes("scrollTop = before + step")) {
        return Promise.resolve({ rowCount: 22, moved: true, atBottom: script.atBottom, usedPane: true, rowsInPane: 15 } as unknown as T);
      }
      if (s.includes("rowIndex:")) {
        seen.ladderCalls += 1;
        if (script.hitOnlyAfterRewind) {
          return Promise.resolve(ladderResult(seen.rewinds > 0 ? HIT : NO_HIT) as unknown as T);
        }
        const i = Math.min(seen.ladderCalls - 1, script.ladder.length - 1);
        return Promise.resolve(ladderResult(script.ladder[i]!) as unknown as T);
      }
      return Promise.resolve(0 as unknown as T);
    },
    waitForFunction: () => Promise.resolve(undefined),
  } as unknown as LadderReplyPage;
}

function driverWith(script: PageScript, rangeWaitMs: number, diags: { event: string; fields: Record<string, unknown> }[]) {
  const seen = { ladderCalls: 0, rewinds: 0, censusCalls: 0 };
  const driver = new NaverLadderReplyDriver(fakePage(script, seen), {
    hint: HINT,
    asOfDate: "2026-09-05",
    reviewIdFingerprint: FP,
    draftBody: "안녕하세요.",
    rangeWaitMs,
    onDiagnostic: (event, fields) => diags.push({ event, fields }),
  });
  return { driver, seen };
}

const NO_HIT = [row(0, { bucket: "TODAY" }), row(1, { bucket: "THIS_WEEK" })];
const HIT = [row(0, { bucket: "THIS_WEEK" }), row(1, { hit: true, bucket: "OLDER" })];

describe("NaverLadderReplyDriver — what a sweep that matched nothing established", () => {
  it("a bottomed-out list that never showed the target's bucket is OUT_OF_LISTED_RANGE, not 'not found'", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    // rangeWait 0: the verdict is reported, and the locate still fails closed.
    const { driver } = driverWith({ ladder: [NO_HIT], atBottom: true, dateInputCount: 2 }, 0, diags);
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    const miss = diags.find((d) => d.event === "aw_naver_reply_locate_miss");
    expect(miss?.fields.verdict).toBe("OUT_OF_LISTED_RANGE");
    expect(miss?.fields.targetBucket).toBe("OLDER");
    expect(miss?.fields.targetBucketRowsSeen).toBe(0);
    // The census is what makes the remedy nameable, so it travels with the verdict.
    expect(miss?.fields.dateInputCount).toBe(2);
  });

  it("a sweep that DID cover the target's bucket is still an ordinary miss, and never waits", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    const covered = [row(0, { bucket: "OLDER" }), row(1, { bucket: "OLDER" })];
    const { driver } = driverWith({ ladder: [covered], atBottom: true, dateInputCount: 2 }, 60_000, diags);
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    expect(diags.find((d) => d.event === "aw_naver_reply_locate_miss")?.fields.verdict).toBe("NOT_ON_SURFACE");
    expect(diags.some((d) => d.event === "aw_naver_reply_range_wait")).toBe(false);
  });

  it("a sweep cut short by the step cap establishes nothing — and does not claim a range problem", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    const { driver } = driverWith({ ladder: [NO_HIT], atBottom: false, dateInputCount: 2 }, 0, diags);
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    expect(diags.find((d) => d.event === "aw_naver_reply_locate_miss")?.fields.verdict).toBe("NOT_ESTABLISHED");
  }, 40_000);

  it("with no period control on the screen there is nothing to widen, so no wait is offered", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    const { driver } = driverWith({ ladder: [NO_HIT], atBottom: true, dateInputCount: 0 }, 60_000, diags);
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    expect(diags.some((d) => d.event === "aw_naver_reply_range_wait")).toBe(false);
  });

  it("a re-queried list that shows the target on its first screen resolves without another sweep", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    const { driver } = driverWith({ ladder: [NO_HIT, NO_HIT, HIT], atBottom: true, dateInputCount: 2 }, 60_000, diags);
    expect(await driver.locateReviewRow()).toEqual({ count: 1, sig: composerSigFor(["ladder-row", 1]) });
    expect(diags.some((d) => d.event === "aw_naver_reply_range_wait")).toBe(true);
    expect(diags.find((d) => d.event === "aw_naver_reply_range_resolved")?.fields.via).toBe("FIRST_SCREEN");
  }, 20_000);

  it("a changed period triggers a rewind and a fresh sweep — the new list is read from its first row", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    const { driver, seen } = driverWith(
      { ladder: [NO_HIT], atBottom: true, dateInputCount: 2, widenAfterCensusCalls: 1, hitOnlyAfterRewind: true },
      60_000,
      diags,
    );
    expect(await driver.locateReviewRow()).toEqual({ count: 1, sig: composerSigFor(["ladder-row", 1]) });
    const resweep = diags.find((d) => d.event === "aw_naver_reply_range_resweep");
    expect(resweep?.fields.reason).toBe("WINDOW_CHANGED");
    expect(resweep?.fields.listStartDaysBefore).toBe(30);
    expect(seen.rewinds).toBeGreaterThan(0);
    expect(diags.find((d) => d.event === "aw_naver_reply_range_resolved")?.fields.via).toBe("RESWEEP");
  }, 30_000);

  it("the wait is bounded: an unattended run ends instead of watching forever", async () => {
    const diags: { event: string; fields: Record<string, unknown> }[] = [];
    const { driver } = driverWith({ ladder: [NO_HIT], atBottom: true, dateInputCount: 2 }, 4_000, diags);
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    expect(diags.some((d) => d.event === "aw_naver_reply_range_wait_timeout")).toBe(true);
  }, 20_000);
});
