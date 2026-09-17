package com.sellerops.knowledge.spine;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import com.sellerops.knowledge.KnowledgeTopic;

/**
 * <b>Two pieces of company knowledge that state different figures about the same thing.</b>
 *
 * <p>Detected deterministically and conservatively: both entries must name at least one common {@link KnowledgeTopic}
 * (or, for two entries about the same product with no declared topic, share their title's words), both must state a
 * figure in the same unit, and the two sets of figures must not overlap — 「7일」 against 「30일」, 「3,000원」 against
 * 「6,000원」. Nothing is inferred from wording; a conflict nobody can point at a number for is not reported.
 *
 * <p><b>Resolution only ever moves toward the seller's stronger word.</b> The winner is the lower authority rank,
 * then the fresher source. The loser is not deleted from anywhere — it is left out of what a draft is written with,
 * and the conflict itself is shown to the investigation and the seller.
 */
public record KnowledgeConflict(String winnerEntryId, String winnerTitle, KnowledgeAuthority winnerAuthority,
                                String loserEntryId, String loserTitle, KnowledgeAuthority loserAuthority,
                                String unit) {

    private static final Pattern FIGURE = Pattern.compile(
            "(\\d[\\d,]*(?:\\.\\d+)?)\\s*(영업일|개월|시간|일|주|년|원|mm|cm|kg|ml|m|g|%|개|호)");

    static final Comparator<KnowledgeEntry> STRONGER = Comparator
            .comparingInt((KnowledgeEntry e) -> e.authority().rank())
            .thenComparing(KnowledgeEntry::capturedAt, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(KnowledgeEntry::entryId);

    public static List<KnowledgeConflict> detect(List<KnowledgeEntry> entries) {
        List<KnowledgeConflict> found = new ArrayList<>();
        for (int i = 0; i < entries.size(); i++) {
            for (int j = i + 1; j < entries.size(); j++) {
                KnowledgeEntry a = entries.get(i);
                KnowledgeEntry b = entries.get(j);
                if (!sameSubject(a, b)) {
                    continue;
                }
                for (String unit : sharedUnits(a, b)) {
                    Set<String> fa = figures(a, unit);
                    Set<String> fb = figures(b, unit);
                    if (!fa.isEmpty() && !fb.isEmpty() && fa.stream().noneMatch(fb::contains)) {
                        KnowledgeEntry winner = STRONGER.compare(a, b) <= 0 ? a : b;
                        KnowledgeEntry loser = winner == a ? b : a;
                        found.add(new KnowledgeConflict(winner.entryId(), winner.title(), winner.authority(),
                                loser.entryId(), loser.title(), loser.authority(), unit));
                        break;
                    }
                }
            }
        }
        return List.copyOf(found);
    }

    private static boolean sameSubject(KnowledgeEntry a, KnowledgeEntry b) {
        Set<KnowledgeTopic> ta = KnowledgeTopic.of(a.title() + " " + a.text());
        Set<KnowledgeTopic> tb = KnowledgeTopic.of(b.title() + " " + b.text());
        if (!ta.isEmpty() && !tb.isEmpty()) {
            return ta.stream().anyMatch(tb::contains);
        }
        // No declared topic on either side: two statements about the same product whose titles share a word.
        if (a.productId() == null || !a.productId().equals(b.productId())) {
            return false;
        }
        Set<String> wa = words(a.title());
        return words(b.title()).stream().anyMatch(wa::contains);
    }

    private static Set<String> words(String title) {
        Set<String> out = new LinkedHashSet<>();
        if (title != null) {
            for (String w : title.split("[\\s·,/()\\[\\]「」-]+")) {
                if (w.length() >= 2) {
                    out.add(w);
                }
            }
        }
        return out;
    }

    private static Set<String> sharedUnits(KnowledgeEntry a, KnowledgeEntry b) {
        Set<String> ua = units(a);
        Set<String> shared = new LinkedHashSet<>();
        for (String u : units(b)) {
            if (ua.contains(u)) {
                shared.add(u);
            }
        }
        return shared;
    }

    private static Set<String> units(KnowledgeEntry e) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = FIGURE.matcher(e.text() == null ? "" : e.text());
        while (m.find()) {
            out.add(m.group(2));
        }
        return out;
    }

    private static Set<String> figures(KnowledgeEntry e, String unit) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = FIGURE.matcher(e.text() == null ? "" : e.text());
        while (m.find()) {
            if (m.group(2).equals(unit)) {
                out.add(m.group(1).replace(",", ""));
            }
        }
        return out;
    }
}
