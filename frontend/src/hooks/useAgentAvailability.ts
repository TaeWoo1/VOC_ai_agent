import { useEffect, useState } from "react";
import { agentRuntime } from "../lib/agentRuntime/agentClient";

/**
 * Whether the operations agent can be reached right now.
 *
 * Fail-closed by construction: the initial value is `false` and it only ever becomes `true` after
 * the runtime answers. A caller renders the agent's assist action ONLY on `true` — never as a
 * disabled button and never with "준비 중" copy, because a control the seller cannot use is worse
 * than no control, and a "준비 중" label promises a date nobody has set.
 *
 * The agent runtime is a separate-origin service that is frequently not running; this probe is the
 * whole reason the assist action can be offered at all without lying about it.
 */
export function useAgentAvailability(): boolean {
  const [reachable, setReachable] = useState(false);

  useEffect(() => {
    let active = true;
    agentRuntime
      .capabilities()
      .then(() => {
        if (active) {
          setReachable(true);
        }
      })
      .catch(() => {
        // Unreachable, unauthorized, or wrong origin — all the same answer here: do not offer it.
        if (active) {
          setReachable(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return reachable;
}
