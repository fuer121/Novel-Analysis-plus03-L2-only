import { BASE_INDEX_GROUP_KEY } from "./constants/index.js";

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
  if (group.group_key === BASE_INDEX_GROUP_KEY) return "事实索引";
  return String(group.name || group.group_key || "").trim();
}

export function coverageCounts(coverage) {
  const chapters = coverage?.chapters || null;
  return {
    completed: Number(chapters?.completed || 0),
    total: Number(chapters?.total || 0),
    facts: Number(chapters?.facts || 0),
    missing: Number(chapters?.missing || 0),
    outdated: Number(chapters?.outdated || 0)
  };
}

export function coveragePercent(coverage) {
  const { completed, total } = coverageCounts(coverage);
  return total ? Math.round((completed / total) * 100) : 0;
}

export function coverageText(coverage) {
  if (!coverage?.chapters) return "读取中";
  const { completed, total, facts } = coverageCounts(coverage);
  return `${completed}/${total} 章，${facts} 条`;
}
