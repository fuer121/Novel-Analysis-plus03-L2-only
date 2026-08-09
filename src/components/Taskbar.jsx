import { useState } from "react";
import { Loader2, Pause, Play, X } from "lucide-react";
import { isLiveTask } from "../constants/taskStatus.js";
import { StatusPill } from "../ui.jsx";
import { sanitizeChapterInput } from "../utils/chapterRange.js";
import { taskProgressPercent } from "../utils/taskProgress.js";

/**
 * 任务控制条（L1/L2 构建控制归一）：
 * - 有 live 任务：状态 pill + 进度文案 + 进度条 + 暂停/继续 + 取消
 *   （空章补跑任务按空章进度展示：空章补跑 x% + 空章总数/已补跑数）
 * - 空闲：覆盖状态 pill + 统计副行 + 重试失败（仅提供 onRetryFailed 且失败数 > 0）
 *   + 补跑空章（仅提供 onRetryEmpty 且空章数 > 0）
 *   + 范围快选（全部 / 最近100回 / 自定义）+ 启动按钮
 */
export function Taskbar({
  title,
  sub,
  percent = 0,
  coverageReady = true,
  failedCount = 0,
  onRetryFailed = null,
  emptyCount = 0,
  onRetryEmpty = null,
  firstChapter = 1,
  lastChapter = 1,
  form,
  onFormChange,
  busy,
  blockedHint = "",
  providerReady = true,
  startLabel,
  onStart,
  task,
  onCancel,
  onPause,
  onResume
}) {
  const [customOpen, setCustomOpen] = useState(false);

  if (isLiveTask(task)) {
    const paused = task.status === "paused";
    // 空章补跑：进度按「已处理空章/空章总数」展示，而不是全量章节扫描进度
    const emptyTotal = task.payload?.mode === "retry_empty" ? Number(task.progress?.empty_total || 0) : 0;
    const emptyDone = Number(task.progress?.completed || 0);
    const emptyFailed = Number(task.progress?.failed || 0);
    const taskPercent = emptyTotal
      ? Math.min(100, Math.round(((emptyDone + emptyFailed) / emptyTotal) * 100))
      : taskProgressPercent(task);
    // 取消是破坏性操作：二次确认（与删除索引组的 window.confirm 口径一致）
    function confirmCancel() {
      if (!onCancel) return;
      if (window.confirm("确认取消当前构建任务？已完成的章节会保留，之后可断点续跑。")) onCancel();
    }
    return (
      <div className="taskbar live">
        <div className="t-info">
          <div className="t-line">
            <StatusPill status={task.status} />
            {emptyTotal ? <b>{title}（空章补跑 {taskPercent}%）</b> : <b>{title} {taskPercent}%</b>}
          </div>
          <span className="t-sub">{task.progress?.current || "准备中"}</span>
          {emptyTotal ? (
            <span className="t-sub">
              空章共 {emptyTotal} 个 · 已补跑 {emptyDone} 个{emptyFailed ? ` · 失败 ${emptyFailed} 个` : ""}
            </span>
          ) : null}
          <span className="bar"><i style={{ width: `${taskPercent}%` }} /></span>
        </div>
        <div className="ops">
          {paused ? (
            <button className="action-chip" type="button" onClick={onResume} disabled={!onResume}>
              <Play size={13} />
              继续
            </button>
          ) : (
            <button className="action-chip" type="button" onClick={onPause} disabled={!onPause}>
              <Pause size={13} />
              暂停
            </button>
          )}
          <button className="action-chip danger-icon" type="button" title="取消任务" onClick={confirmCancel} disabled={!onCancel}>
            <X size={14} />
            取消
          </button>
        </div>
      </div>
    );
  }

  const start = String(firstChapter);
  const end = String(lastChapter);
  const recentStart = String(Math.max(firstChapter, lastChapter - 99));
  const isAll = form.start_chapter === start && form.end_chapter === end;
  const isRecent = form.start_chapter === recentStart && form.end_chapter === end && recentStart !== start;

  function applyRange(startChapter, endChapter) {
    setCustomOpen(false);
    onFormChange({ ...form, start_chapter: String(startChapter), end_chapter: String(endChapter) });
  }

  return (
    <div className="taskbar">
      <div className="t-info">
        <div className="t-line">
          {coverageReady ? <StatusPill status={idlePillStatus(percent, failedCount)} /> : null}
          <b>{title}</b>
        </div>
        <span className="t-sub">{sub}</span>
        {coverageReady ? <span className="bar"><i style={{ width: `${percent}%` }} /></span> : null}
      </div>
      <div className="ops">
        {failedCount > 0 && onRetryFailed ? (
          <button className="action-chip danger-icon" type="button" onClick={onRetryFailed} disabled={busy}>
            重试失败 {failedCount} 回
          </button>
        ) : null}
        {emptyCount > 0 && onRetryEmpty ? (
          <button className="action-chip" type="button" onClick={onRetryEmpty} disabled={busy}>
            补跑空章 {emptyCount} 回
          </button>
        ) : null}
        <div className="range-quick">
          <button type="button" className={isAll && !customOpen ? "on" : ""} onClick={() => applyRange(firstChapter, lastChapter)}>
            全部
          </button>
          <button type="button" className={isRecent && !customOpen ? "on" : ""} onClick={() => applyRange(recentStart, lastChapter)}>
            最近100回
          </button>
          <button
            type="button"
            className={customOpen ? "on" : ""}
            onClick={() => setCustomOpen(true)}
          >
            自定义
          </button>
        </div>
        <button
          className="primary inline"
          type="button"
          onClick={onStart}
          disabled={busy || Boolean(blockedHint) || !providerReady}
        >
          {busy ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
          {busy ? "构建中" : startLabel}
        </button>
      </div>
      {customOpen ? (
        <div className="t-custom">
          <label>
            起始章节
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.start_chapter}
              onChange={(event) => onFormChange({ ...form, start_chapter: sanitizeChapterInput(event.target.value) })}
            />
          </label>
          <label>
            结束章节
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.end_chapter}
              onChange={(event) => onFormChange({ ...form, end_chapter: sanitizeChapterInput(event.target.value) })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.force}
              onChange={(event) => onFormChange({ ...form, force: event.target.checked })}
            />
            强制重建
          </label>
        </div>
      ) : null}
      {blockedHint ? <span className="blocked">{blockedHint}</span> : null}
    </div>
  );
}

// 空闲态 pill：有失败章节优先报"完成有错"；全覆盖无失败才报"完成"；部分覆盖报"完成有错"（提示可续跑）；零覆盖报"排队"
function idlePillStatus(percent, failedCount) {
  if (failedCount > 0) return "completed_with_errors";
  if (percent >= 100) return "completed";
  if (percent > 0) return "completed_with_errors";
  return "queued";
}
