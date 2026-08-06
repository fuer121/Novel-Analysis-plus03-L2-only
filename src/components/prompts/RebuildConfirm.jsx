import { useState } from "react";
import { sanitizeChapterInput, validChapterNumber } from "../../utils/chapterRange.js";

export function RebuildConfirm({ type, book, onCancel, onStart }) {
  const first = book?.first_chapter || 1;
  const last = book?.last_chapter || first;
  const [form, setForm] = useState({ start_chapter: String(first), end_chapter: String(last), force: true });
  const label = type === "l1" ? "章节线索规则" : "事实索引规则";

  function submit() {
    if (!validChapterNumber(form.start_chapter) || !validChapterNumber(form.end_chapter)) return;
    onStart({ type, startChapter: Number(form.start_chapter), endChapter: Number(form.end_chapter), force: form.force });
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
      <div className="action-row">
        <button className="primary inline" type="button" onClick={submit}>立即准备</button>
        <button className="secondary inline" type="button" onClick={onCancel}>稍后处理</button>
      </div>
    </div>
  );
}
