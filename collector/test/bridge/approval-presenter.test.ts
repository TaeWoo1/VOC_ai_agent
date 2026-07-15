/**
 * Approval presenter port + DEV TTY stderr adapter. Fully hermetic: the stderr surface is injected, so no
 * test writes to a real terminal and no test mutates the ambient NODE_ENV.
 *
 * The load-bearing property here is the TTY check: a redirected stderr is NOT a human channel, so the
 * presenter must report unavailable AND never write the secret — otherwise the code lands in a log file that
 * any same-uid process can read, which is exactly the attacker this design defends against.
 */
import { describe, it, expect } from "vitest";
import { nullApprovalPresenter } from "../../src/bridge/approval-presenter";
import { createStderrApprovalPresenter, type ApprovalStderr } from "../../src/bridge/stderr-approval-presenter";

const PRESENTATION = {
  requestId: "req-1",
  origin: "http://localhost:5173",
  workspaceLabel: "테스트 워크스페이스",
  approvalCode: "A1B2-C3D4",
};

/** A fake stderr that records every write, so we can assert the secret is written ONLY to a human channel. */
function fakeStderr(isTTY: boolean, throwOnWrite = false): ApprovalStderr & { writes: string[] } {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write(chunk: string) {
      if (throwOnWrite) throw new Error("stderr gone");
      writes.push(chunk);
      return true;
    },
  };
}

describe("nullApprovalPresenter (the fail-closed default)", () => {
  it("is never available and never presents", () => {
    expect(nullApprovalPresenter.available()).toBe(false);
    expect(nullApprovalPresenter.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "no_human_channel" });
  });
});

describe("stderr approval presenter", () => {
  it("presents the code on a real TTY under dev", () => {
    const stderr = fakeStderr(true);
    const p = createStderrApprovalPresenter({ stderr, nodeEnv: "development" });
    expect(p.available()).toBe(true);
    expect(p.present(PRESENTATION)).toEqual({ status: "presented" });
    expect(stderr.writes.join("")).toContain("A1B2-C3D4");
  });

  it("a redirected (non-TTY) stderr is NOT a human channel — unavailable, and the code is never written", () => {
    const stderr = fakeStderr(false);
    const p = createStderrApprovalPresenter({ stderr, nodeEnv: "development" });
    expect(p.available()).toBe(false);
    expect(p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "no_human_channel" });
    // The whole point: refuse rather than leak the secret into a redirected stream / log file.
    expect(stderr.writes).toEqual([]);
  });

  it("is refused under production even with a TTY (a terminal is a DEV-only consent surface)", () => {
    const stderr = fakeStderr(true);
    const p = createStderrApprovalPresenter({ stderr, nodeEnv: "production" });
    expect(p.available()).toBe(false);
    expect(p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "no_human_channel" });
    expect(stderr.writes).toEqual([]);
  });

  it("reports presenter_failed when the write itself faults, and never claims presented", () => {
    const stderr = fakeStderr(true, true);
    const p = createStderrApprovalPresenter({ stderr, nodeEnv: "development" });
    expect(p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "presenter_failed" });
  });

  it("shows the requesting origin + workspace so the human can judge the request", () => {
    const stderr = fakeStderr(true);
    createStderrApprovalPresenter({ stderr, nodeEnv: "development" }).present(PRESENTATION);
    const out = stderr.writes.join("");
    expect(out).toContain("http://localhost:5173");
    expect(out).toContain("테스트 워크스페이스");
  });
});
