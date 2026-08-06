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

export function navigate(path, { replace = false } = {}) {
  const url = `#${path}`;
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
  emitLocationChange();
  window.scrollTo(0, 0);
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function routeFromHash(hash) {
  const path = String(hash || "").replace(/^#/, "") || "/";
  const segments = path.split("/").filter(Boolean).map(safeDecode);
  if (!segments.length) return { route: "workbench", bookId: "" };
  if (segments[0] === "diagnostics" && segments.length === 1) {
    return { route: "diagnostics", bookId: "" };
  }
  if (segments[0] === "book" && segments[1]) {
    const bookId = segments[1];
    if (segments.length === 2) return { route: "book", bookId };
    if (segments.length === 3 && MANAGE_SUBROUTES.has(segments[2])) {
      return { route: segments[2], bookId };
    }
    return { route: null, bookId };
  }
  // 旧路由（#/library、#/analysis、#/prompts）与未知路径返回 null，由 App 重定向到 #/
  return { route: null, bookId: "" };
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
 * 响应式的路由状态：{ route, bookId }。route 为 workbench/book/l1/l2/ask/diagnostics，
 * 未知路径与旧路由返回 null（由 App 重定向到 #/）。bookId 随 URL 变化实时更新。
 */
export function useRoute() {
  const { route, bookId } = useSyncExternalStore(subscribe, getSnapshot);
  return { route, bookId };
}
