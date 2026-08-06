import { useState } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { apiPost } from "../../api.js";
import { useAppContext } from "../../context/appContext.js";
import { navigate, paths } from "../../router.js";

/**
 * 书籍设置（书籍首页）：补登记书名 + 删除书籍。
 * 服务端约束：已命名书籍不允许改名（ensureBook 409），因此书名仅在未命名时可编辑。
 */
export function BookSettingsPanel({ book, onSaveBookMeta }) {
  const { reloadBooks, setError } = useAppContext();
  const [bookName, setBookName] = useState(book?.book_name || "");
  const [busy, setBusy] = useState(false);
  if (!book) return null;
  const named = Boolean(book.book_name);
  const canSaveName = !named && bookName.trim() && bookName.trim() !== (book.book_name || "");

  async function saveName() {
    setBusy(true);
    setError("");
    try {
      await onSaveBookMeta({ book_id: book.book_id, book_name: bookName.trim() });
      await reloadBooks();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBook() {
    const label = book.book_name || book.book_id;
    if (!window.confirm(`删除本地章节库中的《${label}》？`)) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/api/books/${encodeURIComponent(book.book_id)}/delete`, {});
      await reloadBooks();
      navigate(paths.workbench(), { replace: true });
    } catch (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <section className="card-panel book-settings-panel">
      <h3 className="card-panel-title">书籍设置</h3>
      <div className="form-grid compact">
        <label>
          <span>小说 ID</span>
          <input value={book.book_id} disabled />
        </label>
        <label>
          <span>书籍名称</span>
          <input
            value={named ? book.book_name : bookName}
            disabled={named}
            placeholder="未命名"
            onChange={(event) => setBookName(event.target.value)}
          />
        </label>
      </div>
      <div className="action-row">
        {canSaveName ? (
          <button className="secondary inline" type="button" onClick={saveName} disabled={busy}>
            {busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
            保存名称
          </button>
        ) : null}
        <button className="danger inline" type="button" onClick={deleteBook} disabled={busy}>
          <Trash2 size={15} />
          删除书籍
        </button>
      </div>
    </section>
  );
}
