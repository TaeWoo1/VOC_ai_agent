package com.sellerops.producttruth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.sellerops.producttruth.dto.ProductTruthView;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * Keeps a JSON copy of the reviewed ledger under {@code contracts/} so the Agent runtime can be tested
 * against what a person actually approved.
 *
 * <p><b>Why a file rather than a fixture.</b> The runtime is a separate process in another language, so
 * its tests would otherwise assert against a hand-typed copy of these rows — and a hand-typed copy of a
 * ledger is the second copy this whole package exists to prevent. This is the same shape as
 * {@code ProductTruthReportTest}: the file is regenerated whenever it differs and the test fails, so
 * "the ledger moved and the runtime's expectations did not" is a red build rather than a discovery.
 *
 * <p>It is the same bytes {@code GET /api/product-truth} serves, produced by the same catalog, so a
 * runtime test standing on this file is standing on the wire shape.
 */
class ProductTruthContractTest {

    private static final Path REPO = Path.of("..").toAbsolutePath().normalize();
    private static final Path CONTRACT = REPO.resolve("contracts/product-truth/v1/ledger.json");

    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    @Test
    void theCommittedContractMatchesTheLedger() throws Exception {
        ProductTruthView view = new ProductTruthCatalog().view();
        // The catalog swallows a load failure into an empty view, which is right for a running
        // deployment and wrong for this test: an empty contract would silently disarm every runtime
        // assertion that stands on it.
        assertThat(view.capabilities()).as("원장을 읽지 못했습니다").isNotEmpty();

        String rendered = JSON.writeValueAsString(view) + "\n";
        String committed = Files.exists(CONTRACT) ? Files.readString(CONTRACT, StandardCharsets.UTF_8) : "";
        if (!rendered.equals(committed)) {
            Files.createDirectories(CONTRACT.getParent());
            Files.writeString(CONTRACT, rendered, StandardCharsets.UTF_8);
            fail("contracts/product-truth/v1/ledger.json 이 원장과 달라 다시 생성했습니다. "
                    + "변경을 확인하고 커밋한 뒤 다시 실행하세요.");
        }
    }

    /**
     * The wire carries evidence, and it must — the runtime refuses to send a capability whose strength
     * is not also stated in Korean, and it cannot make that check without the level.
     */
    @Test
    void theContractCarriesWhatTheRuntimeNeedsToRefuseAnOverclaim() {
        ProductTruthView view = new ProductTruthCatalog().view();
        assertThat(view.capabilities()).allSatisfy(c -> {
            assertThat(c.evidence()).as("%s evidence", c.id()).isNotBlank();
            // Below live-proven, the Korean caveat is what the runtime is allowed to send instead of
            // the level. A row without one would be dropped there, so the ledger keeping them is the
            // difference between a narrower answer and a missing capability.
            //
            // Only rows that CLAIM a path need one: a NOT_SUPPORTED row's own sentence is the caveat
            // (「그 기능은 없습니다」), and there is nothing in it that could be read as stronger than it
            // is. Requiring a limitation there would be asking a refusal to qualify itself.
            if (claims(c.status()) && !"LIVE_PROVEN".equals(c.evidence())) {
                assertThat(c.limitations()).as("%s 한계", c.id()).isNotEmpty();
            }
            c.subtypes().forEach(sub -> {
                if (claims(sub.status()) && !"LIVE_PROVEN".equals(sub.evidence())) {
                    assertThat(sub.limitations()).as("%s 한계", sub.id()).isNotEmpty();
                }
            });
        });
        assertThat(view.features()).allSatisfy(f -> {
            if (claims(f.status()) && !"LIVE_PROVEN".equals(f.evidence())) {
                assertThat(f.limitations()).as("%s 한계", f.id()).isNotEmpty();
            }
        });
        assertThat(view.roadmap()).allSatisfy(r -> assertThat(r.qualifier()).isNotBlank());
    }

    /** A row that says the product can do something. The other two say it cannot, or that nobody looked. */
    private static boolean claims(String status) {
        return "SUPPORTED".equals(status) || "PARTIAL".equals(status);
    }
}
