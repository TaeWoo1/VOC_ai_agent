package com.sellerops.review.channel;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.review.channel.dto.AgentReviewAcquisitionTargetView;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionReadinessView;
import com.sellerops.review.channel.dto.ChannelReviewAcquisitionRunResponse;
import com.sellerops.review.channel.dto.StoreIdentityRequest;
import com.sellerops.auth.device.HelperDeviceRepository;
import com.sellerops.responsibility.aside.AsideMarketplaceAccess;
import com.sellerops.responsibility.aside.AsideMarketplaceTarget;
import com.sellerops.responsibility.aside.AsideRecipe;
import com.sellerops.selleraccount.AccountSessionSlot;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.AccountSessionSlotService;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
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
public class ChannelReviewAcquisitionService implements AsideMarketplaceTarget {

    static final String COUPANG = "COUPANG";
    static final Duration REF_TTL = Duration.ofMinutes(10);

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final AccountSessionSlotRepository slots;
    private final AccountSessionSlotService slotService;
    private final HelperDeviceRepository helperDevices;
    private final ChannelReviewAcquisitionRefRepository refs;
    private final CredentialVault vault;
    private final AsideMarketplaceAccess marketplaceAccess;

    public ChannelReviewAcquisitionService(SellerAccountRepository accounts, ChannelRepository channels,
                                           AccountSessionSlotRepository slots,
                                           AccountSessionSlotService slotService,
                                           HelperDeviceRepository helperDevices,
                                           ChannelReviewAcquisitionRefRepository refs,
                                           CredentialVault vault,
                                           AsideMarketplaceAccess marketplaceAccess) {
        this.accounts = accounts;
        this.channels = channels;
        this.slots = slots;
        this.slotService = slotService;
        this.helperDevices = helperDevices;
        this.refs = refs;
        this.vault = vault;
        this.marketplaceAccess = marketplaceAccess;
    }

    /**
     * <b>Which store an unattended run reads, for a recipe that reads a marketplace at all.</b>
     *
     * <p>This class implements the seam rather than a new one being written beside it, and that is the point:
     * {@link #expectedStoreFingerprint} is the single statement of «which store is this account», and a second
     * copy for the scheduled lane is the copy that would go stale. The scheduled run therefore gets the SAME
     * expectation the seller-pressed run gets, derived the same way, from the same two places in the same order.
     *
     * <p><b>Exactly one named account, or nothing.</b> The candidates are this org's non-file-upload accounts on
     * the recipe's channel, filtered by the deployment's account allow-list. Anything but a single survivor is
     * empty — no account, none named, or two named — because a run that cannot say WHICH store it would read
     * must not read one, and picking the oldest would answer a question nobody asked.
     *
     * <p>Connection status is deliberately not a condition. This lane reads the seller's own authenticated
     * screen and calls no Coupang API, which was measured on an account that never completed an OpenAPI
     * connection (evidence 2026-09-14); requiring CONNECTED here would refuse a read that demonstrably works.
     * The expectation may then be absent, and absent is a stop downstream rather than a pass.
     */
    @Override
    @Transactional
    public Optional<Target> resolve(UUID orgId, AsideRecipe recipe) {
        if (orgId == null || recipe == null || !recipe.readsMarketplace()) {
            return Optional.empty();
        }
        String channelCode = recipe.channelCode().orElse(null);
        if (!readsReviewsFromScreen(channelCode)) {
            // A recipe naming a channel this service does not read from a screen resolves to nothing, rather
            // than to this service's own channel. Refusing beats substituting.
            return Optional.empty();
        }
        if (!marketplaceAccess.allows(recipe, orgId)) {
            return Optional.empty();
        }
        Map<UUID, String> codeByChannel = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getCode, (a, b) -> a));
        List<SellerAccount> named = accounts.findAllByOrgId(orgId).stream()
                .filter(a -> !a.isFileUpload())
                .filter(a -> channelCode.equals(codeByChannel.get(a.getChannelId())))
                .filter(a -> marketplaceAccess.allowsAccount(a.getId()))
                .toList();
        if (named.size() != 1) {
            return Optional.empty();
        }
        SellerAccount account = named.get(0);
        // Find-or-create, exactly as the pressed lane does at mint: the handoff resolves the account BY slot, so
        // a run whose account has never been given one would read a page and have no route to hand it back.
        String slot = slotService.resolveSlot(orgId, account.getId(), account.getChannelId());
        return Optional.of(new Target(account.getId(), slot, expectedStoreFingerprint(orgId, account)));
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
        return new ChannelReviewAcquisitionReadinessView(
                readinessOf(account, channel, helperLinked(orgId),
                        expectedStoreFingerprint(orgId, account) != null).name(),
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
        if (!readsReviewsFromScreen(channel.getCode())) {
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
     * <b>Does this channel's reviews come off the seller's own screen?</b>
     *
     * <p>The first condition of {@link #readinessOf}, asked of a channel instead of an account — and it
     * is the SAME comparison, not a copy. The channel list needs it because a seller who has connected
     * nothing yet has no account to ask about, and the screen that lists channels is exactly where they
     * are standing when they need to be told this lane exists (First External Seller Gate, 2026-09-14).
     */
    public static boolean readsReviewsFromScreen(String channelCode) {
        return COUPANG.equals(channelCode);
    }

    /**
     * Is a helper linked to this org — the fact this condition's NAME has always claimed.
     *
     * <p><b>It used to ask whether the account had a session slot, and that was a dead end.</b> A slot is
     * an opaque per-account identifier that is minted on FIRST USE (`AccountSessionSlotService.getOrCreate`,
     * find-or-create, and the session-slot GET mints one just by being read) — so its absence says nothing
     * about a helper and everything about whether some other screen has happened to ask for it yet. On a
     * seller who connected a browser and nothing else it never had: measured live 2026-09-14 on a fresh
     * account whose helper card read 연결됨 while this same service answered {@code HELPER_NOT_LINKED},
     * under a sentence that told them to connect the helper they had just connected, beside a button that
     * went to a page which cannot mint a slot. The screen held two answers to one question and showed the
     * one that was not about the helper at all.
     *
     * <p>It is also the same circularity this package's sibling closed for the store identity: a gate must
     * not require a value that only the gated action produces.
     *
     * <p>Org-scoped, because a helper device is linked to an ACCOUNT of reviewnary, not to one marketplace
     * connection — which is exactly what the seller sees on the card above the button.
     */
    private boolean helperLinked(UUID orgId) {
        return helperDevices.existsByOrgIdAndRevokedAtIsNull(orgId);
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
        return new ChannelReviewAcquisitionReadinessView(
                readinessOf(account, channel, helperLinked(orgId),
                        expectedStoreFingerprint(orgId, account) != null).name(),
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
        switch (readinessOf(account, channel, helperLinked(orgId),
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
        // The run identifies its account to the helper by SLOT, so the slot has to exist by the time
        // `resolve` looks for one. Minting it here is find-or-create and grants nothing — the slot is not a
        // capability (`AccountSessionSlotController`), the org still comes from the JWT everywhere it is
        // accepted, and a caller who reaches this line is already authorized for this account. It is minted
        // at the moment the seller asks for a run rather than required beforehand, which is the whole of
        // the repair above.
        slotService.resolveSlot(orgId, account.getId(), account.getChannelId());

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
