import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("./configure-deployment.mjs", import.meta.url));
const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const databaseId = "11111111-1111-4111-8111-111111111111";
function run(source, databaseId, check) {
  const directory = mkdtempSync(join(tmpdir(), "household-deploy-"));
  try {
    writeFileSync(join(directory, "wrangler.jsonc"), source);
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      env: { ...process.env, CLOUDFLARE_D1_DATABASE_ID: databaseId },
      encoding: "utf8",
    });
    check(result, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test("production configuration handles the actual formatted JSONC and comments", () => {
  run("// deployment configuration\n" + source, databaseId, (result, directory) => {
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(join(directory, "wrangler.deploy.json"), "utf8"));
    assert.equal(config.d1_databases.find((d) => d.binding === "DB").database_id, databaseId);
    assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
    assert.equal(config.main, "server/worker.ts");
    assert.deepEqual(config.triggers.crons, ["0 4 * * *"]);
  });
});
test("invalid JSONC is rejected instead of generating a partial deployment", () => {
  run('{"name": }', databaseId, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid wrangler.jsonc/);
  });
});
test("production configuration still rejects missing and placeholder database IDs", () => {
  for (const value of ["", "00000000-0000-0000-0000-000000000000"]) {
    run(source, value, (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /CLOUDFLARE_D1_DATABASE_ID/);
    });
  }
});
