import os
import json
import random
import datetime
from pathlib import Path
from fastapi import FastAPI, APIRouter, HTTPException, Query
from pydantic import BaseModel, Field # BaseModelをインポート
from typing import Literal
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import mimetypes
from fastapi.responses import StreamingResponse
from azure.storage.blob import BlobServiceClient
import pytz
from collections import Counter

# --- ローカルユーティリティ ---
from .utils import normalize_question, HistoryItem, ProblemStudyStatus, get_problem_study_statuses, calculate_review_priority

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
            raise HTTPException(status_code=500, detail=f"Failed to save bulk history for {subject_stem}: {e}")
            
    return {"status": "ok", "processed_items": len(items)}

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
