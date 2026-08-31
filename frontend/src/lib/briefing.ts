/**
 * <b>The disconnected morning — the one case where 「확인할 일은 없습니다」 is a lie.</b>
 *
 * <p>Disconnected Channel Onboarding Live Walkthrough v1 §17. A seller who signed up two minutes ago
 * has nothing waiting because nothing has been read yet. There IS something to do, it is the only
 * thing, and these two lines replace the greeting until the org has one connected channel — with no
 * flag and nothing to turn off.
 *
 * <p><b>Everything else this module once said moved to `pages/app/AgentHome.tsx`</b> (Agent
 * Interaction Model v2 §11): the greeting is arithmetic over the proactive cases, and whether
 * anything is WAITING is the opener turn's sentence, computed from the real workload
 * (`workloadPriorities`). Two owners of the same zero sentence disagreed on its words — the audit's
 * duplication item — so the second owner (the un-rendered `AgentBriefing` component and its
 * `briefingHeadline`/`briefingSubline`) was retired rather than kept in sync.
 */
export const DISCONNECTED_HEADLINE = "판매 채널을 연결하면 시작할 수 있습니다.";
export const DISCONNECTED_SUBLINE =
    "채널을 연결하면 주문·문의·리뷰를 대신 확인하고, 먼저 봐야 할 일을 여기에 정리해 두겠습니다.";
