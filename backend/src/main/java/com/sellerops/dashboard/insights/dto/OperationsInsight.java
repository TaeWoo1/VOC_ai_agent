package com.sellerops.dashboard.insights.dto;

/**
 * One thing worth looking at, with somewhere to go.
 *
 * <p><b>Derived, not written.</b> These are computed from rows this backend already holds — no model
 * is called and no quota is spent, which is also why the dashboard keeps working when the Agent's
 * daily budget is gone ({@code docs/demo_core_experience_v1.md} §7). Naming them "AI Insights" on
 * screen is fine; claiming a model produced them would not be.
 *
 * <p><b>An insight with no evidence does not exist.</b> Every producer returns nothing when its
 * condition is not met, rather than a card saying "특이사항 없음" — a screen full of reassurance
 * nobody measured is worse than a shorter list.
 *
 * <p>{@code to} is an in-app route; {@code agentGoal}, when present, is a question the seller can
 * hand to the Agent as-is. The goal is a suggestion for a human to send, never something dispatched
 * on its own.
 */
public record OperationsInsight(String key, Severity severity, String title, String detail,
                                String to, String actionLabel, String agentGoal) {

    /** Ordering only — the screen decides colour. */
    public enum Severity { ATTENTION, WATCH, INFO }
}
