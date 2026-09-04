/**
 * The list rule, shared with the workspace lists — see `lib/sharedWord.ts` for why it exists and what
 * it measured. Kept as a re-export rather than a second copy: two lists that disagree about when a word
 * is shared are the defect this rule closes.
 */
export { onlySharedWord } from "../sharedWord";
