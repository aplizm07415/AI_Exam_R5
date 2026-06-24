import os
import json
import random
import datetime
import math
import re
import unicodedata
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from fastapi import FastAPI, APIRouter, HTTPException, Query, Response, UploadFile, File, Form
from pydantic import BaseModel, Field, ValidationError # BaseModelをインポート
from typing import Any, Literal, List, Optional
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
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials # Add for security

# --- ローカルユーティリティ ---
from .utils import normalize_question, HistoryItem, ProblemStudyStatus, get_problem_study_statuses, calculate_review_priority
from .secondary_exam import router as secondary_exam_router
from .gemini_config import create_generative_model, get_gemini_unavailable_reason

# 新規追加: 日別集計の戻り値用モデル
class DailySummaryItem(BaseModel):
    date: str # YYYY-MM-DD
    total_questions: int
    correct_count: int
    accuracy: float

class ModeSummaryItem(BaseModel):
    mode: str
    total_questions: int
    correct_count: int
    accuracy: float

class DailySummaryDetailItem(DailySummaryItem):
    mode_breakdown: list[ModeSummaryItem] = Field(default_factory=list)

class PagedDailySummaryResponse(BaseModel):
    items: list[DailySummaryDetailItem]
    total_days: int
    has_more: bool
    next_offset: Optional[int] = None

class TodayModeSummary(BaseModel):
    mode: str
    total_runs: int
    correct_answers: int
    accuracy: float

class GenerateKeywordsRequest(BaseModel):
    memo_text: str


SpecificAreaHistoryScope = Literal["all", "unanswered", "answered"]
QuestionTagFilter = Literal["all", "calculation_only", "exclude_calculation"]
CALCULATION_TAG = "calculation"
StudyQuizMode = Literal["random", "weak_area", "unanswered", "today_remaining", "specific_area", "worry_practice"]
StudyActionMode = Literal["ipad_air", "ipad_mini", "paper_practice", "forced"]
PassProbabilityAnalysisPolicy = Literal["coverage_adjusted", "answered_recent_weighted"]


class SpecificAreaSuggestionRequest(BaseModel):
    keywords: list[str] = Field(default_factory=list)


class SpecificAreaSuggestionResponse(BaseModel):
    suggestions: list[str] = Field(default_factory=list)
    used_ai: bool = False

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

class PastExamRecordCell(BaseModel):
    attempted_at: Optional[str] = None
    score: Optional[float] = Field(default=None, ge=0, le=100)

class PastExamRecordRow(BaseModel):
    id: str
    label: str = Field(min_length=1, max_length=80)
    cells: dict[str, PastExamRecordCell] = Field(default_factory=dict)

class PastExamRecordsBook(BaseModel):
    subject_columns: list[str] = Field(default_factory=list)
    problem_json_mappings: dict[str, list[str]] = Field(default_factory=dict)
    rows: list[PastExamRecordRow] = Field(default_factory=list)
    updated_at: Optional[str] = None

class SubjectPassProbabilityItem(BaseModel):
    subject: str
    total_problems: int
    answered_problems: int
    coverage_rate: float
    total_attempts: int
    correct_attempts: int
    accuracy_rate: float
    average_attempts_per_answered: float
    expected_score: float
    pass_probability: float
    weak_problem_count: int
    strong_problem_count: int

class PastExamRecordEvidence(BaseModel):
    included: bool = False
    columns: list[str] = Field(default_factory=list)
    problem_json_mappings: dict[str, list[str]] = Field(default_factory=dict)
    mapping_applied: bool = False
    ignored_columns: list[str] = Field(default_factory=list)
    record_count: int = 0
    average_score: Optional[float] = None
    weighted_score: Optional[float] = None
    requested_weight: float = 0.0
    effective_weight: float = 0.0

class SubjectPracticeRecommendation(BaseModel):
    subject: str
    recommended_attempts: int
    daily_attempts: Optional[float] = None
    score_gap: float
    focus: str
    reason: str

class PassProbabilityPracticePlan(BaseModel):
    exam_name: Optional[str] = None
    exam_date: Optional[str] = None
    days_to_exam: Optional[int] = None
    daily_practice_capacity: int = 20
    total_recommended_attempts: int = 0
    recommended_daily_attempts: Optional[float] = None
    feasible_by_exam_date: Optional[bool] = None
    time_adjustment_factor: float = 1.0
    subject_recommendations: list[SubjectPracticeRecommendation] = Field(default_factory=list)

class PassProbabilityAnalysisRequestSnapshot(BaseModel):
    subjects: list[str]
    passing_score: float
    analysis_policy: PassProbabilityAnalysisPolicy = "coverage_adjusted"
    include_past_exam_records: bool = False
    past_exam_columns: list[str] = Field(default_factory=list)
    past_exam_weight: float = 0.35
    exam_name: Optional[str] = None
    exam_date: Optional[str] = None
    daily_practice_capacity: int = 20

class PassProbabilityResponse(BaseModel):
    analysis_id: str
    analysis_policy: PassProbabilityAnalysisPolicy = "coverage_adjusted"
    subjects: list[str]
    passing_score: float
    total_problems: int
    answered_problems: int
    coverage_rate: float
    total_attempts: int
    correct_attempts: int
    accuracy_rate: float
    average_attempts_per_answered: float
    base_expected_score: float
    expected_score: float
    projected_score_low: float
    projected_score_high: float
    pass_probability: float
    evidence_confidence: float
    readiness_label: str
    recommendation: str
    past_exam_records: PastExamRecordEvidence = Field(default_factory=PastExamRecordEvidence)
    practice_plan: PassProbabilityPracticePlan = Field(default_factory=PassProbabilityPracticePlan)
    subject_breakdown: list[SubjectPassProbabilityItem]
    analyzed_at: str

class PassProbabilityAnalysisRecord(BaseModel):
    id: str
    saved_at: str
    request: PassProbabilityAnalysisRequestSnapshot
    result: PassProbabilityResponse

class PassProbabilityHistoryItem(BaseModel):
    analysis_id: str
    analyzed_at: str
    pass_probability: float

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
    archived: bool = False

class StudySubjectSelectionPattern(BaseModel):
    id: str
    name: str
    subjectNames: list[str] = Field(default_factory=list)
    createdAt: str

class StudySettings(BaseModel):
    subject_selection_patterns: list[StudySubjectSelectionPattern] = Field(default_factory=list)
    default_subject_pattern_id: Optional[str] = None
    default_quiz_mode: StudyQuizMode = "today_remaining"
    hidden_study_action_modes: list[StudyActionMode] = Field(default_factory=list)

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
    explanation_image_data_urls: list[str] = Field(default_factory=list)
    question_image_data_url: Optional[str] = None
    question_image_data_urls: list[str] = Field(default_factory=list)

class ReviewLaterUpsertRequest(BaseModel):
    subject: str
    problem_id: str


class ReviewLaterExplanationReviewRequest(BaseModel):
    question: Optional[dict[str, Any]] = None


class ReviewLaterExplanationReviewResponse(BaseModel):
    reorganized_explanation: str
    reorganized_question_text_md: Optional[str] = None
    consistency_notes: list[str] = Field(default_factory=list)
    used_ai: bool = False

class ReviewLaterBulkReorganizeItem(BaseModel):
    subject: str
    problem_id: str
    updated: bool = False
    used_ai: bool = False
    consistency_notes: list[str] = Field(default_factory=list)
    error: Optional[str] = None

class ReviewLaterBulkReorganizeResponse(BaseModel):
    subject: str
    total: int
    updated: int
    failed: int
    items: list[ReviewLaterBulkReorganizeItem] = Field(default_factory=list)

ReviewLaterBulkReorganizeJobState = Literal["queued", "running", "completed", "failed"]
ReviewLaterBulkReorganizeSubjectState = Literal["queued", "running", "completed", "failed"]

class ReviewLaterBulkReorganizeJobRequest(BaseModel):
    subjects: list[str] = Field(min_length=1)
    max_parallel_subjects: int = Field(default=2, ge=1, le=4)

class ReviewLaterBulkReorganizeSubjectProgress(BaseModel):
    subject: str
    status: ReviewLaterBulkReorganizeSubjectState = "queued"
    total: int = 0
    processed: int = 0
    updated: int = 0
    failed: int = 0
    current_problem_id: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    items: list[ReviewLaterBulkReorganizeItem] = Field(default_factory=list)

class ReviewLaterBulkReorganizeJobStatus(BaseModel):
    job_id: str
    status: ReviewLaterBulkReorganizeJobState
    total_subjects: int
    completed_subjects: int
    total_problems: int
    processed_problems: int
    updated: int
    failed: int
    max_parallel_subjects: int
    started_at: str
    completed_at: Optional[str] = None
    subjects: list[ReviewLaterBulkReorganizeSubjectProgress] = Field(default_factory=list)


class ReviewLaterQuestionTextMdDedupeRequest(BaseModel):
    subjects: list[str] = Field(min_length=1)


class ReviewLaterQuestionTextMdDedupeItem(BaseModel):
    subject: str
    problem_id: str
    updated: bool = False
    duplicates_removed: int = 0
    before_length: int = 0
    after_length: int = 0
    error: Optional[str] = None


class ReviewLaterQuestionTextMdDedupeSubjectResult(BaseModel):
    subject: str
    total: int
    updated: int
    failed: int
    duplicates_removed: int
    items: list[ReviewLaterQuestionTextMdDedupeItem] = Field(default_factory=list)


class ReviewLaterQuestionTextMdDedupeResponse(BaseModel):
    total_subjects: int
    total: int
    updated: int
    failed: int
    duplicates_removed: int
    subjects: list[ReviewLaterQuestionTextMdDedupeSubjectResult] = Field(default_factory=list)

class ReviewLaterItem(BaseModel):
    subject: str
    problem_id: str
    created_at: str
    updated_at: str

class ReviewLaterProblemRef(BaseModel):
    subject: str
    problem_id: str


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
    custom_explanation_image_data_urls: list[str] = Field(default_factory=list)
    custom_question_image_data_urls: list[str] = Field(default_factory=list)

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
    explanation_image_data_urls: list[str] = Field(default_factory=list)
    question_image_data_url: Optional[str] = None
    question_image_data_urls: list[str] = Field(default_factory=list)

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


class CustomExplanationLibraryItem(BaseModel):
    subject: str
    problem_id: str
    question_text: str
    category: Optional[str] = None
    custom_explanation: str = ""
    custom_explanation_image_data_urls: list[str] = Field(default_factory=list)
    custom_question_image_data_urls: list[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CustomExplanationLibraryResponse(BaseModel):
    items: list[CustomExplanationLibraryItem]

class QuizStartRequest(BaseModel):
    subjects: list[str]
    count: int = 10
    mode: str = "random"
    weights: dict[str, str] | None = None
    keywords: list[str] = Field(default_factory=list)
    specific_area_history_scope: SpecificAreaHistoryScope = "all"
    tag_filter: QuestionTagFilter = "all"

class PaperPracticeLotCreateRequest(QuizStartRequest):
    source_mode: Optional[str] = None
    title: Optional[str] = None

class PaperPracticeLot(BaseModel):
    id: str
    title: str
    created_at: str
    subjects: list[str]
    mode: str
    source_mode: Optional[str] = None
    count: int
    tag_filter: QuestionTagFilter = "all"
    questions: list[dict]

class PaperPracticeGradeRequest(BaseModel):
    answers: dict[str, str]
    grading_scope: Literal["answered_only", "all"] = "all"

class PaperPracticeAttemptAnswer(BaseModel):
    lot_number: int
    problem_id: str
    subject: str
    selected_answer: str
    correct_answer: str
    is_correct: bool
    question: dict

class PaperPracticeAttempt(BaseModel):
    id: str
    lot_id: str
    created_at: str
    total_count: int
    correct_count: int
    answers: list[PaperPracticeAttemptAnswer]


class WorryPracticeGenerateRequest(BaseModel):
    concern_text: str = Field(min_length=1, max_length=4000)
    count: int = Field(default=5, ge=1, le=20)


class WorryPracticeVersionSummary(BaseModel):
    id: str
    input_hash: str
    version: int
    title: str
    concern_text: str
    count: int
    question_count: int
    created_at: str
    updated_at: str


class WorryPracticeVersion(WorryPracticeVersionSummary):
    quiz_set: list[dict]


class WorryPracticeGenerateResponse(BaseModel):
    subject: str
    quiz_set: list[dict]
    version: Optional[WorryPracticeVersion] = None

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

class QuestionHelpRequest(BaseModel):
    question: OralVivaQuestionContext
    conversation: list[OralVivaTurn] = Field(default_factory=list)
    user_message: str = Field(min_length=1, max_length=2000)

class QuestionHelpResponse(BaseModel):
    assistant_message: str
    suggested_followups: list[str] = Field(default_factory=list)
    used_ai: bool = False

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
PAPER_PRACTICE_LOTS_DIR = "paper-practice/lots"
PAPER_PRACTICE_ATTEMPTS_DIR = "paper-practice/attempts"
WORRY_PRACTICE_VERSIONS_BLOB = "worry-practice/versions.json"
WORRY_PRACTICE_SUBJECT_NAME = "心配事演習.json"
WORRY_PRACTICE_MODE = "worry_practice"
SIMILAR_PRACTICE_MODE = "similar_practice"
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


def _paper_practice_lot_blob_name(lot_id: str) -> str:
    return f"{PAPER_PRACTICE_LOTS_DIR}/{lot_id}.json"


def _paper_practice_attempt_blob_name(lot_id: str, attempt_id: str) -> str:
    return f"{PAPER_PRACTICE_ATTEMPTS_DIR}/{lot_id}/{attempt_id}.json"


def _load_paper_practice_lot(blob_name: str) -> PaperPracticeLot | None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(blob_name)
    if not blob_client.exists():
        return None
    try:
        payload = json.loads(blob_client.download_blob().readall())
        return PaperPracticeLot.model_validate(payload)
    except Exception as e:
        print(f"Error reading paper practice lot {blob_name}: {e}")
        return None


def _save_paper_practice_lot(lot: PaperPracticeLot) -> None:
    payload = json.dumps(lot.model_dump(), ensure_ascii=False, indent=2).encode("utf-8")
    _overwrite_blob_bytes(_paper_practice_lot_blob_name(lot.id), payload)


def _load_paper_practice_attempt(blob_name: str) -> PaperPracticeAttempt | None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(blob_name)
    if not blob_client.exists():
        return None
    try:
        payload = json.loads(blob_client.download_blob().readall())
        return PaperPracticeAttempt.model_validate(payload)
    except Exception as e:
        print(f"Error reading paper practice attempt {blob_name}: {e}")
        return None


def _save_paper_practice_attempt(attempt: PaperPracticeAttempt) -> None:
    payload = json.dumps(attempt.model_dump(), ensure_ascii=False, indent=2).encode("utf-8")
    _overwrite_blob_bytes(_paper_practice_attempt_blob_name(attempt.lot_id, attempt.id), payload)

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
    enriched['custom_explanation_image_data_urls'] = []
    enriched['custom_question_image_data_urls'] = []
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
                explanation_image_data_urls = explanation_data.get('explanation_image_data_urls')
                if not isinstance(explanation_image_data_urls, list):
                    explanation_image_data_url = explanation_data.get('explanation_image_data_url', legacy_image_data_url)
                    explanation_image_data_urls = [explanation_image_data_url] if isinstance(explanation_image_data_url, str) and explanation_image_data_url.strip() else []
                else:
                    explanation_image_data_urls = [
                        item for item in explanation_image_data_urls
                        if isinstance(item, str) and item.strip()
                    ]

                question_image_data_urls = explanation_data.get('question_image_data_urls')
                if not isinstance(question_image_data_urls, list):
                    question_image_data_url = explanation_data.get('question_image_data_url')
                    question_image_data_urls = [question_image_data_url] if isinstance(question_image_data_url, str) and question_image_data_url.strip() else []
                else:
                    question_image_data_urls = [
                        item for item in question_image_data_urls
                        if isinstance(item, str) and item.strip()
                    ]

                enriched['custom_explanation_image_data_urls'] = explanation_image_data_urls
                enriched['custom_question_image_data_urls'] = question_image_data_urls
                enriched['custom_explanation_image_data_url'] = explanation_image_data_urls[0] if explanation_image_data_urls else None
                enriched['custom_question_image_data_url'] = question_image_data_urls[0] if question_image_data_urls else None
    except Exception as e:
        problem_id_for_log = enriched.get('id', 'UNKNOWN')
        print(f"Error fetching custom explanation for problem {problem_id_for_log}: {e}")
    return enriched


def _prepare_question_assets_for_client(question: dict) -> dict:
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

    return prepared


def _prepare_question_for_client(question: dict) -> dict:
    prepared = _prepare_question_assets_for_client(question)
    return _enrich_question_with_custom_explanation(prepared)


def _normalize_keyword_value(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().casefold()


def _char_class(char: str) -> str:
    if re.fullmatch(r"[0-9A-Za-z_]", char):
        return "ascii_word"
    if re.fullmatch(r"[\u3040-\u309f]", char):
        return "hiragana"
    if re.fullmatch(r"[\u30a0-\u30ff\u31f0-\u31ff\uff65-\uff9f]", char):
        return "katakana"
    if re.fullmatch(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", char):
        return "han"
    if char.isspace():
        return "space"
    return "other"


def _has_exact_keyword_boundary(text: str, keyword: str, start: int, end: int) -> bool:
    keyword_start_class = _char_class(keyword[0])
    keyword_end_class = _char_class(keyword[-1])

    if start > 0:
        left_class = _char_class(text[start - 1])
        if keyword_start_class == "ascii_word":
            if left_class == "ascii_word":
                return False
        elif left_class == keyword_start_class:
            return False

    if end < len(text):
        right_class = _char_class(text[end])
        if keyword_end_class == "ascii_word":
            if right_class == "ascii_word":
                return False
        elif right_class == keyword_end_class:
            return False

    return True


def _contains_exact_keyword(text: str, keyword: str) -> bool:
    normalized_text = _normalize_keyword_value(text)
    normalized_keyword = _normalize_keyword_value(keyword)
    if not normalized_text or not normalized_keyword:
        return False

    start = 0
    while True:
        match_index = normalized_text.find(normalized_keyword, start)
        if match_index == -1:
            return False
        match_end = match_index + len(normalized_keyword)
        if _has_exact_keyword_boundary(normalized_text, normalized_keyword, match_index, match_end):
            return True
        start = match_index + 1


def _question_search_texts(question: dict, custom_explanations_map: Optional[dict[str, dict]] = None) -> list[str]:
    texts: list[str] = []

    question_text = question.get("question_text")
    if isinstance(question_text, str) and question_text.strip():
        texts.append(question_text)

    for choice in question.get("choices", []):
        if isinstance(choice, dict):
            choice_text = choice.get("text")
            if isinstance(choice_text, str) and choice_text.strip():
                texts.append(choice_text)

    explanation = question.get("explanation")
    if isinstance(explanation, dict):
        explanation_text = explanation.get("text")
        if isinstance(explanation_text, str) and explanation_text.strip():
            texts.append(explanation_text)
    elif isinstance(explanation, str) and explanation.strip():
        texts.append(explanation)

    if custom_explanations_map is not None:
        problem_id = str(question.get("id") or "")
        custom_explanation = custom_explanations_map.get(problem_id, {})
        memo_text = custom_explanation.get("text")
        if isinstance(memo_text, str) and memo_text.strip():
            texts.append(memo_text)

    return texts


def _filter_questions_by_keywords(
    questions: list[dict],
    keywords: list[str],
    custom_explanations_map: Optional[dict[str, dict]] = None,
) -> list[dict]:
    normalized_keywords = [keyword.strip() for keyword in keywords if isinstance(keyword, str) and keyword.strip()]
    if not normalized_keywords:
        return []

    matched_questions: list[dict] = []
    for question in questions:
        texts = _question_search_texts(question, custom_explanations_map)
        if any(
            _contains_exact_keyword(text, keyword)
            for keyword in normalized_keywords
            for text in texts
        ):
            matched_questions.append(question)

    return matched_questions


def _filter_questions_by_history_scope(
    questions: list[dict],
    history_items: list[HistoryItem],
    history_scope: SpecificAreaHistoryScope,
) -> list[dict]:
    if history_scope == "all":
        return questions

    answered_problem_ids = {item.problem_id for item in history_items}
    if history_scope == "unanswered":
        return [q for q in questions if q.get("id") not in answered_problem_ids]
    return [q for q in questions if q.get("id") in answered_problem_ids]


def _question_has_tag(question: dict, tag: str) -> bool:
    tags = question.get("tags")
    if not isinstance(tags, list):
        return False
    normalized_tag = tag.strip().casefold()
    return any(str(item).strip().casefold() == normalized_tag for item in tags)


def _filter_questions_by_tag_filter(questions: list[dict], tag_filter: QuestionTagFilter) -> list[dict]:
    if tag_filter == "calculation_only":
        return [q for q in questions if _question_has_tag(q, CALCULATION_TAG)]
    if tag_filter == "exclude_calculation":
        return [q for q in questions if not _question_has_tag(q, CALCULATION_TAG)]
    return questions


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        normalized = _normalize_keyword_value(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(value.strip())
    return deduped


def _extract_json_object_from_text(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if text.startswith("{"):
        return json.loads(text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])
    raise ValueError("No JSON object found in AI response.")


def _question_explanation_text(question: dict[str, Any]) -> str:
    explanation_raw = question.get("explanation")
    return (
        str(explanation_raw.get("text") or "")
        if isinstance(explanation_raw, dict)
        else str(explanation_raw or "")
    ).strip()


def _fallback_reorganized_explanation(question: dict[str, Any]) -> ReviewLaterExplanationReviewResponse:
    explanation_text = _question_explanation_text(question)
    answer = str(question.get("answer") or "").strip()
    choices = question.get("choices") if isinstance(question.get("choices"), list) else []
    correct_choice = next(
        (
            choice
            for choice in choices
            if isinstance(choice, dict) and str(choice.get("label") or "") == answer
        ),
        None,
    )
    correct_text = str(correct_choice.get("text") or "").strip() if isinstance(correct_choice, dict) else ""

    base_lines = []
    if answer:
        base_lines.append(f"結論: 正解は{answer}{f'（{correct_text}）' if correct_text else ''}。")
    if explanation_text:
        base_lines.append(f"理由: {explanation_text}")
    else:
        base_lines.append("理由: 現在の解説文が空のため、問題文と正解情報を確認してください。")
    base_lines.append("確認ポイント: 問題文の条件、選択肢の差分、正解根拠が矛盾していないかを見直してください。")

    return ReviewLaterExplanationReviewResponse(
        reorganized_explanation="\n".join(base_lines),
        reorganized_question_text_md=None,
        consistency_notes=["AI整理を使えないため、既存情報から最低限の構成に整えました。"],
        used_ai=False,
    )


def _build_review_later_reorganize_prompt(
    subject_name: str,
    problem_id: str,
    normalized: dict[str, Any],
) -> str:
    prompt_payload = {
        "problem_id": problem_id,
        "subject": subject_name,
        "question_text": normalized.get("question_text"),
        "question_text_md": normalized.get("question_text_md"),
        "question_text_mermaid": normalized.get("question_text_mermaid"),
        "choices": normalized.get("choices"),
        "answer": normalized.get("answer"),
        "category": normalized.get("category"),
        "explanation": normalized.get("explanation"),
    }

    return f"""
あなたは中小企業診断士試験の問題データを点検する編集者です。
以下の問題データだけを根拠に、正解・選択肢・解説の整合性を確認し、解説文とMarkdown問題文を読みやすく再整理してください。
通常の問題文だけでなく、question_text_md の表・補足情報、question_text_mermaid の図や関係性も同じ問題データとして扱い、問題文・選択肢・正解・解説との矛盾や不足がないか確認してください。

# 問題データ
{json.dumps(prompt_payload, ensure_ascii=False)}

# 出力ルール
- 必ずJSONオブジェクトのみを返す。
- reorganized_explanation は日本語で、見出し記号やMarkdown記号（#、*、-）を使わず、短い段落を改行で区切る。
- reorganized_explanation の1行目は結論、2行目以降は根拠、他選択肢との差分、重要キーワードを必要最小限で整理する。
- reorganized_question_text_md は、question_text_md が空でなければMarkdownとして返す。空なら null を返す。
- reorganized_question_text_md は、1問の中に複数の設問や枝問がある場合、各設問ごとに「問題文」「条件・資料」「選択肢」を対応が分かる順序で整理する。
- reorganized_question_text_md では、元データにある数値、固有名詞、表、選択肢、制約条件を削除・改変しない。情報が不足する場合は補わず、見出しと改行だけで読みやすくする。
- 余計な前置きや励ましは入れない。
- consistency_notes は、通常問題文、md、Mermaid、選択肢、正解、解説の整合している点または不整合の疑いを最大5件で返す。
- mdやMermaidが空の場合は、その項目は空として扱い、空であること自体を問題視しない。
- 情報が足りない場合は、断定せず「確認が必要」と書く。

# JSONスキーマ
{{
  "reorganized_explanation": "string",
  "reorganized_question_text_md": "string|null",
  "consistency_notes": ["string"],
  "used_ai": true
}}
"""


def _reorganize_question_with_ai_or_fallback(
    subject_name: str,
    problem_id: str,
    question: dict[str, Any],
) -> ReviewLaterExplanationReviewResponse:
    normalized = normalize_question(question.copy())
    if not normalized:
        raise HTTPException(status_code=400, detail="問題データの形式が不正です。")
    normalized["subject"] = str(normalized.get("subject") or subject_name)

    gemini_unavailable_reason = get_gemini_unavailable_reason()
    if gemini_unavailable_reason:
        return _fallback_reorganized_explanation(normalized)

    prompt = _build_review_later_reorganize_prompt(subject_name, problem_id, normalized)
    try:
        model = create_generative_model()
        response = model.generate_content(prompt)
        payload = _extract_json_object_from_text(getattr(response, "text", "") or "")
        reorganized = str(payload.get("reorganized_explanation") or "").strip()
        if not reorganized:
            return _fallback_reorganized_explanation(normalized)
        raw_question_text_md = payload.get("reorganized_question_text_md")
        reorganized_question_text_md = (
            raw_question_text_md.strip()
            if isinstance(raw_question_text_md, str) and raw_question_text_md.strip()
            else None
        )
        notes = [str(item).strip() for item in (payload.get("consistency_notes") or []) if str(item).strip()]
        return ReviewLaterExplanationReviewResponse(
            reorganized_explanation=reorganized,
            reorganized_question_text_md=reorganized_question_text_md,
            consistency_notes=notes[:5],
            used_ai=True,
        )
    except Exception as e:
        print(f"Error reorganizing question {subject_name}/{problem_id}: {e}")
        return _fallback_reorganized_explanation(normalized)


def _apply_reorganized_question_fields(
    original_question: dict,
    review: ReviewLaterExplanationReviewResponse,
) -> tuple[dict, bool]:
    next_question = dict(original_question)
    changed = False
    next_explanation_text = review.reorganized_explanation.strip()
    if next_explanation_text:
        current_explanation = next_question.get("explanation")
        if isinstance(current_explanation, dict):
            next_explanation = dict(current_explanation)
            if str(next_explanation.get("text") or "") != next_explanation_text:
                next_explanation["text"] = next_explanation_text
                next_question["explanation"] = next_explanation
                changed = True
        elif str(current_explanation or "") != next_explanation_text:
            next_question["explanation"] = {"text": next_explanation_text, "images": []}
            changed = True

    next_question_text_md = (review.reorganized_question_text_md or "").strip()
    if next_question_text_md and str(next_question.get("question_text_md") or "") != next_question_text_md:
        next_question["question_text_md"] = next_question_text_md
        changed = True

    return next_question, changed


MIN_QUESTION_MD_DUPLICATE_LENGTH = 12


def _normalize_question_md_duplicate_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = re.sub(r"(?m)^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+[\.)]\s+)", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[*_`~]", "", text)
    text = re.sub(r"\s+", "", text)
    return text.casefold()


def _looks_like_structured_markdown_block(value: str) -> bool:
    lines = [line.strip() for line in (value or "").splitlines() if line.strip()]
    if not lines:
        return False
    if any(line.startswith("```") for line in lines):
        return True
    return any("|" in line for line in lines)


def _is_duplicate_question_text_md_unit(unit: str, question_norm: str) -> bool:
    unit_norm = _normalize_question_md_duplicate_text(unit)
    if not unit_norm or not question_norm:
        return False
    if unit_norm == question_norm and len(unit_norm) >= 4:
        return True
    if len(unit_norm) < MIN_QUESTION_MD_DUPLICATE_LENGTH:
        return False
    if unit_norm in question_norm:
        return True
    return (
        len(question_norm) >= MIN_QUESTION_MD_DUPLICATE_LENGTH
        and question_norm in unit_norm
        and not _looks_like_structured_markdown_block(unit)
    )


def _split_markdown_blocks(markdown_text: str) -> list[str]:
    blocks: list[str] = []
    current_lines: list[str] = []
    for raw_line in markdown_text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        if line.strip():
            current_lines.append(line)
            continue
        if current_lines:
            blocks.append("\n".join(current_lines))
            current_lines = []
    if current_lines:
        blocks.append("\n".join(current_lines))
    return blocks


def _is_orphan_question_md_label(block: str) -> bool:
    lines = [line for line in block.splitlines() if line.strip()]
    if not lines or len(lines) > 2:
        return False
    generic_labels = {"問題", "問題文", "本文", "設問", "question", "questiontext"}
    return all(_normalize_question_md_duplicate_text(line) in generic_labels for line in lines)


def _remove_duplicate_question_text_md_lines(block: str, question_norm: str) -> tuple[str, int]:
    kept_lines: list[str] = []
    removed_count = 0
    for line in block.splitlines():
        if _is_duplicate_question_text_md_unit(line, question_norm):
            removed_count += 1
            continue
        kept_lines.append(line.rstrip())
    cleaned = "\n".join(kept_lines).strip()
    if removed_count > 0 and _is_orphan_question_md_label(cleaned):
        return "", removed_count + 1
    return cleaned, removed_count


def _remove_duplicate_question_text_md(question_text: str, question_text_md: str) -> tuple[str, int]:
    question_norm = _normalize_question_md_duplicate_text(question_text)
    if not question_norm or not question_text_md.strip():
        return question_text_md, 0

    kept_blocks: list[str] = []
    removed_count = 0
    for block in _split_markdown_blocks(question_text_md):
        if _is_duplicate_question_text_md_unit(block, question_norm):
            removed_count += 1
            continue
        cleaned_block, line_removed_count = _remove_duplicate_question_text_md_lines(block, question_norm)
        removed_count += line_removed_count
        if cleaned_block:
            kept_blocks.append(cleaned_block)

    return "\n\n".join(kept_blocks).strip(), removed_count


def _dedupe_subject_question_text_md(subject_name: str) -> ReviewLaterQuestionTextMdDedupeSubjectResult:
    is_dict_format, original_questions, base_payload = _subject_blob_payload(subject_name)
    next_questions: list[dict] = []
    results: list[ReviewLaterQuestionTextMdDedupeItem] = []
    updated_count = 0
    failed_count = 0
    removed_total = 0

    for index, original_question in enumerate(original_questions):
        if not isinstance(original_question, dict):
            problem_id = f"index-{index + 1}"
            next_questions.append(original_question)
            failed_count += 1
            results.append(ReviewLaterQuestionTextMdDedupeItem(
                subject=subject_name,
                problem_id=problem_id,
                error="問題データの形式が不正です。",
            ))
            continue

        normalized = normalize_question(original_question.copy())
        problem_id = str((normalized or {}).get("id") or original_question.get("id") or f"index-{index + 1}")
        if not normalized:
            next_questions.append(original_question)
            failed_count += 1
            results.append(ReviewLaterQuestionTextMdDedupeItem(
                subject=subject_name,
                problem_id=problem_id,
                error="問題データの形式が不正です。",
            ))
            continue

        question_text_md = original_question.get("question_text_md")
        if not isinstance(question_text_md, str) or not question_text_md.strip():
            next_questions.append(original_question)
            results.append(ReviewLaterQuestionTextMdDedupeItem(
                subject=subject_name,
                problem_id=problem_id,
            ))
            continue

        question_text = str(original_question.get("question_text") or normalized.get("question_text") or "")
        cleaned_question_text_md, removed_count = _remove_duplicate_question_text_md(question_text, question_text_md)
        before_length = len(question_text_md)
        after_length = len(cleaned_question_text_md)
        changed = removed_count > 0 and cleaned_question_text_md != question_text_md
        if changed:
            next_question = dict(original_question)
            next_question["question_text_md"] = cleaned_question_text_md
            next_questions.append(next_question)
            updated_count += 1
            removed_total += removed_count
        else:
            next_questions.append(original_question)

        results.append(ReviewLaterQuestionTextMdDedupeItem(
            subject=subject_name,
            problem_id=problem_id,
            updated=changed,
            duplicates_removed=removed_count if changed else 0,
            before_length=before_length,
            after_length=after_length if changed else before_length,
        ))

    if updated_count > 0:
        _write_subject_questions(subject_name, next_questions, base_payload, is_dict_format)

    return ReviewLaterQuestionTextMdDedupeSubjectResult(
        subject=subject_name,
        total=len(original_questions),
        updated=updated_count,
        failed=failed_count,
        duplicates_removed=removed_total,
        items=results,
    )


def _load_custom_explanations_map() -> dict[str, dict]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    payload_by_problem_id: dict[str, dict] = {}
    try:
        for blob in container_client.list_blobs(name_starts_with=f"{CUSTOM_EXPLANATIONS_DIR}/"):
            blob_name = getattr(blob, "name", "")
            if not blob_name.endswith(".json"):
                continue
            problem_id = Path(blob_name).stem
            if not problem_id:
                continue
            blob_client = container_client.get_blob_client(blob_name)
            content = blob_client.download_blob().readall()
            payload = json.loads(content)
            if isinstance(payload, dict):
                last_modified = getattr(blob, "last_modified", None)
                fallback_iso = last_modified.isoformat() if last_modified else None
                payload.setdefault("created_at", fallback_iso)
                payload.setdefault("updated_at", fallback_iso)
                payload_by_problem_id[problem_id] = payload
    except Exception as e:
        print(f"Error reading custom explanations index: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read custom explanations index: {e}")

    return payload_by_problem_id


def _collect_custom_explanation_library_items(subjects: Optional[list[str]] = None) -> list[CustomExplanationLibraryItem]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    selected_subjects = [
        subject_name for subject_name in (subjects or get_subjects())
        if subject_name != WORRY_PRACTICE_SUBJECT_NAME
    ]
    custom_explanations_map = _load_custom_explanations_map()
    if not custom_explanations_map:
        return []

    unique_subjects: list[str] = []
    seen_subjects: set[str] = set()
    for subject_name in selected_subjects:
        if subject_name in seen_subjects:
            continue
        seen_subjects.add(subject_name)
        unique_subjects.append(subject_name)

    items: list[CustomExplanationLibraryItem] = []
    for subject_name in unique_subjects:
        questions = _get_all_questions_for_subject(subject_name)
        for _, question in sorted(questions.items(), key=lambda item: str(item[0])):
            problem_id = str(question.get("id") or "")
            if not problem_id:
                continue
            explanation_data = custom_explanations_map.get(problem_id)
            if not explanation_data:
                continue

            prepared = _prepare_question_assets_for_client({**question, "subject": subject_name})
            custom_explanation = str(explanation_data.get("text") or "").strip()
            explanation_images = [
                value for value in (explanation_data.get("explanation_image_data_urls") or [])
                if isinstance(value, str) and value.strip()
            ]
            legacy_explanation_image = explanation_data.get("explanation_image_data_url") or explanation_data.get("image_data_url")
            if not explanation_images and isinstance(legacy_explanation_image, str) and legacy_explanation_image.strip():
                explanation_images = [legacy_explanation_image]
            question_images = [
                value for value in (explanation_data.get("question_image_data_urls") or [])
                if isinstance(value, str) and value.strip()
            ]
            legacy_question_image = explanation_data.get("question_image_data_url")
            if not question_images and isinstance(legacy_question_image, str) and legacy_question_image.strip():
                question_images = [legacy_question_image]
            if not custom_explanation and not explanation_images and not question_images:
                continue

            items.append(
                CustomExplanationLibraryItem(
                    subject=subject_name,
                    problem_id=problem_id,
                    question_text=str(prepared.get("question_text") or ""),
                    category=str(prepared.get("category")) if prepared.get("category") is not None else None,
                    custom_explanation=custom_explanation,
                    custom_explanation_image_data_urls=explanation_images,
                    custom_question_image_data_urls=question_images,
                    created_at=str(explanation_data.get("created_at")) if explanation_data.get("created_at") is not None else None,
                    updated_at=str(explanation_data.get("updated_at")) if explanation_data.get("updated_at") is not None else None,
                )
            )

    items.sort(key=lambda item: (item.subject, item.problem_id))
    return items

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


def _format_jst_lot_timestamp(value: str) -> str:
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value[:16].replace("T", " ")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.astimezone(TOKYO_TZ).strftime("%Y-%m-%d %H:%M")


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


def _append_jsonl_blob(blob_name: str, payload) -> None:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    line = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
    blob_client = container_client.get_blob_client(blob_name)
    try:
        if not blob_client.exists():
            try:
                blob_client.create_append_blob()
            except Exception as create_error:
                if not blob_client.exists():
                    raise create_error
        blob_client.append_block(line)
    except Exception as e:
        print(f"Error appending jsonl blob {blob_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to append {blob_name}.")


def _worry_practice_input_hash(concern_text: str) -> str:
    normalized = unicodedata.normalize("NFKC", concern_text).replace("\r\n", "\n").replace("\r", "\n").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _worry_practice_title(concern_text: str) -> str:
    for line in concern_text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        title = line.strip()
        if title:
            return title[:48]
    return "心配事演習"


def _load_worry_practice_versions() -> list[WorryPracticeVersion]:
    raw = _load_json_blob_or_default(WORRY_PRACTICE_VERSIONS_BLOB, [])
    if isinstance(raw, dict):
        raw = raw.get("versions", [])
    if not isinstance(raw, list):
        return []

    versions: list[WorryPracticeVersion] = []
    for item in raw:
        try:
            versions.append(WorryPracticeVersion.model_validate(item))
        except Exception as e:
            print(f"Skipping invalid worry practice version: {e}")
    versions.sort(key=lambda item: item.created_at, reverse=True)
    return versions


def _save_worry_practice_versions(versions: list[WorryPracticeVersion]) -> None:
    _save_json_blob(
        WORRY_PRACTICE_VERSIONS_BLOB,
        [version.model_dump() for version in sorted(versions, key=lambda item: item.created_at, reverse=True)],
    )


def _create_worry_practice_version(concern_text: str, count: int, quiz_set: list[dict]) -> WorryPracticeVersion:
    versions = _load_worry_practice_versions()
    input_hash = _worry_practice_input_hash(concern_text)
    next_version = 1 + max((item.version for item in versions if item.input_hash == input_hash), default=0)
    now_iso = _now_utc_iso()
    item = WorryPracticeVersion(
        id=f"worry-version-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}",
        input_hash=input_hash,
        version=next_version,
        title=_worry_practice_title(concern_text),
        concern_text=concern_text,
        count=count,
        question_count=len(quiz_set),
        quiz_set=quiz_set,
        created_at=now_iso,
        updated_at=now_iso,
    )
    _save_worry_practice_versions([item, *versions])
    return item


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
STUDY_SETTINGS_BLOB_NAME = "study-settings/settings.json"
DASHBOARD_PAST_EXAM_RECORDS_BLOB_NAME = "dashboard/past-exam-records.json"
DASHBOARD_PASS_PROBABILITY_ANALYSES_BLOB_NAME = "dashboard/pass-probability-analyses.jsonl"
DEFAULT_PAST_EXAM_SUBJECT_COLUMNS = [
    "財務・会計",
    "企業経営理論",
    "運営管理",
    "経営法務",
    "経営情報システム",
    "中小企業経営・中小企業政策",
]


def _default_past_exam_records_book() -> PastExamRecordsBook:
    return PastExamRecordsBook(
        subject_columns=list(DEFAULT_PAST_EXAM_SUBJECT_COLUMNS),
        problem_json_mappings={},
        rows=[],
        updated_at=None,
    )


def _normalize_past_exam_records_payload(raw) -> PastExamRecordsBook:
    if not isinstance(raw, dict):
        return _default_past_exam_records_book()

    columns: list[str] = []
    seen_columns: set[str] = set()
    raw_columns = raw.get("subject_columns")
    if not isinstance(raw_columns, list) or not raw_columns:
        raw_columns = DEFAULT_PAST_EXAM_SUBJECT_COLUMNS

    for item in raw_columns:
        if not isinstance(item, str):
            continue
        column = item.strip()[:80]
        if not column or column in seen_columns:
            continue
        seen_columns.add(column)
        columns.append(column)

    if not columns:
        columns = list(DEFAULT_PAST_EXAM_SUBJECT_COLUMNS)

    problem_json_mappings: dict[str, list[str]] = {}
    raw_mappings = raw.get("problem_json_mappings")
    if isinstance(raw_mappings, dict):
        for column in columns:
            raw_subjects = raw_mappings.get(column)
            if not isinstance(raw_subjects, list):
                continue
            mapped_subjects: list[str] = []
            seen_subjects: set[str] = set()
            for item in raw_subjects:
                if not isinstance(item, str):
                    continue
                subject_name = item.strip()[:200]
                if not subject_name or subject_name in seen_subjects:
                    continue
                seen_subjects.add(subject_name)
                mapped_subjects.append(subject_name)
            if mapped_subjects:
                problem_json_mappings[column] = mapped_subjects

    rows: list[PastExamRecordRow] = []
    seen_row_ids: set[str] = set()
    raw_rows = raw.get("rows", [])
    if isinstance(raw_rows, list):
        for raw_row in raw_rows:
            if not isinstance(raw_row, dict):
                continue
            label = str(raw_row.get("label") or "").strip()[:80]
            if not label:
                continue
            row_id = str(raw_row.get("id") or f"record-{uuid.uuid4().hex[:12]}").strip()
            if not row_id or row_id in seen_row_ids:
                row_id = f"record-{uuid.uuid4().hex[:12]}"
            seen_row_ids.add(row_id)

            cells: dict[str, PastExamRecordCell] = {}
            raw_cells = raw_row.get("cells", {})
            if isinstance(raw_cells, dict):
                for column in columns:
                    raw_cell = raw_cells.get(column)
                    if not isinstance(raw_cell, dict):
                        continue
                    try:
                        cell = PastExamRecordCell.model_validate(raw_cell)
                    except Exception as e:
                        print(f"Skipping invalid past exam cell: {e}")
                        continue
                    if cell.attempted_at or cell.score is not None:
                        cells[column] = cell

            rows.append(PastExamRecordRow(id=row_id, label=label, cells=cells))

    updated_at = raw.get("updated_at")
    if not isinstance(updated_at, str):
        updated_at = None

    return PastExamRecordsBook(
        subject_columns=columns,
        problem_json_mappings=problem_json_mappings,
        rows=rows,
        updated_at=updated_at,
    )


def _load_past_exam_records_book() -> PastExamRecordsBook:
    raw = _load_json_blob_or_default(
        DASHBOARD_PAST_EXAM_RECORDS_BLOB_NAME,
        _default_past_exam_records_book().model_dump(),
    )
    return _normalize_past_exam_records_payload(raw)


def _save_past_exam_records_book(book: PastExamRecordsBook) -> PastExamRecordsBook:
    normalized = _normalize_past_exam_records_payload(book.model_dump())
    normalized.updated_at = _now_utc_iso()
    _save_json_blob(DASHBOARD_PAST_EXAM_RECORDS_BLOB_NAME, normalized.model_dump())
    return normalized


def _clamp_percentage(value: float) -> float:
    return max(0.0, min(100.0, value))


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def _readiness_curve_probability(expected_score: float, passing_score: float) -> float:
    score_gap = passing_score - expected_score
    try:
        probability = 100.0 / (1.0 + math.exp(score_gap / 6.5))
    except OverflowError:
        probability = 0.0 if score_gap > 0 else 100.0
    return _clamp_percentage(probability)


def _calibrated_pass_probability(expected_score: float, passing_score: float, stddev: float) -> float:
    if stddev <= 0:
        return 0.0

    distribution_probability = _clamp_percentage(
        (1.0 - _normal_cdf((passing_score - expected_score) / stddev)) * 100.0
    )
    # The normal approximation can collapse to 0% while a learner is still building evidence.
    # Keep a soft score-gap curve as a lower signal for a planning dashboard.
    curve_probability = _readiness_curve_probability(expected_score, passing_score)
    return _clamp_percentage(max(distribution_probability, curve_probability))


def _parse_exam_date(value: Optional[str]) -> Optional[datetime.date]:
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(value[:10])
    except ValueError:
        return None


def _days_until_exam(exam_date: Optional[str]) -> Optional[int]:
    target_date = _parse_exam_date(exam_date)
    if target_date is None:
        return None
    today = datetime.datetime.now(TOKYO_TZ).date()
    return max(0, (target_date - today).days)


def _subject_practice_attempts(
    item: SubjectPassProbabilityItem,
    passing_score: float,
) -> tuple[int, str, str]:
    unanswered = max(0, item.total_problems - item.answered_problems)
    score_gap = max(0.0, passing_score - item.expected_score)
    if item.total_problems <= 0:
        return 0, "対象なし", "問題数が0件のため推奨演習はありません。"

    coverage_attempts = unanswered
    weak_attempts = item.weak_problem_count * (2 if score_gap > 0 else 1)
    gap_attempts = math.ceil((score_gap / 100.0) * item.total_problems * 2.4)
    maintenance_attempts = math.ceil(max(0, item.total_problems - item.answered_problems) * 0.2)

    if score_gap > 0:
        recommended = max(gap_attempts, coverage_attempts + weak_attempts)
    elif item.weak_problem_count > 0 or unanswered > 0:
        recommended = weak_attempts + maintenance_attempts
    else:
        recommended = 0

    if score_gap > 0 and unanswered > 0:
        focus = "未実施と弱点"
        reason = f"推定得点が合格ラインまで{score_gap:.1f}点不足し、未実施{unanswered}問と弱点{item.weak_problem_count}問を優先します。"
    elif score_gap > 0:
        focus = "弱点補強"
        reason = f"推定得点が合格ラインまで{score_gap:.1f}点不足しているため、弱点{item.weak_problem_count}問を厚めに回します。"
    elif item.weak_problem_count > 0:
        focus = "維持と弱点"
        reason = f"合格ラインは超えていますが、弱点{item.weak_problem_count}問を短い間隔で確認します。"
    elif unanswered > 0:
        focus = "未実施確認"
        reason = f"合格ラインは超えていますが、未実施{unanswered}問を薄く確認します。"
    else:
        focus = "維持"
        reason = "現状は合格ライン以上のため、追加推奨演習は最小です。"

    return int(max(0, recommended)), focus, reason


def _build_practice_plan(
    subject_breakdown: list[SubjectPassProbabilityItem],
    passing_score: float,
    exam_name: Optional[str],
    exam_date: Optional[str],
    daily_practice_capacity: int,
) -> PassProbabilityPracticePlan:
    days_to_exam = _days_until_exam(exam_date)
    normalized_capacity = max(1, min(500, daily_practice_capacity))
    recommendations: list[SubjectPracticeRecommendation] = []
    total_recommended = 0

    for item in subject_breakdown:
        recommended_attempts, focus, reason = _subject_practice_attempts(item, passing_score)
        total_recommended += recommended_attempts
        daily_attempts = (
            round(recommended_attempts / days_to_exam, 1)
            if days_to_exam and days_to_exam > 0
            else None
        )
        recommendations.append(SubjectPracticeRecommendation(
            subject=item.subject,
            recommended_attempts=recommended_attempts,
            daily_attempts=daily_attempts,
            score_gap=round(max(0.0, passing_score - item.expected_score), 1),
            focus=focus,
            reason=reason,
        ))

    recommendations.sort(key=lambda item: (-item.recommended_attempts, item.subject))
    recommended_daily = (
        round(total_recommended / days_to_exam, 1)
        if days_to_exam and days_to_exam > 0
        else None
    )
    feasible = None
    time_adjustment_factor = 1.0
    if days_to_exam is not None:
        if total_recommended <= 0:
            feasible = True
            time_adjustment_factor = 1.04
        elif days_to_exam <= 0:
            feasible = False
            time_adjustment_factor = 0.72
        else:
            capacity_until_exam = days_to_exam * normalized_capacity
            coverage_ratio = capacity_until_exam / max(1, total_recommended)
            feasible = coverage_ratio >= 1.0
            if coverage_ratio >= 1.25:
                time_adjustment_factor = 1.06
            elif coverage_ratio >= 1.0:
                time_adjustment_factor = 1.0
            else:
                time_adjustment_factor = max(0.62, 0.72 + (0.28 * coverage_ratio))

    return PassProbabilityPracticePlan(
        exam_name=exam_name.strip()[:120] if isinstance(exam_name, str) and exam_name.strip() else None,
        exam_date=exam_date[:10] if _parse_exam_date(exam_date) else None,
        days_to_exam=days_to_exam,
        daily_practice_capacity=normalized_capacity,
        total_recommended_attempts=total_recommended,
        recommended_daily_attempts=recommended_daily,
        feasible_by_exam_date=feasible,
        time_adjustment_factor=round(time_adjustment_factor, 2),
        subject_recommendations=recommendations,
    )


def _first_attempt_correct_rate(history_by_problem: dict[str, list[HistoryItem]]) -> Optional[float]:
    first_attempts: list[HistoryItem] = []
    for problem_history in history_by_problem.values():
        if not problem_history:
            continue
        first_attempts.append(min(problem_history, key=lambda item: item.answered_at))

    if not first_attempts:
        return None

    return sum(1 for item in first_attempts if item.is_correct) / len(first_attempts)


def _unanswered_mastery_estimate(first_attempt_rate: Optional[float]) -> float:
    if first_attempt_rate is None:
        return 0.20
    return max(0.05, min(0.95, first_attempt_rate))


def _estimated_problem_mastery(
    history_items: list[HistoryItem],
    unanswered_estimate: float = 0.20,
    analysis_policy: PassProbabilityAnalysisPolicy = "coverage_adjusted",
) -> float:
    if not history_items:
        return unanswered_estimate

    ordered_items = sorted(history_items, key=lambda item: item.answered_at)
    attempts = len(ordered_items)
    correct_count = sum(1 for item in ordered_items if item.is_correct)
    smoothed_rate = (correct_count + 1.0) / (attempts + 2.0)

    recent_items = list(reversed(ordered_items[-5:]))
    weighted_correct = 0.0
    weight_total = 0.0
    recent_decay = 0.55 if analysis_policy == "answered_recent_weighted" else 0.72
    for index, item in enumerate(recent_items):
        weight = recent_decay ** index
        weight_total += weight
        if item.is_correct:
            weighted_correct += weight
    recent_rate = weighted_correct / weight_total if weight_total else smoothed_rate
    last_signal = 1.0 if ordered_items[-1].is_correct else 0.0

    if analysis_policy == "answered_recent_weighted":
        estimate = (0.25 * smoothed_rate) + (0.60 * recent_rate) + (0.15 * last_signal)
    else:
        estimate = (0.55 * smoothed_rate) + (0.35 * recent_rate) + (0.10 * last_signal)
    return max(0.05, min(0.98, estimate))


def _pass_probability_from_estimates(estimates: list[float], passing_score: float) -> tuple[float, float, float, float]:
    if not estimates:
        return 0.0, 0.0, 0.0, 0.0

    expected_score = (sum(estimates) / len(estimates)) * 100.0
    variance = sum(p * (1.0 - p) for p in estimates)
    stddev = (math.sqrt(variance) / len(estimates)) * 100.0
    stddev = max(1.5, stddev)
    raw_probability = _calibrated_pass_probability(expected_score, passing_score, stddev)
    return expected_score, stddev, raw_probability, variance


def _parse_past_exam_attempted_at(value: Optional[str]) -> datetime.datetime:
    if not value:
        return datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    if parsed.tzinfo is None:
        parsed = TOKYO_TZ.localize(parsed)
    return parsed.astimezone(datetime.timezone.utc)


def _build_past_exam_record_evidence(
    include_records: bool,
    selected_columns: Optional[list[str]],
    requested_weight: float,
    target_subjects: Optional[list[str]] = None,
) -> PastExamRecordEvidence:
    if not include_records:
        return PastExamRecordEvidence(included=False)

    book = _load_past_exam_records_book()
    available_columns = set(book.subject_columns)
    candidate_columns = [
        column for column in (selected_columns or book.subject_columns)
        if column in available_columns
    ]
    if not candidate_columns:
        candidate_columns = list(book.subject_columns)

    target_subject_set = {
        subject.strip()
        for subject in (target_subjects or [])
        if subject and subject.strip()
    }
    has_candidate_mappings = any(book.problem_json_mappings.get(column) for column in candidate_columns)
    mapping_applied = False
    ignored_columns: list[str] = []
    columns = candidate_columns
    if target_subject_set and has_candidate_mappings:
        mapping_applied = True
        columns = [
            column for column in candidate_columns
            if target_subject_set.intersection(book.problem_json_mappings.get(column, []))
        ]
        ignored_columns = [column for column in candidate_columns if column not in columns]

    used_mappings = {
        column: list(book.problem_json_mappings.get(column, []))
        for column in columns
        if book.problem_json_mappings.get(column)
    }

    score_items: list[tuple[datetime.datetime, float]] = []
    for row in book.rows:
        for column in columns:
            cell = row.cells.get(column)
            if not cell or cell.score is None:
                continue
            score_items.append((_parse_past_exam_attempted_at(cell.attempted_at), float(cell.score)))

    requested_weight = max(0.0, min(1.0, requested_weight))
    if not score_items:
        return PastExamRecordEvidence(
            included=True,
            columns=columns,
            problem_json_mappings=used_mappings,
            mapping_applied=mapping_applied,
            ignored_columns=ignored_columns,
            record_count=0,
            requested_weight=round(requested_weight, 2),
            effective_weight=0.0,
        )

    scores = [score for _attempted_at, score in score_items]
    average_score = sum(scores) / len(scores)
    recent_first = sorted(score_items, key=lambda item: item[0], reverse=True)
    weighted_sum = 0.0
    weight_sum = 0.0
    for index, (_attempted_at, score) in enumerate(recent_first):
        weight = 0.85 ** index
        weighted_sum += score * weight
        weight_sum += weight
    weighted_score = weighted_sum / weight_sum if weight_sum else average_score
    enough_records = max(3, len(columns))
    record_confidence = min(1.0, len(score_items) / enough_records)
    effective_weight = requested_weight * record_confidence

    return PastExamRecordEvidence(
        included=True,
        columns=columns,
        problem_json_mappings=used_mappings,
        mapping_applied=mapping_applied,
        ignored_columns=ignored_columns,
        record_count=len(score_items),
        average_score=round(average_score, 1),
        weighted_score=round(weighted_score, 1),
        requested_weight=round(requested_weight, 2),
        effective_weight=round(effective_weight, 2),
    )


def _save_pass_probability_analysis(
    response: PassProbabilityResponse,
    include_past_exam_records: bool,
    past_exam_weight: float,
    exam_name: Optional[str] = None,
    exam_date: Optional[str] = None,
    daily_practice_capacity: int = 20,
) -> PassProbabilityAnalysisRecord:
    record = PassProbabilityAnalysisRecord(
        id=response.analysis_id,
        saved_at=_now_utc_iso(),
        request=PassProbabilityAnalysisRequestSnapshot(
            subjects=response.subjects,
            passing_score=response.passing_score,
            analysis_policy=response.analysis_policy,
            include_past_exam_records=include_past_exam_records,
            past_exam_columns=response.past_exam_records.columns if include_past_exam_records else [],
            past_exam_weight=round(max(0.0, min(1.0, past_exam_weight)), 2),
            exam_name=exam_name.strip()[:120] if isinstance(exam_name, str) and exam_name.strip() else None,
            exam_date=exam_date[:10] if _parse_exam_date(exam_date) else None,
            daily_practice_capacity=max(1, min(500, daily_practice_capacity)),
        ),
        result=response,
    )
    _append_jsonl_blob(DASHBOARD_PASS_PROBABILITY_ANALYSES_BLOB_NAME, record.model_dump())
    return record


def _pass_probability_history_sort_key(value: str) -> float:
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed.timestamp()


def _load_pass_probability_history(limit: int = 20) -> list[PassProbabilityHistoryItem]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(DASHBOARD_PASS_PROBABILITY_ANALYSES_BLOB_NAME)
    if not blob_client.exists():
        return []

    try:
        raw_content = blob_client.download_blob().readall().decode("utf-8")
    except Exception as e:
        print(f"Error reading pass probability history: {e}")
        raise HTTPException(status_code=500, detail="Failed to read pass probability history.")

    items: list[tuple[float, int, PassProbabilityHistoryItem]] = []
    for index, line in enumerate(raw_content.splitlines()):
        if not line.strip():
            continue
        try:
            record = PassProbabilityAnalysisRecord.model_validate(json.loads(line))
        except Exception as e:
            print(f"Skipping invalid pass probability history line: {e}")
            continue

        analyzed_at = record.result.analyzed_at or record.saved_at
        items.append((
            _pass_probability_history_sort_key(analyzed_at),
            index,
            PassProbabilityHistoryItem(
                analysis_id=record.id,
                analyzed_at=analyzed_at,
                pass_probability=record.result.pass_probability,
            ),
        ))

    items.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [item for _sort_key, _index, item in items[:limit]]


def _build_pass_probability_response(
    subject_names: list[str],
    passing_score: float,
    analysis_policy: PassProbabilityAnalysisPolicy = "coverage_adjusted",
    include_past_exam_records: bool = False,
    past_exam_columns: Optional[list[str]] = None,
    past_exam_weight: float = 0.35,
    exam_name: Optional[str] = None,
    exam_date: Optional[str] = None,
    daily_practice_capacity: int = 20,
) -> PassProbabilityResponse:
    unique_subjects: list[str] = []
    seen_subjects: set[str] = set()
    for subject in subject_names:
        subject_name = subject.strip()
        if not subject_name or subject_name in seen_subjects:
            continue
        seen_subjects.add(subject_name)
        unique_subjects.append(subject_name)

    passing_score = _clamp_percentage(passing_score)
    passing_rate = passing_score / 100.0
    all_estimates: list[float] = []
    total_problems = 0
    answered_problem_count = 0
    total_attempts = 0
    correct_attempts = 0
    weak_problem_count = 0
    strong_problem_count = 0
    subject_breakdown: list[SubjectPassProbabilityItem] = []

    for subject_name in unique_subjects:
        try:
            history_items = _get_history_items_for_subject(subject_name)
            if subject_name == WORRY_PRACTICE_SUBJECT_NAME:
                question_ids = sorted({item.problem_id for item in history_items})
            else:
                question_ids = sorted(_get_all_questions_for_subject(subject_name).keys())
        except Exception as e:
            print(f"Warning: failed to build pass probability for {subject_name}: {e}")
            continue

        if not question_ids:
            subject_breakdown.append(SubjectPassProbabilityItem(
                subject=subject_name,
                total_problems=0,
                answered_problems=0,
                coverage_rate=0.0,
                total_attempts=0,
                correct_attempts=0,
                accuracy_rate=0.0,
                average_attempts_per_answered=0.0,
                expected_score=0.0,
                pass_probability=0.0,
                weak_problem_count=0,
                strong_problem_count=0,
            ))
            continue

        question_id_set = set(question_ids)
        history_by_problem: dict[str, list[HistoryItem]] = {problem_id: [] for problem_id in question_ids}
        for item in history_items:
            if item.problem_id in question_id_set:
                history_by_problem[item.problem_id].append(item)
        subject_first_attempt_rate = _first_attempt_correct_rate(history_by_problem)
        subject_unanswered_estimate = _unanswered_mastery_estimate(subject_first_attempt_rate)

        subject_estimates: list[float] = []
        subject_attempts = 0
        subject_correct_attempts = 0
        subject_answered = 0
        subject_weak = 0
        subject_strong = 0
        for problem_id in question_ids:
            problem_history = history_by_problem.get(problem_id, [])
            if not problem_history and analysis_policy == "answered_recent_weighted":
                continue
            estimate = _estimated_problem_mastery(
                problem_history,
                subject_unanswered_estimate,
                analysis_policy=analysis_policy,
            )
            subject_estimates.append(estimate)
            if problem_history:
                subject_answered += 1
                problem_correct = sum(1 for item in problem_history if item.is_correct)
                subject_attempts += len(problem_history)
                subject_correct_attempts += problem_correct
                if estimate < passing_rate:
                    subject_weak += 1
                if len(problem_history) >= 2 and estimate >= max(passing_rate, 0.75):
                    subject_strong += 1

        subject_expected, _subject_stddev, subject_probability, _subject_variance = _pass_probability_from_estimates(
            subject_estimates,
            passing_score,
        )
        subject_coverage = (subject_answered / len(question_ids)) * 100.0
        subject_accuracy = (subject_correct_attempts / subject_attempts) * 100.0 if subject_attempts else 0.0
        subject_average_attempts = subject_attempts / subject_answered if subject_answered else 0.0
        subject_breakdown.append(SubjectPassProbabilityItem(
            subject=subject_name,
            total_problems=len(question_ids),
            answered_problems=subject_answered,
            coverage_rate=round(subject_coverage, 1),
            total_attempts=subject_attempts,
            correct_attempts=subject_correct_attempts,
            accuracy_rate=round(subject_accuracy, 1),
            average_attempts_per_answered=round(subject_average_attempts, 2),
            expected_score=round(subject_expected, 1),
            pass_probability=round(subject_probability, 1),
            weak_problem_count=subject_weak,
            strong_problem_count=subject_strong,
        ))

        all_estimates.extend(subject_estimates)
        total_problems += len(question_ids)
        answered_problem_count += subject_answered
        total_attempts += subject_attempts
        correct_attempts += subject_correct_attempts
        weak_problem_count += subject_weak
        strong_problem_count += subject_strong

    base_expected_score, score_stddev, raw_probability, _variance = _pass_probability_from_estimates(all_estimates, passing_score)
    past_exam_evidence = _build_past_exam_record_evidence(
        include_records=include_past_exam_records,
        selected_columns=past_exam_columns,
        requested_weight=past_exam_weight,
        target_subjects=unique_subjects,
    )
    expected_score = base_expected_score
    if (
        past_exam_evidence.included and
        past_exam_evidence.weighted_score is not None and
        past_exam_evidence.effective_weight > 0
    ):
        expected_score = (
            base_expected_score * (1.0 - past_exam_evidence.effective_weight)
            + past_exam_evidence.weighted_score * past_exam_evidence.effective_weight
        )

    coverage_rate = (answered_problem_count / total_problems) * 100.0 if total_problems else 0.0
    accuracy_rate = (correct_attempts / total_attempts) * 100.0 if total_attempts else 0.0
    average_attempts = total_attempts / answered_problem_count if answered_problem_count else 0.0
    attempt_depth = min(1.0, total_attempts / max(1.0, total_problems * 2.0)) if total_problems else 0.0
    accuracy_signal = max(0.0, min(1.0, (accuracy_rate - 45.0) / 35.0)) if total_attempts else 0.0
    evidence_confidence = (0.55 * (coverage_rate / 100.0)) + (0.35 * attempt_depth) + (0.10 * accuracy_signal)
    if past_exam_evidence.included and past_exam_evidence.record_count > 0:
        evidence_confidence += 0.15 * min(1.0, past_exam_evidence.record_count / max(3, len(past_exam_evidence.columns)))
    evidence_confidence = max(0.0, min(1.0, evidence_confidence))
    raw_probability = _calibrated_pass_probability(expected_score, passing_score, score_stddev)
    pass_probability = raw_probability * (0.72 + (0.28 * evidence_confidence))
    if total_problems > 0 and expected_score > 0 and pass_probability > 0:
        pass_probability = max(0.1, pass_probability)

    practice_plan = _build_practice_plan(
        subject_breakdown=subject_breakdown,
        passing_score=passing_score,
        exam_name=exam_name,
        exam_date=exam_date,
        daily_practice_capacity=daily_practice_capacity,
    )
    if practice_plan.days_to_exam is not None:
        pass_probability *= practice_plan.time_adjustment_factor

    if total_problems == 0:
        readiness_label = "対象なし"
        recommendation = "対象問題jsonを選択してください。"
    elif pass_probability >= 75:
        readiness_label = "高い"
        recommendation = "合格ライン付近の問題を維持し、弱点問題を短い間隔で確認してください。"
    elif pass_probability >= 50:
        readiness_label = "十分狙える"
        recommendation = "未実施問題を減らしながら、直近で外した問題を優先すると安定します。"
    elif pass_probability >= 30:
        readiness_label = "要強化"
        recommendation = "進捗と正答率のどちらかが不足しています。未実施問題と弱点問題を先に潰してください。"
    else:
        readiness_label = "厳しめ"
        recommendation = "まず対象問題jsonの実施範囲を広げ、1問あたり2回以上の確認履歴を作ってください。"

    return PassProbabilityResponse(
        analysis_id=f"passprob-{uuid.uuid4().hex}",
        analysis_policy=analysis_policy,
        subjects=unique_subjects,
        passing_score=round(passing_score, 1),
        total_problems=total_problems,
        answered_problems=answered_problem_count,
        coverage_rate=round(coverage_rate, 1),
        total_attempts=total_attempts,
        correct_attempts=correct_attempts,
        accuracy_rate=round(accuracy_rate, 1),
        average_attempts_per_answered=round(average_attempts, 2),
        base_expected_score=round(base_expected_score, 1),
        expected_score=round(expected_score, 1),
        projected_score_low=round(_clamp_percentage(expected_score - score_stddev), 1),
        projected_score_high=round(_clamp_percentage(expected_score + score_stddev), 1),
        pass_probability=round(_clamp_percentage(pass_probability), 1),
        evidence_confidence=round(evidence_confidence * 100.0, 1),
        readiness_label=readiness_label,
        recommendation=recommendation,
        past_exam_records=past_exam_evidence,
        practice_plan=practice_plan,
        subject_breakdown=subject_breakdown,
        analyzed_at=_now_utc_iso(),
    )

def _normalize_study_settings_payload(raw) -> StudySettings:
    if not isinstance(raw, dict):
        raw = {}

    patterns: list[StudySubjectSelectionPattern] = []
    seen_pattern_ids: set[str] = set()
    for item in raw.get("subject_selection_patterns", []):
        try:
            pattern = StudySubjectSelectionPattern.model_validate(item)
        except Exception as e:
            print(f"Skipping invalid study subject pattern: {e}")
            continue

        pattern_id = pattern.id.strip()
        pattern_name = pattern.name.strip()
        if not pattern_id or not pattern_name or pattern_id in seen_pattern_ids:
            continue

        seen_pattern_ids.add(pattern_id)
        patterns.append(StudySubjectSelectionPattern(
            id=pattern_id,
            name=pattern_name,
            subjectNames=list(dict.fromkeys(name.strip() for name in pattern.subjectNames if name.strip())),
            createdAt=pattern.createdAt,
        ))

    default_subject_pattern_id = raw.get("default_subject_pattern_id")
    if not isinstance(default_subject_pattern_id, str) or default_subject_pattern_id not in seen_pattern_ids:
        default_subject_pattern_id = None

    default_quiz_mode = raw.get("default_quiz_mode")
    if default_quiz_mode not in ("random", "weak_area", "unanswered", "today_remaining", "specific_area", "worry_practice"):
        default_quiz_mode = "today_remaining"

    hidden_modes_raw = raw.get("hidden_study_action_modes", [])
    hidden_modes: list[StudyActionMode] = []
    allowed_hidden_modes = {"ipad_air", "ipad_mini", "paper_practice", "forced"}
    if isinstance(hidden_modes_raw, list):
        for mode in hidden_modes_raw:
            if mode in allowed_hidden_modes and mode not in hidden_modes:
                hidden_modes.append(mode)

    return StudySettings(
        subject_selection_patterns=patterns,
        default_subject_pattern_id=default_subject_pattern_id,
        default_quiz_mode=default_quiz_mode,
        hidden_study_action_modes=hidden_modes,
    )

def _load_study_settings() -> StudySettings:
    raw = _load_json_blob_or_default(STUDY_SETTINGS_BLOB_NAME, {})
    return _normalize_study_settings_payload(raw)

def _save_study_settings(settings: StudySettings) -> StudySettings:
    normalized = _normalize_study_settings_payload(settings.model_dump())
    _save_json_blob(STUDY_SETTINGS_BLOB_NAME, normalized.model_dump())
    return normalized

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

@api_router.get("/study-settings", response_model=StudySettings)
def get_study_settings():
    """端末をまたいで共有するStudy画面設定を取得する"""
    return _load_study_settings()

@api_router.post("/study-settings", response_model=StudySettings)
def save_study_settings(settings: StudySettings):
    """端末をまたいで共有するStudy画面設定をAzure Blob Storageに保存する"""
    return _save_study_settings(settings)


@api_router.get("/dashboard/past-exam-records", response_model=PastExamRecordsBook)
def get_past_exam_records():
    """過去問・模試の手入力記録を取得する"""
    return _load_past_exam_records_book()


@api_router.put("/dashboard/past-exam-records", response_model=PastExamRecordsBook)
def save_past_exam_records(book: PastExamRecordsBook):
    """過去問・模試の手入力記録をAzure Blob Storageに保存する"""
    return _save_past_exam_records_book(book)


@api_router.get("/dashboard/pass-probability/history", response_model=list[PassProbabilityHistoryItem])
def get_pass_probability_history(limit: int = Query(20, ge=1, le=100)):
    """合格可能性分析の過去履歴を新しい順に返す"""
    return _load_pass_probability_history(limit=limit)


@api_router.get("/dashboard/pass-probability", response_model=PassProbabilityResponse)
def get_pass_probability(
    subjects: list[str] = Query(...),
    passing_score: float = Query(60.0, ge=0, le=100),
    analysis_policy: PassProbabilityAnalysisPolicy = Query("coverage_adjusted"),
    include_past_exam_records: bool = False,
    past_exam_columns: Optional[List[str]] = Query(None),
    past_exam_weight: float = Query(0.35, ge=0, le=1),
    exam_name: Optional[str] = Query(None),
    exam_date: Optional[str] = Query(None),
    daily_practice_capacity: int = Query(20, ge=1, le=500),
):
    """選択された問題JSONの履歴と進捗から合格ライン到達可能性を返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    response = _build_pass_probability_response(
        subjects,
        passing_score,
        analysis_policy=analysis_policy,
        include_past_exam_records=include_past_exam_records,
        past_exam_columns=past_exam_columns,
        past_exam_weight=past_exam_weight,
        exam_name=exam_name,
        exam_date=exam_date,
        daily_practice_capacity=daily_practice_capacity,
    )
    _save_pass_probability_analysis(
        response,
        include_past_exam_records=include_past_exam_records,
        past_exam_weight=past_exam_weight,
        exam_name=exam_name,
        exam_date=exam_date,
        daily_practice_capacity=daily_practice_capacity,
    )
    return response


@api_router.get("/subjects")
def get_subjects():
    """Blob Storage内の科目（問題JSONファイル）リストを返す"""
    if container_client is None: return ["（Blob Storage未接続）"]
    try:
        # 科目一覧に不要な管理系JSONを含めない
        subjects = [
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
        if WORRY_PRACTICE_SUBJECT_NAME not in subjects:
            subjects.append(WORRY_PRACTICE_SUBJECT_NAME)
        return subjects
    except Exception as e:
        print(f"Error fetching subjects: {e}")
        return [f"（Blob接続エラー: {e}）"]

@api_router.get("/subjects/{subject_name:path}/categories", response_model=list[str])
def get_subject_categories(subject_name: str):
    """指定された科目に含まれるカテゴリの一覧を返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if subject_name == WORRY_PRACTICE_SUBJECT_NAME:
        return []
    
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
    gemini_unavailable_reason = get_gemini_unavailable_reason()
    if gemini_unavailable_reason:
        raise HTTPException(status_code=500, detail=gemini_unavailable_reason)
    if not request.memo_text:
        return []
        
    try:
        model = create_generative_model()
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


@api_router.post("/quiz/specific-area-suggestions", response_model=SpecificAreaSuggestionResponse)
def suggest_specific_area_keywords(request: SpecificAreaSuggestionRequest):
    base_keywords = _dedupe_preserve_order([kw for kw in request.keywords if isinstance(kw, str)])
    if not base_keywords:
        return SpecificAreaSuggestionResponse(suggestions=[], used_ai=False)

    gemini_unavailable_reason = get_gemini_unavailable_reason()
    if gemini_unavailable_reason:
        return SpecificAreaSuggestionResponse(suggestions=[], used_ai=False)

    try:
        model = create_generative_model()
        prompt = f"""
あなたは中小企業診断士試験に詳しい学習アシスタントです。
以下のキーワードに対して、近い論点として一緒に学ぶ価値が高い関連語を提案してください。

# 入力キーワード
{", ".join(base_keywords)}

# 指示
- 入力キーワードそのものは繰り返さない
- 中小企業診断士試験の学習で同じ論点群として扱いやすい語だけを挙げる
- 広げすぎない
- 1語または短い複合語で出す
- 最大8個
- 必ずカンマ区切りの単一文字列のみを返す
"""
        response = model.generate_content(prompt)
        suggestions = _dedupe_preserve_order([
            part.strip() for part in response.text.strip().split(",") if part.strip()
        ])
        filtered = [
            suggestion for suggestion in suggestions
            if _normalize_keyword_value(suggestion) not in {_normalize_keyword_value(keyword) for keyword in base_keywords}
        ]
        return SpecificAreaSuggestionResponse(suggestions=filtered[:8], used_ai=True)
    except Exception as e:
        print(f"Error suggesting specific area keywords: {e}")
        return SpecificAreaSuggestionResponse(suggestions=[], used_ai=False)


def _coerce_score(value, default_value: int = 50) -> int:
    try:
        as_int = int(value)
        return max(0, min(100, as_int))
    except Exception:
        return default_value


def _sanitize_question_help_conversation(turns: list[OralVivaTurn]) -> list[dict[str, str]]:
    sanitized: list[dict[str, str]] = []
    for turn in turns[-12:]:
        content = str(turn.content or "").strip()
        if not content:
            continue
        sanitized.append({
            "role": "assistant" if turn.role == "assistant" else "user",
            "content": content[:1200],
        })
    return sanitized


def _fallback_question_help_response(request: QuestionHelpRequest) -> dict:
    was_correct = request.question.was_correct
    correct_answer = request.question.correct_answer or "未設定"
    selected_answer = request.question.selected_answer or "未回答"
    explanation_text = (request.question.explanation_text or "").strip()

    if was_correct is True:
        opening = f"この問題では、あなたの回答 {selected_answer} は正解です。"
    elif was_correct is False:
        opening = f"この問題では、正解は {correct_answer}、あなたの回答は {selected_answer} でした。"
    else:
        opening = f"この問題では、正解候補は {correct_answer} です。"

    explanation_part = (
        f"解説ベースでは「{explanation_text[:180]}」がポイントです。"
        if explanation_text
        else "手元の解説情報は少ないため、問題文と正解情報を軸に整理します。"
    )

    return {
        "assistant_message": (
            f"{opening} {explanation_part} "
            "知りたいのが「なぜその選択肢になるか」「他の選択肢が違う理由か」「覚え方か」を絞ってもらえると、さらに具体的に答えられます。"
        ).strip(),
        "suggested_followups": [
            "正解になる根拠を短く教えて",
            "他の選択肢が違う理由は？",
            "次に同じ論点が出たときの見分け方は？",
        ],
        "used_ai": False,
    }


def _ask_question_help_with_ai(request: QuestionHelpRequest) -> dict:
    transcript_lines = []
    for turn in _sanitize_question_help_conversation(request.conversation):
        role = "学習者" if turn["role"] == "user" else "AI講師"
        transcript_lines.append(f"{role}: {turn['content']}")
    transcript = "\n".join(transcript_lines) or "(なし)"

    prompt = f"""
あなたは学習者の疑問解消を支援する、簡潔で親切なAI講師です。
以下の問題情報と会話履歴だけを根拠に、日本語で回答してください。
口頭試問ではありません。ユーザーの疑問に直接答えることを最優先し、会話を無理に引き延ばさないでください。

# 問題情報
- 問題ID: {request.question.problem_id}
- 問題文: {request.question.question_text}
- 正解: {request.question.correct_answer or "(未指定)"}
- ユーザー回答: {request.question.selected_answer or "(未回答)"}
- 正誤: {"正解" if request.question.was_correct else "不正解" if request.question.was_correct is False else "不明"}
- 解説: {request.question.explanation_text or "(なし)"}

# 既存会話
{transcript}

# 今回の質問
{request.user_message}

# 出力ルール
- 必ずJSONオブジェクト1つのみを返す。
- assistant_message は150〜400字程度で、質問に直接答える。
- 情報が足りない場合は、足りないと明示した上で分かる範囲を説明する。
- 試問のような採点・評価・圧迫感のある表現は使わない。
- suggested_followups には次に聞くと理解が深まりやすい短い質問を3件返す。

# JSONスキーマ
{{
  "assistant_message": "string",
  "suggested_followups": ["string"],
  "used_ai": true
}}
"""
    model = create_generative_model()
    response = model.generate_content(prompt)
    raw_text = (response.text or "").strip()

    json_text = raw_text
    if not json_text.startswith("{"):
        start = json_text.find("{")
        end = json_text.rfind("}")
        if start >= 0 and end > start:
            json_text = json_text[start:end + 1]

    payload = json.loads(json_text)
    return {
        "assistant_message": str(payload.get("assistant_message") or "").strip(),
        "suggested_followups": [str(x) for x in (payload.get("suggested_followups") or []) if str(x).strip()][:3],
        "used_ai": True,
    }


@api_router.post("/quiz/oral-viva/step", response_model=OralVivaStepResponse)
def generate_oral_viva_step(request: OralVivaStepRequest):
    """解説後に任意で実行する、1問単位の口頭試問ターンを生成する。"""
    gemini_unavailable_reason = get_gemini_unavailable_reason()
    if gemini_unavailable_reason:
        raise HTTPException(status_code=500, detail=gemini_unavailable_reason)

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
        model = create_generative_model()
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


@api_router.post("/quiz/question-help", response_model=QuestionHelpResponse)
def generate_question_help(request: QuestionHelpRequest):
    gemini_unavailable_reason = get_gemini_unavailable_reason()

    try:
        payload = (
            _ask_question_help_with_ai(request)
            if not gemini_unavailable_reason
            else _fallback_question_help_response(request)
        )
    except Exception as e:
        print(f"Error generating question help: {e}")
        payload = _fallback_question_help_response(request)

    assistant_message = str(payload.get("assistant_message") or "").strip()
    if not assistant_message:
        payload = _fallback_question_help_response(request)
        assistant_message = str(payload.get("assistant_message") or "").strip()

    return QuestionHelpResponse(
        assistant_message=assistant_message,
        suggested_followups=[str(x) for x in (payload.get("suggested_followups") or []) if str(x).strip()][:3],
        used_ai=bool(payload.get("used_ai")),
    )

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
def get_unanswered_count(
    subjects: list[str] = Query(...),
    tag_filter: QuestionTagFilter = Query("all"),
):
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
    
    all_questions = _filter_questions_by_tag_filter(all_questions, tag_filter)
    answered_problem_ids = {item.problem_id for item in history_items}
    count = sum(1 for q in all_questions if q.get("id") not in answered_problem_ids)
    
    return {"unanswered_count": count}

@api_router.get("/quiz/missed-problems-count")
def get_missed_problems_count(
    subjects: list[str] = Query(...),
    tag_filter: QuestionTagFilter = Query("all"),
):
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

    if tag_filter != "all":
        eligible_questions = []
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
                        eligible_questions.append(normalized_q)
        except Exception as e:
            print(f"Error reading quiz data for missed problems count: {e}")
            raise HTTPException(status_code=500, detail="Failed to read questions from blob storage for count.")

        eligible_questions = _filter_questions_by_tag_filter(eligible_questions, tag_filter)
        eligible_problem_ids = {q.get("id") for q in eligible_questions}
        missed_problem_ids = missed_problem_ids & eligible_problem_ids

    count = len(missed_problem_ids)
    
    return {"missed_problems_count": count}


@api_router.get("/quiz/specific-area-count")
def get_specific_area_count(
    subjects: list[str] = Query(...),
    keywords: list[str] = Query(...),
    history_scope: SpecificAreaHistoryScope = Query("all"),
    tag_filter: QuestionTagFilter = Query("all"),
):
    """指定された科目セットに対して、特定キーワードに一致する問題数を返す"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not subjects:
        return {"specific_area_count": 0}

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
        print(f"Error reading quiz data for specific-area count: {e}")
        raise HTTPException(status_code=500, detail="Failed to read questions from blob storage for count.")

    custom_explanations_map = _load_custom_explanations_map()
    matched_questions = _filter_questions_by_keywords(all_questions, keywords, custom_explanations_map)
    history_items: list[HistoryItem] = []
    for subject_name in subjects:
        history_items.extend(_get_history_items_for_subject(subject_name))
    matched_questions = _filter_questions_by_history_scope(matched_questions, history_items, history_scope)
    matched_questions = _filter_questions_by_tag_filter(matched_questions, tag_filter)
    return {"specific_area_count": len(matched_questions)}

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

    working_questions = _filter_questions_by_tag_filter(all_questions, request.tag_filter)
    if request.mode == "specific_area":
        if not request.keywords:
            raise HTTPException(status_code=400, detail="特定領域モードではキーワードを1つ以上指定してください。")
        custom_explanations_map = _load_custom_explanations_map()
        working_questions = _filter_questions_by_keywords(working_questions, request.keywords, custom_explanations_map)
        history_items: list[HistoryItem] = []
        for subject_name in request.subjects:
            history_items.extend(_get_history_items_for_subject(subject_name))
        working_questions = _filter_questions_by_history_scope(
            working_questions,
            history_items,
            request.specific_area_history_scope,
        )

    if not working_questions:
        return {"quiz_set": []}

    num_to_select = min(request.count, len(working_questions))
    selected_questions = []

    if request.mode == "weak_area":
        history_items = []
        for subject_name in request.subjects:
            history_items.extend(_get_history_items_for_subject(subject_name))
        
        problem_statuses = get_problem_study_statuses(history_items)
        
        problems_with_priority = []
        current_time = datetime.datetime.now(datetime.timezone.utc)
        for q in working_questions:
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
        unanswered_questions = [q for q in working_questions if q.get("id") not in answered_problem_ids]
        random.shuffle(unanswered_questions)
        selected_questions = unanswered_questions[:num_to_select]
    
    elif request.mode == "random" and request.weights:
        weight_map = {
            'light': 1,
            'normal': 3,
            'heavy': 9
        }
        
        question_weights = [weight_map.get(request.weights.get(q['subject'], 'normal'), 3) for q in working_questions]
        
        # 重複を許さずに重み付きランダムサンプリングを行う
        # まずインデックスと重みのペアを作成
        indexed_weights = list(zip(range(len(working_questions)), question_weights))
        
        selected_indices = []
        if len(working_questions) > 0 and sum(question_weights) > 0:
            # selected_indices = random.choices(range(len(working_questions)), weights=question_weights, k=num_to_select)
             # 重み付きサンプリング（重複なし）
            population = list(range(len(working_questions)))
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

        selected_questions = [working_questions[i] for i in selected_indices]
        random.shuffle(selected_questions) # 最終的な出題順はシャッフルする
    
    else:  # Default to random mode
        random.shuffle(working_questions)
        selected_questions = working_questions[:num_to_select]
    
    for i, q in enumerate(selected_questions):
        selected_questions[i] = _prepare_question_for_client(q)

    return {"quiz_set": selected_questions}


@api_router.get("/paper-practice/lots", response_model=list[PaperPracticeLot])
def list_paper_practice_lots():
    """紙演習用のPDF出力単位（ロット）を新しい順に返す。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    lots: list[PaperPracticeLot] = []
    try:
        for blob in container_client.list_blobs(name_starts_with=f"{PAPER_PRACTICE_LOTS_DIR}/"):
            blob_name = getattr(blob, "name", "")
            if not blob_name.endswith(".json"):
                continue
            lot = _load_paper_practice_lot(blob_name)
            if lot is not None:
                lots.append(lot)
    except Exception as e:
        print(f"Error listing paper practice lots: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list paper practice lots: {e}")

    lots.sort(key=lambda item: item.created_at, reverse=True)
    return lots


@api_router.post("/paper-practice/lots", response_model=PaperPracticeLot)
def create_paper_practice_lot(request: PaperPracticeLotCreateRequest):
    """現在の演習設定から紙演習ロットを作成して保存する。"""
    quiz_request = QuizStartRequest.model_validate(request.model_dump())
    quiz_payload = start_quiz(quiz_request)
    quiz_set = quiz_payload.get("quiz_set", [])
    if not quiz_set:
        raise HTTPException(status_code=400, detail="紙演習ロットにできる問題がありません。")

    lot_id = uuid.uuid4().hex
    created_at = _now_utc_iso()
    title = (request.title or "").strip() or f"紙演習ロット {_format_jst_lot_timestamp(created_at)}"
    lot = PaperPracticeLot(
        id=lot_id,
        title=title,
        created_at=created_at,
        subjects=request.subjects,
        mode=request.mode,
        source_mode=request.source_mode,
        count=len(quiz_set),
        tag_filter=request.tag_filter,
        questions=quiz_set,
    )
    _save_paper_practice_lot(lot)
    return lot


@api_router.delete("/paper-practice/lots/{lot_id}", status_code=204)
def delete_paper_practice_lot(lot_id: str):
    """紙演習ロットを削除する。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    blob_client = container_client.get_blob_client(_paper_practice_lot_blob_name(lot_id))
    if not blob_client.exists():
        raise HTTPException(status_code=404, detail="Paper practice lot not found.")

    try:
        blob_client.delete_blob()
    except Exception as e:
        print(f"Error deleting paper practice lot {lot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete paper practice lot: {e}")


@api_router.get("/paper-practice/lots/{lot_id}/attempts", response_model=list[PaperPracticeAttempt])
def list_paper_practice_attempts(lot_id: str):
    """紙演習ロットごとの採点履歴を新しい順に返す。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    attempts: list[PaperPracticeAttempt] = []
    try:
        prefix = f"{PAPER_PRACTICE_ATTEMPTS_DIR}/{lot_id}/"
        for blob in container_client.list_blobs(name_starts_with=prefix):
            if not blob.name.endswith(".json"):
                continue
            attempt = _load_paper_practice_attempt(blob.name)
            if attempt:
                attempts.append(attempt)
    except Exception as e:
        print(f"Error listing paper practice attempts for {lot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list paper practice attempts: {e}")

    attempts.sort(key=lambda item: item.created_at, reverse=True)
    return attempts


@api_router.post("/paper-practice/lots/{lot_id}/grade", response_model=PaperPracticeAttempt)
def grade_paper_practice_lot(lot_id: str, request: PaperPracticeGradeRequest):
    """紙演習ロットを一括採点し、通常履歴とロット別採点履歴の両方に保存する。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")

    lot = _load_paper_practice_lot(_paper_practice_lot_blob_name(lot_id))
    if not lot:
        raise HTTPException(status_code=404, detail="Paper practice lot not found.")

    attempt_answers: list[PaperPracticeAttemptAnswer] = []
    history_items: list[HistoryItem] = []
    answered_at = datetime.datetime.now(datetime.timezone.utc)

    for index, question in enumerate(lot.questions, start=1):
        problem_id = str(question.get("id") or question.get("problem_id") or "")
        if not problem_id:
            raise HTTPException(status_code=400, detail=f"ロット内{index}問目の問題IDが不正です。")
        selected_answer = request.answers.get(problem_id)
        if not selected_answer:
            if request.grading_scope == "answered_only":
                continue
            selected_answer = ""
        correct_answer = str(question.get("answer") or "")
        is_correct = selected_answer == correct_answer
        subject = str(question.get("subject") or "")
        category = question.get("category")
        attempt_answers.append(PaperPracticeAttemptAnswer(
            lot_number=index,
            problem_id=problem_id,
            subject=subject,
            selected_answer=selected_answer,
            correct_answer=correct_answer,
            is_correct=is_correct,
            question=question,
        ))
        history_items.append(HistoryItem(
            problem_id=problem_id,
            subject=subject,
            selected_answer=selected_answer,
            is_correct=is_correct,
            category=category if isinstance(category, str) else None,
            mode="paper_practice",
            answered_at=answered_at,
        ))

    if not attempt_answers:
        raise HTTPException(status_code=400, detail="採点対象の入力がありません。")

    attempt = PaperPracticeAttempt(
        id=uuid.uuid4().hex,
        lot_id=lot.id,
        created_at=answered_at.isoformat(),
        total_count=len(attempt_answers),
        correct_count=sum(1 for item in attempt_answers if item.is_correct),
        answers=attempt_answers,
    )

    try:
        _append_history_items(history_items)
        _save_paper_practice_attempt(attempt)
    except Exception as e:
        print(f"Error grading paper practice lot {lot_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save paper practice attempt: {e}")

    return attempt

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
        "answered_problems_count": 0,
        "daily_correct_rate_trend": {},
        "frequently_missed_categories": {},
        "total_problems_in_subject": 0,
        "unanswered_problems_count": 0,
        "today_total_runs": 0,
        "today_correct_answers": 0,
        "today_mode_breakdown": [],
    }


def _normalize_history_mode(mode: Optional[str]) -> str:
    if not mode:
        return "legacy"
    normalized = mode.strip().lower()
    if normalized == "today_remaining":
        return "today_remaining"
    if normalized == WORRY_PRACTICE_MODE:
        return WORRY_PRACTICE_MODE
    if normalized == SIMILAR_PRACTICE_MODE:
        return SIMILAR_PRACTICE_MODE
    if normalized in {"random", "weak_area", "unanswered", "specific_area"}:
        return normalized
    return normalized or "legacy"


def _build_mode_breakdown(
    history_items: list[HistoryItem],
    sort_by_runs_desc: bool = True,
) -> list[dict]:
    grouped: dict[str, dict[str, int]] = {}
    for item in history_items:
        mode_key = _normalize_history_mode(item.mode)
        stats = grouped.setdefault(mode_key, {"total_questions": 0, "correct_count": 0})
        stats["total_questions"] += 1
        if item.is_correct:
            stats["correct_count"] += 1

    rows = [
        {
            "mode": mode,
            "total_questions": stats["total_questions"],
            "correct_count": stats["correct_count"],
            "accuracy": (stats["correct_count"] / stats["total_questions"]) if stats["total_questions"] > 0 else 0,
        }
        for mode, stats in grouped.items()
    ]
    if sort_by_runs_desc:
        rows.sort(key=lambda row: (-row["total_questions"], row["mode"]))
    else:
        rows.sort(key=lambda row: row["mode"])
    return rows


def _build_daily_summary_items(
    history_items: list[HistoryItem],
    include_mode_breakdown: bool = False,
) -> list[DailySummaryDetailItem]:
    daily_summary_map: dict[str, dict] = {}

    for item in history_items:
        date_str = item.answered_at.astimezone(TOKYO_TZ).strftime("%Y-%m-%d")
        if date_str not in daily_summary_map:
            daily_summary_map[date_str] = {
                "total_questions": 0,
                "correct_count": 0,
                "items": [],
            }

        daily_summary_map[date_str]["total_questions"] += 1
        if item.is_correct:
            daily_summary_map[date_str]["correct_count"] += 1
        if include_mode_breakdown:
            daily_summary_map[date_str]["items"].append(item)

    daily_summary_list: list[DailySummaryDetailItem] = []
    for date_str, stats in daily_summary_map.items():
        total_questions = stats["total_questions"]
        if total_questions <= 0:
            continue
        mode_breakdown = []
        if include_mode_breakdown:
            mode_breakdown = [
                ModeSummaryItem.model_validate(row)
                for row in _build_mode_breakdown(stats["items"])
            ]
        daily_summary_list.append(DailySummaryDetailItem(
            date=date_str,
            total_questions=total_questions,
            correct_count=stats["correct_count"],
            accuracy=stats["correct_count"] / total_questions,
            mode_breakdown=mode_breakdown,
        ))

    daily_summary_list.sort(key=lambda x: x.date, reverse=True)
    return daily_summary_list


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
        try:
            if subject_name == WORRY_PRACTICE_SUBJECT_NAME:
                history_items = _get_history_items_for_subject(subject_name)
                valid_problem_ids = {item.problem_id for item in history_items}
                total_problems_in_subject += len(valid_problem_ids)
                for item in history_items:
                    all_history_items.append(item)
                    answered_problem_keys.add((subject_name, item.problem_id))
                continue

            all_questions_for_subject_map = _get_all_questions_for_subject(subject_name)
            total_problems_in_subject += len(all_questions_for_subject_map)
            valid_problem_ids = set(all_questions_for_subject_map.keys())
            history_items = _get_history_items_for_subject(subject_name)
            for item in history_items:
                if item.problem_id not in valid_problem_ids:
                    continue
                all_history_items.append(item)
                answered_problem_keys.add((subject_name, item.problem_id))
        except Exception as e:
            print(f"Warning: failed to read questions for analytics subject {subject_name}: {e}")

    target_history = _filter_history_items(
        all_history_items,
        start_date=start_date,
        end_date=end_date,
        category=category,
    )

    answered_problems_count = len(answered_problem_keys)
    unanswered_problems_count = max(0, total_problems_in_subject - len(answered_problem_keys))
    today_jst = datetime.datetime.now(TOKYO_TZ).date()
    today_history = [
        item for item in all_history_items
        if item.answered_at.astimezone(TOKYO_TZ).date() == today_jst and (not category or item.category == category)
    ]
    today_total_runs = len(today_history)
    today_correct_answers = sum(1 for item in today_history if item.is_correct)
    today_mode_breakdown = [
        {
            "mode": row["mode"],
            "total_runs": row["total_questions"],
            "correct_answers": row["correct_count"],
            "accuracy": row["accuracy"],
        }
        for row in _build_mode_breakdown(today_history)
    ]

    if not target_history:
        response = _empty_analytics_response()
        response["total_problems_in_subject"] = total_problems_in_subject
        response["answered_problems_count"] = answered_problems_count
        response["unanswered_problems_count"] = unanswered_problems_count
        response["today_total_runs"] = today_total_runs
        response["today_correct_answers"] = today_correct_answers
        response["today_mode_breakdown"] = today_mode_breakdown
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
        "answered_problems_count": answered_problems_count,
        "daily_correct_rate_trend": daily_correct_rate_trend,
        "frequently_missed_categories": frequently_missed_categories,
        "total_problems_in_subject": total_problems_in_subject,
        "unanswered_problems_count": unanswered_problems_count,
        "today_total_runs": today_total_runs,
        "today_correct_answers": today_correct_answers,
        "today_mode_breakdown": today_mode_breakdown,
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
            first_missed_item = first_attempt_by_problem.get(problem_id)
            export_question = question.copy()
            export_question["subject"] = subject_name
            if first_missed_item is not None:
                export_question["first_missed_answered_at"] = first_missed_item.answered_at.isoformat()
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
        explanation_image_data_urls = [
            value for value in item.explanation_image_data_urls
            if isinstance(value, str) and value.strip()
        ]
        if not explanation_image_data_urls and item.explanation_image_data_url and item.explanation_image_data_url.strip():
            explanation_image_data_urls = [item.explanation_image_data_url]

        question_image_data_urls = [
            value for value in item.question_image_data_urls
            if isinstance(value, str) and value.strip()
        ]
        if not question_image_data_urls and item.question_image_data_url and item.question_image_data_url.strip():
            question_image_data_urls = [item.question_image_data_url]

        payload = {
            "text": item.text,
            "explanation_image_data_urls": explanation_image_data_urls,
            "question_image_data_urls": question_image_data_urls,
            "explanation_image_data_url": explanation_image_data_urls[0] if explanation_image_data_urls else None,
            "question_image_data_url": question_image_data_urls[0] if question_image_data_urls else None,
        }
        is_empty_payload = (
            not str(item.text or "").strip()
            and not explanation_image_data_urls
            and not question_image_data_urls
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
    question_with_subject = question.copy()
    question_with_subject["subject"] = subject_name
    return _prepare_question_for_client(question_with_subject)


@api_router.get("/subjects/{subject_name:path}/problems")
def get_subject_problems(subject_name: str):
    """指定された科目の問題一覧を返す"""
    questions = _get_all_questions_for_subject(subject_name)
    payload: list[dict] = []
    for _, question in sorted(questions.items(), key=lambda item: str(item[0])):
        question_with_subject = question.copy()
        question_with_subject["subject"] = subject_name
        payload.append(_prepare_question_for_client(question_with_subject))
    return payload


@api_router.get("/review-later")
def get_review_later():
    """後で振り返る問題の一覧を返す"""
    items = _load_review_later_items()
    response_items: list[dict] = []
    questions_by_subject: dict[str, dict[str, dict]] = {}
    for item in items:
        question_payload = None
        error_detail = None
        try:
            questions = questions_by_subject.get(item.subject)
            if questions is None:
                questions = _get_all_questions_for_subject(item.subject)
                questions_by_subject[item.subject] = questions
            question = questions.get(item.problem_id)
            if question:
                question_with_subject = question.copy()
                question_with_subject["subject"] = item.subject
                question_payload = _prepare_question_for_client(question_with_subject)
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


@api_router.get("/custom-explanations/library", response_model=CustomExplanationLibraryResponse)
def get_custom_explanations_library(subjects: list[str] = Query(default_factory=list)):
    """保存済み mymemo / 補足画像を一覧取得する。"""
    return CustomExplanationLibraryResponse(
        items=_collect_custom_explanation_library_items(subjects or None)
    )


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


@api_router.post(
    "/review-later/{subject_name:path}/{problem_id}/reorganize-explanation",
    response_model=ReviewLaterExplanationReviewResponse,
)
def reorganize_review_later_explanation(
    subject_name: str,
    problem_id: str,
    request: ReviewLaterExplanationReviewRequest,
):
    """問題データの整合性を確認し、解説文を簡潔な構造に整理する。"""
    question = request.question
    if not question:
        questions = _get_all_questions_for_subject(subject_name)
        base_question = questions.get(problem_id)
        if not base_question:
            raise HTTPException(status_code=404, detail="Problem not found.")
        question = base_question.copy()
        question["subject"] = subject_name

    return _reorganize_question_with_ai_or_fallback(subject_name, problem_id, question)


def _reorganize_subject_questions(
    subject_name: str,
    progress_callback: Optional[Any] = None,
) -> ReviewLaterBulkReorganizeResponse:
    is_dict_format, original_questions, base_payload = _subject_blob_payload(subject_name)
    next_questions: list[dict] = []
    results: list[ReviewLaterBulkReorganizeItem] = []
    updated_count = 0
    failed_count = 0

    if progress_callback:
        progress_callback({
            "event": "subject_loaded",
            "subject": subject_name,
            "total": len(original_questions),
        })

    for index, original_question in enumerate(original_questions):
        normalized = normalize_question(original_question.copy()) if isinstance(original_question, dict) else None
        problem_id = str((normalized or {}).get("id") or original_question.get("id") or f"index-{index + 1}") if isinstance(original_question, dict) else f"index-{index + 1}"
        if progress_callback:
            progress_callback({
                "event": "problem_started",
                "subject": subject_name,
                "problem_id": problem_id,
            })
        if not isinstance(original_question, dict) or not normalized:
            next_questions.append(original_question)
            failed_count += 1
            result_item = ReviewLaterBulkReorganizeItem(
                subject=subject_name,
                problem_id=problem_id,
                updated=False,
                used_ai=False,
                error="問題データの形式が不正です。",
            )
            results.append(result_item)
            if progress_callback:
                progress_callback({
                    "event": "problem_finished",
                    "subject": subject_name,
                    "item": result_item,
                    "processed": len(results),
                    "updated": updated_count,
                    "failed": failed_count,
                })
            continue

        question_for_review = normalized.copy()
        question_for_review["subject"] = subject_name
        try:
            review = _reorganize_question_with_ai_or_fallback(subject_name, problem_id, question_for_review)
            next_question, changed = _apply_reorganized_question_fields(original_question, review)
            next_questions.append(next_question)
            if changed:
                updated_count += 1
            result_item = ReviewLaterBulkReorganizeItem(
                subject=subject_name,
                problem_id=problem_id,
                updated=changed,
                used_ai=review.used_ai,
                consistency_notes=review.consistency_notes,
            )
            results.append(result_item)
        except Exception as e:
            next_questions.append(original_question)
            failed_count += 1
            result_item = ReviewLaterBulkReorganizeItem(
                subject=subject_name,
                problem_id=problem_id,
                updated=False,
                used_ai=False,
                error=str(e),
            )
            results.append(result_item)

        if progress_callback:
            progress_callback({
                "event": "problem_finished",
                "subject": subject_name,
                "item": result_item,
                "processed": len(results),
                "updated": updated_count,
                "failed": failed_count,
            })

    if updated_count > 0:
        _write_subject_questions(subject_name, next_questions, base_payload, is_dict_format)

    return ReviewLaterBulkReorganizeResponse(
        subject=subject_name,
        total=len(original_questions),
        updated=updated_count,
        failed=failed_count,
        items=results,
    )


@api_router.post(
    "/subjects/{subject_name:path}/problems/reorganize",
    response_model=ReviewLaterBulkReorganizeResponse,
)
def reorganize_subject_problems(subject_name: str):
    """選択された問題JSON内の全問題にAI整合性確認・整理を適用し、問題JSONを上書き保存する。"""
    return _reorganize_subject_questions(subject_name)


@api_router.post(
    "/review-later/question-text-md-dedupe",
    response_model=ReviewLaterQuestionTextMdDedupeResponse,
)
def dedupe_review_later_question_text_md(request: ReviewLaterQuestionTextMdDedupeRequest):
    """問題文とMarkdown問題文の重複をPython処理で検出し、Markdown側から削除する。"""
    subject_names: list[str] = []
    seen_subjects: set[str] = set()
    for subject in request.subjects:
        subject_name = str(subject or "").strip()
        if not subject_name or subject_name in seen_subjects:
            continue
        seen_subjects.add(subject_name)
        subject_names.append(subject_name)
    if not subject_names:
        raise HTTPException(status_code=400, detail="対象問題jsonが未選択です。")

    subject_results: list[ReviewLaterQuestionTextMdDedupeSubjectResult] = []
    for subject_name in subject_names:
        subject_results.append(_dedupe_subject_question_text_md(subject_name))

    return ReviewLaterQuestionTextMdDedupeResponse(
        total_subjects=len(subject_results),
        total=sum(subject.total for subject in subject_results),
        updated=sum(subject.updated for subject in subject_results),
        failed=sum(subject.failed for subject in subject_results),
        duplicates_removed=sum(subject.duplicates_removed for subject in subject_results),
        subjects=subject_results,
    )


REVIEW_LATER_REORGANIZE_JOBS_DIR = "review-later/reorganize-jobs"
REVIEW_LATER_REORGANIZE_JOBS_LOCK = threading.Lock()


def _reorganize_job_blob_name(job_id: str) -> str:
    safe_job_id = re.sub(r"[^a-zA-Z0-9_-]", "", job_id)
    return f"{REVIEW_LATER_REORGANIZE_JOBS_DIR}/{safe_job_id}.json"


def _load_reorganize_job_payload(job_id: str) -> dict[str, Any]:
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    blob_client = container_client.get_blob_client(_reorganize_job_blob_name(job_id))
    if not blob_client.exists():
        raise HTTPException(status_code=404, detail="Reorganize job not found.")
    try:
        payload = json.loads(blob_client.download_blob().readall())
        if not isinstance(payload, dict):
            raise ValueError("invalid job payload")
        return payload
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error reading reorganize job {job_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to read reorganize job.")


def _save_reorganize_job_payload(job_id: str, payload: dict[str, Any]) -> None:
    _save_json_blob(_reorganize_job_blob_name(job_id), payload)


def _serialize_reorganize_job_payload(job_id: str, job: dict[str, Any]) -> ReviewLaterBulkReorganizeJobStatus:
    subject_order = list(job.get("subject_order") or [])
    raw_subjects = job.get("subjects") if isinstance(job.get("subjects"), dict) else {}
    subjects = [
        ReviewLaterBulkReorganizeSubjectProgress.model_validate(raw_subjects[subject])
        for subject in subject_order
        if subject in raw_subjects
    ]
    total_problems = sum(subject.total for subject in subjects)
    processed_problems = sum(subject.processed for subject in subjects)
    updated = sum(subject.updated for subject in subjects)
    failed = sum(subject.failed for subject in subjects)
    completed_subjects = sum(1 for subject in subjects if subject.status in {"completed", "failed"})
    return ReviewLaterBulkReorganizeJobStatus(
        job_id=job_id,
        status=job.get("status", "queued"),
        total_subjects=len(subject_order),
        completed_subjects=completed_subjects,
        total_problems=total_problems,
        processed_problems=processed_problems,
        updated=updated,
        failed=failed,
        max_parallel_subjects=int(job.get("max_parallel_subjects") or 1),
        started_at=str(job.get("started_at") or _now_utc_iso()),
        completed_at=job.get("completed_at"),
        subjects=subjects,
    )


def _serialize_reorganize_job(job_id: str) -> ReviewLaterBulkReorganizeJobStatus:
    return _serialize_reorganize_job_payload(job_id, _load_reorganize_job_payload(job_id))


def _mutate_reorganize_job(job_id: str, mutator) -> dict[str, Any]:
    with REVIEW_LATER_REORGANIZE_JOBS_LOCK:
        job = _load_reorganize_job_payload(job_id)
        mutator(job)
        _save_reorganize_job_payload(job_id, job)
        return job


def _update_reorganize_subject_progress(job_id: str, event: dict[str, Any]) -> None:
    subject_name = str(event.get("subject") or "")
    if not subject_name:
        return

    def mutate(job: dict[str, Any]) -> None:
        subjects = job.get("subjects") if isinstance(job.get("subjects"), dict) else {}
        progress = subjects.get(subject_name)
        if not progress:
            return
        event_name = event.get("event")
        if event_name == "subject_loaded":
            progress["status"] = "running"
            progress["total"] = int(event.get("total") or 0)
            progress["started_at"] = progress.get("started_at") or _now_utc_iso()
        elif event_name == "problem_started":
            progress["status"] = "running"
            progress["current_problem_id"] = str(event.get("problem_id") or "")
        elif event_name == "problem_finished":
            item = event.get("item")
            if isinstance(item, ReviewLaterBulkReorganizeItem):
                progress.setdefault("items", []).append(item.model_dump())
            progress["processed"] = int(event.get("processed") or progress.get("processed") or 0)
            progress["updated"] = int(event.get("updated") or progress.get("updated") or 0)
            progress["failed"] = int(event.get("failed") or progress.get("failed") or 0)

    _mutate_reorganize_job(job_id, mutate)


def _run_reorganize_job_subject(job_id: str, subject_name: str) -> None:
    def mark_running(job: dict[str, Any]) -> None:
        progress = job["subjects"][subject_name]
        progress["status"] = "running"
        progress["started_at"] = _now_utc_iso()

    _mutate_reorganize_job(job_id, mark_running)
    try:
        response = _reorganize_subject_questions(
            subject_name,
            progress_callback=lambda event: _update_reorganize_subject_progress(job_id, event),
        )

        def mark_completed(job: dict[str, Any]) -> None:
            progress = job["subjects"][subject_name]
            progress["status"] = "completed"
            progress["total"] = response.total
            progress["processed"] = response.total
            progress["updated"] = response.updated
            progress["failed"] = response.failed
            progress["current_problem_id"] = None
            progress["completed_at"] = _now_utc_iso()
            progress["items"] = [item.model_dump() for item in response.items]

        _mutate_reorganize_job(job_id, mark_completed)
    except Exception as e:
        def mark_failed(job: dict[str, Any]) -> None:
            progress = job["subjects"][subject_name]
            progress["status"] = "failed"
            progress["error"] = str(e)
            progress["current_problem_id"] = None
            progress["completed_at"] = _now_utc_iso()

        _mutate_reorganize_job(job_id, mark_failed)


def _run_reorganize_job(job_id: str, subject_names: list[str], max_parallel_subjects: int) -> None:
    try:
        _mutate_reorganize_job(job_id, lambda job: job.update({"status": "running"}))
        with ThreadPoolExecutor(max_workers=max_parallel_subjects) as executor:
            future_by_subject = {
                executor.submit(_run_reorganize_job_subject, job_id, subject_name): subject_name
                for subject_name in subject_names
            }
            for future in as_completed(future_by_subject):
                subject_name = future_by_subject[future]
                try:
                    future.result()
                except Exception as e:
                    def mark_subject_failed(job: dict[str, Any]) -> None:
                        progress = job["subjects"][subject_name]
                        progress["status"] = "failed"
                        progress["error"] = str(e)
                        progress["completed_at"] = _now_utc_iso()

                    _mutate_reorganize_job(job_id, mark_subject_failed)
        def mark_job_finished(job: dict[str, Any]) -> None:
            subjects = job.get("subjects") if isinstance(job.get("subjects"), dict) else {}
            has_failed_subject = any(
                isinstance(progress, dict) and progress.get("status") == "failed"
                for progress in subjects.values()
            )
            job["status"] = "failed" if has_failed_subject else "completed"
            job["completed_at"] = _now_utc_iso()

        _mutate_reorganize_job(job_id, mark_job_finished)
    except Exception as e:
        def mark_job_failed(job: dict[str, Any]) -> None:
            job["status"] = "failed"
            job["error"] = str(e)
            job["completed_at"] = _now_utc_iso()

        try:
            _mutate_reorganize_job(job_id, mark_job_failed)
        except Exception as save_error:
            print(f"Error marking reorganize job failed: {save_error}")


@api_router.post("/review-later/reorganize-jobs", response_model=ReviewLaterBulkReorganizeJobStatus)
def start_review_later_reorganize_job(request: ReviewLaterBulkReorganizeJobRequest):
    """複数の問題JSONを並行してAI整理するジョブを開始する。"""
    subject_names: list[str] = []
    seen_subjects: set[str] = set()
    for subject in request.subjects:
        subject_name = str(subject or "").strip()
        if not subject_name or subject_name in seen_subjects:
            continue
        seen_subjects.add(subject_name)
        subject_names.append(subject_name)
    if not subject_names:
        raise HTTPException(status_code=400, detail="対象問題jsonが未選択です。")

    max_parallel_subjects = max(1, min(request.max_parallel_subjects, len(subject_names), 4))
    job_id = f"review-reorganize-{uuid.uuid4().hex}"
    now_iso = _now_utc_iso()
    job_payload = {
        "status": "queued",
        "subject_order": subject_names,
        "max_parallel_subjects": max_parallel_subjects,
        "started_at": now_iso,
        "completed_at": None,
        "subjects": {
            subject_name: {
                "subject": subject_name,
                "status": "queued",
                "total": 0,
                "processed": 0,
                "updated": 0,
                "failed": 0,
                "current_problem_id": None,
                "error": None,
                "started_at": None,
                "completed_at": None,
                "items": [],
            }
            for subject_name in subject_names
        },
    }
    _save_reorganize_job_payload(job_id, job_payload)

    worker = threading.Thread(
        target=_run_reorganize_job,
        args=(job_id, subject_names, max_parallel_subjects),
        daemon=True,
    )
    worker.start()
    return _serialize_reorganize_job_payload(job_id, job_payload)


@api_router.get("/review-later/reorganize-jobs/{job_id}", response_model=ReviewLaterBulkReorganizeJobStatus)
def get_review_later_reorganize_job(job_id: str):
    """AI整理ジョブの進捗を返す。"""
    return _serialize_reorganize_job(job_id)


@api_router.get("/quiz/worry-practice/versions", response_model=list[WorryPracticeVersionSummary])
def list_worry_practice_versions():
    """保存済み心配事演習バージョンの一覧を返す。"""
    return _load_worry_practice_versions()


@api_router.get("/quiz/worry-practice/versions/{version_id}", response_model=WorryPracticeVersion)
def get_worry_practice_version(version_id: str):
    """保存済み心配事演習バージョンを取得する。"""
    for item in _load_worry_practice_versions():
        if item.id == version_id:
            return item
    raise HTTPException(status_code=404, detail="Worry practice version not found.")


@api_router.delete("/quiz/worry-practice/versions/{version_id}", status_code=204)
def delete_worry_practice_version(version_id: str):
    """保存済み心配事演習バージョンを削除する。"""
    versions = _load_worry_practice_versions()
    next_versions = [item for item in versions if item.id != version_id]
    if len(next_versions) == len(versions):
        raise HTTPException(status_code=404, detail="Worry practice version not found.")
    _save_worry_practice_versions(next_versions)
    return Response(status_code=204)


@api_router.post("/quiz/worry-practice/generate", response_model=WorryPracticeGenerateResponse)
def generate_worry_practice(request: WorryPracticeGenerateRequest):
    """苦手意識や類題希望から、再利用可能な心配事演習バージョンを生成する。"""
    gemini_unavailable_reason = get_gemini_unavailable_reason()
    if gemini_unavailable_reason:
        raise HTTPException(status_code=500, detail=gemini_unavailable_reason)

    prompt = f"""
あなたは中小企業診断士試験の一次試験向け問題作成者です。
これは一般知識クイズではなく、中小企業診断士試験の試験対策専用の問題生成です。
学習者の心配事や苦手意識を、必ず中小企業診断士試験の出題範囲・出題形式・合否に直結する理解確認へ落とし込み、保存版として再演習できる4択問題セットを作成してください。

# 試験対策として必ず意識する範囲
- 企業経営理論、財務・会計、運営管理、経済学・経済政策、経営法務、経営情報システム、中小企業経営・中小企業政策
- 一次試験の4択問題として成立すること
- 用語暗記だけでなく、概念の区別、条件判断、ひっかけ選択肢、実務場面への適用を問うこと
- 学習者入力が抽象的でも、診断士試験で問われる論点に変換して出題すること

# 学習者入力
{request.concern_text}

# 作成数
{request.count}

# 出力ルール
- 必ずJSONオブジェクトのみを返す。
- questions は指定数ちょうど返す。
- 各問題は4択。choices の label は ア, イ, ウ, エ を使う。
- answer は choices の label のいずれか。
- question_text は単体で解ける文章にする。
- question_text_md と question_text_mermaid は必要な場合だけ文字列を入れ、不要なら空文字。
- explanation.text は、結論、根拠、他選択肢との差分、重要キーワードを短い改行で整理する。
- 既存問題の丸写しではなく、同じ論点を問う新作問題にする。

# JSONスキーマ
{{
  "questions": [
    {{
      "question_text": "string",
      "question_text_md": "string",
      "question_text_mermaid": "string",
      "choices": [
        {{"label": "ア", "text": "string"}},
        {{"label": "イ", "text": "string"}},
        {{"label": "ウ", "text": "string"}},
        {{"label": "エ", "text": "string"}}
      ],
      "answer": "ア",
      "category": "string",
      "explanation": {{"text": "string"}}
    }}
  ]
}}
"""
    try:
        model = create_generative_model()
        response = model.generate_content(prompt)
        payload = _extract_json_object_from_text(getattr(response, "text", "") or "")
        raw_questions = payload.get("questions")
        if not isinstance(raw_questions, list):
            raise ValueError("questions must be a list.")

        quiz_set: list[dict] = []
        now_token = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
        for index, raw_question in enumerate(raw_questions[:request.count], start=1):
            if not isinstance(raw_question, dict):
                continue
            question = normalize_question(raw_question.copy())
            if not question:
                continue
            question["id"] = f"worry-{now_token}-{uuid.uuid4().hex[:10]}-{index}"
            question["subject"] = WORRY_PRACTICE_SUBJECT_NAME
            question["category"] = str(question.get("category") or "心配事演習")
            question["custom_explanation"] = ""
            question["image_urls"] = []
            question["explanation_image_urls"] = []
            quiz_set.append(_prepare_question_assets_for_client(question))

        if not quiz_set:
            raise ValueError("AI response did not include valid questions.")

        version: Optional[WorryPracticeVersion] = None
        try:
            version = _create_worry_practice_version(request.concern_text, request.count, quiz_set)
        except Exception as e:
            print(f"Error saving worry practice version: {e}")

        return WorryPracticeGenerateResponse(
            subject=WORRY_PRACTICE_SUBJECT_NAME,
            quiz_set=quiz_set,
            version=version,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating worry practice questions: {e}")
        raise HTTPException(status_code=500, detail=f"心配事演習問題の生成に失敗しました: {e}")


@api_router.get("/review-later/{subject_name:path}/{problem_id}/similar", response_model=SimilarQuestionSearchResponse)
def get_similar_questions_for_review_later(subject_name: str, problem_id: str, count: int = Query(default=5, ge=1, le=20)):
    """後で確認問題からトピックをAI抽出し、同一科目内の類題を返す。"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    gemini_unavailable_reason = get_gemini_unavailable_reason()
    if gemini_unavailable_reason:
        raise HTTPException(status_code=500, detail=gemini_unavailable_reason)

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
        model = create_generative_model()
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
    questions = _get_all_questions_for_subject(item.subject)
    if item.problem_id not in questions:
        raise HTTPException(status_code=404, detail="Problem not found.")

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
def register_review_later_history(subject_name: str, problem_id: str):
    """後で確認問題に対して正解・誤答の実績を各1件追加し、登録状態を解除する。"""
    questions = _get_all_questions_for_subject(subject_name)
    question = questions.get(problem_id)
    if not question:
        raise HTTPException(status_code=404, detail="Problem not found.")

    normalized = normalize_question(question.copy())
    if not normalized:
        raise HTTPException(status_code=500, detail="Problem format is invalid.")

    answer = str(normalized.get("answer") or "")
    choices = normalized.get("choices") or []
    wrong_choice = next(
        (
            str(choice.get("label"))
            for choice in choices
            if isinstance(choice, dict) and str(choice.get("label") or "") and str(choice.get("label")) != answer
        ),
        None,
    ) or "__review_later_manual_incorrect__"
    now = datetime.datetime.now(datetime.timezone.utc)
    _append_history_items([
        HistoryItem(
            problem_id=problem_id,
            subject=subject_name,
            selected_answer=answer,
            is_correct=True,
            answered_at=now,
            category=normalized.get("category"),
        ),
        HistoryItem(
            problem_id=problem_id,
            subject=subject_name,
            selected_answer=wrong_choice,
            is_correct=False,
            answered_at=now,
            category=normalized.get("category"),
        ),
    ])

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
        explanation_image_data_urls = [
            item for item in explanation.explanation_image_data_urls
            if isinstance(item, str) and item.strip()
        ]
        if not explanation_image_data_urls:
            explanation_image_data_url = explanation.explanation_image_data_url
            if not explanation_image_data_url and explanation.image_data_url:
                explanation_image_data_url = explanation.image_data_url
            if isinstance(explanation_image_data_url, str) and explanation_image_data_url.strip():
                explanation_image_data_urls = [explanation_image_data_url]

        question_image_data_urls = [
            item for item in explanation.question_image_data_urls
            if isinstance(item, str) and item.strip()
        ]
        if not question_image_data_urls:
            question_image_data_url = explanation.question_image_data_url
            if isinstance(question_image_data_url, str) and question_image_data_url.strip():
                question_image_data_urls = [question_image_data_url]

        normalized_payload = {
            "text": explanation.text,
            "explanation_image_data_urls": explanation_image_data_urls,
            "question_image_data_urls": question_image_data_urls,
            # Keep legacy single-image keys for backward compatibility.
            "explanation_image_data_url": explanation_image_data_urls[0] if explanation_image_data_urls else None,
            "question_image_data_url": question_image_data_urls[0] if question_image_data_urls else None,
        }
        blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{problem_id}.json"
        blob_client = container_client.get_blob_client(blob_name)
        now_iso = _now_utc_iso()
        if blob_client.exists():
            try:
                existing_payload = json.loads(blob_client.download_blob().readall())
            except Exception:
                existing_payload = {}
            if isinstance(existing_payload, dict):
                existing_created_at = existing_payload.get("created_at")
                if isinstance(existing_created_at, str) and existing_created_at.strip():
                    normalized_payload["created_at"] = existing_created_at
                normalized_payload["updated_at"] = now_iso
            else:
                normalized_payload["created_at"] = now_iso
                normalized_payload["updated_at"] = now_iso
        else:
            normalized_payload["created_at"] = now_iso
            normalized_payload["updated_at"] = now_iso
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
        updated_question = original_questions[target_index].copy()
        updated_question["subject"] = subject_name
        return _prepare_question_for_client(updated_question)
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
            if subject_name == WORRY_PRACTICE_SUBJECT_NAME:
                history_items = _get_history_items_for_subject(subject_name)
                answered_problem_ids = {item.problem_id for item in history_items}
                correctly_answered_ids = {item.problem_id for item in history_items if item.is_correct}
                progress_data[subject_name] = SubjectProgress(
                    total_problems=len(answered_problem_ids),
                    answered_problems=len(answered_problem_ids),
                    correctly_answered_once=len(correctly_answered_ids),
                    unanswered_problems=0,
                )
                continue

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
def get_all_daily_summaries(
    subjects: Optional[List[str]] = Query(None),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
):
    """すべての科目の履歴、または指定された科目の履歴を読み込み、日付ごとに集計した統合サマリーを返す"""
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

    target_history = _filter_history_items(
        all_history_items,
        start_date=start_date,
        end_date=end_date,
        category=category,
    )
    if not start_date and not end_date:
        today = datetime.datetime.now(TOKYO_TZ).date()
        default_start_date = today - datetime.timedelta(days=13)
        target_history = [
            item for item in target_history
            if item.answered_at.astimezone(TOKYO_TZ).date() >= default_start_date
        ]

    daily_summary_list = _build_daily_summary_items(target_history)
    return [
        DailySummaryItem(
            date=item.date,
            total_questions=item.total_questions,
            correct_count=item.correct_count,
            accuracy=item.accuracy,
        )
        for item in daily_summary_list
    ]


@api_router.get("/history/daily-summary/all/paged", response_model=PagedDailySummaryResponse)
def get_all_daily_summaries_paged(
    subjects: Optional[List[str]] = Query(None),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=366),
    include_mode_breakdown: bool = False,
):
    if container_client is None:
        return PagedDailySummaryResponse(items=[], total_days=0, has_more=False, next_offset=None)

    all_history_items: list[HistoryItem] = []
    blob_names_to_scan: list[str] = []
    if subjects:
        blob_names_to_scan = [f"history/{Path(s).stem}.jsonl" for s in subjects]
    else:
        history_blobs = container_client.list_blobs(name_starts_with="history/")
        blob_names_to_scan = [blob.name for blob in history_blobs if blob.name.endswith(".jsonl")]

    try:
        for blob_name in blob_names_to_scan:
            blob_client = container_client.get_blob_client(blob_name)
            if not blob_client.exists():
                continue
            history_content = blob_client.download_blob().readall().decode('utf-8')
            history_lines = history_content.strip().split('\n')
            for line in history_lines:
                if not line.strip():
                    continue
                try:
                    all_history_items.append(HistoryItem.model_validate_json(line))
                except Exception as e:
                    print(f"Skipping malformed line in {blob_name}: {line}. Error: {e}")
    except Exception as e:
        print(f"Error reading history blobs for paged summaries: {e}")
        return PagedDailySummaryResponse(items=[], total_days=0, has_more=False, next_offset=None)

    target_history = _filter_history_items(
        all_history_items,
        start_date=start_date,
        end_date=end_date,
        category=category,
    )

    detailed_items = _build_daily_summary_items(
        target_history,
        include_mode_breakdown=include_mode_breakdown,
    )
    total_days = len(detailed_items)
    paged_items = detailed_items[offset: offset + limit]
    next_offset = offset + len(paged_items)
    has_more = next_offset < total_days
    if not include_mode_breakdown:
        paged_items = [
            DailySummaryDetailItem(
                date=item.date,
                total_questions=item.total_questions,
                correct_count=item.correct_count,
                accuracy=item.accuracy,
                mode_breakdown=[],
            )
            for item in paged_items
        ]

    return PagedDailySummaryResponse(
        items=paged_items,
        total_days=total_days,
        has_more=has_more,
        next_offset=next_offset if has_more else None,
    )

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
app.include_router(secondary_exam_router)

# Explicitly handle SPA routes to avoid "Not Found" on reload
@app.get("/portal", response_class=FileResponse)
async def serve_portal_route():
    return FileResponse(DIST_DIR / "index.html")

@app.get("/dashboard", response_class=FileResponse)
async def serve_dashboard_route():
    return FileResponse(DIST_DIR / "index.html")

@app.get("/dashboard/review-later", response_class=FileResponse)
async def serve_dashboard_review_later_route():
    return FileResponse(DIST_DIR / "index.html")

@app.get("/paper-practice", response_class=FileResponse)
async def serve_paper_practice_route():
    return FileResponse(DIST_DIR / "index.html")

app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")
