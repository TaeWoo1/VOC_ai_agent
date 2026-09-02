// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ReviewReplyTemplates } from "./ReviewReplyTemplates";
import { LABELLED_TEMPLATE_KEYS, templateLabel } from "../../lib/reviewReplyTemplates";
import type { ReviewReplyTemplateView } from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const getReviewReplyTemplates = vi.fn();
const saveReviewReplyTemplate = vi.fn();
const resetReviewReplyTemplate = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getReviewReplyTemplates: (...a: unknown[]) => getReviewReplyTemplates(...a),
    saveReviewReplyTemplate: (...a: unknown[]) => saveReviewReplyTemplate(...a),
    resetReviewReplyTemplate: (...a: unknown[]) => resetReviewReplyTemplate(...a),
  },
}));

function template(over: Partial<ReviewReplyTemplateView> = {}): ReviewReplyTemplateView {
  return {
    key: "delivery_reply",
    body: "기본 배송 문구입니다.",
    defaultBody: "기본 배송 문구입니다.",
    customized: false,
    matchWords: ["배송", "택배"],
    ...over,
  };
}

/** The shape the backend sends: every category, in decision order. */
function allTemplates(): ReviewReplyTemplateView[] {
  return [
    template({ key: "positive_reply", body: "기본 칭찬 문구", defaultBody: "기본 칭찬 문구", matchWords: [] }),
    template({ key: "quality_reply", body: "기본 불량 문구", defaultBody: "기본 불량 문구", matchWords: ["불량"] }),
    template(),
    template({ key: "packaging_reply", body: "기본 포장 문구", defaultBody: "기본 포장 문구", matchWords: ["포장"] }),
    template({ key: "product_info_reply", body: "기본 설명 문구", defaultBody: "기본 설명 문구", matchWords: ["설명"] }),
    template({ key: "pricing_reply", body: "기본 가격 문구", defaultBody: "기본 가격 문구", matchWords: ["가격"] }),
    template({ key: "general_reply", body: "기본 일반 문구", defaultBody: "기본 일반 문구", matchWords: [] }),
  ];
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <ReviewReplyTemplates />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("리뷰 답변 문구", () => {
  it("names every template in Korean and never shows an internal key", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    const { container } = renderScreen();

    expect(await screen.findByText("칭찬 리뷰")).toBeInTheDocument();
    for (const key of LABELLED_TEMPLATE_KEYS) {
      expect(screen.getByText(templateLabel(key)!.name)).toBeInTheDocument();
    }
    // The whole rendered page, not just the headings: no category string, and no AI vocabulary.
    const text = container.textContent ?? "";
    for (const forbidden of [
      "positive_reply", "quality_reply", "delivery_reply", "packaging_reply",
      "product_info_reply", "pricing_reply", "general_reply",
      "template", "prompt", "RULE_BASED", "provider",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("says what a template does and does not decide", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    renderScreen();

    expect(await screen.findByText(/말투와 표현만 정합니다/)).toBeInTheDocument();
    expect(screen.getByText(/다음에 만드는 초안부터/)).toBeInTheDocument();
    expect(screen.getByText(/이미 승인한 답변은 그대로입니다/)).toBeInTheDocument();
  });

  it("shows the words that select a template, and nothing where there are none", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    renderScreen();

    expect(await screen.findByText("이런 낱말이 있을 때: 배송 · 택배")).toBeInTheDocument();
    // 칭찬 리뷰 is chosen by rating; it must not claim a word list.
    const positive = screen.getByRole("heading", { name: "칭찬 리뷰" }).closest("section")!;
    expect(within(positive).queryByText(/이런 낱말이 있을 때/)).not.toBeInTheDocument();
  });

  it("saves the edited wording and reads the server's own text back", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    saveReviewReplyTemplate.mockResolvedValue(
      template({ body: "저희가 정한 배송 문구입니다.", customized: true }),
    );
    renderScreen();

    const box = await screen.findByLabelText("배송 리뷰 문구");
    await userEvent.clear(box);
    await userEvent.type(box, "저희 배송 문구");
    await userEvent.click(within(box.closest("section")!).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(saveReviewReplyTemplate).toHaveBeenCalledWith("delivery_reply", "저희 배송 문구"));
    expect(await screen.findByText("저장했습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("배송 리뷰 문구")).toHaveValue("저희가 정한 배송 문구입니다.");
    expect(within(box.closest("section")!).getByText("직접 정한 문구")).toBeInTheDocument();
  });

  it("restores the default only where the company wrote its own", async () => {
    getReviewReplyTemplates.mockResolvedValue({
      templates: allTemplates().map((t) =>
        t.key === "delivery_reply" ? { ...t, body: "저희 문구", customized: true } : t,
      ),
    });
    resetReviewReplyTemplate.mockResolvedValue(template());
    renderScreen();

    const custom = (await screen.findByRole("heading", { name: "배송 리뷰" })).closest("section")!;
    const untouched = screen.getByRole("heading", { name: "포장 리뷰" }).closest("section")!;
    expect(within(untouched).getByRole("button", { name: "기본값 복원" })).toBeDisabled();

    await userEvent.click(within(custom).getByRole("button", { name: "기본값 복원" }));

    await waitFor(() => expect(resetReviewReplyTemplate).toHaveBeenCalledWith("delivery_reply"));
    expect(await screen.findByText("기본 문구로 되돌렸습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("배송 리뷰 문구")).toHaveValue("기본 배송 문구입니다.");
  });

  it("shows the backend's own refusal rather than a generic failure", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    saveReviewReplyTemplate.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "답변 문구를 입력하세요. 비워 두시려면 기본값 복원을 사용해 주세요." } },
    });
    renderScreen();

    const box = await screen.findByLabelText("배송 리뷰 문구");
    await userEvent.type(box, "x");
    await userEvent.click(within(box.closest("section")!).getByRole("button", { name: "저장" }));

    expect(await screen.findByText(/비워 두시려면 기본값 복원을 사용해 주세요/)).toBeInTheDocument();
  });

  it("does not offer 저장 until something changed", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    renderScreen();

    const box = await screen.findByLabelText("배송 리뷰 문구");
    expect(within(box.closest("section")!).getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("says so when the settings cannot be read, and offers nothing to press", async () => {
    getReviewReplyTemplates.mockRejectedValue(new Error("nope"));
    renderScreen();

    expect(await screen.findByText("문구를 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    getReviewReplyTemplates.mockResolvedValue({ templates: allTemplates() });
    const { container } = renderScreen();
    await screen.findByText("칭찬 리뷰");
    await expectNoAxeViolations(container);
  });
});
