/**
 * **Review Target Binding v1 — offline end-to-end proof.** A synthetic review body → its
 * `review-body-fingerprint/v1` value → a REAL owner-only 0600 result bundle → `loadResultBundle` → a guided
 * run assembled THROUGH `assembleReplyRun` → driven to `OPERATOR_REPORTED`, matched against a fixture row
 * that bears the SAME fingerprint. No browser, no NAVER, no live selector. Two negatives guard the seams: a
 * fingerprint mismatch fails closed, and a stale (expired) bundle never assembles a run.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProhibitedFields,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
} from "../../../../contracts/action-window/v2/index";
import { createLoopbackChannel, type AwServerFrame } from "../../../../contracts/action-window/v2/transport";
import {
  assembleReplyRun,
  makeReplyRunMarker,
  mintReplyRunId,
} from "../../../src/action-window/reply-submission/reply-dispatch";
import { loadReplyRun } from "../../../src/action-window/reply-submission/reply-run-store";
import {
  REPLY_FIXTURE_CANARIES,
  rowsFingerprintMismatchDriver,
  rowsPresentDriverFor,
} from "../../../src/action-window/reply-submission/reply-fixture";
import { reviewBodyFingerprint } from "../../../src/action-window/reply-submission/review-body-fingerprint";
import {
  hintFrom,
  loadResultBundle,
  ReplyTargetBundleError,
  writeResultBundle,
  type BundleReadDeps,
  type BundleWriteDeps,
  type ReplyTargetResultBundle,
} from "../../../src/action-window/reply-submission/reply-target-bundle";

const REAL_READ: BundleReadDeps = { existsSync, statSync, readFileSync };
const REAL_WRITE: BundleWriteDeps = { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync };
const TODAY = "2026-05-12";
const SUBMISSION_REF = "a1b2c3d4e5f60718";
const SYNTHETIC_BODY = "합성 리뷰 본문: 배송이 늦어 아쉬웠습니다 (연락 010-1234-5678)";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function newDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function bundleFor(fingerprint: string, over: Partial<ReplyTargetResultBundle> = {}): ReplyTargetResultBundle {
  return {
    submissionRef: SUBMISSION_REF,
    rating: 2,
    recencyBucket: "THIS_WEEK",
    bodyFingerprint: fingerprint,
    asOfDate: TODAY,
    ...over,
  };
}

function harness(runId: string, targetHint: ReturnType<typeof hintFrom>, driver: ReturnType<typeof rowsPresentDriverFor>, persistDir: string) {
  const { client, server } = createLoopbackChannel();
  const { session } = assembleReplyRun(server, {
    runId,
    channelCode: "naver",
    submissionRef: SUBMISSION_REF,
    targetHint,
    mode: "FULL_SUBMIT",
    createDriver: () => driver,
    persistDir,
    now: makeReplyRunMarker(),
  });
  session.attach();
  const frames: AwServerFrame[] = [];
  client.subscribe((f) => frames.push(f));
  const latestView = (): ActionWindowRunView | undefined => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i]!;
      if (f.kind === "aw_view") return f.view;
    }
    return undefined;
  };
  const send = (type: "START_RUN" | "REQUEST_STEP_RECHECK", expectedRevision: number) =>
    client.send({
      kind: "aw_command",
      command: {
        protocolVersion: 2,
        commandId: `c-${type}-${expectedRevision}`,
        runId,
        expectedRevision,
        type,
        ...(type === "START_RUN"
          ? { payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: SUBMISSION_REF } }
          : {}),
      },
    });
  return { session, frames, latestView, send };
}

describe("Review Target Binding v1 — bundle → guided terminal (offline)", () => {
  it("a real 0600 bundle drives a guided run to OPERATOR_REPORTED against a row bearing the same fingerprint", async () => {
    const targetDir = newDir("reply-target-");
    const bundlePath = join(targetDir, "hint.json");
    const fingerprint = reviewBodyFingerprint(SYNTHETIC_BODY);

    // Write the REAL owner-only 0600 bundle, then read it back exactly as the reply CLI would (today's KST).
    writeResultBundle(bundlePath, bundleFor(fingerprint), REAL_WRITE);
    expect(statSync(bundlePath).mode & 0o077).toBe(0); // owner-only

    const loaded = loadResultBundle(bundlePath, REAL_READ, TODAY);
    expect(loaded).not.toBeNull();
    const hint = hintFrom(loaded!);
    expect(hint.bodyFingerprint).toBe(fingerprint);

    const persistDir = newDir("reply-runs-");
    const runId = mintReplyRunId();
    const driver = rowsPresentDriverFor(hint.bodyFingerprint);
    const { session, frames, latestView, send } = harness(runId, hint, driver, persistDir);

    send("START_RUN", 0);
    await session.whenSettled();
    expect(latestView()?.status).toBe("WAITING_FOR_HUMAN");
    expect(latestView()?.currentStep?.stepNumber).toBe(2); // open_review_row barrier (guided plan = 3 steps)
    expect(latestView()?.progress.totalSteps).toBe(3);

    driver.applyRowOpen(true); // operator opens the review's reply control (observed, not clicked by us)
    await session.whenSettled();
    expect(latestView()?.currentStep?.stepNumber).toBe(3); // user_reply_submit barrier (composer)

    driver.applySubmit(true); // operator pastes + posts the approved reply themselves
    await session.whenSettled();
    send("REQUEST_STEP_RECHECK", latestView()!.revision);
    await session.whenSettled();

    expect(latestView()?.status).toBe("OPERATOR_REPORTED");

    // Every frame is a valid, sanitized v2 frame; nothing prohibited crosses the wire.
    for (const f of frames) {
      if (f.kind === "aw_event") expect(validateEventEnvelope(f.event), f.event.type).toEqual({ ok: true });
      if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
    }
    expect(findProhibitedFields(frames)).toEqual([]);

    // No canary, the raw body, or the fingerprint crosses the wire OR the persisted .reply-runs record.
    const wire = JSON.stringify(frames);
    for (const canary of REPLY_FIXTURE_CANARIES) expect(wire, `leaked ${canary}`).not.toContain(canary);
    expect(wire).not.toContain(fingerprint);
    expect(wire).not.toContain(SYNTHETIC_BODY);
    const record = loadReplyRun(persistDir, runId);
    expect(record?.stage).toBe("OPERATOR_REPORTED");
    const recordJson = JSON.stringify(record);
    expect(recordJson).not.toContain(fingerprint);
    expect(recordJson).not.toContain(SYNTHETIC_BODY);

    // Single-use: consume the bundle like the reply CLI and confirm it is gone.
    unlinkSync(bundlePath);
    expect(existsSync(bundlePath)).toBe(false);
  });

  it("a fingerprint mismatch between the hint and the row fails closed (TARGET_NOT_FOUND)", async () => {
    const hintFp = reviewBodyFingerprint(SYNTHETIC_BODY);
    const rowFp = reviewBodyFingerprint("전혀 다른 합성 본문");
    expect(hintFp).not.toBe(rowFp);

    const persistDir = newDir("reply-runs-");
    const runId = mintReplyRunId();
    // The hint targets hintFp; the page row (same rating+recency) carries rowFp — only the fingerprint differs.
    const driver = rowsFingerprintMismatchDriver(hintFp, rowFp);
    const { session, latestView, frames, send } = harness(
      runId,
      { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: hintFp },
      driver,
      persistDir,
    );

    send("START_RUN", 0);
    await session.whenSettled();

    expect(latestView()?.status).toBe("FAILED");
    expect(JSON.stringify(frames)).toContain("TARGET_NOT_FOUND"); // machine blocker code, safe on the wire
  });

  it("a bundle whose KST as-of date is not today is rejected EXPIRED before any run is assembled", () => {
    const targetDir = newDir("reply-target-");
    const bundlePath = join(targetDir, "hint.json");
    writeResultBundle(bundlePath, bundleFor(reviewBodyFingerprint(SYNTHETIC_BODY), { asOfDate: "2026-05-11" }), REAL_WRITE);

    expect(() => loadResultBundle(bundlePath, REAL_READ, TODAY)).toThrow(ReplyTargetBundleError);
    try {
      loadResultBundle(bundlePath, REAL_READ, TODAY);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as ReplyTargetBundleError).code).toBe("EXPIRED");
    }
  });
});
