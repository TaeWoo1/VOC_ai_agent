package com.sellerops.agent.llm.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.report.ReportNarrative;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class AgentReportNarrativeGeneratorTest {

    @Test
    void parsesTheSchemaAndSkipsMalformedLines() {
        Optional<ReportNarrative> parsed = AgentReportNarrativeGenerator.parse("""
                ```json
                {"headline":"리뷰가 늘었습니다","lines":[
                  {"text":"리뷰 81건.","facts":["c-reviews"]},
                  {"text":"근거 없는 문장"},
                  {"facts":["c-reviews"]},
                  {"text":"문의 5건.","facts":["c-inquiries", 7]}
                ]}
                ```
                """);
        assertThat(parsed).isPresent();
        assertThat(parsed.get().headline()).isEqualTo("리뷰가 늘었습니다");
        assertThat(parsed.get().lines()).hasSize(2);
        assertThat(parsed.get().lines().get(1).factIds()).containsExactly("c-inquiries");
    }

    @Test
    void anythingThatIsNotAnObjectIsOffSchema() {
        assertThat(AgentReportNarrativeGenerator.parse("[]")).isEmpty();
        assertThat(AgentReportNarrativeGenerator.parse("not json")).isEmpty();
    }
}
