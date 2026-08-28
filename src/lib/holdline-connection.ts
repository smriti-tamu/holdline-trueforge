export type McpTransport = "http";

export type HoldlineConnectionConfig = {
  profileName: string;
  modelProvider: string;
  modelName: string;
  mcpServerName: string;
  mcpTransport: McpTransport;
  mcpCommand: string;
  mcpArguments: string;
  trueForgeUrl: string;
  mcpAlertId: string;
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
  trueForgeUrl: "https://trueforge.example.com",
  mcpAlertId:
    "Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.",
  notes:
    "Holdline reads live mock evidence from the local incident-monitoring bridge. TrueForge remains the separate approval-gated action harness.",
};