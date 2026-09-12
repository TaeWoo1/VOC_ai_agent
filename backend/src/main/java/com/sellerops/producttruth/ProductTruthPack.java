package com.sellerops.producttruth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;

/**
 * The Canonical Product Knowledge ledger, read from {@code product-truth/*.yaml}.
 *
 * <p><b>Why it exists.</b> Product truth used to be re-derived, every turn, from whatever the code,
 * the registries and the runtime environment happened to say at that moment. That works until one of
 * them is stale or switched off, and then the product forgets what it does: a stale
 * {@code NEEDS_VERIFICATION} row demoted a Coupang inquiry path that had been live-proven two weeks
 * earlier, and a QA environment with the publish flag off produced the sentence "reviewnary는 직접
 * 전송하지 못합니다" — a deployment posture described as a product specification.
 *
 * <p><b>What it is the authority for, and what it is not.</b> It owns the answer to "what does this
 * product do" ({@link ProductCapability} per channel × object, {@link ProductFeature} across all of
 * them, {@link ProductInvariant} everywhere), why it exists ({@link ProductNarrative}), what has been
 * decided about how it should work ({@link ProductDirection}) and where it is going
 * ({@link ProductRoadmapItem}). It does NOT own
 * "is that switched on here", "has this seller connected", or "is a schedule running" — those are a
 * runtime overlay computed from live state, and nothing in this package reads a flag.
 *
 * <p><b>Why files, not a table.</b> Same reason as {@code ChannelKnowledgePack}: this is reviewed in
 * a pull request beside the code it describes, and a table would let the two drift apart silently
 * between deploys. Drift is instead a test failure — {@code ProductTruthDriftTest} pins the rows that
 * restate something the code also states.
 *
 * <p><b>Not wired to anything yet, and that is deliberate.</b> This step builds the ledger and makes
 * it reviewable. Grounded Conversation still derives its Product Truth the old way; replacing that is
 * the next step, after a human has read these files. There is no Spring bean here, so a malformed
 * file cannot affect a running deployment — it fails the build instead.
 */
public final class ProductTruthPack {

    /** Every channel the ledger must answer for. Mirrors {@code ProductChannels.VISIBLE_CODES}. */
    public static final List<String> CHANNELS = List.of("NAVER", "CAFE24", "COUPANG");

    /** The four operating objects. Mirrors the Agent's {@code OPERATING_OBJECTS}. */
    public static final List<String> OBJECTS = List.of("INQUIRY", "REVIEW", "PRODUCT", "ORDER");

    private final List<ProductCapability> capabilities;
    private final List<ProductFeature> features;
    private final List<ProductInvariant> invariants;
    private final List<ProductNarrative> narratives;
    private final List<ProductDirection> directions;
    private final List<ProductRoadmapItem> roadmap;

    private ProductTruthPack(List<ProductCapability> capabilities, List<ProductFeature> features,
                             List<ProductInvariant> invariants, List<ProductNarrative> narratives,
                             List<ProductDirection> directions, List<ProductRoadmapItem> roadmap) {
        this.capabilities = List.copyOf(capabilities);
        this.features = List.copyOf(features);
        this.invariants = List.copyOf(invariants);
        this.narratives = List.copyOf(narratives);
        this.directions = List.copyOf(directions);
        this.roadmap = List.copyOf(roadmap);
    }

    /** Loads and validates the ledger. Throws on any violation, listing all of them. */
    public static ProductTruthPack load() {
        ObjectMapper yaml = new ObjectMapper(new YAMLFactory()).registerModule(new JavaTimeModule());
        RawCapabilities caps = read(yaml, "product-truth/capabilities.yaml", RawCapabilities.class);
        RawFeatures feat = read(yaml, "product-truth/features.yaml", RawFeatures.class);
        RawInvariants inv = read(yaml, "product-truth/invariants.yaml", RawInvariants.class);
        RawNarratives nar = read(yaml, "product-truth/narrative.yaml", RawNarratives.class);
        RawDirections dir = read(yaml, "product-truth/direction.yaml", RawDirections.class);
        RawRoadmap road = read(yaml, "product-truth/roadmap.yaml", RawRoadmap.class);

        List<ProductCapability> capabilities = new ArrayList<>();
        for (RawCapability r : nullToEmpty(caps.capabilities)) {
            capabilities.add(new ProductCapability(
                    r.id, upper(r.channel), upper(r.object),
                    enumOf(ProductCapabilityAxis.class, r.axis, r.id, "axis"),
                    enumOf(ProductCapabilityStatus.class, r.status, r.id, "status"),
                    enumOf(ProductCapabilityMode.class, r.mode, r.id, "mode"),
                    enumOf(ProductEvidence.class, r.evidence, r.id, "evidence"),
                    r.evidenceRef,
                    List.copyOf(nullToEmpty(r.sellerFacingNotes)),
                    List.copyOf(nullToEmpty(r.limitations)),
                    List.copyOf(nullToEmpty(r.sourceRefs)),
                    requirementsOf(r),
                    subtypesOf(r),
                    reviewOf(r.review), date(r.lastReviewed)));
        }
        List<ProductFeature> features = new ArrayList<>();
        for (RawFeature r : nullToEmpty(feat.features)) {
            features.add(new ProductFeature(r.id, r.title,
                    enumOf(ProductCapabilityStatus.class, r.status, r.id, "status"),
                    enumOf(ProductEvidence.class, r.evidence, r.id, "evidence"),
                    r.evidenceRef,
                    List.copyOf(nullToEmpty(r.sellerFacingNotes)),
                    List.copyOf(nullToEmpty(r.limitations)),
                    List.copyOf(nullToEmpty(r.sourceRefs)),
                    reviewOf(r.review), date(r.lastReviewed)));
        }
        List<ProductInvariant> invariants = new ArrayList<>();
        for (RawInvariant r : nullToEmpty(inv.invariants)) {
            invariants.add(new ProductInvariant(r.id, r.title, r.statement,
                    List.copyOf(nullToEmpty(r.notThis)), List.copyOf(nullToEmpty(r.sourceRefs)),
                    reviewOf(r.review), date(r.lastReviewed)));
        }
        List<ProductNarrative> narratives = new ArrayList<>();
        for (RawNarrative r : nullToEmpty(nar.narratives)) {
            narratives.add(new ProductNarrative(r.id, r.title, r.body,
                    List.copyOf(nullToEmpty(r.sourceRefs)), reviewOf(r.review), date(r.lastReviewed)));
        }
        List<ProductDirection> directions = new ArrayList<>();
        for (RawDirection r : nullToEmpty(dir.directions)) {
            directions.add(new ProductDirection(r.id, r.title, r.statement,
                    List.copyOf(nullToEmpty(r.sourceRefs)), reviewOf(r.review), date(r.lastReviewed)));
        }
        List<ProductRoadmapItem> roadmap = new ArrayList<>();
        for (RawRoadmapItem r : nullToEmpty(road.roadmap)) {
            roadmap.add(new ProductRoadmapItem(r.id, r.title,
                    enumOf(ProductRoadmapStatus.class, r.status, r.id, "status"),
                    r.summary, r.qualifier, List.copyOf(nullToEmpty(r.sourceRefs)),
                    reviewOf(r.review), date(r.lastReviewed)));
        }
        ProductTruthPack pack = new ProductTruthPack(
                capabilities, features, invariants, narratives, directions, roadmap);
        List<String> violations = ProductTruthValidator.validate(pack.capabilities, pack.features,
                pack.invariants, pack.narratives, pack.directions, pack.roadmap);
        if (!violations.isEmpty()) {
            throw new IllegalStateException(
                    "Product Truth 원장이 유효하지 않습니다:\n  - " + String.join("\n  - ", violations));
        }
        return pack;
    }

    public List<ProductCapability> capabilities() {
        return capabilities;
    }

    /**
     * Product-wide capability. Returned as its own type so a feature can never be handed to a caller
     * that is asking a channel × object question.
     */
    public List<ProductFeature> features() {
        return features;
    }

    public List<ProductInvariant> invariants() {
        return invariants;
    }

    public List<ProductNarrative> narratives() {
        return narratives;
    }

    /** Decisions about how the product should work. Not capabilities, not hypotheses. */
    public List<ProductDirection> directions() {
        return directions;
    }

    /**
     * The roadmap. Returned as its own type on purpose — there is no method that hands a caller
     * capabilities and roadmap items in one list.
     */
    public List<ProductRoadmapItem> roadmap() {
        return roadmap;
    }

    /** One row, or empty. Empty is honest: an axis nobody declared has no answer here. */
    public Optional<ProductCapability> capability(String channel, String object, ProductCapabilityAxis axis) {
        return capabilities.stream()
                .filter(c -> c.channel().equals(upper(channel)) && c.object().equals(upper(object))
                        && c.axis() == axis)
                .findFirst();
    }

    /** Every row for one channel × object, in axis order. */
    public List<ProductCapability> capabilitiesFor(String channel, String object) {
        return capabilities.stream()
                .filter(c -> c.channel().equals(upper(channel)) && c.object().equals(upper(object)))
                .sorted((a, b) -> a.axis().compareTo(b.axis()))
                .toList();
    }

    /** Every id in the ledger, across all four layers — the uniqueness domain. */
    public List<String> allIds() {
        List<String> ids = new ArrayList<>();
        capabilities.forEach(c -> {
            ids.add(c.id());
            c.subtypes().forEach(s -> ids.add(s.id()));
        });
        features.forEach(f -> ids.add(f.id()));
        invariants.forEach(i -> ids.add(i.id()));
        narratives.forEach(n -> ids.add(n.id()));
        directions.forEach(d -> ids.add(d.id()));
        roadmap.forEach(r -> ids.add(r.id()));
        return ids;
    }

    /** Ids a human has not confirmed yet. The review queue. */
    public List<String> pendingReview() {
        List<String> ids = new ArrayList<>();
        capabilities.stream().filter(c -> c.review() == ProductReviewState.TODO_REVIEW)
                .forEach(c -> ids.add(c.id()));
        features.stream().filter(f -> f.review() == ProductReviewState.TODO_REVIEW)
                .forEach(f -> ids.add(f.id()));
        invariants.stream().filter(i -> i.review() == ProductReviewState.TODO_REVIEW)
                .forEach(i -> ids.add(i.id()));
        narratives.stream().filter(n -> n.review() == ProductReviewState.TODO_REVIEW)
                .forEach(n -> ids.add(n.id()));
        directions.stream().filter(d -> d.review() == ProductReviewState.TODO_REVIEW)
                .forEach(d -> ids.add(d.id()));
        roadmap.stream().filter(r -> r.review() == ProductReviewState.TODO_REVIEW)
                .forEach(r -> ids.add(r.id()));
        return ids;
    }

    static Set<String> duplicates(List<String> values) {
        Set<String> seen = new HashSet<>();
        Set<String> dupes = new java.util.LinkedHashSet<>();
        for (String v : values) {
            if (!seen.add(v)) {
                dupes.add(v);
            }
        }
        return dupes;
    }

    private static String upper(String s) {
        return s == null ? "" : s.trim().toUpperCase(Locale.ROOT);
    }

    private static <T> List<T> nullToEmpty(List<T> list) {
        return list == null ? List.of() : list;
    }

    private static ProductReviewState reviewOf(String raw) {
        return raw == null || raw.isBlank()
                ? ProductReviewState.TODO_REVIEW
                : ProductReviewState.valueOf(raw.trim());
    }

    private static LocalDate date(String raw) {
        return raw == null || raw.isBlank() ? null : LocalDate.parse(raw.trim());
    }

    private static List<ProductExecutionRequirement> requirementsOf(RawCapability r) {
        List<ProductExecutionRequirement> out = new ArrayList<>();
        for (RawRequirement raw : nullToEmpty(r.requirements)) {
            out.add(new ProductExecutionRequirement(
                    enumOf(ProductRequirementKind.class, raw.kind, r.id, "requirement kind"),
                    raw.description));
        }
        return List.copyOf(out);
    }

    private static List<ProductCapabilitySubtype> subtypesOf(RawCapability r) {
        List<ProductCapabilitySubtype> out = new ArrayList<>();
        for (RawSubtype raw : nullToEmpty(r.subtypes)) {
            String key = upper(raw.key);
            out.add(new ProductCapabilitySubtype(r.id + "." + key, key, raw.label,
                    enumOf(ProductCapabilityStatus.class, raw.status, r.id + "." + key, "status"),
                    enumOf(ProductCapabilityMode.class, raw.mode, r.id + "." + key, "mode"),
                    enumOf(ProductEvidence.class, raw.evidence, r.id + "." + key, "evidence"),
                    raw.evidenceRef,
                    List.copyOf(nullToEmpty(raw.sellerFacingNotes)),
                    List.copyOf(nullToEmpty(raw.limitations))));
        }
        return List.copyOf(out);
    }

    private static <E extends Enum<E>> E enumOf(Class<E> type, String raw, String id, String field) {
        try {
            return Enum.valueOf(type, raw == null ? "" : raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException(
                    id + ": 알 수 없는 " + field + " 값 '" + raw + "' (" + type.getSimpleName() + ")", ex);
        }
    }

    private static <T> T read(ObjectMapper yaml, String path, Class<T> type) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return yaml.readValue(in, type);
        } catch (Exception ex) {
            throw new IllegalStateException("Product Truth 파일을 읽을 수 없습니다: " + path, ex);
        }
    }

    // ---- YAML shapes. Package-private mutable holders; the public surface is the records. ------

    static class RawCapabilities {
        public String version;
        public List<RawCapability> capabilities;
    }

    static class RawCapability {
        public String id;
        public String channel;
        public String object;
        public String axis;
        public String status;
        public String mode;
        public String evidence;
        public String evidenceRef;
        public List<String> sellerFacingNotes;
        public List<String> limitations;
        public List<String> sourceRefs;
        public List<RawRequirement> requirements;
        public List<RawSubtype> subtypes;
        public String review;
        public String lastReviewed;
    }

    static class RawRequirement {
        public String kind;
        public String description;
    }

    static class RawSubtype {
        public String key;
        public String label;
        public String status;
        public String mode;
        public String evidence;
        public String evidenceRef;
        public List<String> sellerFacingNotes;
        public List<String> limitations;
    }

    static class RawFeatures {
        public String version;
        public List<RawFeature> features;
    }

    static class RawFeature {
        public String id;
        public String title;
        public String status;
        public String evidence;
        public String evidenceRef;
        public List<String> sellerFacingNotes;
        public List<String> limitations;
        public List<String> sourceRefs;
        public String review;
        public String lastReviewed;
    }

    static class RawDirections {
        public String version;
        public List<RawDirection> directions;
    }

    static class RawDirection {
        public String id;
        public String title;
        public String statement;
        public List<String> sourceRefs;
        public String review;
        public String lastReviewed;
    }

    static class RawInvariants {
        public String version;
        public List<RawInvariant> invariants;
    }

    static class RawInvariant {
        public String id;
        public String title;
        public String statement;
        public List<String> notThis;
        public List<String> sourceRefs;
        public String review;
        public String lastReviewed;
    }

    static class RawNarratives {
        public String version;
        public List<RawNarrative> narratives;
    }

    static class RawNarrative {
        public String id;
        public String title;
        public String body;
        public List<String> sourceRefs;
        public String review;
        public String lastReviewed;
    }

    static class RawRoadmap {
        public String version;
        public List<RawRoadmapItem> roadmap;
    }

    static class RawRoadmapItem {
        public String id;
        public String title;
        public String status;
        public String summary;
        public String qualifier;
        public List<String> sourceRefs;
        public String review;
        public String lastReviewed;
    }
}
