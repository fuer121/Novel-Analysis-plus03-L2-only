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
const STAGE_SIGNAL_FIELDS = ["stage_hint", "stage_type", "stage_stability", "stable_difference"];
export const CHARACTER_PROJECTION_RULE_VERSION = "character-projection-v1";
const CHARACTER_FACT_TYPES = new Set(["identity", "alias", "appearance", "age", "personality", "background"]);

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
  let hasInvalidStageSignal = false;
  let hasStageTypeConflict = false;
  for (const fact of sourceFacts) {
    if (!hasStageSignal(fact)) continue;
    const stageName = normalizeText(fact?.stage_hint);
    if (!isQualifiedStageFact(fact, stageName)) {
      hasInvalidStageSignal = true;
      continue;
    }
    const stage = stages.get(stageName) ?? { type: fact.stage_type, facts: [] };
    if (stage.type !== fact.stage_type) hasStageTypeConflict = true;
    stage.facts.push(fact);
    stages.set(stageName, stage);
  }
  if (hasInvalidStageSignal || hasStageTypeConflict || stages.size < 2 || !everyStageHasIndependentEvidence(stages)) {
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

export function assignStableCharacterIds(bookId, candidates = [], previousCharacters = []) {
  const next = (Array.isArray(candidates) ? candidates : []).map((candidate) => normalizeIdentityCandidate(candidate));
  const previous = (Array.isArray(previousCharacters) ? previousCharacters : []).map((character) => normalizePreviousCharacter(character));
  const scores = next.map((candidate) => previous.map((character) => characterMatchScore(candidate, character)));
  const bestPrevious = scores.map(uniqueBestIndex);
  const bestNext = previous.map((_, previousIndex) => uniqueBestIndex(scores.map((row) => row[previousIndex])));

  return next.map((candidate, candidateIndex) => {
    const previousIndex = bestPrevious[candidateIndex];
    const matched = previousIndex >= 0 && bestNext[previousIndex] === candidateIndex ? previous[previousIndex] : null;
    const warnings = [...candidate.quality_warnings];
    if (!matched && previous.length && scores[candidateIndex].some((score) => score[0] > 0 || score[1] > 0)) {
      warnings.push("identity_ambiguous");
    }
    const id = matched?.id || stableId("character", [bookId, candidate.canonical_name, candidate.aliases, candidate.fact_fingerprints]);
    return {
      ...candidate.source,
      id,
      facts: candidate.facts,
      quality_warnings: [...new Set(warnings)],
      stages: assignStableStageIds(id, candidate.stages, matched?.stages || [])
    };
  });
}

export function prepareCharacterLibraryBuild({ facts = [], coverage = {}, versions = {} } = {}) {
  const accepted = (Array.isArray(facts) ? facts : []).filter((fact) =>
    fact?.category === "character" && CHARACTER_FACT_TYPES.has(fact?.fact_type) && isStableCharacterName(fact?.entity)
  );
  const fingerprinted = accepted.map((fact) => ({ ...fact, fingerprint: characterFactFingerprint(fact) }));
  const candidates = resolveCharacterCandidates(fingerprinted).map((candidate) => ({
    ...candidate,
    stages: deriveCharacterStages(candidate.canonical_name, candidate.facts),
    candidate_fingerprint: stableDigest([candidate.canonical_name, candidate.aliases, candidate.facts.map((fact) => fact.fingerprint).sort()])
  }));
  const source_fingerprint = stableDigest({
    facts: fingerprinted.map((fact) => fact.fingerprint).sort(),
    coverage,
    versions: { task2: CHARACTER_PROJECTION_RULE_VERSION, ...versions }
  });
  return {
    source_fingerprint,
    coverage,
    candidates,
    quality: {
      accepted_fact_count: accepted.length,
      rejected_fact_count: Math.max(0, (Array.isArray(facts) ? facts.length : 0) - accepted.length),
      conflict_count: 0,
      warning_count: 0
    }
  };
}

export function applyClassificationSignals(candidate, profile = {}) {
  const facts = [...(Array.isArray(candidate?.facts) ? candidate.facts : [])];
  for (const alias of Array.isArray(profile.aliases) ? profile.aliases : []) {
    facts.push({
      book_id: facts[0]?.book_id,
      index_group_key: facts[0]?.index_group_key,
      chapter_index: facts[0]?.chapter_index,
      category: "character",
      entity: candidate.canonical_name,
      aliases: [alias.name],
      fact_type: "alias",
      fact: `structured alias: ${alias.name}`,
      evidence: alias.evidence,
      alias_relation: alias.alias_relation,
      alias_confidence: alias.alias_confidence
    });
  }
  for (const stage of Array.isArray(profile.stages) ? profile.stages : []) {
    if (stage.stage_stability !== "stable" || stage.stable_difference !== true || !stage.evidence?.length) continue;
    facts.push({
      book_id: facts[0]?.book_id,
      index_group_key: facts[0]?.index_group_key,
      chapter_index: facts[0]?.chapter_index,
      category: "character",
      entity: candidate.canonical_name,
      fact_type: "identity",
      fact: `structured stage: ${stage.stage_hint || stage.name}`,
      evidence: stage.evidence,
      stage_hint: stage.stage_hint || stage.name,
      stage_type: stage.stage_type,
      stage_stability: stage.stage_stability,
      stable_difference: stage.stable_difference
    });
  }
  return facts;
}

export function computeAffectedCharacterClosure(previousCharacters = [], nextCandidates = [], { compareAliases = true } = {}) {
  const previous = previousCharacters.map(normalizeIdentityCandidate);
  const next = nextCandidates.map(normalizeIdentityCandidate);
  const oldByCanonical = new Map(previous.map((item) => [item.canonical_name, item]));
  const nextByCanonical = new Map(next.map((item) => [item.canonical_name, item]));
  const seeds = new Set();
  for (const name of new Set([...oldByCanonical.keys(), ...nextByCanonical.keys()])) {
    const oldItem = oldByCanonical.get(name);
    const nextItem = nextByCanonical.get(name);
    const changed = !oldItem || !nextItem || stableDigest(compareAliases ? [oldItem.aliases, oldItem.fact_fingerprints] : oldItem.fact_fingerprints)
      !== stableDigest(compareAliases ? [nextItem.aliases, nextItem.fact_fingerprints] : nextItem.fact_fingerprints);
    if (changed) {
      seeds.add(name);
    }
  }
  const graphs = [buildAliasGraph(previous), buildAliasGraph(next)];
  const affectedNames = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const name = queue.shift();
    for (const graph of graphs) {
      for (const related of graph.get(name) || []) {
        if (affectedNames.has(related)) continue;
        affectedNames.add(related);
        queue.push(related);
      }
    }
  }
  const affectedCanonicalNames = new Set();
  for (const item of [...previous, ...next]) {
    if ([item.canonical_name, ...item.aliases].some((name) => affectedNames.has(name))) affectedCanonicalNames.add(item.canonical_name);
  }
  return { affected_names: [...affectedCanonicalNames].sort(compareChineseNames), full_rebuild: false };
}

function assignStableStageIds(characterId, stages, previousStages) {
  const next = stages.map((stage) => normalizeIdentityStage(stage));
  const previous = previousStages.map((stage) => normalizeIdentityStage(stage));
  const scores = next.map((stage) => previous.map((oldStage) => stageMatchScore(stage, oldStage)));
  const bestPrevious = scores.map(uniqueBestIndex);
  const bestNext = previous.map((_, previousIndex) => uniqueBestIndex(scores.map((row) => row[previousIndex])));
  return next.map((stage, stageIndex) => {
    const previousIndex = bestPrevious[stageIndex];
    const matched = previousIndex >= 0 && bestNext[previousIndex] === stageIndex ? previous[previousIndex] : null;
    const warnings = Array.isArray(stage.source.quality_warnings) ? [...stage.source.quality_warnings] : [];
    if (!matched && previous.length && scores[stageIndex].some((score) => score[0] > 0 || score[1] > 0)) warnings.push("stage_identity_ambiguous");
    return {
      ...stage.source,
      id: matched?.id || stableId("stage", [characterId, stage.type, stage.name, stage.fact_fingerprints]),
      facts: stage.facts,
      quality_warnings: [...new Set(warnings)]
    };
  });
}

function buildAliasGraph(characters) {
  const graph = new Map();
  for (const character of characters) {
    for (const alias of character.aliases) {
      for (const [left, right] of [[character.canonical_name, alias], [alias, character.canonical_name]]) {
        const neighbors = graph.get(left) || new Set();
        neighbors.add(right);
        graph.set(left, neighbors);
      }
    }
  }
  return graph;
}

function normalizeIdentityCandidate(candidate = {}) {
  const facts = normalizeIdentityFacts([
    ...(Array.isArray(candidate.facts) ? candidate.facts : []),
    ...(Array.isArray(candidate.stages) ? candidate.stages.flatMap((stage) => Array.isArray(stage?.facts) ? stage.facts : []) : [])
  ]);
  return {
    source: candidate,
    canonical_name: normalizeText(candidate.canonical_name),
    aliases: [...new Set((Array.isArray(candidate.aliases) ? candidate.aliases : []).map(normalizeText).filter(Boolean))].sort(compareChineseNames),
    facts,
    fact_fingerprints: [...new Set(facts.map(identityFactFingerprint))].sort(),
    stages: Array.isArray(candidate.stages) ? candidate.stages : [],
    quality_warnings: Array.isArray(candidate.quality_warnings) ? candidate.quality_warnings : []
  };
}

function normalizePreviousCharacter(character = {}) {
  return { ...normalizeIdentityCandidate(character), id: String(character.id || ""), stages: Array.isArray(character.stages) ? character.stages : [] };
}

function normalizeIdentityStage(stage = {}) {
  const facts = normalizeIdentityFacts(stage.facts);
  return {
    source: stage,
    id: String(stage.id || ""),
    name: normalizeText(stage.name || stage.stage_hint || "默认阶段"),
    type: normalizeText(stage.type || stage.stage_type || "default"),
    facts,
    fact_fingerprints: facts.map(identityFactFingerprint).sort()
  };
}

function normalizeIdentityFacts(facts) {
  return Array.isArray(facts) ? facts : [];
}

function identityFactFingerprint(fact) {
  return normalizeText(fact?.fingerprint) || characterFactFingerprint(fact);
}

function characterMatchScore(candidate, previous) {
  const sharedFacts = intersectionCount(candidate.fact_fingerprints, previous.fact_fingerprints);
  const candidateNames = new Set([candidate.canonical_name, ...candidate.aliases]);
  const previousNames = new Set([previous.canonical_name, ...previous.aliases]);
  return [sharedFacts, [...candidateNames].some((name) => previousNames.has(name)) ? 1 : 0];
}

function stageMatchScore(stage, previous) {
  const sharedFacts = intersectionCount(stage.fact_fingerprints, previous.fact_fingerprints);
  const sameSignal = stage.type === previous.type && stage.name === previous.name ? 1 : 0;
  return [sharedFacts, sameSignal];
}

function uniqueBestIndex(scores) {
  let best = [-1, -1];
  let index = -1;
  let tied = false;
  scores.forEach((score, candidateIndex) => {
    const comparison = score[0] - best[0] || score[1] - best[1];
    if (comparison > 0) {
      best = score;
      index = candidateIndex;
      tied = false;
    } else if (comparison === 0) {
      tied = true;
    }
  });
  return !tied && (best[0] > 0 || best[1] > 0) ? index : -1;
}

function intersectionCount(left, right) {
  const values = new Set(left);
  return right.reduce((count, value) => count + (values.has(value) ? 1 : 0), 0);
}

function stableId(prefix, parts) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 24);
  return `${prefix}:${digest}`;
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
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
  const assertionsByPair = new Map();
  for (const fact of facts) {
    const canonical = normalizeText(fact?.entity);
    if (fact?.fact_type !== "alias" || !isStableCharacterName(canonical) || !Array.isArray(fact.aliases)) continue;
    for (const value of fact.aliases) {
      const alias = normalizeText(value);
      if (alias === canonical || !isStableCharacterName(alias)) continue;
      const key = JSON.stringify([canonical, alias]);
      const pair = assertionsByPair.get(key) ?? { canonical, alias, facts: [] };
      pair.facts.push(fact);
      assertionsByPair.set(key, pair);
    }
  }
  const edges = [];
  for (const { canonical, alias, facts: assertions } of assertionsByPair.values()) {
    if (assertions.some(isBlockingAliasAssertion)) continue;
    if (assertions.some((fact) =>
      isStrongAliasFact(fact, canonical) && hasConfirmedAliasRelationship(fact, canonical, alias)
    )) edges.push({ canonical, alias });
  }
  return edges;
}
function hasConfirmedAliasRelationship(fact, canonical, alias) {
  if (Object.hasOwn(fact, "alias_relation")) {
    return isValidStructuredAliasConfirmation(fact);
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
function isBlockingAliasAssertion(fact) {
  return Object.hasOwn(fact, "alias_relation") && !isValidStructuredAliasConfirmation(fact);
}
function isValidStructuredAliasConfirmation(fact) {
  return fact.alias_relation === "confirmed" &&
    Number.isFinite(fact.alias_confidence) &&
    fact.alias_confidence >= 0.9 &&
    fact.alias_confidence <= 1;
}
function hasStageSignal(fact) {
  return fact && typeof fact === "object" && STAGE_SIGNAL_FIELDS.some((field) => Object.hasOwn(fact, field));
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
