import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The panel is not a WRITE shortcut (Contextual Agent Workspace v1 §5). The seller may type
 * 「보내줘」; what reaches the marketplace is decided by the inquiry screen's approval step and the
 * backend's publish gate. So the panel module must hold no path to any of them — checked by name.
 */
const FORBIDDEN = ["confirmInquiryPublish", "publishInquiry", "resumeRun", "approveInquiry", "/publish", "inquiryPublish", "actionWindow", "guidedSubmission"];

describe("agent panel write fence", () => {
  it("imports nothing that can send, approve or resume", () => {
    for (const file of ["AgentPanel.tsx", "OperatorAnswerView.tsx"]) {
      const src = readFileSync(resolve(__dirname, file), "utf8");
      for (const word of FORBIDDEN) {
        expect(src, `${file} mentions ${word}`).not.toContain(word);
      }
      expect(src).not.toMatch(/api\.(publish|confirm|approve|send)/);
    }
  });
});
