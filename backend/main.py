import os
from pathlib import Path
from fastapi import FastAPI, APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json

# --- Setup ---
app = FastAPI()
api_router = APIRouter(prefix="/api")
BASE_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = BASE_DIR / "frontend" / "dist"
EXAMS_DIR = BASE_DIR / "exams"

# --- API Routes ---
@api_router.get("/health")
def health():
    return {"status": "ok"}

@api_router.get("/subjects")
def get_subjects():
    """examsディレクトリ内のJSONファイル名をリストとして返す"""
    subjects = []
    if EXAMS_DIR.is_dir():
        subjects = [f.stem for f in EXAMS_DIR.glob("*.json")]
    return subjects

@api_router.post("/upload")
async def upload_file():
    """（プレースホルダー）アップロード機能"""
    return {"message": "Upload endpoint placeholder", "total_problems": 0}

@api_router.get("/analytics/{subject_name}")
async def get_analytics(subject_name: str):
    """（プレースホルダー）分析データ"""
    return {
        "overall_correct_rate": 0, "total_runs": 0,
        "daily_correct_rate_trend": {}, "frequently_missed_categories": {},
        "total_problems_in_subject": 0, "unanswered_problems_count": 0,
    }

@api_router.get("/quiz/start/{subject_name}")
async def start_quiz(subject_name: str, mode: str = 'random', count: int = 10):
    """（プレースホルダー）クイズ開始機能。ダミー問題を返す"""
    exam_file = EXAMS_DIR / "exam01.json"
    if exam_file.exists():
        with open(exam_f) as f:
            questions = json.load(f)
            # リクエストされた数だけ問題を返す（ダミーなので同じ問題を繰り返す）
            return {"quiz_set": (questions * count)[:count]}
    return {"quiz_set": []}

# APIルーターをアプリケーションに登録
app.include_router(api_router)

# --- SPA/Static Files Routes ---
# APIルーターの後に、静的ファイルの配信設定を登録
# これにより、どのAPIにも一致しなかったリクエストが静的ファイルとして処理される
app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")