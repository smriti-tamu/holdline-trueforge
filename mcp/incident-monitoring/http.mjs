#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import http from "node:http";
import process from "node:process";

const SERVER_INFO = {
  name: "incident-monitoring",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "get_alert",
    description: "Return the incident summary for an alert ID or alert text.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: {
          type: "string",
          description: "Exact alert ID or alert text supplied by the user.",
        },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_metrics",
    description: "Read-only metrics lookup for the current alert.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: { type: "string" },
        query: { type: "string" },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    name: "query_logs",
    description: "Read-only log lookup for the current alert.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: { type: "string" },
        query: { type: "string" },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_deploys",
    description: "Read-only deploy history lookup.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: { type: "string" },
        service: { type: "string" },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_tickets",
    description: "Read-only ticket lookup.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: { type: "string" },
        query: { type: "string" },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_trace",
    description: "Read-only trace lookup for the current alert.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: { type: "string" },
        traceId: { type: "string" },
      },
      required: ["alertId"],
      additionalProperties: false,
    },
  },
  {
    name: "rollback_deployment",
    description:
      "Simulate rolling back a deployment. This is a destructive demo action and requires explicit human approval before execution.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: {
          type: "string",
          description: "Exact alert ID or alert text being remediated.",
        },
        targetDeploy: {
          type: "string",
          description: "Known-good deployment to restore.",
        },
      },
      required: ["alertId", "targetDeploy"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
];

const TEST_ALERTS = [
  {
    id: "checkout",
    service: "checkout",
    severity: "SEV-1",
    region: "us-east-1",
    alert:
      "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.",
    summary: "Checkout error rate spike after deploy 4c21.",
    metrics: "checkout.error_rate{region=us-east-1}\n  0.3% -> 8.7%\npayment.latency_p99\n  812ms",
    logs: "ERROR PaymentAdapter timeout after 500ms trace=8af2c1 deploy=4c21\nERROR PaymentAdapter timeout after 500ms trace=91bb04 deploy=4c21",
    deploys:
      "4c21  12:01 UTC  checkout-service  tighten PaymentAdapter timeout\n9e10  stable baseline",
    tickets: "No matching open tickets in the mock catalog.",
    traces:
      "trace=8af2c1\ncheckout /checkout 502ms error=timeout\npayment /charge 812ms status=200",
  },
  {
    id: "payment",
    service: "payment",
    severity: "SEV-1",
    region: "global",
    alert: "Payment service is returning 502s for 40% of requests. Started at 14:22 UTC.",
    summary: "Payment 502s caused by session-store pressure on redis-cluster-2.",
    metrics:
      "payment.http_5xx 0.40\nredis-cluster-2.mem 0.97\nredis-cluster-2.evict 12400/min\nredis-cluster-2.cpu 0.91",
    logs: "ERROR session store: connection reset host=redis-cluster-2:6379\nWARN retry exhausted, returning 502",
    deploys: "No payment-service deploys in the last 6 hours.",
    tickets: "INC-4412 14:18 UTC infra redis-cluster-2 memory pressure",
    traces:
      "payment /charge -> redis-cluster-2 connection reset\nupstream returns 502 after retry exhaustion",
  },
  {
    id: "recs",
    service: "recommendation",
    severity: "SEV-2",
    region: "global",
    alert: "CPU on the recommendation service is at 97% and p99 latency is 4.2s.",
    summary: "Recommendation service cache stampede after TTL dropped to 30s.",
    metrics: "cpu 0.97\np99 4.2s\ncache_miss 0.12 -> 0.78\norigin_rps x6",
    logs: "cache miss on popular:home, popular:foryou, similar:*\norigin handler occupying 20+ worker threads",
    deploys: "30m ago recs-cache config CACHE_TTL=30 (was 3600).",
    tickets: "No matching open tickets in the mock catalog.",
    traces: "edge RPS flat\norigin RPS spikes in lockstep with cache misses",
  },
  {
    id: "auth",
    service: "auth",
    severity: "SEV-1",
    region: "global",
    alert: "New critical vulnerability flagged in the auth library we deployed 45 minutes ago.",
    summary: "Critical auth-library vulnerability with no exploitation observed yet.",
    metrics: "auth.error_rate baseline\nlatency baseline\nno exploitation signal",
    logs: "No malformed-token spikes.\nNo RCE-like payloads.\nError rate unchanged.",
    deploys: "45m ago auth-service auth-lib 2.4.1 (was 2.3.9).",
    tickets: "CVE-2026-8841 CVSS 9.8 RCE in token parser",
    traces: "p99 41ms (baseline 38ms). error_rate 0.12% (baseline 0.11%).",
  },
];

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * normalize() plus stripping trailing sentence punctuation, for the one spot
 * (rollback_deployment) that compares a caller-supplied alertId against a
 * known literal string rather than doing keyword matching. Deliberately not
 * used by matchScenario()/resolveAlert(): those already do substring
 * matching and don't need it.
 */
function normalizeForMatch(text) {
  return normalize(text).replace(/[.!?]+$/, "");
}

function inferService(text) {
  const match = String(text).match(/\b([a-z][a-z0-9_-]*(?:service|svc|api)?)\b/i);
  return match?.[1] ?? "production";
}

function inferRegion(text) {
  const match = String(text).match(/\b(us-east-1|us-west-2|eu-west-1|ap-south-1)\b/i);
  return match?.[1] ?? "unknown";
}

function matchScenario(alertId) {
  const value = normalize(alertId);
  if (value.includes("checkout") || value.includes("4c21")) return TEST_ALERTS[0];
  if (value.includes("payment") || value.includes("502")) return TEST_ALERTS[1];
  if (value.includes("recommendation") || value.includes("cpu") || value.includes("latency")) {
    return TEST_ALERTS[2];
  }
  if (value.includes("auth") || value.includes("vulnerab") || value.includes("library")) {
    return TEST_ALERTS[3];
  }
  return null;
}

function resolveAlert(input) {
  const alertId = typeof input?.alertId === "string" ? input.alertId : "";
  const scenario = matchScenario(alertId);
  if (scenario) return { scenario, alertId };
  return {
    scenario: {
      id: "generic",
      service: inferService(alertId),
      severity: /sev-?1|crit|p0/i.test(alertId) ? "SEV-1" : "SEV-2",
      region: inferRegion(alertId),
      alert: alertId,
      summary: "Low-confidence alert with incomplete telemetry.",
      metrics: "No high-resolution metrics available in the mock catalog.",
      logs: "No stored logs available in the mock catalog.",
      deploys: "No matching deploy records in the mock catalog.",
      tickets: "No matching tickets in the mock catalog.",
      traces: "No matching trace in the mock catalog.",
    },
    alertId,
  };
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function toolText(title, body) {
  return `${title}\n\n${body}`;
}

/**
 * Enforce the inputSchema each tool already declares. Without this, a call
 * with the wrong shape (e.g. { baseline_id, deploy_id, region } instead of
 * { alertId }) silently falls through resolveAlert()'s "unknown alert"
 * fallback instead of failing — indistinguishable, from the caller's side,
 * from a genuinely unrecognized alert. That's how a subagent that guesses a
 * tool's parameters ends up reading "no matching records" as "this deploy
 * doesn't exist" instead of "I called this wrong," and gives up instead of
 * retrying with the right shape.
 */
function validateArguments(name, args) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const schema = tool.inputSchema;
  const provided = args && typeof args === "object" ? args : {};
  const allowedKeys = new Set(Object.keys(schema.properties ?? {}));
  const missing = (schema.required ?? []).filter((key) => !(key in provided));
  const unexpected =
    schema.additionalProperties === false
      ? Object.keys(provided).filter((key) => !allowedKeys.has(key))
      : [];

  if (missing.length > 0 || unexpected.length > 0) {
    const problems = [];
    if (missing.length > 0) problems.push(`missing required field(s): ${missing.join(", ")}`);
    if (unexpected.length > 0) problems.push(`unexpected field(s): ${unexpected.join(", ")}`);
    throw new Error(
      `Invalid arguments for ${name} (${problems.join("; ")}). Expected shape: ` +
        `{ ${Array.from(allowedKeys).join(", ")} }, required: [${(schema.required ?? []).join(", ")}].`,
    );
  }
}

function callTool(name, args, sessionState) {
  validateArguments(name, args);
  const { scenario, alertId } = resolveAlert(args);

  if (name === "get_alert") {
    if (alertId === TEST_ALERTS[0].alert) sessionState.checkoutRecoveryActive = false;
    return toolText(
      "Stage 1 - Alert Reception",
      jsonText({
        alert_id: alertId,
        service: scenario.service,
        severity: scenario.severity,
        region: scenario.region,
        summary: scenario.summary,
        raw_alert: scenario.alert,
      }),
    );
  }

  if (name === "query_metrics") {
    if (sessionState.checkoutRecoveryActive && alertId === TEST_ALERTS[0].alert) {
      return toolText(
        "Post-rollback metrics",
        jsonText({
          alert_id: alertId,
          metrics:
            "checkout.error_rate{region=us-east-1}\n  8.7% -> 0.4%\npayment.latency_p99\n  812ms -> 340ms\nrecovery_window\n  5m",
        }),
      );
    }
    return toolText("Metrics", jsonText({ alert_id: alertId, metrics: scenario.metrics }));
  }

  if (name === "query_logs") {
    if (sessionState.checkoutRecoveryActive && alertId === TEST_ALERTS[0].alert) {
      return toolText(
        "Post-rollback logs",
        jsonText({
          alert_id: alertId,
          logs: "INFO checkout serving deploy=9e10\nNo new PaymentAdapter timeout errors in the last 5 minutes.",
        }),
      );
    }
    return toolText("Logs", jsonText({ alert_id: alertId, logs: scenario.logs }));
  }

  if (name === "list_deploys") {
    return toolText("Deploys", jsonText({ alert_id: alertId, deploys: scenario.deploys }));
  }

  if (name === "search_tickets") {
    return toolText("Tickets", jsonText({ alert_id: alertId, tickets: scenario.tickets }));
  }

  if (name === "get_trace") {
    return toolText("Trace", jsonText({ alert_id: alertId, traces: scenario.traces }));
  }

  if (name === "rollback_deployment") {
    const supportedAlertId = TEST_ALERTS[0].alert;

    const requestedAlertId = typeof args?.alertId === "string" ? args.alertId.trim() : "";

    const targetDeploy =
      typeof args?.targetDeploy === "string" && args.targetDeploy.trim()
        ? args.targetDeploy.trim()
        : "";

    // Compare on normalized text (case/whitespace/trailing punctuation) so a
    // model that reproduces the alert from memory rather than copy-pasting it
    // isn't hard-rejected over a dropped trailing period. A live run did
    // exactly this: it sent the alert text verbatim minus the final ".", got
    // rejected, then misread the rejection's *prose* ("...only supports the
    // checkout alert for deploy 4c21.") as if that short phrase were itself
    // the expected alertId, and retried with that instead. The error now
    // quotes the exact expected string so a retry has something correct to
    // copy rather than a description to guess from.
    if (normalizeForMatch(requestedAlertId) !== normalizeForMatch(supportedAlertId)) {
      throw new Error(
        `Unsupported remediation: this mock rollback only supports the exact checkout alert text. ` +
          `Expected alertId: "${supportedAlertId}". Received: "${requestedAlertId}".`,
      );
    }

    if (targetDeploy !== "9e10") {
      throw new Error(
        "Unsupported rollback target: this mock incident can only restore stable baseline 9e10.",
      );
    }

    sessionState.checkoutRecoveryActive = true;

    return toolText(
      "Simulated remediation result",
      jsonText({
        status: "simulated_success",
        simulated: true,
        action: "Rollback checkout deployment 4c21 to 9e10",
        alert_id: requestedAlertId,
        message:
          "Mock rollback completed for demo purposes. No real production system was changed.",
      }),
    );
  }

  throw new Error(`Unknown tool: ${name}`);
}

function handleRpc(message, sessionState) {
  if (!message || typeof message !== "object") {
    return { error: { code: -32600, message: "Invalid Request" } };
  }

  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
        serverInfo: SERVER_INFO,
        capabilities: {
          tools: { listChanged: false },
        },
      },
    };
  }

  if (message.method === "notifications/initialized") {
    return { notification: true };
  }

  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } };
  }

  if (message.method === "tools/call") {
    try {
      const text = callTool(message.params?.name, message.params?.arguments ?? {}, sessionState);
      return { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text }] } };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "tool execution failed",
        },
      };
    }
  }

  if (message.id != null) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32601,
        message: `Method not found: ${message.method}`,
      },
    };
  }

  return { notification: true };
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8000);
const path = "/mcp";
const sessions = new Map();

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, server: SERVER_INFO });
    return;
  }

  if (req.url !== path) {
    sendJson(res, 404, { error: { message: "Not found" } });
    return;
  }

  if (req.method === "DELETE") {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !sessions.delete(sessionId)) {
      sendJson(res, 404, { error: { message: "Unknown MCP session" } });
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { message: "Method not allowed" } });
    return;
  }

  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const message = parseJson(body);
    const isInitialize = message?.method === "initialize";
    let sessionId = req.headers["mcp-session-id"];

    if (Array.isArray(sessionId)) sessionId = sessionId[0];

    if (isInitialize) {
      sessionId = randomUUID();
      sessions.set(sessionId, { checkoutRecoveryActive: false });
    } else if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32000, message: "Missing or invalid MCP session ID" },
      });
      return;
    }

    const response = handleRpc(message, sessions.get(sessionId));
    if (response.notification) {
      res.writeHead(202, { "mcp-session-id": sessionId });
      res.end();
      return;
    }
    if (response.error && !response.id) {
      sendJson(res, 400, response);
      return;
    }
    sendJson(res, 200, response, { "mcp-session-id": sessionId });
  });
});

server.listen(port, host, () => {
  console.log(`[incident-monitoring] HTTP MCP bridge listening on http://${host}:${port}${path}`);
});
