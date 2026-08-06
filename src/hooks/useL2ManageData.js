import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, l2CoverageUrl, l2FactsUrl } from "../api.js";
import { BASE_INDEX_GROUP_KEY, L2_INDEX_MODE_ALL } from "../constants/index.js";
import { TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import { validChapterNumber } from "../utils/chapterRange.js";
import { usePromptIndexGroups } from "./usePromptIndexGroups.js";

/**
 * L2 管理页（#/book/:id/l2）的数据层：索引组增删改与规则编辑（复用 usePromptIndexGroups）、
 * 构建面板的覆盖率/事实明细、保存规则后的重建编排。bookId 来自路由（页面按 key 重挂）。
 *
 * 构建面板的分组选择（buildGroupKey）与规则编辑的分组选择（usePromptIndexGroups，
 * 不含 base 组）相互独立：构建可以面向任意组（含 base），规则编辑只面向可编辑组。
 */
export function useL2ManageData({
  book,
  bookId,
  l2Task,
  onLoadBookIndexPrompts,
  onLoadBookIndexGroups,
  onCreateBookIndexGroup,
  onUpdateBookIndexGroup,
  onDeleteBookIndexGroup,
  onStartL2Index
}) {
  const { setError } = useAppContext();
  const [indexGroups, setIndexGroups] = useState([]);
  const [indexPrompts, setIndexPrompts] = useState(null);
  const [ruleCoverage, setRuleCoverage] = useState(null);
  const [l2Coverage, setL2Coverage] = useState(null);
  const [l2Facts, setL2Facts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [rebuildPrompt, setRebuildPrompt] = useState(null);
  const [buildGroupKey, setBuildGroupKey] = useState("");
  const [l2Form, setL2Form] = useState({ start_chapter: "1", end_chapter: "1", force: false });

  const handlersRef = useRef(null);
  useEffect(() => {
    handlersRef.current = {
      onLoadBookIndexPrompts,
      onLoadBookIndexGroups,
      onCreateBookIndexGroup,
      onUpdateBookIndexGroup,
      onDeleteBookIndexGroup,
      onStartL2Index
    };
  });

  // 表单默认值取书籍章节范围（渲染期与前值比较后调整 state）
  const firstChapter = book?.first_chapter || 1;
  const lastChapter = book?.last_chapter || firstChapter;
  const rangeKey = `${bookId}|${firstChapter}|${lastChapter}`;
  const [seenRangeKey, setSeenRangeKey] = useState(null);
  if (rangeKey !== seenRangeKey) {
    setSeenRangeKey(rangeKey);
    setL2Form((form) => ({ ...form, start_chapter: String(firstChapter), end_chapter: String(lastChapter) }));
  }

  const {
    editableIndexGroups,
    selectedIndexGroup,
    selectedIndexGroupKey,
    indexGroupDraft,
    indexGroupBusy,
    reconcileAfterLoad,
    selectIndexGroup,
    startNewIndexGroup,
    updateIndexGroupDraft,
    saveIndexGroup,
    deleteIndexGroup
  } = usePromptIndexGroups({
    selectedBookId: bookId,
    indexGroups,
    setIndexGroups,
    defaultL2Prompt: indexPrompts?.l2_index_prompt || "",
    setError,
    handlersRef
  });

  const l2TerminalTaskId = l2Task && TERMINAL_TASK_STATUSES.includes(l2Task.status) ? l2Task.id : null;

  const loadGroups = useCallback(async () => {
    if (!bookId) return;
    try {
      const [promptData, groups] = await Promise.all([
        handlersRef.current.onLoadBookIndexPrompts(bookId),
        handlersRef.current.onLoadBookIndexGroups(bookId)
      ]);
      setIndexPrompts(promptData?.indexPrompts || null);
      setIndexGroups(groups);
      reconcileAfterLoad(groups);
      setBuildGroupKey((current) => (
        groups.some((group) => group.group_key === current)
          ? current
          : (groups.find((group) => group.group_key !== BASE_INDEX_GROUP_KEY)?.group_key || groups[0]?.group_key || BASE_INDEX_GROUP_KEY)
      ));
    } catch (error) {
      setError(error.message);
    }
  }, [bookId, setError, reconcileAfterLoad]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups, l2TerminalTaskId]);

  // 构建面板：选中分组或范围变化、或 L2 任务到达终态时，加载覆盖率与事实明细
  useEffect(() => {
    if (!bookId || !buildGroupKey) return;
    let cancelled = false;
    async function load() {
      try {
        const params = {
          start_chapter: firstChapter,
          end_chapter: lastChapter,
          index_group_key: buildGroupKey,
          limit: 80
        };
        const [coverageData, factsData] = await Promise.all([
          apiGet(l2CoverageUrl(bookId, params)),
          apiGet(l2FactsUrl(bookId, params))
        ]);
        if (cancelled) return;
        setL2Coverage(coverageData.coverage);
        setL2Facts(factsData.facts || []);
      } catch (error) {
        if (!cancelled) setError(error.message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookId, buildGroupKey, firstChapter, lastChapter, l2TerminalTaskId, setError]);

  const buildGroup = indexGroups.find((group) => group.group_key === buildGroupKey) || null;

  // 规则编辑面板：覆盖率跟随选中的编辑组（index-prompts 响应的 coverage.l2 固定是
  // base 组口径，与选中组无关，因此这里按 selectedIndexGroupKey 单独查）
  useEffect(() => {
    if (!bookId || !selectedIndexGroupKey) return;
    let cancelled = false;
    apiGet(l2CoverageUrl(bookId, {
      start_chapter: firstChapter,
      end_chapter: lastChapter,
      index_group_key: selectedIndexGroupKey
    }))
      .then((data) => {
        if (!cancelled) setRuleCoverage(data.coverage || null);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, selectedIndexGroupKey, firstChapter, lastChapter, l2TerminalTaskId, setError]);

  async function startBuild() {
    if (!validChapterNumber(l2Form.start_chapter) || !validChapterNumber(l2Form.end_chapter)) {
      setError("事实索引起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    await handlersRef.current.onStartL2Index({
      bookId,
      indexGroupKey: buildGroupKey,
      startChapter: Number(l2Form.start_chapter),
      endChapter: Number(l2Form.end_chapter),
      force: l2Form.force,
      mode: L2_INDEX_MODE_ALL
    });
  }

  async function saveSpecializedL2Prompt(prompt) {
    if (!selectedIndexGroupKey || selectedIndexGroupKey === BASE_INDEX_GROUP_KEY) return;
    setSaving(true);
    setError("");
    try {
      const group = indexGroups.find((entry) => entry.group_key === selectedIndexGroupKey);
      await handlersRef.current.onUpdateBookIndexGroup(bookId, selectedIndexGroupKey, {
        ...(group || {}),
        l2_index_prompt: prompt
      });
      const groups = await handlersRef.current.onLoadBookIndexGroups(bookId);
      setIndexGroups(groups);
      setRebuildPrompt({ type: "l2" });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function startRebuild({ startChapter, endChapter, force }) {
    await handlersRef.current.onStartL2Index({
      bookId,
      indexGroupKey: selectedIndexGroupKey,
      startChapter,
      endChapter,
      force,
      mode: L2_INDEX_MODE_ALL
    });
    setRebuildPrompt(null);
  }

  return {
    indexGroups,
    editableIndexGroups,
    selectedIndexGroup,
    selectedIndexGroupKey,
    indexGroupDraft,
    indexGroupBusy,
    selectIndexGroup,
    startNewIndexGroup,
    updateIndexGroupDraft,
    saveIndexGroup,
    deleteIndexGroup,
    buildGroupKey,
    setBuildGroupKey,
    buildGroup,
    l2Coverage,
    l2Facts,
    l2PromptCoverage: ruleCoverage,
    saving,
    rebuildPrompt,
    setRebuildPrompt,
    l2Form,
    setL2Form,
    startBuild,
    saveSpecializedL2Prompt,
    startRebuild
  };
}
