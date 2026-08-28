package com.sellerops.review.publish.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.cafe24.Cafe24HttpClient;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The comment POST, checked on the bytes it would send — never against a mall (docs/cafe24_review_comment_execution_v1.md).
 */
class Cafe24ReviewCommentClientTest {

    /** Records every call; answers 201 with a comment number. */
    static final class Recording implements Cafe24HttpClient {
        final List<String> bodies = new ArrayList<>();
        final List<URI> uris = new ArrayList<>();
        int status = 201;
        @Override public Response get(URI uri, Map<String, String> headers) { throw new UnsupportedOperationException(); }
        @Override public Response postForm(URI uri, Map<String, String> headers, Map<String, String> form) { throw new UnsupportedOperationException(); }
        @Override public Response postJson(URI uri, Map<String, String> headers, String jsonBody) {
            uris.add(uri); bodies.add(jsonBody);
            return new Response(status, "{\"comment\":{\"comment_no\":41}}", Map.of());
        }
    }

    private static Cafe24ReviewCommentClient.Comment comment(String password) {
        return new Cafe24ReviewCommentClient.Comment(1, 4, 3674, "확인해 드리겠습니다.", "demoshop", "demoshop", password);
    }

    @Test
    @DisplayName("the request is exactly the contract's envelope: shop_no + request{content, writer, member_id, password, secret}")
    void requestShapeIsTheContract() throws Exception {
        Recording http = new Recording();
        Cafe24ReviewCommentClient client = new Cafe24ReviewCommentClient(http, "");
        String body = client.body(comment(Cafe24CommentPassword.fresh()));
        client.assertContractShape(body);
        JsonNode root = new ObjectMapper().readTree(body);
        assertThat(root.path("shop_no").asInt()).isEqualTo(1);
        JsonNode req = root.path("request");
        assertThat(req.path("writer").asText()).isEqualTo("demoshop");
        assertThat(req.path("member_id").asText()).isEqualTo("demoshop");
        assertThat(req.path("secret").asText()).isEqualTo("F");
        assertThat(req.has("rating")).as("a seller comment never carries a rating").isFalse();
        assertThat(req.has("client_ip")).as("client_ip is not a comment request parameter").isFalse();
        assertThat(req.path("password").asText()).hasSize(Cafe24CommentPassword.LENGTH);
    }

    @Test
    @DisplayName("the password is fresh per call, within the contract's 1–20, and never the same twice")
    void passwordIsFreshAndBounded() {
        String a = Cafe24CommentPassword.fresh();
        String b = Cafe24CommentPassword.fresh();
        assertThat(a).hasSize(20).matches("[A-Za-z0-9]+");
        assertThat(a).isNotEqualTo(b);
        Cafe24ReviewCommentClient client = new Cafe24ReviewCommentClient(new Recording(), "");
        assertThatThrownBy(() -> client.body(comment("x".repeat(21)))).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> client.body(comment(""))).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("a real mall host without an armed live approval is refused before any byte leaves")
    void liveWriteNeedsAnArmedApproval() {
        Recording http = new Recording();
        Cafe24ReviewCommentClient client = new Cafe24ReviewCommentClient(http, "");
        assertThatThrownBy(() -> client.post("token", "demoshop", comment(Cafe24CommentPassword.fresh())))
                .isInstanceOf(RuntimeException.class);
        assertThat(http.bodies).isEmpty();
    }

    @Test
    @DisplayName("the target URI is the documented comments resource of exactly one article")
    void uriIsTheDocumentedResource() {
        assertThat(Cafe24ReviewCommentClient.uri("demoshop", 4, 3674))
                .isEqualTo(URI.create("https://demoshop.cafe24api.com/api/v2/admin/boards/4/articles/3674/comments"));
        assertThatThrownBy(() -> Cafe24ReviewCommentClient.uri("Bad Mall", 4, 1)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> Cafe24ReviewCommentClient.uri("demoshop", 0, 1)).isInstanceOf(IllegalStateException.class);
    }
}
