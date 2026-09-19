package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * <b>The human gold, applied to a candidate list</b> — what Inquiry Need Eval v1's evidence sets say about the exact
 * candidates a judge was shown. Test support only; nothing here reads a sentence.
 *
 * <p>This is the reference the CoverageJudge is held to (Inquiry Decision v2.1): not the snapshot-level answerability —
 * a judge cannot be blamed for a document the collector never gave it — but the best sufficiency among the gold
 * evidence sets whose every ref is present in THIS list. An AND set with one ref missing is no support; an UNKNOWN set
 * (an image, an uncollected detail) is never support, because nothing here can read it.
 */
public final class GoldEvidence {

    private GoldEvidence() {
    }

    /** The gold status of one need over one candidate list, and the candidates the winning set matched. */
    public record Verdict(NeedStatus status, List<String> ids) {
    }

    public static Verdict judge(JsonNode goldNeed, List<EvidenceCandidate> evidence) {
        String best = null;
        List<String> ids = List.of();
        for (JsonNode set : goldNeed.get("sets")) {
            String suff = set.get("suff").asText();
            if ("UNKNOWN".equals(suff)) {
                continue;
            }
            List<String> matched = matchSet(set, evidence);
            if (matched != null && rank(suff) > rank(best)) {
                best = suff;
                ids = matched;
            }
        }
        return new Verdict(statusOf(best), ids);
    }

    /** The candidate ids matching every ref of one set, or null when one ref matches nothing. */
    public static List<String> matchSet(JsonNode set, List<EvidenceCandidate> evidence) {
        Set<String> matched = new LinkedHashSet<>();
        for (JsonNode ref : set.get("refs")) {
            List<String> hit = evidence.stream().filter(e -> matches(ref.asText(), e)).map(EvidenceCandidate::id)
                    .toList();
            if (hit.isEmpty()) {
                return null;
            }
            matched.addAll(hit);
        }
        return new ArrayList<>(matched);
    }

    /** Every candidate any ref of this need (current or family) points at — what 「unrelated」 must avoid. */
    public static boolean touches(JsonNode goldNeed, EvidenceCandidate e) {
        for (String field : List.of("sets", "family_sets")) {
            for (JsonNode set : goldNeed.path(field)) {
                for (JsonNode ref : set.get("refs")) {
                    if (matches(ref.asText(), e)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    public static NeedStatus statusOf(String suff) {
        if (suff == null) {
            return NeedStatus.NONE;
        }
        return switch (suff) {
            case "FULL" -> NeedStatus.FULL;
            case "CONDITIONAL" -> NeedStatus.CONDITIONAL_ON_CUSTOMER;
            case "PARTIAL" -> NeedStatus.PARTIAL;
            default -> NeedStatus.NONE;
        };
    }

    public static int rank(String s) {
        return s == null ? 0 : switch (s) {
            case "FULL" -> 3;
            case "CONDITIONAL" -> 2;
            case "PARTIAL" -> 1;
            default -> 0;
        };
    }

    public static int rank(NeedStatus s) {
        return s == null ? 0 : switch (s) {
            case FULL -> 3;
            case CONDITIONAL_ON_CUSTOMER -> 2;
            case PARTIAL -> 1;
            default -> 0;
        };
    }

    public static boolean matches(String ref, EvidenceCandidate e) {
        int colon = ref.indexOf(':');
        String kind = ref.substring(0, colon);
        String rest = ref.substring(colon + 1);
        String id = rest.contains("#") ? rest.substring(0, rest.indexOf('#')) : rest;
        String pattern = rest.contains("#") ? rest.substring(rest.indexOf('#') + 1) : null;
        String product = e.productId() == null ? "" : e.productId().toString();
        String source = e.sourceId() == null ? "" : e.sourceId().toString();
        return switch (kind) {
            case "PK" -> e.kind() == EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE && source.startsWith(id);
            case "OK" -> e.kind() == EvidenceCandidate.Kind.ORG_KNOWLEDGE && source.startsWith(id);
            case "ORDER" -> e.kind() == EvidenceCandidate.Kind.ORDER_FACT;
            case "CAT" -> product.startsWith(id);
            case "OPT" -> e.kind() == EvidenceCandidate.Kind.OPTIONS && product.startsWith(id)
                    && anyLine(e.text(), pattern);
            case "ADDON" -> e.kind() == EvidenceCandidate.Kind.ADDONS && product.startsWith(id)
                    && anyLine(e.text(), pattern);
            case "FACT" -> e.kind() == EvidenceCandidate.Kind.PRODUCT_FACTS && product.startsWith(id)
                    && Arrays.stream(e.text().split("\n")).anyMatch(l -> l.startsWith(pattern));
            default -> false;
        };
    }

    /** The literal a LIKE pattern names, wildcards removed ({@code %2호%} → {@code 2호}); null when nothing is left. */
    public static String literalOf(String ref) {
        int hash = ref.indexOf('#');
        if (hash < 0) {
            return null;
        }
        String core = ref.substring(hash + 1).replace("%", "").replace("_", "").strip();
        return core.isEmpty() ? null : core;
    }

    private static boolean anyLine(String text, String like) {
        Pattern re = Pattern.compile("^" + Pattern.quote(like).replace("%", "\\E.*\\Q").replace("_", "\\E.\\Q") + "$",
                Pattern.DOTALL);
        return Arrays.stream(text.split("\n")).anyMatch(l -> re.matcher(l).matches());
    }
}
