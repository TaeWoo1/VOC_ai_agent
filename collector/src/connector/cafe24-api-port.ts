/**
 * **Production Cafe24 API connector port** — the FIRST real {@link ApiConnectorPort}.
 *
 * Implements the `API` strategy's auth seam for Cafe24 (OAuth 2.0): a cheap, non-mutating `inspect()` of
 * the STORED authorization state, and an at-most-once `refresh()` that renews authorization ONLY through
 * the supported official flow (the `refresh_token` grant; when that can no longer renew, the fallback is
 * the official authorization-code re-consent, surfaced as a user action — never a browser scrape).
 *
 * **Sanitized boundary.** This module never sees — and this port never returns — a token, `refresh_token`,
 * `client_secret`, `mall_id`/shop id, authorization `code`, `state`, or any callback payload. Both of its
 * dependencies are seams that speak only sanitized enums:
 *  - {@link Cafe24AuthorizationStore} reads the stored authorization as a coarse state enum;
 *  - {@link Cafe24OAuthClient} performs the official refresh and reports only a coarse outcome enum.
 * The live HTTP token call and the encrypted token persistence live behind those seams (their production
 * implementations are a SEPARATE, not-yet-existing slice — see the credential-storage seam note in the
 * connector docs); this module is pure and fully offline-testable with fakes.
 *
 * **Scope.** Auth only. This port NEVER fetches review / order / inquiry data, never uploads, never writes
 * the backend, and has no browser fallback. Generating a {@link SyncIntent} downstream describes the sync
 * that WOULD run; it triggers no fetch.
 */

import type { ApiConnectorPort } from "./api-connector";
import type { ConnectorUserAction } from "./channel-connector";
import type { AuthStatus } from "../connection/sync-state";

/**
 * Sanitized stored-authorization state — token PRESENCE + coarse expiry only. Carries NO token value,
 * `mall_id`/shop id, or secret.
 *  - `VALID`           — a non-expired access token is stored; usable now.
 *  - `ACCESS_EXPIRED`  — the access token expired but a usable refresh token remains (recoverable).
 *  - `REFRESH_EXPIRED` — the refresh token itself expired/near-expiry → official re-authorization needed.
 *  - `NONE`            — never authorized / no stored credential for this connection.
 */
export type Cafe24AuthorizationState = "VALID" | "ACCESS_EXPIRED" | "REFRESH_EXPIRED" | "NONE";

/**
 * Read-only seam over the production credential store. Returns ONLY the sanitized {@link
 * Cafe24AuthorizationState} — never a token, `mall_id`, or secret. **The production implementation (an
 * encrypted token vault / secret store) does not exist yet** and is the outstanding credential-storage seam.
 */
export interface Cafe24AuthorizationStore {
  readAuthorizationState(): Promise<Cafe24AuthorizationState>;
}

/**
 * Sanitized outcome of the official Cafe24 `refresh_token` grant. Carries NO token, `mall_id`, or payload.
 *  - `REFRESHED`                — new tokens were obtained and persisted; authorization is healthy again.
 *  - `REAUTHORIZATION_REQUIRED` — the refresh token is invalid/expired/revoked; the only supported recovery
 *                                 is the official authorization-code re-consent (a human action).
 *  - `TRANSIENT_FAILURE`        — network / 5xx / unexpected; not recovered, retry later (no user action).
 */
export type Cafe24RefreshOutcome = "REFRESHED" | "REAUTHORIZATION_REQUIRED" | "TRANSIENT_FAILURE";

/**
 * Seam over the official Cafe24 OAuth refresh. The ONLY supported renewal is the `refresh_token` grant; the
 * production implementation performs the live token call and persists the rotated tokens, and reports only
 * a sanitized {@link Cafe24RefreshOutcome}. That live implementation is a separate, not-yet-existing slice.
 */
export interface Cafe24OAuthClient {
  refreshAuthorization(): Promise<Cafe24RefreshOutcome>;
}

/** The re-consent action Cafe24 surfaces when the refresh_token grant can no longer renew authorization. */
const CAFE24_REAUTHORIZE: ConnectorUserAction = "REAUTHORIZE_API_ACCESS";

/**
 * The production Cafe24 {@link ApiConnectorPort}. Orchestrates the two sanitized seams into the port
 * contract the generic `ApiChannelConnector` drives:
 *  - `inspect()` maps the stored authorization state onto a channel-agnostic {@link AuthStatus};
 *  - `refresh()` runs the one official refresh and maps its outcome onto the connector's recovery result.
 *
 * It performs no fetch/upload/backend write itself; the seams it calls are auth-only.
 */
export class Cafe24ApiConnectorPort implements ApiConnectorPort {
  constructor(
    private readonly store: Cafe24AuthorizationStore,
    private readonly oauth: Cafe24OAuthClient,
  ) {}

  /** Cheap, non-mutating check of the STORED authorization (no network). */
  async inspect(): Promise<{ authStatus: AuthStatus }> {
    const state = await this.store.readAuthorizationState();
    switch (state) {
      case "VALID":
        return { authStatus: "CONNECTED" };
      case "ACCESS_EXPIRED":
        // A refresh could plausibly recover (a usable refresh token remains).
        return { authStatus: "EXPIRED" };
      case "REFRESH_EXPIRED":
      case "NONE":
        // No usable refresh token — the single refresh attempt will report re-authorization required.
        return { authStatus: "RECONNECT_REQUIRED" };
      default: {
        const _exhaustive: never = state;
        return _exhaustive;
      }
    }
  }

  /** The at-most-once recovery: run the official refresh_token grant and map its sanitized outcome. */
  async refresh(): Promise<{ recovered: boolean; authStatus: AuthStatus; userAction: ConnectorUserAction | null }> {
    const outcome = await this.oauth.refreshAuthorization();
    switch (outcome) {
      case "REFRESHED":
        return { recovered: true, authStatus: "CONNECTED", userAction: null };
      case "REAUTHORIZATION_REQUIRED":
        return { recovered: false, authStatus: "RECONNECT_REQUIRED", userAction: CAFE24_REAUTHORIZE };
      case "TRANSIENT_FAILURE":
        return { recovered: false, authStatus: "UNKNOWN", userAction: null };
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  }
}
