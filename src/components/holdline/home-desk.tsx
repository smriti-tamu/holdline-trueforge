import { useState } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { ConnectionPanel } from "@/components/holdline/connection-panel";
import { HoldlineMark } from "@/components/holdline/mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TEST_ALERTS, type IncidentSession } from "@/lib/incident/types";
import { useHoldline } from "@/store/holdline";
import { cn } from "@/lib/utils";

function statusTone(status: IncidentSession["status"]) {
  if (status === "waiting") return "warn" as const;
  if (status === "closed") return "ok" as const;
  if (status === "rejected") return "danger" as const;
  return "fg" as const;
}

function statusLabel(status: IncidentSession["status"]) {
  if (status === "running") return "Investigating";
  if (status === "waiting") return "Awaiting approval";
  if (status === "executing") return "Acting";
  if (status === "closed") return "Closed";
  return "Held";
}

export function HomeDesk({
  sessions,
  onStart,
  onResume,
}: {
  sessions: IncidentSession[];
  onStart: (alert: string) => void;
  onResume: (id: string) => void;
  }) {
  const [custom, setCustom] = useState("");
  const connection = useHoldline((s) => s.connection);
  const isTrueForgeConnected =
    connection.mcpTransport === "http" &&
    typeof connection.lastTestSummary === "string" &&
    connection.lastTestSummary.startsWith("Synced ");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 sm:py-16">
      <header className="max-w-xl">
        <div className="flex items-center gap-3">
          <HoldlineMark className="size-10" />
          <p className="text-xs tracking-[0.18em] text-muted uppercase">Forge harness</p>
          <Badge tone={isTrueForgeConnected ? "ok" : "fg"} className="ml-1">
            {isTrueForgeConnected ? "TrueForge connected" : "Local Holdline"}
          </Badge>
        </div>
        <h1 className="mt-6 text-4xl font-medium tracking-tight text-balance text-fg sm:text-5xl">
          Holdline
        </h1>
        <p className="mt-3 max-w-md text-base text-pretty text-muted">
          A seven-stage incident responder. It investigates, diagnoses, proposes, acts,
          verifies recovery, and only then resolves. Nothing irreversible runs until
          you say so.
        </p>
      </header>

      <ConnectionPanel />

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-xs tracking-wide text-muted uppercase">Demo alerts</h2>
          <p className="text-xs text-faint">Checkout is the three-minute path</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEST_ALERTS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onStart(item.alert)}
              className={cn(
                "group flex flex-col items-start rounded-lg bg-elevated p-4 text-left shadow-[var(--shadow-border)] transition-[background-color,box-shadow] duration-150",
                "hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <Badge tone={item.severity === "SEV-1" ? "danger" : "warn"}>
                  {item.severity}
                </Badge>
                <ArrowRight className="size-4 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
              </div>
              <p className="mt-3 font-mono text-xs tracking-wide text-muted uppercase">
                {item.service}
              </p>
              <p className="mt-1 text-sm text-pretty text-fg">{item.blurb}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs tracking-wide text-muted uppercase">Seven stages. One hard stop.</h2>
        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-7 sm:gap-2">
          {[
            { n: "1", t: "Alert", d: "Extract fields. Confirm the problem." },
            { n: "2", t: "Investigate", d: "MCP tools, subagents, sandbox. Facts only." },
            { n: "3", t: "Diagnose", d: "Root cause and confidence, with evidence." },
            { n: "4", t: "Propose", d: "Steps, impact, rollback, time to recover." },
            { n: "5", t: "Approve", d: "Write lock. Nothing runs until you approve." },
            { n: "6", t: "Verify", d: "Query metrics and logs after the action." },
            { n: "7", t: "Resolve", d: "Close only after recovery is confirmed." },
          ].map((s) => (
            <li key={s.n} className="rounded-md bg-elevated p-2 shadow-[var(--shadow-border)] sm:p-3">
              <p className="font-mono text-[11px] text-faint">{s.n}</p>
              <p className="mt-1 text-xs font-medium text-fg sm:text-sm">{s.t}</p>
              <p className="mt-1 hidden text-xs text-pretty text-muted sm:block">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)] sm:p-5">
        <h2 className="text-xs tracking-wide text-muted uppercase">Custom alert</h2>
        <p className="mt-1 text-sm text-muted">
          Paste a page. Unfamiliar services stay low-confidence — the harness will not invent telemetry.
        </p>
        <Textarea
          className="mt-3"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Describe the production alert…"
          rows={3}
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={() => onStart(custom)} disabled={!custom.trim()}>
            Open incident
          </Button>
        </div>
      </section>

      {sessions.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xs tracking-wide text-muted uppercase">Sessions</h2>
          <ul className="divide-y divide-border rounded-lg bg-elevated shadow-[var(--shadow-border)]">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onResume(session.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle"
                >
                  <Clock className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{session.title}</span>
                    <span className="block truncate text-xs text-muted">
                      Stage {session.stage} · {session.extracted.service}
                    </span>
                  </span>
                  <Badge tone={statusTone(session.status)}>{statusLabel(session.status)}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
