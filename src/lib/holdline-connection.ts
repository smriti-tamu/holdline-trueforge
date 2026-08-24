export type McpTransport = "stdio" | "http";

export type HoldlineConnectionConfig = {
  profileName: string;
  modelProvider: string;
  modelName: string;
  mcpServerName: string;
  mcpTransport: McpTransport;
  mcpCommand: string;
  mcpArguments: string;
  mcpUrl: string;
  mcpAlertId: string;
  liveEnabled: boolean;
  notes: string;
  lastTestedAt?: number;
  lastTestSummary?: string;
};

export const DEFAULT_HOLDLINE_CONNECTION: HoldlineConnectionConfig = {
  profileName: "TrueForge / Holdline",
  modelProvider: "ollama",
  modelName: "qwen3-4b",
  mcpServerName: "incident-monitoring",
  mcpTransport: "stdio",
  mcpCommand: "node",
  mcpArguments: "mcp/incident-monitoring/server.mjs",
  mcpUrl: "",
  mcpAlertId:
    "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.",
  liveEnabled: false,
  notes:
    "This config is persisted locally so Holdline can be pointed at the local MCP harness or synced into TrueForge over HTTP.",
};
