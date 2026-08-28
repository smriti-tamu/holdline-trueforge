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
