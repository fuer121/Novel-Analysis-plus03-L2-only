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
const STAGE_TYPES = new Set(["age", "form", "identity"]);

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

export function resolveCharacterCandidates(facts = []) {
  const sourceFacts = Array.isArray(facts) ? facts : [];
  const strongAliasEdges = collectStrongAliasEdges(sourceFacts);
  const neighborsByName = new Map();
  for (const { canonical, alias } of strongAliasEdges) {
    for (const [name, neighbor] of [[canonical, alias], [alias, canonical]]) {
      const neighbors = neighborsByName.get(name) ?? new Set();
      neighbors.add(neighbor);
      neighborsByName.set(name, neighbors);
    }
  }
  const canonicalByAlias = new Map();
  for (const { canonical, alias } of strongAliasEdges) {
    if (neighborsByName.get(canonical).size !== 1 || neighborsByName.get(alias).size !== 1) continue;
    if (strongAliasEdges.some((edge) => edge.canonical === alias && edge.alias === canonical)) continue;
    canonicalByAlias.set(alias, canonical);
  }
  const groups = new Map();
  for (const fact of sourceFacts) {
    const entity = normalizeText(fact?.entity);
    if (!isStableCharacterName(entity)) continue;
    const canonical = canonicalByAlias.get(entity) ?? entity;
    const group = groups.get(canonical) ?? { canonical_name: canonical, aliases: [], facts: [] };
    group.facts.push(fact);
    groups.set(canonical, group);
  }
  for (const [alias, canonical] of canonicalByAlias) {
    const group = groups.get(canonical);
    if (group) group.aliases.push(alias);
  }
  for (const group of groups.values()) {
    group.aliases.sort(compareChineseNames);
    group.facts = deduplicateFacts(group.facts);
  }
  return [...groups.values()].sort((left, right) =>
    compareChineseNames(left.canonical_name, right.canonical_name)
  );
}

export function deriveCharacterStages(_name, facts = []) {
  const sourceFacts = Array.isArray(facts) ? facts : [];
  const stages = new Map();
  let hasStageTypeConflict = false;
  for (const fact of sourceFacts) {
    const stageName = normalizeText(fact?.stage_hint);
    if (!isQualifiedStageFact(fact, stageName)) continue;
    const stage = stages.get(stageName) ?? { type: fact.stage_type, facts: [] };
    if (stage.type !== fact.stage_type) hasStageTypeConflict = true;
    stage.facts.push(fact);
    stages.set(stageName, stage);
  }
  if (hasStageTypeConflict || stages.size < 2 || !everyStageHasIndependentEvidence(stages)) {
    return [{ name: "默认阶段", type: "default", facts: deduplicateFacts(sourceFacts) }];
  }
  const sortedStages = [...stages].sort(([leftName, left], [rightName, right]) => {
    const leftChapter = Math.min(...left.facts.map((fact) => normalizeChapterIndex(fact.chapter_index)).filter(Boolean), Number.MAX_SAFE_INTEGER);
    const rightChapter = Math.min(...right.facts.map((fact) => normalizeChapterIndex(fact.chapter_index)).filter(Boolean), Number.MAX_SAFE_INTEGER);
    return leftChapter - rightChapter || compareChineseNames(leftName, rightName) || left.type.localeCompare(right.type);
  });
  return sortedStages.map(([name, stage]) => ({
    name,
    type: stage.type,
    facts: deduplicateFacts(stage.facts)
  }));
}

function isStrongAliasFact(fact, canonical) {
  return fact?.fact_type === "alias" &&
    isStableCharacterName(canonical) &&
    Array.isArray(fact.aliases) &&
    hasEvidence(fact.evidence);
}
function isQualifiedStageFact(fact, stageName) {
  return typeof fact?.stage_hint === "string" &&
    stageName && stageName.length <= 80 &&
    STAGE_TYPES.has(fact?.stage_type) &&
    fact?.stage_stability === "stable" &&
    fact?.stable_difference === true &&
    hasEvidence(fact.evidence);
}
function collectStrongAliasEdges(facts) {
  const edges = [];
  for (const fact of facts) {
    const canonical = normalizeText(fact?.entity);
    if (!isStrongAliasFact(fact, canonical)) continue;
    for (const value of fact.aliases) {
      const alias = normalizeText(value);
      if (
        alias === canonical ||
        !isStableCharacterName(alias) ||
        !hasConfirmedAliasRelationship(fact, canonical, alias)
      ) continue;
      edges.push({ canonical, alias });
    }
  }
  return edges;
}
function hasConfirmedAliasRelationship(fact, canonical, alias) {
  if (Object.hasOwn(fact, "alias_relation")) {
    return fact.alias_relation === "confirmed" &&
      Number.isFinite(fact.alias_confidence) &&
      fact.alias_confidence >= 0.9;
  }
  const statement = normalizeAliasRelationshipText(fact.fact);
  const templates = [
    `${canonical}小名${alias}`, `${canonical}的小名是${alias}`,
    `${canonical}又名${alias}`, `${canonical}化名为${alias}`,
    `${canonical}的化名是${alias}`, `${canonical}改名为${alias}`,
    `${canonical}被称为${alias}`, `${canonical}的称号是${alias}`,
    `${alias}是${canonical}的小名`, `${alias}是${canonical}的化名`,
    `${alias}是${canonical}的称号`
  ];
  return templates.includes(statement);
}
function everyStageHasIndependentEvidence(stages) {
  const evidenceSets = [...stages.values()].map(({ facts }) => new Set(
    facts.flatMap((fact) => fact.evidence.map(normalizeText)).filter(Boolean)
  ));
  return evidenceSets.every((evidence, index) => [...evidence].some((item) =>
    evidenceSets.every((other, otherIndex) => otherIndex === index || !other.has(item))
  ));
}
function deduplicateFacts(facts) {
  const representatives = new Map();
  for (const fact of facts) {
    const fingerprint = characterFactFingerprint(fact);
    const stableJson = stableFactJson(fact);
    const current = representatives.get(fingerprint);
    if (!current || stableJson < current) representatives.set(fingerprint, stableJson);
  }
  return [...representatives].sort(([left], [right]) => left.localeCompare(right))
    .map(([, stableJson]) => JSON.parse(stableJson));
}
function stableFactJson(fact) {
  return JSON.stringify(fact, (key, value) => {
    if (key === "id") return undefined;
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value;
  });
}
function hasEvidence(evidence) {
  return Array.isArray(evidence) && evidence.some((item) => normalizeText(item));
}

function compareChineseNames(left, right) {
  return left.localeCompare(right, "zh-CN");
}

function normalizeAliasRelationshipText(value) {
  return normalizeText(value).replace(/["'“”‘’《》〈〉「」『』【】〔〕]/gu, "");
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
