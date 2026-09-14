import { bridgeHttpBase, BRIDGE_TOKEN_KEY } from "./bridge/bridgeClient";

/**
 * **Reading the store the helper just saw — over authenticated loopback, and nowhere else.**
 *
 * The canonical rule this implements: a raw store identity is never carried on the shared run contract.
 * During identity bootstrap the paired seller browser may read it over authenticated loopback, and it may
 * be stored on the backend only after the seller has confirmed it.
 *
 * So this asks the helper on this machine, with the pairing bearer the browser already holds. The value
 * never appears on the Action Window run view (whose own contract carries no store identity), never in a
 * log line, and never on the wire to our backend until the seller presses the confirmation.
 *
 * Anything other than a live single candidate is `NONE` or `AMBIGUOUS`, and both mean the same next step:
 * the seller types the code. There is deliberately no list to choose from — asking a seller to arbitrate
 * between two codes we could not read cleanly is not a choice, it is a guess with their name on it.
 */
export type StoreIdentityBootstrap =
  | { state: "CANDIDATE"; value: string }
  | { state: "NONE" }
  | { state: "AMBIGUOUS" };

function pairingBearer(): string | null {
  try {
    return window.localStorage.getItem(BRIDGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * The helper's current bootstrap answer, or null when it could not be asked.
 *
 * Null is not `NONE`: one means "we did not learn anything", the other means "the helper says there is
 * nothing". The caller keeps them apart so a helper that is simply not reachable does not read as a store
 * that could not be seen.
 */
export async function readStoreIdentityBootstrap(): Promise<StoreIdentityBootstrap | null> {
  const bearer = pairingBearer();
  if (!bearer) return null;
  try {
    const r = await fetch(`${bridgeHttpBase()}/bridge/store-identity/bootstrap`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { state?: unknown; value?: unknown };
    if (body.state === "CANDIDATE" && typeof body.value === "string" && body.value.trim() !== "") {
      return { state: "CANDIDATE", value: body.value.trim() };
    }
    if (body.state === "AMBIGUOUS") return { state: "AMBIGUOUS" };
    if (body.state === "NONE") return { state: "NONE" };
    return null;
  } catch {
    return null;
  }
}
