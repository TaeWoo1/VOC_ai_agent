import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectionClient, makeProjectionClient, type ProjectionState } from "../lib/bridge/projectionClient";
import type { ProjectionInput } from "../lib/bridge/projectionProtocol";

const INITIAL: ProjectionState = { phase: "connecting", control: "available", droppedFrames: 0, localOnly: true };

/**
 * React binding for the Browser Projection V0 client. Owns the client lifecycle, converts incoming frame
 * bytes into a single live object URL (revoked as soon as the next frame is drawn, so decoded resources never
 * accumulate — slice §F), and paces frame delivery to the image's decode via `frameRendered()`.
 *
 * Reconnect after a refresh is automatic and restores VIEW only — control is never auto-restored.
 */
export function useProjection(): {
  state: ProjectionState;
  frameUrl: string | null;
  onImageLoad: () => void;
  requestControl: () => void;
  releaseControl: () => void;
  requestTargetSwitch: () => void;
  retry: () => void;
  sendInput: (input: ProjectionInput) => void;
} {
  const clientRef = useRef<ProjectionClient | null>(null);
  const [state, setState] = useState<ProjectionState>(INITIAL);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const client = makeProjectionClient({
      onFrame: (_header, bytes) => {
        // One live object URL at a time; the previous is revoked on the next image load (onImageLoad).
        const blob = new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" });
        setFrameUrl(URL.createObjectURL(blob));
      },
    });
    clientRef.current = client;
    const unsubscribe = client.subscribe(setState);
    void client.start();

    const interval = setInterval(() => {
      const s = client.getState();
      if (s.phase === "disconnected" || s.phase === "unreachable") void client.start();
    }, 1500);

    return () => {
      clearInterval(interval);
      unsubscribe();
      client.stop();
      if (prevUrlRef.current) { URL.revokeObjectURL(prevUrlRef.current); prevUrlRef.current = null; }
    };
  }, []);

  // Called by the <img> onLoad: the new frame is painted → revoke the previous URL and pump any pending frame.
  const onImageLoad = useCallback(() => {
    const prev = prevUrlRef.current;
    prevUrlRef.current = frameUrl;
    if (prev && prev !== frameUrl) URL.revokeObjectURL(prev);
    clientRef.current?.frameRendered();
  }, [frameUrl]);

  return useMemo(
    () => ({
      state,
      frameUrl,
      onImageLoad,
      requestControl: () => clientRef.current?.requestControl(),
      releaseControl: () => clientRef.current?.releaseControl(),
      requestTargetSwitch: () => clientRef.current?.requestTargetSwitch(),
      retry: () => void clientRef.current?.start(),
      sendInput: (input: ProjectionInput) => clientRef.current?.sendInput(input),
    }),
    [state, frameUrl, onImageLoad],
  );
}
