import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Copy,
  FileText,
  Layers,
  Loader2,
  Play,
  RefreshCcw,
  Table2,
  Trash2
} from "lucide-react";
import { apiDelete, apiGet, formatTime } from "../api.js";
import { IconButton, Panel, ResultActions, StatusPill, TaskBox } from "../ui.jsx";
import { analysisIndexCoverageText, factIndexName } from "../analysisCoverage.js";
import { parseJsonLike, tableViewsFromJson } from "../schemaTools.js";

const initialAnalysisForm = {
  book_id: "",
  start_chapter: "1",
  end_chapter: "20"
};

export function AnalysisPage({
  books,
  config,
  onLoadBookIndexGroups,
  analysisTask,
  analysisBusy,
  onStartAnalysis,
  onResumeAnalysisRun,
  onAnalysisCancel,
  onAnalysisPause,
  onAnalysisResume,
  setError
}) {
  const [analyses, setAnalyses] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [chaptersBookId, setChaptersBookId] = useState("");
  const [analysisForm, setAnalysisForm] = useState({
    ...initialAnalysisForm,
    book_id: books[0]?.book_id || ""
  });
  const [indexGroups, setIndexGroups] = useState([]);
  const [selectedL2QueryIndexKeys, setSelectedL2QueryIndexKeys] = useState([]);
  const [l2QueryText, setL2QueryText] = useState("");
  const [selectedIndexes, setSelectedIndexes] = useState([]);
  const [l2CoveragesByGroup, setL2CoveragesByGroup] = useState({});
  const selectionOverrideRef = useRef(null);
  const [selectionOverrideToken, setSelectionOverrideToken] = useState(0);
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [busy, setBusy] = useState({ analysis: false, chapters: false, list: false });

  useEffect(() => {
    if (analysisTask?.result?.analysisId && selectedAnalysis?.id === analysisTask.result.analysisId) {
      void loadAnalysisResult(analysisTask.result.analysisId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisTask?.status, analysisTask?.updatedAt]);

  useEffect(() => {
    void loadAnalyses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadChapters(analysisForm.book_id);
    void loadBookIndexGroups(analysisForm.book_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisForm.book_id]);

  useEffect(() => {
    if (!analysisForm.book_id || chaptersBookId !== analysisForm.book_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedIndexes([]);
      return;
    }
    const startChapter = chapterNumber(analysisForm.start_chapter);
    const endChapter = chapterNumber(analysisForm.end_chapter, startChapter);
    const inRange = chapters
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter)
      .map((chapter) => chapter.chapter_index);
    const selectionOverride = selectionOverrideRef.current;
    if (selectionOverride) {
      const available = new Set(inRange);
      setSelectedIndexes(selectionOverride.filter((index) => available.has(index)));
      selectionOverrideRef.current = null;
      return;
    }
    setSelectedIndexes(inRange);
  }, [chapters, chaptersBookId, analysisForm.book_id, analysisForm.start_chapter, analysisForm.end_chapter, selectionOverrideToken]);

  const selectedBook = useMemo(
    () => books.find((book) => book.book_id === analysisForm.book_id) || null,
    [books, analysisForm.book_id]
  );
  const analysisProviderReady = Boolean(config.difyAnalysisSummaryConfigured);
  const selectedL2QueryEnabledIndexKeys = useMemo(
    () => filterEnabledIndexKeys(selectedL2QueryIndexKeys, indexGroups),
    [selectedL2QueryIndexKeys, indexGroups]
  );
  const hasBoundIndexGroups = selectedL2QueryEnabledIndexKeys.length > 0;

  const chaptersInRange = useMemo(
    () => {
      const startChapter = chapterNumber(analysisForm.start_chapter);
      const endChapter = chapterNumber(analysisForm.end_chapter, startChapter);
      return chapters.filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter);
    },
    [chapters, analysisForm.start_chapter, analysisForm.end_chapter]
  );
  useEffect(() => {
    if (!analysisForm.book_id || !validChapterNumber(analysisForm.start_chapter) || !validChapterNumber(analysisForm.end_chapter)) {
      return;
    }
    void loadL2Coverage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisForm.book_id, analysisForm.start_chapter, analysisForm.end_chapter, selectedL2QueryEnabledIndexKeys]);

  async function loadAnalyses() {
    setBusy((state) => ({ ...state, list: true }));
    setError("");
    try {
      const data = await apiGet("/api/analyses");
      setAnalyses(data.analyses || []);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy((state) => ({ ...state, list: false }));
    }
  }

  async function loadChapters(bookId) {
    if (!bookId) {
      setChapters([]);
      setChaptersBookId("");
      return;
    }
    setBusy((state) => ({ ...state, chapters: true }));
    setError("");
    try {
      const data = await apiGet(`/api/books/${encodeURIComponent(bookId)}/chapters`);
      setChapters(data.chapters || []);
      setChaptersBookId(bookId);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy((state) => ({ ...state, chapters: false }));
    }
  }

  async function loadBookIndexGroups(bookId) {
    if (!bookId) {
      setIndexGroups([]);
      setSelectedL2QueryIndexKeys([]);
      return;
    }
    setError("");
    try {
      const indexGroupRows = await onLoadBookIndexGroups(bookId);
      setIndexGroups(indexGroupRows);
      setSelectedL2QueryIndexKeys(defaultL2QueryIndexKeys(indexGroupRows));
    } catch (error) {
      setError(error.message);
    }
  }

  async function loadL2Coverage() {
    if (!analysisForm.book_id || !validChapterNumber(analysisForm.start_chapter) || !validChapterNumber(analysisForm.end_chapter)) {
      return;
    }
    try {
      const groupKeys = selectedL2QueryEnabledIndexKeys;
      if (!groupKeys.length) {
        setL2CoveragesByGroup({});
        return;
      }
      const entries = await Promise.all(groupKeys.map(async (groupKey) => {
        const query = `start_chapter=${encodeURIComponent(analysisForm.start_chapter)}&end_chapter=${encodeURIComponent(analysisForm.end_chapter)}&index_group_key=${encodeURIComponent(groupKey)}`;
        const l2Data = await apiGet(`/api/books/${encodeURIComponent(analysisForm.book_id)}/l2-indexes/coverage?${query}`);
        return [groupKey, l2Data.coverage];
      }));
      setL2CoveragesByGroup(Object.fromEntries(entries));
    } catch (error) {
      setError(error.message);
    }
  }

  async function startAnalysis() {
    if (!validChapterNumber(analysisForm.start_chapter) || !validChapterNumber(analysisForm.end_chapter)) {
      setError("起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    const chapterIndexes = [...new Set(selectedIndexes)].sort((left, right) => left - right);
    if (!chapterIndexes.length) {
      setError("请至少选择一个已导入章节。");
      return;
    }
    if (!l2QueryText.trim()) {
      setError("L2 提问必须填写查询问题。");
      return;
    }
    if (!hasBoundIndexGroups) {
      setError("请至少选择一个事实索引。");
      return;
    }
    if (!analysisProviderReady) {
      setError("分析执行器未就绪：请配置 DIFY_ANALYSIS_SUMMARY_WORKFLOW_API_KEY。");
      return;
    }

    setError("");
    setSelectedAnalysis(null);
    const task = await onStartAnalysis({
      book_id: analysisForm.book_id,
      name: analysisTaskName(l2QueryText, selectedBook, analysisForm),
      query: l2QueryText.trim(),
      index_group_keys: selectedL2QueryEnabledIndexKeys,
      chapter_indexes: chapterIndexes
    }, {
      onTerminal: async (task) => {
        await loadAnalyses();
        if (task.result?.analysisId) await loadAnalysisResult(task.result.analysisId);
        if (task.status === "failed") setError(task.error || "分析失败");
      }
    });
    if (task?.result?.analysisId) await loadAnalysisResult(task.result.analysisId);
  }

  async function controlAnalysis(action) {
    if (!analysisTask?.id) return;
    setError("");
    if (action === "cancel") await onAnalysisCancel?.();
    if (action === "pause") await onAnalysisPause?.();
    if (action === "resume") await onAnalysisResume?.();
    if (action === "cancel") await loadAnalyses();
  }

  async function resumeSelectedAnalysis() {
    if (!selectedAnalysis?.id) return;
    setError("");
    const task = await onResumeAnalysisRun(selectedAnalysis.id, {
      onTerminal: async (finishedTask) => {
        await loadAnalyses();
        await loadAnalysisResult(selectedAnalysis.id);
        if (finishedTask.status === "failed") setError(finishedTask.error || "分析失败");
      }
    });
    if (task) await loadAnalysisResult(selectedAnalysis.id);
  }

  async function loadAnalysisResult(id) {
    setError("");
    try {
      const data = await apiGet(`/api/analyses/${encodeURIComponent(id)}`);
      setSelectedAnalysis(data.analysis);
      return data.analysis;
    } catch (error) {
      setError(error.message);
      return null;
    }
  }

  async function deleteAnalysis(id) {
    const confirmed = window.confirm("删除这条分析任务和本地结果？");
    if (!confirmed) return;
    setError("");
    try {
      await apiDelete(`/api/analyses/${encodeURIComponent(id)}`);
      if (selectedAnalysis?.id === id) setSelectedAnalysis(null);
      await loadAnalyses();
    } catch (error) {
      setError(error.message);
    }
  }

  async function copyAnalysis(id) {
    const analysis = await loadAnalysisResult(id);
    if (!analysis) return;
    const rawPrompt = analysis.prompt || {};
    setAnalysisForm({
      ...initialAnalysisForm,
      book_id: analysis.book_id,
      start_chapter: String(analysis.start_chapter),
      end_chapter: String(analysis.end_chapter)
    });
    setL2QueryText(rawPrompt.l2_query || analysis.source_stats?.query || "");
    const copiedIndexKeys = rawPrompt.index_group_keys || analysis.source_stats?.index_group_keys || [];
    const availableIndexKeys = filterEnabledIndexKeys(copiedIndexKeys, indexGroups);
    setSelectedL2QueryIndexKeys(availableIndexKeys.length ? availableIndexKeys : defaultL2QueryIndexKeys(indexGroups));
    selectionOverrideRef.current = analysis.chapter_indexes || [];
    setSelectionOverrideToken((value) => value + 1);
  }

  function updateAnalysisForm(patch) {
    setAnalysisForm((form) => ({ ...form, ...patch }));
    if (patch.book_id !== undefined || patch.start_chapter !== undefined || patch.end_chapter !== undefined) {
      setL2CoveragesByGroup({});
    }
  }

  function openIndexManager() {
    if (!analysisForm.book_id) return;
    window.history.pushState({}, "", `/prompts?book_id=${encodeURIComponent(analysisForm.book_id)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <section className="analysis-layout analysis-workspace">
      <header className="page-hero">
        <div>
          <span>分析工作台</span>
          <h2>L2 提问</h2>
          <p>选择书籍、事实索引和章节范围，召回 L2 事实并汇总生成结构化结果。</p>
        </div>
        <div className="page-hero-actions">
          <button className="secondary inline" type="button" onClick={openIndexManager} disabled={!analysisForm.book_id}>
            <ClipboardList size={16} />
            管理索引
          </button>
        </div>
      </header>

      <section className="analysis-command-row">
        <Panel
          icon={Play}
          title="新建任务"
          action={<TaskStats book={selectedBook} selectedCount={selectedIndexes.length} totalInRange={chaptersInRange.length} />}
        >
          <div className="form-grid analysis-form-grid">
            <label>
              <span>书籍</span>
              <select
                value={analysisForm.book_id}
                onChange={(event) => updateAnalysisForm({ book_id: event.target.value })}
              >
                <option value="">选择已导入书籍</option>
                {books.map((book) => (
                  <option key={book.book_id} value={book.book_id}>
                    {book.book_name ? `${book.book_name}（${book.book_id}）` : book.book_id}
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
                value={analysisForm.start_chapter}
                onChange={(event) => updateAnalysisForm({ start_chapter: sanitizeChapterInput(event.target.value) })}
              />
            </label>
            <label>
              <span>结束章节</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={analysisForm.end_chapter}
                onChange={(event) => updateAnalysisForm({ end_chapter: sanitizeChapterInput(event.target.value) })}
              />
            </label>
          </div>

          <div className="l2-query-box">
            <label>
              <span>事实索引</span>
              <div className="index-checkbox-list">
                {indexGroups.map((group) => (
                  <label key={group.group_key} className="inline-check">
                    <input
                      type="checkbox"
                      checked={selectedL2QueryIndexKeys.includes(group.group_key)}
                      onChange={() => setSelectedL2QueryIndexKeys((keys) => toggleListValue(keys, group.group_key))}
                    />
                    <span>{factIndexName(group)}</span>
                  </label>
                ))}
              </div>
            </label>
            <label>
              <span>查询问题 / 输出要求</span>
              <textarea
                className="l2-query-textarea"
                value={l2QueryText}
                placeholder="例如：帮我查找剑来飞剑专项 L2 中关于初一（早期外形是银锭，原文中称之为小银锭）的内容，并整理成初一外形演化时间线"
                onChange={(event) => setL2QueryText(event.target.value)}
              />
            </label>
          </div>

          <div className="command-footer">
            <div className="index-route-note">
              {analysisRouteNote(l2CoveragesByGroup, selectedL2QueryEnabledIndexKeys, indexGroups)}
            </div>
            <button
              className="primary inline command-primary"
              type="button"
              onClick={startAnalysis}
              disabled={analysisBusy || !analysisProviderReady || !analysisForm.book_id || !selectedIndexes.length || !hasBoundIndexGroups || !l2QueryText.trim()}
            >
              {analysisBusy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {analysisBusy ? "分析中" : "开始分析"}
            </button>
          </div>

          {analysisTask ? (
            <TaskBox
              task={analysisTask}
              onCancel={() => controlAnalysis("cancel")}
              onPause={() => controlAnalysis("pause")}
              onResume={() => controlAnalysis("resume")}
            />
          ) : null}
        </Panel>
      </section>

      <section className="analysis-review-row">
        <Panel
          icon={Layers}
          title="分析任务"
          className="analysis-history-panel"
          action={<IconButton icon={RefreshCcw} label="刷新" onClick={loadAnalyses} disabled={busy.list} />}
        >
          <AnalysisHistory
            analyses={analyses}
            books={books}
            selectedId={selectedAnalysis?.id}
            onSelect={loadAnalysisResult}
            onCopy={copyAnalysis}
            onDelete={deleteAnalysis}
          />
        </Panel>

        <Panel
          icon={Table2}
          title="结果"
          action={<ResultActions analysis={selectedAnalysis} />}
        >
          <ResultView
            analysis={selectedAnalysis}
            analysisBusy={analysisBusy}
            onResume={resumeSelectedAnalysis}
          />
        </Panel>
      </section>
    </section>
  );
}

function TaskStats({ book, selectedCount, totalInRange }) {
  return (
    <div className="stats">
      <span>{book?.chapter_count || 0} 章已入库</span>
      <span>{selectedCount}/{totalInRange} 已选</span>
    </div>
  );
}

function chapterNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function validChapterNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function analysisTaskName(query, book, form) {
  const text = String(query || "").trim();
  if (text) return `L2 提问 · ${text.slice(0, 24)}`;
  const bookName = book?.book_name || book?.book_id || "分析任务";
  return `${bookName} ${form.start_chapter}-${form.end_chapter}`;
}

function sanitizeChapterInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "").replace(/^0$/, "");
}

function analysisRouteNote(coveragesByGroup, indexGroupKeys, indexGroups) {
  const groupText = analysisIndexCoverageText({ indexGroupKeys, indexGroups, coveragesByGroup });
  return `L2 提问 · 只查询事实索引，不跑逐章分析，不复核原文 · ${groupText}`;
}

function defaultL2QueryIndexKeys(groups = []) {
  const nonBase = groups.find((group) => group.group_key && group.group_key !== "base");
  const first = nonBase || groups[0];
  return first?.group_key ? [first.group_key] : [];
}

function filterEnabledIndexKeys(keys = [], groups = []) {
  const enabled = new Set(groups.map((group) => group.group_key).filter(Boolean));
  return uniqueList(keys).filter((key) => enabled.has(key));
}

function uniqueList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
}

function toggleListValue(values, value) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function AnalysisHistory({ analyses, books, selectedId, onSelect, onCopy, onDelete }) {
  if (!analyses.length) return <div className="history-empty">无任务</div>;
  const bookNames = new Map(books.map((book) => [book.book_id, book.book_name || book.book_id]));
  function selectFromCard(event, analysisId) {
    if (event.target.closest("button")) return;
    onSelect(analysisId);
  }

  return (
    <div className="analysis-list expanded">
      {analyses.map((analysis) => (
        <div
          key={analysis.id}
          className={analysis.id === selectedId ? "analysis-record active" : "analysis-record"}
          onClick={(event) => selectFromCard(event, analysis.id)}
        >
          <button type="button" className="analysis-main" onClick={() => onSelect(analysis.id)}>
            <strong>{analysis.name || "未命名任务"}</strong>
            <span>{bookNames.get(analysis.book_id) || analysis.book_id} · {analysis.start_chapter}-{analysis.end_chapter} · {analysis.chapter_count} 章</span>
            <span className="analysis-id-line">任务 ID：{shortAnalysisId(analysis.id)}</span>
            <small>{formatTime(analysis.updated_at)}</small>
          </button>
          <div className="analysis-actions">
            <StatusPill status={analysis.status} />
            <button type="button" className="action-chip" onClick={() => onCopy(analysis.id)} title="复制配置" aria-label="复制配置">
              <Copy size={15} />
              <span>复制</span>
            </button>
            <button type="button" className="action-chip danger-icon" onClick={() => onDelete(analysis.id)} title="删除任务" aria-label="删除任务">
              <Trash2 size={15} />
              <span>删除</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultView({ analysis, analysisBusy, onResume }) {
  if (!analysis) return <div className="empty-state tall">从左侧选择已完成任务，或创建新的分析任务</div>;
  if (!analysis.finalResult) {
    return <PartialResultView analysis={analysis} analysisBusy={analysisBusy} onResume={onResume} />;
  }
  if (typeof analysis.finalResult === "string") {
    const parsed = parseJsonLike(analysis.finalResult);
    const tables = tableViewsFromJson(parsed);
    if (tables.length) {
      return (
        <div className="result-stack">
          <AnalysisIdentity analysis={analysis} />
          <SourceStats stats={analysis.source_stats} />
          <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />
          <JsonTableResult tables={tables} rawValue={parsed} title={analysis.name} />
        </div>
      );
    }
    return (
      <div className="result-stack">
        <AnalysisIdentity analysis={analysis} />
        <SourceStats stats={analysis.source_stats} />
        <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />
        <TextPreview value={analysis.finalResult} />
      </div>
    );
  }
  const tables = tableViewsFromJson(analysis.finalResult);
  if (tables.length) {
    return (
      <div className="result-stack">
        <AnalysisIdentity analysis={analysis} />
        <SourceStats stats={analysis.source_stats} />
        <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />
        <JsonTableResult tables={tables} rawValue={analysis.finalResult} title={analysis.name} />
      </div>
    );
  }

  return (
    <div className="result-stack">
      <AnalysisIdentity analysis={analysis} />
      <SourceStats stats={analysis.source_stats} />
      <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />
      <JsonPreview value={analysis.finalResult} />
    </div>
  );
}

function JsonTableResult({ tables, rawValue, title }) {
  const displayTitle = typeof rawValue?.title === "string" && rawValue.title.trim()
    ? rawValue.title
    : title;
  const displaySummary = typeof rawValue?.summary === "string" ? rawValue.summary : "";
  return (
    <>
      <div className="result-summary">
        <h3>{displayTitle || "分析结果"}</h3>
        {displaySummary ? <p>{displaySummary}</p> : null}
      </div>
      <div className="result-table-stack">
        {tables.map((table) => (
          <section className="result-table-block" key={table.key}>
            <div className="result-table-head">
              <strong>{table.title}</strong>
              <span>{table.rows.length} 行 · {table.columns.length} 列</span>
            </div>
            <div className="table-wrap result-table">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      {table.columns.map((column) => (
                        <td key={column.key}>{formatCell(row?.[column.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      {Array.isArray(rawValue?.failed_chapters) && rawValue.failed_chapters.length ? (
        <div className="inline-warning">
          <FileText size={15} />
          失败章节：{rawValue.failed_chapters.join(", ")}
        </div>
      ) : null}
      <details className="result-json-details">
        <summary>查看完整 JSON</summary>
        <JsonPreview value={rawValue} />
      </details>
    </>
  );
}

function AnalysisIdentity({ analysis }) {
  if (!analysis?.id) return null;
  return (
    <div className="analysis-identity">
      <span>任务 ID</span>
      <code>{analysis.id}</code>
      <button
        type="button"
        className="action-chip"
        onClick={() => navigator.clipboard?.writeText(analysis.id)}
      >
        <Copy size={14} />
        复制 ID
      </button>
    </div>
  );
}

function SourceStats({ stats }) {
  if (!stats) return null;
  return (
    <div className="source-stats">
      <span>L2 提问</span>
      <span>召回事实 {Number(stats.recalled_facts || 0)} 条</span>
      <span>涉及章节 {Number(stats.recalled_chapters || 0)} 章</span>
      {stats.l1_route_enabled ? <span>章节线索命中 {stats.l1_matched_chapters?.length || 0} 章</span> : null}
      <span>原文复核 {Number(stats.source_review_chapters || 0)}/{Number(stats.source_review_budget || 0)} 章</span>
      {stats.index_groups?.length ? <span>事实索引 {stats.index_groups.map((group) => factIndexName(group)).join(" / ")}</span> : null}
      {stats.entity_queries?.length ? <span>主体 {stats.entity_queries.slice(0, 4).join(" / ")}</span> : null}
      {stats.recall_fallback_used ? <span>已启用兜底召回</span> : null}
      {stats.l2_missing_chapters?.length ? <span>事实索引缺口 {stats.l2_missing_chapters.length} 章</span> : null}
      {stats.unrecalled_chapters?.length ? <span>未召回 {stats.unrecalled_chapters.length} 章</span> : null}
    </div>
  );
}

function shortAnalysisId(id) {
  const value = String(id || "");
  if (value.length <= 12) return value || "-";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function SourceTracePanel({ summary, traces }) {
  const traceList = Array.isArray(traces) ? traces : [];
  if (!summary?.evidence_packet_count && !traceList.length) return null;
  const sourceTypes = countEntries(summary?.source_types);
  const categories = countEntries(summary?.categories).slice(0, 6);
  const visibleParts = traceList
    .filter((trace) => trace.stage === "json_field_batch" || trace.stage === "text_final_merge" || trace.part_key === "json.final.merge")
    .slice(0, 8);
  return (
    <details className="source-trace-panel">
      <summary>
        <span>来源追踪</span>
        <small>
          {Number(summary?.evidence_packet_count || 0)} 个证据包
          {summary?.chapters?.count ? ` · ${summary.chapters.count} 章` : ""}
        </small>
      </summary>
      <div className="source-trace-body">
        <div className="source-trace-chips">
          {sourceTypes.map(([key, value]) => <span key={key}>{sourceTypeLabel(key)} {value}</span>)}
          {categories.map(([key, value]) => <span key={key}>{categoryLabel(key)} {value}</span>)}
          {summary?.trimmed_by_budget ? <span>已按预算压缩</span> : null}
          {summary?.omitted_by_budget ? <span>省略 {summary.omitted_by_budget} 包</span> : null}
        </div>
        {summary?.subjects?.length ? (
          <div className="muted-line">主体：{summary.subjects.slice(0, 8).join(" / ")}</div>
        ) : null}
        {summary?.chapters?.sample?.length ? (
          <div className="muted-line">章节样本：{compactIndexes(summary.chapters.sample)}</div>
        ) : null}
        {visibleParts.length ? (
          <div className="source-trace-grid">
            {visibleParts.map((trace) => (
              <div className="source-trace-card" key={trace.part_key}>
                <strong>{trace.field_name || trace.part_key}</strong>
                <span>{trace.part_key}</span>
                <small>
                  {Number(trace.evidence_packet_count || 0)} 包
                  {trace.chapters?.count ? ` · ${trace.chapters.count} 章` : ""}
                  {trace.batch && trace.total_batches > 1 ? ` · ${trace.batch}/${trace.total_batches}` : ""}
                </small>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function countEntries(value) {
  return Object.entries(value || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0));
}

function sourceTypeLabel(value) {
  return {
    l2_fact: "事实索引",
    source_review: "原文复核",
    chapter_summary: "章节摘要"
  }[value] || value;
}

function categoryLabel(value) {
  return {
    character: "人物",
    relationship: "关系",
    cultivation: "修行",
    item: "物品",
    force: "势力",
    location: "地点",
    event: "事件",
    foreshadowing: "伏笔",
    other: "其他"
  }[value] || value;
}

function PartialResultView({ analysis, analysisBusy, onResume }) {
  const completed = analysis.chapterResults || [];
  const failed = analysis.failedChapterIndexes || [];
  const pending = analysis.pendingChapterIndexes || [];
  const summaryProgress = analysis.summaryProgress || null;
  const failedSummaryParts = analysis.failedSummaryParts || [];
  return (
    <div className="partial-result-stack">
      <AnalysisIdentity analysis={analysis} />
      <div className="partial-result-header">
        <div>
          <h3>未生成最终结果</h3>
          <p>
            已完成 {completed.length} 章
            {failed.length ? ` · 失败 ${failed.length} 章` : ""}
            {pending.length ? ` · 待续跑 ${pending.length} 章` : ""}
          </p>
        </div>
        {analysis.canResume ? (
          <button className="secondary" type="button" onClick={onResume} disabled={analysisBusy}>
            {analysisBusy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            继续分析
          </button>
        ) : null}
      </div>

      {analysis.error_summary ? (
        <div className="inline-warning">
          <FileText size={15} />
          {analysis.error_summary}
        </div>
      ) : null}

      {summaryProgress?.total ? (
        <div className="source-stats">
          <span>最终汇总分块 {summaryProgress.completed}/{summaryProgress.total}</span>
          {summaryProgress.running ? <span>运行 {summaryProgress.running}</span> : null}
          {summaryProgress.failed ? <span>失败 {summaryProgress.failed}</span> : null}
        </div>
      ) : null}
      <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />

      {failed.length ? (
        <div className="inline-warning">
          <FileText size={15} />
          失败章节：{failed.join(", ")}
        </div>
      ) : null}
      {failedSummaryParts.length ? (
        <div className="inline-warning">
          <FileText size={15} />
          汇总分块失败：{failedSummaryParts.slice(0, 4).map((part) => part.part_key).join(", ")}
        </div>
      ) : null}
      {pending.length ? (
        <div className="muted-line">待续跑章节：{compactIndexes(pending)}</div>
      ) : null}

      {completed.length ? (
        <div className="partial-chapter-list">
          {completed.map((entry) => (
            <details key={entry.chapter_index} className="partial-chapter-item">
              <summary>
                第 {entry.chapter_index} 章
                {entry.result?.chapter_title ? ` · ${entry.result.chapter_title}` : ""}
              </summary>
              {entry.result?.summary ? <p>{entry.result.summary}</p> : null}
              <JsonPreview value={entry.result} />
            </details>
          ))}
        </div>
      ) : (
        <div className="empty-state tall">无逐章结果</div>
      )}
    </div>
  );
}

function JsonPreview({ value }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function TextPreview({ value }) {
  return <pre className="text-preview">{value}</pre>;
}

function formatCell(value) {
  if (Array.isArray(value)) return value.map((entry) => formatCell(entry)).join("\n");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatCell(entry)}`)
      .join("\n");
  }
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function compactIndexes(indexes) {
  const values = (indexes || []).slice(0, 40);
  const suffix = indexes.length > values.length ? ` 等 ${indexes.length} 章` : "";
  return `${values.join(", ")}${suffix}`;
}
