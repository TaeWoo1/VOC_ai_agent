package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The ONE write this connector has: {@code POST /api/v2/admin/boards/{board_no}/articles} with
 * {@code reply_article_no}, which is how a Cafe24 board carries an ANSWER to an existing 문의
 * ({@code docs/vendor/cafe24-admin-api/get-boards-articles.md}; representation proven
 * {@code STANDARD_BOARD_REPLY_ARTICLE} by an approved bounded READ).
 *
 * <p><b>One call, and never twice.</b> There is no retry here and no method that could become one.
 * A transport ambiguity — a timeout, a connection dropped after the request left — returns
 * {@link Outcome.Kind#UNKNOWN}, because a reply article may already exist and a second POST would
 * not be a retry, it would be a second answer under a customer's question.
 *
 * <p><b>Two interlocks before a byte leaves.</b> The scope grant is checked by the caller (a mall
 * that never consented to {@code mall.write_community} must not be sent a write at all), and this
 * class refuses any non-offline host without an armed live-run approval id — the code half of
 * {@code docs/sellerops_live_approval_contract.md}, restated for this transport the way the NAVER and
 * Coupang writes each restate it.
 *
 * <p><b>Nothing person-shaped is invented.</b> The body's actor fields come from the caller and are
 * exactly the two the connection already holds ({@code mall_id}) plus one a deployment states
 * ({@code client_ip}); no default fills any of them, and a blank one is refused here rather than
 * sent as an empty string.
 */
public class Cafe24ReplyArticleClient {

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private static final Set<String> LOOPBACK_HOSTS =
            Set.of("localhost", "127.0.0.1", "::1", "[::1]");

    /** The contract's own ceiling on an article subject. Longer is refused, never truncated. */
    public static final int TITLE_MAX = 256;

    private static final Logger log = LoggerFactory.getLogger(Cafe24ReplyArticleClient.class);

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();
    private final String liveApprovalId;

    public Cafe24ReplyArticleClient(Cafe24HttpClient http, String liveApprovalId) {
        this.http = http;
        this.liveApprovalId = liveApprovalId == null ? "" : liveApprovalId.strip();
    }

    /**
     * Everything the create request needs, already decided by {@code Cafe24ReplyRequestShape}.
     *
     * @param shopNo          which shop of the mall the article lives in — <b>observed</b> on the
     *                        target itself by an approved bounded READ, never defaulted here
     * @param boardNo         the board, which travels in the PATH only; it is not a body field
     * @param parentArticleNo the QUESTION this answer hangs off — never another answer
     * @param writer          {@code mall_id}; the contract renders the author as the shop's name when
     *                        {@code memberId} equals it, so this is an internal value, not a name
     * @param memberId        {@code mall_id}
     * @param clientIp        the Action Executor's configured egress address; never looked up
     */
    public record ReplyArticle(int shopNo, int boardNo, long parentArticleNo, String title,
                               String content, String writer, String memberId, String clientIp) {
    }

    /** What the POST did. {@code createdArticleNo} is null when the response did not name one. */
    public record Outcome(Kind kind, Long createdArticleNo, Integer httpStatus) {

        public enum Kind { ACCEPTED, REJECTED, RETRYABLE, UNKNOWN }
    }

    /**
     * Post the reply article. Exactly one request; no retry on any outcome.
     *
     * <p>The created article's number is returned when the response names one. The vendored contract
     * does <b>not</b> document the create response's shape, so this parses it opportunistically and a
     * null is a normal answer rather than a failure — the caller verifies by reading the board, and
     * an id it did not receive is one it must not pretend to have.
     */
    public Outcome post(String accessToken, String mallId, ReplyArticle article) {
        URI uri = uri(mallId, article.boardNo());
        ensureLiveWriteAllowed(uri);
        String body = body(article);
        assertContractShape(body);
        Cafe24HttpClient.Response response;
        try {
            response = http.postJson(uri, Map.of("Authorization", "Bearer " + accessToken), body);
        } catch (RuntimeException e) {
            // The request may or may not have arrived. The one thing that must not happen next is
            // another POST.
            return new Outcome(Outcome.Kind.UNKNOWN, null, null);
        }
        int status = response.statusCode();
        if (status == 200 || status == 201) {
            return new Outcome(Outcome.Kind.ACCEPTED, createdArticleNo(response.body()), status);
        }
        if (status == 429 || status >= 500) {
            // Nothing was created by a rate limit or a gateway error — but a 5xx can also mean the
            // write landed and the response did not. UNKNOWN is the only honest reading of a 5xx.
            return status == 429
                    ? new Outcome(Outcome.Kind.RETRYABLE, null, status)
                    : new Outcome(Outcome.Kind.UNKNOWN, null, status);
        }
        if (status == 401 || status == 403) {
            // The grant is missing or expired: nothing was sent that the mall accepted, and the same
            // approved draft becomes sendable once the seller re-consents.
            return new Outcome(Outcome.Kind.RETRYABLE, null, status);
        }
        // 4xx: the mall refused this body. Re-sending it unchanged would be refused again — so the
        // ONE thing that matters is why, and a refusal whose reason was thrown away costs a second
        // irreversible attempt to learn. Cafe24's error object names the offending field; it is API
        // diagnostics, not seller or customer data, so it is logged and nothing else is.
        log.warn("카페24 답변 등록 거부: status={} 사유={}", status, refusalReason(response.body()));
        return new Outcome(Outcome.Kind.REJECTED, null, status);
    }

    /**
     * The last thing that happens before a byte leaves: the serialized body is read back and its
     * SHAPE checked against the contract, key by key.
     *
     * <p>It exists because two irreversible attempts were spent on shape. A unit test pins the same
     * thing, but a test proves what the code did when the test ran — this proves what is about to be
     * sent, on the one call that cannot be taken back. Both refused shapes are named here explicitly
     * so neither can return through a future edit: the flat body (400) and the singular {@code
     * request} object with {@code board_no} inside it (422).
     *
     * <p>It reads only key names. No value — not the answer's text, not {@code client_ip}, not the
     * mall handle — is compared, logged or carried into the exception message.
     */
    public void assertContractShape(String body) {
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = mapper.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("카페24 답변 요청을 검증할 수 없습니다.");
        }
        Set<String> top = new java.util.LinkedHashSet<>();
        root.fieldNames().forEachRemaining(top::add);
        if (!top.equals(Set.of("shop_no", "requests"))) {
            // Covers the flat body of attempt 1 and the singular `request` of attempt 2 at once.
            throw new IllegalStateException("카페24 답변 요청 봉투가 계약과 다릅니다.");
        }
        if (root.path("shop_no").asInt(0) <= 0) {
            throw new IllegalStateException("카페24 답변 대상 상점 번호가 없습니다.");
        }
        com.fasterxml.jackson.databind.JsonNode requests = root.path("requests");
        if (!requests.isArray() || requests.size() != 1) {
            throw new IllegalStateException("카페24 답변 요청은 한 건이어야 합니다.");
        }
        Set<String> inner = new java.util.LinkedHashSet<>();
        requests.get(0).fieldNames().forEachRemaining(inner::add);
        if (!inner.equals(Set.of("reply_article_no", "title", "content", "writer", "member_id",
                "client_ip", "reply_status"))) {
            // `board_no` landing in here is the 422 half of the correction.
            throw new IllegalStateException("카페24 답변 요청 필드 구성이 계약과 다릅니다.");
        }
    }

    /**
     * Cafe24's own words for the refusal — {@code error.code} / {@code error.message}, and nothing
     * else from the body. A body we cannot parse is reported as unparsable rather than dumped, so a
     * response that unexpectedly echoed the request can never reach a log through here.
     */
    private String refusalReason(String body) {
        try {
            var error = mapper.readTree(body == null ? "" : body).path("error");
            String code = error.path("code").asText("");
            String message = error.path("message").asText("");
            String joined = (code + " " + message).strip();
            return joined.isEmpty() ? "(설명 없음)" : joined;
        } catch (Exception e) {
            return "(해석할 수 없는 응답)";
        }
    }

    /**
     * The request body — only fields {@code Cafe24ReplyRequestShape} classified as sent.
     *
     * <p>Every value is required to be present. A blank {@code writer}, {@code member_id} or
     * {@code client_ip} is a misconfiguration, and sending it as an empty string would put an
     * anonymous author on a customer-visible post rather than failing where someone can see it.
     */
    public String body(ReplyArticle a) {
        require(a.title(), "제목");
        require(a.content(), "본문");
        require(a.writer(), "작성자");
        require(a.memberId(), "회원 식별자");
        require(a.clientIp(), "작성 IP");
        if (a.title().strip().length() > TITLE_MAX) {
            throw new IllegalStateException("카페24 답변 제목이 계약 상한을 넘습니다.");
        }
        if (a.parentArticleNo() <= 0) {
            throw new IllegalStateException("카페24 답변 대상 글 번호가 올바르지 않습니다.");
        }
        if (a.shopNo() <= 0) {
            throw new IllegalStateException("카페24 답변 대상 상점 번호가 없습니다.");
        }
        ObjectNode article = mapper.createObjectNode();
        article.put("reply_article_no", a.parentArticleNo());
        article.put("title", a.title().strip());
        article.put("content", a.content());
        article.put("writer", a.writer().strip());
        article.put("member_id", a.memberId().strip());
        article.put("client_ip", a.clientIp().strip());
        // Accepted on this same call and the only completion lever the contract offers. Whether it
        // lands on the PARENT is unproven — which is why the caller reads the parent back rather
        // than treating a 2xx as "answered".
        article.put("reply_status", "C");
        // `board_no` is deliberately ABSENT from the body. It travels in the PATH. The reference's
        // parameter table marks it Required and mixes path with body in one column; reading that one
        // line as a body field is what put it here, and the official request sample — which this
        // repository has now transcribed — carries no `board_no` inside the envelope.
        //
        // The envelope is `requests`, an ARRAY: this endpoint creates up to 10 objects per call, and
        // the singular `request` object belongs to PUT. Both live POSTs got this wrong in a different
        // way — flat (400), then a singular object (422).
        //
        // `shop_no` is present because it is now OBSERVED. An approved bounded READ of the target
        // itself returned `shop_no=1`; before that this deployment had no provenance for the value
        // and omitted it rather than assert a shop it had never seen.
        ObjectNode root = mapper.createObjectNode();
        root.put("shop_no", a.shopNo());
        root.putArray("requests").add(article);
        try {
            return mapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new IllegalStateException("카페24 답변 요청을 만들 수 없습니다.");
        }
    }

    private static void require(String value, String what) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("카페24 답변에 필요한 값이 없습니다: " + what);
        }
    }

    private Long createdArticleNo(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return null;
        }
        try {
            CreateEnvelope envelope = mapper.readValue(responseBody, CreateEnvelope.class);
            List<Created> created = envelope.articles() == null ? List.of() : envelope.articles();
            return created.size() == 1 ? created.get(0).articleNo() : null;
        } catch (Exception e) {
            // The body carries the answer's own text — it never reaches a message, and an
            // unparseable create response is not a failed create.
            return null;
        }
    }

    static URI uri(String mallId, int boardNo) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
        return URI.create("https://" + mallId + ".cafe24api.com/api/v2/admin/boards/"
                + boardNo + "/articles");
    }

    /** Throws unless this write is either offline or covered by an armed approval id. */
    void ensureLiveWriteAllowed(URI uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        boolean offline = LOOPBACK_HOSTS.contains(host) || host.endsWith(".localhost")
                || host.endsWith(".test") || host.endsWith(".local");
        if (offline) {
            return;
        }
        if (liveApprovalId.isEmpty()) {
            throw new Cafe24WriteApprovalRequired();
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CreateEnvelope(@JsonProperty("articles") List<Created> articles) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Created(@JsonProperty("article_no") Long articleNo) {
    }
}
