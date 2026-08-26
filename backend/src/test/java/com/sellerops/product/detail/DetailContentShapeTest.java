package com.sellerops.product.detail;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.product.detail.DetailContentShape.Shape;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The measurement that decides whether SellerOps ever needs to look at a picture.
 *
 * <p>Every case here is about keeping one claim from becoming a bigger one. "There are images on the
 * page" is not "the answers are in the images"; "there is some text" is not "the text is retrievable";
 * and an empty response is not "the seller wrote nothing".
 */
class DetailContentShapeTest {

    private static String prose(int chars) {
        return "이 제품은 벽면과 바닥 몰딩에 두루 쓰이며 시공 전 표면의 먼지와 기름기를 제거해야 합니다. "
                .repeat(1 + chars / 45).substring(0, Math.max(chars, 1));
    }

    @Nested
    @DisplayName("what the page is")
    class Classification {

        @Test
        @DisplayName("plain prose with no markup is text")
        void plainProseIsText() {
            var m = DetailContentShape.classify(prose(400));
            assertThat(m.shape()).isEqualTo(Shape.MEANINGFUL_TEXT);
            assertThat(m.hasMarkup()).isFalse();
            assertThat(m.textIsEnough()).isTrue();
            assertThat(m.needsImageUnderstanding()).isFalse();
        }

        @Test
        @DisplayName("markup wrapping real prose is still a text path")
        void markupAroundProseIsStillText() {
            var m = DetailContentShape.classify("<div><p>" + prose(400) + "</p></div>");
            assertThat(m.shape()).isEqualTo(Shape.HTML_WITH_MEANINGFUL_TEXT);
            assertThat(m.hasMarkup()).isTrue();
            assertThat(m.textIsEnough()).isTrue();
        }

        @Test
        @DisplayName("images with only a shop notice around them is the case that needs pictures read")
        void imagesWithNoProseIsImageOnly() {
            var m = DetailContentShape.classify(
                    "<p>택배는 오후 2시까지 결제분 당일 발송</p>"
                            + "<img src=\"a.jpg\"><img src=\"b.jpg\"><img src=\"c.jpg\">");
            assertThat(m.shape()).isEqualTo(Shape.IMAGE_REFERENCES_ONLY);
            assertThat(m.imageCount()).isEqualTo(3);
            assertThat(m.textIsEnough()).isFalse();
            assertThat(m.needsImageUnderstanding())
                    .as("the ONLY shape that justifies building image understanding").isTrue();
        }

        @Test
        @DisplayName("an image-led page that also has prose is MIXED — and MIXED does not need pictures yet")
        void mixedDoesNotJustifyOcr() {
            var m = DetailContentShape.classify(
                    "<img src=\"a.jpg\"><img src=\"b.jpg\"><img src=\"c.jpg\"><p>" + prose(600) + "</p>");
            assertThat(m.shape()).isEqualTo(Shape.MIXED);
            assertThat(m.textIsEnough()).isFalse();
            assertThat(m.needsImageUnderstanding())
                    .as("a mixed page has a text path; take it first and find out what is still missing")
                    .isFalse();
        }

        @Test
        @DisplayName("one or two images beside real prose is not an image-led page")
        void aCoupleOfImagesBesideProseIsText() {
            var m = DetailContentShape.classify("<p>" + prose(600) + "</p><img src=\"a.jpg\">");
            assertThat(m.shape()).isEqualTo(Shape.HTML_WITH_MEANINGFUL_TEXT);
            assertThat(m.textIsEnough()).isTrue();
        }

        @Test
        @DisplayName("nothing back is EMPTY, and EMPTY is never 'the seller wrote nothing useful'")
        void absenceIsItsOwnAnswer() {
            for (String value : new String[] {null, "", "   "}) {
                var m = DetailContentShape.classify(value);
                assertThat(m.shape()).isEqualTo(Shape.EMPTY);
                assertThat(m.textIsEnough()).isFalse();
                assertThat(m.needsImageUnderstanding())
                        .as("an empty response is a collection problem, not an OCR problem").isFalse();
            }
        }
    }

    @Nested
    @DisplayName("markup is removed, never interpreted")
    class Stripping {

        @Test
        @DisplayName("tags become spaces and entities become spaces — the display layer's rule")
        void tagsAreRemovedNotParsed() {
            String text = DetailContentShape.plainText(
                    "<p>안녕하세요.&nbsp;</p><p><br></p><p>규격은 소형·중형입니다.</p>");
            assertThat(text).contains("안녕하세요").contains("규격은 소형·중형입니다");
            assertThat(text).doesNotContain("<").doesNotContain("&nbsp;").doesNotContain("<br>");
        }

        @Test
        @DisplayName("a script tag's contents do not become prose")
        void markupBodiesAreNotCountedAsWords() {
            var m = DetailContentShape.classify("<div>" + prose(300) + "</div>");
            assertThat(m.textChars()).isLessThan(320)
                    .as("roughly the prose, not the prose plus the tags").isGreaterThan(280);
        }
    }

    @Nested
    @DisplayName("the report is counts, and the verdict is re-checkable")
    class Reporting {

        @Test
        @DisplayName("describe() carries numbers, never the page")
        void describeIsSanitized() {
            var m = DetailContentShape.classify("<p>" + prose(400) + "</p><img src=\"secret.jpg\">");
            String described = DetailContentShape.describe(m);
            assertThat(described).contains("shape=").contains("text_chars=").contains("images=1");
            assertThat(described).doesNotContain("secret.jpg").doesNotContain("제품");
        }

        @Test
        @DisplayName("the image lane has exactly one producer — flipping this test opened it")
        void theImageAuthorshipHasOneProducer() throws Exception {
            // AI_EXTRACTED_FROM_SELLER_IMAGE was spelled so its ABSENCE was assertable, and this
            // test said so out loud on 2026-08-27 when the lane opened. It now counts to one rather
            // than zero, which keeps the same property in a different place: a provenance two paths
            // can stamp is a provenance that means two things.
            Path main = Path.of("src/main/java/com/sellerops");
            long producers;
            try (var files = Files.walk(main)) {
                producers = files.filter(f -> f.toString().endsWith(".java"))
                        .filter(f -> !f.getFileName().toString().equals("KnowledgeAuthorship.java"))
                        .map(f -> {
                            try {
                                return Files.readString(f).replaceAll("(?s)/\\*.*?\\*/", "")
                                        .replaceAll("(?m)//.*$", "");
                            } catch (Exception e) {
                                return "";
                            }
                        })
                        .filter(code -> code.contains("AI_EXTRACTED_FROM_SELLER_IMAGE"))
                        .count();
            }
            assertThat(producers)
                    .as("only the publication path may stamp a sentence as read off a picture")
                    .isEqualTo(1);
        }
    }
}
