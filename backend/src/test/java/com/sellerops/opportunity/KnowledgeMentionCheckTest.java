package com.sellerops.opportunity;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.reviewissue.IssueVocabulary;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class KnowledgeMentionCheckTest {

    @Test
    @DisplayName("a mention is the extractor's own keyword in the seller's title or body, spacing ignored")
    void mentionUsesTheExtractorsWords() {
        List<String> excerpts = new ArrayList<>();
        assertThat(KnowledgeMentionCheck.mentions("설치 안내", "먼지를 닦고 붙이세요. 양면 테이프는 24시간 후 고정됩니다.",
                IssueVocabulary.keywordsOf("접착"), excerpts)).isTrue();
        assertThat(excerpts).containsExactly("먼지를 닦고 붙이세요.", "양면 테이프는 24시간 후 고정됩니다.");
    }

    @Test
    @DisplayName("a title-only mention counts, with no excerpt to show")
    void titleOnly() {
        List<String> excerpts = new ArrayList<>();
        assertThat(KnowledgeMentionCheck.mentions("배송 기준", "주문 후 이틀 안에 나갑니다.",
                IssueVocabulary.keywordsOf("배송"), excerpts)).isTrue();
        assertThat(excerpts).isEmpty();
    }

    @Test
    @DisplayName("no keyword, no mention; an unknown aspect never matches")
    void absent() {
        List<String> excerpts = new ArrayList<>();
        assertThat(KnowledgeMentionCheck.mentions("색상 안내", "화면과 실제 색은 다를 수 있습니다.",
                IssueVocabulary.keywordsOf("접착"), excerpts)).isFalse();
        assertThat(KnowledgeMentionCheck.mentions("접착", "붙이세요.", IssueVocabulary.keywordsOf("없는축"), excerpts))
                .isFalse();
        assertThat(excerpts).isEmpty();
    }

    @Test
    @DisplayName("excerpts are bounded: three sentences, two hundred characters each")
    void bounded() {
        List<String> excerpts = new ArrayList<>();
        String longSentence = "접착 " + "가".repeat(300) + ".";
        String body = String.join(" ", longSentence, "테이프 하나.", "테이프 둘.", "테이프 셋.", "테이프 넷.");
        assertThat(KnowledgeMentionCheck.mentions("", body, IssueVocabulary.keywordsOf("접착"), excerpts)).isTrue();
        assertThat(excerpts).hasSize(KnowledgeMentionCheck.EXCERPT_LIMIT);
        assertThat(excerpts.get(0)).hasSize(KnowledgeMentionCheck.EXCERPT_CHARS).endsWith("…");
    }
}
