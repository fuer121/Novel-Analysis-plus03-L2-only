export const LIVE_TASK_STATUSES = ["queued", "running", "paused"];

export const TERMINAL_TASK_STATUSES = ["completed", "failed", "cancelled"];

export function isLiveTask(task) {
  return Boolean(task && LIVE_TASK_STATUSES.includes(task.status));
}

export function taskStatusLabel(status) {
  return {
    idle: "空闲",
    queued: "排队",
    running: "运行",
    paused: "暂停",
    completed: "完成",
    completed_with_errors: "完成有错",
    failed: "失败",
    cancelled: "取消",
    missing: "缺失",
    outdated: "过期"
  }[status] || status;
}
