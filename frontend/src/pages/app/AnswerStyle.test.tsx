// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AnswerStyle, previewLines } from "./AnswerStyle";
import type { AnswerStyleView } from "../../lib/types";

const getAnswerStyle = vi.fn();
const saveAnswerStyle = vi.fn();

vi.mock("../../lib/apiClient", () => ({
  api: {
    getAnswerStyle: (...args: unknown[]) => getAnswerStyle(...args),
    saveAnswerStyle: (...args: unknown[]) => saveAnswerStyle(...args),
  },
}));

function style(over: Partial<AnswerStyleView> = {}): AnswerStyleView {
  return {
    tone: "POLITE",
    lengthPreference: "NORMAL",
    emojiPolicy: "NONE",
    greeting: null,
    closing: null,
    customerAddress: null,
    requiredPhrases: [],
    forbiddenPhrases: [],
    unknownFallbackTemplate: null,
    configured: false,
    version: 0,
    ...over,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter>
      <AnswerStyle />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AI 답변 스타일", () => {
  it("says nothing is set rather than implying somebody chose the defaults", async () => {
    getAnswerStyle.mockResolvedValue(style());
    renderScreen();

    expect(await screen.findByText(/아직 설정하지 않으셨습니다/)).toBeTruthy();
  });

  it("uses the seller's own words on every control — no prompt, no model, no temperature", async () => {
    getAnswerStyle.mockResolvedValue(style({ configured: true, version: 2 }));
    renderScreen();

    await screen.findByLabelText("답변 말투");
    for (const label of ["답변 길이", "이모지", "고객 호칭", "첫 인사", "끝 인사",
      "꼭 포함할 표현", "사용하지 않을 표현", "답을 모를 때 사용할 문구"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    for (const forbidden of ["프롬프트", "prompt", "system", "temperature", "모델"]) {
      expect(screen.queryByText(new RegExp(forbidden, "i"))).toBeNull();
    }
  });

  it("saves the whole form, with the phrase boxes split one per line", async () => {
    getAnswerStyle.mockResolvedValue(style());
    saveAnswerStyle.mockResolvedValue(style({ configured: true, version: 1 }));
    renderScreen();

    await screen.findByLabelText("첫 인사");
    await userEvent.type(screen.getByLabelText("첫 인사"), "안녕하세요. 선바로입니다.");
    await userEvent.type(screen.getByLabelText("꼭 포함할 표현"), "정성껏 준비하겠습니다\n\n잘 부탁드립니다");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(saveAnswerStyle).toHaveBeenCalledTimes(1));
    expect(saveAnswerStyle.mock.calls[0][0]).toMatchObject({
      tone: "POLITE",
      greeting: "안녕하세요. 선바로입니다.",
      requiredPhrases: ["정성껏 준비하겠습니다", "잘 부탁드립니다"],
      forbiddenPhrases: [],
      unknownFallbackTemplate: null,
    });
    expect(await screen.findByText("저장했습니다.")).toBeTruthy();
  });

  it("shows the server's own refusal — it names which phrase, and that is the useful part", async () => {
    getAnswerStyle.mockResolvedValue(style());
    saveAnswerStyle.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "「꼭 포함할 표현」에는 사실을 단정하는 문장을 넣을 수 없습니다: \"당일 발송됩니다\" (\"발송\")." } },
    });
    renderScreen();

    await screen.findByLabelText("꼭 포함할 표현");
    await userEvent.type(screen.getByLabelText("꼭 포함할 표현"), "당일 발송됩니다");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(/사실을 단정하는 문장을 넣을 수 없습니다/)).toBeTruthy();
  });

  it("previews the style and nothing else — the body stays a placeholder", async () => {
    getAnswerStyle.mockResolvedValue(
      style({ configured: true, version: 3, greeting: "안녕하세요. 선바로입니다.", closing: "감사합니다." }),
    );
    renderScreen();

    expect(await screen.findByText("배송은 언제 되나요?")).toBeTruthy();
    expect(screen.getByText(/여기에 등록된 답변 기준으로/)).toBeTruthy();
    // The one thing a style preview must never do: answer the synthetic question as if it were policy.
    expect(screen.queryByText(/영업일/)).toBeNull();
    expect(screen.queryByText(/출고/)).toBeNull();
  });
});

describe("previewLines", () => {
  const base = {
    tone: "POLITE" as const,
    length: "NORMAL" as const,
    greeting: "",
    closing: "",
    address: "",
    required: "",
    emoji: "NONE" as const,
  };

  it("is a pure function of the form — it calls nothing and invents no fact", () => {
    const lines = previewLines({ ...base, greeting: "안녕하세요.", closing: "감사합니다." });
    expect(lines[0].text).toBe("안녕하세요.");
    expect(lines[1].placeholder).toBe(true);
    expect(lines[lines.length - 1].text).toBe("감사합니다.");
  });

  it("puts a required phrase in the reply and an emoji only where allowed", () => {
    const lines = previewLines({
      ...base,
      required: "정성껏 준비하겠습니다",
      closing: "감사합니다.",
      emoji: "LIMITED",
    });
    expect(lines.map((l) => l.text)).toContain("정성껏 준비하겠습니다");
    expect(lines[lines.length - 1].text).toContain("🙂");
  });

  it("says how long the answer will be, without writing one", () => {
    expect(previewLines({ ...base, length: "SHORT" })[0].text).toContain("짧은");
    expect(previewLines({ ...base, length: "DETAILED" })[0].text).toContain("자세한");
  });
});
