package com.sellerops.inquiry.publish;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.coverage.ChannelCoverageService;
import com.sellerops.coverage.ChannelDataState;
import com.sellerops.coverage.dto.ChannelCoverageRow;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Can SellerOps prove, right now, that it knows this channel's answer state?
 *
 * <p>The stored {@code answered_at}/{@code answer_body} on an inquiry are as old as the last
 * collection. On a channel that is collecting normally that is a few minutes; on a channel that is
 * blocked or merely quiet it can be weeks, and "still unanswered" then means "unanswered the last
 * time we looked". Before the one WRITE in this product, that difference is worth naming: someone may
 * have answered on the marketplace in between, and a second answer to a real customer is not a retry.
 *
 * <p>This asks the existing coverage read — the same three-axis machinery the dashboard uses — for
 * this channel's INQUIRY state, and reduces it to one question. {@link ChannelDataState#OBSERVED_FRESH}
 * and {@link ChannelDataState#ZERO} are the two states that were earned by an observation; everything
 * else (unproven freshness, blocked, not connected, not supported) is not. No new endpoint, no new
 * marketplace call: it reads what collection already recorded.
 */
@Component
public class InquiryTargetStateReader {

    static final String DATA_TYPE = "INQUIRY";

    private final ChannelCoverageService coverage;
    private final ChannelRepository channels;

    public InquiryTargetStateReader(ChannelCoverageService coverage, ChannelRepository channels) {
        this.coverage = coverage;
        this.channels = channels;
    }

    /**
     * {@link PreSendCheck#proven()} when this channel's INQUIRY collection was provably current,
     * otherwise an {@link PreSendCheck#unproven} carrying which of the two ignorances it is: the
     * channel has a state and it is not a fresh one ({@link PreSendCheck#STATE_NOT_FRESH}), or there
     * is no coverage row to read at all ({@link PreSendCheck#STATE_UNKNOWN}).
     *
     * <p>Fails to "unproven", never to an exception: a coverage read that throws must not be able to
     * take down a send the seller already approved — but it must also never be mistaken for a proof.
     */
    public PreSendCheck read(UUID orgId, UUID channelId) {
        String code;
        try {
            code = channels.findById(channelId).map(Channel::getCode).orElse(null);
        } catch (RuntimeException e) {
            return PreSendCheck.unproven(PreSendCheck.STATE_UNKNOWN);
        }
        if (code == null) {
            return PreSendCheck.unproven(PreSendCheck.STATE_UNKNOWN);
        }
        List<ChannelCoverageRow> rows;
        try {
            rows = coverage.coverage(orgId, List.of(code));
        } catch (RuntimeException e) {
            return PreSendCheck.unproven(PreSendCheck.STATE_UNKNOWN);
        }
        return rows.stream()
                .filter(row -> DATA_TYPE.equals(row.dataType()) && code.equals(row.channelCode()))
                .findFirst()
                .map(row -> row.state() == ChannelDataState.OBSERVED_FRESH || row.state() == ChannelDataState.ZERO
                        ? PreSendCheck.proven()
                        : PreSendCheck.unproven(PreSendCheck.STATE_NOT_FRESH))
                .orElseGet(() -> PreSendCheck.unproven(PreSendCheck.STATE_UNKNOWN));
    }
}
