/*
  L1/L2 索引任务的 prompt 与输入构造。
  纯叶子模块：不 import db / workflows / config，供 db.js seed 与 workflows.js 复用。
*/

export function buildL1ChapterInput({ chapterIndex, title, content, indexPrompt }) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            indexPrompt || defaultL1IndexPrompt(),
            "",
            `章节编号：${chapterIndex}`,
            `章节标题：${title || ""}`,
            "",
            "章节原文：",
            content
          ].join("\n")
        }
      ]
    }
  ];
}

export function buildL2ChapterInput({ chapterIndex, title, content, l1Index, knownSubjects = [], indexPrompt }) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            indexPrompt || defaultL2IndexPrompt(),
            "",
            `章节编号：${chapterIndex}`,
            `章节标题：${title || ""}`,
            "",
            "可选 L1 路标 JSON：",
            JSON.stringify(l1Index || null),
            "",
            "已确认的神奇生物主体 JSON（仅用于识别后续章节事实，不得把历史准入证据伪装成本章证据）：",
            JSON.stringify(knownSubjects || []),
            "",
            "章节原文：",
            content
          ].join("\n")
        }
      ]
    }
  ];
}

export function defaultL1IndexPrompt() {
  return [
    "请为当前小说章节建立轻量 L1 章节路由/信号索引。",
    "定位：L1 只判断本章有哪些可召回信号，服务后续按章节命中后读取 L2 专项事实；不要写长摘要，不要沉淀事实卡，不要替代 L2。",
    "只依据本章原文，输出稳定主体、别名、关键词和分类信号；信号要短、准、可检索。",
    "分类只能使用：character、relationship、cultivation、force、item、location、event、foreshadowing、other。",
    "如果本章没有明显信号，signals 输出空数组，category_scores 保持低分。"
  ].join("\n");
}

export function defaultL2IndexPrompt() {
  return [
    "请为当前小说章节建立 L2 类型化事实索引。",
    "目标：提取可复用、可检索、可追溯的事实单元，不要写长摘要，不要输出 Markdown。",
    "分类只能使用：character、relationship、cultivation、force、item、location、event、foreshadowing、other。",
    "每条事实必须短而明确，保留主体、相关主体、事实类型、重要度、置信度和少量证据摘记。",
    "不要补充本章原文之外的信息；如果本章没有可复用事实，facts 输出空数组。"
  ].join("\n");
}

export function l1ChapterIndexSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      route_schema_version: { type: "string" },
      route_entities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            aliases: {
              type: "array",
              items: { type: "string" }
            },
            role: { type: "string" },
            note: { type: "string" }
          },
          required: ["name", "type", "aliases", "role", "note"]
        }
      },
      route_keywords: {
        type: "array",
        items: { type: "string" }
      },
      signals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["character", "relationship", "cultivation", "force", "item", "location", "event", "foreshadowing", "other"]
            },
            strength: { type: "number" },
            entities: {
              type: "array",
              items: { type: "string" }
            },
            keywords: {
              type: "array",
              items: { type: "string" }
            },
            reason: { type: "string" }
          },
          required: ["category", "strength", "entities", "keywords", "reason"]
        }
      },
      category_scores: {
        type: "object",
        additionalProperties: false,
        properties: {
          character: { type: "number" },
          relationship: { type: "number" },
          cultivation: { type: "number" },
          force: { type: "number" },
          item: { type: "number" },
          location: { type: "number" },
          event: { type: "number" },
          foreshadowing: { type: "number" },
          other: { type: "number" }
        },
        required: ["character", "relationship", "cultivation", "force", "item", "location", "event", "foreshadowing", "other"]
      }
    },
    required: ["route_schema_version", "route_entities", "route_keywords", "signals", "category_scores"]
  };
}

export function l2ChapterFactsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      chapter_index: { type: "integer" },
      chapter_title: { type: "string" },
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["character", "relationship", "cultivation", "force", "item", "magical_creature", "location", "event", "foreshadowing", "other"]
            },
            entity: { type: "string" },
            aliases: {
              type: "array",
              items: { type: "string" }
            },
            tags: {
              type: "array",
              items: { type: "string" }
            },
            related_entities: {
              type: "array",
              items: { type: "string" }
            },
            fact_type: { type: "string" },
            fact: { type: "string" },
            evidence: {
              type: "array",
              items: { type: "string" }
            },
            importance: { type: "number" },
            confidence: { type: "number" },
            scope_eligible: { type: "boolean" },
            scope_basis: { type: "string" },
            transformation_eligible: { type: "boolean" },
            creature_type: { type: "string" },
            original_form: { type: "string" },
            qualification_evidence: { type: "array", items: { type: "string" } },
            subject_key: { type: "string" },
            identity_basis: { type: "string" }
          },
          required: ["category", "entity", "aliases", "tags", "related_entities", "fact_type", "fact", "evidence", "importance", "confidence"]
        }
      }
    },
    required: ["facts"]
  };
}
