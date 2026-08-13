package com.sellerops.collect;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.AgentCredentialHandoffRequest;
import com.sellerops.collect.dto.AgentCredentialHandoffResultView;
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
 * <p><b>Fail-closed order.</b> Slot → org → account → channel guard → channel supports API credentials → no
 * credential already on file → store → verify. Nothing privileged happens before the org scoping, and a request
 * that fails any gate has touched no vault and made no provider call.
 *
 * <p><b>It never overwrites.</b> An account that already has a credential is refused, because replacing a working
 * credential is a different operation with a different safety property — {@code POST /credentials/replace} does it
 * atomically with rollback, so a handoff that silently rotated in place would be the one path that can destroy a
 * seller's working connection with no way back.
 */
@Service
public class AgentCredentialHandoffService {

    /** Safe reason constants. Operator-facing text lives in the thrown message; these travel to the agent. */
    static final String REASON_UNKNOWN_SLOT = "UNKNOWN_ACCOUNT_SLOT";
    static final String REASON_CHANNEL_MISMATCH = "CHANNEL_MISMATCH";
    static final String REASON_UNSUPPORTED_CHANNEL = "UNSUPPORTED_CHANNEL";
    static final String REASON_CREDENTIAL_EXISTS = "CREDENTIAL_ALREADY_STORED";

    private final AccountSessionSlotRepository slots;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final CredentialVault vault;
    private final CollectControlService collect;

    public AgentCredentialHandoffService(AccountSessionSlotRepository slots,
                                         SellerAccountRepository accounts,
                                         ChannelRepository channels,
                                         CredentialVault vault,
                                         CollectControlService collect) {
        this.slots = slots;
        this.accounts = accounts;
        this.channels = channels;
        this.vault = vault;
        this.collect = collect;
    }

    /**
     * Store the handed-off secrets and run the read-only connection check. The response carries a status and a
     * safe reason code; never a secret, a provider body, or the seller-account id the slot stood in for.
     */
    public AgentCredentialHandoffResultView handOff(UUID orgId, UUID actorUserId,
                                                    AgentCredentialHandoffRequest request) {
        UUID sellerAccountId = resolveAccount(orgId, request.accountSlot());
        Channel channel = requireChannelOf(orgId, sellerAccountId);

        // The declared channel is a GUARD against a mixed-up slot, not a routing key — the account's real
        // channel is the one that decides. A mismatch is refused before the vault is touched.
        if (!channel.getCode().equals(request.channelCode())) {
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
                template.connectorClass(), template.authType(), request.secrets(), null, null);
        collect.storeCredential(orgId, sellerAccountId, intake, actorUserId);

        // The same manual, explicit check the operator's own button runs: read-only, no collection, no job.
        ConnectionTestResultView test = collect.testConnection(orgId, sellerAccountId);
        return new AgentCredentialHandoffResultView(true, test.status(), test.reasonCode());
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
