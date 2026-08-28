import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playbooksUrl = new URL("../src/lib/incident/playbooks.ts", import.meta.url);

test("catalogued playbooks resolve only after reporting recovered", async () => {
  const source = await readFile(playbooksUrl, "utf8");
  const recoveredStatuses = source.match(/Recovery status: RECOVERED/g) ?? [];

  assert.equal(recoveredStatuses.length, 4);
  assert.doesNotMatch(source, /Recovery status: RECOVERING/);
});

test("generic incidents remain parked and unresolved", async () => {
  const source = await readFile(playbooksUrl, "utf8");
  const genericStart = source.indexOf("function genericPlaybook");
  const genericEnd = source.indexOf("export function matchPlaybookId", genericStart);
  const genericSource = source.slice(genericStart, genericEnd);

  assert.match(genericSource, /Recovery status: NOT RECOVERED/);
  assert.match(genericSource, /status: "parked"/);
  assert.match(genericSource, /writeLock: "engaged"/);
  assert.doesNotMatch(genericSource, /kind: "close"/);
  assert.doesNotMatch(genericSource, /stage\(7/);
});
