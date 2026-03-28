#!/opt/homebrew/bin/python3
from __future__ import annotations

import json
import re
import shutil
import statistics
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


REPO_ROOT = Path("/Users/developer/AI_Exam_Prep_Kit_R3_onAzure")
SOURCE_ROOT = Path("/Users/developer/★中小企業診断士_二次試験")
OUTPUT_ROOT = REPO_ROOT / "secondary_exam_dataset"
PDFTOTEXT = shutil.which("pdftotext") or "/opt/homebrew/bin/pdftotext"

FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")
XML_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
SECONDARY_PDF_BLOB_PREFIX = "second-pdf-mondai"
HISTORICAL_BACKFILL_DIR = Path(__file__).resolve().parent / "historical_secondary_exam_backfills"
CASE_ROMAN_TO_NO = {"Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4}
CASE_NO_TO_ROMAN = {value: key for key, value in CASE_ROMAN_TO_NO.items()}


@dataclass
class SourceFile:
    category: str
    path: Path


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    ensure_dir(path.parent)
    path.write_text(text, encoding="utf-8")


def normalize_digits(text: str) -> str:
    return text.translate(FULLWIDTH_DIGITS)


def compact_japanese_number_text(text: str) -> str:
    return re.sub(r"[ \t]+", "", normalize_digits(text))


def compact_text_with_mapping(text: str) -> tuple[str, list[int]]:
    compact_chars: list[str] = []
    mapping: list[int] = []
    for index, ch in enumerate(text):
        if ch.isspace():
            continue
        compact_chars.append(normalize_digits(ch))
        mapping.append(index)
    return "".join(compact_chars), mapping


def find_text_span_by_compact_match(full_text: str, snippet: str) -> tuple[int, int] | None:
    compact_full, mapping = compact_text_with_mapping(full_text)
    compact_snippet = "".join(normalize_digits(ch) for ch in snippet if not ch.isspace())
    if not compact_snippet:
        return None
    start = compact_full.find(compact_snippet)
    if start == -1:
        return None
    end = start + len(compact_snippet) - 1
    return mapping[start], mapping[end] + 1


def find_text_span_with_fallbacks(full_text: str, snippet: str, lengths: list[int]) -> tuple[int, int] | None:
    compact_snippet = "".join(normalize_digits(ch) for ch in snippet if not ch.isspace())
    for length in lengths:
        if len(compact_snippet) < length:
            continue
        span = find_text_span_by_compact_match(full_text, compact_snippet[:length])
        if span:
            return span
    return find_text_span_by_compact_match(full_text, snippet)


def safe_slug(text: str) -> str:
    text = normalize_digits(text)
    text = re.sub(r"\s+", "_", text.strip())
    text = re.sub(r"[^0-9A-Za-z_\-一-龥ぁ-んァ-ヶⅠⅡⅢⅣ事例RHP年度]", "", text)
    return text or "untitled"


def canonical_year_label(text: str) -> str:
    normalized = normalize_digits(text)
    reiwa_match = re.search(r"R0?(\d+)", normalized)
    if reiwa_match:
        return f"R{int(reiwa_match.group(1)):02d}"
    gregorian_match = re.search(r"(20\d{2})", normalized)
    if gregorian_match:
        year = int(gregorian_match.group(1))
        reiwa = year - 2018
        if 1 <= reiwa <= 99:
            return f"R{reiwa:02d}"
        heisei = year - 1988
        if 1 <= heisei <= 30:
            return f"H{heisei:02d}"
    heisei_match = re.search(r"H(\d+)", normalized)
    if heisei_match:
        return f"H{int(heisei_match.group(1)):02d}"
    return safe_slug(text)


def year_label_to_gregorian(year_label: str) -> int | None:
    reiwa_match = re.fullmatch(r"R(\d{2})", year_label)
    if reiwa_match:
        return 2018 + int(reiwa_match.group(1))
    heisei_match = re.fullmatch(r"H(\d{2})", year_label)
    if heisei_match:
        return 1988 + int(heisei_match.group(1))
    gregorian_match = re.fullmatch(r"(20\d{2})", year_label)
    if gregorian_match:
        return int(gregorian_match.group(1))
    return None


def exam_pdf_filename(case_no: int, year_label: str) -> str | None:
    gregorian = year_label_to_gregorian(year_label)
    if gregorian is None:
        return None
    return f"case{case_no}_{gregorian}.pdf"


def case_pdf_path(case_no: int, year_label: str) -> str | None:
    gregorian = year_label_to_gregorian(year_label)
    if gregorian is None:
        return None
    roman = CASE_NO_TO_ROMAN.get(case_no)
    if not roman:
        return None
    filename = exam_pdf_filename(case_no, year_label)
    candidates = []
    if filename:
        candidates.append(SOURCE_ROOT / "二次_過去問PDF" / filename)
    candidates.append(SOURCE_ROOT / "二次_過去問PDF" / f"事例{roman}_{gregorian}.pdf")
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def case_pdf_blob_path(case_no: int, year_label: str) -> str | None:
    filename = exam_pdf_filename(case_no, year_label)
    if not filename:
        return None
    return f"{SECONDARY_PDF_BLOB_PREFIX}/{filename}"


def source_files() -> list[SourceFile]:
    files: list[SourceFile] = []
    for path in sorted(SOURCE_ROOT.rglob("*")):
        if not path.is_file():
            continue
        if path.name == ".DS_Store" or ".history" in path.parts or "__pycache__" in path.parts:
            continue
        rel = path.relative_to(SOURCE_ROOT)
        rel_text = str(rel)
        if rel_text.startswith("二次_過去問PDF/"):
            category = "past_exam_pdf"
        elif rel_text.startswith("★解答チェックリスト/"):
            category = "answer_checklist_pdf"
        elif rel_text.startswith("★2次テキスト（解法）/"):
            category = "tac_text_pdf"
        elif rel_text.startswith("★R7,R6 _TAC解説_OCR/"):
            category = "tac_ocr_json"
        elif rel_text.startswith("抽出結果/"):
            category = "aas_extracted_json"
        elif rel_text.startswith("☆事例1_整形済みinputデータ/"):
            category = "structured_case1"
        elif path.suffix.lower() == ".xlsx":
            category = "fuzoroi_xlsx"
        elif path.suffix.lower() == ".pdf" and "ふぞろい" in path.name:
            category = "fuzoroi_pdf"
        elif path.suffix.lower() == ".txt":
            category = "prompt_text"
        elif path.suffix.lower() == ".py":
            category = "utility_script"
        elif path.suffix.lower() == ".md":
            category = "notes"
        else:
            category = "other"
        files.append(SourceFile(category=category, path=path))
    return files


def extract_pdf_text(src: Path, dest: Path, category: str) -> dict[str, Any]:
    proc = subprocess.run(
        [PDFTOTEXT, "-layout", str(src), "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        check=False,
    )
    text = proc.stdout
    payload = {
        "source_path": str(src),
        "category": category,
        "content_type": "pdf_text",
        "text": text,
        "char_count": len(text),
        "line_count": len(text.splitlines()),
        "status": "ok" if proc.returncode == 0 else f"pdftotext_exit_{proc.returncode}",
    }
    write_json(dest, payload)
    return {
        "source_path": str(src),
        "output_path": str(dest.relative_to(OUTPUT_ROOT)),
        "char_count": payload["char_count"],
        "line_count": payload["line_count"],
        "status": payload["status"],
    }


def extract_pdf_text_string(src: Path) -> str:
    proc = subprocess.run(
        [PDFTOTEXT, "-layout", str(src), "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        check=False,
    )
    return proc.stdout


def clean_pdf_text(full_text: str) -> str:
    lines = full_text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n").splitlines()
    kept: list[str] = []
    for line in lines:
        stripped = line.strip()
        if re.fullmatch(r"\d+", stripped):
            continue
        if "indd" in stripped:
            continue
        kept.append(line.rstrip())
    text = "\n".join(kept)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def compress_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def strip_control_noise(text: str) -> str:
    text = text.replace("\f", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def ai_clean_text(text: str) -> str:
    return compress_whitespace(strip_control_noise(text))


def parse_case_questions_from_text(full_text: str) -> dict[str, Any]:
    normalized = full_text.replace("\r\n", "\n").replace("\r", "\n")
    question_pattern = r"第\s*([0-9０-９]+)\s*問（配点\s*([0-9０-９]+)\s*点）"
    first_question = re.search(question_pattern, normalized)
    passage_text = normalized[: first_question.start()].strip() if first_question else normalized.strip()
    blocks = re.finditer(
        rf"({question_pattern}[\s\S]*?)(?={question_pattern}|$)",
        normalized,
    )
    questions = []
    for index, match in enumerate(blocks, start=1):
        block = match.group(1).strip()
        question_no = int(compact_japanese_number_text(match.group(2)))
        max_score = int(compact_japanese_number_text(match.group(3)))
        char_limit_match = re.search(r"([0-9０-９]+)\s*字\s*以内", block)
        char_limit = int(normalize_digits(char_limit_match.group(1))) if char_limit_match else None
        questions.append(
            {
                "question_index": index,
                "question_key": f"Q{index}",
                "question_no": question_no,
                "max_score": max_score,
                "char_limit": char_limit,
                "prompt_text": block,
            }
        )
    return {"passage_text": passage_text, "questions": questions}


def parse_case_questions(raw_text: str) -> dict[str, Any]:
    stripped = raw_text.lstrip()
    if stripped.startswith("{"):
        payload = json.loads(raw_text)
        if isinstance(payload, dict) and "passage" in payload and "questions" in payload:
            questions = []
            for index, item in enumerate(payload.get("questions", []), start=1):
                prompt_text = str(item.get("question_text") or "").strip()
                char_limit_match = re.search(r"([0-9０-９]+)\s*字\s*以内", prompt_text)
                char_limit = int(normalize_digits(char_limit_match.group(1))) if char_limit_match else None
                source_question_no = item.get("question_no")
                max_score = item.get("points")
                try:
                    max_score = int(max_score)
                except Exception:
                    max_score = None
                questions.append(
                    {
                        "question_index": index,
                        "question_key": f"Q{index}",
                        "question_no": source_question_no,
                        "max_score": max_score,
                        "char_limit": char_limit,
                        "prompt_text": prompt_text,
                    }
                )
            return {
                "source_format": "structured_json",
                "passage_text": str(payload.get("passage") or "").strip(),
                "questions": questions,
            }
    parsed = parse_case_questions_from_text(raw_text)
    parsed["source_format"] = "plain_text"
    return parsed


def normalize_question_units(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    units: list[dict[str, Any]] = []
    for item in questions:
        question_index = item.get("question_index")
        question_no = item.get("question_no")
        max_score = item.get("max_score")
        prompt_text = str(item.get("prompt_text") or "").strip()
        char_limit = item.get("char_limit")
        sub_matches = list(
            re.finditer(
                r"（\s*設問\s*([0-9０-９]+)\s*）\s*([\s\S]*?)(?=（\s*設問\s*[0-9０-９]+\s*）|$)",
                prompt_text,
            )
        )
        if sub_matches:
            for sub in sub_matches:
                sub_no = int(normalize_digits(sub.group(1)))
                sub_text = sub.group(2).strip()
                sub_char_match = re.search(r"([0-9０-９]+)\s*字\s*以内", sub_text)
                sub_char_limit = int(normalize_digits(sub_char_match.group(1))) if sub_char_match else None
                units.append(
                    {
                        "question_key": f"Q{question_index}-S{sub_no}",
                        "question_index": question_index,
                        "parent_question_no": question_no,
                        "subquestion_no": sub_no,
                        "max_score": max_score,
                        "char_limit": sub_char_limit if sub_char_limit is not None else char_limit,
                        "prompt_text": f"（設問{sub_no}）\n{sub_text}",
                    }
                )
        else:
            units.append(
                {
                    "question_key": f"Q{question_index}",
                    "question_index": question_index,
                    "parent_question_no": question_no,
                    "subquestion_no": None,
                    "max_score": max_score,
                    "char_limit": char_limit,
                    "prompt_text": prompt_text,
                }
            )
    return units


def build_alignment_summary(questions: list[dict[str, Any]], rubrics: list[dict[str, Any]]) -> dict[str, Any]:
    question_units = normalize_question_units(questions)
    mode = "unmatched"
    if len(questions) == len(rubrics):
        mode = "direct"
    elif len(question_units) == len(rubrics):
        mode = "question_units"
    return {
        "question_count": len(questions),
        "question_unit_count": len(question_units),
        "rubric_count": len(rubrics),
        "counts_match_directly": len(questions) == len(rubrics),
        "counts_match_by_units": len(question_units) == len(rubrics),
        "recommended_alignment_mode": mode,
    }


def parse_checklist_sections(text: str) -> list[dict[str, Any]]:
    cleaned = clean_pdf_text(text)
    heading_pattern = re.compile(
        r"第\s*([0-9０-９]+)\s*問(?:\s*\(\s*設問\s*([0-9０-９]+)\s*\))?.{0,40}?解答チェックリスト",
    )
    matches = list(heading_pattern.finditer(cleaned))
    sections: list[dict[str, Any]] = []
    for index, match in enumerate(matches, start=1):
        end = matches[index].start() if index < len(matches) else len(cleaned)
        block = cleaned[match.start():end].strip()
        item_chunks = [compress_whitespace(chunk) for chunk in re.split(r"\n?□", block)[1:]]
        sections.append(
            {
                "rubric_index": index,
                "question_no": int(compact_japanese_number_text(match.group(1))),
                "subquestion_no": int(compact_japanese_number_text(match.group(2))) if match.group(2) else None,
                "title": compress_whitespace(match.group(0)),
                "section_text": block,
                "checklist_items": [item for item in item_chunks if item],
            }
        )
    return sections


def extract_question_paragraph_sections(text: str, start_heading: str, end_heading: str | None) -> dict[int, str]:
    cleaned = clean_pdf_text(text)
    start = cleaned.find(start_heading)
    if start == -1:
        return {}
    end = cleaned.find(end_heading, start) if end_heading else len(cleaned)
    if end == -1:
        end = len(cleaned)
    section = cleaned[start:end]
    pattern = re.compile(r"第\s*([0-9０-９]+)\s*問は、([\s\S]*?)(?=第\s*[0-9０-９]+\s*問は、|$)")
    outputs: dict[int, str] = {}
    for match in pattern.finditer(section):
        question_no = int(compact_japanese_number_text(match.group(1)))
        outputs[question_no] = f"第{question_no}問は、{match.group(2).strip()}"
    return outputs


def extract_solution_sections(text: str) -> dict[int, dict[str, str]]:
    cleaned = clean_pdf_text(text)
    pattern = re.compile(r"第\s*([0-9０-９]+)\s*問の解法")
    matches = list(pattern.finditer(cleaned))
    outputs: dict[int, dict[str, str]] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(cleaned)
        block = cleaned[match.start():end].strip()
        question_no = int(compact_japanese_number_text(match.group(1)))
        answer_example_text = None
        answer_match = re.search(
            r"解答例は次の通りです。([\s\S]*?)(?=第\s*[0-9０-９]+\s*問の解法|ここまでで解説は終了|（巻末）与件文と問題|$)",
            block,
        )
        if answer_match:
            answer_example_text = compress_whitespace(answer_match.group(1))
        outputs[question_no] = {
            "solution_text": block,
            "answer_example_text": answer_example_text,
        }
    return outputs


def extract_case_segment_from_combined_text(full_text: str, case_bundle: dict[str, Any], next_case_bundle: dict[str, Any] | None) -> str | None:
    snippet = str(case_bundle.get("passage_text") or "")[:120]
    span = find_text_span_with_fallbacks(full_text, snippet, [120, 80, 60, 40, 24])
    if not span:
        return None
    start = span[0]
    end = len(full_text)
    if next_case_bundle:
        next_snippet = str(next_case_bundle.get("passage_text") or "")[:120]
        next_span = find_text_span_with_fallbacks(full_text, next_snippet, [120, 80, 60, 40, 24])
        if next_span:
            end = next_span[0]
    return clean_pdf_text(full_text[start:end])


def extract_question_blocks_by_heading(text: str) -> dict[int, str]:
    cleaned = clean_pdf_text(text)
    pattern = re.compile(r"(第\s*([0-9０-９]+)\s*問（配点\s*[0-9０-９]+\s*点）[\s\S]*?)(?=第\s*[0-9０-９]+\s*問（配点\s*[0-9０-９]+\s*点）|$)")
    outputs: dict[int, str] = {}
    for match in pattern.finditer(cleaned):
        question_no = int(compact_japanese_number_text(match.group(2)))
        outputs[question_no] = match.group(1).strip()
    return outputs


def split_japanese_sentences(text: str) -> list[str]:
    normalized = compress_whitespace(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[。！？])\s+", normalized)
    return [part.strip() for part in parts if part.strip()]


def normalize_checkpoint_text(text: str) -> str:
    text = compress_whitespace(text)
    text = re.sub(r"^\([1-4]\)\s*", "", text)
    text = re.sub(r"^第\s*[0-9０-９]+\s*問（配点\s*[0-9０-９]+\s*点）\s*", "", text)
    text = text.replace("－", "")
    return text.strip()


def extract_named_section(block: str, heading_no: int) -> str:
    pattern = re.compile(
        rf"\({heading_no}\)\s*[\s\S]*?(?=\([1-4]\)\s*|$)",
    )
    match = pattern.search(block)
    return match.group(0).strip() if match else ""


def sentence_priority(sentence: str) -> tuple[int, int]:
    keywords = [
        "直接の要求", "問題要求", "制約", "注意", "必要", "求められる", "着目", "含め", "盛り込",
        "解答構成", "基本線", "優先", "ターゲット", "差別化", "強み", "弱み", "課題", "改善策",
    ]
    hits = sum(1 for keyword in keywords if keyword in sentence)
    return (-hits, -len(sentence))


def clause_like_checkpoints_from_answer_example(answer_example_text: str) -> list[str]:
    text = normalize_checkpoint_text(answer_example_text)
    checkpoints: list[str] = []

    if "（設問" in text:
        for sub_match in re.finditer(r"（設問\s*([0-9０-９]+)\s*）", text):
            sub_no = int(compact_japanese_number_text(sub_match.group(1)))
            marker = f"設問{sub_no}に対応する要素を答案に含める"
            if marker not in checkpoints:
                checkpoints.append(marker)
        return checkpoints

    for sentence in split_japanese_sentences(text):
        sentence = normalize_checkpoint_text(sentence)
        if 12 <= len(sentence) <= 110:
            checkpoints.append(sentence)
        elif len(sentence) > 110:
            for clause in re.split(r"[、,]", sentence):
                clause = normalize_checkpoint_text(clause)
                if 12 <= len(clause) <= 60 and clause not in checkpoints:
                    checkpoints.append(clause)
        if len(checkpoints) >= 4:
            break
    return checkpoints[:4]


def extract_derived_checkpoints(solution_text: str, answer_example_text: str | None) -> list[str]:
    checkpoints: list[str] = []

    if answer_example_text:
        checkpoints.extend(clause_like_checkpoints_from_answer_example(answer_example_text))

    section1 = extract_named_section(solution_text, 1)
    section3 = extract_named_section(solution_text, 3)
    section4 = extract_named_section(solution_text, 4)

    candidate_sentences: list[str] = []
    for section in [section1, section3, section4]:
        candidate_sentences.extend(split_japanese_sentences(section))

    filtered: list[str] = []
    for sentence in candidate_sentences:
        sentence = normalize_checkpoint_text(sentence)
        if len(sentence) < 18:
            continue
        if len(sentence) > 120:
            continue
        if "第 " in sentence and "問" in sentence and "配点" in sentence:
            continue
        if "第 " in sentence and "段落" in sentence:
            continue
        if "解答例は次の通りです" in sentence:
            continue
        if "根拠探し" in sentence or "根拠選択" in sentence or "構成要素検討" in sentence:
            continue
        if not any(
            marker in sentence
            for marker in ["要求", "制約", "必要", "求め", "注意", "着目", "含め", "盛り込", "優先", "解答", "改善", "課題", "強み", "弱み"]
        ):
            continue
        filtered.append(sentence)

    for sentence in sorted(filtered, key=sentence_priority):
        compact = normalize_checkpoint_text(sentence)
        if compact not in checkpoints:
            checkpoints.append(compact)
        if len(checkpoints) >= 4:
            break

    if answer_example_text:
        if len(checkpoints) < 5:
            checkpoints.append("解答例で示された主要要素を過不足なく含める")

    deduped: list[str] = []
    for item in checkpoints:
        if item not in deduped:
            deduped.append(item)
    return deduped[:5]


def build_derived_rubrics_from_explanations(explanations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rubrics: list[dict[str, Any]] = []
    for index, explanation in enumerate(explanations, start=1):
        checkpoints = extract_derived_checkpoints(
            explanation.get("solution_text") or "",
            explanation.get("answer_example_text"),
        )
        if not checkpoints:
            continue
        rubrics.append(
            {
                "rubric_index": index,
                "question_no": explanation.get("question_no"),
                "subquestion_no": None,
                "title": f"第{explanation.get('question_no')}問（TAC解説由来）",
                "source_type": "derived_from_tac_explanation",
                "checklist_items": checkpoints,
            }
        )
    return rubrics


def build_case4_rubrics_from_breakdowns(breakdowns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rubrics: list[dict[str, Any]] = []
    for index, breakdown in enumerate(breakdowns, start=1):
        items = breakdown.get("scoring_checkpoints") or []
        if not items:
            continue
        rubrics.append(
            {
                "rubric_index": index,
                "question_no": breakdown.get("question_no"),
                "subquestion_no": None,
                "title": f"第{breakdown.get('question_no')}問（計算分解）",
                "source_type": "derived_case4_calculation",
                "checklist_items": items,
            }
        )
    return rubrics


def case4_clean_formula_text(text: str) -> str:
    text = normalize_digits(text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("≦", "<=").replace("≧", ">=").replace("≤", "<=").replace("≥", ">=")
    return text


def extract_case4_formula_lines(text: str) -> list[str]:
    formulas: list[str] = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        line = case4_clean_formula_text(raw_line)
        if not line:
            continue
        if len(line) > 180:
            continue
        if not re.search(r"[=<>]|<=|>=|∴|÷|×|－|\+", line):
            continue
        if not re.search(r"[0-9A-Za-z]", line):
            continue
        if line not in formulas:
            formulas.append(line)
    return formulas[:12]


def extract_case4_units(text: str) -> list[str]:
    units: list[str] = []
    for match in re.finditer(r"（\s*([^\)]{1,12})\s*）", text):
        value = compress_whitespace(match.group(1))
        if not value:
            continue
        if not re.fullmatch(r"[0-9A-Za-zァ-ヶ一-龥％%回円万円千円基袋個時間hkg]+", value):
            continue
        if value not in units:
            units.append(value)
    return units[:10]


def extract_case4_named_steps(text: str) -> list[str]:
    steps: list[str] = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        line = case4_clean_formula_text(raw_line)
        if not line:
            continue
        if "：" in line:
            head = line.split("：", 1)[0].strip(" ・")
            if 2 <= len(head) <= 30 and head not in steps:
                steps.append(head)
        elif line.startswith("＜") and line.endswith("＞"):
            head = line.strip("＜＞ ")
            if head and head not in steps:
                steps.append(head)
    return steps[:12]


def build_case4_calculation_breakdown(explanation: dict[str, Any]) -> dict[str, Any]:
    answer_text = explanation.get("answer_example_text") or ""
    solution_text = explanation.get("solution_text") or ""
    combined = f"{answer_text}\n{solution_text}"
    formulas = extract_case4_formula_lines(combined)
    units = extract_case4_units(answer_text)
    step_labels = extract_case4_named_steps(solution_text)

    checkpoint_candidates: list[str] = []
    for step in step_labels[:6]:
        if step not in checkpoint_candidates:
            checkpoint_candidates.append(f"{step}を計算根拠として示す")
    if units:
        checkpoint_candidates.append(f"単位を明記する: {' / '.join(units[:5])}")
    if formulas:
        checkpoint_candidates.append("主要な計算式を答案または計算過程に示す")

    return {
        "question_no": explanation.get("question_no"),
        "calculation_steps": step_labels,
        "formula_candidates": formulas,
        "unit_requirements": units,
        "scoring_checkpoints": checkpoint_candidates[:8],
    }


def question_rubric_candidates(bundle_payload: dict[str, Any], question: dict[str, Any]) -> list[dict[str, Any]]:
    question_no = question.get("question_no")
    question_index = question.get("question_index")
    candidates: list[dict[str, Any]] = []
    for rubric in bundle_payload.get("rubrics", []):
        same_question = rubric.get("question_no") == question_no
        same_order = rubric.get("rubric_index") == question_index and rubric.get("question_no") is None
        if not same_question and not same_order:
            continue
        candidates.append(
            {
                "title": rubric.get("title"),
                "source_type": rubric.get("source_type", "source_rubric"),
                "checklist_items": rubric.get("checklist_items") or rubric.get("採点観点") or [],
            }
        )
    return candidates


def question_explanation_candidate(bundle_payload: dict[str, Any], question: dict[str, Any]) -> dict[str, Any] | None:
    question_no = question.get("question_no")
    for explanation in bundle_payload.get("explanations", []):
        if explanation.get("question_no") == question_no:
            return {
                "positioning_text": explanation.get("positioning_text"),
                "difficulty_text": explanation.get("difficulty_text"),
                "solution_text": explanation.get("solution_text"),
                "answer_example_text": explanation.get("answer_example_text"),
            }
    return None


def question_calculation_breakdown(bundle_payload: dict[str, Any], question: dict[str, Any]) -> dict[str, Any] | None:
    question_no = question.get("question_no")
    for breakdown in bundle_payload.get("calculation_breakdowns", []):
        if breakdown.get("question_no") == question_no:
            return breakdown
    return None


def build_raw_source_metadata(bundle_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_format": bundle_payload.get("source_format"),
        "question_path": bundle_payload.get("source_question_path"),
        "rubric_path": bundle_payload.get("source_rubric_path"),
        "commentary_path": bundle_payload.get("source_commentary_path"),
        "pdf_path": bundle_payload.get("source_pdf_path"),
        "pdf_blob_path": bundle_payload.get("source_pdf_blob_path"),
        "has_structured_rubrics": bool(bundle_payload.get("rubrics")),
        "has_explanations": bool(bundle_payload.get("explanations")),
        "has_calculation_breakdowns": bool(bundle_payload.get("calculation_breakdowns")),
    }


def build_question_prompt_packets(bundle_payload: dict[str, Any]) -> list[dict[str, Any]]:
    packets: list[dict[str, Any]] = []
    unit_map: dict[int, list[dict[str, Any]]] = {}
    for unit in bundle_payload.get("question_units", []):
        unit_map.setdefault(unit.get("parent_question_no"), []).append(unit)

    for question in bundle_payload.get("questions", []):
        packet = {
            "question_index": question.get("question_index"),
            "question_key": question.get("question_key"),
            "question_no": question.get("question_no"),
            "max_score": question.get("max_score"),
            "char_limit": question.get("char_limit"),
            "prompt_text": question.get("prompt_text"),
            "prompt_text_clean": ai_clean_text(question.get("prompt_text") or ""),
            "subquestions": [
                {
                    "question_key": unit.get("question_key"),
                    "subquestion_no": unit.get("subquestion_no"),
                    "char_limit": unit.get("char_limit"),
                    "max_score": unit.get("max_score"),
                    "prompt_text": unit.get("prompt_text"),
                    "prompt_text_clean": ai_clean_text(unit.get("prompt_text") or ""),
                }
                for unit in unit_map.get(question.get("question_no"), [])
            ],
            "rubric_candidates": question_rubric_candidates(bundle_payload, question),
            "explanation_candidate": question_explanation_candidate(bundle_payload, question),
            "calculation_breakdown": question_calculation_breakdown(bundle_payload, question),
        }
        packets.append(packet)
    return packets


def build_normalized_scoring_input(bundle_payload: dict[str, Any]) -> dict[str, Any]:
    prompt_packets = build_question_prompt_packets(bundle_payload)
    return {
        "passage_text_clean": ai_clean_text(bundle_payload.get("passage_text") or ""),
        "question_prompt_packets": prompt_packets,
        "recommended_alignment_mode": bundle_payload.get("alignment_summary", {}).get("recommended_alignment_mode"),
        "token_saving_strategy": {
            "default_scope": "single_question_only",
            "prefer_rubrics_over_full_commentary": True,
            "prefer_answer_example_summary_over_full_answer_corpus": True,
            "use_calculation_breakdown_for_case4": bundle_payload.get("case_no") == 4,
        },
    }


def build_scoring_policy(bundle_payload: dict[str, Any]) -> dict[str, Any]:
    case_no = bundle_payload.get("case_no")
    advice_focus = {
        1: ["与件根拠", "組織論点", "助言の因果"],
        2: ["ターゲット適合", "施策の具体性", "強み活用"],
        3: ["現場課題", "改善策の一貫性", "因果関係"],
        4: ["計算過程", "式の妥当性", "単位", "最終数値"],
    }.get(case_no, ["設問適合", "根拠", "具体性"])
    return {
        "grading_principles": [
            "設問要求への適合を最優先で評価する",
            "元データ由来のrubric・explanation・answer_exampleを優先して根拠にする",
            "ノイズを含む原文は参照用とし、採点判断はnormalized_scoring_inputを中心に行う",
            "設問に無関係な論点は加点対象にしない",
        ],
        "advice_principles": [
            "不足論点を設問単位で明示する",
            "改善アドバイスは次回答案で再現できる形にする",
            "抽象論よりも字数配分・論点順序・キーワード不足を優先して指摘する",
            "case4では計算ミスだけでなく、式・単位・途中計算の欠落も指摘する",
        ],
        "token_control": {
            "send_single_question_packet_first": True,
            "send_full_passage_only_if_needed": True,
            "send_answer_corpora_summary_before_full_answers": True,
            "avoid_full_commentary_dump": True,
        },
        "advice_focus": advice_focus,
    }


def finalize_exam_bundle_payload(bundle_payload: dict[str, Any]) -> None:
    bundle_payload["raw_source"] = build_raw_source_metadata(bundle_payload)
    bundle_payload["normalized_scoring_input"] = build_normalized_scoring_input(bundle_payload)
    bundle_payload["scoring_policy"] = build_scoring_policy(bundle_payload)


def load_historical_backfill(year_label: str, case_no: int) -> dict[str, Any] | None:
    path = HISTORICAL_BACKFILL_DIR / f"{year_label}_case{case_no}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def ensure_question_metadata(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_questions: list[dict[str, Any]] = []
    for index, item in enumerate(questions or [], start=1):
        question = dict(item)
        question.setdefault("question_index", index)
        question.setdefault("question_key", f"Q{question['question_index']}")
        normalized_questions.append(question)
    return normalized_questions


def apply_historical_backfill(bundle_payload: dict[str, Any]) -> None:
    backfill = load_historical_backfill(bundle_payload["year_label"], bundle_payload["case_no"])
    if not backfill:
        return

    if backfill.get("passage_text"):
        bundle_payload["passage_text"] = backfill["passage_text"]
    if isinstance(backfill.get("questions"), list):
        bundle_payload["questions"] = ensure_question_metadata(backfill["questions"])
    if isinstance(backfill.get("question_units"), list):
        bundle_payload["question_units"] = backfill["question_units"]
    if isinstance(backfill.get("rubrics"), list):
        bundle_payload["rubrics"] = backfill["rubrics"]
    if isinstance(backfill.get("explanations"), list):
        bundle_payload["explanations"] = backfill["explanations"]
    if isinstance(backfill.get("calculation_breakdowns"), list):
        bundle_payload["calculation_breakdowns"] = backfill["calculation_breakdowns"]
    if isinstance(backfill.get("alignment_summary"), dict):
        bundle_payload["alignment_summary"] = backfill["alignment_summary"]
    existing_materials = bundle_payload.get("scoring_materials") or {}
    incoming_materials = backfill.get("scoring_materials") or {}
    if incoming_materials:
        merged = dict(existing_materials)
        merged.update(incoming_materials)
        bundle_payload["scoring_materials"] = merged

    bundle_questions = ensure_question_metadata(bundle_payload.get("questions", []))
    bundle_payload["questions"] = bundle_questions
    if not bundle_payload.get("question_units"):
        bundle_payload["question_units"] = normalize_question_units(bundle_questions)
    bundle_payload["alignment_summary"] = build_alignment_summary(bundle_questions, bundle_payload.get("rubrics", []))


def enrich_bundle_with_scoring_materials(bundle_payload: dict[str, Any], next_case_bundle: dict[str, Any] | None = None) -> None:
    year_label = bundle_payload["year_label"]
    case_no = bundle_payload["case_no"]
    notes: list[str] = []
    commentary_path = None

    if case_no == 1:
        bundle_payload["scoring_materials"] = {"status": "already_curated", "notes": ["case1は別系統の整形済み入力データを利用"]}
        return

    if year_label.startswith("R") and int(year_label[1:]) <= 5:
        checklist_pdf = SOURCE_ROOT / "★解答チェックリスト" / f"解答チェックリスト_R{int(year_label[1:])}年度_事例{case_no}.pdf"
        if checklist_pdf.exists():
            checklist_text = extract_pdf_text_string(checklist_pdf)
            bundle_payload["rubrics"] = parse_checklist_sections(checklist_text)
            bundle_payload["source_rubric_path"] = str(checklist_pdf)
        textbook_name_candidates = [
            f"2次テキスト_R{int(year_label[1:])}年度_事例{case_no}.pdf",
            f"2次テキスト_R{int(year_label[1:])}年度事例{case_no}.pdf",
        ]
        textbook_pdf = next((SOURCE_ROOT / "★2次テキスト（解法）" / name for name in textbook_name_candidates if (SOURCE_ROOT / "★2次テキスト（解法）" / name).exists()), None)
        if textbook_pdf:
            commentary_path = str(textbook_pdf)
            textbook_text = extract_pdf_text_string(textbook_pdf)
            positioning = extract_question_paragraph_sections(textbook_text, "設問の位置づけ", "問題の難易度")
            difficulty = extract_question_paragraph_sections(textbook_text, "問題の難易度", None)
            solutions = extract_solution_sections(textbook_text)
            explanations = []
            for question in bundle_payload["questions"]:
                question_no = question["question_no"]
                explanations.append(
                    {
                        "question_no": question_no,
                        "positioning_text": positioning.get(question_no),
                        "difficulty_text": difficulty.get(question_no),
                        "solution_text": solutions.get(question_no, {}).get("solution_text"),
                        "answer_example_text": solutions.get(question_no, {}).get("answer_example_text"),
                    }
                )
            bundle_payload["explanations"] = explanations
            if case_no == 4:
                breakdowns = [build_case4_calculation_breakdown(explanation) for explanation in explanations]
                bundle_payload["calculation_breakdowns"] = breakdowns
                bundle_payload["rubrics"] = build_case4_rubrics_from_breakdowns(breakdowns)
            elif not bundle_payload.get("rubrics"):
                bundle_payload["rubrics"] = build_derived_rubrics_from_explanations(explanations)
    elif year_label in {"R06", "R07"}:
        combined_pdf_name = "R6年度 _2024_tac-mohankatoushu.pdf" if year_label == "R06" else "R7年度_2025_tac-2ji-mohankatoushu.pdf"
        combined_pdf = SOURCE_ROOT / "★2次テキスト（解法）" / combined_pdf_name
        if combined_pdf.exists():
            commentary_path = str(combined_pdf)
            combined_text = extract_pdf_text_string(combined_pdf)
            segment = extract_case_segment_from_combined_text(combined_text, bundle_payload, next_case_bundle)
            if segment:
                parts = segment.split("【解 説】", 1)
                answer_blocks = extract_question_blocks_by_heading(parts[0])
                explanation_blocks = extract_question_blocks_by_heading(parts[1]) if len(parts) > 1 else {}
                bundle_payload["explanations"] = [
                    {
                        "question_no": question["question_no"],
                        "positioning_text": None,
                        "difficulty_text": None,
                        "solution_text": explanation_blocks.get(question["question_no"]),
                        "answer_example_text": answer_blocks.get(question["question_no"]),
                    }
                    for question in bundle_payload["questions"]
                ]
                if case_no == 4:
                    breakdowns = [build_case4_calculation_breakdown(explanation) for explanation in bundle_payload["explanations"]]
                    bundle_payload["calculation_breakdowns"] = breakdowns
                    bundle_payload["rubrics"] = build_case4_rubrics_from_breakdowns(breakdowns)
                else:
                    bundle_payload["rubrics"] = build_derived_rubrics_from_explanations(bundle_payload["explanations"])
                if len(parts) == 1:
                    notes.append("年度横断TAC資料から事例別解説見出しを抽出できなかったため、answer_example中心で保持")
            ocr_json = SOURCE_ROOT / "★R7,R6 _TAC解説_OCR" / f"{year_label.replace('0', '', 1)}_page_dump.json"
            if ocr_json.exists():
                notes.append(f"OCR参照あり: {ocr_json}")

    bundle_payload["source_commentary_path"] = commentary_path
    bundle_payload["scoring_materials"] = {
        "status": "enriched" if bundle_payload.get("rubrics") or bundle_payload.get("explanations") else "unavailable",
        "notes": notes,
    }


def build_structured_case1() -> list[dict[str, Any]]:
    case_dir = SOURCE_ROOT / "☆事例1_整形済みinputデータ" / "事例1"
    bundles = []
    for question_path in sorted(case_dir.glob("R*.json")):
        if "採点観点" in question_path.name:
            continue
        year = question_path.stem
        rubric_path = case_dir / f"{year}採点観点.json"
        question_text = question_path.read_text(encoding="utf-8")
        parsed = parse_case_questions(question_text)
        rubrics = json.loads(rubric_path.read_text(encoding="utf-8")) if rubric_path.exists() else []
        for index, rubric in enumerate(rubrics, start=1):
            if isinstance(rubric, dict):
                rubric.setdefault("rubric_index", index)
        question_units = normalize_question_units(parsed["questions"])
        alignment_summary = build_alignment_summary(parsed["questions"], rubrics)
        canonical_year = canonical_year_label(year)
        payload = {
            "exam_id": f"case1_{year.lower()}",
            "year_label": canonical_year,
            "case_no": 1,
            "source_format": parsed.get("source_format"),
            "source_question_path": str(question_path),
            "source_rubric_path": str(rubric_path) if rubric_path.exists() else None,
            "source_pdf_path": case_pdf_path(1, canonical_year),
            "source_pdf_blob_path": case_pdf_blob_path(1, canonical_year),
            "passage_text": parsed["passage_text"],
            "questions": parsed["questions"],
            "question_units": question_units,
            "rubrics": rubrics,
            "alignment_summary": alignment_summary,
        }
        finalize_exam_bundle_payload(payload)
        dest = OUTPUT_ROOT / "exam_bundles" / "case1" / f"{year}.json"
        write_json(dest, payload)
        bundles.append(
            {
                "year_label": canonical_year,
                "case_no": 1,
                "output_path": str(dest.relative_to(OUTPUT_ROOT)),
                "question_count": len(parsed["questions"]),
                "rubric_count": len(rubrics),
                "char_limits": {str(q["question_no"]): q["char_limit"] for q in parsed["questions"]},
            }
        )
    return bundles


def build_structured_pdf_cases() -> list[dict[str, Any]]:
    raw_payloads: list[dict[str, Any]] = []
    for case_no in [2, 3, 4]:
        roman = CASE_NO_TO_ROMAN[case_no]
        pdf_candidates = []
        pdf_candidates.extend(sorted((SOURCE_ROOT / "二次_過去問PDF").glob(f"case{case_no}_*.pdf")))
        pdf_candidates.extend(sorted((SOURCE_ROOT / "二次_過去問PDF").glob(f"事例{roman}_*.pdf")))
        seen_paths: set[Path] = set()
        for pdf_path in pdf_candidates:
            if pdf_path in seen_paths:
                continue
            seen_paths.add(pdf_path)
            year = canonical_year_label(pdf_path.stem)
            raw_text = extract_pdf_text_string(pdf_path)
            cleaned_text = clean_pdf_text(raw_text)
            parsed = parse_case_questions_from_text(cleaned_text)
            question_units = normalize_question_units(parsed["questions"])
            alignment_summary = build_alignment_summary(parsed["questions"], [])
            payload = {
                "exam_id": f"case{case_no}_{year.lower()}",
                "year_label": year,
                "case_no": case_no,
                "source_format": "pdf_text",
                "source_question_path": str(pdf_path),
                "source_rubric_path": None,
                "source_pdf_path": str(pdf_path),
                "source_pdf_blob_path": case_pdf_blob_path(case_no, year),
                "passage_text": parsed["passage_text"],
                "questions": parsed["questions"],
                "question_units": question_units,
                "rubrics": [],
                "alignment_summary": alignment_summary,
            }
            raw_payloads.append(payload)
    payload_map = {(item["year_label"], item["case_no"]): item for item in raw_payloads}
    bundles = []
    for payload in sorted(raw_payloads, key=lambda item: (item["case_no"], item["year_label"])):
        next_case_bundle = payload_map.get((payload["year_label"], payload["case_no"] + 1))
        enrich_bundle_with_scoring_materials(payload, next_case_bundle)
        apply_historical_backfill(payload)
        finalize_exam_bundle_payload(payload)
        dest = OUTPUT_ROOT / "exam_bundles" / f"case{payload['case_no']}" / f"{payload['year_label']}.json"
        write_json(dest, payload)
        bundles.append(
            {
                "year_label": payload["year_label"],
                "case_no": payload["case_no"],
                "output_path": str(dest.relative_to(OUTPUT_ROOT)),
                "question_count": len(payload["questions"]),
                "rubric_count": len(payload["rubrics"]),
                "char_limits": {str(q["question_key"]): q["char_limit"] for q in payload["questions"]},
            }
        )
    return bundles


def score_stats(scores: list[int]) -> dict[str, Any]:
    if not scores:
        return {"count": 0, "min": None, "max": None, "median": None, "mean": None}
    return {
        "count": len(scores),
        "min": min(scores),
        "max": max(scores),
        "median": statistics.median(scores),
        "mean": round(statistics.mean(scores), 2),
    }


def answer_char_stats(answers: list[str]) -> dict[str, Any]:
    lengths = [len((answer or "").strip()) for answer in answers if (answer or "").strip()]
    if not lengths:
        return {"count": 0, "min": None, "max": None, "median": None, "mean": None}
    return {
        "count": len(lengths),
        "min": min(lengths),
        "max": max(lengths),
        "median": statistics.median(lengths),
        "mean": round(statistics.mean(lengths), 2),
    }


def select_exemplars(answers: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    if not answers:
        return {"high": [], "middle": [], "low": []}
    ordered = sorted(answers, key=lambda item: (-int(item.get("score") or 0), item.get("input_no") or 0))
    ascending = sorted(answers, key=lambda item: (int(item.get("score") or 0), item.get("input_no") or 0))
    middle_index = len(ordered) // 2
    middle_window = ordered[max(0, middle_index - 2): middle_index + 3]
    trim = lambda items: [
        {
            "post_id": item.get("post_id"),
            "score": item.get("score"),
            "published_at": item.get("published_at"),
            "answer_text": item.get("answer_text"),
        }
        for item in items[:5]
    ]
    return {
        "high": trim(ordered[:5]),
        "middle": trim(middle_window),
        "low": trim(ascending[:5]),
    }


def build_aas_corpus() -> list[dict[str, Any]]:
    grouped = json.loads((SOURCE_ROOT / "抽出結果" / "aas_saigen_full" / "grouped_by_case.json").read_text(encoding="utf-8"))
    outputs = []
    for case_bundle in grouped:
        year = case_bundle["year"]
        case_no = int(case_bundle["case_no"])
        questions = []
        for question in case_bundle.get("questions", []):
            answers = question.get("answers", [])
            scores = [int(answer.get("score") or 0) for answer in answers if answer.get("score") is not None]
            answer_texts = [str(answer.get("answer_text") or "") for answer in answers]
            questions.append(
                {
                    "question_no": question.get("question_no"),
                    "points": question.get("points"),
                    "heading_text": question.get("heading_text"),
                    "answer_count": len(answers),
                    "score_stats": score_stats(scores),
                    "answer_char_stats": answer_char_stats(answer_texts),
                    "exemplars": select_exemplars(answers),
                    "answers": answers,
                }
            )
        canonical_year = canonical_year_label(year)
        payload = {
            "year_label": canonical_year,
            "case_no": case_no,
            "case_label": case_bundle.get("case"),
            "source_pdf_path": case_pdf_path(case_no, canonical_year),
            "source_pdf_blob_path": case_pdf_blob_path(case_no, canonical_year),
            "submission_count": case_bundle.get("submission_count"),
            "questions": questions,
        }
        dest = OUTPUT_ROOT / "answer_corpora" / "aas" / f"{year}_case{case_no}.json"
        write_json(dest, payload)
        outputs.append(
            {
                "year_label": canonical_year,
                "case_no": case_no,
                "submission_count": case_bundle.get("submission_count"),
                "output_path": str(dest.relative_to(OUTPUT_ROOT)),
            }
        )
    return outputs


def shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for si in root.findall("a:si", XML_NS):
        parts = [node.text or "" for node in si.iterfind(".//a:t", XML_NS)]
        strings.append("".join(parts))
    return strings


def cell_text(cell: ET.Element, strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value = cell.find("a:v", XML_NS)
    if value is not None:
        raw = value.text or ""
        if cell_type == "s" and raw.isdigit():
            index = int(raw)
            return strings[index] if index < len(strings) else raw
        return raw
    inline = cell.find("a:is", XML_NS)
    if inline is not None:
        return "".join(node.text or "" for node in inline.iterfind(".//a:t", XML_NS))
    return ""


def column_letters_to_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch.upper()) - ord("A") + 1)
    return max(0, value - 1)


def parse_xlsx_sheet(path: Path) -> dict[str, list[list[str]]]:
    with zipfile.ZipFile(path) as zf:
        strings = shared_strings(zf)
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        output: dict[str, list[list[str]]] = {}
        for sheet in workbook.find("a:sheets", XML_NS):
            name = sheet.attrib["name"]
            rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            sheet_path = "xl/" + relmap[rel_id]
            root = ET.fromstring(zf.read(sheet_path))
            rows: list[list[str]] = []
            for row in root.findall(".//a:sheetData/a:row", XML_NS):
                cell_map: dict[int, str] = {}
                max_col = -1
                for cell in row.findall("a:c", XML_NS):
                    ref = cell.attrib.get("r", "")
                    col_index = column_letters_to_index(ref)
                    cell_map[col_index] = cell_text(cell, strings).strip()
                    max_col = max(max_col, col_index)
                values = [cell_map.get(idx, "") for idx in range(max_col + 1)] if max_col >= 0 else []
                if any(values):
                    rows.append(values)
            output[name] = rows
        return output


def workbook_year_label(path: Path) -> str:
    return canonical_year_label(path.stem)


def build_fuzoroi_xlsx_corpus() -> list[dict[str, Any]]:
    outputs = []
    for path in sorted(SOURCE_ROOT.glob("*.xlsx")):
        workbook = parse_xlsx_sheet(path)
        year_label = workbook_year_label(path)
        for sheet_name, rows in workbook.items():
            if not rows:
                continue
            case_no_match = re.search(r"事例([ⅠⅡⅢⅣ])", sheet_name)
            if not case_no_match:
                continue
            case_no = CASE_ROMAN_TO_NO[case_no_match.group(1)]
            headers = list(rows[0])
            while headers and not headers[-1].strip():
                headers.pop()
            submissions = []
            for row in rows[1:]:
                row = row[: len(headers)]
                padded = row + [""] * max(0, len(headers) - len(row))
                member = padded[0] if len(padded) > 0 else ""
                total_score = padded[1] if len(padded) > 1 else ""
                answers = []
                for idx, header in enumerate(headers[2:], start=2):
                    answer_text = padded[idx] if idx < len(padded) else ""
                    if not header.strip():
                        continue
                    answers.append(
                        {
                            "column_index": idx,
                            "header": header,
                            "answer_text": answer_text,
                            "char_count": len(answer_text),
                        }
                    )
                submissions.append(
                    {
                        "member": member,
                        "total_score": int(total_score) if total_score.isdigit() else None,
                        "answers": answers,
                    }
                )
            payload = {
                "source_path": str(path),
                "year_label": year_label,
                "case_no": case_no,
                "sheet_name": sheet_name,
                "source_pdf_path": case_pdf_path(case_no, year_label),
                "source_pdf_blob_path": case_pdf_blob_path(case_no, year_label),
                "headers": headers,
                "submission_count": len(submissions),
                "score_stats": score_stats([s["total_score"] for s in submissions if s["total_score"] is not None]),
                "submissions": submissions,
            }
            dest = OUTPUT_ROOT / "answer_corpora" / "fuzoroi_xlsx" / f"{year_label}_case{case_no}.json"
            write_json(dest, payload)
            outputs.append(
                {
                    "year_label": year_label,
                    "case_no": case_no,
                    "submission_count": len(submissions),
                    "output_path": str(dest.relative_to(OUTPUT_ROOT)),
                }
            )
    return outputs


def build_source_inventory(files: list[SourceFile], pdf_text_index: list[dict[str, Any]]) -> None:
    pdf_lookup = {item["source_path"]: item for item in pdf_text_index}
    payload = []
    for item in files:
        rel = item.path.relative_to(SOURCE_ROOT)
        record = {
            "category": item.category,
            "source_path": str(item.path),
            "relative_source_path": str(rel),
            "suffix": item.path.suffix.lower(),
            "size_bytes": item.path.stat().st_size,
        }
        if str(item.path) in pdf_lookup:
            record["pdf_text"] = pdf_lookup[str(item.path)]
        payload.append(record)
    write_json(OUTPUT_ROOT / "catalog" / "source_inventory.json", payload)


def extract_pdfs(files: list[SourceFile]) -> list[dict[str, Any]]:
    outputs = []
    for item in files:
        if item.path.suffix.lower() != ".pdf":
            continue
        rel = item.path.relative_to(SOURCE_ROOT)
        dest = OUTPUT_ROOT / "source_documents" / rel.with_suffix(".json")
        outputs.append(extract_pdf_text(item.path, dest, item.category))
    return outputs


def build_reference_catalog() -> None:
    ocr_dir = SOURCE_ROOT / "★R7,R6 _TAC解説_OCR"
    ocr_items = []
    for path in sorted(ocr_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        ocr_items.append(
            {
                "source_path": str(path),
                "year_label": path.stem.replace("_page_dump", ""),
                "page_count": len(payload.get("pages", [])),
                "item_count": len(payload.get("items", [])),
            }
        )
    prompts = []
    for path in sorted(SOURCE_ROOT.glob("*プロンプト.txt")):
        prompts.append(
            {
                "source_path": str(path),
                "file_name": path.name,
                "char_count": len(path.read_text(encoding="utf-8")),
            }
        )
    write_json(
        OUTPUT_ROOT / "catalog" / "reference_catalog.json",
        {
            "ocr_sources": ocr_items,
            "prompt_files": prompts,
            "aas_summary_path": str((SOURCE_ROOT / "抽出結果" / "aas_saigen_full" / "summary.json")),
        },
    )


def build_coverage_summary(
    exam_bundle_outputs: list[dict[str, Any]],
    aas_outputs: list[dict[str, Any]],
    fuzoroi_outputs: list[dict[str, Any]],
    files: list[SourceFile],
) -> None:
    past_exam_years: dict[str, set[str]] = {"1": set(), "2": set(), "3": set(), "4": set()}
    checklist_years: dict[str, set[str]] = {"1": set(), "2": set(), "3": set(), "4": set()}
    tac_text_years: set[str] = set()
    for item in files:
        name = normalize_digits(item.path.name)
        if item.category == "past_exam_pdf":
            match = re.search(r"事例([ⅠⅡⅢⅣ])_(\d{4})\.pdf$", name)
            if match:
                case_no = {"Ⅰ": "1", "Ⅱ": "2", "Ⅲ": "3", "Ⅳ": "4"}[match.group(1)]
                past_exam_years[case_no].add(match.group(2))
        elif item.category == "answer_checklist_pdf":
            match = re.search(r"解答チェックリスト_(R\d+)年度_事例([1-4])\.pdf$", name)
            if match:
                checklist_years[match.group(2)].add(match.group(1))
        elif item.category == "tac_text_pdf":
            match = re.search(r"(R\d+)年度", name)
            if match:
                tac_text_years.add(match.group(1))
    payload = {
        "source_root": str(SOURCE_ROOT),
        "dataset_root": str(OUTPUT_ROOT),
        "past_exam_pdf_years_by_case": {case_no: sorted(years) for case_no, years in past_exam_years.items()},
        "answer_checklist_years_by_case": {case_no: sorted(years) for case_no, years in checklist_years.items()},
        "tac_text_years": sorted(tac_text_years),
        "exam_bundle_years_by_case": {
            str(case_no): sorted(item["year_label"] for item in exam_bundle_outputs if item["case_no"] == case_no)
            for case_no in [1, 2, 3, 4]
        },
        "aas_year_case_pairs": sorted(f'{item["year_label"]}_case{item["case_no"]}' for item in aas_outputs),
        "fuzoroi_xlsx_year_case_pairs": sorted(f'{item["year_label"]}_case{item["case_no"]}' for item in fuzoroi_outputs),
        "readiness_assessment": {
            "prompt_display_pdf": "ready",
            "case1_structured_scoring": "ready",
            "all_case_full_scoring": "partial",
            "reproduction_answer_corpus": "strong",
            "char_limit_detection_all_cases": "partial",
        },
    }
    write_json(OUTPUT_ROOT / "catalog" / "coverage_summary.json", payload)


def build_readme() -> None:
    text = """# Secondary Exam Dataset

このディレクトリは、中小企業診断士二次試験向け機能のために再編したローカルデータセットです。

## 目的

- Webアプリの「二次試験特化」タブ実装に向けた正本データ置き場にする
- AI採点時に必要な材料を、無駄なく構造化して保持する
- 元データが増えたときに同じ手順で再生成できるようにする

## 構成

- `catalog/`
  - `source_inventory.json`: 元ファイル一覧とカテゴリ、PDFテキスト出力先
  - `coverage_summary.json`: 年度・事例ごとの網羅状況
  - `reference_catalog.json`: OCR JSON やプロンプト素材の参照一覧
- `source_documents/`
  - 元PDFを `pdftotext -layout` で抽出し、JSONで保持したもの
- `exam_bundles/`
  - `case1/`: R1〜R7 を正規化
    - 与件文、設問、字数制限、配点、採点観点、問題PDF参照をまとめた JSON
    - 元データの `question_no` はそのまま保存しつつ、下流実装用に `question_index` / `question_key` を付与
    - 採点観点との対応は `alignment_summary.recommended_alignment_mode` を参照
    - すべての bundle に `raw_source` / `normalized_scoring_input` / `scoring_policy` を付与
  - `case2/` `case3/` `case4/`: 過去問PDFから与件文・設問文・字数制限・配点を抽出した JSON
    - `R1〜R5` は解答チェックリスト由来の `rubrics` と 2次テキスト由来の `explanations` を付与
    - `R6〜R7` は年度横断TACテキストから事例別に `explanations` を切り出し
    - `case4/` は `calculation_breakdowns` を持ち、計算手順・式・単位を分解して保持
    - `H19〜H30` は現時点で問題文 bundle のみ
- `answer_corpora/`
  - `aas/`: AAS の再現答案を 年度×事例 で整理
  - `fuzoroi_xlsx/`: 2023〜2025 のふぞろいExcelを 年度×事例 で整理

## 再生成

```bash
/opt/homebrew/bin/python3 tools/build_secondary_exam_dataset.py
```

## アプリ実装に向けた使い方

- 問題表示: `source_pdf_blob_path` を正本にし、必要時だけ `source_pdf_path` をローカル参照に使う
- 採点: `exam_bundles/` の設問・採点観点と `answer_corpora/` の再現答案を根拠パックとして利用
- AI入力: `normalized_scoring_input.question_prompt_packets` を設問単位で渡し、必要時だけ `raw_source` を参照
- 採点方針: `scoring_policy` を使って、採点とアドバイスの方針を統一
- トークン節約: まず `exemplars` や統計を使い、必要時だけ `answers` 全件を読む
"""
    write_text(OUTPUT_ROOT / "README.md", text)


def main() -> None:
    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    ensure_dir(OUTPUT_ROOT)
    files = source_files()
    pdf_text_index = extract_pdfs(files)
    case1_outputs = build_structured_case1()
    other_case_outputs = build_structured_pdf_cases()
    exam_bundle_outputs = case1_outputs + other_case_outputs
    aas_outputs = build_aas_corpus()
    fuzoroi_outputs = build_fuzoroi_xlsx_corpus()
    build_source_inventory(files, pdf_text_index)
    build_reference_catalog()
    build_coverage_summary(exam_bundle_outputs, aas_outputs, fuzoroi_outputs, files)
    build_readme()


if __name__ == "__main__":
    main()
