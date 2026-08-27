import { useEffect, useState } from "react";
import { api } from "../lib/apiClient";

/**
 * **Does this deployment have a demo account to open?** — Pilot Runtime Foundation v1 §2.
 *
 * The 「데모 화면 보기」 entry prefills the fixture login `demo@sellerops.ai`. On a deployment that
 * seeded the fixture that is the right control; on a pilot or production deployment it is a pointer
 * at somebody else's account, and until now the decision was made entirely in the browser — the
 * screen could not tell the two apart.
 *
 * <b>It fails closed, and it fails closed while it is still asking.</b> `null` means "not answered
 * yet" and every caller renders the entry only on an explicit `true`, so a slow or unreachable
 * backend shows no way in rather than a way in that does not work. The answer carries one boolean
 * and no account, org or credential.
 */
export function useDemoEntry(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    // Any failure to ask is an answer of no — a rejected request, an unreachable backend, or a
    // client that has no such method at all. There is no state in which not knowing should render
    // a way into an account.
    try {
      api
        .demoEntryConfig()
        .then((c) => alive && setEnabled(!!c?.enabled))
        .catch(() => alive && setEnabled(false));
    } catch {
      setEnabled(false);
    }
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
