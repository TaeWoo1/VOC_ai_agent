import { describe, expect, it } from "vitest";
// Raw source scan (Vite ?raw, no DOM, no new deps) — the repo's convention for
// asserting component contracts without a render harness.
import connectSource from "./Cafe24Connect.tsx?raw";
import resultSource from "./Cafe24ConnectResult.tsx?raw";

describe("Cafe24Connect page contract", () => {
  it("starts via the authenticated api client and redirects the browser to consent", () => {
    expect(connectSource).toContain("api.startCafe24Connect");
    expect(connectSource).toContain("window.location.assign");
  });

  it("guards against duplicate clicks while a request is pending", () => {
    expect(connectSource).toContain("if (pending)");
    expect(connectSource).toContain("disabled={pending}");
    expect(connectSource).toContain("disabled={!canSubmit}");
  });

  it("validates the mall id and classifies failures before display", () => {
    expect(connectSource).toContain("normalizeMallId");
    expect(connectSource).toContain("classifyStartError");
  });

  it("never reads OAuth code/state/token and never logs or persists secrets", () => {
    for (const forbidden of [
      "console.log",
      "localStorage",
      "sessionStorage",
      '"code"',
      '"state"',
      "accessToken",
      "refresh_token",
    ]) {
      expect(connectSource).not.toContain(forbidden);
    }
  });
});

describe("Cafe24ConnectResult page contract", () => {
  it("reads only the sanitized result params via the shared parser", () => {
    expect(resultSource).toContain("useSearchParams");
    expect(resultSource).toContain("parseCafe24Result");
  });

  it("handles every callback result status", () => {
    for (const status of ["connected", "reconnect_required", "invalid", "unknown"]) {
      expect(resultSource).toContain(status);
    }
  });

  it("offers a return path to the channel connection area", () => {
    expect(resultSource).toContain('to="/channels"');
    expect(resultSource).toContain('to="/connect/cafe24"');
  });

  it("never reads code/state/token from the URL, and never logs or persists anything", () => {
    for (const forbidden of [
      "console.log",
      "localStorage",
      "sessionStorage",
      'get("code")',
      'get("state")',
      'get("token")',
      "accessToken",
      "refresh_token",
    ]) {
      expect(resultSource).not.toContain(forbidden);
    }
  });
});

describe("Cafe24 connect copy stays honest (no roadmap / over-claim)", () => {
  it("avoids banned roadmap phrases", () => {
    for (const banned of ["곧", "준비 중", "연결 예정", "다음 단계에서", "coming soon"]) {
      expect(connectSource + resultSource).not.toContain(banned);
    }
  });
});
