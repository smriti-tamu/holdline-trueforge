import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { approvalGateText } from "@/lib/incident/prompt";
import type { IncidentSession } from "@/lib/incident/types";

export function ApprovalGate({ session }: { session: IncidentSession }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (session.status === "waiting") setOpen(true);
    else setOpen(false);
  }, [session.id, session.status]);

  if (!session.diagnosis || !session.proposal || session.status !== "waiting") {
    return null;
  }

  const body = approvalGateText({
    rootCause: session.diagnosis.rootCause,
    evidence: session.diagnosis.evidence,
    confidence: session.diagnosis.confidence,
    reasonForConfidence: session.diagnosis.reasoning,
    proposedAction: session.proposal.steps.join(" "),
    risk: session.proposal.risk,
    rollback: session.proposal.rollback,
  });

  return (
    <>
      <div className="flex items-start gap-3 rounded-md bg-warn/10 px-3 py-3 text-sm text-fg">
        <Lock className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Stage 5 – Continue in TrueForge</p>
          <p className="mt-0.5 text-muted">
            Holdline is read-only. Open the Holdline agent in TrueForge for the approval-gated action.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Review handoff
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Stage 5 – Continue in TrueForge</DialogTitle>
          <DialogDescription>
            Holdline collected evidence only. TrueForge owns the explicit approval and Allow/Deny tool gate.
          </DialogDescription>
          <pre className="mt-4 whitespace-pre-wrap rounded-md bg-subtle p-4 text-sm leading-relaxed text-fg">
            {body}
          </pre>
          <div className="mt-5 flex justify-end">
            <Button onClick={() => setOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}