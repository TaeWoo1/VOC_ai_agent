/**
 * **Opaque artifact reference (R4 groundwork).** The sanctioned way to name a detected download on
 * the wire and in the persisted store: a deterministic 16-hex digest of caller-chosen parts,
 * following the collector's deterministic-ID convention (SHA-256 over the JSON array form). The
 * input parts (which may be sensitive — a filename, a run-local marker) are one-way hashed and can
 * never be recovered from the ref, so no filename/path/URL can leak through it. Matches the
 * contract's `artifactRef` shape (`^[0-9a-f]{16}$`), the same opacity rule as target signatures.
 */
import { createHash } from "node:crypto";

export function artifactRefFor(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/**
 * The opaque `artifactRef` shape (`^[0-9a-f]{16}$`) — the single source of truth every consumer
 * validates against before trusting a ref (engine detect-guard, ingest-handoff wire name,
 * quarantine path composition). No `g`/`y` flag, so `.test()` is stateless and safe to share.
 */
export const ARTIFACT_REF_SHAPE = /^[0-9a-f]{16}$/;
