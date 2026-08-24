import { useEffect, useRef } from "react";
import {
  Activity,
  Bot,
  Box,
  GitCommitHorizontal,
  Lock,
  MessageSquare,
  Shield,
  Terminal,
  Unlock,
  User,
} from "lucide-react";
import { cn, formatClock } from "@/lib/utils";
import type { EventKind, IncidentSession, TimelineEvent } from "@/lib/incident/types";

const ICONS: Partial<Record<EventKind, typeof Bot>> = {
  stage: Shield,
  agent: Bot,
  "tool-call": Terminal,
  "tool-result": Activity,
  subagent: GitCommitHorizontal,
  sandbox: Box,
  gate: Lock,
  human: User,
  approval: Unlock,
  execution: Terminal,
  close: Shield,
  system: MessageSquare,
};

function EventRow({ event }: { event: TimelineEvent }) {
  const Icon = ICONS[event.kind] ?? Bot;
  const isMono = Boolean(
    event.body &&
      (event.kind === "tool-result" ||
        event.kind === "sandbox" ||
        event.kind === "subagent" ||
        event.kind === "execution"),
  );
  return (
    <article className="grid grid-cols-[20px_1fr] gap-3">
      <div className="relative flex flex-col items-center">
        <span
          className={cn(
            "mt-0.5 flex size-5 items-center justify-center rounded-full bg-subtle text-muted",
            event.kind === "gate" && "text-warn",
            event.kind === "approval" && "text-ok",
            event.status === "blocked" && "text-danger",
          )}
        >
          <Icon className="size-3" />
        </span>
        <span className="w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 pb-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-sm font-medium text-fg">{event.title}</h3>
          <time className="font-mono text-[11px] text-faint tabular-nums">
            {formatClock(event.ts)}
          </time>
          {event.subagent ? (
            <span className="text-[11px] tracking-wide text-muted uppercase">
              {event.subagent}
            </span>
          ) : null}
        </div>
        {event.body ? (
          <pre
            className={cn(
              "mt-1.5 whitespace-pre-wrap text-pretty text-sm text-muted",
              isMono &&
                "rounded-sm bg-subtle/80 p-3 font-mono text-[12px] leading-relaxed text-fg/80",
            )}
          >
            {event.body}
          </pre>
        ) : null}
      </div>
    </article>
  );
}

export function Timeline({ session }: { session: IncidentSession }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [session.events.length]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto pr-1 max-lg:max-h-[min(60dvh,32rem)]">
      {session.events.length === 0 ? (
        <p className="py-8 text-sm text-muted">Harness starting…</p>
      ) : (
        session.events.map((event) => <EventRow key={event.id} event={event} />)
      )}
    </div>
  );
}
