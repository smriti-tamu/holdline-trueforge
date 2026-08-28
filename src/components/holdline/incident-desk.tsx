import { Lock, Unlock } from "lucide-react";
import { ApprovalGate } from "@/components/holdline/approval-gate";
import { Composer } from "@/components/holdline/composer";
import { EvidencePanel } from "@/components/holdline/evidence-panel";
import { HoldlineMark } from "@/components/holdline/mark";
import { StageRail } from "@/components/holdline/stage-rail";
import { Timeline } from "@/components/holdline/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { IncidentSession } from "@/lib/incident/types";
import { useHoldline } from "@/store/holdline";

export function IncidentDesk({
  session,
  onLeave,
  onApprove,
  onReject,
  onSend,
}: {
  session: IncidentSession;
  onLeave: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSend: (text: string) => void;
}) {
  const locked = session.writeLock === "engaged";
  const connection = useHoldline((s) => s.connection);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onLeave}
          className="flex items-center gap-2 rounded-sm pr-2 hover:bg-elevated"
        >
          <HoldlineMark className="size-8" />
          <span className="text-sm font-medium tracking-tight">Holdline</span>
        </button>
        <span className="hidden h-4 w-px bg-border sm:block" />
        <p className="min-w-0 flex-1 truncate text-sm text-muted">{session.title}</p>
        <Badge tone={session.extracted.severity === "SEV-1" ? "danger" : "warn"}>
          {session.extracted.severity}
        </Badge>
        <span
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-subtle px-3 text-[11px] tracking-wide text-muted uppercase"
          title={locked ? "Mutating tools are blocked" : "Mutating tools permitted for this session"}
        >
          {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
          {locked ? "Write lock" : "Unlocked"}
        </span>
        <span
          className="hidden h-9 items-center rounded-full bg-subtle px-3 text-[11px] tracking-wide text-muted uppercase sm:inline-flex"
          title="Current model and MCP bridge settings from the Holdline connections panel"
        >
          {connection.modelProvider} / {connection.modelName} · {connection.mcpServerName}
          {connection.mcpTransport === "http" ? " · Live MCP" : ""}
        </span>
        <Button variant="ghost" size="sm" onClick={onLeave}>
          Sessions
        </Button>
      </header>

      <div className="border-b border-border px-3 py-2 sm:px-4">
        <StageRail session={session} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <section className="flex min-h-0 flex-col gap-3 px-4 py-4">
          <div className="flex items-center justify-between gap-2">
  <h2 className="text-xs tracking-wide text-muted uppercase">Live investigation</h2>
</div>
          <Timeline session={session} />
          {session.status === "rejected" ? (
            <div className="flex flex-col gap-3 rounded-md bg-subtle px-3 py-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Held. Write lock remains engaged. No production change ran.
              </p>
              <Button size="sm" onClick={onApprove}>
                Approve plan
              </Button>
            </div>
          ) : null}
          <ApprovalGate session={session} />
          <Composer session={session} onSend={onSend} />
        </section>
        <aside className="flex min-h-[16rem] flex-col border-t border-border p-4 lg:min-h-0 lg:border-t-0 lg:border-l">
          <EvidencePanel session={session} />
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-sm bg-elevated p-2.5">
              <dt className="text-faint">Service</dt>
              <dd className="mt-0.5 font-mono text-fg">{session.extracted.service}</dd>
            </div>
            <div className="rounded-sm bg-elevated p-2.5">
              <dt className="text-faint">Region</dt>
              <dd className="mt-0.5 font-mono text-fg">{session.extracted.region}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
