import { ClipboardList, ScrollText } from "lucide-react";
import { L1IndexPanel } from "../components/library/L1IndexPanel.jsx";
import { L1Preview } from "../components/library/IndexPreviews.jsx";
import { IndexPromptEditor } from "../components/prompts/IndexPromptEditor.jsx";
import { RebuildConfirm } from "../components/prompts/RebuildConfirm.jsx";
import { useAppContext } from "../context/appContext.js";
import { useL1ManageData } from "../hooks/useL1ManageData.js";
import { otherBookTaskHint } from "../utils/taskProgress.js";
import { Panel, StatusPill } from "../ui.jsx";

const PREVIEW_LIMIT = 10;

/**
 * L1 管理页（#/book/:id/l1）：构建状态与任务控制、提取规则查看/编辑、线索明细预览。
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
  const book = books.find((entry) => entry.book_id === bookId) || null;
  const {
    l1Coverage,
    l1Chapters,
    indexPrompts,
    saving,
    rebuildPrompt,
    setRebuildPrompt,
    l1Form,
    setL1Form,
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

  const previewChapters = l1Chapters.slice(0, PREVIEW_LIMIT);
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
          <p>每章摘要的构建状态、提取规则与线索明细。</p>
        </div>
      </header>

      <div className="manage-grid">
        <L1IndexPanel
          form={l1Form}
          onFormChange={setL1Form}
          coverage={l1Coverage}
          chapters={l1Chapters}
          busy={l1Busy && Boolean(bookL1Task)}
          blockedHint={blockedHint}
          providerReady={Boolean(config?.difyL1Configured)}
          task={bookL1Task}
          onStart={startBuild}
          onCancel={onL1Cancel}
          onPause={onL1Pause}
          onResume={onL1Resume}
        />

        <Panel icon={ScrollText} title="提取规则">
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
        </Panel>

        <Panel
          icon={ClipboardList}
          title="线索明细"
          action={<span className="muted-line">{l1Chapters.length ? `共 ${l1Chapters.length} 条，预览前 ${Math.min(PREVIEW_LIMIT, l1Chapters.length)} 条` : ""}</span>}
        >
          {previewChapters.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="chapter-col">章节</th>
                      <th className="status-col">状态</th>
                      <th>摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewChapters.map((chapter) => (
                      <tr key={chapter.chapter_index}>
                        <td>第 {chapter.chapter_index} 章</td>
                        <td><StatusPill status={chapter.status} /></td>
                        <td className="summary-cell">{chapterSummaryText(chapter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <L1Preview chapters={l1Chapters} />
            </>
          ) : (
            <div className="empty-state">
              <b>{l1Task ? "章节线索构建中，完成后这里可以按章查看与检索。" : "还没有章节线索。先在上方「构建状态」里发起构建。"}</b>
            </div>
          )}
        </Panel>
      </div>
    </section>
  );
}

/** 摘要列：优先文本摘要；路由版章节线索没有文本摘要时回退到路由信号统计。 */
function chapterSummaryText(chapter) {
  const text = chapter.summary || chapter.error_summary || "";
  if (text) return text;
  const entities = Array.isArray(chapter.route_entities) ? chapter.route_entities.length : 0;
  const signals = Array.isArray(chapter.signals) ? chapter.signals.length : 0;
  const keywords = Array.isArray(chapter.route_keywords) ? chapter.route_keywords : [];
  if (entities || signals || keywords.length) {
    const head = keywords.slice(0, 6).join("、");
    return `主体 ${entities} · 信号 ${signals}${head ? ` · ${head}` : ""}`;
  }
  return "-";
}
