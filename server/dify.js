import { config, difyApiKeyEnvName, difyApiKeyForTarget } from "./config.js";
import { sanitizeDetails, sanitizeText } from "./sanitize.js";

const DIFY_FETCH_MAX_ATTEMPTS = 3;
const DIFY_FETCH_RETRY_DELAYS_MS = process.env.NODE_ENV === "test" ? [1, 1] : [300, 900];

export function buildChapterBatches(startChapter, endChapter, batchSize = config.dify.batchSize) {
  const batches = [];
  for (let start = startChapter; start <= endChapter; start += batchSize) {
    batches.push({
      startChapter: start,
      endChapter: Math.min(endChapter, start + batchSize - 1)
    });
  }
  return batches;
}

export async function fetchChapterBatch({ bookId, startChapter, endChapter }) {
  const outputs = await runDifyWorkflow({
    apiKey: difyApiKeyForTarget("import"),
    inputs: {
      book_id: bookId,
      start_chapter: startChapter,
      end_chapter: endChapter
    },
    target: "import"
  });
  const raw = outputs.result ?? outputs.text ?? outputs.chapters ?? outputs.output;
  return normalizeDifyChapterOutput(raw, { bookId, startChapter, endChapter });
}

export async function runDifyWorkflow({ apiKey, inputs = {}, user = config.dify.user, target = "workflow" }) {
  if (!config.dify.base) {
    const error = new Error("缺少 DIFY_API_BASE。");
    error.status = 500;
    throw error;
  }
  if (!apiKey) {
    const error = new Error(`缺少 ${difyApiKeyEnvName(target)}。`);
    error.status = 500;
    throw error;
  }

  const response = await fetchDifyWithRetry(`${config.dify.base}/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputs,
      response_mode: "blocking",
      user
    })
  }, { target, phase: "workflow" });

  const { data, text } = await readDifyResponse(response);
  if (!response.ok) {
    const error = new Error(difyErrorMessage(
      response.status,
      data?.message || data?.error || text || `Dify 调用失败：HTTP ${response.status}`,
      "workflow",
      target
    ));
    error.status = response.status;
    error.details = sanitizeDetails(data || { status: response.status, message: text });
    throw error;
  }

  return data?.data?.outputs || {};
}

export async function testDifyConnection({ apiKey, target = "import" } = {}) {
  if (!config.dify.base) {
    const error = new Error("缺少 DIFY_API_BASE。");
    error.status = 500;
    throw error;
  }
  const token = apiKey || difyApiKeyForTarget(target);
  if (!token) {
    const error = new Error(`缺少 ${difyApiKeyEnvName(target)}。`);
    error.status = 500;
    throw error;
  }
  const response = await fetchDifyWithRetry(`${config.dify.base}/parameters`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }, { target, phase: "parameters" });

  const { data, text } = await readDifyResponse(response);
  if (!response.ok) {
    const error = new Error(difyErrorMessage(
      response.status,
      data?.message || data?.error || text || `Dify 连通性测试失败：HTTP ${response.status}`,
      "parameters",
      target
    ));
    error.status = response.status;
    error.details = sanitizeDetails(data || { status: response.status, message: text });
    throw error;
  }

  const forms = data?.user_input_form || data?.parameters?.user_input_form || [];
  const variables = forms.flatMap((entry) => Object.values(entry || {}).map((item) => item?.variable).filter(Boolean));
  return {
    ok: true,
    status: response.status,
    variables
  };
}

export function normalizeDifyL1Output(raw) {
  const value = normalizeDifyOutputEnvelope(raw);
  const record = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
  return {
    route_schema_version: normalizeString(record.route_schema_version ?? record.routeSchemaVersion, "l1-route-v1"),
    route_entities: normalizeDifyRouteEntities(record.route_entities ?? record.routeEntities ?? record.entities),
    route_keywords: normalizeStringArray(record.route_keywords ?? record.routeKeywords ?? record.keywords),
    signals: normalizeDifySignals(record.signals),
    category_scores: normalizeDifyCategoryScores(record.category_scores ?? record.categoryScores)
  };
}

export function normalizeDifyL2Output(raw) {
  const value = normalizeDifyOutputEnvelope(raw);
  const record = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
  const facts = Array.isArray(record.facts)
    ? record.facts
    : Array.isArray(record.items)
      ? record.items
      : [];
  return {
    chapter_index: normalizeInteger(record.chapter_index ?? record.chapterIndex),
    chapter_title: normalizeString(record.chapter_title ?? record.chapterTitle ?? record.title),
    facts: facts.map(normalizeDifyFact).filter(Boolean)
  };
}

export function normalizeCharacterProfileOutput(raw) {
  const value = normalizeDifyOutputEnvelope(raw);
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    canonical_name: normalizeProfileText(record.canonical_name),
    gender: normalizeProfileText(record.gender),
    aliases: (Array.isArray(record.aliases) ? record.aliases : []).map(normalizeProfileAlias).filter((item) => item.name),
    stages: (Array.isArray(record.stages) ? record.stages : []).map(normalizeProfileStage).filter((item) => item.name)
  };
}

export function normalizeDifyAnalysisJsonOutput(raw, schema = null, { errorLabel = "Dify 分析工作流" } = {}) {
  const value = coerceAnalysisJsonBySchema(normalizeDifyOutputEnvelope(raw), schema);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = coerceAnalysisJsonBySchema(parseJsonMaybe(value), schema);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  const error = new Error(`${errorLabel}返回的 JSON 无法解析为对象。`);
  error.status = 502;
  throw error;
}

export function normalizeDifyAnalysisTextOutput(raw, { errorLabel = "Dify 分析工作流" } = {}) {
  const value = normalizeDifyOutputEnvelope(raw);
  if (typeof value === "string") {
    const text = value.trim();
    if (text) return text;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidates = [value.text, value.result, value.output, value.content, value.data]
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    if (candidates.length) return candidates[0];
  }
  const error = new Error(`${errorLabel}返回了空文本。`);
  error.status = 502;
  throw error;
}

export function normalizeDifyChapterOutput(raw, context = {}) {
  const value = normalizeDifyOutputEnvelope(raw);
  const chapters = extractChapters(value);
  return chapters.map((chapter, offset) => {
    const index = Number.parseInt(
      chapter.chapter_index ?? chapter.chapterIndex ?? chapter.index ?? chapter.sortid ?? chapter.sort_id ?? context.startChapter + offset,
      10
    );
    const content = String(
      chapter.content ?? chapter.text ?? chapter.chapter_content ?? chapter.chapterContent ?? ""
    );
    return {
      book_id: String(chapter.book_id ?? chapter.bookId ?? context.bookId ?? ""),
      chapter_index: Number.isFinite(index) ? index : context.startChapter + offset,
      chapter_title: String(chapter.chapter_title ?? chapter.title ?? ""),
      content,
      fetch_status: String(chapter.fetch_status ?? chapter.status ?? "ok")
    };
  });
}

async function fetchDifyWithRetry(url, request, { target = "workflow", phase = "workflow" } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= DIFY_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(url, request);
    } catch (error) {
      lastError = error;
      if (attempt >= DIFY_FETCH_MAX_ATTEMPTS || !isRetryableDifyFetchError(error)) {
        throw buildDifyConnectionError({ target, phase, error, attempts: attempt });
      }
      await sleep(DIFY_FETCH_RETRY_DELAYS_MS[attempt - 1] ?? DIFY_FETCH_RETRY_DELAYS_MS.at(-1) ?? 0);
    }
  }
  throw buildDifyConnectionError({ target, phase, error: lastError, attempts: DIFY_FETCH_MAX_ATTEMPTS });
}

function isRetryableDifyFetchError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toLowerCase();
  return [
    "fetch failed",
    "network",
    "timeout",
    "timed out",
    "econnreset",
    "etimedout",
    "eai_again",
    "enotfound",
    "socket"
  ].some((keyword) => message.includes(keyword) || code.includes(keyword));
}

function buildDifyConnectionError({ target, phase, error, attempts }) {
  const safeMessage = sanitizeText(error?.message || "fetch failed");
  const retryText = attempts > 1 ? `；已重试 ${attempts}/${DIFY_FETCH_MAX_ATTEMPTS}` : "";
  const wrapped = new Error(`无法连接 Dify API：${target} ${phase} @ ${config.dify.base}（${safeMessage}${retryText}）`);
  wrapped.status = 502;
  return wrapped;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonMaybe(raw) {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    return trimmed;
  }
}

async function readDifyResponse(response) {
  if (typeof response.text === "function") {
    const text = await response.text();
    return { data: parseJsonText(text), text };
  }
  const data = await response.json().catch(() => null);
  return {
    data,
    text: data ? JSON.stringify(data) : ""
  };
}

function parseJsonText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function difyErrorMessage(status, message, phase, target = "import") {
  const safeMessage = sanitizeText(message);
  if (status === 401 || status === 403) {
    const action = phase === "parameters" ? "连通性测试" : "工作流调用";
    return `Dify ${action}鉴权失败：当前 ${difyApiKeyEnvName(target)} 无效或不属于当前 DIFY_API_BASE。请在自托管 Dify 的目标工作流中重新复制 API Key，并确认 DIFY_API_BASE 指向同一个 Dify 服务。底层错误：${safeMessage}`;
  }
  return safeMessage;
}

function normalizeDifyOutputEnvelope(raw) {
  const value = parseJsonMaybe(raw);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const mapped = value.result ?? value.text ?? value.output ?? value.data;
    if (mapped !== undefined) return parseJsonMaybe(mapped);
  }
  return value;
}

function coerceAnalysisJsonBySchema(value, schema) {
  if (!schema || !isPlainObject(schema)) return value;
  if (isPlainObject(value)) return value;
  const properties = isPlainObject(schema.properties) ? Object.keys(schema.properties) : [];
  if (properties.length === 1) {
    return { [properties[0]]: value };
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const matched = required.filter((key) => properties.includes(key));
  if (matched.length === 1) {
    return { [matched[0]]: value };
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDifyRouteEntities(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entity) => {
    if (!entity || typeof entity !== "object") return null;
    return {
      name: normalizeString(entity.name),
      type: normalizeString(entity.type),
      aliases: normalizeStringArray(entity.aliases),
      role: normalizeString(entity.role),
      note: normalizeString(entity.note)
    };
  }).filter((entity) => entity && entity.name);
}

function normalizeDifySignals(value) {
  if (!Array.isArray(value)) return [];
  return value.map((signal) => {
    if (!signal || typeof signal !== "object") return null;
    return {
      category: normalizeCategory(signal.category),
      strength: normalizeNumber(signal.strength),
      entities: normalizeStringArray(signal.entities),
      keywords: normalizeStringArray(signal.keywords),
      reason: normalizeString(signal.reason)
    };
  }).filter(Boolean);
}

function normalizeDifyCategoryScores(value) {
  const source = value && typeof value === "object" ? value : {};
  const scores = {};
  for (const category of DIFY_FACT_CATEGORIES) {
    scores[category] = normalizeNumber(source[category]);
  }
  return scores;
}

function normalizeDifyFact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    category: normalizeCategory(value.category),
    entity: normalizeString(value.entity),
    aliases: normalizeStringArray(value.aliases),
    tags: normalizeStringArray(value.tags),
    related_entities: normalizeStringArray(value.related_entities ?? value.relatedEntities),
    fact_type: normalizeString(value.fact_type ?? value.factType),
    fact: normalizeString(value.fact),
    evidence: normalizeStringArray(value.evidence),
    importance: normalizeNumber(value.importance),
    confidence: normalizeNumber(value.confidence),
    scope_eligible: value.scope_eligible === true,
    scope_basis: normalizeString(value.scope_basis),
    transformation_eligible: value.transformation_eligible === true,
    scope_fields_complete: ["scope_eligible", "scope_basis", "transformation_eligible", "creature_type", "original_form", "subject_key", "identity_basis"]
      .every((key) => Object.hasOwn(value, key)),
    creature_type: normalizeString(value.creature_type ?? value.creatureType),
    original_form: normalizeString(value.original_form ?? value.originalForm),
    qualification_evidence: normalizeStringArray(value.qualification_evidence ?? value.qualificationEvidence),
    subject_key: normalizeString(value.subject_key ?? value.subjectKey),
    identity_basis: normalizeString(value.identity_basis ?? value.identityBasis)
  };
}

function normalizeProfileAlias(value) {
  const source = isPlainObject(value) ? value : {};
  const evidence = normalizeProfileArray(source.evidence);
  const warnings = normalizeProfileArray(source.quality_warnings);
  const allowed = ["confirmed", "candidate", "rejected"];
  let relation = allowed.includes(source.alias_relation) ? source.alias_relation : "candidate";
  if (!allowed.includes(source.alias_relation)) warnings.push("别名关系枚举非法，已降级为候选");
  if (!evidence.length) {
    relation = "candidate";
    warnings.push("别名缺少原文证据，已降级为候选");
  }
  return {
    name: normalizeProfileText(source.name),
    alias_relation: relation,
    alias_confidence: normalizeNumber(source.alias_confidence),
    evidence,
    quality_warnings: uniqueProfileArray(warnings)
  };
}

function normalizeProfileStage(value) {
  const source = isPlainObject(value) ? value : {};
  const evidence = normalizeProfileArray(source.evidence);
  const warnings = normalizeProfileArray(source.quality_warnings);
  const allowedTypes = ["age", "form", "identity"];
  const allowedStability = ["stable", "temporary", "uncertain"];
  const stageType = allowedTypes.includes(source.stage_type) ? source.stage_type : "";
  let stability = allowedStability.includes(source.stage_stability) ? source.stage_stability : "uncertain";
  let stableDifference = source.stable_difference === true;
  if (!stageType) warnings.push("阶段类型枚举非法或缺失");
  if (!allowedStability.includes(source.stage_stability)) warnings.push("阶段稳定性枚举非法，已降级为不确定");
  if (typeof source.stable_difference !== "boolean") warnings.push("阶段稳定差异不是布尔值，已降级为 false");
  if (!evidence.length) {
    stability = "uncertain";
    stableDifference = false;
    warnings.push("阶段缺少独立原文证据，已降级为不确定");
  }
  return {
    name: normalizeProfileText(source.name),
    stage_hint: normalizeProfileText(source.stage_hint),
    stage_type: stageType,
    stage_stability: stability,
    stable_difference: stableDifference,
    age: normalizeProfileText(source.age),
    identity_profession: normalizeProfileText(source.identity_profession),
    stable_appearance: normalizeProfileText(source.stable_appearance),
    stable_temperament: normalizeProfileText(source.stable_temperament),
    original_facial_features: normalizeProfileText(source.original_facial_features),
    designed_facial_features: normalizeProfileText(source.designed_facial_features),
    design_basis: normalizeProfileArray(source.design_basis),
    evidence,
    quality_warnings: uniqueProfileArray(warnings)
  };
}

function normalizeProfileText(value) {
  return normalizeString(value).slice(0, 2000);
}

function normalizeProfileArray(value) {
  return uniqueProfileArray(Array.isArray(value) ? value.map(normalizeProfileText).filter(Boolean) : []).slice(0, 50);
}

function uniqueProfileArray(value) {
  return [...new Set(value)].slice(0, 50);
}

function normalizeCategory(value) {
  const normalized = normalizeString(value).toLowerCase();
  return DIFY_FACT_CATEGORIES.includes(normalized) ? normalized : "other";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeString(entry)).filter(Boolean);
}

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function normalizeInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : 0;
}

function extractChapters(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["chapters", "data", "items", "result", "records"]) {
      if (Array.isArray(value[key])) return value[key];
    }
    if (typeof value.content === "string" || typeof value.text === "string") return [value];
  }
  if (typeof value === "string") {
    return [{ content: value }];
  }
  return [];
}

const DIFY_FACT_CATEGORIES = [
  "character",
  "relationship",
  "cultivation",
  "force",
  "item",
  "magical_creature",
  "location",
  "event",
  "foreshadowing",
  "other"
];
