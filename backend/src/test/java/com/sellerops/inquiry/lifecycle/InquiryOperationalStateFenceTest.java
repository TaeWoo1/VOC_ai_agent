package com.sellerops.inquiry.lifecycle;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.SourceThreadRole;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
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
 * Two structural guarantees about {@code inquiries.operational_state}, both asserted by reading the
 * source rather than by exercising a path — because what is being proved is the absence of a path.
 *
 * <p><b>1. {@code SOURCE_REMOVED} has no producer.</b> Turning "the source did not show it to us" into
 * "the seller deleted it" needs a read that is an authoritative snapshot, and the Cafe24 board-article
 * read is not proven to be one: an offset sweep with no documented ordering, over a {@code
 * start_date}/{@code end_date} filter already observed returning rows outside its own window. The
 * lifecycle keeps a place for a source deletion so that the day the proof exists there is somewhere
 * honest to put it — and until then this test is what keeps the door shut. A tombstone written on a
 * missing page is not recoverable by apology.
 *
 * <p><b>2. One writer.</b> The exclusion is a projection of the seller's dismissal disposition, which
 * lives on the work item. A second writer would make it a second authority, and the first symptom
 * would be a count that disagrees with the queue with nobody able to say which is right. Only {@link
 * InquiryOperationalStateProjector} may call the setter.
 */
class InquiryOperationalStateFenceTest {

    private static final Path MAIN = Paths.get("src/main/java/com/sellerops");

    /**
     * The declaration, and the projector — which is allowed to <em>name</em> the value because it
     * guards against overwriting one, never to produce one. {@link #theProjectorNeverMintsATombstone}
     * is what proves that distinction; this list only keeps the text scan from flagging the guard.
     */
    private static final List<String> MAY_NAME_IT =
            List.of("InquiryOperationalState.java", "InquiryOperationalStateProjector.java");

    @Test
    @DisplayName("no code outside the lifecycle even names SOURCE_REMOVED")
    void sourceRemovedHasNoProducer() throws IOException {
        List<String> offenders = scan(code -> code.contains("SOURCE_REMOVED"), MAY_NAME_IT);

        assertThat(offenders)
                .as("absence in one sweep is not evidence of deletion — see the class javadoc")
                .isEmpty();
    }

    @Test
    @DisplayName("the projector never mints a tombstone, for any input")
    void theProjectorNeverMintsATombstone() {
        InquiryOperationalStateProjector projector = new InquiryOperationalStateProjector();
        for (InquiryOperationalState from : InquiryOperationalState.values()) {
            for (InquiryWorkItem workItem : workItemShapes()) {
                Inquiry inquiry = new Inquiry();
                inquiry.setOperationalState(from);
                InquiryOperationalState to = projector.project(inquiry, workItem);
                if (from == InquiryOperationalState.SOURCE_REMOVED) {
                    assertThat(to)
                            .as("an existing tombstone is preserved, not reinterpreted as a spam verdict")
                            .isEqualTo(InquiryOperationalState.SOURCE_REMOVED);
                } else {
                    assertThat(to)
                            .as("no ledger shape can turn a live row into a source deletion")
                            .isNotEqualTo(InquiryOperationalState.SOURCE_REMOVED);
                }
            }
        }
    }

    /** Every shape the ledger can present: absent, and each phase with and without a disposition. */
    private static List<InquiryWorkItem> workItemShapes() {
        List<InquiryWorkItem> shapes = new ArrayList<>();
        shapes.add(null);
        for (InquiryWorkItemPhase phase : InquiryWorkItemPhase.values()) {
            for (InquiryWorkItemDisposition disposition : dispositions()) {
                InquiryWorkItem item = new InquiryWorkItem();
                item.setPhase(phase);
                item.setDisposition(disposition);
                shapes.add(item);
            }
        }
        return shapes;
    }

    private static List<InquiryWorkItemDisposition> dispositions() {
        List<InquiryWorkItemDisposition> all = new ArrayList<>();
        all.add(null);
        all.addAll(List.of(InquiryWorkItemDisposition.values()));
        return all;
    }

    @Test
    @DisplayName("only the projector writes operational_state")
    void theProjectionHasExactlyOneWriter() throws IOException {
        List<String> offenders = scan(code -> code.contains("setOperationalState("),
                List.of("Inquiry.java", "InquiryOperationalStateProjector.java"));

        assertThat(offenders)
                .as("the seller's dismissal is the authority; this column only mirrors it")
                .isEmpty();
    }

    @Test
    @DisplayName("the four states mean four different things and only three are reachable")
    void theVocabularyIsClosed() {
        assertThat(InquiryOperationalState.values()).hasSize(4);
        assertThat(InquiryOperationalState.ACTIVE.isActive()).isTrue();
        assertThat(InquiryOperationalState.EXCLUDED_SPAM.isActive()).isFalse();
        assertThat(InquiryOperationalState.EXCLUDED_THREAD_REPLY.isActive())
                .as("a reply inside a thread is not a customer waiting for an answer")
                .isFalse();
        assertThat(InquiryOperationalState.SOURCE_REMOVED.isActive())
                .as("if it ever becomes reachable it must already be excluded from current truth")
                .isFalse();
    }

    @Test
    @DisplayName("a thread reply is excluded on the source's ground, not the seller's")
    void theStructuralExclusionOutranksTheDismissal() {
        InquiryOperationalStateProjector projector = new InquiryOperationalStateProjector();
        InquiryWorkItem dismissed = new InquiryWorkItem();
        dismissed.setPhase(InquiryWorkItemPhase.DISMISSED);
        dismissed.setDisposition(InquiryWorkItemDisposition.SPAM);

        Inquiry reply = new Inquiry();
        reply.setOperationalState(InquiryOperationalState.ACTIVE);
        reply.setThreadRole(SourceThreadRole.REPLY.name());

        assertThat(projector.project(reply, null))
                .isEqualTo(InquiryOperationalState.EXCLUDED_THREAD_REPLY);
        assertThat(projector.project(reply, dismissed))
                .as("the dismissal stays on the work item; the row was never a question to dismiss")
                .isEqualTo(InquiryOperationalState.EXCLUDED_THREAD_REPLY);

        Inquiry unclassified = new Inquiry();
        unclassified.setOperationalState(InquiryOperationalState.ACTIVE);
        assertThat(projector.project(unclassified, null))
                .as("null role means we never asked — it is not the source saying ROOT")
                .isEqualTo(InquiryOperationalState.ACTIVE);

        Inquiry root = new Inquiry();
        root.setOperationalState(InquiryOperationalState.EXCLUDED_THREAD_REPLY);
        root.setThreadRole(SourceThreadRole.ROOT.name());
        assertThat(projector.project(root, null))
                .as("a re-read that says ROOT puts the row back — the projection is symmetric")
                .isEqualTo(InquiryOperationalState.ACTIVE);
    }

    private static List<String> scan(java.util.function.Predicate<String> offends, List<String> allowed)
            throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (allowed.contains(name)) {
                    continue;
                }
                if (offends.test(Files.readString(source))) {
                    offenders.add(name);
                }
            }
        }
        return offenders;
    }
}
