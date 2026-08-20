package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.AgentCredentialHandoffRequest;
import com.sellerops.collect.dto.AgentCredentialHandoffResultView;
import com.sellerops.collect.dto.CredentialHandoffAuthorizationView;
import com.sellerops.collect.dto.CredentialHandoffAuthorizeRequest;
import com.sellerops.collect.dto.SellerCredentialHandoffRequest;
import com.sellerops.collect.dto.ConnectionTestResultView;
import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialTemplates;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
import com.sellerops.credential.CredentialVault;
import com.sellerops.selleraccount.AccountSessionSlot;
import com.sellerops.selleraccount.AccountSessionSlotRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * **The binding, and nothing but the binding.** It resolves an opaque account slot to a seller account inside the
 * caller's org, guards the channel, and then hands the work to the paths that already existed:
 * {@link CollectControlService#storeCredential} (validate → vault) and {@link CollectControlService#testConnection}
 * (the read-only connector check).
 *
 * <p>No encryption, no storage, no key handling and no connector call happens here. That is deliberate: a second
 * place that knows how to persist a credential is a second place that can persist one wrongly. See
 * {@code docs/coupang_credential_handoff_v1.md} §1 for the full reuse map.
 *
 * <p><b>Fail-closed order.</b> Run interlock → slot → org → account → channel guard → channel supports API
 * credentials → no credential already on file → store → verify. Nothing privileged happens before the org
 * scoping, and a request that fails any gate has touched no vault and made no provider call.
 *
 * <p>The interlock is FIRST on purpose. A single armed live-call approval id says only that SOME run was
 * approved; this path reads three secrets off a seller's screen, so it is armed with the whole identity the
 * operator's grant was bound to — approval, run, commit, phase — used once. See {@link CredentialHandoffArming}.
 *
 * <p>Its one-shot is CLAIMED atomically immediately before the store, not marked after it: checking a flag and
 * acting on it later is a window, and this is the one path where that window costs a second credential.
 *
 * <p><b>It never overwrites.</b> An account that already has a credential is refused, because replacing a working
 * credential is a different operation with a different safety property — {@code POST /credentials/replace} does it
 * atomically with rollback, so a handoff that silently rotated in place would be the one path that can destroy a
 * seller's working connection with no way back.
 */
@Service
public class AgentCredentialHandoffService {

    private static final Logger log = LoggerFactory.getLogger(AgentCredentialHandoffService.class);

    /** Safe reason constants. Operator-facing text lives in the thrown message; these travel to the agent. */
    static final String REASON_UNKNOWN_SLOT = "UNKNOWN_ACCOUNT_SLOT";
    static final String REASON_CHANNEL_MISMATCH = "CHANNEL_MISMATCH";
    static final String REASON_UNSUPPORTED_CHANNEL = "UNSUPPORTED_CHANNEL";
    static final String REASON_CREDENTIAL_EXISTS = "CREDENTIAL_ALREADY_STORED";
    /** The credential is stored; the read-only check could not be run at all (armed-interlock, provider, transport). */
    static final String TEST_STATUS_UNVERIFIED = "UNVERIFIED";
    static final String REASON_VERIFY_ERROR = "VERIFY_ERROR";

    private final AccountSessionSlotRepository slots;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final CredentialVault vault;
    private final CollectControlService collect;
    private final CredentialHandoffArming arming;
    private final CredentialHandoffAuthorizations authorizations;

    public AgentCredentialHandoffService(AccountSessionSlotRepository slots,
                                         SellerAccountRepository accounts,
                                         ChannelRepository channels,
                                         CredentialVault vault,
                                         CollectControlService collect,
                                         CredentialHandoffArming arming,
                                         CredentialHandoffAuthorizations authorizations) {
        this.slots = slots;
        this.accounts = accounts;
        this.channels = channels;
        this.vault = vault;
        this.collect = collect;
        this.arming = arming;
        this.authorizations = authorizations;
    }

    /** A run id is an identity, not a secret; blank and absent are the same thing and both fail the match. */
    private static String trimmedRunId(String runId) {
        return runId == null ? "" : runId.trim();
    }

    /**
     * **The OPERATOR path.** A seated live proof, authenticated with a real seller token, presenting the run
     * binding its grant was armed with out of band. It names the account by opaque slot, exactly as it always
     * has; nothing about this path changed when the product path arrived beside it.
     */
    public AgentCredentialHandoffResultView handOff(UUID orgId, UUID actorUserId,
                                                    AgentCredentialHandoffRequest request) {
        // **FIRST, before anything else.** The interlock asks whether THIS run was approved, at THIS commit, for
        // THIS phase, and has not already spent its one handoff. It runs ahead of the slot resolution so a
        // request from an unapproved run cannot even learn whether a slot exists.
        String refusal = arming.refusalFor(request.runBinding());
        if (refusal != null) {
            log.warn("Coupang credential handoff refused by the run interlock: reason={}", refusal);
            throw ApiException.badRequest(
                    "이 실행은 연결 정보 전달 승인이 확인되지 않아 중단되었습니다. 저장된 것은 없습니다. (" + refusal + ")");
        }
        UUID sellerAccountId = resolveAccount(orgId, request.accountSlot());
        Channel channel = requireChannelOf(orgId, sellerAccountId);
        return storeAndVerify(orgId, actorUserId, sellerAccountId, channel, request.channelCode(),
                request.secrets(), null);
    }

    /**
     * **The PRODUCT path**, and the account comes from ONE place: the capability.
     *
     * The capability was issued for one org, one seller, one account, one channel and one run, and the request
     * that presents it names none of those. That is the point — the resident helper holds no seller identity and
     * has no business holding a seller-account identifier either, and a second source for "which account" is a
     * second thing that can disagree with the first.
     *
     * <p>So there is no slot to resolve and nothing to reconcile: the binding IS the account. What the request
     * still carries is a channel GUARD (checked against the account's real channel, as on the operator path) and
     * the run it belongs to, so a handoff cannot be carried out of the walk that produced the key.
     *
     * <p>The caller is not trusted for org or user either: both come from the same binding, not from the
     * principal the filter derived from it — one read, one source, no chance of the two drifting.
     */
    public AgentCredentialHandoffResultView handOffWithCapability(String capabilityId,
                                                                  SellerCredentialHandoffRequest request) {
        // The PRECISE reason first: absent, unknown, expired, or already used are four different things to tell
        // a seller, and only one of them ("expired") means "press it again".
        String refusal = authorizations.refusalForId(capabilityId);
        if (refusal != null) {
            log.warn("Coupang credential handoff refused by the run interlock: reason={}", refusal);
            throw ApiException.badRequest(
                    "이 실행은 연결 정보 전달 승인이 확인되지 않아 중단되었습니다. 저장된 것은 없습니다. (" + refusal + ")");
        }
        CredentialHandoffAuthorizations.Binding binding = authorizations.liveBindingOf(capabilityId);
        if (binding == null) {
            // Unreachable given the check above; kept because a null here must never become a NullPointerException
            // on a path that is about to touch a vault.
            throw ApiException.badRequest("이 실행은 연결 정보 전달 승인이 확인되지 않아 중단되었습니다. 저장된 것은 없습니다. ("
                    + CredentialHandoffAuthorizations.REASON_UNKNOWN + ")");
        }
        // The run must be the one the capability was issued for. Same seller, same account, a later sitting is
        // still a different handoff.
        if (!binding.runId().equals(trimmedRunId(request.runId()))) {
            log.warn("Coupang credential handoff refused by the run interlock: reason={}",
                    CredentialHandoffAuthorizations.REASON_MISMATCH);
            throw ApiException.badRequest("이 실행은 연결 정보 전달 승인이 확인되지 않아 중단되었습니다. 저장된 것은 없습니다. ("
                    + CredentialHandoffAuthorizations.REASON_MISMATCH + ")");
        }
        Channel channel = requireChannelOf(binding.orgId(), binding.sellerAccountId());
        return storeAndVerify(binding.orgId(), binding.userId(), binding.sellerAccountId(), channel,
                request.channelCode(), request.secrets(), capabilityId);
    }

    /**
     * **Everything both paths share, in one place** — the channel guard, the template, the never-overwrite rule,
     * the atomic claim on the near side of the store, the store, and the read-only verification.
     *
     * <p>One copy, deliberately: a second place that knows how to persist a credential is a second place that
     * can persist one wrongly, and the two callers differ only in how they proved they were allowed to be here.
     *
     * @param capabilityId the seller's one-shot capability, or {@code null} on the operator path — the ONLY
     *                     thing that distinguishes the two from here on, and only for which interlock is spent.
     */
    private AgentCredentialHandoffResultView storeAndVerify(UUID orgId, UUID actorUserId, UUID sellerAccountId,
                                                            Channel channel, String declaredChannelCode,
                                                            java.util.Map<String, String> secrets,
                                                            String capabilityId) {
        boolean sellerPath = capabilityId != null && !capabilityId.isBlank();

        // The declared channel is a GUARD against a mixed-up account, not a routing key — the account's real
        // channel is the one that decides. A mismatch is refused before the vault is touched.
        if (!channel.getCode().equals(declaredChannelCode)) {
            throw ApiException.badRequest("연결하려는 채널이 이 판매 계정의 채널과 다릅니다. (" + REASON_CHANNEL_MISMATCH + ")");
        }

        CredentialTemplate template = CredentialTemplates.find(channel.getCode())
                .orElseThrow(() -> ApiException.badRequest(
                        "이 채널은 API 연결 정보 저장을 지원하지 않습니다. (" + REASON_UNSUPPORTED_CHANNEL + ")"));

        // Never an overwrite — see the class docstring. Checked before the store, so a refused handoff leaves
        // the existing credential untouched rather than rolled back.
        if (vault.hasCredential(orgId, sellerAccountId)) {
            throw ApiException.badRequest(
                    "이미 저장된 연결 정보가 있습니다. 교체는 갱신 절차로 진행해 주세요. (" + REASON_CREDENTIAL_EXISTS + ")");
        }

        // connectorClass / authType are SERVER-derived from the template, exactly as the UI path derives them —
        // the agent sends only the values it read, and never a claim about how they should be stored. Expiry is
        // null (unknown), never an estimate.
        CredentialIntakeRequest intake = new CredentialIntakeRequest(
                template.connectorClass(), template.authType(), secrets, null, null);
        // **CLAIMED here, on the near side of the store, and atomically.** The checks above only READ the
        // one-shot flag, so claiming after the store would leave a window in which two concurrent requests both
        // pass and both store. The unique constraint on `seller_account_id` closes that for ONE account and does
        // nothing for two: two accounts, one grant, two credentials.
        boolean claimed = sellerPath ? authorizations.claim(capabilityId) : arming.claim();
        if (!claimed) {
            String consumedReason = sellerPath
                    ? CredentialHandoffAuthorizations.REASON_CONSUMED
                    : CredentialHandoffArming.REASON_ARMING_CONSUMED;
            log.warn("Coupang credential handoff refused by the run interlock: reason={}", consumedReason);
            throw ApiException.badRequest("이 실행의 연결 정보 전달은 이미 사용되었습니다. 저장된 것은 없습니다. ("
                    + consumedReason + ")");
        }
        try {
            collect.storeCredential(orgId, sellerAccountId, intake, actorUserId);
        } catch (RuntimeException e) {
            // Nothing was stored, so nothing was spent. This is the ONE case that hands a claim back, and it is
            // what keeps "a refusal before the store leaves the handoff retryable" true when the refusal comes
            // from inside the store itself.
            if (sellerPath) {
                authorizations.releaseUnusedClaim(capabilityId);
            } else {
                arming.releaseUnusedClaim();
            }
            throw e;
        }

        // **From here the credential IS stored, and every exit must say so.** A failed VERIFICATION is reported
        // as a stored-but-unverified credential with a safe reason: the store commits on its own, and the check
        // that follows can throw for reasons that have nothing to do with the credential.
        try {
            ConnectionTestResultView test = collect.testConnection(orgId, sellerAccountId);
            return new AgentCredentialHandoffResultView(true, test.status(), test.reasonCode());
        } catch (RuntimeException e) {
            // The exception is NOT echoed: a provider fault can carry a body, and a body is what must not appear.
            log.warn("Coupang credential handoff stored, verification threw: type={}", e.getClass().getSimpleName());
            return new AgentCredentialHandoffResultView(true, TEST_STATUS_UNVERIFIED, REASON_VERIFY_ERROR);
        }
    }

    /**
     * **Issue the one-shot authorization the product path spends**, after checking everything that can be
     * checked before a credential exists to hand over.
     *
     * <p>The gates here are the SAME gates the handoff itself runs, asked early: an unknown slot, a mixed-up
     * channel, a channel with no credential template, and an account that already holds a credential are all
     * refused now rather than at the end — because issuing an authorization that could only ever be refused
     * would send a seller through a barrier, a screen read, and three secrets on a wire to arrive at a "no"
     * that was knowable before any of it.
     *
     * <p>Nothing here weakens the handoff: every one of those gates still runs again at use, against state that
     * may have changed in between. This is an early refusal, never a pre-approval.
     */
    public CredentialHandoffAuthorizationView authorize(UUID orgId, UUID actorUserId,
                                                        CredentialHandoffAuthorizeRequest request) {
        UUID sellerAccountId = resolveAccount(orgId, request.accountSlot());
        Channel channel = requireChannelOf(orgId, sellerAccountId);
        if (!channel.getCode().equals(request.channelCode())) {
            throw ApiException.badRequest("연결하려는 채널이 이 판매 계정의 채널과 다릅니다. (" + REASON_CHANNEL_MISMATCH + ")");
        }
        CredentialTemplates.find(channel.getCode())
                .orElseThrow(() -> ApiException.badRequest(
                        "이 채널은 API 연결 정보 저장을 지원하지 않습니다. (" + REASON_UNSUPPORTED_CHANNEL + ")"));
        if (vault.hasCredential(orgId, sellerAccountId)) {
            throw ApiException.badRequest(
                    "이미 저장된 연결 정보가 있습니다. 교체는 갱신 절차로 진행해 주세요. (" + REASON_CREDENTIAL_EXISTS + ")");
        }
        String id = authorizations.issue(new CredentialHandoffAuthorizations.Binding(
                orgId, actorUserId, sellerAccountId, channel.getCode(), request.runId().trim()));
        if (id == null) {
            // Capacity, not permission. Visible and self-healing as the TTL drains; nothing already issued moves.
            log.warn("Coupang credential handoff authorization refused: reason={}",
                    CredentialHandoffAuthorizations.REASON_AT_CAPACITY);
            throw ApiException.badRequest("잠시 후 다시 시도해 주세요. ("
                    + CredentialHandoffAuthorizations.REASON_AT_CAPACITY + ")");
        }
        // The id is NOT logged — it is the capability. That one was issued, and for which channel, is enough.
        log.info("Coupang credential handoff authorization issued: channel={}", channel.getCode());
        return new CredentialHandoffAuthorizationView(id, CredentialHandoffAuthorizations.TTL.toMillis());
    }

    /**
     * Resolve the opaque slot inside the caller's org. A slot that does not exist and a slot belonging to another
     * org give the SAME answer, so the endpoint cannot be used to probe whether a slot is real.
     */
    private UUID resolveAccount(UUID orgId, String accountSlot) {
        return slots.findByAccountSlot(accountSlot)
                .filter(slot -> orgId.equals(slot.getOrgId()))
                .map(AccountSessionSlot::getSellerAccountId)
                .orElseThrow(() -> ApiException.notFound(
                        "판매 계정을 찾을 수 없습니다. (" + REASON_UNKNOWN_SLOT + ")"));
    }

    /** The account's channel, re-read under org scoping — the slot row is not trusted to name it. */
    private Channel requireChannelOf(UUID orgId, UUID sellerAccountId) {
        SellerAccount account = accounts.findById(sellerAccountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        if (account.isFileUpload()) {
            throw ApiException.badRequest(
                    "이 계정은 파일 업로드 계정이라 API 연결 정보를 저장할 수 없습니다. (" + REASON_UNSUPPORTED_CHANNEL + ")");
        }
        return channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
    }
}
