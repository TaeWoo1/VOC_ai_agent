package com.sellerops.review.channel;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.review.channel.dto.AgentReviewAcquisitionTargetView;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionRunResponse;
import com.sellerops.selleraccount.AccountSessionSlot;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Coupang WING 상품평 read, startable from a conversation (Agentic Operating Workspace v2 §A4) —
 * the two halves of {@link ChannelReviewLocateService}, for acquisition instead of locate.
 *
 * <p><b>Mint</b> runs for the seller: COUPANG only, API-mode account only, and only when the account
 * already has a session slot (the handoff resolves the account by slot, so a run with no slot would
 * read the screen and then have no route to hand its reading back — refused here instead of ten
 * seconds later in the seller's browser). <b>Resolve</b> runs for the Local Agent under its own JWT
 * and spends the token once.
 *
 * <p>The run's product is still the existing handoff: bounded, {@code SELLER_CENTER_READ}, the seller
 * turning the pages. Nothing here touches a marketplace.
 */
@Service
public class ChannelReviewAcquisitionService {

    static final String COUPANG = "COUPANG";
    static final Duration REF_TTL = Duration.ofMinutes(10);

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final AccountSessionSlotRepository slots;
    private final ChannelReviewAcquisitionRefRepository refs;

    public ChannelReviewAcquisitionService(SellerAccountRepository accounts, ChannelRepository channels,
                                           AccountSessionSlotRepository slots,
                                           ChannelReviewAcquisitionRefRepository refs) {
        this.accounts = accounts;
        this.channels = channels;
        this.slots = slots;
        this.refs = refs;
    }

    @Transactional
    public ChannelReviewAcquisitionRunResponse mint(UUID orgId, UUID accountId, UUID userId) {
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        if (!COUPANG.equals(channel.getCode())) {
            throw ApiException.badRequest("이 채널에는 화면에서 상품평을 가져오는 기능이 없습니다.");
        }
        if (account.isFileUpload()) {
            throw ApiException.badRequest("파일 업로드 계정에서는 화면 기반 수집을 사용할 수 없습니다.");
        }
        if (slots.findBySellerAccountId(account.getId()).isEmpty()) {
            throw ApiException.conflict("이 계정은 아직 도우미에 연결되지 않아 화면에서 가져올 수 없습니다.");
        }
        ChannelReviewAcquisitionRef row = new ChannelReviewAcquisitionRef();
        row.setOrgId(orgId);
        row.setSellerAccountId(account.getId());
        row.setAcquisitionRef(newRef());
        row.setCreatedBy("SELLER:" + userId);
        Instant now = Instant.now();
        row.setCreatedAt(now);
        row.setExpiresAt(now.plus(REF_TTL));
        return new ChannelReviewAcquisitionRunResponse(refs.save(row).getAcquisitionRef(), COUPANG);
    }

    /** Spend an {@code acquisitionRef}. Every refusal is one 404 — see the locate service for why. */
    @Transactional
    public AgentReviewAcquisitionTargetView resolve(UUID orgId, String acquisitionRef) {
        String ref = acquisitionRef == null ? "" : acquisitionRef.strip();
        if (!ref.matches("[0-9a-f]{16}")) {
            throw ApiException.badRequest("acquisitionRef 형식이 올바르지 않습니다.");
        }
        Instant now = Instant.now();
        if (refs.spend(ref, orgId, now) != 1) {
            throw ApiException.notFound("만료되었거나 이미 사용된 요청입니다.");
        }
        UUID accountId = refs.findByAcquisitionRef(ref)
                .map(ChannelReviewAcquisitionRef::getSellerAccountId)
                .orElseThrow(() -> ApiException.notFound("만료되었거나 이미 사용된 요청입니다."));
        String slot = slots.findBySellerAccountId(accountId)
                .filter(s -> orgId.equals(s.getOrgId()))
                .map(AccountSessionSlot::getAccountSlot)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        return new AgentReviewAcquisitionTargetView(COUPANG, slot);
    }

    private static String newRef() {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
