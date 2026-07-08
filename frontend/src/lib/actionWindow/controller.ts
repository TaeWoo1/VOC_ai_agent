// **Action Window Operations controller (R2).**
//
// One hook the Operations screen consumes for BOTH data sources, selected through the dev/runtime
// boundary (`resolveAdapterMode`):
//   - mock  → the contract-backed demo flow (`mockAdapter`), incl. the DEV-only scenario preview;
//   - bridge → the live local-agent Runtime (`bridgeAdapter`) over the Action Window transport.
//
// The presentational components and all copy are unchanged — only where `run`/`note`/`send` come
// from changes. Bridge mode (R2B) connects over the real Local Agent Bridge WebSocket via
// `resolveBridgeSession`; when no live session can be established (agent off, unpaired, no hosted
// run) the controller falls back to the mock at runtime — honest degradation, no "coming soon".

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionWindowRunView, CommandType } from "./contract";
import { UI_SCENARIOS, type ScenarioName } from "./fixtures";
import { applyCommand } from "./mockAdapter";
import { createBridgeClient, type BridgeClient } from "./bridgeAdapter";
import { resolveAdapterMode, resolveBridgeSession, type AdapterMode, type BridgeSession } from "./devMode";

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
  const [mode, setMode] = useState<AdapterMode>(() => resolveAdapterMode());
  const [scenario, setScenario] = useState<ScenarioName>(INITIAL_SCENARIO);
  const [run, setRun] = useState<ActionWindowRunView | null>(
    resolveAdapterMode() === "mock" ? UI_SCENARIOS[INITIAL_SCENARIO].run : null,
  );
  const [note, setNote] = useState<string>("");
  const clientRef = useRef<BridgeClient | null>(null);

  // Bridge mode: establish the live session over the Bridge WS, then mirror the Runtime's view/note
  // into React state. If no live session can be established, fall back to the mock at runtime.
  useEffect(() => {
    if (mode !== "bridge") return;
    let cancelled = false;
    let session: BridgeSession | null = null;
    let client: BridgeClient | null = null;
    let unsubscribe: (() => void) | null = null;
    void resolveBridgeSession().then((resolved) => {
      if (cancelled) {
        resolved?.close();
        return;
      }
      if (!resolved) {
        // No agent / no pairing / no hosted run → honest mock fallback.
        setMode("mock");
        setRun(UI_SCENARIOS[INITIAL_SCENARIO].run);
        return;
      }
      session = resolved;
      client = createBridgeClient(resolved.transport, { runId: resolved.runId, channelCode: resolved.channelCode });
      clientRef.current = client;
      unsubscribe = client.subscribe(() => {
        setRun(client!.getView());
        setNote(client!.getNote());
      });
      client.connect();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      client?.close();
      session?.close();
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
