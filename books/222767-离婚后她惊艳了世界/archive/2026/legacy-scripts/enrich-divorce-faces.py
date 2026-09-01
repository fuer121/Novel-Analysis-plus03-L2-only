#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path


def api_key():
    value = os.environ.get("OPENAI_API_KEY", "").strip()
    if value:
        return value
    result = subprocess.run(
        ["security", "find-generic-password", "-s", "codex-apitokenzz", "-w"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise SystemExit("No API key found in OPENAI_API_KEY or macOS Keychain")
    return result.stdout.strip()


def parse_json(text):
    text = re.sub(r"^```(?:json)?\s*", "", text.strip())
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def request_batch(url, key, model, batch):
    prompt = """你是现代都市女频漫画的角色设定总监。请为输入的每条角色阶段记录补充差异化五官描述，并更新 GPT Image 2 生图提示词。只能依据输入内容做视觉转译，不得补写剧情事实。

输出 JSON 数组，顺序与输入完全一致，每项字段固定为：character_name、facial_description、image_prompt。

规则：
1. facial_description 必须是一段可直接用于画师和生图模型的中文描述，明确覆盖脸型/面部轮廓、眉形、眼型与眼距、鼻型、唇形、下颌或骨相、年龄感，建议 70-150 字。
2. 五官组合必须与年龄、形象和气质吻合。例如温婉可用柔和面部线条与舒展眉眼，清冷可用窄长眼型与利落下颌，英武可强化眉骨与直线型轮廓，阴郁可用较深眼窝与收束唇线。不得通过表情、动作、妆容或背景代替骨相差异。
3. 禁止把所有女性统一写成瓜子脸、大眼睛、樱桃唇，禁止把所有男性统一写成剑眉星目、高鼻薄唇。每条至少给出两个能和其他角色区分的稳定五官锚点。
4. 输入未明确具体五官时，允许根据年龄、性别、身份和稳定气质做克制的漫画视觉设计，但必须使用“设计为”或“建议呈现”，不得伪装成原文事实；不得擅定彩色瞳孔、特殊发色、伤疤、痣、纹身或异族器官。
5. 年龄与阶段优先级最高。幼年用儿童骨相，少年保留未完全长开的轮廓，老年保留皱纹、松弛或沧桑感；不得把年长角色统一年轻化。
6. image_prompt 必须保留输入原提示词里的原文形象、身份、画风与构图硬要求，并在“稳定形象”后插入“差异化五官：{facial_description}”。若原提示词存在年龄冲突，只保留当前阶段适用年龄。
7. image_prompt 必须明确：单一人物全身立绘、无表情、正面自然站立、双手自然垂于身体两侧、不持道具、头顶至鞋底完整、四周安全白边、纯白背景、严格 3:4、无文字水印、现代都市女频漫画、非写实。
8. character_name 必须原样返回，不得遗漏、重复或改名。

输入：
""" + json.dumps(batch, ensure_ascii=False)
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    last_error = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                body = json.load(response)
            result = parse_json(body["choices"][0]["message"]["content"])
            if not isinstance(result, list) or len(result) != len(batch):
                raise ValueError("batch length mismatch")
            if [item.get("character_name") for item in result] != [item["character_name"] for item in batch]:
                raise ValueError("character order mismatch")
            return result
        except Exception as error:
            last_error = error
            time.sleep(2 ** attempt)
    raise RuntimeError(f"request failed: {last_error}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--api-url", default="https://apitokenzz.xyz/v1/chat/completions")
    parser.add_argument("--model", default="gpt-5.4-mini")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    records = json.loads(Path(args.input).read_text(encoding="utf-8"))
    checkpoint_path = Path(args.checkpoint)
    completed = {}
    if checkpoint_path.exists():
        completed = json.loads(checkpoint_path.read_text(encoding="utf-8"))

    pending = []
    for record in records:
        name = record["character_name"]
        if name in completed:
            continue
        pending.append({
            "character_name": name,
            "stage": record.get("stage"),
            "age": record.get("age"),
            "identity": record.get("identity"),
            "appearance_description": record.get("appearance_description"),
            "temperament": record.get("temperament"),
            "evidence": record.get("evidence"),
            "image_prompt": record.get("image_prompt"),
        })

    batches = [pending[index:index + args.batch_size] for index in range(0, len(pending), args.batch_size)]
    key = api_key()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(request_batch, args.api_url, key, args.model, batch): batch
            for batch in batches
        }
        done = len(completed)
        for future in concurrent.futures.as_completed(futures):
            for item in future.result():
                completed[item["character_name"]] = item
            checkpoint_path.write_text(json.dumps(completed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            done += len(futures[future])
            print(f"processed {done}/{len(records)}", flush=True)

    output = []
    for record in records:
        enriched = completed[record["character_name"]]
        updated = dict(record)
        updated["facial_description"] = str(enriched["facial_description"]).strip()
        updated["image_prompt"] = str(enriched["image_prompt"]).strip()
        output.append(updated)
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(output)} records to {args.output}")


if __name__ == "__main__":
    main()
