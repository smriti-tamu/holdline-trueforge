import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cleanupMcpSession,
  parseJsonRpcPayload,
  resolveIncidentMonitoringEndpoint,
  toolResultStatus,
} from "./mcp-connection.ts";
import { migrateHoldlinePersisted, statusLabel, statusTone } from "../store/holdline.ts";

describe("Holdline MCP parsing and validation", () => {
  it("marks tool results with isError as failed without losing their text", () => {
    const result = {
      content: [{ type: "text", text: "Tool execution failed for alert 42" }],
      isError: true,
    };

    assert.equal(toolResultStatus(result), "failed");
    assert.equal(result.content[0].text, "Tool execution failed for alert 42");
  });

  it("parses the final JSON-RPC payload from SSE content", () => {
    const payload = `event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"hello"}]}}\n\n`;
    const parsed = parseJsonRpcPayload(payload);

    assert.deepEqual(parsed, {
      jsonrpc: "2.0",
      id: 7,
      result: { content: [{ type: "text", text: "hello" }] },
    });
  });

  it("rejects non-allow-listed or remote incident-monitoring endpoints", () => {
    assert.throws(() => resolveIncidentMonitoringEndpoint("https://example.invalid/mcp"), /allow/i);
    assert.throws(() => resolveIncidentMonitoringEndpoint("http://0.0.0.0:8000/mcp"), /loopback|local/i);
  });

  it("sends an MCP DELETE to clean up the session after initialize", async () => {
    let called = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      called = true;
      assert.equal(init?.method, "DELETE");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("mcp-session-id"), "session-123");
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    try {
      await cleanupMcpSession("http://127.0.0.1:8000/mcp", "session-123");
      assert.equal(called, true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Holdline persistence and UI status", () => {
  it("migrates legacy scripted sessions to parked state without auto-continuing", () => {
    const migrated = migrateHoldlinePersisted({
      sessions: [
        {
          id: "legacy-1",
          status: "running",
          stage: 2,
          writeLock: "engaged",
          events: [],
        },
      ],
      activeId: "legacy-1",
      connection: { trueForgeUrl: "https://trueforge.example.com" },
    });

    assert.equal(migrated.sessions[0].status, "parked");
    assert.equal(migrated.sessions[0].writeLock, "engaged");
    assert.equal(migrated.activeId, null);
    assert.match(migrated.sessions[0].events[0].body ?? "", /restart.*live investigation/i);
  });

  it("renders failed sessions with the danger badge and investigation-failed label", () => {
    assert.equal(statusTone("failed"), "danger");
    assert.equal(statusLabel("failed"), "Investigation failed");
  });
});
