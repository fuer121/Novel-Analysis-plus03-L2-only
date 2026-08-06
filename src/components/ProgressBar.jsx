/**
 * 轻量进度条：顶栏任务 chip、书卡片、入口卡、管理页复用。
 * tone: "info"（进行中，蓝）| "done"（完成，绿，默认）。
 */
export function ProgressBar({ percent = 0, tone = "done", label }) {
  const width = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className={`progress-bar ${tone}`} role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}
