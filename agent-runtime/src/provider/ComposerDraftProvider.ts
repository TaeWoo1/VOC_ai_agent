/**
 * **The one drafter behind the legacy graphs** — a {@link DraftModelProvider} that delegates to the
 * product's own draft path, `InquiryDraftComposer`, through the same runtime seam the conversation
 * lane uses ({@link DraftPreparer}: propose when OPEN → `POST /api/inquiries/{id}/draft/generate`).
 *
 * ## Why delegation and not a second engine (Knowledge Context v1-A closure, 2026-08-30)
 *
 * Until this file the `/api/agent-runs` lanes drafted through `SpringDraftProvider`, which sent the
 * inquiry's title and body to `/api/agent/inquiry-draft` — a model call with no retrieval, no
 * applicability, no answer-style and no answer-basis. A reply it wrote was fluent and grounded in
 * nothing; a v1-A gate stopped it when the retriever found no passage, but when a passage existed the
 * legacy prompt still did not carry it. Two drafters is two answers to "what may the seller be told";
 * the composer is the one with the retrieval, the fences and the live proofs, so it is the only one.
 *
 * ## What this changes about the legacy graphs, said plainly
 *
 * The composer PREPARES: an OPEN work item is moved to PROPOSED by the product's own proposal step
 * and a MODEL draft version is appended — exactly what the inquiry screen's 「초안 생성」 does. The
 * graphs' old claim "nothing is written before the checkpoint" is therefore narrowed to what it always
 * meant to protect: nothing moves toward a channel. Approval, the publish intent and any send stay
 * behind the human checkpoint and the backend's own fail-closed gates, unchanged.
 *
 * ## What it never does
 *
 * It never invents text. A composer answer with no draft (NO_ANSWER_BASIS, capability off, vendor
 * failure) becomes a candidate with an EMPTY body and the basis/reason the backend stated; the
 * category comes from the deterministic rule categoriser, which names what the inquiry is about and
 * nothing else. `performRecord` refuses to record an approval without text.
 */
import { DraftPreparer } from "../conversation/DraftPreparer";
import { RuleBasedDraftProvider } from "./DraftModelSeam";
import type { DraftCandidate, DraftInput, DraftModelProvider, DraftProvenance } from "./DraftModelSeam";
import type { SpringClient } from "../spring/SpringClient";
import { log } from "../log";

/** The backend calls the composer path needs — the same three `DraftPreparer` reaches. */
export type ComposerBackend = Pick<SpringClient, "generateDraftFor" | "getInquiryDetail" | "proposeInquiry">;

export const COMPOSER_PROVIDER_NAME = "inquiry-draft-composer";

/** The backend's `authorKind` for a saved version → the provenance kind the legacy surfaces label. */
function providerKindOf(authorKind: string | null): string {
  if (authorKind === "MODEL") return "LLM";
  if (authorKind === "SELLER_APPROVED_FALLBACK") return "SELLER_APPROVED_FALLBACK";
  return authorKind ?? "LLM";
}

export class ComposerDraftProvider implements DraftModelProvider {
  readonly provenance: DraftProvenance = {
    providerKind: "LLM",
    name: COMPOSER_PROVIDER_NAME,
    version: "composer",
  };

  private readonly preparer: DraftPreparer;
  private readonly categoriser: RuleBasedDraftProvider;

  constructor(backend: ComposerBackend, categoriser: RuleBasedDraftProvider = new RuleBasedDraftProvider()) {
    this.preparer = new DraftPreparer(backend);
    this.categoriser = categoriser;
  }

  async draft(input: DraftInput): Promise<DraftCandidate> {
    // The category is deterministic and content-free to log; the text never comes from here.
    const rule = this.categoriser.draftNow(input);
    if (!input.workItemId) {
      // No work item, no composer: a caller that only has a title and a body gets the gap, never a
      // sentence written from the title and the body.
      return rule;
    }
    const { artifact, view } = await this.preparer.prepareWithView(
      {
        workItemId: input.workItemId,
        inquiryId: input.inquiryId ?? input.workItemId,
        channelCode: input.channelCode ?? null,
        channelNameKo: input.channelNameKo ?? null,
        productId: input.productId ?? null,
        productName: input.productName ?? null,
      },
      null,
      `a-draft-${input.workItemId}`,
    );
    const comments = artifact.comments?.trim() ?? "";
    const prepared = comments.length > 0 && artifact.version != null;
    log("agent_draft_seam", {
      providerKind: prepared ? providerKindOf(artifact.authorKind) : "RULE_BASED",
      modelAnswered: prepared,
      answerBasis: artifact.answerBasis ?? null,
      reason: prepared ? null : artifact.unavailableMessage ? "UNAVAILABLE" : "NO_ANSWER_BASIS",
      category: rule.category,
    });
    if (!prepared) {
      return {
        ...rule,
        answerBasis: artifact.answerBasis ?? "NO_ANSWER_BASIS",
        answerBasisNote: artifact.answerBasisNote ?? null,
        unavailableMessage: artifact.unavailableMessage ?? null,
        evidenceSummary: artifact.evidenceSummary ?? [],
      };
    }
    return {
      // The saved version's own title, so an unedited approval matches the head and reuses it.
      title: view.draft?.title ?? rule.title,
      comments,
      category: rule.category,
      provenance: {
        providerKind: providerKindOf(artifact.authorKind),
        name: COMPOSER_PROVIDER_NAME,
        // The saved version is the identity a run can be read back by; the model/style stamp lives on
        // the version row itself (`model_version`), not here.
        version: `composer/v${artifact.version}`,
      },
      answerBasis: artifact.answerBasis ?? null,
      answerBasisNote: artifact.answerBasisNote ?? null,
      unavailableMessage: null,
      draftVersion: artifact.version,
      contentFingerprint: artifact.contentFingerprint,
      evidenceSummary: artifact.evidenceSummary ?? [],
    };
  }
}
