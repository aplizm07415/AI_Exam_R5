import os
import json
import random
import datetime
from pathlib import Path
from fastapi import FastAPI, APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field # BaseModelをインポート
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

# 新規追加: 不正解問題詳細の戻り値用モデル
class MissedProblemDetail(BaseModel):
    problem_id: str
    question_text: str
    category: str | None = None
    explanation: str | None = None
    miss_count: int
    correct_answer: str | None = None

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
    enabled: bool

class ProblemHistoryStatsRequest(BaseModel):
    problem_ids: list[str]
    subjects: list[str]

class AnswerStat(BaseModel):
    total: int
    correct: int

class CustomExplanation(BaseModel):
    text: str

class QuizStartRequest(BaseModel):
    subjects: list[str]
    count: int = 10
    mode: str = "random"
    weights: dict[str, str] | None = None

# --- 定数とセットアップ ---
BLOB_CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("QUIZ_BLOB_CONTAINER", "exam-json")
CUSTOM_EXPLANATIONS_DIR = "custom-explanations"
SORAGAKI_DIR = "soragaki" # Directory for Soragaki data

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
                not blob.name.startswith('history/') and
                not blob.name.startswith('custom-explanations/') and
                not blob.name.startswith('soragaki/')
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
    
    # 最終処理: 選択された問題リストに画像URLを付与
    for q in selected_questions:
        # 'image' (str) を 'images' (list[str]) に統合
        if 'image' in q and q['image']:
            if 'images' not in q:
                q['images'] = []
            if isinstance(q['image'], str) and q['image'] not in q['images']:
                 q['images'].insert(0, q['image'])
            # del q['image'] # 元の'image'キーは削除しないでおく

        # 'images'リストから'image_urls'を生成
        if 'images' in q and isinstance(q['images'], list):
            q['image_urls'] = [f"/api/images/{img_name}" for img_name in q['images']]

        # 'explanation.images'リストから'explanation_image_urls'を生成
        if 'explanation' in q and isinstance(q['explanation'], dict) and 'images' in q['explanation'] and isinstance(q['explanation']['images'], list):
            q['explanation_image_urls'] = [f"/api/images/{img_name}" for img_name in q['explanation']['images']]

        # Add a default key and then try to load the custom explanation
        q['custom_explanation'] = '' 
        try:
            problem_id = q.get("id")
            if problem_id and container_client:
                explanation_blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{problem_id}.json"
                explanation_blob_client = container_client.get_blob_client(explanation_blob_name)
                if explanation_blob_client.exists():
                    content = explanation_blob_client.download_blob().readall()
                    explanation_data = json.loads(content)
                    q['custom_explanation'] = explanation_data.get('text', '')
        except Exception as e:
            problem_id_for_log = q.get('id', 'UNKNOWN')
            print(f"Error fetching custom explanation for problem {problem_id_for_log}: {e}")

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
    """回答履歴を科目ごとのファイルとしてAzure Blob Storageに追記保存する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="History storage (Blob) is not configured.")
    try:
        # item.subjectは "test-exam.json" のような形式で来るので、適切に処理
        subject_stem = Path(item.subject).stem # 拡張子を除去 (例: "test-exam")
        history_blob_name = f"history/{subject_stem}.jsonl"
        
        history_blob_client = container_client.get_blob_client(history_blob_name)
        
        if not history_blob_client.exists():
            history_blob_client.create_append_blob()

        line_to_append = item.model_dump_json() + "\n"
        history_blob_client.append_block(line_to_append.encode('utf-8'))
        return {"status": "ok"}
    except Exception as e:
        print(f"ERROR saving history: {str(e)}") # コンテナログでデバッグしやすくするため
        # エラーメッセージにBlobの種類に関する情報が含まれているかチェック
        if "The blob type is invalid for this operation" in str(e):
            detail_msg = f"Failed to save history. The blob 'history/{Path(item.subject).stem}.jsonl' may not be an Append Blob. Please check its type in Azure portal."
            raise HTTPException(status_code=409, detail=detail_msg)
        raise HTTPException(status_code=500, detail=f"Failed to save history to blob: {e}")

@api_router.post("/history/bulk", status_code=200)
def save_history_bulk(items: list[HistoryItem]):
    """回答履歴のリストを科目ごとのファイルとしてAzure Blob Storageに一括で追記保存する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="History storage (Blob) is not configured.")
    
    # Group items by subject to minimize blob operations
    grouped_items = {}
    for item in items:
        subject_stem = Path(item.subject).stem
        if subject_stem not in grouped_items:
            grouped_items[subject_stem] = []
        grouped_items[subject_stem].append(item)

    # Process each subject group
    for subject_stem, subject_items in grouped_items.items():
        try:
            history_blob_name = f"history/{subject_stem}.jsonl"
            history_blob_client = container_client.get_blob_client(history_blob_name)
            
            if not history_blob_client.exists():
                history_blob_client.create_append_blob()

            # Create a single string of all lines to append for this subject
            lines_to_append = ""
            for item in subject_items:
                lines_to_append += item.model_dump_json() + "\n"
            
            if lines_to_append:
                history_blob_client.append_block(lines_to_append.encode('utf-8'))

        except Exception as e:
            # If one subject fails, we might want to continue with others,
            # but for now, we'll raise an exception for the whole batch on first failure.
            print(f"ERROR saving bulk history for subject {subject_stem}: {str(e)}")
            if "The blob type is invalid for this operation" in str(e):
                detail_msg = f"Failed to save history for {subject_stem}. The blob 'history/{subject_stem}.jsonl' may not be an Append Blob."
                raise HTTPException(status_code=409, detail=detail_msg)
            raise HTTPException(status_code=500, detail=f"Failed to save bulk history for {subject_stem}: {e}")
            
    return {"status": "ok", "processed_items": len(items)}

@api_router.get("/analytics/{subject_name}")
def get_analytics(
    subject_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    category: Optional[str] = None,
):
    """指定された科目の履歴ファイルのみをAzure Blob Storageから読み込み、統計情報を計算して返す"""
    if container_client is None:
        return {"overall_correct_rate": 0, "total_runs": 0, "daily_correct_rate_trend": {}, "frequently_missed_categories": {}, "total_problems_in_subject": 0, "unanswered_problems_count": 0}

    subject_stem = Path(subject_name).stem
    history_blob_name = f"history/{subject_stem}.jsonl"
    history_blob_client = container_client.get_blob_client(history_blob_name)

    if not history_blob_client.exists():
        return {"overall_correct_rate": 0, "total_runs": 0, "daily_correct_rate_trend": {}, "frequently_missed_categories": {}, "total_problems_in_subject": 0, "unanswered_problems_count": 0}

    try:
        history_content = history_blob_client.download_blob().readall().decode('utf-8')
        history_lines = history_content.strip().split('\n')
        history_items = [HistoryItem.model_validate_json(line) for line in history_lines if line]
    except Exception as e:
        print(f"Error reading history from blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read or parse history from blob: {e}")
    
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
        return {"overall_correct_rate": 0, "total_runs": 0, "daily_correct_rate_trend": {}, "frequently_missed_categories": {}, "total_problems_in_subject": 0, "unanswered_problems_count": 0}

    total_runs = len(target_history)
    correct_answers = sum(1 for item in target_history if item.is_correct)
    overall_correct_rate = (correct_answers / total_runs) * 100 if total_runs > 0 else 0
    daily_trend = {}
    for item in target_history:
        # UTCタイムスタンプをAsia/Tokyoのローカル日付に変換
        day_str = item.answered_at.astimezone(TOKYO_TZ).strftime("%Y-%m-%d")
        if day_str not in daily_trend: daily_trend[day_str] = {"correct": 0, "total": 0}
        daily_trend[day_str]["total"] += 1
        if item.is_correct:
            daily_trend[day_str]["correct"] += 1
    daily_correct_rate_trend = {day: (stats["correct"] / stats["total"]) for day, stats in daily_trend.items()}

    frequently_missed_categories = {}
    for item in target_history:
        if not item.is_correct and item.category:
            frequently_missed_categories[item.category] = frequently_missed_categories.get(item.category, 0) + 1

    # Unfiltered history is needed for unanswered count
    all_questions_for_subject_map = _get_all_questions_for_subject(subject_name)
    total_problems_in_subject = len(all_questions_for_subject_map)
    
    unfiltered_history_items = history_items
    answered_problem_ids = {item.problem_id for item in unfiltered_history_items}
    unanswered_problems_count = total_problems_in_subject - len(answered_problem_ids)

    return {
        "overall_correct_rate": overall_correct_rate,
        "total_runs": total_runs,
        "daily_correct_rate_trend": daily_correct_rate_trend,
        "frequently_missed_categories": frequently_missed_categories,
        "total_problems_in_subject": total_problems_in_subject,
        "unanswered_problems_count": unanswered_problems_count,
    }

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

@api_router.post("/problems/{problem_id}/custom-explanation", status_code=204)
def save_custom_explanation(problem_id: str, explanation: CustomExplanation):
    """Saves a user's custom explanation for a problem."""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
        
    try:
        blob_name = f"{CUSTOM_EXPLANATIONS_DIR}/{problem_id}.json"
        blob_client = container_client.get_blob_client(blob_name)
        blob_client.upload_blob(explanation.model_dump_json(), overwrite=True)
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
