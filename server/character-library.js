import crypto from "node:crypto";

const GENERIC_CHARACTER_NAMES = new Set([
  "丫鬟",
  "侍卫",
  "仆人",
  "僧人",
  "兵士",
  "婴儿",
  "女人",
  "女子",
  "妇人",
  "婢女",
  "孩子",
  "小孩",
  "少女",
  "少年",
  "弟子",
  "护卫",
  "男人",
  "男子",
  "神秘人",
  "老人",
  "老妇",
  "老妪",
  "老者",
  "蒙面人",
  "行人",
  "路人",
  "随从",
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
    normalizeChapterIndex(fact.chapter_index),
    normalizeText(fact.fact),
    evidence
  ];

  return crypto.createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function normalizeChapterIndex(value) {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  if (typeof value === "string" && !value.trim()) return 0;

  const chapterIndex = Number(value);
  return Number.isInteger(chapterIndex) && chapterIndex > 0 ? chapterIndex : 0;
}
