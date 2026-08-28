import { describe, expect, it } from "vitest";
import { listInquiryWorkload } from "../../src/operator/tools/inquiryWorkload";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { inquiries } from "./support";

describe("inquiry workload — a named channel narrows the rows (a data filter, not routing)", () => {
  it("channel: NAVER keeps only NAVER rows; no channel keeps all", async () => {
    const client = new FakeSpringClient(inquiries());
    const all = await listInquiryWorkload(client, {});
    const naver = await listInquiryWorkload(client, { channel: "NAVER" });
    expect(all.items.length).toBeGreaterThan(0);
    expect(naver.items.every((i) => (i.channelCode ?? "").toUpperCase() === "NAVER")).toBe(true);
    expect(naver.items.length).toBeLessThanOrEqual(all.items.length);
  });
});
