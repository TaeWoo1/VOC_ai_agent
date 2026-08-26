package com.sellerops.product.detail;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

class DetailImageReferencesTest {

    @Nested
    @DisplayName("what the page pointed at")
    class Extraction {

        @Test
        @DisplayName("every <img src> in document order, https only")
        void readsSourcesInOrder() {
            var refs = DetailImageReferences.extract(
                    "<p>안내</p><img src=\"https://cdn.example.com/a.jpg\">"
                            + "<div><img src='https://cdn.example.com/b.png' alt=\"규격\"></div>");
            assertThat(refs.urls()).containsExactly(
                    "https://cdn.example.com/a.jpg", "https://cdn.example.com/b.png");
            assertThat(refs.imgTags()).isEqualTo(2);
        }

        @Test
        @DisplayName("a protocol-relative src resolves to https; a plain http one is refused, not upgraded")
        void schemeHandling() {
            var refs = DetailImageReferences.extract(
                    "<img src=\"//cdn.example.com/a.jpg\"><img src=\"http://cdn.example.com/b.jpg\">");
            assertThat(refs.urls()).containsExactly("https://cdn.example.com/a.jpg");
            assertThat(refs.insecureOrOther()).isEqualTo(1);
        }

        @Test
        @DisplayName("a data: URI is counted, never fetched")
        void inlineDataIsCountedNotFetched() {
            var refs = DetailImageReferences.extract("<img src=\"data:image/png;base64,AAAA\">");
            assertThat(refs.urls()).isEmpty();
            assertThat(refs.inlineData()).isEqualTo(1);
        }

        @Test
        @DisplayName("the same URL twice is one picture, and the repeat is reported")
        void duplicatesAreCollapsedAndCounted() {
            var refs = DetailImageReferences.extract(
                    "<img src=\"https://cdn.example.com/a.jpg\"><img src=\"https://cdn.example.com/a.jpg\">");
            assertThat(refs.urls()).hasSize(1);
            assertThat(refs.duplicateUrls()).isEqualTo(1);
            assertThat(refs.imgTags()).isEqualTo(2);
        }

        @Test
        @DisplayName("&amp; in a query string is the character the browser sends")
        void entitiesAreUnescaped() {
            var refs = DetailImageReferences.extract(
                    "<img src=\"https://cdn.example.com/a.jpg?w=100&amp;h=200\">");
            assertThat(refs.urls()).containsExactly("https://cdn.example.com/a.jpg?w=100&h=200");
        }

        @Test
        @DisplayName("nothing to read is not an error")
        void emptyIsNotAnError() {
            assertThat(DetailImageReferences.extract(null).urls()).isEmpty();
            assertThat(DetailImageReferences.extract("  ").imgTags()).isZero();
            assertThat(DetailImageReferences.extract("<p>글만 있습니다</p>").urls()).isEmpty();
        }

        @Test
        @DisplayName("describe() is counts — no URL, no markup, no seller text")
        void describeIsSanitized() {
            var refs = DetailImageReferences.extract(
                    "<p>선바로 몰딩</p><img src=\"https://cdn.example.com/secret-banner.jpg\">");
            assertThat(refs.describe())
                    .contains("img_tags=1").contains("fetchable=1")
                    .doesNotContain("secret-banner").doesNotContain("cdn.example.com")
                    .doesNotContain("선바로");
        }
    }

    @Nested
    @DisplayName("the detail page and the listing gallery are different sets")
    class GallerySeparation {

        /**
         * The near-miss this class exists for. {@code NaverProductDetail.imageUrls()} is the listing
         * GALLERY — representative plus optional images, product photographs beside the price. The
         * 상세페이지 pictures are the {@code <img>} tags inside {@code detailContent}. Feeding the
         * gallery to a grounding lane would be reading photographs and reporting that the page said
         * nothing, so the separation is asserted rather than remembered.
         */
        @Test
        @DisplayName("no main source passes the listing gallery into the image lane")
        void theGalleryNeverReachesTheImageLane() throws IOException {
            Path main = Path.of("src", "main", "java", "com", "sellerops");
            List<String> offenders = new ArrayList<>();
            try (Stream<Path> walk = Files.walk(main)) {
                for (Path source : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                    String code = Files.readString(source)
                            .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
                    if (!code.contains("imageUrls()")) {
                        continue;
                    }
                    // Naming the gallery is fine — counting it, storing its size, reporting it.
                    // Handing it to the reference extractor or to the fetcher is not.
                    if (code.contains("DetailImageReferences") || code.contains("DetailImageFetcher")) {
                        boolean fedToLane = code.contains("extract(") && code.contains("imageUrls()")
                                && code.matches("(?s).*(extract|fetchAll)\\([^)]*imageUrls\\(\\).*");
                        if (fedToLane) {
                            offenders.add(source.getFileName().toString());
                        }
                    }
                }
            }
            assertThat(offenders)
                    .as("the listing gallery is product photography, not a source of specifications")
                    .isEmpty();
        }

        @Test
        @DisplayName("extract() takes the markup and nothing else — a gallery cannot arrive")
        void theSignatureAdmitsOnlyMarkup() {
            assertThat(DetailImageReferences.class.getDeclaredMethods())
                    .filteredOn(m -> m.getName().equals("extract"))
                    .allSatisfy(m -> assertThat(m.getParameterTypes())
                            .as("one String, so there is no overload a List<String> could reach")
                            .containsExactly(String.class));
        }
    }
}
