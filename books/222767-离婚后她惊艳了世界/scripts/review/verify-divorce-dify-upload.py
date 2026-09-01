#!/usr/bin/env python3
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "artifacts" / "离婚后她惊艳了世界角色形象"
TASK = ARTIFACT / "audits" / "task-22"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    characters = load(ARTIFACT / "characters.json")
    progress = load(TASK / "upload-progress.json")
    expected = [
        f'{row["character_name"] if row["stage"] == "常态" else row["character_name"] + "-" + row["stage"]}.jpeg'
        for row in characters
    ]
    batches = sorted(progress["batches"], key=lambda row: row["batch_index"])
    actual = [row["files"][0]["name"] for row in batches if row.get("status") == "succeeded" and len(row.get("files", [])) == 1]
    file_ids = [row["files"][0]["upload_file_id"] for row in batches if row.get("status") == "succeeded" and len(row.get("files", [])) == 1]
    workflow_ids = [row.get("workflow", {}).get("workflow_run_id") for row in batches]
    errors = []
    if len(batches) != 280:
        errors.append({"reason": "unexpected_batch_count", "actual": len(batches)})
    if any(row.get("status") != "succeeded" for row in batches):
        errors.append({"reason": "failed_batches", "indexes": [row["batch_index"] for row in batches if row.get("status") != "succeeded"]})
    if actual != expected:
        errors.append({"reason": "file_order_or_set_mismatch"})
    if len(file_ids) != 280 or len(set(file_ids)) != 280 or any(not value for value in file_ids):
        errors.append({"reason": "invalid_upload_file_ids"})
    if len(workflow_ids) != 280 or len(set(workflow_ids)) != 280 or any(not value for value in workflow_ids):
        errors.append({"reason": "invalid_workflow_run_ids"})
    if any(row.get("workflow", {}).get("status") != "succeeded" for row in batches):
        errors.append({"reason": "workflow_status_not_succeeded"})

    summary = {
        "completed_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"),
        "book_id": progress["book_id"],
        "base_url": progress["base_url"],
        "expected_image_count": len(expected),
        "successful_upload_count": len(actual),
        "successful_workflow_count": sum(row.get("workflow", {}).get("status") == "succeeded" for row in batches),
        "unique_upload_file_id_count": len(set(file_ids)),
        "unique_workflow_run_id_count": len(set(workflow_ids)),
        "order_matches_character_list": actual == expected,
        "failed_count": sum(row.get("status") != "succeeded" for row in batches),
        "error_count": len(errors),
        "status": "completed" if not errors else "failed",
    }
    (TASK / "verification-errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (TASK / "final-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if errors:
        raise RuntimeError("Dify upload verification failed")


if __name__ == "__main__":
    main()
