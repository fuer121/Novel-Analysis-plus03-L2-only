import { useMemo } from "react";
import { BookOpen, Loader2, Play } from "lucide-react";
import { sanitizeChapterInput } from "../../utils/chapterRange.js";
import { Panel, TaskBox } from "../../ui.jsx";

export function ImportPanel({
  books,
  showImportForm,
  onShowImportFormChange,
  importForm,
  onImportFormChange,
  importBusy,
  difyConfigured,
  importTask,
  onStartImport,
  onCancel,
  onPause,
  onResume
}) {
  const boundBook = useMemo(
    () => books.find((book) => book.book_id === importForm.book_id.trim()) || null,
    [books, importForm.book_id]
  );

  function updateBookId(bookId) {
    const book = books.find((entry) => entry.book_id === bookId.trim());
    onImportFormChange({
      ...importForm,
      book_id: bookId,
      book_name: book?.book_name || ""
    });
  }

  return (
    <Panel
      className="library-import-panel"
      icon={BookOpen}
      title="导入"
    >
      {!showImportForm ? (
        <button className="secondary compact-action" type="button" onClick={() => onShowImportFormChange(true)}>
          <BookOpen size={16} />
          导入新章节
        </button>
      ) : (
        <>
          <div className="form-grid import-form-grid">
            <label>
              <span>书籍名称</span>
              <input
                value={boundBook?.book_name || importForm.book_name}
                disabled={Boolean(boundBook?.book_name)}
                placeholder="例如：凡人修仙传"
                onChange={(event) => onImportFormChange({ ...importForm, book_name: event.target.value })}
              />
            </label>
            <label>
              <span>小说 ID</span>
              <input
                value={importForm.book_id}
                onChange={(event) => updateBookId(event.target.value)}
              />
            </label>
            <label>
              <span>起始章节</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={importForm.start_chapter}
                onChange={(event) => onImportFormChange({ ...importForm, start_chapter: sanitizeChapterInput(event.target.value) })}
              />
            </label>
            <label>
              <span>结束章节</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={importForm.end_chapter}
                onChange={(event) => onImportFormChange({ ...importForm, end_chapter: sanitizeChapterInput(event.target.value) })}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={importForm.force}
                onChange={(event) => onImportFormChange({ ...importForm, force: event.target.checked })}
              />
              <span>覆盖已有章节</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={importForm.auto_l1_index}
                onChange={(event) => onImportFormChange({ ...importForm, auto_l1_index: event.target.checked })}
              />
              <span>完成后准备章节线索</span>
            </label>
          </div>
          <div className="action-row">
            <button className="primary inline" type="button" onClick={onStartImport} disabled={importBusy || !difyConfigured}>
              {importBusy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {importBusy ? "导入中" : "开始导入"}
            </button>
            <button className="secondary inline" type="button" onClick={() => onShowImportFormChange(false)} disabled={importBusy}>
              收起
            </button>
          </div>
        </>
      )}
      {importTask ? (
        <TaskBox
          task={importTask}
          onCancel={onCancel}
          onPause={onPause}
          onResume={onResume}
        />
      ) : null}
    </Panel>
  );
}
