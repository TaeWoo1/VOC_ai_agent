package com.sellerops.attention.reply;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>A template is a style layer, and this test is what keeps it one.</b>
 *
 * <p>Review Reply Template Settings v1 lets an organization choose HOW a review is answered. It must
 * never become the place where WHAT is true arrives: a template that could interpolate a product
 * spec, a policy sentence, an order state or a model's output would be a grounded drafter with no
 * grounding — the seller's own words presented as facts nobody checked. Grounded review drafting,
 * when it is built, composes WITH this layer; it does not arrive through it.
 *
 * <p>Checked by name, the way the other fences in this repository are, so the refusal survives a
 * rewrite of the classes rather than living in a review comment.
 */
class ReviewReplyTemplateFenceTest {

    private static final Path DIR =
            Path.of("src/main/java/com/sellerops/attention/reply");

    private static final List<String> TEMPLATE_SOURCES = List.of(
            "ReviewReplyTemplateKey.java",
            "ReviewReplyTemplate.java",
            "ReviewReplyTemplateRepository.java",
            "ReviewReplyTemplateService.java",
            "ReviewReplyTemplateController.java");

    /**
     * Names no fact source may appear in the template package. Knowledge/policy retrieval, order
     * state, product detail, answer memory and every model seam — a template that reaches one of
     * these is no longer a template.
     */
    private static final List<String> FORBIDDEN = List.of(
            "KnowledgeRetriever", "ProductKnowledge", "OrgKnowledge", "AnswerMemory",
            "OrderFact", "ProductRepository", "InquiryRepository", "ReviewRepository",
            "AgentLlm", "OpenAi", "ChatModel", "prompt", "Prompt");

    /** Placeholder syntaxes a "minimal" edit would use to splice a fact into a template. */
    private static final List<String> FORBIDDEN_INTERPOLATION = List.of("{{", "%s\"", "${");

    private static String read(String name) throws IOException {
        return Files.readString(DIR.resolve(name));
    }

    @Test
    @DisplayName("the template package reaches no fact source and no model")
    void templatesAreStyleOnly() throws IOException {
        for (String name : TEMPLATE_SOURCES) {
            String src = read(name);
            for (String word : FORBIDDEN) {
                assertThat(src).as("%s must not name %s", name, word).doesNotContain(word);
            }
        }
    }

    @Test
    @DisplayName("a template is a whole reply, not a sentence with slots")
    void templatesHaveNoInterpolationSyntax() throws IOException {
        for (String name : TEMPLATE_SOURCES) {
            String src = read(name);
            for (String token : FORBIDDEN_INTERPOLATION) {
                assertThat(src).as("%s must not carry %s", name, token).doesNotContain(token);
            }
        }
    }

    /**
     * v1 is org-wide. A product, account or channel column would be a promise to resolve a precedence
     * order nobody has specified — and the place it would first appear is this service's lookup.
     */
    @Test
    @DisplayName("the override is keyed by organization and by nothing else")
    void theOverrideIsOrgWide() throws IOException {
        String service = read("ReviewReplyTemplateService.java");
        String entity = read("ReviewReplyTemplate.java");
        for (String word : List.of("productId", "sellerAccountId", "channelId", "channelCode")) {
            assertThat(service).as("service must not key on %s", word).doesNotContain(word);
            assertThat(entity).as("entity must not carry %s", word).doesNotContain(word);
        }
    }

    /**
     * The approval contract is not this package's business. A template save must not be able to touch
     * a draft version, a fingerprint, an approval or an execution binding — which is why none of those
     * types is named here.
     */
    @Test
    @DisplayName("saving a template cannot reach a draft version, a fingerprint or an approval")
    void templatesCannotReachTheApprovalContract() throws IOException {
        for (String name : TEMPLATE_SOURCES) {
            String src = read(name);
            for (String word : List.of("ReviewReplyDraft", "ReviewReplyApproval", "ReviewReplyFingerprint",
                    "ReviewReplySubmissionRef", "contentFingerprint")) {
                assertThat(src).as("%s must not name %s", name, word).doesNotContain(word);
            }
        }
    }
}
