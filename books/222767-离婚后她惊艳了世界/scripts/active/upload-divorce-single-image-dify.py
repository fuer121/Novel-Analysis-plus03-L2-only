#!/usr/bin/env python3
import argparse
import getpass
import hashlib
import importlib.util
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


BOOK_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = BOOK_ROOT / "final" / "characters"
TASK = BOOK_ROOT / "archive" / "2026" / "local-records" / "dify-single-image-upload"
SHARED_SCRIPT = BOOK_ROOT / "scripts" / "review" / "upload-divorce-images-dify.py"


def load_shared():
    spec = importlib.util.spec_from_file_location("divorce_dify_upload", SHARED_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://dify.qmniu.com/v1")
    parser.add_argument("--book-id", default="222767")
    parser.add_argument("--image", required=True)
    args = parser.parse_args()

    image = Path(args.image).resolve()
    if not image.is_file() or image.name != "楚锁锁.jpeg":
        raise RuntimeError(f"本次仅允许上传楚锁锁正式图：{image}")
    expected = (ARTIFACT / "images" / "楚锁锁.jpeg").resolve()
    if image != expected:
        raise RuntimeError(f"图片不是正式目录文件：{image}")

    api_key = getpass.getpass("Dify API key: ")
    if not api_key:
        raise RuntimeError("Dify API key 为空")

    shared = load_shared()
    base_url = args.base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}"}
    user = f"codex-book-{args.book_id}-楚锁锁"
    upload = shared.upload_file(base_url, headers, user, image)
    workflow = shared.run_workflow(base_url, headers, user, args.book_id, [upload])

    result = {
        "uploaded_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"),
        "book_id": args.book_id,
        "base_url": base_url,
        "character_name": "楚锁锁",
        "file_name": image.name,
        "file_size": image.stat().st_size,
        "sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
        "upload_file_id": upload["upload_file_id"],
        "workflow_run_id": workflow["workflow_run_id"],
        "task_id": workflow["task_id"],
        "workflow_status": workflow["status"],
        "workflow_outputs": workflow["outputs"],
        "elapsed_time": workflow["elapsed_time"],
        "status": "completed",
    }
    TASK.mkdir(parents=True, exist_ok=True)
    (TASK / "upload-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
