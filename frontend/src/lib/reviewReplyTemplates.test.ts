import { describe, expect, it } from "vitest";
import { LABELLED_TEMPLATE_KEYS, labelledTemplates, templateLabel } from "./reviewReplyTemplates";
import type { ReviewReplyTemplateView } from "./types";

/**
 * The backend's `ReviewReplyTemplateKey` and this map are two halves of one screen, and the seam
 * between them is a string. If the backend grows a category, this test is what says the screen cannot
 * name it yet — and `labelledTemplates` is what stops it from being rendered raw in the meantime.
 */
const BACKEND_KEYS = [
  "positive_reply",
  "quality_reply",
  "delivery_reply",
  "packaging_reply",
  "product_info_reply",
  "pricing_reply",
  "general_reply",
] as const;

function row(key: string): ReviewReplyTemplateView {
  return { key, body: "문구", defaultBody: "문구", customized: false, matchWords: [] };
}

describe("review reply template labels", () => {
  it("names every category the backend has, and no more", () => {
    expect([...LABELLED_TEMPLATE_KEYS].sort()).toEqual([...BACKEND_KEYS].sort());
  });

  it("every label is Korean prose, never the key and never AI vocabulary", () => {
    for (const key of BACKEND_KEYS) {
      const label = templateLabel(key)!;
      expect(label.name).not.toContain(key);
      expect(label.when).not.toContain(key);
      expect(label.name).not.toMatch(/[a-zA-Z_]/);
      expect(label.when).not.toMatch(/[a-zA-Z_]/);
      expect(label.when).toMatch(/\.$/);
    }
  });

  it("an unnamed category is dropped rather than shown raw", () => {
    const rows = [row("delivery_reply"), row("some_future_reply")];
    expect(labelledTemplates(rows).map((r) => r.template.key)).toEqual(["delivery_reply"]);
    expect(templateLabel("some_future_reply")).toBeNull();
  });

  it("keeps the backend's order, which is the order the product decides in", () => {
    const rows = BACKEND_KEYS.map(row);
    expect(labelledTemplates(rows).map((r) => r.template.key)).toEqual([...BACKEND_KEYS]);
  });
});
