import json
import os
import subprocess
import time
from pathlib import Path


BOOK_ROOT = Path(__file__).resolve().parents[2]
IMAGE_DIR = BOOK_ROOT / "final" / "characters" / "images"
MANIFEST = BOOK_ROOT / "final" / "exports" / "dify-upload.local.json"
BASE_URL = os.environ["DIFY_BASE_URL"].rstrip("/")
API_KEY = os.environ["DIFY_API_KEY"]
BOOK_ID = os.environ.get("BOOK_ID", "1836527")
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def load_manifest():
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"book_id": BOOK_ID, "base_url": BASE_URL, "results": {}}


def save_manifest(data):
    data["summary"] = {
        "total": len(list(IMAGE_DIR.glob("*.png"))),
        "succeeded": sum(x.get("status") == "succeeded" for x in data["results"].values()),
        "failed": sum(x.get("status") == "failed" for x in data["results"].values()),
    }
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def upload_one(path):
    upload_raw = subprocess.run(
        [
            "curl", "-sS", "--fail-with-body", "--max-time", "120",
            "-X", "POST", f"{BASE_URL}/files/upload",
            "-H", f"Authorization: Bearer {API_KEY}",
            "-F", f"file=@{path}", "-F", f"user={BOOK_ID}",
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    upload = json.loads(upload_raw)
    file_id = upload["id"]
    payload = {
        "inputs": {
            "book_id": BOOK_ID,
            "image_files": [{
                "transfer_method": "local_file",
                "upload_file_id": file_id,
                "type": "image",
            }],
        },
        "response_mode": "blocking",
        "user": BOOK_ID,
    }
    result_raw = subprocess.run(
        [
            "curl", "-sS", "--fail-with-body", "--max-time", "300",
            "-X", "POST", f"{BASE_URL}/workflows/run",
            "-H", f"Authorization: Bearer {API_KEY}",
            "-H", "Content-Type: application/json",
            "--data-binary", json.dumps(payload, ensure_ascii=False),
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    result = json.loads(result_raw)
    data = result.get("data") or {}
    if data.get("status") != "succeeded":
        raise RuntimeError(data.get("error") or result.get("message") or "workflow failed")
    outputs = data.get("outputs") or {}
    output_json = outputs.get("json") or []
    detail = output_json[0] if output_json else {}
    if detail.get("failed_count", detail.get("error_count", 0)):
        raise RuntimeError(outputs.get("body") or "remote upload failed")
    return {
        "status": "succeeded",
        "file_id": file_id,
        "workflow_run_id": result.get("workflow_run_id") or data.get("id"),
        "output": detail,
    }


manifest = load_manifest()
paths = sorted(IMAGE_DIR.glob("*.png"), key=lambda path: path.name)
for index, path in enumerate(paths, 1):
    previous = manifest["results"].get(path.name)
    if previous and previous.get("status") == "succeeded":
        print(f"[{index}/{len(paths)}] skip {path.name}", flush=True)
        continue
    last_error = None
    for attempt in range(1, 4):
        try:
            result = upload_one(path)
            manifest["results"][path.name] = result
            save_manifest(manifest)
            print(f"[{index}/{len(paths)}] ok {path.name}", flush=True)
            last_error = None
            break
        except Exception as exc:
            last_error = str(exc)
            print(f"[{index}/{len(paths)}] retry {attempt}/3 {path.name}: {last_error}", flush=True)
            time.sleep(attempt * 2)
    if last_error is not None:
        manifest["results"][path.name] = {"status": "failed", "error": last_error}
        save_manifest(manifest)

save_manifest(manifest)
print(json.dumps(manifest["summary"], ensure_ascii=False), flush=True)
