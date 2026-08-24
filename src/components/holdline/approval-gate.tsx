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

export function ApprovalGate({
  session,
  onApprove,
  onReject,
}: {
  session: IncidentSession;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (session.status === "waiting") setOpen(true);
    else setOpen(false);
  }, [session.id, session.status]);

  if (!session.diagnosis || !session.proposal) return null;
  if (session.status !== "waiting") return null;

  const body = approvalGateText({
    rootCause: session.diagnosis.rootCause,
    proposedAction: session.proposal.steps.join(" "),
    risk: session.proposal.risk,
    rollback: session.proposal.rollback,
  });

  return (
    <>
      <div className="flex items-start gap-3 rounded-md bg-warn/10 px-3 py-3 text-sm text-fg">
        <Lock className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Stage 5 – Waiting for Approval</p>
          <p className="mt-0.5 text-muted">
            Write lock engaged. The harness will not execute until you say approve.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Stage 5 – Waiting for Approval</DialogTitle>
          <DialogDescription>
            Hard gate. No rollback, restart, scale, deploy, or delete runs without you.
          </DialogDescription>
          <pre className="mt-4 whitespace-pre-wrap rounded-md bg-subtle p-4 text-sm leading-relaxed text-fg">
            {body}
          </pre>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onReject}>
              Hold
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                onApprove();
              }}
            >
              Approve
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
