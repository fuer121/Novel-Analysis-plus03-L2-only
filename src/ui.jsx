import {
  Clipboard,
  Database,
  Download,
  Pause,
  Play
} from "lucide-react";
import { useEffect, useState } from "react";
import { downloadFile, downloadJson, formatTime } from "./api.js";
import { isLiveTask, taskStatusLabel, LIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES } from "./constants/taskStatus.js";
import { excelWorkbookXmlFromJson } from "./schemaTools.js";

export function RuntimeGrid({ config }) {
  return (
    <div className="runtime-grid">
      <RuntimeItem
        icon={Database}
        label="Dify"
        ok={config.difyConfigured}
        value={config.difyConfigured ? "已配置" : "未配置"}
        title={config.difyBase || "未配置"}
      />
      <RuntimeItem
        icon={Database}
        label="章节线索"
        ok={Boolean(config.difyL1Configured)}
        value={config.difyL1Configured ? "已配置" : "未配置"}
      />
      <RuntimeItem
        icon={Database}
        label="事实索引"
        ok={Boolean(config.difyL2Configured)}
        value={config.difyL2Configured ? "已配置" : "未配置"}
      />
      <RuntimeItem
        icon={Database}
        label="分析汇总"
        ok={Boolean(config.difyAnalysisSummaryConfigured)}
        value={config.difyAnalysisSummaryConfigured ? "已配置" : "未配置"}
      />
    </div>
  );
}

function RuntimeItem({ icon: Icon, label, value, ok, title }) {
  return (
    <div className="runtime-item" title={title || value}>
      <Icon size={15} />
      <span>{label}</span>
      <strong className={ok ? "ok" : "bad"}>{value}</strong>
    </div>
  );
}

export function Panel({ icon: Icon, title, action, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div className="panel-title">
          <Icon size={18} />
          <h2>{title}</h2>
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function IconButton({ icon: Icon, label, onClick, disabled, className = "ghost", title }) {
  return (
    <button className={className} type="button" onClick={onClick} disabled={disabled} title={title || label}>
      <Icon size={15} />
      {label}
    </button>
  );
}

export function TaskBox({ task, onCancel, onPause, onResume }) {
  if (!task) return <div className="task-empty">无任务</div>;
  const live = isLiveTask(task);
  const total = task.progress?.total || 1;
  const completed = task.progress?.completed || 0;
  const processed = completed + (task.progress?.failed || 0) + (task.progress?.skipped || 0);
  const percent = Math.min(100, Math.round((processed / total) * 100));
  const canControl = LIVE_TASK_STATUSES.includes(task.status);
  const isPaused = task.status === "paused";
  return (
    <div className="task-box">
      <div className="task-top">
        <StatusPill status={task.status} />
        <span>{task.progress?.current || task.status}</span>
      </div>
      <div className="progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="task-meta">
        <span>{completed}/{total}</span>
        <span>失败 {task.progress?.failed || 0}</span>
        <span>跳过 {task.progress?.skipped || 0}</span>
      </div>
      <TaskTimeLine task={task} live={live} />
      {canControl && (onCancel || onPause || onResume) ? (
        <div className="task-controls">
          {isPaused ? (
            <IconButton icon={Play} label="继续" onClick={onResume} disabled={!onResume} />
          ) : (
            <IconButton icon={Pause} label="暂停" onClick={onPause} disabled={!onPause} />
          )}
          <button
            className="danger inline"
            type="button"
            onClick={() => {
              // 取消是破坏性操作：二次确认（与删除索引组的 window.confirm 口径一致）
              if (onCancel && window.confirm("确认取消当前任务？已完成的进度会保留。")) onCancel();
            }}
            disabled={!onCancel}
          >
            取消
          </button>
        </div>
      ) : null}
      <div className="event-list">
        {(task.events || []).slice(-5).reverse().map((event, index) => (
          <div className="event-row" key={`${event.time}-${index}`}>
            <span>{formatTime(event.time)}</span>
            <p>{event.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatusPill({ status }) {
  return <strong className={`pill ${status}`}>{taskStatusLabel(status)}</strong>;
}

// 计时文本独立成组件：只有秒数文本每秒更新，TaskBox 其余子树不跟随重渲染
function TaskTimeLine({ task, live }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live, task.id]);

  const timing = taskTiming(task, now);
  return (
    <div className="task-time">
      <span>已用 {timing.elapsed}</span>
      <span>剩余 {timing.remaining}</span>
    </div>
  );
}

function taskTiming(task, now) {
  const estimate = task.estimate;
  const elapsedMs = Number.isFinite(estimate?.elapsedMs)
    ? estimate.elapsedMs
    : fallbackElapsedMs(task, now);
  const remainingMs = Number.isFinite(estimate?.remainingMs)
    ? estimate.remainingMs
    : estimate?.remainingMs === null
      ? null
      : fallbackRemainingMs(task, elapsedMs);
  return {
    elapsed: formatDuration(elapsedMs),
    remaining: remainingMs === null ? "估算中" : formatDuration(remainingMs)
  };
}

function fallbackElapsedMs(task, now) {
  const start = new Date(task.createdAt || task.updatedAt || now).getTime();
  const end = TERMINAL_TASK_STATUSES.includes(task.status)
    ? new Date(task.updatedAt || now).getTime()
    : now;
  return Math.max(0, end - start);
}

function fallbackRemainingMs(task, elapsedMs) {
  const total = Math.max(0, task.progress?.total || 0);
  const processed = Math.min(total, (task.progress?.completed || 0) + (task.progress?.failed || 0) + (task.progress?.skipped || 0));
  if (processed > 0 && total > processed) return Math.max(0, (elapsedMs / processed) * (total - processed));
  return total > processed && LIVE_TASK_STATUSES.includes(task.status) ? null : 0;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${String(minutes).padStart(2, "0")}分`;
  if (minutes) return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  return `${seconds}秒`;
}

export function ResultActions({ analysis }) {
  const canUse = analysis?.finalResult !== undefined && analysis?.finalResult !== null && analysis?.finalResult !== "";
  return (
    <div className="action-row">
      <IconButton
        icon={Clipboard}
        label="复制"
        disabled={!canUse}
        onClick={() => navigator.clipboard?.writeText(formatResultForClipboard(analysis.finalResult))}
      />
      <IconButton
        icon={Download}
        label="下载"
        disabled={!canUse}
        onClick={() => downloadAnalysisResult(analysis)}
      />
    </div>
  );
}

function formatResultForClipboard(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function downloadAnalysisResult(analysis) {
  if (typeof analysis.finalResult === "string") {
    downloadFile(
      `${safeDownloadName(analysis.name || `analysis-${analysis.id}`)}.md`,
      analysis.finalResult,
      "text/markdown;charset=utf-8"
    );
    return;
  }
  const workbook = excelWorkbookXmlFromJson(analysis.finalResult, { title: analysis.name || "分析结果" });
  if (workbook) {
    downloadFile(
      `${safeDownloadName(analysis.name || `analysis-${analysis.id}`)}.xls`,
      workbook,
      "application/vnd.ms-excel;charset=utf-8"
    );
    return;
  }
  downloadJson(`analysis-${analysis.id}.json`, analysis.finalResult);
}

function safeDownloadName(value) {
  return String(value || "analysis-result")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "analysis-result";
}

export function LoadingScreen() {
  return (
    <main className="boot">
      <div className="boot-card" aria-label="正在加载章节库">
        <div className="skeleton-line wide" />
        <div className="skeleton-line" />
        <div className="skeleton-grid">
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}
