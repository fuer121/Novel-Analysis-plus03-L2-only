import { coveragePercent } from "../../analysisCoverage.js";

/**
 * 覆盖率卡片：原 CoverageSummary（章节线索）与 L2CoverageSummary（事实索引）
 * 结构完全一致，合并为一个参数化组件。统计文案、失败章节来源和兜底提示由调用方给出。
 */
export function CoverageCard({ label, loadingText, coverage, stats, failedChapters, failedNotePrefix, fallbackNote }) {
  if (!coverage) return <div className="index-summary">{loadingText}</div>;
  const finishedRatio = coveragePercent(coverage);
  return (
    <div className="coverage-card">
      <div className="coverage-head">
        <strong>{label} {finishedRatio}%</strong>
        <span>{stats}</span>
      </div>
      <div className="coverage-bar" aria-label={`${label} ${finishedRatio}%`}>
        <span style={{ width: `${finishedRatio}%` }} />
      </div>
      <p className="coverage-note">
        {failedChapters.length
          ? `${failedNotePrefix}：${compactChapterList(failedChapters.slice(0, 16))}`
          : fallbackNote}
      </p>
    </div>
  );
}

function compactChapterList(indexes) {
  return indexes.length ? indexes.join(", ") : "-";
}
