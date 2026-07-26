/**
 * The sanitized scope-evidence value — how a guided run's exported scope was established.
 *
 * A zero-import leaf so it can be shared by BOTH the network layer (`../upload`, which sends it to the backend)
 * AND the browser drivers (which only pass it through). The drivers must never import `../upload` — their
 * source guards forbid it — so the shared type lives here instead of in the upload client.
 *
 * `MACHINE_MATCHED` means the runtime read the selected range back and it matched; `OPERATOR_CONFIRMED` means
 * the seller attested to it because it could not be read. The engine is the single authority that decides which
 * one a run records (see `import-engine.ts` `onScopeRead`); everything else only carries the value.
 */
export type ScopeEvidenceWire = "MACHINE_MATCHED" | "OPERATOR_CONFIRMED";
