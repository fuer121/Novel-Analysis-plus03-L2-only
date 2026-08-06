import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { analysisIndexCoverageText, factIndexName } from "../../analysisCoverage.js";
import { BASE_INDEX_GROUP_KEY } from "../../constants/index.js";
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
  // 范围快捷（v5 .range-quick）：全书 / 最近100回 / 自定义（展开手输起止）
  const [customOpen, setCustomOpen] = useState(false);
  const firstChapter = Number(selectedBook?.first_chapter || 1);
  const lastChapter = Number(selectedBook?.last_chapter || selectedBook?.chapter_count || firstChapter);
  const recentStart = Math.max(firstChapter, lastChapter - 99);
  const isAll = analysisForm.start_chapter === String(firstChapter) && analysisForm.end_chapter === String(lastChapter);
  const isRecent = analysisForm.start_chapter === String(recentStart)
    && analysisForm.end_chapter === String(lastChapter) && recentStart !== firstChapter;

  function applyRange(startChapter, endChapter) {
    setCustomOpen(false);
    onFormChange({ start_chapter: String(startChapter), end_chapter: String(endChapter) });
  }

  return (
    <Panel
      icon={Play}
      title="发起提问"
      action={<TaskStats book={selectedBook} selectedCount={selectedCount} totalInRange={totalInRange} />}
    >
      <div className="ask-range">
        <span className="range-quick">
          范围
          <button
            type="button"
            className={isAll && !customOpen ? "on" : ""}
            onClick={() => applyRange(firstChapter, lastChapter)}
          >
            全书 {lastChapter} 回
          </button>
          <button
            type="button"
            className={isRecent && !customOpen ? "on" : ""}
            onClick={() => applyRange(recentStart, lastChapter)}
          >
            最近100回
          </button>
          <button
            type="button"
            className={customOpen ? "on" : ""}
            onClick={() => setCustomOpen(true)}
          >
            自定义
          </button>
        </span>
        {customOpen ? (
          <span className="ask-range-custom">
            <label>
              起始章节
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={analysisForm.start_chapter}
                onChange={(event) => onFormChange({ start_chapter: sanitizeChapterInput(event.target.value) })}
              />
            </label>
            <label>
              结束章节
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={analysisForm.end_chapter}
                onChange={(event) => onFormChange({ end_chapter: sanitizeChapterInput(event.target.value) })}
              />
            </label>
          </span>
        ) : null}
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
            placeholder={askPlaceholderFor(selectedBook, indexGroups)}
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

/**
 * 占位示例按书生成（v5 B5）：取材当前书名 + 第一个非 base 索引组名，
 * 组未加载到时退回只含书名的通用文案——不硬编码他书角色/组名。
 */
function askPlaceholderFor(book, indexGroups) {
  const bookName = book?.book_name || "本书";
  const group = (indexGroups || []).find((entry) => entry.group_key !== BASE_INDEX_GROUP_KEY)
    || (indexGroups || [])[0];
  if (group) {
    return `例如：《${bookName}》主要角色的「${factIndexName(group)}」在前 100 回有什么变化？帮我整理成时间线`;
  }
  return `例如：《${bookName}》的主角在前 100 回经历了哪些关键变化？`;
}
