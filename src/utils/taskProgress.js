/** 由任务 progress 计算百分比（completed+failed+skipped / total）。 */
export function taskProgressPercent(task) {
  const total = Number(task?.progress?.total || 0);
  if (!total) return 0;
  const processed = Number(task?.progress?.completed || 0)
    + Number(task?.progress?.failed || 0)
    + Number(task?.progress?.skipped || 0);
  return Math.min(100, Math.round((processed / total) * 100));
}

/**
 * 任务通道是全局单任务：别的书占用通道时给启动按钮旁边的提示文案。
 * task 为 null 时返回空串（无占用）。actionText 如 "正在构建章节线索"。
 */
export function otherBookTaskHint(task, books, actionText) {
  if (!task) return "";
  const name = (books || []).find((book) => book.book_id === task?.payload?.bookId)?.book_name;
  return `${name ? `《${name}》` : "另一本书"}${actionText}，完成后可启动`;
}
