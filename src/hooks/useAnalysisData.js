import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, bookChaptersUrl, buildQuery, l2CoverageUrl } from "../api.js";
import { BASE_INDEX_GROUP_KEY } from "../constants/index.js";
import { TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import { validChapterNumber } from "../utils/chapterRange.js";

const initialAnalysisForm = {
  book_id: "",
  start_chapter: "1",
  end_chapter: "20"
};

/**
 * 提问管理页的数据层：分析列表（按当前书过滤）、章节、事实索引组、L2 覆盖率、选中结果，
 * 以及 start/copy/delete/resume/control 等动作。所有 load 函数带请求序号竞态保护；
 * 函数开头的 `await Promise.resolve()` 把状态更新推迟到微任务，避免在 effect 内同步 setState。
 * bookId 来自路由（页面按 key 重挂，hook 内视为稳定）。
 */
export function useAnalysisData({
  bookId,
  analysisTask,
  onStartAnalysis,
  onResumeAnalysisRun,
  onAnalysisCancel,
  onAnalysisPause,
  onAnalysisResume,
  onLoadBookIndexGroups
}) {
  const { books, config, setError } = useAppContext();
  const [analyses, setAnalyses] = useState([]);
  const [listBusy, setListBusy] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [chaptersBookId, setChaptersBookId] = useState("");
  const [analysisForm, setAnalysisForm] = useState({
    ...initialAnalysisForm,
    book_id: bookId || ""
  });
  const [indexGroups, setIndexGroups] = useState([]);
  const [selectedL2QueryIndexKeys, setSelectedL2QueryIndexKeys] = useState([]);
  const [l2QueryText, setL2QueryText] = useState("");
  const [chapterSelectionOverride, setChapterSelectionOverride] = useState(null);
  const [l2CoveragesByGroup, setL2CoveragesByGroup] = useState({});
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const analysesRequestRef = useRef(0);
  const chaptersRequestRef = useRef(0);
  const indexGroupsRequestRef = useRef(0);
  const coverageRequestRef = useRef(0);
  const resultRequestRef = useRef(0);
  const pendingCopiedIndexKeysRef = useRef(null);
  const terminalResultLoadedRef = useRef("");

  const loadAnalyses = useCallback(async () => {
    const requestId = ++analysesRequestRef.current;
    await Promise.resolve();
    if (requestId !== analysesRequestRef.current) return;
    setListBusy(true);
    setError("");
    try {
      const data = await apiGet(`/api/analyses${buildQuery({ book_id: bookId })}`);
      if (requestId !== analysesRequestRef.current) return;
      setAnalyses(data.analyses || []);
    } catch (error) {
      if (requestId !== analysesRequestRef.current) return;
      setError(error.message);
    } finally {
      if (requestId === analysesRequestRef.current) setListBusy(false);
    }
  }, [bookId, setError]);

  const loadChapters = useCallback(async (bookId) => {
    const requestId = ++chaptersRequestRef.current;
    await Promise.resolve();
    if (requestId !== chaptersRequestRef.current) return;
    if (!bookId) {
      setChapters([]);
      setChaptersBookId("");
      return;
    }
    setError("");
    try {
      const data = await apiGet(bookChaptersUrl(bookId));
      if (requestId !== chaptersRequestRef.current) return;
      setChapters(data.chapters || []);
      setChaptersBookId(bookId);
    } catch (error) {
      if (requestId !== chaptersRequestRef.current) return;
      setError(error.message);
    }
  }, [setError]);

  const loadBookIndexGroups = useCallback(async (bookId) => {
    const requestId = ++indexGroupsRequestRef.current;
    await Promise.resolve();
    if (requestId !== indexGroupsRequestRef.current) return;
    if (!bookId) {
      setIndexGroups([]);
      setSelectedL2QueryIndexKeys([]);
      pendingCopiedIndexKeysRef.current = null;
      return;
    }
    setError("");
    try {
      const indexGroupRows = await onLoadBookIndexGroups(bookId);
      if (requestId !== indexGroupsRequestRef.current) return;
      setIndexGroups(indexGroupRows);
      const pendingCopiedKeys = pendingCopiedIndexKeysRef.current;
      pendingCopiedIndexKeysRef.current = null;
      if (pendingCopiedKeys?.length) {
        const appliedKeys = filterEnabledIndexKeys(pendingCopiedKeys, indexGroupRows);
        setSelectedL2QueryIndexKeys(appliedKeys.length ? appliedKeys : defaultL2QueryIndexKeys(indexGroupRows));
      } else {
        setSelectedL2QueryIndexKeys(defaultL2QueryIndexKeys(indexGroupRows));
      }
    } catch (error) {
      if (requestId !== indexGroupsRequestRef.current) return;
      pendingCopiedIndexKeysRef.current = null;
      setError(error.message);
    }
  }, [onLoadBookIndexGroups, setError]);

  const loadAnalysisResult = useCallback(async (id) => {
    const requestId = ++resultRequestRef.current;
    await Promise.resolve();
    if (requestId !== resultRequestRef.current) return null;
    setError("");
    try {
      const data = await apiGet(`/api/analyses/${encodeURIComponent(id)}`);
      if (requestId !== resultRequestRef.current) return null;
      setSelectedAnalysis(data.analysis);
      return data.analysis;
    } catch (error) {
      if (requestId !== resultRequestRef.current) return null;
      setError(error.message);
      return null;
    }
  }, [setError]);

  const loadL2Coverage = useCallback(async ({ bookId, startChapter, endChapter, groupKeys }) => {
    const requestId = ++coverageRequestRef.current;
    await Promise.resolve();
    if (requestId !== coverageRequestRef.current) return;
    try {
      if (!groupKeys.length) {
        setL2CoveragesByGroup({});
        return;
      }
      const entries = await Promise.all(groupKeys.map(async (groupKey) => {
        const l2Data = await apiGet(l2CoverageUrl(bookId, {
          start_chapter: startChapter,
          end_chapter: endChapter,
          index_group_key: groupKey
        }));
        return [groupKey, l2Data.coverage];
      }));
      if (requestId !== coverageRequestRef.current) return;
      setL2CoveragesByGroup(Object.fromEntries(entries));
    } catch (error) {
      if (requestId !== coverageRequestRef.current) return;
      setError(error.message);
    }
  }, [setError]);

  useEffect(() => {
    // 包一层 async 闭包：load 内的 setState 全部发生在 await 之后，不在 effect 同步执行
    void (async () => {
      await loadAnalyses();
    })();
  }, [loadAnalyses]);

  const formBookId = analysisForm.book_id;
  useEffect(() => {
    void (async () => {
      await Promise.all([loadChapters(formBookId), loadBookIndexGroups(formBookId)]);
    })();
  }, [formBookId, loadChapters, loadBookIndexGroups]);

  // 任务到达终态时拉取一次结果（而不是每个 SSE progress 都全量重拉）；
  // 状态回到非终态（如再次续跑）时重置，允许下一次终态再拉
  const analysisTaskStatus = analysisTask?.status;
  const analysisTaskResultId = analysisTask?.result?.analysisId;
  useEffect(() => {
    if (!analysisTaskResultId || !TERMINAL_TASK_STATUSES.includes(analysisTaskStatus)) {
      terminalResultLoadedRef.current = "";
      return;
    }
    const loadedKey = `${analysisTaskResultId}:${analysisTaskStatus}`;
    if (terminalResultLoadedRef.current === loadedKey) return;
    terminalResultLoadedRef.current = loadedKey;
    void loadAnalysisResult(analysisTaskResultId);
  }, [analysisTaskResultId, analysisTaskStatus, loadAnalysisResult]);

  const selectedL2QueryEnabledIndexKeys = useMemo(
    () => filterEnabledIndexKeys(selectedL2QueryIndexKeys, indexGroups),
    [selectedL2QueryIndexKeys, indexGroups]
  );
  const hasBoundIndexGroups = selectedL2QueryEnabledIndexKeys.length > 0;

  useEffect(() => {
    if (!formBookId || !validChapterNumber(analysisForm.start_chapter) || !validChapterNumber(analysisForm.end_chapter)) {
      return;
    }
    void (async () => {
      await loadL2Coverage({
        bookId: formBookId,
        startChapter: analysisForm.start_chapter,
        endChapter: analysisForm.end_chapter,
        groupKeys: selectedL2QueryEnabledIndexKeys
      });
    })();
  }, [formBookId, analysisForm.start_chapter, analysisForm.end_chapter, selectedL2QueryEnabledIndexKeys, loadL2Coverage]);

  const selectedBook = useMemo(
    () => books.find((book) => book.book_id === analysisForm.book_id) || null,
    [books, analysisForm.book_id]
  );
  const analysisProviderReady = Boolean(config.difyAnalysisSummaryConfigured);

  // 默认范围=全书（v5 B4）：书章节范围到达后把表单从安全初值（1..20）调整为全书；
  // 每本书只调一次（渲染期与前值比较），此后的手改/范围快捷/copyAnalysis 不被回写
  const bookFirstChapter = Number(selectedBook?.first_chapter || 1);
  const bookLastChapter = Number(selectedBook?.last_chapter || selectedBook?.chapter_count || 0);
  const bookRangeKey = selectedBook && bookLastChapter > 0
    ? `${selectedBook.book_id}|${bookFirstChapter}|${bookLastChapter}`
    : "";
  const [seenBookRangeKey, setSeenBookRangeKey] = useState("");
  if (bookRangeKey && bookRangeKey !== seenBookRangeKey) {
    setSeenBookRangeKey(bookRangeKey);
    setAnalysisForm((form) => ({
      ...form,
      start_chapter: String(bookFirstChapter),
      end_chapter: String(bookLastChapter)
    }));
  }

  // 章节选择：默认取范围内全部章节；copyAnalysis 直接写入覆盖值；书籍/范围变化时覆盖值失效
  const selectionKey = selectionKeyForForm(analysisForm);
  if (chapterSelectionOverride && chapterSelectionOverride.key !== selectionKey) {
    setChapterSelectionOverride(null);
  }
  const startChapterNumber = chapterNumber(analysisForm.start_chapter);
  const endChapterNumber = chapterNumber(analysisForm.end_chapter, startChapterNumber);
  const chaptersInRange = useMemo(
    () => chapters.filter((chapter) => chapter.chapter_index >= startChapterNumber && chapter.chapter_index <= endChapterNumber),
    [chapters, startChapterNumber, endChapterNumber]
  );
  const chaptersReady = Boolean(analysisForm.book_id) && chaptersBookId === analysisForm.book_id;
  const selectedIndexes = useMemo(() => {
    if (!chaptersReady) return [];
    const inRange = chaptersInRange.map((chapter) => chapter.chapter_index);
    if (!chapterSelectionOverride) return inRange;
    const available = new Set(inRange);
    return chapterSelectionOverride.indexes.filter((index) => available.has(index));
  }, [chaptersReady, chaptersInRange, chapterSelectionOverride]);

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
      setError("提问必须填写查询问题。");
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
    await onStartAnalysis({
      book_id: analysisForm.book_id,
      name: analysisTaskName(l2QueryText, selectedBook, analysisForm),
      query: l2QueryText.trim(),
      index_group_keys: selectedL2QueryEnabledIndexKeys,
      chapter_indexes: chapterIndexes
    }, {
      onTerminal: async (task) => {
        await loadAnalyses();
        if (task.status === "failed") setError(task.error || "分析失败");
      }
    });
  }

  async function controlAnalysis(action) {
    if (!analysisTask?.id) return;
    setError("");
    if (action === "cancel") {
      await onAnalysisCancel?.();
      await loadAnalyses();
    }
    if (action === "pause") await onAnalysisPause?.();
    if (action === "resume") await onAnalysisResume?.();
  }

  async function resumeSelectedAnalysis() {
    if (!selectedAnalysis?.id) return;
    setError("");
    const task = await onResumeAnalysisRun(selectedAnalysis.id, {
      onTerminal: async (finishedTask) => {
        await loadAnalyses();
        if (finishedTask.status === "failed") setError(finishedTask.error || "分析失败");
      }
    });
    if (task) await loadAnalysisResult(selectedAnalysis.id);
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
    const copiedIndexKeys = rawPrompt.index_group_keys || analysis.source_stats?.index_group_keys || [];
    if (analysis.book_id && analysis.book_id !== analysisForm.book_id) {
      // 跨书复制：书籍切换会触发 loadBookIndexGroups 重置选择，先暂存待应用的索引 keys
      pendingCopiedIndexKeysRef.current = copiedIndexKeys;
    }
    const nextForm = {
      ...initialAnalysisForm,
      book_id: analysis.book_id,
      start_chapter: String(analysis.start_chapter),
      end_chapter: String(analysis.end_chapter)
    };
    setAnalysisForm(nextForm);
    setL2QueryText(rawPrompt.l2_query || analysis.source_stats?.query || "");
    const availableIndexKeys = filterEnabledIndexKeys(copiedIndexKeys, indexGroups);
    setSelectedL2QueryIndexKeys(availableIndexKeys.length ? availableIndexKeys : defaultL2QueryIndexKeys(indexGroups));
    setChapterSelectionOverride({
      key: selectionKeyForForm(nextForm),
      indexes: analysis.chapter_indexes || []
    });
  }

  function updateAnalysisForm(patch) {
    setAnalysisForm((form) => ({ ...form, ...patch }));
    if (patch.book_id !== undefined || patch.start_chapter !== undefined || patch.end_chapter !== undefined) {
      setL2CoveragesByGroup({});
    }
  }

  function toggleL2QueryIndexKey(groupKey) {
    setSelectedL2QueryIndexKeys((keys) => toggleListValue(keys, groupKey));
  }

  return {
    analyses,
    listBusy,
    loadAnalyses,
    analysisForm,
    updateAnalysisForm,
    selectedBook,
    analysisProviderReady,
    indexGroups,
    selectedL2QueryIndexKeys,
    toggleL2QueryIndexKey,
    selectedL2QueryEnabledIndexKeys,
    hasBoundIndexGroups,
    l2QueryText,
    setL2QueryText,
    selectedIndexes,
    chaptersInRange,
    l2CoveragesByGroup,
    selectedAnalysis,
    loadAnalysisResult,
    startAnalysis,
    controlAnalysis,
    resumeSelectedAnalysis,
    copyAnalysis,
    deleteAnalysis
  };
}

function selectionKeyForForm(form) {
  return `${form.book_id}|${form.start_chapter}|${form.end_chapter}`;
}

function chapterNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function analysisTaskName(query, book, form) {
  const text = String(query || "").trim();
  if (text) return `提问 · ${text.slice(0, 24)}`;
  const bookName = book?.book_name || book?.book_id || "分析任务";
  return `${bookName} ${form.start_chapter}-${form.end_chapter}`;
}

function defaultL2QueryIndexKeys(groups = []) {
  const nonBase = groups.find((group) => group.group_key && group.group_key !== BASE_INDEX_GROUP_KEY);
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
