import { describe, expect, it } from "vitest";
import {
  ESM_UPLOAD_FLAG,
  esmUploadApprovalRequiredMessage,
  hasEsmUploadApproval,
} from "../../src/esm/esm-upload-approval";
import { ESM_APPROVAL_FLAG } from "../../src/esm/esm-live-approval";

describe("esm-upload-approval — per-run ESM backend-upload consent gate", () => {
  it("the flag is a DISTINCT upload flag, separate from the live-session flag and NAVER", () => {
    expect(ESM_UPLOAD_FLAG).toBe("--i-understand-this-uploads-esm-review-to-backend");
    expect(ESM_UPLOAD_FLAG).not.toContain("naver");
    // Must not be the same flag as opening a live session — uploading is a separate decision.
    expect(ESM_UPLOAD_FLAG).not.toBe(ESM_APPROVAL_FLAG);
  });

  it("hasEsmUploadApproval is true ONLY when the exact flag is present", () => {
    expect(hasEsmUploadApproval([ESM_UPLOAD_FLAG])).toBe(true);
    expect(hasEsmUploadApproval(["--x", ESM_UPLOAD_FLAG, "--approved-index", "0"])).toBe(true);
  });

  it("hasEsmUploadApproval is false without the flag (incl. only the live-session flag)", () => {
    expect(hasEsmUploadApproval([])).toBe(false);
    expect(hasEsmUploadApproval([ESM_APPROVAL_FLAG])).toBe(false);
    expect(hasEsmUploadApproval(["--i-understand-this-opens-live-naver"])).toBe(false);
  });

  it("the refusal message states the DB-ingest / dual-flag / delete-after-validate discipline", () => {
    const msg = esmUploadApprovalRequiredMessage();
    expect(msg).toMatch(/backend/i);
    expect(msg).toMatch(/DB write|INGESTS/);
    expect(msg).toMatch(/dedup/i);
    expect(msg).toMatch(/delete-after-validate/);
    expect(msg).toContain(ESM_UPLOAD_FLAG);
    expect(msg).toContain(ESM_APPROVAL_FLAG);
  });
});
