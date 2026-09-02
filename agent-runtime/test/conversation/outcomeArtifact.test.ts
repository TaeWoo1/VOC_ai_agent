/**
 * Outcome Artifact + Visual Final Closure v1 — §2, the sentinel window.
 *
 * A claim about an unbounded read used to be handed `{from:"0000-00-00", to:"9999-99-99"}` so its filter
 * would pass everything, and `windowWord` then printed that range into the seller's paragraph:
 * 「이번에 확인한 네이버 리뷰 중 0000-00-00~9999-99-99에 작성된 리뷰는 50건입니다」, observed live on
 * 2026-09-02. The sentinel is internal; what a seller may read is a real period or no period at all.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { TODAY } from "./support";
import { claimsFor } from "../../src/conversation/reviewClaim";
import type { ReviewItem } from "../../src/conversation/contract";

const SENTINELS = ["0000-00-00", "9999-99-99"];

function row(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    reviewId: "r-1", channelCode: "NAVER", channelNameKo: "네이버", productId: null, productName: null,
    rating: 5, negative: false, preview: null, writtenOn: TODAY, to: "/reviews", ...over,
  } as ReviewItem;
}

describe("§2 — an unbounded read names no period", () => {
  it("drops the date clause instead of printing a placeholder range, and counts the same rows", () => {
    const rows = [row({ reviewId: "r-1" }), row({ reviewId: "r-2", writtenOn: "2020-01-01" }), row({ reviewId: "r-3", writtenOn: null })];
    const names = new Map([["NAVER", "네이버"]]);
    const collected = [{ channelCode: "NAVER", successRows: 3 }];

    const unbounded = claimsFor(rows, null, collected, names);
    expect(unbounded).toHaveLength(1);
    // The same two dated rows a sentinel range would have passed — the count did not move.
    expect(unbounded[0]!.count).toBe(2);
    expect(unbounded[0]!.sentence).toBe("이번에 확인한 네이버 리뷰는 2건입니다.");
    for (const s of SENTINELS) expect(unbounded[0]!.sentence).not.toContain(s);

    // A real window still names itself, exactly as before.
    const bounded = claimsFor(rows, { from: TODAY, to: TODAY, token: "TODAY" }, collected, names);
    expect(bounded[0]!.sentence).toContain("오늘 작성된");
  });
});

describe("§2 — the placeholder cannot come back", () => {
  it("no source under src/ holds a sentinel date literal", () => {
    const root = resolve(__dirname, "../../src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) {
          const text = readFileSync(path, "utf8");
          // The comment that explains the removal names it; a literal in code is the defect itself.
          const code = text.split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
          if (SENTINELS.some((sentinel) => code.includes(sentinel))) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
