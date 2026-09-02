import crypto from "node:crypto";

import { config, requireDifyConfig } from "./config.js";
import {
  appendL2ChapterFacts,
  bookL1IndexPromptHash,
  clearL2Subjects,
  cancelPendingCharacterLibraryBuildItems,
  createCharacterLibraryBuild,
  createAnalysisRun,
  ensureBook,
  getBook,
  getAnalysisPromptSnapshot,
  getAnalysisRun,
  getAnalysisSummaryPartMetadata,
  getAnalysisSummaryPartResult,
  getBookIndexGroup,
  getBookIndexPrompts,
  getChapterContent,
  getExistingChapterIndexes,
  getFinalAnalysisResult,
  getL1ChapterIndex,
  getL1Coverage,
  getL2ChapterStatus,
  getL2Coverage,
  getCharacterLibraryBuild,
  getCharacterLibraryCharacter,
  listCharacterLibraryBuildItems,
  listCharacterLibraryCharacters,
  listCharacterChapterSourceStates,
  listCharacterL2FactsPage,
  listFreshCharacterChapterSources,
  indexGroupL2PromptHash,
  listAnalysisSummaryPartMetadata,
  listBookIndexGroups,
  listChapterMetadata,
  listL2ChapterStatuses,
  listL2Facts,
  listL2Subjects,
  normalizeBookId,
  normalizeBookName,
  normalizeChapterIndex,
  normalizeIndexGroupKey,
  normalizeRange,
  promoteL2CandidateFacts,
  replaceCharacterProjection,
  resetStaleCharacterLibraryBuildItems,
  saveCharacterLibraryBuildItem,
  saveAnalysisSummaryPart,
  saveChapter,
  saveFinalAnalysisResult,
  saveL1ChapterIndex,
  saveL2ChapterFacts,
  saveL2ChapterStatus,
  updateAnalysisRun,
  updateCharacterLibraryBuild,
  updateCharacterLibraryBuildControl,
  updateBookImportStatus,
  upsertL2Subject
} from "./db.js";
import {
  buildChapterBatches,
  fetchChapterBatch,
  normalizeDifyAnalysisJsonOutput,
  normalizeDifyAnalysisTextOutput,
  normalizeDifyL1Output,
  normalizeDifyL2Output,
  normalizeCharacterProfileOutput,
  runDifyWorkflow,
  testDifyConnection
} from "./dify.js";
import {
  assertNotCancelled,
  completeTask,
  createTask,
  failTask,
  findTask,
  isLiveTask,
  markTaskRunning,
  pauseTask,
  resumeTask,
  updateTask,
  waitIfPaused
} from "./tasks.js";
import { buildCharacterProfileInputs, characterProfileSchema } from "./indexing-inputs.js";
import {
  applyClassificationSignals,
  assignStableCharacterIds,
  CHARACTER_PROJECTION_RULE_VERSION,
  characterFactFingerprint,
  computeAffectedCharacterClosure,
  deriveCharacterStages,
  prepareCharacterLibraryBuild,
  resolveCharacterCandidates
} from "./character-library.js";
import { sanitizeText } from "./sanitize.js";

const SUMMARY_PART_INPUT_MAX_CHARS = 28_000;
const EVIDENCE_PACKET_CONTENT_CHARS = 260;
const EVIDENCE_PACKET_EVIDENCE_CHARS = 120;
const SUMMARY_FINAL_MAX_OUTPUT_TOKENS = 4500;
const SUMMARY_STAGE_MAX_ATTEMPTS = 3;
const SUMMARY_STAGE_RETRY_DELAY_MS = 1200;
const L2_QUERY_CANDIDATE_LIMIT = 2000;
const L2_QUERY_WINDOW_CHAPTERS = 120;
const L2_QUERY_MAX_FACTS = 160;
const L2_QUERY_COLLECTION_MAX_FACTS = 1200;
const L2_QUERY_DIFY_INPUT_MAX_CHARS = 20000;
const L2_SCHEMA_VERSION = "l2-facts-v1";
const L2_HISTORICAL_RESCAN_MAX_CHAPTERS = 80;
const MAGICAL_CREATURE_CATEGORY = "magical_creature";
const CHARACTER_PROFILE_SCHEMA_VERSION = "character-profile-v1";
const CHARACTER_L2_SCHEMA_VERSION = "l2-facts-v1";
const MAGICAL_CREATURE_SCOPE_BASES = new Set([
  "explicit_nonhuman_species",
  "explicit_sentience",
  "explicit_transformation",
  "explicit_supernatural_origin",
  "explicit_undead_origin",
  "explicit_fortune_manifestation",
  "explicit_plant_spirit"
]);

export function l1IndexExecutionSignature() {
  return `dify:l1:${config.dify.l1WorkflowVersion}`;
}

export function l2IndexExecutionSignature() {
  return `dify:l2:${config.dify.l2WorkflowVersion}`;
}

export function analysisSummaryExecutionSignature() {
  return `dify:analysis_summary:${config.dify.analysisSummaryWorkflowVersion}`;
}

async function ensureAnalysisSummaryProviderReady() {
  requireDifyConfig("analysis_summary");
  await testDifyConnection({ target: "analysis_summary" });
}

export function startAnalysisTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const indexGroupKeys = normalizeIndexGroupKeysForWorkflow(payload.index_group_keys ?? payload.indexGroupKeys ?? []);
  const chapterIndexes = normalizeChapterIndexes(payload.chapter_indexes ?? payload.chapterIndexes);
  const range = resolveAnalysisTaskRange({
    bookId,
    chapterIndexes,
    startChapter: payload.start_chapter ?? payload.startChapter,
    endChapter: payload.end_chapter ?? payload.endChapter
  });
  const name = String(payload.name || "").trim();
  const query = String(payload.query ?? payload.l2_query ?? payload.l2Query ?? "").trim();
  const task = createTask("analysis", {
    name,
    bookId,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    chapterCount: chapterIndexes.length || range.total,
    analysisMode: "l2_query",
    query
  });

  void runAnalysisTask(task, {
    name,
    bookId,
    ...range,
    chapterIndexes,
    indexGroupKeys,
    query
  });
  return task;
}

function resolveAnalysisTaskRange({ bookId, chapterIndexes = [], startChapter, endChapter }) {
  const hasStart = startChapter !== undefined && startChapter !== null && startChapter !== "";
  const hasEnd = endChapter !== undefined && endChapter !== null && endChapter !== "";
  if (hasStart && hasEnd) return normalizeRange(startChapter, endChapter);
  if (chapterIndexes.length) {
    return normalizeRange(chapterIndexes[0], chapterIndexes[chapterIndexes.length - 1]);
  }
  const chapters = listChapterMetadata(bookId);
  if (!chapters.length) {
    const error = new Error("本地章节库没有可分析的章节，请先导入章节原文。");
    error.status = 422;
    throw error;
  }
  return normalizeRange(chapters[0].chapter_index, chapters.at(-1).chapter_index);
}

function normalizeL2BuildMode(value) {
  return ["all", "missing", "retry_failed", "retry_empty"].includes(value) ? value : "all";
}

function prepareNewAnalysis(analysisId, { name, bookId, startChapter, endChapter, chapterIndexes = [], indexGroupKeys = [], query = "" }) {
  const indexGroups = resolveAnalysisIndexGroups({ bookId, indexGroupKeys });
  validateL2QueryBeforeRun({ query, indexGroups });
  const chapters = resolveSelectedChapters({ bookId, startChapter, endChapter, chapterIndexes });
  if (chapters.length === 0) {
    const error = new Error("本地章节库没有可分析的章节，请先导入章节原文。");
    error.status = 422;
    throw error;
  }
  const storedPromptHash = shaString(["l2_query", query, ...indexGroups.map((group) => group.group_key)].join("\n"));

  createAnalysisRun({
    id: analysisId,
    name,
    bookId,
    startChapter,
    endChapter,
    chapterSelection: {
      mode: chapterIndexes.length ? "indexes" : "range",
      chapter_indexes: chapters.map((chapter) => chapter.chapter_index)
    },
    model: analysisSummaryExecutionSignature(),
    reasoningEffort: "medium",
    promptHash: storedPromptHash,
    schemaHash: "",
    chapterCount: chapters.length,
    promptSnapshot: {
      analysis_mode: "l2_query",
      query,
      index_group_keys: indexGroups.map((group) => group.group_key)
    }
  });

  return {
    analysisId,
    bookId,
    startChapter,
    endChapter,
    chapters,
    indexGroups,
    query,
    resume: false
  };
}

function prepareResumedAnalysis(run) {
  if (!run) {
    const error = new Error("分析任务不存在。");
    error.status = 404;
    throw error;
  }
  if (run.result) {
    const error = new Error("分析任务已有最终结果，不需要续跑。");
    error.status = 409;
    throw error;
  }
  const snapshot = getAnalysisPromptSnapshot(run.id);
  if (!snapshot) {
    const error = new Error("旧任务缺少 Prompt 快照，无法安全续跑。请复制配置后新建分析任务。");
    error.status = 422;
    throw error;
  }
  const indexGroups = resolveAnalysisIndexGroups({
    bookId: run.book_id,
    indexGroupKeys: snapshot.index_group_keys || []
  });
  const query = String(snapshot.query || "").trim();
  validateL2QueryBeforeRun({ query, indexGroups });
  const selection = parseChapterSelection(run);
  const chapters = resolveSelectedChapters({
    bookId: run.book_id,
    startChapter: run.start_chapter,
    endChapter: run.end_chapter,
    chapterIndexes: selection.chapter_indexes
  });
  return {
    analysisId: run.id,
    bookId: run.book_id,
    startChapter: run.start_chapter,
    endChapter: run.end_chapter,
    chapters,
    indexGroups,
    query,
    resume: true
  };
}

async function executeAnalysisTask(task, prepared) {
  const {
    analysisId,
    bookId,
    startChapter,
    endChapter,
    indexGroups,
    query
  } = prepared;

  await ensureAnalysisSummaryProviderReady();
  updateAnalysisRun(analysisId, {
    status: "running",
    error_summary: ""
  });
  markTaskRunning(task, {
    result: { analysisId },
    progress: {
      total: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: "准备 L2 提问"
    }
  });

  return executeL2QueryAnalysisTask(task, {
    analysisId,
    bookId,
    startChapter,
    endChapter,
    indexGroups,
    model: analysisSummaryExecutionSignature(),
    reasoningEffort: "medium",
    outputSchemaHash: "",
    query
  });
}

async function callAnalysisJson({
  model,
  reasoningEffort,
  instructions,
  input,
  schema,
  schemaName = "result",
  maxOutputTokens,
  strict = true,
  errorLabel = "Dify 分析工作流"
}) {
  const outputs = await runDifyWorkflow({
    target: "analysis_summary",
    apiKey: config.dify.analysisSummaryWorkflowApiKey,
    inputs: {
      task_type: "summary",
      prompt: String(instructions || ""),
      model: String(model || ""),
      reasoning_effort: String(reasoningEffort || ""),
      schema_name: String(schemaName || "result"),
      schema_json: JSON.stringify(schema || {}),
      strict_json_schema: String(Boolean(strict)),
      max_output_tokens: Number.isFinite(Number(maxOutputTokens)) ? String(Number(maxOutputTokens)) : "",
      context_json: JSON.stringify(input || [])
    }
  });
  return {
    value: normalizeDifyAnalysisJsonOutput(outputs, schema || null, { errorLabel }),
    responseId: outputs.response_id || outputs.responseId || null
  };
}

async function callAnalysisText({
  model,
  reasoningEffort,
  instructions,
  input,
  maxOutputTokens,
  errorLabel = "Dify 分析工作流"
}) {
  const outputs = await runDifyWorkflow({
    target: "analysis_summary",
    apiKey: config.dify.analysisSummaryWorkflowApiKey,
    inputs: {
      task_type: "summary",
      prompt: String(instructions || ""),
      model: String(model || ""),
      reasoning_effort: String(reasoningEffort || ""),
      max_output_tokens: Number.isFinite(Number(maxOutputTokens)) ? String(Number(maxOutputTokens)) : "",
      context_json: JSON.stringify(input || [])
    }
  });
  return {
    value: normalizeDifyAnalysisTextOutput(outputs, { errorLabel }),
    responseId: outputs.response_id || outputs.responseId || null
  };
}

export function publicAnalysisRunWithResult(id) {
  const run = getAnalysisRun(id);
  if (!run) {
    const error = new Error("分析任务不存在。");
    error.status = 404;
    throw error;
  }
  const summaryParts = listAnalysisSummaryPartMetadata(id);
  const sourceTrace = sourceTraceFromSummaryParts(summaryParts);
  return {
    ...publicAnalysisRun(run),
    chapters: [],
    chapterResults: [],
    failedChapterIndexes: [],
    pendingChapterIndexes: [],
    completedChapterIndexes: [],
    canResume: canResumeAnalysisRun(run),
    summaryParts,
    summaryProgress: summaryProgressFromParts(summaryParts),
    failedSummaryParts: summaryParts.filter((part) => part.status === "failed"),
    canResumeSummary: summaryParts.some((part) => part.status === "failed"),
    sourceTrace,
    sourceTraceSummary: sourceTraceSummary(sourceTrace),
    prompt: getAnalysisPromptSnapshot(id),
    finalResult: run.status === "completed" && run.result ? getFinalAnalysisResult(id) : null
  };
}

function canResumeAnalysisRun(run) {
  return Boolean(run && run.prompt_snapshot && !run.result && run.status !== "completed");
}

export function getL2IndexCoverageForBook({ bookId, indexGroupKey = "base", startChapter, endChapter }) {
  const indexGroup = getBookIndexGroup(bookId, indexGroupKey);
  if (!indexGroup || !indexGroup.enabled) {
    const error = new Error(`索引组不存在或已禁用：${indexGroupKey || "base"}`);
    error.status = 404;
    throw error;
  }
  return getL2Coverage({
    bookId,
    indexGroupKey: indexGroup.group_key,
    startChapter,
    endChapter,
    model: l2IndexExecutionSignature(),
    promptHash: indexGroupL2PromptHash(indexGroup),
    schemaVersion: L2_SCHEMA_VERSION
  });
}

export function getL1IndexCoverageForBook({ bookId, startChapter, endChapter }) {
  const bookPrompts = getBookIndexPrompts(bookId);
  return getL1Coverage({
    bookId,
    startChapter,
    endChapter,
    model: l1IndexExecutionSignature(),
    promptHash: bookL1IndexPromptHash(bookPrompts)
  });
}

export function listL2FactsForBook({ bookId, indexGroupKey, indexGroupKeys, startChapter, endChapter, category, entity, limit }) {
  const keys = indexGroupKeys || indexGroupKey || "base";
  return listL2Facts({
    bookId,
    indexGroupKeys: keys,
    startChapter,
    endChapter,
    categories: category ? String(category).split(",") : [],
    entity,
    limit,
    includeContent: true
  });
}

export function startCharacterLibraryTask(payload = {}) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const indexGroupKey = normalizeIndexGroupKey(payload.index_group_key ?? payload.indexGroupKey ?? "characters");
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const requestedBuildId = String(payload.build_id ?? payload.buildId ?? "").trim();
  const snapshot = requestedBuildId ? null : loadCharacterBuildSnapshot({ bookId, indexGroupKey, ...range });
  const build = requestedBuildId ? getCharacterLibraryBuild(requestedBuildId) : createCharacterLibraryBuild({
    bookId,
    indexGroupKey,
    ...range,
    sourceFingerprint: snapshot.source_fingerprint
  });
  if (!build) throw httpError("character library build not found", 404);
  if (isLiveTask(findTask(build.id))) throw httpError("character library build already has a live task", 409);

  const task = createTask("character-library", { bookId, indexGroupKey, ...range }, { id: build.id });
  task.result = { buildId: build.id };
  void runCharacterLibraryTask(task, { bookId, indexGroupKey, ...range, buildId: build.id, snapshot })
    .catch((error) => {
      const buildId = task.result?.buildId;
      const build = buildId ? getCharacterLibraryBuild(buildId) : null;
      if (build?.status === "running") {
        updateCharacterLibraryBuild(buildId, {
          status: task.cancelled || build.control_state === "cancel_requested" ? "cancelled" : "failed",
          errorSummary: error?.message || String(error)
        });
      }
      if (task.cancelled || build?.control_state === "cancel_requested") {
        updateTask(task, { status: "cancelled", error: "", message: "角色库构建已取消。" }, "cancelled");
      } else {
        failTask(task, error);
      }
    });
  return task;
}

export function pauseCharacterLibraryBuild(buildId) {
  const build = updateCharacterLibraryBuildControl(buildId, "pause_requested");
  const task = findTask(build.id);
  if (isLiveTask(task)) pauseTask(build.id);
  return task || build;
}

export function resumeCharacterLibraryBuild(buildId) {
  const build = getCharacterLibraryBuild(buildId);
  if (!build) throw httpError("character library build not found", 404);
  if (build.status !== "running") throw httpError("character library build is not resumable", 409);
  const task = findTask(build.id);
  if (isLiveTask(task)) {
    updateCharacterLibraryBuildControl(build.id, "active");
    resumeTask(build.id);
    return task;
  }
  updateCharacterLibraryBuildControl(build.id, "active");
  return startCharacterLibraryTask({
    book_id: build.book_id,
    index_group_key: build.index_group_key,
    start_chapter: build.start_chapter,
    end_chapter: build.end_chapter,
    build_id: build.id
  });
}

export function cancelCharacterLibraryBuild(buildId) {
  const build = updateCharacterLibraryBuildControl(buildId, "cancel_requested");
  const task = findTask(build.id);
  if (isLiveTask(task)) {
    task.paused = false;
    updateTask(task, {
      status: "running",
      result: { ...(task.result || {}), cancelRequested: true },
      message: "角色库构建已请求取消。"
    }, "progress");
    return task;
  }
  return startCharacterLibraryTask({
    book_id: build.book_id,
    index_group_key: build.index_group_key,
    start_chapter: build.start_chapter,
    end_chapter: build.end_chapter,
    build_id: build.id
  });
}

async function runCharacterLibraryTask(task, input) {
  const snapshot = input.snapshot || loadCharacterBuildSnapshot(input);
  const previous = listCharacterLibraryCharacters({ bookId: input.bookId })
    .map((row) => getCharacterLibraryCharacter(input.bookId, row.id));
  const build = input.buildId
    ? getCharacterLibraryBuild(input.buildId)
    : createCharacterLibraryBuild({
      bookId: input.bookId,
      indexGroupKey: input.indexGroupKey,
      startChapter: input.startChapter,
      endChapter: input.endChapter,
      sourceFingerprint: snapshot.source_fingerprint
    });
  task.result = { buildId: build?.id || String(input.buildId || "") };
  if (!build || build.book_id !== input.bookId || build.status !== "running") throw new Error("character library build is not resumable");
  if (build.index_group_key !== input.indexGroupKey || build.start_chapter !== input.startChapter || build.end_chapter !== input.endChapter) {
    throw new Error("character library build resume scope mismatch");
  }
  if (build.source_fingerprint !== snapshot.source_fingerprint) throw new Error("character library build resume source mismatch");
  resetStaleCharacterLibraryBuildItems(build.id, { staleBefore: new Date(Date.now() - 60_000).toISOString() });
  markTaskRunning(task, {
    result: { buildId: build.id },
    progress: { total: snapshot.candidates.length, completed: 0, failed: 0, skipped: 0, current: "角色语义分类" }
  });

  let preclassifiedReusable = findUnchangedCharacters(snapshot.candidates, previous);
  const sourceClosure = computeAffectedCharacterClosure(previous, snapshot.candidates, { compareAliases: false });
  const sourceAffectedNames = new Set(sourceClosure.affected_names);
  for (const candidate of snapshot.candidates) {
    if (sourceAffectedNames.has(candidate.canonical_name)) preclassifiedReusable.delete(candidate.candidate_fingerprint);
  }
  const candidatesToClassify = snapshot.candidates.filter((candidate) => !preclassifiedReusable.has(candidate.candidate_fingerprint));
  const classifiedFacts = [];
  const classifications = new Map();
  const classificationFailures = new Map();
  const sourceFingerprintByName = new Map(snapshot.candidates.map((candidate) => [candidate.canonical_name, candidate.candidate_fingerprint]));
  const checkpoints = new Map(listCharacterLibraryBuildItems(build.id).map((item) => [item.candidate_fingerprint, item]));
  for (const candidate of candidatesToClassify) {
    await waitForCharacterBuildControl(task, build.id);
    const checkpoint = checkpoints.get(candidate.candidate_fingerprint);
    try {
      const profile = Object.keys(checkpoint?.classification_output || {}).length
        ? checkpoint.classification_output
        : await callCharacterProfile(input.bookId, candidate, candidate.stages);
      classifications.set(candidate.canonical_name, profile);
      classifiedFacts.push(...applyClassificationSignals(candidate, profile));
      saveCharacterLibraryBuildItem(build.id, {
        item_key: candidate.candidate_fingerprint,
        candidate_fingerprint: candidate.candidate_fingerprint,
        source_fact_fingerprints: candidate.facts.map((fact) => fact.fingerprint),
        input_payload: candidate,
        classification_output: profile,
        status: "pending",
        attempt_count: Number(checkpoint?.attempt_count || 0)
      });
    } catch (error) {
      classificationFailures.set(candidate.canonical_name, error);
      classifiedFacts.push(...candidate.facts);
    }
  }
  const projected = resolveCharacterCandidates(classifiedFacts).map((candidate) => ({
    ...candidate,
    facts: candidate.facts.map((fact) => ({ ...fact, fingerprint: fact.fingerprint || characterFactFingerprint(fact) })),
    stages: deriveCharacterStages(candidate.canonical_name, candidate.facts),
    candidate_fingerprint: crypto.createHash("sha256").update(JSON.stringify([
      candidate.canonical_name,
      candidate.aliases,
      candidate.facts.map((fact) => fact.fingerprint || characterFactFingerprint(fact)).sort()
    ])).digest("hex")
  }));
  const closureCandidates = [...projected, ...snapshot.candidates.filter((candidate) => preclassifiedReusable.has(candidate.candidate_fingerprint))];
  const closure = computeAffectedCharacterClosure(previous, closureCandidates);
  const affectedNames = new Set(closure.affected_names);
  const reusable = new Map([...preclassifiedReusable, ...findUnchangedCharacters(projected, previous)]);
  for (const candidate of closureCandidates) {
    if (affectedNames.has(candidate.canonical_name)) reusable.delete(candidate.candidate_fingerprint);
  }
  const identified = assignStableCharacterIds(input.bookId, projected, previous);
  const previousById = new Map(previous.map((character) => [character.id, character]));
  const existingItems = new Map(listCharacterLibraryBuildItems(build.id).map((item) => [item.candidate_fingerprint, item]));
  const output = [];
  const retryList = [];
  let failed = 0;
  let unsafeAssembly = false;

  for (const candidate of closureCandidates) {
    const reused = reusable.get(candidate.candidate_fingerprint);
    if (!reused) continue;
    output.push(reused);
    saveCharacterLibraryBuildItem(build.id, {
      item_key: candidate.candidate_fingerprint,
      candidate_fingerprint: candidate.candidate_fingerprint,
      source_fact_fingerprints: candidate.facts.map((fact) => fact.fingerprint),
      input_payload: candidate,
      profile_output: reused,
      fallback_payload: reused,
      previous_character_id: reused.id,
      identity_match: { reused: true, reason: "unchanged_facts" },
      status: "reused",
      completed_at: new Date().toISOString()
    });
  }

  for (const candidate of identified) {
    if (reusable.has(candidate.candidate_fingerprint)) continue;
    await waitForCharacterBuildControl(task, build.id);
    const candidateFingerprint = sourceFingerprintByName.get(candidate.canonical_name) || crypto.createHash("sha256").update(JSON.stringify([
      candidate.canonical_name,
      candidate.aliases,
      candidate.facts.map((fact) => fact.fingerprint).sort()
    ])).digest("hex");
    const priorItem = existingItems.get(candidateFingerprint);
    if (["succeeded", "reused"].includes(priorItem?.status) && priorItem.profile_output?.id) {
      output.push(priorItem.profile_output);
      continue;
    }
    const fallback = previousById.get(candidate.id) || null;
    saveCharacterLibraryBuildItem(build.id, {
      item_key: candidateFingerprint,
      candidate_fingerprint: candidateFingerprint,
      source_fact_fingerprints: candidate.facts.map((fact) => fact.fingerprint),
      input_payload: candidate,
      classification_output: classifications.get(candidate.canonical_name) || {},
      fallback_payload: fallback || {},
      previous_character_id: fallback?.id || "",
      identity_match: { reused: Boolean(fallback) },
      quality_warnings: candidate.quality_warnings,
      status: "running",
      attempt_count: Number(priorItem?.attempt_count || 0) + 1,
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString()
    });
    try {
      if (classificationFailures.has(candidate.canonical_name)) throw classificationFailures.get(candidate.canonical_name);
      const profile = await callCharacterProfile(input.bookId, candidate, candidate.stages);
      if (!profile.stages.length) throw new Error("Dify character profile has no stages");
      const projection = profileToProjection(candidate, profile);
      output.push(projection);
      saveCharacterLibraryBuildItem(build.id, {
        item_key: candidateFingerprint,
        candidate_fingerprint: candidateFingerprint,
        source_fact_fingerprints: candidate.facts.map((fact) => fact.fingerprint),
        input_payload: candidate,
        classification_output: classifications.get(candidate.canonical_name) || {},
        profile_output: projection,
        fallback_payload: fallback || {},
        previous_character_id: fallback?.id || "",
        identity_match: { reused: Boolean(fallback) },
        quality_warnings: candidate.quality_warnings,
        status: "succeeded",
        attempt_count: Number(priorItem?.attempt_count || 0) + 1,
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      failed += 1;
      retryList.push(candidateFingerprint);
      const relatedFallbacks = fallback ? [fallback] : findRelatedPreviousCharacters(candidate, previous);
      if (relatedFallbacks.length) output.push(...relatedFallbacks.map((character) => markFallbackStale(character, "identity_ambiguous_fallback")));
      if (!relatedFallbacks.length && previous.length && candidate.quality_warnings.includes("identity_ambiguous")) unsafeAssembly = true;
      saveCharacterLibraryBuildItem(build.id, {
        item_key: candidateFingerprint,
        candidate_fingerprint: candidateFingerprint,
        source_fact_fingerprints: candidate.facts.map((fact) => fact.fingerprint),
        input_payload: candidate,
        classification_output: classifications.get(candidate.canonical_name) || {},
        fallback_payload: relatedFallbacks.length === 1 ? relatedFallbacks[0] : { characters: relatedFallbacks },
        previous_character_id: fallback?.id || "",
        identity_match: { reused: Boolean(fallback) },
        quality_warnings: [...candidate.quality_warnings, "profile_failed"],
        status: "failed",
        attempt_count: Number(priorItem?.attempt_count || 0) + 1,
        error_summary: error?.message || String(error),
        completed_at: new Date().toISOString()
      });
    }
    updateTask(task, {
      progress: { total: identified.length, completed: output.length - failed, failed, skipped: 0, current: candidate.canonical_name }
    });
  }
  await waitForCharacterBuildControl(task, build.id);
  if (unsafeAssembly) {
    updateCharacterLibraryBuild(build.id, { status: "failed", errorSummary: "ambiguous failed character cannot be safely merged" });
    throw new Error("ambiguous failed character cannot be safely merged");
  }
  const verification = loadCharacterBuildSnapshot(input);
  if (verification.source_fingerprint !== snapshot.source_fingerprint) {
    updateCharacterLibraryBuild(build.id, { status: "failed", errorSummary: "character source changed during build" });
    throw new Error("character source changed during build");
  }
  const quality = { ...snapshot.quality, failed_character_count: failed, retry_list: retryList, warning_count: snapshot.quality.warning_count + failed };
  const status = failed > 0 || snapshot.coverage.is_partial ? "partial" : "completed";
  if (snapshot.coverage.is_partial) {
    const outputIds = new Set(output.map((character) => character.id));
    for (const character of previous) {
      if (!outputIds.has(character.id) && shouldRetainForPartialCoverage(character, snapshot.coverage)) {
        output.push(markFallbackStale(character, "coverage_incomplete"));
      }
    }
  }
  const completeOutput = [...new Map(output.map((character) => [character.id, character])).values()];
  replaceCharacterProjection(build.id, completeOutput, { status, coverage: snapshot.coverage, quality });
  completeTask(task, { buildId: build.id, status, failed, retry_list: retryList });
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function loadCharacterBuildSnapshot({ bookId, indexGroupKey, startChapter, endChapter }) {
  const bookPrompts = getBookIndexPrompts(bookId);
  const indexGroup = getBookIndexGroup(bookId, indexGroupKey);
  if (!indexGroup) throw new Error("character index group not found");
  const freshSources = listFreshCharacterChapterSources({
    bookId, indexGroupKey, startChapter, endChapter,
    l1Model: l1IndexExecutionSignature(), l1PromptHash: bookL1IndexPromptHash(bookPrompts),
    l2Model: l2IndexExecutionSignature(), l2PromptHash: indexGroupL2PromptHash(indexGroup), l2SchemaVersion: CHARACTER_L2_SCHEMA_VERSION
  });
  const storedSourceStates = new Map(listCharacterChapterSourceStates({ bookId, indexGroupKey, startChapter, endChapter })
    .map((row) => [row.chapter_index, row]));
  const sourceStates = Array.from({ length: endChapter - startChapter + 1 }, (_, offset) => {
    const chapterIndex = startChapter + offset;
    return storedSourceStates.get(chapterIndex) || {
      chapter_index: chapterIndex,
      content_hash: "",
      l1_status: "missing",
      l1_source_hash: "",
      l1_model: "",
      l1_prompt_hash: "",
      l2_status: "missing",
      l2_source_hash: "",
      l2_model: "",
      l2_prompt_hash: "",
      l2_schema_version: ""
    };
  });
  const freshChapters = freshSources.map((row) => row.chapter_index);
  const facts = [];
  if (freshChapters.length > 0) {
    let cursor = null;
    do {
      const page = listCharacterL2FactsPage({ bookId, indexGroupKey, startChapter, endChapter, chapterIndexes: freshChapters, cursor, pageSize: 200 });
      facts.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
  }
  const expected = endChapter - startChapter + 1;
  const coverage = {
    start_chapter: startChapter,
    end_chapter: endChapter,
    l1_completed: freshChapters.length,
    l2_completed: freshChapters.length,
    failed_chapters: Array.from({ length: expected }, (_, offset) => startChapter + offset).filter((chapter) => !freshChapters.includes(chapter)),
    empty_signal_chapters: [],
    is_partial: freshChapters.length < expected
  };
  const profileInputs = buildCharacterProfileInputs({});
  return prepareCharacterLibraryBuild({ facts, coverage, versions: {
    source_chapters: sourceStates,
    task2_rule_version: CHARACTER_PROJECTION_RULE_VERSION,
    task4_schema_version: CHARACTER_PROFILE_SCHEMA_VERSION,
    task4_schema_hash: shaString(JSON.stringify(characterProfileSchema())),
    task4_prompt_hash: shaString(profileInputs.prompt),
    dify_workflow_version: config.dify.analysisSummaryWorkflowVersion
  } });
}

async function callCharacterProfile(bookId, character, stages) {
  const inputs = buildCharacterProfileInputs({ book: getBook(bookId), character, stages });
  const outputs = await runDifyWorkflow({
    target: "analysis_summary",
    apiKey: config.dify.analysisSummaryWorkflowApiKey,
    inputs: {
      task_type: "summary",
      prompt: inputs.prompt,
      model: analysisSummaryExecutionSignature(),
      reasoning_effort: "medium",
      schema_name: "character_profile",
      schema_json: JSON.stringify(characterProfileSchema()),
      strict_json_schema: "true",
      context_json: JSON.stringify({
        book: JSON.parse(inputs.book_json),
        character: JSON.parse(inputs.character_json),
        stages: JSON.parse(inputs.stages_json)
      })
    }
  });
  return normalizeCharacterProfileOutput(outputs);
}

async function waitForCharacterBuildControl(task, buildId) {
  assertNotCancelled(task);
  await waitIfPaused(task);
  while (true) {
    const build = getCharacterLibraryBuild(buildId);
    if (build.control_state === "cancel_requested") {
      cancelPendingCharacterLibraryBuildItems(buildId);
      updateCharacterLibraryBuild(buildId, { status: "cancelled", errorSummary: "cancelled" });
      throw new Error("character library build cancelled");
    }
    if (!["pause_requested", "paused"].includes(build.control_state)) return;
    if (build.control_state === "pause_requested") updateCharacterLibraryBuildControl(buildId, "paused");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function findUnchangedCharacters(candidates, previousCharacters) {
  const matches = new Map();
  const previousByName = new Map();
  for (const character of previousCharacters) {
    const names = [character.canonical_name, ...(character.aliases || [])];
    for (const name of names) {
      const values = previousByName.get(name) || [];
      values.push(character);
      previousByName.set(name, values);
    }
  }
  for (const candidate of candidates) {
    const names = [candidate.canonical_name, ...(candidate.aliases || [])];
    const possible = [...new Set(names.flatMap((name) => previousByName.get(name) || []))];
    if (possible.length !== 1) continue;
    const previous = possible[0];
    const currentFacts = candidate.facts.map((fact) => fact.fingerprint || characterFactFingerprint(fact)).sort();
    const previousFacts = previous.stages.flatMap((stage) => stage.facts.map((fact) => fact.fingerprint)).sort();
    if (currentFacts.length !== previousFacts.length || currentFacts.some((value, index) => value !== previousFacts[index])) continue;
    matches.set(candidate.candidate_fingerprint, previous);
  }
  return matches;
}

function profileToProjection(candidate, profile) {
  const aliases = profile.aliases.filter((alias) => alias.alias_relation === "confirmed").map((alias) => alias.name);
  return {
    id: candidate.id,
    canonical_name: candidate.canonical_name,
    aliases: [...new Set([...candidate.aliases, ...aliases])],
    gender: profile.gender,
    first_chapter: Math.min(...candidate.facts.map((fact) => fact.chapter_index)),
    last_chapter: Math.max(...candidate.facts.map((fact) => fact.chapter_index)),
    profile_status: "complete",
    quality_status: candidate.quality_warnings.length ? "warning" : "ok",
    stages: candidate.stages.map((stage, index) => {
      const value = profile.stages.find((item) => item.name === stage.name) || profile.stages[index] || {};
      return {
        id: stage.id,
        name: stage.name,
        stage_type: stage.type,
        age: value.age,
        identity_profession: value.identity_profession,
        stable_appearance: value.stable_appearance,
        stable_temperament: value.stable_temperament,
        original_facial_features: value.original_facial_features,
        designed_facial_features: value.designed_facial_features,
        design_basis: value.design_basis,
        source_version: analysisSummaryExecutionSignature(),
        quality_status: value.quality_warnings?.length ? "warning" : "ok",
        facts: stage.facts.map((fact) => ({ ...fact, fingerprint: fact.fingerprint || characterFactFingerprint(fact) }))
      };
    })
  };
}

function shouldRetainForPartialCoverage(character, coverage) {
  const sourceChapters = [...new Set(character.stages
    .flatMap((stage) => stage.facts)
    .map((fact) => Number(fact.chapter_index))
    .filter((chapter) => Number.isInteger(chapter) && chapter > 0))];
  if (!sourceChapters.length) return true;
  const unavailable = new Set(coverage.failed_chapters || []);
  return sourceChapters.some((chapter) =>
    chapter < coverage.start_chapter || chapter > coverage.end_chapter || unavailable.has(chapter)
  );
}

function findRelatedPreviousCharacters(candidate, previousCharacters) {
  const names = new Set([candidate.canonical_name, ...(candidate.aliases || [])]);
  const facts = new Set(candidate.facts.map((fact) => fact.fingerprint || characterFactFingerprint(fact)));
  return previousCharacters.filter((character) => {
    if ([character.canonical_name, ...(character.aliases || [])].some((name) => names.has(name))) return true;
    return character.stages.some((stage) => stage.facts.some((fact) => facts.has(fact.fingerprint)));
  });
}

function markFallbackStale(character, warning = "profile_failed") {
  return {
    ...character,
    profile_status: "partial",
    quality_status: "stale",
    quality_warnings: [...new Set([...(character.quality_warnings || []), warning])],
    stages: character.stages.map((stage) => ({ ...stage, quality_status: "stale" }))
  };
}


export function startImportTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const bookName = normalizeBookName(payload.book_name ?? payload.bookName);
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const force = Boolean(payload.force);
  const task = createTask("import", {
    bookId,
    bookName,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    force,
    autoL1Index: Boolean(payload.auto_l1_index ?? payload.autoL1Index)
  });

  void runImportTask(task, { bookId, bookName, ...range, force });
  return task;
}

export function startL1IndexTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const force = Boolean(payload.force);
  const task = createTask("l1-index", {
    bookId,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    force,
    mode: "chapter-only"
  });

  void runL1IndexTask(task, { bookId, ...range, force });
  return task;
}

export function startL2IndexTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const indexGroupKey = normalizeIndexGroupKey(payload.index_group_key ?? payload.indexGroupKey ?? "base");
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const force = Boolean(payload.force);
  const mode = normalizeL2BuildMode(payload.mode || payload.build_mode || payload.buildMode);
  const task = createTask("l2-index", {
    bookId,
    indexGroupKey,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    force,
    mode
  });

  void runL2IndexTask(task, { bookId, indexGroupKey, ...range, force, mode });
  return task;
}

export function resumeAnalysisRunTask(id) {
  const analysisId = String(id || "");
  const existingTask = findTask(analysisId);
  if (isLiveTask(existingTask)) return existingTask;

  const run = getAnalysisRun(analysisId);
  if (!run) {
    const error = new Error("分析任务不存在。");
    error.status = 404;
    throw error;
  }
  if (run.result) {
    const error = new Error("分析任务已有最终结果，不需要续跑。");
    error.status = 409;
    throw error;
  }
  if (!run.prompt_snapshot) {
    const error = new Error("旧任务缺少 Prompt 快照，无法安全续跑。请复制配置后新建分析任务。");
    error.status = 422;
    throw error;
  }

  const selection = parseChapterSelection(run);
  const task = createTask("analysis", {
    name: run.name,
    bookId: run.book_id,
    startChapter: run.start_chapter,
    endChapter: run.end_chapter,
    chapterCount: selection.chapter_indexes.length || run.chapter_count,
    resumeAnalysisId: analysisId
  }, { id: analysisId });

  void runAnalysisTask(task, {
    analysisId,
    resume: true,
    run
  });
  return task;
}

async function runImportTask(task, { bookId, bookName, startChapter, endChapter, total, force }) {
  try {
    ensureBook(bookId, bookName);
    updateBookImportStatus(bookId, "running");
    markTaskRunning(task, {
      progress: {
        total,
        completed: 0,
        failed: 0,
        skipped: 0,
        current: "准备导入"
      }
    });
    updateTask(task, {
      progress: { ...task.progress, current: "检查 Dify 配置" },
      message: "正在检查 Dify 工作流 API Key"
    });
    await testDifyConnection();

    const existing = force ? new Set() : getExistingChapterIndexes(bookId, startChapter, endChapter);
    const batches = buildChapterBatches(startChapter, endChapter);
    let lastBatchError = "";

    for (const batch of batches) {
      await waitIfPaused(task);
      const indexes = rangeIndexes(batch.startChapter, batch.endChapter);
      const missing = indexes.filter((index) => !existing.has(index));
      if (missing.length === 0) {
        task.progress.skipped += indexes.length;
        task.progress.completed += indexes.length;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过 ${batch.startChapter}-${batch.endChapter}` },
          message: `章节 ${batch.startChapter}-${batch.endChapter} 已存在，跳过。`
        });
        continue;
      }

      updateTask(task, {
        progress: { ...task.progress, current: `Dify 获取 ${batch.startChapter}-${batch.endChapter}` },
        message: `正在获取章节 ${batch.startChapter}-${batch.endChapter}`
      });

      try {
        const chapters = await fetchChapterBatch({
          bookId,
          startChapter: missing[0],
          endChapter: missing[missing.length - 1]
        });
        const byIndex = new Map(chapters.map((chapter) => [chapter.chapter_index, chapter]));

        for (const chapterIndex of missing) {
          await waitIfPaused(task);
          const chapter = byIndex.get(chapterIndex);
          if (!chapter || !chapter.content) {
            task.progress.failed += 1;
            updateTask(task, {
              progress: { ...task.progress, current: `章节 ${chapterIndex} 获取为空` },
              message: `章节 ${chapterIndex} 未返回正文。`
            }, "warning");
            continue;
          }

          saveChapter({
            bookId,
            chapterIndex,
            title: chapter.chapter_title,
            content: chapter.content,
            fetchStatus: chapter.fetch_status
          });
          task.progress.completed += 1;
          updateTask(task, {
            progress: { ...task.progress, current: `已保存章节 ${chapterIndex}` },
            message: `已保存章节 ${chapterIndex}`
          });
        }
      } catch (error) {
        if (error?.status === 499) throw error;
        lastBatchError = sanitizeText(error.message);
        task.progress.failed += missing.length;
        updateTask(task, {
          progress: { ...task.progress, current: `批次 ${batch.startChapter}-${batch.endChapter} 失败` },
          message: `批次失败：${sanitizeText(error.message)}`
        }, "warning");
      }
    }

    const savedCount = task.progress.completed - task.progress.skipped;
    if (task.progress.failed > 0 && savedCount <= 0) {
      updateBookImportStatus(bookId, "failed");
      const suffix = lastBatchError ? `最后一次 Dify 错误：${lastBatchError}` : "请检查 Dify API Base、Workflow API Key 和 Dify 工作流输入字段。";
      throw new Error(`所有待导入批次都失败了。${suffix}`);
    }

    const finalStatus = task.progress.failed > 0 ? "completed_with_errors" : "completed";
    updateBookImportStatus(bookId, finalStatus);
    completeTask(task, {
      bookId,
      chapters: listChapterMetadata(bookId),
      status: finalStatus
    });
  } catch (error) {
    if (error?.status === 499) {
      updateBookImportStatus(bookId, "cancelled");
      return;
    }
    updateBookImportStatus(bookId, "failed");
    failTask(task, error);
  }
}

async function runL1IndexTask(task, { bookId, startChapter, endChapter, force }) {
  const bookPrompts = getBookIndexPrompts(bookId);
  const executionModel = l1IndexExecutionSignature();
  const indexPromptHash = bookL1IndexPromptHash(bookPrompts);
  try {
    const chapters = listChapterMetadata(bookId)
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter);
    if (!chapters.length) {
      const error = new Error("本地章节库没有可构建 L1 索引的章节，请先导入章节原文。");
      error.status = 422;
      throw error;
    }

    await testDifyConnection({ target: "l1" });
    markTaskRunning(task, {
      progress: {
        total: chapters.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        current: "准备构建逐章 L1 索引"
      }
    });

    for (const chapter of chapters) {
      await waitIfPaused(task);
      const existing = getL1ChapterIndex(bookId, chapter.chapter_index);
      if (!force && existing?.status === "completed" && existing.source_hash === chapter.content_hash && existing.model === executionModel && existing.prompt_hash === indexPromptHash) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} L1 索引已存在，跳过。`
        });
        continue;
      }

      updateTask(task, {
        progress: { ...task.progress, current: `L1 章节索引 ${chapter.chapter_index}` },
        message: `正在构建章节 ${chapter.chapter_index} L1 索引`
      });

      try {
        assertNotCancelled(task);
        const content = getChapterContent(bookId, chapter.chapter_index);
        const value = normalizeDifyL1Output(await runDifyWorkflow({
          apiKey: config.dify.l1ApiKey,
          target: "l1",
          inputs: {
            book_id: bookId,
            chapter_index: chapter.chapter_index,
            chapter_title: chapter.title || "",
            chapter_content: content,
            index_prompt: bookPrompts.l1_index_prompt
          }
        }));
        saveL1ChapterIndex({
          bookId,
          chapterIndex: chapter.chapter_index,
          status: "completed",
          sourceHash: chapter.content_hash,
          model: executionModel,
          promptHash: indexPromptHash,
          value
        });
        task.progress.completed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L1 完成` },
          message: `章节 ${chapter.chapter_index} L1 索引完成`
        });
        assertNotCancelled(task);
      } catch (error) {
        if (error?.status === 499) throw error;
        const safeMessage = sanitizeText(error.message);
        saveL1ChapterIndex({
          bookId,
          chapterIndex: chapter.chapter_index,
          status: "failed",
          sourceHash: chapter.content_hash,
          model: executionModel,
          promptHash: indexPromptHash,
          errorSummary: safeMessage
        });
        task.progress.failed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L1 失败` },
          message: `章节 ${chapter.chapter_index} L1 失败：${safeMessage}`
        }, "warning");
        if (isFatalUpstreamError(safeMessage)) {
          throw new Error(`L1 构建已停止：${safeMessage}`, { cause: error });
        }
      }
    }

    completeTask(task, {
      bookId,
      coverage: getL1Coverage({ bookId, startChapter, endChapter, model: executionModel, promptHash: indexPromptHash })
    });
  } catch (error) {
    if (error?.status === 499) return;
    failTask(task, error);
  }
}

async function runL2IndexTask(task, { bookId, indexGroupKey, startChapter, endChapter, force, mode }) {
  try {
    const indexGroup = getBookIndexGroup(bookId, indexGroupKey);
    if (!indexGroup || !indexGroup.enabled) {
      const error = new Error("索引组不存在或已禁用。");
      error.status = 404;
      throw error;
    }
    const executionModel = l2IndexExecutionSignature();
    const indexPromptHash = indexGroupL2PromptHash(indexGroup);
    const chapters = listChapterMetadata(bookId)
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter);
    if (!chapters.length) {
      const error = new Error("本地章节库没有可构建 L2 索引的章节，请先导入章节原文。");
      error.status = 422;
      throw error;
    }

    await testDifyConnection({ target: "l2" });
    // retry_empty：先统计范围内空章总数（与下方跳过判定同口径），供前端展示空章补跑进度
    const emptyTotal = mode === "retry_empty"
      ? listL2ChapterStatuses(bookId, startChapter, endChapter, indexGroup.group_key)
        .filter((entry) => entry.status === "completed" && entry.facts_count === 0).length
      : 0;
    markTaskRunning(task, {
      progress: {
        total: chapters.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        ...(mode === "retry_empty" ? { empty_total: emptyTotal } : {}),
        current: `准备构建 ${indexGroup.name || indexGroup.group_key} L2 索引`
      }
    });

    if (force && mode === "all" && startChapter === 1) {
      clearL2Subjects({ bookId, indexGroupKey: indexGroup.group_key });
    }

    const rescannedSubjectKeys = new Set();
    const diagnostics = {
      generated_facts: 0,
      admitted_facts: 0,
      rejected_facts: 0,
      candidate_facts: 0,
      candidate_filtered_facts: 0,
      missing_scope_fields: 0,
      historical_rescan_facts: 0,
      historical_rescan_chapters: 0
    };

    for (const chapter of chapters) {
      await waitIfPaused(task);
      const existing = getL2ChapterStatus(bookId, chapter.chapter_index, indexGroup.group_key);
      const fresh = existing?.status === "completed"
        && existing.source_hash === chapter.content_hash
        && existing.model === executionModel
        && existing.prompt_hash === indexPromptHash
        && existing.schema_version === L2_SCHEMA_VERSION;
      if (mode === "retry_failed" && existing?.status !== "failed") {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} 不是失败状态，跳过。`
        });
        continue;
      }
      if (mode === "retry_empty" && !(existing?.status === "completed" && existing.facts_count === 0)) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} 不是空章，跳过。`
        });
        continue;
      }
      if (mode === "missing" && existing) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} 已有 L2 记录，跳过。`
        });
        continue;
      }
      if (!force && mode === "all" && fresh) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} L2 索引已存在，跳过。`
        });
        continue;
      }

      updateTask(task, {
        progress: { ...task.progress, current: `L2 事实索引 ${chapter.chapter_index}` },
        message: `正在构建章节 ${chapter.chapter_index} · ${indexGroup.name || indexGroup.group_key}`
      });

      try {
        assertNotCancelled(task);
        const content = getChapterContent(bookId, chapter.chapter_index);
        const l1Index = getL1ChapterIndex(bookId, chapter.chapter_index);
        const l1Route = compactL1RouteForPrompt(l1Index);
        const knownSubjects = findKnownL2Subjects({
          bookId,
          indexGroupKey: indexGroup.group_key,
          chapterIndex: chapter.chapter_index,
          content,
          title: chapter.title,
          promptHash: indexPromptHash
        });
        const effectiveIndexPrompt = buildL2IndexPromptWithSubjectMemory(
          indexGroup.l2_index_prompt,
          knownSubjects,
          Array.isArray(indexGroup.category_scope) && indexGroup.category_scope.includes(MAGICAL_CREATURE_CATEGORY)
        );
        const providerFacts = normalizeDifyL2Output(await runDifyWorkflow({
          apiKey: config.dify.l2ApiKey,
          target: "l2",
          inputs: {
            book_id: bookId,
            index_group_key: indexGroup.group_key,
            chapter_index: chapter.chapter_index,
            chapter_title: chapter.title || "",
            chapter_content: content,
            l1_route_json: JSON.stringify(l1Route || null),
            known_subjects_json: JSON.stringify(knownSubjects),
            index_prompt: effectiveIndexPrompt
          }
        })).facts;
        const generatedFacts = expandEmbeddedMagicalCreatureFacts(providerFacts);
        const admission = admitL2FactsForIndexGroup(generatedFacts, indexGroup, knownSubjects);
        diagnostics.generated_facts += generatedFacts.length;
        diagnostics.missing_scope_fields += generatedFacts.filter((fact) => fact.scope_fields_complete === false).length;
        diagnostics.admitted_facts += admission.facts.length;
        diagnostics.rejected_facts += admission.rejectedCount;
        diagnostics.candidate_facts += admission.candidateFacts.length;
        diagnostics.candidate_filtered_facts += Math.max(0, admission.rejectedCount - admission.candidateFacts.length);
        updateTask(task, {
          progress: { ...task.progress, current: `L2 事实索引 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} 生成 ${generatedFacts.length} 条，准入 ${admission.facts.length} 条。`
        });
        if (admission.rejectedCount) {
          updateTask(task, {
            progress: { ...task.progress, current: `L2 事实索引 ${chapter.chapter_index}` },
            message: `章节 ${chapter.chapter_index} 已拒绝 ${admission.rejectedCount} 条不符合 ${indexGroup.name || indexGroup.group_key} 范围的事实。`
          }, "warning");
        }
        if (admission.candidateFacts.length) {
          updateTask(task, {
            progress: { ...task.progress, current: `L2 事实索引 ${chapter.chapter_index}` },
            message: `章节 ${chapter.chapter_index} 已保留 ${admission.candidateFacts.length} 条待确认主体候选事实。`
          }, "candidate");
        }
        saveL2ChapterFacts({
          bookId,
          indexGroupKey: indexGroup.group_key,
          chapterIndex: chapter.chapter_index,
          status: "completed",
          sourceHash: chapter.content_hash,
          model: executionModel,
          promptHash: indexPromptHash,
          schemaVersion: L2_SCHEMA_VERSION,
          facts: admission.facts,
          candidateFacts: admission.candidateFacts
        });
        for (const candidate of admission.candidateFacts) {
          if (!candidate.entity) continue;
          upsertL2Subject({
            bookId,
            indexGroupKey: indexGroup.group_key,
            subjectKey: candidate.subject_key || candidate.entity,
            canonicalName: candidate.entity,
            aliases: candidate.aliases,
            creatureType: candidate.creature_type,
            originalForm: candidate.original_form,
            qualificationChapter: chapter.chapter_index,
            confidence: candidate.confidence,
            status: "candidate",
            promptHash: indexPromptHash
          });
        }
        for (const subject of admission.newSubjects) {
          upsertL2Subject({
            bookId,
            indexGroupKey: indexGroup.group_key,
            subjectKey: subject.subject_key || subject.entity,
            canonicalName: subject.entity,
            aliases: subject.aliases,
            creatureType: subject.creature_type,
            originalForm: subject.original_form,
            qualificationChapter: chapter.chapter_index,
            qualificationBasis: subject.scope_basis,
            qualificationEvidence: subject.qualification_evidence.length ? subject.qualification_evidence : subject.evidence,
            confidence: subject.confidence,
            promptHash: indexPromptHash
          });
          promoteL2CandidateFacts({
            bookId,
            indexGroupKey: indexGroup.group_key,
            canonicalName: subject.entity,
            aliases: subject.aliases,
            promptHash: indexPromptHash
          });
          const subjectKey = subject.subject_key || subject.entity;
          if (!rescannedSubjectKeys.has(subjectKey)) {
            rescannedSubjectKeys.add(subjectKey);
            const rescan = await rescanHistoricalSubjectMentions({
              task,
              bookId,
              indexGroup,
              subject: { ...subject, qualification_chapter: chapter.chapter_index },
              indexPromptHash,
              executionModel
            });
            diagnostics.historical_rescan_facts += rescan.facts;
            diagnostics.historical_rescan_chapters += rescan.chapters;
          }
        }
        task.progress.completed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L2 完成` },
          message: `章节 ${chapter.chapter_index} L2 索引完成`
        });
        assertNotCancelled(task);
      } catch (error) {
        if (error?.status === 499) throw error;
        const safeMessage = sanitizeText(error.message);
        saveL2ChapterStatus({
          bookId,
          indexGroupKey: indexGroup.group_key,
          chapterIndex: chapter.chapter_index,
          status: "failed",
          sourceHash: chapter.content_hash,
          model: executionModel,
          promptHash: indexPromptHash,
          schemaVersion: L2_SCHEMA_VERSION,
          errorSummary: safeMessage
        });
        task.progress.failed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L2 失败` },
          message: `章节 ${chapter.chapter_index} L2 失败：${safeMessage}`
        }, "warning");
        if (isFatalUpstreamError(safeMessage)) {
          throw new Error(`L2 构建已停止：${safeMessage}`, { cause: error });
        }
      }
    }

    completeTask(task, {
      bookId,
      indexGroupKey: indexGroup.group_key,
      diagnostics,
      coverage: getL2Coverage({ bookId, indexGroupKey: indexGroup.group_key, startChapter, endChapter, model: executionModel, promptHash: indexPromptHash, schemaVersion: L2_SCHEMA_VERSION })
    });
  } catch (error) {
    failTask(task, error);
  }
}

async function rescanHistoricalSubjectMentions({ task, bookId, indexGroup, subject, indexPromptHash, executionModel }) {
  const names = [subject.entity, ...(subject.aliases || [])]
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 2 && isHistoricalRescanSubjectName(value));
  const qualificationChapter = Number(subject.qualification_chapter || 0);
  if (!names.length || qualificationChapter <= 1) return { facts: 0, chapters: 0 };
  const chapters = listChapterMetadata(bookId)
    .filter((chapter) => chapter.chapter_index < qualificationChapter)
    .slice(0, L2_HISTORICAL_RESCAN_MAX_CHAPTERS);
  const result = { facts: 0, chapters: 0 };
  for (const chapter of chapters) {
    const content = getChapterContent(bookId, chapter.chapter_index);
    if (!names.some((name) => content.includes(name))) continue;
    const historicalPrompt = `${indexGroup.l2_index_prompt}\n\n【历史主体定向回扫】\n已确认主体：${subject.entity}\n别名：${names.join("、")}\n只提取与该主体直接相关的事实，不提取其他人物、器物或生物。即使本章只补充该主体的行为、外观、能力或事件，也要保留。`;
    const generatedFacts = normalizeDifyL2Output(await runDifyWorkflow({
      apiKey: config.dify.l2ApiKey,
      target: "l2",
      inputs: {
        book_id: bookId,
        index_group_key: indexGroup.group_key,
        chapter_index: chapter.chapter_index,
        chapter_title: chapter.title || "",
        chapter_content: content,
        l1_route_json: JSON.stringify(null),
        known_subjects_json: JSON.stringify([subject]),
        index_prompt: historicalPrompt
      }
    })).facts;
    const relatedFacts = generatedFacts
      .filter((fact) => isHistoricalRescanFactUsable(fact))
      .filter((fact) => matchesKnownL2Subject(fact, [subject]))
      .map((fact) => ({
      ...fact,
      category: MAGICAL_CREATURE_CATEGORY,
      scope_eligible: true,
      scope_basis: "prior_verified_subject",
      identity_basis: "historical_subject_rescan"
    }));
    if (!relatedFacts.length) continue;
    appendL2ChapterFacts({
      bookId,
      indexGroupKey: indexGroup.group_key,
      chapterIndex: chapter.chapter_index,
      sourceHash: chapter.content_hash,
      model: executionModel,
      promptHash: indexPromptHash,
      schemaVersion: L2_SCHEMA_VERSION,
      facts: relatedFacts
    });
    result.facts += relatedFacts.length;
    result.chapters += 1;
    updateTask(task, {
      progress: { ...task.progress, current: `历史回扫 ${subject.entity} · 第 ${chapter.chapter_index} 章` },
      message: `已为主体 ${subject.entity} 补扫第 ${chapter.chapter_index} 章历史事实`
    }, "historical_rescan");
  }
  return result;
}

export function expandEmbeddedMagicalCreatureFacts(facts) {
  const values = Array.isArray(facts) ? facts : [];
  const expanded = [...values];
  const embeddedSubjects = ["四脚蛇", "四角蛇"];
  for (const fact of values) {
    const source = [fact?.fact, ...(fact?.evidence || [])].map((value) => String(value || "")).join(" ");
    for (const subject of embeddedSubjects) {
      if (!source.includes(subject) || String(fact?.entity || "").includes(subject)) continue;
      const related = String(fact?.entity || "").trim();
      const evidence = (fact?.evidence || []).filter((value) => String(value || "").includes(subject)).slice(0, 2);
      expanded.push({
        category: MAGICAL_CREATURE_CATEGORY,
        entity: subject,
        aliases: [],
        tags: ["候选主体"],
        related_entities: related ? [related] : [],
        fact_type: "identity_clue",
        fact: `当前章节出现${subject}${related ? `，并记录其与${related}发生接触` : ""}；当前证据不足以确认其属于神奇生物。`,
        evidence: evidence.length ? evidence : [source.slice(0, 120)],
        importance: 0.45,
        confidence: 0.55,
        scope_eligible: false,
        scope_basis: "",
        transformation_eligible: false,
        creature_type: "",
        original_form: "",
        subject_key: subject,
        identity_basis: "current_chapter"
      });
    }
  }
  return expanded;
}

export function admitL2FactsForIndexGroup(facts, indexGroup = {}, knownSubjects = []) {
  const values = Array.isArray(facts) ? facts : [];
  const categoryScope = Array.isArray(indexGroup.category_scope) ? indexGroup.category_scope : [];
  if (!categoryScope.includes(MAGICAL_CREATURE_CATEGORY)) {
    return { facts: values, rejectedCount: 0, newSubjects: [], candidateFacts: [] };
  }
  const known = Array.isArray(knownSubjects) ? knownSubjects : [];
  const admitted = values
    .filter((fact) => isEligibleMagicalCreatureFact(fact) || matchesKnownL2Subject(fact, known))
    .map((fact) => ({
      ...fact,
      category: MAGICAL_CREATURE_CATEGORY,
      scope_eligible: true,
      scope_basis: isEligibleMagicalCreatureFact(fact) ? fact.scope_basis : "prior_verified_subject",
      identity_basis: isEligibleMagicalCreatureFact(fact) ? "current_chapter" : "prior_verified_subject"
    }));
  return {
    facts: admitted,
    rejectedCount: values.length - admitted.length,
    newSubjects: admitted.filter((fact) => isEligibleMagicalCreatureFact(fact) && fact.entity),
    candidateFacts: values.filter((fact) => !isEligibleL2FactForSubject(fact, known) && isCandidateL2FactForSubject(fact))
  };
}

function isCandidateL2FactForSubject(fact) {
  const entity = String(fact?.entity || "").trim();
  if (!entity || isArtifactLikeMagicalFact(fact) || isNonCreatureObjectLikeFact(fact) || isOrdinaryHumanLikeFact(fact) || isOrdinaryAnimalLikeFact(fact)) return false;
  const factType = String(fact?.fact_type || "").trim();
  if (factType === "identity_clue") return true;
  const text = [fact?.fact, fact?.evidence, ...(fact?.tags || [])]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /异兽|妖|精|鬼|灵|化形|人形|灵智|通灵|大妖|水神|山神|鬼魅|阴物|祥瑞|神兽|树妖|狐妖|蛇精/.test(text);
}

function isEligibleL2FactForSubject(fact, knownSubjects) {
  return isEligibleMagicalCreatureFact(fact) || matchesKnownL2Subject(fact, knownSubjects);
}

function isEligibleMagicalCreatureFact(fact) {
  const basis = String(fact?.scope_basis || "").trim();
  if (isTentativeHumanSimileFact(fact)) return false;
  if (isArtifactLikeMagicalFact(fact) && (basis !== "explicit_transformation" || fact.transformation_eligible !== true || !hasExplicitTransformationEvidence(fact))) return false;
  return fact?.scope_eligible === true
    && MAGICAL_CREATURE_SCOPE_BASES.has(basis)
    && (basis !== "explicit_transformation" || fact.transformation_eligible === true);
}

function isNonCreatureObjectLikeFact(fact) {
  const text = [fact?.entity, ...(fact?.aliases || []), ...(fact?.tags || []), fact?.fact]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /茶壶|茶杯|槐叶|叶片|牌坊|石头|石块|矿石|胆石|材料|木料|树枝|树叶/.test(text);
}

function isOrdinaryAnimalLikeFact(fact) {
  const text = [fact?.entity, ...(fact?.tags || []), fact?.fact]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /普通动物|普通狗|家犬|老狗|家养狗/.test(text)
    && !/异兽|妖|灵兽|神兽|灵智|化形|神通|修为|异常血脉|超自然/.test(text);
}

function isTentativeHumanSimileFact(fact) {
  const entity = String(fact?.entity || "").trim();
  const text = [fact?.fact, ...(fact?.evidence || [])]
    .map((value) => String(value || ""))
    .join(" ");
  return /^(青衣|白衣|红衣|黑衣|高大|年轻)?(少女|女子|少年|男子|老人|妇人|男人|女人)/.test(entity)
    && /像|仿佛|如同|好似/.test(text)
    && !/明确[^。；，,]{0,12}本体|真身|原文[^。；，,]{0,12}是|化形|幻化|变作/.test(text);
}

function hasExplicitTransformationEvidence(fact) {
  const text = [fact?.fact, ...(fact?.evidence || [])]
    .map((value) => String(value || ""))
    .join(" ");
  return /化为人形|幻化为人形|化作人形|变作人形|化为动物|化作动物|变作动物|以[^，。；,.;]{1,12}(人形|动物形态)出现|现出人形/.test(text);
}

function isArtifactLikeMagicalFact(fact) {
  const text = [fact?.entity, ...(fact?.aliases || []), ...(fact?.tags || []), fact?.fact]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return /飞剑|剑胚|剑灵|老剑条|锈剑条|铁剑|长剑|养剑葫|法宝|兵器|符箓|符纸|傀儡|神像|荷叶伞|压衣刀|斩龙台|符纸甲士|开山傀儡|卸岭甲士/.test(text);
}

function isOrdinaryHumanLikeFact(fact) {
  const entity = String(fact?.entity || "").trim();
  const text = [fact?.fact, fact?.evidence, ...(fact?.tags || [])]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  if (/普通人物|普通人|人物|修士|道人|剑客|铁匠|妇人|女子|少年|少女|老人|男子|男人|年轻人/.test(text)) return true;
  return /^(年轻|高大|白衣|红衣|长春宫|帷帽少女|年轻剑客|道人|修士|老人|妇人|女子|少年|少女|男子|男人)/.test(entity);
}

export function isHistoricalRescanSubjectName(value) {
  const name = String(value || "").trim();
  if (!name || name.length < 2) return false;
  return !/^(飞剑|剑|长剑|短剑|铁剑|那把剑|那柄剑|少女|女子|少年|男子|男人|女人|老人|年轻人|白衣女子|黑衣少女|帷帽少女)$/.test(name)
    && !/^(飞剑|长剑|那把剑|那柄剑)[（(]/.test(name);
}

export function isHistoricalRescanFactUsable(fact) {
  const text = [fact?.fact, ...(fact?.evidence || [])]
    .map((value) => String(value || ""))
    .join(" ");
  return !/未直接出现|未提及|没有提及|本章正文未|仅作为.*追踪|仅作为.*候选/.test(text);
}

function matchesKnownL2Subject(fact, subjects) {
  const values = [fact?.entity, ...(fact?.aliases || []), ...(fact?.related_entities || [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return subjects.some((subject) => {
    const names = [subject.canonical_name, subject.subject_key, ...(subject.aliases || [])].filter(Boolean);
    return values.some((value) => names.some((name) => value === name || value.includes(name) || name.includes(value)));
  });
}

function findKnownL2Subjects({ bookId, indexGroupKey, chapterIndex, content, title, promptHash = "" }) {
  const subjects = listL2Subjects({ bookId, indexGroupKey, chapterIndex, promptHash });
  const source = `${title || ""}\n${content || ""}`;
  return subjects.filter((subject) => {
    const names = [subject.canonical_name, subject.subject_key, ...(subject.aliases || [])].filter(Boolean);
    return names.some((name) => source.includes(name));
  });
}

function buildL2IndexPromptWithSubjectMemory(indexPrompt, knownSubjects, isMagicalCreatureIndex) {
  const sections = [indexPrompt];
  if (isMagicalCreatureIndex) {
    sections.push(
      "",
      "【候选主体保留规则】",
      "如果本章出现稳定名称或稳定指代，且可能属于神奇生物，但当前证据不足以完成六类正式准入，可以输出最小候选事实：scope_eligible=false、scope_basis为空、fact_type=identity_clue。候选事实只用于跨章节追踪，不属于正式神奇生物事实，不得把普通人物、普通动物或明显器物仅因名称出现就大量输出为候选。"
    );
  }
  if (knownSubjects.length) {
    sections.push(
      "",
      "【跨章节已确认主体】",
      "以下主体已经在更早章节完成神奇生物准入。本章如再次出现这些主体，只需提取本章事实，不要要求本章重复证明其神奇生物身份，也不要把历史准入证据写成本章证据。",
      JSON.stringify(knownSubjects)
    );
  }
  return sections.join("\n");
}

async function runAnalysisTask(task, options) {
  const resume = Boolean(options.resume);
  const analysisId = options.analysisId || task.id;

  try {
    const prepared = resume
      ? await prepareResumedAnalysis(options.run || getAnalysisRun(analysisId))
      : await prepareNewAnalysis(analysisId, options);
    await executeAnalysisTask(task, prepared);
  } catch (error) {
    if (getAnalysisRun(analysisId)) {
      updateAnalysisRun(analysisId, {
        status: error?.status === 499 ? "cancelled" : "failed",
        error_summary: sanitizeText(error.message)
      });
    }
    if (error?.status === 499) return;
    failTask(task, error);
  }
}

function validateL2QueryBeforeRun({ query, indexGroups = [] }) {
  if (!String(query || "").trim()) {
    const error = new Error("L2 提问模式必须填写查询问题。");
    error.status = 422;
    throw error;
  }
  if (!Array.isArray(indexGroups) || !indexGroups.length) {
    const error = new Error("L2 提问模式必须选择至少一个事实索引。");
    error.status = 422;
    throw error;
  }
}

async function executeL2QueryAnalysisTask(task, { analysisId, bookId, startChapter, endChapter, indexGroups = [], model, reasoningEffort, outputSchemaHash, query }) {
  const summaryExecutionModel = analysisSummaryExecutionSignature();
  const inputBudget = L2_QUERY_DIFY_INPUT_MAX_CHARS;
  const indexGroupKeys = indexGroups.map((group) => group.group_key);
  const queryIntent = buildL2QueryIntent(query, indexGroups);
  const targetContext = queryIntent.targetContext;
  const collectionMode = queryIntent.collectionMode;

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "L2 事实检索" },
    message: "正在从本地 L2 事实库检索问题相关事实"
  });

  const candidateScan = await collectL2QueryCandidateFacts({
    bookId,
    indexGroupKeys,
    startChapter,
    endChapter,
    windowChapters: L2_QUERY_WINDOW_CHAPTERS,
    perWindowLimit: L2_QUERY_CANDIDATE_LIMIT
  });
  const candidateFacts = candidateScan.facts;
  const recall = recallL2QueryFacts({
    facts: candidateFacts,
    query,
    targetContext,
    extraTerms: queryIntent.recallTerms,
    limit: collectionMode ? L2_QUERY_COLLECTION_MAX_FACTS : L2_QUERY_MAX_FACTS,
    allowExpandedLimit: collectionMode
  });
  const recalledChapters = [...new Set(recall.facts.map((fact) => Number(fact.chapter_index || 0)).filter(Boolean))]
    .sort((left, right) => left - right);
  const sourceStats = {
    analysis_mode: "l2_query",
    query,
    index_group_keys: indexGroupKeys,
    index_groups: indexGroups.map((group) => ({ group_key: group.group_key, name: group.name })),
    candidate_facts: candidateFacts.length,
    l2_query_candidate_windows: candidateScan.windows,
    l2_query_candidate_window_chapters: L2_QUERY_WINDOW_CHAPTERS,
    l2_query_candidate_limit_per_window: L2_QUERY_CANDIDATE_LIMIT,
    recalled_facts: recall.facts.length,
    recalled_chapters: recalledChapters.length,
    recalled_chapter_indexes: recalledChapters,
    matched_terms: recall.matchedTerms,
    expanded_terms: recall.expandedTerms,
    l2_query_intent: queryIntent.intent,
    l2_query_collection_reason: queryIntent.reason,
    l2_query_recall_terms: queryIntent.recallTerms,
    l2_query_scored_facts: recall.scoredFacts,
    l2_query_dropped_after_recall_limit: recall.droppedAfterRecallLimit,
    l2_query_collection_mode: collectionMode,
    l2_query_collection_candidate_facts: collectionMode ? recall.scoredFacts : 0,
    l2_query_collection_recall_limit: collectionMode ? L2_QUERY_COLLECTION_MAX_FACTS : 0,
    l2_query_chunk_input_budget: inputBudget,
    source_review_chapters: 0,
    source_review_budget: 0,
    target_subject: targetContext.subject,
    target_candidate_facts: recall.targetCandidateFacts,
    target_selected_facts: recall.targetSelectedFacts,
    target_recalled_facts: recall.targetSelectedFacts,
    target_recalled_chapters: recall.targetSelectedChapters,
    target_recall_fallback_used: false
  };

  if (!recall.facts.length) {
    Object.assign(sourceStats, {
      l2_query_material_mode: "direct",
      l2_query_chunk_count: 0,
      l2_query_recalled_facts_before_budget: 0,
      l2_query_recalled_facts_after_budget: 0,
      l2_query_omitted_by_budget: 0,
      l2_query_trimmed_by_budget: false
    });
    const finalResult = [
      "## L2 提问结果",
      "",
      "未召回相关 L2 事实。",
      "",
      `查询：${query}`,
      `事实索引：${indexGroups.map((group) => group.name || group.group_key).join(" / ") || "未指定"}`,
      `章节范围：${startChapter}-${endChapter}`
    ].join("\n");
    saveFinalAnalysisResult(analysisId, finalResult);
    task.progress.completed = task.progress.total;
    const run = updateAnalysisRun(analysisId, {
      status: "completed",
      source_stats: JSON.stringify(sourceStats),
      error_summary: "未召回相关 L2 事实"
    });
    completeTask(task, {
      analysisId,
      run: publicAnalysisRun(run),
      finalResult,
      failedChapters: [],
      schemaHash: outputSchemaHash,
      sourceStats
    });
    return;
  }

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT L2 提问汇总" },
    message: l2QuerySummaryProgressMessage({ recall, candidateFacts: candidateFacts.length, targetSubject: targetContext.subject, collectionMode })
  });
  Object.assign(sourceStats, {
    l2_query_material_mode: collectionMode ? "collection_direct" : "direct",
    l2_query_chunk_count: 1,
    l2_query_recalled_facts_before_budget: recall.facts.length,
    l2_query_recalled_facts_after_budget: recall.facts.length,
    l2_query_omitted_by_budget: 0,
    l2_query_trimmed_by_budget: false
  });
  const sourceMaterial = {
    query,
    targetContext,
    sourceStats,
    facts: recall.facts,
    evidence_packets: recall.facts.map(factToEvidencePacket).filter(Boolean)
  };
  const input = buildL2QuerySummaryInput({
    query,
    sourceMaterial,
    sourceStats
  });
  if (inputTextLength(input) > inputBudget) {
    await executeChunkedL2QueryAnalysisTask({
      task,
      analysisId,
      query,
      targetContext,
      sourceStats,
      recallFacts: recall.facts,
      summaryExecutionModel,
      requestModel: model,
      reasoningEffort,
      outputSchemaHash,
      indexGroups,
      startChapter,
      endChapter,
      materialMode: collectionMode ? "collection_chunked" : "chunked",
      inputBudget
    });
    return;
  }
  const summaryTrace = sourceTraceFromMaterial({
    partKey: "l2_query.final.merge",
    stage: "text_final_merge",
    fieldName: "l2_query",
    material: sourceMaterial
  });
  const summary = await runL2QuerySummaryCallWithFallback({
    analysisId,
    task,
    partKey: "l2_query.final.merge",
    stageLabel: "GPT L2 提问汇总",
    model: summaryExecutionModel,
    requestModel: model,
    reasoningEffort,
    userPrompt: query,
    input,
    schema: null,
    sourceChapterCount: Math.max(recall.facts.length, 1),
    traceSummary: summaryTrace,
    sourceStats,
    fallbackMarkdown: () => buildL2QueryDirectFallbackMarkdown({ query, facts: recall.facts, targetContext })
  });

  assertNotCancelled(task);
  const finalResult = parseJsonOrText(summary.value);
  assertFinalSummaryUseful(finalResult, Math.max(recall.facts.length, 1));
  saveFinalAnalysisResult(analysisId, finalResult);
  task.progress.completed = task.progress.total;
  const run = updateAnalysisRun(analysisId, {
    status: "completed",
    source_stats: JSON.stringify(sourceStats),
    error_summary: ""
  });
  completeTask(task, {
    analysisId,
    run: publicAnalysisRun(run),
    finalResult,
    failedChapters: [],
    schemaHash: outputSchemaHash,
    sourceStats
  });
}

async function executeChunkedL2QueryAnalysisTask({
  task,
  analysisId,
  query,
  targetContext,
  sourceStats,
  recallFacts,
  summaryExecutionModel,
  requestModel,
  reasoningEffort,
  outputSchemaHash,
  indexGroups,
  startChapter,
  endChapter,
  materialMode = "chunked",
  inputBudget = SUMMARY_PART_INPUT_MAX_CHARS
}) {
  Object.assign(sourceStats, {
    l2_query_material_mode: materialMode,
    l2_query_chunk_count: 0,
    l2_query_recalled_facts_before_budget: recallFacts.length,
    l2_query_recalled_facts_after_budget: 0,
    l2_query_omitted_by_budget: 0,
    l2_query_trimmed_by_budget: true
  });
  let chunks = splitL2QueryFactsIntoBudgetedChunks({
    query,
    targetContext,
    sourceStats,
    facts: recallFacts,
    budget: inputBudget
  });
  let keptFactCount = chunks.reduce((sum, chunk) => sum + chunk.rawFacts.length, 0);
  Object.assign(sourceStats, {
    l2_query_material_mode: materialMode,
    l2_query_chunk_count: chunks.length,
    l2_query_recalled_facts_before_budget: recallFacts.length,
    l2_query_recalled_facts_after_budget: keptFactCount,
    l2_query_omitted_by_budget: Math.max(0, recallFacts.length - keptFactCount),
    l2_query_trimmed_by_budget: true
  });
  chunks = chunks
    .map((chunk) => withL2QueryChunkInput({
      chunk,
      query,
      targetContext,
      sourceStats,
      budget: inputBudget
    }))
    .filter((chunk) => chunk.rawFacts.length);
  chunks = chunks.map((chunk, index) => ({
    ...chunk,
    batch: index + 1,
    total: chunks.length
  }));
  keptFactCount = chunks.reduce((sum, chunk) => sum + chunk.rawFacts.length, 0);
  Object.assign(sourceStats, {
    l2_query_chunk_count: chunks.length,
    l2_query_recalled_facts_after_budget: keptFactCount,
    l2_query_omitted_by_budget: Math.max(0, recallFacts.length - keptFactCount)
  });

  if (!chunks.length || !keptFactCount) {
    const finalResult = [
      "## L2 提问结果",
      "",
      "未召回相关 L2 事实，或相关事实在预算裁剪后不足以生成回答。",
      "",
      `查询：${query}`,
      `事实索引：${indexGroups.map((group) => group.name || group.group_key).join(" / ") || "未指定"}`,
      `章节范围：${startChapter}-${endChapter}`
    ].join("\n");
    saveFinalAnalysisResult(analysisId, finalResult);
    task.progress.completed = task.progress.total;
    const run = updateAnalysisRun(analysisId, {
      status: "completed",
      source_stats: JSON.stringify(sourceStats),
      error_summary: "L2 提问预算裁剪后素材不足"
    });
    completeTask(task, {
      analysisId,
      run: publicAnalysisRun(run),
      finalResult,
      failedChapters: [],
      schemaHash: outputSchemaHash,
      sourceStats
    });
    return;
  }

  const batchResults = [];
  for (const chunk of chunks) {
    await waitIfPaused(task);
    updateTask(task, {
      progress: { ...task.progress, current: `GPT L2 提问分块 ${chunk.batch}/${chunk.total}` },
      message: `正在生成 L2 提问局部回答 ${chunk.batch}/${chunk.total}`
    });
    const partKey = `l2_query.batch.${String(chunk.batch).padStart(3, "0")}`;
    const traceSummary = sourceTraceFromMaterial({
      partKey,
      stage: "text_l2_query_batch",
      fieldName: "l2_query",
      material: {
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: chunk.rawFacts.length,
          evidence_packets_trimmed_by_budget: chunk.trimmedByBudget,
          evidence_packets_omitted_by_budget: chunk.omittedByBudget
        },
        targetContext,
        target_subject: targetContext?.subject || "",
        split: {
          fieldName: "l2_query",
          materialLabel: "L2 提问事实分块",
          mode: "l2_query_batch",
          batch: chunk.batch,
          total: chunk.total
        },
        evidence_packets: chunk.rawFacts.map(factToEvidencePacket).filter(Boolean)
      }
    });
    const summary = await runL2QuerySummaryCallWithFallback({
      analysisId,
      task,
      partKey,
      stageLabel: `GPT L2 提问分块 ${chunk.batch}/${chunk.total}`,
      model: summaryExecutionModel,
      requestModel,
      reasoningEffort,
      userPrompt: query,
      input: chunk.input,
      schema: null,
      sourceChapterCount: Math.max(chunk.rawFacts.length, 1),
      traceSummary,
      sourceStats,
      fallbackMarkdown: () => buildL2QueryBatchFallbackMarkdown({ query, chunk, targetContext })
    });
    const value = parseJsonOrText(summary.value);
    batchResults.push({
      batch: chunk.batch,
      total: chunk.total,
      chapters: chunk.chapters,
      fact_count: chunk.rawFacts.length,
      markdown: typeof value === "string" ? value : JSON.stringify(value)
    });
  }

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT L2 提问分块合并" },
    message: `正在合并 ${batchResults.length} 个 L2 提问局部回答`
  });
  const mergeInput = buildL2QueryMergeInput({
    query,
    sourceStats,
    batchResults,
    budget: inputBudget
  });
  const finalMergeTrace = sourceTraceFromMaterial({
    partKey: "l2_query.final.merge",
    stage: "text_l2_query_merge",
    fieldName: "l2_query",
    material: {
      sourceStats,
      split: {
        fieldName: "l2_query",
        materialLabel: "L2 提问局部回答",
        mode: "l2_query_chunk_merge",
        batch: 1,
        total: batchResults.length
      },
      compressedResults: batchResults
    }
  });
  const finalSummary = await runL2QuerySummaryCallWithFallback({
    analysisId,
    task,
    partKey: "l2_query.final.merge",
    stageLabel: "GPT L2 提问分块合并",
    model: summaryExecutionModel,
    requestModel,
    reasoningEffort,
    userPrompt: query,
    input: mergeInput,
    schema: null,
    sourceChapterCount: Math.max(keptFactCount, 1),
    traceSummary: finalMergeTrace,
    sourceStats,
    fallbackMarkdown: () => buildL2QueryMergeFallbackMarkdown({ query, batchResults })
  });

  assertNotCancelled(task);
  const finalResult = parseJsonOrText(finalSummary.value);
  assertFinalSummaryUseful(finalResult, Math.max(keptFactCount, 1));
  saveFinalAnalysisResult(analysisId, finalResult);
  task.progress.completed = task.progress.total;
  const run = updateAnalysisRun(analysisId, {
    status: "completed",
    source_stats: JSON.stringify(sourceStats),
    error_summary: ""
  });
  completeTask(task, {
    analysisId,
    run: publicAnalysisRun(run),
    finalResult,
    failedChapters: [],
    schemaHash: outputSchemaHash,
    sourceStats
  });
}

async function runL2QuerySummaryCallWithFallback({
  analysisId,
  task,
  partKey,
  stageLabel,
  model,
  requestModel,
  reasoningEffort,
  userPrompt,
  input,
  schema,
  sourceChapterCount,
  traceSummary,
  sourceStats,
  fallbackMarkdown
}) {
  try {
    return await runFinalSummaryCall({
      analysisId,
      task,
      partKey,
      stageLabel,
      model,
      requestModel,
      reasoningEffort,
      userPrompt,
      input,
      schema,
      sourceChapterCount,
      traceSummary,
      errorLabel: "Dify L2 提问汇总"
  });
  } catch (error) {
    const fallbackReason = l2QuerySummaryFallbackReason(error);
    if (!fallbackReason) throw error;
    const markdown = fallbackMarkdown();
    const isMerge = partKey === "l2_query.final.merge";
    if (isMerge) {
      sourceStats.l2_query_merge_fallback_used = true;
    } else {
      sourceStats.l2_query_batch_fallback_count = Number(sourceStats.l2_query_batch_fallback_count || 0) + 1;
    }
    const fallbackTrace = {
      ...(traceSummary || {}),
      fallback_used: true,
      fallback_reason: fallbackReason,
      field_material_mode: isMerge ? "l2_query_merge_local_fallback" : "l2_query_batch_local_fallback"
    };
    saveAnalysisSummaryPart({
      analysisId,
      partKey,
      parentKey: "",
      stage: isMerge ? "text_l2_query_merge" : "text_l2_query_batch",
      status: "completed",
      contentHash: summaryContentHash({ input, schema: null, userPrompt }),
      promptHash: shaString(userPrompt || ""),
      schemaHash: "",
      model,
      reasoningEffort,
      inputSummary: `${stageLabel} · 输入 ${inputTextLength(input)} 字 · 汇总器不可用后本地降级`,
      traceSummary: fallbackTrace,
      result: { value: markdown, responseId: null },
      errorSummary: ""
    });
    updateTask(task, {
      progress: {
        ...task.progress,
        summary_parts: await summaryProgressForAnalysis(analysisId)
      },
      message: `L2 提问分块已本地降级：${partKey}`
    });
    return { value: markdown, responseId: null };
  }
}

function l2QuerySummaryFallbackReason(error) {
  const message = String(error?.message || "");
  if (/Dify (分析工作流|L2 提问汇总)返回了空文本/.test(message)) return "dify_empty_text";
  if (/暂无可用上游|no available upstream|model.*unavailable|模型.*不可用|模型.*暂无|upstream/i.test(message)) return "summary_model_unavailable";
  if (/timeout|timed out|aborted|fetch failed|network|网络连接失败|unexpected end of json input/i.test(message)) return "summary_transport_unavailable";
  return "";
}

function buildL2QueryDirectFallbackMarkdown({ query, facts, targetContext }) {
  return buildL2QueryBatchFallbackMarkdown({
    query,
    targetContext,
    chunk: {
      batch: 1,
      total: 1,
      rawFacts: facts || []
    }
  });
}

function buildL2QueryBatchFallbackMarkdown({ query, chunk, targetContext }) {
  const lines = [
    "## L2 局部事实摘录（系统降级）",
    "",
    "Dify 分析汇总返回空文本；以下内容为系统按已召回 L2 facts 生成的保真摘录，未读取章节原文。",
    "",
    `查询：${query}`,
    targetContext?.subject ? `目标主体：${targetContext.subject}` : "",
    `分块：${chunk.batch}/${chunk.total}`,
    `事实数：${chunk.rawFacts.length}`,
    ""
  ].filter(Boolean);
  const facts = (chunk.rawFacts || []).map((fact) => compactL2QueryFactForBudget(fact, {
    factChars: 360,
    evidenceItems: 1,
    evidenceChars: 80
  }));
  for (const fact of facts) {
    const chapterLabel = fact.chapter_index ? `第${fact.chapter_index}章` : "章节不明";
    const typeLabel = fact.fact_type ? ` / ${fact.fact_type}` : "";
    const entityLabel = fact.entity ? ` / ${fact.entity}` : "";
    lines.push(`- **${chapterLabel}${typeLabel}${entityLabel}**：${fact.fact || "信息不足"}`);
    if (fact.evidence?.length) {
      lines.push(`  证据摘录：${fact.evidence.join("；")}`);
    }
  }
  return lines.join("\n");
}

function buildL2QueryMergeFallbackMarkdown({ query, batchResults }) {
  const lines = [
    "## L2 提问结果（系统降级合并）",
    "",
    "Dify 最终合并返回空文本；以下内容按各分块 Markdown 保真拼接，未读取章节原文。",
    "",
    `查询：${query}`,
    ""
  ];
  for (const result of batchResults || []) {
    const chapterRange = compactChapterSample(result.chapters || [], 8).join("、") || "章节不明";
    lines.push(`### 分块 ${result.batch}/${result.total}（${result.fact_count} 条事实；章节 ${chapterRange}）`);
    lines.push(clipText(result.markdown || "信息不足", 3000));
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function collectL2QueryCandidateFacts({ bookId, indexGroupKeys, startChapter, endChapter, windowChapters, perWindowLimit }) {
  const rangeStart = Number(startChapter || 0);
  const rangeEnd = Number(endChapter || 0);
  const size = Math.max(1, Number(windowChapters || L2_QUERY_WINDOW_CHAPTERS));
  const facts = [];
  let windows = 0;
  for (let currentStart = rangeStart; currentStart <= rangeEnd; currentStart += size) {
    const currentEnd = Math.min(rangeEnd, currentStart + size - 1);
    windows += 1;
    const batch = listL2Facts({
      bookId,
      indexGroupKeys,
      startChapter: currentStart,
      endChapter: currentEnd,
      limit: perWindowLimit,
      includeContent: true
    });
    facts.push(...batch);
  }
  return {
    facts: dedupeFactsById(facts),
    windows
  };
}

function hasStructuredL1Route(index) {
  return Boolean(index?.route_schema_version)
    || (Array.isArray(index?.route_entities) && index.route_entities.length)
    || (Array.isArray(index?.route_keywords) && index.route_keywords.length)
    || (Array.isArray(index?.signals) && index.signals.length);
}

function compactL1RouteForPrompt(index) {
  if (!index) return null;
  if (hasStructuredL1Route(index)) {
    return {
      route_schema_version: index.route_schema_version || "l1-route-v1",
      route_entities: index.route_entities || [],
      route_keywords: index.route_keywords || [],
      signals: index.signals || [],
      category_scores: index.category_scores || {}
    };
  }
  return {
    route_schema_version: "legacy-l1-compatible",
    route_entities: normalizeLegacyRouteEntities(index.entities),
    route_keywords: normalizeLegacyRouteKeywords(index),
    signals: legacySignalsFromL1(index),
    category_scores: {}
  };
}

function normalizeLegacyRouteEntities(entities) {
  return (Array.isArray(entities) ? entities : []).map((entry) => {
    if (typeof entry === "string") {
      return { name: entry, type: "", aliases: [], role: "", note: "" };
    }
    return {
      name: String(entry?.name || "").trim(),
      type: String(entry?.type || "").trim(),
      aliases: Array.isArray(entry?.aliases) ? entry.aliases : [],
      role: "",
      note: String(entry?.note || "").trim()
    };
  }).filter((entry) => entry.name).slice(0, 16);
}

function normalizeLegacyRouteKeywords(index) {
  return [
    ...(index.keywords || []),
    ...(index.key_events || []),
    ...(index.items_places_orgs || []),
    ...(index.open_questions || [])
  ].map((entry) => {
    if (typeof entry === "string") return entry;
    return [entry?.name, entry?.type, entry?.note].filter(Boolean).join(" ");
  }).filter(Boolean).slice(0, 24);
}

function legacySignalsFromL1(index) {
  const signals = [];
  if (Array.isArray(index.entities) && index.entities.length) {
    signals.push({ category: "character", strength: 0.6, entities: normalizeLegacyRouteEntities(index.entities).map((entry) => entry.name), keywords: [], reason: "旧 L1 实体字段" });
  }
  if (Array.isArray(index.key_events) && index.key_events.length) {
    signals.push({ category: "event", strength: 0.6, entities: [], keywords: index.key_events.slice(0, 8), reason: "旧 L1 关键事件字段" });
  }
  if (Array.isArray(index.open_questions) && index.open_questions.length) {
    signals.push({ category: "foreshadowing", strength: 0.6, entities: [], keywords: index.open_questions.slice(0, 8), reason: "旧 L1 伏笔字段" });
  }
  return signals;
}

function normalizeRouteToken(value) {
  return String(value || "").trim().toLowerCase();
}

function recallL2QueryFacts({ facts, query, targetContext = null, extraTerms = [], limit = L2_QUERY_MAX_FACTS, allowExpandedLimit = false }) {
  const baseTerms = uniqueCompact([
    ...extractL2QueryTerms(query, targetContext?.subject),
    ...(Array.isArray(extraTerms) ? extraTerms : [])
  ].map(cleanupL2QueryTerm).filter(Boolean), 80);
  const initialTargetTerms = l2QueryTargetTerms(targetContext, baseTerms);
  const directTargetEntries = targetContext?.subject
    ? (Array.isArray(facts) ? facts : [])
      .filter((fact) => isStrongL2TargetMatch(fact, targetContext, initialTargetTerms))
      .map((fact) => ({ fact, score: 1000 + Number(fact?.importance || 0), matched: initialTargetTerms.length || 1 }))
    : [];
  const firstPassTerms = uniqueCompact([...baseTerms, ...initialTargetTerms], 80);
  const firstPass = scoreL2QueryFacts(facts, firstPassTerms)
    .filter((entry) => entry.score > 0)
    .sort(compareL2QueryScores);
  const targetSeedEntries = initialTargetTerms.length
    ? firstPass.filter((entry) => isStrongL2TargetMatch(entry.fact, targetContext, initialTargetTerms))
    : [];
  const expansionSourceEntries = directTargetEntries.length ? directTargetEntries : targetSeedEntries.length ? targetSeedEntries : firstPass;
  const expandedTerms = expandL2QueryTerms(
    expansionSourceEntries.slice(0, 80).map((entry) => entry.fact),
    baseTerms
  );
  const terms = uniqueCompact([...baseTerms, ...expandedTerms], 80);
  const scored = dedupeL2QueryScoreEntries(scoreL2QueryFacts(facts, terms)
    .filter((entry) => entry.score > 0)
    .sort(compareL2QueryScores));
  const requestedLimit = Number(limit) || L2_QUERY_MAX_FACTS;
  const maxFacts = allowExpandedLimit
    ? Math.max(1, requestedLimit)
    : Math.max(1, Math.min(L2_QUERY_MAX_FACTS, requestedLimit));
  const targetTerms = targetSeedEntries.length
    ? l2QueryTargetTerms(targetContext, expandL2QueryTerms(
      targetSeedEntries.slice(0, 80).map((entry) => entry.fact),
      initialTargetTerms
    ))
    : l2QueryTargetTerms(targetContext, baseTerms);
  const targetEntries = directTargetEntries.length
    ? directTargetEntries
    : targetTerms.length
      ? scored.filter((entry) => isStrongL2TargetMatch(entry.fact, targetContext, targetTerms))
    : [];
  const selectedEntries = targetEntries.length
    ? selectL2QueryTargetRecallEntries({
      scored,
      targetEntries,
      targetContext,
      supportTerms: expandedTerms,
      limit: directTargetEntries.length ? targetEntries.length : Math.max(maxFacts, targetEntries.length)
    })
    : selectL2QueryRecallEntries({
      scored,
      targetEntries,
      limit: maxFacts
    });
  const selected = selectedEntries.map((entry) => entry.fact)
    .sort((left, right) => Number(left.chapter_index || 0) - Number(right.chapter_index || 0)
      || Number(right.importance || 0) - Number(left.importance || 0));
  return {
    facts: selected,
    matchedTerms: terms.filter((term) => selected.some((fact) => l2QueryFactSearchText(fact).includes(normalizeRouteToken(term)))).slice(0, 40),
    expandedTerms,
    scoredFacts: scored.length,
    targetCandidateFacts: targetEntries.length,
    targetSelectedFacts: selectedEntries.filter((entry) => targetEntries.includes(entry)).length,
    targetSelectedChapters: new Set(selectedEntries
      .filter((entry) => targetEntries.includes(entry))
      .map((entry) => Number(entry?.fact?.chapter_index || 0))
      .filter(Boolean)).size,
    droppedAfterRecallLimit: Math.max(0, scored.length - selectedEntries.length)
  };
}

function l2QuerySummaryProgressMessage({ recall, candidateFacts, targetSubject, collectionMode = false }) {
  const recalled = Number(recall?.facts?.length || 0);
  const targetCandidates = Number(recall?.targetCandidateFacts || 0);
  if (targetSubject && targetCandidates) {
    return `正在基于 ${recalled}/${targetCandidates} 条目标 L2 事实生成回答（全库候选 ${candidateFacts} 条）`;
  }
  if (collectionMode) {
    return `正在基于 ${recalled} 条集合候选 L2 事实分块提取（全库候选 ${candidateFacts} 条）`;
  }
  return `正在基于 ${recalled}/${candidateFacts} 条 L2 事实生成回答`;
}

function dedupeL2QueryScoreEntries(entries) {
  const seen = new Set();
  const output = [];
  for (const entry of entries || []) {
    const fact = entry?.fact;
    const key = fact?.id || [
      fact?.book_id,
      fact?.index_group_key,
      fact?.chapter_index,
      fact?.category,
      fact?.entity,
      fact?.fact_type,
      fact?.fact
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function selectL2QueryRecallEntries({ scored, targetEntries, limit }) {
  const selected = [];
  const seen = new Set();
  const addEntry = (entry) => {
    const key = l2QueryScoreEntryKey(entry);
    if (!key || seen.has(key) || selected.length >= limit) return false;
    seen.add(key);
    selected.push(entry);
    return true;
  };

  const targetSelection = selectCoveragePreservingL2QueryEntries(targetEntries, Math.min(limit, targetEntries.length));
  for (const entry of targetSelection) addEntry(entry);
  for (const entry of scored || []) addEntry(entry);
  return selected;
}

function selectL2QueryTargetRecallEntries({ scored, targetEntries, targetContext = null, supportTerms = [], limit }) {
  const targetSelection = selectCoveragePreservingL2QueryEntries(targetEntries, Math.min(limit, targetEntries.length));
  const ownerTerms = targetOwnerTerms(targetContext);
  if (ownerTerms.length) return targetSelection;
  const supportEntries = (scored || []).filter((entry) => {
    if (targetEntries.includes(entry)) return false;
    const haystack = l2QueryFactSearchText(entry.fact);
    const supportMatched = supportTerms.some((term) => haystack.includes(normalizeRouteToken(term)));
    if (!supportMatched) return false;
    return true;
  });
  const supportLimit = Math.min(
    Math.max(0, limit - targetSelection.length),
    Math.max(8, Math.min(48, targetEntries.length * 2))
  );
  const supportSelection = selectCoveragePreservingL2QueryEntries(supportEntries, supportLimit);
  return [...targetSelection, ...supportSelection];
}

function selectCoveragePreservingL2QueryEntries(entries, limit) {
  const input = Array.isArray(entries) ? entries : [];
  if (!limit || input.length <= limit) return input.slice(0, limit);

  const selected = [];
  const seen = new Set();
  const addEntry = (entry) => {
    const key = l2QueryScoreEntryKey(entry);
    if (!key || seen.has(key) || selected.length >= limit) return false;
    seen.add(key);
    selected.push(entry);
    return true;
  };

  const topCount = Math.max(1, Math.floor(limit * 0.6));
  for (const entry of input.slice(0, topCount)) addEntry(entry);

  const bestByChapter = new Map();
  for (const entry of input) {
    const chapter = Number(entry?.fact?.chapter_index || 0);
    if (!chapter || bestByChapter.has(chapter)) continue;
    bestByChapter.set(chapter, entry);
  }
  const coverageEntries = [...bestByChapter.values()]
    .sort((left, right) => Number(left.fact?.chapter_index || 0) - Number(right.fact?.chapter_index || 0));
  for (const entry of evenlySampleL2QueryEntries(coverageEntries, limit - selected.length)) addEntry(entry);
  for (const entry of input) addEntry(entry);
  return selected;
}

function evenlySampleL2QueryEntries(entries, count) {
  const input = Array.isArray(entries) ? entries : [];
  if (count <= 0) return [];
  if (input.length <= count) return input;
  if (count === 1) return [input[input.length - 1]];
  const output = [];
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.round((index * (input.length - 1)) / (count - 1));
    const entry = input[sourceIndex];
    const key = l2QueryScoreEntryKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function l2QueryScoreEntryKey(entry) {
  const fact = entry?.fact;
  if (!fact) return "";
  return fact.id || [
    fact.book_id,
    fact.index_group_key,
    fact.chapter_index,
    fact.category,
    fact.entity,
    fact.fact_type,
    fact.fact
  ].join("|");
}

function l2QueryTargetTerms(targetContext, baseTerms = []) {
  const target = targetContext?.subject || "";
  if (!target) return [];
  return uniqueCompact([
    target,
    ...(Array.isArray(targetContext?.aliases) ? targetContext.aliases : []),
    ...baseTerms.filter(isLikelyL2TargetAliasTerm)
  ], 12);
}

function targetOwnerTerms(targetContext) {
  const possessive = splitPossessiveTargetSubject(targetContext?.subject || "");
  if (!possessive?.owner) return [];
  return uniqueCompact([
    possessive.owner,
    ...l2QuerySubTerms(possessive.owner)
  ].map(cleanupL2QueryTerm).filter(Boolean), 6);
}

function targetDescriptorTerms(targetContext) {
  const aliases = Array.isArray(targetContext?.aliases) ? targetContext.aliases : [];
  const possessive = splitPossessiveTargetSubject(targetContext?.subject || "");
  const object = possessive?.object || "";
  const descriptors = [...aliases];
  if (object) {
    descriptors.push(object);
    const suffix = object.match(/(法袍|飞剑|本命飞剑|本命物|佩剑|长剑|短剑|重剑|古剑|剑胚|剑鞘|剑匣|法宝|宝甲|甲胄|道袍|衣袍|长袍)$/);
    if (suffix?.[1] && normalizeRouteToken(object) === normalizeRouteToken(suffix[1])) descriptors.push(suffix[1]);
  }
  return uniqueCompact(descriptors.map(cleanupL2QueryTerm).filter(Boolean), 12);
}

function isStrongL2TargetMatch(fact, targetContext, targetTerms = []) {
  if (!fact || !targetContext?.subject) return false;
  const ownerTerms = targetOwnerTerms(targetContext);
  const descriptorTerms = targetDescriptorTerms(targetContext);
  if (ownerTerms.length && descriptorTerms.length) {
    if (factMatchesAnyEntity(fact, [targetContext.subject])) return true;
    const haystack = l2QueryFactSearchText(fact);
    const ownerMatched = ownerTerms.every((term) => haystack.includes(normalizeRouteToken(term)));
    const descriptorMatched = descriptorTerms.some((term) => haystack.includes(normalizeRouteToken(term)));
    return ownerMatched && descriptorMatched;
  }
  const explicitAliases = uniqueCompact([
    targetContext.subject,
    ...(Array.isArray(targetContext?.aliases) ? targetContext.aliases : [])
  ].map(cleanupL2QueryTerm).filter(Boolean), 8);
  if (explicitAliases.length && factMatchesAnyStructuredTargetField(fact, explicitAliases)) return true;
  if (targetTerms.length) return factMatchesAnyStructuredTargetField(fact, targetTerms);
  return false;
}

function factMatchesAnyStructuredTargetField(fact, terms = []) {
  const fields = [
    fact?.entity,
    ...(Array.isArray(fact?.aliases) ? fact.aliases : []),
    ...(Array.isArray(fact?.tags) ? fact.tags : []),
    ...(Array.isArray(fact?.related_entities) ? fact.related_entities : [])
  ].map(normalizeRouteToken).filter(Boolean);
  const normalizedTerms = uniqueCompact((terms || []).map(normalizeRouteToken).filter(Boolean), 16);
  return normalizedTerms.some((term) => fields.some((field) => field === term || (term.length >= 3 && field.includes(term))));
}

function isLikelyL2TargetAliasTerm(value) {
  const text = normalizeRouteToken(value);
  if (!text || text.length < 2 || text.length > 12) return false;
  if (/以及|对应|章节|事实|内容|结果|要求|时间线|演化/.test(text)) return false;
  if (/^(飞剑|剑类|陈平安|养剑葫|战绩|能力|来源|外形|形态|性格|本命飞剑|other|appearance|ability|trait|ownership|combat_record)$/.test(text)) return false;
  return true;
}

function scoreL2QueryFacts(facts, terms) {
  const normalizedTerms = uniqueCompact(terms.map(normalizeRouteToken).filter((term) => term.length >= 2), 80);
  return (Array.isArray(facts) ? facts : []).map((fact) => {
    const haystack = l2QueryFactSearchText(fact);
    const contentText = normalizeRouteToken(fact?.fact || "");
    const entityText = normalizeRouteToken(fact?.entity || "");
    let score = Number(fact?.importance || 0) * 2 + Number(fact?.confidence || 0);
    let matched = 0;
    for (const term of normalizedTerms) {
      if (!haystack.includes(term)) continue;
      matched += 1;
      score += 2;
      if (contentText.includes(term)) score += 2.5;
      if (entityText === term) score += 4;
      if (term.length >= 3) score += 0.8;
    }
    return { fact, score: matched ? score : 0, matched };
  });
}

function compareL2QueryScores(left, right) {
  return right.score - left.score
    || right.matched - left.matched
    || Number(right.fact?.importance || 0) - Number(left.fact?.importance || 0)
    || Number(left.fact?.chapter_index || 0) - Number(right.fact?.chapter_index || 0);
}

function dedupeFactsById(facts) {
  const seen = new Set();
  const output = [];
  for (const fact of facts || []) {
    const key = fact?.id || [
      fact?.book_id,
      fact?.index_group_key,
      fact?.chapter_index,
      fact?.category,
      fact?.entity,
      fact?.fact_type,
      fact?.fact
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(fact);
  }
  return output;
}

function buildL2QueryIntent(query, indexGroups = []) {
  const reason = l2QueryCollectionReason(query, indexGroups);
  const collectionMode = Boolean(reason);
  const targetContext = collectionMode
    ? { subject: "", aliases: [], source: "collection" }
    : buildTargetContext({ userPrompt: query });
  const recallTerms = buildL2QueryIntentRecallTerms(query, indexGroups, { collectionMode });
  return {
    intent: collectionMode ? "collection" : targetContext.subject ? "target" : "query",
    collectionMode,
    targetContext,
    recallTerms,
    reason
  };
}

function l2QueryCollectionReason(query, indexGroups = []) {
  const text = normalizeRouteToken(query);
  if (!text || isExplicitSingleTargetL2Query(text)) return "";
  const contextText = normalizeRouteToken([
    query,
    ...(indexGroups || []).flatMap((group) => [
      group?.name,
      group?.description,
      group?.l2_index_prompt,
      ...(Array.isArray(group?.category_scope) ? group.category_scope : []),
      ...(Array.isArray(group?.trigger_keywords) ? group.trigger_keywords : [])
    ])
  ].filter(Boolean).join(" "));
  const hits = [];
  if (/提取|整理|汇总|列出|输出|清单|列表/.test(text)) hits.push("清单");
  if (/排名|排行|top\s*\d+|前\s*\d+|取前|取\d+|前三|前五|前十|最重要|重要程度|最强/.test(text)) hits.push("排行");
  if (/最强/.test(text)) hits.push("最强");
  if (/每个|每一|各个|各境|分境界|分层|逐境界/.test(text)) hits.push("分组");
  if (/最强人物|人物境界|境界排名/.test(text)) hits.push("修炼体系排行");
  const asksForCollection = hits.length > 0;
  const asksForManyItems = /所有|全部|多把|一批|前\s*\d+|top\s*\d+|取前|取\d+|前三|前五|前十|清单|列表|排名|排行|每个|每一|各个|各境|分境界|逐境界|最强人物|人物境界/.test(text);
  const hasCollectionSubject = /飞剑|剑胚|剑匣|剑气|剑意|武器|法宝|道具|人物|角色|地点|势力|武夫|纯粹武夫|武道|修炼|境界|体系/.test(contextText);
  return asksForCollection && asksForManyItems && hasCollectionSubject
    ? uniqueCompact(hits, 4).join(" / ")
    : "";
}

function isExplicitSingleTargetL2Query(text) {
  const hasSpecificTarget = /武夫第[一二三四五六七八九十\d]+境|第[一二三四五六七八九十\d]+境|远游境|山巅境|止境|气盛|归真|神到/.test(text);
  if (!hasSpecificTarget) return false;
  const hasRankingOrGrouping = /每个|每一|各个|各境|分境界|逐境界|排名|排行|top\s*\d+|前\s*\d+|取前|取\d+|前三|前五|最强/.test(text);
  return !hasRankingOrGrouping && /总结|查询|查找|关于|全部|全部事实|相关事实/.test(text);
}

function buildL2QueryIntentRecallTerms(query, indexGroups = [], { collectionMode = false } = {}) {
  const contextText = [
    query,
    ...(indexGroups || []).flatMap((group) => [
      group?.name,
      group?.description,
      group?.l2_index_prompt
    ])
  ].filter(Boolean).join(" ");
  const terms = [];
  if (/武夫|纯粹武夫|武道|修炼|境界|体系|山巅境|远游境|止境/.test(contextText)) {
    terms.push(
      "cultivation",
      "武夫",
      "纯粹武夫",
      "武道",
      "境界",
      "境界体系",
      "修炼",
      "山巅境",
      "远游境",
      "止境",
      "十境",
      "九境",
      "八境",
      "七境"
    );
  }
  if (collectionMode && /人物|角色|最强|前三|排名|排行|代表/.test(contextText)) {
    terms.push("代表人物", "人物");
  }
  return uniqueCompact(terms.map(cleanupL2QueryTerm).filter(Boolean), 32);
}

function extractL2QueryTerms(query, target = "") {
  const text = String(query || "");
  const terms = [];
  if (target) terms.push(target);
  terms.push(...inferEntityQueriesFromPrompt(text));
  for (const match of text.matchAll(/[《“「『‘（(]([^》”」』’）)]{1,24})[》”」』’）)]/g)) {
    terms.push(match[1]);
  }
  for (const segment of text.split(/[，。；;、\s\n\r:：/｜|]+/)) {
    const cleaned = cleanupL2QueryTerm(segment);
    if (cleaned) terms.push(cleaned);
    for (const token of l2QuerySubTerms(cleaned)) terms.push(token);
  }
  return uniqueCompact(terms.map(cleanupL2QueryTerm).filter(Boolean), 48);
}

function cleanupL2QueryTerm(value) {
  let text = String(value || "").trim();
  text = text.replace(/^(帮我|请|查询|查找|整理|总结|输出|关于|围绕|直接|内容|结果|相关|事实|章节|原文中?|称之为|称为|早期|后期)+/g, "");
  text = text.replace(/(内容|结果|相关事实|事实清单|时间线|设定集|对应章节|输出要求|模式)$/g, "");
  text = text.trim();
  if (!text || text.length < 2 || text.length > 18) return "";
  if (/^(剑来|l2|json|markdown|事实|章节|内容|整理|总结|查询|查找|时间线|外形演化|输出|需要有人名|有人名|人名|人物介绍|人物简介|介绍|为什么重要)$|^\d+$/.test(text.toLowerCase())) return "";
  if (/^(最强人物|人物境界|武夫每个境界|每个境界|取前三|前三)$/.test(text)) return "";
  return text;
}

function l2QuerySubTerms(value) {
  const text = String(value || "");
  const terms = new Set();
  for (const match of text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,8}/g)) {
    const word = match[0];
    if (/初一|十五|小酆都|银锭|白虹|剑胚|飞剑|外形|形态|炼化|来历|战绩|神通|持有|名字|别名|称呼|武夫|武道|境界|修炼|山巅境|远游境|止境|十境|九境|八境|七境/.test(word)) {
      terms.add(word);
    }
  }
  for (const keyword of ["初一", "十五", "小酆都", "银锭", "小银锭", "白虹", "小小白虹", "剑胚", "飞剑", "外形", "形态", "武夫", "纯粹武夫", "武道", "境界", "境界体系", "修炼", "山巅境", "远游境", "止境", "十境", "九境", "八境", "七境", "代表人物"]) {
    if (text.includes(keyword)) terms.add(keyword);
  }
  return [...terms];
}

function expandL2QueryTerms(facts, baseTerms) {
  const base = new Set(baseTerms.map(normalizeRouteToken));
  const terms = [];
  for (const fact of facts || []) {
    terms.push(
      fact?.entity,
      fact?.fact_type,
      ...(Array.isArray(fact?.aliases) ? fact.aliases : []),
      ...(Array.isArray(fact?.tags) ? fact.tags : []),
      ...(Array.isArray(fact?.related_entities) ? fact.related_entities : [])
    );
    const text = [fact?.fact, ...(Array.isArray(fact?.evidence) ? fact.evidence : [])].join(" ");
    for (const match of text.matchAll(/[“「『‘]([^”」』’]{1,12})[”」』’]/g)) {
      terms.push(match[1]);
    }
    for (const keyword of ["小酆都", "银锭", "小银锭", "银块", "剑胚", "白虹", "小小的白虹", "晶莹剔透", "纤小"]) {
      if (text.includes(keyword)) terms.push(keyword);
    }
  }
  return uniqueCompact(terms
    .map(cleanupL2QueryTerm)
    .filter((term) => term && !base.has(normalizeRouteToken(term))), 32);
}

function l2QueryFactSearchText(fact) {
  return [
    fact?.category,
    fact?.entity,
    fact?.fact_type,
    fact?.fact,
    ...(Array.isArray(fact?.aliases) ? fact.aliases : []),
    ...(Array.isArray(fact?.tags) ? fact.tags : []),
    ...(Array.isArray(fact?.related_entities) ? fact.related_entities : []),
    ...(Array.isArray(fact?.evidence) ? fact.evidence : [])
  ].map(normalizeRouteToken).join(" ");
}

function resolveAnalysisIndexGroups({ bookId, indexGroupKeys = [] }) {
  const groups = listBookIndexGroups(bookId);
  const byKey = new Map(groups.map((group) => [group.group_key, group]));
  const explicitKeys = normalizeIndexGroupKeysForWorkflow(indexGroupKeys)
    .filter((key) => key !== "base");
  if (!explicitKeys.length) {
    const enabledGroups = groups.filter((group) => group.enabled);
    const nonBaseEnabled = enabledGroups.filter((group) => group.group_key !== "base");
    if (nonBaseEnabled.length) return nonBaseEnabled;
    return enabledGroups;
  }
  const missing = explicitKeys.filter((key) => !byKey.has(key));
  if (missing.length) {
    const error = new Error(`分析模板绑定的事实索引不存在或已禁用：${missing.join("、")}`);
    error.status = 422;
    throw error;
  }
  return explicitKeys.map((key) => byKey.get(key)).filter(Boolean);
}

function normalizeIndexGroupKeysForWorkflow(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return [...new Set(raw
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map(normalizeIndexGroupKey)
    .filter(Boolean))];
}

function normalizeFinalSchemaValue(value, schemaConfig) {
  const unwrapField = schemaConfig?.unwrapField;
  if (!unwrapField) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value[unwrapField])) {
    return value[unwrapField];
  }
  return value;
}

async function runFinalSummaryCall({
  analysisId,
  task,
  partKey,
  stageLabel,
  model,
  requestModel = model,
  reasoningEffort,
  userPrompt = "",
  input,
  schema,
  sourceChapterCount,
  traceSummary = null,
  errorLabel = "Dify 分析工作流"
}) {
  assertSummaryInputWithinBudget(input, stageLabel);
  const contentHash = summaryContentHash({ input, schema: schema?.schema || null, userPrompt });
  const basePart = {
    analysisId,
    partKey: partKey || (schema?.schema ? "json.final.merge" : "text.final.merge"),
    parentKey: "",
    stage: schema?.schema ? "json_final_merge" : "text_final_merge",
    contentHash,
    promptHash: shaString(userPrompt || ""),
    schemaHash: shaString(schema?.schema ? JSON.stringify(schema.schema) : ""),
    model,
    reasoningEffort,
    inputSummary: `${stageLabel} · 输入 ${inputTextLength(input)} 字`,
    traceSummary
  };
  if (schema?.schema) {
    return runPersistedSummaryNode(task, basePart, async () => {
      const response = await callAnalysisJson({
        model: requestModel,
        reasoningEffort,
        instructions: [
          "你是严谨的小说多章节汇总引擎。按用户汇总 Prompt 输出最终结果；如果用户要求 JSON，则只输出合法 JSON，否则直接输出文本，不要添加无关解释。",
          schema?.unwrapField ? `结构化输出时请先用 ${schema.unwrapField} 字段承载用户要求的数组，系统保存前会自动解包为用户要求的数组。` : ""
        ].filter(Boolean).join("\n"),
        input,
        schema: schema.schema,
        schemaName: schema.schemaName,
        maxOutputTokens: SUMMARY_FINAL_MAX_OUTPUT_TOKENS,
        strict: schema.strict,
        errorLabel
      });
      const finalValue = normalizeFinalSchemaValue(response.value, schema);
      assertFinalSummaryUseful(parseJsonOrText(finalValue), sourceChapterCount, {
        schema: schema.schema,
        schemaName: schema.schemaName,
        userPrompt
      });
      return { ...response, value: finalValue };
    });
  }
  return runPersistedSummaryNode(task, basePart, async () => {
    const response = await callAnalysisText({
      model: requestModel,
      reasoningEffort,
      instructions: "你是严谨的小说多章节汇总引擎。按用户汇总 Prompt 输出最终结果；如果用户要求 JSON，则只输出合法 JSON，否则直接输出文本，不要添加无关解释。",
      input,
      maxOutputTokens: SUMMARY_FINAL_MAX_OUTPUT_TOKENS,
      errorLabel
    });
    assertFinalSummaryUseful(parseJsonOrText(response.value), sourceChapterCount, {
      schema: schema?.schema || null,
      schemaName: schema?.schemaName || "",
      userPrompt
    });
    return response;
  });
}

function isScalarFieldSchema(schema) {
  if (!schema) return true;
  if (schema.type === "array" || schema.type === "object") return false;
  if (schema.anyOf) return schema.anyOf.every(isScalarFieldSchema);
  return true;
}

function isAnalysisParameterField(fieldName, fieldSchema) {
  if (!isScalarFieldSchema(fieldSchema)) return false;
  return /^(target|target_subject|subject|analysis_subject|analysis_goal|task_goal|scope|range|stage|phase|period|era|context|dimension|dimensions|目标主体|分析主体|分析目标|任务目标|范围|分析范围|阶段|时期|时代|上下文|维度)$/i.test(String(fieldName || ""));
}

function normalizeAnalysisTargetCandidate(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/^(?:分析|梳理|整理|提炼|归纳|研究)\s*/, "")
    .replace(/^(?:小说中|全书中|本书中|这本书中|《[^》]+》中)?(?:的)?/, "")
    .replace(/(?:相关内容|相关资料|相关事实|资料|内容|信息|情况)$/g, "")
    .replace(/[，,、]\s*(?:并|以及|同时).+$/g, "")
    .trim();
  return text.slice(0, 80);
}

function buildTargetContext({ userPrompt, schema, sourceMaterial } = {}) {
  const template = extractLastJsonObjectTemplate(userPrompt);
  const candidates = [
    template?.target_item,
    template?.target_subject,
    template?.subject,
    template?.topic,
    inferL2QueryTargetSubject(userPrompt),
    sourceMaterial?.targetContext?.subject
  ];
  for (const candidate of candidates) {
    const subject = normalizeTargetSubject(candidate);
    if (subject) {
      return {
        subject,
        aliases: buildTargetAliases(subject),
        source: candidate === template?.target_item ? "template.target_item" : "prompt"
      };
    }
  }
  const schemaFields = schema?.properties ? Object.keys(schema.properties) : [];
  return { subject: "", aliases: [], source: schemaFields.length ? "schema" : "" };
}

function buildTargetAliases(subject) {
  const text = String(subject || "").trim();
  if (!text) return [];
  const aliases = [text];
  aliases.push(...splitTargetAliasText(text));
  const possessive = splitPossessiveTargetSubject(text);
  if (possessive?.object) {
    aliases.push(possessive.object);
    aliases.push(...splitTargetAliasText(possessive.object));
  }
  return uniqueCompact(aliases.map(normalizeTargetSubject).filter(Boolean), 8);
}

function splitTargetAliasText(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const normalized = text
    .replace(/（\s*(?:亦称|又称|别称|也称|简称)\s*([^）]{1,32})）/g, "/$1")
    .replace(/\(\s*(?:亦称|又称|别称|也称|简称)\s*([^)]{1,32})\)/g, "/$1");
  return normalized
    .split(/[/／|｜、，,；;]/)
    .map((entry) => entry.replace(/^(?:亦称|又称|别称|也称|简称)/, "").trim())
    .filter((entry) => entry && entry !== text);
}

function splitPossessiveTargetSubject(value) {
  const text = String(value || "").trim();
  const index = text.lastIndexOf("的");
  if (index <= 0 || index >= text.length - 1) return null;
  const owner = text.slice(0, index).trim();
  const object = text.slice(index + 1).trim();
  if (!owner || !object) return null;
  return { owner, object };
}

function inferL2QueryTargetSubject(prompt) {
  const text = String(prompt || "");
  if (isL2CollectionQuery(text)) return "";
  const quotedCandidates = [...text.matchAll(/[《“「『‘]([^》”」』’]{2,40})[》”」』’]/g)]
    .map((match) => normalizeTargetSubject(match[1]))
    .filter(Boolean);
  const slashQuoted = quotedCandidates.find((candidate) => splitTargetAliasText(candidate).length >= 2);
  if (slashQuoted) return slashQuoted;
  const quoted = quotedCandidates.find((candidate) => isLikelyL2TargetSubjectTerm(candidate));
  if (quoted) return quoted;
  const patternMatch = text.match(/(?:查询|查找|关于|围绕|聚焦|只看|输出|整理|总结)\s*([^\s，。；;、（）()]{2,12}?)(?:相关|这把|这件|的|事实|内容|外形|形态|时间线|形象|外貌|关系)/);
  const candidates = [
    patternMatch?.[1],
    ...extractL2QueryTerms(text).filter(isLikelyL2TargetSubjectTerm)
  ];
  for (const candidate of candidates) {
    const subject = normalizeTargetSubject(candidate);
    if (subject && isLikelyL2TargetSubjectTerm(subject)) return subject;
  }
  return "";
}

function isL2CollectionQuery(prompt) {
  return Boolean(l2QueryCollectionReason(prompt));
}

function isLikelyL2TargetSubjectTerm(value) {
  const text = normalizeRouteToken(value);
  if (!text || text.length < 2 || text.length > 12) return false;
  if (/提取|输出|总结|整理|包含|涉及|所有|清单|列表|名称|持有者|重要程度|前\d+|多少|最强|每个|各个|分境界|取前三|前三|人物境界|人物介绍|需要有人名/.test(text)) return false;
  if (/^(把|个|条|项|类)/.test(text)) return false;
  if (/以及|对应|章节|事实|内容|结果|要求|时间线|演化|外形|形态|来源|能力|战绩|设定|信息/.test(text)) return false;
  if (/^(l2|json|markdown|剑来|飞剑|本命飞剑|剑类|道具|重要道具|陈平安|章节)$/.test(text)) return false;
  return true;
}

function normalizeTargetSubject(value) {
  let text = normalizeAnalysisTargetCandidate(value);
  if (!text) return "";
  text = text
    .replace(/设定集|资料集|分析|专题|topic|target/gi, "")
    .replace(/^飞剑[·:：\s]*/, "")
    .replace(/[（）()[\]【】]/g, " ")
    .replace(/[《》“”「」『』‘’"']/g, " ")
    .trim();
  text = stripL2TargetDescriptorSuffix(text);
  if (!text || isTemplatePlaceholderText(text) || isReservedTemplateToken(text)) return "";
  if (text.length > 24 && /初一/.test(text)) return "初一";
  return text.slice(0, 24);
}

function stripL2TargetDescriptorSuffix(value) {
  let text = String(value || "").trim();
  for (let index = 0; index < 3; index += 1) {
    const next = text
      .replace(/(?:的)?(?:人物)?(?:形象特征|形象特点|形象描写|形象|外貌特征|外貌描写|外貌|外形特征|外形描写|外形|关系网|人物关系|关系|介绍|简介)$/g, "")
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

function isReservedTemplateToken(value) {
  return /^(book_id|book_name|task|target_subject|summary|items|title|version|schema|json)$/i.test(String(value || "").trim());
}

function isTemplatePlaceholderText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /用户指定|指定主体|目标主体|待填写|请填写|请输入|占位|placeholder|todo/i.test(text);
}

function isLargeFieldSchema(schema) {
  if (!schema) return true;
  if (schema.type === "array") return true;
  if (schema.type === "object") return true;
  if (schema.anyOf) return schema.anyOf.some(isLargeFieldSchema);
  return false;
}

function assertSummaryInputWithinBudget(input, label) {
  const length = inputTextLength(input);
  if (length <= SUMMARY_PART_INPUT_MAX_CHARS) return;
  const error = new Error(`最终汇总分块输入超过预算：${label || "unknown"} ${length}/${SUMMARY_PART_INPUT_MAX_CHARS} 字。`);
  error.status = 502;
  throw error;
}

async function runPersistedSummaryNode(task, metadata, operation) {
  const existing = await getReusableSummaryPart(metadata);
  if (existing) {
    saveAnalysisSummaryPart({
      ...metadata,
      status: "completed",
      result: existing
    });
    updateTask(task, {
      progress: {
        ...task.progress,
        current: `复用汇总分块 ${metadata.partKey}`,
        summary_parts: await summaryProgressForAnalysis(metadata.analysisId)
      },
      message: `复用已完成汇总分块：${metadata.partKey}`
    });
    return existing;
  }
  saveAnalysisSummaryPart({
    ...metadata,
    status: "running"
  });
  try {
    const result = await runSummaryStageWithRetry(task, metadata.partKey, operation);
    saveAnalysisSummaryPart({
      ...metadata,
      status: "completed",
      result
    });
    updateTask(task, {
      progress: {
        ...task.progress,
        summary_parts: await summaryProgressForAnalysis(metadata.analysisId)
      },
      message: `汇总分块完成：${metadata.partKey}`
    });
    return result;
  } catch (error) {
    saveAnalysisSummaryPart({
      ...metadata,
      status: "failed",
      errorSummary: sanitizeText(error.message)
    });
    throw error;
  }
}

async function getReusableSummaryPart(metadata) {
  const existing = getAnalysisSummaryPartMetadata(metadata.analysisId, metadata.partKey);
  if (!existing || existing.status !== "completed" || !existing.has_result) return null;
  if (existing.content_hash !== metadata.contentHash) return null;
  if (existing.prompt_hash !== metadata.promptHash) return null;
  if (existing.schema_hash !== metadata.schemaHash) return null;
  if (existing.model !== metadata.model) return null;
  if (existing.reasoning_effort !== metadata.reasoningEffort) return null;
  return getAnalysisSummaryPartResult(metadata.analysisId, metadata.partKey);
}

async function summaryProgressForAnalysis(analysisId) {
  const parts = listAnalysisSummaryPartMetadata(analysisId);
  return {
    total: parts.length,
    completed: parts.filter((part) => part.status === "completed").length,
    failed: parts.filter((part) => part.status === "failed").length,
    running: parts.filter((part) => part.status === "running").length
  };
}

function summaryContentHash(value) {
  return shaString(stableStringify(value));
}

function shaString(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isMetadataOnlyFieldName(fieldName) {
  return /^(book_id|book_name|task|title|version|schema_version|metadata|language|locale|format|output_format|analysis_mode|mode|source|source_type|stage|phase|period|era|阶段|时期|时代)$/i.test(String(fieldName || ""));
}

function sourceTraceFromMaterial({ partKey, parentKey = "", stage, fieldName, material, promptOverheadChars = 0, materialChars = 0 }) {
  const safeMaterial = material && typeof material === "object" ? material : {};
  const packets = Array.isArray(safeMaterial.evidence_packets) ? safeMaterial.evidence_packets : [];
  const compressedResults = Array.isArray(safeMaterial.compressedResults) ? safeMaterial.compressedResults : [];
  const chapters = [...new Set(packets
    .map((packet) => Number(packet.chapter_index || 0))
    .filter((chapterIndex) => Number.isFinite(chapterIndex) && chapterIndex > 0))]
    .sort((left, right) => left - right);
  const subjects = uniqueCompact(packets.map((packet) => packet.subject), 12);
  const relatedSubjects = uniqueCompact(packets.flatMap((packet) => packet.related_subjects || []), 8);
  const sourceStats = safeMaterial.sourceStats && typeof safeMaterial.sourceStats === "object" ? safeMaterial.sourceStats : {};
  const targetSubject = String(safeMaterial.target_subject || safeMaterial.targetContext?.subject || "");
  const targetEvidenceCount = targetSubject
    ? packets.filter((packet) => packet.target_match || evidencePacketMatchesTarget(packet, targetSubject)).length
    : packets.filter((packet) => packet.target_match).length;
  return {
    part_key: String(partKey || ""),
    parent_key: String(parentKey || ""),
    stage: String(stage || ""),
    field_name: String(fieldName || safeMaterial.split?.fieldName || ""),
    batch: Number(safeMaterial.split?.batch || 1),
    total_batches: Number(safeMaterial.split?.total || 1),
    evidence_packet_count: packets.length,
    source_types: countValues(packets.map((packet) => packet.source_type || "unknown")),
    chapters: {
      count: chapters.length,
      min: chapters[0] || null,
      max: chapters[chapters.length - 1] || null,
      sample: compactChapterSample(chapters)
    },
    categories: countValues(packets.map((packet) => packet.category).filter(Boolean)),
    fact_types: countValues(packets.map((packet) => packet.fact_type).filter(Boolean)),
    subjects,
    related_subjects: relatedSubjects,
    target_subject: targetSubject,
    target_evidence_count: Number(safeMaterial.target_evidence_count || targetEvidenceCount || 0),
    field_material_mode: String(safeMaterial.split?.mode || "evidence_packets"),
    prompt_overhead_chars: Number(promptOverheadChars || 0),
    material_chars: Number(materialChars || JSON.stringify(safeMaterial).length || 0),
    compressed_results_count: compressedResults.length,
    trimmed_by_budget: Boolean(sourceStats.evidence_packets_trimmed_by_budget),
    omitted_by_budget: Number(sourceStats.evidence_packets_omitted_by_budget || 0)
  };
}

function mergeCountMap(target, source) {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    target.set(key, (target.get(key) || 0) + Number(value || 0));
  }
}

function countValues(values) {
  const counts = {};
  for (const value of values || []) {
    const key = String(value || "").trim();
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function uniqueCompact(values, limit) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .slice(0, limit);
}

function compactChapterSample(chapters, limit = 16) {
  const values = [...new Set(chapters || [])].filter(Boolean).sort((left, right) => left - right);
  if (values.length <= limit) return values;
  const headCount = Math.ceil(limit / 2);
  const tailCount = Math.floor(limit / 2);
  return [...values.slice(0, headCount), ...values.slice(-tailCount)];
}

function factToEvidencePacket(fact) {
  if (!fact || typeof fact !== "object") return null;
  return {
    source_type: fact.review_source === "source_review" ? "source_review" : "l2_fact",
    chapter_index: Number(fact.chapter_index || 0) || null,
    category: String(fact.category || ""),
    subject: String(fact.entity || ""),
    related_subjects: compactStringArray(fact.related_entities, 5, 40),
    fact_type: String(fact.fact_type || ""),
    content: clipText(fact.fact || "", EVIDENCE_PACKET_CONTENT_CHARS),
    evidence: compactStringArray(fact.evidence, 2, EVIDENCE_PACKET_EVIDENCE_CHARS),
    importance: numberOrNull(fact.importance),
    confidence: numberOrNull(fact.confidence),
    tags: compactStringArray(fact.tags, 6, 32)
  };
}

function evidencePacketSearchText(packet) {
  return [
    packet.source_type,
    packet.category,
    packet.subject,
    packet.fact_type,
    packet.content,
    ...(packet.related_subjects || []),
    ...(packet.tags || []),
    ...(packet.evidence || [])
  ].map(normalizeRouteToken).join(" ");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function evidencePacketMatchesTarget(packet, target) {
  const normalizedTarget = normalizeRouteToken(target);
  if (!normalizedTarget) return false;
  return evidencePacketSearchText(packet).includes(normalizedTarget);
}

function factMatchesAnyEntity(fact, entityQueries) {
  const text = factSearchText(fact);
  return entityQueries.some((entity) => text.includes(normalizeRouteToken(entity)));
}

function factSearchText(fact) {
  return [
    fact?.entity,
    fact?.fact_type,
    fact?.fact,
    ...(fact?.aliases || []),
    ...(fact?.tags || []),
    ...(fact?.related_entities || []),
    ...(fact?.evidence || [])
  ].map(normalizeRouteToken).join(" ");
}

function buildL2QuerySummaryInput({ query, sourceMaterial, sourceStats }) {
  const collectionMode = Boolean(sourceStats?.l2_query_collection_mode);
  const collectionInstructions = collectionMode ? [
    "- 这是集合型提取/排名任务：当前输入可能只是全库候选的一部分，请先提取本批次候选项，不要假装已经完成全库最终排名。",
    "- 每个候选项尽量保留名称、持有者/关联主体、重要性理由、章节线索和依据事实；信息不足的字段写“信息不足”。",
    "- 如果用户要求前 N/最重要，当前批次只给出本批次候选和局部重要性判断，最终排序由合并阶段完成。"
  ] : [];
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "你是小说 L2 事实库问答与设定小模块整理助手。",
            "",
            "用户查询：",
            query,
            "",
            "任务边界：",
            "- 只依据下方 L2 facts，不读取原文，不使用索引外资料。",
            "- 每个关键结论尽量标明章节。",
            "- 如果用户要求时间线，优先按章节顺序组织。",
            "- 如果某个称谓或描述只是近义表述、事实整理表述或推断，请和“直接事实表述”区分，不要写成原文逐字。",
            "- 证据不足时明确写出缺口，不要补写不存在的信息。",
            "- 默认输出 Markdown 正文，内容要适合阅读和消费，不要输出 JSON。",
            ...collectionInstructions,
            "",
            "召回统计 JSON：",
            JSON.stringify(sourceStats || {}),
            "",
            "L2 facts JSON：",
            JSON.stringify((sourceMaterial?.facts || []).map((fact) => ({
              chapter_index: fact.chapter_index,
              category: fact.category,
              entity: fact.entity,
              aliases: fact.aliases || [],
              tags: fact.tags || [],
              related_entities: fact.related_entities || [],
              fact_type: fact.fact_type,
              fact: fact.fact,
              evidence: fact.evidence || [],
              importance: fact.importance,
              confidence: fact.confidence,
              index_group_key: fact.index_group_key
            })))
          ].join("\n")
        }
      ]
    }
  ];
}

function splitL2QueryFactsIntoBudgetedChunks({ query, targetContext = null, sourceStats = {}, facts, budget }) {
  const rawFacts = Array.isArray(facts) ? facts : [];
  const chunks = [];
  let currentRawFacts = [];
  let currentFacts = [];
  let omittedByBudget = 0;
  for (const fact of rawFacts) {
    const compactFact = compactL2QueryFactForBudget(fact, {
      factChars: 420,
      evidenceItems: 1,
      evidenceChars: 80
    });
    const candidateFacts = [...currentFacts, compactFact];
    const candidateInput = buildL2QuerySummaryInput({
      query,
      sourceMaterial: {
        query,
        targetContext,
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: candidateFacts.length
        },
        facts: candidateFacts
      },
      sourceStats
    });
    if (currentFacts.length && inputTextLength(candidateInput) > budget) {
      chunks.push({
        rawFacts: currentRawFacts,
        facts: currentFacts,
        omittedByBudget,
        trimmedByBudget: true
      });
      currentRawFacts = [];
      currentFacts = [];
    }

    const nextFact = currentFacts.length
      ? compactFact
      : fitSingleL2QueryFactWithinBudget({
        fact,
        query,
        targetContext,
        sourceStats,
        budget
      });
    if (!nextFact) {
      omittedByBudget += 1;
      continue;
    }
    currentRawFacts.push(fact);
    currentFacts.push(nextFact);
  }
  if (currentFacts.length) {
    chunks.push({
      rawFacts: currentRawFacts,
      facts: currentFacts,
      omittedByBudget,
      trimmedByBudget: true
    });
  }
  const total = chunks.length || 1;
  return chunks.map((chunk, index) => withL2QueryChunkInput({
    chunk: {
      ...chunk,
      batch: index + 1,
      total
    },
    query,
    targetContext,
    sourceStats,
    budget
  }));
}

function withL2QueryChunkInput({ chunk, query, targetContext = null, sourceStats = {}, budget }) {
  let facts = Array.isArray(chunk.facts) ? chunk.facts : [];
  let input = buildL2QuerySummaryInput({
    query,
    sourceMaterial: {
      query,
      targetContext,
      sourceStats: {
        ...sourceStats,
        evidence_packet_count: facts.length
      },
      facts
    },
    sourceStats
  });
  while (facts.length && inputTextLength(input) > budget) {
    facts = facts.slice(0, -1);
    input = buildL2QuerySummaryInput({
      query,
      sourceMaterial: {
        query,
        targetContext,
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: facts.length
        },
        facts
      },
      sourceStats
    });
  }
  const rawFacts = (chunk.rawFacts || []).slice(0, facts.length);
  return {
    ...chunk,
    facts,
    rawFacts,
    input,
    omittedByBudget: Number(chunk.omittedByBudget || 0) + Math.max(0, (chunk.facts || []).length - facts.length),
    trimmedByBudget: true,
    chapters: [...new Set(rawFacts.map((fact) => Number(fact.chapter_index || 0)).filter(Boolean))]
      .sort((left, right) => left - right)
  };
}

function fitSingleL2QueryFactWithinBudget({ fact, query, targetContext = null, sourceStats = {}, budget }) {
  const attempts = [
    { factChars: 420, evidenceItems: 1, evidenceChars: 80 },
    { factChars: 220, evidenceItems: 1, evidenceChars: 48 },
    { factChars: 120, evidenceItems: 0, evidenceChars: 0 },
    { factChars: 60, evidenceItems: 0, evidenceChars: 0 }
  ];
  for (const attempt of attempts) {
    const compactFact = compactL2QueryFactForBudget(fact, attempt);
    const input = buildL2QuerySummaryInput({
      query,
      sourceMaterial: {
        query,
        targetContext,
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: 1
        },
        facts: [compactFact]
      },
      sourceStats
    });
    if (inputTextLength(input) <= budget) return compactFact;
  }
  return null;
}

function compactL2QueryFactForBudget(fact, { factChars, evidenceItems, evidenceChars }) {
  return {
    chapter_index: fact?.chapter_index,
    category: fact?.category,
    entity: fact?.entity,
    aliases: compactStringArray(fact?.aliases, 4, 24),
    tags: compactStringArray(fact?.tags, 4, 24),
    related_entities: compactStringArray(fact?.related_entities, 4, 24),
    fact_type: fact?.fact_type,
    fact: clipText(fact?.fact || "", factChars),
    evidence: compactStringArray(fact?.evidence, evidenceItems, evidenceChars),
    importance: fact?.importance,
    confidence: fact?.confidence,
    index_group_key: fact?.index_group_key
  };
}

function buildL2QueryMergeInput({ query, sourceStats, batchResults, budget = SUMMARY_PART_INPUT_MAX_CHARS }) {
  const attempts = [3200, 1800, 1000, 560, 280, 140, 70, 40];
  let lastInput = null;
  for (const markdownChars of attempts) {
    const input = buildL2QueryMergeInputWithLimit({
      query,
      sourceStats,
      batchResults,
      markdownChars
    });
    lastInput = input;
    if (inputTextLength(input) <= budget) return input;
  }
  return lastInput;
}

function buildL2QueryMergeInputWithLimit({ query, sourceStats, batchResults, markdownChars }) {
  const collectionMode = Boolean(sourceStats?.l2_query_collection_mode);
  const collectionInstructions = collectionMode ? [
    "- 这是集合型提取/排名任务：请把各批候选按名称/别名去重，合并持有者、章节线索、重要性理由和证据缺口。",
    "- 如果用户要求“前 N”或“最重要”，请基于各批候选的重要性理由、章节跨度、事实密度和叙事关键性做最终排序。",
    "- 输出应优先是可读清单或表格；每项尽量包含名称、持有者/关联主体、重要程度、为什么重要、章节线索。"
  ] : [];
  const compactResults = (batchResults || []).map((result) => ({
    batch: result.batch,
    total: result.total,
    chapters: compactChapterSample(result.chapters || [], 10),
    fact_count: result.fact_count,
    markdown: clipText(result.markdown || "", markdownChars)
  }));
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "你是小说 L2 事实库问答与设定小模块整理助手。",
            "",
            "用户查询：",
            query,
            "",
            "任务：合并多个 L2 提问局部回答，输出最终 Markdown 正文。",
            "合并边界：",
            "- 只依据下方局部回答 Markdown，不读取原文，不使用索引外资料。",
            "- 保留章节线索；时间线类问题按章节顺序组织。",
            "- 去重同义表述；如果局部回答有冲突，优先保留章节更明确、表述更保守的结论。",
            "- 区分事实直接表述与整理推断，不要写成原文逐字。",
            "- 输出 Markdown 正文，不要输出 JSON。",
            ...collectionInstructions,
            "",
            "召回统计 JSON：",
            JSON.stringify(sourceStats || {}),
            "",
            "局部回答 Markdown JSON：",
            JSON.stringify(compactResults)
          ].join("\n")
        }
      ]
    }
  ];
}

async function runSummaryStageWithRetry(task, stageLabel, operation) {
  let lastError;
  for (let attempt = 1; attempt <= SUMMARY_STAGE_MAX_ATTEMPTS; attempt += 1) {
    await waitIfPaused(task);
    try {
      const result = await operation();
      assertNotCancelled(task);
      return result;
    } catch (error) {
      lastError = error;
      if (!shouldRetrySummaryStage(error) || attempt >= SUMMARY_STAGE_MAX_ATTEMPTS) {
        throw error;
      }
      updateTask(task, {
        progress: { ...task.progress, current: stageLabel },
        message: `${stageLabel} 失败，准备重试 ${attempt + 1}/${SUMMARY_STAGE_MAX_ATTEMPTS}：${sanitizeText(error.message)}`
      }, "warning");
      await delay(SUMMARY_STAGE_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function shouldRetrySummaryStage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.status === 429 || error?.status >= 500) return true;
  return [
    "aborted",
    "timeout",
    "timed out",
    "fetch failed",
    "network",
    "网络连接失败",
    "unexpected end of json input",
    "不是合法 json"
  ].some((pattern) => message.includes(pattern));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractLastJsonObjectTemplate(value) {
  const text = String(value || "");
  const range = lastJsonObjectTemplateRange(text);
  if (!range) return null;
  try {
    return JSON.parse(text.slice(range.start, range.end + 1));
  } catch {
    return null;
  }
}

function lastJsonObjectTemplateRange(value) {
  const text = String(value || "");
  for (let end = text.length - 1; end >= 0; end -= 1) {
    if (text[end] !== "}") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let start = end; start >= 0; start -= 1) {
      const char = text[start];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "}") depth += 1;
      if (char === "{") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { start, end };
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function inputTextLength(input) {
  return input.reduce((sum, item) => (
    sum + (item.content || []).reduce((inner, content) => inner + String(content.text || "").length, 0)
  ), 0);
}

function compactStringArray(value, maxItems, maxChars) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => clipText(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function clipText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function parseJsonOrText(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assertFinalSummaryUseful(finalResult, sourceChapterCount, options = {}) {
  if (sourceChapterCount < 3) return;

  if (typeof finalResult === "string") {
    const text = finalResult.trim();
    if (text && !isPlaceholderText(text)) return;
    throw finalSummaryQualityError();
  }

  if (!finalResult || typeof finalResult !== "object") {
    throw finalSummaryQualityError();
  }

  const summary = String(finalResult.summary || "").trim();
  const title = String(finalResult.title || "").trim();
  const items = Array.isArray(finalResult.items) ? finalResult.items : [];
  const hasUsefulSummary = Boolean(summary) && !isPlaceholderText(summary);
  const hasUsefulTitle = Boolean(title) && !isPlaceholderText(title);
  if (items.length || hasUsefulSummary || hasUsefulTitle || hasAnyUsefulCustomValue(finalResult, options)) return;
  throw finalSummaryQualityError();
}

function hasAnyUsefulCustomValue(value, options = {}) {
  let hasContentField = false;
  let hasUsefulContentField = false;
  const properties = options.schema?.properties && typeof options.schema.properties === "object"
    ? options.schema.properties
    : {};
  for (const [key, entry] of Object.entries(value)) {
    if (["title", "summary", "items", "failed_chapters"].includes(key)) continue;
    const schema = properties[key];
    const isContentField = isFinalContentField(key, schema, entry);
    if (isContentField) {
      hasContentField = true;
      if (isUsefulFinalValue(entry)) hasUsefulContentField = true;
      continue;
    }
    if (isUsefulFinalValue(entry)) return true;
  }
  return hasContentField ? hasUsefulContentField : false;
}

function isFinalContentField(fieldName, fieldSchema, value) {
  if (isMetadataOnlyFieldName(fieldName)) return false;
  if (isAnalysisParameterField(fieldName, fieldSchema)) return false;
  if (isOptionalSummaryFieldName(fieldName)) {
    return false;
  }
  return isPotentialPrimaryContentField(fieldName, fieldSchema, value);
}



function isPotentialPrimaryContentField(fieldName, fieldSchema, value) {
  return isPrimaryContentFieldName(fieldName) && (isLargeFieldSchema(fieldSchema) || Array.isArray(value) || (value && typeof value === "object"));
}

function isPrimaryContentFieldName(fieldName) {
  return /timeline|records|entries|items|results|facts|events|characters|subjects|entities|stages|chapters|assets|list|array|时间线|记录|结果|事实|事件|人物|角色|主体|实体|阶段|章节|资产|列表/i.test(String(fieldName || ""));
}

function isOptionalSummaryFieldName(fieldName) {
  return /uncertain|uncertainties|conflict|risk|warning|error|failed|missing|important|minor|secondary|optional|note|notes|不确定|冲突|风险|失败|缺失|重要|次要|可选|备注/i.test(String(fieldName || ""));
}

function isUsefulFinalValue(value) {
  if (typeof value === "string") return Boolean(value.trim()) && !isPlaceholderText(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => isUsefulFinalValue(item));
  if (value && typeof value === "object") return Object.values(value).some((entry) => isUsefulFinalValue(entry));
  return false;
}

function isPlaceholderText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["", "n/a", "na", "null", "none", "无", "暂无", "空"].includes(normalized);
}

function finalSummaryQualityError() {
  const error = new Error("最终汇总结果疑似占位或为空，已拒绝保存。请续跑最终汇总。");
  error.status = 502;
  return error;
}

export function publicAnalysisRun(run) {
  if (!run) return null;
  const selection = parseChapterSelection(run);
  return {
    id: run.id,
    name: run.name || `${run.book_id} ${run.start_chapter}-${run.end_chapter}`,
    book_id: run.book_id,
    start_chapter: run.start_chapter,
    end_chapter: run.end_chapter,
    chapter_indexes: selection.chapter_indexes,
    selection_mode: selection.mode,
    model: run.model,
    reasoning_effort: run.reasoning_effort,
    prompt_hash: run.prompt_hash,
    schema_hash: run.schema_hash,
    status: run.status,
    chapter_count: run.chapter_count,
    error_summary: run.error_summary,
    source_stats: parseJsonObject(run.source_stats),
    created_at: run.created_at,
    updated_at: run.updated_at
  };
}

function rangeIndexes(start, end) {
  const indexes = [];
  for (let index = start; index <= end; index += 1) indexes.push(index);
  return indexes;
}

function isFatalUpstreamError(message) {
  return /成本保护|rate limit|quota|insufficient_quota|billing|429/i.test(String(message || ""));
}

function normalizeChapterIndexes(value) {
  if (!Array.isArray(value)) return [];
  const indexes = value.map((entry) => normalizeChapterIndex(entry));
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function inferEntityQueriesFromPrompt(prompt, bookId = "") {
  const text = String(prompt || "");
  const stopwords = new Set([
    "json",
    "schema",
    "markdown",
    "剑来",
    "第一瞳术师",
    "废材那又怎样",
    String(bookId || "")
  ].filter(Boolean));
  const candidates = [
    ...[...text.matchAll(/[《“「『]([^》”」』]{1,24})[》”」』]/g)].map((match) => match[1]),
    ...[...text.matchAll(/(?:主体|对象|关键词|关键主体|分析对象|围绕|关于|聚焦|只看|查询)[:：为是\s]*([^\n，。；;、]{2,40})/g)].flatMap((match) => splitEntityCandidates(match[1])),
    ...[...text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:本命飞剑|飞剑|本命物|佩剑|剑|法宝|境界|关系|外貌|形象|身份)/g)].map((match) => match[0]),
    ...[...text.matchAll(/(?:陈平安|齐静春|宁姚|阮邛|阿良|崔瀺|陆沉|老秀才|左右|裴钱|魏檗|宋集薪|顾璨|刘羡阳|云筝|容烁|飞剑|本命飞剑|本命物)/g)].map((match) => match[0])
  ];
  const normalized = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const value = normalizeEntityCandidate(candidate);
    if (!value || stopwords.has(value) || /json|schema|markdown/i.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.slice(0, 6);
}

function splitEntityCandidates(value) {
  return String(value || "")
    .split(/[、,，/和与及\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEntityCandidate(value) {
  return String(value || "")
    .replace(/[。；;：:，,、]/g, " ")
    .trim()
    .replace(/^(请|要|需要|分析|总结|整理|输出|围绕|关于|聚焦|只看|中|里|其中|有关|关于)+/, "")
    .replace(/(相关|有关|的信息|的内容|资料|设定|分析|总结|输出)+$/, "")
    .trim()
    .slice(0, 24);
}

function resolveSelectedChapters({ bookId, startChapter, endChapter, chapterIndexes }) {
  const metadata = listChapterMetadata(bookId);
  const byIndex = new Map(metadata.map((chapter) => [chapter.chapter_index, chapter]));
  const selectedIndexes = chapterIndexes.length
    ? chapterIndexes
    : metadata
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter)
      .map((chapter) => chapter.chapter_index);

  const outsideRange = selectedIndexes.filter((index) => index < startChapter || index > endChapter);
  if (outsideRange.length) {
    const error = new Error(`选择章节超出范围：${outsideRange.join(", ")}`);
    error.status = 422;
    throw error;
  }

  const missing = selectedIndexes.filter((index) => !byIndex.has(index));
  if (missing.length) {
    const error = new Error(`本地章节库缺少已选择章节：${missing.join(", ")}`);
    error.status = 422;
    throw error;
  }

  return selectedIndexes.map((index) => byIndex.get(index));
}

function parseChapterSelection(run) {
  try {
    const parsed = run.chapter_selection ? JSON.parse(run.chapter_selection) : null;
    if (parsed?.chapter_indexes?.length) {
      return {
        mode: parsed.mode || "indexes",
        chapter_indexes: parsed.chapter_indexes
      };
    }
  } catch {
    // Old runs have no selection snapshot.
  }
  return {
    mode: "range",
    chapter_indexes: rangeIndexes(run.start_chapter, run.end_chapter)
  };
}

function summaryProgressFromParts(parts = []) {
  return {
    total: parts.length,
    completed: parts.filter((part) => part.status === "completed").length,
    failed: parts.filter((part) => part.status === "failed").length,
    running: parts.filter((part) => part.status === "running").length
  };
}

function sourceTraceFromSummaryParts(parts = []) {
  return parts
    .map((part) => {
      const trace = part.trace_summary || {};
      if (!trace || typeof trace !== "object") return null;
      if (!Number(trace.evidence_packet_count || 0) && !trace.target_subject && !trace.field_material_mode) return null;
      return {
        part_key: part.part_key,
        parent_key: part.parent_key || "",
        stage: part.stage,
        status: part.status,
        field_name: trace.field_name || inferFieldNameFromPartKey(part.part_key),
        batch: Number(trace.batch || 1),
        total_batches: Number(trace.total_batches || 1),
        evidence_packet_count: Number(trace.evidence_packet_count || 0),
        source_types: trace.source_types || {},
        chapters: trace.chapters || { count: 0, sample: [] },
        categories: trace.categories || {},
        fact_types: trace.fact_types || {},
        subjects: Array.isArray(trace.subjects) ? trace.subjects : [],
        related_subjects: Array.isArray(trace.related_subjects) ? trace.related_subjects : [],
        target_subject: String(trace.target_subject || ""),
        target_evidence_count: Number(trace.target_evidence_count || 0),
        field_material_mode: String(trace.field_material_mode || ""),
        prompt_overhead_chars: Number(trace.prompt_overhead_chars || 0),
        material_chars: Number(trace.material_chars || 0),
        trimmed_by_budget: Boolean(trace.trimmed_by_budget),
        omitted_by_budget: Number(trace.omitted_by_budget || 0),
        field_merge_mode: String(trace.field_merge_mode || ""),
        field_merge_batch_count: Number(trace.field_merge_batch_count || 0),
        field_merge_model_used: Boolean(trace.field_merge_model_used),
        field_merge_fallback_reason: String(trace.field_merge_fallback_reason || ""),
        merged_value_chars: Number(trace.merged_value_chars || 0),
        fallback_used: Boolean(trace.fallback_used),
        fallback_reason: String(trace.fallback_reason || "")
      };
    })
    .filter(Boolean);
}

function sourceTraceSummary(traces = []) {
  const sourceTypes = new Map();
  const categories = new Map();
  const chapters = new Set();
  const subjects = [];
  let targetSubject = "";
  let targetEvidenceCount = 0;
  const preferred = traces.some((trace) => trace.stage === "json_field_batch")
    ? traces.filter((trace) => trace.stage === "json_field_batch")
    : traces.filter((trace) => trace.part_key !== "json.final.merge" || traces.length === 1);
  for (const trace of preferred) {
    mergeCountMap(sourceTypes, trace.source_types);
    mergeCountMap(categories, trace.categories);
    subjects.push(...(trace.subjects || []));
    if (!targetSubject && trace.target_subject) targetSubject = trace.target_subject;
    targetEvidenceCount += Number(trace.target_evidence_count || 0);
    for (const chapterIndex of trace.chapters?.sample || []) {
      const number = Number(chapterIndex || 0);
      if (Number.isFinite(number) && number > 0) chapters.add(number);
    }
    if (trace.chapters?.min) chapters.add(Number(trace.chapters.min));
    if (trace.chapters?.max) chapters.add(Number(trace.chapters.max));
  }
  const chapterList = [...chapters].sort((left, right) => left - right);
  return {
    parts: traces.length,
    evidence_packet_count: preferred.reduce((sum, trace) => sum + Number(trace.evidence_packet_count || 0), 0),
    source_types: Object.fromEntries(sourceTypes),
    categories: Object.fromEntries(categories),
    chapters: {
      count: chapterList.length,
      min: chapterList[0] || null,
      max: chapterList[chapterList.length - 1] || null,
      sample: compactChapterSample(chapterList)
    },
    subjects: uniqueCompact(subjects, 12),
    target_subject: targetSubject,
    target_evidence_count: targetEvidenceCount,
    trimmed_by_budget: preferred.some((trace) => trace.trimmed_by_budget),
    omitted_by_budget: preferred.reduce((sum, trace) => sum + Number(trace.omitted_by_budget || 0), 0)
  };
}

function inferFieldNameFromPartKey(partKey) {
  const match = String(partKey || "").match(/^json\.([^.]+)\./);
  return match?.[1] || "final";
}
