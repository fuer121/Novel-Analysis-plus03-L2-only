import { isLiveTask } from "../constants/taskStatus.js";

/**
 * 由书数据推导"当前阶段 + 下一步"的纯函数（工作台卡片与书籍首页共用）。
 *
 * 输入均为按书聚合后的标量/任务对象，不做任何请求：
 * - hasContent：是否已导入章节
 * - importTask / l1Task / l2Task：该书对应类型的任务对象（无则 null），只看是否 live
 * - l1Done：章节线索是否已覆盖全部已导入章节
 * - l2GroupCount：用户创建的事实索引组数量（不含 base 默认组）
 *
 * 输出 { stage, note, page }：stage 是当前阶段短文案，note 是下一步建议，
 * page 是建议前往的管理页（"l1" | "l2" | "ask" | null，null 表示留在工作台/书籍首页即可）。
 * 规则按优先级短路：导入 > 章节线索 > 事实索引 > 提问。
 */
export function deriveJourney({
  hasContent = false,
  importTask = null,
  l1Task = null,
  l1Done = false,
  l2Task = null,
  l2GroupCount = 0
} = {}) {
  if (isLiveTask(importTask)) {
    return {
      stage: "导入原文（进行中）",
      note: "正在导入章节，完成后即可构建章节线索",
      page: null
    };
  }
  if (!hasContent) {
    return {
      stage: "导入原文",
      note: "先导入小说原文，才能构建章节线索与事实索引",
      page: null
    };
  }
  if (isLiveTask(l1Task)) {
    return {
      stage: "章节线索（进行中）",
      note: "等待构建完成，可去章节线索页查看进度",
      page: "l1"
    };
  }
  if (!l1Done) {
    return {
      stage: "构建章节线索",
      note: "原文已就绪，先构建章节线索（L1）打底",
      page: "l1"
    };
  }
  if (isLiveTask(l2Task)) {
    return {
      stage: "事实索引（进行中）",
      note: "完成后提问即可引用事实索引，也可以先基于章节线索提问",
      page: "l2"
    };
  }
  if (!l2GroupCount) {
    return {
      stage: "创建事实索引组",
      note: "章节线索已就绪，创建索引组抽取结构化事实",
      page: "l2"
    };
  }
  return {
    stage: "提问",
    note: "章节线索与事实索引就绪，开始提问",
    page: "ask"
  };
}

/**
 * 由 /api/diagnostics 的按书聚合行 + 任务列表组装 deriveJourney 输入。
 * aggregate 形如 { chapter_count, l1: { completed }, index_groups }，可为空对象。
 * 注意 aggregate.index_groups 含每本书必有的 base 默认组（ensureBook 时服务端自动建），
 * 旅程语义上的"索引组"指用户创建的专项组，因此减 1（不足 1 时按 0 计）。
 */
export function journeyInputForBook({ book, aggregate = null, tasks = [] } = {}) {
  const chapterCount = Number(book?.chapter_count || 0);
  const l1Completed = Number(aggregate?.l1?.completed || 0);
  const bookTasks = (Array.isArray(tasks) ? tasks : []).filter(
    (task) => task?.payload?.bookId === book?.book_id
  );
  return {
    hasContent: chapterCount > 0,
    importTask: bookTasks.find((task) => task.type === "import") || null,
    l1Task: bookTasks.find((task) => task.type === "l1-index") || null,
    l1Done: chapterCount > 0 && l1Completed >= chapterCount,
    l2Task: bookTasks.find((task) => task.type === "l2-index") || null,
    l2GroupCount: Math.max(0, Number(aggregate?.index_groups || 0) - 1)
  };
}
