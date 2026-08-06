import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, followTask } from "../api.js";
import { isLiveTask } from "../constants/taskStatus.js";

let pendingTasksRequest = null;

function requestTasks() {
  if (!pendingTasksRequest) {
    pendingTasksRequest = apiGet("/api/tasks").finally(() => {
      pendingTasksRequest = null;
    });
  }
  return pendingTasksRequest;
}

/**
 * 管理单类后台任务（import / l1-index / l2-index / analysis）的完整生命周期：
 * 启动、SSE 进度绑定、pause/resume/cancel、断线处理、挂载后恢复服务端 live 任务。
 *
 * 配置项：
 * - type：服务端任务类型名，用于 /api/tasks 恢复匹配
 * - baseUrl(taskId)：任务基础 URL，SSE 用 `${base}/events`，控制用 `${base}/${action}`
 * - startRequest(payload)：POST 启动请求，resolve 出 task 对象
 * - failureMessage：任务 failed 且无 error 文本时的兜底提示
 * - onTerminal(task, options)：任务到达终态后的回调（经 ref 转发，始终调用最新闭包）
 * - onCancelled()：cancel 成功后的额外回调（如 reloadBooks）
 * - setError：全局错误提示
 * - ready：为 true 后才允许执行一次性恢复（等初始加载完成）
 */
export function useTaskChannel({
  type,
  baseUrl,
  startRequest,
  failureMessage = "任务失败",
  onTerminal,
  onCancelled,
  setError,
  ready = true
}) {
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const taskRef = useRef(null);
  const busyRef = useRef(false);
  const sourceRef = useRef(null);
  const restoredRef = useRef(false);
  const latestRef = useRef({ onTerminal, onCancelled, setError });

  useEffect(() => {
    latestRef.current = { onTerminal, onCancelled, setError };
  });

  const updateTask = useCallback((nextTask) => {
    taskRef.current = nextTask;
    setTask(nextTask);
  }, []);

  const updateBusy = useCallback((nextBusy) => {
    busyRef.current = nextBusy;
    setBusy(nextBusy);
  }, []);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const bind = useCallback((taskToBind, options = {}) => {
    if (!taskToBind?.id) return;
    updateTask(taskToBind);
    updateBusy(isLiveTask(taskToBind));
    closeSource();
    if (!isLiveTask(taskToBind)) return;
    sourceRef.current = followTask(
      `${baseUrl(taskToBind.id)}/events`,
      updateTask,
      async (finishedTask) => {
        sourceRef.current = null;
        updateBusy(false);
        if (finishedTask.status === "failed") {
          latestRef.current.setError(finishedTask.error || failureMessage);
        }
        await latestRef.current.onTerminal?.(finishedTask, options);
      },
      () => {
        sourceRef.current = null;
        updateBusy(false);
        latestRef.current.setError("任务连接中断，请刷新或重新进入页面恢复");
      }
    );
  }, [baseUrl, failureMessage, updateTask, updateBusy, closeSource]);

  const launch = useCallback(async (requestTask, options = {}) => {
    updateBusy(true);
    latestRef.current.setError("");
    updateTask(null);
    closeSource();
    try {
      const startedTask = await requestTask();
      bind(startedTask, options);
      return startedTask;
    } catch (launchError) {
      updateBusy(false);
      latestRef.current.setError(launchError.message);
      return null;
    }
  }, [bind, updateTask, updateBusy, closeSource]);

  const start = useCallback((payload, options = {}) => {
    if (busyRef.current) return Promise.resolve(taskRef.current);
    return launch(() => startRequest(payload), options);
  }, [launch, startRequest]);

  const control = useCallback(async (action) => {
    const currentTask = taskRef.current;
    if (!currentTask?.id) return;
    latestRef.current.setError("");
    try {
      const data = await apiPost(`${baseUrl(currentTask.id)}/${action}`, {});
      updateTask(data.task);
      updateBusy(isLiveTask(data.task));
      if (action === "cancel") {
        closeSource();
        updateBusy(false);
        await latestRef.current.onCancelled?.();
      }
    } catch (controlError) {
      latestRef.current.setError(controlError.message);
    }
  }, [baseUrl, updateTask, updateBusy, closeSource]);

  // 初始加载完成后恢复一次服务端仍在运行的任务；不随 task 对象变化重复请求 /api/tasks
  useEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;
    async function restore() {
      try {
        const data = await requestTasks();
        if (cancelled) return;
        const liveTask = (data.tasks || []).filter(isLiveTask).find((entry) => entry.type === type);
        if (liveTask && !sourceRef.current && !taskRef.current) bind(liveTask);
      } catch {
        // Older running servers do not have /api/tasks yet. Keep the UI usable.
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [ready, type, bind]);

  useEffect(() => closeSource, [closeSource]);

  return { task, busy, start, launch, control, bind };
}
