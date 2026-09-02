import crypto from "node:crypto";

const GENERIC_CHARACTER_NAMES = new Set([
  "侍卫",
  "僧人",
  "女人",
  "女子",
  "孩子",
  "小孩",
  "少女",
  "少年",
  "弟子",
  "男人",
  "男子",
  "路人",
  "黑衣人"
]);

const DESCRIPTIVE_PREFIX_PATTERN = /^(?:某人|某个|一名|一个|那名|这名)/u;
const RELATIONSHIP_SUFFIX_PATTERN = /的(?:父亲|母亲|兄弟|姐妹|师父|徒弟)$/u;

export function isStableCharacterName(value) {
  if (typeof value !== "string") return false;

  const name = normalizeText(value);
  if (!name || name.length > 80) return false;
  if (GENERIC_CHARACTER_NAMES.has(name)) return false;
  if (DESCRIPTIVE_PREFIX_PATTERN.test(name)) return false;
  if (RELATIONSHIP_SUFFIX_PATTERN.test(name)) return false;

  return true;
}

export function characterFactFingerprint(fact = {}) {
  const evidence = [...new Set(
    (Array.isArray(fact.evidence) ? fact.evidence : [])
      .map(normalizeText)
      .filter(Boolean)
  )].sort();
  const identity = [
    normalizeText(fact.book_id),
    normalizeText(fact.index_group_key),
    fact.chapter_index,
    normalizeText(fact.fact),
    evidence
  ];

  return crypto.createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}
