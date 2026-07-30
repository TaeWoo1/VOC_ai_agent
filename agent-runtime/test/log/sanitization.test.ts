import { afterEach, describe, expect, it } from "vitest";
import { InquiryAgentRuntime } from "../../src/runtime";
import { clearLogSink, getLogSink, safeMeta } from "../../src/log";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { twoInquiries, PHONE_TOKEN, EMAIL_TOKEN } from "../support/fixtures";

afterEach(() => clearLogSink());

describe("log sanitization", () => {
  it("safeMeta drops content-ish + secret-ish keys and collapses non-scalars", () => {
    const out = safeMeta({
      count: 3,
      phase: "OPEN",
      title: "환불 요청",
      comments: "본문",
      token: "abc",
      candidate: { title: "x" },
      list: [1, 2, 3],
    });
    expect(out).toEqual({ count: 3, phase: "OPEN", list: "<array>" });
    expect(Object.keys(out)).not.toContain("title");
    expect(Object.keys(out)).not.toContain("comments");
    expect(Object.keys(out)).not.toContain("token");
  });

  it("a full run never writes seller content (title/body/phone/email) to any log line", async () => {
    const sink = getLogSink();
    const fake = new FakeSpringClient(twoInquiries());
    const runtime = new InquiryAgentRuntime({ client: fake });

    await runtime.start("t-log", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    await runtime.resume("t-log", { approved: true, approvedBy: "user-1" });

    const blob = JSON.stringify(sink);
    expect(sink.length).toBeGreaterThan(0); // it did log sanitized progress
    expect(blob).not.toContain(PHONE_TOKEN);
    expect(blob).not.toContain(EMAIL_TOKEN);
    expect(blob).not.toContain("환불 요청");
    expect(blob).not.toContain("안녕하세요"); // the drafted reply body
    expect(blob).not.toContain("[답변]");
  });
});
