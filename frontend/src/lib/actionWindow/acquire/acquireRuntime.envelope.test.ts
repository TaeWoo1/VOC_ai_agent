/**
 * **The envelope this runtime puts on the wire, judged by the validator that actually receives it.**
 *
 * This lane was `LIVE_UNPROVEN` and its unit tests were green, because they asserted the envelope against
 * fakes. The engine does not use a fake: `review-acquisition-run-session.ts` calls the **v2**
 * `validateCommandEnvelope`, and `isActionWindowProtocolCompatible` is exact equality — so a runtime stamping
 * the v1 constant is refused `INVALID_ENVELOPE` and no WING read can ever start. Measured live 2026-09-12.
 *
 * So this test imports the real v2 validator and the real runtime, and asserts the one thing a fake cannot:
 * that what this module sends is a command the receiving engine accepts.
 */
import { describe, expect, it } from "vitest";
import { validateCommandEnvelope, ACTION_WINDOW_PROTOCOL_VERSION as V2 } from "../../../../../contracts/action-window/v2/index";
import { createAcquireRuntime } from "./acquireRuntime";
import type { AwClientTransport } from "../contract";

/** A transport that only records — the engine's judgement is the assertion, not a reply. */
function recorder(): { sent: unknown[]; transport: AwClientTransport } {
  const sent: unknown[] = [];
  const transport = {
    send: (frame: unknown) => {
      sent.push(frame);
    },
    subscribe: () => () => {},
  } as unknown as AwClientTransport;
  return { sent, transport };
}

describe("acquire runtime — the START_RUN it sends is one the v2 engine accepts", () => {
  it("a REVIEW_ACQUISITION start validates against the engine's own validator", async () => {
    const { sent, transport } = recorder();
    const runtime = createAcquireRuntime({ transport, runId: "run_6ceaae9ad5c9", channelCode: "coupang" }, { startTimeoutMs: 20 });
    await runtime.start({ intent: "REVIEW_ACQUISITION", acquisitionRef: "0123456789abcdef" }).catch(() => undefined);
    const command = sent.map((f) => (f as { command?: unknown }).command).find(Boolean) as Record<string, unknown> | undefined;
    expect(command, "no command was sent").toBeDefined();
    expect(validateCommandEnvelope(command)).toEqual({ ok: true });
  });

  it("it stamps the version the engine compares against, not the bridge's", async () => {
    const { sent, transport } = recorder();
    const runtime = createAcquireRuntime({ transport, runId: "run_6ceaae9ad5c9", channelCode: "coupang" }, { startTimeoutMs: 20 });
    await runtime.start({ intent: "REVIEW_ACQUISITION", acquisitionRef: "0123456789abcdef" }).catch(() => undefined);
    const command = sent.map((f) => (f as { command?: Record<string, unknown> }).command).find(Boolean)!;
    expect(command.protocolVersion).toBe(V2);
    expect(V2).toBe(2);
  });
});
