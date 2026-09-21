package com.sellerops.operationscase;

import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.GapReason;
import com.sellerops.inquiry.authority.Resolution;
import com.sellerops.inquiry.authority.ResolutionState;
import com.sellerops.inquiry.resolve.InquiryResolutionView;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * <b>What a resolved goal set means for the case</b> — a pure reading, in the vocabulary the case already has.
 *
 * <p>No new enum, no new column, no new product object. The terminal states the resolution loop can reach map onto
 * {@link CaseDisposition}, {@link RequiredAuthority} and {@link RecommendedActionType}, because those already say
 * the three things a seller needs: whether this waits on them, who must act, and what the act is.
 *
 * <h2>Nothing here auto-resolves a customer's question</h2>
 *
 * <p>{@link CaseDisposition#AUTO_RESOLVED} is unreachable from this mapping, deliberately. A goal that reaches
 * {@code RESOLVED} means <b>the company's own knowledge answers it</b> — not that the customer has been answered.
 * The reply still has to be written, approved and sent, and each of those is a human step. The strongest thing
 * this can say is "there is a basis to answer", which is {@code NEEDS_DECISION} with a reply recommended.
 *
 * <h2>A set has many goals, and the case has one state</h2>
 *
 * <p>The set reports its <b>worst</b> terminal, ordered by how far each is from an answer. A message asking two
 * things is not half-answered: if one of them needs the seller, the seller is needed. Goals withheld behind a
 * customer-stated condition ("안 되면 환불해 주세요") contribute nothing, because no resolver was asked about them —
 * they are counted and named, never scored.
 */
public record CaseFromResolution(String state, String gap, int goals, int withheld,
                                 CaseDisposition disposition, RequiredAuthority authority,
                                 RecommendedActionType recommendedAction, String summaryKo,
                                 List<String> missingInformation) {

    public CaseFromResolution {
        missingInformation = missingInformation == null ? List.of() : List.copyOf(missingInformation);
    }

    /** The case reading of one resolved set, or null when nothing resolved it. */
    public static CaseFromResolution of(InquiryResolutionView view) {
        if (view == null) {
            return null;
        }
        if (view.resolved().isEmpty()) {
            // Either the message asked for nothing, or everything it asked for waits on a condition the customer
            // stated. Both are observations, and neither is customer-response work.
            return new CaseFromResolution(null, null, view.goals(), view.withheld(),
                    CaseDisposition.MONITORING, RequiredAuthority.AUTO, RecommendedActionType.NO_ACTION,
                    view.withheld() > 0
                            ? "고객이 조건을 달아 요청해, 먼저 확인할 내용이 정해질 때까지 답변 작업을 만들지 않았습니다."
                            : "고객이 답변을 요청한 내용이 없어 답변 작업을 만들지 않았습니다.",
                    List.of());
        }

        InquiryResolutionView.Goal worst = view.resolved().get(0);
        for (InquiryResolutionView.Goal goal : view.resolved()) {
            if (rank(goal.state()) > rank(worst.state())) {
                worst = goal;
            }
        }
        ResolutionState state = stateOf(worst.state());
        GapReason gap = gapOf(worst.gap());
        return new CaseFromResolution(worst.state(), worst.gap(), view.goals(), view.withheld(),
                CaseDisposition.NEEDS_DECISION, RequiredAuthority.HUMAN, actionFor(state),
                summaryFor(state, gap, view.resolved().size(), view.withheld()), missingFor(worst));
    }

    private static int rank(String state) {
        return InquiryResolutionView.BLOCKING.indexOf(state);
    }

    /**
     * What the seller is being asked to do.
     *
     * <p>{@code CAPABILITY_GAP} and {@code FAILED} get <b>no</b> action type, and that is not an oversight. The
     * closed vocabulary has no value meaning "do this yourself on the channel", which is what a customer's
     * unexecutable request actually needs; naming the nearest one would tell the seller to do something nobody
     * decided. The sentence says what happened instead.
     */
    private static RecommendedActionType actionFor(ResolutionState state) {
        if (state == null) {
            return null;
        }
        return switch (state) {
            case RESOLVED, RESOLVED_CONDITIONAL -> RecommendedActionType.REPLY_TO_CUSTOMER;
            case NEEDS_CUSTOMER_INPUT -> RecommendedActionType.CONTACT_CUSTOMER;
            case NEEDS_SELLER -> RecommendedActionType.ADD_KNOWLEDGE;
            case CAPABILITY_GAP, FAILED -> null;
        };
    }

    private static String summaryFor(ResolutionState state, GapReason gap, int resolved, int withheld) {
        String head = state == null ? "조사를 끝내지 못했습니다." : switch (state) {
            case RESOLVED -> "등록된 지식으로 답변할 수 있는 문의입니다.";
            case RESOLVED_CONDITIONAL -> "등록된 지식으로 답변할 수 있으나, 고객 상황에 따라 달라지는 조건이 있습니다.";
            case NEEDS_CUSTOMER_INPUT -> "답변하려면 고객에게 먼저 확인할 내용이 있습니다.";
            case NEEDS_SELLER -> "등록된 지식에 이 질문을 결정하는 내용이 없어, 판매자님의 판단이 필요합니다.";
            case CAPABILITY_GAP -> gapSentence(gap);
            case FAILED -> "조사를 끝내지 못했습니다.";
        };
        StringBuilder out = new StringBuilder(head);
        if (resolved > 1) {
            out.append(" (확인한 요청 ").append(resolved).append("건 중 가장 먼저 해결해야 하는 항목 기준입니다.)");
        }
        if (withheld > 0) {
            out.append(" 고객이 조건을 단 요청 ").append(withheld).append("건은 아직 판단하지 않았습니다.");
        }
        return out.toString();
    }

    private static String gapSentence(GapReason gap) {
        if (gap == null) {
            return "자동으로 처리할 수 없는 문의입니다.";
        }
        return switch (gap) {
            case NOT_EXECUTABLE ->
                    "고객이 요청한 처리는 자동으로 실행하지 않습니다. 판매자님이 직접 확인하고 처리해 주세요.";
            case UNBOUND -> "이 문의가 어떤 주문·상품에 대한 것인지 연결돼 있지 않아 확인하지 못했습니다.";
            case NOT_SUPPORTED -> "이 채널에서는 확인할 수 없는 정보라 답변 근거로 쓰지 못했습니다.";
            case STALE -> "마지막으로 확인한 시점 이후 바뀌었을 수 있어, 현재 상태로 단정하지 못했습니다.";
            case UNPROVEN -> "상태를 확인했지만 그 의미를 확정하지 못했습니다.";
            case UNAVAILABLE -> "지금 확인할 수 없어 답변 근거로 쓰지 못했습니다.";
            case UNREADABLE_SOURCE -> "등록된 자료를 읽지 못해 확인하지 못했습니다.";
            case ACQUIRABLE -> "아직 가져오지 않은 정보가 있어 확인하지 못했습니다.";
            case DISABLED -> "이 배포에서 꺼져 있는 기능이라 확인하지 못했습니다.";
        };
    }

    /**
     * What is missing, in the customer's terms.
     *
     * <p>Identity is never here: {@link Resolution} refuses to carry it, so a case can never tell a seller to ask
     * a customer for their phone number.
     */
    private static List<String> missingFor(InquiryResolutionView.Goal worst) {
        Set<String> asks = new LinkedHashSet<>();
        for (String token : worst.ask()) {
            String ko = ASK_KO.get(inputOf(token));
            if (ko != null) {
                asks.add(ko);
            }
        }
        return List.copyOf(asks);
    }

    private static ResolutionState stateOf(String token) {
        try {
            return token == null ? null : ResolutionState.valueOf(token);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    private static GapReason gapOf(String token) {
        try {
            return token == null ? null : GapReason.valueOf(token);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    private static CustomerInput inputOf(String token) {
        try {
            return token == null ? null : CustomerInput.valueOf(token);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    /**
     * The seller-facing name of each thing a customer can be asked for.
     *
     * <p>A closed table, and a token with no entry is <b>omitted</b> rather than printed — the screen never shows
     * an enum. {@code IDENTITY} inputs have no entry because they are unreachable here by construction.
     */
    private static final Map<CustomerInput, String> ASK_KO = askKo();

    private static Map<CustomerInput, String> askKo() {
        Map<CustomerInput, String> m = new EnumMap<>(CustomerInput.class);
        m.put(CustomerInput.OPTION, "주문하신 옵션");
        m.put(CustomerInput.SIZE, "규격");
        m.put(CustomerInput.MODEL, "모델");
        m.put(CustomerInput.QUANTITY, "수량");
        m.put(CustomerInput.USE_CONTEXT, "사용하시려는 환경");
        m.put(CustomerInput.MEASUREMENT, "측정하신 치수");
        m.put(CustomerInput.UNNAMED_PRODUCT_CONTEXT, "상품 사용 상황");
        return java.util.Collections.unmodifiableMap(m);
    }

    /** Whether this reading creates customer-response work, as opposed to keeping an observation. */
    public boolean createsCustomerWork() {
        return disposition == CaseDisposition.NEEDS_DECISION;
    }
}
