package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What the Proactive Operations Agent is not allowed to do</b> — asserted on the source, because
 * every property here is an absence, and an absence has no runtime to test.
 *
 * <p>The feature's whole risk is in one sentence: a loop that runs without being asked, that reads a
 * seller's customers, and that produces text. What keeps it safe is not that it currently behaves —
 * it is that the code has no way to send, no way to approve, and no way to invent a fact. Those three
 * are checked here by name, so the day someone adds a convenient import the build says so.
 */
class ProactiveSafetyFenceTest {

    private static final Path PACKAGE = Paths.get("src/main/java/com/sellerops/proactive");
    private static final Path MIGRATION =
            Paths.get("src/main/resources/db/migration/V75__proactive_case.sql");

    @Test
    @DisplayName("nothing in the proactive package can reach a marketplace")
    void itTalksToNoChannel() throws IOException {
        List<String> forbidden = List.of(
                "HttpClient", "HttpRequest", "RestTemplate", "WebClient", "postForm",
                "\"POST\"", "\"PUT\"", "\"DELETE\"", "Cafe24", "NaverCommerce", "Coupang",
                "connector.");
        for (Path source : javaFiles()) {
            String text = code(source);
            for (String name : forbidden) {
                assertThat(text)
                        .as("%s: the proactive loop investigates what has already been collected; a "
                                + "channel call here would be an unattended marketplace call",
                                source.getFileName())
                        .doesNotContain(name);
            }
        }
    }

    @Test
    @DisplayName("nothing in the proactive package can approve, mint an action, or execute one")
    void itCrossesNoApprovalBoundary() throws IOException {
        // Every name here is a real type or route on the send path. A prepared draft stops one step
        // before all of them: the seller's explicit approval is still the only thing that starts a send.
        List<String> forbidden = List.of(
                "InquiryApproval", "ApprovalService", "ActionIntent", "PublishExecution",
                "confirm-publish", "ReplyPublish", "ActionExecutor", "commandId", "approvalId");
        for (Path source : javaFiles()) {
            String text = code(source);
            for (String name : forbidden) {
                assertThat(text)
                        .as("%s: preparing a draft is not approving it", source.getFileName())
                        .doesNotContain(name);
            }
        }
    }

    @Test
    @DisplayName("nothing in the proactive package writes what the seller is known to have answered")
    void itNeverWritesAnswerMemory() throws IOException {
        for (Path source : javaFiles()) {
            assertThat(code(source))
                    .as("%s: Answer Memory holds answers a SELLER actually gave; a machine draft that "
                            + "entered it would be cited back as the seller's own precedent",
                            source.getFileName())
                    .doesNotContain("AnswerMemory");
        }
    }

    @Test
    @DisplayName("nothing in the proactive package binds a product or invents an order")
    void itInventsNoFact() throws IOException {
        List<String> forbidden = List.of(
                "ProductBinding", "OrderFactLookup", "EXACT_ALLOWED", "sourceOrderRef",
                "setSourceOrderRef", "setThreadRole");
        for (Path source : javaFiles()) {
            String text = code(source);
            for (String name : forbidden) {
                assertThat(text)
                        .as("%s: a product link is a person's decision (USER_CONFIRMED) and an order "
                                + "reference is the channel's; neither is a background loop's to guess",
                                source.getFileName())
                        .doesNotContain(name);
            }
            // A product id may be COPIED onto the case row so the card can name the product. It may
            // never be written back onto the inquiry or the review — that is the binding, and the
            // binding has an owner. The distinction is the receiver, so it is checked per line.
            for (String line : text.split("\\R")) {
                if (!line.contains("setProductId(")) {
                    continue;
                }
                assertThat(line.strip())
                        .as("%s: only the case row may carry a copy of the product id", source.getFileName())
                        .startsWith("row.setProductId(");
            }
        }
    }

    @Test
    @DisplayName("the API cannot change a case's status — only the work can")
    void theApiCommandsNoStatus() throws IOException {
        String controller = code(PACKAGE.resolve("ProactiveCaseController.java"));
        assertThat(controller)
                .as("a dismiss/resolve endpoint would be a second, weaker decision that the inquiry "
                        + "queue and the review reply ledger know nothing about")
                .doesNotContain("setStatus")
                .doesNotContain("ProactiveCaseStatus")
                .doesNotContain("@DeleteMapping")
                .doesNotContain("@PutMapping");

        // And the reconciler is the only writer of status anywhere in the package.
        for (Path source : javaFiles()) {
            if (source.getFileName().toString().equals("ProactiveCaseReconciler.java")) {
                continue;
            }
            assertThat(code(source))
                    .as("%s: status is derived from the subject; a second writer is a second authority",
                            source.getFileName())
                    .doesNotContain("setStatus(");
        }
    }

    @Test
    @DisplayName("no repository read names a subject without also naming an org")
    void everyReadIsOrgScoped() throws IOException {
        // Whole declarations, not lines: a signature wrapped across three lines would otherwise be
        // judged one parameter at a time, and the middle line of every one of them would fail.
        String repository = code(PACKAGE.resolve("ProactiveCaseRepository.java"));
        int body = repository.indexOf("{");
        assertThat(body).isPositive();
        for (String declaration : repository.substring(body).split(";")) {
            String flattened = declaration.replaceAll("\\s+", " ").strip();
            if (!flattened.contains("(") || !flattened.contains(")")) {
                continue;
            }
            assertThat(flattened)
                    .as("a proactive case names an inquiry, a review and a product — a read that "
                            + "crossed orgs would put one seller's customers on another's screen")
                    .containsAnyOf("orgId", "OrgId");
        }
    }

    @Test
    @DisplayName("one open case per subject is guaranteed by the database, not by good behaviour")
    void theDuplicateFenceIsInTheSchema() throws IOException {
        String migration = Files.readString(MIGRATION);
        assertThat(migration)
                .as("the reconciler's supersede logic is the first line of defence; this index is what "
                        + "holds when two ticks (or two nodes) race")
                .contains("uq_proactive_case_open_subject")
                .contains("where status = 'PREPARED'");
        assertThat(migration)
                .as("and one investigation per source state, so an unchanged source writes nothing")
                .contains("uq_proactive_case_signature");
    }

    @Test
    @DisplayName("v1 has exactly two subject kinds — an order is not proactive work yet")
    void theSubjectListIsClosed() {
        assertThat(ProactiveSubjectKind.values())
                .as("an order has no waiting customer and no unanswered question; 확인이 필요합니다 on "
                        + "one would be a claim this product cannot ground")
                .containsExactly(ProactiveSubjectKind.INQUIRY, ProactiveSubjectKind.REVIEW);
    }

    @Test
    @DisplayName("every reason belongs to exactly one subject kind, and carries its own priority")
    void reasonsArePartitioned() {
        for (ProactiveReason reason : ProactiveReason.values()) {
            assertThat(reason.priority()).as("%s", reason).isNotNull();
            assertThat(reason.noteKo()).as("%s", reason).isNotBlank();
            assertThat(reason.subjectKind()).as("%s", reason).isNotNull();
        }
        // The one inquiry reason is HIGH: a customer is waiting. That is the v1 priority rule, stated
        // where a change to it would fail rather than quietly re-rank a seller's morning.
        assertThat(ProactiveReason.UNANSWERED_INQUIRY.priority()).isEqualTo(ProactivePriority.HIGH);
        assertThat(ProactiveReason.NEGATIVE_REVIEW.priority()).isEqualTo(ProactivePriority.NORMAL);
    }

    @Test
    @DisplayName("priority comes from an operational fact, never from a model's confidence")
    void priorityIsNotAConfidence() throws IOException {
        for (Path source : javaFiles()) {
            assertThat(code(source))
                    .as("%s: a score the seller cannot interrogate is a score they stop trusting",
                            source.getFileName())
                    .doesNotContain("confidence")
                    .doesNotContain("score(")
                    .doesNotContain("Math.random");
        }
    }

    @Test
    @DisplayName("the activation baseline is on the ORG, has no default, and gates preparation")
    void theActivationBaselineIsRequired() throws IOException {
        // It used to be an env var, chosen for one bootstrap audit. A boundary someone can retype is a
        // flood someone can re-open, and "when was this org activated" is a fact about the org.
        String properties = Files.readString(PACKAGE.resolve("ProactiveProperties.java"));
        assertThat(properties)
                .as("no freshness boundary may return to configuration")
                .doesNotContain("observed-since")
                .doesNotContain("OBSERVED_SINCE");
        assertThat(Files.readString(PACKAGE.resolve("../organization/Organization.java")))
                .as("the baseline lives on the org")
                .contains("proactive_baseline_at");

        String reconciler = code(PACKAGE.resolve("ProactiveCaseReconciler.java"));
        assertThat(reconciler)
                .as("an org with no baseline prepares nothing, and the first tick only stamps it")
                .contains("if (baseline == null)")
                .contains("setProactiveBaselineAt");
        // And the candidate reads cannot be called without one: the parameter is not optional.
        for (String repository : List.of(
                "../inquiry/workitem/InquiryWorkItemRepository.java",
                "../review/ReviewRepository.java")) {
            assertThat(Files.readString(PACKAGE.resolve(repository)))
                    .as("%s: the gate takes the boundary as an argument, so it cannot be forgotten",
                            repository)
                    .contains("@Param(\"observedSince\") Instant observedSince");
        }

        assertThat(properties)
                .as("the org allow-list is fail closed too — blank means nobody, never everybody")
                .contains("${sellerops.proactive.org-ids:}");
        assertThat(Files.readString(PACKAGE.resolve("ProactiveScheduler.java")))
                .as("the named list must be the SOURCE of the target set, not a filter applied after "
                        + "enumerating every organisation in the database")
                .contains("properties.orgIds().stream().filter(selfPilot::isEnabledFor)")
                .doesNotContain("organizations.findAll()");
    }

    @Test
    @DisplayName("the daily cap is one budget across both kinds, charged before the model")
    void theBudgetIsGlobalAndDaily() throws IOException {
        String properties = Files.readString(PACKAGE.resolve("ProactiveProperties.java"));
        assertThat(properties)
                .as("per-lane per-tick caps are two numbers that happen to add up, not a budget")
                .contains("${sellerops.proactive.daily-cap:3}")
                .doesNotContain("inquiries-per-tick")
                .doesNotContain("reviews-per-tick");

        String reconciler = code(PACKAGE.resolve("ProactiveCaseReconciler.java"));
        assertThat(reconciler)
                .as("both gates: the product's daily cap AND the org's shared Agent quota")
                .contains("properties.dailyCap()")
                .contains("quota.status(orgId)");
        assertThat(reconciler)
                .as("the loop reads the quota, never reserves or charges it — proactive reserve is 0")
                .doesNotContain("quota.consume(");
        assertThat(reconciler)
                .as("the day is the quota's own day, not a second answer to when today started")
                .contains("status.date()");
        // Reconcile must be reachable before either budget gate.
        int reconcileCall = reconciler.indexOf("reconcileOpen(orgId, counters)");
        int slots = reconciler.indexOf("remainingDailySlots(orgId)");
        assertThat(reconcileCall).isPositive();
        assertThat(slots).as("closing finished work is not a purchase").isGreaterThan(reconcileCall);
    }

    /** One Java file with its comments removed    /** One Java file with its comments removed — the ban is on doing these things, not naming them. */
    private static String code(Path source) throws IOException {
        return Files.readString(source)
                .replaceAll("(?s)/\\*.*?\\*/", " ")
                .replaceAll("(?m)//.*$", " ");
    }

    private static List<Path> javaFiles() throws IOException {
        try (var walk = Files.walk(PACKAGE)) {
            return walk.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
    }
}
