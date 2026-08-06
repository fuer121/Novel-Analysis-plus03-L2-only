import { useEffect, useState } from "react";
import { apiGet, l2FactsUrl } from "../../api.js";
import { categoryLabel } from "../../constants/categories.js";
import { navigate, paths } from "../../router.js";

const FACT_LIMIT = 500;

/**
 * L2 事实表（选中索引组）：entity LIKE 检索（输入防抖 300ms）、行点击展开
 * 完整事实/依据/标签 chips、出处「第N回」溯源链接到 #/book/:id/l1?ch=N。
 * totalCount 由组级统计给出（可能为 null：旧服务端无统计且 coverage 降级也失败时）。
 */
export function L2FactTable({ bookId, groupKey, firstChapter, lastChapter, totalCount = null, refreshKey = "" }) {
  const [input, setInput] = useState("");
  const [entity, setEntity] = useState("");
  const [facts, setFacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setEntity(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!bookId || !groupKey) return undefined;
    let cancelled = false;
    // 微任务 defer：避免在 effect 体内同步 setState（react-hooks/set-state-in-effect）
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    apiGet(l2FactsUrl(bookId, {
      start_chapter: firstChapter,
      end_chapter: lastChapter,
      index_group_key: groupKey,
      entity,
      limit: FACT_LIMIT
    }))
      .then((data) => {
        if (cancelled) return;
        setFacts(data.facts || []);
        setErrorText("");
      })
      .catch((error) => {
        if (!cancelled) setErrorText(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, groupKey, firstChapter, lastChapter, entity, refreshKey]);

  return (
    <div className="fact-table-wrap">
      <div className="fact-toolbar">
        <input
          className="fact-search"
          type="search"
          placeholder="检索主体 / 别名 / 标签…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <span className="fact-count">
          {loading ? "检索中…" : ""}
        </span>
      </div>
      {errorText ? <div className="empty-state">{errorText}</div> : null}
      {!errorText && !facts.length && !loading ? (
        <div className="empty-state">
          <b>{entity ? `没有匹配「${entity}」的事实。` : "该索引组当前范围暂无事实。"}</b>
        </div>
      ) : null}
      {facts.length ? (
        <div className="table-wrap fact-table-scroll">
          <table className="fact-table">
            <thead>
              <tr>
                <th className="chapter-col">章</th>
                <th>类别</th>
                <th>主体</th>
                <th>事实类型</th>
                <th>事实</th>
                <th>重要度</th>
                <th className="fact-toggle-col" />
              </tr>
            </thead>
            <tbody>
              {facts.map((fact, index) => {
                const rowId = fact.id || `${fact.chapter_index}-${index}`;
                const open = openId === rowId;
                return (
                  <FactRows
                    key={rowId}
                    fact={fact}
                    open={open}
                    onToggle={() => setOpenId(open ? null : rowId)}
                    onTrace={() => navigate(`${paths.l1(bookId)}?ch=${fact.chapter_index}`)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="fact-foot">
        已加载 {facts.length}{totalCount != null ? ` / 共 ${totalCount} 条` : " 条"}
        {entity ? ` · 检索「${entity}」` : ""}
        {facts.length >= FACT_LIMIT ? ` · 仅显示前 ${FACT_LIMIT} 条` : ""}
      </div>
    </div>
  );
}

function FactRows({ fact, open, onToggle, onTrace }) {
  const tags = Array.isArray(fact.tags) ? fact.tags.filter(Boolean) : [];
  const related = Array.isArray(fact.related_entities) ? fact.related_entities.filter(Boolean) : [];
  const aliases = Array.isArray(fact.aliases) ? fact.aliases.filter(Boolean) : [];
  const evidence = Array.isArray(fact.evidence) ? fact.evidence.filter(Boolean) : [];
  return (
    <>
      <tr className={`fact-row${open ? " open" : ""}`} onClick={onToggle}>
        <td>{fact.chapter_index || "-"}</td>
        <td>{categoryLabel(fact.category)}</td>
        <td><b>{fact.entity || "-"}</b></td>
        <td>{fact.fact_type || "-"}</td>
        <td className="fact-text">{fact.fact || "无事实正文"}</td>
        <td className="mono">{Number(fact.importance || 0).toFixed(2)}</td>
        <td className="fact-toggle-col">{open ? "▾" : "▸"}</td>
      </tr>
      {open ? (
        <tr className="fact-detail-row">
          <td colSpan={7}>
            <div className="fact-detail">
              <p>{fact.fact || "无事实正文"}</p>
              {evidence.length ? (
                <div className="fact-chips">
                  <span className="fact-chip-label">原文依据</span>
                  {evidence.map((item, index) => <span className="chip" key={`e-${index}`}>{item}</span>)}
                </div>
              ) : null}
              {tags.length || related.length || aliases.length ? (
                <div className="fact-chips">
                  {aliases.length ? <span className="fact-chip-label">别名</span> : null}
                  {aliases.map((item, index) => <span className="chip" key={`a-${index}`}>{item}</span>)}
                  {tags.length ? <span className="fact-chip-label">标签</span> : null}
                  {tags.map((item, index) => <span className="chip" key={`t-${index}`}>{item}</span>)}
                  {related.length ? <span className="fact-chip-label">相关主体</span> : null}
                  {related.map((item, index) => <span className="chip" key={`r-${index}`}>{item}</span>)}
                </div>
              ) : null}
              <div className="fact-trace">
                出处：
                <button className="src-link" type="button" onClick={(event) => { event.stopPropagation(); onTrace(); }}>
                  第{fact.chapter_index}回
                </button>
                <span className="fact-chip-label">（溯源到章节线索）</span>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
