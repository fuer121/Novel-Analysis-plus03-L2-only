import { useState } from "react";
import { Database, Plus, Trash2 } from "lucide-react";
import { factIndexName } from "../analysisCoverage.js";
import { formatTime } from "../api.js";
import { L2FactTable } from "../components/library/L2FactTable.jsx";
import { IndexPromptEditor } from "../components/prompts/IndexPromptEditor.jsx";
import { RebuildConfirm } from "../components/prompts/RebuildConfirm.jsx";
import { RuleFold } from "../components/RuleFold.jsx";
import { Taskbar } from "../components/Taskbar.jsx";
import { BASE_INDEX_GROUP_KEY } from "../constants/index.js";
import { isLiveTask, TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import { useL2ManageData } from "../hooks/useL2ManageData.js";
import { navigate, paths } from "../router.js";
import { otherBookTaskHint, taskProgressPercent } from "../utils/taskProgress.js";
import { Panel } from "../ui.jsx";

/**
 * L2 管理页（#/book/:id/l2）：v5 抽屉主从——左栏索引组列表（状态/统计/进度，
 * base 组沉底标「默认」，底部固定新建入口），右栏随选中组切换：
 * Taskbar（组级覆盖/任务/重试失败）+ RuleFold 规则编辑（base 只读）+ 事实表。
 * 选中组同步 ?g=key，刷新/分享保持。
 */
export function L2ManagePage({
  bookId,
  l2Task,
  l2Busy,
  onStartL2Index,
  onL2Cancel,
  onL2Pause,
  onL2Resume,
  onLoadBookIndexPrompts,
  onLoadBookIndexGroups,
  onCreateBookIndexGroup,
  onUpdateBookIndexGroup,
  onDeleteBookIndexGroup
}) {
  const { books, config } = useAppContext();
  const book = books.find((entry) => entry.book_id === bookId) || null;
  const {
    indexGroups,
    selectedIndexGroup,
    selectedIndexGroupKey,
    indexGroupBusy,
    selectGroup,
    deleteIndexGroup,
    renameSelectedGroup,
    groupStats,
    l2Coverage,
    saving,
    rebuildPrompt,
    setRebuildPrompt,
    l2Form,
    setL2Form,
    firstChapter,
    lastChapter,
    startBuild,
    startRetryFailed,
    saveSpecializedL2Prompt,
    startRebuild
  } = useL2ManageData({
    book,
    bookId,
    l2Task,
    onLoadBookIndexPrompts,
    onLoadBookIndexGroups,
    onCreateBookIndexGroup,
    onUpdateBookIndexGroup,
    onDeleteBookIndexGroup,
    onStartL2Index
  });

  // 任务通道是全局的：本书任务按组归位；别书任务占用通道时禁用启动并给出提示
  const bookL2Task = l2Task?.payload?.bookId === bookId ? l2Task : null;
  const externalL2Task = l2Busy && !bookL2Task ? l2Task : null;
  const otherBookHint = otherBookTaskHint(externalL2Task, books, "正在构建事实索引");
  const taskGroupKey = bookL2Task?.payload?.indexGroupKey || "";
  const taskOnSelectedGroup = Boolean(bookL2Task) && isLiveTask(bookL2Task) && taskGroupKey === selectedIndexGroupKey;
  const taskOnOtherGroup = Boolean(bookL2Task) && isLiveTask(bookL2Task) && taskGroupKey && taskGroupKey !== selectedIndexGroupKey;
  const taskGroupName = taskOnOtherGroup
    ? factIndexName(indexGroups.find((group) => group.group_key === taskGroupKey) || { group_key: taskGroupKey, name: "" })
    : "";
  const blockedHint = otherBookHint || (taskOnOtherGroup ? `索引组「${taskGroupName}」正在构建，完成后可启动` : "");
  const isBaseGroup = selectedIndexGroup?.group_key === BASE_INDEX_GROUP_KEY;
  const l2TerminalTaskId = bookL2Task && TERMINAL_TASK_STATUSES.includes(bookL2Task.status) ? bookL2Task.id : "";

  const nonBaseGroups = indexGroups.filter((group) => group.group_key !== BASE_INDEX_GROUP_KEY);
  const baseGroup = indexGroups.find((group) => group.group_key === BASE_INDEX_GROUP_KEY) || null;
  const totalChapters = Number(book?.chapter_count || 0);

  const selectedCoverage = l2Coverage?.chapters || null;
  const failedChapters = l2Coverage?.failed_chapters || [];
  const coverageSub = !l2Coverage
    ? "覆盖率读取中"
    : `${Number(selectedCoverage?.completed || 0)}/${Number(selectedCoverage?.total || 0)} 章 · ${Number(selectedCoverage?.facts || 0)} 条事实`
      + (failedChapters.length ? ` · 失败章节 ${failedChapters.slice(0, 12).join(", ")}` : "");
  const coveragePercentValue = selectedCoverage?.total
    ? Math.round((Number(selectedCoverage.completed || 0) / Number(selectedCoverage.total)) * 100)
    : 0;

  return (
    <section className="manage-page">
      <header className="page-hero">
        <div>
          <span>{book?.book_name || bookId}</span>
          <h2>事实索引<span className="badge hero-badge">L2</span></h2>
          <p>索引组、提取规则、构建任务与事实明细。</p>
        </div>
      </header>

      <div className="l2-grid">
        <aside className="g-list">
          <div className="g-head">索引组（{indexGroups.length}）</div>
          <div className="g-items">
            {nonBaseGroups.map((group) => (
              <GroupItem
                key={group.group_key}
                group={group}
                selected={group.group_key === selectedIndexGroupKey}
                stats={groupStats[group.group_key] || null}
                totalChapters={totalChapters}
                liveTask={bookL2Task}
                onSelect={selectGroup}
              />
            ))}
            {baseGroup ? (
              <div className="g-base-sep">
                <GroupItem
                  group={baseGroup}
                  selected={baseGroup.group_key === selectedIndexGroupKey}
                  stats={groupStats[baseGroup.group_key] || null}
                  totalChapters={totalChapters}
                  liveTask={bookL2Task}
                  onSelect={selectGroup}
                />
              </div>
            ) : null}
          </div>
          <button className="g-new" type="button" onClick={() => navigate(paths.l2New(bookId))}>
            <Plus size={13} />
            新建索引组
          </button>
        </aside>

        <div className="l2-work">
          {selectedIndexGroup ? (
            <>
              <Taskbar
                title={factIndexName(selectedIndexGroup)}
                sub={coverageSub}
                percent={coveragePercentValue}
                coverageReady={Boolean(l2Coverage)}
                failedCount={failedChapters.length}
                onRetryFailed={startRetryFailed}
                firstChapter={firstChapter}
                lastChapter={lastChapter}
                form={l2Form}
                onFormChange={setL2Form}
                busy={l2Busy && taskOnSelectedGroup}
                blockedHint={blockedHint}
                providerReady={Boolean(config?.difyL2Configured)}
                startLabel={`构建 ${factIndexName(selectedIndexGroup)}`}
                onStart={startBuild}
                task={taskOnSelectedGroup ? bookL2Task : null}
                onCancel={onL2Cancel}
                onPause={onL2Pause}
                onResume={onL2Resume}
              />

              <RuleFold
                title={isBaseGroup ? "默认索引抽取规则" : `${factIndexName(selectedIndexGroup)} · 提取规则`}
                meta={selectedIndexGroup?.updated_at ? `更新 ${formatTime(selectedIndexGroup.updated_at)}` : ""}
              >
                {selectedIndexGroup ? (
                  <div className="index-prompt-stack">
                    <IndexPromptEditor
                      type="l2"
                      title={`事实索引规则 · ${factIndexName(selectedIndexGroup)}${isBaseGroup ? "（默认）" : ""}`}
                      value={selectedIndexGroup.l2_index_prompt || ""}
                      updatedAt={selectedIndexGroup.updated_at || ""}
                      coverage={l2Coverage}
                      saving={saving}
                      onSave={saveSpecializedL2Prompt}
                      editable={!isBaseGroup}
                    />
                    {rebuildPrompt ? (
                      <RebuildConfirm
                        type="l2"
                        book={book}
                        onCancel={() => setRebuildPrompt(null)}
                        onStart={startRebuild}
                      />
                    ) : null}
                    {!isBaseGroup ? (
                      <GroupOpsRow
                        group={selectedIndexGroup}
                        busy={indexGroupBusy || saving}
                        onRename={renameSelectedGroup}
                        onDelete={deleteIndexGroup}
                      />
                    ) : (
                      <div className="muted-line">默认索引兼容历史数据，规则随书籍级 L2 规则同步，不可单独编辑。</div>
                    )}
                  </div>
                ) : (
                  <div className="empty-state">索引组读取中</div>
                )}
              </RuleFold>

              <Panel
                icon={Database}
                title={`${factIndexName(selectedIndexGroup)} · 事实`}
              >
                <L2FactTable
                  key={selectedIndexGroupKey}
                  bookId={bookId}
                  groupKey={selectedIndexGroupKey}
                  firstChapter={firstChapter}
                  lastChapter={lastChapter}
                  totalCount={groupStats[selectedIndexGroupKey]?.facts_count ?? null}
                  refreshKey={l2TerminalTaskId}
                />
              </Panel>
            </>
          ) : (
            <div className="empty-state">索引组读取中</div>
          )}
        </div>
      </div>
    </section>
  );
}

function GroupItem({ group, selected, stats, totalChapters, liveTask, onSelect }) {
  const running = isLiveTask(liveTask) && liveTask.payload?.indexGroupKey === group.group_key;
  const percent = running ? taskProgressPercent(liveTask) : 0;
  const isBase = group.group_key === BASE_INDEX_GROUP_KEY;
  const unbuilt = !running && stats && !stats.built_chapters && !stats.facts_count;
  let sub = "统计读取中";
  if (running) {
    sub = `${liveTask.progress?.current || "进行中"} · ${percent}%`;
  } else if (stats) {
    sub = stats.built_chapters || stats.facts_count
      ? `${stats.built_chapters}/${totalChapters || "?"} 章 · ${stats.facts_count} 条事实${stats.failed_chapters ? ` · 失败 ${stats.failed_chapters} 回` : ""}`
      : "尚未构建";
  }
  return (
    <button
      type="button"
      className={`g-item${isBase ? " base" : ""}${selected ? " on" : ""}`}
      onClick={() => onSelect(group.group_key)}
    >
      <span className="g-top">
        <span className="g-name">
          {factIndexName(group)}
          {isBase ? <span className="g-tag">默认</span> : null}
        </span>
        {running ? <span className="pill running">构建中</span> : null}
        {unbuilt ? <span className="pill queued">未构建</span> : null}
      </span>
      <span className="g-sub">{sub}</span>
      {running ? <span className="bar"><i style={{ width: `${percent}%` }} /></span> : null}
    </button>
  );
}

function GroupOpsRow({ group, busy, onRename, onDelete }) {
  const [name, setName] = useState(group.name || "");
  const [savedName, setSavedName] = useState(group.name || "");
  if (savedName !== (group.name || "")) {
    setSavedName(group.name || "");
    setName(group.name || "");
  }
  return (
    <div className="group-ops">
      <label>
        <span>名称</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        className="secondary inline"
        type="button"
        disabled={busy || !name.trim() || name.trim() === group.name}
        onClick={() => onRename(name)}
      >
        重命名
      </button>
      <button className="danger inline" type="button" onClick={onDelete} disabled={busy}>
        <Trash2 size={14} />
        删除
      </button>
    </div>
  );
}
