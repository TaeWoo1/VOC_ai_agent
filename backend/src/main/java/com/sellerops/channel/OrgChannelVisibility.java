package com.sellerops.channel;

import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.review.ReviewRepository;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>Which channels a seller's own operations screens must account for</b> — the connectable set
 * PLUS every channel this org actually holds Core data on.
 *
 * <p><b>Why this is not {@link ProductChannels} with a wider list.</b> Four different questions had
 * been answered by one list, and they are not the same question:
 *
 * <ul>
 *   <li><b>Core data presence</b> — does this org hold rows here? (this class)</li>
 *   <li><b>connector availability</b> — can a seller connect this channel? ({@link ProductChannels})</li>
 *   <li><b>Attention support</b> — can the AI pilot run here?
 *       ({@code ReviewTriageChannelCapability}, unchanged)</li>
 *   <li><b>reply / execution capability</b> — can anything be sent?
 *       ({@code SellerAccount} + channel capability, unchanged)</li>
 * </ul>
 *
 * <p>{@link ProductChannels} answers the second and is unchanged: the 2026-08-17 decision that the
 * connectable set is exactly NAVER / Coupang / Cafe24 stands, and nothing here adds a connect
 * affordance, a capability claim or a catalogue entry. What it stops doing is answering the FIRST
 * question, which it was never a list of.
 *
 * <p><b>The defect, measured.</b> {@code POST /api/uploads} is addressed by channel and takes no
 * account, so a manual CSV lands on whatever channel the seller chose — including one the product
 * cannot connect. On 2026-09-13 an org whose only content was one uploaded GMARKET review had
 * {@code GET /api/operations/home} report {@code needsAttentionUndecided: 1} while the rendered Home
 * said 「판매 채널을 연결하면 시작할 수 있습니다」. The backend knew; the channel list had no row for the
 * channel, so the screen could not see what the org held.
 *
 * <p><b>Order is stable and connectable-first.</b> The product's own three keep their order; a
 * data-bearing extra is appended in catalogue order, so a channel never jumps the list by having
 * rows.
 */
@Service
public class OrgChannelVisibility {

    private final ChannelRepository channels;
    private final ReviewRepository reviews;
    private final InquiryRepository inquiries;

    public OrgChannelVisibility(ChannelRepository channels, ReviewRepository reviews,
                                InquiryRepository inquiries) {
        this.channels = channels;
        this.reviews = reviews;
        this.inquiries = inquiries;
    }

    /**
     * The connectable set, plus every channel this org holds reviews or inquiries on.
     *
     * <p>Orders are deliberately not asked: an order row cannot arrive without a connected account
     * (there is no order upload), so it can never name a channel the first two do not.
     */
    @Transactional(readOnly = true)
    public List<String> codesFor(UUID orgId) {
        Set<String> out = new LinkedHashSet<>(ProductChannels.VISIBLE_CODES);
        Set<UUID> holding = new LinkedHashSet<>();
        holding.addAll(reviews.findDistinctChannelIdsByOrgId(orgId));
        holding.addAll(inquiries.findDistinctChannelIdsByOrgId(orgId));
        if (holding.isEmpty()) {
            return List.copyOf(out);
        }
        Map<UUID, String> codeById = new java.util.HashMap<>();
        for (Channel channel : channels.findAll()) {
            codeById.put(channel.getId(), channel.getCode());
        }
        List<String> extra = new ArrayList<>();
        for (Channel channel : channels.findAll()) {
            String code = codeById.get(channel.getId());
            if (code != null && holding.contains(channel.getId()) && !out.contains(code)) {
                extra.add(code);
            }
        }
        out.addAll(extra);
        return List.copyOf(out);
    }
}
