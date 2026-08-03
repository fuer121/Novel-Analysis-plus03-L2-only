import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, "..");

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 5174),
  dataDir: path.resolve(rootDir, process.env.DATA_DIR || "data"),
  staticDir: path.resolve(rootDir, process.env.STATIC_DIR || "dist"),
  dify: {
    base: normalizeBase(process.env.DIFY_API_BASE || ""),
    apiKey: process.env.DIFY_CHAPTER_WORKFLOW_API_KEY || "",
    l1ApiKey: process.env.DIFY_L1_WORKFLOW_API_KEY || "",
    l2ApiKey: process.env.DIFY_L2_WORKFLOW_API_KEY || "",
    analysisSummaryWorkflowApiKey: process.env.DIFY_ANALYSIS_SUMMARY_WORKFLOW_API_KEY || "",
    l1WorkflowVersion: String(process.env.DIFY_L1_WORKFLOW_VERSION || "v1").trim() || "v1",
    l2WorkflowVersion: String(process.env.DIFY_L2_WORKFLOW_VERSION || "v1").trim() || "v1",
    analysisSummaryWorkflowVersion: String(process.env.DIFY_ANALYSIS_SUMMARY_WORKFLOW_VERSION || "v1").trim() || "v1",
    user: process.env.DIFY_USER || "local-secure-importer",
    batchSize: clampInteger(process.env.IMPORT_BATCH_SIZE, 1, 50, 10)
  }
};

fs.mkdirSync(config.dataDir, { recursive: true });

export function publicRuntimeConfig() {
  return {
    host: config.host,
    difyConfigured: isDifyTargetConfigured("import"),
    difyL1Configured: isDifyTargetConfigured("l1"),
    difyL2Configured: isDifyTargetConfigured("l2"),
    difyAnalysisSummaryConfigured: isDifyTargetConfigured("analysis_summary"),
    difyBase: maskUrl(config.dify.base),
    dataDir: config.dataDir,
    staticDir: config.staticDir,
    importBatchSize: config.dify.batchSize
  };
}

export function requireDifyConfig(target = "import") {
  const apiKey = difyApiKeyForTarget(target);
  if (!config.dify.base || !apiKey) {
    const error = new Error(`缺少 DIFY_API_BASE 或 ${difyApiKeyEnvName(target)}。`);
    error.status = 500;
    throw error;
  }
}

export function isDifyTargetConfigured(target = "import") {
  return Boolean(config.dify.base && difyApiKeyForTarget(target));
}

export function difyApiKeyForTarget(target = "import") {
  const key = String(target || "import").trim().toLowerCase();
  if (key === "l1") return config.dify.l1ApiKey;
  if (key === "l2") return config.dify.l2ApiKey;
  if (key === "analysis_summary") return config.dify.analysisSummaryWorkflowApiKey;
  return config.dify.apiKey;
}

export function difyApiKeyEnvName(target = "import") {
  const key = String(target || "import").trim().toLowerCase();
  if (key === "l1") return "DIFY_L1_WORKFLOW_API_KEY";
  if (key === "l2") return "DIFY_L2_WORKFLOW_API_KEY";
  if (key === "analysis_summary") return "DIFY_ANALYSIS_SUMMARY_WORKFLOW_API_KEY";
  return "DIFY_CHAPTER_WORKFLOW_API_KEY";
}

function normalizeBase(value) {
  return String(value || "").replace(/\/+$/, "");
}

function maskUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return String(value).replace(/(app-|sk-)[A-Za-z0-9_-]+/g, "$1***");
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
