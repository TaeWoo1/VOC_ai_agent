package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * <b>The CoverageJudge calibration set</b> (Inquiry Decision v2.1, docs/inquiry_decision_v2_1.md §4) — the original
 * judge inputs and their counterfactual variants, built deterministically from a frozen capture and the human gold.
 * Pure: no database, no model, no clock. Test support only.
 *
 * <p>Every variant carries its own gold — {@link GoldEvidence} recomputed on the variant's candidate list — and an
 * EXPECTATION the scorer checks:
 * <ul>
 *   <li>{@link Kind#ORIGINAL} — the capture as production would send it; scored by the confusion matrix.</li>
 *   <li>{@link Kind#DROP_REQUIRED} — a need the gold covers, with the candidates of its winning set's refs removed
 *       until the gold no longer covers it: the judge must not still cover it.</li>
 *   <li>{@link Kind#CUSTOMER_VARIABLE} — a FULL need whose winning set names an option/add-on value the customer wrote:
 *       that literal is removed from the message (and the order fact with it) — the judge must not stay FULL.</li>
 *   <li>{@link Kind#UNRELATED_ADDED} — one passage of another listing, the one sharing the fewest characters with the
 *       question, added: no need may rise above what the same judge said about the original.</li>
 *   <li>{@link Kind#PRECEDENT_ONLY} — every current candidate removed, the admissible past answers kept: no need may be
 *       covered on a past answer.</li>
 *   <li>{@link Kind#OTHER_LISTING} — a listing-fact need shown only another listing's catalogue facts: the ENFORCED
 *       status must not be covered, whatever the judge says. Decided by code ({@link NeedAggregation}), so it is
 *       checked offline against a worst-case judge and costs no model call.</li>
 * </ul>
 * Past answers are admitted exactly as production admits them ({@link PrecedentReuse}) from the Eval v1 human
 * annotations: REUSABLE only — the capture holds no order binding, so an ORDER_ONLY answer is never admitted here.
 */
public final class CalibrationVariants {

    public enum Kind { ORIGINAL, DROP_REQUIRED, CUSTOMER_VARIABLE, UNRELATED_ADDED, PRECEDENT_ONLY, OTHER_LISTING }

    public enum Expectation {
        /** Scored against the gold, need by need (confusion matrix). */
        MATCH_GOLD,
        /** The target need must not be FULL or CONDITIONAL_ON_CUSTOMER. */
        NOT_COVERED,
        /** The target need must not be FULL. */
        NOT_FULL,
        /** No need may rank above the same arm's verdict on the original input. */
        NO_RISE,
        /** The target need's ENFORCED status must not be covered (code, not the judge). */
        NOT_COVERED_ENFORCED
    }

    /** One captured judge input. */
    public record Row(String q, String question, UUID product, List<InquiryNeed> needs,
                      List<EvidenceCandidate> evidence, List<PrecedentCandidate> precedents) {
    }

    /** One judge input to send (or, for OTHER_LISTING, to enforce offline) and what it is held to. */
    public record Variant(String q, Kind kind, String target, String question, UUID product, List<InquiryNeed> needs,
                          List<EvidenceCandidate> evidence, List<PrecedentCandidate> precedents,
                          Map<String, NeedStatus> gold, Map<String, List<String>> goldIds, Expectation expectation,
                          String injected) {

        public boolean needsModel() {
            return kind != Kind.OTHER_LISTING;
        }

        public String id() {
            return q + "|" + kind + "|" + target;
        }
    }

    private CalibrationVariants() {
    }

    public static Row row(JsonNode r) {
        List<InquiryNeed> needs = new ArrayList<>();
        for (JsonNode n : r.get("needs")) {
            needs.add(new InquiryNeed(n.get("id").asText(), n.get("ask").asText(),
                    NeedType.valueOf(n.get("type").asText()), n.get("ask").asText()));
        }
        List<EvidenceCandidate> evidence = new ArrayList<>();
        for (JsonNode e : r.get("evidence")) {
            evidence.add(new EvidenceCandidate(e.get("id").asText(), EvidenceCandidate.Kind.valueOf(e.get("kind").asText()),
                    e.path("label").asText(""), e.path("text").asText(""), uuid(e.get("source")), uuid(e.get("product")),
                    e.hasNonNull("fact_key") ? e.get("fact_key").asText() : null));
        }
        List<PrecedentCandidate> precedents = new ArrayList<>();
        for (JsonNode p : r.get("precedents")) {
            precedents.add(new PrecedentCandidate(p.get("id").asText(), UUID.fromString(p.get("memory").asText()),
                    p.path("text").asText("")));
        }
        return new Row(r.get("q").asText(), r.path("question").asText(""), uuid(r.get("product")), needs, evidence,
                precedents);
    }

    private static UUID uuid(JsonNode n) {
        return n == null || n.isNull() || n.asText().isEmpty() ? null : UUID.fromString(n.asText());
    }

    /**
     * @param gold     the Eval v1 needs, keyed {@code q + "." + need}
     * @param reusable the memory-id prefixes the Eval v1 annotation marks REUSABLE
     */
    public static List<Variant> build(List<Row> rows, Map<String, JsonNode> gold, Set<String> reusable) {
        List<Variant> out = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            Row row = rows.get(i);
            List<PrecedentCandidate> admitted = admitted(row.precedents(), reusable);
            Map<String, JsonNode> g = goldOf(row, gold);
            out.add(variant(row, Kind.ORIGINAL, "*", row.question(), row.evidence(), admitted, g,
                    Expectation.MATCH_GOLD, null, null));
            for (InquiryNeed need : row.needs()) {
                JsonNode goldNeed = g.get(need.id());
                GoldEvidence.Verdict before = GoldEvidence.judge(goldNeed, renumber(row.evidence()));
                if (before.status().covered()) {
                    List<EvidenceCandidate> dropped = dropUntilUncovered(goldNeed, row.evidence(), before.status());
                    if (dropped != null) {
                        out.add(variant(row, Kind.DROP_REQUIRED, need.id(), row.question(), dropped, admitted, g,
                                Expectation.NOT_COVERED, null, null));
                    }
                }
                if (before.status() == NeedStatus.FULL) {
                    String literal = customerLiteral(goldNeed, row.evidence(), row.question());
                    if (literal != null) {
                        List<EvidenceCandidate> noOrder = row.evidence().stream()
                                .filter(e -> e.kind() != EvidenceCandidate.Kind.ORDER_FACT).toList();
                        out.add(variant(row, Kind.CUSTOMER_VARIABLE, need.id(), row.question().replace(literal, ""),
                                noOrder, admitted, g, Expectation.NOT_FULL, null, need.id()));
                    }
                }
                if (need.type().aboutTheListing() && need.type() != NeedType.CATALOGUE_AVAILABILITY
                        && before.status() != NeedStatus.NONE && row.product() != null) {
                    List<EvidenceCandidate> foreign = otherListing(rows, i);
                    if (!foreign.isEmpty()) {
                        out.add(variant(row, Kind.OTHER_LISTING, need.id(), row.question(), foreign, admitted, g,
                                Expectation.NOT_COVERED_ENFORCED, null, null));
                    }
                }
            }
            EvidenceCandidate unrelated = unrelated(rows, i, g.values());
            if (unrelated != null) {
                List<EvidenceCandidate> plus = new ArrayList<>(row.evidence());
                plus.add(unrelated);
                String injected = "E" + plus.size();
                out.add(variant(row, Kind.UNRELATED_ADDED, "*", row.question(), plus, admitted, g, Expectation.NO_RISE,
                        injected, null));
            }
            if (!admitted.isEmpty()) {
                out.add(variant(row, Kind.PRECEDENT_ONLY, "*", row.question(), List.of(), admitted, g,
                        Expectation.NOT_COVERED, null, null));
            }
        }
        return out;
    }

    private static Map<String, JsonNode> goldOf(Row row, Map<String, JsonNode> gold) {
        Map<String, JsonNode> g = new LinkedHashMap<>();
        for (InquiryNeed n : row.needs()) {
            JsonNode node = gold.get(row.q() + "." + n.id());
            if (node == null) {
                throw new IllegalStateException("no gold for " + row.q() + "." + n.id());
            }
            g.put(n.id(), node);
        }
        return g;
    }

    private static Variant variant(Row row, Kind kind, String target, String question, List<EvidenceCandidate> evidence,
                                   List<PrecedentCandidate> precedents, Map<String, JsonNode> g, Expectation expect,
                                   String injected, String capAtConditional) {
        List<EvidenceCandidate> numbered = renumber(evidence);
        List<PrecedentCandidate> p = new ArrayList<>();
        for (PrecedentCandidate c : precedents) {
            p.add(new PrecedentCandidate("P" + (p.size() + 1), c.memoryId(), c.text()));
        }
        Map<String, NeedStatus> statuses = new LinkedHashMap<>();
        Map<String, List<String>> ids = new LinkedHashMap<>();
        for (InquiryNeed n : row.needs()) {
            GoldEvidence.Verdict verdict = GoldEvidence.judge(g.get(n.id()), numbered);
            ids.put(n.id(), verdict.ids());
            NeedStatus s = verdict.status();
            if (n.id().equals(capAtConditional) && s == NeedStatus.FULL) {
                s = NeedStatus.CONDITIONAL_ON_CUSTOMER; // the value that made it FULL is no longer stated
            }
            statuses.put(n.id(), s);
        }
        return new Variant(row.q(), kind, target, question, row.product(), row.needs(), numbered, List.copyOf(p),
                statuses, ids, expect, injected);
    }

    static List<EvidenceCandidate> renumber(List<EvidenceCandidate> evidence) {
        List<EvidenceCandidate> out = new ArrayList<>();
        for (EvidenceCandidate e : evidence) {
            out.add(e.withId("E" + (out.size() + 1)));
        }
        return out;
    }

    static List<PrecedentCandidate> admitted(List<PrecedentCandidate> offered, Set<String> reusable) {
        List<PrecedentCandidate> out = new ArrayList<>();
        for (PrecedentCandidate p : offered) {
            String id = p.memoryId().toString();
            if (reusable.stream().anyMatch(id::startsWith)) {
                out.add(p);
            }
        }
        return out;
    }

    /** Remove the candidates of the winning set's first ref, again, until the gold no longer covers; null if it can't. */
    static List<EvidenceCandidate> dropUntilUncovered(JsonNode goldNeed, List<EvidenceCandidate> evidence,
                                                      NeedStatus from) {
        List<EvidenceCandidate> pool = new ArrayList<>(evidence);
        for (int round = 0; round < 6; round++) {
            List<EvidenceCandidate> numbered = renumber(pool);
            GoldEvidence.Verdict v = GoldEvidence.judge(goldNeed, numbered);
            if (!v.status().covered()) {
                return round == 0 ? null : pool;
            }
            String ref = winningFirstRef(goldNeed, numbered, v.status());
            if (ref == null) {
                return null;
            }
            List<EvidenceCandidate> next = pool.stream().filter(e -> !GoldEvidence.matches(ref, e)).toList();
            if (next.size() == pool.size()) {
                return null;
            }
            pool = new ArrayList<>(next);
        }
        return null;
    }

    private static String winningFirstRef(JsonNode goldNeed, List<EvidenceCandidate> numbered, NeedStatus status) {
        for (JsonNode set : goldNeed.get("sets")) {
            if (GoldEvidence.statusOf(set.get("suff").asText()) == status
                    && GoldEvidence.matchSet(set, numbered) != null) {
                return set.get("refs").get(0).asText();
            }
        }
        return null;
    }

    /** The option/add-on value a FULL set names, when the customer's message states it literally. */
    static String customerLiteral(JsonNode goldNeed, List<EvidenceCandidate> evidence, String question) {
        List<EvidenceCandidate> numbered = renumber(evidence);
        for (JsonNode set : goldNeed.get("sets")) {
            if (!"FULL".equals(set.get("suff").asText()) || GoldEvidence.matchSet(set, numbered) == null) {
                continue;
            }
            for (JsonNode ref : set.get("refs")) {
                String r = ref.asText();
                if (r.startsWith("OPT:") || r.startsWith("ADDON:")) {
                    String literal = GoldEvidence.literalOf(r);
                    if (literal != null && question.contains(literal)) {
                        return literal;
                    }
                }
            }
        }
        return null;
    }

    /** The first other listing's catalogue facts, in capture order after this row — bound to that listing. */
    static List<EvidenceCandidate> otherListing(List<Row> rows, int at) {
        UUID own = rows.get(at).product();
        for (int k = 1; k < rows.size(); k++) {
            Row other = rows.get((at + k) % rows.size());
            if (other.product() == null || other.product().equals(own)) {
                continue;
            }
            List<EvidenceCandidate> facts = other.evidence().stream()
                    .filter(e -> e.productId() != null && !e.productId().equals(own)
                            && e.kind() != EvidenceCandidate.Kind.ORDER_FACT)
                    .toList();
            if (!facts.isEmpty()) {
                return facts;
            }
        }
        return List.of();
    }

    /**
     * Another listing's passage that touches no gold ref of this question and shares the fewest character bigrams with
     * the question and its needs — 「unrelated」 measured, not asserted. Ties go to capture order.
     */
    static EvidenceCandidate unrelated(List<Row> rows, int at, java.util.Collection<JsonNode> gold) {
        Row row = rows.get(at);
        Set<String> mine = bigrams(row.question() + " " + String.join(" ",
                row.needs().stream().map(InquiryNeed::ask).toList()));
        Set<UUID> ownSources = new HashSet<>();
        row.evidence().forEach(e -> ownSources.add(e.sourceId()));
        EvidenceCandidate best = null;
        double bestScore = Double.MAX_VALUE;
        for (int k = 1; k < rows.size(); k++) {
            Row other = rows.get((at + k) % rows.size());
            if (other.product() == null || other.product().equals(row.product())) {
                continue;
            }
            for (EvidenceCandidate e : other.evidence()) {
                if (e.kind() != EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE || ownSources.contains(e.sourceId())
                        || gold.stream().anyMatch(g -> GoldEvidence.touches(g, e))) {
                    continue;
                }
                Set<String> theirs = bigrams(e.label() + " " + e.text());
                Set<String> both = new HashSet<>(mine);
                both.retainAll(theirs);
                double score = theirs.isEmpty() ? 1 : (double) both.size() / Math.max(1, Math.min(mine.size(), theirs.size()));
                if (score < bestScore) {
                    bestScore = score;
                    // A passage carries no listing id in production (its lane is already product-scoped), so the
                    // injected one carries none either: the enforced status gets no help code would not have.
                    best = new EvidenceCandidate(null, e.kind(), e.label(), e.text(), e.sourceId(), null, e.factKey());
                }
            }
        }
        return best;
    }

    private static Set<String> bigrams(String s) {
        String t = s.replaceAll("\\s+", "");
        Set<String> out = new HashSet<>();
        for (int i = 0; i + 1 < t.length(); i++) {
            out.add(t.substring(i, i + 2));
        }
        return out;
    }

    /** Fixture counts by kind — what the report states before any model is called. */
    public static Map<Kind, Integer> counts(List<Variant> variants) {
        Map<Kind, Integer> out = new LinkedHashMap<>();
        for (Kind k : Kind.values()) {
            out.put(k, 0);
        }
        variants.forEach(v -> out.merge(v.kind(), 1, Integer::sum));
        return out;
    }
}
