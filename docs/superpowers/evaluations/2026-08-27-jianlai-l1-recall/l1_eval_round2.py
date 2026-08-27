#!/usr/bin/env python3
"""第二轮：只用证据可在本章原文中验证的 L2 事实，重新评估 L1 召回"""
import sqlite3, json, collections, re

db = sqlite3.connect('data/novel-chapters.sqlite')
db.row_factory = sqlite3.Row
BOOK = '143170'
CHS = range(1, 51)
GROUPS = ['custom-index-2', 'custom-index-3', 'custom-index-4', 'custom-index-5']

def J(s, d):
    try: return json.loads(s) if s else d
    except Exception: return d

contents = {r['chapter_index']: r['content'] for r in db.execute(
    "SELECT chapter_index, content FROM chapters WHERE book_id=? AND chapter_index BETWEEN 1 AND 50", (BOOK,))}

l1 = {}
for r in db.execute("SELECT * FROM l1_chapter_indexes WHERE book_id=? AND chapter_index BETWEEN 1 AND 50", (BOOK,)):
    l1[r['chapter_index']] = {'entities': J(r['route_entities'], []), 'keywords': J(r['route_keywords'], []),
                              'signals': J(r['signals'], []), 'scores': J(r['category_scores'], {})}

# L2 事实 + 证据校验
total, verified = 0, 0
vfacts = collections.defaultdict(list)
unverified_by_group = collections.Counter()
for r in db.execute(f"SELECT chapter_index, index_group_key, category, entity, fact, evidence FROM l2_facts "
                    f"WHERE book_id=? AND index_group_key IN ({','.join('?'*len(GROUPS))}) AND chapter_index BETWEEN 1 AND 50",
                    (BOOK, *GROUPS)):
    total += 1
    ev = J(r['evidence'], [])
    content = contents.get(r['chapter_index'], '')
    ok = False
    for e in ev:
        e = re.sub(r'\s+', '', str(e))[:50]
        if len(e) >= 8 and e in re.sub(r'\s+', '', content):
            ok = True; break
        if len(e) >= 8 and e[:20] in re.sub(r'\s+', '', content):
            ok = True; break
    if not ev:  # 无证据的单独统计，不算verified
        pass
    if ok:
        verified += 1
        vfacts[r['chapter_index']].append(dict(r))
    else:
        unverified_by_group[r['index_group_key']] += 1
print(f'== L2 证据可校验率: {verified}/{total} = {verified/total:.1%} ==')
print('   不可校验(含无证据)按组:', dict(unverified_by_group))

# 用可校验事实重算实体召回
print()
print('== 校正后 L2 实体 → L1 召回 ==')
recall_all, missed = [], collections.Counter()
for ch in CHS:
    ents = set()
    for f in vfacts.get(ch, []):
        e = (f['entity'] or '').strip()
        # 过滤明显的描述性/垃圾实体名
        if len(e) < 2 or '（' in e or '(' in e: continue
        if e in ('婢女','少年','小女孩','老人','妇人','男子'): continue
        ents.add(e)
    if not ents: continue
    hay = set(l1[ch]['keywords'])
    for ent in l1[ch]['entities']:
        hay.add(ent.get('name','')); hay.update(ent.get('aliases') or [])
    hit, miss = 0, []
    for e in ents:
        if e in hay or any((e in h or h in e) for h in hay if len(h) >= 2): hit += 1
        else: miss.append(e); missed[e] += 1
    recall_all.append((ch, hit, len(ents), miss))
avg = sum(h/m for _,h,m,_ in recall_all)/len(recall_all)
print(f'   平均召回率: {avg:.1%} ({len(recall_all)}章)')
for ch,h,m,miss in sorted(recall_all, key=lambda x:x[1]/x[2])[:8]:
    print(f'   ch{ch:3d} {h}/{m} 未命中: {miss[:10]}')
print('   高频未命中:', missed.most_common(20))

# ch2 L1 是否覆盖 魁梧老人/高冠年轻人
print()
print('== ch2 L1 实体与关键词 ==')
print('  entities:', [e['name'] for e in l1[2]['entities']])
print('  keywords:', l1[2]['keywords'])
c2 = contents[2]
for w in ['魁梧老人','高冠','齐先生','齐静春']:
    print(f'  ch2原文含{w!r}:', w in c2, f'x{c2.count(w)}' if w in c2 else '')

# ch48/49/50 cultivation/item 可校验事实 vs L1 得分
print()
print('== ch47-50 可校验事实分类 vs L1 得分 ==')
for ch in [47,48,49,50]:
    cats = collections.Counter(f['category'] for f in vfacts.get(ch, []))
    print(f'  ch{ch}: verified={sum(cats.values())} {dict(cats)} | L1 scores={l1[ch]["scores"]}')
