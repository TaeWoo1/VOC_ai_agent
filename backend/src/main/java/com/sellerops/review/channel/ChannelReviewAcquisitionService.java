package com.sellerops.review.channel;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.review.channel.dto.AgentReviewAcquisitionTargetView;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionReadinessView;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionRunResponse;
import com.sellerops.review.channel.dto.StoreIdentityRequest;
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
    private final CredentialVault vault;

    public ChannelReviewAcquisitionService(SellerAccountRepository accounts, ChannelRepository channels,
                                           AccountSessionSlotRepository slots,
                                           ChannelReviewAcquisitionRefRepository refs,
                                           CredentialVault vault) {
        this.accounts = accounts;
        this.channels = channels;
        this.slots = slots;
        this.refs = refs;
        this.vault = vault;
    }

    /**
     * Whether a screen read can be started for this account, without minting anything.
     *
     * <p>The seller's own screen asks this before drawing a 지금 동기화 they may not be able to press.
     * It is the SAME predicate {@link #mint} enforces — {@link #readinessOf} is the one place the three
     * conditions live, so a panel cannot say 준비됨 over a mint that would refuse.
     */
    @Transactional(readOnly = true)
    public ChannelReviewAcquisitionReadinessView readiness(UUID orgId, UUID accountId) {
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        boolean linked = slots.findBySellerAccountId(account.getId()).isPresent();
        return new ChannelReviewAcquisitionReadinessView(
                readinessOf(account, channel, linked, expectedStoreFingerprint(orgId, account) != null)
                        .name(),
                channel.getCode());
    }

    /**
     * The three preconditions, in one place and in one order.
     *
     * <p>They were written as a throwing sequence inside {@link #mint} and stayed correct there; what
     * they could not do was answer the same question to a screen. A second copy for the read would be
     * two statements of one rule, and the copy is the one that goes stale — so the rule became a pure
     * function and both callers ask it. {@code linked} and {@code storeIdentityKnown} are passed rather
     * than looked up here so the function stays a statement of the rule instead of a set of queries.
     */
    static ScreenReadReadiness readinessOf(SellerAccount account, Channel channel, boolean linked,
                                           boolean storeIdentityKnown) {
        if (!COUPANG.equals(channel.getCode())) {
            return ScreenReadReadiness.CHANNEL_NOT_SUPPORTED;
        }
        if (account.isFileUpload()) {
            return ScreenReadReadiness.FILE_UPLOAD_ACCOUNT;
        }
        if (!linked) {
            return ScreenReadReadiness.HELPER_NOT_LINKED;
        }
        if (!storeIdentityKnown) {
            return ScreenReadReadiness.STORE_IDENTITY_UNKNOWN;
        }
        return ScreenReadReadiness.READY;
    }

    /**
     * The store this account is expected to be, as a fingerprint — or null when we cannot say.
     *
     * <p>One method, two callers: {@link #resolve} hands it to the run as the thing the screen must
     * match, and {@link #readiness} asks only whether it exists.
     *
     * <p><b>The account's own store identity answers first.</b> It is the fact this asks for — which
     * store is this — and it is not a credential. The vault is the fallback, for every account that
     * connected before the column existed and told us their 업체코드 the only way the product then
     * offered: inside the OpenAPI credential form. Nothing was backfilled and nothing needs to be.
     *
     * <p>A vault that cannot be opened (no key, no credential) and a credential with no
     * {@code vendor_id} are the same answer here — we cannot state the expectation — and the difference
     * between them is an operator's diagnosis, not a seller's.
     */
    private String expectedStoreFingerprint(UUID orgId, SellerAccount account) {
        String declared = WingStoreIdentity.fingerprint(account.getStoreIdentity());
        if (declared != null) {
            return declared;
        }
        try {
            return WingStoreIdentity.fingerprint(vault.open(orgId, account.getId()).secrets().get("vendor_id"));
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * Record which store this account is.
     *
     * <p><b>This is the whole browser-only posture.</b> A seller who wants screen collection and nothing
     * else needs an account (the wizard already creates one without a credential), a helper, and this —
     * one non-secret fact about their own store. They do not need OpenAPI keys, because nothing on this
     * path calls the API.
     *
     * <p>No format is invented. A vendor code's shape is Coupang's to decide, and a guess that rejected
     * a real one would be worse than the failure a wrong one already gets: the run stops at the identity
     * check without reading a row, and says so. Whitespace inside is refused because it is always a
     * paste artefact, never a code.
     */
    @Transactional
    public ChannelReviewAcquisitionReadinessView setStoreIdentity(UUID orgId, UUID accountId,
                                                                  StoreIdentityRequest request) {
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        if (!COUPANG.equals(channel.getCode())) {
            throw ApiException.badRequest("이 채널에는 화면에서 상품평을 가져오는 기능이 없습니다.");
        }
        String value = request == null || request.storeIdentity() == null ? "" : request.storeIdentity().strip();
        if (value.isEmpty()) {
            throw ApiException.badRequest("업체코드를 입력해 주세요.");
        }
        if (value.chars().anyMatch(Character::isWhitespace)) {
            throw ApiException.badRequest("업체코드에 공백이 들어갈 수 없습니다.");
        }
        account.setStoreIdentity(value);
        accounts.save(account);
        boolean linked = slots.findBySellerAccountId(account.getId()).isPresent();
        return new ChannelReviewAcquisitionReadinessView(
                readinessOf(account, channel, linked, expectedStoreFingerprint(orgId, account) != null).name(),
                channel.getCode());
    }

    @Transactional
    public ChannelReviewAcquisitionRunResponse mint(UUID orgId, UUID accountId, UUID userId) {
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        // Same three conditions, same order, same sentences — now stated once and thrown here. The
        // HTTP status per condition is unchanged: a channel or account that can never do this is a 400,
        // an account that is merely not linked yet is a 409.
        switch (readinessOf(account, channel, slots.findBySellerAccountId(account.getId()).isPresent(),
                expectedStoreFingerprint(orgId, account) != null)) {
            case CHANNEL_NOT_SUPPORTED ->
                    throw ApiException.badRequest("이 채널에는 화면에서 상품평을 가져오는 기능이 없습니다.");
            case FILE_UPLOAD_ACCOUNT ->
                    throw ApiException.badRequest("파일 업로드 계정에서는 화면 기반 수집을 사용할 수 없습니다.");
            case HELPER_NOT_LINKED ->
                    throw ApiException.conflict("이 계정은 아직 도우미에 연결되지 않아 화면에서 가져올 수 없습니다.");
            // NOT refused. A run with no expectation is how a seller first tells us which store this is:
            // it reads the identity off the screen they have open and drops every row unread
            // (`assertWingStore` answers UNRESOLVED and the driver returns UNREADABLE), so it can collect
            // nothing and prove nothing it should not. Refusing it here would make the bootstrap
            // circular — identity needed to start the run that establishes identity.
            case STORE_IDENTITY_UNKNOWN -> { }
            case READY -> { }
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
        // The expectation, read from the sealed credential this org already gave us. A vault that cannot be
        // opened (no key, no credential) yields no expectation — and no expectation is a stop downstream, not
        // a pass: `assertWingStore` answers UNRESOLVED, never MATCH.
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        return new AgentReviewAcquisitionTargetView(COUPANG, slot, expectedStoreFingerprint(orgId, account));
    }

    private static String newRef() {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
