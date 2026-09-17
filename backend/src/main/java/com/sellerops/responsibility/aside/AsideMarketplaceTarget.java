package com.sellerops.responsibility.aside;

import java.util.Optional;
import java.util.UUID;

/**
 * <b>Which of this organisation's stores a marketplace recipe reads, and the two facts the helper needs to read
 * it safely.</b>
 *
 * <p>An interface, implemented outside this package, for the same reason {@code ResponsibilityRunFollowUp} is
 * one: the scheduled-job package must not learn how to open a credential or how a store identity is derived.
 * It asks a question and is handed an answer whose parts it cannot construct.
 *
 * <p><b>Why these two fields and no others.</b> The job wire's standing rule is that it carries no URL, prompt,
 * script or credential, and neither of these is any of those:
 *
 * <ul>
 *   <li>{@code accountSlot} is the opaque per-account identifier the existing review handoff is already keyed by,
 *   and which this same helper already receives on the seller-pressed lane. Without it a run could read a page
 *   and then have no route to hand its reading back.</li>
 *   <li>{@code expectedStoreFingerprint} is a <b>digest</b> of the account's own vendor code — not the code, and
 *   never the credential it may have been derived from. It exists so the helper can refuse to read a store that
 *   is not the one this binding belongs to. Absent ({@code null}) is not a pass: the identity assertion answers
 *   {@code UNRESOLVED} and the rows are dropped unread.</li>
 * </ul>
 *
 * <p>Neither field can name a target. The route is the recipe's own bound workflow on the helper side, screened
 * locally before anything opens; nothing here can redirect it.
 */
public interface AsideMarketplaceTarget {

    /**
     * The store a recipe reads for this organisation.
     *
     * @param sellerAccountId which account's store — the one the deployment named, never «the org's first»
     */
    record Target(UUID sellerAccountId, String accountSlot, String expectedStoreFingerprint) {
    }

    /**
     * Resolve the target, or empty when there is none to read.
     *
     * <p>Empty is the honest answer in every case that is not «exactly one named, connected account of this
     * recipe's channel»: no account, an account the deployment did not name, more than one candidate. A run that
     * cannot say which store it would read does not read one.
     */
    Optional<Target> resolve(UUID orgId, AsideRecipe recipe);

    /**
     * Every published resolver asked in turn; the first that names a store answers.
     *
     * <p>Each resolver answers only for its own channel's recipe and is empty for every other, so the order does
     * not choose between competing answers — there are none. It exists because there is now more than one
     * resolver, and a single injected one would either be ambiguous to the container or quietly answer for one
     * channel only.
     */
    static AsideMarketplaceTarget firstOf(java.util.List<AsideMarketplaceTarget> resolvers) {
        java.util.List<AsideMarketplaceTarget> fixed = java.util.List.copyOf(resolvers);
        return (orgId, recipe) -> {
            for (AsideMarketplaceTarget resolver : fixed) {
                Optional<Target> answer = resolver.resolve(orgId, recipe);
                if (answer.isPresent()) {
                    return answer;
                }
            }
            return Optional.empty();
        };
    }
}
