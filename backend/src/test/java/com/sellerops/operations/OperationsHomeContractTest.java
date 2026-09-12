package com.sellerops.operations;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.operations.dto.OperationsHomeView;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * <b>What the Operations Home read may and may not carry.</b>
 *
 * <p>These are structural assertions rather than behavioural ones, because the failure this screen is
 * most likely to have is not a wrong number — it is a plausible number that answers a question nobody
 * asked. A field's existence is the decision; once the field exists a screen will draw it.
 */
class OperationsHomeContractTest {

    private static List<String> componentsOf(Class<?> type) {
        RecordComponent[] components = type.getRecordComponents();
        return Arrays.stream(components).map(RecordComponent::getName).toList();
    }

    /**
     * <b>No field on this view is a sum of two others.</b>
     *
     * <p>The dashboard this replaces carries {@code urgentCount = unansweredInquiries + negativeReviews}
     * — two populations added into a third that nobody measured, then labelled urgent. A seller acting
     * on 43 is acting on a number that describes no set of rows. The Home answers each question over
     * its own population and leaves the adding undone.
     */
    @Test
    void carriesNoCombinedUrgencyTotal() {
        List<String> all = List.of(
                componentsOf(OperationsHomeView.class),
                componentsOf(OperationsHomeView.ReviewAttention.class),
                componentsOf(OperationsHomeView.RepeatedProblems.class),
                componentsOf(OperationsHomeView.PreparedWork.class)).stream()
                .flatMap(List::stream).toList();

        // Banned: words that name a COMBINED or RANKED quantity. `needsAttentionTotal` and
        // `watchTotal` are deliberately not banned — each totals exactly one population and says in
        // its own name which one, which is the property being protected rather than violated.
        assertThat(all).noneSatisfy(name -> assertThat(name.toLowerCase())
                .containsAnyOf("urgent", "urgency", "score", "priority", "weight", "combined"));

        // And every count on the view names the population it counts: there is no bare `total`,
        // `count` or `pending` that a reader would have to guess the scope of.
        assertThat(all).doesNotContain("total", "count", "pending", "all");
    }

    /**
     * <b>「분류된 수」와 「지금 결정 필요한 수」가 둘 다 있어야 한다.</b>
     *
     * <p>A tier is a read-time function of the review, so recording a decision does not change it.
     * A Home carrying only the tier keeps asking for work already done; one carrying only the
     * undecided loses the tier's own size. Dropping either field is how the screen starts lying.
     */
    @Test
    void keepsTheTierAndTheUndecidedAsSeparateFields() {
        assertThat(componentsOf(OperationsHomeView.ReviewAttention.class))
                .contains("needsAttentionUndecided", "needsAttentionTotal");
    }

    /**
     * <b>WATCH is reported and is not a work count.</b> It means 「if this keeps happening it is worth
     * changing something」 — the repeated-problem lane's question, not a request for a decision today.
     * It has its own field so that it can be shown without being added to anything.
     */
    @Test
    void watchIsItsOwnNumber() {
        assertThat(componentsOf(OperationsHomeView.ReviewAttention.class)).contains("watchTotal");
    }

    /**
     * <b>관찰 중 is counted apart from what is somebody's move.</b> A Home that presented every
     * observed problem as a pending task would manufacture urgency out of an evidence trickle — this
     * org holds 20 observed problems and one that is anybody's move.
     */
    @Test
    void observingProblemsAreCountedApartFromDecidableOnes() {
        assertThat(componentsOf(OperationsHomeView.RepeatedProblems.class))
                .contains("decidable", "observing");
    }

    /**
     * The prepared list may only describe work some record says exists. Its two counts are named after
     * the records behind them — an approval that stands, a draft that was written — rather than after
     * a judgement like 「보낼 준비가 된 것」, which no table answers.
     */
    @Test
    void preparedWorkIsNamedAfterTheRecordsBehindIt() {
        assertThat(componentsOf(OperationsHomeView.PreparedWork.class))
                .contains("reviewRepliesApproved", "inquiryDraftsReady");
    }

    /**
     * The collection area reuses {@code ChannelCoverageRow} whole. Re-declaring its fields here would
     * be a second copy of the freshness contract, and the copy would be the one that goes stale.
     */
    @Test
    void collectionIsTheCoverageRowItself() {
        RecordComponent collection = Arrays.stream(OperationsHomeView.class.getRecordComponents())
                .filter(c -> c.getName().equals("collection")).findFirst().orElseThrow();
        assertThat(collection.getGenericType().getTypeName())
                .contains("com.sellerops.coverage.dto.ChannelCoverageRow");
    }
}
