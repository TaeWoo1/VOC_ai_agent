package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Reads one page of a Cafe24 community board's articles
 * ({@code GET https://{mall_id}.cafe24api.com/api/v2/admin/boards/{board_no}/articles})
 * with the Bearer access token. Mirrors {@link Cafe24OrdersClient}'s discipline:
 * the {@link Cafe24HttpClient} is the only network boundary, a 429 becomes a
 * {@link Cafe24RateLimitedException} (carrying the official resumption hint), and
 * no token or response material appears in messages.
 *
 * <p><b>One page only.</b> The caller advances {@code offset} until a short page
 * signals the end. When {@code startDate}/{@code endDate} are supplied they bound
 * the window (for date-range backfill); when null they are omitted (a plain
 * offset sweep). Scope is read-only ({@code mall.read_community}) — this never
 * writes a community post.
 *
 * <p>Endpoint shape, the date-filter parameter names, {@code rating} presence, and
 * the {@code reply_status} tokens are doc-asserted and a live-verification item
 * (PR C). Article bodies are parsed into {@link Cafe24BoardArticleRow} but never
 * logged or placed in any exception message.
 */
public class Cafe24BoardArticlesClient {

    static final String ARTICLES_PATH_PREFIX = "/api/v2/admin/boards/";
    static final String ARTICLES_PATH_SUFFIX = "/articles";

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24BoardArticlesClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * Fetch one page of a board's articles. {@code startDate}/{@code endDate} may
     * be null to omit the window filter.
     *
     * @throws Cafe24RateLimitedException on HTTP 429 from the articles endpoint
     */
    public List<Cafe24BoardArticleRow> fetchPage(String accessToken, String mallId, int boardNo,
                                                 LocalDate startDate, LocalDate endDate,
                                                 int limit, int offset) {
        URI uri = articlesUri(mallId, boardNo, startDate, endDate, limit, offset);
        Map<String, String> headers = Map.of("Authorization", "Bearer " + accessToken);

        Cafe24HttpClient.Response response = http.get(uri, headers);
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "카페24 게시글 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parse(response.body());
    }

    /**
     * Fetch an EXACT set of articles by number — no window, no offset, no sweep.
     *
     * <p>The LIST's {@code article_no} filter accepts a comma-separated set
     * ({@code docs/vendor/cafe24-admin-api/get-boards-articles.md}), which is what makes a bounded
     * reclassification of known rows possible without a date crawl: the caller names the rows it
     * already has and asks the source about those and nothing else. A number the source does not
     * return is simply absent from the result — absence is not a deletion and this method does not
     * turn it into one.
     *
     * @throws Cafe24RateLimitedException on HTTP 429
     */
    public List<Cafe24BoardArticleRow> fetchByArticleNumbers(String accessToken, String mallId,
                                                             int boardNo, List<Long> articleNos) {
        if (articleNos == null || articleNos.isEmpty()) {
            return List.of();
        }
        URI uri = articlesByNumberUri(mallId, boardNo, articleNos);
        Cafe24HttpClient.Response response =
                http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "카페24 게시글 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parse(response.body());
    }

    static URI articlesByNumberUri(String mallId, int boardNo, List<Long> articleNos) {
        requireShape(mallId, boardNo);
        for (Long articleNo : articleNos) {
            if (articleNo == null || articleNo <= 0) {
                // Fail closed: a bad number would silently widen the read to whatever the platform
                // does with a malformed filter.
                throw new IllegalStateException("카페24 article_no 형식이 올바르지 않습니다.");
            }
        }
        String joined = articleNos.stream().map(String::valueOf).collect(Collectors.joining(","));
        String query = "article_no=" + URLEncoder.encode(joined, StandardCharsets.UTF_8)
                + "&limit=" + Math.max(articleNos.size(), 1);
        return URI.create("https://" + mallId + ".cafe24api.com"
                + ARTICLES_PATH_PREFIX + boardNo + ARTICLES_PATH_SUFFIX + "?" + query);
    }

    private static void requireShape(String mallId, int boardNo) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
    }

    static URI articlesUri(String mallId, int boardNo, LocalDate startDate, LocalDate endDate,
                           int limit, int offset) {
        requireShape(mallId, boardNo);
        Map<String, String> params = new LinkedHashMap<>();
        if (startDate != null) {
            params.put("start_date", startDate.toString());
        }
        if (endDate != null) {
            params.put("end_date", endDate.toString());
        }
        params.put("limit", Integer.toString(limit));
        params.put("offset", Integer.toString(offset));
        String query = params.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8)
                        + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        return URI.create("https://" + mallId + ".cafe24api.com"
                + ARTICLES_PATH_PREFIX + boardNo + ARTICLES_PATH_SUFFIX + "?" + query);
    }

    private List<Cafe24BoardArticleRow> parse(String body) {
        try {
            ArticlesResponse parsed = mapper.readValue(body, ArticlesResponse.class);
            return parsed.articles() != null ? parsed.articles() : List.of();
        } catch (Exception e) {
            // The body stays out of the message — an article carries writer/customer data.
            throw new IllegalStateException("카페24 게시글 응답을 해석할 수 없습니다.");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ArticlesResponse(@JsonProperty("articles") List<Cafe24BoardArticleRow> articles) {
    }
}
