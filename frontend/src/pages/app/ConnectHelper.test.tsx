// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectHelper } from "./ConnectHelper";

/**
 * The install guide has to describe the installer that ships, not the one that used to.
 *
 * Helper Device Authentication v1 removed the password model: `tools/helper/payload/install.command`
 * says in its own header 「비밀번호를 묻지 않습니다」 and its last line tells the seller to press
 * 「도우미 연결」 → 「허용」 → 「이 기기 연결」. This page still said a window would ask for their
 * reviewnary email and password — found in pilot QA 2026-09-07, and it is the worst kind of wrong copy:
 * the seller waits for a window that never opens, on the one screen that exists because they are stuck.
 */
describe("도우미 안내 — the steps are the installer's steps", () => {
  it("never asks the seller to type a password into the helper", () => {
    const { container } = render(<MemoryRouter><ConnectHelper /></MemoryRouter>);
    const text = container.textContent ?? "";
    expect(text).not.toContain("비밀번호를 입력합니다");
    // It says the opposite, because the seller has to know the missing window is not a failure.
    expect(text).toContain("비밀번호를 입력하지 않습니다");
    expect(text).toContain("이 기기 연결");
  });

  it("explains every state word the helper card can show", () => {
    render(<MemoryRouter><ConnectHelper /></MemoryRouter>);
    for (const word of ["실행 필요라고 나올 때", "업데이트 필요라고 나올 때", "기기 연결 필요라고 나올 때"]) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
  });
});
