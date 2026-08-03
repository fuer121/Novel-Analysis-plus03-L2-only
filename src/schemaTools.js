export function tableViewsFromJson(value) {
  const parsed = parseJsonLike(value);
  if (parsed === null || parsed === undefined) return [];

  if (Array.isArray(parsed)) {
    return tableFromArray("结果", parsed);
  }

  if (typeof parsed !== "object") {
    return [];
  }

  const tables = [];
  const entries = Object.entries(parsed);

  for (const [key, entry] of entries) {
    if (Array.isArray(entry)) {
      tables.push(...tableFromArray(labelForKey(key), entry, key));
    } else if (entry && typeof entry === "object") {
      const objectTable = tableFromObject(labelForKey(key), entry, key);
      if (objectTable) tables.push(objectTable);
    }
  }

  const scalarRows = entries
    .filter(([, entry]) => entry !== null && entry !== undefined && !Array.isArray(entry) && typeof entry !== "object")
    .map(([key, entry]) => ({ field: labelForKey(key), value: entry }));
  if (!tables.length && scalarRows.length) {
    return [{
      key: "summary_fields",
      title: "结果字段",
      rows: scalarRows,
      columns: [
        { key: "field", label: "字段" },
        { key: "value", label: "值" }
      ]
    }];
  }

  return tables.length ? prioritizeTables(tables) : [];
}

export function excelWorkbookXmlFromJson(value, options = {}) {
  const tables = tableViewsFromJson(value);
  if (!tables.length) return "";
  const title = String(options.title || "分析结果").trim() || "分析结果";
  const usedNames = new Set();
  const worksheets = tables.map((table) => worksheetXml({
    name: uniqueWorksheetName(table.title || table.key || "结果", usedNames),
    table
  })).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:html="http://www.w3.org/TR/REC-html40">',
    "<DocumentProperties xmlns=\"urn:schemas-microsoft-com:office:office\">",
    `<Title>${escapeXml(title)}</Title>`,
    "</DocumentProperties>",
    worksheets,
    "</Workbook>"
  ].join("\n");
}

export function parseJsonLike(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function worksheetXml({ name, table }) {
  const header = `<Row>${table.columns.map((column) => cellXml(column.label || column.key)).join("")}</Row>`;
  const rows = table.rows.map((row) => (
    `<Row>${table.columns.map((column) => cellXml(row?.[column.key])).join("")}</Row>`
  )).join("\n");
  return [
    `<Worksheet ss:Name="${escapeXml(name)}">`,
    "<Table>",
    header,
    rows,
    "</Table>",
    "</Worksheet>"
  ].join("\n");
}

function cellXml(value) {
  const text = value === undefined || value === null || value === "" ? "" : String(value);
  return `<Cell><Data ss:Type="${isNumericCellValue(value) ? "Number" : "String"}">${escapeXml(text)}</Data></Cell>`;
}

function isNumericCellValue(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueWorksheetName(value, usedNames) {
  const base = sanitizeWorksheetName(value) || "结果";
  let name = base;
  let index = 2;
  while (usedNames.has(name)) {
    const suffix = ` ${index}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedNames.add(name);
  return name;
}

function sanitizeWorksheetName(value) {
  return String(value || "")
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableFromArray(title, rows, key = "root") {
  const normalizedRows = rows
    .filter((row) => row !== null && row !== undefined)
    .map((row) => normalizeTableRow(row));
  if (!normalizedRows.length) return [];
  const keys = [];
  for (const row of normalizedRows) {
    for (const columnKey of Object.keys(row)) {
      if (!keys.includes(columnKey)) keys.push(columnKey);
    }
  }
  if (!keys.length) return [];
  return [{
    key,
    title,
    rows: normalizedRows,
    columns: keys.map((columnKey) => ({ key: columnKey, label: labelForKey(columnKey) }))
  }];
}

function tableFromObject(title, value, key) {
  const rows = flattenObjectRows(value);
  if (!rows.length) return null;
  return {
    key,
    title,
    rows,
    columns: [
      { key: "field", label: "字段" },
      { key: "value", label: "值" }
    ]
  };
}

function flattenObjectRows(value, prefix = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === "") continue;
    const path = [...prefix, key];
    if (isDisplayScalar(entry)) {
      rows.push({ field: labelForPath(path), value: entry });
    } else if (Array.isArray(entry)) {
      if (entry.length) rows.push({ field: labelForPath(path), value: formatTableValue(entry) });
    } else if (entry && typeof entry === "object") {
      rows.push(...flattenObjectRows(entry, path));
    }
  }
  return rows;
}

function isDisplayScalar(value) {
  return value === null || value === undefined || typeof value !== "object";
}

function formatTableValue(value) {
  if (Array.isArray(value)) {
    if (value.every(isDisplayScalar)) return value.join(", ");
    return value.map((entry) => isDisplayScalar(entry) ? String(entry) : compactObjectValue(entry)).join("\n");
  }
  if (value && typeof value === "object") return compactObjectValue(value);
  return value;
}

function compactObjectValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return String(value ?? "");
  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
    .map(([key, entry]) => `${labelForKey(key)}：${formatNestedValue(entry)}`)
    .join("；");
}

function formatNestedValue(value) {
  if (Array.isArray(value)) return value.map((entry) => isDisplayScalar(entry) ? String(entry) : compactObjectValue(entry)).join(", ");
  if (value && typeof value === "object") return compactObjectValue(value);
  return String(value);
}

function normalizeTableRow(row) {
  if (row && typeof row === "object" && !Array.isArray(row)) return row;
  return { value: row };
}

function prioritizeTables(tables) {
  return [...tables].sort((left, right) => {
    if (left.key === "items") return -1;
    if (right.key === "items") return 1;
    return right.rows.length - left.rows.length;
  });
}

function labelForKey(key) {
  const labels = {
    title: "标题",
    summary: "摘要",
    items: "条目",
    failed_chapters: "失败章节",
    name: "名称",
    description: "描述",
    chapters: "章节",
    chapter: "章节",
    chapter_index: "章节",
    chapter_refs: "章节",
    evidence: "证据",
    evidence_notes: "证据",
    evidence_refs: "证据引用",
    field_evidence_refs: "证据引用",
    confidence: "置信度",
    importance: "重要度",
    category: "分类",
    entity: "主体",
    related_entities: "相关主体",
    fact: "事实",
    fact_type: "事实类型",
    roles: "角色",
    book_name: "书名",
    topic: "主题",
    target_item: "目标主体",
    sword: "飞剑设定",
    core_profile: "核心定位",
    appearance: "外形",
    before_refine: "炼化前",
    after_refine: "炼化后",
    stage_changes: "阶段变化",
    origin: "来源",
    traits: "特质",
    core_abilities: "核心能力",
    classic_records: "经典记录",
    global_uncertainties: "整体不确定性",
    major_characters: "主要人物",
    major_relationships: "主要关系",
    cultivation_system: "修行体系",
    important_items: "重要物品",
    major_events: "关键事件",
    major_foreshadowing: "重要伏笔"
  };
  return labels[key] || String(key || "").replace(/_/g, " ");
}

function labelForPath(path) {
  return path.map((key) => labelForKey(key)).join(" / ");
}
