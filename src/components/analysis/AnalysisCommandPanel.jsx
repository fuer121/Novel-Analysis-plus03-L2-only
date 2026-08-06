import { Loader2, Play } from "lucide-react";
import { analysisIndexCoverageText, factIndexName } from "../../analysisCoverage.js";
import { Panel, TaskBox } from "../../ui.jsx";
import { sanitizeChapterInput } from "../../utils/chapterRange.js";

export function AnalysisCommandPanel({
  selectedBook,
  analysisForm,
  onFormChange,
  indexGroups,
  selectedL2QueryIndexKeys,
  onToggleIndexKey,
  l2QueryText,
  onL2QueryTextChange,
  l2CoveragesByGroup,
  selectedL2QueryEnabledIndexKeys,
  hasBoundIndexGroups,
  analysisProviderReady,
  selectedCount,
  totalInRange,
  onStart,
  analysisTask,
  analysisBusy,
  blockedHint = "",
  onControl
}) {
  return (
    <Panel
      icon={Play}
      title="发起提问"
      action={<TaskStats book={selectedBook} selectedCount={selectedCount} totalInRange={totalInRange} />}
    >
      <div className="form-grid analysis-form-grid">
        <label>
          <span>起始章节</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={analysisForm.start_chapter}
            onChange={(event) => onFormChange({ start_chapter: sanitizeChapterInput(event.target.value) })}
          />
        </label>
        <label>
          <span>结束章节</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={analysisForm.end_chapter}
            onChange={(event) => onFormChange({ end_chapter: sanitizeChapterInput(event.target.value) })}
          />
        </label>
      </div>

      <div className="l2-query-box">
        <label>
          <span>事实索引</span>
          <div className="index-checkbox-list">
            {indexGroups.map((group) => (
              <label key={group.group_key} className="inline-check">
                <input
                  type="checkbox"
                  checked={selectedL2QueryIndexKeys.includes(group.group_key)}
                  onChange={() => onToggleIndexKey(group.group_key)}
                />
                <span>{factIndexName(group)}</span>
              </label>
            ))}
          </div>
        </label>
        <label>
          <span>查询问题 / 输出要求</span>
          <textarea
            className="l2-query-textarea"
            value={l2QueryText}
            placeholder="例如：帮我查找剑来飞剑专项 L2 中关于初一（早期外形是银锭，原文中称之为小银锭）的内容，并整理成初一外形演化时间线"
            onChange={(event) => onL2QueryTextChange(event.target.value)}
          />
        </label>
      </div>

      <div className="command-footer">
        <div className="index-route-note">
          {analysisRouteNote(l2CoveragesByGroup, selectedL2QueryEnabledIndexKeys, indexGroups)}
        </div>
        <button
          className="primary inline command-primary"
          type="button"
          onClick={onStart}
          disabled={analysisBusy || Boolean(blockedHint) || !analysisProviderReady || !analysisForm.book_id || !selectedCount || !hasBoundIndexGroups || !l2QueryText.trim()}
        >
          {analysisBusy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          {analysisBusy ? "提问中" : "开始提问"}
        </button>
      </div>

      {blockedHint ? <p className="muted-line">{blockedHint}</p> : null}

      {analysisTask ? (
        <TaskBox
          task={analysisTask}
          onCancel={() => onControl("cancel")}
          onPause={() => onControl("pause")}
          onResume={() => onControl("resume")}
        />
      ) : null}
    </Panel>
  );
}

function TaskStats({ book, selectedCount, totalInRange }) {
  return (
    <div className="stats">
      <span>{book?.chapter_count || 0} 章已入库</span>
      <span>{selectedCount}/{totalInRange} 已选</span>
    </div>
  );
}

function analysisRouteNote(coveragesByGroup, indexGroupKeys, indexGroups) {
  const groupText = analysisIndexCoverageText({ indexGroupKeys, indexGroups, coveragesByGroup });
  return `提问 · 只查询事实索引，不跑逐章分析，不复核原文 · ${groupText}`;
}
