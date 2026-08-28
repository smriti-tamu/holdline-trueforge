#!/usr/bin/env node

import process from "node:process";

const SERVER_INFO = {
  name: "incident-monitoring",
  version: "1.0.0",
};

const TEST_ALERTS = [
  {
    id: "checkout",
    service: "checkout",
    severity: "SEV-1",
    region: "us-east-1",
    alert:
      "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.",
    summary: "Checkout error rate spike after deploy 4c21.",
    metrics:
      "checkout.error_rate{region=us-east-1}\n  0.3% -> 8.7%\npayment.latency_p99\n  812ms",
    logs:
      "ERROR PaymentAdapter timeout after 500ms trace=8af2c1 deploy=4c21\nERROR PaymentAdapter timeout after 500ms trace=91bb04 deploy=4c21",
    deploys:
      "4c21  12:01 UTC  checkout-service  tighten PaymentAdapter timeout\n9e10  stable baseline",
    tickets: "No matching open tickets in the mock catalog.",
    traces:
      "trace=8af2c1\ncheckout /checkout 502ms error=timeout\npayment /charge 812ms status=200",
    rootCause:
      "Deploy 4c21 cut PaymentAdapter timeout from 5s to 500ms. Payment p99 is ~812ms, so checkout calls time out and surface as errors.",
    proposal:
      "Rollback checkout-service to the revision before deploy 4c21 and keep the timeout at 5000ms until payment latency is reviewed.",
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
    logs:
      "ERROR session store: connection reset host=redis-cluster-2:6379\nWARN retry exhausted, returning 502",
    deploys: "No payment-service deploys in the last 6 hours.",
    tickets: "INC-4412 14:18 UTC infra redis-cluster-2 memory pressure",
    traces:
      "payment /charge -> redis-cluster-2 connection reset\nupstream returns 502 after retry exhaustion",
    rootCause:
      "redis-cluster-2 is under memory pressure (evictions, CPU 91%). Payment workers lose the session store and return 502s. No payment deploy in the window.",
    proposal:
      "Fail over the payment session store to redis-cluster-1, then scale redis-cluster-2 memory class and confirm success rate recovery.",
  },
  {
    id: "recs",
    service: "recommendation",
    severity: "SEV-2",
    region: "global",
    alert: "CPU on the recommendation service is at 97% and p99 latency is 4.2s.",
    summary: "Recommendation service cache stampede after TTL dropped to 30s.",
    metrics:
      "cpu 0.97\np99 4.2s\ncache_miss 0.12 -> 0.78\norigin_rps x6",
    logs:
      "cache miss on popular:home, popular:foryou, similar:*\norigin handler occupying 20+ worker threads",
    deploys: "30m ago recs-cache config CACHE_TTL=30 (was 3600).",
    tickets: "No matching open tickets in the mock catalog.",
    traces:
      "edge RPS flat\norigin RPS spikes in lockstep with cache misses",
    rootCause:
      "A config change dropped recommendation cache TTL from 1h to 30s. Cache miss rate jumped 12% -> 78%, origin stampeded, CPU hit 97% and p99 moved to 4.2s.",
    proposal:
      "Revert CACHE_TTL from 30s to 3600s and add capacity until miss rate falls below 20%.",
  },
  {
    id: "auth",
    service: "auth",
    severity: "SEV-1",
    region: "global",
    alert: "New critical vulnerability flagged in the auth library we deployed 45 minutes ago.",
    summary: "Critical auth-library vulnerability with no exploitation observed yet.",
    metrics:
      "auth.error_rate baseline\nlatency baseline\nno exploitation signal",
    logs:
      "No malformed-token spikes.\nNo RCE-like payloads.\nError rate unchanged.",
    deploys: "45m ago auth-service auth-lib 2.4.1 (was 2.3.9).",
    tickets: "CVE-2026-8841 CVSS 9.8 RCE in token parser",
    traces: "p99 41ms (baseline 38ms). error_rate 0.12% (baseline 0.11%).",
    rootCause:
      "auth-lib 2.4.1 (deployed 45 minutes ago) is flagged for CVE-2026-8841, an RCE in the token parser. No exploitation observed in logs yet.",
    proposal:
      "Emergency rollback auth-service to auth-lib 2.3.9, rotate signing keys, and expire sessions issued after the deploy.",
  },
];

const TOOLS = [
  {
    name: "get_alert",
    description: "Return the incident summary for an alert ID or alert text.",
    inputSchema: {
      type: "object",
      properties: {
        alertId: { type: "string", description: "Exact alert ID or alert text supplied by the user." },
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

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
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
      rootCause:
        "Telemetry is incomplete for a single root cause. Leading hypothesis: a recent change coinciding with the alert window.",
      proposal:
        "Do not change production automatically. Page the service owner and attach this investigation session.",
    },
    alertId,
  };
}

function inferService(text) {
  const match = text.match(/\b([a-z][a-z0-9_-]*(?:service|svc|api)?)\b/i);
  return match?.[1] ?? "production";
}

function inferRegion(text) {
  const match = text.match(/\b(us-east-1|us-west-2|eu-west-1|ap-south-1)\b/i);
  return match?.[1] ?? "unknown";
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function toolText(title, body) {
  return `${title}\n\n${body}`;
}

function listToolsResult() {
  return { tools: TOOLS };
}

let checkoutRecoveryActive = false;

function callTool(name, args) {
  const { scenario, alertId } = resolveAlert(args);

  if (name === "get_alert") {
    if (alertId === TEST_ALERTS[0].alert) checkoutRecoveryActive = false;
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
    if (checkoutRecoveryActive && alertId === TEST_ALERTS[0].alert) {
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
    if (checkoutRecoveryActive && alertId === TEST_ALERTS[0].alert) {
      return toolText(
        "Post-rollback logs",
        jsonText({
          alert_id: alertId,
          logs:
            "INFO checkout serving deploy=9e10\nNo new PaymentAdapter timeout errors in the last 5 minutes.",
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

  const requestedAlertId =
    typeof args?.alertId === "string" ? args.alertId.trim() : "";

  const targetDeploy =
    typeof args?.targetDeploy === "string" && args.targetDeploy.trim()
      ? args.targetDeploy.trim()
      : "";

  if (requestedAlertId !== supportedAlertId) {
    throw new Error(
      "Unsupported remediation: this mock rollback only supports the checkout alert for deploy 4c21.",
    );
  }

  if (targetDeploy !== "9e10") {
    throw new Error(
      "Unsupported rollback target: this mock incident can only restore stable baseline 9e10.",
    );
  }

  checkoutRecoveryActive = true;

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

function send(message) {
  const body = JSON.stringify(message);
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  process.stdout.write(payload);
}

function ok(id, result) {
  send({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function fail(id, code, message, data) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function handleMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.method === "initialize") {
    ok(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
      serverInfo: SERVER_INFO,
      capabilities: {
        tools: { listChanged: false },
      },
    });
    return;
  }

  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.method === "tools/list") {
    ok(message.id, listToolsResult());
    return;
  }

  if (message.method === "tools/call") {
    try {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      const text = callTool(name, args);
      ok(message.id, {
        content: [{ type: "text", text }],
      });
    } catch (error) {
      fail(message.id, -32603, error?.message || "tool execution failed");
    }
    return;
  }

  if (message.id != null) {
    fail(message.id, -32601, `Method not found: ${message.method}`);
  }
}

let buffer = Buffer.alloc(0);

function tryParse() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const headerText = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = headerText.match(/content-length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const length = Number(lengthMatch[1]);
    const messageEnd = headerEnd + 4 + length;
    if (buffer.length < messageEnd) return;

    const body = buffer.slice(headerEnd + 4, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);

    try {
      handleMessage(JSON.parse(body));
    } catch (error) {
      // Invalid payloads are protocol errors. Continue serving the session.
      fail(null, -32700, error?.message || "parse error");
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  tryParse();
});

process.stdin.on("end", () => {
  process.exit(0);
});
