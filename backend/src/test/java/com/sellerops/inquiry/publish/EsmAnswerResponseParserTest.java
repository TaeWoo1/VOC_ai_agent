package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.publish.EsmAnswerClient.Outcome;
import org.junit.jupiter.api.Test;

/** Provider success/failure parsing; messageNo accepted as string or number; no message leak. */
class EsmAnswerResponseParserTest {

    @Test
    void successMessageNoAsString() {
        Outcome o = EsmAnswerResponseParser.parse("{\"messageNo\":\"123\"}");
        assertThat(o.kind()).isEqualTo(Outcome.Kind.SUCCESS);
        assertThat(o.providerMessageNo()).isEqualTo("123");
        assertThat(o.resultCode()).isNull();
    }

    @Test
    void successMessageNoAsNumberNormalizedToString() {
        Outcome o = EsmAnswerResponseParser.parse("{\"messageNo\":123}");
        assertThat(o.kind()).isEqualTo(Outcome.Kind.SUCCESS);
        assertThat(o.providerMessageNo()).isEqualTo("123");
    }

    @Test
    void failureCarriesResultCodeButNeverTheMessage() {
        Outcome o = EsmAnswerResponseParser.parse("{\"resultCode\":9001,\"message\":\"secret-error-text\"}");
        assertThat(o.kind()).isEqualTo(Outcome.Kind.FAILURE);
        assertThat(o.resultCode()).isEqualTo(9001);
        assertThat(o.providerMessageNo()).isNull();
        // The Outcome has no field for the free-text message.
        assertThat(o.toString()).doesNotContain("secret-error-text");
    }

    @Test
    void ambiguousOrMalformedBodyIsDeliveryUnknown() {
        assertThat(EsmAnswerResponseParser.parse("{\"foo\":\"bar\"}").kind())
                .isEqualTo(Outcome.Kind.DELIVERY_UNKNOWN);
        assertThat(EsmAnswerResponseParser.parse("not json").kind())
                .isEqualTo(Outcome.Kind.DELIVERY_UNKNOWN);
        assertThat(EsmAnswerResponseParser.parse("[]").kind())
                .isEqualTo(Outcome.Kind.DELIVERY_UNKNOWN);
    }
}
