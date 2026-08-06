import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Stethoscope } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut } from "./api.js";
import { Breadcrumbs } from "./components/layout/Breadcrumbs.jsx";
import { TaskChip } from "./components/layout/TaskChip.jsx";
import { AppContextProvider } from "./context/appContext.js";
import { BASE_INDEX_GROUP_KEY, L2_INDEX_MODE_ALL, TASK_TYPES } from "./constants/index.js";
import { useTaskChannel } from "./hooks/useTaskChannel.js";
import { AskManagePage } from "./pages/AskManagePage.jsx";
import { BookHomePage } from "./pages/BookHomePage.jsx";
import { DiagnosticsPage } from "./pages/DiagnosticsPage.jsx";
import { L1ManagePage } from "./pages/L1ManagePage.jsx";
import { L2ManagePage } from "./pages/L2ManagePage.jsx";
import { L2GroupWizardPage } from "./pages/L2GroupWizardPage.jsx";
import { WorkbenchPage } from "./pages/WorkbenchPage.jsx";
import { navigate, paths, useRoute } from "./router.js";
import { breadcrumbParts } from "./utils/breadcrumbs.js";
import { LoadingScreen } from "./ui.jsx";

const BOOK_SCOPED_ROUTES = new Set(["book", "l1", "l2", "ask"]);

export default function App() {
  const { route, bookId } = useRoute();
  const [config, setConfig] = useState(null);
  const [books, setBooks] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const importChannel = useTaskChannel({
    type: TASK_TYPES.IMPORT,
    baseUrl: (taskId) => `/api/imports/${encodeURIComponent(taskId)}`,
    startRequest: (importForm) => apiPost("/api/books/imports", importForm).then((data) => data.task),
    failureMessage: "导入失败",
    ready: !busy,
    setError,
    onCancelled: () => reloadBooks(),
    onTerminal: async (finishedTask, options = {}) => {
      try {
        await reloadBooks();
      } catch (reloadError) {
        setError(reloadError.message);
      }
      if (finishedTask.status === "completed" && options.autoL1) {
        await startL1Index({
          bookId: finishedTask.payload?.bookId || options.autoL1.bookId,
          startChapter: finishedTask.payload?.startChapter || options.autoL1.startChapter,
          endChapter: finishedTask.payload?.endChapter || options.autoL1.endChapter
        });
      }
    }
  });

  const l1Channel = useTaskChannel({
    type: TASK_TYPES.L1_INDEX,
    baseUrl: (taskId) => `/api/l1-indexes/${encodeURIComponent(taskId)}`,
    startRequest: ({ bookId, startChapter, endChapter, force = false }) => apiPost(`/api/books/${encodeURIComponent(bookId)}/l1-indexes`, {
      start_chapter: startChapter,
      end_chapter: endChapter,
      force
    }).then((data) => data.task),
    failureMessage: "章节线索准备失败",
    ready: !busy,
    setError
  });

  const l2Channel = useTaskChannel({
    type: TASK_TYPES.L2_INDEX,
    baseUrl: (taskId) => `/api/l2-indexes/${encodeURIComponent(taskId)}`,
    startRequest: ({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, startChapter, endChapter, force = false, mode = L2_INDEX_MODE_ALL }) => apiPost(`/api/books/${encodeURIComponent(bookId)}/l2-indexes`, {
      start_chapter: startChapter,
      end_chapter: endChapter,
      index_group_key: indexGroupKey,
      force,
      mode
    }).then((data) => data.task),
    failureMessage: "事实索引准备失败",
    ready: !busy,
    setError
  });

  const analysisChannel = useTaskChannel({
    type: TASK_TYPES.ANALYSIS,
    baseUrl: (taskId) => `/api/analyses/${encodeURIComponent(taskId)}`,
    startRequest: (payload) => apiPost("/api/analyses", payload).then((data) => data.task),
    failureMessage: "分析失败",
    ready: !busy,
    setError,
    onTerminal: (finishedTask, options = {}) => options.onTerminal?.(finishedTask)
  });

  const importTask = importChannel.task;
  const importBusy = importChannel.busy;
  const l1Task = l1Channel.task;
  const l1Busy = l1Channel.busy;
  const l2Task = l2Channel.task;
  const l2Busy = l2Channel.busy;
  const analysisTask = analysisChannel.task;
  const analysisBusy = analysisChannel.busy;

  // 未知路径与旧 hash 路由（#/library、#/analysis、#/prompts）显式重定向到 #/
  useEffect(() => {
    if (route === null) navigate(paths.workbench(), { replace: true });
  }, [route]);
  const activeRoute = route || "workbench";

  // 旧 pathname 路由（/library、/analysis、/prompts 由 server SPA 兜底送达）一次性归一到 hash 路由
  useEffect(() => {
    if (window.location.pathname !== "/") {
      window.history.replaceState({}, "", `/${window.location.hash || "#/"}`);
    }
  }, []);

  // 当前书由路由承载：书不存在（含被删除）时回工作台
  useEffect(() => {
    if (busy) return;
    if (!BOOK_SCOPED_ROUTES.has(activeRoute)) return;
    if (bookId && !books.some((book) => book.book_id === bookId)) {
      navigate(paths.workbench(), { replace: true });
    }
  }, [busy, activeRoute, bookId, books]);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [configData, booksData] = await Promise.all([
        apiGet("/api/config"),
        apiGet("/api/books")
      ]);
      setConfig(configData.runtime);
      setBooks(booksData.books || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  const reloadBooks = useCallback(async () => {
    const data = await apiGet("/api/books");
    setBooks(data.books || []);
    return data.books || [];
  }, []);

  async function createBook(payload) {
    const data = await apiPost("/api/books", payload);
    await reloadBooks();
    return data.book;
  }

  async function loadBookIndexPrompts(bookId) {
    const data = await apiGet(`/api/books/${encodeURIComponent(bookId)}/index-prompts`);
    return data;
  }

  async function loadBookIndexGroups(bookId) {
    const data = await apiGet(`/api/books/${encodeURIComponent(bookId)}/index-groups?include_stats=1`);
    return data.indexGroups || [];
  }

  async function createBookIndexGroup(bookId, payload) {
    const data = await apiPost(`/api/books/${encodeURIComponent(bookId)}/index-groups`, payload);
    return data.indexGroup;
  }

  async function updateBookIndexGroup(bookId, groupKey, payload) {
    const data = await apiPut(`/api/books/${encodeURIComponent(bookId)}/index-groups/${encodeURIComponent(groupKey)}`, payload);
    return data.indexGroup;
  }

  async function deleteBookIndexGroup(bookId, groupKey) {
    return apiDelete(`/api/books/${encodeURIComponent(bookId)}/index-groups/${encodeURIComponent(groupKey)}`);
  }

  async function saveBookIndexPrompts(bookId, payload) {
    const data = await apiPut(`/api/books/${encodeURIComponent(bookId)}/index-prompts`, payload);
    return data.indexPrompts;
  }

  function startImport(importForm) {
    const autoL1 = importForm.auto_l1_index
      ? {
        bookId: importForm.book_id,
        startChapter: importForm.start_chapter,
        endChapter: importForm.end_chapter
      }
      : null;
    return importChannel.start(importForm, { autoL1 });
  }

  function startL1Index(options) {
    return l1Channel.start(options);
  }

  function startL2Index(options) {
    return l2Channel.start(options);
  }

  function startAnalysis(payload, options = {}) {
    return analysisChannel.start(payload, options);
  }

  function resumeAnalysisRun(id, options = {}) {
    if (!id) return Promise.resolve(null);
    if (analysisChannel.busy && analysisChannel.task?.id === id) return Promise.resolve(analysisChannel.task);
    return analysisChannel.launch(
      () => apiPost(`/api/analyses/${encodeURIComponent(id)}/resume-run`, {}).then((data) => data.task),
      options
    );
  }

  const appContextValue = useMemo(() => ({
    config,
    books,
    reloadBooks,
    setError
  }), [config, books, reloadBooks]);

  const currentBookName = books.find((book) => book.book_id === bookId)?.book_name || "";
  const bookNameOf = (id) => books.find((book) => book.book_id === id)?.book_name || id || "";

  if (!busy && !config && error) {
    return (
      <main className="boot">
        <div className="boot-card">
          <section className="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </section>
          <div className="action-row">
            <button className="primary inline" type="button" onClick={() => void loadAll()}>
              重试
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (busy || !config) {
    return <LoadingScreen />;
  }

  const importBookId = importTask?.payload?.bookId || "";
  const l1BookId = l1Task?.payload?.bookId || "";
  const l2BookId = l2Task?.payload?.bookId || "";
  const analysisBookId = analysisTask?.payload?.bookId || "";

  return (
    <main className="app-shell">
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => navigate(paths.workbench())} title="回到工作台">
          <span className="brand-text">
            <h1>小说分析台</h1>
            <p>本地库 · 索引 · 提问</p>
          </span>
        </button>
        <Breadcrumbs parts={breadcrumbParts({ route: activeRoute, bookId, bookName: currentBookName })} />
        <div className="topbar-right">
          <div className="background-task-stack">
            {importBusy && importTask ? (
              <TaskChip
                task={importTask}
                typeLabel="导入"
                bookName={bookNameOf(importBookId)}
                statusText={progressText(importTask, "后台导入中")}
                onClick={() => navigate(importBookId ? paths.book(importBookId) : paths.workbench())}
              />
            ) : null}
            {l1Busy && l1Task ? (
              <TaskChip
                task={l1Task}
                typeLabel="章节线索"
                bookName={bookNameOf(l1BookId)}
                statusText={progressText(l1Task, "章节线索准备中")}
                onClick={() => l1BookId && navigate(paths.l1(l1BookId))}
              />
            ) : null}
            {l2Busy && l2Task ? (
              <TaskChip
                task={l2Task}
                typeLabel="事实索引"
                bookName={bookNameOf(l2BookId)}
                statusText={progressText(l2Task, "事实索引准备中")}
                onClick={() => l2BookId && navigate(paths.l2(l2BookId))}
              />
            ) : null}
            {analysisBusy && analysisTask ? (
              <TaskChip
                task={analysisTask}
                typeLabel="提问"
                bookName={bookNameOf(analysisBookId)}
                statusText={progressText(analysisTask, "后台提问中")}
                onClick={() => analysisBookId && navigate(paths.ask(analysisBookId))}
              />
            ) : null}
          </div>
          <button
            className="icon-button"
            type="button"
            title="诊断"
            aria-label="诊断"
            onClick={() => navigate(paths.diagnostics())}
          >
            <Stethoscope size={17} />
          </button>
        </div>
      </header>

      <section className="app-main" id="main-content">
        {error ? (
          <section className="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </section>
        ) : null}

        <AppContextProvider value={appContextValue}>
          {activeRoute === "workbench" ? (
            <WorkbenchPage
              importTask={importTask}
              importBusy={importBusy}
              l1Task={l1Task}
              l2Task={l2Task}
              analysisTask={analysisTask}
              onStartImport={startImport}
              onImportCancel={() => importChannel.control("cancel")}
              onImportPause={() => importChannel.control("pause")}
              onImportResume={() => importChannel.control("resume")}
            />
          ) : activeRoute === "book" ? (
            <BookHomePage
              key={bookId}
              bookId={bookId}
              importTask={importTask}
              l1Task={l1Task}
              l2Task={l2Task}
              analysisTask={analysisTask}
              onLoadBookIndexGroups={loadBookIndexGroups}
              onSaveBookMeta={createBook}
            />
          ) : activeRoute === "l1" ? (
            <L1ManagePage
              key={bookId}
              bookId={bookId}
              l1Task={l1Task}
              l1Busy={l1Busy}
              onStartL1Index={startL1Index}
              onL1Cancel={() => l1Channel.control("cancel")}
              onL1Pause={() => l1Channel.control("pause")}
              onL1Resume={() => l1Channel.control("resume")}
              onLoadBookIndexPrompts={loadBookIndexPrompts}
              onSaveBookIndexPrompts={saveBookIndexPrompts}
            />
          ) : activeRoute === "l2" ? (
            <L2ManagePage
              key={bookId}
              bookId={bookId}
              l2Task={l2Task}
              l2Busy={l2Busy}
              onStartL2Index={startL2Index}
              onL2Cancel={() => l2Channel.control("cancel")}
              onL2Pause={() => l2Channel.control("pause")}
              onL2Resume={() => l2Channel.control("resume")}
              onLoadBookIndexPrompts={loadBookIndexPrompts}
              onLoadBookIndexGroups={loadBookIndexGroups}
              onCreateBookIndexGroup={createBookIndexGroup}
              onUpdateBookIndexGroup={updateBookIndexGroup}
              onDeleteBookIndexGroup={deleteBookIndexGroup}
            />
          ) : activeRoute === "l2-new" ? (
            <L2GroupWizardPage
              key={bookId}
              bookId={bookId}
              l2Task={l2Task}
              l2Busy={l2Busy}
              onStartL2Index={startL2Index}
              onL2Cancel={() => l2Channel.control("cancel")}
              onL2Pause={() => l2Channel.control("pause")}
              onL2Resume={() => l2Channel.control("resume")}
              onLoadBookIndexGroups={loadBookIndexGroups}
              onCreateBookIndexGroup={createBookIndexGroup}
              onUpdateBookIndexGroup={updateBookIndexGroup}
            />
          ) : activeRoute === "ask" ? (
            <AskManagePage
              key={bookId}
              bookId={bookId}
              onLoadBookIndexGroups={loadBookIndexGroups}
              analysisTask={analysisTask}
              analysisBusy={analysisBusy}
              onStartAnalysis={startAnalysis}
              onResumeAnalysisRun={resumeAnalysisRun}
              onAnalysisCancel={() => analysisChannel.control("cancel")}
              onAnalysisPause={() => analysisChannel.control("pause")}
              onAnalysisResume={() => analysisChannel.control("resume")}
            />
          ) : (
            <DiagnosticsPage />
          )}
        </AppContextProvider>
      </section>
    </main>
  );
}

function progressText(task, fallback) {
  const progress = task?.progress || {};
  if (progress.total) {
    return `${progress.completed || 0}/${progress.total} · ${progress.current || fallback}`;
  }
  return progress.current || fallback;
}
