package com.sellerops.connector.cafe24.spike;

import java.util.ArrayList;
import java.util.List;

/**
 * Deterministic in-memory {@link SpikeReplyTransport} for spike engine tests. It is
 * stateful: {@code observeArticle} returns the current status (which a successful
 * create flips to {@code statusAfterCreate}), and {@code listComments} returns the
 * current comment list (which a create appends to). Call counters and error/reject
 * injectors let a test drive every branch without touching the network.
 */
final class FakeSpikeReplyTransport implements SpikeReplyTransport {

    // configurable state
    String currentRawStatus = "N";
    String statusAfterCreate = "C";
    int spikeCommentsAddedOnCreate = 1;
    final List<CommentObservation> comments = new ArrayList<>();

    // error injection
    boolean throwTransportOnFirstObserve;
    boolean throwTransportOnCreate;
    boolean rejectOnCreate;
    boolean throwTransportOnListAfter;

    // counters
    int observeCalls;
    int listCalls;
    int createCalls;

    private long nextCommentNo = 1000;

    @Override
    public ArticleObservation observeArticle(String mallId, String accessToken, int boardNo, long articleNo) {
        observeCalls++;
        if (throwTransportOnFirstObserve && observeCalls == 1) {
            throw new SpikeTransportException("TEST_OBSERVE_ERROR");
        }
        return new ArticleObservation(articleNo, boardNo, currentRawStatus);
    }

    @Override
    public List<CommentObservation> listComments(String mallId, String accessToken, int boardNo, long articleNo) {
        listCalls++;
        if (throwTransportOnListAfter && createCalls > 0) {
            throw new SpikeTransportException("TEST_LIST_AFTER_ERROR");
        }
        return List.copyOf(comments);
    }

    @Override
    public CommentObservation createComment(String mallId, String accessToken, int boardNo, long articleNo,
                                            CommentDraft draft) {
        createCalls++;
        if (rejectOnCreate) {
            throw new SpikeCommentRejectedException("TEST_REJECTED");
        }
        if (throwTransportOnCreate) {
            throw new SpikeTransportException("TEST_CREATE_TRANSPORT_ERROR");
        }
        CommentObservation created = null;
        for (int i = 0; i < spikeCommentsAddedOnCreate; i++) {
            created = new CommentObservation(nextCommentNo++, SpikeContentGuard.SPIKE_WRITER_MARKER);
            comments.add(created);
        }
        currentRawStatus = statusAfterCreate;
        return created != null
                ? created
                : new CommentObservation(nextCommentNo++, SpikeContentGuard.SPIKE_WRITER_MARKER);
    }

    /** Seed a foreign (non-spike) comment. */
    void addForeignComment(String writer) {
        comments.add(new CommentObservation(nextCommentNo++, writer));
    }

    /** Seed a pre-existing spike-marker comment (duplicate scenario). */
    void addSpikeComment() {
        comments.add(new CommentObservation(nextCommentNo++, SpikeContentGuard.SPIKE_WRITER_MARKER));
    }
}
