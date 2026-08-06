import { useSyncExternalStore } from "react";

/**
 * Hash 路由：#/ 工作台、#/book/:id 书籍首页、#/book/:id/l1|l2|ask 三个管理页、#/diagnostics 诊断。
 * 当前书由路由 :id 承载，各页面不再有本地选书控件。
 * navigate 接收不带 # 的路径（如 "/book/123/l1"），统一 pushState/replaceState + 通知订阅者，
 * 页面不再直接操作 location 或派发事件。
 */
export const paths = {
  workbench: () => "/",
  book: (bookId) => `/book/${encodeURIComponent(bookId)}`,
  l1: (bookId) => `/book/${encodeURIComponent(bookId)}/l1`,
  l2: (bookId) => `/book/${encodeURIComponent(bookId)}/l2`,
  l2New: (bookId) => `/book/${encodeURIComponent(bookId)}/l2/new`,
  ask: (bookId) => `/book/${encodeURIComponent(bookId)}/ask`,
  diagnostics: () => "/diagnostics"
};

const MANAGE_SUBROUTES = new Set(["l1", "l2", "ask"]);

const listeners = new Set();

function emitLocationChange() {
  listeners.forEach((listener) => listener());
}

window.addEventListener("popstate", emitLocationChange);
window.addEventListener("hashchange", emitLocationChange);

export function navigate(path, { replace = false, scroll = true } = {}) {
  const url = `#${path}`;
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
  emitLocationChange();
  if (scroll) window.scrollTo(0, 0);
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseQuery(queryString) {
  const query = {};
  if (!queryString) return query;
  for (const [key, value] of new URLSearchParams(queryString)) {
    if (!Object.hasOwn(query, key)) query[key] = value;
  }
  return query;
}

function routeFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "") || "/";
  const queryIndex = raw.indexOf("?");
  const path = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const query = parseQuery(queryIndex >= 0 ? raw.slice(queryIndex + 1) : "");
  const segments = path.split("/").filter(Boolean).map(safeDecode);
  if (!segments.length) return { route: "workbench", bookId: "", query };
  if (segments[0] === "diagnostics" && segments.length === 1) {
    return { route: "diagnostics", bookId: "", query };
  }
  if (segments[0] === "book" && segments[1]) {
    const bookId = segments[1];
    if (segments.length === 2) return { route: "book", bookId, query };
    if (segments.length === 3 && MANAGE_SUBROUTES.has(segments[2])) {
      return { route: segments[2], bookId, query };
    }
    // 新建索引组向导：#/book/:id/l2/new
    if (segments.length === 4 && segments[2] === "l2" && segments[3] === "new") {
      return { route: "l2-new", bookId, query };
    }
    return { route: null, bookId, query };
  }
  // 旧路由（#/library、#/analysis、#/prompts）与未知路径返回 null，由 App 重定向到 #/
  return { route: null, bookId: "", query };
}

let snapshot = null;

function getSnapshot() {
  const key = `${window.location.pathname}${window.location.hash}`;
  if (!snapshot || snapshot.key !== key) {
    snapshot = {
      key,
      ...routeFromHash(window.location.hash)
    };
  }
  return snapshot;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 响应式的路由状态：{ route, bookId, query }。route 为 workbench/book/l1/l2/ask/diagnostics，
 * 未知路径与旧路由返回 null（由 App 重定向到 #/）。bookId 与 query（hash 内 ? 后的参数 map）
 * 随 URL 变化实时更新。
 */
export function useRoute() {
  const { route, bookId, query = {} } = useSyncExternalStore(subscribe, getSnapshot);
  return { route, bookId, query };
}
