import { uid } from "@/lib/utils";
import { approvalGateText } from "./prompt";
import { bucketForTool } from "./playbooks";
import { STAGE_LABELS } from "./types";
import type {
  Diagnosis,
  ExtractedFields,
  IncidentSession,
  LiveToolResult,
  Proposal,
  StageId,
  TimelineEvent,
} from "./types";

function inferService(alert: string) {
  if (/checkout/i.test(alert)) return "checkout";
  if (/payment/i.test(alert)) return "payment";
  if (/recommendation/i.test(alert)) return "recommendation";
  if (/\bauth/i.test(alert)) return "auth";
  return "production";
}

function inferRegion(alert: string) {
  return alert.match(/\b(us-east-1|us-west-2|eu-west-1|ap-south-1)\b/i)?.[1] ?? "unknown";
}

function extractFields(alert: string): ExtractedFields {
  return {
    service: inferService(alert),
    severity: /sev-?1|critical|p0/i.test(alert) ? "SEV-1" : "SEV-2",
    region: inferRegion(alert),
    timestamp: alert.match(/\blast \d+ (minutes?|hours?)\b/i)?.[0] ?? "unspecified",
    extra: {},
  };
}

function event(
  kind: TimelineEvent["kind"],
  stage: StageId,
  title: string,
  body?: string,
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id: uid(),
    ts: Date.now(),
    kind,
    stage,
    title,
    body,
    ...extra,
  };
}

function stageEvent(stage: StageId, body?: string) {
  return event("stage", stage, `Stage ${stage} – ${STAGE_LABELS[stage]}`, body);
}

function investigationText(results: LiveToolResult[]) {
  return results
    .filter((result) => result.status === "ok")
    .map((result) => result.response)
    .join("\n");
}

function deriveDiagnosis(alert: string, results: LiveToolResult[]): Diagnosis {
  const evidence = results
    .filter((result) => result.status === "ok")
    .map((result) => `${result.title}: ${result.response.replace(/\s+/g, " ").slice(0, 220)}`);

  const combined = `${alert}\n${investigationText(results)}`;

  const checkoutTimeoutRegression =
    /checkout/i.test(combined) &&
    /4c21/i.test(combined) &&
    /paymentadapter timeout after 500ms/i.test(combined) &&
    /payment\.latency_p99/i.test(combined);

  if (checkoutTimeoutRegression) {
    return {
      rootCause:
        "The live MCP evidence indicates deploy 4c21 tightened the PaymentAdapter timeout to 500ms, below observed payment latency.",
      confidence: "High",
      evidence,
      reasoning:
        "The deploy record, timeout errors, trace, and payment latency all identify the same timeout regression. The payment request succeeds, but checkout gives up before it returns.",
    };
  }

  return {
    rootCause:
      "The available live evidence does not yet support a single high-confidence root cause.",
    confidence: evidence.length >= 3 ? "Medium" : "Low",
    evidence,
    reasoning:
      "Holdline recorded only tool-returned evidence. Continue the investigation in TrueForge before proposing any production change.",
  };
}

function deriveProposal(diagnosis: Diagnosis): Proposal {
  if (diagnosis.confidence === "High" && /4c21|PaymentAdapter/i.test(diagnosis.rootCause)) {
    return {
      steps: [
        "1. Open the linked Holdline agent in TrueForge.",
        "2. Propose rollback of checkout deployment 4c21 to stable baseline 9e10.",
        "3. Obtain explicit human approval and the TrueForge Allow decision.",
        "4. Re-check metrics and logs before declaring recovery.",
      ],
      impact: "The Holdline desk does not execute the rollback. TrueForge owns the approval-gated simulated action.",
      risk: "Low",
      rollback: "The only supported mock action is 4c21 → 9e10.",
      recoverEta: "Verify with post-action metrics and logs.",
    };
  }

  return {
    steps: [
      "1. Continue investigation in TrueForge using the collected evidence.",
      "2. Do not make a production change until a specific root cause and rollback target are tool-supported.",
    ],
    impact: "No production change is proposed from the Holdline desk.",
    risk: "Low",
    rollback: "Not applicable until a safe remediation is identified.",
    recoverEta: "Awaiting additional evidence.",
  };
}

export function createSession(alert: string): IncidentSession {
  const trimmed = alert.trim();
  const now = Date.now();
  const extracted = extractFields(trimmed);

  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    alert: trimmed,
    title: `${extracted.service} incident`,
    stage: 1,
    status: "waiting",
    writeLock: "engaged",
    extracted,
    investigation: { tools: [] },
    events: [
      stageEvent(1, "Alert received. Holdline will collect live, read-only MCP evidence."),
      event(
        "agent",
        1,
        "Alert acknowledged",
        `Service: ${extracted.service}\nRegion: ${extracted.region}\n\n${trimmed}`,
      ),
    ],
  };
}

export function beginInvestigation(session: IncidentSession): IncidentSession {
  return {
    ...session,
    stage: 2,
    status: "running",
    updatedAt: Date.now(),
    events: [
      ...session.events,
      stageEvent(2, "Collecting live read-only evidence from the incident-monitoring MCP server."),
    ],
  };
}

export function recordToolStart(
  session: IncidentSession,
  tool: string,
  title: string,
): IncidentSession {
  return {
    ...session,
    updatedAt: Date.now(),
    events: [
      ...session.events,
      event("tool-call", 2, `mcp.${tool}`, title, {
        tool,
        bucket: bucketForTool(tool as never),
        status: "running",
      }),
    ],
  };
}

export function recordToolResult(
  session: IncidentSession,
  result: LiveToolResult,
): IncidentSession {
  const tools = [...(session.investigation?.tools ?? []), result];

  return {
    ...session,
    updatedAt: Date.now(),
    investigation: {
      tools,
      traceId: session.investigation?.traceId,
    },
    events: [
      ...session.events,
      event("tool-result", 2, `${result.tool} · ${result.status}`, result.response, {
        tool: result.tool,
        bucket: result.bucket,
        status: result.status === "ok" ? "ok" : result.status === "failed" ? "failed" : "blocked",
      }),
    ],
  };
}

export function finishInvestigation(session: IncidentSession): IncidentSession {
  const results = session.investigation?.tools ?? [];
  const diagnosis = deriveDiagnosis(session.alert, results);
  const proposal = deriveProposal(diagnosis);
  const gateBody = approvalGateText({
    rootCause: diagnosis.rootCause,
    evidence: diagnosis.evidence,
    confidence: diagnosis.confidence,
    reasonForConfidence: diagnosis.reasoning,
    proposedAction: proposal.steps.join(" "),
    risk: proposal.risk,
    rollback: proposal.rollback,
  });

  return {
    ...session,
    stage: 5,
    status: "waiting",
    diagnosis,
    proposal,
    updatedAt: Date.now(),
    events: [
      ...session.events,
      stageEvent(3, `Root cause: ${diagnosis.rootCause}\nConfidence: ${diagnosis.confidence}`),
      event("agent", 3, "Evidence-based diagnosis", diagnosis.reasoning),
      stageEvent(4, proposal.steps.join("\n")),
      event("agent", 4, "Proposed next step", `${proposal.impact}\n\nRisk: ${proposal.risk}`),
      stageEvent(5, "Holdline is waiting. TrueForge remains the approval-gated action harness."),
      event("gate", 5, "Stage 5 – Handoff to TrueForge", gateBody, { status: "blocked" }),
    ],
  };
}

export function failInvestigation(session: IncidentSession, errorMessage: string): IncidentSession {
  return {
    ...session,
    status: "failed",
    updatedAt: Date.now(),
    errorMessage,
    events: [
      ...session.events,
      event("system", session.stage, "Live MCP investigation failed", errorMessage, {
        status: "failed",
      }),
    ],
  };
}

export function approveSession(session: IncidentSession, via: string): IncidentSession {
  return {
    ...session,
    updatedAt: Date.now(),
    approvedAt: Date.now(),
    approvedVia: via,
    status: "parked",
    events: [
      ...session.events,
      event(
        "approval",
        5,
        `Approval recorded (${via})`,
        "Holdline does not execute changes. Continue in TrueForge, where the separate Allow/Deny tool gate protects rollback_deployment.",
        { status: "ok" },
      ),
    ],
  };
}

export function rejectSession(session: IncidentSession): IncidentSession {
  return {
    ...session,
    updatedAt: Date.now(),
    status: "rejected",
    writeLock: "engaged",
    events: [
      ...session.events,
      event(
        "system",
        5,
        "Held by human",
        "No production change will run. The investigation remains available for review.",
        { status: "blocked" },
      ),
    ],
  };
}

export function appendHuman(session: IncidentSession, text: string): IncidentSession {
  return {
    ...session,
    updatedAt: Date.now(),
    events: [...session.events, event("human", session.stage, "On-call", text)],
  };
}

export function replyToHuman(session: IncidentSession, text: string): IncidentSession {
  return {
    ...session,
    updatedAt: Date.now(),
    events: [
      ...session.events,
      event(
        "agent",
        session.stage,
        "Holdline",
        session.status === "waiting"
          ? "The Holdline desk records approval intent, but TrueForge must execute any approval-gated action."
          : `Noted: ${text}`,
      ),
    ],
  };
}