// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectNoAxeViolations } from "../../test/axe";
import { AgentEnvNotice } from "./AgentEnvNotice";
import { classifyAgentEnv } from "../../lib/guidedConnection";

describe("AgentEnvNotice", () => {
  it("SESSION_MISMATCH (agent on a different run) renders its OWN copy + a retry — distinct from not-running", () => {
    const onRetry = vi.fn();
    render(
      <AgentEnvNotice
        status={classifyAgentEnv({ bridgePhase: "paired", hostRefusal: "carrier-mismatch" })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("status", { name: "AGENT_ENV_SESSION_MISMATCH" })).toBeInTheDocument();
    expect(screen.getByText(/다른 연결 세션/)).toBeInTheDocument();
    screen.getByTestId("agent-env-retry").click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("NOT_RUNNING renders different copy than SESSION_MISMATCH (never conflated)", () => {
    const { container: a } = render(
      <AgentEnvNotice status={classifyAgentEnv({ bridgePhase: "unreachable" })} />,
    );
    const { container: b } = render(
      <AgentEnvNotice status={classifyAgentEnv({ bridgePhase: "paired", hostRefusal: "carrier-mismatch" })} />,
    );
    expect(a.textContent).not.toBe(b.textContent);
    expect(a.querySelector('[aria-label="AGENT_ENV_NOT_RUNNING"]')).not.toBeNull();
    expect(b.querySelector('[aria-label="AGENT_ENV_SESSION_MISMATCH"]')).not.toBeNull();
  });

  it("PAIRED (healthy) renders nothing", () => {
    const { container } = render(<AgentEnvNotice status={classifyAgentEnv({ bridgePhase: "paired" })} />);
    expect(container.firstChild).toBeNull();
  });

  it("no retry button when the classifier says retry is not the action (e.g. incompatible version)", () => {
    render(<AgentEnvNotice status={classifyAgentEnv({ bridgePhase: "incompatible_version" })} onRetry={vi.fn()} />);
    expect(screen.queryByTestId("agent-env-retry")).toBeNull();
  });

  it("exposes no selector/url/secret — only sanitized copy + code label", () => {
    const { container } = render(
      <AgentEnvNotice status={classifyAgentEnv({ bridgePhase: "paired", hostRefusal: "carrier-mismatch" })} />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/wt-[0-9a-f]/);
    expect(text).not.toMatch(/run_/);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <AgentEnvNotice
        status={classifyAgentEnv({ bridgePhase: "paired", hostRefusal: "carrier-mismatch" })}
        onRetry={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });
});
