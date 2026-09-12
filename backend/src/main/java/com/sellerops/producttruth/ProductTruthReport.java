package com.sellerops.producttruth;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Renders the ledger as one markdown page a person can read end to end.
 *
 * <p>The YAML is the source and is already meant to be read, but 48 capability rows spread over 900
 * lines is a poor way to answer "what does this product do, per channel". This renders the same facts
 * as a table, and {@code ProductTruthReportTest} keeps the committed copy equal to what the ledger
 * currently says — a report that can drift from its own source would be worse than none.
 */
public final class ProductTruthReport {

    private ProductTruthReport() {
    }

    public static String render(ProductTruthPack pack) {
        StringBuilder md = new StringBuilder();
        md.append("<!-- 생성된 파일입니다. 손으로 고치지 마세요.\n")
                .append("     원본은 backend/src/main/resources/product-truth/*.yaml 이고,\n")
                .append("     이 파일은 ProductTruthReportTest 가 다시 씁니다. -->\n\n");
        md.append("# Product Truth v2 — 렌더된 요약\n\n");
        md.append("reviewnary가 제품으로서 무엇을 제공하는가. **현재 배포에서 켜져 있는가와는 다른 질문**이고,\n")
                .append("그 답은 여기에 없다 — 실행 시점에 계산해서 이 위에 덧붙인다.\n\n");

        md.append("## 검토 상태\n\n");
        // Items that carry a review state. Subtypes are not counted: they inherit their parent row's
        // review, so counting their ids here would report them as already human-reviewed.
        int total = pack.capabilities().size() + pack.features().size() + pack.invariants().size()
                + pack.narratives().size() + pack.directions().size() + pack.roadmap().size();
        int pending = pack.pendingReview().size();
        md.append("- 층: capability ").append(pack.capabilities().size())
                .append("행 · 제품 기능 ").append(pack.features().size())
                .append(" · 불변식 ").append(pack.invariants().size())
                .append(" · 내러티브 ").append(pack.narratives().size())
                .append(" · 방향 ").append(pack.directions().size())
                .append(" · 로드맵 ").append(pack.roadmap().size()).append('\n');
        md.append("- 전체 항목 **").append(total).append("**개 · 사람이 확인한 항목 **")
                .append(total - pending).append("**개 · **").append(pending)
                .append("**개가 `TODO_REVIEW`\n\n");

        md.append("## 채널 × 객체 capability\n\n");
        for (String channel : ProductTruthPack.CHANNELS) {
            md.append("### ").append(channel).append("\n\n");
            md.append("| 객체 | 수집 | 읽기 | 초안 | 실행 |\n|---|---|---|---|---|\n");
            for (String object : ProductTruthPack.OBJECTS) {
                md.append("| **").append(object).append("** ");
                for (ProductCapabilityAxis axis : ProductCapabilityAxis.values()) {
                    md.append("| ").append(cell(pack, channel, object, axis)).append(' ');
                }
                md.append("|\n");
            }
            md.append('\n');
        }

        md.append("## 행별 상세\n\n");
        for (ProductCapability c : pack.capabilities()) {
            md.append("### `").append(c.id()).append("` — ").append(c.status()).append(" · ")
                    .append(c.mode()).append(" · ").append(c.evidence()).append('\n');
            md.append("근거: ").append(oneLine(c.evidenceRef())).append("\n\n");
            c.sellerFacingNotes().forEach(n -> md.append("- 판매자에게: ").append(oneLine(n)).append('\n'));
            c.limitations().forEach(l -> md.append("- 주장 금지: ").append(oneLine(l)).append('\n'));
            c.requirements().forEach(r -> md.append("- 실행 전제(").append(r.kind()).append("): ")
                    .append(oneLine(r.description())).append('\n'));
            for (ProductCapabilitySubtype s : c.subtypes()) {
                md.append("- 하위 `").append(s.key()).append("` (").append(s.label()).append("): ")
                        .append(s.status()).append(" · ").append(s.mode()).append(" · ")
                        .append(s.evidence()).append('\n');
                s.sellerFacingNotes().forEach(n -> md.append("  - 판매자에게: ")
                        .append(oneLine(n)).append('\n'));
                s.limitations().forEach(l -> md.append("  - 주장 금지: ").append(oneLine(l)).append('\n'));
            }
            md.append('\n');
        }

        md.append("## 채널×객체가 아닌 제품 기능\n\n");
        md.append("| id | 기능 | 상태 | 근거 수준 |\n|---|---|---|---|\n");
        for (ProductFeature f : pack.features()) {
            md.append("| `").append(f.id()).append("` | ").append(f.title()).append(" | ")
                    .append(f.status()).append(" | ").append(f.evidence()).append(" |\n");
        }
        md.append('\n');
        for (ProductFeature f : pack.features()) {
            md.append("### `").append(f.id()).append("` — ").append(f.title()).append('\n');
            md.append("근거: ").append(oneLine(f.evidenceRef())).append("\n\n");
            f.sellerFacingNotes().forEach(n -> md.append("- 판매자에게: ").append(oneLine(n)).append('\n'));
            f.limitations().forEach(l -> md.append("- 주장 금지: ").append(oneLine(l)).append('\n'));
            md.append('\n');
        }

        md.append("## 제품 전체 불변식\n\n");
        for (ProductInvariant i : pack.invariants()) {
            md.append("### `").append(i.id()).append("` — ").append(i.title()).append('\n');
            md.append(oneLine(i.statement())).append("\n\n");
            i.notThis().forEach(n -> md.append("- 경계: ").append(oneLine(n)).append('\n'));
            md.append('\n');
        }

        md.append("## 제품 내러티브\n\n");
        for (ProductNarrative n : pack.narratives()) {
            md.append("### `").append(n.id()).append("` — ").append(n.title()).append('\n');
            md.append(oneLine(n.body())).append("\n\n");
        }

        md.append("## 제품 방향 — 결정됐지만 capability 주장이 아님\n\n");
        for (ProductDirection d : pack.directions()) {
            md.append("### `").append(d.id()).append("` — ").append(d.title()).append('\n');
            md.append(oneLine(d.statement())).append("\n\n");
        }

        md.append("## 로드맵 — 현재 기능이 아님\n\n");
        md.append("| id | 상태 | 항목 | 함께 말해야 하는 한정어 |\n|---|---|---|---|\n");
        for (ProductRoadmapItem r : pack.roadmap()) {
            md.append("| `").append(r.id()).append("` | ").append(r.status()).append(" | ")
                    .append(r.title()).append(" | ").append(oneLine(r.qualifier())).append(" |\n");
        }
        md.append('\n');

        md.append("## 사람이 확인해야 하는 항목\n\n");
        // An empty list under a heading reads as a report that failed to render, not as "none left".
        // Saying it is the same rule the rest of this product follows about honest absence.
        md.append(pending == 0
                ? "없습니다 — " + total + "개 항목 모두 사람이 확인했습니다."
                : pack.pendingReview().stream().map(id -> "- `" + id + "`")
                        .collect(Collectors.joining("\n")));
        md.append('\n');
        return md.toString();
    }

    private static String cell(ProductTruthPack pack, String channel, String object,
                               ProductCapabilityAxis axis) {
        return pack.capability(channel, object, axis)
                .map(c -> c.status() == ProductCapabilityStatus.NOT_SUPPORTED
                        ? "— " + c.evidence()
                        : c.status() + " · " + c.mode() + " · " + c.evidence())
                .orElse("(행 없음)");
    }

    private static String oneLine(String s) {
        if (s == null) {
            return "";
        }
        return String.join(" ", List.of(s.trim().split("\\s+")));
    }
}
