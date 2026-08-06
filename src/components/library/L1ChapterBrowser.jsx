import { useEffect, useMemo, useRef, useState } from "react";

const WINDOW_SIZE = 80;

/**
 * L1 章节线索主从浏览器（v5 .md 形态）：
 * 左栏全量回目（回号/标题检索，窗口化渲染——首屏 80 行、滚动到底追加，
 * 2243 章不会一次进 DOM），右栏选中章的 kv 线索摘要。
 * 服务端章节端点只回元数据（title/content_length 等，无正文 text），
 * 因此只有「线索摘要」视图，没有 v5 原型里的「原文」tab——不虚构正文。
 */
export function L1ChapterBrowser({ metaChapters, l1Chapters, selectedIndex, onSelect }) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE);
  const itemsRef = useRef(null);

  const l1ByIndex = useMemo(
    () => new Map((l1Chapters || []).map((chapter) => [Number(chapter.chapter_index), chapter])),
    [l1Chapters]
  );
  // 左栏以章节元数据为全集（含未构建章）；元数据缺失时降级为仅有 L1 数据的章
  const rows = useMemo(() => {
    if (metaChapters?.length) {
      return metaChapters.map((meta) => ({
        index: Number(meta.chapter_index),
        title: meta.title || "",
        l1: l1ByIndex.get(Number(meta.chapter_index)) || null
      }));
    }
    return (l1Chapters || []).map((chapter) => ({
      index: Number(chapter.chapter_index),
      title: "",
      l1: chapter
    }));
  }, [metaChapters, l1Chapters, l1ByIndex]);

  const filtered = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return rows;
    return rows.filter((row) => String(row.index).includes(keyword) || row.title.includes(keyword));
  }, [rows, search]);

  // 选中章必须落在渲染窗口内（?ch= 直达靠后章节时扩窗到该章）
  const selectedPos = filtered.findIndex((row) => row.index === selectedIndex);
  const shownCount = Math.max(visibleCount, selectedPos + 1);
  const shown = filtered.slice(0, shownCount);

  // URL 选中变化（如 ?ch= 直达）时把选中行滚进视口——只滚左栏容器，不用
  // scrollIntoView（它会连带滚动 window，把顶栏/面包屑/hero 顶出视口）
  useEffect(() => {
    if (selectedPos < 0 || !itemsRef.current) return;
    const box = itemsRef.current;
    const row = box.querySelector(`[data-ch="${selectedIndex}"]`);
    if (!row) return;
    box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2;
  }, [selectedIndex, selectedPos]);

  function updateSearch(value) {
    setSearch(value);
    setVisibleCount(WINDOW_SIZE);
  }

  function handleScroll(event) {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      setVisibleCount((count) => Math.min(count + WINDOW_SIZE, filtered.length));
    }
  }

  // 选中章从全量 rows 取：过滤列表不含选中章时右栏仍显示该章（搜索只是左栏本地态）
  const selectedRow = rows.find((row) => row.index === selectedIndex) || null;

  return (
    <div className="md">
      <div className="md-list">
        <div className="md-search">
          <input
            value={search}
            placeholder="回号 / 标题检索…"
            onChange={(event) => updateSearch(event.target.value)}
          />
        </div>
        <div className="md-items" ref={itemsRef} onScroll={handleScroll}>
          {shown.map((row) => (
            <button
              key={row.index}
              type="button"
              data-ch={row.index}
              className={`md-item${row.index === selectedIndex ? " on" : ""}`}
              onClick={() => onSelect(row.index)}
            >
              <span className="no">第{row.index}回</span>
              <span className={`t${row.l1?.status === "failed" ? " failed" : ""}`}>
                {shortTitle(row.title) || `第 ${row.index} 章`}
              </span>
            </button>
          ))}
          {shown.length < filtered.length ? (
            <div className="md-more">
              <span className="no">…</span>
              <span>共 {filtered.length} 回，滚动加载（已显示 {shown.length}）</span>
            </div>
          ) : null}
          {!filtered.length ? <div className="md-more"><span>没有匹配「{search.trim()}」的章节</span></div> : null}
        </div>
      </div>
      <div className="md-view">
        {selectedRow ? (
          <>
            <div className="v-head">
              <h4>第 {selectedRow.index} 回{selectedRow.title ? ` · ${shortTitle(selectedRow.title)}` : ""}</h4>
            </div>
            <div className="v-body">
              <ChapterClues chapter={selectedRow.l1} />
            </div>
          </>
        ) : (
          <div className="v-body">
            <div className="empty-state"><b>在左侧选择一章查看线索摘要。</b></div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 回目标题去掉前导「第N章/第N回」，左栏已有回号列，避免重复。 */
function shortTitle(title) {
  return String(title || "").replace(/^第\s*\d+\s*[章回卷]\s*/, "").trim();
}

/** 右栏 kv：新旧两种 L1 数据形态兼容（全文版 key_events/summary，路由版 signals/route_*）。 */
function ChapterClues({ chapter }) {
  if (!chapter) {
    return <div className="empty-state"><b>该章尚未构建章节线索。</b></div>;
  }
  if (chapter.status === "failed") {
    return <div className="alert">该章构建失败{chapter.error_summary ? `：${chapter.error_summary}` : "。"}</div>;
  }
  const entities = arrayOr(chapter.entities, chapter.route_entities);
  const keywords = arrayOr(chapter.keywords, chapter.route_keywords);
  const signals = Array.isArray(chapter.signals) ? chapter.signals : [];
  const events = firstNonEmpty(
    chapter.key_events,
    signals.filter((signal) => signal.category === "event").map((signal) => signal.reason),
    chapter.summary ? [chapter.summary] : []
  );
  const hooks = firstNonEmpty(
    chapter.open_questions,
    signals.filter((signal) => signal.category === "foreshadowing").map((signal) => signal.reason)
  );
  const deltas = firstNonEmpty(
    chapter.items_places_orgs,
    signals
      .filter((signal) => !["event", "foreshadowing"].includes(signal.category))
      .map((signal) => signal.reason)
  );

  return (
    <dl className="kv">
      <dt>主要事件</dt>
      <dd>{events.length ? events.map((item, index) => <div key={index}>{toText(item)}</div>) : "—"}</dd>
      <dt>出场角色</dt>
      <dd>
        {entities.length ? (
          <span className="chips">
            {entities.map((entity, index) => (
              <span
                key={`${entity.name || index}-${index}`}
                className={`chip${entity.type === "character" ? " role" : ""}`}
                title={entity.note || ""}
              >
                {entity.name || toText(entity)}
              </span>
            ))}
          </span>
        ) : "—"}
      </dd>
      <dt>状态变化</dt>
      <dd>{deltas.length ? deltas.map((item, index) => <div key={index}>{toText(item)}</div>) : "—"}</dd>
      <dt>钩子</dt>
      <dd>{hooks.length ? hooks.map((item, index) => <div key={index}>{toText(item)}</div>) : "—"}</dd>
      <dt>关键词</dt>
      <dd>
        {keywords.length ? (
          <span className="chips">{keywords.map((word, index) => <span key={index} className="chip">{word}</span>)}</span>
        ) : "—"}
      </dd>
    </dl>
  );
}

function arrayOr(...candidates) {
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function firstNonEmpty(...candidates) {
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value.filter(Boolean);
  }
  return [];
}

/** 条目可能是字符串或对象（物品/地点/组织等），统一取可读文本。 */
function toText(item) {
  if (item == null) return "";
  if (typeof item === "string") return item;
  return item.name || item.text || item.note || JSON.stringify(item);
}
