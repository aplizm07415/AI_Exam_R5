import copy
import datetime
import hashlib
import json
import mimetypes
import os
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from azure.storage.blob import BlobServiceClient

from .gemini_config import create_generative_model, is_gemini_available


BASE_DIR = Path(__file__).resolve().parent.parent
DATASET_DIR = BASE_DIR / "secondary_exam_dataset"
EXAM_BUNDLES_DIR = DATASET_DIR / "exam_bundles"
ANSWER_CORPORA_DIR = DATASET_DIR / "answer_corpora"
RUNTIME_DIR = BASE_DIR / "secondary_exam_runtime"
DRAFTS_DIR = RUNTIME_DIR / "drafts"
RESULTS_DIR = RUNTIME_DIR / "results"
CACHE_DIR = RUNTIME_DIR / "cache"
GRADE_CACHE_PATH = CACHE_DIR / "grade_cache.json"
SECONDARY_PDF_BLOB_PREFIX = os.getenv("SECONDARY_PDF_BLOB_PREFIX", "second-pdf-mondai")
SECONDARY_RUNTIME_BLOB_PREFIX = os.getenv("SECONDARY_RUNTIME_BLOB_PREFIX", "secondary-exam-runtime")
BLOB_CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("QUIZ_BLOB_CONTAINER", "exam-json")

router = APIRouter(prefix="/api/secondary-exam", tags=["secondary-exam"])

runtime_container_client = None
if BLOB_CONN_STR:
    try:
        blob_service_client = BlobServiceClient.from_connection_string(BLOB_CONN_STR)
        runtime_container_client = blob_service_client.get_container_client(BLOB_CONTAINER_NAME)
        if not runtime_container_client.exists():
            runtime_container_client.create_container()
    except Exception:
        runtime_container_client = None


def _ensure_runtime_dirs() -> None:
    for path in (RUNTIME_DIR, DRAFTS_DIR, RESULTS_DIR, CACHE_DIR):
        path.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read JSON: {path.name}: {exc}") from exc


def _save_json(path: Path, payload: Any) -> None:
    _ensure_runtime_dirs()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _runtime_blob_name(*parts: str) -> str:
    cleaned = [part.strip("/") for part in parts if part and part.strip("/")]
    return "/".join([SECONDARY_RUNTIME_BLOB_PREFIX, *cleaned])


def _load_runtime_json(local_path: Path, blob_name: str, default: Any = None) -> Any:
    if runtime_container_client is not None:
        blob_client = runtime_container_client.get_blob_client(blob_name)
        if not blob_client.exists():
            return default
        try:
            raw = blob_client.download_blob().readall()
            if not raw:
                return default
            return json.loads(raw)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to read blob JSON: {blob_name}: {exc}") from exc
    return _load_json(local_path, default)


def _save_runtime_json(local_path: Path, blob_name: str, payload: Any) -> None:
    if runtime_container_client is not None:
        try:
            runtime_container_client.get_blob_client(blob_name).upload_blob(
                json.dumps(payload, ensure_ascii=False, indent=2),
                overwrite=True,
            )
            return
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to save blob JSON: {blob_name}: {exc}") from exc
    _save_json(local_path, payload)


def _delete_runtime_json(local_path: Path, blob_name: str) -> None:
    if runtime_container_client is not None:
        try:
            blob_client = runtime_container_client.get_blob_client(blob_name)
            if blob_client.exists():
                blob_client.delete_blob()
            return
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to delete blob JSON: {blob_name}: {exc}") from exc
    if local_path.exists():
        local_path.unlink()


def _normalize_case_no(case_no: int | str) -> int:
    if isinstance(case_no, int):
        normalized = case_no
    else:
        digits = re.sub(r"\D+", "", str(case_no))
        if not digits:
            raise HTTPException(status_code=400, detail="Invalid case_no.")
        normalized = int(digits)
    if normalized not in {1, 2, 3, 4}:
        raise HTTPException(status_code=400, detail="case_no must be 1-4.")
    return normalized


def _normalize_year_label(year_label: str) -> str:
    label = str(year_label).strip().upper()
    if re.fullmatch(r"R\d", label):
        return f"R0{label[-1]}"
    if re.fullmatch(r"R\d{2}", label) or re.fullmatch(r"H\d{2}", label):
        return label
    raise HTTPException(status_code=400, detail="Unsupported year label.")


def _year_label_to_gregorian(year_label: str) -> Optional[int]:
    label = _normalize_year_label(year_label)
    reiwa_match = re.fullmatch(r"R(\d{2})", label)
    if reiwa_match:
        return 2018 + int(reiwa_match.group(1))
    heisei_match = re.fullmatch(r"H(\d{2})", label)
    if heisei_match:
        return 1988 + int(heisei_match.group(1))
    return None


def _default_pdf_blob_path(year_label: str, case_no: int | str) -> Optional[str]:
    gregorian = _year_label_to_gregorian(year_label)
    if gregorian is None:
        return None
    return f"{SECONDARY_PDF_BLOB_PREFIX}/case{_normalize_case_no(case_no)}_{gregorian}.pdf"


def _bundle_path(year_label: str, case_no: int | str) -> Path:
    normalized_year = _normalize_year_label(year_label)
    normalized_case = _normalize_case_no(case_no)
    case_dir = EXAM_BUNDLES_DIR / f"case{normalized_case}"
    candidates = [
        case_dir / f"{str(year_label).strip().upper()}.json",
        case_dir / f"{normalized_year}.json",
    ]
    if normalized_year.startswith("R0"):
        candidates.append(case_dir / f"R{int(normalized_year[1:])}.json")
    for path in candidates:
        if path.exists():
            return path
    raise HTTPException(status_code=404, detail="Exam bundle not found.")


def _load_bundle(year_label: str, case_no: int | str) -> dict[str, Any]:
    bundle = _load_json(_bundle_path(year_label, case_no), {})
    if not isinstance(bundle, dict):
        raise HTTPException(status_code=500, detail="Exam bundle has invalid format.")
    return _normalize_bundle_for_runtime(bundle)


def _normalize_bundle_for_runtime(bundle: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(bundle)
    scoring_input = normalized.get("normalized_scoring_input") or {}
    packets = scoring_input.get("question_prompt_packets") or []
    if not isinstance(packets, list) or not packets:
        return normalized

    expanded_packets: list[dict[str, Any]] = []
    for packet in packets:
        subquestions = packet.get("subquestions") or []
        if not isinstance(subquestions, list) or len(subquestions) <= 1:
            expanded_packets.append(packet)
            continue

        packet_max_score = packet.get("max_score")
        try:
            total_points = float(packet_max_score)
        except Exception:
            total_points = None
        allocations: list[float | None] = []
        if total_points is None:
            allocations = [None for _ in subquestions]
        else:
            base_points = round(total_points / len(subquestions), 1)
            remainder = round(total_points - (base_points * (len(subquestions) - 1)), 1)
            allocations = [base_points for _ in subquestions[:-1]] + [remainder]

        for index, subquestion in enumerate(subquestions):
            expanded_packets.append(
                {
                    **packet,
                    "question_key": subquestion.get("question_key") or packet.get("question_key"),
                    "prompt_text": subquestion.get("prompt_text") or packet.get("prompt_text"),
                    "prompt_text_clean": subquestion.get("prompt_text_clean") or packet.get("prompt_text_clean"),
                    "char_limit": subquestion.get("char_limit", packet.get("char_limit")),
                    "max_score": allocations[index] if allocations[index] is not None else subquestion.get("max_score", packet.get("max_score")),
                    "subquestion_no": subquestion.get("subquestion_no"),
                    "subquestions": [subquestion],
                }
            )

    scoring_input["question_prompt_packets"] = expanded_packets
    normalized["normalized_scoring_input"] = scoring_input
    return normalized


def _exam_id(year_label: str, case_no: int | str) -> str:
    return f"{_normalize_year_label(year_label)}_case{_normalize_case_no(case_no)}"


def _draft_path(exam_id: str) -> Path:
    return DRAFTS_DIR / f"{exam_id}.json"


def _result_path(attempt_id: str) -> Path:
    return RESULTS_DIR / f"{attempt_id}.json"


def _draft_blob_name(exam_id: str) -> str:
    return _runtime_blob_name("drafts", f"{exam_id}.json")


def _result_blob_name(attempt_id: str) -> str:
    return _runtime_blob_name("results", f"{attempt_id}.json")


def _list_result_payloads() -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    if runtime_container_client is not None:
        prefix = _runtime_blob_name("results") + "/"
        try:
            for blob in runtime_container_client.list_blobs(name_starts_with=prefix):
                if not blob.name.endswith(".json"):
                    continue
                data = _load_runtime_json(Path(blob.name), blob.name, None)
                if isinstance(data, dict):
                    payloads.append(data)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to list secondary exam results: {exc}") from exc
    else:
        _ensure_runtime_dirs()
        for path in RESULTS_DIR.glob("*.json"):
            data = _load_json(path, None)
            if isinstance(data, dict):
                payloads.append(data)
    payloads.sort(key=lambda item: str(item.get("scored_at") or ""), reverse=True)
    return payloads


def _list_results_for_exam(exam_id: str) -> list[dict[str, Any]]:
    return [item for item in _list_result_payloads() if item.get("exam_id") == exam_id]


def _get_latest_result(exam_id: str) -> Optional[dict[str, Any]]:
    results = _list_results_for_exam(exam_id)
    return results[0] if results else None


def _build_result_history_item(result: dict[str, Any]) -> dict[str, Any]:
    question_results = []
    for item in result.get("question_results") or []:
        if not isinstance(item, dict):
            continue
        question_results.append(
            {
                "question_key": item.get("question_key"),
                "question_no": item.get("question_no"),
                "subquestion_no": item.get("subquestion_no"),
                "score": item.get("score"),
                "max_score": item.get("max_score"),
                "score_percentage": item.get("score_percentage"),
                "char_count": item.get("char_count"),
                "char_limit": item.get("char_limit"),
            }
        )

    return {
        "attempt_id": result.get("attempt_id"),
        "exam_id": result.get("exam_id"),
        "year_label": result.get("year_label"),
        "case_no": result.get("case_no"),
        "overall_score": result.get("overall_score"),
        "overall_percentage": result.get("overall_percentage"),
        "total_possible_score": result.get("total_possible_score"),
        "total_questions": result.get("total_questions"),
        "answered_questions": result.get("answered_questions"),
        "scored_at": result.get("scored_at"),
        "cached": result.get("cached", False),
        "answers": result.get("answers") or {},
        "question_results": question_results,
    }


def _result_history_for_exam(exam_id: str, limit: int = 20) -> list[dict[str, Any]]:
    history = _list_results_for_exam(exam_id)
    return [_build_result_history_item(item) for item in history[:limit] if isinstance(item, dict)]


def _build_catalog_item(bundle: dict[str, Any]) -> dict[str, Any]:
    exam_id = str(bundle.get("exam_id") or _exam_id(bundle.get("year_label"), bundle.get("case_no")))
    draft = _load_runtime_json(_draft_path(exam_id), _draft_blob_name(exam_id), None)
    results = _list_results_for_exam(exam_id)
    latest_result = results[0] if results else None
    first_result = results[-1] if results else None
    best_score = max((int(item.get("overall_score") or 0) for item in results), default=None)
    first_score = first_result.get("overall_score") if isinstance(first_result, dict) else None
    draft_updated_at = draft.get("updated_at") if isinstance(draft, dict) else None
    latest_attempt_at = latest_result.get("scored_at") if isinstance(latest_result, dict) else None

    status = "not_started"
    if latest_result:
        status = "graded"
    elif draft and any((draft.get("answers") or {}).values()):
        status = "draft"

    question_units = bundle.get("question_units") or []
    return {
        "exam_id": exam_id,
        "year_label": bundle.get("year_label"),
        "case_no": bundle.get("case_no"),
        "title": f"{bundle.get('year_label')} 事例{bundle.get('case_no')}",
        "question_count": len(question_units),
        "status": status,
        "has_pdf": bool(bundle.get("source_pdf_blob_path") or bundle.get("source_pdf_path")),
        "draft_updated_at": draft_updated_at,
        "latest_attempt_at": latest_attempt_at,
        "first_score": first_score,
        "best_score": best_score,
        "attempt_count": len(results),
    }


def _bundle_catalog() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for case_dir in sorted(EXAM_BUNDLES_DIR.glob("case*")):
        for bundle_path in sorted(case_dir.glob("*.json")):
            bundle = _load_json(bundle_path, {})
            if isinstance(bundle, dict):
                items.append(_build_catalog_item(bundle))
    items.sort(key=lambda item: (str(item["year_label"]), int(item["case_no"])), reverse=True)
    return items


def _load_grade_cache() -> dict[str, str]:
    raw_cache = _load_runtime_json(GRADE_CACHE_PATH, _runtime_blob_name("cache", "grade_cache.json"), {})
    if not isinstance(raw_cache, dict):
        return {
            "exam_attempt_cache": {},
            "question_result_cache": {},
        }

    if "exam_attempt_cache" in raw_cache or "question_result_cache" in raw_cache:
        return {
            "exam_attempt_cache": raw_cache.get("exam_attempt_cache") if isinstance(raw_cache.get("exam_attempt_cache"), dict) else {},
            "question_result_cache": raw_cache.get("question_result_cache") if isinstance(raw_cache.get("question_result_cache"), dict) else {},
        }

    # Legacy shape: exam answer hash -> attempt_id
    legacy_exam_cache = {
        key: value
        for key, value in raw_cache.items()
        if isinstance(key, str) and isinstance(value, str)
    }
    return {
        "exam_attempt_cache": legacy_exam_cache,
        "question_result_cache": {},
    }


def _save_grade_cache(cache: dict[str, str]) -> None:
    _save_runtime_json(GRADE_CACHE_PATH, _runtime_blob_name("cache", "grade_cache.json"), cache)


def _packet_cache_signature(packet: dict[str, Any]) -> dict[str, Any]:
    return {
        "question_key": packet.get("question_key"),
        "question_no": packet.get("question_no"),
        "subquestion_no": packet.get("subquestion_no"),
        "max_score": packet.get("max_score"),
        "char_limit": packet.get("char_limit"),
        "prompt_text_clean": packet.get("prompt_text_clean"),
        "rubric_candidates": packet.get("rubric_candidates"),
        "explanation_candidate": packet.get("explanation_candidate"),
        "calculation_breakdown": packet.get("calculation_breakdown"),
    }


def _exam_answer_hash(exam_id: str, packets: list[dict[str, Any]], answers: dict[str, str]) -> str:
    payload = {
        "exam_id": exam_id,
        "packets": [_packet_cache_signature(packet) for packet in packets],
        "answers": answers,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _question_answer_hash(exam_id: str, packet: dict[str, Any], answer_text: str) -> str:
    payload = {
        "exam_id": exam_id,
        "packet": _packet_cache_signature(packet),
        "answer_text": answer_text,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _strip_whitespace_for_count(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def _count_answer_chars(text: str) -> int:
    return len(_strip_whitespace_for_count(text))


def _tokenize_keywords(text: str) -> list[str]:
    tokens = re.findall(r"[一-龥ぁ-んァ-ヶA-Za-z0-9]{2,}", text or "")
    stop_words = {
        "こと", "ため", "もの", "これ", "それ", "よう", "した", "する", "できる", "でき",
        "ある", "ない", "及び", "また", "および", "A社", "B社", "C社", "D社", "以内", "配点",
        "第1問", "第2問", "第3問", "第4問",
    }
    unique: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in stop_words:
            continue
        lowered = token.casefold()
        if lowered in seen:
            continue
        seen.add(lowered)
        unique.append(token)
    return unique


def _collect_reference_materials(bundle: dict[str, Any], packet: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    rubric_candidates = packet.get("rubric_candidates") or []
    explanation_candidate = packet.get("explanation_candidate")
    snippets: list[str] = []
    keywords: list[str] = []

    for rubric in rubric_candidates:
        if isinstance(rubric, dict):
            checklist_items = rubric.get("checklist_items") or []
            for item in checklist_items:
                if isinstance(item, str) and item.strip():
                    snippets.append(item.strip())
                    keywords.extend(_tokenize_keywords(item))

    if isinstance(explanation_candidate, str) and explanation_candidate.strip():
        snippets.append(explanation_candidate.strip())
        keywords.extend(_tokenize_keywords(explanation_candidate))

    calc = packet.get("calculation_breakdown")
    if isinstance(calc, dict):
        for key in ("calculation_steps", "formula_candidates", "unit_requirements", "scoring_checkpoints"):
            for item in calc.get(key) or []:
                if isinstance(item, str) and item.strip():
                    snippets.append(item.strip())
                    keywords.extend(_tokenize_keywords(item))

    question_prompt = packet.get("prompt_text_clean") or packet.get("prompt_text") or ""
    prompt_keywords = _tokenize_keywords(question_prompt)
    return snippets[:12], keywords[:40], prompt_keywords[:12]


def _question_reference_stats(year_label: str, case_no: int, question_no: Any) -> dict[str, Any]:
    normalized_year = _normalize_year_label(year_label)
    normalized_case = _normalize_case_no(case_no)
    output: dict[str, Any] = {
        "aas": None,
        "fuzoroi": None,
    }

    aas_path = ANSWER_CORPORA_DIR / "aas" / f"{normalized_year}_case{normalized_case}.json"
    aas_data = _load_json(aas_path, None)
    if isinstance(aas_data, dict):
        for item in aas_data.get("questions") or []:
            if str(item.get("question_no")) == str(question_no):
                output["aas"] = {
                    "answer_count": item.get("answer_count"),
                    "score_stats": item.get("score_stats"),
                    "answer_char_stats": item.get("answer_char_stats"),
                    "exemplars": item.get("exemplars"),
                }
                break

    fuzoroi_path = ANSWER_CORPORA_DIR / "fuzoroi_xlsx" / f"{normalized_year}_case{normalized_case}.json"
    fuzoroi_data = _load_json(fuzoroi_path, None)
    if isinstance(fuzoroi_data, dict):
        submissions = fuzoroi_data.get("submissions") or []
        output["fuzoroi"] = {
            "submission_count": fuzoroi_data.get("submission_count"),
            "score_stats": fuzoroi_data.get("score_stats"),
            "headers": fuzoroi_data.get("headers"),
            "sample_submission_keys": list(submissions[0].keys())[:10] if submissions else [],
        }

    return output


def _reference_stats_for_bundle(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    stats: list[dict[str, Any]] = []
    for packet in (bundle.get("normalized_scoring_input") or {}).get("question_prompt_packets") or []:
        question_no = packet.get("question_no")
        stats.append({
            "question_key": packet.get("question_key"),
            "question_no": question_no,
            "char_limit": packet.get("char_limit"),
            "references": _question_reference_stats(str(bundle.get("year_label")), int(bundle.get("case_no")), question_no),
        })
    return stats


def _heuristic_grade_question(bundle: dict[str, Any], packet: dict[str, Any], answer_text: str, reference_stats: dict[str, Any]) -> dict[str, Any]:
    clean_answer = (answer_text or "").strip()
    char_limit = packet.get("char_limit")
    char_count = _count_answer_chars(clean_answer)
    snippets, keywords, prompt_keywords = _collect_reference_materials(bundle, packet)

    normalized_answer = clean_answer.casefold()
    matched_keywords = [kw for kw in keywords if kw and kw.casefold() in normalized_answer]
    missing_keywords = [kw for kw in keywords if kw and kw.casefold() not in normalized_answer][:5]

    coverage_ratio = min(1.0, len(matched_keywords) / max(3, min(8, len(keywords) or 3)))
    coverage_score = int(round(coverage_ratio * 100))
    prompt_ratio = min(1.0, sum(1 for kw in prompt_keywords if kw.casefold() in normalized_answer) / max(2, len(prompt_keywords) or 2))
    prompt_score = int(round(prompt_ratio * 100))

    overall_score = int(round((coverage_score * 0.6) + (prompt_score * 0.4)))
    overall_score = max(0, min(100, overall_score))
    max_score = packet.get("max_score")
    try:
        max_score_value = float(max_score)
    except Exception:
        max_score_value = None
    earned_score = round(((max_score_value or 0) * overall_score) / 100, 1) if max_score_value is not None else round(overall_score / 100, 1)

    positives: list[str] = []
    if clean_answer:
        positives.append("設問に対して答案を作成できています。")
    if matched_keywords:
        positives.append(f"重要語を{len(matched_keywords)}件盛り込めています。")

    improvements: list[str] = []
    if not clean_answer:
        improvements.append("未入力です。まずは設問要求に直接答える骨子を1文で入れてください。")
    if missing_keywords:
        improvements.append(f"不足論点候補: {', '.join(missing_keywords[:3])}")
    if not missing_keywords and not matched_keywords and clean_answer:
        improvements.append("与件や採点観点にある具体語を、もう少し明示すると安定します。")

    advice_lines = []
    if matched_keywords:
        advice_lines.append(f"押さえられている論点: {', '.join(matched_keywords[:4])}")
    if missing_keywords:
        advice_lines.append(f"次回答案で補いたい論点: {', '.join(missing_keywords[:4])}")
    if snippets:
        advice_lines.append(f"採点根拠メモ: {snippets[0]}")
    if packet.get("calculation_breakdown"):
        advice_lines.append("事例IVでは答えだけでなく、式・単位・途中計算の明示も意識してください。")

    return {
        "question_key": packet.get("question_key"),
        "question_no": packet.get("question_no"),
        "subquestion_no": packet.get("subquestion_no"),
        "max_score": max_score_value,
        "char_limit": char_limit,
        "char_count": char_count,
        "score": earned_score,
        "score_percentage": overall_score,
        "coverage_score": coverage_score,
        "prompt_score": prompt_score,
        "positives": positives[:3],
        "improvement_points": improvements[:3],
        "advice": " ".join(advice_lines) if advice_lines else "設問要求に対応する具体語と因果を増やしてください。",
        "missing_keywords": missing_keywords[:5],
        "matched_keywords": matched_keywords[:5],
        "reference_excerpt": snippets[:2],
        "reference_stats": reference_stats,
        "used_ai": False,
    }


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if text.startswith("{"):
        return json.loads(text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])
    raise ValueError("No JSON object found in AI response.")


def _grade_question_with_ai(bundle: dict[str, Any], packet: dict[str, Any], answer_text: str, reference_stats: dict[str, Any]) -> dict[str, Any]:
    if not is_gemini_available():
        return _heuristic_grade_question(bundle, packet, answer_text, reference_stats)

    snippets, keywords, _ = _collect_reference_materials(bundle, packet)
    aas_stats = reference_stats.get("aas") or {}
    exemplars = (aas_stats.get("exemplars") or {}) if isinstance(aas_stats, dict) else {}
    compact_exemplars = {
        band: [item.get("answer_text") for item in (items or [])[:1] if isinstance(item, dict) and item.get("answer_text")]
        for band, items in exemplars.items()
    }

    prompt = f"""
あなたは中小企業診断士二次試験の採点補助官です。
以下の情報だけを根拠として、答案を論理的かつ丁寧に採点してください。

# 試験情報
- 年度: {bundle.get("year_label")}
- 事例: {bundle.get("case_no")}
- 設問キー: {packet.get("question_key")}
- 設問文: {packet.get("prompt_text_clean") or packet.get("prompt_text")}

# 採点観点候補
{json.dumps(snippets[:8], ensure_ascii=False)}

# 補助キーワード候補
{json.dumps(keywords[:12], ensure_ascii=False)}

# 参考答案サマリ
{json.dumps({
    "score_stats": aas_stats.get("score_stats"),
    "exemplars": compact_exemplars,
}, ensure_ascii=False)}

# 受験者答案
{answer_text or "(未入力)"}

# 出力ルール
- 必ずJSONオブジェクトのみを返してください。
- score, coverage_score, prompt_score は0-100の整数。
- positives と improvement_points は各3件以内。
- advice は次回答案で再現できる具体策にしてください。
- missing_keywords は不足論点候補を最大5件返してください。
- 字数や文字数制限は採点材料に含めないでください。
- 内容面を優先し、設問要求への対応、論点の充足、根拠のつながりを重視してください。

# JSONスキーマ
{{
  "score": 0,
  "coverage_score": 0,
  "prompt_score": 0,
  "positives": ["string"],
  "improvement_points": ["string"],
  "advice": "string",
  "missing_keywords": ["string"],
  "matched_keywords": ["string"]
}}
"""
    try:
        model = create_generative_model()
        response = model.generate_content(prompt)
        payload = _extract_json_object(getattr(response, "text", "") or "")
        heuristic = _heuristic_grade_question(bundle, packet, answer_text, reference_stats)
        return {
            **heuristic,
            "score": round(((heuristic.get("max_score") or 0) * max(0, min(100, int(payload.get("score", heuristic["score_percentage"])))) / 100), 1) if heuristic.get("max_score") is not None else heuristic["score"],
            "score_percentage": max(0, min(100, int(payload.get("score", heuristic["score_percentage"])))),
            "coverage_score": max(0, min(100, int(payload.get("coverage_score", heuristic["coverage_score"])))),
            "prompt_score": max(0, min(100, int(payload.get("prompt_score", heuristic["prompt_score"])))),
            "positives": [str(x) for x in (payload.get("positives") or heuristic["positives"])][:3],
            "improvement_points": [str(x) for x in (payload.get("improvement_points") or heuristic["improvement_points"])][:3],
            "advice": str(payload.get("advice") or heuristic["advice"]),
            "missing_keywords": [str(x) for x in (payload.get("missing_keywords") or heuristic["missing_keywords"])][:5],
            "matched_keywords": [str(x) for x in (payload.get("matched_keywords") or heuristic["matched_keywords"])][:5],
            "used_ai": True,
        }
    except Exception:
        return _heuristic_grade_question(bundle, packet, answer_text, reference_stats)


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _build_dashboard_payload() -> dict[str, Any]:
    catalog = _bundle_catalog()
    total = len(catalog)
    graded = sum(1 for item in catalog if item["status"] == "graded")
    draft = sum(1 for item in catalog if item["status"] == "draft")
    untouched = total - graded - draft
    results = _list_result_payloads()
    recent_attempts = [
        {
            "attempt_id": item.get("attempt_id"),
            "exam_id": item.get("exam_id"),
            "year_label": item.get("year_label"),
            "case_no": item.get("case_no"),
            "overall_score": item.get("overall_score"),
            "scored_at": item.get("scored_at"),
        }
        for item in results[:12]
    ]
    all_attempts = [
        {
            "attempt_id": item.get("attempt_id"),
            "exam_id": item.get("exam_id"),
            "year_label": item.get("year_label"),
            "case_no": item.get("case_no"),
            "overall_score": item.get("overall_score"),
            "scored_at": item.get("scored_at"),
        }
        for item in results
    ]
    best_by_case: dict[int, int] = {}
    for item in catalog:
        case_no = int(item["case_no"])
        score = item.get("best_score")
        if isinstance(score, int):
            best_by_case[case_no] = max(best_by_case.get(case_no, 0), score)
    return {
        "summary": {
            "total_exams": total,
            "graded_exams": graded,
            "draft_exams": draft,
            "untouched_exams": untouched,
        },
        "best_scores_by_case": best_by_case,
        "recent_attempts": recent_attempts,
        "all_attempts": all_attempts,
        "catalog": catalog,
    }


class SecondaryDraftRequest(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict)
    active_question_key: Optional[str] = None
    session_started: bool = False
    timer_paused: bool = False
    timer_remaining_seconds: Optional[int] = None
    timer_duration_minutes: Optional[int] = None


class SecondaryGradeRequest(BaseModel):
    year_label: str
    case_no: int
    answers: dict[str, str] = Field(default_factory=dict)


class SecondaryOralVivaTurn(BaseModel):
    role: str
    content: str


class SecondaryOralVivaRequest(BaseModel):
    year_label: str
    case_no: int
    user_message: str = Field(min_length=1, max_length=2000)
    attempt_id: Optional[str] = None
    conversation: list[SecondaryOralVivaTurn] = Field(default_factory=list)


class SecondaryOralVivaResponse(BaseModel):
    exam_id: str
    attempt_id: str
    assistant_message: str
    cited_question_keys: list[str] = Field(default_factory=list)
    suggested_followups: list[str] = Field(default_factory=list)
    used_ai: bool = False


def _sanitize_secondary_oral_viva_turns(turns: list[SecondaryOralVivaTurn]) -> list[dict[str, str]]:
    sanitized: list[dict[str, str]] = []
    for turn in turns[-12:]:
        role = "assistant" if str(turn.role).strip().lower() == "assistant" else "user"
        content = str(turn.content or "").strip()
        if not content:
            continue
        sanitized.append({
            "role": role,
            "content": content[:1200],
        })
    return sanitized


def _resolve_secondary_oral_viva_result(exam_id: str, attempt_id: Optional[str]) -> dict[str, Any]:
    if attempt_id:
        candidate = _load_runtime_json(_result_path(attempt_id), _result_blob_name(attempt_id), None)
        if not isinstance(candidate, dict):
            raise HTTPException(status_code=404, detail="Requested grading result was not found.")
        if candidate.get("exam_id") != exam_id:
            raise HTTPException(status_code=400, detail="The grading result does not belong to this exam.")
        return candidate

    latest = _get_latest_result(exam_id)
    if not isinstance(latest, dict):
        raise HTTPException(status_code=400, detail="This exam has not been graded yet.")
    return latest


def _secondary_question_context(bundle: dict[str, Any], result: dict[str, Any]) -> list[dict[str, Any]]:
    packets = (bundle.get("normalized_scoring_input") or {}).get("question_prompt_packets") or []
    result_map = {
        str(item.get("question_key")): item
        for item in (result.get("question_results") or [])
        if isinstance(item, dict) and item.get("question_key")
    }
    answers = result.get("answers") or {}
    contexts: list[dict[str, Any]] = []
    for packet in packets:
        question_key = str(packet.get("question_key") or "")
        question_result = result_map.get(question_key) or {}
        contexts.append(
            {
                "question_key": question_key,
                "prompt_text": packet.get("prompt_text_clean") or packet.get("prompt_text") or "",
                "answer_text": str(answers.get(question_key) or ""),
                "score": question_result.get("score"),
                "max_score": question_result.get("max_score"),
                "positives": question_result.get("positives") or [],
                "improvement_points": question_result.get("improvement_points") or [],
                "advice": question_result.get("advice") or "",
                "matched_keywords": question_result.get("matched_keywords") or [],
                "missing_keywords": question_result.get("missing_keywords") or [],
            }
        )
    return contexts


def _fallback_secondary_oral_viva_response(
    bundle: dict[str, Any],
    result: dict[str, Any],
    user_message: str,
) -> dict[str, Any]:
    question_contexts = _secondary_question_context(bundle, result)
    normalized_message = str(user_message or "").strip()
    cited_keys: list[str] = []
    for context in question_contexts:
        question_key = str(context.get("question_key") or "")
        if question_key and question_key.lower() in normalized_message.lower():
            cited_keys.append(question_key)
    if not cited_keys:
        weakest = sorted(
            question_contexts,
            key=lambda item: float(item.get("score") or 0),
        )
        cited_keys = [str(item.get("question_key")) for item in weakest[:2] if item.get("question_key")]

    focus_contexts = [item for item in question_contexts if str(item.get("question_key")) in cited_keys] or question_contexts[:2]
    summary_lines: list[str] = []
    for item in focus_contexts[:2]:
        prompt_text = str(item.get("prompt_text") or "")
        answer_text = str(item.get("answer_text") or "").strip() or "未回答"
        positives = [str(x) for x in (item.get("positives") or []) if str(x).strip()]
        improvements = [str(x) for x in (item.get("improvement_points") or []) if str(x).strip()]
        summary_lines.append(
            f"{item.get('question_key')}では「{prompt_text}」に対し、答案は「{answer_text[:120]}」です。"
            f" 良い点は{positives[0] if positives else 'まだ明確に拾えていません'}、"
            f"詰めたい点は{improvements[0] if improvements else '設問要求と根拠のつなぎ'}です。"
        )

    overall_summary = str((result.get("overall_feedback") or {}).get("summary") or "")
    assistant_message = (
        f"{overall_summary} "
        f"{' '.join(summary_lines)} "
        "設問横断で確認するなら、各設問で一貫している因果と、与件根拠の置き方をそろえるのが大事です。"
        " どの設問のどの主張を確かめたいかまで書いてもらえれば、さらに具体化できます。"
    ).strip()
    return {
        "assistant_message": assistant_message,
        "cited_question_keys": cited_keys[:3],
        "suggested_followups": [
            "設問1と設問2で一貫している強み・課題の置き方は？",
            "自分の答案で与件根拠が薄い設問はどれ？",
            "次に書き直すなら最優先で直す1点は？",
        ],
        "used_ai": False,
    }


def _ask_secondary_oral_viva_with_ai(
    bundle: dict[str, Any],
    result: dict[str, Any],
    user_message: str,
    conversation: list[dict[str, str]],
) -> dict[str, Any]:
    question_contexts = _secondary_question_context(bundle, result)
    transcript_lines = []
    for turn in conversation:
        role_label = "受験者" if turn["role"] == "user" else "口頭試問官"
        transcript_lines.append(f"{role_label}: {turn['content']}")
    transcript = "\n".join(transcript_lines) or "(なし)"

    prompt = f"""
あなたは中小企業診断士二次試験の採点後フォローを行う口頭試問官です。
以下は同一年度・同一事例の全設問答案と採点結果です。設問横断で整合性を見ながら、日本語で簡潔かつ実務的に回答してください。

# 試験情報
- 年度: {bundle.get("year_label")}
- 事例: {bundle.get("case_no")}
- 総合点: {result.get("overall_score")} / {result.get("total_possible_score")}
- 総評: {(result.get("overall_feedback") or {}).get("summary") or ""}
- 優先改善: {json.dumps((result.get("overall_feedback") or {}).get("priority_actions") or [], ensure_ascii=False)}

# 設問別コンテキスト
{json.dumps(question_contexts, ensure_ascii=False)}

# 既存会話
{transcript}

# 今回の受験者質問
{user_message}

# 出力ルール
- 必ずJSONオブジェクトのみを返してください。
- assistant_message は200〜500字程度で、問いに直接答えた上で、必要なら設問横断の整合ポイントを補足してください。
- cited_question_keys には関連が強い question_key を0〜3件返してください。
- suggested_followups には次に聞くと良い短い質問を3件返してください。

# JSONスキーマ
{{
  "assistant_message": "string",
  "cited_question_keys": ["q1"],
  "suggested_followups": ["string"],
  "used_ai": true
}}
"""
    model = create_generative_model()
    response = model.generate_content(prompt)
    payload = _extract_json_object(getattr(response, "text", "") or "")
    return {
        "assistant_message": str(payload.get("assistant_message") or "").strip(),
        "cited_question_keys": [str(x) for x in (payload.get("cited_question_keys") or []) if str(x).strip()][:3],
        "suggested_followups": [str(x) for x in (payload.get("suggested_followups") or []) if str(x).strip()][:3],
        "used_ai": True,
    }


@router.get("/catalog")
def get_secondary_exam_catalog():
    return {"items": _bundle_catalog()}


@router.get("/dashboard")
def get_secondary_exam_dashboard():
    return _build_dashboard_payload()


@router.get("/exams/{year_label}/{case_no}")
def get_secondary_exam_bundle(year_label: str, case_no: int):
    bundle = _load_bundle(year_label, case_no)
    exam_id = str(bundle.get("exam_id") or _exam_id(year_label, case_no))
    return {
        "exam_id": exam_id,
        "bundle": bundle,
        "pdf_url": f"/api/secondary-exam/pdfs/{_normalize_year_label(year_label)}/{_normalize_case_no(case_no)}",
        "draft": _load_runtime_json(_draft_path(exam_id), _draft_blob_name(exam_id), None),
        "latest_result": _get_latest_result(exam_id),
        "result_history": _result_history_for_exam(exam_id),
        "question_reference_stats": _reference_stats_for_bundle(bundle),
    }


@router.get("/pdfs/{year_label}/{case_no}")
def get_secondary_exam_pdf(year_label: str, case_no: int):
    bundle = _load_bundle(year_label, case_no)
    blob_name = bundle.get("source_pdf_blob_path") or _default_pdf_blob_path(str(bundle.get("year_label")), int(bundle.get("case_no")))
    if isinstance(blob_name, str) and blob_name.strip() and runtime_container_client is not None:
        blob_client = runtime_container_client.get_blob_client(blob_name)
        if blob_client.exists():
            stream = blob_client.download_blob().chunks()
            filename = Path(blob_name).name
            media_type = mimetypes.guess_type(filename)[0] or "application/pdf"
            return StreamingResponse(stream, media_type=media_type)

    source_pdf_path = bundle.get("source_pdf_path")
    if isinstance(source_pdf_path, str) and source_pdf_path.strip():
        pdf_path = Path(source_pdf_path)
        if pdf_path.exists() and pdf_path.is_file():
            media_type = mimetypes.guess_type(pdf_path.name)[0] or "application/pdf"
            return FileResponse(pdf_path, media_type=media_type, filename=pdf_path.name)
    raise HTTPException(status_code=404, detail="PDF file not found.")


@router.get("/drafts/{year_label}/{case_no}")
def get_secondary_exam_draft(year_label: str, case_no: int):
    exam_id = _exam_id(year_label, case_no)
    return _load_runtime_json(
        _draft_path(exam_id),
        _draft_blob_name(exam_id),
        {
            "answers": {},
            "active_question_key": None,
            "session_started": False,
            "timer_paused": False,
            "timer_remaining_seconds": None,
            "timer_duration_minutes": None,
        },
    )


@router.put("/drafts/{year_label}/{case_no}")
def put_secondary_exam_draft(year_label: str, case_no: int, payload: SecondaryDraftRequest):
    bundle = _load_bundle(year_label, case_no)
    exam_id = str(bundle.get("exam_id") or _exam_id(year_label, case_no))
    draft_payload = {
        "exam_id": exam_id,
        "year_label": bundle.get("year_label"),
        "case_no": bundle.get("case_no"),
        "answers": payload.answers,
        "active_question_key": payload.active_question_key,
        "session_started": payload.session_started,
        "timer_paused": payload.timer_paused,
        "timer_remaining_seconds": payload.timer_remaining_seconds,
        "timer_duration_minutes": payload.timer_duration_minutes,
        "updated_at": _now_iso(),
    }
    _save_runtime_json(_draft_path(exam_id), _draft_blob_name(exam_id), draft_payload)
    return draft_payload


@router.post("/grade")
def grade_secondary_exam(payload: SecondaryGradeRequest):
    bundle = _load_bundle(payload.year_label, payload.case_no)
    exam_id = str(bundle.get("exam_id") or _exam_id(payload.year_label, payload.case_no))
    packets = (bundle.get("normalized_scoring_input") or {}).get("question_prompt_packets") or []
    answer_key = _exam_answer_hash(exam_id, packets, payload.answers)

    cache = _load_grade_cache()
    exam_attempt_cache = cache.setdefault("exam_attempt_cache", {})
    question_result_cache = cache.setdefault("question_result_cache", {})
    cached_attempt_id = exam_attempt_cache.get(answer_key)
    if cached_attempt_id:
        cached = _load_runtime_json(_result_path(cached_attempt_id), _result_blob_name(cached_attempt_id), None)
        if isinstance(cached, dict):
            cached["cached"] = True
            return cached

    reference_stats_map = {
        item["question_key"]: item["references"]
        for item in _reference_stats_for_bundle(bundle)
        if isinstance(item, dict) and item.get("question_key")
    }

    question_results: list[dict[str, Any]] = []
    newly_graded_question_count = 0
    for packet in packets:
        question_key = str(packet.get("question_key"))
        answer_text = str(payload.answers.get(question_key) or "")
        question_answer_key = _question_answer_hash(exam_id, packet, answer_text)
        cached_question_result = question_result_cache.get(question_answer_key)
        if isinstance(cached_question_result, dict):
            question_results.append(copy.deepcopy(cached_question_result))
            continue

        question_result = _grade_question_with_ai(
            bundle,
            packet,
            answer_text,
            reference_stats_map.get(question_key) or {},
        )
        question_result_cache[question_answer_key] = copy.deepcopy(question_result)
        question_results.append(question_result)
        newly_graded_question_count += 1

    answered_questions = sum(1 for item in question_results if item["char_count"] > 0)
    total_possible_score = round(sum(float(item.get("max_score") or 0) for item in question_results), 1)
    overall_score = round(sum(float(item.get("score") or 0) for item in question_results), 1)
    overall_percentage = int(round((overall_score / total_possible_score) * 100)) if total_possible_score > 0 else 0
    weak_points = []
    for item in sorted(question_results, key=lambda row: row["score"]):
        for point in item.get("improvement_points") or []:
            if point not in weak_points:
                weak_points.append(point)
        if len(weak_points) >= 4:
            break

    result_payload = {
        "attempt_id": uuid.uuid4().hex,
        "exam_id": exam_id,
        "year_label": bundle.get("year_label"),
        "case_no": bundle.get("case_no"),
        "overall_score": overall_score,
        "overall_percentage": overall_percentage,
        "total_possible_score": total_possible_score,
        "total_questions": len(question_results),
        "answered_questions": answered_questions,
        "question_results": question_results,
        "overall_feedback": {
            "summary": "設問単位で不足論点と設問要求への対応を見直すと安定しやすい状態です。" if answered_questions else "未回答が多いため、まずは全設問に骨子レベルでも答案を入れるのが先です。",
            "priority_actions": weak_points[:4],
            "used_ai": any(item.get("used_ai") for item in question_results),
        },
        "answers": payload.answers,
        "scored_at": _now_iso(),
        "cached": False,
        "newly_graded_questions": newly_graded_question_count,
    }

    _save_runtime_json(_result_path(result_payload["attempt_id"]), _result_blob_name(result_payload["attempt_id"]), result_payload)
    _save_runtime_json(
        _draft_path(exam_id),
        _draft_blob_name(exam_id),
        {
            "exam_id": exam_id,
            "year_label": bundle.get("year_label"),
            "case_no": bundle.get("case_no"),
            "answers": payload.answers,
            "active_question_key": None,
            "session_started": False,
            "timer_paused": False,
            "timer_remaining_seconds": None,
            "timer_duration_minutes": None,
            "updated_at": result_payload["scored_at"],
            "latest_attempt_id": result_payload["attempt_id"],
        },
    )
    exam_attempt_cache[answer_key] = result_payload["attempt_id"]
    _save_grade_cache(cache)
    return result_payload


@router.post("/oral-viva", response_model=SecondaryOralVivaResponse)
def ask_secondary_exam_oral_viva(payload: SecondaryOralVivaRequest):
    bundle = _load_bundle(payload.year_label, payload.case_no)
    exam_id = str(bundle.get("exam_id") or _exam_id(payload.year_label, payload.case_no))
    result = _resolve_secondary_oral_viva_result(exam_id, payload.attempt_id)
    conversation = _sanitize_secondary_oral_viva_turns(payload.conversation)

    try:
        response_payload = (
            _ask_secondary_oral_viva_with_ai(bundle, result, payload.user_message, conversation)
            if is_gemini_available()
            else _fallback_secondary_oral_viva_response(bundle, result, payload.user_message)
        )
    except Exception:
        response_payload = _fallback_secondary_oral_viva_response(bundle, result, payload.user_message)

    assistant_message = str(response_payload.get("assistant_message") or "").strip()
    if not assistant_message:
        response_payload = _fallback_secondary_oral_viva_response(bundle, result, payload.user_message)
        assistant_message = str(response_payload.get("assistant_message") or "").strip()

    return SecondaryOralVivaResponse(
        exam_id=exam_id,
        attempt_id=str(result.get("attempt_id") or ""),
        assistant_message=assistant_message,
        cited_question_keys=[str(x) for x in (response_payload.get("cited_question_keys") or []) if str(x).strip()][:3],
        suggested_followups=[str(x) for x in (response_payload.get("suggested_followups") or []) if str(x).strip()][:3],
        used_ai=bool(response_payload.get("used_ai")),
    )


@router.get("/results/{attempt_id}")
def get_secondary_exam_result(attempt_id: str):
    data = _load_runtime_json(_result_path(attempt_id), _result_blob_name(attempt_id), None)
    if not isinstance(data, dict):
        raise HTTPException(status_code=404, detail="Result not found.")
    return data


@router.delete("/drafts/{year_label}/{case_no}", status_code=204)
def delete_secondary_exam_draft(year_label: str, case_no: int):
    exam_id = _exam_id(year_label, case_no)
    _delete_runtime_json(_draft_path(exam_id), _draft_blob_name(exam_id))
    return Response(status_code=204)
