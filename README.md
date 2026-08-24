# Holdline

Holdline is a five-stage incident response harness connected to TrueForge. It investigates alerts, collects evidence, proposes the smallest safe remediation, and stops at a hard approval gate before anything irreversible can run.

This repo includes:

- the Holdline app UI
- the local incident-monitoring MCP server
- an HTTP MCP bridge for TrueForge
- a persisted local connection panel for switching between local and TrueForge modes

## What it does

Holdline is designed to walk through:

1. Alert
2. Investigate
3. Diagnose
4. Propose
5. Approve

It ships with mock incident data for demo alerts and a custom-alert path that stays low-confidence instead of inventing telemetry.

## TrueForge integration

TrueForge can connect to the `incident-monitoring` MCP server through the HTTP bridge exposed by this repo:

- Health: `http://127.0.0.1:8000/health`
- MCP endpoint: `http://127.0.0.1:8000/mcp`

In TrueForge, configure the `incident-monitoring` connector as:

- transport: `streamable-http`
- URL: `http://127.0.0.1:8000/mcp`

Then open the `holdline` agent in the Agents Library and try it there.

## Local development

Install dependencies:

```bash
npm install
```

Run the Holdline app:

```bash
sh startup.sh
```

If you need to start the app manually, use:

```bash
npm run dev
```

Start the HTTP MCP bridge separately if needed:

```bash
npm run mcp:incident-monitoring:http
```

## Scripts

- `npm run dev` - start the Holdline app on port `8080`
- `npm run dev:local` - start the app on a random local port
- `npm run mcp:incident-monitoring` - start the stdio MCP server
- `npm run mcp:incident-monitoring:http` - start the HTTP MCP bridge on port `8000`
- `npm run typecheck` - run the TypeScript check
- `npm run build` - build the app

## Notes

- The HTTP bridge is local-only by default and uses `127.0.0.1:8000`.
- If you want to deploy this integration outside your machine, you will need to host the bridge at a public URL and point TrueForge at that URL instead of `localhost`.

