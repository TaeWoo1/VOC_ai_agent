import { useSyncExternalStore } from "react";
import {
  getOperationsState,
  subscribeOperationsState,
  type OperationsState,
} from "../lib/actionWindow/operationsStore";

/** React binding for the shared Action Window mock store (home + run detail). */
export function useOperationsStore(): OperationsState {
  return useSyncExternalStore(subscribeOperationsState, getOperationsState);
}
