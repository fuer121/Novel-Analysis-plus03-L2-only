#!/usr/bin/env python3
"""Generate character images from characters.json through the GPT Image 2 gateway."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
BOOK_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_INPUT = BOOK_ROOT / "final" / "characters" / "data" / "characters.json"
DEFAULT_IMAGES_DIR = BOOK_ROOT / "final" / "characters" / "images"
DEFAULT_MANIFEST = BOOK_ROOT / "runs" / "image-generation-current.local.json"
GATEWAY_SCRIPT = Path(
    "/Users/staff/.codex/skills/gpt-image-2-gateway/scripts/image_gateway.py"
)
BASE_URL = "https://apitokenzz.xyz/v1"
MODEL = "gpt-image-2"
SIZE = "1024x1536"

NAME_KEYS = ("角色名称", "character_name", "name", "entity")
PROMPT_KEYS = (
    "用于gpt-image2生图的提示词",
    "用于GPT Image 2生图的提示词",
    "生图提示词",
    "image_prompt",
    "prompt",
)
QA_FIELDS = ("qa_age_consistency", "qa_temperament_consistency")
QA_PASS_VALUES = {
    "1",
    "true",
    "pass",
    "passed",
    "ok",
    "通过",
    "一致",
    "已通过",
    "无冲突",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch-generate character PNGs from characters.json"
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--images-dir", type=Path, default=DEFAULT_IMAGES_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--base-url", default=BASE_URL)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Regenerate and replace an existing PNG instead of skipping it",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=1,
        help="First 1-based character index to process (inclusive)",
    )
    parser.add_argument(
        "--end",
        type=int,
        help="Last 1-based character index to process (inclusive; default: all)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Maximum attempts per character (default: 3)",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=5.0,
        help="Seconds before the first retry; later retries use linear backoff",
    )
    return parser.parse_args()


def load_characters(path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"Input file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc

    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = next(
            (
                payload[key]
                for key in ("characters", "rows", "records", "data")
                if isinstance(payload.get(key), list)
            ),
            None,
        )
        if rows is None:
            raise SystemExit(
                "characters.json must be an array or contain a characters/rows/records/data array"
            )
    else:
        raise SystemExit("characters.json must contain a JSON array or object")

    if not all(isinstance(row, dict) for row in rows):
        raise SystemExit("Every character entry must be a JSON object")
    return rows


def get_text(row: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", value.strip())
    cleaned = re.sub(r"\s+", "_", cleaned)
    cleaned = re.sub(r"_+", "_", cleaned).strip("._ ")
    return cleaned[:80] or fallback


def qa_passed(value: Any) -> bool:
    if value is True or value == 1:
        return True
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized in QA_PASS_VALUES or normalized.startswith(("通过：", "通过:"))
    return False


def qa_failure_reason(row: dict[str, Any]) -> str:
    failures = []
    for field in QA_FIELDS:
        value = row.get(field)
        if not qa_passed(value):
            shown = "missing" if value is None else str(value).strip() or "empty"
            failures.append(f"{field}={shown}")
    return "; ".join(failures)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "version": 1,
            "input": str(DEFAULT_INPUT),
            "model": MODEL,
            "size": SIZE,
            "updated_at": utc_now(),
            "characters": [],
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid existing manifest: {path}: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("characters"), list):
        raise SystemExit(f"Invalid existing manifest structure: {path}")
    return data


def save_manifest(path: Path, manifest: dict[str, Any]) -> None:
    manifest["updated_at"] = utc_now()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def update_manifest(
    manifest: dict[str, Any], index: int, entry: dict[str, Any]
) -> None:
    entries = manifest["characters"]
    for position, current in enumerate(entries):
        if current.get("index") == index:
            entries[position] = entry
            break
    else:
        entries.append(entry)
    entries.sort(key=lambda item: item.get("index", 0))


def gateway_command(prompt: str, output_dir: Path, base_url: str) -> list[str]:
    return [
        sys.executable,
        str(GATEWAY_SCRIPT),
        "generate",
        "--base-url",
        base_url,
        "--model",
        MODEL,
        "--size",
        SIZE,
        "--output-format",
        "png",
        "--n",
        "1",
        "--prompt",
        prompt,
        "--output",
        str(output_dir),
    ]


def parse_gateway_output(stdout: str) -> Path:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Image gateway returned non-JSON output") from exc
    images = payload.get("images")
    if not isinstance(images, list) or not images:
        raise RuntimeError("Image gateway returned no images")
    path = images[0].get("path")
    if not isinstance(path, str) or not path:
        raise RuntimeError("Image gateway did not return a downloaded image path")
    result = Path(path)
    if not result.is_file():
        raise RuntimeError("Image gateway output file is missing")
    return result


def is_png(path: Path) -> bool:
    with path.open("rb") as stream:
        return stream.read(8) == b"\x89PNG\r\n\x1a\n"


def place_png(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp.png")
    if is_png(source):
        shutil.copyfile(source, temporary)
    else:
        converter = shutil.which("sips")
        if not converter:
            raise RuntimeError("Gateway result was not PNG and the sips converter is unavailable")
        result = subprocess.run(
            [converter, "-s", "format", "png", str(source), "--out", str(temporary)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0 or not temporary.exists() or not is_png(temporary):
            raise RuntimeError("Failed to convert gateway result to PNG")
    temporary.replace(destination)


def sanitized_error(stderr: str, stdout: str, returncode: int) -> str:
    message = (stderr or stdout or f"gateway exited with status {returncode}").strip()
    api_key = os.environ.get("APITOKENZZ_API_KEY", "")
    if api_key:
        message = message.replace(api_key, "[REDACTED]")
    message = re.sub(r"Bearer\s+\S+", "Bearer [REDACTED]", message, flags=re.I)
    return message[:1000]


def main() -> int:
    args = parse_args()
    if args.start < 1:
        raise SystemExit("--start must be at least 1")
    if args.end is not None and args.end < args.start:
        raise SystemExit("--end must be greater than or equal to --start")
    if args.retries < 1:
        raise SystemExit("--retries must be at least 1")
    if not (
        os.environ.get("APITOKENZZ_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    ):
        raise SystemExit("APITOKENZZ_API_KEY or OPENAI_API_KEY is not set")
    if not GATEWAY_SCRIPT.is_file():
        raise SystemExit(f"Image gateway script not found: {GATEWAY_SCRIPT}")

    input_path = args.input.expanduser().resolve()
    characters = load_characters(input_path)
    end = min(args.end or len(characters), len(characters))
    selected = list(enumerate(characters[args.start - 1 : end], start=args.start))

    images_dir = args.images_dir.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    images_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)
    manifest["input"] = str(input_path)
    manifest["model"] = MODEL
    manifest["size"] = SIZE
    manifest["total_characters"] = len(characters)
    save_manifest(manifest_path, manifest)

    succeeded = skipped = failed = 0
    total = len(selected)
    print(
        f"Processing {total} character(s), source indices {args.start}-{end}, "
        f"output={images_dir}",
        flush=True,
    )

    for progress, (index, row) in enumerate(selected, start=1):
        name = get_text(row, NAME_KEYS) or f"角色{index}"
        prompt = get_text(row, PROMPT_KEYS)
        filename = f"{index:03d}_{safe_name(name, f'character_{index}')}.png"
        output_path = images_dir / filename
        prefix = f"[{progress}/{total}] #{index} {name}"

        base_entry = {
            "index": index,
            "name": name,
            "filename": filename,
            "image_path": str(output_path),
            "updated_at": utc_now(),
        }

        qa_error = qa_failure_reason(row)
        if qa_error:
            skipped += 1
            entry = {
                **base_entry,
                "status": "skipped_qa",
                "attempts": 0,
                "qa": {field: row.get(field) for field in QA_FIELDS},
                "reason": qa_error,
            }
            update_manifest(manifest, index, entry)
            save_manifest(manifest_path, manifest)
            print(f"{prefix}: skipped QA ({qa_error})", flush=True)
            continue

        if not args.overwrite and output_path.is_file() and is_png(output_path):
            skipped += 1
            entry = {**base_entry, "status": "skipped_existing", "attempts": 0}
            update_manifest(manifest, index, entry)
            save_manifest(manifest_path, manifest)
            print(f"{prefix}: skipped (existing PNG)", flush=True)
            continue

        if not prompt:
            failed += 1
            entry = {
                **base_entry,
                "status": "failed",
                "attempts": 0,
                "error": f"Missing prompt; expected one of: {', '.join(PROMPT_KEYS)}",
            }
            update_manifest(manifest, index, entry)
            save_manifest(manifest_path, manifest)
            print(f"{prefix}: failed (missing image prompt)", flush=True)
            continue

        last_error = ""
        completed = False
        for attempt in range(1, args.retries + 1):
            print(f"{prefix}: generating (attempt {attempt}/{args.retries})", flush=True)
            with tempfile.TemporaryDirectory(
                prefix=f"character-{index:03d}-", dir=images_dir
            ) as temporary_dir:
                result = subprocess.run(
                    gateway_command(prompt, Path(temporary_dir), args.base_url),
                    capture_output=True,
                    text=True,
                    check=False,
                )
                try:
                    if result.returncode != 0:
                        raise RuntimeError(
                            sanitized_error(result.stderr, result.stdout, result.returncode)
                        )
                    generated = parse_gateway_output(result.stdout)
                    place_png(generated, output_path)
                except (OSError, RuntimeError) as exc:
                    last_error = str(exc)
                else:
                    succeeded += 1
                    completed = True
                    entry = {
                        **base_entry,
                        "status": "generated",
                        "attempts": attempt,
                        "updated_at": utc_now(),
                    }
                    update_manifest(manifest, index, entry)
                    save_manifest(manifest_path, manifest)
                    print(f"{prefix}: generated -> {filename}", flush=True)
                    break

            if attempt < args.retries:
                delay = args.retry_delay * attempt
                print(f"{prefix}: retrying in {delay:g}s", flush=True)
                time.sleep(delay)

        if not completed:
            failed += 1
            entry = {
                **base_entry,
                "status": "failed",
                "attempts": args.retries,
                "error": last_error[:1000],
                "updated_at": utc_now(),
            }
            update_manifest(manifest, index, entry)
            save_manifest(manifest_path, manifest)
            print(f"{prefix}: failed ({last_error})", flush=True)

    print(
        f"Done: generated={succeeded}, skipped={skipped}, failed={failed}; "
        f"manifest={manifest_path}",
        flush=True,
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
