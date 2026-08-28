import { createServerFn } from "@tanstack/react-start";
import { HOLDLINE_SYSTEM_PROMPT } from "@/lib/incident/prompt";

export type McpConnectionTestInput = {
  transport: "stdio" | "http";
  command: string;
  argumentsText: string;
  alertId: string;
  serverName: string;
  url: string;
};

export type McpConnectionTestResult = {
  ok: boolean;
  serverInfo?: { name?: string; version?: string };
  tools?: string[];
  alertText?: string;
  errorMessage?: string;
};

export type TrueForgeSyncInput = {
  url: string;
  agentName: string;
};

export type TrueForgeSyncResult = {
  ok: boolean;
  created?: boolean;
  agentName?: string;
  errorMessage?: string;
};

function splitArguments(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) ?? [];
}

function parseMessageBuffer(buffer: string) {
  const messages: unknown[] = [];
  let remaining = buffer;
  while (true) {
    const headerEnd = remaining.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const headerText = remaining.slice(0, headerEnd);
    const lengthMatch = headerText.match(/content-length:\s*(\d+)/i);
    if (!lengthMatch) {
      remaining = remaining.slice(headerEnd + 4);
      continue;
    }
    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (remaining.length < bodyEnd) break;
    const body = remaining.slice(bodyStart, bodyEnd);
    try {
      messages.push(JSON.parse(body));
    } catch {
      messages.push({ error: "parse_error", body });
    }
    remaining = remaining.slice(bodyEnd);
  }
  return { messages, remaining };
}

async function runMcpHandshake(input: McpConnectionTestInput): Promise<McpConnectionTestResult> {
  if (input.transport === "http") {
    return runRemoteHttpHandshake(input);
  }

  const { spawn } = await import("node:child_process");
  const { Buffer } = await import("node:buffer");

  const command = input.command.trim();
  if (!command) {
    return { ok: false, errorMessage: "MCP command is required." };
  }

  const args = splitArguments(input.argumentsText);
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let buffer = "";
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();

  const complete = async (result: McpConnectionTestResult) => {
    child.kill();
    return result;
  };

  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    });

  const notify = (method: string, params: unknown) => {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  };

  const flush = () => {
    const parsed = parseMessageBuffer(buffer);
    buffer = parsed.remaining;
    for (const message of parsed.messages) {
      if (!message || typeof message !== "object") continue;
      const msg = message as { id?: number; result?: unknown; error?: { message?: string }; method?: string };
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(msg.error.message || "MCP error"));
        } else {
          entry.resolve(msg.result);
        }
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    flush();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const timeout = (label: string) =>
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), 8000);
    });

  try {
    const init = (await Promise.race([
      request("initialize", {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "holdline", version: "1.0.0" },
        capabilities: { tools: {} },
      }),
      timeout("initialize"),
    ])) as { serverInfo?: { name?: string; version?: string } };

    notify("notifications/initialized", {});

    const toolsResult = (await Promise.race([
      request("tools/list", {}),
      timeout("tools/list"),
    ])) as { tools?: Array<{ name?: string }> };

    const alertResult = (await Promise.race([
      request("tools/call", {
        name: "get_alert",
        arguments: { alertId: input.alertId },
      }),
      timeout("get_alert"),
    ])) as { content?: Array<{ type?: string; text?: string }> };

    const alertText = alertResult.content?.find((part) => part.type === "text")?.text;
    return complete({
      ok: true,
      serverInfo: init.serverInfo,
      tools: toolsResult.tools?.map((tool) => tool.name).filter(Boolean) as string[] | undefined,
      alertText,
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : typeof error === "string" ? error : "MCP connection failed";
    return complete({
      ok: false,
      errorMessage: stderr ? `${reason}\n\nstderr:\n${stderr.trim()}` : reason,
    });
  }
}

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { message?: string };
};

function parseJsonRpcResponse(text: string): JsonRpcResponse | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as JsonRpcResponse;
  } catch {
    return null;
  }
}

async function runRemoteHttpHandshake(
  input: McpConnectionTestInput,
): Promise<McpConnectionTestResult> {
  const endpoint = input.url.trim();
  if (!endpoint) {
    return { ok: false, errorMessage: "MCP URL is required when transport is http." };
  }

  let sessionId: string | null = null;
  const protocolVersion = "2025-03-26";
  const headersBase: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
  };

  async function postJsonRpc(
    payload: unknown,
    expectResponse = true,
  ): Promise<{ response: JsonRpcResponse | null; status: number; text: string }> {
    const headers: Record<string, string> = { ...headersBase };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const nextSessionId = res.headers.get("mcp-session-id")?.trim();
      if (nextSessionId) sessionId = nextSessionId;
      const text = await res.text();
      const response = parseJsonRpcResponse(text);
      if (expectResponse && !response && res.status >= 400) {
        throw new Error(text || `HTTP ${res.status}`);
      }
      return { response, status: res.status, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const init = await postJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          clientInfo: { name: "holdline", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      },
      true,
    );

    if (!init.response?.result) {
      return { ok: false, errorMessage: init.response?.error?.message ?? init.text ?? "initialize failed" };
    }

    await postJsonRpc(
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      false,
    );

    const tools = await postJsonRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      true,
    );
    const toolsResult = tools.response?.result as
      | { tools?: Array<{ name?: string }> }
      | undefined;

    const alert = await postJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_alert",
          arguments: { alertId: input.alertId },
        },
      },
      true,
    );
    const alertResult = alert.response?.result as
      | { content?: Array<{ type?: string; text?: string }> }
      | undefined;

    const alertText = alertResult?.content?.find((part) => part.type === "text")?.text;
    return {
      ok: true,
      serverInfo: {
        name: input.serverName,
      },
      tools: toolsResult?.tools?.map((tool) => tool.name).filter(Boolean) as string[] | undefined,
      alertText,
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadAgentManifest() {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const manifestPath = resolve(process.cwd(), "agent.json");
  const text = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(text) as { manifest?: unknown } | unknown;
  if (parsed && typeof parsed === "object" && "manifest" in parsed) {
    return (parsed as { manifest: unknown }).manifest;
  }
  return parsed;
}

async function loadTrueForgeManifest() {
  const base = await loadAgentManifest();
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    return {
      model: {
        name: "openrouter/openrouter-free",
        params: { temperature: 0.1 },
      },
      instructions: HOLDLINE_SYSTEM_PROMPT,
      mcp_servers: [
        {
          name: "incident-monitoring",
          enable_tools: ["@all"],
          require_approval_for_tools: ["rollback_deployment"],
          preload: true,
        },
      ],
      config: {
        sandbox: { enabled: true },
        generative_ui: { enabled: true },
        ask_user_questions: { enabled: true },
        dynamic_sub_agents: { enabled: true },
        iteration_limit: 40,
      },
    };
  }
  return {
    ...(base as Record<string, unknown>),
    instructions: HOLDLINE_SYSTEM_PROMPT,
  };
}

function normalizeAgentName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.includes("holdline")) return "holdline";
  return slug || "holdline";
}

async function runTrueForgeSync(input: TrueForgeSyncInput): Promise<TrueForgeSyncResult> {
  const base = input.url.trim().replace(/\/+$/, "");
  if (!base) {
    return { ok: false, errorMessage: "TrueForge URL is required." };
  }

  try {
    const manifest = await loadTrueForgeManifest();
    const agentName = normalizeAgentName(input.agentName);
    const listRes = await fetch(`${base}/api/v1/agents`, {
      headers: { accept: "application/json" },
    });
    const listText = await listRes.text();
    if (!listRes.ok) {
      return { ok: false, errorMessage: listText || `HTTP ${listRes.status}` };
    }

    const list = JSON.parse(listText) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    const existing = list.data?.find((agent) => agent.name === agentName);
    const endpoint = existing?.id
      ? `${base}/api/v1/agents/${encodeURIComponent(existing.id)}`
      : `${base}/api/v1/agents`;
    const res = await fetch(endpoint, {
      method: existing?.id ? "PUT" : "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(existing?.id ? { manifest } : { name: agentName, manifest }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, errorMessage: text || `HTTP ${res.status}` };
    }
    return { ok: true, created: !existing?.id, agentName };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export const testMcpConnection = createServerFn({ method: "POST" })
  .validator((input: McpConnectionTestInput) => input)
  .handler(async ({ data }) => runMcpHandshake(data));

export const syncTrueForgeAgent = createServerFn({ method: "POST" })
  .validator((input: TrueForgeSyncInput) => input)
  .handler(async ({ data }) => runTrueForgeSync(data));
