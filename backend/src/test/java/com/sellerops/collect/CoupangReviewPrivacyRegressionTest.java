package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.sellerops.collect.dto.AgentReviewHandoffRequest;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.review.Review;
import java.lang.reflect.Field;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;

/**
 * **The buyer has nowhere to land.**
 *
 * Coupang's 상품평 screen prints the buyer's name beside every review. The acquisition path is allowed to see
 * it — `docs/sellerops_live_approval_contract.md` §5d says the rule is *do not persist*, not *do not read* — so
 * the guarantee has to be structural rather than behavioural: at every layer the value passes, there is no
 * field for it to be assigned to.
 *
 * <p>These are not tests of a filter. A filter is a thing that can be forgotten, and a test of a filter passes
 * right up until someone adds the field back. They assert the ABSENCE of the field, so adding one fails here
 * before it can be wired to anything.
 *
 * <p>The wire is the one layer where absence alone is not enough, because JSON ignores what it does not
 * recognize by default. So the request record rejects unknown properties, and a client that sends an author is
 * refused audibly rather than accepted with the field quietly dropped.
 */
class CoupangReviewPrivacyRegressionTest {

    /**
     * Words that name a person on this screen. `productName` is deliberately not caught by any of them: it is
     * catalog text, and confusing the two is what a lazily-worded rule would do.
     */
    private static final List<String> IDENTITY_WORDS =
            List.of("author", "buyer", "customer", "writer", "nickname", "reviewer", "purchaser", "member");

    private static void assertNamesNobody(String where, List<String> names) {
        for (String name : names) {
            String lower = name.toLowerCase(Locale.ROOT);
            for (String word : IDENTITY_WORDS) {
                assertThat(lower)
                        .withFailMessage("%s declares '%s', which names a person. A Coupang 상품평 carries the "
                                + "buyer's name on screen and it must have no field to be stored in.", where, name)
                        .doesNotContain(word);
            }
        }
    }

    @Test
    void the_wire_record_has_no_field_that_names_a_person() {
        assertNamesNobody("AgentReviewHandoffRequest.Review",
                Arrays.stream(AgentReviewHandoffRequest.Review.class.getRecordComponents())
                        .map(RecordComponent::getName).toList());
    }

    @Test
    void the_canonical_record_has_no_field_that_names_a_person() {
        assertNamesNobody("CanonicalReview",
                Arrays.stream(CanonicalReview.class.getRecordComponents())
                        .map(RecordComponent::getName).toList());
    }

    @Test
    void the_stored_entity_has_no_column_that_names_a_person() {
        assertNamesNobody("Review",
                Arrays.stream(Review.class.getDeclaredFields())
                        .filter(f -> !f.isSynthetic())
                        .map(Field::getName).toList());
    }

    @Test
    void a_request_carrying_an_author_is_refused_rather_than_quietly_stripped() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String json = """
                {"writtenOn":"2026-08-11","rating":5,"body":"아주 만족합니다","productId":"15411270785",
                 "vendorItemId":"81234567890","productName":"무선 이어폰","mediaCount":0,"bodyTruncated":false,
                 "author":"김서연"}
                """;

        assertThatThrownBy(() -> mapper.readValue(json, AgentReviewHandoffRequest.Review.class))
                .isInstanceOf(UnrecognizedPropertyException.class)
                .hasMessageContaining("author");
    }

    @Test
    void the_same_request_without_the_author_is_accepted() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String json = """
                {"writtenOn":"2026-08-11","rating":5,"body":"아주 만족합니다","productId":"15411270785",
                 "vendorItemId":"81234567890","productName":"무선 이어폰","mediaCount":0,"bodyTruncated":false}
                """;

        AgentReviewHandoffRequest.Review row = mapper.readValue(json, AgentReviewHandoffRequest.Review.class);

        assertThat(row.body()).isEqualTo("아주 만족합니다");
        assertThat(row.productId()).isEqualTo("15411270785");
    }

    @Test
    void a_request_object_printed_into_a_log_carries_no_review_text() {
        AgentReviewHandoffRequest.Review row = new AgentReviewHandoffRequest.Review(
                "2026-08-11", 5, "배송도 빠르고 포장도 꼼꼼해서 아주 만족합니다", "15411270785", "81234567890",
                "무선 이어폰", 0, false);
        AgentReviewHandoffRequest request =
                new AgentReviewHandoffRequest("0123456789abcdef01234567", "COUPANG", true, "OPERATOR_FINISHED",
                        List.of(row));

        assertThat(row.toString()).doesNotContain("배송도 빠르고");
        assertThat(request.toString()).doesNotContain("배송도 빠르고");
        // The slot is masked too: it is the stable handle to a seller's connection, not a display value.
        assertThat(request.toString()).doesNotContain("0123456789abcdef01234567");
    }
}
