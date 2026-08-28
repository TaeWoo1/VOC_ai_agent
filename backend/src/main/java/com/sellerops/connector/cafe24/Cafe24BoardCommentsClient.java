package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads the comments of ONE Cafe24 board article
 * ({@code GET /api/v2/admin/boards/{board_no}/articles/{article_no}/comments}, scope
 * {@code mall.read_community}).
 *
 * <p><b>Why this exists.</b> On 2026-08-26 a seller answered board-6 article 3674 from the Cafe24
 * admin UI and SellerOps kept showing it as 미답변. The approved bounded READ
 * ({@code apr-c24-a3674-obs}) found the answer: it is a COMMENT
 * ({@code comment_no=39}, {@code member_id == mall_id}), the article's own {@code reply_status}
 * stayed {@code N}, and no child reply article was ever created. Until this client existed the
 * comment lane was not merely mis-read — it was outside every surface SellerOps looked at, so the
 * seller's own answer was invisible by construction.
 *
 * <p><b>Actor, not presence.</b> The reference describes comments as written by "a shopping mall
 * customer <em>or manager</em>" — one resource, two authors — so the existence of a comment proves
 * nothing about who answered. {@code member_id == mall_id} is the platform's own documented
 * 상점명-rendering condition and was measured on this shop's existing answers (43/44) by the
 * 2026-08-25 actor probe. That comparison happens HERE, and only its BOOLEAN leaves: the id is bound
 * on a private wire record and has no field on {@link Cafe24BoardCommentRow}.
 *
 * <p><b>No text, no person.</b> {@code writer}, {@code client_ip}, {@code attach_file_urls} and
 * {@code rating} have no field on any record in this file. {@code content} is bound on the private
 * wire record for ONE purpose — to be hashed — and leaves only as that hash
 * ({@link Cafe24BoardCommentRow#contentHash()}), so a comment's words and its author cannot be
 * persisted later by accident. What the connector needs is "did the shop answer, and when", plus,
 * for the review lane, "is this comment the approved text" — and that is exactly what this returns.
 *
 * <p><b>READ only.</b> The sibling {@code POST}/{@code DELETE} on this resource are not called and
 * not spelled; a structural test asserts their absence.
 */
public class Cafe24BoardCommentsClient {

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24BoardCommentsClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * The comments on one article, projected to structure plus the one actor boolean.
     *
     * @throws Cafe24RateLimitedException on HTTP 429, carrying the official resumption hint
     */
    public List<Cafe24BoardCommentRow> fetchComments(String accessToken, String mallId, int boardNo,
                                                     long articleNo) {
        URI uri = commentsUri(mallId, boardNo, articleNo);
        Cafe24HttpClient.Response response =
                http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() == 404) {
            // An article with no comment resource is an article with no comments. Absence is read as
            // absence and never as an error the caller has to interpret.
            return List.of();
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "카페24 댓글 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parse(response.body(), mallId);
    }

    static URI commentsUri(String mallId, int boardNo, long articleNo) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
        if (articleNo <= 0) {
            throw new IllegalStateException("카페24 article_no 형식이 올바르지 않습니다.");
        }
        return URI.create("https://" + mallId + ".cafe24api.com"
                + "/api/v2/admin/boards/" + boardNo + "/articles/" + articleNo + "/comments");
    }

    /**
     * Is this comment's author the SHOP itself?
     *
     * <p>Identity, compared once, emitted as a boolean. A blank or absent {@code member_id} is an
     * UNKNOWN author and is never read as the shop — the fail-closed direction, because the cost of
     * calling a customer's comment an answer is a real question silently marked handled.
     */
    static boolean authoredByMall(String memberId, String mallId) {
        return memberId != null && !memberId.isBlank() && mallId != null
                && memberId.strip().equalsIgnoreCase(mallId.strip());
    }

    private List<Cafe24BoardCommentRow> parse(String body, String mallId) {
        try {
            CommentsResponse parsed = mapper.readValue(body, CommentsResponse.class);
            List<Cafe24BoardCommentRow> out = new ArrayList<>();
            for (RawComment raw : parsed.comments() == null ? List.<RawComment>of() : parsed.comments()) {
                out.add(new Cafe24BoardCommentRow(raw.commentNo(), raw.articleNo(),
                        raw.createdDate(), authoredByMall(raw.memberId(), mallId),
                        contentHash(raw.content())));
            }
            return List.copyOf(out);
        } catch (Exception e) {
            // The body carries a customer's words — it never reaches a message.
            throw new IllegalStateException("카페24 댓글 응답을 해석할 수 없습니다.");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CommentsResponse(@JsonProperty("comments") List<RawComment> comments) {
    }

    /**
     * The wire shape, private on purpose. {@code member_id} is bound here and nowhere else so it can
     * be COMPARED; it is the only person-shaped key this file names, and it cannot travel out.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawComment(@JsonProperty("comment_no") Long commentNo,
                              @JsonProperty("article_no") Long articleNo,
                              @JsonProperty("created_date") String createdDate,
                              @JsonProperty("member_id") String memberId,
                              @JsonProperty("content") String content) {
    }

    /**
     * The comment's words, reduced to a one-way comparison value and dropped — whitespace collapsed,
     * SHA-256 hex, the same rule {@code Cafe24ReviewCommentAdapter.normalizedHash} applies to the
     * approved draft. Bound here, hashed here; the text has no field on the public row.
     */
    static String contentHash(String content) {
        String normalized = content == null ? "" : content.replaceAll("\\s+", " ").strip();
        try {
            byte[] out = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(normalized.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(out.length * 2);
            for (byte b : out) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
