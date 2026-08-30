import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../agent.json", import.meta.url);

async function readManifest() {
  const document = JSON.parse(await readFile(manifestUrl, "utf8"));
  return document.manifest;
}

test("Holdline enables the required TrueForge harness controls", async () => {
  const manifest = await readManifest();
  const monitoring = manifest.mcp_servers.find(
    (server) => server.name === "incident-monitoring",
  );

  assert.equal(manifest.model.name, "openrouter/openrouter-free");
  assert.equal(manifest.config.sandbox.enabled, true);
  assert.equal(manifest.config.dynamic_sub_agents.enabled, true);
  // The locked checkout path is get_alert + 3 subagents + trace + tickets +
  // sandbox + propose + approval + rollback + verify — 40 could stop the
  // turn after Allow and never reach Verify. Guard the raised budget (100)
  // with headroom below it, rather than pinning the exact number, so a
  // deliberate future retune doesn't need to touch this test.
  assert.ok(manifest.config.iteration_limit >= 80);
  assert.deepEqual(monitoring.require_approval_for_tools, [
    "rollback_deployment",
  ]);
});

test("Holdline manifest preserves the locked checkout safety path", async () => {
  const { instructions } = await readManifest();

  assert.match(instructions, /Call get_alert first/i);
  assert.match(instructions, /MUST call create_sub_agent/);
  assert.match(instructions, /MUST call the sandbox exec tool/);
  assert.match(instructions, /sandbox code is read-only/i);
  assert.match(instructions, /requests for clarification, and silence as no approval/i);
  assert.match(instructions, /bad deploy 4c21 to stable baseline 9e10/i);
  assert.match(
    instructions,
    /enter RESOLVE only when post-action read tools show that errors and latency improved/i,
  );
  assert.match(instructions, /mark NOT RECOVERED, keep the incident UNRESOLVED/i);
});

// Regression test for a live run where the model treated the checkout-only
// deploy 4c21 / baseline 9e10 rollback as universal: given an unrelated
// alert with no data in the mock catalog, it retried get_alert/query_metrics
// with guessed alertIds like "checkout" instead of accepting the empty
// result, matched the catalog's substring search by accident, and presented
// the checkout scenario's telemetry as the diagnosis for a different
// incident — asking to roll back 4c21 for a problem that had nothing to do
// with it. The instructions must make the alert-substitution explicitly
// wrong and scope the 4c21/9e10 remediation to the actual checkout alert
// text, not just describe it as "the locked checkout demo" with no test for
// which incident that is.
test("Holdline manifest scopes the checkout rollback to the actual alert and forbids alertId substitution", async () => {
  const { instructions } = await readManifest();

  assert.match(instructions, /never substitute a different alertId/i);
  assert.match(instructions, /not a reason to retry with a different alertId/i);
  assert.match(instructions, /do not borrow another alert's evidence/i);
  assert.match(instructions, /no usable evidence for this specific alert.*low confidence/i);
  // The 4c21/9e10 remediation must be conditioned on the literal checkout
  // alert text, not asserted as a standing fact independent of which alert
  // is under investigation.
  assert.match(
    instructions,
    /Only for the exact checkout alert text.*is rollback_deployment itself wired up in this mock/i,
  );
  assert.match(instructions, /never be 4c21\/9e10/i);
});

// Regression test for a Qodo review finding on the previous fix: the prompt
// told the agent it was fine to propose an evidence-backed rollback target
// for ANY catalogued alert (e.g. the auth-library CVE, which has real deploy
// evidence), but rollback_deployment only accepts the exact checkout alertId
// and target 9e10 — an approved non-checkout rollback would reach the only
// mutation tool and be rejected instead of completing. The instructions must
// say plainly that execution isn't available outside the checkout alert,
// not just that the proposal should come from the alert's own evidence.
test("Holdline manifest does not let the agent attempt a rollback the mock can't execute", async () => {
  const { instructions } = await readManifest();

  assert.match(instructions, /this mock only implements execution for the checkout alert/i);
  assert.match(instructions, /the tool will reject any other alertId or target/i);
  assert.match(instructions, /stop after proposing instead of attempting a call that will fail/i);
});

// The agent.json <-> HOLDLINE_SYSTEM_PROMPT verbatim-copy check lives in
// prompt.test.ts instead of here: it needs to import prompt.ts, and this
// file runs under the plain `scripts/**/*.test.mjs` group (no TypeScript
// stripping), while prompt.test.ts already runs with
// --experimental-strip-types alongside the other .ts test files.

// Regression test for backlog item 4: a live run where subagents stayed
// serial or got skipped needed the instruction tightened to be unambiguous
// about exactly three calls, before anything else, blocking diagnosis.
test("Holdline manifest requires exactly three subagents before diagnosing the checkout alert", async () => {
  const { instructions } = await readManifest();

  assert.match(instructions, /MUST call create_sub_agent exactly three times/i);
  assert.match(
    instructions,
    /Do not diagnose, propose, or announce the investigation complete until all three subagents have returned/i,
  );
});

// Regression test for a second copy of the same iteration_limit that agent.json
// carries: syncTrueForgeAgent's fallback manifest (src/lib/mcp-connection.ts,
// used only when agent.json is missing or fails to parse) hardcodes its own
// config object rather than reading agent.json's. It shipped with
// iteration_limit: 40 even after agent.json was raised to 100 — a silent
// regression for that fallback path. Read as text rather than imported: this
// file runs in the plain scripts/**/*.test.mjs group (no TypeScript
// stripping), and a text match doesn't need to execute the module.
test("mcp-connection.ts's sync fallback does not carry a stale low iteration_limit", async () => {
  const source = await readFile(
    new URL("../src/lib/mcp-connection.ts", import.meta.url),
    "utf8",
  );
  const fallbackStart = source.indexOf("async function loadTrueForgeManifest");
  const fallbackEnd = source.indexOf("function normalizeAgentName", fallbackStart);
  const fallbackSource = source.slice(fallbackStart, fallbackEnd);

  assert.doesNotMatch(fallbackSource, /iteration_limit:\s*(?:[0-9]|[1-7][0-9]),/);
});
