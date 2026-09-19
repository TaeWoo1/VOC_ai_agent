// Inquiry Need Eval v1 — the closed vocabularies. One place, so the validator, the truth derivation and the scorer
// cannot disagree about what a word means. Canonical definitions: docs/inquiry_need_eval_v1.md.

/** What a need is ABOUT. A need is one independent piece of information or action without which the customer's
 *  request is not resolved; prerequisites and background facts are evidence, never a need of their own. */
export const NEED_TYPES = [
  'PRODUCT_SPEC', 'PRODUCT_USAGE', 'PRODUCT_COMPATIBILITY', 'CATALOGUE_AVAILABILITY',
  'POLICY', 'ORDER_STATE', 'ORDER_ACTION', 'SELLER_DECISION',
];

/** Where the answer lives. PRODUCT_FAMILY is never a scope: sibling listings are annotation only (family_sets). */
export const SCOPES = ['PRODUCT', 'ORG', 'ORDER', 'NONE'];

/** Evidence ref kinds. `KIND:rest`; ids are the first 8 hex chars, unique within one org (census proves it). */
export const REF_KINDS = {
  PK: 'seller product knowledge source (PK:<source>)',
  OK: 'seller org knowledge source (OK:<source>)',
  CAT: 'a catalogue product exists / is named (CAT:<product>)',
  OPT: 'a product option, SQL LIKE on its name (OPT:<product>#<pattern>)',
  ADDON: 'a 추가상품 fact, SQL LIKE on its value (ADDON:<product>#<pattern>)',
  FACT: 'a product fact by key prefix (FACT:<product>#<fact_key prefix>)',
  ORDER: 'the stored order fact of this inquiry (ORDER:<inquiry>)',
  IMG: 'image-only detail page — no reading pipeline (IMG:<product>)',
  C24: 'Cafe24 product detail — not collected (C24:<product>|other-listing)',
};

/** How much of the need one evidence_set closes. UNKNOWN = the set exists but nothing here can read it. */
export const SUFFICIENCY = ['FULL', 'CONDITIONAL', 'PARTIAL', 'UNKNOWN'];

/** L1: may a past answer prefill a DIFFERENT conversation? Only REUSABLE may. */
export const PRECEDENT_SCOPES = ['REUSABLE', 'ORDER_ONLY', 'CASE_ONLY'];

/** L2: a ref's state in one snapshot, for one question's product. */
export const SOURCE_STATES = ['PRESENT', 'PRESENT_OTHER_SCOPE', 'ABSENT_ACQUIRABLE', 'UNREADABLE', 'NO_SOURCE'];

/** Truth (L1+L2). UNKNOWN is never folded into NONE: the source exists, the system cannot read it. */
export const ANSWERABILITY = ['FULL', 'CONDITIONAL', 'PARTIAL', 'UNKNOWN', 'NONE'];

/** What should happen next in this snapshot, and how the need ends once everything acquirable is acquired.
 *  SYSTEM_ACQUIRE is a step, not an outcome — it is never counted as a Seller Touch avoided. */
export const NEXT_STEPS = ['ANSWER', 'ASK_CUSTOMER', 'SYSTEM_ACQUIRE', 'ASK_SELLER'];
export const TERMINALS = ['ANSWER', 'ASK_CUSTOMER', 'ASK_SELLER'];

/** Why a need is not covered — the failure taxonomy. The first four are knowledge, then retrieval, then decision. */
export const UNCOVERED = [
  'SOURCE_ABSENT', 'SOURCE_UNREADABLE', 'NOT_ACQUIRED', 'OUT_OF_SCOPE',
  'RETRIEVAL_MISS', 'PARTIAL_EVIDENCE',
];

/** L3 case outcome. A no-ask is SAFE only when every need is covered at the sufficiency its outcome needs. */
export const CASE_OUTCOMES = [
  'SAFE_ANSWER', 'SAFE_CLARIFY', 'PARTIAL_LEAK', 'WRONG', 'OVER_CLARIFY', 'UNDER_CLARIFY',
  'UNNECESSARY_ESCALATION', 'ESCALATION_BEFORE_ACQUIRE', 'CORRECT_ESCALATION',
];

/** The assessor's basis → what the product did. */
export const SYSTEM_ACTION = {
  GROUNDED: 'ANSWER',
  NEEDS_CLARIFICATION: 'ASK_CUSTOMER',
  NO_ANSWER_BASIS: 'ASK_SELLER',
};

export const RANK = { FULL: 3, CONDITIONAL: 2, PARTIAL: 1 };
export const bestOf = (xs) => xs.filter((x) => x in RANK).sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
