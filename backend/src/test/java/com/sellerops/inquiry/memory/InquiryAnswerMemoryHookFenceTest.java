package com.sellerops.inquiry.memory;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.draft.DraftAuthorKind;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Knowledge Context v1-A: an approved deferral is not an answer.
 *
 * <p>{@code SELLER_APPROVED_FALLBACK} is the company's own 「확인 후 안내드리겠습니다」, saved verbatim where
 * no answer basis existed. The seller approving it says "send this deferral for THIS inquiry" — it
 * says nothing about how the company answers the question, so it must never come back as 과거 답변
 * precedent. The AI-draft guarantee ({@code AnswerMemoryWriteFenceTest}) is unchanged: a MODEL draft is
 * remembered only through the seller's approval or a verified send, never by being drafted.
 */
class InquiryAnswerMemoryHookFenceTest {

    @Test
    @DisplayName("a seller-approved fallback and a rule template are not rememberable; SELLER and MODEL are")
    void onlyAnAnswerIsRememberable() {
        assertThat(InquiryAnswerMemoryHook.isRememberable(DraftAuthorKind.SELLER_APPROVED_FALLBACK.name()))
                .as("the org's pre-approved deferral is a decision about one inquiry, not precedent")
                .isFalse();
        assertThat(InquiryAnswerMemoryHook.isRememberable(DraftAuthorKind.RULE.name()))
                .as("a template promise has nothing behind it")
                .isFalse();
        assertThat(InquiryAnswerMemoryHook.isRememberable(DraftAuthorKind.SELLER.name())).isTrue();
        assertThat(InquiryAnswerMemoryHook.isRememberable(DraftAuthorKind.MODEL.name())).isTrue();
        // Rows from before the column existed carry no kind and are the seller's own.
        assertThat(InquiryAnswerMemoryHook.isRememberable(null)).isTrue();
    }

    @Test
    @DisplayName("the guard stands in front of the only remember call the hook makes")
    void theGuardPrecedesTheWrite() throws IOException {
        String hook = Files.readString(
                Paths.get("src/main/java/com/sellerops/inquiry/memory/InquiryAnswerMemoryHook.java"));
        int guard = hook.indexOf("if (!isRememberable(draft.getAuthorKind()))");
        int write = hook.indexOf("memory.remember(");
        assertThat(guard).as("the author-kind guard exists").isPositive();
        assertThat(write).as("the hook still writes through the service").isPositive();
        assertThat(guard).as("the guard runs before the write, not beside it").isLessThan(write);
        assertThat(hook.split("memory\\.remember\\(").length - 1)
                .as("one write path, so one guard covers it").isEqualTo(1);
    }
}
