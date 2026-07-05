package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.esm.inquiry.EsmInquiryItem;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Exact messageNo + SellerAccount seller-identity matching for send-time re-query. */
class EsmInquiryMatchTest {

    private static EsmInquiryItem item(String messageNo, String sellerId, String informStatus, String token) {
        return new EsmInquiryItem(messageNo, 1, sellerId, null, null, null, null, informStatus,
                null, null, null, "t", "d", token, Boolean.FALSE);
    }

    @Test
    void exactMessageNoAndSellerIdMatches() {
        EsmInquiryItem it = item("MSG-1", "gm-seller", "미처리", "TOK");
        EsmInquiryMatch.Outcome o = EsmInquiryMatch.selectExact(List.of(it), "MSG-1", Set.of("gm-seller"));
        assertThat(o.result()).isEqualTo(EsmInquiryMatch.Result.MATCH);
        assertThat(o.item().token()).isEqualTo("TOK");
    }

    @Test
    void messageNoMatchButDifferentSellerIsRejected() {
        EsmInquiryItem it = item("MSG-1", "OTHER-seller", "미처리", "TOK");
        assertThat(EsmInquiryMatch.selectExact(List.of(it), "MSG-1", Set.of("gm-seller")).result())
                .isEqualTo(EsmInquiryMatch.Result.SELLER_MISMATCH);
        // A blank/absent seller on the row is also a mismatch (never trusted).
        assertThat(EsmInquiryMatch.selectExact(List.of(item("MSG-1", null, "미처리", "TOK")), "MSG-1", Set.of("gm-seller")).result())
                .isEqualTo(EsmInquiryMatch.Result.SELLER_MISMATCH);
    }

    @Test
    void noMatchingMessageNoIsNotFound() {
        EsmInquiryItem it = item("MSG-2", "gm-seller", "미처리", "TOK");
        assertThat(EsmInquiryMatch.selectExact(List.of(it), "MSG-1", Set.of("gm-seller")).result())
                .isEqualTo(EsmInquiryMatch.Result.NOT_FOUND);
    }
}
