export function analysisIndexCoverageText({ indexGroupKeys = [], indexGroups = [], coveragesByGroup = {} }) {
  const keys = Array.isArray(indexGroupKeys) ? indexGroupKeys : [];
  if (!keys.length) return "未绑定事实索引";
  const parts = keys.map((key) => {
    const group = indexGroups.find((group) => group.group_key === key);
    const name = group ? factIndexName(group) : key;
    return `${name} ${coverageText(coveragesByGroup[key])}`;
  });
  return `事实索引 ${parts.join("；")}`;
}

export function factIndexName(group) {
  if (!group) return "事实索引";
  if (group.group_key === "base") return "事实索引";
  return String(group.name || group.group_key || "").trim();
}

function coverageText(coverage) {
  if (!coverage?.chapters) return "读取中";
  return `${coverage.chapters.completed}/${coverage.chapters.total} 章，${coverage.chapters.facts || 0} 条`;
}
