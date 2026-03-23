import os
import json
import random
import datetime
from pathlib import Path
from fastapi import FastAPI, APIRouter, HTTPException, Query, Response, UploadFile, File, Form
from pydantic import BaseModel, Field, ValidationError # BaseModelをインポート
from typing import Literal, List, Optional
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import mimetypes
from fastapi.responses import StreamingResponse
from azure.storage.blob import BlobServiceClient
import pytz
from collections import Counter
import base64
import hmac
import hashlib
import time
import uuid
from fastapi import Request, Depends # Add Depends
import google.generativeai as genai
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials # Add for security

# --- ローカルユーティリティ ---
from .utils import normalize_question, HistoryItem, ProblemStudyStatus, get_problem_study_statuses, calculate_review_priority

# 新規追加: 日別集計の戻り値用モデル
class DailySummaryItem(BaseModel):
    date: str # YYYY-MM-DD
    total_questions: int
    correct_count: int
    accuracy: float

class GenerateKeywordsRequest(BaseModel):
    memo_text: str

class SoragakiRecordPagePayload(BaseModel):
    page: int = Field(ge=1)
    data_url: str

class SoragakiRecordCreateRequest(BaseModel):
    pages: List[SoragakiRecordPagePayload]
    learning_date: Optional[str] = None

class SoragakiRecordSummary(BaseModel):
    record_id: str
    saved_at: str
    learning_date: Optional[str] = None
    page_count: int

class PhotoItem(BaseModel):
    id: str
    display_name: str
    original_filename: str
    blob_name: str
    content_type: str
    size_bytes: int
    tags: list[str]
    uploaded_at: str
    updated_at: str
    upload_batch_id: Optional[str] = None
    upload_index: Optional[int] = None
    upload_count: Optional[int] = None

class PhotoUpdateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    tags: list[str] = Field(default_factory=list)

MuscleRecordMethod = Literal["duration", "reps_weight", "running_manual"]

class MuscleAudioItem(BaseModel):
    id: str
    display_name: str
    original_filename: str
    blob_name: str
    content_type: str
    size_bytes: int
    created_at: str
    updated_at: str

class MuscleExercise(BaseModel):
    id: str
    name: str
    record_method: MuscleRecordMethod
    body_parts: list[str]
    audio_id: Optional[str] = None
    image_id: Optional[str] = None
    is_active: bool = True
    created_at: str
    updated_at: str

class MuscleExerciseUpsertRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    record_method: MuscleRecordMethod
    body_parts: list[str] = Field(default_factory=list)
    audio_id: Optional[str] = None
    image_id: Optional[str] = None
    is_active: bool = True

class MuscleRecord(BaseModel):
    id: str
    exercise_id: str
    exercise_name: str
    record_method: MuscleRecordMethod
    performed_at: str  # ISO string (UTC)
    body_parts: list[str]
    duration_seconds: Optional[int] = None
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    distance_km: Optional[float] = None
    memo: str = ""
    created_at: str
    updated_at: str

class MuscleRecordUpsertRequest(BaseModel):
    exercise_id: str = Field(min_length=1)
    performed_at: Optional[str] = None
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    reps: Optional[int] = Field(default=None, ge=0)
    weight_kg: Optional[float] = Field(default=None, ge=0)
    distance_km: Optional[float] = Field(default=None, ge=0)
    memo: str = Field(default="", max_length=500)

# 新規追加: 不正解問題詳細の戻り値用モデル
class MissedProblemDetail(BaseModel):
    problem_id: str
    question_text: str
    category: str | None = None
    explanation: str | None = None
    miss_count: int
    correct_answer: str | None = None

class FirstMissedProblemsExportResponse(BaseModel):
    questions: list[dict]

class Period(BaseModel):
    from_field: str = Field(alias='from')
    to: str

class DailyGoal(BaseModel):
    weekday: int
    holiday: int

class Plan(BaseModel):
    id: str
    title: str
    subjectNames: list[str]
    period: Period
    dailyGoal: DailyGoal
    applyDays: Literal['all', 'weekday', 'holiday']
    minimumDaily: int = 0
    autoRedistribute: bool = True
    enabled: bool

class ProblemHistoryStatsRequest(BaseModel):
    problem_ids: list[str]
    subjects: list[str]

class AnswerStat(BaseModel):
    total: int
    correct: int

class CustomExplanation(BaseModel):
    text: str
    image_data_url: Optional[str] = None
    explanation_image_data_url: Optional[str] = None
    question_image_data_url: Optional[str] = None

class ReviewLaterUpsertRequest(BaseModel):
    subject: str
    problem_id: str

class ReviewLaterItem(BaseModel):
    subject: str
    problem_id: str
    created_at: str
    updated_at: str

class ReviewLaterProblemRef(BaseModel):
    subject: str
    problem_id: str


class ReviewLaterHistoryRegisterRequest(BaseModel):
    outcome: Literal["correct", "incorrect"]

class OfflineStudyQuestionPayload(BaseModel):
    id: str
    subject: str
    question_text: str
    choices: list[dict]
    answer: str
    explanation: dict
    category: Optional[str] = None
    image_urls: list[str] = Field(default_factory=list)
    explanation_image_urls: list[str] = Field(default_factory=list)
    custom_explanation: Optional[str] = None
    custom_explanation_image_data_url: Optional[str] = None
    custom_question_image_data_url: Optional[str] = None

class OfflineStudySubjectPayload(BaseModel):
    name: str
    questions: list[OfflineStudyQuestionPayload]

class OfflineStudyInvalidQuestionPayload(BaseModel):
    subject: str
    problem_id: str
    reason: str
    raw_question_json: str

class OfflineStudyPackageResponse(BaseModel):
    downloaded_at: str
    subjects: list[OfflineStudySubjectPayload]
    review_later: list[ReviewLaterItem]
    histories: dict[str, list[HistoryItem]]
    warnings: list[str] = Field(default_factory=list)
    invalid_questions: list[OfflineStudyInvalidQuestionPayload] = Field(default_factory=list)

class OfflineStudyQuestionUpdate(BaseModel):
    id: str
    subject: str
    question_text: str
    choices: list[dict]
    answer: str
    explanation: dict
    category: Optional[str] = None

class OfflineStudyCustomExplanationUpdate(BaseModel):
    problem_id: str
    text: str = ""
    explanation_image_data_url: Optional[str] = None
    question_image_data_url: Optional[str] = None

class OfflineStudySyncRequest(BaseModel):
    subjects: list[OfflineStudyQuestionUpdate] = Field(default_factory=list)
    custom_explanations: list[OfflineStudyCustomExplanationUpdate] = Field(default_factory=list)
    review_later_upserts: list[ReviewLaterItem] = Field(default_factory=list)
    review_later_removals: list[ReviewLaterProblemRef] = Field(default_factory=list)
    histories: dict[str, list[HistoryItem]] = Field(default_factory=dict)

class OfflineStudySyncResponse(BaseModel):
    updated_subjects: list[str]
    updated_custom_explanations: int
    updated_review_later: int
    updated_history_subjects: list[str]

class QuizStartRequest(BaseModel):
    subjects: list[str]
    count: int = 10
    mode: str = "random"
    weights: dict[str, str] | None = None

OralVivaStep = Literal["root", "refute", "apply", "summary"]

class OralVivaQuestionContext(BaseModel):
    problem_id: str
    question_text: str
    explanation_text: str = ""
    correct_answer: Optional[str] = None
    selected_answer: Optional[str] = None
    was_correct: Optional[bool] = None

class OralVivaTurn(BaseModel):
    role: Literal["assistant", "user"]
    content: str

class OralVivaStepRequest(BaseModel):
    step: OralVivaStep
    question: OralVivaQuestionContext
    conversation: list[OralVivaTurn] = Field(default_factory=list)
    user_message: str = ""

class OralVivaStepResponse(BaseModel):
    step: OralVivaStep
    assistant_message: str
    scores: dict[str, int]
    is_final_step: bool
    improvement_points: list[str] = Field(default_factory=list)
    mini_quiz_question: Optional[str] = None
    mini_quiz_answer: Optional[str] = None
    memo_summary: Optional[str] = None

class SimilarQuestionSearchResponse(BaseModel):
    topic_keywords: list[str] = Field(default_factory=list)
    quiz_set: list[dict] = Field(default_factory=list)

# --- 定数とセットアップ ---
BLOB_CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("QUIZ_BLOB_CONTAINER", "exam-json")
CUSTOM_EXPLANATIONS_DIR = "custom-explanations"
SORAGAKI_DIR = "soragaki" # Directory for Soragaki data
PHOTO_LIBRARY_DIR = "photo-library"
PHOTO_META_DIR = f"{PHOTO_LIBRARY_DIR}/meta"
PHOTO_FILES_DIR = f"{PHOTO_LIBRARY_DIR}/files"
MUSCLE_DIR = "muscle"
MUSCLE_EXERCISES_BLOB = f"{MUSCLE_DIR}/exercises.json"
MUSCLE_RECORDS_BLOB = f"{MUSCLE_DIR}/records.json"
MUSCLE_AUDIOS_META_BLOB = f"{MUSCLE_DIR}/audios/meta.json"
REVIEW_LATER_BLOB = "review-later/items.json"
MUSCLE_AUDIO_FILES_DIR = f"{MUSCLE_DIR}/audios/files"
MUSCLE_BODY_PARTS = [
    "neck",
    "chest",
    "upper_back",
    "lower_back",
    "shoulders",
    "biceps",
    "triceps",
    "forearms",
    "abs",
    "obliques",
    "glutes",
    "quads",
    "hamstrings",
    "calves",
]

# Gemini API Setup
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

# App Access Token Setup for single developer use
APP_ACCESS_TOKEN = os.getenv("APP_ACCESS_TOKEN")
SESSION_SECRET = os.getenv("SESSION_SECRET", APP_ACCESS_TOKEN or "")
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "43200"))  # 12 hours
SESSION_COOKIE_NAME = "soragaki_session"

# タイムゾーンの設定 (東京)
TOKYO_TZ = pytz.timezone("Asia/Tokyo")

# Azure Blob Storage Setup
container_client = None
if BLOB_CONN_STR:
    try:
        blob_service_client = BlobServiceClient.from_connection_string(BLOB_CONN_STR)
        container_client = blob_service_client.get_container_client(BLOB_CONTAINER_NAME)
        if not container_client.exists():
            container_client.create_container()
    except Exception as e:
        print(f"Could not connect to Azure Blob Storage: {e}")
        container_client = None

# FastAPI App Setup
app = FastAPI()
api_router = APIRouter(prefix="/api")
BASE_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = BASE_DIR / "frontend" / "dist"

# Security dependency
security_scheme = HTTPBearer()

def verify_access_token(credentials: HTTPAuthorizationCredentials = Depends(security_scheme)):
    if APP_ACCESS_TOKEN is None:
        raise HTTPException(status_code=500, detail="Server access token not configured.")
    if credentials.credentials != APP_ACCESS_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid access token.")
    return credentials.credentials


def _build_session_signature(exp: int) -> str:
    if not SESSION_SECRET:
        return ""
    payload = f"{exp}".encode("utf-8")
    return hmac.new(SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def _build_session_cookie_value() -> str:
    exp = int(time.time()) + SESSION_TTL_SECONDS
    return f"{exp}:{_build_session_signature(exp)}"


def _is_valid_session_cookie(cookie_value: Optional[str]) -> bool:
    if not cookie_value or ":" not in cookie_value or not SESSION_SECRET:
        return False

    exp_str, signature = cookie_value.split(":", 1)
    if not exp_str.isdigit():
        return False

    exp = int(exp_str)
    if exp < int(time.time()):
        return False

    expected = _build_session_signature(exp)
    return hmac.compare_digest(signature, expected)


def verify_soragaki_auth(request: Request):
    # Backward compatibility: allow existing Bearer token clients.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ") and APP_ACCESS_TOKEN is not None:
        bearer = auth_header.removeprefix("Bearer ").strip()
        if hmac.compare_digest(bearer, APP_ACCESS_TOKEN):
            return True

    session_cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if _is_valid_session_cookie(session_cookie):
        return True

    raise HTTPException(status_code=401, detail="Authentication required.")


class SessionLoginRequest(BaseModel):
    access_token: str


@api_router.post("/auth/login", status_code=204)
def auth_login(payload: SessionLoginRequest, request: Request, response: Response):
    if APP_ACCESS_TOKEN is None:
        raise HTTPException(status_code=500, detail="Server access token not configured.")
    if not hmac.compare_digest(payload.access_token, APP_ACCESS_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid access token.")

    secure_cookie = request.url.scheme == "https"
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=_build_session_cookie_value(),
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )


@api_router.get("/auth/session", status_code=204)
def auth_session(_: bool = Depends(verify_soragaki_auth)):
    return Response(status_code=204)


@api_router.post("/auth/logout", status_code=204)
def auth_logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")

# Helper to get history items for a subject
def _get_history_items_for_subject(subject_name: str) -> list[HistoryItem]:
    if container_client is None:
        return []
    subject_stem = Path(subject_name).stem
    history_blob_name = f"history/{subject_stem}.jsonl"
    history_blob_client = container_client.get_blob_client(history_blob_name)

    if not history_blob_client.exists():
        return []
    try:
        history_content = history_blob_client.download_blob().readall().decode('utf-8')
        history_lines = history_content.strip().split('\n')
        # ここでdatetime.datetime.now(datetime.timezone.utc) のデフォルト値の問題がないか確認
        # HistoryItem.model_validate_json はanswered_atがJSONにない場合、Noneを許容するようになっているはず。
        # answered_atは保存時に設定されるので、読み込み時はJSONに存在すると仮定。
        return [HistoryItem.model_validate_json(line) for line in history_lines if line]
    except Exception as e:
        print(f"Error reading history for weak area mode: {e}")
        return []


def _history_blob_name_for_subject(subject_name: str) -> str:
    subject_stem = Path(subject_name).stem
    return f"history/{subject_stem}.jsonl"


def _write_history_items_for_subject(subject_name: str, items: list[HistoryItem]) -> None:
    history_blob_name = _history_blob_name_for_subject(subject_name)
    lines = "".join(item.model_dump_json() + "\n" for item in items)
    _overwrite_blob_bytes(history_blob_name, lines.encode("utf-8"))


def _append_history_items(items: list[HistoryItem]) -> None:
    grouped_items: dict[str, list[HistoryItem]] = {}
    for item in items:
        grouped_items.setdefault(item.subject, []).append(item)

    for subject_name, next_items in grouped_items.items():
        existing_items = _get_history_items_for_subject(subject_name)
        _write_history_items_for_subject(subject_name, existing_items + next_items)

# Helper to get all questions for a subject, mapped by problem_id
def _get_all_questions_for_subject(subject_name: str) -> dict[str, dict]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    all_questions_list = []
    try:
        blob_client = container_client.get_blob_client(subject_name)
        if not blob_client.exists():
            raise HTTPException(status_code=404, detail=f"Subject '{subject_name}' not found.")
        
        raw_content = blob_client.download_blob().readall()
        data = json.loads(raw_content)
        questions_in_file = data.get("questions", []) if isinstance(data, dict) else data if isinstance(data, list) else []
        for q in questions_in_file:
            normalized_q = normalize_question(q)
            if normalized_q: all_questions_list.append(normalized_q)
    except Exception as e:
        print(f"Error reading quiz data from blob for missed problems: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read questions from blob storage: {e}")
    
    return {q.get("id"): q for q in all_questions_list if q.get("id")}


def _load_review_later_items() -> list[ReviewLaterItem]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(REVIEW_LATER_BLOB)
    if not blob_client.exists():
        return []

    try:
        payload = json.loads(blob_client.download_blob().readall())
        if not isinstance(payload, list):
            return []
        items: list[ReviewLaterItem] = []
        for raw in payload:
            if isinstance(raw, dict):
                try:
                    items.append(ReviewLaterItem.model_validate(raw))
                except Exception:
                    continue
        items.sort(key=lambda x: x.updated_at, reverse=True)
        return items
    except Exception as e:
        print(f"Error reading review-later items: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read review-later items: {e}")


def _save_review_later_items(items: list[ReviewLaterItem]) -> None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(REVIEW_LATER_BLOB)
    payload = [item.model_dump() for item in sorted(items, key=lambda x: x.updated_at, reverse=True)]
    try:
        blob_client.upload_blob(json.dumps(payload, ensure_ascii=False, indent=2), overwrite=True)
    except Exception as e:
        print(f"Error saving review-later items: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save review-later items: {e}")


def _subject_blob_payload(subject_name: str) -> tuple[bool, list[dict], dict | list]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(subject_name)
    if not blob_client.exists():
        raise HTTPException(status_code=404, detail=f"Subject '{subject_name}' not found.")

    raw_content = blob_client.download_blob().readall()
    data = json.loads(raw_content)
    is_dict_format = isinstance(data, dict) and "questions" in data
    original_questions = data.get("questions", []) if is_dict_format else data
    if not isinstance(original_questions, list):
        raise HTTPException(status_code=500, detail=f"Subject '{subject_name}' has invalid question format.")
    return is_dict_format, original_questions, data


def _write_subject_questions(subject_name: str, questions: list[dict], base_payload: dict | list, is_dict_format: bool) -> None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    if is_dict_format and isinstance(base_payload, dict):
        updated_payload = dict(base_payload)
        updated_payload["questions"] = questions
    else:
        updated_payload = questions

    container_client.get_blob_client(subject_name).upload_blob(
        json.dumps(updated_payload, ensure_ascii=False, indent=2),
        overwrite=True,
    )


def _overwrite_blob_bytes(blob_name: str, payload: bytes) -> None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(blob_name)
    try:
        if blob_client.exists():
            blob_client.delete_blob()
        blob_client.upload_blob(payload, overwrite=True)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error overwriting blob {blob_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to overwrite blob {blob_name}: {e}")


def _enrich_question_with_custom_explanation(question: dict) -> dict:
    enriched = question.copy()
    enriched['custom_explanation'] = ''
    enriched['custom_explanation_image_data_url'] = None
    enriched['custom_question_image_data_url'] = None
    try:
        problem_id = enriched.get("id")
        if problem_id and container_client:
            explanation_blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{problem_id}.json"
            explanation_blob_client = container_client.get_blob_client(explanation_blob_name)
            if explanation_blob_client.exists():
                content = explanation_blob_client.download_blob().readall()
                explanation_data = json.loads(content)
                enriched['custom_explanation'] = explanation_data.get('text', '')
                legacy_image_data_url = explanation_data.get('image_data_url')
                explanation_image_data_url = explanation_data.get('explanation_image_data_url', legacy_image_data_url)
                question_image_data_url = explanation_data.get('question_image_data_url')
                enriched['custom_explanation_image_data_url'] = explanation_image_data_url if isinstance(explanation_image_data_url, str) and explanation_image_data_url.strip() else None
                enriched['custom_question_image_data_url'] = question_image_data_url if isinstance(question_image_data_url, str) and question_image_data_url.strip() else None
    except Exception as e:
        problem_id_for_log = enriched.get('id', 'UNKNOWN')
        print(f"Error fetching custom explanation for problem {problem_id_for_log}: {e}")
    return enriched


def _prepare_question_for_client(question: dict) -> dict:
    prepared = question.copy()
    if 'image' in prepared and prepared['image']:
        if 'images' not in prepared or not isinstance(prepared['images'], list):
            prepared['images'] = []
        if isinstance(prepared['image'], str) and prepared['image'] not in prepared['images']:
            prepared['images'].insert(0, prepared['image'])

    if 'images' in prepared and isinstance(prepared['images'], list):
        prepared['image_urls'] = [f"/api/images/{img_name}" for img_name in prepared['images']]

    if (
        'explanation' in prepared and
        isinstance(prepared['explanation'], dict) and
        'images' in prepared['explanation'] and
        isinstance(prepared['explanation']['images'], list)
    ):
        prepared['explanation_image_urls'] = [f"/api/images/{img_name}" for img_name in prepared['explanation']['images']]

    return _enrich_question_with_custom_explanation(prepared)

def _photo_meta_blob_name(photo_id: str) -> str:
    return f"{PHOTO_META_DIR}/{photo_id}.json"


def _safe_photo_extension(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if not suffix:
        return ""
    if len(suffix) > 10:
        return ""
    allowed = set(".abcdefghijklmnopqrstuvwxyz0123456789")
    return suffix if all(ch in allowed for ch in suffix) else ""


def _photo_file_blob_name(photo_id: str, filename: str) -> str:
    return f"{PHOTO_FILES_DIR}/{photo_id}{_safe_photo_extension(filename)}"


def _now_utc_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _normalize_photo_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in tags:
        tag = raw.strip()
        if not tag:
            continue
        if len(tag) > 40:
            tag = tag[:40]
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(tag)
        if len(normalized) >= 20:
            break
    return normalized


def _coerce_photo_item(meta: dict) -> PhotoItem:
    return PhotoItem(
        id=str(meta["id"]),
        display_name=str(meta.get("display_name") or meta.get("original_filename") or "Untitled"),
        original_filename=str(meta.get("original_filename") or "unknown"),
        blob_name=str(meta["blob_name"]),
        content_type=str(meta.get("content_type") or "application/octet-stream"),
        size_bytes=int(meta.get("size_bytes") or 0),
        tags=_normalize_photo_tags(meta.get("tags") or []),
        uploaded_at=str(meta["uploaded_at"]),
        updated_at=str(meta.get("updated_at") or meta["uploaded_at"]),
        upload_batch_id=str(meta["upload_batch_id"]) if meta.get("upload_batch_id") is not None else None,
        upload_index=int(meta["upload_index"]) if meta.get("upload_index") is not None else None,
        upload_count=int(meta["upload_count"]) if meta.get("upload_count") is not None else None,
    )


def _load_photo_item(photo_id: str) -> PhotoItem:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    meta_blob = container_client.get_blob_client(_photo_meta_blob_name(photo_id))
    if not meta_blob.exists():
        raise HTTPException(status_code=404, detail="Photo not found.")
    try:
        payload = json.loads(meta_blob.download_blob().readall())
        return _coerce_photo_item(payload)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error reading photo metadata for {photo_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to read photo metadata.")


def _load_json_blob_or_default(blob_name: str, default):
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    blob_client = container_client.get_blob_client(blob_name)
    if not blob_client.exists():
        return default
    try:
        raw = blob_client.download_blob().readall()
        if not raw:
            return default
        return json.loads(raw)
    except Exception as e:
        print(f"Error reading json blob {blob_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read {blob_name}.")


def _save_json_blob(blob_name: str, payload) -> None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    try:
        container_client.get_blob_client(blob_name).upload_blob(
            json.dumps(payload, ensure_ascii=False, indent=2),
            overwrite=True,
        )
    except Exception as e:
        print(f"Error saving json blob {blob_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save {blob_name}.")


def _normalize_muscle_body_parts(parts: list[str]) -> list[str]:
    allowed = set(MUSCLE_BODY_PARTS)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        key = (p or "").strip()
        if key not in allowed or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _load_muscle_exercises() -> list[MuscleExercise]:
    raw = _load_json_blob_or_default(MUSCLE_EXERCISES_BLOB, [])
    exercises: list[MuscleExercise] = []
    if not isinstance(raw, list):
        return []
    for item in raw:
        try:
            exercises.append(MuscleExercise.model_validate(item))
        except Exception as e:
            print(f"Skipping invalid muscle exercise: {e}")
    return exercises


def _save_muscle_exercises(exercises: list[MuscleExercise]) -> None:
    _save_json_blob(MUSCLE_EXERCISES_BLOB, [e.model_dump() for e in exercises])


def _load_muscle_records() -> list[MuscleRecord]:
    raw = _load_json_blob_or_default(MUSCLE_RECORDS_BLOB, [])
    records: list[MuscleRecord] = []
    if not isinstance(raw, list):
        return []
    for item in raw:
        try:
            records.append(MuscleRecord.model_validate(item))
        except Exception as e:
            print(f"Skipping invalid muscle record: {e}")
    return records


def _save_muscle_records(records: list[MuscleRecord]) -> None:
    _save_json_blob(MUSCLE_RECORDS_BLOB, [r.model_dump() for r in records])


def _load_muscle_audios() -> list[MuscleAudioItem]:
    raw = _load_json_blob_or_default(MUSCLE_AUDIOS_META_BLOB, [])
    audios: list[MuscleAudioItem] = []
    if not isinstance(raw, list):
        return []
    for item in raw:
        try:
            audios.append(MuscleAudioItem.model_validate(item))
        except Exception as e:
            print(f"Skipping invalid muscle audio meta: {e}")
    return audios


def _save_muscle_audios(items: list[MuscleAudioItem]) -> None:
    _save_json_blob(MUSCLE_AUDIOS_META_BLOB, [i.model_dump() for i in items])


def _safe_audio_blob_name(audio_id: str, filename: str) -> str:
    return f"{MUSCLE_AUDIO_FILES_DIR}/{audio_id}{_safe_photo_extension(filename)}"

# --- API Routes ---
@api_router.get("/health")
def health():
    return {"status": "ok"}

PLANS_BLOB_NAME = "plans.json"

@api_router.get("/plans", response_model=list[Plan])
def get_plans():
    """Azure Blob Storageから学習計画を取得する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    
    blob_client = container_client.get_blob_client(PLANS_BLOB_NAME)
    if not blob_client.exists():
        return []
    
    try:
        downloader = blob_client.download_blob()
        data = downloader.readall()
        # Check if data is empty before parsing
        if not data:
            return []
        return json.loads(data)
    except Exception as e:
        print(f"Error reading plans from blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read plans from blob storage: {e}")

@api_router.post("/plans", status_code=204)
def save_plans(plans: list[Plan]):
    """学習計画をAzure Blob Storageに保存する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
        
    try:
        blob_client = container_client.get_blob_client(PLANS_BLOB_NAME)
        plans_data = [p.model_dump(by_alias=True) for p in plans]
        blob_client.upload_blob(json.dumps(plans_data, indent=2), overwrite=True)
    except Exception as e:
        print(f"Error saving plans to blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save plans to blob storage: {e}")


@api_router.get("/subjects")
def get_subjects():
    """Blob Storage内の科目（問題JSONファイル）リストを返す"""
    if container_client is None: return ["（Blob Storage未接続）"]
    try:
        # 科目一覧に不要な管理系JSONを含めない
        return [
            blob.name for blob in container_client.list_blobs()
            if (
                blob.name.endswith('.json') and
                '/' not in blob.name and
                not blob.name.startswith('history/') and
                not blob.name.startswith('custom-explanations/') and
                not blob.name.startswith('soragaki/') and
                not blob.name.startswith('photo-library/') and
                not blob.name.startswith('muscle/') and
                not blob.name.startswith('review-later/')
            )
        ]
    except Exception as e:
        print(f"Error fetching subjects: {e}")
        return [f"（Blob接続エラー: {e}）"]

@api_router.get("/subjects/{subject_name:path}/categories", response_model=list[str])
def get_subject_categories(subject_name: str):
    """指定された科目に含まれるカテゴリの一覧を返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    
    try:
        questions = _get_all_questions_for_subject(subject_name).values()
        categories = set()
        for q in questions:
            if q and q.get("category"):
                categories.add(q["category"])
        return sorted(list(categories))
    except HTTPException as e:
        # Re-raise HTTPException from the helper to propagate 404s etc.
        raise e
    except Exception as e:
        print(f"Error reading categories for subject {subject_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get categories for subject {subject_name}.")




@api_router.get("/images/{image_name}")
def get_image(image_name: str):
    """Blob Storageから画像を取得して配信する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    
    blob_path = f"images/{image_name}"
    blob_client = container_client.get_blob_client(blob_path)

    if not blob_client.exists():
        raise HTTPException(status_code=404, detail="Image not found.")
    
    try:
        stream = blob_client.download_blob().chunks()
        content_type, _ = mimetypes.guess_type(image_name)
        if content_type is None:
            content_type = "application/octet-stream" # デフォルト
        
        return StreamingResponse(stream, media_type=content_type)

    except Exception as e:
        print(f"Error streaming image: {e}")
        raise HTTPException(status_code=500, detail="Failed to stream image from blob storage.")


@api_router.get("/photos", response_model=List[PhotoItem])
def list_photos():
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    items: list[PhotoItem] = []
    try:
        for blob in container_client.list_blobs(name_starts_with=f"{PHOTO_META_DIR}/"):
            if not blob.name.endswith(".json"):
                continue
            meta_blob = container_client.get_blob_client(blob.name)
            try:
                meta = json.loads(meta_blob.download_blob().readall())
                items.append(_coerce_photo_item(meta))
            except Exception as e:
                print(f"Skipping unreadable photo metadata {blob.name}: {e}")
        items.sort(key=lambda x: x.updated_at, reverse=True)
        return items
    except Exception as e:
        print(f"Error listing photos: {e}")
        raise HTTPException(status_code=500, detail="Failed to list photos.")


@api_router.post("/photos", response_model=List[PhotoItem], status_code=201)
def upload_photo(
    files: List[UploadFile] = File(...),
    display_name: str = Form(...),
    tags_json: str = Form("[]"),
):
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    name = display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display_name is required.")

    try:
        raw_tags = json.loads(tags_json)
        if not isinstance(raw_tags, list):
            raise ValueError("tags_json must be a JSON array")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid tags_json: {e}")

    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required.")

    batch_id = uuid.uuid4().hex
    now_iso = _now_utc_iso()
    normalized_tags = _normalize_photo_tags([str(tag) for tag in raw_tags])
    total = len(files)
    created_items: list[PhotoItem] = []

    try:
        for index, file in enumerate(files, start=1):
            try:
                data = file.file.read()
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {e}")

            if not data:
                raise HTTPException(status_code=400, detail="Empty file is not allowed.")

            photo_id = uuid.uuid4().hex
            file_blob_name = _photo_file_blob_name(photo_id, file.filename or "")
            content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

            if total == 1:
                per_file_display_name = name[:200]
            else:
                per_file_display_name = f"{name[:180]} ({index}/{total})"

            meta = {
                "id": photo_id,
                "display_name": per_file_display_name,
                "original_filename": (file.filename or "upload.bin")[:255],
                "blob_name": file_blob_name,
                "content_type": content_type,
                "size_bytes": len(data),
                "tags": normalized_tags,
                "uploaded_at": now_iso,
                "updated_at": now_iso,
                "upload_batch_id": batch_id,
                "upload_index": index,
                "upload_count": total,
            }

            container_client.get_blob_client(file_blob_name).upload_blob(data, overwrite=False)
            container_client.get_blob_client(_photo_meta_blob_name(photo_id)).upload_blob(
                json.dumps(meta, ensure_ascii=False),
                overwrite=False,
            )
            created_items.append(_coerce_photo_item(meta))

        return created_items
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error uploading photo batch: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload photo(s): {e}")


@api_router.put("/photos/{photo_id}", response_model=PhotoItem)
def update_photo(photo_id: str, payload: PhotoUpdateRequest):
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    item = _load_photo_item(photo_id)
    updated_meta = item.model_dump()
    updated_meta["display_name"] = payload.display_name.strip()[:200]
    if not updated_meta["display_name"]:
        raise HTTPException(status_code=400, detail="display_name is required.")
    updated_meta["tags"] = _normalize_photo_tags(payload.tags)
    updated_meta["updated_at"] = _now_utc_iso()

    try:
        container_client.get_blob_client(_photo_meta_blob_name(photo_id)).upload_blob(
            json.dumps(updated_meta, ensure_ascii=False),
            overwrite=True,
        )
        return _coerce_photo_item(updated_meta)
    except Exception as e:
        print(f"Error updating photo metadata for {photo_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update photo metadata.")


@api_router.get("/photos/{photo_id}/file")
def get_photo_file(photo_id: str):
    item = _load_photo_item(photo_id)
    file_blob_client = container_client.get_blob_client(item.blob_name) if container_client else None
    if file_blob_client is None or not file_blob_client.exists():
        raise HTTPException(status_code=404, detail="Photo file not found.")

    try:
        stream = file_blob_client.download_blob().chunks()
        return StreamingResponse(stream, media_type=item.content_type)
    except Exception as e:
        print(f"Error streaming photo file for {photo_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to stream photo file.")


@api_router.get("/muscle/body-parts", response_model=List[str])
def get_muscle_body_parts():
    return MUSCLE_BODY_PARTS


@api_router.get("/muscle/exercises", response_model=List[MuscleExercise])
def list_muscle_exercises(include_inactive: bool = Query(False)):
    items = _load_muscle_exercises()
    if not include_inactive:
        items = [x for x in items if x.is_active]
    items.sort(key=lambda x: (x.name.casefold(), x.created_at))
    return items


@api_router.post("/muscle/exercises", response_model=MuscleExercise, status_code=201)
def create_muscle_exercise(payload: MuscleExerciseUpsertRequest):
    exercises = _load_muscle_exercises()
    now_iso = _now_utc_iso()
    exercise = MuscleExercise(
        id=uuid.uuid4().hex,
        name=payload.name.strip(),
        record_method=payload.record_method,
        body_parts=_normalize_muscle_body_parts(payload.body_parts),
        audio_id=payload.audio_id,
        image_id=(payload.image_id or "").strip() or None,
        is_active=payload.is_active,
        created_at=now_iso,
        updated_at=now_iso,
    )
    if exercise.record_method != "duration":
        exercise.audio_id = None
    if not exercise.name:
        raise HTTPException(status_code=400, detail="Exercise name is required.")
    exercises.append(exercise)
    _save_muscle_exercises(exercises)
    return exercise


@api_router.put("/muscle/exercises/{exercise_id}", response_model=MuscleExercise)
def update_muscle_exercise(exercise_id: str, payload: MuscleExerciseUpsertRequest):
    exercises = _load_muscle_exercises()
    idx = next((i for i, e in enumerate(exercises) if e.id == exercise_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Exercise not found.")

    old = exercises[idx]
    updated = old.model_copy(update={
        "name": payload.name.strip(),
        "record_method": payload.record_method,
        "body_parts": _normalize_muscle_body_parts(payload.body_parts),
        "audio_id": payload.audio_id if payload.record_method == "duration" else None,
        "image_id": (payload.image_id or "").strip() or None,
        "is_active": payload.is_active,
        "updated_at": _now_utc_iso(),
    })
    if not updated.name:
        raise HTTPException(status_code=400, detail="Exercise name is required.")
    exercises[idx] = updated
    _save_muscle_exercises(exercises)
    return updated


@api_router.delete("/muscle/exercises/{exercise_id}", status_code=204)
def delete_muscle_exercise(exercise_id: str):
    exercises = _load_muscle_exercises()
    new_items = [e for e in exercises if e.id != exercise_id]
    if len(new_items) == len(exercises):
        raise HTTPException(status_code=404, detail="Exercise not found.")
    _save_muscle_exercises(new_items)
    return Response(status_code=204)


@api_router.get("/muscle/records", response_model=List[MuscleRecord])
def list_muscle_records(
    limit: int = Query(200, ge=1, le=2000),
    exercise_id: Optional[str] = None,
):
    records = _load_muscle_records()
    if exercise_id:
        records = [r for r in records if r.exercise_id == exercise_id]
    records.sort(key=lambda r: r.performed_at, reverse=True)
    return records[:limit]


def _build_muscle_record(payload: MuscleRecordUpsertRequest, exercises_by_id: dict[str, MuscleExercise], record_id: Optional[str] = None, created_at: Optional[str] = None) -> MuscleRecord:
    exercise = exercises_by_id.get(payload.exercise_id)
    if exercise is None:
        raise HTTPException(status_code=400, detail="Invalid exercise_id.")

    now_iso = _now_utc_iso()
    performed_at = payload.performed_at or now_iso
    try:
        datetime.datetime.fromisoformat(performed_at.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="performed_at must be ISO datetime.")

    duration_seconds = payload.duration_seconds
    reps = payload.reps
    weight_kg = payload.weight_kg
    distance_km = payload.distance_km

    if exercise.record_method == "duration":
        if duration_seconds is None:
            raise HTTPException(status_code=400, detail="duration_seconds is required for duration exercises.")
        reps = None
        weight_kg = None
        distance_km = None
    elif exercise.record_method == "reps_weight":
        if reps is None:
            raise HTTPException(status_code=400, detail="reps is required for reps/weight exercises.")
        duration_seconds = None
        distance_km = None
    elif exercise.record_method == "running_manual":
        if distance_km is None:
            raise HTTPException(status_code=400, detail="distance_km is required for running_manual.")
        # duration optional but usually useful
        reps = None
        weight_kg = None
    else:
        raise HTTPException(status_code=400, detail="Unsupported record method.")

    return MuscleRecord(
        id=record_id or uuid.uuid4().hex,
        exercise_id=exercise.id,
        exercise_name=exercise.name,
        record_method=exercise.record_method,
        performed_at=performed_at,
        body_parts=exercise.body_parts,
        duration_seconds=duration_seconds,
        reps=reps,
        weight_kg=weight_kg,
        distance_km=distance_km,
        memo=(payload.memo or "").strip(),
        created_at=created_at or now_iso,
        updated_at=now_iso,
    )


@api_router.post("/muscle/records", response_model=MuscleRecord, status_code=201)
def create_muscle_record(payload: MuscleRecordUpsertRequest):
    exercises = _load_muscle_exercises()
    exercises_by_id = {e.id: e for e in exercises}
    record = _build_muscle_record(payload, exercises_by_id)
    records = _load_muscle_records()
    records.append(record)
    _save_muscle_records(records)
    return record


@api_router.put("/muscle/records/{record_id}", response_model=MuscleRecord)
def update_muscle_record(record_id: str, payload: MuscleRecordUpsertRequest):
    records = _load_muscle_records()
    idx = next((i for i, r in enumerate(records) if r.id == record_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Record not found.")

    exercises_by_id = {e.id: e for e in _load_muscle_exercises()}
    old = records[idx]
    updated = _build_muscle_record(payload, exercises_by_id, record_id=old.id, created_at=old.created_at)
    records[idx] = updated
    _save_muscle_records(records)
    return updated


@api_router.delete("/muscle/records/{record_id}", status_code=204)
def delete_muscle_record(record_id: str):
    records = _load_muscle_records()
    new_items = [r for r in records if r.id != record_id]
    if len(new_items) == len(records):
        raise HTTPException(status_code=404, detail="Record not found.")
    _save_muscle_records(new_items)
    return Response(status_code=204)


@api_router.get("/muscle/audios", response_model=List[MuscleAudioItem])
def list_muscle_audios():
    items = _load_muscle_audios()
    items.sort(key=lambda x: x.updated_at, reverse=True)
    return items


@api_router.post("/muscle/audios", response_model=MuscleAudioItem, status_code=201)
def upload_muscle_audio(
    file: UploadFile = File(...),
    display_name: str = Form(...),
):
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    name = display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display_name is required.")
    try:
        data = file.file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file is not allowed.")

    audio_id = uuid.uuid4().hex
    now_iso = _now_utc_iso()
    blob_name = _safe_audio_blob_name(audio_id, file.filename or "")
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    item = MuscleAudioItem(
        id=audio_id,
        display_name=name[:200],
        original_filename=(file.filename or "audio.bin")[:255],
        blob_name=blob_name,
        content_type=content_type,
        size_bytes=len(data),
        created_at=now_iso,
        updated_at=now_iso,
    )

    try:
        container_client.get_blob_client(blob_name).upload_blob(data, overwrite=False)
        items = _load_muscle_audios()
        items.append(item)
        _save_muscle_audios(items)
        return item
    except Exception as e:
        print(f"Error uploading muscle audio: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload muscle audio.")


@api_router.get("/muscle/audios/{audio_id}/file")
def get_muscle_audio_file(audio_id: str):
    items = _load_muscle_audios()
    item = next((x for x in items if x.id == audio_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Audio not found.")
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    blob_client = container_client.get_blob_client(item.blob_name)
    if not blob_client.exists():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    try:
        stream = blob_client.download_blob().chunks()
        return StreamingResponse(stream, media_type=item.content_type)
    except Exception as e:
        print(f"Error streaming muscle audio {audio_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to stream audio.")


@api_router.delete("/muscle/audios/{audio_id}", status_code=204)
def delete_muscle_audio(audio_id: str):
    items = _load_muscle_audios()
    item = next((x for x in items if x.id == audio_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Audio not found.")
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    try:
        blob_client = container_client.get_blob_client(item.blob_name)
        if blob_client.exists():
            blob_client.delete_blob()

        _save_muscle_audios([x for x in items if x.id != audio_id])

        exercises = _load_muscle_exercises()
        did_update_exercises = False
        for exercise in exercises:
            if exercise.audio_id == audio_id:
                exercise.audio_id = None
                exercise.updated_at = _now_utc_iso()
                did_update_exercises = True
        if did_update_exercises:
            _save_muscle_exercises(exercises)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting muscle audio {audio_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete muscle audio.")

@api_router.post("/soragaki/generate-keywords", response_model=List[str], dependencies=[Depends(verify_soragaki_auth)])
def generate_keywords_from_memo(request: GenerateKeywordsRequest):
    """
    Takes memo text and uses the Gemini API to extract and suggest keywords.
    """
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="Google API Key is not configured.")
    if not request.memo_text:
        return []
        
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        prompt = f"""
あなたは優秀な中小企業診断士の一次試験の専門家です。
以下のテキストは、ある一日に学習した内容のメモです。

# 学習メモ
{request.memo_text}

# 指示
- **学習メモが空の場合:**
    1. 最初に必ず「この日のMy Memoはありませんでした」という文字列を入れてください。
    2. 次に、中小企業診断士の試験において特に重要だと思われるキーワードを、分野を横断するように **3つ** 挙げてください。
    3. これらをカンマ区切りで出力してください。

- **学習メモに内容がある場合:**
    1. この学習メモから、最も重要だと思われるキーワードを **5個** 抽出してください。そのキーワードが中小企業診断士に関係しているかチェックし、不要なキーワードはお勧めキーワードに差し替えてください。
    2. 抽出した5個のキーワードを元に、知識をさらに深めるために学習すると効果的な関連キーワードを **3個** 提案してください。
    3. 最終的なアウトプットとして、抽出したキーワード5個と提案キーワード3個を合わせた、合計 **8個** のキーワードを、必ずカンマ区切りの単一の文字列で出力してください。

# 共通の指示
- 他の説明や前置きは一切不要です。必ずカンマ区切りの文字列のみを出力してください。

# 出力例
- 学習メモが空の場合:
  この日のMy Memoはありませんでした,損益分岐点分析,コーポレートガバナンス,需要の価格弾力性
- 学習メモに内容がある場合:
  マーケティング,SWOT分析,ファイブフォース分析,キャッシュフロー,労働基準法,サプライチェーンマネジメント,DX,BCP
"""
        response = model.generate_content(prompt)
        
        # Clean up the response
        keywords_str = response.text.strip()
        keywords_list = [kw.strip() for kw in keywords_str.split(',') if kw.strip()]
        
        return keywords_list

    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate keywords using Gemini API: {e}")


def _coerce_score(value, default_value: int = 50) -> int:
    try:
        as_int = int(value)
        return max(0, min(100, as_int))
    except Exception:
        return default_value


@api_router.post("/quiz/oral-viva/step", response_model=OralVivaStepResponse)
def generate_oral_viva_step(request: OralVivaStepRequest):
    """解説後に任意で実行する、1問単位の口頭試問ターンを生成する。"""
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="Google API Key is not configured.")

    step_titles = {
        "root": "根拠",
        "refute": "反証",
        "apply": "応用",
        "summary": "要約",
    }
    step_title = step_titles.get(request.step, "根拠")

    transcript_lines = []
    for turn in request.conversation:
        role = "面接官" if turn.role == "assistant" else "受験者"
        transcript_lines.append(f"{role}: {turn.content}")
    transcript = "\n".join(transcript_lines)

    prompt = f"""
あなたは中小企業診断士試験向けの厳密な口頭試問官です。
以下の問題コンテキストと会話履歴を読み、今回ターンの返答を作成してください。

# 問題コンテキスト
- 問題ID: {request.question.problem_id}
- 問題文: {request.question.question_text}
- 正解: {request.question.correct_answer or "(未指定)"}
- 受験者の選択: {request.question.selected_answer or "(未回答)"}
- 正誤: {"正解" if request.question.was_correct else "不正解"}
- 解説: {request.question.explanation_text or "(なし)"}

# 現在ステップ
- ステップ: {request.step}
- ステップ名: {step_title}
- 固定ステップ順: 根拠 -> 反証 -> 応用 -> 要約

# 既存会話
{transcript or "(なし)"}

# 今回の受験者発言
{request.user_message or "(開始時のため未入力)"}

# 出力ルール
- 出力は必ずJSONオブジェクト1つのみ。
- JSON以外のテキストを出力しない。
- 評価指標 scores は logicality/specificity/reproducibility を0〜100の整数で返す。
- is_final_step は、現在ステップが要約なら true、それ以外は false。
- 要約ステップでは improvement_points を必ず3件、mini_quiz_question/mini_quiz_answer/memo_summary も必ず埋める。
- 要約以外のステップでは improvement_points は空配列、mini_quiz_question/mini_quiz_answer/memo_summary は null。
- assistant_message は日本語で簡潔明瞭に。次に考えるべき問いを含める。

# JSONスキーマ
{{
  "assistant_message": "string",
  "scores": {{
    "logicality": 0,
    "specificity": 0,
    "reproducibility": 0
  }},
  "is_final_step": false,
  "improvement_points": [],
  "mini_quiz_question": null,
  "mini_quiz_answer": null,
  "memo_summary": null
}}
"""
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        response = model.generate_content(prompt)
        raw_text = (response.text or "").strip()

        json_text = raw_text
        if not json_text.startswith("{"):
            start = json_text.find("{")
            end = json_text.rfind("}")
            if start >= 0 and end > start:
                json_text = json_text[start:end + 1]

        payload = json.loads(json_text)
        scores_raw = payload.get("scores") or {}
        result = OralVivaStepResponse(
            step=request.step,
            assistant_message=str(payload.get("assistant_message") or "次の観点で説明してみてください。"),
            scores={
                "logicality": _coerce_score(scores_raw.get("logicality"), 50),
                "specificity": _coerce_score(scores_raw.get("specificity"), 50),
                "reproducibility": _coerce_score(scores_raw.get("reproducibility"), 50),
            },
            is_final_step=bool(payload.get("is_final_step")) or request.step == "summary",
            improvement_points=[str(x) for x in (payload.get("improvement_points") or [])][:3],
            mini_quiz_question=(str(payload.get("mini_quiz_question")) if payload.get("mini_quiz_question") else None),
            mini_quiz_answer=(str(payload.get("mini_quiz_answer")) if payload.get("mini_quiz_answer") else None),
            memo_summary=(str(payload.get("memo_summary")) if payload.get("memo_summary") else None),
        )
        if result.is_final_step and len(result.improvement_points) < 3:
            fallback_points = result.improvement_points + ["根拠を本文の事実で示す", "反証可能性を先に潰す", "応用時は条件差を明示する"]
            result.improvement_points = fallback_points[:3]
        return result
    except Exception as e:
        print(f"Error generating oral viva step: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate oral viva step: {e}")

def _validate_soragaki_date(date_str: str) -> None:
    try:
        datetime.datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")


def _page_blob_name(date_str: str, page: int) -> str:
    return f"{SORAGAKI_DIR}/{date_str}/page_{page}.png"


def _record_prefix(record_id: str) -> str:
    return f"{SORAGAKI_DIR}/records/{record_id}/"


def _record_meta_blob_name(record_id: str) -> str:
    return f"{_record_prefix(record_id)}meta.json"


def _record_page_blob_name(record_id: str, page: int) -> str:
    return f"{_record_prefix(record_id)}page_{page}.png"


def _validate_record_id(record_id: str) -> None:
    if "/" in record_id or ".." in record_id or not record_id.strip():
        raise HTTPException(status_code=400, detail="Invalid record id.")


def _decode_data_url_png(data_url: str) -> bytes:
    if "," not in data_url:
        raise HTTPException(status_code=400, detail="Invalid image payload format.")
    try:
        _, encoded = data_url.split(",", 1)
        return base64.b64decode(encoded)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image payload format.")


@api_router.get("/soragaki/records", response_model=List[SoragakiRecordSummary], dependencies=[Depends(verify_soragaki_auth)])
async def list_soragaki_records():
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    prefix = f"{SORAGAKI_DIR}/records/"
    records: List[SoragakiRecordSummary] = []

    for blob in container_client.list_blobs(name_starts_with=prefix):
        if not blob.name.endswith("/meta.json"):
            continue
        try:
            meta_blob = container_client.get_blob_client(blob.name)
            meta = json.loads(meta_blob.download_blob().readall())
            records.append(SoragakiRecordSummary(
                record_id=meta["record_id"],
                saved_at=meta["saved_at"],
                learning_date=meta.get("learning_date"),
                page_count=int(meta["page_count"]),
            ))
        except Exception:
            continue

    records.sort(key=lambda r: r.saved_at, reverse=True)
    return records


@api_router.post("/soragaki/records", response_model=SoragakiRecordSummary, status_code=201, dependencies=[Depends(verify_soragaki_auth)])
async def create_soragaki_record(payload: SoragakiRecordCreateRequest):
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    if not payload.pages:
        raise HTTPException(status_code=400, detail="At least one page is required.")

    page_numbers = [p.page for p in payload.pages]
    if len(set(page_numbers)) != len(page_numbers):
        raise HTTPException(status_code=400, detail="Duplicate page numbers are not allowed.")

    now = datetime.datetime.now(datetime.timezone.utc)
    record_id = now.strftime("%Y%m%dT%H%M%S%fZ")
    saved_at = now.isoformat().replace("+00:00", "Z")

    for page_payload in sorted(payload.pages, key=lambda p: p.page):
        data = _decode_data_url_png(page_payload.data_url)
        blob_client = container_client.get_blob_client(_record_page_blob_name(record_id, page_payload.page))
        blob_client.upload_blob(data, overwrite=False)

    meta = {
        "record_id": record_id,
        "saved_at": saved_at,
        "learning_date": payload.learning_date,
        "page_count": len(payload.pages),
    }
    meta_blob = container_client.get_blob_client(_record_meta_blob_name(record_id))
    meta_blob.upload_blob(json.dumps(meta), overwrite=False)

    return SoragakiRecordSummary(
        record_id=record_id,
        saved_at=saved_at,
        learning_date=payload.learning_date,
        page_count=len(payload.pages),
    )


@api_router.get("/soragaki/records/{record_id}/pages", response_model=List[int], dependencies=[Depends(verify_soragaki_auth)])
async def list_soragaki_record_pages(record_id: str):
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    _validate_record_id(record_id)

    page_numbers: List[int] = []
    prefix = _record_prefix(record_id)
    for blob in container_client.list_blobs(name_starts_with=prefix):
        basename = blob.name.split("/")[-1]
        if not basename.startswith("page_") or not basename.endswith(".png"):
            continue
        page_str = basename.replace("page_", "").replace(".png", "")
        if page_str.isdigit():
            page_numbers.append(int(page_str))

    if not page_numbers:
        raise HTTPException(status_code=404, detail="Record not found.")

    return sorted(page_numbers)


@api_router.get("/soragaki/records/{record_id}", dependencies=[Depends(verify_soragaki_auth)])
async def get_soragaki_record_page(record_id: str, page: int = Query(default=1, ge=1)):
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    _validate_record_id(record_id)

    page_blob_client = container_client.get_blob_client(_record_page_blob_name(record_id, page))
    if not page_blob_client.exists():
        raise HTTPException(status_code=404, detail="No Soragaki data found for this record/page.")

    try:
        stream = page_blob_client.download_blob().chunks()
        return StreamingResponse(stream, media_type="image/png")
    except Exception as e:
        print(f"Error streaming soragaki record image: {e}")
        raise HTTPException(status_code=500, detail="Failed to stream Soragaki image.")


@api_router.get("/soragaki/{date_str}/pages", response_model=List[int], dependencies=[Depends(verify_soragaki_auth)])
async def list_soragaki_pages(date_str: str):
    """Returns sorted page numbers for a date. Falls back to legacy single-file format."""
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    _validate_soragaki_date(date_str)

    page_numbers = []
    prefix = f"{SORAGAKI_DIR}/{date_str}/"
    for blob in container_client.list_blobs(name_starts_with=prefix):
        name = blob.name
        if not name.endswith(".png"):
            continue
        basename = name.split("/")[-1]
        if basename.startswith("page_"):
            page_str = basename.replace("page_", "").replace(".png", "")
            if page_str.isdigit():
                page_numbers.append(int(page_str))

    if page_numbers:
        return sorted(page_numbers)

    # Backward compatibility: old schema was soragaki/YYYY-MM-DD.png
    legacy_blob = container_client.get_blob_client(f"{SORAGAKI_DIR}/{date_str}.png")
    if legacy_blob.exists():
        return [1]

    return []


@api_router.post("/soragaki/{date_str}", status_code=204, dependencies=[Depends(verify_soragaki_auth)])
async def save_soragaki(date_str: str, request: Request, page: int = Query(default=1, ge=1)):
    """Saves Soragaki canvas image by date and page."""
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    _validate_soragaki_date(date_str)

    try:
        body = await request.body()
        data = _decode_data_url_png(body.decode("utf-8"))

        # New multi-page path
        page_blob_client = container_client.get_blob_client(_page_blob_name(date_str, page))
        if page_blob_client.exists():
            raise HTTPException(status_code=409, detail="Soragaki page is already saved and immutable.")
        page_blob_client.upload_blob(data, overwrite=False)

        # Keep legacy file in sync for page 1 to preserve old clients.
        if page == 1:
            legacy_blob_client = container_client.get_blob_client(f"{SORAGAKI_DIR}/{date_str}.png")
            if legacy_blob_client.exists():
                raise HTTPException(status_code=409, detail="Soragaki page is already saved and immutable.")
            legacy_blob_client.upload_blob(data, overwrite=False)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Error saving soragaki data to blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save soragaki data: {e}")


@api_router.get("/soragaki/{date_str}", dependencies=[Depends(verify_soragaki_auth)])
async def get_soragaki(date_str: str, page: int = Query(default=1, ge=1)):
    """Retrieves Soragaki image for a date and page."""
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    _validate_soragaki_date(date_str)

    page_blob_client = container_client.get_blob_client(_page_blob_name(date_str, page))

    # Backward compatibility for older single-page data.
    if not page_blob_client.exists() and page == 1:
        legacy_blob_client = container_client.get_blob_client(f"{SORAGAKI_DIR}/{date_str}.png")
        if legacy_blob_client.exists():
            try:
                stream = legacy_blob_client.download_blob().chunks()
                return StreamingResponse(stream, media_type="image/png")
            except Exception as e:
                print(f"Error streaming soragaki legacy image: {e}")
                raise HTTPException(status_code=500, detail="Failed to stream Soragaki image.")

    if not page_blob_client.exists():
        raise HTTPException(status_code=404, detail="No Soragaki data found for this date/page.")

    try:
        stream = page_blob_client.download_blob().chunks()
        return StreamingResponse(stream, media_type="image/png")
    except Exception as e:
        print(f"Error streaming soragaki image: {e}")
        raise HTTPException(status_code=500, detail="Failed to stream Soragaki image.")


@api_router.delete("/soragaki/{date_str}", status_code=204, dependencies=[Depends(verify_soragaki_auth)])
async def delete_soragaki(date_str: str, page: int = Query(default=1, ge=1)):
    """Soragaki pages are immutable once saved."""
    raise HTTPException(status_code=409, detail="Soragaki data is immutable and cannot be deleted.")

@api_router.get("/soragaki/memos/{date_str}", response_model=str, dependencies=[Depends(verify_soragaki_auth)])
def get_memos_for_date(date_str: str):
    """
    Aggregates and returns all 'My Memo' content for a given date.
    """
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    
    try:
        target_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    problem_ids_for_date = set()
    
    # 1. Find all history blobs
    history_blobs = container_client.list_blobs(name_starts_with="history/")
    
    # 2. Iterate through them to find relevant problem_ids
    for blob in history_blobs:
        if not blob.name.endswith(".jsonl"):
            continue
        try:
            blob_client = container_client.get_blob_client(blob.name)
            history_content = blob_client.download_blob().readall().decode('utf-8')
            history_lines = history_content.strip().split('\n')
            for line in history_lines:
                if not line: continue
                item = HistoryItem.model_validate_json(line)
                if item.answered_at.astimezone(TOKYO_TZ).date() == target_date:
                    problem_ids_for_date.add(item.problem_id)
        except Exception as e:
            print(f"Warning: Could not process history blob {blob.name}. Error: {e}")
            continue

    if not problem_ids_for_date:
        return ""

    # 3. Read custom explanations for each problem_id
    aggregated_memos = []
    for problem_id in problem_ids_for_date:
        try:
            explanation_blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{problem_id}.json"
            explanation_blob_client = container_client.get_blob_client(explanation_blob_name)
            if explanation_blob_client.exists():
                content = explanation_blob_client.download_blob().readall()
                explanation_data = json.loads(content)
                memo_text = explanation_data.get('text', '')
                if memo_text:
                    aggregated_memos.append(memo_text)
        except Exception as e:
            print(f"Warning: Could not read custom explanation for {problem_id}. Error: {e}")
            continue
            
    return "\n\n---\n\n".join(aggregated_memos)
@api_router.get("/quiz/unanswered-count")
def get_unanswered_count(subjects: list[str] = Query(...)):
    """指定された科目セットに対する未解答の問題数を計算して返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not subjects:
        return {"unanswered_count": 0}

    all_questions = []
    try:
        for subject_name in subjects:
            blob_client = container_client.get_blob_client(subject_name)
            if not blob_client.exists():
                continue
            
            raw_content = blob_client.download_blob().readall()
            data = json.loads(raw_content)
            questions_in_file = data.get("questions", []) if isinstance(data, dict) else data if isinstance(data, list) else []
            
            for q in questions_in_file:
                normalized_q = normalize_question(q)
                if normalized_q:
                    all_questions.append(normalized_q)
    except Exception as e:
        print(f"Error reading quiz data for unanswered count: {e}")
        raise HTTPException(status_code=500, detail="Failed to read questions from blob storage for count.")

    history_items = []
    for subject_name in subjects:
        history_items.extend(_get_history_items_for_subject(subject_name))
    
    answered_problem_ids = {item.problem_id for item in history_items}
    count = sum(1 for q in all_questions if q.get("id") not in answered_problem_ids)
    
    return {"unanswered_count": count}

@api_router.get("/quiz/missed-problems-count")
def get_missed_problems_count(subjects: list[str] = Query(...)):
    """指定された科目セットに対して、一度でも間違えたことがある問題のユニークな数を返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not subjects:
        return {"missed_problems_count": 0}

    history_items = []
    for subject_name in subjects:
        history_items.extend(_get_history_items_for_subject(subject_name))
    
    # is_correct: false の problem_id を set に追加してユニークにする
    missed_problem_ids = {item.problem_id for item in history_items if not item.is_correct}
    
    count = len(missed_problem_ids)
    
    return {"missed_problems_count": count}

@api_router.post("/quiz/start")
def start_quiz(request: QuizStartRequest):
    """指定された複数の科目からクイズを開始する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage は設定されていません。")
    if not request.subjects:
        raise HTTPException(status_code=400, detail="科目が選択されていません。")

    all_questions = []
    try:
        for subject_name in request.subjects:
            blob_client = container_client.get_blob_client(subject_name)
            if not blob_client.exists():
                print(f"科目 '{subject_name}' が見つかりません。スキップします。")
                continue
            
            raw_content = blob_client.download_blob().readall()
            data = json.loads(raw_content)
            questions_in_file = data.get("questions", []) if isinstance(data, dict) else data if isinstance(data, list) else []
            
            for q in questions_in_file:
                normalized_q = normalize_question(q)
                if normalized_q:
                    normalized_q['subject'] = subject_name  # 科目名を問題データに注入
                    all_questions.append(normalized_q)
    except Exception as e:
        print(f"クイズデータの読み込みエラー: {e}")
        raise HTTPException(status_code=500, detail=f"Blobストレージからの質問の読み込みに失敗しました: {e}")

    if not all_questions:
        raise HTTPException(status_code=404, detail="有効な質問がありません。")

    num_to_select = min(request.count, len(all_questions))
    selected_questions = []

    if request.mode == "weak_area":
        history_items = []
        for subject_name in request.subjects:
            history_items.extend(_get_history_items_for_subject(subject_name))
        
        problem_statuses = get_problem_study_statuses(history_items)
        
        problems_with_priority = []
        current_time = datetime.datetime.now(datetime.timezone.utc)
        for q in all_questions:
            problem_id = q.get("id")
            status = problem_statuses.get(problem_id, ProblemStudyStatus(problem_id=problem_id))
            priority = calculate_review_priority(status, current_time)
            problems_with_priority.append((q, priority))
            
        problems_with_priority.sort(key=lambda x: x[1], reverse=True)
        
        selected_questions = [q for q, _ in problems_with_priority[:num_to_select]]

    elif request.mode == "unanswered":
        history_items = []
        for subject_name in request.subjects:
            history_items.extend(_get_history_items_for_subject(subject_name))
        
        answered_problem_ids = {item.problem_id for item in history_items}
        unanswered_questions = [q for q in all_questions if q.get("id") not in answered_problem_ids]
        random.shuffle(unanswered_questions)
        selected_questions = unanswered_questions[:num_to_select]
    
    elif request.mode == "random" and request.weights:
        weight_map = {
            'light': 1,
            'normal': 3,
            'heavy': 9
        }
        
        question_weights = [weight_map.get(request.weights.get(q['subject'], 'normal'), 3) for q in all_questions]
        
        # 重複を許さずに重み付きランダムサンプリングを行う
        # まずインデックスと重みのペアを作成
        indexed_weights = list(zip(range(len(all_questions)), question_weights))
        
        selected_indices = []
        if len(all_questions) > 0 and sum(question_weights) > 0:
            # selected_indices = random.choices(range(len(all_questions)), weights=question_weights, k=num_to_select)
             # 重み付きサンプリング（重複なし）
            population = list(range(len(all_questions)))
            weights = question_weights
            
            # サンプリングする個数が母集団より大きい場合は、母集団全体を返す
            if num_to_select >= len(population):
                selected_indices = population
            else:
                while len(selected_indices) < num_to_select and len(population) > 0:
                    # random.choicesはリストを返すので、最初の要素を取得
                    chosen_index_in_pop = random.choices(range(len(population)), weights=weights, k=1)[0]
                    
                    # 実際のall_questionsでのインデックスを取得
                    original_index = population[chosen_index_in_pop]
                    selected_indices.append(original_index)
                    
                    # 選ばれた要素を次のサンプリングから除外
                    population.pop(chosen_index_in_pop)
                    weights.pop(chosen_index_in_pop)

        selected_questions = [all_questions[i] for i in selected_indices]
        random.shuffle(selected_questions) # 最終的な出題順はシャッフルする
    
    else:  # Default to random mode
        random.shuffle(all_questions)
        selected_questions = all_questions[:num_to_select]
    
    for i, q in enumerate(selected_questions):
        selected_questions[i] = _prepare_question_for_client(q)

    return {"quiz_set": selected_questions}

@api_router.post("/quiz/bulk-history-stats", response_model=dict[str, AnswerStat])
def get_bulk_history_stats(request: ProblemHistoryStatsRequest):
    """
    For a given list of problem IDs and subjects, returns the recent answer history for each problem.
    """
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    all_history_items = []
    for subject_name in request.subjects:
        all_history_items.extend(_get_history_items_for_subject(subject_name))

    # Group history by problem_id
    history_by_problem = {}
    for item in all_history_items:
        if item.problem_id in request.problem_ids:
            if item.problem_id not in history_by_problem:
                history_by_problem[item.problem_id] = []
            history_by_problem[item.problem_id].append(item)

    # Sort and slice for each problem
    stats = {}
    for problem_id, items in history_by_problem.items():
        # Sort by answered_at descending to get the most recent first
        items.sort(key=lambda x: x.answered_at, reverse=True)
        recent_items = items[:3]
        correct_count = sum(1 for item in recent_items if item.is_correct)
        stats[problem_id] = AnswerStat(total=len(recent_items), correct=correct_count)

    return stats


@api_router.post("/history")
def save_history(item: HistoryItem):
    """回答履歴を科目ごとのファイルとしてAzure Blob Storageに保存する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="History storage (Blob) is not configured.")
    try:
        _append_history_items([item])
        return {"status": "ok"}
    except Exception as e:
        print(f"ERROR saving history: {str(e)}") # コンテナログでデバッグしやすくするため
        raise HTTPException(status_code=500, detail=f"Failed to save history to blob: {e}")

@api_router.post("/history/bulk", status_code=200)
def save_history_bulk(items: list[HistoryItem]):
    """回答履歴のリストを科目ごとのファイルとしてAzure Blob Storageに一括保存する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="History storage (Blob) is not configured.")
    try:
        _append_history_items(items)
    except Exception as e:
        print(f"ERROR saving bulk history: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save bulk history: {e}")

    return {"status": "ok", "processed_items": len(items)}

def _empty_analytics_response():
    return {
        "overall_correct_rate": 0,
        "total_runs": 0,
        "daily_correct_rate_trend": {},
        "frequently_missed_categories": {},
        "total_problems_in_subject": 0,
        "unanswered_problems_count": 0,
    }


def _filter_history_items(
    history_items: list[HistoryItem],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
) -> list[HistoryItem]:
    target_history = history_items

    if start_date:
        try:
            start_dt = TOKYO_TZ.localize(datetime.datetime.strptime(start_date, "%Y-%m-%d"))
            target_history = [item for item in target_history if item.answered_at >= start_dt]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD.")

    if end_date:
        try:
            end_dt = TOKYO_TZ.localize(datetime.datetime.strptime(end_date, "%Y-%m-%d")) + datetime.timedelta(days=1)
            target_history = [item for item in target_history if item.answered_at < end_dt]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD.")

    if category:
        target_history = [item for item in target_history if item.category == category]

    return target_history


def _build_analytics_response(
    subject_names: list[str],
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
):
    if container_client is None:
        return _empty_analytics_response()

    unique_subjects: list[str] = []
    seen_subjects = set()
    for subject in subject_names:
        if subject not in seen_subjects:
            seen_subjects.add(subject)
            unique_subjects.append(subject)

    if not unique_subjects:
        return _empty_analytics_response()

    all_history_items: list[HistoryItem] = []
    answered_problem_keys = set()
    total_problems_in_subject = 0

    for subject_name in unique_subjects:
        history_items = _get_history_items_for_subject(subject_name)
        all_history_items.extend(history_items)
        for item in history_items:
            answered_problem_keys.add((subject_name, item.problem_id))

        try:
            all_questions_for_subject_map = _get_all_questions_for_subject(subject_name)
            total_problems_in_subject += len(all_questions_for_subject_map)
        except Exception as e:
            print(f"Warning: failed to read questions for analytics subject {subject_name}: {e}")

    target_history = _filter_history_items(
        all_history_items,
        start_date=start_date,
        end_date=end_date,
        category=category,
    )

    unanswered_problems_count = max(0, total_problems_in_subject - len(answered_problem_keys))

    if not target_history:
        response = _empty_analytics_response()
        response["total_problems_in_subject"] = total_problems_in_subject
        response["unanswered_problems_count"] = unanswered_problems_count
        return response

    total_runs = len(target_history)
    correct_answers = sum(1 for item in target_history if item.is_correct)
    overall_correct_rate = (correct_answers / total_runs) * 100 if total_runs > 0 else 0

    daily_trend = {}
    for item in target_history:
        day_str = item.answered_at.astimezone(TOKYO_TZ).strftime("%Y-%m-%d")
        if day_str not in daily_trend:
            daily_trend[day_str] = {"correct": 0, "total": 0}
        daily_trend[day_str]["total"] += 1
        if item.is_correct:
            daily_trend[day_str]["correct"] += 1

    daily_correct_rate_trend = {
        day: (stats["correct"] / stats["total"])
        for day, stats in daily_trend.items()
        if stats["total"] > 0
    }

    frequently_missed_categories = {}
    for item in target_history:
        if not item.is_correct and item.category:
            frequently_missed_categories[item.category] = frequently_missed_categories.get(item.category, 0) + 1

    return {
        "overall_correct_rate": overall_correct_rate,
        "total_runs": total_runs,
        "daily_correct_rate_trend": daily_correct_rate_trend,
        "frequently_missed_categories": frequently_missed_categories,
        "total_problems_in_subject": total_problems_in_subject,
        "unanswered_problems_count": unanswered_problems_count,
    }


@api_router.get("/analytics")
def get_analytics_multi(
    subjects: list[str] = Query(...),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
):
    """複数科目の統合統計情報を返す"""
    return _build_analytics_response(subjects, start_date=start_date, end_date=end_date, category=category)


@api_router.get("/analytics/{subject_name}")
def get_analytics(
    subject_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
):
    """指定された科目の統計情報を返す（後方互換）"""
    return _build_analytics_response([subject_name], start_date=start_date, end_date=end_date, category=category)

@api_router.get("/analytics/{subject_name}/missed-problems", response_model=list[MissedProblemDetail])
def get_missed_problems(subject_name: str):
    """指定された科目の不正解だった問題の詳細リストを返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    history_items = _get_history_items_for_subject(subject_name)
    all_questions = _get_all_questions_for_subject(subject_name) # problem_id -> question_dict

    missed_problem_counts = Counter()
    for item in history_items:
        if not item.is_correct:
            missed_problem_counts[item.problem_id] += 1
    
    missed_problems_details = []
    for problem_id, count in missed_problem_counts.most_common():
        question_detail = all_questions.get(problem_id)
        if question_detail:
            missed_problems_details.append(MissedProblemDetail(
                problem_id=problem_id,
                question_text=question_detail.get("question_text", "N/A"),
                category=question_detail.get("category"),
                explanation=question_detail.get("explanation"),
                miss_count=count,
                correct_answer=question_detail.get("answer") # 正解の選択肢を追加
            ))
    
    return missed_problems_details


@api_router.get("/analytics/export/first-missed-problems", response_model=FirstMissedProblemsExportResponse)
def export_first_missed_problems(subjects: list[str] = Query(...)):
    """選択科目ごとに初回解答が不正解だった問題を1つの問題JSON形式で返す。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not subjects:
        return {"questions": []}

    unique_subjects: list[str] = []
    seen_subjects = set()
    for subject in subjects:
        if subject in seen_subjects:
            continue
        seen_subjects.add(subject)
        unique_subjects.append(subject)

    export_questions: list[dict] = []
    for subject_name in unique_subjects:
        history_items = _get_history_items_for_subject(subject_name)
        if not history_items:
            continue

        first_attempt_by_problem: dict[str, HistoryItem] = {}
        for item in sorted(history_items, key=lambda x: x.answered_at):
            if item.problem_id not in first_attempt_by_problem:
                first_attempt_by_problem[item.problem_id] = item

        first_missed_problem_ids = {
            problem_id
            for problem_id, item in first_attempt_by_problem.items()
            if not item.is_correct
        }
        if not first_missed_problem_ids:
            continue

        all_questions = _get_all_questions_for_subject(subject_name)
        for problem_id in first_missed_problem_ids:
            question = all_questions.get(problem_id)
            if not question:
                continue
            export_question = question.copy()
            export_question["subject"] = subject_name
            enriched = _enrich_question_with_custom_explanation(export_question)
            export_questions.append(enriched)

    export_questions.sort(key=lambda q: (str(q.get("subject", "")), str(q.get("id", ""))))
    return {"questions": export_questions}


@api_router.get("/offline-study/package", response_model=OfflineStudyPackageResponse)
def get_offline_study_package(subjects: list[str] = Query(default_factory=list)):
    """Study専用のオフライン一括取得パッケージを返す。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    subject_names = subjects or get_subjects()
    package_subjects: list[OfflineStudySubjectPayload] = []
    histories: dict[str, list[HistoryItem]] = {}
    warnings: list[str] = []
    invalid_questions: list[OfflineStudyInvalidQuestionPayload] = []

    for subject_name in subject_names:
        try:
            questions = _get_all_questions_for_subject(subject_name)
            prepared_questions: list[OfflineStudyQuestionPayload] = []
            skipped_count = 0
            for problem_id, question in sorted(questions.items(), key=lambda item: item[0]):
                enriched = _prepare_question_for_client({**question, "subject": subject_name})
                try:
                    prepared_questions.append(OfflineStudyQuestionPayload.model_validate(enriched))
                except ValidationError as exc:
                    skipped_count += 1
                    reason = exc.errors()[0]["msg"]
                    invalid_questions.append(
                        OfflineStudyInvalidQuestionPayload(
                            subject=subject_name,
                            problem_id=str(question.get("id") or problem_id),
                            reason=reason,
                            raw_question_json=json.dumps(question, ensure_ascii=False, indent=2, sort_keys=True),
                        )
                    )
                    warnings.append(f"{subject_name}: skipped invalid problem {problem_id} ({reason})")
            if not prepared_questions:
                warnings.append(f"{subject_name}: no valid questions available for offline package")
                continue
            package_subjects.append(OfflineStudySubjectPayload(name=subject_name, questions=prepared_questions))
            histories[subject_name] = _get_history_items_for_subject(subject_name)
            if skipped_count:
                warnings.append(f"{subject_name}: skipped {skipped_count} invalid question(s)")
        except HTTPException as exc:
            warnings.append(f"{subject_name}: {exc.detail}")

    selected_subjects = {subject.name for subject in package_subjects}
    filtered_review_later = [item for item in _load_review_later_items() if item.subject in selected_subjects]

    return OfflineStudyPackageResponse(
        downloaded_at=_now_utc_iso(),
        subjects=package_subjects,
        review_later=filtered_review_later,
        histories=histories,
        warnings=warnings,
        invalid_questions=invalid_questions,
    )


@api_router.post("/offline-study/sync", response_model=OfflineStudySyncResponse)
def sync_offline_study_package(request: OfflineStudySyncRequest):
    """iPad オフライン学習データを blob へ反映する。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    updates_by_subject: dict[str, list[OfflineStudyQuestionUpdate]] = {}
    for item in request.subjects:
        updates_by_subject.setdefault(item.subject, []).append(item)

    updated_subjects: list[str] = []
    for subject_name, updates in updates_by_subject.items():
        is_dict_format, original_questions, base_payload = _subject_blob_payload(subject_name)
        updates_by_id = {item.id: item for item in updates}
        next_questions: list[dict] = []
        for question in original_questions:
            normalized_q = normalize_question(question.copy())
            existing_id = None
            if normalized_q:
                existing_id = normalized_q.get("id")
            if existing_id is None:
                existing_id = question.get("id")
            if not normalized_q:
                update = updates_by_id.get(existing_id) if existing_id else None
                if update is not None:
                    next_questions.append({
                        "id": update.id,
                        "question_text": update.question_text,
                        "choices": update.choices,
                        "answer": update.answer,
                        "explanation": update.explanation,
                        "category": update.category,
                    })
                    continue
                next_questions.append(question)
                continue
            update = updates_by_id.get(existing_id)
            if update is None:
                next_questions.append(question)
                continue
            next_questions.append({
                "id": update.id,
                "question_text": update.question_text,
                "choices": update.choices,
                "answer": update.answer,
                "explanation": update.explanation,
                "category": update.category,
            })
        _write_subject_questions(subject_name, next_questions, base_payload, is_dict_format)
        updated_subjects.append(subject_name)

    for item in request.custom_explanations:
        blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{item.problem_id}.json"
        payload = {
            "text": item.text,
            "explanation_image_data_url": item.explanation_image_data_url,
            "question_image_data_url": item.question_image_data_url,
        }
        is_empty_payload = (
            not str(item.text or "").strip()
            and not (item.explanation_image_data_url and item.explanation_image_data_url.strip())
            and not (item.question_image_data_url and item.question_image_data_url.strip())
        )
        blob_client = container_client.get_blob_client(blob_name)
        if is_empty_payload:
            if blob_client.exists():
                blob_client.delete_blob()
        else:
            blob_client.upload_blob(
                json.dumps(payload, ensure_ascii=False),
                overwrite=True,
            )

    if request.review_later_upserts or request.review_later_removals:
        existing_review_later = _load_review_later_items()
        next_items_by_id = {
            (item.subject, item.problem_id): item
            for item in existing_review_later
        }
        for item in request.review_later_upserts:
            next_items_by_id[(item.subject, item.problem_id)] = item
        for item in request.review_later_removals:
            next_items_by_id.pop((item.subject, item.problem_id), None)
        _save_review_later_items(list(next_items_by_id.values()))

    updated_history_subjects: list[str] = []
    for subject_name, items in request.histories.items():
        if not items:
            continue
        _append_history_items(items)
        updated_history_subjects.append(subject_name)

    return OfflineStudySyncResponse(
        updated_subjects=sorted(updated_subjects),
        updated_custom_explanations=len(request.custom_explanations),
        updated_review_later=len(request.review_later_upserts) + len(request.review_later_removals),
        updated_history_subjects=sorted(updated_history_subjects),
    )


@api_router.get("/subjects/{subject_name:path}/problems/{problem_id}")
def get_problem(subject_name: str, problem_id: str):
    """指定された問題を取得する"""
    questions = _get_all_questions_for_subject(subject_name)
    question = questions.get(problem_id)
    if not question:
        raise HTTPException(status_code=404, detail="Problem not found.")
    return _enrich_question_with_custom_explanation(question)


@api_router.get("/review-later")
def get_review_later():
    """後で振り返る問題の一覧を返す"""
    items = _load_review_later_items()
    response_items: list[dict] = []
    for item in items:
        question_payload = None
        error_detail = None
        try:
            questions = _get_all_questions_for_subject(item.subject)
            question = questions.get(item.problem_id)
            if question:
                question_payload = _enrich_question_with_custom_explanation(question)
        except HTTPException as e:
            error_detail = e.detail
        except Exception as e:
            error_detail = str(e)

        response_items.append({
            "subject": item.subject,
            "problem_id": item.problem_id,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
            "question": question_payload,
            "error": error_detail,
        })
    return response_items


def _extract_candidate_terms(text: str) -> list[str]:
    raw_tokens = []
    separators = " \n\t\r,。、「」()（）[]{}:：;；!?！？/\\|+-=*\"'`"
    token = []
    for ch in text:
        if ch in separators:
            if token:
                raw_tokens.append("".join(token))
                token = []
        else:
            token.append(ch)
    if token:
        raw_tokens.append("".join(token))

    filtered: list[str] = []
    seen = set()
    for t in raw_tokens:
        term = t.strip().lower()
        if len(term) < 2:
            continue
        if term in seen:
            continue
        seen.add(term)
        filtered.append(term)
        if len(filtered) >= 40:
            break
    return filtered


def _score_question_by_terms(question: dict, terms: list[str]) -> int:
    target_text = " ".join([
        str(question.get("question_text") or ""),
        str(question.get("category") or ""),
        str((question.get("explanation") or {}).get("text") if isinstance(question.get("explanation"), dict) else ""),
    ]).lower()
    score = 0
    for term in terms:
        if term in target_text:
            score += 1
    return score


@api_router.get("/review-later/{subject_name:path}/{problem_id}/similar", response_model=SimilarQuestionSearchResponse)
def get_similar_questions_for_review_later(subject_name: str, problem_id: str, count: int = Query(default=5, ge=1, le=20)):
    """後で確認問題からトピックをAI抽出し、同一科目内の類題を返す。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="Google API Key is not configured.")

    questions = _get_all_questions_for_subject(subject_name)
    base_question = questions.get(problem_id)
    if not base_question:
        raise HTTPException(status_code=404, detail="Base problem not found.")

    enriched_base = _prepare_question_for_client(base_question)
    base_text = "\n".join([
        str(enriched_base.get("question_text") or ""),
        str((enriched_base.get("explanation") or {}).get("text") if isinstance(enriched_base.get("explanation"), dict) else ""),
        str(enriched_base.get("custom_explanation") or ""),
    ])

    prompt = f"""
以下の問題テキストから、同一科目内の類題検索に使えるトピックキーワードを6個抽出してください。
出力は「カンマ区切り1行」のみ。

# 問題テキスト
{base_text}
"""
    topic_keywords: list[str] = []
    try:
        model = genai.GenerativeModel('gemini-3-flash-preview')
        response = model.generate_content(prompt)
        keyword_line = (response.text or "").strip()
        topic_keywords = [k.strip().lower() for k in keyword_line.split(",") if k.strip()]
    except Exception as e:
        print(f"Error extracting topic keywords for similar questions: {e}")

    if not topic_keywords:
        topic_keywords = _extract_candidate_terms(base_text)[:6]

    candidates = []
    for qid, q in questions.items():
        if qid == problem_id:
            continue
        score = _score_question_by_terms(q, topic_keywords)
        if score <= 0:
            continue
        candidates.append((score, q))

    candidates.sort(key=lambda x: x[0], reverse=True)
    selected = [q for _, q in candidates[:count]]
    quiz_set = []
    for q in selected:
        q_with_subject = q.copy()
        q_with_subject["subject"] = subject_name
        quiz_set.append(_prepare_question_for_client(q_with_subject))

    return SimilarQuestionSearchResponse(
        topic_keywords=topic_keywords[:8],
        quiz_set=quiz_set,
    )


@api_router.post("/review-later", status_code=204)
def save_review_later(item: ReviewLaterUpsertRequest):
    """後で振り返る問題を登録する"""
    items = _load_review_later_items()
    now = _now_utc_iso()
    existing = next((x for x in items if x.subject == item.subject and x.problem_id == item.problem_id), None)
    if existing:
        existing.updated_at = now
    else:
        items.append(
            ReviewLaterItem(
                subject=item.subject,
                problem_id=item.problem_id,
                created_at=now,
                updated_at=now,
            )
        )
    _save_review_later_items(items)


@api_router.delete("/review-later/{problem_id}", status_code=204)
def delete_review_later(problem_id: str, subject: str):
    """後で振り返る問題を解除する"""
    items = _load_review_later_items()
    filtered = [x for x in items if not (x.subject == subject and x.problem_id == problem_id)]
    if len(filtered) != len(items):
        _save_review_later_items(filtered)


@api_router.post("/review-later/{subject_name:path}/{problem_id}/register-history", status_code=204)
def register_review_later_history(subject_name: str, problem_id: str, payload: ReviewLaterHistoryRegisterRequest):
    """後で確認問題に対して実績を1件追加し、登録状態を解除する。"""
    questions = _get_all_questions_for_subject(subject_name)
    question = questions.get(problem_id)
    if not question:
        raise HTTPException(status_code=404, detail="Problem not found.")

    normalized = normalize_question(question.copy())
    if not normalized:
        raise HTTPException(status_code=500, detail="Problem format is invalid.")

    answer = str(normalized.get("answer") or "")
    choices = normalized.get("choices") or []
    selected_answer = answer
    is_correct = payload.outcome == "correct"
    if not is_correct:
        wrong_choice = next(
            (
                str(choice.get("label"))
                for choice in choices
                if isinstance(choice, dict) and str(choice.get("label") or "") and str(choice.get("label")) != answer
            ),
            None,
        )
        selected_answer = wrong_choice or "__review_later_manual_incorrect__"

    history_item = HistoryItem(
        problem_id=problem_id,
        subject=subject_name,
        selected_answer=selected_answer,
        is_correct=is_correct,
        answered_at=datetime.datetime.now(datetime.timezone.utc),
        category=normalized.get("category"),
    )
    _append_history_items([history_item])

    items = _load_review_later_items()
    filtered = [x for x in items if not (x.subject == subject_name and x.problem_id == problem_id)]
    if len(filtered) != len(items):
        _save_review_later_items(filtered)

@api_router.post("/problems/{problem_id}/custom-explanation", status_code=204)
def save_custom_explanation(problem_id: str, explanation: CustomExplanation):
    """Saves a user's custom explanation for a problem."""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
        
    try:
        explanation_image_data_url = explanation.explanation_image_data_url
        if not explanation_image_data_url and explanation.image_data_url:
            explanation_image_data_url = explanation.image_data_url

        normalized_payload = {
            "text": explanation.text,
            "explanation_image_data_url": explanation_image_data_url,
            "question_image_data_url": explanation.question_image_data_url,
        }
        blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{problem_id}.json"
        blob_client = container_client.get_blob_client(blob_name)
        blob_client.upload_blob(json.dumps(normalized_payload, ensure_ascii=False), overwrite=True)
    except Exception as e:
        print(f"Error saving custom explanation to blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save custom explanation to blob storage: {e}")


@api_router.put("/subjects/{subject_name:path}/problems/{problem_id}")
def update_problem(subject_name: str, problem_id: str, problem_data: dict):
    """特定の問題IDの問題データを更新する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    try:
        blob_client = container_client.get_blob_client(subject_name)
        if not blob_client.exists():
            raise HTTPException(status_code=404, detail=f"Subject '{subject_name}' not found.")
        
        raw_content = blob_client.download_blob().readall()
        data = json.loads(raw_content)
        
        is_dict_format = isinstance(data, dict) and "questions" in data
        original_questions = data.get("questions", []) if is_dict_format else data

        target_index = -1
        # IDの正規化を考慮して目的の問題を探す
        for i, q in enumerate(original_questions):
            # normalize_questionは元の辞書を変更する可能性があるのでコピーを渡す
            normalized_q = normalize_question(q.copy())
            if normalized_q and normalized_q.get("id") == problem_id:
                target_index = i
                break
        
        if target_index == -1:
            raise HTTPException(status_code=404, detail=f"Problem with ID '{problem_id}' not found in '{subject_name}'.")

        # 元の問題データに、受け取ったデータで更新をかける
        # これにより、フロント側は変更したいフィールドだけを送ればよくなる
        original_questions[target_index].update(problem_data)
        
        # ファイル全体を上書き
        output_data = {"questions": original_questions} if is_dict_format else original_questions
        blob_client.upload_blob(json.dumps(output_data, indent=2, ensure_ascii=False), overwrite=True)

        # 更新後の完全な問題オブジェクトを返す
        return original_questions[target_index]
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR updating problem: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update problem: {e}")


class SubjectProgress(BaseModel):
    total_problems: int
    answered_problems: int
    correctly_answered_once: int
    unanswered_problems: int

@api_router.get("/progress/subjects", response_model=dict[str, SubjectProgress])
def get_subjects_progress(subject_names: list[str] = Query(...)):
    """指定された複数の科目の進捗状況（解答済み、未解答など）を返す"""
    if not container_client:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not subject_names:
        return {}

    progress_data = {}

    for subject_name in subject_names:
        try:
            # 1. 科目の全問題を取得
            all_questions = _get_all_questions_for_subject(subject_name)
            total_problems = len(all_questions)
            all_problem_ids = set(all_questions.keys())

            if total_problems == 0:
                progress_data[subject_name] = SubjectProgress(
                    total_problems=0,
                    answered_problems=0,
                    correctly_answered_once=0,
                    unanswered_problems=0
                )
                continue

            # 2. 科目の回答履歴を取得
            history_items = _get_history_items_for_subject(subject_name)

            answered_problem_ids = set()
            correctly_answered_ids = set()

            for item in history_items:
                if item.problem_id in all_problem_ids:
                    answered_problem_ids.add(item.problem_id)
                    if item.is_correct:
                        correctly_answered_ids.add(item.problem_id)
            
            unanswered_problems = total_problems - len(answered_problem_ids)

            progress_data[subject_name] = SubjectProgress(
                total_problems=total_problems,
                answered_problems=len(answered_problem_ids),
                correctly_answered_once=len(correctly_answered_ids),
                unanswered_problems=unanswered_problems
            )

        except Exception as e:
            print(f"Error processing progress for subject {subject_name}: {e}")
            # エラーが発生した科目はスキップするか、エラー情報を返すか
            # ここでは簡単のためスキップ
            continue
            
    return progress_data

# --- 新規追加: 日別集計API ---
@api_router.get("/history/daily-summary/all", response_model=list[DailySummaryItem])
def get_all_daily_summaries(subjects: Optional[List[str]] = Query(None)):
    """すべての科目の履歴、または指定された科目の履歴を読み込み、直近14日間の日付ごとに集計した統合サマリーを返す"""
    if container_client is None:
        return []

    all_history_items = []
    
    blob_names_to_scan = []
    if subjects:
        # subjectsが指定されている場合は、それに対応するblob名だけをスキャン対象にする
        blob_names_to_scan = [f"history/{Path(s).stem}.jsonl" for s in subjects]
    else:
        # 指定がない場合は、従来通りhistory/以下の全blobをスキャン
        history_blobs = container_client.list_blobs(name_starts_with="history/")
        blob_names_to_scan = [blob.name for blob in history_blobs if blob.name.endswith(".jsonl")]

    try:
        for blob_name in blob_names_to_scan:
            blob_client = container_client.get_blob_client(blob_name)
            if blob_client.exists():
                history_content = blob_client.download_blob().readall().decode('utf-8')
                history_lines = history_content.strip().split('\n')
                for line in history_lines:
                    if line.strip():
                        try:
                            all_history_items.append(HistoryItem.model_validate_json(line))
                        except Exception as e:
                            print(f"Skipping malformed line in {blob_name}: {line}. Error: {e}")
    except Exception as e:
        print(f"Error reading history blobs for all summaries: {e}")
        return []

    if not all_history_items:
        return []

    # 直近14日間のフィルタリング
    today = datetime.datetime.now(TOKYO_TZ).date()
    start_date = today - datetime.timedelta(days=13)

    daily_summary_map = {}
    for item in all_history_items:
        item_date = item.answered_at.astimezone(TOKYO_TZ).date()
        
        if item_date >= start_date:
            date_str = item.answered_at.astimezone(TOKYO_TZ).strftime("%Y-%m-%d")
            if date_str not in daily_summary_map:
                daily_summary_map[date_str] = {"total_questions": 0, "correct_count": 0}
            
            daily_summary_map[date_str]["total_questions"] += 1
            if item.is_correct:
                daily_summary_map[date_str]["correct_count"] += 1
            
    daily_summary_list = []
    for date_str, stats in daily_summary_map.items():
        if stats["total_questions"] > 0:
            accuracy = stats["correct_count"] / stats["total_questions"]
            daily_summary_list.append(DailySummaryItem(
                date=date_str,
                total_questions=stats["total_questions"],
                correct_count=stats["correct_count"],
                accuracy=accuracy
            ))
            
    daily_summary_list.sort(key=lambda x: x.date, reverse=True)
    return daily_summary_list

@api_router.get("/history/daily-summary/{subject_name}", response_model=list[DailySummaryItem])
def get_daily_summary(
    subject_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
):
    """指定された科目の履歴を読み込み、日付ごとに集計したサマリーを返す"""
    if container_client is None:
        return []

    history_items = []
    
    # 指定された科目の履歴ファイルのみを読み込む
    try:
        subject_stem = Path(subject_name).stem
        history_blob_name = f"history/{subject_stem}.jsonl"
        blob_client = container_client.get_blob_client(history_blob_name)
        
        if blob_client.exists():
            history_content = blob_client.download_blob().readall().decode('utf-8')
            history_lines = history_content.strip().split('\n')
            
            for line in history_lines:
                if line.strip():
                    try:
                        history_items.append(HistoryItem.model_validate_json(line))
                    except json.JSONDecodeError as e:
                        print(f"Skipping malformed history line in {history_blob_name}: {line}. Error: {e}")
                    except Exception as e:
                        print(f"Error validating history line in {history_blob_name}: {line}. Error: {e}")
    except Exception as e:
        print(f"Error reading history blob for daily summary: {e}")
        return []

    # --- Filtering Logic ---
    target_history = history_items
    
    if start_date:
        try:
            start_dt = TOKYO_TZ.localize(datetime.datetime.strptime(start_date, "%Y-%m-%d"))
            target_history = [item for item in target_history if item.answered_at >= start_dt]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD.")

    if end_date:
        try:
            # End of the day
            end_dt = TOKYO_TZ.localize(datetime.datetime.strptime(end_date, "%Y-%m-%d")) + datetime.timedelta(days=1)
            target_history = [item for item in target_history if item.answered_at < end_dt]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD.")
            
    if category:
        target_history = [item for item in target_history if item.category == category]
    # --- End of Filtering Logic ---

    if not target_history:
        return []

    daily_summary_map = {} # { "YYYY-MM-DD": { "total": N, "correct": M } }

    for item in target_history:
        # UTCタイムスタンプをAsia/Tokyoのローカル日付に変換
        local_time = item.answered_at.astimezone(TOKYO_TZ)
        date_str = local_time.strftime("%Y-%m-%d")

        if date_str not in daily_summary_map:
            daily_summary_map[date_str] = {"total_questions": 0, "correct_count": 0}
        
        daily_summary_map[date_str]["total_questions"] += 1
        if item.is_correct:
            daily_summary_map[date_str]["correct_count"] += 1
    
    # 結果を DailySummaryItem のリストに変換
    daily_summary_list = []
    for date_str, stats in daily_summary_map.items():
        if stats["total_questions"] > 0: # total_questions が 0 のレコードは無視
            accuracy = stats["correct_count"] / stats["total_questions"]
            daily_summary_list.append(DailySummaryItem(
                date=date_str,
                total_questions=stats["total_questions"],
                correct_count=stats["correct_count"],
                accuracy=accuracy
            ))
    
    # 日付の昇順でソート
    daily_summary_list.sort(key=lambda x: x.date)

    return daily_summary_list

# --- Final App Setup ---
app.include_router(api_router)

# Explicitly handle SPA routes to avoid "Not Found" on reload
@app.get("/portal", response_class=FileResponse)
async def serve_portal_route():
    return FileResponse(DIST_DIR / "index.html")

@app.get("/dashboard", response_class=FileResponse)
async def serve_dashboard_route():
    return FileResponse(DIST_DIR / "index.html")

app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")
