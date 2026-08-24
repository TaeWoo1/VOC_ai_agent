package com.sellerops.coverage;

/**
 * Whether one channel's data of one type can be spoken about as CURRENT — the freshness axis.
 *
 * <p><b>A third axis, and deliberately not a merge.</b> {@code AttentionCoverage} answers "can these
 * rows be attributed to this scope"; {@code KnowledgeCoverage} answers "do we hold this fact and how
 * old is it". Neither can answer "does this channel still tell us what is happening", and folding the
 * question into either would put a capability gap and a broken credential under the same word — which
 * is exactly the mistake this enum exists to make impossible.
 *
 * <p><b>The mistake, concretely.</b> On 2026-08-24 NAVER 문의 was live-proven on two official
 * resources (18 REAL rows, 100% product attribution) and, hours later, its first routine run was
 * refused at token issuance. Both facts are true at once. A runtime with one word for "no data" would
 * have to choose between calling NAVER 문의 unsupported — disproven that morning — and calling
 * 18-row-old data current. It is neither, and {@link #OBSERVED_FRESHNESS_UNPROVEN} is the word for
 * that.
 *
 * <p><b>{@link #ZERO} is the scarcest value here.</b> "이 채널에 문의가 없습니다" is a claim about the
 * world, and only a channel that is connected, supported, and actually collecting can make it. Every
 * other state means we do not know, and saying "없습니다" from any of them is the false calm this
 * repository has now spent three enums refusing.
 */
public enum ChannelDataState {

    /** Connected, routine collection is armed, and we hold rows. What we have can be called current. */
    OBSERVED_FRESH,

    /**
     * We hold rows, and we cannot prove they are current.
     *
     * <p>Routine collection is not armed, or is armed and has not succeeded recently. The rows are
     * real and may be cited — with their own dates — but no sentence may imply this is today's state.
     */
    OBSERVED_FRESHNESS_UNPROVEN,

    /** A measured zero: fresh collection is running and it found nothing. The only honest "없습니다". */
    ZERO,

    /** The channel does not offer this data type at all (NAVER 리뷰, NAVER TalkTalk 문의). */
    NOT_SUPPORTED,

    /** The channel offers it; this org has no connected account on the channel. */
    NOT_CONNECTED,

    /**
     * Connected and supported, and something is in the way — reauth required, or collection stopped.
     *
     * <p>Distinct from {@link #NOT_CONNECTED} because the remedy differs and the seller can tell the
     * difference: one is "연결해 주세요", the other is "연결이 끊겼습니다".
     */
    BLOCKED;

    /** True when a zero or an absence here may NOT be reported as "없습니다". */
    public boolean cannotProveAbsence() {
        return this != ZERO;
    }

    /** True when rows from this state may be cited at all (with their own dates). */
    public boolean hasObservations() {
        return this == OBSERVED_FRESH || this == OBSERVED_FRESHNESS_UNPROVEN;
    }
}
