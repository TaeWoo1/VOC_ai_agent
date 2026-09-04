package com.sellerops.report;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What the report package can never do, pinned by name — the twin of {@code OpportunitySafetyFenceTest}.
 * A report reads; it writes one row of its own; it reaches the model through one door in another package.
 */
class ReportSafetyFenceTest {

    private static final Path PKG = Path.of("src", "main", "java", "com", "sellerops", "report");

    private static String strip(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static List<String[]> sources() throws IOException {
        List<String[]> out = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(PKG)) {
            for (Path p : walk.filter(f -> f.toString().endsWith(".java")).toList()) {
                out.add(new String[] {p.getFileName().toString(), strip(Files.readString(p))});
            }
        }
        return out;
    }

    @Test
    @DisplayName("no channel, no HTTP, no approval, no execution, no direct model transport")
    void noSideEffectsBeyondItsOwnRow() throws IOException {
        List<String> forbidden = List.of("Connector", "HttpClient", "WebClient", "RestTemplate", "Approval",
                "ActionExecutor", "Publish", "AgentLlmTransport", "AgentLlmWireFormat", "ChatModel",
                "KnowledgeSource", "OrgKnowledge", "InquiryReplyDraft", "ReviewReplyDraft");
        List<String> offenders = new ArrayList<>();
        for (String[] s : sources()) {
            for (String word : forbidden) {
                if (s[1].contains(word)) {
                    offenders.add(s[0] + " names " + word);
                }
            }
        }
        assertThat(offenders).isEmpty();
    }

    @Test
    @DisplayName("the only write in the package is the report row itself")
    void theOnlyWriterIsTheReportRow() throws IOException {
        List<String> offenders = new ArrayList<>();
        for (String[] s : sources()) {
            String code = s[1];
            int saves = code.split("\\.save\\(", -1).length - 1;
            int deletes = code.split("\\.delete", -1).length - 1;
            if (deletes > 0) {
                offenders.add(s[0] + " deletes");
            }
            if (saves > 0 && !(s[0].equals("AgentReportService.java") && code.contains("reports.save("))) {
                offenders.add(s[0] + " saves something else");
            }
        }
        assertThat(offenders).isEmpty();
    }

    @Test
    void theMigrationExists() {
        assertThat(Files.exists(Path.of("src", "main", "resources", "db", "migration", "V96__agent_report.sql")))
                .isTrue();
    }
}
