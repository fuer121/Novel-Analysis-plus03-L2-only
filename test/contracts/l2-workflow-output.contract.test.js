import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const root = new URL("../../", import.meta.url);

test("L2 workflow binds trusted chapter context around model facts", async () => {
  const workflow = await fs.readFile(new URL("dify-workflows/l2-fact-index.workflow.yml", root), "utf8");
  const outputNode = workflow.match(/ {4}- data:\n {8}code: \|[\s\S]*?\n {6}id: '2000000000103'/)?.[0] ?? "";

  assert.match(outputNode, /def main\(text: str, chapter_index: int, chapter_title: str\):/);
  assert.match(outputNode, /"chapter_index": int\(chapter_index\)/);
  assert.match(outputNode, /"chapter_title": chapter_title or ""/);
  assert.match(outputNode, /"facts": parsed\.get\("facts"\)/);
  assert.match(outputNode, /- '2000000000101'\n {10}- chapter_index/);
  assert.match(outputNode, /- '2000000000101'\n {10}- chapter_title/);
});
