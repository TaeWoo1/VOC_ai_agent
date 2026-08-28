/**
 * **Is a local helper paired with this browser right now?** — a HINT for the conversation runtime.
 *
 * The runtime decides between a guided Action Window path (NAVER export · Coupang WING read) and the
 * file-upload fallback, and it can only decide honestly if it knows whether a helper could host the run.
 * This probe answers with the two facts the bridge client itself uses: the agent answers `/bridge/health`,
 * and this browser holds a pairing token (`BRIDGE_TOKEN_KEY`). Neither is a promise the agent will accept
 * the attach — that is decided at ticket mint — so the answer is a hint, sent as one, and the artifact still
 * renders the pairing panel when the attach is refused.
 *
 * It pairs NOTHING and opens no socket: a health GET with a short timeout, nothing else. Absent `fetch`
 * (a non-browser test environment) or a probe that does not answer in time ⇒ `UNKNOWN`, never a guess.
 */
import type { LocalAgentHint } from "../conversation/types";
import { BRIDGE_TOKEN_KEY } from "./bridgeClient";

const PROBE_TIMEOUT_MS = 1_500;
const CACHE_MS = 30_000;

let cached: { at: number; hint: LocalAgentHint } | null = null;

function bridgeBase(): string {
  const env = import.meta.env as Record<string, unknown>;
  return typeof env.VITE_BRIDGE_URL === "string" ? env.VITE_BRIDGE_URL : "http://127.0.0.1:47615";
}

function hasToken(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(BRIDGE_TOKEN_KEY) != null;
  } catch {
    return false;
  }
}

export async function probeLocalAgent(now = Date.now()): Promise<LocalAgentHint> {
  if (cached && now - cached.at < CACHE_MS) return cached.hint;
  // No pairing token ⇒ this browser has never paired a helper; there is nothing to probe and no reason to
  // put a refused connection in the console on every send. The answer is ABSENT until the seller pairs.
  if (!hasToken()) {
    cached = { at: now, hint: "ABSENT" };
    return "ABSENT";
  }
  if (typeof fetch !== "function" || typeof AbortController !== "function") return "UNKNOWN";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let hint: LocalAgentHint;
  try {
    const res = await fetch(`${bridgeBase()}/bridge/health`, { signal: controller.signal });
    hint = res.ok ? (hasToken() ? "PAIRED" : "ABSENT") : "ABSENT";
  } catch (e) {
    // A timeout is "did not answer", not "not there": the two get different words downstream.
    hint = e instanceof Error && e.name === "AbortError" ? "UNKNOWN" : "ABSENT";
  } finally {
    clearTimeout(timer);
  }
  cached = { at: now, hint };
  return hint;
}

/** Test seam. */
export function resetLocalAgentHintForTests(): void {
  cached = null;
}
