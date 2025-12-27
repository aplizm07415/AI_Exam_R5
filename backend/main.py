import os
import json
import random
import datetime
from pathlib import Path
from fastapi import FastAPI, APIRouter, HTTPException, Query # Queryをインポート
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import mimetypes
from fastapi.responses import StreamingResponse
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

@api_router.get("/quiz/unanswered-count")
def get_unanswered_count(subjects: list[str] = Query(...)):
    """指定された科目セットに対する未回答の問題数を計算して返す"""
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

@api_router.get("/quiz/start")
def start_quiz(subjects: list[str] = Query(...), count: int = 10, mode: str = Query("random")):
    """指定された複数の科目からクイズを開始する"""
    if container_client is None:
        raise HTTPException(status_code=500, detail="Azure Blob Storage は設定されていません。")
    if not subjects:
        raise HTTPException(status_code=400, detail="科目が選択されていません。")

    all_questions = []
    try:
        for subject_name in subjects:
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

    num_to_select = min(count, len(all_questions))
    selected_questions = []

    if mode == "weak_area":
        history_items = []
        for subject_name in subjects:
            history_items.extend(_get_history_items_for_subject(subject_name))
        
        missed_problem_counts = Counter(item.problem_id for item in history_items if not item.is_correct)
        
        # 苦手な問題を優先的に選択
        # ... (simplified logic for brevity, you may want to expand this)
        # For now, just shuffle all questions and pick
        random.shuffle(all_questions)
        selected_questions = all_questions[:num_to_select]

    elif mode == "unanswered":
        history_items = []
        for subject_name in subjects:
            history_items.extend(_get_history_items_for_subject(subject_name))
        
        answered_problem_ids = {item.problem_id for item in history_items}
        unanswered_questions = [q for q in all_questions if q.get("id") not in answered_problem_ids]
        random.shuffle(unanswered_questions)
        selected_questions = unanswered_questions
    
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
@api_router.get("/history/daily-summary/all", response_model=list[DailySummaryItem])
def get_all_daily_summaries():
    """すべての科目の履歴を読み込み、直近14日間の日付ごとに集計した統合サマリーを返す"""
    if container_client is None:
        return []

    all_history_items = []
    try:
        history_blobs = container_client.list_blobs(name_starts_with="history/")
        for blob in history_blobs:
            if not blob.name.endswith(".jsonl"):
                continue
            
            blob_client = container_client.get_blob_client(blob.name)
            if blob_client.exists():
                history_content = blob_client.download_blob().readall().decode('utf-8')
                history_lines = history_content.strip().split('\n')
                for line in history_lines:
                    if line.strip():
                        try:
                            all_history_items.append(HistoryItem.model_validate_json(line))
                        except Exception as e:
                            print(f"Skipping malformed line in {blob.name}: {line}. Error: {e}")
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
            date_str = item_date.strftime("%Y-%m-%d")
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

# Explicitly handle SPA routes to avoid "Not Found" on reload
@app.get("/portal", response_class=FileResponse)
async def serve_portal_route():
    return FileResponse(DIST_DIR / "index.html")

@app.get("/dashboard", response_class=FileResponse)
async def serve_dashboard_route():
    return FileResponse(DIST_DIR / "index.html")

app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")