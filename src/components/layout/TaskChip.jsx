import { taskProgressPercent } from "../../utils/taskProgress.js";

/**
 * 顶栏任务 chip（墨靛深色）：脉冲点 + 类型·书名 + 细进度条 + 百分比。
 * 点击由调用方传入 onClick（跳转对应管理页）。
 */
export function TaskChip({ task, typeLabel, bookName, statusText, onClick }) {
  const percent = taskProgressPercent(task);
  return (
    <button
      className="task-chip"
      type="button"
      title={[typeLabel, bookName, statusText].filter(Boolean).join(" · ")}
      onClick={onClick}
    >
      <span className="task-chip-dot" />
      <span className="task-chip-text">
        {typeLabel}·《{bookName || "未命名"}》
      </span>
      <span className="task-chip-bar">
        <span style={{ width: `${percent || 0}%` }} />
      </span>
      <span className="task-chip-pct">{percent ? `${percent}%` : "--"}</span>
    </button>
  );
}
