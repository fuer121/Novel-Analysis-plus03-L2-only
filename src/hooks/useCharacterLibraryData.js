import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, characterLibraryUrl, charactersUrl, characterUrl, l1CoverageUrl, l2CoverageUrl } from "../api.js";
import { TERMINAL_TASK_STATUSES } from "../constants/taskStatus.js";

const CHARACTER_FILTERS = new Set(["all", "multi_stage", "incomplete"]);
const CHARACTER_SORTS = new Set(["name", "updated", "facts"]);

export function characterListQuery({ search = "", filter = "all", sort = "name" } = {}) {
  return {
    search: String(search || "").trim(),
    filter: CHARACTER_FILTERS.has(filter) ? filter : "all",
    sort: CHARACTER_SORTS.has(sort) ? sort : "name"
  };
}

export function characterSourceIncomplete({ chapterCount = 0, chapters = {}, failed = [], empty = [] } = {}) {
  return Number(chapters.completed || 0) < Number(chapterCount || 0)
    || Number(chapters.outdated || 0) > 0
    || failed.length > 0
    || empty.length > 0;
}

export function deriveCharacterLibraryPageState({
  chapterCount = 0,
  l1Completed = 0,
  hasCharacterGroup,
  l2Completed = 0,
  sourceIncomplete = false,
  library = null,
  task = null
} = {}) {
  if (Number(chapterCount) <= 0) return { kind: "no_chapters", sourceIncomplete };
  if (Number(l1Completed) <= 0) return { kind: "no_l1", sourceIncomplete };
  if (hasCharacterGroup === false) return { kind: "no_character_group", sourceIncomplete };
  if (Number(l2Completed) <= 0) return { kind: "no_character_facts", sourceIncomplete };
  if (task && !TERMINAL_TASK_STATUSES.includes(task.status)) return { kind: "building", sourceIncomplete };
  if (!library) return { kind: "library_missing", sourceIncomplete };
  if (library.status === "partial" || sourceIncomplete) return { kind: "partial", sourceIncomplete };
  return { kind: "ready", sourceIncomplete };
}

export function useCharacterLibraryData({ book, bookId, task }) {
  const [library, setLibrary] = useState(null);
  const [prerequisites, setPrerequisites] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const summaryRequestRef = useRef(0);
  const reloadRequestRef = useRef(0);
  const selectedIdRef = useRef("");
  const terminalTaskRef = useRef("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadSummary = useCallback(async () => {
    const requestId = ++summaryRequestRef.current;
    const chapterCount = Number(book?.chapter_count || 0);
    const range = { start_chapter: 1, end_chapter: Math.max(1, chapterCount) };
    const [libraryData, l1Data, groupsData] = await Promise.all([
      apiGet(characterLibraryUrl(bookId)),
      apiGet(l1CoverageUrl(bookId, range)),
      apiGet(`/api/books/${encodeURIComponent(bookId)}/index-groups?include_stats=1`)
    ]);
    const groups = groupsData.indexGroups || [];
    const characterGroup = groups.find((group) => group.group_key === "characters") || null;
    let l2Coverage = null;
    if (characterGroup) {
      l2Coverage = await apiGet(l2CoverageUrl(bookId, { ...range, index_group_key: "characters" }));
    }
    const chapters = l2Coverage?.coverage?.chapters || l2Coverage?.chapters || {};
    const failed = l2Coverage?.coverage?.failed_chapters || l2Coverage?.failed_chapters || [];
    const empty = l2Coverage?.coverage?.empty_chapters || l2Coverage?.empty_chapters || [];
    if (requestId !== summaryRequestRef.current) return;
    setLibrary(libraryData.library || null);
    setPrerequisites({
      chapterCount,
      l1Completed: Number(l1Data?.coverage?.chapters?.completed || l1Data?.chapters?.completed || 0),
      hasCharacterGroup: Boolean(characterGroup),
      l2Completed: Number(chapters.completed || 0),
      sourceIncomplete: characterSourceIncomplete({ chapterCount, chapters, failed, empty })
    });
  }, [book?.chapter_count, bookId]);

  const loadList = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet(charactersUrl(bookId, characterListQuery({ search: debouncedSearch, filter, sort })));
      if (requestId === listRequestRef.current) setCharacters(data.characters || []);
    } catch (loadError) {
      if (requestId === listRequestRef.current) setError(loadError.message);
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, [bookId, debouncedSearch, filter, sort]);

  const reload = useCallback(async () => {
    const requestId = ++reloadRequestRef.current;
    setError("");
    try {
      await Promise.all([loadSummary(), loadList()]);
    } catch (loadError) {
      if (requestId === reloadRequestRef.current) {
        setError(loadError.message);
        setLoading(false);
      }
    }
  }, [loadList, loadSummary]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const selectCharacter = useCallback(async (characterId) => {
    if (!characterId) return;
    selectedIdRef.current = characterId;
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const data = await apiGet(characterUrl(bookId, characterId));
      if (requestId === detailRequestRef.current) setSelectedCharacter(data.character || null);
    } catch (loadError) {
      if (requestId === detailRequestRef.current) {
        setSelectedCharacter(null);
        setDetailError(loadError.message.includes("not found") ? "角色已不存在" : loadError.message);
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [bookId]);

  const clearSelection = useCallback(() => {
    selectedIdRef.current = "";
    detailRequestRef.current += 1;
    setSelectedCharacter(null);
    setDetailError("");
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    const terminalKey = task && TERMINAL_TASK_STATUSES.includes(task.status) ? `${task.id}:${task.status}` : "";
    if (!terminalKey || terminalTaskRef.current === terminalKey) return;
    terminalTaskRef.current = terminalKey;
    void (async () => {
      await reload();
      if (selectedIdRef.current) await selectCharacter(selectedIdRef.current);
    })();
  }, [task, reload, selectCharacter]);

  const pageState = useMemo(() => prerequisites
    ? deriveCharacterLibraryPageState({ ...prerequisites, library, task })
    : { kind: "loading", sourceIncomplete: false }, [prerequisites, library, task]);

  return {
    library,
    pageState,
    characters,
    selectedCharacter,
    loading,
    detailLoading,
    error,
    detailError,
    search,
    filter,
    sort,
    setSearch,
    setFilter,
    setSort,
    selectCharacter,
    clearSelection,
    reload
  };
}
