package com.sellerops.inquiry.resolution;

import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import java.util.List;

/**
 * <b>A resolution plan</b> (Inquiry v3 WP-2): the customer's atomic needs, and for each the authorities that must act on
 * it, in order. What a plan may say is closed — capability ids from the registry, fields, scopes, roles, effects, customer
 * inputs — so a model can only choose among the words this record has (strict schema, {@link ResolutionPlannerPrompt}).
 *
 * <p>What a plan never carries: a customer input as an authority (it is a value a step needs), a past answer (memory, not
 * grounding — there is no capability for it), and availability. A plan says what the need REQUIRES; whether this system
 * can do it here is the validator's to record ({@link ResolutionPlanValidator}) and never the plan's to adjust.
 */
public record ResolutionPlan(List<Need> needs) {

    public ResolutionPlan {
        needs = needs == null ? List.of() : List.copyOf(needs);
    }

    /**
     * @param ask            the need in the seller's words (≤120 chars, no personal data)
     * @param customerInputs product-context values the answer depends on and the customer has not given
     */
    public record Need(String id, String ask, List<Step> steps, List<CustomerInput> customerInputs) {
        public Need {
            steps = steps == null ? List.of() : List.copyOf(steps);
            customerInputs = customerInputs == null ? List.of() : List.copyOf(customerInputs);
        }
    }

    /**
     * @param dependsOn the index (in this need) of an earlier step this one needs first, or null
     */
    public record Step(CapabilityId capability, Role role, Scope scope, List<EntityField> fields, Effect effect,
                       Integer dependsOn) {
        public Step {
            fields = fields == null ? List.of() : List.copyOf(fields);
        }
    }

    /** CLOSES may answer the need; PRECONDITION must be read before a closer; CONTEXT is read and never closes. */
    public enum Role { CLOSES, PRECONDITION, CONTEXT }

    /** Which instance a step is about. Each capability admits only some ({@link ResolutionPlanValidator#SCOPES}). */
    public enum Scope { THIS_LISTING, SELLER_CATALOGUE, THIS_ORDER, COMPANY, NONE }

    /**
     * Why a PROCEDURE is a procedure. Product-owner decision 2026-09-20: a PROCEDURE is required only for a change of
     * state outside this system or a bounded business workflow; when reading entity state resolves the request, the plan
     * ends at ENTITY_STATE. Every non-procedure step says NONE.
     */
    public enum Effect { NONE, EXTERNAL_STATE_CHANGE, BOUNDED_WORKFLOW }
}
