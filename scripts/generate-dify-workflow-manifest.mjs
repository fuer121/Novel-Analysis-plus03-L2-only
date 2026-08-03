import crypto from "node:crypto";
import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifestUrl = new URL("dify-workflows/manifest.json", root);

const workflows = {
  analysis_summary: "dify-workflows/analysis-summary.workflow.yml",
  chapter_import: "dify-workflows/minimal-chapter-fetch.workflow.yml",
  l1_index: "dify-workflows/l1-route-index.workflow.yml",
  l2_index: "dify-workflows/l2-fact-index.workflow.yml",
};

const entries = {};

for (const [target, file] of Object.entries(workflows)) {
  const content = await fs.readFile(new URL(file, root));
  entries[target] = {
    file,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

await fs.writeFile(manifestUrl, `${JSON.stringify({ schemaVersion: 1, workflows: entries }, null, 2)}\n`);
