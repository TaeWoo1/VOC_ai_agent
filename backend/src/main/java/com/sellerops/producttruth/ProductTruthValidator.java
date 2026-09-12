package com.sellerops.producttruth;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * The rules a Product Truth ledger must satisfy before anything is allowed to read it.
 *
 * <p>Every rule here exists to stop one specific way a seller-facing sentence can come out wrong:
 * two rows claiming one id, a row that says {@code SUPPORTED} while its mode says there is no path,
 * an {@code UNKNOWN} row that nonetheless carries a sentence to say out loud, or a roadmap item that
 * could be read as something the product does today.
 *
 * <p>All violations are collected rather than thrown one at a time — a reviewer fixing the ledger
 * should see the whole list.
 */
final class ProductTruthValidator {

    /** Namespaces, so no id from one layer can ever be read as an id from another. */
    private static final String FEATURE_PREFIX = "FEATURE.";
    private static final String INVARIANT_PREFIX = "INVARIANT.";
    private static final String NARRATIVE_PREFIX = "NARRATIVE.";
    private static final String DIRECTION_PREFIX = "DIRECTION.";
    private static final String ROADMAP_PREFIX = "ROADMAP.";

    /** A roadmap qualifier has to actually qualify. */
    private static final List<String> HEDGE_WORDS = List.of("현재", "아직");

    /**
     * Sentences that assert what is happening right now rather than what the product can do.
     *
     * <p>This is the QA regression the ledger exists for, in its other direction: a capability file
     * that says "지금 자동으로 가져오고 있습니다" has swallowed the runtime overlay's job, and the
     * moment a schedule is paused the ledger is lying rather than merely incomplete. Whether it is
     * running belongs to the overlay, computed live, in its own sentence.
     */
    private static final List<String> RUNTIME_POSTURE_PHRASES = List.of(
            "들어오고 있", "가져오고 있", "수집하고 있", "돌고 있", "실행 중",
            "지금 자동으로", "현재 자동으로", "지금 수집", "현재 수집", "들어옵니다");

    /**
     * Internal names a seller cannot act on. A precondition is only useful if it names the thing the
     * seller (or the operator) can actually go and do; an OAuth scope string and a deployment
     * property are how the sentence stops being that.
     */
    private static final List<String> INTERNAL_NAMES = List.of(
            "SELLEROPS_", "sellerops.", "_ENABLED", "mall.write", "mall.read",
            "shop_no", "SHOP_NO", "client_ip", "CLIENT_IP");

    /** A subtype key is a token, not prose. */
    private static final java.util.regex.Pattern SUBTYPE_KEY =
            java.util.regex.Pattern.compile("[A-Z][A-Z0-9_]*");

    private ProductTruthValidator() {
    }

    /**
     * Every violation, in reading order. Takes the four lists rather than a loaded pack so the rules
     * can be exercised against a deliberately broken ledger without a resource file.
     */
    static List<String> validate(List<ProductCapability> capabilities,
                                 List<ProductFeature> features,
                                 List<ProductInvariant> invariants,
                                 List<ProductNarrative> narratives,
                                 List<ProductDirection> directions,
                                 List<ProductRoadmapItem> roadmap) {
        List<String> out = new ArrayList<>();
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
        Set<String> dupes = ProductTruthPack.duplicates(ids);
        if (!dupes.isEmpty()) {
            out.add("중복된 id: " + dupes);
        }
        capabilities.forEach(c -> validateCapability(c, out));
        validateCoverage(capabilities, out);
        features.forEach(f -> validateFeature(f, out));
        invariants.forEach(i -> validateInvariant(i, out));
        narratives.forEach(n -> validateNarrative(n, out));
        directions.forEach(d -> validateDirection(d, out));
        roadmap.forEach(r -> validateRoadmap(r, out));
        return out;
    }

    /** Convenience for the four-layer callers that predate features and directions. */
    static List<String> validate(List<ProductCapability> capabilities,
                                 List<ProductInvariant> invariants,
                                 List<ProductNarrative> narratives,
                                 List<ProductRoadmapItem> roadmap) {
        return validate(capabilities, List.of(), invariants, narratives, List.of(), roadmap);
    }

    private static void validateCapability(ProductCapability c, List<String> out) {
        String id = c.id() == null ? "(id 없음)" : c.id();
        String expected = c.channel() + "." + c.object() + "." + c.axis().name();
        if (!expected.equals(id)) {
            out.add(id + ": id는 CHANNEL.OBJECT.AXIS 여야 합니다 (기대: " + expected + ")");
        }
        if (!ProductTruthPack.CHANNELS.contains(c.channel())) {
            out.add(id + ": 알 수 없는 채널 " + c.channel());
        }
        if (!ProductTruthPack.OBJECTS.contains(c.object())) {
            out.add(id + ": 알 수 없는 객체 " + c.object());
        }
        if (!ProductCapabilityMode.allowedOn(c.axis()).contains(c.mode())) {
            out.add(id + ": " + c.axis() + " 축에 쓸 수 없는 mode " + c.mode()
                    + " (허용: " + ProductCapabilityMode.allowedOn(c.axis()) + ")");
        }
        // status ↔ mode. A capability that is SUPPORTED with no path, or NOT_SUPPORTED with one, is
        // the contradiction that becomes a confident wrong sentence.
        boolean noPath = c.mode() == ProductCapabilityMode.NONE;
        switch (c.status()) {
            case SUPPORTED, PARTIAL -> {
                if (noPath) {
                    out.add(id + ": status=" + c.status() + " 인데 mode=NONE 입니다");
                }
                if (c.evidence() == ProductEvidence.DECLARED || c.evidence() == ProductEvidence.UNKNOWN) {
                    if (c.status() == ProductCapabilityStatus.SUPPORTED) {
                        // Writing a capability down is not evidence that it was built.
                        out.add(id + ": SUPPORTED 는 IMPLEMENTED 이상의 evidence 가 필요합니다 (현재 "
                                + c.evidence() + ")");
                    }
                }
            }
            case NOT_SUPPORTED -> {
                if (!noPath) {
                    out.add(id + ": NOT_SUPPORTED 인데 mode=" + c.mode() + " 입니다");
                }
                if (c.evidence() == ProductEvidence.UNKNOWN) {
                    out.add(id + ": 확인하지 않은 것은 NOT_SUPPORTED 가 아니라 UNKNOWN 입니다");
                }
            }
            case UNKNOWN -> {
                if (!noPath) {
                    out.add(id + ": UNKNOWN 인데 mode=" + c.mode() + " 입니다");
                }
                if (c.evidence() != ProductEvidence.UNKNOWN) {
                    out.add(id + ": UNKNOWN status 는 evidence 도 UNKNOWN 이어야 합니다");
                }
                // An unknown capability has nothing to say to a seller. If it did, the row would be
                // making a claim its own status says it cannot make.
                if (!c.sellerFacingNotes().isEmpty()) {
                    out.add(id + ": UNKNOWN 행은 sellerFacingNotes 를 가질 수 없습니다");
                }
            }
        }
        if (c.evidence() != ProductEvidence.UNKNOWN && blank(c.evidenceRef())) {
            out.add(id + ": evidence=" + c.evidence() + " 인데 evidenceRef 가 없습니다");
        }
        if (c.status() == ProductCapabilityStatus.PARTIAL && c.limitations().isEmpty()) {
            out.add(id + ": PARTIAL 은 무엇이 부분인지 limitations 에 적어야 합니다");
        }
        if (c.status() != ProductCapabilityStatus.UNKNOWN && c.sellerFacingNotes().isEmpty()) {
            out.add(id + ": sellerFacingNotes 가 비어 있습니다");
        }
        if (c.lastReviewed() == null) {
            out.add(id + ": lastReviewed 가 없습니다");
        }
        c.sellerFacingNotes().forEach(n -> validateSellerSentence(id, n, out));
        c.limitations().forEach(l -> validateSellerSentence(id, l, out));
        validateRequirements(c, out);
        validateSubtypes(c, out);
    }

    /**
     * A capability sentence says what the product can do; it may not say what is happening now, and it
     * may not name something only an engineer can see.
     */
    private static void validateSellerSentence(String id, String sentence, List<String> out) {
        if (sentence == null) {
            return;
        }
        RUNTIME_POSTURE_PHRASES.stream().filter(sentence::contains).findFirst().ifPresent(phrase ->
                out.add(id + ": capability 문장이 지금의 실행 상태를 단정합니다 ('" + phrase
                        + "') — runtime overlay 의 문장입니다"));
        INTERNAL_NAMES.stream().filter(sentence::contains).findFirst().ifPresent(name ->
                out.add(id + ": 판매자 문장에 내부 설정 이름이 있습니다 ('" + name + "')"));
    }

    /**
     * Preconditions belong to execution, and only to a path that exists.
     *
     * <p>A requirement on a row nobody can run would be a precondition for nothing; a requirement on
     * a read would be this ledger quietly re-acquiring the runtime posture it just gave away.
     */
    private static void validateRequirements(ProductCapability c, List<String> out) {
        String id = c.id();
        if (c.requirements().isEmpty()) {
            return;
        }
        if (c.axis() != ProductCapabilityAxis.EXECUTION) {
            out.add(id + ": 실행 전제조건은 EXECUTION 축에만 적을 수 있습니다");
        }
        if (c.status() == ProductCapabilityStatus.NOT_SUPPORTED
                || c.status() == ProductCapabilityStatus.UNKNOWN) {
            out.add(id + ": status=" + c.status() + " 인 행은 실행 전제조건을 가질 수 없습니다");
        }
        for (ProductExecutionRequirement r : c.requirements()) {
            if (blank(r.description())) {
                out.add(id + ": 전제조건 " + r.kind() + " 의 설명이 비어 있습니다");
            } else {
                validateSellerSentence(id + " 전제조건", r.description(), out);
            }
        }
    }

    /**
     * A subtype refines its parent; it may not out-claim it, and a parent that generalises over
     * subtypes that disagree has to say so.
     *
     * <p>That last rule is the whole reason subtypes exist. One NAVER 문의 row saying SUPPORTED ·
     * LIVE_PROVEN is true of 상품 문의, half-true of 고객 문의 and false of 톡톡, and a reader has no
     * way to tell which. Requiring a limitation does not make the parent right on its own — it makes
     * the over-generalisation impossible to write silently.
     */
    private static void validateSubtypes(ProductCapability c, List<String> out) {
        String id = c.id();
        List<ProductCapabilitySubtype> subtypes = c.subtypes();
        if (subtypes.isEmpty()) {
            return;
        }
        for (ProductCapabilitySubtype s : subtypes) {
            String sid = s.id();
            if (!SUBTYPE_KEY.matcher(s.key() == null ? "" : s.key()).matches()) {
                out.add(sid + ": subtype key 는 대문자 토큰이어야 합니다");
            }
            if (!sid.equals(id + "." + s.key())) {
                out.add(sid + ": subtype id 는 부모 id + '.' + key 여야 합니다");
            }
            if (blank(s.label())) {
                out.add(sid + ": label 이 비어 있습니다");
            }
            if (!ProductCapabilityMode.allowedOn(c.axis()).contains(s.mode())) {
                out.add(sid + ": " + c.axis() + " 축에 쓸 수 없는 mode " + s.mode());
            }
            boolean noPath = s.mode() == ProductCapabilityMode.NONE;
            if ((s.status() == ProductCapabilityStatus.SUPPORTED
                    || s.status() == ProductCapabilityStatus.PARTIAL) && noPath) {
                out.add(sid + ": status=" + s.status() + " 인데 mode=NONE 입니다");
            }
            if (s.status() == ProductCapabilityStatus.NOT_SUPPORTED && !noPath) {
                out.add(sid + ": NOT_SUPPORTED 인데 mode=" + s.mode() + " 입니다");
            }
            if (s.evidence() != ProductEvidence.UNKNOWN && blank(s.evidenceRef())) {
                out.add(sid + ": evidence=" + s.evidence() + " 인데 evidenceRef 가 없습니다");
            }
            s.sellerFacingNotes().forEach(n -> validateSellerSentence(sid, n, out));
            s.limitations().forEach(l -> validateSellerSentence(sid, l, out));
        }
        // The parent may not claim evidence no subtype has.
        ProductEvidence strongest = subtypes.stream().map(ProductCapabilitySubtype::evidence)
                .min(java.util.Comparator.comparingInt(Enum::ordinal)).orElseThrow();
        if (c.evidence().ordinal() < strongest.ordinal()) {
            out.add(id + ": 상위 행 evidence(" + c.evidence() + ") 가 어떤 subtype 보다도 강합니다 (최대 "
                    + strongest + ")");
        }
        boolean uniform = subtypes.stream().allMatch(s -> s.status() == subtypes.get(0).status()
                && s.mode() == subtypes.get(0).mode());
        if (!uniform && c.limitations().isEmpty()) {
            out.add(id + ": subtype 마다 답이 다른데 상위 행에 limitations 가 없습니다 — 과도한 일반화입니다");
        }
    }

    /**
     * Every channel × object declares all four axes.
     *
     * <p>Silence is the failure this prevents. A missing row is indistinguishable from "we do not do
     * that" to anything reading the ledger, and the honest way to say "nobody has established this"
     * is an {@code UNKNOWN} row that says so.
     */
    private static void validateCoverage(List<ProductCapability> capabilities, List<String> out) {
        for (String channel : ProductTruthPack.CHANNELS) {
            for (String object : ProductTruthPack.OBJECTS) {
                for (ProductCapabilityAxis axis : ProductCapabilityAxis.values()) {
                    boolean present = capabilities.stream().anyMatch(
                            c -> channel.equals(c.channel()) && object.equals(c.object()) && c.axis() == axis);
                    if (!present) {
                        out.add("누락된 행: " + channel + "." + object + "." + axis);
                    }
                }
            }
        }
    }

    /**
     * A product-wide feature. Same status/evidence discipline as a capability row, minus everything
     * that only makes sense with a channel.
     */
    private static void validateFeature(ProductFeature f, List<String> out) {
        String id = f.id() == null ? "(id 없음)" : f.id();
        if (!id.startsWith(FEATURE_PREFIX)) {
            out.add(id + ": 기능 id 는 " + FEATURE_PREFIX + " 로 시작해야 합니다");
        }
        if (blank(f.title())) {
            out.add(id + ": title 이 비어 있습니다");
        }
        if (f.status() == ProductCapabilityStatus.SUPPORTED
                && (f.evidence() == ProductEvidence.DECLARED || f.evidence() == ProductEvidence.UNKNOWN)) {
            out.add(id + ": SUPPORTED 는 IMPLEMENTED 이상의 evidence 가 필요합니다 (현재 " + f.evidence() + ")");
        }
        if (f.status() == ProductCapabilityStatus.UNKNOWN && !f.sellerFacingNotes().isEmpty()) {
            out.add(id + ": UNKNOWN 행은 sellerFacingNotes 를 가질 수 없습니다");
        }
        if (f.status() == ProductCapabilityStatus.PARTIAL && f.limitations().isEmpty()) {
            out.add(id + ": PARTIAL 은 무엇이 부분인지 limitations 에 적어야 합니다");
        }
        if (f.evidence() != ProductEvidence.UNKNOWN && blank(f.evidenceRef())) {
            out.add(id + ": evidence=" + f.evidence() + " 인데 evidenceRef 가 없습니다");
        }
        if (f.status() != ProductCapabilityStatus.UNKNOWN && f.sellerFacingNotes().isEmpty()) {
            out.add(id + ": sellerFacingNotes 가 비어 있습니다");
        }
        f.sellerFacingNotes().forEach(n -> validateSellerSentence(id, n, out));
        f.limitations().forEach(l -> validateSellerSentence(id, l, out));
        if (f.lastReviewed() == null) {
            out.add(id + ": lastReviewed 가 없습니다");
        }
    }

    private static void validateInvariant(ProductInvariant i, List<String> out) {
        String id = i.id() == null ? "(id 없음)" : i.id();
        if (!id.startsWith(INVARIANT_PREFIX)) {
            out.add(id + ": 불변식 id 는 " + INVARIANT_PREFIX + " 로 시작해야 합니다");
        }
        if (blank(i.title()) || blank(i.statement())) {
            out.add(id + ": title/statement 가 비어 있습니다");
        }
        if (i.lastReviewed() == null) {
            out.add(id + ": lastReviewed 가 없습니다");
        }
    }

    private static void validateNarrative(ProductNarrative n, List<String> out) {
        String id = n.id() == null ? "(id 없음)" : n.id();
        if (!id.startsWith(NARRATIVE_PREFIX)) {
            out.add(id + ": 내러티브 id 는 " + NARRATIVE_PREFIX + " 로 시작해야 합니다");
        }
        if (blank(n.title()) || blank(n.body())) {
            out.add(id + ": title/body 가 비어 있습니다");
        }
        if (n.lastReviewed() == null) {
            out.add(id + ": lastReviewed 가 없습니다");
        }
    }

    private static void validateDirection(ProductDirection d, List<String> out) {
        String id = d.id() == null ? "(id 없음)" : d.id();
        if (!id.startsWith(DIRECTION_PREFIX)) {
            out.add(id + ": 방향 id 는 " + DIRECTION_PREFIX + " 로 시작해야 합니다");
        }
        if (blank(d.title()) || blank(d.statement())) {
            out.add(id + ": title/statement 가 비어 있습니다");
        }
        if (d.lastReviewed() == null) {
            out.add(id + ": lastReviewed 가 없습니다");
        }
    }

    private static void validateRoadmap(ProductRoadmapItem r, List<String> out) {
        String id = r.id() == null ? "(id 없음)" : r.id();
        if (!id.startsWith(ROADMAP_PREFIX)) {
            out.add(id + ": 로드맵 id 는 " + ROADMAP_PREFIX + " 로 시작해야 합니다");
        }
        if (blank(r.title()) || blank(r.summary())) {
            out.add(id + ": title/summary 가 비어 있습니다");
        }
        // Every mention of a roadmap item has to arrive with the sentence that says it is not
        // available today. A blank qualifier would let it be quoted as a current capability.
        if (blank(r.qualifier())) {
            out.add(id + ": qualifier 는 비워 둘 수 없습니다");
        } else if (HEDGE_WORDS.stream().noneMatch(w -> r.qualifier().contains(w))) {
            out.add(id + ": qualifier 가 한정어 역할을 하지 않습니다 " + HEDGE_WORDS);
        }
        if (r.lastReviewed() == null) {
            out.add(id + ": lastReviewed 가 없습니다");
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
