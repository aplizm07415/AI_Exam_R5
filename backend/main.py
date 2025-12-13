import os
import json
import random
import datetime
from pathlib import Path
from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Query # Queryをインポート
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from azure.storage.blob import BlobServiceClient
import pytz # 新規追加: タイムゾーン処理のため
from collections import Counter # Counterをインポート

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

# 新規追加: 不正解問題詳細の戻り値用モデル
class MissedProblemDetail(BaseModel):
    problem_id: str
    question_text: str
    category: str | None = None
    explanation: str | None = None
    miss_count: int
    correct_answer: str | None = None

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
def start_quiz(subject_name: str, count: int = 10, mode: str = Query("random")): # Add mode parameter
    """指定された科目（問題JSONファイル）からクイズを開始する"""
    if container_client is None: raise HTTPException(status_code=500, detail="Azure Blob Storage は設定されていません。")
    
    all_questions = []
    try:
        blob_client = container_client.get_blob_client(subject_name)
        if not blob_client.exists():
            raise HTTPException(status_code=404, detail=f"科目 '{subject_name}' が見つかりません。")
        
        raw_content = blob_client.download_blob().readall()
        data = json.loads(raw_content)
        questions_in_file = data.get("questions", []) if isinstance(data, dict) else data if isinstance(data, list) else []
        for q in questions_in_file:
            normalized_q = normalize_question(q)
            if normalized_q: all_questions.append(normalized_q)
    except Exception as e:
        print(f"クイズデータの読み込みエラー: {e}")
        raise HTTPException(status_code=500, detail=f"Blobストレージからの質問の読み込みに失敗しました: {e}")
    
    if not all_questions: raise HTTPException(status_code=404, detail="有効な質問がありません。")

    num_to_select = min(count, len(all_questions))
    selected_questions_dict = {} # Use dict to store selected questions by ID, for uniqueness and easy lookup
    
    if mode == "weak_area":
        history_items = _get_history_items_for_subject(subject_name)
        
        # Count incorrect answers by problem_id and category
        missed_problem_counts = Counter()
        missed_category_counts = Counter()

        for item in history_items:
            if not item.is_correct:
                missed_problem_counts[item.problem_id] += 1
                if item.category:
                    missed_category_counts[item.category] += 1
        
        # 1. Prioritize questions that were explicitly missed (highest count first)
        prioritized_problem_ids = [pid for pid, _ in missed_problem_counts.most_common()]
        
        for problem_id in prioritized_problem_ids:
            if len(selected_questions_dict) >= num_to_select:
                break
            # Find a question with this problem_id among all available questions
            question_to_add = next((q for q in all_questions if q.get("id") == problem_id), None)
            if question_to_add and question_to_add.get("id") not in selected_questions_dict:
                selected_questions_dict[question_to_add.get("id")] = question_to_add
        
        # 2. Then, prioritize questions from missed categories (highest count first), ensuring uniqueness
        prioritized_categories = [cat for cat, _ in missed_category_counts.most_common()]
        
        for category in prioritized_categories:
            if len(selected_questions_dict) >= num_to_select:
                break
            
            # Get all questions belonging to this category that haven't been selected yet
            category_questions = [q for q in all_questions 
                                  if q.get("category") == category 
                                  and q.get("id") not in selected_questions_dict]
            
            random.shuffle(category_questions) # Shuffle to get varied questions from the category
            
            for q in category_questions:
                if len(selected_questions_dict) >= num_to_select:
                    break
                selected_questions_dict[q.get("id")] = q
        
        # 3. Fill remaining slots with random questions from the rest
        if len(selected_questions_dict) < num_to_select:
            remaining_slots = num_to_select - len(selected_questions_dict)
            
            # Get all questions not yet selected
            unselected_questions = [q for q in all_questions 
                                    if q.get("id") not in selected_questions_dict]
            
            if len(unselected_questions) <= remaining_slots:
                # If there are fewer or equal remaining unselected questions than slots, take all of them
                for q in unselected_questions:
                    selected_questions_dict[q.get("id")] = q
            else:
                # Otherwise, take a random sample from the unselected questions
                random_fill_questions = random.sample(unselected_questions, remaining_slots)
                for q in random_fill_questions:
                    selected_questions_dict[q.get("id")] = q
        
        selected_questions = list(selected_questions_dict.values())

    elif mode == "unanswered":
        history_items = _get_history_items_for_subject(subject_name)
        answered_problem_ids = {item.problem_id for item in history_items}
        
        unanswered_questions = [q for q in all_questions if q.get("id") not in answered_problem_ids]
        random.shuffle(unanswered_questions)
        selected_questions = unanswered_questions
    
    else: # Default to random mode
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

    # Call helper to get all questions for the subject
    all_questions_for_subject_map = _get_all_questions_for_subject(subject_name)
    total_problems_in_subject = len(all_questions_for_subject_map)

    # Get unique problem IDs from history
    answered_problem_ids = {item.problem_id for item in target_history}
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