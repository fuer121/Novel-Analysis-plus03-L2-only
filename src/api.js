import { TERMINAL_TASK_STATUSES } from "./constants/taskStatus.js";

export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function bookChaptersUrl(bookId) {
  return `/api/books/${encodeURIComponent(bookId)}/chapters`;
}

export function l1CoverageUrl(bookId, params) {
  return `/api/books/${encodeURIComponent(bookId)}/l1-indexes/coverage${buildQuery(params)}`;
}

export function l1ChaptersUrl(bookId, params) {
  return `/api/books/${encodeURIComponent(bookId)}/l1-indexes/chapters${buildQuery(params)}`;
}

export function l2CoverageUrl(bookId, params) {
  return `/api/books/${encodeURIComponent(bookId)}/l2-indexes/coverage${buildQuery(params)}`;
}

export function l2FactsUrl(bookId, params) {
  return `/api/books/${encodeURIComponent(bookId)}/l2-facts${buildQuery(params)}`;
}

export function characterLibraryUrl(bookId) {
  return `/api/books/${encodeURIComponent(bookId)}/character-library`;
}

export function charactersUrl(bookId, params = {}) {
  return `/api/books/${encodeURIComponent(bookId)}/characters${buildQuery(params)}`;
}

export function characterUrl(bookId, characterId) {
  return `/api/books/${encodeURIComponent(bookId)}/characters/${encodeURIComponent(characterId)}`;
}

export function characterLibraryBuildsUrl(bookId) {
  return `/api/books/${encodeURIComponent(bookId)}/character-library/builds`;
}

export function characterLibraryBuildUrl(buildId) {
  return `/api/character-library-builds/${encodeURIComponent(buildId)}`;
}

export function characterLibraryBuildEventsUrl(buildId) {
  return `${characterLibraryBuildUrl(buildId)}/events`;
}

export async function apiGet(path) {
  const response = await fetch(path);
  return handleResponse(response);
}

export async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(response);
}

export async function apiPut(path, body) {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return handleResponse(response);
}

export async function apiDelete(path) {
  const response = await fetch(path, { method: "DELETE" });
  return handleResponse(response);
}

export function followTask(url, setTask, onTerminal, onError) {
  const source = new EventSource(url);
  const handle = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!data.task) return;
    setTask(data.task);
    if (TERMINAL_TASK_STATUSES.includes(data.task.status)) {
      source.close();
      void onTerminal?.(data.task);
    }
  };

  source.addEventListener("snapshot", handle);
  source.addEventListener("progress", handle);
  source.addEventListener("warning", handle);
  source.addEventListener("running", handle);
  source.addEventListener("paused", handle);
  source.addEventListener("completed", handle);
  source.addEventListener("failed", handle);
  source.addEventListener("cancelled", handle);
  source.onerror = () => {
    source.close();
    void onError?.();
  };
  return source;
}

export function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function downloadJson(filename, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  downloadFile(filename, text, "application/json;charset=utf-8");
}

export function downloadFile(filename, content, type = "application/octet-stream") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleResponse(response) {
  const data = await response.json().catch(() => null);
  if (!data) {
    throw new Error(`请求没有返回 JSON：HTTP ${response.status}`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  }
  return data;
}
