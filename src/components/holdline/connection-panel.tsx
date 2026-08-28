import { useEffect, useMemo, useState } from "react";
import { Plug, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_HOLDLINE_CONNECTION, type HoldlineConnectionConfig } from "@/lib/holdline-connection";
import { syncTrueForgeAgent, testMcpConnection } from "@/lib/mcp-connection";
import { useHoldline } from "@/store/holdline";
import { formatClock } from "@/lib/utils";

export function ConnectionPanel() {
  const connection = useHoldline((s) => s.connection);
  const updateConnection = useHoldline((s) => s.updateConnection);
  const resetConnection = useHoldline((s) => s.resetConnection);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HoldlineConnectionConfig>(connection);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(connection.lastTestSummary ?? null);

  useEffect(() => {
    if (open) {
      setDraft(connection);
      setTestMessage(connection.lastTestSummary ?? null);
    }
  }, [connection, open]);

  const summary = useMemo(() => {
    const updated =
      connection.lastTestedAt != null ? ` · tested ${formatClock(connection.lastTestedAt)}` : "";
    return `${draft.modelProvider} / ${draft.modelName} · ${draft.mcpServerName} · live MCP evidence${updated}`;
  }, [connection.lastTestedAt, draft.mcpServerName, draft.modelName, draft.modelProvider]);

  async function runTest() {
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await testMcpConnection({
        data: {
          transport: draft.mcpTransport,
          command: draft.mcpCommand,
          argumentsText: draft.mcpArguments,
          alertId: draft.mcpAlertId,
          serverName: draft.mcpServerName,
          url: "http://127.0.0.1:8000/mcp",
        },
      });
      if (result.ok) {
        const message = `Connected to ${result.serverInfo?.name ?? draft.mcpServerName} with ${result.tools?.length ?? 0} tools.`;
        setTestMessage(message);
        updateConnection({
          ...draft,
          lastTestedAt: Date.now(),
          lastTestSummary: message,
        });
      } else {
        const message = result.errorMessage ?? "Connection failed.";
        setTestMessage(message);
        updateConnection({
          ...draft,
          lastTestedAt: Date.now(),
          lastTestSummary: message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestMessage(message);
      updateConnection({
        ...draft,
        lastTestedAt: Date.now(),
        lastTestSummary: message,
      });
    } finally {
      setTesting(false);
    }
  }

  async function runSyncToTrueForge() {
    setSyncing(true);
    setTestMessage(null);
    try {
      const result = await syncTrueForgeAgent({
        data: {
          url: draft.trueForgeUrl,
          agentName: draft.profileName,
        },
      });
      if (result.ok) {
        const message = `Synced ${result.agentName ?? draft.profileName} to TrueForge at ${draft.trueForgeUrl.trim() || "the configured URL"}.`;
        setTestMessage(message);
        updateConnection({
          ...draft,
          lastTestedAt: Date.now(),
          lastTestSummary: message,
        });
      } else {
        const message = result.errorMessage ?? "TrueForge sync failed.";
        setTestMessage(message);
        updateConnection({
          ...draft,
          lastTestedAt: Date.now(),
          lastTestSummary: message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTestMessage(message);
      updateConnection({
        ...draft,
        lastTestedAt: Date.now(),
        lastTestSummary: message,
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="rounded-lg bg-elevated p-4 shadow-[var(--shadow-border)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs tracking-wide text-muted uppercase">Connections</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Holdline uses the local incident-monitoring bridge for read-only investigation evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-subtle px-3 text-xs text-fg">
            <Plug className="size-3.5 text-faint" />
            {summary}
          </span>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Configure
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-sm bg-subtle p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">Model</p>
          <p className="mt-1 text-sm text-fg">{connection.modelProvider} / {connection.modelName}</p>
        </div>
        <div className="rounded-sm bg-subtle p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">MCP Server</p>
          <p className="mt-1 text-sm text-fg">{connection.mcpServerName}</p>
        </div>
        <div className="rounded-sm bg-subtle p-3">
          <p className="text-[11px] uppercase tracking-wide text-faint">Mode</p>
          <p className="mt-1 text-sm text-fg">Live bridge</p>
        </div>
      </div>

      {testMessage ? (
        <div className="mt-3 rounded-sm bg-subtle px-3 py-2 text-sm text-muted">
          <span className="font-medium text-fg">Latest test:</span> {testMessage}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(100%-1rem,46rem)]">
          <DialogTitle>Connections</DialogTitle>
          <DialogDescription>
            Update the local Holdline profile and optional TrueForge sync target.
          </DialogDescription>

          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>Profile</span>
                <Input
                  value={draft.profileName}
                  onChange={(e) => setDraft((cur) => ({ ...cur, profileName: e.target.value }))}
                  placeholder="Holdline"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>Model Provider</span>
                <Input
                  value={draft.modelProvider}
                  onChange={(e) => setDraft((cur) => ({ ...cur, modelProvider: e.target.value }))}
                  placeholder="openrouter"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>Model Name</span>
                <Input
                  value={draft.modelName}
                  onChange={(e) => setDraft((cur) => ({ ...cur, modelName: e.target.value }))}
                  placeholder="openrouter-free"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>Transport</span>
                <div className="flex h-11 items-center rounded-sm border border-border bg-subtle px-3 text-sm text-fg shadow-[var(--shadow-border)]">
                  HTTP local bridge
                </div>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>MCP Server Name</span>
                <Input
                  value={draft.mcpServerName}
                  onChange={(e) => setDraft((cur) => ({ ...cur, mcpServerName: e.target.value }))}
                  placeholder="incident-monitoring"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>TrueForge URL</span>
                <Input
                  value={draft.trueForgeUrl}
                  onChange={(e) => setDraft((cur) => ({ ...cur, trueForgeUrl: e.target.value }))}
                  placeholder="https://trueforge.example.com"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>Alert text for MCP test</span>
                <Input
                  value={draft.mcpAlertId}
                  onChange={(e) => setDraft((cur) => ({ ...cur, mcpAlertId: e.target.value }))}
                  placeholder="Describe the alert to investigate"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs tracking-wide text-muted uppercase">
                <span>Notes</span>
                <Input
                  value={draft.notes}
                  onChange={(e) => setDraft((cur) => ({ ...cur, notes: e.target.value }))}
                  placeholder="Any investigation notes"
                />
              </label>
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = { ...DEFAULT_HOLDLINE_CONNECTION };
                  setDraft(next);
                  resetConnection();
                  setTestMessage(null);
                }}
              >
                <RotateCcw className="mr-2 size-4" />
                Reset
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={runTest}
                disabled={testing || !draft.mcpServerName.trim()}
              >
                <ShieldCheck className="mr-2 size-4" />
                {testing ? "Testing…" : "Test MCP connection"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={runSyncToTrueForge}
                disabled={syncing || !draft.trueForgeUrl.trim() || !draft.profileName.trim()}
              >
                <ShieldCheck className="mr-2 size-4" />
                {syncing ? "Syncing…" : "Sync to TrueForge"}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button
                type="button"
                onClick={() => {
                  updateConnection(draft);
                  setOpen(false);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
