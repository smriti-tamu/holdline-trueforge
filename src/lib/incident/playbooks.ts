import type { EvidenceBucket } from "./types";

export type InvestigationToolName =
  | "get_alert"
  | "query_metrics"
  | "query_logs"
  | "list_deploys"
  | "get_trace"
  | "search_tickets";

export type InvestigationStep = {
  tool: InvestigationToolName;
  title: string;
  bucket: EvidenceBucket;
  query?: string;
  requiresTraceId?: boolean;
};

export const INVESTIGATION_PLAN: InvestigationStep[] = [
  {
    tool: "get_alert",
    title: "Retrieve alert details",
    bucket: "tickets",
  },
  {
    tool: "query_metrics",
    title: "Read error-rate and latency metrics",
    bucket: "metrics",
    query: "error rate, latency, saturation",
  },
  {
    tool: "query_logs",
    title: "Read recent error logs",
    bucket: "logs",
    query: "recent errors and timeout signatures",
  },
  {
    tool: "list_deploys",
    title: "Review recent deployments",
    bucket: "deploys",
  },
  {
    tool: "get_trace",
    title: "Inspect a trace from the logs",
    bucket: "traces",
    requiresTraceId: true,
  },
  {
    tool: "search_tickets",
    title: "Search related incidents and tickets",
    bucket: "tickets",
    query: "related incidents",
  },
];

export function argumentsForTool(
  tool: InvestigationToolName,
  alertId: string,
  traceId?: string,
): Record<string, string> {
  switch (tool) {
    case "query_metrics":
      return { alertId, query: "error rate, latency, saturation" };
    case "query_logs":
      return { alertId, query: "recent errors and timeout signatures" };
    case "list_deploys":
      return { alertId, service: "auto-detect" };
    case "get_trace":
      return { alertId, traceId: traceId ?? "" };
    case "search_tickets":
      return { alertId, query: "related incidents" };
    case "get_alert":
    default:
      return { alertId };
  }
}

export function extractTraceId(text: string): string | undefined {
  const match = text.match(/\btrace(?:Id)?\s*[=:]\s*["']?([a-z0-9-]+)/i);
  return match?.[1];
}

export function bucketForTool(tool: InvestigationToolName): EvidenceBucket {
  return INVESTIGATION_PLAN.find((step) => step.tool === tool)?.bucket ?? "tickets";
}