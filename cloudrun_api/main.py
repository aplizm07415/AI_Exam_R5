import os
import json
import time
import random
import aiofiles
from fastapi import FastAPI, APIRouter, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

app = FastAPI()
router = APIRouter()

# --- CORSミドルウェアの設定 ---
origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8081",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- データストレージの設定 ---
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# !!! リロード問題対策: 解答履歴をファイルではなくメモリ上に保存する ---
history_data: List[Dict[str, Any]] = []

# --- ヘルパー関数: JSONファイルの読み書き ---

async def load_data(subject: str) -> Dict[str, Any]:
    path = os.path.join(DATA_DIR, f"data_{subject}.json")
    if not os.path.exists(path):
        return {"problems": [], "summary": {}}
    try:
        async with aiofiles.open(path, 'r', encoding='utf-8') as f:
            content = await f.read()
            data = json.loads(content)
            if isinstance(data, list):
                return {"problems": data, "summary": {}}
            return data
    except (json.JSONDecodeError, FileNotFoundError):
        return {"problems": [], "summary": {}}

async def save_data(subject: str, data: Dict[str, Any]):
    path = os.path.join(DATA_DIR, f"data_{subject}.json")
    async with aiofiles.open(path, 'w', encoding='utf-8') as f:
        await f.write(json.dumps(data, ensure_ascii=False, indent=2))

async def load_history() -> List[Dict[str, Any]]:
    """メモリ上の履歴データを返す"""
    global history_data
    return history_data

async def append_history(record: Dict[str, Any]):
    """メモリ上の履歴データに追記する"""
    global history_data
    history_data.append(record)

# --- スキーマ定義 ---
class HistoryRecord(BaseModel):
    problem_id: str; subject: str; selected_answer: str; is_correct: bool; timestamp: Optional[str] = None
class UploadResponse(BaseModel):
    message: str; total_problems: int

# --- エンドポイント実装 ---

@router.get("/subjects")
async def get_subjects():
    try:
        files = os.listdir(DATA_DIR)
        return [f[5:-5] for f in files if f.startswith("data_") and f.endswith(".json")]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve subjects: {str(e)}")

@router.post("/upload", response_model=UploadResponse)
async def upload_data(file: UploadFile = File(...), subject: str = Form(...)):
    try:
        contents = await file.read()
        uploaded_json = json.loads(contents)
        
        if "questions" not in uploaded_json or not isinstance(uploaded_json["questions"], list):
            raise HTTPException(status_code=400, detail="Invalid JSON format.")
            
        raw_questions = uploaded_json.get("questions", [])

        transformed_questions = []
        for q in raw_questions:
            choice_list = [f"{key}: {value}" for key, value in q.get("choices", {}).items()]
            correct_answer_key = q.get("correct_answer")
            correct_answer_text = q.get("choices", {}).get(correct_answer_key)
            correct_answer_full = f"{correct_answer_key}: {correct_answer_text}" if correct_answer_text else ""
            
            explanation = f"**正解:** {q.get('correct_explanation', '')}\n\n"
            for key, desc in q.get('choice_explanations', {}).items():
                explanation += f"- **選択肢 {key}:** {desc}\n"

            transformed_q = {
                "id": q.get("id"),
                "question_text": q.get("question_text"),
                "choices": choice_list,
                "answer": correct_answer_full,
                "explanation": explanation,
                "metadata": {"subject": subject, "category": q.get("additional_info", {}).get("category", "未分類")},
            }
            transformed_questions.append(transformed_q)

        existing_data = await load_data(subject)
        existing_problems = existing_data.get("problems", [])
        merged_problems = existing_problems + transformed_questions
        
        new_data_obj = {"problems": merged_problems, "summary": existing_data.get("summary", {})}
        await save_data(subject, new_data_obj)

        return {"message": f"Data for '{subject}' merged and saved successfully.", "total_problems": len(merged_problems)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data upload failed: {str(e)}")

@router.get("/quiz/start/{subject}")
async def start_quiz(subject: str, mode: str, count: int):
    data_obj = await load_data(subject)
    all_problems = data_obj.get("problems", [])

    if not all_problems:
        raise HTTPException(status_code=404, detail="No problems found for this subject.")

    selection_pool = []
    if mode == 'weak_area':
        history = await load_history()
        subject_history = [h for h in history if h.get("subject") == subject]
        problem_stats = {}
        for h in subject_history:
            pid = h.get("problem_id")
            if not pid: continue
            problem_stats.setdefault(pid, {'correct': 0, 'total': 0})
            problem_stats[pid]['total'] += 1
            if h.get('is_correct'): problem_stats[pid]['correct'] += 1
        
        def get_accuracy(p_id):
            stats = problem_stats.get(p_id)
            return (stats['correct'] / stats['total']) if stats and stats.get('total', 0) > 0 else 1.0
        
        unique_problems = {p['id']: p for p in all_problems if 'id' in p}.values()
        selection_pool = sorted(unique_problems, key=lambda p: get_accuracy(p.get('id')))
    else: # 'random' mode
        selection_pool = list(all_problems)
        random.shuffle(selection_pool)
    
    final_count = min(count, len(selection_pool))
    selected_problems = selection_pool[:final_count]

    quiz_set = [{
        "id": p.get("id"),
        "question_text": p.get("question_text"),
        "choices": p.get("choices"),
        "answer": p.get("answer"),
        "subject": p.get("metadata", {}).get("subject"),
        "explanation": p.get("explanation", "この問題には解説がありません。")
    } for p in selected_problems]

    return {"quiz_set": quiz_set}

@router.post("/history", status_code=201)
async def submit_history(record: HistoryRecord):
    if record.timestamp is None:
        record.timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    await append_history(record.dict())
    return {"message": "History recorded successfully."}

@router.get("/analytics/{subject}")
async def get_analytics(subject: str):
    try:
        history = await load_history()
        subject_data = await load_data(subject)
        subject_problems = subject_data.get("problems", [])
        
        subject_history = [h for h in history if h.get("subject") == subject]
        total_runs = len(subject_history)
        correct_count = sum(1 for h in subject_history if h.get("is_correct", False))
        overall_correct_rate = (correct_count / total_runs) * 100 if total_runs > 0 else 0
        
        answered_problem_ids = {h.get("problem_id") for h in subject_history if h.get("problem_id")}
        total_problem_count = len(subject_problems)
        unanswered_problems_count = total_problem_count - len(answered_problem_ids)

        daily_stats = {}
        for h in subject_history:
            timestamp = h.get("timestamp", "")
            if "T" in timestamp:
                date = timestamp.split("T")[0]
                daily_stats.setdefault(date, {"correct": 0, "total": 0})
                daily_stats[date]["total"] += 1
                if h.get("is_correct"):
                    daily_stats[date]["correct"] += 1
        
        daily_rates = {
            date: (stats["correct"] / stats["total"])
            for date, stats in daily_stats.items()
            if stats.get("total", 0) > 0
        }
        
        category_errors = {}
        problem_map = {p.get("id"): p for p in subject_problems if p.get("id")}
        for h in subject_history:
            problem_id = h.get("problem_id")
            if not h.get("is_correct") and problem_id in problem_map:
                problem = problem_map[problem_id]
                category = problem.get("metadata", {}).get("category", "未分類")
                category_errors[category] = category_errors.get(category, 0) + 1
                
        return {
            "overall_correct_rate": round(overall_correct_rate, 2),
            "total_runs": total_runs,
            "daily_correct_rate_trend": daily_rates,
            "frequently_missed_categories": dict(sorted(category_errors.items(), key=lambda item: item[1], reverse=True)),
            "total_problems_in_subject": total_problem_count,
            "unanswered_problems_count": unanswered_problems_count,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An unexpected error occurred while generating analytics for '{subject}': {str(e)}"
        )

# --- FastAPI ルーターの適用 ---
app.include_router(router, prefix="/api")