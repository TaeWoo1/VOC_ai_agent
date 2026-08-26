import { describe, expect, it } from "vitest";
import { waitedLabel } from "./inquiryWorkflow";

/**
 * The queue was rendering "4150일 전" on a Cafe24 backlog that reaches back to 2015. That is
 * arithmetic, not information: nobody triages 4,150 days differently from 4,000. These buckets are
 * the shape of the decision instead — hours while it is still today's problem, then days, weeks,
 * months, and finally the one bucket where the only question left is whether to answer at all.
 */
const NOW = new Date("2026-08-24T12:00:00Z");

describe("waitedLabel", () => {
  it("counts hours while it is still today's problem", () => {
    expect(waitedLabel("2026-08-24T09:00:00Z", NOW)).toBe("3시간째");
    // 20 minutes is 「20분째」, not 「방금」. It used to be the latter: waitedLabel had no minute
    // rung, so the same inquiry read 「20분 전」 on its list row and 「방금」 in the pane beside it.
    expect(waitedLabel("2026-08-24T11:40:00Z", NOW)).toBe("20분째");
    expect(waitedLabel("2026-08-24T11:59:30Z", NOW)).toBe("방금");
  });

  it("counts days, then weeks, then months", () => {
    expect(waitedLabel("2026-08-21T12:00:00Z", NOW)).toBe("3일째");
    expect(waitedLabel("2026-08-10T12:00:00Z", NOW)).toBe("2주째");
    expect(waitedLabel("2026-06-01T12:00:00Z", NOW)).toBe("2개월째");
  });

  it("stops counting past a year — the number stopped meaning anything", () => {
    expect(waitedLabel("2015-03-01T00:00:00Z", NOW)).toBe("1년 넘음");
  });

  it("returns nothing for an unparseable or future timestamp rather than a negative age", () => {
    expect(waitedLabel("not-a-date", NOW)).toBeNull();
    expect(waitedLabel("2027-01-01T00:00:00Z", NOW)).toBeNull();
  });
});
