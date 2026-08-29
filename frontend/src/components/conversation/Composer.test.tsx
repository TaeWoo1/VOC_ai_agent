// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./Composer";

describe("composer (Chat UI v1)", () => {
  it("Enter sends, Shift+Enter breaks a line; the send control is the ArrowUp icon named 「보내기」", async () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} busy={false} />);
    const box = screen.getByLabelText("무엇이든 물어보세요");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    await userEvent.type(box, "첫 줄{Shift>}{Enter}{/Shift}둘째 줄");
    expect(box).toHaveValue("첫 줄\n둘째 줄");
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("첫 줄\n둘째 줄");
    expect(box).toHaveValue("");
  });

  it("while running the same place holds a real Stop; without a stop handler no fake control is drawn", async () => {
    const onStop = vi.fn();
    const { rerender } = render(<Composer onSend={() => undefined} onStop={onStop} busy />);
    expect(screen.queryByRole("button", { name: "보내기" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "중지" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(<Composer onSend={() => undefined} busy />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "중지" })).toBeNull());
    expect(await screen.findByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("disabled: the box and the send are inert and the state is named", () => {
    render(<Composer onSend={() => undefined} busy={false} disabled />);
    expect(screen.getByLabelText("무엇이든 물어보세요")).toBeDisabled();
    expect(screen.getByRole("form", { name: "AI 담당자에게 요청" }).querySelector("[data-state]")).toHaveAttribute("data-state", "disabled");
  });
});
