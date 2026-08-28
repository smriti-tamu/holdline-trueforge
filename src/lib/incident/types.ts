export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SessionStatus =
  | "running"
  | "waiting"
  | "executing"
  | "closed"
  | "rejected";

export type WriteLock = "engaged" | "released";

export type EventKind =
  | "stage"
  | "agent"
  | "tool-call"
  | "tool-result"
  | "subagent"
  | "sandbox"
  | "gate"
  | "human"
  | "approval"
  | "execution"
  | "close"
  | "system";

export type EventStatus = "running" | "ok" | "blocked" | "failed";

export type EvidenceBucket = "metrics" | "logs" | "deploys" | "traces" | "tickets" | "sandbox";

export type TimelineEvent = {
  id: string;
  ts: number;
  kind: EventKind;
  stage: StageId;
  title: string;
  body?: string;
  tool?: string;
  subagent?: string;
  bucket?: EvidenceBucket;
  status?: EventStatus;
};

export type Diagnosis = {
  rootCause: string;
  confidence: "High" | "Medium" | "Low";
  evidence: string[];
  reasoning: string;
};

export type Proposal = {
  steps: string[];
  impact: string;
  risk: "Low" | "Medium" | "High";
  rollback: string;
  recoverEta: string;
};

export type ExtractedFields = {
  service: string;
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  region: string;
  timestamp: string;
  extra: Record<string, string>;
};

export type ScriptStep = {
  delayMs: number;
  kind: EventKind;
  title: string;
  body?: string;
  tool?: string;
  subagent?: string;
  bucket?: EvidenceBucket;
  status?: EventStatus;
  stage?: StageId;
  patch?: {
    stage?: StageId;
    status?: SessionStatus;
    writeLock?: WriteLock;
    diagnosis?: Diagnosis;
    proposal?: Proposal;
    extracted?: ExtractedFields;
  };
};

export type IncidentSession = {
  id: string;
  createdAt: number;
  updatedAt: number;
  alert: string;
  playbookId: string;
  title: string;
  stage: StageId;
  status: SessionStatus;
  writeLock: WriteLock;
  extracted: ExtractedFields;
  diagnosis?: Diagnosis;
  proposal?: Proposal;
  events: TimelineEvent[];
  playhead: number;
  execHead: number;
  approvedAt?: number;
  approvedVia?: string;
};

export const STAGE_LABELS: Record<StageId, string> = {
  1: "Alert Reception",
  2: "Investigate",
  3: "Diagnose",
  4: "Propose",
  5: "Approve → Act",
  6: "Verify → Recovery",
  7: "Resolve",
};

export const TEST_ALERTS = [
  {
    id: "checkout",
    severity: "SEV-1" as const,
    service: "checkout",
    blurb: "Error rate 0.3% → 8.7% after deploy 4c21",
    alert:
      "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.",
  },
  {
    id: "payment",
    severity: "SEV-1" as const,
    service: "payment",
    blurb: "502s on 40% of requests since 14:22 UTC",
    alert:
      "Payment service is returning 502s for 40% of requests. Started at 14:22 UTC.",
  },
  {
    id: "recs",
    severity: "SEV-2" as const,
    service: "recommendation",
    blurb: "CPU 97%, p99 latency 4.2s",
    alert:
      "CPU on the recommendation service is at 97% and p99 latency is 4.2s.",
  },
  {
    id: "auth",
    severity: "SEV-1" as const,
    service: "auth",
    blurb: "Critical vuln in auth library deployed 45m ago",
    alert:
      "New critical vulnerability flagged in the auth library we deployed 45 minutes ago.",
  },
] as const;
