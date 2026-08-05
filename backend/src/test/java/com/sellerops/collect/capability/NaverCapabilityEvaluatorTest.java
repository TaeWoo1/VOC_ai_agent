package com.sellerops.collect.capability;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.collect.capability.NaverCapabilityEvaluator.OrderSync;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Exhaustive offline tests of the pure NAVER capability matrix. Every honest-state rule lives in
 * {@link NaverCapabilityEvaluator}, so these assert the whole truth table without Spring or I/O:
 * order read + identity are earned only by a successful first sync, and the three non-order
 * features are fixed policy regardless of sync state.
 */
class NaverCapabilityEvaluatorTest {

    private final UUID accountId = UUID.randomUUID();

    private ConnectionCapabilityView evaluate(boolean credentialPresent, OrderSync sync) {
        return NaverCapabilityEvaluator.evaluate(
                accountId, "NAVER", ChannelStatus.CONNECTED, credentialPresent, sync);
    }

    private ConnectionCapabilityFeature feature(ConnectionCapabilityView view, String key) {
        return view.features().stream()
                .filter(f -> f.feature().equals(key))
                .findFirst()
                .orElseThrow(() -> new AssertionError("missing feature " + key));
    }

    @Test
    void successfulFirstSyncMakesOrderAvailableAndConfirmsIdentity() {
        ConnectionCapabilityView view = evaluate(true, OrderSync.SUCCESS);

        assertThat(view.identityConfirmed()).isTrue();
        assertThat(view.overall()).isEqualTo(NaverCapabilityEvaluator.AVAILABLE);
        assertThat(view.reason()).isNull();
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_SUCCESS);
        ConnectionCapabilityFeature order = feature(view, NaverCapabilityEvaluator.FEATURE_ORDER_READ);
        assertThat(order.state()).isEqualTo(NaverCapabilityEvaluator.AVAILABLE);
        assertThat(order.reason()).isNull();
    }

    @Test
    void partialFirstSyncAlsoCountsAsAvailable() {
        ConnectionCapabilityView view = evaluate(true, OrderSync.PARTIAL);

        assertThat(view.identityConfirmed()).isTrue();
        assertThat(view.overall()).isEqualTo(NaverCapabilityEvaluator.AVAILABLE);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_PARTIAL);
    }

    @Test
    void noSyncYetRequiresFirstSyncAndDoesNotConfirmIdentity() {
        ConnectionCapabilityView view = evaluate(true, OrderSync.NONE);

        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.overall()).isEqualTo(NaverCapabilityEvaluator.NEEDS_ATTENTION);
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_FIRST_SYNC_REQUIRED);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_NONE);
        assertThat(feature(view, NaverCapabilityEvaluator.FEATURE_ORDER_READ).reason())
                .isEqualTo(NaverCapabilityEvaluator.REASON_FIRST_SYNC_REQUIRED);
    }

    @Test
    void failedFirstSyncIsReportedAndBlocksIdentity() {
        ConnectionCapabilityView view = evaluate(true, OrderSync.FAILED);

        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.overall()).isEqualTo(NaverCapabilityEvaluator.NEEDS_ATTENTION);
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_SYNC_FAILED);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_FAILED);
        assertThat(feature(view, NaverCapabilityEvaluator.FEATURE_ORDER_READ).state())
                .isEqualTo(NaverCapabilityEvaluator.NEEDS_ATTENTION);
    }

    @Test
    void runningFirstSyncIsInProgress() {
        ConnectionCapabilityView view = evaluate(true, OrderSync.RUNNING);

        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_SYNC_IN_PROGRESS);
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_RUNNING);
    }

    @Test
    void missingCredentialShortCircuitsOrderAndIdentity() {
        // Even with a SUCCESS sync token, an absent credential fails closed (defensive).
        ConnectionCapabilityView view = evaluate(false, OrderSync.SUCCESS);

        assertThat(view.credentialPresent()).isFalse();
        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.overall()).isEqualTo(NaverCapabilityEvaluator.NEEDS_ATTENTION);
        assertThat(view.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_CREDENTIAL_MISSING);
        assertThat(feature(view, NaverCapabilityEvaluator.FEATURE_ORDER_READ).reason())
                .isEqualTo(NaverCapabilityEvaluator.REASON_CREDENTIAL_MISSING);
        // A stale sync token must not read as "collected" once the credential is gone (LOW-1).
        assertThat(view.firstSyncStatus()).isEqualTo(NaverCapabilityEvaluator.SYNC_STATUS_NONE);
    }

    @Test
    void nonOrderFeaturesAreFixedPolicyRegardlessOfSyncState() {
        for (OrderSync sync : OrderSync.values()) {
            ConnectionCapabilityView view = evaluate(true, sync);

            ConnectionCapabilityFeature reviewImport = feature(view, NaverCapabilityEvaluator.FEATURE_REVIEW_IMPORT);
            assertThat(reviewImport.state()).isEqualTo(NaverCapabilityEvaluator.GUIDED_CONFIRMATION);
            assertThat(reviewImport.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_GUIDED_EXPORT_ONLY);

            ConnectionCapabilityFeature reviewReply = feature(view, NaverCapabilityEvaluator.FEATURE_REVIEW_REPLY);
            assertThat(reviewReply.state()).isEqualTo(NaverCapabilityEvaluator.NOT_ENABLED);
            assertThat(reviewReply.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_REPLY_UNVERIFIED);

            ConnectionCapabilityFeature inquiry = feature(view, NaverCapabilityEvaluator.FEATURE_INQUIRY_READ);
            assertThat(inquiry.state()).isEqualTo(NaverCapabilityEvaluator.INTEGRATION_PENDING);
            assertThat(inquiry.reason()).isEqualTo(NaverCapabilityEvaluator.REASON_INTEGRATION_PENDING);
        }
    }

    @Test
    void alwaysEmitsFourFeaturesWithOrderFirstAndCarriesSanitizedIdentity() {
        ConnectionCapabilityView view = evaluate(true, OrderSync.SUCCESS);

        assertThat(view.features()).hasSize(4);
        assertThat(view.features().get(0).feature()).isEqualTo(NaverCapabilityEvaluator.FEATURE_ORDER_READ);
        assertThat(view.channelCode()).isEqualTo("NAVER");
        assertThat(view.connectionStatus()).isEqualTo("CONNECTED");
        assertThat(view.sellerAccountId()).isEqualTo(accountId);
    }

    @Test
    void nullConnectionStatusIsToleratedInTheView() {
        ConnectionCapabilityView view = NaverCapabilityEvaluator.evaluate(
                accountId, "NAVER", null, true, OrderSync.SUCCESS);
        assertThat(view.connectionStatus()).isNull();
        assertThat(view.identityConfirmed()).isTrue();
    }
}
