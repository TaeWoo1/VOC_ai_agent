package com.sellerops.connector.cafe24.capability;

import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.AVAILABLE;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.FEATURE_EXCLUDED;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.FEATURE_INQUIRY;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.FEATURE_INQUIRY_REPLY;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.FEATURE_ISSUE;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.FEATURE_ORDER;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.FEATURE_REVIEW;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.NEEDS_ATTENTION;
import static com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.NOT_ENABLED;
import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import com.sellerops.connector.cafe24.Cafe24BoardDiscovery.ClassifiedBoard;
import com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.AuthProbe;
import com.sellerops.connector.cafe24.capability.Cafe24CapabilityEvaluator.OrderProbe;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Exhaustive offline tests of the capability decision matrix — no I/O, no Spring, no live call. */
class Cafe24CapabilityEvaluatorTest {

    private static final int REVIEW_BOARD = 4;
    private static final int INQUIRY_BOARD = 6;
    private static final int ONE_TO_ONE_BOARD = 9;
    private static final UUID ACCOUNT = UUID.randomUUID();

    private static List<ClassifiedBoard> mappedBoards() {
        return List.of(
                new ClassifiedBoard(REVIEW_BOARD, "구매후기", "board", BoardKind.REVIEW_BEARING),
                new ClassifiedBoard(INQUIRY_BOARD, "문의사항", "board", BoardKind.INQUIRY_BEARING),
                new ClassifiedBoard(ONE_TO_ONE_BOARD, "1:1 맞춤상담", "board", BoardKind.INQUIRY_BEARING));
    }

    private static Cafe24ConnectionCapabilityView eval(
            ChannelStatus status, boolean cred, AuthProbe auth,
            List<ClassifiedBoard> boards, OrderProbe order) {
        return Cafe24CapabilityEvaluator.evaluate(
                ACCOUNT, status, cred, auth, boards, order, REVIEW_BOARD, INQUIRY_BOARD);
    }

    private static String stateOf(Cafe24ConnectionCapabilityView view, String feature) {
        return view.features().stream()
                .filter(f -> f.feature().equals(feature)).findFirst().orElseThrow().state();
    }

    private static String reasonOf(Cafe24ConnectionCapabilityView view, String feature) {
        return view.features().stream()
                .filter(f -> f.feature().equals(feature)).findFirst().orElseThrow().reason();
    }

    @Test
    void fullyVerifiedWhenConnectedAuthorizedMappedAndOrderSynced() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, mappedBoards(), OrderProbe.OK);

        assertThat(view.connectionVerified()).isTrue();
        assertThat(view.overall()).isEqualTo(AVAILABLE);
        assertThat(view.reason()).isNull();
        assertThat(view.credentialDecryptable()).isTrue();
        assertThat(view.identityConfirmed()).isTrue();
        assertThat(stateOf(view, FEATURE_REVIEW)).isEqualTo(AVAILABLE);
        assertThat(stateOf(view, FEATURE_INQUIRY)).isEqualTo(AVAILABLE);
        assertThat(stateOf(view, FEATURE_ORDER)).isEqualTo(AVAILABLE);
        assertThat(stateOf(view, FEATURE_ISSUE)).isEqualTo(AVAILABLE);
    }

    @Test
    void alwaysDeclaresReplyAndOneToOneNotEnabledAndExcludedHidden() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, mappedBoards(), OrderProbe.OK);

        assertThat(stateOf(view, FEATURE_INQUIRY_REPLY)).isEqualTo(NOT_ENABLED);
        assertThat(stateOf(view, FEATURE_EXCLUDED)).isEqualTo(NOT_ENABLED);
        assertThat(view.excludedBoardHidden()).isTrue();
    }

    @Test
    void oneToOneBoardNeverSatisfiesInquiryMapping() {
        // Board 9 (1:1) is classified INQUIRY_BEARING by keyword, but board 6 is absent.
        List<ClassifiedBoard> onlyOneToOne = List.of(
                new ClassifiedBoard(REVIEW_BOARD, "구매후기", "board", BoardKind.REVIEW_BEARING),
                new ClassifiedBoard(ONE_TO_ONE_BOARD, "1:1 맞춤상담", "board", BoardKind.INQUIRY_BEARING));

        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, onlyOneToOne, OrderProbe.OK);

        assertThat(stateOf(view, FEATURE_INQUIRY)).isEqualTo(NEEDS_ATTENTION);
        assertThat(reasonOf(view, FEATURE_INQUIRY))
                .isEqualTo(Cafe24CapabilityEvaluator.REASON_BOARD_MAPPING_MISMATCH);
        assertThat(view.connectionVerified()).isFalse();
    }

    @Test
    void orderReadIsIndependentOfCommunityRead_orderPendingWhileCommunityAvailable() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, mappedBoards(), OrderProbe.NONE);

        // Community proven, but order not yet synced — order must not be inferred from community.
        assertThat(stateOf(view, FEATURE_REVIEW)).isEqualTo(AVAILABLE);
        assertThat(stateOf(view, FEATURE_INQUIRY)).isEqualTo(AVAILABLE);
        assertThat(stateOf(view, FEATURE_ORDER)).isEqualTo(NEEDS_ATTENTION);
        assertThat(reasonOf(view, FEATURE_ORDER))
                .isEqualTo(Cafe24CapabilityEvaluator.REASON_FIRST_SYNC_REQUIRED);
    }

    @Test
    void orderSuccessIsNeverTreatedAsCommunityProof() {
        // Order synced OK, but the live community probe failed — community must stay NEEDS_ATTENTION.
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.AUTH_FAILED, null, OrderProbe.OK);

        assertThat(stateOf(view, FEATURE_ORDER)).isEqualTo(AVAILABLE);
        assertThat(stateOf(view, FEATURE_REVIEW)).isEqualTo(NEEDS_ATTENTION);
        assertThat(stateOf(view, FEATURE_INQUIRY)).isEqualTo(NEEDS_ATTENTION);
        assertThat(view.connectionVerified()).isFalse();
    }

    @Test
    void authFailedAsksToReconnect() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.AUTH_FAILED, null, OrderProbe.OK);

        assertThat(view.credentialDecryptable()).isFalse();
        assertThat(view.identityConfirmed()).isFalse();
        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_RECONNECT_REQUIRED);
    }

    @Test
    void providerErrorAsksToRetryNotReconnect() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.PROVIDER_ERROR, null, OrderProbe.OK);

        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_PROVIDER_ERROR);
        assertThat(view.credentialDecryptable()).isFalse();
    }

    @Test
    void scopeInsufficientIsItsOwnReasonDistinctFromReconnect() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.SCOPE_INSUFFICIENT, null, OrderProbe.OK);

        // A missing permission, not a dead credential — a distinct, non-reconnect reason.
        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_SCOPE_INSUFFICIENT);
        assertThat(view.reason()).isNotEqualTo(Cafe24CapabilityEvaluator.REASON_RECONNECT_REQUIRED);
        assertThat(view.credentialDecryptable()).isFalse();
        assertThat(view.connectionVerified()).isFalse();
    }

    @Test
    void missingCredentialWhenConnected() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, false, AuthProbe.NOT_ATTEMPTED, null, OrderProbe.NONE);

        assertThat(view.credentialPresent()).isFalse();
        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_CREDENTIAL_MISSING);
    }

    @Test
    void reconnectRequiredStatusBlocksEverything() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.RECONNECT_REQUIRED, true, AuthProbe.NOT_ATTEMPTED, null, OrderProbe.OK);

        assertThat(view.overall()).isEqualTo(NEEDS_ATTENTION);
        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_RECONNECT_REQUIRED);
        assertThat(stateOf(view, FEATURE_ORDER)).isEqualTo(NEEDS_ATTENTION);
        assertThat(reasonOf(view, FEATURE_ORDER))
                .isEqualTo(Cafe24CapabilityEvaluator.REASON_RECONNECT_REQUIRED);
    }

    @Test
    void pendingConnectionIsIncomplete() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.PENDING, true, AuthProbe.NOT_ATTEMPTED, null, OrderProbe.NONE);

        assertThat(view.reason()).isEqualTo(Cafe24CapabilityEvaluator.REASON_CONNECTION_INCOMPLETE);
    }

    @Test
    void orderSyncFailedAndRunningReasons() {
        assertThat(reasonOf(eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, mappedBoards(),
                OrderProbe.FAILED), FEATURE_ORDER))
                .isEqualTo(Cafe24CapabilityEvaluator.REASON_SYNC_FAILED);
        assertThat(reasonOf(eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, mappedBoards(),
                OrderProbe.RUNNING), FEATURE_ORDER))
                .isEqualTo(Cafe24CapabilityEvaluator.REASON_SYNC_IN_PROGRESS);
    }

    @Test
    void issueAnalysisNeedsBothVocSources() {
        // Review mapped, inquiry missing -> issue analysis blocked.
        List<ClassifiedBoard> reviewOnly = List.of(
                new ClassifiedBoard(REVIEW_BOARD, "구매후기", "board", BoardKind.REVIEW_BEARING));
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, reviewOnly, OrderProbe.OK);

        assertThat(stateOf(view, FEATURE_ISSUE)).isEqualTo(NEEDS_ATTENTION);
        assertThat(reasonOf(view, FEATURE_ISSUE))
                .isEqualTo(Cafe24CapabilityEvaluator.REASON_NEEDS_VOC_SOURCES);
    }

    @Test
    void viewNeverCarriesConnectionStatusNullSafety() {
        Cafe24ConnectionCapabilityView view =
                eval(ChannelStatus.CONNECTED, true, AuthProbe.OK, mappedBoards(), OrderProbe.OK);
        // Sanity: exactly six features, closed vocabulary, no null feature/state.
        assertThat(view.features()).hasSize(6);
        assertThat(view.features()).allSatisfy(f -> {
            assertThat(f.feature()).isNotBlank();
            assertThat(f.state()).isIn(AVAILABLE, NEEDS_ATTENTION, NOT_ENABLED);
            assertThat(f.label()).isNotBlank();
        });
    }
}
