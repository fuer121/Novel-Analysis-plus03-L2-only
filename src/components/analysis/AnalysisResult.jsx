import { Copy, FileText, Loader2, Play, Table2 } from "lucide-react";
import { factIndexName } from "../../analysisCoverage.js";
import { categoryLabel } from "../../constants/categories.js";
import { parseJsonLike, tableViewsFromJson } from "../../schemaTools.js";
import { Panel, ResultActions } from "../../ui.jsx";

export function AnalysisResultPanel({ analysis, analysisBusy, onResume }) {
  return (
    <Panel
      icon={Table2}
      title="结果"
      action={<ResultActions analysis={analysis} />}
    >
      <ResultView analysis={analysis} analysisBusy={analysisBusy} onResume={onResume} />
    </Panel>
  );
}

function ResultView({ analysis, analysisBusy, onResume }) {
  if (!analysis) return <div className="empty-state tall">从左侧选择已完成的提问，或在上方发起新提问</div>;
  if (!analysis.finalResult) {
    return <PartialResultView analysis={analysis} analysisBusy={analysisBusy} onResume={onResume} />;
  }
  const rawResult = analysis.finalResult;
  const parsed = typeof rawResult === "string" ? parseJsonLike(rawResult) : rawResult;
  const tables = tableViewsFromJson(parsed);
  return (
    <ResultShell analysis={analysis}>
      {tables.length ? (
        <JsonTableResult tables={tables} rawValue={parsed} title={analysis.name} />
      ) : typeof rawResult === "string" ? (
        <TextPreview value={rawResult} />
      ) : (
        <JsonPreview value={rawResult} />
      )}
    </ResultShell>
  );
}

function ResultShell({ analysis, children }) {
  return (
    <div className="result-stack">
      <AnalysisIdentity analysis={analysis} />
      <SourceStats stats={analysis.source_stats} />
      <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />
      {children}
    </div>
  );
}

function JsonTableResult({ tables, rawValue, title }) {
  const displayTitle = typeof rawValue?.title === "string" && rawValue.title.trim()
    ? rawValue.title
    : title;
  const displaySummary = typeof rawValue?.summary === "string" ? rawValue.summary : "";
  return (
    <>
      <div className="result-summary">
        <h3>{displayTitle || "分析结果"}</h3>
        {displaySummary ? <p>{displaySummary}</p> : null}
      </div>
      <div className="result-table-stack">
        {tables.map((table) => (
          <section className="result-table-block" key={table.key}>
            <div className="result-table-head">
              <strong>{table.title}</strong>
              <span>{table.rows.length} 行 · {table.columns.length} 列</span>
            </div>
            <div className="table-wrap result-table">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index}>
                      {table.columns.map((column) => (
                        <td key={column.key}>{formatCell(row?.[column.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      {Array.isArray(rawValue?.failed_chapters) && rawValue.failed_chapters.length ? (
        <div className="inline-warning">
          <FileText size={15} />
          失败章节：{rawValue.failed_chapters.join(", ")}
        </div>
      ) : null}
      <details className="result-json-details">
        <summary>查看完整 JSON</summary>
        <JsonPreview value={rawValue} />
      </details>
    </>
  );
}

function AnalysisIdentity({ analysis }) {
  if (!analysis?.id) return null;
  return (
    <div className="analysis-identity">
      <span>任务 ID</span>
      <code>{analysis.id}</code>
      <button
        type="button"
        className="action-chip"
        onClick={() => navigator.clipboard?.writeText(analysis.id)}
      >
        <Copy size={14} />
        复制 ID
      </button>
    </div>
  );
}

function SourceStats({ stats }) {
  if (!stats) return null;
  return (
    <div className="source-stats">
      <span>提问</span>
      <span>召回事实 {Number(stats.recalled_facts || 0)} 条</span>
      <span>涉及章节 {Number(stats.recalled_chapters || 0)} 章</span>
      {stats.l1_route_enabled ? <span>章节线索命中 {stats.l1_matched_chapters?.length || 0} 章</span> : null}
      <span>原文复核 {Number(stats.source_review_chapters || 0)}/{Number(stats.source_review_budget || 0)} 章</span>
      {stats.index_groups?.length ? <span>事实索引 {stats.index_groups.map((group) => factIndexName(group)).join(" / ")}</span> : null}
      {stats.entity_queries?.length ? <span>主体 {stats.entity_queries.slice(0, 4).join(" / ")}</span> : null}
      {stats.recall_fallback_used ? <span>已启用兜底召回</span> : null}
      {stats.l2_missing_chapters?.length ? <span>事实索引缺口 {stats.l2_missing_chapters.length} 章</span> : null}
      {stats.unrecalled_chapters?.length ? <span>未召回 {stats.unrecalled_chapters.length} 章</span> : null}
    </div>
  );
}

function SourceTracePanel({ summary, traces }) {
  const traceList = Array.isArray(traces) ? traces : [];
  if (!summary?.evidence_packet_count && !traceList.length) return null;
  const sourceTypes = countEntries(summary?.source_types);
  const categories = countEntries(summary?.categories).slice(0, 6);
  const visibleParts = traceList
    .filter((trace) => trace.stage === "json_field_batch" || trace.stage === "text_final_merge" || trace.part_key === "json.final.merge")
    .slice(0, 8);
  return (
    <details className="source-trace-panel">
      <summary>
        <span>来源追踪</span>
        <small>
          {Number(summary?.evidence_packet_count || 0)} 个证据包
          {summary?.chapters?.count ? ` · ${summary.chapters.count} 章` : ""}
        </small>
      </summary>
      <div className="source-trace-body">
        <div className="source-trace-chips">
          {sourceTypes.map(([key, value]) => <span key={key}>{sourceTypeLabel(key)} {value}</span>)}
          {categories.map(([key, value]) => <span key={key}>{categoryLabel(key)} {value}</span>)}
          {summary?.trimmed_by_budget ? <span>已按预算压缩</span> : null}
          {summary?.omitted_by_budget ? <span>省略 {summary.omitted_by_budget} 包</span> : null}
        </div>
        {summary?.subjects?.length ? (
          <div className="muted-line">主体：{summary.subjects.slice(0, 8).join(" / ")}</div>
        ) : null}
        {summary?.chapters?.sample?.length ? (
          <div className="muted-line">章节样本：{compactIndexes(summary.chapters.sample)}</div>
        ) : null}
        {visibleParts.length ? (
          <div className="source-trace-grid">
            {visibleParts.map((trace) => (
              <div className="source-trace-card" key={trace.part_key}>
                <strong>{trace.field_name || trace.part_key}</strong>
                <span>{trace.part_key}</span>
                <small>
                  {Number(trace.evidence_packet_count || 0)} 包
                  {trace.chapters?.count ? ` · ${trace.chapters.count} 章` : ""}
                  {trace.batch && trace.total_batches > 1 ? ` · ${trace.batch}/${trace.total_batches}` : ""}
                </small>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function PartialResultView({ analysis, analysisBusy, onResume }) {
  const completed = analysis.chapterResults || [];
  const failed = analysis.failedChapterIndexes || [];
  const pending = analysis.pendingChapterIndexes || [];
  const summaryProgress = analysis.summaryProgress || null;
  const failedSummaryParts = analysis.failedSummaryParts || [];
  return (
    <div className="partial-result-stack">
      <AnalysisIdentity analysis={analysis} />
      <div className="partial-result-header">
        <div>
          <h3>未生成最终结果</h3>
          <p>
            已完成 {completed.length} 章
            {failed.length ? ` · 失败 ${failed.length} 章` : ""}
            {pending.length ? ` · 待续跑 ${pending.length} 章` : ""}
          </p>
        </div>
        {analysis.canResume ? (
          <button className="secondary" type="button" onClick={onResume} disabled={analysisBusy}>
            {analysisBusy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            继续提问
          </button>
        ) : null}
      </div>

      {analysis.error_summary ? (
        <div className="inline-warning">
          <FileText size={15} />
          {analysis.error_summary}
        </div>
      ) : null}

      {summaryProgress?.total ? (
        <div className="source-stats">
          <span>最终汇总分块 {summaryProgress.completed}/{summaryProgress.total}</span>
          {summaryProgress.running ? <span>运行 {summaryProgress.running}</span> : null}
          {summaryProgress.failed ? <span>失败 {summaryProgress.failed}</span> : null}
        </div>
      ) : null}
      <SourceTracePanel summary={analysis.sourceTraceSummary} traces={analysis.sourceTrace} />

      {failed.length ? (
        <div className="inline-warning">
          <FileText size={15} />
          失败章节：{failed.join(", ")}
        </div>
      ) : null}
      {failedSummaryParts.length ? (
        <div className="inline-warning">
          <FileText size={15} />
          汇总分块失败：{failedSummaryParts.slice(0, 4).map((part) => part.part_key).join(", ")}
        </div>
      ) : null}
      {pending.length ? (
        <div className="muted-line">待续跑章节：{compactIndexes(pending)}</div>
      ) : null}

      {completed.length ? (
        <div className="partial-chapter-list">
          {completed.map((entry) => (
            <details key={entry.chapter_index} className="partial-chapter-item">
              <summary>
                第 {entry.chapter_index} 章
                {entry.result?.chapter_title ? ` · ${entry.result.chapter_title}` : ""}
              </summary>
              {entry.result?.summary ? <p>{entry.result.summary}</p> : null}
              <JsonPreview value={entry.result} />
            </details>
          ))}
        </div>
      ) : (
        <div className="empty-state tall">无逐章结果</div>
      )}
    </div>
  );
}

function JsonPreview({ value }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function TextPreview({ value }) {
  return <pre className="text-preview">{value}</pre>;
}

function formatCell(value) {
  if (Array.isArray(value)) return value.map((entry) => formatCell(entry)).join("\n");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatCell(entry)}`)
      .join("\n");
  }
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function compactIndexes(indexes) {
  const values = (indexes || []).slice(0, 40);
  const suffix = indexes.length > values.length ? ` 等 ${indexes.length} 章` : "";
  return `${values.join(", ")}${suffix}`;
}

function countEntries(value) {
  return Object.entries(value || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0));
}

function sourceTypeLabel(value) {
  return {
    l2_fact: "事实索引",
    source_review: "原文复核",
    chapter_summary: "章节摘要"
  }[value] || value;
}
