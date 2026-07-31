package com.sellerops.connector.cafe24.spike;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The live {@link SpikeReplyTransport}. Read calls reuse the production
 * {@link Cafe24HttpClient} (so they inherit the pinned {@code X-Cafe24-Api-Version}
 * header and timeouts); the single comment POST is a JSON body, which the production
 * client does not support, so it is issued here with its own JDK request carrying the
 * same version header.
 *
 * <p>Created only by the double-gated spike configuration, i.e. never on a normal
 * bootRun. No update or delete method exists. Request/response bodies never appear in
 * any exception message or log — failures collapse to coarse, secret-free categories.
 */
public class JdkSpikeReplyTransport implements SpikeReplyTransport {

    static final String ARTICLES_PATH_PREFIX = "/api/v2/admin/boards/";
    static final String ARTICLES_PATH_SUFFIX = "/articles";
    static final String API_VERSION_HEADER = "X-Cafe24-Api-Version";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(20);
    private static final Pattern MALL_ID_SHAPE =
            Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Cafe24HttpClient http;
    private final String apiVersion;
    private final java.net.http.HttpClient jdk = java.net.http.HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public JdkSpikeReplyTransport(Cafe24HttpClient http, String apiVersion) {
        if (apiVersion == null || apiVersion.isBlank()) {
            throw new IllegalStateException("스파이크 API 버전이 설정되지 않았습니다.");
        }
        this.http = http;
        this.apiVersion = apiVersion.trim();
    }

    @Override
    public ArticleObservation observeArticle(String mallId, String accessToken, int boardNo, long articleNo) {
        URI uri = articleUri(mallId, boardNo, articleNo);
        Cafe24HttpClient.Response r = http.get(uri, bearer(accessToken));
        if (r.statusCode() != 200) {
            throw new SpikeTransportException("SPIKE_ARTICLE_GET_HTTP_" + r.statusCode());
        }
        return parseArticle(r.body(), boardNo);
    }

    @Override
    public List<CommentObservation> listComments(String mallId, String accessToken, int boardNo, long articleNo) {
        URI uri = commentsUri(mallId, boardNo, articleNo);
        Cafe24HttpClient.Response r = http.get(uri, bearer(accessToken));
        if (r.statusCode() != 200) {
            throw new SpikeTransportException("SPIKE_COMMENTS_GET_HTTP_" + r.statusCode());
        }
        return parseComments(r.body());
    }

    @Override
    public CommentObservation createComment(String mallId, String accessToken, int boardNo, long articleNo,
                                            CommentDraft draft) {
        URI uri = commentsUri(mallId, boardNo, articleNo);
        String envelope = buildCommentEnvelope(draft.content(), draft.writer(),
                new String(draft.password()));
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header("Authorization", "Bearer " + accessToken)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header(API_VERSION_HEADER, apiVersion)
                .POST(HttpRequest.BodyPublishers.ofString(envelope, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> response;
        try {
            response = jdk.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new SpikeTransportException("SPIKE_COMMENT_POST_NETWORK_ERROR");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SpikeTransportException("SPIKE_COMMENT_POST_INTERRUPTED");
        }
        int status = response.statusCode();
        if (status >= 200 && status < 300) {
            return parseCreatedComment(response.body());
        }
        if (status >= 400 && status < 500) {
            // A rejection (bad field / unsupported / forbidden) — capability signal (verdict C).
            throw new SpikeCommentRejectedException("SPIKE_COMMENT_POST_REJECTED_HTTP_" + status);
        }
        throw new SpikeTransportException("SPIKE_COMMENT_POST_HTTP_" + status);
    }

    // ---- pure, testable helpers -------------------------------------------------

    /** Build the Cafe24 admin write envelope: {@code {"shop_no":1,"request":{...}}}. */
    static String buildCommentEnvelope(String content, String writer, String password) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("content", content);
        request.put("writer", writer);
        request.put("password", password);
        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("shop_no", 1);
        envelope.put("request", request);
        try {
            return MAPPER.writeValueAsString(envelope);
        } catch (Exception e) {
            throw new SpikeTransportException("SPIKE_COMMENT_ENVELOPE_SERIALIZE_FAILED");
        }
    }

    static ArticleObservation parseArticle(String body, int boardNo) {
        try {
            ArticleWrapper w = MAPPER.readValue(body, ArticleWrapper.class);
            ArticleRow row = w.article() != null ? w.article()
                    : (w.articles() != null && !w.articles().isEmpty() ? w.articles().get(0) : null);
            if (row == null) {
                throw new SpikeTransportException("SPIKE_ARTICLE_RESPONSE_EMPTY");
            }
            return new ArticleObservation(row.articleNo(), boardNo, row.replyStatus());
        } catch (SpikeTransportException e) {
            throw e;
        } catch (Exception e) {
            throw new SpikeTransportException("SPIKE_ARTICLE_RESPONSE_UNPARSEABLE");
        }
    }

    static List<CommentObservation> parseComments(String body) {
        try {
            CommentsWrapper w = MAPPER.readValue(body, CommentsWrapper.class);
            List<CommentObservation> out = new ArrayList<>();
            if (w.comments() != null) {
                for (CommentRow row : w.comments()) {
                    out.add(new CommentObservation(row.commentNo(), row.writer()));
                }
            }
            return out;
        } catch (Exception e) {
            throw new SpikeTransportException("SPIKE_COMMENTS_RESPONSE_UNPARSEABLE");
        }
    }

    static CommentObservation parseCreatedComment(String body) {
        try {
            CreatedWrapper w = MAPPER.readValue(body, CreatedWrapper.class);
            CommentRow row = w.comment() != null ? w.comment()
                    : (w.comments() != null && !w.comments().isEmpty() ? w.comments().get(0) : null);
            if (row == null) {
                throw new SpikeTransportException("SPIKE_CREATED_COMMENT_RESPONSE_EMPTY");
            }
            return new CommentObservation(row.commentNo(), row.writer());
        } catch (SpikeTransportException e) {
            throw e;
        } catch (Exception e) {
            throw new SpikeTransportException("SPIKE_CREATED_COMMENT_RESPONSE_UNPARSEABLE");
        }
    }

    static URI articleUri(String mallId, int boardNo, long articleNo) {
        return URI.create(host(mallId) + ARTICLES_PATH_PREFIX + boardNo + ARTICLES_PATH_SUFFIX
                + "/" + articleNo);
    }

    static URI commentsUri(String mallId, int boardNo, long articleNo) {
        return URI.create(host(mallId) + ARTICLES_PATH_PREFIX + boardNo + ARTICLES_PATH_SUFFIX
                + "/" + articleNo + "/comments");
    }

    private static String host(String mallId) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new SpikeTransportException("SPIKE_MALL_ID_SHAPE_INVALID");
        }
        return "https://" + mallId + ".cafe24api.com";
    }

    private static Map<String, String> bearer(String accessToken) {
        return Map.of("Authorization", "Bearer " + accessToken);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ArticleWrapper(@JsonProperty("article") ArticleRow article,
                                  @JsonProperty("articles") List<ArticleRow> articles) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ArticleRow(@JsonProperty("article_no") long articleNo,
                              @JsonProperty("reply_status") String replyStatus) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CommentsWrapper(@JsonProperty("comments") List<CommentRow> comments) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CreatedWrapper(@JsonProperty("comment") CommentRow comment,
                                  @JsonProperty("comments") List<CommentRow> comments) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CommentRow(@JsonProperty("comment_no") long commentNo,
                              @JsonProperty("writer") String writer) {
    }
}
