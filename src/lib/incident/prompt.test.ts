import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { HOLDLINE_SYSTEM_PROMPT } from "./prompt.ts";

// Regression test for a live run: given an unrelated alert with no data in
// the mock catalog, the model treated the checkout-only deploy 4c21 /
// baseline 9e10 rollback as universal, retried get_alert/query_metrics with
// guessed alertIds like "checkout" instead of accepting the empty result,
// matched the catalog's substring search by accident, and presented the
// checkout scenario's telemetry as the diagnosis for a different incident —
// asking to roll back 4c21 for a problem that had nothing to do with it.
// The prompt actually synced to TrueForge (via syncTrueForgeAgent, which
// overrides agent.json's own instructions field with this constant) must
// make the alert-substitution explicitly wrong and scope the 4c21/9e10
// remediation to the literal checkout alert text.
test("HOLDLINE_SYSTEM_PROMPT forbids alertId substitution and scopes the checkout rollback to the actual alert", () => {
  assert.match(HOLDLINE_SYSTEM_PROMPT, /never substitute a different alertId/i);
  assert.match(HOLDLINE_SYSTEM_PROMPT, /not a reason to retry with a different alertId/i);
  assert.match(HOLDLINE_SYSTEM_PROMPT, /do not borrow another alert's evidence/i);
  assert.match(HOLDLINE_SYSTEM_PROMPT, /no usable evidence for this specific alert.*low confidence/i);
  // The 4c21/9e10 remediation must be conditioned on the literal checkout
  // alert text, not asserted as a standing fact independent of which alert
  // is under investigation.
  assert.match(
    HOLDLINE_SYSTEM_PROMPT,
    /Only for the exact checkout alert text.*is rollback_deployment itself wired up in this mock/i,
  );
  assert.match(HOLDLINE_SYSTEM_PROMPT, /never be 4c21\/9e10/i);
});

// Regression test for a Qodo review finding on the previous fix: the prompt
// told the agent it was fine to propose an evidence-backed rollback target
// for ANY catalogued alert (e.g. the auth-library CVE, which has real deploy
// evidence), but rollback_deployment only accepts the exact checkout alertId
// and target 9e10 — an approved non-checkout rollback would reach the only
// mutation tool and be rejected instead of completing. The instructions must
// say plainly that execution isn't available outside the checkout alert,
// not just that the proposal should come from the alert's own evidence.
test("HOLDLINE_SYSTEM_PROMPT does not let the agent attempt a rollback the mock can't execute", () => {
  assert.match(HOLDLINE_SYSTEM_PROMPT, /this mock only implements execution for the checkout alert/i);
  assert.match(HOLDLINE_SYSTEM_PROMPT, /the tool will reject any other alertId or target/i);
  assert.match(
    HOLDLINE_SYSTEM_PROMPT,
    /stop after proposing instead of attempting a call that will fail/i,
  );
});

// Regression test for agent.json and this file having drifted from each
// other once already, which caused a live wrong-alert rollback attempt:
// agent.json's own `instructions` field only matters for however TrueForge
// might be bootstrapped directly from the checked-in manifest, while
// HOLDLINE_SYSTEM_PROMPT is what actually reaches the running TrueForge
// agent on every "Sync to TrueForge" from the Holdline app
// (loadTrueForgeManifest() overrides agent.json's instructions with this
// constant unconditionally — see src/lib/mcp-connection.ts). Keeping two
// independently-edited copies of the same policy is exactly how that drift
// happened. agent.json's instructions field is generated verbatim from this
// constant; this asserts they stay identical rather than re-diverging.
test("agent.json instructions are generated verbatim from HOLDLINE_SYSTEM_PROMPT, not a second copy", async () => {
  const manifestUrl = new URL("../../../agent.json", import.meta.url);
  const document = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.equal(document.manifest.instructions, HOLDLINE_SYSTEM_PROMPT);
});
