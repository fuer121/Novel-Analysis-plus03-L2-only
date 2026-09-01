import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BOOKS_ROOT = path.join(ROOT, "books");
const EXPECTED_BOOKS = [
  { directory: "148431-逆天邪神", book_id: "148431", book_name: "逆天邪神", slug: "against-the-gods" },
  { directory: "1721648-废材那又怎样", book_id: "1721648", book_name: "废材那又怎样", slug: "feicai" },
  { directory: "1836527-凰宫梦", book_id: "1836527", book_name: "凰宫梦", slug: "huanggong" },
  { directory: "222767-离婚后她惊艳了世界", book_id: "222767", book_name: "离婚后她惊艳了世界", slug: "divorce" }
];
const EXPECTED_DIRECTORIES = ["inputs", "scripts", "runs", "final", "archive"];

test("book workspaces expose stable identity and standard directories", () => {
  for (const expected of EXPECTED_BOOKS) {
    const bookRoot = path.join(BOOKS_ROOT, expected.directory);
    const metadata = JSON.parse(fs.readFileSync(path.join(bookRoot, "book.json"), "utf8"));

    assert.deepEqual(metadata, {
      book_id: expected.book_id,
      book_name: expected.book_name,
      slug: expected.slug,
      database: "../../data/novel-chapters.sqlite"
    });
    assert.ok(fs.existsSync(path.join(bookRoot, "README.md")));

    for (const directory of EXPECTED_DIRECTORIES) {
      assert.ok(fs.statSync(path.join(bookRoot, directory)).isDirectory(), `${expected.directory}/${directory} is missing`);
    }
  }
});

test("migration manifest template contains integrity fields", () => {
  const template = JSON.parse(fs.readFileSync(path.join(BOOKS_ROOT, "migration-manifest.template.json"), "utf8"));

  assert.deepEqual(Object.keys(template), [
    "book_id",
    "book_name",
    "migration_id",
    "created_at",
    "status",
    "source",
    "target",
    "file_count",
    "total_bytes",
    "sha256_manifest",
    "notes"
  ]);
  assert.equal(template.status, "planned");
});
