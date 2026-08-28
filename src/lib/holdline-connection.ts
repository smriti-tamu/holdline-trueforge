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
  trueForgeUrl: string;
  mcpAlertId: string;
  liveEnabled: boolean;
  notes: string;
  lastTestedAt?: number;
  lastTestSummary?: string;
};

export const DEFAULT_HOLDLINE_CONNECTION: HoldlineConnectionConfig = {
  profileName: "Holdline",
  modelProvider: "openrouter",
  modelName: "openrouter-free",
  mcpServerName: "incident-monitoring",
  mcpTransport: "http",
  mcpCommand: "node",
  mcpArguments: "mcp/incident-monitoring/server.mjs",
  mcpUrl: "http://127.0.0.1:8000/mcp",
  trueForgeUrl: "http://localhost:8790",
  mcpAlertId:
    "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.",
  liveEnabled: true,
  notes:
    "Holdline reads live mock evidence from the local MCP bridge. TrueForge remains the separate approval-gated action harness.",
};