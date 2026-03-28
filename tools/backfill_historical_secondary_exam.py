import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from build_secondary_exam_dataset import (
    HISTORICAL_BACKFILL_DIR,
    OUTPUT_ROOT,
    ai_clean_text,
    build_alignment_summary,
    case_pdf_path,
    clean_pdf_text,
    extract_pdf_text_string,
    normalize_question_units,
    write_json,
)


LATEST_MODEL_ALIAS = "gemini-flash-latest"
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
REQUEST_TIMEOUT_SECONDS = 600
MAX_RETRIES = 8
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def load_env_local() -> None:
    env_path = Path(".env.local")
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def api_key() -> str:
    load_env_local()
    key = os.getenv("GOOGLE_API_KEY")
    if not key:
        raise SystemExit("GOOGLE_API_KEY is not configured.")
    return key


def generate_json(prompt: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.post(
                f"{API_BASE}/{LATEST_MODEL_ALIAS}:generateContent",
                params={"key": api_key()},
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.2,
                        "responseMimeType": "application/json",
                    },
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            if response.status_code in RETRYABLE_STATUS_CODES:
                retry_after = response.headers.get("Retry-After")
                wait_seconds = int(retry_after) if retry_after and retry_after.isdigit() else min(300, 20 * attempt)
                print(f"Retryable status {response.status_code}. Waiting {wait_seconds}s before retry {attempt}/{MAX_RETRIES}.", flush=True)
                time.sleep(wait_seconds)
                continue
            response.raise_for_status()
            payload = response.json()
            candidates = payload.get("candidates") or []
            if not candidates:
                raise ValueError("No candidates returned from Gemini.")
            parts = ((candidates[0].get("content") or {}).get("parts") or [])
            text = "".join(str(part.get("text") or "") for part in parts if isinstance(part, dict))
            return extract_json_object(text)
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as exc:
            last_error = exc
            wait_seconds = min(300, 30 * attempt)
            print(f"Request timeout/network error. Waiting {wait_seconds}s before retry {attempt}/{MAX_RETRIES}.", flush=True)
            time.sleep(wait_seconds)
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            wait_seconds = min(180, 15 * attempt)
            print(f"Malformed JSON response. Waiting {wait_seconds}s before retry {attempt}/{MAX_RETRIES}.", flush=True)
            time.sleep(wait_seconds)
        except Exception as exc:
            last_error = exc
            raise
    raise RuntimeError(f"Gemini request failed after retries: {last_error}")


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def source_document_text(case_no: int, year_label: str) -> str:
    gregorian = 2018 + int(year_label[1:]) if year_label.startswith("R") else 1988 + int(year_label[1:])
    source_json = OUTPUT_ROOT / "source_documents" / "二次_過去問PDF" / f"case{case_no}_{gregorian}.json"
    if source_json.exists():
        payload = json.loads(source_json.read_text(encoding="utf-8"))
        return str(payload.get("text") or "")
    pdf_path = case_pdf_path(case_no, year_label)
    if not pdf_path:
        raise FileNotFoundError(f"PDF not found for {year_label} case{case_no}")
    return extract_pdf_text_string(Path(pdf_path))


def extract_passage_text(source_text: str) -> str:
    normalized = source_text or ""
    match = re.search(r"第\s*[1１]\s*問", normalized)
    if match:
        return normalized[:match.start()].strip()
    return normalized.strip()


def load_reference_examples(case_no: int) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    for year_label in ["H30", "R01", "R07"]:
        bundle_path = OUTPUT_ROOT / "exam_bundles" / f"case{case_no}" / f"{year_label}.json"
        if not bundle_path.exists():
            continue
        payload = json.loads(bundle_path.read_text(encoding="utf-8"))
        references.append(
            {
                "year_label": payload.get("year_label"),
                "questions": (payload.get("questions") or [])[:2],
                "question_units": (payload.get("question_units") or [])[:3],
                "rubrics": (payload.get("rubrics") or [])[:2],
                "explanations": (payload.get("explanations") or [])[:1],
                "calculation_breakdowns": (payload.get("calculation_breakdowns") or [])[:1],
            }
        )
    return references


def extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("{"):
        return json.loads(raw)
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return json.loads(raw[start:end + 1])
    raise ValueError("No JSON object found.")


def first_pass_prompt(case_no: int, year_label: str, source_text: str, references: list[dict[str, Any]]) -> str:
    return f"""
あなたは中小企業診断士二次試験データセット整備の担当者です。
対象は {year_label} の事例{case_no} です。元データ本文から、採点用bundleに必要な構造を生成してください。

# 絶対ルール
- 事実の根拠は元本文のみとし、本文にない固有名詞や条件は作らない。
- rubric / explanation は本文と設問要求から導ける範囲の採点補助要点にとどめる。
- 参照例は H30〜R07 の後年データであり、形式の参考にだけ使う。
- 出力は必ず JSON オブジェクト 1 つのみ。
- 各 question には question_no, max_score, char_limit, prompt_text を必ず入れる。
- question_units は subquestion が無ければ question と同内容でもよい。
- rubrics の source_type は `ai_historical_backfill` とする。
- explanations の source_type は `ai_historical_backfill` とする。
- 事例4では calculation_breakdowns をできるだけ埋める。

# 参照形式サンプル
{json.dumps(references[:2], ensure_ascii=False)}

# 元本文
{source_text}

# 出力JSONスキーマ
{{
  "questions": [
    {{
      "question_no": 1,
      "max_score": 25,
      "char_limit": 100,
      "prompt_text": "string"
    }}
  ],
  "question_units": [
    {{
      "parent_question_no": 1,
      "subquestion_no": null,
      "max_score": 25,
      "char_limit": 100,
      "prompt_text": "string"
    }}
  ],
  "rubrics": [
    {{
      "rubric_index": 1,
      "question_no": 1,
      "title": null,
      "source_type": "ai_historical_backfill",
      "checklist_items": ["string"]
    }}
  ],
  "explanations": [
    {{
      "question_no": 1,
      "source_type": "ai_historical_backfill",
      "positioning_text": "string",
      "solution_text": "string",
      "answer_example_text": "string",
      "difficulty_text": "string"
    }}
  ],
  "calculation_breakdowns": []
}}
"""


def second_pass_prompt(case_no: int, year_label: str, source_text: str, draft: dict[str, Any]) -> str:
    return f"""
あなたは中小企業診断士二次試験のデータ監査担当です。
対象は {year_label} の事例{case_no} です。
次の draft JSON が元本文と整合しているかをチェックし、誤りや抜けを修正してください。

# 監査ルール
- question の数、設問番号、字数制限、配点、設問文は元本文と合うように修正する。
- rubric / explanation は本文・設問要求に照らして、言い過ぎや本文外推測を削る。
- JSONのキー構造は維持する。
- 出力は必ず修正後JSONのみ。

# 元本文
{source_text}

# draft JSON
{json.dumps(draft, ensure_ascii=False)}
"""


def coerce_question(question: dict[str, Any], index: int) -> dict[str, Any]:
    question_no = int(question.get("question_no") or index)
    return {
        "question_index": index,
        "question_key": f"Q{question_no}",
        "question_no": question_no,
        "max_score": int(question.get("max_score") or 0) or None,
        "char_limit": int(question.get("char_limit") or 0) or None,
        "prompt_text": str(question.get("prompt_text") or "").strip(),
    }


def coerce_question_units(raw_units: list[dict[str, Any]], questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not raw_units:
        return normalize_question_units(questions)
    units: list[dict[str, Any]] = []
    for idx, unit in enumerate(raw_units, start=1):
        parent_question_no = int(unit.get("parent_question_no") or unit.get("question_no") or idx)
        sub_no = unit.get("subquestion_no")
        try:
            sub_no = int(sub_no) if sub_no is not None else None
        except Exception:
            sub_no = None
        units.append(
            {
                "question_key": f"Q{parent_question_no}" if sub_no is None else f"Q{parent_question_no}-{sub_no}",
                "question_index": idx,
                "parent_question_no": parent_question_no,
                "subquestion_no": sub_no,
                "max_score": int(unit.get("max_score") or 0) or None,
                "char_limit": int(unit.get("char_limit") or 0) or None,
                "prompt_text": str(unit.get("prompt_text") or "").strip(),
            }
        )
    return units


def coerce_rubrics(raw_rubrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rubrics = []
    for idx, rubric in enumerate(raw_rubrics, start=1):
        items = [str(x).strip() for x in (rubric.get("checklist_items") or []) if str(x).strip()]
        if not items:
            continue
        rubrics.append(
            {
                "rubric_index": idx,
                "question_no": int(rubric.get("question_no") or idx),
                "title": rubric.get("title"),
                "source_type": "ai_historical_backfill",
                "checklist_items": items[:8],
            }
        )
    return rubrics


def coerce_explanations(raw_explanations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = []
    for item in raw_explanations:
        question_no = item.get("question_no")
        if question_no is None:
            continue
        output.append(
            {
                "question_no": int(question_no),
                "source_type": "ai_historical_backfill",
                "positioning_text": str(item.get("positioning_text") or "").strip(),
                "solution_text": str(item.get("solution_text") or "").strip(),
                "answer_example_text": str(item.get("answer_example_text") or "").strip(),
                "difficulty_text": str(item.get("difficulty_text") or "").strip(),
            }
        )
    return output


def coerce_calculation_breakdowns(raw_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for raw in raw_items:
        question_no = raw.get("question_no")
        if question_no is None:
            continue
        items.append(
            {
                "question_no": int(question_no),
                "calculation_steps": [str(x).strip() for x in (raw.get("calculation_steps") or []) if str(x).strip()],
                "formula_candidates": [str(x).strip() for x in (raw.get("formula_candidates") or []) if str(x).strip()],
                "unit_requirements": [str(x).strip() for x in (raw.get("unit_requirements") or []) if str(x).strip()],
                "scoring_checkpoints": [str(x).strip() for x in (raw.get("scoring_checkpoints") or []) if str(x).strip()],
            }
        )
    return items


def validate_backfill(payload: dict[str, Any], source_text: str) -> None:
    questions = payload.get("questions") or []
    if not questions:
        raise ValueError("No questions generated.")
    for question in questions:
        prompt_text = str(question.get("prompt_text") or "")
        if not prompt_text or "第" not in prompt_text:
            raise ValueError("Question prompt is too weak.")
        char_limit = question.get("char_limit")
        if not isinstance(char_limit, int) or char_limit <= 0:
            raise ValueError("char_limit is missing.")
    if len(normalize_spaces(payload.get("passage_text") or "")) < 200:
        raise ValueError("passage_text is too short.")


def transform_output(case_no: int, year_label: str, ai_payload: dict[str, Any], source_text: str) -> dict[str, Any]:
    questions = [coerce_question(item, idx) for idx, item in enumerate(ai_payload.get("questions") or [], start=1)]
    question_units = coerce_question_units(ai_payload.get("question_units") or [], questions)
    rubrics = coerce_rubrics(ai_payload.get("rubrics") or [])
    explanations = coerce_explanations(ai_payload.get("explanations") or [])
    calculation_breakdowns = coerce_calculation_breakdowns(ai_payload.get("calculation_breakdowns") or []) if case_no == 4 else []

    return {
        "passage_text": extract_passage_text(source_text),
        "questions": questions,
        "question_units": question_units,
        "rubrics": rubrics,
        "explanations": explanations,
        "calculation_breakdowns": calculation_breakdowns,
        "alignment_summary": build_alignment_summary(questions, rubrics),
        "scoring_materials": {
            "status": "ai_historical_backfill",
            "notes": [
                f"{year_label} 事例{case_no} は H30〜R07 を参照形式として Gemini latest alias で補完",
                "rubrics / explanations は元本文と設問要求から導いた補助的構造化データ",
            ],
            "model_name": LATEST_MODEL_ALIAS,
        },
    }


def generate_backfill_for(case_no: int, year_label: str) -> dict[str, Any]:
    source_text = clean_pdf_text(source_document_text(case_no, year_label))
    references = load_reference_examples(case_no)
    print(f"  first pass {year_label} case{case_no}", flush=True)
    first = generate_json(first_pass_prompt(case_no, year_label, source_text, references))
    print(f"  second pass {year_label} case{case_no}", flush=True)
    second = generate_json(second_pass_prompt(case_no, year_label, source_text, first))
    transformed = transform_output(case_no, year_label, second, source_text)
    validate_backfill(transformed, source_text)
    return transformed


def main() -> None:
    HISTORICAL_BACKFILL_DIR.mkdir(parents=True, exist_ok=True)
    targets = [(f"H{year:02d}", case_no) for year in range(19, 30) for case_no in (2, 3, 4)]
    failures: list[dict[str, str]] = []
    for year_label, case_no in targets:
        output_path = HISTORICAL_BACKFILL_DIR / f"{year_label}_case{case_no}.json"
        if output_path.exists():
            print(f"Skipping existing {year_label} case{case_no}", flush=True)
            continue
        print(f"Generating {year_label} case{case_no}...", flush=True)
        try:
            payload = generate_backfill_for(case_no, year_label)
            write_json(output_path, payload)
            print(f"Saved {output_path}", flush=True)
        except Exception as exc:
            failures.append({"year_label": year_label, "case_no": str(case_no), "error": str(exc)})
            print(f"Failed {year_label} case{case_no}: {exc}", flush=True)
    if failures:
        write_json(HISTORICAL_BACKFILL_DIR / "_failures.json", failures)
        print(f"Completed with {len(failures)} failures.", flush=True)
    else:
        print("Completed without failures.", flush=True)


if __name__ == "__main__":
    main()
