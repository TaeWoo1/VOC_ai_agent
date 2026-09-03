package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Who wrote the question decides whether a restatement is bought — and nothing else.
 * (Knowledge Retrieval Quality v2)
 *
 * <p>The retrieval-intent capability exists because a customer writes 「자꾸 붕 뜨는데요」 and the seller
 * wrote 「접착면이 들뜰 수 있습니다」. A seller typing into their own search box has the opposite problem
 * — none — so they do not pay a vendor round trip for it. That is the whole meaning of the flag, and
 * the risk worth pinning is that it grows a second meaning.
 */
class RetrievalIntentScopeTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");

    @Test
    @DisplayName("only a customer's question is customer-written")
    void onlyCustomersAreCustomers() {
        assertThat(RetrievalQuery.ofCustomer("제목", "자꾸 붕 뜨는데요").customerWritten()).isTrue();
        assertThat(RetrievalQuery.of(null, "제목", "자꾸 붕 뜨는데요").customerWritten()).isFalse();
        assertThat(RetrievalQuery.ofText("반품 조건").customerWritten()).isFalse();
        assertThat(RetrievalQuery.exact("반품 조건").customerWritten()).isFalse();
    }

    @Test
    @DisplayName("it changes who pays, never what is asked")
    void theQuestionIsIdentical() {
        RetrievalQuery seller = RetrievalQuery.of(null, "환불 문의", "언제 환불되나요?");
        RetrievalQuery customer = RetrievalQuery.ofCustomer("환불 문의", "언제 환불되나요?");
        assertThat(customer.candidates()).isEqualTo(seller.candidates());
        assertThat(customer.full()).isEqualTo(seller.full());
    }

    @Test
    @DisplayName("the two callers that claim it are the two that have a customer's sentence")
    void onlyTwoCallersClaimIt() throws IOException {
        List<String> callers = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                if (Files.readString(source).contains("RetrievalQuery.ofCustomer(")) {
                    callers.add(source.getFileName().toString());
                }
            }
        }
        // An inquiry a customer sent, and a review a customer left. A planner's need sentence, a
        // seller's search box and the knowledge library screen are deliberately not on this list.
        assertThat(callers).containsExactlyInAnyOrder(
                "InquiryEvidenceRetriever.java", "ReviewDraftComposer.java");
    }
}
