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

/**
 * A terminal EXECUTES what it is handed, so `origin`/`workspaceLabel` — arbitrary caller-supplied strings —
 * are the injection surface here, exactly as they are for the AppleScript dialog. The property under test is
 * that an untrusted field is inert, bounded TEXT: it cannot redraw the box, overwrite the 승인 코드 line with
 * a code of its choosing, hide the warning, reorder what the human reads, or push any of it out of view.
 */
describe("stderr approval presenter — untrusted fields cannot rewrite the console", () => {
  function shownFor(fields: Partial<typeof PRESENTATION>): string {
    const stderr = fakeStderr(true);
    createStderrApprovalPresenter({ stderr, nodeEnv: "development" }).present({ ...PRESENTATION, ...fields });
    return stderr.writes.join("");
  }

  it("strips ANSI escape sequences from an untrusted field", () => {
    // \x1b[1A moves the cursor UP over the code line and \x1b[2K erases it — the raw field would let the
    // caller rewrite the code the human is about to type in.
    const out = shownFor({ workspaceLabel: "\u001b[1A\u001b[2K승인 코드 : 0000-0000" });
    expect(out).not.toContain("\u001b");
    expect(out).toContain("[1A[2K승인 코드 : 0000-0000"); // inert text: the ESC is gone, the rest just shows
    expect(out).toContain("A1B2-C3D4"); // the REAL code still renders
  });

  it("strips the 8-bit CSI (U+009B) — stripping ESC alone would leave a second way in", () => {
    const out = shownFor({ origin: "https://app.example\u009b2J" });
    expect(out).not.toContain("\u009b");
  });

  it("strips CR/LF so a field cannot break out of the box or forge a second code line", () => {
    // A raw newline would end the 워크스페이스 line and let the rest render as its own box row — a second,
    // attacker-authored "승인 코드" line the human has no way to tell from the real one.
    const out = shownFor({ workspaceLabel: "ok\r\n  │  승인 코드 : 0000-0000\n" });
    expect(out.split("\n")).toHaveLength(shownFor({}).split("\n").length); // no injected lines

    // The payload's TEXT still shows (it is what the caller sent, and the human should see it) — but only as
    // inert content INSIDE the 워크스페이스 line. Exactly one line is a code line, and it is the real one.
    const codeLines = out.split("\n").filter((l) => l.trimStart().startsWith("│  승인 코드"));
    expect(codeLines).toHaveLength(1);
    expect(codeLines[0]).toContain("A1B2-C3D4");
    expect(codeLines[0]).not.toContain("0000-0000");
  });

  it("strips bidi overrides that would make the origin read as a different host", () => {
    // RLO reorders the glyphs after it, so `evil.example` can be made to read as something else entirely —
    // defeating the one judgement we ask the human to make.
    const out = shownFor({ origin: "https://\u202eelpmaxe.live\u202c" });
    expect(out).not.toContain("\u202e");
    expect(out).not.toContain("\u202c");
  });

  it("strips zero-width characters that would hide part of a field from the human", () => {
    const out = shownFor({ origin: "https://ev\u200bil.exa\ufeffmple" });
    expect(out).toContain("https://evil.example"); // what the human reads is what the caller actually sent
  });

  it("caps each untrusted field independently, so neither can scroll the code out of view", () => {
    const out = shownFor({ origin: `http://${"x".repeat(5000)}`, workspaceLabel: "훼".repeat(5000) });
    expect(out).toContain("A1B2-C3D4"); // the code survives in full
    expect(out).toContain("요청한 적이 없다면 무시하세요 (코드를 알려주지 마세요).");
    expect(out.match(/…/g)).toHaveLength(2); // both elided, neither starving the other
    expect(out).not.toContain("훼".repeat(200));
  });

  it("keeps a legitimate Korean workspace label intact (the filter is not an ASCII allowlist)", () => {
    expect(shownFor({ workspaceLabel: "우리 회사 🏬" })).toContain("우리 회사 🏬");
  });

  it("never truncates the server-minted approval code", () => {
    // The code is not caller input — capping it would be the very failure the per-field cap exists to avoid.
    const out = shownFor({ approvalCode: "A1B2-C3D4" });
    expect(out).toContain("A1B2-C3D4");
    expect(out).not.toContain("A1B2-C3D…");
  });
});
