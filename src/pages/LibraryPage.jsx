import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Database,
  Layers,
  Loader2,
  Play,
  RefreshCcw,
  Trash2
} from "lucide-react";
import { apiGet, apiPost, formatTime } from "../api.js";
import { IconButton, Panel, StatusPill, TaskBox } from "../ui.jsx";

const initialImportForm = {
  book_id: "",
  book_name: "",
  start_chapter: "1",
  end_chapter: "100",
  force: false
};

const L2_CATEGORIES = [
  { value: "character", label: "人物" },
  { value: "relationship", label: "关系" },
  { value: "cultivation", label: "境界" },
  { value: "force", label: "势力" },
  { value: "item", label: "物品" },
  { value: "location", label: "地点" },
  { value: "event", label: "事件" },
  { value: "foreshadowing", label: "伏笔" },
  { value: "other", label: "其他" }
];

export function LibraryPage({
  books,
  config,
  importTask,
  importBusy,
  l1Task,
  l1Busy,
  l2Task,
  l2Busy,
  onStartImport,
  onStartL1Index,
  onStartL2Index,
  onLoadBookIndexGroups,
  onImportCancel,
  onImportPause,
  onImportResume,
  onL1Cancel,
  onL1Pause,
  onL1Resume,
  onL2Cancel,
  onL2Pause,
  onL2Resume,
  onBooksChanged,
  setError
}) {
  const initialBookId = importTask?.payload?.bookId || books[0]?.book_id || "";
  const [selectedBookId, setSelectedBookId] = useState(initialBookId);
  const [l1Coverage, setL1Coverage] = useState(null);
  const [l1Chapters, setL1Chapters] = useState([]);
  const [l2Coverage, setL2Coverage] = useState(null);
  const [l2Facts, setL2Facts] = useState([]);
  const [indexGroups, setIndexGroups] = useState([]);
  const [selectedIndexGroupKey, setSelectedIndexGroupKey] = useState("base");
  const [showImportForm, setShowImportForm] = useState(false);
  const [importForm, setImportForm] = useState({
    ...initialImportForm,
    book_id: initialBookId,
    auto_l1_index: false
  });
  const [l1Form, setL1Form] = useState({ start_chapter: "1", end_chapter: "100", force: false });
  const [l2Form, setL2Form] = useState({ start_chapter: "1", end_chapter: "100", force: false });
  const selectedBook = useMemo(
    () => books.find((book) => book.book_id === selectedBookId) || null,
    [books, selectedBookId]
  );
  const boundBook = useMemo(
    () => books.find((book) => book.book_id === importForm.book_id.trim()) || null,
    [books, importForm.book_id]
  );
  const coverageRange = useMemo(() => coverageRangeForBook(selectedBook), [selectedBook]);
  const selectedIndexGroup = useMemo(
    () => indexGroups.find((group) => group.group_key === selectedIndexGroupKey) || null,
    [indexGroups, selectedIndexGroupKey]
  );
  const l1ProviderReady = Boolean(config?.difyL1Configured);
  const l2ProviderReady = Boolean(config?.difyL2Configured);

  const loadL1Data = useCallback(async (bookId, startChapter, endChapter) => {
    if (!validChapterNumber(startChapter) || !validChapterNumber(endChapter)) return;
    try {
      const query = `start_chapter=${encodeURIComponent(startChapter)}&end_chapter=${encodeURIComponent(endChapter)}`;
      const [coverageData, chaptersData] = await Promise.all([
        apiGet(`/api/books/${encodeURIComponent(bookId)}/l1-indexes/coverage?${query}`),
        apiGet(`/api/books/${encodeURIComponent(bookId)}/l1-indexes/chapters?${query}`)
      ]);
      setL1Coverage(coverageData.coverage);
      setL1Chapters(chaptersData.chapters || []);
    } catch (error) {
      setError(error.message);
    }
  }, [setError]);

  const loadL2Data = useCallback(async (bookId, startChapter, endChapter, indexGroupKey = "base") => {
    if (!validChapterNumber(startChapter) || !validChapterNumber(endChapter)) return;
    try {
      const query = `start_chapter=${encodeURIComponent(startChapter)}&end_chapter=${encodeURIComponent(endChapter)}&index_group_key=${encodeURIComponent(indexGroupKey)}&limit=80`;
      const [coverageData, factsData] = await Promise.all([
        apiGet(`/api/books/${encodeURIComponent(bookId)}/l2-indexes/coverage?${query}`),
        apiGet(`/api/books/${encodeURIComponent(bookId)}/l2-facts?${query}`)
      ]);
      setL2Coverage(coverageData.coverage);
      setL2Facts(factsData.facts || []);
    } catch (error) {
      setError(error.message);
    }
  }, [setError]);

  const loadIndexGroups = useCallback(async (bookId) => {
    if (!bookId) {
      setIndexGroups([]);
      setSelectedIndexGroupKey("base");
      return;
    }
    try {
      const groups = await onLoadBookIndexGroups(bookId);
      setIndexGroups(groups);
      setSelectedIndexGroupKey((current) => (
        groups.some((group) => group.group_key === current) ? current : "base"
      ));
    } catch (error) {
      setError(error.message);
    }
  }, [onLoadBookIndexGroups, setError]);

  async function loadChapters(bookId) {
    if (!bookId) {
      return;
    }
    setError("");
    try {
      const data = await apiGet(`/api/books/${encodeURIComponent(bookId)}/chapters`);
      const first = data.chapters?.[0]?.chapter_index || 1;
      const last = data.chapters?.[data.chapters.length - 1]?.chapter_index || 100;
      setL1Form((form) => ({ ...form, start_chapter: String(first), end_chapter: String(last) }));
      setL2Form((form) => ({ ...form, start_chapter: String(first), end_chapter: String(last) }));
    } catch (error) {
      setError(error.message);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChapters(selectedBookId);
    void loadIndexGroups(selectedBookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookId]);

  useEffect(() => {
    const taskBookId = importTask?.payload?.bookId;
    if (!taskBookId || taskBookId !== selectedBookId || importTask?.status !== "completed") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadChapters(taskBookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importTask?.id, importTask?.status, selectedBookId]);

  useEffect(() => {
    if (!selectedBookId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadL1Data(selectedBookId, coverageRange.startChapter, coverageRange.endChapter);
  }, [selectedBookId, coverageRange.startChapter, coverageRange.endChapter, l1Task?.id, l1Task?.status, loadL1Data]);

  useEffect(() => {
    if (!selectedBookId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadL2Data(selectedBookId, coverageRange.startChapter, coverageRange.endChapter, selectedIndexGroupKey);
  }, [selectedBookId, selectedIndexGroupKey, coverageRange.startChapter, coverageRange.endChapter, l2Task?.id, l2Task?.status, loadL2Data]);

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
    const taskBookId = task?.payload?.bookId || importForm.book_id;
    if (taskBookId) setSelectedBookId(taskBookId);
  }

  async function startL1Index() {
    if (!selectedBookId) {
      setError("请先选择一本书。");
      return;
    }
    if (!validChapterNumber(l1Form.start_chapter) || !validChapterNumber(l1Form.end_chapter)) {
      setError("章节线索起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    await onStartL1Index({
      bookId: selectedBookId,
      startChapter: Number(l1Form.start_chapter),
      endChapter: Number(l1Form.end_chapter),
      force: l1Form.force
    });
  }

  async function startL2Index() {
    if (!selectedBookId) {
      setError("请先选择一本书。");
      return;
    }
    if (!validChapterNumber(l2Form.start_chapter) || !validChapterNumber(l2Form.end_chapter)) {
      setError("事实索引起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    await onStartL2Index({
      bookId: selectedBookId,
      indexGroupKey: selectedIndexGroupKey,
      startChapter: Number(l2Form.start_chapter),
      endChapter: Number(l2Form.end_chapter),
      force: l2Form.force,
      mode: "all"
    });
  }

  async function deleteSelectedBook() {
    if (!selectedBookId) return;
    const label = selectedBook?.book_name || selectedBookId;
    const confirmed = window.confirm(`删除本地加密章节库中的《${label}》？`);
    if (!confirmed) return;
    setError("");
    try {
      await apiPost(`/api/books/${encodeURIComponent(selectedBookId)}/delete`, {});
      setSelectedBookId("");
      await onBooksChanged();
    } catch (error) {
      setError(error.message);
    }
  }

  function selectBook(bookId) {
    const book = books.find((entry) => entry.book_id === bookId);
    setSelectedBookId(bookId);
    setImportForm((form) => ({ ...form, book_id: bookId, book_name: book?.book_name || "" }));
  }

  function updateBookId(bookId) {
    const book = books.find((entry) => entry.book_id === bookId.trim());
    setImportForm({
      ...importForm,
      book_id: bookId,
      book_name: book?.book_name || ""
    });
  }

  function openPromptManager(section = "index") {
    if (!selectedBookId) return;
    window.history.pushState({}, "", `/prompts?book_id=${encodeURIComponent(selectedBookId)}&section=${encodeURIComponent(section)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <section className="library-layout library-workspace">
      <header className="page-hero">
        <div>
          <span>书库工作台</span>
          <h2>书籍索引管理</h2>
          <p>导入章节、准备章节线索和事实索引。普通运营只需要看索引是否够用，高级规则在模板管理中维护。</p>
        </div>
        <div className="page-hero-actions">
          <button className="secondary inline" type="button" onClick={() => openPromptManager("index")} disabled={!selectedBookId}>
            管理索引规则
          </button>
        </div>
      </header>

      <div className="library-shell-grid">
        <aside className="library-left-column">
          <Panel
            className="library-directory-panel"
            icon={Database}
            title="本地书库"
            action={<IconButton icon={RefreshCcw} label="刷新" onClick={onBooksChanged} />}
          >
            <LibraryDirectory
              books={books}
              selectedBookId={selectedBookId}
              onSelect={selectBook}
              onDeleteSelected={deleteSelectedBook}
            />
          </Panel>
          <Panel
            className="library-import-panel"
            icon={BookOpen}
            title="导入"
          >
            {!showImportForm ? (
              <button className="secondary compact-action" type="button" onClick={() => setShowImportForm(true)}>
                <BookOpen size={16} />
                导入新章节
              </button>
            ) : (
              <>
                <div className="form-grid import-form-grid">
                  <label>
                    <span>书籍名称</span>
                    <input
                      value={boundBook?.book_name || importForm.book_name}
                      disabled={Boolean(boundBook?.book_name)}
                      placeholder="例如：凡人修仙传"
                      onChange={(event) => setImportForm({ ...importForm, book_name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>小说 ID</span>
                    <input
                      value={importForm.book_id}
                      onChange={(event) => updateBookId(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>起始章节</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={importForm.start_chapter}
                      onChange={(event) => setImportForm({ ...importForm, start_chapter: sanitizeChapterInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>结束章节</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={importForm.end_chapter}
                      onChange={(event) => setImportForm({ ...importForm, end_chapter: sanitizeChapterInput(event.target.value) })}
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={importForm.force}
                      onChange={(event) => setImportForm({ ...importForm, force: event.target.checked })}
                    />
                    <span>覆盖已有章节</span>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={importForm.auto_l1_index}
                      onChange={(event) => setImportForm({ ...importForm, auto_l1_index: event.target.checked })}
                    />
                    <span>完成后准备章节线索</span>
                  </label>
                </div>
                <div className="action-row wrap">
                  <button className="primary inline" type="button" onClick={startImport} disabled={importBusy || !config.difyConfigured}>
                    {importBusy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                    {importBusy ? "导入中" : "开始导入"}
                  </button>
                  <button className="secondary inline" type="button" onClick={() => setShowImportForm(false)} disabled={importBusy}>
                    收起
                  </button>
                </div>
              </>
            )}
            <TaskBox
              task={importTask}
              onCancel={onImportCancel}
              onPause={onImportPause}
              onResume={onImportResume}
            />
          </Panel>
        </aside>

        <section className="library-detail-column">
          <SelectedBookSummary book={selectedBook} />
          <MaterialReadiness
            book={selectedBook}
            l1Coverage={l1Coverage}
            l2Coverage={l2Coverage}
            selectedIndexGroup={selectedIndexGroup}
            onOpenPromptManager={() => openPromptManager("index")}
          />
          <div className="index-workgrid">
            <Panel
              icon={Layers}
              title="章节线索"
              className="index-work-panel"
              action={(
                <button className="secondary inline" type="button" onClick={() => openPromptManager("index")} disabled={!selectedBookId}>
                  规则
                </button>
              )}
            >
              <div className="form-grid compact">
                <label>
                  <span>起始章节</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l1Form.start_chapter}
                    onChange={(event) => setL1Form({ ...l1Form, start_chapter: sanitizeChapterInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>结束章节</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l1Form.end_chapter}
                    onChange={(event) => setL1Form({ ...l1Form, end_chapter: sanitizeChapterInput(event.target.value) })}
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={l1Form.force}
                    onChange={(event) => setL1Form({ ...l1Form, force: event.target.checked })}
                  />
                  <span>强制重建</span>
                </label>
              </div>
              <CoverageSummary coverage={l1Coverage} chapters={l1Chapters} />
              <div className="index-action-bar">
                <button className="primary inline" type="button" onClick={startL1Index} disabled={l1Busy || !selectedBookId || !l1ProviderReady}>
                  {l1Busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                  {l1Busy ? "准备中" : "准备章节线索"}
                </button>
              </div>
              {l1Task ? (
                <TaskBox
                  task={l1Task}
                  onCancel={onL1Cancel}
                  onPause={onL1Pause}
                  onResume={onL1Resume}
                />
              ) : null}
              <L1Preview chapters={l1Chapters} />
            </Panel>

            <Panel
              icon={Database}
              title="事实索引"
              className="index-work-panel"
              action={(
                <button className="secondary inline" type="button" onClick={() => openPromptManager("index")} disabled={!selectedBookId}>
                  规则
                </button>
              )}
            >
              <div className="form-grid compact">
                <label>
                  <span>事实索引</span>
                  <select
                    value={selectedIndexGroupKey}
                    onChange={(event) => setSelectedIndexGroupKey(event.target.value)}
                  >
                    {indexGroups.map((group) => (
                      <option key={group.group_key} value={group.group_key}>
                        {factIndexName(group)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>起始章节</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l2Form.start_chapter}
                    onChange={(event) => setL2Form({ ...l2Form, start_chapter: sanitizeChapterInput(event.target.value) })}
                  />
                </label>
                <label>
                  <span>结束章节</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={l2Form.end_chapter}
                    onChange={(event) => setL2Form({ ...l2Form, end_chapter: sanitizeChapterInput(event.target.value) })}
                  />
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={l2Form.force}
                    onChange={(event) => setL2Form({ ...l2Form, force: event.target.checked })}
                  />
                  <span>强制重建</span>
                </label>
              </div>
              <L2CoverageSummary coverage={l2Coverage} />
              <div className="index-action-bar">
                <button className="primary inline" type="button" onClick={() => startL2Index()} disabled={l2Busy || !selectedBookId || !l2ProviderReady}>
                  {l2Busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                  {l2Busy ? "准备中" : `准备 ${selectedIndexGroup ? factIndexName(selectedIndexGroup) : "事实索引"}`}
                </button>
              </div>
              {l2Task ? (
                <TaskBox
                  task={l2Task}
                  onCancel={onL2Cancel}
                  onPause={onL2Pause}
                  onResume={onL2Resume}
                />
              ) : null}
              <L2FactPreview facts={l2Facts} chapterIndex={l1Chapters[0]?.chapter_index} />
            </Panel>
          </div>
        </section>
      </div>
    </section>
  );
}

function SelectedBookSummary({ book }) {
  if (!book) return <div className="selected-book-summary empty-state">选择一本书查看索引状态</div>;
  return (
    <section className="selected-book-summary">
      <div>
        <span>当前书籍</span>
        <h3>{book.book_name || book.book_id}</h3>
        <p>{book.book_id}</p>
      </div>
      <div className="summary-metrics">
        <span>{book.chapter_count || 0} 章</span>
        <span>{chapterRange(book)}</span>
        <span>{book.last_import_status || "idle"}</span>
      </div>
    </section>
  );
}

function MaterialReadiness({ book, l1Coverage, l2Coverage, selectedIndexGroup, onOpenPromptManager }) {
  if (!book) return null;
  const imported = Number(book.chapter_count || 0);
  const l1Ratio = coveragePercent(l1Coverage);
  const l2Ratio = coveragePercent(l2Coverage);
  const factIndex = selectedIndexGroup ? factIndexName(selectedIndexGroup) : "事实索引";
  const l1Missing = Number(l1Coverage?.chapters?.missing || 0);
  const l2Missing = Number(l2Coverage?.chapters?.missing || 0);
  const l2Facts = Number(l2Coverage?.chapters?.facts || 0);
  const readyLevel = materialReadinessLevel({ imported, l1Ratio, l2Ratio, l2Facts });
  return (
    <section className={`material-readiness ${readyLevel.tone}`}>
      <div className="material-readiness-head">
        <div>
          <span>索引准备状态</span>
          <h3>{readyLevel.title}</h3>
          <p>{readyLevel.description}</p>
        </div>
        <button className="secondary inline" type="button" onClick={onOpenPromptManager}>
          管理事实索引
        </button>
      </div>
      <div className="material-step-grid">
        <MaterialStep label="章节已导入" value={`${imported} 章`} state={imported ? "ready" : "todo"} />
        <MaterialStep
          label="章节线索"
          value={l1Coverage?.chapters ? `${l1Coverage.chapters.completed}/${l1Coverage.chapters.total} 章` : "读取中"}
          state={l1Ratio >= 80 ? "ready" : l1Missing ? "todo" : "partial"}
        />
        <MaterialStep
          label={factIndex}
          value={l2Coverage?.chapters ? `${l2Coverage.chapters.completed}/${l2Coverage.chapters.total} 章` : "读取中"}
          state={l2Ratio >= 80 && l2Facts ? "ready" : l2Missing ? "todo" : "partial"}
        />
      </div>
    </section>
  );
}

function MaterialStep({ label, value, state }) {
  return (
    <div className={`material-step ${state}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LibraryDirectory({ books, selectedBookId, onSelect, onDeleteSelected }) {
  if (!books.length) return <div className="empty-state">无书籍</div>;
  const totalBooks = books.length;
  return (
    <div className="library-directory">
      <div className="library-directory-summary">
        <span>{totalBooks} 本书</span>
      </div>
      <div className="library-book-list" role="list">
        {books.map((entry) => {
          const active = entry.book_id === selectedBookId;
          return (
            <div
              key={entry.book_id}
              className={active ? "library-book-row active" : "library-book-row"}
              role="listitem"
            >
              <button
                type="button"
                className="library-book-select"
                onClick={() => onSelect(entry.book_id)}
              >
                <div className="library-book-title">
                  <strong>{entry.book_name || entry.book_id}</strong>
                  <small>{entry.book_id}</small>
                </div>
                <div className="library-book-meta compact">
                  <span>{entry.chapter_count || 0} 章</span>
                  <span>{chapterRange(entry)}</span>
                  <span>{formatTime(entry.updated_at)}</span>
                </div>
              </button>
              <StatusPill status={entry.last_import_status || "idle"} />
              {active ? (
                <button className="library-book-delete" type="button" onClick={onDeleteSelected} aria-label={`删除 ${entry.book_name || entry.book_id}`}>
                  <Trash2 size={15} />
                  删除
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function validChapterNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function sanitizeChapterInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "").replace(/^0$/, "");
}

function chapterRange(book) {
  const first = book?.first_chapter || "-";
  const last = book?.last_chapter || "-";
  return `${first}-${last}`;
}

function coverageRangeForBook(book) {
  return {
    startChapter: book?.first_chapter || 1,
    endChapter: book?.last_chapter || book?.first_chapter || 1
  };
}

function CoverageSummary({ coverage, chapters }) {
  if (!coverage) return <div className="index-summary">章节线索读取中</div>;
  const total = Math.max(coverage.chapters.total || 0, 1);
  const completed = coverage.chapters.completed || 0;
  const failedChapters = chapters.filter((chapter) => chapter.status === "failed").map((chapter) => chapter.chapter_index);
  const finishedRatio = Math.round((completed / total) * 100);
  return (
    <div className="coverage-card">
      <div className="coverage-head">
        <strong>章节线索 {finishedRatio}%</strong>
        <span>{coverage.chapters.completed}/{coverage.chapters.total} 章完成</span>
      </div>
      <div className="coverage-bar" aria-label={`章节线索 ${finishedRatio}%`}>
        <span style={{ width: `${finishedRatio}%` }} />
      </div>
      <p className="coverage-note">
        {failedChapters.length
          ? `最近失败章节：${compactChapterList(failedChapters.slice(0, 16))}`
          : coverage.chapters.missing
            ? "未构建"
            : "已覆盖"}
      </p>
    </div>
  );
}

function L2CoverageSummary({ coverage }) {
  if (!coverage) return <div className="index-summary">事实索引读取中</div>;
  const total = Math.max(coverage.chapters.total || 0, 1);
  const completed = coverage.chapters.completed || 0;
  const finishedRatio = Math.round((completed / total) * 100);
  return (
    <div className="coverage-card">
      <div className="coverage-head">
        <strong>事实索引 {finishedRatio}%</strong>
        <span>{completed}/{coverage.chapters.total} 章 · {coverage.chapters.facts || 0} 条事实</span>
      </div>
      <div className="coverage-bar" aria-label={`事实索引 ${finishedRatio}%`}>
        <span style={{ width: `${finishedRatio}%` }} />
      </div>
      <p className="coverage-note">
        {coverage.failed_chapters?.length
          ? `失败章节：${compactChapterList(coverage.failed_chapters.slice(0, 16))}`
          : "可用于快速分析"}
      </p>
    </div>
  );
}

function L1Preview({ chapters }) {
  if (!chapters.length) return null;
  const chapter = chapters[0];
  const signals = Array.isArray(chapter.signals) ? chapter.signals : [];
  const entities = Array.isArray(chapter.route_entities) ? chapter.route_entities : [];
  const keywords = Array.isArray(chapter.route_keywords) ? chapter.route_keywords : [];
  const hasRoute = Boolean(chapter.route_schema_version || signals.length || entities.length || keywords.length);
  const chapterIndex = Number(chapter.chapter_index || 0);
  return (
    <details className="index-preview" open>
      <summary>
        <span>章节线索预览</span>
        <small>章节 {chapter.chapter_index}</small>
      </summary>
      <article className="index-preview-sheet">
        <PreviewSheet title="章节概览">
          <table className="index-preview-table">
            <tbody>
              <tr>
                <th>章节</th>
                <td>{chapter.chapter_index}</td>
              </tr>
              <tr>
                <th>路由版本</th>
                <td>{chapter.route_schema_version || "legacy"}</td>
              </tr>
              <tr>
                <th>主体数</th>
                <td>{entities.length}</td>
              </tr>
              <tr>
                <th>关键词数</th>
                <td>{keywords.length}</td>
              </tr>
              <tr>
                <th>信号数</th>
                <td>{signals.length}</td>
              </tr>
            </tbody>
          </table>
        </PreviewSheet>
        <PreviewSheet title="主体">
          {entities.length ? (
            <table className="index-preview-table">
              <thead>
                <tr>
                  <th>主体</th>
                  <th>类型</th>
                  <th>别名</th>
                  <th>角色</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity, index) => (
                  <tr key={`${entity.name || index}-${index}`}>
                    <td>{entity.name || "-"}</td>
                    <td>{entity.type || "-"}</td>
                    <td>{joinPreviewList(entity.aliases)}</td>
                    <td>{entity.role || "-"}</td>
                    <td>{entity.note || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="index-preview-empty">本章没有可展示主体</div>
          )}
        </PreviewSheet>
        <PreviewSheet title="信号">
          {signals.length ? (
            <table className="index-preview-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>强度</th>
                  <th>主体</th>
                  <th>关键词</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((signal, index) => (
                  <tr key={`${signal.category || "signal"}-${index}`}>
                    <td>{categoryLabel(signal.category)}</td>
                    <td>{formatSignalStrength(signal.strength)}</td>
                    <td>{joinPreviewList(signal.entities)}</td>
                    <td>{joinPreviewList(signal.keywords)}</td>
                    <td>{signal.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="index-preview-empty">本章没有可展示信号</div>
          )}
        </PreviewSheet>
        <PreviewSheet title="关键词">
          {keywords.length ? (
            <table className="index-preview-table">
              <tbody>
                {chunkPreviewList(keywords, 4).map((row, index) => (
                  <tr key={`${chapterIndex}-keyword-${index}`}>
                    <th>关键词组 {index + 1}</th>
                    <td>{row.join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="index-preview-empty">{hasRoute ? "本章没有关键词" : (chapter.summary || chapter.error_summary || "旧版章节线索暂无路由信号")}</div>
          )}
        </PreviewSheet>
      </article>
    </details>
  );
}

function L2FactPreview({ facts, chapterIndex }) {
  const chapterFacts = Number.isInteger(chapterIndex)
    ? facts.filter((fact) => Number(fact.chapter_index || 0) === chapterIndex)
    : facts;
  return (
    <details className="index-preview" open>
      <summary>
        <span>事实索引预览</span>
        <small>{chapterFacts.length ? `第 ${chapterIndex || chapterFacts[0]?.chapter_index || "当前"} 章 · ${chapterFacts.length} 条事实` : "无事实"}</small>
      </summary>
      {chapterFacts.length ? (
        <article className="index-preview-sheet">
          <PreviewSheet title="事实明细">
            <table className="index-preview-table">
              <thead>
                <tr>
                  <th>章</th>
                  <th>类别</th>
                  <th>主体</th>
                  <th>事实类型</th>
                  <th>事实</th>
                  <th>标签</th>
                  <th>相关主体</th>
                  <th>重要度</th>
                  <th>置信度</th>
                </tr>
              </thead>
              <tbody>
                {chapterFacts.map((fact, index) => (
                  <tr key={`${fact.chapter_index || chapterIndex}-${fact.id || index}`}>
                    <td>{fact.chapter_index || chapterIndex || "-"}</td>
                    <td>{categoryLabel(fact.category)}</td>
                    <td>{fact.entity || "-"}</td>
                    <td>{fact.fact_type || "-"}</td>
                    <td>{fact.fact || "无事实正文"}</td>
                    <td>{joinPreviewList(fact.tags)}</td>
                    <td>{joinPreviewList(fact.related_entities)}</td>
                    <td>{formatScore(fact.importance)}</td>
                    <td>{formatScore(fact.confidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PreviewSheet>
        </article>
      ) : (
        <article className="index-preview-empty">
          <strong>无事实</strong>
          <p>{chapterIndex ? `第 ${chapterIndex} 章暂无事实` : "当前范围暂无事实"}</p>
        </article>
      )}
    </details>
  );
}

function PreviewSheet({ title, children }) {
  return (
    <section className="preview-sheet">
      <header>{title}</header>
      {children}
    </section>
  );
}

function categoryLabel(value) {
  return L2_CATEGORIES.find((category) => category.value === value)?.label || value || "其他";
}

function formatScore(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function compactChapterList(indexes) {
  return indexes.length ? indexes.join(", ") : "-";
}

function chunkPreviewList(items, size = 4) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

function joinPreviewList(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? list.join("、") : "-";
}

function formatSignalStrength(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function coveragePercent(coverage) {
  const total = Number(coverage?.chapters?.total || 0);
  if (!total) return 0;
  return Math.round((Number(coverage.chapters.completed || 0) / total) * 100);
}

function materialReadinessLevel({ imported, l1Ratio, l2Ratio, l2Facts }) {
  if (!imported) {
    return {
      tone: "blocked",
      title: "需要先导入章节",
      description: "导入章节后，系统才能准备章节线索和事实索引。"
    };
  }
  if (l1Ratio >= 80 && l2Ratio >= 80 && l2Facts > 0) {
    return {
      tone: "ready",
      title: "可以开始分析",
      description: "当前章节线索和事实索引已经有较好覆盖，可直接创建或运行分析模板。"
    };
  }
  if (l1Ratio > 0 || l2Ratio > 0) {
    return {
      tone: "partial",
      title: "建议补齐索引",
      description: "已有部分索引可用。若要提高召回质量，建议先补齐当前范围。"
    };
  }
  return {
    tone: "blocked",
    title: "需要准备索引",
    description: "建议先准备章节线索，再准备事实索引。"
  };
}

function factIndexName(group) {
  if (!group) return "事实索引";
  if (group.group_key === "base") return "事实索引";
  return group.name || group.group_key;
}
