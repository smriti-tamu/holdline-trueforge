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
  async function callTool(name, args) {
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
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

  await callTool("get_alert", { alertId: checkoutAlert });
  const before = await callTool("query_metrics", { alertId: checkoutAlert });
  assert.match(before.result.content[0].text, /0\.3% -> 8\.7%/);

  const invalid = await callTool("rollback_deployment", {
    alertId: checkoutAlert,
    targetDeploy: "4c21",
  });
  assert.match(invalid.error.message, /only restore stable baseline 9e10/);

  const rollback = await callTool("rollback_deployment", {
    alertId: checkoutAlert,
    targetDeploy: "9e10",
  });
  assert.match(rollback.result.content[0].text, /simulated_success/);

  const afterMetrics = await callTool("query_metrics", { alertId: checkoutAlert });
  const afterLogs = await callTool("query_logs", { alertId: checkoutAlert });
  assert.match(afterMetrics.result.content[0].text, /8\.7% -> 0\.4%/);
  assert.match(afterMetrics.result.content[0].text, /812ms -> 340ms/);
  assert.match(afterLogs.result.content[0].text, /No new PaymentAdapter timeout errors/);
});
