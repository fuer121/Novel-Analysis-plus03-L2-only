#!/usr/bin/env python3
import argparse
import getpass
import json
import mimetypes
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "artifacts" / "离婚后她惊艳了世界角色形象"
IMAGES = ARTIFACT / "images"
TASK = ARTIFACT / "audits" / "task-22"
PROGRESS = TASK / "upload-progress.json"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(value):
    TASK.mkdir(parents=True, exist_ok=True)
    PROGRESS.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ordered_images():
    records = load(ARTIFACT / "characters.json")
    result = []
    for row in records:
        display = row["character_name"] if row["stage"] == "常态" else f'{row["character_name"]}-{row["stage"]}'
        path = IMAGES / f"{display}.jpeg"
        if not path.exists():
            raise RuntimeError(f"缺少正式角色图：{path.name}")
        result.append(path)
    if len(result) != 280 or len(set(result)) != 280:
        raise RuntimeError(f"正式角色图顺序异常：{len(result)}")
    return result


def request_with_retry(method, url, *, headers=None, body=None, retries=3):
    error = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
            with urllib.request.urlopen(request, timeout=600) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
            error = RuntimeError(f"HTTP {exc.code}: {detail}")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            error = exc
        if attempt < retries:
            time.sleep(attempt * 3)
    raise error


def upload_file(base_url, headers, user, path):
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    boundary = f"----CodexDify{uuid.uuid4().hex}"
    body = bytearray()
    body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"user\"\r\n\r\n{user}\r\n".encode())
    body.extend(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n".encode()
    )
    body.extend(path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    raw = request_with_retry(
        "POST",
        f"{base_url}/files/upload",
        headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        body=bytes(body),
    )
    payload = json.loads(raw)
    file_id = payload.get("id")
    if not file_id:
        raise RuntimeError(f"上传响应缺少文件 ID：{path.name}")
    return {"name": path.name, "upload_file_id": file_id, "size": path.stat().st_size}


def run_workflow(base_url, headers, user, book_id, uploads):
    files = [
        {"type": "image", "transfer_method": "local_file", "upload_file_id": row["upload_file_id"]}
        for row in uploads
    ]
    body = json.dumps({
        "inputs": {"book_id": book_id, "image_files": files},
        "response_mode": "blocking",
        "user": user,
    }, ensure_ascii=False).encode("utf-8")
    raw = request_with_retry(
        "POST",
        f"{base_url}/workflows/run",
        headers={**headers, "Content-Type": "application/json"},
        body=body,
    )
    payload = json.loads(raw)
    data = payload.get("data") or {}
    status = data.get("status")
    if status not in {"succeeded", "success"}:
        raise RuntimeError(f"workflow 未成功：{json.dumps(payload, ensure_ascii=False)[:1200]}")
    return {
        "workflow_run_id": payload.get("workflow_run_id") or data.get("id"),
        "task_id": payload.get("task_id"),
        "status": status,
        "outputs": data.get("outputs"),
        "elapsed_time": data.get("elapsed_time"),
        "total_tokens": data.get("total_tokens"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://dify.qmniu.com/v1")
    parser.add_argument("--book-id", default="222767")
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 10:
        raise RuntimeError("batch-size 必须为 1-10")

    api_key = getpass.getpass("Dify API key: ")
    if not api_key:
        raise RuntimeError("Dify API key 为空")
    base_url = args.base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}"}
    user = f"codex-book-{args.book_id}"
    images = ordered_images()
    batches = [images[index:index + args.batch_size] for index in range(0, len(images), args.batch_size)]

    progress = load(PROGRESS) if PROGRESS.exists() else None
    if progress and (
        progress.get("book_id") != args.book_id
        or progress.get("base_url") != base_url
        or progress.get("batch_size") != args.batch_size
        or progress.get("total_images") != len(images)
    ):
        archive = TASK / f'upload-progress-batch-{progress.get("batch_size", "unknown")}-failed.json'
        archive.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        progress = None
    progress = progress or {
        "book_id": args.book_id,
        "base_url": base_url,
        "batch_size": args.batch_size,
        "total_images": len(images),
        "total_batches": len(batches),
        "batches": [],
    }
    completed = {row["batch_index"] for row in progress["batches"] if row.get("status") == "succeeded"}

    for batch_index, paths in enumerate(batches, 1):
        if batch_index in completed:
            print(f"{batch_index}/{len(batches)} skipped", flush=True)
            continue
        uploads = []
        try:
            for path in paths:
                uploads.append(upload_file(base_url, headers, user, path))
            workflow = run_workflow(base_url, headers, user, args.book_id, uploads)
            entry = {
                "batch_index": batch_index,
                "status": "succeeded",
                "files": uploads,
                "workflow": workflow,
            }
        except Exception as exc:
            entry = {
                "batch_index": batch_index,
                "status": "failed",
                "files": uploads,
                "expected_files": [path.name for path in paths],
                "error": str(exc)[:2000],
            }
        progress["batches"] = [row for row in progress["batches"] if row["batch_index"] != batch_index]
        progress["batches"].append(entry)
        progress["batches"].sort(key=lambda row: row["batch_index"])
        progress["succeeded_batches"] = sum(row["status"] == "succeeded" for row in progress["batches"])
        progress["succeeded_images"] = sum(len(row.get("files", [])) for row in progress["batches"] if row["status"] == "succeeded")
        save(progress)
        print(f"{batch_index}/{len(batches)} {entry['status']} files={len(uploads)}", flush=True)
        if entry["status"] == "failed":
            raise RuntimeError(entry["error"])


if __name__ == "__main__":
    main()
