import { useState } from "react";
import { Upload } from "lucide-react";
import { ImportPanel } from "../components/library/ImportPanel.jsx";
import { useAppContext } from "../context/appContext.js";
import { liveTasksForBook, useWorkbenchData } from "../hooks/useWorkbenchData.js";
import { navigate, paths } from "../router.js";
import { validChapterNumber } from "../utils/chapterRange.js";
import { taskProgressPercent } from "../utils/taskProgress.js";

const initialImportForm = {
  book_id: "",
  book_name: "",
  start_chapter: "1",
  end_chapter: "100",
  force: false,
  auto_l1_index: false
};

/**
 * 工作台（#/）：书籍总账表 + 导入新书入口。
 * 行 = 卷宗信息（书名/ID/章节数）+ L1 格 + L2 格；点击行进书籍，点格直达子页。
 */
export function WorkbenchPage({
  importTask,
  importBusy,
  l1Task,
  l2Task,
  analysisTask,
  onStartImport,
  onImportCancel,
  onImportPause,
  onImportResume
}) {
  const { books, config, setError } = useAppContext();
  const { aggregatesByBook, liveTasks } = useWorkbenchData({
    channelTasks: [importTask, l1Task, l2Task, analysisTask],
    setError
  });
  const [showImportForm, setShowImportForm] = useState(false);
  const [importForm, setImportForm] = useState(initialImportForm);

  async function startImport() {
    if (!validChapterNumber(importForm.start_chapter) || !validChapterNumber(importForm.end_chapter)) {
      setError("起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    const task = await onStartImport({
      ...importForm,
      start_chapter: Number(importForm.start_chapter),
      end_chapter: Number(importForm.end_chapter),
      auto_l1_index: Boolean(importForm.auto_l1_index)
    });
    if (task) setShowImportForm(false);
  }

  const sortedBooks = [...books].sort((a, b) => {
    const aLive = liveTasksForBook(liveTasks, a.book_id).length ? 0 : 1;
    const bLive = liveTasksForBook(liveTasks, b.book_id).length ? 0 : 1;
    return aLive - bLive;
  });

  return (
    <section className="workbench-page">
      <header className="page-hero">
        <div>
          <span>本地章节库</span>
          <h2>工作台</h2>
          <p>{books.length} 本书 · 点击行进入书籍，点击单元格直达 L1 / L2 管理</p>
        </div>
        <div className="page-hero-actions">
          <button className="secondary inline" type="button" onClick={() => setShowImportForm(true)} disabled={showImportForm}>
            <Upload size={16} />
            导入新书
          </button>
        </div>
      </header>

      {showImportForm || importTask ? (
        <ImportPanel
          books={books}
          showImportForm={showImportForm}
          onShowImportFormChange={setShowImportForm}
          importForm={importForm}
          onImportFormChange={setImportForm}
          importBusy={importBusy}
          difyConfigured={Boolean(config?.difyConfigured)}
          importTask={importTask}
          onStartImport={startImport}
          onCancel={onImportCancel}
          onPause={onImportPause}
          onResume={onImportResume}
        />
      ) : null}

      <div className="ledger">
        <div className="l-row l-head">
          <span>卷宗</span>
          <span>章节线索 L1</span>
          <span>事实索引 L2</span>
          <span />
        </div>
        {sortedBooks.map((book) => (
          <LedgerRow
            key={book.book_id}
            book={book}
            aggregate={aggregatesByBook.get(book.book_id) || null}
            tasks={liveTasksForBook(liveTasks, book.book_id)}
          />
        ))}
        {!books.length ? (
          <div className="empty-guide">
            <b>还没有书籍。</b>
            <span>先导入一本小说的章节原文，之后就能构建章节线索、事实索引并开始提问。</span>
          </div>
        ) : null}
        <button className="l-import" type="button" onClick={() => setShowImportForm(true)}>
          <Upload size={14} />
          <span>导入新书（填写小说 ID 与章节范围）</span>
        </button>
      </div>
    </section>
  );
}

function LedgerRow({ book, aggregate, tasks }) {
  const l1LiveTask = tasks.find((task) => task.type === "l1-index") || null;
  const l2LiveTask = tasks.find((task) => task.type === "l2-index") || null;
  const live = tasks.length > 0;
  const go = (event, path) => {
    event.stopPropagation();
    navigate(path);
  };
  return (
    <div className={`l-row l-book-row${live ? " live" : ""}`} onClick={() => navigate(paths.book(book.book_id))}>
      <div className="l-book">
        <span className="l-title">
          《{book.book_name || book.book_id}》
          {live ? <i className="live-dot" /> : null}
        </span>
        <span className="l-meta">NO.{book.book_id} · {book.chapter_count || 0} 回</span>
      </div>
      <L1Cell book={book} aggregate={aggregate} task={l1LiveTask} onOpen={(e) => go(e, paths.l1(book.book_id))} />
      <L2Cell aggregate={aggregate} task={l2LiveTask} onOpen={(e) => go(e, paths.l2(book.book_id))} />
      <span className="l-go">›</span>
    </div>
  );
}

function L1Cell({ book, aggregate, task, onOpen }) {
  const completed = Number(aggregate?.l1?.completed || 0);
  const failed = Number(aggregate?.l1?.failed || 0);
  const total = Number(book?.chapter_count || 0);
  if (task) {
    const percent = taskProgressPercent(task);
    return (
      <button className="l-cell" type="button" onClick={onOpen}>
        <span className="v run">构建中 {percent}%</span>
        <span className="tickbar"><i style={{ width: `${percent || 0}%` }} /></span>
        <span className="s">{task.progress?.current || "准备中"}</span>
      </button>
    );
  }
  if (total > 0 && completed >= total) {
    return (
      <button className="l-cell" type="button" onClick={onOpen}>
        <span className="v ok">已完成</span>
        <span className="s">{completed}/{total} 章</span>
      </button>
    );
  }
  if (completed > 0 || failed > 0) {
    return (
      <button className="l-cell" type="button" onClick={onOpen}>
        <span className="v">{completed}/{total} 章</span>
        <span className="s">{failed ? `失败 ${failed} 章 · 待继续` : "部分完成 · 待继续"}</span>
      </button>
    );
  }
  return (
    <button className="l-cell" type="button" onClick={onOpen}>
      <span className="v">未开始</span>
      <span className="s">原文就绪后可构建</span>
    </button>
  );
}

function L2Cell({ aggregate, task, onOpen }) {
  const groups = Number(aggregate?.index_groups || 0);
  const facts = Number(aggregate?.l2_facts || 0);
  if (task) {
    const percent = taskProgressPercent(task);
    return (
      <button className="l-cell" type="button" onClick={onOpen}>
        <span className="v run">构建中 {percent}%</span>
        <span className="tickbar"><i style={{ width: `${percent || 0}%` }} /></span>
        <span className="s">{groups} 个索引组 · {task.progress?.current || "准备中"}</span>
      </button>
    );
  }
  if (!groups) {
    return (
      <button className="l-cell" type="button" onClick={onOpen}>
        <span className="v">0 个索引组</span>
        <span className="s">章节线索完成后创建</span>
      </button>
    );
  }
  return (
    <button className="l-cell" type="button" onClick={onOpen}>
      <span className="v ok">{groups} 个索引组</span>
      <span className="s">已抽取事实 {facts} 条</span>
    </button>
  );
}
