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
const INJURY_CHANGE_PATTERN = /(?:病中|伤中|受伤|病后|伤病|重伤|战损|断臂)/u;
const TEMPORARY_INJURY_CONTEXT_PATTERN = /(?:病了一场|(?:三|数)日后恢复|伤愈|痊愈)/u;
const TEMPORARY_EMOTION_HINT_PATTERN = /(?:愤怒|悲伤|哭泣|惊恐|醉态)/u;
const EMOTION_CONTEXT_PATTERN = /(?:愤怒|怒不可遏|悲伤|哭泣|落泪|惊恐|恐惧|醉态|醉酒)/u;
const TEMPORARY_EMOTION_CONTEXT_PATTERN = /(?:此刻|旋即恢复平静)/u;
const COVERING_HINT_PATTERN = /(?:蒙面|面纱|面罩)/u;
const TEMPORARY_COVERING_CONTEXT_PATTERN = /(?:当时|离场后摘去|随后摘下)/u;
const TEMPORARY_APPEARANCE_PATTERN = /(?:易容|单次情绪)/u;
const TEMPORARY_CLOTHING_HINT_PATTERN = /^(?:换装|换衣)$/u;
const EXPLICIT_TEMPORARY_PATTERN = /(?:短暂|临时|一时|片刻|转瞬|顷刻|一次性|单场景|这一幕|当晚|这次|随后换下|(?:离席便|离场便)(?:换回|换下|脱下)|事后换回|随后(?:恢复原状|恢复如常|变回)|只维持一场|仅维持一场)/u;
const CLOTHING_CHANGE_PATTERN = /(?:换装|换上|换下|换回|改穿|穿上|脱下)/u;
const TRANSFORMATION_CHANGE_PATTERN = /(?:异变|化作|变成|变为|力量爆发|恢复原状|恢复如常|变回)/u;
const STABLE_DURATION_PATTERN = /(?:从此|此后|始终|常年|长期|一直|永久|永远|再未恢复|不可逆|终生|自[^，。；;]{0,12}起)/u;
const AGE_STAGE_PATTERN = /(?:婴儿|幼年|童年|少年|青年|成年|中年|老年|晚年)/u;
const FORM_STAGE_PATTERN = /(?:形态|人身|真身|鬼魂|魂体|非人|形$)/u;

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
  const incomingNames = new Set(strongAliasEdges.map(({ alias }) => alias));
  const outgoingNames = new Set(strongAliasEdges.map(({ canonical }) => canonical));
  const chainNames = new Set([...incomingNames].filter((name) => outgoingNames.has(name)));
  const claimsByAlias = new Map();

  for (const { canonical, alias } of strongAliasEdges) {
    if (chainNames.has(canonical) || chainNames.has(alias)) continue;
    const claimers = claimsByAlias.get(alias) ?? new Set();
    claimers.add(canonical);
    claimsByAlias.set(alias, claimers);
  }

  const canonicalByAlias = new Map();
  const aliasesByCanonical = new Map();
  for (const [alias, claimers] of claimsByAlias) {
    if (claimers.size !== 1) continue;

    const [canonical] = claimers;
    canonicalByAlias.set(alias, canonical);
    const aliases = aliasesByCanonical.get(canonical) ?? new Set();
    aliases.add(alias);
    aliasesByCanonical.set(canonical, aliases);
  }

  const groups = new Map();
  for (const fact of sourceFacts) {
    const entity = normalizeText(fact?.entity);
    if (!isStableCharacterName(entity)) continue;

    const canonical = canonicalByAlias.get(entity) ?? entity;
    const group = groups.get(canonical) ?? {
      canonical_name: canonical,
      aliases: [],
      facts: []
    };
    group.facts.push(fact);
    groups.set(canonical, group);
  }

  for (const [canonical, aliases] of aliasesByCanonical) {
    const group = groups.get(canonical);
    if (!group) continue;
    group.aliases = [...aliases].sort(compareChineseNames);
  }

  return [...groups.values()].sort((left, right) =>
    compareChineseNames(left.canonical_name, right.canonical_name)
  );
}

export function deriveCharacterStages(_name, facts = []) {
  const sourceFacts = Array.isArray(facts) ? facts : [];
  const stageFacts = new Map();

  for (const fact of sourceFacts) {
    const stageName = normalizeText(fact?.stage_hint);
    if (!isQualifiedStageFact(fact, stageName)) continue;

    const matchingFacts = stageFacts.get(stageName) ?? [];
    matchingFacts.push(fact);
    stageFacts.set(stageName, matchingFacts);
  }

  const independentStages = filterStagesWithIndependentEvidence(stageFacts);
  if (independentStages.size < 2) {
    return [{ name: "默认阶段", type: "default", facts: sourceFacts }];
  }

  return [...independentStages].map(([name, matchingFacts]) => ({
    name,
    type: getStageType(name),
    facts: matchingFacts
  }));
}

function isStrongAliasFact(fact, canonical) {
  if (
    fact?.fact_type !== "alias" ||
    !isStableCharacterName(canonical) ||
    !Array.isArray(fact.aliases) ||
    !hasEvidence(fact.evidence)
  ) return false;

  return Boolean(normalizeText(fact.fact));
}

function isQualifiedStageFact(fact, stageName) {
  return Boolean(
    stageName &&
    !hasExplicitTemporaryContext(stageName, fact) &&
    fact?.stable_difference === true &&
    hasEvidence(fact.evidence)
  );
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
        !hasExplicitAliasRelationship(normalizeText(fact.fact), canonical, alias)
      ) continue;
      edges.push({ canonical, alias });
    }
  }

  return edges;
}

function hasExplicitAliasRelationship(statement, canonical, alias) {
  const relationshipText = normalizeAliasRelationshipText(statement);
  const canonicalPattern = escapeRegExp(normalizeAliasRelationshipText(canonical));
  const aliasPattern = escapeRegExp(normalizeAliasRelationshipText(alias));
  const leadingCanonicalPattern = `(?<![\\p{L}\\p{N}_])${canonicalPattern}`;
  const leadingAliasPattern = `(?<![\\p{L}\\p{N}_])${aliasPattern}`;
  const gap = "\\s*";
  const terminalAliasPattern = `${aliasPattern}(?![\\p{L}\\p{N}_])`;
  const renameTimeAdverb = "(?:(?:后来|之后|此后|随后|最终)\\s*)?";
  const nameLabel = "(?:小名|乳名|昵称|绰号|别名|曾用名|原名|本名|真名|化名|称号)";
  const renameVerb = "(?:化名|改名|更名|易名)";
  const directTitle = "(?:又名|人称|号称|被称作|被称为|被唤作|被唤为)";
  const patterns = [
    `${leadingCanonicalPattern}${gap}的?${gap}${nameLabel}${gap}(?:也?是|为|叫)?${gap}${terminalAliasPattern}`,
    `${leadingCanonicalPattern}${gap}${renameTimeAdverb}(?:曾)?${renameVerb}${gap}(?:为|叫|作|成)?${gap}${terminalAliasPattern}`,
    `${leadingCanonicalPattern}${gap}${directTitle}${gap}${terminalAliasPattern}`,
    `${leadingAliasPattern}${gap}(?:是|为)${gap}${canonicalPattern}${gap}的?${gap}${nameLabel}`
  ];

  return patterns.some((pattern) => new RegExp(pattern, "u").test(relationshipText));
}

function hasExplicitTemporaryContext(stageName, fact) {
  const sourceTexts = getStageSourceTexts(fact);
  const context = [stageName, ...sourceTexts].join(" ");

  if (TEMPORARY_INJURY_CONTEXT_PATTERN.test(context)) return true;
  if (TEMPORARY_EMOTION_HINT_PATTERN.test(stageName)) return true;
  if (EMOTION_CONTEXT_PATTERN.test(context) && TEMPORARY_EMOTION_CONTEXT_PATTERN.test(context)) return true;
  if (COVERING_HINT_PATTERN.test(stageName) && TEMPORARY_COVERING_CONTEXT_PATTERN.test(context)) return true;
  if (TEMPORARY_APPEARANCE_PATTERN.test(context)) return true;
  if (TEMPORARY_CLOTHING_HINT_PATTERN.test(stageName)) return true;
  if (EXPLICIT_TEMPORARY_PATTERN.test(context)) return true;
  if (hasStableStageEvidence(stageName, sourceTexts)) return false;
  return CLOTHING_CHANGE_PATTERN.test(context) ||
    TRANSFORMATION_CHANGE_PATTERN.test(context) ||
    INJURY_CHANGE_PATTERN.test(context) ||
    COVERING_HINT_PATTERN.test(stageName);
}

function getStageSourceTexts(fact) {
  return [
    normalizeText(fact?.fact),
    ...(Array.isArray(fact?.evidence) ? fact.evidence.map(normalizeText) : [])
  ].filter(Boolean);
}

function hasStableStageEvidence(stageName, sourceTexts) {
  const feature = stageName.replace(/(?:形态|形|时期|阶段|时代|期)$/u, "");
  if (!feature) return false;

  return sourceTexts
    .flatMap((text) => text.split(/[，,。.!！?？；;：:\n]/u))
    .map(normalizeText)
    .filter(Boolean)
    .some((clause) => STABLE_DURATION_PATTERN.test(clause) && clause.includes(feature));
}

function filterStagesWithIndependentEvidence(stageFacts) {
  const evidenceByStage = new Map();
  const evidenceStageCounts = new Map();

  for (const [stageName, facts] of stageFacts) {
    const evidence = new Set(
      facts.flatMap((fact) => fact.evidence.map(normalizeText)).filter(Boolean)
    );
    evidenceByStage.set(stageName, evidence);
    for (const item of evidence) {
      evidenceStageCounts.set(item, (evidenceStageCounts.get(item) ?? 0) + 1);
    }
  }

  return new Map([...stageFacts].filter(([stageName]) =>
    [...evidenceByStage.get(stageName)].some((item) => evidenceStageCounts.get(item) === 1)
  ));
}

function getStageType(name) {
  if (AGE_STAGE_PATTERN.test(name)) return "age";
  if (FORM_STAGE_PATTERN.test(name)) return "form";
  return "state";
}

function hasEvidence(evidence) {
  return Array.isArray(evidence) && evidence.some((item) => normalizeText(item));
}

function compareChineseNames(left, right) {
  return left.localeCompare(right, "zh-CN");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
