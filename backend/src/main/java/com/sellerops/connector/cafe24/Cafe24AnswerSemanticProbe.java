package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The five read-only requests that answer one product question: <b>when a seller answers a Cafe24
 * board-6 문의, which API resource can SellerOps read the answer back from?</b>
 *
 * <p>This is a DIAGNOSTIC. It collects nothing, stores nothing, and is not reachable from any
 * runtime path — see {@link Cafe24AnswerSemanticProbeRunner} for the double gate.
 *
 * <p><b>Why a probe exists at all.</b> The Admin reference publishes three ways an answer could be
 * represented — a reply ARTICLE ({@code reply_article_no}), a COMMENT, or an urgentinquiry REPLY —
 * and states for none of them which one a given board uses. That question is decidable by reading,
 * because 43 board-6 articles in this org already carry {@code reply_status=C}: the seller's own
 * past answers are on the platform. Reading them touches no unanswered customer inquiry.
 *
 * <p><b>Every projection here discards at the parse boundary.</b> The declared fields are
 * structural — numbers, flags, dates. {@code writer}, {@code writer_email}, {@code member_id},
 * {@code client_ip}, {@code nick_name} and {@code phone} have no field on any record in this file,
 * so they are never materialized. The one exception is deliberate and contained: a body's TEXT is
 * parsed into a method-local record so its LENGTH BUCKET can be computed, and the bucket — never
 * the text — is what leaves the method. "Is the answer body retrievable here" is the question;
 * "what does it say" is not.
 */
public class Cafe24AnswerSemanticProbe {

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24AnswerSemanticProbe(Cafe24HttpClient http) {
        this.http = http;
    }

    // ---------------------------------------------------------------- R1

    /**
     * R1 — the C / P / N structural comparison, in ONE request. The vendored contract states the
     * LIST's {@code article_no} filter accepts a comma-separated set ("You can search multiple item
     * with ,(comma)"), so the three articles are read together rather than three times.
     */
    public ProbeResult<List<ArticleStructure>> articlesByNumber(String accessToken, String mallId,
                                                                int boardNo, List<Long> articleNos) {
        String joined = String.join(",", articleNos.stream().map(String::valueOf).toList());
        URI uri = articlesUri(mallId, boardNo, Map.of("article_no", joined, "limit", "10"));
        return get(uri, accessToken, body -> parseArticles(body));
    }

    // ---------------------------------------------------------------- R2

    /** R2 — the comments on one article. Count and structure only; no comment text leaves here. */
    public ProbeResult<List<CommentStructure>> comments(String accessToken, String mallId,
                                                       int boardNo, long articleNo) {
        URI uri = URI.create(base(mallId) + "/api/v2/admin/boards/" + boardNo + "/articles/"
                + positive(articleNo) + "/comments");
        return get(uri, accessToken, this::parseComments);
    }

    // ---------------------------------------------------------------- R3

    /**
     * R3 — a bounded window of the same board, to see whether a reply ARTICLE hangs off the target.
     * The caller passes a window measured in days, not months: the contract permits a year and this
     * probe asks for a week.
     */
    public ProbeResult<List<ArticleStructure>> articlesInWindow(String accessToken, String mallId,
                                                               int boardNo, LocalDate start,
                                                               LocalDate end, int limit) {
        URI uri = articlesUri(mallId, boardNo, Map.of(
                "start_date", start.toString(), "end_date", end.toString(),
                "limit", Integer.toString(limit)));
        return get(uri, accessToken, body -> parseArticles(body));
    }

    // ---------------------------------------------------------------- R4

    /** R4 — the urgentinquiry reply for the SAME numeric id. A 404 is a result, not a failure. */
    public ProbeResult<List<UrgentReplyStructure>> urgentReply(String accessToken, String mallId,
                                                              long articleNo) {
        URI uri = URI.create(base(mallId) + "/api/v2/admin/urgentinquiry/"
                + positive(articleNo) + "/reply");
        return get(uri, accessToken, this::parseUrgentReplies);
    }

    // ---------------------------------------------------------------- R5

    /**
     * R5 — the same-day urgentinquiry list. Without it, R4's silence cannot be read: "this IS an
     * urgent inquiry and has no reply" and "this was never an urgent inquiry" are different answers
     * that lead to opposite conclusions, and absence alone does not choose between them.
     */
    public ProbeResult<List<UrgentInquiryStructure>> urgentInquiriesOn(String accessToken,
                                                                      String mallId, LocalDate day,
                                                                      int limit) {
        URI uri = URI.create(base(mallId) + "/api/v2/admin/urgentinquiry"
                + "?start_date=" + day + "&end_date=" + day + "&limit=" + limit);
        return get(uri, accessToken, this::parseUrgentInquiries);
    }

    // ---------------------------------------------------------------- plumbing

    private <T> ProbeResult<T> get(URI uri, String accessToken, Parser<T> parser) {
        Cafe24HttpClient.Response response;
        try {
            response = http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
        } catch (RuntimeException e) {
            // The message may carry a URI or a body; neither is repeated.
            return ProbeResult.failed("TRANSPORT_ERROR", 0);
        }
        int status = response.statusCode();
        if (status == 404) {
            return ProbeResult.failed("NOT_FOUND", status);
        }
        if (status == 401 || status == 403) {
            return ProbeResult.failed("UNAUTHORIZED", status);
        }
        if (status == 429) {
            return ProbeResult.failed("RATE_LIMITED", status);
        }
        if (status != 200) {
            return ProbeResult.failed("HTTP_" + status, status);
        }
        try {
            return ProbeResult.ok(parser.parse(response.body()), status);
        } catch (Exception e) {
            // The body carries customer text — it never reaches a message.
            return ProbeResult.failed("UNPARSEABLE", status);
        }
    }

    private interface Parser<T> {
        T parse(String body) throws Exception;
    }

    private URI articlesUri(String mallId, int boardNo, Map<String, String> params) {
        StringBuilder query = new StringBuilder();
        params.forEach((k, v) -> query.append(query.isEmpty() ? "?" : "&").append(k).append('=').append(v));
        return URI.create(base(mallId) + "/api/v2/admin/boards/" + positiveBoard(boardNo)
                + "/articles" + query);
    }

    private static String base(String mallId) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        return "https://" + mallId + ".cafe24api.com";
    }

    private static long positive(long articleNo) {
        if (articleNo <= 0) {
            throw new IllegalStateException("카페24 article_no 형식이 올바르지 않습니다.");
        }
        return articleNo;
    }

    private static int positiveBoard(int boardNo) {
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
        return boardNo;
    }

    // ---------------------------------------------------------------- parsing

    private List<ArticleStructure> parseArticles(String body) throws Exception {
        ArticlesEnvelope envelope = mapper.readValue(body, ArticlesEnvelope.class);
        List<ArticleStructure> out = new ArrayList<>();
        for (RawArticle raw : envelope.articles() == null ? List.<RawArticle>of() : envelope.articles()) {
            out.add(new ArticleStructure(raw.articleNo(), raw.parentArticleNo(), raw.replyStatus(),
                    raw.reply(), raw.replyUserId() != null && !raw.replyUserId().isBlank(),
                    raw.replySequence(), raw.replyDepth(), raw.createdDate(),
                    bucket(raw.title()), bucket(raw.content())));
        }
        return List.copyOf(out);
    }

    private List<CommentStructure> parseComments(String body) throws Exception {
        CommentsEnvelope envelope = mapper.readValue(body, CommentsEnvelope.class);
        List<CommentStructure> out = new ArrayList<>();
        for (RawComment raw : envelope.comments() == null ? List.<RawComment>of() : envelope.comments()) {
            out.add(new CommentStructure(raw.commentNo(), raw.articleNo(), raw.parentCommentNo(),
                    raw.createdDate(), bucket(raw.content())));
        }
        return List.copyOf(out);
    }

    private List<UrgentReplyStructure> parseUrgentReplies(String body) throws Exception {
        UrgentReplyEnvelope envelope = mapper.readValue(body, UrgentReplyEnvelope.class);
        List<RawUrgentReply> raws = envelope.reply() == null ? List.of() : envelope.reply();
        List<UrgentReplyStructure> out = new ArrayList<>();
        for (RawUrgentReply raw : raws) {
            out.add(new UrgentReplyStructure(raw.articleNo(), raw.status(),
                    raw.userId() != null && !raw.userId().isBlank(), raw.count(),
                    raw.createdDate(), raw.method(), bucket(raw.content())));
        }
        return List.copyOf(out);
    }

    private List<UrgentInquiryStructure> parseUrgentInquiries(String body) throws Exception {
        UrgentInquiryEnvelope envelope = mapper.readValue(body, UrgentInquiryEnvelope.class);
        List<RawUrgentInquiry> raws =
                envelope.urgentinquiry() == null ? List.of() : envelope.urgentinquiry();
        List<UrgentInquiryStructure> out = new ArrayList<>();
        for (RawUrgentInquiry raw : raws) {
            out.add(new UrgentInquiryStructure(raw.articleNo(), raw.articleType(), raw.replyStatus(),
                    raw.searchType(), raw.startDate()));
        }
        return List.copyOf(out);
    }

    /**
     * A body becomes a size class and nothing else. This is the only place text is touched, and the
     * only value that leaves is one of four words.
     */
    static String bucket(String text) {
        if (text == null || text.isBlank()) {
            return "NONE";
        }
        int n = text.strip().length();
        if (n <= 50) {
            return "SHORT";
        }
        return n <= 500 ? "MEDIUM" : "LONG";
    }

    // ---------------------------------------------------------------- wire records (private)

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ArticlesEnvelope(@JsonProperty("articles") List<RawArticle> articles) {
    }

    /** Structural fields + the two texts whose LENGTH is measured. No person-shaped field exists. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawArticle(@JsonProperty("article_no") Long articleNo,
                              @JsonProperty("parent_article_no") Long parentArticleNo,
                              @JsonProperty("reply_status") String replyStatus,
                              @JsonProperty("reply") String reply,
                              @JsonProperty("reply_user_id") String replyUserId,
                              @JsonProperty("reply_sequence") Integer replySequence,
                              @JsonProperty("reply_depth") Integer replyDepth,
                              @JsonProperty("created_date") String createdDate,
                              @JsonProperty("title") String title,
                              @JsonProperty("content") String content) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CommentsEnvelope(@JsonProperty("comments") List<RawComment> comments) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawComment(@JsonProperty("comment_no") Long commentNo,
                              @JsonProperty("article_no") Long articleNo,
                              @JsonProperty("parent_comment_no") Long parentCommentNo,
                              @JsonProperty("created_date") String createdDate,
                              @JsonProperty("content") String content) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record UrgentReplyEnvelope(@JsonProperty("reply") List<RawUrgentReply> reply) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawUrgentReply(@JsonProperty("article_no") Long articleNo,
                                  @JsonProperty("status") String status,
                                  @JsonProperty("user_id") String userId,
                                  @JsonProperty("count") Integer count,
                                  @JsonProperty("created_date") String createdDate,
                                  @JsonProperty("method") String method,
                                  @JsonProperty("content") String content) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record UrgentInquiryEnvelope(
            @JsonProperty("urgentinquiry") List<RawUrgentInquiry> urgentinquiry) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawUrgentInquiry(@JsonProperty("article_no") Long articleNo,
                                    @JsonProperty("article_type") String articleType,
                                    @JsonProperty("reply_status") String replyStatus,
                                    @JsonProperty("search_type") String searchType,
                                    @JsonProperty("start_date") String startDate) {
    }

    // ---------------------------------------------------------------- results (public, sanitized)

    /** One article's structure. No writer, no email, no member id, no ip — and no body text. */
    public record ArticleStructure(Long articleNo, Long parentArticleNo, String replyStatus,
                                   String reply, boolean replyUserIdPresent, Integer replySequence,
                                   Integer replyDepth, String createdDate,
                                   String titleBucket, String bodyBucket) {
    }

    public record CommentStructure(Long commentNo, Long articleNo, Long parentCommentNo,
                                   String createdDate, String bodyBucket) {
    }

    public record UrgentReplyStructure(Long articleNo, String status, boolean userIdPresent,
                                       Integer count, String createdDate, String method,
                                       String bodyBucket) {
    }

    public record UrgentInquiryStructure(Long articleNo, String articleType, String replyStatus,
                                         String searchType, String startDate) {
    }

    /** Outcome + payload. A failure carries a category and a status code, never a body. */
    public record ProbeResult<T>(String outcome, int httpStatus, T value) {

        static <T> ProbeResult<T> ok(T value, int status) {
            return new ProbeResult<>("OK", status, value);
        }

        static <T> ProbeResult<T> failed(String outcome, int status) {
            return new ProbeResult<>(outcome, status, null);
        }

        public boolean ok() {
            return "OK".equals(outcome);
        }
    }
}
