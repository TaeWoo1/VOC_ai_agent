package com.sellerops.walkthrough;

/**
 * Operator-tab handshake for the walkthrough. Before the frontend may show the credential form, bootstrap
 * an account, or make any NAVER call, the operator's actual tab posts this to the backend. The
 * {@code walkthroughRunId} is the id carried in the TAB'S URL (not the value read from {@code /context}),
 * so the backend cross-checks its own authoritative run id + approved origin against what the tab carries,
 * and records a sanitized audit that the bound tab reached this runtime. It is a required gate step; the
 * load-bearing binding is the frontend's 3-way run-id match, and this handshake can only refuse the gate.
 *
 * <p>The backend records only sanitized booleans + a timestamp (see {@link Result}); it performs NO DB
 * write. The {@code tabNonce} is a browser-generated opaque value used only to correlate the handshake in
 * logs — it is never persisted and never echoed back.
 */
public final class WalkthroughHandshake {

    public record Request(String walkthroughRunId, String tabNonce, String origin) {
    }

    /** Sanitized handshake outcome — matches only, never the nonce or any identifier. */
    public record Result(boolean runMatched, boolean originMatched, String timestamp) {
    }

    private WalkthroughHandshake() {
    }
}
