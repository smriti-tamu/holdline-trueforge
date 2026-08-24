import { useEffect, useRef } from "react";
import { currentDelay } from "@/lib/incident/engine";
import { selectActive, useHoldline } from "@/store/holdline";

function reducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HarnessRunner() {
  const session = useHoldline(selectActive);
  const tickActive = useHoldline((s) => s.tickActive);
  const playhead = session?.playhead ?? 0;
  const execHead = session?.execHead ?? 0;
  const status = session?.status;
  const id = session?.id;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!session) return;
    if (session.status !== "running" && session.status !== "executing") return;
    const raw = currentDelay(session);
    const ms = reducedMotion() ? Math.min(raw, 80) : raw;
    timer.current = window.setTimeout(() => {
      tickActive();
    }, Math.max(40, ms));
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [id, playhead, execHead, status, session, tickActive]);

  return null;
}
