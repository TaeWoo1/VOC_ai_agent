/**
 * Windows native-dialog approval presenter. Fully hermetic: the PowerShell process is an INJECTED seam, so no
 * test spawns a real process and no test ever puts a dialog on a screen.
 *
 * The load-bearing properties mirror the macOS adapter:
 *  - the binary is the absolute powershell.exe under %SystemRoot%\System32, never composed via a shell;
 *  - EVERY dynamic value (origin, workspace label, and above all the approval code) travels on stdin and
 *    NEVER in argv;
 *  - untrusted display strings cannot inject PowerShell (single-quote escaping);
 *  - unsupported OS / missing binary / error / timeout / cancel all fail CLOSED or map to declined.
 */
import { describe, it, expect } from "vitest";
import {
  buildApprovalScript,
  createWindowsApprovalPresenter,
  powerShellLiteral,
  POWERSHELL_ARGS,
  resolvePowerShellPath,
  sanitizeField,
  type PowerShellOutcome,
  type PowerShellProcess,
} from "../../src/bridge/windows-approval-presenter";

const PRESENTATION = {
  requestId: "req-1",
  origin: "http://localhost:5173",
  workspaceLabel: "우리 회사",
  approvalCode: "A1B2-C3D4",
};

const WIN_ENV = { SystemRoot: "C:\\Windows" };

interface Call {
  command: string;
  args: readonly string[];
  input: string;
  timeoutMs: number;
}

function fakeProcess(outcome: PowerShellOutcome = { ok: true, stdout: "sellerops_approved" }): PowerShellProcess & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async run(command, args, input, timeoutMs) {
      calls.push({ command, args, input, timeoutMs });
      return outcome;
    },
  };
}

describe("windows approval presenter — availability fails closed", () => {
  it("is unavailable off Windows", () => {
    const p = createWindowsApprovalPresenter({ platform: "darwin", env: WIN_ENV, fileExists: () => true });
    expect(p.available()).toBe(false);
  });

  it("is unavailable when powershell.exe is missing", () => {
    const p = createWindowsApprovalPresenter({ platform: "win32", env: WIN_ENV, fileExists: () => false });
    expect(p.available()).toBe(false);
  });

  it("is available on Windows with powershell.exe present", () => {
    const p = createWindowsApprovalPresenter({ platform: "win32", env: WIN_ENV, fileExists: () => true });
    expect(p.available()).toBe(true);
  });

  it("an unavailable presenter never runs the process (no secret minted onto a dead channel)", async () => {
    const proc = fakeProcess();
    const p = createWindowsApprovalPresenter({ platform: "linux", env: WIN_ENV, fileExists: () => true, process: proc });
    const r = await p.present(PRESENTATION);
    expect(r).toEqual({ status: "unavailable", reason: "no_human_channel" });
    expect(proc.calls.length).toBe(0);
  });
});

describe("windows approval presenter — the secret never touches argv", () => {
  it("passes only constant flags in argv; the code + fields are on stdin", async () => {
    const proc = fakeProcess();
    const p = createWindowsApprovalPresenter({ platform: "win32", env: WIN_ENV, fileExists: () => true, process: proc });
    await p.present(PRESENTATION);
    const call = proc.calls[0]!;
    expect(call.command).toBe(resolvePowerShellPath(WIN_ENV));
    expect(call.args).toEqual(POWERSHELL_ARGS);
    // The approval code and untrusted fields appear ONLY in the stdin script, never in argv.
    for (const arg of call.args) {
      expect(arg).not.toContain("A1B2-C3D4");
      expect(arg).not.toContain("localhost");
    }
    expect(call.input).toContain("A1B2-C3D4");
  });
});

describe("windows approval presenter — verdict mapping", () => {
  const present = (outcome: PowerShellOutcome) =>
    createWindowsApprovalPresenter({ platform: "win32", env: WIN_ENV, fileExists: () => true, process: fakeProcess(outcome) }).present(
      PRESENTATION,
    );

  it("approved → presented", async () => {
    expect(await present({ ok: true, stdout: "sellerops_approved\n" })).toEqual({ status: "presented" });
  });

  it("declined (취소/✕) → declined", async () => {
    expect(await present({ ok: true, stdout: "sellerops_declined" })).toEqual({ status: "declined" });
  });

  it("timeout → unavailable (never a false 'presented')", async () => {
    expect(await present({ ok: false, reason: "timeout" })).toEqual({ status: "unavailable", reason: "presenter_failed" });
  });

  it("error → unavailable", async () => {
    expect(await present({ ok: false, reason: "error" })).toEqual({ status: "unavailable", reason: "presenter_failed" });
  });

  it("unrecognized stdout → unavailable (fail closed)", async () => {
    expect(await present({ ok: true, stdout: "???" })).toEqual({ status: "unavailable", reason: "presenter_failed" });
  });
});

describe("powerShellLiteral — injection is escaped, not trusted", () => {
  it("doubles single quotes so a crafted label cannot close the literal", () => {
    expect(powerShellLiteral("a'b")).toBe("'a''b'");
    // A label trying to break out and run code stays inside one inert literal.
    const hostile = "'; Remove-Item C:\\ -Recurse; '";
    const lit = powerShellLiteral(hostile);
    expect(lit.startsWith("'")).toBe(true);
    expect(lit.endsWith("'")).toBe(true);
    // Every embedded quote was doubled — no lone `'` remains to end the literal early.
    expect(/(^|[^'])'([^']|$)/.test(lit.slice(1, -1))).toBe(false);
  });

  it("strips control characters (no ANSI/bidi in the dialog body)", () => {
    expect(powerShellLiteral("a\u001b[2Jb\u202ec")).toBe("'a[2Jbc'");
  });
});

describe("buildApprovalScript", () => {
  it("shows the approval code in full and the cancel instruction", () => {
    const script = buildApprovalScript(PRESENTATION);
    expect(script).toContain("A1B2-C3D4");
    expect(script).toContain("취소");
    expect(script).toContain("MessageBox");
    // Verdict is decided inside PowerShell and printed as a stable token.
    expect(script).toContain("sellerops_approved");
    expect(script).toContain("sellerops_declined");
  });

  it("caps an over-long untrusted field so it cannot displace the code", () => {
    const long = "x".repeat(500);
    const script = buildApprovalScript({ ...PRESENTATION, workspaceLabel: long });
    expect(sanitizeField(long).length).toBeLessThan(long.length);
    expect(script).toContain("A1B2-C3D4"); // code still present after a hostile-length label
  });
});
