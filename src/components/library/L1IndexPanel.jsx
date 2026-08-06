import { Layers, Loader2, Play } from "lucide-react";
import { coverageCounts } from "../../analysisCoverage.js";
import { sanitizeChapterInput } from "../../utils/chapterRange.js";
import { Panel, TaskBox } from "../../ui.jsx";
import { CoverageCard } from "./CoverageCard.jsx";

export function L1IndexPanel({
  form,
  onFormChange,
  coverage,
  chapters,
  busy,
  blockedHint = "",
  providerReady,
  task,
  onStart,
  onCancel,
  onPause,
  onResume
}) {
  const { completed, total, missing } = coverageCounts(coverage);
  const failedChapters = chapters.filter((chapter) => chapter.status === "failed").map((chapter) => chapter.chapter_index);
  return (
    <Panel
      icon={Layers}
      title="构建状态"
      className="index-work-panel"
    >
      <div className="form-grid compact">
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
        label="章节线索"
        loadingText="章节线索读取中"
        coverage={coverage}
        stats={`${completed}/${total} 章完成`}
        failedChapters={failedChapters}
        failedNotePrefix="最近失败章节"
        fallbackNote={missing ? "未构建" : "已覆盖"}
      />
      <div className="index-action-bar">
        <button className="primary inline" type="button" onClick={onStart} disabled={busy || Boolean(blockedHint) || !providerReady}>
          {busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
          {busy ? "构建中" : "构建章节线索"}
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
    </Panel>
  );
}
