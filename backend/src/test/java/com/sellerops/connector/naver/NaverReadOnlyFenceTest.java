package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The NAVER connector reads, and there is no line of it that could do anything else.
 *
 * <p>A schedule is a standing grant to call a marketplace without a human in the turn, so "this lane is
 * READ" has to be a property of the code rather than a claim in a manifest. Two POSTs make the point
 * worth enforcing structurally: the token mint and the order DETAIL QUERY are both POSTs and both are
 * reads, so "no POST" would be the wrong fence and "it's fine, they're reads" is the wrong assurance.
 * The fence is therefore the endpoint list itself — every NAVER path this package can reach, named
 * here, so a write endpoint cannot be added quietly alongside them.
 *
 * <p>Symmetric with {@code OperatorToolRegistry}'s catalogue fence on the agent side: the Operator has
 * no WRITE tool, and the connector it would ultimately reach has no WRITE endpoint.
 */
class NaverReadOnlyFenceTest {

    private static final Path NAVER_MAIN = Paths.get("src/main/java/com/sellerops/connector/naver");

    /** Every NAVER Commerce API path this package may reach. Every one is a read. */
    private static final Set<String> ALLOWED_ENDPOINTS = Set.of(
            "/external/v1/oauth2/token",                                            // credential proof
            "/external/v1/pay-order/seller/product-orders/last-changed-statuses",   // changed orders
            "/external/v1/pay-order/seller/product-orders/query",                   // order detail (read)
            "/external/v1/products/search",                                         // catalogue read
            "/external/v1/contents/qnas",                                           // 상품 문의 (read)
            "/external/v1/pay-user/inquiries",                                      // 고객 문의 (read)
            "/external/v2/products/channel-products/",                              // 상품 상세 (read)
            "/external/v1/product-attributes/attributes",                           // 속성 이름 (catalogue metadata)
            "/external/v1/product-attributes/attribute-values",                     // 속성값 (catalogue metadata)
            "/external/v1/product-attributes/attribute-value-units");               // 단위 이름 (catalogue metadata)

    /**
     * Anything under these NAVER API groups mutates the seller's store; none may appear.
     *
     * <p><b>These are PATHS, deliberately.</b> The marker used to be the bare word {@code answer},
     * standing in for the two answer-registration endpoints
     * ({@code PUT /v1/contents/qnas/{questionId}} · {@code POST /v1/pay-merchant/inquiries/{n}/answer}).
     * That proxy broke the moment the connector started READING an existing answer: 고객 문의 returns
     * {@code answerContent} on a GET, and preserving what the seller already replied is the opposite of
     * writing a reply. So the fence names the write paths themselves — including the whole
     * {@code pay-merchant} group, which exists only to answer — and a read field named after an answer
     * no longer reads as one.
     *
     * <p>Note the shape of the qnas pair: the READ is {@code /external/v1/contents/qnas} exactly, and
     * every write under it carries a path segment after it. {@code qnas/} therefore catches the write
     * and cannot catch the read.
     *
     * <p><b>{@code /external/v2/products} is not a write GROUP, and naming it as one stopped working
     * on 2026-08-26.</b> That group's registration endpoint is the bare path
     * ({@code POST /external/v2/products}) while {@code GET /external/v2/products/channel-products/&#123;n&#125;}
     * under the same prefix is the single-listing READ that carries {@code detailContent} — the field
     * the LIST resource does not send. A prefix marker cannot separate them because the write path is
     * a PREFIX of the read path, which is the reverse of the qnas shape. So the group is replaced by
     * the two write paths that really are writes, the bare registration literal gets its own exact
     * assertion below, and the rest of the separation is carried by the verb: the NAVER HTTP seam has
     * no {@code put} and no {@code delete}, which the third test asserts.
     */
    private static final List<String> WRITE_MARKERS = List.of(
            "/external/v1/products/origin-products",
            "/external/v2/products/origin-products",
            "/external/v2/standard-group-products",
            "product-orders/dispatch",
            "product-orders/claim",
            "/reviews/",
            "/questions/",
            "/external/v1/pay-merchant",
            "qnas/",
            "/answer");

    @Test
    @DisplayName("every NAVER endpoint the connector can reach is on the read allowlist")
    void theEndpointCatalogueIsClosedAndEveryEntryIsARead() throws IOException {
        Pattern path = Pattern.compile("\"(/external/[^\"]*)\"");
        List<String> found = new ArrayList<>();
        for (Path source : javaSources()) {
            Matcher matcher = path.matcher(Files.readString(source));
            while (matcher.find()) {
                found.add(matcher.group(1));
            }
        }

        assertThat(found).as("the connector must actually call something").isNotEmpty();
        assertThat(found)
                .as("a NAVER endpoint that is not on this list is a capability nobody reviewed")
                .allSatisfy(endpoint -> assertThat(ALLOWED_ENDPOINTS).contains(endpoint));
    }

    @Test
    @DisplayName("no mutating NAVER API group appears anywhere in the connector")
    void noWriteEndpointFamilyIsReferenced() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (Path source : javaSources()) {
            String code = Files.readString(source);
            for (String marker : WRITE_MARKERS) {
                if (code.contains("\"" + marker) || code.contains(marker + "\"")) {
                    offenders.add(source.getFileName() + " → " + marker);
                }
            }
        }

        assertThat(offenders)
                .as("registering, dispatching, answering or replying is not this lane's work")
                .isEmpty();
    }

    @Test
    @DisplayName("the v2 registration path — a prefix of a legitimate read — is named exactly")
    void theBareRegistrationPathIsNeverSpelled() throws IOException {
        for (Path source : javaSources()) {
            String code = Files.readString(source);
            assertThat(code)
                    .as("%s: POST /external/v2/products registers a product; only the longer "
                            + "channel-products READ under that prefix is allowed",
                            source.getFileName())
                    .doesNotContain("\"/external/v2/products\"");
        }
    }

    /**
     * The HTTP seam has three verbs and none of them can delete or replace a resource. If a fourth ever
     * appears, this fence must be re-argued rather than silently widened.
     */
    @Test
    @DisplayName("the HTTP boundary exposes no verb that could replace or remove a resource")
    void theHttpSeamCarriesNoMutatingVerb() throws IOException {
        String seam = Files.readString(NAVER_MAIN.resolve("NaverHttpClient.java"));

        assertThat(seam).contains("Response get(");
        assertThat(seam).doesNotContain("put(").doesNotContain("delete(").doesNotContain("patch(");
    }

    private static List<Path> javaSources() throws IOException {
        try (Stream<Path> walk = Files.walk(NAVER_MAIN)) {
            return walk.filter(p -> p.toString().endsWith(".java")).toList();
        }
    }
}
