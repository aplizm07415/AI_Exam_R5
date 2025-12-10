import os
import json
import random
import datetime
from pathlib import Path
from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from azure.storage.blob import BlobServiceClient
import pytz # 新規追加: タイムゾーン処理のため

# --- ローカルユーティリティ ---
from .utils import normalize_question

# --- Pydanticモデル定義 ---
class HistoryItem(BaseModel):
    problem_id: str
    subject: str
    selected_answer: str
    is_correct: bool
    answered_at: datetime.datetime = datetime.datetime.now(datetime.timezone.utc)
    category: str | None = None

# 新規追加: 日別集計の戻り値用モデル
class DailySummaryItem(BaseModel):
    date: str # YYYY-MM-DD
    total_questions: int
    correct_count: int
    accuracy: float

# --- 定数とセットアップ ---
BLOB_CONN_STR = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
BLOB_CONTAINER_NAME = os.getenv("QUIZ_BLOB_CONTAINER", "exam-json")

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

# --- API Routes ---
@api_router.get("/health")
def health():
    return {"status": "ok"}

@api_router.get("/subjects")
def get_subjects():
    """Blob Storage内の科目（問題JSONファイル）リストを返す"""
    if container_client is None: return ["（Blob Storage未接続）"]
    try:
        # 'history/' フォルダにあるファイルは科目リストから除外する
        return [blob.name for blob in container_client.list_blobs() if blob.name.endswith('.json') and not blob.name.startswith('history/')] 
    except Exception as e:
        print(f"Error fetching subjects: {e}")
        return [f"（Blob接続エラー: {e}）"]

@api_router.post("/upload")
async def upload_exam(file: UploadFile = File(...)):
    if container_client is None: raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    if not file.filename.endswith('.json'): raise HTTPException(status_code=400, detail="Only .json files are allowed.")
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format.")
    try:
        blob_name = file.filename
        container_client.upload_blob(name=blob_name, data=content, overwrite=True)
        total_problems = 0
        if isinstance(data, list): total_problems = len(data)
        elif isinstance(data, dict) and "questions" in data: total_problems = len(data["questions"])
    except Exception as e:
        print(f"Error uploading blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to upload to blob storage: {e}")
    return {"status": "ok", "blob_name": blob_name, "total_problems": total_problems}

@api_router.get("/quiz/start/{subject_name}")
def start_quiz(subject_name: str, count: int = 10):
    """指定された科目（問題JSONファイル）からクイズを開始する"""
    if container_client is None: raise HTTPException(status_code=500, detail="Azure Blob Storage is not configured.")
    all_questions = []
    try:
        # subject_name は URLエンコードされている可能性があるので、そのまま使う
        blob_client = container_client.get_blob_client(subject_name)
        if not blob_client.exists():
            raise HTTPException(status_code=404, detail=f"Subject '{subject_name}' not found.")
        
        raw_content = blob_client.download_blob().readall()
        data = json.loads(raw_content)
        questions_in_file = data.get("questions", []) if isinstance(data, dict) else data if isinstance(data, list) else []
        for q in questions_in_file:
            normalized_q = normalize_question(q)
            if normalized_q: all_questions.append(normalized_q)
    except Exception as e:
        print(f"Error reading quiz data from blob: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read questions from blob storage: {e}")
    if not all_questions: raise HTTPException(status_code=404, detail="No valid questions available.")
    num_to_select = min(count, len(all_questions))
    selected_questions = random.sample(all_questions, num_to_select)
    return {"quiz_set": selected_questions}

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
        raise HTTPException(status_code=500, detail=f"Failed to save history to blob: {e}")

@api_router.get("/analytics/{subject_name}")
def get_analytics(subject_name: str):
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
    
    target_history = history_items
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

    return {
        "overall_correct_rate": overall_correct_rate,
        "total_runs": total_runs,
        "daily_correct_rate_trend": daily_correct_rate_trend,
        "frequently_missed_categories": frequently_missed_categories,
        "total_problems_in_subject": 0, # Note: This might need implementation later
        "unanswered_problems_count": 0, # Note: This might need implementation later
    }


# --- 新規追加: 日別集計API ---
@api_router.get("/history/daily-summary/{subject_name}", response_model=list[DailySummaryItem])
def get_daily_summary(subject_name: str):
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

    if not history_items:
        return []

    daily_summary_map = {} # { "YYYY-MM-DD": { "total": N, "correct": M } }

    for item in history_items:
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
    
    # 日付の降順でソート
    daily_summary_list.sort(key=lambda x: x.date, reverse=True)

    return daily_summary_list

# --- Final App Setup ---
app.include_router(api_router)
app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")