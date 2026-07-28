/**
 * **Pilot runtime — production import entry (no dev CLI flag).**
 *
 * Until now the guided review-import only ran under two DEV flags (`--action-window-initial-review-import` +
 * `--i-understand-this-opens-live-naver`) and was refused outright in production (`import-mode-gate.ts`). A
 * pilot seller cannot type flags — they double-click an installed launcher. So production import is admitted
 * by a **one-time, on-disk consent** established at install, not by a per-launch flag.
 *
 * What this RELAXES is only the ceremony (flags → a recorded consent). What it PRESERVES is every safety
 * semantic, because those live below this gate, in the driver and the human loop, unchanged:
 *
 *  - the seller performs login / 2FA / CAPTCHA themselves; the agent never types a NAVER credential;
 *  - the runtime highlights and observes — it does not auto-click export, consent, download, or submit;
 *  - a live browser is meant for a seated human. Two things enforce that, and it is worth being precise
 *    about which: (a) the pilot's OWN auto-start is a Startup-FOLDER item, which Windows runs only at an
 *    interactive logon in the seller's own desktop session — so the shipped path is interactive by
 *    construction; and (b) a CI / `SELLEROPS_SCHEDULED` / `SELLEROPS_HEADLESS_AGENT` marker refuses here.
 *    The gap this does NOT close: a THIRD party who wires their own Scheduled Task / Session-0 service that
 *    launches the agent without setting those markers would pass this gate (pairing still fails closed in
 *    Session 0, but the SellerOps-app browser would open). Robust OS interactive-session detection is a
 *    documented follow-up; for v1 the shipped installer only ever creates the interactive Startup item.
 *
 * Fail-closed: production WITHOUT recorded consent refuses and points the seller at the one recovery — finish
 * setup. Pure: the consent record and args/env are inputs, so the whole decision is offline-testable and the
 * dangerous default (import on, no consent) cannot occur.
 */

import { readFileSync } from "node:fs";
import { NON_INTERACTIVE_ENV_KEYS, OTHER_CARRIER_FLAGS, resolveImportMode, type ImportModeDecision } from "../cli/import-mode-gate";

/**
 * The on-disk consent that a production agent hosts guided import under. NOT a credential — it records only
 * that a human, at install, agreed the guided (human-attended) import may run in this agent, and which build
 * they agreed to. Written by the installer / a first-run consent step; read here.
 */
export interface ImportConsentRecord {
  /** True once a human has consented to guided import in this production agent. */
  readonly importEnabled: boolean;
  /** When consent was given (ISO). Diagnostic only. */
  readonly acceptedAt: string;
  /** The agent version consent was given for. Diagnostic only. */
  readonly acceptedVersion: string;
}

/** The fail-closed default: no consent recorded → import stays off. */
export const NO_IMPORT_CONSENT: ImportConsentRecord = { importEnabled: false, acceptedAt: "", acceptedVersion: "" };

/** Parse a consent file's contents. Absent/blank/corrupt → {@link NO_IMPORT_CONSENT} (import stays off). */
export function parseImportConsent(raw: string | null): ImportConsentRecord {
  if (raw === null || raw.trim() === "") return NO_IMPORT_CONSENT;
  try {
    const v = JSON.parse(raw) as Partial<ImportConsentRecord>;
    return {
      importEnabled: v.importEnabled === true,
      acceptedAt: typeof v.acceptedAt === "string" ? v.acceptedAt : "",
      acceptedVersion: typeof v.acceptedVersion === "string" ? v.acceptedVersion : "",
    };
  } catch {
    return NO_IMPORT_CONSENT;
  }
}

/** Read the consent record from a file path (absent/unreadable → fail-closed default). */
export function readImportConsent(path: string): ImportConsentRecord {
  try {
    return parseImportConsent(readFileSync(path, "utf8"));
  } catch {
    return NO_IMPORT_CONSENT;
  }
}

export type ImportBootDecision =
  | { readonly host: true; readonly via: "production_consent" | "dev_flags" }
  | { readonly host: false; readonly reason: ImportBootRefusal };

export type ImportBootRefusal =
  /** Not asked for, on neither path — the ordinary non-import boot. */
  | "NOT_REQUESTED"
  /** Production, but no human consent is recorded — finish setup. */
  | "CONSENT_MISSING"
  /** Production + a CI / scheduled / headless marker — a live browser needs a seated human. */
  | "NON_INTERACTIVE"
  /** Another Action Window carrier flag was also present. */
  | "CARRIER_CONFLICT"
  /** A dev-path refusal (approval flag missing, etc.) — carried through from the dev gate. */
  | "DEV_GATE_REFUSED";

/** True when any non-interactive marker is set (mirrors the dev gate's rule, applied in production too). */
function isNonInteractive(env: NodeJS.ProcessEnv): boolean {
  return NON_INTERACTIVE_ENV_KEYS.some((key) => {
    const v = env[key];
    return v !== undefined && v !== "" && v !== "0" && v !== "false";
  });
}

/**
 * Decide whether this boot hosts the import carrier, over BOTH paths:
 *  - **production** → admitted by recorded consent, no flags; refused (fail-closed) without consent, on a
 *    non-interactive host, or alongside a conflicting carrier flag;
 *  - **dev** → delegates to the unchanged {@link resolveImportMode} (flags still required off production).
 *
 * `via` tells the boot which path admitted it (for a sanitized log line); a refusal carries the reason.
 */
export function decideImportBoot(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  consent: ImportConsentRecord,
): ImportBootDecision {
  if (env.NODE_ENV === "production") {
    // Nothing indicates the seller asked NOT to import here; production import is the pilot's default mode
    // once consent exists. A non-interactive/scheduled host is refused first (no seated human).
    if (isNonInteractive(env)) return { host: false, reason: "NON_INTERACTIVE" };
    if (OTHER_CARRIER_FLAGS.some((flag) => args.includes(flag))) return { host: false, reason: "CARRIER_CONFLICT" };
    if (!consent.importEnabled) return { host: false, reason: "CONSENT_MISSING" };
    return { host: true, via: "production_consent" };
  }
  // Dev: the existing flag gate is unchanged. Map its decision onto ours so the boot has one entry point.
  const dev: ImportModeDecision = resolveImportMode(args, env);
  if (dev.host) return { host: true, via: "dev_flags" };
  return { host: false, reason: dev.reason === "NOT_REQUESTED" ? "NOT_REQUESTED" : "DEV_GATE_REFUSED" };
}

/** Operator/seller-facing reason for a refusal (null for the ordinary non-import boot). */
export function importBootRefusalMessage(reason: ImportBootRefusal): string | null {
  switch (reason) {
    case "NOT_REQUESTED":
      return null;
    case "CONSENT_MISSING":
      return "과거 리뷰 가져오기 사용에 대한 동의가 아직 기록되지 않았어요. 설치(또는 설정)를 마치면 사용할 수 있어요.";
    case "NON_INTERACTIVE":
      return "예약 실행/헤드리스 환경에서는 과거 리뷰 가져오기를 열지 않아요. 로그인한 사용자 화면에서만 진행돼요.";
    case "CARRIER_CONFLICT":
      return "다른 작업 채널과 함께 실행할 수 없어요. 한 번에 하나만 실행하세요.";
    case "DEV_GATE_REFUSED":
      return "개발 모드에서 과거 리뷰 가져오기를 열려면 필요한 승인 플래그가 없어요.";
  }
}
