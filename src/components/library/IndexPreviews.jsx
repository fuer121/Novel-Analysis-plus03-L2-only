import { categoryLabel } from "../../constants/categories.js";

export function L1Preview({ chapters }) {
  if (!chapters.length) return null;
  const chapter = chapters[0];
  const signals = Array.isArray(chapter.signals) ? chapter.signals : [];
  const entities = Array.isArray(chapter.route_entities) ? chapter.route_entities : [];
  const keywords = Array.isArray(chapter.route_keywords) ? chapter.route_keywords : [];
  const hasRoute = Boolean(chapter.route_schema_version || signals.length || entities.length || keywords.length);
  const chapterIndex = Number(chapter.chapter_index || 0);
  return (
    <details className="index-preview" open>
      <summary>
        <span>章节线索预览</span>
        <small>章节 {chapter.chapter_index}</small>
      </summary>
      <article className="index-preview-sheet">
        <PreviewSheet title="章节概览">
          <table className="index-preview-table">
            <tbody>
              <tr>
                <th>章节</th>
                <td>{chapter.chapter_index}</td>
              </tr>
              <tr>
                <th>路由版本</th>
                <td>{chapter.route_schema_version || "legacy"}</td>
              </tr>
              <tr>
                <th>主体数</th>
                <td>{entities.length}</td>
              </tr>
              <tr>
                <th>关键词数</th>
                <td>{keywords.length}</td>
              </tr>
              <tr>
                <th>信号数</th>
                <td>{signals.length}</td>
              </tr>
            </tbody>
          </table>
        </PreviewSheet>
        <PreviewSheet title="主体">
          {entities.length ? (
            <table className="index-preview-table">
              <thead>
                <tr>
                  <th>主体</th>
                  <th>类型</th>
                  <th>别名</th>
                  <th>角色</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity, index) => (
                  <tr key={`${entity.name || index}-${index}`}>
                    <td>{entity.name || "-"}</td>
                    <td>{entity.type || "-"}</td>
                    <td>{joinPreviewList(entity.aliases)}</td>
                    <td>{entity.role || "-"}</td>
                    <td>{entity.note || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="index-preview-empty">本章没有可展示主体</div>
          )}
        </PreviewSheet>
        <PreviewSheet title="信号">
          {signals.length ? (
            <table className="index-preview-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>强度</th>
                  <th>主体</th>
                  <th>关键词</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((signal, index) => (
                  <tr key={`${signal.category || "signal"}-${index}`}>
                    <td>{categoryLabel(signal.category)}</td>
                    <td>{formatSignalStrength(signal.strength)}</td>
                    <td>{joinPreviewList(signal.entities)}</td>
                    <td>{joinPreviewList(signal.keywords)}</td>
                    <td>{signal.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="index-preview-empty">本章没有可展示信号</div>
          )}
        </PreviewSheet>
        <PreviewSheet title="关键词">
          {keywords.length ? (
            <table className="index-preview-table">
              <tbody>
                {chunkPreviewList(keywords, 4).map((row, index) => (
                  <tr key={`${chapterIndex}-keyword-${index}`}>
                    <th>关键词组 {index + 1}</th>
                    <td>{row.join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="index-preview-empty">{hasRoute ? "本章没有关键词" : (chapter.summary || chapter.error_summary || "旧版章节线索暂无路由信号")}</div>
          )}
        </PreviewSheet>
      </article>
    </details>
  );
}

export function L2FactPreview({ facts, chapterIndex }) {
  const chapterFacts = Number.isInteger(chapterIndex)
    ? facts.filter((fact) => Number(fact.chapter_index || 0) === chapterIndex)
    : facts;
  return (
    <details className="index-preview" open>
      <summary>
        <span>事实索引预览</span>
        <small>{chapterFacts.length ? `第 ${chapterIndex || chapterFacts[0]?.chapter_index || "当前"} 章 · ${chapterFacts.length} 条事实` : "无事实"}</small>
      </summary>
      {chapterFacts.length ? (
        <article className="index-preview-sheet">
          <PreviewSheet title="事实明细">
            <table className="index-preview-table">
              <thead>
                <tr>
                  <th>章</th>
                  <th>类别</th>
                  <th>主体</th>
                  <th>事实类型</th>
                  <th>事实</th>
                  <th>标签</th>
                  <th>相关主体</th>
                  <th>重要度</th>
                  <th>置信度</th>
                </tr>
              </thead>
              <tbody>
                {chapterFacts.map((fact, index) => (
                  <tr key={`${fact.chapter_index || chapterIndex}-${fact.id || index}`}>
                    <td>{fact.chapter_index || chapterIndex || "-"}</td>
                    <td>{categoryLabel(fact.category)}</td>
                    <td>{fact.entity || "-"}</td>
                    <td>{fact.fact_type || "-"}</td>
                    <td>{fact.fact || "无事实正文"}</td>
                    <td>{joinPreviewList(fact.tags)}</td>
                    <td>{joinPreviewList(fact.related_entities)}</td>
                    <td>{formatScore(fact.importance)}</td>
                    <td>{formatScore(fact.confidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PreviewSheet>
        </article>
      ) : (
        <article className="index-preview-empty">
          <strong>无事实</strong>
          <p>{chapterIndex ? `第 ${chapterIndex} 章暂无事实` : "当前范围暂无事实"}</p>
        </article>
      )}
    </details>
  );
}

function PreviewSheet({ title, children }) {
  return (
    <section className="preview-sheet">
      <header>{title}</header>
      {children}
    </section>
  );
}

function formatScore(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function chunkPreviewList(items, size = 4) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

function joinPreviewList(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return list.length ? list.join("、") : "-";
}

function formatSignalStrength(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}
