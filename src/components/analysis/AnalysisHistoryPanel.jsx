import { Copy, Layers, RefreshCcw, Trash2 } from "lucide-react";
import { formatTime } from "../../api.js";
import { IconButton, Panel, StatusPill } from "../../ui.jsx";

export function AnalysisHistoryPanel({ analyses, books, selectedId, listBusy, onRefresh, onSelect, onCopy, onDelete }) {
  return (
    <Panel
      icon={Layers}
      title={`提问任务（${analyses.length}）`}
      className="analysis-history-panel"
      action={<IconButton icon={RefreshCcw} label="刷新" onClick={onRefresh} disabled={listBusy} />}
    >
      <AnalysisHistory
        analyses={analyses}
        books={books}
        selectedId={selectedId}
        onSelect={onSelect}
        onCopy={onCopy}
        onDelete={onDelete}
      />
    </Panel>
  );
}

function AnalysisHistory({ analyses, books, selectedId, onSelect, onCopy, onDelete }) {
  if (!analyses.length) return <div className="history-empty">暂无提问任务。在上方输入第一个问题。</div>;
  const bookNames = new Map(books.map((book) => [book.book_id, book.book_name || book.book_id]));

  return (
    <div className="analysis-list expanded">
      {analyses.map((analysis) => (
        <div
          key={analysis.id}
          className={analysis.id === selectedId ? "analysis-record active" : "analysis-record"}
        >
          <button type="button" className="analysis-main" onClick={() => onSelect(analysis.id)}>
            <strong>{analysis.name || "未命名任务"}</strong>
            <span>{bookNames.get(analysis.book_id) || analysis.book_id} · {analysis.start_chapter}-{analysis.end_chapter} · {analysis.chapter_count} 章</span>
            <span className="analysis-id-line">任务 ID：{shortAnalysisId(analysis.id)}</span>
            <small>{formatTime(analysis.updated_at)}</small>
          </button>
          <div className="analysis-actions">
            <StatusPill status={analysis.status} />
            <button type="button" className="action-chip" onClick={() => onCopy(analysis.id)} title="复制配置" aria-label="复制配置">
              <Copy size={15} />
              <span>复制</span>
            </button>
            <button type="button" className="action-chip danger-icon" onClick={() => onDelete(analysis.id)} title="删除任务" aria-label="删除任务">
              <Trash2 size={15} />
              <span>删除</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function shortAnalysisId(id) {
  const value = String(id || "");
  if (value.length <= 12) return value || "-";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
