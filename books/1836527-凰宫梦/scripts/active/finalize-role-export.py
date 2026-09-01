import hashlib
import json
from pathlib import Path


BOOK_ROOT = Path(__file__).resolve().parents[2]
BASELINE = BOOK_ROOT / "final" / "characters"
DATA = BASELINE / "data" / "character-information.json"
IMAGES = BASELINE / "images"
EXPORTS = BOOK_ROOT / "final" / "exports"

remove_aliases = {
    "沈知念": {"神秘女眷", "贤妃", "皇贵妃", "皇后"},
    "姜婉歌": {"红衣女子"},
    "周允铮": {"小雪团", "小寿星"},
    "素青": {"素青身影"},
    "余砚之": {"面首"},
    "林修夫人": {"美妇"},
}

rows = json.loads(DATA.read_text())
for row in rows:
    current = [x for x in (row.get("别称") or "").split("、") if x]
    current = [x for x in current if x not in remove_aliases.get(row["角色名称"], set())]
    row["别称"] = "、".join(current) or None

DATA.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")

payload = {
    "character_name_list": [row["角色名称"] for row in rows],
    "characters": [
        {
            "character_name": row["角色名称"],
            "picture": [row["图片文件名"]] if row.get("图片文件名") else [],
            "aliases": [x for x in (row.get("别称") or "").split("、") if x],
        }
        for row in rows
    ],
}
EXPORTS.mkdir(parents=True, exist_ok=True)
(EXPORTS / "1836527_role_all.txt").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
)

validation = {
    "role_count": len(rows),
    "image_count": len(list(IMAGES.glob("*.png"))),
    "unique_role_names": len({row["角色名称"] for row in rows}),
    "unique_picture_names": len({row["图片文件名"] for row in rows}),
    "missing_pictures": [row["图片文件名"] for row in rows if not (IMAGES / row["图片文件名"]).exists()],
    "all_checks_passed": True,
}
validation["all_checks_passed"] = all([
    validation["role_count"] == validation["image_count"],
    validation["role_count"] == validation["unique_role_names"],
    validation["role_count"] == validation["unique_picture_names"],
    not validation["missing_pictures"],
])
(BASELINE / "evidence" / "validation.json").write_text(
    json.dumps(validation, ensure_ascii=False, indent=2) + "\n"
)

summary = json.loads((BASELINE / "baseline-summary.json").read_text())
summary.update({"record_count": len(rows), "image_count": validation["image_count"], "updated_at": "2026-08-14"})
(BASELINE / "baseline-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")

print(json.dumps(validation, ensure_ascii=False))
