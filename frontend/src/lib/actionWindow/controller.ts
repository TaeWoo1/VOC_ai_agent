// **Action Window Operations controller (R2).**
//
// One hook the Operations screen consumes for BOTH data sources, selected through the dev/runtime
// boundary (`resolveAdapterMode`):
//   - mock  → the contract-backed demo flow (`mockAdapter`), incl. the DEV-only scenario preview;
//   - bridge → the live local-agent Runtime (`bridgeAdapter`) over the Action Window transport.
//
// The presentational components and all copy are unchanged — only where `run`/`note`/`send` come
// from changes. Bridge mode is inert until a real transport is wired (see `resolveBridgeSession`), so
// the shipped screen runs the mock; this keeps the UI honest without a "coming soon" surface.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionWindowRunView, CommandType } from "./contract";
import { UI_SCENARIOS, type ScenarioName } from "./fixtures";
import { applyCommand } from "./mockAdapter";
import { createBridgeClient, type BridgeClient } from "./bridgeAdapter";
import { resolveAdapterMode, resolveBridgeSession, type AdapterMode } from "./devMode";

const INITIAL_SCENARIO: ScenarioName = "human-action-required";

export interface ActionWindowController {
  mode: AdapterMode;
  run: ActionWindowRunView | null;
  note: string;
  send: (type: CommandType) => void;
  /** DEV-only scenario preview (mock mode only; undefined in bridge mode). */
  scenario?: ScenarioName;
  loadScenario?: (name: ScenarioName) => void;
}

export function useActionWindowController(): ActionWindowController {
  const mode = useMemo(() => resolveAdapterMode(), []);
  const [scenario, setScenario] = useState<ScenarioName>(INITIAL_SCENARIO);
  const [run, setRun] = useState<ActionWindowRunView | null>(
    mode === "mock" ? UI_SCENARIOS[INITIAL_SCENARIO].run : null,
  );
  const [note, setNote] = useState<string>("");
  const clientRef = useRef<BridgeClient | null>(null);

  // Bridge mode: subscribe to the live Runtime and mirror its view/note into React state.
  useEffect(() => {
    if (mode !== "bridge") return;
    const session = resolveBridgeSession();
    if (!session) return;
    const client = createBridgeClient(session.transport, { runId: session.runId, channelCode: session.channelCode });
    clientRef.current = client;
    const unsubscribe = client.subscribe(() => {
      setRun(client.getView());
      setNote(client.getNote());
    });
    client.connect();
    return () => {
      unsubscribe();
      client.close();
      clientRef.current = null;
    };
  }, [mode]);

  const send = useCallback(
    (type: CommandType) => {
      if (mode === "bridge") {
        clientRef.current?.send(type);
        return;
      }
      const result = applyCommand(run, type);
      setRun(result.run);
      setNote(result.note);
    },
    [mode, run],
  );

  const loadScenario = useCallback((name: ScenarioName) => {
    setScenario(name);
    setRun(UI_SCENARIOS[name].run);
    setNote("");
  }, []);

  return mode === "mock"
    ? { mode, run, note, send, scenario, loadScenario }
    : { mode, run, note, send };
}
