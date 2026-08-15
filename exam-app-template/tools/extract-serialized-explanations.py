import ast
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "content" / "exam.json").read_text(encoding="utf-8"))
OUTPUT = ROOT / "content" / "analysis" / "explanation-text-overrides.json"


def flatten(value, label=""):
    parts = []
    if isinstance(value, str):
        text = value.strip()
        if text:
            parts.append(f"{label}: {text}" if label and len(label) <= 8 else text)
    elif isinstance(value, list):
        for item in value:
            parts.extend(flatten(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in {"step_number", "step_no", "step", "is_correct"}:
                continue
            item_label = str(key) if key in {"ア", "イ", "ウ", "エ", "オ", "A", "B", "C", "D"} else ""
            parts.extend(flatten(item, item_label))
    return parts


overrides = {}
failures = []
for subject in CONFIG["subjects"]:
    source_path = ROOT / "content" / "source" / subject["sourceFile"]
    for question in json.loads(source_path.read_text(encoding="utf-8")):
        explanation = question.get("explanation")
        text = explanation.get("text", "") if isinstance(explanation, dict) else str(explanation or "")
        stripped = text.strip()
        if not stripped.startswith(("{", "[")):
            continue
        try:
            parsed = ast.literal_eval(stripped)
        except (SyntaxError, ValueError) as error:
            failures.append(f"{subject['id']}:{question['id']} ({error})")
            continue
        parts = []
        for part in flatten(parsed):
            if part not in parts:
                parts.append(part)
        overrides[f"{subject['id']}:{question['id']}"] = "\n\n".join(parts)

OUTPUT.write_text(json.dumps(overrides, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"extracted={len(overrides)} failures={len(failures)} output={OUTPUT.relative_to(ROOT)}")
for failure in failures:
    print(failure)
