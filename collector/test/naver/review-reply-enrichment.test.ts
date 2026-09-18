import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DETAIL_CLOSE_MARK,
  DETAIL_OPEN_MARK,
  buildNaverReviewDetailLocateScript,
  buildNaverReviewReplyReadScript,
} from "../../src/naver/review-reply-detail-inpage";
import { DEFAULT_MAX_CLICKS, enrichNaverReviewReplies, type DetailPage } from "../../src/naver/review-reply-enrichment";

/** A page whose scripts answer from a queue by kind, recording every press. */
function fakePage(answers: { locate: unknown[]; read: unknown[]; close: unknown[] }) {
  const clicks: string[] = [];
  const page: DetailPage = {
    async evaluate<T>(script: string): Promise<T> {
      if (script.includes("openReviewDetailModal")) return answers.locate.shift() as T;
      if (script.includes("replyText")) return answers.read.shift() as T;
      return answers.close.shift() as T;
    },
    async click(selector: string) {
      clicks.push(selector);
    },
    async waitForTimeout() {},
  };
  return { page, clicks };
}

describe("NAVER review reply enrichment — runtime", () => {
  it("opens, reads the one reply, closes — two presses per review, on marked controls only", async () => {
    const { page, clicks } = fakePage({
      locate: [{ reason: "OK" }],
      read: [{ reason: "OK", replyText: "안녕하세요 고객님, 감사합니다.", repliedAt: "2026-08-20T10:15:00+09:00" }],
      close: [{ reason: "OK" }],
    });
    const result = await enrichNaverReviewReplies(page, ["5055683531"], { settleMs: 0 });
    expect(result.observations).toEqual([
      { sourceReviewId: "5055683531", replyText: "안녕하세요 고객님, 감사합니다.", repliedAt: "2026-08-20T10:15:00+09:00" },
    ]);
    expect(clicks).toEqual([`[${DETAIL_OPEN_MARK}="1"]`, `[${DETAIL_CLOSE_MARK}="1"]`]);
    expect(result.clicks).toBe(2);
  });

  it("a review not in the list's rows is skipped without a press; the cap never lets a detail stay open", async () => {
    const { page, clicks } = fakePage({
      locate: [{ reason: "NOT_RENDERED" }, { reason: "OK" }, { reason: "OK" }, { reason: "OK" }],
      read: [{ reason: "OK", replyText: "a" }, { reason: "OK", replyText: "b" }, { reason: "OK", replyText: "c" }],
      close: [{ reason: "OK" }, { reason: "OK" }, { reason: "OK" }],
    });
    const result = await enrichNaverReviewReplies(page, ["1000001", "1000002", "1000003", "1000004", "1000005"], {
      settleMs: 0,
    });
    expect(result.steps[0].locate).toBe("NOT_RENDERED");
    expect(result.clicks).toBe(DEFAULT_MAX_CLICKS);
    expect(clicks.length).toBe(6);
    expect(result.observations.map((o) => o.replyText)).toEqual(["a", "b", "c"]);
    expect(result.steps.at(-1)?.locate).toBe("CLICK_BUDGET_EXHAUSTED");
  });

  it("an unreadable reply stores nothing and reports only key names; an unclosable detail stops the run", async () => {
    const { page, clicks } = fakePage({
      locate: [{ reason: "OK" }, { reason: "OK" }],
      read: Array.from({ length: 8 }, () => ({ reason: "NO_REPLY_IN_MODEL", keys: ["id", "reviewContent"] })),
      close: [{ reason: "NO_CLOSE_CONTROL" }],
    });
    const result = await enrichNaverReviewReplies(page, ["2000001", "2000002"], { settleMs: 0 });
    expect(result.observations).toEqual([]);
    expect(result.steps[0]).toMatchObject({ read: "NO_REPLY_IN_MODEL", close: "NO_CLOSE_CONTROL", structure: ["id", "reviewContent"] });
    expect(result.steps).toHaveLength(1);
    expect(clicks).toEqual([`[${DETAIL_OPEN_MARK}="1"]`]);
  });
});

describe("NAVER review reply enrichment — locate script", () => {
  function run(rows: { id: number; hasComment: boolean; controls: { call: string; text: string }[] }[], id: string) {
    const nodes = rows.map((r) => ({ data: { id: r.id, hasComment: r.hasComment }, gridApi: undefined as unknown }));
    const api = { forEachNode: (fn: (n: unknown) => void) => nodes.forEach(fn) };
    nodes.forEach((n) => (n.gridApi = api));
    const marks: string[] = [];
    const rendered = rows.map((r, i) => ({
      __AG_0: { renderedRow: { rowNode: nodes[i] } },
      querySelectorAll: () => r.controls.map((c) => ({
        tagName: "A", textContent: c.text,
        getAttribute: (k: string) => (k === "ng-click" ? c.call : null),
        setAttribute: (k: string) => marks.push(`${r.id}:${c.text}:${k}`),
        removeAttribute: () => {},
      })),
    }));
    const document = {
      querySelectorAll: (sel: string) => (sel.startsWith("[") ? [] : rendered),
    };
    const location = { host: "sell.smartstore.naver.com", hash: "#/review/search" };
    const out = new Function("document", "window", "location", `return (${buildNaverReviewDetailLocateScript(id)});`)(
      document, {}, location,
    ) as { reason: string };
    return { out, marks };
  }

  it("marks only the named review's detail control, refusing reply/write words", () => {
    const { out, marks } = run([
      { id: 1111111, hasComment: true, controls: [{ call: "openReviewDetailModal(1111111, 0)", text: "보기" }] },
      { id: 2222222, hasComment: true, controls: [
        { call: "openReviewDetailModal(2222222, 0)", text: "답글 수정" },
        { call: "openReviewDetailModal(2222222, 0)", text: "상세보기" },
      ] },
    ], "2222222");
    expect(out.reason).toBe("OK");
    expect(marks).toEqual([`2222222:상세보기:${DETAIL_OPEN_MARK}`]);
  });

  it("refuses a review the page says has no reply, and one that is not in the rows", () => {
    expect(run([{ id: 3333333, hasComment: false, controls: [] }], "3333333").out.reason).toBe("NOT_REPLIED");
    expect(run([{ id: 3333333, hasComment: true, controls: [] }], "4444444").out.reason).toBe("NOT_IN_MODEL");
    expect(run([{ id: 3333333, hasComment: true, controls: [{ call: "openReviewDetailModal(3333333)", text: "답글" }] }],
      "3333333").out.reason).toBe("REFUSED_CONTROL");
  });

  it("a review id that is not digits never becomes a script", () => {
    expect(() => buildNaverReviewDetailLocateScript("1');alert(1)//")).toThrow();
    expect(() => buildNaverReviewReplyReadScript("abc")).toThrow();
  });
});

describe("NAVER review reply enrichment — source fence", () => {
  it("presses only the two marked controls, and never types, keys, scrolls or navigates", () => {
    const src = readFileSync(join(__dirname, "../../src/naver/review-reply-enrichment.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src.match(/\.click\(/g)?.length).toBe(2);
    expect(src).toContain("page.click(`[${DETAIL_OPEN_MARK}=\"1\"]`");
    expect(src).toContain("page.click(`[${DETAIL_CLOSE_MARK}=\"1\"]`");
    for (const forbidden of [".fill(", ".type(", ".press(", "keyboard", "mouse", "scroll", "goto(", "dispatchEvent", "submit"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
    const inpage = readFileSync(join(__dirname, "../../src/naver/review-reply-detail-inpage.ts"), "utf8");
    for (const forbidden of [".click(", "dispatchEvent", "scrollTo", "scrollIntoView", ".submit(", "location.href ="]) {
      expect(inpage, forbidden).not.toContain(forbidden);
    }
  });
});
