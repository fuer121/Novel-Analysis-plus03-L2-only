import { useEffect, useMemo, useState } from "react";
import {
  BookPlus,
  Copy,
  Database,
  Folder,
  Lightbulb,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCcw,
  Save,
  Trash2
} from "lucide-react";
import { formatTime } from "../api.js";
import { IconButton, Panel } from "../ui.jsx";

const emptyIndexGroupDraft = {
  group_key: "",
  name: "",
  description: "",
  category_scope: [],
  l2_index_prompt: ""
};

const emptyBookForm = { book_id: "", book_name: "" };

const l1WritingTips = [
  "章节线索只判断章节是否值得继续读取，不写深度设定集。",
  "所有内容贴近本章原文，禁止补全和脑补。",
  "优先记录主体、别名、关键词和分类信号。",
  "控制长度，结构清晰，不堆流水账。",
  "服务所有事实索引，信号要稳定可复用。"
];

const l2WritingTips = [
  "事实索引只抽可复用事实，不写章节摘要。",
  "主体、别名、相关主体要稳定，方便后续召回。",
  "事实颗粒要小而完整，避免把多件事揉成一条。",
  "每条事实保留证据摘记、重要度和置信度。",
  "分类服务分析目标，当前重点是人物、关系、修行、剑与本命物。"
];

export function PromptLibraryPage({
  books,
  onCreateBook,
  onBooksChanged,
  onLoadBookIndexPrompts,
  onSaveBookIndexPrompts,
  onLoadBookIndexGroups,
  onCreateBookIndexGroup,
  onUpdateBookIndexGroup,
  onDeleteBookIndexGroup,
  onStartL1Index,
  onStartL2Index,
  setError
}) {
  const [selectedBookId, setSelectedBookId] = useState(() => bookIdFromUrl() || books[0]?.book_id || "");
  const [bookForm, setBookForm] = useState(emptyBookForm);
  const [showBookForm, setShowBookForm] = useState(false);
  const [creatingBook, setCreatingBook] = useState(false);
  const [indexData, setIndexData] = useState(null);
  const [indexGroups, setIndexGroups] = useState([]);
  const [selectedIndexGroupKey, setSelectedIndexGroupKey] = useState("");
  const [indexGroupDraft, setIndexGroupDraft] = useState(emptyIndexGroupDraft);
  const [indexGroupBusy, setIndexGroupBusy] = useState(false);
  const [indexSaving, setIndexSaving] = useState({ l1: false, l2: false });
  const [rebuildPrompt, setRebuildPrompt] = useState(null);

  const selectedBook = useMemo(
    () => books.find((book) => book.book_id === selectedBookId) || null,
    [books, selectedBookId]
  );

  const editableIndexGroups = useMemo(
    () => indexGroups.filter((group) => group.group_key !== "base"),
    [indexGroups]
  );

  useEffect(() => {
    if (!selectedBookId && books[0]?.book_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedBookId(books[0].book_id);
    }
  }, [books, selectedBookId]);

  useEffect(() => {
    if (!selectedBookId) return;
    void loadBookPromptState(selectedBookId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBookId]);

  async function loadBookPromptState(bookId) {
    setError("");
    try {
      const [indexResponse, indexGroupRows] = await Promise.all([
        onLoadBookIndexPrompts(bookId),
        onLoadBookIndexGroups(bookId)
      ]);
      setIndexData(indexResponse);
      setIndexGroups(indexGroupRows);
      setSelectedIndexGroupKey((current) => (
        indexGroupRows.some((group) => group.group_key !== "base" && group.group_key === current)
          ? current
          : (indexGroupRows.find((group) => group.group_key !== "base")?.group_key || "")
      ));
      setIndexGroupDraft(emptyIndexGroupDraft);
    } catch (error) {
      setError(error.message);
    }
  }

  async function refreshAll() {
    await onBooksChanged();
    if (selectedBookId) await loadBookPromptState(selectedBookId);
  }

  async function createBook() {
    if (!bookForm.book_id.trim()) {
      setError("小说 ID 不能为空。");
      return;
    }
    setCreatingBook(true);
    setError("");
    try {
      const book = await onCreateBook(bookForm);
      setBookForm(emptyBookForm);
      setShowBookForm(false);
      setSelectedBookId(book.book_id);
    } catch (error) {
      setError(error.message);
    } finally {
      setCreatingBook(false);
    }
  }

  async function saveIndexPrompt(type, prompt) {
    if (!selectedBookId) return;
    setIndexSaving((state) => ({ ...state, [type]: true }));
    setError("");
    try {
      const payload = type === "l1" ? { l1_index_prompt: prompt } : { l2_index_prompt: prompt };
      const saved = await onSaveBookIndexPrompts(selectedBookId, payload);
      const refreshed = await onLoadBookIndexPrompts(selectedBookId);
      setIndexData(refreshed);
      if (type === "l2") setIndexGroups(await onLoadBookIndexGroups(selectedBookId));
      setRebuildPrompt({ type, indexPrompts: saved });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setIndexSaving((state) => ({ ...state, [type]: false }));
    }
  }

  async function saveSpecializedL2Prompt(prompt) {
    if (!selectedBookId || !selectedIndexGroupKey) return;
    setIndexSaving((state) => ({ ...state, l2: true }));
    setError("");
    try {
      const group = indexGroups.find((entry) => entry.group_key === selectedIndexGroupKey);
      await onUpdateBookIndexGroup(selectedBookId, selectedIndexGroupKey, {
        ...(group || {}),
        l2_index_prompt: prompt
      });
      const groups = await onLoadBookIndexGroups(selectedBookId);
      setIndexGroups(groups);
      setRebuildPrompt({ type: "l2" });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setIndexSaving((state) => ({ ...state, l2: false }));
    }
  }

  async function startRebuild({ type, startChapter, endChapter, force }) {
    if (!selectedBookId) return;
    if (type === "l1") {
      await onStartL1Index({ bookId: selectedBookId, startChapter, endChapter, force });
    } else {
      await onStartL2Index({ bookId: selectedBookId, indexGroupKey: selectedIndexGroupKey, startChapter, endChapter, force, mode: "all" });
    }
    setRebuildPrompt(null);
  }

  async function saveIndexGroup() {
    if (!selectedBookId) return;
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
        description: indexGroupDraft.description,
        category_scope: indexGroupDraft.category_scope,
        trigger_keywords: [],
        l2_index_prompt: indexGroupDraft.l2_index_prompt
      };
      const saved = selectedIndexGroupKey
        ? await onUpdateBookIndexGroup(selectedBookId, selectedIndexGroupKey, payload)
        : await onCreateBookIndexGroup(selectedBookId, payload);
      const groups = await onLoadBookIndexGroups(selectedBookId);
      setIndexGroups(groups);
      setSelectedIndexGroupKey(saved.group_key);
      setIndexGroupDraft(emptyIndexGroupDraft);
    } catch (error) {
      setError(error.message);
    } finally {
      setIndexGroupBusy(false);
    }
  }

  async function deleteIndexGroup() {
    if (!selectedBookId || !selectedIndexGroupKey) return;
    const group = indexGroups.find((entry) => entry.group_key === selectedIndexGroupKey);
    if (!window.confirm(`删除事实索引《${factIndexName(group) || selectedIndexGroupKey}》？`)) return;
    setIndexGroupBusy(true);
    setError("");
    try {
      await onDeleteBookIndexGroup(selectedBookId, selectedIndexGroupKey);
      const groups = await onLoadBookIndexGroups(selectedBookId);
      setIndexGroups(groups);
      setSelectedIndexGroupKey(groups.find((entry) => entry.group_key !== "base")?.group_key || "");
      setIndexGroupDraft(emptyIndexGroupDraft);
    } catch (error) {
      setError(error.message);
    } finally {
      setIndexGroupBusy(false);
    }
  }

  const indexPrompts = indexData?.indexPrompts || null;
  const l1Coverage = indexData?.coverage?.l1 || null;
  const l2Coverage = indexData?.coverage?.l2 || null;
  const selectedIndexGroup = editableIndexGroups.find((group) => group.group_key === selectedIndexGroupKey) || editableIndexGroups[0] || null;
  const activeL2Prompt = selectedIndexGroup?.l2_index_prompt || "";
  const activeL2Hash = selectedIndexGroup?.l2_index_prompt_hash || "";
  const activeL2UpdatedAt = selectedIndexGroup?.updated_at || "";

  return (
    <section className="prompt-workbench">
      <header className="page-hero">
        <div>
          <span>索引工作台</span>
          <h2>索引与事实库</h2>
          <p>维护书籍的章节线索规则、事实索引规则和多个事实索引。普通运营按业务用途管理，高级细节保留在规则内容里。</p>
        </div>
        <div className="page-hero-actions">
          <IconButton icon={RefreshCcw} label="刷新" onClick={refreshAll} />
        </div>
      </header>

      <div className="prompt-workbench-grid">
        <aside className="prompt-book-column">
          <Panel icon={Folder} title="书籍">
            <div className="book-tabs-row">
              {books.map((book) => (
                <button
                  key={book.book_id}
                  type="button"
                  className={book.book_id === selectedBookId ? "book-tab active" : "book-tab"}
                  onClick={() => setSelectedBookId(book.book_id)}
                >
                  <strong>{book.book_name || book.book_id}</strong>
                  <span>{book.chapter_count || 0} 章 · {book.book_id}</span>
                </button>
              ))}
            </div>
            {showBookForm ? (
              <div className="form-grid new-book-grid">
                <label>
                  <span>小说 ID</span>
                  <input value={bookForm.book_id} onChange={(event) => setBookForm({ ...bookForm, book_id: event.target.value })} />
                </label>
                <label>
                  <span>书籍名称</span>
                  <input value={bookForm.book_name} onChange={(event) => setBookForm({ ...bookForm, book_name: event.target.value })} />
                </label>
                <div className="new-book-actions">
                  <button className="secondary inline" type="button" onClick={createBook} disabled={creatingBook}>
                    {creatingBook ? <Loader2 className="spin" size={16} /> : <BookPlus size={16} />}
                    保存
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      setBookForm(emptyBookForm);
                      setShowBookForm(false);
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button className="secondary new-book-trigger" type="button" onClick={() => setShowBookForm(true)}>
                <BookPlus size={16} />
                新建书籍
              </button>
            )}
          </Panel>
        </aside>

        <section className="prompt-index-column">
          <Panel icon={Database} title="索引规则" action={<PromptBookMeta book={selectedBook} />}>
            {!selectedBookId || !indexPrompts ? (
              <div className="empty-state">选择书籍</div>
            ) : (
              <div className="index-prompt-stack">
                <IndexPromptEditor
                  key={`l1-${selectedBookId}-${indexPrompts.l1_index_prompt_hash}-${indexPrompts.updated_at}`}
                  type="l1"
                  title="章节线索规则"
                  value={indexPrompts.l1_index_prompt}
                  hash={indexPrompts.l1_index_prompt_hash}
                  updatedAt={indexPrompts.updated_at}
                  coverage={l1Coverage}
                  saving={indexSaving.l1}
                  onSave={(prompt) => saveIndexPrompt("l1", prompt)}
                />
                {selectedIndexGroup ? (
                  <IndexPromptEditor
                    key={`l2-${selectedBookId}-${selectedIndexGroupKey}-${activeL2Hash}-${activeL2UpdatedAt}`}
                    type="l2"
                    title={`事实索引规则 · ${factIndexName(selectedIndexGroup)}`}
                    value={activeL2Prompt}
                    hash={activeL2Hash}
                    updatedAt={activeL2UpdatedAt}
                    coverage={l2Coverage}
                    saving={indexSaving.l2}
                    onSave={(prompt) => saveSpecializedL2Prompt(prompt)}
                  />
                ) : (
                  <div className="empty-state">先新建事实索引，再编辑对应规则</div>
                )}
                <IndexGroupManager
                  groups={editableIndexGroups}
                  selectedKey={selectedIndexGroupKey}
                  draft={indexGroupDraft}
                  busy={indexGroupBusy}
                  onSelect={(groupKey) => {
                    const group = editableIndexGroups.find((entry) => entry.group_key === groupKey);
                    setSelectedIndexGroupKey(groupKey);
                    setIndexGroupDraft(!group ? emptyIndexGroupDraft : groupToDraft(group));
                  }}
                  onNew={() => {
                    setSelectedIndexGroupKey("");
                    setIndexGroupDraft({
                      ...emptyIndexGroupDraft,
                      l2_index_prompt: indexPrompts?.l2_index_prompt || ""
                    });
                  }}
                  onDraftChange={(patch) => setIndexGroupDraft((current) => ({ ...current, ...patch }))}
                  onSave={saveIndexGroup}
                  onDelete={deleteIndexGroup}
                />
                {rebuildPrompt ? (
                  <RebuildConfirm
                    type={rebuildPrompt.type}
                    book={selectedBook}
                    onCancel={() => setRebuildPrompt(null)}
                    onStart={startRebuild}
                  />
                ) : null}
              </div>
            )}
          </Panel>
        </section>
      </div>
    </section>
  );
}

function PromptBookMeta({ book }) {
  if (!book) return <div className="stats"><span>未选择书籍</span></div>;
  return (
    <div className="stats">
      <span>{book.book_name || book.book_id}</span>
      <span>{book.chapter_count || 0} 章</span>
    </div>
  );
}

function IndexPromptEditor({ type, title, description, value, updatedAt, coverage, saving, onSave }) {
  const [locked, setLocked] = useState(true);
  const [draftState, setDraftState] = useState({ source: value, draft: value });
  const syncedDraftState = draftState.source === value ? draftState : { source: value, draft: value };
  const draft = syncedDraftState.draft;
  const tipConfig = type === "l1"
    ? { title: "章节线索建议", tips: l1WritingTips }
    : type === "l2"
      ? { title: "事实索引建议", tips: l2WritingTips }
      : null;

  function setDraft(nextDraft) {
    setDraftState({ source: value, draft: nextDraft });
  }

  async function handleSave() {
    try {
      await onSave(draft);
      setLocked(true);
    } catch {
      // Parent owns the user-facing error.
    }
  }

  return (
    <div className="index-prompt-card">
      <div className="index-prompt-head">
        <div>
          <div className="index-prompt-title-row">
            <h3>{title}</h3>
            {tipConfig ? <PromptTipPopover tips={tipConfig.tips} title={tipConfig.title} /> : null}
          </div>
          <small>更新 {formatTime(updatedAt)}</small>
        </div>
        <button
          className="secondary inline index-lock-button"
          type="button"
          onClick={() => {
            if (!locked) setDraftState({ source: value, draft: value });
            setLocked((state) => !state);
          }}
        >
          {locked ? <Lock size={15} /> : <LockOpen size={15} />}
          {locked ? "解锁" : "锁定"}
        </button>
      </div>
      {description ? <p className="index-prompt-description">{description}</p> : null}
      <IndexCoverageLine coverage={coverage} />
      <textarea
        value={draft}
        readOnly={locked}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={title}
      />
      {!locked ? (
        <div className="action-row wrap">
          <button className="primary inline" type="button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="spin" size={15} /> : null}
            保存
          </button>
        </div>
      ) : null}
    </div>
  );
}

function IndexGroupManager({ groups, selectedKey, draft, busy, onSelect, onNew, onDraftChange, onSave, onDelete }) {
  const isCreating = !selectedKey;
  const previewRawKey = draft.group_key || slugifyIndexGroupKey(draft.name);
  const previewKey = resolveAvailableIndexGroupKey(previewRawKey, groups);
  const previewBaseKey = normalizeIndexGroupKeyClient(previewRawKey);
  const previewAdjusted = isCreating && previewBaseKey !== previewKey;
  return (
    <div className="index-group-manager">
      <div className="index-group-head">
        <div>
          <strong>事实索引</strong>
          <span>每个事实索引只负责一类稳定分析方向</span>
        </div>
        <div className="index-group-head-actions">
          <button className="secondary inline index-group-new-button" type="button" onClick={onNew}>
            <Plus size={14} />
            新建事实索引
          </button>
        </div>
      </div>
      {groups.length ? (
        <div className="index-group-tabs">
          {groups.map((group) => (
            <button
              key={group.group_key}
              type="button"
              className={group.group_key === selectedKey ? "active" : ""}
              onClick={() => onSelect(group.group_key)}
            >
              <strong>{factIndexName(group)}</strong>
            </button>
          ))}
        </div>
      ) : null}
      {isCreating || selectedKey ? (
        <div className="index-group-editor">
          <div className="form-grid compact">
            <label>
              <span>名称</span>
              <input value={draft.name} placeholder="修炼法宝事实索引" onChange={(event) => onDraftChange({ name: event.target.value })} />
            </label>
          </div>
          {isCreating ? (
            <div className="muted-line">
              索引 key：{previewKey}
              {previewAdjusted ? `（${previewBaseKey} 已存在，自动避让）` : ""}
            </div>
          ) : null}
          <label className="block-label hidden">
            <span>用途说明</span>
            <textarea value={draft.description} placeholder="说明这个事实索引负责哪些内容。" onChange={(event) => onDraftChange({ description: event.target.value })} />
          </label>
          <label className="block-label">
            <span>事实索引规则</span>
            <textarea value={draft.l2_index_prompt} placeholder="写清楚这个事实索引只提取哪些可复用事实。" onChange={(event) => onDraftChange({ l2_index_prompt: event.target.value })} />
          </label>
          <div className="index-group-actions">
            <div className="action-row wrap">
              <button className="secondary inline index-group-save-button" type="button" onClick={onSave} disabled={busy}>
                {busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                保存事实索引
              </button>
              {!isCreating ? (
                <button className="danger inline" type="button" onClick={onDelete} disabled={busy}>
                  <Trash2 size={15} />
                  删除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function slugifyIndexGroupKey(value) {
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

function normalizeIndexGroupKeyClient(value) {
  const raw = String(value || "").trim().toLowerCase();
  const key = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return key || "custom-index";
}

function resolveAvailableIndexGroupKey(rawValue, groups) {
  const baseKey = normalizeIndexGroupKeyClient(rawValue);
  const used = new Set((groups || []).map((group) => normalizeIndexGroupKeyClient(group.group_key)));
  if (!used.has(baseKey)) return baseKey;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = normalizeIndexGroupKeyClient(`${baseKey}-${index}`);
    if (!used.has(candidate)) return candidate;
  }
  return `${baseKey}-${Date.now()}`;
}

function PromptTipPopover({ title, tips }) {
  const [pinned, setPinned] = useState(false);
  const text = tips.map((tip, index) => `${index + 1}. ${tip}`).join("\n");

  function copyTips() {
    void navigator.clipboard?.writeText(text);
  }

  return (
    <div className={pinned ? "prompt-tip-popover pinned" : "prompt-tip-popover"}>
      <button
        className="prompt-tip-trigger"
        type="button"
        aria-expanded={pinned}
        aria-label={title}
        onClick={() => setPinned((state) => !state)}
      >
        <Lightbulb size={14} />
        建议
      </button>
      <div className="prompt-tip-panel" role="tooltip">
        <div className="prompt-tip-head">
          <strong>{title}</strong>
          <div className="prompt-tip-actions">
            <button type="button" onClick={copyTips}>
              <Copy size={13} />
              复制
            </button>
            <button type="button" onClick={() => setPinned(false)}>
              收起
            </button>
          </div>
        </div>
        <ol>
          {tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ol>
      </div>
    </div>
  );
}

function IndexCoverageLine({ coverage }) {
  const chapters = coverage?.chapters;
  if (!chapters) return <div className="muted-line">读取中</div>;
  const ratio = chapters.total ? Math.round((chapters.completed / chapters.total) * 100) : 0;
  const stale = Number(chapters.outdated || 0);
  return (
    <div className={stale ? "inline-warning" : "muted-line"}>
      覆盖 {chapters.completed}/{chapters.total} 章 · {ratio}%
      {stale ? ` · 过期 ${stale} 章` : ""}
    </div>
  );
}

function RebuildConfirm({ type, book, onCancel, onStart }) {
  const first = book?.first_chapter || 1;
  const last = book?.last_chapter || first;
  const [form, setForm] = useState({ start_chapter: String(first), end_chapter: String(last), force: true });
  const label = type === "l1" ? "章节线索规则" : "事实索引规则";

  function submit() {
    const startChapter = Number(form.start_chapter);
    const endChapter = Number(form.end_chapter);
    if (!Number.isInteger(startChapter) || startChapter <= 0 || !Number.isInteger(endChapter) || endChapter <= 0) return;
    onStart({ type, startChapter, endChapter, force: form.force });
  }

  return (
    <div className="rebuild-confirm">
      <strong>{label}已保存</strong>
      <p>选择范围后可立即重新准备索引。</p>
      <div className="form-grid compact">
        <label>
          <span>起始章节</span>
          <input value={form.start_chapter} onChange={(event) => setForm({ ...form, start_chapter: sanitizeChapterInput(event.target.value) })} />
        </label>
        <label>
          <span>结束章节</span>
          <input value={form.end_chapter} onChange={(event) => setForm({ ...form, end_chapter: sanitizeChapterInput(event.target.value) })} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={form.force} onChange={(event) => setForm({ ...form, force: event.target.checked })} />
          <span>强制重建</span>
        </label>
      </div>
      <div className="action-row wrap">
        <button className="primary inline" type="button" onClick={submit}>立即准备</button>
        <button className="secondary inline" type="button" onClick={onCancel}>稍后处理</button>
      </div>
    </div>
  );
}

function groupToDraft(group) {
  return {
    group_key: group.group_key || "",
    name: group.name || "",
    description: group.description || "",
    category_scope: group.category_scope || [],
    l2_index_prompt: group.l2_index_prompt || ""
  };
}

function factIndexName(group) {
  if (!group) return "事实索引";
  return group.name || group.group_key;
}

function bookIdFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("book_id") || "";
  } catch {
    return "";
  }
}

function sanitizeChapterInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "").replace(/^0$/, "");
}
