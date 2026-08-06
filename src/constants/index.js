export const BASE_INDEX_GROUP_KEY = "base";

export const TASK_TYPES = {
  IMPORT: "import",
  L1_INDEX: "l1-index",
  L2_INDEX: "l2-index",
  ANALYSIS: "analysis"
};

export const L2_INDEX_MODE_ALL = "all";

/** 面向用户界面的任务类型名（术语基线：章节线索 / 事实索引 / 提问）。 */
export function taskDisplayName(type) {
  return {
    [TASK_TYPES.IMPORT]: "导入",
    [TASK_TYPES.L1_INDEX]: "章节线索",
    [TASK_TYPES.L2_INDEX]: "事实索引",
    [TASK_TYPES.ANALYSIS]: "提问"
  }[type] || type;
}
