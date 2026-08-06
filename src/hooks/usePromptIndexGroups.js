import { useCallback, useMemo, useRef, useState } from "react";
import { factIndexName } from "../analysisCoverage.js";
import { BASE_INDEX_GROUP_KEY } from "../constants/index.js";

// 用途说明（description）字段已下线：服务端 normalizeBookIndexGroupPayload 中
// description 非必填（缺省 ''），更新时走 { ...current, ...payload } 合并并保留原值，
// 因此草稿与提交载荷都不再携带 description。
const emptyIndexGroupDraft = {
  group_key: "",
  name: "",
  category_scope: [],
  l2_index_prompt: ""
};

/**
 * 事实索引（index group）的选择、草稿与增删改。
 * handlersRef 保存最新的页面回调（App 每渲染生成新函数，经 ref 读取避免重复触发副作用）。
 */
export function usePromptIndexGroups({ selectedBookId, indexGroups, setIndexGroups, defaultL2Prompt, setError, handlersRef }) {
  const [selectedIndexGroupKey, setSelectedIndexGroupKeyState] = useState("");
  const [indexGroupDraft, setIndexGroupDraft] = useState(emptyIndexGroupDraft);
  const [indexGroupBusy, setIndexGroupBusy] = useState(false);
  // ref 镜像选中 key：reconcileAfterLoad 在 effect 闭包里可能拿到过期的 state
  const selectedIndexGroupKeyRef = useRef("");
  const setSelectedIndexGroupKey = useCallback((key) => {
    selectedIndexGroupKeyRef.current = key;
    setSelectedIndexGroupKeyState(key);
  }, []);

  const editableIndexGroups = useMemo(
    () => indexGroups.filter((group) => group.group_key !== BASE_INDEX_GROUP_KEY),
    [indexGroups]
  );

  // 选中项可以是任意组（含 base 默认组，只读展示）；reconcile 负责保证 key 始终有效
  const selectedIndexGroup = indexGroups.find((group) => group.group_key === selectedIndexGroupKey) || null;

  // 书籍数据加载完成后对齐选择：保留仍存在的选中项，否则落到第一个可编辑索引，
  // 再退到 base 默认组；草稿同步回填为选中组内容（否则右侧面板只显示 placeholder）
  const reconcileAfterLoad = useCallback((indexGroupRows) => {
    const current = selectedIndexGroupKeyRef.current;
    const nextGroup = indexGroupRows.find((group) => group.group_key === current)
      || indexGroupRows.find((group) => group.group_key !== BASE_INDEX_GROUP_KEY)
      || indexGroupRows[0]
      || null;
    setSelectedIndexGroupKey(nextGroup?.group_key || "");
    setIndexGroupDraft(nextGroup ? groupToDraft(nextGroup) : emptyIndexGroupDraft);
  }, [setSelectedIndexGroupKey]);

  function selectIndexGroup(groupKey) {
    const group = indexGroups.find((entry) => entry.group_key === groupKey);
    setSelectedIndexGroupKey(groupKey);
    setIndexGroupDraft(!group ? emptyIndexGroupDraft : groupToDraft(group));
  }

  function startNewIndexGroup() {
    setSelectedIndexGroupKey("");
    setIndexGroupDraft({
      ...emptyIndexGroupDraft,
      l2_index_prompt: defaultL2Prompt || ""
    });
  }

  function updateIndexGroupDraft(patch) {
    setIndexGroupDraft((current) => ({ ...current, ...patch }));
  }

  async function saveIndexGroup() {
    if (!selectedBookId) return;
    if (selectedIndexGroupKey === BASE_INDEX_GROUP_KEY) {
      setError("默认索引不可编辑。");
      return;
    }
    if (!indexGroupDraft.name.trim()) {
      setError("事实索引名称不能为空。");
      return;
    }
    setIndexGroupBusy(true);
    setError("");
    try {
      const creating = !selectedIndexGroupKey;
      const rawGroupKey = creating
        ? (indexGroupDraft.group_key || slugifyIndexGroupKey(indexGroupDraft.name))
        : selectedIndexGroupKey;
      const nextGroupKey = creating
        ? resolveAvailableIndexGroupKey(rawGroupKey, indexGroups)
        : normalizeIndexGroupKeyClient(rawGroupKey);
      const payload = {
        group_key: nextGroupKey,
        name: indexGroupDraft.name,
        category_scope: indexGroupDraft.category_scope,
        trigger_keywords: [],
        l2_index_prompt: indexGroupDraft.l2_index_prompt
      };
      const saved = selectedIndexGroupKey
        ? await handlersRef.current.onUpdateBookIndexGroup(selectedBookId, selectedIndexGroupKey, payload)
        : await handlersRef.current.onCreateBookIndexGroup(selectedBookId, payload);
      const groups = await handlersRef.current.onLoadBookIndexGroups(selectedBookId);
      setIndexGroups(groups);
      setSelectedIndexGroupKey(saved.group_key);
      const savedGroup = groups.find((entry) => entry.group_key === saved.group_key) || saved;
      setIndexGroupDraft(groupToDraft(savedGroup));
    } catch (error) {
      setError(error.message);
    } finally {
      setIndexGroupBusy(false);
    }
  }

  async function deleteIndexGroup() {
    if (!selectedBookId || !selectedIndexGroupKey || selectedIndexGroupKey === BASE_INDEX_GROUP_KEY) return;
    const group = indexGroups.find((entry) => entry.group_key === selectedIndexGroupKey);
    if (!window.confirm(`删除事实索引《${factIndexName(group) || selectedIndexGroupKey}》？`)) return;
    setIndexGroupBusy(true);
    setError("");
    try {
      await handlersRef.current.onDeleteBookIndexGroup(selectedBookId, selectedIndexGroupKey);
      const groups = await handlersRef.current.onLoadBookIndexGroups(selectedBookId);
      setIndexGroups(groups);
      const fallback = groups.find((entry) => entry.group_key !== BASE_INDEX_GROUP_KEY) || null;
      setSelectedIndexGroupKey(fallback?.group_key || "");
      setIndexGroupDraft(fallback ? groupToDraft(fallback) : emptyIndexGroupDraft);
    } catch (error) {
      setError(error.message);
    } finally {
      setIndexGroupBusy(false);
    }
  }

  return {
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
  };
}

function groupToDraft(group) {
  return {
    group_key: group.group_key || "",
    name: group.name || "",
    category_scope: group.category_scope || [],
    l2_index_prompt: group.l2_index_prompt || ""
  };
}

export function slugifyIndexGroupKey(value) {
  const text = String(value || "").trim().toLowerCase();
  const ascii = text
    .replace(/修炼|境界|功法/g, "cultivation")
    .replace(/法宝|武器|本命物|物品/g, "items")
    .replace(/人物|角色/g, "characters")
    .replace(/关系/g, "relationships")
    .replace(/宗门|势力|组织/g, "forces")
    .replace(/地点|地图/g, "locations")
    .replace(/事件|剧情/g, "events")
    .replace(/伏笔|线索/g, "foreshadowing")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return ascii || "custom-index";
}

export function normalizeIndexGroupKeyClient(value) {
  const raw = String(value || "").trim().toLowerCase();
  const key = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return key || "custom-index";
}

export function resolveAvailableIndexGroupKey(rawValue, groups) {
  const baseKey = normalizeIndexGroupKeyClient(rawValue);
  const used = new Set((groups || []).map((group) => normalizeIndexGroupKeyClient(group.group_key)));
  if (!used.has(baseKey)) return baseKey;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = normalizeIndexGroupKeyClient(`${baseKey}-${index}`);
    if (!used.has(candidate)) return candidate;
  }
  return `${baseKey}-${Date.now()}`;
}
