package com.sellerops.agent.quota;

/** Which model seam spent the call. Three, because there are exactly three LLM capabilities. */
public enum AgentUsageKind { PLAN, JUDGE, DRAFT }
