import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const bookRoot = path.resolve(import.meta.dirname, '../..')
const repoRoot = path.resolve(bookRoot, '../..')
const dataDir = path.join(bookRoot, 'final', 'characters', 'data')
const excerptsDir = path.join(bookRoot, 'inputs', 'source-excerpts')
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(excerptsDir, { recursive: true })

const db = new DatabaseSync(path.join(repoRoot, 'data', 'novel-chapters.sqlite'), { readOnly: true })
const bookId = '222767'
const lastChapter = 3859
const missing = new Set(Array.from({ length: 10 }, (_, index) => 2231 + index))

const sampleIndexes = [...new Set(Array.from({ length: 100 }, (_, index) =>
  Math.round(1 + (lastChapter - 1) * index / 99),
).map((chapter) => {
  while (missing.has(chapter)) chapter += 10
  return Math.min(chapter, lastChapter)
}))]

const chapterStmt = db.prepare(`
  SELECT chapter_index, title, content FROM chapters
  WHERE book_id = ? AND chapter_index = ?
`)
const samples = sampleIndexes.map((chapter) => chapterStmt.get(bookId, chapter)).filter(Boolean)
fs.writeFileSync(path.join(excerptsDir, '100章原文抽样.json'), JSON.stringify(samples, null, 2))
fs.writeFileSync(path.join(excerptsDir, '100章原文抽样.md'), samples.map((chapter) =>
  `## 第${chapter.chapter_index}章 ${chapter.title}\n\n${chapter.content}`,
).join('\n\n---\n\n'))

const parseArray = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
const unique = (values) => [...new Set(values.filter(Boolean))]
const normalized = (value) => String(value || '').replace(/\s+/g, '')
const genericEntity = /^(他|她|男人|女人|男子|女子|男孩|女孩|少年|少女|老人|老者|孩子|婴儿|宝宝|父亲|母亲|爸爸|妈妈|爷爷|奶奶|外公|外婆|司机|医生|护士|保镖|佣人|助理|秘书|服务员|众人|一行人|黑衣人|神秘人|对方|那人|大师|道士|厉鬼|鬼魂)$/
const groupEntity = /(众人|一行人|众保镖|众佣人|夫妻俩|父子俩|母女俩|兄弟俩|姐妹俩)$/
const transient = /受伤|伤口|流血|血迹|吐血|昏迷|病容|病重|苍白|惨白|憔悴|消瘦|红肿|淤青|怀孕|孕肚|生产|产后|哭|泪|醉酒|凌乱|湿透|婚礼|伴娘|礼服|晚宴|睡衣|病号服|囚服|寿衣/
const stageRules = [
  { label: '幼年', re: /小时候|幼年时|幼时|孩提时|(?:三|四|五|六|七|八|九|三四|五六|七八)岁时|三岁照片|四岁照片/ },
  { label: '少年', re: /少年时|少年时期|少女时期|十[一二三四五六七八]岁时|十三四岁|高中时|中学时/ },
  { label: '老年', re: /老年|年迈|花甲|古稀|老人|老者|老太太|老爷子|白发苍苍/ },
]

const rows = db.prepare(`
  SELECT entity, aliases, tags, fact_type, fact, evidence, importance, confidence, chapter_index
  FROM l2_facts
  WHERE book_id = ? AND index_group_key = 'characters' AND status = 'completed'
  ORDER BY entity, chapter_index
`).all(bookId)

const grouped = new Map()
for (const row of rows) {
  const entity = String(row.entity || '').trim()
  if (!entity || genericEntity.test(entity) || groupEntity.test(entity)) continue
  const item = grouped.get(entity) || { entity, aliases: new Set(), facts: [], chapters: new Set() }
  for (const alias of parseArray(row.aliases)) {
    const clean = String(alias).trim()
    if (clean && clean !== entity && clean.length <= 16 && !genericEntity.test(clean)) item.aliases.add(clean)
  }
  item.facts.push({
    type: row.fact_type,
    fact: row.fact,
    evidence: parseArray(row.evidence),
    tags: parseArray(row.tags),
    importance: Number(row.importance || 0),
    confidence: Number(row.confidence || 0),
    chapter: row.chapter_index,
  })
  item.chapters.add(row.chapter_index)
  grouped.set(entity, item)
}

const rank = (facts) => [...facts].sort((a, b) =>
  b.importance + b.confidence - a.importance - a.confidence || a.chapter - b.chapter,
)
const choose = (facts, types, limit) => rank(facts.filter((fact) => types.includes(fact.type)))
  .filter((fact, index, list) => list.findIndex((other) => normalized(other.fact) === normalized(fact.fact)) === index)
  .slice(0, limit)
const evidenceLines = (facts, limit) => {
  const lines = []
  for (const fact of rank(facts)) {
    for (const evidence of fact.evidence) {
      const line = `第${fact.chapter}章：${evidence}`
      if (!lines.includes(line)) lines.push(line)
      if (lines.length >= limit) return lines
    }
  }
  return lines
}

function phasesFor(item) {
  const appearances = item.facts.filter((fact) => fact.type === 'appearance' && !transient.test(fact.fact))
  const phases = []
  const used = new Set()
  for (const rule of stageRules) {
    const facts = appearances.filter((fact) => !used.has(fact) && rule.re.test(fact.fact + fact.evidence.join('')))
    if (new Set(facts.map((fact) => fact.chapter)).size >= 2) {
      phases.push({ label: rule.label, facts })
      facts.forEach((fact) => used.add(fact))
    }
  }
  const base = appearances.filter((fact) => !used.has(fact))
  if (base.length || !phases.length) phases.unshift({ label: '', facts: base.length ? base : appearances })
  return phases.slice(0, 3)
}

function ageForPhase(ageFacts, label) {
  if (!label) return ageFacts
  const rule = stageRules.find((item) => item.label === label)
  const matching = rule ? ageFacts.filter((fact) => rule.re.test(fact.fact + fact.evidence.join(''))) : []
  return matching.length ? matching : []
}

function inferGender(item) {
  const text = item.facts.map((fact) => fact.fact + fact.evidence.join('')).join('')
  const female = (text.match(/她|女子|女孩|女儿|妻子|太太|夫人|小姐|奶奶|外婆|母亲|妈妈/g) || []).length
  const male = (text.match(/他|男子|男孩|儿子|丈夫|先生|少爷|爷爷|外公|父亲|爸爸/g) || []).length
  return female > male ? '女' : male > female ? '男' : '未知'
}

const characters = []
for (const item of grouped.values()) {
  const stableAppearance = item.facts.filter((fact) => fact.type === 'appearance' && !transient.test(fact.fact))
  if (!stableAppearance.length) continue
  if (item.chapters.size < 2 && Math.max(...stableAppearance.map((fact) => fact.importance)) < 0.7) continue
  const identityFacts = choose(item.facts, ['identity', 'background', 'identity_clue'], 4)
  const ageFacts = choose(item.facts, ['age'], 3)
  const personalityFacts = choose(item.facts, ['personality'], 3)
  for (const phase of phasesFor(item)) {
    if (!phase.facts.length) continue
    const visualFacts = choose(phase.facts, ['appearance'], 4)
    const phaseAgeFacts = ageForPhase(ageFacts, phase.label)
    const name = phase.label ? `${item.entity}-${phase.label}` : item.entity
    const identity = identityFacts.map((fact) => fact.fact).join('；') || '原文未明确'
    const age = phaseAgeFacts.map((fact) => fact.fact).join('；') || (phase.label ? `${phase.label}，原文未明确具体年龄` : '原文未明确')
    const appearance = visualFacts.map((fact) => fact.fact).join('；')
    const temperament = personalityFacts.map((fact) => fact.fact).join('；') || '原文未明确'
    const prompt = [
      `${name}，${inferGender(item)}，年龄：${age}。`,
      `身份：${identity.split(/[；。]/)[0]}。`,
      `稳定形象：${appearance}。`,
      `气质：${temperament.split(/[；。]/).slice(0, 2).join('；')}。`,
      '现代都市女频漫画风，精致二维国漫或轻半厚涂角色设定稿，非写实、非照片感，人物比例自然修长，服装符合当代中国都市身份与年龄。',
      '生成单一人物全身立绘，无表情，正面自然站立，双手自然垂于身体两侧，不持道具，从头顶到鞋底完整可见，纯白色背景，图片比例3:4。',
      '画面内禁止文字、姓名、水印、边框、场景、家具、光效；严格遵循原文已明确的年龄、五官、发型、体态、服饰与标志特征，不添加无证据的发色、瞳色、珠宝或奢华礼服。',
    ].join('')
    characters.push({
      book_name: '离婚后她惊艳了世界',
      character_name: name,
      base_character: item.entity,
      stage: phase.label || '常态',
      aliases: [...item.aliases].slice(0, 20),
      identity,
      age,
      appearance_description: appearance,
      temperament,
      evidence: unique([
        ...evidenceLines(visualFacts, 3),
        ...evidenceLines(phaseAgeFacts, 1),
        ...evidenceLines(identityFacts, 1),
        ...evidenceLines(personalityFacts, 1),
      ]).slice(0, 6),
      image_prompt: prompt,
      match_score: null,
      match_review: '待生图后按SOP复核',
      l2_fact_count: item.facts.length,
      l2_chapter_count: item.chapters.size,
    })
  }
}

characters.sort((a, b) => b.l2_chapter_count - a.l2_chapter_count || b.l2_fact_count - a.l2_fact_count)
fs.writeFileSync(path.join(dataDir, 'characters.json'), JSON.stringify(characters, null, 2))
fs.writeFileSync(path.join(dataDir, 'summary.json'), JSON.stringify({
  book_name: '离婚后她惊艳了世界',
  total_chapters: lastChapter,
  sampled_chapters: sampleIndexes,
  sampled_chapter_count: samples.length,
  l2_fact_count: rows.length,
  l2_raw_entity_count: grouped.size,
  l2_appearance_entity_count: [...grouped.values()].filter((item) => item.facts.some((fact) => fact.type === 'appearance')).length,
  qualified_character_count: new Set(characters.map((item) => item.base_character)).size,
  final_stage_record_count: characters.length,
}, null, 2))

console.log(JSON.stringify({ dataDir, excerptsDir, samples: samples.length, records: characters.length }, null, 2))
