/**
 * LIVE planner recordings (Acceptance Closure §9, 2026-08-28) — captured from `POST /api/agent/plan` against the
 * Demo Org with the shipped v3 prompt, verbatim except `rationale`. Two natural review sentences, neither of
 * which names a period the runtime could route on: the planner decided ROWS for one and ISSUES for the other,
 * and the runtime routes on that token. These are recordings, not authored plans.
 */
import type { AgentPlanView } from "../../src/spring/types";

export const LIVE_ROWS_NATURAL_PLAN: AgentPlanView = {
  "available": true,
  "supported": true,
  "userGoal": "요즘 들어온 리뷰를 보고 싶다.",
  "unresolvedEntities": [],
  "informationNeeds": [
    {
      "id": "n1",
      "question": "최근 7일 이내에 들어온 리뷰 행 목록을 가져온다.",
      "kind": "REVIEW_SIGNAL",
      "why": "판매자에게 최근(요즘) 들어온 리뷰를 보여주기 위해서다.",
      "required": true
    }
  ],
  "specialists": [
    "REVIEW_OPS"
  ],
  "tools": [],
  "retrievalOrder": [
    "n1"
  ],
  "retrievalParallel": [],
  "retrievalStopWhen": "최근 리뷰 행 목록을 확보하면 종료",
  "evidenceRequirements": [
    {
      "needId": "n1",
      "minEvidence": 1,
      "acceptableKinds": [
        "REVIEW_SIGNAL"
      ]
    }
  ],
  "riskClass": "ROUTINE",
  "maxIterations": 2,
  "maxToolCalls": 8,
  "stopWhenEnough": "최근 7일 리뷰 행이 수집되어 목록을 제시할 수 있으면 충분하다.",
  "clarificationNeeded": false,
  "clarificationReason": null,
  "requestedAction": "NONE",
  "tone": null,
  "filters": {
    "period": "LAST_7_DAYS",
    "rating": "ALL",
    "channel": null,
    "scope": null,
    "topic": null,
    "reviewIntent": "ROWS"
  },
  "target": {
    "selector": "NONE",
    "index": null
  },
  "providerVersion": "agent-plan/v1+openai:gpt-5-2025-08-07+agent-plan-prompt/v3+schema/v1+out6000+effort:low",
  "quotaMessage": null
} as unknown as AgentPlanView;

export const LIVE_ISSUES_NATURAL_PLAN: AgentPlanView = {
  "available": true,
  "supported": true,
  "userGoal": "리뷰에서 반복되는 문제(이슈)가 있는지 확인하고 정리하고 싶다",
  "unresolvedEntities": [],
  "informationNeeds": [
    {
      "id": "n1",
      "question": "최근 기간의 리뷰에서 반복적으로 언급되는 문제와 그 빈도를 파악한다",
      "kind": "REVIEW_SIGNAL",
      "why": "반복되는 리뷰 이슈 유무와 유형을 답하기 위해 필요하다",
      "required": true
    }
  ],
  "specialists": [
    "REVIEW_OPS"
  ],
  "tools": [],
  "retrievalOrder": [
    "n1"
  ],
  "retrievalParallel": [],
  "retrievalStopWhen": "반복 이슈가 식별되어 유형별 요약과 예시가 확보되면 중단",
  "evidenceRequirements": [
    {
      "needId": "n1",
      "minEvidence": 1,
      "acceptableKinds": [
        "REVIEW_SIGNAL"
      ]
    }
  ],
  "riskClass": "ROUTINE",
  "maxIterations": 2,
  "maxToolCalls": 8,
  "stopWhenEnough": "반복 이슈 유무와 주요 유형(예: 배송, 품질 등)과 대략적 빈도가 정리되면 충분",
  "clarificationNeeded": false,
  "clarificationReason": null,
  "requestedAction": "NONE",
  "tone": null,
  "filters": {
    "period": "LAST_30_DAYS",
    "rating": "ALL",
    "channel": null,
    "scope": null,
    "topic": null,
    "reviewIntent": "ISSUES"
  },
  "target": {
    "selector": "NONE",
    "index": null
  },
  "providerVersion": "agent-plan/v1+openai:gpt-5-2025-08-07+agent-plan-prompt/v3+schema/v1+out6000+effort:low",
  "quotaMessage": null
} as unknown as AgentPlanView;

export const LIVE_RECORDED_PLANS: Record<string, AgentPlanView> = {
  "요즘 들어온 리뷰 보여줘": LIVE_ROWS_NATURAL_PLAN,
  "리뷰에서 반복되는 문제 있어?": LIVE_ISSUES_NATURAL_PLAN,
};
