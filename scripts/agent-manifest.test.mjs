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
  assert.ok(manifest.config.iteration_limit >= 40);
  assert.deepEqual(monitoring.require_approval_for_tools, [
    "rollback_deployment",
  ]);
});

test("Holdline manifest preserves the locked checkout safety path", async () => {
  const { instructions } = await readManifest();

  assert.match(instructions, /Call get_alert first/i);
  assert.match(instructions, /MUST call create_sub_agent/);
  assert.match(instructions, /MUST call sandbox exec/);
  assert.match(instructions, /sandbox code is read-only/i);
  assert.match(instructions, /questions or silence as no approval/i);
  assert.match(instructions, /bad deploy 4c21 to stable baseline 9e10/i);
  assert.match(instructions, /Enter RESOLVE only when post-action tools prove recovery/);
  assert.match(instructions, /report NOT RECOVERED, keep the incident UNRESOLVED/);
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
  assert.match(instructions, /never borrow another alert's data/i);
  assert.match(instructions, /no usable evidence for this specific alert.*low confidence/i);
  // The 4c21/9e10 remediation must be conditioned on the literal checkout
  // alert text, not asserted as a standing fact independent of which alert
  // is under investigation.
  assert.match(
    instructions,
    /Only for the exact locked checkout alert text.*do deploy 4c21 and baseline 9e10 apply/i,
  );
  assert.match(instructions, /never from 4c21\/9e10/i);
});
