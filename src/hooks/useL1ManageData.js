import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, l1ChaptersUrl, l1CoverageUrl } from "../api.js";
import { TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import { validChapterNumber } from "../utils/chapterRange.js";

/**
 * L1 管理页（#/book/:id/l1）的数据层：章节线索覆盖率与明细、提取规则加载/保存、
 * 保存后的重建编排。bookId 来自路由（页面按 key 重挂，hook 内视为稳定）。
 * App 的回调经 ref 读取最新闭包，避免加载副作用被函数身份变化反复触发。
 */
export function useL1ManageData({
  book,
  bookId,
  l1Task,
  onLoadBookIndexPrompts,
  onSaveBookIndexPrompts,
  onStartL1Index
}) {
  const { setError } = useAppContext();
  const [l1Coverage, setL1Coverage] = useState(null);
  const [l1Chapters, setL1Chapters] = useState([]);
  const [indexPrompts, setIndexPrompts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rebuildPrompt, setRebuildPrompt] = useState(null);
  const [l1Form, setL1Form] = useState({ start_chapter: "1", end_chapter: "1", force: false });

  const handlersRef = useRef(null);
  useEffect(() => {
    handlersRef.current = { onLoadBookIndexPrompts, onSaveBookIndexPrompts, onStartL1Index };
  });

  // 表单默认值取书籍章节范围（渲染期与前值比较后调整 state）
  const firstChapter = book?.first_chapter || 1;
  const lastChapter = book?.last_chapter || firstChapter;
  const rangeKey = `${bookId}|${firstChapter}|${lastChapter}`;
  const [seenRangeKey, setSeenRangeKey] = useState(null);
  if (rangeKey !== seenRangeKey) {
    setSeenRangeKey(rangeKey);
    setL1Form((form) => ({ ...form, start_chapter: String(firstChapter), end_chapter: String(lastChapter) }));
  }

  const l1TerminalTaskId = l1Task && TERMINAL_TASK_STATUSES.includes(l1Task.status) ? l1Task.id : null;

  // 加载覆盖率与线索明细；L1 任务到达终态时重拉一次
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    async function load() {
      try {
        const params = { start_chapter: firstChapter, end_chapter: lastChapter };
        const [coverageData, chaptersData] = await Promise.all([
          apiGet(l1CoverageUrl(bookId, params)),
          apiGet(l1ChaptersUrl(bookId, params))
        ]);
        if (cancelled) return;
        setL1Coverage(coverageData.coverage);
        setL1Chapters(chaptersData.chapters || []);
      } catch (error) {
        if (!cancelled) setError(error.message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId, firstChapter, lastChapter, l1TerminalTaskId, setError]);

  const loadPrompts = useCallback(async () => {
    if (!bookId) return;
    try {
      const data = await handlersRef.current.onLoadBookIndexPrompts(bookId);
      setIndexPrompts(data?.indexPrompts || null);
    } catch (error) {
      setError(error.message);
    }
  }, [bookId, setError]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  async function startBuild() {
    if (!validChapterNumber(l1Form.start_chapter) || !validChapterNumber(l1Form.end_chapter)) {
      setError("章节线索起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    await handlersRef.current.onStartL1Index({
      bookId,
      startChapter: Number(l1Form.start_chapter),
      endChapter: Number(l1Form.end_chapter),
      force: l1Form.force
    });
  }

  async function saveL1Prompt(prompt) {
    setSaving(true);
    setError("");
    try {
      await handlersRef.current.onSaveBookIndexPrompts(bookId, { l1_index_prompt: prompt });
      await loadPrompts();
      setRebuildPrompt({ type: "l1" });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function startRebuild({ startChapter, endChapter, force }) {
    await handlersRef.current.onStartL1Index({ bookId, startChapter, endChapter, force });
    setRebuildPrompt(null);
  }

  return {
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
  };
}
