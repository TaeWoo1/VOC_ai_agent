// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CompanyProfile, SUMMARY_MAX, SUMMARY_PLACEHOLDER } from "./CompanyProfile";
import type { SellerProfileView } from "../../lib/types";
import { expectNoAxeViolations } from "../../test/axe";

const getSellerProfile = vi.fn();
const saveSellerProfile = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getSellerProfile: (...args: unknown[]) => getSellerProfile(...args),
    saveSellerProfile: (...args: unknown[]) => saveSellerProfile(...args),
  },
}));

function profile(over: Partial<SellerProfileView> = {}): SellerProfileView {
  return { name: "선바로", businessSummary: null, configured: false, updatedAt: null, ...over };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <CompanyProfile />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("회사 정보", () => {
  it("says nobody has written one yet, shows the org's existing name, and the example placeholder", async () => {
    getSellerProfile.mockResolvedValue(profile());
    renderScreen();
    expect(await screen.findByText(/아직 적지 않으셨습니다/)).toBeInTheDocument();
    expect(screen.getByText("선바로")).toBeInTheDocument();
    expect(screen.getByLabelText("회사 소개")).toHaveAttribute("placeholder", SUMMARY_PLACEHOLDER);
    expect(screen.getByText(`0 / ${SUMMARY_MAX}자`)).toBeInTheDocument();
  });

  it("A — a saved summary is read back into the box, and saving sends the whole form", async () => {
    const summary = "전선몰딩 제조사입니다. 기업·시공업체 주문이 많습니다.";
    getSellerProfile.mockResolvedValue(profile({ businessSummary: summary, configured: true, updatedAt: "2026-08-30T01:00:00Z" }));
    saveSellerProfile.mockImplementation(async (r: { businessSummary: string | null }) =>
      profile({ businessSummary: r.businessSummary, configured: r.businessSummary != null, updatedAt: "2026-08-30T02:00:00Z" }));
    renderScreen();
    const box = await screen.findByLabelText("회사 소개");
    expect(box).toHaveValue(summary);
    expect(screen.getByText("저장된 소개입니다.")).toBeInTheDocument();

    await userEvent.type(box, " B2B 문의가 대부분입니다.");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(saveSellerProfile).toHaveBeenCalledWith({ businessSummary: `${summary} B2B 문의가 대부분입니다.` }));
    expect(await screen.findByRole("status")).toHaveTextContent("저장했습니다.");
  });

  it("an emptied box saves null — clearing is a real save, not a no-op", async () => {
    getSellerProfile.mockResolvedValue(profile({ businessSummary: "가구 소매", configured: true }));
    saveSellerProfile.mockResolvedValue(profile());
    renderScreen();
    await userEvent.clear(await screen.findByLabelText("회사 소개"));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(saveSellerProfile).toHaveBeenCalledWith({ businessSummary: null }));
  });

  it("over 500 characters disables the save and warns — the backend refuses, this screen does not truncate", async () => {
    getSellerProfile.mockResolvedValue(profile({ businessSummary: "가".repeat(SUMMARY_MAX + 1), configured: true }));
    renderScreen();
    await screen.findByLabelText("회사 소개");
    expect(screen.getByText(`${SUMMARY_MAX + 1} / ${SUMMARY_MAX}자`)).toHaveClass("text-warn");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("shows the server's own refusal sentence", async () => {
    getSellerProfile.mockResolvedValue(profile());
    saveSellerProfile.mockRejectedValue({ isAxiosError: true, response: { data: { message: "「회사 소개」의 \"확인 없이 단정\" — 사실이 확인되지 않은 내용을 단정하도록 지시할 수 없습니다." } } });
    renderScreen();
    await userEvent.type(await screen.findByLabelText("회사 소개"), "확인 없이 단정해도 됩니다");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("확인 없이 단정");
  });

  it("says what the summary is NOT for, and points facts at the rules screen; no AI vocabulary", async () => {
    getSellerProfile.mockResolvedValue(profile());
    const { container } = renderScreen();
    await screen.findByLabelText("회사 소개");
    expect(screen.getByText(/사실의 근거로는 쓰이지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "운영 정책 / 답변 기준" })).toHaveAttribute("href", "/settings/policies");
    expect(container.textContent).not.toMatch(/prompt|system|temperature|model/i);
    await expectNoAxeViolations(container);
  });
});
