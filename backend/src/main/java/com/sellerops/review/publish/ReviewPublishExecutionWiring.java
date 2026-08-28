package com.sellerops.review.publish;

import com.sellerops.connector.cafe24.Cafe24Authorizer;
import com.sellerops.connector.cafe24.Cafe24BoardCommentsClient;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import com.sellerops.inquiry.publish.cafe24.Cafe24AnswerExecutionGrant;
import com.sellerops.review.publish.cafe24.Cafe24ReviewCommentAdapter;
import com.sellerops.review.publish.cafe24.Cafe24ReviewCommentClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the review-reply API lane ONLY when {@code sellerops.review.publish.execution-enabled=true}
 * — and the Cafe24 adapter only when the Cafe24 connector is also on. Off by default no adapter bean
 * exists, {@link ReviewExecutionCapability} answers {@code EXECUTION_DISABLED}, and
 * {@link ReviewReplyExecutionService} refuses before any transport is touched. That absence IS the
 * fail-closed default, exactly as {@code PublishExecutionWiring} arranges it for inquiries.
 *
 * <p>Independent of the inquiry flag on purpose: a deployment that answers inquiries by API has not
 * thereby decided to post review comments.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.review.publish.execution-enabled", havingValue = "true")
public class ReviewPublishExecutionWiring {

    /**
     * The comment write client. {@code live-approval-id} is the environment-binding token of
     * {@code docs/sellerops_live_approval_contract.md}; blank (the default) refuses every real host
     * before a request is built.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
    Cafe24ReviewCommentClient cafe24ReviewCommentClient(
            Cafe24HttpClient http,
            @Value("${sellerops.review.publish.cafe24.live-approval-id:}") String liveApprovalId) {
        return new Cafe24ReviewCommentClient(http, liveApprovalId);
    }

    /**
     * The adapter. {@code shop-no} must be an OBSERVED value (the inquiry lane's observation of this
     * mall is reused by default); 0 refuses, because the contract's default of 1 is the platform's and
     * an unobserved shop must not look like a decided one.
     */
    @Bean
    @ConditionalOnProperty(name = "sellerops.connector.cafe24.enabled", havingValue = "true")
    Cafe24ReviewCommentAdapter cafe24ReviewCommentAdapter(
            Cafe24ReviewCommentClient writeClient, Cafe24BoardCommentsClient readClient,
            Cafe24Authorizer authorizer, Cafe24AnswerExecutionGrant grant,
            @Value("${sellerops.review.publish.cafe24.shop-no:${sellerops.inquiry.publish.cafe24.shop-no:0}}")
            int shopNo) {
        return new Cafe24ReviewCommentAdapter(writeClient, readClient, authorizer, grant, shopNo);
    }
}
