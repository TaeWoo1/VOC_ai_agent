package com.sellerops.knowledge.memory;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Who is allowed to write a memory</b> — asserted on the source, because the property is an
 * absence and an absence has no runtime to test.
 *
 * <p>The whole value of Answer Memory rests on it containing only what the seller actually did. The
 * failure mode is not dramatic: someone adds "remember the draft we just generated" to make a demo
 * look smarter, and from then on the model reads its own unapproved output back as precedent. Every
 * citation still says "판매자의 과거 답변", so nothing looks wrong — which is exactly why this is a
 * fence and not a code review note.
 *
 * <p>Two writers exist and both record a completed human act: the importer, for an answer the channel
 * says the seller published, and the publish hook, for an approval and a verified send. The draft
 * composer is not on the list and adding it must fail here.
 */
class AnswerMemoryWriteFenceTest {

    /** The only classes that may record a memory, and why each one qualifies. */
    private static final Set<String> ALLOWED = Set.of(
            // The channel says the seller published this answer.
            "InquiryAnswerMemoryImporter.java",
            // The seller approved this exact draft version, or the send was verified.
            "InquiryAnswerMemoryHook.java",
            // The service itself.
            "AnswerMemoryService.java");

    @Test
    @DisplayName("only the importer and the publish hook record a memory")
    void onlyTwoWritersExist() throws IOException {
        Path main = Paths.get("src/main/java/com/sellerops");
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(main)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String file = source.getFileName().toString();
                if (ALLOWED.contains(file)) {
                    continue;
                }
                String code = Files.readString(source);
                if (code.contains("AnswerMemoryService.RememberCommand")
                        || code.contains("answerMemory.remember(")
                        || code.contains("memory.remember(")) {
                    offenders.add(file);
                }
            }
        }
        assertThat(offenders)
                .as("a third writer means something other than a seller's own act is being remembered")
                .isEmpty();
    }

    @Test
    @DisplayName("the draft composer holds no reference to answer memory at all")
    void theDraftComposerCannotRemember() throws IOException {
        String composer = Files.readString(
                Paths.get("src/main/java/com/sellerops/inquiry/draft/InquiryDraftComposer.java"));

        assertThat(composer)
                .as("a draft is not an answer until a person says it is")
                .doesNotContain("AnswerMemoryService")
                .doesNotContain("AnswerMemoryStrength");
    }

    @Test
    @DisplayName("no strength exists for a draft — the vocabulary itself refuses one")
    void thereIsNoStrengthForADraft() {
        for (AnswerMemoryStrength strength : AnswerMemoryStrength.values()) {
            assertThat(strength.name()).doesNotContain("DRAFT").doesNotContain("GENERATED");
        }
        assertThat(AnswerMemoryStrength.values()).hasSize(3);
        assertThat(AnswerMemoryStrength.EXECUTOR_SENT_VERIFIED.rank())
                .as("proof of delivery outranks an approval, which outranks a collected answer")
                .isGreaterThan(AnswerMemoryStrength.USER_APPROVED.rank());
        assertThat(AnswerMemoryStrength.USER_APPROVED.rank())
                .isGreaterThan(AnswerMemoryStrength.IMPORTED_SELLER_ANSWER.rank());
    }

    @Test
    @DisplayName("answer memory never writes a policy — a precedent does not become a rule by itself")
    void memoryNeverWritesAPolicy() throws IOException {
        String service = Files.readString(Paths.get(
                "src/main/java/com/sellerops/knowledge/memory/AnswerMemoryService.java"));

        assertThat(service)
                .as("promoting \"what we said last time\" into \"what we do\" is a decision a person makes")
                .doesNotContain("OrgKnowledgeSourceRepository")
                .doesNotContain("SellerOperationsKnowledgeService");
    }
}
