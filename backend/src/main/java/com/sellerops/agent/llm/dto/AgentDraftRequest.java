package com.sellerops.agent.llm.dto;

/**
 * What the Agent Runtime's model seam asks for: one inquiry's own title and body.
 *
 * <p>Deliberately NOT a work-item id. The runtime already holds the detail (it fetched it through its
 * own authorized tool call), and taking an id here would make this endpoint a second reader of
 * inquiry content with its own authorization story to get right. It takes the two fields it sends and
 * nothing else, so what may leave is visible in the request type.
 */
public record AgentDraftRequest(String title, String details) {
}
