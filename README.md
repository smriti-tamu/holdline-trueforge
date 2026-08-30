# Holdline

**Demo video:** _add the ~3-minute demo video link here before submitting_

Holdline is a seven-stage incident response harness connected to TrueForge, built for The Agent Harness Hackathon. It investigates alerts, collects evidence, proposes the smallest safe remediation, verifies recovery after action, and stops at a hard approval gate before anything irreversible can run.

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
6. Verify
7. Resolve

It ships with mock incident data for demo alerts and a custom-alert path that stays low-confidence instead of inventing telemetry.

The locked checkout path uses TrueForge dynamic subagents, sandbox execution, MCP tools, and two approval boundaries. A successful mock rollback changes the mock monitoring state so the agent must prove recovery with fresh metrics and logs before resolving the incident.

## Hackathon fit

Holdline is aimed at the hackathon themes of:

- real tools connected through MCP
- safe code or action execution through a harness
- a visible pause before irreversible actions
- a UI that shows what the agent is doing and waiting on

That makes it a strong fit for the Best Use of TrueForge and Best UI tracks.

## TrueForge integration

TrueForge can connect to the `incident-monitoring` MCP server through the HTTP bridge exposed by this repo:

- Health: `http://127.0.0.1:8000/health`
- MCP endpoint: `http://127.0.0.1:8000/mcp`

In TrueForge, configure the `incident-monitoring` connector as:

- transport: `streamable-http`
- URL: `http://127.0.0.1:8000/mcp`

Then open the `holdline` agent in the Agents Library and try it there.

The checked-in [`agent.json`](./agent.json) enables:

- the `openrouter/openrouter-free` model used by the demo environment
- TrueForge sandbox execution
- dynamic subagents
- a 100-iteration budget — the locked checkout path is `get_alert` + 3 subagents + `get_trace` + `search_tickets` + sandbox `exec` + propose + approval + rollback + verify; a lower budget can stop the run right after Allow and never reach Verify
- explicit approval for `rollback_deployment`

Holdline's connection panel upserts the agent by name, so re-syncing updates the existing `holdline` agent instead of creating a duplicate. **Always start a brand-new chat with the `holdline` agent after re-syncing** — an existing chat keeps whatever instructions and iteration budget were active when it started, not the freshly-synced ones.

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

Start TrueForge in another terminal:

```bash
npx @truefoundry/trueforge
```

TrueForge standalone mode includes a local sandbox fallback. For the hosted hackathon configuration, add Daytona under **Settings → Sandbox providers** and keep sandbox enabled in `agent.json`.

## Locked checkout demo

In TrueForge, open a completely new chat with the `holdline` agent and send:

```text
Investigate this checkout incident:

Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.
```

Expected behavior:

1. `get_alert` runs first and preserves the exact alert string.
2. `MetricsQuerier`, `LogAnalyst`, and `DiffInspector` run as dynamic subagents.
3. The parent agent calls `get_trace` and `search_tickets`.
4. TrueForge sandbox `exec` runs a read-only correlation script.
5. The diagnosis includes root cause, tool-supported evidence, confidence, and reason for confidence.
6. The agent proposes rolling back `4c21` to `9e10` and stops.
7. Ask `What exactly will you verify after the rollback?`; the answer must make zero tool calls.
8. Reply `approve`; TrueForge must still display its separate **Allow / Deny** tool gate.
9. Allow the simulated rollback.
10. The agent re-runs metrics and logs, observes error rate `8.7% → 0.4%`, p99 `812ms → 340ms`, and no new timeout errors, then resolves.

The rollback is simulated. No production system is changed.

## Safety contract

- Monitoring tools are read-only and can run during investigation.
- `rollback_deployment` is marked destructive and requires TrueForge approval.
- Questions, silence, and clarification requests are not approval.
- Sandbox code cannot call the destructive rollback tool.
- The mock rollback accepts only the exact checkout alert and target `9e10`.
- A successful action does not prove recovery; post-action metrics and logs must improve before resolution.

## Scripts

- `npm run dev` - start the Holdline app on port `8080`
- `npm run dev:local` - start the app on a random local port
- `npm run mcp:incident-monitoring` - start the stdio MCP server
- `npm run mcp:incident-monitoring:http` - start the HTTP MCP bridge on port `8000`
- `npm run typecheck` - run the TypeScript check
- `npm run build` - build the app
- `npm test` - run the repository test suite

## Verification

Before opening a pull request, run:

```bash
node --test scripts/agent-manifest.test.mjs scripts/incident-monitoring-http.test.mjs scripts/incident-playbooks.test.mjs
npm run typecheck
npm run build
```

The regression tests protect the TrueForge harness configuration, approval policy, exact rollback contract, post-action recovery evidence, and HTTP MCP session isolation.

## Qodo Code Review Evidence

- Pull request: [#2 Complete TrueForge incident recovery flow](https://github.com/smriti-tamu/holdline-trueforge/pull/2)
- Initial Qodo findings: three high-priority bugs covering process-global recovery state, `RECOVERING` incidents being closed, and generic `NOT RECOVERED` incidents being closed.
- Fixes made: recovery state is isolated by MCP session ID and covered by a two-client regression test; catalogued playbooks now report `RECOVERED` only when their fixed verification evidence meets the recovery contract; generic incidents remain open in a resumable `parked` state at Stage 6 with the write lock engaged.
- Dismissed findings and rationale: none. Qodo's optional transport-neutral MCP core refactor is recorded as future hardening because it was an architectural recommendation rather than one of the three reported bugs.
- Follow-up review: [Qodo confirmed all three tracked issues are addressed](https://github.com/smriti-tamu/holdline-trueforge/pull/2#issuecomment-5446752889) on corrective commit `18919d0`; no new finding was reported.

---

- Pull request: [#4 Enforce MCP tool schemas, tolerate alertId drift, and stop rollback hallucination](https://github.com/smriti-tamu/holdline-trueforge/pull/4)
- Initial Qodo findings: two high-priority bugs on the first commit's schema-validation and rollback-matching fix — [(1) type checking was missing](https://github.com/smriti-tamu/holdline-trueforge/pull/4#issuecomment-5466324201), so a present-but-wrong-typed field such as a numeric or `null` `alertId` passed the key-only check and was silently coerced to an empty string by `resolveAlert()`, degrading to the same generic "no matching records" response the fix existed to prevent; (2) the rollback's new tolerant alertId matching (case/whitespace/trailing-punctuation drift) wasn't mirrored in the post-rollback recovery checks, so a rollback accepted with drifted alert text couldn't be verified with that same text — `query_metrics`/`query_logs` would fall through to the stale pre-rollback data instead of showing the recovery actually happened.
- Fixes made (commit `5a42f78`): `validateArguments()` now checks each provided field's runtime type against its declared schema type and rejects mismatches — including `null`, whose `typeof` is `"object"` and would otherwise slip past a naive check — naming the expected type in the error; the `get_alert`/`query_metrics`/`query_logs` recovery-state checks now use the same normalized comparison as the rollback acceptance check, so all four agree with each other regardless of the exact alertId text a caller used.
- Dismissed findings and rationale: none — both reported bugs were fixed.
- Follow-up review: requested explicitly via `/agentic_review` after merge, since the fix commit (`5a42f78`) landed shortly before merge and Qodo had not yet re-run automatically. [Qodo confirmed both findings resolved](https://github.com/smriti-tamu/holdline-trueforge/pull/4#issuecomment-5466324201) against that commit, and reported one new high-priority finding: the prompt let the agent propose an evidence-backed rollback for any catalogued alert (e.g. the auth-library CVE), but `rollback_deployment` only accepts the exact checkout alert and target `9e10` — an approved non-checkout rollback would reach the only mutation tool and be rejected instead of completing. Fixed in the same follow-up pass: the prompt now states plainly that execution is only wired up for the checkout alert, and to propose-and-stop for anything else rather than attempt a call that will fail. Both findings were additionally verified directly — replayed against the running MCP bridge with the exact payloads Qodo's findings described — and are covered by new regression tests in `scripts/incident-monitoring-http.test.mjs`, `scripts/agent-manifest.test.mjs`, and `src/lib/incident/prompt.test.ts`.

## Troubleshooting

- **Ports:** Holdline app `8080` (or a random port via `npm run dev:local`), HTTP MCP bridge `8000`, TrueForge itself `8790`.
- **Always open a new chat after syncing.** An existing TrueForge chat keeps whatever `agent.json`/prompt state was active when that chat started — re-syncing only affects chats created afterward.
- **The rollback is simulated.** `rollback_deployment` never touches a real system; "recovery" is the mock server switching to canned post-rollback metrics/logs for the same session.
- **Free-tier model rate limits:** `openrouter/openrouter-free` has a daily cap. If a run fails with a `429`, either wait for the daily reset or switch the agent to a different configured model provider for that run.
- **Weak models can skip sandbox exec or subagents** despite the `MUST` instructions. If a rehearsal comes back serial or without the sandbox correlation step, retry once — the prompt is explicit about the exact-three-subagents and sandbox-before-diagnose requirements, but a weaker model doesn't always follow instructions reliably on the first attempt.

## Notes

- The HTTP bridge is local-only by default and uses `127.0.0.1:8000`.
- If you want to deploy this integration outside your machine, you will need to host the bridge at a public URL and point TrueForge at that URL instead of `localhost`.
- Code review is part of the build: substantive changes should land via GitHub pull request and be reviewed by Qodo before merge.
- TrueForge runs the agent; Holdline is the incident desk and local MCP server. The desk's own session history (Zustand/localStorage) is separate, local-only persistence — it is not the TrueForge chat thread, and clicking through the desk does not drive the TrueForge agent.
