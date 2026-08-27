#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import collections
import concurrent.futures
import csv
import json
import os
import re
import sqlite3
import time
import urllib.request
from pathlib import Path


BOOK_ID = "148431"
GROUP_KEY = "characters"
BOOK_NAME = "逆天邪神"
SCRIPT_DIR = Path(__file__).resolve().parent
BOOK_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_DB = BOOK_ROOT.parent.parent / "data" / "novel-chapters.sqlite"
DEFAULT_OUTPUT_DIR = BOOK_ROOT / "final" / "characters" / "data"


# Only merge identities explicitly established in the indexed facts. Ambiguous
# or multi-holder titles are excluded instead of being assigned speculatively.
CANONICAL_MAP = {
    "萧澈": "云澈",
    "梦见渊": "云澈",
    "雾皇": "云澈",
    "倾月": "夏倾月",
    "神无忆": "夏倾月",
    "蓝雪若": "苍月",
    "苍月公主": "苍月",
    "苍月女皇": "苍月",
    "天杀星神": "茉莉",
    "红发少女": "茉莉",
    "天狼星神": "彩脂",
    "彩脂公主": "彩脂",
    "元霸": "夏元霸",
    "吟雪界王": "沐玄音",
    "吟雪界大界王": "沐玄音",
    "雪児": "凤雪児",
    "雪公主": "凤雪児",
    "小仙女": "楚月婵",
    "月婵": "楚月婵",
    "梵帝神女": "千叶影儿",
    "云千影": "千叶影儿",
    "千影": "千叶影儿",
    "影儿": "千叶影儿",
    "龙皇": "龙白",
    "宙天神帝": "宙虚子",
    "劫天魔帝": "劫渊",
    "南溟神帝": "南万生",
    "星神帝": "星绝空",
    "释天神帝": "苍释天",
    "麒麟帝": "麒天理",
    "邪神": "逆玄",
    "元素创世神": "逆玄",
    "诛天神帝": "末厄",
    "诛天神帝末厄": "末厄",
    "渊皇": "末苏",
    "云萧": "萧云",
    "妖人": "云沧海",
    "古伯": "古烛",
    "冰云先祖": "沐冰云",
    "冰凰神灵": "冰凰少女",
    "金乌神灵": "金乌魂灵",
    "金乌圣神": "金乌魂灵",
    "凤凰之灵": "凤凰魂灵",
    "龙姜": "龙希",
    "云希": "龙希",
    "蝉衣": "南凰蝉衣",
    "绯灭": "绯灭龙神",
    "素心": "素心龙神",
    "彩璃": "画彩璃",
    "折天神女": "画彩璃",
    "彩璃神女": "画彩璃",
    "魔后": "池妩仸",
    "北域魔后": "池妩仸",
    "劫魂魔后": "池妩仸",
    "无梦神尊": "梦空蝉",
    "画心神尊": "画浮沉",
    "无明神尊": "神无厌夜",
    "剑君": "君无名",
    "妃雪": "沐妃雪",
    "妃雪仙子": "沐妃雪",
    "破云": "火破云",
    "炎神界王": "火破云",
    "琉光界王": "水千珩",
    "祛秽": "祛秽尊者",
    "海皇": "曲封忆",
    "绝罗神尊": "殿罗睺",
    "森罗神子": "殿九知",
    "龙主": "龙知命",
    "苍风帝皇": "苍万壑",
    "三皇子": "苍朔",
    "东方府主": "东方休",
    "寒薇公主": "东方寒薇",
    "辉染郡王": "辉染",
    "辉夜": "辉夜郡王",
    "古苍": "古苍真人",
    "冰凰宫主": "沐冰云",
    "木灵少女": "禾菱",
    "孤鹄公子": "天孤鹄",
    "魔女妖蝶": "妖蝶",
    "第四魔女": "妖蝶",
    "第七魔女": "婳锦",
    "炎宗主": "炎绝海",
    "焱宗主": "焱万苍",
    "太宇": "太宇尊者",
    "疤面龙女": "龙希",
    "龙小尊者": "龙希",
    "寒逸": "沐寒逸",
    "玉龙哥": "萧玉龙",
    "慕老爷子": "慕飞烟",
    "天元星神": "荼蘼",
    "天元星神荼蘼": "荼蘼",
    "焚月神帝": "焚道启",
}


EXCLUDED_ENTITIES = {
    "月神帝",  # held by both 月无涯 and 夏倾月
    "梵天神帝",  # held by both 千叶梵天 and 千叶影儿
    "小茉莉",  # index spans incompatible referents
    "秦府主",  # shared title for 秦无忧/秦无伤 in the index
    "医圣",  # shared title for 云谷/古秋鸿
    "少宫主",
    "少主",
    "太子",
    "神女",
    "公主",
    "父神",
    "母神",
    "少女",
    "女孩",
    "小女孩",
    "青年男子",
    "年轻男子",
    "白衣女子",
    "黑衣老者",
    "神秘少女",
    "妖异少女",
    "陌生女子",
    "黑衣人",
    "灰衣人",
    "三阎祖",
    "阎魔三祖",
    "天机三老",
    "劫心劫灵",
    "众人",
    "众弟子",
    "各宗主",
    "大神官",
    "第一梵王",
    "六笑神官",
    "灵仙神官",
    "邪婴万劫轮",
    "始祖剑",
    "天毒珠",
    "凤凰遗族",
}


GROUP_PATTERN = re.compile(
    r"(众|一行人|一众|所有人|诸人|群|众弟子|众长老|三老|三祖|两人|二人|弟子们|长老们)$"
)


ALIAS_NOISE_PATTERN = re.compile(
    r"^(他|她|少年|少女|男子|女子|年轻人|老者|前辈|晚辈|贵客|客人|弟子|师弟|师兄|师姐|师妹|"
    r"哥哥|姐姐|姐夫|老大|师父|主人|宗主|府主|界王|神帝|神女|公主|殿下|陛下|尊者|神君|"
    r"废物|白痴|小白脸|小杂种|野小子|妖人|魔人|祸害|小耗子)$"
)


def json_array(value):
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def unique(values):
    seen = set()
    result = []
    for value in values:
        value = str(value).strip()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def choose_facts(rows, fact_type, limit):
    candidates = [row for row in rows if row["fact_type"] == fact_type]
    if len(candidates) <= limit:
        return sorted(candidates, key=lambda row: row["chapter_index"])

    by_quality = sorted(
        candidates,
        key=lambda row: (
            -(row["confidence"] or 0),
            -(row["importance"] or 0),
            -len(row["fact"]),
        ),
    )
    by_recency = sorted(candidates, key=lambda row: row["chapter_index"], reverse=True)
    selected = []
    for row in by_recency[: max(2, limit // 2)] + by_quality:
        if row["id"] not in {item["id"] for item in selected}:
            selected.append(row)
        if len(selected) == limit:
            break
    return sorted(selected, key=lambda row: row["chapter_index"])


def fact_payload(row):
    evidence = unique(json_array(row["evidence"]))[:4]
    return {
        "chapter": row["chapter_index"],
        "type": row["fact_type"],
        "fact": row["fact"],
        "evidence": evidence,
        "importance": row["importance"],
        "confidence": row["confidence"],
    }


def build_input(character_name, members, rows, fact_count):
    alias_counts = collections.Counter()
    for row in rows:
        for alias in json_array(row["aliases"]):
            alias = str(alias).strip()
            if (
                alias
                and alias != character_name
                and alias not in members
                and len(alias) <= 14
                and not ALIAS_NOISE_PATTERN.match(alias)
            ):
                alias_counts[alias] += 1

    facts = []
    for fact_type, limit in (
        ("appearance", 10),
        ("age", 7),
        ("personality", 5),
        ("identity", 6),
        ("identity_clue", 3),
        ("cultivation", 3),
        ("alias", 5),
    ):
        facts.extend(fact_payload(row) for row in choose_facts(rows, fact_type, limit))

    return {
        "character_name": character_name,
        "merged_entity_names": members,
        "fact_count": fact_count,
        "alias_candidates": [name for name, _ in alias_counts.most_common(18)],
        "facts": facts,
    }


def parse_json_content(content):
    content = content.strip()
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    return json.loads(content)


def request_batch(api_url, api_key, model, batch):
    prompt = """你是《逆天邪神》角色形象资料的严谨编辑。请逐项整理输入角色，只能使用输入事实和原文证据，禁止凭小说常识或名称补写。

输出 JSON 数组，逐项对应输入角色。每项字段固定为：source_character_name, records。records 是一个或多个阶段记录，每条字段固定为：phase_suffix, aliases, gender, age, appearance_description, evidence, image_prompt, qa_age_consistency, qa_temperament_consistency, qa_notes。

规则：
1. aliases 只保留能明确指向同一人的本名、旧名、化名或稳定专属称号；不要收录亲昵称呼、关系称谓、辱称、通用职位、伪装对象。merged_entity_names 中除规范名外的名称可在证据明确时作为别名。
2. gender 仅在事实、证据明确，或“其女/其子/女子/男子/夫/妻”等称谓高度明确时写“男”或“女”，否则写“未知”。
3. age 保留明确 age 事实的原始表述。没有年龄事实写“未知”。年龄极大但外观为青年/少女时，分别说明实际年龄和外观年龄，不混为一谈。
4. 只有同一角色存在原文明示的多个年龄/时期，且外貌或稳定气质发生实质变化时，records 才拆为 2 至 3 条。phase_suffix 用“少年”“成年”等简短明确名称；不拆分时填空字符串。临时换装、战损、易容、单场动作、身份称号或单纯境界变化不得拆阶段。拆分后每条的 age、appearance_description、evidence、image_prompt 只能使用该阶段事实，禁止跨阶段混用。
5. appearance_description 用一段简洁中文综合该阶段稳定、有视觉价值的外貌。优先采用明确、非受伤、非易容、非瞬时动作的 appearance；可补充有视觉价值且有证据的 identity/cultivation 服饰、种族或标志物。绝不混合少年与成年特征，不编造发色、瞳色、服装、身材或武器。
6. personality 只用于校验气质，不得通过表情或动作写进立绘。气质不明确就不补。
7. evidence 为 1 至 3 条字符串，格式“第N章：原文短句”，必须逐字选自输入 evidence；优先支持外貌、年龄和标志性视觉，不要把 fact 改写当原文。
8. image_prompt 为中文 gpt-image-2 提示词，以同阶段 appearance_description 为唯一人物设定来源，明确：人物白底立绘、全身照、纯白色背景、无表情、无肢体动作、自然站立、双手垂放在大腿两侧、画幅比例 3:4。必须与 age 相容；未成年明确写相应年龄外观；年龄未知不得擅定具体年龄。不得加入 description 中没有的外貌元素。允许用服饰色彩、材质与克制的静态氛围表达气质，不使用特效背景。
9. qa_age_consistency 写“通过：...”或“不通过：...”，说明年龄字段、形象描述、提示词是否同一阶段。必须先自检，发现冲突就修正其他字段后写通过。
10. qa_temperament_consistency 写“通过：...”或“不通过：...”，说明形象与 personality/identity 证据的气质是否一致且未借表情动作表现。发现冲突先修正后写通过。
11. qa_notes 简述采用的时间阶段、舍弃的冲突或缺失信息；拆分时必须说明阶段边界。无明显问题也要说明。严格逐项覆盖输入，不得遗漏、重复或添加角色。

输入：
""" + json.dumps(batch, ensure_ascii=False)
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    last_error = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                body = json.load(response)
            result = parse_json_content(body["choices"][0]["message"]["content"])
            if not isinstance(result, list) or len(result) != len(batch):
                raise ValueError(f"expected {len(batch)} results, got {len(result)}")
            names = [item.get("source_character_name") for item in result]
            expected = [item["character_name"] for item in batch]
            if names != expected:
                raise ValueError(f"character order mismatch: {names} != {expected}")
            if any(not isinstance(item.get("records"), list) or not item["records"] for item in result):
                raise ValueError("every source character must contain at least one record")
            return result
        except Exception as error:
            last_error = error
            time.sleep(2**attempt)
    raise RuntimeError(f"model request failed after retries: {last_error}")


def normalize_result(source, generated, phase_index, phase_count):
    aliases = generated.get("aliases", [])
    if isinstance(aliases, str):
        aliases = re.split(r"[、,，;；]", aliases)
    aliases = [alias for alias in unique(aliases) if alias != source["character_name"]]

    evidence = generated.get("evidence", [])
    if isinstance(evidence, str):
        evidence = [line.strip() for line in evidence.splitlines() if line.strip()]
    evidence = unique(evidence)[:3]

    description = str(generated.get("appearance_description") or "").strip()
    if not description:
        description = "L2 索引未提供可确认的外貌信息"

    age = str(generated.get("age") or "未知").strip()
    gender = str(generated.get("gender") or "未知").strip()
    if gender not in {"男", "女", "未知"}:
        gender = "未知"

    image_prompt = str(generated.get("image_prompt") or "").strip()
    required = ["纯白", "全身", "无表情", "自然站立", "双手", "3:4"]
    if not all(term in image_prompt for term in required):
        image_prompt = (
            f"{description}。人物白底立绘，全身照，纯白色背景，无表情，无肢体动作，"
            "自然站立，双手垂放在大腿两侧，画幅比例 3:4。"
        )

    suffix = str(generated.get("phase_suffix") or "").strip()
    if phase_count > 1 and not suffix:
        suffix = f"阶段{phase_index + 1}"
    output_name = source["character_name"] if not suffix else f'{source["character_name"]}-{suffix}'

    return {
        "book_name": BOOK_NAME,
        "character_name": output_name,
        "aliases": aliases,
        "gender": gender,
        "age": age,
        "appearance_description": description,
        "evidence": evidence,
        "image_prompt": image_prompt,
        "fact_count": source["fact_count"],
        "qa_age_consistency": str(generated.get("qa_age_consistency") or "未完成检查").strip(),
        "qa_temperament_consistency": str(
            generated.get("qa_temperament_consistency") or "未完成检查"
        ).strip(),
        "qa_notes": str(generated.get("qa_notes") or "").strip(),
    }


def write_outputs(output_dir, records):
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "characters.json"
    csv_path = output_dir / "characters.csv"
    json_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    fieldnames = [
        "book_name",
        "character_name",
        "aliases",
        "gender",
        "age",
        "appearance_description",
        "evidence",
        "image_prompt",
        "fact_count",
        "qa_age_consistency",
        "qa_temperament_consistency",
        "qa_notes",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            row = dict(record)
            row["aliases"] = "、".join(record["aliases"])
            row["evidence"] = "\n".join(record["evidence"])
            writer.writerow(row)
    return json_path, csv_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--api-url", default="https://apitokenzz.xyz/v1/chat/completions")
    parser.add_argument("--model", default="gpt-5.4-mini")
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--batch-size", type=int, default=6)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    connection = sqlite3.connect(f"file:{Path(args.db).resolve()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    rows = [
        dict(row)
        for row in connection.execute(
            """
            SELECT id, entity, aliases, chapter_index, fact_type, fact, evidence,
                   importance, confidence
            FROM l2_facts
            WHERE book_id = ? AND index_group_key = ? AND status = 'completed'
            """,
            (BOOK_ID, GROUP_KEY),
        )
    ]
    connection.close()

    grouped = collections.defaultdict(list)
    members = collections.defaultdict(set)
    for row in rows:
        entity = row["entity"].strip()
        if not entity or entity in EXCLUDED_ENTITIES or GROUP_PATTERN.search(entity):
            continue
        canonical = CANONICAL_MAP.get(entity, entity)
        if canonical in EXCLUDED_ENTITIES:
            continue
        grouped[canonical].append(row)
        members[canonical].add(entity)

    ranked = sorted(grouped, key=lambda name: (-len(grouped[name]), name))[: args.limit]
    sources = [
        build_input(name, sorted(members[name]), grouped[name], len(grouped[name]))
        for name in ranked
    ]
    batches = [sources[index : index + args.batch_size] for index in range(0, len(sources), args.batch_size)]

    generated_by_name = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(request_batch, args.api_url, api_key, args.model, batch): batch
            for batch in batches
        }
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            for item in result:
                generated_by_name[item["source_character_name"]] = item["records"]
            completed += len(result)
            print(f"processed {completed}/{len(sources)}", flush=True)

    records = []
    split_characters = 0
    for source in sources:
        phases = generated_by_name[source["character_name"]]
        if len(phases) > 1:
            split_characters += 1
        for phase_index, phase in enumerate(phases):
            records.append(normalize_result(source, phase, phase_index, len(phases)))
    json_path, csv_path = write_outputs(Path(args.output_dir), records)
    print(f"source_characters={len(sources)}")
    print(f"split_characters={split_characters}")
    print(f"output_records={len(records)}")
    print(json_path)
    print(csv_path)


if __name__ == "__main__":
    main()
