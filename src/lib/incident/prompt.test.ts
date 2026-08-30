import assert from "node:assert/strict";
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
    /Only for the exact checkout alert text.*is the supported remediation/i,
  );
  assert.match(HOLDLINE_SYSTEM_PROMPT, /never from 4c21\/9e10/i);
});
