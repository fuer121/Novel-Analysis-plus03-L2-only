import { useEffect, useRef, useState } from "react";
import { AlignLeft, Database, MessageCircle, Settings } from "lucide-react";
import { formatTime } from "../api.js";
import { EntryCard } from "../components/book/EntryCard.jsx";
import { BookSettingsPanel } from "../components/book/BookSettingsPanel.jsx";
import { NextStepPanel } from "../components/book/NextStepPanel.jsx";
import { taskProgressPercent } from "../utils/taskProgress.js";
import { useAppContext } from "../context/appContext.js";
import { liveTasksForBook, useWorkbenchData } from "../hooks/useWorkbenchData.js";
import { navigate, paths } from "../router.js";
import { deriveJourney, journeyInputForBook } from "../utils/journey.js";

/**
 * 书籍首页（#/book/:id）：书籍头部 + 三个入口卡（章节线索 L1 / 事实索引 L2 / 提问管理）
 * + 下一步建议 + 书籍设置。
 */
export function BookHomePage({
  bookId,
  importTask,
  l1Task,
  l2Task,
  analysisTask,
  onLoadBookIndexGroups,
  onSaveBookMeta
}) {
  const { books, setError } = useAppContext();
  const book = books.find((entry) => entry.book_id === bookId) || null;
  const { aggregatesByBook, liveTasks } = useWorkbenchData({
    channelTasks: [importTask, l1Task, l2Task, analysisTask],
    setError
  });
  const [indexGroups, setIndexGroups] = useState([]);
  const [showSettings, setShowSettings] = useState(false);

  const loadGroupsRef = useRef(onLoadBookIndexGroups);
  useEffect(() => {
    loadGroupsRef.current = onLoadBookIndexGroups;
  });

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    async function load() {
      try {
        const groups = await loadGroupsRef.current(bookId);
        if (!cancelled) setIndexGroups(groups);
      } catch (error) {
        if (!cancelled) setError(error.message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId, setError]);

  if (!book) return null;

  const aggregate = aggregatesByBook.get(bookId) || null;
  const bookTasks = liveTasksForBook(liveTasks, bookId);
  const journey = deriveJourney(journeyInputForBook({ book, aggregate, tasks: bookTasks }));
  const liveL1 = bookTasks.find((task) => task.type === "l1-index") || null;
  const liveL2 = bookTasks.find((task) => task.type === "l2-index") || null;

  const l1Stat = liveL1
    ? `${liveL1.progress?.current || "准备中"} · ${taskProgressPercent(liveL1)}%`
    : l1StatText(book, aggregate);
  const l2Stat = liveL2
    ? `${indexGroups.length} 个索引组 · 构建中 ${taskProgressPercent(liveL2)}%`
    : indexGroups.length
      ? `${indexGroups.length} 个索引组 · 事实 ${Number(aggregate?.l2_facts || 0)} 条`
      : "未创建索引组";
  const askCount = sumCounts(aggregate?.analyses);
  const askStat = askCount ? `${askCount} 个提问任务` : "暂无提问任务";

  return (
    <section className="book-home-page">
      <header className="page-hero">
        <div>
          <span>书籍首页</span>
          <h2>{book.book_name || book.book_id}</h2>
          <p>{book.book_id} · {book.chapter_count || 0} 章 · 更新于 {formatTime(book.updated_at)}</p>
        </div>
        <div className="page-hero-actions">
          <button className="secondary inline" type="button" onClick={() => setShowSettings((value) => !value)}>
            <Settings size={15} />
            书籍设置
          </button>
        </div>
      </header>

      {showSettings ? <BookSettingsPanel book={book} onSaveBookMeta={onSaveBookMeta} /> : null}

      <div className="entry-grid">
        <EntryCard
          icon={AlignLeft}
          title="章节线索"
          badge="L1"
          description="每章摘要：事件、出场角色、状态变化、钩子。提问与事实索引的基础。"
          stat={l1Stat}
          actionLabel="查看管理"
          running={Boolean(liveL1)}
          percent={taskProgressPercent(liveL1)}
          onClick={() => navigate(paths.l1(bookId))}
        />
        <EntryCard
          icon={Database}
          title="事实索引"
          badge="L2"
          description="结构化事实库：角色形象、势力、物品等索引组，可查看事实明细与构建任务。"
          stat={l2Stat}
          actionLabel="查看管理"
          running={Boolean(liveL2)}
          percent={taskProgressPercent(liveL2)}
          onClick={() => navigate(paths.l2(bookId))}
        />
        <EntryCard
          icon={MessageCircle}
          title="提问管理"
          description="基于章节线索与事实索引提问，管理进行中和历史的提问任务。"
          stat={askStat}
          actionLabel="进入提问"
          onClick={() => navigate(paths.ask(bookId))}
        />
      </div>

      <NextStepPanel
        journey={journey}
        onGo={(page) => navigate(paths[page](bookId))}
      />
    </section>
  );
}

function l1StatText(book, aggregate) {
  const completed = Number(aggregate?.l1?.completed || 0);
  const total = Number(book?.chapter_count || 0);
  if (total > 0 && completed >= total) return `已完成 ${completed}/${total} 章`;
  if (completed > 0) return `${completed}/${total} 章 · 待继续`;
  return "未开始";
}

function sumCounts(values = {}) {
  return Object.values(values || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}
