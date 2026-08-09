import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, l2CoverageUrl } from "../api.js";
import { BASE_INDEX_GROUP_KEY, L2_INDEX_MODE_ALL } from "../constants/index.js";
import { TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";
import { useAppContext } from "../context/appContext.js";
import { navigate, paths, useRoute } from "../router.js";
import { validChapterNumber } from "../utils/chapterRange.js";
import { usePromptIndexGroups } from "./usePromptIndexGroups.js";

/**
 * L2 管理页（#/book/:id/l2）的数据层：抽屉主从的组选择（同步 ?g=）、组级统计
 * （优先 index-groups?include_stats=1，旧服务端无该字段时降级为逐组 coverage 并行拉取）、
 * 选中组的覆盖率/任务编排、规则保存与新建/删除。bookId 来自路由（页面按 key 重挂）。
 *
 * 选中组是全局唯一状态（usePromptIndexGroups 的 selectedIndexGroupKey，可为 base 组）：
 * 任务条、规则折叠与事实表都跟随它。
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
  const { query } = useRoute();
  const [indexGroups, setIndexGroups] = useState([]);
  const [indexPrompts, setIndexPrompts] = useState(null);
  const [l2Coverage, setL2Coverage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rebuildPrompt, setRebuildPrompt] = useState(null);
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
    } catch (error) {
      setError(error.message);
    }
  }, [bookId, setError, reconcileAfterLoad]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups, l2TerminalTaskId]);

  // ?g= 同步：URL 带有效组 key 时选中它（刷新/分享保持）；选中变化时写回 URL（replace，不滚动）
  const wantedGroupKey = String(query.g || "");
  useEffect(() => {
    if (!wantedGroupKey || !indexGroups.length) return;
    if (!indexGroups.some((group) => group.group_key === wantedGroupKey)) return;
    if (wantedGroupKey !== selectedIndexGroupKey) selectIndexGroup(wantedGroupKey);
  }, [wantedGroupKey, indexGroups, selectedIndexGroupKey, selectIndexGroup]);

  function selectGroup(groupKey) {
    selectIndexGroup(groupKey);
    if (groupKey && groupKey !== wantedGroupKey) {
      navigate(`${paths.l2(bookId)}?g=${encodeURIComponent(groupKey)}`, { replace: true, scroll: false });
    }
  }

  // 组级统计：响应带 stats 字段（服务端支持 include_stats）就直接用（useMemo 派生）；
  // 否则降级为逐组 coverage 并行拉取；再失败就只显示名称（stats 缺省）
  const serverGroupStats = useMemo(() => {
    if (!indexGroups.length) return null;
    if (!indexGroups.every((group) => group.stats && typeof group.stats === "object")) return null;
    const next = {};
    for (const group of indexGroups) next[group.group_key] = group.stats;
    return next;
  }, [indexGroups]);

  const [fetchedGroupStats, setFetchedGroupStats] = useState({});
  useEffect(() => {
    if (serverGroupStats || !bookId || !indexGroups.length) return undefined;
    let cancelled = false;
    Promise.all(indexGroups.map(async (group) => {
      try {
        const data = await apiGet(l2CoverageUrl(bookId, {
          start_chapter: firstChapter,
          end_chapter: lastChapter,
          index_group_key: group.group_key
        }));
        const chapters = data.coverage?.chapters || {};
        return [group.group_key, {
          facts_count: Number(chapters.facts || 0),
          built_chapters: Number(chapters.completed || 0),
          failed_chapters: Array.isArray(data.coverage?.failed_chapters) ? data.coverage.failed_chapters.length : 0
        }];
      } catch {
        return [group.group_key, null];
      }
    })).then((entries) => {
      if (cancelled) return;
      const next = {};
      for (const [key, stats] of entries) {
        if (stats) next[key] = stats;
      }
      setFetchedGroupStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, [serverGroupStats, bookId, indexGroups, firstChapter, lastChapter]);

  const groupStats = serverGroupStats || fetchedGroupStats;

  // 选中组的覆盖率（任务条与规则折叠共用同一口径）
  useEffect(() => {
    if (!bookId || !selectedIndexGroupKey) return;
    let cancelled = false;
    apiGet(l2CoverageUrl(bookId, {
      start_chapter: firstChapter,
      end_chapter: lastChapter,
      index_group_key: selectedIndexGroupKey
    }))
      .then((data) => {
        if (!cancelled) setL2Coverage(data.coverage || null);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, selectedIndexGroupKey, firstChapter, lastChapter, l2TerminalTaskId, setError]);

  async function startBuild() {
    if (!selectedIndexGroupKey) return;
    if (!validChapterNumber(l2Form.start_chapter) || !validChapterNumber(l2Form.end_chapter)) {
      setError("事实索引起始章节和结束章节必须填写为大于 0 的整数。");
      return;
    }
    await handlersRef.current.onStartL2Index({
      bookId,
      indexGroupKey: selectedIndexGroupKey,
      startChapter: Number(l2Form.start_chapter),
      endChapter: Number(l2Form.end_chapter),
      force: l2Form.force,
      mode: L2_INDEX_MODE_ALL
    });
  }

  // 只补跑失败章节：服务端 mode=retry_failed 会跳过非失败章节
  async function startRetryFailed() {
    if (!selectedIndexGroupKey) return;
    await handlersRef.current.onStartL2Index({
      bookId,
      indexGroupKey: selectedIndexGroupKey,
      startChapter: firstChapter,
      endChapter: lastChapter,
      force: false,
      mode: "retry_failed"
    });
  }

  // 只补跑空章（已完成但 0 条事实）：服务端 mode=retry_empty 会跳过非空章节
  async function startRetryEmpty() {
    if (!selectedIndexGroupKey) return;
    await handlersRef.current.onStartL2Index({
      bookId,
      indexGroupKey: selectedIndexGroupKey,
      startChapter: firstChapter,
      endChapter: lastChapter,
      force: false,
      mode: "retry_empty"
    });
  }

  // 重命名选中组（名称以外的字段原样回传，服务端按 merge 语义保留）
  async function renameSelectedGroup(name) {
    const trimmed = String(name || "").trim();
    if (!selectedIndexGroupKey || selectedIndexGroupKey === BASE_INDEX_GROUP_KEY || !trimmed) return;
    if (trimmed === selectedIndexGroup?.name) return;
    setSaving(true);
    setError("");
    try {
      await handlersRef.current.onUpdateBookIndexGroup(bookId, selectedIndexGroupKey, {
        ...(selectedIndexGroup || {}),
        name: trimmed
      });
      const groups = await handlersRef.current.onLoadBookIndexGroups(bookId);
      setIndexGroups(groups);
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
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
    selectedIndexGroup,
    selectedIndexGroupKey,
    indexGroupDraft,
    indexGroupBusy,
    selectGroup,
    startNewIndexGroup,
    updateIndexGroupDraft,
    saveIndexGroup,
    deleteIndexGroup,
    renameSelectedGroup,
    groupStats,
    l2Coverage,
    indexPrompts,
    saving,
    rebuildPrompt,
    setRebuildPrompt,
    l2Form,
    setL2Form,
    firstChapter,
    lastChapter,
    startBuild,
    startRetryFailed,
    startRetryEmpty,
    saveSpecializedL2Prompt,
    startRebuild
  };
}
