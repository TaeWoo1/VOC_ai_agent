import { describe, expect, it } from "vitest";
import { buildNaverReviewListReadScript } from "../../src/naver/review-list-observe-inpage.js";

/**
 * The attachment projection, run against a fake grid shaped exactly like the M2 census (2026-09-18): each entry has
 * `attachUrl`/`attachPath` on phinf.pstatic.net, `reviewAttachmentType = "I"`, plus name/description/size fields.
 * Only the address and a closed kind may leave; nothing else of the entry does.
 */
function run(rowsData: Record<string, unknown>[]) {
  const nodes = rowsData.map((data) => ({ data, gridApi: undefined as unknown }));
  const api = {
    forEachNode: (fn: (n: unknown) => void) => nodes.forEach(fn),
    getModel: () => ({ getType: () => "infinite", getRowCount: () => nodes.length }),
    paginationGetTotalPages: () => 1,
  };
  nodes.forEach((n) => (n.gridApi = api));
  const rendered = nodes.map((node) => ({
    __AG_0: { renderedRow: { rowNode: node } },
    querySelectorAll: () => [{ getAttribute: () => `openReviewDetailModal(${(node.data as { id: number }).id}, 1)` }],
  }));
  const document = {
    querySelectorAll: (sel: string) => (sel.indexOf("pinned") >= 0 ? [] : rendered),
  };
  const window = {};
  const location = { host: "sell.smartstore.naver.com", hash: "#/review/search" };
  return new Function("document", "window", "location", `return (${buildNaverReviewListReadScript()});`)(
    document, window, location,
  ) as { reason: string; rows: { attachCount: number; attachments: { url: string; kind: string }[] | null }[] };
}

const base = {
  reviewScore: 5, reviewContent: "좋아요", createDate: "2026-09-17T10:00:00.000+09:00", hasComment: false,
  productNo: 11111111, productName: "상품",
};

describe("NAVER review attachments — census-confirmed projection", () => {
  it("projects attachUrl and the image kind, and nothing else of the entry", () => {
    const out = run([{ ...base, id: 5100000001, reviewAttaches: [{
      id: 9, reviewAttachmentType: "I", attachUrl: "https://phinf.pstatic.net/checkout/a/b.jpg",
      attachPath: "https://phinf.pstatic.net/checkout/a/b.jpg", attachName: "IMG_0001.jpg",
      attachDescription: "사진 설명", attachWidth: 10, attachHeight: 10, attachSize: 1, sortOrder: 1,
      attachDirectoryName: "dir",
    }] }]);
    expect(out.reason).toBe("OK");
    expect(out.rows[0].attachCount).toBe(1);
    expect(out.rows[0].attachments).toEqual([{ url: "https://phinf.pstatic.net/checkout/a/b.jpg", kind: "IMAGE" }]);
    expect(JSON.stringify(out)).not.toMatch(/IMG_0001|사진 설명|attachDirectoryName|dir"/);
  });

  it("an unobserved attachment type is UNKNOWN, never a guessed video", () => {
    const out = run([{ ...base, id: 5100000002, reviewAttaches: [{
      reviewAttachmentType: "V", attachUrl: "https://phinf.pstatic.net/checkout/a/c.mp4" }] }]);
    expect(out.rows[0].attachments).toEqual([{ url: "https://phinf.pstatic.net/checkout/a/c.mp4", kind: "UNKNOWN" }]);
  });

  it("an entry without an https attachUrl projects no addresses for that row — the count still travels", () => {
    const out = run([{ ...base, id: 5100000003, reviewAttaches: [{ reviewAttachmentType: "I", attachPath: "x" }] }]);
    expect(out.rows[0].attachCount).toBe(1);
    expect(out.rows[0].attachments).toBeNull();
  });
});
