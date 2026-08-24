package com.sellerops.order.fact;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.cafe24.Cafe24OrderDetailRow;
import com.sellerops.order.fact.dto.OrderContextView;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What an exact order read is not allowed to bring back, log, or search by</b> — asserted on the
 * source, because every property here is an absence.
 *
 * <p>The vendored contract makes the risk concrete rather than theoretical. Cafe24's LIST endpoint
 * accepts {@code buyer_name}, {@code receiver_name}, {@code receiver_address},
 * {@code buyer_cellphone}, {@code buyer_phone}, {@code buyer_email} and {@code member_id} as search
 * parameters — a contracted, documented, entirely functional way to find a customer's orders by their
 * name or phone number. A contract offering it is not a reason to use it, and the only durable way to
 * keep it unused is to fail a build when its name appears.
 */
class ExactOrderPrivacyFenceTest {

    private static final Path CONNECTOR =
            Paths.get("src/main/java/com/sellerops/connector/cafe24");
    private static final Path FACT = Paths.get("src/main/java/com/sellerops/order/fact");

    @Test
    @DisplayName("no customer-search parameter is ever sent to a channel")
    void nothingSearchesForACustomer() throws IOException {
        List<String> forbidden = List.of("buyer_name", "receiver_name", "receiver_address",
                "buyer_cellphone", "buyer_phone", "buyer_email", "member_id", "member_email",
                "name_furigana");
        for (Path source : javaFiles(CONNECTOR)) {
            String text = code(source);
            for (String parameter : forbidden) {
                assertThat(text)
                        .as("%s: Cafe24 documents %s as a search parameter, which is why it is named "
                                + "here — finding a person's orders is not an exact order lookup",
                                source.getFileName(), parameter)
                        .doesNotContain(parameter);
            }
        }
    }

    @Test
    @DisplayName("the single-order request asks for no sub-resource that carries a person")
    void noEmbedRequestsAPerson() throws IOException {
        String client = code(CONNECTOR.resolve("Cafe24OrdersClient.java"));
        int detail = client.indexOf("static URI orderDetailUri(");
        assertThat(detail).isPositive();
        String uriBuilder = client.substring(detail, Math.min(client.length(), detail + 700));
        assertThat(uriBuilder)
                .as("buyer and receivers are opt-in embeds; not naming them keeps them off the wire")
                .doesNotContain("embed")
                .doesNotContain("buyer")
                .doesNotContain("receivers");
    }

    @Test
    @DisplayName("the parsed row has no field a person could be identified by")
    void theRowProjectsNoPerson() {
        for (var component : Cafe24OrderDetailRow.class.getRecordComponents()) {
            assertThat(component.getName().toLowerCase())
                    .as("ignoreUnknown discards the rest at the parse boundary, before any Java object")
                    .doesNotContain("member").doesNotContain("buyer").doesNotContain("receiver")
                    .doesNotContain("name").doesNotContain("email").doesNotContain("phone")
                    .doesNotContain("address").doesNotContain("amount").doesNotContain("transaction")
                    .doesNotContain("bank");
        }
        assertThat(Cafe24OrderDetailRow.class.getRecordComponents()).hasSize(7);
    }

    @Test
    @DisplayName("no order identifier survives into the fact, the card, or the audit line")
    void noIdentifierTravelsDownstream() throws IOException {
        for (var component : OrderFact.class.getRecordComponents()) {
            assertThat(component.getName().toLowerCase())
                    .doesNotContain("orderid").doesNotContain("reference");
        }
        for (var component : OrderContextView.class.getRecordComponents()) {
            assertThat(component.getName().toLowerCase())
                    .doesNotContain("orderid").doesNotContain("reference");
        }
        String audit = code(FACT.resolve("ExactOrderReadAudit.java"));
        int logStatements = audit.indexOf("log.info");
        assertThat(logStatements).isPositive();
        assertThat(audit.substring(logStatements))
                .as("a database column has an owner, a retention and a reader; a log line has none")
                .doesNotContain("reference")
                .doesNotContain("mallId")
                .doesNotContain("accessToken")
                .doesNotContain("body");
    }

    @Test
    @DisplayName("nothing in the exact-read path reads the customer's message")
    void nothingReadsTheQuestion() throws IOException {
        for (Path source : javaFiles(FACT)) {
            assertThat(code(source))
                    .as("%s", source.getFileName())
                    .doesNotContain("getBody()")
                    .doesNotContain("getTitle()")
                    .doesNotContain("MarkupText");
        }
    }

    @Test
    @DisplayName("the exact-read path is READ only — no order is ever written to a channel")
    void theExactPathWritesNothing() throws IOException {
        for (Path source : javaFiles(FACT)) {
            assertThat(code(source)).as("%s", source.getFileName())
                    .doesNotContain("postForm")
                    .doesNotContain("\"PUT\"")
                    .doesNotContain("\"POST\"")
                    .doesNotContain("\"DELETE\"");
        }
        String reader = code(CONNECTOR.resolve("Cafe24ExactOrderReader.java"));
        assertThat(reader)
                .as("the only client method it may reach is the single-order GET")
                .contains("ordersClient.fetchOne(")
                .doesNotContain("fetchPage(")
                .doesNotContain("postForm");
    }

    @Test
    @DisplayName("the order fact never reaches Answer Memory")
    void anOrderFactIsNotAnAnswer() throws IOException {
        for (String file : List.of(
                "src/main/java/com/sellerops/knowledge/memory/AnswerMemory.java",
                "src/main/java/com/sellerops/knowledge/memory/AnswerMemoryService.java")) {
            String text = code(Paths.get(file));
            assertThat(text)
                    .as("%s remembers how the seller answered, not what the order was doing", file)
                    .doesNotContain("OrderFact")
                    .doesNotContain("sourceOrderRef")
                    .doesNotContain("ExactOrder");
        }
    }

    /**
     * One Java file with its comments removed.
     *
     * <p>The ban is on SENDING these names, not on writing them down. Every class here documents the
     * discarded fields by name, because a reviewer cannot check a projection against a contract
     * without seeing what was left out — and a fence that punished the explanation would delete the
     * explanation first.
     */
    private static String code(Path source) throws IOException {
        return Files.readString(source)
                .replaceAll("(?s)/\\*.*?\\*/", " ")
                .replaceAll("(?m)//.*$", " ");
    }

    private static List<Path> javaFiles(Path directory) throws IOException {
        try (var walk = Files.walk(directory)) {
            return walk.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
    }
}
