package com.sellerops.connector.cafe24.spike;

import java.util.UUID;

/**
 * Produces a {@link SpikeAuthorization} for a spike seller account — a fresh access
 * token plus the closed-vocabulary "was write granted?" answer. Deliberately a
 * separate seam from the production {@code Cafe24Authorizer}: the spike consents to
 * read + write against a disposable spike credential, never the production one.
 */
public interface SpikeAuthorizer {

    SpikeAuthorization authorizeForSpike(UUID orgId, UUID spikeAccountId);
}
