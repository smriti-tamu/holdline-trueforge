import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import test from "node:test";

const checkoutAlert =
  "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.";

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError ?? new Error("HTTP MCP bridge did not become healthy");
}

test("checkout rollback exposes tool-supported recovery evidence", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["mcp/incident-monitoring/http.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/health`);

  let requestId = 0;
  async function createClient() {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (requestId += 1),
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    assert.equal(response.status, 200);
    const sessionId = response.headers.get("mcp-session-id");
    assert.ok(sessionId);
    return sessionId;
  }

  async function callTool(sessionId, name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (requestId += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return response.json();
  }

  const firstSession = await createClient();
  const secondSession = await createClient();

  await callTool(firstSession, "get_alert", { alertId: checkoutAlert });
  await callTool(secondSession, "get_alert", { alertId: checkoutAlert });
  const before = await callTool(firstSession, "query_metrics", { alertId: checkoutAlert });
  assert.match(before.result.content[0].text, /0\.3% -> 8\.7%/);

  const invalid = await callTool(firstSession, "rollback_deployment", {
    alertId: checkoutAlert,
    targetDeploy: "4c21",
  });
  assert.match(invalid.error.message, /only restore stable baseline 9e10/);

  const rollback = await callTool(firstSession, "rollback_deployment", {
    alertId: checkoutAlert,
    targetDeploy: "9e10",
  });
  assert.match(rollback.result.content[0].text, /simulated_success/);

  const afterMetrics = await callTool(firstSession, "query_metrics", { alertId: checkoutAlert });
  const afterLogs = await callTool(firstSession, "query_logs", { alertId: checkoutAlert });
  assert.match(afterMetrics.result.content[0].text, /8\.7% -> 0\.4%/);
  assert.match(afterMetrics.result.content[0].text, /812ms -> 340ms/);
  assert.match(afterLogs.result.content[0].text, /No new PaymentAdapter timeout errors/);

  const isolatedMetrics = await callTool(secondSession, "query_metrics", {
    alertId: checkoutAlert,
  });
  assert.match(isolatedMetrics.result.content[0].text, /0\.3% -> 8\.7%/);
  assert.doesNotMatch(isolatedMetrics.result.content[0].text, /8\.7% -> 0\.4%/);
});

// Regression test for a real TrueForge run: a subagent guessed { baseline_id,
// deploy_id, region } for list_deploys instead of the tool's actual schema
// ({ alertId, service }). The server silently fell back to the low-confidence
// "no matching records" path instead of rejecting the malformed call, so the
// agent read that as "this deploy doesn't exist" and gave up rather than
// retrying with the right shape. Every tool already declares a real
// inputSchema (required fields, additionalProperties: false) — it just isn't
// enforced before callTool() runs.
test("a tool call with the wrong argument shape is rejected, not silently degraded", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["mcp/incident-monitoring/http.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/health`);

  let requestId = 0;
  const initResponse = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: (requestId += 1),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
  });
  const sessionId = initResponse.headers.get("mcp-session-id");
  assert.ok(sessionId);

  async function callTool(name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (requestId += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return response.json();
  }

  // Real reproduction: the exact wrong arguments a subagent sent for list_deploys.
  const malformed = await callTool("list_deploys", {
    baseline_id: "9e10",
    deploy_id: "4c21",
    region: "us-east-1",
  });
  assert.ok(
    malformed.error,
    "a call missing the required 'alertId' (and carrying unknown keys) must come back as a JSON-RPC " +
      "error, not a normal result the caller can mistake for 'no deploys found'",
  );
  assert.match(malformed.error.message, /alertId/);
  assert.match(malformed.error.message, /baseline_id/);

  // Missing the required field entirely, no unknown keys involved.
  const missingRequired = await callTool("query_metrics", {});
  assert.ok(missingRequired.error);
  assert.match(missingRequired.error.message, /alertId/);

  // The correct shape must still work.
  const valid = await callTool("list_deploys", { alertId: checkoutAlert });
  assert.equal(valid.error, undefined);
  assert.match(valid.result.content[0].text, /9e10  stable baseline/);
});

// Regression test for a Qodo review finding on the schema-validation fix
// above: validateArguments() checked key presence but never value type, so
// { alertId: 123 } (or null) passed validation — every key required, no
// unexpected keys — and then resolveAlert()'s `typeof input?.alertId ===
// "string" ? ... : ""` silently coerced the non-string value to "", which
// degrades to the exact same normal-looking "no matching records" response
// the schema check exists to prevent, just reached through a wrong-typed
// value instead of a wrong-named key.
test("a tool call with a present but wrong-typed field is rejected, not silently coerced", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["mcp/incident-monitoring/http.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/health`);

  let requestId = 0;
  const initResponse = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: (requestId += 1),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
  });
  const sessionId = initResponse.headers.get("mcp-session-id");
  assert.ok(sessionId);

  async function callTool(name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (requestId += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return response.json();
  }

  const numericAlertId = await callTool("query_metrics", { alertId: 123 });
  assert.ok(numericAlertId.error, "a number where a string is required must be rejected");
  assert.match(numericAlertId.error.message, /alertId.*must be string/i);
  assert.match(numericAlertId.error.message, /got number/i);

  const nullAlertId = await callTool("query_metrics", { alertId: null });
  assert.ok(nullAlertId.error, "null must be rejected, not treated as the string type it isn't");
  assert.match(nullAlertId.error.message, /got null/i);

  const validString = await callTool("query_metrics", { alertId: checkoutAlert });
  assert.equal(validString.error, undefined);
});

// Regression test for a second failure mode seen in the same live run: the
// model reproduced the alert text from memory (not a copy-paste) and dropped
// the trailing period. The exact-string check rejected it, and the model
// then misread the rejection's prose as if it were itself the expected
// alertId and retried with that short phrase instead — a second, unrelated
// rejection. rollback_deployment should tolerate the kind of drift a model
// naturally introduces (case, whitespace, a missing trailing period) while
// still rejecting a materially different alertId, and its error should quote
// the exact string a retry needs rather than describing it in prose.
test("rollback_deployment tolerates trivial text drift but still rejects the wrong alert", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["mcp/incident-monitoring/http.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/health`);

  let requestId = 0;
  const initResponse = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: (requestId += 1),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
  });
  const sessionId = initResponse.headers.get("mcp-session-id");
  assert.ok(sessionId);

  async function callTool(name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (requestId += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return response.json();
  }

  // The exact live failure: alert text verbatim minus the trailing period.
  const droppedPeriod = checkoutAlert.replace(/\.$/, "");
  const almostExact = await callTool("rollback_deployment", {
    alertId: droppedPeriod,
    targetDeploy: "9e10",
  });
  assert.equal(almostExact.error, undefined, "a dropped trailing period must not hard-reject");
  assert.match(almostExact.result.content[0].text, /simulated_success/);

  // A genuinely different alertId — the short phrase the model mistakenly
  // retried with after misreading the previous error's prose — must still
  // be rejected, and the error must quote the real expected string.
  const wrongAlert = await callTool("rollback_deployment", {
    alertId: "checkout alert for deploy 4c21",
    targetDeploy: "9e10",
  });
  assert.ok(wrongAlert.error);
  assert.match(wrongAlert.error.message, new RegExp(checkoutAlert.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// Regression test for a second Qodo review finding, on the same trivial-drift
// fix: rollback_deployment's acceptance check became tolerant of drift
// (case/whitespace/trailing punctuation), but query_metrics/query_logs's
// "was this alert's checkout just rolled back" check still used strict `===`
// against the canonical alert text. A caller that gets its drifted alertId
// accepted by rollback_deployment and then reuses that *same* drifted text to
// verify recovery would fall through to the pre-rollback branch — a
// genuinely successful remediation reads as if nothing happened, right at
// the "prove recovery before resolving" check the whole safety design
// depends on.
test("verifying recovery with the same drifted alertId that rollback accepted still sees the recovered state", async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ["mcp/incident-monitoring/http.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  t.after(() => child.kill());

  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(`${base}/health`);

  let requestId = 0;
  const initResponse = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: (requestId += 1),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
  });
  const sessionId = initResponse.headers.get("mcp-session-id");
  assert.ok(sessionId);

  async function callTool(name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: (requestId += 1),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return response.json();
  }

  const droppedPeriod = checkoutAlert.replace(/\.$/, "");

  const rollback = await callTool("rollback_deployment", {
    alertId: droppedPeriod,
    targetDeploy: "9e10",
  });
  assert.equal(rollback.error, undefined);
  assert.match(rollback.result.content[0].text, /simulated_success/);

  // Verify with the exact same drifted text the rollback call used — this
  // must see the recovered/post-rollback data, not the original pre-rollback
  // scenario data.
  const metrics = await callTool("query_metrics", { alertId: droppedPeriod });
  assert.match(metrics.result.content[0].text, /8\.7% -> 0\.4%/);
  assert.doesNotMatch(metrics.result.content[0].text, /0\.3% -> 8\.7%/);

  const logs = await callTool("query_logs", { alertId: droppedPeriod });
  assert.match(logs.result.content[0].text, /No new PaymentAdapter timeout errors/);
});
