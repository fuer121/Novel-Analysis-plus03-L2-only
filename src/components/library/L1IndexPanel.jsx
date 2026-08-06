import { Layers } from "lucide-react";
import { coverageCounts, coveragePercent } from "../../analysisCoverage.js";
import { Panel } from "../../ui.jsx";
import { Taskbar } from "../Taskbar.jsx";

export function L1IndexPanel({
  form,
  onFormChange,
  coverage,
  chapters,
  firstChapter,
  lastChapter,
  busy,
  blockedHint = "",
  providerReady,
  task,
  onStart,
  onCancel,
  onPause,
  onResume
}) {
  const { completed, total } = coverageCounts(coverage);
  const failedChapters = chapters.filter((chapter) => chapter.status === "failed").map((chapter) => chapter.chapter_index);
  const sub = !coverage
    ? "章节线索读取中"
    : failedChapters.length
      ? `${completed}/${total} 章完成 · 失败章节 ${failedChapters.slice(0, 12).join(", ")}`
      : `${completed}/${total} 章完成`;
  return (
    <Panel
      icon={Layers}
      title="构建状态"
      className="index-work-panel"
    >
      <Taskbar
        title="章节线索"
        sub={sub}
        percent={coverage ? coveragePercent(coverage) : 0}
        coverageReady={Boolean(coverage)}
        failedCount={failedChapters.length}
        firstChapter={firstChapter}
        lastChapter={lastChapter}
        form={form}
        onFormChange={onFormChange}
        busy={busy}
        blockedHint={blockedHint}
        providerReady={providerReady}
        startLabel="构建章节线索"
        onStart={onStart}
        task={task}
        onCancel={onCancel}
        onPause={onPause}
        onResume={onResume}
      />
    </Panel>
  );
}
