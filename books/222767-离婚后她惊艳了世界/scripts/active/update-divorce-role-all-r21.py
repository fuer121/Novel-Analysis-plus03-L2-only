#!/usr/bin/env python3
import hashlib
import json
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


BOOK_ROOT = Path(__file__).resolve().parents[2]
TASK = BOOK_ROOT / "runs" / "role-all-current" / "outputs"
SOURCE = BOOK_ROOT / "final" / "characters" / "data" / "characters.json"
IMAGES = BOOK_ROOT / "final" / "characters" / "images"
TARGET = BOOK_ROOT / "final" / "exports" / "222767_role_all.md"
TXT_TARGET = BOOK_ROOT / "final" / "exports" / "222767_role_all.txt"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def display_name(item):
    return item["character_name"] if item["stage"] == "常态" else f'{item["character_name"]}-{item["stage"]}'


def main():
    characters = load(SOURCE)
    TASK.mkdir(parents=True, exist_ok=True)
    before = TARGET.read_bytes() if TARGET.exists() else b""
    (TASK / "role-all-before-r21.md").write_bytes(before)

    grouped = OrderedDict()
    for item in characters:
        base = item["base_character"]
        if base not in grouped:
            grouped[base] = {
                "character_name": base,
                "picture": [],
                "aliases": item.get("aliases") or [],
            }
        grouped[base]["picture"].append(f"{display_name(item)}.jpeg")

    role_all = {
        "character_name_list": list(grouped),
        "characters": list(grouped.values()),
    }
    content = json.dumps(role_all, ensure_ascii=False, indent=2) + "\n"
    TARGET.write_text(content, encoding="utf-8")
    TXT_TARGET.write_text(content, encoding="utf-8")

    expected_pictures = [f"{display_name(item)}.jpeg" for item in characters]
    document_pictures = [picture for item in role_all["characters"] for picture in item["picture"]]
    missing_images = [name for name in document_pictures if not (IMAGES / name).exists()]
    duplicate_characters = sorted({name for name in role_all["character_name_list"] if role_all["character_name_list"].count(name) > 1})
    duplicate_pictures = sorted({name for name in document_pictures if document_pictures.count(name) > 1})
    errors = []
    if len(characters) != 279:
        errors.append({"reason": "unexpected_stage_record_count", "actual": len(characters)})
    if len(grouped) != 250:
        errors.append({"reason": "unexpected_base_character_count", "actual": len(grouped)})
    if document_pictures != expected_pictures:
        errors.append({"reason": "picture_order_or_mapping_mismatch"})
    if missing_images:
        errors.append({"reason": "missing_images", "files": missing_images})
    if duplicate_characters or duplicate_pictures:
        errors.append({"reason": "duplicates", "characters": duplicate_characters, "pictures": duplicate_pictures})
    if TARGET.read_bytes() != TXT_TARGET.read_bytes():
        errors.append({"reason": "md_txt_content_mismatch"})

    summary = {
        "completed_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"),
        "book_id": "222767",
        "book_name": "离婚后她惊艳了世界",
        "source": str(SOURCE.relative_to(BOOK_ROOT)),
        "target": str(TARGET.relative_to(BOOK_ROOT)),
        "txt_target": str(TXT_TARGET.relative_to(BOOK_ROOT)),
        "stage_record_count": len(characters),
        "base_character_count": len(grouped),
        "picture_count": len(document_pictures),
        "missing_image_count": len(missing_images),
        "duplicate_character_count": len(duplicate_characters),
        "duplicate_picture_count": len(duplicate_pictures),
        "old_sha256": hashlib.sha256(before).hexdigest() if before else None,
        "new_sha256": sha256(TARGET),
        "txt_sha256": sha256(TXT_TARGET),
        "md_txt_identical": TARGET.read_bytes() == TXT_TARGET.read_bytes(),
        "content_changed": before != TARGET.read_bytes(),
        "error_count": len(errors),
        "status": "completed" if not errors else "failed",
    }
    (TASK / "verification-errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (TASK / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if errors:
        raise RuntimeError("R21 role_all verification failed")


if __name__ == "__main__":
    main()
