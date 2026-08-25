package com.sellerops.inquiry.publish.cafe24;

import com.sellerops.connector.cafe24.Cafe24ApiConnector;
import com.sellerops.connector.cafe24.Cafe24Authorizer;
import com.sellerops.connector.cafe24.Cafe24BoardArticleRow;
import com.sellerops.connector.cafe24.Cafe24BoardArticlesClient;
import com.sellerops.connector.cafe24.Cafe24ReplyArticleClient;
import com.sellerops.connector.cafe24.Cafe24WriteApprovalRequired;
import com.sellerops.inquiry.publish.ChannelReplyAdapter;
import com.sellerops.inquiry.publish.ReplyPublishCommand;
import com.sellerops.inquiry.publish.ReplyPublishResult;
import com.sellerops.inquiry.publish.ReplyVerificationCommand;
import com.sellerops.inquiry.publish.ReplyVerificationResult;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The Cafe24 문의 reply adapter — an ANSWER on this channel is an ARTICLE of its own, hanging off the
 * question ({@code parent_article_no}), which is why it is posted rather than patched.
 *
 * <p><b>What it will and will not target.</b> Only a ROOT article: the external id must name a board
 * article, and the caller's own repository must already have decided this row is a customer question.
 * A REPLY row cannot be a target here — answering an answer is not a thing the seller asked for, and
 * the Thread Semantics Recovery exists because those rows were once mistaken for questions.
 *
 * <p><b>One POST, then a READ.</b> A 2xx is not a verified send. Verification re-reads the board and
 * requires four things of the created child — that it exists, that its parent is the approved target,
 * that it is structurally a reply, and that its content hashes to the approved draft — and then
 * observes the PARENT's own answered state, which is the signal SellerOps reads everywhere else.
 *
 * <p><b>Three terminal shapes, and only one of them is done.</b>
 *
 * <ul>
 *   <li><b>A</b> child verified AND parent {@code reply_status=C} &rarr; {@code VERIFIED}.</li>
 *   <li><b>B</b> child verified, parent still {@code N}/{@code P} &rarr;
 *       {@code ANSWER_POSTED_STATUS_UNRESOLVED}. The answer IS on the customer's thread; what is
 *       unresolved is the completion mark. Not a failure, and above all not a reason to POST again.</li>
 *   <li><b>C</b> the child cannot be found or does not match &rarr; {@code DELIVERY_UNKNOWN}.</li>
 * </ul>
 *
 * <p>Case B is a real possibility rather than a defensive branch: the contract accepts
 * {@code reply_status} on the create call and does not say whether setting it marks the PARENT, and
 * the approved observation could not answer that either (every observed child carried a null status
 * while 43 of 44 parents carried {@code C} — a final state, not a proven side effect). No extra,
 * undocumented write is attempted to force the parent's status.
 */
public class Cafe24ChannelReplyAdapter implements ChannelReplyAdapter {

    /** {@code cafe24:b6:a247} — the identity the collector stamps on every board article. */
    private static final Pattern EXTERNAL_ID =
            Pattern.compile("cafe24:b(?<board>[0-9]{1,9}):a(?<article>[0-9]{1,18})");

    /** The signal recorded when the answer landed but the question is not marked answered. */
    public static final String STATUS_UNRESOLVED = "ANSWER_POSTED_STATUS_UNRESOLVED";

    private final Cafe24ReplyArticleClient writeClient;
    private final Cafe24BoardArticlesClient readClient;
    private final Cafe24Authorizer authorizer;
    private final Cafe24AnswerExecutionGrant grant;
    private final String clientIp;

    public Cafe24ChannelReplyAdapter(Cafe24ReplyArticleClient writeClient,
                                     Cafe24BoardArticlesClient readClient,
                                     Cafe24Authorizer authorizer,
                                     Cafe24AnswerExecutionGrant grant,
                                     String clientIp) {
        this.writeClient = writeClient;
        this.readClient = readClient;
        this.authorizer = authorizer;
        this.grant = grant;
        this.clientIp = clientIp == null ? "" : clientIp.strip();
    }

    @Override
    public String channelCode() {
        return Cafe24ApiConnector.CHANNEL_CODE;
    }

    @Override
    public ReplyPublishResult publish(ReplyPublishCommand command) {
        Target target = Target.parse(command.externalId());
        if (target == null) {
            return ReplyPublishResult.retryableFailure();   // no reply target we can name
        }
        // The seller has to have agreed to this specific permission. Absent, nothing is sent — and it
        // stays RETRYABLE because the same approved draft becomes sendable the moment they consent.
        if (!grant.hasWriteGrant(command.orgId(), command.sellerAccountId())) {
            return ReplyPublishResult.retryableFailure();
        }
        // A deployment fact, not a credential and not the seller's problem. Same reasoning: nothing
        // was sent, so the reply is not burned.
        if (clientIp.isEmpty()) {
            return ReplyPublishResult.retryableFailure();
        }
        String body = command.body();
        String title = command.targetSubject();
        if (body == null || body.isBlank() || title == null || title.isBlank()) {
            return ReplyPublishResult.retryableFailure();
        }
        if (title.strip().length() > Cafe24ReplyArticleClient.TITLE_MAX) {
            // Refused rather than truncated: a cut title is a different post from the question's.
            return ReplyPublishResult.permanentFailure(null);
        }

        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(command.orgId(), command.sellerAccountId());
        } catch (RuntimeException e) {
            return ReplyPublishResult.retryableFailure();
        }

        Cafe24ReplyArticleClient.Outcome outcome;
        try {
            outcome = writeClient.post(auth.accessToken(), auth.mallId(),
                    new Cafe24ReplyArticleClient.ReplyArticle(target.boardNo(), target.articleNo(),
                            title.strip(), body, auth.mallId(), auth.mallId(), clientIp));
        } catch (Cafe24WriteApprovalRequired unarmed) {
            // An unarmed deployment must look like an unarmed deployment, never like Cafe24 refusing.
            return ReplyPublishResult.retryableFailure();
        } catch (RuntimeException failure) {
            // Body assembly refused a missing value, or the transport was unusable. Nothing left.
            return ReplyPublishResult.retryableFailure();
        }

        return switch (outcome.kind()) {
            // The provider reference is the created article number when the mall named one, and the
            // target's own number when it did not — never a fabricated handle.
            case ACCEPTED -> ReplyPublishResult.confirmed(
                    String.valueOf(outcome.createdArticleNo() == null
                            ? target.articleNo() : outcome.createdArticleNo()));
            case REJECTED -> ReplyPublishResult.permanentFailure(outcome.httpStatus());
            case RETRYABLE -> ReplyPublishResult.retryableFailure();
            case UNKNOWN -> ReplyPublishResult.deliveryUnknown();
        };
    }

    @Override
    public ReplyVerificationResult verify(ReplyVerificationCommand command) {
        Target target = Target.parse(command.externalId());
        if (target == null) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        Cafe24Authorizer.Authorized auth;
        try {
            auth = authorizer.authorize(command.orgId(), command.sellerAccountId());
        } catch (RuntimeException e) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        List<Cafe24BoardArticleRow> rows;
        try {
            rows = readClient.fetchByArticleNumbers(auth.accessToken(), auth.mallId(),
                    target.boardNo(), List.of(target.articleNo()));
        } catch (RuntimeException e) {
            // A verification that could not run has disproved nothing.
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        Cafe24BoardArticleRow parent = rows.stream()
                .filter(r -> r.articleNo() != null && r.articleNo() == target.articleNo())
                .findFirst().orElse(null);
        if (parent == null) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        return ReplyVerificationResult.notCompleted(answeredSignal(parent));
    }

    /**
     * Verify a specific created child against the approved draft, then read the parent's state.
     *
     * <p>Separate from {@link #verify} because it needs the created article's number and the approved
     * body, neither of which the channel-neutral verification command carries. It is the shape the
     * live proof will use, and it is written now so the four conditions are fixed before anything is
     * ever sent.
     */
    public ReplyVerificationResult verifyCreated(String accessToken, String mallId, Target target,
                                                 long createdArticleNo, String approvedBody) {
        List<Long> ask = new ArrayList<>();
        ask.add(target.articleNo());
        ask.add(createdArticleNo);
        List<Cafe24BoardArticleRow> rows;
        try {
            rows = readClient.fetchByArticleNumbers(accessToken, mallId, target.boardNo(), ask);
        } catch (RuntimeException e) {
            return ReplyVerificationResult.notCompleted("UNVERIFIABLE");
        }
        Cafe24BoardArticleRow child = row(rows, createdArticleNo);
        Cafe24BoardArticleRow parent = row(rows, target.articleNo());
        // (1) the child exists, (2) its parent is the approved target, (3) it is structurally a reply,
        // (4) its content is the approved draft. Any miss is DELIVERY_UNKNOWN — Case C.
        if (child == null || parent == null
                || child.parentArticleNo() == null || child.parentArticleNo() != target.articleNo()
                || !child.isThreadReply()
                || !normalizedHash(child.content()).equals(normalizedHash(approvedBody))) {
            return ReplyVerificationResult.notCompleted("DELIVERY_UNKNOWN");
        }
        String signal = answeredSignal(parent);
        return "ANSWERED".equals(signal)
                ? ReplyVerificationResult.completed(signal)          // Case A
                : ReplyVerificationResult.notCompleted(STATUS_UNRESOLVED);  // Case B
    }

    private static Cafe24BoardArticleRow row(List<Cafe24BoardArticleRow> rows, long articleNo) {
        return rows.stream()
                .filter(r -> r.articleNo() != null && r.articleNo() == articleNo)
                .findFirst().orElse(null);
    }

    /** The parent's own answered state — {@code reply_status=C} and nothing else means answered. */
    private static String answeredSignal(Cafe24BoardArticleRow parent) {
        String status = parent.replyStatus() == null ? "" : parent.replyStatus().strip();
        return "C".equalsIgnoreCase(status) ? "ANSWERED" : STATUS_UNRESOLVED;
    }

    /**
     * A body reduced to a comparison value. Whitespace is collapsed because a board may re-wrap what
     * it stores; nothing else is normalized, because a change to the words is a change to the answer.
     * The hash is what gets compared — the text is never logged, returned, or stored.
     */
    static String normalizedHash(String body) {
        String normalized = body == null ? "" : body.replaceAll("\\s+", " ").strip();
        try {
            byte[] out = MessageDigest.getInstance("SHA-256")
                    .digest(normalized.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(out.length * 2);
            for (byte b : out) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** The board and article an external id names, or null when it names something else. */
    public record Target(int boardNo, long articleNo) {

        public static Target parse(String externalId) {
            if (externalId == null) {
                return null;
            }
            Matcher m = EXTERNAL_ID.matcher(externalId);
            if (!m.matches()) {
                return null;
            }
            try {
                int board = Integer.parseInt(m.group("board"));
                long article = Long.parseLong(m.group("article"));
                return board > 0 && article > 0 ? new Target(board, article) : null;
            } catch (NumberFormatException e) {
                return null;
            }
        }
    }
}
