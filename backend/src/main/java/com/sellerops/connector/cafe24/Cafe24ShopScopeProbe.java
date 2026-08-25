package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Reads the one thing a Cafe24 write request has to state about WHERE it is writing and that this
 * deployment has never observed: an article's {@code shop_no}.
 *
 * <p><b>Why it exists.</b> The create contract's body carries {@code shop_no} with a documented
 * default of 1. SellerOps holds no value for it — it is projected in no stored row, no response this
 * repository parses, and no part of the connection — so the first two live POSTs omitted it rather
 * than assert a shop that was never seen. Omission is honest but it is not knowledge, and a write
 * that lands in the wrong shop is not recoverable by a retry. The number is in every LIST response
 * already; nothing but the projection was missing.
 *
 * <p><b>Structure only.</b> This class declares six parse fields and every one of them is a number
 * or a fixed token — there is no {@code title}, {@code content}, {@code writer}, {@code member_id}
 * or {@code client_ip} here, so no customer sentence and no person-shaped value can reach a log
 * through it even by accident. Unlike {@link Cafe24ReplyActorProbe}, whose question forced it to
 * materialize actor fields and reduce them to counts, this one never holds them at all.
 *
 * <p><b>Bounded and closed.</b> The article numbers come from the caller — rows this repository
 * already proved — and are sent as the LIST's comma-separated {@code article_no} filter. There is no
 * window, no paging and no neighbour scan, and the request budget is refused rather than exceeded.
 * It writes nothing in this database and mutates nothing on the platform.
 */
public class Cafe24ShopScopeProbe {

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24ShopScopeProbe(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * One article's structural placement. Every component is a number or one of {@code N}/{@code P}/
     * {@code C}; a null means the response did not carry the field, which is itself the answer when
     * the question is whether a value has provenance.
     */
    public record Placement(long articleNo, Integer shopNo, Integer boardNo, Long parentArticleNo,
                            Integer replyDepth, String replyStatus) {
    }

    /** What the observation saw. {@code requested} minus {@code returned} is what the mall withheld. */
    public record Report(String outcome, int requests, int requested, int returned,
                         List<Placement> placements) {

        public boolean ok() {
            return "OK".equals(outcome);
        }
    }

    /**
     * Read the given article numbers and return their placement.
     *
     * <p>Fails closed: a transport failure, a non-200 or an unparseable body ends the observation
     * with that outcome rather than a partial picture, and the budget stops it before it can walk.
     */
    public Report observe(String accessToken, String mallId, int boardNo, List<Long> articleNos,
                          int maxRequests) {
        Set<Long> ids = new LinkedHashSet<>(articleNos);
        if (ids.isEmpty()) {
            return new Report("NO_TARGET", 0, 0, 0, List.of());
        }
        if (ids.size() > 100 || maxRequests < 1) {
            return new Report("BUDGET_REFUSED", 0, ids.size(), 0, List.of());
        }
        String joined = String.join(",", ids.stream().map(String::valueOf).toList());
        URI uri = articlesUri(mallId, boardNo,
                Map.of("article_no", joined, "limit", Integer.toString(ids.size())));
        Cafe24HttpClient.Response response;
        try {
            response = http.get(uri, Map.of("Authorization", "Bearer " + accessToken));
        } catch (RuntimeException e) {
            // The message may carry a URI or a body; neither is repeated.
            return new Report("TRANSPORT_ERROR", 1, ids.size(), 0, List.of());
        }
        if (response.statusCode() != 200) {
            return new Report(category(response.statusCode()), 1, ids.size(), 0, List.of());
        }
        List<Placement> placements = new ArrayList<>();
        try {
            ArticlesEnvelope envelope = mapper.readValue(response.body(), ArticlesEnvelope.class);
            for (RawArticle raw : envelope.articles() == null ? List.<RawArticle>of() : envelope.articles()) {
                if (raw.articleNo() != null) {
                    placements.add(new Placement(raw.articleNo(), raw.shopNo(), raw.boardNo(),
                            raw.parentArticleNo(), raw.replyDepth(), raw.replyStatus()));
                }
            }
        } catch (Exception e) {
            return new Report("UNPARSEABLE", 1, ids.size(), 0, List.of());
        }
        return new Report("OK", 1, ids.size(), placements.size(), List.copyOf(placements));
    }

    private static String category(int status) {
        if (status == 401 || status == 403) {
            return "AUTH_FAILED";
        }
        if (status == 429) {
            return "RATE_LIMITED";
        }
        return status >= 500 ? "UPSTREAM_ERROR" : "REFUSED";
    }

    private URI articlesUri(String mallId, int boardNo, Map<String, String> params) {
        StringBuilder query = new StringBuilder();
        params.forEach((k, v) -> query.append(query.isEmpty() ? "?" : "&").append(k).append('=').append(v));
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        if (boardNo <= 0) {
            throw new IllegalStateException("카페24 board_no 형식이 올바르지 않습니다.");
        }
        return URI.create("https://" + mallId + ".cafe24api.com/api/v2/admin/boards/" + boardNo
                + "/articles" + query);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record ArticlesEnvelope(@JsonProperty("articles") List<RawArticle> articles) {
    }

    /** Six structural fields. Nothing a person wrote or is has a place to land. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private record RawArticle(@JsonProperty("article_no") Long articleNo,
                              @JsonProperty("shop_no") Integer shopNo,
                              @JsonProperty("board_no") Integer boardNo,
                              @JsonProperty("parent_article_no") Long parentArticleNo,
                              @JsonProperty("reply_depth") Integer replyDepth,
                              @JsonProperty("reply_status") String replyStatus) {
    }
}
