package com.sellerops.inquiry.publish;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.inquiry.publish.cafe24.Cafe24AnswerExecutionGrant;
import com.sellerops.inquiry.publish.dto.Cafe24AnswerExecutionView;
import com.sellerops.inquiry.publish.dto.InquiryReplyCapabilityView;
import com.sellerops.inquiry.publish.dto.PublishCapabilityView;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only publish-capability status. A separate base path ({@code /api/inquiry-publish})
 * so it never collides with {@code /api/inquiries/{workItemId}}.
 *
 * <p>Exists so an orchestration client (the agent runtime) can verify — fail closed —
 * that the external reply-send path is disabled before it drives an approval. It reflects
 * the execution flag and the registered reply adapters; when execution is disabled (the
 * default) it reports {@code executionEnabled=false} and no adapters, which is the
 * guarantee that a confirm-publish dispatches nothing. No secret is exposed.
 */
@RestController
@RequestMapping("/api/inquiry-publish")
public class PublishCapabilityController {

    private final ChannelReplyAdapterRegistry adapters;
    private final InquiryReplyCapabilityRegistry audited;
    private final Cafe24AnswerExecutionGrant cafe24Grant;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final boolean executionEnabled;
    private final boolean cafe24AnswerExecutionAvailable;

    public PublishCapabilityController(
            ChannelReplyAdapterRegistry adapters, InquiryReplyCapabilityRegistry audited,
            Cafe24AnswerExecutionGrant cafe24Grant, SellerAccountRepository accounts,
            ChannelRepository channels,
            @Value("${sellerops.inquiry.publish.execution-enabled:false}") boolean executionEnabled,
            @Value("${sellerops.connector.cafe24.oauth.answer-execution-scopes:}") String cafe24AnswerScopes) {
        this.adapters = adapters;
        this.audited = audited;
        this.cafe24Grant = cafe24Grant;
        this.accounts = accounts;
        this.channels = channels;
        this.executionEnabled = executionEnabled;
        this.cafe24AnswerExecutionAvailable = cafe24AnswerScopes != null && !cafe24AnswerScopes.isBlank();
    }

    /**
     * Whether this seller has agreed to let SellerOps post a Cafe24 answer.
     *
     * <p>Org-scoped and boolean-only. It exists so [답변 보내기] can say "권한이 필요합니다" instead of
     * offering a send that the adapter would refuse — a refused send after a confirmation reads to a
     * seller as a broken product, and it burns their attention on something they could have been
     * asked for up front.
     */
    @GetMapping("/cafe24/answer-execution")
    public Cafe24AnswerExecutionView cafe24AnswerExecution(
            @AuthenticationPrincipal AuthPrincipal principal) {
        boolean granted = channels.findByCode(Cafe24ApiConnector.CHANNEL_CODE)
                .flatMap(channel -> accounts.findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(
                        principal.orgId(), channel.getId(), false))
                .map(SellerAccount::getId)
                .map(id -> cafe24Grant.hasWriteGrant(principal.orgId(), id))
                .orElse(false);
        return new Cafe24AnswerExecutionView(cafe24AnswerExecutionAvailable, granted);
    }

    /**
     * The audited transport per channel (and per NAVER source subtype) — what is KNOWN, as opposed to
     * what is currently WIRED.
     *
     * <p>The two differ and the difference matters to a screen. {@code /capability} answers "can this
     * deployment send right now" (execution flag + registered adapters); this answers "is there a way
     * to send at all, and how do we know". A channel can be DIRECT_API here and absent there because
     * the flag is off, and a seller reading only the first would conclude the channel cannot be
     * answered.
     */
    @GetMapping("/transports")
    public List<InquiryReplyCapabilityView> transports() {
        return audited.all();
    }

    @GetMapping("/capability")
    public PublishCapabilityView capability() {
        List<String> codes = new ArrayList<>(adapters.registeredChannelCodes());
        codes.sort(String::compareTo);
        return new PublishCapabilityView(executionEnabled, codes);
    }
}
