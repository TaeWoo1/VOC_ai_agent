package com.sellerops.order.fact;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.ChannelOrderRef;
import com.sellerops.inquiry.InquiryOrderBinding;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Where an order id may come from</b> — asserted on the source, because the property is an absence.
 *
 * <p>The failure this guards is cheap to write and impossible to see afterwards. Somebody adds a
 * regex over the inquiry body to "improve coverage", and from then on "1234번 주문 문의드립니다" binds
 * to order 1234 — a phone number, a product code, or last year's order — and the customer is told the
 * state of somebody else's parcel with a confident citation under it. The 2026-08-24 product
 * attribution correction is the same story with lower stakes, and it happened.
 */
class OrderBindingFenceTest {

    /** Shapes that mean "an order id was pulled out of free text". */
    private static final Pattern EXTRACTION = Pattern.compile(
            "(?i)(orderNoPattern|extractOrder|parseOrderFrom|ORDER_NUMBER_PATTERN"
            + "|orderIdFrom(Body|Text|Content))");

    @Test
    @DisplayName("no code anywhere extracts an order identifier from inquiry text")
    void nothingParsesAnOrderOutOfTheQuestion() throws IOException {
        Path main = Paths.get("src/main/java/com/sellerops");
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(main)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                if (EXTRACTION.matcher(Files.readString(source)).find()) {
                    offenders.add(source.getFileName().toString());
                }
            }
        }
        assertThat(offenders)
                .as("the channel names the order or nothing does")
                .isEmpty();
    }

    @Test
    @DisplayName("the binding vocabulary has exactly one value, and no human lane")
    void thereIsOnlyOneWayToBind() {
        assertThat(InquiryOrderBinding.values()).hasSize(1);
        assertThat(InquiryOrderBinding.values()[0]).isEqualTo(InquiryOrderBinding.SOURCE_EXACT);
        for (InquiryOrderBinding binding : InquiryOrderBinding.values()) {
            assertThat(binding.name())
                    .as("a person cannot look at a question and know which order it is")
                    .doesNotContain("USER")
                    .doesNotContain("CONFIRMED")
                    .doesNotContain("CANDIDATE")
                    .doesNotContain("INFERRED");
        }
    }

    @Test
    @DisplayName("the fact reader reads the reference column and never the customer's words")
    void theReaderNeverTouchesTheBody() throws IOException {
        String reader = Files.readString(Paths.get(
                "src/main/java/com/sellerops/inquiry/draft/InquiryOrderFactReader.java"));

        assertThat(reader)
                .doesNotContain("getBody()")
                .doesNotContain("getTitle()")
                .doesNotContain("MarkupText");
    }

    @Test
    @DisplayName("step 2 of the fact-source priority is declared absent, not improvised")
    void noChannelClaimsAnExactLookupItCannotMake() {
        for (String channel : List.of("NAVER", "CAFE24", "COUPANG")) {
            assertThat(ExactOrderLookupCapability.isAvailable(channel))
                    .as("no vendored contract retrieves one order by its id; a date sweep is not a lookup")
                    .isFalse();
            assertThat(ExactOrderLookupCapability.endpointFor(channel)).isEmpty();
        }
    }

    @Test
    @DisplayName("the narrower identifier wins, and a multi-line list is not one of them")
    void theNarrowerIdentifierWins() {
        assertThat(ChannelOrderRef.of("ORD-1", "PO-9").preferredRef()).isEqualTo("PO-9");
        assertThat(ChannelOrderRef.of("ORD-1", null).preferredRef()).isEqualTo("ORD-1");
        assertThat(ChannelOrderRef.of("  ", " ").hasIdentifier()).isFalse();
        assertThat(ChannelOrderRef.absent().preferredRef()).isNull();
    }
}
