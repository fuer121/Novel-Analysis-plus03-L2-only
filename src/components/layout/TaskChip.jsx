import { StatusPill } from "../../ui.jsx";
import { taskProgressPercent } from "../../utils/taskProgress.js";
import { ProgressBar } from "../ProgressBar.jsx";

/**
 * 顶栏任务 chip：状态 pill + 任务类型与书名 + 进度文本 + 进度条。
 * 点击由调用方传入 onClick（跳转对应管理页）。
 */
export function TaskChip({ task, typeLabel, badge, bookName, statusText, onClick }) {
  const percent = taskProgressPercent(task);
  const text = [bookName, statusText, percent ? `${percent}%` : ""].filter(Boolean).join(" · ");
  return (
    <button className="task-chip" type="button" title={statusText || typeLabel} onClick={onClick}>
      <span className="task-chip-row">
        <StatusPill status={task.status} />
        <b>{typeLabel}</b>
        {badge ? <span className="badge">{badge}</span> : null}
      </span>
      <span className="task-chip-text">{text}</span>
      <ProgressBar percent={percent} tone="info" label={typeLabel} />
    </button>
  );
}
