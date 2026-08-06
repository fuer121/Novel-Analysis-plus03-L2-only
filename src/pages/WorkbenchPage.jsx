import { useState } from "react";
import { ArrowRight, Upload } from "lucide-react";
import { formatTime } from "../api.js";
import { ImportPanel } from "../components/library/ImportPanel.jsx";
import { ProgressBar } from "../components/ProgressBar.jsx";
import { useAppContext } from "../context/appContext.js";
import { liveTasksForBook, useWorkbenchData } from "../hooks/useWorkbenchData.js";
import { navigate, paths } from "../router.js";
import { validChapterNumber } from "../utils/chapterRange.js";
import { deriveJourney, journeyInputForBook } from "../utils/journey.js";
import { taskProgressPercent } from "../utils/taskProgress.js";
import { taskDisplayName } from "../constants/index.js";

const initialImportForm = {
  book_id: "",
  book_name: "",
  start_chapter: "1",
  end_chapter: "100",
  force: false,
  auto_l1_index: false
};

/**
 * 工作台（#/）：书籍一级卡片列表 + 导入新书入口。
 * 卡片 = 基础信息 + L1 状态 + L2 索引组数 + 进行中任务 + 下一步（journey.js）。
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

  return (
    <section className="workbench-page">
      <header className="page-hero">
        <div>
          <span>本地章节库</span>
          <h2>工作台</h2>
          <p>{books.length} 本书 · 点击书籍进入索引与提问管理</p>
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

      <div className="book-list">
        {books.map((book) => (
          <BookCard
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
        <button className="import-card" type="button" onClick={() => setShowImportForm(true)}>
          <Upload size={20} />
          <span>导入新书（填写小说 ID 与章节范围）</span>
        </button>
      </div>
    </section>
  );
}

function BookCard({ book, aggregate, tasks }) {
  const journey = deriveJourney(journeyInputForBook({ book, aggregate, tasks }));
  const l1Task = tasks.find((task) => task.type === "l1-index") || null;
  const l2Task = tasks.find((task) => task.type === "l2-index") || null;
  const runningTask = tasks[0] || null;
  return (
    <article className="book-card" onClick={() => navigate(paths.book(book.book_id))}>
      <div className="book-card-top">
        <div>
          <h3>{book.book_name || book.book_id}</h3>
          <div className="book-card-meta">
            {book.book_id} · {book.chapter_count || 0} 章 · 更新于 {formatTime(book.updated_at)}
          </div>
        </div>
        <span className="entry-go">进入书籍<ArrowRight size={13} /></span>
      </div>
      <div className="book-card-stats">
        <L1StatusBox book={book} aggregate={aggregate} task={l1Task} />
        <L2StatusBox aggregate={aggregate} task={l2Task} />
        <RunningTaskBox task={runningTask} />
      </div>
      <div className="book-card-foot">
        <span className="book-card-next">下一步：<b>{journey.stage}</b> · {journey.note}</span>
      </div>
    </article>
  );
}

function L1StatusBox({ book, aggregate, task }) {
  const completed = Number(aggregate?.l1?.completed || 0);
  const failed = Number(aggregate?.l1?.failed || 0);
  const total = Number(book?.chapter_count || 0);
  if (task) {
    const percent = taskProgressPercent(task);
    return (
      <div className="stat-box">
        <span className="stat-key">章节线索<span className="badge">L1</span></span>
        <span className="stat-value info">构建中 {percent}%</span>
        <ProgressBar percent={percent} tone="info" label="章节线索" />
        <span className="stat-sub">{task.progress?.current || "准备中"}</span>
      </div>
    );
  }
  if (total > 0 && completed >= total) {
    return (
      <div className="stat-box">
        <span className="stat-key">章节线索<span className="badge">L1</span></span>
        <span className="stat-value ok">已完成</span>
        <span className="stat-sub">{completed}/{total} 章</span>
      </div>
    );
  }
  if (completed > 0 || failed > 0) {
    return (
      <div className="stat-box">
        <span className="stat-key">章节线索<span className="badge">L1</span></span>
        <span className="stat-value">{completed}/{total} 章</span>
        <span className="stat-sub">{failed ? `失败 ${failed} 章 · 待继续` : "部分完成 · 待继续"}</span>
      </div>
    );
  }
  return (
    <div className="stat-box">
      <span className="stat-key">章节线索<span className="badge">L1</span></span>
      <span className="stat-value">未开始</span>
      <span className="stat-sub">原文就绪后可构建</span>
    </div>
  );
}

function L2StatusBox({ aggregate, task }) {
  const groups = Number(aggregate?.index_groups || 0);
  const facts = Number(aggregate?.l2_facts || 0);
  if (task) {
    const percent = taskProgressPercent(task);
    return (
      <div className="stat-box">
        <span className="stat-key">事实索引<span className="badge">L2</span></span>
        <span className="stat-value info">构建中 {percent}%</span>
        <ProgressBar percent={percent} tone="info" label="事实索引" />
        <span className="stat-sub">{groups} 个索引组 · {task.progress?.current || "准备中"}</span>
      </div>
    );
  }
  if (!groups) {
    return (
      <div className="stat-box">
        <span className="stat-key">事实索引<span className="badge">L2</span></span>
        <span className="stat-value">0 个索引组</span>
        <span className="stat-sub">章节线索完成后创建</span>
      </div>
    );
  }
  return (
    <div className="stat-box">
      <span className="stat-key">事实索引<span className="badge">L2</span></span>
      <span className="stat-value ok">{groups} 个索引组</span>
      <span className="stat-sub">已抽取事实 {facts} 条</span>
    </div>
  );
}

function RunningTaskBox({ task }) {
  if (!task) {
    return (
      <div className="stat-box">
        <span className="stat-key">进行中的任务</span>
        <span className="stat-value">无</span>
        <span className="stat-sub">当前没有后台任务</span>
      </div>
    );
  }
  const percent = taskProgressPercent(task);
  return (
    <div className="stat-box">
      <span className="stat-key">进行中的任务</span>
      <span className="stat-value info">{taskDisplayName(task.type)} {percent}%</span>
      <ProgressBar percent={percent} tone="info" label={taskDisplayName(task.type)} />
      <span className="stat-sub">{task.progress?.current || "进行中"}</span>
    </div>
  );
}
