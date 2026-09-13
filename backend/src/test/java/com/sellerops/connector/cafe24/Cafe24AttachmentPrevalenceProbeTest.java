package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.cafe24.Cafe24AttachmentPrevalenceProbe.AttachmentPrevalence;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The attachment-prevalence probe, offline.
 *
 * <p>What is under test is mostly what the probe REFUSES to carry. It counts array lengths and the
 * lengths are all it keeps; the filenames and URLs that ride on the same response have no field to
 * land in, and the assertion for that is a source scan rather than a mock, because a mock can only
 * prove that today's code path did not print one.
 */
class Cafe24AttachmentPrevalenceProbeTest {

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24AttachmentPrevalenceProbe probe = new Cafe24AttachmentPrevalenceProbe(http);

    private static final LocalDate FROM = LocalDate.of(2026, 1, 1);
    private static final LocalDate TO = LocalDate.of(2026, 9, 13);

    private static Cafe24HttpClient.Response articles(String body) {
        return new Cafe24HttpClient.Response(200, body, Map.of());
    }

    @Test
    @DisplayName("counts how many articles carry an attachment and how many attachments there are")
    void measuresPrevalence() {
        http.enqueue(articles("""
                {"articles":[
                  {"article_no":1,"attach_file_urls":[{"name":"a.jpg","url":"https://x/a.jpg"}]},
                  {"article_no":2,"attach_file_urls":[]},
                  {"article_no":3},
                  {"article_no":4,"attach_file_urls":[
                      {"name":"b.jpg","url":"https://x/b.jpg"},{"name":"c.png","url":"https://x/c.png"}]}
                ]}"""));
        http.enqueue(articles("{\"articles\":[{\"article_no\":1},{\"article_no\":4}]}"));
        http.enqueue(articles("{\"articles\":[{\"article_no\":2},{\"article_no\":3}]}"));

        AttachmentPrevalence r = probe.measure("tok", "demomall", 4, FROM, TO);

        assertThat(r.outcome()).isEqualTo("OK");
        assertThat(r.requests()).isEqualTo(3);
        assertThat(r.articlesInWindow()).isEqualTo(4);
        assertThat(r.withAttachment()).isEqualTo(2);
        assertThat(r.attachmentsTotal()).isEqualTo(3L);
        assertThat(r.attachmentsMax()).isEqualTo(2);
        // The integrity check: the filter partitions the board and agrees with the field.
        assertThat(r.vendorFilteredWith()).isEqualTo(2);
        assertThat(r.vendorFilteredWithout()).isEqualTo(2);
        assertThat(r.filterPartitions()).isTrue();
        assertThat(r.filterAgreesWithField()).isTrue();
    }

    @Test
    @DisplayName("an absent array and an empty one are both zero — neither is a missing measurement")
    void absentAndEmptyAreBothZero() {
        http.enqueue(articles("{\"articles\":[{\"article_no\":1},{\"article_no\":2,\"attach_file_urls\":[]}]}"));
        http.enqueue(articles("{\"articles\":[]}"));
        http.enqueue(articles("{\"articles\":[{\"article_no\":1},{\"article_no\":2}]}"));

        AttachmentPrevalence r = probe.measure("tok", "demomall", 4, FROM, TO);

        assertThat(r.withAttachment()).isZero();
        assertThat(r.attachmentsTotal()).isZero();
        assertThat(r.attachmentsMax()).isZero();
        assertThat(r.filterPartitions()).isTrue();
        assertThat(r.filterAgreesWithField()).isTrue();
    }

    @Test
    @DisplayName("a filter that does not partition the board is reported, not silently averaged away")
    void disagreementIsReported() {
        http.enqueue(articles("{\"articles\":[{\"article_no\":1,\"attach_file_urls\":[{\"name\":\"a\",\"url\":\"u\"}]},{\"article_no\":2}]}"));
        // The vendor says nobody has one. Either the filter or the field is not what we think.
        http.enqueue(articles("{\"articles\":[]}"));
        http.enqueue(articles("{\"articles\":[{\"article_no\":1},{\"article_no\":2}]}"));

        AttachmentPrevalence r = probe.measure("tok", "demomall", 4, FROM, TO);

        assertThat(r.withAttachment()).isEqualTo(1);
        assertThat(r.vendorFilteredWith()).isZero();
        assertThat(r.filterAgreesWithField()).isFalse();
    }

    @Test
    @DisplayName("a full page says so — the denominator is a floor, and the probe does not page for more")
    void afullPageIsReportedAsAFloor() {
        StringBuilder rows = new StringBuilder();
        for (int i = 1; i <= Cafe24AttachmentPrevalenceProbe.PAGE_LIMIT; i++) {
            rows.append(i == 1 ? "" : ",").append("{\"article_no\":").append(i).append("}");
        }
        http.enqueue(articles("{\"articles\":[" + rows + "]}"));
        http.enqueue(articles("{\"articles\":[]}"));
        http.enqueue(articles("{\"articles\":[" + rows + "]}"));

        AttachmentPrevalence r = probe.measure("tok", "demomall", 4, FROM, TO);

        assertThat(r.articlesInWindow()).isEqualTo(Cafe24AttachmentPrevalenceProbe.PAGE_LIMIT);
        assertThat(r.windowFull()).isTrue();
        assertThat(http.sent).hasSize(3);
    }

    @Test
    @DisplayName("a 429 stops the run where it is and reports how many requests were actually spent")
    void rateLimitedStopsAndReportsSpend() {
        http.enqueue(articles("{\"articles\":[{\"article_no\":1}]}"));
        http.enqueue(FakeCafe24HttpClient.rateLimited429("30"));

        AttachmentPrevalence r = probe.measure("tok", "demomall", 4, FROM, TO);

        assertThat(r.outcome()).isEqualTo("RATE_LIMITED");
        assertThat(r.requests()).isEqualTo(1);
        assertThat(http.sent).hasSize(2);
    }

    @Test
    @DisplayName("the three requests are the SAME window and differ only by the documented filter")
    void theThreeRequestsDifferOnlyByTheFilter() {
        http.enqueue(articles("{\"articles\":[]}"));
        http.enqueue(articles("{\"articles\":[]}"));
        http.enqueue(articles("{\"articles\":[]}"));

        probe.measure("tok", "demomall", 4, FROM, TO);

        assertThat(http.sent).hasSize(3);
        String plain = http.sent.get(0).uri().toString();
        assertThat(plain).contains("/api/v2/admin/boards/4/articles")
                .contains("start_date=2026-01-01").contains("end_date=2026-09-13")
                .doesNotContain("attached_file");
        // Only the filter is added: same board, same window, one extra parameter.
        assertThat(http.sent.get(1).uri().toString()).contains("attached_file=T")
                .contains("start_date=2026-01-01").contains("end_date=2026-09-13");
        assertThat(http.sent.get(2).uri().toString()).contains("attached_file=F");
        // Never a write, never a comment, never an exact article, never a scope change.
        assertThat(http.sent).allSatisfy(s -> {
            assertThat(s.method()).isEqualTo("GET");
            assertThat(s.uri().toString()).doesNotContain("comments").doesNotContain("article_no=");
        });
    }

    @Test
    @DisplayName("no field on any record in this file can hold a filename or a URL")
    void nothingInThisFileCanHoldAnAttachmentValue() throws Exception {
        String source = java.nio.file.Files.readString(java.nio.file.Path.of(
                "src/main/java/com/sellerops/connector/cafe24/Cafe24AttachmentPrevalenceProbe.java"));
        // Comments are stripped BEFORE the scan. This guard's first version failed on the probe's own
        // docblock, which explains the shape it must not have — and a guard that fails because of its
        // subject's explanation is not fixed, it is deleted. The property is about the CODE.
        String code = source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");

        // The setter takes the array and keeps its size; nothing holds an element afterwards.
        assertThat(code).contains("void setAttachments(List<Object> attachments)");
        assertThat(code).contains("attachments == null ? 0 : attachments.size()");
        for (String forbidden : new String[] {
                "String url", "String name", "String fileName", "String filename",
                "record AttachmentFile", "class AttachmentFile" }) {
            assertThat(code).as("a field for %s must not exist here", forbidden).doesNotContain(forbidden);
        }
        // The article record itself: two fields, both primitive, and no reference type in sight. This is
        // the structural form of "an attachment has nowhere to land" — a substring ban would be
        // satisfied by any spelling nobody thought of.
        String rawArticle = code.substring(code.indexOf("static final class RawArticle"));
        String fields = rawArticle.substring(0, rawArticle.indexOf("@JsonProperty"));
        assertThat(fields).contains("long articleNo;").contains("int attachmentCount;");
        assertThat(fields).doesNotContain("String").doesNotContain("List").doesNotContain("Map");
        // And the report that leaves the class carries no container type at all.
        assertThat(code).contains("public record AttachmentPrevalence(");
        assertThat(code.substring(code.indexOf("public record AttachmentPrevalence("),
                        code.indexOf("static AttachmentPrevalence failed(")))
                .doesNotContain("List<").doesNotContain("Map<").doesNotContain("Object");
    }
}
