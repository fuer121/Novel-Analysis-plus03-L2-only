#!/usr/bin/env python3
import argparse
import concurrent.futures
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

BOOK_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = BOOK_ROOT / "final" / "characters"
GATEWAY = Path("/Users/staff/.codex/skills/gpt-image-2-gateway/scripts/image_gateway.py")
LOCK = threading.Lock()


def safe_name(value):
    value = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", value)
    return re.sub(r"\s+", "_", value).strip("._ ")[:80]


def load_manifest(path):
    if not path.exists():
        return {"version": 1, "entries": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(path, manifest):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def dimensions(path):
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    width = int(re.search(r"pixelWidth: (\d+)", result).group(1))
    height = int(re.search(r"pixelHeight: (\d+)", result).group(1))
    return width, height


def normalize_3x4(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="divorce-image-") as temp_dir:
        scaled = Path(temp_dir) / "scaled.png"
        subprocess.run(
            ["sips", "--resampleHeight", "1420", str(source), "--out", str(scaled)],
            capture_output=True, text=True, check=True,
        )
        subprocess.run(
            ["sips", "--padToHeightWidth", "1536", "1152", "--padColor", "FFFFFF", str(scaled), "--out", str(destination)],
            capture_output=True, text=True, check=True,
        )
    if dimensions(destination) != (1152, 1536):
        raise RuntimeError("normalized image is not 1152x1536")


def generate(task, retries):
    destination = Path(task["destination"])
    if destination.exists() and dimensions(destination) == (1152, 1536):
        return {**task, "status": "skipped", "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}
    error = None
    for attempt in range(1, retries + 1):
        try:
            with tempfile.TemporaryDirectory(prefix="divorce-gateway-") as temp_dir:
                result = subprocess.run([
                    "python3", str(GATEWAY), "generate",
                    "--base-url", "https://apitokenzz.xyz/v1",
                    "--model", "gpt-image-2",
                    "--size", "1024x1536",
                    "--quality", "medium",
                    "--output-format", "jpeg",
                    "--timeout", "300",
                    "--n", "1",
                    "--prompt", task["prompt"],
                    "--output", temp_dir,
                ], capture_output=True, text=True, check=False)
                if result.returncode:
                    raise RuntimeError((result.stderr or result.stdout)[-800:])
                payload = json.loads(result.stdout)
                source = Path(payload["images"][0]["path"])
                normalize_3x4(source, destination)
            return {
                **task,
                "status": "completed",
                "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            }
        except Exception as exc:
            error = str(exc)
            time.sleep(attempt * 3)
    return {**task, "status": "failed", "error": error[-1000:] if error else "unknown error"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()

    records = json.loads((ARTIFACTS / "data" / "characters.json").read_text(encoding="utf-8"))
    images_dir = ARTIFACTS / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = BOOK_ROOT / "runs" / "image-generation-current" / "outputs" / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)

    completed_names = {"苏婳", "顾北弦"}
    tasks = []
    for index, record in enumerate(records, 1):
        if record["character_name"] in completed_names:
            continue
        destination = images_dir / f"{safe_name(record['character_name'])}.jpeg"
        previous = manifest["entries"].get(record["character_name"], {})
        if previous.get("status") in {"completed", "skipped"} and destination.exists():
            continue
        prompt = record["image_prompt"]
        if args.compact:
            prompt = (
                f"{record['character_name']}，年龄：{record.get('age', '原文未明确')}。"
                f"稳定形象：{record.get('appearance_description', '')}。"
                f"差异化五官：{record.get('facial_description', '')}。"
                f"气质：{record.get('temperament', '')}。"
                "现代都市女频漫画风，精致二维国漫或轻半厚涂，非写实、非照片感。"
                "单一人物完整全身立绘，无表情，正面自然站立，双手自然垂于身体两侧，"
                "不持道具，头顶到鞋底完整可见，四周安全白边，纯白背景，严格3:4，"
                "无文字、水印、边框、场景、家具或光效。"
            )
        tasks.append({
            "index": index,
            "character_name": record["character_name"],
            "prompt": prompt,
            "destination": str(destination),
        })
    if args.limit:
        tasks = tasks[:args.limit]

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(generate, task, args.retries) for task in tasks]
        finished = 0
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            with LOCK:
                manifest["entries"][result["character_name"]] = result
                save_manifest(manifest_path, manifest)
            finished += 1
            print(f"{finished}/{len(tasks)} {result['status']} {result['character_name']}", flush=True)

    statuses = {}
    for entry in manifest["entries"].values():
        statuses[entry.get("status", "unknown")] = statuses.get(entry.get("status", "unknown"), 0) + 1
    print(json.dumps({"scheduled": len(tasks), "statuses": statuses}, ensure_ascii=False))


if __name__ == "__main__":
    main()
