import { describe, expect, it } from "vitest";
import { buildInquiryToolRegistry, UnknownToolError } from "../../src/tools/ToolRegistry";
import { TOOL } from "../../src/tools/inquiryTools";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { twoInquiries, OLDER_WORK_ITEM } from "../support/fixtures";
import type { InquiryQueueResponse } from "../../src/spring/types";

describe("ToolRegistry", () => {
  it("catalogs exactly the five inquiry tools by name", () => {
    const reg = buildInquiryToolRegistry(new FakeSpringClient());
    expect(reg.names()).toEqual(
      [TOOL.GET_DETAIL, TOOL.RECORD_APPROVAL, TOOL.PROPOSE_REPLY, TOOL.SAVE_DRAFT, TOOL.SEARCH_UNANSWERED].sort(),
    );
    for (const name of Object.values(TOOL)) expect(reg.has(name)).toBe(true);
  });

  it("fails loudly on an unknown tool (fail closed)", () => {
    const reg = buildInquiryToolRegistry(new FakeSpringClient());
    expect(() => reg.get("nope")).toThrow(UnknownToolError);
    expect(reg.has("nope")).toBe(false);
  });

  it("invoke() forwards to the backend and returns the structured result", async () => {
    const reg = buildInquiryToolRegistry(new FakeSpringClient(twoInquiries()));
    const res = await reg.invoke<InquiryQueueResponse>(TOOL.SEARCH_UNANSWERED, {});
    expect(res.content.map((c) => c.workItemId)).toContain(OLDER_WORK_ITEM);
    expect(res.content.every((c) => c.phase === "OPEN")).toBe(true);
  });

  it("search tool always scopes to OPEN (the definition of unanswered)", async () => {
    const fake = new FakeSpringClient(twoInquiries());
    const reg = buildInquiryToolRegistry(fake);
    // Move one item off OPEN; it should drop out of the search results.
    await fake.proposeInquiry(OLDER_WORK_ITEM);
    const res = await reg.invoke<InquiryQueueResponse>(TOOL.SEARCH_UNANSWERED, {});
    expect(res.content.map((c) => c.workItemId)).not.toContain(OLDER_WORK_ITEM);
  });
});
