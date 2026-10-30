from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent.parent
EXAM_BUNDLES_DIR = BASE_DIR / "secondary_exam_dataset" / "exam_bundles"

TEXT_FIELDS = {
    "answer_example_text",
    "模範解答",
}

LIST_TEXT_FIELDS: set[str] = set()


def normalize_ocr_text(value: str) -> str:
    cleaned_lines: list[str] = []
    blank_pending = False
    for raw_line in value.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        compact = re.sub(r"\s+", "", line)
        if not compact:
            if not blank_pending:
                cleaned_lines.append("")
                blank_pending = True
            continue
        if re.fullmatch(r"[\-－]?\d+[\-－]?", compact):
            continue
        if re.fullmatch(r"事例[ⅠⅡⅢⅣ1-4]+", compact):
            continue
        if re.fullmatch(r"(事|例|[ⅠⅡⅢⅣ])", compact):
            continue
        line = re.sub(
            r"([一-龠ぁ-んァ-ヶー々〇Ａ-Ｚａ-ｚ０-９ⅠⅡⅢⅣ])\s+(?=[一-龠ぁ-んァ-ヶー々〇Ａ-Ｚａ-ｚ０-９ⅠⅡⅢⅣ])",
            r"\1",
            line,
        )
        line = re.sub(r"\s+([、。）」』】％])", r"\1", line)
        line = re.sub(r"([（「『【])\s+", r"\1", line)
        line = re.sub(r"\s{2,}", " ", line).strip()
        cleaned_lines.append(line)
        blank_pending = False

    text = "\n".join(cleaned_lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def should_normalize_text_field(key: str, value: str) -> bool:
    if key not in TEXT_FIELDS:
        return False
    stripped = value.strip()
    if not stripped:
        return False
    if len(stripped) > 400:
        return False
    if "\n\n" in stripped:
        return False
    return True


def should_normalize_list_item(key: str, value: str) -> bool:
    if key not in LIST_TEXT_FIELDS:
        return False
    stripped = value.strip()
    if not stripped:
        return False
    return len(stripped) <= 300


def normalize_node(node: Any) -> Any:
    if isinstance(node, dict):
        normalized: dict[str, Any] = {}
        for key, value in node.items():
            if isinstance(value, str) and should_normalize_text_field(key, value):
                normalized[key] = normalize_ocr_text(value)
            elif key in LIST_TEXT_FIELDS and isinstance(value, list):
                normalized[key] = [
                    normalize_ocr_text(item)
                    if isinstance(item, str) and should_normalize_list_item(key, item)
                    else normalize_node(item)
                    for item in value
                ]
            else:
                normalized[key] = normalize_node(value)
        return normalized
    if isinstance(node, list):
        return [normalize_node(item) for item in node]
    return node


def main() -> None:
    updated_files = 0
    for bundle_path in sorted(EXAM_BUNDLES_DIR.glob("case*/*.json")):
        payload = json.loads(bundle_path.read_text(encoding="utf-8"))
        normalized = normalize_node(payload)
        rendered = json.dumps(normalized, ensure_ascii=False, indent=2) + "\n"
        current = bundle_path.read_text(encoding="utf-8")
        if rendered != current:
            bundle_path.write_text(rendered, encoding="utf-8")
            updated_files += 1

    print(f"normalized {updated_files} bundle files")


if __name__ == "__main__":
    main()
