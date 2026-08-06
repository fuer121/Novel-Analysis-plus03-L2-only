import { formatTime } from "../api.js";
import { L1ChapterBrowser } from "../components/library/L1ChapterBrowser.jsx";
import { L1IndexPanel } from "../components/library/L1IndexPanel.jsx";
import { IndexPromptEditor } from "../components/prompts/IndexPromptEditor.jsx";
import { RebuildConfirm } from "../components/prompts/RebuildConfirm.jsx";
import { RuleFold } from "../components/RuleFold.jsx";
import { useAppContext } from "../context/appContext.js";
import { useL1ManageData } from "../hooks/useL1ManageData.js";
import { navigate, paths, useRoute } from "../router.js";
import { otherBookTaskHint } from "../utils/taskProgress.js";

/**
 * L1 管理页（#/book/:id/l1）：构建状态与任务控制、提取规则查看/编辑、
 * 章节线索主从阅读（左栏回目检索 + 右栏 kv 线索摘要）。
 * 选中章同步 ?ch=N（replace 不滚动），刷新/分享/溯源链接保持定位。
 */
export function L1ManagePage({
  bookId,
  l1Task,
  l1Busy,
  onStartL1Index,
  onL1Cancel,
  onL1Pause,
  onL1Resume,
  onLoadBookIndexPrompts,
  onSaveBookIndexPrompts
}) {
  const { books, config } = useAppContext();
  const { query } = useRoute();
  const book = books.find((entry) => entry.book_id === bookId) || null;
  const {
    l1Coverage,
    l1Chapters,
    chapterMeta,
    indexPrompts,
    saving,
    rebuildPrompt,
    setRebuildPrompt,
    l1Form,
    setL1Form,
    firstChapter,
    lastChapter,
    startBuild,
    saveL1Prompt,
    startRebuild
  } = useL1ManageData({
    book,
    bookId,
    l1Task,
    onLoadBookIndexPrompts,
    onSaveBookIndexPrompts,
    onStartL1Index
  });

  // ?ch=N = 选中章；无 ch 时默认第一回；点选章节 replace 写回 URL（不滚动页面）
  const chapterCount = chapterMeta.length || l1Chapters.length;
  const wantedChapter = Number(query.ch || 0);
  const selectedChapter = wantedChapter > 0 ? wantedChapter : (chapterCount ? firstChapter : 0);
  function selectChapter(chapterIndex) {
    if (!chapterIndex || chapterIndex === wantedChapter) return;
    navigate(`${paths.l1(bookId)}?ch=${chapterIndex}`, { replace: true, scroll: false });
  }
  // 任务通道是全局的：本书任务正常展示任务盒；别书任务占用通道时禁用启动并给出提示
  const bookL1Task = l1Task?.payload?.bookId === bookId ? l1Task : null;
  const externalL1Task = l1Busy && !bookL1Task ? l1Task : null;
  const blockedHint = otherBookTaskHint(externalL1Task, books, "正在构建章节线索");

  return (
    <section className="manage-page">
      <header className="page-hero">
        <div>
          <span>{book?.book_name || bookId}</span>
          <h2>章节线索<span className="badge hero-badge">L1</span></h2>
          <p>每章摘要的构建状态、提取规则与按章线索阅读。</p>
        </div>
      </header>

      <div className="manage-grid">
        <L1IndexPanel
          form={l1Form}
          onFormChange={setL1Form}
          coverage={l1Coverage}
          chapters={l1Chapters}
          firstChapter={firstChapter}
          lastChapter={lastChapter}
          busy={l1Busy && Boolean(bookL1Task)}
          blockedHint={blockedHint}
          providerReady={Boolean(config?.difyL1Configured)}
          task={bookL1Task}
          onStart={startBuild}
          onCancel={onL1Cancel}
          onPause={onL1Pause}
          onResume={onL1Resume}
        />

        <RuleFold title="提取规则" meta={indexPrompts?.updated_at ? `更新 ${formatTime(indexPrompts.updated_at)}` : ""}>
          {indexPrompts ? (
            <div className="index-prompt-stack">
              <IndexPromptEditor
                type="l1"
                title="章节线索规则"
                value={indexPrompts.l1_index_prompt || ""}
                updatedAt={indexPrompts.updated_at}
                coverage={l1Coverage}
                saving={saving}
                onSave={saveL1Prompt}
              />
              {rebuildPrompt ? (
                <RebuildConfirm
                  type="l1"
                  book={book}
                  onCancel={() => setRebuildPrompt(null)}
                  onStart={startRebuild}
                />
              ) : null}
            </div>
          ) : (
            <div className="empty-state">规则读取中</div>
          )}
        </RuleFold>

        {chapterCount ? (
          <L1ChapterBrowser
            metaChapters={chapterMeta}
            l1Chapters={l1Chapters}
            selectedIndex={selectedChapter}
            onSelect={selectChapter}
          />
        ) : (
          <div className="empty-state">
            <b>{l1Task ? "章节线索构建中，完成后这里可以按章查看与检索。" : "还没有章节线索。先在上方「构建状态」里发起构建。"}</b>
          </div>
        )}
      </div>
    </section>
  );
}
