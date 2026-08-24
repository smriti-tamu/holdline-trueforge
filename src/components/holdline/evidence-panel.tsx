import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { EvidenceBucket, IncidentSession } from "@/lib/incident/types";

const TABS: { id: EvidenceBucket; label: string }[] = [
  { id: "metrics", label: "Metrics" },
  { id: "logs", label: "Logs" },
  { id: "deploys", label: "Deploys" },
  { id: "traces", label: "Traces" },
  { id: "tickets", label: "Tickets" },
  { id: "sandbox", label: "Sandbox" },
];

export function EvidencePanel({ session }: { session: IncidentSession }) {
  const grouped = useMemo(() => {
    const map: Record<EvidenceBucket, string[]> = {
      metrics: [],
      logs: [],
      deploys: [],
      traces: [],
      tickets: [],
      sandbox: [],
    };
    for (const event of session.events) {
      if (event.bucket && event.body) map[event.bucket].push(event.body);
    }
    return map;
  }, [session.events]);

  const available = TABS.filter((t) => grouped[t.id].length > 0);
  const [tab, setTab] = useState<EvidenceBucket>("metrics");
  const active = available.some((t) => t.id === tab) ? tab : available[0]?.id;

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)] sm:p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs tracking-wide text-muted uppercase">Evidence</h2>
        <span className="font-mono text-[11px] text-faint tabular-nums">
          {session.events.filter((e) => e.bucket).length} artifacts
        </span>
      </header>
      {available.length === 0 ? (
        <p className="text-sm text-muted">
          Read-only tools have not returned yet. The harness will file artifacts here.
        </p>
      ) : (
        <>
          <div className="mb-3 flex gap-1 overflow-x-auto">
            {available.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "h-9 shrink-0 rounded-sm px-3 text-xs",
                  active === t.id ? "bg-subtle text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {active
              ? grouped[active].map((body, i) => (
                  <pre
                    key={`${active}-${i}`}
                    className="mb-3 whitespace-pre-wrap rounded-sm bg-subtle p-3 font-mono text-[12px] leading-relaxed text-fg/85"
                  >
                    {body}
                  </pre>
                ))
              : null}
          </div>
        </>
      )}
    </section>
  );
}
