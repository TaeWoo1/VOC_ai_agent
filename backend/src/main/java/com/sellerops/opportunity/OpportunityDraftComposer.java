package com.sellerops.opportunity;

import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.util.ArrayList;
import java.util.List;

/**
 * Every sentence a seller reads about an opportunity, in one place — so the line "data does not name a
 * cause" is held by a file rather than by each caller remembering it.
 *
 * <p>Three kinds of text come out of here and all three are composed from facts the run already holds:
 * <ul>
 *   <li><b>why</b> — the issue's own numbers (evidence count, span, change judgement from
 *       {@code IssueChangeRules}), the product, and the knowledge check;</li>
 *   <li><b>recommendation</b> — WHERE to act, phrased as something to review; no cause, no promised
 *       effect;</li>
 *   <li><b>draft</b> — a scaffold: the question the customers keep raising, and where the seller has
 *       already answered it, their own sentences. Where they have not, the draft says so and leaves
 *       the answer to them. No model writes any of it.</li>
 * </ul>
 */
public final class OpportunityDraftComposer {

    private OpportunityDraftComposer() {
    }

    /** A prepared draft — title and body. */
    public record Draft(String title, String body) {
    }

    public static List<String> why(ReviewIssueView issue, OpportunityRules.Candidate candidate,
                                   KnowledgeMention mention) {
        List<String> out = new ArrayList<>(4);
        out.add("「" + issue.title() + "」 근거 리뷰 " + issue.evidenceCount() + "건" + span(issue) + ".");
        if (issue.change() != null && !issue.change().labelsKo().isEmpty()) {
            out.add("최근 판단: " + String.join(", ", issue.change().labelsKo()) + ".");
        }
        if (issue.dominantProductName() != null) {
            out.add("주로 " + issue.dominantProductName() + "에서 나타났습니다.");
        }
        if (candidate.lane() == OpportunityRules.Lane.GUIDANCE && mention != null) {
            out.add(knowledgeLine(candidate, issue.aspect(), mention));
        }
        return List.copyOf(out);
    }

    static String knowledgeLine(OpportunityRules.Candidate candidate, String aspect, KnowledgeMention mention) {
        String place = scopeLabelKo(candidate.target());
        String topic = topicOf(candidate.target(), aspect);
        if (mention.sources() == 0) {
            return place + "에 등록된 내용이 아직 없습니다.";
        }
        if (!mention.mentioned()) {
            return place + " " + mention.sources() + "건 중 '" + topic + "'을(를) 다룬 내용은 없습니다.";
        }
        return place + " " + mention.sources() + "건 중 " + mention.mentions() + "건이 '" + topic + "'을(를) 다룹니다.";
    }

    /** What the guidance is ABOUT in the seller's words: the company rule's own name, or the aspect. */
    public static String topicOf(OpportunityRules.GuidanceTarget target, String aspect) {
        if (target != null && target.scope() == OpportunityRules.Scope.ORG && target.orgType() != null) {
            return target.orgType().labelKo();
        }
        return aspect;
    }

    public static String scopeLabelKo(OpportunityRules.GuidanceTarget target) {
        if (target == null) {
            return "";
        }
        return target.scope() == OpportunityRules.Scope.ORG ? "회사 운영 기준" : "이 상품의 상품 지식";
    }

    public static String recommendation(ReviewIssueView issue, OpportunityRules.Candidate candidate,
                                        KnowledgeMention mention) {
        String aspect = issue.aspect();
        return switch (candidate.kind()) {
            case FAQ_SUPPLEMENT ->
                "'" + aspect + "' 관련 안내를 이 상품의 자주 묻는 질문에 추가하는 것을 검토하세요. "
                        + "지금은 상품 지식에 그 내용이 없어 문의 답변도 근거 없이 나갑니다.";
            case PRODUCT_GUIDE_SUPPLEMENT -> "불일치".equals(issue.problem())
                ? "고객이 사진·설명과 다르다고 말한 부분을 근거 리뷰에서 확인하고, 상세페이지 안내를 보완하는 것을 검토하세요."
                : (mention != null && mention.mentioned()
                    ? "'" + aspect + "' 관련 내용이 상품 지식에는 있습니다. 구매 전에도 보이도록 상세페이지 안내에 넣는 것을 검토하세요."
                    : "'" + aspect + "' 관련 안내를 상세페이지에 넣는 것을 검토하세요.");
            case OPERATING_POLICY_SUPPLEMENT -> {
                String topic = topicOf(candidate.target(), aspect);
                yield mention != null && mention.mentioned()
                    ? "'" + topic + "' 기준이 등록돼 있는데도 '" + issue.title() + "' 불만이 반복됩니다. "
                        + "기준을 더 구체적으로 적거나 고객에게 안내되는 시점을 검토하세요."
                    : "'" + topic + "' 기준을 회사 운영 기준에 등록하는 것을 검토하세요. 지금은 '"
                        + issue.title() + "' 문의에 답할 기준이 없습니다.";
            }
            case PRODUCT_IMPROVEMENT_REVIEW ->
                "'" + aspect + " " + issue.problem() + "' 불만이 반복됩니다. 제품이나 포장 자체를 바꿔야 하는지 검토하세요. "
                        + "원인은 리뷰가 말하지 않으므로 근거 리뷰를 직접 확인하세요.";
        };
    }

    public static Draft draft(ReviewIssueView issue, OpportunityRules.Candidate candidate, KnowledgeMention mention) {
        String aspect = issue.aspect();
        String product = issue.dominantProductName() == null ? "" : issue.dominantProductName();
        return switch (candidate.kind()) {
            case FAQ_SUPPLEMENT -> new Draft(
                    "Q. " + aspect + " 관련해서 자주 묻는 질문",
                    "질문: " + issue.title() + "에 대해 고객이 반복해서 언급합니다 (근거 리뷰 " + issue.evidenceCount() + "건).\n\n"
                            + "답변: (판매자님이 채워 주세요 — 상품 지식에 이 내용이 없어 reviewnary가 대신 쓰지 않습니다.)");
            case PRODUCT_GUIDE_SUPPLEMENT -> new Draft(
                    (product.isEmpty() ? "" : product + " ") + "상세페이지 안내문 초안 (" + aspect + ")",
                    excerptsOrPlaceholder(mention,
                            "상품 지식에서 옮겨 온 판매자님의 문장입니다. 상세페이지에 맞게 다듬어 주세요.",
                            "이 항목에 대해 등록된 상품 지식이 없습니다. 근거 리뷰(" + issue.evidenceCount()
                                    + "건)에서 고객이 무엇을 기대했는지 확인한 뒤 안내문을 적어 주세요."));
            case OPERATING_POLICY_SUPPLEMENT -> new Draft(
                    topicOf(candidate.target(), aspect) + " 기준 초안 — " + issue.title(),
                    excerptsOrPlaceholder(mention,
                            "회사 운영 기준에서 옮겨 온 문장입니다. '" + issue.title() + "' 불만(" + issue.evidenceCount()
                                    + "건)에 비추어 더 구체적으로 적어 주세요.",
                            "등록된 " + topicOf(candidate.target(), aspect) + " 기준이 없습니다. 고객에게 안내할 기준을 적어 주세요 (근거 리뷰 "
                                    + issue.evidenceCount() + "건)."));
            case PRODUCT_IMPROVEMENT_REVIEW -> new Draft(
                    "제품 개선 검토 메모 — " + issue.title(),
                    memo(issue));
        };
    }

    private static String excerptsOrPlaceholder(KnowledgeMention mention, String lead, String placeholder) {
        if (mention == null || mention.excerpts().isEmpty()) {
            return placeholder;
        }
        StringBuilder sb = new StringBuilder(lead).append("\n\n");
        for (String excerpt : mention.excerpts()) {
            sb.append("- ").append(excerpt).append('\n');
        }
        return sb.toString().strip();
    }

    private static String memo(ReviewIssueView issue) {
        StringBuilder sb = new StringBuilder();
        sb.append("반복된 문제: ").append(issue.title()).append('\n');
        if (issue.dominantProductName() != null) {
            sb.append("상품: ").append(issue.dominantProductName()).append('\n');
        }
        sb.append("근거 리뷰: ").append(issue.evidenceCount()).append("건").append(span(issue)).append('\n');
        if (issue.change() != null && !issue.change().labelsKo().isEmpty()) {
            sb.append("최근 판단: ").append(String.join(", ", issue.change().labelsKo())).append('\n');
        }
        sb.append("\n검토할 것:\n")
                .append("- 근거 리뷰에서 공통으로 나오는 상황 확인\n")
                .append("- 제품·포장·안내 중 어디를 바꿀지 결정\n")
                .append("- 결정한 내용과 날짜 기록\n\n")
                .append("reviewnary는 원인을 판단하지 않습니다. 위 숫자는 기록된 리뷰에서 센 것입니다.");
        return sb.toString();
    }

    private static String span(ReviewIssueView issue) {
        if (issue.firstEvidenceOn() == null || issue.lastEvidenceOn() == null) {
            return "";
        }
        return " (" + issue.firstEvidenceOn() + " ~ " + issue.lastEvidenceOn() + ")";
    }
}
