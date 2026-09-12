package com.sellerops.producttruth.dto;

import java.util.List;

/**
 * The Canonical Product Source, as one read.
 *
 * <p><b>Why the whole ledger and not a selected slice.</b> Selection needs the question, the planner's
 * closed tokens, the conversation's focus and this seller's world — all of which live in the Agent
 * runtime. Selecting here would split one decision across two services and give the backend a second
 * opinion about what a turn is asking. So this hands over the reviewed ledger and the runtime decides
 * what a given turn may stand on. Nothing here reaches a vendor: the payload floor is applied where
 * the facts are selected.
 *
 * <p><b>Product truth, not seller data.</b> Every field is the same for every organization — it is read
 * from files in this jar. There is no org scope because there is nothing org-shaped in it.
 */
public record ProductTruthView(
        List<CapabilityView> capabilities,
        List<FeatureView> features,
        List<StatementView> invariants,
        List<StatementView> narratives,
        List<StatementView> directions,
        List<RoadmapView> roadmap) {

    /** One channel × object × axis row, with the two refinements a row can carry. */
    public record CapabilityView(
            String id, String channel, String object, String axis,
            String status, String mode, String evidence,
            List<String> sellerFacingNotes, List<String> limitations,
            List<RequirementView> requirements, List<SubtypeView> subtypes) {
    }

    /**
     * A precondition on running an execution path.
     *
     * <p>Carried separately from {@code limitations} because it is the layer that a runtime overlay can
     * answer ("is this satisfied here") without the capability moving.
     */
    public record RequirementView(String kind, String description) {
    }

    /** A refinement of a row, for a channel whose object is really several contracts. */
    public record SubtypeView(
            String id, String key, String label, String status, String mode, String evidence,
            List<String> sellerFacingNotes, List<String> limitations) {
    }

    /** A product-wide capability — no channel, no object, and therefore no mode. */
    public record FeatureView(
            String id, String title, String status, String evidence,
            List<String> sellerFacingNotes, List<String> limitations) {
    }

    /** An invariant, a narrative or a direction: a sentence with an id and no capability claim. */
    public record StatementView(String id, String title, String body, List<String> notThis) {
    }

    /**
     * A roadmap item. {@code qualifier} is not optional and not decoration — it is the hedge any
     * mention has to carry, and the ledger refuses to load without it.
     */
    public record RoadmapView(String id, String title, String status, String summary, String qualifier) {
    }
}
