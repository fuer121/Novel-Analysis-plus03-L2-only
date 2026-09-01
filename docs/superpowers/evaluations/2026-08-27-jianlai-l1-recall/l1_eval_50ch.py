#!/usr/bin/env python3
"""对比《剑来》前50章 L1 路由信号与 L2 事实索引的匹配度"""
import sqlite3, json, collections

db = sqlite3.connect('data/novel-chapters.sqlite')
db.row_factory = sqlite3.Row
BOOK = '143170'
CHS = range(1, 51)

def J(s, default):
    try:
        return json.loads(s) if s else default
    except Exception:
        return default

# ---- L1 ----
l1 = {}
for r in db.execute("SELECT * FROM l1_chapter_indexes WHERE book_id=? AND chapter_index BETWEEN 1 AND 50", (BOOK,)):
    l1[r['chapter_index']] = {
        'entities': J(r['route_entities'], []),
        'keywords': J(r['route_keywords'], []),
        'signals': J(r['signals'], []),
        'scores': J(r['category_scores'], {}),
    }

# ---- L2 (仅启用且实际构建的组) ----
GROUPS = ['custom-index-2', 'custom-index-3', 'custom-index-4', 'custom-index-5']
l2facts = collections.defaultdict(list)
for r in db.execute(
    f"SELECT chapter_index, index_group_key, category, entity, aliases, fact_type, fact, importance FROM l2_facts "
    f"WHERE book_id=? AND index_group_key IN ({','.join('?'*len(GROUPS))}) AND chapter_index BETWEEN 1 AND 50",
    (BOOK, *GROUPS)):
    l2facts[r['chapter_index']].append(dict(r))

CATS = ['character','relationship','cultivation','force','item','location','event','foreshadowing','other']

print('== 1. L1 category_scores 分布（50章）==')
for c in CATS:
    vals = [l1[ch]['scores'].get(c, 0) for ch in CHS if ch in l1]
    zero = sum(1 for v in vals if v == 0)
    low = sum(1 for v in vals if 0 < v <= 0.4)
    mid = sum(1 for v in vals if 0.5 <= v <= 0.7)
    high = sum(1 for v in vals if v >= 0.8)
    print(f'  {c:14s} mean={sum(vals)/len(vals):.2f}  0分:{zero:2d}  弱(0-0.4]:{low:2d}  中(0.5-0.7]:{mid:2d}  高(>=0.8):{high:2d}')

print()
print('== 2. 每章 L2 facts 数 vs L1 对应类得分 —— 漏报（L2>=3条 且 L1该类<=0.4）==')
miss_rows = []
for ch in CHS:
    facts = l2facts.get(ch, [])
    bycat = collections.Counter(f['category'] for f in facts)
    for cat, n in bycat.items():
        score = l1[ch]['scores'].get(cat, 0) if ch in l1 else None
        if n >= 3 and (score is None or score <= 0.4):
            miss_rows.append((ch, cat, n, score))
            break
total_facts_by_ch = {ch: len(l2facts.get(ch, [])) for ch in CHS}
for ch, cat, n, score in sorted(miss_rows):
    cats = collections.Counter(f['category'] for f in l2facts[ch])
    print(f'  ch{ch:3d}  L2共{total_facts_by_ch[ch]:2d}条 {dict(cats)}  | 漏: {cat}={n}条 但L1 {cat}={score}')
print(f'  漏报章节数: {len(miss_rows)}/50')

print()
print('== 3. 反向: L1打高分(>=0.5)但L2该类0条 —— 类别粒度 ==')
false_alarm = collections.Counter()
for ch in CHS:
    facts = l2facts.get(ch, [])
    bycat = collections.Counter(f['category'] for f in facts)
    for cat in CATS:
        s = l1[ch]['scores'].get(cat, 0)
        if s >= 0.5 and bycat.get(cat, 0) == 0:
            false_alarm[cat] += 1
for cat, n in false_alarm.most_common():
    print(f'  {cat}: {n} 章次')

print()
print('== 4. L2 实体在 L1 中的召回（按章，实体名出现在 route_entities 名/别名 或 keywords）==')
recall_stats = []
missed_entities = collections.Counter()
for ch in CHS:
    ents = set()
    for f in l2facts.get(ch, []):
        e = (f['entity'] or '').strip()
        if len(e) >= 2:
            ents.add(e)
    if not ents:
        continue
    hay = set(l1[ch]['keywords'])
    for ent in l1[ch]['entities']:
        hay.add(ent.get('name',''))
        for a in ent.get('aliases') or []:
            hay.add(a)
    haystr = '|'.join(hay)
    hit, miss = 0, []
    for e in ents:
        if e in hay or any(e in h or h in e for h in hay if len(h) >= 2):
            hit += 1
        else:
            miss.append(e)
            missed_entities[e] += 1
    recall_stats.append((ch, hit, len(ents), miss))
avg_recall = sum(h/m for _, h, m, _ in recall_stats) / len(recall_stats)
print(f'  平均召回率: {avg_recall:.1%}  (按章平均, 共{len(recall_stats)}章有L2实体)')
worst = sorted(recall_stats, key=lambda x: x[1]/x[2])[:10]
for ch, h, m, miss in worst:
    print(f'  ch{ch:3d} 召回{h}/{m}  未命中: {miss[:8]}')
print('  高频未命中实体:', missed_entities.most_common(15))

print()
print('== 5. L1 signals 数量与 reason 分布 ==')
sig_counts = [len(l1[ch]['signals']) for ch in CHS]
print(f'  每章 signals: min={min(sig_counts)} max={max(sig_counts)} mean={sum(sig_counts)/len(sig_counts):.1f}')
reasons = collections.Counter()
for ch in CHS:
    for s in l1[ch]['signals']:
        reasons[s.get('reason','')[:20]] += 1
for r, n in reasons.most_common(12):
    print(f'  {n:3d}  {r}')

print()
print('== 6. L2 各组 facts 的 category 分布（前50章）==')
for g in GROUPS:
    cats = collections.Counter(f['category'] for f in db.execute(
        "SELECT category FROM l2_facts WHERE book_id=? AND index_group_key=? AND chapter_index BETWEEN 1 AND 50", (BOOK, g)))
    print(f'  {g:16s} {dict(cats)}')
