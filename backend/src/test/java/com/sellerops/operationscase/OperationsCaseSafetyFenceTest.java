package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What an OperationsCase and its investigator are not allowed to do</b> — asserted on the source, because every
 * property here is an absence. A loop that runs while nobody is looking, reads customers and calls a model is safe
 * because the code has no way to send, approve, act as a user, drive a browser, change a policy, or say more in a
 * mail than a count.
 */
class OperationsCaseSafetyFenceTest {

    private static final Path PACKAGE = Paths.get("src/main/java/com/sellerops/operationscase");

    private static String code(Path source) throws IOException {
        return Files.readString(source).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static List<Path> javaFiles() throws IOException {
        try (Stream<Path> walk = Files.walk(PACKAGE)) {
            return walk.filter(p -> p.toString().endsWith(".java")).toList();
        }
    }

    private static void assertAbsent(List<String> forbidden, String because) throws IOException {
        for (Path source : javaFiles()) {
            String text = code(source);
            for (String name : forbidden) {
                assertThat(text).as("%s: %s (found %s)", source.getFileName(), because, name).doesNotContain(name);
            }
        }
    }

    @Test
    @DisplayName("nothing here reaches a marketplace or starts a collection")
    void itTalksToNoChannel() throws IOException {
        assertAbsent(List.of("HttpClient", "HttpRequest", "RestTemplate", "WebClient", "connector.cafe24",
                "connector.naver", "connector.coupang", "ConnectorRegistry", "PullConnector", "SyncRunExecutor",
                "\"POST\"", "\"PUT\"", "\"DELETE\""),
                "a case reads what a run already collected; a channel call here would be an unattended marketplace call");
    }

    @Test
    @DisplayName("nothing here can approve, mint an action, publish or execute")
    void itCrossesNoApprovalBoundary() throws IOException {
        assertAbsent(List.of("InquiryApproval", "ApprovalService", "ActionIntent", "PublishExecution", "confirm-publish",
                "ReplyPublish", "ActionExecutor", "commandId", "approvalId", "ReviewReplyApproval", "InquiryExecution",
                "ReviewReplyExecution", "publish("),
                "prepared is not executed: the seller's approval on the owning screen is the only way anything is sent");
    }

    @Test
    @DisplayName("the investigator acts as no user and no device, and does not call this backend's HTTP API")
    void theAuthorityIsTheRunsOrganisation() throws IOException {
        for (Path source : javaFiles()) {
            String name = source.getFileName().toString();
            String text = code(source);
            assertThat(text).as("%s", name)
                    .doesNotContain("Bearer").doesNotContain("SecurityContextHolder").doesNotContain("JwtService")
                    .doesNotContain("HelperDevice").doesNotContain("deviceToken").doesNotContain("rvh_")
                    .doesNotContain("localhost:8080").doesNotContain("http://").doesNotContain("https://");
            if (!name.endsWith("Controller.java")) {
                assertThat(text).as("%s: only a controller sees the caller", name)
                        .doesNotContain("AuthPrincipal").doesNotContain("\"/api/");
            } else {
                assertThat(text).as("%s: the Home read is GET only", name)
                        .doesNotContain("@PostMapping").doesNotContain("@PutMapping")
                        .doesNotContain("@DeleteMapping").doesNotContain("@PatchMapping");
            }
        }
    }

    @Test
    @DisplayName("no browser tool and no observation command exists")
    void noLowLevelBrowserTool() throws IOException {
        assertAbsent(List.of("click(", ".fill(", "navigate(", "Playwright", "evaluate(", "openTab", "screenshot",
                "requestObservation"),
                "a source the investigator wants to see again is the runtime's to schedule; Package B schedules nothing new");
    }

    @Test
    @DisplayName("decision memory is read, never written back into policy")
    void noPolicyWriter() throws IOException {
        assertAbsent(List.of("OrgKnowledgeSourceRepository", "orgKnowledge.create", "orgKnowledge.update",
                "orgKnowledge.delete", "productKnowledge.create", "productKnowledge.update", "productKnowledge.delete",
                "AnswerStyle", "ReviewReplyTemplate", "ReviewTriageWriter", "AnswerMemory", "KnowledgeCandidate"),
                "a seller who corrected a draft three times is evidence for the next investigation, not a policy change");
    }

    @Test
    @DisplayName("an open case's status has two writers: the processor that opens it and the reconciler")
    void statusHasTwoWriters() throws IOException {
        for (Path source : javaFiles()) {
            String name = source.getFileName().toString();
            if (name.equals("OperationsCaseProcessor.java") || name.equals("OperationsCaseReconciler.java")) {
                continue;
            }
            assertThat(code(source)).as("%s: status is derived; a third writer is a third authority", name)
                    .doesNotContain(".setStatus(");
        }
    }

    @Test
    @DisplayName("the exception mail is composed from counts and channel names, never from a case's text")
    void theMailCarriesNoCaseText() throws IOException {
        for (String file : List.of("ExceptionSummaryMail.java", "OperationsCaseNotifier.java")) {
            assertThat(code(PACKAGE.resolve(file))).as(file)
                    .doesNotContain("getSummary").doesNotContain("getReasonNote").doesNotContain("getBody")
                    .doesNotContain("getTitle").doesNotContain("getRecommendedAction")
                    .doesNotContain("getMissingInformation").doesNotContain("getProductId");
        }
    }

    @Test
    @DisplayName("no repository read names a subject without also naming an organisation")
    void everyReadIsOrgScoped() throws IOException {
        for (String file : List.of("OperationsCaseRepository.java", "OperationsCaseEventRepository.java")) {
            String repository = code(PACKAGE.resolve(file));
            int body = repository.indexOf("{");
            for (String declaration : repository.substring(body + 1).split(";")) {
                String flattened = declaration.replaceAll("\\s+", " ").strip();
                if (!flattened.contains("(") || !flattened.contains(")") || flattened.startsWith("}")) {
                    continue;
                }
                assertThat(flattened).as("%s: a read that crossed organisations would put one seller's customers "
                        + "into another seller's investigation", file).containsAnyOf("orgId", "OrgId");
            }
        }
    }

    @Test
    @DisplayName("the answered-elsewhere marker the reconciler reads is the one the work item writer writes")
    void theAnsweredElsewhereMarkerCannotDrift() throws IOException {
        assertThat(Files.readString(Paths.get("src/main/java/com/sellerops/inquiry/workitem/InquiryWorkItemWriter.java")))
                .as("if this actor or phase changes, every inquiry answered on the channel reads as a seller action")
                .contains("CONNECTOR_ACTOR = \"SYSTEM:CONNECTOR_INGEST\"")
                .contains("audit.setPhaseTo(InquiryWorkItemPhase.COMPLETED)");
        assertThat(code(PACKAGE.resolve("OperationsCaseReconciler.java")))
                .contains("CONNECTOR_INGEST_ACTOR = \"SYSTEM:CONNECTOR_INGEST\"");
    }

    @Test
    @DisplayName("the tools bind the organisation once, and no tool takes one")
    void theToolsBindTheOrganisationOnce() throws IOException {
        String tools = code(PACKAGE.resolve("investigation/CaseInvestigationTools.java"));
        assertThat(tools).contains("public OrgTools forOrg(UUID orgId)").contains("private final UUID orgId;");
        int inner = tools.indexOf("public final class OrgTools");
        for (String line : tools.substring(inner).split("\\R")) {
            if (line.strip().startsWith("public ") && line.contains("(") && !line.contains("class ")) {
                assertThat(line.matches(".*\\([^)]*UUID orgId.*"))
                        .as("a tool that took an organisation could be handed another one: %s", line.strip())
                        .isFalse();
            }
        }
    }
}
