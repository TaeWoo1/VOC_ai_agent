// FE-5 — sanitized live-bridge diagnostics (formatter only).
//
// A PURE function that turns already-sanitized FE primitives into the labelled
// rows the DEV-only `BridgeDiagnostics` panel renders. Its whole reason to exist
// is verification: when we later run a real paired local agent, it answers "is the
// Operations UI really on the live Bridge, or did it fall back to the fixture?".
//
// Privacy is structural, not incidental: this function accepts ONLY sanitized
// primitives (source mode, connection literals, booleans, a plain integer
// revision, an already-resolved channel *display label*). It never receives the
// raw `ActionWindowRunView`, so it cannot reach a runId, a raw channelCode, a URL,
// a token, or a wire frame — there is nothing sensitive in scope to leak. Callers
// must pass the display label (via `channelLabel`), never the raw code, and must
// never pass a timestamp or elapsed duration (this panel is deliberately timeless).

import type { SourceConnection } from "./source";
import type { SourceMode } from "./operationsStore";

/** Sanitized primitives the diagnostics panel is built from — never the raw view. */
export interface BridgeDiagnosticsInput {
  sourceMode: SourceMode;
  connection: SourceConnection;
  bridgeModeEnabled: boolean;
  bootAttempted: boolean;
  retryPending: boolean;
  /** Timestamp-free trail of connection literals (oldest → newest), already capped. */
  connectionTrail: SourceConnection[];
  connectionChangeCount: number;
  /** Plain integer revision of the bound run, or null when no run is bound. */
  revision: number | null;
  /** FE-owned channel display label (e.g. "ESM (지마켓·옥션)"), never the raw code;
   *  null when no run is bound. */
  channelLabel: string | null;
  runBound: boolean;
}

/** The three states the panel exists to distinguish. */
export type BridgeVerdict = "live" | "fixture-fallback" | "fixture-demo";

export interface BridgeDiagnosticsField {
  label: string;
  value: string;
}

export interface BridgeDiagnosticsView {
  verdict: BridgeVerdict;
  /** Short Korean label for the verdict (dev chrome, not user-facing copy). */
  verdictLabel: string;
  fields: BridgeDiagnosticsField[];
}

const YES = "예";
const NO = "아니오";
const NONE = "—";

function yesNo(value: boolean): string {
  return value ? YES : NO;
}

/** Last safe transition as "prev → current" (timeless); the current state alone
 *  when there is no prior entry; a dash when the trail is somehow empty. */
function lastTransition(trail: SourceConnection[]): string {
  if (trail.length === 0) return NONE;
  const current = trail[trail.length - 1]!;
  if (trail.length === 1) return current;
  const prev = trail[trail.length - 2]!;
  return `${prev} → ${current}`;
}

function computeVerdict(input: BridgeDiagnosticsInput): BridgeVerdict {
  if (!input.bridgeModeEnabled) return "fixture-demo";
  return input.sourceMode === "bridge" ? "live" : "fixture-fallback";
}

const VERDICT_LABEL: Record<BridgeVerdict, string> = {
  live: "라이브 브리지 사용 중",
  "fixture-fallback": "픽스처로 폴백됨",
  "fixture-demo": "픽스처 데모 (브리지 꺼짐)",
};

/**
 * Build the sanitized diagnostics view. Pure and total: every field draws from a
 * bounded set (the connection/source-mode literals, 예/아니오, integers, "—", and
 * the pre-resolved channel label), so no raw identifier can appear in the output.
 */
export function describeBridgeDiagnostics(input: BridgeDiagnosticsInput): BridgeDiagnosticsView {
  const verdict = computeVerdict(input);
  return {
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    fields: [
      { label: "소스 모드", value: input.sourceMode },
      { label: "연결 상태", value: input.connection },
      { label: "브리지 모드", value: yesNo(input.bridgeModeEnabled) },
      { label: "부트 시도됨", value: yesNo(input.bootAttempted) },
      { label: "재연결 대기", value: yesNo(input.retryPending) },
      { label: "마지막 전이", value: lastTransition(input.connectionTrail) },
      { label: "연결 변경 횟수", value: String(input.connectionChangeCount) },
      { label: "리비전", value: input.revision === null ? NONE : String(input.revision) },
      { label: "채널", value: input.channelLabel ?? NONE },
      { label: "실행 바인딩됨", value: yesNo(input.runBound) },
    ],
  };
}
