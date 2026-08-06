import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../api.js";
import { isLiveTask, TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";

/**
 * 工作台/书籍首页的按书聚合数据，避免 N+1 请求：
 * - 一次 /api/diagnostics 拿全量书籍的 L1/L2 状态计数、索引组数、事实数、分析数；
 * - 一次 /api/tasks 拿 live 任务，再与 App 四个任务通道的对象按 id 合并
 *   （通道任务带 SSE 实时进度，覆盖同名服务端快照）。
 * 任一通道任务到达终态时整体重拉一次。
 */
export function useWorkbenchData({ channelTasks = [], setError }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [serverTasks, setServerTasks] = useState([]);
  const seqRef = useRef(0);

  const terminalKey = channelTasks
    .filter((task) => task && TERMINAL_TASK_STATUSES.includes(task.status))
    .map((task) => `${task.id}:${task.status}`)
    .join("|");

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const [diagData, tasksData] = await Promise.all([
        apiGet("/api/diagnostics"),
        apiGet("/api/tasks").catch(() => ({ tasks: [] }))
      ]);
      if (seq !== seqRef.current) return;
      setDiagnostics(diagData);
      setServerTasks(tasksData.tasks || []);
    } catch (error) {
      if (seq === seqRef.current) setError(error.message);
    }
  }, [setError]);

  useEffect(() => {
    // 微任务中启动：load 内的 setState 不能落在 effect 同步阶段
    void Promise.resolve().then(() => load());
  }, [load, terminalKey]);

  const aggregatesByBook = useMemo(() => {
    const map = new Map();
    (diagnostics?.database?.books || []).forEach((row) => map.set(row.book_id, row));
    return map;
  }, [diagnostics]);

  const liveTasks = useMemo(() => {
    const byId = new Map();
    (serverTasks || []).filter(isLiveTask).forEach((task) => byId.set(task.id, task));
    channelTasks.filter(isLiveTask).forEach((task) => byId.set(task.id, task));
    return [...byId.values()];
  }, [serverTasks, channelTasks]);

  return { aggregatesByBook, liveTasks, refresh: load, ready: Boolean(diagnostics) };
}

/** 取某本书的 live 任务列表。 */
export function liveTasksForBook(liveTasks, bookId) {
  return (liveTasks || []).filter((task) => task?.payload?.bookId === bookId);
}
