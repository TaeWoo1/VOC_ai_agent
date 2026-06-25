package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Reads the Cafe24 Admin community boards list
 * ({@code GET https://{mall_id}.cafe24api.com/api/v2/admin/boards}) with the
 * Bearer access token. Mirrors {@link Cafe24OrdersClient}'s discipline: the
 * {@link Cafe24HttpClient} is the only network boundary, a 429 becomes a
 * {@link Cafe24RateLimitedException} (carrying the official resumption hint),
 * and no token or response material appears in messages.
 *
 * <p>This reads board <b>metadata only</b> — the board list, not any article.
 * Only board-level fields are projected ({@link Cafe24BoardRow}); article bodies,
 * writers, and customer data are never requested or parsed. Endpoint shape and
 * field names are doc-asserted and a live-verification item.
 */
public class Cafe24BoardsClient {

    static final String BOARDS_PATH = "/api/v2/admin/boards";

    /** mall_id becomes a hostname label — reject anything else before any HTTP. */
    private static final Pattern MALL_ID_SHAPE = Pattern.compile("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?");

    private final Cafe24HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public Cafe24BoardsClient(Cafe24HttpClient http) {
        this.http = http;
    }

    /**
     * List the mall's community boards (metadata only).
     *
     * @throws Cafe24RateLimitedException on HTTP 429 from the boards endpoint
     */
    public List<Cafe24BoardRow> list(String accessToken, String mallId) {
        URI uri = boardsUri(mallId);
        Map<String, String> headers = Map.of("Authorization", "Bearer " + accessToken);

        Cafe24HttpClient.Response response = http.get(uri, headers);
        if (response.statusCode() == 429) {
            throw Cafe24RateLimitedException.fromResponse(response);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException(
                    "카페24 게시판 조회에 실패했습니다 (HTTP " + response.statusCode() + ").");
        }
        return parse(response.body());
    }

    static URI boardsUri(String mallId) {
        if (mallId == null || !MALL_ID_SHAPE.matcher(mallId).matches()) {
            throw new IllegalStateException("카페24 mall_id 형식이 올바르지 않습니다.");
        }
        return URI.create("https://" + mallId + ".cafe24api.com" + BOARDS_PATH);
    }

    private List<Cafe24BoardRow> parse(String body) {
        try {
            BoardsResponse parsed = mapper.readValue(body, BoardsResponse.class);
            return parsed.boards() != null ? parsed.boards() : List.of();
        } catch (Exception e) {
            // The body stays out of the message — defense in depth even though
            // board metadata is not customer data.
            throw new IllegalStateException("카페24 게시판 응답을 해석할 수 없습니다.");
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record BoardsResponse(@JsonProperty("boards") List<Cafe24BoardRow> boards) {
    }
}
