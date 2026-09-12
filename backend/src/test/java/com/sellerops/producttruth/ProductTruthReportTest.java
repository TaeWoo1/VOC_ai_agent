package com.sellerops.producttruth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * Keeps the rendered summary equal to what the ledger actually says.
 *
 * <p>A generated report that can drift from its own source is worse than no report: it is a second
 * confident copy. So this rewrites the committed file whenever it differs and fails, which makes
 * "regenerate" a rerun rather than a command nobody remembers.
 */
class ProductTruthReportTest {

    private static final Path REPO = Path.of("..").toAbsolutePath().normalize();
    private static final Path REPORT = REPO.resolve("docs/product_truth_matrix.md");

    @Test
    void theCommittedSummaryMatchesTheLedger() throws Exception {
        String rendered = ProductTruthReport.render(ProductTruthPack.load());
        String committed = Files.exists(REPORT)
                ? Files.readString(REPORT, StandardCharsets.UTF_8)
                : "";
        if (!rendered.equals(committed)) {
            Files.writeString(REPORT, rendered, StandardCharsets.UTF_8);
            fail("docs/product_truth_matrix.md 가 원장과 달라 다시 생성했습니다. "
                    + "변경을 확인하고 커밋한 뒤 다시 실행하세요.");
        }
    }

    @Test
    void theSummaryNamesEveryChannelObjectPairAndSeparatesTheRoadmap() {
        String rendered = ProductTruthReport.render(ProductTruthPack.load());
        for (String channel : ProductTruthPack.CHANNELS) {
            assertThat(rendered).contains("### " + channel);
        }
        // The roadmap gets its own heading that says what it is not, so a reader skimming the page
        // cannot take a direction for a feature.
        assertThat(rendered).contains("## 로드맵 — 현재 기능이 아님");
        assertThat(rendered).contains("## 사람이 확인해야 하는 항목");
    }
}
