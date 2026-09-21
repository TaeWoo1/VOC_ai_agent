package com.sellerops.agent.quota;

/**
 * Which model seam spent the call — the ones charged against the seller's daily budget.
 *
 * <p>{@code CONVERSE} joined them with Grounded Conversation Lane v1: a conversational turn reaches a
 * model once, on the seller's behalf, exactly as a plan does. The column is {@code varchar(16)} and
 * nothing switches exhaustively over this enum, so the value is the whole change.
 */
public enum AgentUsageKind { PLAN, JUDGE, DRAFT, CONVERSE, INVESTIGATE, INTERPRET }
