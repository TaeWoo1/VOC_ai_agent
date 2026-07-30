/**
 * Identity resolution against the backend — the ONLY way the runtime learns which org a forwarded
 * token belongs to. The runtime never decodes or trusts the JWT itself; it asks the backend, which
 * both VERIFIES the token (an invalid/forged token is rejected there) and returns the org derived
 * from `principal.orgId()`. The HTTP layer uses this to tenant-scope the durable run store, so one
 * operator can never read or shadow another org's run.
 */
import type { UserIdentity } from "./types";

export interface IdentitySpringClient {
  /** GET /api/users/me — verifies the bearer and returns the caller's org/user identity. */
  whoami(): Promise<UserIdentity>;
}
