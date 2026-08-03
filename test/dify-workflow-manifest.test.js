import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const expectedWorkflows = {
  analysis_summary: "dify-workflows/analysis-summary.workflow.yml",
  chapter_import: "dify-workflows/minimal-chapter-fetch.workflow.yml",
  l1_index: "dify-workflows/l1-route-index.workflow.yml",
  l2_index: "dify-workflows/l2-fact-index.workflow.yml",
};

test("Dify workflow manifest matches every tracked workflow export", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("dify-workflows/manifest.json", root), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.workflows), Object.keys(expectedWorkflows));

  for (const [target, file] of Object.entries(expectedWorkflows)) {
    const entry = manifest.workflows[target];
    assert.equal(entry.file, file);
    const content = await fs.readFile(new URL(file, root));
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    assert.equal(entry.sha256, sha256, `${file} hash changed; regenerate the manifest`);
  }
});
