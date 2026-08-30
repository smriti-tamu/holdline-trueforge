import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForResponse(url, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited early with code ${child.exitCode}`);
    }

    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Production server did not become ready at ${url}`);
}

function stopChild(child) {
  if (child.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000);
    forceStop.unref();
    child.once("exit", () => {
      clearTimeout(forceStop);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

test("Railway production build starts and serves Holdline", { timeout: 60_000 }, async (t) => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
  accessSync(join(ROOT, ".output/server/index.mjs"));

  const port = await availablePort();
  const child = spawn(process.execPath, ["scripts/start.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NITRO_HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: "ignore",
  });
  t.after(() => stopChild(child));

  const response = await waitForResponse(`http://127.0.0.1:${port}/`, child);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Holdline/);
});
