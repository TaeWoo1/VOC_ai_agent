import { useRef, useSyncExternalStore } from "react";
import {
  getOperationsState,
  subscribeOperationsState,
  type OperationsState,
} from "../lib/actionWindow/operationsStore";

/** React binding for the shared Action Window mock store (home + run detail). */
export function useOperationsStore(): OperationsState {
  return useSyncExternalStore(subscribeOperationsState, getOperationsState);
}

/** The transition note, scoped to the current surface: notes issued before this
 *  component mounted are suppressed, so navigating between the home and the run
 *  detail never shows the other page's stale note. */
export function useOperationsNote(): string {
  const state = useOperationsStore();
  const mountNoteId = useRef(state.noteId);
  return state.noteId === mountNoteId.current ? "" : state.note;
}
