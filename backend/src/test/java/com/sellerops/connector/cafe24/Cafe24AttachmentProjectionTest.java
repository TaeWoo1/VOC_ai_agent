package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Media Presence Projection v1 — the length, and only the length.</b>
 *
 * <p>`attach_file_urls` has ridden on every board-article response this connector has ever received.
 * An approved bounded READ measured it populated (1 of 7 board-4 articles, 1 file). These tests pin
 * what is projected — a count — and, more importantly, what structurally cannot be: the array's
 * {@code name} and {@code url} have no field anywhere on this path.
 */
class Cafe24AttachmentProjectionTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private Cafe24BoardArticleRow parse(String json) throws Exception {
        return mapper.readValue(json, Cafe24BoardArticleRow.class);
    }

    @Test
    @DisplayName("an array of two files projects 2, and the filenames go nowhere")
    void projectsTheLength() throws Exception {
        Cafe24BoardArticleRow row = parse("{\"article_no\":10,\"title\":\"좋아요\","
                + "\"attach_file_urls\":[{\"name\":\"a.jpg\",\"url\":\"https://x/a.jpg\"},"
                + "{\"name\":\"b.png\",\"url\":\"https://x/b.png\"}]}");

        assertThat(row.attachmentCount()).isEqualTo(2);
        // The row's whole toString is the projection; no filename can appear in it because no field holds one.
        assertThat(row.toString()).doesNotContain("a.jpg").doesNotContain("https://x");
    }

    @Test
    @DisplayName("an EMPTY array is an observation of zero — the article was read and had none")
    void anEmptyArrayIsAnObservedZero() throws Exception {
        assertThat(parse("{\"article_no\":11,\"attach_file_urls\":[]}").attachmentCount()).isZero();
    }

    @Test
    @DisplayName("an ABSENT key is null — «the response did not say», which is not zero")
    void anAbsentKeyIsUnobserved() throws Exception {
        assertThat(parse("{\"article_no\":12,\"title\":\"t\"}").attachmentCount()).isNull();
        assertThat(parse("{\"article_no\":13,\"attach_file_urls\":null}").attachmentCount()).isNull();
    }

    @Test
    @DisplayName("an unexpected shape is zero, not a thrown sweep — this sits on the routine path")
    void anUnexpectedShapeDoesNotBreakCollection() throws Exception {
        assertThat(parse("{\"article_no\":14,\"attach_file_urls\":\"nope\"}").attachmentCount()).isZero();
        assertThat(parse("{\"article_no\":15,\"attach_file_urls\":{\"a\":1}}").attachmentCount()).isZero();
    }

    @Test
    @DisplayName("everything else the row already projected still parses — the creator did not narrow it")
    void theRestOfTheProjectionIsUnchanged() throws Exception {
        Cafe24BoardArticleRow row = parse("{\"article_no\":16,\"title\":\"t\",\"content\":\"c\","
                + "\"product_no\":7,\"rating\":4,\"created_date\":\"2026-09-01T10:00:00+09:00\","
                + "\"reply_status\":\"C\",\"secret\":\"F\",\"order_id\":\"o-1\","
                + "\"parent_article_no\":3,\"reply_depth\":1,\"reply_sequence\":2,"
                + "\"writer\":\"홍길동\",\"writer_email\":\"a@b.c\",\"member_id\":\"m\"}");

        assertThat(row.articleNo()).isEqualTo(16L);
        assertThat(row.productNo()).isEqualTo(7L);
        assertThat(row.rating()).isEqualTo(4);
        assertThat(row.replyStatus()).isEqualTo("C");
        assertThat(row.parentArticleNo()).isEqualTo(3L);
        assertThat(row.attachmentCount()).isNull();
        // The buyer keys are still unprojected — the rule this file has always stated.
        assertThat(row.toString()).doesNotContain("홍길동").doesNotContain("a@b.c");
    }

    @Test
    @DisplayName("no field on this path can hold a filename or a URL")
    void noFieldCanHoldAnAttachmentValue() throws Exception {
        String count = strip(Files.readString(
                Path.of("src/main/java/com/sellerops/connector/cafe24/AttachmentCount.java")));
        String row = strip(Files.readString(
                Path.of("src/main/java/com/sellerops/connector/cafe24/Cafe24BoardArticleRow.java")));

        // The value type holds one int and nothing else.
        assertThat(count).contains("public record AttachmentCount(int value)");
        assertThat(count).doesNotContain("String ").doesNotContain("List<").doesNotContain("readValueAsTree");
        // …and it counts tokens rather than building a tree, so a URL is never a Java object.
        assertThat(count).contains("skipChildren()");
        for (String forbidden : new String[] { "String url", "String name", "String fileName", "attachFileUrls" }) {
            assertThat(row).as("%s must not exist on the row", forbidden).doesNotContain(forbidden);
        }
    }

    /** Comments first: a guard that fails on its subject's own explanation gets deleted, not fixed. */
    private static String strip(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }
}
