import { Database, ScrollText } from "lucide-react";
import { factIndexName } from "../analysisCoverage.js";
import { L2IndexPanel } from "../components/library/L2IndexPanel.jsx";
import { IndexGroupManager } from "../components/prompts/IndexGroupManager.jsx";
import { IndexPromptEditor } from "../components/prompts/IndexPromptEditor.jsx";
import { RebuildConfirm } from "../components/prompts/RebuildConfirm.jsx";
import { BASE_INDEX_GROUP_KEY } from "../constants/index.js";
import { useAppContext } from "../context/appContext.js";
import { useL2ManageData } from "../hooks/useL2ManageData.js";
import { otherBookTaskHint } from "../utils/taskProgress.js";
import { Panel } from "../ui.jsx";

/**
 * L2 管理页（#/book/:id/l2）：索引组管理（新建/编辑/删除，base 默认组只读）、
 * 事实索引规则编辑、构建任务控制与事实明细预览。
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
    indexGroupDraft,
    indexGroupBusy,
    selectIndexGroup,
    startNewIndexGroup,
    updateIndexGroupDraft,
    saveIndexGroup,
    deleteIndexGroup,
    buildGroupKey,
    setBuildGroupKey,
    buildGroup,
    l2Coverage,
    l2Facts,
    l2PromptCoverage,
    saving,
    rebuildPrompt,
    setRebuildPrompt,
    l2Form,
    setL2Form,
    startBuild,
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

  // 任务通道是全局的：本书任务正常展示任务盒；别书任务占用通道时禁用启动并给出提示
  const bookL2Task = l2Task?.payload?.bookId === bookId ? l2Task : null;
  const externalL2Task = l2Busy && !bookL2Task ? l2Task : null;
  const blockedHint = otherBookTaskHint(externalL2Task, books, "正在构建事实索引");
  const isBaseGroup = selectedIndexGroup?.group_key === BASE_INDEX_GROUP_KEY;

  return (
    <section className="manage-page">
      <header className="page-hero">
        <div>
          <span>{book?.book_name || bookId}</span>
          <h2>事实索引<span className="badge hero-badge">L2</span></h2>
          <p>索引组、提取规则、构建任务与事实明细。</p>
        </div>
      </header>

      <div className="manage-grid">
        <Panel icon={Database} title={`索引组（${indexGroups.length}）`}>
          <IndexGroupManager
            groups={indexGroups}
            selectedKey={selectedIndexGroupKey}
            draft={indexGroupDraft}
            busy={indexGroupBusy}
            onSelect={selectIndexGroup}
            onNew={startNewIndexGroup}
            onDraftChange={updateIndexGroupDraft}
            onSave={saveIndexGroup}
            onDelete={deleteIndexGroup}
          />
        </Panel>

        <Panel icon={ScrollText} title="事实索引规则">
          {selectedIndexGroup ? (
            <div className="index-prompt-stack">
              <IndexPromptEditor
                type="l2"
                title={`事实索引规则 · ${factIndexName(selectedIndexGroup)}${isBaseGroup ? "（默认）" : ""}`}
                value={selectedIndexGroup.l2_index_prompt || ""}
                updatedAt={selectedIndexGroup.updated_at || ""}
                coverage={l2PromptCoverage}
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
            </div>
          ) : (
            <div className="empty-state">
              <b>{indexGroups.length ? "正在新建事实索引。" : "索引组读取中。"}</b>
              {indexGroups.length ? "在上方「索引组」里填写名称与规则并保存后，在这里继续调整提取规则。" : ""}
            </div>
          )}
        </Panel>

        <L2IndexPanel
          form={l2Form}
          onFormChange={setL2Form}
          indexGroups={indexGroups}
          selectedIndexGroupKey={buildGroupKey}
          onIndexGroupKeyChange={setBuildGroupKey}
          selectedIndexGroup={buildGroup}
          coverage={l2Coverage}
          facts={l2Facts}
          busy={l2Busy && Boolean(bookL2Task)}
          blockedHint={blockedHint}
          providerReady={Boolean(config?.difyL2Configured)}
          task={bookL2Task}
          onStart={startBuild}
          onCancel={onL2Cancel}
          onPause={onL2Pause}
          onResume={onL2Resume}
        />
      </div>
    </section>
  );
}
