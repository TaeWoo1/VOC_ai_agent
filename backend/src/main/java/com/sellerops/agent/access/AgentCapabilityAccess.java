package com.sellerops.agent.access;

import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>Who may use the Agent's model capabilities — a named policy, not a development shortcut.</b>
 * Pilot Readiness Closure v1 §2.
 *
 * <p>The failure this exists for: adding one pilot seller meant an operator pasting that seller's
 * organisation UUID into {@code SELLEROPS_AGENT_PLAN_ORG_IDS} (and the draft one, and the judge one)
 * and restarting the backend — while every other seller's conversation, run and connection went down
 * with it. The only alternative the repository offered was the {@code *} wildcard, whose own docblock
 * calls it the local single-user posture and says never to use it on a shared backend. So the
 * production onboarding path was either a restart per seller or a switch documented as unsafe here.
 * <b>A development safety device is not an onboarding policy.</b>
 *
 * <p>Three values, and the deployment picks one deliberately:
 *
 * <ul>
 *   <li>{@code ALLOW_LIST} (default) — exactly today's behaviour: only the organisations written into
 *       the capability's own list. Nothing about an existing deployment changes by upgrading.</li>
 *   <li>{@code CONNECTED_SELLERS} — an organisation that owns a CONNECTED, non-file-upload seller
 *       account. This is the pilot's policy, and it is the same sentence
 *       {@code SellerAccountRepository#findOrgIdsWithConnectedApiAccount} already uses for routine
 *       collection: <b>a seller reaches CONNECTED only by finishing an OAuth consent or entering a
 *       credential, so this is not a guess about who wants the product — it is the record of who
 *       asked.</b> It also fences the hazard that {@code *} cannot: an organisation created by a
 *       drive-by signup on a public host has connected nothing and therefore spends nothing.</li>
 *   <li>{@code ALL_ORGS} — every organisation in this backend. The honest name for what {@code *}
 *       meant, so that choosing it is a sentence an operator writes rather than a punctuation mark
 *       inherited from a list of UUIDs.</li>
 * </ul>
 *
 * <p><b>The policy only ever widens, and only the org question.</b> {@link AgentCapabilityGate#isDeployed()}
 * is checked first and no scope overrides it: a capability with no flag or no key stays off for
 * everyone under every policy. An organisation named in the explicit list stays admitted under every
 * policy. Nothing here reads a model, a key, a channel or a seller row's contents — one existence
 * check against this deployment's own database.
 *
 * <p><b>A capability may decline the widening.</b> {@link AgentCapabilityGate#admitsPolicyWidening()}
 * is false for the three knowledge-retrieval capabilities, so under every scope they admit exactly
 * the organisations written into their own lists. That is a narrowing, and it is deliberate: the
 * exposure those three add is the CUSTOMER'S question leaving on paths that call no model, which is
 * not something a seller asked for by finishing an OAuth consent for collection.
 *
 * <p><b>What it is not.</b> Not a per-capability policy — each capability keeps its own flag, key and
 * list, because they are different exposures and a deployment must still be able to run any subset.
 * This answers one question ("is this organisation part of this deployment's audience") once, so the
 * three Agent capabilities cannot drift into three different answers to it.
 */
@Component
public class AgentCapabilityAccess {

    /** Why a capability said no — so the screen can say the one thing the seller can act on. */
    public enum Decision {
        /** Allowed for this organisation. */
        ALLOWED,
        /** No flag, or no key: an operator/deployment action, nothing the seller can do. */
        NOT_DEPLOYED,
        /** The policy is CONNECTED_SELLERS and this organisation has connected no channel yet. */
        NEEDS_CHANNEL_CONNECTION,
        /** The policy is ALLOW_LIST and this organisation is not on it. */
        NOT_ADMITTED
    }

    public enum Scope {
        ALLOW_LIST,
        CONNECTED_SELLERS,
        ALL_ORGS
    }

    private final Scope scope;
    private final SellerAccountRepository accounts;

    public AgentCapabilityAccess(
            @Value("${sellerops.agent.access.scope:ALLOW_LIST}") String scope,
            SellerAccountRepository accounts) {
        this.scope = parse(scope);
        this.accounts = accounts;
    }

    /**
     * Fail closed on a typo. A misspelled {@code CONNECTED_SELLER} silently falling back to
     * ALLOW_LIST would be a pilot host where every seller's Agent is off and nothing says why; a
     * misspelling falling back to ALL_ORGS would be the opposite and worse.
     */
    private static Scope parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return Scope.ALLOW_LIST;
        }
        try {
            return Scope.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "SELLEROPS_AGENT_ACCESS_SCOPE — 알 수 없는 값입니다. "
                            + "ALLOW_LIST · CONNECTED_SELLERS · ALL_ORGS 중 하나여야 합니다.");
        }
    }

    public Scope scope() {
        return scope;
    }

    public boolean allows(AgentCapabilityGate gate, UUID orgId) {
        return decide(gate, orgId) == Decision.ALLOWED;
    }

    public Decision decide(AgentCapabilityGate gate, UUID orgId) {
        if (gate == null || !gate.isDeployed()) {
            return Decision.NOT_DEPLOYED;
        }
        if (orgId == null) {
            return Decision.NOT_ADMITTED;
        }
        if (gate.isConfiguredFor(orgId)) {
            return Decision.ALLOWED;
        }
        // A capability may decline the widening. Pilot Release Closure v1 §2: the three
        // knowledge-retrieval capabilities send the customer's question to a vendor, and a seller
        // does not ask for that by connecting a channel — they are admitted by being named, under
        // every policy. Declining can only narrow; nothing here can admit an org the scope would not.
        if (!gate.admitsPolicyWidening()) {
            return Decision.NOT_ADMITTED;
        }
        return switch (scope) {
            case ALL_ORGS -> Decision.ALLOWED;
            case CONNECTED_SELLERS -> accounts.hasConnectedApiAccount(orgId)
                    ? Decision.ALLOWED
                    : Decision.NEEDS_CHANNEL_CONNECTION;
            case ALLOW_LIST -> Decision.NOT_ADMITTED;
        };
    }

    /**
     * The sentence for the seller, or {@code null} when there is nothing they can do about it.
     *
     * <p>Null is deliberate for the two operator-side refusals: the caller already has a sentence for
     * "the capability is off", and inventing a second one here would put two versions of the same
     * promise in the repository. Only the connection case is the seller's own next step.
     */
    public String sellerMessage(Decision decision) {
        return decision == Decision.NEEDS_CHANNEL_CONNECTION
                ? "판매 채널을 연결하시면 AI 운영 담당자가 함께 일을 시작합니다. "
                        + "연결 전에도 홈·문의·리뷰 화면은 평소대로 사용하실 수 있습니다."
                : null;
    }
}
