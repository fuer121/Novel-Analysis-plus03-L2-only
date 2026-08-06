import { Database, Loader2, Play } from "lucide-react";
import { coverageCounts, factIndexName } from "../../analysisCoverage.js";
import { sanitizeChapterInput } from "../../utils/chapterRange.js";
import { Panel, TaskBox } from "../../ui.jsx";
import { CoverageCard } from "./CoverageCard.jsx";
import { L2FactPreview } from "./IndexPreviews.jsx";

export function L2IndexPanel({
  form,
  onFormChange,
  indexGroups,
  selectedIndexGroupKey,
  onIndexGroupKeyChange,
  selectedIndexGroup,
  coverage,
  facts,
  previewChapterIndex,
  busy,
  blockedHint = "",
  providerReady,
  task,
  onStart,
  onCancel,
  onPause,
  onResume
}) {
  const { completed, total, facts: factsTotal } = coverageCounts(coverage);
  const failedChapters = coverage?.failed_chapters || [];
  return (
    <Panel
      icon={Database}
      title="构建与事实明细"
      className="index-work-panel"
    >
      <div className="form-grid compact">
        <label>
          <span>事实索引</span>
          <select
            value={selectedIndexGroupKey}
            onChange={(event) => onIndexGroupKeyChange(event.target.value)}
          >
            {indexGroups.map((group) => (
              <option key={group.group_key} value={group.group_key}>
                {factIndexName(group)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>起始章节</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.start_chapter}
            onChange={(event) => onFormChange({ ...form, start_chapter: sanitizeChapterInput(event.target.value) })}
          />
        </label>
        <label>
          <span>结束章节</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.end_chapter}
            onChange={(event) => onFormChange({ ...form, end_chapter: sanitizeChapterInput(event.target.value) })}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.force}
            onChange={(event) => onFormChange({ ...form, force: event.target.checked })}
          />
          <span>强制重建</span>
        </label>
      </div>
      <CoverageCard
        label="事实索引"
        loadingText="事实索引读取中"
        coverage={coverage}
        stats={`${completed}/${total} 章 · ${factsTotal} 条事实`}
        failedChapters={failedChapters}
        failedNotePrefix="失败章节"
        fallbackNote="可用于快速分析"
      />
      <div className="index-action-bar">
        <button className="primary inline" type="button" onClick={onStart} disabled={busy || Boolean(blockedHint) || !providerReady}>
          {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          {busy ? "构建中" : `构建 ${selectedIndexGroup ? factIndexName(selectedIndexGroup) : "事实索引"}`}
        </button>
        {blockedHint ? <p className="muted-line">{blockedHint}</p> : null}
      </div>
      {task ? (
        <TaskBox
          task={task}
          onCancel={onCancel}
          onPause={onPause}
          onResume={onResume}
        />
      ) : null}
      <L2FactPreview facts={facts} chapterIndex={previewChapterIndex} />
    </Panel>
  );
}
