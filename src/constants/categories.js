export const L2_CATEGORIES = [
  { value: "character", label: "人物" },
  { value: "relationship", label: "关系" },
  { value: "cultivation", label: "境界" },
  { value: "force", label: "势力" },
  { value: "item", label: "物品" },
  { value: "location", label: "地点" },
  { value: "event", label: "事件" },
  { value: "foreshadowing", label: "伏笔" },
  { value: "other", label: "其他" }
];

export function categoryLabel(value) {
  return L2_CATEGORIES.find((category) => category.value === value)?.label || value || "其他";
}
