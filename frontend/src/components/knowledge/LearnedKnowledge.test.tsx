// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LearnedKnowledgeResponse } from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const api = vi.hoisted(() => ({ getLearnedKnowledge: vi.fn(), learnFromHistory: vi.fn() }));
vi.mock("../../lib/apiClient", () => ({ api, getToken: () => null }));

import { LearnedKnowledge } from "./LearnedKnowledge";

function response(over: Partial<LearnedKnowledgeResponse["learned"]> = {}): LearnedKnowledgeResponse {
  return {
    learned: {
      sources: [
        {
          key: "PAST_INQUIRY_ANSWER",
          labelKo: "과거 문의 답변",
          count: 20,
          latestOn: "2026-08-28",
          examples: [
            {
              title: "[답변] 부착",
              excerpt: "벽지에도 부착 가능합니다.",
              provenance: "문의 답변 · 채널에 등록된 답변",
              productName: "선바로 일체형 전선몰딩",
              capturedOn: "2026-08-28",
            },
          ],
        },
        { key: "PAST_REVIEW_REPLY", labelKo: "과거 리뷰 답글", count: 0, latestOn: null, examples: [] },
      ],
      channels: [
        {
          channelNameKo: "네이버 스마트스토어",
          source: "PAST_INQUIRY_ANSWER",
          sourceLabelKo: "과거 문의 답변",
          availability: "LEARNED",
          sentenceKo: "네이버에 등록하신 문의 답변을 가져와 비슷한 문의에 참고합니다.",
        },
        {
          channelNameKo: "네이버 스마트스토어",
          source: "PAST_REVIEW_REPLY",
          sourceLabelKo: "과거 리뷰 답글",
          availability: "SCREEN_UNPROVEN",
          sentenceKo: "네이버는 리뷰 답글 내용을 API나 내려받기 파일로 주지 않아 아직 가져오지 못합니다.",
        },
      ],
      historyReads: [],
      canLearnHistory: true,
      ...over,
    },
    lastRun: null,
  };
}

/**
 * What the operating history taught, source by source, with the channel's own reason beside a source it cannot give —
 * and the one control that reads the seller's history now, which never writes to a channel.
 */
describe("LearnedKnowledge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows each source with its count and example, and names a source the channel cannot give", async () => {
    api.getLearnedKnowledge.mockResolvedValue(response());
    const { container } = render(<LearnedKnowledge />);

    expect(await screen.findByText("20건")).toBeTruthy();
    expect(screen.getByText("「벽지에도 부착 가능합니다.」")).toBeTruthy();
    expect(screen.getByText(/문의 답변 · 채널에 등록된 답변 · 선바로 일체형 전선몰딩/)).toBeTruthy();
    expect(screen.getByText(/리뷰 답글 내용을 API나 내려받기 파일로 주지 않아/)).toBeTruthy();
    expect(screen.getByText("가져오지 못함")).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("learning from history reports what was read, and says when product detail is switched off", async () => {
    api.getLearnedKnowledge.mockResolvedValue(response());
    api.learnFromHistory.mockResolvedValue({
      learned: response().learned,
      lastRun: {
        ranAt: "2026-09-18T01:00:00Z",
        inquiryHistory: [
          { channelNameKo: "네이버 스마트스토어", from: "2026-06-20", to: "2026-09-18", status: "READ", rowsRead: 41 },
        ],
        answersRemembered: 22,
        productDetail: {
          enabled: false, considered: 0, indexed: 0, imageOnly: 0, empty: 0, alreadyFresh: 0, noListing: 0, failed: 0,
        },
      },
    });
    const user = userEvent.setup();
    render(<LearnedKnowledge />);

    await user.click(await screen.findByRole("button", { name: "과거 운영 기록에서 배우기" }));

    await waitFor(() => expect(api.learnFromHistory).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("네이버 스마트스토어: 2026-06-20부터 문의 41건을 읽었습니다.")).toBeTruthy();
    expect(screen.getByText("기억하고 있는 지난 문의 답변은 22건입니다.")).toBeTruthy();
    expect(screen.getByText("상품 상세 읽기는 지금 꺼져 있습니다.")).toBeTruthy();
  });

  it("offers no history read when no connected channel can give one", async () => {
    api.getLearnedKnowledge.mockResolvedValue(response({ canLearnHistory: false, channels: [] }));
    render(<LearnedKnowledge />);

    expect(await screen.findByText("20건")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "과거 운영 기록에서 배우기" })).toBeNull();
  });
});
