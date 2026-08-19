/**
 * **The LLM behind the model seam** — a {@link DraftModelProvider} that asks the backend, and falls
 * back to the deterministic rule drafter whenever it cannot.
 *
 * ## Why the model lives behind an HTTP hop instead of in this process
 *
 * This service holds no credential — its own `.env.example` opens by saying so, and nothing here has
 * ever read a vendor key. Putting one here would have created a SECOND LLM egress point and a second
 * place to rotate a key, and it would have moved the privacy gate (which org may send inquiry content
 * to a vendor) out of the system of record and into a stateless orchestrator that derives org
 * membership from a token it merely forwards. So the model call is one more backend capability,
 * reached with the operator's own bearer exactly like every other tool call in these graphs.
 *
 * ## Fail-closed, and the fallback is the shipped behaviour
 *
 * Every failure — capability off for this org, no backend endpoint, transport error, vendor refusal,
 * off-schema answer — resolves to a RULE-BASED candidate. Not an error, not an empty draft, and never
 * a half-generated one: the human at the checkpoint sees a usable starter draft either way, and the
 * candidate's own `provenance` says which drafter wrote the one they are looking at. A UI that
 * labelled every draft "AI" would be the overstatement this repository has been careful not to make.
 *
 * ## What it never does
 *
 * It sends the inquiry's own title and body and reads back a category, a title and a body. It logs
 * neither — the only line it writes is the provider kind, the category, and whether the model
 * answered. No id, no token, no seller content, no vendor text.
 */
import { RuleBasedDraftProvider } from "./DraftModelSeam";
import type { DraftCandidate, DraftInput, DraftModelProvider, DraftProvenance } from "./DraftModelSeam";
import { log } from "../log";

/** The one backend call this provider needs. Structural, so any client that has it fits. */
export interface DraftBackend {
  generateInquiryDraft?(request: { title: string; details: string | null }): Promise<{
    available: boolean;
    category: string | null;
    title: string | null;
    comments: string | null;
    providerVersion: string | null;
  }>;
}

export class SpringDraftProvider implements DraftModelProvider {
  /**
   * What this provider WOULD stamp when the model answers. The candidate it returns carries the
   * provenance that is actually true for that candidate, which on a fallback is the rule drafter's.
   */
  readonly provenance: DraftProvenance = {
    providerKind: "LLM",
    name: "agent-draft",
    // Replaced per call by the backend's own version string (vendor + model + prompt version + knobs)
    // whenever it answers. This is only what a caller sees before any call has been made.
    version: "agent-draft/v1",
  };

  private readonly backend: DraftBackend;
  private readonly fallback: RuleBasedDraftProvider;

  constructor(backend: DraftBackend, fallback: RuleBasedDraftProvider = new RuleBasedDraftProvider()) {
    this.backend = backend;
    this.fallback = fallback;
  }

  async draft(input: DraftInput): Promise<DraftCandidate> {
    const rule = this.fallback.draftNow(input);
    if (!this.backend.generateInquiryDraft) {
      // A backend that predates the endpoint, or a test fake. Indistinguishable from "off" to the
      // graph, and it should be: both mean "no model draft", and both leave the shipped behaviour.
      return rule;
    }
    let view;
    try {
      view = await this.backend.generateInquiryDraft({ title: input.title, details: input.details });
    } catch (e) {
      // The caught error is not inspected or logged: a backend error can quote the request, and the
      // request carries the seller's inquiry. One marker, no detail.
      log("agent_draft_seam", { providerKind: "RULE_BASED", modelAnswered: false, reason: "TRANSPORT" });
      return rule;
    }
    if (!view.available || !view.category || !view.title || !view.comments) {
      // `available: false` already covers off / refused / off-schema on the backend side. The field
      // checks are belt-and-braces against a partial body: a candidate with an empty comments field
      // reaches a human as a draft that looks reviewed and is not.
      log("agent_draft_seam", {
        providerKind: "RULE_BASED",
        modelAnswered: false,
        // Present ⇒ the capability is ON for this org and the model declined; absent ⇒ it is off.
        reason: view.providerVersion ? "MODEL_DECLINED" : "CAPABILITY_OFF",
      });
      return rule;
    }
    log("agent_draft_seam", { providerKind: "LLM", modelAnswered: true, category: view.category });
    return {
      title: view.title,
      comments: view.comments,
      category: view.category,
      provenance: {
        providerKind: "LLM",
        name: "agent-draft",
        // The BACKEND's version string — vendor, model, prompt version and knobs — so a recorded run
        // can be read back without consulting configuration.
        version: view.providerVersion ?? this.provenance.version,
      },
    };
  }
}
