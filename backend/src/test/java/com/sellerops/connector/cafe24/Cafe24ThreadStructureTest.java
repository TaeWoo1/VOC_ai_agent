package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.SourceThreadRole;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What decides that a board article is an ANSWER rather than a QUESTION.
 *
 * <p>Every test here is the same test from a different side: <b>can this code ever call a row a reply
 * without the source having said so?</b> The failure it guards is not hypothetical — 247 was stored as
 * a customer waiting for an answer, and the text it was "waiting" for was the shop's own. The obvious
 * repair, "247 came right after 246, so it answers it", would have been the same mistake wearing a
 * different hat: on a board where two customers post in the same minute, adjacency is a coincidence,
 * and a coincidence that hides a real question is not recoverable by apology.
 */
class Cafe24ThreadStructureTest {

    @Test
    @DisplayName("a root article has no parent and is a customer inquiry")
    void rootIsRoot() {
        CanonicalInquiry root = map(article(246L, "C", null, 0));

        assertThat(root.threadRole()).isEqualTo(SourceThreadRole.ROOT);
        assertThat(root.threadRole().isCustomerInquiry()).isTrue();
        assertThat(root.threadParentExternalId()).isNull();
    }

    @Test
    @DisplayName("the parent pointer — and only it — makes a row a reply, with the parent's own key")
    void replyNamesItsParentInTheSameIdentifierSpace() {
        CanonicalInquiry reply = map(article(247L, null, 246L, 1));

        assertThat(reply.threadRole()).isEqualTo(SourceThreadRole.REPLY);
        assertThat(reply.threadRole().isCustomerInquiry()).isFalse();
        assertThat(reply.threadParentExternalId())
                .as("the relation joins on the key the parent is already stored under")
                .isEqualTo(Cafe24InquiryArticleMapper.externalId(6, 246L));
    }

    @Test
    @DisplayName("the next article number is NOT a reply to the previous one")
    void adjacencyDecidesNothing() {
        // 248 follows 247 follows 246. The source says none of them hangs off another.
        for (long articleNo : new long[] {246L, 247L, 248L}) {
            assertThat(map(article(articleNo, "N", null, 0)).threadRole())
                    .as("article %s", articleNo)
                    .isEqualTo(SourceThreadRole.ROOT);
        }
    }

    @Test
    @DisplayName("a parent of 0 or null is no parent — Cafe24 writes 0 for \"none\" on some rows")
    void zeroIsNotAParent() {
        assertThat(map(article(247L, "N", 0L, 0)).threadRole()).isEqualTo(SourceThreadRole.ROOT);
        assertThat(map(article(247L, "N", null, null)).threadRole()).isEqualTo(SourceThreadRole.ROOT);
    }

    @Test
    @DisplayName("when the two thread signals disagree the row is a reply, and says it disagreed")
    void disagreementFailsClosed() {
        Cafe24BoardArticleRow depthOnly = article(247L, null, null, 1);
        Cafe24BoardArticleRow parentOnly = article(247L, null, 246L, 0);

        assertThat(depthOnly.isThreadReply()).isTrue();
        assertThat(parentOnly.isThreadReply()).isTrue();
        assertThat(depthOnly.threadSignalsDisagree()).isTrue();
        assertThat(parentOnly.threadSignalsDisagree()).isTrue();
        assertThat(article(247L, null, 246L, 1).threadSignalsDisagree())
                .as("the shape actually observed does not trip the counter")
                .isFalse();
        assertThat(article(246L, "C", null, 0).threadSignalsDisagree()).isFalse();

        assertThat(map(depthOnly).threadParentExternalId())
                .as("no parent was named, so no relation is invented to fill the gap")
                .isNull();
    }

    @Test
    @DisplayName("a reply is never promoted to an answer — the actor is unproven")
    void aReplyCarriesNoAnswerClaim() {
        CanonicalInquiry reply = map(article(247L, null, 246L, 1));

        assertThat(reply.answerBody())
                .as("the child's own content is the answer's text only if the SHOP wrote it")
                .isNull();
        assertThat(reply.answeredAt()).isNull();
        assertThat(reply.status())
                .as("a row with no reply_status stays conservative, exactly as before")
                .isEqualTo("UNANSWERED");
    }

    @Test
    @DisplayName("no author identity is projected, so none can be persisted by accident")
    void noIdentityFieldSurvivesTheProjection() throws IOException {
        List<String> components = new ArrayList<>();
        for (var component : Cafe24BoardArticleRow.class.getRecordComponents()) {
            components.add(component.getName().toLowerCase());
        }
        assertThat(components)
                .doesNotContain("writer", "writeremail", "memberid", "clientip", "nickname",
                        "replyuserid");

        String source = Files.readString(Paths.get(
                "src/main/java/com/sellerops/connector/cafe24/Cafe24BoardArticleRow.java"));
        for (String key : new String[] {"\"writer\"", "\"member_id\"", "\"client_ip\"",
                "\"writer_email\"", "\"nick_name\"", "\"reply_user_id\""}) {
            assertThat(source)
                    .as("a JSON key that is never named cannot be bound")
                    .doesNotContain(key);
        }
    }

    @Test
    @DisplayName("nothing in main derives a thread relation from article numbers")
    void noArticleNumberArithmeticAnywhere() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(Paths.get("src/main/java/com/sellerops"))) {
            for (Path file : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String code = stripComments(Files.readString(file));
                if (!code.contains("articleNo")) {
                    continue;
                }
                // "the article before this one" can only be written as arithmetic on the number.
                if (code.matches("(?s).*articleNo\\(\\)\\s*[-+]\\s*1.*")
                        || code.matches("(?s).*articleNo\\s*[-+]\\s*1.*")) {
                    offenders.add(file.getFileName().toString());
                }
            }
        }
        assertThat(offenders)
                .as("adjacency is a coincidence; only parent_article_no is a relation")
                .isEmpty();
    }

    private static CanonicalInquiry map(Cafe24BoardArticleRow row) {
        return Cafe24InquiryArticleMapper.toCanonicalInquiry(6, row, 1);
    }

    private static Cafe24BoardArticleRow article(long articleNo, String replyStatus,
                                                 Long parentNo, Integer depth) {
        return new Cafe24BoardArticleRow(articleNo, "제목", "본문", 77L, null,
                "2026-06-20T10:00:00+09:00", null, replyStatus, "F", null, parentNo, depth, 1);
    }

    private static String stripComments(String code) {
        return code.replaceAll("(?s)/\\*.*?\\*/", " ").replaceAll("(?m)//.*$", " ");
    }
}
