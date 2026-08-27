// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NaverIssuanceModeChoice } from "./NaverIssuanceModeChoice";
import { NaverIssuanceGuidedWalkthrough } from "./NaverIssuanceGuidedWalkthrough";
import { CoupangIssuanceGuidedWalkthrough } from "../coupang/CoupangIssuanceGuidedWalkthrough";

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({ state: { phase: "unreachable" }, requestPairing: () => {}, retry: () => {} }),
}));

/**
 * **The path a seller can actually take today is the primary one** — Pilot Readiness Gate v1 §3.
 *
 * There is no installable 도우미 artifact in this repository: no bundle, no executable, no installer.
 * A first screen whose only filled control begins pairing with it is asking a brand-new seller to run
 * a program they have no way to obtain. Measured live 2026-08-27 on an account with no helper: the
 * NAVER gate's single CTA led to 「도우미를 실행한 뒤 다시 시도해 주세요」 with the way out styled as
 * the smallest control on the screen.
 *
 * These tests do not assert that the guided walk is gone — it is unchanged, and one press away for a
 * seller who is running the helper. They assert which of the two the screen leads with, because that
 * is the whole defect and it is the one thing that silently regresses.
 */
function filled(name: string | RegExp) {
  return screen.getByRole("button", { name }).className;
}

describe("§3 — the helper is never the primary control on a first-connect gate", () => {
  it("NAVER 발급 방식 선택: 텍스트 is primary, 화면 안내 says it needs the helper", () => {
    render(<NaverIssuanceModeChoice dispatch={() => {}} />);
    expect(filled("텍스트로 직접 진행하기")).toContain("btn-primary");
    expect(filled("화면을 보며 안내받기 (도우미 필요)")).toContain("btn-ghost");
  });

  it("NAVER guided gate: 직접 진행하기 is primary and needs no bridge", () => {
    render(<NaverIssuanceGuidedWalkthrough dispatch={() => {}} />);
    expect(filled("직접 진행하기")).toContain("btn-primary");
    expect(filled("화면 안내로 진행하기 (도우미 필요)")).toContain("btn-ghost");
  });

  it("쿠팡 발급 gate: 직접 진행하기 is primary, and 이미 키가 있어요 is still there", () => {
    render(<CoupangIssuanceGuidedWalkthrough onIssued={() => {}} />);
    expect(filled("직접 진행하기")).toContain("btn-primary");
    expect(filled("화면 안내로 진행하기 (도우미 필요)")).toContain("btn-ghost");
    expect(screen.getByRole("button", { name: "이미 키가 있어요" })).toBeTruthy();
  });
});
